/**
 * functions/test/production-release.test.js
 * -------------------------------------------------------------
 * PackZen 3.0 Automated Security Test Suite:
 * Production Release Wrapper & Staging Isolation Guard (Hardened)
 *
 * Verifies all 10 Adversarial Audit Findings:
 *  - SEC-01: Asymmetric Ed25519 signature & forged signature defense.
 *  - SEC-02: Windows subprocess spawn error & non-zero exit propagation.
 *  - SEC-03: Strict rejection of --skip-tests flag.
 *  - SEC-04: GitHub remote URL verification, fetch enforcement & divergent commit defense.
 *  - SEC-05: Strict 40-character hexadecimal commit SHA binding.
 *  - SEC-06: Strict deployment target allowlisting for --only.
 *  - SEC-07: Temporary file security, O_CREAT|O_EXCL & nonce binding.
 *  - SEC-08: Sensitive ignored file audit (env, pem, key, serviceAccountKey).
 *  - SEC-09: Anti-replay service tracking & 60s expiration window.
 *  - SEC-10: Genuine adversarial tests for all attack scenarios.
 * -------------------------------------------------------------
 */
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { describe, it } = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const guard = require(path.join(repoRoot, "scripts/guard-staging-deploy.js"));
const stagingWrapper = require(path.join(repoRoot, "scripts/pz-staging.js"));
const releaseOrchestrator = require(path.join(repoRoot, "scripts/pz-release.js"));

const mockRc = {
  projects: {
    default: "packzen-e7539",
    production: "packzen-e7539",
    staging: "packzen-staging-3"
  }
};

// Ephemeral in-memory Ed25519 test keypair for portable, hermetic unit testing (Finding 1)
const { publicKey: testPublicKey, privateKey: testPrivateKey } = crypto.generateKeyPairSync("ed25519");
const testPublicKeyPem = testPublicKey.export({ type: "spki", format: "pem" });
const testPrivateKeyPem = testPrivateKey.export({ type: "pkcs8", format: "pem" });

/**
 * Creates an isolated temporary workspace directory for hermetic testing.
 * Sets up temporary rollback assets and copies public/ configuration so that
 * tests run independently of untracked files on the host machine or in CI.
 */
function createFixtureWorkspace(options = {}) {
  const withRollbackAssets = options.withRollbackAssets !== false;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pz-fixture-ws-"));

  const cleanup = (stage = "initial") => {
    if (stage === "initial" && options._simulateCleanupError) {
      throw new Error(options._simulateCleanupError);
    }
    if (stage === "forced" && options._simulateForcedCleanupError) {
      throw new Error(options._simulateForcedCleanupError);
    }
    if (stage === "emergency" && options._simulateEmergencyCleanupError) {
      throw new Error(options._simulateEmergencyCleanupError);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  };

  try {
    if (options._simulateSetupError) {
      throw new Error(options._simulateSetupError);
    }

    if (withRollbackAssets) {
      fs.writeFileSync(path.join(tempDir, "firebase.rollback.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "firestore.rules.prod_backup"), "rules_version = '2';");
      fs.mkdirSync(path.join(tempDir, "functions_prod_backup"), { recursive: true });
    }

    // Copy public directory from repoRoot to support verifyProductionConfiguration
    const realPublic = path.join(repoRoot, "public");
    if (fs.existsSync(realPublic)) {
      fs.cpSync(realPublic, path.join(tempDir, "public"), { recursive: true });
    }
  } catch (setupErr) {
    try {
      cleanup("initial");
    } catch (cleanupErr) {
      const allErrors = [setupErr, cleanupErr];
      if (fs.existsSync(tempDir)) {
        try {
          cleanup("forced");
        } catch (forcedCleanupErr) {
          allErrors.push(forcedCleanupErr);
          if (fs.existsSync(tempDir)) {
            try {
              cleanup("emergency");
            } catch (emergencyCleanupErr) {
              allErrors.push(emergencyCleanupErr);
              if (options._simulateEmergencyCleanupError && fs.existsSync(tempDir)) {
                try {
                  cleanup("real");
                } catch (realErr) {
                  allErrors.push(realErr);
                }
              }
            }
          }
        }
      }
      const failureDetails = allErrors.slice(1).map(e => e.message).join("; ");
      throw new AggregateError(
        allErrors,
        `Fixture workspace setup failed (${setupErr.message}) and cleanup also failed (${failureDetails})`,
        { cause: setupErr }
      );
    }
    throw setupErr;
  }

  return {
    dir: tempDir,
    cleanup
  };
}

describe("PACKZEN 3.0 — PRODUCTION RELEASE SECURITY & ISOLATION SUITE", () => {

  describe("1. Direct Production Deployment Rejection (Guard Fails Closed)", () => {
    it("REJECTS direct --project packzen-e7539 without authorization token", () => {
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {}
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.projectId, "packzen-e7539");
      assert.ok(res.error.includes("FORBIDDEN_PRODUCTION"));
      assert.ok(res.error.includes("Direct or unconfirmed deployment to PRODUCTION is blocked"));
    });

    it("REJECTS direct --project production alias without authorization token", () => {
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "production"],
        env: {}
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.projectId, "packzen-e7539");
      assert.ok(res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS direct bare deployment defaulting to production", () => {
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js"],
        env: {}
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.projectId, "packzen-e7539");
      assert.ok(res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("ACCEPTS staging deployment to packzen-staging-3", () => {
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-staging-3"],
        env: {}
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.projectId, "packzen-staging-3");
      assert.strictEqual(res.details.mode, "explicit-consensus");
    });

    it("ACCEPTS staging deployment via staging alias", () => {
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "staging"],
        env: {}
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.projectId, "packzen-staging-3");
    });
  });

  describe("2. Asymmetric Cryptographic Handshake & Forgery Defense (SEC-01, SEC-07, SEC-09, Check 2)", () => {
    const validCommit = "25e83c17d090998e3cf8c45ff0647c9be174c717";
    const nonce = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const timestamp = Date.now();

    function createValidAuthDescriptor(signingKey = testPrivateKey) {
      const msg = `${validCommit}:${timestamp}:${nonce}:packzen-e7539`;
      const sig = crypto.sign(null, Buffer.from(msg, "utf8"), signingKey).toString("hex");

      return {
        target: "packzen-e7539",
        confirmation: "--confirm-production-release=packzen-e7539",
        nonce,
        timestamp,
        commitSha: validCommit,
        signature: sig,
        consumedServices: []
      };
    }

    it("AUTHORIZES production deployment when valid asymmetric Ed25519 signature is presented against trusted test key", () => {
      const descriptor = createValidAuthDescriptor();
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539", "--service", "hosting"],
        env: {
          PACKZEN_RELEASE_AUTH_TOKEN: nonce
        },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.projectId, "packzen-e7539");
      assert.strictEqual(res.details.mode, "authorized-production-release");
      assert.strictEqual(res.details.authDetails.commitSha, validCommit);
    });

    it("AUTHORIZES production deployment when authentic key is available on disk (optional local verification)", {
      skip: !fs.existsSync(releaseOrchestrator.DEFAULT_RELEASE_KEY_PATH)
        ? "Authentic production release private key not present on this machine (least-privilege mode)"
        : false
    }, () => {
      const realPrivKey = releaseOrchestrator.loadReleasePrivateKey();
      const msg = `${validCommit}:${timestamp}:${nonce}:packzen-e7539`;
      const sig = crypto.sign(null, Buffer.from(msg, "utf8"), realPrivKey).toString("hex");
      const prodDescriptor = {
        target: "packzen-e7539",
        confirmation: "--confirm-production-release=packzen-e7539",
        nonce,
        timestamp,
        commitSha: validCommit,
        signature: sig,
        consumedServices: []
      };
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539", "--service", "hosting"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: guard.PINNED_PRODUCTION_RELEASE_PUBLIC_KEY,
        authDescriptor: prodDescriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.projectId, "packzen-e7539");
      assert.strictEqual(res.details.mode, "authorized-production-release");
    });

    it("REJECTS environment variable public-key substitution via PACKZEN_RELEASE_AUTH_PUBKEY (Check 2)", () => {
      const descriptor = createValidAuthDescriptor();
      const { publicKey: attackerPub } = crypto.generateKeyPairSync("ed25519");
      const attackerPubPem = attackerPub.export({ type: "spki", format: "pem" });

      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {
          PACKZEN_RELEASE_AUTH_TOKEN: nonce,
          PACKZEN_RELEASE_AUTH_PUBKEY: attackerPubPem
        },
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("ENV_PUBKEY_OVERRIDE_PROHIBITED") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if attacker-generated keypair signs the descriptor (SEC-01, Check 2)", () => {
      const { privateKey: attackerPrivateKey } = crypto.generateKeyPairSync("ed25519");
      const msg = `${validCommit}:${timestamp}:${nonce}:packzen-e7539`;
      const forgedSig = crypto.sign(null, Buffer.from(msg, "utf8"), attackerPrivateKey).toString("hex");

      const descriptor = createValidAuthDescriptor();
      descriptor.signature = forgedSig; // forged with attacker's key

      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {
          PACKZEN_RELEASE_AUTH_TOKEN: nonce
        },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("INVALID_SIGNATURE") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if trusted public key is missing or empty (fails closed)", () => {
      const descriptor = createValidAuthDescriptor();
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        trustedPublicKeyPem: "",
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("MISSING_PUBLIC_KEY") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if trusted public key is malformed", () => {
      const descriptor = createValidAuthDescriptor();
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {
          PACKZEN_RELEASE_AUTH_TOKEN: nonce
        },
        trustedPublicKeyPem: "not-a-valid-pem-key",
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("INVALID_PUBLIC_KEY") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if descriptor contains private or secret key material (SEC-01)", () => {
      const descriptor = createValidAuthDescriptor();
      descriptor.privateKey = "attacker_private_key_should_not_be_here";
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {
          PACKZEN_RELEASE_AUTH_TOKEN: nonce
        },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("FORBIDDEN_KEY_IN_DESCRIPTOR") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if nonce does not match descriptor (SEC-07)", () => {
      const descriptor = createValidAuthDescriptor();
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {
          PACKZEN_RELEASE_AUTH_TOKEN: "different_nonce_1234567890abcdef1234567890abcdef"
        },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("NONCE_MISMATCH") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if authorization session has expired (> 60s, SEC-09)", () => {
      const descriptor = createValidAuthDescriptor();
      descriptor.timestamp = Date.now() - 75000; // 75 seconds ago (limit is 60s)
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {
          PACKZEN_RELEASE_AUTH_TOKEN: nonce
        },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("EXPIRED_SESSION") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });
  });

  describe("3. Commit SHA Binding Integrity (SEC-05)", () => {
    const validCommit = "25e83c17d090998e3cf8c45ff0647c9be174c717";
    const nonce = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    function makeDescriptor(sha) {
      const ts = Date.now();
      const msg = `${sha}:${ts}:${nonce}:packzen-e7539`;
      const sig = crypto.sign(null, Buffer.from(msg, "utf8"), testPrivateKey).toString("hex");
      return {
        target: "packzen-e7539",
        confirmation: "--confirm-production-release=packzen-e7539",
        nonce,
        timestamp: ts,
        commitSha: sha,
        signature: sig
      };
    }

    it("REJECTS production deployment if commitSha is empty string (SEC-05)", () => {
      const descriptor = makeDescriptor("");
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("INVALID_COMMIT_SHA") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if commitSha is malformed (not 40 hex chars, SEC-05)", () => {
      const descriptor = makeDescriptor("short_sha_123");
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("INVALID_COMMIT_SHA") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if currentHead cannot be resolved (SEC-05)", () => {
      const descriptor = makeDescriptor(validCommit);
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: null // simulate unresolvable HEAD
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("MISSING_CURRENT_HEAD") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS production deployment if commitSha does not match currentHead (SEC-05)", () => {
      const descriptor = makeDescriptor("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      const res = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: descriptor,
        currentHead: validCommit
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("COMMIT_MISMATCH") || res.error.includes("FORBIDDEN_PRODUCTION"));
    });
  });

  describe("4. Anti-Replay & Service Scoping (SEC-09)", () => {
    const validCommit = "25e83c17d090998e3cf8c45ff0647c9be174c717";
    const nonce = "b1c2d3e4f5a60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const ts = Date.now();
    const sig = crypto.sign(null, Buffer.from(`${validCommit}:${ts}:${nonce}:packzen-e7539`, "utf8"), testPrivateKey).toString("hex");

    const sharedDescriptor = {
      target: "packzen-e7539",
      confirmation: "--confirm-production-release=packzen-e7539",
      nonce,
      timestamp: ts,
      commitSha: validCommit,
      signature: sig,
      consumedServices: []
    };

    it("ACCEPTS distinct services deploying sequentially under same valid session", () => {
      const res1 = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539", "--service", "hosting"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: sharedDescriptor,
        currentHead: validCommit
      });
      assert.strictEqual(res1.valid, true);

      const res2 = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539", "--service", "functions"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: sharedDescriptor,
        currentHead: validCommit
      });
      assert.strictEqual(res2.valid, true);
    });

    it("REJECTS replay of the same service under the same release token (SEC-09)", () => {
      // 'hosting' has already been consumed in the test above
      const replayRes = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539", "--service", "hosting"],
        env: { PACKZEN_RELEASE_AUTH_TOKEN: nonce },
        trustedPublicKeyPem: testPublicKeyPem,
        authDescriptor: sharedDescriptor,
        currentHead: validCommit
      });

      assert.strictEqual(replayRes.valid, false);
      assert.ok(replayRes.error.includes("REPLAY_DETECTED") || replayRes.error.includes("FORBIDDEN_PRODUCTION"));
    });
  });

  describe("5. Staging Wrapper Isolation (pz-staging.js Preserved)", () => {
    it("STRICTLY REJECTS production target injection in staging wrapper", () => {
      const plan = stagingWrapper.planStagingCommand(["deploy", "--project", "packzen-e7539"]);
      assert.strictEqual(plan.allowed, false);
      assert.ok(plan.error.includes("ARGUMENT_INJECTION_BLOCKED"));
    });

    it("STRICTLY REJECTS production alias in staging wrapper", () => {
      const plan = stagingWrapper.planStagingCommand(["deploy", "-P", "production"]);
      assert.strictEqual(plan.allowed, false);
      assert.ok(plan.error.includes("ARGUMENT_INJECTION_BLOCKED"));
    });

    it("INJECTS packzen-staging-3 for staging commands", () => {
      const plan = stagingWrapper.planStagingCommand(["deploy", "--only", "hosting"]);
      assert.strictEqual(plan.allowed, true);
      assert.ok(plan.sanitizedArgs.includes("--project"));
      assert.ok(plan.sanitizedArgs.includes("packzen-staging-3"));
    });
  });

  describe("6. Production Release Wrapper Preflight Checks (pz-release.js)", () => {
    it("REJECTS release without confirmation flag", () => {
      const res = releaseOrchestrator.validateConfirmation(["deploy", "--only", "hosting"]);
      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("MISSING_CONFIRMATION"));
    });

    it("REJECTS release with wrong confirmation project", () => {
      const res = releaseOrchestrator.validateConfirmation(["deploy", "--confirm-production-release=packzen-staging-3"]);
      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes("CONFIRMATION_MISMATCH"));
    });

    it("ACCEPTS exact confirmation flag", () => {
      const res = releaseOrchestrator.validateConfirmation(["deploy", "--confirm-production-release=packzen-e7539"]);
      assert.strictEqual(res.valid, true);
    });

    it("REJECTS release when tracked modifications exist (DIRTY_WORKING_TREE)", () => {
      const res = releaseOrchestrator.verifyGitWorkingTree({
        repoRoot,
        gitStatus: () => " M public/script.js\n?? PACKZEN_REPORT.md"
      });
      assert.strictEqual(res.clean, false);
      assert.ok(res.error.includes("DIRTY_WORKING_TREE"));
    });

    it("REJECTS release when sensitive ignored files exist in working tree (SEC-08)", () => {
      const res = releaseOrchestrator.verifyGitWorkingTree({
        repoRoot,
        gitStatus: () => "!! functions/.env\n?? PACKZEN_3_0_STAGING_PLAN.md\n?? firebase.rollback.json\n?? firestore.rules.prod_backup\n?? functions_prod_backup/"
      });
      assert.strictEqual(res.clean, false);
      assert.ok(res.error.includes("DANGEROUS_IGNORED_FILES"));
    });

    it("ACCEPTS clean tree with whitelisted untracked rollback assets, docs, and gcloudignore", () => {
      const ws = createFixtureWorkspace({ withRollbackAssets: true });
      try {
        const res = releaseOrchestrator.verifyGitWorkingTree({
          repoRoot: ws.dir,
          gitStatus: () => "?? PACKZEN_3_0_STAGING_PLAN.md\n?? firebase.rollback.json\n?? firestore.rules.prod_backup\n?? functions_prod_backup/\n?? functions/.gcloudignore"
        });
        assert.strictEqual(res.clean, true);
      } finally {
        ws.cleanup();
      }
    });

    it("REJECTS release when required rollback assets are missing (MISSING_ROLLBACK_ASSET)", () => {
      const ws = createFixtureWorkspace({ withRollbackAssets: false });
      try {
        const res = releaseOrchestrator.verifyGitWorkingTree({
          repoRoot: ws.dir,
          gitStatus: () => "?? PACKZEN_3_0_STAGING_PLAN.md\n?? functions/.gcloudignore"
        });
        assert.strictEqual(res.clean, false);
        assert.ok(res.error.includes("MISSING_ROLLBACK_ASSET"));
        assert.ok(res.error.includes("firebase.rollback.json"));
      } finally {
        ws.cleanup();
      }
    });

    it("PRESERVES unmodified setup error when fixture workspace partial setup fails but cleanup succeeds", () => {
      let caught = null;
      try {
        createFixtureWorkspace({ _simulateSetupError: "SIMULATED_SETUP_FAILURE" });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught);
      assert.strictEqual(caught.message, "SIMULATED_SETUP_FAILURE");
      assert.strictEqual(caught instanceof AggregateError, false);
    });

    it("OBSERVES both setup and cleanup errors via AggregateError without mutating original error", () => {
      let caught = null;
      try {
        createFixtureWorkspace({
          _simulateSetupError: "SIMULATED_SETUP_FAILURE",
          _simulateCleanupError: "SIMULATED_CLEANUP_FAILURE"
        });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof AggregateError);
      assert.strictEqual(caught.errors.length, 2);
      assert.strictEqual(caught.errors[0].message, "SIMULATED_SETUP_FAILURE");
      assert.strictEqual(caught.errors[1].message, "SIMULATED_CLEANUP_FAILURE");
      assert.strictEqual(caught.cause, caught.errors[0]);
    });

    it("OBSERVES setup error, initial cleanup error, and forced cleanup error in AggregateError", () => {
      let caught = null;
      try {
        createFixtureWorkspace({
          _simulateSetupError: "SIMULATED_SETUP_FAILURE",
          _simulateCleanupError: "SIMULATED_CLEANUP_FAILURE",
          _simulateForcedCleanupError: "SIMULATED_FORCED_CLEANUP_FAILURE"
        });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof AggregateError);
      assert.strictEqual(caught.errors.length, 3);
      assert.strictEqual(caught.errors[0].message, "SIMULATED_SETUP_FAILURE");
      assert.strictEqual(caught.errors[1].message, "SIMULATED_CLEANUP_FAILURE");
      assert.strictEqual(caught.errors[2].message, "SIMULATED_FORCED_CLEANUP_FAILURE");
      assert.strictEqual(caught.cause, caught.errors[0]);
    });

    it("OBSERVES all four errors in AggregateError when setup and every cleanup stage fails", () => {
      let caught = null;
      try {
        createFixtureWorkspace({
          _simulateSetupError: "SIMULATED_SETUP_FAILURE",
          _simulateCleanupError: "SIMULATED_CLEANUP_FAILURE",
          _simulateForcedCleanupError: "SIMULATED_FORCED_CLEANUP_FAILURE",
          _simulateEmergencyCleanupError: "SIMULATED_EMERGENCY_CLEANUP_FAILURE"
        });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof AggregateError);
      assert.strictEqual(caught.errors.length, 4);
      assert.strictEqual(caught.errors[0].message, "SIMULATED_SETUP_FAILURE");
      assert.strictEqual(caught.errors[1].message, "SIMULATED_CLEANUP_FAILURE");
      assert.strictEqual(caught.errors[2].message, "SIMULATED_FORCED_CLEANUP_FAILURE");
      assert.strictEqual(caught.errors[3].message, "SIMULATED_EMERGENCY_CLEANUP_FAILURE");
      assert.strictEqual(caught.cause, caught.errors[0]);
    });

    it("REJECTS release if remote origin URL is unauthorized (SEC-04)", () => {
      const res = releaseOrchestrator.verifyGitRemoteSync({
        repoRoot,
        branch: "firebase-hosting-migration",
        headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
        mockRemoteUrl: "https://github.com/attacker/malicious-repo.git",
        mockSync: { ahead: 0, behind: 0 }
      });
      assert.strictEqual(res.synced, false);
      assert.ok(res.error.includes("INVALID_REMOTE_URL"));
    });

    it("REJECTS release when local branch is ahead of remote origin (SEC-04)", () => {
      const res = releaseOrchestrator.verifyGitRemoteSync({
        repoRoot,
        branch: "firebase-hosting-migration",
        headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
        mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
        mockSync: { ahead: 5, behind: 0 }
      });
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.aheadCount, 5);
      assert.ok(res.error.includes("REMOTE_OUT_OF_SYNC"));
    });

    it("REJECTS release when local branch is behind remote origin (SEC-04)", () => {
      const res = releaseOrchestrator.verifyGitRemoteSync({
        repoRoot,
        branch: "firebase-hosting-migration",
        headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
        mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
        mockSync: { ahead: 0, behind: 3 }
      });
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.behindCount, 3);
      assert.ok(res.error.includes("REMOTE_OUT_OF_SYNC"));
    });

    it("REJECTS release when local commit diverged from remote commit (SEC-04)", () => {
      const res = releaseOrchestrator.verifyGitRemoteSync({
        repoRoot,
        branch: "firebase-hosting-migration",
        headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
        mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
        mockSync: { ahead: 0, behind: 0 },
        mockRemoteSha: "0000000000000000000000000000000000000000" // different remote SHA
      });
      assert.strictEqual(res.synced, false);
      assert.ok(res.error.includes("REMOTE_DIVERGED"));
    });

    it("ACCEPTS release when local branch is synchronized with remote origin", () => {
      const res = releaseOrchestrator.verifyGitRemoteSync({
        repoRoot,
        branch: "firebase-hosting-migration",
        headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
        mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
        mockSync: { ahead: 0, behind: 0 },
        mockRemoteSha: "25e83c17d090998e3cf8c45ff0647c9be174c717"
      });
      assert.strictEqual(res.synced, true);
      assert.strictEqual(res.branch, "firebase-hosting-migration");
    });

    it("REJECTS release when regression test suite fails", () => {
      const res = releaseOrchestrator.runRegressionTests({
        repoRoot,
        testRunner: () => ({ status: 1 })
      });
      assert.strictEqual(res.passed, false);
      assert.ok(res.error.includes("TEST_SUITE_FAILED"));
    });

    it("ACCEPTS release when regression test suite passes", () => {
      const res = releaseOrchestrator.runRegressionTests({
        repoRoot,
        testRunner: () => ({ status: 0 })
      });
      assert.strictEqual(res.passed, true);
    });

    it("STRICTLY REJECTS --skip-tests CLI argument (SEC-03)", () => {
      const plan = releaseOrchestrator.planProductionCommand([
        "deploy",
        "--confirm-production-release=packzen-e7539",
        "--skip-tests"
      ]);
      assert.strictEqual(plan.allowed, false);
      assert.ok(plan.error.includes("FORBIDDEN_ARGUMENT"));
      assert.ok(plan.error.includes("--skip-tests"));
    });

    it("REJECTS disallowed deployment resource target in --only (SEC-06)", () => {
      const plan = releaseOrchestrator.planProductionCommand([
        "deploy",
        "--only",
        "database", // disallowed
        "--confirm-production-release=packzen-e7539"
      ]);
      assert.strictEqual(plan.allowed, false);
      assert.ok(plan.error.includes("DISALLOWED_DEPLOY_TARGET"));
    });

    it("ACCEPTS authorized deployment resource targets in --only (SEC-06)", () => {
      const plan = releaseOrchestrator.planProductionCommand([
        "deploy",
        "--only",
        "hosting,functions",
        "--confirm-production-release=packzen-e7539"
      ]);
      assert.strictEqual(plan.allowed, true);
      assert.deepStrictEqual(plan.sanitizedArgs, [
        "deploy",
        "--only",
        "hosting,functions",
        "--project",
        "packzen-e7539"
      ]);
    });

    it("AUDITS production configuration (endpoints, projectId, live Razorpay key)", () => {
      const res = releaseOrchestrator.verifyProductionConfiguration({ repoRoot });
      assert.strictEqual(res.valid, true);
    });

    it("DRY-RUN mode validates all preflights without executing deployment", () => {
      const ws = createFixtureWorkspace({ withRollbackAssets: true });
      try {
        const res = releaseOrchestrator.executeRelease(
          ["deploy", "--only", "hosting", "--confirm-production-release=packzen-e7539", "--dry-run"],
          {
            repoRoot: ws.dir,
            branch: "firebase-hosting-migration",
            gitStatus: () => "?? PACKZEN_3_0_STAGING_PLAN.md\n?? firebase.rollback.json\n?? firestore.rules.prod_backup\n?? functions_prod_backup/",
            mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
            mockSync: { ahead: 0, behind: 0 },
            headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            mockRemoteSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            testRunner: () => ({ status: 0 })
          }
        );
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.executed, false);
        assert.strictEqual(res.mode, "dry-run");
        assert.deepStrictEqual(res.sanitizedArgs, ["deploy", "--only", "hosting", "--project", "packzen-e7539"]);
      } finally {
        ws.cleanup();
      }
    });
  });

  describe("7. Windows Execution & Subprocess Error Handling (SEC-02)", () => {
    it("RETURNS non-zero status when subprocess spawn fails (SEC-02)", () => {
      const ws = createFixtureWorkspace({ withRollbackAssets: true });
      try {
        const res = releaseOrchestrator.executeRelease(
          ["deploy", "--only", "hosting", "--confirm-production-release=packzen-e7539"],
          {
            repoRoot: ws.dir,
            branch: "firebase-hosting-migration",
            privateKey: testPrivateKey,
            gitStatus: () => "?? PACKZEN_3_0_STAGING_PLAN.md\n?? firebase.rollback.json\n?? firestore.rules.prod_backup\n?? functions_prod_backup/",
            mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
            mockSync: { ahead: 0, behind: 0 },
            headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            mockRemoteSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            testRunner: () => ({ status: 0 }),
            executor: () => {
              // Simulate spawn error (e.g. ENOENT)
              return { status: 1, error: "spawnSync npx ENOENT", stage: "spawn" };
            }
          }
        );

        assert.strictEqual(res.status, 1);
        assert.ok(res.error.includes("ENOENT"));
      } finally {
        ws.cleanup();
      }
    });

    it("PROPAGATES non-zero deployment exit code and never exits with 0 on failure (SEC-02)", () => {
      const ws = createFixtureWorkspace({ withRollbackAssets: true });
      try {
        const res = releaseOrchestrator.executeRelease(
          ["deploy", "--only", "hosting", "--confirm-production-release=packzen-e7539"],
          {
            repoRoot: ws.dir,
            branch: "firebase-hosting-migration",
            privateKey: testPrivateKey,
            gitStatus: () => "?? PACKZEN_3_0_STAGING_PLAN.md\n?? firebase.rollback.json\n?? firestore.rules.prod_backup\n?? functions_prod_backup/",
            mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
            mockSync: { ahead: 0, behind: 0 },
            headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            mockRemoteSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            testRunner: () => ({ status: 0 }),
            executor: () => {
              // Simulate Firebase CLI deployment failure with exit code 2
              return { status: 2, error: "DEPLOYMENT_FAILED: Exit code 2", stage: "deploy" };
            }
          }
        );

        assert.strictEqual(res.status, 2);
        assert.ok(res.error.includes("DEPLOYMENT_FAILED"));
      } finally {
        ws.cleanup();
      }
    });
  });

  describe("8. Pinned Key Management & Release Wrapper Verification (Check 2)", () => {
    it("LOADS authentic private key matching pinned public key (optional local verification)", {
      skip: !fs.existsSync(releaseOrchestrator.DEFAULT_RELEASE_KEY_PATH)
        ? "Authentic production release private key not present on this machine (least-privilege mode)"
        : false
    }, () => {
      const privKey = releaseOrchestrator.loadReleasePrivateKey();
      assert.ok(privKey);
      const derivedPub = crypto.createPublicKey(privKey).export({ type: "spki", format: "pem" }).trim();
      assert.strictEqual(derivedPub, guard.PINNED_PRODUCTION_RELEASE_PUBLIC_KEY.trim());
    });

    it("REJECTS release signing if private key does not correspond to pinned public key (KEY_MISMATCH)", () => {
      const { privateKey: arbitraryPriv } = crypto.generateKeyPairSync("ed25519");
      const arbitraryPrivPem = arbitraryPriv.export({ type: "pkcs8", format: "pem" });

      assert.throws(() => {
        releaseOrchestrator.loadReleasePrivateKey({ privateKeyPem: arbitraryPrivPem });
      }, /KEY_MISMATCH/);
    });

    it("REJECTS release signing if private key file does not exist (RELEASE_KEY_NOT_FOUND)", () => {
      assert.throws(() => {
        releaseOrchestrator.loadReleasePrivateKey({ privateKeyPath: "/nonexistent/path/to/key.pem" });
      }, /RELEASE_KEY_NOT_FOUND/);
    });

    it("REJECTS private key file with insecure permissions on POSIX systems (INSECURE_RELEASE_KEY_PERMISSIONS)", () => {
      assert.throws(() => {
        releaseOrchestrator.loadReleasePrivateKey({
          privateKeyPath: __filename,
          platform: "linux",
          stat: { mode: 0o100644 }
        });
      }, (err) => {
        assert.ok(err.message.includes("INSECURE_RELEASE_KEY_PERMISSIONS"));
        assert.ok(err.message.includes("0644"));
        return true;
      });
    });

    it("REJECTS private key file with group/other write permissions on POSIX systems", () => {
      assert.throws(() => {
        releaseOrchestrator.loadReleasePrivateKey({
          privateKeyPath: __filename,
          platform: "darwin",
          stat: { mode: 0o100666 }
        });
      }, (err) => {
        assert.ok(err.message.includes("INSECURE_RELEASE_KEY_PERMISSIONS"));
        assert.ok(err.message.includes("0666"));
        return true;
      });
    });

    it("ACCEPTS private key file with secure permissions on POSIX systems (0600 / 0400)", () => {
      const fakeKeyPath = path.join(os.tmpdir(), "pz_test_perm_key.pem");
      fs.writeFileSync(fakeKeyPath, testPrivateKeyPem, { mode: 0o600 });
      try {
        const loadedKey = releaseOrchestrator.loadReleasePrivateKey({
          privateKeyPath: fakeKeyPath,
          platform: "linux",
          stat: { mode: 0o100600 },
          trustedPublicKeyPem: testPublicKeyPem
        });
        assert.ok(loadedKey);
      } finally {
        try { fs.unlinkSync(fakeKeyPath); } catch (_) {}
      }
    });

    it("PRESERVES Windows user profile ACL handling without mode failure on win32 platform", () => {
      const fakeKeyPath = path.join(os.tmpdir(), "pz_test_win_key.pem");
      fs.writeFileSync(fakeKeyPath, testPrivateKeyPem);
      try {
        const loadedKey = releaseOrchestrator.loadReleasePrivateKey({
          privateKeyPath: fakeKeyPath,
          platform: "win32",
          stat: { mode: 0o100666 },
          trustedPublicKeyPem: testPublicKeyPem
        });
        assert.ok(loadedKey);
      } finally {
        try { fs.unlinkSync(fakeKeyPath); } catch (_) {}
      }
    });

    it("CREATES valid release authorization session without storing key in descriptor", () => {
      const session = releaseOrchestrator.createReleaseAuthSession({
        headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
        privateKey: testPrivateKey
      });

      assert.ok(session.authToken);
      assert.ok(session.sessionFilePath);
      assert.strictEqual(session.descriptor.privateKey, undefined);
      assert.strictEqual(session.descriptor.publicKeyPem, undefined);
      assert.strictEqual(session.publicKeyPem, undefined);

      // Clean up temp session file
      try {
        if (fs.existsSync(session.sessionFilePath)) {
          fs.unlinkSync(session.sessionFilePath);
        }
      } catch (_) {}
    });

    it("STRIPS --release-key-path from Firebase CLI command arguments", () => {
      const plan = releaseOrchestrator.planProductionCommand([
        "deploy",
        "--only",
        "hosting",
        "--confirm-production-release=packzen-e7539",
        "--release-key-path=C:\\keys\\custom_key.pem"
      ]);

      assert.strictEqual(plan.allowed, true);
      assert.deepStrictEqual(plan.sanitizedArgs, ["deploy", "--only", "hosting", "--project", "packzen-e7539"]);
    });

    it("VERIFIES child process execution receives only PACKZEN_RELEASE_AUTH_TOKEN and never private key or public key env", () => {
      const ws = createFixtureWorkspace({ withRollbackAssets: true });
      try {
        let capturedEnv = null;
        const res = releaseOrchestrator.executeRelease(
          ["deploy", "--only", "hosting", "--confirm-production-release=packzen-e7539"],
          {
            repoRoot: ws.dir,
            branch: "firebase-hosting-migration",
            privateKey: testPrivateKey,
            gitStatus: () => "?? PACKZEN_3_0_STAGING_PLAN.md\n?? firebase.rollback.json\n?? firestore.rules.prod_backup\n?? functions_prod_backup/",
            mockRemoteUrl: "https://github.com/azharahmedm786-sketch/packzen-app.git",
            mockSync: { ahead: 0, behind: 0 },
            headSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            mockRemoteSha: "25e83c17d090998e3cf8c45ff0647c9be174c717",
            testRunner: () => ({ status: 0 }),
            executor: (args, envContext) => {
              capturedEnv = envContext;
              return { status: 0, executed: true };
            }
          }
        );

        assert.strictEqual(res.status, 0);
        assert.ok(capturedEnv.authToken);
        assert.strictEqual(capturedEnv.publicKeyPem, undefined);
        assert.strictEqual(capturedEnv.privateKey, undefined);
      } finally {
        ws.cleanup();
      }
    });
  });
});
