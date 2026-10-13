/**
 * Pricing integrity: server distance is mandatory; bookings record what they were priced from.
 *   node test/pricing-integrity.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const g = require("../pricing-guard.js");
const PackZenPricing = require("../pricing-engine-v2.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

for (const bad of [0, -3, NaN, undefined, null, "abc", Infinity]) {
  assert.throws(() => g.requireServerDistance(bad), g.PricingGuardError);
}
ok("unmeasurable route (Maps 0 / error / garbage) is refused, never priced at 0 km");
assert.strictEqual(g.requireServerDistance(12.3456), 12.35);
ok("valid server distance is accepted (rounded to 10 m)");

const qi = { pickup: "A", drop: "B", km: 40, vehicleId: "tata_ace", furniture: { sofa_3: 1 }, pickupFloor: 2, dropFloor: 0,
  liftAvailable: false, packingService: true, promoCode: undefined, total: 1, customerName: "x" };
const quote = PackZenPricing.calculateQuote(Object.assign({}, qi));
assert.ok(quote.valid);
const snap = g.pricedInputSnapshot(qi, quote);
assert.strictEqual(snap.km, 40); assert.strictEqual(snap.vehicleId, "tata_ace"); assert.strictEqual(snap.pricedVehicleId, quote.breakdown.vehicleId);
assert.ok(!("total" in snap) && !("customerName" in snap) && !("promoCode" in snap));
ok("pricedInput snapshot keeps only engine inputs + the vehicle actually priced; no client totals or PII");

const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
assert.ok(/quoteInput\.km = pricingGuard\.requireServerDistance\(/.test(idx));
assert.ok(!/else if \(quoteInput\.km\)/.test(idx));
ok("calculateServerQuote always uses the guarded server distance (shared by pay-later and paid flows)");
assert.ok(/finalPayload\.paymentType = "pay_later"/.test(idx) && /finalPayload\.pricedInput = pricingGuard\.pricedInputSnapshot/.test(idx));
ok("createBooking pins paymentType to pay_later and records pricedInput");

console.log(`\npricing-integrity: ${pass} passed, 0 failed`);
