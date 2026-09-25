/**
 * ============================================================
 * PackZen — Pricing Engine v4.2.0 (Hardened, Universal Export)
 * ============================================================
 * Features:
 * - Real-world market-calibrated vehicle base fares
 * - Vehicle-specific per-KM rates & distance slabs
 * - Zone, traffic density, night shift & highway/interstate factors
 * - Specialized trade services (AC, Carpenter, Electrician, Crane, TV Mount)
 * - Packaging quality tiers (Standard, Premium Bubble, Wooden Crating)
 * - Zero-Commission Pass-Throughs (Tolls, Parking, Society Fees)
 * - Configurable Partner Commission Tier (Family/Brother 90% vs Standard 80%)
 *
 * v4.2.0 changelog (fixes the "price always ₹0" bug):
 * 1. ROOT CAUSE #1: v4.1 shipped with stray Markdown (a trailing ```
 *    fence + prose changelog) appended after the code. That is a
 *    JavaScript syntax error, so the browser never finished parsing
 *    the file — `window.PackZenPricing*` was never defined at all,
 *    every quote call hit the "engine not ready" guard, and the UI's
 *    ₹0 placeholder was left on screen. Fixed: file now ends in valid JS.
 * 2. ROOT CAUSE #2: the front-end (script.js) called
 *    `window.PackZenPricing.runPricingEngineV2(km)`, a function/global
 *    name that never existed in v4.x — the engine only ever exported
 *    `window.PackZenPricingV4.calculateQuote(rawInput)`. Fixed: this
 *    file now publishes itself as `window.PackZenPricing` (primary,
 *    matches every call site incl. the advisor dashboard) with a
 *    `window.PackZenPricingV4` alias kept for backward compatibility.
 * 3. Added `module.exports` so the same file runs unmodified under
 *    Node (tests, Cloud Functions) without throwing `ReferenceError`.
 * 4. Hardened validation: blank/null/undefined numeric fields now
 *    sanitize to safe defaults instead of producing NaN; the engine
 *    never throws — calculateQuote() always returns a well-formed
 *    { valid, errors, finalTotal } object even on garbage input.
 * 5. All currency outputs pass through a rupee-rounding helper so
 *    results are always whole rupees (no ₹2150.0000000000005).
 */

(function (root) {
  "use strict";

  const PRICING_CONFIG = Object.freeze({
    version: "4.2.0",
    minimumFare: 1999, // Floor price — never dispatch below this

    // Partner Commission Config: 10 for Family/Brother tier, 20 for Standard
    platformCommissionPercent: 10,

    // 1. VEHICLE CONFIG & VEHICLE-SPECIFIC DISTANCE RATES (Tier 1 Cities)
    vehicles: {
      tata_ace: {
        id: "tata_ace",
        name: "Tata Ace",
        baseFare: 1500,
        baseKmIncluded: 5,
        perKmRate: 24,
        capacity: 40,
        helpersIncluded: 1,
        freeWaitingTimeMins: 60,
        overtimeRatePerHour: 300
      },
      truck_14ft: {
        id: "truck_14ft",
        name: "14 ft Truck",
        baseFare: 2900,
        baseKmIncluded: 5,
        perKmRate: 32,
        capacity: 80,
        helpersIncluded: 2,
        freeWaitingTimeMins: 90,
        overtimeRatePerHour: 400
      },
      truck_17ft: {
        id: "truck_17ft",
        name: "17 ft Truck",
        baseFare: 4500,
        baseKmIncluded: 5,
        perKmRate: 40,
        capacity: 120,
        helpersIncluded: 3,
        freeWaitingTimeMins: 120,
        overtimeRatePerHour: 500
      },
      truck_22ft: {
        id: "truck_22ft",
        name: "22 ft Truck",
        baseFare: 6500,
        baseKmIncluded: 5,
        perKmRate: 52,
        capacity: 180,
        helpersIncluded: 4,
        freeWaitingTimeMins: 180,
        overtimeRatePerHour: 700
      }
    },

    // 2. DYNAMIC DISTANCE, ZONE & TIME MULTIPLIERS
    multipliers: {
      trafficZone: {
        normal: 1.0,
        denseTraffic: 1.15,
        highwayExpress: 0.90
      },
      timeOfDay: {
        daySlot: 1.0,
        nightShift: 1.20
      },
      interstateTax: 1.12
    },

    // 3. PACKAGING MATERIAL QUALITY TIERS
    packagingTiers: {
      basic: { name: "Standard Corrugated", ratePerUnit: 20 },
      premium: { name: "3-Layer Bubble Wrap & Film", ratePerUnit: 35 },
      ultraCrate: { name: "Wooden Crating & Waterproofing", ratePerUnit: 60 }
    },

    // 4. FURNITURE INVENTORY VOLUMETRICS (Unit Weights)
    furnitureUnits: {
      sofaCheck: 10, sofaCumBedCheck: 15, reclinerCheck: 12, tvCheck: 2, tvUnitCheck: 8,
      coffeeCheck: 3, centerTableCheck: 5, bookshelfCheck: 10, showcaseCheck: 12, shoeRackCheck: 4,
      bedCheck: 8, mattressCheck: 5, wardrobeCheck: 15, dressingCheck: 8, sideTableCheck: 2, studyTableCheck: 6,
      fridgeCheck: 8, wmCheck: 6, dishwasherCheck: 8, microwaveCheck: 2, ovenCheck: 4, chimneyCheck: 5,
      diningCheck: 8, waterPurifierCheck: 2, deskCheck: 8, chairCheck: 2, serverCheck: 15, printerCheck: 4,
      confCheck: 20, cabinetCheck: 10, bikeCheck: 10, cycleCheck: 5, gymCheck: 15, treadmillCheck: 15
    },

    heavyItemsList: ["sofaCheck", "sofaCumBedCheck", "bedCheck", "wardrobeCheck", "fridgeCheck", "showcaseCheck", "treadmillCheck"],
    cartonUnit: 1,

    // 5. FLOOR & ELEVATOR LOGIC
    floor: {
      withLift: 100,
      withoutLift: 300,
      heavyStairSurcharge: 180
    },

    labour: {
      pricePerHelper: 650
    },

    // 6. SPECIALIZED TRADE SERVICES
    specializedServices: {
      acUninstallation: 800,
      acInstallation: 1400,
      tvWallMountRemoval: 350,
      carpenterWork: 500,
      electricianWork: 450,
      craneRequirement: 3500
    },

    longCarry: { pricePerMeter: 15 },
    storage: { pricePerDay: 250 },

    discounts: { maxPromoFraction: 0.30 },
payment: { advancePercent: 10, fullPaymentDiscount: 200 }
  });

  /* ── HELPERS ── */

  // Sanitize any input into a finite, non-negative number (never NaN).
  function toSafeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : (fallback || 0);
  }

  function toSafeInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : (fallback || 0);
  }

  // Round to the nearest whole rupee — avoids floating point artifacts
  // like ₹2150.0000000000005 anywhere a currency value is produced.
  function toRupees(value) {
    return Math.round((Number(value) || 0) + Number.EPSILON);
  }

  /* ── INPUT VALIDATOR ── */

  function validateQuoteInputV4(rawInput) {
    const raw = rawInput && typeof rawInput === "object" ? rawInput : {};
    const errors = [];

    if (!raw.pickup || typeof raw.pickup !== "string" || !raw.pickup.trim()) {
      errors.push("Pickup location is required.");
    }
    if (!raw.drop || typeof raw.drop !== "string" || !raw.drop.trim()) {
      errors.push("Drop location is required.");
    }

    // Distance: blank / null / undefined / non-numeric all sanitize to 0
    // instead of throwing NaN — but a *negative* explicit value is still
    // flagged since that indicates a real upstream bug (e.g. bad Maps data).
    const kmRaw = raw.km;
    const kmIsBlank = kmRaw === "" || kmRaw === null || kmRaw === undefined;
    const km = kmIsBlank ? 0 : Number(kmRaw);
    if (!kmIsBlank && (isNaN(km) || km < 0)) {
      errors.push("Valid distance in kilometers is required.");
    }

    const vehicleId = raw.vehicleId && PRICING_CONFIG.vehicles[raw.vehicleId]
      ? raw.vehicleId
      : (raw.vehicleId ? null : "tata_ace");
    if (vehicleId === null) {
      errors.push(`Unknown vehicle type: ${raw.vehicleId}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      data: {
        ...raw,
        pickup: typeof raw.pickup === "string" ? raw.pickup.trim() : "",
        drop: typeof raw.drop === "string" ? raw.drop.trim() : "",
        km: Math.max(0, isNaN(km) ? 0 : km),
        vehicleId: vehicleId || "tata_ace",
        pickupFloor: toSafeInt(raw.pickupFloor, 0),
        dropFloor: toSafeInt(raw.dropFloor, 0),
        extraHelpers: toSafeInt(raw.extraHelpers, 0),
        longCarryDistance: toSafeNumber(raw.longCarryDistance, 0),

        // Pass-through out-of-pocket expenses (rounded to whole rupees)
        tollsEstimate: toRupees(toSafeNumber(raw.tollsEstimate, 0)),
        parkingEstimate: toRupees(toSafeNumber(raw.parkingEstimate, 0)),
        societyEntryFee: toRupees(toSafeNumber(raw.societyEntryFee, 0)),
        extraWaitingHours: toSafeNumber(raw.extraWaitingHours, 0),

        // Operational toggles
        trafficZone: (raw.trafficZone && PRICING_CONFIG.multipliers.trafficZone[raw.trafficZone]) ? raw.trafficZone : "normal",
        isNightShift: !!raw.isNightShift,
        isInterstate: !!raw.isInterstate,
        liftAvailable: !!raw.liftAvailable,
        isFreightLift: !!raw.isFreightLift,
        packingService: !!raw.packingService,
        packagingQuality: (raw.packagingQuality && PRICING_CONFIG.packagingTiers[raw.packagingQuality]) ? raw.packagingQuality : "basic",

        // Specialized trades
        acCount: toSafeInt(raw.acCount, 0),
        tvMountCount: toSafeInt(raw.tvMountCount, 0),
        needCarpenter: !!raw.needCarpenter,
        needElectrician: !!raw.needElectrician,
        needCrane: !!raw.needCrane,

        cartonQty: toSafeInt(raw.cartonQty, 0),
        promoDiscount: toSafeNumber(raw.promoDiscount, 0)
      }
    };
  }

  /* ── CORE CALCULATOR ENGINE ── */

  function calculateQuoteV4(rawInput) {
    try {
      const validation = validateQuoteInputV4(rawInput);
      if (!validation.valid) {
        return { valid: false, errors: validation.errors, finalTotal: 0 };
      }

      const d = validation.data;
      const warnings = [];
      const vehicle = PRICING_CONFIG.vehicles[d.vehicleId];

      // 1. Calculate Volumetric Inventory Units
      let totalUnits = 0;
      let heavyItemCount = 0;

      if (d.furniture && typeof d.furniture === "object") {
        for (const [id, qty] of Object.entries(d.furniture)) {
          const q = toSafeInt(qty, 0);
          if (q > 0) {
            totalUnits += q * (PRICING_CONFIG.furnitureUnits[id] || 0);
            if (PRICING_CONFIG.heavyItemsList.includes(id)) {
              heavyItemCount += q;
            }
          }
        }
      }
      totalUnits += d.cartonQty * PRICING_CONFIG.cartonUnit;

      // Auto-Upgrade Check for Truck Capacity — pick the smallest vehicle
      // (by capacity, ascending) that still fits the load.
      let selectedVehicle = vehicle;
      if (totalUnits > selectedVehicle.capacity) {
        const byCapacity = Object.values(PRICING_CONFIG.vehicles).sort((a, b) => a.capacity - b.capacity);
        const upgraded = byCapacity.find(v => v.capacity >= totalUnits);
        if (upgraded) {
          selectedVehicle = upgraded;
          warnings.push(`⚠️ Cargo volume (${totalUnits} units) exceeds ${vehicle.name}. Auto-upgraded to ${selectedVehicle.name}.`);
        } else {
          selectedVehicle = byCapacity[byCapacity.length - 1];
          warnings.push(`⚠️ Oversized cargo load (${totalUnits} units). Multiple trips or trucks required.`);
        }
      }

      // 2. Vehicle-Specific Distance Charge
      const baseFare = selectedVehicle.baseFare;
      const extraKm = Math.max(0, d.km - selectedVehicle.baseKmIncluded);
      let distanceCharge = extraKm * selectedVehicle.perKmRate;

      // Apply Traffic Corridor & Shift Multipliers to distance
      const zoneFactor = PRICING_CONFIG.multipliers.trafficZone[d.trafficZone] || 1.0;
      const shiftFactor = d.isNightShift ? PRICING_CONFIG.multipliers.timeOfDay.nightShift : 1.0;
      distanceCharge = toRupees(distanceCharge * zoneFactor * shiftFactor);

      if (d.isNightShift) warnings.push("🌙 Night shift operator allowance (+20% on transit) applied.");

      // 3. Labor & Crew Charges
      const totalHelpers = selectedVehicle.helpersIncluded + d.extraHelpers;
      const labourCharge = totalHelpers * PRICING_CONFIG.labour.pricePerHelper;

      // 4. Floor Handling & Stair Surcharge
      const totalFloors = d.pickupFloor + d.dropFloor;
      let floorCharge = 0;

      if (totalFloors > 0) {
        if (d.liftAvailable && !d.isFreightLift && heavyItemCount > 0) {
          const liftFee = totalFloors * PRICING_CONFIG.floor.withLift;
          const heavyStairFee = totalFloors * PRICING_CONFIG.floor.heavyStairSurcharge;
          floorCharge = liftFee + heavyStairFee;
          warnings.push("Notice: Passenger lift available, but heavy items incur stair carry fees.");
        } else if (d.liftAvailable) {
          floorCharge = totalFloors * PRICING_CONFIG.floor.withLift;
        } else {
          floorCharge = totalFloors * PRICING_CONFIG.floor.withoutLift;
        }
      }

      // 5. Packaging Quality Surcharge
      const pkgTier = PRICING_CONFIG.packagingTiers[d.packagingQuality] || PRICING_CONFIG.packagingTiers.basic;
      const packingCharge = d.packingService ? totalUnits * pkgTier.ratePerUnit : 0;

      // 6. Specialized Skilled Trade Charges
      let specializedTradeCharges = 0;
      if (d.acCount > 0) {
        specializedTradeCharges += d.acCount * (PRICING_CONFIG.specializedServices.acUninstallation + PRICING_CONFIG.specializedServices.acInstallation);
      }
      if (d.tvMountCount > 0) {
        specializedTradeCharges += d.tvMountCount * PRICING_CONFIG.specializedServices.tvWallMountRemoval;
      }
      if (d.needCarpenter) specializedTradeCharges += PRICING_CONFIG.specializedServices.carpenterWork;
      if (d.needElectrician) specializedTradeCharges += PRICING_CONFIG.specializedServices.electricianWork;
      if (d.needCrane) {
        specializedTradeCharges += PRICING_CONFIG.specializedServices.craneRequirement;
        warnings.push("🏗️ Balcony Crane service added for high-rise heavy lifting.");
      }

      // 7. On-Site Delays & Long Carry
      const waitingCharge = toRupees(d.extraWaitingHours * selectedVehicle.overtimeRatePerHour);
      const longCarryCharge = toRupees(d.longCarryDistance * PRICING_CONFIG.longCarry.pricePerMeter);

      // 8. Zero-Commission Operational Pass-Throughs (100% directly to Partner)
      const passThroughExpenses = d.tollsEstimate + d.parkingEstimate + d.societyEntryFee;

      // 9. Core Subtotal Calculation
      let serviceSubtotal = baseFare + distanceCharge + labourCharge + floorCharge +
                            packingCharge + specializedTradeCharges + waitingCharge + longCarryCharge;

      if (d.isInterstate) {
        serviceSubtotal = toRupees(serviceSubtotal * PRICING_CONFIG.multipliers.interstateTax);
      }

      // Apply Max Promo Discount (Cap at 30% of core service subtotal)
      const maxDiscount = Math.floor(serviceSubtotal * PRICING_CONFIG.discounts.maxPromoFraction);
      const cappedDiscount = Math.min(toSafeNumber(d.promoDiscount, 0), maxDiscount);

      const grandTotal = toRupees(Math.max((serviceSubtotal - cappedDiscount) + passThroughExpenses, PRICING_CONFIG.minimumFare));

      // 10. Partner Payout Engine & Pass-Through Separation
      // CRITICAL TRUST RULE: Pass-through expenses (Tolls/Parking/Society) have ZERO platform commission.
      const commissionableTotal = grandTotal - passThroughExpenses;
      const platformCommission = toRupees(commissionableTotal * (PRICING_CONFIG.platformCommissionPercent / 100));
      const partnerPayout = toRupees((commissionableTotal - platformCommission) + passThroughExpenses);
const advanceAmount = toRupees(grandTotal * (PRICING_CONFIG.payment.advancePercent / 100));
      const fullOnlineAmount = toRupees(Math.max(grandTotal - PRICING_CONFIG.payment.fullPaymentDiscount, 0));

      return {
        valid: true,
        warnings,
        finalTotal: grandTotal,
        breakdown: {
          vehicleUsed: selectedVehicle.name,
          vehicleId: selectedVehicle.id,
          baseFare,
          distanceCharge,
          labourCharge,
          floorCharge,
          packingCharge,
          specializedTradeCharges,
          waitingCharge,
          longCarryCharge,
          passThroughExpenses,
          discount: cappedDiscount,
          grandTotal
        },
        financials: {
          customerPays: grandTotal,
          partnerEarns: partnerPayout,
          packZenMargin: platformCommission,
          partnerTakePercent: grandTotal > 0 ? Math.round((partnerPayout / grandTotal) * 100) : 0
        },
     paymentOptions: {
  grandTotal,
  advanceAmount,
  fullOnlineAmount,
  atDropAmount: grandTotal - advanceAmount   // balance owed only if Advance was already paid online
},
        capacityDetail: {
          totalUnits,
          vehicleCapacity: selectedVehicle.capacity,
          utilizationPercent: Math.round((totalUnits / selectedVehicle.capacity) * 100)
        },
        km: Math.round(d.km)
      };
    } catch (err) {
      // The engine must never throw into the UI — surface a clean error instead.
      return {
        valid: false,
        errors: ["Something went wrong while calculating your quote. Please try again."],
        finalTotal: 0,
        _internalError: String(err && err.message || err)
      };
    }
  }

  /* ── PUBLIC API (Universal Export) ── */

  const PackZenPricing = {
    version: PRICING_CONFIG.version,
    config: PRICING_CONFIG,
    vehicles: PRICING_CONFIG.vehicles, // convenience alias — used by the advisor dashboard
    calculateQuote: calculateQuoteV4,
    validateInput: validateQuoteInputV4
  };

  // Node.js / CommonJS (tests, Cloud Functions)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = PackZenPricing;
  }

  // Browser — expose under the name every call site in the app actually
  // uses (`window.PackZenPricing`), plus a `PackZenPricingV4` alias for
  // anything still referring to the old name.
  if (typeof root !== "undefined") {
    root.PackZenPricing = PackZenPricing;
    root.PackZenPricingV4 = PackZenPricing;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
