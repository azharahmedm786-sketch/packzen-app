/* ============================================================
   SCHEDULED NOTIFICATIONS — PackZen
   Two time-based jobs that can't be driven by a Firestore
   onWrite trigger:
     1. 24-hour booking reminder
     2. Feedback request (sent some time after delivery)

   Both are idempotent via boolean flags on the booking doc so
   re-running the schedule never double-sends.

   Requires the "cron" experience in Cloud Functions v1 (pubsub
   schedule) — no extra npm packages needed beyond what you
   already have in package.json.
   ============================================================ */
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { sendCustomerEmail } = require("./notification-service");
const { BREVO_SECRETS } = require("./brevo-client");
function bookingToTemplateData(b) {
  return {
    bookingRef: b.bookingRef || "",
    customerName: b.customerName || "Customer",
    pickup: b.pickup || "",
    drop: b.drop || "",
    date: b.date || "",
    timeSlot: b.shiftTimeLabel || b.shiftTime || "",
    total: b.total || 0,
    paymentStatus: b.paymentStatus || (b.paymentType === "pay_later" ? "Pay on delivery" : "Paid")
  };
}

async function getCustomerEmail(booking) {
  try {
    if (!booking.customerUid) return null;
    const doc = await admin.firestore().collection("users").doc(booking.customerUid).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.prefEmail === false) return null;
    return data.email || null;
  } catch (e) {
    return null;
  }
}

/* ── 24-HOUR BOOKING REMINDER ────────────────────────────────
   Runs every hour. Finds bookings whose `date` field (a
   "YYYY-MM-DD" string, per script.js) is exactly tomorrow and
   whose status is still active (confirmed/assigned/packing),
   and haven't already been reminded.
   ──────────────────────────────────────────────────────────── */
exports.sendBookingReminders = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .pubsub.schedule("every 60 minutes")
  .onRun(async (context) => {
    const db = admin.firestore();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const d = String(tomorrow.getDate()).padStart(2, "0");
    const tomorrowStr = `${y}-${m}-${d}`;

    try {
      const snap = await db.collection("bookings")
        .where("date", "==", tomorrowStr)
        .where("status", "in", ["confirmed", "assigned", "packing"])
        .get();

      if (snap.empty) return null;

      for (const doc of snap.docs) {
        const b = doc.data();
        if (b.reminderSent === true) continue; // idempotency guard

        const email = await getCustomerEmail(b);
        if (email) {
          await sendCustomerEmail("booking_reminder", email, bookingToTemplateData(b));
        }
        await doc.ref.update({ reminderSent: true, reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    } catch (e) {
      console.error("sendBookingReminders error:", e.message);
    }
    return null;
  });

/* ── FEEDBACK REQUEST ─────────────────────────────────────────
   Runs every 3 hours. Finds bookings delivered more than 24
   hours ago that haven't had a feedback request sent yet.
   ──────────────────────────────────────────────────────────── */
exports.sendFeedbackRequests = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .pubsub.schedule("every 180 minutes")
  .onRun(async (context) => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);

    try {
      const snap = await db.collection("bookings")
        .where("status", "==", "delivered")
        .limit(100)
        .get();

      if (snap.empty) return null;

      for (const doc of snap.docs) {
        const b = doc.data();
        if (b.feedbackRequestSent === true) continue;
        // Only send once the move has been delivered for 24h+.
        // Use createdAt as a fallback if no deliveredAt timestamp exists.
        const deliveredRef = b.deliveredAt || b.createdAt;
        if (!deliveredRef || deliveredRef.toMillis() > cutoff.toMillis()) continue;

        const email = await getCustomerEmail(b);
        if (email) {
          await sendCustomerEmail("feedback_request", email, bookingToTemplateData(b));
        }
        await doc.ref.update({ feedbackRequestSent: true, feedbackRequestSentAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    } catch (e) {
      console.error("sendFeedbackRequests error:", e.message);
    }
    return null;
  });
/* ── SIGNUP OTP CLEANUP ──────────────────────────────────────
   Runs every 30 minutes. Deletes expired, never-verified OTP
   requests so signupOtps never grows unbounded and a stale
   record can never be replayed.
   ──────────────────────────────────────────────────────────── */
exports.cleanupExpiredSignupOtps = functions
  .region("asia-south1")
  .pubsub.schedule("every 30 minutes")
  .onRun(async (context) => {
    const db = admin.firestore();
    const now = Date.now();
    try {
      const snap = await db.collection("signupOtps").where("expiresAt", "<", now).limit(200).get();
      if (snap.empty) return null;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.log(`Cleaned up ${snap.size} expired signup OTP(s).`);
    } catch (e) {
      console.error("cleanupExpiredSignupOtps error:", e.message);
    }
    return null;
  });
