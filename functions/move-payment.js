/**
 * PackZen — Move payment core (Phase 1: payment correctness)
 * -----------------------------------------------------------
 * Pure handler logic for the move-booking Razorpay flow. index.js wires these
 * handlers to HTTPS functions; all I/O is injected so the logic is testable
 * without Firebase or Razorpay.
 *
 * Fixes: I-07 (auth on both calls), I-06a (total/paid/balanceDue),
 * I-06b (customerUid + verified email), R2-01 (transactional, idempotent,
 * deterministic booking id), R3-07 (constant-time signature check),
 * N-05 (payment fetched and must be captured), R2-21 (generic client errors),
 * R2-05 (no PII in logs).
 *
 * Modelled on catalog-booking.js verifyServiceRazorpayPayment.
 */
"use strict";

const crypto = require("crypto");

const PENDING_COLLECTION = "pendingPayments";
const BOOKING_COLLECTION = "bookings";
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENCY = "INR";
const MAX_ONLINE_AMOUNT = 100000; // ₹, unchanged from the previous limit

const RE = {
  requestId: /^[A-Za-z0-9_-]{8,64}$/,
  orderId: /^order_[A-Za-z0-9]{6,40}$/,
  paymentId: /^pay_[A-Za-z0-9]{6,40}$/,
  signature: /^[a-f0-9]{64}$/i,
  phone: /^\d{10}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
};

/* ── Errors: public message is safe to show; detail goes to logs only ── */
class PaymentError extends Error {
  constructor(status, code, publicMessage, logDetail) {
    super(code);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.logDetail = logDetail || null;
  }
}

const MSG = {
  auth: "Please sign in again to continue.",
  forbidden: "This payment belongs to a different account.",
  input: "Some booking details are missing or invalid. Please check the form and try again.",
  quote: "We couldn't price this move. Please check the addresses and details, then recalculate.",
  server: "Something went wrong on our side. Please try again in a moment.",
  verifyMismatch: "We couldn't verify this payment. If money was deducted, don't pay again — contact us with your payment ID.",
  verifyPending: "Your payment was received and is being confirmed. Please don't pay again.",
  verifyUnavailable: "We're confirming your payment. Please don't pay again.",
  notSuccessful: "This payment was not completed. No booking was created.",
};

/* ── Helpers ──────────────────────────────────────────────────── */
function maskId(id) {
  const s = String(id || "");
  return s.length > 4 ? "…" + s.slice(-4) : "****";
}

function expectedSignature(orderId, paymentId, secret) {
  return crypto.createHmac("sha256", secret).update(orderId + "|" + paymentId).digest("hex");
}

// R3-07: constant-time comparison; length mismatch rejected without timingSafeEqual throwing.
function signatureMatches(orderId, paymentId, signature, secret) {
  if (!secret || typeof signature !== "string") return false;
  const a = Buffer.from(expectedSignature(orderId, paymentId, secret), "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function authenticate(req, verifyIdToken) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  if (!h.startsWith("Bearer ")) throw new PaymentError(401, "unauthenticated", MSG.auth, "missing bearer token");
  const token = h.slice(7).trim();
  if (!token) throw new PaymentError(401, "unauthenticated", MSG.auth, "empty bearer token");
  let decoded;
  try { decoded = await verifyIdToken(token); } catch (e) {
    throw new PaymentError(401, "unauthenticated", MSG.auth, "token verification failed");
  }
  if (!decoded || !decoded.uid) throw new PaymentError(401, "unauthenticated", MSG.auth, "token without uid");
  return {
    uid: decoded.uid,
    // Only a verified email is ever used for customer communication.
    email: decoded.email && decoded.email_verified === true ? String(decoded.email).toLowerCase() : null,
    emailVerified: decoded.email_verified === true,
  };
}

function cleanString(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

/**
 * Optional, purely descriptive booking details sent with the paid move order
 * (time slot, notes, add-on requests) — the same fields the pay-later form
 * stores. Allow-listed and length-capped; anything else is dropped. None of
 * these are used for pricing; the server quote remains authoritative.
 */
function sanitizeDetails(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  const str = (k, max) => { const v = cleanString(d[k], max); if (v) out[k] = v; };
  const bool = (k) => { if (d[k] === true) out[k] = true; };
  const alt = typeof d.altPhone === "string" ? d.altPhone.trim() : "";
  if (RE.phone.test(alt)) out.altPhone = alt; // exactly 10 digits, never truncated
  str("shiftTime", 40); str("shiftTimeLabel", 60); str("house", 60);
  str("fragileItems", 300); str("specialItems", 300); str("remarks", 500);
  bool("unpackingService"); bool("dismantling"); bool("assembly"); bool("storageNeeded");
  const days = Number(d.storageDays);
  if (out.storageNeeded && Number.isInteger(days) && days > 0 && days <= 365) out.storageDays = days;
  return out;
}

/**
 * Amounts from the server quote ONLY. grandTotal is the price of the move;
 * payNow is what this Razorpay order charges. Minimum-charge floors are
 * unchanged from the previous computePayAmount().
 */
function computeAmounts(quote, paymentType) {
  const opts = quote && quote.valid && quote.paymentOptions;
  if (!opts) throw new PaymentError(400, "invalid_quote", MSG.quote, "quote invalid or missing paymentOptions");
  const grandTotal = Math.round(Number(opts.grandTotal != null ? opts.grandTotal : quote.finalTotal));
  let payNow;
  if (paymentType === "full") payNow = Math.max(Number(opts.fullOnlineAmount), 500);
  else if (paymentType === "advance") payNow = Math.max(Number(opts.advanceAmount), 199);
  else throw new PaymentError(400, "invalid_payment_type", MSG.input, "bad paymentType");
  payNow = Math.round(payNow);
  if (!Number.isFinite(grandTotal) || grandTotal <= 0) throw new PaymentError(400, "invalid_quote", MSG.quote, "non-positive grandTotal");
  if (!Number.isFinite(payNow) || payNow <= 0 || payNow > MAX_ONLINE_AMOUNT) throw new PaymentError(400, "invalid_amount", MSG.quote, "payNow out of range");
  return { grandTotal, payNow };
}

/**
 * Booking money fields. `total` is always the quoted move price.
 * full    → balanceDue 0; any difference is the online-payment discount.
 * advance → balanceDue = total − paid (never negative).
 */
function bookingMoney({ grandTotal, paid, paymentType }) {
  const total = Math.round(Number(grandTotal));
  const p = Math.round(Number(paid));
  if (paymentType === "full") {
    return { total, paid: p, balanceDue: 0, fullPaymentDiscount: Math.max(0, total - p), paymentStatus: "paid" };
  }
  const balanceDue = Math.max(0, total - p);
  return { total, paid: p, balanceDue, fullPaymentDiscount: 0, paymentStatus: balanceDue === 0 ? "paid" : "partially_paid" };
}

function bookingRefFromOrder(orderId) {
  return "PKZ-" + String(orderId).slice(-8).toUpperCase();
}

function respondError(err, logger, event, ctx) {
  if (err instanceof PaymentError) {
    logger.warn(event + "_rejected", Object.assign({ code: err.code, detail: err.logDetail }, ctx || {}));
    return { status: err.status, body: { success: false, code: err.code, error: err.publicMessage } };
  }
  logger.error(event + "_error", Object.assign({ message: err && err.message ? String(err.message).slice(0, 200) : "unknown" }, ctx || {}));
  return { status: 500, body: { success: false, code: "server_error", error: MSG.server } };
}

/* ═══════════════════════════════════════════════════════════════
   createRazorpayOrder
   deps: { verifyIdToken, quote(quoteInput, pickup, drop) → quote (may mutate input),
           normalize(quoteInput) → sanitized input, createOrder({amount,currency,receipt,notes}),
           db, serverTimestamp(), now(), logger }
   ═══════════════════════════════════════════════════════════════ */
async function handleCreateOrder(req, deps) {
  const logger = deps.logger || console;
  let ctx = {};
  try {
    const user = await authenticate(req, deps.verifyIdToken);
    ctx = { uid: user.uid };
    const body = req.body || {};

    const paymentType = body.paymentType;
    if (paymentType !== "full" && paymentType !== "advance") throw new PaymentError(400, "invalid_payment_type", MSG.input, "paymentType");
    if (!body.quoteInput || typeof body.quoteInput !== "object" || Array.isArray(body.quoteInput)) throw new PaymentError(400, "invalid_input", MSG.input, "quoteInput");
    const requestId = typeof body.requestId === "string" && RE.requestId.test(body.requestId) ? body.requestId : null;
    if (!requestId) throw new PaymentError(400, "invalid_input", MSG.input, "requestId");

    const details = {
      customerName: cleanString(body.customerName, 80),
      phone: cleanString(body.phone, 10),
      moveType: cleanString(body.moveType, 40),
      pickup: cleanString(body.pickup, 300),
      drop: cleanString(body.drop, 300),
      date: cleanString(body.date, 10),
    };
    if (!details.customerName || !RE.phone.test(details.phone) || !details.pickup || !details.drop || !RE.date.test(details.date)) {
      throw new PaymentError(400, "invalid_input", MSG.input, "booking details");
    }

    // Price of record: server quote on a private copy of the input. Nothing
    // from the client (total, amount, email, uid) is read.
    const quoteInput = JSON.parse(JSON.stringify(body.quoteInput));
    let quote;
    try { quote = await deps.quote(quoteInput, details.pickup, details.drop); } catch (e) {
      throw new PaymentError(400, "invalid_quote", MSG.quote, "quote failed: " + String(e && e.message).slice(0, 120));
    }
    const { grandTotal, payNow } = computeAmounts(quote, paymentType);
    const normalizedInput = deps.normalize ? deps.normalize(quoteInput) : quoteInput;

    const nowMs = deps.now();
    const order = await deps.createOrder({
      amount: payNow * 100,
      currency: CURRENCY,
      receipt: "receipt_" + nowMs,
      notes: { uid: user.uid, requestId, flow: "move" },
    });
    if (!order || !order.id || Number(order.amount) !== payNow * 100 || order.currency !== CURRENCY) {
      throw new Error("order creation returned unexpected data");
    }
    ctx.orderId = order.id;

    await deps.db.collection(PENDING_COLLECTION).doc(order.id).set({
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      orderId: order.id,
      requestId,
      paymentType,
      grandTotal,
      payNow,
      amount: payNow, // legacy field name kept for any existing reader
      currency: CURRENCY,
      quoteInput: normalizedInput,
      quoteBreakdown: quote.breakdown || null,
      customerName: details.customerName,
      phone: details.phone,
      moveType: details.moveType,
      pickup: details.pickup,
      drop: details.drop,
      date: details.date,
      details: sanitizeDetails(body.details),
      status: "created",
      createdAt: deps.serverTimestamp(),
      expiresAt: new Date(nowMs + ORDER_TTL_MS),
    });

    logger.info("move_order_created", { uid: user.uid, orderId: order.id, paymentType, payNow, grandTotal });
    return {
      status: 200,
      body: {
        success: true,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        paymentType,
        payNow,
        grandTotal,
        serverCalculatedTotal: payNow,
      },
    };
  } catch (err) {
    return respondError(err, logger, "move_order", ctx);
  }
}

/* ═══════════════════════════════════════════════════════════════
   verifyRazorpayPayment
   deps: { verifyIdToken, keySecret, fetchPayment(paymentId), db, serverTimestamp(),
           sendConfirmation(data) (optional, non-blocking), logger }
   ═══════════════════════════════════════════════════════════════ */
function existingResponse(b, uid, paymentId) {
  if (b.customerUid !== uid) throw new PaymentError(403, "forbidden", MSG.forbidden, "booking owned by another uid");
  if (b.paymentId !== paymentId) throw new PaymentError(409, "payment_mismatch", MSG.verifyMismatch, "order already booked with a different payment");
  return {
    status: 200,
    body: {
      success: true, duplicate: true, bookingRef: b.bookingRef, bookingId: b.orderId,
      total: b.total, paid: b.paid, balanceDue: b.balanceDue, paymentType: b.paymentType, paymentStatus: b.paymentStatus,
    },
  };
}

/**
 * Single authoritative "captured payment → booking" transition, used by
 * browser verification (Phase 1), the Razorpay webhook and reconciliation (R3).
 * Idempotent: booking id = orderId; if it already exists it is returned untouched.
 * Callers MUST have already confirmed the payment is captured and that its
 * amount/currency match the pending payment.
 * Returns {existing} | {created} | {missing} | {legacy} | {forbidden}.
 */
async function finalizeCapture(deps, { orderId, paymentId, amountPaise, expectedUid, via }) {
  const db = deps.db;
  const bookingRef = db.collection(BOOKING_COLLECTION).doc(orderId);
  const pendingRef = db.collection(PENDING_COLLECTION).doc(orderId);
  return db.runTransaction(async (tx) => {
      const bSnap = await tx.get(bookingRef);
      if (bSnap.exists) return { existing: bSnap.data() };
      const pSnap = await tx.get(pendingRef);
      if (!pSnap.exists) return { missing: true };
      const p = pSnap.data();
      if (!p.uid) return { legacy: true };
      if (expectedUid && p.uid !== expectedUid) return { forbidden: true };

      const money = bookingMoney({ grandTotal: p.grandTotal, paid: amountPaise / 100, paymentType: p.paymentType });
      const qi = p.quoteInput || {};
      const qb = p.quoteBreakdown || {};
      // Descriptive details first, so every authoritative field below wins.
      const booking = Object.assign({}, sanitizeDetails(p.details), {
        bookingRef: bookingRefFromOrder(orderId),
        customerUid: p.uid,
        email: p.email || null,
        customerName: p.customerName || "",
        phone: p.phone || "",
        pickup: p.pickup || "",
        drop: p.drop || "",
        date: p.date || "",
        moveType: p.moveType || "",
        paymentType: p.paymentType,
        currency: p.currency || CURRENCY,
        paymentId,
        orderId,
        requestId: p.requestId || null,
        source: "payment",
        confirmedVia: via || "verify",
        status: "confirmed",
        vehicleId: qi.vehicleId || "",
        vehicleUsed: qb.vehicleUsed || "",
        furniture: qi.furniture || {},
        cartonQty: qi.cartonQty || 0,
        pickupFloor: qi.pickupFloor || 0,
        dropFloor: qi.dropFloor || 0,
        liftAvailable: !!qi.liftAvailable,
        packingService: !!qi.packingService,
        distance: qi.km || 0,
        quoteBreakdown: p.quoteBreakdown || null,
        createdAt: deps.serverTimestamp(),
        paidAt: deps.serverTimestamp(),
      }, money);

      if (typeof tx.create === "function") tx.create(bookingRef, booking); else tx.set(bookingRef, booking);
      tx.update(pendingRef, { status: "consumed", bookingId: orderId, paymentId, consumedAt: deps.serverTimestamp() });
      return { created: booking };
      });
}

async function handleVerifyPayment(req, deps) {
  const logger = deps.logger || console;
  let ctx = {};
  try {
    const user = await authenticate(req, deps.verifyIdToken);
    ctx = { uid: user.uid };
    const body = req.body || {};
    const orderId = body.razorpay_order_id;
    const paymentId = body.razorpay_payment_id;
    const signature = body.razorpay_signature;
    if (typeof orderId !== "string" || !RE.orderId.test(orderId) ||
        typeof paymentId !== "string" || !RE.paymentId.test(paymentId) ||
        typeof signature !== "string" || !RE.signature.test(signature)) {
      throw new PaymentError(400, "invalid_input", MSG.verifyMismatch, "malformed payment identifiers");
    }
    ctx.orderId = orderId; ctx.payment = maskId(paymentId);

    if (!signatureMatches(orderId, paymentId, signature, deps.keySecret)) {
      throw new PaymentError(400, "invalid_signature", MSG.verifyMismatch, "signature mismatch");
    }

    const db = deps.db;
    const bookingRef = db.collection(BOOKING_COLLECTION).doc(orderId);
    const pendingRef = db.collection(PENDING_COLLECTION).doc(orderId);

    // Fast path: already booked (retry / double submit).
    const existing = await bookingRef.get();
    if (existing.exists) return existingResponse(existing.data(), user.uid, paymentId);

    const pendingSnap = await pendingRef.get();
    if (!pendingSnap.exists) throw new PaymentError(409, "order_not_found", MSG.verifyMismatch, "no pending payment for order");
    const pending = pendingSnap.data();
    if (!pending.uid) throw new PaymentError(409, "legacy_order", MSG.verifyMismatch, "pending payment has no uid (pre-Phase-1 order)");
    if (pending.uid !== user.uid) throw new PaymentError(403, "forbidden", MSG.forbidden, "uid mismatch");
    if (pending.orderId && pending.orderId !== orderId) throw new PaymentError(400, "order_mismatch", MSG.verifyMismatch, "pending orderId mismatch");

    // N-05: confirm with Razorpay that this exact payment was captured.
    let payment;
    try { payment = await deps.fetchPayment(paymentId); } catch (e) {
      throw new PaymentError(503, "verification_unavailable", MSG.verifyUnavailable, "payment fetch failed");
    }
    if (!payment || payment.id !== paymentId) throw new PaymentError(400, "payment_mismatch", MSG.verifyMismatch, "payment id mismatch");
    if (payment.order_id !== orderId) throw new PaymentError(400, "order_mismatch", MSG.verifyMismatch, "payment belongs to another order");
    if (payment.currency !== (pending.currency || CURRENCY)) throw new PaymentError(400, "currency_mismatch", MSG.verifyMismatch, "currency mismatch");
    if (Number(payment.amount) !== Number(pending.payNow) * 100) throw new PaymentError(400, "amount_mismatch", MSG.verifyMismatch, "amount mismatch");
    if (payment.status === "authorized") throw new PaymentError(202, "payment_not_captured", MSG.verifyPending, "payment authorized, not captured");
    if (payment.status !== "captured") throw new PaymentError(400, "payment_not_successful", MSG.notSuccessful, "payment status " + String(payment.status).slice(0, 20));

    // R2-01: one transaction decides the outcome; booking id = order id.
    // Shared with the R3 webhook/reconciliation path (finalizeCapture).
    const outcome = await finalizeCapture(deps, {
      orderId, paymentId, amountPaise: Number(payment.amount), expectedUid: user.uid, via: "verify",
    });

    if (outcome.existing) return existingResponse(outcome.existing, user.uid, paymentId);
    if (outcome.forbidden) throw new PaymentError(403, "forbidden", MSG.forbidden, "uid mismatch in txn");
    if (outcome.legacy) throw new PaymentError(409, "legacy_order", MSG.verifyMismatch, "pending payment has no uid (txn)");
    if (outcome.missing) throw new PaymentError(409, "order_not_found", MSG.verifyMismatch, "pending vanished without booking");

    const b = outcome.created;
    logger.info("move_payment_verified", { uid: user.uid, orderId, payment: maskId(paymentId), paymentType: b.paymentType, paid: b.paid, balanceDue: b.balanceDue });

    if (deps.sendConfirmation && b.email) {
      try {
        await deps.sendConfirmation({
          bookingRef: b.bookingRef, customerName: b.customerName || "Customer", customerEmail: b.email,
          pickup: b.pickup, drop: b.drop, date: b.date, total: b.total, paymentStatus: b.paymentStatus,
        });
      } catch (e) {
        logger.warn("move_payment_email_failed", { orderId });
      }
    }

    return {
      status: 200,
      body: {
        success: true, bookingRef: b.bookingRef, bookingId: orderId,
        total: b.total, paid: b.paid, balanceDue: b.balanceDue, paymentType: b.paymentType, paymentStatus: b.paymentStatus,
      },
    };
  } catch (err) {
    return respondError(err, logger, "move_verify", ctx);
  }
}

module.exports = {
  handleCreateOrder,
  handleVerifyPayment,
  finalizeCapture,
  bookingMoney,
  PENDING_COLLECTION,
  BOOKING_COLLECTION,
  maskId,
  // exported for tests
  _internal: { sanitizeDetails, signatureMatches, expectedSignature, computeAmounts, bookingMoney, bookingRefFromOrder, maskId, PaymentError, MSG },
};
