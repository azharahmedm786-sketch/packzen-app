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
const { execSync } = require("child_process");

const APPROVED_STAGING_PROJECT = "packzen-staging-3";
const FORBIDDEN_PRODUCTION_PROJECT = "packzen-e7539";

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
  const productionRef = explicitTargets.find(t => t.resolved === FORBIDDEN_PRODUCTION_PROJECT);
  if (productionRef) {
    return {
      valid: false,
      error: `FORBIDDEN_PRODUCTION: Explicit target resolves to PRODUCTION (${FORBIDDEN_PRODUCTION_PROJECT}) via ${productionRef.source} ("${productionRef.raw}"). Staging deployment guard strictly rejects production deployments.`,
      projectId: FORBIDDEN_PRODUCTION_PROJECT,
      details: { explicitTargets, productionRef }
    };
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

  // Check 6: Validate that the single unanimous target matches approved staging project
  const candidateProjectId = resolvedProjectIds[0];
  if (!candidateProjectId || candidateProjectId !== APPROVED_STAGING_PROJECT) {
    return {
      valid: false,
      error: `UNAUTHORIZED_PROJECT: Target project "${candidateProjectId}" (supplied via ${explicitTargets[0].source} "${explicitTargets[0].raw}") does not match approved staging project "${APPROVED_STAGING_PROJECT}".`,
      projectId: candidateProjectId,
      details: { explicitTargets }
    };
  }

  return {
    valid: true,
    projectId: candidateProjectId,
    details: { explicitTargets, mode: "explicit-consensus" }
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
      console.error("=".repeat(78) + "\n");
      process.exit(1);
    }

    console.log(`✅ [GUARD PASS] Verified deployment target: ${result.projectId} (${result.details.mode})`);
    console.log("   Target is isolated staging environment. Safe to proceed.\n");
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
  loadFirebaserc,
  resolveProjectAlias,
  resolveDeploymentTarget,
  resolveAllDeploymentTargets,
  validateDeploymentTarget,
  runGuard
};

if (require.main === module) {
  runGuard();
}
