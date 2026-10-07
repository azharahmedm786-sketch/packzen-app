/**
 * PackZen — Phase 2A unified driver profile
 * -----------------------------------------
 * users/{uid}            identity + role (unchanged, still the source of truth)
 * driverProfiles/{uid}   operational profile (admin-managed via adminUpsertDriverProfile;
 *                        no client writes — see firestore.rules)
 * driverPresence/{uid}   live presence written by the driver app (dual-write with users/{uid})
 *
 * Bookings are NOT migrated: booking.driverUid / driverName / driverPhone stay
 * the source of truth and firestore.rules isAssignedDriver is unchanged.
 */
"use strict";

const PackZenPricing = require("./pricing-engine-v2.js");

const STATUSES = ["active", "suspended", "onboarding"];
const SERVICE_AREAS = ["bangalore"]; // Bangalore-only launch
const SKILLS = ["moving", "packing", "assembly", "vehicle_transport", "parcel", "ac", "appliances",
                "plumbing", "electrical", "carpentry", "painting", "cleaning", "pest_control"];
const VEHICLE_IDS = Object.keys(PackZenPricing.config.vehicles); // tata_ace, truck_14ft, truck_17ft, truck_22ft

const DEFAULTS = Object.freeze({
  status: "onboarding",
  serviceAreas: ["bangalore"],
  vehicleIds: [],
  skills: ["moving"],
  partnerId: null,
  maxJobsPerDay: 3,
  homeBase: null,
  phoneVerified: false,
});
// Server-maintained (never accepted from the admin form).
const SERVER_FIELDS = Object.freeze({ rating: { avg: null, count: 0 }, acceptance: { offered: 0, accepted: 0, declined: 0, expired: 0 }, lastOfferedAt: null });
const EDITABLE = ["status", "serviceAreas", "vehicleIds", "skills", "partnerId", "maxJobsPerDay", "homeBase", "phoneVerified"];

class ProfileError extends Error {
  constructor(code, message) { super(code); this.code = code; this.publicMessage = message; }
}

function uniqueList(v, allowed, field) {
  if (!Array.isArray(v)) throw new ProfileError("invalid-argument", field + " must be a list.");
  if (v.length > 20) throw new ProfileError("invalid-argument", field + " has too many entries.");
  const out = [];
  for (const x of v) {
    if (typeof x !== "string" || !allowed.includes(x)) throw new ProfileError("invalid-argument", "Unknown " + field + " value: " + String(x).slice(0, 40));
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

/** Validate an admin patch. Unknown keys are rejected (no field injection). */
function validatePatch(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProfileError("invalid-argument", "Profile data is required.");
  const unknown = Object.keys(raw).filter((k) => !EDITABLE.includes(k));
  if (unknown.length) throw new ProfileError("invalid-argument", "Field(s) not allowed: " + unknown.join(", ").slice(0, 120));
  const out = {};
  if ("status" in raw) {
    if (!STATUSES.includes(raw.status)) throw new ProfileError("invalid-argument", "status must be active, suspended or onboarding.");
    out.status = raw.status;
  }
  if ("serviceAreas" in raw) {
    out.serviceAreas = uniqueList(raw.serviceAreas, SERVICE_AREAS, "serviceAreas");
    if (!out.serviceAreas.length) throw new ProfileError("invalid-argument", "At least one service area is required.");
  }
  if ("vehicleIds" in raw) out.vehicleIds = uniqueList(raw.vehicleIds, VEHICLE_IDS, "vehicleIds");
  if ("skills" in raw) {
    out.skills = uniqueList(raw.skills, SKILLS, "skills");
    if (!out.skills.length) throw new ProfileError("invalid-argument", "At least one skill is required.");
  }
  if ("partnerId" in raw) {
    if (raw.partnerId !== null && (typeof raw.partnerId !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(raw.partnerId))) throw new ProfileError("invalid-argument", "partnerId is invalid.");
    out.partnerId = raw.partnerId;
  }
  if ("maxJobsPerDay" in raw) {
    if (!Number.isInteger(raw.maxJobsPerDay) || raw.maxJobsPerDay < 1 || raw.maxJobsPerDay > 10) throw new ProfileError("invalid-argument", "maxJobsPerDay must be 1–10.");
    out.maxJobsPerDay = raw.maxJobsPerDay;
  }
  if ("homeBase" in raw) {
    const h = raw.homeBase;
    if (h === null) out.homeBase = null;
    else {
      if (!h || typeof h !== "object" || Array.isArray(h) || Object.keys(h).some((k) => !["lat", "lng"].includes(k))) throw new ProfileError("invalid-argument", "homeBase must be { lat, lng }.");
      if (typeof h.lat !== "number" || typeof h.lng !== "number" || !(h.lat >= -90 && h.lat <= 90) || !(h.lng >= -180 && h.lng <= 180)) throw new ProfileError("invalid-argument", "homeBase coordinates are invalid.");
      out.homeBase = { lat: h.lat, lng: h.lng, geohash: encodeGeohash(h.lat, h.lng, 7) };
    }
  }
  if ("phoneVerified" in raw) {
    if (typeof raw.phoneVerified !== "boolean") throw new ProfileError("invalid-argument", "phoneVerified must be true/false.");
    out.phoneVerified = raw.phoneVerified;
  }
  return out;
}

const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function encodeGeohash(lat, lng, precision) {
  let idx = 0, bit = 0, even = true, hash = "";
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  while (hash.length < (precision || 7)) {
    if (even) { const m = (lngMin + lngMax) / 2; if (lng >= m) { idx = idx * 2 + 1; lngMin = m; } else { idx *= 2; lngMax = m; } }
    else { const m = (latMin + latMax) / 2; if (lat >= m) { idx = idx * 2 + 1; latMin = m; } else { idx *= 2; latMax = m; } }
    even = !even;
    if (++bit === 5) { hash += B32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

/** Full profile for a NEW document: defaults + server fields + validated patch. */
function newProfile(patch, ts) {
  return Object.assign({}, DEFAULTS, { serviceAreas: [...DEFAULTS.serviceAreas], skills: [...DEFAULTS.skills], vehicleIds: [] },
    JSON.parse(JSON.stringify(SERVER_FIELDS)), patch, { createdAt: ts, updatedAt: ts });
}

/**
 * Callable core. data: { uid, profile: { …editable fields } }
 * deps: { db, serverTimestamp(), isAdmin(context), logger }
 */
async function handleUpsert(data, context, deps) {
  const caller = context && context.auth && context.auth.uid;
  if (!caller) throw new ProfileError("unauthenticated", "Please sign in.");
  if (!(await deps.isAdmin(context))) throw new ProfileError("permission-denied", "Only admins can manage driver profiles.");
  const uid = data && data.uid;
  if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw new ProfileError("invalid-argument", "Invalid driver.");
  const patch = validatePatch(data && data.profile);
  const db = deps.db;
  const userRef = db.collection("users").doc(uid);
  const profRef = db.collection("driverProfiles").doc(uid);
  const out = await db.runTransaction(async (tx) => {
    const u = await tx.get(userRef);
    if (!u.exists || (u.data() || {}).role !== "driver") return { error: ["failed-precondition", "That account is not a driver."] };
    const p = await tx.get(profRef);
    if (p.exists) {
      tx.update(profRef, Object.assign({}, patch, { updatedAt: deps.serverTimestamp() }));
      return { created: false };
    }
    tx.set(profRef, newProfile(patch, deps.serverTimestamp()));
    return { created: true };
  });
  if (out.error) throw new ProfileError(out.error[0], out.error[1]);
  (deps.logger || console).info("driver_profile_upserted", { uid, by: caller, created: out.created, fields: Object.keys(patch) });
  return { ok: true, created: out.created };
}

module.exports = { handleUpsert, validatePatch, newProfile, encodeGeohash, ProfileError, STATUSES, SERVICE_AREAS, SKILLS, VEHICLE_IDS, DEFAULTS, SERVER_FIELDS };
