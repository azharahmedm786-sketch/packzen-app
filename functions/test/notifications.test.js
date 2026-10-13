/**
 * Notifications: SMS claim (no double send), honest WhatsApp status,
 * cancel / reschedule / reassignment messages are sent server-side.
 *   node test/notifications.test.js
 */
"use strict";
process.env.GCLOUD_PROJECT = "packzen-e7539";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const admin = require("firebase-admin");
admin.initializeApp();

const store = {}; const col = (n) => (store[n] = store[n] || {});
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
let auto = 0;
function ref(n, id) { return { _n: n, id, get: async () => ({ exists: id in col(n), data: () => clone(col(n)[id]) }),
  update: async (d) => { Object.assign(col(n)[id], clone(d)); } }; }
const db = { collection: (n) => ({ doc: (id) => ref(n, id), add: async (d) => { const id = "q" + (++auto); col(n)[id] = clone(d); return { id }; } }),
  runTransaction: async (fn) => { const w = []; const tx = { get: async (r) => ({ exists: r.id in col(r._n), data: () => clone(col(r._n)[r.id]) }),
    update: (r, d) => w.push(() => Object.assign(col(r._n)[r.id], clone(d))) }; const out = await fn(tx); w.forEach((f) => f()); return out; } };
const fsFn = () => db; fsFn.FieldValue = { serverTimestamp: () => "TS" };
Object.defineProperty(admin, "firestore", { value: fsFn, configurable: true });
const emails = []; const adminEmails = [];
require.cache[require.resolve("../notification-service")] = { exports: {
  sendCustomerEmail: async (t, e) => { emails.push(t); }, sendAdminEmail: async (s) => { adminEmails.push(s); }, logNotification: async () => {} }, loaded: true, id: "ns" };
require.cache[require.resolve("../brevo-client")] = { exports: { BREVO_SECRETS: [], sendBrevoEmail: async () => ({ success: true }) }, loaded: true, id: "brevo" };
const { claimPending } = require("../queue-claim.js");
const notif = require("../notifications.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const ts = (ms) => ({ toMillis: () => ms });
const sms = () => Object.values(col("smsQueue")).map((d) => d.mobile + "|" + d.message);
const reset = () => { store.smsQueue = {}; store.whatsappQueue = {}; emails.length = 0; adminEmails.length = 0; };
const run = (before, after) => notif.onBookingUpdatedNotify.run(
  { before: { data: () => before }, after: { data: () => after, ref: { update: async () => {} } } }, { params: { bookingId: "b1" } });
col("users").c1 = { email: "asha@example.com" };
const base = { customerUid: "c1", bookingRef: "PZ1", customerName: "Asha", phone: "9000000001", date: "2026-11-01", pickup: "A", drop: "B", status: "assigned" };

(async () => {
  // claim
  col("smsQueue").x = { status: "pending", mobile: "1", message: "m" };
  const r = db.collection("smsQueue").doc("x");
  const a = await claimPending(db, r); const b = await claimPending(db, r); // a duplicate trigger arriving after the first claim
  assert.ok(a && a.message === "m"); assert.strictEqual(b, null);
  assert.strictEqual(await claimPending(db, r), null); assert.strictEqual(col("smsQueue").x.status, "sending");
  ok("claimPending: only one invocation wins; the message is then 'sending', not re-sendable");
  assert.strictEqual(await claimPending(db, db.collection("smsQueue").doc("missing")), null);
  ok("claimPending: missing doc is ignored");

  // reassignment
  reset();
  await run(Object.assign({}, base, { driverUid: "d1", driverName: "Old", driverPhone: "9000000011" }),
            Object.assign({}, base, { driverUid: "d2", driverName: "New", driverPhone: "9000000022" }));
  const s1 = sms();
  assert.ok(s1.some((x) => x.startsWith("9000000001|") && x.includes("has changed to New")));
  assert.ok(s1.some((x) => x.startsWith("9000000022|") && x.includes("New Booking Assigned")));
  assert.ok(s1.some((x) => x.startsWith("9000000011|") && x.includes("reassigned")));
  assert.ok(adminEmails.includes("Driver Reassigned"));
  ok("reassignment: customer, new driver and old driver are all told; admin alerted");

  // first assignment unchanged
  reset();
  await run(Object.assign({}, base), Object.assign({}, base, { driverUid: "d2", driverName: "New", driverPhone: "9000000022" }));
  assert.ok(!sms().some((x) => x.includes("reassigned") || x.includes("has changed to")));
  ok("first assignment does not trigger reassignment messages");

  // cancel
  reset();
  await run(Object.assign({}, base, { driverUid: "d1", driverPhone: "9000000011" }), Object.assign({}, base, { status: "cancelled", driverUid: null, driverPhone: "" }));
  const s2 = sms();
  assert.ok(s2.some((x) => x.startsWith("9000000001|") && x.includes("cancelled")));
  assert.ok(s2.some((x) => x.startsWith("9000000011|") && x.includes("do not attend")));
  ok("cancellation: customer SMS + WhatsApp, and the assigned driver is told (even if cleared in the same write)");

  // reschedule: first, repeat, and unrelated date edits
  reset();
  await run(Object.assign({}, base, { driverPhone: "9000000011" }), Object.assign({}, base, { date: "2026-11-05", rescheduledAt: ts(1), driverPhone: "9000000011" }));
  assert.ok(sms().some((x) => x.startsWith("9000000001|") && x.includes("rescheduled to 2026-11-05")));
  assert.ok(sms().some((x) => x.startsWith("9000000011|") && x.includes("2026-11-01 to 2026-11-05")));
  reset();
  await run(Object.assign({}, base, { date: "2026-11-05", rescheduledAt: ts(1) }), Object.assign({}, base, { date: "2026-11-07", rescheduledAt: ts(2) }));
  assert.strictEqual(sms().length, 1); assert.deepStrictEqual(emails, ["booking_rescheduled"]);
  reset();
  await run(Object.assign({}, base, { date: "2026-11-05", rescheduledAt: ts(1) }), Object.assign({}, base, { date: "2026-11-07", rescheduledAt: ts(1) }));
  assert.strictEqual(sms().length, 0);
  ok("reschedule: SMS on first and later reschedules; nothing for date edits without a new rescheduledAt");

  // wiring
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(/claimPending\(admin\.firestore\(\), docRef\)/.test(idx));
  assert.ok(!/dummy: true/.test(idx) && /status: "not_sent"/.test(idx));
  ok("sendSMS claims before sending; WhatsApp no longer fakes 'sent'");
  const js = fs.readFileSync(path.join(__dirname, "..", "..", "public", "script.js"), "utf8");
  assert.ok(!/collection\("smsQueue"\)/.test(js)); ok("browser no longer tries to write smsQueue (rules deny it)");

  console.log(`\nnotifications: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
