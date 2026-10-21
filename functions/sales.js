/**
 * PackZen — sales tools.
 *  Sent quotes: an admin prices a move on the phone (same server pricing as the website)
 *  and sends the customer a private link (packzenblr.in/quote.html?t=…) with the fixed,
 *  itemised price and a Book & pay button. The link records when it is opened.
 *  Win-back: one message 7 days after a lead was lost on price / no answer (to people who
 *  asked us to contact them), never twice.
 */
"use strict";
const crypto = require("crypto");

class SalesError extends Error { constructor(code, msg) { super(msg); this.code = code; this.publicMessage = msg; } }

// Typical inventories so a phone quote prices like a website booking of the same size.
const PRESETS = {
  "1rk":  { vehicleId: "tata_ace",   cartonQty: 8,  furniture: { bedCheck: 1, mattressCheck: 1, wardrobeCheck: 1, fridgeCheck: 1, tvCheck: 1 } },
  "1bhk": { vehicleId: "truck_14ft", cartonQty: 15, furniture: { sofaCheck: 1, bedCheck: 1, mattressCheck: 1, wardrobeCheck: 1, fridgeCheck: 1, wmCheck: 1, tvCheck: 1, tvUnitCheck: 1 } },
  "2bhk": { vehicleId: "truck_17ft", cartonQty: 25, furniture: { sofaCheck: 1, bedCheck: 2, mattressCheck: 2, wardrobeCheck: 2, fridgeCheck: 1, wmCheck: 1, tvCheck: 1, tvUnitCheck: 1, diningCheck: 1, studyTableCheck: 1 } },
  "3bhk": { vehicleId: "truck_22ft", cartonQty: 35, furniture: { sofaCheck: 2, bedCheck: 3, mattressCheck: 3, wardrobeCheck: 3, fridgeCheck: 1, wmCheck: 1, tvCheck: 2, tvUnitCheck: 1, diningCheck: 1, studyTableCheck: 1, showcaseCheck: 1 } },
};
const SIZE_LABEL = { "1rk": "1 RK", "1bhk": "1 BHK", "2bhk": "2 BHK", "3bhk": "3 BHK" };
const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function buildQuoteInput(d) {
  const p = PRESETS[d.size]; if (!p) throw new SalesError("invalid-argument", "Choose the home size.");
  return {
    pickup: str(d.pickup, 300), drop: str(d.drop, 300), vehicleId: p.vehicleId, furniture: Object.assign({}, p.furniture), cartonQty: p.cartonQty,
    pickupFloor: int(d.pickupFloor, 0, 30), dropFloor: int(d.dropFloor, 0, 30), liftAvailable: !!d.liftAvailable, packingService: !!d.packingService,
    acCount: int(d.acCount, 0, 6), tvMountCount: int(d.tvMountCount, 0, 6), needCarpenter: !!d.needCarpenter, needElectrician: !!d.needElectrician,
    extraHelpers: 0, isInterstate: false, promoCode: str(d.promoCode, 30).toUpperCase() || null,
  };
}
function validateDetails(d) {
  const name = str(d.name, 80), phone = String(d.phone || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const date = str(d.date, 10);
  if (name.length < 2) throw new SalesError("invalid-argument", "Enter the customer's name.");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new SalesError("invalid-argument", "Enter a valid 10-digit mobile number.");
  if (!str(d.pickup, 300) || !str(d.drop, 300)) throw new SalesError("invalid-argument", "Enter pickup and drop addresses.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SalesError("invalid-argument", "Choose the moving date.");
  return { name, phone, date, timeSlot: str(d.timeSlot, 40), note: str(d.note, 300) };
}
const newToken = () => crypto.randomBytes(16).toString("base64url");

/** Admin creates a quote link. deps: { db, isAdmin, price(quoteInput, pickup, drop, date), now, serverTimestamp } */
async function createSentQuote(data, context, deps) {
  if (!context || !context.auth) throw new SalesError("unauthenticated", "Please sign in.");
  if (!(await deps.isAdmin(context))) throw new SalesError("permission-denied", "Admins only.");
  const det = validateDetails(data || {});
  const qi = buildQuoteInput(data || {});
  let q;
  try { q = await deps.price(qi, qi.pickup, qi.drop, det.date); }
  catch (e) { throw new SalesError("failed-precondition", (e && e.publicMessage) || (e && e.message && e.message.length < 140 ? e.message : "Couldn't price this move — check the addresses.")); }
  if (!q || !q.valid || !(q.finalTotal > 0)) throw new SalesError("failed-precondition", "Couldn't price this move — check the addresses.");
  const token = newToken(), nowMs = deps.now();
  const b = q.breakdown || {};
  const doc = {
    token, leadId: str(data.leadId, 128) || null, size: data.size, sizeLabel: SIZE_LABEL[data.size],
    customerName: det.name, phone: det.phone, date: det.date, timeSlot: det.timeSlot, note: det.note,
    pickup: qi.pickup, drop: qi.drop, quoteInput: Object.assign({}, qi, { km: q.km || qi.km || null }),
    total: q.finalTotal, advance: Math.round(q.finalTotal * 0.1), discount: Number(b.discount) || 0, discountKind: b.discountKind || null,
    km: (b.km || qi.km || null), extras: { acCount: qi.acCount, tvMountCount: qi.tvMountCount, needCarpenter: qi.needCarpenter, needElectrician: qi.needElectrician, packingService: qi.packingService },
    opens: 0, firstOpenedAtMs: null, lastOpenedAtMs: null, status: "sent",
    createdBy: context.auth.uid, createdAtMs: nowMs, expiresAtMs: nowMs + 7 * 86400e3, createdAt: deps.serverTimestamp(),
  };
  await deps.db.collection("sentQuotes").doc(token).set(doc);
  if (doc.leadId) await deps.db.collection("leads").doc(doc.leadId).update({ status: "quoted", quotedAmount: doc.total, quoteToken: token, quoteSentAtMs: nowMs, updatedAtMs: nowMs }).catch(() => {});
  const url = "https://packzenblr.in/quote.html?t=" + token;
  const first = det.name.split(" ")[0];
  const message = `Hi ${first}, here's your PackZen quote for your ${SIZE_LABEL[data.size]} move on ${det.date}: Rs.${doc.total.toLocaleString("en-IN")} all-inclusive, fixed. See what's included and book here: ${url}`;
  return { token, url, total: doc.total, advance: doc.advance, message };
}

/** Public: the customer opens their link. Only safe fields are returned. */
async function getSentQuote(data, deps) {
  const t = data && data.t;
  if (typeof t !== "string" || !/^[A-Za-z0-9_-]{16,40}$/.test(t)) throw new SalesError("invalid-argument", "This quote link isn't valid.");
  const ref = deps.db.collection("sentQuotes").doc(t), snap = await ref.get();
  if (!snap.exists) throw new SalesError("not-found", "This quote link isn't valid.");
  const q = snap.data(), nowMs = deps.now();
  const expired = nowMs > q.expiresAtMs, firstOpen = !q.firstOpenedAtMs;
  await ref.update({ opens: (q.opens || 0) + 1, lastOpenedAtMs: nowMs, firstOpenedAtMs: q.firstOpenedAtMs || nowMs }).catch(() => {});
  if (q.leadId && firstOpen) await deps.db.collection("leads").doc(q.leadId).update({ quoteOpenedAtMs: nowMs }).catch(() => {});
  return {
    firstName: String(q.customerName || "").split(" ")[0], customerName: q.customerName, phone: q.phone, date: q.date, timeSlot: q.timeSlot || "",
    sizeLabel: q.sizeLabel, pickup: q.pickup, drop: q.drop, total: q.total, advance: q.advance, discount: q.discount, discountKind: q.discountKind,
    extras: q.extras, quoteInput: q.quoteInput, expired, status: q.status,
  };
}

/** Win-back plan: lost on price / no answer, 7–10 days ago, consented, not sent before. */
function winbackPlan(leads, nowMs) {
  return leads.filter((l) => l.status === "lost" && l.consent !== false && !l.winbackSentAtMs && /price|cost|expensive|no answer|not reachable|didn.?t pick/i.test(String(l.lostReason || ""))
    && /^[6-9]\d{9}$/.test(String(l.phone || ""))
    && ((nowMs - (l.lostAtMs || l.updatedAtMs || 0)) / 86400e3) >= 7 && ((nowMs - (l.lostAtMs || l.updatedAtMs || 0)) / 86400e3) < 10);
}
function winbackText(l) {
  const first = String(l.name || "").split(" ")[0] || "there";
  return /price|cost|expensive/i.test(String(l.lostReason || ""))
    ? `Hi ${first}, PackZen here. If you're still planning your move: small moves start at Rs.1,499, and Tue-Thu moves get 3% off. See your exact price: packzenblr.in/?book=move`
    : `Hi ${first}, PackZen here — sorry we missed each other. If you still need help with your move, see your exact price in 1 minute: packzenblr.in/?book=move or call 9945095453.`;
}

module.exports = { PRESETS, buildQuoteInput, validateDetails, createSentQuote, getSentQuote, winbackPlan, winbackText, SalesError };
