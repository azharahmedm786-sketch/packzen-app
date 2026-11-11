/* ============================================================
   NOTIFICATION SERVICE — PackZen
   Shared logic for sending emails via Brevo and logging every
   attempt to the `notificationLogs` collection.

   This module does NOT touch your existing smsQueue/sendSMS
   pipeline in index.js — it is purely additive and only handles
   the new email channel. Admin email notifications also flow
   through here so everything is logged consistently.
   ============================================================ */
const admin = require("firebase-admin"); 
const { sendBrevoEmail } = require("./brevo-client");
const { TEMPLATES } = require("./email-templates");
const opsAlerts = require("./ops-alerts");

const STALE_CLAIM_MS = 5 * 60 * 1000; // 5 minutes for email claim
const ALERT_CLAIM_LEASE_MS = 5 * 60 * 1000; // 5 minutes for alert lease
const MAX_EMAIL_ATTEMPTS = 3;
const MAX_ALERT_ATTEMPTS = 5;

const MAX_RETRIES = 3;

/**
 * Writes a row to notificationLogs. Never throws.
 */
async function logNotification({ bookingRef, channel, recipient, status, provider, response, error }) {
  try {
    await admin.firestore().collection("notificationLogs").add({
      bookingRef: bookingRef || null,
      channel: channel || "email",
      recipient: recipient || null,
      status: status || "unknown",
      provider: provider || "brevo",
      response: response ? JSON.stringify(response).slice(0, 1000) : null,
      error: error || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error("⚠️ Failed to write notificationLogs entry:", e.message);
  }
}

/**
 * Sends a templated customer email and logs the result.
 * templateKey must match a key in email-templates.js TEMPLATES.
 * data must include at least { bookingRef, customerName } plus
 * whatever fields the specific template needs.
 * toEmail is the customer's email address.
 *
 * This function NEVER throws — notification failures must never
 * block booking creation or any other core flow.
 */
async function sendCustomerEmail(templateKey, toEmail, data) {
  const bookingRef = data?.bookingRef || null;

  if (!toEmail) {
    await logNotification({
      bookingRef, channel: "email", recipient: null,
      status: "skipped", provider: "brevo", error: "No recipient email on file"
    });
    return { success: false, error: "NO_EMAIL" };
  }

  const templateFn = TEMPLATES[templateKey];
  if (!templateFn) {
    await logNotification({
      bookingRef, channel: "email", recipient: toEmail,
      status: "failed", provider: "brevo", error: "Unknown template: " + templateKey
    });
    return { success: false, error: "UNKNOWN_TEMPLATE" };
  }

  let subject, html;
  try {
    const rendered = templateFn(data || {});
    subject = rendered.subject;
    html = rendered.html;
  } catch (e) {
    await logNotification({
      bookingRef, channel: "email", recipient: toEmail,
      status: "failed", provider: "brevo", error: "Template render error: " + e.message
    });
    return { success: false, error: "TEMPLATE_RENDER_ERROR" };
  }

const result = await sendBrevoEmail({
    toEmail,
    toName: data?.customerName || "",
    subject,
    htmlContent: html,
    textContent: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  });

  await logNotification({
    bookingRef,
    channel: "email",
    recipient: toEmail,
    status: result.success ? "sent" : "failed",
    provider: "brevo",
    response: result.response,
    error: result.error
  });

  return result;
}

/**
 * Sends a plain internal admin alert email (new booking, payment
 * received, cancellation, refund request, driver assigned,
 * feedback received, etc). Uses a lightweight inline template
 * rather than the customer-facing branded ones.
 */
/* N-08: every admin-email value is HTML-escaped (values can come from public,
   unauthenticated forms). Trusted markup must be passed explicitly as
   { href, label } and is rendered as a fixed https link. */
function escapeHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function renderAdminValue(v) {
  if (v && typeof v === "object" && typeof v.href === "string" && /^https:\/\/[a-z0-9.-]+\//i.test(v.href)) {
    return `<a href="${escapeHtml(v.href)}">${escapeHtml(v.label || v.href)}</a>`;
  }
  if (v && typeof v === "object") return escapeHtml(v.label || "—"); // untrusted/invalid link → plain text
  const t = v == null || v === "" ? "—" : String(v);
  return escapeHtml(t.length > 500 ? t.slice(0, 500) + "…" : t);
}

async function sendAdminEmail(subjectPrefix, bodyLines, bookingRef) {
  // ADMIN_NOTIFY_EMAILS (functions/.env.packzen-e7539) replaces the deprecated
  // functions.config().admin.notifyemails, which Firebase shuts down in March 2027.
  // The old config is still read as a fallback until then, never fatally.
  let legacy = "";
  try { legacy = ((require("firebase-functions").config() || {}).admin || {}).notifyemails || ""; } catch (_) { legacy = ""; }
  const adminEmails = (process.env.ADMIN_NOTIFY_EMAILS || legacy || "moveeasyblr@gmail.com,azharahmedm786@gmail.com")
    .split(",").map(e => e.trim()).filter(Boolean);

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;line-height:1.6;">
    <h2 style="color:#ea580c;">${escapeHtml(subjectPrefix)}</h2>
    <table role="presentation" style="border-collapse:collapse;">
      ${bodyLines.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5a6a8a;">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600;">${renderAdminValue(v)}</td></tr>`).join("")}
    </table>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px;">PackZen Admin Notification System</p>
  </div>`;

  const results = [];
  for (const email of adminEmails) {
const result = await sendBrevoEmail({
      toEmail: email,
      toName: "PackZen Admin",
      subject: `[Admin] ${subjectPrefix}`,
      htmlContent: html,
      textContent: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    });
    await logNotification({
      bookingRef,
      channel: "admin_email",
      recipient: email,
      status: result.success ? "sent" : "failed",
      provider: "brevo",
      response: result.response,
      error: result.error
    });
    results.push(result);
  }
  return results;
}

/**
 * Retries all failed email notificationLogs entries with
 * retries < MAX_RETRIES. Intended to be run on a schedule
 * (see scheduled-retry.js) or triggered manually by admin.
 */
async function retryFailedNotifications() {
  const db = admin.firestore();
  const snap = await db.collection("notificationLogs")
    .where("status", "==", "failed")
    .where("channel", "==", "email")
    .limit(50)
    .get();

  if (snap.empty) return { retried: 0 };

  let retried = 0;
  for (const doc of snap.docs) {
    const log = doc.data();
    const retries = log.retries || 0;
    if (retries >= MAX_RETRIES) continue;

    // We don't have the original template/data stored, so retries
    // only apply to admin emails and generic re-sends where the
    // full context was preserved in the log's "context" field.
    if (!log.context) continue;

const result = await sendBrevoEmail({
      toEmail: log.recipient,
      toName: log.context.customerName || "",
      subject: log.context.subject,
      htmlContent: log.context.html,
      textContent: (log.context.html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    });

    await doc.ref.update({
      status: result.success ? "sent" : "failed",
      retries: retries + 1,
      response: result.response ? JSON.stringify(result.response).slice(0, 1000) : null,
      error: result.error || null,
      lastAttempt: admin.firestore.FieldValue.serverTimestamp()
    });
    retried++;
  }
  return { retried };
}

/**
 * Transactionally claims and sends an email via Brevo, offering best-effort deduplication
 * under at-least-once Cloud Function trigger execution.
 *
 * RULE: opsAlerts.sendAlert() is NEVER executed inside a transaction callback.
 * Outbox transactions update alertStatus and return a boolean flag; alerts dispatch post-commit.
 */
async function sendCustomerEmailWithOutbox(templateKey, toEmail, data, bookingId) {
  if (!bookingId || typeof bookingId !== "string") {
    throw new Error("sendCustomerEmailWithOutbox strictly requires an immutable booking document ID.");
  }

  const bookingRef = data?.bookingRef || null;
  const outboxId = `email_bk_${bookingId}_${templateKey}`;
  const outboxRef = admin.firestore().collection("emailOutbox").doc(outboxId);
  const emailClaimId = "email_claim_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

  // 1. Transactional Claim Phase for Customer Email
  const claimResult = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(outboxRef);
    const now = Date.now();

    if (!snap.exists) {
      tx.set(outboxRef, {
        bookingId,
        bookingRef,
        templateKey,
        recipient: toEmail,
        status: "processing",
        emailClaimId,
        attempts: 1,
        claimedAt: now,
        alertStatus: "none",
        alertAttempts: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { proceed: true, attempt: 1, shouldAlert: false };
    }

    const state = snap.data();
    if (state.status === "sent") {
      return { proceed: false, reason: "already_sent", shouldAlert: false };
    }

    if (state.status === "processing") {
      const isStale = (now - (state.claimedAt || 0)) > STALE_CLAIM_MS;
      if (!isStale) {
        return { proceed: false, reason: "in_progress", shouldAlert: false };
      }

      // STALE CLAIM DETECTED: Check MAX_EMAIL_ATTEMPTS ceiling
      const currentAttempts = state.attempts || 1;
      if (currentAttempts >= MAX_EMAIL_ATTEMPTS) {
        tx.update(outboxRef, {
          status: "failed",
          lastError: "STALE_CLAIM_MAX_ATTEMPTS_EXCEEDED",
          alertStatus: "pending",
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { proceed: false, shouldAlert: true, reason: "stale_max_attempts_exceeded", attempts: currentAttempts };
      }

      // Reclaim stale worker
      tx.update(outboxRef, {
        status: "processing",
        emailClaimId,
        attempts: currentAttempts + 1,
        claimedAt: now,
        reclaimedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { proceed: true, attempt: currentAttempts + 1, shouldAlert: false };
    }

    if (state.status === "failed") {
      const currentAttempts = state.attempts || 0;
      if (currentAttempts >= MAX_EMAIL_ATTEMPTS) {
        return { proceed: false, shouldAlert: state.alertStatus === "pending", reason: "max_attempts_exceeded", attempts: currentAttempts };
      }
      tx.update(outboxRef, {
        status: "processing",
        emailClaimId,
        attempts: currentAttempts + 1,
        claimedAt: now
      });
      return { proceed: true, attempt: currentAttempts + 1, shouldAlert: false };
    }

    return { proceed: false, reason: "unknown_state", shouldAlert: false };
  });

  // POST-COMMIT ALERT DISPATCH (Strictly outside transaction)
  if (!claimResult.proceed) {
    if (claimResult.shouldAlert) {
      await attemptOperationalAlertClaim(outboxRef, {
        outboxId,
        bookingId,
        bookingRef,
        templateKey,
        recipient: toEmail,
        attempts: claimResult.attempts,
        reason: claimResult.reason
      });
    }
    return { success: true, skipped: true, reason: claimResult.reason };
  }

  // 2. Dispatch Phase
  const sendResult = await sendCustomerEmail(templateKey, toEmail, data);

  // 3. Finalize Outbox State with Claim Ownership Verification
  let shouldAlertFailure = false;
  let failureAttempts = 1;

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(outboxRef);
    if (!snap.exists) return;
    const s = snap.data();

    // OWNERSHIP CHECK: Stale worker must not overwrite a newer worker's state
    if (s.emailClaimId !== emailClaimId) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("Email claim ownership lost before dispatch finalization for claim:", emailClaimId);
      }
      return;
    }

    if (sendResult.success) {
      tx.update(outboxRef, {
        status: "sent",
        response: sendResult.response || null,
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      failureAttempts = s.attempts || 1;
      const reachedCeiling = failureAttempts >= MAX_EMAIL_ATTEMPTS;

      tx.update(outboxRef, {
        status: "failed",
        lastError: sendResult.error || "Send failed",
        alertStatus: reachedCeiling ? "pending" : (s.alertStatus || "none"),
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      shouldAlertFailure = reachedCeiling;
    }
  });

  if (shouldAlertFailure) {
    await attemptOperationalAlertClaim(outboxRef, {
      outboxId,
      bookingId,
      bookingRef,
      templateKey,
      recipient: toEmail,
      attempts: failureAttempts,
      reason: sendResult.error
    });
  }

  return sendResult;
}

/**
 * Transactional Alert Claim Lease Machine:
 * Guarantees that concurrent workers cannot send duplicate alerts.
 * Retries failed or expired claims up to MAX_ALERT_ATTEMPTS (5).
 * Uses alertClaimId ownership tracking to prevent expired workers from overwriting newer worker outcomes.
 */
async function attemptOperationalAlertClaim(outboxRef, details) {
  const claimId = "claim_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

  const claimAlert = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(outboxRef);
    if (!snap.exists) return { proceed: false };
    const s = snap.data();
    const now = Date.now();

    if (s.alertStatus === "dispatched") {
      return { proceed: false, reason: "already_dispatched" };
    }

    if (s.alertStatus === "sending") {
      const isExpired = (now - (s.alertClaimedAt || 0)) > ALERT_CLAIM_LEASE_MS;
      if (!isExpired) {
        return { proceed: false, reason: "in_flight" };
      }
    }

    const attempts = s.alertAttempts || 0;
    if (attempts >= MAX_ALERT_ATTEMPTS) {
      if (s.alertStatus !== "failed") {
        tx.update(outboxRef, { alertStatus: "failed", lastAlertError: "MAX_ALERT_ATTEMPTS_EXCEEDED" });
      }
      return { proceed: false, reason: "max_attempts_exceeded" };
    }

    tx.update(outboxRef, {
      alertStatus: "sending",
      alertClaimId: claimId,
      alertClaimedAt: now,
      alertAttempts: attempts + 1
    });

    return { proceed: true, attempt: attempts + 1, claimId };
  });

  if (!claimAlert.proceed) {
    return;
  }

  // Dispatch alert outside transaction
  try {
    if (typeof console !== "undefined" && console.error) {
      console.error("EMAIL_OUTBOX_DEAD_LETTER", details);
    }

    await opsAlerts.sendAlert(
      admin.firestore(),
      `🚨 DEAD LETTER: Customer email (${details.templateKey}) for booking ${details.bookingRef || details.bookingId} permanently failed on attempt ${details.attempts} (${details.reason}). Manual intervention required.`
    );

    // Atomically finalize if this worker still holds the claim lease
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) return;
      const s = snap.data();
      if (s.alertClaimId === claimId) {
        tx.update(outboxRef, {
          alertStatus: "dispatched",
          alertedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("Alert claim ownership lost before dispatch completion for claim:", claimId);
        }
      }
    });
  } catch (alertErr) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("Ops alert network dispatch failed:", alertErr.message);
    }
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) return;
      const s = snap.data();
      if (s.alertClaimId === claimId) {
        tx.update(outboxRef, {
          alertStatus: "failed",
          lastAlertError: alertErr.message,
          alertFailedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }).catch(e => {
      if (typeof console !== "undefined" && console.error) {
        console.error("Failed to record alert error:", e.message);
      }
    });
  }
}

module.exports = {
  escapeHtml,
  renderAdminValue,
  logNotification,
  sendCustomerEmail,
  sendAdminEmail,
  retryFailedNotifications,
  sendCustomerEmailWithOutbox,
  attemptOperationalAlertClaim,
  STALE_CLAIM_MS,
  ALERT_CLAIM_LEASE_MS,
  MAX_EMAIL_ATTEMPTS,
  MAX_ALERT_ATTEMPTS
};
