/**
 * Business accounts, photo estimates, rider payouts.
 *   node test/next-steps.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const { _leads: L } = require("../leads.js");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

assert.strictEqual(L.validateLead({ name: "Acme", phone: "9876543210", service: "business" }).value.serviceLabel, "Business / office account");
assert.strictEqual(L.validateLead({ name: "Asha", phone: "9876543210", service: "estimate" }).value.serviceLabel, "Fixed quote from photos");
ok("lead engine knows 'Business / office account' and 'Fixed quote from photos'");

for (const [f, svc] of [["business.html", "business"], ["estimate.html", "estimate"]]) {
  const h = pub(f);
  assert.ok(h.includes('service: "' + svc + '"') && /submitLead/.test(h) && /name="website"/.test(h) && /pz-premium\.css/.test(h) && /Content-Security-Policy/.test(h), f);
  assert.ok(pub("sitemap.xml").includes(f) && pub("pz-leads.js").includes("/" + f), f);
}
assert.ok(/wa\.me\/919945095453\?text=/.test(pub("estimate.html")) && /GSTIN/.test(pub("business.html")));
ok("business + photo-estimate pages: create leads (spam-protected), photos via WhatsApp, linked from the Book picker and sitemap");

const bal = fs.readFileSync(path.join(__dirname, "..", "balance.js"), "utf8");
assert.ok(/cashCollected: \(Number\(bd\.cashCollected\) \|\| 0\) \+ \(method === "cash" \? amount : 0\)/.test(bal));
const drv = pub("driver.html");
assert.ok(/RIDER_PLATFORM_PCT = 10/.test(drv) && /Cash you hold/.test(drv) && /Pending payout/.test(drv) && /You owe PackZen/.test(drv) && /riderPaidAmount/.test(drv));
const adm = pub("admin.html");
assert.ok(/function opsRecordPayout/.test(adm) && /riderPaidAmount: already\+amt/.test(adm));
ok("rider earnings: real share after 10% fee, cash held, paid out, pending; admin records payouts from the Operations board");

console.log(`\nnext-steps: ${pass} passed, 0 failed`);
