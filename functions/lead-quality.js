/**
 * PackZen — Lead Quality Engine (backend for the separate PackZen Leads app).
 *
 *  scoreLead(lead, now)   pure: 0–100 score, tier hot / warm / cold / junk, and the reasons
 *  onLeadScore            trigger: scores every new or changed lead (only when its inputs change)
 *  leadNurture            daily 10:30 IST: one SMS on day 1 and one on day 3 to WARM leads that
 *                         gave consent (they submitted a form asking to be contacted), never to
 *                         junk/cold/booked/lost leads, never twice
 *
 * Scores are hints for prioritising calls — they never block a customer or a booking.
 */
"use strict";
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const serviceArea = require("./service-area");

const REGION = "asia-south1";
const JOB_SEEKER = /\b(job|jobs|vacancy|vacancies|salary|hiring|career|resume|cv|driver job|work for you|join as driver|part time)\b/i;
const FAKE_NAME = /^(test|testing|asdf|qwerty|xyz|abc|aaa+|na|n\/a|none|hello|hi)$/i;
const SERVICE_POINTS = { move: 15, vehicle: 12, business: 20, ac: 8, electrician: 8, plumber: 8, carpenter: 8, tv: 6, parcel: 5, estimate: 18, other: 0 };
const WHEN_POINTS = { this_week: 25, two_weeks: 20, this_month: 10, later: 0, just_checking: -10 };
const SOURCE_POINTS = { "abandoned-quote": 10, "website-assistant": 5, "website-callback": 5, referral: 10 };

function daysUntil(dateStr, nowMs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return null;
  const d = Date.parse(dateStr + "T00:00:00+05:30");
  return isNaN(d) ? null : Math.floor((d - nowMs) / 86400e3);
}

function scoreLead(l, nowMs) {
  const reasons = [];
  let score = 0, junk = null;
  const name = String(l.name || "").trim(), phone = String(l.phone || "");
  const text = [l.notes, l.area, l.topic].filter(Boolean).join(" ");

  if (/^(\d)\1{9}$/.test(phone) || /^(1234567890|9876543210)$/.test(phone)) junk = "fake phone number";
  else if (FAKE_NAME.test(name) || name.length < 2) junk = "fake or test name";
  else if (JOB_SEEKER.test(text)) junk = "job seeker, not a customer";

  if (/^[6-9]\d{9}$/.test(phone)) { score += 20; reasons.push("valid mobile +20"); }
  if (l.phoneVerified === true) { score += 15; reasons.push("phone verified +15"); }

  if (l.area) {
    const a = serviceArea.checkAddress(l.area);
    if (a.ok) { score += 15; reasons.push("in service area +15"); }
    else if (a.reason === "outside") { score -= 40; reasons.push("outside Bangalore service area −40"); }
  }

  const days = daysUntil(l.date, nowMs);
  if (l.when && WHEN_POINTS[l.when] !== undefined) {
    score += WHEN_POINTS[l.when]; reasons.push(`timing '${l.when}' ${WHEN_POINTS[l.when] >= 0 ? "+" : "−"}${Math.abs(WHEN_POINTS[l.when])}`);
  } else if (days !== null) {
    if (days < 0) { reasons.push("date already passed +0"); }
    else if (days <= 14) { score += 25; reasons.push("needs it within 14 days +25"); }
    else if (days <= 30) { score += 10; reasons.push("within 30 days +10"); }
    else reasons.push("more than a month away +0");
  }

  const sp = SERVICE_POINTS[l.service] || 0;
  if (sp) { score += sp; reasons.push(`${l.serviceLabel || l.service} +${sp}`); }
  if (l.service === "move" && /\b([2-9])\s*bhk\b|villa/i.test(String(l.homeSize || "") + " " + text)) { score += 10; reasons.push("2 BHK or bigger +10"); }

  const src = SOURCE_POINTS[l.source] || (l.channel === "referral" ? 10 : 0);
  if (src) { score += src; reasons.push(`source ${l.source || l.channel} +${src}`); }
  if (Array.isArray(l.touches) && l.touches.length > 1) { score += 10; reasons.push("came back again +10"); }
  if (l.channel === "google_ads" || l.channel === "organic_search") { score += 5; reasons.push("searched for us +5"); }

  score = Math.max(0, Math.min(100, score));
  const tier = (junk || l.tierManual === "junk") ? "junk" : score >= 60 ? "hot" : score >= 35 ? "warm" : "cold";
  return { score, tier, reasons: junk ? ["junk: " + junk].concat(reasons) : reasons, junkReason: junk };
}

// Only these fields change the score; re-score when they change.
function inputsKey(l) {
  return JSON.stringify([l.name, l.phone, l.phoneVerified, l.area, l.date, l.when, l.service, l.homeSize, l.notes, l.source, l.channel, (l.touches || []).length]);
}

exports.onLeadScore = functions.region(REGION).runWith({ secrets: require("./brevo-client").BREVO_SECRETS }).firestore.document("leads/{leadId}").onWrite(async (change) => {
  if (!change.after.exists) return null;
  const l = change.after.data() || {};
  const key = inputsKey(l);
  if (l.qualityKey === key) return null; // nothing that affects the score changed (also stops our own write re-triggering)
  const q = scoreLead(l, Date.now());
  const wasHot = change.before.exists && (change.before.data() || {}).tier === "hot";
  await change.after.ref.update({ score: q.score, tier: q.tier, scoreReasons: q.reasons, junkReason: q.junkReason || null, qualityKey: key, scoredAtMs: Date.now() });
  if (q.tier === "hot" && !wasHot) {
    const { sendAdminEmail } = require("./notification-service");
    await sendAdminEmail(`HOT lead: ${l.name} (${l.serviceLabel || l.service}) — call now`, [
      ["Name", l.name], ["Phone", l.phone], ["Service", l.serviceLabel || l.service], ["Area", l.area || "-"], ["When", l.when || l.date || "-"],
      ["Score", q.score + " / 100"], ["Why", q.reasons.join("; ")],
    ], change.after.id).catch(() => {});
  }
  return null;
});

/** Pure core: which warm leads get which nurture SMS now. */
function nurturePlan(leads, nowMs) {
  const out = [];
  for (const l of leads) {
    if (l.tier !== "warm" || !["new", "contacted", "quoted"].includes(l.status) || l.consent === false) continue;
    const age = (nowMs - (l.createdAtMs || nowMs)) / 86400e3;
    const sent = l.nurtureSent || [];
    if (age >= 1 && age < 3 && !sent.includes("d1")) out.push({ lead: l, step: "d1" });
    else if (age >= 3 && age < 6 && !sent.includes("d3")) out.push({ lead: l, step: "d3" });
  }
  return out;
}
function nurtureText(l, step) {
  const first = String(l.name || "").split(" ")[0] || "there";
  const link = l.service === "parcel" ? "packzenblr.in/parcel.html" : l.service === "move" || l.service === "vehicle" ? "packzenblr.in/?book=move" : "packzenblr.in/services.html";
  return step === "d1"
    ? `Hi ${first}, PackZen here about your ${l.serviceLabel || "request"}. See your exact price in 1 minute and book online: ${link}. Questions? Call 9945095453.`
    : `Hi ${first}, still planning your ${l.serviceLabel || "request"}? First move? Use code FIRSTMOVE for Rs.200 off above Rs.4,000: ${link}. PackZen, 9945095453.`;
}

exports.leadNurture = functions.region(REGION).pubsub.schedule("30 10 * * *").timeZone("Asia/Kolkata").onRun(async () => {
  const db = admin.firestore();
  const snap = await db.collection("leads").where("tier", "==", "warm").limit(300).get();
  const plan = nurturePlan(snap.docs.map((d) => Object.assign({ _ref: d.ref }, d.data())), Date.now());
  for (const p of plan) {
    await db.collection("smsQueue").add({ mobile: p.lead.phone, message: nurtureText(p.lead, p.step), status: "pending", retries: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    await p.lead._ref.update({ nurtureSent: admin.firestore.FieldValue.arrayUnion(p.step) });
  }
  functions.logger.info("lead_nurture", { sent: plan.length });
  return null;
});

exports._quality = { scoreLead, inputsKey, nurturePlan, nurtureText, daysUntil };
