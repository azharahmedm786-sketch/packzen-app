/**
 * Phase 1 hardening — completion OTP, rate limits, catalog payments on the
 * shared core, ops alerts, N-08 escaping. Mocks only (no network/emulator).
 *   node test/phase1-hardening.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const otp = require("../completion-otp.js");
const rl = require("../rate-limit.js");
const ops = require("../ops-alerts.js");
const mp = require("../move-payment.js");
const wh = require("../payment-webhook.js");
const rf = require("../payment-refund.js");
const { handleCreateServiceOrder } = require("../catalog-payment.js");
const { priceCart, validateDetails, validRequestId } = require("../catalog-pricing.js");
const ROOT = path.join(__dirname, "..", "..");
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/* in-memory Firestore: serialized transactions; writes discarded if the txn throws */
function makeDb() {
  const store = {}; let seq = 0;
  const col = (n) => (store[n] = store[n] || {});
  const has = (n, id) => Object.prototype.hasOwnProperty.call(col(n), id);
  const snap = (n, id) => ({ exists: has(n, id), id, data: () => clone(col(n)[id]), ref: ref(n, id) });
  function ref(n, id) { return { _n: n, id, get: async () => snap(n, id), set: async (d) => { col(n)[id] = clone(d); }, update: async (d) => { Object.assign(col(n)[id], clone(d)); } }; }
  const cmp = (v, op, x) => op === "==" ? v === x : op === "in" ? x.includes(v) : op === ">=" ? (v instanceof Object && v.getTime ? v.getTime() : (typeof v === "string" ? Date.parse(v) : v)) >= (x instanceof Date ? x.getTime() : x) : false;
  function query(n, f, lim) { return { where: (a, op, b) => query(n, f.concat([[a, op, b]]), lim), limit: (k) => query(n, f, k),
    get: async () => { let ids = Object.keys(col(n)).filter((id) => f.every(([a, op, b]) => cmp(col(n)[id][a], op, b))); if (lim) ids = ids.slice(0, lim); return { docs: ids.map((id) => snap(n, id)), empty: !ids.length }; } }; }
  let chain = Promise.resolve();
  const db = { store, col, collection: (n) => Object.assign(query(n, [], null), { doc: (id) => ref(n, id || "auto" + (++seq)), add: async (d) => { const id = "auto" + (++seq); col(n)[id] = clone(d); return { id }; } }),
    runTransaction(fn) {
      const run = chain.then(async () => { const w = [];
        const tx = { get: async (r) => snap(r._n, r.id), set: (r, d) => w.push(() => { col(r._n)[r.id] = clone(d); }), update: (r, d) => w.push(() => { Object.assign(col(r._n)[r.id], clone(d)); }),
          create: (r, d) => w.push(() => { if (has(r._n, r.id)) throw new Error("EXISTS"); col(r._n)[r.id] = clone(d); }), delete: (r) => w.push(() => { delete col(r._n)[r.id]; }) };
        const out = await fn(tx); w.forEach((x) => x()); return out; });
      chain = run.catch(() => {}); return run; } };
  return db;
}
const quiet = { info() {}, warn() {}, error() {} };
const tests = []; const test = (n, f) => tests.push({ n, f });
async function rejects(p, code) { try { await p; } catch (e) { assert.strictEqual(e.code, code, "got " + e.code + " " + e.message); return e; } throw new Error("expected " + code); }

/* ── completion OTP ── */
const PEPPER = "test_pepper_not_real_32_bytes_xxxxx";
function otpEnv(status = "transit") {
  const db = makeDb(); const mails = [];
  db.col("bookings").bookingAA1 = { customerUid: "cust1", driverUid: "drv1", status, email: "c@example.com", customerName: "Asha", bookingRef: "PKZ-1" };
  db.col("users").drv1 = { role: "driver" }; db.col("users").drv2 = { role: "driver" }; db.col("users").adm = { role: "admin" };
  const deps = { db, now: () => 1760000000000, serverTimestamp: () => "TS", pepper: PEPPER, logger: quiet,
    sendCustomerEmail: async (k, to, d) => { mails.push({ k, to, d }); },
    isAdmin: async (c) => c.auth.uid === "adm", isDriver: async (c) => ["drv1", "drv2"].includes(c.auth.uid),
    rateLimit: (scope, subject) => rl.consume(db, Object.assign({ scope, subject, now: 1760000000000 }, rl.LIMITS[scope])) };
  return { db, deps, mails };
}
const ctx = (uid) => ({ auth: { uid, token: {} } });

test("OTP: owner gets a stable 4-digit code; nothing derivable is stored", async () => {
  const { db, deps } = otpEnv();
  const a = await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), deps);
  const b = await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), deps);
  assert.ok(a.available && /^\d{4}$/.test(a.otp)); assert.strictEqual(a.otp, b.otp);
  const sec = db.col("bookingSecrets").bookingAA1;
  assert.deepStrictEqual(Object.keys(sec).sort(), ["attempts", "createdAt", "lockedUntil", "nonce"]);
  assert.ok(/^[0-9a-f]{32}$/.test(sec.nonce)); assert.ok(!Object.values(sec).some((v) => String(v) === a.otp), "plaintext OTP stored");
  assert.ok(!JSON.stringify(db.col("bookings").bookingAA1).includes('"' + a.otp + '"'), "OTP on booking doc");
  assert.strictEqual(otp.deriveOtp(PEPPER, "bookingAA1", sec.nonce), a.otp, "server can re-derive");
});
test("OTP: non-owner, unauthenticated, bad id and inactive statuses", async () => {
  const { deps } = otpEnv();
  await rejects(otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("someoneElse"), deps), "permission-denied");
  await rejects(otp.handleGetOtp({ bookingId: "bookingAA1" }, {}, deps), "unauthenticated");
  await rejects(otp.handleGetOtp({ bookingId: "../x" }, ctx("cust1"), deps), "invalid-argument");
  const e2 = otpEnv("confirmed"); assert.deepStrictEqual(await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), e2.deps), { available: false, status: "confirmed" });
  const e3 = otpEnv(); e3.deps.pepper = ""; await rejects(otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), e3.deps), "failed-precondition");
});
test("OTP: correct code from assigned driver → delivered (server-only transition); repeat is idempotent", async () => {
  const { db, deps } = otpEnv();
  const code = (await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), deps)).otp;
  const r = await otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: code }, ctx("drv1"), deps);
  assert.ok(r.ok); const b = db.col("bookings").bookingAA1;
  assert.strictEqual(b.status, "delivered"); assert.strictEqual(b.completionVerifiedBy, "driver"); assert.ok(b.completionVerifiedAt);
  assert.strictEqual((await otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: code }, ctx("drv1"), deps)).already, true);
});
test("OTP: wrong codes are counted (committed) and lock after 5; lock blocks even the right code", async () => {
  const { db, deps } = otpEnv();
  const code = (await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), deps)).otp;
  const wrong = code === "0000" ? "1111" : "0000";
  for (let i = 1; i <= 4; i++) { await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: wrong }, ctx("drv1"), deps), "invalid-argument"); assert.strictEqual(db.col("bookingSecrets").bookingAA1.attempts, i); }
  await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: wrong }, ctx("drv1"), deps), "resource-exhausted");
  await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: code }, ctx("drv1"), deps), "resource-exhausted");
  assert.strictEqual(db.col("bookings").bookingAA1.status, "transit");
  deps.now = () => 1760000000000 + 16 * 60 * 1000;
  assert.ok((await otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: code }, ctx("drv1"), deps)).ok);
});
test("OTP: other driver, non-driver, customer and wrong status are rejected; admin may complete", async () => {
  const { deps } = otpEnv();
  const code = (await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), deps)).otp;
  await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: code }, ctx("drv2"), deps), "permission-denied");
  await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: code }, ctx("cust1"), deps), "permission-denied");
  await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: "12a4" }, ctx("drv1"), deps), "invalid-argument");
  const p = otpEnv("packing");
  await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: "1234" }, ctx("drv1"), p.deps), "failed-precondition");
  const r = await otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: code }, ctx("adm"), deps);
  assert.ok(r.ok);
});
test("OTP: driver must have a code issued first (no nonce → precondition)", async () => {
  const { deps } = otpEnv();
  await rejects(otp.handleVerifyOtp({ bookingId: "bookingAA1", otp: "1234" }, ctx("drv1"), deps), "failed-precondition");
});
test("OTP: send-to-customer emails the same code; assigned driver only; rate-limited", async () => {
  const { deps, mails } = otpEnv();
  const code = (await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), deps)).otp;
  await rejects(otp.handleSendOtp({ bookingId: "bookingAA1" }, ctx("drv2"), deps), "permission-denied");
  for (let i = 0; i < 3; i++) assert.ok((await otp.handleSendOtp({ bookingId: "bookingAA1" }, ctx("drv1"), deps)).sent);
  await rejects(otp.handleSendOtp({ bookingId: "bookingAA1" }, ctx("drv1"), deps), "resource-exhausted");
  assert.strictEqual(mails.length, 3); assert.strictEqual(mails[0].k, "completion_otp"); assert.strictEqual(mails[0].d.otp, code); assert.strictEqual(mails[0].to, "c@example.com");
});
test("OTP: no browser-generated OTP or driver-writable OTP/delivered left", () => {
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  assert.ok(!/from == 'transit' && to == 'delivered'/.test(rules)); assert.ok(!/onlyFields\(\['status', 'deliveryOtp'/.test(rules));
  const script = fs.readFileSync(path.join(ROOT, "public/script.js"), "utf8");
  assert.ok(!/generateDeliveryOtp|b\.deliveryOtp|deliveryOtp:/.test(script)); assert.ok(script.includes('httpsCallable("getCompletionOtp")'));
  const driver = fs.readFileSync(path.join(ROOT, "public/driver.html"), "utf8");
  assert.ok(driver.includes('_driverCallable("verifyCompletionOtp")') && !/Math\.random\(\) \* 9000/.test(driver) && !driver.includes("currentBookingData.deliveryOtp"));
  assert.ok(!/"deliveryOtp"/.test(fs.readFileSync(path.join(ROOT, "functions/index.js"), "utf8")));
});

/* ── completion-stage visibility + who may set "delivered" (review corrections) ── */
test("code is exposed ONLY while the booking is in transit (not assigned/packing/delivered/cancelled/other)", async () => {
  for (const st of ["pending", "confirmed", "assigned", "packing", "delivered", "completed", "cancelled"]) {
    const e = otpEnv(st);
    const r = await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), e.deps);
    assert.deepStrictEqual(r, { available: false, status: st }, st);
    assert.ok(!e.db.col("bookingSecrets").bookingAA1, "no code issued for " + st);
    await rejects(otp.handleSendOtp({ bookingId: "bookingAA1" }, ctx("drv1"), e.deps), "failed-precondition");
  }
  const t = otpEnv("transit"); assert.ok((await otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("cust1"), t.deps)).available);
  await rejects(otp.handleGetOtp({ bookingId: "bookingAA1" }, ctx("otherCustomer"), t.deps), "permission-denied");
  const script = fs.readFileSync(path.join(ROOT, "public/script.js"), "utf8");
  assert.strictEqual((script.match(/const showOtp = b\.status === "transit";/g) || []).length, 2, "UI shows the code only in transit");
});
test("admin emergency completion: admin only, reason required, recorded; others rejected", async () => {
  const { db, deps } = otpEnv("packing");
  for (const who of ["drv1", "cust1", "advisor1"]) await rejects(otp.handleAdminOverride({ bookingId: "bookingAA1", reason: "customer unreachable after delivery" }, ctx(who), deps), "permission-denied");
  await rejects(otp.handleAdminOverride({ bookingId: "bookingAA1", reason: "short" }, ctx("adm"), deps), "invalid-argument");
  const r = await otp.handleAdminOverride({ bookingId: "bookingAA1", reason: "customer unreachable after delivery" }, ctx("adm"), deps);
  assert.ok(r.ok); const b = db.col("bookings").bookingAA1;
  assert.strictEqual(b.status, "delivered"); assert.strictEqual(b.completionMethod, "admin_override");
  assert.deepStrictEqual(b.completionOverride, { by: "adm", reason: "customer unreachable after delivery", at: 1760000000000, fromStatus: "packing" });
  assert.strictEqual((await otp.handleAdminOverride({ bookingId: "bookingAA1", reason: "customer unreachable after delivery" }, ctx("adm"), deps)).already, true);
  const c = otpEnv("cancelled");
  await rejects(otp.handleAdminOverride({ bookingId: "bookingAA1", reason: "customer unreachable after delivery" }, ctx("adm"), c.deps), "failed-precondition");
  assert.strictEqual(c.db.col("bookings").bookingAA1.status, "cancelled");
});
test("rules: no client role can write 'delivered' (driver, customer, advisor, admin); create can't start delivered", () => {
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  const start = rules.indexOf("match /bookings/{bookingId}");
  const b = rules.slice(start, rules.indexOf("    match /", start + 10));
  assert.ok(b.length > 500, "bookings block found");
  // driver: delivered is not a permitted step
  assert.ok(!/to == 'delivered'/.test(rules), "driver step to delivered");
  assert.ok(/\(from == 'packing' && to == 'transit'\);/.test(rules));
  // customer: only cancel/reschedule/rating/damage field sets; status may only become 'cancelled'
  assert.ok(/request\.resource\.data\.status == 'cancelled'/.test(b));
  assert.ok(!/customerUid == request\.auth\.uid[\s\S]{0,400}'delivered'/.test(b.replace(/!= 'delivered'/g, "")), "customer path mentions delivered");
  // advisor and admin updates exclude moving into delivered; create excludes delivered
  assert.ok(/isAdvisor\(\)\s*&& onlyFields\(\['driverUid', 'driverName', 'driverPhone', 'status'\]\)\s*&& request\.resource\.data\.status != 'delivered';/.test(b));
  assert.ok(/allow update: if isAdmin\(\)\s*&& \(request\.resource\.data\.status != 'delivered' \|\| resource\.data\.status == 'delivered'\);/.test(b));
  assert.ok(/\(isAdvisor\(\) \|\| isAdmin\(\)\)\s*&& request\.resource\.data\.status != 'delivered';/.test(b));
  assert.ok(!/allow read, update, delete: if isAdmin\(\);/.test(b), "unrestricted admin update remains");
  // every other 'allow update' in the bookings block either excludes delivered or can't touch status
  const updates = b.match(/allow update:[\s\S]*?;/g) || [];
  for (const u of updates) assert.ok(/!= 'delivered'|status == 'cancelled'|isAllowedDriverStep|onlyFields\(\['(date|driverRating|damageClaimed)/.test(u) || /status/.test(u) === false, "unchecked update path: " + u.slice(0, 80));
});
test("UIs route completion through the server (driver OTP callable, admin override callable)", () => {
  const admin = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
  assert.ok(/if \(status === "delivered"\) \{ requireAdmin\(\(\) => adminEmergencyComplete\(id\)\); return; \}/.test(admin));
  assert.ok(admin.includes('httpsCallable("adminCompleteBooking")') && admin.includes("firebase-functions-compat.js"));
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(/exports\.adminCompleteBooking = /.test(idx));
});

/* ── rate limits ── */
test("rate limit: window, limit, reset; keys are hashed", async () => {
  const db = makeDb(); const r = (now) => rl.consume(db, { scope: "s", subject: "user@example.com", limit: 2, windowMs: 1000, now });
  assert.ok((await r(0)).ok); assert.ok((await r(10)).ok); const blocked = await r(20);
  assert.ok(!blocked.ok && blocked.retryAfterMs === 980); assert.ok((await r(1000)).ok);
  const dump = JSON.stringify(db.store); assert.ok(!dump.includes("user@example.com"));
});
test("rate limit: concurrent bursts cannot exceed the limit", async () => {
  const db = makeDb();
  const res = await Promise.all(Array.from({ length: 20 }, () => rl.consume(db, { scope: "b", subject: "u", limit: 5, windowMs: 60000, now: 1 })));
  assert.strictEqual(res.filter((x) => x.ok).length, 5);
});
test("rate limit: client IP from x-forwarded-for", () => {
  assert.strictEqual(rl.clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }), "1.2.3.4");
  assert.strictEqual(rl.clientIp(null), "unknown");
});
test("move order: rate-limited caller gets 429 and no Razorpay order is created", async () => {
  let orders = 0;
  const out = await mp.handleCreateOrder({ headers: { authorization: "Bearer t" }, body: {} }, { verifyIdToken: async () => ({ uid: "u1" }), logger: quiet,
    rateLimit: async () => ({ ok: false, scope: "moveOrderUid" }), createOrder: async () => { orders++; } });
  assert.strictEqual(out.status, 429); assert.strictEqual(out.body.code, "rate_limited"); assert.strictEqual(orders, 0);
});

/* ── catalog payments on the shared core ── */
function catalogEnv() {
  const db = makeDb(); let seq = 0; const payments = {};
  db.col("addons")["ac-installation"] = { isActive: true, categoryId: "ac-services", name: "AC Install", basePrice: 1400, pricingUnit: "per_item" };
  db.col("serviceCategories")["ac-services"] = { isActive: true, name: "AC" };
  const deps = { db, logger: quiet, serverTimestamp: () => "TS", now: () => 1760000000000,
    verifyIdToken: async (t) => { if (t !== "good") throw new Error("bad"); return { uid: "uid1", email: "asha@example.com", email_verified: true }; },
    loadCatalog: async () => ({ services: {}, packages: {}, addons: { "ac-installation": db.col("addons")["ac-installation"] }, categories: db.col("serviceCategories") }),
    priceCart, validateDetails, validRequestId,
    createOrder: async (o) => ({ id: "order_SVC" + String(++seq).padStart(6, "0"), amount: o.amount, currency: o.currency }) };
  return { db, deps, payments };
}
const DETAILS = { customerName: "Asha", phone: "9845095453", email: "typed@evil.test", address: "12 MG Road Bangalore",
  date: new Date(Date.now() + 5.5 * 3600e3 + 10 * 864e5).toISOString().slice(0, 10), timeSlot: "morning" };
const svcReq = (body) => ({ headers: { authorization: "Bearer good" }, body: Object.assign({ requestId: "req-svc-0001", items: [{ type: "addons", id: "ac-installation", qty: 2 }], details: DETAILS }, body) });

test("catalog order: server amount, flow:'service' pending, verified email only", async () => {
  const { db, deps } = catalogEnv();
  const out = await handleCreateServiceOrder(svcReq({ amount: 1, total: 1 }), deps);
  assert.strictEqual(out.status, 200, JSON.stringify(out.body)); assert.strictEqual(out.body.amount, 280000);
  const p = db.col("pendingPayments")[out.body.orderId];
  assert.strictEqual(p.flow, "service"); assert.strictEqual(p.payNow, 2800); assert.strictEqual(p.email, "asha@example.com"); assert.ok(!("email" in p.details));
});
test("catalog order: unauthenticated 401, rate limited 429, quote items not payable", async () => {
  const { deps } = catalogEnv();
  assert.strictEqual((await handleCreateServiceOrder({ headers: {}, body: {} }, deps)).status, 401);
  assert.strictEqual((await handleCreateServiceOrder(svcReq({}), Object.assign({}, deps, { rateLimit: async () => ({ ok: false }) }))).status, 429);
  deps.loadCatalog = async () => ({ services: { q: { isActive: true, categoryId: "ac-services", name: "Q", basePrice: 0, pricingUnit: "quote" } }, packages: {}, addons: {}, categories: { "ac-services": { isActive: true } } });
  const r = await handleCreateServiceOrder(svcReq({ items: [{ type: "services", id: "q" }] }), deps);
  assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, "not_online_eligible");
});
test("catalog webhook-first capture → service booking via shared finalizeCapture; reconciliation + refund work", async () => {
  const { db, deps } = catalogEnv();
  const out = await handleCreateServiceOrder(svcReq({}), deps);
  const orderId = out.body.orderId; const pay = { id: "pay_SVC000001", order_id: orderId, amount: 280000, currency: "INR", status: "captured" };
  const r = await wh._internal.applyCapturedPayment(Object.assign({}, deps, { sendConfirmation: async () => {} }), pay, "webhook");
  assert.strictEqual(r, "processed");
  const b = db.col("bookings")[orderId];
  assert.strictEqual(b.bookingType, "service"); assert.strictEqual(b.total, 2800); assert.strictEqual(b.paid, 2800); assert.strictEqual(b.balanceDue, 0);
  assert.strictEqual(b.paymentStatus, "paid"); assert.strictEqual(b.customerUid, "uid1"); assert.strictEqual(b.email, "asha@example.com"); assert.strictEqual(b.items[0].qty, 2);
  assert.strictEqual(b.confirmedVia, "webhook"); assert.strictEqual(db.col("pendingPayments")[orderId].status, "consumed");
  // reconciliation is a no-op now (consumed)
  const sum = await wh.reconcilePendingPayments(Object.assign({}, deps, { fetchOrderPayments: async () => [pay] }));
  assert.strictEqual(sum.finalized, 0);
  // refund through the generic admin refund
  const rr = await rf.handleRefund({ bookingId: orderId, paymentId: pay.id, amount: 100, reason: "goodwill", requestId: "rq_svc_000001" },
    { auth: { uid: "adm" } }, Object.assign({}, deps, { isAdmin: async () => true, createRefund: async (pid, o) => ({ id: "rfnd_SVC00001", amount: o.amount, status: "processed" }) }));
  assert.strictEqual(rr.status, "processed"); assert.strictEqual(db.col("bookings")[orderId].paymentStatus, "partially_refunded");
});
test("catalog reconciliation finalizes a lost capture as a service booking", async () => {
  const { db, deps } = catalogEnv();
  const out = await handleCreateServiceOrder(svcReq({}), deps);
  db.col("pendingPayments")[out.body.orderId].createdAt = new Date(1760000000000 - 3600e3).toISOString();
  const pay = { id: "pay_SVC000002", order_id: out.body.orderId, amount: 280000, currency: "INR", status: "captured" };
  const s = await wh.reconcilePendingPayments(Object.assign({}, deps, { fetchOrderPayments: async () => [pay] }));
  assert.strictEqual(s.finalized, 1); assert.strictEqual(db.col("bookings")[out.body.orderId].bookingType, "service");
});
test("move flow unaffected: pending without flow still builds a move booking", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "move-payment.js"), "utf8");
  assert.ok(src.includes('if (p.flow === "service")'));
});

/* ── ops alerts ── */
test("ops digest: detects issues, alerts once, reminds after 24 h, no customer contact data", async () => {
  const db = makeDb(); const now = Date.UTC(2026, 9, 7, 6, 0, 0); const sent = [];
  const today = ops.istDate(now), tomorrow = ops.istDate(now, 1);
  db.col("pendingPayments").order_A = { status: "needs_review", reviewReason: "amount_or_currency_mismatch" };
  db.col("razorpayWebhookEvents").evt_1 = { status: "conflict", event: "payment.captured", orderId: "order_B" };
  db.col("razorpayWebhookEvents").evt_2 = { status: "processing", event: "payment.captured", receivedAt: now - 2 * 3600e3 };
  db.col("razorpayWebhookEvents").evt_3 = { status: "processing", event: "payment.captured", receivedAt: now - 60e3 };
  db.col("notificationLogs").n1 = { status: "failed", channel: "email", createdAt: new Date(now - 3600e3).toISOString(), recipient: "x@example.com" };
  db.col("bookings").b1 = { status: "confirmed", date: tomorrow, bookingRef: "PKZ-B1", phone: "9876543210", customerName: "Ravi" };
  db.col("bookings").b2 = { status: "confirmed", date: today, driverUid: "d1" };
  db.col("bookings").b3 = { status: "cancelled", date: today };
  db.col("opsFailures").f1 = { source: "verifyRazorpayPayment", code: "verification_unavailable", at: now - 600e3 };
  const deps = { db, now: () => now, logger: quiet, sendAdminEmail: async (subj, rows) => sent.push({ subj, rows }) };
  const r1 = await ops.runOpsDigest(deps);
  assert.strictEqual(r1.found, 6); assert.strictEqual(sent.length, 1);
  const text = JSON.stringify(sent[0]);
  for (const t of ["payment_needs_review", "webhook_problem", "notification_failures", "unassigned_booking", "function_failures", "PKZ-B1"]) assert.ok(text.includes(t), t);
  for (const pii of ["9876543210", "Ravi", "x@example.com"]) assert.ok(!text.includes(pii), "leaked " + pii);
  const r2 = await ops.runOpsDigest(deps); assert.strictEqual(r2.notified, 0); assert.strictEqual(sent.length, 1);
  deps.now = () => now + 25 * 3600e3; db.col("bookings").b1.date = ops.istDate(now + 25 * 3600e3);
  const r3 = await ops.runOpsDigest(deps); assert.ok(r3.notified >= 1); assert.ok(JSON.stringify(sent[1]).includes("still open"));
});
test("ops digest: nothing found → no email", async () => {
  const sent = []; const r = await ops.runOpsDigest({ db: makeDb(), now: () => Date.now(), logger: quiet, sendAdminEmail: async () => sent.push(1) });
  assert.strictEqual(r.found, 0); assert.strictEqual(sent.length, 0);
});
test("failure recorder never throws and stores no PII", async () => {
  const db = makeDb(); await ops.recordFailure(db, "createRazorpayOrder", "server_error", 5);
  assert.deepStrictEqual(Object.values(db.col("opsFailures"))[0], { source: "createRazorpayOrder", code: "server_error", at: 5 });
  await ops.recordFailure({ collection: () => { throw new Error("down"); } }, "x", "y");
});

/* ── N-08 ── */
test("admin emails escape public input; only explicit https links render", () => {
  const ns = require("../notification-service.js");
  assert.strictEqual(ns.renderAdminValue('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
  assert.strictEqual(ns.renderAdminValue({ href: "https://packzenblr.in/admin.html", label: "Open <b>" }), '<a href="https://packzenblr.in/admin.html">Open &lt;b&gt;</a>');
  assert.strictEqual(ns.renderAdminValue({ href: "javascript:alert(1)", label: "x<y" }), "x&lt;y");
  assert.strictEqual(ns.renderAdminValue(null), "—");
  const n = fs.readFileSync(path.join(__dirname, "..", "notifications.js"), "utf8");
  assert.ok(n.includes('scope: "deletionAlertEmail"') && !n.includes("<a href='https://packzenblr.in/admin.html'>"));
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e)); } }
  console.log(`\nphase1-hardening: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
