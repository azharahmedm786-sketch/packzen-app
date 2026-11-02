/** One definition of business numbers across dashboards.  node test/dashboard-metrics.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
const M = require("../../public/pz-metrics.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const list = [{ total: 6500, paid: 650, status: "confirmed" }, { total: 449, paidAmount: 449, status: "delivered" },
  { total: 4000, paid: 4000, status: "cancelled" }, { total: 2000, amountPaid: 500, status: "completed", balanceDue: 1500 }];
const s = M.summary(list);
assert.deepStrictEqual(s, { count: 4, active: 1, cancelled: 1, completed: 2, bookedValue: 8949, completedValue: 2449, paidOnline: 1599, balanceDue: 5850 });
assert.strictEqual(M.value({ total: 999, status: "cancelled" }), 0);
assert.strictEqual(M.paid({ paidAmount: 300 }), 300);
ok("shared metrics: cancelled bookings never count as revenue; paid read from paid / paidAmount / amountPaid; delivered + completed = done");
for (const f of ["admin.html", "advisor.html"]) {
  const h = pub(f);
  assert.ok(/<script src="pz-metrics\.js\?v=1"><\/script>/.test(h), f + " loads pz-metrics");
  assert.ok(!/reduce\(\(s, ?b\) ?=> ?s ?\+ ?\((Number\()?b\.total/.test(h) && !/\(s,b\)=>s\+\((Number\()?b\.total/.test(h), f + " has no raw revenue sum left");
  assert.ok(/PZM\.value\(b\)/.test(h) && /PZM\.isDone\(b\)/.test(h), f);
}
ok("admin and advisor compute revenue, averages and completed counts with the same shared rules");
console.log(`\ndashboard-metrics: ${pass} passed, 0 failed`);
