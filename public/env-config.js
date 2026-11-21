/* ============================================================================
 * PackZen 3.0 — Frontend Environment Configuration & Secure Endpoint Resolver
 * ============================================================================
 * Author: Principal Frontend Security Architect
 * Target: Production (packzen-e7539) & Dedicated Staging (packzen-staging-3)
 *
 * Security Requirements:
 * 1. Production must strictly resolve to packzen-e7539 and asia-south1 endpoints.
 * 2. Staging must strictly resolve to packzen-staging-3 and asia-south1 endpoints.
 * 3. Unknown or ambiguous hostnames/environments MUST fail closed (return null).
 * 4. Staging must NEVER receive or use a Razorpay live key (rzp_live_*).
 * 5. Missing staging test credentials must fail safely with clear diagnostics.
 * 6. Preserves full backward-compatibility for window.ENV properties.
 * 7. Universal module: works in browser scripts and Node.js test environments.
 * ============================================================================ */

(function (root, factory) {
  if (typeof module === "object" && module && module.exports) {
    module.exports = factory();
  } else {
    var instance = factory();
    root.PackZenEnv = instance;
    root.ENV = instance.getLegacyEnv();
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // Production approved hostnames
  var PRODUCTION_HOSTS = [
    "packzenblr.in",
    "www.packzenblr.in",
    "packzen-e7539.web.app",
    "packzen-e7539.firebaseapp.com"
  ];

  // Staging approved hostnames
  var STAGING_HOSTS = [
    "packzen-staging-3.web.app",
    "packzen-staging-3.firebaseapp.com",
    "staging.packzenblr.in"
  ];

  // Local development hostnames
  var DEV_HOSTS = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0"
  ];

  // Static configurations per environment
  var ENV_CONFIGS = {
    production: {
      projectId: "packzen-e7539",
      authDomain: "packzen-e7539.firebaseapp.com",
      storageBucket: "packzen-e7539.firebasestorage.app",
      apiKey: "AIzaSyCNZdOeUlwlI9kwkzD05R1xEy8EyuP8VJo",
      appId: "1:270978358338:web:20827d29d23b654925e1db",
      messagingSenderId: "270978358338",
      measurementId: "G-9JXKP58GP3",
      googleMapsKey: "AIzaSyA0_uDJsx8EqoChj865kWk_vveoPfehdzQ",
      razorpayKey: "rzp_live_THdb3mnINBhYIr",
      appCheckRecaptchaV3SiteKey: "",
      functionsBaseUrl: "https://asia-south1-packzen-e7539.cloudfunctions.net"
    },
    staging: {
      projectId: "packzen-staging-3",
      authDomain: "packzen-staging-3.firebaseapp.com",
      storageBucket: "packzen-staging-3.firebasestorage.app",
      apiKey: "", // Staging Web API key provisioned in Phase 3C
      appId: "",  // Staging Web App ID provisioned in Phase 3C
      messagingSenderId: "",
      measurementId: "",
      googleMapsKey: "", // Staging restricted key or empty
      razorpayKey: "",   // Staging test key (rzp_test_* only); NEVER live
      appCheckRecaptchaV3SiteKey: "",
      functionsBaseUrl: "https://asia-south1-packzen-staging-3.cloudfunctions.net"
    }
  };

  /**
   * Resolve runtime hostname from input or window.location
   */
  function _resolveHostname(overrideHostname) {
    if (typeof overrideHostname === "string" && overrideHostname.trim()) {
      return overrideHostname.trim().toLowerCase();
    }
    if (typeof window !== "undefined" && window.location && typeof window.location.hostname === "string") {
      return window.location.hostname.trim().toLowerCase();
    }
    return "";
  }

  /**
   * Determine environment from hostname
   * Returns: "production" | "staging" | "development" | "unknown"
   */
  function getEnvironment(hostname) {
    var host = _resolveHostname(hostname);
    if (!host) return "unknown";

    // 1. Production hostnames
    for (var i = 0; i < PRODUCTION_HOSTS.length; i++) {
      if (host === PRODUCTION_HOSTS[i]) {
        return "production";
      }
    }

    // 2. Staging hostnames (exact or preview channel suffix)
    for (var j = 0; j < STAGING_HOSTS.length; j++) {
      if (host === STAGING_HOSTS[j]) {
        return "staging";
      }
    }
    if (
      host.endsWith("--packzen-staging-3.web.app") ||
      host.endsWith("--packzen-staging-3.firebaseapp.com")
    ) {
      return "staging";
    }

    // 3. Local development hostnames
    for (var k = 0; k < DEV_HOSTS.length; k++) {
      if (host === DEV_HOSTS[k]) {
        return "development";
      }
    }

    // Unknown or ambiguous environment: FAIL CLOSED
    return "unknown";
  }

  /**
   * Get Cloud Functions base URL
   */
  function getFunctionsBaseUrl(hostname) {
    var env = getEnvironment(hostname);
    if (env === "production") {
      return ENV_CONFIGS.production.functionsBaseUrl;
    }
    if (env === "staging" || env === "development") {
      return ENV_CONFIGS.staging.functionsBaseUrl;
    }
    // Unknown: fail closed
    return null;
  }

  /**
   * Get fully-qualified function URL
   */
  function getFunctionUrl(functionName, hostname) {
    if (!functionName || typeof functionName !== "string") return null;
    var cleanName = functionName.replace(/^\/+/, "");
    if (!cleanName) return null;

    var base = getFunctionsBaseUrl(hostname);
    if (!base) return null; // Fail closed

    return base + "/" + cleanName;
  }

  /**
   * Get Firebase SDK config
   */
  function getFirebaseConfig(hostname) {
    var env = getEnvironment(hostname);
    if (env === "production") {
      return Object.assign({}, ENV_CONFIGS.production);
    }
    if (env === "staging" || env === "development") {
      return Object.assign({}, ENV_CONFIGS.staging);
    }
    // Unknown: fail closed
    return null;
  }

  /**
   * Get Razorpay public key with strict environment validation
   */
  function getRazorpayKey(hostname) {
    var env = getEnvironment(hostname);
    if (env === "production") {
      var prodKey = ENV_CONFIGS.production.razorpayKey;
      if (prodKey && /^rzp_live_[A-Za-z0-9]+$/.test(prodKey)) {
        return prodKey;
      }
      return null;
    }
    if (env === "staging" || env === "development") {
      var stagingKey = ENV_CONFIGS.staging.razorpayKey;
      // HARD SECURITY GATE: Reject any live key in staging!
      if (stagingKey && stagingKey.indexOf("rzp_live_") === 0) {
        if (typeof console !== "undefined" && console.error) {
          console.error("🚨 CRITICAL SECURITY ERROR: Razorpay live key rejected in staging environment!");
        }
        return null;
      }
      if (stagingKey && /^rzp_test_[A-Za-z0-9]+$/.test(stagingKey)) {
        return stagingKey;
      }
      // If not configured, returns empty string (test mode placeholder)
      return "";
    }
    // Unknown: fail closed
    return null;
  }

  /**
   * Validate checkout readiness
   */
  function validateRazorpayCheckout(hostname) {
    var env = getEnvironment(hostname);
    if (env === "unknown") {
      return {
        ok: false,
        key: null,
        isTest: false,
        error: "Checkout is disabled: unknown or unapproved environment."
      };
    }
    if (env === "staging" || env === "development") {
      var key = getRazorpayKey(hostname);
      if (!key) {
        return {
          ok: false,
          key: null,
          isTest: true,
          error: "Staging test mode: Razorpay test credentials (rzp_test_*) are not yet configured. Please select 'Pay on Delivery' or contact support."
        };
      }
      return {
        ok: true,
        key: key,
        isTest: true,
        error: null
      };
    }
    if (env === "production") {
      var liveKey = getRazorpayKey(hostname);
      if (!liveKey) {
        return {
          ok: false,
          key: null,
          isTest: false,
          error: "Payment gateway is temporarily unavailable. Please try again or select 'Pay on Delivery'."
        };
      }
      return {
        ok: true,
        key: liveKey,
        isTest: false,
        error: null
      };
    }
    return {
      ok: false,
      key: null,
      isTest: false,
      error: "Invalid checkout environment."
    };
  }

  /**
   * Get Google Maps Key
   */
  function getGoogleMapsKey(hostname) {
    var env = getEnvironment(hostname);
    if (env === "production") return ENV_CONFIGS.production.googleMapsKey;
    if (env === "staging" || env === "development") return ENV_CONFIGS.staging.googleMapsKey;
    return null;
  }

  /**
   * Build backward-compatible window.ENV object
   */
  function getLegacyEnv(hostname) {
    var env = getEnvironment(hostname);
    var fbCfg = getFirebaseConfig(hostname) || {};
    var rzpKey = getRazorpayKey(hostname) || "";
    var mapsKey = getGoogleMapsKey(hostname) || "";
    var fnBase = getFunctionsBaseUrl(hostname) || "";

    var legacy = {
      GOOGLE_MAPS_KEY: mapsKey,
      FIREBASE_AUTH_KEY: fbCfg.apiKey || "",
      RAZORPAY_KEY: rzpKey,
      APPCHECK_RECAPTCHA_V3_SITE_KEY: fbCfg.appCheckRecaptchaV3SiteKey || "",
      PROJECT_ID: fbCfg.projectId || "",
      FUNCTIONS_BASE_URL: fnBase,
      ENVIRONMENT: env,
      getFunctionUrl: function (name) {
        return getFunctionUrl(name, hostname);
      },
      validateRazorpayCheckout: function () {
        return validateRazorpayCheckout(hostname);
      }
    };

    return legacy;
  }

  return {
    getEnvironment: getEnvironment,
    getFunctionsBaseUrl: getFunctionsBaseUrl,
    getFunctionUrl: getFunctionUrl,
    getFirebaseConfig: getFirebaseConfig,
    getRazorpayKey: getRazorpayKey,
    validateRazorpayCheckout: validateRazorpayCheckout,
    getGoogleMapsKey: getGoogleMapsKey,
    getLegacyEnv: getLegacyEnv,
    _configs: ENV_CONFIGS
  };
});
