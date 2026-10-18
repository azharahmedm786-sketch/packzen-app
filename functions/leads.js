/**
 * PackZen — lead engine (Level-100 Phase 1).
 * ---------------------------------------------------------------
 * One `leads` collection fed by every channel (website callback form, assistant
 * handoff, and later the phone line). Admin works them through a pipeline:
 *   new → contacted → quoted → booked | lost
 *
 *   submitLead           callable (public)  website "Request a callback"; rate-limited,
 *                                            honeypot, phone+service de-duplication
 *   onBookingLinkLead    trigger            a new booking marks the caller's open lead "booked"
 *   leadSlaSweep         every 5 min        emails you once if a lead sits "new" > 10 min
 *
 * Leads are written only by these functions (rules: create:false); admins read/update.
 */
"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const rateLimit = require("./rate-limit");
const serviceArea = require("./service-area");

const REGION = "asia-south1";
const STATUSES = ["new", "contacted", "quoted", "booked", "lost"];
const SERVICES = {
  move: "House / office shifting", parcel: "Parcel delivery", vehicle: "Bike / car transport",
  ac: "AC service & repair", cleaning: "Deep cleaning", electrician: "Electrician",
  plumber: "Plumber", carpenter: "Carpenter", tv: "TV wall mounting", business: "Business / office account", estimate: "Fixed quote from photos", other: "Something else",
};
const SLA_MINUTES = 10;
const DEDUPE_HOURS = 24;

function str(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max) : ""; }
function normalizePhone(v) {
  let x = str(v, 20).replace(/[\s()+-]/g, "");
  if (x.length === 12 && x.startsWith("91")) x = x.slice(2);
  if (x.length === 11 && x.startsWith("0")) x = x.slice(1);
  return /^[6-9]\d{9}$/.test(x) ? x : null;
}
function cleanAttribution(a) {
  const src = a && typeof a === "object" ? a : {};
  const out = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "referrer", "landing", "firstSeen"]) {
    const v = str(src[k], 300); if (v) out[k] = v;
  }
  return out;
}
/** Human-friendly channel from attribution: google_ads / google / referral / social / direct … */
function channelOf(attr, fallback) {
  const a = attr || {};
  const s = (a.utm_source || "").toLowerCase(), m = (a.utm_medium || "").toLowerCase(), r = (a.referrer || "").toLowerCase();
  if (a.gclid || (s === "google" && /cpc|paid|ppc/.test(m))) return "google_ads";
  if (m === "referral" || s === "referral" || s === "packzen_referral") return "referral";
  if (/facebook|instagram|fb|ig|whatsapp|wa|youtube|linkedin/.test(s) || /facebook|instagram|youtube|linkedin|whatsapp|t\.co\b/.test(r)) return "social";
  if (s) return s.slice(0, 30);
  if (/google\.|bing\.|duckduckgo|yahoo\./.test(r)) return "organic_search";
  if (/justdial|sulekha|nobroker|magicbricks|99acres/.test(r)) return "directory";
  if (r && !/packzenblr\.in/.test(r)) return "other_website";
  return fallback || "direct";
}

/** Pure validation; returns { ok, errors, value } */
function validateLead(data, now) {
  const d = data && typeof data === "object" ? data : {};
  const errors = [];
  const name = str(d.name, 80);
  if (name.length < 2) errors.push("Please enter your name.");
  const phone = normalizePhone(d.phone);
  if (!phone) errors.push("Please enter a valid 10-digit mobile number.");
  const service = SERVICES[d.service] ? d.service : "other";
  const area = str(d.area, 200);
  const notes = str(d.notes, 500);
  let date = str(d.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = "";
  const lang = ["en", "hi", "kn"].includes(d.lang) ? d.lang : "en";
  const page = str(d.page, 200);
  const value = { name, phone, service, serviceLabel: SERVICES[service], area, notes, date, lang, page };
  if (area) {
    const sa = serviceArea.checkAddress(area);
    value.inServiceArea = sa.ok || sa.reason === "unknown"; // unknown = just a locality name; keep the lead
    if (sa.pincode) value.pincode = sa.pincode;
  }
  return { ok: errors.length === 0, errors, value };
}

/**
 * Create or merge a lead. Same phone + service within 24h → the existing lead gets
 * the new note (no duplicates in your pipeline). deps: { db, now, serverTimestamp, arrayUnion }
 */
async function upsertLead(deps, value, meta) {
  const nowMs = deps.now();
  const since = nowMs - DEDUPE_HOURS * 3600e3;
  // single-field query (no composite index needed); filter the time window in code
  const dup = await deps.db.collection("leads").where("phone", "==", value.phone).limit(25).get();
  const same = dup.docs.find((doc) => { const x = doc.data(); return x.service === value.service && x.status !== "lost" && (x.createdAtMs || 0) >= since; });
  const touch = { at: nowMs, source: meta.source, page: value.page || null, notes: value.notes || null };
  if (same) {
    await same.ref.update({ touches: deps.arrayUnion(touch), lastTouchAtMs: nowMs, updatedAt: deps.serverTimestamp(),
      ...(value.notes ? { notes: (same.data().notes ? same.data().notes + "\n" : "") + value.notes } : {}) });
    return { id: same.id, merged: true };
  }
  const ref = deps.db.collection("leads").doc();
  await ref.set(Object.assign({}, value, {
    status: "new", source: meta.source, channel: channelOf(meta.attribution, meta.source === "website-callback" ? "direct" : meta.source),
    attribution: meta.attribution || {}, uid: meta.uid || null,
    touches: [touch], createdAt: deps.serverTimestamp(), createdAtMs: nowMs, lastTouchAtMs: nowMs,
    slaAlerted: false, history: [{ at: nowMs, status: "new", by: "system" }],
  }));
  return { id: ref.id, merged: false };
}

/** Pick the lead a new booking belongs to: newest open lead with that phone in the last 30 days. */
function pickLeadForBooking(leadDocs, nowMs) {
  const open = leadDocs.filter((l) => !["booked", "lost"].includes(l.status) && (nowMs - (l.createdAtMs || 0)) <= 30 * 86400e3);
  open.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return open[0] || null;
}

/* ── Cloud Functions ───────────────────────────────────────── */
exports.submitLead = functions.region(REGION).https.onCall(async (data, context) => {
  if (data && data.website) return { ok: true }; // honeypot: bots fill hidden fields; pretend success
  const db = admin.firestore();
  const ip = rateLimit.clientIp(context.rawRequest);
  const rl = await rateLimit.consumeAll(db, [
    Object.assign({ scope: "leadIp", subject: ip }, rateLimit.LIMITS.leadIp),
    Object.assign({ scope: "leadGlobal", subject: "all" }, rateLimit.LIMITS.leadGlobal),
  ], functions.logger);
  if (!rl.ok) throw new functions.https.HttpsError("resource-exhausted", "Too many requests. Please call us on 9945095453.");
  const v = validateLead(data);
  if (!v.ok) throw new functions.https.HttpsError("invalid-argument", v.errors.join(" "));
  const res = await upsertLead({ db, now: () => Date.now(), serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    arrayUnion: (x) => admin.firestore.FieldValue.arrayUnion(x) },
  v.value, { source: "website-callback", attribution: cleanAttribution(data.attribution), uid: context.auth ? context.auth.uid : null });
  functions.logger.info("lead_submitted", { leadId: res.id, merged: res.merged, service: v.value.service });
  return { ok: true };
});

exports.onBookingLinkLead = functions.region(REGION).firestore.document("bookings/{bookingId}").onCreate(async (snap, context) => {
  const b = snap.data() || {};
  const phone = normalizePhone(b.phone);
  if (!phone) return null;
  const db = admin.firestore();
  const q = await db.collection("leads").where("phone", "==", phone).limit(20).get();
  const lead = pickLeadForBooking(q.docs.map((d) => Object.assign({ _ref: d.ref }, d.data())), Date.now());
  if (!lead) return null;
  await lead._ref.update({ status: "booked", bookingId: context.params.bookingId, bookingRef: b.bookingRef || null,
    bookedValue: Number(b.total) || 0, bookedAtMs: Date.now(),
    history: admin.firestore.FieldValue.arrayUnion({ at: Date.now(), status: "booked", by: "system" }) });
  // carry the marketing source onto the booking for reporting
  await snap.ref.update({ leadId: lead._ref.id, leadChannel: lead.channel || null }).catch(() => {});
  return null;
});

exports.leadSlaSweep = functions.region(REGION).pubsub.schedule("every 5 minutes").timeZone("Asia/Kolkata").onRun(async () => {
  const db = admin.firestore();
  const cutoff = Date.now() - SLA_MINUTES * 60e3;
  const q = await db.collection("leads").where("status", "==", "new").where("slaAlerted", "==", false).limit(50).get();
  const late = q.docs.filter((d) => (d.data().createdAtMs || 0) <= cutoff);
  if (!late.length) return null;
  const { sendAdminEmail } = require("./notification-service");
  for (const d of late) {
    const l = d.data();
    await sendAdminEmail(`Lead waiting ${SLA_MINUTES}+ min: ${l.name} (${l.serviceLabel})`, [
      ["Name", l.name], ["Phone", l.phone], ["Service", l.serviceLabel], ["Area", l.area || "-"],
      ["Preferred date", l.date || "-"], ["Source", l.channel || l.source], ["Notes", l.notes || "-"],
    ], d.id).catch(() => {});
    await d.ref.update({ slaAlerted: true });
  }
  return null;
});

/**
 * Abandoned quotes → leads. A signed-in customer who got a moving price but did not
 * book within 2 hours becomes a lead (one per customer per day via upsertLead's
 * de-duplication), with the quote in the notes. Pure core for testing.
 * deps: { db, now, serverTimestamp, arrayUnion }
 */
async function sweepAbandonedQuotes(deps) {
  const nowMs = deps.now();
  const from = new Date(nowMs - 24 * 3600e3), to = new Date(nowMs - 2 * 3600e3);
  const q = await deps.db.collection("quotes").where("createdAt", ">=", from).where("createdAt", "<=", to).limit(300).get();
  const byUid = new Map();
  for (const d of q.docs) {
    const x = d.data() || {};
    if (x.leadProcessed || !x.uid) continue;
    const cur = byUid.get(x.uid);
    if (!cur || (x.createdAt && cur.data.createdAt && x.createdAt.toMillis() > cur.data.createdAt.toMillis())) byUid.set(x.uid, { ref: d.ref, data: x, refs: (cur ? cur.refs : []).concat(d.ref) });
    else cur.refs.push(d.ref);
  }
  let created = 0;
  for (const [uid, item] of byUid) {
    const quoteMs = item.data.createdAt && item.data.createdAt.toMillis ? item.data.createdAt.toMillis() : nowMs;
    const booked = await deps.db.collection("bookings").where("customerUid", "==", uid).limit(10).get();
    const bookedAfter = booked.docs.some((b) => { const c = b.data().createdAt; return c && c.toMillis && c.toMillis() >= quoteMs - 3600e3; });
    if (!bookedAfter) {
      const u = await deps.db.collection("users").doc(uid).get();
      const ud = u.exists ? u.data() : {};
      const phone = normalizePhone(ud.phone || ud.phoneNumber || "");
      if (phone) {
        const total = Number(item.data.total) || 0;
        await upsertLead(deps, { name: str(ud.name || ud.displayName || "Customer", 80), phone, service: "move", serviceLabel: SERVICES.move,
          area: str(item.data.pickup, 200), notes: `Got a quote of ₹${total.toLocaleString("en-IN")} (${str(item.data.house, 40)}${item.data.vehicle ? ", " + str(item.data.vehicle, 40) : ""}) for ${str(item.data.pickup, 80)} → ${str(item.data.drop, 80)} but didn't book.`,
          date: "", lang: "en", page: "quote" }, { source: "abandoned-quote", attribution: {}, uid });
        created++;
      }
    }
    for (const r of item.refs) await r.update({ leadProcessed: true }).catch(() => {});
  }
  return { created };
}

exports.abandonedQuoteSweep = functions.region(REGION).pubsub.schedule("every 60 minutes").timeZone("Asia/Kolkata").onRun(async () => {
  const r = await sweepAbandonedQuotes({ db: admin.firestore(), now: () => Date.now(), serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    arrayUnion: (x) => admin.firestore.FieldValue.arrayUnion(x) });
  functions.logger.info("abandoned_quotes_swept", r);
  return null;
});

exports._leads = { sweepAbandonedQuotes,  validateLead, upsertLead, pickLeadForBooking, channelOf, cleanAttribution, normalizePhone, STATUSES, SERVICES };
