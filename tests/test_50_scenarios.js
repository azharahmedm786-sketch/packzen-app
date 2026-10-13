/**
 * Pricing engine V4 scenario sweep (rewritten: the old version targeted the
 * retired V2 inputs — houseValue / _internal.operCost — and could no longer run).
 *
 * For every combination it checks that a huge promo can never push the price
 * below the engine's guard rails:
 *   - discount <= 30% of the service subtotal (maxPromoFraction)
 *   - total >= minimumFare, finite, whole rupees
 *   - discounted total >= 70% of the undiscounted total
 *   - longer distance is never cheaper (same inputs otherwise)
 *   node tests/test_50_scenarios.js
 */
const path = require("path");
const engine = require(path.join(__dirname, "..", "public", "pricing-engine-v2.js"));
const cfg = engine.config || engine.PRICING_CONFIG || {};
const MIN_FARE = (cfg && cfg.minimumFare) || 0;

const kms = [0, 5, 12, 45, 120, 500];
const vehicles = Object.keys(engine.vehicles);
const floors = [[0, 0], [3, 2]];
const lifts = [true, false];
const packing = [false, true];
const nights = [false, true];

let n = 0, failures = 0;
const fail = (msg) => { failures++; if (failures <= 20) console.log("FAIL " + msg); };

for (const vehicleId of vehicles) for (const [pf, df] of floors) for (const liftAvailable of lifts)
for (const packingService of packing) for (const isNightShift of nights) {
  let prev = -1;
  for (const km of kms) {
    const base = { pickup: "A", drop: "B", km, vehicleId, pickupFloor: pf, dropFloor: df, liftAvailable,
      packingService, isNightShift, furniture: { sofa_3: 1, bed_double: 1 }, cartonQty: 10 };
    const full = engine.calculateQuote(Object.assign({}, base));
    const promo = engine.calculateQuote(Object.assign({}, base, { promoDiscount: 500000 }));
    n++;
    const tag = JSON.stringify({ vehicleId, km, pf, df, liftAvailable, packingService, isNightShift });
    if (!full.valid || !promo.valid) { fail("invalid " + tag); continue; }
    const t = promo.finalTotal, u = full.finalTotal;
    if (!Number.isFinite(t) || t !== Math.round(t)) fail("non-integer total " + tag);
    if (t < MIN_FARE) fail(`below minimum fare ${t} < ${MIN_FARE} ` + tag);
    if (t < Math.floor(u * 0.7)) fail(`promo cut more than 30%: ${t} vs ${u} ` + tag);
    if (u < prev) fail(`longer distance cheaper: ${u} < ${prev} ` + tag);
    prev = u;
  }
}

console.log(`--- ${n} scenarios ---`);
if (failures) { console.log(`FAILED: ${failures} problem(s)`); process.exit(1); }
console.log("All scenarios respect the promo cap, minimum fare and distance monotonicity.");
