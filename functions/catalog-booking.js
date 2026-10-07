/**
 * PackZen — Catalog bookings (additive module, loaded from index.js)
 * ---------------------------------------------------------------
 * Books items from the Admin → Services Catalog (AC install, packing tiers,
 * moving packages, add-ons …). Deliberately SEPARATE from the existing
 * createBooking / createRazorpayOrder / verifyRazorpayPayment functions so
 * the live move-booking and payment flow is untouched.
 *
 *   createServiceBooking          callable   pay-later bookings & quote requests
 *   createServiceRazorpayOrder    HTTPS      starts an online payment
 *   verifyServiceRazorpayPayment  HTTPS      verifies payment, creates booking
 *
 * Security model: the client sends only { type, id, qty } per item plus the
 * customer's details. Prices come from Firestore on the server.
 */
"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { defineSecret } = require("firebase-functions/params");
const { BREVO_SECRETS } = require("./brevo-client");
const { priceCart, validateDetails, validRequestId } = require("./catalog-pricing");
const mp = require("./move-payment");
const { handleCreateServiceOrder } = require("./catalog-payment");
const rateLimit = require("./rate-limit");
const opsAlerts = require("./ops-alerts");

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

const REGION = "asia-south1";
const ALLOWED_ORIGINS = ["https://packzenblr.in", "https://www.packzenblr.in", "http://localhost:5000"];
const cors = require("cors")({ origin: ALLOWED_ORIGINS });

const COLL = { services: "services", packages: "packages", addons: "addons", categories: "serviceCategories" };
const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/* ── Helpers ────────────────────────────────────────────────── */

// Fetch only the catalog documents the cart references (+ their categories).
async function loadCatalog(db, rawItems) {
  const catalog = { services: {}, packages: {}, addons: {}, categories: {} };
  if (!Array.isArray(rawItems)) return catalog;

  const wanted = [];
  for (const it of rawItems.slice(0, 40)) {
    if (it && COLL[it.type] && it.type !== "categories" && typeof it.id === "string" && ID_RE.test(it.id)) {
      wanted.push({ type: it.type, id: it.id });
    }
  }
  if (!wanted.length) return catalog;

  const refs = wanted.map((w) => db.collection(COLL[w.type]).doc(w.id));
  const snaps = await db.getAll(...refs);
  const catIds = new Set();
  snaps.forEach((s, i) => {
    if (s.exists) {
      catalog[wanted[i].type][wanted[i].id] = s.data();
      if (s.data().categoryId) catIds.add(s.data().categoryId);
    }
  });

  const validCatIds = [...catIds].filter((c) => typeof c === "string" && ID_RE.test(c));
  if (validCatIds.length) {
    const catSnaps = await db.getAll(...validCatIds.map((c) => db.collection(COLL.categories).doc(c)));
    catSnaps.forEach((s) => { if (s.exists) catalog.categories[s.id] = s.data(); });
  }
  return catalog;
}

function newBookingRef() {
  return "PKZ-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
}

function bookingLines(lines) {
  return lines.map((l) => ({
    type: l.type, id: l.id, name: l.name, categoryId: l.categoryId, qty: l.qty,
    pricingUnit: l.pricingUnit, unitPrice: l.unitPrice, lineTotal: l.lineTotal, kind: l.kind,
  }));
}

// Common booking document. Uses the same pickup/drop/moveType/total fields the
// existing dashboards read, so catalog bookings appear everywhere automatically.
function buildBooking({ uid, requestId, details, cart, status, paid, paymentType, paymentStatus, extra }) {
  return Object.assign({
    bookingType: "service",
    bookingRef: newBookingRef(),
    requestId,
    customerUid: uid,
    customerName: details.customerName,
    phone: details.phone,
    email: details.email,
    pickup: details.address,   // service address
    drop: "",                  // no destination for on-site services
    date: details.date,
    shiftTime: details.timeSlot,
    shiftTimeLabel: details.timeSlotLabel,
    moveType: "service",
    remarks: details.notes,
    items: bookingLines(cart.lines),
    total: cart.estimatedTotal,
    totalIsEstimate: cart.hasEstimateItems || cart.hasQuoteItems,
    needsQuote: cart.hasQuoteItems,
    paid,
    paymentType,
    paymentStatus,
    status,
    source: "services-page",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, extra || {});
}

async function authUid(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  try { return (await admin.auth().verifyIdToken(h.split("Bearer ")[1])).uid; }
  catch (e) { return null; }
}

function prepare(db, data) {
  return loadCatalog(db, data && data.items).then((catalog) => {
    const cart = priceCart(catalog, data && data.items);
    const det = validateDetails(data && data.details);
    return { cart, det };
  });
}

/* ── 1. Pay-later booking / quote request ───────────────────── */
exports.createServiceBooking = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Please sign in to book.");
    }
    if (!validRequestId(data && data.requestId)) {
      throw new functions.https.HttpsError("invalid-argument", "Missing request id.");
    }
    const db = admin.firestore();
    const uid = context.auth.uid;

    const rl = await rateLimit.consumeAll(db, [
      Object.assign({ scope: "bookingUid", subject: uid }, rateLimit.LIMITS.bookingUid),
      Object.assign({ scope: "bookingIp", subject: rateLimit.clientIp(context.rawRequest) }, rateLimit.LIMITS.bookingIp),
    ], functions.logger);
    if (!rl.ok) throw new functions.https.HttpsError("resource-exhausted", "Too many bookings in a short time. Please wait a few minutes.");

    const dup = await db.collection("bookings")
      .where("requestId", "==", data.requestId).where("customerUid", "==", uid).limit(1).get();
    if (!dup.empty) {
      const b = dup.docs[0].data();
      return { docId: dup.docs[0].id, bookingRef: b.bookingRef, status: b.status, total: b.total, needsQuote: !!b.needsQuote, duplicate: true };
    }

    const { cart, det } = await prepare(db, data);
    if (!cart.ok) throw new functions.https.HttpsError("invalid-argument", cart.errors.join(" "));
    if (!det.ok) throw new functions.https.HttpsError("invalid-argument", det.errors.join(" "));

    // Definite prices → confirmed. Quotes / "starting from" prices need a human to confirm.
    const status = (cart.hasQuoteItems || cart.hasEstimateItems) ? "pending" : "confirmed";

    // Prefer the verified account email over a typed one.
    const tok = context.auth.token || {};
    const details = Object.assign({}, det.value, tok.email && tok.email_verified === true ? { email: String(tok.email).toLowerCase() } : {});
    const booking = buildBooking({
      uid, requestId: data.requestId, details, cart, status,
      paid: 0, paymentType: "pay_later", paymentStatus: "unpaid",
      extra: { balanceDue: cart.estimatedTotal, currency: "INR" },
    });
    const ref = await db.collection("bookings").add(booking);
    return { docId: ref.id, bookingRef: booking.bookingRef, status, total: booking.total, needsQuote: booking.needsQuote };
  });

/* ── 2. Start an online payment (shared hardened payment core) ── */
// Orders are stored in `pendingPayments` with flow:"service", so verification,
// capture check, idempotency, webhook and hourly reconciliation are the same
// code as moving payments (catalog-payment.js → move-payment.js).
function paymentDeps(razorpay) {
  return {
    verifyIdToken: (t) => admin.auth().verifyIdToken(t),
    db: admin.firestore(),
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    now: () => Date.now(),
    logger: functions.logger,
    rateLimit: (uid, req) => rateLimit.consumeAll(admin.firestore(), [
      Object.assign({ scope: "serviceOrderUid", subject: uid }, rateLimit.LIMITS.serviceOrderUid),
      Object.assign({ scope: "serviceOrderIp", subject: rateLimit.clientIp(req) }, rateLimit.LIMITS.serviceOrderIp),
    ], functions.logger),
    recordFailure: (source, code) => opsAlerts.recordFailure(admin.firestore(), source, code),
    razorpay,
  };
}

exports.createServiceRazorpayOrder = functions
  .region(REGION)
  .runWith({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .https.onRequest((req, res) => cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    const db = admin.firestore();
    const out = await handleCreateServiceOrder(req, Object.assign(paymentDeps(razorpay), {
      loadCatalog: (items) => loadCatalog(db, items),
      priceCart, validateDetails, validRequestId,
      createOrder: (o) => razorpay.orders.create(o),
    }));
    return res.status(out.status).json(out.body);
  }));

/* ── 3. Verify payment → booking ── */
// New orders: shared move-payment verification (auth, constant-time signature,
// Razorpay capture check, amount/currency/order match, one transaction,
// booking id = order id). Orders created before this release live in the
// legacy `pendingServicePayments` collection and are drained by
// verifyLegacyServicePayment (now also capture-checked).
exports.verifyServiceRazorpayPayment = functions
  .region(REGION)
  .runWith({ secrets: [...BREVO_SECRETS, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .https.onRequest((req, res) => cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    const orderId = req.body && req.body.razorpay_order_id;
    const db = admin.firestore();
    if (typeof orderId === "string" && /^order_[A-Za-z0-9]{6,40}$/.test(orderId)) {
      const legacy = await db.collection("pendingServicePayments").doc(orderId).get();
      if (legacy.exists) return verifyLegacyServicePayment(req, res, razorpay);
    }
    const out = await mp.handleVerifyPayment(req, Object.assign(paymentDeps(razorpay), {
      keySecret: RAZORPAY_KEY_SECRET.value(),
      fetchPayment: (paymentId) => razorpay.payments.fetch(paymentId),
      sendConfirmation: (data) => sendServiceConfirmation(data),
    }));
    return res.status(out.status).json(out.body);
  }));

async function sendServiceConfirmation(d) {
  const { sendCustomerEmail } = require("./notification-service");
  await sendCustomerEmail("booking_confirmed", d.customerEmail, {
    bookingRef: d.bookingRef, customerName: d.customerName, pickup: d.pickup, drop: "", date: d.date,
    total: d.total, paymentStatus: d.paymentStatus,
  });
}

/* Legacy drain path for orders created before this release. Same behaviour
   as before plus: Razorpay capture + amount/currency/order verification. */
async function verifyLegacyServicePayment(req, res, razorpay) {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ success: false, error: "Please sign in again." });
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!orderId || !paymentId || !signature) return res.status(400).json({ success: false, error: "Missing payment identifiers" });
    const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET.value()).update(orderId + "|" + paymentId).digest("hex");
    const a = Buffer.from(expected), b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ success: false, error: "Invalid signature" });

    const db = admin.firestore();
    const pendingRef = db.collection("pendingServicePayments").doc(orderId);
    const pre = await pendingRef.get();
    if (pre.exists) {
      const p0 = pre.data();
      if (p0.uid !== uid) return res.status(403).json({ success: false, error: "This payment belongs to another account." });
      let pay;
      try { pay = await razorpay.payments.fetch(paymentId); } catch (e) {
        return res.status(503).json({ success: false, code: "verification_unavailable", error: "We're confirming your payment. Please don't pay again." });
      }
      if (!pay || pay.id !== paymentId || pay.order_id !== orderId || pay.currency !== "INR" || Number(pay.amount) !== Number(p0.amount) * 100) {
        return res.status(400).json({ success: false, error: "We couldn't verify this payment. If money was deducted, don't pay again — contact us with your payment ID." });
      }
      if (pay.status === "authorized") return res.status(202).json({ success: false, code: "payment_not_captured", error: "Your payment was received and is being confirmed. Please don't pay again." });
      if (pay.status !== "captured") return res.status(400).json({ success: false, error: "This payment was not completed. No booking was created." });
    }

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(pendingRef);
      if (!snap.exists) return { missing: true };
      const p = snap.data();
      if (p.uid !== uid) return { forbidden: true };
      const cart = { lines: p.lines, estimatedTotal: p.estimatedTotal, hasEstimateItems: false, hasQuoteItems: false };
      const booking = buildBooking({
        uid, requestId: p.requestId, details: p.details, cart, status: "confirmed",
        paid: p.amount, paymentType: "full", paymentStatus: "paid",
        extra: { paymentId, orderId, balanceDue: 0, currency: "INR" },
      });
      tx.set(db.collection("bookings").doc(orderId), booking);
      tx.delete(pendingRef);
      return { booking };
    });
    if (outcome.forbidden) return res.status(403).json({ success: false, error: "This payment belongs to another account." });
    if (outcome.missing) {
      const existing = await db.collection("bookings").where("paymentId", "==", paymentId).limit(1).get();
      if (!existing.empty) {
        const e = existing.docs[0].data();
        if (e.customerUid !== uid) return res.status(403).json({ success: false, error: "This payment belongs to another account." });
        return res.status(200).json({ success: true, bookingRef: e.bookingRef, message: "Payment already processed." });
      }
      return res.status(400).json({ success: false, error: "No matching order found for this payment" });
    }
    return res.status(200).json({ success: true, bookingRef: outcome.booking.bookingRef });
  } catch (err) {
    console.error("verifyLegacyServicePayment:", err && err.message ? String(err.message).slice(0, 120) : "error");
    return res.status(500).json({ success: false, error: "Could not confirm your payment. If money was deducted, contact us on WhatsApp with your payment ID." });
  }
}
