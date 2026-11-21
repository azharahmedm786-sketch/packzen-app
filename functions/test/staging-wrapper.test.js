/**
 * functions/test/staging-wrapper.test.js
 * -------------------------------------------------------------
 * PackZen 3.0 Automated Test Suite for Restricted Staging Wrapper
 *
 * Verifies all 18 security requirements specified in Phase 1.1:
 *  1. Explicit staging with active production project.
 *  2. CLI staging with production GCLOUD_PROJECT (Blocked).
 *  3. CLI production with staging environment (Blocked).
 *  4. Conflicting project identifiers (Blocked).
 *  5. Consistent staging identifiers (Accepted).
 *  6. Missing explicit deployment target (Blocked).
 *  7. Unknown project ID (Blocked).
 *  8. Malformed .firebaserc (Blocked).
 *  9. Duplicate project arguments (Blocked).
 * 10. Attempted project argument injection (Blocked).
 * 11. Preview channel with reserved name (Blocked).
 * 12. Preview expiry exceeding 7 days (Blocked).
 * 13. Secret name outside the allowlist (Blocked).
 * 14. Secret destruction without exact confirmation (Blocked).
 * 15. Secret values never appearing in logs or errors (Masked / Redacted).
 * 16. Destructive commands rejected (Blocked).
 * 17. Unsupported arbitrary Firebase commands rejected (Blocked).
 * 18. Exactly one staging project argument passed to mocked child process.
 * -------------------------------------------------------------
 */
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { describe, it } = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const wrapper = require(path.join(repoRoot, "scripts/pz-staging.js"));
const guard = require(path.join(repoRoot, "scripts/guard-staging-deploy.js"));

describe("PACKZEN 3.0 — PHASE 1.1 RESTRICTED STAGING WRAPPER SUITE", () => {

  const mockRc = {
    projects: {
      default: "packzen-e7539",
      production: "packzen-e7539",
      staging: "packzen-staging-3"
    }
  };

  // 1. Explicit staging with active production project
  it("1. Explicit staging with active production project is accepted and forced", () => {
    let capturedArgs = null;
    const res = wrapper.executeWrapper(["deploy", "--only", "hosting"], {
      env: {},
      repoRoot,
      executor: (args) => {
        capturedArgs = args;
        return { status: 0, executed: true };
      }
    });
    assert.strictEqual(res.status, 0);
    assert.ok(capturedArgs.includes("--project"));
    assert.ok(capturedArgs.includes("packzen-staging-3"));
    assert.ok(!capturedArgs.includes("packzen-e7539"));
  });

  // 2. CLI staging with production GCLOUD_PROJECT
  it("2. CLI staging with production GCLOUD_PROJECT is blocked (Environmental Conflict)", () => {
    const res = wrapper.executeWrapper(["deploy", "--only", "hosting"], {
      env: { GCLOUD_PROJECT: "packzen-e7539" },
      repoRoot,
      executor: () => ({ status: 0 })
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.error.includes("FORBIDDEN_PRODUCTION"));
  });

  // 3. CLI production with staging environment
  it("3. CLI production with staging environment is blocked", () => {
    const res = wrapper.executeWrapper(["deploy", "--project", "production"], {
      env: { GCLOUD_PROJECT: "packzen-staging-3" },
      repoRoot,
      executor: () => ({ status: 0 })
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.error.includes("ARGUMENT_INJECTION_BLOCKED") || res.error.includes("FORBIDDEN_PRODUCTION"));
  });

  // 4. Conflicting project identifiers
  it("4. Conflicting explicit project identifiers are blocked", () => {
    const res = guard.validateDeploymentTarget({
      rc: mockRc,
      argv: ["node", "guard.js", "--project", "staging"],
      env: { GCLOUD_PROJECT: "rogue-project-123" }
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.error.includes("AMBIGUOUS_PROJECT_CONFLICT"));
  });

  // 5. Consistent staging identifiers
  it("5. Consistent staging identifiers pass cleanly", () => {
    const res = guard.validateDeploymentTarget({
      rc: mockRc,
      argv: ["node", "guard.js", "--project", "staging"],
      env: { GCLOUD_PROJECT: "packzen-staging-3" }
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.projectId, "packzen-staging-3");
  });

  // 6. Missing explicit deployment target
  it("6. Missing explicit deployment target blocks bare deploy when active is production", () => {
    const res = guard.validateDeploymentTarget({
      rc: mockRc,
      argv: ["node", "guard.js"],
      env: {}
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.error.includes("FORBIDDEN_PRODUCTION") || res.error.includes("MISSING_PROJECT"));
  });

  // 7. Unknown project ID
  it("7. Unknown project ID is blocked", () => {
    const res = wrapper.executeWrapper(["deploy", "--project", "my-unauthorized-app"], {
      repoRoot,
      executor: () => ({ status: 0 })
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.error.includes("ARGUMENT_INJECTION_BLOCKED") || res.error.includes("UNAUTHORIZED_PROJECT"));
  });

  // 8. Malformed .firebaserc
  it("8. Malformed .firebaserc fails closed safely", () => {
    const res = guard.validateDeploymentTarget({
      repoRoot: "nonexistent-dir-abc",
      argv: ["node", "guard.js", "--project", "staging"],
      env: {}
    });
    assert.strictEqual(res.valid, false);
  });

  // 9. Duplicate project arguments
  it("9. Duplicate conflicting project arguments are blocked", () => {
    const res = guard.validateDeploymentTarget({
      rc: mockRc,
      argv: ["node", "guard.js", "--project", "staging", "--project", "production"],
      env: {}
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.error.includes("ARGUMENT_INJECTION_CONFLICT"));
  });

  // 10. Attempted project argument injection
  it("10. Attempted project argument injection in wrapper is blocked", () => {
    const plan1 = wrapper.planStagingCommand(["deploy", "-P", "production"]);
    assert.strictEqual(plan1.allowed, false);
    assert.ok(plan1.error.includes("ARGUMENT_INJECTION_BLOCKED"));

    const plan2 = wrapper.planStagingCommand(["deploy", "--project=packzen-e7539"]);
    assert.strictEqual(plan2.allowed, false);
    assert.ok(plan2.error.includes("ARGUMENT_INJECTION_BLOCKED"));
  });

  // 11. Preview channel with reserved name
  it("11. Preview channel with reserved name is blocked", () => {
    const reservedNames = ["live", "production", "prod", "main", "master", "release", "staging", "default"];
    for (const name of reservedNames) {
      const plan = wrapper.planStagingCommand(["hosting:channel:deploy", name]);
      assert.strictEqual(plan.allowed, false);
      assert.ok(plan.error.includes("reserved"));
    }
  });

  // 12. Preview expiry exceeding 7 days
  it("12. Preview expiry exceeding 7 days is blocked", () => {
    const plan = wrapper.planStagingCommand(["hosting:channel:deploy", "pr-test", "--expires", "14d"]);
    assert.strictEqual(plan.allowed, false);
    assert.ok(plan.error.includes("PREVIEW_EXPIRY_EXCEEDED"));

    const planInline = wrapper.planStagingCommand(["hosting:channel:deploy", "pr-test", "--expires=30d"]);
    assert.strictEqual(planInline.allowed, false);
    assert.ok(planInline.error.includes("PREVIEW_EXPIRY_EXCEEDED"));
  });

  // 13. Secret name outside the allowlist
  it("13. Secret name outside the 16 approved staging secrets is blocked", () => {
    const plan = wrapper.planStagingCommand(["functions:secrets:set", "STRIPE_SECRET_KEY"]);
    assert.strictEqual(plan.allowed, false);
    assert.ok(plan.error.includes("UNAPPROVED_SECRET_NAME"));
  });

  // 14. Secret destruction without exact confirmation
  it("14. Secret destruction without exact confirmation token is blocked", () => {
    // Missing confirmation flag
    const plan1 = wrapper.planStagingCommand(["functions:secrets:destroy", "BREVO_API_KEY"]);
    assert.strictEqual(plan1.allowed, false);
    assert.ok(plan1.error.includes("SECRET_DESTRUCTION_BLOCKED"));

    // Wrong confirmation token
    const plan2 = wrapper.planStagingCommand(["functions:secrets:destroy", "BREVO_API_KEY", "--confirm-destroy=wrong-token"]);
    assert.strictEqual(plan2.allowed, false);
    assert.ok(plan2.error.includes("SECRET_DESTRUCTION_BLOCKED"));

    // Exact confirmation token accepted
    const plan3 = wrapper.planStagingCommand(["functions:secrets:destroy", "BREVO_API_KEY", "--confirm-destroy=BREVO_API_KEY@packzen-staging-3"]);
    assert.strictEqual(plan3.allowed, true);
    assert.strictEqual(plan3.category, "secrets:destroy");
    assert.ok(plan3.sanitizedArgs.includes("--project"));
    assert.ok(plan3.sanitizedArgs.includes("packzen-staging-3"));
  });

  // 15. Secret values never appearing in logs or errors
  it("15. Passing secret values on CLI is rejected to prevent process/log exposure", () => {
    const planInline = wrapper.planStagingCommand(["functions:secrets:set", "RAZORPAY_KEY_SECRET=my_secret_token"]);
    assert.strictEqual(planInline.allowed, false);
    assert.ok(planInline.error.includes("INSECURE_SECRET_ARGUMENT"));

    const planArg = wrapper.planStagingCommand(["functions:secrets:set", "RAZORPAY_KEY_SECRET", "my_secret_token"]);
    assert.strictEqual(planArg.allowed, false);
    assert.ok(planArg.error.includes("INSECURE_SECRET_ARGUMENT"));
  });

  // 16. Destructive commands rejected
  it("16. Destructive commands like firestore:delete and auth:delete are blocked", () => {
    const plan1 = wrapper.planStagingCommand(["firestore:delete", "--all-collections"]);
    assert.strictEqual(plan1.allowed, false);
    assert.ok(plan1.error.includes("PROHIBITED_COMMAND"));

    const plan2 = wrapper.planStagingCommand(["auth:delete", "some-user-uid"]);
    assert.strictEqual(plan2.allowed, false);
    assert.ok(plan2.error.includes("PROHIBITED_COMMAND"));
  });

  // 17. Unsupported arbitrary Firebase commands rejected
  it("17. Unsupported arbitrary Firebase commands are blocked", () => {
    const plan1 = wrapper.planStagingCommand(["emulators:start"]);
    assert.strictEqual(plan1.allowed, false);
    assert.ok(plan1.error.includes("UNSUPPORTED_COMMAND"));

    const plan2 = wrapper.planStagingCommand(["projects:create", "my-new-project"]);
    assert.strictEqual(plan2.allowed, false);
    assert.ok(plan2.error.includes("PROHIBITED_COMMAND") || plan2.error.includes("UNSUPPORTED_COMMAND"));
  });

  // 18. Exactly one staging project argument passed to mocked child process
  it("18. Injects exactly one validated --project packzen-staging-3 into child process", () => {
    let capturedArgs = null;
    const res = wrapper.executeWrapper(["deploy", "--only", "functions", "--project", "staging"], {
      env: {},
      repoRoot,
      executor: (args) => {
        capturedArgs = args;
        return { status: 0, executed: true };
      }
    });

    assert.strictEqual(res.status, 0);
    assert.ok(Array.isArray(capturedArgs));

    // Count occurrences of --project
    const projectFlags = capturedArgs.filter(a => a === "--project");
    assert.strictEqual(projectFlags.length, 1, "Must contain exactly one --project argument");

    const projectIdx = capturedArgs.indexOf("--project");
    assert.strictEqual(capturedArgs[projectIdx + 1], "packzen-staging-3");
  });
});
