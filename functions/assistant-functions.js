/**
 * PackZen virtual assistant — Cloud Functions.
 *   assistantAsk            callable  answer a customer message (grounded engine in assistant.js)
 *   assistantSupportRequest callable  hand off to a human: creates supportRequests/{id} + leads/{id}
 * Customer-specific data: only the signed-in user's own bookings, looked up by
 * uid on the server. Nothing typed in chat can select another customer's data.
 */
"use strict";
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const assistant = require("./assistant");
const rateLimit = require("./rate-limit");
const { sendAdminEmail } = require("./notification-service");

const REGION = "asia-south1";
let catalogCache = { at: 0, items: [] };

async function loadCatalog(db, now) {
  if (now - catalogCache.at < 10 * 60 * 1000) return catalogCache.items;
  try {
    const snap = await db.collection("services").limit(200).get();
    const items = snap.docs.map((d) => d.data() || {})
      .filter((x) => x.name && x.active !== false && x.isActive !== false && typeof x.basePrice === "number")
      .map((x) => ({ name: String(x.name).slice(0, 80), basePrice: x.basePrice, pricingUnit: x.pricingUnit || "fixed" }));
    catalogCache = { at: now, items };
  } catch (_) { /* keep previous cache */ }
  return catalogCache.items;
}

// Unanswered questions are logged so the knowledge base can grow — with digits,
// emails and long numbers stripped so no contact details or IDs are stored.
function redact(text) {
  return String(text || "").slice(0, 200).replace(/\S+@\S+/g, "[email]").replace(/\d[\d\s-]{3,}\d/g, "[number]");
}

async function handleAsk(data, context, deps) {
  const text = typeof (data && data.message) === "string" ? data.message : "";
  if (!text.trim() || text.length > assistant.MAX_INPUT) return { reply: "Please send a shorter question (up to 600 characters).", actions: [] };
  const uid = context.auth && context.auth.uid;
  const checks = [Object.assign({ scope: "assistantIp", subject: deps.clientIp }, rateLimit.LIMITS.assistantIp)];
  if (uid) checks.push(Object.assign({ scope: "assistantUid", subject: uid }, rateLimit.LIMITS.assistantUid));
  const rl = await deps.consumeAll(checks).catch(() => ({ ok: true }));
  if (!rl.ok) return { reply: "You're sending messages quickly — please wait a few minutes, or call 9945095453.", actions: [], limited: true };

  const lastService = ["moving", "parcel", "home_services"].includes(data && data.lastService) ? data.lastService : null;
  const catalog = await deps.loadCatalog();
  const out = assistant.answer(text, { signedIn: !!uid, lastService, catalog });

  if (out.needs === "booking_status" && uid) {
    const snap = await deps.db.collection("bookings").where("customerUid", "==", uid).limit(20).get();
    const mine = snap.docs.map((d) => d.data() || {})
      .sort((a, b) => ((b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0)))
      .map((b) => ({ bookingRef: b.bookingRef, bookingType: b.bookingType, date: b.date, status: b.status, balanceDue: b.balanceDue, driverName: b.driverName }));
    out.reply = assistant.describeBookings(mine);
    out.actions = [{ type: "link", label: "My Bookings", href: "/index.html#bookings" }];
  }
  if (out.intents && out.intents.includes("unknown")) {
    await deps.db.collection("assistantGaps").add({ text: redact(text), at: deps.serverTimestamp() }).catch(() => {});
  }
  return { reply: out.reply, actions: out.actions || [], service: out.service || null, escalate: !!out.escalate, urgent: !!out.urgent };
}

const TOPICS = new Set(["booking", "payment", "refund", "damage", "complaint", "callback", "service", "other"]);
async function handleSupportRequest(data, context, deps) {
  const d = data || {};
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const name = str(d.name, 80);
  let phone = str(d.phone, 20).replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (phone.length === 12 && phone.startsWith("91")) phone = phone.slice(2);
  const message = str(d.message, 600);
  const topic = TOPICS.has(d.topic) ? d.topic : "other";
  if (name.length < 2) throw new functions.https.HttpsError("invalid-argument", "Please enter your name.");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new functions.https.HttpsError("invalid-argument", "Please enter a valid 10-digit mobile number.");
  if (message.length < 3) throw new functions.https.HttpsError("invalid-argument", "Please tell us briefly what you need help with.");
  if (d.consent !== true) throw new functions.https.HttpsError("invalid-argument", "Please allow us to contact you about this request.");

  const rl = await deps.consumeAll([
    Object.assign({ scope: "supportRequestIp", subject: deps.clientIp }, rateLimit.LIMITS.supportRequestIp),
    Object.assign({ scope: "supportRequestGlobal", subject: "all" }, rateLimit.LIMITS.supportRequestGlobal),
  ]).catch(() => ({ ok: true }));
  if (!rl.ok) throw new functions.https.HttpsError("resource-exhausted", "We've already received your requests — our team will call you. For anything urgent call 9945095453.");

  const urgent = d.urgent === true || /(urgent|emergency|damage|stolen|theft|fraud|accident)/i.test(message);
  const uid = context.auth ? context.auth.uid : null;
  const ref = deps.db.collection("supportRequests").doc();
  const record = { name, phone, message, topic, urgent, uid, source: "website-assistant", status: "open", consentToContact: true,
    createdAt: deps.serverTimestamp(), history: [{ at: deps.nowMs(), event: "created" }] };
  await ref.set(record);
  // Lead record for conversion tracking (one per request; duplicates are OK — they're separate enquiries).
  await deps.db.collection("leads").doc(ref.id).set({ name, phone, source: "website-assistant", topic, uid, supportRequestId: ref.id, status: "new", createdAt: deps.serverTimestamp() });
  await deps.alert((urgent ? "URGENT " : "") + "Support request from website assistant", [["Name", name], ["Phone", phone], ["Topic", topic], ["Message", message], ["Request ID", ref.id]]).catch(() => {});
  return { ok: true, requestId: ref.id, message: urgent
    ? "Thanks — we've flagged this as urgent and will call you as soon as possible. If it can't wait, call 9945095453."
    : "Thanks — our team will call you on " + phone.replace(/^(\d{2})\d{5}/, "$1XXXXX") + " during working hours (Mon–Sun, 8 AM – 9 PM)." };
}

function liveDeps(context) {
  const db = admin.firestore();
  return {
    db, clientIp: rateLimit.clientIp(context.rawRequest), nowMs: () => Date.now(),
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    consumeAll: (checks) => rateLimit.consumeAll(db, checks, functions.logger),
    loadCatalog: () => loadCatalog(db, Date.now()),
    alert: (subject, rows) => sendAdminEmail(subject, rows),
  };
}

exports.assistantAsk = functions.region(REGION).https.onCall((data, context) => handleAsk(data, context, liveDeps(context)));
exports.assistantSupportRequest = functions.region(REGION).https.onCall((data, context) => handleSupportRequest(data, context, liveDeps(context)));
exports._assistant = { handleAsk, handleSupportRequest, redact };
