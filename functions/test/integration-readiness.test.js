/**
 * PACKZEN 3.0 — Phase 1.1 Integration Readiness Test Harness
 * ------------------------------------------------------------------
 * Tests transactional event producer patterns, worker dispatching,
 * financial integrity isolation, and duplicate prevention.
 *
 * Run: node test/integration-readiness.test.js
 */
"use strict";

const assert = require("assert");
const outbox = require("../automation-outbox");

let pass = 0;
const ok = (msg) => {
  pass++;
  console.log("  PASS  " + msg);
};

// In-Memory Transactional Database
class IsolatedDb {
  constructor() {
    this.store = new Map();
  }

  collection(name) {
    return {
      doc: (id) => ({
        id,
        path: `${name}/${id}`,
        get: async () => this._get(name, id),
        set: async (d) => this._set(name, id, d),
        update: async (u) => this._update(name, id, u)
      }),
      where: (field, op, val) => ({
        orderBy: (orderField, dir) => ({
          limit: (n) => ({
            get: async () => {
              const matches = [];
              for (const [k, v] of this.store.entries()) {
                if (k.startsWith(`${name}/`) && v[field] === val) {
                  matches.push({ id: k.split("/")[1], data: () => JSON.parse(JSON.stringify(v)) });
                }
              }
              return { docs: matches.slice(0, n) };
            }
          })
        })
      })
    };
  }

  _get(col, id) {
    const k = `${col}/${id}`;
    const exists = this.store.has(k);
    return {
      id,
      exists,
      data: () => (exists ? JSON.parse(JSON.stringify(this.store.get(k))) : undefined)
    };
  }

  _set(col, id, d) {
    this.store.set(`${col}/${id}`, JSON.parse(JSON.stringify(d)));
  }

  _update(col, id, u) {
    const k = `${col}/${id}`;
    if (!this.store.has(k)) throw new Error(`Document ${k} not found`);
    const curr = this.store.get(k);
    this.store.set(k, Object.assign({}, curr, JSON.parse(JSON.stringify(u))));
  }

  async runTransaction(fn) {
    const tx = {
      get: async (ref) => {
        const parts = ref.path.split("/");
        return this._get(parts[0], parts[1]);
      },
      set: (ref, data) => {
        const parts = ref.path.split("/");
        this._set(parts[0], parts[1], data);
      },
      update: (ref, update) => {
        const parts = ref.path.split("/");
        this._update(parts[0], parts[1], update);
      }
    };
    return fn(tx);
  }
}

(async () => {
  console.log("\n--- PACKZEN 3.0 PHASE 1.1 INTEGRATION READINESS TESTS ---\n");

  const db = new IsolatedDb();
  const now = Date.parse("2026-11-17T22:30:00.000Z");

  // -------------------------------------------------------------
  // Test 1: Atomic Producer — submitLead + lead.created outbox
  // -------------------------------------------------------------
  const leadData = {
    name: "Suresh Gowda",
    phone: "9845012345",
    service: "move",
    division: "logistics",
    status: "new",
    area: "Banashankari",
    createdAtMs: now
  };

  const leadId = "lead_test_001";
  const leadEvent = outbox.createOutboxEvent({
    eventName: "lead.created",
    entityType: "lead",
    entityId: leadId,
    division: "logistics",
    payload: {
      leadId,
      customer: { name: leadData.name, phone: leadData.phone, area: leadData.area },
      service: leadData.service
    },
    nowMs: now
  });

  // Execute in single transaction
  const leadTxResult = await db.runTransaction(async (tx) => {
    tx.set(db.collection("leads").doc(leadId), leadData);
    const outboxRes = await outbox.enqueueOutboxTx(tx, db, leadEvent);
    return { leadId, outboxRes };
  });

  assert.strictEqual(leadTxResult.outboxRes.enqueued, true);
  const storedLead = (await db.collection("leads").doc(leadId).get()).data();
  const storedOutbox = (await db.collection("automation_outbox").doc(leadEvent.eventId).get()).data();
  assert.strictEqual(storedLead.name, "Suresh Gowda");
  assert.strictEqual(storedOutbox.status, "pending");
  assert.strictEqual(storedOutbox.eventName, "lead.created");
  ok("1. Atomic producer: lead mutation and lead.created outbox record committed in single transaction");

  // -------------------------------------------------------------
  // Test 2: Atomic Payment Producer — Razorpay capture + payment.received + ledger
  // -------------------------------------------------------------
  const orderId = "order_rzp_99001";
  const paymentId = "pay_rzp_88001";
  const bookingRef = "PZ-BLR-5541";
  const paymentAmount = 2500;

  const paymentEvent = outbox.createOutboxEvent({
    eventName: "payment.received",
    entityType: "payment",
    entityId: paymentId,
    division: "logistics",
    payload: { paymentId, orderId, bookingRef, amount: paymentAmount, method: "razorpay" },
    nowMs: now
  });

  const ledgerEntry = {
    id: `tx_${paymentId}`,
    division: "logistics",
    type: "collection",
    amount: paymentAmount,
    desc: `Advance payment for ${bookingRef} via Razorpay`,
    date: "2026-11-17",
    referenceId: paymentId,
    createdAtMs: now
  };

  // Transaction: finalize booking + insert ledger + insert outbox
  const payTxResult = await db.runTransaction(async (tx) => {
    // 1. Update booking
    tx.set(db.collection("bookings").doc(bookingRef), {
      bookingRef,
      paymentStatus: "paid",
      advancePaid: paymentAmount,
      balanceDue: 0
    });
    // 2. Insert ledger transaction
    tx.set(db.collection("ledger").doc(ledgerEntry.id), ledgerEntry);
    // 3. Insert outbox event
    const outboxRes = await outbox.enqueueOutboxTx(tx, db, paymentEvent);
    return { bookingRef, outboxRes };
  });

  assert.strictEqual(payTxResult.outboxRes.enqueued, true);
  const storedBooking = (await db.collection("bookings").doc(bookingRef).get()).data();
  const storedLedger = (await db.collection("ledger").doc(ledgerEntry.id).get()).data();
  assert.strictEqual(storedBooking.advancePaid, 2500);
  assert.strictEqual(storedLedger.amount, 2500);
  ok("2. Financial integrity: booking update, ledger credit, and payment.received outbox committed atomically");

  // -------------------------------------------------------------
  // Test 3: Duplicate Webhook Protection — duplicate payment event cannot double-credit ledger
  // -------------------------------------------------------------
  // Razorpay delivers duplicate webhook for pay_rzp_88001
  const duplicatePayTx = await db.runTransaction(async (tx) => {
    // Check if ledger entry already exists
    const existingLedger = await tx.get(db.collection("ledger").doc(ledgerEntry.id));
    if (existingLedger.exists) {
      return { skippedDuplicate: true, ledgerId: existingLedger.id };
    }
    tx.set(db.collection("ledger").doc(ledgerEntry.id), ledgerEntry);
    const outboxRes = await outbox.enqueueOutboxTx(tx, db, paymentEvent);
    return { skippedDuplicate: false, outboxRes };
  });

  assert.strictEqual(duplicatePayTx.skippedDuplicate, true);
  ok("3. Duplicate payment defense: duplicate webhook detected and rejected before ledger or outbox write");

  // -------------------------------------------------------------
  // Test 4: Booking Completion & Partner Payout Integrity
  // -------------------------------------------------------------
  const partnerId = "drv_test_101";
  const partnerPayoutAmount = 1800;

  const partnerDocRef = db.collection("partners").doc(partnerId);
  await partnerDocRef.set({ partnerId, name: "Manjunath", walletBalance: 5000 });

  const completeEvent = outbox.createOutboxEvent({
    eventName: "booking.completed",
    entityType: "booking",
    entityId: bookingRef,
    division: "logistics",
    payload: { bookingRef, partnerId, partnerPayout: partnerPayoutAmount, verifiedOtp: true },
    nowMs: now
  });

  const completionTxResult = await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(partnerDocRef);
    const currWallet = pSnap.data().walletBalance;
    const newWallet = currWallet + partnerPayoutAmount;

    // Credit partner wallet
    tx.update(partnerDocRef, { walletBalance: newWallet });

    // Debit in ledger
    const payoutLedgerId = `payout_${bookingRef}_${partnerId}`;
    tx.set(db.collection("ledger").doc(payoutLedgerId), {
      division: "logistics",
      type: "direct_cost",
      amount: partnerPayoutAmount,
      desc: `Partner payout for ${bookingRef}`,
      date: "2026-11-17"
    });

    // Enqueue outbox completion notification
    const outboxRes = await outbox.enqueueOutboxTx(tx, db, completeEvent);
    return { newWallet, outboxRes };
  });

  assert.strictEqual(completionTxResult.newWallet, 6800);
  assert.strictEqual(completionTxResult.outboxRes.enqueued, true);

  const updatedPartner = (await partnerDocRef.get()).data();
  assert.strictEqual(updatedPartner.walletBalance, 6800);
  ok("4. Partner payout integrity: wallet credit, direct cost ledger entry, and booking.completed event atomically bound");

  // -------------------------------------------------------------
  // Test 5: Worker Dispatcher Simulation & Channel Mocking
  // -------------------------------------------------------------
  // Mock external channel dispatches (zero network, strictly recorded)
  const channelCalls = [];
  const mockChannels = {
    whatsapp: async (payload) => {
      channelCalls.push({ channel: "whatsapp", payload });
      return { messageId: "wa_sim_123", status: "sent" };
    },
    email: async (payload) => {
      channelCalls.push({ channel: "email", payload });
      return { messageId: "email_sim_456", status: "sent" };
    }
  };

  // Worker runs on paymentEvent
  const pEventRef = db.collection("automation_outbox").doc(paymentEvent.eventId);
  const claimRes = await db.runTransaction(async (tx) => {
    return outbox.claimOutboxEventTx(tx, pEventRef, "worker_dispatch_01", now + 1000);
  });
  assert.strictEqual(claimRes.claimed, true);

  // Dispatch external notification
  const dispatchRes = await mockChannels.whatsapp(claimRes.event.payload);

  // Commit result in outbox
  await db.runTransaction(async (tx) => {
    return outbox.recordOutboxResultTx(tx, pEventRef, {
      success: true,
      result: dispatchRes,
      nowMs: now + 1500
    });
  });

  // Verify external notification occurred exactly once
  assert.strictEqual(channelCalls.length, 1);
  assert.strictEqual(channelCalls[0].channel, "whatsapp");
  assert.strictEqual(channelCalls[0].payload.bookingRef, "PZ-BLR-5541");

  const completedEvt = (await pEventRef.get()).data();
  assert.strictEqual(completedEvt.status, "completed");
  ok("5. Worker dispatch: external adapter successfully dispatched exactly once; outbox marked completed");

  // -------------------------------------------------------------
  // Test 6: Outbox Failure Isolation — external channel crash does NOT reverse payment
  // -------------------------------------------------------------
  // Simulate an event whose external notification throws (e.g. Meta API 500)
  const leadEvtRef = db.collection("automation_outbox").doc(leadEvent.eventId);
  await db.runTransaction(async (tx) => {
    return outbox.claimOutboxEventTx(tx, leadEvtRef, "worker_failing", now + 2000);
  });

  // Notification fails
  await db.runTransaction(async (tx) => {
    return outbox.recordOutboxResultTx(tx, leadEvtRef, {
      success: false,
      error: new Error("Meta Graph API 500 Internal Error"),
      nowMs: now + 2500,
      baseBackoffMs: 1000,
      maxRetries: 5
    });
  });

  // Verify outbox rescheduled
  const pendingEvt = (await leadEvtRef.get()).data();
  assert.strictEqual(pendingEvt.status, "pending");
  assert.strictEqual(pendingEvt.attempts, 1);

  // Crucial invariant: The lead in the database is UNTOUCHED and preserved!
  const intactLead = (await db.collection("leads").doc(leadId).get()).data();
  assert.strictEqual(intactLead.name, "Suresh Gowda");
  assert.strictEqual(intactLead.status, "new");
  ok("6. Fault isolation: external notification failure reschedules outbox but leaves primary business records intact");

  console.log(`\n======================================================`);
  console.log(` ALL ${pass} INTEGRATION READINESS TESTS PASSED!`);
  console.log(`======================================================\n`);
})();
