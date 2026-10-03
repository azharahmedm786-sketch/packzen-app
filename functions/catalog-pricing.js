/**
 * PackZen — catalog cart pricing & validation (pure functions, no Firebase).
 * ---------------------------------------------------------------
 * The browser only ever sends WHICH catalog items and HOW MANY. Prices are
 * read from Firestore on the server and priced here, so a tampered client
 * cannot change what gets charged (same principle as pricing-engine-v2.js).
 *
 * Kept free of firebase imports so it can be unit-tested directly.
 */
"use strict";

const TYPES = ["services", "packages", "addons"];
const SLOTS = { morning: "Morning (8am – 12pm)", afternoon: "Afternoon (12pm – 4pm)", evening: "Evening (4pm – 8pm)" };
const MAX_LINES = 20;
const MAX_ONLINE_AMOUNT = 100000; // ₹ — same ceiling as the existing move flow

function qtyLimit(item) {
  return item.pricingUnit === "per_carton" ? 500 : 20;
}

/**
 * @param {{categories:Object, services:Object, packages:Object, addons:Object}} catalog
 *        each value is a map of id → Firestore document data
 * @param {Array<{type:string,id:string,qty?:number}>} rawItems
 * @returns {{ok:boolean, errors:string[], lines:Array, payableNow:number,
 *            estimatedTotal:number, hasQuoteItems:boolean, hasEstimateItems:boolean,
 *            onlineEligible:boolean}}
 */
function priceCart(catalog, rawItems) {
  const errors = [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail("Your selection is empty.");
  }
  if (rawItems.length > MAX_LINES) {
    return fail("Too many items selected (max " + MAX_LINES + ").");
  }

  // Merge duplicate lines (same type + id) so quantities can't dodge limits.
  const merged = new Map();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") { errors.push("Invalid item."); continue; }
    const type = raw.type;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!TYPES.includes(type) || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) {
      errors.push("Invalid item reference."); continue;
    }
    const qty = raw.qty === undefined ? 1 : Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1) { errors.push("Invalid quantity for " + id + "."); continue; }
    const key = type + "/" + id;
    merged.set(key, { type, id, qty: (merged.has(key) ? merged.get(key).qty : 0) + qty });
  }
  if (errors.length) return { ok: false, errors, lines: [], payableNow: 0, estimatedTotal: 0, hasQuoteItems: false, hasEstimateItems: false, onlineEligible: false };

  const lines = [];
  let payableNow = 0;
  let estimatedTotal = 0;
  let hasQuoteItems = false;
  let hasEstimateItems = false;

  for (const { type, id, qty } of merged.values()) {
    const item = catalog[type] && catalog[type][id];
    if (!item || item.isActive !== true) { errors.push("“" + id + "” is no longer available."); continue; }

    const cat = catalog.categories && catalog.categories[item.categoryId];
    if (!cat || cat.isActive !== true) { errors.push("“" + (item.name || id) + "” is no longer available."); continue; }

    if (qty > qtyLimit(item)) { errors.push("Quantity too high for “" + item.name + "”."); continue; }

    const unit = item.pricingUnit || "fixed";
    const price = Number(item.basePrice);
    const isQuote = unit === "quote" || !isFinite(price) || price <= 0;

    const line = {
      type, id, qty,
      name: String(item.name || id),
      categoryId: item.categoryId,
      pricingUnit: unit,
      unitPrice: isQuote ? 0 : Math.round(price),
      lineTotal: 0,
      kind: "fixed", // "fixed" = charge as-is, "estimate" = starting-from, "quote" = priced on enquiry
    };

    if (isQuote) {
      line.kind = "quote";
      hasQuoteItems = true;
    } else {
      line.lineTotal = line.unitPrice * qty;
      estimatedTotal += line.lineTotal;
      if (unit === "starting_from") { line.kind = "estimate"; hasEstimateItems = true; }
      else payableNow += line.lineTotal;
    }
    lines.push(line);
  }

  if (errors.length) return { ok: false, errors, lines: [], payableNow: 0, estimatedTotal: 0, hasQuoteItems: false, hasEstimateItems: false, onlineEligible: false };

  // Online payment is only allowed when EVERY line has a definite price.
  const onlineEligible = !hasQuoteItems && !hasEstimateItems && payableNow >= 1 && payableNow <= MAX_ONLINE_AMOUNT;

  return { ok: true, errors: [], lines, payableNow, estimatedTotal, hasQuoteItems, hasEstimateItems, onlineEligible };

  function fail(msg) {
    return { ok: false, errors: [msg], lines: [], payableNow: 0, estimatedTotal: 0, hasQuoteItems: false, hasEstimateItems: false, onlineEligible: false };
  }
}

/** Today's date (YYYY-MM-DD) in India, regardless of server timezone. */
function todayIST(now) {
  const d = now || new Date();
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(ymd, days) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Validates and normalises customer-supplied booking details.
 * @returns {{ok:boolean, errors:string[], value:Object}}
 */
function validateDetails(details, now) {
  const errors = [];
  const d = details && typeof details === "object" ? details : {};
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const customerName = str(d.customerName, 80);
  if (customerName.length < 2) errors.push("Please enter your name.");

  let phone = str(d.phone, 20).replace(/[\s()-]/g, "");
  phone = phone.replace(/^\+?91/, "");
  if (!/^[6-9]\d{9}$/.test(phone)) errors.push("Enter a valid 10-digit Indian mobile number.");

  const email = str(d.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push("Enter a valid email address or leave it blank.");

  const address = str(d.address, 300);
  if (address.length < 8) errors.push("Please enter the full service address.");

  const date = str(d.date, 10);
  const today = todayIST(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + "T00:00:00Z"))) {
    errors.push("Choose a service date.");
  } else if (date < today) {
    errors.push("The service date cannot be in the past.");
  } else if (date > addDays(today, 180)) {
    errors.push("Please choose a date within the next 6 months.");
  }

  const slot = str(d.timeSlot, 20);
  if (!SLOTS[slot]) errors.push("Choose a time slot.");

  const notes = str(d.notes, 500);

  return {
    ok: errors.length === 0,
    errors,
    value: { customerName, phone, email, address, date, timeSlot: slot, timeSlotLabel: SLOTS[slot] || "", notes },
  };
}

function validRequestId(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

module.exports = { priceCart, validateDetails, validRequestId, todayIST, SLOTS, MAX_ONLINE_AMOUNT };
