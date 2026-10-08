/**
 * PackZen — server-authoritative promo / referral discounts (P0)
 * --------------------------------------------------------------
 * The browser may send only `promoCode`. Any client-supplied discount
 * (`promoDiscount`, totals, subtotals) is discarded; the server looks the code
 * up and computes the discount itself, then lets the pricing engine apply its
 * own cap (30% of the service subtotal) and minimum-fare floor.
 *
 * Existing model (unchanged, same collection the admin panel writes):
 *   promos/{CODE} { code, type: "flat"|"percent", value, max (max uses), used, active }
 * Optional fields honoured when present (set in the console; no admin UI change):
 *   expiresAt, startsAt (Timestamp | Date | ISO string), minOrder (₹), maxDiscount (₹)
 * Referral codes (users.referralCode of ANOTHER user) keep today's ₹100 flat value.
 */
"use strict";

const REFERRAL_AMOUNT = 100; // same value the website applied before (config referralAmount was never set)
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

class PromoError extends Error {
  constructor(message) { super(message); this.code = "invalid_promo"; this.publicMessage = message; }
}

function normalizeCode(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new PromoError("That promo code isn't valid.");
  const c = raw.trim().toUpperCase();
  if (!c) return null;
  if (!CODE_RE.test(c)) throw new PromoError("That promo code isn't valid.");
  return c;
}
function toMs(v) {
  if (v == null) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Resolve a code to a requested discount amount (₹, before the engine's cap).
 * deps: { db, now(), uid } ; baseTotal: server pre-discount grand total.
 */
async function resolvePromo(code, baseTotal, deps) {
  const snap = await deps.db.collection("promos").doc(code).get();
  if (snap.exists) {
    const p = snap.data() || {};
    if (p.active !== true) throw new PromoError("This promo code is no longer active.");
    const now = deps.now();
    const starts = toMs(p.startsAt), expires = toMs(p.expiresAt);
    if (starts !== null && now < starts) throw new PromoError("This promo code isn't active yet.");
    if (expires !== null && now > expires) throw new PromoError("This promo code has expired.");
    const max = Number(p.max), used = Number(p.used || 0);
    if (Number.isFinite(max) && max > 0 && used >= max) throw new PromoError("This promo code has reached its usage limit.");
    const minOrder = Number(p.minOrder);
    if (Number.isFinite(minOrder) && minOrder > 0 && baseTotal < minOrder) throw new PromoError("This promo code needs a booking of at least ₹" + minOrder + ".");
    const value = Number(p.value);
    if (!Number.isFinite(value) || value <= 0) throw new PromoError("This promo code isn't valid.");
    let amount;
    if (p.type === "percent") { if (value > 100) throw new PromoError("This promo code isn't valid."); amount = Math.round(baseTotal * value / 100); }
    else if (p.type === "flat") amount = Math.round(value);
    else throw new PromoError("This promo code isn't valid.");
    const maxDiscount = Number(p.maxDiscount);
    if (Number.isFinite(maxDiscount) && maxDiscount > 0) amount = Math.min(amount, Math.round(maxDiscount));
    return { code, kind: "promo", amount: Math.max(0, Math.min(amount, baseTotal)) };
  }
  // Referral code of another customer.
  if (!deps.uid) throw new PromoError("Please sign in to use a referral code.");
  const ref = await deps.db.collection("users").where("referralCode", "==", code).limit(1).get();
  if (ref.empty) throw new PromoError("That promo code isn't valid.");
  if (ref.docs[0].id === deps.uid) throw new PromoError("You can't use your own referral code.");
  return { code, kind: "referral", amount: Math.min(REFERRAL_AMOUNT, baseTotal) };
}

/**
 * Apply the server-side promo to a quote input IN PLACE and return the final quote.
 *  - strips every client discount field;
 *  - prices once without discount; if a code was sent, resolves it and prices again;
 *  - writes the APPLIED (engine-capped) discount back to quoteInput.promoDiscount
 *    so anything stored from quoteInput reflects the server's value.
 * calc(quoteInput) → quote (the existing validate + calculateQuote path).
 */
async function priceWithPromo(quoteInput, calc, deps) {
  const code = normalizeCode(quoteInput.promoCode);
  for (const k of ["promoDiscount", "promoCode", "discount", "discountAmount", "couponDiscount", "referralDiscount", "total", "subtotal", "grandTotal", "finalTotal"]) delete quoteInput[k];
  quoteInput.promoDiscount = 0;
  const base = await calc(quoteInput);
  if (!code) return Object.assign(base, { promo: null });
  const baseTotal = Number(base.finalTotal != null ? base.finalTotal : base.breakdown && base.breakdown.grandTotal) || 0;
  const r = await resolvePromo(code, baseTotal, deps);
  quoteInput.promoDiscount = r.amount;
  const q = await calc(quoteInput);
  // What the customer actually saves (the engine caps the discount and never goes below the minimum fare).
  const finalTotal = Number(q.finalTotal != null ? q.finalTotal : q.breakdown && q.breakdown.grandTotal) || 0;
  const applied = Math.max(0, baseTotal - finalTotal);
  quoteInput.promoDiscount = applied;
  quoteInput.promoCode = code;
  return Object.assign(q, { promo: { code, kind: r.kind, requested: r.amount, applied } });
}

module.exports = { priceWithPromo, resolvePromo, normalizeCode, PromoError, REFERRAL_AMOUNT };
