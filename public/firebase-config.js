/* ================================================
firebase-config.js — PackZen
FIXED: Removed duplicate SDK loading (was loading v10.12.0
on top of v9.6.1 already loaded in HTML, causing conflicts)
================================================ */
(function initFirebase() {
  try {
    if (!window.ENV) {
      console.error("❌ env-config.js not loaded! Make sure it's included before firebase-config.js");
      return;
    }
    if (!window.ENV.FIREBASE_AUTH_KEY) {
      console.error("❌ FIREBASE_AUTH_KEY not found in env-config.js!");
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey: window.ENV.FIREBASE_AUTH_KEY,
        authDomain: "packzen-e7539.firebaseapp.com",
        projectId: "packzen-e7539",
        storageBucket: "packzen-e7539.firebasestorage.app",
        messagingSenderId: "270978358338",
        appId: "1:270978358338:web:20827d29d23b654925e1db",
        measurementId: "G-9JXKP58GP3"
      });
      console.log("✅ Firebase initialized with Auth API key");
    }

    // ── Firebase App Check (Monitoring Mode Only) ──────────────────────────────
    try {
      if (window.firebase && firebase.appCheck && window.ENV && window.ENV.APPCHECK_RECAPTCHA_V3_SITE_KEY) {
        // Local development auto-debug token generation (localhost only)
        const isLocalhost = (
          location.hostname === "localhost" ||
          location.hostname === "127.0.0.1"
        );
        if (isLocalhost && typeof self.FIREBASE_APPCHECK_DEBUG_TOKEN === "undefined") {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }

        const provider = new firebase.appCheck.ReCaptchaV3Provider(window.ENV.APPCHECK_RECAPTCHA_V3_SITE_KEY);

        firebase.appCheck().activate(
          provider,
          /* isTokenAutoRefreshEnabled */ true
        );
        console.log("✅ App Check activated in monitoring mode (reCAPTCHA v3)");
      }
    } catch (err) {
      console.warn("⚠️ App Check initialization skipped or failed:", err);
    }

 const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage ? firebase.storage() : null;
    const functionsRef = firebase.functions ? firebase.app().functions("asia-south1") : null;

    // Make Firebase globally accessible
    window._firebase = { auth, db, storage, functions: functionsRef };
    console.log("✅ PackZen Firebase ready!");
  } catch (e) {
    console.error("❌ Firebase init failed:", e);
  }
})();
