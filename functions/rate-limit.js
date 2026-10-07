/**
 * PackZen — server-side rate limiting (N-07, R2-16)
 * -------------------------------------------------
 * Fixed-window counters in Firestore, updated in a transaction so concurrent
 * requests cannot slip past the limit. Keys are SHA-256 hashed, so no email,
 * phone or IP address is stored in document IDs or fields.
 *
 *   consume(db, { scope, subject, limit, windowMs, now })
 *     → { ok: true } | { ok: false, retryAfterMs }
 *
 * Collection `rateLimits` is server-only (catch-all deny in firestore.rules).
 * Docs carry `expiresAt` so a Firestore TTL policy can purge them (console).
 */
"use strict";

const crypto = require("crypto");

const COLLECTION = "rateLimits";

function keyFor(scope, subject) {
  return crypto.createHash("sha256").update(String(scope) + "|" + String(subject)).digest("hex").slice(0, 40);
}

/** First IP from x-forwarded-for (Cloud Functions sit behind Google's front end), else socket IP. */
function clientIp(req) {
  if (!req) return "unknown";
  const xff = req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"]);
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim().slice(0, 64);
  return String((req.ip || (req.socket && req.socket.remoteAddress) || "unknown")).slice(0, 64);
}

async function consume(db, { scope, subject, limit, windowMs, now }) {
  if (!subject) subject = "unknown";
  const t = typeof now === "number" ? now : Date.now();
  const ref = db.collection(COLLECTION).doc(keyFor(scope, subject));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : null;
    let windowStart = d && typeof d.windowStart === "number" ? d.windowStart : 0;
    let count = d && typeof d.count === "number" ? d.count : 0;
    if (t - windowStart >= windowMs) { windowStart = t; count = 0; }
    if (count >= limit) return { ok: false, retryAfterMs: Math.max(0, windowStart + windowMs - t) };
    tx.set(ref, { scope: String(scope), windowStart, count: count + 1, updatedAt: t, expiresAt: new Date(windowStart + windowMs * 2) });
    return { ok: true };
  });
}

/** Apply several limits; returns the first failure or { ok: true }. Fails OPEN only if Firestore itself errors. */
async function consumeAll(db, rules, logger) {
  for (const r of rules) {
    try {
      const res = await consume(db, r);
      if (!res.ok) return Object.assign({ scope: r.scope }, res);
    } catch (e) {
      (logger || console).warn("rate_limit_unavailable", { scope: r.scope });
    }
  }
  return { ok: true };
}

/** Standard limits (per window). Tuned to be invisible to real customers. */
const LIMITS = {
  moveOrderUid: { limit: 10, windowMs: 10 * 60 * 1000 },
  moveOrderIp: { limit: 30, windowMs: 10 * 60 * 1000 },
  bookingUid: { limit: 6, windowMs: 10 * 60 * 1000 },
  bookingIp: { limit: 20, windowMs: 10 * 60 * 1000 },
  serviceOrderUid: { limit: 10, windowMs: 10 * 60 * 1000 },
  serviceOrderIp: { limit: 30, windowMs: 10 * 60 * 1000 },
  signupOtpIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  signupOtpGlobal: { limit: 300, windowMs: 60 * 60 * 1000 },
  signupVerifyIp: { limit: 30, windowMs: 60 * 60 * 1000 },
  completionOtpView: { limit: 30, windowMs: 60 * 60 * 1000 },
  completionOtpSend: { limit: 3, windowMs: 60 * 60 * 1000 },
};

module.exports = { consume, consumeAll, clientIp, keyFor, LIMITS, COLLECTION };
