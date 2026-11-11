/**
 * CSP and Firebase App Check Integrity Test Suite
 * Validates script inclusions, SDK versions, CSP domain whitelisting,
 * and secret separation across all 24 Firebase pages.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PUB = path.join(ROOT, "public");

const PAGES_961 = [
  "index.html",
  "admin.html",
  "driver.html",
  "registration-success.html",
  "services.html",
  "quote.html",
  "partner.html",
  "partner-login.html",
  "partner-forgot-password.html",
  "partner-register.html",
  "partner-dashboard.html",
  "partner-bookings.html",
  "partner-booking-details.html",
  "partner-crew-app.html",
  "partner-drivers.html",
  "partner-earnings.html",
  "partner-notifications.html",
  "partner-profile.html",
  "partner-settings.html",
  "partner-support.html",
  "partner-vehicles.html",
  "partner-wallet.html"
];

const PAGES_923 = [
  "advisor.html",
  "delete-account.html"
];

const ALL_24_PAGES = [...PAGES_961, ...PAGES_923];

let passCount = 0;
function test(desc, fn) {
  try {
    fn();
    passCount++;
    console.log("  PASS  " + desc);
  } catch (e) {
    console.error("  FAIL  " + desc, e);
    throw e;
  }
}

console.log("Running CSP and Firebase App Check Integrity Tests...");

test("1. All 24 pages include matching firebase-app-check-compat.js script tag", () => {
  for (const page of PAGES_961) {
    const content = fs.readFileSync(path.join(PUB, page), "utf8");
    assert.ok(
      content.includes("https://www.gstatic.com/firebasejs/9.6.1/firebase-app-check-compat.js"),
      `${page} missing 9.6.1 firebase-app-check-compat.js`
    );
  }

  for (const page of PAGES_923) {
    const content = fs.readFileSync(path.join(PUB, page), "utf8");
    assert.ok(
      content.includes("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-check-compat.js"),
      `${page} missing 9.23.0 firebase-app-check-compat.js`
    );
  }
});

test("2. App Check script tag follows immediately after firebase-app-compat.js", () => {
  for (const page of ALL_24_PAGES) {
    const content = fs.readFileSync(path.join(PUB, page), "utf8");
    const appCompatIdx = content.indexOf("firebase-app-compat.js");
    const appCheckIdx = content.indexOf("firebase-app-check-compat.js");
    assert.ok(appCompatIdx !== -1, `${page} missing firebase-app-compat.js`);
    assert.ok(appCheckIdx !== -1, `${page} missing firebase-app-check-compat.js`);
    assert.ok(
      appCheckIdx > appCompatIdx,
      `${page}: app-check-compat (${appCheckIdx}) must come after app-compat (${appCompatIdx})`
    );
    // Must be close in order (within 200 chars)
    assert.ok(
      (appCheckIdx - appCompatIdx) < 200,
      `${page}: app-check-compat should immediately follow app-compat`
    );
  }
});

test("3. Pages with Content-Security-Policy include all required reCAPTCHA and App Check domains", () => {
  const reqScript = ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"];
  const reqFrame = ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/"];
  const reqConnect = ["https://content-firebaseappcheck.googleapis.com", "https://www.google.com/recaptcha/"];

  for (const page of ALL_24_PAGES) {
    const content = fs.readFileSync(path.join(PUB, page), "utf8");
    const cspMatch = content.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    if (!cspMatch) continue;

    const csp = cspMatch[1];
    for (const domain of reqScript) {
      assert.ok(csp.includes(domain), `${page} CSP missing ${domain} in script-src`);
    }
    for (const domain of reqFrame) {
      assert.ok(csp.includes(domain), `${page} CSP missing ${domain} in frame-src`);
    }
    for (const domain of reqConnect) {
      assert.ok(csp.includes(domain), `${page} CSP missing ${domain} in connect-src`);
    }
  }
});

test("4. public/firebase-config.js initializes App Check with ReCaptchaV3Provider in monitoring mode", () => {
  const fbConfig = fs.readFileSync(path.join(PUB, "firebase-config.js"), "utf8");
  assert.ok(fbConfig.includes("firebase.appCheck"), "firebase-config.js must reference firebase.appCheck");
  assert.ok(
    fbConfig.includes("new firebase.appCheck.ReCaptchaV3Provider"),
    "firebase-config.js must use ReCaptchaV3Provider"
  );
  assert.ok(
    fbConfig.includes("self.FIREBASE_APPCHECK_DEBUG_TOKEN = true"),
    "firebase-config.js must configure debug token on localhost"
  );
  assert.ok(
    fbConfig.includes("APPCHECK_RECAPTCHA_V3_SITE_KEY"),
    "firebase-config.js must read window.ENV.APPCHECK_RECAPTCHA_V3_SITE_KEY"
  );
});

test("5. public/env-config.js defines APPCHECK_RECAPTCHA_V3_SITE_KEY without exposing secret keys", () => {
  const envConfig = fs.readFileSync(path.join(PUB, "env-config.js"), "utf8");
  assert.ok(
    envConfig.includes("APPCHECK_RECAPTCHA_V3_SITE_KEY"),
    "env-config.js must define APPCHECK_RECAPTCHA_V3_SITE_KEY"
  );
  assert.ok(!envConfig.includes("RECAPTCHA_SECRET_KEY"), "env-config.js must never contain a secret key");
  assert.ok(!envConfig.includes("SECRET"), "env-config.js must never contain server secrets");
});

test("6. firestore.rules explicitly locks bookingIdempotency and emailOutbox to server-only", () => {
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  assert.ok(
    /match \/bookingIdempotency\/\{docId\}\s*\{\s*allow read, write:\s*if false;\s*\}/.test(rules),
    "firestore.rules must lock bookingIdempotency"
  );
  assert.ok(
    /match \/emailOutbox\/\{docId\}\s*\{\s*allow read, write:\s*if false;\s*\}/.test(rules),
    "firestore.rules must lock emailOutbox"
  );
});

console.log(`\nAll ${passCount} CSP and Firebase App Check integrity tests passed!`);
