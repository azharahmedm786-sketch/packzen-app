/**
 * PACKZEN 3.0 — Transactional Event Producers
 * ------------------------------------------------------------------
 * Authoritative server-side event producers for all 11 supported events.
 * Every producer validates payloads and enqueues events atomically
 * inside active Firestore transactions.
 */
"use strict";

const outbox = require("./automation-outbox");

/**
 * 1. lead.created — Fired when a new lead is saved in leads collection
 */
async function emitLeadCreatedTx(tx, db, leadId, leadData, nowMs = Date.now(), options = {}) {
  const event = outbox.createOutboxEvent({
    eventName: "lead.created",
    entityType: "lead",
    entityId: String(leadId),
    division: leadData.division || "logistics",
    payload: {
      leadId: String(leadId),
      name: leadData.name || "Customer",
      email: leadData.email || "",
      phone: leadData.phone || "",
      service: leadData.service || "move",
      serviceLabel: leadData.serviceLabel || "Service Request",
      area: leadData.area || "",
      date: leadData.date || null,
      source: leadData.source || "direct",
      score: leadData.score || 0,
      tier: leadData.tier || "warm"
    },
    metadata: { source: "leads.upsertLead", version: "3.0" },
    priority: leadData.tier === "hot" ? "urgent" : "normal",
    channel: options.channel || leadData.channel || "whatsapp",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 2. lead.qualified — Fired when a lead is qualified / quotation is prepared
 */
async function emitLeadQualifiedTx(tx, db, leadId, quoteData, nowMs = Date.now(), options = {}) {
  const event = outbox.createOutboxEvent({
    eventName: "lead.qualified",
    entityType: "lead",
    entityId: String(leadId),
    division: quoteData.division || "logistics",
    payload: {
      leadId: String(leadId),
      customerName: quoteData.customerName || "Customer",
      customerEmail: quoteData.customerEmail || quoteData.email || "",
      phone: quoteData.phone || "",
      total: Number(quoteData.total) || 0,
      quoteToken: quoteData.quoteToken || null,
      serviceLabel: quoteData.serviceLabel || "Moving Quotation",
      qualifier: String(quoteData.quoteToken || nowMs)
    },
    metadata: { source: "sales.createSentQuote", version: "3.0" },
    priority: "high",
    channel: options.channel || quoteData.channel || "whatsapp",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 3. booking.created — Fired when a booking record is initialized
 */
async function emitBookingCreatedTx(tx, db, bookingId, bookingData, nowMs = Date.now(), options = {}) {
  const event = outbox.createOutboxEvent({
    eventName: "booking.created",
    entityType: "booking",
    entityId: String(bookingId),
    division: bookingData.division || "logistics",
    payload: {
      bookingId: String(bookingId),
      bookingRef: bookingData.bookingRef || bookingId,
      customerName: bookingData.customerName || "Customer",
      customerEmail: bookingData.customerEmail || bookingData.email || "",
      phone: bookingData.phone || "",
      pickup: bookingData.pickup || "",
      drop: bookingData.drop || "",
      date: bookingData.date || "",
      total: Number(bookingData.total) || 0,
      paymentType: bookingData.paymentType || "pay_later"
    },
    metadata: { source: "index.createBooking", version: "3.0" },
    priority: "normal",
    channel: options.channel || bookingData.channel || "whatsapp",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 4. booking.confirmed — Fired when online token payment or full payment is verified
 */
async function emitBookingConfirmedTx(tx, db, bookingId, bookingData, paymentData = {}, nowMs = Date.now(), options = {}) {
  const event = outbox.createOutboxEvent({
    eventName: "booking.confirmed",
    entityType: "booking",
    entityId: String(bookingId),
    division: bookingData.division || "logistics",
    payload: {
      bookingId: String(bookingId),
      bookingRef: bookingData.bookingRef || bookingId,
      customerName: bookingData.customerName || "Customer",
      customerEmail: bookingData.customerEmail || bookingData.email || "",
      phone: bookingData.phone || "",
      paymentId: paymentData.paymentId || bookingData.paymentId || "offline",
      orderId: paymentData.orderId || bookingData.orderId || null,
      paidAmount: Number(paymentData.amount || bookingData.paid || 0),
      balanceDue: Number(bookingData.balanceDue || 0),
      total: Number(bookingData.total || 0),
      date: bookingData.date || "",
      pickup: bookingData.pickup || "",
      drop: bookingData.drop || ""
    },
    metadata: { source: "move-payment.finalizeCapture", version: "3.0" },
    priority: "urgent",
    channel: options.channel || bookingData.channel || "multi_channel",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 5. booking.assigned — Fired when a driver/crew is assigned to a booking
 */
async function emitBookingAssignedTx(tx, db, bookingId, bookingData, driverData, nowMs = Date.now(), options = {}) {
  const event = outbox.createOutboxEvent({
    eventName: "booking.assigned",
    entityType: "booking",
    entityId: String(bookingId),
    division: bookingData.division || "logistics",
    payload: {
      bookingId: String(bookingId),
      bookingRef: bookingData.bookingRef || bookingId,
      customerName: bookingData.customerName || "Customer",
      customerEmail: bookingData.customerEmail || bookingData.email || "",
      customerPhone: bookingData.phone || "",
      driverUid: driverData.driverUid,
      driverName: driverData.name || "PackZen Driver",
      driverPhone: driverData.phone || "",
      vehicleNumber: driverData.vehicleNumber || null,
      date: bookingData.date || "",
      pickup: bookingData.pickup || ""
    },
    metadata: { source: "assignment.handleAssign", version: "3.0" },
    priority: "high",
    channel: options.channel || bookingData.channel || "whatsapp",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 6. booking.completed — Fired when service OTP is verified on-site
 */
async function emitBookingCompletedTx(tx, db, bookingId, bookingData, completionData = {}, nowMs = Date.now(), options = {}) {
  const event = outbox.createOutboxEvent({
    eventName: "booking.completed",
    entityType: "booking",
    entityId: String(bookingId),
    division: bookingData.division || "logistics",
    payload: {
      bookingId: String(bookingId),
      bookingRef: bookingData.bookingRef || bookingId,
      customerName: bookingData.customerName || "Customer",
      customerEmail: bookingData.customerEmail || bookingData.email || "",
      customerPhone: bookingData.phone || "",
      driverUid: bookingData.driverUid || completionData.driverUid || null,
      partnerPayout: Number(completionData.partnerPayout || 0),
      verifiedMethod: completionData.method || "otp",
      completedAtMs: nowMs
    },
    metadata: { source: "completion-otp.verifyCompletionOtp", version: "3.0" },
    priority: "high",
    channel: options.channel || bookingData.channel || "whatsapp",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 7. payment.received — Fired whenever any payment is captured (advance, balance, full)
 */
async function emitPaymentReceivedTx(tx, db, paymentId, paymentData, nowMs = Date.now(), options = {}) {
  const event = outbox.createOutboxEvent({
    eventName: "payment.received",
    entityType: "payment",
    entityId: String(paymentId),
    division: paymentData.division || "logistics",
    payload: {
      paymentId: String(paymentId),
      orderId: paymentData.orderId || null,
      bookingRef: paymentData.bookingRef || null,
      customerName: paymentData.customerName || "Customer",
      customerEmail: paymentData.customerEmail || paymentData.email || "",
      amount: Number(paymentData.amount || 0),
      currency: paymentData.currency || "INR",
      method: paymentData.method || "razorpay",
      paidAtMs: nowMs
    },
    metadata: { source: paymentData.source || "payment-webhook", version: "3.0" },
    priority: "urgent",
    channel: options.channel || paymentData.channel || "multi_channel",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 8. project.created — Fired when a PackZen Digital project milestone agreement is created
 */
async function emitProjectCreatedTx(tx, db, projectId, projectData, nowMs = Date.now()) {
  const event = outbox.createOutboxEvent({
    eventName: "project.created",
    entityType: "project",
    entityId: String(projectId),
    division: "digital",
    payload: {
      projectId: String(projectId),
      businessName: projectData.businessName || "Client Business",
      clientName: projectData.clientName || projectData.contactPerson || "",
      clientPhone: projectData.clientPhone || projectData.phone || "",
      clientEmail: projectData.clientEmail || projectData.email || "",
      totalAmount: Number(projectData.amount || 0),
      advancePaid: Number(projectData.advancePaid || 0),
      balanceDue: Number(projectData.balanceDue || 0),
      status: projectData.status || "discovery"
    },
    metadata: { source: "digital.createProject", version: "3.0" },
    priority: "high",
    channel: "email",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 9. project.milestone_updated — Fired when a digital project milestone is signed off or paid
 */
async function emitProjectMilestoneUpdatedTx(tx, db, projectId, milestoneData, nowMs = Date.now()) {
  const qualifier = String(milestoneData.qualifier || milestoneData.milestoneIndex || milestoneData.milestoneName || nowMs);
  const event = outbox.createOutboxEvent({
    eventName: "project.milestone_updated",
    entityType: "project",
    entityId: String(projectId),
    division: "digital",
    payload: {
      projectId: String(projectId),
      businessName: milestoneData.businessName || "",
      clientName: milestoneData.clientName || "",
      clientEmail: milestoneData.clientEmail || "",
      clientPhone: milestoneData.clientPhone || "",
      milestoneName: milestoneData.milestoneName || "Milestone",
      milestoneIndex: Number(milestoneData.milestoneIndex || 0),
      status: milestoneData.status || "in_progress",
      qualifier
    },
    metadata: { source: "digital.updateMilestone", version: "3.0" },
    priority: "normal",
    channel: "email",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 10. home_service.requested — Fired when an appliance or AC repair order is initiated
 */
async function emitHomeServiceRequestedTx(tx, db, serviceId, serviceData, nowMs = Date.now()) {
  const event = outbox.createOutboxEvent({
    eventName: "home_service.requested",
    entityType: "lead",
    entityId: String(serviceId),
    division: "home_services",
    payload: {
      serviceId: String(serviceId),
      serviceType: serviceData.service || "ac",
      serviceLabel: serviceData.serviceLabel || "Appliance Service",
      customerName: serviceData.name || "Customer",
      customerPhone: serviceData.phone || "",
      area: serviceData.area || "",
      scheduledDate: serviceData.date || null,
      notes: serviceData.notes || ""
    },
    metadata: { source: "catalog-booking.createServiceOrder", version: "3.0" },
    priority: "high",
    channel: "whatsapp",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 11. partner.assigned — Fired when a dispatch offer is officially assigned to a partner
 */
async function emitPartnerAssignedTx(tx, db, partnerId, bookingRef, partnerData, nowMs = Date.now()) {
  const event = outbox.createOutboxEvent({
    eventName: "partner.assigned",
    entityType: "partner",
    entityId: String(partnerId),
    division: partnerData.division || "logistics",
    payload: {
      partnerId: String(partnerId),
      partnerName: partnerData.name || "Partner",
      partnerPhone: partnerData.phone || "",
      bookingRef: String(bookingRef),
      pickup: partnerData.pickup || "",
      date: partnerData.date || "",
      qualifier: String(bookingRef)
    },
    metadata: { source: "assignment.handleAssign", version: "3.0" },
    priority: "high",
    channel: "whatsapp",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 12. lead.assigned — Fired when a lead is assigned to an advisor or sales manager
 */
async function emitLeadAssignedTx(tx, db, leadId, assignData, nowMs = Date.now()) {
  const event = outbox.createOutboxEvent({
    eventName: "lead.assigned",
    entityType: "lead",
    entityId: String(leadId),
    division: assignData.division || "logistics",
    payload: {
      leadId: String(leadId),
      advisorId: String(assignData.advisorId || "advisor"),
      advisorName: assignData.advisorName || "Assigned Advisor",
      advisorEmail: assignData.advisorEmail || "",
      customerName: assignData.customerName || "Customer",
      customerPhone: assignData.customerPhone || "",
      service: assignData.service || "Move",
      division: assignData.division || "logistics"
    },
    metadata: { source: "leads.assignAdvisor", version: "3.0" },
    priority: "high",
    channel: "email",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 13. lead.sla_breach — Fired when a lead sits uncontacted beyond SLA threshold
 */
async function emitLeadSlaBreachTx(tx, db, leadId, breachData, nowMs = Date.now()) {
  const event = outbox.createOutboxEvent({
    eventName: "lead.sla_breach",
    entityType: "lead",
    entityId: String(leadId),
    division: breachData.division || "logistics",
    payload: {
      leadId: String(leadId),
      customerName: breachData.customerName || "Customer",
      customerPhone: breachData.customerPhone || "",
      elapsedMinutes: Number(breachData.elapsedMinutes || 15),
      division: breachData.division || "logistics",
      service: breachData.service || "Move"
    },
    metadata: { source: "sla.monitor", version: "3.0" },
    priority: "urgent",
    channel: "email",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

/**
 * 14. daily.summary — Fired for owner executive daily briefing
 */
async function emitDailySummaryTx(tx, db, summaryId, summaryData, nowMs = Date.now()) {
  const event = outbox.createOutboxEvent({
    eventName: "daily.summary",
    entityType: "report",
    entityId: String(summaryId),
    division: summaryData.division || "overhead",
    payload: {
      date: summaryData.date || new Date().toISOString().slice(0, 10),
      totalLeads: Number(summaryData.totalLeads || 0),
      activeJobs: Number(summaryData.activeJobs || 0),
      grossCollections: Number(summaryData.grossCollections || 0),
      outstandingReceivables: Number(summaryData.outstandingReceivables || 0)
    },
    metadata: { source: "scheduler.dailySummary", version: "3.0" },
    priority: "normal",
    channel: "email",
    nowMs
  });
  return outbox.enqueueOutboxTx(tx, db, event);
}

module.exports = {
  emitLeadCreatedTx,
  emitLeadQualifiedTx,
  emitBookingCreatedTx,
  emitBookingConfirmedTx,
  emitBookingAssignedTx,
  emitBookingCompletedTx,
  emitPaymentReceivedTx,
  emitProjectCreatedTx,
  emitProjectMilestoneUpdatedTx,
  emitHomeServiceRequestedTx,
  emitPartnerAssignedTx,
  emitLeadAssignedTx,
  emitLeadSlaBreachTx,
  emitDailySummaryTx
};
