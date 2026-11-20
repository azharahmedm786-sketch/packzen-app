/**
 * PACKZEN 3.0 — Phase 4D Multi-Division Workflow Orchestration Test Suite
 * ------------------------------------------------------------------
 * Tests workflow template definitions, state machine validation,
 * audit history logging, and authorized overrides in workflow-engine.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WORKFLOW_TEMPLATES,
  getWorkflowDefinition,
  validateStageTransition,
  transitionWorkflowStage,
  getWorkflowHistory
} = require("../workflow-engine");

// Mock Firestore Implementation
class MockDb {
  constructor() {
    this.storage = new Map();
  }

  collection(name) {
    const self = this;
    return {
      doc(id) {
        const docId = id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        return {
          id: docId,
          async set(data) {
            self.storage.set(`${name}/${docId}`, JSON.parse(JSON.stringify(data)));
          },
          async get() {
            const data = self.storage.get(`${name}/${docId}`);
            return {
              id: docId,
              exists: Boolean(data),
              data: () => data
            };
          }
        };
      },
      where(field, op, val) {
        return {
          _filters: [{ field, op, val }],
          where(f2, op2, val2) {
            this._filters.push({ field: f2, op: op2, val: val2 });
            return this;
          },
          limit(n) {
            this._limit = n;
            return this;
          },
          async get() {
            let docs = [];
            for (const [key, valData] of self.storage.entries()) {
              if (key.startsWith(`${name}/`)) {
                let match = true;
                for (const flt of this._filters) {
                  if (valData[flt.field] !== flt.val) match = false;
                }
                if (match) docs.push({ id: key.split("/")[1], data: () => valData });
              }
            }
            if (this._limit) docs = docs.slice(0, this._limit);
            return { docs, empty: docs.length === 0, size: docs.length };
          }
        };
      }
    };
  }
}

console.log("\n--- PACKZEN 3.0 PHASE 4D WORKFLOW ORCHESTRATION TESTS ---\n");

test("1. Workflow Definitions: Returns valid templates for all three divisions", () => {
  const logisticsStages = getWorkflowDefinition("logistics");
  assert.ok(Array.isArray(logisticsStages));
  assert.strictEqual(logisticsStages[0].id, "lead");
  assert.strictEqual(logisticsStages[logisticsStages.length - 1].id, "reviewed");

  const homeStages = getWorkflowDefinition("home_services");
  assert.ok(Array.isArray(homeStages));
  assert.strictEqual(homeStages[0].id, "lead");
  assert.ok(homeStages.some(s => s.id === "technician_assigned"));

  const digitalStages = getWorkflowDefinition("digital");
  assert.ok(Array.isArray(digitalStages));
  assert.strictEqual(digitalStages[0].id, "lead");
  assert.ok(digitalStages.some(s => s.id === "discovery"));
  assert.ok(digitalStages.some(s => s.id === "development"));
});

test("2. Stage Transition Validation: Allows valid single-step progression", () => {
  // Logistics step 1 -> step 2
  const res1 = validateStageTransition("logistics", "lead", "qualified");
  assert.strictEqual(res1.valid, true);

  // Logistics step 2 -> step 3
  const res2 = validateStageTransition("logistics", "qualified", "survey");
  assert.strictEqual(res2.valid, true);

  // Digital step 1 -> step 2
  const res3 = validateStageTransition("digital", "lead", "discovery");
  assert.strictEqual(res3.valid, true);

  // Idempotent re-entry of same stage
  const resSame = validateStageTransition("digital", "discovery", "discovery");
  assert.strictEqual(resSame.valid, true);
  assert.strictEqual(resSame.duplicate, true);
});

test("3. Stage Transition Validation: Blocks unauthorized jumping and invalid stages", () => {
  // Jump from lead directly to delivered without override
  const jumpRes = validateStageTransition("logistics", "lead", "delivered");
  assert.strictEqual(jumpRes.valid, false);
  assert.ok(jumpRes.reason.includes("INVALID_SEQUENCE"));

  // Non-existent stage
  const unknownRes = validateStageTransition("digital", "lead", "space_travel");
  assert.strictEqual(unknownRes.valid, false);
  assert.ok(unknownRes.reason.includes("INVALID_STAGE"));

  // Manual override allows jumping
  const overrideRes = validateStageTransition("logistics", "lead", "delivered", true);
  assert.strictEqual(overrideRes.valid, true);
});

test("4. Workflow Stage Transition: Persists immutable history audit record", async () => {
  const db = new MockDb();
  const context = { auth: { uid: "owner_1", token: { role: "owner" } } };

  const transitionRes = await transitionWorkflowStage(db, {
    division: "digital",
    entityType: "project",
    entityId: "proj_999",
    fromStage: "lead",
    toStage: "discovery",
    notes: "Initial scope finalized over phone call."
  }, context);

  assert.strictEqual(transitionRes.success, true);
  assert.strictEqual(transitionRes.currentStage, "discovery");
  assert.ok(transitionRes.transitionId);

  // Verify record in workflow_history
  const history = await getWorkflowHistory(db, { entityType: "project", entityId: "proj_999" });
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].entityId, "proj_999");
  assert.strictEqual(history[0].fromStage, "lead");
  assert.strictEqual(history[0].toStage, "discovery");
  assert.strictEqual(history[0].updatedBy, "owner_1");
  assert.strictEqual(history[0].notes, "Initial scope finalized over phone call.");
});

test("5. Workflow Override Security: Rejects non-admin overrides", async () => {
  const db = new MockDb();
  const customerContext = { auth: { uid: "cust_1", token: { role: "customer" } } };

  await assert.rejects(
    async () => {
      await transitionWorkflowStage(db, {
        division: "logistics",
        entityType: "booking",
        entityId: "bk_11",
        fromStage: "lead",
        toStage: "delivered", // multi-stage jump requires override
        overrideReason: "Emergency customer requested expedite"
      }, customerContext);
    },
    /PERMISSION_DENIED/
  );
});
