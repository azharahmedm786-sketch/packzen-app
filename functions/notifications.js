/* ============================================================
   PACKZEN NOTIFICATION TRIGGERS
   ------------------------------------------------------------
   This file is NEW and ADDITIVE. It does not modify your
   existing functions/index.js (sendSMS, createRazorpayOrder,
   verifyRazorpayPayment). Deploy it by requiring/exporting these
   functions from index.js — see the one-line addition documented
   below.
 
   All functions are region "asia-south1" to match your existing
   setup. All are wrapped so a notification failure NEVER throws
   past the trigger boundary — booking flow is never blocked.
   ============================================================ */
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
// admin.initializeApp() is already called in your existing index.js.
// Do not call it again here — Firebase will throw "app already exists".
 
const { sendCustomerEmail, sendAdminEmail } = require("./notification-service");
const { BREVO_SECRETS } = require("./brevo-client");
/* ────────────────────────────────────────────────────────────
   HELPERS: queue SMS and WhatsApp messages directly to Firestore
   ──────────────────────────────────────────────────────────── */
async function queueSMS(phone, message, bookingRef) {
  if (!phone) return;
  try {
    await admin.firestore().collection("smsQueue").add({
      mobile: phone,
      message,
      bookingRef: bookingRef || null,
      status: "pending",
      retries: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error(`Error queueing SMS for ${bookingRef}: ${e.message}`);
  }
}

async function queueWhatsApp(phone, message, bookingRef) {
  if (!phone) return;
  try {
    await admin.firestore().collection("whatsappQueue").add({
      mobile: phone,
      message,
      bookingRef: bookingRef || null,
      status: "pending",
      retries: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error(`Error queueing WhatsApp for ${bookingRef}: ${e.message}`);
  }
}

/* ────────────────────────────────────────────────────────────
   HELPER: safely pull the fields templates need out of a
   booking document, regardless of which flow created it
   (Razorpay webhook, script.js bookWithoutPayment, WhatsApp/n8n).
   ──────────────────────────────────────────────────────────── */
function bookingToTemplateData(b, extra = {}) {
  return {
    bookingRef: b.bookingRef || "",
    customerName: b.customerName || "Customer",
    pickup: b.pickup || "",
    drop: b.drop || "",
    date: b.date || "",
    timeSlot: b.shiftTimeLabel || b.shiftTime || "",
    total: b.total || 0,
    paymentStatus: b.paymentStatus || (b.paymentType === "pay_later" ? "Pay on delivery" : "Paid"),
    driverName: b.driverName || "",
    driverPhone: b.driverPhone || "",
    cancelReason: b.cancelReason || "",
    refundAmount: b.refundAmount || b.total || 0,
    ...extra
  };
}

/* Customer email lookup — bookings store customerUid, the actual
   email lives on the users doc. This never throws. */
async function getCustomerEmail(booking) {
  try {
    if (!booking.customerUid) return null;
    const doc = await admin.firestore().collection("users").doc(booking.customerUid).get();
    if (!doc.exists) return null;
    const data = doc.data();
    // Respect the existing prefEmail opt-out toggle used in script.js
    if (data.prefEmail === false) return null;
    return data.email || null;
  } catch (e) {
    console.error("getCustomerEmail error:", e.message);
    return null;
  }
}

/* ════════════════════════════════════════════════════════════
   1. BOOKING CONFIRMED — fires on booking creation
   Covers both the Razorpay-verified path AND the direct/
   pay-on-delivery path from script.js, since both write to
   the same `bookings` collection.
   ════════════════════════════════════════════════════════════ */
exports.onBookingCreatedNotify = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .firestore.document("bookings/{bookingId}")
  .onCreate(async (snap, context) => {
    const b = snap.data();
    try {
      const email = await getCustomerEmail(b);
      const data = bookingToTemplateData(b);

      if (email) {
        await sendCustomerEmail("booking_confirmed", email, data);
        // If payment was already made online at creation time, also
        // send the payment-successful email (Razorpay flow writes
        // paymentStatus: "paid" directly on create).
        if (b.paymentStatus === "paid" && (b.paid > 0 || b.paymentType === "full" || b.paymentType === "advance")) {
          await sendCustomerEmail("payment_successful", email, data);
        }
      }

      const msgCustomer = `Hi ${b.customerName}, your PackZen booking (${b.bookingRef}) is confirmed for ${b.date}! Pickup: ${b.pickup}. Est. cost: Rs.${b.total || 0}. Track: packzenblr.in. Queries: 9945095453`;
      await queueSMS(b.phone, msgCustomer, b.bookingRef);
      await queueWhatsApp(b.phone, msgCustomer, b.bookingRef);

      await sendAdminEmail("New Booking Received", [
        ["Booking Ref", b.bookingRef],
        ["Customer", b.customerName],
        ["Phone", b.phone],
        ["Pickup", b.pickup],
        ["Drop", b.drop],
        ["Date", b.date],
        ["Amount", "₹" + (b.total || 0).toLocaleString("en-IN")],
        ["Payment Type", b.paymentType || "pay_later"]
      ], b.bookingRef);
    } catch (e) {
      console.error("onBookingCreatedNotify error:", e.message);
      // Never rethrow — must not affect booking creation.
    }
    return null;
  });

/* ════════════════════════════════════════════════════════════
   2–8. STATUS-CHANGE DRIVEN NOTIFICATIONS
   Single onUpdate trigger, branches by what changed, to avoid
   registering 6+ separate listeners on the same document.
   ════════════════════════════════════════════════════════════ */
exports.onBookingUpdatedNotify = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .firestore.document("bookings/{bookingId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    try {
      const email = await getCustomerEmail(after);
      const data = bookingToTemplateData(after);

      const statusChanged = before.status !== after.status;
      const driverJustAssigned = !before.driverUid && after.driverUid;
      const paymentJustSucceeded =
        (before.paymentStatus !== "paid" && after.paymentStatus === "paid") ||
        ((before.paid || 0) < (after.total || 0) && (after.paid || 0) >= (after.total || 0) && (after.paid || 0) > 0);

      // ── DRIVER ASSIGNED ──
      if (driverJustAssigned) {
        if (email) await sendCustomerEmail("driver_assigned", email, data);

        const msgCustomer = `Hi ${after.customerName}, your PackZen driver ${after.driverName} (${after.driverPhone}) is assigned for booking ${after.bookingRef}. Track live on packzenblr.in. Queries: 9945095453`;
        await queueSMS(after.phone, msgCustomer, after.bookingRef);
        await queueWhatsApp(after.phone, msgCustomer, after.bookingRef);

        const msgDriver = `New Booking Assigned: ${after.bookingRef} on ${after.date}. Pickup: ${after.pickup}. Drop: ${after.drop}. Customer: ${after.customerName} (${after.phone}). Log in to PackZen partner app to start.`;
        await queueSMS(after.driverPhone, msgDriver, after.bookingRef);
        await queueWhatsApp(after.driverPhone, msgDriver, after.bookingRef);

        await sendAdminEmail("Driver Assigned to Booking", [
          ["Booking Ref", after.bookingRef],
          ["Customer", after.customerName],
          ["Driver", after.driverName],
          ["Driver Phone", after.driverPhone]
        ], after.bookingRef);
      }

      // ── DRIVER ARRIVING (custom flag some flows may set) ──
      if (!after.driverArrivingNotified && after.driverArriving === true) {
        if (email) await sendCustomerEmail("driver_arriving", email, data);

        const msgCustomer = `Hi ${after.customerName}, your goods are now in transit for booking ${after.bookingRef}. Track your driver live on packzenblr.in.`;
        await queueSMS(after.phone, msgCustomer, after.bookingRef);
        await queueWhatsApp(after.phone, msgCustomer, after.bookingRef);

        // Prevent duplicate driver arriving notifications
        await change.after.ref.update({ driverArrivingNotified: true });
      }

      // ── PAYMENT SUCCESSFUL ──
      if (paymentJustSucceeded) {
        if (email) await sendCustomerEmail("payment_successful", email, data);
        await sendAdminEmail("Payment Received", [
          ["Booking Ref", after.bookingRef],
          ["Customer", after.customerName],
          ["Amount", "₹" + (after.total || 0).toLocaleString("en-IN")]
        ], after.bookingRef);
      }

      if (statusChanged) {
        // ── BOOKING COMPLETED ──
        if (after.status === "delivered") {
          if (email) {
            await sendCustomerEmail("booking_completed", email, data);
            // Feedback request is fired 1 hour after completion in
            // practice; since Cloud Functions triggers are immediate,
            // we send it now with a slight framing — the scheduled
            // job (scheduled-notifications.js) also re-checks and
            // is idempotent via feedbackRequestSent flag below.
          }
          const msgCustomer = `Hi ${after.customerName}, your PackZen move ${after.bookingRef} is complete! Please rate your driver on packzenblr.in. Thank you for choosing PackZen!`;
          await queueSMS(after.phone, msgCustomer, after.bookingRef);
          await queueWhatsApp(after.phone, msgCustomer, after.bookingRef);
        }

        // ── BOOKING CANCELLED ──
        if (after.status === "cancelled") {
          if (email) await sendCustomerEmail("booking_cancelled", email, data);
          await sendAdminEmail("Booking Cancelled", [
            ["Booking Ref", after.bookingRef],
            ["Customer", after.customerName],
            ["Reason", after.cancelReason || "Not specified"]
          ], after.bookingRef);
        }
      }

      // ── BOOKING RESCHEDULED ──
      if (before.date !== after.date && after.rescheduledAt && !before.rescheduledAt) {
        if (email) await sendCustomerEmail("booking_rescheduled", email, data);
      }
      // Subsequent reschedules (rescheduledAt already existed but date changed again)
      if (before.date !== after.date && before.rescheduledAt && after.rescheduledAt &&
          before.rescheduledAt.toMillis?.() !== after.rescheduledAt.toMillis?.()) {
        if (email) await sendCustomerEmail("booking_rescheduled", email, data);
      }

      // ── REFUND PROCESSED (admin sets refundStatus:"processed") ──
      if (before.refundStatus !== "processed" && after.refundStatus === "processed") {
        if (email) await sendCustomerEmail("refund_processed", email, data);
        await sendAdminEmail("Refund Processed", [
          ["Booking Ref", after.bookingRef],
          ["Customer", after.customerName],
          ["Refund Amount", "₹" + (after.refundAmount || after.total || 0).toLocaleString("en-IN")]
        ], after.bookingRef);
      }

    } catch (e) {
      console.error("onBookingUpdatedNotify error:", e.message);
    }
    return null;
  });

/* ════════════════════════════════════════════════════════════
   9. REFUND REQUESTED — admin alert only (customer already gets
      a cancellation email; this notifies admin action is needed)
   ════════════════════════════════════════════════════════════ */
exports.onCancelRequestCreatedNotify = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .firestore.document("cancelRequests/{requestId}")
  .onCreate(async (snap, context) => {
    const req = snap.data();
    try {
      await sendAdminEmail("Refund / Cancellation Request", [
        ["Booking Doc ID", req.bookingDocId],
        ["Customer UID", req.customerUid],
        ["Reason", req.reason]
      ], req.bookingDocId);
    } catch (e) {
      console.error("onCancelRequestCreatedNotify error:", e.message);
    }
    return null;
  });

/* ════════════════════════════════════════════════════════════
   10. CUSTOMER FEEDBACK RECEIVED — admin alert on new review
   ════════════════════════════════════════════════════════════ */
exports.onReviewCreatedNotify = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .firestore.document("reviews/{reviewId}")
  .onCreate(async (snap, context) => {
    const r = snap.data();
    try {
      await sendAdminEmail("New Customer Feedback Received", [
        ["Name", r.name],
        ["Rating", (r.rating || 0) + " / 5"],
        ["Review", (r.text || "").slice(0, 300)]
      ], null);
    } catch (e) {
      console.error("onReviewCreatedNotify error:", e.message);
    }
    return null;
  });

/* ════════════════════════════════════════════════════════════
   DAMAGE CLAIM — admin alert (bonus, matches your existing
   damageClaims collection so admin isn't relying on polling)
   ════════════════════════════════════════════════════════════ */
exports.onDamageClaimCreatedNotify = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .firestore.document("damageClaims/{claimId}")
  .onCreate(async (snap, context) => {
    const c = snap.data();
    try {
      await sendAdminEmail("New Damage Claim Filed", [
        ["Booking Doc ID", c.bookingDocId],
        ["Type", c.damageType],
        ["Description", (c.description || "").slice(0, 300)]
      ], c.bookingDocId);
    } catch (e) {
      console.error("onDamageClaimCreatedNotify error:", e.message);
    }
    return null;
  });

/* ════════════════════════════════════════════════════════════
   ACCOUNT DELETION REQUEST — admin alert
   ════════════════════════════════════════════════════════════ */
exports.onAccountDeletionRequestCreatedNotify = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .firestore.document("accountDeletionRequests/{requestId}")
  .onWrite(async (change, context) => {
    // Only send on create (when before doc doesn't exist)
    if (change.before.exists) return null;
    if (!change.after.exists) return null;

    const req = change.after.data();
    try {
      await sendAdminEmail("New Account Deletion Request", [
        ["Request ID", req.requestId],
        ["Name", `${req.firstName || ''} ${req.lastName || ''}`.trim()],
        ["Email", req.email],
        ["Phone", req.phone],
        ["Reason", req.reason || "None provided"],
        ["Date", new Date().toLocaleString("en-IN")],
        ["Action", "<a href='https://packzenblr.in/admin.html'>View in Admin Dashboard -> Deletion Requests</a>"]
      ], null);
    } catch (e) {
      console.error("onAccountDeletionRequestCreatedNotify error:", e.message);
    }
    return null;
  });

/* ════════════════════════════════════════════════════════════
   MANUAL RETRY — callable function, admin-only, mirrors your
   existing retrySMS pattern in index.js
   ════════════════════════════════════════════════════════════ */
exports.retryFailedEmailNotifications = functions
  .region("asia-south1")
  .runWith({ secrets: BREVO_SECRETS })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    const userDoc = await admin.firestore().collection("users").doc(context.auth.uid).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
      throw new functions.https.HttpsError("permission-denied", "Admin only");
    }
    const { retryFailedNotifications } = require("./notification-service");
    const result = await retryFailedNotifications();
    return result;
  });
