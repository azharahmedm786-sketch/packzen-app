/**
 * PackZen — team (staff logins) + the morning briefing "AI employee".
 *
 * Staff roles (stored on users/{uid}.role, checked by Firestore rules via isAdvisor()):
 *   manager  — Operations: advisor dashboard (bookings, assignments) + PackZen Leads app
 *   advisor  — Sales & support: advisor dashboard + PackZen Leads app
 * Full admin stays limited to the owner emails in firestore.rules (isAdmin) on purpose.
 *
 * adminManageStaff (admin-only callable): list | create | setRole | disable | enable | resetLink
 *   create makes the Firebase Auth account (or reuses an existing one for that email),
 *   sets the role and returns a one-time "set your password" link to share with them.
 * morningBriefing (daily 08:00 IST): one email with today's jobs, unassigned jobs, money
 *   due, hot leads waiting, follow-ups due, new opportunities and partners to contact.
 */
"use strict";
const STAFF_ROLES = { manager: "Operations manager", advisor: "Sales & support" };
class TeamError extends Error { constructor(code, msg) { super(msg); this.code = code; this.publicMessage = msg; } }

const cleanName = (s) => String(s || "").replace(/[<>]/g, "").trim().slice(0, 80);
const cleanEmail = (s) => String(s || "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** deps: { db, auth, isAdmin(ctx), now, serverTimestamp } */
async function handleStaff(data, context, deps) {
  if (!context || !context.auth) throw new TeamError("unauthenticated", "Please sign in.");
  if (!(await deps.isAdmin(context))) throw new TeamError("permission-denied", "Only the owner can manage the team.");
  const op = data && data.op;

  if (op === "list") {
    const snap = await deps.db.collection("users").where("role", "in", Object.keys(STAFF_ROLES).concat(["staff_disabled"])).limit(100).get();
    return { staff: snap.docs.map((d) => { const u = d.data() || {}; return { uid: d.id, name: u.name || "", email: u.email || "", phone: u.phone || "", role: u.role, roleLabel: STAFF_ROLES[u.role] || "Disabled", disabled: u.role === "staff_disabled" }; }) };
  }

  if (op === "create") {
    const name = cleanName(data.name), email = cleanEmail(data.email), role = data.role;
    const phone = String(data.phone || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (name.length < 2) throw new TeamError("invalid-argument", "Enter the employee's name.");
    if (!EMAIL_RE.test(email)) throw new TeamError("invalid-argument", "Enter a valid email address.");
    if (!STAFF_ROLES[role]) throw new TeamError("invalid-argument", "Choose a role.");
    if (phone && !/^[6-9]\d{9}$/.test(phone)) throw new TeamError("invalid-argument", "Enter a valid 10-digit mobile number.");
    let user;
    try { user = await deps.auth.getUserByEmail(email); } catch (e) { user = null; }
    if (user) {
      const ex = await deps.db.collection("users").doc(user.uid).get();
      const r = ex.exists ? (ex.data() || {}).role : null;
      if (r === "admin" || r === "driver") throw new TeamError("failed-precondition", `This email already belongs to a ${r} account.`);
    } else {
      user = await deps.auth.createUser({ email, displayName: name, password: require("crypto").randomBytes(18).toString("base64url"), disabled: false });
    }
    await deps.db.collection("users").doc(user.uid).set({ name, email, phone: phone || null, role, staff: true, staffSince: deps.now(), updatedAt: deps.serverTimestamp() }, { merge: true });
    const link = await deps.auth.generatePasswordResetLink(email);
    return { ok: true, uid: user.uid, role, setPasswordLink: link };
  }

  const uid = data && data.uid;
  if (typeof uid !== "string" || !/^[A-Za-z0-9]{10,128}$/.test(uid)) throw new TeamError("invalid-argument", "Invalid team member.");
  const ref = deps.db.collection("users").doc(uid);
  const doc = await ref.get();
  const cur = doc.exists ? (doc.data() || {}) : null;
  if (!cur || !(STAFF_ROLES[cur.role] || cur.role === "staff_disabled")) throw new TeamError("not-found", "Not a team member.");

  if (op === "setRole") {
    if (!STAFF_ROLES[data.role]) throw new TeamError("invalid-argument", "Choose a role.");
    await ref.update({ role: data.role, updatedAt: deps.serverTimestamp() });
    return { ok: true };
  }
  if (op === "disable") {
    await ref.update({ role: "staff_disabled", previousRole: cur.role, updatedAt: deps.serverTimestamp() });
    await deps.auth.updateUser(uid, { disabled: true });
    await deps.auth.revokeRefreshTokens(uid);
    return { ok: true };
  }
  if (op === "enable") {
    await ref.update({ role: STAFF_ROLES[cur.previousRole] ? cur.previousRole : "advisor", updatedAt: deps.serverTimestamp() });
    await deps.auth.updateUser(uid, { disabled: false });
    return { ok: true };
  }
  if (op === "resetLink") return { ok: true, setPasswordLink: await deps.auth.generatePasswordResetLink(cur.email) };
  throw new TeamError("invalid-argument", "Unknown action.");
}

/* ---------------- Morning briefing ---------------- */
function istDay(ms, offsetDays) { return new Date(ms + 5.5 * 3600e3 + (offsetDays || 0) * 86400e3).toISOString().slice(0, 10); }
const DONE = ["delivered", "completed"];

/** Pure: build the briefing rows from plain arrays. */
const STOCK_MIN = { boxes: 40, tape: 10, bubble: 4, stretch: 4, blankets: 10 };
const STOCK_LABEL = { boxes: "boxes", tape: "tape", bubble: "bubble wrap", stretch: "stretch film", blankets: "blankets" };
function lowStock(items) { return Object.keys(STOCK_MIN).filter((k) => Number((items || {})[k] || 0) < STOCK_MIN[k]).map((k) => STOCK_LABEL[k] + " (" + Number((items || {})[k] || 0) + ")"); }

function buildBriefing({ bookings, leads, opportunities, prospects, crews, stock }, nowMs) {
  const today = istDay(nowMs), yesterday = istDay(nowMs, -1);
  const live = (b) => b.status !== "cancelled";
  const todays = bookings.filter((b) => b.date === today && live(b));
  const unassigned = todays.filter((b) => !b.driverUid && !DONE.includes(b.status));
  const tomorrowUnassigned = bookings.filter((b) => b.date === istDay(nowMs, 1) && live(b) && !b.driverUid);
  const dueToday = todays.reduce((s, b) => s + (Number(b.balanceDue) || 0), 0);
  const madeYesterday = bookings.filter((b) => b.createdDay === yesterday && live(b));
  const openLead = (l) => ["new", "contacted", "quoted"].includes(l.status || "new");
  const hot = leads.filter((l) => (l.tierManual || l.tier) === "hot" && openLead(l));
  const waiting = leads.filter((l) => (l.status || "new") === "new" && (l.tierManual || l.tier) !== "junk" && nowMs - (l.createdAtMs || nowMs) > 30 * 60000);
  const followUps = leads.filter((l) => l.followUpAt && openLead(l) && l.followUpAt <= nowMs + 86400e3);
  const newOpps = opportunities.filter((o) => (o.status || "new") === "new");
  const toContact = prospects.filter((p) => (p.status || "to_contact") === "to_contact");
  const rup = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
  const rows = [
    ["Jobs today", `${todays.length}` + (todays.length ? ` (${todays.map((b) => (b.bookingType === "parcel" ? "parcel" : b.bookingType === "service" ? "service" : "move")).join(", ")})` : "")],
    ["Unassigned today", unassigned.length ? `⚠️ ${unassigned.length} — assign in Operations board` : "None ✅"],
    ["Unassigned tomorrow", tomorrowUnassigned.length ? `${tomorrowUnassigned.length}` : "None ✅"],
    ["Balance to collect today", rup(dueToday)],
    ["Bookings made yesterday", `${madeYesterday.length} (${rup(madeYesterday.reduce((s, b) => s + (Number(b.total) || 0), 0))})`],
    ["🔥 Hot leads open", hot.length ? `${hot.length} — call first: ${hot.slice(0, 3).map((l) => l.name).join(", ")}` : "None"],
    ["Leads waiting > 30 min", waiting.length ? `⚠️ ${waiting.length}` : "None ✅"],
    ["Follow-ups due", `${followUps.length}`],
    ["New opportunities to reply", `${newOpps.length}`],
    ["Partners to contact", `${toContact.length}`],
    ["Active moving crews", crews == null ? "-" : (crews < 2 ? `⚠️ ${crews} — add or re-activate partners` : `${crews}`)],
    ["Packing stock", stock == null ? "Not tracked yet (admin → Overview)" : (lowStock(stock).length ? "⚠️ Low: " + lowStock(stock).join(", ") : "OK")],
    ["Today's focus", unassigned.length ? "Assign today's jobs first." : hot.length || waiting.length ? "Call hot and waiting leads before 10 AM." : followUps.length ? "Clear today's follow-ups." : "Reach out to 5 new partners and reply to opportunities."],
  ];
  return { rows, counts: { todays: todays.length, unassigned: unassigned.length, hot: hot.length, waiting: waiting.length, followUps: followUps.length } };
}

async function runBriefing(deps) {
  const nowMs = deps.now();
  const from = istDay(nowMs, -1), to = istDay(nowMs, 2);
  const [b, l, o, p, dp, inv] = await Promise.all([
    deps.db.collection("bookings").where("date", ">=", from).where("date", "<=", to).limit(500).get(),
    deps.db.collection("leads").where("createdAtMs", ">=", nowMs - 45 * 86400e3).limit(800).get(),
    deps.db.collection("opportunities").where("status", "==", "new").limit(200).get(),
    deps.db.collection("prospects").where("status", "==", "to_contact").limit(300).get(),
    deps.db.collection("driverProfiles").where("status", "==", "active").get().catch(() => null),
    deps.db.collection("settings").doc("inventory").get().catch(() => null),
  ]);
  const crews = dp ? dp.docs.map((d) => d.data()).filter((x) => (x.skills || []).includes("moving")).length : null;
  const stock = inv && inv.exists ? (inv.data().items || {}) : null;
  const bookings = b.docs.map((d) => { const x = d.data() || {}; const c = x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : null; return Object.assign({}, x, { createdDay: c ? istDay(c) : null }); });
  const out = buildBriefing({ bookings, leads: l.docs.map((d) => d.data()), opportunities: o.docs.map((d) => d.data()), prospects: p.docs.map((d) => d.data()), crews, stock }, nowMs);
  await deps.sendAdminEmail(`Good morning ☀️ PackZen briefing — ${new Date(nowMs + 5.5 * 3600e3).toISOString().slice(0, 10)}`, out.rows, null);
  return out.counts;
}

/* ---------------- Weekly business report (Fridays 6 PM IST) ---------------- */
function buildWeekly({ bookings, leads }, nowMs) {
  const since = nowMs - 7 * 86400e3;
  const ms = (x) => (x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : (x.createdAtMs || 0));
  const wk = bookings.filter((b) => ms(b) >= since);
  const live = wk.filter((b) => b.status !== "cancelled");
  const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
  const rup = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
  const done = bookings.filter((b) => ["delivered", "completed"].includes(b.status) && ((b.completedAt && b.completedAt.toMillis ? b.completedAt.toMillis() : ms(b)) >= since));
  const wl = leads.filter((l) => (l.createdAtMs || 0) >= since && (l.tierManual || l.tier) !== "junk");
  const bySrc = {};
  wl.forEach((l) => { const k = l.channel || l.source || "direct"; const r = bySrc[k] = bySrc[k] || { n: 0, hot: 0, booked: 0 }; r.n++; if ((l.tier) === "hot") r.hot++; if (l.status === "booked") r.booked++; });
  const src = Object.entries(bySrc).sort((a, b) => b[1].booked - a[1].booked || b[1].n - a[1].n).slice(0, 6)
    .map(([k, r]) => `${k}: ${r.n} leads, ${r.hot} hot, ${r.booked} booked`).join(" · ") || "No leads this week";
  const best = Object.entries(bySrc).sort((a, b) => b[1].booked - a[1].booked || b[1].hot - a[1].hot)[0];
  return { rows: [
    ["New bookings", `${live.length} (${rup(sum(live, (b) => b.total))} booked value)`],
    ["Paid online", rup(sum(live, (b) => (b.paid != null ? b.paid : b.paidAmount)))],
    ["Jobs completed", `${done.length} (${rup(sum(done, (b) => b.total))})`],
    ["Cancelled", `${wk.length - live.length}`],
    ["Real leads", `${wl.length} · converted ${wl.filter((l) => l.status === "booked").length}`],
    ["Leads by source", src],
    ["Do more of", best ? `${best[0]} (best source this week)` : "Partner outreach and reviews"],
  ], counts: { bookings: live.length, leads: wl.length } };
}
async function runWeekly(deps) {
  const nowMs = deps.now(), since = nowMs - 8 * 86400e3;
  const [b, l] = await Promise.all([
    deps.db.collection("bookings").where("createdAt", ">=", new Date(since)).limit(1000).get(),
    deps.db.collection("leads").where("createdAtMs", ">=", since).limit(1000).get(),
  ]);
  const out = buildWeekly({ bookings: b.docs.map((d) => d.data()), leads: l.docs.map((d) => d.data()) }, nowMs);
  await deps.sendAdminEmail(`PackZen weekly report — week ending ${new Date(nowMs + 5.5 * 3600e3).toISOString().slice(0, 10)}`, out.rows, null);
  return out.counts;
}

module.exports = { buildWeekly, runWeekly, lowStock, handleStaff, TeamError, STAFF_ROLES, buildBriefing, runBriefing, istDay };
