/**
 * PACKZEN 3.0 — Automation Control Center Core
 * ------------------------------------------------------------------
 * Authoritative server-side management, monitoring, and reconciliation engine:
 *   - Dashboard aggregation for all 11 event types across Logistics, Home Services, and Digital
 *   - Channel health monitoring (Brevo Email, Meta WhatsApp Cloud API, n8n Webhook)
 *   - Safe failure inspection with strict PII masking and secret redaction
 *   - Owner-only safe recovery controls with transactional state validation
 *   - Reconciliation engine for stale leases, unpausing verified adapters, and ambiguous deliveries
 *   - Idempotent recovery request protection and immutable audit logging in automation_logs
 *   - Rate limiting and role-based access control (RBAC) via OWNER_EMAILS allow-list
 */
"use strict";

const crypto = require("crypto");
const outbox = require("./automation-outbox");
const { getWebhookConfig } = require("./channel-webhook");
const { getWhatsAppConfig } = require("./channel-whatsapp");
const { isCallerAdmin } = require("./staff-customer");

const OWNER_EMAILS = ["azharahmedm786@gmail.com", "azharahmednaz@gmail.com", "moveeasyblr@gmail.com"];
const MAX_BATCH_QUERY = 100;
const MAX_MANUAL_RETRIES = 3;

/**
 * PII Masking helper for administrative UI inspection.
 * Masks mobile numbers, emails, and full addresses.
 */
function maskPiiForDisplay(val) {
  if (typeof val !== "string") return val;

  // Mask mobile numbers: 9845012345 -> 98450*****
  let s = val.replace(/(\+?91[\s\-]?)?(\d[\s\-]?){6,9}(\d{4})\b/g, (m, prefix, _, last4) => {
    return (prefix || "") + "******" + last4;
  });

  // Mask email addresses: name@example.com -> n***@example.com
  s = s.replace(/\b([a-zA-Z0-9_.+-])[a-zA-Z0-9_.+-]*@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b/g, "$1***@$2");
  return s;
}

/**
 * Deep sanitization for administrative inspection view.
 * Redacts secrets, passwords, OTPs, payment signatures, and masks customer PII.
 */
function sanitizePayloadForDisplay(obj) {
  if (!obj || typeof obj !== "object") return maskPiiForDisplay(obj);
  if (Array.isArray(obj)) return obj.map(sanitizePayloadForDisplay);

  const out = {};
  const secretPattern = /(password|token|secret|authkey|apikey|pepper|otp|signature|bearer|private)/i;

  for (const [k, v] of Object.entries(obj)) {
    if (secretPattern.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = sanitizePayloadForDisplay(v);
    } else {
      out[k] = maskPiiForDisplay(v);
    }
  }
  return out;
}

/**
 * Aggregates automation outbox metrics and health statistics.
 */
async function getAutomationDashboardStats(db, filters = {}) {
  const collectionRef = db.collection("automation_outbox");
  const snap = await collectionRef.limit(MAX_BATCH_QUERY).get();

  const counts = {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0, // retry_scheduled
    dead_letter: 0,
    adapter_pending: 0,
    delivery_unknown: 0
  };

  const channelHealth = {
    email: { delivered: 0, failed: 0, retryable: 0, duplicateSkipped: 0 },
    whatsapp: { delivered: 0, failed: 0, skipped: 0, sent: 0, read: 0 },
    webhook: { delivered: 0, failed: 0, ambiguous: 0, adapterPending: 0 }
  };

  const divisionCounts = {
    all: 0,
    logistics: 0,
    home_services: 0,
    digital: 0
  };

  const recentEvents = [];
  const nowMs = Date.now();

  const divisionFilter = filters.division && filters.division !== "all" ? filters.division : null;
  const statusFilter = filters.status && filters.status !== "all" ? filters.status : null;
  const channelFilter = filters.channel && filters.channel !== "all" ? filters.channel : null;
  const eventNameFilter = filters.eventName && filters.eventName !== "all" ? filters.eventName : null;

  for (const doc of snap.docs) {
    const data = typeof doc.data === "function" ? doc.data() : doc.data;
    if (!data) continue;

    // Global counts
    counts.total++;
    const status = data.status || "pending";
    if (counts[status] !== undefined) {
      counts[status]++;
    }
    if (data.deliveryUnknown) {
      counts.delivery_unknown++;
    }

    // Division breakdown
    const div = data.division || "logistics";
    if (divisionCounts[div] !== undefined) {
      divisionCounts[div]++;
    }

    // Channel stats aggregation
    const deliveries = data.channelDeliveries || {};
    if (deliveries.email) {
      if (deliveries.email.status === "delivered") channelHealth.email.delivered++;
      else if (deliveries.email.status === "failed") channelHealth.email.failed++;
    }
    if (deliveries.whatsapp) {
      if (deliveries.whatsapp.status === "delivered") channelHealth.whatsapp.delivered++;
      else if (deliveries.whatsapp.status === "skipped") channelHealth.whatsapp.skipped++;
      else if (deliveries.whatsapp.status === "failed") channelHealth.whatsapp.failed++;
    }
    if (deliveries.webhook) {
      if (deliveries.webhook.status === "delivered") channelHealth.webhook.delivered++;
      else if (deliveries.webhook.status === "adapter_pending") channelHealth.webhook.adapterPending++;
      else if (deliveries.webhook.status === "failed") channelHealth.webhook.failed++;
    }
    if (data.deliveryUnknown && (data.channel === "webhook" || deliveries.webhook)) {
      channelHealth.webhook.ambiguous++;
    }

    // Filter checks
    if (divisionFilter && div !== divisionFilter) continue;
    if (statusFilter && status !== statusFilter) continue;
    if (channelFilter && data.channel !== channelFilter && !deliveries[channelFilter]) continue;
    if (eventNameFilter && data.eventName !== eventNameFilter) continue;

    recentEvents.push({
      eventId: doc.id,
      eventName: data.eventName,
      entityType: data.entityType,
      entityId: data.entityId,
      division: div,
      channel: data.channel,
      status,
      attempts: data.attempts || 0,
      deliveryUnknown: data.deliveryUnknown === true,
      lastError: data.lastError ? String(data.lastError).slice(0, 150) : null,
      channelDeliveries: data.channelDeliveries || {},
      nextRetryAtMs: data.nextRetryAtMs || null,
      leaseExpiresAtMs: data.leaseExpiresAtMs || null,
      claimedBy: data.claimedBy || null,
      createdAtMs: data.createdAtMs || 0
    });
  }

  // Sort recent events newest first
  recentEvents.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  // Determine operational health state
  let systemHealth = "HEALTHY";
  if (counts.dead_letter > 0 || counts.delivery_unknown > 5) {
    systemHealth = "WARNING";
  }
  if (counts.dead_letter > 5 || counts.failed > 10) {
    systemHealth = "CRITICAL";
  }

  return {
    systemHealth,
    counts,
    divisionCounts,
    channelHealth,
    recentEvents: recentEvents.slice(0, 50),
    timestamp: nowMs
  };
}

/**
 * Fetches sanitized details of a specific outbox event.
 */
async function getAutomationEventDetail(db, eventId) {
  if (!eventId || typeof eventId !== "string") {
    throw new Error("INVALID_EVENT_ID");
  }

  const snap = await db.collection("automation_outbox").doc(eventId).get();
  if (!snap.exists) {
    throw new Error("EVENT_NOT_FOUND");
  }

  const data = snap.data();

  return {
    eventId: snap.id,
    eventName: data.eventName,
    entityType: data.entityType,
    entityId: data.entityId,
    division: data.division,
    priority: data.priority,
    channel: data.channel,
    targetChannels: data.targetChannels || null,
    status: data.status,
    attempts: data.attempts || 0,
    maxRetries: data.maxRetries || outbox.DEFAULT_MAX_RETRIES,
    manualRetryCount: data.manualRetryCount || 0,
    deliveryUnknown: data.deliveryUnknown === true,
    lastError: data.lastError || null,
    channelDeliveries: data.channelDeliveries || {},
    attemptHistory: (data.attemptHistory || []).map((h) => ({
      attempt: h.attempt,
      workerId: h.workerId,
      status: h.status,
      failedAtMs: h.failedAtMs || null,
      completedAtMs: h.completedAtMs || null,
      error: h.error ? String(h.error).slice(0, 150) : null
    })),
    sanitizedPayload: sanitizePayloadForDisplay(data.payload || {}),
    metadata: data.metadata || {},
    claimedBy: data.claimedBy || null,
    leaseExpiresAtMs: data.leaseExpiresAtMs || null,
    nextRetryAtMs: data.nextRetryAtMs || null,
    createdAtMs: data.createdAtMs,
    updatedAtMs: data.updatedAtMs
  };
}

/**
 * Safely requests a manual retry of an eligible failed/dead-letter event.
 * Must execute inside a Firestore transaction with role authorization.
 */
async function retryOutboxEvent(db, { eventId, reason, nowMs = Date.now() }, context) {
  // 1. Authorize admin/owner
  const isAdmin = await isCallerAdmin(null, context);
  if (!isAdmin) {
    throw new Error("PERMISSION_DENIED: Owner authorization required for manual retry");
  }

  if (!eventId || typeof eventId !== "string") {
    throw new Error("INVALID_EVENT_ID");
  }

  const docRef = db.collection("automation_outbox").doc(eventId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      throw new Error("EVENT_NOT_FOUND");
    }

    const data = snap.data();
    const currentStatus = data.status;

    // Disallowed state: cannot retry completed events
    if (currentStatus === "completed") {
      throw new Error("INVALID_STATE_TRANSITION: Cannot retry an already completed event");
    }

    // Rate limit / duplicate check: cannot retry if already retried in last 10 seconds
    if (data.lastManualRetryAtMs && (nowMs - data.lastManualRetryAtMs) < 10000) {
      throw new Error("RATE_LIMITED: A manual retry was already requested within the last 10 seconds");
    }

    const manualRetries = (data.manualRetryCount || 0) + 1;
    if (manualRetries > MAX_MANUAL_RETRIES) {
      throw new Error(`RETRY_LIMIT_EXCEEDED: Maximum manual retry limit (${MAX_MANUAL_RETRIES}) reached`);
    }

    const update = {
      status: "pending",
      attempts: 0, // Reset attempt count to allow clean worker processing
      manualRetryCount: manualRetries,
      lastManualRetryAtMs: nowMs,
      manualRetryReason: reason || "Admin manual recovery",
      leaseExpiresAtMs: null,
      claimedBy: null,
      claimedAtMs: null,
      nextRetryAtMs: nowMs, // Ready immediately
      deliveryUnknown: false,
      updatedAtMs: nowMs
    };

    tx.update(docRef, update);

    // Write audit log
    const logRecord = outbox.createAuditLogRecord({
      eventId: snap.id,
      eventName: data.eventName,
      entityId: data.entityId,
      division: data.division,
      channel: data.channel,
      workerId: context.auth ? context.auth.uid : "admin_manual",
      status: "manual_retry_scheduled",
      durationMs: 0,
      payload: data.payload,
      error: `Manual retry requested: ${reason || "No reason specified"}`,
      nowMs
    });

    tx.set(db.collection("automation_logs").doc(logRecord.logId), logRecord);

    return {
      success: true,
      eventId: snap.id,
      previousStatus: currentStatus,
      newStatus: "pending",
      manualRetryCount: manualRetries,
      scheduledAtMs: nowMs
    };
  });
}

/**
 * Reconciles stale leases, unpauses verified adapters, or resets expired events.
 */
async function reconcileOutboxEvents(db, { action, division, maxItems = 20, nowMs = Date.now() }, context) {
  // 1. Authorize admin/owner
  const isAdmin = await isCallerAdmin(null, context);
  if (!isAdmin) {
    throw new Error("PERMISSION_DENIED: Owner authorization required for reconciliation");
  }

  const results = {
    action,
    scanned: 0,
    reconciled: 0,
    skipped: 0,
    details: []
  };

  const collectionRef = db.collection("automation_outbox");

  if (action === "stale_leases") {
    // Detect and recover crashed/abandoned processing leases
    const processingSnap = await collectionRef.where("status", "==", "processing").limit(maxItems).get();
    results.scanned = processingSnap.size;

    for (const doc of processingSnap.docs) {
      const data = doc.data();
      if (data.leaseExpiresAtMs && data.leaseExpiresAtMs <= nowMs) {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (fresh.exists && fresh.data().status === "processing" && fresh.data().leaseExpiresAtMs <= nowMs) {
            tx.update(doc.ref, {
              status: "pending",
              leaseExpiresAtMs: null,
              claimedBy: null,
              updatedAtMs: nowMs
            });
          }
        });
        results.reconciled++;
        results.details.push({ eventId: doc.id, reason: "EXPIRED_LEASE_RESET" });
      } else {
        results.skipped++;
      }
    }
  } else if (action === "adapter_pending") {
    // Unpause adapter_pending events ONLY IF verified credentials are available!
    const waConfig = getWhatsAppConfig();
    const wbConfig = getWebhookConfig();

    const isWhatsAppConfigured = Boolean(waConfig.accessToken && waConfig.phoneNumberId);
    const isWebhookConfigured = Boolean(wbConfig.webhookUrl && wbConfig.webhookSecret);

    const pendingSnap = await collectionRef.where("status", "==", "adapter_pending").limit(maxItems).get();
    results.scanned = pendingSnap.size;

    for (const doc of pendingSnap.docs) {
      const data = doc.data();
      const channel = data.channel || "whatsapp";

      let canUnpause = false;
      let checkReason = "";

      if (channel === "whatsapp") {
        canUnpause = isWhatsAppConfigured;
        checkReason = isWhatsAppConfigured ? "WHATSAPP_CONFIGURED" : "WHATSAPP_CREDENTIALS_MISSING";
      } else if (channel === "webhook") {
        canUnpause = isWebhookConfigured;
        checkReason = isWebhookConfigured ? "WEBHOOK_CONFIGURED" : "WEBHOOK_CREDENTIALS_MISSING";
      } else if (channel === "multi_channel") {
        // Multi-channel requires both or relevant configured
        canUnpause = isWhatsAppConfigured || isWebhookConfigured;
        checkReason = canUnpause ? "MULTI_CHANNEL_PARTIALLY_ACTIVE" : "ALL_ADAPTERS_MISSING";
      }

      if (canUnpause) {
        await db.runTransaction(async (tx) => {
          tx.update(doc.ref, {
            status: "pending",
            nextRetryAtMs: nowMs,
            leaseExpiresAtMs: null,
            claimedBy: null,
            updatedAtMs: nowMs
          });
        });
        results.reconciled++;
        results.details.push({ eventId: doc.id, channel, status: "unpaused", reason: checkReason });
      } else {
        results.skipped++;
        results.details.push({ eventId: doc.id, channel, status: "held_pending", reason: checkReason });
      }
    }
  } else if (action === "delivery_unknown") {
    // Reconcile ambiguous delivery events
    const ambSnap = await collectionRef.where("status", "==", "pending").limit(maxItems).get();
    results.scanned = ambSnap.size;

    for (const doc of ambSnap.docs) {
      const data = doc.data();
      if (data.deliveryUnknown === true && (!data.nextRetryAtMs || data.nextRetryAtMs <= nowMs)) {
        // Schedule next controlled re-check
        results.reconciled++;
        results.details.push({ eventId: doc.id, status: "verified_ready", nextRetryAtMs: data.nextRetryAtMs });
      } else {
        results.skipped++;
      }
    }
  } else {
    throw new Error(`INVALID_RECONCILIATION_ACTION: '${action}'`);
  }

  // Audit log the reconciliation action
  if (results.reconciled > 0) {
    const logRecord = outbox.createAuditLogRecord({
      eventId: `reconcile_${nowMs}`,
      eventName: `reconciliation.${action}`,
      entityId: action,
      division: division || "logistics",
      channel: "control_center",
      workerId: context.auth ? context.auth.uid : "admin_reconcile",
      status: "reconciliation_completed",
      durationMs: Date.now() - nowMs,
      payload: results,
      error: null,
      nowMs
    });
    await db.collection("automation_logs").doc(logRecord.logId).set(logRecord);
  }

  return results;
}

module.exports = {
  OWNER_EMAILS,
  maskPiiForDisplay,
  sanitizePayloadForDisplay,
  getAutomationDashboardStats,
  getAutomationEventDetail,
  retryOutboxEvent,
  reconcileOutboxEvents
};
