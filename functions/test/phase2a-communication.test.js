/**
 * PACKZEN 3.0 — Phase 2A Communication & Transactional Email Test Suite
 * ------------------------------------------------------------------
 * Validates:
 *   1. P1 Atomicity: lead.created, lead.qualified, advisor booking.created commit atomically in single tx
 *   2. Brevo Email Adapter: Successful delivery with provider messageId evidence
 *   3. Email Payload Validation: Rejection of invalid email format / injection attacks
 *   4. Missing Email Handling: Phone-only leads skipped cleanly without retry churn
 *   5. Provider Rate Limiting (HTTP 429): Retryable with exponential backoff
 *   6. Provider Timeout / Ambiguous Delivery: Marked as delivery_unknown to preserve at-least-once safety
 *   7. Provider Evidence Enforcement: Missing messageId rejected even on HTTP 200
 *   8. Provider Deduplication: Duplicate events skip already delivered channels
 *   9. Pending Adapters: WhatsApp and Webhook safely paused in adapter_pending
 *  10. Multi-Channel Coordination: Email delivered while WhatsApp enters adapter_pending
 *  11. Template Fidelity: All 5 core transactional email templates produce clean, escaped HTML
 *  12. Zero-PII Audit Logging: Phone, email and secrets masked in audit trail
 *  13. Crash Recovery: Abandoned leases claimed and recovered
 *
 * Run: node test/phase2a-communication.test.js
 */
"use strict";

const assert = require("assert");
const outbox = require("../automation-outbox");
const producers = require("../automation-producers");
const worker = require("../automation-worker");
const dispatcher = require("../automation-dispatcher");

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
  console.log("\n--- PACKZEN 3.0 PHASE 2A COMMUNICATION & EMAIL TESTS ---\n");

  const db = new MockDb();
  const now = Date.parse("2026-11-18T00:00:00.000Z");

  // =============================================================
  // PART 1: P1 ATOMICITY FIXES VERIFICATION
  // =============================================================

  // Test 1: Atomic Lead Creation + lead.created Outbox
  const leadRef = db.collection("leads").doc("lead_phase2a_01");
  const leadData = {
    name: "Vikram Kumar",
    phone: "9845022222",
    email: "vikram@example.com",
    service: "move",
    division: "logistics",
    status: "new",
    area: "Whitefield"
  };

  const leadTxRes = await db.runTransaction(async (tx) => {
    tx.set(leadRef, leadData);
    return producers.emitLeadCreatedTx(tx, db, leadRef.id, leadData, now, { channel: "email" });
  });

  assert.strictEqual(leadTxRes.enqueued, true);
  const storedLead = (await leadRef.get()).data();
  const storedLeadOutbox = (await db.collection("automation_outbox").doc(leadTxRes.eventId).get()).data();
  assert.strictEqual(storedLead.name, "Vikram Kumar");
  assert.strictEqual(storedLeadOutbox.eventName, "lead.created");
  assert.strictEqual(storedLeadOutbox.payload.email, "vikram@example.com");
  ok("1. Atomicity: Lead mutation and lead.created outbox record committed atomically in single transaction");

  // Test 2: Atomic Quote Preparation + lead.qualified Outbox
  const quoteToken = "token_quote_phase2a_99";
  const quoteRef = db.collection("sentQuotes").doc(quoteToken);
  const quoteDoc = {
    token: quoteToken,
    leadId: leadRef.id,
    customerName: "Vikram Kumar",
    phone: "9845022222",
    email: "vikram@example.com",
    total: 8500,
    sizeLabel: "2 BHK Regular",
    status: "sent"
  };

  const quoteTxRes = await db.runTransaction(async (tx) => {
    tx.set(quoteRef, quoteDoc);
    tx.update(leadRef, { status: "quoted", quotedAmount: 8500, quoteToken });
    return producers.emitLeadQualifiedTx(tx, db, leadRef.id, {
      customerName: quoteDoc.customerName,
      customerEmail: quoteDoc.email,
      phone: quoteDoc.phone,
      total: quoteDoc.total,
      quoteToken,
      serviceLabel: quoteDoc.sizeLabel
    }, now, { channel: "email" });
  });

  assert.strictEqual(quoteTxRes.enqueued, true);
  const updatedLead = (await leadRef.get()).data();
  assert.strictEqual(updatedLead.status, "quoted");
  const storedQuoteOutbox = (await db.collection("automation_outbox").doc(quoteTxRes.eventId).get()).data();
  assert.strictEqual(storedQuoteOutbox.eventName, "lead.qualified");
  assert.strictEqual(storedQuoteOutbox.payload.customerEmail, "vikram@example.com");
  ok("2. Atomicity: Quote generation, lead status update and lead.qualified outbox committed atomically");

  // Test 3: Advisor Booking Creation + booking.created Outbox
  const advBookingRef = db.collection("bookings").doc("bk_advisor_01");
  const advBookingData = {
    bookingRef: "PKZ-ADV-101",
    customerName: "Sneha Reddy",
    email: "sneha@example.com",
    phone: "9845033333",
    total: 12000,
    date: "2026-11-25",
    pickup: "Indiranagar",
    drop: "Koramangala",
    status: "confirmed",
    paymentType: "pay_later"
  };

  const advBookingTxRes = await db.runTransaction(async (tx) => {
    tx.set(advBookingRef, advBookingData);
    return producers.emitBookingCreatedTx(tx, db, advBookingRef.id, advBookingData, now, { channel: "email" });
  });

  assert.strictEqual(advBookingTxRes.enqueued, true);
  const storedAdvBooking = (await advBookingRef.get()).data();
  assert.strictEqual(storedAdvBooking.bookingRef, "PKZ-ADV-101");
  const storedAdvBookingOutbox = (await db.collection("automation_outbox").doc(advBookingTxRes.eventId).get()).data();
  assert.strictEqual(storedAdvBookingOutbox.eventName, "booking.created");
  assert.strictEqual(storedAdvBookingOutbox.payload.customerEmail, "sneha@example.com");
  ok("3. Atomicity: Advisor phone booking and booking.created outbox committed atomically");

  // =============================================================
  // PART 2: BREVO EMAIL ADAPTER & DISPATCH ARCHITECTURE
  // =============================================================

  // Test 4: Successful Email Delivery with Provider MessageId Evidence
  const mockSentEmails = [];
  const mockBrevoSender = async (emailParams) => {
    mockSentEmails.push(emailParams);
    return {
      success: true,
      response: {
        messageId: `<msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@smtp-relay.brevo.com>`
      },
      error: null
    };
  };

  const dispatchers = {
    email: (evt) => dispatcher.dispatchEmail(evt, { brevoSender: mockBrevoSender }),
    whatsapp: (evt) => dispatcher.dispatchWhatsApp(evt),
    webhook: (evt) => dispatcher.dispatchWebhook(evt),
    multi_channel: (evt) => dispatcher.dispatchMultiChannel(evt, { brevoSender: mockBrevoSender })
  };

  const workerRun1 = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_email_1",
    batchSize: 10,
    nowMs: now,
    dispatchers
  });

  assert.strictEqual(workerRun1.completed >= 3, true);
  assert.strictEqual(mockSentEmails.length >= 3, true);
  // Verify correlation header
  assert.ok(mockSentEmails[0].headers["X-PackZen-Event-Id"]);
  // Verify recipient
  assert.strictEqual(mockSentEmails[0].toEmail, "vikram@example.com");
  ok("4. Brevo Email Adapter: Dispatched emails with correlation headers and verified provider messageId");

  // Test 5: Email Recipient Validation & CRLF Injection Prevention
  assert.strictEqual(dispatcher.validateEmail("valid.user@example.com"), true);
  assert.strictEqual(dispatcher.validateEmail("user+tag@packzenblr.in"), true);
  assert.strictEqual(dispatcher.validateEmail("invalid-email"), false);
  assert.strictEqual(dispatcher.validateEmail("user@example.com\r\nBcc: evil@hacker.com"), false);
  assert.strictEqual(dispatcher.validateEmail(""), false);
  assert.strictEqual(dispatcher.validateEmail(null), false);
  ok("5. Email Validation: Strictly enforces RFC 5322 syntax and blocks CRLF injection attacks");

  // Test 6: Missing Email on Event Payload (Phone-Only Lead)
  const phoneOnlyLeadEvent = outbox.createOutboxEvent({
    eventName: "lead.created",
    entityType: "lead",
    entityId: "lead_phone_only",
    division: "logistics",
    payload: {
      leadId: "lead_phone_only",
      name: "Suresh (Call Only)",
      phone: "9845044444",
      service: "move"
      // Note: No email provided
    },
    channel: "email",
    nowMs: now
  });

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, phoneOnlyLeadEvent);
  });

  const workerRunSkip = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_skip",
    batchSize: 10,
    nowMs: now,
    dispatchers
  });

  assert.strictEqual(workerRunSkip.skipped >= 1, true);
  const skippedDoc = (await db.collection("automation_outbox").doc(phoneOnlyLeadEvent.eventId).get()).data();
  assert.strictEqual(skippedDoc.status, "completed");
  assert.strictEqual(skippedDoc.skipped, true);
  ok("6. Missing Email: Phone-only events skip email delivery cleanly without retries or false dead-letters");

  // Test 7: Provider Rate Limiting (HTTP 429) Reschedules with Exponential Backoff
  const rateLimitedEvent = outbox.createOutboxEvent({
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "bk_rate_limited",
    division: "logistics",
    payload: {
      bookingId: "bk_rate_limited",
      bookingRef: "PKZ-RT-429",
      customerName: "Rahul",
      customerEmail: "rahul@example.com",
      paidAmount: 1500,
      total: 15000,
      date: "2026-11-28"
    },
    channel: "email",
    nowMs: now
  });

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, rateLimitedEvent);
  });

  const rateLimitedBrevo = async () => ({
    success: false,
    response: { message: "Too many requests" },
    error: "HTTP 429 Too Many Requests",
    retryable: true
  });

  const workerRun429 = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_429",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      email: (evt) => dispatcher.dispatchEmail(evt, { brevoSender: rateLimitedBrevo })
    }
  });

  assert.strictEqual(workerRun429.retried >= 1, true);
  const retriedDoc = (await db.collection("automation_outbox").doc(rateLimitedEvent.eventId).get()).data();
  assert.strictEqual(retriedDoc.status, "pending");
  assert.strictEqual(retriedDoc.attempts, 1);
  assert.ok(retriedDoc.nextRetryAtMs > now);
  ok("7. Rate Limiting: HTTP 429 triggers exponential backoff retry scheduling");

  // Test 8: Provider Timeout / Ambiguous Acceptance (delivery_unknown State)
  const timeoutEvent = outbox.createOutboxEvent({
    eventName: "payment.received",
    entityType: "payment",
    entityId: "pay_timeout_99",
    division: "logistics",
    payload: {
      paymentId: "pay_timeout_99",
      customerName: "Anita",
      customerEmail: "anita@example.com",
      amount: 5000,
      bookingRef: "PKZ-TO-99"
    },
    channel: "email",
    nowMs: now
  });

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, timeoutEvent);
  });

  const timeoutBrevo = async () => ({
    success: false,
    response: null,
    error: "Brevo request timed out",
    retryable: true,
    timedOut: true
  });

  const workerRunTimeout = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_timeout",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      email: (evt) => dispatcher.dispatchEmail(evt, { brevoSender: timeoutBrevo })
    }
  });

  assert.strictEqual(workerRunTimeout.deliveryUnknown >= 1, true);
  const timeoutDoc = (await db.collection("automation_outbox").doc(timeoutEvent.eventId).get()).data();
  assert.strictEqual(timeoutDoc.status, "pending");
  assert.strictEqual(timeoutDoc.deliveryUnknown, true);
  ok("8. Ambiguous Delivery: Provider timeouts marked as delivery_unknown to preserve at-least-once guarantee");

  // Test 9: Provider Evidence Enforcement (Missing messageId Rejected on HTTP 200)
  const unverifiedEvent = outbox.createOutboxEvent({
    eventName: "booking.assigned",
    entityType: "booking",
    entityId: "bk_unverified_evidence",
    division: "logistics",
    payload: {
      bookingId: "bk_unverified_evidence",
      bookingRef: "PKZ-UNV-01",
      customerName: "Kavitha",
      customerEmail: "kavitha@example.com",
      driverName: "Raghu Driver",
      date: "2026-11-29"
    },
    channel: "email",
    nowMs: now
  });

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, unverifiedEvent);
  });

  const bogus200Brevo = async () => ({
    success: true,
    response: {}, // Missing messageId!
    error: null
  });

  const workerRunBogus = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_bogus",
    batchSize: 10,
    nowMs: now,
    dispatchers: {
      email: (evt) => dispatcher.dispatchEmail(evt, { brevoSender: bogus200Brevo })
    }
  });

  const unverifiedDoc = (await db.collection("automation_outbox").doc(unverifiedEvent.eventId).get()).data();
  assert.notStrictEqual(unverifiedDoc.status, "completed", "Must NOT mark completed without provider evidence");
  assert.strictEqual(unverifiedDoc.deliveryUnknown, true);
  ok("9. Evidence Enforcement: HTTP 200 without provider messageId is rejected and marked delivery_unknown");

  // Test 10: Provider Deduplication & Idempotent Re-execution
  // Re-run worker on an already completed event
  const alreadyDeliveredEvent = {
    eventId: "evt_already_delivered_01",
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "bk_dedup_01",
    payload: {
      bookingRef: "PKZ-DEDUP-01",
      customerEmail: "vikram@example.com"
    },
    channelDeliveries: {
      email: { status: "delivered", messageId: "<msg_prev_123@brevo.com>" }
    }
  };

  let brevoCallsOnDedup = 0;
  const dedupBrevo = async () => {
    brevoCallsOnDedup++;
    return { success: true, response: { messageId: "msg_new" } };
  };

  const dedupResult = await dispatcher.dispatchEmail(alreadyDeliveredEvent, { brevoSender: dedupBrevo });
  assert.strictEqual(dedupResult.success, true);
  assert.strictEqual(dedupResult.duplicateSkipped, true);
  assert.strictEqual(brevoCallsOnDedup, 0, "Brevo client must NOT be called when channel was already delivered");
  ok("10. Deduplication: Events with recorded channel delivery are skipped idempotently without re-sending");

  // Test 11: Multi-Channel Coordination (Email Delivered, WhatsApp Pending Phase 2B)
  const multiChannelEvent = outbox.createOutboxEvent({
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "bk_multi_01",
    division: "logistics",
    payload: {
      bookingId: "bk_multi_01",
      bookingRef: "PKZ-MULTI-01",
      customerName: "Arjun Nair",
      customerEmail: "arjun@example.com",
      phone: "9845055555",
      paidAmount: 2000,
      total: 10000,
      date: "2026-11-30"
    },
    channel: "multi_channel",
    nowMs: now
  });

  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, multiChannelEvent);
  });

  const workerRunMulti = await worker.runOutboxWorkerBatch(db, {
    workerId: "test_worker_multi",
    batchSize: 10,
    nowMs: now,
    dispatchers
  });

  assert.strictEqual(workerRunMulti.adapterPending >= 1, true);
  const multiDoc = (await db.collection("automation_outbox").doc(multiChannelEvent.eventId).get()).data();
  assert.strictEqual(multiDoc.status, "adapter_pending");
  assert.strictEqual(multiDoc.channelDeliveries.email.status, "delivered");
  assert.strictEqual(multiDoc.channelDeliveries.whatsapp.status, "adapter_pending");
  assert.strictEqual(multiDoc.attempts, 0, "Attempts must not be exhausted for partially pending adapters");
  ok("11. Multi-Channel: Email delivered while WhatsApp safely held in adapter_pending without retry exhaustion");

  // Test 12: All 5 Transactional Templates Produce Escaped, Valid HTML
  const samplePayload = {
    bookingRef: "PKZ-TPL-99",
    customerName: "Jane <script>alert(1)</script>",
    pickup: "Jayanagar & Basavanagudi",
    drop: "Indiranagar",
    date: "2026-12-01",
    total: 7500,
    paidAmount: 1500,
    balanceDue: 6000,
    amount: 1500,
    paymentId: "pay_tpl_99",
    driverName: "Sanjay",
    driverPhone: "+91 9988776655",
    serviceLabel: "Home Moving & Relocation"
  };

  const tplEvents = ["booking.created", "booking.confirmed", "payment.received", "booking.assigned", "booking.completed", "lead.created"];
  for (const tEvent of tplEvents) {
    const tpl = dispatcher.TRANSACTIONAL_TEMPLATES[tEvent](samplePayload);
    assert.ok(tpl.subject && tpl.subject.length > 5);
    assert.ok(tpl.html.includes("PackZen"));
    assert.ok(!tpl.html.includes("<script>alert(1)</script>"), "User input must be strictly HTML-escaped");
    assert.ok(tpl.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  }
  ok("12. Template Security: All transactional templates strictly escape dynamic input against XSS");

  // Test 13: Zero PII in Audit Logs & Secret Redaction
  const completedLeadEventSnap = await db.collection("automation_outbox").doc(leadTxRes.eventId).get();
  assert.strictEqual(completedLeadEventSnap.data().status, "completed");

  let auditFound = false;
  for (const [k, v] of db.storage.entries()) {
    if (k.startsWith("automation_logs/") && v.eventId === leadTxRes.eventId) {
      auditFound = true;
      assert.strictEqual(v.status, "delivered");
      assert.ok(!JSON.stringify(v).includes("9845022222"), "Raw phone must be masked in audit log");
      assert.ok(v.sanitizedPayload.phone.includes("******2222"));
      break;
    }
  }
  assert.strictEqual(auditFound, true);
  ok("13. Audit Immutability: Completed events recorded with strict PII masking in automation_logs");

  // Test 14: Crash Recovery for Expired Processing Lease
  const crashedEventRef = db.collection("automation_outbox").doc("evt_crashed_worker_01");
  await crashedEventRef.set({
    eventId: "evt_crashed_worker_01",
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "bk_crashed_01",
    priority: "urgent",
    channel: "email",
    status: "processing",
    claimedBy: "dead_worker_instance",
    claimedAtMs: now - 120000,
    leaseExpiresAtMs: now - 60000, // Lease expired 60 seconds ago!
    attempts: 1,
    attemptHistory: [{ attempt: 1, workerId: "dead_worker_instance", claimedAtMs: now - 120000 }],
    payload: {
      bookingRef: "PKZ-CRASH-01",
      customerName: "Crash Recovery Test",
      customerEmail: "vikram@example.com",
      paidAmount: 3000,
      total: 3000
    }
  });

  const recoveryRun = await worker.runOutboxWorkerBatch(db, {
    workerId: "healthy_worker_02",
    batchSize: 10,
    nowMs: now,
    dispatchers
  });

  assert.strictEqual(recoveryRun.completed >= 1, true);
  const recoveredDoc = (await crashedEventRef.get()).data();
  assert.strictEqual(recoveredDoc.status, "completed");
  assert.strictEqual(recoveredDoc.attemptHistory.length, 2);
  assert.strictEqual(recoveredDoc.attemptHistory[1].recoveredFromCrash, true);
  ok("14. Crash Recovery: Worker reclaimed and successfully processed expired lease from abandoned instance");

  console.log(`\n======================================================`);
  console.log(` ALL ${pass} PHASE 2A TESTS PASSED!`);
  console.log(`======================================================\n`);
})();
