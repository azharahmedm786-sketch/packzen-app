# PACKZEN 3.0 — PENDING EXTERNAL DEPENDENCIES & ENVIRONMENT AUDIT
## Live Provider Keys, Webhook Endpoints, Cloud Config & Deployment Prerequisites

**Author:** Staff Site Reliability Engineer & Infrastructure Architect  
**Project:** PackZen (`packzen-e7539`)  
**Deployment Region:** `asia-south1`  
**Status:** AUDITED — READY FOR POST-AUTHORIZATION PROVISIONING

---

## 1. PENDING SECRETS & CLOUD ENVIRONMENT CONFIGURATION

The local codebase is fully tested using strict mock harnesses. Prior to enabling live automated communication workers in production, the following secrets and credentials must be set in Firebase Functions Config:

| Provider / Channel | Environment Variable / Config Key | Current Local State | Production Action Required |
|---|---|---|---|
| **Brevo Transactional Email** | `brevo.api_key` / `BREVO_API_KEY` | Mocked in tests | Run `firebase functions:config:set brevo.api_key="xkeysib-..."` |
| **Meta WhatsApp Cloud API** | `whatsapp.token` / `WHATSAPP_TOKEN` | Mocked in tests | Run `firebase functions:config:set whatsapp.token="EAAG..."` |
| **Meta WhatsApp Phone ID** | `whatsapp.phone_id` / `WHATSAPP_PHONE_ID` | Mocked in tests | Set registered Meta Business phone number ID |
| **Meta App Secret** | `whatsapp.app_secret` / `WHATSAPP_APP_SECRET`| Mocked in tests | Set App Secret for HMAC webhook verification |
| **Meta Webhook Verify Token** | `whatsapp.verify_token` | Configured | Matches `PACKZEN_WA_VERIFY_2026` |
| **n8n Automation Engine** | `n8n.webhook_url` / `N8N_WEBHOOK_URL` | Mocked in tests | Configure live self-hosted or cloud n8n webhook URL |
| **n8n Webhook Secret** | `n8n.webhook_secret` | Configured | Shared HMAC secret for tamper-proofing payload delivery |
| **Razorpay Payment Gateway** | `razorpay.key_secret` / `RAZORPAY_KEY_SECRET` | Live in Prod | Preserved intact from existing baseline release |

---

## 2. THIRD-PARTY WEBHOOK REGISTRATIONS

When deploying live endpoints, register the following URLs in external provider developer consoles:

### 2.1 Meta WhatsApp Cloud API Webhook
- **Webhook Callback URL:** `https://asia-south1-packzen-e7539.cloudfunctions.net/whatsappWebhook`
- **Verify Token:** Set to the configured verify token in `functions/channel-whatsapp.js`.
- **Subscription Fields:**
  - `messages` (inbound STOP opt-outs and customer replies)
  - `message_status` (delivered, read, failed telemetry)

### 2.2 Razorpay Payment Webhook
- **Webhook Callback URL:** `https://asia-south1-packzen-e7539.cloudfunctions.net/paymentWebhook`
- **Events:**
  - `payment.captured`
  - `payment.failed`
  - `refund.processed`

---

## 3. FIRESTORE COMPOSITE INDEX PROVISIONING

The composite indexes defined in `firestore.indexes.json` must be deployed to Google Cloud Firestore before new composite queries can run:

```bash
firebase deploy --only firestore:indexes --project packzen-e7539
```

**Index Build Duration:** Cloud Firestore typically builds 9 composite indexes in 3 to 7 minutes. The Firebase Console tracks index build progress.

---

## 4. GOOGLE PLAY STORE & PWA PACKAGING

PackZen 3.0 provides full Progressive Web App (PWA) readiness with:
- `manifest.webmanifest`: App ID, brand colors (`#0057FF`, `#1F9D5C`), maskable icons, app shortcuts (`Book Move`, `Home Services`, `Digital Projects`).
- `sw.js`: Network-first service worker with offline fallback.
- **Next Step:** When packaging for the Google Play Store via Bubblewrap (TWA), use the generated Digital Asset Links file at `https://packzenblr.in/.well-known/assetlinks.json`.
