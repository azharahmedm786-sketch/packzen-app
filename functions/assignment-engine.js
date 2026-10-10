/**
 * PackZen — Phase 2B assignment recommendation engine (PURE, deterministic)
 * -----------------------------------------------------------------------
 * No Firestore, no clock: callers pass `now` and all data. Used by shadow-mode
 * recommendations and by adminAssignDriver eligibility checks. It never
 * assigns anything by itself.
 *
 *   evaluate(booking, drivers, { now, config, triedUids }) →
 *     { requirement, ranked: [{ uid, score, components, reasons }], excluded: [{ uid, reasons }] }
 *
 * drivers[i] = { uid, name, profile, presence, jobsOnDate: [{ bookingId, startMin }] }
 */
"use strict";

const PackZenPricing = require("./pricing-engine-v2.js");

const ENGINE_VERSION = "2b-1";
const DEFAULT_CONFIG = Object.freeze({
  weights: { distance: 0.30, workload: 0.25, fairness: 0.20, rating: 0.15, acceptance: 0.10 },
  nearTermHours: 3,          // jobs starting within this window need a live, online driver
  presenceMaxAgeMin: 10,     // presence older than this is "stale"
  jobDurationHours: 4,       // two jobs closer than this on the same day conflict
  maxDistanceKm: 40,
  fairnessFullDays: 7,
  unknownTimeStartMin: 420,  // a job with no/unknown time is assumed to start 07:00 IST (availability only; conflicts stay whole-day)
  neutral: 0.5,              // score used when data is missing (no coordinates, new driver)
  unratedScore: 0.8,
  noHistoryAcceptance: 0.8,
  categorySkill: { moving: "moving", packing: "packing", "ac-services": "ac", ac: "ac", appliances: "appliances",
                   "appliance-repair": "appliances", plumbing: "plumbing", electrical: "electrical", carpentry: "carpentry",
                   painting: "painting", cleaning: "cleaning", "pest-control": "pest_control", parcel: "parcel",
                   "vehicle-transport": "vehicle_transport" },
});

const VEHICLE_CAPACITY = Object.fromEntries(Object.entries(PackZenPricing.config.vehicles).map(([k, v]) => [k, Number(v.capacity) || 0]));

function mergeConfig(c) {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!c) return base;
  return Object.assign(base, c, { weights: Object.assign(base.weights, c.weights || {}), categorySkill: Object.assign(base.categorySkill, c.categorySkill || {}) });
}
function toMs(v) {
  if (v == null) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "number") return v;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
/** "HH:MM" → minutes after midnight, or null (unknown → whole-day job). */
function slotStartMin(shiftTime) {
  const m = typeof shiftTime === "string" && shiftTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
/** IST wall-clock job start in epoch ms (date "YYYY-MM-DD"); null for missing/invalid dates. */
function jobStartMs(date, shiftTime, unknownTimeStartMin) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = Date.parse(date + "T00:00:00+05:30");
  if (!Number.isFinite(day) || new Date(day + 5.5 * 3600e3).toISOString().slice(0, 10) !== date) return null; // e.g. 2026-02-31
  const s = slotStartMin(shiftTime);
  return day + (s === null ? (unknownTimeStartMin || 0) : s) * 60000;
}
function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const validPoint = (p) => p && typeof p.lat === "number" && typeof p.lng === "number";

/** What the booking needs. */
function requirementFor(booking, cfg) {
  const isService = booking.bookingType === "service";
  const req = { kind: isService ? "service" : "move", area: "bangalore", vehicleId: null, minCapacity: 0, skills: [] };
  if (isService) {
    const cats = (Array.isArray(booking.items) ? booking.items : []).map((i) => i && i.categoryId).filter(Boolean);
    const skills = [...new Set(cats.map((c) => cfg.categorySkill[c] || null))];
    req.skills = skills.includes(null) || !skills.length ? ["__unmapped__"] : skills.sort();
  } else {
    const v = booking.vehicleUsed || booking.vehicleId || null;
    req.vehicleId = VEHICLE_CAPACITY[v] !== undefined ? v : null;
    req.minCapacity = req.vehicleId ? VEHICLE_CAPACITY[req.vehicleId] : 0;
    req.skills = ["moving"];
  }
  req.startMs = jobStartMs(booking.date, booking.shiftTime, cfg.unknownTimeStartMin);
  req.startMin = slotStartMin(booking.shiftTime);
  req.point = validPoint(booking.pickupCoords) ? booking.pickupCoords : null;
  return req;
}

function conflicts(req, jobs, cfg, bookingId) {
  const dur = cfg.jobDurationHours * 60;
  return (jobs || []).some((j) => {
    if (j.bookingId === bookingId) return false;
    if (req.startMin === null || j.startMin === null || j.startMin === undefined) return true; // unknown time → whole day
    return Math.abs(j.startMin - req.startMin) < dur;
  });
}

/** Hard filters → list of exclusion reasons (empty = eligible). */
function hardFilter(req, d, ctx) {
  const reasons = [];
  const p = d.profile;
  if (!p) return ["no_profile"];
  if (p.status !== "active") reasons.push("status_" + (p.status || "unknown"));
  if (p.lockedUntil && toMs(p.lockedUntil) > ctx.now) reasons.push("locked");
  if (!Array.isArray(p.serviceAreas) || !p.serviceAreas.includes(req.area)) reasons.push("area_mismatch");
  if (req.kind === "move") {
    const caps = (p.vehicleIds || []).map((v) => VEHICLE_CAPACITY[v] || 0);
    if (!caps.length) reasons.push("no_vehicle");
    else if (Math.max(...caps) < req.minCapacity) reasons.push("vehicle_too_small");
  }
  const skills = p.skills || [];
  if (!req.skills.every((s) => skills.includes(s))) reasons.push("skill_mismatch");
  if (ctx.tried.has(d.uid)) reasons.push("previously_tried");
  const jobs = (d.jobsOnDate || []).filter((j) => j.bookingId !== ctx.bookingId);
  if (jobs.length >= (p.maxJobsPerDay || 0)) reasons.push("at_capacity");
  if (conflicts(req, jobs, ctx.cfg, ctx.bookingId)) reasons.push("schedule_conflict");
  // availability
  const nearTerm = req.startMs !== null && req.startMs - ctx.now <= ctx.cfg.nearTermHours * 3600000;
  if (nearTerm) {
    const pr = d.presence;
    const age = pr ? ctx.now - (toMs(pr.updatedAt) || 0) : Infinity;
    if (!pr || pr.online !== true) reasons.push("offline_near_term");
    else if (age > ctx.cfg.presenceMaxAgeMin * 60000) reasons.push("stale_presence");
  }
  return reasons;
}

function scoreDriver(req, d, ctx) {
  const cfg = ctx.cfg, p = d.profile;
  const nearTerm = req.startMs !== null && req.startMs - ctx.now <= cfg.nearTermHours * 3600000;
  const presencePoint = d.presence && validPoint(d.presence) && ctx.now - (toMs(d.presence.updatedAt) || 0) <= cfg.presenceMaxAgeMin * 60000 ? d.presence : null;
  const origin = nearTerm ? presencePoint || (validPoint(p.homeBase) ? p.homeBase : null) : (validPoint(p.homeBase) ? p.homeBase : presencePoint);
  let distanceKm = null, distance = cfg.neutral;
  if (req.point && origin) { distanceKm = haversineKm(origin, req.point); distance = Math.max(0, 1 - distanceKm / cfg.maxDistanceKm); }
  const jobs = (d.jobsOnDate || []).filter((j) => j.bookingId !== ctx.bookingId).length;
  const workload = Math.max(0, 1 - jobs / Math.max(1, p.maxJobsPerDay || 1));
  const last = toMs(p.lastOfferedAt);
  const fairness = last === null ? 1 : Math.min(1, Math.max(0, (ctx.now - last) / (cfg.fairnessFullDays * 86400000)));
  const r = p.rating || {};
  const rating = r.count > 0 && typeof r.avg === "number" ? Math.min(1, Math.max(0, r.avg / 5)) : cfg.unratedScore;
  const a = p.acceptance || {};
  const acceptance = a.offered > 0 ? Math.min(1, (a.accepted || 0) / a.offered) : cfg.noHistoryAcceptance;
  const components = { distance, workload, fairness, rating, acceptance };
  const w = cfg.weights; const wsum = Object.values(w).reduce((x, y) => x + y, 0) || 1;
  const score = Object.keys(components).reduce((s, k) => s + (w[k] || 0) * components[k], 0) / wsum;
  const reasons = [];
  reasons.push(distanceKm === null ? "distance unknown" : distanceKm.toFixed(1) + " km away");
  reasons.push(jobs + " job(s) that day");
  reasons.push(last === null ? "not offered recently" : "last offered " + Math.round((ctx.now - last) / 3600000) + " h ago");
  return { score: Math.round(score * 10000) / 10000, components, distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10, reasons };
}

function evaluate(booking, drivers, opts) {
  const cfg = mergeConfig(opts && opts.config);
  const ctx = { now: opts.now, cfg, tried: new Set((opts && opts.triedUids) || []), bookingId: (opts && opts.bookingId) || booking.id || null };
  const req = requirementFor(booking, cfg);
  const ranked = [], excluded = [];
  for (const d of [...drivers].sort((x, y) => (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0))) {
    const reasons = hardFilter(req, d, ctx);
    if (reasons.length) { excluded.push({ uid: d.uid, reasons }); continue; }
    ranked.push(Object.assign({ uid: d.uid, name: d.name || "" }, scoreDriver(req, d, ctx)));
  }
  ranked.sort((x, y) => (y.score - x.score) || (x.uid < y.uid ? -1 : 1)); // deterministic tie-break
  return { engineVersion: ENGINE_VERSION, requirement: { kind: req.kind, vehicleId: req.vehicleId, skills: req.skills, startMs: req.startMs }, ranked, excluded };
}

/** Schedule-only check (used when a driver has no profile yet). */
function hasScheduleConflict(booking, jobsOnDate, config, bookingId) {
  const cfg = mergeConfig(config);
  return conflicts(requirementFor(booking, cfg), (jobsOnDate || []).filter((j) => j.bookingId !== bookingId), cfg, bookingId);
}

/** Check one specific driver (used by manual assignment). */
function checkDriver(booking, driver, opts) {
  const r = evaluate(booking, [driver], opts);
  return r.ranked.length ? { eligible: true, reasons: [], score: r.ranked[0].score } : { eligible: false, reasons: r.excluded[0].reasons };
}

module.exports = { evaluate, checkDriver, hasScheduleConflict, requirementFor, slotStartMin, jobStartMs, haversineKm, mergeConfig, DEFAULT_CONFIG, VEHICLE_CAPACITY, ENGINE_VERSION };
