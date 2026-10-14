/**
 * PackZen — parcel delivery pricing & validation (pure, no Firebase).
 *
 * Approved launch rates (two-wheeler, up to 20 kg, pickup AND drop in Bangalore):
 *   ₹49 base (covers first 2 km) + ₹11 per km after that (each started km)
 *   +₹30 if the parcel is over 10 kg; max 20 kg; max 40 km; online payment only.
 * Distance always comes from the server (Google Maps), never the browser.
 */
"use strict";
const serviceArea = require("./service-area");

const PARCEL = Object.freeze({
  baseFare: 49, includedKm: 2, perKm: 11,
  heavyFromKg: 10, heavySurcharge: 30, maxKg: 20, maxKm: 40,
  vehicle: "two_wheeler",
});
const SLOTS = { morning: "Morning (8am – 12pm)", afternoon: "Afternoon (12pm – 4pm)", evening: "Evening (4pm – 8pm)" };

class ParcelError extends Error {}

function priceParcel(km, weightKg) {
  const d = Number(km), w = Number(weightKg);
  if (!isFinite(d) || d <= 0) throw new ParcelError("We couldn't measure the route between these addresses. Please check them.");
  if (d > PARCEL.maxKm) throw new ParcelError(`Parcel delivery covers up to ${PARCEL.maxKm} km. This route is ${Math.round(d)} km — please book a move instead.`);
  if (!isFinite(w) || w <= 0 || w > PARCEL.maxKg) throw new ParcelError(`Parcels must weigh between 0.1 and ${PARCEL.maxKg} kg.`);
  const extraKm = Math.max(0, Math.ceil(Math.round(d * 10) / 10 - PARCEL.includedKm));
  const distanceCharge = extraKm * PARCEL.perKm;
  const weightCharge = w > PARCEL.heavyFromKg ? PARCEL.heavySurcharge : 0;
  const total = PARCEL.baseFare + distanceCharge + weightCharge;
  return { total, breakdown: { baseFare: PARCEL.baseFare, includedKm: PARCEL.includedKm, extraKm, distanceCharge, weightCharge, km: Math.round(d * 10) / 10, weightKg: w, vehicle: PARCEL.vehicle } };
}

function todayIST(now) {
  const t = new Date((now ? now.getTime() : Date.now()) + 5.5 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
function addDays(ymd, n) { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function validateParcelDetails(details, now) {
  const errors = [];
  const d = details && typeof details === "object" ? details : {};
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  // Strip a +91/91 country code only when it's actually there (12 digits) — a
  // 10-digit number that happens to start with 91 must stay intact.
  const phoneOf = (v) => { const x = str(v, 20).replace(/[\s()-]/g, "").replace(/^\+/, ""); return x.length === 12 && x.startsWith("91") ? x.slice(2) : x; };

  const senderName = str(d.senderName, 80);
  if (senderName.length < 2) errors.push("Please enter the sender's name.");
  const senderPhone = phoneOf(d.senderPhone);
  if (!/^[6-9]\d{9}$/.test(senderPhone)) errors.push("Enter a valid 10-digit sender mobile number.");
  const receiverName = str(d.receiverName, 80);
  if (receiverName.length < 2) errors.push("Please enter the receiver's name.");
  const receiverPhone = phoneOf(d.receiverPhone);
  if (!/^[6-9]\d{9}$/.test(receiverPhone)) errors.push("Enter a valid 10-digit receiver mobile number.");

  const pickup = str(d.pickup, 300);
  const drop = str(d.drop, 300);
  if (pickup.length < 8) errors.push("Please enter the full pickup address.");
  if (drop.length < 8) errors.push("Please enter the full drop address.");

  const itemDescription = str(d.itemDescription, 120);
  if (itemDescription.length < 3) errors.push("Tell us what you're sending (e.g. documents, clothes, a small box).");
  const weightKg = Math.round(Number(d.weightKg) * 10) / 10;
  if (!isFinite(weightKg) || weightKg <= 0 || weightKg > PARCEL.maxKg) errors.push(`Parcel weight must be between 0.1 and ${PARCEL.maxKg} kg.`);

  const date = str(d.date, 10);
  const today = todayIST(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + "T00:00:00Z"))) errors.push("Choose a pickup date.");
  else if (date < today) errors.push("The pickup date cannot be in the past.");
  else if (date > addDays(today, 30)) errors.push("Please choose a pickup date within the next 30 days.");
  const slot = str(d.timeSlot, 20);
  if (!SLOTS[slot]) errors.push("Choose a pickup time slot.");
  const notes = str(d.notes, 300);

  return { ok: errors.length === 0, errors,
    value: { senderName, senderPhone, receiverName, receiverPhone, pickup, drop, itemDescription, weightKg, date, timeSlot: slot, timeSlotLabel: SLOTS[slot] || "", notes } };
}

/** Both ends must be in the service area (Google's formatted address first, then the typed one). */
function checkParcelArea(route, details) {
  const p = serviceArea.checkAddress(route.originAddress, details.pickup);
  if (!p.ok) return { ok: false, error: serviceArea.messageFor(p, "pickup") };
  const q = serviceArea.checkAddress(route.destinationAddress, details.drop);
  if (!q.ok) return { ok: false, error: serviceArea.messageFor(q, "drop") };
  return { ok: true, pickupPincode: p.pincode, dropPincode: q.pincode };
}

module.exports = { PARCEL, SLOTS, ParcelError, priceParcel, validateParcelDetails, checkParcelArea, todayIST };
