/**
 * PackZen — Phase 2F automatic Google review request
 * Sent once, 2 hours after a code-verified completion. Skipped for admin-override
 * completions, damage claims, refunded bookings and bookings without email.
 */
"use strict";
const GOOGLE_REVIEW_URL = "https://g.page/r/CR_hUMH7jJOvEBM/review";
const DELAY_MS = 2 * 3600e3;
const toMs = (v) => (v == null ? null : typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : null));

function eligible(b, now) {
  if (!b || b.status !== "delivered" || b.feedbackRequestSent === true) return false;
  if (b.completionMethod !== "otp") return false;              // genuine verified completion only
  if (b.damageClaimed) return false;
  if (["refunded", "partially_refunded"].includes(b.paymentStatus)) return false;
  const at = toMs(b.deliveredAt) || toMs(b.completionVerifiedAt);
  return at !== null && now - at >= DELAY_MS;
}

/** deps: { db, now(), getEmail(b), send(email, data), logger } */
async function run(deps) {
  const now = deps.now(); let sent = 0, skipped = 0;
  // Only bookings completed with the customer's code are flagged reviewRequestPending,
  // so older delivered bookings never crowd out new ones (and never get surprise emails).
  const q = await deps.db.collection("bookings").where("reviewRequestPending", "==", true).limit(200).get();
  for (const d of q.docs) {
    const b = d.data() || {};
    if (!eligible(b, now)) {
      skipped++;
      const at = toMs(b.deliveredAt) || toMs(b.completionVerifiedAt);
      const tooSoon = b.status === "delivered" && b.completionMethod === "otp" && !b.damageClaimed &&
        !["refunded", "partially_refunded"].includes(b.paymentStatus) && b.feedbackRequestSent !== true && at !== null && now - at < DELAY_MS;
      if (!tooSoon) await d.ref.update({ reviewRequestPending: false }); // permanently ineligible → stop checking
      continue;
    }
    // claim first (no duplicates even if the send fails or the job overlaps)
    const claimed = await deps.db.runTransaction(async (tx) => {
      const cur = await tx.get(d.ref); const c = cur.data() || {};
      if (c.feedbackRequestSent === true || c.reviewRequestPending !== true) return false;
      tx.update(d.ref, { feedbackRequestSent: true, feedbackRequestSentAt: now, reviewRequestPending: false });
      return true;
    });
    if (!claimed) continue;
    const email = await deps.getEmail(b);
    if (!email) { await d.ref.update({ feedbackRequestError: "no_email" }); continue; }
    try { await deps.send(email, Object.assign({}, b, { reviewUrl: GOOGLE_REVIEW_URL })); sent++; }
    catch (e) { await d.ref.update({ feedbackRequestError: "send_failed" }); }
  }
  (deps.logger || console).info("review_requests", { sent, skipped });
  return { sent, skipped };
}
module.exports = { run, eligible, GOOGLE_REVIEW_URL, DELAY_MS };
