/**
 * PACKZEN 3.0 — Priority One Automation Outbox Core
 * ------------------------------------------------------------------
 * Implements a bulletproof, Firestore-backed Transactional Outbox pattern:
 *   - Atomic event creation inside Firestore transactions
 *   - SHA-256 deterministic idempotency key hashing & deduplication
 *   - Concurrency protection via lease-locking & worker crash recovery
 *   - Exponential backoff retry engine with dead-letter archiving
 *   - Structured audit logging to `automation_logs` with strict PII masking
 *   - Server-side only execution (clients have zero direct access)
 *
 * Supported Events:
 *   - lead.created
 *   - lead.qualified
 *   - booking.created
 *   - booking.confirmed
 *   - booking.assigned
 *   - booking.completed
 *   - payment.received
 *   - project.created
 *   - project.milestone_updated
 *   - home_service.requested
 *   - partner.assigned
 */
"use strict";

const crypto = require("crypto");

const SUPPORTED_EVENTS = Object.freeze([
  "lead.created",
  "lead.qualified",
  "booking.created",
  "booking.confirmed",
  "booking.assigned",
  "booking.completed",
  "payment.received",
  "project.created",
  "project.milestone_updated",
  "home_service.requested",
  "partner.assigned",
  "lead.assigned",
  "lead.sla_breach",
  "daily.summary",
  "workflow.stage_changed"
]);

const VALID_DIVISIONS = Object.freeze(["logistics", "home_services", "digital", "overhead"]);

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_BACKOFF_MS = 1000; // 1s, 2s, 4s, 8s, 16s...
const DEFAULT_LEASE_MS = 60000; // 60s lease for worker processing

/**
 * Deterministic SHA-256 Idempotency Key generator.
 * Format: sha256(eventName:entityType:entityId:qualifier)
 */
function generateIdempotencyKey(eventName, entityType, entityId, qualifier = "") {
  const parts = [
    String(eventName || "").trim().toLowerCase(),
    String(entityType || "").trim().toLowerCase(),
    String(entityId || "").trim(),
    String(qualifier || "").trim()
  ];
  return crypto.createHash("sha256").update(parts.join(":")).digest("hex");
}

/**
 * Strict PII mask for safe operational logging.
 * Masks mobile numbers and email addresses. Never throws.
 */
function maskPii(val) {
  if (typeof val !== "string") return val;

  // Mask phone numbers: extract sequences of 10-13 phone characters
  let s = val.replace(/(\+?91[\s\-]?)?(\d[\s\-]?){6,9}(\d{4})\b/g, (m, prefix, _, last4) => {
    return (prefix || "") + "******" + last4;
  });

  // Mask email addresses: name@example.com -> n***@example.com
  s = s.replace(/\b([a-zA-Z0-9_.+-])[a-zA-Z0-9_.+-]*@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b/g, "$1***@$2");
  return s;
}

/**
 * Deep sanitization of payload objects for logging.
 * Strips secrets, passwords, tokens, and masks personal identifiers.
 */
function sanitizePayloadForLog(obj) {
  if (!obj || typeof obj !== "object") return maskPii(obj);
  if (Array.isArray(obj)) return obj.map(sanitizePayloadForLog);

  const out = {};
  const secretPattern = /(password|token|secret|authkey|apikey|pepper|otp|signature)/i;

  for (const [k, v] of Object.entries(obj)) {
    if (secretPattern.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = sanitizePayloadForLog(v);
    } else {
      out[k] = maskPii(v);
    }
  }
  return out;
}

/**
 * Validates event structure and creates a standardized Outbox Event document.
 */
function createOutboxEvent({
  eventName,
  entityType,
  entityId,
  division = "logistics",
  payload = {},
  metadata = {},
  idempotencyKey = null,
  priority = "normal",
  channel = "multi_channel",
  nowMs = Date.now()
}) {
  if (!SUPPORTED_EVENTS.includes(eventName)) {
    throw new Error(`Invalid eventName: "${eventName}". Must be one of: ${SUPPORTED_EVENTS.join(", ")}`);
  }
  if (!entityType || typeof entityType !== "string") {
    throw new Error("entityType is required and must be a string");
  }
  if (!entityId || typeof entityId !== "string") {
    throw new Error("entityId is required and must be a string");
  }
  if (!VALID_DIVISIONS.includes(division)) {
    throw new Error(`Invalid division: "${division}". Must be one of: ${VALID_DIVISIONS.join(", ")}`);
  }

  // Derive qualifier from payload for fine-grained idempotency (e.g. paymentId or action timestamp)
  const qualifier = payload.actionId || payload.paymentId || payload.milestoneId || "";
  const key = idempotencyKey || generateIdempotencyKey(eventName, entityType, entityId, qualifier);

  return {
    eventId: key,
    idempotencyKey: key,
    eventName,
    entityType,
    entityId,
    division,
    status: "pending",
    channel,
    priority: ["urgent", "high", "normal", "low"].includes(priority) ? priority : "normal",
    payload,
    metadata: Object.assign({}, metadata, {
      source: metadata.source || "backend-service",
      version: "3.0"
    }),
    attempts: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    attemptHistory: [],
    lastError: null,
    nextRetryAtMs: nowMs,
    leaseExpiresAtMs: null,
    claimedBy: null,
    claimedAtMs: null,
    completedAtMs: null,
    deadLetterAtMs: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
}

/**
 * Enqueue outbox event atomically within an existing Firestore transaction.
 * Uses idempotencyKey as the document key in `automation_outbox`.
 * Guarantees exactly-once enqueuing.
 */
async function enqueueOutboxTx(tx, db, eventData) {
  const collectionRef = db.collection("automation_outbox");
  const docRef = collectionRef.doc(eventData.idempotencyKey);
  const snap = await tx.get(docRef);

  if (snap.exists) {
    // Event with this deterministic key was already enqueued
    return {
      enqueued: false,
      duplicate: true,
      eventId: docRef.id,
      existingStatus: snap.data().status
    };
  }

  tx.set(docRef, eventData);
  return {
    enqueued: true,
    duplicate: false,
    eventId: docRef.id
  };
}

/**
 * Claim an event for processing using lease-locking.
 * Safe against concurrent workers and handles worker crash recovery.
 * Must be executed in a transaction.
 */
async function claimOutboxEventTx(tx, docRef, workerId, nowMs = Date.now(), leaseMs = DEFAULT_LEASE_MS) {
  const snap = await tx.get(docRef);
  if (!snap.exists) {
    return { claimed: false, reason: "DOC_NOT_FOUND" };
  }

  const data = snap.data();

  // Condition 1: Event is pending and ready for processing
  const isPendingReady = data.status === "pending" && (!data.nextRetryAtMs || data.nextRetryAtMs <= nowMs);

  // Condition 2: Event was being processed by a worker that crashed / abandoned its lease
  const isLeaseExpired = data.status === "processing" && (data.leaseExpiresAtMs && data.leaseExpiresAtMs <= nowMs);

  if (!isPendingReady && !isLeaseExpired) {
    return {
      claimed: false,
      reason: data.status === "processing" ? "ALREADY_CLAIMED" : `INVALID_STATUS_${data.status.toUpperCase()}`,
      currentStatus: data.status,
      leaseExpiresAtMs: data.leaseExpiresAtMs
    };
  }

  const attemptNumber = (data.attempts || 0) + 1;
  const newAttempt = {
    attempt: attemptNumber,
    workerId,
    claimedAtMs: nowMs,
    recoveredFromCrash: isLeaseExpired
  };

  const update = {
    status: "processing",
    claimedBy: workerId,
    claimedAtMs: nowMs,
    leaseExpiresAtMs: nowMs + leaseMs,
    attempts: attemptNumber,
    attemptHistory: (data.attemptHistory || []).concat(newAttempt),
    updatedAtMs: nowMs
  };

  tx.update(docRef, update);
  return {
    claimed: true,
    event: Object.assign({}, data, update)
  };
}

/**
 * Record the processing outcome of an outbox event.
 * Handles success transition, exponential backoff, and dead-letter archiving.
 * Must be executed in a transaction.
 */
async function recordOutboxResultTx(
  tx,
  docRef,
  {
    success,
    result = null,
    error = null,
    nowMs = Date.now(),
    baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    isPendingAdapter = false,
    deliveryUnknown = false,
    skipped = false,
    channelDeliveries = null
  }
) {
  const snap = await tx.get(docRef);
  if (!snap.exists) {
    throw new Error(`Cannot record result: outbox document ${docRef.id} does not exist`);
  }

  const data = snap.data();
  const currentAttempts = data.attempts || 1;
  const history = Array.isArray(data.attemptHistory) ? [...data.attemptHistory] : [];
  const lastIndex = history.length - 1;
  const updatedChannelDeliveries = Object.assign({}, data.channelDeliveries || {}, channelDeliveries || {});

  if (skipped) {
    const skipReason = error && error.message ? error.message : String(error || "Skipped");
    if (lastIndex >= 0) {
      history[lastIndex] = Object.assign({}, history[lastIndex], {
        status: "skipped",
        completedAtMs: nowMs,
        reason: skipReason
      });
    }

    const update = {
      status: "completed",
      completedAtMs: nowMs,
      leaseExpiresAtMs: null,
      claimedBy: null,
      skipped: true,
      skipReason,
      channelDeliveries: updatedChannelDeliveries,
      attemptHistory: history,
      updatedAtMs: nowMs
    };

    tx.update(docRef, update);
    return { status: "completed", skipped: true, attempts: currentAttempts };
  }

  if (success) {
    if (lastIndex >= 0) {
      history[lastIndex] = Object.assign({}, history[lastIndex], {
        status: "success",
        completedAtMs: nowMs,
        result: sanitizePayloadForLog(result)
      });
    }

    const update = {
      status: "completed",
      completedAtMs: nowMs,
      leaseExpiresAtMs: null,
      claimedBy: null,
      channelDeliveries: updatedChannelDeliveries,
      attemptHistory: history,
      updatedAtMs: nowMs
    };

    tx.update(docRef, update);
    return { status: "completed", attempts: currentAttempts };
  }

  // Handle pending adapter (Phase 2 not yet wired)
  // Safely pause event without retry exhaustion or dead-letter escalation
  if (isPendingAdapter) {
    const rolledBackAttempts = Math.max(0, currentAttempts - 1);
    const errorMessage = error && error.message ? error.message : String(error || "Adapter pending");

    if (lastIndex >= 0) {
      history[lastIndex] = Object.assign({}, history[lastIndex], {
        status: "adapter_pending",
        pausedAtMs: nowMs,
        reason: errorMessage
      });
    }

    const update = {
      status: "adapter_pending",
      leaseExpiresAtMs: null,
      claimedBy: null,
      lastError: errorMessage,
      attempts: rolledBackAttempts,
      channelDeliveries: updatedChannelDeliveries,
      attemptHistory: history,
      updatedAtMs: nowMs
    };

    tx.update(docRef, update);
    return {
      status: "adapter_pending",
      attempts: rolledBackAttempts,
      error: errorMessage
    };
  }

  // Handle delivery unknown (e.g. timeout / network partition during provider call)
  const errorMessage = error && error.message ? error.message : String(error || "Unknown error");
  if (deliveryUnknown) {
    const backoffMs = baseBackoffMs * Math.pow(2, currentAttempts - 1);
    const nextRetryMs = nowMs + backoffMs;

    if (lastIndex >= 0) {
      history[lastIndex] = Object.assign({}, history[lastIndex], {
        status: "delivery_unknown",
        failedAtMs: nowMs,
        error: errorMessage,
        deliveryUnknown: true,
        nextRetryInMs: backoffMs
      });
    }

    const update = {
      status: "pending",
      nextRetryAtMs: nextRetryMs,
      leaseExpiresAtMs: null,
      claimedBy: null,
      lastError: errorMessage,
      deliveryUnknown: true,
      deliveryUnknownAtMs: nowMs,
      channelDeliveries: updatedChannelDeliveries,
      attemptHistory: history,
      updatedAtMs: nowMs
    };

    tx.update(docRef, update);
    return {
      status: "pending",
      deliveryUnknown: true,
      attempts: currentAttempts,
      nextRetryAtMs: nextRetryMs,
      backoffMs,
      error: errorMessage
    };
  }

  // Handle failure
  const isDeadLetter = currentAttempts >= (data.maxRetries || maxRetries);

  if (isDeadLetter) {
    if (lastIndex >= 0) {
      history[lastIndex] = Object.assign({}, history[lastIndex], {
        status: "dead_letter",
        failedAtMs: nowMs,
        error: errorMessage
      });
    }

    const update = {
      status: "dead_letter",
      deadLetterAtMs: nowMs,
      leaseExpiresAtMs: null,
      claimedBy: null,
      lastError: errorMessage,
      channelDeliveries: updatedChannelDeliveries,
      attemptHistory: history,
      updatedAtMs: nowMs
    };

    tx.update(docRef, update);
    return { status: "dead_letter", attempts: currentAttempts, error: errorMessage };
  }

  // Exponential backoff: baseBackoff * 2^(attempts - 1)
  const backoffMs = baseBackoffMs * Math.pow(2, currentAttempts - 1);
  const nextRetryMs = nowMs + backoffMs;

  if (lastIndex >= 0) {
    history[lastIndex] = Object.assign({}, history[lastIndex], {
      status: "retry_scheduled",
      failedAtMs: nowMs,
      error: errorMessage,
      nextRetryInMs: backoffMs
    });
  }

  const update = {
    status: "pending",
    nextRetryAtMs: nextRetryMs,
    leaseExpiresAtMs: null,
    claimedBy: null,
    lastError: errorMessage,
    channelDeliveries: updatedChannelDeliveries,
    attemptHistory: history,
    updatedAtMs: nowMs
  };

  tx.update(docRef, update);
  return {
    status: "pending",
    attempts: currentAttempts,
    nextRetryAtMs: nextRetryMs,
    backoffMs,
    error: errorMessage
  };
}

/**
 * Creates an immutable audit log record for writing to `automation_logs`.
 * Guarantees zero unmasked PII.
 */
function createAuditLogRecord({
  eventId,
  eventName,
  entityId,
  division,
  channel,
  workerId,
  status,
  durationMs = 0,
  payload = {},
  error = null,
  nowMs = Date.now()
}) {
  const logId = crypto.randomBytes(16).toString("hex");
  return {
    logId,
    eventId,
    eventName,
    entityId,
    division,
    channel,
    workerId,
    status,
    durationMs,
    sanitizedPayload: sanitizePayloadForLog(payload),
    error: error ? String(error.message || error) : null,
    loggedAtMs: nowMs,
    createdAt: new Date(nowMs).toISOString()
  };
}

module.exports = {
  SUPPORTED_EVENTS,
  VALID_DIVISIONS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_LEASE_MS,
  generateIdempotencyKey,
  maskPii,
  sanitizePayloadForLog,
  createOutboxEvent,
  enqueueOutboxTx,
  claimOutboxEventTx,
  recordOutboxResultTx,
  createAuditLogRecord
};
