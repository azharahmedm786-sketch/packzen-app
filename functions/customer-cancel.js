/**
 * PackZen — customer self-service cancellation (Level 2)
 * -------------------------------------------------------
 * Policy (owner decision 2026-10-11): cancelling any time BEFORE the job day
 * (IST) gives a full automatic refund of what was paid online. On/after the
 * job day, or once packing has started, the customer is asked to call us.
 * The refund itself reuses payment-refund.js (atomic reservation, exactly one
 * Razorpay call per request id, webhook reconciliation) with a deterministic
 * request id, so retries never refund twice.
 */
"use strict";

const CANCELLABLE = ["pending", "confirmed", "assigned"];
const REQUEST_ID = "custcancel";

class CancelError extends Error {
  constructor(code, message) { super(message); this.code = code; this.publicMessage = message; }
}

function istDate(ms) { return new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10); }

async function handleCustomerCancel(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new CancelError("unauthenticated", "Please sign in.");
  const bookingId = data && data.bookingId;
  if (typeof bookingId !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(bookingId)) throw new CancelError("invalid-argument", "Invalid booking.");
  const reason = String((data && data.reason) || "").trim().slice(0, 200);
  if (!reason) throw new CancelError("invalid-argument", "Please choose a reason.");
  const db = deps.db;
  const ref = db.collection("bookings").doc(bookingId);
  const today = istDate(deps.now());

  const out = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { error: ["not-found", "Booking not found."] };
    const b = s.data() || {};
    if (b.customerUid !== uid) return { error: ["permission-denied", "This isn't your booking."] };
    if (b.status === "cancelled") return { already: true, b };
    if (!CANCELLABLE.includes(b.status)) return { error: ["failed-precondition", "This job has already started. Please call us to cancel."] };
    if (typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.date <= today) {
      return { error: ["failed-precondition", "Bookings can be cancelled online only before the job day. Please call us."] };
    }
    tx.update(ref, { status: "cancelled", cancelledBy: "customer", cancelReason: reason, cancelledAt: deps.now() });
    tx.set(db.collection("cancelRequests").doc(bookingId + "__customer"), { bookingDocId: bookingId, reason, customerUid: uid, createdAt: deps.now(), source: "self_service", policy: "full_refund_before_job_day" });
    return { cancelled: true, b };
  });
  if (out.error) throw new CancelError(out.error[0], out.error[1]);

  const b = out.b;
  const paid = Number(b.paid) || 0;
  let refund = { status: "none", amount: 0 };
  if (paid > 0 && typeof b.paymentId === "string" && b.paymentId) {
    try {
      const r = await deps.refund({ bookingId, paymentId: b.paymentId, requestId: REQUEST_ID, full: true, reason: "Customer cancelled before job day: " + reason });
      refund = { status: r.status || "requested", amount: r.amount || 0 };
    } catch (e) {
      // Cancellation stands; the refund is flagged for the admin (and the ops digest) instead.
      (deps.logger || console).error("customer_cancel_refund_failed", { bookingId, message: String(e && e.message).slice(0, 120) });
      await ref.update({ needsRefundReview: true }).catch(() => {});
      refund = { status: "needs_review", amount: 0 };
    }
  }
  if (Array.isArray(b.collections) || b.lastCollectionAt) await ref.update({ needsRefundReview: true }).catch(() => {}); // extra balance payments: admin checks
  (deps.logger || console).info("customer_cancelled", { bookingId, already: !!out.already, refund: refund.status });
  return { ok: true, already: !!out.already, refund };
}

module.exports = { handleCustomerCancel, CancelError, istDate, REQUEST_ID };
