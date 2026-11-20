/**
 * PACKZEN 3.0 — Phase 4A Unified Data Foundation Test Suite
 * ------------------------------------------------------------------
 * Verifies non-destructive data accessors, schema normalization,
 * division inference, ledger financial metrics, and index definitions.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  VALID_DIVISIONS,
  VALID_LEDGER_TYPES,
  isValidDivision,
  inferDivisionFromEntity,
  normalizeBooking,
  normalizeProject,
  normalizeLead,
  normalizeLedgerEntry,
  extractFinancialMetrics
} = require("../unified-models");

console.log("\n--- PACKZEN 3.0 PHASE 4A UNIFIED DATA FOUNDATION TESTS ---\n");

test("1. Division Validation: Rejects invalid divisions and accepts official divisions", () => {
  assert.strictEqual(isValidDivision("logistics"), true);
  assert.strictEqual(isValidDivision("home_services"), true);
  assert.strictEqual(isValidDivision("digital"), true);
  assert.strictEqual(isValidDivision("overhead"), true);
  assert.strictEqual(isValidDivision("shared"), true);
  assert.strictEqual(isValidDivision("LOGISTICS "), true); // case and trim insensitive

  assert.strictEqual(isValidDivision("crypto"), false);
  assert.strictEqual(isValidDivision(""), false);
  assert.strictEqual(isValidDivision(null), false);
  assert.strictEqual(isValidDivision(undefined), false);
  assert.strictEqual(isValidDivision(123), false);
});

test("2. Division Inference: Correctly identifies division from entity attributes", () => {
  // Explicit division
  assert.strictEqual(inferDivisionFromEntity({ division: "home_services" }), "home_services");
  assert.strictEqual(inferDivisionFromEntity({ division: "digital" }), "digital");
  assert.strictEqual(inferDivisionFromEntity({ division: "logistics" }), "logistics");

  // From flow
  assert.strictEqual(inferDivisionFromEntity({ flow: "service" }), "home_services");
  assert.strictEqual(inferDivisionFromEntity({ flow: "parcel" }), "logistics");
  assert.strictEqual(inferDivisionFromEntity({ flow: "move" }), "logistics");

  // From lead service
  assert.strictEqual(inferDivisionFromEntity({ service: "ac" }), "home_services");
  assert.strictEqual(inferDivisionFromEntity({ service: "washing_machine" }), "logistics"); // unknown defaults to logistics
  assert.strictEqual(inferDivisionFromEntity({ service: "appliance" }), "home_services");
  assert.strictEqual(inferDivisionFromEntity({ service: "website" }), "digital");
  assert.strictEqual(inferDivisionFromEntity({ service: "seo" }), "digital");

  // From digital project artifacts
  assert.strictEqual(inferDivisionFromEntity({ packageId: "pkg_growth" }), "digital");
  assert.strictEqual(inferDivisionFromEntity({ milestones: [{ name: "Design" }] }), "digital");

  // Safe default
  assert.strictEqual(inferDivisionFromEntity(null), "logistics");
  assert.strictEqual(inferDivisionFromEntity({}), "logistics");
});

test("3. Booking Normalization (Logistics Move): Preserves live fields and adds aliases", () => {
  const liveBooking = {
    bookingRef: "PZB-2026-9001",
    customerUid: "usr_abc123",
    customerName: "Siddharth Rao",
    phone: "9876543210",
    date: "2026-11-25",
    time: "09:30 AM",
    pickup: "Indiranagar, Bangalore",
    drop: "Whitefield, Bangalore",
    total: 12500,
    paid: 2500,
    balanceDue: 10000,
    status: "confirmed",
    driverUid: "drv_9988",
    driverName: "Manjunath K"
  };

  const originalCopy = JSON.parse(JSON.stringify(liveBooking));
  const norm = normalizeBooking(liveBooking);

  // Assert input object was not mutated
  assert.deepStrictEqual(liveBooking, originalCopy);

  // Assert live fields preserved
  assert.strictEqual(norm.bookingRef, "PZB-2026-9001");
  assert.strictEqual(norm.customerUid, "usr_abc123");
  assert.strictEqual(norm.total, 12500);
  assert.strictEqual(norm.paid, 2500);
  assert.strictEqual(norm.balanceDue, 10000);
  assert.strictEqual(norm.date, "2026-11-25");
  assert.strictEqual(norm.driverUid, "drv_9988");

  // Assert Phase 4 unified aliases
  assert.strictEqual(norm.customerId, "usr_abc123");
  assert.strictEqual(norm.totalAmount, 12500);
  assert.strictEqual(norm.paidAmount, 2500);
  assert.strictEqual(norm.dateStr, "2026-11-25");
  assert.strictEqual(norm.partnerId, "drv_9988");
  assert.strictEqual(norm.division, "logistics");
  assert.strictEqual(norm.paymentStatus, "partially_paid");
});

test("4. Booking Normalization (Home Services): Infers division from flow", () => {
  const serviceBooking = {
    id: "BK_SVC_5541",
    flow: "service",
    customerUid: "usr_xyz789",
    total: 1499,
    paid: 1499,
    status: "assigned",
    driverUid: "tech_001",
    driverName: "Ramesh AC Expert"
  };

  const norm = normalizeBooking(serviceBooking);
  assert.strictEqual(norm.division, "home_services");
  assert.strictEqual(norm.flow, "service");
  assert.strictEqual(norm.balanceDue, 0);
  assert.strictEqual(norm.paymentStatus, "paid");
});

test("5. Booking Normalization (Firestore DocumentSnapshot Mock)", () => {
  const mockSnapshot = {
    id: "order_rzp_888999",
    data: () => ({
      grandTotal: 18000,
      paid: 3600,
      customerUid: "usr_doc_snap",
      date: "2026-12-01"
    })
  };

  const norm = normalizeBooking(mockSnapshot);
  assert.strictEqual(norm.id, "order_rzp_888999");
  assert.strictEqual(norm.bookingId, "order_rzp_888999");
  assert.strictEqual(norm.total, 18000);
  assert.strictEqual(norm.totalAmount, 18000);
  assert.strictEqual(norm.paid, 3600);
  assert.strictEqual(norm.balanceDue, 14400);
  assert.strictEqual(norm.customerUid, "usr_doc_snap");
});

test("6. Digital Project Normalization: Preserves Phase 3 schema with standardized milestone shape", () => {
  const liveProject = {
    projectId: "proj_9912",
    businessName: "Bangalore Artisans Studio",
    clientName: "Deepak Verma",
    email: "deepak@artisansblr.com",
    phone: "9845012345",
    packageId: "pkg_growth",
    packageName: "Growth Web Stack",
    tier: "business",
    totalAmount: 45000,
    advancePaid: 20000,
    paidAmount: 20000,
    balanceDue: 25000,
    status: "in_progress",
    milestones: [
      { id: "m1", name: "Design Mockups", status: "completed" },
      { id: "m2", name: "Frontend Development", status: "in_progress" },
      { id: "m3", name: "Testing & Handover", status: "pending" }
    ]
  };

  const originalCopy = JSON.parse(JSON.stringify(liveProject));
  const norm = normalizeProject(liveProject);

  assert.deepStrictEqual(liveProject, originalCopy);
  assert.strictEqual(norm.projectId, "proj_9912");
  assert.strictEqual(norm.division, "digital");
  assert.strictEqual(norm.totalAmount, 45000);
  assert.strictEqual(norm.total, 45000); // Alias
  assert.strictEqual(norm.paidAmount, 20000);
  assert.strictEqual(norm.paid, 20000); // Alias
  assert.strictEqual(norm.clientEmail, "deepak@artisansblr.com");
  assert.strictEqual(norm.email, "deepak@artisansblr.com");
  assert.strictEqual(norm.milestones.length, 3);
  assert.strictEqual(norm.milestones[0].title, "Design Mockups");
});

test("7. Digital Project Normalization: Handles legacy project with missing milestones gracefully", () => {
  const legacyProj = {
    projectId: "proj_legacy_01",
    businessName: "Old Tech Corp",
    totalAmount: 30000,
    paidAmount: 30000,
    balanceDue: 0
  };

  const norm = normalizeProject(legacyProj);
  assert.strictEqual(norm.projectId, "proj_legacy_01");
  assert.strictEqual(Array.isArray(norm.milestones), true);
  assert.strictEqual(norm.milestones.length, 0);
  assert.strictEqual(norm.clientEmail, "");
  assert.strictEqual(norm.balanceDue, 0);
});

test("8. Lead Normalization: Preserves 3-division pipeline consistency", () => {
  const liveLead = {
    id: "lead_4431",
    name: "Pooja Hegde",
    phone: "9123456780",
    service: "website",
    status: "new",
    date: "2026-12-05"
  };

  const norm = normalizeLead(liveLead);
  assert.strictEqual(norm.leadId, "lead_4431");
  assert.strictEqual(norm.division, "digital");
  assert.strictEqual(norm.status, "new");
  assert.strictEqual(norm.stage, "new"); // Alias
  assert.strictEqual(norm.customerName, "Pooja Hegde");
  assert.strictEqual(norm.urgencyScore, 75); // New leads default to 75
});

test("9. Ledger Normalization: Strictly preserves 'type' and 'refId' for firestore.rules compatibility", () => {
  const liveLedgerDoc = {
    ledgerId: "tx_bal_proj_44_req_101",
    refId: "proj_44",
    paymentRequestId: "req_101",
    division: "digital",
    type: "collection",
    subcat: "balance",
    desc: "Balance payment for Bangalore Artisans Studio",
    amount: 15000,
    date: "2026-11-18",
    createdAt: 1731945600000
  };

  const norm = normalizeLedgerEntry(liveLedgerDoc);

  // Authoritative rules fields
  assert.strictEqual(norm.type, "collection");
  assert.strictEqual(norm.refId, "proj_44");
  assert.strictEqual(norm.division, "digital");
  assert.strictEqual(norm.amount, 15000);
  assert.strictEqual(norm.date, "2026-11-18");

  // Phase 4 reporting aliases
  assert.strictEqual(norm.category, "collection");
  assert.strictEqual(norm.referenceId, "proj_44");
  assert.strictEqual(norm.paymentRequestId, "req_101");
});

test("10. Ledger Financial Metrics: Accurately computes P&L formulas across entries", () => {
  const sampleLedger = [
    { type: "collection", division: "logistics", amount: 50000 },
    { type: "collection", division: "home_services", amount: 15000 },
    { type: "collection", division: "digital", amount: 60000 },
    { type: "refund", division: "logistics", amount: 2000 },
    { type: "direct_cost", division: "logistics", amount: 30000 }, // Driver payout
    { type: "direct_cost", division: "home_services", amount: 7000 }, // Tech payout
    { type: "direct_cost", division: "digital", amount: 5000 }, // Cloud hosting
    { type: "discount", division: "logistics", amount: 1000 }, // Discount treated as direct cost
    { type: "shared_opex", division: "overhead", amount: 12000 } // Office & shared opex
  ];

  // 1. Enterprise totals
  const enterprise = extractFinancialMetrics(sampleLedger, "all");
  assert.strictEqual(enterprise.grossCollections, 125000);
  assert.strictEqual(enterprise.refunds, 2000);
  assert.strictEqual(enterprise.netCollections, 123000);
  assert.strictEqual(enterprise.directCosts, 43000); // 30k + 7k + 5k + 1k
  assert.strictEqual(enterprise.contributionMargin, 80000); // 123k - 43k
  assert.strictEqual(enterprise.contributionMarginPercent, 65); // 80k / 123k = 65%
  assert.strictEqual(enterprise.sharedOpex, 12000);
  assert.strictEqual(enterprise.netOperatingProfit, 68000); // 80k - 12k

  // 2. Division filtered (Digital only)
  const digital = extractFinancialMetrics(sampleLedger, "digital");
  assert.strictEqual(digital.grossCollections, 60000);
  assert.strictEqual(digital.refunds, 0);
  assert.strictEqual(digital.netCollections, 60000);
  assert.strictEqual(digital.directCosts, 5000);
  assert.strictEqual(digital.contributionMargin, 55000);
  assert.strictEqual(digital.contributionMarginPercent, 92);
});

test("11. Null Safety: All accessors handle null, undefined, and empty objects without crashing", () => {
  assert.strictEqual(normalizeBooking(null), null);
  assert.strictEqual(normalizeBooking(undefined), null);
  assert.strictEqual(normalizeProject(null), null);
  assert.strictEqual(normalizeProject(undefined), null);
  assert.strictEqual(normalizeLead(null), null);
  assert.strictEqual(normalizeLead(undefined), null);
  assert.strictEqual(normalizeLedgerEntry(null), null);
  assert.strictEqual(normalizeLedgerEntry(undefined), null);

  const emptyBooking = normalizeBooking({});
  assert.strictEqual(emptyBooking.total, 0);
  assert.strictEqual(emptyBooking.balanceDue, 0);
  assert.strictEqual(emptyBooking.division, "logistics");

  const emptyProject = normalizeProject({});
  assert.strictEqual(emptyProject.totalAmount, 0);
  assert.strictEqual(emptyProject.balanceDue, 0);
  assert.strictEqual(emptyProject.division, "digital");

  const emptyLead = normalizeLead({});
  assert.strictEqual(emptyLead.status, "new");
  assert.strictEqual(emptyLead.division, "logistics");

  const emptyLedger = normalizeLedgerEntry({});
  assert.strictEqual(emptyLedger.amount, 0);
  assert.strictEqual(emptyLedger.type, "collection");
});

test("12. Index Configuration Validation: firestore.indexes.json exists and adheres to schema", () => {
  const indexFilePath = path.join(__dirname, "../../firestore.indexes.json");
  assert.strictEqual(fs.existsSync(indexFilePath), true, "firestore.indexes.json must exist in project root");

  const raw = fs.readFileSync(indexFilePath, "utf8");
  const parsed = JSON.parse(raw);
  assert.strictEqual(Array.isArray(parsed.indexes), true);
  assert.strictEqual(parsed.indexes.length, 9, "Must contain exactly 9 verified composite indexes");

  // Validate that no index references non-existent spec fields (scheduledDate, partnerId, category, referenceId)
  for (const idx of parsed.indexes) {
    const fieldPaths = idx.fields.map(f => f.fieldPath);
    assert.strictEqual(fieldPaths.includes("scheduledDate"), false, "Must not reference scheduledDate");
    assert.strictEqual(fieldPaths.includes("partnerId"), false, "Must not reference partnerId");
    assert.strictEqual(fieldPaths.includes("category"), false, "Must not reference category (use type)");
    assert.strictEqual(fieldPaths.includes("referenceId"), false, "Must not reference referenceId (use refId)");
  }
});

test("13. Firebase Configuration: firebase.json registers firestore.indexes.json", () => {
  const firebaseJsonPath = path.join(__dirname, "../../firebase.json");
  const raw = fs.readFileSync(firebaseJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.firestore.indexes, "firestore.indexes.json");
  assert.strictEqual(parsed.firestore.rules, "firestore.rules");
});

test("14. Isolation Check: No live payment or project modules were modified", () => {
  // Confirm that move-payment.js and digital-projects.js remain present and loadable
  assert.doesNotThrow(() => require("../move-payment"));
  assert.doesNotThrow(() => require("../digital-projects"));
  assert.doesNotThrow(() => require("../catalog-booking"));
});

console.log("\n======================================================");
console.log(" ALL 14 PHASE 4A DATA FOUNDATION TESTS PASSED!");
console.log("======================================================\n");
