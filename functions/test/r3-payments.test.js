/**
 * R3 — Razorpay webhook, reconciliation and refund regression suite.
 * Mocks only: in-memory Firestore (serialized transactions, simple queries),
 * fake Razorpay, fake Auth. No network, no emulator, no production data.
 *
 *   node test/r3-payments.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const mp = require("../move-payment.js");
const wh = require("../payment-webhook.js");
const rf = require("../payment-refund.js");
const PackZenPricing = require("../pricing-engine-v2.js");

const KEY_SECRET = "test_key_secret_not_real";
const WH_SECRET = "test_webhook_secret_not_real";
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* ── in-memory Firestore ── */
function makeDb() {
  const store = {};
  const col = (n) => (store[n] = store[n] || {});
  const snap = (n, id) => ({ exists: has(col(n), id), id, data: () => clone(col(n)[id]), ref: ref(n, id) });
  function ref(n, id) {
    return { _n: n, id,
      get: async () => snap(n, id),
      set: async (d) => { col(n)[id] = clone(d); },
      update: async (d) => { if (!has(col(n), id)) throw new Error("NOT_FOUND"); Object.assign(col(n)[id], clone(d)); } };
  }
  function query(n, filters, lim) {
    return {
      where: (f, op, v) => query(n, filters.concat([[f, op, v]]), lim),
      limit: (k) => query(n, filters, k),
      get: async () => {
        let ids = Object.keys(col(n)).filter((id) => filters.every(([f, op, v]) => op === "==" ? col(n)[id][f] === v : op === "in" ? v.includes(col(n)[id][f]) : false));
        if (lim) ids = ids.slice(0, lim);
        return { docs: ids.map((id) => snap(n, id)), size: ids.length };
      },
    };
  }
  let chain = Promise.resolve();
  const db = {
    store, col, txCount: 0,
    collection: (n) => Object.assign(query(n, [], null), { doc: (id) => ref(n, id) }),
    runTransaction(fn) {
      const run = chain.then(async () => {
        db.txCount++;
        const writes = [];
        const tx = {
          get: async (r) => snap(r._n, r.id),
          create: (r, d) => writes.push(() => { if (has(col(r._n), r.id)) throw new Error("ALREADY_EXISTS"); col(r._n)[r.id] = clone(d); }),
          set: (r, d) => writes.push(() => { col(r._n)[r.id] = clone(d); }),
          update: (r, d) => writes.push(() => { Object.assign(col(r._n)[r.id], clone(d)); }),
        };
        const out = await fn(tx);
        writes.forEach((w) => w());
        return out;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
  return db;
}

const TOKENS = { tokA: { uid: "uidA", email: "alice@example.com", email_verified: true } };
function makeLogger() {
  const lines = [];
  const rec = (l) => (m, d) => lines.push(l + " " + m + " " + JSON.stringify(d || {}));
  return { lines, info: rec("info"), warn: rec("warn"), error: rec("error") };
}

let seq = 0;
function makeEnv() {
  const db = makeDb(); const logger = makeLogger(); const emails = []; const payments = {}; const orderPayments = {};
  const refundCalls = []; let refundBehaviour = "ok";
  const base = { db, logger, serverTimestamp: () => "TS", now: () => Date.UTC(2026, 9, 6, 12, 0, 0),
    sendConfirmation: async (d) => { emails.push(d); } };
  const env = {
    db, logger, emails, payments, orderPayments, refundCalls,
    setRefundBehaviour: (b) => { refundBehaviour = b; },
    createDeps: Object.assign({}, base, {
      verifyIdToken: async (t) => { if (!TOKENS[t]) throw new Error("bad"); return TOKENS[t]; },
      quote: async (qi) => { qi.km = 12; return PackZenPricing.calculateQuote(qi); },
      normalize: (qi) => PackZenPricing.validateInput(qi).data,
      createOrder: async (o) => ({ id: "order_R3TEST" + String(++seq).padStart(6, "0"), amount: o.amount, currency: o.currency }),
    }),
    verifyDeps: Object.assign({}, base, {
      verifyIdToken: async (t) => { if (!TOKENS[t]) throw new Error("bad"); return TOKENS[t]; },
      keySecret: KEY_SECRET,
      fetchPayment: async (id) => clone(payments[id]),
    }),
    whDeps: Object.assign({}, base, { webhookSecret: WH_SECRET }),
    recDeps: Object.assign({}, base, { fetchOrderPayments: async (oid) => clone(orderPayments[oid] || []) }),
    refDeps: Object.assign({}, base, {
      isAdmin: async (ctx) => ctx.auth.uid === "admin1",
      createRefund: async (pid, opts) => {
        refundCalls.push({ pid, opts: clone(opts) });
        if (refundBehaviour === "reject") throw Object.assign(new Error("BAD_REQUEST_ERROR"), { statusCode: 400 });
        if (refundBehaviour === "network") throw new Error("ETIMEDOUT");
        return { id: "rfnd_TEST" + String(refundCalls.length).padStart(6, "0"), amount: opts.amount, status: refundBehaviour === "pending" ? "pending" : "processed", payment_id: pid };
      },
    }),
  };
  return env;
}

const QI = { pickup: "Koramangala, Bangalore", drop: "Whitefield, Bangalore", vehicleId: "tata_ace", furniture: {}, cartonQty: 5, pickupFloor: 1, dropFloor: 2, liftAvailable: false, packingService: true };
async function newOrder(env, paymentType = "advance") {
  const out = await mp.handleCreateOrder({ headers: { authorization: "Bearer tokA" }, body: {
    quoteInput: clone(QI), paymentType, customerName: "Asha Rao", phone: "9876543210", moveType: "home",
    pickup: "Koramangala, Bangalore", drop: "Whitefield, Bangalore", date: "2026-11-20", requestId: "req_" + crypto.randomBytes(6).toString("hex") } }, env.createDeps);
  assert.strictEqual(out.status, 200, JSON.stringify(out.body));
  return out.body;
}
function payment(order, over) {
  const id = "pay_R3" + crypto.randomBytes(5).toString("hex");
  return Object.assign({ id, order_id: order.orderId, amount: order.amount, currency: "INR", status: "captured", email: "alice@example.com", contact: "+919876543210" }, over || {});
}
function webhookReq(event, entityKey, entity, opts) {
  const o = opts || {};
  const raw = Buffer.from(JSON.stringify({ entity: "event", event, payload: { [entityKey]: { entity } } }));
  const sig = o.badSig ? "f".repeat(64) : crypto.createHmac("sha256", WH_SECRET).update(raw).digest("hex");
  return { method: "POST", rawBody: o.tamper ? Buffer.from(raw.toString().replace("captured", "capturez")) : raw,
           headers: Object.assign({ "x-razorpay-event-id": o.eventId || "evt_" + crypto.randomBytes(6).toString("hex") }, o.noSig ? {} : { "x-razorpay-signature": sig }) };
}
const send = (env, req) => wh.handleWebhook(req, env.whDeps);
async function verify(env, pay) {
  env.payments[pay.id] = pay;
  const sig = crypto.createHmac("sha256", KEY_SECRET).update(pay.order_id + "|" + pay.id).digest("hex");
  return mp.handleVerifyPayment({ headers: { authorization: "Bearer tokA" }, body: { razorpay_order_id: pay.order_id, razorpay_payment_id: pay.id, razorpay_signature: sig } }, env.verifyDeps);
}
const bookings = (env) => Object.keys(env.db.col("bookings"));
const pending = (env, o) => env.db.col("pendingPayments")[o.orderId];
const adminCtx = { auth: { uid: "admin1", token: { email_verified: true } } };
async function paidBooking(env, type = "advance") { const o = await newOrder(env, type); const p = payment(o); await verify(env, p); return { o, p, id: o.orderId }; }
const refund = (env, data, ctx = adminCtx) => rf.handleRefund(data, ctx, env.refDeps);
async function rejects(promise, code) { try { await promise; } catch (e) { assert.strictEqual(e.code, code, "expected " + code + " got " + e.code); return e; } throw new Error("expected rejection " + code); }

const tests = []; const test = (n, f) => tests.push({ n, f });

/* ── WEBHOOK: signatures & structure ── */
test("webhook: valid signature + captured, no browser verify → exactly one booking (confirmedVia webhook)", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o);
  const r = await send(e, webhookReq("payment.captured", "payment", p));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.status, "processed");
  const b = e.db.col("bookings")[o.orderId];
  assert.ok(b); assert.strictEqual(b.confirmedVia, "webhook"); assert.strictEqual(b.customerUid, "uidA");
  assert.strictEqual(b.total, o.grandTotal); assert.strictEqual(b.paid, o.payNow); assert.strictEqual(b.balanceDue, o.grandTotal - o.payNow);
  assert.strictEqual(pending(e, o).status, "consumed"); assert.strictEqual(e.emails.length, 1);
});
test("webhook: invalid signature → 400, nothing written", async () => {
  const e = makeEnv(); const o = await newOrder(e);
  const r = await send(e, webhookReq("payment.captured", "payment", payment(o), { badSig: true }));
  assert.strictEqual(r.status, 400); assert.strictEqual(bookings(e).length, 0); assert.strictEqual(Object.keys(e.db.col("razorpayWebhookEvents")).length, 0);
});
test("webhook: missing signature / tampered body / wrong secret → 400", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o);
  assert.strictEqual((await send(e, webhookReq("payment.captured", "payment", p, { noSig: true }))).status, 400);
  assert.strictEqual((await send(e, webhookReq("payment.captured", "payment", p, { tamper: true }))).status, 400);
  assert.strictEqual((await wh.handleWebhook(webhookReq("payment.captured", "payment", p), Object.assign({}, e.whDeps, { webhookSecret: "other" }))).status, 400);
  assert.strictEqual((await wh.handleWebhook(webhookReq("payment.captured", "payment", p), Object.assign({}, e.whDeps, { webhookSecret: "" }))).status, 400);
  assert.strictEqual(bookings(e).length, 0);
});
test("webhook: malformed entity → 400; unsupported event → 200 ignored", async () => {
  const e = makeEnv(); const o = await newOrder(e);
  assert.strictEqual((await send(e, webhookReq("payment.captured", "payment", { id: "nope" }))).status, 400);
  const r = await send(e, webhookReq("subscription.charged", "payment", payment(o)));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.status, "ignored"); assert.strictEqual(bookings(e).length, 0);
});
test("webhook: duplicate event id → processed once", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o);
  const r1 = await send(e, webhookReq("payment.captured", "payment", p, { eventId: "evt_DUP1" }));
  const r2 = await send(e, webhookReq("payment.captured", "payment", p, { eventId: "evt_DUP1" }));
  assert.strictEqual(r1.body.status, "processed"); assert.strictEqual(r2.body.duplicate, true);
  assert.strictEqual(bookings(e).length, 1); assert.strictEqual(e.emails.length, 1);
});
test("webhook: same capture delivered under two event ids → still one booking", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o);
  await send(e, webhookReq("payment.captured", "payment", p)); await send(e, webhookReq("order.paid", "payment", p));
  assert.strictEqual(bookings(e).length, 1); assert.strictEqual(e.emails.length, 1);
});

/* ── WEBHOOK ⇄ VERIFY ordering ── */
test("webhook before browser verification → verify returns the same booking", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o);
  await send(e, webhookReq("payment.captured", "payment", p));
  const v = await verify(e, p);
  assert.strictEqual(v.status, 200); assert.strictEqual(v.body.duplicate, true); assert.strictEqual(bookings(e).length, 1);
});
test("webhook after browser verification → booking unchanged, webhookConfirmedAt set", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o);
  await verify(e, p); const before = clone(e.db.col("bookings")[o.orderId]);
  const r = await send(e, webhookReq("payment.captured", "payment", p));
  const after = e.db.col("bookings")[o.orderId];
  assert.strictEqual(r.body.status, "processed"); assert.strictEqual(after.webhookConfirmedAt, "TS");
  for (const k of ["total", "paid", "balanceDue", "paymentStatus", "customerUid", "paymentId", "confirmedVia"]) assert.deepStrictEqual(after[k], before[k], k);
  assert.strictEqual(e.emails.length, 1);
});
test("race: verify ×3 + webhook ×3 concurrently → exactly one booking, one email", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o); e.payments[p.id] = p;
  const outs = await Promise.all([verify(e, p), send(e, webhookReq("payment.captured", "payment", p)), verify(e, p),
    send(e, webhookReq("order.paid", "payment", p)), verify(e, p), send(e, webhookReq("payment.captured", "payment", p))]);
  assert.strictEqual(bookings(e).length, 1); assert.strictEqual(e.emails.length, 1);
  assert.ok(outs.every((x) => x.status === 200), JSON.stringify(outs.map((x) => x.status)));
});
test("capture conflict: booking exists with a different payment → conflict, untouched", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p1 = payment(o); await verify(e, p1);
  const before = clone(e.db.col("bookings")[o.orderId]);
  const r = await send(e, webhookReq("payment.captured", "payment", payment(o)));
  assert.strictEqual(r.body.status, "conflict"); assert.deepStrictEqual(e.db.col("bookings")[o.orderId], before);
});

/* ── WEBHOOK: non-captured states ── */
test("payment.authorized → pending authorized, no booking", async () => {
  const e = makeEnv(); const o = await newOrder(e);
  await send(e, webhookReq("payment.authorized", "payment", payment(o, { status: "authorized" })));
  assert.strictEqual(pending(e, o).status, "authorized"); assert.strictEqual(bookings(e).length, 0);
});
test("payment.failed → pending failed; later capture on same order still wins", async () => {
  const e = makeEnv(); const o = await newOrder(e);
  await send(e, webhookReq("payment.failed", "payment", payment(o, { status: "failed", error_code: "BAD_REQUEST_ERROR" })));
  assert.strictEqual(pending(e, o).status, "failed"); assert.strictEqual(bookings(e).length, 0);
  await send(e, webhookReq("payment.captured", "payment", payment(o)));
  assert.strictEqual(bookings(e).length, 1); assert.strictEqual(pending(e, o).status, "consumed");
});
test("payment.failed after booking exists → no change", async () => {
  const e = makeEnv(); const { o } = await paidBooking(e); const before = clone(e.db.col("bookings")[o.orderId]);
  await send(e, webhookReq("payment.failed", "payment", payment(o, { status: "failed" })));
  assert.strictEqual(pending(e, o).status, "consumed"); assert.deepStrictEqual(e.db.col("bookings")[o.orderId], before);
});
test("amount mismatch / currency mismatch → needs_review, no booking", async () => {
  const e = makeEnv(); const o = await newOrder(e);
  const r = await send(e, webhookReq("payment.captured", "payment", payment(o, { amount: o.amount - 100 })));
  assert.strictEqual(r.body.status, "mismatch"); assert.strictEqual(pending(e, o).status, "needs_review"); assert.strictEqual(bookings(e).length, 0);
  const o2 = await newOrder(e);
  await send(e, webhookReq("payment.captured", "payment", payment(o2, { currency: "USD" })));
  assert.strictEqual(pending(e, o2).status, "needs_review"); assert.strictEqual(bookings(e).length, 0);
});
test("missing booking and pending (unknown/catalog order) → 200 unmatched, recorded", async () => {
  const e = makeEnv();
  const r = await send(e, webhookReq("payment.captured", "payment", payment({ orderId: "order_UNKNOWN000001", amount: 50000 }), { eventId: "evt_UNM1" }));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.status, "unmatched");
  assert.strictEqual(e.db.col("razorpayWebhookEvents").evt_UNM1.status, "unmatched"); assert.strictEqual(bookings(e).length, 0);
});
test("legacy pending without uid → needs_review, no booking", async () => {
  const e = makeEnv(); const o = await newOrder(e); delete e.db.col("pendingPayments")[o.orderId].uid;
  const r = await send(e, webhookReq("payment.captured", "payment", payment(o)));
  assert.strictEqual(r.body.status, "needs_review"); assert.strictEqual(bookings(e).length, 0);
});
test("transient failure → 500 and event left re-processable; retry succeeds once", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o);
  const realRun = e.db.runTransaction.bind(e.db); let calls = 0;
  e.db.runTransaction = (fn) => { calls++; if (calls === 2) return Promise.reject(new Error("UNAVAILABLE")); return realRun(fn); };
  const r1 = await send(e, webhookReq("payment.captured", "payment", p, { eventId: "evt_RETRY" }));
  e.db.runTransaction = realRun;
  assert.strictEqual(r1.status, 500); assert.strictEqual(e.db.col("razorpayWebhookEvents").evt_RETRY.status, "processing");
  const r2 = await send(e, webhookReq("payment.captured", "payment", p, { eventId: "evt_RETRY" }));
  assert.strictEqual(r2.body.status, "processed"); assert.strictEqual(bookings(e).length, 1);
});

/* ── RECONCILIATION ── */
test("reconcile: captured but verify AND webhook lost → booking finalized", async () => {
  const e = makeEnv(); const o = await newOrder(e); e.db.col("pendingPayments")[o.orderId].createdAt = new Date(Date.UTC(2026, 9, 6, 11, 0, 0));
  e.orderPayments[o.orderId] = [payment(o, { status: "failed" }), payment(o)];
  const s = await wh.reconcilePendingPayments(e.recDeps);
  assert.strictEqual(s.finalized, 1); assert.strictEqual(e.db.col("bookings")[o.orderId].confirmedVia, "reconciliation");
  const again = await wh.reconcilePendingPayments(e.recDeps); assert.strictEqual(again.scanned, 0); assert.strictEqual(bookings(e).length, 1);
});
test("reconcile: young pending skipped; authorized marked; expired with no payment → expired", async () => {
  const e = makeEnv();
  const young = await newOrder(e); e.db.col("pendingPayments")[young.orderId].createdAt = new Date(Date.UTC(2026, 9, 6, 11, 55, 0));
  const auth = await newOrder(e); e.db.col("pendingPayments")[auth.orderId].createdAt = new Date(Date.UTC(2026, 9, 6, 10, 0, 0));
  e.orderPayments[auth.orderId] = [payment(auth, { status: "authorized" })];
  const dead = await newOrder(e); Object.assign(e.db.col("pendingPayments")[dead.orderId], { createdAt: new Date(Date.UTC(2026, 9, 4)), expiresAt: new Date(Date.UTC(2026, 9, 5)) });
  const s = await wh.reconcilePendingPayments(e.recDeps);
  assert.strictEqual(s.skippedYoung, 1); assert.strictEqual(s.authorized, 1); assert.strictEqual(s.expired, 1);
  assert.strictEqual(pending(e, auth).status, "authorized"); assert.strictEqual(pending(e, dead).status, "expired"); assert.strictEqual(pending(e, young).status, "created");
  assert.strictEqual(bookings(e).length, 0);
});
test("reconcile: Razorpay error on one order does not stop the run", async () => {
  const e = makeEnv(); const a = await newOrder(e); const b = await newOrder(e);
  for (const x of [a, b]) e.db.col("pendingPayments")[x.orderId].createdAt = new Date(Date.UTC(2026, 9, 6, 9));
  e.orderPayments[b.orderId] = [payment(b)];
  const deps = Object.assign({}, e.recDeps, { fetchOrderPayments: async (id) => { if (id === a.orderId) throw new Error("rzp down"); return clone(e.orderPayments[id] || []); } });
  const s = await wh.reconcilePendingPayments(deps);
  assert.strictEqual(s.errors, 1); assert.strictEqual(s.finalized, 1);
});

/* ── REFUNDS ── */
test("refund: partial refund → record + booking state, paid/total/balanceDue untouched", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e); const before = clone(e.db.col("bookings")[id]);
  const r = await refund(e, { bookingId: id, paymentId: p.id, amount: 100, reason: "goodwill", requestId: "rq_partial_001" });
  assert.strictEqual(r.status, "processed"); assert.strictEqual(e.refundCalls.length, 1); assert.strictEqual(e.refundCalls[0].opts.amount, 10000);
  const b = e.db.col("bookings")[id];
  assert.strictEqual(b.refundedAmount, 100); assert.strictEqual(b.refundAmount, 100); assert.strictEqual(b.refundStatus, "processed");
  assert.strictEqual(b.paymentStatus, "partially_refunded"); assert.strictEqual(b.preRefundPaymentStatus, before.paymentStatus);
  for (const k of ["paid", "total", "balanceDue"]) assert.strictEqual(b[k], before[k], k);
  const rec = e.db.col("paymentRefunds")[`${id}__rq_partial_001`];
  assert.strictEqual(rec.status, "processed"); assert.strictEqual(rec.amountPaise, 10000); assert.ok(rec.razorpayRefundId); assert.strictEqual(rec.reason, "goodwill");
});
test("refund: duplicate request id → no second Razorpay call", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e);
  const d = { bookingId: id, paymentId: p.id, amount: 50, reason: "x", requestId: "rq_dup_000001" };
  await refund(e, d); const r2 = await refund(e, d);
  assert.strictEqual(r2.duplicate, true); assert.strictEqual(e.refundCalls.length, 1); assert.strictEqual(e.db.col("bookings")[id].refundedAmount, 50);
});
test("refund: exceeding captured amount → rejected, no API call", async () => {
  const e = makeEnv(); const { id, p, o } = await paidBooking(e);
  await rejects(refund(e, { bookingId: id, paymentId: p.id, amount: o.payNow + 1, reason: "x", requestId: "rq_over_00001" }), "out-of-range");
  assert.strictEqual(e.refundCalls.length, 0);
});
test("refund: cumulative refunds cannot exceed paid; full refund → refunded", async () => {
  const e = makeEnv(); const { id, p, o } = await paidBooking(e);
  await refund(e, { bookingId: id, paymentId: p.id, amount: o.payNow - 50, reason: "x", requestId: "rq_cum_000001" });
  await rejects(refund(e, { bookingId: id, paymentId: p.id, amount: 51, reason: "x", requestId: "rq_cum_000002" }), "out-of-range");
  const r = await refund(e, { bookingId: id, paymentId: p.id, full: true, reason: "cancelled", requestId: "rq_cum_000003" });
  assert.strictEqual(r.amount, 50); assert.strictEqual(e.db.col("bookings")[id].paymentStatus, "refunded");
  await rejects(refund(e, { bookingId: id, paymentId: p.id, full: true, reason: "x", requestId: "rq_cum_000004" }), "failed-precondition");
  assert.strictEqual(e.refundCalls.length, 2);
});
test("refund: concurrent requests cannot over-refund", async () => {
  const e = makeEnv(); const { id, p, o } = await paidBooking(e); const half = Math.floor(o.payNow / 2) + 1;
  const res = await Promise.allSettled([1, 2, 3].map((i) => refund(e, { bookingId: id, paymentId: p.id, amount: half, reason: "x", requestId: "rq_conc_00000" + i })));
  assert.strictEqual(res.filter((x) => x.status === "fulfilled").length, 1); assert.strictEqual(e.refundCalls.length, 1);
});
test("refund: Razorpay rejects (4xx) → record failed, reservation released, safe error", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e); e.setRefundBehaviour("reject");
  const err = await rejects(refund(e, { bookingId: id, paymentId: p.id, amount: 100, reason: "x", requestId: "rq_rej_000001" }), "aborted");
  assert.ok(!/BAD_REQUEST_ERROR/.test(err.publicMessage));
  const b = e.db.col("bookings")[id];
  assert.strictEqual(b.refundPendingAmount, 0); assert.strictEqual(b.refundedAmount, 0); assert.strictEqual(b.refundStatus, "failed");
  assert.strictEqual(e.db.col("paymentRefunds")[`${id}__rq_rej_000001`].status, "failed");
  e.setRefundBehaviour("ok"); await refund(e, { bookingId: id, paymentId: p.id, amount: 100, reason: "x", requestId: "rq_rej_000002" });
  assert.strictEqual(e.db.col("bookings")[id].refundedAmount, 100);
});
test("refund: network failure → 'unknown' stays reserved; webhook resolves it", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e); e.setRefundBehaviour("network");
  await rejects(refund(e, { bookingId: id, paymentId: p.id, amount: 100, reason: "x", requestId: "rq_net_000001" }), "unavailable");
  assert.strictEqual(e.db.col("bookings")[id].refundPendingAmount, 100);
  const replay = await refund(e, { bookingId: id, paymentId: p.id, amount: 100, reason: "x", requestId: "rq_net_000001" });
  assert.strictEqual(replay.status, "in_progress"); assert.strictEqual(e.refundCalls.length, 1);
  await send(e, webhookReq("refund.processed", "refund", { id: "rfnd_LATE000001", payment_id: p.id, amount: 10000, status: "processed", notes: { bookingId: id, requestId: "rq_net_000001" } }));
  const b = e.db.col("bookings")[id];
  assert.strictEqual(b.refundedAmount, 100); assert.strictEqual(b.refundPendingAmount, 0); assert.strictEqual(b.refundRecordIds.length, 1);
});
test("refund: unauthorized / non-admin → rejected, no API call", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e); const d = { bookingId: id, paymentId: p.id, amount: 10, reason: "x", requestId: "rq_auth_00001" };
  await rejects(refund(e, d, {}), "unauthenticated");
  await rejects(refund(e, d, { auth: { uid: "uidA", token: { email_verified: true } } }), "permission-denied");
  assert.strictEqual(e.refundCalls.length, 0);
});
test("refund: wrong payment id / legacy booking / bad input → rejected", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e);
  await rejects(refund(e, { bookingId: id, paymentId: "pay_SOMEONEELSE1", amount: 10, reason: "x", requestId: "rq_wrong_0001" }), "failed-precondition");
  e.db.col("bookings").legacy01 = { paymentId: p.id, total: 300, paymentType: "advance" };
  await rejects(refund(e, { bookingId: "legacy01", paymentId: p.id, amount: 10, reason: "x", requestId: "rq_legacy_001" }), "failed-precondition");
  for (const bad of [{ amount: -5 }, { amount: 10.555 }, { amount: "abc" }, { reason: "" }, { requestId: "x" }]) {
    await rejects(refund(e, Object.assign({ bookingId: id, paymentId: p.id, amount: 10, reason: "x", requestId: "rq_bad_000001" }, bad)), "invalid-argument");
  }
  assert.strictEqual(e.refundCalls.length, 0);
});
test("refund webhooks: dashboard refund recorded; duplicate not double-counted; failed releases", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e);
  const ent = { id: "rfnd_DASH000001", payment_id: p.id, amount: 5000, status: "processed", notes: {} };
  await send(e, webhookReq("refund.processed", "refund", ent)); await send(e, webhookReq("refund.processed", "refund", ent));
  let b = e.db.col("bookings")[id];
  assert.strictEqual(b.refundedAmount, 50); assert.strictEqual(e.db.col("paymentRefunds").rzp_rfnd_DASH000001.source, "razorpay");
  e.setRefundBehaviour("pending");
  const r = await refund(e, { bookingId: id, paymentId: p.id, amount: 20, reason: "x", requestId: "rq_pend_00001" });
  assert.strictEqual(r.status, "pending"); assert.strictEqual(e.db.col("bookings")[id].refundPendingAmount, 20);
  const rid = e.db.col("paymentRefunds")[`${id}__rq_pend_00001`].razorpayRefundId;
  await send(e, webhookReq("refund.failed", "refund", { id: rid, payment_id: p.id, amount: 2000, status: "failed", notes: {} }));
  b = e.db.col("bookings")[id];
  assert.strictEqual(b.refundPendingAmount, 0); assert.strictEqual(b.refundedAmount, 50);
  await send(e, webhookReq("refund.processed", "refund", { id: rid, payment_id: p.id, amount: 2000, status: "processed", notes: {} }));
  assert.strictEqual(e.db.col("bookings")[id].refundedAmount, 50, "terminal failed is not resurrected");
});
test("refund webhook: amount mismatch vs record → conflict, no change", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e); e.setRefundBehaviour("pending");
  await refund(e, { bookingId: id, paymentId: p.id, amount: 20, reason: "x", requestId: "rq_mm_0000001" });
  const rid = e.db.col("paymentRefunds")[`${id}__rq_mm_0000001`].razorpayRefundId;
  const r = await send(e, webhookReq("refund.processed", "refund", { id: rid, payment_id: p.id, amount: 999999, status: "processed", notes: {} }));
  assert.strictEqual(r.body.status, "conflict"); assert.strictEqual(e.db.col("bookings")[id].refundedAmount, 0);
});

/* ── SECURITY / SCOPE ── */
test("security: no PII, secrets, signatures or raw payloads in logs or stored events", async () => {
  const e = makeEnv(); const o = await newOrder(e); const p = payment(o); const req = webhookReq("payment.captured", "payment", p);
  await send(e, req); await send(e, webhookReq("payment.captured", "payment", p, { badSig: true }));
  const { id } = await paidBooking(e); e.setRefundBehaviour("reject");
  await rejects(refund(e, { bookingId: id, paymentId: e.db.col("bookings")[id].paymentId, amount: 10, reason: "x", requestId: "rq_log_000001" }), "aborted");
  const blob = e.logger.lines.join("\n") + JSON.stringify(e.db.col("razorpayWebhookEvents"));
  for (const s of ["alice@example.com", "+919876543210", "9876543210", "Asha Rao", "Koramangala", WH_SECRET, KEY_SECRET, req.headers["x-razorpay-signature"]]) assert.ok(!blob.includes(s), "leaked " + s);
  assert.ok(!JSON.stringify(e.db.col("razorpayWebhookEvents")).includes("contact"));
});
test("security: constant-time webhook signature compare", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "payment-webhook.js"), "utf8");
  assert.ok(src.includes("crypto.timingSafeEqual"));
  const raw = Buffer.from("{}"); const good = crypto.createHmac("sha256", WH_SECRET).update(raw).digest("hex");
  assert.ok(wh._internal.webhookSignatureValid(raw, good, WH_SECRET));
  assert.ok(!wh._internal.webhookSignatureValid(raw, good.slice(2), WH_SECRET));
  assert.ok(!wh._internal.webhookSignatureValid(raw, good, ""));
});
test("security: internal refund errors are generic", async () => {
  const e = makeEnv(); const { id, p } = await paidBooking(e);
  const deps = Object.assign({}, e.refDeps, { createRefund: async () => { throw new Error("socket hang up at /srv/internal"); } });
  e.db.runTransaction = ((orig) => (fn) => orig(fn))(e.db.runTransaction.bind(e.db));
  const err = await rejects(rf.handleRefund({ bookingId: id, paymentId: p.id, amount: 10, reason: "x", requestId: "rq_gen_000001" }, adminCtx, deps), "unavailable");
  assert.ok(!/srv|socket/.test(err.publicMessage));
});
test("scope: index.js wires R3 functions; Phase 1 verify still delegates to finalizeCapture", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  for (const k of ["exports.razorpayWebhook", "exports.reconcileRazorpayPayments", "exports.adminRefundPayment", "RAZORPAY_WEBHOOK_SECRET"]) assert.ok(src.includes(k), k);
  const m = fs.readFileSync(path.join(__dirname, "..", "move-payment.js"), "utf8");
  assert.ok(/handleVerifyPayment[\s\S]*finalizeCapture\(deps/.test(m));
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.f(); pass++; console.log("  PASS  " + t.n); }
    catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); }
  }
  console.log(`\nr3-payments: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
