/**
 * PACKZEN 3.0 — Multi-Division Workflow Orchestration Engine (Phase 4D)
 * ------------------------------------------------------------------
 * Configurable division-specific workflow pipelines, stage progression
 * validation, audit logging, and authorized manual overrides.
 *
 * DIVISION WORKFLOWS:
 * 1. Logistics:
 *    lead -> qualified -> survey -> quoted -> booked -> advance_paid -> assigned -> in_transit -> delivered -> balance_collected -> reviewed
 * 2. Home Services:
 *    lead -> qualified -> service_requested -> technician_assigned -> inspected -> quoted -> approved -> serviced -> paid -> feedback
 * 3. Digital:
 *    lead -> discovery -> proposal -> approved -> advance_paid -> kickoff -> development -> review -> delivered -> balance_paid -> maintenance
 */
"use strict";

const WORKFLOW_TEMPLATES = Object.freeze({
  logistics: [
    { id: "lead", label: "Lead Ingestion", order: 1, requiredRole: "advisor" },
    { id: "qualified", label: "Lead Qualified", order: 2, requiredRole: "advisor" },
    { id: "survey", label: "Inventory / Route Survey", order: 3, requiredRole: "advisor" },
    { id: "quoted", label: "Quotation Generated", order: 4, requiredRole: "advisor" },
    { id: "booked", label: "Customer Accepted", order: 5, requiredRole: "customer" },
    { id: "advance_paid", label: "Advance Settled (20%)", order: 6, requiredRole: "system" },
    { id: "assigned", label: "Crew & Truck Assigned", order: 7, requiredRole: "operations" },
    { id: "in_transit", label: "Packing & In-Transit", order: 8, requiredRole: "driver" },
    { id: "delivered", label: "Delivered (OTP Verified)", order: 9, requiredRole: "driver" },
    { id: "balance_collected", label: "Balance Settled (100%)", order: 10, requiredRole: "system" },
    { id: "reviewed", label: "Customer Feedback & Closed", order: 11, requiredRole: "customer" }
  ],
  home_services: [
    { id: "lead", label: "Inbound Service Lead", order: 1, requiredRole: "advisor" },
    { id: "qualified", label: "Appliance & Issue Verified", order: 2, requiredRole: "advisor" },
    { id: "service_requested", label: "Slot Reserved", order: 3, requiredRole: "customer" },
    { id: "technician_assigned", label: "Technician Dispatched", order: 4, requiredRole: "operations" },
    { id: "inspected", label: "On-Site Diagnosis", order: 5, requiredRole: "technician" },
    { id: "quoted", label: "Repair Estimate Shared", order: 6, requiredRole: "technician" },
    { id: "approved", label: "Customer Work Approval", order: 7, requiredRole: "customer" },
    { id: "serviced", label: "Job Executed (OTP Verified)", order: 8, requiredRole: "technician" },
    { id: "paid", label: "Service Bill Settled", order: 9, requiredRole: "system" },
    { id: "feedback", label: "Rating & Warranty Issued", order: 10, requiredRole: "customer" }
  ],
  digital: [
    { id: "lead", label: "Digital Inquiry", order: 1, requiredRole: "advisor" },
    { id: "discovery", label: "Scope & Discovery Call", order: 2, requiredRole: "advisor" },
    { id: "proposal", label: "Package Proposal Sent", order: 3, requiredRole: "advisor" },
    { id: "approved", label: "Contract Signed", order: 4, requiredRole: "customer" },
    { id: "advance_paid", label: "Deposit Settled (50%)", order: 5, requiredRole: "system" },
    { id: "kickoff", label: "Project Kickoff", order: 6, requiredRole: "operations" },
    { id: "development", label: "Frontend & SEO Build", order: 7, requiredRole: "operations" },
    { id: "review", label: "Client Preview & Revision", order: 8, requiredRole: "customer" },
    { id: "delivered", label: "Production Launch", order: 9, requiredRole: "operations" },
    { id: "balance_paid", label: "Balance Settled (100%)", order: 10, requiredRole: "system" },
    { id: "maintenance", label: "Care Plan Active", order: 11, requiredRole: "system" }
  ]
});

/**
 * Retrieves the workflow definition template for a given division.
 * @param {"logistics" | "home_services" | "digital"} division
 * @returns {Array<object>}
 */
function getWorkflowDefinition(division) {
  const div = String(division || "logistics").trim().toLowerCase();
  return WORKFLOW_TEMPLATES[div] || WORKFLOW_TEMPLATES.logistics;
}

/**
 * Validates whether a stage transition is valid in the workflow sequence.
 * @param {string} division
 * @param {string} fromStage
 * @param {string} toStage
 * @param {boolean} [allowOverride=false]
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateStageTransition(division, fromStage, toStage, allowOverride = false) {
  if (allowOverride) {
    return { valid: true };
  }

  const stages = getWorkflowDefinition(division);
  const fromIdx = stages.findIndex(s => s.id === fromStage);
  const toIdx = stages.findIndex(s => s.id === toStage);

  if (toIdx === -1) {
    return { valid: false, reason: `INVALID_STAGE: '${toStage}' is not recognized in ${division} workflow.` };
  }

  if (fromIdx === -1) {
    // New entry starting workflow
    return toIdx === 0 ? { valid: true } : { valid: false, reason: `Initial stage must be '${stages[0].id}'.` };
  }

  // Forward transition strictly by 1 step or idempotently staying at current stage
  if (toIdx === fromIdx) {
    return { valid: true, duplicate: true };
  }

  if (toIdx === fromIdx + 1) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `INVALID_SEQUENCE: Cannot transition from '${fromStage}' (step ${fromIdx + 1}) to '${toStage}' (step ${toIdx + 1}) without manual override.`
  };
}

/**
 * Transitions an entity to a new workflow stage and records an immutable audit entry.
 * @param {object} db - Firestore database instance.
 * @param {object} params - { division, entityType, entityId, fromStage, toStage, notes, overrideReason }
 * @param {object} context - Authenticated caller context.
 * @returns {Promise<object>}
 */
async function transitionWorkflowStage(db, params, context) {
  const { division, entityType, entityId, fromStage, toStage, notes, overrideReason } = params;
  if (!division || !entityType || !entityId || !toStage) {
    throw new Error("INVALID_WORKFLOW_PARAMS: division, entityType, entityId, and toStage are required.");
  }

  const callerUid = context.auth?.uid || "system";
  const callerRole = context.auth?.token?.role || (context.auth?.token?.email ? "admin" : "anonymous");
  const isPrivileged = callerRole === "owner" || callerRole === "admin";

  const isOverride = Boolean(overrideReason);
  if (isOverride && !isPrivileged) {
    throw new Error("PERMISSION_DENIED: Only owners and administrators may execute workflow stage overrides.");
  }

  const validation = validateStageTransition(division, fromStage, toStage, isOverride);
  if (!validation.valid) {
    throw new Error(`WORKFLOW_TRANSITION_REJECTED: ${validation.reason}`);
  }

  const nowMs = Date.now();
  const historyId = `wf_${entityType}_${entityId}_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;
  const historyEntry = {
    historyId,
    division,
    entityType,
    entityId,
    fromStage: fromStage || "initial",
    toStage,
    isOverride,
    overrideReason: isOverride ? overrideReason : null,
    notes: notes || "",
    updatedBy: callerUid,
    updatedByRole: callerRole,
    timestamp: nowMs
  };

  // Write history entry to Firestore
  await db.collection("workflow_history").doc(historyId).set(historyEntry);

  return {
    success: true,
    transitionId: historyId,
    division,
    entityId,
    currentStage: toStage,
    timestamp: nowMs
  };
}

/**
 * Retrieves the complete audit history of workflow stage transitions for an entity.
 * @param {object} db - Firestore database instance.
 * @param {object} query - { entityType, entityId }
 * @returns {Promise<Array<object>>} Chronological history entries.
 */
async function getWorkflowHistory(db, query) {
  const { entityType, entityId } = query || {};
  if (!entityType || !entityId) {
    throw new Error("INVALID_HISTORY_QUERY: entityType and entityId are required.");
  }

  const snap = await db.collection("workflow_history")
    .where("entityType", "==", entityType)
    .where("entityId", "==", entityId)
    .limit(100)
    .get();

  const docs = snap.docs ? snap.docs.map(d => d.data()) : [];
  docs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return docs;
}

module.exports = {
  WORKFLOW_TEMPLATES,
  getWorkflowDefinition,
  validateStageTransition,
  transitionWorkflowStage,
  getWorkflowHistory
};
