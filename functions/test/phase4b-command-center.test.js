/**
 * PACKZEN 3.0 — Phase 4B Unified Command Center Test Suite
 * ------------------------------------------------------------------
 * Tests getExecutiveOverview, getUnifiedCustomerProfile, and
 * getOwnerActionStream in functions/unified-command.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getExecutiveOverview,
  getUnifiedCustomerProfile,
  getOwnerActionStream
} = require("../unified-command");

class MockQuerySnapshot {
  constructor(docs = []) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
}

class MockDocSnapshot {
  constructor(id, data, exists = true) {
    this.id = id;
    this._data = data;
    this.exists = exists;
  }
  data() {
    return this._data;
  }
}

class MockDb {
  constructor(collections = {}) {
    this.collections = collections;
  }

  collection(name) {
    const items = this.collections[name] || [];

    const query = {
      _filters: [],
      _limit: null,
      where(field, op, val) {
        this._filters.push({ field, op, val });
        return this;
      },
      limit(n) {
        this._limit = n;
        return this;
      },
      async get() {
        let result = [...items];
        for (const f of this._filters) {
          result = result.filter(item => {
            const v = item[f.field];
            if (f.op === "==") return v === f.val;
            if (f.op === ">=") return v >= f.val;
            if (f.op === "<=") return v <= f.val;
            if (f.op === "in") return Array.isArray(f.val) && f.val.includes(v);
            return true;
          });
        }
        if (this._limit != null) {
          result = result.slice(0, this._limit);
        }
        return new MockQuerySnapshot(result.map(d => new MockDocSnapshot(d.id, d)));
      }
    };

    return {
      doc: (id) => ({
        id,
        async get() {
          const found = items.find(d => d.id === id);
          return new MockDocSnapshot(id, found, Boolean(found));
        }
      }),
      where: (f, o, v) => query.where(f, o, v),
      limit: (n) => query.limit(n),
      async get() {
        return query.get();
      }
    };
  }
}

console.log("\n--- PACKZEN 3.0 PHASE 4B UNIFIED COMMAND CENTER TESTS ---\n");

test("1. Executive Overview: Aggregates leads, operations, and financials correctly", async () => {
  const mockDb = new MockDb({
    leads: [
      { id: "lead_1", division: "logistics", status: "new", date: "2026-11-19" },
      { id: "lead_2", division: "home_services", status: "qualified", date: "2026-11-19" },
      { id: "lead_3", division: "digital", status: "quoted", date: "2026-11-19" },
      { id: "lead_4", division: "logistics", status: "booked", date: "2026-11-19" }
    ],
    bookings: [
      { id: "bk_1", division: "logistics", status: "confirmed", date: "2026-11-19", total: 8000, paid: 2000, flow: "move" },
      { id: "bk_2", division: "home_services", status: "completed", date: "2026-11-19", total: 1500, paid: 1500, flow: "service" }
    ],
    projects: [
      { id: "proj_1", division: "digital", status: "in_progress", totalAmount: 30000, paidAmount: 15000, balanceDue: 15000 }
    ],
    ledger: [
      { id: "tx_1", type: "collection", division: "logistics", amount: 2000, date: "2026-11-19" },
      { id: "tx_2", type: "collection", division: "home_services", amount: 1500, date: "2026-11-19" },
      { id: "tx_3", type: "collection", division: "digital", amount: 15000, date: "2026-11-19" },
      { id: "tx_4", type: "direct_cost", division: "digital", amount: 4000, date: "2026-11-19" },
      { id: "tx_5", type: "shared_opex", division: "overhead", amount: 1000, date: "2026-11-19" }
    ]
  });

  const overview = await getExecutiveOverview(mockDb, { divisionFilter: "all" });

  assert.strictEqual(overview.division, "all");
  assert.strictEqual(overview.kpis.leads.total, 4);
  assert.strictEqual(overview.kpis.leads.new, 1);
  assert.strictEqual(overview.kpis.leads.qualified, 2); // qualified + quoted
  assert.strictEqual(overview.kpis.leads.converted, 1);

  // Financial calculations
  assert.strictEqual(overview.kpis.financials.grossCollections, 18500); // 2000 + 1500 + 15000
  assert.strictEqual(overview.kpis.financials.netCollections, 18500);
  assert.strictEqual(overview.kpis.financials.directCosts, 4000);
  assert.strictEqual(overview.kpis.financials.contributionMargin, 14500); // 18500 - 4000
  assert.strictEqual(overview.kpis.financials.sharedOpex, 1000);
  assert.strictEqual(overview.kpis.financials.netOperatingProfit, 13500); // 14500 - 1000
  assert.strictEqual(overview.kpis.liabilities.outstandingCustomerBalances, 21000); // (8000-2000) + 15000
});

test("2. Executive Overview: Correctly filters by division (Digital only)", async () => {
  const mockDb = new MockDb({
    leads: [
      { id: "lead_1", division: "logistics", status: "new", date: "2026-11-19" },
      { id: "lead_3", division: "digital", status: "in_progress", date: "2026-11-19" }
    ],
    bookings: [
      { id: "bk_1", division: "logistics", status: "confirmed", date: "2026-11-19", total: 8000, paid: 2000, flow: "move" }
    ],
    projects: [
      { id: "proj_1", division: "digital", status: "in_progress", totalAmount: 25000, paidAmount: 10000, balanceDue: 15000 }
    ],
    ledger: [
      { id: "tx_1", type: "collection", division: "logistics", amount: 2000, date: "2026-11-19" },
      { id: "tx_3", type: "collection", division: "digital", amount: 10000, date: "2026-11-19" },
      { id: "tx_4", type: "direct_cost", division: "digital", amount: 2000, date: "2026-11-19" }
    ]
  });

  const overview = await getExecutiveOverview(mockDb, { divisionFilter: "digital" });

  assert.strictEqual(overview.division, "digital");
  assert.strictEqual(overview.kpis.leads.total, 1);
  assert.strictEqual(overview.kpis.operations.activeProjectsCount, 1);
  assert.strictEqual(overview.kpis.operations.activeBookingsCount, 0);
  assert.strictEqual(overview.kpis.financials.netCollections, 10000);
  assert.strictEqual(overview.kpis.financials.directCosts, 2000);
  assert.strictEqual(overview.kpis.financials.contributionMargin, 8000);
  assert.strictEqual(overview.kpis.liabilities.projectBalanceDue, 15000);
});

test("3. Unified Customer Profile: Aggregates across multiple divisions", async () => {
  const customerUid = "cust_bangalore_1";
  const customerPhone = "9876543210";

  const mockDb = new MockDb({
    users: [
      { id: customerUid, name: "Vikram Malhotra", email: "vikram@example.com", phone: customerPhone }
    ],
    bookings: [
      { id: "bk_101", customerUid, phone: customerPhone, division: "logistics", total: 15000, paid: 15000, status: "completed", date: "2026-10-10", flow: "move" }
    ],
    projects: [
      { id: "proj_201", email: "vikram@example.com", phone: customerPhone, businessName: "Malhotra Enterprises", totalAmount: 40000, paidAmount: 20000, balanceDue: 20000, status: "in_progress" }
    ],
    leads: [
      { id: "lead_301", phone: customerPhone, service: "ac", division: "home_services", status: "new", date: "2026-11-18" }
    ],
    ledger: [
      { id: "tx_bk", refId: "bk_101", type: "collection", amount: 15000, date: "2026-10-10" },
      { id: "tx_pj", refId: "proj_201", type: "collection", amount: 20000, date: "2026-11-05" }
    ]
  });

  const profile = await getUnifiedCustomerProfile(mockDb, { customerId: customerUid }, { isStaff: true });

  assert.strictEqual(profile.profile.displayName, "Vikram Malhotra");
  assert.strictEqual(profile.profile.email, "vikram@example.com");
  assert.strictEqual(profile.profile.phone, customerPhone);

  assert.strictEqual(profile.history.bookings.length, 1);
  assert.strictEqual(profile.history.projects.length, 1);
  assert.strictEqual(profile.history.leads.length, 1);
  assert.strictEqual(profile.lifetimeValue.totalPaid, 35000); // 15000 + 20000
  assert.strictEqual(profile.lifetimeValue.totalOutstanding, 20000);
});

test("4. Owner Action Stream: Prioritizes SLA breaches and critical actions", async () => {
  const thirtyMinutesAgo = Date.now() - 30 * 60e3;

  const mockDb = new MockDb({
    leads: [
      { id: "lead_overdue", name: "Anil Kumar", phone: "9876543210", division: "logistics", status: "new", createdAtMs: thirtyMinutesAgo, area: "Koramangala" }
    ],
    projects: [
      { id: "proj_overdue", businessName: "ZenTech Solutions", division: "digital", status: "completed", balanceDue: 15000 }
    ],
    bookings: [],
    automation_outbox: [
      { id: "outbox_dead", status: "dead_letter", eventType: "lead.assigned", attempts: 5, lastError: "Gateway timeout" }
    ]
  });

  const actionStream = await getOwnerActionStream(mockDb, { nowMs: Date.now() });

  assert.ok(actionStream.totalAlerts >= 3);
  assert.ok(actionStream.criticalCount >= 1); // dead-letter event is critical

  const leadAction = actionStream.alerts.find(a => a.entityId === "lead_overdue");
  assert.ok(leadAction);
  assert.strictEqual(leadAction.type, "lead_sla_breach");

  const deadLetterAction = actionStream.alerts.find(a => a.entityId === "outbox_dead");
  assert.ok(deadLetterAction);
  assert.strictEqual(deadLetterAction.severity, "CRITICAL");
  assert.strictEqual(deadLetterAction.type, "automation_failure");

  const projAction = actionStream.alerts.find(a => a.entityId === "proj_overdue");
  assert.ok(projAction);
  assert.strictEqual(projAction.type, "outstanding_balance");
});
