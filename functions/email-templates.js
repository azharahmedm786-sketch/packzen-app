/* ============================================================
   EMAIL TEMPLATES — PackZen
   Each function returns { subject, html } for a given data object.
   All templates share a common shell (logo, footer, support info)
   so they render consistently and stay easy to maintain.
   ============================================================ */

const BRAND = {
  name: "PackZen Packers & Movers",
  logoUrl: "https://packzenblr.in/assets/logo/packzen-logo.png",
  website: "https://packzenblr.in",
supportEmail: "support@packzenblr.in",
   supportPhone: "+91 99450 95453",
  instagram: "https://instagram.com/packzenblr",
  primaryColor: "#ea580c",
  darkBg: "#0f172a"
};

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(n) {
  const num = Number(n) || 0;
  return "₹" + num.toLocaleString("en-IN");
}

/* ── SHARED SHELL ─────────────────────────────────────────── */
function renderShell({ headerEmoji, headerTitle, headerSubtitle, bodyHtml, ctaLabel, ctaUrl }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f7ff;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7ff;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND.primaryColor},#c2410c);padding:28px 32px;text-align:center;">
            <img src="${BRAND.logoUrl}" alt="${BRAND.name}" width="64" style="display:block;margin:0 auto 12px;border-radius:8px;background:#fff;padding:6px;">
            <div style="font-size:22px;font-weight:800;color:#ffffff;font-family:Georgia,serif;">${headerEmoji} ${esc(headerTitle)}</div>
            ${headerSubtitle ? `<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:6px;">${esc(headerSubtitle)}</div>` : ""}
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;color:#1a2744;font-size:14px;line-height:1.6;">
            ${bodyHtml}
            ${ctaUrl ? `
            <table role="presentation" width="100%" style="margin-top:24px;">
              <tr><td align="center">
                <a href="${ctaUrl}" style="display:inline-block;background:${BRAND.primaryColor};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:30px;">${esc(ctaLabel || "View Booking")}</a>
              </td></tr>
            </table>` : ""}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:${BRAND.darkBg};padding:22px 32px;text-align:center;">
            <div style="font-size:13px;color:#94a3b8;margin-bottom:10px;">Need help? We're here for you.</div>
            <div style="font-size:13px;color:#e2e8f4;margin-bottom:4px;">📧 <a href="mailto:${BRAND.supportEmail}" style="color:#e2e8f4;">${BRAND.supportEmail}</a></div>
            <div style="font-size:13px;color:#e2e8f4;margin-bottom:12px;">📞 <a href="tel:${BRAND.supportPhone.replace(/\s/g,"")}" style="color:#e2e8f4;">${BRAND.supportPhone}</a></div>
            <div style="font-size:12px;color:#64748b;">
              <a href="${BRAND.website}" style="color:#64748b;text-decoration:none;">packzenblr.in</a> ·
              <a href="${BRAND.instagram}" style="color:#64748b;text-decoration:none;">Instagram</a>
            </div>
            <div style="font-size:11px;color:#475569;margin-top:12px;">© 2026 ${BRAND.name} · Bangalore, India</div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function bookingInfoTable(d) {
  const rows = [
    ["Booking Reference", d.bookingRef],
    ["Customer Name", d.customerName],
    ["Pickup Address", d.pickup],
    ["Drop Address", d.drop],
    ["Moving Date", d.date],
    ["Time Slot", d.timeSlot],
    ["Amount", d.total !== undefined ? money(d.total) : null],
    ["Payment Status", d.paymentStatus]
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:14px;">
    ${rows.map(([label, val]) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eef1f8;color:#5a6a8a;font-size:13px;width:40%;">${esc(label)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eef1f8;color:#1a2744;font-size:13px;font-weight:600;text-align:right;">${esc(val)}</td>
    </tr>`).join("")}
  </table>`;
}

/* ── 1. BOOKING CONFIRMED ─────────────────────────────────── */
function bookingConfirmed(d) {
  return {
    subject: `Booking Confirmed — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "🎉",
      headerTitle: "Booking Confirmed!",
      headerSubtitle: "We're all set for your move",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>Your move with PackZen has been confirmed. Here are your booking details:</p>
        ${bookingInfoTable(d)}
        <p style="margin-top:16px;">Our team will reach out before your moving date. Thank you for choosing PackZen!</p>`,
      ctaLabel: "Track My Booking",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 2. PAYMENT SUCCESSFUL ────────────────────────────────── */
function paymentSuccessful(d) {
  return {
    subject: `Payment Received — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "💳",
      headerTitle: "Payment Successful",
      headerSubtitle: "Your payment has been received",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>We've received your payment of <strong>${money(d.total)}</strong> for booking <strong>${esc(d.bookingRef)}</strong>.</p>
        ${bookingInfoTable(d)}
        <p style="margin-top:16px;">A receipt has been generated for your records.</p>`,
      ctaLabel: "View Receipt",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 3. DRIVER ASSIGNED ───────────────────────────────────── */
function driverAssigned(d) {
  return {
    subject: `Driver Assigned — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "🚛",
      headerTitle: "Driver Assigned",
      headerSubtitle: "Your moving team is on the way",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p><strong>${esc(d.driverName || "Your driver")}</strong> has been assigned to your move${d.driverPhone ? ` — you can reach them at <strong>${esc(d.driverPhone)}</strong>` : ""}.</p>
        ${bookingInfoTable(d)}`,
      ctaLabel: "Track My Move",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 4. DRIVER ARRIVING ───────────────────────────────────── */
function driverArriving(d) {
  return {
    subject: `Your Driver is Arriving Soon — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "📍",
      headerTitle: "Driver Arriving Soon",
      headerSubtitle: "Get ready for your move",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p><strong>${esc(d.driverName || "Your driver")}</strong> is on the way to your pickup location and should arrive shortly.</p>
        ${bookingInfoTable(d)}`,
      ctaLabel: "Track Live Location",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 5. BOOKING REMINDER (24h before) ─────────────────────── */
function bookingReminder(d) {
  return {
    subject: `Reminder: Your Move is Tomorrow — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "⏰",
      headerTitle: "Your Move is Tomorrow",
      headerSubtitle: "A quick reminder from PackZen",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>This is a friendly reminder that your move is scheduled for <strong>${esc(d.date)}</strong>. Please ensure someone is available at the pickup address during your selected time slot.</p>
        ${bookingInfoTable(d)}
        <p style="margin-top:16px;">Need to reschedule? Just let us know as soon as possible.</p>`,
      ctaLabel: "View Booking",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 6. BOOKING COMPLETED ─────────────────────────────────── */
function bookingCompleted(d) {
  return {
    subject: `Move Completed — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "✅",
      headerTitle: "Move Completed!",
      headerSubtitle: "Hope everything went smoothly",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>Your move has been marked as complete. We hope our team took great care of your belongings!</p>
        ${bookingInfoTable(d)}
        <p style="margin-top:16px;">We'd love to hear about your experience.</p>`,
      ctaLabel: "Leave a Review",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 7. BOOKING CANCELLED ─────────────────────────────────── */
function bookingCancelled(d) {
  return {
    subject: `Booking Cancelled — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "❌",
      headerTitle: "Booking Cancelled",
      headerSubtitle: "Your booking has been cancelled",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>Your booking <strong>${esc(d.bookingRef)}</strong> has been cancelled${d.cancelReason ? ` (Reason: ${esc(d.cancelReason)})` : ""}.</p>
        ${bookingInfoTable(d)}
        <p style="margin-top:16px;">If any amount is due for refund, it will be processed within 5–7 business days.</p>`,
      ctaLabel: "Book Again",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 8. BOOKING RESCHEDULED ───────────────────────────────── */
function bookingRescheduled(d) {
  return {
    subject: `Booking Rescheduled — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "📅",
      headerTitle: "Booking Rescheduled",
      headerSubtitle: "Your new move date is confirmed",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>Your booking <strong>${esc(d.bookingRef)}</strong> has been rescheduled to <strong>${esc(d.date)}</strong>.</p>
        ${bookingInfoTable(d)}`,
      ctaLabel: "View Booking",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 9. REFUND PROCESSED ──────────────────────────────────── */
function refundProcessed(d) {
  return {
    subject: `Refund Processed — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "💰",
      headerTitle: "Refund Processed",
      headerSubtitle: "Your refund is on its way",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>A refund of <strong>${money(d.refundAmount || d.total)}</strong> for booking <strong>${esc(d.bookingRef)}</strong> has been processed. It should reflect in your original payment method within 5–7 business days.</p>
        ${bookingInfoTable(d)}`,
      ctaLabel: "View Details",
      ctaUrl: BRAND.website
    })
  };
}

/* ── 10. FEEDBACK REQUEST ─────────────────────────────────── */
function feedbackRequest(d) {
  return {
    subject: `How was your move? — ${d.bookingRef} | PackZen`,
    html: renderShell({
      headerEmoji: "⭐",
      headerTitle: "How Did We Do?",
      headerSubtitle: "Your feedback helps us improve",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>Thank you for choosing PackZen for your recent move (${esc(d.bookingRef)}). We'd love to hear your feedback — it takes less than a minute.</p>
        ${bookingInfoTable(d)}`,
      ctaLabel: "Leave Feedback",
      ctaUrl: BRAND.website
    })
  };
}

/* -- COMPLETION CODE (delivery OTP) --------------------------- */
function completionOtp(d) {
  return {
    subject: `Your PackZen completion code — ${d.bookingRef}`,
    html: renderShell({
      headerEmoji: "🔐",
      headerTitle: "Your completion code",
      headerSubtitle: "Share it only when the job is done",
      bodyHtml: `<p>Hi ${esc(d.customerName)},</p>
        <p>Your completion code for booking <strong>${esc(d.bookingRef)}</strong> is:</p>
        <p style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;margin:16px 0;">${esc(d.otp)}</p>
        <p>Give this code to your PackZen driver <strong>only after</strong> your items have been delivered and checked. PackZen staff will never ask for it earlier.</p>`,
      ctaLabel: "View Booking",
      ctaUrl: BRAND.website
    })
  };
}

const TEMPLATES = {
  completion_otp: completionOtp,
  booking_confirmed: bookingConfirmed,
  payment_successful: paymentSuccessful,
  driver_assigned: driverAssigned,
  driver_arriving: driverArriving,
  booking_reminder: bookingReminder,
  booking_completed: bookingCompleted,
  booking_cancelled: bookingCancelled,
  booking_rescheduled: bookingRescheduled,
  refund_processed: refundProcessed,
  feedback_request: feedbackRequest
};

module.exports = { TEMPLATES, esc, money };
