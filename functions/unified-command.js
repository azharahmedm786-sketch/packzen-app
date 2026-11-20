/**
 * PACKZEN 3.0 — Unified Command Center & Executive Overview Engine (Phase 4B & 4E)
 * ------------------------------------------------------------------
 * Authoritative backend service powering the PackZen Owner Command Center:
 *  - Real-time multi-division executive KPI aggregation
 *  - Division-wise operational performance breakdown (Logistics, Home Services, Digital)
 *  - Unified 360-degree customer identity & history resolution
 *  - Unified partner & staff operational telemetry
 *  - Action-oriented decision stream ("What Needs Attention Today")
 *  - Explainable financial intelligence and contribution margin analytics
 */
"use strict";

const {
  normalizeBooking,
  normalizeProject,
  normalizeLead,
  normalizeLedgerEntry,
  extractFinancialMetrics,
  inferDivisionFromEntity
} = require("./unified-models");

/**
 * Computes an executive business overview across all 3 divisions.
 * @param {object} db - Firestore database instance.
 * @param {object} [opts={}] - Query options.
 * @returns {Promise<object>} Comprehensive executive metrics.
 */
async function getExecutiveOverview(db, opts = {}) {
  const now = opts.nowMs || Date.now();
  const divisionFilter = opts.divisionFilter || opts.division || "all";

  // 1. Fetch leads
  let leadsQuery = db.collection("leads");
  if (divisionFilter !== "all" && divisionFilter !== "overhead") {
    leadsQuery = leadsQuery.where("division", "==", divisionFilter);
  }
  const leadsSnap = await leadsQuery.limit(500).get();
  const rawLeads = leadsSnap.docs ? leadsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const leads = rawLeads.map(normalizeLead);

  // 2. Fetch bookings
  let bookingsQuery = db.collection("bookings");
  if (divisionFilter === "logistics") {
    bookingsQuery = bookingsQuery.where("flow", "in", ["move", "parcel"]);
  } else if (divisionFilter === "home_services") {
    bookingsQuery = bookingsQuery.where("flow", "==", "service");
  }
  const bookingsSnap = await bookingsQuery.limit(500).get();
  const rawBookings = bookingsSnap.docs ? bookingsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const bookings = rawBookings.map(normalizeBooking).filter(b => {
    if (divisionFilter === "all") return true;
    return b.division === divisionFilter;
  });

  // 3. Fetch digital projects
  let projects = [];
  if (divisionFilter === "all" || divisionFilter === "digital") {
    const projectsSnap = await db.collection("projects").limit(200).get();
    const rawProjects = projectsSnap.docs ? projectsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
    projects = rawProjects.map(normalizeProject);
  }

  // 4. Fetch financial ledger
  let ledgerQuery = db.collection("ledger");
  if (divisionFilter !== "all") {
    ledgerQuery = ledgerQuery.where("division", "in", [divisionFilter, "overhead"]);
  }
  const ledgerSnap = await ledgerQuery.limit(1000).get();
  const rawLedger = ledgerSnap.docs ? ledgerSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const ledgerEntries = rawLedger.map(normalizeLedgerEntry);

  // 5. Fetch partners for payout liabilities
  const partnersSnap = await db.collection("partners").limit(300).get();
  const rawPartners = partnersSnap.docs ? partnersSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];

  // --- Compute Lead Metrics ---
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === "new" || l.stage === "new").length;
  const qualifiedLeads = leads.filter(l => ["qualified", "quoted", "follow_up"].includes(l.status) || ["qualified", "quoted"].includes(l.stage)).length;
  const convertedLeads = leads.filter(l => ["booked", "converted", "completed"].includes(l.status) || ["converted", "closed"].includes(l.stage)).length;
  const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  // --- Compute Operational Job Metrics ---
  const activeBookings = bookings.filter(b => ["confirmed", "assigned", "packing", "transit", "in_progress"].includes(b.status));
  const completedBookings = bookings.filter(b => ["delivered", "completed"].includes(b.status));
  const activeProjects = projects.filter(p => ["discovery", "in_progress", "client_review"].includes(p.status));
  const completedProjects = projects.filter(p => ["completed", "care_plan_active"].includes(p.status));

  const totalActiveJobs = activeBookings.length + activeProjects.length;
  const totalCompletedJobs = completedBookings.length + completedProjects.length;

  // --- Compute Financial Intelligence ---
  const financials = extractFinancialMetrics(ledgerEntries, divisionFilter);

  // --- Outstanding Balances & Liabilities ---
  const bookingBalanceDue = bookings
    .filter(b => b.status !== "cancelled")
    .reduce((sum, b) => sum + (Number(b.balanceDue) || 0), 0);
  const projectBalanceDue = projects
    .filter(p => p.status !== "cancelled")
    .reduce((sum, p) => sum + (Number(p.balanceDue) || 0), 0);
  const totalOutstandingBalances = bookingBalanceDue + projectBalanceDue;

  const partnerPayoutsDue = rawPartners.reduce((sum, p) => sum + (Number(p.walletBalance) || 0), 0);

  // --- Division Breakdown (Always computed for executive view) ---
  const divisionBreakdown = {
    logistics: {
      leads: leads.filter(l => l.division === "logistics").length,
      activeJobs: bookings.filter(b => b.division === "logistics" && ["confirmed", "assigned", "packing", "transit"].includes(b.status)).length,
      completedJobs: bookings.filter(b => b.division === "logistics" && ["delivered", "completed"].includes(b.status)).length,
      financials: extractFinancialMetrics(rawLedger, "logistics")
    },
    home_services: {
      leads: leads.filter(l => l.division === "home_services").length,
      activeJobs: bookings.filter(b => b.division === "home_services" && ["assigned", "in_progress"].includes(b.status)).length,
      completedJobs: bookings.filter(b => b.division === "home_services" && b.status === "completed").length,
      financials: extractFinancialMetrics(rawLedger, "home_services")
    },
    digital: {
      leads: leads.filter(l => l.division === "digital").length,
      activeJobs: projects.filter(p => ["discovery", "in_progress", "client_review"].includes(p.status)).length,
      completedJobs: projects.filter(p => ["completed", "care_plan_active"].includes(p.status)).length,
      financials: extractFinancialMetrics(rawLedger, "digital")
    }
  };

  return {
    timestamp: now,
    division: divisionFilter,
    kpis: {
      leads: {
        total: totalLeads,
        new: newLeads,
        qualified: qualifiedLeads,
        converted: convertedLeads,
        conversionRate
      },
      operations: {
        activeJobs: totalActiveJobs,
        completedJobs: totalCompletedJobs,
        activeBookingsCount: activeBookings.length,
        activeProjectsCount: activeProjects.length
      },
      financials,
      liabilities: {
        outstandingCustomerBalances: totalOutstandingBalances,
        bookingBalanceDue,
        projectBalanceDue,
        partnerPayoutsDue
      }
    },
    divisionBreakdown
  };
}

/**
 * Resolves a unified 360-degree customer profile across all 3 divisions.
 * @param {object} db - Firestore database instance.
 * @param {object} query - { customerUid, phone, email }
 * @param {object} [context={}] - Caller authentication context for PII protection.
 * @returns {Promise<object>} Unified customer history profile.
 */
async function getUnifiedCustomerProfile(db, query, context = {}) {
  const customerUid = query?.customerUid || query?.customerId || query?.uid;
  const phone = query?.phone;
  const email = query?.email;
  if (!customerUid && !phone && !email) {
    throw new Error("INVALID_CUSTOMER_QUERY: Must provide customerUid, phone, or email.");
  }

  const cleanPhone = phone ? String(phone).replace(/\D/g, "").slice(-10) : "";
  const cleanEmail = email ? String(email).trim().toLowerCase() : "";

  // 1. Resolve User document
  let userDoc = null;
  if (customerUid) {
    const snap = await db.collection("users").doc(customerUid).get();
    if (snap.exists) userDoc = Object.assign({ id: snap.id }, snap.data());
  }

  const resolvedPhone = cleanPhone || (userDoc?.phone ? String(userDoc.phone).replace(/\D/g, "").slice(-10) : "");
  const resolvedEmail = cleanEmail || (userDoc?.email ? String(userDoc.email).trim().toLowerCase() : "");

  // 2. Fetch customer bookings
  const bookingsSnap = await db.collection("bookings").limit(500).get();
  const rawBookings = bookingsSnap.docs ? bookingsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const customerBookings = rawBookings
    .map(normalizeBooking)
    .filter(b => {
      if (customerUid && (b.customerUid === customerUid || b.customerId === customerUid)) return true;
      if (resolvedPhone && b.customerPhone && b.customerPhone.replace(/\D/g, "").slice(-10) === resolvedPhone) return true;
      if (resolvedEmail && b.customerEmail && b.customerEmail.toLowerCase() === resolvedEmail) return true;
      return false;
    });

  // 3. Fetch customer digital projects
  const projectsSnap = await db.collection("projects").limit(200).get();
  const rawProjects = projectsSnap.docs ? projectsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const customerProjects = rawProjects
    .map(normalizeProject)
    .filter(p => {
      if (resolvedEmail && p.clientEmail && p.clientEmail.toLowerCase() === resolvedEmail) return true;
      if (resolvedPhone && p.clientPhone && p.clientPhone.replace(/\D/g, "").slice(-10) === resolvedPhone) return true;
      return false;
    });

  // 4. Fetch customer leads
  const leadsSnap = await db.collection("leads").limit(500).get();
  const rawLeads = leadsSnap.docs ? leadsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const customerLeads = rawLeads
    .map(normalizeLead)
    .filter(l => {
      if (resolvedPhone && l.phone && l.phone.replace(/\D/g, "").slice(-10) === resolvedPhone) return true;
      if (resolvedEmail && l.email && l.email.toLowerCase() === resolvedEmail) return true;
      return false;
    });

  // 5. Total customer lifetime value (CLV)
  const totalCollections = customerBookings.reduce((sum, b) => sum + b.paid, 0) +
    customerProjects.reduce((sum, p) => sum + p.paidAmount, 0);
  const totalOutstanding = customerBookings.reduce((sum, b) => sum + b.balanceDue, 0) +
    customerProjects.reduce((sum, p) => sum + p.balanceDue, 0);

  // 6. Apply PII protection if caller is not verified owner or admin
  const isPrivileged = context.isStaff || context.auth?.token?.role === "owner" || context.auth?.token?.role === "admin";
  const displayPhone = isPrivileged
    ? (userDoc?.phone || resolvedPhone)
    : (resolvedPhone ? `${resolvedPhone.slice(0, 2)}******${resolvedPhone.slice(-2)}` : "");
  const displayEmail = isPrivileged
    ? (userDoc?.email || resolvedEmail)
    : (resolvedEmail ? `${resolvedEmail.slice(0, 2)}***@${resolvedEmail.split("@")[1] || "domain.com"}` : "");

  return {
    profile: {
      uid: userDoc?.id || customerUid || "",
      displayName: userDoc?.displayName || userDoc?.name || customerBookings[0]?.customerName || customerLeads[0]?.customerName || "PackZen Customer",
      phone: displayPhone,
      email: displayEmail,
      role: userDoc?.role || "customer",
      createdAt: userDoc?.createdAt || customerBookings[0]?.createdAt || customerLeads[0]?.createdAt || null
    },
    lifetimeValue: {
      totalPaid: totalCollections,
      totalOutstanding,
      totalJobs: customerBookings.length + customerProjects.length,
      totalLeads: customerLeads.length
    },
    history: {
      bookings: customerBookings,
      projects: customerProjects,
      leads: customerLeads
    }
  };
}

/**
 * Scans for critical operational items needing immediate owner or staff attention.
 * @param {object} db - Firestore database instance.
 * @param {object} [opts={}]
 * @returns {Promise<object>} Action stream items.
 */
async function getOwnerActionStream(db, opts = {}) {
  const now = opts.nowMs || Date.now();
  const alerts = [];

  // 1. Unassigned leads older than 15 minutes (SLA breach danger)
  const leadsSnap = await db.collection("leads").where("status", "==", "new").limit(100).get();
  const rawLeads = leadsSnap.docs ? leadsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  for (const lead of rawLeads) {
    const createdMs = lead.createdAtMs || (lead.createdAt?.toMillis ? lead.createdAt.toMillis() : (lead.createdAt || 0));
    const ageMinutes = createdMs > 0 ? Math.round((now - createdMs) / 60000) : 0;
    if (ageMinutes >= 15) {
      alerts.push({
        id: `alert_lead_sla_${lead.id}`,
        type: "lead_sla_breach",
        severity: ageMinutes >= 60 ? "CRITICAL" : "WARNING",
        title: `Uncontacted ${lead.division || "logistics"} Lead: ${lead.name || lead.phone}`,
        subtitle: `Inbound inquiry unassigned for ${ageMinutes} minutes`,
        entityType: "lead",
        entityId: lead.id,
        actionUrl: `/admin.html#leads`,
        actionLabel: "Assign Advisor",
        timestamp: createdMs
      });
    }
  }

  // 2. High outstanding balances on completed or review projects (> ₹10,000)
  const projectsSnap = await db.collection("projects").limit(200).get();
  const rawProjects = projectsSnap.docs ? projectsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  for (const proj of rawProjects.map(normalizeProject)) {
    if (proj.balanceDue >= 10000 && (proj.status === "client_review" || proj.status === "completed")) {
      alerts.push({
        id: `alert_proj_bal_${proj.id}`,
        type: "outstanding_balance",
        severity: "INFO",
        title: `Pending Balance: ₹${proj.balanceDue.toLocaleString("en-IN")}`,
        subtitle: `Project ${proj.businessName} deliverable awaiting final payment`,
        entityType: "project",
        entityId: proj.id,
        actionUrl: `/admin.html#projects`,
        actionLabel: "Collect Balance",
        timestamp: now
      });
    }
  }

  // 3. Automation Dead-Letters & Failures
  const outboxSnap = await db.collection("automation_outbox").where("status", "in", ["dead_letter", "failed"]).limit(50).get();
  const rawOutbox = outboxSnap.docs ? outboxSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  for (const event of rawOutbox) {
    alerts.push({
      id: `alert_outbox_${event.id}`,
      type: "automation_failure",
      severity: "CRITICAL",
      title: `Failed Notification: ${event.eventType || "Event"}`,
      subtitle: `Channel delivery failed: ${event.lastError || "Unknown error"}`,
      entityType: "outbox",
      entityId: event.id,
      actionUrl: `/admin.html#automation`,
      actionLabel: "Retry Event",
      timestamp: event.createdAtMs || now
    });
  }

  // Sort alerts by severity (CRITICAL > WARNING > INFO) and recency
  const severityScore = { CRITICAL: 3, WARNING: 2, INFO: 1 };
  alerts.sort((a, b) => (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0) || b.timestamp - a.timestamp);

  return {
    timestamp: now,
    totalAlerts: alerts.length,
    criticalCount: alerts.filter(a => a.severity === "CRITICAL").length,
    warningCount: alerts.filter(a => a.severity === "WARNING").length,
    alerts
  };
}

module.exports = {
  getExecutiveOverview,
  getUnifiedCustomerProfile,
  getOwnerActionStream
};
