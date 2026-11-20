/**
 * PACKZEN 3.0 — WhatsApp Message Template Registry
 * ------------------------------------------------------------------
 * Centralized registry mapping outbox event types to Meta-approved
 * WhatsApp Cloud API templates. Defines approved languages, parameter
 * contracts, recipient roles, and consent categories.
 */
"use strict";

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return "Rs. " + num.toLocaleString("en-IN");
}

const TEMPLATE_REGISTRY = {
  // 1. Lead Enquiry Acknowledgement
  "lead.created": {
    templateName: "packzen_lead_received",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "customer",
    requiresAffirmativeConsent: false, // Transactional response to incoming customer enquiry
    requiredFields: ["name", "service"],
    getRecipientPhone: (p) => p.phone || p.customerPhone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.name || "Customer").slice(0, 50) },
          { type: "text", text: String(p.serviceLabel || p.service || "Moving & Packing").slice(0, 50) },
          { type: "text", text: String(p.area || "Bengaluru").slice(0, 50) }
        ]
      }
    ]
  },

  // 2. New Booking Created (Pay Later / Booking Summary)
  "booking.created": {
    templateName: "packzen_booking_created",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "customer",
    requiresAffirmativeConsent: false, // Essential order utility
    requiredFields: ["bookingRef", "customerName", "date"],
    getRecipientPhone: (p) => p.phone || p.customerPhone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.customerName || "Customer").slice(0, 50) },
          { type: "text", text: String(p.bookingRef || p.bookingId).slice(0, 40) },
          { type: "text", text: String(p.date || "Scheduled Date").slice(0, 30) },
          { type: "text", text: formatCurrency(p.total) },
          { type: "text", text: p.paymentType === "pay_later" ? "Pay on Delivery" : "Online Advance" }
        ]
      }
    ]
  },

  // 3. Booking Confirmed (Advance Captured)
  "booking.confirmed": {
    templateName: "packzen_booking_confirmed",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "customer",
    requiresAffirmativeConsent: false,
    requiredFields: ["bookingRef", "customerName", "date"],
    getRecipientPhone: (p) => p.phone || p.customerPhone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.customerName || "Customer").slice(0, 50) },
          { type: "text", text: String(p.bookingRef || p.bookingId).slice(0, 40) },
          { type: "text", text: String(p.date || "Scheduled Date").slice(0, 30) },
          { type: "text", text: formatCurrency(p.paidAmount || p.total) },
          { type: "text", text: formatCurrency(p.balanceDue || 0) }
        ]
      }
    ]
  },

  // 4. Payment Receipt
  "payment.received": {
    templateName: "packzen_payment_receipt",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "customer",
    requiresAffirmativeConsent: false,
    requiredFields: ["paymentId", "amount"],
    getRecipientPhone: (p) => p.phone || p.customerPhone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.customerName || "Customer").slice(0, 50) },
          { type: "text", text: formatCurrency(p.amount) },
          { type: "text", text: String(p.paymentId).slice(0, 40) },
          { type: "text", text: String(p.bookingRef || "PackZen Move").slice(0, 40) }
        ]
      }
    ]
  },

  // 5. Driver Assigned Notification
  "booking.assigned": {
    templateName: "packzen_driver_assigned",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "customer",
    requiresAffirmativeConsent: false,
    requiredFields: ["bookingRef", "driverName"],
    getRecipientPhone: (p) => p.customerPhone || p.phone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.customerName || "Customer").slice(0, 50) },
          { type: "text", text: String(p.bookingRef || p.bookingId).slice(0, 40) },
          { type: "text", text: String(p.driverName || "PackZen Driver").slice(0, 50) },
          { type: "text", text: String(p.driverPhone || "Will call on arrival").slice(0, 20) },
          { type: "text", text: String(p.date || "Scheduled Date").slice(0, 30) }
        ]
      }
    ]
  },

  // 6. Booking Completed
  "booking.completed": {
    templateName: "packzen_booking_completed",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "customer",
    requiresAffirmativeConsent: false,
    requiredFields: ["bookingRef"],
    getRecipientPhone: (p) => p.customerPhone || p.phone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.customerName || "Customer").slice(0, 50) },
          { type: "text", text: String(p.bookingRef || p.bookingId).slice(0, 40) },
          { type: "text", text: "https://packzenblr.in" }
        ]
      }
    ]
  },

  // 7. Home Service Requested
  "home_service.requested": {
    templateName: "packzen_service_requested",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "customer",
    requiresAffirmativeConsent: false,
    requiredFields: ["serviceLabel"],
    getRecipientPhone: (p) => p.customerPhone || p.phone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.customerName || "Customer").slice(0, 50) },
          { type: "text", text: String(p.serviceLabel || "Appliance Service").slice(0, 50) },
          { type: "text", text: String(p.area || "Bengaluru").slice(0, 50) },
          { type: "text", text: String(p.scheduledDate || "Scheduled Date").slice(0, 30) }
        ]
      }
    ]
  },

  // 8. Partner Assigned Dispatch Notification
  "partner.assigned": {
    templateName: "packzen_partner_dispatch",
    category: "UTILITY",
    language: "en",
    eligible: true,
    recipientRole: "partner",
    requiresAffirmativeConsent: false, // Operational order dispatch to onboarded partner
    requiredFields: ["bookingRef"],
    getRecipientPhone: (p) => p.partnerPhone || p.phone,
    buildComponents: (p) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(p.partnerName || "Partner").slice(0, 50) },
          { type: "text", text: String(p.bookingRef).slice(0, 40) },
          { type: "text", text: String(p.pickup || "Pickup Location").slice(0, 50) },
          { type: "text", text: String(p.date || "Scheduled Date").slice(0, 30) }
        ]
      }
    ]
  },

  // 9. Digital Project Created (Email only — WhatsApp ineligible)
  "project.created": {
    templateName: null,
    category: null,
    eligible: false,
    ineligibleReason: "DIGITAL_PROJECT_EMAIL_ONLY"
  },

  // 10. Digital Milestone Updated (Email only — WhatsApp ineligible)
  "project.milestone_updated": {
    templateName: null,
    category: null,
    eligible: false,
    ineligibleReason: "DIGITAL_MILESTONE_EMAIL_ONLY"
  }
};

/**
 * Retrieves the template configuration for a given event name.
 */
function getTemplateConfig(eventName) {
  return TEMPLATE_REGISTRY[eventName] || null;
}

module.exports = {
  TEMPLATE_REGISTRY,
  getTemplateConfig,
  formatCurrency
};
