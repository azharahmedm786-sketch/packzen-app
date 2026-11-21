/* ============================================================================
 * PackZen 3.0 — Firebase Client Configuration (Partner & Advisor Pages)
 * ============================================================================
 * Author: Principal Frontend Security Architect
 * Target: Production (packzen-e7539) & Dedicated Staging (packzen-staging-3)
 * ============================================================================ */

(function initFirebase() {
  "use strict";

  try {
    if (!window.PackZenEnv && !window.ENV) {
      console.error("❌ env-config.js not loaded! Make sure it's included before firebase-config.js");
      return;
    }

    var env = window.PackZenEnv ? window.PackZenEnv.getEnvironment() : (window.ENV && window.ENV.ENVIRONMENT);
    if (!env || env === "unknown") {
      console.error("❌ Firebase initialization blocked: unknown or unapproved environment (" + (location && location.hostname) + ")");
      return;
    }

    var fbConfig = window.PackZenEnv
      ? window.PackZenEnv.getFirebaseConfig()
      : {
          apiKey: window.ENV && window.ENV.FIREBASE_AUTH_KEY,
          projectId: window.ENV && window.ENV.PROJECT_ID,
          authDomain: (window.ENV && window.ENV.PROJECT_ID) ? window.ENV.PROJECT_ID + ".firebaseapp.com" : "",
          storageBucket: (window.ENV && window.ENV.PROJECT_ID) ? window.ENV.PROJECT_ID + ".firebasestorage.app" : ""
        };

    if (!fbConfig || !fbConfig.projectId) {
      console.error("❌ Firebase initialization blocked: invalid project configuration");
      return;
    }

    // Handle unprovisioned staging environment safely
    if ((env === "staging" || env === "development") && !fbConfig.apiKey) {
      console.warn("⚠️ Staging environment detected (" + fbConfig.projectId + "), but Firebase credentials are not yet provisioned. Awaiting Phase 3C setup.");
      window._firebase = { auth: null, db: null, storage: null, functions: null };
      return;
    }

    // Initialize only if no app currently exists (prevents duplicate initialization)
    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey: fbConfig.apiKey,
        authDomain: fbConfig.authDomain,
        projectId: fbConfig.projectId,
        storageBucket: fbConfig.storageBucket,
        messagingSenderId: fbConfig.messagingSenderId || undefined,
        appId: fbConfig.appId || undefined,
        measurementId: fbConfig.measurementId || undefined
      });
      console.log("✅ Firebase initialized for project: " + fbConfig.projectId);
    } else {
      console.log("ℹ️ Firebase app already initialized: " + firebase.app().name);
    }

    var auth = firebase.auth ? firebase.auth() : null;
    var db = firebase.firestore ? firebase.firestore() : null;
    var storage = firebase.storage ? firebase.storage() : null;
    var functionsRef = firebase.functions ? firebase.app().functions("asia-south1") : null;

    // Make Firebase globally accessible
    window._firebase = { auth: auth, db: db, storage: storage, functions: functionsRef };
    console.log("✅ PackZen Firebase ready (" + fbConfig.projectId + ")!");
  } catch (e) {
    console.error("❌ Firebase init failed:", e);
  }
})();
