/**
 * PackZen — pricing integrity guards (shared by createBooking and the paid move flow).
 *
 * 1. Distance is server-authoritative. If Google Maps can't measure the route we
 *    refuse to price, instead of silently pricing the move at 0 km.
 * 2. The booking records the exact engine input it was priced from (`pricedInput`),
 *    so ops / drivers can see what the customer actually paid for even if the
 *    free-text display fields (house, vehicle label, floors label) disagree.
 */
"use strict";

class PricingGuardError extends Error {}

function requireServerDistance(computedKm) {
  const km = Number(computedKm);
  if (!isFinite(km) || km <= 0) {
    throw new PricingGuardError("Could not calculate distance server-side. Please check the pickup and drop addresses.");
  }
  return Math.round(km * 100) / 100;
}

const PRICED_KEYS = [
  "vehicleId", "km", "pickupFloor", "dropFloor", "liftAvailable", "isFreightLift",
  "packingService", "packagingQuality", "extraHelpers", "cartonQty", "furniture",
  "isNightShift", "trafficZone", "isInterstate", "acCount", "tvMountCount",
  "needCarpenter", "needElectrician", "needCrane", "promoCode",
];

function pricedInputSnapshot(quoteInput, quote) {
  const out = {};
  for (const k of PRICED_KEYS) {
    if (quoteInput && quoteInput[k] !== undefined) out[k] = quoteInput[k];
  }
  // The engine may auto-upgrade the vehicle for the load; record what was priced.
  if (quote && quote.breakdown && quote.breakdown.vehicleId) out.pricedVehicleId = quote.breakdown.vehicleId;
  return JSON.parse(JSON.stringify(out)); // plain data only (no undefined) for Firestore
}

module.exports = { requireServerDistance, pricedInputSnapshot, PricingGuardError, PRICED_KEYS };
