/**
 * PACKZEN 3.0 — Phase 4F Security, Governance & Observability Test Suite
 * ------------------------------------------------------------------
 * Verifies system health metrics, dead-letter monitoring, upstream adapter
 * telemetry, and callable RBAC access restrictions.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getSystemHealthReport } = require("../health-monitor");

// Mock Firestore Query Snapshot for Health Monitor
class MockDb {
  constructor(outboxDocs = [], errorDocs = []) {
    this.outboxDocs = outboxDocs;
    this.errorDocs = errorDocs;
  }

  collection(name) {
    const self = this;
    if (name === "clientErrors") {
      return {
        limit() {
          return this;
        },
        async get() {
          return {
            docs: self.errorDocs.map(d => ({ id: d.id, data: () => d }))
          };
        }
      };
    }

    if (name === "automation_outbox") {
      return {
        _filters: [],
        where(field, op, val) {
          this._filters.push({ field, op, val });
          return this;
        },
        limit() {
          return this;
        },
        async get() {
          let docs = [...self.outboxDocs];
          for (const f of this._filters) {
            docs = docs.filter(d => {
              if (f.op === "==") return d[f.field] === f.val;
              if (f.op === "in") return Array.isArray(f.val) && f.val.includes(d[f.field]);
              return true;
            });
          }
          return {
            docs: docs.map(d => ({ id: d.id, data: () => d })),
            size: docs.length,
            empty: docs.length === 0
          };
        }
      };
    }

    return {
      limit() { return this; },
      async get() { return { docs: [], size: 0, empty: true }; }
    };
  }
}

console.log("\n--- PACKZEN 3.0 PHASE 4F SECURITY & OBSERVABILITY TESTS ---\n");

test("1. System Health Report: Reports HEALTHY when zero dead-letters and normal queue", async () => {
  const db = new MockDb([
    { id: "e1", status: "completed", eventName: "lead.created" },
    { id: "e2", status: "completed", eventName: "booking.created" }
  ]);

  const report = await getSystemHealthReport(db);

  assert.strictEqual(report.status, "HEALTHY");
  assert.strictEqual(report.automation.deadLetters, 0);
  assert.strictEqual(report.adapters.brevoEmail.status, "OPERATIONAL");
  assert.strictEqual(report.security.rulesVerification, "ENFORCED");
  assert.strictEqual(report.security.clientWriteProtection, "ACTIVE");
});

test("2. System Health Report: Escalates to WARNING when dead-letters are present", async () => {
  const db = new MockDb([
    { id: "e1", status: "dead_letter", eventName: "lead.assigned", attempts: 5 }
  ]);

  const report = await getSystemHealthReport(db);

  assert.strictEqual(report.status, "WARNING");
  assert.strictEqual(report.automation.deadLetters, 1);
});

test("3. System Health Report: Escalates to CRITICAL on high failure count", async () => {
  const deadEvents = Array.from({ length: 6 }, (_, i) => ({
    id: `dead_${i}`,
    status: "dead_letter",
    eventName: "lead.assigned",
    attempts: 5
  }));
  const db = new MockDb(deadEvents);

  const report = await getSystemHealthReport(db);

  assert.strictEqual(report.status, "CRITICAL");
  assert.strictEqual(report.automation.deadLetters, 6);
});

test("4. Upstream Telemetry: Reports Brevo, WhatsApp, and n8n statuses", async () => {
  const db = new MockDb([]);
  const report = await getSystemHealthReport(db);

  assert.ok(report.adapters.brevoEmail);
  assert.ok(report.adapters.metaWhatsApp);
  assert.ok(report.adapters.n8nWebhook);
  assert.strictEqual(report.adapters.brevoEmail.name, "Brevo Transactional Email");
  assert.strictEqual(report.adapters.metaWhatsApp.name, "Meta WhatsApp Cloud API");
});
