/**
 * functions/test/deploy-guard.test.js
 * -------------------------------------------------------------
 * PackZen 3.0 Automated Test Suite for Deployment Target Protection
 *
 * Verifies:
 *  1. Staging project acceptance (packzen-staging-3 and alias 'staging').
 *  2. Production project rejection (packzen-e7539, alias 'production', alias 'default').
 *  3. Unknown/unauthorized project rejection.
 *  4. Missing/ambiguous project rejection.
 *  5. Configuration verification of .firebaserc and firebase.json predeploy hooks.
 *  6. Subprocess execution behavior and exit codes.
 * -------------------------------------------------------------
 */
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { execSync, spawnSync } = require("child_process");
const { describe, it } = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const guardScriptPath = path.join(repoRoot, "scripts/guard-staging-deploy.js");
const guard = require(guardScriptPath);

describe("PACKZEN 3.0 — PHASE 1 DEPLOYMENT TARGET SAFETY GUARD", () => {

  const mockRc = {
    projects: {
      default: "packzen-e7539",
      production: "packzen-e7539",
      staging: "packzen-staging-3"
    }
  };

  describe("1. Target Resolution & Alias Mapping", () => {
    it("resolves alias 'staging' to 'packzen-staging-3'", () => {
      const resolved = guard.resolveProjectAlias("staging", mockRc);
      assert.strictEqual(resolved, "packzen-staging-3");
    });

    it("resolves alias 'production' to 'packzen-e7539'", () => {
      const resolved = guard.resolveProjectAlias("production", mockRc);
      assert.strictEqual(resolved, "packzen-e7539");
    });

    it("resolves alias 'default' to 'packzen-e7539'", () => {
      const resolved = guard.resolveProjectAlias("default", mockRc);
      assert.strictEqual(resolved, "packzen-e7539");
    });

    it("passes through raw project ID if not an alias", () => {
      const resolved = guard.resolveProjectAlias("packzen-staging-3", mockRc);
      assert.strictEqual(resolved, "packzen-staging-3");
    });

    it("extracts target from --project <id> argument", () => {
      const res = guard.resolveDeploymentTarget({
        argv: ["node", "guard.js", "--project", "staging"],
        env: {}
      });
      assert.strictEqual(res.source, "cli-flag");
      assert.strictEqual(res.raw, "staging");
    });

    it("extracts target from --project=<id> syntax", () => {
      const res = guard.resolveDeploymentTarget({
        argv: ["node", "guard.js", "--project=packzen-staging-3"],
        env: {}
      });
      assert.strictEqual(res.source, "cli-flag");
      assert.strictEqual(res.raw, "packzen-staging-3");
    });

    it("extracts target from GCLOUD_PROJECT environment variable", () => {
      const res = guard.resolveDeploymentTarget({
        argv: ["node", "guard.js"],
        env: { GCLOUD_PROJECT: "packzen-staging-3" }
      });
      assert.strictEqual(res.source, "env-GCLOUD_PROJECT");
      assert.strictEqual(res.raw, "packzen-staging-3");
    });

    it("extracts target from FIREBASE_PROJECT environment variable", () => {
      const res = guard.resolveDeploymentTarget({
        argv: ["node", "guard.js"],
        env: { FIREBASE_PROJECT: "staging" }
      });
      assert.strictEqual(res.source, "env-FIREBASE_PROJECT");
      assert.strictEqual(res.raw, "staging");
    });
  });

  describe("2. Project Validation Rules", () => {
    it("ACCEPTS explicit approved staging project ID", () => {
      const result = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-staging-3"],
        env: {}
      });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.projectId, "packzen-staging-3");
    });

    it("ACCEPTS named staging alias", () => {
      const result = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "staging"],
        env: {}
      });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.projectId, "packzen-staging-3");
    });

    it("REJECTS explicit production project ID (packzen-e7539)", () => {
      const result = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "packzen-e7539"],
        env: {}
      });
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.projectId, "packzen-e7539");
      assert.ok(result.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS named production alias", () => {
      const result = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "production"],
        env: {}
      });
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.projectId, "packzen-e7539");
      assert.ok(result.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS default alias when mapped to production", () => {
      const result = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "default"],
        env: {}
      });
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.projectId, "packzen-e7539");
      assert.ok(result.error.includes("FORBIDDEN_PRODUCTION"));
    });

    it("REJECTS unknown or unapproved project ID", () => {
      const result = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js", "--project", "random-corp-test"],
        env: {}
      });
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.projectId, "random-corp-test");
      assert.ok(result.error.includes("UNAUTHORIZED_PROJECT"));
    });

    it("REJECTS missing project configuration", () => {
      const result = guard.validateDeploymentTarget({
        rc: mockRc,
        argv: ["node", "guard.js"],
        env: {}
      });
      // In tests, if argv and env are empty and cwd has active production, it resolves to production and rejects;
      // if completely empty, it rejects with MISSING_PROJECT
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("FORBIDDEN_PRODUCTION") || result.error.includes("MISSING_PROJECT"));
    });
  });

  describe("3. Subprocess CLI Exit Codes", () => {
    it("exits with status 0 for --project packzen-staging-3", () => {
      const res = spawnSync("node", [guardScriptPath, "--project", "packzen-staging-3"], {
        encoding: "utf8",
        cwd: repoRoot
      });
      assert.strictEqual(res.status, 0);
      assert.ok(res.stdout.includes("[GUARD PASS]"));
    });

    it("exits with status 0 for --project staging", () => {
      const res = spawnSync("node", [guardScriptPath, "--project", "staging"], {
        encoding: "utf8",
        cwd: repoRoot
      });
      assert.strictEqual(res.status, 0);
      assert.ok(res.stdout.includes("[GUARD PASS]"));
    });

    it("exits with status 1 for --project packzen-e7539", () => {
      const res = spawnSync("node", [guardScriptPath, "--project", "packzen-e7539"], {
        encoding: "utf8",
        cwd: repoRoot
      });
      assert.strictEqual(res.status, 1);
      assert.ok(res.stderr.includes("FORBIDDEN_PRODUCTION"));
    });

    it("exits with status 1 for --project production", () => {
      const res = spawnSync("node", [guardScriptPath, "--project", "production"], {
        encoding: "utf8",
        cwd: repoRoot
      });
      assert.strictEqual(res.status, 1);
      assert.ok(res.stderr.includes("FORBIDDEN_PRODUCTION"));
    });

    it("exits with status 1 for unauthorized project", () => {
      const res = spawnSync("node", [guardScriptPath, "--project", "unauthorized-project-123"], {
        encoding: "utf8",
        cwd: repoRoot
      });
      assert.strictEqual(res.status, 1);
      assert.ok(res.stderr.includes("UNAUTHORIZED_PROJECT"));
    });
  });

  describe("4. Configuration Consistency (.firebaserc & firebase.json)", () => {
    it(".firebaserc contains production and staging aliases", () => {
      const rc = JSON.parse(fs.readFileSync(path.join(repoRoot, ".firebaserc"), "utf8"));
      assert.strictEqual(rc.projects.default, "packzen-e7539");
      assert.strictEqual(rc.projects.production, "packzen-e7539");
      assert.strictEqual(rc.projects.staging, "packzen-staging-3");
    });

    it("firebase.json contains predeploy guard for hosting", () => {
      const fb = JSON.parse(fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8"));
      assert.ok(Array.isArray(fb.hosting.predeploy));
      assert.ok(fb.hosting.predeploy.some(cmd => cmd.includes("guard-staging-deploy.js")));
    });

    it("firebase.json contains predeploy guard for functions", () => {
      const fb = JSON.parse(fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8"));
      assert.ok(Array.isArray(fb.functions.predeploy));
      assert.ok(fb.functions.predeploy.some(cmd => cmd.includes("guard-staging-deploy.js")));
    });

    it("firebase.json contains predeploy guard for firestore", () => {
      const fb = JSON.parse(fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8"));
      assert.ok(Array.isArray(fb.firestore.predeploy));
      assert.ok(fb.firestore.predeploy.some(cmd => cmd.includes("guard-staging-deploy.js")));
    });

    it("firebase.json contains predeploy guard for storage", () => {
      const fb = JSON.parse(fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8"));
      assert.ok(Array.isArray(fb.storage.predeploy));
      assert.ok(fb.storage.predeploy.some(cmd => cmd.includes("guard-staging-deploy.js")));
    });
  });
});
