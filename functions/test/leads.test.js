/**
 * Lead engine: validation, source detection, de-duplication, booking linking, wiring.
 *   node test/leads.test.js
 */
"use strict";
process.env.GCLOUD_PROJECT = "packzen-e7539";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const { _leads: L } = require("../leads.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

(async () => {
  let v = L.validateLead({ name: "Asha", phone: "+91 98765 43210", service: "ac", area: "HSR Layout 560102", date: "2026-11-02", notes: "2 split ACs" });
  assert.ok(v.ok); assert.strictEqual(v.value.phone, "9876543210"); assert.strictEqual(v.value.serviceLabel, "AC service & repair");
  assert.strictEqual(v.value.inServiceArea, true); assert.strictEqual(v.value.pincode, "560102");
  assert.strictEqual(L.validateLead({ name: "R", phone: "12345" }).errors.length, 2);
  assert.strictEqual(L.validateLead({ name: "Ravi", phone: "9123456780", service: "hack" }).value.service, "other");
  assert.strictEqual(L.validateLead({ name: "Ravi", phone: "9123456780", area: "Mysuru 570001" }).value.inServiceArea, false);
  assert.strictEqual(L.validateLead({ name: "Ravi", phone: "09123456780" }).value.phone, "9123456780");
  ok("validation: phone normalised (+91/0 prefix), unknown service → other, service-area tagged, bad input refused");

  assert.strictEqual(L.channelOf({ gclid: "x" }), "google_ads");
  assert.strictEqual(L.channelOf({ utm_source: "google", utm_medium: "cpc" }), "google_ads");
  assert.strictEqual(L.channelOf({ utm_source: "instagram" }), "social");
  assert.strictEqual(L.channelOf({ referrer: "https://www.google.com/" }), "organic_search");
  assert.strictEqual(L.channelOf({ referrer: "https://www.justdial.com/x" }), "directory");
  assert.strictEqual(L.channelOf({ utm_source: "packzen_referral" }), "referral");
  assert.strictEqual(L.channelOf({}), "direct");
  ok("source detection: Google Ads, organic search, social, directories, referral, direct");
  const a = L.cleanAttribution({ utm_source: "google", evil: "x", referrer: "y".repeat(500) });
  assert.ok(!("evil" in a) && a.referrer.length === 300); ok("attribution: only known keys kept, length-capped");

  // fake Firestore for upsert
  const store = {}; let n = 0;
  const db = { collection: () => ({
    where: (f, op, val) => ({ limit: () => ({ get: async () => ({ docs: Object.entries(store).filter(([, d]) => d[f] === val).map(([id, d]) => ({ id, data: () => d, ref: { update: async (u) => { for (const k in u) { if (u[k] && u[k].__union) d[k] = (d[k] || []).concat(u[k].__union); else d[k] = u[k]; } } } })) }) }) }),
    doc: () => { const id = "L" + (++n); return { id, set: async (d) => { store[id] = d; } }; } }) };
  let now = Date.parse("2026-10-20T05:00:00Z");
  const deps = { db, now: () => now, serverTimestamp: () => "TS", arrayUnion: (x) => ({ __union: [x] }) };
  const val = L.validateLead({ name: "Asha", phone: "9876543210", service: "move", area: "Koramangala", notes: "2BHK" }).value;
  const r1 = await L.upsertLead(deps, val, { source: "website-callback", attribution: { utm_source: "google", utm_medium: "cpc" } });
  assert.ok(!r1.merged); assert.strictEqual(store[r1.id].status, "new"); assert.strictEqual(store[r1.id].channel, "google_ads");
  now += 3600e3;
  const r2 = await L.upsertLead(deps, Object.assign({}, val, { notes: "needs packing" }), { source: "website-callback" });
  assert.ok(r2.merged && r2.id === r1.id); assert.strictEqual(store[r1.id].touches.length, 2); assert.ok(/needs packing/.test(store[r1.id].notes));
  const r3 = await L.upsertLead(deps, Object.assign({}, val, { service: "ac", serviceLabel: "AC" }), { source: "website-callback" });
  assert.ok(!r3.merged);
  now += 25 * 3600e3;
  const r4 = await L.upsertLead(deps, val, { source: "website-callback" });
  assert.ok(!r4.merged);
  ok("de-duplication: same phone + service within 24 h merges (note appended); other service or >24 h is a new lead");

  const t = Date.now();
  const pick = L.pickLeadForBooking([{ status: "lost", createdAtMs: t }, { status: "contacted", createdAtMs: t - 86400e3 }, { status: "new", createdAtMs: t - 3600e3 }, { status: "new", createdAtMs: t - 40 * 86400e3 }], t);
  assert.strictEqual(pick.createdAtMs, t - 3600e3);
  assert.strictEqual(L.pickLeadForBooking([{ status: "booked", createdAtMs: t }], t), null);
  ok("booking link: newest open lead in the last 30 days (lost/booked/old ignored)");

  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(/require\("\.\/leads"\)/.test(idx));
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  assert.ok(/match \/leads\/\{leadId\} \{\s*allow create: if false;/.test(rules));
  const af = fs.readFileSync(path.join(__dirname, "..", "assistant-functions.js"), "utf8");
  assert.ok(/channel: "assistant"/.test(af) && /createdAtMs: nowMs/.test(af));
  const js = fs.readFileSync(path.join(__dirname, "..", "..", "public", "pz-leads.js"), "utf8");
  assert.ok(/submitLead/.test(js) && /name="website"/.test(js) && /pzAttribution/.test(js));
  const adm = fs.readFileSync(path.join(__dirname, "..", "..", "public", "admin.html"), "utf8");
  assert.ok(/id="sectionLeads"/.test(adm) && /function setLeadStatus/.test(adm));
  ok("wiring: functions exported, browsers can't write leads, assistant leads share the shape, widget + admin pipeline present");

  console.log(`\nleads: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
