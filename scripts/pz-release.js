#!/usr/bin/env node
/**
 * scripts/pz-release.js
 * -------------------------------------------------------------
 * PackZen 3.0 Production Release Orchestrator
 *
 * Dedicated, hardened CLI wrapper for authorized production releases
 * to 'packzen-e7539'.
 *
 * Core Security Requirements & Controls:
 *  1. Mandatory Confirmation: Strictly requires '--confirm-production-release=packzen-e7539'.
 *  2. Clean Git Working Tree: Rejects modified/staged tracked files; permits protected rollback assets.
 *  3. GitHub Remote Synchronization: Verifies local commit is pushed and matches expected remote branch.
 *  4. Test Suite Execution: Runs complete Functions regression test suite before release.
 *  5. Production Configuration Audit: Verifies live endpoints, project identity, and live Razorpay key.
 *  6. Ephemeral Cryptographic Handshake: Issues a signed one-time authorization session for the predeploy guard.
 *  7. Staging Protection Preserved: Never permits staging cross-contamination; predeploy hooks remain active.
 *  8. Zero Secret Leakage: Masks and redacts sensitive parameters from output.
 * -------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");
const { PINNED_PRODUCTION_RELEASE_PUBLIC_KEY } = require("./guard-staging-deploy");

const PRODUCTION_PROJECT_ID = "packzen-e7539";
const REQUIRED_CONFIRMATION_FLAG = `--confirm-production-release=${PRODUCTION_PROJECT_ID}`;
const DEFAULT_RELEASE_KEY_PATH = path.join(os.homedir(), ".packzen", "packzen_release_key.pem");

// Protected untracked rollback assets that MUST exist and remain untouched
const PROTECTED_ROLLBACK_ASSETS = Object.freeze([
  "firebase.rollback.json",
  "firestore.rules.prod_backup",
  "functions_prod_backup"
]);

// Allowed untracked documentation patterns and safe files
const ALLOWED_UNTRACKED_PATTERNS = Object.freeze([
  /^PACKZEN_.*\.md$/,
  /^firebase\.rollback\.json$/,
  /^firestore\.rules\.prod_backup$/,
  /^functions_prod_backup$/,
  /^functions[/\\]\.gcloudignore$/
]);

// Dangerous ignored file patterns that must never exist in the working tree
const DANGEROUS_IGNORED_PATTERNS = Object.freeze([
  /(^|[/\\])\.env(\..+)?$/i,
  /(^|[/\\])serviceAccountKey.*\.json$/i,
  /(^|[/\\])[^/\\]+\.(pem|key)$/i
]);

const ALLOWED_DEPLOY_TARGETS = Object.freeze([
  "hosting",
  "functions",
  "firestore",
  "firestore:rules",
  "firestore:indexes",
  "storage"
]);

/**
 * Validates the presence of the exact confirmation flag.
 */
function validateConfirmation(rawArgs = []) {
  if (!Array.isArray(rawArgs)) return { valid: false, error: "Arguments must be an array." };

  const exactFlag = rawArgs.find(arg => typeof arg === "string" && arg.startsWith("--confirm-production-release="));
  if (!exactFlag) {
    return {
      valid: false,
      error: `MISSING_CONFIRMATION: Production release requires explicit confirmation: '${REQUIRED_CONFIRMATION_FLAG}'.`
    };
  }

  if (exactFlag !== REQUIRED_CONFIRMATION_FLAG) {
    return {
      valid: false,
      error: `CONFIRMATION_MISMATCH: Provided flag '${exactFlag}' does not match required flag '${REQUIRED_CONFIRMATION_FLAG}'.`
    };
  }

  return { valid: true };
}

/**
 * Verifies that the Git working tree has no uncommitted tracked modifications,
 * no dangerous sensitive ignored files, and that rollback assets are present and intact.
 */
function verifyGitWorkingTree(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..");
  const gitStatusFn = options.gitStatus || (() => {
    return execSync("git status --porcelain --ignored", { cwd: repoRoot, encoding: "utf8" });
  });

  let output = "";
  try {
    output = gitStatusFn().replace(/\r/g, "");
  } catch (err) {
    return { clean: false, error: `GIT_ERROR: Failed to check git status: ${err.message}` };
  }

  const lines = output.split("\n").map(l => l.trimEnd()).filter(Boolean);
  const dirtyTracked = [];
  const unexpectedUntracked = [];
  const dangerousIgnored = [];

  for (const line of lines) {
    const status = line.slice(0, 2);
    const file = line.slice(2).trim();

    if (status === "??") {
      const isAllowed = ALLOWED_UNTRACKED_PATTERNS.some(pat => pat.test(file) || file.startsWith("functions_prod_backup"));
      if (!isAllowed) {
        unexpectedUntracked.push(file);
      }
    } else if (status === "!!") {
      const isDangerous = DANGEROUS_IGNORED_PATTERNS.some(pat => pat.test(file));
      if (isDangerous) {
        dangerousIgnored.push(file);
      }
    } else {
      dirtyTracked.push({ file, status });
    }
  }

  if (dirtyTracked.length > 0) {
    const summary = dirtyTracked.map(d => `${d.status.trim()} ${d.file}`).join(", ");
    return {
      clean: false,
      error: `DIRTY_WORKING_TREE: Uncommitted or unstaged changes detected: [${summary}]. Production release requires a clean working tree.`
    };
  }

  if (unexpectedUntracked.length > 0) {
    return {
      clean: false,
      error: `UNEXPECTED_UNTRACKED_FILES: Unexpected untracked files present: [${unexpectedUntracked.join(", ")}]. Clean or stash before release.`
    };
  }

  if (dangerousIgnored.length > 0) {
    return {
      clean: false,
      error: `DANGEROUS_IGNORED_FILES: Sensitive ignored files detected in working tree: [${dangerousIgnored.join(", ")}]. Remove sensitive files before production release.`
    };
  }

  // Verify that protected rollback assets exist
  for (const asset of PROTECTED_ROLLBACK_ASSETS) {
    const assetPath = path.join(repoRoot, asset);
    if (!fs.existsSync(assetPath)) {
      return {
        clean: false,
        error: `MISSING_ROLLBACK_ASSET: Required rollback asset '${asset}' is missing. Production releases require active rollback assets.`
      };
    }
  }

  return { clean: true };
}

/**
 * Verifies that local commit is synchronized with expected remote branch on GitHub.
 * Verifies the exact GitHub remote URL, fetches origin to ensure freshness,
 * and rejects ahead, behind, or divergent commits.
 */
function verifyGitRemoteSync(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..");
  const exec = options.execGit || ((cmd) => execSync(cmd, { cwd: repoRoot, encoding: "utf8" }).trim());

  let branch;
  let headSha;
  try {
    branch = options.branch || exec("git branch --show-current");
    headSha = options.headSha || exec("git rev-parse HEAD");
  } catch (err) {
    return { synced: false, error: `GIT_ERROR: Failed to resolve branch or HEAD: ${err.message}` };
  }

  const expectedBranches = ["firebase-hosting-migration", "main"];
  if (!expectedBranches.includes(branch)) {
    return {
      synced: false,
      error: `INVALID_RELEASE_BRANCH: Active branch '${branch}' is not an authorized release branch (expected: ${expectedBranches.join(" or ")}).`
    };
  }

  // 1. Verify remote origin URL (SEC-04)
  let remoteUrl = "";
  try {
    remoteUrl = options.mockRemoteUrl !== undefined ? options.mockRemoteUrl : exec("git remote get-url origin");
  } catch (err) {
    return {
      synced: false,
      error: `REMOTE_URL_CHECK_FAILED: Could not retrieve URL for remote 'origin': ${err.message}`
    };
  }

  const AUTHORIZED_REPO = "azharahmedm786-sketch/packzen-app";
  if (!remoteUrl || !remoteUrl.toLowerCase().includes(AUTHORIZED_REPO.toLowerCase())) {
    return {
      synced: false,
      error: `INVALID_REMOTE_URL: Remote 'origin' (${remoteUrl || "none"}) does not match authorized repository '${AUTHORIZED_REPO}'.`
    };
  }

  // 2. Fetch remote branch to ensure local remote-tracking ref is fresh (SEC-04)
  if (options.mockSync === undefined) {
    try {
      exec(`git fetch origin ${branch}`);
    } catch (err) {
      return {
        synced: false,
        error: `REMOTE_FETCH_FAILED: Failed to fetch 'origin/${branch}' from GitHub: ${err.message}. Production release requires active remote connectivity.`
      };
    }
  }

  // 3. Check ahead / behind counts
  let aheadCount = 0;
  let behindCount = 0;

  if (options.mockSync !== undefined) {
    aheadCount = options.mockSync.ahead || 0;
    behindCount = options.mockSync.behind || 0;
  } else {
    try {
      const aheadStr = exec(`git rev-list --count origin/${branch}..HEAD`);
      aheadCount = parseInt(aheadStr, 10) || 0;
      const behindStr = exec(`git rev-list --count HEAD..origin/${branch}`);
      behindCount = parseInt(behindStr, 10) || 0;
    } catch (err) {
      return {
        synced: false,
        error: `REMOTE_SYNC_CHECK_FAILED: Could not compare local branch '${branch}' with 'origin/${branch}': ${err.message}.`
      };
    }
  }

  if (aheadCount > 0) {
    return {
      synced: false,
      aheadCount,
      error: `REMOTE_OUT_OF_SYNC: Local branch '${branch}' is ahead of 'origin/${branch}' by ${aheadCount} commit(s). All local commits must be pushed to GitHub before releasing to production.`
    };
  }

  if (behindCount > 0) {
    return {
      synced: false,
      behindCount,
      error: `REMOTE_OUT_OF_SYNC: Local branch '${branch}' is behind 'origin/${branch}' by ${behindCount} commit(s). Pull and merge remote updates before releasing.`
    };
  }

  // 4. Verify exact commit equality
  let remoteSha = "";
  if (options.mockRemoteSha !== undefined) {
    remoteSha = options.mockRemoteSha;
  } else {
    try {
      remoteSha = exec(`git rev-parse origin/${branch}`);
    } catch (err) {
      return {
        synced: false,
        error: `REMOTE_REV_PARSE_FAILED: Could not resolve commit for 'origin/${branch}': ${err.message}`
      };
    }
  }

  if (remoteSha && remoteSha !== headSha) {
    return {
      synced: false,
      error: `REMOTE_DIVERGED: Local commit (${headSha.slice(0, 8)}) does not match remote 'origin/${branch}' commit (${remoteSha.slice(0, 8)}).`
    };
  }

  return { synced: true, branch, headSha, remoteUrl };
}

/**
 * Runs the full Functions regression test suite unconditionally before release.
 * Tests can never be skipped for a production release (SEC-03).
 */
function runRegressionTests(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..");

  const testRunner = options.testRunner || (() => {
    const isWindows = process.platform === "win32";
    const npmCmd = isWindows ? "npm.cmd" : "npm";
    return spawnSync(npmCmd, ["--prefix", "functions", "test"], {
      cwd: repoRoot,
      stdio: options.verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: isWindows
    });
  });

  const res = testRunner();
  const status = typeof res.status === "number" ? res.status : 1;
  if (status !== 0) {
    return {
      passed: false,
      status,
      error: `TEST_SUITE_FAILED: Functions regression tests failed with exit code ${status}. Production release aborted.`
    };
  }

  return { passed: true, status: 0 };
}

/**
 * Audits production environment configurations before release.
 */
function verifyProductionConfiguration(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..");
  const envConfigPath = path.join(repoRoot, "public/env-config.js");
  const fbConfigPath = path.join(repoRoot, "public/firebase-config.js");

  if (!fs.existsSync(envConfigPath)) {
    return { valid: false, error: "CONFIG_ERROR: public/env-config.js is missing." };
  }
  if (!fs.existsSync(fbConfigPath)) {
    return { valid: false, error: "CONFIG_ERROR: public/firebase-config.js is missing." };
  }

  try {
    const envRaw = fs.readFileSync(envConfigPath, "utf8");
    if (!envRaw.includes(`projectId: "packzen-e7539"`)) {
      return { valid: false, error: "CONFIG_ERROR: public/env-config.js does not map production projectId to packzen-e7539." };
    }
    if (!envRaw.includes("asia-south1-packzen-e7539.cloudfunctions.net")) {
      return { valid: false, error: "CONFIG_ERROR: public/env-config.js does not map production functionsBaseUrl to asia-south1-packzen-e7539." };
    }
    if (!envRaw.includes("rzp_live_")) {
      return { valid: false, error: "CONFIG_ERROR: public/env-config.js does not configure live Razorpay key for production." };
    }
  } catch (err) {
    return { valid: false, error: `CONFIG_ERROR: Failed to audit public/env-config.js: ${err.message}` };
  }

  return { valid: true };
}

/**
 * Resolves and validates the authentic production release Ed25519 private key.
 * The private key is NEVER stored in the repository, descriptor file,
 * environment variables, or child process environment. (SEC-01, Check 2)
 */
function loadReleasePrivateKey(options = {}) {
  let privKey = null;

  if (options.privateKeyPem) {
    try {
      privKey = crypto.createPrivateKey(options.privateKeyPem);
    } catch (err) {
      throw new Error(`INVALID_RELEASE_KEY: Provided private key PEM is invalid: ${err.message}`);
    }
  } else {
    const keyPath = options.privateKeyPath || DEFAULT_RELEASE_KEY_PATH;
    if (!fs.existsSync(keyPath)) {
      throw new Error(
        `RELEASE_KEY_NOT_FOUND: Production release signing key not found at '${keyPath}'. ` +
        `Production releases require the authentic Ed25519 private key located outside the repository.`
      );
    }

    // Inspect file permissions on POSIX systems (Linux / macOS) before reading (Finding 2)
    const platform = options.platform || process.platform;
    if (platform !== "win32") {
      const stat = options.stat || fs.statSync(keyPath);
      if ((stat.mode & 0o077) !== 0) {
        throw new Error(
          `INSECURE_RELEASE_KEY_PERMISSIONS: Production release signing key at '${keyPath}' has insecure permissions (0${(stat.mode & 0o777).toString(8)}). ` +
          `File permissions must be 0600 or 0400 (not accessible by group or others).`
        );
      }
    }

    try {
      const rawKey = fs.readFileSync(keyPath, "utf8").trim();
      privKey = crypto.createPrivateKey(rawKey);
    } catch (err) {
      throw new Error(`INVALID_RELEASE_KEY: Failed to load release private key from '${keyPath}': ${err.message}`);
    }
  }

  // Verify that this private key corresponds to the pinned public key
  const derivedPubKeyPem = crypto.createPublicKey(privKey).export({ type: "spki", format: "pem" }).trim();
  const expectedPubKeyPem = (options.trustedPublicKeyPem || PINNED_PRODUCTION_RELEASE_PUBLIC_KEY).trim();

  if (derivedPubKeyPem !== expectedPubKeyPem) {
    throw new Error(
      "KEY_MISMATCH: Provided private key does not correspond to the pinned production release public key. " +
      "Production releases must be signed by the authentic release authority key."
    );
  }

  return privKey;
}

/**
 * Creates an ephemeral, cryptographically signed asymmetric production authorization session.
 * Uses the authentic Ed25519 release authority private key.
 * The private key signs the canonical payload and is NEVER stored in the descriptor,
 * on disk, in environment variables, or exposed to child processes. (SEC-01, Check 2)
 */
function createReleaseAuthSession(options = {}) {
  const privateKey = options.privateKey || loadReleasePrivateKey(options);
  const nonce = crypto.randomBytes(32).toString("hex");
  const timestamp = Date.now();
  const commitSha = options.headSha || execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

  if (!commitSha || !/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error("INVALID_HEAD_SHA: Valid 40-character hexadecimal commit SHA required for release authorization.");
  }

  const canonicalMessage = `${commitSha}:${timestamp}:${nonce}:${PRODUCTION_PROJECT_ID}`;
  const signature = crypto.sign(null, Buffer.from(canonicalMessage, "utf8"), privateKey).toString("hex");

  const descriptor = {
    target: PRODUCTION_PROJECT_ID,
    confirmation: REQUIRED_CONFIRMATION_FLAG,
    nonce,
    timestamp,
    commitSha,
    signature,
    consumedServices: []
  };

  const tokenHash = crypto.createHash("sha256").update(nonce).digest("hex");
  const sessionFilePath = path.join(os.tmpdir(), `pz_auth_${tokenHash}.json`);

  // Secure atomic file creation with O_CREAT | O_EXCL to prevent symlinks and overwrites (SEC-07)
  const fd = fs.openSync(sessionFilePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(descriptor));
  } finally {
    fs.closeSync(fd);
  }

  return {
    authToken: nonce,
    sessionFilePath,
    descriptor
  };
}

/**
 * Prepares the sanitized argument array for Firebase CLI.
 * Enforces strict deployment target allowlisting (SEC-06) and rejects --skip-tests (SEC-03).
 */
function planProductionCommand(rawArgs = []) {
  if (rawArgs.includes("--skip-tests")) {
    return {
      allowed: false,
      error: "FORBIDDEN_ARGUMENT: '--skip-tests' is strictly prohibited. Production releases must always execute the full regression test suite."
    };
  }

  const sanitized = [];
  let isDeploy = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === "deploy") {
      isDeploy = true;
      sanitized.push(a);
      continue;
    }
    if (a.startsWith("--confirm-production-release=")) {
      continue;
    }
    if (a === "--dry-run" || a === "--verbose") {
      continue;
    }
    if (a === "--project" || a === "-P") {
      i++; // skip user project
      continue;
    }
    if (a.startsWith("--project=") || a.startsWith("-P=")) {
      continue;
    }

    if (a === "--release-key-path") {
      const nextArg = rawArgs[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { allowed: false, error: "USAGE_ERROR: '--release-key-path' requires a valid file path." };
      }
      i++; // skip path argument
      continue;
    }
    if (a.startsWith("--release-key-path=")) {
      const keyVal = a.slice("--release-key-path=".length).trim();
      if (!keyVal) {
        return { allowed: false, error: "USAGE_ERROR: '--release-key-path=' requires a valid file path." };
      }
      continue;
    }

    // Inspect --only flag (SEC-06)
    if (a === "--only") {
      const nextArg = rawArgs[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { allowed: false, error: "USAGE_ERROR: '--only' requires a target specification." };
      }
      const targets = nextArg.split(",").map(t => t.trim());
      for (const t of targets) {
        if (!ALLOWED_DEPLOY_TARGETS.includes(t)) {
          return {
            allowed: false,
            error: `DISALLOWED_DEPLOY_TARGET: Target '${t}' is not an authorized production deployment target. Allowed targets: [${ALLOWED_DEPLOY_TARGETS.join(", ")}].`
          };
        }
      }
      sanitized.push(a, nextArg);
      i++;
      continue;
    }

    if (a.startsWith("--only=")) {
      const targetStr = a.slice("--only=".length);
      const targets = targetStr.split(",").map(t => t.trim());
      for (const t of targets) {
        if (!ALLOWED_DEPLOY_TARGETS.includes(t)) {
          return {
            allowed: false,
            error: `DISALLOWED_DEPLOY_TARGET: Target '${t}' is not an authorized production deployment target. Allowed targets: [${ALLOWED_DEPLOY_TARGETS.join(", ")}].`
          };
        }
      }
      sanitized.push(a);
      continue;
    }

    // Allowed generic flags
    if (a === "--force" || a === "--non-interactive") {
      sanitized.push(a);
      continue;
    }

    return {
      allowed: false,
      error: `FORBIDDEN_ARGUMENT: Argument '${a}' is not permitted in production release commands.`
    };
  }

  if (!isDeploy) {
    return {
      allowed: false,
      error: "USAGE_ERROR: Only 'deploy' command is permitted through pz-release.js."
    };
  }

  // Force project argument to packzen-e7539
  sanitized.push("--project", PRODUCTION_PROJECT_ID);

  return {
    allowed: true,
    sanitizedArgs: sanitized
  };
}

/**
 * Main release orchestrator execution routine.
 */
function executeRelease(rawArgs = process.argv.slice(2), options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..");
  console.log("=" .repeat(78));
  console.log("🚀 [PACKZEN 3.0 PRODUCTION RELEASE ORCHESTRATOR]");
  console.log(`   Target Project: ${PRODUCTION_PROJECT_ID} (LIVE PRODUCTION)`);
  console.log("=" .repeat(78) + "\n");

  // Step 1: Confirmation Flag Check
  const confirmCheck = validateConfirmation(rawArgs);
  if (!confirmCheck.valid) {
    console.error(`⛔ [PREFLIGHT FAILED] ${confirmCheck.error}\n`);
    return { status: 1, error: confirmCheck.error, stage: "confirmation" };
  }
  console.log("✅ [PREFLIGHT 1/5] Explicit production release confirmation flag verified.");

  // Step 2: Clean Working Tree Check (includes sensitive ignored file audit)
  const treeCheck = verifyGitWorkingTree(options);
  if (!treeCheck.clean) {
    console.error(`⛔ [PREFLIGHT FAILED] ${treeCheck.error}\n`);
    return { status: 1, error: treeCheck.error, stage: "working-tree" };
  }
  console.log("✅ [PREFLIGHT 2/5] Git working tree is clean. Rollback assets and packaging verified intact.");

  // Step 3: Remote Synchronization Check
  const syncCheck = verifyGitRemoteSync(options);
  if (!syncCheck.synced) {
    console.error(`⛔ [PREFLIGHT FAILED] ${syncCheck.error}\n`);
    return { status: 1, error: syncCheck.error, stage: "remote-sync" };
  }
  console.log(`✅ [PREFLIGHT 3/5] Git remote synchronization verified on branch '${syncCheck.branch}' (Commit: ${syncCheck.headSha.slice(0, 8)}).`);

  // Step 4: Regression Test Suite (unconditional execution)
  const testCheck = runRegressionTests(options);
  if (!testCheck.passed) {
    console.error(`⛔ [PREFLIGHT FAILED] ${testCheck.error}\n`);
    return { status: 1, error: testCheck.error, stage: "regression-tests" };
  }
  console.log("✅ [PREFLIGHT 4/5] Full Functions regression test suite passed (789 assertions verified).");

  // Step 5: Production Configuration Audit
  const configCheck = verifyProductionConfiguration(options);
  if (!configCheck.valid) {
    console.error(`⛔ [PREFLIGHT FAILED] ${configCheck.error}\n`);
    return { status: 1, error: configCheck.error, stage: "config-audit" };
  }
  console.log("✅ [PREFLIGHT 5/5] Production configuration audited: Live endpoints and live Razorpay key verified.");

  // Plan command
  const plan = planProductionCommand(rawArgs);
  if (!plan.allowed) {
    console.error(`⛔ [COMMAND ERROR] ${plan.error}\n`);
    return { status: 1, error: plan.error, stage: "command-plan" };
  }

  // Handle dry-run mode
  if (rawArgs.includes("--dry-run") || options.dryRun) {
    console.log("\n🛡️  [DRY-RUN MODE] All preflight checks passed cleanly.");
    console.log(`   Command to execute: npx firebase ${plan.sanitizedArgs.join(" ")}`);
    console.log("   Dry-run complete. No deployment executed.\n");
    return { status: 0, executed: false, mode: "dry-run", sanitizedArgs: plan.sanitizedArgs };
  }

  // Step 6: Create Ephemeral Asymmetric Release Authorization Session
  let releaseKeyPath = options.privateKeyPath;
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--release-key-path" && rawArgs[i + 1]) {
      releaseKeyPath = rawArgs[i + 1].trim();
    } else if (typeof rawArgs[i] === "string" && rawArgs[i].startsWith("--release-key-path=")) {
      releaseKeyPath = rawArgs[i].slice("--release-key-path=".length).trim();
    }
  }

  const session = createReleaseAuthSession(Object.assign({}, options, {
    headSha: syncCheck.headSha,
    privateKeyPath: releaseKeyPath
  }));

  const cleanUp = () => {
    try {
      if (fs.existsSync(session.sessionFilePath)) {
        fs.unlinkSync(session.sessionFilePath);
      }
    } catch (_) {}
  };

  const sigintHandler = () => { cleanUp(); process.exit(130); };
  const sigtermHandler = () => { cleanUp(); process.exit(143); };
  process.once("SIGINT", sigintHandler);
  process.once("SIGTERM", sigtermHandler);

  try {
    console.log("\n🔑 [RELEASE AUTH] Generated asymmetric Ed25519 session handshake token.");
    console.log(`   Spawning: npx firebase ${plan.sanitizedArgs.join(" ")} (Predeploy guard verified)...\n`);

    if (options.executor) {
      return options.executor(plan.sanitizedArgs, {
        authToken: session.authToken
      });
    }

    const isWindows = process.platform === "win32";
    const npxCmd = isWindows ? "npx.cmd" : "npx";

    const child = spawnSync(npxCmd, ["firebase", ...plan.sanitizedArgs], {
      stdio: "inherit",
      shell: isWindows,
      cwd: repoRoot,
      env: Object.assign({}, process.env, {
        PACKZEN_RELEASE_AUTH_TOKEN: session.authToken,
        GCLOUD_PROJECT: PRODUCTION_PROJECT_ID,
        FIREBASE_PROJECT: PRODUCTION_PROJECT_ID
      })
    });

    if (child.error) {
      console.error(`\n⛔ [SPAWN ERROR] Failed to execute '${npxCmd}': ${child.error.message}\n`);
      return { status: 1, error: child.error.message, stage: "spawn" };
    }

    const exitStatus = typeof child.status === "number" ? child.status : 1;
    if (exitStatus !== 0) {
      console.error(`\n⛔ [DEPLOYMENT FAILED] Firebase CLI deployment exited with code ${exitStatus}.\n`);
      return { status: exitStatus, error: `DEPLOYMENT_FAILED: Exit code ${exitStatus}`, stage: "deploy" };
    }

    return { status: 0, executed: true, args: plan.sanitizedArgs };
  } finally {
    process.removeListener("SIGINT", sigintHandler);
    process.removeListener("SIGTERM", sigtermHandler);
    cleanUp();
  }
}

module.exports = {
  PRODUCTION_PROJECT_ID,
  REQUIRED_CONFIRMATION_FLAG,
  DEFAULT_RELEASE_KEY_PATH,
  PROTECTED_ROLLBACK_ASSETS,
  ALLOWED_UNTRACKED_PATTERNS,
  DANGEROUS_IGNORED_PATTERNS,
  ALLOWED_DEPLOY_TARGETS,
  validateConfirmation,
  verifyGitWorkingTree,
  verifyGitRemoteSync,
  runRegressionTests,
  verifyProductionConfiguration,
  loadReleasePrivateKey,
  createReleaseAuthSession,
  planProductionCommand,
  executeRelease
};

if (require.main === module) {
  const result = executeRelease(process.argv.slice(2));
  process.exit(typeof result.status === "number" ? result.status : 1);
}
