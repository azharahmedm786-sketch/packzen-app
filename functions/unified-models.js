/**
 * PACKZEN 3.0 — Unified Data Foundation (Phase 4A)
 * ------------------------------------------------------------------
 * Non-destructive entity accessors, schema normalizers, and division
 * inference helpers across PackZen Logistics, Home Services, and Digital.
 *
 * DESIGN CONSTRAINTS:
 * 1. Read-only normalization: Does not mutate the source document or input object.
 * 2. Strict backward compatibility: Preserves all live field names (customerUid,
 *    total, paid, date, refId, type) while exposing Phase 4 standardized aliases.
 * 3. Graceful fallbacks: Zero runtime exceptions on missing, partial, or legacy fields.
 * 4. Zero database rewrites: Resolves differences in-memory without database migration.
 */
"use strict";

const VALID_DIVISIONS = Object.freeze([
  "logistics",
  "home_services",
  "digital",
  "overhead",
  "shared"
]);

const VALID_LEDGER_TYPES = Object.freeze([
  "collection",
  "direct_cost",
  "shared_opex",
  "refund",
  "discount"
]);

/**
 * Validates whether a given string is a recognized PackZen division.
 * @param {string} division
 * @returns {boolean}
 */
function isValidDivision(division) {
  return typeof division === "string" && VALID_DIVISIONS.includes(division.trim().toLowerCase());
}

/**
 * Infers division from entity metadata, flow, or service strings.
 * @param {object} entity
 * @returns {"logistics" | "home_services" | "digital"}
 */
function inferDivisionFromEntity(entity) {
  if (!entity || typeof entity !== "object") return "logistics";

  // Explicit division takes precedence if valid
  if (entity.division && isValidDivision(entity.division)) {
    const d = entity.division.trim().toLowerCase();
    if (d === "logistics" || d === "home_services" || d === "digital") return d;
  }

  // Flow attribute (used in bookings and catalog)
  if (entity.flow === "service") return "home_services";
  if (entity.flow === "parcel") return "logistics";
  if (entity.flow === "digital") return "digital";

  // Service field (used in leads)
  if (typeof entity.service === "string") {
    const s = entity.service.toLowerCase();
    if (["website", "ecommerce", "seo", "maintenance"].includes(s)) return "digital";
    if (["ac", "electrician", "plumber", "carpenter", "tv", "appliance", "painting"].includes(s)) {
      return "home_services";
    }
  }

  // Digital-specific project fields
  if (entity.packageId || entity.packageName || entity.tier || Array.isArray(entity.milestones)) {
    return "digital";
  }

  // Default to logistics
  return "logistics";
}

/**
 * Extracts raw data and ID from a Firestore DocumentSnapshot or plain object.
 * @param {object} input
 * @returns {{ id: string, data: object }}
 */
function extractDocData(input) {
  if (!input || typeof input !== "object") return { id: "", data: {} };
  const data = typeof input.data === "function" ? input.data() : input;
  const id = input.id || data.id || data.bookingId || data.orderId || data.projectId || data.leadId || data.ledgerId || "";
  return { id, data: Object.assign({}, data) };
}

/**
 * Normalizes a booking record (Logistics move, Home Services task, or Parcel).
 * @param {object} input - Firestore DocumentSnapshot or plain booking object.
 * @returns {object} Normalized booking entity with safe fallbacks and dual aliases.
 */
function normalizeBooking(input) {
  if (!input) return null;
  const { id, data } = extractDocData(input);

  const total = Number(data.total ?? data.totalAmount ?? data.grandTotal ?? 0);
  const paid = Number(data.paid ?? data.paidAmount ?? 0);
  const balanceDue = Number(data.balanceDue ?? Math.max(0, total - paid));
  const division = inferDivisionFromEntity(data);

  return {
    ...data,
    id,
    bookingId: id,
    bookingRef: data.bookingRef || id,
    division,
    flow: data.flow || (division === "home_services" ? "service" : "move"),
    status: data.status || "pending",
    customerUid: data.customerUid || data.uid || data.customerId || "",
    customerId: data.customerUid || data.uid || data.customerId || "", // Alias for Phase 4
    customerName: data.customerName || data.name || "",
    customerPhone: data.phone || data.customerPhone || "",
    customerEmail: data.email || data.customerEmail || null,
    date: data.date || "",
    dateStr: data.date || "", // Alias
    time: data.time || "",
    driverUid: data.driverUid || data.partnerId || null,
    partnerId: data.driverUid || data.partnerId || null, // Alias for Phase 4
    driverName: data.driverName || data.partnerName || "",
    driverPhone: data.driverPhone || data.partnerPhone || "",
    total,
    totalAmount: total, // Alias for Phase 4
    paid,
    paidAmount: paid, // Alias for Phase 4
    balanceDue,
    paymentStatus: data.paymentStatus || (balanceDue === 0 && total > 0 ? "paid" : (paid > 0 ? "partially_paid" : "unpaid"))
  };
}

/**
 * Normalizes a PackZen Digital project record.
 * @param {object} input - Firestore DocumentSnapshot or plain project object.
 * @returns {object} Normalized project entity.
 */
function normalizeProject(input) {
  if (!input) return null;
  const { id, data } = extractDocData(input);

  const total = Number(data.totalAmount ?? data.total ?? 0);
  const paid = Number(data.paidAmount ?? data.paid ?? data.advancePaid ?? 0);
  const balanceDue = Number(data.balanceDue ?? Math.max(0, total - paid));

  // Normalize milestones array, ensuring each has an id, name, and status
  const rawMilestones = Array.isArray(data.milestones) ? data.milestones : [];
  const milestones = rawMilestones.map((m, idx) => ({
    id: m.id || `m${idx + 1}`,
    name: m.name || m.title || `Milestone ${idx + 1}`,
    title: m.name || m.title || `Milestone ${idx + 1}`,
    status: m.status || "pending"
  }));

  return {
    ...data,
    id,
    projectId: id,
    division: "digital",
    businessName: data.businessName || data.clientName || "",
    clientName: data.clientName || data.businessName || "",
    clientEmail: data.email || data.clientEmail || "",
    email: data.email || data.clientEmail || "", // Live field in digital-projects.js
    clientPhone: data.phone || data.clientPhone || "",
    phone: data.phone || data.clientPhone || "",
    packageId: data.packageId || "custom",
    packageName: data.packageName || "Custom Digital Project",
    tier: data.tier || "custom",
    status: data.status || "discovery",
    totalAmount: total,
    total, // Alias
    paidAmount: paid,
    paid, // Alias
    advancePaid: Number(data.advancePaid ?? paid),
    balanceDue,
    milestones,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null
  };
}

/**
 * Normalizes an omnichannel lead record.
 * @param {object} input - Firestore DocumentSnapshot or plain lead object.
 * @returns {object} Normalized lead entity.
 */
function normalizeLead(input) {
  if (!input) return null;
  const { id, data } = extractDocData(input);
  const division = inferDivisionFromEntity(data);
  const status = data.status || "new";

  return {
    ...data,
    id,
    leadId: id,
    division,
    customerName: data.name || data.customerName || "",
    name: data.name || data.customerName || "",
    phone: data.phone || "",
    email: data.email || null,
    service: data.service || "move",
    source: data.source || "website_form",
    status,
    stage: data.stage || status, // Phase 4 pipeline alias
    urgencyScore: Number(data.urgencyScore ?? (status === "new" ? 75 : 50)),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null
  };
}

/**
 * Normalizes a categorized ledger transaction entry.
 * Preserves exact firestore.rules field compatibility ('type' and 'refId').
 * @param {object} input - Firestore DocumentSnapshot or plain ledger object.
 * @returns {object} Normalized ledger entry with double-entry aliases.
 */
function normalizeLedgerEntry(input) {
  if (!input) return null;
  const { id, data } = extractDocData(input);

  const amount = Number(data.amount || 0);
  const type = data.type || data.category || "collection";
  const refId = data.refId || data.referenceId || "MANUAL";
  const division = data.division || "overhead";

  return {
    ...data,
    id,
    ledgerId: id,
    refId,
    referenceId: refId, // Alias for Phase 4
    division,
    type,
    category: type, // Alias for Phase 4
    subcat: data.subcat || "payment",
    desc: data.desc || "",
    amount,
    date: data.date || new Date().toISOString().slice(0, 10),
    paymentRequestId: data.paymentRequestId || null,
    createdAt: data.createdAt || null
  };
}

/**
 * Computes double-entry P&L metrics across an array of normalized or raw ledger records.
 * Formula:
 *  Collections = Gross Collections − Refunds
 *  Direct Costs = Direct Costs + Gateway Fees + Discounts
 *  Contribution Margin = Collections − Direct Costs
 *  Net Operating Profit = Contribution Margin − Shared Opex
 *
 * @param {Array<object>} ledgerEntries
 * @param {string} [divisionFilter="all"]
 * @returns {object} Financial metrics summary.
 */
function extractFinancialMetrics(ledgerEntries, divisionFilter = "all") {
  if (!Array.isArray(ledgerEntries)) {
    return {
      grossCollections: 0,
      refunds: 0,
      netCollections: 0,
      directCosts: 0,
      contributionMargin: 0,
      contributionMarginPercent: 0,
      sharedOpex: 0,
      netOperatingProfit: 0
    };
  }

  const filtered = ledgerEntries
    .map(normalizeLedgerEntry)
    .filter(tx => {
      if (!tx) return false;
      if (divisionFilter === "all") return true;
      return tx.division === divisionFilter || tx.division === "overhead";
    });

  let grossCollections = 0;
  let refunds = 0;
  let directCosts = 0;
  let sharedOpex = 0;

  for (const tx of filtered) {
    const amt = tx.amount > 0 ? tx.amount : 0;
    if (tx.type === "collection") {
      grossCollections += amt;
    } else if (tx.type === "refund") {
      refunds += amt;
    } else if (tx.type === "direct_cost" || tx.type === "discount") {
      directCosts += amt;
    } else if (tx.type === "shared_opex") {
      sharedOpex += amt;
    }
  }

  const netCollections = Math.max(0, grossCollections - refunds);
  const contributionMargin = netCollections - directCosts;
  const contributionMarginPercent = netCollections > 0
    ? Math.round((contributionMargin / netCollections) * 100)
    : 0;
  const netOperatingProfit = contributionMargin - sharedOpex;

  return {
    grossCollections,
    refunds,
    netCollections,
    directCosts,
    contributionMargin,
    contributionMarginPercent,
    sharedOpex,
    netOperatingProfit
  };
}

module.exports = {
  VALID_DIVISIONS,
  VALID_LEDGER_TYPES,
  isValidDivision,
  inferDivisionFromEntity,
  normalizeBooking,
  normalizeProject,
  normalizeLead,
  normalizeLedgerEntry,
  extractFinancialMetrics
};
