/**
 * PACKZEN 3.0 — Server-to-Server n8n Webhook Channel Adapter
 * ------------------------------------------------------------------
 * Direct server-side integration between PackZen Transactional Outbox and n8n (Railway).
 *
 * Security & Reliability Features:
 *   - Server-side outbound HTTP/HTTPS only (no browser/client exposure)
 *   - Cryptographic HMAC-SHA256 request signing over canonical string
 *   - Canonical signing format: `${timestamp}.${eventId}.${rawPayload}`
 *   - Constant-time signature comparison (crypto.timingSafeEqual)
 *   - Strict timestamp freshness window (5 minutes / 300,000 ms) to prevent replay
 *   - Event ID correlation and idempotent deduplication
 *   - Secret Manager credential resolution (N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET)
 *   - Graceful adapter_pending state when secrets are unconfigured
 *   - Payload schema validation for all 11 supported events
 *   - PII minimization and secret redaction (passwords, tokens, OTPs, authkeys)
 *   - Payload size enforcement (max 256 KB) and request timeouts (10s)
 *   - Strict HTTP response handling: 2xx (delivered), 429/5xx (retryable with backoff),
 *     4xx (non-retryable client error), timeouts/connection resets (delivery_unknown)
 *   - Independent channelDeliveries.webhook tracking for multi-channel safety
 */
"use strict";

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const { defineSecret } = require("firebase-functions/params");
const stagingGuard = require("./staging-notification-guard");

// Secrets managed via Google Cloud Secret Manager / Firebase Functions Params
const N8N_WEBHOOK_URL    = defineSecret("N8N_WEBHOOK_URL");
const N8N_WEBHOOK_SECRET = defineSecret("N8N_WEBHOOK_SECRET");

const N8N_SECRETS = [
  N8N_WEBHOOK_URL,
  N8N_WEBHOOK_SECRET
];

const SIGNATURE_VERSION = "v1";
const SCHEMA_VERSION = "3.0";
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes (300,000 ms)
const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB
const DEFAULT_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

const VALID_DIVISIONS = Object.freeze(["logistics", "home_services", "digital", "overhead"]);
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
  "partner.assigned"
]);

/**
 * Resolves live runtime credentials. Supports testing overrides.
 */
function getWebhookConfig(overrides = null) {
  if (overrides && typeof overrides === "object") {
    const hasWebhookKeys = overrides.webhookUrl !== undefined || overrides.webhookSecret !== undefined || overrides.url !== undefined || overrides.secret !== undefined;
    if (hasWebhookKeys) {
      return {
        webhookUrl: overrides.webhookUrl || overrides.url || null,
        webhookSecret: overrides.webhookSecret || overrides.secret || null
      };
    }
  }
  return {
    webhookUrl: (typeof N8N_WEBHOOK_URL.value === "function" ? N8N_WEBHOOK_URL.value() : process.env.N8N_WEBHOOK_URL) || null,
    webhookSecret: (typeof N8N_WEBHOOK_SECRET.value === "function" ? N8N_WEBHOOK_SECRET.value() : process.env.N8N_WEBHOOK_SECRET) || null
  };
}

/**
 * Builds canonical string for HMAC-SHA256 signature.
 * Canonical format: `${timestamp}.${eventId}.${rawPayload}`
 */
function buildCanonicalSigningString(timestamp, eventId, rawPayload) {
  return `${timestamp}.${eventId}.${rawPayload}`;
}

/**
 * Generates HMAC-SHA256 signature header value.
 * Output: `v1=<hex_digest>`
 */
function generateWebhookSignature(timestamp, eventId, rawPayload, secret) {
  if (!secret) return null;
  const canonical = buildCanonicalSigningString(timestamp, eventId, rawPayload);
  const hmac = crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  return `${SIGNATURE_VERSION}=${hmac}`;
}

/**
 * Verifies webhook signature with constant-time equality and timestamp freshness.
 * Can be used by n8n custom receiver nodes or test suites.
 */
function verifyWebhookSignature({
  rawBody,
  signatureHeader,
  timestampHeader,
  eventIdHeader,
  secret,
  maxDriftMs = MAX_TIMESTAMP_DRIFT_MS,
  nowMs = Date.now()
}) {
  if (!signatureHeader || !timestampHeader || !eventIdHeader || !secret) {
    return { valid: false, reason: "MISSING_REQUIRED_VERIFICATION_PARAMS" };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: "INVALID_TIMESTAMP_HEADER" };
  }

  // 1. Freshness check (Replay Protection)
  const drift = Math.abs(nowMs - timestamp);
  if (drift > maxDriftMs) {
    return { valid: false, reason: "TIMESTAMP_EXPIRED_OR_DRIFT_EXCEEDED", driftMs: drift };
  }

  // 2. Canonical payload conversion
  const bodyString = typeof rawBody === "string" ? rawBody : (Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : JSON.stringify(rawBody));

  // 3. Expected signature computation
  const expectedSignature = generateWebhookSignature(timestamp, eventIdHeader, bodyString, secret);
  if (!expectedSignature) {
    return { valid: false, reason: "CANNOT_COMPUTE_EXPECTED_SIGNATURE" };
  }

  // 4. Constant-time comparison
  const sigBuffer = Buffer.from(String(signatureHeader), "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: "SIGNATURE_LENGTH_MISMATCH" };
  }

  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, reason: "SIGNATURE_DIGEST_MISMATCH" };
  }

  return { valid: true };
}

/**
 * Redacts secrets, authentication tokens, passwords, and sensitive keys.
 * Preserves essential operational data required by n8n workflows.
 */
function sanitizePayloadForWebhook(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayloadForWebhook);

  const out = {};
  const secretPattern = /(password|token|secret|authkey|apikey|pepper|otp|signature|bearer|private)/i;

  for (const [k, v] of Object.entries(obj)) {
    if (secretPattern.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = sanitizePayloadForWebhook(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Validates outbox event structure and schema for webhook transmission.
 */
function validateWebhookEvent(event) {
  if (!event || typeof event !== "object") {
    return { valid: false, error: "Event must be a non-null object" };
  }
  if (!event.eventId || typeof event.eventId !== "string" || event.eventId.trim().length === 0) {
    return { valid: false, error: "Missing or invalid eventId" };
  }
  if (!event.eventName || !SUPPORTED_EVENTS.includes(event.eventName)) {
    return { valid: false, error: `Unsupported or invalid eventName: '${event.eventName}'` };
  }
  if (!event.division || !VALID_DIVISIONS.includes(event.division)) {
    return { valid: false, error: `Invalid division: '${event.division}'` };
  }
  if (!event.payload || typeof event.payload !== "object") {
    return { valid: false, error: "Missing or invalid payload object" };
  }
  return { valid: true };
}

/**
 * Sends signed webhook HTTP/HTTPS request to n8n endpoint.
 * Never throws — resolves with detailed outcome.
 */
function sendWebhookRequest({
  event,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  nowMs = Date.now()
}, configOverride = null) {
  return new Promise((resolve) => {
    const config = getWebhookConfig(configOverride);
    const { webhookUrl, webhookSecret } = config;

    // Check configuration
    if (!webhookUrl) {
      resolve({
        success: false,
        isPendingAdapter: true,
        retryable: false,
        error: "N8N_WEBHOOK_URL_NOT_CONFIGURED"
      });
      return;
    }
    if (!webhookSecret) {
      resolve({
        success: false,
        isPendingAdapter: true,
        retryable: false,
        error: "N8N_WEBHOOK_SECRET_NOT_CONFIGURED"
      });
      return;
    }

    // Staging & Non-Production Notification Isolation Guard (Phase 2)
    const guard = stagingGuard.evaluateOutboundTarget({
      channel: "webhook",
      recipient: webhookUrl,
      metadata: { eventId: event && event.eventId, eventName: event && event.eventName }
    });

    if (!guard.allowed) {
      const sim = stagingGuard.createSimulatedResponse({
        channel: "webhook",
        recipient: webhookUrl,
        eventId: event && event.eventId,
        metadata: { guardReason: guard.reason }
      });
      const deliveryInfo = {
        channel: "webhook",
        provider: "n8n_simulated",
        status: "simulated_sent",
        simulated: true,
        guardReason: guard.reason,
        durationMs: 0,
        sentAtMs: Date.now()
      };
      resolve({
        success: true,
        simulated: true,
        channel: "webhook",
        provider: "n8n_simulated",
        channelDeliveries: {
          webhook: deliveryInfo
        },
        result: deliveryInfo
      });
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch (urlErr) {
      resolve({
        success: false,
        retryable: false,
        error: `INVALID_WEBHOOK_URL: ${urlErr.message}`
      });
      return;
    }

    // Construct canonical outbound message body
    const outboundMessage = {
      eventId: event.eventId,
      eventName: event.eventName,
      entityType: event.entityType,
      entityId: event.entityId,
      division: event.division,
      priority: event.priority || "normal",
      timestamp: nowMs,
      payload: sanitizePayloadForWebhook(event.payload),
      metadata: Object.assign({}, event.metadata || {}, {
        adapter: "n8n-webhook",
        schemaVersion: SCHEMA_VERSION
      })
    };

    let serializedBody;
    try {
      serializedBody = JSON.stringify(outboundMessage);
    } catch (serErr) {
      resolve({
        success: false,
        retryable: false,
        error: `SERIALIZATION_ERROR: ${serErr.message}`
      });
      return;
    }

    const payloadByteLength = Buffer.byteLength(serializedBody, "utf8");
    if (payloadByteLength > MAX_PAYLOAD_BYTES) {
      resolve({
        success: false,
        retryable: false,
        error: `PAYLOAD_SIZE_EXCEEDED: ${payloadByteLength} bytes exceeds limit of ${MAX_PAYLOAD_BYTES} bytes`
      });
      return;
    }

    // Compute cryptographic signature
    const signature = generateWebhookSignature(nowMs, event.eventId, serializedBody, webhookSecret);

    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;
    const port = parsedUrl.port || (isHttps ? 443 : 80);

    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": payloadByteLength,
        "User-Agent": "PackZen-Automation-Outbox/3.0",
        "X-PackZen-Event-Id": event.eventId,
        "X-PackZen-Timestamp": String(nowMs),
        "X-PackZen-Signature": signature,
        "X-PackZen-Version": SCHEMA_VERSION
      },
      timeout: timeoutMs
    };

    let req;
    let timedOut = false;
    let settled = false;

    const safeResolve = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    try {
      req = transport.request(requestOptions, (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          const statusCode = res.statusCode || 0;

          // HTTP 2xx: Delivery confirmed
          if (statusCode >= 200 && statusCode < 300) {
            safeResolve({
              success: true,
              statusCode,
              responseBody: responseData.slice(0, 500)
            });
            return;
          }

          // HTTP 429: Rate limited by n8n
          if (statusCode === 429) {
            safeResolve({
              success: false,
              statusCode: 429,
              retryable: true,
              error: `N8N_RATE_LIMITED: HTTP 429 response: ${responseData.slice(0, 200)}`
            });
            return;
          }

          // HTTP 5xx: n8n server error
          if (statusCode >= 500 && statusCode < 600) {
            safeResolve({
              success: false,
              statusCode,
              retryable: true,
              error: `N8N_SERVER_ERROR: HTTP ${statusCode}: ${responseData.slice(0, 200)}`
            });
            return;
          }

          // HTTP 4xx (Client errors)
          safeResolve({
            success: false,
            statusCode,
            retryable: false,
            error: `N8N_CLIENT_ERROR: HTTP ${statusCode}: ${responseData.slice(0, 200)}`
          });
        });
      });

      req.on("timeout", () => {
        timedOut = true;
        req.destroy();
        safeResolve({
          success: false,
          deliveryUnknown: true,
          retryable: true,
          error: "N8N_REQUEST_TIMEOUT: Socket timed out while waiting for n8n response"
        });
      });

      req.on("error", (err) => {
        if (timedOut) return;
        const isSocketReset = /econnreset|econnrefused|socket hang up|disconnect/i.test(err.message);
        safeResolve({
          success: false,
          deliveryUnknown: isSocketReset,
          retryable: true,
          error: `N8N_NETWORK_ERROR: ${err.message}`
        });
      });

      req.write(serializedBody);
      req.end();
    } catch (syncErr) {
      safeResolve({
        success: false,
        retryable: true,
        deliveryUnknown: false,
        error: `N8N_DISPATCH_EXCEPTION: ${syncErr.message}`
      });
    }
  });
}

/**
 * Authoritative Webhook Event Dispatcher for automation-dispatcher.js
 */
async function dispatchWebhookEvent(claimedEvent, options = {}) {
  // 1. Validate claimed event schema
  const validation = validateWebhookEvent(claimedEvent);
  if (!validation.valid) {
    return {
      success: false,
      retryable: false,
      error: new Error(`INVALID_WEBHOOK_EVENT: ${validation.error}`)
    };
  }

  // 2. Channel Deduplication
  const existingDelivery = claimedEvent.channelDeliveries && claimedEvent.channelDeliveries.webhook;
  if (existingDelivery && existingDelivery.status === "delivered") {
    return {
      success: true,
      duplicateSkipped: true,
      provider: "webhook",
      channelDeliveries: {
        webhook: existingDelivery
      },
      result: existingDelivery
    };
  }

  // 3. Sender execution (supports mock sender injection for tests)
  const webhookSender = options.webhookSender || sendWebhookRequest;
  const startTime = Date.now();

  try {
    const effectiveConfig = options.configOverride || (options.webhookUrl ? options : null);
    const res = await webhookSender({
      event: claimedEvent,
      timeoutMs: options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
      nowMs: startTime
    }, effectiveConfig);

    const durationMs = Date.now() - startTime;

    if (res && res.success === true) {
      const isSimulated = res.simulated === true;
      const deliveryInfo = {
        channel: "webhook",
        provider: isSimulated ? "n8n_simulated" : "n8n_webhook",
        status: isSimulated ? "simulated_sent" : "delivered",
        statusCode: res.statusCode || 200,
        durationMs,
        simulated: isSimulated,
        guardReason: res.guardReason || null,
        deliveredAtMs: isSimulated ? undefined : Date.now(),
        sentAtMs: isSimulated ? Date.now() : undefined
      };
      return {
        success: true,
        simulated: isSimulated,
        channel: "webhook",
        provider: isSimulated ? "n8n_simulated" : "webhook",
        channelDeliveries: {
          webhook: deliveryInfo
        },
        result: deliveryInfo
      };
    }

    if (res && res.isPendingAdapter === true) {
      return {
        success: false,
        isPendingAdapter: true,
        channel: "webhook",
        error: new Error(res.error || "WEBHOOK_CREDENTIALS_NOT_CONFIGURED")
      };
    }

    if (res && res.deliveryUnknown === true) {
      return {
        success: false,
        deliveryUnknown: true,
        retryable: true,
        error: new Error(res.error || "WEBHOOK_DELIVERY_UNKNOWN")
      };
    }

    return {
      success: false,
      retryable: res ? res.retryable === true : true,
      error: new Error((res && res.error) || "WEBHOOK_DISPATCH_FAILED")
    };
  } catch (err) {
    return {
      success: false,
      retryable: true,
      deliveryUnknown: /timeout|disconnect|econnreset/i.test(err.message),
      error: err
    };
  }
}

module.exports = {
  N8N_SECRETS,
  SIGNATURE_VERSION,
  SCHEMA_VERSION,
  MAX_TIMESTAMP_DRIFT_MS,
  MAX_PAYLOAD_BYTES,
  getWebhookConfig,
  buildCanonicalSigningString,
  generateWebhookSignature,
  verifyWebhookSignature,
  sanitizePayloadForWebhook,
  validateWebhookEvent,
  sendWebhookRequest,
  dispatchWebhookEvent
};
