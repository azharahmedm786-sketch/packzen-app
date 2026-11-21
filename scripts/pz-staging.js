#!/usr/bin/env node
/**
 * scripts/pz-staging.js
 * -------------------------------------------------------------
 * PackZen 3.0 Restricted Staging CLI Wrapper (Phase 1.1)
 *
 * Enforces a strict, restricted command boundary around Firebase CLI.
 * This is NOT a general-purpose proxy — only explicitly approved staging
 * operations are permitted.
 *
 * Core Security Invariants:
 *  1. Target Isolation: Forces exactly ONE argument: '--project packzen-staging-3'.
 *  2. Argument Injection Defense: Rejects duplicate/conflicting project arguments.
 *  3. Safe Process Execution: Uses child_process.spawnSync with explicit arg arrays (no shell).
 *  4. Preview Channel Hardening: Restricts channel names, blocks reserved/live names,
 *     caps expiration to 7 days, blocks live promotions.
 *  5. Secret Safety: Strictly restricts secret commands to the 16 approved staging secrets.
 *     Rejects inline secret values on CLI. Requires exact confirmation token for destruction.
 *     Zero logging of secret payloads.
 *  6. Destructive Command Defense: Blocks firestore:delete, auth:delete, database deletion,
 *     and arbitrary unapproved Firebase commands.
 * -------------------------------------------------------------
 */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const {
  APPROVED_STAGING_PROJECT,
  FORBIDDEN_PRODUCTION_PROJECT,
  loadFirebaserc,
  resolveProjectAlias,
  validateDeploymentTarget
} = require("./guard-staging-deploy");

// Approved 16 staging secrets (strictly derived from AST / runtime audits)
const APPROVED_STAGING_SECRETS = Object.freeze([
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "COMPLETION_OTP_PEPPER",
  "GOOGLE_MAPS_KEY",
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "N8N_WEBHOOK_URL",
  "N8N_WEBHOOK_SECRET",
  "MSG91_AUTHKEY"
]);

// Reserved channel names that can never be used for preview channels
const RESERVED_PREVIEW_CHANNELS = Object.freeze([
  "live",
  "production",
  "prod",
  "master",
  "main",
  "release",
  "staging",
  "default"
]);

/**
 * Validates a preview channel name syntax and checks against reserved names.
 */
function validateChannelName(name) {
  if (!name || typeof name !== "string") {
    return { valid: false, error: "Channel name must be a non-empty string." };
  }
  const clean = name.trim().toLowerCase();
  if (RESERVED_PREVIEW_CHANNELS.includes(clean)) {
    return { valid: false, error: `Channel name "${clean}" is reserved and cannot be deployed as a preview.` };
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(clean)) {
    return {
      valid: false,
      error: `Channel name "${clean}" is invalid. Must be 3-64 lowercase alphanumeric chars/hyphens, starting and ending with alphanumeric.`
    };
  }
  return { valid: true, channelName: clean };
}

/**
 * Parses duration string (e.g. "7d", "24h", "60m") into hours.
 */
function parseDurationHours(str) {
  if (!str) return 0;
  const match = String(str).trim().match(/^(\d+)([dhm])$/i);
  if (!match) return NaN;
  const count = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "d") return count * 24;
  if (unit === "h") return count;
  if (unit === "m") return count / 60;
  return NaN;
}

/**
 * Inspects user arguments for dangerous project overrides or duplicate project arguments.
 */
function assertNoProjectOverride(rawArgs) {
  const flags = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === "--project" || a === "-P") {
      flags.push({ arg: a, val: rawArgs[i + 1] || "" });
    } else if (a.startsWith("--project=")) {
      flags.push({ arg: "--project=", val: a.slice("--project=".length) });
    } else if (a.startsWith("-P=")) {
      flags.push({ arg: "-P=", val: a.slice("-P=".length) });
    }
  }

  if (flags.length > 0) {
    for (const f of flags) {
      const resolved = resolveProjectAlias(f.val);
      if (resolved === FORBIDDEN_PRODUCTION_PROJECT) {
        throw new Error(`ARGUMENT_INJECTION_BLOCKED: Production project "${f.val}" supplied via ${f.arg}.`);
      }
      if (resolved && resolved !== APPROVED_STAGING_PROJECT) {
        throw new Error(`ARGUMENT_INJECTION_BLOCKED: Project override "${f.val}" does not match approved staging project "${APPROVED_STAGING_PROJECT}".`);
      }
    }
  }
}

/**
 * Strips any user-provided project arguments so the wrapper can cleanly inject exactly one.
 */
function sanitizeUserArgs(rawArgs) {
  const sanitized = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === "--project" || a === "-P") {
      i++; // skip next value
      continue;
    }
    if (a.startsWith("--project=") || a.startsWith("-P=")) {
      continue;
    }
    sanitized.push(a);
  }
  return sanitized;
}

/**
 * Validates and normalizes the requested command into safe, executable child arguments.
 */
function planStagingCommand(rawArgs, options = {}) {
  if (!Array.isArray(rawArgs) || rawArgs.length === 0) {
    return {
      allowed: false,
      error: "USAGE_ERROR: No command supplied. Usage: node scripts/pz-staging.js <command> [options]"
    };
  }

  // Pre-check for argument injection
  try {
    assertNoProjectOverride(rawArgs);
  } catch (err) {
    return { allowed: false, error: err.message };
  }

  const cleanArgs = sanitizeUserArgs(rawArgs);
  const primaryCommand = cleanArgs[0];

  // -------------------------------------------------------------
  // CATEGORY 1: Deployments (deploy ...)
  // -------------------------------------------------------------
  if (primaryCommand === "deploy") {
    const subArgs = cleanArgs.slice(1);
    const allowedOnlyTargets = [
      "hosting",
      "functions",
      "firestore",
      "firestore:rules",
      "firestore:indexes",
      "storage"
    ];

    // Check if --only is passed
    const onlyIdx = subArgs.indexOf("--only");
    if (onlyIdx !== -1) {
      const targets = (subArgs[onlyIdx + 1] || "").split(",").map(t => t.trim());
      for (const t of targets) {
        if (!allowedOnlyTargets.includes(t)) {
          return {
            allowed: false,
            error: `DISALLOWED_DEPLOY_TARGET: Resource target "${t}" is not allowed in staging deploys.`
          };
        }
      }
    }

    return {
      allowed: true,
      category: "deploy",
      sanitizedArgs: ["deploy", ...subArgs, "--project", APPROVED_STAGING_PROJECT]
    };
  }

  // -------------------------------------------------------------
  // CATEGORY 2: Hosting Preview Channels (hosting:channel:deploy ...)
  // -------------------------------------------------------------
  if (primaryCommand === "hosting:channel:deploy") {
    const channelNameRaw = cleanArgs[1];
    if (!channelNameRaw || channelNameRaw.startsWith("-")) {
      return {
        allowed: false,
        error: "PREVIEW_CHANNEL_ERROR: A preview channel name is required. Example: hosting:channel:deploy pr-42"
      };
    }

    const channelValidation = validateChannelName(channelNameRaw);
    if (!channelValidation.valid) {
      return { allowed: false, error: `PREVIEW_CHANNEL_ERROR: ${channelValidation.error}` };
    }

    // Inspect user-provided options
    const restArgs = cleanArgs.slice(2);
    let expiresHours = 24 * 7; // default 7 days max
    const otherArgs = [];

    for (let i = 0; i < restArgs.length; i++) {
      const a = restArgs[i];
      if (a === "--expires") {
        if (restArgs[i + 1] && !restArgs[i + 1].startsWith("-")) {
          const h = parseDurationHours(restArgs[i + 1]);
          if (isNaN(h) || h <= 0) {
            return { allowed: false, error: "PREVIEW_EXPIRY_ERROR: Invalid --expires duration format." };
          }
          if (h > 24 * 7) {
            return { allowed: false, error: "PREVIEW_EXPIRY_EXCEEDED: Preview channel expiry cannot exceed 7 days (7d)." };
          }
          expiresHours = h;
          i++; // skip duration token
        } else {
          return { allowed: false, error: "PREVIEW_EXPIRY_ERROR: --expires flag requires duration value." };
        }
      } else if (a.startsWith("--expires=")) {
        const h = parseDurationHours(a.slice("--expires=".length));
        if (isNaN(h) || h <= 0) {
          return { allowed: false, error: "PREVIEW_EXPIRY_ERROR: Invalid --expires duration format." };
        }
        if (h > 24 * 7) {
          return { allowed: false, error: "PREVIEW_EXPIRY_EXCEEDED: Preview channel expiry cannot exceed 7 days (7d)." };
        }
        expiresHours = h;
      } else {
        otherArgs.push(a);
      }
    }

    return {
      allowed: true,
      category: "hosting:channel",
      sanitizedArgs: [
        "hosting:channel:deploy",
        channelValidation.channelName,
        "--expires", `${expiresHours}h`,
        ...otherArgs,
        "--project", APPROVED_STAGING_PROJECT
      ]
    };
  }

  // -------------------------------------------------------------
  // CATEGORY 3: Secret Operations (functions:secrets:...)
  // -------------------------------------------------------------
  if (primaryCommand.startsWith("functions:secrets:")) {
    const secretAction = primaryCommand.slice("functions:secrets:".length);

    // 3.1 Secret Set (functions:secrets:set <KEY>)
    if (secretAction === "set") {
      const secretNameRaw = cleanArgs[1];
      if (!secretNameRaw) {
        return { allowed: false, error: "SECRET_ERROR: Secret name required. Example: functions:secrets:set RAZORPAY_KEY_ID" };
      }

      // Insecure CLI value detection (e.g. FOO=bar or FOO "my-val")
      if (secretNameRaw.includes("=") || cleanArgs[2]) {
        return {
          allowed: false,
          error: "INSECURE_SECRET_ARGUMENT: Secret values must never be passed as CLI arguments. Supply value via secure prompt or stdin."
        };
      }

      const secretName = secretNameRaw.trim();
      if (!APPROVED_STAGING_SECRETS.includes(secretName)) {
        return {
          allowed: false,
          error: `UNAPPROVED_SECRET_NAME: Secret "${secretName}" is not in approved staging allowlist (${APPROVED_STAGING_SECRETS.length} permitted).`
        };
      }

      return {
        allowed: true,
        category: "secrets:set",
        secretName,
        sanitizedArgs: ["functions:secrets:set", secretName, "--project", APPROVED_STAGING_PROJECT]
      };
    }

    // 3.2 Secret Destroy (functions:secrets:destroy <KEY> --confirm-destroy=<TOKEN>)
    if (secretAction === "destroy") {
      const secretNameRaw = cleanArgs[1];
      if (!secretNameRaw) {
        return { allowed: false, error: "SECRET_ERROR: Secret name required for destruction." };
      }
      const secretName = secretNameRaw.trim();
      if (!APPROVED_STAGING_SECRETS.includes(secretName)) {
        return {
          allowed: false,
          error: `UNAPPROVED_SECRET_NAME: Secret "${secretName}" is not in approved staging allowlist.`
        };
      }

      // Require explicit secret-specific confirmation token
      const expectedToken = `--confirm-destroy=${secretName}@${APPROVED_STAGING_PROJECT}`;
      const hasToken = cleanArgs.includes(expectedToken);
      if (!hasToken) {
        return {
          allowed: false,
          error: `SECRET_DESTRUCTION_BLOCKED: Secret destruction requires exact confirmation flag: "${expectedToken}".`
        };
      }

      return {
        allowed: true,
        category: "secrets:destroy",
        secretName,
        sanitizedArgs: ["functions:secrets:destroy", secretName, "--force", "--project", APPROVED_STAGING_PROJECT]
      };
    }

    // 3.3 Secret Get / Prune
    if (secretAction === "get") {
      const secretName = (cleanArgs[1] || "").trim();
      if (!APPROVED_STAGING_SECRETS.includes(secretName)) {
        return { allowed: false, error: `UNAPPROVED_SECRET_NAME: Secret "${secretName}" is not in staging allowlist.` };
      }
      return {
        allowed: true,
        category: "secrets:get",
        secretName,
        sanitizedArgs: ["functions:secrets:get", secretName, "--project", APPROVED_STAGING_PROJECT]
      };
    }

    if (secretAction === "prune") {
      return {
        allowed: true,
        category: "secrets:prune",
        sanitizedArgs: ["functions:secrets:prune", "--project", APPROVED_STAGING_PROJECT]
      };
    }

    return { allowed: false, error: `UNSUPPORTED_SECRET_ACTION: Action "${secretAction}" not permitted in staging.` };
  }

  // -------------------------------------------------------------
  // CATEGORY 4: Explicitly Disallowed Destructive Commands
  // -------------------------------------------------------------
  const prohibitedPatterns = [
    "firestore:delete",
    "auth:delete",
    "auth:import",
    "auth:export",
    "database:",
    "projects:",
    "apps:",
    "use"
  ];

  for (const p of prohibitedPatterns) {
    if (primaryCommand.startsWith(p)) {
      return {
        allowed: false,
        error: `PROHIBITED_COMMAND: Command "${primaryCommand}" is destructive or administrative and strictly forbidden through the staging wrapper.`
      };
    }
  }

  return {
    allowed: false,
    error: `UNSUPPORTED_COMMAND: Command "${primaryCommand}" is not in the approved staging wrapper allowlist.`
  };
}

/**
 * Main execution dispatcher.
 */
function executeWrapper(rawArgs = process.argv.slice(2), options = {}) {
  const plan = planStagingCommand(rawArgs, options);

  if (!plan.allowed) {
    console.error("\n" + "=".repeat(78));
    console.error("⛔ [STAGING WRAPPER BLOCKED COMMAND]");
    console.error(`   Error: ${plan.error}`);
    console.error("=".repeat(78) + "\n");
    return { status: 1, error: plan.error, executed: false };
  }

  // Pre-flight deployment guard check before spawning child process
  const guardCheck = validateDeploymentTarget({
    argv: plan.sanitizedArgs,
    env: options.env || process.env,
    repoRoot: options.repoRoot || path.resolve(__dirname, "..")
  });

  if (!guardCheck.valid) {
    console.error("\n" + "=".repeat(78));
    console.error("⛔ [PRE-FLIGHT GUARD FAILED IN WRAPPER]");
    console.error(`   Error: ${guardCheck.error}`);
    console.error("=".repeat(78) + "\n");
    return { status: 1, error: guardCheck.error, executed: false };
  }

  console.log("🛡️  [PACKZEN STAGING WRAPPER]");
  console.log(`   Category: ${plan.category}`);
  console.log(`   Target:   ${APPROVED_STAGING_PROJECT} (Forced & Validated)`);
  if (plan.secretName) {
    console.log(`   Secret:   ${plan.secretName} (Value: [REDACTED/MASKED])`);
  }
  console.log("   Status:   Authorized. Executing Firebase CLI child process...\n");

  // In test mode, allow an injected executor
  if (options.executor) {
    return options.executor(plan.sanitizedArgs);
  }

  // Execute child process using safe argument array (shell: false)
  const child = spawnSync("npx", ["firebase", ...plan.sanitizedArgs], {
    stdio: "inherit",
    shell: false,
    env: Object.assign({}, process.env, {
      GCLOUD_PROJECT: APPROVED_STAGING_PROJECT,
      FIREBASE_PROJECT: APPROVED_STAGING_PROJECT
    })
  });

  return { status: child.status, executed: true, args: plan.sanitizedArgs };
}

// Module exports
module.exports = {
  APPROVED_STAGING_SECRETS,
  RESERVED_PREVIEW_CHANNELS,
  validateChannelName,
  parseDurationHours,
  assertNoProjectOverride,
  sanitizeUserArgs,
  planStagingCommand,
  executeWrapper
};

if (require.main === module) {
  const res = executeWrapper(process.argv.slice(2));
  process.exit(res.status || 0);
}
