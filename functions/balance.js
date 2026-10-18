/**
 * PackZen — Phase 2E balance collection (cash / direct UPI recorded by the driver)
 * -------------------------------------------------------------------------------
 * Business rule (owner decision): a job can't be completed while money is owed.
 * verifyCompletionOtp refuses while booking.balanceDue > 0; the driver first
 * records what the customer paid. Idempotent per requestId; never over-collects;
 * total is never changed; refunds keep working on top of `paid`.
 * Ledger: bookings/{id}/collections/{requestId} (server-only).
 */
"use strict";

class BalanceError extends Error { constructor(code, message) { super(code); this.code = code; this.publicMessage = message; } }
const METHODS = ["cash", "upi"];

async function handleRecordCollection(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new BalanceError("unauthenticated", "Please sign in.");
  const { bookingId, method, requestId } = data || {};
  const amount = Number(data && data.amount);
  if (typeof bookingId !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(bookingId)) throw new BalanceError("invalid-argument", "Invalid booking.");
  if (!METHODS.includes(method)) throw new BalanceError("invalid-argument", "Choose cash or UPI.");
  if (!Number.isInteger(amount) || amount <= 0 || amount > 500000) throw new BalanceError("invalid-argument", "Enter the amount in whole rupees.");
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new BalanceError("invalid-argument", "Missing request id.");
  const isAdmin = await deps.isAdmin(context);
  const isDriver = !isAdmin && (await deps.isDriver(context));
  const db = deps.db;
  const bRef = db.collection("bookings").doc(bookingId);
  const cRef = bRef.collection("collections").doc(requestId);
  const out = await db.runTransaction(async (tx) => {
    const b = await tx.get(bRef);
    const c = await tx.get(cRef);
    if (!b.exists) return { error: ["not-found", "Booking not found."] };
    const bd = b.data() || {};
    if (!isAdmin && !(isDriver && bd.driverUid === uid)) return { error: ["permission-denied", "Only the assigned driver can record a payment."] };
    if (c.exists) return { already: true, balanceDue: bd.balanceDue };
    if (!["assigned", "packing", "transit"].includes(bd.status)) return { error: ["failed-precondition", "Payments can only be recorded for an active job."] };
    const due = Number(bd.balanceDue);
    if (!Number.isFinite(due)) return { error: ["failed-precondition", "This booking has no recorded balance. Ask the admin."] };
    if (amount > due) return { error: ["invalid-argument", "That's more than the balance due (₹" + due + ")."] };
    const paid = (Number(bd.paid) || 0) + amount;
    const balanceDue = due - amount;
    tx.set(cRef, { amount, method, by: uid, byRole: isAdmin ? "admin" : "driver", at: deps.now(), balanceBefore: due, balanceAfter: balanceDue });
    // cashCollected: money the crew physically holds (deducted from their payout)
    tx.update(bRef, { paid, balanceDue, paymentStatus: balanceDue === 0 ? "paid" : "partially_paid", lastCollectionAt: deps.now(),
      cashCollected: (Number(bd.cashCollected) || 0) + (method === "cash" ? amount : 0) });
    return { ok: true, balanceDue };
  });
  if (out.error) throw new BalanceError(out.error[0], out.error[1]);
  (deps.logger || console).info("balance_collected", { bookingId, amount, method, already: !!out.already });
  return { ok: true, balanceDue: out.balanceDue, already: !!out.already };
}

/** Completion gate used by verifyCompletionOtp: null = OK, else the refusal message. */
function completionBlocker(b) {
  const due = Number(b && b.balanceDue);
  if (Number.isFinite(due) && due > 0) return "Collect the balance of ₹" + due + " and record it before completing the job.";
  return null; // fully paid, or a legacy booking with no recorded balance (admin can review)
}

module.exports = { handleRecordCollection, completionBlocker, BalanceError, METHODS };
