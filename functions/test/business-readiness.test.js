/** Business readiness: partner agreement, stock, readiness panel, briefing, weekly report, after-hours.
 *  node test/business-readiness.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
const T = require("../team.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

const reg = pub("partner-register.html"), rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
assert.ok(/id="pzAgree"/.test(reg) && /href="partner-agreement\.html"/.test(reg) && /if \(agree && !agree\.checked\)/.test(reg) && /agreementAccepted:  true/.test(reg) && /agreementVersion:   '2026-10'/.test(reg));
assert.ok(/request\.resource\.data\.agreementAccepted == true/.test(rules));
const ag = pub("partner-agreement.html");
for (const h of ["Payouts", "Completing a job", "Care, damage and claims", "Customer data", "Ending the partnership"]) assert.ok(ag.includes(h), h);
assert.ok(/90%/.test(ag) && /canonical" href="https:\/\/packzenblr\.in\/partner-agreement\.html"/.test(ag));
ok("partner agreement page; sign-up requires acceptance (checkbox + database rule), version and date recorded");

assert.ok(/match \/settings\/inventory \{/.test(rules) && /hasOnly\(\['items', 'updatedAt', 'updatedBy'\]\)/.test(rules));
const adm = pub("admin.html");
assert.ok(/id="readinessCard"/.test(adm) && /function loadReadiness\(\)/.test(adm) && /function saveStock\(\)/.test(adm) && /active moving crew/.test(adm));
ok("admin: Business readiness panel (crews, technicians, waiting leads, FIRSTMOVE) and packing-stock tracking");

assert.deepStrictEqual(T.lowStock({ boxes: 10, tape: 20, bubble: 5, stretch: 4, blankets: 2 }), ["boxes (10)", "blankets (2)"]);
const now = Date.parse("2026-10-30T02:30:00Z");
const br = T.buildBriefing({ bookings: [], leads: [], opportunities: [], prospects: [], crews: 1, stock: { boxes: 5 } }, now);
const row = (k) => br.rows.find((r) => r[0] === k)[1];
assert.ok(/⚠️ 1/.test(row("Active moving crews")) && /Low: boxes \(5\)/.test(row("Packing stock")));
ok("morning briefing warns about too few crews and low packing stock");

const day = 86400e3, ts = (ms) => ({ toMillis: () => ms });
const w = T.buildWeekly({ bookings: [
  { createdAt: ts(now - day), total: 6500, paid: 650, status: "confirmed" },
  { createdAt: ts(now - 2 * day), total: 449, paid: 449, status: "delivered", completedAt: ts(now - day) },
  { createdAt: ts(now - 3 * day), total: 4000, status: "cancelled" },
  { createdAt: ts(now - 20 * day), total: 9999, status: "confirmed" } ],
  leads: [{ createdAtMs: now - day, channel: "gbp", tier: "hot", status: "booked" }, { createdAtMs: now - day, channel: "gbp", tier: "warm" }, { createdAtMs: now - day, tier: "junk" }] }, now);
const wr = (k) => w.rows.find((r) => r[0] === k)[1];
assert.ok(/^2 \(₹6,949/.test(wr("New bookings")) && wr("Paid online") === "₹1,099" && /^1 /.test(wr("Jobs completed")) && wr("Cancelled") === "1");
assert.ok(/^2 · converted 1/.test(wr("Real leads")) && /gbp: 2 leads, 1 hot, 1 booked/.test(wr("Leads by source")) && /gbp/.test(wr("Do more of")));
assert.ok(/exports\.weeklyReport = functions[\s\S]{0,140}schedule\("0 18 \* \* 5"\)/.test(fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8")));
ok("weekly report (Fridays 6 PM): bookings, paid online, completed, cancelled, real leads by source, best source");

assert.ok(/We're closed right now \(we work 8 AM – 9 PM\)/.test(pub("pz-leads.js")) && /after 8 AM/.test(pub("pz-leads.js")));
ok("callback form is honest after hours (we'll call after 8 AM)");
console.log(`\nbusiness-readiness: ${pass} passed, 0 failed`);
