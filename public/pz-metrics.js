/* PackZen shared business metrics — ONE definition used by admin, advisor and the
 * crew/partner views so every dashboard shows the same numbers.
 *  value(b)     booking value, 0 if cancelled            (revenue = booked value)
 *  paid(b)      amount paid online (paid, or older paidAmount / amountPaid)
 *  isDone(b)    finished job (status delivered or completed)
 *  summary(list) → { count, active, cancelled, completed, bookedValue,
 *                    completedValue, paidOnline, balanceDue } */
(function (root) {
  "use strict";
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  var M = {
    isCancelled: function (b) { return !!b && /^cancel/.test(String(b.status || "")); },
    isDone: function (b) { return !!b && (b.status === "delivered" || b.status === "completed"); },
    value: function (b) { return !b || M.isCancelled(b) ? 0 : num(b.total); },
    paid: function (b) { if (!b) return 0; return num(b.paid != null ? b.paid : (b.paidAmount != null ? b.paidAmount : b.amountPaid)); },
    balance: function (b) { if (!b || M.isCancelled(b)) return 0; return b.balanceDue != null ? num(b.balanceDue) : Math.max(0, num(b.total) - M.paid(b)); },
    summary: function (list) {
      var s = { count: 0, active: 0, cancelled: 0, completed: 0, bookedValue: 0, completedValue: 0, paidOnline: 0, balanceDue: 0 };
      (list || []).forEach(function (b) {
        s.count++;
        if (M.isCancelled(b)) { s.cancelled++; return; }
        s.bookedValue += M.value(b); s.paidOnline += M.paid(b);
        if (M.isDone(b)) { s.completed++; s.completedValue += M.value(b); } else { s.active++; s.balanceDue += M.balance(b); }
      });
      return s;
    },
    rupees: function (n) { return "₹" + Math.round(num(n)).toLocaleString("en-IN"); }
  };
  root.PZM = M;
  if (typeof module !== "undefined" && module.exports) module.exports = M;
})(typeof window !== "undefined" ? window : globalThis);
