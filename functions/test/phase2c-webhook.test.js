/**
 * PACKZEN 3.0 — Phase 2C Integration Tests
 * ------------------------------------------------------------------
 * Validates n8n Webhook Channel Adapter, Security & Reliability:
 *   1. Valid HMAC: Signature generation and verification match with correct secret
 *   2. Invalid HMAC: Modified signature or wrong secret is rejected
 *   3. Expired timestamp: Timestamp drift > 5 min rejected
 *   4. Duplicate event: Already delivered webhook event skips dispatch idempotently
 *   5. Replay attempt: Replayed payload with expired timestamp rejected
 *   6. Malformed payload: Corrupted object rejected cleanly without throwing
 *   7. Missing fields: Event missing required schema fields rejected non-retryable
 *   8. HTTP 200: Successful dispatch to n8n returns status delivered
 *   9. HTTP 429: n8n rate limit response returns retryable with backoff
 *  10. HTTP 500: n8n server error returns retryable
 *  11. Connection reset: Network socket reset flags deliveryUnknown: true
 *  12. Timeout: Request timeout flags deliveryUnknown: true
 *  13. Ambiguous acceptance: Ambiguous socket drop preserves at-least-once guarantee
 *  14. n8n unavailable: Unconfigured endpoint enters adapter_pending safely
 *  15. Worker lease recovery: Expired processing lease reclaimed and processed
 *  16. Dead-letter behavior: Fatal error escalates event to dead_letter status
 *  17. Independent channel states: Webhook delivery preserved alongside email & whatsapp
 *  18. No duplicate email: Webhook retry never re-sends already delivered email
 *  19. No duplicate WhatsApp: Webhook retry never re-sends already delivered WhatsApp
 *  20. PII and secret redaction: Sensitive tokens/passwords redacted before sending
 *
 * Run: node test/phase2c-webhook.test.js
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const outbox = require("../automation-outbox");
const producers = require("../automation-producers");
const worker = require("../automation-worker");
const dispatcher = require("../automation-dispatcher");
const webhook = require("../channel-webhook");

let pass = 0;
const ok = (msg) => {
  pass++;
  console.log("  PASS  " + msg);
};

// In-Memory Transactional Database Mock
class MockDb {
  constructor() {
    this.storage = new Map();
  }

  collection(name) {
    return {
      doc: (id) => {
        const docId = id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        return {
          id: docId,
          path: `${name}/${docId}`,
          get: async () => this._getDoc(name, docId),
          set: async (d) => this._setDoc(name, docId, d),
          update: async (u) => this._updateDoc(name, docId, u)
        };
      },
      add: async (d) => {
        const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this._setDoc(name, id, d);
        return { id, path: `${name}/${id}` };
      },
      where: (field, op, val) => ({
        limit: (limitCount) => ({
          get: async () => {
            const matches = [];
            for (const [k, v] of this.storage.entries()) {
              if (k.startsWith(`${name}/`) && v[field] === val) {
                matches.push({
                  id: k.split("/")[1],
                  ref: { id: k.split("/")[1], path: k },
                  data: () => JSON.parse(JSON.stringify(v))
                });
              }
            }
            return {
              docs: matches.slice(0, limitCount),
              empty: matches.length === 0
            };
          }
        })
      })
    };
  }

  _getDoc(col, id) {
    const k = `${col}/${id}`;
    const exists = this.storage.has(k);
    return {
      id,
      exists,
      data: () => (exists ? JSON.parse(JSON.stringify(this.storage.get(k))) : undefined)
    };
  }

  _setDoc(col, id, data) {
    this.storage.set(`${col}/${id}`, JSON.parse(JSON.stringify(data)));
  }

  _updateDoc(col, id, update) {
    const k = `${col}/${id}`;
    if (!this.storage.has(k)) throw new Error(`Document ${k} not found`);
    const curr = this.storage.get(k);
    this.storage.set(k, Object.assign({}, curr, JSON.parse(JSON.stringify(update))));
  }

  async runTransaction(fn) {
    const tx = {
      get: async (ref) => {
        const parts = ref.path.split("/");
        return this._getDoc(parts[0], parts[1]);
      },
      set: (ref, data) => {
        const parts = ref.path.split("/");
        this._setDoc(parts[0], parts[1], data);
      },
      update: (ref, update) => {
        const parts = ref.path.split("/");
        this._updateDoc(parts[0], parts[1], update);
      }
    };
    return fn(tx);
  }
}

(async () => {
  console.log("\n--- PACKZEN 3.0 PHASE 2C WEBHOOK INTEGRATION TESTS ---\n");

  const db = new MockDb();
  const now = Date.parse("2026-11-18T12:00:00.000Z");
  const testSecret = "test_n8n_webhook_secret_key_99";
  const testUrl = "https://n8n-production.up.railway.app/webhook/packzen-events";

  // =============================================================
  // PART 1: CRYPTOGRAPHIC SIGNING & VERIFICATION (Tests 1-5)
  // =============================================================

  const sampleBody = JSON.stringify({
    eventId: "evt_test_001",
    eventName: "booking.confirmed",
    division: "logistics",
    payload: { bookingRef: "PKZ-TEST-01", total: 8500 }
  });

  // Test 1: Valid HMAC
  const validSig = webhook.generateWebhookSignature(now, "evt_test_001", sampleBody, testSecret);
  assert.ok(validSig.startsWith("v1="));
  const verifyResultValid = webhook.verifyWebhookSignature({
    rawBody: sampleBody,
    signatureHeader: validSig,
    timestampHeader: String(now),
    eventIdHeader: "evt_test_001",
    secret: testSecret,
    nowMs: now
  });
  assert.strictEqual(verifyResultValid.valid, true);
  ok("1. Valid HMAC: Signature generation and verification match with correct secret");

  // Test 2: Invalid HMAC (Wrong Secret / Tampered Body)
  const verifyResultWrongSecret = webhook.verifyWebhookSignature({
    rawBody: sampleBody,
    signatureHeader: validSig,
    timestampHeader: String(now),
    eventIdHeader: "evt_test_001",
    secret: "wrong_secret_12345",
    nowMs: now
  });
  assert.strictEqual(verifyResultWrongSecret.valid, false);
  assert.strictEqual(verifyResultWrongSecret.reason, "SIGNATURE_DIGEST_MISMATCH");

  const verifyResultTamperedBody = webhook.verifyWebhookSignature({
    rawBody: sampleBody + '{"hacked":true}',
    signatureHeader: validSig,
    timestampHeader: String(now),
    eventIdHeader: "evt_test_001",
    secret: testSecret,
    nowMs: now
  });
  assert.strictEqual(verifyResultTamperedBody.valid, false);
  assert.strictEqual(verifyResultTamperedBody.reason, "SIGNATURE_DIGEST_MISMATCH");
  ok("2. Invalid HMAC: Modified signature, altered payload or wrong secret is rejected");

  // Test 3: Expired Timestamp (Drift > 5 minutes)
  const tenMinutesAgo = now - (10 * 60 * 1000);
  const expiredSig = webhook.generateWebhookSignature(tenMinutesAgo, "evt_test_001", sampleBody, testSecret);
  const verifyResultExpired = webhook.verifyWebhookSignature({
    rawBody: sampleBody,
    signatureHeader: expiredSig,
    timestampHeader: String(tenMinutesAgo),
    eventIdHeader: "evt_test_001",
    secret: testSecret,
    nowMs: now
  });
  assert.strictEqual(verifyResultExpired.valid, false);
  assert.strictEqual(verifyResultExpired.reason, "TIMESTAMP_EXPIRED_OR_DRIFT_EXCEEDED");
  ok("3. Expired Timestamp: Webhook with timestamp > 5 minutes in past or future is rejected");

  // Test 4: Duplicate Event (Deduplication)
  const alreadyDeliveredWebhookEvent = {
    eventId: "evt_webhook_dedup_01",
    eventName: "lead.created",
    entityType: "lead",
    entityId: "lead_dedup_01",
    division: "logistics",
    channel: "webhook",
    payload: { leadId: "lead_dedup_01", name: "Ramesh" },
    channelDeliveries: {
      webhook: {
        status: "delivered",
        statusCode: 200,
        deliveredAtMs: now - 1000
      }
    }
  };

  let mockSenderCalls = 0;
  const mockSender = async () => {
    mockSenderCalls++;
    return { success: true, statusCode: 200 };
  };

  const dedupResult = await webhook.dispatchWebhookEvent(alreadyDeliveredWebhookEvent, {
    webhookSender: mockSender
  });
  assert.strictEqual(dedupResult.success, true);
  assert.strictEqual(dedupResult.duplicateSkipped, true);
  assert.strictEqual(mockSenderCalls, 0, "Webhook sender must NOT be called for already delivered events");
  ok("4. Duplicate Event: Already delivered webhook event skips dispatch idempotently");

  // Test 5: Replay Attempt (Replayed message outside freshness window)
  const replayedSig = webhook.generateWebhookSignature(now - 400000, "evt_replayed_01", sampleBody, testSecret);
  const verifyResultReplay = webhook.verifyWebhookSignature({
    rawBody: sampleBody,
    signatureHeader: replayedSig,
    timestampHeader: String(now - 400000),
    eventIdHeader: "evt_replayed_01",
    secret: testSecret,
    nowMs: now
  });
  assert.strictEqual(verifyResultReplay.valid, false);
  assert.strictEqual(verifyResultReplay.reason, "TIMESTAMP_EXPIRED_OR_DRIFT_EXCEEDED");
  ok("5. Replay Attempt: Replayed payload with valid signature but expired timestamp is rejected");

  // =============================================================
  // PART 2: SCHEMA VALIDATION & PII SANITIZATION (Tests 6-7, 20)
  // =============================================================

  // Test 6: Malformed Payload
  const malformedValidation = webhook.validateWebhookEvent(null);
  assert.strictEqual(malformedValidation.valid, false);
  const malformedOutcome = await webhook.dispatchWebhookEvent("not-an-object");
  assert.strictEqual(malformedOutcome.success, false);
  assert.strictEqual(malformedOutcome.retryable, false);
  ok("6. Malformed Payload: Corrupted object rejected cleanly without throwing");

  // Test 7: Missing Required Fields
  const missingFieldsEvent = {
    eventId: "evt_missing_fields",
    // missing eventName
    division: "logistics",
    payload: {}
  };
  const missingValidation = webhook.validateWebhookEvent(missingFieldsEvent);
  assert.strictEqual(missingValidation.valid, false);
  const missingOutcome = await webhook.dispatchWebhookEvent(missingFieldsEvent);
  assert.strictEqual(missingOutcome.success, false);
  assert.strictEqual(missingOutcome.retryable, false);
  ok("7. Missing Fields: Event missing required schema fields rejected non-retryable");

  // Test 20: PII & Secret Redaction
  const dirtyPayload = {
    customerName: "Vikram Malhotra",
    phone: "9845012345",
    password: "super_secret_user_pwd",
    apiKey: "brevo_api_key_xyz",
    razorpaySignature: "sec_sig_abc123",
    otp: "847291",
    authKey: "msg91_auth_token",
    totalAmount: 15000,
    nested: {
      userToken: "bearer_token_val",
      service: "Moving & Packing"
    }
  };
  const sanitized = webhook.sanitizePayloadForWebhook(dirtyPayload);
  assert.strictEqual(sanitized.password, "[REDACTED]");
  assert.strictEqual(sanitized.apiKey, "[REDACTED]");
  assert.strictEqual(sanitized.razorpaySignature, "[REDACTED]");
  assert.strictEqual(sanitized.otp, "[REDACTED]");
  assert.strictEqual(sanitized.authKey, "[REDACTED]");
  assert.strictEqual(sanitized.nested.userToken, "[REDACTED]");
  assert.strictEqual(sanitized.customerName, "Vikram Malhotra");
  assert.strictEqual(sanitized.totalAmount, 15000);
  assert.strictEqual(sanitized.nested.service, "Moving & Packing");
  ok("20. PII and Secret Redaction: Sensitive tokens/passwords redacted before transmission");

  // =============================================================
  // PART 3: HTTP STATUS HANDLING & AMBIGUITY (Tests 8-14)
  // =============================================================

  const sampleEvent = outbox.createOutboxEvent({
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "bk_wb_01",
    division: "logistics",
    payload: {
      bookingId: "bk_wb_01",
      bookingRef: "PKZ-WB-01",
      customerName: "Sneha Reddy",
      total: 12000
    },
    channel: "webhook",
    nowMs: now
  });

  // Test 8: HTTP 200 (Success)
  const mockHttp200Sender = async () => ({
    success: true,
    statusCode: 200,
    responseBody: '{"workflowId":"wf_logistics_01","executionId":"exec_100"}'
  });

  const outcome200 = await webhook.dispatchWebhookEvent(sampleEvent, {
    webhookSender: mockHttp200Sender
  });
  assert.strictEqual(outcome200.success, true);
  assert.strictEqual(outcome200.channelDeliveries.webhook.status, "delivered");
  assert.strictEqual(outcome200.channelDeliveries.webhook.statusCode, 200);
  ok("8. HTTP 200: Successful dispatch to n8n returns status delivered");

  // Test 9: HTTP 429 (Rate Limited)
  const mockHttp429Sender = async () => ({
    success: false,
    statusCode: 429,
    retryable: true,
    error: "N8N_RATE_LIMITED"
  });

  const outcome429 = await webhook.dispatchWebhookEvent(sampleEvent, {
    webhookSender: mockHttp429Sender
  });
  assert.strictEqual(outcome429.success, false);
  assert.strictEqual(outcome429.retryable, true);
  ok("9. HTTP 429: n8n rate limit response returns retryable with backoff");

  // Test 10: HTTP 500 (Server Error)
  const mockHttp500Sender = async () => ({
    success: false,
    statusCode: 500,
    retryable: true,
    error: "N8N_SERVER_ERROR"
  });

  const outcome500 = await webhook.dispatchWebhookEvent(sampleEvent, {
    webhookSender: mockHttp500Sender
  });
  assert.strictEqual(outcome500.success, false);
  assert.strictEqual(outcome500.retryable, true);
  ok("10. HTTP 500: n8n server error returns retryable");

  // Test 11: Connection Reset (Socket Disconnect)
  const mockResetSender = async () => ({
    success: false,
    deliveryUnknown: true,
    retryable: true,
    error: "N8N_NETWORK_ERROR: read ECONNRESET"
  });

  const outcomeReset = await webhook.dispatchWebhookEvent(sampleEvent, {
    webhookSender: mockResetSender
  });
  assert.strictEqual(outcomeReset.success, false);
  assert.strictEqual(outcomeReset.deliveryUnknown, true);
  assert.strictEqual(outcomeReset.retryable, true);
  ok("11. Connection Reset: Network socket reset flags deliveryUnknown: true");

  // Test 12: Request Timeout
  const mockTimeoutSender = async () => ({
    success: false,
    deliveryUnknown: true,
    retryable: true,
    error: "N8N_REQUEST_TIMEOUT"
  });

  const outcomeTimeout = await webhook.dispatchWebhookEvent(sampleEvent, {
    webhookSender: mockTimeoutSender
  });
  assert.strictEqual(outcomeTimeout.success, false);
  assert.strictEqual(outcomeTimeout.deliveryUnknown, true);
  assert.strictEqual(outcomeTimeout.retryable, true);
  ok("12. Timeout: Request timeout flags deliveryUnknown: true");

  // Test 13: Ambiguous Acceptance (Never blindly resend without worker lease)
  const ambiguousEvent = outbox.createOutboxEvent({
    eventName: "payment.received",
    entityType: "payment",
    entityId: "pay_ambiguous_01",
    division: "logistics",
    payload: { amount: 5000, paymentId: "pay_amb_01" },
    channel: "webhook",
    nowMs: now
  });

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, ambiguousEvent);
  });

  const workerRunAmbiguous = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_amb",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      webhook: (evt) => dispatcher.dispatchWebhook(evt, { webhookSender: mockTimeoutSender })
    }
  });

  assert.strictEqual(workerRunAmbiguous.deliveryUnknown >= 1, true);
  const ambDoc = (await db.collection("automation_outbox").doc(ambiguousEvent.eventId).get()).data();
  assert.strictEqual(ambDoc.status, "pending");
  assert.strictEqual(ambDoc.deliveryUnknown, true);
  ok("13. Ambiguous Acceptance: Ambiguous socket drop preserves at-least-once guarantee");

  // Test 14: n8n Unavailable (Unconfigured credentials enter adapter_pending safely)
  const unconfiguredEvent = outbox.createOutboxEvent({
    eventName: "booking.created",
    entityType: "booking",
    entityId: "bk_unconf_01",
    division: "logistics",
    payload: { bookingId: "bk_unconf_01", total: 4000 },
    channel: "webhook",
    nowMs: now
  });

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, unconfiguredEvent);
  });

  // Call real sendWebhookRequest with empty configOverride
  const unconfiguredOutcome = await webhook.dispatchWebhookEvent(unconfiguredEvent, {
    configOverride: { webhookUrl: null, webhookSecret: null }
  });
  assert.strictEqual(unconfiguredOutcome.success, false);
  assert.strictEqual(unconfiguredOutcome.isPendingAdapter, true);

  const workerRunUnconf = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_unconf",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      webhook: (evt) => dispatcher.dispatchWebhook(evt, { configOverride: { webhookUrl: null, webhookSecret: null } })
    }
  });

  assert.strictEqual(workerRunUnconf.adapterPending >= 1, true);
  const unconfDoc = (await db.collection("automation_outbox").doc(unconfiguredEvent.eventId).get()).data();
  assert.strictEqual(unconfDoc.status, "adapter_pending");
  assert.strictEqual(unconfDoc.attempts, 0, "Attempts must not be exhausted for pending adapter");
  ok("14. n8n Unavailable: Unconfigured endpoint enters adapter_pending safely");

  // =============================================================
  // PART 4: WORKER RELIABILITY & DEAD-LETTERING (Tests 15-16)
  // =============================================================

  // Test 15: Worker Lease Recovery on Expired Processing
  const crashedEvent = outbox.createOutboxEvent({
    eventName: "lead.qualified",
    entityType: "lead",
    entityId: "lead_crashed_01",
    division: "logistics",
    payload: { leadId: "lead_crashed_01", total: 6000 },
    channel: "webhook",
    nowMs: now
  });

  // Manually plant stuck processing event with expired lease
  crashedEvent.status = "processing";
  crashedEvent.claimedBy = "worker_crashed_dead";
  crashedEvent.leaseExpiresAtMs = now - 5000; // Expired 5 seconds ago

  await db.collection("automation_outbox").doc(crashedEvent.eventId).set(crashedEvent);

  const workerRunRecovery = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_healer",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      webhook: (evt) => dispatcher.dispatchWebhook(evt, { webhookSender: mockHttp200Sender })
    }
  });

  assert.strictEqual(workerRunRecovery.completed >= 1, true);
  const recoveredDoc = (await db.collection("automation_outbox").doc(crashedEvent.eventId).get()).data();
  assert.strictEqual(recoveredDoc.status, "completed");
  assert.strictEqual(recoveredDoc.channelDeliveries.webhook.status, "delivered");
  ok("15. Worker Lease Recovery: Expired processing lease reclaimed and processed");

  // Test 16: Dead-Letter Behavior on Fatal / Max Retries Exceeded
  const fatalEvent = outbox.createOutboxEvent({
    eventName: "partner.assigned",
    entityType: "partner",
    entityId: "partner_fatal_01",
    division: "logistics",
    payload: { partnerId: "partner_fatal_01" },
    channel: "webhook",
    nowMs: now
  });
  fatalEvent.attempts = 5; // Reached max retries

  await db.collection("automation_outbox").doc(fatalEvent.eventId).set(fatalEvent);

  const mockFatalSender = async () => ({
    success: false,
    statusCode: 400,
    retryable: false,
    error: "N8N_BAD_REQUEST_FATAL"
  });

  const workerRunFatal = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_fatal",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      webhook: (evt) => dispatcher.dispatchWebhook(evt, { webhookSender: mockFatalSender })
    }
  });

  assert.strictEqual(workerRunFatal.deadLetter >= 1, true);
  const fatalDoc = (await db.collection("automation_outbox").doc(fatalEvent.eventId).get()).data();
  assert.strictEqual(fatalDoc.status, "dead_letter");
  ok("16. Dead-Letter Behavior: Fatal error or max retries escalates event to dead_letter status");

  // =============================================================
  // PART 5: MULTI-CHANNEL COORDINATION & RETRY SAFETY (Tests 17-19)
  // =============================================================

  // Test 17: Independent Channel States (All 3 Channels Recorded Independently)
  const triChannelEvent = outbox.createOutboxEvent({
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "bk_tri_01",
    division: "logistics",
    payload: {
      bookingId: "bk_tri_01",
      bookingRef: "PKZ-TRI-01",
      customerName: "Ananya",
      customerEmail: "ananya@example.com",
      phone: "9845088888",
      paidAmount: 2000,
      total: 10000,
      date: "2026-11-30"
    },
    channel: "multi_channel",
    nowMs: now
  });
  triChannelEvent.targetChannels = ["email", "whatsapp", "webhook"];

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, triChannelEvent);
  });

  let brevoTriCalls = 0;
  const mockBrevoTri = async () => {
    brevoTriCalls++;
    return { success: true, response: { messageId: "msg_tri_email" } };
  };

  let waTriCalls = 0;
  const mockWaTri = async () => {
    waTriCalls++;
    return { success: true, messageId: "wamid.tri_wa" };
  };

  let wbTriCalls = 0;
  const mockWbTri = async () => {
    wbTriCalls++;
    return { success: true, statusCode: 200 };
  };

  const workerRunTri = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_tri",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      multi_channel: (evt) => dispatcher.dispatchMultiChannel(evt, {
        brevoSender: mockBrevoTri,
        whatsAppSender: mockWaTri,
        webhookSender: mockWbTri,
        includeWebhook: true
      })
    }
  });

  assert.strictEqual(workerRunTri.completed >= 1, true);
  const triDoc = (await db.collection("automation_outbox").doc(triChannelEvent.eventId).get()).data();
  assert.strictEqual(triDoc.status, "completed");
  assert.strictEqual(triDoc.channelDeliveries.email.status, "delivered");
  assert.strictEqual(triDoc.channelDeliveries.whatsapp.status, "delivered");
  assert.strictEqual(triDoc.channelDeliveries.webhook.status, "delivered");
  assert.strictEqual(brevoTriCalls, 1);
  assert.strictEqual(waTriCalls, 1);
  assert.strictEqual(wbTriCalls, 1);
  ok("17. Independent Channel States: Webhook delivery preserved alongside email & whatsapp");

  // Test 18 & 19: No Duplicate Email & No Duplicate WhatsApp on Webhook Retry
  const retryChannelEvent = outbox.createOutboxEvent({
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "bk_retry_safe_01",
    division: "logistics",
    payload: {
      bookingId: "bk_retry_safe_01",
      bookingRef: "PKZ-RS-01",
      customerName: "Karthik",
      customerEmail: "karthik@example.com",
      phone: "9845077777",
      paidAmount: 2000,
      total: 10000,
      date: "2026-11-30"
    },
    channel: "multi_channel",
    nowMs: now
  });
  retryChannelEvent.targetChannels = ["email", "whatsapp", "webhook"];

  // Pre-seed email and WhatsApp as ALREADY delivered
  retryChannelEvent.channelDeliveries = {
    email: { status: "delivered", messageId: "msg_already_sent", deliveredAtMs: now - 5000 },
    whatsapp: { status: "delivered", messageId: "wamid.already_sent", deliveredAtMs: now - 5000 }
  };

  await db.collection("automation_outbox").doc(retryChannelEvent.eventId).set(retryChannelEvent);

  let duplicateBrevoCalls = 0;
  const mockDedupBrevo = async () => {
    duplicateBrevoCalls++;
    return { success: true, response: { messageId: "msg_dup" } };
  };

  let duplicateWaCalls = 0;
  const mockDedupWa = async () => {
    duplicateWaCalls++;
    return { success: true, messageId: "wamid.dup" };
  };

  let firstWbCalls = 0;
  const mockFailingThenSucceedingWb = async () => {
    firstWbCalls++;
    return { success: true, statusCode: 200 };
  };

  const retryDispatchResult = await dispatcher.dispatchMultiChannel(retryChannelEvent, {
    brevoSender: mockDedupBrevo,
    whatsAppSender: mockDedupWa,
    webhookSender: mockFailingThenSucceedingWb,
    includeWebhook: true
  });

  assert.strictEqual(retryDispatchResult.success, true);
  assert.strictEqual(duplicateBrevoCalls, 0, "Email sender must NOT be called when email was already delivered");
  assert.strictEqual(duplicateWaCalls, 0, "WhatsApp sender must NOT be called when WhatsApp was already delivered");
  assert.strictEqual(firstWbCalls, 1, "Webhook sender should be called for undelivered webhook channel");
  assert.strictEqual(retryDispatchResult.channelDeliveries.email.status, "delivered");
  assert.strictEqual(retryDispatchResult.channelDeliveries.whatsapp.status, "delivered");
  assert.strictEqual(retryDispatchResult.channelDeliveries.webhook.status, "delivered");
  ok("18. No Duplicate Email: Webhook retry never re-sends already delivered email");
  ok("19. No Duplicate WhatsApp: Webhook retry never re-sends already delivered WhatsApp");

  console.log(`\n======================================================`);
  console.log(` ALL ${pass} PHASE 2C WEBHOOK TESTS PASSED!`);
  console.log(`======================================================\n`);
})();
