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
      "specialItems", "remarks", "paymentType", "source", "isIntercity", "deliveryOtp",
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

// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
Object.assign(exports, require("./notifications"));
Object.assign(exports, require("./scheduled-notifications"));
Object.assign(exports, require("./auth-emails"));
Object.assign(exports, require("./oauth-profile"));
// Catalog bookings (additive — catalog-booking.js): pay-later, online payment, verification
Object.assign(exports, require("./catalog-booking"));
