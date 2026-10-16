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
const assistantAi = require("./assistant-ai");
const i18n = require("./assistant-i18n");
// Hindi and Kannada are built in (assistant-i18n.js) — no paid AI needed.
// Optional extra: free-form AI conversation if ANTHROPIC_API_KEY is ever added to
// functions/.env.packzen-e7539. Nothing to set up otherwise; deploys never need it.

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
  // Built-in Hindi/Kannada (no paid AI needed): understand the question in any of the
  // three languages, answer from the same verified engine, reply in the customer's language.
  const scriptLang = i18n.detectLang(text);
  const lang = scriptLang !== "en" ? scriptLang : (["en", "hi", "kn"].includes(data && data.lang) ? data.lang : "en");
  const out = assistant.answer(i18n.understand(text), { signedIn: !!uid, lastService, catalog });
  const understood = i18n.understand(text);
  const sizeAsked = assistant.detectSize(understood);
  const i18nCtx = { size: sizeAsked, km: assistant.detectKm(understood), kg: assistant.detectKg(understood) };
  const refused = (out.intents || []).some((i) => i.startsWith("refuse_"));

  // Conversational layer (optional). Hard refusals never reach it; any failure falls back.
  if (!refused && deps.ai) {
    const fetchMine = async () => {
      if (!uid) return [];
      const snap = await deps.db.collection("bookings").where("customerUid", "==", uid).limit(20).get();
      return snap.docs.map((d) => d.data() || {})
        .sort((a, b) => ((b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0)))
        .map((b) => ({ bookingRef: b.bookingRef, bookingType: b.bookingType, date: b.date, status: b.status, balanceDue: b.balanceDue, driverName: b.driverName }));
    };
    const ai = await deps.ai(text, data && data.history, { catalog, signedIn: !!uid, myBookings: fetchMine, lang: data && data.lang,
      createLead: (l) => deps.createLead(Object.assign({ uid }, l)) }).catch(() => null);
    if (ai && ai.reply) {
      const actions = (out.intents || []).includes("unknown") ? [] : (out.actions || []);
      return { reply: ai.reply, actions, service: out.service || null, escalate: !!out.escalate && !ai.usedTools.includes("request_callback"),
        urgent: !!out.urgent, lang: ai.lang, ai: true };
    }
  }

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
  // booking details are computed per customer: keep them exact (no template)
  const shown = out.needs === "booking_status" && uid ? out : i18n.localize(out, lang, i18nCtx);
  return { reply: shown.reply, actions: out.actions || [], service: out.service || null, escalate: !!out.escalate, urgent: !!out.urgent, lang };
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
  // Same shape as the lead engine (leads.js) so these show in the admin pipeline.
  const svcFromTopic = { moving: "move", move: "move", parcel: "parcel", ac: "ac", cleaning: "cleaning", electrician: "electrician", plumber: "plumber", carpenter: "carpenter", tv: "tv" }[String(topic || "").toLowerCase()] || "other";
  const LABELS = { move: "House / office shifting", parcel: "Parcel delivery", ac: "AC service & repair", cleaning: "Deep cleaning", electrician: "Electrician", plumber: "Plumber", carpenter: "Carpenter", tv: "TV wall mounting", other: "Something else" };
  const nowMs = deps.nowMs();
  await deps.db.collection("leads").doc(ref.id).set({ name, phone, service: svcFromTopic, serviceLabel: LABELS[svcFromTopic], notes: message, topic, uid,
    source: "website-assistant", channel: "assistant", supportRequestId: ref.id, status: "new", slaAlerted: false,
    createdAt: deps.serverTimestamp(), createdAtMs: nowMs, lastTouchAtMs: nowMs, history: [{ at: nowMs, status: "new", by: "system" }] });
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
    ai: aiFor(),
    createLead: (l) => require("./leads")._leads.upsertLead({ db, now: () => Date.now(),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(), arrayUnion: (x) => admin.firestore.FieldValue.arrayUnion(x) },
    { name: l.name, phone: l.phone, service: l.service in require("./leads")._leads.SERVICES ? l.service : "other",
      serviceLabel: require("./leads")._leads.SERVICES[l.service] || "Something else", notes: l.note || "", area: "", date: "", lang: "en", page: "assistant" },
    { source: "website-assistant", attribution: {}, uid: l.uid || null }),
  };
}
function aiFor() {
  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key || key === "none") return null;
  return (text, history, d) => assistantAi.converse(text, history, Object.assign({ apiKey: key, model: process.env.ASSISTANT_MODEL || assistantAi.DEFAULT_MODEL, logger: functions.logger }, d));
}

exports.assistantAsk = functions.region(REGION).https.onCall((data, context) => handleAsk(data, context, liveDeps(context)));
exports.assistantSupportRequest = functions.region(REGION).https.onCall((data, context) => handleSupportRequest(data, context, liveDeps(context)));
exports._assistant = { handleAsk, handleSupportRequest, redact };
