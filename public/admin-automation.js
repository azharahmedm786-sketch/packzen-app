/**
 * PACKZEN 3.0 — Automation Control Center Frontend UI
 * ------------------------------------------------------------------
 * Interactive administrative dashboard for monitoring, inspecting,
 * reconciling, and recovering transactional automation outbox events.
 *
 * Capabilities:
 *   - Overview KPI cards (Total, Completed, Pending, Failed, Dead-letter, Adapter-pending, Ambiguous)
 *   - System operational health indicator (HEALTHY / WARNING / CRITICAL)
 *   - Independent channel metrics: Email (Brevo), WhatsApp (Meta), Webhook (n8n on Railway)
 *   - Dynamic filters: Business division (Logistics, Home Services, Digital), Status, Channel
 *   - Event activity table with real-time refresh
 *   - Detailed event inspection with automatic PII masking & secret redaction
 *   - Safe owner-authorized manual retry controls with confirmation
 *   - Reconcile stale worker leases & validate adapter credentials
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  const state = {
    divisionFilter: "all",
    statusFilter: "all",
    channelFilter: "all",
    stats: null,
    loading: false,
    selectedEvent: null
  };

  function getCallable(name) {
    if (typeof window._adminCallable === "function") {
      return window._adminCallable(name);
    }
    return firebase.app().functions("asia-south1").httpsCallable(name);
  }

  function notify(msg, type = "info") {
    if (typeof window.toast === "function") {
      window.toast(msg);
    } else {
      alert(msg);
    }
  }

  async function loadStats() {
    state.loading = true;
    render();
    try {
      const fn = getCallable("adminGetAutomationStats");
      const res = await fn({
        division: state.divisionFilter,
        status: state.statusFilter,
        channel: state.channelFilter
      });
      state.stats = res.data;
      updateSidebarAlertBadge();
    } catch (err) {
      console.error("[AutomationCenter] loadStats failed:", err);
      notify("Failed to load automation stats: " + err.message, "error");
    } finally {
      state.loading = false;
      render();
    }
  }

  function updateSidebarAlertBadge() {
    const badge = $("automationAlertCount");
    if (!badge || !state.stats) return;
    const alertCount = (state.stats.counts.dead_letter || 0) + (state.stats.counts.delivery_unknown || 0);
    if (alertCount > 0) {
      badge.textContent = alertCount;
      badge.style.display = "inline-block";
      badge.style.background = "#ef4444";
      badge.style.color = "#fff";
    } else {
      badge.style.display = "none";
    }
  }

  async function showEventDetail(eventId) {
    try {
      const fn = getCallable("adminGetAutomationEventDetail");
      const res = await fn({ eventId });
      state.selectedEvent = res.data;
      renderModal();
    } catch (err) {
      notify("Failed to fetch event detail: " + err.message, "error");
    }
  }

  async function requestSafeRetry(eventId) {
    const reason = prompt("Enter a reason for this manual retry (audit logged):", "Admin operational recovery");
    if (!reason) return;

    if (!confirm(`Are you sure you want to request a safe retry for event ${eventId}?`)) return;

    try {
      const fn = getCallable("adminRetryOutboxEvent");
      const res = await fn({ eventId, reason });
      notify(`Safe retry scheduled! Event reset to pending status.`, "success");
      closeModal();
      loadStats();
    } catch (err) {
      notify(`Retry failed: ${err.message}`, "error");
    }
  }

  async function runReconciliation(action) {
    let confirmMsg = "";
    if (action === "stale_leases") {
      confirmMsg = "Scan and reclaim worker leases abandoned by crashed instances?";
    } else if (action === "adapter_pending") {
      confirmMsg = "Validate runtime credentials and unpause eligible adapter_pending events?";
    } else if (action === "delivery_unknown") {
      confirmMsg = "Recheck ambiguous delivery events against provider idempotency gates?";
    }

    if (!confirm(confirmMsg)) return;

    try {
      const fn = getCallable("adminReconcileOutbox");
      const res = await fn({ action, division: state.divisionFilter });
      const r = res.data;
      notify(`Reconciliation complete! Scanned: ${r.scanned}, Reconciled: ${r.reconciled}, Skipped: ${r.skipped}`, "success");
      loadStats();
    } catch (err) {
      notify(`Reconciliation error: ${err.message}`, "error");
    }
  }

  function closeModal() {
    state.selectedEvent = null;
    const modal = $("pzAutoDetailModal");
    if (modal) modal.remove();
  }

  function renderModal() {
    closeModal();
    const ev = state.selectedEvent;
    if (!ev) return;

    const modal = document.createElement("div");
    modal.id = "pzAutoDetailModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";

    const isRetryable = ev.status === "dead_letter" || (ev.status === "pending" && ev.deliveryUnknown) || ev.status === "retry_scheduled";

    modal.innerHTML = `
      <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.15);border-radius:12px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;color:#f8fafc;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;margin-bottom:16px;">
          <div>
            <h3 style="margin:0;font-size:1.15rem;display:flex;align-items:center;gap:8px;">
              <span>⚡ ${esc(ev.eventName)}</span>
              <span class="eco-badge eco-badge-${esc(ev.division)}">${esc(ev.division)}</span>
            </h3>
            <span style="font-size:0.75rem;color:#94a3b8;font-family:monospace;">ID: ${esc(ev.eventId)}</span>
          </div>
          <button onclick="window.pzAutomation.closeModal()" style="background:transparent;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;">✕</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:0.85rem;">
          <div><strong>Status:</strong> <span style="font-weight:700;color:${getStatusColor(ev.status)}">${esc(ev.status.toUpperCase())}</span></div>
          <div><strong>Attempts:</strong> ${ev.attempts} / ${ev.maxRetries} (Manual: ${ev.manualRetryCount || 0})</div>
          <div><strong>Channel:</strong> ${esc(ev.channel)}</div>
          <div><strong>Created:</strong> ${new Date(ev.createdAtMs).toLocaleString("en-IN")}</div>
          <div><strong>Lease Holder:</strong> ${ev.claimedBy ? esc(ev.claimedBy) : "<em>None</em>"}</div>
          <div><strong>Next Retry:</strong> ${ev.nextRetryAtMs ? new Date(ev.nextRetryAtMs).toLocaleTimeString("en-IN") : "<em>Immediate / None</em>"}</div>
        </div>

        ${ev.lastError ? `
          <div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);padding:10px;border-radius:6px;margin-bottom:16px;font-size:0.82rem;color:#fca5a5;">
            <strong>Last Error:</strong> ${esc(ev.lastError)}
          </div>
        ` : ""}

        <div style="margin-bottom:16px;">
          <h4 style="margin:0 0 8px;font-size:0.9rem;color:#cbd5e1;">Channel Delivery Breakdown:</h4>
          <pre style="background:#0f172a;padding:10px;border-radius:6px;font-size:0.75rem;overflow-x:auto;color:#38bdf8;">${esc(JSON.stringify(ev.channelDeliveries, null, 2))}</pre>
        </div>

        <div style="margin-bottom:16px;">
          <h4 style="margin:0 0 8px;font-size:0.9rem;color:#cbd5e1;">Sanitized Payload (PII Masked, Secrets Redacted):</h4>
          <pre style="background:#0f172a;padding:10px;border-radius:6px;font-size:0.75rem;overflow-x:auto;color:#a7f3d0;">${esc(JSON.stringify(ev.sanitizedPayload, null, 2))}</pre>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:12px;border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;">
          <button onclick="window.pzAutomation.closeModal()" style="padding:8px 16px;background:rgba(255,255,255,0.1);border:none;border-radius:6px;color:#fff;cursor:pointer;">Close</button>
          ${isRetryable ? `
            <button onclick="window.pzAutomation.requestSafeRetry('${esc(ev.eventId)}')" style="padding:8px 16px;background:#10b981;border:none;border-radius:6px;color:#fff;font-weight:600;cursor:pointer;">
              🔄 Request Safe Retry
            </button>
          ` : ""}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  function getStatusColor(status) {
    switch (status) {
      case "completed": return "#10b981";
      case "pending": return "#3b82f6";
      case "processing": return "#eab308";
      case "dead_letter": return "#ef4444";
      case "adapter_pending": return "#a855f7";
      case "delivery_unknown": return "#f97316";
      default: return "#94a3b8";
    }
  }

  function render() {
    const container = $("sectionAutomation");
    if (!container) return;

    if (!state.stats && !state.loading) {
      container.innerHTML = `
        <div style="text-align:center;padding:48px 16px;">
          <div style="font-size:2rem;margin-bottom:12px;">🤖</div>
          <h3>PackZen Automation Control Center</h3>
          <p style="color:#94a3b8;font-size:0.9rem;margin-bottom:20px;">Real-time monitoring, failure management, and reconciliation engine.</p>
          <button onclick="window.pzAutomation.loadStats()" style="padding:10px 20px;background:var(--primary,#1F9D5C);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">
            Initialize & Load Control Center
          </button>
        </div>
      `;
      return;
    }

    if (state.loading && !state.stats) {
      container.innerHTML = `
        <div style="text-align:center;padding:64px 16px;color:#94a3b8;">
          <div style="font-size:1.8rem;margin-bottom:12px;animation:spin 1s linear infinite;">⏳</div>
          <p>Connecting to Automation Outbox & Channel Dispatchers...</p>
        </div>
      `;
      return;
    }

    const s = state.stats;
    const c = s.counts;
    const ch = s.channelHealth;

    const healthColor = s.systemHealth === "HEALTHY" ? "#10b981" : (s.systemHealth === "WARNING" ? "#f59e0b" : "#ef4444");

    container.innerHTML = `
      <div style="padding:0 4px 32px;">
        <!-- Header Strip -->
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;">
          <div>
            <h2 style="margin:0;font-size:1.4rem;display:flex;align-items:center;gap:10px;">
              <span>🤖 Automation Control Center</span>
              <span style="font-size:0.75rem;padding:3px 8px;border-radius:999px;background:${healthColor}20;color:${healthColor};border:1px solid ${healthColor}40;">
                ● ${s.systemHealth}
              </span>
            </h2>
            <p style="margin:4px 0 0;font-size:0.82rem;color:#94a3b8;">PackZen 3.0 Transactional Outbox, Workers & Multi-Channel Dispatchers</p>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="window.pzAutomation.loadStats()" style="padding:7px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:inherit;font-size:0.82rem;cursor:pointer;">
              🔄 Refresh
            </button>
            <button onclick="window.pzAutomation.runReconciliation('stale_leases')" style="padding:7px 14px;background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.3);border-radius:6px;color:#eab308;font-size:0.82rem;font-weight:600;cursor:pointer;">
              ⚡ Reclaim Stale Leases
            </button>
            <button onclick="window.pzAutomation.runReconciliation('adapter_pending')" style="padding:7px 14px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);border-radius:6px;color:#c084fc;font-size:0.82rem;font-weight:600;cursor:pointer;">
              🔌 Unpause Verified Adapters
            </button>
          </div>
        </div>

        <!-- KPI Cards Grid -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:12px;margin-bottom:24px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;">
            <div style="font-size:0.75rem;color:#94a3b8;font-weight:600;">TOTAL EVENTS</div>
            <div style="font-size:1.6rem;font-weight:700;margin-top:4px;">${c.total}</div>
          </div>
          <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:14px;">
            <div style="font-size:0.75rem;color:#10b981;font-weight:600;">COMPLETED</div>
            <div style="font-size:1.6rem;font-weight:700;color:#10b981;margin-top:4px;">${c.completed}</div>
          </div>
          <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:14px;">
            <div style="font-size:0.75rem;color:#3b82f6;font-weight:600;">PENDING</div>
            <div style="font-size:1.6rem;font-weight:700;color:#3b82f6;margin-top:4px;">${c.pending}</div>
          </div>
          <div style="background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.2);border-radius:10px;padding:14px;">
            <div style="font-size:0.75rem;color:#eab308;font-weight:600;">PROCESSING</div>
            <div style="font-size:1.6rem;font-weight:700;color:#eab308;margin-top:4px;">${c.processing}</div>
          </div>
          <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:14px;">
            <div style="font-size:0.75rem;color:#ef4444;font-weight:600;">DEAD LETTER</div>
            <div style="font-size:1.6rem;font-weight:700;color:#ef4444;margin-top:4px;">${c.dead_letter}</div>
          </div>
          <div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.2);border-radius:10px;padding:14px;">
            <div style="font-size:0.75rem;color:#c084fc;font-weight:600;">ADAPTER PENDING</div>
            <div style="font-size:1.6rem;font-weight:700;color:#c084fc;margin-top:4px;">${c.adapter_pending}</div>
          </div>
          <div style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.2);border-radius:10px;padding:14px;">
            <div style="font-size:0.75rem;color:#fb923c;font-weight:600;">DELIVERY UNKNOWN</div>
            <div style="font-size:1.6rem;font-weight:700;color:#fb923c;margin-top:4px;">${c.delivery_unknown}</div>
          </div>
        </div>

        <!-- Channel Health Matrix -->
        <h3 style="font-size:0.95rem;margin:0 0 10px;color:#cbd5e1;">Independent Channel Health</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;margin-bottom:24px;">
          <!-- Email -->
          <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-weight:700;font-size:0.9rem;">📧 Brevo Transactional Email</span>
              <span style="font-size:0.7rem;color:#10b981;font-weight:600;">ACTIVE (Phase 2A)</span>
            </div>
            <div style="font-size:0.82rem;color:#94a3b8;display:flex;gap:14px;">
              <span>Delivered: <strong style="color:#f8fafc;">${ch.email.delivered}</strong></span>
              <span>Failed: <strong style="color:#ef4444;">${ch.email.failed}</strong></span>
            </div>
          </div>

          <!-- WhatsApp -->
          <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-weight:700;font-size:0.9rem;">💬 Meta WhatsApp Cloud API</span>
              <span style="font-size:0.7rem;color:#10b981;font-weight:600;">ACTIVE (Phase 2B)</span>
            </div>
            <div style="font-size:0.82rem;color:#94a3b8;display:flex;gap:14px;">
              <span>Delivered: <strong style="color:#f8fafc;">${ch.whatsapp.delivered}</strong></span>
              <span>Opt-Out Skips: <strong style="color:#eab308;">${ch.whatsapp.skipped}</strong></span>
              <span>Failed: <strong style="color:#ef4444;">${ch.whatsapp.failed}</strong></span>
            </div>
          </div>

          <!-- Webhook -->
          <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-weight:700;font-size:0.9rem;">⚡ n8n Webhook (Railway)</span>
              <span style="font-size:0.7rem;color:#38bdf8;font-weight:600;">ACTIVE (Phase 2C)</span>
            </div>
            <div style="font-size:0.82rem;color:#94a3b8;display:flex;gap:14px;">
              <span>Accepted 2xx: <strong style="color:#f8fafc;">${ch.webhook.delivered}</strong></span>
              <span>Ambiguous: <strong style="color:#fb923c;">${ch.webhook.ambiguous}</strong></span>
              <span>Adapter Pending: <strong style="color:#c084fc;">${ch.webhook.adapterPending}</strong></span>
            </div>
          </div>
        </div>

        <!-- Filter Bar -->
        <div class="eco-pill-group" style="margin-bottom:16px;">
          <span style="font-size:0.82rem;font-weight:600;margin-right:6px;color:#94a3b8;">Division:</span>
          <button class="eco-pill-btn ${state.divisionFilter === 'all' ? 'active' : ''}" onclick="window.pzAutomation.setDivision('all')">All (${s.divisionCounts.all || s.counts.total})</button>
          <button class="eco-pill-btn ${state.divisionFilter === 'logistics' ? 'active' : ''}" onclick="window.pzAutomation.setDivision('logistics')">Logistics (${s.divisionCounts.logistics || 0})</button>
          <button class="eco-pill-btn ${state.divisionFilter === 'home_services' ? 'active' : ''}" onclick="window.pzAutomation.setDivision('home_services')">Home Services (${s.divisionCounts.home_services || 0})</button>
          <button class="eco-pill-btn ${state.divisionFilter === 'digital' ? 'active' : ''}" onclick="window.pzAutomation.setDivision('digital')">Digital (${s.divisionCounts.digital || 0})</button>
        </div>

        <!-- Recent Event Activity Table -->
        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.1);color:#94a3b8;background:rgba(255,255,255,0.02);">
                <th style="padding:10px 14px;">Time</th>
                <th style="padding:10px 14px;">Event Name</th>
                <th style="padding:10px 14px;">Division</th>
                <th style="padding:10px 14px;">Channel Delivery</th>
                <th style="padding:10px 14px;">Status</th>
                <th style="padding:10px 14px;">Attempts</th>
                <th style="padding:10px 14px;text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${s.recentEvents.length === 0 ? `
                <tr>
                  <td colspan="7" style="padding:32px;text-align:center;color:#94a3b8;">
                    No automation events found matching current filters.
                  </td>
                </tr>
              ` : s.recentEvents.map((ev) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:10px 14px;color:#94a3b8;">${new Date(ev.createdAtMs).toLocaleTimeString("en-IN")}</td>
                  <td style="padding:10px 14px;font-weight:600;">
                    ${esc(ev.eventName)}
                    <div style="font-size:0.7rem;color:#64748b;font-family:monospace;">${esc(ev.eventId.slice(0, 16))}...</div>
                  </td>
                  <td style="padding:10px 14px;"><span class="eco-badge eco-badge-${esc(ev.division)}">${esc(ev.division)}</span></td>
                  <td style="padding:10px 14px;">
                    ${renderChannelBadges(ev.channelDeliveries)}
                  </td>
                  <td style="padding:10px 14px;">
                    <span style="font-weight:700;color:${getStatusColor(ev.status)}">${esc(ev.status)}</span>
                  </td>
                  <td style="padding:10px 14px;">${ev.attempts}</td>
                  <td style="padding:10px 14px;text-align:right;">
                    <button onclick="window.pzAutomation.showEventDetail('${esc(ev.eventId)}')" style="padding:4px 10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:inherit;font-size:0.75rem;cursor:pointer;">
                      Inspect
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderChannelBadges(delivs) {
    if (!delivs || Object.keys(delivs).length === 0) {
      return `<span style="color:#64748b;font-size:0.75rem;">None</span>`;
    }
    const badges = [];
    if (delivs.email) {
      const col = delivs.email.status === "delivered" ? "#10b981" : "#ef4444";
      badges.push(`<span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:${col}20;color:${col};">✉ Email</span>`);
    }
    if (delivs.whatsapp) {
      const col = delivs.whatsapp.status === "delivered" ? "#10b981" : (delivs.whatsapp.status === "skipped" ? "#eab308" : "#ef4444");
      badges.push(`<span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:${col}20;color:${col};">💬 WA</span>`);
    }
    if (delivs.webhook) {
      const col = delivs.webhook.status === "delivered" ? "#38bdf8" : (delivs.webhook.status === "adapter_pending" ? "#c084fc" : "#ef4444");
      badges.push(`<span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:${col}20;color:${col};">⚡ n8n</span>`);
    }
    return badges.join(" ");
  }

  function setDivision(div) {
    state.divisionFilter = div;
    loadStats();
  }

  // Expose global interface
  window.pzAutomation = {
    render,
    loadStats,
    setDivision,
    showEventDetail,
    requestSafeRetry,
    runReconciliation,
    closeModal
  };
})();
