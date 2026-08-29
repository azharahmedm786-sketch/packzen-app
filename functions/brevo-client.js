/* ============================================================
   BREVO EMAIL CLIENT
   Reusable helper for sending transactional emails via Brevo API.
   API key read from Firebase environment config — never hardcoded.

   Set the key with:
   firebase functions:config:set brevo.apikey="YOUR_BREVO_API_KEY" brevo.senderemail="no-reply@packzenblr.in" brevo.sendername="PackZen Packers & Movers"
   ============================================================ */
const functions = require("firebase-functions/v1");
const https = require("https");
const { defineSecret } = require("firebase-functions/params");

// Shared Brevo secrets — any exported Cloud Function that calls sendBrevoEmail(),
// directly or indirectly, must add BREVO_SECRETS to its .runWith({ secrets: ... }).
const BREVO_API_KEY      = defineSecret("BREVO_API_KEY");
const BREVO_SENDER_EMAIL = defineSecret("BREVO_SENDER_EMAIL");
const BREVO_SENDER_NAME  = defineSecret("BREVO_SENDER_NAME");
const BREVO_SECRETS = [BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME];

function getBrevoConfig() {
  return {
    apiKey: BREVO_API_KEY.value() || null,
    senderEmail: BREVO_SENDER_EMAIL.value() || "no-reply@packzenblr.in",
    senderName: BREVO_SENDER_NAME.value() || "PackZen Packers & Movers"
  };
}

/**
 * Sends a transactional email via Brevo's REST API (v3/smtp/email).
 * Returns a Promise resolving to { success, response, error }.
 * Never throws — always resolves so callers can log the outcome.
 */
function sendBrevoEmail({ toEmail, toName, subject, htmlContent, textContent }) {
  return new Promise((resolve) => {
    const { apiKey, senderEmail, senderName } = getBrevoConfig();
    if (!apiKey) {
      resolve({ success: false, response: null, error: "BREVO_API_KEY_NOT_CONFIGURED", retryable: false });
      return;
    }
    if (!toEmail) {
      resolve({ success: false, response: null, error: "MISSING_RECIPIENT_EMAIL", retryable: false });
      return;
    }
    const payload = JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: toName || toEmail }],
      subject: subject,
      htmlContent: htmlContent,
      textContent: textContent || undefined
    });

    const options = {
      hostname: "api.brevo.com",
      path: "/v3/smtp/email",
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, response: parsed, error: null });
          } else {
            const retryable = res.statusCode === 429 || res.statusCode >= 500;
            resolve({ success: false, response: parsed, error: parsed.message || ("HTTP " + res.statusCode), retryable });
          }
        } catch (e) {
          resolve({ success: false, response: body.slice(0, 500), error: "Invalid JSON response: " + e.message, retryable: false });
        }
      });
    });
    req.on("error", (err) => {
      resolve({ success: false, response: null, error: err.message, retryable: true });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, response: null, error: "Brevo request timed out", retryable: true });
    });
    req.write(payload);
    req.end();
     
  });
}

module.exports = { sendBrevoEmail, getBrevoConfig, BREVO_SECRETS };
