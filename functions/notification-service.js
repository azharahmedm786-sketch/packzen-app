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
  const functions = require("firebase-functions");
  const cfg = functions.config().admin || {};
  const adminEmails = (cfg.notifyemails || "moveeasyblr@gmail.com,azharahmedm786@gmail.com")
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

module.exports = {
  escapeHtml,
  renderAdminValue,
  logNotification,
  sendCustomerEmail,
  sendAdminEmail,
  retryFailedNotifications
};
