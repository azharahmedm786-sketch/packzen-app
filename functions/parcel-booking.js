/**
 * PackZen — parcel delivery (two-wheeler, up to 20 kg, Bangalore → Bangalore).
 * ---------------------------------------------------------------
 *   getParcelQuote              callable  server price for the form (signed-in users)
 *   createParcelRazorpayOrder   HTTPS     starts the online payment (prepaid only)
 * Payment verification, webhook and hourly reconciliation are the shared payment
 * core: the pending payment carries flow:"parcel" and the customer's browser
 * calls the existing verifyServiceRazorpayPayment endpoint; move-payment.js
 * finalizeCapture builds the parcel booking (booking id = Razorpay order id).
 *
 * The browser sends only addresses, contacts, item description and weight.
 * Distance comes from Google Maps on the server; the price from parcel-pricing.js.
 */
"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const { defineSecret } = require("firebase-functions/params");
const mp = require("./move-payment");
const pp = require("./parcel-pricing");
const rateLimit = require("./rate-limit");
const opsAlerts = require("./ops-alerts");

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const GOOGLE_MAPS_KEY = defineSecret("GOOGLE_MAPS_KEY");

const REGION = "asia-south1";
const ALLOWED_ORIGINS = ["https://packzenblr.in", "https://www.packzenblr.in", "http://localhost:5000"];
const cors = require("cors")({ origin: ALLOWED_ORIGINS });
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const validRequestId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);

async function mapsRoute(pickup, drop) {
  const out = { km: 0, originAddress: "", destinationAddress: "" };
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(drop)}&key=${GOOGLE_MAPS_KEY.value()}`;
    const data = await (await fetch(url)).json();
    if (data.status === "OK") {
      out.originAddress = (data.origin_addresses && data.origin_addresses[0]) || "";
      out.destinationAddress = (data.destination_addresses && data.destination_addresses[0]) || "";
      const el = data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0];
      if (el && el.status === "OK") out.km = el.distance.value / 1000;
    }
  } catch (e) { functions.logger.warn("parcel_maps_error", { message: String(e && e.message).slice(0, 120) }); }
  return out;
}

/** Validate + area-check + price. Throws ParcelError with a customer-facing message. */
async function quoteParcel(details, deps) {
  const det = pp.validateParcelDetails(details, deps.now ? new Date(deps.now()) : undefined);
  if (!det.ok) throw new pp.ParcelError(det.errors.join(" "));
  const route = await deps.route(det.value.pickup, det.value.drop);
  const area = pp.checkParcelArea(route, det.value);
  if (!area.ok) throw new pp.ParcelError(area.error);
  const priced = pp.priceParcel(route.km, det.value.weightKg);
  return { details: det.value, route, area, total: priced.total, breakdown: priced.breakdown };
}

async function handleCreateParcelOrder(req, deps) {
  const logger = deps.logger || console;
  if (PARCEL_RETIRED && !(deps && deps.allowRetired)) return { status: 410, body: { success: false, code: "service_retired", error: PARCEL_RETIRED_MSG } };
  let ctx = {};
  try {
    const user = await mp.authenticate(req, deps.verifyIdToken);
    ctx = { uid: user.uid };
    if (deps.rateLimit) {
      const rl = await deps.rateLimit(user.uid, req);
      if (!rl.ok) return { status: 429, body: { success: false, code: "rate_limited", error: mp.MSG.rateLimited } };
    }
    const body = req.body || {};
    if (!validRequestId(body.requestId)) return { status: 400, body: { success: false, code: "invalid_input", error: "Missing request id." } };

    let q;
    try { q = await quoteParcel(body.details, deps); }
    catch (e) {
      if (e instanceof pp.ParcelError) return { status: 400, body: { success: false, code: "invalid_parcel", error: e.message } };
      throw e;
    }
    const amount = q.total; // ₹, server-computed only
    if (!Number.isInteger(amount) || amount <= 0 || amount > mp.MAX_ONLINE_AMOUNT) throw new Error("parcel amount out of range");

    const nowMs = deps.now();
    const order = await deps.createOrder({ amount: amount * 100, currency: mp.CURRENCY, receipt: "pcl_" + nowMs,
      notes: { uid: user.uid, requestId: body.requestId, flow: "parcel" } });
    if (!order || !order.id || Number(order.amount) !== amount * 100 || order.currency !== mp.CURRENCY) throw new Error("order creation returned unexpected data");
    ctx.orderId = order.id;

    await deps.db.collection(mp.PENDING_COLLECTION).doc(order.id).set({
      flow: "parcel",
      uid: user.uid, email: user.email, emailVerified: user.emailVerified,
      orderId: order.id, requestId: body.requestId,
      paymentType: "full", grandTotal: amount, payNow: amount, amount, currency: mp.CURRENCY,
      details: q.details,
      parcel: { breakdown: q.breakdown, pickupPincode: q.area.pickupPincode, dropPincode: q.area.dropPincode,
                pickupFormatted: q.route.originAddress, dropFormatted: q.route.destinationAddress },
      status: "created", createdAt: deps.serverTimestamp(), expiresAt: new Date(nowMs + ORDER_TTL_MS),
    });
    logger.info("parcel_order_created", { uid: user.uid, orderId: order.id, amount });
    return { status: 200, body: { success: true, orderId: order.id, amount: order.amount, currency: order.currency, serverCalculatedTotal: amount, breakdown: q.breakdown } };
  } catch (err) {
    if (err instanceof mp.PaymentError) {
      logger.warn("parcel_order_rejected", Object.assign({ code: err.code }, ctx));
      return { status: err.status, body: { success: false, code: err.code, error: err.publicMessage } };
    }
    logger.error("parcel_order_error", Object.assign({ message: String(err && err.message).slice(0, 120) }, ctx));
    if (deps.recordFailure) await deps.recordFailure("createParcelRazorpayOrder", "server_error");
    return { status: 500, body: { success: false, code: "server_error", error: "Could not start payment. Please try again." } };
  }
}

/* ── Cloud Functions ───────────────────────────────────────── */
/* Two-wheeler parcel delivery is DISCONTINUED (Oct 2026). New quotes and orders are
   refused server-side; existing parcel bookings, payments, tracking and completion
   codes keep working through the shared booking/payment flows. Data is never deleted. */
const PARCEL_RETIRED = true;
const PARCEL_RETIRED_MSG = "PackZen no longer offers two-wheeler parcel delivery. For single items (a sofa, fridge or a few boxes) book a mini move or single-item move on packzenblr.in.";

exports.getParcelQuote = functions
  .region(REGION)
  .runWith({ secrets: [GOOGLE_MAPS_KEY] })
  .https.onCall(async (data, context) => {
    if (PARCEL_RETIRED) throw new functions.https.HttpsError("failed-precondition", PARCEL_RETIRED_MSG);
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Please sign in to get a price.");
    const rl = await rateLimit.consumeAll(admin.firestore(), [
      Object.assign({ scope: "parcelQuoteUid", subject: context.auth.uid }, rateLimit.LIMITS.parcelQuoteUid),
      Object.assign({ scope: "parcelQuoteIp", subject: rateLimit.clientIp(context.rawRequest) }, rateLimit.LIMITS.parcelQuoteIp),
    ], functions.logger);
    if (!rl.ok) throw new functions.https.HttpsError("resource-exhausted", "Too many price checks. Please wait a few minutes.");
    try {
      const q = await quoteParcel(data && data.details, { route: mapsRoute, now: () => Date.now() });
      return { total: q.total, breakdown: q.breakdown };
    } catch (e) {
      if (e instanceof pp.ParcelError) throw new functions.https.HttpsError("invalid-argument", e.message);
      functions.logger.error("parcel_quote_error", { message: String(e && e.message).slice(0, 120) });
      throw new functions.https.HttpsError("internal", "Could not price this parcel. Please try again.");
    }
  });

exports.createParcelRazorpayOrder = functions
  .region(REGION)
  .runWith({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, GOOGLE_MAPS_KEY] })
  .https.onRequest((req, res) => cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    const out = await handleCreateParcelOrder(req, {
      verifyIdToken: (t) => admin.auth().verifyIdToken(t),
      db: admin.firestore(),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      now: () => Date.now(),
      logger: functions.logger,
      rateLimit: (uid, r) => rateLimit.consumeAll(admin.firestore(), [
        Object.assign({ scope: "serviceOrderUid", subject: uid }, rateLimit.LIMITS.serviceOrderUid),
        Object.assign({ scope: "serviceOrderIp", subject: rateLimit.clientIp(r) }, rateLimit.LIMITS.serviceOrderIp),
      ], functions.logger),
      recordFailure: (source, code) => opsAlerts.recordFailure(admin.firestore(), source, code),
      route: mapsRoute,
      createOrder: (o) => razorpay.orders.create(o),
    });
    return res.status(out.status).json(out.body);
  }));

exports._parcel = { handleCreateParcelOrder, quoteParcel, PARCEL_RETIRED, PARCEL_RETIRED_MSG };
