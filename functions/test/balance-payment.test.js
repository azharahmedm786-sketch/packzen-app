/**
 * Level 2 — online balance payment. node test/balance-payment.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bp = require("../balance-payment.js");
const mp = require("../move-payment.js");
const ROOT = path.join(__dirname, "..", "..");
const clone = (o) => JSON.parse(JSON.stringify(o));
const SECRET = "test_key_secret_123";

function makeDb() {
  const store = {};
  const col = (p) => (store[p] = store[p] || {});
  const docRef = (p, id) => ({ id, _p: p, get: async () => ({ exists: id in col(p), id, data: () => clone(col(p)[id]) }),
    set: async (d) => { col(p)[id] = clone(d); }, update: async (d) => { col(p)[id] = Object.assign(col(p)[id] || {}, clone(d)); },
    collection: (n) => collRef(p + "/" + id + "/" + n) });
  const collRef = (p) => ({ doc: (id) => docRef(p, id) });
  const db = { store, col, collection: (n) => collRef(n),
    runTransaction: async (fn) => { const w = []; const tx = { get: (r) => r.get(), set: (r, d) => w.push(() => r.set(d)), update: (r, d) => w.push(() => r.update(d)) };
      const out = await fn(tx); for (const f of w) await f(); return out; } };
  return db;
}
const sign = (o, p) => crypto.createHmac("sha256", SECRET).update(o + "|" + p).digest("hex");
function env(booking) {
  const db = makeDb(); const orders = []; const payments = {};
  db.col("bookings").bkA0000001 = Object.assign({ customerUid: "custA", status: "assigned", total: 5000, paid: 500, balanceDue: 4500, bookingRef: "PKZ-1" }, booking || {});
  let n = 0;
  const deps = { db, now: () => 1_800_000_000_000, logger: { info() {}, error() {}, warn() {} }, keyId: "rzp_live_x", keySecret: SECRET,
    signatureMatches: mp._internal.signatureMatches,
    createOrder: async (o) => { orders.push(o); return { id: "order_BAL" + String(++n).padStart(8, "0"), amount: o.amount, currency: o.currency }; },
    fetchPayment: async (id) => payments[id] };
  return { db, deps, orders, payments };
}
const ctx = (uid) => ({ auth: { uid } });
const tests = []; const test = (n, f) => tests.push({ n, f });
async function rejects(p, code) { try { await p; } catch (e) { assert.strictEqual(e.code, code, e.message); return e; } throw new Error("expected " + code); }

test("create: amount comes from booking.balanceDue only (client amount ignored); order recorded server-side", async () => {
  const { db, deps, orders } = env();
  const r = await bp.handleCreateBalanceOrder({ bookingId: "bkA0000001", amount: 1, total: 1 }, ctx("custA"), deps);
  assert.strictEqual(orders[0].amount, 450000); assert.strictEqual(r.amount, 450000); assert.strictEqual(orders[0].notes.flow, "balance");
  assert.deepStrictEqual([db.col("balanceOrders")[r.orderId].amount, db.col("balanceOrders")[r.orderId].uid, db.col("balanceOrders")[r.orderId].status], [4500, "custA", "created"]);
});
test("create: refused for others' bookings, signed-out users, inactive bookings and nothing due", async () => {
  await rejects(bp.handleCreateBalanceOrder({ bookingId: "bkA0000001" }, ctx("custB"), env().deps), "permission-denied");
  await rejects(bp.handleCreateBalanceOrder({ bookingId: "bkA0000001" }, {}, env().deps), "unauthenticated");
  for (const st of ["pending", "delivered", "cancelled"]) await rejects(bp.handleCreateBalanceOrder({ bookingId: "bkA0000001" }, ctx("custA"), env({ status: st }).deps), "failed-precondition");
  for (const due of [0, -5, null, 12.5]) await rejects(bp.handleCreateBalanceOrder({ bookingId: "bkA0000001" }, ctx("custA"), env({ balanceDue: due }).deps), "failed-precondition");
  await rejects(bp.handleCreateBalanceOrder({ bookingId: "../x" }, ctx("custA"), env().deps), "invalid-argument");
});
async function created(e) { return bp.handleCreateBalanceOrder({ bookingId: "bkA0000001" }, ctx("custA"), e.deps); }
test("verify: valid captured payment settles the balance once; repeat is idempotent", async () => {
  const e = env(); const o = await created(e);
  e.payments.pay_BAL0000001 = { id: "pay_BAL0000001", order_id: o.orderId, amount: 450000, currency: "INR", status: "captured" };
  const r = await bp.handleVerifyBalancePayment({ orderId: o.orderId, paymentId: "pay_BAL0000001", signature: sign(o.orderId, "pay_BAL0000001") }, ctx("custA"), e.deps);
  assert.ok(r.ok && r.balanceDue === 0);
  const b = e.db.col("bookings").bkA0000001;
  assert.deepStrictEqual([b.paid, b.balanceDue, b.paymentStatus], [5000, 0, "paid"]);
  assert.ok(e.db.col("bookings/bkA0000001/collections").rzp_pay_BAL0000001);
  const again = await bp.handleVerifyBalancePayment({ orderId: o.orderId, paymentId: "pay_BAL0000001", signature: sign(o.orderId, "pay_BAL0000001") }, ctx("custA"), e.deps);
  assert.ok(again.already); assert.strictEqual(e.db.col("bookings").bkA0000001.paid, 5000, "not added twice");
});
test("verify: bad signature, someone else's order, not captured, wrong order or amount are all refused", async () => {
  const e = env(); const o = await created(e);
  const base = { orderId: o.orderId, paymentId: "pay_BAL0000002" };
  await rejects(bp.handleVerifyBalancePayment(Object.assign({ signature: "a".repeat(64) }, base), ctx("custA"), e.deps), "permission-denied");
  await rejects(bp.handleVerifyBalancePayment(Object.assign({ signature: sign(o.orderId, "pay_BAL0000002") }, base), ctx("custB"), e.deps), "not-found");
  e.payments.pay_BAL0000002 = { id: "pay_BAL0000002", order_id: o.orderId, amount: 450000, currency: "INR", status: "authorized" };
  await rejects(bp.handleVerifyBalancePayment(Object.assign({ signature: sign(o.orderId, "pay_BAL0000002") }, base), ctx("custA"), e.deps), "failed-precondition");
  e.payments.pay_BAL0000002 = { id: "pay_BAL0000002", order_id: "order_OTHER00001", amount: 450000, currency: "INR", status: "captured" };
  await rejects(bp.handleVerifyBalancePayment(Object.assign({ signature: sign(o.orderId, "pay_BAL0000002") }, base), ctx("custA"), e.deps), "permission-denied");
  e.payments.pay_BAL0000002 = { id: "pay_BAL0000002", order_id: o.orderId, amount: 100, currency: "INR", status: "captured" };
  await rejects(bp.handleVerifyBalancePayment(Object.assign({ signature: sign(o.orderId, "pay_BAL0000002") }, base), ctx("custA"), e.deps), "failed-precondition");
  assert.strictEqual(e.db.col("bookings").bkA0000001.balanceDue, 4500, "nothing applied");
});
test("webhook + browser both settling the same payment never double-count", async () => {
  const e = env(); const o = await created(e);
  const pay = { id: "pay_BAL0000003", order_id: o.orderId, amount: 450000, currency: "INR", status: "captured" };
  const a = await bp.applyBalancePayment(e.deps, o.orderId, pay); const b = await bp.applyBalancePayment(e.deps, o.orderId, pay);
  assert.deepStrictEqual([a.result, b.result], ["processed", "already"]);
  assert.strictEqual(e.db.col("bookings").bkA0000001.paid, 5000);
  assert.strictEqual((await bp.applyBalancePayment(e.deps, "order_UNKNOWN0001", pay)).result, "unmatched", "non-balance orders untouched");
});
test("overpayment (two orders both paid) is recorded and flagged; balance never negative", async () => {
  const e = env(); const o1 = await created(e); const o2 = await created(e);
  await bp.applyBalancePayment(e.deps, o1.orderId, { id: "pay_BAL0000004", order_id: o1.orderId, amount: 450000, currency: "INR" });
  await bp.applyBalancePayment(e.deps, o2.orderId, { id: "pay_BAL0000005", order_id: o2.orderId, amount: 450000, currency: "INR" });
  const b = e.db.col("bookings").bkA0000001;
  assert.deepStrictEqual([b.balanceDue, b.paid, b.overpaidAmount, b.needsRefundReview], [0, 9500, 4500, true]);
});
test("webhook settles balance orders (closed browser); move/catalog orders unchanged", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "payment-webhook.js"), "utf8");
  assert.ok(src.includes('bp.applyBalancePayment({ db, now: () => Date.now() }, orderId, pay)'));
  assert.ok(src.indexOf("applyBalancePayment") > src.indexOf("PENDING_COLLECTION).doc(orderId).get()"), "only after the move-order lookup misses");
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(idx.includes("exports.createBalanceOrder") && idx.includes("exports.verifyBalancePayment"));
});
test("UI: Pay balance button on active bookings with a balance; page never sends an amount", () => {
  const s = fs.readFileSync(path.join(ROOT, "public/script.js"), "utf8");
  assert.ok(s.includes('data-action="paybalance"') && s.includes("payBalanceOnline(id, this)"));
  const fn = s.slice(s.indexOf("async function payBalanceOnline"), s.indexOf("function loadUserAddresses"));
  assert.ok(fn.includes('httpsCallable("createBalanceOrder")({ bookingId })') && !/amount\s*:\s*(?!o\.amount)/.test(fn.replace("amount: o.amount", "")));
  assert.ok(fs.readFileSync(path.join(ROOT, "public/catalog-public.js"), "utf8").includes('" / " + unitLabel(item)'), "₹429 / AC labels");
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e)); } }
  console.log(`\nbalance-payment: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
