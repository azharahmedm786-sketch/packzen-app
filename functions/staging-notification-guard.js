/**
 * functions/staging-notification-guard.js
 * -------------------------------------------------------------
 * PackZen 3.0 Centralized Staging Notification Safety Guard (Phase 2)
 *
 * Enforces strict, fail-closed isolation of all external notification
 * and communication channels (Brevo Email, Meta WhatsApp, MSG91 SMS, n8n Webhook)
 * in staging, emulator, and non-production environments.
 *
 * Core Security Invariants:
 *  1. Production Passthrough: Only when the resolved project ID is EXACTLY
 *     'packzen-e7539' (and not running in an emulator) does live delivery proceed.
 *  2. Staging Fail-Closed Default: In 'packzen-staging-3', emulator, unknown,
 *     or ambiguous environments, the kill switch defaults to ACTIVE.
 *  3. Explicit Override Required: Real delivery in staging strictly requires
 *     STAGING_NOTIFICATION_KILL_SWITCH to be explicitly 'false' AND the recipient
 *     to match strict, channel-specific allowlists.
 *  4. Strict Allowlists:
 *     - Email: Exact normalized match or exact domain match (@packzenblr.in).
 *     - Phone: Exact normalized E.164 digits match.
 *     - Webhook: Exact approved hostnames via HTTPS.
 *  5. Simulation Contract: Simulated dispatches return structurally conforming,
 *     non-error provider responses with unique mock IDs (e.g. sim_brevo_*, sim_wamid_*),
 *     recording status distinctly as 'simulated_sent' (never 'simulated_delivered').
 *  6. Zero External Egress: When intercepted, zero outbound HTTP/HTTPS requests occur.
 * -------------------------------------------------------------
 */
"use strict";

const crypto = require("crypto");

const FORBIDDEN_PRODUCTION_PROJECT = "packzen-e7539";
const APPROVED_STAGING_PROJECT = "packzen-staging-3";

// Default permitted domains for staging email testing
const DEFAULT_ALLOWED_EMAIL_DOMAINS = Object.freeze(["packzenblr.in"]);

/**
 * Resolves the current runtime Firebase / GCP project ID.
 * Evaluates options, GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT, and FIREBASE_CONFIG.
 * Detects and reports conflicting environment declarations.
 */
function resolveCurrentProjectId(options = {}) {
  if (options.projectId && typeof options.projectId === "string") {
    return options.projectId.trim();
  }

  const env = options.env || process.env;
  const gcloud = (env.GCLOUD_PROJECT && String(env.GCLOUD_PROJECT).trim()) || null;
  const googleCloud = (env.GOOGLE_CLOUD_PROJECT && String(env.GOOGLE_CLOUD_PROJECT).trim()) || null;

  let firebaseConfigProject = null;
  if (env.FIREBASE_CONFIG) {
    try {
      const parsed = typeof env.FIREBASE_CONFIG === "string" ? JSON.parse(env.FIREBASE_CONFIG) : env.FIREBASE_CONFIG;
      if (parsed && parsed.projectId) {
        firebaseConfigProject = String(parsed.projectId).trim();
      }
    } catch (_) {
      // Malformed FIREBASE_CONFIG
    }
  }

  const explicitIds = [gcloud, googleCloud, firebaseConfigProject].filter(Boolean);
  if (explicitIds.length === 0) {
    return null;
  }

  // Check for conflicting project identifiers in the environment
  const uniqueIds = [...new Set(explicitIds)];
  if (uniqueIds.length > 1) {
    // Ambiguous conflict detected -> fail closed by returning ambiguous marker
    return `AMBIGUOUS_CONFLICT:[${uniqueIds.join(",")}]`;
  }

  return uniqueIds[0];
}

/**
 * Determines whether the current process is running in a local emulator.
 */
function isEmulatorEnvironment(options = {}) {
  const env = options.env || process.env;
  return (
    env.FUNCTIONS_EMULATOR === "true" ||
    !!env.FIREBASE_EMULATOR_HUB ||
    !!env.FIRESTORE_EMULATOR_HOST
  );
}

/**
 * Validates whether the environment is genuine production (packzen-e7539).
 * Running inside an emulator is NEVER treated as live production, even if
 * GCLOUD_PROJECT is set to packzen-e7539.
 */
function isProductionEnvironment(options = {}) {
  const isEm = isEmulatorEnvironment(options);
  if (isEm) {
    return false;
  }

  const projectId = resolveCurrentProjectId(options);
  return projectId === FORBIDDEN_PRODUCTION_PROJECT;
}

/**
 * Evaluates whether the staging notification kill switch is engaged.
 * Default is FAIL-CLOSED (ACTIVE = true).
 * Only returns false if explicitly set to the string 'false' or boolean false.
 */
function isKillSwitchActive(options = {}) {
  const env = options.env || process.env;
  const raw = options.killSwitch !== undefined ? options.killSwitch : env.STAGING_NOTIFICATION_KILL_SWITCH;

  if (raw === false) {
    return false;
  }
  if (typeof raw === "string" && raw.trim().toLowerCase() === "false") {
    return false;
  }

  // Unset, empty, 'true', '1', malformed, or any other value defaults to ACTIVE
  return true;
}

/**
 * Normalizes email address (lowercase, trimmed, stripped of control chars).
 */
function normalizeEmail(email) {
  if (!email || typeof email !== "string") return "";
  const cleaned = email.trim().toLowerCase();
  if (/[\r\n\0]/.test(cleaned)) return "";
  return cleaned;
}

/**
 * Normalizes phone numbers to Indian E.164 format (digits only, e.g. 919945095453).
 */
function normalizePhone(rawPhone) {
  if (!rawPhone || (typeof rawPhone !== "string" && typeof rawPhone !== "number")) {
    return "";
  }
  const digits = String(rawPhone).replace(/\D/g, "");
  if (!digits) return "";

  // 10 digits starting with 6-9 -> Indian prefix 91
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return "91" + digits;
  }
  // 11 digits starting with 0 followed by 6-9
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]\d{9}$/.test(digits.slice(1))) {
    return "91" + digits.slice(1);
  }
  // 12 digits starting with 91
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) {
    return digits;
  }
  // International E.164 digits without +
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }

  return digits;
}

/**
 * Parses and retrieves channel-specific allowlists.
 */
function getChannelAllowlists(options = {}) {
  const env = options.env || process.env;

  // 1. Email Allowlists
  const rawEmails = options.allowedEmails || env.STAGING_ALLOWED_EMAILS || "";
  const allowedEmails = String(rawEmails)
    .split(",")
    .map(e => normalizeEmail(e))
    .filter(Boolean);

  const rawDomains = options.allowedDomains || env.STAGING_ALLOWED_DOMAINS || "";
  const allowedDomains = String(rawDomains)
    .split(",")
    .map(d => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

  const effectiveDomains = allowedDomains.length > 0 ? allowedDomains : DEFAULT_ALLOWED_EMAIL_DOMAINS;

  // 2. Phone Allowlists
  const rawPhones = options.allowedPhones || env.STAGING_ALLOWED_PHONES || "";
  const allowedPhones = String(rawPhones)
    .split(",")
    .map(p => normalizePhone(p))
    .filter(Boolean);

  // 3. Webhook Host Allowlists
  const rawHosts = options.allowedWebhookHosts || env.STAGING_ALLOWED_WEBHOOK_HOSTS || "";
  const allowedWebhookHosts = String(rawHosts)
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);

  return {
    allowedEmails,
    allowedDomains: effectiveDomains,
    allowedPhones,
    allowedWebhookHosts
  };
}

/**
 * Evaluates whether an email recipient is explicitly allowlisted.
 */
function isEmailAllowlisted(toEmail, allowlists) {
  const email = normalizeEmail(toEmail);
  if (!email || !email.includes("@")) return false;

  // Check exact email address
  if (allowlists.allowedEmails.includes(email)) {
    return true;
  }

  // Check exact domain (no partial subdomain matches)
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1];

  for (const allowedDomain of allowlists.allowedDomains) {
    if (domain === allowedDomain) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether a phone recipient is explicitly allowlisted.
 */
function isPhoneAllowlisted(toPhone, allowlists) {
  const phone = normalizePhone(toPhone);
  if (!phone) return false;

  return allowlists.allowedPhones.includes(phone);
}

/**
 * Evaluates whether a webhook URL is explicitly allowlisted.
 */
function isWebhookAllowlisted(webhookUrl, allowlists) {
  if (!webhookUrl || typeof webhookUrl !== "string") return false;

  let parsed;
  try {
    parsed = new URL(webhookUrl.trim());
  } catch (_) {
    return false;
  }

  // Reject insecure HTTP unless strictly localhost/127.0.0.1
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return allowlists.allowedWebhookHosts.includes(hostname);
}

/**
 * Centralized Outbound Notification Guard Evaluator.
 * Returns: { allowed: boolean, simulated: boolean, mode: string, reason?: string, details?: object }
 */
function evaluateOutboundTarget(params = {}, options = {}) {
  const { channel, recipient, metadata = {} } = params;

  // Check 1: Production Passthrough
  // Live delivery is ONLY allowed when project is exactly packzen-e7539 and not an emulator
  if (isProductionEnvironment(options)) {
    // Check if emergency circuit-breaker was manually engaged in production
    const env = options.env || process.env;
    if (env.STAGING_NOTIFICATION_KILL_SWITCH === "true") {
      return {
        allowed: false,
        simulated: true,
        mode: "production_circuit_broken",
        reason: "EMERGENCY_PRODUCTION_KILL_SWITCH_ACTIVE",
        details: { channel, recipient: maskRecipient(recipient, channel) }
      };
    }

    return {
      allowed: true,
      simulated: false,
      mode: "production_live",
      details: { channel }
    };
  }

  // Check 2: Staging / Non-Production Execution
  const projectId = resolveCurrentProjectId(options);
  const isEm = isEmulatorEnvironment(options);

  // Check 3: Ambiguous or Conflicting Environment -> Fail Closed
  if (projectId && projectId.startsWith("AMBIGUOUS_CONFLICT")) {
    return {
      allowed: false,
      simulated: true,
      mode: "staging_simulated",
      reason: "AMBIGUOUS_ENVIRONMENT_CONFLICT",
      details: { channel, projectId, recipient: maskRecipient(recipient, channel) }
    };
  }

  // Check 4: Kill Switch Check (Default is ACTIVE)
  if (isKillSwitchActive(options)) {
    return {
      allowed: false,
      simulated: true,
      mode: "staging_simulated",
      reason: "KILL_SWITCH_ACTIVE",
      details: {
        channel,
        projectId: projectId || (isEm ? "emulator" : "unknown"),
        recipient: maskRecipient(recipient, channel)
      }
    };
  }

  // Check 5: Kill switch is explicitly 'false' -> Enforce Strict Allowlists
  const allowlists = getChannelAllowlists(options);

  if (channel === "email") {
    if (isEmailAllowlisted(recipient, allowlists)) {
      return {
        allowed: true,
        simulated: false,
        mode: "staging_allowlisted_live",
        details: { channel, recipient: maskRecipient(recipient, channel) }
      };
    }
    return {
      allowed: false,
      simulated: true,
      mode: "staging_simulated",
      reason: "RECIPIENT_NOT_ALLOWLISTED",
      details: { channel, recipient: maskRecipient(recipient, channel) }
    };
  }

  if (channel === "whatsapp" || channel === "sms") {
    if (isPhoneAllowlisted(recipient, allowlists)) {
      return {
        allowed: true,
        simulated: false,
        mode: "staging_allowlisted_live",
        details: { channel, recipient: maskRecipient(recipient, channel) }
      };
    }
    return {
      allowed: false,
      simulated: true,
      mode: "staging_simulated",
      reason: "RECIPIENT_NOT_ALLOWLISTED",
      details: { channel, recipient: maskRecipient(recipient, channel) }
    };
  }

  if (channel === "webhook") {
    if (isWebhookAllowlisted(recipient, allowlists)) {
      return {
        allowed: true,
        simulated: false,
        mode: "staging_allowlisted_live",
        details: { channel, webhookUrl: recipient }
      };
    }
    return {
      allowed: false,
      simulated: true,
      mode: "staging_simulated",
      reason: "WEBHOOK_HOST_NOT_ALLOWLISTED",
      details: { channel, webhookUrl: recipient }
    };
  }

  // Unknown channel -> Fail Closed
  return {
    allowed: false,
    simulated: true,
    mode: "staging_simulated",
    reason: `UNKNOWN_CHANNEL_${channel}`,
    details: { channel }
  };
}

/**
 * Creates structurally conforming, non-error simulated responses for intercepted dispatches.
 * Generates unique simulation IDs and never reports 'simulated_delivered' without live evidence.
 */
function createSimulatedResponse(params = {}) {
  const { channel, recipient, eventId, metadata = {} } = params;
  const nowMs = Date.now();
  const rand = crypto.randomBytes(4).toString("hex");

  if (channel === "email") {
    const messageId = `sim_brevo_${nowMs}_${rand}`;
    return {
      success: true,
      simulated: true,
      status: "simulated_sent",
      provider: "brevo_simulated",
      messageId,
      guardReason: metadata.guardReason || "STAGING_GUARD_INTERCEPTED",
      response: {
        messageId,
        simulated: true,
        interceptedAt: new Date(nowMs).toISOString()
      },
      error: null
    };
  }

  if (channel === "whatsapp") {
    const wamid = `sim_wamid_${nowMs}_${rand}`;
    return {
      success: true,
      simulated: true,
      status: "simulated_sent",
      channel: "whatsapp",
      provider: "meta_whatsapp_simulated",
      messageId: wamid,
      guardReason: metadata.guardReason || "STAGING_GUARD_INTERCEPTED",
      response: {
        messaging_product: "whatsapp",
        contacts: [{ input: String(recipient), wa_id: String(recipient) }],
        messages: [{ id: wamid }],
        simulated: true,
        interceptedAt: new Date(nowMs).toISOString()
      },
      error: null
    };
  }

  if (channel === "sms") {
    const msgid = `sim_msg91_${nowMs}_${rand}`;
    return {
      type: "success",
      success: true,
      simulated: true,
      status: "simulated_sent",
      provider: "msg91_simulated",
      msgid,
      guardReason: metadata.guardReason || "STAGING_GUARD_INTERCEPTED",
      response: {
        type: "success",
        msgid,
        simulated: true,
        interceptedAt: new Date(nowMs).toISOString()
      },
      error: null
    };
  }

  if (channel === "webhook") {
    const simEventId = eventId || `sim_evt_${nowMs}_${rand}`;
    return {
      success: true,
      simulated: true,
      status: "simulated_sent",
      channel: "webhook",
      provider: "n8n_simulated",
      durationMs: 0,
      guardReason: metadata.guardReason || "STAGING_GUARD_INTERCEPTED",
      response: {
        simulated: true,
        eventId: simEventId,
        interceptedAt: new Date(nowMs).toISOString()
      },
      error: null
    };
  }

  return {
    success: true,
    simulated: true,
    status: "simulated_sent",
    guardReason: metadata.guardReason || "STAGING_GUARD_INTERCEPTED",
    error: null
  };
}

/**
 * Masks recipient information in staging logs to prevent PII exposure.
 */
function maskRecipient(recipient, channel) {
  if (!recipient || typeof recipient !== "string") return "[ANONYMOUS]";

  if (channel === "email") {
    const parts = recipient.split("@");
    if (parts.length !== 2) return "[INVALID_EMAIL]";
    const user = parts[0];
    const domain = parts[1];
    const maskedUser = user.length <= 2 ? user[0] + "***" : user.slice(0, 2) + "***";
    return `${maskedUser}@${domain}`;
  }

  if (channel === "sms" || channel === "whatsapp") {
    const digits = recipient.replace(/\D/g, "");
    if (digits.length <= 4) return "****";
    return `+${digits.slice(0, 2)} **** ${digits.slice(-4)}`;
  }

  if (channel === "webhook") {
    try {
      const u = new URL(recipient);
      return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch (_) {
      return "[MASKED_URL]";
    }
  }

  return "[REDACTED]";
}

module.exports = {
  FORBIDDEN_PRODUCTION_PROJECT,
  APPROVED_STAGING_PROJECT,
  DEFAULT_ALLOWED_EMAIL_DOMAINS,
  resolveCurrentProjectId,
  isEmulatorEnvironment,
  isProductionEnvironment,
  isKillSwitchActive,
  normalizeEmail,
  normalizePhone,
  getChannelAllowlists,
  isEmailAllowlisted,
  isPhoneAllowlisted,
  isWebhookAllowlisted,
  evaluateOutboundTarget,
  createSimulatedResponse,
  maskRecipient
};
