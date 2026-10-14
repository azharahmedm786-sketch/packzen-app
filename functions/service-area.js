/**
 * PackZen — Bangalore service area (pure, no Firebase).
 *
 * Approved rule: all services are Bangalore-only for now.
 *   - Home / appliance services: the service address must be in the area.
 *   - Moving / transport: the PICKUP must be in the area; the destination may be anywhere.
 *   - Parcel / single-item delivery: pickup AND drop must be in the area.
 *
 * "In the area" = any 560xxx pincode, plus the approved outskirts below.
 * To add a locality, add its pincode to EXTRA_PINCODES.
 */
"use strict";

const EXTRA_PINCODES = {
  "562114": "Hoskote",
  "562106": "Anekal",
  "562110": "Devanahalli",
  "562125": "Sarjapur",
  "562107": "Attibele",
};

const AREA_MESSAGE = "PackZen currently serves Bangalore only (560xxx pincodes, plus Hoskote, Anekal, Devanahalli, Sarjapur and Attibele).";

// Last Indian-style 6-digit pincode in the text (addresses end with the pincode).
function extractPincode(text) {
  const m = String(text || "").match(/(?:^|[^\d])([1-9]\d{5})(?!\d)/g);
  if (!m) return null;
  return m[m.length - 1].replace(/\D/g, "");
}

function isAllowedPincode(pin) {
  return typeof pin === "string" && (/^560\d{3}$/.test(pin) || Object.prototype.hasOwnProperty.call(EXTRA_PINCODES, pin));
}

/**
 * @param {...string} texts address strings, most reliable first (e.g. Google's
 *        formatted address, then what the customer typed). The first one that
 *        contains a pincode decides.
 * @returns {{ok:boolean, pincode:string|null, reason:string}}
 */
function checkAddress(...texts) {
  for (const t of texts) {
    const pin = extractPincode(t);
    if (pin) {
      return isAllowedPincode(pin)
        ? { ok: true, pincode: pin, reason: "pincode" }
        : { ok: false, pincode: pin, reason: "outside" };
    }
  }
  // No pincode anywhere: accept only if the address clearly names Bangalore.
  const all = texts.filter(Boolean).join(" ");
  if (/\b(bengaluru|bangalore)\b/i.test(all)) return { ok: true, pincode: null, reason: "city_name" };
  return { ok: false, pincode: null, reason: "unknown" };
}

function messageFor(result, what) {
  if (result.reason === "unknown") return `Please include the ${what} pincode (for example 560034) so we can confirm it's in our service area.`;
  return `Sorry, ${result.pincode ? "pincode " + result.pincode : "this " + what} is outside our service area. ` + AREA_MESSAGE;
}

module.exports = { EXTRA_PINCODES, AREA_MESSAGE, extractPincode, isAllowedPincode, checkAddress, messageFor };
