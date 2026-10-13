/**
 * PackZen — claim a queued message before sending it.
 *
 * Firestore triggers are delivered at-least-once, and sendSMS also re-fires on its
 * own retry writes. Without a claim, two invocations could both see status
 * "pending" and send the same SMS twice. claimPending flips pending -> sending in a
 * transaction; only the invocation that wins the flip sends.
 */
"use strict";

async function claimPending(db, ref, now) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data();
    if (data.status !== "pending") return null;
    tx.update(ref, { status: "sending", claimedAt: typeof now === "number" ? now : Date.now() });
    return data;
  });
}

module.exports = { claimPending };
