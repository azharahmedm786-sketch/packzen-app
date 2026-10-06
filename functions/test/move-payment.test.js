/**
 * Move payment security regression suite (Phase 1 — payment correctness).
 * Pure mocks: in-memory Firestore with serialized transactions, fake Razorpay,
 * fake Auth. No network, no emulator, no production data.
 *
 *   node test/move-payment.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const mp = require("../move-payment.js");
const PackZenPricing = require("../pricing-engine-v2.js");
const PaymentState = require("../../public/payment-state.js");
const { signatureMatches, expectedSignature, bookingMoney } = mp._internal;

const SECRET = "test_secret_not_real";
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/* ── in-memory Firestore with serialized transactions ── */
function makeDb() {
  const store = {};
  const col = (n) => (store[n] = store[n] || {});
  const snap = (n, id) => ({ exists: Object.prototype.hasOwnProperty.call(col(n), id), id, data: () => clone(col(n)[id]) });
  const ref = (n, id) => ({
    _n: n, id,
    get: async () => snap(n, id),
    set: async (d) => { col(n)[id] = clone(d); },
    update: async (d) => { Object.assign(col(n)[id], clone(d)); },
  });
  let chain = Promise.resolve();
  const db = {
    store, col, txCount: 0,
    collection: (n) => ({ doc: (id) => ref(n, id) }),
    runTransaction(fn) {
      const run = chain.then(async () => {
        db.txCount++;
        const writes = [];
        const tx = {
          get: async (r) => snap(r._n, r.id),
          create: (r, d) => writes.push(() => {
            if (Object.prototype.hasOwnProperty.call(col(r._n), r.id)) throw new Error("ALREADY_EXISTS");
            col(r._n)[r.id] = clone(d);
          }),
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

/* ── fakes ── */
const TOKENS = {
  tokA: { uid: "uidA", email: "Alice@Example.com", email_verified: true },
  tokB: { uid: "uidB", email: "bob@example.com", email_verified: true },
  tokUnverified: { uid: "uidC", email: "carol@example.com", email_verified: false },
};
const verifyIdToken = async (t) => { if (!TOKENS[t]) throw new Error("bad token"); return TOKENS[t]; };

function makeLogger() {
  const lines = [];
  const rec = (lvl) => (msg, data) => lines.push(lvl + " " + msg + " " + JSON.stringify(data || {}));
  return { lines, info: rec("info"), warn: rec("warn"), error: rec("error") };
}

let orderSeq = 0;
function makeEnv() {
  const db = makeDb();
  const logger = makeLogger();
  const payments = {};
  const emails = [];
  const orders = [];
  const createDeps = {
    verifyIdToken, db, logger,
    serverTimestamp: () => "SERVER_TS",
    now: () => 1760000000000,
    // Simulates calculateServerQuote: server sets km itself, then runs the real engine.
    quote: async (qi) => { qi.km = 12; const q = PackZenPricing.calculateQuote(qi); if (!q.valid) throw new Error("bad quote"); return q; },
    normalize: (qi) => PackZenPricing.validateInput(qi).data,
    createOrder: async (o) => { const id = "order_TEST" + String(++orderSeq).padStart(8, "0"); orders.push(Object.assign({ id }, o)); return { id, amount: o.amount, currency: o.currency }; },
  };
  const verifyDeps = {
    verifyIdToken, db, logger, keySecret: SECRET,
    serverTimestamp: () => "SERVER_TS",
    fetchPayment: async (id) => { if (!payments[id]) throw new Error("not found"); return clone(payments[id]); },
    sendConfirmation: async (d) => { emails.push(d); },
  };
  return { db, logger, payments, emails, orders, createDeps, verifyDeps };
}

const req = (token, body) => ({ method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, body });

const QUOTE_INPUT = {
  pickup: "Koramangala, Bangalore", drop: "Whitefield, Bangalore", vehicleId: "tata_ace",
  furniture: {}, cartonQty: 5, pickupFloor: 1, dropFloor: 2, liftAvailable: false, packingService: true,
};
const orderBody = (over) => Object.assign({
  quoteInput: clone(QUOTE_INPUT), paymentType: "advance", customerName: "Asha Rao", phone: "9876543210",
  moveType: "home", pickup: "Koramangala, Bangalore", drop: "Whitefield, Bangalore", date: "2026-11-20",
  requestId: "req_abcdef123456",
}, over || {});

async function createOrder(env, over, token = "tokA") {
  const out = await mp.handleCreateOrder(req(token, orderBody(over)), env.createDeps);
  assert.strictEqual(out.status, 200, JSON.stringify(out.body));
  return out.body;
}
function capture(env, order, over) {
  const pid = "pay_TEST" + crypto.randomBytes(5).toString("hex");
  env.payments[pid] = Object.assign({ id: pid, order_id: order.orderId, amount: order.amount, currency: "INR", status: "captured" }, over || {});
  return { razorpay_order_id: order.orderId, razorpay_payment_id: pid, razorpay_signature: expectedSignature(order.orderId, pid, SECRET) };
}
const verify = (env, body, token = "tokA") => mp.handleVerifyPayment(req(token, body), env.verifyDeps);
const bookings = (env) => Object.values(env.db.col("bookings"));

/* ── runner ── */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* AUTH */
test("order: no token → 401", async () => { const e = makeEnv(); const o = await mp.handleCreateOrder(req(null, orderBody()), e.createDeps); assert.strictEqual(o.status, 401); assert.strictEqual(e.orders.length, 0); });
test("order: invalid token → 401", async () => { const e = makeEnv(); const o = await mp.handleCreateOrder(req("forged", orderBody()), e.createDeps); assert.strictEqual(o.status, 401); });
test("verify: no token → 401, no booking", async () => { const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord), null); assert.strictEqual(o.status, 401); assert.strictEqual(bookings(e).length, 0); });
test("verify: invalid token → 401", async () => { const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord), "forged"); assert.strictEqual(o.status, 401); });
test("verify: wrong customer → 403, no booking", async () => { const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord), "tokB"); assert.strictEqual(o.status, 403); assert.strictEqual(bookings(e).length, 0); });
test("verify: verified customer → 200 with server bookingRef", async () => { const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord)); assert.strictEqual(o.status, 200); assert.ok(/^PKZ-/.test(o.body.bookingRef)); });

/* ORDER */
test("order: amounts come from the server quote", async () => {
  const e = makeEnv(); const ord = await createOrder(e);
  const ref = PackZenPricing.calculateQuote(Object.assign(clone(QUOTE_INPUT), { km: 12 }));
  assert.strictEqual(ord.grandTotal, ref.paymentOptions.grandTotal);
  assert.strictEqual(ord.payNow, Math.max(ref.paymentOptions.advanceAmount, 199));
  assert.strictEqual(ord.amount, ord.payNow * 100);
});
test("order: client total/amount/email/uid fields are ignored", async () => {
  const e = makeEnv();
  const ord = await createOrder(e, { total: 1, amount: 1, grandTotal: 1, payNow: 1, email: "attacker@evil.test", customerUid: "uidB", quoteInput: Object.assign(clone(QUOTE_INPUT), { km: 0.1 }) });
  const p = e.db.col("pendingPayments")[ord.orderId];
  assert.ok(p.grandTotal > 1 && p.payNow > 1);
  assert.strictEqual(p.uid, "uidA"); assert.strictEqual(p.email, "alice@example.com");
  assert.strictEqual(p.quoteInput.km, 12, "server distance replaces client km");
});
test("order: pending payment has uid/email/grandTotal/payNow/requestId/expiry", async () => {
  const e = makeEnv(); const ord = await createOrder(e); const p = e.db.col("pendingPayments")[ord.orderId];
  for (const k of ["uid", "email", "orderId", "grandTotal", "payNow", "paymentType", "quoteInput", "quoteBreakdown", "requestId", "createdAt", "expiresAt", "currency"]) assert.ok(p[k] !== undefined && p[k] !== null, "missing " + k);
  assert.strictEqual(p.status, "created");
});
test("order: unverified token email is not stored", async () => { const e = makeEnv(); const ord = await createOrder(e, {}, "tokUnverified"); assert.strictEqual(e.db.col("pendingPayments")[ord.orderId].email, null); });
test("order: bad paymentType / requestId / phone → 400 generic", async () => {
  const e = makeEnv();
  for (const over of [{ paymentType: "at_drop" }, { requestId: "x" }, { phone: "123" }, { date: "tomorrow" }, { quoteInput: null }]) {
    const o = await mp.handleCreateOrder(req("tokA", orderBody(over)), e.createDeps);
    assert.strictEqual(o.status, 400); assert.strictEqual(o.body.success, false);
  }
  assert.strictEqual(e.orders.length, 0);
});

/* VERIFY */
test("verify: valid captured payment → exactly one booking", async () => { const e = makeEnv(); const ord = await createOrder(e); await verify(e, capture(e, ord)); assert.strictEqual(bookings(e).length, 1); assert.ok(e.db.col("bookings")[ord.orderId], "deterministic id = orderId"); });
test("verify: invalid signature → 400", async () => { const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord); b.razorpay_signature = "0".repeat(64); const o = await verify(e, b); assert.strictEqual(o.status, 400); assert.strictEqual(o.body.code, "invalid_signature"); assert.strictEqual(bookings(e).length, 0); });
test("verify: wrong order id (validly signed for a different order) → rejected", async () => {
  const e = makeEnv(); const ord1 = await createOrder(e); const ord2 = await createOrder(e, { requestId: "req_second_00001" });
  const b = capture(e, ord1); // payment belongs to ord1
  const forged = { razorpay_order_id: ord2.orderId, razorpay_payment_id: b.razorpay_payment_id, razorpay_signature: expectedSignature(ord2.orderId, b.razorpay_payment_id, SECRET) };
  const o = await verify(e, forged); assert.strictEqual(o.status, 400); assert.strictEqual(o.body.code, "order_mismatch"); assert.strictEqual(bookings(e).length, 0);
});
test("verify: wrong payment id (Razorpay returns another payment) → rejected", async () => {
  const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord);
  e.payments[b.razorpay_payment_id].id = "pay_SOMEONEELSE1"; const o = await verify(e, b);
  assert.strictEqual(o.status, 400); assert.strictEqual(o.body.code, "payment_mismatch");
});
test("verify: wrong amount → rejected", async () => { const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord, { amount: ord.amount - 100 })); assert.strictEqual(o.body.code, "amount_mismatch"); assert.strictEqual(bookings(e).length, 0); });
test("verify: wrong currency → rejected", async () => { const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord, { currency: "USD" })); assert.strictEqual(o.body.code, "currency_mismatch"); assert.strictEqual(bookings(e).length, 0); });
test("verify: authorized (not captured) → 202 pending, no booking, pending kept", async () => {
  const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord, { status: "authorized" }));
  assert.strictEqual(o.status, 202); assert.strictEqual(o.body.code, "payment_not_captured"); assert.strictEqual(bookings(e).length, 0);
  assert.strictEqual(e.db.col("pendingPayments")[ord.orderId].status, "created");
});
test("verify: failed payment → 400, no booking", async () => { const e = makeEnv(); const ord = await createOrder(e); const o = await verify(e, capture(e, ord, { status: "failed" })); assert.strictEqual(o.status, 400); assert.strictEqual(bookings(e).length, 0); });
test("verify: Razorpay unreachable → 503 retryable, no booking", async () => { const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord); delete e.payments[b.razorpay_payment_id]; const o = await verify(e, b); assert.strictEqual(o.status, 503); assert.strictEqual(bookings(e).length, 0); });
test("verify: missing pending payment → rejected", async () => { const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord); delete e.db.col("pendingPayments")[ord.orderId]; const o = await verify(e, b); assert.strictEqual(o.body.code, "order_not_found"); });
test("verify: legacy pending without uid → rejected (no booking)", async () => { const e = makeEnv(); const ord = await createOrder(e); delete e.db.col("pendingPayments")[ord.orderId].uid; const o = await verify(e, capture(e, ord)); assert.strictEqual(o.body.code, "legacy_order"); assert.strictEqual(bookings(e).length, 0); });
test("verify: duplicate verify → same booking, duplicate flag, one email", async () => {
  const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord);
  const o1 = await verify(e, b); const o2 = await verify(e, b);
  assert.strictEqual(o2.status, 200); assert.strictEqual(o2.body.duplicate, true); assert.strictEqual(o1.body.bookingRef, o2.body.bookingRef);
  assert.strictEqual(bookings(e).length, 1); assert.strictEqual(e.emails.length, 1);
});
test("verify: same order with a different payment id after booking → 409", async () => {
  const e = makeEnv(); const ord = await createOrder(e); await verify(e, capture(e, ord));
  const o = await verify(e, capture(e, ord)); assert.strictEqual(o.status, 409); assert.strictEqual(bookings(e).length, 1);
});
test("verify: concurrent verifies (×5) → exactly one booking", async () => {
  const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord);
  const outs = await Promise.all([1, 2, 3, 4, 5].map(() => verify(e, b)));
  assert.strictEqual(bookings(e).length, 1);
  assert.ok(outs.every((o) => o.status === 200), JSON.stringify(outs.map((o) => o.status)));
  assert.strictEqual(new Set(outs.map((o) => o.body.bookingRef)).size, 1);
  assert.strictEqual(outs.filter((o) => !o.body.duplicate).length, 1);
  assert.strictEqual(e.emails.length, 1);
  assert.ok(e.db.txCount >= 2, "race actually reached the transaction");
});

/* BOOKING DATA */
test("booking: advance → total=grandTotal, paid=captured, balanceDue=total−paid", async () => {
  const e = makeEnv(); const ord = await createOrder(e); await verify(e, capture(e, ord)); const bk = e.db.col("bookings")[ord.orderId];
  assert.strictEqual(bk.customerUid, "uidA"); assert.strictEqual(bk.total, ord.grandTotal); assert.strictEqual(bk.paid, ord.payNow);
  assert.strictEqual(bk.balanceDue, ord.grandTotal - ord.payNow); assert.strictEqual(bk.paymentType, "advance"); assert.strictEqual(bk.paymentStatus, "partially_paid");
  assert.strictEqual(bk.currency, "INR"); assert.strictEqual(bk.orderId, ord.orderId); assert.ok(bk.paymentId); assert.strictEqual(bk.status, "confirmed");
  assert.strictEqual(bk.createdAt, "SERVER_TS"); assert.strictEqual(bk.paidAt, "SERVER_TS");
  assert.strictEqual(e.db.col("pendingPayments")[ord.orderId].status, "consumed");
});
test("booking: full → paid=captured, balanceDue=0, discount recorded, status paid", async () => {
  const e = makeEnv(); const ord = await createOrder(e, { paymentType: "full" }); await verify(e, capture(e, ord)); const bk = e.db.col("bookings")[ord.orderId];
  assert.strictEqual(bk.total, ord.grandTotal); assert.strictEqual(bk.paid, ord.payNow); assert.strictEqual(bk.balanceDue, 0);
  assert.strictEqual(bk.paymentStatus, "paid"); assert.strictEqual(bk.fullPaymentDiscount, Math.max(0, ord.grandTotal - ord.payNow));
});
test("booking: email comes from verified token via pending, never the request body", async () => {
  const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord); b.bookingData = { email: "attacker@evil.test" };
  await verify(e, b); assert.strictEqual(e.db.col("bookings")[ord.orderId].email, "alice@example.com"); assert.strictEqual(e.emails[0].customerEmail, "alice@example.com");
});
test("bookingMoney: floors never produce a negative balance", () => {
  assert.deepStrictEqual(bookingMoney({ grandTotal: 150, paid: 199, paymentType: "advance" }).balanceDue, 0);
  assert.strictEqual(bookingMoney({ grandTotal: 3000, paid: 300, paymentType: "advance" }).balanceDue, 2700);
});

/* SECURITY */
test("security: constant-time compare used, rejects wrong length/garbage", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "move-payment.js"), "utf8");
  assert.ok(src.includes("crypto.timingSafeEqual"));
  const good = expectedSignature("order_ABC123", "pay_XYZ789", SECRET);
  assert.ok(signatureMatches("order_ABC123", "pay_XYZ789", good, SECRET));
  assert.ok(!signatureMatches("order_ABC123", "pay_XYZ789", good.slice(1), SECRET));
  assert.ok(!signatureMatches("order_ABC123", "pay_XYZ789", good, ""));
});
test("security: no PII in logs across a full happy + failure run", async () => {
  const e = makeEnv(); const ord = await createOrder(e); const b = capture(e, ord);
  await verify(e, b, "tokB"); await verify(e, b);
  const logs = e.logger.lines.join("\n");
  for (const pii of ["alice@example.com", "Alice@Example.com", "9876543210", "Asha Rao", "Koramangala", "Whitefield", SECRET, b.razorpay_signature, b.razorpay_payment_id]) {
    assert.ok(!logs.includes(pii), "log leaked: " + pii);
  }
});
test("security: internal errors are generic to the client", async () => {
  const e = makeEnv(); e.createDeps.createOrder = async () => { throw new Error("RZP 500: internal stack at /srv/secret/path"); };
  const o = await mp.handleCreateOrder(req("tokA", orderBody()), e.createDeps);
  assert.strictEqual(o.status, 500); assert.ok(!JSON.stringify(o.body).includes("stack")); assert.ok(!JSON.stringify(o.body).includes("/srv"));
  e.createDeps.quote = async () => { throw new Error("Validation error: Unknown vehicle type: hacked"); };
  const q = await mp.handleCreateOrder(req("tokA", orderBody()), e.createDeps);
  assert.strictEqual(q.status, 400); assert.ok(!JSON.stringify(q.body).includes("hacked"));
});
test("security: index.js no longer logs request bodies or returns err.message from payment endpoints", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const a = src.indexOf("exports.createRazorpayOrder"), z = src.indexOf("// Notification system");
  const block = src.slice(a, z);
  assert.ok(!/req\.body/.test(block)); assert.ok(!/err\.message/.test(block)); assert.ok(block.includes("handleVerifyPayment"));
});

/* UI (static + shared reader logic) */
const scriptSrc = fs.readFileSync(path.join(__dirname, "..", "..", "public", "script.js"), "utf8");
const payBlock = scriptSrc.slice(scriptSrc.indexOf("async function startPayment()"), scriptSrc.indexOf("function _showPaymentPendingNotice"));
test("ui: no false 'Payment received! Booking confirmed' path", () => { assert.ok(!scriptSrc.includes("Payment received! Booking confirmed")); });
test("ui: both payment calls go through the authed helper with Bearer token", () => {
  assert.ok(payBlock.includes('_authedPaymentPost("/createRazorpayOrder"')); assert.ok(payBlock.includes('_authedPaymentPost("/verifyRazorpayPayment"'));
  assert.ok(/"Authorization": "Bearer " \+ token/.test(payBlock)); assert.ok(payBlock.includes("getIdToken(forceRefresh)"));
  assert.ok(!/fetch\("https:\/\/asia-south1-packzen-e7539\.cloudfunctions\.net\/(createRazorpayOrder|verifyRazorpayPayment)"/.test(scriptSrc));
  assert.ok(!/localStorage\.setItem\([^)]*[Tt]oken/.test(scriptSrc));
});
test("ui: confirmation card only after a server bookingRef; otherwise pending notice", () => {
  const h = payBlock.slice(payBlock.indexOf("handler: async function"), payBlock.indexOf("modal:"));
  assert.ok(/if \(result\.state === "confirmed"\)/.test(h)); assert.ok(h.includes("bookingRef: d.bookingRef"));
  assert.ok(h.includes("_showPaymentPendingNotice")); assert.ok(!h.includes("paymentReceiptId"));
  assert.ok(payBlock.includes('if (status === 200 && data.success && data.bookingRef) return { state: "confirmed", data }'));
});
test("ui: payment requests send no email/total/amount", () => {
  const body = payBlock.slice(payBlock.indexOf('_authedPaymentPost("/createRazorpayOrder"'), payBlock.indexOf("if (status !== 200")).replace(/\/\/.*$/gm, "");
  assert.ok(!/\bemail\b/.test(body) && !/\btotal\b/.test(body) && !/\bamount\b/.test(body));
});
test("reader: driver balance — advance, full, pay-later, legacy", () => {
  const adv = PaymentState.summarize({ total: 3000, paid: 300, balanceDue: 2700, paymentType: "advance", paymentId: "p" });
  assert.strictEqual(adv.balanceDue, 2700); assert.ok(!adv.fullyPaid);
  const full = PaymentState.summarize({ total: 3000, paid: 2800, balanceDue: 0, paymentType: "full", paymentId: "p" });
  assert.strictEqual(full.balanceDue, 0); assert.ok(full.fullyPaid, "full payment with discount must not ask driver for ₹200");
  const later = PaymentState.summarize({ total: 3000, paid: 0, paymentType: "pay_later" });
  assert.strictEqual(later.balanceDue, 3000);
  const legacy = PaymentState.summarize({ total: 300, paymentType: "advance", paymentId: "p" }); // pre-Phase-1 record
  assert.strictEqual(legacy.known, false); assert.strictEqual(legacy.balanceDue, null, "never invents a balance");
  const advisor = PaymentState.summarize({ total: 5000, paid: 1000, source: "advisor" });
  assert.strictEqual(advisor.balanceDue, 4000);
});
test("reader: driver.html uses shared state and never shows a collect amount for legacy records", () => {
  const d = fs.readFileSync(path.join(__dirname, "..", "..", "public", "driver.html"), "utf8");
  assert.ok(d.includes('src="payment-state.js"')); assert.ok(d.includes("Payment record incomplete — do NOT collect"));
  assert.ok(!d.includes("const due      = Math.max(0, total - paid);"));
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log("  PASS  " + t.name); }
    catch (e) { fail++; console.log("  FAIL  " + t.name + "\n        " + (e && e.message)); }
  }
  console.log(`\nmove-payment: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
