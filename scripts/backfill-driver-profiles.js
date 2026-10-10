#!/usr/bin/env node
/**
 * PackZen — Phase 2A backfill: users/{uid} (role "driver") → driverProfiles/{uid} + driverPresence/{uid}
 *
 *   DRY RUN (default, read-only):  node scripts/backfill-driver-profiles.js --project packzen-e7539
 *   APPLY:                         node scripts/backfill-driver-profiles.js --project packzen-e7539 --apply
 *
 * Needs Application Default Credentials (gcloud auth application-default login)
 * and `npm ci` in functions/ (firebase-admin is loaded from there).
 *
 * Safe to run repeatedly:
 *   • only MISSING documents are created (Firestore create() → never overwrites);
 *   • existing profiles/presence are left untouched;
 *   • bookings and users/{uid} are never modified.
 * Existing drivers get status "active" (they already work today), skills ["moving"]
 * and NO vehicles — set vehicles per driver in admin afterwards (shadow mode
 * excludes moving jobs for drivers without vehicles; manual assignment still works).
 * Output contains uids and counts only — no names, phones or emails.
 */
"use strict";

const path = require("path");
const dp = require(path.join(__dirname, "..", "functions", "driver-profile.js"));

function toMs(v) { if (!v) return null; if (typeof v.toMillis === "function") return v.toMillis(); const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; }

/** Pure planner: what would be created for each driver. */
function planFor(uid, user, hasProfile, hasPresence) {
  const actions = [];
  if (!hasProfile) actions.push({ type: "createProfile", uid });
  if (!hasPresence && (validCoords(user) || typeof user.isOnline === "boolean")) actions.push({ type: "createPresence", uid });
  return actions;
}

function profileDoc(ts) {
  return dp.newProfile({ status: "active", serviceAreas: ["bangalore"], skills: ["moving"], vehicleIds: [] }, ts);
}
function validCoords(u) {
  return Number.isFinite(u.lat) && Number.isFinite(u.lng) && Math.abs(u.lat) <= 90 && Math.abs(u.lng) <= 180;
}
function presenceDoc(user, nowMs) {
  const hasCoords = validCoords(user);
  const doc = { online: user.isOnline === true, updatedAt: new Date(toMs(user.locationUpdatedAt) || nowMs), appVersion: "backfill-2a" };
  if (hasCoords) Object.assign(doc, { lat: user.lat, lng: user.lng, geohash: dp.encodeGeohash(user.lat, user.lng, 7) });
  return doc;
}

/** deps: { db, apply, now(), serverTimestamp(), log(line) } → summary */
async function run(deps) {
  const { db, apply } = deps; const log = deps.log || console.log;
  const users = await db.collection("users").where("role", "==", "driver").get();
  const summary = { drivers: users.docs.length, profilesToCreate: 0, presenceToCreate: 0, created: 0, skippedExisting: 0, raced: 0 };
  for (const u of users.docs) {
    const uid = u.id, user = u.data() || {};
    const [p, pr] = await Promise.all([db.collection("driverProfiles").doc(uid).get(), db.collection("driverPresence").doc(uid).get()]);
    const actions = planFor(uid, user, p.exists, pr.exists);
    if (!actions.length) { summary.skippedExisting++; log(`  = ${uid}: profile and presence already present`); continue; }
    for (const a of actions) {
      if (a.type === "createProfile") summary.profilesToCreate++; else summary.presenceToCreate++;
      log(`  ${apply ? "+" : "~"} ${uid}: ${a.type}`);
      if (!apply) continue;
      const ref = db.collection(a.type === "createProfile" ? "driverProfiles" : "driverPresence").doc(uid);
      const data = a.type === "createProfile" ? profileDoc(deps.serverTimestamp()) : presenceDoc(user, deps.now());
      try { await ref.create(data); summary.created++; }
      catch (e) {
        const exists = e && (e.code === 6 || e.code === "already-exists" || /ALREADY_EXISTS|already exists/i.test(String(e.message || "")));
        if (exists) { summary.raced++; log(`    (already created concurrently — left untouched)`); } else throw e;
      }
    }
  }
  log(`\n${apply ? "APPLIED" : "DRY RUN — nothing written"}: ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { run, planFor, profileDoc, presenceDoc };

if (require.main === module) {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--project");
  const projectId = pi >= 0 ? args[pi + 1] : null;
  if (!projectId) { console.error("Usage: node scripts/backfill-driver-profiles.js --project <id> [--apply]"); process.exit(2); }
  const admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
  admin.initializeApp({ projectId });
  const apply = args.includes("--apply");
  console.log(`PackZen driver backfill — project ${projectId} — ${apply ? "APPLY" : "DRY RUN"}`);
  run({ db: admin.firestore(), apply, now: () => Date.now(), serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp() })
    .then(() => process.exit(0)).catch((e) => { console.error("Backfill failed:", e && e.message); process.exit(1); });
}
