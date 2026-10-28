/**
 * Phase 4/5: abandoned quotes become leads; parcel receivers get the delivery code;
 * reviews need approval; booking header shows a live estimate.
 *   node test/phase45.test.js
 */
"use strict";
process.env.GCLOUD_PROJECT = "packzen-e7539";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const { _leads: L } = require("../leads.js");
const otp = require("../completion-otp.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const ts = (ms) => ({ toMillis: () => ms });

(async () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const data = {
    quotes: { q1: { uid: "u1", total: 6500, pickup: "HSR Layout 560102", drop: "Whitefield", house: "2 BHK", createdAt: ts(now - 3 * 3600e3) },
              q2: { uid: "u1", total: 6400, pickup: "HSR", drop: "Whitefield", house: "2 BHK", createdAt: ts(now - 4 * 3600e3) },
              q3: { uid: "u2", total: 4200, pickup: "Koramangala", drop: "Indiranagar", house: "1 BHK", createdAt: ts(now - 5 * 3600e3) },
              q4: { uid: "u3", total: 3000, pickup: "BTM", drop: "JP Nagar", house: "1 RK", createdAt: ts(now - 3 * 3600e3) } },
    bookings: { b1: { customerUid: "u2", createdAt: ts(now - 4 * 3600e3) } },
    users: { u1: { name: "Asha", phone: "9876543210" }, u2: { name: "Ravi", phone: "9123456780" }, u3: { name: "NoPhone" } },
    leads: {},
  };
  let n = 0;
  const docRef = (c, id) => ({ id, get: async () => ({ exists: !!data[c][id], data: () => data[c][id] }), set: async (d) => { data[c][id] = d; }, update: async (u) => { Object.assign(data[c][id], u); } });
  const query = (c, filters) => ({
    where: (f, op, v) => query(c, filters.concat([[f, op, v]])),
    limit: () => ({ get: async () => ({ docs: Object.entries(data[c]).filter(([, d]) => filters.every(([f, op, v]) => {
      const x = d[f]; const xv = x && x.toMillis ? x.toMillis() : x; const vv = v instanceof Date ? v.getTime() : v;
      return op === "==" ? xv === vv : op === ">=" ? xv >= vv : op === "<=" ? xv <= vv : false; })).map(([id, d]) => ({ id, data: () => d, ref: docRef(c, id) })) }) }),
  });
  const db = { collection: (c) => Object.assign(query(c, []), { doc: (id) => docRef(c, id || "L" + (++n)) }) };
  const r = await L.sweepAbandonedQuotes({ db, now: () => now, serverTimestamp: () => "TS", arrayUnion: (x) => x });
  const leads = Object.values(data.leads);
  assert.strictEqual(r.created, 1); assert.strictEqual(leads.length, 1);
  assert.strictEqual(leads[0].phone, "9876543210"); assert.strictEqual(leads[0].source, "abandoned-quote"); assert.ok(/₹6,500/.test(leads[0].notes));
  assert.ok(data.quotes.q1.leadProcessed && data.quotes.q2.leadProcessed && data.quotes.q3.leadProcessed && data.quotes.q4.leadProcessed);
  const again = await L.sweepAbandonedQuotes({ db, now: () => now, serverTimestamp: () => "TS", arrayUnion: (x) => x });
  assert.strictEqual(again.created, 0);
  ok("abandoned quotes: one lead per customer (latest quote), skipped if they booked or have no phone; never processed twice");

  const sms = [];
  const fakeDb = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => "nonce123" };
  const deps = { db: fakeDb, now: () => 0, pepper: "p", queueSms: async (m, t, r, k) => sms.push([m, t, k]) };
  const parcel = { bookingType: "parcel", receiverPhone: "9123456780", customerName: "Asha", bookingRef: "PZ9" };
  let out = await otp.sendCompletionOtpSms(deps, "order_ABC123", parcel);
  const code = otp.deriveOtp("p", "order_ABC123", "nonce123");
  assert.ok(out.sent && sms[0][0] === "9123456780" && sms[0][1].includes(code) && sms[0][2] === "otp");
  assert.ok(!/₹|address|MG Road/.test(sms[0][1]));
  out = await otp.sendCompletionOtpSms(deps, "order_ABC123", { bookingType: "move", phone: "+91 98450 12345", bookingRef: "PZ10" });
  assert.ok(out.sent && sms[1][0] === "9845012345" && sms[1][2] === "otp" && /completion code/.test(sms[1][1]));
  out = await otp.sendCompletionOtpSms(deps, "order_ABC123", { bookingType: "move", phone: "123" });
  assert.ok(!out.sent);
  ok("completion code by SMS (kind otp): customer for moves/services, receiver for old parcels; no price/address in the text");

  const notif = fs.readFileSync(path.join(__dirname, "..", "notifications.js"), "utf8");
  assert.ok(/after\.status === "transit"\) \{\s*try \{\s*await completionOtp\.sendCompletionOtpSms\(/.test(notif));
  const co = fs.readFileSync(path.join(__dirname, "..", "completion-otp.js"), "utf8");
  assert.ok(/sendCompletionOtpSms\(deps, bookingId, b\)/.test(co));
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(/if \(data\.kind !== "otp"\) \{\s*await docRef\.update\(\{ status: "skipped", reason: "sms_otp_only_policy"/.test(idx));
  ok("wiring: completion code SMS at transit and on driver 'resend'; every non-OTP SMS is skipped (OTP-only policy)");

  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  assert.ok(/request\.resource\.data\.get\('status', 'pending'\) == 'pending'/.test(rules));
  const js = fs.readFileSync(path.join(__dirname, "..", "..", "public", "script.js"), "utf8");
  assert.ok(/status: "pending", date:/.test(js) && !/status: "approved", date:/.test(js) && /status === "approved"/.test(js));
  assert.ok(/pzEstPill/.test(js) && /calculateQuote\(true\)/.test(js));
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "public", "index.html"), "utf8");
  assert.ok(/id="reviewsGrid"/.test(html) && /id="pzEstPill"/.test(html));
  ok("reviews: customers can't self-publish; homepage shows only approved ones; live estimate pill in the booking header");

  console.log(`\nphase45: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
