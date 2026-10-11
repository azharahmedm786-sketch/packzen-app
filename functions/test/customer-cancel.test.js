/** Level 2 — customer self-cancel with full refund before the job day. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cc = require("../customer-cancel.js");
const clone = (o) => JSON.parse(JSON.stringify(o));
function makeDb() {
  const store = {};
  const col = (p) => (store[p] = store[p] || {});
  const ref = (p, id) => ({ get: async () => ({ exists: id in col(p), data: () => clone(col(p)[id]) }), set: async (d) => { col(p)[id] = clone(d); },
    update: async (d) => { col(p)[id] = Object.assign(col(p)[id] || {}, clone(d)); } });
  return { store, col, collection: (p) => ({ doc: (id) => ref(p, id) }),
    runTransaction: async (fn) => { const w = []; const tx = { get: (r) => r.get(), set: (r, d) => w.push(() => r.set(d)), update: (r, d) => w.push(() => r.update(d)) };
      const o = await fn(tx); for (const f of w) await f(); return o; } };
}
const NOW = Date.parse("2026-10-14T10:00:00+05:30"); // IST 14 Oct
function env(b, refundImpl) {
  const db = makeDb(); const calls = [];
  db.col("bookings").bk00000001 = Object.assign({ customerUid: "custA", status: "confirmed", date: "2026-10-15", paid: 420, paymentId: "pay_ABC123456", paymentStatus: "partially_paid" }, b || {});
  const deps = { db, now: () => NOW, logger: { info() {}, error() {} }, refund: async (req) => { calls.push(req); return refundImpl ? refundImpl(req) : { ok: true, status: "processed", amount: 420 }; } };
  return { db, deps, calls };
}
const ctx = (u) => ({ auth: { uid: u } });
const tests = []; const test = (n, f) => tests.push({ n, f });
async function rejects(p, code, re) { try { await p; } catch (e) { assert.strictEqual(e.code, code, e.message); if (re) assert.ok(re.test(e.publicMessage), e.publicMessage); return; } throw new Error("expected " + code); }
const go = (e, u, extra) => cc.handleCustomerCancel(Object.assign({ bookingId: "bk00000001", reason: "Change of plans" }, extra || {}), ctx(u || "custA"), e.deps);

test("before the job day: cancelled + FULL refund requested once with a fixed request id", async () => {
  const e = env(); const r = await go(e);
  assert.deepStrictEqual([r.ok, r.refund.status, r.refund.amount], [true, "processed", 420]);
  assert.strictEqual(e.db.col("bookings").bk00000001.status, "cancelled");
  assert.deepStrictEqual([e.calls.length, e.calls[0].full, e.calls[0].requestId, e.calls[0].paymentId], [1, true, "custcancel", "pay_ABC123456"]);
  assert.ok(e.db.col("cancelRequests")["bk00000001__customer"]);
});
test("retry after a cancel re-requests the SAME refund id (payment-refund replays, never double-refunds)", async () => {
  const e = env(); await go(e); const r = await go(e);
  assert.ok(r.already); assert.ok(e.calls.every((c) => c.requestId === "custcancel"));
});
test("on/after the job day (IST) and once the job has started: refused, nothing changed", async () => {
  for (const b of [{ date: "2026-10-14" }, { date: "2026-10-01" }, { status: "packing" }, { status: "transit" }, { status: "delivered" }]) {
    const e = env(b); await rejects(go(e), "failed-precondition"); assert.notStrictEqual(e.db.col("bookings").bk00000001.status, "cancelled"); assert.strictEqual(e.calls.length, 0);
  }
  // IST boundary: 23:30 UTC on 13 Oct is already 14 Oct in India
  const e = env({ date: "2026-10-14" }); e.deps.now = () => Date.parse("2026-10-13T23:30:00Z"); await rejects(go(e), "failed-precondition", /before the job day/);
});
test("only the owner, signed in, with a reason", async () => {
  await rejects(go(env(), "custB"), "permission-denied");
  await rejects(cc.handleCustomerCancel({ bookingId: "bk00000001", reason: "x" }, {}, env().deps), "unauthenticated");
  await rejects(go(env(), "custA", { reason: "  " }), "invalid-argument");
});
test("pay-later booking (nothing paid): cancelled, no refund call", async () => {
  const e = env({ paid: 0, paymentId: null }); const r = await go(e);
  assert.strictEqual(r.refund.status, "none"); assert.strictEqual(e.calls.length, 0);
});
test("refund failure never undoes the cancellation; booking flagged for admin review", async () => {
  const e = env({}, () => { throw new Error("razorpay down"); }); const r = await go(e);
  assert.strictEqual(r.refund.status, "needs_review");
  const b = e.db.col("bookings").bk00000001; assert.deepStrictEqual([b.status, b.needsRefundReview], ["cancelled", true]);
});
test("wiring: callable uses the audited refund core; page calls the server; policy text matches", () => {
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(idx.includes("exports.customerCancelBooking") && idx.includes("paymentRefund.handleRefund(req, { auth: { uid: \"system:customer-cancel\" } }, refundDeps)"));
  const s = fs.readFileSync(path.join(__dirname, "..", "..", "public/script.js"), "utf8");
  assert.ok(s.includes('httpsCallable("customerCancelBooking")({ bookingId: docId, reason })'));
  assert.ok(!/collection\("bookings"\)\.doc\(docId\)\.update\(\{ status:"cancelled"/.test(s), "no client-side status write for cancel");
  const pol = fs.readFileSync(path.join(__dirname, "..", "..", "public/legal/refund.html"), "utf8");
  assert.ok(pol.includes("Any time before the job day") && !pol.includes("₹300 cancellation fee"));
  assert.ok(!fs.readFileSync(path.join(__dirname, "..", "..", "public/index.html"), "utf8").includes("₹300 fee"));
});
(async () => { let p = 0, f = 0; for (const t of tests) { try { await t.f(); p++; console.log("  PASS  " + t.n); } catch (e) { f++; console.log("  FAIL  " + t.n + "\n        " + (e.stack || e).split("\n").slice(0, 2).join(" | ")); } }
  console.log(`\ncustomer-cancel: ${p} passed, ${f} failed`); process.exit(f ? 1 : 0); })();
