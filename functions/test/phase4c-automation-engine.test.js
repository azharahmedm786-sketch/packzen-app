/**
 * PACKZEN 3.0 — Phase 4C Cross-Division Automation Engine Test Suite
 * ------------------------------------------------------------------
 * Verifies cross-division transactional outbox event producers,
 * dispatching templates, and multi-channel notification rendering.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  emitLeadAssignedTx,
  emitLeadSlaBreachTx,
  emitDailySummaryTx
} = require("../automation-producers");

const dispatcher = require("../automation-dispatcher");
const worker = require("../automation-worker");
const outbox = require("../automation-outbox");

// Mock Transactional Database for Outbox Testing
class MockTxDb {
  constructor() {
    this.docs = new Map();
  }

  collection(name) {
    const self = this;
    return {
      doc(id) {
        const docId = id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        return {
          id: docId,
          path: `${name}/${docId}`
        };
      }
    };
  }

  runTransaction(fn) {
    const operations = [];
    const tx = {
      set: (ref, data) => {
        operations.push({ type: "set", ref, data });
      },
      update: (ref, data) => {
        operations.push({ type: "update", ref, data });
      },
      get: async (ref) => {
        const existing = this.docs.get(ref.path);
        return {
          id: ref.id,
          exists: Boolean(existing),
          data: () => existing
        };
      }
    };

    return fn(tx).then(res => {
      for (const op of operations) {
        if (op.type === "set") {
          this.docs.set(op.ref.path, JSON.parse(JSON.stringify(op.data)));
        } else if (op.type === "update") {
          const current = this.docs.get(op.ref.path) || {};
          this.docs.set(op.ref.path, Object.assign({}, current, JSON.parse(JSON.stringify(op.data))));
        }
      }
      return res;
    });
  }
}

console.log("\n--- PACKZEN 3.0 PHASE 4C CROSS-DIVISION AUTOMATION TESTS ---\n");

test("1. Outbox Producer (lead.assigned): Enqueues high-priority outbox event atomically", async () => {
  const db = new MockTxDb();
  let result = null;

  await db.runTransaction(async (tx) => {
    result = await emitLeadAssignedTx(tx, db, "lead_99", {
      advisorId: "adv_suresh",
      advisorName: "Suresh Sharma",
      advisorEmail: "suresh@packzenblr.in",
      customerName: "Priya Nair",
      customerPhone: "9876501234",
      service: "Packers and Movers",
      division: "logistics"
    });
  });

  assert.ok(result);
  assert.strictEqual(result.enqueued, true);
  assert.strictEqual(result.duplicate, false);

  // Verify stored in outbox collection
  const storedDoc = Array.from(db.docs.values()).find(d => d.eventName === "lead.assigned");
  assert.ok(storedDoc);
  assert.strictEqual(storedDoc.eventName, "lead.assigned");
  assert.strictEqual(storedDoc.priority, "high");
  assert.strictEqual(storedDoc.entityId, "lead_99");
  assert.strictEqual(storedDoc.payload.customerName, "Priya Nair");
  assert.strictEqual(storedDoc.status, "pending");
});

test("2. Outbox Producer (lead.sla_breach): Enqueues urgent escalation event atomically", async () => {
  const db = new MockTxDb();
  let result = null;

  await db.runTransaction(async (tx) => {
    result = await emitLeadSlaBreachTx(tx, db, "lead_102", {
      customerName: "Rohan Patel",
      customerPhone: "9123456789",
      elapsedMinutes: 45,
      division: "home_services",
      service: "AC Deep Clean"
    });
  });

  assert.ok(result);
  assert.strictEqual(result.enqueued, true);

  const storedDoc = Array.from(db.docs.values()).find(d => d.eventName === "lead.sla_breach");
  assert.ok(storedDoc);
  assert.strictEqual(storedDoc.eventName, "lead.sla_breach");
  assert.strictEqual(storedDoc.priority, "urgent");
  assert.strictEqual(storedDoc.payload.elapsedMinutes, 45);
  assert.strictEqual(storedDoc.payload.division, "home_services");
  assert.strictEqual(storedDoc.payload.service, "AC Deep Clean");
});

test("3. Outbox Producer (daily.summary): Enqueues executive briefing event", async () => {
  const db = new MockTxDb();
  let result = null;

  await db.runTransaction(async (tx) => {
    result = await emitDailySummaryTx(tx, db, "sum_20261119", {
      date: "2026-11-19",
      totalLeads: 14,
      activeJobs: 6,
      grossCollections: 85000,
      outstandingReceivables: 22000
    });
  });

  assert.ok(result);
  assert.strictEqual(result.enqueued, true);

  const storedDoc = Array.from(db.docs.values()).find(d => d.eventName === "daily.summary");
  assert.ok(storedDoc);
  assert.strictEqual(storedDoc.eventName, "daily.summary");
  assert.strictEqual(storedDoc.priority, "normal");
  assert.strictEqual(storedDoc.payload.grossCollections, 85000);
  assert.strictEqual(storedDoc.payload.totalLeads, 14);
});

test("4. Dispatcher Template: Renders lead.assigned notification email accurately", async () => {
  const payload = {
    advisorName: "Suresh Sharma",
    advisorEmail: "suresh@packzenblr.in",
    customerName: "Priya Nair",
    customerPhone: "9876501234",
    service: "Household Shifting (3BHK)",
    division: "logistics"
  };

  const email = dispatcher.renderEmailTemplate("lead.assigned", payload);
  assert.ok(email);
  assert.ok(email.subject.includes("Priya Nair"));
  assert.ok(email.html.includes("Suresh Sharma"));
  assert.ok(email.html.includes("Household Shifting (3BHK)"));
});

test("5. Dispatcher Template: Renders lead.sla_breach escalation notification accurately", async () => {
  const payload = {
    leadId: "lead_102",
    customerName: "Rohan Patel",
    customerPhone: "9123456789",
    elapsedMinutes: 45,
    division: "home_services",
    service: "AC Deep Clean"
  };

  const email = dispatcher.renderEmailTemplate("lead.sla_breach", payload);
  assert.ok(email);
  assert.ok(email.subject.includes("SLA Breach") || email.subject.includes("SLA"));
  assert.ok(email.html.includes("45 mins") || email.html.includes("45"));
  assert.ok(email.html.includes("Rohan Patel"));
  assert.ok(email.html.includes("lead_102"));
});

test("6. Dispatcher Template: Renders daily.summary executive briefing accurately", async () => {
  const payload = {
    date: "2026-11-19",
    totalLeads: 14,
    activeJobs: 6,
    grossCollections: 85000,
    outstandingReceivables: 22000
  };

  const email = dispatcher.renderEmailTemplate("daily.summary", payload);
  assert.ok(email);
  assert.ok(email.subject.includes("Daily Business Summary") || email.subject.includes("Briefing"));
  assert.ok(email.html.includes("85,000"));
  assert.ok(email.html.includes("14"));
  assert.ok(email.html.includes("22,000"));
});
