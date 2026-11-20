/**
 * PACKZEN 3.0 — Digital Projects Engine (Phase 3)
 * ------------------------------------------------------------------
 * Authoritative server-side management for PackZen Digital Solutions:
 *  - Atomic project creation + outbox event enqueue (project.created)
 *  - Atomic milestone state transitions + outbox event enqueue (project.milestone_updated)
 *  - Role-based authorization enforcing verified owner/admin access via isCallerAdmin
 *  - Server-side validation of amounts, packages, contacts, and scopes
 *  - Request idempotency protecting against duplicate submissions
 *  - Server-side financial ledger synchronization (advances & balance payments)
 */
"use strict";

const { isCallerAdmin } = require("./staff-customer");
const producers = require("./automation-producers");

const VALID_PROJECT_STATUSES = Object.freeze([
  "discovery",
  "in_progress",
  "client_review",
  "completed",
  "care_plan_active"
]);

const VALID_MILESTONE_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "completed"
]);

const VALID_CARE_PLAN_STATUSES = Object.freeze([
  "offered",
  "active",
  "declined"
]);

const DEFAULT_MILESTONES = Object.freeze([
  { name: "Discovery & Content", status: "completed" },
  { name: "Wireframe Approval", status: "in_progress" },
  { name: "Frontend Development", status: "pending" },
  { name: "Client Review", status: "pending" },
  { name: "Launch & Balance", status: "pending" }
]);

function cleanPhone(phone) {
  if (!phone || typeof phone !== "string") return "";
  return phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "").slice(-10);
}

function cleanEmail(email) {
  if (!email || typeof email !== "string") return "";
  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(trimmed) ? trimmed.slice(0, 120) : "";
}

function sanitizeString(str, maxLen = 200) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[<>]/g, "").trim().slice(0, maxLen);
}

function todayDateStr(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().split("T")[0];
}

/**
 * Validates project creation payload fields server-side.
 */
function validateProjectInput(data) {
  const businessName = sanitizeString(data.businessName, 120);
  if (!businessName || businessName.length < 2) {
    throw new Error("INVALID_BUSINESS_NAME: Business name must be between 2 and 120 characters");
  }

  const contactPerson = sanitizeString(data.contactPerson, 100);
  const phone = cleanPhone(data.phone);
  const email = cleanEmail(data.email);

  const pkg = sanitizeString(data.package || "Starter Showcase (₹7,999)", 100);
  const amount = Number(data.amount);
  if (isNaN(amount) || amount < 0 || amount > 10000000) {
    throw new Error("INVALID_AMOUNT: Project amount must be a number between 0 and 10,000,000");
  }

  const advancePaid = Number(data.advancePaid || 0);
  if (isNaN(advancePaid) || advancePaid < 0 || advancePaid > amount) {
    throw new Error("INVALID_ADVANCE_AMOUNT: Advance paid must be between 0 and the total project amount");
  }

  const balanceDue = Math.max(0, amount - advancePaid);
  const scope = sanitizeString(data.scope, 2000);
  const exclusions = sanitizeString(data.exclusions, 2000);
  const developer = sanitizeString(data.developer || "Lead Developer", 80);

  const status = data.status || "in_progress";
  if (!VALID_PROJECT_STATUSES.includes(status)) {
    throw new Error(`INVALID_PROJECT_STATUS: Status '${status}' is not supported`);
  }

  const carePlanStatus = data.carePlanStatus || "offered";
  if (!VALID_CARE_PLAN_STATUSES.includes(carePlanStatus)) {
    throw new Error(`INVALID_CARE_PLAN_STATUS: Status '${carePlanStatus}' is not supported`);
  }

  let milestones = [];
  if (Array.isArray(data.milestones) && data.milestones.length > 0) {
    milestones = data.milestones.map((m, idx) => {
      const name = sanitizeString(m && m.name, 100) || `Milestone ${idx + 1}`;
      const mStatus = m && m.status ? m.status : "pending";
      if (!VALID_MILESTONE_STATUSES.includes(mStatus)) {
        throw new Error(`INVALID_MILESTONE_STATUS: Status '${mStatus}' at index ${idx} is not supported`);
      }
      return {
        name,
        status: mStatus,
        date: m.date || (mStatus === "completed" ? todayDateStr() : "")
      };
    });
  } else {
    milestones = DEFAULT_MILESTONES.map((m) => ({
      name: m.name,
      status: m.status,
      date: m.status === "completed" ? todayDateStr() : ""
    }));
  }

  const deliveryLinks = {
    staging: sanitizeString(data.deliveryLinks && data.deliveryLinks.staging, 500),
    live: sanitizeString(data.deliveryLinks && data.deliveryLinks.live, 500),
    figma: sanitizeString(data.deliveryLinks && data.deliveryLinks.figma, 500)
  };

  return {
    businessName,
    contactPerson,
    phone,
    email,
    package: pkg,
    amount,
    advancePaid,
    balanceDue,
    scope,
    exclusions,
    developer,
    status,
    carePlanStatus,
    milestones,
    deliveryLinks,
    revisionsMax: Number(data.revisionsMax) || 2,
    clientUid: data.clientUid ? String(data.clientUid).trim() : null,
    requestId: data.requestId ? String(data.requestId).trim() : null
  };
}

/**
 * Creates a PackZen Digital project and enqueues project.created atomically.
 */
async function createDigitalProject(db, data, context, options = {}) {
  const isAdmin = await isCallerAdmin(null, context);
  if (!isAdmin) {
    throw new Error("PERMISSION_DENIED: Verified owner authorization required to create digital projects");
  }

  const validated = validateProjectInput(data);
  const nowMs = options.nowMs || Date.now();
  const todayStr = todayDateStr(nowMs);

  // Validate or generate projectId
  let projectId = data.projectId || data.id;
  if (projectId) {
    projectId = String(projectId).trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(projectId)) {
      throw new Error(`INVALID_PROJECT_ID: '${projectId}' must be 3-32 alphanumeric characters, dashes, or underscores`);
    }
  } else {
    projectId = `PZD-${new Date(nowMs).getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
  }

  const docRef = db.collection("projects").doc(projectId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    if (snap.exists) {
      const existing = snap.data();
      // Idempotency: if duplicate request with same requestId, return existing
      if (validated.requestId && existing.requestId === validated.requestId) {
        return {
          success: true,
          projectId,
          duplicate: true,
          project: existing
        };
      }
      throw new Error(`PROJECT_ALREADY_EXISTS: Project with ID '${projectId}' already exists`);
    }

    const projectDoc = {
      id: projectId,
      projectId,
      businessName: validated.businessName,
      contactPerson: validated.contactPerson,
      phone: validated.phone,
      email: validated.email,
      package: validated.package,
      amount: validated.amount,
      advancePaid: validated.advancePaid,
      balanceDue: validated.balanceDue,
      scope: validated.scope,
      exclusions: validated.exclusions,
      milestones: validated.milestones,
      developer: validated.developer,
      status: validated.status,
      revisionsUsed: 0,
      revisionsMax: validated.revisionsMax,
      deliveryLinks: validated.deliveryLinks,
      carePlanStatus: validated.carePlanStatus,
      clientUid: validated.clientUid,
      requestId: validated.requestId,
      division: "digital",
      persistence: "firestore",
      createdBy: context && context.auth ? context.auth.uid : "admin",
      createdAt: todayStr,
      createdAtMs: nowMs,
      updatedAtMs: nowMs
    };

    tx.set(docRef, projectDoc);

    // 1. Atomically enqueue project.created outbox event
    await producers.emitProjectCreatedTx(tx, db, projectId, projectDoc, nowMs);

    // 2. If advance was collected, record in financial ledger atomically
    if (validated.advancePaid > 0) {
      const ledgerRef = db.collection("ledger").doc(`tx_adv_${projectId}`);
      tx.set(ledgerRef, {
        refId: projectId,
        division: "digital",
        type: "collection",
        subcat: "advance",
        desc: `Advance for ${validated.businessName}`,
        amount: validated.advancePaid,
        date: todayStr,
        createdAtMs: nowMs,
        createdBy: context && context.auth ? context.auth.uid : "admin"
      });
    }

    return {
      success: true,
      projectId,
      project: projectDoc
    };
  });
}

/**
 * Updates a specific milestone within a Digital project and enqueues project.milestone_updated atomically.
 */
async function updateDigitalProjectMilestone(db, data, context, options = {}) {
  const isAdmin = await isCallerAdmin(null, context);
  if (!isAdmin) {
    throw new Error("PERMISSION_DENIED: Verified owner authorization required to update project milestones");
  }

  const projectId = data.projectId || data.id;
  if (!projectId || typeof projectId !== "string") {
    throw new Error("INVALID_PROJECT_ID: Project ID is required");
  }

  const milestoneIndex = Number(data.milestoneIndex);
  if (isNaN(milestoneIndex) || milestoneIndex < 0) {
    throw new Error("INVALID_MILESTONE_INDEX: Milestone index must be a non-negative integer");
  }

  const newStatus = data.newStatus || data.status;
  if (!VALID_MILESTONE_STATUSES.includes(newStatus)) {
    throw new Error(`INVALID_MILESTONE_STATUS: Status '${newStatus}' is not supported`);
  }

  const note = sanitizeString(data.note, 300);
  const allowRevert = data.allowRevert === true;
  const nowMs = options.nowMs || Date.now();
  const todayStr = todayDateStr(nowMs);

  const docRef = db.collection("projects").doc(projectId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      throw new Error(`PROJECT_NOT_FOUND: Project '${projectId}' does not exist`);
    }

    const project = snap.data();
    const milestones = Array.isArray(project.milestones) ? [...project.milestones] : [];

    if (milestoneIndex >= milestones.length) {
      throw new Error(`INVALID_MILESTONE_INDEX: Index ${milestoneIndex} is out of bounds (0-${milestones.length - 1})`);
    }

    const currentMilestone = Object.assign({}, milestones[milestoneIndex]);
    const currentStatus = currentMilestone.status || "pending";

    // Idempotent: if already in the target status, return unchanged without duplicate event
    if (currentStatus === newStatus) {
      return {
        success: true,
        projectId,
        milestoneIndex,
        status: newStatus,
        unchanged: true,
        milestone: currentMilestone
      };
    }

    // Guard against accidental milestone rollback (e.g. completed -> pending)
    if (currentStatus === "completed" && newStatus !== "completed" && !allowRevert) {
      throw new Error(`INVALID_TRANSITION: Cannot revert completed milestone '${currentMilestone.name}' without allowRevert override`);
    }

    currentMilestone.status = newStatus;
    currentMilestone.updatedAtMs = nowMs;
    if (newStatus === "completed") {
      currentMilestone.completedAtMs = nowMs;
      currentMilestone.date = data.date || todayStr;
    } else if (newStatus === "in_progress") {
      currentMilestone.startedAtMs = nowMs;
    }
    if (note) {
      currentMilestone.note = note;
    }

    milestones[milestoneIndex] = currentMilestone;

    // Check if all milestones are completed -> auto complete project status
    const allCompleted = milestones.every((m) => m.status === "completed");
    const updatedProjectStatus = allCompleted ? "completed" : project.status;

    tx.update(docRef, {
      milestones,
      status: updatedProjectStatus,
      updatedAtMs: nowMs
    });

    // Atomically enqueue project.milestone_updated outbox event
    await producers.emitProjectMilestoneUpdatedTx(tx, db, projectId, {
      businessName: project.businessName,
      clientName: project.contactPerson || project.clientName || "",
      clientEmail: project.email || project.clientEmail || "",
      clientPhone: project.phone || project.clientPhone || "",
      milestoneName: currentMilestone.name,
      milestoneIndex,
      status: newStatus,
      qualifier: `${milestoneIndex}:${newStatus}`
    }, nowMs);

    return {
      success: true,
      projectId,
      milestoneIndex,
      milestoneName: currentMilestone.name,
      previousStatus: currentStatus,
      newStatus,
      allCompleted,
      projectStatus: updatedProjectStatus
    };
  });
}

/**
 * Updates general project attributes (status, deliveryLinks, carePlan, additional payment) atomically.
 */
async function updateDigitalProject(db, data, context, options = {}) {
  const isAdmin = await isCallerAdmin(null, context);
  if (!isAdmin) {
    throw new Error("PERMISSION_DENIED: Verified owner authorization required to update digital projects");
  }

  const projectId = data.projectId || data.id;
  if (!projectId || typeof projectId !== "string") {
    throw new Error("INVALID_PROJECT_ID: Project ID is required");
  }

  const nowMs = options.nowMs || Date.now();
  const todayStr = todayDateStr(nowMs);
  const docRef = db.collection("projects").doc(projectId);

  // Validate payment request ID if provided
  let paymentRequestId = data.paymentRequestId;
  if (paymentRequestId !== undefined && paymentRequestId !== null) {
    if (typeof paymentRequestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(paymentRequestId.trim())) {
      throw new Error("INVALID_PAYMENT_REQUEST_ID: Payment request ID must be 8-64 alphanumeric characters, dashes, or underscores");
    }
    paymentRequestId = paymentRequestId.trim();
  }

  // Pre-validate additional payment if provided
  const hasPaymentField = data.additionalPayment !== undefined && data.additionalPayment !== null;
  let addPay = 0;
  if (hasPaymentField) {
    addPay = Number(data.additionalPayment);
    if (!Number.isFinite(addPay) || addPay <= 0) {
      throw new Error(`INVALID_PAYMENT_AMOUNT: Additional payment must be a finite positive number, received '${data.additionalPayment}'`);
    }
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      throw new Error(`PROJECT_NOT_FOUND: Project '${projectId}' does not exist`);
    }

    const current = snap.data();
    const update = { updatedAtMs: nowMs };

    if (data.status) {
      if (!VALID_PROJECT_STATUSES.includes(data.status)) {
        throw new Error(`INVALID_PROJECT_STATUS: Status '${data.status}' is not supported`);
      }
      update.status = data.status;
    }

    if (data.carePlanStatus) {
      if (!VALID_CARE_PLAN_STATUSES.includes(data.carePlanStatus)) {
        throw new Error(`INVALID_CARE_PLAN_STATUS: Status '${data.carePlanStatus}' is not supported`);
      }
      update.carePlanStatus = data.carePlanStatus;
    }

    if (data.deliveryLinks && typeof data.deliveryLinks === "object") {
      update.deliveryLinks = {
        staging: sanitizeString(data.deliveryLinks.staging, 500) || (current.deliveryLinks && current.deliveryLinks.staging) || "",
        live: sanitizeString(data.deliveryLinks.live, 500) || (current.deliveryLinks && current.deliveryLinks.live) || "",
        figma: sanitizeString(data.deliveryLinks.figma, 500) || (current.deliveryLinks && current.deliveryLinks.figma) || ""
      };
    }

    if (data.developer) {
      update.developer = sanitizeString(data.developer, 80);
    }

    // Additional payment handling inside transaction
    if (hasPaymentField && addPay > 0) {
      // Objective B: Deterministic balance payment idempotency check FIRST
      const reqId = paymentRequestId || `req_bal_${projectId}_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
      const ledgerDocId = `tx_bal_${projectId}_${reqId}`;
      const ledgerRef = db.collection("ledger").doc(ledgerDocId);

      const existingLedgerSnap = await tx.get(ledgerRef);
      if (existingLedgerSnap.exists) {
        const existingTx = existingLedgerSnap.data();
        if (Number(existingTx.amount) !== addPay) {
          throw new Error(`PAYMENT_REQUEST_MISMATCH: Payment request ID '${reqId}' already used for a different amount (₹${existingTx.amount} vs ₹${addPay})`);
        }
        // Idempotent duplicate: already settled
        return {
          success: true,
          projectId,
          duplicate: true,
          paymentRequestId: reqId,
          updated: {
            advancePaid: current.advancePaid,
            balanceDue: current.balanceDue
          }
        };
      }

      // Objective A: Prevent balance overpayment (for new payments)
      const totalAmount = Number(current.amount || 0);
      const currentAdvance = Number(current.advancePaid || 0);
      const currentBalance = current.balanceDue !== undefined ? Number(current.balanceDue) : Math.max(0, totalAmount - currentAdvance);

      if (addPay > currentBalance) {
        throw new Error(`EXCESSIVE_PAYMENT_AMOUNT: Additional payment (₹${addPay}) exceeds remaining balance due (₹${currentBalance})`);
      }

      const newAdvance = currentAdvance + addPay;
      const newBalance = Math.max(0, totalAmount - newAdvance);

      update.advancePaid = newAdvance;
      update.balanceDue = newBalance;

      // Atomically set deterministic ledger document
      tx.set(ledgerRef, {
        ledgerId: ledgerDocId,
        refId: projectId,
        paymentRequestId: reqId,
        division: "digital",
        type: "collection",
        subcat: "balance",
        desc: `Balance payment for ${current.businessName}`,
        amount: addPay,
        date: todayStr,
        createdAtMs: nowMs,
        createdBy: context && context.auth ? context.auth.uid : "admin"
      });
    }

    tx.update(docRef, update);

    return {
      success: true,
      projectId,
      updated: update
    };
  });
}

module.exports = {
  createDigitalProject,
  updateDigitalProjectMilestone,
  updateDigitalProject,
  validateProjectInput,
  cleanPhone,
  cleanEmail,
  sanitizeString,
  VALID_PROJECT_STATUSES,
  VALID_MILESTONE_STATUSES,
  VALID_CARE_PLAN_STATUSES,
  DEFAULT_MILESTONES
};
