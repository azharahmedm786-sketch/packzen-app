/**
 * PackZen — R3: admin refunds + refund state (Razorpay)
 * ------------------------------------------------------
 * Refund records: paymentRefunds/{recordId}
 *   recordId = `${bookingId}__${requestId}` for admin-initiated refunds
 *            = `rzp_${refundId}`            for refunds first seen via webhook
 *              (e.g. issued manually in the Razorpay Dashboard)
 *   paymentRefundsByRzp/{rfnd_…} → { recordId }  (lookup for webhooks)
 *
 * Record status: requested → (created|pending) → processed | failed
 *                requested → unknown (API outcome unknown; stays reserved
 *                until a webhook resolves it — never silently released)
 *
 * Booking fields (all derived, recomputed in the same transaction):
 *   refundRecordIds[], refundedPaise, refundPendingPaise, refundedAmount,
 *   refundPendingAmount, refundAmount (legacy = refundedAmount, used by the
 *   existing "refund processed" notification), refundStatus
 *   ("pending" | "processed" | "failed"), preRefundPaymentStatus,
 *   paymentStatus ("partially_refunded" | "refunded" | pre-refund value).
 * `paid`, `total`, `balanceDue` are NOT changed: `paid` stays the captured amount.
 *
 * Nothing here runs automatically against live bookings: refunds only start
 * from the admin-only callable; webhooks only record what Razorpay reports.
 */
"use strict";

const REFUNDS = "paymentRefunds";
const BY_RZP = "paymentRefundsByRzp";
const BOOKINGS = "bookings";
const RESERVING = new Set(["requested", "created", "pending", "unknown"]);
const TERMINAL = new Set(["processed", "failed"]);
const RANK = { requested: 0, unknown: 0, created: 1, pending: 1, processed: 2, failed: 2 };
const REFUNDABLE_STATUSES = new Set(["paid", "partially_paid", "partially_refunded"]);

const RE = { requestId: /^[A-Za-z0-9_-]{8,64}$/, bookingId: /^[A-Za-z0-9_-]{6,128}$/, paymentId: /^pay_[A-Za-z0-9]{6,40}$/ };

class RefundError extends Error {
  constructor(code, message, detail) { super(code); this.code = code; this.publicMessage = message; this.detail = detail || null; }
}

function mapRzpStatus(s) { return s === "processed" ? "processed" : s === "failed" ? "failed" : "pending"; }

/** Derived booking refund fields from the full set of refund records. */
function deriveRefundState(booking, records) {
  const paidPaise = Math.round(Number(booking.paid) * 100);
  let refunded = 0, pending = 0, anyFailed = false;
  for (const r of records) {
    if (r.status === "processed") refunded += r.amountPaise;
    else if (RESERVING.has(r.status)) pending += r.amountPaise;
    else if (r.status === "failed") anyFailed = true;
  }
  const pre = booking.preRefundPaymentStatus || booking.paymentStatus || null;
  const totalOut = refunded + pending;
  const out = {
    refundedPaise: refunded, refundPendingPaise: pending,
    refundedAmount: refunded / 100, refundPendingAmount: pending / 100, refundAmount: refunded / 100,
    refundStatus: pending > 0 ? "pending" : refunded > 0 ? "processed" : anyFailed ? "failed" : (booking.refundStatus || null),
    preRefundPaymentStatus: pre,
    paymentStatus: totalOut >= paidPaise && paidPaise > 0 ? "refunded" : totalOut > 0 ? "partially_refunded" : pre,
  };
  return { fields: out, refundablePaise: Math.max(0, paidPaise - refunded - pending) };
}

async function readRecords(tx, db, ids) {
  const out = [];
  for (const id of ids || []) {
    const s = await tx.get(db.collection(REFUNDS).doc(id));
    if (s.exists) out.push(Object.assign({ _id: id }, s.data()));
  }
  return out;
}
function withRecord(records, id, data) {
  return records.filter((r) => r._id !== id).concat([Object.assign({ _id: id }, data)]);
}

/* ═══ admin callable ═══
   data: { bookingId, paymentId, amount (₹, ≤2 decimals) | full:true, reason, requestId }
   deps: { db, serverTimestamp(), isAdmin(context) → Promise<bool>, createRefund(paymentId, opts) → refund, logger } */
async function handleRefund(data, context, deps) {
  const logger = deps.logger || console;
  const uid = context && context.auth && context.auth.uid;
  const ctx = { uid: uid || null };
  try {
    if (!uid) throw new RefundError("unauthenticated", "Please sign in.");
    if (!(await deps.isAdmin(context))) throw new RefundError("permission-denied", "Only admins can issue refunds.");
    data = data || {};
    const { bookingId, paymentId, requestId } = data;
    const reason = typeof data.reason === "string" ? data.reason.trim().slice(0, 200) : "";
    if (typeof bookingId !== "string" || !RE.bookingId.test(bookingId) || typeof paymentId !== "string" || !RE.paymentId.test(paymentId) ||
        typeof requestId !== "string" || !RE.requestId.test(requestId) || !reason) {
      throw new RefundError("invalid-argument", "Booking, payment, reason and request ID are required.");
    }
    let wantPaise = null;
    if (data.full === true) wantPaise = "full";
    else {
      const amt = Number(data.amount);
      if (!Number.isFinite(amt) || amt <= 0 || Math.round(amt * 100) !== Math.round(amt * 100 * 1e6) / 1e6) throw new RefundError("invalid-argument", "Enter a valid refund amount.");
      wantPaise = Math.round(amt * 100);
    }
    Object.assign(ctx, { bookingId, requestId });

    const db = deps.db;
    const recordId = `${bookingId}__${requestId}`;
    const bookingRef = db.collection(BOOKINGS).doc(bookingId);
    const recordRef = db.collection(REFUNDS).doc(recordId);

    // 1) Reserve the amount atomically (prevents double / concurrent over-refunds).
    const reserved = await db.runTransaction(async (tx) => {
      const existing = await tx.get(recordRef);
      if (existing.exists) return { replay: existing.data() };
      const bSnap = await tx.get(bookingRef);
      if (!bSnap.exists) throw new RefundError("not-found", "Booking not found.");
      const b = bSnap.data();
      if (b.paymentId !== paymentId) throw new RefundError("failed-precondition", "That payment does not belong to this booking.");
      if (typeof b.paid !== "number" || !(b.paid > 0)) throw new RefundError("failed-precondition", "This booking's payment record needs review before it can be refunded.", "no numeric paid (legacy)");
      if ((b.currency || "INR") !== "INR") throw new RefundError("failed-precondition", "Unsupported currency.");
      if (!REFUNDABLE_STATUSES.has(b.paymentStatus)) throw new RefundError("failed-precondition", "This booking has nothing left to refund.", "paymentStatus " + b.paymentStatus);
      const records = await readRecords(tx, db, b.refundRecordIds);
      const { refundablePaise } = deriveRefundState(b, records);
      const amountPaise = wantPaise === "full" ? refundablePaise : wantPaise;
      if (!(amountPaise > 0)) throw new RefundError("failed-precondition", "This booking has nothing left to refund.");
      if (amountPaise > refundablePaise) throw new RefundError("out-of-range", "Refund exceeds the refundable amount.", `requested ${amountPaise} > refundable ${refundablePaise}`);
      const rec = { status: "requested", amountPaise, bookingId, paymentId, orderId: b.orderId || null, reason, requestId,
                    requestedBy: uid, source: "admin", createdAt: deps.serverTimestamp(), updatedAt: deps.serverTimestamp() };
      tx.set(recordRef, rec);
      const ids = (b.refundRecordIds || []).concat([recordId]);
      tx.update(bookingRef, Object.assign({ refundRecordIds: ids, lastRefundAt: deps.serverTimestamp() }, deriveRefundState(b, withRecord(records, recordId, rec)).fields));
      return { amountPaise };
    });

    if (reserved.replay) {
      const r = reserved.replay;
      if (r.status === "requested" || r.status === "unknown") return { ok: true, recordId, status: "in_progress", amount: r.amountPaise / 100 };
      return { ok: r.status !== "failed", recordId, status: r.status, amount: r.amountPaise / 100, duplicate: true };
    }

    // 2) Call Razorpay exactly once per recordId.
    let rz = null, failure = null;
    try {
      rz = await deps.createRefund(paymentId, { amount: reserved.amountPaise, speed: "normal", notes: { bookingId, requestId }, receipt: recordId.slice(0, 40) });
      if (!rz || typeof rz.id !== "string" || Number(rz.amount) !== reserved.amountPaise) throw Object.assign(new Error("unexpected refund response"), { unknownOutcome: true });
    } catch (e) {
      // 4xx from Razorpay = definitively not refunded; anything else = outcome unknown.
      const code = e && (e.statusCode || (e.error && e.error.statusCode));
      failure = (code >= 400 && code < 500 && !e.unknownOutcome) ? "failed" : "unknown";
      logger.warn("refund_api_error", Object.assign({ outcome: failure, statusCode: code || null }, ctx));
    }

    // 3) Record the outcome and recompute booking state atomically.
    const finalStatus = failure || mapRzpStatus(rz.status);
    await db.runTransaction(async (tx) => {
      const rSnap = await tx.get(recordRef);
      const bSnap = await tx.get(bookingRef);
      const cur = rSnap.data();
      if (TERMINAL.has(cur.status)) return; // a webhook already settled it
      const upd = Object.assign({}, cur, { status: finalStatus, updatedAt: deps.serverTimestamp() });
      if (rz) upd.razorpayRefundId = rz.id;
      if (failure) upd.failureReason = failure === "failed" ? "razorpay_rejected" : "outcome_unknown";
      delete upd._id;
      tx.set(recordRef, upd);
      if (rz) tx.set(db.collection(BY_RZP).doc(rz.id), { recordId });
      const b = bSnap.data();
      const records = withRecord(await readRecords(tx, db, b.refundRecordIds), recordId, upd);
      tx.update(bookingRef, deriveRefundState(b, records).fields);
    });

    logger.info("refund_recorded", Object.assign({ status: finalStatus, amountPaise: reserved.amountPaise }, ctx));
    if (failure === "failed") throw new RefundError("aborted", "Razorpay rejected the refund. Nothing was refunded.");
    if (failure === "unknown") throw new RefundError("unavailable", "Refund status is unconfirmed. Do not retry with a new request — it will be reconciled automatically.");
    return { ok: true, recordId, status: finalStatus, amount: reserved.amountPaise / 100 };
  } catch (err) {
    if (err instanceof RefundError) {
      logger.warn("refund_rejected", Object.assign({ code: err.code, detail: err.detail }, ctx));
      throw (deps.toClientError ? deps.toClientError(err.code, err.publicMessage) : err);
    }
    logger.error("refund_error", Object.assign({ message: String(err && err.message).slice(0, 120) }, ctx));
    throw (deps.toClientError ? deps.toClientError("internal", "Refund could not be processed.") : new RefundError("internal", "Refund could not be processed."));
  }
}

/* ═══ webhook refund events (refund.created / processed / failed) ═══ */
async function applyRefundEvent(deps, rf, event) {
  const db = deps.db;
  const newStatus = event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : mapRzpStatus(rf.status);

  let recordId = null;
  const map = await db.collection(BY_RZP).doc(rf.id).get();
  if (map.exists) recordId = map.data().recordId;
  else if (rf.notes.bookingId && rf.notes.requestId) recordId = `${rf.notes.bookingId}__${rf.notes.requestId}`;
  let bookingIdHint = null;
  if (!recordId || !(await db.collection(REFUNDS).doc(recordId).get()).exists) {
    const q = await db.collection(BOOKINGS).where("paymentId", "==", rf.payment_id).limit(2).get();
    if (q.docs.length !== 1) return q.docs.length ? "conflict" : "unmatched";
    bookingIdHint = q.docs[0].id;
    recordId = `rzp_${rf.id}`;
  }
  const recordRef = db.collection(REFUNDS).doc(recordId);

  return db.runTransaction(async (tx) => {
    const rSnap = await tx.get(recordRef);
    const cur = rSnap.exists ? rSnap.data() : null;
    const bookingId = cur ? cur.bookingId : bookingIdHint;
    const bookingRef = db.collection(BOOKINGS).doc(bookingId);
    const bSnap = await tx.get(bookingRef);
    if (!bSnap.exists) return "unmatched";
    const b = bSnap.data();
    if (b.paymentId !== rf.payment_id) return "conflict";
    if (cur && (cur.paymentId !== rf.payment_id || cur.amountPaise !== rf.amount || (cur.razorpayRefundId && cur.razorpayRefundId !== rf.id))) return "conflict";

    let upd;
    if (!cur) {
      upd = { status: newStatus, amountPaise: rf.amount, bookingId, paymentId: rf.payment_id, orderId: b.orderId || null,
              razorpayRefundId: rf.id, source: "razorpay", reason: "recorded_from_webhook", createdAt: deps.serverTimestamp(), updatedAt: deps.serverTimestamp() };
    } else {
      if (TERMINAL.has(cur.status) || RANK[newStatus] < RANK[cur.status]) return "processed"; // stale/duplicate
      upd = Object.assign({}, cur, { status: newStatus, razorpayRefundId: rf.id, updatedAt: deps.serverTimestamp() });
    }
    const records = withRecord(await readRecords(tx, db, b.refundRecordIds), recordId, upd);
    tx.set(recordRef, upd);
    tx.set(db.collection(BY_RZP).doc(rf.id), { recordId });
    const ids = (b.refundRecordIds || []).includes(recordId) ? b.refundRecordIds : (b.refundRecordIds || []).concat([recordId]);
    tx.update(bookingRef, Object.assign({ refundRecordIds: ids }, deriveRefundState(b, records).fields));
    return "processed";
  });
}

module.exports = { handleRefund, applyRefundEvent, _internal: { deriveRefundState, RefundError, REFUNDS, BY_RZP } };
