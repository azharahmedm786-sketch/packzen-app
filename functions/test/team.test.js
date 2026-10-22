/** Team (staff logins) + morning briefing.  node test/team.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const T = require("../team.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

(async () => {
  const users = { owner: { role: "admin" }, drv1234567890: { role: "driver", email: "d@x.in" } };
  const authUsers = { "d@x.in": { uid: "drv1234567890" } }; let n = 0; const authCalls = [];
  const db = { collection: () => ({
    doc: (id) => ({ get: async () => ({ exists: !!users[id], data: () => users[id] }), set: async (d) => { users[id] = Object.assign(users[id] || {}, d); }, update: async (d) => { Object.assign(users[id], d); } }),
    where: (f, op, v) => ({ limit: () => ({ get: async () => ({ docs: Object.entries(users).filter(([, u]) => v.includes(u.role)).map(([id, u]) => ({ id, data: () => u })) }) }) }) }) };
  const auth = { getUserByEmail: async (e) => { if (authUsers[e]) return authUsers[e]; throw new Error("not found"); },
    createUser: async (o) => { const uid = "staffuid" + String(++n).padStart(6, "0"); authUsers[o.email] = { uid }; authCalls.push(["create", o.email]); return { uid }; },
    generatePasswordResetLink: async (e) => "https://packzen.firebaseapp.com/__/auth/action?mode=resetPassword&e=" + e,
    updateUser: async (uid, o) => authCalls.push(["update", uid, o.disabled]), revokeRefreshTokens: async (uid) => authCalls.push(["revoke", uid]) };
  const deps = (adm) => ({ db, auth, isAdmin: async () => adm, now: () => 0, serverTimestamp: () => "TS" });
  const ctx = { auth: { uid: "owner" } };
  await assert.rejects(T.handleStaff({ op: "list" }, ctx, deps(false)), /Only the owner/);
  const r = await T.handleStaff({ op: "create", name: "Priya S", email: "Priya@Example.com", phone: "+91 98450 12345", role: "advisor" }, ctx, deps(true));
  assert.ok(r.setPasswordLink && users[r.uid].role === "advisor" && users[r.uid].email === "priya@example.com" && users[r.uid].phone === "9845012345");
  await assert.rejects(T.handleStaff({ op: "create", name: "X Y", email: "d@x.in", role: "manager" }, ctx, deps(true)), /driver account/);
  await assert.rejects(T.handleStaff({ op: "create", name: "X Y", email: "x@y.in", role: "admin" }, ctx, deps(true)), /Choose a role/);
  await T.handleStaff({ op: "setRole", uid: r.uid, role: "manager" }, ctx, deps(true)); assert.strictEqual(users[r.uid].role, "manager");
  await T.handleStaff({ op: "disable", uid: r.uid }, ctx, deps(true));
  assert.ok(users[r.uid].role === "staff_disabled" && authCalls.some((c) => c[0] === "revoke"));
  await T.handleStaff({ op: "enable", uid: r.uid }, ctx, deps(true)); assert.strictEqual(users[r.uid].role, "manager");
  await assert.rejects(T.handleStaff({ op: "disable", uid: "drv1234567890" }, ctx, deps(true)), /Not a team member/);
  const list = await T.handleStaff({ op: "list" }, ctx, deps(true)); assert.strictEqual(list.staff.length, 1);
  ok("team: owner-only; create staff (sales/support or operations) with a one-time set-password link; change role, remove and restore access; can't make admins or touch driver accounts");

  const now = Date.parse("2026-10-22T02:30:00Z"), today = T.istDay(now), tomorrow = T.istDay(now, 1), yday = T.istDay(now, -1);
  const b = T.buildBriefing({
    bookings: [{ date: today, status: "confirmed", balanceDue: 5000 }, { date: today, status: "assigned", driverUid: "d", bookingType: "parcel", balanceDue: 0 }, { date: tomorrow, status: "confirmed" }, { date: today, status: "cancelled" }, { date: today, status: "confirmed", createdDay: yday, total: 7000, driverUid: "d" }],
    leads: [{ tier: "hot", status: "new", name: "Asha", createdAtMs: now - 3600e3 }, { tier: "warm", status: "contacted", followUpAt: now }, { tier: "junk", status: "new", createdAtMs: now - 3600e3 }],
    opportunities: [{ status: "new" }], prospects: [{ status: "to_contact" }, { status: "to_contact" }] }, now);
  const row = (k) => b.rows.find((r) => r[0] === k)[1];
  assert.ok(/^3/.test(row("Jobs today")) && /1/.test(row("Unassigned today")) && row("Unassigned tomorrow") === "1" && row("Balance to collect today") === "₹5,000");
  assert.ok(/Asha/.test(row("🔥 Hot leads open")) && /1/.test(row("Leads waiting > 30 min")) && row("Follow-ups due") === "1" && row("Partners to contact") === "2");
  assert.ok(/Assign today's jobs first/.test(row("Today's focus")));
  ok("morning briefing: today's jobs, unassigned, money to collect, yesterday's bookings, hot/waiting leads, follow-ups, opportunities, partners + today's focus");

  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  assert.ok(/match \/leads\/\{leadId\} \{\s*allow create: if false;\s*allow read, update: if isAdmin\(\) \|\| isAdvisor\(\);/.test(rules));
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "public", "leads-app", "app.js"), "utf8");
  assert.ok(/\["admin", "manager", "advisor"\]/.test(app) && /id="sectionTeam"/.test(fs.readFileSync(path.join(__dirname, "..", "..", "public", "admin.html"), "utf8")));
  const lq = fs.readFileSync(path.join(__dirname, "..", "lead-quality.js"), "utf8"), ld = fs.readFileSync(path.join(__dirname, "..", "leads.js"), "utf8");
  assert.ok(/onLeadScore = functions\.region\(REGION\)\.runWith\(\{ secrets/.test(lq) && /leadSlaSweep = functions\.region\(REGION\)\.runWith\(\{ secrets/.test(ld));
  ok("staff can use the Leads app (rules + app); HOT-lead and waiting-lead emails now have the Brevo key mounted");

  console.log(`\nteam: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
