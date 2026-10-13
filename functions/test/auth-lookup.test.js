/**
 * Auth abuse: password reset + provider lookup limits (mocked admin/Brevo).
 *   node test/auth-lookup.test.js
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
let users = { "real@example.com": { uid: "u1", displayName: "R", providerData: [{ providerId: "password" }] } };
Object.defineProperty(admin, "auth", { value: () => ({
  getUserByEmail: async (e) => { if (users[e]) return users[e]; const x = new Error("nf"); x.code = "auth/user-not-found"; throw x; },
  generatePasswordResetLink: async () => "https://reset" }), configurable: true });
const sent = [];
require.cache[require.resolve("../brevo-client")] = { exports: { BREVO_SECRETS: [], sendBrevoEmail: async (m) => { sent.push(m.toEmail); return { success: true }; } }, loaded: true, id: "brevo" };
require.cache[require.resolve("../notification-service")] = { exports: { logNotification: async () => {} }, loaded: true, id: "ns" };
process.env.ACTION_URL = "https://packzenblr.in";
const fns = require("../auth-emails.js");
const ctxIp = (ip) => ({ rawRequest: { headers: { "x-forwarded-for": ip } } });
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
async function code(p) { try { await p; return "ok"; } catch (e) { return e.code; } }

(async () => {
  // provider lookup: one IP probing many addresses is capped
  let blocked = 0, allowed = 0;
  for (let i = 0; i < 35; i++) { const c = await code(fns.checkAuthProvider.run({ email: `probe${i}@example.com` }, ctxIp("9.9.9.9"))); if (c === "resource-exhausted") blocked++; else allowed++; }
  assert.strictEqual(allowed, 30); assert.strictEqual(blocked, 5); ok("checkAuthProvider: per-IP cap stops address enumeration");
  assert.strictEqual(await code(fns.checkAuthProvider.run({ email: "probe0@example.com" }, ctxIp("8.8.8.8"))), "ok"); ok("checkAuthProvider: other IPs unaffected");

  // password reset: limited before lookup, so unknown emails also consume the IP budget
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await code(fns.sendPasswordResetEmailBrevo.run({ email: `nobody${i}@example.com` }, ctxIp("7.7.7.7"))));
  assert.strictEqual(results.filter((c) => c === "not-found").length, 10);
  assert.strictEqual(results.filter((c) => c === "resource-exhausted").length, 2);
  ok("password reset: per-IP cap applies before the account lookup (enumeration bounded)");
  assert.strictEqual(await code(fns.sendPasswordResetEmailBrevo.run({ email: "real@example.com" }, ctxIp("6.6.6.6"))), "ok");
  assert.deepStrictEqual(sent, ["real@example.com"]); ok("password reset: genuine request from a fresh IP still sends");
  const dump = JSON.stringify(store.rateLimits || {}); assert.ok(!dump.includes("9.9.9.9") && !dump.includes("7.7.7.7")); ok("rate-limit docs contain no raw IPs");

  console.log(`\nauth-lookup: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
