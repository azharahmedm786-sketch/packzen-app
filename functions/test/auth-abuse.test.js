/**
 * N-06 signup OTP lockout + R2-16 signup OTP abuse limits (mocked admin/Brevo).
 *   node test/auth-abuse.test.js
 */
"use strict";
process.env.GCLOUD_PROJECT = "packzen-e7539";
const assert = require("assert");
const admin = require("firebase-admin");
admin.initializeApp();

// Firestore fake with REAL transaction semantics: writes are discarded when the callback throws.
const store = {}; const col = (n) => (store[n] = store[n] || {});
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
function ref(n, id) { return { _n: n, id, get: async () => ({ exists: id in col(n), data: () => clone(col(n)[id]) }), set: async (d, o) => { col(n)[id] = Object.assign(o && o.merge ? (col(n)[id] || {}) : {}, clone(d)); }, delete: async () => { delete col(n)[id]; } }; }
const db = { collection: (n) => ({ doc: (id) => ref(n, id), add: async () => ({ id: "x" }) }),
  runTransaction: async (fn) => { const w = []; const tx = { get: async (r) => ({ exists: r.id in col(r._n), data: () => clone(col(r._n)[r.id]) }),
    set: (r, d, o) => w.push(() => { col(r._n)[r.id] = Object.assign(o && o.merge ? (col(r._n)[r.id] || {}) : {}, clone(d)); }),
    update: (r, d) => w.push(() => Object.assign(col(r._n)[r.id], clone(d))), delete: (r) => w.push(() => { delete col(r._n)[r.id]; }) };
    const out = await fn(tx); w.forEach((f) => f()); return out; } };
const fsFn = () => db; fsFn.FieldValue = { serverTimestamp: () => "TS" };
Object.defineProperty(admin, "firestore", { value: fsFn, configurable: true });
let created = 0;
Object.defineProperty(admin, "auth", { value: () => ({ getUserByEmail: async () => { const e = new Error("nf"); e.code = "auth/user-not-found"; throw e; },
  createUser: async () => { created++; return { uid: "newuser" }; }, createCustomToken: async () => "tok", deleteUser: async () => {} }), configurable: true });
const sent = [];
require.cache[require.resolve("../brevo-client")] = { exports: { BREVO_SECRETS: [], sendBrevoEmail: async (m) => { sent.push(m.toEmail); return { success: true }; } }, loaded: true, id: "brevo" };
require.cache[require.resolve("../notification-service")] = { exports: { logNotification: async () => {} }, loaded: true, id: "ns" };
const fns = require("../auth-emails.js");
const ctxIp = (ip) => ({ rawRequest: { headers: { "x-forwarded-for": ip } } });

(async () => {
  let pass = 0;
  const ok = (n) => { pass++; console.log("  PASS  " + n); };
  const email = "victim@example.com";
  const base = { email, password: "secret123", firstName: "A", lastName: "B", phone: "9876543210" };

  // N-06: five wrong codes must really lock the code (previously the counter was rolled back)
  col("signupOtps")[email] = { otp: "123456", expiresAt: Date.now() + 600000, attempts: 0 };
  for (let i = 1; i <= 4; i++) {
    await assert.rejects(fns.verifySignupOtpBrevo.run(Object.assign({ otp: "000000" }, base), ctxIp("1.1.1.1")), (e) => e.code === "invalid-argument");
    assert.strictEqual(col("signupOtps")[email].attempts, i, "attempt " + i + " was committed");
  }
  await assert.rejects(fns.verifySignupOtpBrevo.run(Object.assign({ otp: "000000" }, base), ctxIp("1.1.1.1")), (e) => e.code === "resource-exhausted");
  assert.ok(!(email in col("signupOtps")), "code destroyed after 5th wrong attempt");
  await assert.rejects(fns.verifySignupOtpBrevo.run(Object.assign({ otp: "123456" }, base), ctxIp("1.1.1.1")), (e) => e.code === "not-found");
  assert.strictEqual(created, 0, "no account created by brute force");
  ok("N-06: wrong attempts are committed; 5th locks; the correct code no longer works");

  // expired code is deleted (also previously rolled back)
  col("signupOtps")[email] = { otp: "123456", expiresAt: Date.now() - 1, attempts: 0 };
  await assert.rejects(fns.verifySignupOtpBrevo.run(Object.assign({ otp: "123456" }, base), ctxIp("1.1.1.2")), (e) => e.code === "deadline-exceeded");
  assert.ok(!(email in col("signupOtps"))); ok("N-06: expired code deletion is committed");

  // correct code still works
  col("signupOtps")[email] = { otp: "654321", expiresAt: Date.now() + 600000, attempts: 2 };
  await fns.verifySignupOtpBrevo.run(Object.assign({ otp: "654321" }, base), ctxIp("1.1.1.3")).catch(() => {});
  assert.strictEqual(created, 1); ok("N-06: correct code creates the account once");

  // per-IP verify brute-force guard (30/hour)
  let blocked = false;
  for (let i = 0; i < 31; i++) {
    try { await fns.verifySignupOtpBrevo.run(Object.assign({ otp: "000000" }, base, { email: "x" + i + "@example.com" }), ctxIp("9.9.9.9")); }
    catch (e) { if (e.code === "resource-exhausted" && /Too many attempts/.test(e.message)) blocked = true; }
  }
  assert.ok(blocked); ok("verify: per-IP limit");

  // R2-16: one IP cannot spray OTP emails at many addresses (10/hour), per-email limit kept
  sent.length = 0; let ipBlocked = 0;
  for (let i = 0; i < 12; i++) {
    try { await fns.sendSignupOtpBrevo.run({ email: "spam" + i + "@example.com", name: "S" }, ctxIp("5.5.5.5")); }
    catch (e) { if (e.code === "resource-exhausted") ipBlocked++; else throw e; }
  }
  assert.strictEqual(sent.length, 10); assert.strictEqual(ipBlocked, 2); ok("R2-16: per-IP cap on OTP emails");
  sent.length = 0; let emailBlocked = 0;
  for (let i = 0; i < 4; i++) {
    try { await fns.sendSignupOtpBrevo.run({ email: "one@example.com", name: "S" }, ctxIp("6.6.6." + i)); }
    catch (e) { if (e.code === "resource-exhausted") emailBlocked++; else throw e; }
  }
  assert.strictEqual(sent.length, 3); assert.strictEqual(emailBlocked, 1); ok("R2-16: existing per-email limit still applies");
  const dump = JSON.stringify(store.rateLimits || {}); assert.ok(!dump.includes("5.5.5.5") && !dump.includes("spam0@example.com")); ok("rate-limit docs contain no IPs or emails");

  console.log(`\nauth-abuse: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
