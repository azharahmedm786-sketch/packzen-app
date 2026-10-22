/**
 * Lead Quality Engine + PackZen Leads app: scoring, junk filter, nurture, wiring.
 *   node test/lead-quality.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const { _quality: Q } = require("../lead-quality.js");
const { _leads: L } = require("../leads.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const now = Date.parse("2026-10-20T06:00:00Z");
const day = (n) => new Date(now + n * 86400e3 + 5.5 * 3600e3).toISOString().slice(0, 10);

let r = Q.scoreLead({ name: "Asha", phone: "9845012345", area: "HSR Layout 560102", when: "this_week", service: "move", homeSize: "2bhk", source: "website-callback", channel: "google_ads" }, now);
assert.strictEqual(r.tier, "hot"); assert.ok(r.score >= 80, r.score);
r = Q.scoreLead({ name: "Ravi", phone: "9845012345", area: "Koramangala", date: day(20), service: "ac", source: "website-callback" }, now);
assert.strictEqual(r.tier, "warm");
r = Q.scoreLead({ name: "Kiran", phone: "9845012345", when: "just_checking", service: "other" }, now);
assert.strictEqual(r.tier, "cold");
r = Q.scoreLead({ name: "Meera", phone: "9845012345", area: "Mysuru 570001", when: "this_week", service: "move" }, now);
assert.ok(r.tier !== "hot" && r.reasons.some((x) => /outside/.test(x)));
ok("scoring: verified intent + area + timing + size → hot; later/AC → warm; 'just checking' → cold; outside Bangalore never hot");

for (const bad of [{ name: "test", phone: "9845012345" }, { name: "Raj", phone: "9999999999" }, { name: "Raj", phone: "9845012345", notes: "need driver job, salary?" }])
  assert.strictEqual(Q.scoreLead(bad, now).tier, "junk", JSON.stringify(bad));
assert.strictEqual(Q.scoreLead({ name: "Raj", phone: "9845012345", tierManual: "junk" }, now).tier, "junk");
ok("junk filter: test names, fake numbers, job seekers, and leads you mark as junk");

assert.ok(Q.scoreLead({ name: "A", phone: "9845012345", phoneVerified: true }, now).reasons.some((x) => /verified/.test(x)));
const a = { name: "Asha", phone: "9845012345", service: "move", touches: [] }, b = Object.assign({}, a, { touches: [1, 2] });
assert.notStrictEqual(Q.inputsKey(a), Q.inputsKey(b));
assert.strictEqual(Q.inputsKey(a), Q.inputsKey(Object.assign({}, a, { status: "contacted", notes: undefined })));
ok("re-scoring only when score inputs change (status updates and our own writes don't loop)");

const base = { tier: "warm", status: "new", consent: true, phone: "9845012345", name: "Asha K", service: "move", serviceLabel: "House / office shifting" };
const plan = Q.nurturePlan([
  Object.assign({ id: 1, createdAtMs: now - 1.5 * 86400e3 }, base),
  Object.assign({ id: 2, createdAtMs: now - 4 * 86400e3 }, base),
  Object.assign({ id: 3, createdAtMs: now - 4 * 86400e3, nurtureSent: ["d3"] }, base),
  Object.assign({ id: 4, createdAtMs: now - 1.5 * 86400e3 }, base, { tier: "cold" }),
  Object.assign({ id: 5, createdAtMs: now - 1.5 * 86400e3 }, base, { status: "booked" }),
  Object.assign({ id: 6, createdAtMs: now - 1.5 * 86400e3 }, base, { consent: false }),
], now);
assert.deepStrictEqual(plan.map((p) => [p.lead.id, p.step]), [[1, "d1"], [2, "d3"]]);
assert.ok(/Asha/.test(Q.nurtureText(base, "d1")) && /FIRSTMOVE/.test(Q.nurtureText(base, "d3")));
ok("nurture: warm + consented + still open only; day-1 and day-3 messages once each");

const v = L.validateLead({ name: "Asha", phone: "9845012345", service: "move", when: "this_week", homeSize: "2bhk" }).value;
assert.ok(v.when === "this_week" && v.homeSize === "2bhk" && v.consent === true);
assert.strictEqual(L.validateLead({ name: "Asha", phone: "9845012345", when: "hack" }).value.when, "");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
assert.ok(/name="when"/.test(pub("pz-leads.js")) && /name="homeSize"/.test(pub("pz-leads.js")));
const app = pub("leads-app/app.js"), html = pub("leads-app/index.html");
assert.ok(/\["admin", "manager", "advisor"\]/.test(app) && /orderBy\("createdAtMs", "desc"\)/.test(app) && /beep\(\)/.test(app) && /renderReport/.test(app));
assert.ok(/manifest\.json/.test(html) && /noindex/.test(html) && /Disallow: \/leads-app\//.test(pub("robots.txt")));
ok("website asks 'when' and home size; separate admin-only PackZen Leads app (installable, not indexed)");

console.log(`\nlead-quality: ${pass} passed, 0 failed`);
