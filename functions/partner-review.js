/**
 * PackZen — partner applications → working crew (unified worker system).
 *
 * Partners register on partner-register.html (partners/{uid}, status "pending").
 * An admin reviews them here. APPROVE turns the applicant into a working crew member
 * in the system that already runs jobs:
 *   users/{uid}.role = "driver"          → can sign in to driver.html (job offers, OTP, earnings)
 *   driverProfiles/{uid} (status active)  → eligible for auto-assignment by vehicle + skills
 *   partners/{uid}.verificationStatus = "approved"
 * REJECT records a reason the applicant sees. Both send SMS/email.
 * Admin-only (staffCallable + explicit admin check).
 */
"use strict";
const driverProfile = require("./driver-profile");

class ReviewError extends Error { constructor(code, msg) { super(msg); this.code = code; this.publicMessage = msg; } }

// partner-register vehicle types → pricing-engine vehicle ids
const VEHICLE_MAP = { tata_ace: "tata_ace", mini_truck: "tata_ace", tempo: "tata_ace", "14ft_truck": "truck_14ft", "17ft_truck": "truck_17ft", "22ft_truck": "truck_22ft" };
const DEFAULT_SKILLS = { packers_movers: ["moving", "packing", "assembly"], individual_mover: ["moving"], vehicle_owner: ["moving"], loading_team: ["moving", "packing"],
  parcel_rider: ["parcel"], technician: [] };

function profileFromApplication(p) {
  const vehicleIds = [];
  const v = VEHICLE_MAP[p.vehicleType]; if (v && driverProfile.VEHICLE_IDS.includes(v)) vehicleIds.push(v);
  let skills = Array.isArray(p.skills) && p.skills.length ? p.skills : (DEFAULT_SKILLS[p.businessType] || ["moving"]);
  if (p.vehicleType === "two_wheeler" && !skills.includes("parcel")) skills = skills.concat("parcel");
  skills = [...new Set(skills)].filter((s) => driverProfile.SKILLS.includes(s));
  if (!skills.length) skills = ["moving"];
  return { status: "active", vehicleIds, skills, serviceAreas: ["bangalore"], maxJobsPerDay: 3, partnerId: p.uid || null };
}

/** deps: { db, isAdmin(ctx), serverTimestamp, now, notify({phone,email,name,approved,reason}), logger } */
async function handleReview(data, context, deps) {
  const caller = context && context.auth && context.auth.uid;
  if (!caller) throw new ReviewError("unauthenticated", "Please sign in.");
  if (!(await deps.isAdmin(context))) throw new ReviewError("permission-denied", "Only admins can review partners.");
  const uid = data && data.uid;
  if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw new ReviewError("invalid-argument", "Invalid partner.");
  const decision = data && data.decision;
  if (!["approve", "reject"].includes(decision)) throw new ReviewError("invalid-argument", "Choose approve or reject.");
  const reason = typeof (data && data.reason) === "string" ? data.reason.trim().slice(0, 300) : "";
  if (decision === "reject" && reason.length < 3) throw new ReviewError("invalid-argument", "Please give a short reason for rejecting.");

  const db = deps.db;
  const pRef = db.collection("partners").doc(uid), uRef = db.collection("users").doc(uid), dRef = db.collection("driverProfiles").doc(uid);
  const out = await db.runTransaction(async (tx) => {
    const p = await tx.get(pRef);
    if (!p.exists) return { error: ["not-found", "Partner application not found."] };
    const pd = p.data() || {};
    const u = await tx.get(uRef);
    const ud = u.exists ? (u.data() || {}) : {};
    const existing = await tx.get(dRef);   // Firestore: every read must happen before the first write
    if (ud.role && !["partner", "driver", "customer"].includes(ud.role)) return { error: ["failed-precondition", "This account has a staff role and can't be a partner."] };
    if (decision === "reject") {
      tx.update(pRef, { verificationStatus: "rejected", rejectionReason: reason, reviewedBy: caller, reviewedAt: deps.serverTimestamp() });
      return { pd, approved: false };
    }
    const profile = profileFromApplication(Object.assign({ uid }, pd));
    let clean;
    try { clean = driverProfile.validatePatch(profile); }
    catch (e) { return { error: ["failed-precondition", "This application has invalid details (" + String(e && e.message || "profile").slice(0, 80) + "). Edit the partner's details and approve again."] }; }
    tx.update(pRef, { verificationStatus: "approved", rejectionReason: null, reviewedBy: caller, reviewedAt: deps.serverTimestamp() });
    tx.set(uRef, Object.assign({ role: "driver", name: pd.ownerName || pd.businessName || "", email: pd.email || ud.email || null,
      phone: String(pd.ownerPhone || "").replace(/^\+?91/, ""), partnerUid: uid, updatedAt: deps.serverTimestamp() },
      u.exists ? {} : { createdAt: deps.serverTimestamp() }), { merge: true });
    if (existing.exists) tx.update(dRef, Object.assign({}, clean, { updatedAt: deps.serverTimestamp() }));
    else tx.set(dRef, driverProfile.newProfile(clean, deps.serverTimestamp()));
    return { pd, approved: true, profile };
  });
  if (out.error) throw new ReviewError(out.error[0], out.error[1]);
  try {
    await deps.notify({ phone: String(out.pd.ownerPhone || "").replace(/^\+?91/, ""), email: out.pd.email || null,
      name: out.pd.ownerFirstName || out.pd.ownerName || "Partner", approved: out.approved, reason });
  } catch (e) { (deps.logger || console).warn("partner_notify_failed", { uid }); }
  (deps.logger || console).info("partner_reviewed", { uid, by: caller, decision });
  return { ok: true, approved: out.approved, profile: out.profile || null };
}

module.exports = { handleReview, profileFromApplication, ReviewError, VEHICLE_MAP };
