# PACKZEN 3.0 — PHASE 2C IMPLEMENTATION REPORT
## Server-to-Server n8n Webhook Integration & Operations Automation

**Date:** November 18, 2026  
**Environment:** Local Worktree (`missing_open_graph_image`)  
**Firebase Project:** `packzen-e7539`  
**Production Domain:** `https://packzenblr.in`  
**Git Branch:** `firebase-hosting-migration`  
**Baseline Release Commit:** `0c3f91264c123689626c59bce2cf4c3ae63ea25a`  
**Functions Runtime:** Node.js 22  
**Functions Region:** `asia-south1` (Mumbai)  
**n8n Target Hosting:** Railway  

---

## 1. Executive Summary

Phase 2C extends the PackZen 3.0 automation infrastructure by establishing a secure, server-to-server webhook adapter ([channel-webhook.js](file:///C:/Users/Azhar/.gemini/antigravity/worktrees/packzen-app/missing_open_graph_image/functions/channel-webhook.js)) connecting the transactional outbox worker with **n8n on Railway**.

This integration activates internal operational automation workflows across Logistics, Home Services, and Digital divisions while strictly preserving existing customer-facing communication channels (Brevo Email in Phase 2A and Meta WhatsApp Cloud API in Phase 2B).

### Key Milestones Delivered:
1. **Server-Side Webhook Channel Adapter (`functions/channel-webhook.js`)**:
   - Outbound HTTP/HTTPS client utilizing Node.js native libraries.
   - Cryptographic HMAC-SHA256 request signing over canonical string: `${timestamp}.${eventId}.${rawPayload}`.
   - Mandatory HTTP headers: `X-PackZen-Event-Id`, `X-PackZen-Timestamp`, `X-PackZen-Signature`, `X-PackZen-Version`.
   - Constant-time signature comparison helper (`verifyWebhookSignature`) with `crypto.timingSafeEqual`.
   - Replay defense via strict timestamp freshness window (5 minutes / 300,000 ms).
   - Secret Manager credential management (`N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`) with non-blocking `adapter_pending` fallback.
   - Deep PII minimization and secret redaction (`password`, `token`, `otp`, `authKey`, `signature`).
   - Request timeout (10s) and payload size cap (256 KB) enforcement.
2. **Dispatcher Orchestration (`functions/automation-dispatcher.js`)**:
   - Active routing for single-channel `webhook` events.
   - Independent sub-channel delivery tracking: `channelDeliveries.webhook`, `channelDeliveries.email`, `channelDeliveries.whatsapp`.
   - Complete retry isolation: failures or retries of webhook calls never re-send already delivered emails or WhatsApp messages.
3. **Outbox Worker & Index Wiring (`functions/index.js`)**:
   - Mounted `N8N_SECRETS` on `processOutboxQueue`.
   - Preserved lease locking, exponential backoff, dead-letter archiving, and audit logging.
4. **Comprehensive Automated Test Coverage (`functions/test/phase2c-webhook.test.js`)**:
   - 20 dedicated unit and integration tests verifying all security, network, and error boundary conditions.
   - Full regression suite execution: **54 / 54 test suites passing (0 regressions, 370+ assertions)**.
5. **Zero Disruption Guarantee**:
   - Local implementation only: 0 git commits, 0 pushes, 0 production deployments, 0 production Firestore writes, 0 real webhook dispatches.

---

## 2. Architecture & Integration Design

```
+-----------------------------------------------------------------------------------+
|                           BUSINESS MUTATIONS (Firestore Tx)                       |
|   (Leads, Bookings, Move Payments, Driver Assignments, OTPs, Digital Milestones)  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v Enqueued atomically
+-----------------------------------------+-----------------------------------------+
|                  AUTOMATION OUTBOX (`automation_outbox`)                          |
|                  status: "pending", priority: urgent/high/normal                  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v Claimed via lease-lock
+-----------------------------------------+-----------------------------------------+
|                 OUTBOX WORKER (`automation-worker.js`)                            |
|                 Scheduled Cloud Function / Bounded Batch Processing               |
+-----------------------------------------+-----------------------------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
        v                                 v                                 v
+------------------+             +------------------+             +--------------------+
|  BREVO ADAPTER   |             | WHATSAPP ADAPTER |             |  WEBHOOK ADAPTER   |
|  (Email Channel) |             | (WhatsApp Cloud) |             |  (n8n on Railway)  |
+------------------+             +------------------+             +---------+----------+
                                                                            |
                                                    +-----------------------+-----------------------+
                                                    | Canonical HMAC-SHA256 Signing                 |
                                                    | Headers: Event-Id, Timestamp, Sig, Version    |
                                                    +-----------------------+-----------------------+
                                                                            | Outbound HTTPS POST
                                                                            v
                                                              +-----------------------------+
                                                              |      n8n on Railway         |
                                                              |   Webhook Receiver Node     |
                                                              +--------------+--------------+
                                                                             |
                                              +------------------------------+------------------------------+
                                              |                              |                              |
                                              v                              v                              v
                                    [Logistics Ops Dispatch]       [Sales CRM / Leads]           [Internal Alerts]
                                    - Driver notifications         - Google Sheets / CRM         - Slack / Telegram
                                    - Route scheduling             - Hot lead alerts             - Ops team escalation
```

---

## 3. Files Created and Modified

| File | Status | Description |
|---|---|---|
| `functions/channel-webhook.js` | **New** | Outbound HTTP/HTTPS client, HMAC-SHA256 signer, verification helper, schema validator, secret redactor. |
| `functions/test/phase2c-webhook.test.js` | **New** | 20 dedicated unit and integration tests covering HMAC security, network errors, retries, and multi-channel safety. |
| `functions/automation-dispatcher.js` | Modified | Activated `dispatchWebhook` and upgraded `dispatchMultiChannel` with tri-channel independent tracking. |
| `functions/index.js` | Modified | Imported and mounted `N8N_SECRETS` on `processOutboxQueue`. |
| `functions/package.json` | Modified | Added `phase2c-webhook.test.js` to root test runner script. |

---

## 4. Signing Contract & Security Specifications

All requests sent to n8n are authenticated and validated using server-to-server cryptographic signatures.

### HTTP Headers
| Header Name | Format / Example | Description |
|---|---|---|
| `X-PackZen-Event-Id` | `evt_1731940000000_abc12` | Authoritative outbox event ID. |
| `X-PackZen-Timestamp` | `1731940000000` | Unix epoch time in milliseconds when the request was generated. |
| `X-PackZen-Signature` | `v1=7f8b9...` | Hex-encoded HMAC-SHA256 digest prefixed with version identifier (`v1=`). |
| `X-PackZen-Version` | `3.0` | PackZen Outbox Schema Version. |
| `Content-Type` | `application/json` | Standard JSON body. |
| `User-Agent` | `PackZen-Automation-Outbox/3.0` | Sender identification. |

### Canonical Signing String Format
The HMAC-SHA256 signature is calculated over a deterministic string binding the timestamp, event ID, and exact JSON body:
```
canonicalString = `${timestamp}.${eventId}.${rawPayload}`
```
Where:
- `timestamp`: The exact string value sent in `X-PackZen-Timestamp`.
- `eventId`: The exact string value sent in `X-PackZen-Event-Id`.
- `rawPayload`: The uncompressed, exact UTF-8 serialized JSON payload body.
- `secret`: The shared secret configured in `N8N_WEBHOOK_SECRET`.

### Verification Logic (for n8n Receiver)
```javascript
const crypto = require("crypto");

function verifyPackZenWebhook(headers, rawBody, secret, maxDriftMs = 300000) {
  const eventId = headers["x-packzen-event-id"];
  const timestamp = Number(headers["x-packzen-timestamp"]);
  const signature = headers["x-packzen-signature"];
  
  if (!eventId || !Number.isFinite(timestamp) || !signature) {
    return { valid: false, error: "Missing required headers" };
  }

  // 1. Freshness window check (5 minutes)
  const drift = Math.abs(Date.now() - timestamp);
  if (drift > maxDriftMs) {
    return { valid: false, error: "Timestamp expired or clock drift exceeded" };
  }

  // 2. Expected signature calculation
  const canonical = `${timestamp}.${eventId}.${rawBody}`;
  const expectedHmac = "v1=" + crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");

  // 3. Constant-time comparison
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expectedHmac, "utf8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: "Signature mismatch" };
  }

  return { valid: true };
}
```

---

## 5. Event Integration Matrix & Workflow Specifications

| Event Name | Division | Producer Implementation | Primary Channel | n8n Operational Target Workflow | Operational Payload Fields |
|---|---|---|---|---|---|
| `lead.created` | Logistics / Home / Digital | Authoritative in `leads.js` | WhatsApp / Webhook | **Sales CRM & Hot Lead Alert** (Slack / Telegram / Google Sheets) | `leadId`, `name`, `phone`, `service`, `area`, `tier`, `source`, `score` |
| `lead.qualified` | Logistics | Authoritative in `sales.js` | WhatsApp / Webhook | **Quote Follow-up & Pipeline Sync** | `leadId`, `customerName`, `total`, `quoteToken`, `serviceLabel` |
| `booking.created` | Logistics | Authoritative in `index.js` | WhatsApp / Webhook | **Dispatch Queue & Fleet Demand Radar** | `bookingId`, `bookingRef`, `customerName`, `pickup`, `drop`, `date`, `total` |
| `booking.confirmed` | Logistics | Authoritative in `move-payment.js` | Multi-Channel (Email + WA + Webhook) | **Confirmed Move Operations & Crew Schedule** | `bookingId`, `bookingRef`, `customerName`, `paidAmount`, `balanceDue`, `total` |
| `payment.received` | Logistics | Authoritative in `move-payment.js` | Multi-Channel (Email + WA + Webhook) | **Accounting Sync & Financial Ledger Audit** | `paymentId`, `orderId`, `bookingRef`, `amount`, `method`, `paidAtMs` |
| `booking.assigned` | Logistics | Authoritative in `assignment.js` | WhatsApp / Webhook | **Fleet Tracking & Driver Roster Sync** | `bookingId`, `bookingRef`, `driverUid`, `driverName`, `driverPhone`, `vehicleNumber` |
| `booking.completed` | Logistics | Authoritative in `completion-otp.js` | WhatsApp / Webhook | **Partner Payout Processing & Quality Audit** | `bookingId`, `bookingRef`, `driverUid`, `partnerPayout`, `verifiedMethod` |
| `home_service.requested`| Home Services | Authoritative in `catalog-booking.js` | WhatsApp / Webhook | **Technician Dispatch & Partner Routing** | `serviceId`, `serviceType`, `customerName`, `customerPhone`, `area`, `scheduledDate` |
| `partner.assigned` | Logistics | Authoritative in `assignment.js` | WhatsApp / Webhook | **Partner Acceptance & SLA Monitor** | `partnerId`, `partnerName`, `bookingRef`, `pickup`, `date` |
| `project.created` | Digital | Authoritative in `automation-producers.js` | Email / Webhook | **Digital Workspace Setup & Onboarding** (Folder, Repo, Invoice) | `projectId`, `businessName`, `clientName`, `totalAmount`, `advancePaid`, `status` |
| `project.milestone_updated` | Digital | Authoritative in `automation-producers.js` | Email / Webhook | **Milestone Billing & Deliverable Sign-Off Alert** | `projectId`, `businessName`, `milestoneName`, `milestoneIndex`, `status` |

*Note on Digital Project Events*: As verified in Phase 1.2 and Phase 2A/2B, Digital project events are strictly internal/operational and email-based. They do not trigger customer WhatsApp messages, but are routed to n8n for workspace management (Google Drive folder setup, client contract tracking).

---

## 6. Delivery State Machine & Failure Isolation

### At-Least-Once Delivery Semantics
PackZen guarantees **at-least-once** delivery from the Outbox to n8n.
- An **HTTP 2xx** from n8n confirms receipt and acceptance of the webhook payload, **not** completion of the downstream asynchronous workflow.
- n8n receivers must implement persistent idempotency tracking using `X-PackZen-Event-Id` with a 24–48 hour TTL to reject replayed duplicate deliveries.

### Error Classification & Backoff
| HTTP Response / Network State | Classification | Outbox Status Transition | Action Taken |
|---|---|---|---|
| `200 - 299` | Success | `completed` (or channel recorded) | Recorded in `channelDeliveries.webhook`, audit log written. |
| `429 Too Many Requests` | Transient Rate Limit | `pending` (with exponential backoff) | Attempts incremented, `nextRetryAtMs` scheduled with 2^(attempt) backoff. |
| `500, 502, 503, 504` | n8n Server Error | `pending` (with exponential backoff) | Attempts incremented, retry scheduled. |
| `400, 401, 403, 404, 422` | Client / Schema Error | `dead_letter` (if fatal) | Non-retryable error, avoids wasteful repeated calls. |
| Socket Reset (`ECONNRESET`) | Ambiguous Delivery | `pending` (`deliveryUnknown: true`) | Preserved with lease release; never blindly re-sent without worker backoff. |
| Socket Timeout (`ETIMEDOUT`) | Ambiguous Delivery | `pending` (`deliveryUnknown: true`) | Preserved with lease release; operator alerted if persistent. |
| Unconfigured Credentials | Configuration Gap | `adapter_pending` | Paused safely; attempts rolled back to 0; no retry exhaustion or dead-lettering. |

### Multi-Channel Retry Isolation
When an event targets multiple channels (e.g. `booking.confirmed` targeting Email, WhatsApp, and Webhook):
```
Worker Execution 1:
- Email: Success (channelDeliveries.email.status = "delivered")
- WhatsApp: Success (channelDeliveries.whatsapp.status = "delivered")
- Webhook: HTTP 500 (channelDeliveries.webhook.status = "pending")
Result: Event remains pending with exponential backoff.

Worker Execution 2 (Retry):
- Email: SKIPPED (already delivered -> Brevo API NOT called)
- WhatsApp: SKIPPED (already delivered -> Meta Cloud API NOT called)
- Webhook: HTTP 200 (channelDeliveries.webhook.status = "delivered")
Result: Event transitioned to completed! Zero duplicate customer messages sent.
```

---

## 7. Monitoring & Operational Observability

Existing production infrastructure is reused without creating redundant collections:
1. **`automation_outbox`**:
   - `status`: Filterable by `pending`, `processing`, `adapter_pending`, `dead_letter`, `completed`.
   - `channelDeliveries.webhook`: Contains `statusCode`, `durationMs`, `deliveredAtMs`.
   - `attempts` & `attemptHistory`: Full trace of every dispatch attempt, duration, and error message.
2. **`automation_logs`**:
   - Immutable audit records for every terminal delivery or dead-letter escalation.
   - PII masked and secrets redacted.
3. **Admin Dashboard Monitoring**:
   - Admin query: `db.collection("automation_outbox").where("status", "in", ["dead_letter", "adapter_pending"])` displays operational alerts.
   - Manual retry action: Resets `status: "pending"`, `attempts: 0`, `nextRetryAtMs: now` for dead-lettered events after resolving downstream n8n issues.

---

## 8. Test Execution Results

### Dedicated Phase 2C Test Suite (`functions/test/phase2c-webhook.test.js`)
All 20 required test scenarios passed:
1. `PASS 1. Valid HMAC`: Signature generation and verification match with correct secret.
2. `PASS 2. Invalid HMAC`: Modified signature, altered payload or wrong secret rejected.
3. `PASS 3. Expired Timestamp`: Timestamp drift > 5 minutes rejected.
4. `PASS 4. Duplicate Event`: Already delivered webhook event skips dispatch idempotently.
5. `PASS 5. Replay Attempt`: Replayed payload with expired timestamp rejected.
6. `PASS 6. Malformed Payload`: Corrupted object rejected cleanly without throwing.
7. `PASS 7. Missing Fields`: Event missing required schema fields rejected non-retryable.
8. `PASS 8. HTTP 200`: Successful dispatch to n8n returns status delivered.
9. `PASS 9. HTTP 429`: n8n rate limit response returns retryable with backoff.
10. `PASS 10. HTTP 500`: n8n server error returns retryable.
11. `PASS 11. Connection Reset`: Network socket reset flags `deliveryUnknown: true`.
12. `PASS 12. Timeout`: Request timeout flags `deliveryUnknown: true`.
13. `PASS 13. Ambiguous Acceptance`: Ambiguous socket drop preserves at-least-once guarantee.
14. `PASS 14. n8n Unavailable`: Unconfigured endpoint enters `adapter_pending` safely.
15. `PASS 15. Worker Lease Recovery`: Expired processing lease reclaimed and processed.
16. `PASS 16. Dead-Letter Behavior`: Fatal error or max retries escalates event to `dead_letter` status.
17. `PASS 17. Independent Channel States`: Webhook delivery preserved alongside email & whatsapp.
18. `PASS 18. No Duplicate Email`: Webhook retry never re-sends already delivered email.
19. `PASS 19. No Duplicate WhatsApp`: Webhook retry never re-sends already delivered WhatsApp.
20. `PASS 20. PII and Secret Redaction`: Sensitive tokens/passwords redacted before transmission.

### Full Regression Test Suite (`npm test` in `functions`)
Executed all **54 test suites**:
- **Pricing & Validation Handlers**: 100% PASS
- **Razorpay Payments & Refunds**: 100% PASS
- **Hardening, Auth Abuse & CSRF Security**: 100% PASS
- **UI Marketplace, Driver Assignment & Phase 2C Legacy**: 100% PASS
- **Service Area, Leads & Notifications**: 100% PASS
- **Assistant AI (81 tests, 72 conversation scenarios)**: 100% PASS
- **Phase 1 Automation Outbox (15 tests)**: 100% PASS
- **Phase 1.1 Integration Readiness (6 tests)**: 100% PASS
- **Phase 1.2 Transactional Producers (15 tests)**: 100% PASS
- **Phase 2A Communication & Brevo Email (14 tests)**: 100% PASS
- **Phase 2B WhatsApp Cloud API (15 tests)**: 100% PASS
- **Phase 2C n8n Webhook Integration (20 tests)**: 100% PASS
- **Total Regressions**: **0**

---

## 9. Implementation Classification & Environment Boundaries

| Component | Status / Boundary | Description |
|---|---|---|
| **Outbound Webhook Client** (`channel-webhook.js`) | **Locally Implemented** | Full production code ready for deployment. |
| **HMAC Signer & Verifier** | **Locally Implemented** | Tested and verified against standard test vectors. |
| **Dispatcher Multi-Channel Routing** | **Locally Implemented** | Tri-channel coordination verified. |
| **Outbox Worker Schedule & Secret Wiring** | **Locally Implemented** | Configured in `functions/index.js`. |
| **n8n Webhook Endpoint** | **Externally Configured** | Deployed on Railway; URL and Secret to be set in Google Secret Manager. |
| **n8n Downstream Workflows** | **Externally Configured** | Internal operational workflows (Slack alerts, Google Sheets) configured in n8n UI. |
| **Production Cloud Function Deploy** | **Pending Review** | Zero Cloud deployments performed during Phase 2C. |

---

## 10. Production Activation & Rollback Plan

### Production Activation Checklist (For the Owner)
1. **Deploy n8n Webhook Workflow on Railway**:
   - Create a Webhook node in n8n listening on POST `/webhook/packzen-events`.
   - Add a Code Node executing the `verifyPackZenWebhook` HMAC verification function.
   - Configure workflow routing based on `body.eventName` and `body.division`.
2. **Provision Google Cloud Secrets**:
   ```bash
   firebase functions:secrets:set N8N_WEBHOOK_URL
   # Enter: https://<railway-domain>/webhook/packzen-events
   firebase functions:secrets:set N8N_WEBHOOK_SECRET
   # Enter: <high-entropy-random-secret-at-least-32-chars>
   ```
3. **Deploy Cloud Functions**:
   Deploy updated `processOutboxQueue` with mounted secrets.

### Emergency Deactivation & Rollback
- **Soft Pause**: Unset `N8N_WEBHOOK_URL` in Secret Manager. The worker automatically places webhook events in `adapter_pending` without retries, errors, or customer impact. Email and WhatsApp continue unaffected.
- **Full Rollback**: Revert working tree to baseline release commit `0c3f91264c123689626c59bce2cf4c3ae63ea25a`.

---

## 11. Final Verdict

Phase 2C implementation is complete, passes all 20 required security and reliability tests, preserves independent channel states with zero duplicate messages, and introduces zero regressions across all 54 existing test suites.

### VERDICT: **READY FOR PHASE 2D** (Awaiting Owner Review — No Phase 2D actions initiated)
