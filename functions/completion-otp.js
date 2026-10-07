/**
 * PackZen — server-side completion (delivery) OTP
 * -----------------------------------------------
 * Replaces the browser-generated OTP (I-16).
 *
 *  • The OTP is DERIVED, never stored:  otp = HMAC-SHA256(pepper, bookingId:nonce) → 4 digits.
 *    bookingSecrets/{bookingId} holds only { nonce, attempts, lockedUntil, verifiedAt }
 *    and is server-only (catch-all deny in firestore.rules). Without the pepper
 *    (Secret Manager: COMPLETION_OTP_PEPPER) the OTP cannot be computed.
 *  • The customer gets it from My Bookings (getCompletionOtp, owner only) and by
 *    email when the job goes in transit or when the driver asks for it to be resent.
 *  • The driver submits it to verifyCompletionOtp; only a correct OTP moves the
 *    booking to "delivered". firestore.rules no longer lets drivers set "delivered"
 *    or write any OTP field. Admins keep their existing override (exception path).
 *  • 5 wrong attempts → 15 min lock. Attempts are committed even on failure.
 */
"use strict";

const crypto = require("crypto");

const SECRETS = "bookingSecrets";
const BOOKINGS = "bookings";
const OTP_STATUSES = ["assigned", "packing", "transit"];
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

class OtpError extends Error {
  constructor(code, message, detail) { super(code); this.code = code; this.publicMessage = message; this.detail = detail || null; }
}

function deriveOtp(pepper, bookingId, nonce) {
  if (!pepper) throw new OtpError("failed-precondition", "Completion codes are not configured yet.", "missing pepper");
  const h = crypto.createHmac("sha256", pepper).update(String(bookingId) + ":" + String(nonce)).digest();
  return String(h.readUInt32BE(0) % 10000).padStart(4, "0");
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function validBookingId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(id); }

/** Ensure a nonce exists for the booking; returns it (transactional, idempotent). */
async function ensureNonce(deps, bookingId) {
  const ref = deps.db.collection(SECRETS).doc(bookingId);
  return deps.db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.data().nonce && !s.data().verifiedAt) return s.data().nonce;
    if (s.exists && s.data().verifiedAt) return s.data().nonce; // already used — still derivable for display
    const nonce = crypto.randomBytes(16).toString("hex");
    tx.set(ref, { nonce, attempts: 0, lockedUntil: 0, createdAt: deps.now() });
    return nonce;
  });
}

async function loadBooking(deps, bookingId) {
  const snap = await deps.db.collection(BOOKINGS).doc(bookingId).get();
  if (!snap.exists) throw new OtpError("not-found", "Booking not found.");
  return snap.data();
}

/** Customer (owner) reads the OTP for an active job. */
async function handleGetOtp(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new OtpError("unauthenticated", "Please sign in.");
  const bookingId = data && data.bookingId;
  if (!validBookingId(bookingId)) throw new OtpError("invalid-argument", "Invalid booking.");
  const b = await loadBooking(deps, bookingId);
  if (b.customerUid !== uid) throw new OtpError("permission-denied", "This booking belongs to another account.");
  if (deps.rateLimit && !(await deps.rateLimit("completionOtpView", uid)).ok) throw new OtpError("resource-exhausted", "Please try again in a little while.");
  if (!OTP_STATUSES.includes(b.status)) return { available: false, status: b.status || null };
  const nonce = await ensureNonce(deps, bookingId);
  return { available: true, otp: deriveOtp(deps.pepper, bookingId, nonce) };
}

/** Email the OTP to the customer (assigned driver or admin; also used by the transit trigger). */
async function sendOtpEmail(deps, bookingId, b) {
  if (!b.email) return { sent: false, reason: "no_email" };
  const nonce = await ensureNonce(deps, bookingId);
  const otp = deriveOtp(deps.pepper, bookingId, nonce);
  await deps.sendCustomerEmail("completion_otp", b.email, { bookingRef: b.bookingRef || bookingId, customerName: b.customerName || "Customer", otp });
  return { sent: true };
}

async function handleSendOtp(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new OtpError("unauthenticated", "Please sign in.");
  const bookingId = data && data.bookingId;
  if (!validBookingId(bookingId)) throw new OtpError("invalid-argument", "Invalid booking.");
  const b = await loadBooking(deps, bookingId);
  const isAdmin = await deps.isAdmin(context);
  if (!isAdmin && !(b.driverUid === uid && (await deps.isDriver(context)))) throw new OtpError("permission-denied", "Only the assigned driver can request this.");
  if (!OTP_STATUSES.includes(b.status)) throw new OtpError("failed-precondition", "This job is not in progress.");
  if (deps.rateLimit && !(await deps.rateLimit("completionOtpSend", bookingId)).ok) throw new OtpError("resource-exhausted", "The code was sent recently. Please ask the customer to check their email or My Bookings.");
  const r = await sendOtpEmail(deps, bookingId, b);
  return { sent: r.sent, reason: r.reason || null };
}

/** Assigned driver (or admin) submits the OTP; only success marks the booking delivered. */
async function handleVerifyOtp(data, context, deps) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new OtpError("unauthenticated", "Please sign in.");
  const bookingId = data && data.bookingId;
  const otp = data && typeof data.otp === "string" ? data.otp.trim() : "";
  if (!validBookingId(bookingId)) throw new OtpError("invalid-argument", "Invalid booking.");
  if (!/^\d{4}$/.test(otp)) throw new OtpError("invalid-argument", "Please enter the 4-digit code.");
  const isAdmin = await deps.isAdmin(context);
  const isDriver = await deps.isDriver(context);
  const db = deps.db;
  const bRef = db.collection(BOOKINGS).doc(bookingId);
  const sRef = db.collection(SECRETS).doc(bookingId);
  const now = deps.now();

  const result = await db.runTransaction(async (tx) => {
    const bSnap = await tx.get(bRef);
    if (!bSnap.exists) return { error: ["not-found", "Booking not found."] };
    const b = bSnap.data();
    if (!isAdmin && !(isDriver && b.driverUid === uid)) return { error: ["permission-denied", "Only the assigned driver can complete this job."] };
    if (b.status === "delivered") return { already: true };
    if (b.status !== "transit") return { error: ["failed-precondition", "Mark the job as in transit before completing it."] };
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists || !sSnap.data().nonce) return { error: ["failed-precondition", "Ask the customer to open My Bookings (or tap “Send code to customer”) to get the code."] };
    const s = sSnap.data();
    if ((s.lockedUntil || 0) > now) return { error: ["resource-exhausted", "Too many incorrect codes. Try again in 15 minutes."] };
    const expected = deriveOtp(deps.pepper, bookingId, s.nonce);
    if (!safeEqual(expected, otp)) {
      const attempts = (s.attempts || 0) + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      tx.update(sRef, { attempts: lock ? 0 : attempts, lockedUntil: lock ? now + LOCK_MS : 0, lastFailedAt: now });
      return { error: lock ? ["resource-exhausted", "Too many incorrect codes. Try again in 15 minutes."] : ["invalid-argument", "Incorrect code. " + (MAX_ATTEMPTS - attempts) + " attempt(s) left."] };
    }
    tx.update(sRef, { verifiedAt: now, attempts: 0, lockedUntil: 0 });
    tx.update(bRef, { status: "delivered", deliveredAt: deps.serverTimestamp(), completionVerifiedAt: deps.serverTimestamp(),
                      completionVerifiedBy: isAdmin && b.driverUid !== uid ? "admin" : "driver" });
    return { ok: true };
  });
  if (result.error) {
    (deps.logger || console).warn("completion_otp_rejected", { bookingId, code: result.error[0] });
    throw new OtpError(result.error[0], result.error[1]);
  }
  (deps.logger || console).info("completion_otp_verified", { bookingId, already: !!result.already });
  return { ok: true, status: "delivered", already: !!result.already };
}

/** Wrap a handler for functions.https.onCall: OtpError → HttpsError, anything else → generic internal. */
function callable(handler, depsFactory, toHttpsError) {
  return async (data, context) => {
    try { return await handler(data, context, depsFactory()); }
    catch (e) {
      if (e instanceof OtpError) throw toHttpsError(e.code, e.publicMessage);
      console.error("completion_otp_error", e && e.message ? String(e.message).slice(0, 120) : "error");
      throw toHttpsError("internal", "Something went wrong. Please try again.");
    }
  };
}

module.exports = { handleGetOtp, handleSendOtp, handleVerifyOtp, sendOtpEmail, callable, deriveOtp, OtpError, OTP_STATUSES, MAX_ATTEMPTS };
