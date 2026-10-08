/**
 * P0 — server-authoritative promo discounts. Uses the REAL pricing engine.
 *   node test/promo-security.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const promo = require("../promo.js");
const mp = require("../move-payment.js");
const PackZenPricing = require("../pricing-engine-v2.js");
const { handleCreateServiceOrder } = require("../catalog-payment.js");
const { priceCart, validateDetails, validRequestId } = require("../catalog-pricing.js");
const ROOT = path.join(__dirname, "..", "..");
const clone = (o) => JSON.parse(JSON.stringify(o));
const NOW = Date.parse("2026-10-08T06:00:00Z");

function makeDb() {
  const store = {};
  const col = (n) => (store[n] = store[n] || {});
  const snap = (n, id) => ({ exists: Object.prototype.hasOwnProperty.call(col(n), id), id, data: () => clone(col(n)[id]) });
  const query = (n, f, lim) => ({ where: (a, op, b) => query(n, f.concat([[a, b]]), lim), limit: (k) => query(n, f, k),
    get: async () => { let ids = Object.keys(col(n)).filter((id) => f.every(([a, b]) => col(n)[id][a] === b)); if (lim) ids = ids.slice(0, lim); return { docs: ids.map((id) => snap(n, id)), empty: !ids.length }; } });
  return { store, col, collection: (n) => Object.assign(query(n, [], null), { doc: (id) => ({ id, get: async () => snap(n, id), set: async (d) => { col(n)[id] = clone(d); } }) }) };
}
function env() {
  const db = makeDb();
  const P = (o) => Object.assign({ active: true, used: 0, max: 999 }, o);
  db.col("promos").SAVE200 = P({ code: "SAVE200", type: "flat", value: 200 });
  db.col("promos").TENPC = P({ code: "TENPC", type: "percent", value: 10 });
  db.col("promos").HUGEFLAT = P({ code: "HUGEFLAT", type: "flat", value: 999999 });
  db.col("promos").NINETY = P({ code: "NINETY", type: "percent", value: 90 });
  db.col("promos").CAPPED = P({ code: "CAPPED", type: "percent", value: 20, maxDiscount: 150 });
  db.col("promos").OLD = P({ code: "OLD", type: "flat", value: 200, expiresAt: "2026-01-01T00:00:00Z" });
  db.col("promos").LATER = P({ code: "LATER", type: "flat", value: 200, startsAt: "2027-01-01T00:00:00Z" });
  db.col("promos").PAUSED = P({ code: "PAUSED", type: "flat", value: 200, active: false });
  db.col("promos").NOFLAG = { code: "NOFLAG", type: "flat", value: 200 };
  db.col("promos").BIGMIN = P({ code: "BIGMIN", type: "flat", value: 200, minOrder: 999999 });
  db.col("promos").USEDUP = P({ code: "USEDUP", type: "flat", value: 200, max: 5, used: 5 });
  db.col("promos").BADPCT = P({ code: "BADPCT", type: "percent", value: 150 });
  db.col("promos").ODDTYPE = P({ code: "ODDTYPE", type: "free", value: 50 });
  db.col("users").uidFriend = { referralCode: "FRIEND123" };
  db.col("users").uidA = { referralCode: "MYOWNREF" };
  return { db, deps: { db, now: () => NOW, uid: "uidA" } };
}
const INPUT = { pickup: "Koramangala, Bangalore", drop: "Whitefield, Bangalore", km: 25, vehicleId: "truck_14ft", furniture: { bed_double: 2, sofa_3: 1, fridge: 1 }, cartonQty: 20, pickupFloor: 2, dropFloor: 3, liftAvailable: false, packingService: true };
const calc = async (qi) => { const v = PackZenPricing.validateInput(qi); if (!v.valid) throw new Error("bad input"); const q = PackZenPricing.calculateQuote(qi); if (!q.valid) throw new Error("bad quote"); return q; };
const price = (over, deps) => promo.priceWithPromo(Object.assign(clone(INPUT), over || {}), calc, deps);
const BASE = PackZenPricing.calculateQuote(Object.assign(clone(INPUT), { promoDiscount: 0 }));
const tests = []; const test = (n, f) => tests.push({ n, f });
async function rejectsPromo(p, re) { try { await p; } catch (e) { assert.strictEqual(e.code, "invalid_promo", e.message); if (re) assert.ok(re.test(e.publicMessage), e.publicMessage); return; } throw new Error("expected invalid_promo"); }

test("baseline is above the minimum fare (meaningful discounts)", () => { assert.ok(BASE.valid && BASE.finalTotal > 6000, String(BASE.finalTotal)); });
test("1. no promo code → server total = undiscounted engine total", async () => {
  const q = await price({}, env().deps); assert.strictEqual(q.finalTotal, BASE.finalTotal); assert.strictEqual(q.promo, null);
});
test("7. forged promoDiscount with no code is ignored", async () => {
  const qi = Object.assign(clone(INPUT), { promoDiscount: 5000 });
  const q = await promo.priceWithPromo(qi, calc, env().deps);
  assert.strictEqual(q.finalTotal, BASE.finalTotal); assert.strictEqual(qi.promoDiscount, 0, "stored input reflects the server value");
});
test("8/9. forged total/subtotal/grandTotal/finalTotal/discount fields are stripped", async () => {
  const q = await price({ total: 1, subtotal: 1, grandTotal: 1, finalTotal: 1, discount: 9999, discountAmount: 9999, couponDiscount: 9999, referralDiscount: 9999 }, env().deps);
  assert.strictEqual(q.finalTotal, BASE.finalTotal);
});
test("2. valid flat promo → exact server discount; forged promoDiscount alongside it ignored", async () => {
  const qi = Object.assign(clone(INPUT), { promoCode: "SAVE200", promoDiscount: 4000 });
  const q = await promo.priceWithPromo(qi, calc, env().deps);
  assert.strictEqual(q.finalTotal, BASE.finalTotal - 200);
  assert.deepStrictEqual(q.promo, { code: "SAVE200", kind: "promo", requested: 200, applied: 200 });
  assert.deepStrictEqual([qi.promoCode, qi.promoDiscount], ["SAVE200", 200]);
});
test("2b. valid percent promo uses the server's pre-discount total", async () => {
  const q = await price({ promoCode: "TENPC" }, env().deps);
  assert.strictEqual(q.promo.requested, Math.round(BASE.finalTotal * 0.1)); assert.strictEqual(q.finalTotal, BASE.finalTotal - q.promo.applied);
});
test("12/13. case and whitespace are normalised", async () => {
  const q = await price({ promoCode: "  save200 " }, env().deps); assert.strictEqual(q.promo.code, "SAVE200"); assert.strictEqual(q.finalTotal, BASE.finalTotal - 200);
});
test("3. invalid / malformed codes never discount", async () => {
  await rejectsPromo(price({ promoCode: "NOPE99" }, env().deps), /isn't valid/);
  for (const bad of ["a", "SAVE 200", "../x", "<script>", 42, { code: "SAVE200" }, "X".repeat(40)]) await rejectsPromo(price({ promoCode: bad }, env().deps));
  const q = await price({ promoCode: "" }, env().deps); assert.strictEqual(q.finalTotal, BASE.finalTotal, "empty code = no code");
});
test("4. expired and not-yet-active promos rejected", async () => {
  await rejectsPromo(price({ promoCode: "OLD" }, env().deps), /expired/);
  await rejectsPromo(price({ promoCode: "LATER" }, env().deps), /isn't active yet/);
});
test("5. disabled promos rejected (active must be true)", async () => {
  await rejectsPromo(price({ promoCode: "PAUSED" }, env().deps), /no longer active/);
  await rejectsPromo(price({ promoCode: "NOFLAG" }, env().deps), /no longer active/);
});
test("6. below minimum order rejected; usage limit enforced; bad promo docs rejected", async () => {
  await rejectsPromo(price({ promoCode: "BIGMIN" }, env().deps), /at least/);
  await rejectsPromo(price({ promoCode: "USEDUP" }, env().deps), /usage limit/);
  await rejectsPromo(price({ promoCode: "BADPCT" }, env().deps));
  await rejectsPromo(price({ promoCode: "ODDTYPE" }, env().deps));
});
test("10. fixed discount larger than the order is capped by the engine (30% of service subtotal, minimum fare)", async () => {
  const q = await price({ promoCode: "HUGEFLAT" }, env().deps);
  const cap = BASE.finalTotal - PackZenPricing.calculateQuote(Object.assign(clone(INPUT), { promoDiscount: 10e6 })).finalTotal;
  assert.strictEqual(q.promo.applied, cap); assert.ok(q.finalTotal >= PackZenPricing.config.minimumFare); assert.ok(cap > 0 && cap < BASE.finalTotal * 0.31);
});
test("11. percentage above the allowed maximum is capped; promo maxDiscount honoured", async () => {
  const q = await price({ promoCode: "NINETY" }, env().deps);
  assert.ok(q.promo.applied <= Math.ceil(BASE.finalTotal * 0.3)); assert.ok(q.promo.requested > q.promo.applied);
  const c = await price({ promoCode: "CAPPED" }, env().deps); assert.strictEqual(c.promo.applied, 150);
});
test("14. applying twice to the same input is idempotent (no stacking)", async () => {
  const qi = Object.assign(clone(INPUT), { promoCode: "SAVE200" });
  const a = await promo.priceWithPromo(qi, calc, env().deps); const b = await promo.priceWithPromo(qi, calc, env().deps);
  assert.strictEqual(a.finalTotal, b.finalTotal); assert.strictEqual(b.finalTotal, BASE.finalTotal - 200);
});
test("referral: another customer's code = ₹100; own code / signed out rejected", async () => {
  const q = await price({ promoCode: "friend123" }, env().deps); assert.deepStrictEqual([q.promo.kind, q.promo.applied], ["referral", 100]);
  await rejectsPromo(price({ promoCode: "MYOWNREF" }, env().deps), /own referral/);
  const e = env(); e.deps.uid = null; await rejectsPromo(price({ promoCode: "FRIEND123" }, e.deps), /sign in/);
});

/* ── 15. Razorpay order amount = server amount (real handleCreateOrder) ── */
function orderEnv() {
  const e = env(); const orders = [];
  const deps = { verifyIdToken: async (t) => { if (t !== "tokA") throw new Error("bad"); return { uid: "uidA", email: "a@example.com", email_verified: true }; },
    db: (() => { const d = e.db; const orig = d.collection; d.collection = (n) => { const c = orig(n); const doc = c.doc; c.doc = (id) => Object.assign(doc(id), { set: async (x) => { d.col(n)[id] = clone(x); } }); return c; }; return d; })(),
    logger: { info() {}, warn() {}, error() {} }, serverTimestamp: () => "TS", now: () => NOW,
    quote: (qi, p, dr, opts) => promo.priceWithPromo(qi, calc, { db: e.db, now: () => NOW, uid: opts && opts.uid }),
    normalize: (qi) => PackZenPricing.validateInput(qi).data,
    createOrder: async (o) => { orders.push(o); return { id: "order_PROMO" + String(orders.length).padStart(8, "0"), amount: o.amount, currency: o.currency }; } };
  return { e, deps, orders };
}
const body = (qi, over) => Object.assign({ quoteInput: Object.assign(clone(INPUT), qi), paymentType: "full", customerName: "Asha", phone: "9876543210", moveType: "home",
  pickup: "Koramangala, Bangalore", drop: "Whitefield, Bangalore", date: "2026-11-20", requestId: "req_promo_000001" }, over || {});
const call = (o, b) => mp.handleCreateOrder({ method: "POST", headers: { authorization: "Bearer tokA" }, body: b }, o.deps);

test("15. forged discount/total in the order request → Razorpay amount is the server amount", async () => {
  const o = orderEnv();
  const forged = await call(o, body({ promoDiscount: 5000 }, { total: 1, amount: 1, grandTotal: 1 }));
  const clean = await call(o, body({}, { requestId: "req_promo_000002" }));
  assert.strictEqual(forged.status, 200, JSON.stringify(forged.body));
  assert.strictEqual(o.orders[0].amount, o.orders[1].amount, "forged discount had no effect");
  const full = BASE.finalTotal - PackZenPricing.config.payment.fullPaymentDiscount;
  assert.strictEqual(o.orders[0].amount, full * 100);
});
test("15b. valid code → order amount includes exactly the server discount; pending stores server values", async () => {
  const o = orderEnv();
  const r = await call(o, body({ promoCode: " save200", promoDiscount: 3000 }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(o.orders[0].amount, (BASE.finalTotal - 200 - PackZenPricing.config.payment.fullPaymentDiscount) * 100);
  const pend = o.e.db.col("pendingPayments")[r.body.orderId];
  assert.strictEqual(pend.grandTotal, BASE.finalTotal - 200);
  assert.strictEqual(pend.quoteInput.promoDiscount, 200); assert.strictEqual(pend.quoteInput.promoCode, "SAVE200");
});
test("15c. invalid promo → 400 invalid_promo with a clear message, and NO Razorpay order", async () => {
  const o = orderEnv();
  const r = await call(o, body({ promoCode: "FAKE50" }));
  assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, "invalid_promo"); assert.ok(/isn't valid/.test(r.body.error));
  assert.strictEqual(o.orders.length, 0);
});
test("16. createBooking (pay-later) prices via the same server path and stores server promo values", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(src.includes("calculateServerQuote(quoteInput, bookingDetails.pickup, bookingDetails.drop, { uid: context.auth.uid })"));
  assert.ok(src.includes("return promo.priceWithPromo(quoteInput, calc, { db: admin.firestore(), now: () => Date.now(), uid: (opts && opts.uid) || null });"));
  assert.ok(src.includes("finalPayload.promoDiscount = quote.promo ? quote.promo.applied : 0;"));
  assert.ok(src.includes("quote: (quoteInput, pickup, drop, opts) => calculateServerQuote(quoteInput, pickup, drop, opts)"));
  assert.ok(!/finalPayload\.(total|balanceDue) = .*quoteInput/.test(src), "totals never come from the client input");
});
test("17. catalog/service orders: forged promo/total fields have no effect", async () => {
  const db = makeDb(); db.col("addons")["ac-installation"] = { isActive: true, categoryId: "ac-services", name: "AC Install", basePrice: 1400, pricingUnit: "per_item" };
  const orders = [];
  const deps = { db: Object.assign(db, { collection: ((orig) => (n) => { const c = orig(n); const d = c.doc; c.doc = (id) => Object.assign(d(id), { set: async (x) => { db.col(n)[id] = clone(x); } }); return c; })(db.collection) }),
    logger: { info() {}, warn() {}, error() {} }, serverTimestamp: () => "TS", now: () => NOW,
    verifyIdToken: async () => ({ uid: "uidA", email: "a@example.com", email_verified: true }),
    loadCatalog: async () => ({ services: {}, packages: {}, addons: { "ac-installation": db.col("addons")["ac-installation"] }, categories: { "ac-services": { isActive: true } } }),
    priceCart, validateDetails, validRequestId,
    createOrder: async (o) => { orders.push(o); return { id: "order_SVCP" + String(orders.length).padStart(8, "0"), amount: o.amount, currency: o.currency }; } };
  const details = { customerName: "Asha", phone: "9845095453", address: "12 MG Road Bangalore", date: new Date(NOW + 10 * 864e5).toISOString().slice(0, 10), timeSlot: "morning" };
  const r = await handleCreateServiceOrder({ headers: { authorization: "Bearer t" }, body: { requestId: "req-svc-promo1", items: [{ type: "addons", id: "ac-installation", qty: 1 }], details,
    promoCode: "SAVE200", promoDiscount: 1000, total: 1, amount: 1 } }, deps);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(orders[0].amount, 140000);
});
test("client sends promoCode; the server never needs the client discount", () => {
  const s = fs.readFileSync(path.join(ROOT, "public/script.js"), "utf8");
  assert.ok(s.includes("promoCode: appliedPromoCode || null,"));
  assert.strictEqual((s.match(/appliedPromoCode = code;/g) || []).length, 2, "set on promo + referral success");
  assert.ok(fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8").includes('script.js?v=11'), "cache-busted");
});
test("existing non-promo pricing unchanged: same total as the engine with zero discount", async () => {
  for (const qi of [{ km: 5, vehicleId: "tata_ace", furniture: {} }, { km: 40, vehicleId: "truck_22ft", furniture: { bed_double: 3 }, isInterstate: false }]) {
    const input = Object.assign({ pickup: "A", drop: "B" }, qi);
    const q = await promo.priceWithPromo(clone(input), calc, env().deps);
    assert.strictEqual(q.finalTotal, PackZenPricing.calculateQuote(Object.assign(clone(input), { promoDiscount: 0 })).finalTotal);
  }
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e)); } }
  console.log(`\npromo-security: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
