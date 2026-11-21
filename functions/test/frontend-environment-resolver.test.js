/**
 * PackZen 3.0 — Phase 3B Frontend Environment Decoupling Unit Tests
 * ----------------------------------------------------------------------------
 * Verifies environment detection, dynamic Cloud Function endpoint resolution,
 * Razorpay key isolation (no live keys in staging), Firebase config separation,
 * and fail-closed security for unknown origins.
 *
 * Execution: node test/frontend-environment-resolver.test.js
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
const PackZenEnv = require(path.join(ROOT_DIR, "public", "env-config.js"));

let passCount = 0;
function test(desc, fn) {
  try {
    fn();
    passCount++;
    console.log(`  PASS  ${desc}`);
  } catch (err) {
    console.error(`  FAIL  ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

console.log("\n=======================================================");
console.log("PACKZEN 3.0 — PHASE 3B FRONTEND ENVIRONMENT RESOLVER");
console.log("=======================================================\n");

// ── 1. Production Endpoint Resolution ─────────────────────────────────────────
console.log("1. Production Endpoint Resolution");

test("1.1 Resolves production environment for packzenblr.in", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("packzenblr.in"), "production");
  assert.strictEqual(
    PackZenEnv.getFunctionsBaseUrl("packzenblr.in"),
    "https://asia-south1-packzen-e7539.cloudfunctions.net"
  );
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("submitLead", "packzenblr.in"),
    "https://asia-south1-packzen-e7539.cloudfunctions.net/submitLead"
  );
});

test("1.2 Resolves production environment for www.packzenblr.in", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("www.packzenblr.in"), "production");
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("createRazorpayOrder", "www.packzenblr.in"),
    "https://asia-south1-packzen-e7539.cloudfunctions.net/createRazorpayOrder"
  );
});

test("1.3 Resolves production environment for packzen-e7539.web.app", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("packzen-e7539.web.app"), "production");
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("verifyRazorpayPayment", "packzen-e7539.web.app"),
    "https://asia-south1-packzen-e7539.cloudfunctions.net/verifyRazorpayPayment"
  );
});

test("1.4 Resolves production environment for packzen-e7539.firebaseapp.com", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("packzen-e7539.firebaseapp.com"), "production");
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("logClientError", "packzen-e7539.firebaseapp.com"),
    "https://asia-south1-packzen-e7539.cloudfunctions.net/logClientError"
  );
});

// ── 2. Staging Endpoint Resolution ───────────────────────────────────────────
console.log("\n2. Staging Endpoint Resolution");

test("2.1 Resolves staging environment for packzen-staging-3.web.app", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("packzen-staging-3.web.app"), "staging");
  assert.strictEqual(
    PackZenEnv.getFunctionsBaseUrl("packzen-staging-3.web.app"),
    "https://asia-south1-packzen-staging-3.cloudfunctions.net"
  );
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("submitLead", "packzen-staging-3.web.app"),
    "https://asia-south1-packzen-staging-3.cloudfunctions.net/submitLead"
  );
});

test("2.2 Resolves staging environment for packzen-staging-3.firebaseapp.com", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("packzen-staging-3.firebaseapp.com"), "staging");
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("createRazorpayOrder", "packzen-staging-3.firebaseapp.com"),
    "https://asia-south1-packzen-staging-3.cloudfunctions.net/createRazorpayOrder"
  );
});

test("2.3 Resolves staging environment for preview channels (*--packzen-staging-3.web.app)", () => {
  const previewHost = "pr-104--packzen-staging-3.web.app";
  assert.strictEqual(PackZenEnv.getEnvironment(previewHost), "staging");
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("verifyRazorpayPayment", previewHost),
    "https://asia-south1-packzen-staging-3.cloudfunctions.net/verifyRazorpayPayment"
  );
});

test("2.4 Resolves staging environment for staging.packzenblr.in", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("staging.packzenblr.in"), "staging");
  assert.strictEqual(
    PackZenEnv.getFunctionUrl("logClientError", "staging.packzenblr.in"),
    "https://asia-south1-packzen-staging-3.cloudfunctions.net/logClientError"
  );
});

// ── 3. Unknown Environment Rejection (Fail Closed) ───────────────────────────
console.log("\n3. Unknown Environment Rejection");

test("3.1 Rejects unknown domains (e.g. evil.com)", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("evil.com"), "unknown");
  assert.strictEqual(PackZenEnv.getFunctionsBaseUrl("evil.com"), null);
  assert.strictEqual(PackZenEnv.getFunctionUrl("submitLead", "evil.com"), null);
  assert.strictEqual(PackZenEnv.getFirebaseConfig("evil.com"), null);
  assert.strictEqual(PackZenEnv.getRazorpayKey("evil.com"), null);
});

test("3.2 Rejects spoofed or phishing subdomains", () => {
  assert.strictEqual(PackZenEnv.getEnvironment("packzenblr.in.evil.com"), "unknown");
  assert.strictEqual(PackZenEnv.getEnvironment("packzen-e7539.phishing.site"), "unknown");
  assert.strictEqual(PackZenEnv.getEnvironment("evil-packzen-staging-3.web.app.attacker.com"), "unknown");
  assert.strictEqual(PackZenEnv.getFunctionUrl("createRazorpayOrder", "packzenblr.in.evil.com"), null);
});

test("3.3 Rejects empty, null, or undefined hostnames", () => {
  assert.strictEqual(PackZenEnv.getEnvironment(""), "unknown");
  assert.strictEqual(PackZenEnv.getEnvironment(null), "unknown");
  assert.strictEqual(PackZenEnv.getEnvironment(undefined), "unknown");
  assert.strictEqual(PackZenEnv.getFunctionsBaseUrl(""), null);
});

// ── 4. No Production Fallback from Staging ────────────────────────────────────
console.log("\n4. No Production Fallback from Staging");

test("4.1 Staging URLs never contain packzen-e7539", () => {
  const stagingHosts = [
    "packzen-staging-3.web.app",
    "packzen-staging-3.firebaseapp.com",
    "qa-feature--packzen-staging-3.web.app",
    "staging.packzenblr.in"
  ];
  for (const host of stagingHosts) {
    const url = PackZenEnv.getFunctionUrl("anyFunction", host);
    assert.ok(url.includes("packzen-staging-3"), `Expected staging in ${url}`);
    assert.ok(!url.includes("packzen-e7539"), `Found production project in staging URL: ${url}`);
  }
});

test("4.2 Invalid function names return null and never fallback", () => {
  assert.strictEqual(PackZenEnv.getFunctionUrl("", "packzen-staging-3.web.app"), null);
  assert.strictEqual(PackZenEnv.getFunctionUrl(null, "packzen-staging-3.web.app"), null);
});

// ── 5. Correct Firebase Project Configuration ────────────────────────────────
console.log("\n5. Correct Firebase Project Configuration");

test("5.1 Production Firebase config matches packzen-e7539", () => {
  const cfg = PackZenEnv.getFirebaseConfig("packzenblr.in");
  assert.strictEqual(cfg.projectId, "packzen-e7539");
  assert.strictEqual(cfg.authDomain, "packzen-e7539.firebaseapp.com");
  assert.strictEqual(cfg.storageBucket, "packzen-e7539.firebasestorage.app");
  assert.strictEqual(cfg.apiKey, "AIzaSyCNZdOeUlwlI9kwkzD05R1xEy8EyuP8VJo");
});

test("5.2 Staging Firebase config matches packzen-staging-3", () => {
  const cfg = PackZenEnv.getFirebaseConfig("packzen-staging-3.web.app");
  assert.strictEqual(cfg.projectId, "packzen-staging-3");
  assert.strictEqual(cfg.authDomain, "packzen-staging-3.firebaseapp.com");
  assert.strictEqual(cfg.storageBucket, "packzen-staging-3.firebasestorage.app");
  // Staging API key remains unprovisioned until Phase 3C setup
  assert.strictEqual(cfg.apiKey, "");
});

// ── 6. No Live Razorpay Key in Staging ───────────────────────────────────────
console.log("\n6. No Live Razorpay Key in Staging");

test("6.1 Production returns live Razorpay key starting with rzp_live_", () => {
  const key = PackZenEnv.getRazorpayKey("packzenblr.in");
  assert.ok(key.startsWith("rzp_live_"), `Expected live key, got ${key}`);
  assert.strictEqual(key, "rzp_live_THdb3mnINBhYIr");
});

test("6.2 Staging never returns a live Razorpay key", () => {
  const key = PackZenEnv.getRazorpayKey("packzen-staging-3.web.app");
  assert.ok(!key || !key.startsWith("rzp_live_"), "Staging returned live key!");
});

test("6.3 Hard security gate: Rejects injected live key in staging configuration", () => {
  // Simulate accidental injection of live key into staging config
  const originalKey = PackZenEnv._configs.staging.razorpayKey;
  PackZenEnv._configs.staging.razorpayKey = "rzp_live_ACCIDENTAL_INJECTION";
  try {
    const key = PackZenEnv.getRazorpayKey("packzen-staging-3.web.app");
    assert.strictEqual(key, null, "Live key must be strictly rejected in staging!");

    const validation = PackZenEnv.validateRazorpayCheckout("packzen-staging-3.web.app");
    assert.strictEqual(validation.ok, false, "Checkout must fail if live key is present in staging");
  } finally {
    PackZenEnv._configs.staging.razorpayKey = originalKey;
  }
});

// ── 7. Missing Staging Test Credentials Fail Safely ──────────────────────────
console.log("\n7. Missing Staging Test Credentials Fail Safely");

test("7.1 Unconfigured staging checkout fails safely with clear diagnostic", () => {
  const validation = PackZenEnv.validateRazorpayCheckout("packzen-staging-3.web.app");
  assert.strictEqual(validation.ok, false);
  assert.strictEqual(validation.isTest, true);
  assert.strictEqual(validation.key, null);
  assert.ok(
    validation.error.includes("Staging test mode"),
    `Expected staging test mode diagnostic, got: ${validation.error}`
  );
});

test("7.2 Configured staging test key succeeds and flags test mode", () => {
  const originalKey = PackZenEnv._configs.staging.razorpayKey;
  PackZenEnv._configs.staging.razorpayKey = "rzp_test_StagingKey123";
  try {
    const validation = PackZenEnv.validateRazorpayCheckout("packzen-staging-3.web.app");
    assert.strictEqual(validation.ok, true);
    assert.strictEqual(validation.isTest, true);
    assert.strictEqual(validation.key, "rzp_test_StagingKey123");
    assert.strictEqual(validation.error, null);
  } finally {
    PackZenEnv._configs.staging.razorpayKey = originalKey;
  }
});

// ── 8. Duplicate App Initialization Prevention ───────────────────────────────
console.log("\n8. Duplicate App Initialization Prevention");

test("8.1 Firebase config script protects against duplicate initialization", () => {
  const fbConfigContent = fs.readFileSync(path.join(ROOT_DIR, "public", "firebase-config.js"), "utf8");
  assert.ok(
    fbConfigContent.includes("if (!firebase.apps.length)"),
    "firebase-config.js must check firebase.apps.length before calling initializeApp"
  );
  assert.ok(
    fbConfigContent.includes("Firebase app already initialized"),
    "firebase-config.js must log when app is already initialized"
  );
});

// ── 9. Existing Production Behavior Compatibility ────────────────────────────
console.log("\n9. Existing Production Behavior Compatibility");

test("9.1 getLegacyEnv returns exact production window.ENV shape and values", () => {
  const env = PackZenEnv.getLegacyEnv("packzenblr.in");
  assert.strictEqual(env.GOOGLE_MAPS_KEY, "AIzaSyA0_uDJsx8EqoChj865kWk_vveoPfehdzQ");
  assert.strictEqual(env.FIREBASE_AUTH_KEY, "AIzaSyCNZdOeUlwlI9kwkzD05R1xEy8EyuP8VJo");
  assert.strictEqual(env.RAZORPAY_KEY, "rzp_live_THdb3mnINBhYIr");
  assert.strictEqual(env.PROJECT_ID, "packzen-e7539");
  assert.strictEqual(env.ENVIRONMENT, "production");
  assert.strictEqual(typeof env.getFunctionUrl, "function");
  assert.strictEqual(typeof env.validateRazorpayCheckout, "function");
});

test("9.2 Production checkout validation passes with live key", () => {
  const validation = PackZenEnv.validateRazorpayCheckout("packzenblr.in");
  assert.strictEqual(validation.ok, true);
  assert.strictEqual(validation.isTest, false);
  assert.strictEqual(validation.key, "rzp_live_THdb3mnINBhYIr");
});

// ── 10. No Hardcoded Production Function URLs in Code ────────────────────────
console.log("\n10. Static Scan: No Uncontrolled Hardcoded Production Function URLs");

test("10.1 Scans all frontend scripts for uncontrolled production endpoint URLs", () => {
  function walk(dir) {
    let results = [];
    fs.readdirSync(dir).forEach((file) => {
      const full = path.join(dir, file);
      if (fs.statSync(full).isDirectory()) results = results.concat(walk(full));
      else results.push(full);
    });
    return results;
  }

  const publicFiles = walk(path.join(ROOT_DIR, "public")).filter(
    (f) => f.endsWith(".js") || f.endsWith(".html")
  );

  const violations = [];

  for (const filePath of publicFiles) {
    const rel = path.relative(ROOT_DIR, filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    lines.forEach((line, idx) => {
      // Ignore comments, env-config.js declaration, and approved hostname guard checks
      if (line.includes("asia-south1-packzen-e7539.cloudfunctions.net")) {
        const isGuarded =
          line.includes("packzenblr.in") ||
          line.includes("production:") ||
          line.includes("functionsBaseUrl:") ||
          filePath.endsWith("env-config.js");
        if (!isGuarded) {
          violations.push(`${rel}:${idx + 1}: ${line.trim()}`);
        }
      }
    });
  }

  assert.strictEqual(
    violations.length,
    0,
    `Found uncontrolled hardcoded production Function URLs:\n${violations.join("\n")}`
  );
});

console.log("\n-------------------------------------------------------");
console.log(`ALL ${passCount} FRONTEND ENVIRONMENT RESOLVER TESTS PASSED`);
console.log("-------------------------------------------------------\n");
