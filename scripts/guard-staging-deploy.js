#!/usr/bin/env node
/**
 * scripts/guard-staging-deploy.js
 * -------------------------------------------------------------
 * PackZen 3.0 Pre-Deployment Safety Guard (Hardened Phase 1.1)
 *
 * Enforces fail-closed validation of the target Firebase project
 * before any Hosting, Functions, Firestore, or Storage deployment can execute.
 *
 * Security Controls:
 *  1. Resolves all explicit deployment target sources (CLI flags, GCLOUD_PROJECT,
 *     FIREBASE_PROJECT, PROJECT_ID).
 *  2. Strictly detects and blocks conflicting target declarations (G-01 resolution).
 *  3. Strictly detects and blocks duplicate/injected project arguments.
 *  4. Strictly REJECTS production project 'packzen-e7539' and its aliases.
 *  5. Strictly REJECTS unknown, missing, malformed, or unauthorized project IDs.
 *  6. Blocks bare deployments when the passive active project is production.
 *  7. Validates that explicit staging operations resolve strictly to 'packzen-staging-3'.
 *  8. Fails closed on any parsing exception or unexpected runtime condition.
 * -------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");

const APPROVED_STAGING_PROJECT = "packzen-staging-3";
const FORBIDDEN_PRODUCTION_PROJECT = "packzen-e7539";

/**
 * Pinned Ed25519 Public Verification Key for Authorized Production Releases.
 * Any production authorization descriptor must be signed by the authentic release authority private key.
 * Public keys provided via environment variables (PACKZEN_RELEASE_AUTH_PUBKEY) are strictly rejected.
 */
const PINNED_PRODUCTION_RELEASE_PUBLIC_KEY = Object.freeze(
  "-----BEGIN PUBLIC KEY-----\n" +
  "MCowBQYDK2VwAyEAVQO7n6caiGYWUSMPVLCmd4RTxlyYjLx/sWcpfHKDj1E=\n" +
  "-----END PUBLIC KEY-----"
);

/**
 * Loads project aliases from .firebaserc relative to repo root.
 */
function loadFirebaserc(repoRoot = path.resolve(__dirname, "..")) {
  const rcPath = path.join(repoRoot, ".firebaserc");
  if (!fs.existsSync(rcPath)) {
    return { projects: {} };
  }
  try {
    const raw = fs.readFileSync(rcPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.projects) {
      throw new Error(".firebaserc is missing 'projects' configuration object.");
    }
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse .firebaserc: ${err.message}`);
  }
}

/**
 * Resolves alias (e.g. "staging" -> "packzen-staging-3", "production" -> "packzen-e7539")
 * using .firebaserc mapping. If target is already a raw project ID, returns it directly.
 */
function resolveProjectAlias(rawTarget, rcData = null) {
  if (!rawTarget || typeof rawTarget !== "string") return null;
  const target = rawTarget.trim();
  const rc = rcData || loadFirebaserc();
  const projects = rc.projects || {};

  if (projects[target]) {
    return projects[target];
  }
  return target;
}

/**
 * Collects and validates all declared project targets across CLI args,
 * environment variables, and active CLI configuration.
 */
function resolveAllDeploymentTargets(options = {}) {
  const { argv = process.argv, env = process.env, cwd = process.cwd(), rc = null } = options;
  const rcData = rc || loadFirebaserc(options.repoRoot);
  const explicitTargets = [];
  const cliArgsFound = [];

  // 1. Inspect CLI arguments (--project, -P, --project=, -P=)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" || arg === "-P") {
      if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        const raw = argv[i + 1].trim();
        cliArgsFound.push(raw);
        explicitTargets.push({
          source: "cli-flag",
          flag: arg,
          raw,
          resolved: resolveProjectAlias(raw, rcData)
        });
        i++; // skip next arg
      } else {
        explicitTargets.push({
          source: "cli-flag-empty",
          flag: arg,
          raw: "",
          resolved: null
        });
      }
    } else if (arg.startsWith("--project=")) {
      const raw = arg.slice("--project=".length).trim();
      cliArgsFound.push(raw);
      explicitTargets.push({
        source: "cli-flag",
        flag: "--project=",
        raw,
        resolved: resolveProjectAlias(raw, rcData)
      });
    } else if (arg.startsWith("-P=")) {
      const raw = arg.slice("-P=".length).trim();
      cliArgsFound.push(raw);
      explicitTargets.push({
        source: "cli-flag",
        flag: "-P=",
        raw,
        resolved: resolveProjectAlias(raw, rcData)
      });
    }
  }

  // 2. Inspect environment variables
  if (env.GCLOUD_PROJECT && String(env.GCLOUD_PROJECT).trim()) {
    const raw = String(env.GCLOUD_PROJECT).trim();
    explicitTargets.push({
      source: "env-GCLOUD_PROJECT",
      raw,
      resolved: resolveProjectAlias(raw, rcData)
    });
  }
  if (env.FIREBASE_PROJECT && String(env.FIREBASE_PROJECT).trim()) {
    const raw = String(env.FIREBASE_PROJECT).trim();
    explicitTargets.push({
      source: "env-FIREBASE_PROJECT",
      raw,
      resolved: resolveProjectAlias(raw, rcData)
    });
  }
  if (env.PROJECT_ID && String(env.PROJECT_ID).trim()) {
    const raw = String(env.PROJECT_ID).trim();
    explicitTargets.push({
      source: "env-PROJECT_ID",
      raw,
      resolved: resolveProjectAlias(raw, rcData)
    });
  }

  // 3. Fallback to active CLI state only if ZERO explicit targets were supplied
  let fallbackTarget = null;
  if (explicitTargets.length === 0) {
    try {
      const output = execSync("npx firebase use", { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "ignore"] });
      const match = output.match(/Active project:\s*([^\s(]+)/) || output.match(/\*\s*([^\s(]+)/);
      if (match && match[1]) {
        const raw = match[1].trim();
        fallbackTarget = {
          source: "firebase-use",
          raw,
          resolved: resolveProjectAlias(raw, rcData)
        };
      } else {
        const trimmed = output.trim();
        if (trimmed && !trimmed.includes("No project active")) {
          fallbackTarget = {
            source: "firebase-use",
            raw: trimmed,
            resolved: resolveProjectAlias(trimmed, rcData)
          };
        }
      }
    } catch (_) {
      // Ignore exec failure; fallback remains null
    }

    // Also check default alias in .firebaserc as secondary fallback
    if (!fallbackTarget && rcData.projects && rcData.projects.default) {
      const raw = String(rcData.projects.default).trim();
      fallbackTarget = {
        source: "firebaserc-default",
        raw,
        resolved: resolveProjectAlias(raw, rcData)
      };
    }
  }

  return {
    explicitTargets,
    cliArgsFound,
    fallbackTarget
  };
}

/**
 * Backward-compatible single-target resolver for Phase 1 tests.
 */
function resolveDeploymentTarget(options = {}) {
  const all = resolveAllDeploymentTargets(options);
  if (all.explicitTargets && all.explicitTargets.length > 0) {
    return all.explicitTargets[0];
  }
  return all.fallbackTarget;
}

/**
 * Validates production release authorization handshake using asymmetric Ed25519 signatures.
 * Rejects if token/public key is missing, session is expired (> 60 seconds),
 * commit SHA is missing or differs from HEAD, cryptographic signature is invalid,
 * descriptor contains forbidden private key material, or token is replayed for the same service.
 */
function verifyProductionReleaseAuth(options = {}) {
  const env = options.env || process.env;
  const authToken = options.authToken || env.PACKZEN_RELEASE_AUTH_TOKEN;
  const argv = options.argv || process.argv;

  // Check 0: Reject any attempt to supply or override the public verification key via environment variables (Check 2)
  if (env.PACKZEN_RELEASE_AUTH_PUBKEY) {
    return {
      authorized: false,
      reason: "ENV_PUBKEY_OVERRIDE_PROHIBITED",
      error: "FORBIDDEN_PRODUCTION: Public key override via PACKZEN_RELEASE_AUTH_PUBKEY environment variable is strictly prohibited. Pinned release key must be used."
    };
  }

  // Trusted public key must come strictly from pinned constant (or options.trustedPublicKeyPem for programmatic tests)
  const trustedPublicKeyPem = options.trustedPublicKeyPem !== undefined
    ? options.trustedPublicKeyPem
    : (options.publicKeyPem !== undefined ? options.publicKeyPem : PINNED_PRODUCTION_RELEASE_PUBLIC_KEY);

  if (!authToken || typeof authToken !== "string" || !authToken.trim()) {
    return {
      authorized: false,
      reason: "MISSING_AUTH_TOKEN",
      error: `FORBIDDEN_PRODUCTION: Explicit target resolves to PRODUCTION (${FORBIDDEN_PRODUCTION_PROJECT}). Direct or unconfirmed deployment to PRODUCTION is blocked. Production releases must be executed via 'node scripts/pz-release.js --confirm-production-release=${FORBIDDEN_PRODUCTION_PROJECT}'.`
    };
  }

  if (!trustedPublicKeyPem || typeof trustedPublicKeyPem !== "string" || !trustedPublicKeyPem.trim()) {
    return {
      authorized: false,
      reason: "MISSING_PUBLIC_KEY",
      error: `FORBIDDEN_PRODUCTION: Missing release authorization public key. Production releases must be orchestrated via 'node scripts/pz-release.js'.`
    };
  }

  const cleanToken = authToken.trim();
  let pubKey;
  try {
    pubKey = crypto.createPublicKey(trustedPublicKeyPem.trim());
  } catch (err) {
    return {
      authorized: false,
      reason: "INVALID_PUBLIC_KEY",
      error: `FORBIDDEN_PRODUCTION: Invalid release authorization public key: ${err.message}`
    };
  }

  // Parse service name if provided via options or CLI arguments (--service <name>)
  let serviceName = options.service;
  if (!serviceName && Array.isArray(argv)) {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--service" && argv[i + 1]) {
        serviceName = argv[i + 1].trim();
        break;
      } else if (typeof argv[i] === "string" && argv[i].startsWith("--service=")) {
        serviceName = argv[i].slice("--service=".length).trim();
        break;
      }
    }
  }

  // Allow test injection of descriptor or read from secure temp file
  let descriptor = options.authDescriptor;
  let sessionFilePath = null;
  if (!descriptor) {
    const tokenHash = crypto.createHash("sha256").update(cleanToken).digest("hex");
    sessionFilePath = path.join(os.tmpdir(), `pz_auth_${tokenHash}.json`);
    if (!fs.existsSync(sessionFilePath)) {
      return {
        authorized: false,
        reason: "INVALID_SESSION_FILE",
        error: `FORBIDDEN_PRODUCTION: Release authorization session not found or expired. Execute deployment via 'node scripts/pz-release.js --confirm-production-release=${FORBIDDEN_PRODUCTION_PROJECT}'.`
      };
    }
    try {
      descriptor = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));
    } catch (err) {
      return {
        authorized: false,
        reason: "MALFORMED_SESSION_FILE",
        error: `FORBIDDEN_PRODUCTION: Malformed release authorization session: ${err.message}`
      };
    }
  }

  // 1. Prohibit private/secret key material in descriptor (SEC-01)
  if (!descriptor || typeof descriptor !== "object") {
    return {
      authorized: false,
      reason: "INVALID_DESCRIPTOR",
      error: "FORBIDDEN_PRODUCTION: Invalid authorization descriptor structure."
    };
  }
  if (descriptor.hmacKey || descriptor.privateKey || descriptor.secretKey) {
    return {
      authorized: false,
      reason: "FORBIDDEN_KEY_IN_DESCRIPTOR",
      error: "FORBIDDEN_PRODUCTION: Authorization descriptor contains forbidden private/secret key material."
    };
  }

  // 2. Target check
  if (descriptor.target !== FORBIDDEN_PRODUCTION_PROJECT) {
    return {
      authorized: false,
      reason: "TARGET_MISMATCH",
      error: `FORBIDDEN_PRODUCTION: Authorization session target '${descriptor.target || "null"}' does not match production project '${FORBIDDEN_PRODUCTION_PROJECT}'.`
    };
  }

  // 3. Confirmation flag check
  if (descriptor.confirmation !== `--confirm-production-release=${FORBIDDEN_PRODUCTION_PROJECT}`) {
    return {
      authorized: false,
      reason: "CONFIRMATION_MISMATCH",
      error: `FORBIDDEN_PRODUCTION: Invalid confirmation flag in authorization session.`
    };
  }

  // 4. Nonce binding check (SEC-07)
  if (!descriptor.nonce || descriptor.nonce !== cleanToken) {
    return {
      authorized: false,
      reason: "NONCE_MISMATCH",
      error: `FORBIDDEN_PRODUCTION: Authorization token nonce does not match session descriptor.`
    };
  }

  // 5. Expiration check (60 seconds maximum lifetime, SEC-09)
  const now = (options.now && options.now()) || Date.now();
  if (typeof descriptor.timestamp !== "number" || now - descriptor.timestamp > 60000 || now < descriptor.timestamp - 5000) {
    return {
      authorized: false,
      reason: "EXPIRED_SESSION",
      error: `FORBIDDEN_PRODUCTION: Release authorization session has expired (max 60s lifetime). Re-run 'scripts/pz-release.js'.`
    };
  }

  // 6. Mandatory Commit SHA check (SEC-05)
  if (!descriptor.commitSha || typeof descriptor.commitSha !== "string" || !/^[0-9a-f]{40}$/i.test(descriptor.commitSha.trim())) {
    return {
      authorized: false,
      reason: "INVALID_COMMIT_SHA",
      error: "FORBIDDEN_PRODUCTION: Release authorization descriptor must contain a valid 40-character hexadecimal commit SHA."
    };
  }

  let currentHead = options.currentHead !== undefined ? options.currentHead : null;
  if (currentHead === null && options.currentHead === undefined) {
    try {
      currentHead = execSync("git rev-parse HEAD", {
        encoding: "utf8",
        cwd: options.repoRoot || path.resolve(__dirname, ".."),
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch (_) {
      currentHead = null;
    }
  }

  if (!currentHead || typeof currentHead !== "string" || !/^[0-9a-f]{40}$/i.test(currentHead.trim())) {
    return {
      authorized: false,
      reason: "MISSING_CURRENT_HEAD",
      error: "FORBIDDEN_PRODUCTION: Unable to resolve valid 40-character Git HEAD SHA. Production release requires verified Git repository context."
    };
  }

  if (currentHead.trim().toLowerCase() !== descriptor.commitSha.trim().toLowerCase()) {
    return {
      authorized: false,
      reason: "COMMIT_MISMATCH",
      error: `FORBIDDEN_PRODUCTION: Release authorization commit '${descriptor.commitSha}' does not match current HEAD '${currentHead}'.`
    };
  }

  // 7. Cryptographic Asymmetric Signature check (SEC-01)
  if (!descriptor.signature || typeof descriptor.signature !== "string" || !descriptor.signature.trim()) {
    return {
      authorized: false,
      reason: "MISSING_SIGNATURE",
      error: `FORBIDDEN_PRODUCTION: Release authorization session is missing cryptographic signature.`
    };
  }

  const canonicalMessage = `${descriptor.commitSha}:${descriptor.timestamp}:${descriptor.nonce}:${descriptor.target}`;
  let validSignature = false;
  try {
    const sigBuf = Buffer.from(descriptor.signature, "hex");
    validSignature = crypto.verify(null, Buffer.from(canonicalMessage, "utf8"), pubKey, sigBuf);
  } catch (_) {
    validSignature = false;
  }

  if (!validSignature) {
    return {
      authorized: false,
      reason: "INVALID_SIGNATURE",
      error: `FORBIDDEN_PRODUCTION: Asymmetric cryptographic signature verification failed on release authorization session.`
    };
  }

  // 8. Anti-Replay service tracking (SEC-09)
  if (serviceName) {
    descriptor.consumedServices = descriptor.consumedServices || [];
    if (descriptor.consumedServices.includes(serviceName)) {
      return {
        authorized: false,
        reason: "REPLAY_DETECTED",
        error: `FORBIDDEN_PRODUCTION: Service '${serviceName}' has already consumed this release authorization token. Replay attacks are prohibited.`
      };
    }
    descriptor.consumedServices.push(serviceName);
    if (sessionFilePath && fs.existsSync(sessionFilePath)) {
      try {
        fs.writeFileSync(sessionFilePath, JSON.stringify(descriptor));
      } catch (_) {}
    }
  }

  return {
    authorized: true,
    details: {
      target: descriptor.target,
      commitSha: descriptor.commitSha,
      timestamp: descriptor.timestamp,
      service: serviceName || "unspecified"
    }
  };
}

/**
 * Validates the resolved target project ID with strict conflict detection.
 * Returns { valid: boolean, error?: string, projectId?: string, details?: object }.
 */
function validateDeploymentTarget(options = {}) {
  let rc;
  try {
    rc = options.rc || loadFirebaserc(options.repoRoot);
  } catch (err) {
    return {
      valid: false,
      error: `MALFORMED_CONFIG: ${err.message}`,
      details: { stage: "loadFirebaserc" }
    };
  }

  const { explicitTargets, cliArgsFound, fallbackTarget } = resolveAllDeploymentTargets(Object.assign({}, options, { rc }));

  // Check 1: Argument Injection / Duplicate Project Flags
  if (cliArgsFound.length > 1) {
    const uniqueArgs = [...new Set(cliArgsFound)];
    if (uniqueArgs.length > 1) {
      return {
        valid: false,
        error: `ARGUMENT_INJECTION_CONFLICT: Multiple conflicting --project arguments supplied: [${cliArgsFound.join(", ")}].`,
        details: { cliArgsFound }
      };
    }
  }

  // Check 2: Check for empty flags (e.g. `--project` with no value)
  const emptyFlag = explicitTargets.find(t => t.source === "cli-flag-empty");
  if (emptyFlag) {
    return {
      valid: false,
      error: `INVALID_ARGUMENT: ${emptyFlag.flag} flag supplied without a project ID.`,
      details: { emptyFlag }
    };
  }

  // Check 3: If NO explicit targets supplied, evaluate fallback active project
  if (explicitTargets.length === 0) {
    if (!fallbackTarget || !fallbackTarget.raw) {
      return {
        valid: false,
        error: "MISSING_PROJECT: No Firebase deployment target supplied. Pass --project staging or set GCLOUD_PROJECT.",
        details: { explicitTargets, fallbackTarget }
      };
    }

    // Passive active project is production -> STRICT BLOCK
    if (fallbackTarget.resolved === FORBIDDEN_PRODUCTION_PROJECT) {
      return {
        valid: false,
        error: `FORBIDDEN_PRODUCTION: Deployment target resolves to PRODUCTION (${FORBIDDEN_PRODUCTION_PROJECT}) via passive ${fallbackTarget.source} ("${fallbackTarget.raw}"). Explicit staging target required.`,
        projectId: FORBIDDEN_PRODUCTION_PROJECT,
        details: { fallbackTarget }
      };
    }

    // Passive active project is anything other than approved staging -> BLOCK
    if (fallbackTarget.resolved !== APPROVED_STAGING_PROJECT) {
      return {
        valid: false,
        error: `UNAUTHORIZED_PROJECT: Deployment target "${fallbackTarget.resolved}" (via ${fallbackTarget.source}) does not match approved staging project "${APPROVED_STAGING_PROJECT}".`,
        projectId: fallbackTarget.resolved,
        details: { fallbackTarget }
      };
    }

    return {
      valid: true,
      projectId: fallbackTarget.resolved,
      details: { target: fallbackTarget, mode: "fallback" }
    };
  }

  // Check 4: Check if ANY explicit target resolves to production
  let productionAuth = null;
  const productionRef = explicitTargets.find(t => t.resolved === FORBIDDEN_PRODUCTION_PROJECT);
  if (productionRef) {
    productionAuth = verifyProductionReleaseAuth(options);
    if (!productionAuth.authorized) {
      return {
        valid: false,
        error: productionAuth.error,
        projectId: FORBIDDEN_PRODUCTION_PROJECT,
        details: { explicitTargets, productionRef, auth: productionAuth }
      };
    }
  }

  // Check 5: Conflict Detection among ALL supplied explicit sources
  const resolvedProjectIds = [...new Set(explicitTargets.map(t => t.resolved))];
  if (resolvedProjectIds.length > 1) {
    const conflictSummary = explicitTargets.map(t => `${t.source}="${t.raw}"->"${t.resolved}"`).join(", ");
    return {
      valid: false,
      error: `AMBIGUOUS_PROJECT_CONFLICT: Conflicting explicit deployment targets detected: [${conflictSummary}]. All supplied targets must agree.`,
      details: { explicitTargets, resolvedProjectIds }
    };
  }

  // Check 6: Validate that the single unanimous target matches approved staging project OR authorized production
  const candidateProjectId = resolvedProjectIds[0];
  if (candidateProjectId === APPROVED_STAGING_PROJECT) {
    return {
      valid: true,
      projectId: candidateProjectId,
      details: { explicitTargets, mode: "explicit-consensus" }
    };
  }

  if (candidateProjectId === FORBIDDEN_PRODUCTION_PROJECT) {
    const auth = productionAuth || verifyProductionReleaseAuth(options);
    if (auth.authorized) {
      return {
        valid: true,
        projectId: candidateProjectId,
        details: { explicitTargets, mode: "authorized-production-release", authDetails: auth.details }
      };
    }
    return {
      valid: false,
      error: auth.error,
      projectId: candidateProjectId,
      details: { explicitTargets, auth }
    };
  }

  return {
    valid: false,
    error: `UNAUTHORIZED_PROJECT: Target project "${candidateProjectId}" (supplied via ${explicitTargets[0].source} "${explicitTargets[0].raw}") does not match approved staging project "${APPROVED_STAGING_PROJECT}" or authorized production project "${FORBIDDEN_PRODUCTION_PROJECT}".`,
    projectId: candidateProjectId,
    details: { explicitTargets }
  };
}

/**
 * Main CLI execution routine invoked by predeploy hooks.
 */
function runGuard() {
  console.log("🛡️  [PACKZEN DEPLOY GUARD] Inspecting deployment target consensus...");
  try {
    const result = validateDeploymentTarget();
    if (!result.valid) {
      console.error("\n" + "=".repeat(78));
      console.error("⛔ [DEPLOYMENT BLOCKED BY SAFETY GUARD]");
      console.error(`   Error:   ${result.error}`);
      console.error("\n   SAFE FIX INSTRUCTIONS:");
      console.error(`   - Specify staging explicitly:  firebase deploy --project staging`);
      console.error(`   - Or with full project ID:      firebase deploy --project ${APPROVED_STAGING_PROJECT}`);
      console.error(`   - For production release:       node scripts/pz-release.js --confirm-production-release=${FORBIDDEN_PRODUCTION_PROJECT}`);
      console.error("=".repeat(78) + "\n");
      process.exit(1);
    }

    if (result.details && result.details.mode === "authorized-production-release") {
      console.log(`🚀 [GUARD PASS] Verified deployment target: ${result.projectId} (AUTHORIZED PRODUCTION RELEASE)`);
      console.log(`   Commit: ${result.details.authDetails ? result.details.authDetails.commitSha : "verified"}`);
      console.log("   Production release authorization verified. Safe to proceed.\n");
    } else {
      console.log(`✅ [GUARD PASS] Verified deployment target: ${result.projectId} (${result.details ? result.details.mode : "staging"})`);
      console.log("   Target is isolated staging environment. Safe to proceed.\n");
    }
    process.exit(0);
  } catch (err) {
    console.error("\n⛔ [GUARD INTERNAL ERROR - FAILING CLOSED]:", err.message);
    process.exit(1);
  }
}

// Module exports for programmatic testing
module.exports = {
  APPROVED_STAGING_PROJECT,
  FORBIDDEN_PRODUCTION_PROJECT,
  PINNED_PRODUCTION_RELEASE_PUBLIC_KEY,
  loadFirebaserc,
  resolveProjectAlias,
  resolveDeploymentTarget,
  resolveAllDeploymentTargets,
  validateDeploymentTarget,
  verifyProductionReleaseAuth,
  runGuard
};

if (require.main === module) {
  runGuard();
}
