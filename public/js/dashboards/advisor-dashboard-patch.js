/* ============================================================
   PackZen Advisor Dashboard — COMPLETION PATCH
   Load this AFTER the existing inline <script> in the advisor
   dashboard HTML (i.e. just before </body>).
   It does NOT redefine anything that already works — it only
   supplies the functions your HTML already calls but that were
   never implemented, plus the Assign Driver modal wiring that
   your table buttons already reference.
   ============================================================ */

/* ------------------------------------------------------------
   0. GOOGLE MAPS — required for the New Booking distance calc.
   The dashboard never loaded Maps at all. We load it once,
   reusing the same key already sitting in window.ENV
   (env-config.js is loaded before this file runs).
   ------------------------------------------------------------ */
(function loadAdvisorMaps() {
  if (window.google && window.google.maps) return;
  if (!window.ENV || !window.ENV.GOOGLE_MAPS_KEY) {
    console.error("❌ GOOGLE_MAPS_KEY missing from env-config.js — New Booking distance calc will fall back to a flat estimate.");
    return;
  }
  const s = document.createElement("script");
  s.src = "https://maps.googleapis.com/maps/api/js?key=" + window.ENV.GOOGLE_MAPS_KEY + "&libraries=places";
  s.async = true; s.defer = true;
  document.head.appendChild(s);
})();

/* ------------------------------------------------------------
   1. LOCAL SIZE / VEHICLE CONFIG for the New Booking form.
   Mirrors MOVE_TYPE_CONFIG in script.js exactly (same house
   values) so the pricing engine keys line up (2500/4500/6500/
   8500/10500/13500 for home, 6500/10500/16500/25500 office).
   Vehicles are pulled live from window.PackZenPricing so we
   never hardcode a second copy of vehicle prices.
   ------------------------------------------------------------ */
const NB_MOVE_TYPE_CONFIG = {
  home: {
    sizeLabel: "House Type",
    sizes: [
      { icon:"🏠", label:"1 RK",  sub:"Studio",   value:"2500"  },
      { icon:"🏡", label:"1 BHK", sub:"Small",    value:"4500"  },
      { icon:"🏘️", label:"2 BHK", sub:"Medium",   value:"6500"  },
      { icon:"🏰", label:"3 BHK", sub:"Large",    value:"8500"  },
      { icon:"🏯", label:"4 BHK", sub:"X-Large",  value:"10500" },
      { icon:"🌇", label:"Villa", sub:"Premium",  value:"13500" }
    ]
  },
  office: {
    sizeLabel: "Office Size",
    sizes: [
      { icon:"💼", label:"Cabin",  sub:"1–5 desks",   value:"6500"  },
      { icon:"🏢", label:"Small",  sub:"5–15 desks",  value:"10500" },
      { icon:"🏬", label:"Medium", sub:"15–30 desks", value:"16500" },
      { icon:"🏭", label:"Large",  sub:"30+ desks",   value:"25500" }
    ]
  },
  single: {
    sizeLabel: "Item Type",
    sizes: [
      { icon:"🛋️", label:"Furniture", sub:"Sofa, bed…",  value:"0"   },
      { icon:"🧊", label:"Appliance", sub:"Fridge, AC…", value:"0"   },
      { icon:"🏍️", label:"Bike/Cycle",sub:"Two-wheeler", value:"500" },
      { icon:"📦", label:"Boxes",     sub:"Cartons",     value:"0"   }
    ]
  }
};

/* ------------------------------------------------------------
   2. STATE for the New Booking module (kept separate from the
   dashboard's own vars so nothing collides).
   ------------------------------------------------------------ */
let nbMoveType        = null;
let nbHouseValue      = "0";
let nbVehicleHtml     = "0";
let nbPickupPlace     = null;
let nbDropPlace       = null;
let nbLastKm          = 0;
let nbSelectedPay     = "pay_later";
let nbPromoAmount     = 0;
let nbLastQuote       = null;
const NB_DRAFT_KEY    = "packzen_advisor_draft";

/* ------------------------------------------------------------
   3. INIT — called by showSection('newbooking', ...) which
   already exists in the dashboard and already calls nbInit().
   ------------------------------------------------------------ */
function nbInit() {
  // Populate driver dropdown from allDrivers (loaded by loadAll()).
  const drvSel = document.getElementById("nbDriver");
  if (drvSel) {
    drvSel.innerHTML = '<option value="">Unassigned</option>' +
      (typeof allDrivers !== "undefined" ? allDrivers : []).map(d =>
        `<option value="${d.id}">${(d.name || d.email || "Driver")}</option>`
      ).join("");
  }

  // Wire pickup/drop autocomplete once Maps is ready.
  nbWaitForMaps(() => nbInitAutocomplete());

  // Show draft-recovery banner if a draft exists and the form is empty.
  const draft = nbLoadDraft();
  const banner = document.getElementById("nbDraftBanner");
  const nameEl = document.getElementById("nbName");
  if (draft && banner && nameEl && !nameEl.value.trim()) {
    banner.style.display = "flex";
  }

  if (!nbMoveType) nbRenderVehicleGrid(); // shows placeholder text until a type is picked
}

function nbWaitForMaps(cb, tries) {
  tries = tries || 0;
  if (window.google && window.google.maps) { cb(); return; }
  if (tries > 40) return; // give up quietly after ~8s
  setTimeout(() => nbWaitForMaps(cb, tries + 1), 200);
}

function nbInitAutocomplete() {
  const pickupInput = document.getElementById("nbPickup");
  const dropInput   = document.getElementById("nbDrop");
  if (!pickupInput || !dropInput) return;

  const pickupAuto = new google.maps.places.Autocomplete(pickupInput);
  const dropAuto    = new google.maps.places.Autocomplete(dropInput);

  pickupInput.addEventListener("input", () => { nbPickupPlace = null; });
  dropInput.addEventListener("input", () => { nbDropPlace = null; });

  pickupAuto.addListener("place_changed", () => {
    const place = pickupAuto.getPlace();
    if (!place.geometry) { toast("⚠️ Select pickup address from the dropdown"); return; }
    nbPickupPlace = place;
    nbSaveDraft();
    nbCalc();
  });
  dropAuto.addListener("place_changed", () => {
    const place = dropAuto.getPlace();
    if (!place.geometry) { toast("⚠️ Select drop address from the dropdown"); return; }
    nbDropPlace = place;
    nbSaveDraft();
    nbCalc();
  });
}

/* ------------------------------------------------------------
   4. MOVE TYPE / SIZE / VEHICLE / FURNITURE GRIDS
   ------------------------------------------------------------ */
function nbSelectMoveType(type) {
  nbMoveType = type;
  document.querySelectorAll("#nbTypeGrid .nb-type-card").forEach(c =>
    c.classList.toggle("selected", c.dataset.type === type)
  );
  const label = document.getElementById("nbSizeLabel");
  const cfg = NB_MOVE_TYPE_CONFIG[type] || NB_MOVE_TYPE_CONFIG.home;
  if (label) label.textContent = cfg.sizeLabel;
  nbRenderSizeGrid(type);
  nbRenderVehicleGrid();
  nbRenderFurnitureGrid();
  nbSaveDraft();
  nbCalc();
}

function nbRenderSizeGrid(type) {
  const grid = document.getElementById("nbSizeGrid");
  if (!grid) return;
  const cfg = NB_MOVE_TYPE_CONFIG[type] || NB_MOVE_TYPE_CONFIG.home;
  nbHouseValue = "0";
  grid.innerHTML = cfg.sizes.map(s =>
    `<div class="nb-select-card" data-house-value="${s.value}">${s.icon}<br>${s.label}<br><small style="opacity:.6">${s.sub}</small></div>`
  ).join("");
  grid.querySelectorAll(".nb-select-card").forEach(card => {
    card.addEventListener("click", function () {
      grid.querySelectorAll(".nb-select-card").forEach(c => c.classList.remove("selected"));
      this.classList.add("selected");
      nbHouseValue = this.dataset.houseValue;
      nbCalc();
    });
  });
}

function nbRenderVehicleGrid() {
  const grid = document.getElementById("nbVehicleGrid");
  const card = document.getElementById("nbVehicleCard");
  if (!grid) return;
  if (!nbMoveType) { grid.innerHTML = '<span style="font-size:.78rem;color:var(--muted2)">Select a move type first</span>'; return; }
  const vehicles = (window.PackZenPricing && window.PackZenPricing.vehicles) || {};
  const order = Object.keys(vehicles);
  if (!order.length) { grid.innerHTML = '<span style="font-size:.78rem;color:var(--muted2)">Pricing engine not loaded</span>'; return; }
  nbVehicleHtml = "0";
  grid.innerHTML = order.map(id => {
    const v = vehicles[id];
    return `<div class="nb-select-card" data-vehicle-value="${v.htmlValue}">${v.icon}<br>${v.name}<br><small style="opacity:.6">${v.displayRate || ""}</small></div>`;
  }).join("");
  grid.querySelectorAll(".nb-select-card").forEach(c => {
    c.addEventListener("click", function () {
      grid.querySelectorAll(".nb-select-card").forEach(x => x.classList.remove("selected"));
      this.classList.add("selected");
      nbVehicleHtml = this.dataset.vehicleValue;
      nbCalc();
    });
  });
  if (card) card.style.display = nbMoveType === "single" ? "none" : "block";
}

function nbRenderFurnitureGrid() {
  const grid = document.getElementById("nbFurnitureGrid");
  if (!grid) return;
  const prices = (window.PackZenPricing && window.PackZenPricing.config && window.PackZenPricing.config.furniturePrices) || {};
  const labels = {
    sofaCheck:"Sofa", sofaCumBedCheck:"Sofa cum Bed", reclinerCheck:"Recliner", tvCheck:"TV", tvUnitCheck:"TV Unit",
    coffeeCheck:"Coffee Table", centerTableCheck:"Center Table", bookshelfCheck:"Bookshelf", showcaseCheck:"Showcase",
    shoeRackCheck:"Shoe Rack", acCheck:"AC Unit", bedCheck:"Bed", mattressCheck:"Mattress", wardrobeCheck:"Wardrobe",
    dressingCheck:"Dressing Table", sideTableCheck:"Side Table", studyTableCheck:"Study Table", fridgeCheck:"Fridge",
    wmCheck:"Washing Machine", dishwasherCheck:"Dishwasher", microwaveCheck:"Microwave", ovenCheck:"Oven",
    chimneyCheck:"Chimney", diningCheck:"Dining Table", waterPurifierCheck:"Water Purifier", deskCheck:"Desk",
    chairCheck:"Chair", serverCheck:"Server/PC", printerCheck:"Printer", confCheck:"Conf. Table",
    cabinetCheck:"Cabinet", whiteboardCheck:"Whiteboard", bikeCheck:"Bike", cycleCheck:"Cycle", plantCheck:"Plants",
    gymCheck:"Gym Equipment", treadmillCheck:"Treadmill", aquariumCheck:"Aquarium"
  };
  grid.innerHTML = Object.keys(labels).map(id => `
    <div class="nb-furn-card" id="nbfc-${id}">
      <div>${labels[id]}</div>
      <div style="font-size:.68rem;color:var(--gold)">₹${prices[id] || 0}</div>
      <div class="nb-qty-row">
        <button class="nb-qty-btn" data-nb-furn="${id}" data-delta="-1">−</button>
        <span id="nbfq-${id}" style="min-width:18px;display:inline-block;text-align:center">0</span>
        <button class="nb-qty-btn" data-nb-furn="${id}" data-delta="1">+</button>
      </div>
    </div>`).join("");
  grid.querySelectorAll("[data-nb-furn]").forEach(btn => {
    btn.addEventListener("click", function () {
      const id = this.dataset.nbFurn;
      const delta = parseInt(this.dataset.delta, 10);
      const span = document.getElementById("nbfq-" + id);
      const card = document.getElementById("nbfc-" + id);
      const val = Math.max(0, Math.min(20, (parseInt(span.textContent, 10) || 0) + delta));
      span.textContent = val;
      if (card) card.classList.toggle("active", val > 0);
      nbCalc();
    });
  });
}

function nbGetFurnitureQty() {
  const out = {};
  const prices = (window.PackZenPricing && window.PackZenPricing.config && window.PackZenPricing.config.furniturePrices) || {};
  Object.keys(prices).forEach(id => {
    const span = document.getElementById("nbfq-" + id);
    out[id] = span ? (parseInt(span.textContent, 10) || 0) : 0;
  });
  return out;
}

function nbCartonQty(delta) {
  const el = document.getElementById("nbCartonQty");
  if (!el) return;
  el.value = Math.max(0, Math.min(50, (parseInt(el.value, 10) || 0) + delta));
  nbCalc();
}

function nbSelectPayment(type) {
  nbSelectedPay = type;
  document.querySelectorAll(".nb-pay-opt").forEach(o => o.classList.toggle("selected", o.dataset.pay === type));
}

/* ------------------------------------------------------------
   5. DRAFT AUTOSAVE (localStorage) — powers the banner your
   HTML already has (nbDraftBanner / nbRestoreDraft / nbDiscardDraft).
   ------------------------------------------------------------ */
function nbCollectDraft() {
  return {
    name: val("nbName"), phone: val("nbPhone"), altPhone: val("nbAltPhone"), email: val("nbEmail"),
    leadSource: val("nbLeadSource"), moveType: nbMoveType, houseValue: nbHouseValue, vehicleHtml: nbVehicleHtml,
    pickup: val("nbPickup"), drop: val("nbDrop"), date: val("nbDate"), time: val("nbTime"),
    pickupFloor: val("nbPickupFloor"), dropFloor: val("nbDropFloor"),
    remarks: val("nbRemarks"), fragile: val("nbFragile"), special: val("nbSpecial"),
    cartonQty: val("nbCartonQty"), furniture: nbGetFurnitureQty()
  };
  function val(id) { const el = document.getElementById(id); return el ? el.value : ""; }
}

function nbSaveDraft() {
  try { localStorage.setItem(NB_DRAFT_KEY, JSON.stringify(nbCollectDraft())); } catch (e) {}
}

function nbLoadDraft() {
  try { return JSON.parse(localStorage.getItem(NB_DRAFT_KEY) || "null"); } catch (e) { return null; }
}

function nbRestoreDraft() {
  const d = nbLoadDraft();
  if (!d) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
  set("nbName", d.name); set("nbPhone", d.phone); set("nbAltPhone", d.altPhone); set("nbEmail", d.email);
  set("nbLeadSource", d.leadSource); set("nbPickup", d.pickup); set("nbDrop", d.drop);
  set("nbDate", d.date); set("nbTime", d.time); set("nbPickupFloor", d.pickupFloor); set("nbDropFloor", d.dropFloor);
  set("nbRemarks", d.remarks); set("nbFragile", d.fragile); set("nbSpecial", d.special); set("nbCartonQty", d.cartonQty);

  if (d.moveType) {
    const card = document.querySelector(`#nbTypeGrid .nb-type-card[data-type="${d.moveType}"]`);
    nbSelectMoveType(d.moveType);
    if (card) card.classList.add("selected");
    setTimeout(() => {
      if (d.houseValue) {
        const hc = document.querySelector(`#nbSizeGrid .nb-select-card[data-house-value="${d.houseValue}"]`);
        if (hc) hc.click();
      }
      if (d.vehicleHtml) {
        const vc = document.querySelector(`#nbVehicleGrid .nb-select-card[data-vehicle-value="${d.vehicleHtml}"]`);
        if (vc) vc.click();
      }
      if (d.furniture) {
        Object.entries(d.furniture).forEach(([id, qty]) => {
          const span = document.getElementById("nbfq-" + id);
          const cardEl = document.getElementById("nbfc-" + id);
          if (span && qty > 0) { span.textContent = qty; if (cardEl) cardEl.classList.add("active"); }
        });
      }
      nbCalc();
    }, 50);
  }
  const banner = document.getElementById("nbDraftBanner");
  if (banner) banner.style.display = "none";
  toast(" Draft restored");
}

function nbDiscardDraft() {
  try { localStorage.removeItem(NB_DRAFT_KEY); } catch (e) {}
  const banner = document.getElementById("nbDraftBanner");
  if (banner) banner.style.display = "none";
}

/* ------------------------------------------------------------
   6. LIVE QUOTE — calls the SAME pricing engine the customer
   site uses (window.PackZenPricing.calculateQuote), so prices
   always match what the customer would be quoted.
   ------------------------------------------------------------ */
function nbCalc() {
  const pickup = document.getElementById("nbPickup")?.value || "";
  const drop   = document.getElementById("nbDrop")?.value || "";
  if (!pickup || !drop || !window.PackZenPricing) {
    nbRenderQuote(null);
    return;
  }

  function withKm(km) {
    nbLastKm = km;
    const dateVal = document.getElementById("nbDate")?.value || null;
    const timeVal = document.getElementById("nbTime")?.value || "";
    const shiftHour = timeVal ? parseInt(timeVal.split(":")[0], 10) : null;
const raw = {
      pickup, drop, km,
      houseValue: nbHouseValue,
      vehicleHtmlValue: nbVehicleHtml,
      furniture: nbGetFurnitureQty(),
      cartonQty: parseInt(document.getElementById("nbCartonQty")?.value || "0", 10),
      pickupFloor: parseInt(document.getElementById("nbPickupFloor")?.value || "0", 10),
      dropFloor: parseInt(document.getElementById("nbDropFloor")?.value || "0", 10),
      liftAvailable: !!document.getElementById("nbLift")?.checked,
      packingService: !!document.getElementById("nbPacking")?.checked,
      unpackingService: !!document.getElementById("nbUnpacking")?.checked,
      dismantlingService: !!document.getElementById("nbDismantle")?.checked,
      assemblyService: !!document.getElementById("nbAssembly")?.checked,
      storageNeeded: !!document.getElementById("nbStorage")?.checked,
      storageDays: parseInt(document.getElementById("nbStorageDays")?.value || "0", 10),
      moveType: nbMoveType || "home",
      shiftDate: dateVal,
      shiftHour,
      promoDiscount: nbPromoAmount
    };
    const quote = window.PackZenPricing.calculateQuote(raw);
    nbLastQuote = quote;
    nbRenderQuote(quote);
  }

  // Prefer live Google distance, fall back to haversine, fall back to flat 15km.
  if (window.google && window.google.maps && nbPickupPlace && nbDropPlace) {
    new google.maps.DistanceMatrixService().getDistanceMatrix({
      origins: [pickup], destinations: [drop], travelMode: "DRIVING"
    }, (res, status) => {
      const el = res?.rows?.[0]?.elements?.[0];
      if (status === "OK" && el?.status === "OK" && el?.distance?.value) {
        withKm(el.distance.value / 1000);
      } else {
        withKm(nbHaversineFallback());
      }
    });
  } else if (nbPickupPlace && nbDropPlace) {
    withKm(nbHaversineFallback());
  } else {
    withKm(15); // no verified places yet — rough placeholder so advisor sees *a* number
  }
}

function nbHaversineFallback() {
  if (!nbPickupPlace?.geometry || !nbDropPlace?.geometry) return 15;
  const R = 6371;
  const p1 = nbPickupPlace.geometry.location, p2 = nbDropPlace.geometry.location;
  const lat1 = p1.lat() * Math.PI / 180, lat2 = p2.lat() * Math.PI / 180;
  const dLat = lat2 - lat1, dLng = (p2.lng() - p1.lng()) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.max(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3, 5);
}

function nbRenderQuote(quote) {
  const linesEl = document.getElementById("nbSummaryLines");
  const totalEl = document.getElementById("nbTotalDisplay");
  if (!linesEl || !totalEl) return;
  if (!quote || !quote.valid) {
    linesEl.innerHTML = '<div class="nb-summary-line"><span>Enter move details to see price</span></div>';
    totalEl.textContent = "₹0";
    return;
  }
  const b = quote.breakdown;
  const rows = [];
  rows.push(`<div class="nb-summary-line"><span>Base Fare</span><strong>₹${b.baseFare.toLocaleString("en-IN")}</strong></div>`);
  if (b.distanceCharge > 0) rows.push(`<div class="nb-summary-line"><span>Distance</span><strong>₹${b.distanceCharge.toLocaleString("en-IN")}</strong></div>`);
  if (b.furnitureCharge > 0) rows.push(`<div class="nb-summary-line"><span>Furniture</span><strong>₹${b.furnitureCharge.toLocaleString("en-IN")}</strong></div>`);
  if (b.cartonCharge > 0) rows.push(`<div class="nb-summary-line"><span>Cartons</span><strong>₹${b.cartonCharge.toLocaleString("en-IN")}</strong></div>`);
if (b.floorCharge > 0) rows.push(`<div class="nb-summary-line"><span>Floor Charge</span><strong>₹${b.floorCharge.toLocaleString("en-IN")}</strong></div>`);
  if (b.packingCharge > 0) rows.push(`<div class="nb-summary-line"><span>Packing</span><strong>₹${b.packingCharge.toLocaleString("en-IN")}</strong></div>`);
  if (b.unpackingCharge > 0) rows.push(`<div class="nb-summary-line"><span>Unpacking</span><strong>₹${b.unpackingCharge.toLocaleString("en-IN")}</strong></div>`);
  if (b.dismantlingCharge > 0) rows.push(`<div class="nb-summary-line"><span>Dismantling</span><strong>₹${b.dismantlingCharge.toLocaleString("en-IN")}</strong></div>`);
  if (b.assemblyCharge > 0) rows.push(`<div class="nb-summary-line"><span>Assembly</span><strong>₹${b.assemblyCharge.toLocaleString("en-IN")}</strong></div>`);
  if (b.storageCharge > 0) rows.push(`<div class="nb-summary-line"><span>Storage</span><strong>₹${b.storageCharge.toLocaleString("en-IN")}</strong></div>`);
   if (b.discount > 0) rows.push(`<div class="nb-summary-line"><span>Discount</span><strong style="color:var(--green)">−₹${b.discount.toLocaleString("en-IN")}</strong></div>`);
  linesEl.innerHTML = rows.join("");
  totalEl.textContent = "₹" + b.grandTotal.toLocaleString("en-IN");
}

/* ------------------------------------------------------------
   7. COUPON — reuses the SAME `promos` collection the customer
   site reads (script.js applyPromoCode), doc id == code.
   ------------------------------------------------------------ */
async function nbApplyCoupon() {
  const codeInput = document.getElementById("nbCoupon");
  const msgEl = document.getElementById("nbCouponMsg");
  const code = (codeInput?.value || "").trim().toUpperCase();
  if (!code) { if (msgEl) msgEl.textContent = "Enter a code."; return; }
  if (!window._firebase) { if (msgEl) msgEl.textContent = "Not connected to Firebase."; return; }
  try {
    const snap = await window._firebase.db.collection("promos").doc(code).get();
    if (!snap.exists || snap.data().active === false) {
      if (msgEl) { msgEl.textContent = "Invalid or expired code."; msgEl.style.color = "var(--red)"; }
      return;
    }
    const promo = snap.data();
    const baseTotal = nbLastQuote?.breakdown?.grandTotal || 0;
    const maxFraction = window.PackZenPricing?.config?.discounts?.maxPromoFraction || 0.5;
    const raw = promo.type === "percent" ? Math.round(baseTotal * promo.value / 100) : promo.value;
    nbPromoAmount = Math.min(raw, Math.floor(baseTotal * maxFraction));
    if (msgEl) { msgEl.textContent = `🎉 ₹${nbPromoAmount} off applied`; msgEl.style.color = "var(--green)"; }
    nbCalc();
  } catch (e) {
    if (msgEl) { msgEl.textContent = "Error checking code."; msgEl.style.color = "var(--red)"; }
  }
}

/* ------------------------------------------------------------
   8. SAVE BOOKING — writes to the SAME `bookings` collection
   with the SAME field names the customer flow and admin panel
   already read (bookingRef, customerName, phone, pickup, drop,
   date, shiftTime, shiftTimeLabel, moveType, house, vehicle,
   furniture, pickupFloor, dropFloor, liftAvailable, total,
   originalTotal, paid, paymentType, status, source, promoDiscount,
   driverUid/driverName, createdAt).

   ⚠️ REQUIRES a Firestore rules update — see the accompanying
   rules diff. Without it this write will be rejected because
   the rule currently requires customerUid == request.auth.uid,
   which an advisor-created walk-in booking cannot satisfy.
   ------------------------------------------------------------ */
async function nbSaveBooking() {
  const errEl = document.getElementById("nbFormErr");
  const btn = document.getElementById("nbSaveBtn");
  const setErr = (m) => { if (errEl) errEl.textContent = m || ""; };
  setErr("");

  const name  = document.getElementById("nbName")?.value.trim();
  const phone = document.getElementById("nbPhone")?.value.trim();
  const pickup = document.getElementById("nbPickup")?.value.trim();
  const drop   = document.getElementById("nbDrop")?.value.trim();
  const date   = document.getElementById("nbDate")?.value;
  const timeVal = document.getElementById("nbTime")?.value;
  const timeLabel = document.getElementById("nbTime")?.selectedOptions?.[0]?.textContent || "";

  if (!name)  return setErr("⚠️ Customer name is required.");
  if (!/^\d{10}$/.test(phone || "")) return setErr("⚠️ Valid 10-digit phone required.");
  if (!nbMoveType) return setErr("⚠️ Select a move type.");
  if (!pickup || !drop) return setErr("⚠️ Pickup and drop address are required.");
  if (!date) return setErr("⚠️ Moving date is required.");
  if (!timeVal) return setErr("⚠️ Select a time slot.");
  if (nbMoveType !== "single" && nbLastKm <= 100 && nbVehicleHtml === "0") return setErr("⚠️ Select a vehicle.");
if (!nbLastQuote || !nbLastQuote.valid) return setErr("⚠️ Waiting on price calculation — try again in a moment.");
if (!advisorUser || !advisorUser.uid) return setErr("⚠️ Advisor session not detected — please refresh the page and log in again before saving.");
if (!window._firebase) return setErr("⚠️ Not connected to Firebase.");

  const driverUid = document.getElementById("nbDriver")?.value || "";
  const driver = driverUid ? (allDrivers || []).find(d => d.id === driverUid) : null;
  const status = driverUid ? "assigned" : (document.getElementById("nbStatus")?.value || "confirmed");

  const houseText = (() => {
    const sel = document.querySelector(`#nbSizeGrid .nb-select-card.selected`);
    return sel ? sel.textContent.trim() : "";
  })();
  const vehicleText = (() => {
    const sel = document.querySelector(`#nbVehicleGrid .nb-select-card.selected`);
    return sel ? sel.textContent.trim() : "";
  })();

  const furnitureQty = nbGetFurnitureQty();
  const furnitureLabels = {
    sofaCheck:"Sofa", bedCheck:"Bed", tvCheck:"TV", wmCheck:"Washing Machine", fridgeCheck:"Fridge",
    wardrobeCheck:"Wardrobe", diningCheck:"Dining Table", acCheck:"AC Unit"
  };
  const furnitureSummary = Object.entries(furnitureQty)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => `${furnitureLabels[id] || id} ×${q}`)
    .join(", ");

  const grandTotal = nbLastQuote.breakdown.grandTotal;
  let paid = 0;
  if (document.getElementById("nbPaidToggle")?.checked) {
    if (nbSelectedPay === "advance") paid = nbLastQuote.paymentOptions.advanceAmount;
    else if (nbSelectedPay === "full") paid = nbLastQuote.paymentOptions.fullOnlineAmount;
  }

  const bookingRef = "PKZ-" + Date.now().toString(36).toUpperCase();

  const payload = {
    bookingRef,
    customerName: name,
    phone,
    altPhone: document.getElementById("nbAltPhone")?.value.trim() || "",
    email: document.getElementById("nbEmail")?.value.trim() || "",
    leadSource: document.getElementById("nbLeadSource")?.value || "walk_in",
    pickup, drop,
    date,
    shiftTime: timeVal,
    shiftTimeLabel: timeLabel,
    moveType: nbMoveType,
    house: houseText,
    vehicle: vehicleText,
    furniture: furnitureSummary,
    pickupFloor: document.getElementById("nbPickupFloor")?.selectedOptions?.[0]?.textContent || "",
    dropFloor: document.getElementById("nbDropFloor")?.selectedOptions?.[0]?.textContent || "",
    liftAvailable: !!document.getElementById("nbLift")?.checked,
    packingService: !!document.getElementById("nbPacking")?.checked,
    unpackingService: !!document.getElementById("nbUnpacking")?.checked,
    dismantling: !!document.getElementById("nbDismantle")?.checked,
    assembly: !!document.getElementById("nbAssembly")?.checked,
storageNeeded: !!document.getElementById("nbStorage")?.checked,
    storageDays: parseInt(document.getElementById("nbStorageDays")?.value || "0", 10),
     remarks: document.getElementById("nbRemarks")?.value.trim() || "",
    fragileItems: document.getElementById("nbFragile")?.value.trim() || "",
    specialItems: document.getElementById("nbSpecial")?.value.trim() || "",
    total: grandTotal,
    originalTotal: grandTotal,
    paid,
    paymentType: nbSelectedPay,
    promoDiscount: nbPromoAmount,
   status,
    source: "advisor",
    createdByAdvisor: advisorUser?.uid || null,
    createdByAdvisorName: advisorUser?.displayName || (advisorUser?.email ? advisorUser.email.split("@")[0] : "Unknown"),
    createdByAdvisorEmail: advisorUser?.email || "",
    driverUid: driverUid || null,
    driverName: driver ? (driver.name || "") : "",
    driverPhone: driver ? (driver.phone || "") : "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    await window._firebase.db.collection("bookings").add(payload);
    toast("Success: Booking created: " + bookingRef);
    nbDiscardDraft();
    nbResetForm();
  } catch (e) {
    setErr("❌ " + (e.code === "permission-denied"
      ? "Permission denied — the Firestore rule for advisor-created bookings needs the update described in the deployment notes."
      : e.message));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "✅ Create Booking"; }
  }
}

function nbResetForm() {
  ["nbName","nbPhone","nbAltPhone","nbEmail","nbPickup","nbDrop","nbDate","nbRemarks","nbFragile","nbSpecial","nbCoupon","nbStorageDays"].forEach(id => {
     const el = document.getElementById(id); if (el) el.value = "";
  });
  document.getElementById("nbCartonQty") && (document.getElementById("nbCartonQty").value = "0");
  document.querySelectorAll(".nb-type-card, .nb-select-card, .nb-furn-card.active").forEach(c => c.classList.remove("selected", "active"));
  document.querySelectorAll('[id^="nbfq-"]').forEach(s => s.textContent = "0");
  nbMoveType = null; nbHouseValue = "0"; nbVehicleHtml = "0";
  nbPickupPlace = null; nbDropPlace = null; nbLastKm = 0; nbPromoAmount = 0; nbLastQuote = null;
  document.getElementById("nbCouponMsg") && (document.getElementById("nbCouponMsg").textContent = "");
  nbRenderQuote(null);
  nbSelectPayment("pay_later");
}

/* ============================================================
   9. ASSIGN DRIVER MODAL — your existing table rows already
   call openAssignModal('${b.id}'); this was simply missing.
   ============================================================ */
let assignBookingId = null;

function nbEnsureAssignModal() {
  if (document.getElementById("assignDriverModal")) return;
  const div = document.createElement("div");
  div.id = "assignDriverModal";
  div.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center;padding:20px;";
  div.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;max-width:400px;width:100%">
      <h3 style="font-family:var(--mono);color:var(--gold);margin-bottom:14px;font-size:.95rem">🚚 Assign Driver</h3>
      <div id="assignDriverInfo" style="font-size:.82rem;color:var(--muted);margin-bottom:14px;line-height:1.7"></div>
      <label style="font-size:.7rem;color:var(--muted);font-weight:700;text-transform:uppercase;display:block;margin-bottom:6px">Select Driver</label>
      <select id="assignDriverSelect" style="width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:8px;padding:9px 12px;color:var(--text);margin-bottom:16px">
        <option value="">-- Select a driver --</option>
      </select>
      <div style="display:flex;gap:10px">
        <button onclick="closeAssignModal()" style="flex:1;padding:10px;background:var(--surface2);border:1px solid var(--border2);color:var(--muted);border-radius:8px;cursor:pointer;font-weight:700">Cancel</button>
        <button onclick="confirmAssign()" style="flex:2;padding:10px;background:var(--gold);border:none;color:#000;border-radius:8px;cursor:pointer;font-weight:800">Assign ✓</button>
      </div>
    </div>`;
  document.body.appendChild(div);
}

function openAssignModal(bookingId) {
  nbEnsureAssignModal();
  assignBookingId = bookingId;
  const b = (allBookings || []).find(x => x.id === bookingId);
  const info = document.getElementById("assignDriverInfo");
  if (info && b) {
    info.innerHTML = `<strong>Booking:</strong> ${b.bookingRef || ("#" + bookingId.slice(-6).toUpperCase())}<br>
      <strong>Customer:</strong> ${b.customerName || "—"}<br>
      <strong>Route:</strong> ${(b.pickup||"").split(",")[0]} → ${(b.drop||"").split(",")[0]}`;
  }
  const sel = document.getElementById("assignDriverSelect");
  if (sel) {
    sel.innerHTML = '<option value="">-- Select a driver --</option>' +
      (allDrivers || []).map(d => `<option value="${d.id}" ${b && b.driverUid === d.id ? "selected" : ""}>${d.name || d.email}</option>`).join("");
  }
  document.getElementById("assignDriverModal").style.display = "flex";
}

function closeAssignModal() {
  const m = document.getElementById("assignDriverModal");
  if (m) m.style.display = "none";
  assignBookingId = null;
}

async function confirmAssign() {
  const driverUid = document.getElementById("assignDriverSelect")?.value;
  if (!driverUid) { toast("⚠️ Select a driver"); return; }
  if (!assignBookingId || !window._firebase) return;
  const driver = (allDrivers || []).find(d => d.id === driverUid);
  try {
    await window._firebase.db.collection("bookings").doc(assignBookingId).update({
      driverUid, driverName: driver?.name || "Driver", driverPhone: driver?.phone || "", status: "assigned"
    });
    await window._firebase.db.collection("users").doc(driverUid).update({ currentBooking: assignBookingId });
    toast("Success: Driver assigned");
    closeAssignModal();
  } catch (e) {
    toast("Failed: " + (e.code === "permission-denied" ? "Permission denied — check Firestore rules." : e.message));
  }
}

/* ============================================================
   10. Non-silent error handling for the customers/drivers
   listeners in loadAll() (originally `() => {}`).
   We attach a SECOND, harmless listener purely for error
   visibility — it does not touch your existing data flow.
   ============================================================ */
(function attachErrorVisibility() {
  function watch(collectionName, roleValue) {
    if (!window._firebase) { setTimeout(() => watch(collectionName, roleValue), 500); return; }
    window._firebase.db.collection("users").where("role", "==", roleValue)
      .onSnapshot(() => {}, err => toast("⚠️ " + collectionName + ": " + err.message));
  }
  watch("Customers", "customer");
  watch("Drivers", "driver");
})();
