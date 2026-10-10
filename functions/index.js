const functions = require("firebase-functions/v1");
const admin     = require("firebase-admin");
const https     = require("https");

admin.initializeApp();

const {
  sendBookingConfirmationEmail,
  sendDriverAssignedEmail,
  sendMoveReminderEmail,
  sendBookingCompletedEmail,
  sendReviewRequestEmail
} = require("./booking-notifications");
const { BREVO_SECRETS } = require("./brevo-client");

const { defineSecret } = require("firebase-functions/params");
const MSG91_AUTHKEY       = defineSecret("MSG91_AUTHKEY");
const GOOGLE_MAPS_KEY     = defineSecret("GOOGLE_MAPS_KEY");
const RAZORPAY_KEY_ID     = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
// Pepper for deriving delivery-completion OTPs (completion-otp.js). Set before deploy:
//   firebase functions:secrets:set COMPLETION_OTP_PEPPER   (>= 32 random bytes)
const COMPLETION_OTP_PEPPER = defineSecret("COMPLETION_OTP_PEPPER");
const rateLimit = require("./rate-limit");
const opsAlerts = require("./ops-alerts");
const completionOtp = require("./completion-otp");
/* ============================================================
   SEND SMS VIA MSG91
   Triggered whenever a new doc is added to /smsQueue
   ============================================================ */ 
exports.sendSMS = functions
  .region("asia-south1")            // Mumbai — lowest latency for India
  .runWith({ secrets: [MSG91_AUTHKEY] })
  .firestore.document("smsQueue/{docId}")
  .onWrite(async (change, context) => {
    // Only process if doc was created or updated
    if (!change.after.exists) return null;

    const data   = change.after.data();
    const docRef = change.after.ref;

    // Skip if already processed (safety check)
    if (data.status !== "pending") return null;

    const { mobile, message } = data; 
    if (!mobile || !message) {
      await docRef.update({ status: "failed", error: "Missing mobile or message" });
      return null;
    }

    // Get MSG91 auth key from Firebase environment config
    // Set it with: firebase functions:config:set msg91.authkey="YOUR_KEY" msg91.senderid="PKZNSM"
 // MSG91 auth key from Secret Manager (set via: firebase functions:secrets:set MSG91_AUTHKEY)
    const authKey  = MSG91_AUTHKEY.value();
    const senderId = "PKZNSM";

    if (!authKey) {
      console.error("MSG91 authkey not configured. Run: firebase functions:secrets:set MSG91_AUTHKEY");
      await docRef.update({ status: "failed", error: "MSG91 authkey not set" });
      return null;
    }

    try {
    
      const result = await sendMsg91SMS(authKey, senderId, mobile, message);
      console.log(`✅ SMS sent to ${mobile}:`, result);
      await docRef.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        response: JSON.stringify(result).slice(0, 500)
      });
    } catch (err) {
      console.error(`❌ SMS failed to ${mobile}:`, err.message);
      const retries = (data.retries || 0) + 1;
      await docRef.update({
        status: retries >= 3 ? "failed" : "pending",  // retry up to 3 times
        retries,
        lastError: err.message,
        lastAttempt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return null;
  });


/* ============================================================
   MSG91 HTTP SEND FUNCTION
   Uses MSG91 Flow API (recommended for DLT-registered templates)
   ============================================================ */
function sendMsg91SMS(authKey, senderId, mobile, message) {
  return new Promise((resolve, reject) => {
    // MSG91 Send SMS API (transactional route 4)
    const postData = JSON.stringify({
      sender:    senderId,
      route:     "4",             // Transactional route
      country:   "91",
      sms: [{
        message:  message,
        to:       [mobile]
      }]
    });

    const options = {
      hostname: "api.msg91.com",
      path:     "/api/v2/sendsms",
      method:   "POST",
      headers: {
        "authkey":       authKey,
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.type === "success") resolve(parsed);
          else reject(new Error(parsed.message || body));
        } catch {
          reject(new Error("Invalid response: " + body.slice(0, 200)));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}



/* ============================================================
   SEND WHATSAPP MESSAGE
   Triggered whenever a new doc is added to /whatsappQueue
   ============================================================ */
exports.sendWhatsApp = functions
  .region("asia-south1")
  .firestore.document("whatsappQueue/{docId}")
  .onWrite(async (change, context) => {
    // Only process if doc was created or updated
    if (!change.after.exists) return null;

    const data   = change.after.data();
    const docRef = change.after.ref;

    // Skip if already processed (safety check)
    if (data.status !== "pending") return null;

    const { mobile, message } = data;
    if (!mobile || !message) {
      await docRef.update({ status: "failed", error: "Missing mobile or message" });
      return null;
    }

    try {
      // Placeholder for WhatsApp API (e.g. MSG91 WhatsApp, Meta API, etc.)
      // Since no specific WhatsApp API is provided, we simulate a successful send.
      console.log(`✅ WhatsApp sent to ${mobile}:`, message);
      await docRef.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        response: JSON.stringify({ success: true, dummy: true }).slice(0, 500)
      });
    } catch (err) {
      console.error(`❌ WhatsApp failed to ${mobile}:`, err.message);
      const retries = (data.retries || 0) + 1;
      await docRef.update({
        status: retries >= 3 ? "failed" : "pending",  // retry up to 3 times
        retries,
        lastError: err.message,
        lastAttempt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return null;
  });

/* ============================================================
   OPTIONAL: Admin trigger to manually retry a failed SMS
   Call via Firebase Admin SDK or from admin panel
   ============================================================ */
exports.retrySMS = functions
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    // Only allow admin users
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    const userDoc = await admin.firestore().collection("users").doc(context.auth.uid).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
      throw new functions.https.HttpsError("permission-denied", "Admin only");
    }

    const { docId } = data;
    if (!docId) throw new functions.https.HttpsError("invalid-argument", "docId required");

    await admin.firestore().collection("smsQueue").doc(docId).update({
      status: "pending", retries: 0
    });
    return { success: true };
  });

/* ============================================================
   OPTIONAL: Admin trigger to manually retry a failed WhatsApp msg
   Call via Firebase Admin SDK or from admin panel
   ============================================================ */
exports.retryWhatsApp = functions
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    // Only allow admin users
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    const userDoc = await admin.firestore().collection("users").doc(context.auth.uid).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
      throw new functions.https.HttpsError("permission-denied", "Admin only");
    }

    const { docId } = data;
    if (!docId) throw new functions.https.HttpsError("invalid-argument", "docId required");

    await admin.firestore().collection("whatsappQueue").doc(docId).update({
      status: "pending", retries: 0
    });
    return { success: true };
  });

const Razorpay = require("razorpay");
const PackZenPricing = require("./pricing-engine-v2.js");

const cors = require("cors")({
  origin: [
    "https://packzenblr.in",
    "https://www.packzenblr.in",
    "http://localhost:5000"
  ]
});

async function getGoogleMapsDistance(pickup, drop) {
  if (!pickup || !drop) return 0;
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(drop)}&key=${GOOGLE_MAPS_KEY.value()}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
      return data.rows[0].elements[0].distance.value / 1000;
    }
  } catch (err) {
    console.error("Google Maps Distance API error:", err);
  }
  return 0;
}

async function calculateServerQuote(quoteInput, pickup, drop) {
  const computedKm = await getGoogleMapsDistance(pickup, drop);
  if (computedKm > 0) {
    quoteInput.km = computedKm;
  } else if (quoteInput.km) {
    if (computedKm === 0) {
      throw new Error("Could not calculate distance server-side.");
    }
  }
  // Strict sanitization of quantities
  if (quoteInput.furniture) {
    for (const [key, qty] of Object.entries(quoteInput.furniture)) {
      const parsedQty = parseInt(qty, 10) || 0;
      if (parsedQty < 0) throw new Error("Invalid item quantity.");
      quoteInput.furniture[key] = parsedQty;
    }
  }

  quoteInput.cartonQty = parseInt(quoteInput.cartonQty, 10) || 0;
  if (quoteInput.cartonQty < 0) throw new Error("Invalid item quantity.");

  quoteInput.pickupFloor = parseInt(quoteInput.pickupFloor, 10) || 0;
  if (quoteInput.pickupFloor < 0) throw new Error("Invalid floor count.");

  quoteInput.dropFloor = parseInt(quoteInput.dropFloor, 10) || 0;
  if (quoteInput.dropFloor < 0) throw new Error("Invalid floor count.");

  // Check if vehicle exists
  if (quoteInput.vehicleId && !PackZenPricing.vehicles[quoteInput.vehicleId]) {
     throw new Error("Unknown vehicle ID.");
  }

  const validation = PackZenPricing.validateInput(quoteInput);
  if (!validation.valid) {
    throw new Error("Validation error: " + validation.errors.join(", "));
  }

  const quote = PackZenPricing.calculateQuote(quoteInput);
  if (!quote.valid) {
    throw new Error("Pricing error: " + quote.errors.join(", "));
  }
  return quote;
}


exports.createBooking = functions
  .region("asia-south1")
  .runWith({ secrets: [GOOGLE_MAPS_KEY] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be logged in to create a booking.");
    }
    const rl = await rateLimit.consumeAll(admin.firestore(), [
      Object.assign({ scope: "bookingUid", subject: context.auth.uid }, rateLimit.LIMITS.bookingUid),
      Object.assign({ scope: "bookingIp", subject: rateLimit.clientIp(context.rawRequest) }, rateLimit.LIMITS.bookingIp),
    ], functions.logger);
    if (!rl.ok) throw new functions.https.HttpsError("resource-exhausted", "Too many bookings in a short time. Please wait a few minutes.");

    const { quoteInput, bookingDetails } = data;
    if (!quoteInput || !bookingDetails || !bookingDetails.pickup || !bookingDetails.drop) {
      throw new functions.https.HttpsError("invalid-argument", "Missing required booking input.");
    }

    if (bookingDetails.bookingRef) {
      const existingSnap = await admin.firestore().collection("bookings")
        .where("bookingRef", "==", bookingDetails.bookingRef)
        .where("customerUid", "==", context.auth.uid)
        .limit(1).get();
      if (!existingSnap.empty) {
        return { docId: existingSnap.docs[0].id, duplicate: true };
      }
    }

    let quote;
    try {
      quote = await calculateServerQuote(quoteInput, bookingDetails.pickup, bookingDetails.drop);
    } catch (e) {
      throw new functions.https.HttpsError("invalid-argument", e.message);
    }

    const safeFields = [
      "bookingRef", "customerName", "phone", "altPhone", "email", "pickup", "drop",
      "date", "shiftTime", "shiftTimeLabel", "moveType", "house", "vehicle", "furniture",
      "pickupFloor", "dropFloor", "liftAvailable", "packingService", "unpackingService",
      "dismantling", "assembly", "storageNeeded", "storageDays", "fragileItems",
      "specialItems", "remarks", "paymentType", "source", "isIntercity",
      "photos"
    ];

    const finalPayload = {};
    for (const key of safeFields) {
      if (bookingDetails[key] !== undefined) finalPayload[key] = bookingDetails[key];
    }

      finalPayload.customerUid = context.auth.uid;
    finalPayload.total = quote.finalTotal;
    finalPayload.distance = quote.km;
    finalPayload.originalTotal = quote.finalTotal;
    finalPayload.quoteBreakdown = quote.breakdown;
    finalPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    finalPayload.status = "confirmed"; // Enforce safe initial status
    finalPayload.paid = 0; // this function is only ever used for the pay-later flow — nothing has been collected yet
    finalPayload.balanceDue = quote.finalTotal;
    finalPayload.paymentStatus = "unpaid";
    finalPayload.currency = "INR";

    const docRef = await admin.firestore().collection("bookings").add(finalPayload);
    return { docId: docRef.id, total: quote.finalTotal };
  });

const movePayment = require("./move-payment");

// Shared wiring for the two move-payment HTTPS endpoints. All logic lives in
// move-payment.js (Phase 1 payment correctness); this only injects I/O.
function movePaymentDeps(extra) {
  return Object.assign({
    verifyIdToken: (token) => admin.auth().verifyIdToken(token),
    db: admin.firestore(),
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    now: () => Date.now(),
    logger: functions.logger,
    recordFailure: (source, code) => opsAlerts.recordFailure(admin.firestore(), source, code),
  }, extra);
}

exports.createRazorpayOrder = functions
  .region("asia-south1")
  .runWith({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, GOOGLE_MAPS_KEY] })
  .https.onRequest((req, res) => cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed." });
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    const out = await movePayment.handleCreateOrder(req, movePaymentDeps({
      rateLimit: (uid, r) => rateLimit.consumeAll(admin.firestore(), [
        Object.assign({ scope: "moveOrderUid", subject: uid }, rateLimit.LIMITS.moveOrderUid),
        Object.assign({ scope: "moveOrderIp", subject: rateLimit.clientIp(r) }, rateLimit.LIMITS.moveOrderIp),
      ], functions.logger),
      quote: (quoteInput, pickup, drop) => calculateServerQuote(quoteInput, pickup, drop),
      normalize: (quoteInput) => {
        const v = PackZenPricing.validateInput(quoteInput);
        return v && v.data ? v.data : quoteInput;
      },
      createOrder: (o) => razorpay.orders.create(o),
    }));
    return res.status(out.status).json(out.body);
  }));

exports.verifyRazorpayPayment = functions
  .region("asia-south1")
  .runWith({ secrets: [...BREVO_SECRETS, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .https.onRequest((req, res) => cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed." });
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    const out = await movePayment.handleVerifyPayment(req, movePaymentDeps({
      keySecret: RAZORPAY_KEY_SECRET.value(),
      fetchPayment: (paymentId) => razorpay.payments.fetch(paymentId),
      sendConfirmation: (data) => sendBookingConfirmationEmail(data),
    }));
    return res.status(out.status).json(out.body);
  }));

/* ═══ R3 — Razorpay webhook, reconciliation, admin refunds ═══
   Logic: payment-webhook.js / payment-refund.js. Booking creation is shared
   with verifyRazorpayPayment via move-payment.finalizeCapture (one model). */
const paymentWebhook = require("./payment-webhook");
const paymentRefund = require("./payment-refund");
const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");

// Server-to-server only (no CORS). Configure in Razorpay Dashboard → Webhooks:
// payment.authorized, payment.captured, payment.failed, order.paid,
// refund.created, refund.processed, refund.failed.
exports.razorpayWebhook = functions
  .region("asia-south1")
  .runWith({ secrets: [...BREVO_SECRETS, RAZORPAY_WEBHOOK_SECRET] })
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("");
    const out = await paymentWebhook.handleWebhook(req, movePaymentDeps({
      webhookSecret: RAZORPAY_WEBHOOK_SECRET.value(),
      sendConfirmation: (data) => sendBookingConfirmationEmail(data),
    }));
    return res.status(out.status).json(out.body);
  });

// Finds move payments whose browser verification and webhook were both lost.
exports.reconcileRazorpayPayments = functions
  .region("asia-south1")
  .runWith({ secrets: [...BREVO_SECRETS, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    await paymentWebhook.reconcilePendingPayments(movePaymentDeps({
      fetchOrderPayments: async (orderId) => {
        const r = await razorpay.orders.fetchPayments(orderId);
        return (r && r.items) || [];
      },
      sendConfirmation: (data) => sendBookingConfirmationEmail(data),
    }));
    return null;
  });

// Admin-only. Amount is validated server-side against what is still refundable.
exports.adminRefundPayment = functions
  .region("asia-south1")
  .runWith({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .https.onCall(async (data, context) => {
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    return paymentRefund.handleRefund(data, context, movePaymentDeps({
      isAdmin: async (ctx) => {
        if (!ctx || !ctx.auth || !ctx.auth.token || ctx.auth.token.email_verified !== true) return false;
        const u = await admin.firestore().collection("users").doc(ctx.auth.uid).get();
        return u.exists && u.data().role === "admin";
      },
      createRefund: (paymentId, opts) => razorpay.payments.refund(paymentId, opts),
      toClientError: (code, message) => new functions.https.HttpsError(code, message),
    }));
  });

/* === Phase 1 automation: completion OTP + exception alerting === */
async function staffRole(context) {
  if (!context || !context.auth) return null;
  const u = await admin.firestore().collection("users").doc(context.auth.uid).get();
  return u.exists ? u.data().role || null : null;
}
function completionOtpDeps() {
  const { sendCustomerEmail } = require("./notification-service");
  return {
    db: admin.firestore(),
    now: () => Date.now(),
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    pepper: COMPLETION_OTP_PEPPER.value(),
    logger: functions.logger,
    sendCustomerEmail,
    isAdmin: async (ctx) => !!(ctx.auth && ctx.auth.token && ctx.auth.token.email_verified === true && (await staffRole(ctx)) === "admin"),
    isDriver: async (ctx) => (await staffRole(ctx)) === "driver",
    rateLimit: (scope, subject) => rateLimit.consume(admin.firestore(), Object.assign({ scope, subject }, rateLimit.LIMITS[scope])),
  };
}
const toHttpsError = (code, message) => new functions.https.HttpsError(code, message);

// Customer (booking owner) reads the 4-digit completion code for an active job.
exports.getCompletionOtp = functions.region("asia-south1").runWith({ secrets: [COMPLETION_OTP_PEPPER] })
  .https.onCall(completionOtp.callable(completionOtp.handleGetOtp, completionOtpDeps, toHttpsError));
// Assigned driver (or admin) asks for the code to be emailed to the customer.
exports.sendCompletionOtp = functions.region("asia-south1").runWith({ secrets: [...BREVO_SECRETS, COMPLETION_OTP_PEPPER] })
  .https.onCall(completionOtp.callable(completionOtp.handleSendOtp, completionOtpDeps, toHttpsError));
// Assigned driver (or admin) submits the code; only success marks the booking delivered.
exports.verifyCompletionOtp = functions.region("asia-south1").runWith({ secrets: [COMPLETION_OTP_PEPPER] })
  .https.onCall(completionOtp.callable(completionOtp.handleVerifyOtp, completionOtpDeps, toHttpsError));

// Admin-only emergency completion without the customer's code (reason recorded).
exports.adminCompleteBooking = functions.region("asia-south1").runWith({ secrets: [COMPLETION_OTP_PEPPER] })
  .https.onCall(completionOtp.callable(completionOtp.handleAdminOverride, completionOtpDeps, toHttpsError));

/* === Phase 2A/2B: driver profiles, shadow recommendations, manual assignment === */
const driverProfile = require("./driver-profile");
const assignment = require("./assignment");
function staffDeps() {
  return {
    db: admin.firestore(), now: () => Date.now(), logger: functions.logger,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    isAdmin: async (ctx) => !!(ctx.auth && ctx.auth.token && ctx.auth.token.email_verified === true && (await staffRole(ctx)) === "admin"),
    isAdvisor: async (ctx) => (await staffRole(ctx)) === "advisor",
  };
}
function staffCallable(handler, ErrClass) {
  return async (data, context) => {
    try { return await handler(data, context, staffDeps()); }
    catch (e) {
      if (e instanceof ErrClass) throw new functions.https.HttpsError(e.code, e.publicMessage, e.detail ? { reasons: e.detail } : undefined);
      functions.logger.error("staff_callable_error", { message: String(e && e.message).slice(0, 120) });
      throw new functions.https.HttpsError("internal", "Something went wrong. Please try again.");
    }
  };
}
// Admin creates/updates driverProfiles/{uid} (validated; no client writes allowed by rules).
exports.adminUpsertDriverProfile = functions.region("asia-south1").https.onCall(staffCallable(driverProfile.handleUpsert, driverProfile.ProfileError));
// Admin: compute (and store) the shadow-mode recommendation for one booking. Never assigns.
exports.adminGetAssignmentRecommendation = functions.region("asia-south1").https.onCall(staffCallable(assignment.handleRecommend, assignment.AssignError));
// Admin/advisor: manual assignment in one transaction (booking + schedule lock + users.currentBooking).
// The ONLY way to set booking.driverUid (firestore.rules block client writes of driver fields).
exports.adminAssignDriver = functions.region("asia-south1").https.onCall(staffCallable(assignment.handleAssign, assignment.AssignError));
// Shadow mode: every 30 min store recommendations for unassigned bookings in the next 3 days.
// Disable with Firestore appConfig/assignment { shadowEnabled: false } or by pausing the scheduler job.
exports.shadowAssignmentSweep = functions.region("asia-south1")
  .pubsub.schedule("every 30 minutes").timeZone("Asia/Kolkata")
  .onRun(async () => { await assignment.shadowSweep(staffDeps()); return null; });

// Hourly exception digest -> admin email only when something new needs attention.
exports.opsDigest = functions.region("asia-south1").runWith({ secrets: [...BREVO_SECRETS] })
  .pubsub.schedule("every 60 minutes").timeZone("Asia/Kolkata")
  .onRun(async () => {
    const { sendAdminEmail } = require("./notification-service");
    await opsAlerts.runOpsDigest({ db: admin.firestore(), now: () => Date.now(), logger: functions.logger,
      sendAdminEmail: (subject, rows) => sendAdminEmail(subject, rows, null) });
    return null;
  });

// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
Object.assign(exports, require("./notifications"));
Object.assign(exports, require("./scheduled-notifications"));
Object.assign(exports, require("./auth-emails"));
Object.assign(exports, require("./oauth-profile"));
// Catalog bookings (additive — catalog-booking.js): pay-later, online payment, verification
Object.assign(exports, require("./catalog-booking"));
