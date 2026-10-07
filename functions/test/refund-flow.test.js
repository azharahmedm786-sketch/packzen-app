/**
 * Refund-flow verification for a Razorpay DASHBOARD refund of a live advance
 * payment (the ₹420 smoke test shape). Mocks only — no network, no Razorpay.
 *   node test/refund-flow.test.js
 */
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const wh = require("../payment-webhook.js");
const rf = require("../payment-refund.js");
const ops = require("../ops-alerts.js");

const WH_SECRET = "test_webhook_secret_not_real";
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
function makeDb() {
  const store = {}; let seq = 0;
  const col = (n) => (store[n] = store[n] || {});
  const has = (n, id) => Object.prototype.hasOwnProperty.call(col(n), id);
  const snap = (n, id) => ({ exists: has(n, id), id, data: () => clone(col(n)[id]), ref: ref(n, id) });
  function ref(n, id) { return { _n: n, id, get: async () => snap(n, id), set: async (d) => { col(n)[id] = clone(d); }, update: async (d) => { Object.assign(col(n)[id], clone(d)); } }; }
  const cmp = (v, op, x) => (op === "==" ? v === x : op === "in" ? x.includes(v) : op === ">=" ? (typeof v === "number" ? v : Date.parse(v)) >= (x instanceof Date ? x.getTime() : x) : false);
  function query(n, f, lim) { return { where: (a, op, b) => query(n, f.concat([[a, op, b]]), lim), limit: (k) => query(n, f, k),
    get: async () => { let ids = Object.keys(col(n)).filter((id) => f.every(([a, op, b]) => cmp(col(n)[id][a], op, b))); if (lim) ids = ids.slice(0, lim); return { docs: ids.map((id) => snap(n, id)), empty: !ids.length }; } }; }
  let chain = Promise.resolve();
  return { store, col, collection: (n) => Object.assign(query(n, [], null), { doc: (id) => ref(n, id || "auto" + (++seq)), add: async (d) => { const id = "auto" + (++seq); col(n)[id] = clone(d); return { id }; } }),
    runTransaction(fn) { const run = chain.then(async () => { const w = [];
      const tx = { get: async (r) => snap(r._n, r.id), set: (r, d) => w.push(() => { col(r._n)[r.id] = clone(d); }), update: (r, d) => w.push(() => { Object.assign(col(r._n)[r.id], clone(d)); }),
        create: (r, d) => w.push(() => { if (has(r._n, r.id)) throw new Error("EXISTS"); col(r._n)[r.id] = clone(d); }) };
      const out = await fn(tx); w.forEach((x) => x()); return out; }); chain = run.catch(() => {}); return run; } };
}
const quiet = { info() {}, warn() {}, error() {} };

// The smoke-test booking as Phase 1 verifyRazorpayPayment created it (advance ₹420 of ₹4,204).
const ORDER = "order_SMOKE0000001", PAY = "pay_SMOKE00000001";
function env() {
  const db = makeDb();
  db.col("bookings")[ORDER] = { bookingRef: "PKZ-00000001", customerUid: "cust1", status: "confirmed", paymentType: "advance", paymentStatus: "partially_paid",
    total: 4204, paid: 420, balanceDue: 3784, fullPaymentDiscount: 0, currency: "INR", orderId: ORDER, paymentId: PAY, confirmedVia: "verify", email: "c@example.com" };
  db.col("pendingPayments")[ORDER] = { uid: "cust1", status: "consumed", payNow: 420, grandTotal: 4204, currency: "INR", createdAt: "2026-10-06T08:00:00Z" };
  const deps = { db, serverTimestamp: () => "TS", now: () => Date.UTC(2026, 9, 7, 6), logger: quiet, webhookSecret: WH_SECRET };
  return { db, deps };
}
// Razorpay Dashboard refunds carry no PackZen notes.
const dashRefund = (over) => Object.assign({ id: "rfnd_DASH0000001", payment_id: PAY, amount: 42000, status: "processed", notes: [] }, over || {});
function webhookReq(event, entity, eventId) {
  const raw = Buffer.from(JSON.stringify({ entity: "event", event, payload: { refund: { entity } } }));
  return { method: "POST", rawBody: raw, headers: { "x-razorpay-event-id": eventId, "x-razorpay-signature": crypto.createHmac("sha256", WH_SECRET).update(raw).digest("hex") } };
}
const tests = []; const test = (n, f) => tests.push({ n, f });

test("dashboard instant refund (refund.created then refund.processed) is recognized and recorded once", async () => {
  const { db, deps } = env();
  const r1 = await wh.handleWebhook(webhookReq("refund.created", dashRefund({ status: "processed" }), "evt_R1"), deps);
  const r2 = await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R2"), deps);
  assert.strictEqual(r1.status, 200); assert.strictEqual(r1.body.status, "processed");
  assert.strictEqual(r2.status, 200); assert.strictEqual(r2.body.status, "processed");
  const recs = Object.values(db.col("paymentRefunds"));
  assert.strictEqual(recs.length, 1, "one refund record");
  assert.deepStrictEqual([recs[0].status, recs[0].amountPaise, recs[0].source, recs[0].razorpayRefundId, recs[0].paymentId], ["processed", 42000, "razorpay", "rfnd_DASH0000001", PAY]);
  assert.strictEqual(db.col("paymentRefundsByRzp").rfnd_DASH0000001.recordId, "rzp_rfnd_DASH0000001");
});
test("booking reflects a FULL refund; total/paid/balanceDue are not changed (no balance increase)", async () => {
  const { db, deps } = env();
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R3"), deps);
  const b = db.col("bookings")[ORDER];
  assert.strictEqual(b.refundedAmount, 420); assert.strictEqual(b.refundPendingAmount, 0); assert.strictEqual(b.refundAmount, 420);
  assert.strictEqual(b.refundStatus, "processed"); assert.strictEqual(b.paymentStatus, "refunded"); assert.strictEqual(b.preRefundPaymentStatus, "partially_paid");
  assert.deepStrictEqual([b.total, b.paid, b.balanceDue], [4204, 420, 3784], "money fields untouched");
  assert.deepStrictEqual(b.refundRecordIds, ["rzp_rfnd_DASH0000001"]);
  assert.strictEqual(b.status, "confirmed", "a refund does not cancel the booking by itself");
});
test("same refund event delivered again (same event id) is ignored", async () => {
  const { db, deps } = env();
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R4"), deps);
  const before = clone(db.col("bookings")[ORDER]);
  const again = await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R4"), deps);
  assert.strictEqual(again.body.duplicate, true); assert.deepStrictEqual(db.col("bookings")[ORDER], before);
});
test("same refund under a new event id is not double-counted", async () => {
  const { db, deps } = env();
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R5"), deps);
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R6"), deps);
  await wh.handleWebhook(webhookReq("refund.created", dashRefund(), "evt_R7"), deps);
  assert.strictEqual(db.col("bookings")[ORDER].refundedAmount, 420); assert.strictEqual(Object.keys(db.col("paymentRefunds")).length, 1);
});
test("after the dashboard refund, adminRefundPayment cannot refund again (no double refund)", async () => {
  const { db, deps } = env();
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R8"), deps);
  let calls = 0;
  const rdeps = Object.assign({}, deps, { isAdmin: async () => true, createRefund: async () => { calls++; return {}; } });
  for (const data of [{ full: true }, { amount: 1 }]) {
    await assert.rejects(rf.handleRefund(Object.assign({ bookingId: ORDER, paymentId: PAY, reason: "test", requestId: "rq_after_dash_" + calls + Math.random().toString(36).slice(2, 6) }, data), { auth: { uid: "adm" } }, rdeps),
      (e) => e.code === "failed-precondition");
  }
  assert.strictEqual(calls, 0, "Razorpay was never called");
});
test("reconciliation does not treat the refunded payment as an unpaid/captured orphan", async () => {
  const { db, deps } = env();
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R9"), deps);
  let fetched = 0;
  const sum = await wh.reconcilePendingPayments(Object.assign({}, deps, { fetchOrderPayments: async () => { fetched++; return [{ id: PAY, order_id: ORDER, amount: 42000, currency: "INR", status: "refunded" }]; } }));
  assert.strictEqual(sum.scanned, 0); assert.strictEqual(fetched, 0, "consumed orders are not re-examined");
  assert.strictEqual(db.col("bookings")[ORDER].paymentStatus, "refunded");
  // even a captured-payment webhook replay for the same order leaves the booking alone
  const raw = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: PAY, order_id: ORDER, amount: 42000, currency: "INR", status: "captured" } } } }));
  await wh.handleWebhook({ method: "POST", rawBody: raw, headers: { "x-razorpay-event-id": "evt_CAP", "x-razorpay-signature": crypto.createHmac("sha256", WH_SECRET).update(raw).digest("hex") } }, Object.assign({}, deps, { sendConfirmation: async () => { throw new Error("must not email"); } }));
  assert.strictEqual(Object.keys(db.col("bookings")).length, 1); assert.strictEqual(db.col("bookings")[ORDER].paymentStatus, "refunded");
});
test("ops digest raises nothing for a cleanly processed refund", async () => {
  const { db, deps } = env();
  db.col("bookings")[ORDER].date = "2030-01-01";
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund(), "evt_R10"), deps);
  const issues = await ops.collectIssues(db, deps.now());
  assert.deepStrictEqual(issues.map((i) => i.type), []);
});
test("partial dashboard refund → partially_refunded; failed refund releases nothing", async () => {
  const { db, deps } = env();
  await wh.handleWebhook(webhookReq("refund.processed", dashRefund({ id: "rfnd_PART000001", amount: 10000 }), "evt_P1"), deps);
  assert.strictEqual(db.col("bookings")[ORDER].paymentStatus, "partially_refunded"); assert.strictEqual(db.col("bookings")[ORDER].refundedAmount, 100);
  await wh.handleWebhook(webhookReq("refund.failed", dashRefund({ id: "rfnd_FAIL000001", amount: 5000, status: "failed" }), "evt_P2"), deps);
  assert.strictEqual(db.col("bookings")[ORDER].refundedAmount, 100); assert.strictEqual(db.col("bookings")[ORDER].refundPendingAmount, 0);
});
test("refund for a payment PackZen doesn't know → 'unmatched', nothing written to bookings", async () => {
  const { db, deps } = env();
  const r = await wh.handleWebhook(webhookReq("refund.processed", dashRefund({ id: "rfnd_OTHER00001", payment_id: "pay_UNKNOWN00001" }), "evt_U1"), deps);
  assert.strictEqual(r.body.status, "unmatched"); assert.ok(!db.col("bookings")[ORDER].refundRecordIds);
  assert.strictEqual(db.col("razorpayWebhookEvents").evt_U1.status, "unmatched");
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e)); } }
  console.log(`\nrefund-flow: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
