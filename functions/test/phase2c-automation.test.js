/**
 * Phase 2C automatic offers, 2E balance collection + completion gate, 2F review requests.
 * Mocks only; the fake Firestore ENFORCES "all reads before writes" in transactions.
 *   node test/phase2c-automation.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const offers = require("../job-offers.js");
const asg = require("../assignment.js");
const balance = require("../balance.js");
const otp = require("../completion-otp.js");
const review = require("../review-request.js");
const ROOT = path.join(__dirname, "..", "..");
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function makeDb() {
  const store = {}; let seq = 0;
  const col = (n) => (store[n] = store[n] || {});
  const has = (n, id) => Object.prototype.hasOwnProperty.call(col(n), id);
  const snap = (n, id) => ({ exists: has(n, id), id, ref: ref(n, id), data: () => clone(col(n)[id]) });
  function ref(n, id) { return { _n: n, id, get: async () => snap(n, id), set: async (d) => { col(n)[id] = clone(d); }, update: async (d) => { Object.assign(col(n)[id], clone(d)); },
    collection: (sub) => collection(n + "/" + id + "/" + sub) }; }
  const cmp = (v, op, x) => (op === "==" ? v === x : op === "in" ? x.includes(v) : false);
  function query(n, f, lim) { return { where: (a, op, b) => query(n, f.concat([[a, op, b]]), lim), limit: (k) => query(n, f, k),
    get: async () => { let ids = Object.keys(col(n)).filter((id) => f.every(([a, op, b]) => cmp(col(n)[id][a], op, b))); if (lim) ids = ids.slice(0, lim); return { docs: ids.map((id) => snap(n, id)), empty: !ids.length }; } }; }
  function collection(n) { return Object.assign(query(n, [], null), { doc: (id) => ref(n, id || "auto" + (++seq)) }); }
  let chain = Promise.resolve();
  return { store, col, collection,
    runTransaction(fn) { const run = chain.then(async () => { const w = []; let wrote = false;
      const tx = { get: async (r) => { if (wrote) throw new Error("Firestore transactions require all reads before writes"); return snap(r._n, r.id); },
        set: (r, d) => { wrote = true; w.push(() => { col(r._n)[r.id] = clone(d); }); }, update: (r, d) => { wrote = true; w.push(() => { Object.assign(col(r._n)[r.id], clone(d)); }); } };
      const out = await fn(tx); w.forEach((x) => x()); return out; }); chain = run.catch(() => {}); return run; } };
}
const quiet = { info() {}, warn() {}, error() {} };
const tests = []; const test = (n, f) => tests.push({ n, f });
async function rejects(p, code) { try { await p; } catch (e) { assert.strictEqual(e.code, code, "got " + e.code + ": " + (e.publicMessage || e.message)); return e; } throw new Error("expected " + code); }
const ctx = (uid) => ({ auth: { uid, token: { email_verified: true } } });
const NOW = Date.parse("2026-10-10T03:30:00Z"); // 09:00 IST

function env(opts) {
  const db = makeDb(); const alerts = []; let now = NOW;
  const user = (uid, role) => { db.col("users")[uid] = { role: role || "driver", name: uid.toUpperCase(), phone: "9000000000" }; };
  for (const u of ["drvA000001", "drvB000001", "drvC000001"]) user(u);
  user("custX00001", "customer"); user("adminAAA01", "admin");
  const P = (o) => Object.assign({ status: "active", serviceAreas: ["bangalore"], vehicleIds: ["truck_22ft"], skills: ["moving"], maxJobsPerDay: 3, acceptance: { offered: 0, accepted: 0, declined: 0, expired: 0 } }, o);
  db.col("driverProfiles").drvA000001 = P({ rating: { avg: 5, count: 10 } });
  db.col("driverProfiles").drvB000001 = P({ rating: { avg: 4, count: 10 } });
  db.col("driverProfiles").drvC000001 = P({ rating: { avg: 3, count: 10 } });
  db.col("bookings").bkAuto0001 = { status: "confirmed", bookingType: "move", vehicleUsed: "truck_17ft", date: "2026-10-11", shiftTime: "09:00",
    customerUid: "cust1", customerName: "Asha Rao", phone: "9876543210", email: "asha@example.com", pickup: "12, 4th Cross, Koramangala, Bangalore, Karnataka, India", drop: "HSR", total: 5000, paid: 500, balanceDue: 4500 };
  if (!opts || opts.flag !== false) db.col("appConfig").assignment = { autoOffers: true, offerTimeoutMin: 5, maxAttempts: 2, horizonHours: 72 };
  const deps = { db, now: () => now, logger: quiet, alert: async (s, rows) => alerts.push({ s, rows }),
    isAdmin: async (c) => c.auth.uid === "adminAAA01", isDriver: async (c) => /^drv/.test(c.auth.uid) };
  return { db, deps, alerts, setNow: (t) => { now = t; } };
}
const liveOffer = (db) => Object.entries(db.col("jobOffers")).find(([, o]) => o.state === "offered");

/* ═════ 2C ═════ */
test("2C flag OFF (default): sweep offers nothing", async () => {
  const { db, deps } = env({ flag: false });
  const s = await offers.sweep(deps);
  assert.strictEqual(s.enabled, false); assert.strictEqual(Object.keys(db.col("jobOffers")).length, 0);
  assert.ok(!db.col("bookings").bkAuto0001.assignment);
});
test("2C flag ON: best driver gets a 5-minute offer; offer has no customer details", async () => {
  const { db, deps } = env();
  const s = await offers.sweep(deps);
  assert.strictEqual(s.offered, 1);
  const [id, o] = liveOffer(db);
  assert.deepStrictEqual([o.driverUid, o.state, o.attempt, o.expiresAt - o.offeredAt], ["drvA000001", "offered", 1, 5 * 60e3]);
  const txt = JSON.stringify(o);
  for (const pii of ["Asha", "9876543210", "asha@example.com", "4th Cross", "cust1"]) assert.ok(!txt.includes(pii), "leaked " + pii);
  const b = db.col("bookings").bkAuto0001;
  assert.deepStrictEqual([b.assignment.state, b.assignment.offerId, b.driverUid], ["offering", id, undefined]);
  assert.strictEqual(db.col("driverProfiles").drvA000001.acceptance.offered, 1);
  assert.strictEqual((await offers.sweep(deps)).offered, 0, "no second offer while one is live");
});
test("2C accept: assigns in one transaction (lock, currentBooking, stats); repeat is idempotent", async () => {
  const { db, deps } = env(); await offers.sweep(deps); const [id] = liveOffer(db);
  const r = await offers.handleAccept({ offerId: id }, ctx("drvA000001"), deps);
  assert.ok(r.ok); const b = db.col("bookings").bkAuto0001;
  assert.deepStrictEqual([b.driverUid, b.status, b.assignment.state, b.assignment.method], ["drvA000001", "assigned", "accepted", "auto"]);
  assert.deepStrictEqual(db.col("driverSchedule")["drvA000001_2026-10-11"].jobs, { bkAuto0001: 540 });
  assert.strictEqual(db.col("users").drvA000001.currentBooking, "bkAuto0001");
  assert.strictEqual(db.col("driverProfiles").drvA000001.acceptance.accepted, 1);
  assert.strictEqual((await offers.handleAccept({ offerId: id }, ctx("drvA000001"), deps)).already, true);
  assert.deepStrictEqual([b.total, b.paid, b.balanceDue], [5000, 500, 4500]);
});
test("2C accept: other driver, customer, expired offer rejected", async () => {
  const e = env(); await offers.sweep(e.deps); const [id] = liveOffer(e.db);
  await rejects(offers.handleAccept({ offerId: id }, ctx("drvB000001"), e.deps), "permission-denied");
  await rejects(offers.handleAccept({ offerId: id }, ctx("custX00001"), e.deps), "permission-denied");
  e.setNow(NOW + 5 * 60e3); await rejects(offers.handleAccept({ offerId: id }, ctx("drvA000001"), e.deps), "deadline-exceeded");
  assert.ok(!e.db.col("bookings").bkAuto0001.driverUid);
});
test("2C race: driver accept vs admin manual assignment at the same time → exactly one wins", async () => {
  const { db, deps } = env(); await offers.sweep(deps); const [id] = liveOffer(db);
  const res = await Promise.allSettled([offers.handleAccept({ offerId: id }, ctx("drvA000001"), deps),
    asg.handleAssign({ bookingId: "bkAuto0001", driverUid: "drvB000001", expectedDriverUid: null }, ctx("adminAAA01"), deps)]);
  assert.strictEqual(res.filter((x) => x.status === "fulfilled").length, 1);
  const b = db.col("bookings").bkAuto0001; assert.ok(["drvA000001", "drvB000001"].includes(b.driverUid));
  await offers.sweep(deps);
  assert.ok(Object.values(db.col("jobOffers")).every((o) => o.state !== "offered"), "orphan offer cleaned up");
});
test("2C decline → next driver offered at once (previous excluded)", async () => {
  const { db, deps } = env(); await offers.sweep(deps); const [id] = liveOffer(db);
  await offers.handleDecline({ offerId: id }, ctx("drvA000001"), deps);
  assert.strictEqual(db.col("jobOffers")[id].state, "declined");
  const [id2, o2] = liveOffer(db); assert.notStrictEqual(id2, id); assert.strictEqual(o2.driverUid, "drvB000001");
  assert.strictEqual(db.col("driverProfiles").drvA000001.acceptance.declined, 1);
});
test("2C 5-minute expiry → next driver; after maxAttempts → needs_manual + ONE admin alert", async () => {
  const e = env(); await offers.sweep(e.deps);
  e.setNow(NOW + 5 * 60e3 + 1); await offers.sweep(e.deps);
  const exp = Object.values(e.db.col("jobOffers")).filter((o) => o.state === "expired"); assert.strictEqual(exp.length, 1);
  assert.strictEqual(liveOffer(e.db)[1].driverUid, "drvB000001");
  e.setNow(NOW + 11 * 60e3); await offers.sweep(e.deps);
  const b = e.db.col("bookings").bkAuto0001;
  assert.deepStrictEqual([b.assignment.state, b.assignment.reason], ["needs_manual", "attempts_exhausted"]);
  assert.strictEqual(e.alerts.length, 1); assert.ok(!JSON.stringify(e.alerts).includes("9876543210"));
  e.setNow(NOW + 20 * 60e3); await offers.sweep(e.deps); assert.strictEqual(e.alerts.length, 1, "no repeat alerts");
  const r = await asg.handleAssign({ bookingId: "bkAuto0001", driverUid: "drvC000001", expectedDriverUid: null }, ctx("adminAAA01"), e.deps);
  assert.ok(r.ok, "admin can still assign manually");
});
test("2C no eligible driver → needs_manual straight away; far-future and past bookings not offered", async () => {
  const e = env(); for (const p of Object.values(e.db.col("driverProfiles"))) p.status = "suspended";
  await offers.sweep(e.deps); assert.strictEqual(e.db.col("bookings").bkAuto0001.assignment.reason, "no_eligible_driver");
  const f = env(); f.db.col("bookings").bkAuto0001.date = "2026-12-01"; await offers.sweep(f.deps); assert.strictEqual(Object.keys(f.db.col("jobOffers")).length, 0);
  const g = env(); g.db.col("bookings").bkAuto0001.date = "2026-10-01"; await offers.sweep(g.deps); assert.strictEqual(Object.keys(g.db.col("jobOffers")).length, 0);
});
test("2C rules + UI wiring", () => {
  const r = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  assert.ok(/match \/jobOffers\/\{offerId\} \{\s*allow read: if isAdmin\(\) \|\| isAdvisor\(\) \|\| \(isDriver\(\) && resource\.data\.driverUid == request\.auth\.uid\);\s*allow write: if false;/.test(r));
  const d = fs.readFileSync(path.join(ROOT, "public/driver.html"), "utf8");
  assert.ok(d.includes('"acceptJobOffer" : "declineJobOffer"') && d.includes('collection("jobOffers")') && d.includes('"recordBalanceCollection"'));
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  for (const f of ["acceptJobOffer", "declineJobOffer", "jobOfferSweep", "recordBalanceCollection"]) assert.ok(new RegExp("exports\\." + f + " = ").test(idx), f);
  assert.ok(idx.includes('.pubsub.schedule("every 1 minutes")'));
});

/* ═════ 2E ═════ */
function balEnv(status, extra) {
  const e = env(); Object.assign(e.db.col("bookings").bkAuto0001, { status: status || "transit", driverUid: "drvA000001" }, extra || {});
  return e;
}
test("2E record cash/UPI: updates paid/balance/status, idempotent, never over-collects", async () => {
  const { db, deps } = balEnv();
  const r1 = await balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 4000, method: "cash", requestId: "col_req_00001" }, ctx("drvA000001"), deps);
  assert.strictEqual(r1.balanceDue, 500);
  let b = db.col("bookings").bkAuto0001; assert.deepStrictEqual([b.paid, b.balanceDue, b.paymentStatus, b.total], [4500, 500, "partially_paid", 5000]);
  assert.strictEqual((await balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 4000, method: "cash", requestId: "col_req_00001" }, ctx("drvA000001"), deps)).already, true);
  assert.strictEqual(db.col("bookings").bkAuto0001.paid, 4500, "replay not double-counted");
  await rejects(balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 501, method: "upi", requestId: "col_req_00002" }, ctx("drvA000001"), deps), "invalid-argument");
  await balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 500, method: "upi", requestId: "col_req_00003" }, ctx("drvA000001"), deps);
  b = db.col("bookings").bkAuto0001; assert.deepStrictEqual([b.paid, b.balanceDue, b.paymentStatus], [5000, 0, "paid"]);
  assert.strictEqual(Object.keys(db.col("bookings/bkAuto0001/collections")).length, 2);
});
test("2E record: other driver / customer denied; bad input; inactive or legacy booking refused", async () => {
  const { deps } = balEnv();
  await rejects(balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 10, method: "cash", requestId: "col_req_00004" }, ctx("drvB000001"), deps), "permission-denied");
  await rejects(balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 10, method: "cash", requestId: "col_req_00005" }, ctx("custX00001"), deps), "permission-denied");
  for (const bad of [{ amount: 0 }, { amount: 10.5 }, { amount: -5 }, { method: "card" }, { requestId: "x" }])
    await rejects(balance.handleRecordCollection(Object.assign({ bookingId: "bkAuto0001", amount: 10, method: "cash", requestId: "col_req_00006" }, bad), ctx("drvA000001"), deps), "invalid-argument");
  const d = balEnv("delivered"); await rejects(balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 10, method: "cash", requestId: "col_req_00007" }, ctx("drvA000001"), d.deps), "failed-precondition");
  const l = balEnv("transit"); delete l.db.col("bookings").bkAuto0001.balanceDue;
  await rejects(balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 10, method: "cash", requestId: "col_req_00008" }, ctx("drvA000001"), l.deps), "failed-precondition");
});
test("2E completion gate: code refused while balance is due (attempts untouched); OK once paid", async () => {
  const { db, deps } = balEnv();
  const od = Object.assign({}, deps, { pepper: "pepper_for_tests_only_xxxxxxxxxxxx", serverTimestamp: () => "TS", sendCustomerEmail: async () => {}, rateLimit: async () => ({ ok: true }) });
  db.col("bookings").bkAuto0001.customerUid = "cust1";
  const code = (await otp.handleGetOtp({ bookingId: "bkAuto0001" }, ctx("cust1"), od)).otp;
  const e = await rejects(otp.handleVerifyOtp({ bookingId: "bkAuto0001", otp: code }, ctx("drvA000001"), od), "failed-precondition");
  assert.ok(/₹4500/.test(e.publicMessage)); assert.strictEqual(db.col("bookingSecrets").bkAuto0001.attempts, 0);
  await balance.handleRecordCollection({ bookingId: "bkAuto0001", amount: 4500, method: "upi", requestId: "col_req_00009" }, ctx("drvA000001"), deps);
  assert.ok((await otp.handleVerifyOtp({ bookingId: "bkAuto0001", otp: code }, ctx("drvA000001"), od)).ok);
  assert.strictEqual(db.col("bookings").bkAuto0001.status, "delivered");
});
test("2E legacy bookings without a recorded balance can still complete", () => {
  assert.strictEqual(balance.completionBlocker({}), null); assert.strictEqual(balance.completionBlocker({ balanceDue: 0 }), null);
  assert.ok(balance.completionBlocker({ balanceDue: 1 }));
});

/* ═════ 2F ═════ */
function revEnv() {
  const db = makeDb(); const sent = [];
  const base = { status: "delivered", completionMethod: "otp", deliveredAt: NOW - 2 * 3600e3 - 1, email: "c@example.com", bookingRef: "PKZ-1" };
  db.col("bookings").ok = Object.assign({}, base);
  db.col("bookings").tooSoon = Object.assign({}, base, { deliveredAt: NOW - 3600e3 });
  db.col("bookings").override = Object.assign({}, base, { completionMethod: "admin_override" });
  db.col("bookings").damage = Object.assign({}, base, { damageClaimed: true });
  db.col("bookings").refunded = Object.assign({}, base, { paymentStatus: "refunded" });
  db.col("bookings").already = Object.assign({}, base, { feedbackRequestSent: true });
  db.col("bookings").legacy = Object.assign({}, base, { completionMethod: undefined });
  db.col("bookings").noEmail = Object.assign({}, base, { email: null });
  return { db, sent, deps: { db, now: () => NOW, logger: quiet, getEmail: async (b) => b.email || null, send: async (to, d) => sent.push({ to, url: d.reviewUrl }) } };
}
test("2F review request: once, 2 h after a verified completion, with the Google link; exclusions respected", async () => {
  const { db, sent, deps } = revEnv();
  const r = await review.run(deps);
  assert.strictEqual(r.sent, 1); assert.deepStrictEqual(sent, [{ to: "c@example.com", url: "https://g.page/r/CR_hUMH7jJOvEBM/review" }]);
  for (const k of ["tooSoon", "override", "damage", "refunded", "legacy"]) assert.ok(!db.col("bookings")[k].feedbackRequestSent || k === "already", k);
  assert.strictEqual(db.col("bookings").noEmail.feedbackRequestError, "no_email");
  assert.strictEqual((await review.run(deps)).sent, 0, "never sent twice");
  const both = revEnv(); await Promise.all([review.run(both.deps), review.run(both.deps)]); assert.strictEqual(both.sent.length, 1, "overlapping runs send once");
});
test("2F schedule + template wiring", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "scheduled-notifications.js"), "utf8");
  assert.ok(/exports\.sendFeedbackRequests[\s\S]{0,200}every 30 minutes/.test(s) && s.includes("reviewRequest.run("));
  const t = fs.readFileSync(path.join(__dirname, "..", "email-templates.js"), "utf8");
  assert.ok(t.includes('ctaUrl: d.reviewUrl || BRAND.website'));
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e)); } }
  console.log(`\nphase2c-automation: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
