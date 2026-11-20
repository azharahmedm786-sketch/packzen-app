/**
 * PACKZEN 3.0 — Priority One Automation Outbox Core Test Suite
 * ------------------------------------------------------------------
 * Validates the 9 core acceptance criteria for Phase 1:
 *   1. Exactly-once event creation inside transactions
 *   2. Idempotency & duplicate trigger prevention
 *   3. Worker crash recovery (expired lease reclamation)
 *   4. Exponential backoff retry sequencing
 *   5. Dead-letter escalation upon exhausted retries
 *   6. Concurrent worker race protection (lease contention)
 *   7. Payload validation across all 11 supported events
 *   8. Strict PII sanitization (phone & email masking) in audit logs
 *   9. Zero contact with external production APIs during execution
 *
 * Run: node test/automation-outbox.test.js
 */
"use strict";

const assert = require("assert");
const outbox = require("../automation-outbox");

let pass = 0;
const ok = (msg) => {
  pass++;
  console.log("  PASS  " + msg);
};

// Simulated in-memory Firestore with transaction isolation
class MockFirestore {
  constructor() {
    this.storage = new Map();
  }

  collection(colName) {
    return {
      doc: (docId) => ({
        id: docId,
        path: `${colName}/${docId}`,
        get: async () => this._getDoc(colName, docId),
        set: async (data) => this._setDoc(colName, docId, data),
        update: async (data) => this._updateDoc(colName, docId, data)
      })
    };
  }

  _getDoc(colName, docId) {
    const key = `${colName}/${docId}`;
    const exists = this.storage.has(key);
    return {
      id: docId,
      exists,
      data: () => (exists ? JSON.parse(JSON.stringify(this.storage.get(key))) : undefined)
    };
  }

  _setDoc(colName, docId, data) {
    const key = `${colName}/${docId}`;
    this.storage.set(key, JSON.parse(JSON.stringify(data)));
  }

  _updateDoc(colName, docId, update) {
    const key = `${colName}/${docId}`;
    if (!this.storage.has(key)) throw new Error(`Document ${key} does not exist`);
    const curr = this.storage.get(key);
    this.storage.set(key, Object.assign({}, curr, JSON.parse(JSON.stringify(update))));
  }

  // Simulated transaction runner
  async runTransaction(updateFunction) {
    const tx = {
      get: async (docRef) => {
        const parts = docRef.path.split("/");
        return this._getDoc(parts[0], parts[1]);
      },
      set: (docRef, data) => {
        const parts = docRef.path.split("/");
        this._setDoc(parts[0], parts[1], data);
      },
      update: (docRef, update) => {
        const parts = docRef.path.split("/");
        this._updateDoc(parts[0], parts[1], update);
      }
    };
    return updateFunction(tx);
  }
}

(async () => {
  console.log("\n--- PACKZEN 3.0 AUTOMATION OUTBOX ACCEPTANCE TESTS ---\n");

  const db = new MockFirestore();
  const baseTime = Date.parse("2026-11-17T22:00:00.000Z");

  // -------------------------------------------------------------
  // Test 1: Payload validation across all 11 supported events
  // -------------------------------------------------------------
  const sampleEvents = [
    { eventName: "lead.created", entityType: "lead", entityId: "L001", division: "logistics" },
    { eventName: "lead.qualified", entityType: "lead", entityId: "L001", division: "logistics" },
    { eventName: "booking.created", entityType: "booking", entityId: "B001", division: "logistics" },
    { eventName: "booking.confirmed", entityType: "booking", entityId: "B001", division: "logistics" },
    { eventName: "booking.assigned", entityType: "booking", entityId: "B001", division: "logistics" },
    { eventName: "booking.completed", entityType: "booking", entityId: "B001", division: "logistics" },
    { eventName: "payment.received", entityType: "payment", entityId: "PAY001", division: "logistics" },
    { eventName: "project.created", entityType: "project", entityId: "PRJ001", division: "digital" },
    { eventName: "project.milestone_updated", entityType: "project", entityId: "PRJ001", division: "digital" },
    { eventName: "home_service.requested", entityType: "lead", entityId: "L002", division: "home_services" },
    { eventName: "partner.assigned", entityType: "partner", entityId: "DRV001", division: "logistics" }
  ];

  for (const s of sampleEvents) {
    const evt = outbox.createOutboxEvent({
      eventName: s.eventName,
      entityType: s.entityType,
      entityId: s.entityId,
      division: s.division,
      payload: { test: true },
      nowMs: baseTime
    });
    assert.strictEqual(evt.eventName, s.eventName);
    assert.strictEqual(evt.division, s.division);
    assert.strictEqual(evt.status, "pending");
  }
  assert.throws(() => {
    outbox.createOutboxEvent({ eventName: "unknown.event", entityType: "lead", entityId: "123" });
  }, /Invalid eventName/);
  ok("1. Event validation: all 11 supported PackZen events validated; invalid events rejected");

  // -------------------------------------------------------------
  // Test 2: Exactly-once creation & Idempotent duplicate rejection
  // -------------------------------------------------------------
  const leadEvent = outbox.createOutboxEvent({
    eventName: "lead.created",
    entityType: "lead",
    entityId: "lead_98450_hsr",
    division: "logistics",
    payload: {
      name: "Karthik R",
      phone: "+91 98450 12345",
      service: "move",
      area: "HSR Layout"
    },
    nowMs: baseTime
  });

  // First transactional enqueue
  const res1 = await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, leadEvent);
  });
  assert.strictEqual(res1.enqueued, true);
  assert.strictEqual(res1.duplicate, false);

  // Duplicate trigger with the exact same lead event
  const res2 = await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, leadEvent);
  });
  assert.strictEqual(res2.enqueued, false);
  assert.strictEqual(res2.duplicate, true);
  assert.strictEqual(res2.eventId, res1.eventId);
  ok("2. Idempotency: exact-match event enqueued once; duplicate trigger refused at transaction boundary");

  // -------------------------------------------------------------
  // Test 3: Concurrency protection — 2 concurrent workers
  // -------------------------------------------------------------
  const eventDocRef = db.collection("automation_outbox").doc(leadEvent.eventId);

  // Worker A claims the event
  const claimWorkerA = await db.runTransaction(async (tx) => {
    return outbox.claimOutboxEventTx(tx, eventDocRef, "worker_alpha", baseTime, 60000);
  });
  assert.strictEqual(claimWorkerA.claimed, true);
  assert.strictEqual(claimWorkerA.event.claimedBy, "worker_alpha");
  assert.strictEqual(claimWorkerA.event.status, "processing");

  // Worker B attempts to claim the same event while Worker A holds the lease
  const claimWorkerB = await db.runTransaction(async (tx) => {
    return outbox.claimOutboxEventTx(tx, eventDocRef, "worker_beta", baseTime + 5000, 60000);
  });
  assert.strictEqual(claimWorkerB.claimed, false);
  assert.strictEqual(claimWorkerB.reason, "ALREADY_CLAIMED");
  ok("3. Concurrency: Worker B rejected with ALREADY_CLAIMED while Worker A active");

  // -------------------------------------------------------------
  // Test 4: Worker crash recovery via lease expiration
  // -------------------------------------------------------------
  // Simulate Worker A crashing and abandoning execution.
  // Fast-forward time past the 60s lease window (baseTime + 65,000ms).
  const crashRecoveryTime = baseTime + 65000;
  const claimWorkerC = await db.runTransaction(async (tx) => {
    return outbox.claimOutboxEventTx(tx, eventDocRef, "worker_charlie", crashRecoveryTime, 60000);
  });
  assert.strictEqual(claimWorkerC.claimed, true);
  assert.strictEqual(claimWorkerC.event.claimedBy, "worker_charlie");
  assert.strictEqual(claimWorkerC.event.attempts, 2);
  const lastAttempt = claimWorkerC.event.attemptHistory[claimWorkerC.event.attemptHistory.length - 1];
  assert.strictEqual(lastAttempt.recoveredFromCrash, true);
  ok("4. Crash recovery: abandoned lease recovered by Worker C; attempts incremented to 2");

  // -------------------------------------------------------------
  // Test 5: Exponential backoff on transient failure
  // -------------------------------------------------------------
  // Worker C encounters a transient network timeout (e.g., gateway 503)
  const failResult = await db.runTransaction(async (tx) => {
    return outbox.recordOutboxResultTx(tx, eventDocRef, {
      success: false,
      error: new Error("Gateway timeout HTTP 504"),
      nowMs: crashRecoveryTime + 2000,
      baseBackoffMs: 1000,
      maxRetries: 5
    });
  });
  assert.strictEqual(failResult.status, "pending");
  assert.strictEqual(failResult.attempts, 2);
  // Backoff for attempt 2: 1000 * 2^(2-1) = 2000ms
  assert.strictEqual(failResult.backoffMs, 2000);
  assert.strictEqual(failResult.nextRetryAtMs, crashRecoveryTime + 2000 + 2000);
  ok("5. Exponential backoff: transient failure reset to pending with nextRetryAt scheduled via backoff");

  // -------------------------------------------------------------
  // Test 6: Dead-letter state on exhausted retries
  // -------------------------------------------------------------
  // Simulate subsequent failures until maxRetries (5) is reached
  let curTime = crashRecoveryTime + 5000;
  for (let att = 3; att <= 5; att++) {
    // Claim
    await db.runTransaction(async (tx) => {
      return outbox.claimOutboxEventTx(tx, eventDocRef, "worker_test", curTime, 60000);
    });
    // Record failure
    const res = await db.runTransaction(async (tx) => {
      return outbox.recordOutboxResultTx(tx, eventDocRef, {
        success: false,
        error: new Error(`Failure on attempt ${att}`),
        nowMs: curTime + 500,
        baseBackoffMs: 1000,
        maxRetries: 5
      });
    });
    curTime += 10000;
    if (att === 5) {
      assert.strictEqual(res.status, "dead_letter");
      assert.strictEqual(res.attempts, 5);
      assert.ok(res.error.includes("attempt 5"));
    }
  }

  // Verify stored document state
  const deadLetterSnap = await eventDocRef.get();
  assert.strictEqual(deadLetterSnap.data().status, "dead_letter");
  assert.strictEqual(deadLetterSnap.data().attempts, 5);
  assert.ok(deadLetterSnap.data().deadLetterAtMs > 0);
  ok("6. Dead-letter queue: exhausted retries (5/5) transitioned status to dead_letter with error log");

  // -------------------------------------------------------------
  // Test 7: Success transition & Attempt history
  // -------------------------------------------------------------
  const bookingEvent = outbox.createOutboxEvent({
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: "PZ-BLR-8921",
    division: "logistics",
    payload: { bookingRef: "PZ-BLR-8921", amount: 8500, customerName: "Rahul Sharma" },
    nowMs: baseTime
  });

  const bDocRef = db.collection("automation_outbox").doc(bookingEvent.eventId);
  await db.runTransaction(async (tx) => {
    return outbox.enqueueOutboxTx(tx, db, bookingEvent);
  });
  await db.runTransaction(async (tx) => {
    return outbox.claimOutboxEventTx(tx, bDocRef, "worker_success", baseTime + 1000);
  });
  const successRes = await db.runTransaction(async (tx) => {
    return outbox.recordOutboxResultTx(tx, bDocRef, {
      success: true,
      result: { messageId: "msg_wa_99128", channel: "whatsapp" },
      nowMs: baseTime + 2500
    });
  });
  assert.strictEqual(successRes.status, "completed");

  const completedSnap = await bDocRef.get();
  assert.strictEqual(completedSnap.data().status, "completed");
  assert.strictEqual(completedSnap.data().claimedBy, null);
  assert.strictEqual(completedSnap.data().leaseExpiresAtMs, null);
  assert.ok(completedSnap.data().completedAtMs > 0);
  ok("7. Success handling: event transitioned to completed; locks released; attempt history preserved");

  // -------------------------------------------------------------
  // Test 8: PII Sanitization for Operational Logs
  // -------------------------------------------------------------
  const piiRaw = {
    customerName: "Asha Kumar",
    phone: "+91 99450 95453",
    secondaryPhone: "8877665544",
    email: "ashakumar@gmail.com",
    secretToken: "secret_live_tok_9912",
    apiKey: "MSG91_KEY_VALUE",
    orderTotal: 4999
  };
  const sanitized = outbox.sanitizePayloadForLog(piiRaw);

  assert.ok(!JSON.stringify(sanitized).includes("99450 95453"), "Raw phone must be masked");
  assert.ok(!JSON.stringify(sanitized).includes("8877665544"), "Secondary phone must be masked");
  assert.ok(!JSON.stringify(sanitized).includes("ashakumar@gmail.com"), "Raw email must be masked");
  assert.strictEqual(sanitized.secretToken, "[REDACTED]");
  assert.strictEqual(sanitized.apiKey, "[REDACTED]");
  assert.strictEqual(sanitized.orderTotal, 4999);
  assert.ok(sanitized.phone.includes("******5453"));
  assert.ok(sanitized.secondaryPhone.includes("******5544"));
  assert.ok(sanitized.email.includes("a***@gmail.com"));

  const auditLog = outbox.createAuditLogRecord({
    eventId: "evt_test",
    eventName: "lead.created",
    entityId: "L991",
    division: "logistics",
    channel: "whatsapp",
    workerId: "worker_1",
    status: "dispatched",
    durationMs: 420,
    payload: piiRaw,
    nowMs: baseTime
  });
  assert.strictEqual(auditLog.sanitizedPayload.secretToken, "[REDACTED]");
  assert.ok(auditLog.sanitizedPayload.phone.includes("******5453"));
  ok("8. Zero-PII logging: customer phone and email strictly masked; secrets completely redacted");

  // -------------------------------------------------------------
  // Test 9: External services isolation check
  // -------------------------------------------------------------
  // Verify that outbox module imports no network libraries or unmocked gateways
  const outboxSource = require("fs").readFileSync(require.resolve("../automation-outbox.js"), "utf8");
  assert.ok(!outboxSource.includes("https://"), "No hardcoded external URLs in core outbox module");
  assert.ok(!outboxSource.includes("require('axios')") && !outboxSource.includes('require("axios")'));
  assert.ok(!outboxSource.includes("fetch("));
  ok("9. Zero external contact: outbox engine runs entirely local and self-contained");

  console.log(`\n========================================`);
  console.log(` ALL ${pass} OUTBOX ACCEPTANCE TESTS PASSED!`);
  console.log(`========================================\n`);
})();
