/* ============================================================
   OAUTH PROFILE SYNC — PackZen
   Handles Firestore profile creation/merge for Google & Apple
   sign-in. Runs entirely server-side with the Admin SDK so it
   never needs a client-side `where("email","==",...)` query
   across the /users collection (which Firestore Security Rules
   correctly reject — a signed-in user can only read/write their
   OWN user doc, not query the whole collection by email).

   Provider identity is read from the verified Firebase Auth ID
   token (context.auth.token.firebase.sign_in_provider), never
   trusted from client input — this is what Phase 4 of the audit
   requires: provider detection must come from Firebase Auth, not
   from data the client hands us.
   ============================================================ */
const functions = require("firebase-functions");
const admin     = require("firebase-admin");

const PROVIDER_MAP = { "google.com": "google", "apple.com": "apple" };

exports.syncOAuthUserProfile = functions
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = context.auth.uid;
    const signInProvider = context.auth.token?.firebase?.sign_in_provider || "";
    const providerName = PROVIDER_MAP[signInProvider];
    if (!providerName) {
      // Not an OAuth sign-in (e.g. password/custom-token) — nothing to sync here.
      throw new functions.https.HttpsError("failed-precondition", "Not an OAuth sign-in.");
    }

    const db = admin.firestore();
    const userRecord = await admin.auth().getUser(uid);
    const userRef = db.collection("users").doc(uid);
    const existingDoc = await userRef.get();

    // Case 1 — profile already exists at this UID (returning OAuth user).
    if (existingDoc.exists) {
      const role = existingDoc.data().role || "customer";
      if (role !== "customer") return { role }; // never touch a driver/admin/advisor/partner doc further
      await userRef.update({
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        loginMethod: providerName
      });
      return { role };
    }

    // Case 2 — no doc at this UID yet. Look for a pre-existing profile with
    // the same (Firebase-verified) email — e.g. someone who signed up with
    // a password and is now using "Continue with Google" for the first
    // time. Safe here because this is an Admin SDK read in a trusted
    // server context, not a client-side collection query.
    const email = userRecord.email;
    if (email) {
      const emailSnap = await db.collection("users").where("email", "==", email).limit(1).get();
      if (!emailSnap.empty) {
        const existingData = emailSnap.docs[0].data();
        const oldDocId = emailSnap.docs[0].id;
        const role = existingData.role || "customer";
        if (role !== "customer") return { role }; // do NOT migrate/delete a driver, admin, advisor, or partner doc
        await userRef.set({
          ...existingData,
          loginMethod: providerName,
          [`${providerName}Linked`]: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        if (oldDocId !== uid) await db.collection("users").doc(oldDocId).delete().catch(() => {});
        return { role };
      }
    }

    // Case 3 — brand new user, create a fresh customer profile.
    const refCode = uid.slice(0, 8).toUpperCase();
    await userRef.set({
      name: userRecord.displayName || (email ? email.split("@")[0] : "PackZen User"),
      email: email || "",
      phone: userRecord.phoneNumber || "",
      role: "customer",
      loginMethod: providerName,
      phoneVerified: false,
      emailVerified: !!userRecord.emailVerified,
      prefEmail: true,
      prefSMS: true,
      referralCode: refCode,
      referralCount: 0,
      referralCredits: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { role: "customer" };
  });
