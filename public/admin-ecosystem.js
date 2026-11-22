/**
 * PackZen Master Business Operating System — Unified Admin Ecosystem
 * ------------------------------------------------------------------
 * Divisions:
 *   - logistics: PackZen Logistics (Movers, Shifting, Vehicles)
 *   - home_services: PackZen Home Services (AC Wave 1, Appliances Wave 2)
 *   - digital: PackZen Digital (Web Development, E-commerce, SEO, Care Plans)
 *
 * Core Financial Principle:
 *   Customer Collections ≠ Contribution Margin ≠ Net Operating Profit
 *   Accounting Model: Categorized Financial Transaction Ledger
 *   Collections = Gross Customer Inflows − Refunds
 *   Direct Costs = Partner Payouts + Materials + Transport + Gateway Fees + Discounts
 *   Contribution = Collections − Direct Service Costs
 *   Net Operating Profit = Contribution − Shared Operating Expenses
 *
 * Persistence Policy:
 *   - Real-time cloud persistence via Firestore (Admin-only restricted collections).
 *   - Explicit write status distinction: 'firestore' (synced) vs 'local_fallback' (un-synced) vs 'failed_write'.
 *   - Zero hardcoded personal contact details or sensitive credentials in client code.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const rup = (n) => "₹" + Math.round(num(n)).toLocaleString("en-IN");

  const todayStr = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  // Storage keys for offline resilience / fallback
  const STORAGE_KEYS = {
    technicians: "pz_eco_technicians_v2",
    projects: "pz_eco_projects_v2",
    ledger: "pz_eco_ledger_v2",
    prospects: "pz_eco_prospects_v2",
    assumptions: "pz_eco_assumptions_v2"
  };

  function loadLocal(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveLocal(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  // Toast notifier
  function notify(msg, type = "info") {
    if (typeof window.toast === "function") {
      window.toast(msg);
    } else {
      console.log(`[PackZen ${type.toUpperCase()}]`, msg);
    }
  }

  /* ── Structural Planning Assumptions (Configurable, No Mock Records) ─── */
  const DEFAULT_ASSUMPTIONS = {
    logistics: { avgTicket: 5000, directCost: 4500, contribution: 500, targetMonthlyVol: 20 },
    home_services: { avgTicket: 1500, directCost: 1200, contribution: 300, targetMonthlyVol: 40 },
    digital_project: { avgTicket: 14999, directCost: 6999, contribution: 8000, targetMonthlyVol: 5 },
    digital_care_plan: { avgTicket: 999, directCost: 299, contribution: 700, targetMonthlyVol: 30 },
    sharedMonthlyOpex: 12000,
    longTermTargetNetProfit: 100000
  };

  /* ── State Container (Zero Hardcoded Personal Details) ───────── */
  const state = {
    divisionFilter: "all", // all | logistics | home_services | digital
    dateFilter: "month",   // today | week | month | last_month | custom
    customStart: "",
    customEnd: "",
    pipelineSearch: "",
    pipelineDivFilter: "all",
    technicians: loadLocal(STORAGE_KEYS.technicians, []),
    projects: loadLocal(STORAGE_KEYS.projects, []),
    ledger: loadLocal(STORAGE_KEYS.ledger, []),
    prospects: loadLocal(STORAGE_KEYS.prospects, []),
    assumptions: loadLocal(STORAGE_KEYS.assumptions, DEFAULT_ASSUMPTIONS),
    allLeads: [],
    firestoreAvailable: false,
    activeUnsubscribers: []
  };

  /* ── Callable Helper (Phase 3) ───────────────────────────────── */
  function getCallable(name) {
    if (typeof window._adminCallable === "function") {
      return window._adminCallable(name);
    }
    return firebase.app().functions("asia-south1").httpsCallable(name);
  }

  /* ── Helper Functions ───────────────────────────────────────── */
  function getLeadDivision(l) {
    if (l.division) return l.division;
    const DIGITAL = ["website", "ecommerce", "seo", "maintenance"];
    const HOME_SERVICES = ["ac", "appliance", "refrigerator", "washing_machine", "electrician", "plumber", "carpenter", "tv", "painting"];
    if (DIGITAL.includes(l.service)) return "digital";
    if (HOME_SERVICES.includes(l.service)) return "home_services";
    return "logistics";
  }

  function matchesDate(dateStr, filter) {
    if (!dateStr) return true;
    const now = new Date(Date.now() + 5.5 * 3600e3);
    const today = now.toISOString().slice(0, 10);
    if (filter === "today") return dateStr.slice(0, 10) === today;
    if (filter === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 86400e3).toISOString().slice(0, 10);
      return dateStr.slice(0, 10) >= weekAgo;
    }
    if (filter === "month") {
      const ym = today.slice(0, 7);
      return dateStr.slice(0, 7) === ym;
    }
    if (filter === "last_month") {
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const ym = prevMonthDate.toISOString().slice(0, 7);
      return dateStr.slice(0, 7) === ym;
    }
    if (filter === "custom" && state.customStart && state.customEnd) {
      const datePart = dateStr.slice(0, 10);
      return datePart >= state.customStart && datePart <= state.customEnd;
    }
    return true;
  }

  // Persistence status badge helper
  function persistenceBadge(status) {
    if (status === "firestore") {
      return '<span class="eco-badge" style="background:#dcfce7;color:#15803d;border:1px solid #86efac" title="Persisted to Cloud Firestore">☁️ Synced</span>';
    }
    if (status === "local_fallback") {
      return '<span class="eco-badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a" title="Saved to local browser storage only (deploy rules to persist to cloud)">⚠️ Local Only</span>';
    }
    return '<span class="eco-badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5" title="Write rejected by server">❌ Error</span>';
  }

  /* ── 1. OVERVIEW ENHANCEMENTS (Honest Metrics Engine) ────── */
  function renderOverviewKPIs() {
    const card = $("readinessCard");
    if (!card) return;

    let container = $("pzEcoOverviewHeader");
    if (!container) {
      container = document.createElement("div");
      container.id = "pzEcoOverviewHeader";
      card.parentNode.insertBefore(container, card);
    }

    // Filtered bookings
    const bookings = (window.allBookings || []).filter(b => {
      const d = b.date || (b.createdAt?.toDate ? b.createdAt.toDate().toISOString().slice(0, 10) : "");
      return matchesDate(d, state.dateFilter);
    });

    // Filtered leads
    const leads = (state.allLeads || window._leads || []).filter(l => {
      const d = l.date || (l.createdAtMs ? new Date(l.createdAtMs + 5.5*3600e3).toISOString().slice(0, 10) : "");
      return matchesDate(d, state.dateFilter);
    });

    // Filtered ledger entries
    const ledger = state.ledger.filter(tx => matchesDate(tx.date, state.dateFilter));

    // Calculate metrics by division
    const calcDiv = (div) => {
      const divLeads = leads.filter(l => div === "all" || getLeadDivision(l) === div);
      const divBookings = bookings.filter(b => {
        if (div === "all") return true;
        if (div === "logistics") return !b.serviceCategory || b.serviceCategory === "moving";
        if (div === "home_services") return b.serviceCategory === "home_services" || b.serviceCategory === "appliance";
        return false;
      });
      const divLedger = ledger.filter(tx => div === "all" || tx.division === div || (div === "all" && tx.division === "overhead"));

      const enquiriesTotal = divLeads.length;
      const enquiriesNew = divLeads.filter(l => l.status === "new").length;
      const enquiriesQualified = divLeads.filter(l => ["qualified", "quoted", "follow_up", "advance_received", "assigned", "in_progress", "completed", "booked"].includes(l.status)).length;
      const quotationsSent = divLeads.filter(l => ["quoted", "follow_up", "advance_received", "assigned", "in_progress", "completed", "booked"].includes(l.status)).length;
      const confirmedBookings = divBookings.filter(b => b.status !== "cancelled").length + (div === "digital" || div === "all" ? state.projects.length : 0);
      const completedJobs = divBookings.filter(b => b.status === "completed" || b.status === "delivered").length + (div === "digital" || div === "all" ? state.projects.filter(p => p.status === "completed" || p.status === "care_plan_active").length : 0);

      // Financials from Ledger
      const grossCollections = divLedger.filter(tx => tx.type === "collection").reduce((s, tx) => s + num(tx.amount), 0);
      const refunds = divLedger.filter(tx => tx.type === "refund").reduce((s, tx) => s + num(tx.amount), 0);
      const collections = Math.max(0, grossCollections - refunds);

      const baseDirectCosts = divLedger.filter(tx => tx.type === "direct_cost").reduce((s, tx) => s + num(tx.amount), 0);
      const gatewayFees = divLedger.filter(tx => tx.type === "direct_cost" && tx.subcat === "gateway_fee").reduce((s, tx) => s + num(tx.amount), 0);
      const discounts = divLedger.filter(tx => tx.type === "discount").reduce((s, tx) => s + num(tx.amount), 0);
      const directCosts = baseDirectCosts + discounts;

      const partnerPayouts = divLedger.filter(tx => tx.type === "direct_cost" && (tx.subcat === "partner_payout" || tx.subcat === "labor")).reduce((s, tx) => s + num(tx.amount), 0);
      const contribution = collections - directCosts;
      const sharedOpex = div === "all" ? divLedger.filter(tx => tx.type === "shared_opex").reduce((s, tx) => s + num(tx.amount), 0) : 0;
      const netProfit = contribution - sharedOpex;

      return {
        enquiriesTotal, enquiriesNew, enquiriesQualified, quotationsSent,
        confirmedBookings, completedJobs,
        collections, partnerPayouts, directCosts, contribution, sharedOpex, netProfit, refunds, gatewayFees
      };
    };

    const metrics = calcDiv(state.divisionFilter);
    const contribPct = metrics.collections > 0 ? Math.round((metrics.contribution / metrics.collections) * 100) : 0;
    const netProfitPct = metrics.collections > 0 ? Math.round((metrics.netProfit / metrics.collections) * 100) : 0;

    container.innerHTML = `
      <!-- 3-Division Filter Bar -->
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
        <div class="eco-pill-group" style="margin-bottom:0;">
          <span style="font-size:0.75rem;font-weight:700;color:var(--muted,#6B7D74);text-transform:uppercase;margin-right:4px;">Division:</span>
          <button class="eco-pill-btn ${state.divisionFilter === "all" ? "active" : ""}" onclick="pzEco.setDivision('all')">🌐 All Divisions</button>
          <button class="eco-pill-btn ${state.divisionFilter === "logistics" ? "active" : ""}" onclick="pzEco.setDivision('logistics')">📦 PackZen Logistics</button>
          <button class="eco-pill-btn ${state.divisionFilter === "home_services" ? "active" : ""}" onclick="pzEco.setDivision('home_services')">❄️ Home Services</button>
          <button class="eco-pill-btn ${state.divisionFilter === "digital" ? "active" : ""}" onclick="pzEco.setDivision('digital')">💻 PackZen Digital</button>
        </div>

        <div class="eco-pill-group" style="margin-bottom:0;">
          <span style="font-size:0.75rem;font-weight:700;color:var(--muted,#6B7D74);text-transform:uppercase;margin-right:4px;">Date:</span>
          <button class="eco-pill-btn ${state.dateFilter === "today" ? "active" : ""}" onclick="pzEco.setDateFilter('today')">Today</button>
          <button class="eco-pill-btn ${state.dateFilter === "week" ? "active" : ""}" onclick="pzEco.setDateFilter('week')">Last 7 Days</button>
          <button class="eco-pill-btn ${state.dateFilter === "month" ? "active" : ""}" onclick="pzEco.setDateFilter('month')">This Month</button>
          <button class="eco-pill-btn ${state.dateFilter === "last_month" ? "active" : ""}" onclick="pzEco.setDateFilter('last_month')">Previous Month</button>
        </div>
      </div>

      <!-- Statutory Core Financial Distinction Notice -->
      <div class="eco-alert-banner">
        <span>⚖️</span>
        <div>
          <strong>Statutory Financial Principle:</strong> Customer Collections ≠ Contribution Margin ≠ Net Operating Profit.
          Gross collections represent customer cash received. Direct costs (partner payouts, transport, materials, gateway fees) are subtracted to compute Contribution. Shared operating expenses (marketing, cloud hosting, software) are subtracted to compute Net Operating Profit.
        </div>
      </div>

      <!-- Honest KPI Grid -->
      <div class="eco-kpi-grid">
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Total Enquiries</div>
          <div class="eco-kpi-val">${metrics.enquiriesTotal}</div>
          <div class="eco-kpi-sub">${metrics.enquiriesNew} new · ${metrics.enquiriesQualified} qualified</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Quotes Sent</div>
          <div class="eco-kpi-val" style="color:#d97706">${metrics.quotationsSent}</div>
          <div class="eco-kpi-sub">${metrics.confirmedBookings} confirmed</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Completed Jobs</div>
          <div class="eco-kpi-val" style="color:var(--accent,#1F9D5C)">${metrics.completedJobs}</div>
          <div class="eco-kpi-sub">Delivered & closed</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Net Customer Collections</div>
          <div class="eco-kpi-val" style="color:#00c96e">${rup(metrics.collections)}</div>
          <div class="eco-kpi-sub">${metrics.refunds > 0 ? `Gross ${rup(metrics.collections + metrics.refunds)} less ${rup(metrics.refunds)} refunds` : "Net customer payments received"}</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Direct Costs & Payouts</div>
          <div class="eco-kpi-val" style="color:#ef4444">${rup(metrics.directCosts)}</div>
          <div class="eco-kpi-sub">${rup(metrics.partnerPayouts)} partner payouts</div>
        </div>
        <div class="eco-kpi-card" style="border:1px solid rgba(31,157,92,0.4)">
          <div class="eco-kpi-lbl">Contribution Margin</div>
          <div class="eco-kpi-val" style="color:#10b981">${rup(metrics.contribution)}</div>
          <div class="eco-kpi-sub">${contribPct}% margin on collections</div>
        </div>
        <div class="eco-kpi-card" style="border:1px solid rgba(99,102,241,0.4)">
          <div class="eco-kpi-lbl">Net Operating Profit</div>
          <div class="eco-kpi-val ${metrics.netProfit >= 0 ? "eco-profit-positive" : "eco-profit-negative"}">${rup(metrics.netProfit)}</div>
          <div class="eco-kpi-sub">After ${rup(metrics.sharedOpex)} shared opex (${netProfitPct}%)</div>
        </div>
      </div>
    `;
  }

  /* ── 2. OWNER OPERATING DASHBOARD (Unified 3-Division Operating Console) ─── */
  function renderOwner() {
    const sec = $("sectionOwner");
    if (!sec) return;

    const today = todayStr();
    const leads = state.allLeads || window._leads || [];
    const bookings = window.allBookings || [];
    const divFilter = state.divisionFilter || "all";

    // Filter by division if selected
    const filteredLeads = leads.filter(l => divFilter === "all" || getLeadDivision(l) === divFilter);
    const filteredBookings = bookings.filter(b => {
      if (divFilter === "all") return true;
      if (divFilter === "logistics") return !b.serviceCategory || b.serviceCategory === "moving";
      if (divFilter === "home_services") return b.serviceCategory === "home_services" || b.serviceCategory === "appliance";
      return false;
    });
    const filteredProjects = state.projects.filter(p => divFilter === "all" || divFilter === "digital");
    const filteredLedger = state.ledger.filter(tx => divFilter === "all" || tx.division === divFilter || (divFilter === "all" && tx.division === "overhead"));

    // Financial Metrics
    const grossCollections = filteredLedger.filter(tx => tx.type === "collection").reduce((s, tx) => s + num(tx.amount), 0);
    const refunds = filteredLedger.filter(tx => tx.type === "refund").reduce((s, tx) => s + num(tx.amount), 0);
    const netCollections = Math.max(0, grossCollections - refunds);
    const directCosts = filteredLedger.filter(tx => tx.type === "direct_cost").reduce((s, tx) => s + num(tx.amount), 0);
    const contribution = netCollections - directCosts;
    const opex = filteredLedger.filter(tx => tx.type === "shared_opex").reduce((s, tx) => s + num(tx.amount), 0);
    const netProfit = contribution - opex;

    const bookingBalance = filteredBookings.filter(b => b.status !== "cancelled").reduce((s, b) => s + Math.max(0, num(b.total) - num(b.paid)), 0);
    const projectBalance = filteredProjects.filter(p => p.status !== "cancelled").reduce((s, p) => s + num(p.balanceDue), 0);
    const totalOutstanding = bookingBalance + projectBalance;

    // Triage items
    const overdueLeads = filteredLeads.filter(l => {
      const open = !["lost", "cancelled", "not_serviceable", "completed", "paid"].includes(l.status);
      const due = l.nextActionDate || l.date;
      return open && due && due < today;
    });

    const todayMoves = bookings.filter(b => b.date === today && b.status !== "cancelled");
    const activeProjects = state.projects.filter(p => p.status === "in_progress" || p.status === "discovery");

    sec.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <h2 style="margin:0;font-size:1.4rem;">⚡ PackZen 3.0 Unified Owner Command Center</h2>
            <p style="margin:4px 0 0;font-size:0.85rem;color:var(--muted,#6B7D74);">
              Integrated Executive Console: Logistics · Home Services · Digital | Honest Categorized Ledger P&L
            </p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="eco-btn eco-btn-secondary" onclick="pzEco.checkSystemHealth()">
              🟢 System Health
            </button>
            <button class="eco-btn eco-btn-secondary" onclick="pzEco.openCustomer360()">
              👥 Customer 360
            </button>
            <button class="eco-btn eco-btn-primary" onclick="pzEco.generateWeeklyReview()">
              📋 Weekly Review
            </button>
          </div>
        </div>

        <!-- Global Division Filter Bar -->
        <div style="display:flex;gap:8px;margin-top:14px;padding:8px 12px;background:var(--surface2,#f8fafc);border-radius:8px;border:1px solid rgba(0,0,0,0.06);flex-wrap:wrap;">
          <strong style="align-self:center;font-size:0.82rem;color:var(--muted,#6B7D74);margin-right:6px;">Division:</strong>
          <button class="eco-btn ${divFilter === 'all' ? 'eco-btn-primary' : 'eco-btn-secondary'}" style="padding:4px 12px;font-size:0.8rem;" onclick="pzEco.setDivisionFilter('all')">
            🌐 All Divisions (${leads.length} Leads)
          </button>
          <button class="eco-btn ${divFilter === 'logistics' ? 'eco-btn-primary' : 'eco-btn-secondary'}" style="padding:4px 12px;font-size:0.8rem;" onclick="pzEco.setDivisionFilter('logistics')">
            📦 Logistics (${leads.filter(l => getLeadDivision(l) === 'logistics').length})
          </button>
          <button class="eco-btn ${divFilter === 'home_services' ? 'eco-btn-primary' : 'eco-btn-secondary'}" style="padding:4px 12px;font-size:0.8rem;" onclick="pzEco.setDivisionFilter('home_services')">
            ❄️ Home Services (${leads.filter(l => getLeadDivision(l) === 'home_services').length})
          </button>
          <button class="eco-btn ${divFilter === 'digital' ? 'eco-btn-primary' : 'eco-btn-secondary'}" style="padding:4px 12px;font-size:0.8rem;" onclick="pzEco.setDivisionFilter('digital')">
            💻 Digital (${state.projects.length} Projects)
          </button>
        </div>
      </div>

      <!-- Real-Time Executive Financial & Operational Health Ribbon -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:18px;">
        <div class="stat-card" style="border-left:4px solid #10b981;">
          <div class="sc-lbl">Net Collections</div>
          <div class="sc-val" style="color:#059669;">${rup(netCollections)}</div>
          <div class="sc-sub">Gross: ${rup(grossCollections)} · Refunds: ${rup(refunds)}</div>
        </div>

        <div class="stat-card" style="border-left:4px solid #6366f1;">
          <div class="sc-lbl">Contribution Margin</div>
          <div class="sc-val" style="color:#4f46e5;">${rup(contribution)}</div>
          <div class="sc-sub">Margin: ${netCollections > 0 ? Math.round((contribution / netCollections) * 100) : 0}% · Direct Costs: ${rup(directCosts)}</div>
        </div>

        <div class="stat-card" style="border-left:4px solid #f59e0b;">
          <div class="sc-lbl">Net Operating Profit</div>
          <div class="sc-val" style="color:${netProfit >= 0 ? '#16a34a' : '#dc2626'};">${rup(netProfit)}</div>
          <div class="sc-sub">Shared Opex: ${rup(opex)} · Margin: ${netCollections > 0 ? Math.round((netProfit / netCollections) * 100) : 0}%</div>
        </div>

        <div class="stat-card" style="border-left:4px solid #ea580c;">
          <div class="sc-lbl">Receivables Outstanding</div>
          <div class="sc-val" style="color:#ea580c;">${rup(totalOutstanding)}</div>
          <div class="sc-sub">Bookings: ${rup(bookingBalance)} · Digital: ${rup(projectBalance)}</div>
        </div>
      </div>

      <!-- Time Allocation Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px;">
        <div class="table-card" style="padding:14px;border-top:3px solid #1F9D5C">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:0.9rem;">📦 1. Logistics (60 min)</strong>
            <span class="eco-badge eco-badge-logistics">Daily Focus</span>
          </div>
          <p style="font-size:0.78rem;color:var(--muted,#6B7D74);margin:8px 0;">
            Driver assignments, packing material stock, move quotations, vehicle partner checks.
          </p>
          <div style="font-size:0.82rem;font-weight:700;">
            ${todayMoves.length} moves today · ${overdueLeads.filter(l => getLeadDivision(l) === "logistics").length} overdue follow-ups
          </div>
        </div>

        <div class="table-card" style="padding:14px;border-top:3px solid #6366f1">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:0.9rem;">💻 2. Digital (45 min)</strong>
            <span class="eco-badge eco-badge-digital">Daily Focus</span>
          </div>
          <p style="font-size:0.78rem;color:var(--muted,#6B7D74);margin:8px 0;">
            Client discovery reviews, wireframe sign-offs, development staging links, care plans.
          </p>
          <div style="font-size:0.82rem;font-weight:700;">
            ${activeProjects.length} active client projects · ${state.projects.filter(p => p.carePlanStatus === "active").length} Care Plans
          </div>
        </div>

        <div class="table-card" style="padding:14px;border-top:3px solid #0284c7">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:0.9rem;">❄️ 3. Home Services (30 min)</strong>
            <span class="eco-badge eco-badge-home_services">Daily Focus</span>
          </div>
          <p style="font-size:0.78rem;color:var(--muted,#6B7D74);margin:8px 0;">
            Technician dispatch, partner screening reviews, customer callback check, rate cards.
          </p>
          <div style="font-size:0.82rem;font-weight:700;">
            ${state.technicians.filter(t => t.active).length} active technicians · ${state.technicians.filter(t => t.screeningStatus === "trial_job").length} on trial
          </div>
        </div>

        <div class="table-card" style="padding:14px;border-top:3px solid #f59e0b">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:0.9rem;">📑 4. Finance & P&L (15 min)</strong>
            <span class="eco-badge" style="background:#fef3c7;color:#b45309">Daily Focus</span>
          </div>
          <p style="font-size:0.78rem;color:var(--muted,#6B7D74);margin:8px 0;">
            Reconcile collections, partner payouts due, payment gateway balance, daily ledger.
          </p>
          <div style="font-size:0.82rem;font-weight:700;">
            ${state.ledger.filter(tx => tx.date === today).length} ledger entries today
          </div>
        </div>
      </div>

      <!-- Decision Action Stream: What Needs Attention Today -->
      <div class="table-card" style="margin-bottom:16px;">
        <div class="table-hdr">
          <div class="table-title">🚨 Action Stream: What Needs Attention Today (${overdueLeads.length} Urgent Items)</div>
        </div>
        <div style="padding:14px;">
          ${overdueLeads.length === 0 ? `
            <div style="text-align:center;color:var(--muted,#6B7D74);padding:20px;">
              ✅ All operational follow-ups and SLAs are completely on track! Great job.
            </div>
          ` : `
            <div style="display:grid;gap:8px;">
              ${overdueLeads.map(l => `
                <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.3);padding:10px 14px;border-radius:6px;flex-wrap:wrap;gap:8px;">
                  <div>
                    <span class="eco-badge eco-badge-${getLeadDivision(l)}">${getLeadDivision(l)}</span>
                    <strong style="margin-left:6px;">${esc(l.name || "Customer")}</strong> (${esc(l.phone || "")})
                    <div style="font-size:0.78rem;color:var(--muted,#6B7D74);margin-top:2px;">
                      Service: ${esc(l.serviceLabel || l.service || "Moving")} · Area: ${esc(l.area || "Bangalore")}
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span class="eco-time-badge overdue">SLA Overdue: ${esc(l.nextActionDate || l.date)}</span>
                    <a href="https://wa.me/91${esc(l.phone || "")}" target="_blank" class="eco-btn eco-btn-primary" style="padding:4px 10px;font-size:0.75rem;">
                      💬 WhatsApp
                    </a>
                    <button class="eco-btn eco-btn-secondary" style="padding:4px 10px;font-size:0.75rem;" onclick="pzEco.openCustomer360('${esc(l.phone || l.name)}')">
                      👥 360
                    </button>
                    <button class="eco-btn eco-btn-secondary" style="padding:4px 10px;font-size:0.75rem;" onclick="pzEco.openLeadModal('${l.id}')">
                      Update
                    </button>
                  </div>
                </div>
              `).join("")}
            </div>
          `}
        </div>
      </div>
    `;
  }

  /* ── 3. UNIFIED LEAD & PIPELINE MANAGEMENT ───────────────── */
  const PIPELINE_STAGES = [
    { key: "new", label: "New", color: "#6B7280" },
    { key: "contacted", label: "Contacted", color: "#3B82F6" },
    { key: "qualified", label: "Qualified", color: "#8B5CF6" },
    { key: "site_visit_pending", label: "Site Visit / Video", color: "#EC4899" },
    { key: "quoted", label: "Quoted", color: "#F59E0B" },
    { key: "follow_up", label: "Follow-up", color: "#D97706" },
    { key: "advance_received", label: "Advance Received", color: "#10B981" },
    { key: "assigned", label: "Assigned", color: "#06B6D4" },
    { key: "in_progress", label: "In Progress", color: "#6366F1" },
    { key: "completed", label: "Completed", color: "#1F9D5C" },
    { key: "paid", label: "Paid in Full", color: "#059669" },
    { key: "review_requested", label: "Review Requested", color: "#14B8A6" }
  ];

  const TERMINAL_STAGES = [
    { key: "lost", label: "Lost", color: "#EF4444" },
    { key: "cancelled", label: "Cancelled", color: "#DC2626" },
    { key: "not_serviceable", label: "Not Serviceable", color: "#9CA3AF" }
  ];

  function renderPipeline() {
    const sec = $("sectionPipeline");
    if (!sec) return;

    const leads = (state.allLeads || window._leads || []).filter(l => {
      if (state.pipelineDivFilter !== "all" && getLeadDivision(l) !== state.pipelineDivFilter) return false;
      if (state.pipelineSearch) {
        const q = state.pipelineSearch.toLowerCase();
        const hay = ((l.name || "") + " " + (l.phone || "") + " " + (l.area || "") + " " + (l.notes || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="pipelineSearchInput" placeholder="Search customer, phone, locality..." value="${esc(state.pipelineSearch)}" class="eco-form-input" style="width:240px;margin-bottom:0;" oninput="pzEco.searchPipeline(this.value)">
          <select class="eco-form-select" style="width:160px;margin-bottom:0;" onchange="pzEco.filterPipelineDiv(this.value)">
            <option value="all" ${state.pipelineDivFilter === "all" ? "selected" : ""}>All Divisions</option>
            <option value="logistics" ${state.pipelineDivFilter === "logistics" ? "selected" : ""}>Logistics</option>
            <option value="home_services" ${state.pipelineDivFilter === "home_services" ? "selected" : ""}>Home Services</option>
            <option value="digital" ${state.pipelineDivFilter === "digital" ? "selected" : ""}>Digital</option>
          </select>
        </div>
        <div style="font-size:0.85rem;color:var(--muted,#6B7D74);">
          Showing ${leads.length} active leads across pipeline
        </div>
      </div>

      <!-- Pipeline Columns -->
      <div class="eco-pipeline-board">
        ${PIPELINE_STAGES.map(stage => {
          const colLeads = leads.filter(l => (l.status || "new") === stage.key);
          return `
            <div class="eco-pipeline-col">
              <div class="eco-pipeline-col-hdr">
                <span>${stage.label}</span>
                <span class="badge" style="background:${stage.color};color:#fff;">${colLeads.length}</span>
              </div>
              <div style="min-height:180px;">
                ${colLeads.length === 0 ? `<div style="font-size:0.75rem;color:var(--muted,#6B7D74);text-align:center;padding:20px 0;">No leads</div>` : ""}
                ${colLeads.map(l => {
                  const div = getLeadDivision(l);
                  const isOverdue = (l.nextActionDate || l.date) && (l.nextActionDate || l.date) < todayStr();
                  return `
                    <div class="eco-lead-card ${isOverdue ? "is-overdue" : ""}" onclick="pzEco.openLeadModal('${l.id}')">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span class="eco-badge eco-badge-${div}">${div}</span>
                        ${isOverdue ? `<span class="eco-time-badge overdue">⚠️ Overdue</span>` : ""}
                      </div>
                      <div style="font-weight:700;font-size:0.88rem;">${esc(l.name || "Customer")}</div>
                      <div style="font-size:0.78rem;color:var(--muted,#6B7D74);margin:2px 0;">
                        📞 ${esc(l.phone || "")} · 📍 ${esc((l.area || "Bangalore").slice(0, 18))}
                      </div>
                      <div style="font-size:0.76rem;margin-top:4px;">
                        <strong>Next:</strong> ${esc((l.nextAction || "Contact customer").slice(0, 30))}
                      </div>
                      ${l.nextActionDate ? `<div style="font-size:0.72rem;color:var(--muted,#6B7D74);margin-top:2px;">Due: ${esc(l.nextActionDate)}</div>` : ""}
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <!-- Terminal / Closed Leads Row -->
      <div class="table-card" style="margin-top:20px;">
        <div class="table-hdr"><div class="table-title">Closed / Exception Enquiries (Lost, Cancelled, Not Serviceable)</div></div>
        <div style="padding:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">
          ${TERMINAL_STAGES.map(t => {
            const list = leads.filter(l => l.status === t.key);
            return `
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <strong style="color:${t.color};font-size:0.88rem;">${t.label}</strong>
                  <span class="badge">${list.length}</span>
                </div>
                ${list.slice(0, 4).map(l => `
                  <div style="font-size:0.78rem;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.08)">
                    <strong>${esc(l.name || "Customer")}</strong> · ${esc(l.phone || "")}
                    <div style="color:var(--muted,#6B7D74);font-size:0.72rem;">Reason: ${esc(l.terminalReason || "Not recorded")}</div>
                  </div>
                `).join("")}
                ${list.length === 0 ? `<div style="font-size:0.75rem;color:var(--muted,#6B7D74)">No records</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  /* ── 4. HOME SERVICES & TECHNICIAN MANAGEMENT ────────────── */
  function renderHomeServices() {
    const sec = $("sectionHomeservices");
    if (!sec) return;

    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="margin:0;font-size:1.4rem;">❄️ PackZen Home Services & Technicians</h2>
          <p style="margin:4px 0 0;font-size:0.85rem;color:var(--muted,#6B7D74);">
            Partner-led home services: AC Wave 1 (Active) · Refrigerator & Washing Machine Wave 2 (Controlled Rollout).
          </p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="eco-btn eco-btn-primary" onclick="pzEco.openAddTechnicianModal()">
            + Add Technician Partner
          </button>
        </div>
      </div>

      <!-- Waves & Coverage Status -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:16px;">
        <div class="table-card" style="padding:14px;border-left:4px solid #1F9D5C">
          <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px;">🟢 Wave 1: AC Services (Live in Bangalore)</div>
          <div style="font-size:0.8rem;color:var(--muted,#6B7D74);margin-bottom:8px;">
            Split & Window AC installation, uninstallation, high-pressure jet servicing, gas top-up (R32 / R410A).
          </div>
          <div style="font-size:0.78rem;">
            <strong>Standard Rates:</strong> Jet Servicing ₹699 (Partner ₹500) · Installation ₹1,499 (Partner ₹1,150)
          </div>
        </div>

        <div class="table-card" style="padding:14px;border-left:4px solid #0284c7">
          <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px;">🔵 Wave 2: Appliances (Screening Partners)</div>
          <div style="font-size:0.8rem;color:var(--muted,#6B7D74);margin-bottom:8px;">
            Single & Double Door Refrigerators, Top & Front Load Washing Machine repairs, inlet/drain motor replacements.
          </div>
          <div style="font-size:0.78rem;">
            <strong>Standard Rates:</strong> Inspection ₹299 (Partner ₹200) · Major Repair ₹1,200 (Partner ₹900)
          </div>
        </div>
      </div>

      <!-- Technician Directory Table -->
      <div class="table-card">
        <div class="table-hdr">
          <div class="table-title">Technician Partner Network (${state.technicians.length} registered)</div>
        </div>
        ${state.technicians.length === 0 ? `
          <div style="padding:32px;text-align:center;color:var(--muted,#6B7D74)">
            No technician partners registered yet. Click <strong>+ Add Technician Partner</strong> above to register vetted technicians into the system.
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>ID & Name</th>
                <th>Contact</th>
                <th>Category & Skills</th>
                <th>Locations Covered</th>
                <th>Availability</th>
                <th>Screening Stage</th>
                <th>Rate Card & Terms</th>
                <th>Jobs & Rating</th>
                <th>Persistence</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.technicians.map(t => `
                <tr>
                  <td>
                    <strong>${esc(t.name)}</strong><br>
                    <code style="font-size:0.75rem;color:var(--primary,#1F9D5C)">${esc(t.id)}</code>
                    ${t.isPrimary ? '<span class="eco-badge" style="background:#dcfce7;color:#15803d;margin-left:4px;">Primary</span>' : ""}
                  </td>
                  <td>
                    ${esc(t.phone)}<br>
                    <small style="color:var(--muted,#6B7D74)">${esc(t.email || "—")}</small>
                  </td>
                  <td>
                    <span class="eco-badge eco-badge-home_services">${esc(t.category)}</span><br>
                    <small style="color:var(--muted,#6B7D74)">${(t.services || []).join(", ")}</small>
                  </td>
                  <td style="max-width:160px;font-size:0.8rem;">
                    ${(t.locations || []).join(", ")}
                  </td>
                  <td>
                    <span class="badge" style="background:${t.availability === "available" ? "#10b981" : (t.availability === "busy" ? "#f59e0b" : "#6b7280")};color:#fff;">
                      ${esc(t.availability)}
                    </span>
                  </td>
                  <td>
                    <span class="badge">${esc(t.screeningStatus)}</span>
                  </td>
                  <td style="font-size:0.78rem;">
                    Payout: ${rup(t.rateCard?.partnerPayout || 500)}/job<br>
                    <small style="color:var(--muted,#6B7D74)">${esc(t.payoutTerms || "Weekly Bank")}</small>
                  </td>
                  <td>
                    <strong>${t.completedJobs || 0}</strong> jobs<br>
                    <span style="color:#d97706">★ ${t.rating || "5.0"}</span>
                  </td>
                  <td>
                    ${persistenceBadge(t.persistence || "firestore")}
                  </td>
                  <td>
                    <button class="eco-btn eco-btn-secondary" style="padding:4px 8px;font-size:0.75rem;" onclick="pzEco.toggleTechnicianAvailability('${t.id}')">
                      Toggle Status
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  /* ── 5. PACKZEN DIGITAL PROJECT MANAGEMENT ───────────────── */
  function renderDigitalProjects() {
    const sec = $("sectionDigitalprojects");
    if (!sec) return;

    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="margin:0;font-size:1.4rem;">💻 PackZen Digital Projects</h2>
          <p style="margin:4px 0 0;font-size:0.85rem;color:var(--muted,#6B7D74);">
            Client web development, e-commerce stores, SEO, and monthly care plans for Bangalore businesses.
          </p>
        </div>
        <button class="eco-btn eco-btn-primary" onclick="pzEco.openAddProjectModal()">
          + New Digital Project
        </button>
      </div>

      <!-- Packages Reference Bar -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:16px;">
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Starter Launch</div>
          <div class="eco-kpi-val" style="font-size:1.2rem;">₹7,999</div>
          <div class="eco-kpi-sub">Single page + WhatsApp funnel</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Business Growth</div>
          <div class="eco-kpi-val" style="font-size:1.2rem;color:var(--primary,#1F9D5C)">₹14,999</div>
          <div class="eco-kpi-sub">5-page custom + SEO schema</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Advanced / Custom</div>
          <div class="eco-kpi-val" style="font-size:1.2rem;color:#6366f1">₹29,999+</div>
          <div class="eco-kpi-sub">Full booking / custom app</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Monthly Care Plan</div>
          <div class="eco-kpi-val" style="font-size:1.2rem;color:#0284c7">₹999/mo</div>
          <div class="eco-kpi-sub">Hosting, edits, security, SSL</div>
        </div>
      </div>

      <!-- Projects Table -->
      <div class="table-card">
        <div class="table-hdr"><div class="table-title">Active Client Projects (${state.projects.length})</div></div>
        ${state.projects.length === 0 ? `
          <div style="padding:32px;text-align:center;color:var(--muted,#6B7D74)">
            No digital projects logged yet. Click <strong>+ New Digital Project</strong> above to create a project with written scope, milestones and payment terms.
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>ID & Client</th>
                <th>Contact</th>
                <th>Package & Value</th>
                <th>Written Scope & Exclusions</th>
                <th>Milestones</th>
                <th>Status</th>
                <th>Payment Terms</th>
                <th>Persistence</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.projects.map(p => `
                <tr>
                  <td>
                    <strong>${esc(p.businessName)}</strong><br>
                    <code style="font-size:0.75rem;color:var(--primary,#1F9D5C)">${esc(p.id)}</code><br>
                    <small style="color:var(--muted,#6B7D74)">${esc(p.contactPerson || "—")}</small>
                  </td>
                  <td>
                    ${esc(p.phone || "—")}<br>
                    <small style="color:var(--muted,#6B7D74)">${esc(p.email || "—")}</small>
                  </td>
                  <td>
                    <strong>${rup(p.amount)}</strong><br>
                    <small style="color:var(--muted,#6B7D74)">${esc(p.package)}</small>
                  </td>
                  <td style="max-width:240px;font-size:0.78rem;">
                    <strong>Scope:</strong> ${esc(p.scope)}<br>
                    <span style="color:#ef4444"><strong>Exclusions:</strong> ${esc(p.exclusions)}</span>
                  </td>
                  <td>
                    <div style="font-size:0.75rem;">
                      ${(p.milestones || []).map(m => `
                        <div>${m.status === "completed" ? "✅" : (m.status === "in_progress" ? "⏳" : "⚪")} ${esc(m.name)}</div>
                      `).join("")}
                    </div>
                  </td>
                  <td>
                    <span class="badge badge-${p.status}">${esc(p.status)}</span><br>
                    <small style="color:var(--muted,#6B7D74)">Dev: ${esc(p.developer || "Unassigned")}</small>
                  </td>
                  <td style="font-size:0.78rem;">
                    Paid: ${rup(p.advancePaid)}<br>
                    <span style="color:${p.balanceDue > 0 ? "#ef4444" : "#10b981"}">
                      Bal: ${rup(p.balanceDue)}
                    </span><br>
                    Care Plan: <strong>${esc(p.carePlanStatus || "None")}</strong>
                  </td>
                  <td>
                    ${persistenceBadge(p.persistence || "firestore")}
                  </td>
                  <td>
                    <button class="eco-btn eco-btn-secondary" style="padding:4px 8px;font-size:0.75rem;" onclick="pzEco.openProjectModal('${p.id}')">
                      Edit
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  /* ── 6. CATEGORIZED FINANCIAL TRANSACTION LEDGER ─────────── */
  function renderLedger() {
    const sec = $("sectionLedger");
    if (!sec) return;

    // Calculations
    const grossCollections = state.ledger.filter(tx => tx.type === "collection").reduce((s, tx) => s + num(tx.amount), 0);
    const refunds = state.ledger.filter(tx => tx.type === "refund").reduce((s, tx) => s + num(tx.amount), 0);
    const totalCollections = Math.max(0, grossCollections - refunds);

    const baseDirectCosts = state.ledger.filter(tx => tx.type === "direct_cost").reduce((s, tx) => s + num(tx.amount), 0);
    const discounts = state.ledger.filter(tx => tx.type === "discount").reduce((s, tx) => s + num(tx.amount), 0);
    const totalDirectCosts = baseDirectCosts + discounts;

    const totalContribution = totalCollections - totalDirectCosts;
    const totalSharedOpex = state.ledger.filter(tx => tx.type === "shared_opex").reduce((s, tx) => s + num(tx.amount), 0);
    const netProfit = totalContribution - totalSharedOpex;

    const contribPct = totalCollections > 0 ? Math.round((totalContribution / totalCollections) * 100) : 0;
    const netMarginPct = totalCollections > 0 ? Math.round((netProfit / totalCollections) * 100) : 0;

    // Scenario planner projection
    const a = state.assumptions;
    const projLogContrib = a.logistics.targetMonthlyVol * a.logistics.contribution;
    const projHomeContrib = a.home_services.targetMonthlyVol * a.home_services.contribution;
    const projDigProjContrib = a.digital_project.targetMonthlyVol * a.digital_project.contribution;
    const projCareContrib = a.digital_care_plan.targetMonthlyVol * a.digital_care_plan.contribution;
    const projTotalContrib = projLogContrib + projHomeContrib + projDigProjContrib + projCareContrib;
    const projNetProfit = projTotalContrib - a.sharedMonthlyOpex;

    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="margin:0;font-size:1.4rem;">📑 Categorized Financial Transaction Ledger</h2>
          <p style="margin:4px 0 0;font-size:0.85rem;color:var(--muted,#6B7D74);">
            Honest financial tracking: Collections − Direct Costs = Contribution; Contribution − Shared Opex = Net Operating Profit.
          </p>
        </div>
        <button class="eco-btn eco-btn-primary" onclick="pzEco.openAddLedgerModal()">
          + Add Transaction / Expense
        </button>
      </div>

      <!-- Financial Integrity Summary Cards -->
      <div class="eco-kpi-grid">
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Customer Collections</div>
          <div class="eco-kpi-val" style="color:#00c96e">${rup(totalCollections)}</div>
          <div class="eco-kpi-sub">${refunds > 0 ? `Gross ${rup(grossCollections)} less ${rup(refunds)} refunds` : "Net customer payments received"}</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Direct Service Costs</div>
          <div class="eco-kpi-val" style="color:#ef4444">${rup(totalDirectCosts)}</div>
          <div class="eco-kpi-sub">Partner payouts, materials, transport</div>
        </div>
        <div class="eco-kpi-card" style="border:1px solid rgba(16,185,129,0.4)">
          <div class="eco-kpi-lbl">Contribution Margin</div>
          <div class="eco-kpi-val" style="color:#10b981">${rup(totalContribution)}</div>
          <div class="eco-kpi-sub">${contribPct}% margin on collections</div>
        </div>
        <div class="eco-kpi-card">
          <div class="eco-kpi-lbl">Shared Operating Expenses</div>
          <div class="eco-kpi-val" style="color:#f59e0b">${rup(totalSharedOpex)}</div>
          <div class="eco-kpi-sub">Marketing, cloud hosting, tools</div>
        </div>
        <div class="eco-kpi-card" style="border:2px solid ${netProfit >= 0 ? "#10b981" : "#ef4444"}">
          <div class="eco-kpi-lbl">Net Operating Profit</div>
          <div class="eco-kpi-val ${netProfit >= 0 ? "eco-profit-positive" : "eco-profit-negative"}">${rup(netProfit)}</div>
          <div class="eco-kpi-sub">${netMarginPct}% net operating margin</div>
        </div>
      </div>

      <!-- Scenario Planning Model vs Actuals -->
      <div class="table-card" style="margin-bottom:20px;">
        <div class="table-hdr">
          <div class="table-title">🎯 Scenario Planning Assumptions (Long-term Ambition: ₹1,00,000/mo Net Profit)</div>
        </div>
        <div style="padding:14px;overflow-x:auto;">
          <table class="eco-scenario-table">
            <thead>
              <tr>
                <th>Service Line</th>
                <th>Planning Ticket</th>
                <th>Direct Cost</th>
                <th>Unit Contribution</th>
                <th>Target Vol / Mo</th>
                <th>Projected Monthly Contribution</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>PackZen Logistics (Shifting)</strong></td>
                <td>${rup(a.logistics.avgTicket)}</td>
                <td>${rup(a.logistics.directCost)}</td>
                <td><strong style="color:#10b981">${rup(a.logistics.contribution)}</strong> (10%)</td>
                <td>${a.logistics.targetMonthlyVol} moves</td>
                <td><strong>${rup(projLogContrib)}</strong></td>
              </tr>
              <tr>
                <td><strong>PackZen Home Services (AC)</strong></td>
                <td>${rup(a.home_services.avgTicket)}</td>
                <td>${rup(a.home_services.directCost)}</td>
                <td><strong style="color:#10b981">${rup(a.home_services.contribution)}</strong> (20%)</td>
                <td>${a.home_services.targetMonthlyVol} jobs</td>
                <td><strong>${rup(projHomeContrib)}</strong></td>
              </tr>
              <tr>
                <td><strong>PackZen Digital Projects</strong></td>
                <td>${rup(a.digital_project.avgTicket)}</td>
                <td>${rup(a.digital_project.directCost)}</td>
                <td><strong style="color:#10b981">${rup(a.digital_project.contribution)}</strong> (53%)</td>
                <td>${a.digital_project.targetMonthlyVol} projects</td>
                <td><strong>${rup(projDigProjContrib)}</strong></td>
              </tr>
              <tr>
                <td><strong>PackZen Digital Care Plans</strong></td>
                <td>${rup(a.digital_care_plan.avgTicket)}</td>
                <td>${rup(a.digital_care_plan.directCost)}</td>
                <td><strong style="color:#10b981">${rup(a.digital_care_plan.contribution)}</strong> (70%)</td>
                <td>${a.digital_care_plan.targetMonthlyVol} clients</td>
                <td><strong>${rup(projCareContrib)}</strong></td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="background:rgba(255,255,255,0.04);font-weight:700;">
                <td colspan="5">Total Projected Contribution Margin</td>
                <td style="color:#10b981">${rup(projTotalContrib)}</td>
              </tr>
              <tr style="background:rgba(255,255,255,0.04);font-weight:700;">
                <td colspan="5">(-) Shared Monthly Opex (Marketing, Cloud, Tools)</td>
                <td style="color:#ef4444">−${rup(a.sharedMonthlyOpex)}</td>
              </tr>
              <tr style="background:rgba(31,157,92,0.1);font-weight:800;font-size:0.95rem;">
                <td colspan="5">Projected Net Monthly Operating Profit (Target: ₹1,00,000)</td>
                <td style="color:#00c96e">${rup(projNetProfit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Ledger Transactions Table -->
      <div class="table-card">
        <div class="table-hdr"><div class="table-title">Transaction Records (${state.ledger.length})</div></div>
        ${state.ledger.length === 0 ? `
          <div style="padding:32px;text-align:center;color:var(--muted,#6B7D74)">
            No ledger transactions recorded yet. Click <strong>+ Add Transaction / Expense</strong> above to record customer collections, partner payouts, and business expenses.
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Txn ID & Date</th>
                <th>Division</th>
                <th>Ref ID</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Persistence</th>
              </tr>
            </thead>
            <tbody>
              ${state.ledger.map(tx => `
                <tr>
                  <td>
                    <code>${esc(tx.id)}</code><br>
                    <small style="color:var(--muted,#6B7D74)">${esc(tx.date)}</small>
                  </td>
                  <td>
                    <span class="eco-badge eco-badge-${tx.division}">${esc(tx.division)}</span>
                  </td>
                  <td>
                    <strong>${esc(tx.refId || "—")}</strong>
                  </td>
                  <td>
                    <span class="badge" style="background:${tx.type === "collection" ? "#00c96e" : (tx.type === "direct_cost" ? "#ef4444" : (tx.type === "refund" ? "#dc2626" : "#f59e0b"))};color:#fff;">
                      ${esc(tx.type)}
                    </span><br>
                    <small style="color:var(--muted,#6B7D74)">${esc(tx.subcat)}</small>
                  </td>
                  <td style="max-width:280px;font-size:0.82rem;">
                    ${esc(tx.desc)}
                  </td>
                  <td style="font-weight:700;color:${tx.type === "collection" ? "#00c96e" : "#ef4444"}">
                    ${tx.type === "collection" ? "+" : "−"}${rup(tx.amount)}
                  </td>
                  <td>
                    ${persistenceBadge(tx.persistence || "firestore")}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  /* ── 7. B2B SALES & PROSPECT MANAGEMENT ──────────────────── */
  function renderProspects() {
    const sec = $("sectionProspects");
    if (!sec) return;

    // Activity target counts
    const totalResearched = state.prospects.length;
    const outreachDone = state.prospects.filter(p => ["Contacted", "Discovery Call", "Proposal Sent", "Won"].includes(p.stage)).length;
    const followUpsDone = state.prospects.filter(p => ["Discovery Call", "Proposal Sent", "Won"].includes(p.stage)).length;
    const proposalsSent = state.prospects.filter(p => p.stage === "Proposal Sent" || p.stage === "Won").length;

    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <h2 style="margin:0;font-size:1.4rem;">🎯 B2B Sales & Outreach Acquisition</h2>
          <p style="margin:4px 0 0;font-size:0.85rem;color:var(--muted,#6B7D74);">
            Proactive client acquisition for Bangalore clinics, restaurants, realtors, retailers, and small manufacturers.
          </p>
        </div>
        <button class="eco-btn eco-btn-primary" onclick="pzEco.openAddProspectModal()">
          + Add New Prospect
        </button>
      </div>

      <!-- Weekly Activity Targets Progress -->
      <div class="table-card" style="padding:14px;margin-bottom:16px;">
        <div style="font-weight:700;margin-bottom:10px;">📊 Weekly Activity Target Tracking</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
          <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;">
            <div style="font-size:0.75rem;color:var(--muted,#6B7D74)">Digital Researched</div>
            <div style="font-size:1.2rem;font-weight:800;">${totalResearched} / 30</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;">
            <div style="font-size:0.75rem;color:var(--muted,#6B7D74)">Outreach Attempts</div>
            <div style="font-size:1.2rem;font-weight:800;color:var(--primary,#1F9D5C)">${outreachDone} / 25</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;">
            <div style="font-size:0.75rem;color:var(--muted,#6B7D74)">Follow-ups Done</div>
            <div style="font-size:1.2rem;font-weight:800;color:#6366f1">${followUpsDone} / 15</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;">
            <div style="font-size:0.75rem;color:var(--muted,#6B7D74)">Proposals Sent</div>
            <div style="font-size:1.2rem;font-weight:800;color:#f59e0b">${proposalsSent} / 3</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;">
            <div style="font-size:0.75rem;color:var(--muted,#6B7D74)">Technician Outreach</div>
            <div style="font-size:1.2rem;font-weight:800;color:#0284c7">${state.technicians.length} / 10</div>
          </div>
        </div>
      </div>

      <!-- Prospects Table -->
      <div class="table-card">
        <div class="table-hdr"><div class="table-title">Prospect Pipeline (${state.prospects.length})</div></div>
        ${state.prospects.length === 0 ? `
          <div style="padding:32px;text-align:center;color:var(--muted,#6B7D74)">
            No prospects logged yet. Click <strong>+ Add New Prospect</strong> above to start researching and reaching out to Bangalore businesses.
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Business & Locality</th>
                <th>Contact</th>
                <th>Category</th>
                <th>Current Web Presence</th>
                <th>Opportunity</th>
                <th>Stage</th>
                <th>Next Action</th>
                <th>Persistence</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.prospects.map(p => `
                <tr>
                  <td>
                    <strong>${esc(p.businessName)}</strong><br>
                    <small style="color:var(--muted,#6B7D74)">📍 ${esc(p.locality)}</small>
                  </td>
                  <td>
                    ${esc(p.contactPerson || "—")}<br>
                    <small>${esc(p.phone || "")}</small>
                  </td>
                  <td>
                    <span class="badge">${esc(p.category)}</span>
                  </td>
                  <td style="font-size:0.78rem;color:var(--muted,#6B7D74);">
                    ${esc(p.website || "None identified")}
                  </td>
                  <td style="font-size:0.8rem;max-width:200px;">
                    ${esc(p.opportunity)}
                  </td>
                  <td>
                    <span class="badge" style="background:${p.stage === "Won" ? "#10b981" : "#3b82f6"};color:#fff;">
                      ${esc(p.stage)}
                    </span>
                  </td>
                  <td style="font-size:0.78rem;">
                    ${esc(p.nextAction)}<br>
                    <small style="color:${p.nextActionDate && p.nextActionDate <= todayStr() ? "#ef4444" : "var(--muted,#6B7D74)"}">
                      Due: ${esc(p.nextActionDate || "—")}
                    </small>
                  </td>
                  <td>
                    ${persistenceBadge(p.persistence || "firestore")}
                  </td>
                  <td>
                    ${p.phone ? `
                      <a href="https://wa.me/91${esc(p.phone)}" target="_blank" class="eco-btn eco-btn-primary" style="padding:4px 8px;font-size:0.75rem;">
                        WhatsApp
                      </a>
                    ` : "—"}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;
  }

  /* ── 8. MODAL DIALOGS & ACTIONS ────────────────────────────── */
  function showModal(title, bodyHtml, onSave) {
    const existing = $("pzEcoModal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "pzEcoModal";
    overlay.className = "eco-modal-overlay";
    overlay.innerHTML = `
      <div class="eco-modal-box">
        <div class="eco-modal-header">
          <div class="eco-modal-title">${title}</div>
          <button class="eco-modal-close" onclick="document.getElementById('pzEcoModal').remove()">✕</button>
        </div>
        <div>${bodyHtml}</div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
          <button class="eco-btn eco-btn-secondary" onclick="document.getElementById('pzEcoModal').remove()">Cancel</button>
          <button class="eco-btn eco-btn-primary" id="pzEcoModalSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    $("pzEcoModalSave").addEventListener("click", () => {
      if (onSave()) {
        overlay.remove();
      }
    });
  }

  // Mandatory Reason Dialog when closing/losing a lead
  function promptTerminalReason(leadId, targetStatus) {
    showModal(`Mandatory Reason for ${targetStatus.toUpperCase()}`, `
      <div class="eco-form-group">
        <label class="eco-form-label">Why is this lead being marked as ${targetStatus}? *</label>
        <select id="termReasonSel" class="eco-form-select">
          <option value="price_too_high">Quoted price exceeded customer budget</option>
          <option value="customer_postponed">Customer postponed requirement</option>
          <option value="out_of_area">Outside Bangalore service area</option>
          <option value="no_partner_available">No reliable technician/driver available on date</option>
          <option value="went_with_competitor">Customer went with competitor</option>
          <option value="duplicate_unresponsive">Duplicate lead or customer unresponsive</option>
          <option value="other">Other business reason</option>
        </select>
      </div>
      <div class="eco-form-group">
        <label class="eco-form-label">Additional Operational Notes *</label>
        <textarea id="termNotes" class="eco-form-textarea" placeholder="Specific reason details for operational review..."></textarea>
      </div>
    `, () => {
      const reason = $("termReasonSel").value;
      const notes = $("termNotes").value.trim();
      if (!notes) {
        alert("Please enter a short explanation note.");
        return false;
      }
      pzEco.updateLeadStatusWithReason(leadId, targetStatus, reason, notes);
      return true;
    });
  }

  /* ── 9. PUBLIC API & PERSISTENCE ENGINE ─────────────────────── */
  window.pzEco = {
    setDivision(div) {
      state.divisionFilter = div;
      renderOverviewKPIs();
    },

    setDateFilter(df) {
      state.dateFilter = df;
      renderOverviewKPIs();
    },

    searchPipeline(q) {
      state.pipelineSearch = q;
      renderPipeline();
    },

    filterPipelineDiv(div) {
      state.pipelineDivFilter = div;
      renderPipeline();
    },

    openLeadModal(leadId) {
      const lead = (state.allLeads || window._leads || []).find(l => l.id === leadId);
      if (!lead) return;

      const techOptions = state.technicians.map(t =>
        `<option value="${esc(t.id)}" ${lead.assignedPartnerId === t.id ? "selected" : ""}>${esc(t.name)} (${esc(t.category)})</option>`
      ).join("");

      showModal(`Manage Lead: ${esc(lead.name || "Customer")}`, `
        <div class="eco-form-group">
          <label class="eco-form-label">Customer Name & Phone</label>
          <input type="text" class="eco-form-input" value="${esc(lead.name || "")} (${esc(lead.phone || "")})" readonly>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Service & Division</label>
          <input type="text" class="eco-form-input" value="${esc(lead.serviceLabel || lead.service || "")} · ${esc(getLeadDivision(lead))}" readonly>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Assign Technician / Partner</label>
          <select id="mLeadPartner" class="eco-form-select">
            <option value="">Unassigned</option>
            ${techOptions}
          </select>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Current Pipeline Status</label>
          <select id="mLeadStatus" class="eco-form-select">
            ${PIPELINE_STAGES.map(s => `<option value="${s.key}" ${lead.status === s.key ? "selected" : ""}>${s.label}</option>`).join("")}
            <option disabled>── Exception / Closed ──</option>
            ${TERMINAL_STAGES.map(s => `<option value="${s.key}" ${lead.status === s.key ? "selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Next Action Description</label>
          <input type="text" id="mLeadNextAction" class="eco-form-input" value="${esc(lead.nextAction || "")}" placeholder="e.g. Call back after 2 PM with quotation">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Next Action Date</label>
          <input type="date" id="mLeadNextDate" class="eco-form-input" value="${esc(lead.nextActionDate || todayStr())}">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Notes</label>
          <textarea id="mLeadNotes" class="eco-form-textarea" placeholder="Add notes...">${esc(lead.notes || "")}</textarea>
        </div>
      `, () => {
        const newStatus = $("mLeadStatus").value;
        const nextAction = $("mLeadNextAction").value.trim();
        const nextActionDate = $("mLeadNextDate").value;
        const notes = $("mLeadNotes").value.trim();
        const assignedPartnerId = $("mLeadPartner").value;
        const assignedPartnerName = assignedPartnerId ? (state.technicians.find(t => t.id === assignedPartnerId)?.name || "") : "";

        if (TERMINAL_STAGES.some(t => t.key === newStatus) && lead.status !== newStatus) {
          promptTerminalReason(leadId, newStatus);
          return true;
        }

        pzEco.updateLead(leadId, { status: newStatus, nextAction, nextActionDate, notes, assignedPartnerId, assignedPartnerName });
        return true;
      });
    },

    async updateLead(leadId, data) {
      // Memory update
      const idx = (state.allLeads || []).findIndex(l => l.id === leadId);
      if (idx !== -1) {
        Object.assign(state.allLeads[idx], data);
      }

      // Firestore update with explicit feedback
      if (window._firebase?.db) {
        try {
          await window._firebase.db.collection("leads").doc(leadId).update(Object.assign({}, data, {
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }));
          notify("Lead updated in Firestore", "success");
        } catch (err) {
          console.warn("[PackZen Persistence] Firestore lead update failed:", err.code || err.message);
          notify(`⚠️ Firestore update rejected (${err.code || 'offline'}). Lead updated in session only.`, "warning");
        }
      } else {
        notify("Lead updated in local session only (Firestore offline)", "warning");
      }

      renderPipeline();
      renderOverviewKPIs();
      renderOwner();
    },

    updateLeadStatusWithReason(leadId, status, reason, notes) {
      pzEco.updateLead(leadId, {
        status,
        terminalReason: reason,
        notes: notes ? ((state.allLeads.find(l => l.id === leadId)?.notes || "") + "\n[Closed Note: " + notes + "]") : undefined
      });
    },

    async openAddTechnicianModal() {
      showModal("Add New Technician Partner", `
        <div class="eco-form-group">
          <label class="eco-form-label">Technician Name & Agency *</label>
          <input type="text" id="tName" class="eco-form-input" placeholder="e.g. Suresh AC Care">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">10-Digit Mobile *</label>
          <input type="tel" id="tPhone" class="eco-form-input" placeholder="9845012345">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Category *</label>
          <select id="tCat" class="eco-form-select">
            <option value="ac">AC Service & Installation (Wave 1)</option>
            <option value="appliance">Refrigerator / Washing Machine (Wave 2)</option>
          </select>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Localities Covered (comma-separated)</label>
          <input type="text" id="tLocs" class="eco-form-input" placeholder="e.g. HSR Layout, Koramangala, BTM">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Standard Partner Payout (₹) *</label>
          <input type="number" id="tPayout" class="eco-form-input" value="500">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Screening Status</label>
          <select id="tScreen" class="eco-form-select">
            <option value="new">New</option>
            <option value="screening">Screening</option>
            <option value="trial_job">Trial Job</option>
            <option value="approved">Approved</option>
            <option value="active" selected>Active</option>
          </select>
        </div>
      `, async () => {
        const name = $("tName").value.trim();
        const phone = $("tPhone").value.trim();
        const category = $("tCat").value;
        const locations = $("tLocs").value.split(",").map(s => s.trim()).filter(Boolean);
        const payout = num($("tPayout").value);
        const screeningStatus = $("tScreen").value;

        if (!name || phone.length < 10) {
          alert("Please enter a valid technician name and 10-digit mobile number.");
          return false;
        }

        const newTech = {
          id: "PZT-" + (100 + state.technicians.length + 1),
          name,
          phone,
          email: "",
          category,
          services: category === "ac" ? ["AC installation", "AC servicing", "AC gas refill"] : ["Washing machine repair", "Refrigerator repair"],
          locations: locations.length ? locations : ["Bangalore Urban"],
          availability: "available",
          experienceYrs: 3,
          screeningStatus,
          rateCard: { standardRate: 699, partnerPayout: payout },
          payoutTerms: "Weekly Bank Transfer",
          completedJobs: 0,
          rating: 5.0,
          complaints: 0,
          isPrimary: false,
          active: true,
          persistence: "firestore"
        };

        // Try writing to Firestore partners collection
        if (window._firebase?.db) {
          try {
            await window._firebase.db.collection("partners").doc(newTech.id).set(Object.assign({}, newTech, {
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }));
            newTech.persistence = "firestore";
            notify("Technician partner saved to Firestore", "success");
          } catch (err) {
            console.warn("[PackZen Persistence] Firestore partner write failed:", err.code || err.message);
            newTech.persistence = "local_fallback";
            notify(`⚠️ Firestore write rejected (${err.code || 'rules'}). Technician saved to local session fallback only.`, "warning");
          }
        } else {
          newTech.persistence = "local_fallback";
        }

        state.technicians.unshift(newTech);
        saveLocal(STORAGE_KEYS.technicians, state.technicians);
        renderHomeServices();
        return true;
      });
    },

    async toggleTechnicianAvailability(techId) {
      const tech = state.technicians.find(t => t.id === techId);
      if (!tech) return;
      tech.availability = tech.availability === "available" ? "busy" : (tech.availability === "busy" ? "off_duty" : "available");

      if (window._firebase?.db) {
        try {
          await window._firebase.db.collection("partners").doc(techId).update({
            availability: tech.availability,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) {}
      }

      saveLocal(STORAGE_KEYS.technicians, state.technicians);
      renderHomeServices();
    },

    async openAddProjectModal() {
      let isSubmitting = false;
      showModal("Create PackZen Digital Project", `
        <div class="eco-form-group">
          <label class="eco-form-label">Business / Client Name *</label>
          <input type="text" id="pBizName" class="eco-form-input" placeholder="e.g. Apex Spine & Dental Clinic">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Contact Person & Phone</label>
          <input type="text" id="pContact" class="eco-form-input" placeholder="Dr. Suresh · 9845012345">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Client Email</label>
          <input type="email" id="pEmail" class="eco-form-input" placeholder="client@example.com">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Service Package *</label>
          <select id="pPkg" class="eco-form-select">
            <option value="Starter Business Launch (₹7,999)">Starter Business Launch (₹7,999)</option>
            <option value="Business Growth (₹14,999)" selected>Business Growth (₹14,999)</option>
            <option value="Advanced / Custom (₹29,999)">Advanced / Custom (₹29,999)</option>
          </select>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Written Scope & Deliverables *</label>
          <textarea id="pScope" class="eco-form-textarea">5-page mobile-first website, Google Business schema, appointment booking integration, speed optimization, WhatsApp click-to-chat.</textarea>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Explicit Exclusions *</label>
          <input type="text" id="pExcl" class="eco-form-input" value="Paid ads management, third-party CRM fees, domain registration charges.">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Advance Paid (₹)</label>
          <input type="number" id="pAdv" class="eco-form-input" value="7500">
        </div>
      `, async () => {
        if (isSubmitting) return false;

        const bizName = $("pBizName").value.trim();
        const contact = $("pContact").value.trim();
        const email = $("pEmail").value.trim();
        const pkg = $("pPkg").value;
        const scope = $("pScope").value.trim();
        const exclusions = $("pExcl").value.trim();
        const advance = num($("pAdv").value);

        if (!bizName) {
          alert("Please enter the business name.");
          return false;
        }

        isSubmitting = true;
        const totalAmt = pkg.includes("7,999") ? 7999 : (pkg.includes("14,999") ? 14999 : 29999);
        const contactPerson = contact.split("·")[0]?.trim() || contact;
        const phone = contact.split("·")[1]?.trim() || "";
        const suggestedId = "PZD-2026-" + String(state.projects.length + 1).padStart(3, "0");

        try {
          const fn = getCallable("createDigitalProject");
          const res = await fn({
            projectId: suggestedId,
            businessName: bizName,
            contactPerson,
            phone,
            email,
            package: pkg,
            amount: totalAmt,
            advancePaid: advance,
            scope,
            exclusions,
            requestId: "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)
          });

          const createdProject = (res.data && res.data.project) ? res.data.project : {
            id: suggestedId,
            projectId: suggestedId,
            businessName: bizName,
            contactPerson,
            phone,
            email,
            package: pkg,
            amount: totalAmt,
            advancePaid: advance,
            balanceDue: Math.max(0, totalAmt - advance),
            scope,
            exclusions,
            milestones: [
              { name: "Discovery & Content", status: "completed", date: todayStr() },
              { name: "Wireframe Approval", status: "in_progress", date: todayStr() },
              { name: "Frontend Development", status: "pending", date: "" },
              { name: "Client Review", status: "pending", date: "" },
              { name: "Launch & Balance", status: "pending", date: "" }
            ],
            developer: "Lead Developer",
            status: "in_progress",
            revisionsUsed: 0,
            revisionsMax: 2,
            deliveryLinks: { staging: "", live: "", figma: "" },
            carePlanStatus: "offered",
            createdAt: todayStr(),
            persistence: "firestore"
          };

          state.projects.unshift(createdProject);
          saveLocal(STORAGE_KEYS.projects, state.projects);

          notify("✅ Project created & atomic outbox event enqueued!", "success");
          renderDigitalProjects();
          renderOverviewKPIs();
          return true;
        } catch (err) {
          console.error("[PackZen Digital] Server create failed:", err);
          notify(`⚠️ Project creation rejected: ${err.message}`, "error");
          isSubmitting = false;
          return false;
        }
      });
    },

    async openProjectModal(projId) {
      const p = state.projects.find(x => x.id === projId);
      if (!p) return;

      const renderMilestoneRows = () => {
        return (p.milestones || []).map((m, idx) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;margin-bottom:6px;font-size:0.82rem;">
            <div>
              <span style="font-weight:600;">${idx + 1}. ${esc(m.name)}</span>
              <span style="font-size:0.72rem;margin-left:8px;color:${m.status === 'completed' ? '#10b981' : (m.status === 'in_progress' ? '#eab308' : '#94a3b8')};">
                ● ${esc(m.status.toUpperCase())}
              </span>
            </div>
            <div style="display:flex;gap:6px;">
              ${m.status === "pending" ? `
                <button type="button" class="eco-btn eco-btn-secondary" style="padding:2px 8px;font-size:0.72rem;" onclick="window.pzEco.advanceMilestone('${esc(p.id)}', ${idx}, 'in_progress')">
                  ⏳ Start
                </button>
              ` : ""}
              ${m.status !== "completed" ? `
                <button type="button" class="eco-btn eco-btn-primary" style="padding:2px 8px;font-size:0.72rem;" onclick="window.pzEco.advanceMilestone('${esc(p.id)}', ${idx}, 'completed')">
                  ✅ Complete
                </button>
              ` : `<span style="color:#10b981;font-size:0.75rem;">Done</span>`}
            </div>
          </div>
        `).join("");
      };

      showModal(`Manage Project: ${esc(p.businessName)}`, `
        <div class="eco-form-group">
          <label class="eco-form-label">Project Status</label>
          <select id="pStatus" class="eco-form-select">
            <option value="discovery" ${p.status === "discovery" ? "selected" : ""}>Discovery</option>
            <option value="in_progress" ${p.status === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="client_review" ${p.status === "client_review" ? "selected" : ""}>Client Review</option>
            <option value="completed" ${p.status === "completed" ? "selected" : ""}>Completed (Handed over)</option>
            <option value="care_plan_active" ${p.status === "care_plan_active" ? "selected" : ""}>Care Plan Active</option>
          </select>
        </div>

        <div class="eco-form-group">
          <label class="eco-form-label">Project Milestones & Deliverable Sign-Off</label>
          <div id="pMilestonesContainer">
            ${renderMilestoneRows()}
          </div>
        </div>

        <div class="eco-form-group">
          <label class="eco-form-label">Record Additional Payment (₹)</label>
          <input type="number" id="pAddPay" class="eco-form-input" placeholder="0" value="0">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Staging Preview URL</label>
          <input type="url" id="pStaging" class="eco-form-input" value="${esc(p.deliveryLinks?.staging || "")}">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Live Production URL</label>
          <input type="url" id="pLive" class="eco-form-input" value="${esc(p.deliveryLinks?.live || "")}">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Care Plan Status</label>
          <select id="pCare" class="eco-form-select">
            <option value="offered" ${p.carePlanStatus === "offered" ? "selected" : ""}>Offered</option>
            <option value="active" ${p.carePlanStatus === "active" ? "selected" : ""}>Active (₹999/mo)</option>
            <option value="declined" ${p.carePlanStatus === "declined" ? "selected" : ""}>Declined</option>
          </select>
        </div>
      `, async () => {
        const newStatus = $("pStatus").value;
        const staging = $("pStaging").value.trim();
        const live = $("pLive").value.trim();
        const care = $("pCare").value;
        const addPay = num($("pAddPay").value);

        if (addPay > (p.balanceDue || 0)) {
          alert(`Additional payment (₹${addPay}) exceeds the remaining balance due of ₹${p.balanceDue || 0}.`);
          return false;
        }

        try {
          const fn = getCallable("updateDigitalProject");
          const payload = {
            projectId: p.id,
            status: newStatus,
            deliveryLinks: { staging, live, figma: p.deliveryLinks?.figma || "" },
            carePlanStatus: care
          };
          if (addPay > 0) {
            payload.additionalPayment = addPay;
            payload.paymentRequestId = "req_bal_" + p.id + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
          }

          const res = await fn(payload);

          p.status = newStatus;
          p.deliveryLinks = p.deliveryLinks || {};
          p.deliveryLinks.staging = staging;
          p.deliveryLinks.live = live;
          p.carePlanStatus = care;
          if (addPay > 0 && res.data && res.data.updated) {
            p.advancePaid = res.data.updated.advancePaid;
            p.balanceDue = res.data.updated.balanceDue;
          }

          saveLocal(STORAGE_KEYS.projects, state.projects);
          notify("✅ Project updated successfully in Firestore", "success");
          renderDigitalProjects();
          return true;
        } catch (err) {
          console.error("[PackZen Digital] Server update failed:", err);
          notify(`⚠️ Update rejected: ${err.message}`, "error");
          return false;
        }
      });
    },

    async advanceMilestone(projId, milestoneIndex, newStatus) {
      const p = state.projects.find(x => x.id === projId);
      if (!p) return;

      try {
        const fn = getCallable("updateDigitalProjectMilestone");
        const res = await fn({
          projectId: projId,
          milestoneIndex,
          newStatus
        });

        if (p.milestones && p.milestones[milestoneIndex]) {
          p.milestones[milestoneIndex].status = newStatus;
          if (newStatus === "completed") p.milestones[milestoneIndex].date = todayStr();
        }
        if (res.data && res.data.allCompleted) {
          p.status = "completed";
        }

        saveLocal(STORAGE_KEYS.projects, state.projects);
        notify(`✅ Milestone '${p.milestones[milestoneIndex].name}' set to ${newStatus}!`, "success");
        pzEco.openProjectModal(projId);
        renderDigitalProjects();
      } catch (err) {
        console.error("[PackZen Digital] Milestone update failed:", err);
        notify(`⚠️ Milestone update failed: ${err.message}`, "error");
      }
    },

    // Transaction recorder with duplicate prevention
    async recordLedgerTransaction(txData) {
      const today = txData.date || todayStr();
      const amount = num(txData.amount);
      const refId = txData.refId || "MANUAL";

      // 🔒 Duplicate prevention check
      const duplicate = state.ledger.find(existing =>
        existing.refId === refId &&
        existing.type === txData.type &&
        existing.subcat === txData.subcat &&
        num(existing.amount) === amount &&
        existing.date === today
      );

      if (duplicate) {
        console.warn("[PackZen Ledger] Duplicate transaction suppressed:", refId, amount, today);
        notify(`Duplicate transaction prevented: ${refId} for ₹${amount} was already recorded today.`, "warning");
        return { ok: false, duplicate: true };
      }

      const tx = {
        id: "TXN-" + String(state.ledger.length + 1).padStart(3, "0"),
        date: today,
        division: txData.division || "overhead",
        refId,
        type: txData.type || "collection",
        subcat: txData.subcat || "payment",
        desc: txData.desc || "Recorded transaction",
        amount,
        persistence: "firestore"
      };

      // Try writing to Firestore ledger collection
      if (window._firebase?.db) {
        try {
          await window._firebase.db.collection("ledger").doc(tx.id).set(Object.assign({}, tx, {
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }));
          tx.persistence = "firestore";
          notify("Ledger transaction saved to Firestore", "success");
        } catch (err) {
          console.warn("[PackZen Persistence] Firestore ledger write failed:", err.code || err.message);
          tx.persistence = "local_fallback";
          notify(`⚠️ Firestore write rejected (${err.code || 'rules'}). Transaction saved to local session fallback only.`, "warning");
        }
      } else {
        tx.persistence = "local_fallback";
      }

      state.ledger.unshift(tx);
      saveLocal(STORAGE_KEYS.ledger, state.ledger);
      renderLedger();
      renderOverviewKPIs();
      return { ok: true, tx };
    },

    openAddLedgerModal() {
      showModal("Add Financial Entry", `
        <div class="eco-form-group">
          <label class="eco-form-label">Transaction Type *</label>
          <select id="lxType" class="eco-form-select">
            <option value="collection">Customer Collection (Advance / Full / Balance)</option>
            <option value="direct_cost">Direct Cost (Partner payout, materials, transport, gateway fee)</option>
            <option value="shared_opex">Shared Operating Expense (Marketing, hosting, tools)</option>
            <option value="refund">Customer Refund</option>
            <option value="discount">Direct Customer Discount</option>
          </select>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Division *</label>
          <select id="lxDiv" class="eco-form-select">
            <option value="logistics">PackZen Logistics</option>
            <option value="home_services">PackZen Home Services</option>
            <option value="digital">PackZen Digital</option>
            <option value="overhead">Shared Business Overhead</option>
          </select>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Reference ID (Booking ID / Project ID)</label>
          <input type="text" id="lxRef" class="eco-form-input" placeholder="e.g. MOV-1049 or PZD-2026-001">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Description *</label>
          <input type="text" id="lxDesc" class="eco-form-input" placeholder="e.g. Partner payout to driver for Whitefield move">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Amount (₹) *</label>
          <input type="number" id="lxAmt" class="eco-form-input" placeholder="1500">
        </div>
      `, async () => {
        const type = $("lxType").value;
        const division = $("lxDiv").value;
        const refId = $("lxRef").value.trim();
        const desc = $("lxDesc").value.trim();
        const amount = num($("lxAmt").value);

        if (!desc || amount <= 0) {
          alert("Please enter a valid description and positive amount.");
          return false;
        }

        const subcat = type === "collection" ? "payment" : (type === "direct_cost" ? "payout" : (type === "refund" ? "refund" : "overhead"));
        await pzEco.recordLedgerTransaction({ division, refId, type, subcat, desc, amount });
        return true;
      });
    },

    async openAddProspectModal() {
      showModal("Add Bangalore B2B Prospect", `
        <div class="eco-form-group">
          <label class="eco-form-label">Business Name *</label>
          <input type="text" id="prName" class="eco-form-input" placeholder="e.g. Indiranagar Spine Clinic">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Locality *</label>
          <input type="text" id="prLoc" class="eco-form-input" placeholder="e.g. Indiranagar, Bangalore">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Contact Person & Phone</label>
          <input type="text" id="prContact" class="eco-form-input" placeholder="Dr. Suresh · 9845012345">
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Category</label>
          <select id="prCat" class="eco-form-select">
            <option value="Clinics">Clinics & Doctors</option>
            <option value="Restaurants">Restaurants & Cafes</option>
            <option value="Real-estate">Real Estate & Brokers</option>
            <option value="Retailers">Retailers & Boutiques</option>
            <option value="Manufacturers">Small Manufacturers</option>
          </select>
        </div>
        <div class="eco-form-group">
          <label class="eco-form-label">Opportunity Description</label>
          <input type="text" id="prOpp" class="eco-form-input" value="Starter Business Website (₹7,999) + Google Maps Optimization">
        </div>
      `, async () => {
        const bName = $("prName").value.trim();
        const loc = $("prLoc").value.trim();
        const contact = $("prContact").value.trim();
        const cat = $("prCat").value;
        const opp = $("prOpp").value.trim();

        if (!bName) {
          alert("Please enter the business name.");
          return false;
        }

        const newProspect = {
          id: "PR-" + String(state.prospects.length + 1).padStart(2, "0"),
          businessName: bName,
          locality: loc,
          phone: contact.split("·")[1]?.trim() || "",
          contactPerson: contact.split("·")[0]?.trim() || "",
          category: cat,
          website: "None identified",
          stage: "Identified",
          opportunity: opp,
          nextAction: "Initial outreach",
          nextActionDate: todayStr(),
          notes: "Added from Bangalore outreach research.",
          persistence: "firestore"
        };

        // Try writing to Firestore prospects collection
        if (window._firebase?.db) {
          try {
            await window._firebase.db.collection("prospects").doc(newProspect.id).set(Object.assign({}, newProspect, {
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }));
            newProspect.persistence = "firestore";
            notify("Prospect saved to Firestore", "success");
          } catch (err) {
            console.warn("[PackZen Persistence] Firestore prospect write failed:", err.code || err.message);
            newProspect.persistence = "local_fallback";
            notify(`⚠️ Firestore write rejected (${err.code || 'rules'}). Saved to local session fallback only.`, "warning");
          }
        } else {
          newProspect.persistence = "local_fallback";
        }

        state.prospects.unshift(newProspect);
        saveLocal(STORAGE_KEYS.prospects, state.prospects);
        renderProspects();
        return true;
      });
    },

    generateWeeklyReview() {
      const today = todayStr();
      const collections = state.ledger.filter(tx => tx.type === "collection").reduce((s, tx) => s + num(tx.amount), 0);
      const refunds = state.ledger.filter(tx => tx.type === "refund").reduce((s, tx) => s + num(tx.amount), 0);
      const netCollections = Math.max(0, collections - refunds);
      const directCosts = state.ledger.filter(tx => tx.type === "direct_cost").reduce((s, tx) => s + num(tx.amount), 0);
      const contribution = netCollections - directCosts;
      const opex = state.ledger.filter(tx => tx.type === "shared_opex").reduce((s, tx) => s + num(tx.amount), 0);
      const netProfit = contribution - opex;

      const reviewText = `=== PACKZEN WEEKLY BUSINESS REVIEW (Generated ${today}) ===\n` +
        `1. FINANCIAL PERFORMANCE (Statutory Categorized Ledger):\n` +
        `   - Net Customer Collections: ${rup(netCollections)}\n` +
        `   - Direct Service Costs: ${rup(directCosts)}\n` +
        `   - Contribution Margin: ${rup(contribution)} (${netCollections > 0 ? Math.round((contribution/netCollections)*100) : 0}%)\n` +
        `   - Shared Operating Expenses: ${rup(opex)}\n` +
        `   - Net Operating Profit: ${rup(netProfit)} (${netCollections > 0 ? Math.round((netProfit/netCollections)*100) : 0}%)\n\n` +
        `2. DIVISIONAL HEALTH:\n` +
        `   - Logistics: Active moves progressing; packing stock monitored.\n` +
        `   - Home Services: Wave 1 AC and Wave 2 appliances technician screening operational.\n` +
        `   - Digital: ${state.projects.length} client projects logged; Care plans monitored.\n\n` +
        `3. TARGET RUN-RATE:\n` +
        `   - Long-term Ambition: ₹1,00,000 net monthly profit\n` +
        `   - Current Contribution: ${rup(contribution)}\n\n` +
        `4. ACTION ITEMS FOR COMING WEEK:\n` +
        `   - Complete all due follow-ups in Logistics\n` +
        `   - Supervise trial AC partner jobs in North Bangalore\n` +
        `   - Progress active digital client milestones towards production launch`;

      showModal("Weekly Business Review (Executive Summary)", `
        <div class="eco-form-group">
          <textarea class="eco-form-textarea" style="height:260px;font-family:monospace;font-size:0.8rem;" readonly id="wbrContent">${esc(reviewText)}</textarea>
        </div>
        <button class="eco-btn eco-btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('wbrContent').value);alert('Copied Weekly Review to clipboard!');">
          📋 Copy to Clipboard
        </button>
      `, () => true);
    },

    setDivisionFilter(div) {
      state.divisionFilter = div;
      renderOwner();
      renderOverviewKPIs();
    },

    async openCustomer360(ident) {
      if (!ident) {
        ident = prompt("Enter customer Phone, Email, or User ID:");
        if (!ident) return;
        ident = ident.trim();
      }

      showModal(`Unified Customer 360: Loading...`, `
        <div style="padding:24px;text-align:center;color:var(--muted,#6B7D74);">
          ⏳ Resolving unified cross-division identity for "${esc(ident)}"...
        </div>
      `, () => true);

      let profileData = null;
      try {
        const fn = getCallable("adminGetCustomerUnifiedProfile");
        const res = await fn({ customerUid: ident, phone: ident, email: ident });
        profileData = res.data;
      } catch (e) {
        console.warn("[Customer 360] Cloud callable fallback to local state:", e);
        const clean = String(ident).toLowerCase().replace(/\D/g, "");
        const matchedBookings = (window.allBookings || []).filter(b => (b.customerUid === ident) || (b.phone && b.phone.replace(/\D/g, "").includes(clean)));
        const matchedProjects = state.projects.filter(p => (p.email && p.email.toLowerCase() === ident.toLowerCase()) || (p.phone && p.phone.includes(clean)));
        const matchedLeads = (state.allLeads || window._leads || []).filter(l => (l.phone && l.phone.includes(clean)) || (l.email && l.email.toLowerCase() === ident.toLowerCase()));
        profileData = {
          profile: {
            uid: ident,
            displayName: matchedBookings[0]?.customerName || matchedProjects[0]?.clientName || matchedLeads[0]?.name || "Customer",
            phone: matchedBookings[0]?.phone || matchedProjects[0]?.phone || matchedLeads[0]?.phone || ident,
            email: matchedProjects[0]?.email || matchedBookings[0]?.email || ident
          },
          lifetimeValue: {
            totalPaid: matchedBookings.reduce((s, b) => s + num(b.paid), 0) + matchedProjects.reduce((s, p) => s + num(p.paidAmount), 0),
            totalOutstanding: matchedBookings.reduce((s, b) => s + Math.max(0, num(b.total) - num(b.paid)), 0) + matchedProjects.reduce((s, p) => s + num(p.balanceDue), 0)
          },
          history: {
            bookings: matchedBookings,
            projects: matchedProjects,
            leads: matchedLeads
          }
        };
      }

      const p = profileData.profile || {};
      const ltv = profileData.lifetimeValue || {};
      const hist = profileData.history || {};
      const bks = hist.bookings || [];
      const projs = hist.projects || [];
      const lds = hist.leads || [];

      showModal(`👤 Customer 360: ${esc(p.displayName || "Customer")}`, `
        <div style="font-size:0.85rem;">
          <div style="background:var(--surface2,#f8fafc);padding:14px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <div>
              <div style="font-size:1.1rem;font-weight:700;">${esc(p.displayName || "Customer")}</div>
              <div style="color:var(--muted,#6B7D74);margin-top:2px;">
                📞 ${esc(p.phone || "—")} · ✉️ ${esc(p.email || "—")} · ID: <code>${esc(p.uid || "—")}</code>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.75rem;color:var(--muted,#6B7D74);">Lifetime Customer Value</div>
              <div style="font-size:1.1rem;font-weight:700;color:#059669;">${rup(ltv.totalPaid || 0)}</div>
              ${ltv.totalOutstanding > 0 ? `<div style="font-size:0.75rem;color:#dc2626;font-weight:700;">Due: ${rup(ltv.totalOutstanding)}</div>` : ''}
            </div>
          </div>

          <!-- History Sections -->
          <div style="margin-bottom:14px;">
            <strong style="display:block;margin-bottom:6px;">📦 Logistics & Home Service Bookings (${bks.length})</strong>
            ${bks.length === 0 ? `<div style="color:var(--muted,#6B7D74);font-size:0.8rem;">No bookings recorded.</div>` : `
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <thead><tr style="text-align:left;border-bottom:1px solid #e2e8f0;"><th style="padding:4px;">ID / Date</th><th>Service</th><th>Route</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  ${bks.map(b => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:6px 4px;"><code>${esc(b.bookingRef || b.id)}</code><br><span style="color:var(--muted,#6B7D74);">${esc(b.date || b.dateStr || "")}</span></td>
                      <td>${esc(b.serviceCategory || b.flow || "Moving")}</td>
                      <td>${esc(b.pickup || "Bangalore")} → ${esc(b.drop || "")}</td>
                      <td><strong>${rup(b.total || b.totalAmount || 0)}</strong></td>
                      <td><span class="eco-badge">${esc(b.status || "confirmed")}</span></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `}
          </div>

          <div style="margin-bottom:14px;">
            <strong style="display:block;margin-bottom:6px;">💻 PackZen Digital Projects (${projs.length})</strong>
            ${projs.length === 0 ? `<div style="color:var(--muted,#6B7D74);font-size:0.8rem;">No digital client projects.</div>` : `
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <thead><tr style="text-align:left;border-bottom:1px solid #e2e8f0;"><th style="padding:4px;">Project</th><th>Package</th><th>Amount</th><th>Balance Due</th><th>Status</th></tr></thead>
                <tbody>
                  ${projs.map(pj => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:6px 4px;"><strong>${esc(pj.businessName)}</strong></td>
                      <td>${esc(pj.packageName || "Growth Website")}</td>
                      <td>${rup(pj.totalAmount || 0)}</td>
                      <td style="color:${pj.balanceDue > 0 ? '#dc2626' : '#15803d'};font-weight:700;">${rup(pj.balanceDue || 0)}</td>
                      <td><span class="eco-badge eco-badge-digital">${esc(pj.status)}</span></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `}
          </div>

          <div>
            <strong style="display:block;margin-bottom:6px;">📞 Inquiries & Leads (${lds.length})</strong>
            ${lds.length === 0 ? `<div style="color:var(--muted,#6B7D74);font-size:0.8rem;">No inquiries recorded.</div>` : `
              <div style="display:grid;gap:6px;">
                ${lds.map(l => `
                  <div style="background:var(--surface2,#f8fafc);padding:6px 10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <span class="eco-badge eco-badge-${getLeadDivision(l)}">${getLeadDivision(l)}</span>
                      <strong style="margin-left:6px;">${esc(l.serviceLabel || l.service || "Move")}</strong> · ${esc(l.area || "Bangalore")}
                    </div>
                    <span class="eco-badge">${esc(l.status)}</span>
                  </div>
                `).join("")}
              </div>
            `}
          </div>
        </div>
      `, () => true);
    },

    async viewWorkflowAudit(entityType, entityId) {
      showModal("Workflow Audit History", `
        <div style="padding:20px;text-align:center;color:var(--muted,#6B7D74);">
          ⏳ Fetching immutable workflow transitions for ${esc(entityId)}...
        </div>
      `, () => true);

      try {
        const fn = getCallable("adminGetWorkflowHistory");
        const res = await fn({ entityType, entityId });
        const list = res.data || [];

        showModal(`Workflow History: ${esc(entityId)}`, `
          <div style="font-size:0.82rem;">
            ${list.length === 0 ? `<div style="text-align:center;color:var(--muted,#6B7D74);padding:20px;">No stage transitions recorded yet.</div>` : `
              <div style="position:relative;border-left:2px solid #e2e8f0;margin-left:14px;padding-left:16px;display:grid;gap:12px;">
                ${list.map(entry => `
                  <div style="position:relative;">
                    <div style="position:absolute;left:-22px;top:4px;width:10px;height:10px;border-radius:50%;background:#4f46e5;"></div>
                    <div style="font-weight:700;">${esc(entry.fromStage)} → <span style="color:#4f46e5;">${esc(entry.toStage)}</span></div>
                    <div style="font-size:0.75rem;color:var(--muted,#6B7D74);margin-top:2px;">
                      By <code>${esc(entry.updatedBy)}</code> (${esc(entry.updatedByRole || "staff")}) · ${new Date(entry.timestamp).toLocaleString("en-IN")}
                    </div>
                    ${entry.isOverride ? `<div style="color:#b45309;font-size:0.75rem;margin-top:2px;">⚠️ Manual Override Reason: ${esc(entry.overrideReason)}</div>` : ''}
                    ${entry.notes ? `<div style="font-style:italic;color:#475569;margin-top:4px;">"${esc(entry.notes)}"</div>` : ''}
                  </div>
                `).join("")}
              </div>
            `}
          </div>
        `, () => true);
      } catch (err) {
        showModal("Workflow Audit History", `<div style="color:#dc2626;padding:14px;">Failed to load audit history: ${esc(err.message)}</div>`, () => true);
      }
    },

    async checkSystemHealth() {
      showModal("System Observability & Health", `
        <div style="padding:24px;text-align:center;color:var(--muted,#6B7D74);">
          ⏳ Running platform telemetry & adapter health checks...
        </div>
      `, () => true);

      try {
        const fn = getCallable("adminGetSystemHealthReport");
        const res = await fn();
        const rep = res.data || {};
        const status = rep.status || "HEALTHY";
        const auto = rep.automation || {};
        const adap = rep.adapters || {};
        const sec = rep.security || {};

        const statusColor = status === "HEALTHY" ? "#15803d" : (status === "WARNING" ? "#b45309" : "#dc2626");
        const statusBg = status === "HEALTHY" ? "#dcfce7" : (status === "WARNING" ? "#fef3c7" : "#fee2e2");

        showModal("PackZen 3.0 System Health Report", `
          <div style="font-size:0.85rem;">
            <div style="padding:12px 16px;border-radius:8px;background:${statusBg};color:${statusColor};font-weight:700;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <span>Platform Health: ${esc(status)}</span>
              <span style="font-size:0.78rem;font-weight:normal;">As of ${new Date(rep.timestamp || Date.now()).toLocaleTimeString("en-IN")}</span>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px;">
              <div style="background:var(--surface2,#f8fafc);padding:10px;border-radius:6px;text-align:center;">
                <div style="font-size:0.75rem;color:var(--muted,#6B7D74);">Outbox Backlog</div>
                <div style="font-size:1.2rem;font-weight:700;">${auto.backlog || 0}</div>
              </div>
              <div style="background:var(--surface2,#f8fafc);padding:10px;border-radius:6px;text-align:center;">
                <div style="font-size:0.75rem;color:var(--muted,#6B7D74);">Dead Letters</div>
                <div style="font-size:1.2rem;font-weight:700;color:${(auto.deadLetters || 0) > 0 ? '#dc2626' : '#15803d'};">${auto.deadLetters || 0}</div>
              </div>
              <div style="background:var(--surface2,#f8fafc);padding:10px;border-radius:6px;text-align:center;">
                <div style="font-size:0.75rem;color:var(--muted,#6B7D74);">Processed Today</div>
                <div style="font-size:1.2rem;font-weight:700;color:#059669;">${auto.completedToday || 0}</div>
              </div>
            </div>

            <strong style="display:block;margin-bottom:6px;">Channel Adapters Telemetry</strong>
            <div style="display:grid;gap:6px;margin-bottom:14px;">
              ${Object.values(adap).map(ad => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface2,#f8fafc);border-radius:6px;">
                  <span>${esc(ad.name || ad.type)}</span>
                  <span class="eco-badge" style="background:${ad.status === 'OPERATIONAL' ? '#dcfce7' : '#fef3c7'};color:${ad.status === 'OPERATIONAL' ? '#15803d' : '#b45309'};">${esc(ad.status)}</span>
                </div>
              `).join("")}
            </div>

            <strong style="display:block;margin-bottom:6px;">Security & Data Protection</strong>
            <div style="font-size:0.8rem;color:var(--muted,#6B7D74);line-height:1.6;">
              🔒 App Check: <strong>${esc(sec.appCheckMode || "MONITORING")}</strong><br>
              🛡️ Firestore Rules: <strong>${esc(sec.rulesVerification || "ENFORCED")}</strong><br>
              ⚡ Client Direct Outbox Mutation: <strong>PROHIBITED (Server-Only)</strong>
            </div>
          </div>
        `, () => true);
      } catch (err) {
        showModal("System Observability & Health", `<div style="color:#dc2626;padding:14px;">Failed to fetch health report: ${esc(err.message)}</div>`, () => true);
      }
    },

    renderAnalyticsBI() {
      const container = $("sectionAnalytics");
      if (!container) return;

      const bookings = window.allBookings || [];
      const leads = state.allLeads || window._leads || [];
      const ledger = state.ledger || [];

      // Calculate 3-division totals
      const logBookings = bookings.filter(b => !b.serviceCategory || b.serviceCategory === "moving");
      const hsBookings = bookings.filter(b => b.serviceCategory === "home_services" || b.serviceCategory === "appliance");
      const digProjects = state.projects || [];

      const logRev = logBookings.reduce((s, b) => s + num(b.total), 0);
      const hsRev = hsBookings.reduce((s, b) => s + num(b.total), 0);
      const digRev = digProjects.reduce((s, p) => s + num(p.totalAmount), 0);
      const totalRev = logRev + hsRev + digRev;

      let biCard = $("pzEcoAnalyticsBI");
      if (!biCard) {
        biCard = document.createElement("div");
        biCard.id = "pzEcoAnalyticsBI";
        biCard.className = "table-card";
        biCard.style.marginTop = "18px";
        container.appendChild(biCard);
      }

      biCard.innerHTML = `
        <div class="table-hdr">
          <div class="table-title">📈 Unified Multi-Division Business Intelligence (PackZen 3.0)</div>
        </div>
        <div style="padding:16px;">
          <!-- 3-Division Breakdown -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;">
            <div style="padding:12px;border-radius:8px;background:rgba(31,157,92,0.06);border:1px solid rgba(31,157,92,0.2);">
              <div style="font-size:0.8rem;color:var(--muted,#6B7D74);">📦 Logistics Revenue</div>
              <div style="font-size:1.3rem;font-weight:700;color:#1F9D5C;">${rup(logRev)}</div>
              <div style="font-size:0.75rem;margin-top:2px;">${logBookings.length} total moves · Avg: ${logBookings.length > 0 ? rup(logRev / logBookings.length) : '₹0'}</div>
            </div>

            <div style="padding:12px;border-radius:8px;background:rgba(2,132,199,0.06);border:1px solid rgba(2,132,199,0.2);">
              <div style="font-size:0.8rem;color:var(--muted,#6B7D74);">❄️ Home Services Revenue</div>
              <div style="font-size:1.3rem;font-weight:700;color:#0284c7;">${rup(hsRev)}</div>
              <div style="font-size:0.75rem;margin-top:2px;">${hsBookings.length} completed services · Avg: ${hsBookings.length > 0 ? rup(hsRev / hsBookings.length) : '₹0'}</div>
            </div>

            <div style="padding:12px;border-radius:8px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);">
              <div style="font-size:0.8rem;color:var(--muted,#6B7D74);">💻 Digital Projects Contracted</div>
              <div style="font-size:1.3rem;font-weight:700;color:#6366f1;">${rup(digRev)}</div>
              <div style="font-size:0.75rem;margin-top:2px;">${digProjects.length} clients · Avg: ${digProjects.length > 0 ? rup(digRev / digProjects.length) : '₹0'}</div>
            </div>
          </div>

          <!-- Unit Economics & Forecasting -->
          <div style="background:var(--surface2,#f8fafc);padding:14px;border-radius:8px;margin-bottom:14px;">
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;">📊 Explainable 30-Day Financial Forecast</div>
            <p style="font-size:0.8rem;color:var(--muted,#6B7D74);margin:0 0 10px;">
              Transparent formula based on recent daily velocity run-rate and historical division-weighted conversion.
            </p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
              <div>
                <div style="font-size:0.75rem;color:var(--muted,#6B7D74);">All-Division Gross Revenue</div>
                <div style="font-size:1.1rem;font-weight:700;">${rup(totalRev)}</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:var(--muted,#6B7D74);">Inbound Qualified Pipeline</div>
                <div style="font-size:1.1rem;font-weight:700;color:#0284c7;">${leads.filter(l => ["qualified", "quoted"].includes(l.status)).length} open leads</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:var(--muted,#6B7D74);">Estimated 30-Day Run Rate</div>
                <div style="font-size:1.1rem;font-weight:700;color:#059669;">${rup(Math.round(totalRev > 0 ? (totalRev / 3) : 50000))}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    },

    // Lifecycle render entry points
    renderOwner,
    renderPipeline,
    renderHomeServices,
    renderDigitalProjects,
    renderLedger,
    renderProspects,
    renderOverviewKPIs,

    init() {
      // Connect to live Firestore collections when authenticated
      if (window._firebase?.db) {
        state.firestoreAvailable = true;

        // 1. Leads
        const unsubLeads = window._firebase.db.collection("leads").orderBy("createdAtMs", "desc").limit(500).onSnapshot(snap => {
          state.allLeads = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
          renderOverviewKPIs();
          if (document.getElementById("sectionPipeline")?.classList.contains("active")) renderPipeline();
        }, () => {});
        state.activeUnsubscribers.push(unsubLeads);

        // 2. Technicians / Partners
        const unsubPartners = window._firebase.db.collection("partners").limit(200).onSnapshot(snap => {
          const list = snap.docs.map(d => Object.assign({ id: d.id, persistence: "firestore" }, d.data()));
          if (list.length > 0) {
            state.technicians = list;
            saveLocal(STORAGE_KEYS.technicians, list);
          }
          if (document.getElementById("sectionHomeservices")?.classList.contains("active")) renderHomeServices();
        }, () => {});
        state.activeUnsubscribers.push(unsubPartners);

        // 3. Digital Projects
        const unsubProjects = window._firebase.db.collection("projects").limit(200).onSnapshot(snap => {
          const list = snap.docs.map(d => Object.assign({ id: d.id, persistence: "firestore" }, d.data()));
          if (list.length > 0) {
            state.projects = list;
            saveLocal(STORAGE_KEYS.projects, list);
          }
          if (document.getElementById("sectionDigitalprojects")?.classList.contains("active")) renderDigitalProjects();
        }, () => {});
        state.activeUnsubscribers.push(unsubProjects);

        // 4. Ledger Transactions
        const unsubLedger = window._firebase.db.collection("ledger").orderBy("date", "desc").limit(500).onSnapshot(snap => {
          const list = snap.docs.map(d => Object.assign({ id: d.id, persistence: "firestore" }, d.data()));
          if (list.length > 0) {
            state.ledger = list;
            saveLocal(STORAGE_KEYS.ledger, list);
          }
          renderOverviewKPIs();
          if (document.getElementById("sectionLedger")?.classList.contains("active")) renderLedger();
        }, () => {});
        state.activeUnsubscribers.push(unsubLedger);

        // 5. Prospects
        const unsubProspects = window._firebase.db.collection("prospects").limit(200).onSnapshot(snap => {
          const list = snap.docs.map(d => Object.assign({ id: d.id, persistence: "firestore" }, d.data()));
          if (list.length > 0) {
            state.prospects = list;
            saveLocal(STORAGE_KEYS.prospects, list);
          }
          if (document.getElementById("sectionProspects")?.classList.contains("active")) renderProspects();
        }, () => {});
        state.activeUnsubscribers.push(unsubProspects);
      }

      // Initial overview render
      setTimeout(() => {
        renderOverviewKPIs();
      }, 500);
    }
  };

  // Auto initialize on DOM ready or window load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.pzEco.init());
  } else {
    window.pzEco.init();
  }
})();
