/**
 * PACKZEN 3.0 — Communication Dispatch Architecture & Channel Adapters
 * ------------------------------------------------------------------
 * Modular, server-side communication router supporting:
 *   - Email adapter (Brevo REST API v3) with strict evidence verification
 *   - WhatsApp adapter (Phase 2B pending — safe adapter_pending state)
 *   - Webhook adapter (Phase 2C pending — safe adapter_pending state)
 *   - Multi-channel coordinator tracking independent sub-channel deliveries
 *   - Payload pre-dispatch validation & recipient address verification
 *   - Provider evidence enforcement (never reports success without messageId)
 *   - Ambiguous outcome tracking (delivery_unknown on timeout/socket drop)
 *   - Strict PII scrubbing in logs and external correlation via eventId
 */
"use strict";

const brevoClient = require("./brevo-client");
const emailTemplates = require("./email-templates");
const channelWhatsApp = require("./channel-whatsapp");
const channelWebhook = require("./channel-webhook");

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates recipient email syntax and length.
 * Rejects control characters, newlines, and overly long strings to prevent injection.
 */
function validateEmail(email) {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (/[\r\n\0]/.test(trimmed)) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Safe HTML escaping helper
 */
function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(amount) {
  const num = Number(amount) || 0;
  return "₹" + num.toLocaleString("en-IN");
}

/**
 * Transactional email templates for the 5 core Phase 2A events
 */
const TRANSACTIONAL_TEMPLATES = {
  // 1. New Booking Acknowledgement
  "booking.created": (p) => {
    const bookingRef = p.bookingRef || p.bookingId;
    const isPayLater = p.paymentType === "pay_later";
    const totalFormatted = money(p.total);

    const subject = `Booking Received — ${bookingRef} | PackZen`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#ea580c;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">📦 Booking Received</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Booking Ref: <strong>${esc(bookingRef)}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.customerName || "Customer")},</p>
      <p>Thank you for choosing PackZen. We have received your booking details for <strong>${esc(p.date || "your scheduled date")}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Pickup:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.pickup || "Pending")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Drop:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.drop || "Pending")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Total Amount:</td><td style="padding:10px 14px;font-weight:700;color:#ea580c;">${totalFormatted}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Payment Mode:</td><td style="padding:10px 14px;font-weight:600;">${isPayLater ? "Pay Later (On Delivery)" : "Online Advance"}</td></tr>
      </table>
      <p>Our team will assign your driver and crew shortly. If you need any assistance, reach us anytime at <strong>+91 99450 95453</strong>.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 1b. Booking Confirmed
  "booking.confirmed": (p) => {
    const bookingRef = p.bookingRef || p.bookingId;
    const paidFormatted = money(p.paidAmount || p.total);
    const balanceFormatted = money(p.balanceDue || 0);

    const subject = `Booking Confirmed — ${bookingRef} | PackZen`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#ea580c;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">✅ Booking Confirmed</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Booking Ref: <strong>${esc(bookingRef)}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.customerName || "Customer")},</p>
      <p>Your move is confirmed with PackZen for <strong>${esc(p.date || "your scheduled date")}</strong>. Your advance payment of <strong>${paidFormatted}</strong> has been received.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Amount Paid:</td><td style="padding:10px 14px;font-weight:700;color:#16a34a;">${paidFormatted}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Balance Due on Delivery:</td><td style="padding:10px 14px;font-weight:600;">${balanceFormatted}</td></tr>
      </table>
      <p>Thank you for choosing PackZen Packers & Movers. We look forward to serving you!</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 2. Payment Confirmation
  "payment.received": (p) => {
    const amountFormatted = money(p.amount);
    const subject = `Payment Received — ${amountFormatted} | PackZen`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#16a34a;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">💳 Payment Successful</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Receipt for Transaction: <strong>${esc(p.paymentId)}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.customerName || "Customer")},</p>
      <p>We have successfully received your payment of <strong>${amountFormatted}</strong>${p.bookingRef ? ` for booking <strong>${esc(p.bookingRef)}</strong>` : ""}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Amount:</td><td style="padding:10px 14px;font-weight:700;color:#16a34a;">${amountFormatted}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Payment Method:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.method || "Online")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Transaction ID:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.paymentId)}</td></tr>
      </table>
      <p>Thank you for choosing PackZen! If you need a GST invoice or receipt copy, contact support@packzenblr.in.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 3. Booking Assignment Notification
  "booking.assigned": (p) => {
    const bookingRef = p.bookingRef || p.bookingId;
    const subject = `Driver Assigned — ${bookingRef} | PackZen`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#ea580c;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">🚛 Moving Team Assigned</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Booking Ref: <strong>${esc(bookingRef)}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.customerName || "Customer")},</p>
      <p>Your PackZen moving team has been assigned for your move on <strong>${esc(p.date || "your scheduled date")}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Assigned Driver:</td><td style="padding:10px 14px;font-weight:700;">${esc(p.driverName || "PackZen Driver")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Driver Phone:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.driverPhone || "Will contact on arrival")}</td></tr>
        ${p.vehicleNumber ? `<tr><td style="padding:10px 14px;color:#64748b;">Vehicle:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.vehicleNumber)}</td></tr>` : ""}
      </table>
      <p>Your PackZen driver will call you prior to arriving at your pickup location.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 4. Booking Completion Notification
  "booking.completed": (p) => {
    const bookingRef = p.bookingRef || p.bookingId;
    const subject = `Move Completed — ${bookingRef} | PackZen`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#16a34a;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">🎉 Move Completed Successfully</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Booking Ref: <strong>${esc(bookingRef)}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.customerName || "Customer")},</p>
      <p>Your move has been completed! We hope our team took great care of your belongings.</p>
      <p>If you have any feedback or questions, please don't hesitate to reach out to us at <strong>support@packzenblr.in</strong> or call <strong>+91 99450 95453</strong>.</p>
      <p>Thank you for choosing PackZen!</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 5. Lead Enquiry Acknowledgement
  "lead.created": (p) => {
    const service = p.serviceLabel || p.service || "Moving & Packing";
    const subject = `We've Received Your Enquiry — ${service} | PackZen`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#ea580c;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">📋 Enquiry Received</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">PackZen Packers & Movers — Bengaluru</p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.name || p.customerName || "Customer")},</p>
      <p>Thank you for reaching out to PackZen. We have received your request regarding <strong>${esc(service)}</strong>${p.area ? ` in <strong>${esc(p.area)}</strong>` : ""}.</p>
      <p>One of our service specialists is reviewing your requirements and will contact you shortly with an all-inclusive, fixed-price quotation.</p>
      <p>Need immediate assistance? You can call us directly at <strong>+91 99450 95453</strong>.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 6. Lead Qualified / Quotation Sent
  "lead.qualified": (p) => {
    const totalFormatted = money(p.total);
    const service = p.serviceLabel || "Moving Quotation";
    const subject = `Your Quotation — ${totalFormatted} | PackZen`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#ea580c;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">📜 Your PackZen Quote</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">${esc(service)}</p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.customerName || "Customer")},</p>
      <p>We've prepared your fixed-price, all-inclusive quote for your move.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Total Amount:</td><td style="padding:10px 14px;font-weight:700;color:#ea580c;">${totalFormatted}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Pricing:</td><td style="padding:10px 14px;font-weight:600;">Fixed & All-Inclusive</td></tr>
      </table>
      <p>To view your quote breakdown and confirm your booking, visit our website or contact us at <strong>+91 99450 95453</strong>.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 7. Digital Project Created / Agreement Kick-Off
  "project.created": (p) => {
    const totalFormatted = money(p.totalAmount || p.amount || 0);
    const advanceFormatted = money(p.advancePaid || 0);
    const balanceFormatted = money(p.balanceDue || 0);
    const subject = `Project Kick-Off: ${esc(p.businessName || "Your Website")} (${esc(p.projectId)}) | PackZen Digital`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#0284c7;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">💻 Project Initialized</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Project ID: <strong>${esc(p.projectId)}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.clientName || p.customerName || "Client")},</p>
      <p>Welcome to PackZen Digital Solutions! Your project scope and milestone agreement for <strong>${esc(p.businessName || "Your Business")}</strong> have been initialized.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Business Name:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.businessName || "—")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Total Contract:</td><td style="padding:10px 14px;font-weight:700;color:#0284c7;">${totalFormatted}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Advance Received:</td><td style="padding:10px 14px;font-weight:600;color:#16a34a;">${advanceFormatted}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Balance Due on Launch:</td><td style="padding:10px 14px;font-weight:600;">${balanceFormatted}</td></tr>
      </table>
      <p>Our engineering team has commenced discovery and wireframing. You can track progress or reach your lead developer anytime at <strong>support@packzenblr.in</strong>.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 8. Digital Project Milestone Updated / Deliverable Sign-Off
  "project.milestone_updated": (p) => {
    const statusLabel = p.status === "completed" ? "Completed & Approved ✅" : (p.status === "in_progress" ? "In Progress ⏳" : "Pending ⚪");
    const subject = `Milestone Update: ${esc(p.milestoneName || "Milestone")} — ${esc(p.businessName || "Project")} | PackZen Digital`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#0284c7;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">🚀 Milestone Update</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Project: <strong>${esc(p.businessName || p.projectId)}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Hi ${esc(p.clientName || p.customerName || "Client")},</p>
      <p>There is a progress update on your digital project milestone:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Milestone:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.milestoneName || "Milestone")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Current Status:</td><td style="padding:10px 14px;font-weight:700;color:${p.status === 'completed' ? '#16a34a' : '#0284c7'};">${statusLabel}</td></tr>
        ${p.projectId ? `<tr><td style="padding:10px 14px;color:#64748b;">Project ID:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.projectId)}</td></tr>` : ""}
      </table>
      <p>To review preview links or staging builds, please check your client dashboard or contact your project lead.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 9. Lead Assigned to Staff / Advisor
  "lead.assigned": (p) => {
    const subject = `Lead Assignment: ${esc(p.customerName || "Customer")} (${esc(p.division || "logistics")}) | PackZen Operations`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7ff;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#4f46e5;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">👤 New Lead Assigned</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Advisor: <strong>${esc(p.advisorName || "Assigned Advisor")}</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>A new lead has been routed to your queue for prompt follow-up.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Customer:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.customerName || "Customer")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Division:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.division || "logistics")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Service:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.service || "Inquiry")}</td></tr>
      </table>
      <p>Target first contact response SLA is <strong>15 minutes</strong>. Access the lead in your advisor console.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 10. Operational SLA Breach Warning
  "lead.sla_breach": (p) => {
    const subject = `⚠️ URGENT: Uncontacted Lead SLA Breach (${esc(p.leadId)}) | PackZen Operations`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#fff1f2;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #fecdd3;box-shadow:0 2px 12px rgba(225,29,72,0.1);">
    <div style="background:#e11d48;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">⚠️ SLA Inactivity Breach</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Elapsed: <strong>${esc(p.elapsedMinutes || 15)} mins uncontacted</strong></p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>An inbound inquiry has exceeded the 15-minute first-response SLA window without contact.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fff5f5;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Lead ID:</td><td style="padding:10px 14px;font-weight:700;">${esc(p.leadId)}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Customer:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.customerName || "Customer")}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Division:</td><td style="padding:10px 14px;font-weight:600;">${esc(p.division || "logistics")}</td></tr>
      </table>
      <p>Immediate intervention requested in the Owner Command Center.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  },

  // 11. Daily Business Summary Briefing
  "daily.summary": (p) => {
    const subject = `PackZen Daily Business Summary — ${esc(p.date || "Today")} | Executive Report`;
    const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <div style="background:#0f172a;padding:24px;text-align:center;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">📊 Daily Executive Briefing</h2>
      <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">PackZen 3.0 Operating System</p>
    </div>
    <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
      <p>Executive daily recap of operational velocity and financial collections:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#64748b;">Total Inbound Leads:</td><td style="padding:10px 14px;font-weight:700;">${esc(p.totalLeads || 0)}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Active Jobs in Flight:</td><td style="padding:10px 14px;font-weight:700;">${esc(p.activeJobs || 0)}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Gross Collections:</td><td style="padding:10px 14px;font-weight:700;color:#16a34a;">${money(p.grossCollections || 0)}</td></tr>
        <tr><td style="padding:10px 14px;color:#64748b;">Outstanding Receivables:</td><td style="padding:10px 14px;font-weight:700;color:#ea580c;">${money(p.outstandingReceivables || 0)}</td></tr>
      </table>
      <p>Log into the Command Center for live operational controls and partner allocations.</p>
    </div>
  </div>
</body>
</html>`;
    return { subject, html };
  }
};

/**
 * Validates payload fields required for communication dispatch
 */
function validateEventPayload(event) {
  if (!event || typeof event !== "object") {
    return { valid: false, error: "EVENT_OBJECT_REQUIRED" };
  }
  if (!event.eventId || !event.eventName) {
    return { valid: false, error: "EVENT_ID_AND_NAME_REQUIRED" };
  }
  const p = event.payload || {};
  return { valid: true, payload: p };
}

/**
 * Resolves recipient email from event payload
 */
function extractRecipientEmail(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload.customerEmail || payload.email || payload.clientEmail;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return null;
}

/**
 * Brevo Email Adapter
 *
 * Implements external delivery via Brevo REST API:
 *   - Verifies recipient email syntax
 *   - Idempotently skips if already marked delivered
 *   - Passes eventId correlation headers (X-PackZen-Event-Id) and tags
 *   - Requires provider messageId evidence before declaring success
 *   - Flags timeouts as delivery_unknown to preserve at-least-once reliability
 */
async function dispatchEmail(claimedEvent, options = {}) {
  const validation = validateEventPayload(claimedEvent);
  if (!validation.valid) {
    return { success: false, retryable: false, error: new Error(validation.error) };
  }

  // Deduplication check: Has this event already been delivered via email?
  const existingDelivery = claimedEvent.channelDeliveries && claimedEvent.channelDeliveries.email;
  if (existingDelivery && existingDelivery.status === "delivered") {
    return {
      success: true,
      duplicateSkipped: true,
      provider: "brevo",
      result: existingDelivery
    };
  }

  const p = validation.payload;
  const recipientEmail = extractRecipientEmail(p);

  // If no recipient email is present on the event payload (e.g. phone-only lead)
  if (!recipientEmail) {
    return {
      success: true,
      skipped: true,
      provider: "brevo",
      result: { skipped: true, reason: "NO_RECIPIENT_EMAIL_ON_RECORD" }
    };
  }

  // Validate email address format
  if (!validateEmail(recipientEmail)) {
    return {
      success: false,
      retryable: false,
      error: new Error(`INVALID_RECIPIENT_EMAIL: Format validation failed for '${recipientEmail.slice(0, 10)}...'`)
    };
  }

  // Render template
  const templateFn = TRANSACTIONAL_TEMPLATES[claimedEvent.eventName];
  if (!templateFn) {
    return {
      success: false,
      retryable: false,
      error: new Error(`UNSUPPORTED_EMAIL_EVENT_TEMPLATE: No template registered for event '${claimedEvent.eventName}'`)
    };
  }

  const { subject, html } = templateFn(p);
  const recipientName = p.customerName || p.name || p.clientName || recipientEmail;

  // Dispatch via Brevo client (or injected mock sender for testing)
  const brevoSender = options.brevoSender || brevoClient.sendBrevoEmail;
  const startTime = Date.now();

  try {
    const res = await brevoSender({
      toEmail: recipientEmail,
      toName: recipientName,
      subject,
      htmlContent: html,
      headers: {
        "X-PackZen-Event-Id": claimedEvent.eventId,
        "X-PackZen-Event-Name": claimedEvent.eventName
      },
      tags: [claimedEvent.eventId, claimedEvent.eventName]
    });

    const durationMs = Date.now() - startTime;

    // Check for provider success WITH explicit provider evidence
    if (res && res.success === true) {
      const messageId = res.response && (res.response.messageId || res.response.messageIds && res.response.messageIds[0]);
      if (!messageId) {
        // Ambiguous: Provider reported HTTP 200/success but returned no messageId
        // Never claim success without evidence!
        return {
          success: false,
          deliveryUnknown: true,
          retryable: true,
          error: new Error("BREVO_MISSING_MESSAGE_ID_EVIDENCE: HTTP success reported without messageId")
        };
      }

      const isSimulated = res.simulated === true;
      return {
        success: true,
        simulated: isSimulated,
        provider: "brevo",
        result: {
          provider: isSimulated ? "brevo_simulated" : "brevo",
          status: isSimulated ? "simulated_sent" : "delivered",
          messageId,
          durationMs,
          simulated: isSimulated,
          guardReason: res.guardReason || null,
          deliveredAtMs: isSimulated ? undefined : Date.now(),
          sentAtMs: isSimulated ? Date.now() : undefined
        }
      };
    }

    // Check for ambiguous timeout or socket disconnect
    if (res && res.timedOut === true) {
      return {
        success: false,
        deliveryUnknown: true,
        retryable: true,
        error: new Error(res.error || "BREVO_REQUEST_TIMEOUT: Socket timed out while awaiting provider response")
      };
    }

    // Provider returned error
    return {
      success: false,
      retryable: res ? res.retryable === true : true,
      error: new Error((res && res.error) || "BREVO_DELIVERY_FAILED")
    };
  } catch (err) {
    return {
      success: false,
      retryable: true,
      deliveryUnknown: /timeout|hang|disconnect|econnreset/i.test(err.message),
      error: err
    };
  }
}

/**
 * WhatsApp Adapter (Phase 2B Active)
 */
async function dispatchWhatsApp(claimedEvent, options = {}) {
  if (options.disableWhatsApp === true) {
    return {
      success: false,
      isPendingAdapter: true,
      channel: "whatsapp",
      error: new Error("WHATSAPP_ADAPTER_PENDING_PHASE2B: WhatsApp Cloud API adapter disabled by configuration")
    };
  }

  return channelWhatsApp.dispatchWhatsAppEvent(claimedEvent, options);
}

/**
 * Webhook Adapter (Phase 2C Active)
 */
async function dispatchWebhook(claimedEvent, options = {}) {
  if (options.disableWebhook === true) {
    return {
      success: false,
      isPendingAdapter: true,
      channel: "webhook",
      error: new Error("WEBHOOK_ADAPTER_PENDING_PHASE2C: Webhook adapter disabled by configuration")
    };
  }

  return channelWebhook.dispatchWebhookEvent(claimedEvent, options);
}

/**
 * Multi-Channel Dispatcher
 *
 * Coordinates delivery across multiple sub-channels (Email + WhatsApp + Webhook).
 * Tracks each channel's delivery status independently in channelDeliveries.
 * Guarantees that failure or pending state of one channel never duplicates
 * or rolls back delivery on another channel that already succeeded.
 */
async function dispatchMultiChannel(claimedEvent, options = {}) {
  const existingDeliveries = claimedEvent.channelDeliveries || {};
  const channelDeliveries = Object.assign({}, existingDeliveries);

  // Sub-channel 1: Email
  let emailOutcome = null;
  const isEmailComplete = (status) => status === "delivered" || status === "skipped" || status === "simulated_sent";
  if (!channelDeliveries.email || !isEmailComplete(channelDeliveries.email.status)) {
    emailOutcome = await dispatchEmail(claimedEvent, options);
    if (emailOutcome.success) {
      if (emailOutcome.skipped) {
        channelDeliveries.email = { status: "skipped", reason: emailOutcome.result?.reason || "Skipped" };
      } else {
        channelDeliveries.email = emailOutcome.result || { status: "delivered", atMs: Date.now() };
      }
    }
  } else {
    emailOutcome = { success: true, duplicateSkipped: true, result: channelDeliveries.email };
  }

  // Sub-channel 2: WhatsApp
  let whatsAppOutcome = null;
  const isWhatsAppComplete = (status) => status === "delivered" || status === "skipped" || status === "simulated_sent";
  if (!channelDeliveries.whatsapp || !isWhatsAppComplete(channelDeliveries.whatsapp.status)) {
    whatsAppOutcome = await dispatchWhatsApp(claimedEvent, options);
    if (whatsAppOutcome.success) {
      if (whatsAppOutcome.skipped) {
        channelDeliveries.whatsapp = { status: "skipped", reason: whatsAppOutcome.result?.reason || "Skipped" };
      } else {
        channelDeliveries.whatsapp = whatsAppOutcome.result || { status: "delivered", atMs: Date.now() };
      }
    }
  } else {
    whatsAppOutcome = { success: true, duplicateSkipped: true, result: channelDeliveries.whatsapp };
  }

  // Sub-channel 3: Webhook (if enabled or specified in targetChannels)
  const includeWebhook = options.includeWebhook === true || (Array.isArray(claimedEvent.targetChannels) && claimedEvent.targetChannels.includes("webhook"));
  let webhookOutcome = null;
  const isWebhookComplete = (status) => status === "delivered" || status === "skipped" || status === "simulated_sent";
  if (includeWebhook) {
    if (!channelDeliveries.webhook || !isWebhookComplete(channelDeliveries.webhook.status)) {
      webhookOutcome = await dispatchWebhook(claimedEvent, options);
      if (webhookOutcome.success) {
        if (webhookOutcome.skipped) {
          channelDeliveries.webhook = { status: "skipped", reason: webhookOutcome.result?.reason || "Skipped" };
        } else {
          channelDeliveries.webhook = webhookOutcome.result || { status: "delivered", atMs: Date.now() };
        }
      }
    } else {
      webhookOutcome = { success: true, duplicateSkipped: true, result: channelDeliveries.webhook };
    }
  }

  // Evaluate combined delivery state
  const isEmailDone = channelDeliveries.email && isEmailComplete(channelDeliveries.email.status);
  const isWhatsAppDone = channelDeliveries.whatsapp && isWhatsAppComplete(channelDeliveries.whatsapp.status);
  const isWebhookDone = !includeWebhook || (channelDeliveries.webhook && isWebhookComplete(channelDeliveries.webhook.status));

  const isWhatsAppPending = whatsAppOutcome && whatsAppOutcome.isPendingAdapter === true;
  const isWebhookPending = includeWebhook && webhookOutcome && webhookOutcome.isPendingAdapter === true;

  // All completed
  if (isEmailDone && isWhatsAppDone && isWebhookDone) {
    return {
      success: true,
      channelDeliveries,
      result: channelDeliveries
    };
  }

  // Partial pending handling (pause without retries or dead-letter)
  if (isWhatsAppPending) {
    channelDeliveries.whatsapp = { status: "adapter_pending", pausedAtMs: Date.now() };
  }
  if (isWebhookPending) {
    channelDeliveries.webhook = { status: "adapter_pending", pausedAtMs: Date.now() };
  }

  if ((isEmailDone && (isWhatsAppPending || isWebhookPending)) || (isWhatsAppDone && isWebhookPending)) {
    return {
      success: false,
      isPendingAdapter: true,
      channelDeliveries,
      error: new Error(`MULTI_CHANNEL_PARTIAL_PENDING: ${isWhatsAppPending ? 'WhatsApp adapter pending. ' : ''}${isWebhookPending ? 'Webhook adapter pending.' : ''}`.trim())
    };
  }

  // Delivery unknown on any channel
  if ((emailOutcome && emailOutcome.deliveryUnknown) || (whatsAppOutcome && whatsAppOutcome.deliveryUnknown) || (webhookOutcome && webhookOutcome.deliveryUnknown)) {
    return {
      success: false,
      deliveryUnknown: true,
      channelDeliveries,
      error: (emailOutcome && emailOutcome.deliveryUnknown ? emailOutcome.error : null) ||
             (whatsAppOutcome && whatsAppOutcome.deliveryUnknown ? whatsAppOutcome.error : null) ||
             (webhookOutcome && webhookOutcome.deliveryUnknown ? webhookOutcome.error : null) ||
             new Error("MULTI_CHANNEL_DELIVERY_UNKNOWN")
    };
  }

  return {
    success: false,
    retryable: (emailOutcome && emailOutcome.retryable) || (whatsAppOutcome && whatsAppOutcome.retryable) || (webhookOutcome && webhookOutcome.retryable) || false,
    channelDeliveries,
    error: (webhookOutcome && !webhookOutcome.success ? webhookOutcome.error : null) ||
           (whatsAppOutcome && !whatsAppOutcome.success ? whatsAppOutcome.error : null) ||
           (emailOutcome && !emailOutcome.success ? emailOutcome.error : null) ||
           new Error("MULTI_CHANNEL_DISPATCH_FAILED")
  };
}

/**
 * Creates the production dispatcher router map for runOutboxWorkerBatch
 */
function createProductionDispatchers(db, options = {}) {
  return {
    email: (evt) => dispatchEmail(evt, options),
    whatsapp: (evt) => dispatchWhatsApp(evt, options),
    webhook: (evt) => dispatchWebhook(evt, options),
    multi_channel: (evt) => dispatchMultiChannel(evt, options)
  };
}

function renderEmailTemplate(eventName, payload) {
  const fn = TRANSACTIONAL_TEMPLATES[eventName];
  if (!fn) return null;
  return fn(payload);
}

module.exports = {
  validateEmail,
  validateEventPayload,
  extractRecipientEmail,
  TRANSACTIONAL_TEMPLATES,
  renderEmailTemplate,
  dispatchEmail,
  dispatchWhatsApp,
  dispatchWebhook,
  dispatchMultiChannel,
  createProductionDispatchers
};
