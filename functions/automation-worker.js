/**
 * PACKZEN 3.0 — Priority One Outbox Background Worker
 * ------------------------------------------------------------------
 * Processes bounded batches of pending events from `automation_outbox`:
 *   - Bounded batch: max 10 events per run
 *   - Deterministic prioritization (urgent > high > normal > low)
 *   - Concurrency protection via transactional lease-locking (60s)
 *   - Crash recovery for expired leases
 *   - Exponential backoff & dead-letter escalation
 *   - Strict PII-free logging to `automation_logs`
 *   - Gated execution: never marks completed unless adapter succeeds
 */
"use strict";

const outbox = require("./automation-outbox");

const PRIORITY_RANKS = Object.freeze({
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3
});

/**
 * Runs a single bounded batch of outbox events.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} options
 * @param {string} options.workerId Unique worker identifier
 * @param {number} options.batchSize Max events to process (default: 10)
 * @param {number} options.nowMs Current timestamp
 * @param {number} options.leaseMs Lease duration in ms (default: 60000)
 * @param {Object} options.dispatchers Map of channel adapter functions: { [channel]: async (event) => { success: boolean, result?: any, error?: Error } }
 * @param {Object} options.logger Logger object with info/warn/error
 */
async function runOutboxWorkerBatch(db, options = {}) {
  const workerId = options.workerId || `worker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const batchSize = Math.min(Number(options.batchSize) || 10, 10);
  const nowMs = options.nowMs || Date.now();
  const leaseMs = options.leaseMs || outbox.DEFAULT_LEASE_MS;
  const dispatchers = options.dispatchers || {};
  const logger = options.logger || console;

  const stats = {
    scanned: 0,
    claimed: 0,
    completed: 0,
    skipped: 0,
    retried: 0,
    deadLetter: 0,
    unsupportedPending: 0,
    adapterPending: 0,
    deliveryUnknown: 0,
    errors: []
  };

  // 1. Query pending events (bounded query)
  const pendingSnap = await db
    .collection("automation_outbox")
    .where("status", "==", "pending")
    .limit(30)
    .get();

  let allDocs = pendingSnap.docs.map((d) => ({ ref: d.ref, id: d.id, data: d.data() }));

  // Also query abandoned/crashed leases for crash recovery
  try {
    const processingSnap = await db
      .collection("automation_outbox")
      .where("status", "==", "processing")
      .limit(10)
      .get();
    if (processingSnap && !processingSnap.empty) {
      const expiredProcessing = processingSnap.docs
        .filter((d) => {
          const data = typeof d.data === "function" ? d.data() : d.data;
          return data && data.leaseExpiresAtMs && data.leaseExpiresAtMs <= nowMs;
        })
        .map((d) => ({ ref: d.ref, id: d.id, data: typeof d.data === "function" ? d.data() : d.data }));
      allDocs = allDocs.concat(expiredProcessing);
    }
  } catch (procErr) {
    // Non-blocking in environments without processing index
  }

  stats.scanned = allDocs.length;
  if (allDocs.length === 0) {
    return stats;
  }

  // 2. In-memory filter for retry readiness and deterministic sorting
  const readyDocs = allDocs.filter((d) => {
    if (d.data.status === "processing") return true;
    return !d.data.nextRetryAtMs || d.data.nextRetryAtMs <= nowMs;
  });

  readyDocs.sort((a, b) => {
    const rankA = PRIORITY_RANKS[a.data.priority] !== undefined ? PRIORITY_RANKS[a.data.priority] : 2;
    const rankB = PRIORITY_RANKS[b.data.priority] !== undefined ? PRIORITY_RANKS[b.data.priority] : 2;
    if (rankA !== rankB) return rankA - rankB; // higher priority first
    return (a.data.createdAtMs || 0) - (b.data.createdAtMs || 0); // older events first
  });

  const batch = readyDocs.slice(0, batchSize);

  // 3. Process each ready event sequentially inside isolated transactions
  for (const item of batch) {
    const docRef = item.ref;
    let claimedEvent = null;

    // Step A: Claim lease
    try {
      const claimResult = await db.runTransaction(async (tx) => {
        return outbox.claimOutboxEventTx(tx, docRef, workerId, nowMs, leaseMs);
      });

      if (!claimResult.claimed) {
        continue; // Was claimed by a concurrent worker or invalid status
      }

      claimedEvent = claimResult.event;
      stats.claimed++;
    } catch (claimErr) {
      logger.warn(`[OutboxWorker] Claim failed for ${item.id}:`, claimErr.message);
      continue;
    }

    // Step B: Dispatch to appropriate channel adapter
    const channel = claimedEvent.channel || "whatsapp";
    const dispatcher = dispatchers[channel];
    const startTime = Date.now();

    let dispatchOutcome;
    if (typeof dispatcher === "function") {
      try {
        const res = await dispatcher(claimedEvent);
        dispatchOutcome = {
          success: res && res.success === true,
          result: res ? res.result : null,
          error: res && res.error ? res.error : null,
          isPendingAdapter: res && res.isPendingAdapter === true,
          deliveryUnknown: res && res.deliveryUnknown === true,
          skipped: res && res.skipped === true,
          channelDeliveries: res && res.channelDeliveries ? res.channelDeliveries : null
        };
        if (dispatchOutcome.isPendingAdapter) {
          stats.unsupportedPending++;
        }
      } catch (err) {
        dispatchOutcome = {
          success: false,
          error: err
        };
      }
    } else {
      // Explicit unsupported / pending result (Phase 2 adapter not yet wired)
      // We NEVER simulate fake delivery!
      dispatchOutcome = {
        success: false,
        error: new Error(`CHANNEL_ADAPTER_PENDING_PHASE2: channel '${channel}' has no live dispatcher wired`),
        isPendingAdapter: true
      };
      stats.unsupportedPending++;
    }

    const durationMs = Date.now() - startTime;

    // Step C: Record outcome in transaction & log
    try {
      const recordResult = await db.runTransaction(async (tx) => {
        const out = await outbox.recordOutboxResultTx(tx, docRef, {
          success: dispatchOutcome.success,
          result: dispatchOutcome.result,
          error: dispatchOutcome.error,
          isPendingAdapter: dispatchOutcome.isPendingAdapter === true,
          deliveryUnknown: dispatchOutcome.deliveryUnknown === true,
          skipped: dispatchOutcome.skipped === true,
          channelDeliveries: dispatchOutcome.channelDeliveries || (claimedEvent.channel && dispatchOutcome.result ? { [claimedEvent.channel]: dispatchOutcome.result } : null),
          nowMs: Date.now()
        });

        // Write audit log if terminal (completed, skipped or dead_letter) or on error/unknown
        if (dispatchOutcome.success || out.status === "dead_letter" || out.skipped || out.deliveryUnknown) {
          const logRecord = outbox.createAuditLogRecord({
            eventId: claimedEvent.eventId,
            eventName: claimedEvent.eventName,
            entityId: claimedEvent.entityId,
            division: claimedEvent.division,
            channel: claimedEvent.channel,
            workerId,
            status: dispatchOutcome.success ? (out.skipped ? "skipped" : "delivered") : (out.deliveryUnknown ? "delivery_unknown" : "dead_letter"),
            durationMs,
            payload: claimedEvent.payload,
            error: dispatchOutcome.error,
            nowMs: Date.now()
          });

          tx.set(db.collection("automation_logs").doc(logRecord.logId), logRecord);
        }

        return out;
      });

      if (recordResult.status === "completed") {
        if (recordResult.skipped) {
          stats.skipped = (stats.skipped || 0) + 1;
        } else {
          stats.completed++;
        }
      } else if (recordResult.status === "dead_letter") {
        stats.deadLetter++;
      } else if (recordResult.status === "adapter_pending") {
        stats.adapterPending++;
      } else {
        if (recordResult.deliveryUnknown) {
          stats.deliveryUnknown = (stats.deliveryUnknown || 0) + 1;
        }
        stats.retried++;
      }
    } catch (recordErr) {
      logger.error(`[OutboxWorker] Failed to record outcome for ${item.id}:`, recordErr.message);
      stats.errors.push({ id: item.id, error: recordErr.message });
    }
  }

  return stats;
}

module.exports = {
  PRIORITY_RANKS,
  runOutboxWorkerBatch
};
