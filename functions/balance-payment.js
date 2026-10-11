/**
 * PackZen — online balance payment (Level 2)
 * -------------------------------------------
 * The customer pays the remaining balance of their own booking from My Bookings.
 *  createBalanceOrder  → server reads booking.balanceDue (never a client amount),
 *                        creates a Razorpay order for exactly that, records
 *                        balanceOrders/{orderId} (server-only collection).
 *  verifyBalancePayment→ checkout signature + Razorpay fetch (captured, same order,
 *                        exact amount, INR) → applyBalancePayment.
 *  applyBalancePayment → one transaction, idempotent per payment id; also called
 *                        by the Razorpay webhook (payment.captured / order.paid),
 *                        so a closed browser still settles the balance.
 * Overpayment (two orders paid) is recorded and flagged for an admin refund;
 * balanceDue never goes below 0.
 */
"use strict";

const ORDER_RE = /^order_[A-Za-z0-9]{6,40}$/;
const PAY_RE = /^pay_[A-Za-z0-9]{6,40}$/;
const SIG_RE = /^[a-f0-9]{64}$/i;
const ACTIVE = ["confirmed", "assigned", "packing", "transit"];
const COLL = "balanceOrders";

class BalancePayError extends Error {
  constructor(code, message) { super(message); this.code = code; this.publicMessage = message; }
}

async function handleCreateBalanceOrder(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new BalancePayError("unauthenticated", "Please sign in to pay.");
  const bookingId = data && data.bookingId;
  if (typeof bookingId !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(bookingId)) throw new BalancePayError("invalid-argument", "Invalid booking.");
  const snap = await deps.db.collection("bookings").doc(bookingId).get();
  if (!snap.exists) throw new BalancePayError("not-found", "Booking not found.");
  const b = snap.data() || {};
  if (b.customerUid !== uid) throw new BalancePayError("permission-denied", "This isn't your booking.");
  if (!ACTIVE.includes(b.status)) throw new BalancePayError("failed-precondition", "This booking can't take a payment now.");
  const due = Number(b.balanceDue);
  if (!Number.isInteger(due) || due <= 0) throw new BalancePayError("failed-precondition", "Nothing is due on this booking.");
  if (due > 500000) throw new BalancePayError("failed-precondition", "Please contact us to pay this balance.");
  const order = await deps.createOrder({
    amount: due * 100, currency: "INR",
    receipt: ("bal_" + bookingId).slice(0, 40),
    notes: { flow: "balance", bookingId },
  });
  if (!order || !ORDER_RE.test(order.id) || Number(order.amount) !== due * 100) throw new BalancePayError("internal", "Couldn't start the payment. Please try again.");
  await deps.db.collection(COLL).doc(order.id).set({ bookingId, uid, amount: due, status: "created", createdAt: deps.now() });
  (deps.logger || console).info("balance_order_created", { bookingId, amount: due });
  return { orderId: order.id, amount: due * 100, currency: "INR", keyId: deps.keyId, bookingRef: b.bookingRef || null };
}

/** Settle a captured balance payment. Idempotent; safe from verify AND webhook. */
async function applyBalancePayment(deps, orderId, pay) {
  const db = deps.db;
  const oRef = db.collection(COLL).doc(orderId);
  return db.runTransaction(async (tx) => {
    const o = await tx.get(oRef);
    if (!o.exists) return { result: "unmatched" };
    const od = o.data() || {};
    if (Number(pay.amount) !== od.amount * 100 || pay.currency !== "INR" || pay.order_id !== orderId) return { result: "amount_mismatch" };
    if (od.status === "paid") return { result: od.paymentId === pay.id ? "already" : "conflict" };
    const bRef = db.collection("bookings").doc(od.bookingId);
    const cRef = bRef.collection("collections").doc("rzp_" + pay.id);
    const b = await tx.get(bRef);
    const c = await tx.get(cRef);
    if (!b.exists) return { result: "no_booking" };
    tx.update(oRef, { status: "paid", paymentId: pay.id, paidAt: deps.now() });
    if (c.exists) return { result: "already" };
    const bd = b.data() || {};
    const due = Math.max(0, Number(bd.balanceDue) || 0);
    const applied = Math.min(due, od.amount);
    const over = od.amount - applied;
    const paid = (Number(bd.paid) || 0) + od.amount;
    const balanceDue = due - applied;
    tx.set(cRef, { amount: od.amount, method: "online", paymentId: pay.id, orderId, by: od.uid, byRole: "customer", at: deps.now(), balanceBefore: due, balanceAfter: balanceDue, overpaid: over });
    const upd = { paid, balanceDue, paymentStatus: balanceDue === 0 ? "paid" : "partially_paid", lastCollectionAt: deps.now() };
    if (over > 0) { upd.overpaidAmount = (Number(bd.overpaidAmount) || 0) + over; upd.needsRefundReview = true; }
    tx.update(bRef, upd);
    return { result: "processed", balanceDue, overpaid: over, bookingId: od.bookingId };
  });
}

async function handleVerifyBalancePayment(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new BalancePayError("unauthenticated", "Please sign in.");
  const { orderId, paymentId, signature } = data || {};
  if (!ORDER_RE.test(String(orderId)) || !PAY_RE.test(String(paymentId)) || !SIG_RE.test(String(signature))) throw new BalancePayError("invalid-argument", "Invalid payment details.");
  if (!deps.signatureMatches(orderId, paymentId, signature, deps.keySecret)) throw new BalancePayError("permission-denied", "Payment could not be verified.");
  const o = await deps.db.collection(COLL).doc(orderId).get();
  if (!o.exists || (o.data() || {}).uid !== uid) throw new BalancePayError("not-found", "Payment not found.");
  let pay;
  try { pay = await deps.fetchPayment(paymentId); } catch (e) { throw new BalancePayError("unavailable", "Couldn't confirm the payment yet. It will update automatically."); }
  if (!pay || pay.order_id !== orderId) throw new BalancePayError("permission-denied", "Payment could not be verified.");
  if (pay.status !== "captured") throw new BalancePayError("failed-precondition", "Payment isn't complete yet. It will update automatically once confirmed.");
  const r = await applyBalancePayment(deps, orderId, pay);
  (deps.logger || console).info("balance_payment_verified", { orderId: "…" + orderId.slice(-4), result: r.result });
  if (r.result === "processed" || r.result === "already") return { ok: true, balanceDue: r.balanceDue, already: r.result === "already" };
  throw new BalancePayError("failed-precondition", "Payment could not be applied. Our team will check it.");
}

module.exports = { handleCreateBalanceOrder, handleVerifyBalancePayment, applyBalancePayment, BalancePayError, COLL };
