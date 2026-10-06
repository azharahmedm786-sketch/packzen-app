/**
 * PackZen — booking payment state (shared by customer, driver and admin views)
 * Phase 1 payment correctness: one place that decides "how much is still owed".
 *
 * Rules (in order):
 *  1. `balanceDue` is a number            → authoritative (new bookings, Phase 1+).
 *  2. `paid` is a number                  → balance = max(0, total − paid)
 *                                           (pay-later paid:0, advisor and catalog bookings).
 *  3. has paymentId/orderId but no `paid` → LEGACY online-paid move booking (pre-Phase-1, I-06a).
 *                                           Its `total` is the amount that was paid online, not the
 *                                           move price, so the balance CANNOT be derived. Reported as
 *                                           unknown; drivers must not collect until the office confirms.
 *                                           (Fixed later by the M-19 backfill — no value is invented here.)
 *  4. otherwise                           → nothing paid; balance = total.
 */
(function (root) {
  "use strict";

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  function summarize(b) {
    b = b || {};
    const total = Number(b.total) || 0;
    const paidNum = num(b.paid);
    const balNum = num(b.balanceDue);
    const hasOnlinePayment = !!(b.paymentId || b.orderId);

    if (balNum !== null) {
      return { known: true, legacy: false, total, paid: paidNum || 0, balanceDue: Math.max(0, balNum),
               fullyPaid: balNum <= 0, paymentStatus: b.paymentStatus || (balNum <= 0 ? "paid" : "partially_paid") };
    }
    if (paidNum !== null) {
      const due = Math.max(0, total - paidNum);
      return { known: true, legacy: false, total, paid: paidNum, balanceDue: due, fullyPaid: due <= 0,
               paymentStatus: b.paymentStatus || (paidNum <= 0 ? "unpaid" : due <= 0 ? "paid" : "partially_paid") };
    }
    if (hasOnlinePayment) {
      return { known: false, legacy: true, total: null, paid: total, balanceDue: null, fullyPaid: false,
               paymentStatus: "needs_review" };
    }
    return { known: true, legacy: false, total, paid: 0, balanceDue: total, fullyPaid: total <= 0, paymentStatus: "unpaid" };
  }

  const api = { summarize };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PackZenPaymentState = api;
})(typeof window !== "undefined" ? window : null);
