/**
 * Offers: weekday saver (3%, Tue–Thu, dates 5–25), mini move (₹1,499), FIRSTMOVE
 * (first booking only), one discount per booking, server uses the booking's date.
 *   node test/offers.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const E = require("../pricing-engine-v2.js");
const promo = require("../promo.js");
const A = require("../assistant.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

(async () => {
  const big = { pickup: "A", drop: "B", km: 12, vehicleId: "truck_17ft", furniture: { sofa_3: 1, bed_double: 2, fridge: 1 }, pickupFloor: 2, dropFloor: 1, liftAvailable: true, packingService: true };
  const q = (x) => E.calculateQuote(Object.assign({}, big, x));
  const base = q({}).finalTotal;
  for (const [date, expect] of [["2026-10-20", true], ["2026-10-21", true], ["2026-10-22", true], ["2026-10-24", false], ["2026-10-19", false], ["2026-10-01", false], ["2026-10-27", false]]) {
    const r = q({ moveDate: date });
    assert.strictEqual(r.breakdown.discountKind === "weekday", expect, date);
    if (expect) assert.ok(r.finalTotal < base && base - r.finalTotal <= Math.ceil(base * 0.03) + 1);
    else assert.strictEqual(r.finalTotal, base);
  }
  ok("weekday saver: 3% only Tue–Thu on dates 5–25 (Saturday, Monday, the 1st and the 27th excluded)");

  const wed = q({ moveDate: "2026-10-21" }), wedPromo = q({ moveDate: "2026-10-21", promoDiscount: 200 }), wedBigPromo = q({ moveDate: "2026-10-21", promoDiscount: 600 });
  assert.strictEqual(wedPromo.finalTotal, wed.finalTotal); assert.strictEqual(wedBigPromo.breakdown.discountKind, "promo");
  assert.strictEqual(wedBigPromo.finalTotal, base - 600);
  ok("one discount per booking: the bigger of weekday saver and promo code, never both");

  const small = { pickup: "A", drop: "B", km: 8, vehicleId: "tata_ace", furniture: { fridge: 1, bed_double: 1 }, cartonQty: 2, pickupFloor: 1, dropFloor: 0 };
  const m = (x) => E.calculateQuote(Object.assign({}, small, x));
  assert.strictEqual(m({}).finalTotal, 1499); assert.ok(m({}).breakdown.miniMove);
  assert.ok(!m({ km: 11 }).breakdown.miniMove); assert.ok(!m({ packingService: true }).breakdown.miniMove);
  assert.ok(!m({ cartonQty: 10 }).breakdown.miniMove); assert.ok(!m({ pickupFloor: 4 }).breakdown.miniMove);
  assert.ok(m({ pickupFloor: 4, liftAvailable: true }).breakdown.miniMove);
  assert.ok(!m({ furniture: {}, cartonQty: 0 }).breakdown.miniMove);
  assert.strictEqual(m({ moveDate: "2026-10-21", promoDiscount: 200 }).finalTotal, 1499);
  ok("mini move ₹1,499: Tata Ace, 1–5 items, ≤10 km, no packing, ≤2 floors without lift; never combined with other discounts");

  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8"), mp = fs.readFileSync(path.join(__dirname, "..", "move-payment.js"), "utf8");
  assert.ok(/quoteInput\.moveDate = \(opts && typeof opts\.date === "string"/.test(idx) && /date: bookingDetails\.date \}\)/.test(idx) && /date: details\.date \}\)/.test(mp));
  ok("server prices the weekday saver from the booking's own date (a browser-sent date is overwritten)");

  const db = (bookings, promoDoc) => ({ collection: (c) => ({
    doc: () => ({ get: async () => ({ exists: !!promoDoc, data: () => promoDoc }) }),
    where: () => ({ limit: () => ({ get: async () => ({ docs: bookings.map((b) => ({ data: () => b })) }) }) }) }) });
  const FIRST = { active: true, type: "flat", value: 200, minOrder: 4000, firstBookingOnly: true };
  const r1 = await promo.resolvePromo("FIRSTMOVE", 6000, { db: db([], FIRST), now: () => Date.now(), uid: "u1" });
  assert.strictEqual(r1.amount, 200);
  await assert.rejects(promo.resolvePromo("FIRSTMOVE", 6000, { db: db([{ status: "delivered" }], FIRST), now: () => Date.now(), uid: "u1" }), /first PackZen booking/);
  const r2 = await promo.resolvePromo("FIRSTMOVE", 6000, { db: db([{ status: "cancelled" }], FIRST), now: () => Date.now(), uid: "u1" });
  assert.strictEqual(r2.amount, 200);
  await assert.rejects(promo.resolvePromo("FIRSTMOVE", 3000, { db: db([], FIRST), now: () => Date.now(), uid: "u1" }), /at least ₹4000/);
  await assert.rejects(promo.resolvePromo("FIRSTMOVE", 6000, { db: db([], FIRST), now: () => Date.now(), uid: null }), /sign in/);
  ok("FIRSTMOVE: ₹200 off above ₹4,000, first booking only (cancelled ones don't count), signed-in customers only");

  const r = A.answer("any offers or discount?", {}); assert.ok(r.intents.includes("offers") && /₹1,499/.test(r.reply) && /FIRSTMOVE/.test(r.reply));
  ok("assistant explains the offers");

  console.log(`\noffers: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
