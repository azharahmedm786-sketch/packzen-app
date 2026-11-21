/**
 * PACKZEN 3.0 — Meta WhatsApp Cloud API Channel Adapter & Webhook Engine
 * ------------------------------------------------------------------
 * Direct server-side integration with Meta WhatsApp Cloud API (Graph API v20.0).
 * Features:
 *   - Secure parameter management via Secret Manager (never exposed or logged)
 *   - Strict E.164 phone normalization with Indian regional support (+91)
 *   - Explicit customer consent checking and opt-out enforcement
 *   - Meta-approved template component compilation
 *   - Correlation via biz_opaque_callback_data (eventId tracking)
 *   - Strict provider evidence enforcement (requires wamid from Meta)
 *   - Ambiguous outcome tracking (delivery_unknown on socket drops)
 *   - Cryptographic webhook signature verification (HMAC-SHA256)
 *   - Webhook callback deduplication and status progression (sent -> delivered -> read)
 *   - Inbound customer opt-out processing (STOP/UNSUBSCRIBE)
 */
"use strict";

const https = require("https");
const crypto = require("crypto");
const { defineSecret } = require("firebase-functions/params");
const templates = require("./whatsapp-templates");
const stagingGuard = require("./staging-notification-guard");

// Secrets managed via Google Cloud Secret Manager / Firebase Functions Params
const WHATSAPP_ACCESS_TOKEN         = defineSecret("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID      = defineSecret("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_BUSINESS_ACCOUNT_ID  = defineSecret("WHATSAPP_BUSINESS_ACCOUNT_ID");
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = defineSecret("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
const WHATSAPP_APP_SECRET           = defineSecret("WHATSAPP_APP_SECRET");

const WHATSAPP_SECRETS = [
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_BUSINESS_ACCOUNT_ID,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET
];

/**
 * Resolves live runtime credentials. Supports testing overrides.
 */
function getWhatsAppConfig(overrides = null) {
  if (overrides && typeof overrides === "object") {
    const hasWhatsAppKeys = overrides.accessToken !== undefined || overrides.phoneNumberId !== undefined;
    if (hasWhatsAppKeys) {
      return {
        accessToken: overrides.accessToken || null,
        phoneNumberId: overrides.phoneNumberId || null,
        businessAccountId: overrides.businessAccountId || null,
        verifyToken: overrides.verifyToken || null,
        appSecret: overrides.appSecret || null
      };
    }
  }
  return {
    accessToken: (typeof WHATSAPP_ACCESS_TOKEN.value === "function" ? WHATSAPP_ACCESS_TOKEN.value() : process.env.WHATSAPP_ACCESS_TOKEN) || null,
    phoneNumberId: (typeof WHATSAPP_PHONE_NUMBER_ID.value === "function" ? WHATSAPP_PHONE_NUMBER_ID.value() : process.env.WHATSAPP_PHONE_NUMBER_ID) || null,
    businessAccountId: (typeof WHATSAPP_BUSINESS_ACCOUNT_ID.value === "function" ? WHATSAPP_BUSINESS_ACCOUNT_ID.value() : process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) || null,
    verifyToken: (typeof WHATSAPP_WEBHOOK_VERIFY_TOKEN.value === "function" ? WHATSAPP_WEBHOOK_VERIFY_TOKEN.value() : process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) || null,
    appSecret: (typeof WHATSAPP_APP_SECRET.value === "function" ? WHATSAPP_APP_SECRET.value() : process.env.WHATSAPP_APP_SECRET) || null
  };
}

/**
 * Normalizes destination phone numbers to E.164 digits without '+'
 * Handles Indian numbers (+91, 0-prefix, bare 10-digits starting with 6-9).
 * Returns null if the number is structurally invalid.
 */
function normalizeE164Phone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== "string" && typeof rawPhone !== "number") {
    return null;
  }
  const digits = String(rawPhone).replace(/\D/g, "");
  if (!digits) return null;

  // Case 1: Standard Indian 10 digits starting with 6, 7, 8, 9
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return "91" + digits;
  }

  // Case 2: 11 digits starting with 0 followed by 6-9
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]\d{9}$/.test(digits.slice(1))) {
    return "91" + digits.slice(1);
  }

  // Case 3: 12 digits starting with 91 followed by 6-9
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) {
    return digits;
  }

  // Case 4: International numbers with country code (11 to 15 digits)
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }

  return null;
}

/**
 * Validates customer WhatsApp consent.
 * Enforces explicit opt-in policy and blocks opted-out recipients.
 */
function checkWhatsAppConsent(payload, templateConfig) {
  if (!payload || typeof payload !== "object") {
    return { allowed: false, reason: "MISSING_PAYLOAD" };
  }

  // Opt-out check (Highest priority)
  if (payload.optOut === true || payload.whatsappOptOut === true) {
    return { allowed: false, reason: "CUSTOMER_OPTED_OUT" };
  }

  // Check explicit consent withdrawal
  if (payload.whatsappConsent === false) {
    return { allowed: false, reason: "CONSENT_WITHDRAWN" };
  }

  // For marketing templates, affirmative opt-in is mandatory
  if (templateConfig.requiresAffirmativeConsent || templateConfig.category === "MARKETING") {
    if (payload.marketingConsent !== true && payload.consentGiven !== true) {
      return { allowed: false, reason: "MISSING_AFFIRMATIVE_MARKETING_CONSENT" };
    }
  }

  return { allowed: true, reason: "TRANSACTIONAL_UTILITY_CONSENT" };
}

/**
 * Dispatches a template message via Meta WhatsApp Cloud API.
 * Never throws — resolves with detailed outcome for the caller.
 */
function sendWhatsAppTemplateMessage({
  toPhone,
  templateName,
  languageCode = "en",
  components = [],
  eventId = null
}, configOverride = null) {
  return new Promise((resolve) => {
    const config = getWhatsAppConfig(configOverride);
    const { accessToken, phoneNumberId } = config;

    if (!accessToken) {
      resolve({
        success: false,
        error: "WHATSAPP_ACCESS_TOKEN_NOT_CONFIGURED",
        isPendingAdapter: true,
        retryable: false
      });
      return;
    }
    if (!phoneNumberId) {
      resolve({
        success: false,
        error: "WHATSAPP_PHONE_NUMBER_ID_NOT_CONFIGURED",
        isPendingAdapter: true,
        retryable: false
      });
      return;
    }
    if (!toPhone) {
      resolve({
        success: false,
        error: "MISSING_DESTINATION_PHONE",
        retryable: false
      });
      return;
    }

    // Staging & Non-Production Notification Isolation Guard (Phase 2)
    const guard = stagingGuard.evaluateOutboundTarget({
      channel: "whatsapp",
      recipient: toPhone,
      metadata: { templateName, eventId }
    });

    if (!guard.allowed) {
      const sim = stagingGuard.createSimulatedResponse({
        channel: "whatsapp",
        recipient: toPhone,
        eventId,
        metadata: { templateName, guardReason: guard.reason }
      });
      resolve({
        success: true,
        simulated: true,
        status: "simulated_sent",
        messageId: sim.messageId,
        guardReason: guard.reason,
        response: sim.response,
        error: null
      });
      return;
    }

    const payloadObj = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components
      }
    };

    if (eventId) {
      payloadObj.biz_opaque_callback_data = String(eventId);
    }

    const payload = JSON.stringify(payloadObj);

    const options = {
      hostname: "graph.facebook.com",
      path: `/v20.0/${phoneNumberId}/messages`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const messageId = parsed.messages && parsed.messages[0] && parsed.messages[0].id;
            if (messageId) {
              resolve({
                success: true,
                messageId,
                response: parsed,
                error: null
              });
            } else {
              // HTTP 200 without messageId evidence
              resolve({
                success: false,
                deliveryUnknown: true,
                error: "META_MISSING_MESSAGE_ID_EVIDENCE",
                retryable: true
              });
            }
          } else {
            const errDetails = parsed.error || {};
            const errorCode = errDetails.code;
            // Meta Cloud API error codes:
            // 130429: Rate limit hit
            // 131026: Undeliverable message
            // 132000: Template not found / unapproved
            // 190: Invalid token
            const isRateLimit = errorCode === 130429 || res.statusCode === 429;
            const isTransientServer = res.statusCode >= 500;
            const retryable = isRateLimit || isTransientServer;

            resolve({
              success: false,
              errorCode,
              error: errDetails.message || `Meta API HTTP ${res.statusCode}`,
              retryable,
              rateLimited: isRateLimit
            });
          }
        } catch (e) {
          resolve({
            success: false,
            error: "Invalid JSON response from Meta API: " + e.message,
            retryable: false
          });
        }
      });
    });

    req.on("error", (err) => {
      resolve({
        success: false,
        deliveryUnknown: true,
        error: err.message,
        retryable: true,
        networkError: true
      });
    });

    req.setTimeout(12000, () => {
      req.destroy();
      resolve({
        success: false,
        deliveryUnknown: true,
        error: "Meta API request timed out",
        retryable: true,
        timedOut: true
      });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Dispatches an outbox event via the WhatsApp adapter.
 * Invoked by automation-dispatcher.
 */
async function dispatchWhatsAppEvent(claimedEvent, options = {}) {
  if (!claimedEvent || typeof claimedEvent !== "object") {
    return { success: false, retryable: false, error: new Error("EVENT_REQUIRED") };
  }

  // 1. Template Registry Lookup
  const templateConfig = templates.getTemplateConfig(claimedEvent.eventName);
  if (!templateConfig) {
    return {
      success: false,
      retryable: false,
      error: new Error(`UNREGISTERED_WHATSAPP_EVENT: '${claimedEvent.eventName}' has no template registered`)
    };
  }

  // Ineligible events (e.g. Digital projects are email-only)
  if (templateConfig.eligible === false) {
    const skippedInfo = { status: "skipped", reason: templateConfig.ineligibleReason };
    return {
      success: true,
      skipped: true,
      provider: "whatsapp",
      channelDeliveries: {
        whatsapp: skippedInfo
      },
      result: skippedInfo
    };
  }

  // 2. Channel Deduplication
  const existingDelivery = claimedEvent.channelDeliveries && claimedEvent.channelDeliveries.whatsapp;
  if (existingDelivery && existingDelivery.status === "delivered") {
    return {
      success: true,
      duplicateSkipped: true,
      provider: "whatsapp",
      channelDeliveries: {
        whatsapp: existingDelivery
      },
      result: existingDelivery
    };
  }

  const p = claimedEvent.payload || {};

  // 3. Recipient Phone Extraction & Normalization
  const rawPhone = templateConfig.getRecipientPhone(p);
  const normalizedPhone = normalizeE164Phone(rawPhone);
  if (!normalizedPhone) {
    return {
      success: false,
      retryable: false,
      error: new Error(`INVALID_DESTINATION_PHONE: '${String(rawPhone).slice(0, 8)}...' cannot be normalized to E.164`)
    };
  }

  // 4. Customer Consent & Messaging Policy Check
  const consent = checkWhatsAppConsent(p, templateConfig);
  if (!consent.allowed) {
    const skippedInfo = { status: "skipped", reason: consent.reason };
    return {
      success: true,
      skipped: true,
      provider: "whatsapp",
      channelDeliveries: {
        whatsapp: skippedInfo
      },
      result: skippedInfo
    };
  }

  // 5. Template Component Compilation
  const components = templateConfig.buildComponents(p);
  const startTime = Date.now();

  // 6. External Call via Client (supports mock sender injection for testing)
  const whatsAppSender = options.whatsAppSender || sendWhatsAppTemplateMessage;

  try {
    const res = await whatsAppSender({
      toPhone: normalizedPhone,
      templateName: templateConfig.templateName,
      languageCode: templateConfig.language || "en",
      components,
      eventId: claimedEvent.eventId
    }, options.configOverride || null);

    const durationMs = Date.now() - startTime;

    if (res && res.success === true && res.messageId) {
      const isSimulated = res.simulated === true;
      const deliveryInfo = {
        provider: isSimulated ? "meta_whatsapp_simulated" : "whatsapp",
        status: isSimulated ? "simulated_sent" : "delivered",
        messageId: res.messageId,
        template: templateConfig.templateName,
        recipient: normalizedPhone.slice(0, 4) + "******" + normalizedPhone.slice(-2),
        durationMs,
        simulated: isSimulated,
        guardReason: res.guardReason || null,
        deliveredAtMs: isSimulated ? undefined : Date.now(),
        sentAtMs: isSimulated ? Date.now() : undefined
      };
      return {
        success: true,
        simulated: isSimulated,
        provider: "whatsapp",
        channelDeliveries: {
          whatsapp: deliveryInfo
        },
        result: deliveryInfo
      };
    }

    if (res && res.success === true && !res.messageId) {
      return {
        success: false,
        deliveryUnknown: true,
        retryable: true,
        error: new Error("META_MISSING_MESSAGE_ID_EVIDENCE: Provider reported success without messageId")
      };
    }

    if (res && res.isPendingAdapter === true) {
      return {
        success: false,
        isPendingAdapter: true,
        channel: "whatsapp",
        error: new Error(res.error || "WHATSAPP_CREDENTIALS_NOT_CONFIGURED")
      };
    }

    if (res && res.deliveryUnknown === true) {
      return {
        success: false,
        deliveryUnknown: true,
        retryable: true,
        error: new Error(res.error || "WHATSAPP_DELIVERY_UNKNOWN")
      };
    }

    return {
      success: false,
      retryable: res ? res.retryable === true : true,
      error: new Error((res && res.error) || "WHATSAPP_DISPATCH_FAILED")
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

/**
 * Verifies Meta Webhook HMAC-SHA256 signature from 'X-Hub-Signature-256' header.
 * Uses timing-safe buffer comparison to prevent timing attacks.
 */
function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!rawBody || !signatureHeader || !appSecret) {
    return false;
  }
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }
  const signatureHash = signatureHeader.slice(prefix.length);

  try {
    const expectedHash = crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedHash, "utf8");
    const actualBuffer = Buffer.from(signatureHash, "utf8");

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (e) {
    return false;
  }
}

/**
 * Handles incoming Meta Webhook events (GET challenge verification and POST status processing).
 */
function handleWebhookGet(query, verifyToken) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    return { status: 200, challenge };
  }
  return { status: 403, error: "VERIFICATION_TOKEN_MISMATCH" };
}

/**
 * Parses and processes incoming status updates or customer messages from Meta.
 */
async function processWebhookBody(body, deps = {}) {
  const results = {
    processedStatuses: 0,
    processedMessages: 0,
    optOuts: 0,
    duplicatesSkipped: 0,
    details: []
  };

  const db = deps.db;
  const processedLog = deps.processedLog || new Set();

  if (!body || !Array.isArray(body.entry)) {
    return results;
  }

  for (const entry of body.entry) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== "messages") continue;
      const value = change.value || {};

      // 1. Process Status Callbacks (sent, delivered, read, failed)
      const statuses = value.statuses || [];
      for (const st of statuses) {
        const messageId = st.id;
        const statusType = st.status; // "sent" | "delivered" | "read" | "failed"
        const eventId = st.biz_opaque_callback_data || null;
        const callbackKey = `${messageId}_${statusType}`;

        if (processedLog.has(callbackKey)) {
          results.duplicatesSkipped++;
          continue;
        }
        processedLog.add(callbackKey);

        const record = {
          messageId,
          status: statusType,
          eventId,
          timestamp: st.timestamp ? Number(st.timestamp) * 1000 : Date.now(),
          recipient: st.recipient_id || null,
          errors: st.errors || null
        };

        if (db && typeof db.collection === "function") {
          try {
            await db.collection("whatsapp_status_logs").doc(callbackKey).set(record);
          } catch (e) {
            // Non-blocking write
          }
        }

        results.processedStatuses++;
        results.details.push(record);
      }

      // 2. Process Inbound Messages (e.g. Opt-Out STOP / UNSUBSCRIBE)
      const messages = value.messages || [];
      for (const msg of messages) {
        const from = msg.from;
        const textBody = msg.text && msg.text.body ? msg.text.body.trim().toUpperCase() : "";

        if (textBody === "STOP" || textBody === "UNSUBSCRIBE" || textBody === "OPT OUT") {
          results.optOuts++;
          if (db && typeof db.collection === "function") {
            try {
              const optOutRecord = {
                phone: from,
                optOut: true,
                optOutAt: Date.now(),
                source: "whatsapp_inbound_stop"
              };
              await db.collection("whatsapp_opt_outs").doc(from).set(optOutRecord);
            } catch (e) {}
          }
        }
        results.processedMessages++;
      }
    }
  }

  return results;
}

module.exports = {
  WHATSAPP_SECRETS,
  getWhatsAppConfig,
  normalizeE164Phone,
  checkWhatsAppConsent,
  sendWhatsAppTemplateMessage,
  dispatchWhatsAppEvent,
  verifyWebhookSignature,
  handleWebhookGet,
  processWebhookBody
};
