/**
 * PackZen — Phase 2B: shadow-mode recommendations + hardened manual assignment
 * ----------------------------------------------------------------------------
 * SHADOW MODE: computes the best driver for unassigned bookings and stores it in
 * assignmentRecommendations/{bookingId} (server-only write, admin/advisor read).
 * It NEVER writes to bookings and never sets driverUid. Automatic offers (2C)
 * are not implemented.
 *
 * Kill switch: Firestore appConfig/assignment { shadowEnabled: false } stops the
 * scheduled sweep (on-demand admin recommendations keep working). Pausing the
 * Cloud Scheduler job "shadowAssignmentSweep" has the same effect.
 *
 * MANUAL ASSIGNMENT: adminAssignDriver — admin only, one transaction over the
 * booking, the driver's driverSchedule/{uid}_{date} lock doc and users docs.
 */
"use strict";

const engine = require("./assignment-engine");

const ASSIGNABLE = ["pending", "confirmed", "assigned"];
const ACTIVE_JOB = ["assigned", "packing", "transit", "confirmed", "pending"];
const BLOCKING = new Set(["schedule_conflict", "locked", "no_user"]);
const OVERRIDABLE = new Set(["area_mismatch", "no_vehicle", "vehicle_too_small", "skill_mismatch", "at_capacity", "no_profile"]);
// offline_near_term / stale_presence / previously_tried are warnings for manual assignment.

class AssignError extends Error { constructor(code, message, detail) { super(code); this.code = code; this.publicMessage = message; this.detail = detail || null; } }

function istDate(ms, addDays) { return new Date(ms + 5.5 * 3600e3 + (addDays || 0) * 86400e3).toISOString().slice(0, 10); }
const validId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(s);
const scheduleId = (uid, date) => uid + "_" + date;

async function getAppConfig(db) {
  try { const s = await db.collection("appConfig").doc("assignment").get(); return s.exists ? s.data() || {} : {}; } catch (e) { return {}; }
}

/** All drivers with profile, presence and their jobs on `date` (from bookings + schedule locks). */
async function loadDrivers(db, date, bookingId) {
  const users = await db.collection("users").where("role", "==", "driver").get();
  const sameDay = date ? await db.collection("bookings").where("date", "==", date).get() : { docs: [] };
  const jobs = {};
  sameDay.docs.forEach((d) => {
    const b = d.data() || {};
    if (!b.driverUid || !ACTIVE_JOB.includes(b.status) || d.id === bookingId) return;
    (jobs[b.driverUid] = jobs[b.driverUid] || {})[d.id] = engine.slotStartMin(b.shiftTime);
  });
  const out = [];
  for (const u of users.docs) {
    const uid = u.id;
    const [p, pr, sch] = await Promise.all([
      db.collection("driverProfiles").doc(uid).get(),
      db.collection("driverPresence").doc(uid).get(),
      date ? db.collection("driverSchedule").doc(scheduleId(uid, date)).get() : Promise.resolve({ exists: false }),
    ]);
    const merged = Object.assign({}, sch.exists ? (sch.data() || {}).jobs || {} : {}, jobs[uid] || {});
    delete merged[bookingId];
    out.push({ uid, name: (u.data() || {}).name || "", profile: p.exists ? p.data() : null, presence: pr.exists ? pr.data() : null,
               jobsOnDate: Object.entries(merged).map(([bid, m]) => ({ bookingId: bid, startMin: m === undefined ? null : m })) });
  }
  return out;
}

function summarize(result) {
  const counts = {};
  result.excluded.forEach((e) => e.reasons.forEach((r) => { counts[r] = (counts[r] || 0) + 1; }));
  return counts;
}

/** Compute + store a shadow recommendation. NEVER writes the booking. */
async function recommend(deps, bookingId) {
  const db = deps.db;
  const snap = await db.collection("bookings").doc(bookingId).get();
  if (!snap.exists) throw new AssignError("not-found", "Booking not found.");
  const b = Object.assign({ id: bookingId }, snap.data());
  const drivers = await loadDrivers(db, b.date, bookingId);
  const cfg = (await getAppConfig(db)).engine || undefined;
  const r = engine.evaluate(b, drivers, { now: deps.now(), config: cfg, bookingId });
  const rec = {
    bookingId, bookingDate: b.date || null, mode: "shadow", engineVersion: r.engineVersion,
    requirement: r.requirement, candidates: drivers.length, eligibleCount: r.ranked.length,
    top: r.ranked.slice(0, 3).map((x) => ({ uid: x.uid, name: x.name, score: x.score, distanceKm: x.distanceKm, reasons: x.reasons })),
    excludedCounts: summarize(r), alreadyAssignedTo: b.driverUid || null, computedAt: deps.now(),
  };
  await db.collection("assignmentRecommendations").doc(bookingId).set(rec);
  return rec;
}

/** Scheduled shadow sweep over unassigned bookings in the next 3 IST days. */
async function shadowSweep(deps) {
  const db = deps.db; const now = deps.now();
  const cfg = await getAppConfig(db);
  if (cfg.shadowEnabled === false) { (deps.logger || console).info("assignment_shadow_disabled"); return { skipped: true, computed: 0 }; }
  const days = [istDate(now), istDate(now, 1), istDate(now, 2)];
  const q = await db.collection("bookings").where("date", "in", days).limit(300).get();
  let computed = 0;
  for (const d of q.docs) {
    const b = d.data() || {};
    if (!["pending", "confirmed"].includes(b.status) || b.driverUid) continue;
    try { await recommend(deps, d.id); computed++; } catch (e) { (deps.logger || console).warn("assignment_shadow_error", { bookingId: d.id }); }
  }
  (deps.logger || console).info("assignment_shadow_sweep", { scanned: q.docs.length, computed });
  return { skipped: false, computed };
}

async function handleRecommend(data, context, deps) {
  if (!(context && context.auth)) throw new AssignError("unauthenticated", "Please sign in.");
  if (!(await deps.isAdmin(context))) throw new AssignError("permission-denied", "Admins only.");
  if (!validId(data && data.bookingId)) throw new AssignError("invalid-argument", "Invalid booking.");
  return recommend(deps, data.bookingId);
}

/**
 * Manual assignment (admin). data: { bookingId, driverUid, expectedDriverUid (current value or null),
 *   overrideReason? (≥10 chars, needed when the driver fails an overridable eligibility check) }
 */
async function handleAssign(data, context, deps) {
  const caller = context && context.auth && context.auth.uid;
  if (!caller) throw new AssignError("unauthenticated", "Please sign in.");
  if (!(await deps.isAdmin(context))) throw new AssignError("permission-denied", "Only admins can assign drivers.");
  const { bookingId, driverUid } = data || {};
  if (!validId(bookingId) || !validId(driverUid)) throw new AssignError("invalid-argument", "Invalid booking or driver.");
  if (!data || !("expectedDriverUid" in data) || (data.expectedDriverUid !== null && !validId(data.expectedDriverUid))) {
    throw new AssignError("invalid-argument", "expectedDriverUid (current driver or null) is required.");
  }
  const overrideReason = typeof data.overrideReason === "string" ? data.overrideReason.trim().slice(0, 300) : "";
  const db = deps.db;
  const bRef = db.collection("bookings").doc(bookingId);

  // Pre-read outside the transaction (queries can't run inside one in all SDKs);
  // the transaction re-validates against the schedule lock doc.
  const pre = await bRef.get();
  if (!pre.exists) throw new AssignError("not-found", "Booking not found.");
  const date = (pre.data() || {}).date || null;
  const driversNow = await loadDrivers(db, date, bookingId);

  const result = await db.runTransaction(async (tx) => {
    const bSnap = await tx.get(bRef);
    if (!bSnap.exists) return { error: ["not-found", "Booking not found."] };
    const b = Object.assign({ id: bookingId }, bSnap.data());
    if ((b.driverUid || null) !== data.expectedDriverUid) return { error: ["aborted", "This booking's assignment changed in the meantime. Refresh and try again."] };
    if (!ASSIGNABLE.includes(b.status)) return { error: ["failed-precondition", "Only pending, confirmed or assigned (not started) bookings can be assigned."] };
    if (b.driverUid === driverUid) return { already: true };
    if (b.date !== date) return { error: ["aborted", "Booking date changed. Refresh and try again."] };

    const uRef = db.collection("users").doc(driverUid);
    const u = await tx.get(uRef);
    if (!u.exists || (u.data() || {}).role !== "driver") return { error: ["failed-precondition", "That account is not a driver."] };
    const prof = await tx.get(db.collection("driverProfiles").doc(driverUid));
    const pres = await tx.get(db.collection("driverPresence").doc(driverUid));
    const sRef = date ? db.collection("driverSchedule").doc(scheduleId(driverUid, date)) : null;
    const sSnap = sRef ? await tx.get(sRef) : null;
    const prevUid = b.driverUid || null;
    const prevURef = prevUid ? db.collection("users").doc(prevUid) : null;
    const prevU = prevURef ? await tx.get(prevURef) : null;
    const prevSRef = prevUid && date ? db.collection("driverSchedule").doc(scheduleId(prevUid, date)) : null;
    const prevS = prevSRef ? await tx.get(prevSRef) : null;

    const fromQuery = (driversNow.find((x) => x.uid === driverUid) || { jobsOnDate: [] }).jobsOnDate;
    const lockJobs = sSnap && sSnap.exists ? (sSnap.data() || {}).jobs || {} : {};
    const merged = {}; fromQuery.forEach((j) => { merged[j.bookingId] = j.startMin; }); Object.assign(merged, lockJobs); delete merged[bookingId];
    const driver = { uid: driverUid, name: (u.data() || {}).name || "", profile: prof.exists ? prof.data() : null, presence: pres.exists ? pres.data() : null,
                     jobsOnDate: Object.entries(merged).map(([bid, m]) => ({ bookingId: bid, startMin: m === undefined ? null : m })) };
    const check = engine.checkDriver(b, driver, { now: deps.now(), bookingId });
    // A driver without a profile (backfill not yet run) stays assignable as before
    // Phase 2; only the schedule-conflict check applies to them.
    const reasons = driver.profile ? check.reasons.slice()
      : (engine.hasScheduleConflict(b, driver.jobsOnDate, undefined, bookingId) ? ["schedule_conflict"] : []);
    if (driver.profile && driver.profile.status !== "active") return { error: ["failed-precondition", "Driver is " + driver.profile.status + "."] };
    const blocking = reasons.filter((r) => BLOCKING.has(r));
    if (blocking.length) return { error: ["failed-precondition", "Can't assign: " + blocking.join(", ") + "."] };
    const needsOverride = reasons.filter((r) => OVERRIDABLE.has(r));
    if (needsOverride.length && overrideReason.length < 10) return { error: ["failed-precondition", "Driver isn't eligible (" + needsOverride.join(", ") + "). Give an override reason (10+ characters) to assign anyway."], detail: needsOverride };
    const warnings = reasons.filter((r) => !BLOCKING.has(r) && !OVERRIDABLE.has(r)).concat(driver.profile ? [] : ["no_profile"]);

    const startMin = engine.slotStartMin(b.shiftTime);
    tx.update(bRef, {
      driverUid, driverName: (u.data() || {}).name || "Driver", driverPhone: (u.data() || {}).phone || "",
      status: "assigned",
      assignment: { method: "manual", by: caller, at: deps.now(), previousDriverUid: prevUid, override: needsOverride.length ? { reasons: needsOverride, reason: overrideReason } : null,
                    warnings, engineVersion: engine.ENGINE_VERSION },
    });
    if (sRef) tx.set(sRef, { driverUid, date, jobs: Object.assign({}, lockJobs, { [bookingId]: startMin }), updatedAt: deps.now() });
    if (prevSRef && prevS && prevS.exists) { const j = Object.assign({}, (prevS.data() || {}).jobs || {}); delete j[bookingId]; tx.set(prevSRef, Object.assign({}, prevS.data(), { jobs: j, updatedAt: deps.now() })); }
    tx.update(uRef, { currentBooking: bookingId });
    if (prevU && prevU.exists && (prevU.data() || {}).currentBooking === bookingId) tx.update(prevURef, { currentBooking: null });
    return { ok: true, warnings, overridden: needsOverride };
  });
  if (result.error) throw new AssignError(result.error[0], result.error[1], result.detail);
  (deps.logger || console).info("manual_assignment", { bookingId, driverUid, by: caller, already: !!result.already, overridden: (result.overridden || []).length > 0 });
  return { ok: true, already: !!result.already, warnings: result.warnings || [], overridden: result.overridden || [] };
}

module.exports = { recommend, shadowSweep, handleRecommend, handleAssign, loadDrivers, AssignError, istDate, scheduleId };
