/**
 * PackZen — Firestore security rules regression suite.
 *
 * Runs ONLY against the local Firestore emulator under the throwaway
 * project id "demo-packzen" (demo-* projects cannot reach production).
 *
 *   cd tests/rules && npm install && npm test
 *
 * Every case asserts the CURRENT intended behaviour. Cases marked
 * knownOpen document behaviour that is still unsafe/broken and is scheduled
 * for a later release — they assert today's behaviour so any change to them
 * is deliberate. The suite exits non-zero on any mismatch.
 */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, serverTimestamp } from "firebase/firestore";

const RULES_PATH = new URL("../../firestore.rules", import.meta.url);

const env = await initializeTestEnvironment({
  projectId: "demo-packzen",
  firestore: { rules: readFileSync(RULES_PATH, "utf8"), host: "127.0.0.1", port: 8080 },
});

const booking = (extra) => ({ customerUid: "cust1", status: "confirmed", total: 5000, paid: 0, ...extra });
const assigned = (extra) => booking({ status: "assigned", driverUid: "drv1", deliveryOtp: "1234", ...extra });

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const seed = (path, data) => setDoc(doc(db, path), data);
  await seed("users/cust1", { role: "customer", name: "C1", phone: "+919800000001", referralCredits: 0 });
  await seed("users/cust2", { role: "customer", name: "C2" });
  await seed("users/drv1", { role: "driver", name: "D1", isOnline: false });
  await seed("users/drv2", { role: "driver", name: "D2" });
  await seed("users/adv1", { role: "advisor", name: "A1" });
  await seed("partners/ptr1", { verificationStatus: "approved", walletBalance: 0 });
  await seed("partners/ptrPending", { verificationStatus: "pending", walletBalance: 0 });
  // Customer bookings in each status (each test gets its own document).
  for (const s of ["pending", "confirmed", "assigned", "packing", "transit", "delivered", "cancelled"]) {
    await seed(`bookings/c_cancel_${s}`, booking({ status: s }));
    await seed(`bookings/c_resched_${s}`, booking({ status: s }));
  }
  for (const id of ["c_selfconfirm", "c_reopen", "c_total", "c_read", "c_rate", "c_damage", "c_resched_pending_nostatus"])
    await seed(`bookings/${id}`, booking({ status: id === "c_selfconfirm" || id === "c_resched_pending_nostatus" ? "pending" : id === "c_reopen" ? "cancelled" : id === "c_rate" || id === "c_damage" ? "delivered" : "confirmed" }));
  await seed("bookings/c_resched_confirmed_legacy", booking({ status: "confirmed" }));
  await seed("bookings/other", booking({ customerUid: "cust2", total: 9000 }));
  await seed("bookings/paidNoUid", { paymentId: "pay_1", status: "confirmed", total: 500 });
  // Driver bookings.
  for (const id of ["d_pack", "d_total", "d_reassign", "d_skip", "d_read", "d_otp", "d_unassigned"]) await seed(`bookings/${id}`, assigned());
  for (const id of ["d_transit", "d_back"]) await seed(`bookings/${id}`, assigned({ status: "packing" }));
  for (const id of ["d_deliver", "d_loc", "d_photos", "d_back2"]) await seed(`bookings/${id}`, assigned({ status: "transit" }));
  // Phase 1 completion rules: who may move a booking INTO "delivered".
  await seed("bookings/d_transit_otpfield", assigned({ status: "packing" }));
  await seed("bookings/d_otp_write", assigned({ status: "transit" }));
  await seed("bookings/c_deliver", booking({ status: "transit", driverUid: "drv1" }));
  await seed("bookings/v_deliver", booking({ customerUid: "cust2", status: "transit", driverUid: "drv1" }));
  await seed("bookings/a_deliver", booking({ customerUid: "cust2", status: "transit", driverUid: "drv1" }));
  await seed("bookings/a_edit_delivered", booking({ customerUid: "cust2", status: "delivered" }));
  await seed("bookings/s_complete", booking({ customerUid: "cust2", status: "transit", driverUid: "drv1" }));
  await seed("bookingSecrets/s_complete", { nonce: "n", attempts: 0, lockedUntil: 0 });
  // Advisor / partner / misc.
  for (const id of ["v_assign", "v_total", "v_owner"]) await seed(`bookings/${id}`, booking({ customerUid: "cust2" }));
  await seed("bookings/partnerJob", booking({ customerUid: "cust2", assignedPartnerId: "ptr1", partnerStatus: "offered" }));
  await seed("bookings/a_total", booking({ customerUid: "cust2" }));
  await seed("bookings/a_delete", booking({ customerUid: "cust2" }));
  await seed("chats/c_read", {});
  await seed("parcelBookings/p_own", { customerUid: "cust1", status: "confirmed", totalFare: 300 });
  await seed("parcelBookings/p_other", { customerUid: "cust2", status: "confirmed", totalFare: 300 });
  await seed("pendingPayments/order_1", { amount: 500 });
  await seed("pendingServicePayments/order_2", { amount: 500, uid: "cust1" });
  await seed("notificationLogs/log1", { status: "sent" });
  await seed("smsQueue/sms1", { status: "failed" });
  await seed("services/svc1", { name: "S", basePrice: 100, isActive: true });
});

const fs = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const cust = fs("cust1", "c1@example.com");
const cust2 = fs("cust2", "c2@example.com");
const drv = fs("drv1", "d1@example.com");
const drv2 = fs("drv2", "d2@example.com");
const adv = fs("adv1", "a1@example.com");
const ptr = fs("ptr1", "p1@example.com");
const anon = env.unauthenticatedContext().firestore();
const admin = fs("admin1", "azharahmedm786@gmail.com", true);
const now = new Date();

const results = [];
async function t(id, label, expectAllowed, fn, opts = {}) {
  let allowed, error;
  try { await fn(); allowed = true; } catch (e) { allowed = false; error = e.code || e.message; }
  const pass = allowed === expectAllowed;
  results.push({ id, label, expected: expectAllowed ? "allow" : "deny", actual: allowed ? "allow" : "deny", pass, knownOpen: !!opts.knownOpen, error });
}

/* ── Admin authorization (I-01) ─────────────────────────────────────── */
const unverifiedRemoved = fs("att1", "admin@packzen.com", false);
await t("A1", "Unverified admin@packzen.com reads another customer's booking", false, () => getDoc(doc(unverifiedRemoved, "bookings/other")));
await t("A2", "Unverified admin@packzen.com lists all bookings", false, () => getDocs(collection(unverifiedRemoved, "bookings")));
await t("A3", "Unverified admin@packzen.com changes a booking total", false, () => updateDoc(doc(unverifiedRemoved, "bookings/other"), { total: 1 }));
await t("A4", "Unverified admin@packzen.com reads all users", false, () => getDocs(collection(unverifiedRemoved, "users")));
await t("A5", "Unverified admin@packzen.com writes a catalog price", false, () => setDoc(doc(unverifiedRemoved, "services/svc1"), { basePrice: 1 }));
await t("A6", "VERIFIED admin@packzen.com (removed from list) reads bookings", false, () => getDocs(collection(fs("att2", "admin@packzen.com", true), "bookings")));
await t("A7", "VERIFIED support@packzenblr.in (removed from list) reads bookings", false, () => getDocs(collection(fs("att3", "support@packzenblr.in", true), "bookings")));
await t("A8", "UNVERIFIED approved email azharahmedm786@gmail.com reads bookings", false, () => getDocs(collection(fs("att4", "azharahmedm786@gmail.com", false), "bookings")));
for (const [i, email] of ["azharahmedm786@gmail.com", "azharahmednaz@gmail.com", "moveeasyblr@gmail.com"].entries())
  await t(`A9.${i + 1}`, `Verified approved admin ${email} lists all bookings`, true, () => getDocs(collection(fs(`adm${i}`, email, true), "bookings")));
await t("A10", "Verified admin changes a booking total", true, () => updateDoc(doc(admin, "bookings/a_total"), { total: 4500 }));
await t("A11", "Verified admin writes a catalog price", true, () => setDoc(doc(admin, "services/svc1"), { basePrice: 120 }, { merge: true }));
await t("A12", "Verified admin reads all users", true, () => getDocs(collection(admin, "users")));
await t("A13", "Verified admin creates a driver profile (admin.html Create Driver)", true, () => setDoc(doc(admin, "users/newDriver"), { name: "N", email: "n@example.com", role: "driver", isOnline: false }));
await t("A14", "Verified admin sets own role to admin (admin.html login auto-fix)", true, () => setDoc(doc(admin, "users/admin1"), { name: "Admin", role: "admin" }));
await t("A15", "Verified admin deletes a booking", true, () => deleteDoc(doc(admin, "bookings/a_delete")));
await t("A16", "Verified admin reads/updates smsQueue (retry)", true, () => updateDoc(doc(admin, "smsQueue/sms1"), { status: "pending", retries: 0 }));

/* ── Completion: admin direct writes vs the server path (Phase 1) ────── */
await t("A17", "Verified admin sets delivered by direct Firestore write (must use adminCompleteBooking)", false, () => updateDoc(doc(admin, "bookings/a_deliver"), { status: "delivered" }));
await t("A18", "Verified admin edits other fields of an in-transit booking", true, () => updateDoc(doc(admin, "bookings/a_deliver"), { remarks: "admin note" }));
await t("A19", "Verified admin edits an already-delivered booking (status unchanged)", true, () => updateDoc(doc(admin, "bookings/a_edit_delivered"), { remarks: "post-job note" }));
await t("A20", "Verified admin creates a booking already marked delivered", false, () => addDoc(collection(admin, "bookings"), booking({ customerUid: "cust2", status: "delivered" })));
await t("A21", "Verified admin creates a normal booking", true, () => addDoc(collection(admin, "bookings"), booking({ customerUid: "cust2", status: "confirmed" })));
await t("A22", "Verified admin client reads completion secrets (server-only)", false, () => getDoc(doc(admin, "bookingSecrets/s_complete")));
await t("A23", "Driver reads completion secrets", false, () => getDoc(doc(drv, "bookingSecrets/s_complete")));
// Supported path: verifyCompletionOtp / adminCompleteBooking run with the Admin SDK (rules bypassed).
await t("A24", "Server (Admin SDK, as adminCompleteBooking) completes a booking", true, () => env.withSecurityRulesDisabled((ctx) =>
  updateDoc(doc(ctx.firestore(), "bookings/s_complete"), { status: "delivered", completionMethod: "admin_override", completionOverride: { by: "admin1", reason: "customer unreachable after delivery" } })));

/* ── Phase 2A/2B: driver profiles, presence, recommendations, legacy drivers ── */
await env.withSecurityRulesDisabled(async (ctx) => {
  const f = ctx.firestore();
  await setDoc(doc(f, "driverProfiles/drv1"), { status: "active", serviceAreas: ["bangalore"], vehicleIds: ["tata_ace"], skills: ["moving"], maxJobsPerDay: 3 });
  await setDoc(doc(f, "driverProfiles/drv2"), { status: "active", serviceAreas: ["bangalore"], vehicleIds: [], skills: ["moving"], maxJobsPerDay: 3 });
  await setDoc(doc(f, "drivers/drv1"), { name: "Legacy" });
  await setDoc(doc(f, "assignmentRecommendations/bk_rec"), { bookingId: "bk_rec", top: [] });
});
await t("P1", "Driver reads own driverProfile", true, () => getDoc(doc(drv, "driverProfiles/drv1")));
await t("P2", "Driver reads another driver's profile", false, () => getDoc(doc(drv, "driverProfiles/drv2")));
await t("P3", "Customer reads a driverProfile", false, () => getDoc(doc(cust, "driverProfiles/drv1")));
await t("P4", "Advisor reads a driverProfile", true, () => getDoc(doc(adv, "driverProfiles/drv1")));
await t("P5", "Verified admin reads a driverProfile", true, () => getDoc(doc(admin, "driverProfiles/drv1")));
await t("P6", "Driver edits own profile (vehicles)", false, () => updateDoc(doc(drv, "driverProfiles/drv1"), { vehicleIds: ["truck_22ft"] }));
await t("P7", "Admin client writes a profile directly (callable only)", false, () => setDoc(doc(admin, "driverProfiles/drv2"), { status: "active" }));
await t("P8", "Advisor writes a profile", false, () => updateDoc(doc(adv, "driverProfiles/drv1"), { status: "suspended" }));
await t("PR1", "Driver creates own presence (allowed fields, server time)", true, () => setDoc(doc(drv, "driverPresence/drv1"), { online: true, updatedAt: serverTimestamp(), appVersion: "driver-web-2a" }));
await t("PR2", "Driver updates own presence location (merge)", true, () => setDoc(doc(drv, "driverPresence/drv1"), { lat: 12.97, lng: 77.59, geohash: "tdr1v9q", updatedAt: serverTimestamp(), appVersion: "driver-web-2a" }, { merge: true }));
await t("PR3", "Driver writes another driver's presence", false, () => setDoc(doc(drv, "driverPresence/drv2"), { online: true, updatedAt: serverTimestamp() }));
await t("PR4", "Driver adds a non-allowed field to presence", false, () => setDoc(doc(drv, "driverPresence/drv1"), { online: true, rating: 5, updatedAt: serverTimestamp() }, { merge: true }));
await t("PR5", "Driver sets a client-chosen updatedAt", false, () => setDoc(doc(drv, "driverPresence/drv1"), { online: true, updatedAt: new Date(0) }, { merge: true }));
await t("PR6", "Driver writes out-of-range latitude", false, () => setDoc(doc(drv, "driverPresence/drv1"), { lat: 123, updatedAt: serverTimestamp() }, { merge: true }));
await t("PR7", "Driver writes non-boolean online", false, () => setDoc(doc(drv, "driverPresence/drv1"), { online: "yes", updatedAt: serverTimestamp() }, { merge: true }));
await t("PR8", "Customer writes a presence doc", false, () => setDoc(doc(cust, "driverPresence/cust1"), { online: true, updatedAt: serverTimestamp() }));
await t("PR9", "Customer reads driver presence", false, () => getDoc(doc(cust, "driverPresence/drv1")));
await t("PR10", "Advisor reads driver presence", true, () => getDoc(doc(adv, "driverPresence/drv1")));
await t("PR11", "Driver deletes own presence", false, () => deleteDoc(doc(drv, "driverPresence/drv1")));
await t("R1", "Advisor reads a shadow recommendation", true, () => getDoc(doc(adv, "assignmentRecommendations/bk_rec")));
await t("R2", "Driver reads a shadow recommendation", false, () => getDoc(doc(drv, "assignmentRecommendations/bk_rec")));
await t("R3", "Customer reads a shadow recommendation", false, () => getDoc(doc(cust, "assignmentRecommendations/bk_rec")));
await t("R4", "Admin client writes a recommendation", false, () => setDoc(doc(admin, "assignmentRecommendations/bk_rec"), { top: ["x"] }));
await t("L1", "Customer reads legacy drivers/{uid} (R2-22 fixed)", false, () => getDoc(doc(cust, "drivers/drv1")));
await t("L2", "Other driver reads legacy drivers/{uid}", false, () => getDoc(doc(drv2, "drivers/drv1")));
await t("L3", "Driver reads own legacy drivers/{uid}", true, () => getDoc(doc(drv, "drivers/drv1")));
await t("L4", "Advisor reads legacy drivers/{uid}", true, () => getDoc(doc(adv, "drivers/drv1")));
await t("S1x", "Driver reads a driverSchedule lock (server-only)", false, () => getDoc(doc(drv, "driverSchedule/drv1_2026-10-10")));
await t("S2x", "Admin client writes appConfig (server-only)", false, () => setDoc(doc(admin, "appConfig/assignment"), { shadowEnabled: false }));

/* ── SMS / WhatsApp queues (I-04) ───────────────────────────────────── */
await t("Q1", "Customer queues an SMS", false, () => addDoc(collection(cust, "smsQueue"), { mobile: "919999999999", message: "x", status: "pending" }));
await t("Q2", "Customer queues a WhatsApp message", false, () => addDoc(collection(cust, "whatsappQueue"), { mobile: "919999999999", message: "x", status: "pending" }));
await t("Q3", "Driver queues an SMS", false, () => addDoc(collection(drv, "smsQueue"), { mobile: "919999999999", message: "x", status: "pending" }));
await t("Q4", "Admin client queues an SMS (server-only now)", false, () => addDoc(collection(admin, "smsQueue"), { mobile: "919999999999", message: "x", status: "pending" }));

/* ── Bookings: customer (I-08) ──────────────────────────────────────── */
const cancelPayload = { status: "cancelled", cancelReason: "Plans changed", cancelledAt: now, cancelledBy: "customer" };
await t("B1", "Customer creates a booking directly", false, () => addDoc(collection(cust, "bookings"), booking()));
for (const s of ["pending", "confirmed", "assigned"])
  await t(`B2.${s}`, `Customer cancels own ${s} booking (exact client payload)`, true, () => updateDoc(doc(cust, `bookings/c_cancel_${s}`), cancelPayload));
for (const s of ["packing", "transit", "delivered", "cancelled"])
  await t(`B3.${s}`, `Customer cancels own ${s} booking`, false, () => updateDoc(doc(cust, `bookings/c_cancel_${s}`), cancelPayload));
await t("B4", "Customer re-opens own CANCELLED booking", false, () => updateDoc(doc(cust, "bookings/c_reopen"), { status: "confirmed" }));
await t("B5", "Customer self-confirms own PENDING quote booking", false, () => updateDoc(doc(cust, "bookings/c_selfconfirm"), { status: "confirmed" }));
// confirmReschedule() payload (script.js) — status is not written.
const reschedPayload = { date: "2030-01-15", time: "", rescheduledAt: now, rescheduledBy: "customer" };
// Payload sent by browsers still running the previous script.js (cached during rollout).
const legacyReschedPayload = { ...reschedPayload, status: "confirmed" };
await t("B6", "Customer reschedules own CONFIRMED booking (exact client payload)", true, () => updateDoc(doc(cust, "bookings/c_resched_confirmed"), reschedPayload));
await t("B6.legacy", "Customer reschedules own CONFIRMED booking (legacy payload incl. status:'confirmed')", true, () => updateDoc(doc(cust, "bookings/c_resched_confirmed_legacy"), legacyReschedPayload));
await t("B7", "Customer reschedules own PENDING booking with legacy payload (status → confirmed)", false, () => updateDoc(doc(cust, "bookings/c_resched_pending"), legacyReschedPayload));
await t("B8", "Customer reschedules own PENDING booking (exact client payload)", true, () => updateDoc(doc(cust, "bookings/c_resched_pending_nostatus"), reschedPayload));
for (const s of ["assigned", "packing", "transit", "delivered", "cancelled"])
  await t(`B9.${s}`, `Customer reschedules own ${s} booking (exact client payload)`, false, () => updateDoc(doc(cust, `bookings/c_resched_${s}`), reschedPayload));
await t("B10", "Customer rates driver on delivered booking", true, () => updateDoc(doc(cust, "bookings/c_rate"), { driverRating: 5, driverFeedback: "Good", ratedAt: now }));
await t("B11", "Customer flags damage claim on delivered booking", true, () => updateDoc(doc(cust, "bookings/c_damage"), { damageClaimed: true, damageClaimId: "dc1", damageClaimedAt: now }));
await t("B12", "Customer changes own booking total", false, () => updateDoc(doc(cust, "bookings/c_total"), { total: 1 }));
await t("B13", "Customer reads own booking", true, () => getDoc(doc(cust, "bookings/c_read")));
await t("B14", "Customer reads another customer's booking", false, () => getDoc(doc(cust, "bookings/other")));
await t("B15", "Customer lists own bookings (My Bookings query)", true, () => getDocs(query(collection(cust, "bookings"), where("customerUid", "==", "cust1"))));
await t("B17", "Customer sets own in-transit booking to delivered", false, () => updateDoc(doc(cust, "bookings/c_deliver"), { status: "delivered" }));
await t("B18", "Customer creates a booking already marked delivered", false, () => addDoc(collection(cust, "bookings"), booking({ status: "delivered" })));
await t("B19", "Customer reads completion secrets", false, () => getDoc(doc(cust, "bookingSecrets/s_complete")));
await t("B16", "Customer reads a paid booking stored without customerUid (I-06, Release 2)", false, () => getDoc(doc(cust, "bookings/paidNoUid")), { knownOpen: true });

/* ── Bookings: driver (I-08) ────────────────────────────────────────── */
await t("D1", "Driver starts job: assigned → packing", true, () => updateDoc(doc(drv, "bookings/d_pack"), { status: "packing" }));
// Phase 1: the completion code is server-side; driver.html no longer writes deliveryOtp.
await t("D2", "Driver packing → transit without an OTP field (driver.html payload)", true, () => updateDoc(doc(drv, "bookings/d_transit"), { status: "transit" }));
await t("D2b", "Driver packing → transit writing deliveryOtp (old payload)", false, () => updateDoc(doc(drv, "bookings/d_transit_otpfield"), { status: "transit", deliveryOtp: "4321" }));
await t("D3", "Driver transit → delivered by direct write (must use verifyCompletionOtp)", false, () => updateDoc(doc(drv, "bookings/d_deliver"), { status: "delivered" }));
await t("D3b", "Driver writes deliveryOtp without changing status", false, () => updateDoc(doc(drv, "bookings/d_otp_write"), { deliveryOtp: "0000" }));
await t("D4", "Driver location update (status unchanged)", true, () => updateDoc(doc(drv, "bookings/d_loc"), { driverLat: 12.9, driverLng: 77.6, locationUpdatedAt: now }));
await t("D5", "Driver saves delivery photos", true, () => updateDoc(doc(drv, "bookings/d_photos"), { deliveryPhotos: ["data:x"], deliveryUploadedAt: now }));
await t("D6", "Driver changes total/paid", false, () => updateDoc(doc(drv, "bookings/d_total"), { total: 1, paid: 1 }));
await t("D7", "Driver reassigns driverUid/customerUid", false, () => updateDoc(doc(drv, "bookings/d_reassign"), { driverUid: "drv2", customerUid: "cust2" }));
await t("D8", "Driver skips assigned → delivered", false, () => updateDoc(doc(drv, "bookings/d_skip"), { status: "delivered" }));
await t("D9", "Driver moves status backwards packing → assigned", false, () => updateDoc(doc(drv, "bookings/d_back"), { status: "assigned" }));
await t("D10", "Driver sets status to cancelled", false, () => updateDoc(doc(drv, "bookings/d_back2"), { status: "cancelled" }));
await t("D11", "Driver reads assigned booking", true, () => getDoc(doc(drv, "bookings/d_read")));
await t("D12", "Unassigned driver reads someone else's booking", false, () => getDoc(doc(drv2, "bookings/d_unassigned")));
await t("D13", "Unassigned driver updates someone else's booking", false, () => updateDoc(doc(drv2, "bookings/d_unassigned"), { status: "packing" }));
await t("D14", "Driver lists own active jobs (driver.html query)", true, () => getDocs(query(collection(drv, "bookings"), where("driverUid", "==", "drv1"), where("status", "in", ["assigned", "packing", "transit"]))));
await t("D15", "Driver can read deliveryOtp on assigned booking (I-16, later release)", true, () => getDoc(doc(drv, "bookings/d_otp")), { knownOpen: true });

/* ── Bookings: advisor ──────────────────────────────────────────────── */
await t("V1", "Advisor assigns driver (advisor-dashboard-patch.js payload)", true, () => updateDoc(doc(adv, "bookings/v_assign"), { driverUid: "drv1", driverName: "D1", driverPhone: "", status: "assigned" }));
await t("V2", "Advisor changes total/paid", false, () => updateDoc(doc(adv, "bookings/v_total"), { total: 1, paid: 99999 }));
await t("V3", "Advisor changes customerUid/paymentId", false, () => updateDoc(doc(adv, "bookings/v_owner"), { customerUid: "cust1", paymentId: "pay_x" }));
await t("V4", "Advisor creates a walk-in booking", true, () => addDoc(collection(adv, "bookings"), { customerName: "Walk-in", total: 3000, paid: 0, status: "confirmed", source: "advisor" }));
await t("V8", "Advisor sets a booking to delivered", false, () => updateDoc(doc(adv, "bookings/v_deliver"), { status: "delivered" }));
await t("V9", "Advisor creates a booking already marked delivered", false, () => addDoc(collection(adv, "bookings"), { customerName: "Walk-in", total: 3000, paid: 0, status: "delivered", source: "advisor" }));
await t("V10", "Advisor reads completion secrets", false, () => getDoc(doc(adv, "bookingSecrets/s_complete")));
await t("V5", "Advisor reads all bookings", true, () => getDocs(collection(adv, "bookings")));
await t("V6", "Advisor reads all users", true, () => getDocs(collection(adv, "users")));
await t("V7", "Advisor sets driver currentBooking", true, () => updateDoc(doc(adv, "users/drv1"), { currentBooking: "v_assign" }));

/* ── Users (I-22 subset) ────────────────────────────────────────────── */
await t("U1", "Customer sets own role to admin", false, () => updateDoc(doc(cust, "users/cust1"), { role: "admin" }));
await t("U2", "Customer sets own referralCredits", false, () => updateDoc(doc(cust, "users/cust1"), { referralCredits: 99999 }));
await t("U3", "Customer sets own phoneVerified", false, () => updateDoc(doc(cust, "users/cust1"), { phoneVerified: true }));
await t("U4", "Customer sets own referralCount / referredBy / referralCreditApplied", false, () => updateDoc(doc(cust, "users/cust1"), { referralCount: 50, referredBy: "X", referralCreditApplied: 500 }));
await t("U5", "Customer updates name / phone / prefs / lastLoginAt", true, () => updateDoc(doc(cust, "users/cust1"), { name: "C One", phone: "9800000002", prefEmail: false, prefSMS: true, lastLoginAt: now }));
await t("U6", "Customer writes emailVerified:true (email verification flow)", true, () => updateDoc(doc(cust, "users/cust1"), { emailVerified: true }));
await t("U7", "Customer writes email (email change flow)", true, () => updateDoc(doc(cust, "users/cust1"), { email: "new@example.com" }));
await t("U8", "New account creates own profile carrying referralCredits", false, () => setDoc(doc(fs("newU1", "n1@example.com"), "users/newU1"), { name: "N", role: "customer", referralCredits: 5000 }));
await t("U9", "New account creates own plain customer profile", true, () => setDoc(doc(fs("newU2", "n2@example.com"), "users/newU2"), { name: "N", role: "customer" }));
await t("U10", "Customer reads another user's profile", false, () => getDoc(doc(cust, "users/cust2")));
await t("U11", "Driver updates own isOnline / location", true, () => updateDoc(doc(drv, "users/drv1"), { isOnline: true, lat: 12.9, lng: 77.6, locationUpdatedAt: now }));

/* ── Parcels (I-11) ─────────────────────────────────────────────────── */
await t("P1", "Customer creates a 'paid' ₹1 parcel booking", false, () => setDoc(doc(cust, "parcelBookings/p_fake"), { customerUid: "cust1", paymentStatus: "success", totalFare: 1, status: "confirmed" }));
await t("P2", "Customer updates own parcel fare/status", false, () => updateDoc(doc(cust, "parcelBookings/p_own"), { totalFare: 1, status: "delivered" }));
await t("P3", "Driver updates any parcel", false, () => updateDoc(doc(drv2, "parcelBookings/p_other"), { totalFare: 1 }));
await t("P4", "Driver reads any parcel", false, () => getDoc(doc(drv2, "parcelBookings/p_other")));
await t("P5", "Customer reads own parcel", true, () => getDoc(doc(cust, "parcelBookings/p_own")));
await t("P6", "Customer writes a parcelTransactions record", false, () => addDoc(collection(cust, "parcelTransactions"), { customerUid: "cust1", amount: 1, status: "success" }));
await t("P7", "Admin creates a parcel booking", true, () => setDoc(doc(admin, "parcelBookings/p_admin"), { customerUid: "cust2", status: "confirmed" }));

/* ── Leads / server-only / catalog ──────────────────────────────────── */
await t("L1", "Unauthenticated visitor creates a lead", false, () => addDoc(collection(anon, "leads"), { x: 1 }));
await t("S1", "Customer reads pendingPayments", false, () => getDoc(doc(cust, "pendingPayments/order_1")));
await t("S2", "Customer writes pendingPayments", false, () => setDoc(doc(cust, "pendingPayments/order_x"), { amount: 1 }));
await t("S3", "Customer reads pendingServicePayments", false, () => getDoc(doc(cust, "pendingServicePayments/order_2")));
await t("S4", "Customer reads notificationLogs", false, () => getDoc(doc(cust, "notificationLogs/log1")));
await t("C1", "Unauthenticated visitor reads the service catalog", true, () => getDocs(collection(anon, "services")));
await t("C2", "Customer writes a catalog price", false, () => setDoc(doc(cust, "services/svc1"), { basePrice: 1 }));

/* ── Unchanged flows that must keep working ─────────────────────────── */
await t("K1", "Customer files a cancel request", true, () => addDoc(collection(cust, "cancelRequests"), { bookingDocId: "c_cancel_confirmed", reason: "x", customerUid: "cust1", createdAt: now, resolved: false }));
await t("K2", "Customer files a damage claim", true, () => addDoc(collection(cust, "damageClaims"), { bookingDocId: "c_damage", customerUid: "cust1", damageType: "scratch" }));
await t("K3", "Customer posts a review", true, () => addDoc(collection(cust, "reviews"), { name: "C1", text: "Good", rating: 5 }));
await t("K4", "Customer saves a quote", true, () => addDoc(collection(cust, "quotes"), { uid: "cust1", total: 3000 }));
await t("K5", "Unauthenticated account-deletion request", true, () => addDoc(collection(anon, "accountDeletionRequests"), { requestId: "r1", firstName: "a", lastName: "b", email: "a@example.com", phone: "1", status: "Pending", createdAt: 1 }));
await t("K6", "Customer posts a chat message on own booking", true, () => addDoc(collection(cust, "chats/c_read/messages"), { text: "hi", senderUid: "cust1" }));
await t("K7", "Partner registration creates a pending partner doc", true, () => setDoc(doc(fs("ptrNew", "pn@example.com", false), "partners/ptrNew"), { verificationStatus: "pending", walletBalance: 0, pendingEarnings: 0, totalEarnings: 0 }));
await t("K8", "Partner self-approves KYC", false, () => updateDoc(doc(fs("ptrPending", "pp@example.com"), "partners/ptrPending"), { verificationStatus: "approved" }));
await t("K9", "Customer creates a driverRating", true, () => addDoc(collection(cust, "driverRatings"), { customerUid: "cust1", driverUid: "drv1", rating: 5 }));

/* ── Known open — scheduled for later releases (assert current behaviour) ── */
await t("O1", "Approved partner reads booking assigned to them (I-15)", false, () => getDoc(doc(ptr, "bookings/partnerJob")), { knownOpen: true });
await t("O2", "Approved partner accepts booking (I-15)", false, () => updateDoc(doc(ptr, "bookings/partnerJob"), { partnerStatus: "accepted" }), { knownOpen: true });
await t("O3", "Partner reads own notifications subcollection (I-15)", false, () => getDocs(collection(ptr, "partners/ptr1/notifications")), { knownOpen: true });
await t("O4", "Partner creates support ticket (I-15)", false, () => addDoc(collection(ptr, "supportTickets"), { partnerId: "ptr1" }), { knownOpen: true });
await t("O5", "Partner sets own completedJobs/rating (I-22)", true, () => updateDoc(doc(ptr, "partners/ptr1"), { completedJobs: 999, rating: 5 }), { knownOpen: true });
await t("O6", "Customer saves address (I-23)", false, () => addDoc(collection(cust, "users/cust1/addresses"), { address: "x" }), { knownOpen: true });
await t("O7", "Review with any name, no booking link (I-24)", true, () => addDoc(collection(cust2, "reviews"), { name: "Fake", text: "x", rating: 1 }), { knownOpen: true });
await t("O8", "Chat message spoofing sender 'admin' (I-24)", true, () => addDoc(collection(cust, "chats/c_read/messages"), { sender: "admin", text: "pay on UPI" }), { knownOpen: true });
await t("O9", "Any signed-in user reads drivers collection (I-25)", true, () => getDocs(collection(cust, "drivers")), { knownOpen: true });
await t("O10", "Any signed-in user lists promo codes (I-25)", true, () => getDocs(collection(cust, "promos")), { knownOpen: true });
await t("O11", "Cancel request referencing another customer's booking (I-40)", true, () => addDoc(collection(cust, "cancelRequests"), { customerUid: "cust1", bookingDocId: "other", reason: "x" }), { knownOpen: true });

await env.cleanup();

/* ── Report ─────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.pass);
for (const r of results) {
  const tag = r.pass ? (r.knownOpen ? "PASS (known open)" : "PASS") : "FAIL";
  console.log(`${tag.padEnd(18)} ${r.id.padEnd(9)} expect=${r.expected.padEnd(5)} actual=${r.actual.padEnd(5)} ${r.label}`);
}
console.log(`\n${results.length} cases, ${results.length - failed.length} passed, ${failed.length} failed, ${results.filter((r) => r.knownOpen).length} known-open documented.`);
if (failed.length) {
  console.error("\nFAILURES:\n" + failed.map((r) => `  ${r.id}: ${r.label} (expected ${r.expected}, got ${r.actual}${r.error ? ", " + r.error : ""})`).join("\n"));
  process.exit(1);
}
