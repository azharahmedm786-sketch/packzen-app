/**
 * PackZen — R3: Razorpay webhook + reconciliation (move bookings)
 * ----------------------------------------------------------------
 * Pure logic with injected I/O (see index.js for wiring).
 *
 * State model: reuses Phase 1 exactly.
 *   pendingPayments/{orderId}.status : created → authorized → consumed
 *                                      created/authorized → failed | expired | needs_review
 *   "Captured always wins": a captured payment finalizes the booking from ANY
 *   non-consumed pending status (a failed attempt can be followed by a
 *   successful one on the same order; an "expired" order can still capture).
 *   bookings/{orderId} is created ONLY through move-payment.finalizeCapture.
 *
 * Dedup: razorpayWebhookEvents/{x-razorpay-event-id}. Handlers are idempotent,
 * so a retry of an event that crashed mid-way is safe to re-run.
 *
 * Never stored or logged: raw payloads (they contain customer email/contact),
 * signatures, secrets.
 */
"use strict";

const crypto = require("crypto");
const mp = require("./move-payment");
const refunds = require("./payment-refund");

const EVENTS_COLLECTION = "razorpayWebhookEvents";
const SUPPORTED = new Set([
  "payment.authorized", "payment.captured", "payment.failed", "order.paid",
  "refund.created", "refund.processed", "refund.failed",
]);
const TERMINAL_EVENT_STATES = new Set(["processed", "ignored", "unmatched", "mismatch", "conflict", "needs_review"]);
const RE_ORDER = /^order_[A-Za-z0-9]{6,40}$/;
const RE_PAY = /^pay_[A-Za-z0-9]{6,40}$/;
const RE_RFND = /^rfnd_[A-Za-z0-9]{6,40}$/;

/* ── signature (constant time) ── */
function webhookSignatureValid(rawBody, signature, secret) {
  if (!secret || !rawBody || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function header(req, name) {
  const h = req.headers || {};
  return h[name] || h[name.toLowerCase()] || null;
}

/* Extract only the fields we use — never the whole entity. */
function pickPayment(entity) {
  if (!entity || typeof entity !== "object") return null;
  return {
    id: entity.id, order_id: entity.order_id, status: entity.status,
    amount: Number(entity.amount), currency: entity.currency,
    error_code: typeof entity.error_code === "string" ? entity.error_code.slice(0, 60) : null,
  };
}
function pickRefund(entity) {
  if (!entity || typeof entity !== "object") return null;
  const notes = entity.notes && typeof entity.notes === "object" ? entity.notes : {};
  return {
    id: entity.id, payment_id: entity.payment_id, status: entity.status, amount: Number(entity.amount),
    notes: { bookingId: typeof notes.bookingId === "string" ? notes.bookingId : null,
             requestId: typeof notes.requestId === "string" ? notes.requestId : null },
  };
}

/* ═══ captured payment (webhook OR reconciliation) ═══ */
async function applyCapturedPayment(deps, pay, via) {
  const logger = deps.logger || console;
  const db = deps.db;
  const orderId = pay.order_id;
  const booking = await db.collection(mp.BOOKING_COLLECTION).doc(orderId).get();
  if (booking.exists) {
    const b = booking.data();
    if (b.paymentId !== pay.id) {
      logger.error("rzp_capture_conflict", { orderId, payment: mp.maskId(pay.id) });
      return "conflict";
    }
    if (!b.webhookConfirmedAt && via === "webhook") {
      await db.collection(mp.BOOKING_COLLECTION).doc(orderId).update({ webhookConfirmedAt: deps.serverTimestamp() });
    }
    return "processed";
  }

  const pSnap = await db.collection(mp.PENDING_COLLECTION).doc(orderId).get();
  if (!pSnap.exists) return "unmatched"; // not a move order (or catalog flow) — left for manual reconciliation
  const p = pSnap.data();
  if (!p.uid) {
    await db.collection(mp.PENDING_COLLECTION).doc(orderId).update({ status: "needs_review", reviewReason: "legacy_no_uid", capturedPaymentId: pay.id, lastEventAt: deps.serverTimestamp() });
    return "needs_review";
  }
  if (pay.currency !== (p.currency || "INR") || pay.amount !== Number(p.payNow) * 100) {
    await db.collection(mp.PENDING_COLLECTION).doc(orderId).update({ status: "needs_review", reviewReason: "amount_or_currency_mismatch", capturedPaymentId: pay.id, lastEventAt: deps.serverTimestamp() });
    logger.error("rzp_capture_mismatch", { orderId, payment: mp.maskId(pay.id) });
    return "mismatch";
  }

  const outcome = await mp.finalizeCapture(deps, { orderId, paymentId: pay.id, amountPaise: pay.amount, expectedUid: null, via });
  if (outcome.existing) return outcome.existing.paymentId === pay.id ? "processed" : "conflict";
  if (outcome.created) {
    logger.info("rzp_booking_finalized", { orderId, via, payment: mp.maskId(pay.id) });
    if (deps.sendConfirmation && outcome.created.email) {
      const b = outcome.created;
      try {
        await deps.sendConfirmation({ bookingRef: b.bookingRef, customerName: b.customerName || "Customer", customerEmail: b.email,
          pickup: b.pickup, drop: b.drop, date: b.date, total: b.total, paymentStatus: b.paymentStatus });
      } catch (e) { logger.warn("rzp_confirmation_email_failed", { orderId }); }
    }
    return "processed";
  }
  return outcome.legacy ? "needs_review" : "unmatched";
}

/* Non-captured payment states only ever move a NON-consumed pending doc. */
async function applyPendingStatus(deps, pay, newStatus) {
  const db = deps.db;
  const ref = db.collection(mp.PENDING_COLLECTION).doc(pay.order_id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "unmatched";
    const p = snap.data();
    if (p.status === "consumed" || p.status === "needs_review") return "processed"; // capture already won / human owns it
    if (newStatus === "failed" && p.status === "authorized" && p.lastPaymentId && p.lastPaymentId !== pay.id) return "processed"; // another attempt is ahead
    tx.update(ref, { status: newStatus, lastPaymentId: pay.id, lastErrorCode: pay.error_code || null, lastEventAt: deps.serverTimestamp() });
    return "processed";
  });
}

/* ═══ webhook HTTP handler ═══
   deps: { db, serverTimestamp(), webhookSecret, logger, sendConfirmation? } */
async function handleWebhook(req, deps) {
  const logger = deps.logger || console;
  const raw = req.rawBody;
  if (!raw || !webhookSignatureValid(raw, header(req, "x-razorpay-signature"), deps.webhookSecret)) {
    logger.warn("rzp_webhook_bad_signature", {});
    return { status: 400, body: { ok: false } };
  }
  let evt;
  try { evt = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw)); } catch (e) {
    return { status: 400, body: { ok: false } };
  }
  if (!evt || typeof evt.event !== "string" || !evt.payload || typeof evt.payload !== "object") return { status: 400, body: { ok: false } };

  const eventId = String(header(req, "x-razorpay-event-id") || ("sha256_" + crypto.createHash("sha256").update(raw).digest("hex"))).slice(0, 128);
  if (!/^[A-Za-z0-9_\-]+$/.test(eventId)) return { status: 400, body: { ok: false } };

  const db = deps.db;
  const evRef = db.collection(EVENTS_COLLECTION).doc(eventId);
  const claim = await db.runTransaction(async (tx) => {
    const s = await tx.get(evRef);
    if (s.exists && TERMINAL_EVENT_STATES.has(s.data().status)) return "duplicate";
    tx.set(evRef, { event: evt.event, status: "processing", attempts: ((s.exists && s.data().attempts) || 0) + 1, receivedAt: deps.serverTimestamp() });
    return "claimed";
  });
  if (claim === "duplicate") return { status: 200, body: { ok: true, duplicate: true } };

  let result = "ignored";
  const ids = {};
  try {
    if (!SUPPORTED.has(evt.event)) {
      result = "ignored";
    } else if (evt.event.startsWith("refund.")) {
      const rf = pickRefund(evt.payload.refund && evt.payload.refund.entity);
      if (!rf || !RE_RFND.test(String(rf.id)) || !RE_PAY.test(String(rf.payment_id)) || !(rf.amount > 0)) return await finish(400, "ignored");
      ids.refundId = rf.id; ids.paymentId = rf.payment_id;
      result = await refunds.applyRefundEvent(deps, rf, evt.event);
    } else {
      const pay = pickPayment(evt.payload.payment && evt.payload.payment.entity);
      if (!pay || !RE_PAY.test(String(pay.id)) || !RE_ORDER.test(String(pay.order_id)) || !(pay.amount > 0) || typeof pay.currency !== "string") {
        return await finish(400, "ignored");
      }
      ids.orderId = pay.order_id; ids.paymentId = pay.id;
      if (evt.event === "payment.captured" || evt.event === "order.paid") {
        if (pay.status !== "captured") result = await applyPendingStatus(deps, pay, "authorized");
        else result = await applyCapturedPayment(deps, pay, "webhook");
      } else if (evt.event === "payment.authorized") {
        result = await applyPendingStatus(deps, pay, "authorized");
      } else if (evt.event === "payment.failed") {
        result = await applyPendingStatus(deps, pay, "failed");
      }
    }
  } catch (e) {
    // Transient (Firestore/network): leave event "processing" so Razorpay's retry re-runs it.
    logger.error("rzp_webhook_error", { event: evt.event, eventId, message: String(e && e.message).slice(0, 120) });
    if (deps.recordFailure) await deps.recordFailure("razorpayWebhook", "processing_error");
    return { status: 500, body: { ok: false } };
  }
  return finish(200, result);

  async function finish(status, state) {
    await evRef.update(Object.assign({ status: state, processedAt: deps.serverTimestamp() }, ids));
    logger.info("rzp_webhook_" + state, { event: evt.event, eventId, orderId: ids.orderId || null, refund: ids.refundId || null });
    return { status, body: { ok: status === 200, status: state } };
  }
}

function toMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/* ═══ scheduled reconciliation ═══
   For pending move payments still not consumed after `minAgeMs`, ask Razorpay
   what actually happened to the order and apply the same deterministic rules.
   deps: { db, serverTimestamp(), now(), fetchOrderPayments(orderId) → [payment], logger, sendConfirmation? } */
async function reconcilePendingPayments(deps, opts) {
  const logger = deps.logger || console;
  const o = Object.assign({ minAgeMs: 15 * 60 * 1000, limit: 100 }, opts || {});
  const now = deps.now();
  const snap = await deps.db.collection(mp.PENDING_COLLECTION).where("status", "in", ["created", "authorized", "failed"]).limit(o.limit).get();
  const summary = { scanned: 0, finalized: 0, authorized: 0, failed: 0, expired: 0, needsReview: 0, skippedYoung: 0, errors: 0 };
  for (const doc of snap.docs) {
    const p = doc.data();
    const created = toMs(p.createdAt);
    if (created !== null && now - created < o.minAgeMs) { summary.skippedYoung++; continue; }
    summary.scanned++;
    try {
      const payments = (await deps.fetchOrderPayments(doc.id) || []).map(pickPayment).filter((x) => x && x.order_id === doc.id);
      const captured = payments.find((x) => x.status === "captured");
      if (captured) {
        const r = await applyCapturedPayment(deps, captured, "reconciliation");
        if (r === "processed") summary.finalized++; else summary.needsReview++;
        continue;
      }
      const authorized = payments.find((x) => x.status === "authorized");
      if (authorized) { await applyPendingStatus(deps, authorized, "authorized"); summary.authorized++; continue; }
      const expiresAt = toMs(p.expiresAt);
      if (expiresAt !== null && now > expiresAt) {
        await deps.db.runTransaction(async (tx) => {
          const s = await tx.get(doc.ref || deps.db.collection(mp.PENDING_COLLECTION).doc(doc.id));
          if (s.exists && ["created", "failed"].includes(s.data().status)) tx.update(doc.ref || deps.db.collection(mp.PENDING_COLLECTION).doc(doc.id), { status: "expired", lastEventAt: deps.serverTimestamp() });
        });
        summary.expired++;
      } else if (payments.some((x) => x.status === "failed")) {
        summary.failed++;
      }
    } catch (e) {
      summary.errors++;
      logger.warn("rzp_reconcile_order_error", { orderId: doc.id, message: String(e && e.message).slice(0, 120) });
      if (deps.recordFailure) await deps.recordFailure("reconcileRazorpayPayments", "order_error");
    }
  }
  logger.info("rzp_reconcile_summary", summary);
  return summary;
}

module.exports = { handleWebhook, reconcilePendingPayments, _internal: { webhookSignatureValid, applyCapturedPayment, applyPendingStatus, pickPayment, pickRefund, EVENTS_COLLECTION } };
