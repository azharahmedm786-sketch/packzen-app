/**
 * PACKZEN 3.0 — Phase 4E Advanced Analytics & BI Test Suite
 * ------------------------------------------------------------------
 * Verifies multi-dimensional analytics, unit economics, cohort conversion,
 * partner performance, and transparent mathematical forecasting.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { generateAnalyticsReport } = require("../analytics-engine");

// Mock Firestore Query Snapshot for Analytics
class MockQuerySnapshot {
  constructor(docs = []) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
}

class MockDb {
  constructor(data = {}) {
    this.data = data;
  }

  collection(name) {
    const list = this.data[name] || [];
    return {
      limit() {
        return this;
      },
      async get() {
        return new MockQuerySnapshot(list.map(d => ({
          id: d.id,
          data: () => d
        })));
      }
    };
  }
}

console.log("\n--- PACKZEN 3.0 PHASE 4E ADVANCED ANALYTICS & BI TESTS ---\n");

test("1. Analytics Report: Strictly segregates actuals, calculated metrics, and forecasts", async () => {
  const mockDb = new MockDb({
    leads: [
      { id: "l1", division: "logistics", source: "google", status: "booked" },
      { id: "l2", division: "logistics", source: "google", status: "new" },
      { id: "l3", division: "home_services", source: "whatsapp", status: "booked" },
      { id: "l4", division: "digital", source: "referral", status: "qualified" }
    ],
    bookings: [
      { id: "b1", division: "logistics", total: 10000, paid: 10000, status: "completed", customerUid: "u1" },
      { id: "b2", division: "home_services", total: 2000, paid: 2000, status: "completed", customerUid: "u1" }
    ],
    projects: [
      { id: "p1", division: "digital", totalAmount: 30000, paidAmount: 15000, balanceDue: 15000, status: "in_progress" }
    ],
    ledger: [
      { id: "t1", type: "collection", division: "logistics", amount: 10000, date: "2026-11-19" },
      { id: "t2", type: "collection", division: "home_services", amount: 2000, date: "2026-11-19" },
      { id: "t3", type: "collection", division: "digital", amount: 15000, date: "2026-11-19" },
      { id: "t4", type: "direct_cost", division: "logistics", amount: 4000, date: "2026-11-19" }
    ],
    partners: [
      { id: "ptr1", name: "Ramesh Transport", division: "logistics", totalJobsCompleted: 15, rating: 4.8, walletBalance: 4500 }
    ]
  });

  const report = await generateAnalyticsReport(mockDb, { days: 30 });

  assert.ok(report.meta);
  assert.ok(report.actuals);
  assert.ok(report.calculatedMetrics);
  assert.ok(report.forecasts);

  // Actuals validation
  assert.strictEqual(report.actuals.totalLeads, 4);
  assert.strictEqual(report.actuals.totalBookings, 2);
  assert.strictEqual(report.actuals.totalProjects, 1);
  assert.strictEqual(report.actuals.financials.netCollections, 27000); // 10000 + 2000 + 15000
  assert.strictEqual(report.actuals.financials.directCosts, 4000);
  assert.strictEqual(report.actuals.financials.contributionMargin, 23000);

  // Calculated Metrics: Lead attribution
  assert.strictEqual(report.calculatedMetrics.leadsBySource.google, 2);
  assert.strictEqual(report.calculatedMetrics.leadsBySource.whatsapp, 1);
  assert.strictEqual(report.calculatedMetrics.leadsBySource.referral, 1);

  // Calculated Metrics: Conversion by division
  assert.strictEqual(report.calculatedMetrics.conversionByDivision.logistics.totalLeads, 2);
  assert.strictEqual(report.calculatedMetrics.conversionByDivision.logistics.converted, 1);
  assert.strictEqual(report.calculatedMetrics.conversionByDivision.logistics.conversionRate, 50);

  // Repeat Customer Retention (u1 has 2 bookings across logistics + home)
  assert.strictEqual(report.calculatedMetrics.retention.totalUniqueCustomers, 1);
  assert.strictEqual(report.calculatedMetrics.retention.repeatCustomers, 1);
  assert.strictEqual(report.calculatedMetrics.retention.repeatCustomerRate, 100);

  // Forecasts: Mathematical velocity run-rate
  assert.ok(report.forecasts.dailyCollectionVelocity > 0);
  assert.strictEqual(report.forecasts.projected30DayCollections, 27000); // (27000/30) * 30
  assert.ok(report.forecasts.basis.includes("Explainable Formula"));
});
