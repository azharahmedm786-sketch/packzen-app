/**
 * Customer-site stability:
 *  logClientError  (HTTP POST, public, rate-limited) — browser errors from customer pages,
 *                  de-duplicated into clientErrors/{hash} with a running count.
 *  clientErrorDigest (hourly) — e-mails the admin when errors spike (≥ 10 new
 *                  occurrences in the last hour), at most once per hour.
 *  healthCheck     (HTTP GET) — proves functions + Firestore answer (used by the
 *                  daily automated booking check and uptime monitor).
 */
"use strict";
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { BREVO_SECRETS } = require("./brevo-client");
const REGION = "asia-south1";
const ALLOWED_ORIGINS = ["https://packzenblr.in", "https://www.packzenblr.in"];

function clean(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, " ").slice(0, n); }
function normalize(body) {
  const b = body && typeof body === "object" ? body : {};
  const msg = clean(b.msg, 300), src = clean(b.src, 200), page = clean(b.page, 120).replace(/[?#].*$/, ""), ua = clean(b.ua, 160);
  if (!msg || /^Script error\.?$/i.test(msg)) return null;                 // cross-origin noise
  if (/chrome-extension:|moz-extension:|safari-extension:/i.test(src + msg)) return null; // browser extensions
  return { msg, src, page, ua, kind: ["error", "rejection", "fallback"].includes(b.kind) ? b.kind : "error" };
}
function keyOf(e) { return crypto.createHash("sha1").update(e.msg + "|" + e.src + "|" + e.page).digest("hex").slice(0, 24); }

async function record(db, e, nowMs) {
  const ref = db.collection("clientErrors").doc(keyOf(e));
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : {};
    // hourly bucket so the digest can count recent occurrences cheaply
    const hour = Math.floor(nowMs / 3600e3);
    const recent = d.hour === hour ? (d.hourCount || 0) + 1 : 1;
    tx.set(ref, { msg: e.msg, src: e.src, page: e.page, kind: e.kind, lastUa: e.ua, count: (d.count || 0) + 1, hour, hourCount: recent,
      firstAtMs: d.firstAtMs || nowMs, lastAtMs: nowMs }, { merge: true });
  });
}

exports.logClientError = functions.region(REGION).runWith({ memory: "128MB", maxInstances: 5 }).https.onRequest(async (req, res) => {
  const origin = req.get("origin") || "";
  if (ALLOWED_ORIGINS.includes(origin)) { res.set("Access-Control-Allow-Origin", origin); res.set("Vary", "Origin"); }
  res.set("Access-Control-Allow-Methods", "POST"); res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" || !ALLOWED_ORIGINS.includes(origin)) return res.status(204).end();
  try {
    const db = admin.firestore();
    const ip = clean(req.ip || req.get("x-forwarded-for") || "x", 64);
    const rl = await require("./rate-limit").consumeAll(db, [{ scope: "clientError", subject: ip, limit: 30, windowMs: 3600e3 }], functions.logger);
    if (!rl.ok) return res.status(204).end();
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const e = normalize(body); if (!e) return res.status(204).end();
    await record(db, e, Date.now());
  } catch (err) { functions.logger.warn("client_error_log_failed", { message: String(err && err.message).slice(0, 120) }); }
  return res.status(204).end();
});

function digest(rows, hour) {
  const recent = rows.filter((r) => r.hour === hour || r.hour === hour - 1);
  const total = recent.reduce((t, r) => t + (r.hourCount || 0), 0);
  return { total, top: recent.sort((a, b) => (b.hourCount || 0) - (a.hourCount || 0)).slice(0, 8) };
}

exports.clientErrorDigest = functions.region(REGION).runWith({ secrets: BREVO_SECRETS }).pubsub.schedule("15 * * * *").timeZone("Asia/Kolkata").onRun(async () => {
  const db = admin.firestore(), nowMs = Date.now(), hour = Math.floor(nowMs / 3600e3);
  const snap = await db.collection("clientErrors").where("lastAtMs", ">=", nowMs - 2 * 3600e3).limit(200).get();
  const d = digest(snap.docs.map((x) => x.data()), hour);
  if (d.total < 10) return null;
  const { sendAdminEmail } = require("./notification-service");
  await sendAdminEmail(`⚠️ Website errors: ${d.total} in the last hour`, [["What", "Customers' browsers reported errors on packzenblr.in"]].concat(
    d.top.map((r, i) => [`#${i + 1} (${r.hourCount}×)`, `${r.msg} — ${r.page || "?"} ${r.src ? "(" + r.src + ")" : ""}`]),
    [["See all", "admin.html → Overview → Business readiness (website errors)"]]), null).catch(() => {});
  return null;
});

exports.healthCheck = functions.region(REGION).runWith({ memory: "128MB", maxInstances: 2 }).https.onRequest(async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await admin.firestore().collection("promos").limit(1).get();
    res.status(200).json({ ok: true, firestore: true, at: new Date().toISOString() });
  } catch (e) { res.status(503).json({ ok: false }); }
});

exports._siteHealth = { normalize, keyOf, digest };
