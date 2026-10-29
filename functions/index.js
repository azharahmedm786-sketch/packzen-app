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
const { claimPending } = require("./queue-claim");
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
    // OTP-only policy (owner decision, Oct 2026): SMS is used only for one-time codes.
    // Confirmations, assignments, reminders etc. go by e-mail / WhatsApp / the app instead.
    if (data.kind !== "otp") {
      await docRef.update({ status: "skipped", reason: "sms_otp_only_policy", skippedAt: admin.firestore.FieldValue.serverTimestamp() });
      return null;
    }
    // Claim it first so a duplicate trigger can't send the same SMS twice.
    if (!(await claimPending(admin.firestore(), docRef))) return null;

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

    // No WhatsApp provider is connected yet. This used to mark every message
    // "sent" without sending anything; record the truth instead so the queue
    // and ops reports don't claim deliveries that never happened.
    await docRef.update({
      status: "not_sent",
      error: "No WhatsApp provider configured",
      lastAttempt: admin.firestore.FieldValue.serverTimestamp()
    });

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

// Returns { km, originAddress, destinationAddress } — Google's formatted addresses
// (which carry the pincode) are used for the service-area check.
async function getGoogleMapsRoute(pickup, drop) {
  const out = { km: 0, originAddress: "", destinationAddress: "" };
  if (!pickup || !drop) return out;
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(drop)}&key=${GOOGLE_MAPS_KEY.value()}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "OK") {
      out.originAddress = (data.origin_addresses && data.origin_addresses[0]) || "";
      out.destinationAddress = (data.destination_addresses && data.destination_addresses[0]) || "";
      if (data.rows[0].elements[0].status === "OK") out.km = data.rows[0].elements[0].distance.value / 1000;
    }
  } catch (err) {
    console.error("Google Maps Distance API error:", err);
  }
  return out;
}
async function getGoogleMapsDistance(pickup, drop) {
  return (await getGoogleMapsRoute(pickup, drop)).km;
}

// P0: discounts are server-authoritative (promo.js). Only quoteInput.promoCode is
// honoured; any client promoDiscount/total is discarded before pricing.
const promo = require("./promo");
const pricingGuard = require("./pricing-guard");
const serviceArea = require("./service-area");

async function calculateServerQuote(quoteInput, pickup, drop, opts) {
  // Offers that depend on the move date (weekday saver) use the BOOKING's date,
  // never a date the browser put in the price input.
  quoteInput.moveDate = (opts && typeof opts.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) ? opts.date : "";
  // Pricing integrity: distance always comes from the server. If Maps can't
  // measure the route we refuse to price rather than fall back to 0 km.
  const route = await getGoogleMapsRoute(pickup, drop);
  // Service area: moves must START in Bangalore (destination may be anywhere).
  const area = serviceArea.checkAddress(route.originAddress, pickup);
  if (!area.ok) throw new Error(serviceArea.messageFor(area, "pickup"));
  quoteInput.km = pricingGuard.requireServerDistance(route.km);
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

  const calc = async (qi) => {
    const validation = PackZenPricing.validateInput(qi);
    if (!validation.valid) {
      throw new Error("Validation error: " + validation.errors.join(", "));
    }
    const quote = PackZenPricing.calculateQuote(qi);
    if (!quote.valid) {
      throw new Error("Pricing error: " + quote.errors.join(", "));
    }
    return quote;
  };
  return promo.priceWithPromo(quoteInput, calc, { db: admin.firestore(), now: () => Date.now(), uid: (opts && opts.uid) || null });
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
      quote = await calculateServerQuote(quoteInput, bookingDetails.pickup, bookingDetails.drop, { uid: context.auth.uid, date: bookingDetails.date });
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
    finalPayload.pricedInput = pricingGuard.pricedInputSnapshot(quoteInput, quote); // what the total was actually computed from
    finalPayload.promoCode = quote.promo ? quote.promo.code : null;       // server-validated
    finalPayload.promoDiscount = quote.promo ? quote.promo.applied : 0;   // server-computed
    finalPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    finalPayload.status = "confirmed"; // Enforce safe initial status
    finalPayload.paymentType = "pay_later"; // this callable only creates pay-later bookings; never trust the client label
    finalPayload.paid = 0; // this function is only ever used for the pay-later flow — nothing has been collected yet
    finalPayload.balanceDue = quote.finalTotal;
    finalPayload.paymentStatus = "unpaid";
    finalPayload.currency = "INR";

    const docRef = await admin.firestore().collection("bookings").add(finalPayload);
    return { docId: docRef.id, total: quote.finalTotal };
  });

/* ── Advisor / staff manual booking ("phone booking") ──────────────────────────
   Same pricing (calculateServerQuote), same record shape and same Pay-Later rules as
   createBooking — so confirmation e-mail, ops board, assignment, completion code,
   reviews and follow-ups all behave exactly like a website booking.
   ops: "quote" (price preview, no write) | "create".
   Customer: e-mail → existing account or a new one (set-password link returned so the
   advisor can WhatsApp it; the booking then shows in My Bookings); no e-mail → matched
   by phone in users, else a guest booking (customerUid null).                       */
const STAFF_BOOKING_ROLES = ["admin", "manager", "advisor"];
exports.advisorCreateBooking = functions.region("asia-south1").runWith({ secrets: [GOOGLE_MAPS_KEY] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");
    const OWNER_EMAILS = ["azharahmedm786@gmail.com", "azharahmednaz@gmail.com", "moveeasyblr@gmail.com"];   // same allow-list as firestore.rules isAdmin
    const role = OWNER_EMAILS.includes(String(context.auth.token.email || "").toLowerCase()) && context.auth.token.email_verified ? "admin" : await staffRole(context);
    if (!STAFF_BOOKING_ROLES.includes(role)) throw new functions.https.HttpsError("permission-denied", "Only PackZen staff can create bookings for customers.");
    const rl = await rateLimit.consumeAll(admin.firestore(), [Object.assign({ scope: "advisorBooking", subject: context.auth.uid }, { limit: 60, windowMs: 10 * 60 * 1000 })], functions.logger);
    if (!rl.ok) throw new functions.https.HttpsError("resource-exhausted", "Too many requests. Please wait a minute.");
    const op = data && data.op;
    const quoteInput = data && data.quoteInput, d = (data && data.bookingDetails) || {};
    if (!quoteInput || typeof quoteInput !== "object" || !d.pickup || !d.drop) throw new functions.https.HttpsError("invalid-argument", "Enter pickup and drop addresses.");
    if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) throw new functions.https.HttpsError("invalid-argument", "Invalid date.");
    const name = String(d.customerName || "").replace(/[<>]/g, "").trim().slice(0, 80);
    const phone = String(d.phone || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
    const email = String(d.email || "").trim().toLowerCase().slice(0, 120);
    let quote;
    try { quote = await calculateServerQuote(JSON.parse(JSON.stringify(quoteInput)), String(d.pickup), String(d.drop), { uid: null, date: d.date }); }
    catch (e) { throw new functions.https.HttpsError("invalid-argument", e.message); }
    if (op === "quote") return { total: quote.finalTotal, km: quote.km, breakdown: quote.breakdown, promo: quote.promo || null };
    if (op !== "create") throw new functions.https.HttpsError("invalid-argument", "Unknown action.");
    if (name.length < 2) throw new functions.https.HttpsError("invalid-argument", "Enter the customer's name.");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new functions.https.HttpsError("invalid-argument", "Enter a valid 10-digit mobile number.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new functions.https.HttpsError("invalid-argument", "Check the e-mail address.");
    if (!d.date) throw new functions.https.HttpsError("invalid-argument", "Choose the moving date.");
    const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(String(data.requestId || "")) ? String(data.requestId) : null;
    const db = admin.firestore();
    if (requestId) {   // double-click / retry safety
      const dup = await db.collection("bookings").where("advisorRequestId", "==", requestId).limit(1).get();
      if (!dup.empty) { const x = dup.docs[0].data(); return { docId: dup.docs[0].id, bookingRef: x.bookingRef, total: x.total, duplicate: true }; }
    }
    // Resolve / create the customer account
    let customerUid = null, setPasswordLink = null, accountCreated = false;
    if (email) {
      let u = null; try { u = await admin.auth().getUserByEmail(email); } catch (e) { u = null; }
      if (u) {
        const ud = await db.collection("users").doc(u.uid).get();
        const r = ud.exists ? (ud.data() || {}).role : null;
        if (r && r !== "customer") throw new functions.https.HttpsError("failed-precondition", "That e-mail belongs to a staff or partner account. Use the customer's own e-mail.");
        customerUid = u.uid;
      } else {
        u = await admin.auth().createUser({ email, displayName: name, password: require("crypto").randomBytes(18).toString("base64url") });
        customerUid = u.uid; accountCreated = true;
        await db.collection("users").doc(u.uid).set({ name, email, phone, role: "customer", createdByStaff: context.auth.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        try { setPasswordLink = await admin.auth().generatePasswordResetLink(email); } catch (e) { setPasswordLink = null; }
      }
    } else {
      const byPhone = await db.collection("users").where("phone", "==", phone).limit(2).get();
      const cust = byPhone.docs.find((x) => ((x.data() || {}).role || "customer") === "customer");
      if (cust) customerUid = cust.id;
    }
    // Promos tied to "first booking" are checked against the real customer
    if (customerUid && quoteInput.promoCode) {
      try { quote = await calculateServerQuote(JSON.parse(JSON.stringify(quoteInput)), String(d.pickup), String(d.drop), { uid: customerUid, date: d.date }); }
      catch (e) { throw new functions.https.HttpsError("invalid-argument", e.message); }
    }
    const SAFE = ["date", "shiftTime", "shiftTimeLabel", "moveType", "house", "vehicle", "furniture", "pickupFloor", "dropFloor", "liftAvailable",
      "packingService", "unpackingService", "dismantling", "assembly", "fragileItems", "specialItems", "remarks", "isIntercity", "altPhone", "leadSource"];
    const b = {};
    for (const k of SAFE) if (d[k] !== undefined) b[k] = typeof d[k] === "string" ? d[k].slice(0, 500) : d[k];
    Object.assign(b, {
      bookingRef: "PKZ-" + Date.now().toString(36).toUpperCase().slice(-6),
      customerName: name, phone, email: email || null, pickup: String(d.pickup).slice(0, 300), drop: String(d.drop).slice(0, 300),
      customerUid, source: "advisor", createdByStaff: { uid: context.auth.uid, email: context.auth.token.email || null, role },
      createdByAdvisor: context.auth.token.email || context.auth.uid,   // read by advisor → Advisor Stats
      advisorRequestId: requestId,
      total: quote.finalTotal, distance: quote.km, originalTotal: quote.finalTotal, quoteBreakdown: quote.breakdown,
      pricedInput: pricingGuard.pricedInputSnapshot(quoteInput, quote),
      promoCode: quote.promo ? quote.promo.code : null, promoDiscount: quote.promo ? quote.promo.applied : 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), status: "confirmed",
      paymentType: "pay_later", paid: 0, balanceDue: quote.finalTotal, paymentStatus: "unpaid", currency: "INR",
    });
    const ref = await db.collection("bookings").add(b);
    functions.logger.info("advisor_booking", { bookingId: ref.id, by: context.auth.uid, accountCreated, guest: !customerUid });
    return { docId: ref.id, bookingRef: b.bookingRef, total: b.total, km: b.distance, customerLinked: !!customerUid, accountCreated, setPasswordLink };
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
      quote: (quoteInput, pickup, drop, opts) => calculateServerQuote(quoteInput, pickup, drop, opts),
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
    queueSms: (mobile, message, bookingRef, kind) => admin.firestore().collection("smsQueue").add({ mobile, message, bookingRef: bookingRef || null, kind: kind || "info", status: "pending", retries: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() }),
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
exports.adminCompleteBooking = functions.region("asia-south1").runWith({ secrets: [COMPLETION_OTP_PEPPER, ...BREVO_SECRETS] })
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
    isDriver: async (ctx) => (await staffRole(ctx)) === "driver",
    alert: (subject, rows) => require("./notification-service").sendAdminEmail(subject, rows, null),
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
// Admin: approve / reject a partner application. Approval makes the partner a working
// crew member (role driver + active driverProfile) so they receive job offers.
const partnerReview = require("./partner-review");
exports.adminReviewPartner = functions.region("asia-south1").https.onCall(async (data, context) => {
  const deps = Object.assign(staffDeps(), {
    notify: async ({ phone, name, approved, reason }) => {
      if (!/^[6-9]\d{9}$/.test(String(phone || ""))) return;
      const message = approved
        ? `PackZen: congratulations ${name}, your partner account is approved! Sign in at packzenblr.in/driver.html with your registered email to receive jobs.`
        : `PackZen: hi ${name}, we couldn't approve your partner application: ${reason}. Reply or call 9945095453 to update your details.`;
      await admin.firestore().collection("smsQueue").add({ mobile: phone, message, status: "pending", retries: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    },
  });
  try { return await partnerReview.handleReview(data, context, deps); }
  catch (e) {
    if (e instanceof partnerReview.ReviewError) throw new functions.https.HttpsError(e.code, e.publicMessage);
    functions.logger.error("partner_review_error", { message: String(e && e.message).slice(0, 120) });
    throw new functions.https.HttpsError("internal", "Something went wrong. Please try again.");
  }
});
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

/* === Phase 2C automatic offers (flag: appConfig/assignment.autoOffers, default OFF) + 2E balance === */
const jobOffers = require("./job-offers");
const balance = require("./balance");
exports.acceptJobOffer = functions.region("asia-south1").https.onCall(staffCallable(jobOffers.handleAccept, jobOffers.OfferError));
exports.declineJobOffer = functions.region("asia-south1").runWith({ secrets: [...BREVO_SECRETS] })
  .https.onCall(staffCallable(jobOffers.handleDecline, jobOffers.OfferError));
// Every minute: expire offers after offerTimeoutMin (5), offer the next driver, alert admin when nobody is left.
exports.jobOfferSweep = functions.region("asia-south1").runWith({ secrets: [...BREVO_SECRETS] })
  .pubsub.schedule("every 1 minutes").timeZone("Asia/Kolkata")
  .onRun(async () => { await jobOffers.sweep(staffDeps()); return null; });
// Driver (or admin) records cash/UPI collected; the job can't be completed while balanceDue > 0.
// Level 2: customer pays the remaining balance online (amount always read from the booking).
const balancePay = require("./balance-payment");
function customerCallable(handler) {
  return async (data, context) => {
    try {
      const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
      return await handler(data, context, {
        db: admin.firestore(), now: () => Date.now(), logger: functions.logger, keyId: RAZORPAY_KEY_ID.value(),
        keySecret: RAZORPAY_KEY_SECRET.value(), signatureMatches: require("./move-payment")._internal.signatureMatches,
        createOrder: (o) => razorpay.orders.create(o), fetchPayment: (id) => razorpay.payments.fetch(id),
      });
    } catch (e) {
      if (e instanceof balancePay.BalancePayError) throw new functions.https.HttpsError(e.code, e.publicMessage);
      functions.logger.error("balance_payment_error", { message: String(e && e.message).slice(0, 160) });
      throw new functions.https.HttpsError("internal", "Something went wrong. Please try again.");
    }
  };
}
exports.createBalanceOrder = functions.region("asia-south1").runWith({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .https.onCall(customerCallable(balancePay.handleCreateBalanceOrder));
exports.verifyBalancePayment = functions.region("asia-south1").runWith({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] })
  .https.onCall(customerCallable(balancePay.handleVerifyBalancePayment));

exports.recordBalanceCollection = functions.region("asia-south1").https.onCall(staffCallable(balance.handleRecordCollection, balance.BalanceError));

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
const { _catalogTest, ...catalogExports } = require("./catalog-booking");   // test hook kept out of deployed functions
Object.assign(exports, catalogExports);
// Two-wheeler parcel delivery removed (Oct 2026): getParcelQuote / createParcelRazorpayOrder are no longer deployed.
// Existing parcel bookings stay in Firestore; move-payment.js still settles any pending parcel payment.
// Lead engine (Level-100 Phase 1): callback form, booking→lead linking, 10-minute SLA alert
const { _leads, ...leadExports } = require("./leads");
Object.assign(exports, leadExports);
// Daily Firestore backup to Cloud Storage (Level-100 Phase 0)
const { _backups, ...backupExports } = require("./backups");
Object.assign(exports, backupExports);
// Growth automations: referral rewards, post-move follow-up
const { _growth, ...growthExports } = require("./growth");
Object.assign(exports, growthExports);
// Lead Quality Engine: scoring (hot/warm/cold/junk), hot-lead alerts, warm-lead nurture
const { _quality, ...qualityExports } = require("./lead-quality");
Object.assign(exports, qualityExports);
// Lead Finder: Intent Radar (public RSS feeds) + Partner Finder (official Google Places API)
const leadFinder = require("./lead-finder");
const finderDeps = () => Object.assign(staffDeps(), {
  // owner + sales/ops staff can use the Lead Finder
  isAdmin: async (ctx) => { if (!(ctx && ctx.auth)) return false; const r = await staffRole(ctx); return ["admin", "manager", "advisor"].includes(r); }, fetch: (...a) => fetch(...a), now: () => Date.now(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(), key: (() => { try { return GOOGLE_MAPS_KEY.value(); } catch (e) { return ""; } })() });
exports.leadFinder = functions.region("asia-south1").runWith({ secrets: [GOOGLE_MAPS_KEY] }).https.onCall(async (data, context) => {
  try { return await leadFinder.handleFinder(data, context, finderDeps()); }
  catch (e) {
    if (e instanceof leadFinder.FinderError) throw new functions.https.HttpsError(e.code, e.publicMessage);
    functions.logger.error("lead_finder_error", { message: String(e && e.message).slice(0, 160) });
    throw new functions.https.HttpsError("internal", "Something went wrong. Please try again.");
  }
});
// Sales: sent quotes (phone → link → book & pay) and lost-lead win-back
const sales = require("./sales");
const salesErr = (e) => {
  if (e instanceof sales.SalesError) return new functions.https.HttpsError(e.code, e.publicMessage);
  functions.logger.error("sales_error", { message: String(e && e.message).slice(0, 160) });
  return new functions.https.HttpsError("internal", "Something went wrong. Please try again.");
};
exports.createSentQuote = functions.region("asia-south1").runWith({ secrets: [GOOGLE_MAPS_KEY] }).https.onCall(async (data, context) => {
  try {
    return await sales.createSentQuote(data, context, Object.assign(staffDeps(), { now: () => Date.now(), serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      price: (qi, pickup, drop, date) => calculateServerQuote(qi, pickup, drop, { date }) }));
  } catch (e) { throw salesErr(e); }
});
exports.getSentQuote = functions.region("asia-south1").https.onCall(async (data, context) => {
  const rl = await rateLimit.consumeAll(admin.firestore(), [Object.assign({ scope: "quoteViewIp", subject: rateLimit.clientIp(context.rawRequest) }, { limit: 60, windowMs: 3600e3 })]).catch(() => ({ ok: true }));
  if (rl && rl.ok === false) throw new functions.https.HttpsError("resource-exhausted", "Too many requests. Please try again later.");
  try { return await sales.getSentQuote(data, { db: admin.firestore(), now: () => Date.now() }); } catch (e) { throw salesErr(e); }
});
exports.leadWinback = functions.region("asia-south1").runWith({ secrets: [...BREVO_SECRETS] }).pubsub.schedule("0 11 * * *").timeZone("Asia/Kolkata").onRun(async () => {
  const db = admin.firestore();
  const snap = await db.collection("leads").where("status", "==", "lost").limit(300).get();
  const plan = sales.winbackPlan(snap.docs.map((d) => Object.assign({ _ref: d.ref }, d.data())), Date.now());
  for (const l of plan) {
    if (l.email) {   // e-mail only (SMS reserved for OTPs)
      const { sendCustomerEmail } = require("./notification-service");
      await sendCustomerEmail("follow_up", l.email, { customerName: l.name || "", emoji: "👋", subject: "Can we still help with your move?",
        title: "Can we still help?", subtitle: l.serviceLabel || "", paragraphs: [sales.winbackText(l).replace(/^Hi [^,]*, /, "").replace(/Rs\./g, "₹")],
        ctaLabel: "See today's price", ctaUrl: "https://packzenblr.in/" }).catch(() => {});
    }
    await l._ref.update({ winbackSentAtMs: Date.now() });
  }
  functions.logger.info("lead_winback", { sent: plan.length });
  return null;
});
// Team: staff logins (owner-only) + the morning briefing
const team = require("./team");
exports.adminManageStaff = functions.region("asia-south1").https.onCall(async (data, context) => {
  try { return await team.handleStaff(data, context, Object.assign(staffDeps(), { auth: admin.auth(), now: () => Date.now(), serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp() })); }
  catch (e) {
    if (e instanceof team.TeamError) throw new functions.https.HttpsError(e.code, e.publicMessage);
    if (e && e.code === "auth/email-already-exists") throw new functions.https.HttpsError("already-exists", "That email already has an account.");
    functions.logger.error("team_error", { message: String(e && e.message).slice(0, 160) });
    throw new functions.https.HttpsError("internal", "Something went wrong. Please try again.");
  }
});
exports.morningBriefing = functions.region("asia-south1").runWith({ secrets: [...BREVO_SECRETS] }).pubsub.schedule("0 8 * * *").timeZone("Asia/Kolkata").onRun(async () => {
  const { sendAdminEmail } = require("./notification-service");
  const r = await team.runBriefing({ db: admin.firestore(), now: () => Date.now(), sendAdminEmail });
  functions.logger.info("morning_briefing", r);
  return null;
});
exports.weeklyReport = functions.region("asia-south1").runWith({ secrets: [...BREVO_SECRETS] }).pubsub.schedule("0 18 * * 5").timeZone("Asia/Kolkata").onRun(async () => {
  const { sendAdminEmail } = require("./notification-service");
  const r = await team.runWeekly({ db: admin.firestore(), now: () => Date.now(), sendAdminEmail });
  functions.logger.info("weekly_report", r);
  return null;
});
exports.intentRadarSweep = functions.region("asia-south1").pubsub.schedule("every 2 hours").timeZone("Asia/Kolkata").onRun(async () => {
  const r = await leadFinder.sweepIntent({ db: admin.firestore(), fetch: (...a) => fetch(...a), now: () => Date.now(), serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp() });
  functions.logger.info("intent_radar", r);
  return null;
});
// Website virtual assistant (grounded answers + human handoff)
const { _assistant, ...assistantExports } = require("./assistant-functions");
Object.assign(exports, assistantExports);
