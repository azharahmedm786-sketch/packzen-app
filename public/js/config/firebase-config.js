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
