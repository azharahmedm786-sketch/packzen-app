/**
 * PackZen — growth automations (Oct 2026).
 *  onBookingDoneReferral   when a booking that used a friend's referral code is completed,
 *                          the referrer gets a personal ₹200 code (RWD-XXXXXX, one use,
 *                          6 months) by SMS + their referral stats update. Once per booking.
 *  postMoveFollowUp        daily 11:00 IST: 3 days after a completed MOVE, one SMS offering
 *                          deep cleaning / AC installation for the new home.
 * SMS go through the existing smsQueue (MSG91). Templates may need DLT registration.
 */
"use strict";
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

const REGION = "asia-south1";
const REWARD_AMOUNT = 200;
const DONE = ["delivered", "completed"];

function rewardCode(rand) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "RWD-"; for (let i = 0; i < 6; i++) c += A[Math.floor(rand() * A.length)];
  return c;
}

/** Pure core (testable). deps: { db, now, rand, queueSms, serverTimestamp, increment } */
async function rewardReferrer(deps, bookingRef, before, after) {
  if (!after || !DONE.includes(after.status) || (before && DONE.includes(before.status))) return { skipped: "not_just_completed" };
  const code = String(after.promoCode || "").toUpperCase();
  if (!code || after.referralRewardedAt) return { skipped: "no_referral" };
  const promoDoc = await deps.db.collection("promos").doc(code).get();
  if (promoDoc.exists) return { skipped: "promo_not_referral" };
  const ref = await deps.db.collection("users").where("referralCode", "==", code).limit(1).get();
  if (ref.empty) return { skipped: "unknown_code" };
  const referrer = ref.docs[0];
  if (referrer.id === after.customerUid) return { skipped: "self" };

  const nowMs = deps.now();
  const reward = rewardCode(deps.rand || Math.random);
  const claimed = await deps.db.runTransaction(async (tx) => {
    const cur = await tx.get(bookingRef);
    if (!cur.exists || (cur.data() || {}).referralRewardedAt) return false;
    tx.update(bookingRef, { referralRewardedAt: nowMs, referralRewardCode: reward, referrerUid: referrer.id });
    tx.set(deps.db.collection("promos").doc(reward), {
      code: reward, active: true, type: "flat", value: REWARD_AMOUNT, max: 1, used: 0, minOrder: 1000,
      ownerUid: referrer.id, reason: "referral", forBooking: after.bookingRef || null,
      expiresAt: new Date(nowMs + 180 * 86400e3), createdAt: deps.serverTimestamp(),
    });
    tx.update(referrer.ref, { referralCount: deps.increment(1), referralCredits: deps.increment(REWARD_AMOUNT) });
    return true;
  });
  if (!claimed) return { skipped: "already_rewarded" };
  const r = referrer.data() || {};
  if (r.phone) {
    await deps.queueSms(r.phone, `PackZen: thanks for referring a friend! Use code ${reward} for Rs.${REWARD_AMOUNT} off your next booking (valid 6 months). packzenblr.in`, after.bookingRef || null);
  }
  return { rewarded: reward, referrerUid: referrer.id };
}

/** Pure core: pick completed moves from 3 days ago that haven't had a follow-up. */
async function followUps(deps) {
  const nowMs = deps.now();
  const from = new Date(nowMs - 4 * 86400e3), to = new Date(nowMs - 3 * 86400e3);
  const q = await deps.db.collection("bookings").where("deliveredAt", ">=", from).where("deliveredAt", "<=", to).limit(200).get();
  let sent = 0;
  for (const d of q.docs) {
    const b = d.data() || {};
    if (b.postMoveFollowUpAt || !DONE.includes(b.status) || b.bookingType === "parcel" || b.bookingType === "service" || !b.phone) continue;
    await d.ref.update({ postMoveFollowUpAt: nowMs });
    await deps.queueSms(b.phone, `Hi ${String(b.customerName || "").split(" ")[0] || "there"}, settled into your new home? PackZen can help with deep cleaning, AC installation and handyman work: packzenblr.in/services.html`, b.bookingRef || null);
    sent++;
  }
  return { sent };
}

const liveDeps = () => ({
  db: admin.firestore(), now: () => Date.now(), rand: Math.random,
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  increment: (n) => admin.firestore.FieldValue.increment(n),
  queueSms: (mobile, message, bookingRef) => admin.firestore().collection("smsQueue").add({ mobile, message, bookingRef: bookingRef || null, status: "pending", retries: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() }),
});

exports.onBookingDoneReferral = functions.region(REGION).firestore.document("bookings/{bookingId}").onUpdate(async (change) => {
  try { await rewardReferrer(liveDeps(), change.after.ref, change.before.data(), change.after.data()); }
  catch (e) { functions.logger.warn("referral_reward_failed", { message: String(e && e.message).slice(0, 120) }); }
  return null;
});

exports.postMoveFollowUp = functions.region(REGION).pubsub.schedule("0 11 * * *").timeZone("Asia/Kolkata").onRun(async () => {
  const r = await followUps(liveDeps());
  functions.logger.info("post_move_followups", r);
  return null;
});

exports._growth = { rewardReferrer, followUps, rewardCode, REWARD_AMOUNT };
