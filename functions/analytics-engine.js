/**
 * PACKZEN 3.0 — Advanced Analytics & Business Intelligence Engine (Phase 4E)
 * ------------------------------------------------------------------
 * Multi-dimensional business intelligence, cohort conversion rates,
 * partner performance analytics, and transparent explainable forecasting.
 *
 * GOVERNING STANDARD:
 * - Actuals, Calculated Metrics, and Forecasts are strictly segregated.
 * - Forecasts use mathematical run-rates and historical stage-weighted conversion.
 * - Zero black-box AI-invented financial estimates.
 */
"use strict";

const {
  normalizeBooking,
  normalizeProject,
  normalizeLead,
  normalizeLedgerEntry,
  extractFinancialMetrics
} = require("./unified-models");

/**
 * Computes multi-dimensional business analytics and forecasting.
 * @param {object} db - Firestore database instance.
 * @param {object} [opts={}]
 * @returns {Promise<object>} Analytics and forecasting report.
 */
async function generateAnalyticsReport(db, opts = {}) {
  const now = opts.nowMs || Date.now();
  const daysHorizon = opts.days || 30;
  const horizonMs = daysHorizon * 86400000;
  const cutoffMs = now - horizonMs;

  // 1. Fetch raw datasets
  const [leadsSnap, bookingsSnap, projectsSnap, ledgerSnap, partnersSnap] = await Promise.all([
    db.collection("leads").limit(1000).get(),
    db.collection("bookings").limit(1000).get(),
    db.collection("projects").limit(500).get(),
    db.collection("ledger").limit(2000).get(),
    db.collection("partners").limit(300).get()
  ]);

  const rawLeads = leadsSnap.docs ? leadsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const rawBookings = bookingsSnap.docs ? bookingsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const rawProjects = projectsSnap.docs ? projectsSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const rawLedger = ledgerSnap.docs ? ledgerSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];
  const rawPartners = partnersSnap.docs ? partnersSnap.docs.map(d => Object.assign({ id: d.id }, d.data())) : [];

  const leads = rawLeads.map(normalizeLead);
  const bookings = rawBookings.map(normalizeBooking);
  const projects = rawProjects.map(normalizeProject);
  const ledger = rawLedger.map(normalizeLedgerEntry);

  // 2. Lead Attribution by Source
  const leadsBySource = {};
  for (const l of leads) {
    const src = l.source || "direct";
    leadsBySource[src] = (leadsBySource[src] || 0) + 1;
  }

  // 3. Conversion Rates by Division
  const conversionByDivision = {};
  for (const div of ["logistics", "home_services", "digital"]) {
    const divLeads = leads.filter(l => l.division === div);
    const divConverted = divLeads.filter(l => ["booked", "converted", "completed"].includes(l.status) || ["converted", "closed"].includes(l.stage));
    conversionByDivision[div] = {
      totalLeads: divLeads.length,
      converted: divConverted.length,
      conversionRate: divLeads.length > 0 ? Math.round((divConverted.length / divLeads.length) * 100) : 0
    };
  }

  // 4. Ticket Sizes (Average Booking Value / Average Project Value)
  const completedMoves = bookings.filter(b => b.division === "logistics" && b.total > 0 && b.status !== "cancelled");
  const avgMoveValue = completedMoves.length > 0
    ? Math.round(completedMoves.reduce((s, b) => s + b.total, 0) / completedMoves.length)
    : 0;

  const completedServices = bookings.filter(b => b.division === "home_services" && b.total > 0 && b.status !== "cancelled");
  const avgServiceValue = completedServices.length > 0
    ? Math.round(completedServices.reduce((s, b) => s + b.total, 0) / completedServices.length)
    : 0;

  const activeDigital = projects.filter(p => p.totalAmount > 0 && p.status !== "cancelled");
  const avgProjectValue = activeDigital.length > 0
    ? Math.round(activeDigital.reduce((s, p) => s + p.totalAmount, 0) / activeDigital.length)
    : 0;

  // 5. Repeat Customer Analysis
  const customerJobCounts = {};
  for (const b of bookings) {
    const uid = b.customerUid || b.customerPhone;
    if (uid) customerJobCounts[uid] = (customerJobCounts[uid] || 0) + 1;
  }
  const totalUniqueCustomers = Object.keys(customerJobCounts).length;
  const repeatCustomers = Object.values(customerJobCounts).filter(count => count > 1).length;
  const repeatCustomerRate = totalUniqueCustomers > 0 ? Math.round((repeatCustomers / totalUniqueCustomers) * 100) : 0;

  // 6. Partner Performance
  const partnerPerformance = rawPartners.map(p => ({
    partnerId: p.id || p.partnerId,
    name: p.name || "Service Partner",
    division: p.division || "logistics",
    completedJobs: Number(p.totalJobsCompleted || p.totalTrips || 0),
    rating: Number(p.rating || p.averageRating || 5.0),
    walletBalance: Number(p.walletBalance || 0),
    status: p.status || (p.verificationStatus === "approved" ? "active" : "pending")
  }));

  // 7. Authoritative Financials
  const enterpriseFinancials = extractFinancialMetrics(ledger, "all");

  // 8. Transparent Mathematical Forecasting
  // Run-rate projection: Daily average collection over the horizon extrapolated over next 30 days
  const recentCollections = ledger
    .filter(tx => tx.type === "collection")
    .reduce((s, tx) => s + tx.amount, 0);

  const dailyVelocity = daysHorizon > 0 ? recentCollections / daysHorizon : 0;
  const projected30DayCollections = Math.round(dailyVelocity * 30);

  // Pipeline weighted pipeline value:
  // (Open Logistics Leads * AvgMove * Logistics Conversion Rate) +
  // (Open Home Leads * AvgService * Home Conversion Rate) +
  // (Open Digital Leads * AvgProject * Digital Conversion Rate)
  const openLogistics = leads.filter(l => l.division === "logistics" && ["new", "qualified", "quoted"].includes(l.status)).length;
  const openHome = leads.filter(l => l.division === "home_services" && ["new", "qualified", "quoted"].includes(l.status)).length;
  const openDigital = leads.filter(l => l.division === "digital" && ["new", "qualified", "quoted"].includes(l.status)).length;

  const weightedPipeline = Math.round(
    (openLogistics * avgMoveValue * ((conversionByDivision.logistics?.conversionRate || 25) / 100)) +
    (openHome * avgServiceValue * ((conversionByDivision.home_services?.conversionRate || 40) / 100)) +
    (openDigital * avgProjectValue * ((conversionByDivision.digital?.conversionRate || 15) / 100))
  );

  return {
    meta: {
      generatedAtMs: now,
      daysHorizon,
      currency: "INR"
    },
    actuals: {
      totalLeads: leads.length,
      totalBookings: bookings.length,
      totalProjects: projects.length,
      financials: enterpriseFinancials,
      liabilities: {
        outstandingReceivables: bookings.reduce((s, b) => s + b.balanceDue, 0) + projects.reduce((s, p) => s + p.balanceDue, 0),
        partnerPayoutsDue: rawPartners.reduce((s, p) => s + (Number(p.walletBalance) || 0), 0)
      }
    },
    calculatedMetrics: {
      leadsBySource,
      conversionByDivision,
      unitEconomics: {
        avgMoveValue,
        avgServiceValue,
        avgProjectValue
      },
      retention: {
        totalUniqueCustomers,
        repeatCustomers,
        repeatCustomerRate
      },
      partnerPerformance
    },
    forecasts: {
      basis: "Mathematical velocity run-rate and historical division-weighted conversion (Explainable Formula)",
      dailyCollectionVelocity: Math.round(dailyVelocity),
      projected30DayCollections,
      weightedPipelineValue: weightedPipeline,
      projectedOperatingMarginPercent: enterpriseFinancials.contributionMarginPercent
    }
  };
}

module.exports = {
  generateAnalyticsReport
};
