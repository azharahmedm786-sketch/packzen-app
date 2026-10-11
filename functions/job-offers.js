/**
 * PackZen — Phase 2C automatic driver offers (feature-flagged, default OFF)
 * ------------------------------------------------------------------------
 * appConfig/assignment { autoOffers: true|false, offerTimeoutMin: 5, maxAttempts: 5, horizonHours: 72 }
 * When autoOffers is not true the sweep only tidies existing offers; nothing new is offered.
 *
 * Flow: sweep (every minute) → for each confirmed, unassigned booking within the
 * horizon that has no live offer → offer it to the best eligible driver (same
 * engine as shadow mode, previously-tried drivers excluded). The driver has
 * offerTimeoutMin to accept; decline/expiry → next driver; after maxAttempts or
 * no eligible driver → assignment.state "needs_manual" + one admin alert.
 *
 * Accept is one transaction over offer + booking + driver schedule lock, so two
 * drivers (or a driver and an admin) can never both win the same booking.
 * Offers carry only date/time/area/vehicle — no customer name, phone or address.
 */
"use strict";

const engine = require("./assignment-engine");
const { loadDrivers, liveLockJobs, scheduleId } = require("./assignment");

const DEFAULTS = { autoOffers: false, offerTimeoutMin: 5, maxAttempts: 5, horizonHours: 72 };
class OfferError extends Error { constructor(code, message) { super(code); this.code = code; this.publicMessage = message; } }

async function getConfig(db) {
  let c = {};
  try { const s = await db.collection("appConfig").doc("assignment").get(); c = s.exists ? s.data() || {} : {}; } catch (e) { c = {}; }
  const n = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  return { autoOffers: c.autoOffers === true, offerTimeoutMin: n(c.offerTimeoutMin, DEFAULTS.offerTimeoutMin, 1, 60),
           maxAttempts: n(c.maxAttempts, DEFAULTS.maxAttempts, 1, 20), horizonHours: n(c.horizonHours, DEFAULTS.horizonHours, 1, 336), engine: c.engine };
}
const toMs = (v) => (v == null ? null : typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : null));
function areaOf(pickup) { const parts = String(pickup || "").split(",").map((s) => s.trim()).filter(Boolean); return parts.length > 1 ? parts[parts.length - 3] || parts[0] : (parts[0] || "").slice(0, 40); }

/** Booking may receive a new automatic offer now. */
function eligibleForOffer(b, now, cfg) {
  if (!b || b.status !== "confirmed" || b.driverUid) return false;
  const a = b.assignment || {};
  if (a.state === "needs_manual" || a.state === "accepted") return false;
  const start = engine.jobStartMs(b.date, b.shiftTime, 420);
  if (start === null || start < now) return false;
  return start - now <= cfg.horizonHours * 3600e3;
}

/**
 * Offer a booking to the next best driver. Returns { offered: offerId } | { needsManual: reason } | { skipped }.
 * deps: { db, now(), logger, alert?(subject, rows) }
 */
async function offerNext(deps, bookingId, cfg) {
  const db = deps.db; const now = deps.now();
  const bRef = db.collection("bookings").doc(bookingId);
  const snap = await bRef.get();
  if (!snap.exists) return { skipped: "missing" };
  const b = Object.assign({ id: bookingId }, snap.data());
  if (!eligibleForOffer(b, now, cfg)) return { skipped: "not_eligible" };
  const a = b.assignment || {};
  const tried = Array.isArray(a.candidatesTried) ? a.candidatesTried : [];
  const attempt = (a.attempt || 0) + 1;
  let pick = null, reason = "attempts_exhausted";
  if (attempt <= cfg.maxAttempts) {
    const drivers = await loadDrivers(db, b.date, bookingId);
    const r = engine.evaluate(b, drivers, { now, bookingId, triedUids: tried, config: cfg.engine });
    pick = r.ranked[0] || null; reason = "no_eligible_driver";
  }
  const offerRef = db.collection("jobOffers").doc(bookingId + "_" + attempt);
  const out = await db.runTransaction(async (tx) => {
    const cur = await tx.get(bRef);
    const c = cur.data() || {};
    const pRef = pick ? db.collection("driverProfiles").doc(pick.uid) : null;
    const p = pRef ? await tx.get(pRef) : null; // all reads before writes
    if (c.driverUid || c.status !== "confirmed" || ((c.assignment || {}).attempt || 0) !== (a.attempt || 0)) return { skipped: "changed" };
    if (!pick) {
      tx.update(bRef, { assignment: Object.assign({}, c.assignment || {}, { state: "needs_manual", reason, method: "auto", lastChangedAt: now }) });
      return { needsManual: reason };
    }
    const offer = { bookingId, driverUid: pick.uid, state: "offered", attempt, offeredAt: now, expiresAt: now + cfg.offerTimeoutMin * 60e3, score: pick.score,
      summary: { date: c.date || null, shiftTime: c.shiftTime || null, area: areaOf(c.pickup), vehicle: c.vehicleUsed || c.vehicleId || null, kind: c.bookingType === "service" ? "service" : "move" } };
    tx.set(offerRef, offer);
    tx.update(bRef, { assignment: { state: "offering", method: "auto", offerId: offerRef.id, attempt, candidatesTried: tried.concat([pick.uid]), lastChangedAt: now } });
    if (p && p.exists) { const acc = Object.assign({ offered: 0, accepted: 0, declined: 0, expired: 0 }, (p.data() || {}).acceptance || {}); acc.offered += 1; tx.update(pRef, { lastOfferedAt: now, acceptance: acc }); }
    return { offered: offerRef.id, driverUid: pick.uid };
  });
  if (out.needsManual && deps.alert) {
    await deps.alert("Assignment needs you: " + (b.bookingRef || bookingId), [["Booking", b.bookingRef || bookingId], ["Date", (b.date || "") + " " + (b.shiftTime || "")], ["Why", out.needsManual.replace(/_/g, " ")], ["Action", "Assign a driver in the admin dashboard"]]);
  }
  (deps.logger || console).info("job_offer", Object.assign({ bookingId }, out));
  return out;
}

/** Driver accepts — one transaction: offer + booking + schedule lock + users.currentBooking. */
async function handleAccept(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new OfferError("unauthenticated", "Please sign in.");
  if (!(await deps.isDriver(context))) throw new OfferError("permission-denied", "Drivers only.");
  const offerId = data && data.offerId;
  if (typeof offerId !== "string" || !/^[A-Za-z0-9_-]{6,160}$/.test(offerId)) throw new OfferError("invalid-argument", "Invalid offer.");
  const db = deps.db; const now = deps.now();
  const oRef = db.collection("jobOffers").doc(offerId);
  const pre = await oRef.get();
  if (!pre.exists) throw new OfferError("not-found", "Offer not found.");
  const bookingId = pre.data().bookingId;
  const bRef = db.collection("bookings").doc(bookingId);
  const bPre = await bRef.get();
  const date = bPre.exists ? bPre.data().date : null;
  const sameDay = date ? await db.collection("bookings").where("date", "==", date).get() : { docs: [] };
  const index = {}; sameDay.docs.forEach((d) => { const x = d.data() || {}; index[d.id] = { status: x.status || null, driverUid: x.driverUid || null }; });
  const fromQuery = sameDay.docs.filter((d) => d.id !== bookingId && (d.data() || {}).driverUid === uid && ["assigned", "packing", "transit"].includes((d.data() || {}).status))
    .map((d) => ({ bookingId: d.id, startMin: engine.slotStartMin((d.data() || {}).shiftTime) }));

  const res = await db.runTransaction(async (tx) => {
    const o = await tx.get(oRef); const od = o.data() || {};
    if (od.driverUid !== uid) return { error: ["permission-denied", "This offer isn't yours."] };
    if (od.state === "accepted") return { already: true };
    if (od.state !== "offered") return { error: ["failed-precondition", "This offer is no longer available."] };
    if (now >= od.expiresAt) return { error: ["deadline-exceeded", "This offer has expired."] };
    const b = await tx.get(bRef); const bd = b.data() || {};
    if (!b.exists || bd.driverUid || bd.status !== "confirmed" || (bd.assignment || {}).offerId !== offerId) return { error: ["failed-precondition", "This job has already been assigned."] };
    const u = await tx.get(db.collection("users").doc(uid)); const ud = u.data() || {};
    const lockRef = bd.date ? db.collection("driverSchedule").doc(scheduleId(uid, bd.date)) : null;
    const lock = lockRef ? await tx.get(lockRef) : null;
    const pRef = db.collection("driverProfiles").doc(uid); const p = await tx.get(pRef); // last read
    const lockJobs = lock && lock.exists ? (lock.data() || {}).jobs || {} : {};
    const live = liveLockJobs(lockJobs, uid, index);
    const jobs = fromQuery.concat(Object.entries(live).filter(([bid]) => bid !== bookingId && !fromQuery.some((j) => j.bookingId === bid)).map(([bid, m]) => ({ bookingId: bid, startMin: m })));
    if (engine.hasScheduleConflict(Object.assign({ id: bookingId }, bd), jobs, undefined, bookingId)) return { error: ["failed-precondition", "You already have a job at that time."] };
    tx.update(oRef, { state: "accepted", respondedAt: now });
    tx.update(bRef, { driverUid: uid, driverName: ud.name || "Driver", driverPhone: ud.phone || "", status: "assigned",
      assignment: Object.assign({}, bd.assignment || {}, { state: "accepted", method: "auto", acceptedAt: now, lastChangedAt: now }) });
    if (lockRef) tx.set(lockRef, { driverUid: uid, date: bd.date, jobs: Object.assign({}, live, { [bookingId]: engine.slotStartMin(bd.shiftTime) }), updatedAt: now });
    tx.update(db.collection("users").doc(uid), { currentBooking: bookingId });
    if (p.exists) { const acc = Object.assign({ offered: 0, accepted: 0, declined: 0, expired: 0 }, (p.data() || {}).acceptance || {}); acc.accepted += 1; tx.update(pRef, { acceptance: acc }); }
    return { ok: true };
  });
  if (res.error) throw new OfferError(res.error[0], res.error[1]);
  (deps.logger || console).info("job_offer_accepted", { offerId, bookingId, uid, already: !!res.already });
  return { ok: true, bookingId, already: !!res.already };
}

/** Driver declines → next driver is offered immediately. */
async function handleDecline(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new OfferError("unauthenticated", "Please sign in.");
  if (!(await deps.isDriver(context))) throw new OfferError("permission-denied", "Drivers only.");
  const offerId = data && data.offerId;
  if (typeof offerId !== "string" || !/^[A-Za-z0-9_-]{6,160}$/.test(offerId)) throw new OfferError("invalid-argument", "Invalid offer.");
  const oRef = deps.db.collection("jobOffers").doc(offerId);
  const r = await deps.db.runTransaction(async (tx) => {
    const o = await tx.get(oRef); const od = o.data() || {};
    if (!o.exists || od.driverUid !== uid) return { error: ["permission-denied", "This offer isn't yours."] };
    if (od.state !== "offered") return { already: true, bookingId: od.bookingId };
    const pRef = deps.db.collection("driverProfiles").doc(uid); const p = await tx.get(pRef);
    tx.update(oRef, { state: "declined", respondedAt: deps.now() });
    if (p.exists) { const acc = Object.assign({ offered: 0, accepted: 0, declined: 0, expired: 0 }, (p.data() || {}).acceptance || {}); acc.declined += 1; tx.update(pRef, { acceptance: acc }); }
    return { ok: true, bookingId: od.bookingId };
  });
  if (r.error) throw new OfferError(r.error[0], r.error[1]);
  if (!r.already) { const cfg = await getConfig(deps.db); if (cfg.autoOffers) await offerNext(deps, r.bookingId, cfg); }
  return { ok: true };
}

/** Every minute: expire stale offers, tidy orphans, and (if enabled) offer unassigned bookings. */
async function sweep(deps) {
  const db = deps.db; const now = deps.now(); const cfg = await getConfig(db);
  const stats = { expired: 0, cancelled: 0, offered: 0, needsManual: 0, enabled: cfg.autoOffers };
  const live = await db.collection("jobOffers").where("state", "==", "offered").limit(200).get();
  const busy = new Set();
  for (const d of live.docs) {
    const o = d.data() || {};
    const b = await db.collection("bookings").doc(o.bookingId).get(); const bd = b.exists ? b.data() || {} : {};
    const orphan = !b.exists || bd.driverUid || bd.status !== "confirmed" || (bd.assignment || {}).offerId !== d.id;
    if (orphan) { await d.ref.update({ state: "cancelled", respondedAt: now }); stats.cancelled++; continue; }
    if (now >= o.expiresAt) {
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(d.ref); if ((cur.data() || {}).state !== "offered") return;
        const pRef = db.collection("driverProfiles").doc(o.driverUid); const p = await tx.get(pRef);
        tx.update(d.ref, { state: "expired", respondedAt: now });
        if (p.exists) { const acc = Object.assign({ offered: 0, accepted: 0, declined: 0, expired: 0 }, (p.data() || {}).acceptance || {}); acc.expired += 1; tx.update(pRef, { acceptance: acc }); }
      });
      stats.expired++;
      continue; // re-offered below in the same run
    }
    busy.add(o.bookingId);
  }
  if (!cfg.autoOffers) { (deps.logger || console).info("job_offer_sweep", stats); return stats; }
  const q = await db.collection("bookings").where("status", "==", "confirmed").limit(300).get();
  for (const d of q.docs) {
    if (busy.has(d.id)) continue;
    const b = d.data() || {};
    if (!eligibleForOffer(b, now, cfg)) continue;
    try {
      const r = await offerNext(deps, d.id, cfg);
      if (r.offered) stats.offered++; else if (r.needsManual) stats.needsManual++;
    } catch (e) { (deps.logger || console).warn("job_offer_error", { bookingId: d.id }); }
  }
  (deps.logger || console).info("job_offer_sweep", stats);
  return stats;
}

module.exports = { sweep, offerNext, handleAccept, handleDecline, getConfig, eligibleForOffer, OfferError, DEFAULTS };
