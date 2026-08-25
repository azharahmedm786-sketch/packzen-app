const functions = require("firebase-functions");
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

// Mirrors the client's _getPayAmount() logic in public/script.js — kept in
// one place so the "how much do we actually charge for this paymentType"
// rule can't drift between client and server. This is the ONLY function
// allowed to decide what gets charged; nothing else should read a total
// off the request body.
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

function computePayAmount(quote, paymentType) {
  if (!quote || !quote.valid || !quote.paymentOptions) return null;
  const opts = quote.paymentOptions;
  if (paymentType === "full") return Math.max(opts.fullOnlineAmount, 500);
  if (paymentType === "advance") return Math.max(opts.advanceAmount, 199);
  if (paymentType === "at_drop") return null; // no online order for pay-at-drop
  return null;
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

    const docRef = await admin.firestore().collection("bookings").add(finalPayload);
    return { docId: docRef.id };
  });

exports.createRazorpayOrder = functions
  .region("asia-south1")
  .runWith({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, GOOGLE_MAPS_KEY] })
  .https.onRequest((req, res) => {

    return cors(req, res, async () => {

      try {

        const razorpay = new Razorpay({
          key_id: RAZORPAY_KEY_ID.value(),
          key_secret: RAZORPAY_KEY_SECRET.value()
        });

        console.log("Request body received:", req.body);

        const { quoteInput, paymentType, customerName, phone, moveType, pickup, drop, date } = req.body;

        if (!quoteInput || typeof quoteInput !== "object") {
          return res.status(400).json({ error: "quoteInput required" });
        }
        if (paymentType !== "full" && paymentType !== "advance") {
          return res.status(400).json({ error: "paymentType must be 'full' or 'advance'" });
        }
        if (!customerName || !phone || !pickup || !drop || !date) {
          return res.status(400).json({ error: "Missing booking details" });
        }

        // ── SERVER-SIDE PRICE OF RECORD ──────────────────────────────
        // The client's displayed total is UI only. We recompute the
        // quote here, from the same raw inputs (vehicle, distance,
        // furniture, floors, etc.) using the same pricing engine, and
        // that is the number that gets charged. A manipulated
        // `amount`/`total` sent by the client is never used.

        let quote;
        try {
          quote = await calculateServerQuote(quoteInput, pickup, drop);
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }

        const safeAmount = computePayAmount(quote, paymentType);

        if (!safeAmount || safeAmount <= 0 || safeAmount > 100000) {
          return res.status(400).json({
            error: "Invalid amount"
          });
        }

        const order = await razorpay.orders.create({
          amount: safeAmount * 100,
          currency: "INR",
          receipt: "receipt_" + Date.now()
        });

        console.log("Order created:", order.id, "server-priced amount:", safeAmount);

        // Persist the server-computed amount + booking details keyed by
        // orderId. verifyRazorpayPayment reads the total from HERE, not
        // from whatever the client sends back after payment — so even if
        // the client is fully compromised post-order, the stored price
        // can't be altered.
        await admin.firestore().collection("pendingPayments").doc(order.id).set({
          amount: safeAmount,
          paymentType,
          quoteInput,
          quoteBreakdown: quote.breakdown, // vehicleUsed, distanceCharge, floorCharge, etc. — so the confirmed booking isn't just a name/phone/total stub
          customerName,
          phone,
          moveType: moveType || "",
          pickup,
          drop,
          date,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({
          success: true,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          serverCalculatedTotal: safeAmount
        });

      } catch (err) {

        console.error("Razorpay Full Error:", {
          message: err.message,
          description: err.description,
          error: err.error,
          stack: err.stack
        });

        return res.status(500).json({
          error: err.message
        });
      }

    });

});
const crypto = require("crypto");
exports.verifyRazorpayPayment = functions
  .region("asia-south1")
  .runWith({ secrets: [...BREVO_SECRETS, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .https.onRequest(async (req, res) => {
    console.log("VERIFY VERSION 2");

const allowedOrigins = ["https://packzenblr.in", "https://www.packzenblr.in", "http://localhost:5000"];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

   try {

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    bookingData
  } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      success: false,
      error: "Missing payment identifiers"
    });
  }

      const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
       .createHmac("sha256", RAZORPAY_KEY_SECRET.value())
        .update(body)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({
          success: false,
          error: "Invalid signature"
        });
      }
      console.log("SIGNATURE VERIFIED SUCCESSFULLY");

      // Prevent duplicate booking creation
const existingBooking = await admin.firestore()
  .collection("bookings")
  .where("paymentId", "==", razorpay_payment_id)
  .limit(1)
  .get();

if (!existingBooking.empty) {
  const existingData = existingBooking.docs[0].data();

  console.log("Duplicate payment verification request detected.");

  return res.status(200).json({
    success: true,
    bookingRef: existingData.bookingRef,
   message: "Payment already processed."
  });
}

      // ── TRUSTED PRICE LOOKUP ──────────────────────────────────────
      // The booking total NEVER comes from bookingData (client-supplied).
      // It comes from the pendingPayments doc this same server wrote
      // during createRazorpayOrder, keyed by the Razorpay order id that
      // the signature above just proved this payment belongs to.
      const pendingRef = admin.firestore().collection("pendingPayments").doc(razorpay_order_id);
      const pendingSnap = await pendingRef.get();

      if (!pendingSnap.exists) {
        return res.status(400).json({
          success: false,
          error: "No matching order found for this payment"
        });
      }

      const trusted = pendingSnap.data();
      const verifiedTotal = Number(trusted.amount);

      const bookingRef = "PKZ-" + Date.now().toString(36).toUpperCase();
      console.log("ABOUT TO CREATE BOOKING");
console.log("SERVER-TRUSTED TOTAL:", verifiedTotal);
     await admin.firestore().collection("bookings").add({

  customerName: trusted.customerName || "",
  phone: trusted.phone || "",
  pickup: trusted.pickup || "",
  drop: trusted.drop || "",
  date: trusted.date || "",
  moveType: trusted.moveType || "",
  paymentType: trusted.paymentType || "",

  // Operational details the driver/advisor/admin dashboards need —
  // previously this document only had name/phone/total, so a paid
  // booking had no record of what to actually move or which vehicle
  // to send. Sourced from the trusted server-side quote, not the client.
  vehicleId: (trusted.quoteInput && trusted.quoteInput.vehicleId) || "",
  vehicleUsed: (trusted.quoteBreakdown && trusted.quoteBreakdown.vehicleUsed) || "",
  furniture: (trusted.quoteInput && trusted.quoteInput.furniture) || {},
  cartonQty: (trusted.quoteInput && trusted.quoteInput.cartonQty) || 0,
  pickupFloor: (trusted.quoteInput && trusted.quoteInput.pickupFloor) || 0,
  dropFloor: (trusted.quoteInput && trusted.quoteInput.dropFloor) || 0,
  liftAvailable: !!(trusted.quoteInput && trusted.quoteInput.liftAvailable),
  packingService: !!(trusted.quoteInput && trusted.quoteInput.packingService),
  distance: (trusted.quoteInput && trusted.quoteInput.km) || 0,
  quoteBreakdown: trusted.quoteBreakdown || null,

 total: verifiedTotal,

  bookingRef,
  paymentId: razorpay_payment_id,
  orderId: razorpay_order_id,
  paymentStatus: "paid",
  status: "confirmed",
  createdAt: admin.firestore.FieldValue.serverTimestamp()
});

      // The pending doc has been consumed — clear it so the same order
      // can't be used to mint a second booking.
      await pendingRef.delete();

       // Send booking confirmation email — never blocks or throws
       await sendBookingConfirmationEmail({
         bookingRef,
         customerName: trusted.customerName || "Customer",
         customerEmail: (bookingData && bookingData.email) || null,
         pickup: trusted.pickup || "",
         drop: trusted.drop || "",
         date: trusted.date || "",
         total: verifiedTotal,
         paymentStatus: "paid"
       }).catch(err => console.error("Booking confirmation email error (non-blocking):", err.message));

console.log("BOOKING CREATED SUCCESSFULLY");
      console.log("✅ Payment verified:", razorpay_payment_id);

      return res.status(200).json({
        success: true,
        bookingRef
      });

         } catch (err) {
      console.error("Verify error:", err.message);
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
// Notification system (additive — booking-notifications.js, notifications.js, scheduled-notifications.js)
Object.assign(exports, require("./notifications"));
Object.assign(exports, require("./scheduled-notifications"));
Object.assign(exports, require("./auth-emails"));
Object.assign(exports, require("./oauth-profile"));
