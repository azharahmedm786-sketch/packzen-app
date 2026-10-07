/**
 * PackZen — exception alerting foundation
 * ---------------------------------------
 * `runOpsDigest(deps)` (scheduled hourly via `opsDigest` in index.js) scans for
 * situations that need a human and emails the admins ONLY when something is
 * new, re-reminding about still-open items at most once per 24 h.
 *
 * Detected:
 *   payment_needs_review   pendingPayments with status "needs_review"
 *   webhook_problem        razorpayWebhookEvents in conflict/mismatch/needs_review,
 *                          or stuck in "processing" > 30 min (repeated 5xx)
 *   notification_failures  failed notificationLogs / smsQueue in the last 24 h (aggregated)
 *   unassigned_booking     confirmed/pending booking for today/tomorrow (IST) with no driver
 *   function_failures      opsFailures recorded by payment/webhook code (aggregated)
 *
 * State: opsAlerts/{fingerprint} (server-only). Nothing here touches bookings.
 */
"use strict";

const crypto = require("crypto");

const DAY = 24 * 60 * 60 * 1000;
const REMIND_AFTER_MS = DAY;
const MAX_ROWS = 25;

function istDate(ms, addDays) {
  const d = new Date(ms + 5.5 * 3600 * 1000 + (addDays || 0) * DAY);
  return d.toISOString().slice(0, 10);
}
function toMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "number") return v;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
function fp(parts) { return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32); }

/** Record a failure from server code (cheap, best-effort, no PII). */
async function recordFailure(db, source, code, now) {
  try {
    await db.collection("opsFailures").add({ source: String(source).slice(0, 60), code: String(code || "error").slice(0, 60), at: now || Date.now() });
  } catch (e) { /* never throw from the error path */ }
}

async function collectIssues(db, now) {
  const issues = [];
  const add = (type, key, summary) => issues.push({ type, fingerprint: fp([type, key]), summary });

  // 1. payments needing review
  const nr = await db.collection("pendingPayments").where("status", "==", "needs_review").limit(50).get();
  nr.docs.forEach((d) => {
    const p = d.data() || {};
    add("payment_needs_review", d.id, "Order " + d.id + " needs review (" + (p.reviewReason || "unknown reason") + ")");
  });

  // 2. webhook problems
  const wh = await db.collection("razorpayWebhookEvents").where("status", "in", ["conflict", "mismatch", "needs_review", "processing"]).limit(100).get();
  wh.docs.forEach((d) => {
    const e = d.data() || {};
    if (e.status === "processing") {
      const at = toMs(e.receivedAt);
      if (at !== null && now - at < 30 * 60 * 1000) return; // still within Razorpay's retry window
      add("webhook_problem", d.id, "Webhook " + (e.event || "event") + " stuck in processing (event " + d.id + ")");
    } else {
      add("webhook_problem", d.id, "Webhook " + (e.event || "event") + " → " + e.status + (e.orderId ? " (order " + e.orderId + ")" : ""));
    }
  });

  // 3. failed notifications (aggregated per channel per IST day)
  const since = new Date(now - DAY);
  // single-field range query (no composite index needed); filter status here
  const nl = await db.collection("notificationLogs").where("createdAt", ">=", since).limit(2000).get();
  const byChannel = {};
  nl.docs.forEach((d) => { const x = d.data() || {}; if (x.status !== "failed") return; const c = x.channel || "email"; byChannel[c] = (byChannel[c] || 0) + 1; });
  const sq = await db.collection("smsQueue").where("status", "==", "failed").limit(500).get();
  const smsRecent = sq.docs.filter((d) => { const t = toMs((d.data() || {}).updatedAt || (d.data() || {}).createdAt); return t === null || now - t < DAY; }).length;
  if (smsRecent) byChannel.sms = (byChannel.sms || 0) + smsRecent;
  Object.keys(byChannel).forEach((c) => add("notification_failures", c + "|" + istDate(now), byChannel[c] + " failed " + c + " notification(s) in the last 24 h"));

  // 4. unassigned bookings for today / tomorrow (IST)
  const days = [istDate(now), istDate(now, 1)];
  const ub = await db.collection("bookings").where("date", "in", days).limit(300).get();
  ub.docs.forEach((d) => {
    const b = d.data() || {};
    if (!["confirmed", "pending"].includes(b.status)) return;
    if (b.driverUid || (b.assignee && b.assignee.uid)) return;
    add("unassigned_booking", d.id + "|" + b.date, "Booking " + (b.bookingRef || d.id) + " on " + b.date + " has no driver/technician (status " + b.status + ")");
  });

  // 5. function failures (aggregated by source+code, last 24 h)
  const ff = await db.collection("opsFailures").where("at", ">=", now - DAY).limit(1000).get();
  const agg = {};
  ff.docs.forEach((d) => { const f = d.data() || {}; const k = (f.source || "?") + " / " + (f.code || "?"); agg[k] = (agg[k] || 0) + 1; });
  Object.keys(agg).forEach((k) => add("function_failures", k + "|" + istDate(now), agg[k] + "× " + k + " in the last 24 h"));

  return issues;
}

/**
 * deps: { db, now(), sendAdminEmail(subject, rows), logger }
 * Returns { found, notified }.
 */
async function runOpsDigest(deps) {
  const now = deps.now();
  const issues = await collectIssues(deps.db, now);
  const toSend = [];
  for (const i of issues) {
    const ref = deps.db.collection("opsAlerts").doc(i.fingerprint);
    const snap = await ref.get();
    const s = snap.exists ? snap.data() : null;
    const last = s ? toMs(s.lastNotifiedAt) : null;
    if (!s || last === null || now - last >= REMIND_AFTER_MS) {
      toSend.push(Object.assign({ reminder: !!s }, i));
      await ref.set({ type: i.type, summary: i.summary, firstSeenAt: s ? s.firstSeenAt : now, lastNotifiedAt: now, lastSeenAt: now });
    } else {
      await ref.set(Object.assign({}, s, { lastSeenAt: now }));
    }
  }
  if (toSend.length) {
    const rows = toSend.slice(0, MAX_ROWS).map((i) => [i.type + (i.reminder ? " (still open)" : ""), i.summary]);
    if (toSend.length > MAX_ROWS) rows.push(["…", (toSend.length - MAX_ROWS) + " more — see Firestore opsAlerts"]);
    await deps.sendAdminEmail("Ops alert: " + toSend.length + " item(s) need attention", rows);
  }
  (deps.logger || console).info("ops_digest", { found: issues.length, notified: toSend.length });
  return { found: issues.length, notified: toSend.length };
}

module.exports = { runOpsDigest, collectIssues, recordFailure, istDate };
