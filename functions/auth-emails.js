/* ============================================================
   AUTH EMAILS — PackZen
   All auth-adjacent emails (signup OTP, email verification,
   password reset, email change) route through Brevo via
   brevo-client.js. No Firebase Auth account is created until
   verifySignupOtpBrevo succeeds — see that function below for
   the full server-side signup flow.
   ============================================================ */
const functions = require("firebase-functions/v1");
const admin     = require("firebase-admin");
const { defineString } = require("firebase-functions/params");
const { sendBrevoEmail, BREVO_SECRETS } = require("./brevo-client");
const { logNotification } = require("./notification-service");
const crypto = require("crypto");

const ACTION_URL       = defineString("PACKZEN_ACTION_URL", { default: "https://packzenblr.in/" });
const PACKZEN_LOGO_URL = defineString("PACKZEN_LOGO_URL", { default: "https://packzenblr.in/assets/logo/packzen-logo.png" });

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{10}$/;
const OTP_EXPIRY_MS = 10 * 60 * 1000;

/* ── EMAIL TEMPLATE (green branding, mobile responsive) ── */
function buildEmailHtml({ preheader, heading, bodyLines, ctaLabel, ctaUrl }) {
  const year = new Date().getFullYear();
  const paragraphs = bodyLines
    .map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5a6a8a">${p}</p>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${heading}</title>
<style>@media only screen and (max-width:600px){.pz-container{width:100% !important}.pz-padding{padding:24px !important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f7ff;font-family:'Manrope',Arial,sans-serif">
  <span style="display:none;font-size:1px;color:#f4f7ff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader || ""}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7ff;padding:32px 0">
    <tr><td align="center">
      <table role="presentation" class="pz-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,60,180,.08)">
        <tr><td style="background:#00c96e;padding:28px 32px;text-align:center">
          <img src="${PACKZEN_LOGO_URL.value()}" alt="PackZen" width="40" height="40" style="display:block;margin:0 auto 8px;border-radius:8px">
          <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">PackZen</span>
        </td></tr>
        <tr><td class="pz-padding" style="padding:36px 40px">
          <h1 style="margin:0 0 18px;font-size:21px;font-weight:800;color:#1a2744;font-family:Arial,sans-serif">${heading}</h1>
          ${paragraphs}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px">
            <tr><td style="border-radius:30px;background:#00c96e">
              <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:30px;font-family:Arial,sans-serif">${ctaLabel}</a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:12.5px;line-height:1.6;color:#8a9bbf">If the button above doesn't work, copy and paste this link into your browser:<br>
            <a href="${ctaUrl}" style="color:#00c96e;word-break:break-all">${ctaUrl}</a></p>
        </td></tr>
        <tr><td style="padding:24px 40px;background:#f4f7ff;border-top:1px solid #dde4f5;text-align:center">
          <p style="margin:0 0 6px;font-size:12.5px;color:#5a6a8a">Need help? Contact us at <a href="mailto:support@packzenblr.in" style="color:#00c96e;text-decoration:none">support@packzenblr.in</a></p>
          <p style="margin:0 0 6px;font-size:12.5px;color:#5a6a8a">📞 +91 99450 95453 &nbsp;·&nbsp; Bangalore, Karnataka</p>
          <p style="margin:12px 0 0;font-size:11.5px;color:#8a9bbf">© ${year} PackZen Packers &amp; Movers. All Rights Reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function stripHtml(str) { return String(str).replace(/<[^>]*>/g, ""); }

function buildEmailText({ heading, bodyLines, ctaLabel, ctaUrl }) {
  const year = new Date().getFullYear();
  return [
    heading, "",
    bodyLines.map(stripHtml).join("\n\n"), "",
    `${ctaLabel} ${ctaUrl}`, "",
    "---",
    "Need help? Contact us at support@packzenblr.in",
    "PackZen Packers & Movers — Bangalore, Karnataka",
    `© ${year} PackZen Packers & Movers. All Rights Reserved.`
  ].join("\n");
}

/* ── RATE LIMITING — Firestore-backed, per email + type ── */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

async function enforceRateLimit(type, email) {
  const db  = admin.firestore();
  const key = `${type}_${email.toLowerCase()}`;
  const ref = db.collection("authEmailRateLimits").doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    let windowStart = data?.windowStart || 0;
    let count = data?.count || 0;

    if (now - windowStart > RATE_LIMIT_WINDOW_MS) { windowStart = now; count = 0; }

    if (count >= RATE_LIMIT_MAX_REQUESTS) {
      const retryAfterMin = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - windowStart)) / 60000);
      throw new functions.https.HttpsError("resource-exhausted", `Too many requests. Please try again in ${retryAfterMin} minute(s).`);
    }
    tx.set(ref, { windowStart, count: count + 1, updatedAt: now }, { merge: true });
  });
}

/* ── SEND + LOG (reuses notification-service.js's logNotification) ── */
async function sendAuthEmail(type, toEmail, toName, subject, emailContent) {
  const result = await sendBrevoEmail({
    toEmail, toName, subject,
    htmlContent: buildEmailHtml(emailContent),
    textContent: buildEmailText(emailContent)
  });
  await logNotification({
    bookingRef: null,
    channel: `auth_${type}`,
    recipient: toEmail,
    status: result.success ? "sent" : "failed",
    provider: "brevo",
    response: result.response,
    error: result.error
  });
  if (!result.success) {
    if (result.retryable) throw new functions.https.HttpsError("unavailable", "Email service temporarily unavailable. Please try again.");
    throw new functions.https.HttpsError("internal", result.error || "Failed to send email.");
  }
  return result;
}

/* ════════════════════════════════════════════════════════════
   PHASE 0a — SEND SIGNUP OTP
   No Firebase Auth account or Firestore doc exists at this
   point. Duplicate checks here are fast-feedback only — the
   authoritative, race-safe checks happen in verifySignupOtpBrevo
   below, at the moment the account is actually created.
   ════════════════════════════════════════════════════════════ */
exports.sendSignupOtpBrevo = functions
  .runWith({ secrets: BREVO_SECRETS })
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    const email = (data?.email || "").trim().toLowerCase();
    const name  = (data?.name || "").trim();
    const phone = (data?.phone || "").trim();

    if (!EMAIL_REGEX.test(email)) throw new functions.https.HttpsError("invalid-argument", "A valid email is required.");
    if (phone && !PHONE_REGEX.test(phone)) throw new functions.https.HttpsError("invalid-argument", "A valid 10-digit phone number is required.");

    try {
      await admin.auth().getUserByEmail(email);
      throw new functions.https.HttpsError("already-exists", "auth/email-already-in-use");
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    if (phone) {
      const phoneSnap = await admin.firestore().collection("phoneIndex").doc("+91" + phone).get();
      if (phoneSnap.exists) throw new functions.https.HttpsError("already-exists", "auth/phone-already-in-use");
    }

    await enforceRateLimit("signup_otp", email);

    const otp = String(crypto.randomInt(100000, 999999));
    await admin.firestore().collection("signupOtps").doc(email).set({
      otp, expiresAt: Date.now() + OTP_EXPIRY_MS, attempts: 0, createdAt: Date.now()
    });

    await sendAuthEmail("signup_otp", email, name, "Your PackZen verification code", {
      preheader: `Your PackZen verification code is ${otp}.`,
      heading: `Verify your email, ${name || "there"}`,
      bodyLines: [
        `Your verification code is: <strong style="font-size:24px;letter-spacing:4px">${otp}</strong>`,
        "Enter this code to finish creating your PackZen account. This code expires in 10 minutes."
      ],
      ctaLabel: "Go to PackZen →", ctaUrl: ACTION_URL.value()
    });
    return { success: true };
  });

/* ════════════════════════════════════════════════════════════
   PHASE 0b — VERIFY OTP + CREATE ACCOUNT (server side, only path)
   This is the ONLY place a PackZen Firebase Auth account or
   users/{uid} Firestore doc gets created. The client never calls
   createUserWithEmailAndPassword directly. Steps:
     1. Atomically validate + consume the OTP (Firestore txn).
     2. Atomically reserve the phone number (Firestore txn) so two
        concurrent signups can never claim the same phone.
     3. Create the Firebase Auth user (Firebase Auth itself
        guarantees email uniqueness atomically).
     4. Write the Firestore profile.
     5. On any failure after step 3, roll back what was created so
        nothing orphaned is left behind.
     6. Return a custom token — the client signs in with it instead
        of creating the account itself.
   ════════════════════════════════════════════════════════════ */
exports.verifySignupOtpBrevo = functions
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    const email     = (data?.email || "").trim().toLowerCase();
    const otp       = (data?.otp || "").trim();
    const password  = data?.password || "";
    const firstName = (data?.firstName || "").trim();
    const lastName  = (data?.lastName || "").trim();
    const phone     = (data?.phone || "").trim();
    const referral  = (data?.referral || "").trim().toUpperCase();

    if (!EMAIL_REGEX.test(email)) throw new functions.https.HttpsError("invalid-argument", "A valid email is required.");
    if (!otp) throw new functions.https.HttpsError("invalid-argument", "OTP is required.");
    if (!password || password.length < 6) throw new functions.https.HttpsError("invalid-argument", "Password must be at least 6 characters.");
    if (!firstName || !lastName) throw new functions.https.HttpsError("invalid-argument", "First and last name are required.");
    if (!PHONE_REGEX.test(phone)) throw new functions.https.HttpsError("invalid-argument", "A valid 10-digit phone number is required.");

    const db = admin.firestore();
    const otpRef = db.collection("signupOtps").doc(email);

    // Step 1 — validate + single-use consume, atomically.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(otpRef);
      if (!snap.exists) throw new functions.https.HttpsError("not-found", "No OTP request found. Please request a new code.");
      const record = snap.data();
      if (Date.now() > record.expiresAt) { tx.delete(otpRef); throw new functions.https.HttpsError("deadline-exceeded", "OTP expired. Please request a new code."); }
      if ((record.attempts || 0) >= 5) { tx.delete(otpRef); throw new functions.https.HttpsError("resource-exhausted", "Too many incorrect attempts. Please request a new code."); }
      if (record.otp !== otp) { tx.update(otpRef, { attempts: (record.attempts || 0) + 1 }); throw new functions.https.HttpsError("invalid-argument", "Incorrect code. Please try again."); }
      tx.delete(otpRef);
    });

    const fullName = `${firstName} ${lastName}`;
    const phoneKey = "+91" + phone;
    const phoneRef = db.collection("phoneIndex").doc(phoneKey);

    // Step 2 — reserve the phone number atomically.
    await db.runTransaction(async (tx) => {
      const phoneSnap = await tx.get(phoneRef);
      if (phoneSnap.exists) throw new functions.https.HttpsError("already-exists", "auth/phone-already-in-use");
      tx.set(phoneRef, { status: "reserved", reservedAt: Date.now() });
    });

    // Step 3 — create the Auth account. Firebase Auth enforces email
    // uniqueness atomically, so a genuine race on email is resolved here.
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({ email, password, displayName: fullName, emailVerified: true });
    } catch (err) {
      await phoneRef.delete().catch(() => {});
      if (err.code === "auth/email-already-exists") throw new functions.https.HttpsError("already-exists", "auth/email-already-in-use");
      console.error("verifySignupOtpBrevo — createUser failed:", err);
      throw new functions.https.HttpsError("internal", err.message || "Account creation failed.");
    }

    // Step 4 — Firestore profile + finalize phone reservation.
    try {
      const refCode = userRecord.uid.slice(0, 8).toUpperCase();
      await phoneRef.set({ status: "active", uid: userRecord.uid, phone: phoneKey }, { merge: true });
      await db.collection("users").doc(userRecord.uid).set({
        firstName, lastName, name: fullName, email, phone: phoneKey,
        role: "customer", phoneVerified: false, emailVerified: true,
        prefEmail: true, prefSMS: true,
        referralCode: refCode, referralCount: 0, referralCredits: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (referral) {
        try {
          const refSnap = await db.collection("users").where("referralCode", "==", referral).limit(1).get();
          if (!refSnap.empty && refSnap.docs[0].id !== userRecord.uid) {
            await refSnap.docs[0].ref.update({
              referralCount: admin.firestore.FieldValue.increment(1),
              referralCredits: admin.firestore.FieldValue.increment(500)
            });
            await db.collection("users").doc(userRecord.uid).update({ referredBy: referral, referralCreditApplied: 500 });
          }
        } catch (e) {
          console.error("Referral processing error (non-fatal):", e.message);
        }
      }
    } catch (err) {
      // Step 5 — roll back so nothing orphaned survives a partial failure.
      console.error("verifySignupOtpBrevo — Firestore profile setup failed:", err);
      await admin.auth().deleteUser(userRecord.uid).catch(() => {});
      await phoneRef.delete().catch(() => {});
      throw new functions.https.HttpsError("internal", "Account setup failed. Please try again.");
    }

    // Step 6 — hand the client a token instead of letting it create the account.
    try {
      const token = await admin.auth().createCustomToken(userRecord.uid);
      return { success: true, token };
    } catch (err) {
      // If token signing fails (commonly: the functions service account is
      // missing the "Service Account Token Creator" IAM role needed by
      // createCustomToken), roll back everything so the user isn't left
      // with an unusable half-created account.
      console.error("verifySignupOtpBrevo — createCustomToken failed:", err);
      await admin.firestore().collection("users").doc(userRecord.uid).delete().catch(() => {});
      await phoneRef.delete().catch(() => {});
      await admin.auth().deleteUser(userRecord.uid).catch(() => {});
      throw new functions.https.HttpsError("internal", "Account setup failed. Please try again — if this keeps happening, contact support.");
    }
  });

/* ════════════════════════════════════════════════════════════
   PHASE 1 — EMAIL VERIFICATION (unchanged)
   Used for Google-linked accounts and any other post-signup
   re-verification path — not part of the primary signup flow
   above, which already creates accounts with emailVerified:true.
   ════════════════════════════════════════════════════════════ */
exports.sendVerificationEmailBrevo = functions
  .runWith({ secrets: BREVO_SECRETS })
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in to request verification email.");
    const userRecord = await admin.auth().getUser(context.auth.uid);
    if (!userRecord.email) throw new functions.https.HttpsError("failed-precondition", "Account has no email address.");
    if (userRecord.emailVerified) return { success: true, alreadyVerified: true };

    await enforceRateLimit("email_verification", userRecord.email);

    const link = await admin.auth().generateEmailVerificationLink(userRecord.email, { url: ACTION_URL.value(), handleCodeInApp: false });

    await sendAuthEmail("email_verification", userRecord.email, userRecord.displayName, "Verify your PackZen account", {
      preheader: "Confirm your email to finish setting up your PackZen account.",
      heading: `Verify your email, ${userRecord.displayName || "there"}`,
      bodyLines: [
        "Thanks for signing up with PackZen. Please confirm your email address to finish setting up your account and start booking moves.",
        "This link will expire shortly for your security."
      ],
      ctaLabel: "Verify Email →", ctaUrl: link
    });
    return { success: true };
  });

/* ════════════════════════════════════════════════════════════
   PHASE 2 — PASSWORD RESET
   Google-only accounts (no password provider linked) never get
   a reset email — this check happens here, server side, never
   trusting the client. Accounts with BOTH Google and a password
   linked still get to reset normally.
   ════════════════════════════════════════════════════════════ */
exports.sendPasswordResetEmailBrevo = functions
  .runWith({ secrets: BREVO_SECRETS })
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    const email = (data?.email || "").trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) throw new functions.https.HttpsError("invalid-argument", "A valid email is required.");

    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (e) {
      if (e.code === "auth/user-not-found") throw new functions.https.HttpsError("not-found", "No account found with this email.");
      throw e;
    }

    const hasPasswordProvider = userRecord.providerData.some(p => p.providerId === "password");
    if (!hasPasswordProvider) {
      throw new functions.https.HttpsError("failed-precondition", "auth/google-account-no-password");
    }

    await enforceRateLimit("password_reset", email);

    const link = await admin.auth().generatePasswordResetLink(email, { url: ACTION_URL.value(), handleCodeInApp: false });

 await sendAuthEmail("password_reset", email, userRecord.displayName, "Reset your PackZen password", {
      preheader: "Reset your PackZen account password.",
      heading: `Reset your password, ${userRecord.displayName || "there"}`,
      bodyLines: [
        "We received a request to reset your PackZen account password. Click below to choose a new one.",
        "If you didn't request this, you can safely ignore this email — your password will remain unchanged."
      ],
      ctaLabel: "Reset Password →", ctaUrl: link
    });
    return { success: true };
  });

/* ════════════════════════════════════════════════════════════
   PHASE 2b — CHECK AUTH PROVIDER
   Lets the client ask "how is this email registered?" without
   relying on fetchSignInMethodsForEmail (unreliable now that
   Email Enumeration Protection is on by default). Used by the
   signup and login error handlers to give an accurate message
   instead of a generic Firebase error code.
   ════════════════════════════════════════════════════════════ */
exports.checkAuthProvider = functions
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    const email = (data?.email || "").trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) throw new functions.https.HttpsError("invalid-argument", "A valid email is required.");

    await enforceRateLimit("check_provider", email);

    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      const providers = userRecord.providerData.map(p => p.providerId);
      return {
        exists: true,
        hasPassword: providers.includes("password"),
        hasGoogle: providers.includes("google.com"),
        hasApple: providers.includes("apple.com")
      };
    } catch (e) {
      if (e.code === "auth/user-not-found") return { exists: false, hasPassword: false, hasGoogle: false, hasApple: false };
      throw e;
    }
  });

/* ════════════════════════════════════════════════════════════
   PHASE 3 — EMAIL CHANGE (unchanged)
   ════════════════════════════════════════════════════════════ */
exports.sendEmailChangeLinkBrevo = functions
  .runWith({ secrets: BREVO_SECRETS })
  .region("asia-south1")
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    const newEmail = (data?.newEmail || "").trim().toLowerCase();
    if (!EMAIL_REGEX.test(newEmail)) throw new functions.https.HttpsError("invalid-argument", "A valid new email is required.");

    const userRecord = await admin.auth().getUser(context.auth.uid);
    if (!userRecord.email) throw new functions.https.HttpsError("failed-precondition", "Account has no current email.");

    try {
      const existing = await admin.auth().getUserByEmail(newEmail);
      if (existing.uid !== context.auth.uid) throw new functions.https.HttpsError("already-exists", "This email is already in use.");
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    await enforceRateLimit("email_change", newEmail);

    const link = await admin.auth().generateVerifyAndChangeEmailLink(userRecord.email, newEmail, { url: ACTION_URL.value(), handleCodeInApp: false });

    await sendAuthEmail("email_change", newEmail, userRecord.displayName, "Confirm your new PackZen email", {
      preheader: "Confirm your new PackZen email address.",
      heading: `Confirm your new email, ${userRecord.displayName || "there"}`,
      bodyLines: [
        "Click below to confirm this address as your new PackZen account email.",
        "If you didn't request this, you can ignore this email and your account email will stay unchanged."
      ],
      ctaLabel: "Confirm New Email →", ctaUrl: link
    });
    return { success: true };
  });
