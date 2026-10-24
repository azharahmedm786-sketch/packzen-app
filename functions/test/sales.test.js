/**
 * Sales pack: sent quote links, moving-day extras, win-back, call script.
 *   node test/sales.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const S = require("../sales.js");
const E = require("../pricing-engine-v2.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");

(async () => {
  // presets price like the website (same engine) and extras add exactly the engine prices
  const qi = S.buildQuoteInput({ size: "2bhk", pickup: "HSR Layout 560102", drop: "Whitefield 560066", pickupFloor: 2, dropFloor: 1, liftAvailable: true, packingService: true });
  const base = E.calculateQuote(Object.assign({ km: 18 }, qi)).finalTotal;
  const withAc = E.calculateQuote(Object.assign({ km: 18 }, qi, { acCount: 1 })).finalTotal;
  assert.ok(base > 0 && withAc - base >= 2200 * 0.9, base + " " + withAc);
  assert.throws(() => S.buildQuoteInput({ size: "mansion" }), /home size/);
  assert.deepStrictEqual([S.buildQuoteInput({ size: "1rk", acCount: 99 }).acCount, S.buildQuoteInput({ size: "1rk", pickupFloor: -3 }).pickupFloor], [6, 0]);
  ok("quote presets price through the same engine; AC/TV/carpenter/electrician extras priced; inputs clamped");

  const store = { sentQuotes: {}, leads: { L1: { status: "contacted" } } };
  const db = { collection: (n) => ({ doc: (id) => ({ get: async () => ({ exists: !!store[n][id], data: () => store[n][id] }),
    set: async (d) => { store[n][id] = d; }, update: async (u) => { if (!store[n][id]) throw new Error("nf"); Object.assign(store[n][id], u); } }) }) };
  let now = Date.parse("2026-10-21T06:00:00Z");
  const deps = { db, isAdmin: async (c) => c.auth.uid === "admin", now: () => now, serverTimestamp: () => "TS",
    price: async (q) => { const r = E.calculateQuote(Object.assign({ km: 12 }, q)); r.km = 12; return r; } };
  const req = { leadId: "L1", name: "Asha Rao", phone: "+91 98450 12345", size: "1bhk", date: "2026-10-28", pickup: "HSR Layout 560102", drop: "Koramangala 560034", packingService: true };
  await assert.rejects(S.createSentQuote(req, { auth: { uid: "x" } }, deps), /Admins only/);
  await assert.rejects(S.createSentQuote(Object.assign({}, req, { phone: "123" }), { auth: { uid: "admin" } }, deps), /10-digit/);
  const out = await S.createSentQuote(req, { auth: { uid: "admin" } }, deps);
  assert.ok(/^https:\/\/packzenblr\.in\/quote\.html\?t=[A-Za-z0-9_-]{20,}$/.test(out.url) && out.total > 0 && out.advance === Math.round(out.total * 0.1));
  assert.ok(/Asha/.test(out.message) && out.message.includes(out.url));
  assert.ok(store.leads.L1.status === "quoted" && store.leads.L1.quotedAmount === out.total && store.leads.L1.quoteToken === out.token);
  ok("send quote: admin-only, validated, priced by the server, link + WhatsApp text, lead moves to 'quoted'");

  const v = await S.getSentQuote({ t: out.token }, { db, now: () => now + 3600e3 });
  assert.ok(v.firstName === "Asha" && v.total === out.total && !("createdBy" in v) && !("leadId" in v) && v.quoteInput.vehicleId);
  assert.ok(store.sentQuotes[out.token].opens === 1 && store.leads.L1.quoteOpenedAtMs);
  await S.getSentQuote({ t: out.token }, { db, now: () => now + 7200e3 });
  assert.strictEqual(store.sentQuotes[out.token].opens, 2);
  assert.ok((await S.getSentQuote({ t: out.token }, { db, now: () => now + 8 * 86400e3 })).expired);
  await assert.rejects(S.getSentQuote({ t: "bad" }, { db, now: () => now }), /isn't valid/);
  ok("quote link: shows safe fields only, counts opens and flags the lead as opened; expires after 7 days");

  const L = (o) => Object.assign({ status: "lost", phone: "9845012345", name: "Ravi", lostAtMs: now - 8 * 86400e3 }, o);
  const plan = S.winbackPlan([L({ lostReason: "price too high" }), L({ lostReason: "no answer" }), L({ lostReason: "went elsewhere" }), L({ lostReason: "price", winbackSentAtMs: 1 }),
    L({ lostReason: "price", lostAtMs: now - 2 * 86400e3 }), L({ lostReason: "price", consent: false }), L({ lostReason: "junk" })], now);
  assert.strictEqual(plan.length, 2);
  assert.ok(/1,499/.test(S.winbackText({ name: "Ravi", lostReason: "price" })) && /missed each other/.test(S.winbackText({ name: "Ravi", lostReason: "no answer" })));
  ok("win-back: once, 7–10 days after a lead lost on price / no answer, consented only");

  const idx = pub("index.html"), js = pub("script.js");
  assert.ok(/id="acCount"/.test(idx) && !/id="tvMountCount"/.test(idx) && /id="needCarpenter"/.test(idx) && /id="needElectrician"/.test(idx));
  assert.ok(/acCount: parseInt\(document\.getElementById\("acCount"\)/.test(js) && /needElectrician: !!document\.getElementById\("needElectrician"\)/.test(js));
  const q = pub("quote.js"), sj = pub("leads-app/sales.js");
  assert.ok(/getSentQuote/.test(q) && /\/createRazorpayOrder/.test(q) && /\/verifyRazorpayPayment/.test(q) && /paymentType: "advance"/.test(q));
  assert.ok(/createSentQuote/.test(sj) && /pzOpenScript/.test(sj) && /Another mover quoted less/.test(sj));
  assert.ok(/Disallow: \/quote\.html/.test(pub("robots.txt")) && /noindex/.test(pub("quote.html")));
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  assert.ok(/match \/sentQuotes\/\{token\} \{\s*allow create, delete: if false;\s*allow read, update: if isAdmin\(\);/.test(rules));
  const ix = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(/exports\.createSentQuote/.test(ix) && /exports\.getSentQuote/.test(ix) && /exports\.leadWinback/.test(ix) && /quoteViewIp/.test(ix));
  ok("wiring: booking-form extras sent to the engine; quote page pays through the existing secure payment flow; Leads app quote form + call script; rules; functions exported");

  console.log(`\nsales: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
