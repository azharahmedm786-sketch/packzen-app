/**
 * Growth pack: referral rewards, post-move follow-up, personal codes, referral rules,
 * new area pages, analytics + WhatsApp booking wiring.
 *   node test/growth.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const { _growth: G } = require("../growth.js");
const promo = require("../promo.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const ts = (ms) => ({ toMillis: () => ms, getTime: () => ms });

function fakeDb(data) {
  const ref = (c, id) => ({ id, _c: c, get: async () => ({ exists: id in (data[c] || {}), data: () => data[c][id] }),
    update: async (u) => apply(data[c][id], u), set: async (d) => { (data[c] = data[c] || {})[id] = d; } });
  function apply(doc, u) { for (const k in u) { const v = u[k]; if (v && v.__inc) doc[k] = (doc[k] || 0) + v.__inc; else doc[k] = v; } }
  const query = (c, f) => ({ where: (k, op, v) => query(c, f.concat([[k, op, v]])),
    limit: () => ({ get: async () => { const docs = Object.entries(data[c] || {}).filter(([, d]) => f.every(([k, op, v]) => {
      const x = d[k] && d[k].getTime ? d[k].getTime() : d[k]; const y = v instanceof Date ? v.getTime() : v;
      return op === "==" ? x === y : op === ">=" ? x >= y : x <= y; })).map(([id, d]) => ({ id, data: () => d, ref: ref(c, id) }));
      return { empty: !docs.length, docs }; } }) });
  return { collection: (c) => Object.assign(query(c, []), { doc: (id) => ref(c, id) }),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), update: (r, u) => apply(data[r._c][r.id], u), set: (r, d) => { (data[r._c] = data[r._c] || {})[r.id] = d; } }) };
}

(async () => {
  const data = { users: { ref1: { referralCode: "ASHA2026", phone: "9876543210", referralCount: 0, referralCredits: 0 }, friend: { referralCode: "KIRAN01" } },
    bookings: { b1: { customerUid: "friend", promoCode: "ASHA2026", status: "delivered", bookingRef: "PZ1" } }, promos: {} };
  const db = fakeDb(data); const sms = [];
  const deps = { db, now: () => Date.parse("2026-10-20T06:00:00Z"), rand: () => 0.1, serverTimestamp: () => "TS", increment: (n) => ({ __inc: n }), queueSms: async (m, t) => sms.push([m, t]) };
  const r = await G.rewardReferrer(deps, db.collection("bookings").doc("b1"), { status: "transit" }, data.bookings.b1);
  assert.ok(r.rewarded && /^RWD-[A-Z2-9]{6}$/.test(r.rewarded));
  const p = data.promos[r.rewarded];
  assert.ok(p.ownerUid === "ref1" && p.value === 200 && p.max === 1 && p.active);
  assert.strictEqual(data.users.ref1.referralCount, 1); assert.strictEqual(data.users.ref1.referralCredits, 200);
  assert.ok(sms[0][0] === "9876543210" && sms[0][1].includes(r.rewarded));
  const again = await G.rewardReferrer(deps, db.collection("bookings").doc("b1"), { status: "transit" }, data.bookings.b1);
  assert.ok(again.skipped); assert.strictEqual(Object.keys(data.promos).length, 1);
  data.promos.FIRSTMOVE = { active: true }; data.bookings.b2 = { customerUid: "x", promoCode: "FIRSTMOVE", status: "delivered" };
  assert.strictEqual((await G.rewardReferrer(deps, db.collection("bookings").doc("b2"), { status: "transit" }, data.bookings.b2)).skipped, "promo_not_referral");
  ok("referral: completed friend's booking → referrer gets a personal ₹200 code by SMS, once; normal promo codes ignored");

  const now = deps.now();
  data.bookings.m1 = { status: "delivered", deliveredAt: ts(now - 3.5 * 86400e3), phone: "9000000001", customerName: "Ravi K", bookingRef: "PZ7" };
  data.bookings.m2 = { status: "delivered", deliveredAt: ts(now - 3.5 * 86400e3), phone: "9000000002", bookingType: "parcel" };
  data.bookings.m3 = { status: "delivered", deliveredAt: ts(now - 1 * 86400e3), phone: "9000000003" };
  sms.length = 0;
  const f = await G.followUps(deps);
  assert.strictEqual(f.sent, 1); assert.ok(sms[0][0] === "9000000001" && /Ravi/.test(sms[0][1]) && /services/.test(sms[0][1]));
  assert.strictEqual((await G.followUps(deps)).sent, 0);
  ok("post-move follow-up: one SMS 3 days after a completed move (not parcels, not twice)");

  const pdb = (promoDoc, bookings, users) => ({ collection: (c) => ({
    doc: () => ({ get: async () => ({ exists: c === "promos" && !!promoDoc, data: () => promoDoc }) }),
    where: () => ({ limit: () => ({ get: async () => { const docs = (c === "bookings" ? bookings : users || []).map((d) => ({ id: d.id, data: () => d })); return { empty: !docs.length, docs }; } }) }) }) });
  await assert.rejects(promo.resolvePromo("RWD-ABC123", 5000, { db: pdb({ active: true, type: "flat", value: 200, ownerUid: "ref1" }, []), now: () => 0, uid: "other" }), /another PackZen account/);
  assert.strictEqual((await promo.resolvePromo("RWD-ABC123", 5000, { db: pdb({ active: true, type: "flat", value: 200, ownerUid: "ref1" }, []), now: () => 0, uid: "ref1" })).amount, 200);
  assert.strictEqual((await promo.resolvePromo("ASHA2026", 5000, { db: pdb(null, [], [{ id: "ref1" }]), now: () => 0, uid: "friend" })).amount, 200);
  await assert.rejects(promo.resolvePromo("ASHA2026", 5000, { db: pdb(null, [{ status: "delivered" }], [{ id: "ref1" }]), now: () => 0, uid: "friend" }), /first PackZen booking/);
  ok("codes: reward codes only for their owner; a friend's referral code gives ₹200 on their first booking only");

  const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
  for (const s of ["hebbal", "yelahanka", "btm-layout", "jp-nagar", "jayanagar", "banashankari", "rajajinagar", "malleshwaram", "kr-puram", "hennur"]) {
    const h = pub(`packers-and-movers-${s}.html`);
    assert.ok(/pz-premium\.css/.test(h) && /pz-leads\.js/.test(h) && !/{{/.test(h) && /"@type": "FAQPage"/.test(h), s);
    assert.ok(pub("sitemap.xml").includes(`packers-and-movers-${s}.html`) && pub("packers-and-movers-bangalore-areas.html").includes(`packers-and-movers-${s}.html`), s);
  }
  ok("10 new area pages: generated from the template, premium look, FAQ schema, in sitemap and area hub");

  const leads = pub("pz-leads.js");
  assert.ok(/G-9JXKP58GP3/.test(leads) && /window\.pzTrack = function/.test(leads) && /wa\.me\/919945095453/.test(leads) && /pz_ref/.test(leads));
  assert.ok(/pzTrack\("purchase"/.test(pub("script.js")) && /pzTrack\("purchase"/.test(pub("parcel-booking.js")) && /pzTrack\("purchase"/.test(pub("catalog-booking.js")));
  assert.ok(!/₹500 off, you get ₹500/.test(pub("index.html")) && /shareReferralWhatsApp/.test(pub("index.html")));
  ok("analytics on every page (leads, picker, price shown, purchases); WhatsApp booking; referral link + WhatsApp share; ₹500 claim corrected");

  console.log(`\ngrowth: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
