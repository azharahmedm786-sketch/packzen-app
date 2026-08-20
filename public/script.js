/* ============================================
PackZen — script.js (FULLY FIXED)
SECURITY HARDENED VERSION - May 2026
Pricing Engine: v4.2.0 (pricing-engine-v2.js) — exposed as window.PackZenPricing
============================================ */

// ─── GLOBAL STATE ───────────────────────────────────
let pickupPlace = null, dropPlace = null;
let map = null, directionsService = null, directionsRenderer = null; 
let pickupMarker = null, dropMarker = null;
let lastCalculatedTotal = 0;
let paymentReceiptId = "";
let confirmationResult = null;
let pendingSignupData = null;
let currentUser = null;
let pendingLinkCredential = null; // holds the Google/Apple credential while we re-auth the existing account for linking
let promoDiscount = 0; 
let selectedPayment = "at_drop";
let isProcessingPayment = false;
let currentRating = 0;
let trackingListener = null;
let chatListener = null;
let trackingMap = null;
let trackingDriverMarker = null;
let currentBookingId = null;
let uploadedPhotos = [];
let selectedMoveType = null;
let resetFlowPhone = "";
let otpTimerInterval = null;
let isLocating = false;
let geoLocationRetryCount = 0;
const MAX_GEO_RETRIES = 2;
let isIntercityMove = false;

// ─── MOVE TYPE CONFIG (GLOBAL) ──────────────────────
const MOVE_TYPE_CONFIG = {
  home: {
    sizeLabel: "House Type",
    icon: "🏠",
    sizes: [
      { icon: "🏠", label: "1 RK", sub: "Studio", value: "2500" },
      { icon: "🏡", label: "1 BHK", sub: "Small", value: "4500" },
      { icon: "🏘️", label: "2 BHK", sub: "Medium", value: "6500" },
      { icon: "🏰", label: "3 BHK", sub: "Large", value: "8500" },
      { icon: "🏯", label: "4 BHK", sub: "X-Large", value: "10500" },
      { icon: "🌇", label: "Villa", sub: "Premium", value: "13500" }
    ]
  },
  office: {
    sizeLabel: "Office Size",
    icon: "🏢",
    sizes: [
      { icon: "💼", label: "Cabin", sub: "1–5 desks", value: "6500" },
      { icon: "🏢", label: "Small", sub: "5–15 desks", value: "10500" },
      { icon: "🏬", label: "Medium", sub: "15–30 desks", value: "16500" },
      { icon: "🏭", label: "Large", sub: "30+ desks", value: "25500" }
    ]
  },
  single: {
    sizeLabel: "Item Type",
    icon: "📦",
    sizes: [
      { icon: "🛋️", label: "Furniture", sub: "Sofa, bed…", value: "0" },
      { icon: "🧊", label: "Appliance", sub: "Fridge, AC…", value: "0" },
      { icon: "🏍️", label: "Bike/Cycle", sub: "Two-wheeler", value: "500" },
      { icon: "📦", label: "Boxes", sub: "Cartons", value: "0" }
    ]
  }
};

// ─── FURNITURE DATA ─────────────────────────────────
// FURNITURE_PRICES is kept for renderFurnitureGrid() display labels only.
// All pricing calculations are handled exclusively by pricing-engine-v2.js.

const FURNITURE_PRICES = {
  sofaCheck: 200,
  sofaCumBedCheck: 350,
  reclinerCheck: 250,
  tvCheck: 100,
  tvUnitCheck: 200,
  coffeeCheck: 75,
  centerTableCheck: 100,
  bookshelfCheck: 200,
  showcaseCheck: 300,
  shoeRackCheck: 100,
  acCheck: 400,

  bedCheck: 300,
  mattressCheck: 100,
  wardrobeCheck: 500,
  dressingCheck: 200,
  sideTableCheck: 75,
  studyTableCheck: 150,

  fridgeCheck: 200,
  wmCheck: 175,
  dishwasherCheck: 250,
  microwaveCheck: 75,
  ovenCheck: 150,
  chimneyCheck: 200,
  diningCheck: 250,
  waterPurifierCheck: 100,

  deskCheck: 200,
  chairCheck: 50,
  serverCheck: 500,
  printerCheck: 150,
  confCheck: 400,
  cabinetCheck: 250,
  whiteboardCheck: 100,

  bikeCheck: 250,
  cycleCheck: 100,
  plantCheck: 75,
  gymCheck: 400,
  treadmillCheck: 500,
  aquariumCheck: 300
};

const FURNITURE_CATEGORIES = {
  home: [
    {
      id: "cat-living",
      icon: "🛋️",
      label: "Living Room",
      items: [
        { id: "sofaCheck", emoji: "🛋️", name: "Sofa" },
        { id: "sofaCumBedCheck", emoji: "🛋️", name: "Sofa Cum Bed" },
        { id: "reclinerCheck", emoji: "🪑", name: "Recliner" },
        { id: "tvCheck", emoji: "📺", name: "TV" },
        { id: "tvUnitCheck", emoji: "🗄️", name: "TV Unit" },
        { id: "coffeeCheck", emoji: "☕", name: "Coffee Table" },
        { id: "centerTableCheck", emoji: "🪵", name: "Center Table" },
        { id: "bookshelfCheck", emoji: "📚", name: "Bookshelf" },
        { id: "showcaseCheck", emoji: "🪟", name: "Showcase" },
        { id: "shoeRackCheck", emoji: "👞", name: "Shoe Rack" },
        { id: "acCheck", emoji: "❄️", name: "AC Unit" }
      ]
    },
 {
  id: "cat-bedroom",
  icon: "🛏️",
  label: "Bedroom",
  items: [
  { id: "bedCheck", emoji: "🛏️", name: "Bed" },
  { id: "mattressCheck", emoji: "🛌", name: "Mattress" },
  { id: "wardrobeCheck", emoji: "🚪", name: "Wardrobe" },
  { id: "dressingCheck", emoji: "🪞", name: "Dressing Table" },
  { id: "sideTableCheck", emoji: "🗄️", name: "Side Table" },
  { id: "studyTableCheck", emoji: "💻", name: "Study Table" }
]
    },
{
  id: "cat-kitchen",
  icon: "🍳",
  label: "Kitchen",
  items: [
    { id: "fridgeCheck", emoji: "🧊", name: "Fridge" },
    { id: "wmCheck", emoji: "🧺", name: "Washing Machine" },
    { id: "dishwasherCheck", emoji: "🍽️", name: "Dishwasher" },
    { id: "microwaveCheck", emoji: "📟", name: "Microwave" },
    { id: "ovenCheck", emoji: "🔥", name: "Oven / OTG" },
    { id: "chimneyCheck", emoji: "🌬️", name: "Kitchen Chimney" },
    { id: "diningCheck", emoji: "🍽️", name: "Dining Table" },
    { id: "waterPurifierCheck", emoji: "💧", name: "Water Purifier" }
  ]
    },
 {
  id: "cat-other",
  icon: "📦",
  label: "Other Items",
  items: [
    { id: "bikeCheck", emoji: "🏍️", name: "Bike/Scooter" },
    { id: "cycleCheck", emoji: "🚲", name: "Cycle" },
    { id: "plantCheck", emoji: "🪴", name: "Large Plants" },
    { id: "gymCheck", emoji: "🏋️", name: "Gym Equipment" },
    { id: "treadmillCheck", emoji: "🏃", name: "Treadmill" },
    { id: "aquariumCheck", emoji: "🐟", name: "Aquarium" }
  ]
},
  ],
  office: [
    {
      id: "cat-office", icon: "💼", label: "Office Furniture",
      items: [
        { id: "deskCheck", emoji: "🖥️", name: "Office Desk" },
        { id: "chairCheck", emoji: "🪑", name: "Chair" },
        { id: "cabinetCheck", emoji: "🗄️", name: "Filing Cabinet" },
        { id: "serverCheck", emoji: "🖥️", name: "Server/PC" },
        { id: "printerCheck", emoji: "🖨️", name: "Printer" },
        { id: "confCheck", emoji: "🤝", name: "Conf. Table" },
        { id: "whiteboardCheck", emoji: "📝", name: "Whiteboard" }
      ]
    }
  ],
  single: [
    {
      id: "cat-single", icon: "📦", label: "Single Items",
     items: [
  { id: "sofaCheck", emoji: "🛋️", name: "Sofa" },
  { id: "sofaCumBedCheck", emoji: "🛋️", name: "Sofa Cum Bed" },
  { id: "reclinerCheck", emoji: "🪑", name: "Recliner" },
  { id: "bedCheck", emoji: "🛏️", name: "Bed" },
  { id: "mattressCheck", emoji: "🛌", name: "Mattress" },
  { id: "wardrobeCheck", emoji: "🚪", name: "Wardrobe" },
  { id: "fridgeCheck", emoji: "🧊", name: "Fridge" },
  { id: "wmCheck", emoji: "🧺", name: "Washing Machine" },
  { id: "tvCheck", emoji: "📺", name: "TV" },
  { id: "microwaveCheck", emoji: "📟", name: "Microwave" },
  { id: "bikeCheck", emoji: "🏍️", name: "Bike/Scooter" },
  { id: "cycleCheck", emoji: "🚲", name: "Cycle" },
  { id: "acCheck", emoji: "❄️", name: "AC Unit" }
]
    }
  ]
};

// Expose configs on a shared namespace so Advisor Dashboard can use them without duplication
window.PackZenShared = window.PackZenShared || {};
window.PackZenShared.MOVE_TYPE_CONFIG = MOVE_TYPE_CONFIG;
window.PackZenShared.FURNITURE_CATEGORIES = FURNITURE_CATEGORIES;
window.PackZenShared.FURNITURE_PRICES = FURNITURE_PRICES;

const RAZORPAY_KEY = (window.ENV && window.ENV.RAZORPAY_KEY) || "";
const OWNER_WHATSAPP = "919945095453";

function initPaymentOptions() {
  selectPayment('at_drop');
  const payBtn = document.getElementById("btnPayOnline");
  if (payBtn) payBtn.style.display = "none";
  const confirmBtn = document.getElementById("dynamicBookingBtn");
  if (confirmBtn) confirmBtn.style.display = "";
}

/* ============================================
SECURITY HELPERS
============================================ */
function sanitizeHTML(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeInput(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim().replace(/[<>"']/g, "");
}

function validatePhone(phone) {
  const cleaned = String(phone).replace(/\D/g, "");
  return cleaned.length === 10 ? cleaned : null;
}

function validateName(name) {
  if (!name || typeof name !== "string") return null;
  const cleaned = name.trim().replace(/[<>"']/g, "");
  return cleaned.length >= 2 ? cleaned : null;
}

/* ============================================
RATE LIMITING
============================================ */
const rateLimits = {};

function checkRateLimit(key, maxRequests = 5, windowMs = 60000) {
  const now = Date.now();
  if (!rateLimits[key]) {
    rateLimits[key] = { count: 1, firstRequest: now };
    return true;
  }
  const windowStart = rateLimits[key].firstRequest;
  if (now - windowStart > windowMs) {
    rateLimits[key] = { count: 1, firstRequest: now };
    return true;
  }
  if (rateLimits[key].count >= maxRequests) return false;
  rateLimits[key].count++;
  return true;
}

/* ============================================
TOAST
============================================ */
function showToast(msg, dur = 3000) {
  let t = document.getElementById("toastMsg");
  if (!t) {
    t = document.createElement("div");
    t.id = "toastMsg";
    t.className = "toast-msg";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove("show"), dur);
}
function showToast(msg, dur = 3000) {
  let t = document.getElementById("toastMsg");
  if (!t) {
    t = document.createElement("div");
    t.id = "toastMsg";
    t.className = "toast-msg";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove("show"), dur);
}

function openAIChatbot() {
  const btn = document.getElementById("pzToggleBtn");
  if (btn) { btn.click(); return; }
  showToast("⚠️ Chatbot not available right now.");
}
/* ============================================
MOVE TYPE SELECTION
============================================ */

function selectMoveType(el, type) {
  selectedMoveType = type;
  document.querySelectorAll(".move-type-card").forEach(card => card.classList.remove("selected"));
  if (el) el.classList.add("selected");
  const input = document.getElementById("moveType");
  if (input) input.value = type;
  renderSizeCards(type);
  renderFurnitureGrid(type);
  syncQuoteSummary();
}

/* ============================================
SIZE CARDS RENDERER
============================================ */
/* ============================================
SIZE CARDS RENDERER (FIXED)
============================================ */
function renderSizeCards(type) {
  console.log("renderSizeCards", type);
  const container = document.getElementById("houseCards");
  const select = document.getElementById("house");
  const labelText = document.getElementById("sizeLabelText");
  const config = MOVE_TYPE_CONFIG[type] || MOVE_TYPE_CONFIG.home;

  if (labelText) labelText.textContent = config.sizeLabel;
  if (!container) return;

  container.innerHTML = "";
  if (select) {
    select.innerHTML = '<option value="">Select size</option>';
  }

  config.sizes.forEach(s => {
    const card = document.createElement("div");
    card.className = "select-card";
    card.dataset.value = s.value;
card.innerHTML = `<div class="sc-label">${s.label}</div><div class="sc-sub">${s.sub}</div>`;    
    card.addEventListener("click", () => {
      container.querySelectorAll(".select-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      if (select) select.value = s.value;
      recommendVehicle(type, s.label);
      calculateQuote(true);
    });

    container.appendChild(card);

    if (select) {
      const opt = document.createElement("option");
      opt.value = s.value;
      opt.textContent = s.label;
      select.appendChild(opt);
    }
  });
}
/* ============================================
FURNITURE QUANTITY
============================================ */
function changeFurnitureQty(id, delta) {
  const input = document.getElementById(id);
  if (!input) return;
  const newVal = Math.max(0, Math.min(20, (parseInt(input.value) || 0) + delta));
  input.value = newVal;
  const card = document.getElementById("card-" + id);
  if (card) card.classList.toggle("active", newVal > 0);
  calculateQuote(true);
}

function syncFurnitureQty(id) {
  const input = document.getElementById(id);
  if (!input) return;
  const val = Math.max(0, Math.min(20, parseInt(input.value) || 0));
  input.value = val;
  const card = document.getElementById("card-" + id);
  if (card) card.classList.toggle("active", val > 0);
  calculateQuote(true);
}

/* ============================================
FURNITURE GRID RENDERER
============================================ */
function renderFurnitureGrid(type) {
  const grid = document.querySelector(".furniture-grid");
  if (!grid) return;
  const categories = FURNITURE_CATEGORIES[type] || FURNITURE_CATEGORIES.home;
  const FREE_CATS = ["cat-kitchen", "cat-other", "cat-appliances"];

  // Use v2 engine prices if available, fall back to FURNITURE_PRICES for display
  const getPriceForDisplay = (itemId, catId) => {
    const isFree = FREE_CATS.includes(catId);
    // Read from v2 config if loaded, otherwise fall back
    const v2Units = window.PackZenPricing?.config?.furnitureUnits?.[itemId];
    const units = (v2Units !== undefined) ? v2Units : 0;
    if (isFree || units === 0) return "FREE";
    return `${units} Units`;
  };

  const itemCard = (item, catId) => {
    const isFree = FREE_CATS.includes(catId);
    const priceLabel = getPriceForDisplay(item.id, catId);
    const priceColor = (isFree || priceLabel === "FREE") ? 'color:#94a3b8' : '';
return `<div class="fc-qty-card" id="card-${item.id}" data-item-id="${item.id}">
      <span class="fc-name">${item.name}</span>
      <span class="fc-price-tag" style="display:none!important; ${priceColor}">${priceLabel}</span>
      <div class="fc-qty-row">
        <button class="fc-qty-btn" data-action="minus" data-item="${item.id}" aria-label="Remove ${item.name}">−</button>
        <input type="number" id="${item.id}" value="0" min="0" max="20" class="fc-qty-input" aria-label="${item.name} quantity" readonly>
        <button class="fc-qty-btn" data-action="plus" data-item="${item.id}" aria-label="Add ${item.name}">+</button>
      </div>
    </div>`;
  };

  const categoryBlock = cat => `<div class="fc-category" data-cat-id="${cat.id}">
    <div class="fc-category-header" data-toggle-cat="${cat.id}">
 <span class="fc-cat-label">${cat.label}</span>
      <span class="fc-cat-arrow" id="arrow-${cat.id}">▾</span>
    </div>
    <div class="fc-category-items" id="${cat.id}" style="display:flex">
      ${cat.items.map(item => itemCard(item, cat.id)).join("")}
    </div>
  </div>`;

  const cartonSection = `<div class="fc-category" data-cat-id="cat-carton">
    <div class="fc-category-header" data-toggle-cat="cat-carton">
     <span class="fc-cat-label">Carton Boxes</span>
      <span class="fc-cat-arrow" id="arrow-cat-carton">▾</span>
    </div>
    <div class="fc-category-items" id="cat-carton" style="display:flex">
      <div class="carton-box-row">
<span class="carton-label">How many carton boxes?</span>
<div class="carton-qty-wrap">
          <button class="qty-btn" data-carton-action="minus">−</button>
          <input type="number" id="cartonQty" value="0" min="0" max="50" class="fc-qty" onchange="calculateQuote(true)">
          <button class="qty-btn" data-carton-action="plus">+</button>
        </div>
        <span class="carton-price-note">₹${window.PackZenPricing?.config?.cartons?.pricePerBox || 50} per box</span>
      </div>
    </div>
  </div>`;

  grid.innerHTML = categories.map(categoryBlock).join("") + cartonSection;

  // Event delegation
  grid.querySelectorAll('.fc-qty-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const itemId = this.getAttribute('data-item');
      const action = this.getAttribute('data-action');
      const delta = action === 'plus' ? 1 : -1;
      changeFurnitureQty(itemId, delta);
    });
  });

  grid.querySelectorAll('[data-toggle-cat]').forEach(header => {
    header.addEventListener('click', function(e) {
      e.preventDefault();
      const catId = this.getAttribute('data-toggle-cat');
      toggleFurnitureCategory(catId);
    });
  });

  grid.querySelectorAll('[data-carton-action]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const action = this.getAttribute('data-carton-action');
      const delta = action === 'plus' ? 1 : -1;
      changeCartonQty(delta);
    });
  });
}

function toggleFurnitureCategory(id) {
  const panel = document.getElementById(id);
  const arrow = document.getElementById("arrow-" + id);
  if (!panel) return;
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "flex";
  if (arrow) arrow.textContent = isOpen ? "▸" : "▾";
}

function changeCartonQty(delta) {
  const input = document.getElementById("cartonQty");
  if (!input) return;
  input.value = Math.max(0, Math.min(50, (parseInt(input.value) || 0) + delta));
  calculateQuote(true);
}

/* ============================================
VEHICLE CARD SELECTION
============================================ */
function selectCard(el, type, value) {
  const select = document.getElementById(type);
  if (select) select.value = value;
  const parent = el.closest(type === "house" ? ".select-cards" : ".vehicle-cards"); 
  if (parent) {
    const selector = type === "house" ? ".select-card" : ".vehicle-card";
    parent.querySelectorAll(selector).forEach(c => c.classList.remove("selected"));
  }
  el.classList.add("selected");
  calculateQuote(true);

}
function recommendVehicle(moveType, sizeLabel) {

  if (moveType !== "home") return;

  const vehicle = document.getElementById("vehicle");
  if (!vehicle) return;

  const map = {
    "1 RK": "tata_ace",
    "1 BHK": "truck_14ft",
    "2 BHK": "truck_17ft",
    "3 BHK": "truck_22ft",
    "4 BHK": "truck_22ft",
    "Villa": "truck_22ft"
  };

  const recommended = map[sizeLabel];
  if (!recommended) return;

  vehicle.value = recommended;

  document.querySelectorAll(".vehicle-card").forEach(card => {
    card.classList.remove("selected");

    if (card.dataset.vehicle === recommended) {
      card.classList.add("selected");
    }
  });

  showToast("🚚 Recommended vehicle selected automatically.");
  calculateQuote(true);
}
/* ============================================
MULTI-STEP FORM
============================================ */
let currentStep = 0;
const STEP_LABELS = [
  "What type of move?",
  "Where are you moving?",
  "When & what type of move?",
  "What are you moving?",
  "Almost done — confirm & book"
];

function getSteps() { return document.querySelectorAll(".form-step"); }

function updateStepDots(n) {
  document.querySelectorAll(".step-dot").forEach((dot, i) => {
    dot.classList.remove("active", "done");
    if (i < n) dot.classList.add("done");
    if (i === n) dot.classList.add("active");
  });
  document.querySelectorAll(".step-line").forEach((line, i) => line.classList.toggle("done", i < n));
  const counter = document.getElementById("stepCurrent");
  const label = document.getElementById("stepLabel");
  if (counter) counter.textContent = n + 1;
  if (label) label.textContent = STEP_LABELS[n] || "";
}

function showStep(n) {
  console.log("showStep", n);
  getSteps().forEach(s => s.classList.remove("active"));
  const steps = getSteps();
  if (steps[n]) steps[n].classList.add("active");
  setTimeout(() => {
    if (map) {
      google.maps.event.trigger(map, "resize");
      if (pickupPlace?.geometry?.location) {
        map.setCenter(pickupPlace.geometry.location);
      }
    }
  }, 300);
  const pb = document.getElementById("progressBar");
  if (pb) pb.style.width = ((n + 1) / 5) * 100 + "%";
  updateStepDots(n);
setTimeout(() => {
    const sheetWrap = document.querySelector(".sheet-form-wrap");
    if (sheetWrap) {
      sheetWrap.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, 50);
  if (n === 2) renderSizeCards(selectedMoveType || "home");
  if (n === 3) {
    renderFurnitureGrid(selectedMoveType || "home");
    const vc = document.getElementById("vehicle");
    if (!vc?.value) document.querySelector(".vehicle-card")?.click();
  }
  if (n === getSteps().length - 1) { calculateQuote(true); autoFillCustomerDetails(); }
  syncQuoteSummary();
}

function nextStep() {
  if (currentStep === 0 && !document.getElementById("moveType")?.value) {
    showToast("👆 Please select your move type"); return;
  }
  if (currentStep === 1) {
    if (!document.getElementById("pickup")?.value.trim()) { showToast("📍 Please enter a pickup location"); return; }
    if (!pickupPlace || !pickupPlace.geometry) { showToast("⚠️ Please select pickup address from dropdown"); return; }
    if (!document.getElementById("drop")?.value.trim()) { showToast("🏁 Please enter a drop location"); return; }
    if (!dropPlace || !dropPlace.geometry) { showToast("⚠️ Please select drop address from dropdown"); return; }
  }
  if (currentStep === 2) {
    if (!document.getElementById("shiftDate")?.value) { showToast("📅 Please select a moving date"); return; }
    if (!document.getElementById("shiftTime")?.value) { showToast("🕐 Please select a time slot"); return; }
    if (!document.getElementById("house")?.value) { showToast("🏠 Please select your house type"); return; }
  }
  if (currentStep === 3) {
    if (!isIntercityMove && !document.getElementById("vehicle")?.value) { showToast("🚚 Please select a vehicle type"); return; }
  }
  if (currentStep < getSteps().length - 1) { currentStep++; showStep(currentStep); }
}

function prevStep() { if (currentStep > 0) { currentStep--; showStep(currentStep); } }

function goToStep(n) {
  const steps = getSteps();
  if (n < 0 || n >= steps.length) return;
  currentStep = n;
  showStep(n);
}

/* ============================================
LIVE BOOKING SUMMARY SIDEBAR (desktop)
Mirrors #result price breakdown into #bookingSummaryPanel
============================================ */
const MOVE_TYPE_LABELS = { home: "Home Shifting", office: "Office Relocation", vehicle: "Vehicle Transport", intercity: "Intercity Move" };

function syncQuoteSummary() {
  const panel = document.getElementById("bookingSummaryPanel");
  if (!panel) return;

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const showRow = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? "flex" : "none"; };

  // Move type
  const moveType = document.getElementById("moveType")?.value || "";
  set("qsumMoveType", MOVE_TYPE_LABELS[moveType] || "—");

  // Route
  const pickup = document.getElementById("pickup")?.value.trim();
  const drop = document.getElementById("drop")?.value.trim();
  set("qsumPickup", pickup || "Pickup address not set");
  set("qsumDrop", drop || "Drop address not set");

  // Date & time
  const dateVal = document.getElementById("shiftDate")?.value;
  if (dateVal) {
    const d = new Date(dateVal + "T00:00:00");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    set("qsumDate", `${d.getDate()} ${months[d.getMonth()]}, ${d.getFullYear()}`);
  } else {
    set("qsumDate", "—");
  }
  const timeLabel = document.getElementById("shiftTimeLabel")?.value;
  set("qsumTime", timeLabel || "—");

  // Price breakdown — sourced from the same pricing engine result used elsewhere
  const q = window._lastQuoteResult;
  if (q && q.valid && q.breakdown) {
    const b = q.breakdown;
    const rupee = n => "₹" + Math.round(n || 0).toLocaleString("en-IN");

    set("qsumVehicleName", b.vehicleUsed ? ` (${b.vehicleUsed})` : "");
    set("qsumBaseFare", rupee(b.baseFare));
    set("qsumDistanceCharge", rupee(b.distanceCharge));

    showRow("qsumFloorRow", b.floorCharge > 0);
    set("qsumFloorCharge", rupee(b.floorCharge));

    showRow("qsumLoadingRow", b.labourCharge > 0);
    set("qsumLoadingCharge", rupee(b.labourCharge));

    showRow("qsumPackingRow", b.packingCharge > 0);
    set("qsumPackingCharge", rupee(b.packingCharge));

    const other = (b.specializedTradeCharges || 0) + (b.waitingCharge || 0) + (b.longCarryCharge || 0) + (b.passThroughExpenses || 0);
    showRow("qsumOtherRow", other > 0);
    set("qsumOtherCharge", rupee(other));

    const discount = b.discount || 0;
    showRow("qsumDiscountRow", discount > 0);
    set("qsumDiscountAmt", "- " + rupee(discount));

    const savePill = document.getElementById("qsumSavePill");
    if (savePill) savePill.style.display = discount > 0 ? "inline-flex" : "none";
    set("qsumSaveAmt", rupee(discount));

    set("qsumGrandTotal", rupee(b.grandTotal));
    set("qsumAdvance", rupee(q.paymentOptions?.advanceAmount));
  } else {
    ["qsumBaseFare","qsumDistanceCharge","qsumFloorCharge","qsumLoadingCharge","qsumPackingCharge","qsumOtherCharge","qsumGrandTotal","qsumAdvance"]
      .forEach(id => set(id, "₹0"));
    ["qsumFloorRow","qsumLoadingRow","qsumPackingRow","qsumOtherRow","qsumDiscountRow"].forEach(id => showRow(id, false));
    const savePill = document.getElementById("qsumSavePill");
    if (savePill) savePill.style.display = "none";
  }
}

function autoFillCustomerDetails() {
  if (!currentUser || !window._firebase) return;
  window._firebase.db.collection("users").doc(currentUser.uid).get()
    .then(doc => {
      if (!doc.exists) return;
      const d = doc.data();
      const nameEl = document.getElementById("custName");
      const phoneEl = document.getElementById("custPhone");
      if (nameEl && !nameEl.value.trim()) nameEl.value = d.name || currentUser.displayName || "";
      if (phoneEl && !phoneEl.value.trim()) phoneEl.value = d.phone || "";
    }).catch(() => {});
}

/* ============================================
DATE PICKER
============================================ */
function buildDateStrip() {
  const strip = document.getElementById("dateStrip");
  if (!strip) return;
  strip.innerHTML = "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  for (let i = 1; i <= 10; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const card = document.createElement("div");
    card.className = "date-card";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    card.dataset.date = `${year}-${month}-${day}`;
    card.innerHTML = `<div class="dc-day">${days[d.getDay()]}</div><div class="dc-num">${d.getDate()}</div><div class="dc-month">${months[d.getMonth()]}</div>${i === 1 ? '<div class="dc-tag">Tomorrow</div>' : ""}`;
    card.addEventListener("click", () => selectDateCard(card, d));
    strip.appendChild(card);
  }
}

function selectDateCard(card, dateObj) {
  document.querySelectorAll(".date-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  const shiftDate = document.getElementById("shiftDate");
  if (shiftDate) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    shiftDate.value = `${year}-${month}-${day}`;
  }
  const label = document.getElementById("dateSelectedLabel");
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (label) {
    label.textContent = `✅ ${days[dateObj.getDay()]}, ${dateObj.getDate()} ${months[dateObj.getMonth()]}`;
    label.className = "date-selected-label has-date";
  }
  calculateQuote(true);
}

function openCustomDate() {
  const input = document.getElementById("shiftDate");
  if (!input) return;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const day = String(tomorrow.getDate()).padStart(2, "0");
  input.min = `${year}-${month}-${day}`;
  input.style.cssText = "position:fixed;opacity:0;top:50%;left:50%;width:1px;height:1px;z-index:9999;";
  input.click();
  setTimeout(() => { input.style.cssText = "position:absolute;opacity:0;pointer-events:none;width:0;height:0;"; }, 500);
}

function onCustomDatePicked(val) {
  if (!val) return;
  const d = new Date(val + "T00:00:00");
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d < tomorrow) { showToast("⚠️ Please select tomorrow or a future date."); return; }
  document.querySelectorAll(".date-card").forEach(c => c.classList.remove("selected"));
  const match = document.querySelector(`.date-card[data-date="${val}"]`);
  if (match) match.classList.add("selected");
  const label = document.getElementById("dateSelectedLabel");
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (label) {
    label.textContent = `✅ ${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    label.className = "date-selected-label has-date";
  }
  syncQuoteSummary();
  calculateQuote(true);
}

function selectTimeSlot(btn, value, label, range) {
  document.querySelectorAll(".time-slot-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  const timeInput = document.getElementById("shiftTime");
  const labelInput = document.getElementById("shiftTimeLabel");
  if (timeInput) timeInput.value = value;
  if (labelInput) labelInput.value = range;
  syncQuoteSummary();
}

/* ============================================
GOOGLE MAPS
============================================ */
window.initMap = function () {
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    console.error("Map div not found");
    return;
  }
  map = new google.maps.Map(mapElement, {
    center: { lat: 12.9716, lng: 77.5946 },
    zoom: 11,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: "cooperative",
    scrollwheel: false,
    disableDoubleClickZoom: true,
    zoomControl: true
  });
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map: map,
    suppressMarkers: true,
    preserveViewport: false,
    polylineOptions: {
      strokeColor: "#1a56db",
      strokeOpacity: 1,
      strokeWeight: 6
    },
    markerOptions: { clickable: false }
  });
initAutocomplete();

// Automatically fetch current location
setTimeout(() => {
    getCurrentLocationAutomatically();
}, 1000);

console.log("✅ Map initialized");
};

function initAutocomplete() {
  const pickupInput = document.getElementById("pickup");
  const dropInput = document.getElementById("drop");
  if (!pickupInput || !dropInput || typeof google === "undefined") return;

  const pickupAuto = new google.maps.places.Autocomplete(pickupInput);
  const dropAuto = new google.maps.places.Autocomplete(dropInput);

  pickupInput.addEventListener("input", () => { pickupPlace = null; });
  dropInput.addEventListener("input", () => { dropPlace = null; });

  pickupAuto.addListener("place_changed", () => {
    const place = pickupAuto.getPlace();
    if (!place.geometry) { showToast("⚠️ Please select pickup address from dropdown"); pickupInput.value = ""; pickupPlace = null; return; }
    pickupPlace = place; showLocation("pickup"); calculateQuote(true);
  });

  dropAuto.addListener("place_changed", () => {
    const place = dropAuto.getPlace();
    if (!place.geometry) { showToast("⚠️ Please select drop address from dropdown"); dropInput.value = ""; dropPlace = null; return; }
    dropPlace = place; showLocation("drop"); calculateQuote(true);
  });
}

function showLocation(type) {
  if (!pickupPlace || !dropPlace) return;
  if (!pickupPlace.geometry || !dropPlace.geometry) return;

  const mapDiv = document.getElementById("map");
  if (mapDiv) {
    mapDiv.style.display = "block";
    mapDiv.style.height = "400px";
    mapDiv.style.minHeight = "400px";
  }

  if (map) {
    google.maps.event.trigger(map, "resize");
  }

  const request = {
    origin: pickupPlace.geometry.location,
    destination: dropPlace.geometry.location,
    travelMode: google.maps.TravelMode.DRIVING
  };

  directionsService.route(request, (result, status) => {
    if (status === google.maps.DirectionsStatus.OK) {
      directionsRenderer.setDirections(result);
      const route = result.routes[0];
      const leg = route.legs[0];
      console.log("Distance:", leg.distance.text);
      console.log("Duration:", leg.duration.text);

      if (pickupMarker) pickupMarker.setMap(null);
      if (dropMarker) dropMarker.setMap(null);

      pickupMarker = new google.maps.Marker({
        position: pickupPlace.geometry.location,
        map: map,
        label: "A",
        draggable: true
      });
      pickupMarker.addListener("dragend", function(event) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: event.latLng }, function(results, status) {
          if (status === "OK" && results[0]) {
            document.getElementById("pickup").value = results[0].formatted_address;
            pickupPlace = {
              formatted_address: results[0].formatted_address,
              geometry: { location: event.latLng }
            };
            calculateQuote(true);
            showLocation("pickup");
          }
        });
      });

      dropMarker = new google.maps.Marker({
        position: dropPlace.geometry.location,
        map: map,
        label: "B",
        draggable: true
      });
      dropMarker.addListener("dragend", function(event) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: event.latLng }, function(results, status) {
          if (status === "OK" && results[0]) {
            document.getElementById("drop").value = results[0].formatted_address;
            dropPlace = {
              formatted_address: results[0].formatted_address,
              geometry: { location: event.latLng }
            };
            calculateQuote(true);
            showLocation("drop");
          }
        });
      });

      map.fitBounds(route.bounds);
    } else {
      alert("Directions failed: " + status);
      console.error("Directions request failed:", status);
      directionsRenderer.setDirections({ routes: [] });

      if (pickupMarker) pickupMarker.setMap(null);
      if (dropMarker) dropMarker.setMap(null);

      pickupMarker = new google.maps.Marker({
        position: pickupPlace.geometry.location,
        map: map,
        label: "A",
        draggable: true
      });
      dropMarker = new google.maps.Marker({
        position: dropPlace.geometry.location,
        map: map,
        label: "B",
        draggable: true
      });
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(pickupPlace.geometry.location);
      bounds.extend(dropPlace.geometry.location);
      map.fitBounds(bounds);
      pickupMarker.addListener("dragend", function(event) {
        console.log("Pickup moved:", event.latLng.lat(), event.latLng.lng());
      });
      dropMarker.addListener("dragend", function(event) {
        console.log("Drop moved:", event.latLng.lat(), event.latLng.lng());
      });
    }
  });
}

/* ============================================
GEOLOCATION
============================================ */
function isGoogleMapsReady() { return typeof google !== 'undefined' && google.maps && google.maps.Geocoder; }

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Geolocation is not supported")); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }),
      (error) => {
        let message = "Unable to retrieve your location";
        switch(error.code) {
          case error.PERMISSION_DENIED: message = "Location access denied. Please enter address manually."; break;
          case error.POSITION_UNAVAILABLE: message = "Location information unavailable."; break;
          case error.TIMEOUT: message = "Location request timed out."; break;
        }
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

async function handleCurrentLocationToggle() {
  const toggle = document.getElementById("useCurrentLocation");
  if (!toggle || !toggle.checked) return;
  if (isLocating) { showToast("⏳ Already locating..."); return; }
  if (!isGoogleMapsReady()) { showToast("⚠️ Maps not ready yet."); toggle.checked = false; return; }
  isLocating = true;
  const toggleLabel = toggle.closest('.toggle-row')?.querySelector('.toggle-text');
  const originalText = toggleLabel?.textContent || "📱 Use my current location";
  if (toggleLabel) toggleLabel.textContent = "📍 Locating...";
  showToast("📍 Getting your current location...");

  try {
    const coords = await getCurrentLocation();
    const geocoder = new google.maps.Geocoder();
    const result = await new Promise((resolve, reject) => {
      geocoder.geocode({ location: { lat: coords.lat, lng: coords.lng } }, (results, status) => {
        if (status === "OK" && results && results[0]) resolve(results[0]);
        else reject(new Error("Could not find address."));
      });
    });
    const pickupInput = document.getElementById("pickup");
    if (pickupInput) {
      pickupInput.value = result.formatted_address;
      pickupPlace = result;
      showLocation("pickup");
      calculateQuote(true);
      showToast(`✅ Location set: ${result.formatted_address.split(",")[0]}`);
    }
  } catch (err) {
    showToast("⚠️ " + err.message);
    toggle.checked = false;
  } finally {
    isLocating = false;
    if (toggleLabel) toggleLabel.textContent = originalText;
  }
}
let pickMapInstance = null;
let pickMapMarker = null;
let pickedLocationResult = null;
let pickMapTarget = 'pickup';


// NEW
function openPickOnMapModal(target = 'pickup') {
  pickMapTarget = target;
  const titleEl = document.getElementById("pickMapModalTitle");
  if (titleEl) titleEl.textContent = target === 'drop' ? "📍 Pick Drop Location" : "📍 Pick Pickup Location";
  document.getElementById("pickMapModal").style.display = "flex";
  setTimeout(initPickMap, 100);
}

function closePickOnMapModal() {
  document.getElementById("pickMapModal").style.display = "none";
}

function initPickMap() {
  if (typeof google === "undefined" || !google.maps) { showToast("⚠️ Maps not ready yet."); return; }
const existingPlace = pickMapTarget === 'drop' ? dropPlace : pickupPlace;
const center = existingPlace?.geometry?.location || { lat: 12.9716, lng: 77.5946 };
  const mapDiv = document.getElementById("pickMapDiv");
  if (!pickMapInstance) {
    pickMapInstance = new google.maps.Map(mapDiv, { center, zoom: 14 });
    pickMapMarker = new google.maps.Marker({ position: center, map: pickMapInstance, draggable: true });
    pickMapMarker.addListener("dragend", () => reverseGeocodePick(pickMapMarker.getPosition()));
    pickMapInstance.addListener("click", (e) => {
      pickMapMarker.setPosition(e.latLng);
      reverseGeocodePick(e.latLng);
    });

    const searchInput = document.getElementById("pickMapSearchInput");
    if (searchInput) {
      const autocomplete = new google.maps.places.Autocomplete(searchInput);
      autocomplete.bindTo("bounds", pickMapInstance);
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) { showToast("⚠️ Please select a place from the dropdown"); return; }
        pickMapInstance.setCenter(place.geometry.location);
        pickMapInstance.setZoom(16);
        pickMapMarker.setPosition(place.geometry.location);
        pickedLocationResult = place;
        const addrEl = document.getElementById("pickMapAddress");
        if (addrEl) addrEl.textContent = place.formatted_address || place.name;
      });
    }

    reverseGeocodePick(pickMapMarker.getPosition());
  } else {
    google.maps.event.trigger(pickMapInstance, "resize");
    pickMapInstance.setCenter(center);
    pickMapMarker.setPosition(center);
        reverseGeocodePick(center);
  }
}

async function useCurrentLocationInPickMap() {
  if (!isGoogleMapsReady()) { showToast("⚠️ Maps not ready yet."); return; }
  showToast("📍 Getting your current location...");
  try {
    const coords = await getCurrentLocation();
    const latLng = new google.maps.LatLng(coords.lat, coords.lng);
    pickMapInstance.setCenter(latLng);
    pickMapInstance.setZoom(16);
    pickMapMarker.setPosition(latLng);
    reverseGeocodePick(latLng);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

function reverseGeocodePick(latLng) {
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: latLng }, (results, status) => {
    const addrEl = document.getElementById("pickMapAddress");
    if (status === "OK" && results[0]) {
      pickedLocationResult = results[0];
      if (addrEl) addrEl.textContent = results[0].formatted_address;
    } else if (addrEl) {
      addrEl.textContent = "Could not find address for this point.";
    }
  });
}

// NEW
function confirmPickedLocation() {
  if (!pickedLocationResult) { showToast("⚠️ Please select a point on the map."); return; }
  const fieldId = pickMapTarget === 'drop' ? 'drop' : 'pickup';
  const inputEl = document.getElementById(fieldId);
  if (inputEl) {
    inputEl.value = pickedLocationResult.formatted_address;
    if (pickMapTarget === 'drop') {
      dropPlace = pickedLocationResult;
    } else {
      pickupPlace = pickedLocationResult;
    }
    showLocation(pickMapTarget);
    calculateQuote(true);
    showToast(`✅ ${pickMapTarget === 'drop' ? 'Drop' : 'Pickup'} location set: ${pickedLocationResult.formatted_address.split(",")[0]}`);
  }
  closePickOnMapModal();
}
function setupCurrentLocationListener() {
  const toggle = document.getElementById("useCurrentLocation");
  if (!toggle) return;
  toggle.removeEventListener("change", handleCurrentLocationToggle);
  toggle.addEventListener("change", handleCurrentLocationToggle);
}

function initGeolocationFeature() { setupCurrentLocationListener(); }
async function getCurrentLocationAutomatically() {
    if (isLocating) return;
    if (!isGoogleMapsReady()) return;

    isLocating = true;

    try {
        const coords = await getCurrentLocation();

        const geocoder = new google.maps.Geocoder();

        geocoder.geocode(
            {
                location: {
                    lat: coords.lat,
                    lng: coords.lng
                }
            },
            function(results, status) {

                if (status === "OK" && results[0]) {

                    const pickupInput = document.getElementById("pickup");

                    pickupInput.value = results[0].formatted_address;

                    pickupPlace = {
                        formatted_address: results[0].formatted_address,
                        geometry: results[0].geometry
                    };

                    calculateQuote(true);

                    showToast("📍 Current location detected");

                }

            }
        );

    } catch (e) {
        console.log("Location permission denied.");
    }

    isLocating = false;
}

/* ============================================
INTERCITY BADGE (UI only — detection done by v2 engine)
============================================ */
function detectAndShowIntercityBadge(km) {
  const badge = document.getElementById("intercityBadge");
  isIntercityMove = km > 100;
  if (badge) {
    badge.style.display = isIntercityMove ? "flex" : "none";
    if (isIntercityMove) {
      const kmEl = badge.querySelector(".ic-km");
      if (kmEl) kmEl.textContent = Math.round(km) + " km";
    }
  }
  const vg = document.getElementById("vehicleCardGroup");
  if (vg) vg.style.display = isIntercityMove ? "none" : "block";
}

/* ============================================
PRICE CALCULATION
Delegates ALL pricing logic to Pricing Engine v4.2.
Google Maps distance API call is preserved exactly.
============================================ */

// The <select id="vehicle"> now stores real vehicleId strings directly
// ("tata_ace", "truck_14ft", ...). This legacy map is kept only as a
// safety fallback in case any older cached page/script still writes
// one of the old flat-price string values into it.
const VEHICLE_VALUE_TO_ID = {
  "200": "tata_ace",
  "2500": "truck_14ft",
  "4000": "truck_17ft",
  "5500": "truck_22ft"
};

/**
 * Reads every input currently on the form and assembles the single
 * "raw" payload object that window.PackZenPricing.calculateQuote()
 * expects. Centralized here so every call site (auto-recalc, promo
 * re-run, referral re-run) stays in sync with the engine's real API.
 */
function buildQuoteRawPayload(km) {
  const pickup = document.getElementById("pickup");
  const drop = document.getElementById("drop");
  const vehicleEl = document.getElementById("vehicle");
  const furnitureUnits = window.PackZenPricing?.config?.furnitureUnits || {};

  const furniture = {};
  Object.keys(furnitureUnits).forEach((itemId) => {
    const el = document.getElementById(itemId);
    if (el) furniture[itemId] = parseInt(el.value, 10) || 0;
  });

  const knownVehicleIds = window.PackZenPricing?.config?.vehicles || {};
  const rawVehicleValue = vehicleEl?.value || "";
  const vehicleId = knownVehicleIds[rawVehicleValue]
    ? rawVehicleValue
    : (VEHICLE_VALUE_TO_ID[rawVehicleValue] || "tata_ace");

  return {
    pickup: pickup?.value || "",
    drop: drop?.value || "",
    km,
    vehicleId,
    furniture,
    cartonQty: parseInt(document.getElementById("cartonQty")?.value || "0", 10),
    pickupFloor: parseInt(document.getElementById("pickupFloor")?.value || "0", 10),
    dropFloor: parseInt(document.getElementById("dropFloor")?.value || "0", 10),
    liftAvailable: !!document.getElementById("liftAvailable")?.checked,
    packingService: !!document.getElementById("packingService")?.checked,
    extraHelpers: parseInt(document.getElementById("extraHelpers")?.value || "0", 10),
    isInterstate: !!isIntercityMove,
    promoDiscount: promoDiscount || 0
  };
}

/**
 * Single source of truth for running the pricing engine and syncing
 * its result into the page's shared state (lastCalculatedTotal,
 * window._lastQuoteResult, window._lastCalculatedKm). Every call site
 * that needs a fresh quote should go through this function instead of
 * calling the engine directly.
 *
 * @param {number} km
 * @param {{silent?: boolean}} opts - silent suppresses error toasts
 *        (used for auto-recalculation on every keystroke/toggle).
 * @returns {object|null} the engine's quote result, or null if the
 *          engine isn't loaded / inputs are invalid.
 */
function runQuoteEngine(km, opts = {}) {
  const { silent = false } = opts;

  if (!window.PackZenPricing || typeof window.PackZenPricing.calculateQuote !== "function") {
    if (!silent) showToast("⚠️ Pricing engine not ready. Please try again.");
    return null;
  }

  const raw = buildQuoteRawPayload(km);
  const quote = window.PackZenPricing.calculateQuote(raw);

  window._lastQuoteResult = quote;
  window._lastQuoteRawInput = raw; // sent to the server at payment time so it can independently re-price the booking
  window._lastCalculatedKm = km;

  if (quote.valid) {
    lastCalculatedTotal = quote.finalTotal;
    updatePriceDisplay();
    if (currentUser) saveQuoteToFirestore(quote.finalTotal);
  } else {
    // Never leave a stale/₹0 price on screen without explanation.
    lastCalculatedTotal = 0;
    updatePriceDisplay();
    if (!silent && quote.errors && quote.errors.length > 0) {
      showToast("⚠️ " + quote.errors[0]);
    }
  }

  return quote;
}

function calculateQuote(auto = false) {
  const pickup = document.getElementById("pickup");
  const drop = document.getElementById("drop");

  if (!pickup?.value || !drop?.value) {
    if (!auto) showToast("📍 Please enter pickup & drop locations.");
    return;
  }

  // Guard: pricing engine must be loaded
  if (!window.PackZenPricing) {
    if (!auto) showToast("⚠️ Pricing engine not ready. Please try again.");
    return;
  }

  /**
   * applyPrice(km) — called once Google Maps returns the distance.
   * All pricing delegated to the Pricing Engine.
   */
  function applyPrice(km) {
    if (km == null || isNaN(km)) {
      showToast("Unable to calculate distance.");
      return;
    }

    // Update intercity badge and vehicle selector visibility
    detectAndShowIntercityBadge(km);

    // If intercity, clear vehicle selection (not required)
    if (isIntercityMove) {
      const vehicleField = document.getElementById("vehicle");
      if (vehicleField && vehicleField.value) {
        vehicleField.dataset.previous = vehicleField.value;
        vehicleField.value = "";
      }
    } else {
      const vehicleField = document.getElementById("vehicle");
      if (vehicleField && vehicleField.dataset.previous) {
        vehicleField.value = vehicleField.dataset.previous;
      }
    }

    runQuoteEngine(km, { silent: auto });
  }

  // ── Google Maps Distance Matrix (unchanged) ──────────────
  try {
    new google.maps.DistanceMatrixService().getDistanceMatrix({
      origins: [pickup.value],
      destinations: [drop.value],
      travelMode: "DRIVING"
    }, (res, status) => {
      const el = res?.rows?.[0]?.elements?.[0];
      if (status === "OK" && el?.status === "OK" && el?.distance?.value) {
        applyPrice(el.distance.value / 1000);
      } else {
        // Fallback: haversine distance
        if (pickupPlace?.geometry && dropPlace?.geometry) {
          const R = 6371;
          const p1 = pickupPlace.geometry.location;
          const p2 = dropPlace.geometry.location;
          const lat1 = p1.lat() * Math.PI / 180;
          const lat2 = p2.lat() * Math.PI / 180;
          const dLat = lat2 - lat1;
          const dLng = (p2.lng() - p1.lng()) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
          applyPrice(Math.max(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3, 5));
        } else {
          applyPrice(15);
        }
      }
    });
  } catch (e) {
    applyPrice(15);
  }
}

/* ============================================
PRICE DISPLAY
Reads lastCalculatedTotal (set by v2 engine via calculateQuote).
============================================ */
function updatePriceDisplay() {
  const priceEl = document.getElementById("livePrice");
  const advanceEl = document.getElementById("advanceAmount");
  const discRow = document.getElementById("discountRow");
  const discAmt = document.getElementById("discountAmt");
  const optAdv = document.getElementById("optAdvanceAmt");
  const optFull = document.getElementById("optFullAmt");
  const optAtDrop = document.getElementById("optAtDropAmt");
  syncQuoteSummary();
  if (!priceEl) return;

  // Payment options come from v2 engine if available, otherwise compute locally
  let paymentOpts;
  if (window._lastQuoteResult?.paymentOptions) {
    paymentOpts = window._lastQuoteResult.paymentOptions;
    // _lastQuoteResult.finalTotal already has promo baked in via v2
const discounted = paymentOpts.grandTotal;
    priceEl.textContent = "₹" + discounted.toLocaleString("en-IN");
    if (advanceEl) advanceEl.textContent = "₹" + paymentOpts.advanceAmount.toLocaleString("en-IN");
    if (optAdv) optAdv.textContent = "₹" + paymentOpts.advanceAmount.toLocaleString("en-IN");
    if (optFull) optFull.textContent = "₹" + paymentOpts.fullOnlineAmount.toLocaleString("en-IN");
    if (optAtDrop) optAtDrop.textContent = "₹" + discounted.toLocaleString("en-IN");
    if (promoDiscount > 0 && discRow) {
      discRow.style.display = "block";
      if (discAmt) discAmt.textContent = "₹" + promoDiscount.toLocaleString("en-IN");
    }
    syncPayOnlineButton(discounted, paymentOpts.advanceAmount, paymentOpts.fullOnlineAmount);
  } else {
    // Fallback if v2 result not yet available
    const discounted = Math.max(lastCalculatedTotal - promoDiscount, 0);
    const fullAmt = Math.max(discounted - 200, 0);
    const advanceAmt = Math.round(discounted * _advanceRate());
    priceEl.textContent = "₹" + discounted.toLocaleString("en-IN");
    if (advanceEl) advanceEl.textContent = "₹" + advanceAmt.toLocaleString("en-IN");
    if (optAdv) optAdv.textContent = "₹" + advanceAmt.toLocaleString("en-IN");
    if (optFull) optFull.textContent = "₹" + fullAmt.toLocaleString("en-IN");
    if (optAtDrop) optAtDrop.textContent = "₹" + discounted.toLocaleString("en-IN");
    if (promoDiscount > 0 && discRow) {
      discRow.style.display = "block";
      if (discAmt) discAmt.textContent = "₹" + promoDiscount.toLocaleString("en-IN");
    }
    syncPayOnlineButton(discounted, advanceAmt, fullAmt);
  }
}

function syncPayOnlineButton(total, advanceAmt, fullAmt) {
  const btn = document.getElementById("btnPayOnline");
  if (!btn) return;
  if (selectedPayment === "advance") btn.innerHTML = `💳 Pay Advance ₹${advanceAmt.toLocaleString("en-IN")}`;
  else if (selectedPayment === "full") btn.innerHTML = `💳 Pay Full ₹${fullAmt.toLocaleString("en-IN")} (Save ₹${window.PackZenPricing?.config?.payment?.fullPaymentDiscount || 200})`;
  else btn.innerHTML = `💳 Pay Online`;
  btn.style.display = (selectedPayment === "at_drop") ? "none" : "";
}

function selectPayment(type) {
  selectedPayment = type;

  ["optAdvance","optFull","optAtDrop"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove("selected");
  });

  const map = { advance: "optAdvance", full: "optFull", at_drop: "optAtDrop" };
  const selected = document.getElementById(map[type]);
  if (selected) selected.classList.add("selected");

  // Derive amounts — prefer v2 result
  let discounted, advanceAmt, fullAmt;
  if (window._lastQuoteResult?.paymentOptions) {
    const opts = window._lastQuoteResult.paymentOptions;
   discounted = opts.grandTotal;
    advanceAmt = opts.advanceAmount;
    fullAmt    = opts.fullOnlineAmount;
  } else {
    discounted = Math.max(lastCalculatedTotal - promoDiscount, 0);
    advanceAmt = Math.round(discounted * _advanceRate());
    fullAmt    = Math.max(discounted - 200, 0);
  }

  const payBtn = document.getElementById("btnPayOnline");
  const confirmBtn = document.getElementById("dynamicBookingBtn");

  if (type === "advance") {
    if (payBtn) { payBtn.style.display = ""; payBtn.innerHTML = `💰 Pay Advance ₹${advanceAmt.toLocaleString("en-IN")}`; }
    if (confirmBtn) confirmBtn.style.display = "none";
  } else if (type === "full") {
    if (payBtn) { payBtn.style.display = ""; payBtn.innerHTML = `✅ Pay Full ₹${fullAmt.toLocaleString("en-IN")}`; }
    if (confirmBtn) confirmBtn.style.display = "none";
  } else {
    if (payBtn) payBtn.style.display = "none";
    if (confirmBtn) confirmBtn.style.display = "";
  }

  syncPayOnlineButton(discounted, advanceAmt, fullAmt);
}

function handleBookingAction() {
  if (selectedPayment === "advance" || selectedPayment === "full") {
    startPayment();
  } else {
    bookWithoutPayment();
  }
}

/* ============================================
PAYMENT AMOUNT HELPERS
Returns the correct amount to charge based on selectedPayment.
Always derived from v2 engine result.
============================================ */
// Single source of truth for the advance rate used in fallback paths —
// reads the engine's own config instead of a hardcoded literal, so this
// can never silently drift out of sync with pricing-engine-v2.js again.
function _advanceRate() {
  return (window.PackZenPricing?.config?.payment?.advancePercent ?? 10) / 100;
}

function _getPayAmount() {
  if (window._lastQuoteResult?.paymentOptions) {
    const opts = window._lastQuoteResult.paymentOptions;
    if (selectedPayment === "full")    return Math.max(opts.fullOnlineAmount, 500);
if (selectedPayment === "advance") return Math.max(opts.advanceAmount, 199);
    return opts.grandTotal;
  }
  // Fallback
  const discounted = Math.max(lastCalculatedTotal - promoDiscount, 0);
  if (selectedPayment === "full")    return Math.max(discounted - 200, 500);
  if (selectedPayment === "advance") return Math.max(Math.round(discounted * _advanceRate()), 199);
  return discounted;
}

function _getDiscountedTotal() {
 if (window._lastQuoteResult?.paymentOptions) {
    return window._lastQuoteResult.paymentOptions.grandTotal;
  }
  return Math.max(lastCalculatedTotal - promoDiscount, 0);
}

/* ============================================
PAYMENT (RAZORPAY)
============================================ */
function startRazorpayPayment() { startPayment(); }

async function startPayment() {
  if (isProcessingPayment) return;
  isProcessingPayment = true;
  const payBtn = document.getElementById("btnPayOnline");
  if (payBtn) { payBtn.disabled = true; payBtn.innerText = "Processing..."; }

  if (!currentUser) { showToast("👋 Please login to book."); openAuthModal("login"); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }
  if (!document.getElementById("tncAccepted")?.checked) { showToast("⚠️ Please accept the Terms & Conditions."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }

  const name = document.getElementById("custName")?.value?.trim();
  const phone = document.getElementById("custPhone")?.value?.trim();
  const email = document.getElementById("custEmail")?.value?.trim();
  if (!name) { showToast("⚠️ Please enter your name."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }
  if (!phone || !/^\d{10}$/.test(phone)) { showToast("⚠️ Please enter a valid 10-digit phone number."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast("⚠️ Please enter a valid email address."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }
  if (lastCalculatedTotal === 0) { showToast("⚠️ Price not calculated yet."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }
  if (!RAZORPAY_KEY) { showToast("⚠️ Payment not configured."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }

  if (selectedPayment === "at_drop") { bookWithoutPayment(); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }

  // Amount from v2 engine
  const payAmount = _getPayAmount();

  paymentReceiptId = "PKZ-" + Date.now();

  const pickupField = document.getElementById("pickup")?.value;
  const dropField = document.getElementById("drop")?.value;
  const shiftDate = document.getElementById("shiftDate")?.value;

  if (!pickupField || !dropField) { showToast("Please enter pickup and drop location."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }
  if (!shiftDate) { showToast("Please select shifting date."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }

  console.log("Client-displayed amount (UI only — server re-prices this):", payAmount);

  if (!window._lastQuoteRawInput) { showToast("⚠️ Price not calculated yet."); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }

  try {
    const orderResponse = await fetch("https://asia-south1-packzen-e7539.cloudfunctions.net/createRazorpayOrder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteInput: window._lastQuoteRawInput,
        paymentType: selectedPayment, // "full" | "advance" — server derives the actual amount
        customerName: name, phone: phone, moveType: selectedMoveType,
        pickup: pickupField, drop: dropField, date: shiftDate
      })
    });
    const orderData = await orderResponse.json();
    console.log("Razorpay API response:", orderData);
    if (!orderData.success) { showToast("Failed to create payment order"); isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } return; }

    // The server is the source of truth for the amount actually charged —
    // use it for what we display from here on, not the client-side guess.
    const serverTotal = orderData.serverCalculatedTotal;

    const rzp = new Razorpay({
      key: RAZORPAY_KEY, amount: orderData.amount, currency: orderData.currency, order_id: orderData.orderId,
      name: "PackZen Packers & Movers", description: selectedPayment === "full" ? "Full Payment" : "Advance Payment",
      prefill: { name, contact: phone }, theme: { color: "#ea580c" },
      handler: async function (response) {
        try {
          const verifyResponse = await fetch("https://asia-south1-packzen-e7539.cloudfunctions.net/verifyRazorpayPayment", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              bookingData: { email: email || null }
            })
          });
          const verifyData = await verifyResponse.json();
          if (!verifyData.success) { showToast("Payment verification failed"); return; }
          isProcessingPayment = false;
          if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; }
          showToast("✅ Payment successful!");
          showConfirmationCard({
            bookingRef: verifyData.bookingRef || paymentReceiptId,
            name: name, phone: phone, pickup: pickupField, drop: dropField, date: shiftDate,
            house: document.getElementById("house")?.options[document.getElementById("house")?.selectedIndex]?.text || "",
            vehicle: document.getElementById("vehicle")?.options[document.getElementById("vehicle")?.selectedIndex]?.text || "",
            total: serverTotal || payAmount,
            paymentLabel: selectedPayment === "full" ? "Paid Full Online" : "Advance Paid Online",
            paymentNote: "Payment ID: " + response.razorpay_payment_id,
            source: "payment", showInvoice: true
          });
        } catch (err) {
          console.error("Verify error:", err);
          isProcessingPayment = false;
          if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; }
          showToast("✅ Payment received! Booking confirmed.");
          showConfirmationCard({
            bookingRef: paymentReceiptId,
            name: name, phone: phone, pickup: pickupField, drop: dropField, date: shiftDate,
            house: document.getElementById("house")?.options[document.getElementById("house")?.selectedIndex]?.text || "",
            vehicle: document.getElementById("vehicle")?.options[document.getElementById("vehicle")?.selectedIndex]?.text || "",
            total: payAmount,
            paymentLabel: selectedPayment === "full" ? "Paid Full Online" : "Advance Paid Online",
            paymentNote: "Payment received via Razorpay — ID: " + response.razorpay_payment_id,
            source: "payment", showInvoice: true
          });
        }
      },
      modal: { ondismiss: () => { isProcessingPayment = false; if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; } } }
    });
    rzp.open();
    rzp.on("payment.failed", r => {
      isProcessingPayment = false;
      if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; }
      showToast("❌ Payment failed: " + r.error.description);
    });
  } catch (err) {
    console.log("Caught exception:", err);
    isProcessingPayment = false;
    if (payBtn) { payBtn.disabled = false; payBtn.innerText = "Pay Now"; }
    showToast("Payment error: " + err.message);
  }
}

function onPaymentSuccess(response, name, phone, email, paid, total) {
  const pickup = document.getElementById("pickup");
  const drop = document.getElementById("drop");
  const shiftDate = document.getElementById("shiftDate");
  const houseEl = document.getElementById("house");
  const vehicleEl = document.getElementById("vehicle");
  const bookingRef = "PKZ-" + Date.now().toString(36).toUpperCase();
  showConfirmationCard({
    bookingRef, name, phone, pickup: pickup?.value || "—", drop: drop?.value || "—", date: shiftDate?.value || "TBD",
    house: houseEl?.options[houseEl?.selectedIndex]?.text || "—", vehicle: vehicleEl?.options[vehicleEl?.selectedIndex]?.text || "—",
    total, paymentLabel: selectedPayment === "full" ? `Paid Full — ₹${paid.toLocaleString("en-IN")}` : `Advance ₹${paid.toLocaleString("en-IN")} paid`,
    paymentNote: `Payment ID: ${response.razorpay_payment_id}`, source: "payment", showInvoice: true
  });
 if (window._firebase) {
    const activeUser = currentUser || window._firebase?.auth?.currentUser;
    const discountedTotal = _getDiscountedTotal();
    const payload = {
      bookingRef, customerUid: activeUser?.uid, customerName: name,
      phone,
      altPhone: document.getElementById("custAltPhone")?.value.trim() || "",
      email,
      pickup: pickup?.value || "", drop: drop?.value || "", moveType: selectedMoveType,
      house: houseEl?.options[houseEl?.selectedIndex]?.text || "",
      vehicle: vehicleEl?.options[vehicleEl?.selectedIndex]?.text || "",
      furniture: getFurnitureSummary(),
      pickupFloor: document.getElementById("pickupFloor")?.options[document.getElementById("pickupFloor")?.selectedIndex]?.text || "",
      dropFloor: document.getElementById("dropFloor")?.options[document.getElementById("dropFloor")?.selectedIndex]?.text || "",
      liftAvailable: !!document.getElementById("liftAvailable")?.checked,
      packingService: !!document.getElementById("packingService")?.checked,
      unpackingService: !!document.getElementById("unpackingService")?.checked,
      dismantling: !!document.getElementById("dismantlingService")?.checked,
      assembly: !!document.getElementById("assemblyService")?.checked,
storageNeeded: !!document.getElementById("storageService")?.checked,
    storageDays: parseInt(document.getElementById("storageDays")?.value || 0, 10),
      fragileItems: document.getElementById("custFragileItems")?.value.trim() || "",
      specialItems: document.getElementById("custSpecialItems")?.value.trim() || "",
      remarks: document.getElementById("custRemarks")?.value.trim() || "",
      total: discountedTotal,
      originalTotal: lastCalculatedTotal,
      paid,
      paymentType: selectedPayment,
      promoDiscount,
      date: shiftDate?.value || "",
      shiftTime: document.getElementById("shiftTime")?.value || "",
      shiftTimeLabel: document.getElementById("shiftTimeLabel")?.value || "",
      status: "confirmed",
      source: "payment",
      isIntercity: isIntercityMove,
      distance: window._lastCalculatedKm || 0,
      quoteBreakdown: window._lastQuoteResult?.breakdown || null,
      paymentId: response.razorpay_payment_id,
     photos: uploadedPhotos.slice(0, 3),
      deliveryOtp: generateDeliveryOtp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    window.PackZenShared.createBooking(payload, (docId) => {
      currentBookingId = docId;
      localStorage.setItem("packzen_active_booking", docId);
      requestPushPermission();
      subscribeToBookingNotifications(docId);
    }, (err) => {
      console.error("BOOKING SAVE FAILED:", err);
      showToast("❌ Booking save failed: " + err.message);
    });
  }
}

/* ============================================
SHARED BOOKING CREATION LOGIC
============================================ */
window.PackZenShared.createBooking = async function(payload, onComplete, onError) {
  if (!window._firebase) {
    if (onError) onError(new Error("Firebase not ready."));
    return;
  }
  try {
    const docRef = await window._firebase.db.collection("bookings").add(payload);

    // Attempt notifications in background
    try {
      queueSMS(payload.phone, "booking_confirmed", {
        name: payload.customerName,
        bookingRef: payload.bookingRef,
        date: payload.date || "TBD",
        pickup: payload.pickup || "",
        total: payload.total
      });
      notifyOwner(
        payload.bookingRef,
        payload.customerName,
        payload.phone,
        payload.pickup || "—",
        payload.drop || "—",
        payload.date || "TBD",
        payload.total,
        payload.paymentType,
        payload.source || "online" // Fallback to online if missing
      );
    } catch(e) {}

    if (onComplete) onComplete(docRef.id);
  } catch(err) {
    if (onError) onError(err);
  }
};

/* ============================================
NOTIFY OWNER
============================================ */
function notifyOwner(bookingRef, name, phone, pickup, drop, date, total, paymentType, source) {
  const payLbl = paymentType === "pay_later" ? "Cash on delivery" : paymentType === "full" ? "Paid Full" : "Advance Paid";
  const emoji = source === "whatsapp" ? "💬" : source === "payment" ? "💳" : "📋";
  const msg = `${emoji} New Booking Alert — PackZen 🚚\n\nID: ${bookingRef}\nName: ${name}\nPhone: +91 ${phone}\nPickup: ${pickup}\nDrop: ${drop}\nDate: ${date || "To be confirmed"}\nAmount: ₹${Number(total).toLocaleString("en-IN")}\nPayment: ${payLbl}`;
  console.log("📲 Owner notification:", msg);
  try {
    fetch("https://n8n-production-e685.up.railway.app/webhook/owner-notification", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingRef, name, phone, pickup, drop, date, total, paymentType, source })
    }).catch(() => {});
  } catch(e) {}
}

/* ============================================
BOOK WITHOUT PAYMENT
============================================ */
function bookWithoutPayment() {
  const activeUser = currentUser || window._firebase?.auth?.currentUser;
  if (!activeUser) { showToast("👋 Please login to book."); openAuthModal("login"); return; }
  if (!document.getElementById("tncAccepted")?.checked) { showToast("⚠️ Please accept the Terms & Conditions to continue."); return; }

  const nameEl = document.getElementById("custName");
  const phoneEl = document.getElementById("custPhone");
  const emailEl = document.getElementById("custEmail");
  const name = nameEl?.value?.trim();
  const phone = phoneEl?.value?.trim();
  const email = emailEl?.value?.trim();
  if (!name) { nameEl.style.borderColor = "#e53e3e"; nameEl.focus(); return; }
  if (!phone || phone.length < 10) { phoneEl.style.borderColor = "#e53e3e"; phoneEl.focus(); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailEl.style.borderColor = "#e53e3e"; emailEl.focus(); return; }
  if (lastCalculatedTotal === 0) { showToast("⚠️ Price not calculated yet."); return; }
  if (!window._firebase) { showToast("⚠️ Service not ready. Try again."); return; }

  const date = document.getElementById("shiftDate")?.value || "";
  if (!date) { showToast("📅 Please select a moving date."); return; }

  const pickupVal = document.getElementById("pickup")?.value || "";
  const dropVal = document.getElementById("drop")?.value || "";
  const bookingRef = "PKZ-" + Date.now().toString(36).toUpperCase().slice(-6);
  const btn = document.querySelector(".btn-pay");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Saving..."; }

  const houseEl = document.getElementById("house");
  const vehicleEl = document.getElementById("vehicle");
  // Use v2 engine total as the canonical total
  const discountedTotal = _getDiscountedTotal();

 const payload = {
    bookingRef,
    customerUid: activeUser.uid,
    customerName: name,
    phone,
    altPhone: document.getElementById("custAltPhone")?.value.trim() || "",
    email,
    pickup: pickupVal,
    drop: dropVal,
    date,
    shiftTime: document.getElementById("shiftTime")?.value || "",
    shiftTimeLabel: document.getElementById("shiftTimeLabel")?.value || "",
    moveType: selectedMoveType,
    house: houseEl?.options[houseEl?.selectedIndex]?.text || "",
    vehicle: vehicleEl?.options[vehicleEl?.selectedIndex]?.text || "",
    furniture: getFurnitureSummary(),
    pickupFloor: document.getElementById("pickupFloor")?.options[document.getElementById("pickupFloor")?.selectedIndex]?.text || "",
    dropFloor: document.getElementById("dropFloor")?.options[document.getElementById("dropFloor")?.selectedIndex]?.text || "",
    liftAvailable: !!document.getElementById("liftAvailable")?.checked,
    packingService: !!document.getElementById("packingService")?.checked,
    unpackingService: !!document.getElementById("unpackingService")?.checked,
    dismantling: !!document.getElementById("dismantlingService")?.checked,
    assembly: !!document.getElementById("assemblyService")?.checked,
    storageNeeded: !!document.getElementById("storageService")?.checked,
    storageDays: parseInt(document.getElementById("storageDays")?.value || 0, 10),
    fragileItems: document.getElementById("custFragileItems")?.value.trim() || "",
    specialItems: document.getElementById("custSpecialItems")?.value.trim() || "",
    remarks: document.getElementById("custRemarks")?.value.trim() || "",
    total: discountedTotal,
    originalTotal: lastCalculatedTotal,
    paid: 0,
    paymentType: "pay_later",
    status: "confirmed",
    source: "direct",
    promoDiscount,
    distance: window._lastCalculatedKm || 0,
    quoteBreakdown: window._lastQuoteResult?.breakdown || null,
   photos: uploadedPhotos.slice(0, 3),
    deliveryOtp: generateDeliveryOtp(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  window.PackZenShared.createBooking(payload, (docId) => {
    currentBookingId = docId;
    localStorage.setItem("packzen_active_booking", docId);

    if (btn) {
      btn.disabled = false;
      btn.textContent = "📋 Confirm Booking · Pay on Delivery";
    }

    showConfirmationCard({
      bookingRef,
      name,
      phone: "+91 " + phone,
      pickup: pickupVal,
      drop: dropVal,
      date,
      house: houseEl?.options[houseEl?.selectedIndex]?.text || "—",
      vehicle: vehicleEl?.options[vehicleEl?.selectedIndex]?.text || "—",
      total: discountedTotal,
      paymentLabel: "Cash on moving day",
      paymentNote: "Pay full amount to driver on moving day",
      source: "direct",
      showInvoice: false
    });

    showToast("✅ Booking saved! ID: " + bookingRef);
  })
  .catch((err) => {
    console.error("BOOKING SAVE FAILED:", err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "📋 Confirm Booking · Pay on Delivery";
    }
    showToast("❌ Booking failed: " + err.message);
  });
}

function toggleConfirmDetails() {
  const fullDetails = document.getElementById("ccFullDetails");
  const expandBtn = document.getElementById("ccExpandBtn");
  if (!fullDetails) return;
  const isOpen = fullDetails.style.display !== "none";
  fullDetails.style.display = isOpen ? "none" : "block";
  if (expandBtn) expandBtn.textContent = isOpen ? "View Full Details ↓" : "Hide Details ↑";
}

function closeModal() {

    // Close confirmation popup
    document.getElementById("paymentModal").style.display = "none";

    // Restore booking form
    document.querySelectorAll(".form-step").forEach(step => {
        step.style.display = "";
    });

    const stepHeader = document.querySelector(".step-header");
    if (stepHeader) {
        stepHeader.style.display = "";
    }

    // Open booking sheet again
    const bookingSheet = document.getElementById("bookingSheet");
    if (bookingSheet) {
        bookingSheet.style.display = "block";
        bookingSheet.classList.add("open");
    }

    const overlay = document.getElementById("bookingSheetOverlay");
    if (overlay) {
        overlay.classList.add("open");
    }

    // Return to first step
    currentStep = 0;
    showStep(0);

    // If booking exists, show tracking banner
    if (currentBookingId) {
        showTrackOrderBanner();
    }
}
function showBookingSuccessState() {

    const successEl = document.getElementById("bookingSuccessState");

    if(successEl){
        successEl.style.display = "block";
    }

    const bsId = document.getElementById("bsBookingId");

    if(bsId){
        bsId.textContent =
            document.getElementById("bookingIdDisplay")?.textContent || "—";
    }

}

function scrollToTrackBanner() {
  const banner = document.getElementById("trackOrderBanner");
  if (banner) {
    const navH = document.querySelector(".app-bar")?.offsetHeight || 65;
    const safeTopStr = getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim();
    let safeTop = 0;
    if (safeTopStr.includes('px')) {
      safeTop = parseInt(safeTopStr) || 0;
    }
    // ensure that the scroll accounts for the header plus some padding
    window.scrollTo({ top: banner.getBoundingClientRect().top + window.scrollY - navH - safeTop - 8, behavior: "smooth" });
  }
}

function startNewBooking() {
  const successEl = document.getElementById("bookingSuccessState");
  if (successEl) successEl.style.display = "none";
  document.querySelectorAll(".form-step").forEach(s => s.style.display = "");
  const stepHeader = document.querySelector(".step-header");
  if (stepHeader) stepHeader.style.display = "";
  resetBookingForm();
}

function resetBookingForm() {
  currentStep = 0; showStep(0);
  ["pickup","drop","house","vehicle","moveType"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  ["custName","custPhone","custAltPhone","custFragileItems","custSpecialItems","custRemarks","storageDays"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  ["packingService","unpackingService","dismantlingService","assemblyService","storageService"].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
  document.querySelectorAll(".move-type-card, .select-card, .vehicle-card").forEach(c => c.classList.remove("selected"));
  selectedMoveType = null;
  const mapDiv = document.getElementById("map");
  if (mapDiv) {
    mapDiv.style.display = "block";
    mapDiv.style.height = "400px";
  }
  if (map) google.maps.event.trigger(map, "resize");
  if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
  promoDiscount = 0;
  lastCalculatedTotal = 0;
  // Clear v2 result cache
  window._lastQuoteResult = null;
  window._lastCalculatedKm = 0;
  updatePriceDisplay();
  initPaymentOptions();
  setTimeout(() => renderSizeCards("home"), 100);
}

function showTrackOrderBanner() {
  const banner = document.getElementById("trackOrderBanner");
  if (!banner) return;
  const tobId = document.getElementById("tobBookingId");
  if (tobId) tobId.textContent = document.getElementById("bookingIdDisplay")?.textContent || "—";
  banner.style.display = "block";
  setTimeout(() => {
    const quoteSection = document.getElementById("quote");
    if (quoteSection) {
      const navH = document.querySelector("nav")?.offsetHeight || 65;
      window.scrollTo({ top: quoteSection.getBoundingClientRect().top + window.scrollY - navH - 10, behavior: "smooth" });
    }
  }, 200);
  startBannerTracking();
}

function startBannerTracking() {
  if (!currentBookingId || !window._firebase) return;
  window._firebase.db.collection("bookings").doc(currentBookingId)
    .onSnapshot(doc => { if (!doc.exists) return; updateTrackBanner(doc.data()); });
}

function updateTrackBanner(b) {
  const statusOrder = ["confirmed","assigned","packing","transit","delivered"];
  const statusLabels = { confirmed:"Confirmed", assigned:"Driver Assigned", packing:"Packing Started", transit:"In Transit 🚚", delivered:"Delivered ✅" };
  const idx = statusOrder.indexOf(b.status || "confirmed");
  if (b.status === "delivered" || b.status === "cancelled") {
    localStorage.removeItem("packzen_active_booking");
    setTimeout(() => dismissTrackBanner(), 3000);
  }
  const labelEl = document.getElementById("tobStatusLabel");
  if (labelEl) labelEl.textContent = statusLabels[b.status] || b.status || "Confirmed";
  const fill = document.getElementById("tobProgressFill");
  if (fill) fill.style.width = ((idx / (statusOrder.length - 1)) * 100) + "%";
  statusOrder.forEach((s, i) => {
    const step = document.getElementById("tobs" + i);
    if (!step) return;
    step.className = "tob-step";
    if (i < idx) step.classList.add("done");
    if (i === idx) step.classList.add("active");
  });
  const otpRow = document.getElementById("tobOtpRow");
  const otpVal = document.getElementById("tobOtpValue");
  const showOtp = ["assigned","packing","transit","delivered"].includes(b.status) && b.deliveryOtp;
  if (otpRow) {
    otpRow.style.display = showOtp ? "block" : "none";
    if (showOtp && otpVal) otpVal.textContent = b.deliveryOtp;
  }
  const banner = document.getElementById("trackOrderBanner");
  if (b.status === "delivered" && banner) {
    banner.style.background = "linear-gradient(135deg,#15803d,#16a34a)";

    
    const title = banner.querySelector(".tob-title");
    if (title) title.textContent = "🎉 Your Move is Complete!";
  }
}

async function checkAndShowActiveBooking(uid) {
  if (!window._firebase) return;
  try {
    const savedId = localStorage.getItem("packzen_active_booking");
    if (savedId) {
      const doc = await window._firebase.db.collection("bookings").doc(savedId).get();
      if (doc.exists) {
        const b = doc.data();
        if (["confirmed","assigned","packing","transit"].includes(b.status) && b.customerUid === uid) {
          currentBookingId = savedId;
          const tobId = document.getElementById("tobBookingId");
          if (tobId) tobId.textContent = b.bookingRef || savedId.slice(0,8).toUpperCase();
          document.getElementById("trackOrderBanner").style.display = "block";
          updateTrackBanner(b); startBannerTracking(); return;
        } else localStorage.removeItem("packzen_active_booking");
      }
    }
    const snap = await window._firebase.db.collection("bookings")
      .where("customerUid","==",uid)
      .where("status","in",["confirmed","assigned","packing","transit"])
      .limit(1).get();
    if (snap.empty) return;
    const doc = snap.docs[0]; const b = doc.data();
    currentBookingId = doc.id; localStorage.setItem("packzen_active_booking", doc.id);
    const tobId = document.getElementById("tobBookingId");
    if (tobId) tobId.textContent = b.bookingRef || doc.id.slice(0,8).toUpperCase();
    document.getElementById("trackOrderBanner").style.display = "block";
    updateTrackBanner(b); startBannerTracking();
  } catch(e) {}
}

function dismissTrackBanner() {
  const banner = document.getElementById("trackOrderBanner");
  if (banner) banner.style.display = "none";
}

function openTrackingOrLogin() {
  if (!currentUser) { showToast("💡 Create an account to track your booking!"); openAuthModal("login"); return; }
  openTrackingModal();
}

/* ============================================
SHOW CONFIRMATION CARD
============================================ */
function showConfirmationCard(data) {
  const {
    bookingRef, name, phone, pickup, drop, date,
    house, vehicle, total, paymentLabel, paymentNote, showInvoice
  } = data;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || "—"; };

  set("bookingIdDisplay", bookingRef);
  set("ccTitle", "Booking Confirmed! 🎉");
  set("ccSubtitle", "We'll call you within 30 minutes");
  set("ccName", name);
  set("ccPhone", phone);
  set("ccPickup", pickup);
  set("ccDrop", drop);
  set("ccPickupShort", (pickup || "").split(",")[0]);
  set("ccDropShort", (drop || "").split(",")[0]);
  set("ccDate", date);
  set("ccHouse", house);
  set("ccVehicle", vehicle);
  set("ccAmount", "₹" + Number(total).toLocaleString("en-IN"));
  set("ccPayment", paymentLabel);
  set("ccPriceNote", paymentNote);

  const invoiceBtn = document.getElementById("btnInvoice");
  if (invoiceBtn) invoiceBtn.style.display = showInvoice ? "inline-flex" : "none";
  const emailInvoiceBtn = document.getElementById("btnEmailInvoice");
  if (emailInvoiceBtn) emailInvoiceBtn.style.display = showInvoice ? "inline-flex" : "none";

  document.getElementById("paymentModal").style.display = "flex";
}

/* ============================================
TRACKING MODAL
============================================ */
let trackingMinimized = false;

function openTrackingModal() {
  document.getElementById("userDropdown")?.classList.remove("open");

  if (!currentUser) {
    openAuthModal("login");
    return;
  }

  trackingMinimized = false;

  const modal = document.getElementById("trackingModal");

  modal.style.display = "flex";
  modal.classList.remove("tracking-minimized");

  loadTrackingData();
}

function closeTrackingModal() {
  trackingMinimized = false;

  document.getElementById("trackingModal").style.display = "none";
  document
    .getElementById("trackingModal")
    .classList.remove("tracking-minimized");

  if (trackingListener) {
    trackingListener();
    trackingListener = null;
  }
}

function loadTrackingData() {
  if (!currentUser || !window._firebase) return;
  if (trackingListener) { trackingListener(); trackingListener = null; }
  trackingListener = window._firebase.db.collection("bookings")
    .where("customerUid","==",currentUser.uid).limit(1)
    .onSnapshot(snap => {
      if (snap.empty) { document.getElementById("trackingBookingId").textContent = "No active booking"; return; }
      const booking = { id: snap.docs[0].id, ...snap.docs[0].data() };
      currentBookingId = booking.id;
      updateTrackingUI(booking);
    });
}

function updateTrackingUI(b) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("trackingBookingId", "#" + b.id.slice(-6).toUpperCase());
  set("trackStatus", capitalize(b.status || "confirmed"));
  set("trackVehicle", b.vehicle || "—");
  set("trackVehicleReg", b.driverVehicleReg || b.vehicleNumber || b.vehicleRegistration || "—");
  set("trackDriver", b.driverName || "Not yet assigned");

  const phoneEl = document.getElementById("trackDriverPhone");
  if (phoneEl) {
    phoneEl.textContent = b.driverPhone || "—";
    if (b.driverPhone) phoneEl.href = "tel:" + b.driverPhone;
    else phoneEl.removeAttribute("href");
  }

  set("trackDate", b.date || "—");

  if (b.status !== "delivered" && b.status !== "completed") {
    set("trackEstArrival", b.time ? b.date + " " + b.time : b.date);
  } else {
    set("trackEstArrival", "Arrived");
  }

  set("trackPickup", b.pickup || "—");
  set("trackDrop", b.drop || "—");

  const lastUpdated = b.updatedAt || b.rescheduledAt || b.createdAt;
  if (lastUpdated) {
    const dt = lastUpdated.toDate ? lastUpdated.toDate() : new Date(lastUpdated);
    set("trackLastUpdated", dt.toLocaleString("en-IN"));
  } else {
    set("trackLastUpdated", "—");
  }

  const completedRow = document.getElementById("rowTrackCompletedAt");
  if (b.completedAt && completedRow) {
    const dt = b.completedAt.toDate ? b.completedAt.toDate() : new Date(b.completedAt);
    set("trackCompletedAt", dt.toLocaleString("en-IN"));
    completedRow.style.display = "flex";
  } else if (completedRow) {
    completedRow.style.display = "none";
  }

  const order = ["confirmed","assigned","en_route","arrived","loading","transit","delivered","unloading","completed"];
  const icons = ["✓","🚛","📍","🏠","📦","🚚","🏁","📥","🎉"];
  const idx = order.indexOf(b.status || "confirmed");
  order.forEach((s, i) => {
    const dot = document.getElementById("ts" + i);
    if (!dot) return;
    dot.className = "ts-dot";
    if (i < idx) { dot.classList.add("done"); dot.textContent = "✓"; }
    if (i === idx) { dot.classList.add("active"); dot.textContent = icons[i]; }
    if (i > idx) dot.textContent = icons[i];
  });
  if (b.driverLat && b.driverLng) updateTrackingMap(b.driverLat, b.driverLng);
}

function updateTrackingMap(lat, lng) {
  const mapDiv = document.getElementById("trackingMapDiv");
  if (typeof google !== "undefined" && google.maps) {
    mapDiv.innerHTML = ""; mapDiv.style.height = "200px";
    if (!trackingMap) {
      trackingMap = new google.maps.Map(mapDiv, { center: { lat, lng }, zoom: 14 });
    }
    const pos = { lat, lng };
    trackingMap.setCenter(pos);
    if (trackingDriverMarker) trackingDriverMarker.setPosition(pos);
    else trackingDriverMarker = new google.maps.Marker({ map: trackingMap, position: pos, title: "Your Driver" });
  } else {
    mapDiv.innerHTML = `Driver at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

/* ============================================
CHAT MODAL
============================================ */
function openChatModal() {
  document.getElementById("userDropdown")?.classList.remove("open");
  if (!currentUser) { openAuthModal("login"); return; }
  document.getElementById("chatModal").style.display = "flex";
  if (currentBookingId && window._firebase) {
    window._firebase.db.collection("bookings").doc(currentBookingId).get().then(doc => {
      if (!doc.exists) return;
      const b = doc.data();
      const el = id => document.getElementById(id);
      if (b.driverName) {
        if (el("chatDrvName")) el("chatDrvName").textContent = b.driverName;
        if (el("chatDrvStatus")) el("chatDrvStatus").textContent = b.driverPhone || "Your Driver";
        if (el("chatDrvAvatar")) el("chatDrvAvatar").textContent = b.driverName.charAt(0).toUpperCase();
      }
    });
  }
  loadChatMessages();
}

function closeChatModal() {
  document.getElementById("chatModal").style.display = "none";
  if (chatListener) { chatListener(); chatListener = null; }
}

function loadChatMessages() {
  if (!window._firebase || !currentBookingId) {
    window._firebase?.db.collection("bookings").where("customerUid","==",currentUser.uid).orderBy("createdAt","desc").limit(1)
      .get().then(snap => {
        if (!snap.empty) { currentBookingId = snap.docs[0].id; listenChatMessages(); }
        else renderChatEmpty();
      });
    return;
  }
  listenChatMessages();
}

function listenChatMessages() {
  if (!currentBookingId) { renderChatEmpty(); return; }
  if (chatListener) { chatListener(); chatListener = null; }
  chatListener = window._firebase.db.collection("chats").doc(currentBookingId)
    .collection("messages").orderBy("time","asc")
    .onSnapshot(snap => {
      const container = document.getElementById("chatMessages");
      if (snap.empty) { container.innerHTML = 'No messages yet. Say hello! 👋'; return; }
      container.innerHTML = "";
      snap.forEach(d => {
        const msg = d.data();
        const isMine = msg.senderUid === currentUser?.uid;
        const time = msg.time?.toDate ? msg.time.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "";
      const senderLabel = (!isMine && msg.senderName) ? `<span class="chat-sender">${escapeHTML(msg.senderName)}</span>` : "";
        container.innerHTML += `<div class="chat-bubble ${isMine?"mine":"theirs"}">${senderLabel}<div>${escapeHTML(msg.text)}</div><div class="chat-time">${time}</div></div>`;
      });
      container.scrollTop = container.scrollHeight;
    });
}

function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !currentBookingId) return;
  input.value = "";
  window._firebase?.db.collection("chats").doc(currentBookingId).collection("messages").add({
    text, senderUid: currentUser?.uid, senderName: currentUser?.displayName || "Customer",
    role: "customer", time: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(e => showToast("Send failed: " + e.message));
}

function renderChatEmpty() {
  document.getElementById("chatMessages").innerHTML = 'No active booking found. Book a move to chat with your driver.';
}

/* ============================================
MOVING CHECKLIST
============================================ */
const CHECKLIST_DATA = {
  "2 Weeks Before": ["Notify your landlord / society","Contact PackZen for booking confirmation","Start collecting packing boxes","Sort items — keep, donate, discard","Update your address with bank & insurance"],
  "1 Week Before": ["Start packing non-essential items","Label all boxes by room","Pack fragile items with extra padding","Defrost refrigerator","Arrange for parking at both locations"],
  "Moving Day": ["Check all rooms before leaving","Ensure utilities are transferred","Take photos of all packed items","Keep essentials bag with you","Verify all boxes are loaded","Do a final walkthrough of old home"],
  "After Moving": ["Unpack essentials first","Check all items for damage","Update Aadhaar address","Connect utilities at new home","Leave a review for PackZen ⭐"]
};

function buildChecklist() {
  const container = document.getElementById("checklistContent");
  if (!container) return;
  const saved = JSON.parse(localStorage.getItem("packzen-checklist") || "{}");
  let html = "";
  Object.entries(CHECKLIST_DATA).forEach(([cat, items]) => {
    html += `<div class="cl-category">${cat}</div>`;
    items.forEach((item, i) => {
      const key = cat + i, done = saved[key];
      html += `<div class="cl-item ${done?'done':''}" data-check-key="${key}" role="button" tabindex="0"><div class="cl-check">${done?'✓':''}</div><div class="cl-text">${item}</div></div>`;
    });
  });
  container.innerHTML = html;
  container.querySelectorAll('.cl-item[data-check-key]').forEach(item => {
    item.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleChecklist(this.getAttribute('data-check-key'), this); });
  });
  updateChecklistProgress();
}

function toggleChecklist(key, el) {
  const saved = JSON.parse(localStorage.getItem("packzen-checklist") || "{}");
  saved[key] = !saved[key];
  localStorage.setItem("packzen-checklist", JSON.stringify(saved));
  el.classList.toggle("done");
  el.querySelector(".cl-check").textContent = el.classList.contains("done") ? "✓" : "";
  updateChecklistProgress();
}

function updateChecklistProgress() {
  const saved = JSON.parse(localStorage.getItem("packzen-checklist") || "{}");
  const total = Object.values(CHECKLIST_DATA).reduce((s, a) => s + a.length, 0);
  const done = Object.values(saved).filter(Boolean).length;
  const bar = document.getElementById("clProgressBar");
  const score = document.getElementById("clScore");
  if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 0) + "%";
  if (score) score.textContent = `${done} / ${total}`;
}

function openChecklist() { document.getElementById("userDropdown")?.classList.remove("open"); buildChecklist(); document.getElementById("checklistModal").style.display = "flex"; }
function closeChecklist() { document.getElementById("checklistModal").style.display = "none"; }

/* ============================================
REVIEWS
============================================ */
function openReviewModal() { document.getElementById("reviewModal").style.display = "flex"; currentRating = 0; }
function closeReviewModal() { document.getElementById("reviewModal").style.display = "none"; }

function setRating(n) {
  currentRating = n;
  document.querySelectorAll(".star-btn").forEach((btn, i) => btn.classList.toggle("lit", i < n));
}

async function submitReview() {
  if (!checkRateLimit("review_" + (currentUser?.uid || "anon"), 2, 3600000)) {
    showError("reviewMsg", "⚠️ You can only submit 2 reviews per hour."); return;
  }
  const text = document.getElementById("reviewText").value.trim();
  const name = document.getElementById("reviewName").value.trim();
  if (!currentRating) return showError("reviewMsg", "Please select a rating.");
  if (!text) return showError("reviewMsg", "Please write your review.");
  if (!name) return showError("reviewMsg", "Please enter your name.");
  waitForFirebase(async () => {
    try {
      await window._firebase.db.collection("reviews").add({
        text, name, rating: currentRating, uid: currentUser?.uid || null, email: currentUser?.email || null,
        status: "approved", date: new Date().toLocaleDateString("en-IN"), createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeReviewModal(); showToast("🌟 Thank you for your review!"); loadReviewsPublic();
    } catch(e) { showError("reviewMsg", "Error submitting: " + e.message); }
  });
}

async function loadReviewsPublic() {
  waitForFirebase(async () => {
    try {
      const snap = await window._firebase.db.collection("reviews").where("status","==","approved").orderBy("createdAt","desc").limit(6).get();
      if (snap.empty) return;
      const grid = document.getElementById("reviewsGrid");
      const countEl = document.getElementById("reviewCountLabel");
      if (countEl) countEl.textContent = `Based on ${snap.size}+ reviews`;
      let html = "";
      snap.forEach(d => {
        const r = d.data();
        html += `<div class="review-card"><div class="review-stars">${"★".repeat(r.rating)}${"☆".repeat(5-r.rating)}</div><p class="review-text">"${escapeHTML(r.text)}"</p><div class="review-author"><div class="review-avatar">${escapeHTML(r.name).charAt(0).toUpperCase()}</div><div><div class="review-name">${escapeHTML(r.name)}</div><div class="review-meta">${escapeHTML(r.date) || ""}</div></div></div></div>`;
      });
      if (grid) grid.innerHTML = html;
    } catch(e) {}
  });
}

/* ============================================
FIREBASE HELPERS
============================================ */
function waitForFirebase(cb, tries = 0) {
  if (window._firebase) { cb(); return; }
  if (tries > 30) return;
  setTimeout(() => waitForFirebase(cb, tries + 1), 200);
}

/* ============================================
NAV
============================================ */
function updateNavForUser(user) {
  const loginBtn = document.getElementById("navLoginBtn");
  const navUser = document.getElementById("navUser");
  const navAvatar = document.getElementById("navAvatar");
  const navName = document.getElementById("navUserName");
  const adminLink = document.getElementById("adminNavLink");
  if (adminLink) adminLink.style.display = "none";
  if (user) {
    if (loginBtn) loginBtn.style.display = "none";
    if (navUser) navUser.style.display = "flex";
    const name = user.displayName || user.email?.split("@")[0] || "User";
    if (navName) navName.textContent = name.split(" ")[0];
    if (navAvatar) navAvatar.textContent = name.charAt(0).toUpperCase();
window._firebase.db.collection("users").doc(user.uid).get()
      .then(doc => {
        if (doc.exists && doc.data().role === "admin" && adminLink) adminLink.style.display = "block";
      })
      .catch(() => {});
    // Sync dropdown avatar
    const dropAvatar = document.getElementById("dropAvatar");
    const dropNameEl = document.querySelector(".dropdown-name");
    if (navAvatar && dropAvatar) dropAvatar.textContent = navAvatar.textContent;
    if (navName && dropNameEl) dropNameEl.textContent = navName.textContent;
  } else {
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (navUser) navUser.style.display = "none";
  }
}

function toggleUserMenu() {
  const dropdown = document.getElementById("userDropdown");
  const navUser = document.getElementById("navUser");
  if (!dropdown) return;
  if (dropdown.classList.contains("open")) { dropdown.classList.remove("open"); return; }
  if (navUser) {
    const rect = navUser.getBoundingClientRect();
    if (rect.width > 0) {
      dropdown.style.top = (rect.bottom + 6) + "px";
      dropdown.style.right = (window.innerWidth - rect.right) + "px";
    } else {
      dropdown.style.top = "65px";
      dropdown.style.right = "12px";
    }
  } else {
    dropdown.style.top = "65px";
    dropdown.style.right = "12px";
  }
  dropdown.classList.add("open");
}

function closeUserMenu() { document.getElementById("userDropdown")?.classList.remove("open"); }

/* ============================================
AUTH MODAL
============================================ */
function openAuthModal(panel = "login") {
  document.getElementById("authModal").style.display = "flex";
  switchPanel(panel === "login" ? "panelLogin" : "panelSignup");
}

function closeAuthModal() {
  document.getElementById("authModal").style.display = "none";
  clearAuthErrors();

}

function switchPanel(id) {
  ["panelLogin","panelSignup","panelRecover"].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = p === id ? "block" : "none";
  });
}

function clearAuthErrors() {
  ["loginError","signupError","recoverError"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ""; el.style.color = "#dc2626"; }
  });
}

function showError(id, msg, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === "success" ? "#16a34a" : type === "info" ? "#2563eb" : "#dc2626";
}

function roleRedirectMessage(role) {
  const map = {
    driver: "⚠️ This account is a driver account. Please sign in from the driver portal.",
    admin: "⚠️ This account is an admin account. Please sign in from the admin portal.",
    advisor: "⚠️ This account is an advisor account. Please sign in from the advisor portal.",
    partner: "⚠️ This account is a partner account. Please sign in from the partner portal."
  };
  return map[role] || "⚠️ This account cannot sign in here. Please use the correct portal.";
}

function getAuthErrorMessage(code) { 
  const map = {
    "auth/user-not-found": "⚠️ No account found. Please sign up first.",
    "auth/wrong-password": "⚠️ Incorrect password. Please try again.",
    "auth/invalid-credential": "⚠️ Incorrect details. Please try again.",
    "auth/invalid-login-credentials": "⚠️ Incorrect details. Please try again.",
    "auth/email-already-in-use": "⚠️ This email is already registered.",
    "auth/weak-password": "⚠️ Password too weak. Use at least 6 characters.",
    "auth/network-request-failed": "⚠️ Network error. Check your connection.",
    "auth/too-many-requests": "⚠️ Too many attempts. Please wait a few minutes.",
    "auth/invalid-phone-number": "⚠️ Invalid phone number.",
    "auth/session-expired": "⚠️ OTP expired. Please request a new one.",
    "auth/invalid-verification-code": "⚠️ Incorrect OTP. Please try again.",
    "auth/quota-exceeded": "⚠️ SMS quota exceeded. Try again later.",
    "auth/credential-already-in-use": "⚠️ This phone number is already linked to another account.",
    "auth/account-exists-with-different-credential": "⚠️ This email is already registered with a different sign-in method. Try logging in with email and password instead.",
    "auth/expired-action-code": "⚠️ This link has expired. Please request a new one.",
    "auth/invalid-action-code": "⚠️ This link is invalid or has already been used. Please request a new one.",
    "auth/user-disabled": "⚠️ This account has been disabled. Please contact support.",
  };
  return map[code] || ("⚠️ " + (code || "Something went wrong. Please try again."));
}

/* ═══════════════════════════════════════════════
/* ═══════════════════════════════════════════════
SIGN UP FLOW — OTP verified BEFORE account exists
═══════════════════════════════════════════════ */
async function signupUser() {
  if (!checkRateLimit("signup_otp", 3, 300000)) { showError("signupError", "⚠️ Too many OTP requests. Please try again later."); return; }
  const firstName = document.getElementById("signupFirstName").value.trim();
  const lastName = document.getElementById("signupLastName").value.trim();
  const phone = document.getElementById("signupPhone").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const referral = document.getElementById("signupReferral")?.value.trim().toUpperCase() || "";

  if (!firstName) return showError("signupError", "⚠️ Please enter your first name.");
  if (!lastName) return showError("signupError", "⚠️ Please enter your last name.");
  if (!/^\d{10}$/.test(phone)) return showError("signupError", "⚠️ Please enter a valid 10-digit mobile number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("signupError", "⚠️ Please enter a valid email address.");
  if (password.length < 6) return showError("signupError", "⚠️ Password must be at least 6 characters.");

  const fullName = firstName + " " + lastName;
  const btn = document.getElementById("btnSignup");
  if (btn) { btn.disabled = true; btn.textContent = "Sending code..."; }
  showError("signupError", "⏳ Sending verification code...", "info");

  waitForFirebase(async () => {
    const { functions } = window._firebase;
    try {
      await functions.httpsCallable("sendSignupOtpBrevo")({ email, name: fullName, phone });
      pendingSignupData = { firstName, lastName, fullName, phone, email, password, referral };
      closeAuthModal();
      openSignupOtpModal(email);
  } catch (err) {
      console.error("Signup OTP error:", err);
      if (err.code === "functions/already-exists" && err.message === "auth/email-already-in-use") {
        try {
          const check = await functions.httpsCallable("checkAuthProvider")({ email });
          const { hasGoogle, hasApple, hasPassword } = check.data || {};
          if (hasGoogle && !hasPassword) showError("signupError", "⚠️ This email is linked to a Google account. Please use \"Continue with Google\" instead.");
          else if (hasApple && !hasPassword) showError("signupError", "⚠️ This email is linked to an Apple account. Please use \"Continue with Apple\" instead.");
          else showError("signupError", "⚠️ This email is already registered. Please login.");
        } catch (checkErr) {
          showError("signupError", "⚠️ This email is already registered. Please login.");
        }
      }
      else if (err.code === "functions/already-exists" && err.message === "auth/phone-already-in-use") showError("signupError", "⚠️ This phone number is already registered.");
      else showError("signupError", "⚠️ " + (err.message || "Something went wrong. Please try again."));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Create Account →"; }
    }
  });
}

function openSignupOtpModal(email) {
  const modal = document.getElementById("signupOtpModal");
  if (!modal) { showToast("⚠️ OTP screen not found."); return; }
  document.getElementById("signupOtpEmailDisplay").textContent = email;
  document.getElementById("signupOtpInput").value = "";
  document.getElementById("signupOtpError").textContent = "";
  modal.style.display = "flex";
}

function closeSignupOtpModal() { document.getElementById("signupOtpModal").style.display = "none"; }

async function verifySignupOtp() {
  if (!pendingSignupData) { showToast("⚠️ Signup session expired. Please start again."); closeSignupOtpModal(); return; }
  const otp = document.getElementById("signupOtpInput").value.trim();
  if (!otp || otp.length !== 6) { showError("signupOtpError", "⚠️ Enter the 6-digit code."); return; }

  const btn = document.getElementById("btnVerifySignupOtp");
  if (btn) { btn.disabled = true; btn.textContent = "Verifying..."; }

  waitForFirebase(async () => {
    const { auth, functions } = window._firebase;
    const { firstName, lastName, phone, email, password, referral } = pendingSignupData;
    try {
      // Account + Firestore profile are created entirely server-side —
      // see verifySignupOtpBrevo in auth-emails.js. The client only
      // signs in with the token it hands back.
      const result = await functions.httpsCallable("verifySignupOtpBrevo")({
        email, otp, password, firstName, lastName, phone, referral
      });
      const token = result?.data?.token;
      if (!token) throw new Error("No sign-in token returned.");

      await auth.signInWithCustomToken(token);

      pendingSignupData = null;
      closeSignupOtpModal();
      showToast(`👋 Welcome to PackZen, ${firstName}!`);
    } catch (err) {
      console.error("OTP verify / account creation error:", err);
      if (err.code === "functions/already-exists" && err.message === "auth/email-already-in-use") showError("signupOtpError", "⚠️ This email is already registered. Please login.");
      else if (err.code === "functions/already-exists" && err.message === "auth/phone-already-in-use") showError("signupOtpError", "⚠️ This phone number is already registered.");
      else if (err.code === "functions/not-found") showError("signupOtpError", "⚠️ No code found. Please request a new one.");
      else if (err.code === "functions/deadline-exceeded") showError("signupOtpError", "⚠️ Code expired. Please request a new one.");
      else if (err.code === "functions/resource-exhausted") showError("signupOtpError", "⚠️ Too many attempts. Please request a new code.");
      else if (err.code === "functions/invalid-argument") showError("signupOtpError", "⚠️ Incorrect code. Please try again.");
      else showError("signupOtpError", err.message ? ("⚠️ " + err.message) : getAuthErrorMessage(err.code));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Verify & Create Account"; }
    }
  });
}

async function resendSignupOtp() {
  if (!pendingSignupData) return;
  const { email, fullName, phone } = pendingSignupData;
  waitForFirebase(async () => {
    try {
      await window._firebase.functions.httpsCallable("sendSignupOtpBrevo")({ email, name: fullName, phone });
      showToast("📧 New code sent!");
    } catch (err) { showError("signupOtpError", "⚠️ " + (err.message || "Failed to resend code.")); }
  });
}

/* ═══════════════════════════════════════════════
LOGIN
═══════════════════════════════════════════════ */
async function loginUser() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPassword").value;
  if (!email || !pass) return showError("loginError", "⚠️ Enter email and password");

  const btn = document.getElementById("btnLogin");
  if (btn) { btn.disabled = true; btn.textContent = "Signing in..."; }

  waitForFirebase(async () => {
    const { auth, db, functions } = window._firebase;
  try {
      const cred = await auth.signInWithEmailAndPassword(email, pass);
      const userDoc = await db.collection("users").doc(cred.user.uid).get();
      const role = userDoc.exists ? userDoc.data().role : null;
      if (role && role !== "customer") {
        await auth.signOut();
        showError("loginError", roleRedirectMessage(role));
        return;
      }
      await db.collection("users").doc(cred.user.uid).update({ lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(()=>{});
      closeAuthModal();
      showToast("✅ Login successful");
    } catch (err) {
      console.error('Customer Auth Error:', err.code, err.message);
      const invalidCredCodes = ["auth/wrong-password", "auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found"];
      if (invalidCredCodes.includes(err.code)) {
        try {
          const check = await functions.httpsCallable("checkAuthProvider")({ email });
          const { exists, hasGoogle, hasApple, hasPassword } = check.data || {};
          if (exists && hasGoogle && !hasPassword) showError("loginError", "⚠️ This email is linked to a Google account. Please use \"Continue with Google\" to sign in.");
          else if (exists && hasApple && !hasPassword) showError("loginError", "⚠️ This email is linked to an Apple account. Please use \"Continue with Apple\" to sign in.");
          else showError("loginError", "⚠️ Incorrect email or password.");
        } catch (checkErr) {
          showError("loginError", "⚠️ Incorrect email or password.");
        }
      } else {
        showError("loginError", getAuthErrorMessage(err.code));
      }
    }
    finally { if (btn) { btn.disabled = false; btn.textContent = "Login →"; } }
  });
}

async function signOutUser() {
  waitForFirebase(async () => {
    try {
      await window._firebase.auth.signOut();
      document.getElementById("userDropdown")?.classList.remove("open");
      showToast("👋 Signed out successfully");
    } catch (err) {
      console.error("Sign out error:", err);
      showToast("⚠️ Something went wrong signing out. Please try again.");
    }
  });
}

async function _handleOAuthUser(user, db, providerName) {
  const userRef = db.collection("users").doc(user.uid);
  const existingDoc = await userRef.get();
  if (existingDoc.exists) {
    const role = existingDoc.data().role || "customer";
    if (role !== "customer") return role; // block — never touch a non-customer doc further
    await userRef.update({ lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(), loginMethod: providerName });
    return role;
  }
  // 🔒 REDESIGNED (see PRIORITY 2/3 fix): this used to fall back to a
  // Firestore query by email and, if a doc existed under a *different*
  // uid, silently rewrite it onto this uid and delete the old one —
  // merging Firestore profiles without ever confirming the two Auth
  // accounts belonged to the same person, and leaving the original
  // Firebase Auth account (password or otherwise) orphaned with no
  // profile. That path is now handled upstream: signInWithGoogle/
  // signInWithApple catch `auth/account-exists-with-different-credential`
  // *before* a second uid can ever reach this function, re-authenticate
  // the user against their existing account, and use linkWithCredential
  // so the new provider joins the EXISTING uid instead of creating one.
  // So by the time we get here, this uid should never collide with an
  // email already used by a different uid. If it somehow still does
  // (e.g. a legacy account created before this fix, or a project-level
  // "multiple accounts per email" setting — see audit note on that),
  // we deliberately do NOT auto-merge or auto-delete anything: we bail
  // out and ask the person to contact support so a human resolves which
  // account is authoritative.
  const emailSnap = await db.collection("users").where("email", "==", user.email).limit(1).get();
  if (!emailSnap.empty && emailSnap.docs[0].id !== user.uid) {
    console.error("OAuth uid/email collision — refusing to auto-merge Firestore profiles.", { newUid: user.uid, existingDocId: emailSnap.docs[0].id, email: user.email });
    return "__conflict__";
  }
  const refCode = user.uid.slice(0, 8).toUpperCase();
  await userRef.set({
    name: user.displayName || user.email.split('@')[0], email: user.email || "", phone: user.phoneNumber || "", role: "customer",
    loginMethod: providerName, phoneVerified: false, emailVerified: user.emailVerified, prefEmail: true, prefSMS: true,
    referralCode: refCode, referralCount: 0, referralCredits: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return "customer";
}

/* ═══════════════════════════════════════════════
GOOGLE/APPLE ↔ EXISTING-PASSWORD-ACCOUNT LINKING
(PRIORITY 2/3 fix — replaces the old silent Firestore-merge path)

Flow when Firebase reports auth/account-exists-with-different-credential:
  1. Pull the pending OAuth credential + email off the error.
  2. Ask the existing, already-built checkAuthProvider function how this
     email is actually registered (fetchSignInMethodsForEmail is not
     used here — the repo's own comments note it's unreliable with
     Email Enumeration Protection on, which is why checkAuthProvider
     exists).
  3. If a password provider exists, prompt for that password right in
     the modal, re-authenticate against the EXISTING uid via
     signInWithEmailAndPassword, then call linkWithCredential() on that
     signed-in user with the pending Google/Apple credential. Google
     now joins the original uid — no second uid, no Firestore merge.
  4. If the existing provider is Google/Apple (not password), we can't
     silently link either — that requires signing in with the OTHER
     OAuth provider first. We tell the person which provider to use.
═══════════════════════════════════════════════ */
function openLinkAccountModal(email, providerLabel) {
  const modal = document.getElementById("linkAccountModal");
  if (!modal) return;
  document.getElementById("linkAccountEmail").textContent = email;
  document.getElementById("linkAccountProviderLabel").textContent = providerLabel;
  document.getElementById("linkAccountPassword").value = "";
  document.getElementById("linkAccountError").textContent = "";
  modal.style.display = "flex";
}
function closeLinkAccountModal() {
  const modal = document.getElementById("linkAccountModal");
  if (modal) modal.style.display = "none";
  pendingLinkCredential = null;
}

async function confirmLinkAccount() {
  if (!pendingLinkCredential) { closeLinkAccountModal(); return; }
  const { email, credential, providerLabel } = pendingLinkCredential;
  const password = document.getElementById("linkAccountPassword").value;
  if (!password) { showError("linkAccountError", "⚠️ Enter your existing password."); return; }

  const btn = document.getElementById("btnConfirmLinkAccount");
  if (btn) { btn.disabled = true; btn.textContent = "Linking..."; }

  waitForFirebase(async () => {
    const { auth, db } = window._firebase;
    try {
      // Step 1 — re-authenticate as the EXISTING account. This is the
      // "authenticate existing Firebase UID" requirement: we never link
      // anything without the person proving they control that account.
      const existingUserCred = await auth.signInWithEmailAndPassword(email, password);
      // Step 2 — link the pending Google/Apple credential onto that
      // SAME uid. No new uid is created; no Firestore doc is touched
      // by uid-merge logic.
      await existingUserCred.user.linkWithCredential(credential);
      const role = await _handleOAuthUser(existingUserCred.user, db, providerLabel.toLowerCase());
      if (role !== "customer" && role !== "__conflict__") {
        await auth.signOut();
        closeLinkAccountModal();
        showError("loginError", roleRedirectMessage(role));
        return;
      }
      closeLinkAccountModal();
      closeAuthModal();
      showToast(`✅ ${providerLabel} linked! You can now sign in with either method.`);
    } catch (err) {
      console.error("Account linking error:", err);
      const invalidCredCodes = ["auth/wrong-password", "auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found"];
      if (invalidCredCodes.includes(err.code)) showError("linkAccountError", "⚠️ Incorrect password for the existing account.");
      else if (err.code === "auth/credential-already-in-use" || err.code === "auth/provider-already-linked") showError("linkAccountError", "⚠️ This provider is already linked to an account.");
      else showError("linkAccountError", "⚠️ " + (err.message || "Linking failed. Please try again."));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Sign In & Link →"; }
    }
  });
}

// Shared conflict handler for both Google and Apple sign-in.
async function _handleProviderConflict(err, attemptedProviderLabel) {
  const { functions } = window._firebase;
  const email = err.email || err.customData?.email || "";
  // The compat SDK puts the pending credential directly on the error
  // (err.credential) — the classic v8 shape. credentialFromError() is
  // the newer modular-API equivalent; we try it as a fallback in case
  // a future SDK upgrade drops the compat shape.
  const credential = err.credential
    || (attemptedProviderLabel === "Google"
        ? firebase.auth.GoogleAuthProvider.credentialFromError?.(err)
        : firebase.auth.OAuthProvider.credentialFromError?.(err));

  if (!email || !credential) {
    showError("loginError", "⚠️ This email is already registered with a different sign-in method.");
    return;
  }
  try {
    const check = await functions.httpsCallable("checkAuthProvider")({ email });
    const { hasPassword, hasGoogle, hasApple } = check.data || {};
    if (hasPassword) {
      pendingLinkCredential = { email, credential, providerLabel: attemptedProviderLabel };
      closeAuthModal();
      openLinkAccountModal(email, attemptedProviderLabel);
    } else if (hasGoogle && attemptedProviderLabel !== "Google") {
      showError("loginError", "⚠️ This email is linked to a Google account. Please use \"Continue with Google\" instead.");
    } else if (hasApple && attemptedProviderLabel !== "Apple") {
      showError("loginError", "⚠️ This email is linked to an Apple account. Please use \"Continue with Apple\" instead.");
    } else {
      showError("loginError", "⚠️ This email is already registered with a different sign-in method. Please contact support.");
    }
  } catch (checkErr) {
    showError("loginError", "⚠️ This email is already registered with a different sign-in method.");
  }
}

window.signInWithGoogle = async function () {
  waitForFirebase(async () => {
    const { auth, db } = window._firebase;
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
 const result = await auth.signInWithPopup(provider);
      const role = await _handleOAuthUser(result.user, db, 'google');
      if (role === "__conflict__") {
        await auth.signOut();
        showError("loginError", "⚠️ We couldn't safely sign you in — this email may already have another account. Please contact support.");
        return;
      }
      if (role !== "customer") {
        await auth.signOut();
        showError("loginError", roleRedirectMessage(role));
        return;
      }
      closeAuthModal();
      const name = (result.user.displayName || result.user.email?.split("@")[0] || "User").split(" ")[0];
      showToast(`👋 Welcome, ${name}!`);
    } catch (err) {
      if (err.code === "auth/account-exists-with-different-credential") { await _handleProviderConflict(err, "Google"); return; }
      if (err.code === "auth/popup-blocked") showError("loginError", "⚠️ Popup blocked — please allow popups for this site and try again.");
      else if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {}
      else if (err.code === "auth/unauthorized-domain") showError("loginError", "⚠️ Domain not authorized. Add it in Firebase Console → Authentication → Authorized Domains.");
      else showError("loginError", getAuthErrorMessage(err.code));
    }
  });
};

window.signInWithApple = async function () {
  waitForFirebase(async () => {
    const { auth, db } = window._firebase;
    const provider = new firebase.auth.OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    try {
const result = await auth.signInWithPopup(provider);
      const role = await _handleOAuthUser(result.user, db, 'apple');
      if (role === "__conflict__") {
        await auth.signOut();
        showError("loginError", "⚠️ We couldn't safely sign you in — this email may already have another account. Please contact support.");
        return;
      }
      if (role !== "customer") {
        await auth.signOut();
        showError("loginError", roleRedirectMessage(role));
        return;
      }
      closeAuthModal();
      const name = (result.user.displayName || result.user.email?.split("@")[0] || "User").split(" ")[0];
      showToast(`👋 Welcome, ${name}!`);
    } catch (err) {
      if (err.code === "auth/account-exists-with-different-credential") { await _handleProviderConflict(err, "Apple"); return; }
      if (err.code === "auth/popup-blocked") showError("loginError", "⚠️ Popup blocked — please allow popups for this site and try again.");
      else if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {}
      else if (err.code === "auth/unauthorized-domain") showError("loginError", "⚠️ Domain not authorized.");
      else showError("loginError", getAuthErrorMessage(err.code));
    }
  });
};

/* ═══════════════════════════════════════════════
PASSWORD RESET FLOW
═══════════════════════════════════════════════ */
async function sendResetEmail() {
  const email = document.getElementById("resetEmail").value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("recoverError", "⚠️ Please enter a valid email address.");
  const btn = document.getElementById("btnSendResetEmail");
  if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
  showError("recoverError", "⏳ Sending reset link...", "info");
  waitForFirebase(async () => {
    const { functions } = window._firebase;
    try {
      await functions.httpsCallable("sendPasswordResetEmailBrevo")({ email });
      showError("recoverError", "✅ Reset link sent! Check your inbox.", "success");
      setTimeout(() => switchPanel('panelLogin'), 3000);
    } catch (err) {
      console.error(err);
      if (err.code === "functions/not-found") showError("recoverError", "⚠️ No account found with this email.");
      else if (err.code === "functions/failed-precondition" && err.message === "auth/google-account-no-password") {
        showError("recoverError", "⚠️ Unable to reset password — you previously continued with Google. Please use \"Continue with Google\" to sign in instead.");
      }
      else showError("recoverError", "⚠️ " + (err.message || "Something went wrong. Please try again."));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Send Reset Link →"; }
    }
  });
}
/* ============================================
DASHBOARD
============================================ */
function prefillBookingForm(userData) {
  const nameEl = document.getElementById("custName");
  const phoneEl = document.getElementById("custPhone");
  const emailEl = document.getElementById("custEmail");
  if (nameEl && !nameEl.value.trim() && userData?.name) nameEl.value = userData.name;
  if (phoneEl && !phoneEl.value.trim() && userData?.phone) phoneEl.value = userData.phone.replace("+91","").trim();
  if (emailEl && !emailEl.value.trim() && userData?.email) emailEl.value = userData.email;
}

async function openDashboard() {
  document.getElementById("userDropdown")?.classList.remove("open");
  if (!currentUser) { openAuthModal("login"); return; }
  if (!window._firebase) return;
  const { db } = window._firebase;
  try {
    const userSnap = await db.collection("users").doc(currentUser.uid).get();
    const userData = userSnap.data() || {};
    const name = currentUser.displayName || "User";
    document.getElementById("dashName").textContent = name;
    document.getElementById("dashEmail").textContent = currentUser.email || "";
    document.getElementById("dashAvatar").textContent = name.charAt(0).toUpperCase();
    const adminTabBtn = document.getElementById("adminTabBtn");
    if (userData.role === "admin" && adminTabBtn) adminTabBtn.style.display = "inline-flex";
document.getElementById("dashboardModal").style.display = "flex";
switchDashTab("bookings", document.querySelector(".dash-tab"));
  } catch (e) { console.error("Dashboard error:", e); }
}

async function loadQuotes() {
  if (!window._firebase || !currentUser) return;
  const db = window._firebase.db;
  const container = document.getElementById("quotesList");
  if (!container) return;
  container.innerHTML = "⏳ Loading your quotes...";
  try {
    const snapshot = await db.collection("quotes").where("uid", "==", currentUser.uid).orderBy("createdAt", "desc").get();
    if (snapshot.empty) { container.innerHTML = `<div style="opacity:0.7;text-align:center;padding:20px;">No quotes found yet 🚚</div>`; return; }
    container.innerHTML = "";
 snapshot.forEach(doc => {
    const data = doc.data();
    console.log(data);
    container.innerHTML += `
        <div style="
            padding:16px;
            margin-bottom:12px;
            border:1px solid #333;
            border-radius:10px;
            background:#0f172a;
            color:white;
        ">
            <h3>Quote ID: ${doc.id}</h3>

            <p><strong>Pickup:</strong> ${data.pickup || "N/A"}</p>

            <p><strong>Drop:</strong> ${data.drop || "N/A"}</p>

            <p><strong>Price:</strong> ₹${data.price || 0}</p>

            <p><strong>Status:</strong> ${data.status || "Pending"}</p>
        </div>
    `;
});
  } catch (error) { container.innerHTML = "❌ Failed to load quotes"; }
}

/* ============================================
REFERRAL
============================================ */
async function loadReferralData() {
  if (!currentUser || !window._firebase) return;
  try {
    const snap = await window._firebase.db.collection("users").doc(currentUser.uid).get().catch(() => null);
    if (!snap?.exists) return;
    const d = snap.data();
    const code = d.referralCode || currentUser.uid.slice(0, 8).toUpperCase();
    document.getElementById("referralCodeText").textContent = code;
    document.getElementById("refCount").textContent = d.referralCount || 0;
    document.getElementById("refEarned").textContent = "₹" + (d.referralCredits || 0);
    document.getElementById("refAvailable").textContent = "₹" + (d.referralCredits || 0);
  } catch (err) { console.error("loadReferralData error:", err); }
}

function copyReferralCode() {
  const code = document.getElementById("referralCodeText").textContent;
  navigator.clipboard.writeText(code).then(() => showToast("✅ Referral code copied!"));
}

/* ============================================
PROMO CODE
============================================ */
async function applyPromoCode() {
  const code = document.getElementById("promoInput").value.trim().toUpperCase();
  const msgEl = document.getElementById("promoMsg");
  if (!code) { msgEl.textContent = "Enter a promo code."; msgEl.className = "promo-msg promo-error"; return; }
  waitForFirebase(async () => {
    const { db } = window._firebase;
    try {
      const snap = await db.collection("promos").doc(code).get();
      if (!snap.exists) {
        const refSnap = await db.collection("users").where("referralCode","==",code).get();
        if (!refSnap.empty && currentUser && refSnap.docs[0].id !== currentUser.uid) {
          promoDiscount = window.PackZenPricing?.config?.discounts?.referralAmount || 100;
          msgEl.textContent = "🎉 Referral code applied! ₹" + promoDiscount + " discount.";
          msgEl.className = "promo-msg promo-success";
          // Re-run the pricing engine with the updated promoDiscount
          if (window._lastCalculatedKm) {
            runQuoteEngine(window._lastCalculatedKm, { silent: true });
          } else {
            updatePriceDisplay();
          }
          return;
        }
        msgEl.textContent = "Invalid promo code."; msgEl.className = "promo-msg promo-error"; return;
      }
      const promo = snap.data();
      if (!promo.active) { msgEl.textContent = "This promo has expired."; msgEl.className = "promo-msg promo-error"; return; }

      // Compute discount via v2 engine logic
      const baseTotal = window._lastQuoteResult?.breakdown?.grandTotal || lastCalculatedTotal;
      const maxFraction = window.PackZenPricing?.config?.discounts?.maxPromoFraction || 0.5;
      const rawDiscount = promo.type === "percent" ? Math.round(baseTotal * promo.value / 100) : promo.value;
      promoDiscount = Math.min(rawDiscount, Math.floor(baseTotal * maxFraction));

      msgEl.textContent = `🎉 Code applied! ₹${promoDiscount} off.`;
      msgEl.className = "promo-msg promo-success";

      // Re-run the pricing engine with the updated promoDiscount so it incorporates the discount
      if (window._lastCalculatedKm) {
        runQuoteEngine(window._lastCalculatedKm, { silent: true });
      } else {
        updatePriceDisplay();
      }
    } catch(e) { msgEl.textContent = "Error checking code."; msgEl.className = "promo-msg promo-error"; }
  });
}

/* ============================================
PHOTO UPLOAD
============================================ */
function previewPhotos(input) {
  const previews = document.getElementById("photoPreviews");
  previews.innerHTML = ""; uploadedPhotos = [];
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      uploadedPhotos.push(e.target.result);
      const img = document.createElement("img");
      img.src = e.target.result; img.className = "photo-thumb";
      previews.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

/* ============================================
SAVE QUOTE
============================================ */
async function saveQuoteToFirestore(total) {
  if (!currentUser || !window._firebase) return;
  const { db } = window._firebase;
  const houseEl = document.getElementById("house");
  const vehicleEl = document.getElementById("vehicle");
  try {
    await db.collection("quotes").add({
      uid: currentUser.uid,
      pickup: document.getElementById("pickup")?.value || "",
      drop: document.getElementById("drop")?.value || "",
      house: houseEl?.options[houseEl?.selectedIndex]?.text || "",
      vehicle: vehicleEl?.options[vehicleEl?.selectedIndex]?.text || "",
      total,
      date: new Date().toLocaleDateString("en-IN"),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {}
}

/* ============================================
DASHBOARD TABS
============================================ */
function closeDashboard() { document.getElementById("dashboardModal").style.display = "none"; }

function switchDashTab(tab, el) {
["dashBookings","dashAddresses","dashReferral","dashProfile","dashAdmin"].forEach(id => {
  const panel = document.getElementById(id);
    if (panel) panel.style.display = "none";
  });
  document.querySelectorAll(".dash-tab").forEach(t => t.classList.remove("active"));
  const target = document.getElementById("dash" + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (target) target.style.display = "block";
  if (el) el.classList.add("active");
  if (tab === "referral") loadReferralData();
  if (tab === "bookings") loadUserBookings();
  if (tab === "profile") loadProfileData();
  if (tab === "addresses") loadUserAddresses();
}

function loadUserBookings() {
      console.log("loadUserBookings called");
  if (!currentUser || !window._firebase) return;
  const list = document.getElementById("bookingsList");
  if (list) list.innerHTML = 'Loading...';
  window._firebase.db.collection("bookings").where("customerUid","==",currentUser.uid).orderBy("createdAt","desc").limit(10).get()
    .then(snap => {
      console.log("Documents:", snap.size);
      if (!list) return;
      if (snap.empty) { list.innerHTML = 'No bookings yet.'; return; }
      const statusColors = {confirmed:"#0057ff",assigned:"#7c3aed",packing:"#0ea5e9",transit:"#f97316",delivered:"#16a34a",cancelled:"#dc2626"};
      console.log(snap.docs);
      const statusIcons = {confirmed:"📋",assigned:"🚛",packing:"📦",transit:"🚚",delivered:"✅",cancelled:"❌"};
      list.innerHTML = snap.docs.map(d => {
        const b = d.data(), id = d.id;
        const color = statusColors[b.status] || "#5a6a8a";
        const icon = statusIcons[b.status] || "📋";
        const canCancel = !["packing","transit","delivered","cancelled"].includes(b.status);
        const canReschedule = !["transit","delivered","cancelled"].includes(b.status);
     const canRate = b.status === "delivered" && !b.driverRating;
const canClaim = b.status === "delivered" && !b.damageClaimed;
const showOtp = ["assigned", "packing", "transit", "delivered"].includes(b.status) && b.deliveryOtp;
        return `<div class="bk-card"> <div class="bk-card-top"><div class="bk-route">${escapeHTML((b.pickup||"?").split(",")[0])} → ${escapeHTML((b.drop||"?").split(",")[0])}</div><div class="bk-status" style="color:${color}">${icon} ${escapeHTML(capitalize(b.status||"confirmed"))}</div></div> <div class="bk-meta"><span>₹${(b.total||0).toLocaleString("en-IN")}</span><span>${escapeHTML(b.date)||"Date TBD"}</span><span style="font-size:.72rem;color:#5a6a8a">${escapeHTML(b.bookingRef)||""}</span></div> ${canCancel||canReschedule||canRate||canClaim?`
${canReschedule?`<button class="bk-btn reschedule" data-action="reschedule" data-id="${id}" data-ref="${b.bookingRef||id}" data-date="${b.date||""}">📅 Reschedule</button>`:""}
${showOtp ? `
<div style="
    margin:12px 0;
    padding:14px;
    background:#f0fff4;
    border:2px dashed #16a34a;
    border-radius:10px;
    text-align:center;
">
    <div style="font-size:12px;color:#666;">
        Delivery OTP
    </div>

    <div style="
        font-size:34px;
        font-weight:bold;
        letter-spacing:8px;
        color:#16a34a;
    ">
        ${b.deliveryOtp}
    </div>

    <div style="font-size:13px;color:#666;">
        Give this OTP to the driver only after delivery.
    </div>
</div>
` : ""}
${canCancel?`<button class="bk-btn cancel" data-action="cancel" data-id="${id}" data-ref="${b.bookingRef||id}" data-status="${b.status||""}">✕ Cancel</button>`:""}
${canRate?`<button class="bk-btn rate" data-action="rate" data-id="${id}" data-ref="${b.bookingRef||id}" data-driver="${b.driverName||""}">⭐ Rate Driver</button>`:""}
${canClaim?`<button class="bk-btn claim" data-action="claim" data-id="${id}" data-ref="${b.bookingRef||id}">🔧 Report Damage</button>`:""}
<button class="bk-btn invoice" onclick="downloadInvoice('${id}')" style="background:#0ea5e9;color:white;border:none;">📄 Invoice</button>
<button class="bk-btn email" onclick="emailInvoice('${id}')" style="background:#0284c7;color:white;border:none;">✉️ Email</button>

`:""} 
</div>`;
      }).join("");
      attachBookingButtonListeners();
}).catch((err) => {
      console.error("loadUserBookings failed:", err);
      if (list) list.innerHTML = `<div class="dash-empty">Error loading bookings: ${escapeHTML(err.message)}</div>`;
    });
}

function attachBookingButtonListeners() {
  const list = document.getElementById("bookingsList");
  if (!list) return;
  list.querySelectorAll('.bk-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      const action = this.getAttribute('data-action');
      const id = this.getAttribute('data-id');
      const ref = this.getAttribute('data-ref');
      const status = this.getAttribute('data-status');
      const date = this.getAttribute('data-date');
      const driver = this.getAttribute('data-driver');
      if (action === 'reschedule') openRescheduleModal(id, ref, date);
      else if (action === 'cancel') openCancelModal(id, ref, status);
      else if (action === 'rate') openRateDriverModal(id, ref, driver);
      else if (action === 'claim') openDamageModal(id, ref);
    });
  });
}

function loadUserAddresses() {
  if (!currentUser || !window._firebase) return;
  const list = document.getElementById("addressesList");
  if (!list) return;
  window._firebase.db.collection("users").doc(currentUser.uid).collection("addresses").get()
    .then(snap => {
      if (snap.empty) { list.innerHTML = '<div class="dash-empty">No saved addresses yet.</div>'; return; }
      list.innerHTML = snap.docs.map(d => {
        const addr = d.data();
        return `<div class="quote-item" style="display:flex;justify-content:space-between;align-items:center;">
                  <div>📍 ${escapeHTML(addr.address)}</div>
                  <button class="btn-auth" style="background:#dc2626;padding:4px 8px;font-size:0.75rem;min-height:unset;" onclick="deleteAddress('${d.id}')">Delete</button>
                </div>`;
      }).join("");
    }).catch(err => { console.error("Error loading addresses:", err); });
}

function addNewAddress() {
  if (!currentUser || !window._firebase) return;
  const input = document.getElementById("newAddressInput");
  const address = input?.value.trim();
  if (!address) { showToast("⚠️ Please enter an address."); return; }
  window._firebase.db.collection("users").doc(currentUser.uid).collection("addresses").add({ address, createdAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(() => {
      input.value = "";
      showToast("✅ Address added!");
      loadUserAddresses();
    }).catch(err => { console.error("Error adding address:", err); showToast("❌ Failed to add address."); });
}

function deleteAddress(id) {
  if (!currentUser || !window._firebase) return;
  if (!confirm("Are you sure you want to delete this address?")) return;
  window._firebase.db.collection("users").doc(currentUser.uid).collection("addresses").doc(id).delete()
    .then(() => {
      showToast("✅ Address deleted!");
      loadUserAddresses();
    }).catch(err => { console.error("Error deleting address:", err); showToast("❌ Failed to delete address."); });
}

function loadUserInvoices() {
  if (!currentUser || !window._firebase) return;
  const list = document.getElementById("invoicesList");
  if (!list) return;
  list.innerHTML = 'Loading invoices...';
  window._firebase.db.collection("bookings")
    .where("customerUid", "==", currentUser.uid)
    .where("status", "in", ["completed", "delivered"])
    .orderBy("createdAt", "desc").limit(10).get()
    .then(snap => {
      if (snap.empty) { list.innerHTML = '<div class="dash-empty">No invoices available.</div>'; return; }
      list.innerHTML = snap.docs.map(d => {
        const b = d.data();
        return `<div class="quote-item" style="display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <div style="font-weight:bold;">Invoice #${b.bookingRef || d.id.substring(0,8)}</div>
                    <div style="font-size:0.8rem;color:var(--text-muted);">₹${(b.total||0).toLocaleString("en-IN")} • ${b.date||"N/A"}</div>
                  </div>
                  <button class="btn-auth" style="padding:6px 12px;font-size:0.8rem;min-height:unset;" onclick="downloadInvoice('${d.id}')">Download</button>
                </div>`;
      }).join("");
    }).catch(err => { console.error("Error loading invoices:", err); list.innerHTML = '<div class="dash-empty">Error loading invoices.</div>'; });
}

function downloadInvoice(bookingId) {
  showToast("📄 Generating invoice... (Simulation)");
  setTimeout(() => showToast("✅ Invoice downloaded!"), 1500);
}

function loadUserReviews() {
  if (!currentUser || !window._firebase) return;
  const list = document.getElementById("userReviewsList");
  if (!list) return;
  list.innerHTML = 'Loading reviews...';
  window._firebase.db.collection("reviews")
    .where("uid", "==", currentUser.uid)
    .orderBy("createdAt", "desc").limit(10).get()
    .then(snap => {
      if (snap.empty) { list.innerHTML = '<div class="dash-empty">You haven\'t submitted any reviews yet.</div>'; return; }
      list.innerHTML = snap.docs.map(d => {
        const r = d.data();
        return `<div class="quote-item">
                  <div style="color:var(--gold-500);font-size:1.1rem;margin-bottom:4px;">${"★".repeat(r.rating || 5)}${"☆".repeat(5 - (r.rating || 5))}</div>
                  <div style="font-size:0.9rem;">"${escapeHTML(r.text || "")}"</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Status: ${escapeHTML(r.status || "pending")}</div>
                </div>`;
      }).join("");
    })
.catch(err => {
    console.error("Error loading reviews:", err);

        if (err.code === "failed-precondition") {
            list.innerHTML =
                '<div class="dash-empty">Firestore index is missing.</div>';
            return;
        }

        if (err.code === "permission-denied") {
            list.innerHTML =
                '<div class="dash-empty">Permission denied.</div>';
            return;
        }

        list.innerHTML =
            `<div class="dash-empty">
                Error loading reviews.<br>
                ${escapeHTML(err.message)}
            </div>`;
    });
}
function loadProfileData() {
  if (!currentUser || !window._firebase) return;
  window._firebase.db.collection("users").doc(currentUser.uid).get().then(doc => {
    if (!doc.exists) return;
    const d = doc.data();
    if (document.getElementById("profileName")) document.getElementById("profileName").value = d.name || "";
    if (document.getElementById("profileEmail")) document.getElementById("profileEmail").value = d.email || currentUser.email || "";
    if (document.getElementById("profilePhone")) document.getElementById("profilePhone").value = d.phone || "";
    if (document.getElementById("prefEmail")) document.getElementById("prefEmail").checked = d.prefEmail !== false;
    if (document.getElementById("prefSMS")) document.getElementById("prefSMS").checked = d.prefSMS !== false;
  }).catch(() => {});
}

function saveProfile() {
  if (!currentUser || !window._firebase) return;
  const name = document.getElementById("profileName")?.value.trim();
  const msgEl = document.getElementById("profileMsg");
  if (!name) { if (msgEl) { msgEl.textContent = "Name cannot be empty."; msgEl.style.color = "#dc2626"; } return; }
  window._firebase.db.collection("users").doc(currentUser.uid).update({ name })
    .then(() => {
      currentUser.updateProfile({ displayName: name });
      if (msgEl) { msgEl.textContent = "✅ Profile saved!"; msgEl.style.color = "#16a34a"; }
      updateNavForUser(currentUser);
    }).catch(e => { if (msgEl) { msgEl.textContent = "Error: " + e.message; msgEl.style.color = "#dc2626"; } });
}

function savePreferences() {
  if (!currentUser || !window._firebase) return;
  window._firebase.db.collection("users").doc(currentUser.uid).update({
    prefEmail: !!document.getElementById("prefEmail")?.checked,
    prefSMS: !!document.getElementById("prefSMS")?.checked
  }).catch(() => {});
}

async function openProfile() {
  document.getElementById("userDropdown")?.classList.remove("open");
  if (!currentUser) { openAuthModal("login"); return; }
  await openDashboard();
  switchDashTab("profile", document.querySelectorAll(".dash-tab")[3]);
}
/* ============================================
CANCEL / RESCHEDULE / RATE / DAMAGE
============================================ */
function openCancelModal(bookingDocId, bookingRef, status) {
  if (["packing","transit","delivered"].includes(status)) { showToast("❌ Cannot cancel after packing has started."); return; }
  document.getElementById("cancelBookingDocId").value = bookingDocId;
  document.getElementById("cancelBookingRef").textContent = bookingRef || bookingDocId;
  document.getElementById("cancelReason").value = "";
  document.getElementById("cancelModal").style.display = "flex";
}
function closeCancelModal() { document.getElementById("cancelModal").style.display = "none"; }

async function confirmCancellation() {
  const docId = document.getElementById("cancelBookingDocId").value;
  const reason = document.getElementById("cancelReason").value.trim();
  if (!reason) { showToast("⚠️ Please select a cancellation reason."); return; }
  if (!currentUser || !window._firebase) return;
  const btn = document.getElementById("btnConfirmCancel");
  if (btn) { btn.textContent = "Cancelling..."; btn.disabled = true; }
  try {
    await window._firebase.db.collection("bookings").doc(docId).update({ status:"cancelled", cancelReason: reason, cancelledAt: firebase.firestore.FieldValue.serverTimestamp(), cancelledBy:"customer" });
    await window._firebase.db.collection("cancelRequests").add({ bookingDocId: docId, reason, customerUid: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp(), resolved: false }).catch(() => {});
    const cancelledDoc = await window._firebase.db.collection("bookings").doc(docId).get();
    if (cancelledDoc.exists) {
      const cb = cancelledDoc.data();
      queueSMS(cb.phone || "", "cancelled", { name: cb.customerName || "", bookingRef: cb.bookingRef || docId });
    }
    closeCancelModal(); showToast("✅ Booking cancelled. Refund (if any) in 5–7 business days."); loadUserBookings();
    if (currentBookingId === docId) { dismissTrackBanner(); localStorage.removeItem("packzen_active_booking"); }
  } catch(e) { showToast("❌ Error: " + e.message); }
  finally { if (btn) { btn.textContent = "Yes, Cancel Booking"; btn.disabled = false; } }
}

function openRescheduleModal(bookingDocId, bookingRef, currentDate) {
  document.getElementById("rescheduleDocId").value = bookingDocId;
  document.getElementById("rescheduleBookingRef").textContent = bookingRef || bookingDocId;
  const dateInput = document.getElementById("rescheduleDate");
  if (dateInput) { dateInput.value = currentDate || ""; const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); dateInput.min = tomorrow.toISOString().split("T")[0]; }
  const timeInput = document.getElementById("rescheduleTime");
  if (timeInput) timeInput.value = "";
  document.getElementById("rescheduleModal").style.display = "flex";
}
function closeRescheduleModal() { document.getElementById("rescheduleModal").style.display = "none"; }

async function confirmReschedule() {
  const docId = document.getElementById("rescheduleDocId").value;
  const newDate = document.getElementById("rescheduleDate").value;
  const newTime = document.getElementById("rescheduleTime").value;
  if (!newDate) { showToast("⚠️ Please select a new moving date."); return; }
  const selected = new Date(newDate); const today = new Date(); today.setHours(0,0,0,0);
  if (selected <= today) { showToast("⚠️ Please select a future date."); return; }
  if (!currentUser || !window._firebase) return;
  const btn = document.getElementById("btnConfirmReschedule");
  if (btn) { btn.textContent = "Saving..."; btn.disabled = true; }
  try {
    await window._firebase.db.collection("bookings").doc(docId).update({ date: newDate, time: newTime||"", rescheduledAt: firebase.firestore.FieldValue.serverTimestamp(), rescheduledBy:"customer", status:"confirmed" });
    const bookingDoc = await window._firebase.db.collection("bookings").doc(docId).get();
    if (bookingDoc.exists) {
      const b = bookingDoc.data();
      queueSMS(b.phone || "", "reschedule_confirmed", { name: b.customerName || "", bookingRef: b.bookingRef || docId, date: newDate });
    }
    closeRescheduleModal(); showToast("✅ Booking rescheduled!"); loadUserBookings();
  } catch(e) { showToast("❌ Error: " + e.message); }
  finally { if (btn) { btn.textContent = "Confirm Reschedule"; btn.disabled = false; } }
}

let ratingBookingDocId = "", selectedDriverRating = 0;
function openRateDriverModal(bookingDocId, bookingRef, driverName) {
  ratingBookingDocId = bookingDocId; selectedDriverRating = 0;
  document.getElementById("rateBookingRef").textContent = bookingRef || bookingDocId;
  document.getElementById("rateDriverName").textContent = driverName || "your driver";
  document.getElementById("ratingFeedback").value = "";
  document.getElementById("ratingMsg").textContent = "";
  document.querySelectorAll(".rate-star").forEach(s => s.classList.remove("active"));
  document.getElementById("rateDriverModal").style.display = "flex";
}
function closeRateDriverModal() { document.getElementById("rateDriverModal").style.display = "none"; }
function selectDriverRating(n) { selectedDriverRating = n; document.querySelectorAll(".rate-star").forEach((s,i) => s.classList.toggle("active",i<n)); }

async function submitDriverRating() {
  if (!selectedDriverRating) { showToast("⚠️ Please select a star rating."); return; }
  if (!currentUser || !window._firebase) return;
  const feedback = document.getElementById("ratingFeedback").value.trim();
  const btn = document.getElementById("btnSubmitRating");
  if (btn) { btn.textContent = "Submitting..."; btn.disabled = true; }
  try {
    await window._firebase.db.collection("bookings").doc(ratingBookingDocId).update({ driverRating: selectedDriverRating, driverFeedback: feedback, ratedAt: firebase.firestore.FieldValue.serverTimestamp() });
    const bookingDoc = await window._firebase.db.collection("bookings").doc(ratingBookingDocId).get();
    const driverUid = bookingDoc.data()?.driverUid;
    if (driverUid) {
      await window._firebase.db.collection("driverRatings").add({ driverUid, bookingDocId: ratingBookingDocId, rating: selectedDriverRating, feedback, customerUid: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      const ratingsSnap = await window._firebase.db.collection("driverRatings").where("driverUid","==",driverUid).get();
      const ratings = ratingsSnap.docs.map(d => d.data().rating);
      const avg = ratings.reduce((a,b) => a+b,0) / ratings.length;
      await window._firebase.db.collection("drivers").doc(driverUid).update({ avgRating: Math.round(avg*10)/10, totalRatings: ratings.length }).catch(()=>{});
    }
    closeRateDriverModal(); showToast("⭐ Thanks for rating your driver!"); loadUserBookings();
  } catch(e) { showToast("Error: " + e.message); }
  finally { if (btn) { btn.textContent = "Submit Rating"; btn.disabled = false; } }
}

let damageBookingDocId = "", damagePhotos = [];
function openDamageModal(bookingDocId, bookingRef) {
  damageBookingDocId = bookingDocId; damagePhotos = [];
  document.getElementById("damageBookingRef").textContent = bookingRef || bookingDocId;
  ["damageType","damageDesc"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("damagePhotoPreview").innerHTML = "";
  document.getElementById("damageMsg").textContent = "";
  document.getElementById("damageModal").style.display = "flex";
}
function closeDamageModal() { document.getElementById("damageModal").style.display = "none"; }

function previewDamagePhotos(input) {
  const preview = document.getElementById("damagePhotoPreview");
  preview.innerHTML = ""; damagePhotos = [];
  Array.from(input.files).slice(0,5).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      damagePhotos.push(e.target.result);
      const img = document.createElement("img");
      img.src = e.target.result;
      img.style.cssText = "width:70px;height:70px;object-fit:cover;border-radius:8px;border:2px solid var(--border-light)";
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

async function submitDamageClaim() {
  const damageType = document.getElementById("damageType").value;
  const damageDesc = document.getElementById("damageDesc").value.trim();
  if (!damageType) { showToast("⚠️ Please select the type of damage."); return; }
  if (!damageDesc) { showToast("⚠️ Please describe what happened."); return; }
  if (!currentUser || !window._firebase) return;
  const btn = document.getElementById("btnSubmitDamage");
  if (btn) { btn.textContent = "Submitting..."; btn.disabled = true; }
  try {
    const claimRef = await window._firebase.db.collection("damageClaims").add({ bookingDocId: damageBookingDocId, customerUid: currentUser.uid, damageType, description: damageDesc, photos: damagePhotos.slice(0,5), status:"pending", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await window._firebase.db.collection("bookings").doc(damageBookingDocId).update({ damageClaimed: true, damageClaimId: claimRef.id, damageClaimedAt: firebase.firestore.FieldValue.serverTimestamp() });
    const b = (await window._firebase.db.collection("bookings").doc(damageBookingDocId).get()).data();
    queueSMS(b?.phone||"", "damage_claim", { name: b?.customerName||"Customer", bookingRef: b?.bookingRef||damageBookingDocId, claimId: claimRef.id.slice(0,8).toUpperCase() });
    closeDamageModal(); showToast("✅ Claim submitted!"); loadUserBookings();
  } catch(e) {
    const msgEl = document.getElementById("damageMsg");
    if (msgEl) { msgEl.textContent = "Error: " + e.message; msgEl.style.color = "#dc2626"; }
  }
  finally { if (btn) { btn.textContent = "Submit Claim"; btn.disabled = false; } }
}

/* ============================================
SMS & NOTIFICATIONS
============================================ */
const SMS_TEMPLATES = {
  booking_confirmed: d => `Hi ${d.name}, your PackZen booking ${d.bookingRef} is confirmed for ${d.date}! Pickup: ${(d.pickup||"").split(",")[0]}. Est. cost: Rs.${Number(d.total).toLocaleString("en-IN")}. Track: packzenblr.in. Queries: 9945095453`,
  driver_assigned: d => `Hi ${d.name}, your PackZen driver ${d.driverName} (${d.driverPhone}) is assigned for booking ${d.bookingRef}. Track live on packzenblr.in. Queries: 9945095453`,
  move_started: d => `Hi ${d.name}, your goods are now in transit for booking ${d.bookingRef}. Track your driver live on packzenblr.in.`,
  delivered: d => `Hi ${d.name}, your PackZen move ${d.bookingRef} is complete! Please rate your driver on packzenblr.in. Thank you for choosing PackZen!`,
  cancelled: d => `Hi ${d.name}, your PackZen booking ${d.bookingRef} has been cancelled. Refund (if any) in 5-7 business days. Queries: 9945095453`,
  damage_claim: d => `Hi ${d.name}, your damage claim (ID: ${d.claimId}) for booking ${d.bookingRef} has been received. Our team will respond within 3 business days. Queries: 9945095453`,
  reschedule_confirmed: d => `Hi ${d.name}, your PackZen booking ${d.bookingRef} has been rescheduled to ${d.date}. Queries: 9945095453`,
};

async function queueSMS(phone, templateKey, data) {
  if (!phone || !window._firebase) return;
  const mobile = "91" + String(phone).replace(/\D/g,"").slice(-10);
  if (mobile.length !== 12) return;
  const template = SMS_TEMPLATES[templateKey];
  if (!template) return;
  try {
    await window._firebase.db.collection("smsQueue").add({ mobile, message: template(data), status:"pending", createdAt: firebase.firestore.FieldValue.serverTimestamp(), retries:0 });
  } catch(e) {}
}

function setupStatusSMS(bookingDocId, customerPhone, customerName, bookingRef) {
  if (!bookingDocId || !window._firebase) return;
  const map = { transit:"move_started", delivered:"delivered", cancelled:"cancelled" };
  let lastStatus = "";
  window._firebase.db.collection("bookings").doc(bookingDocId).onSnapshot(doc => {
    if (!doc.exists) return;
    const b = doc.data(); const status = b.status;
    if (!status || status === lastStatus) return;
    lastStatus = status;
    if (map[status]) queueSMS(b.phone||customerPhone, map[status], { name: b.customerName||customerName, bookingRef: b.bookingRef||bookingRef||bookingDocId, driverName: b.driverName||"", driverPhone: b.driverPhone||"", date: b.date||"" });
    if (status === "assigned" && b.driverName) queueSMS(b.phone||customerPhone, "driver_assigned", { name: b.customerName||customerName, bookingRef: b.bookingRef||bookingDocId, driverName: b.driverName, driverPhone: b.driverPhone||"" });
  });
}

async function requestPushPermission() {
  if (!("Notification" in window) || !window._firebase?.messaging) return;
  try {
    if (await Notification.requestPermission() !== "granted") return;
    const token = await window._firebase.messaging.getToken({ vapidKey: window.ENV?.FCM_VAPID_KEY || "" });
    if (token && currentUser) await window._firebase.db.collection("users").doc(currentUser.uid).update({ fcmToken: token, fcmUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  } catch(e) {}
}

function subscribeToBookingNotifications(bookingDocId) {
  if (!bookingDocId || !window._firebase) return;
  const msgs = {
    assigned: {title:"🚛 Driver Assigned!", body:"Your driver is on the way."},
    packing: {title:"📦 Packing Started", body:"Our team is packing your items."},
    transit: {title:"🚚 On The Move!", body:"Your goods are in transit."},
    delivered: {title:"🎉 Delivered!", body:"Your move is complete."},
    cancelled: {title:"❌ Booking Cancelled",body:"Your booking has been cancelled."}
  };
  let lastStatus = "";
  window._firebase.db.collection("bookings").doc(bookingDocId).onSnapshot(doc => {
    if (!doc.exists) return;
    const status = doc.data().status;
    if (status && status !== lastStatus && msgs[status]) {
      if (Notification.permission === "granted") new Notification(msgs[status].title, { body: msgs[status].body, icon:"/favicon.ico" });
      lastStatus = status;
    }
  });
  setupStatusSMS(bookingDocId, "", "", "");
}

function generateDeliveryOtp() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit OTP
}
/* ============================================
HELPERS
============================================ */
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

function getFurnitureSummary() {
  const labels = {
    sofaCheck:"Sofa", bedCheck:"Bed", tvCheck:"TV", tvUnitCheck:"TV Unit", coffeeCheck:"Coffee Table", acCheck:"AC Unit",
    wardrobeCheck:"Wardrobe", dressingCheck:"Dressing Table", sideTableCheck:"Side Table", fridgeCheck:"Fridge",
    wmCheck:"Washing Machine", microwaveCheck:"Microwave", chimneyCheck:"Chimney", diningCheck:"Dining Table",
    bikeCheck:"Bike/Scooter", cycleCheck:"Cycle", plantCheck:"Large Plants", gymCheck:"Gym Equipment",
    deskCheck:"Office Desk", chairCheck:"Chair", cabinetCheck:"Filing Cabinet", serverCheck:"Server/PC",
    printerCheck:"Printer", confCheck:"Conf. Table", whiteboardCheck:"Whiteboard"
  };
  const items = [];
  Object.entries(labels).forEach(([id, name]) => {
    const qty = parseInt(document.getElementById(id)?.value || 0);
    if (qty > 0) items.push(qty > 1 ? `${name} ×${qty}` : name);
  });
  const cartonQty = parseInt(document.getElementById("cartonQty")?.value || 0);
  if (cartonQty > 0) items.push(`Carton Boxes ×${cartonQty}`);
  return items.join(", ") || "";
}

/* ============================================
CREATE DRIVER (Admin)
============================================ */
async function createDriver() {
  if (!currentUser) { showToast("⚠️ Please login as admin."); return; }
  const name = document.getElementById("newDriverName").value.trim();
  const email = document.getElementById("newDriverEmail").value.trim();
  const password = document.getElementById("newDriverPassword").value.trim();
  const msg = document.getElementById("adminMsg");
  const setMsg = (text, ok) => { msg.style.color = ok ? "#16a34a" : "#dc2626"; msg.textContent = text; };
  if (!name) return setMsg("⚠️ Please enter driver name.", false);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg("⚠️ Invalid email.", false);
  if (password.length < 6) return setMsg("⚠️ Password must be at least 6 characters.", false);
  const adminSnap = await window._firebase.db.collection("users").doc(currentUser.uid).get();
  if (!adminSnap.exists || adminSnap.data().role !== "admin") return setMsg("⚠️ Access denied.", false);
  setMsg("⏳ Creating driver account...", true);
  try {
    const secondaryApp = firebase.initializeApp(firebase.app().options, "driverCreation" + Date.now());
    const secondaryAuth = secondaryApp.auth();
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
    await secondaryAuth.signOut(); await secondaryApp.delete();
    await window._firebase.db.collection("users").doc(cred.user.uid).set({
      name, email, role: "driver", isOnline: false, phone: "", vehicle: "", rating: 0, totalMoves: 0,
      createdBy: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    setMsg(`✅ Driver "${name}" created!`, true);
    ["newDriverName","newDriverEmail","newDriverPassword"].forEach(id => { document.getElementById(id).value = ""; });
  } catch(error) {
    setMsg("⚠️ " + (error.code === "auth/email-already-in-use" ? "Email already exists." : error.message), false);
  }
}

/* ============================================
INVOICE / PDF
============================================ */
async function emailInvoice(docId) {
  if (typeof emailjs === "undefined") { showToast("⚠️ Email service not ready."); return; }
  if (!window._firebase) { showToast("⚠️ Firebase not initialized."); return; }

  let targetId = docId || currentBookingId;
  if (!targetId) { showToast("⚠️ No booking found."); return; }

  showToast("⏳ Sending Email...");

  try {
    const docSnap = await window._firebase.db.collection("bookings").doc(targetId).get();
    if (!docSnap.exists) { showToast("⚠️ Booking not found."); return; }

    const b = docSnap.data();

    if (!b.email && !currentUser?.email) {
      // Fallback if no email on booking, try to fetch from user profile
      const userSnap = await window._firebase.db.collection("users").doc(b.customerUid).get();
      if(userSnap.exists && userSnap.data().email) {
        b.email = userSnap.data().email;
      } else {
        showToast("⚠️ No email address found for this customer.");
        return;
      }
    }

    const recipientEmail = b.email || currentUser?.email;

    // We send an invoice notification email since we can't easily attach the generated PDF via client-side EmailJS
    // Reusing the template_hffggde or similar to notify them it's ready/provide the details
    emailjs.send("service_surriec", "template_hffggde", {
      booking_id: b.bookingRef || targetId,
      name: b.customerName || "Customer",
      email: recipientEmail,
      phone: b.phone || "—",
      pickup: (b.pickup || "").split(",")[0],
      drop: (b.drop || "").split(",")[0],
      date: b.date || "TBD",
      amount: b.total || 0,
      message: "Your invoice has been generated. You can download the PDF from your PackZen dashboard."
    }).then(() => {
      showToast("✅ Invoice emailed successfully!");
    }).catch((err) => {
      console.error("Email failed:", err);
      showToast("❌ Failed to send email.");
    });

  } catch (err) {
     console.error("Error fetching for email:", err);
     showToast("❌ Error sending email.");
  }
}

async function downloadInvoice(docId) {
  if (typeof window.jspdf === "undefined") { showToast("⚠️ PDF library loading..."); return; }
  if (!window._firebase) { showToast("⚠️ Firebase not initialized."); return; }

  let targetId = docId || currentBookingId;
  if (!targetId) { showToast("⚠️ No booking found."); return; }

  showToast("⏳ Generating Invoice...");

  try {
    const docSnap = await window._firebase.db.collection("bookings").doc(targetId).get();
    if (!docSnap.exists) { showToast("⚠️ Booking not found."); return; }

    const b = docSnap.data();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const fmt = n => Number(n || 0).toLocaleString("en-IN");
    const safe = str => (str || "—").toString();

    // --- Header ---
    doc.setFillColor(0, 87, 255); // var(--primary)
    doc.rect(0, 0, 210, 40, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("PackZen", 14, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Professional Packers & Movers", 14, 28);

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("INVOICE", 160, 22);

    // --- Invoice Info ---
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Invoice No:", 140, 50);
    doc.setFont("helvetica", "normal");
    doc.text(safe(b.bookingRef), 170, 50);

    doc.setFont("helvetica", "bold");
    doc.text("Invoice Date:", 140, 56);
    doc.setFont("helvetica", "normal");
    const invDate = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN");
    doc.text(invDate, 170, 56);

    // --- Customer Details ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Customer Details", 14, 50);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Name: ${safe(b.customerName)}`, 14, 56);
    doc.text(`Phone: ${safe(b.phone)}`, 14, 62);
    if(b.email) doc.text(`Email: ${safe(b.email)}`, 14, 68);

    // --- Move Details ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Move Details", 14, 80);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    const pickupLines = doc.splitTextToSize(`Pickup: ${safe(b.pickup)}`, 85);
    doc.text(pickupLines, 14, 86);
    let yPos = 86 + (pickupLines.length * 5);

    const dropLines = doc.splitTextToSize(`Drop: ${safe(b.drop)}`, 85);
    doc.text(dropLines, 14, yPos);
    yPos += (dropLines.length * 5);

    doc.text(`Move Date: ${safe(b.date)} ${safe(b.shiftTimeLabel)}`, 14, yPos);
    doc.text(`Distance: ${b.distance ? b.distance + ' km' : '—'}`, 14, yPos + 6);
    doc.text(`Vehicle: ${safe(b.vehicle)}`, 14, yPos + 12);

    // Driver Info (Right side)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Driver Details", 120, 80);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Name: ${safe(b.driverName)}`, 120, 86);
    doc.text(`Phone: ${safe(b.driverPhone)}`, 120, 92);

    yPos = yPos + 22;

    // --- Itemized Charges ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Charges Breakdown", 14, yPos);
    yPos += 8;

    // Draw table header
    doc.setFillColor(240, 244, 255);
    doc.rect(14, yPos - 5, 182, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Description", 16, yPos);
    doc.text("Amount (INR)", 160, yPos);
    yPos += 8;

    doc.setFont("helvetica", "normal");

    const bd = b.quoteBreakdown || {};

    const addCharge = (label, amount) => {
      if (amount > 0) {
        doc.text(label, 16, yPos);
        doc.text(`Rs. ${fmt(amount)}`, 160, yPos);
        yPos += 6;
      }
    };

    if (bd.baseFare) addCharge("Base Fare", bd.baseFare);
    else if (b.total) addCharge("Move Charge", b.originalTotal || b.total);

    addCharge("Distance Charge", bd.distanceCharge);
    addCharge("Floor & Handling Charge", bd.floorCharge);
    addCharge("Packing Service", bd.packingCharge);
    addCharge("Furniture & Assembly", bd.furnitureCharge);
    addCharge("Carton Boxes", bd.cartonCharge);

    if (bd.surcharges && bd.surcharges.length > 0) {
       bd.surcharges.forEach(s => addCharge(`Surcharge (${s.label})`, s.amount));
    }

    if (b.promoDiscount > 0 || bd.discount > 0) {
      doc.setTextColor(22, 163, 74); // Green
      addCharge("Discount", -(b.promoDiscount || bd.discount));
      doc.setTextColor(0, 0, 0);
    }

    // Line separator
    yPos += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(14, yPos, 196, yPos);
    yPos += 6;

    // Total
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Grand Total:", 120, yPos);
    doc.text(`Rs. ${fmt(b.total)}`, 160, yPos);

    yPos += 15;

    // --- Payment Info ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Payment Details", 14, yPos);
    yPos += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    let paymentMethod = "Pay Later / Cash";
    if (b.paymentType === "full") paymentMethod = "Online (Paid in Full)";
    else if (b.paymentType === "advance") paymentMethod = "Online (Advance Paid)";

    doc.text(`Payment Method: ${paymentMethod}`, 14, yPos);
    doc.text(`Amount Paid: Rs. ${fmt(b.paid || 0)}`, 14, yPos + 6);
    const balance = Math.max((b.total || 0) - (b.paid || 0), 0);
    doc.setFont("helvetica", "bold");
    doc.text(`Balance Due: Rs. ${fmt(balance)}`, 14, yPos + 12);

    // Items / Furniture Summary (if any)
    yPos += 25;
    if (b.furniture || (b.selectedFurniture && Object.keys(b.selectedFurniture).length > 0)) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Items Summary", 14, yPos);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);

        let furnText = b.furniture || "";
        if (!furnText && b.selectedFurniture) {
            furnText = Object.entries(b.selectedFurniture)
                .filter(([k,v]) => v > 0)
                .map(([k,v]) => `${k} x${v}`)
                .join(", ");
        }
        const furnLines = doc.splitTextToSize(furnText || "None specified", 180);
        doc.text(furnLines, 14, yPos + 5);
    }

    // --- Footer ---
    const pageHeight = doc.internal.pageSize.height;
    doc.setFillColor(245, 247, 250);
    doc.rect(0, pageHeight - 20, 210, 20, "F");

    doc.setTextColor(100, 100, 100);
    doc.setFontSize(9);
    doc.text("Thank you for choosing PackZen.", 14, pageHeight - 12);
    doc.text("Website: packzenblr.in", 14, pageHeight - 7);
    doc.text("Support: 9945095453", 150, pageHeight - 7);

    doc.save(`PackZen-Invoice-${b.bookingRef || targetId}.pdf`);
    showToast("✅ Invoice downloaded successfully!");

  } catch (error) {
    console.error("Error generating invoice:", error);
    showToast("❌ Error generating invoice.");
  }
}

function copyBookingId() {
  const id = document.getElementById("bookingIdDisplay")?.textContent;
  if (!id || id === "—") return;
  navigator.clipboard.writeText(id).then(() => showToast("✅ Booking ID copied!"))
    .catch(() => {
      const el = document.createElement("textarea"); el.value = id;
      document.body.appendChild(el); el.select(); document.execCommand("copy");
      document.body.removeChild(el); showToast("✅ Booking ID copied!");
    });
}

/* ============================================
EMAIL NOTIFICATION
============================================ */
function sendEmailNotification(bookingRef, name, phone, pickup, drop, date, total) {
  if (typeof emailjs === "undefined") return;
  emailjs.send("service_surriec", "template_hffggde", {
    booking_id: bookingRef, name: name, phone: phone, pickup: pickup, drop: drop, date: date, amount: total
  }).then(() => { console.log("Email sent successfully"); }).catch((err) => { console.error("Email failed:", err); });
}

/* ============================================
WHATSAPP AFTER PAYMENT
============================================ */
function sendWhatsAppAfterPayment() {
  showToast("✅ Booking confirmed! Our team will contact you shortly.");
  closeModal();
}

/* ============================================
FAQ
============================================ */
function toggleFaq(btn) {
  const item = btn.closest(".faq-item");
  const isOpen = item.classList.contains("open");
  document.querySelectorAll(".faq-item.open").forEach(i => i.classList.remove("open"));
  if (!isOpen) item.classList.add("open");
}


/* ============================================
FIREBASE EMAIL ACTION HANDLER
============================================ */
async function handleFirebaseActionCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  const oobCode = urlParams.get('oobCode');

  if (!mode || !oobCode) return;

  waitForFirebase(async () => {
    const auth = window._firebase.auth;
    try {
      if (mode === 'verifyEmail') {
        await auth.applyActionCode(oobCode);
        const user = auth.currentUser;
        if (user) {
          await window._firebase.db.collection('users').doc(user.uid).update({ emailVerified: true });
        }
        showToast("✅ Email verified successfully!");
        // Clear the URL parameters
        window.history.replaceState(null, '', window.location.pathname);
  } else if (mode === 'resetPassword') {
        const email = await auth.verifyPasswordResetCode(oobCode);
        const modal = document.getElementById('newPasswordModal');
        if (modal) {
          document.getElementById('newPasswordEmailDisplay').textContent = email;
          modal.style.display = 'flex';
        }
      } else if (mode === 'verifyAndChangeEmail') {
        await auth.applyActionCode(oobCode);
        await auth.currentUser?.reload();
        const user = auth.currentUser;
        if (user) {
          await window._firebase.db.collection('users').doc(user.uid).update({ email: user.email });
        }
        showToast("✅ Email address updated successfully!");
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (err) {
      console.error(err);
      showToast("⚠️ Invalid or expired link. Please try again.");
    }
  });
}

async function submitNewPassword() {
  const urlParams = new URLSearchParams(window.location.search);
  const oobCode = urlParams.get('oobCode');
  const newPassword = document.getElementById('newPasswordInput').value;
  const confirmPassword = document.getElementById('newPasswordConfirmInput').value; 
  const btn = document.getElementById('btnSubmitNewPassword');

  if (!newPassword || newPassword.length < 6) {
    showError("newPasswordError", "⚠️ Password must be at least 6 characters.");
    return;
  }
  if (newPassword !== confirmPassword) {
    showError("newPasswordError", "⚠️ Passwords do not match.");
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Updating..."; }
  showError("newPasswordError", "", "info");

  waitForFirebase(async () => {
    const auth = window._firebase.auth;
    try {
      await auth.confirmPasswordReset(oobCode, newPassword);
      showError("newPasswordError", "✅ Password updated successfully! Please login.", "success");
      setTimeout(() => {
        closeNewPasswordModal();
        openAuthModal();
        switchPanel('panelLogin');
        window.history.replaceState(null, '', window.location.pathname);
      }, 3000);
    } catch (err) {
      console.error(err);
      showError("newPasswordError", getAuthErrorMessage(err.code));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Update Password"; }
    }
  });
}

function closeNewPasswordModal() {
  const modal = document.getElementById('newPasswordModal');
  if (modal) modal.style.display = 'none';
}
async function requestEmailChange(newEmail) {
  if (!currentUser) { showToast("⚠️ Please login first."); return; }
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { showToast("⚠️ Enter a valid email address."); return; }
  waitForFirebase(async () => {
    const { functions } = window._firebase;
    try {
      await functions.httpsCallable("sendEmailChangeLinkBrevo")({ newEmail });
      showToast("✅ Confirmation link sent to " + newEmail + ". Check your inbox to confirm the change.");
    } catch (err) {
      console.error(err);
      showToast("⚠️ " + (err.message || "Failed to send confirmation email."));
    }
  });
}

/* ============================================
PAGE LOAD
============================================ */
document.addEventListener("DOMContentLoaded", () => {
  handleFirebaseActionCode();
 setTimeout(() => {
    initGeolocationFeature();
}, 1000);

  try { buildDateStrip(); } catch(e) { console.error("buildDateStrip failed:", e); }

  if (localStorage.getItem("packzen-theme") === "dark") {
    document.body.classList.add("dark-mode");
    const btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = "☀️";
  }

  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!["INPUT","TEXTAREA","SELECT"].includes(el.tagName)) return;
    if (window.innerWidth > 768) return;
    setTimeout(() => { el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 320);
  });

  const makeVisible = () => document.querySelectorAll(".reveal, .reveal-stagger").forEach(el => el.classList.add("visible"));
  makeVisible(); setTimeout(makeVisible, 100); setTimeout(makeVisible, 500);

  const STAT_VALUES = [100, 2026, 100, 0];
  document.querySelectorAll(".stat-number").forEach((el, i) => {
    if (STAT_VALUES[i] !== undefined) {
      el.setAttribute("data-target", STAT_VALUES[i]);
      el.removeAttribute("data-animated");
      el.textContent = STAT_VALUES[i].toLocaleString("en-IN");
    }
  });

  function animateCounter(el) {
    if (el.dataset.animated) return;
    el.dataset.animated = "1";
    const target = parseInt(el.getAttribute("data-target"), 10);
    if (isNaN(target)) return;
    const dur = 2000, start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target).toLocaleString("en-IN");
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target.toLocaleString("en-IN");
    }
    requestAnimationFrame(tick);
  }

  const statsObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.querySelectorAll(".stat-number").forEach(animateCounter); statsObs.unobserve(e.target); }
    });
  }, { threshold: 0.1 });

  const strip = document.getElementById("statsStrip");
  if (strip) {
    statsObs.observe(strip);
    setTimeout(() => {
      if (strip.getBoundingClientRect().top < window.innerHeight) {
        strip.querySelectorAll(".stat-number").forEach(animateCounter);
        statsObs.unobserve(strip);
      }
    }, 500);
  }

  document.querySelectorAll("button, .btn-primary, .btn-ghost").forEach(btn => {
    btn.addEventListener("click", function (e) {
      const r = document.createElement("span"); r.classList.add("ripple");
      const rect = this.getBoundingClientRect(), size = Math.max(rect.width, rect.height);
      r.style.width = r.style.height = size + "px";
      r.style.left = e.clientX - rect.left - size / 2 + "px";
      r.style.top = e.clientY - rect.top - size / 2 + "px";
      this.appendChild(r);
      r.addEventListener("animationend", () => r.remove());
      // Fallback in case animation doesn't play
      setTimeout(() => { if (r.parentNode) r.remove(); }, 1000);
    });
  });

  const priceEl = document.getElementById("livePrice");
  if (priceEl) new MutationObserver(() => {
    priceEl.classList.remove("updated"); void priceEl.offsetWidth; priceEl.classList.add("updated");
  }).observe(priceEl, { childList: true });

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener("click", function (e) {
      const href = this.getAttribute("href");
      if (!href || href === "#") return;
      const t = document.querySelector(href);
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: "smooth" }); }
    });
  });

  const navbar = document.querySelector(".navbar");
  if (navbar) {
    window.addEventListener("scroll", () => {
      navbar.style.background = window.scrollY > 50 ? "rgba(5,13,26,0.97)" : "rgba(5,13,26,0.85)";
    }, { passive: true });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#navUser")) document.getElementById("userDropdown")?.classList.remove("open");
  });

  waitForFirebase(() => {
    const auth = window._firebase.auth;
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    auth.onAuthStateChanged(user => {
      currentUser = user;
      updateNavForUser(user);
      if (user) {
        window._firebase.db.collection("users").doc(user.uid).get().then(doc => {
          if (doc.exists) prefillBookingForm(doc.data());
        });
        checkAndShowActiveBooking(user.uid);
      } else {
        const banner = document.getElementById("trackOrderBanner");
        if (banner) banner.style.display = "none";
      }
    });
  });

  loadReviewsPublic();
  buildChecklist();
  setTimeout(() => renderSizeCards("home"), 100);
  initPaymentOptions();
  buildDateStrip();

  // Inject furniture grid styles
  if (!document.getElementById("pz-fc-styles")) {
    const s = document.createElement("style");
    s.id = "pz-fc-styles";
    s.textContent = `.furniture-grid{display:flex;flex-direction:column;gap:8px;} .fc-category{border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;} .fc-category-header{display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(255,255,255,0.04);cursor:pointer;transition:background .2s;user-select:none;} .fc-category-header:hover{background:rgba(255,255,255,0.08);} .fc-cat-icon{font-size:1.1rem;} .fc-cat-label{flex:1;font-weight:600;font-size:.9rem;color:var(--text,#fff);} .fc-cat-arrow{font-size:.8rem;color:var(--text-muted,#aaa);transition:transform .2s;} .fc-category-items{display:none;flex-wrap:wrap;gap:10px;padding:12px;background:rgba(255,255,255,0.02);} .fc-qty-card{display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 8px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);transition:all .2s;width:88px;text-align:center;} .fc-qty-card.active{border-color:#3b82f6;background:rgba(59,130,246,0.13);} .fc-emoji{font-size:1.4rem;line-height:1;} .fc-name{font-size:.68rem;font-weight:500;color:var(--text,#fff);line-height:1.2;min-height:2em;display:flex;align-items:center;justify-content:center;} .fc-price-tag{font-size:.64rem;color:#22c55e;font-weight:600;display:none!important;} .fc-qty-row{display:flex;align-items:center;gap:4px;margin-top:2px;} .fc-qty-btn{width:26px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.07);color:var(--text,#fff);font-size:1rem;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;-webkit-tap-highlight-color:transparent;} .fc-qty-btn:hover,.fc-qty-btn:active{background:#3b82f6;border-color:#3b82f6;} .fc-qty-input{width:26px;text-align:center;background:transparent;border:none;color:var(--text,#fff);font-size:.85rem;font-weight:700;-moz-appearance:textfield;pointer-events:none;} .fc-qty-input::-webkit-outer-spin-button,.fc-qty-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;} .carton-box-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:4px 0;width:100%;} .carton-label{font-size:.85rem;color:var(--text,#fff);flex:1;min-width:160px;} .carton-qty-wrap{display:flex;align-items:center;gap:6px;} .carton-price-note{font-size:.8rem;color:#22c55e;font-weight:600;} @media(max-width:380px){.fc-qty-card{width:78px;padding:8px 5px;}}`;
    document.head.appendChild(s);
  }

  // Ensure recaptcha containers exist
  if (!document.getElementById("recaptcha-container-signup")) {
    const d = document.createElement("div");
    d.id = "recaptcha-container-signup";
    d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;";
    document.body.appendChild(d);
  }
  if (!document.getElementById("recaptcha-container-reset")) {
    const d = document.createElement("div");
    d.id = "recaptcha-container-reset";
    d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;";
    document.body.appendChild(d);
  }
});

// Recover failed booking on load
window.addEventListener("load", () => {
  const pendingBooking = localStorage.getItem("pendingBooking");
  if (pendingBooking) {
    console.log("⚠️ Found unsaved booking backup");
    showToast("Recovered unsaved booking data.");
    localStorage.removeItem("pendingBooking");
  }
});

/* ============================================
BOTTOM SHEET SYSTEM
============================================ */
let _activeBs = null;

function openBottomSheet(id) {
  closeAllBottomSheets();
  const sheet = document.getElementById(id);
  const overlay = document.getElementById("bsOverlay");
  if (!sheet || !overlay) return;
  if (id === "bsDate") buildBsDateStrip();
  if (id === "bsHouse") buildBsHouseOptions();
  overlay.classList.add("open");
  sheet.classList.add("open");
  _activeBs = id;
  document.body.style.overflow = "hidden";
}

function closeAllBottomSheets() {
  document.querySelectorAll(".bottom-sheet.open").forEach(s => s.classList.remove("open"));
  const overlay = document.getElementById("bsOverlay");
  if (overlay) overlay.classList.remove("open");
  _activeBs = null;
  document.body.style.overflow = "";
}

function buildBsDateStrip() {
  const strip = document.getElementById("bsDateStrip");
  if (!strip) return;
  strip.innerHTML = "";
  const today = new Date(); today.setHours(0,0,0,0);
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const selected = document.getElementById("shiftDate")?.value;
  const di = document.getElementById("bsDateInput");
  if (di) di.min = today.toISOString().split("T")[0];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const ds = d.toISOString().split("T")[0];
    const card = document.createElement("div");
    card.className = "bs-date-card" + (i === 0 ? " today-card" : "") + (ds === selected ? " selected" : "");
    card.dataset.date = ds;
    card.innerHTML = `<div class="bs-dc-day">${DAYS[d.getDay()]}</div><div class="bs-dc-num">${d.getDate()}</div><div class="bs-dc-month">${MONTHS[d.getMonth()]}</div>${i === 0 ? '<div class="bs-dc-tag">Today</div>' : i === 1 ? '<div class="bs-dc-tag">Tomorrow</div>' : ''}`;
    card.addEventListener("click", () => { strip.querySelectorAll(".bs-date-card").forEach(c => c.classList.remove("selected")); card.classList.add("selected"); applyDate(ds, d); });
    strip.appendChild(card);
  }
}

function onBsDatePicked(val) {
  if (!val) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(val + "T00:00:00");
  if (d < today) { showToast("⚠️ Please select today or a future date."); return; }
  document.querySelectorAll(".bs-date-card").forEach(c => c.classList.remove("selected"));
  applyDate(val, d);
}

function applyDate(ds, d) {
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  document.getElementById("shiftDate").value = ds;
  const trigger = document.getElementById("dateTrigger");
  const text = document.getElementById("dateTriggerText");
  if (trigger) trigger.classList.add("filled");
  if (text) text.textContent = DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  closeAllBottomSheets();
  calculateQuote(true);
}

function pickTimeSlot(value, label) {
  document.getElementById("shiftTime").value = value;
  document.getElementById("shiftTimeLabel").value = label;
  document.querySelectorAll("#bsTime .bs-option").forEach(b => b.classList.remove("selected"));
  if (event && event.currentTarget) event.currentTarget.classList.add("selected");
  const trigger = document.getElementById("timeTrigger");
  const text = document.getElementById("timeTriggerText");
  if (trigger) trigger.classList.add("filled");
  if (text) text.textContent = label;
  setTimeout(closeAllBottomSheets, 250);
}

function buildBsHouseOptions() {
  const body = document.getElementById("bsHouseBody");
  if (!body) return;
  const config = MOVE_TYPE_CONFIG[selectedMoveType || "home"] || MOVE_TYPE_CONFIG.home;
  if (!config) return;
  const title = document.querySelector("#bsHouse .bs-title");
  if (title) title.textContent = "🏠 " + config.sizeLabel;
  const selected = document.getElementById("house")?.value;
  body.innerHTML = config.sizes.map(s => `<div class="bs-house-card ${s.value === selected ? "selected" : ""}" data-house-value="${s.value}" data-house-label="${s.icon} ${s.label}" data-house-short="${s.label}" role="button" tabindex="0"><div class="bs-house-icon">${s.icon}</div><div class="bs-house-label">${s.label}</div><div class="bs-house-sub">${s.sub || ""}</div></div>`).join("");
  body.querySelectorAll('.bs-house-card').forEach(card => {
    card.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      pickHouseType(e, this.getAttribute('data-house-value'), this.getAttribute('data-house-label'), this.getAttribute('data-house-short'));
    });
  });
}

function pickHouseType(event, value, label, shortLabel) {
  const sel = document.getElementById("house");
  if (sel) sel.value = value;
  document.querySelectorAll(".bs-house-card").forEach(c => c.classList.remove("selected"));
  if (event && event.currentTarget) event.currentTarget.classList.add("selected");
  const trigger = document.getElementById("houseTrigger");
  const text = document.getElementById("houseTriggerText");
  if (trigger) trigger.classList.add("filled");
  if (text) text.textContent = label;
  setTimeout(() => { closeAllBottomSheets(); calculateQuote(true); }, 250);
}

function pickVehicle(value, label, sub, price) {
  const sel = document.getElementById("vehicle");
  if (sel) sel.value = value;
  document.querySelectorAll(".bs-vehicle-opt").forEach(b => b.classList.remove("selected"));
  if (event && event.currentTarget) event.currentTarget.classList.add("selected");
  const trigger = document.getElementById("vehicleTrigger");
  const text = document.getElementById("vehicleTriggerText");
  if (trigger) trigger.classList.add("filled");
  if (text) text.textContent = label + " · " + price;
  setTimeout(() => { closeAllBottomSheets(); calculateQuote(true); }, 250);
}

function pickFloor(type, value, label, price) {
  const sel = document.getElementById(type === "pickup" ? "pickupFloor" : "dropFloor");
  if (sel) sel.value = value;
  const sheetId = type === "pickup" ? "bsPickupFloor" : "bsDropFloor";
  const triggerId = type === "pickup" ? "pickupFloorTrigger" : "dropFloorTrigger";
  const textId = type === "pickup" ? "pickupFloorText" : "dropFloorText";
  document.querySelectorAll("#" + sheetId + " .bs-option").forEach(b => b.classList.remove("selected"));
  if (event && event.currentTarget) event.currentTarget.classList.add("selected");
  const trigger = document.getElementById(triggerId);
  const text = document.getElementById(textId);
  if (trigger) trigger.classList.add("filled");
  if (text) text.textContent = label + " " + price;
  setTimeout(() => { closeAllBottomSheets(); calculateQuote(true); }, 250);
}

(function () {
  let startY = 0;
  document.addEventListener("touchstart", e => { if (e.target.closest(".bottom-sheet")) startY = e.touches[0].clientY; }, { passive: true });
  document.addEventListener("touchend", e => { if (!_activeBs) return; if (e.changedTouches[0].clientY - startY > 80) closeAllBottomSheets(); }, { passive: true });
})();

/* ============================================
UTILITY
============================================ */
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
/* ============================================
   NOTIFICATION BELL
============================================ */

function openNotifications() {
    showToast("🔔 No notifications yet.");
}

document.addEventListener("DOMContentLoaded", () => {

    const bell = document.getElementById("navNotifBtn");

    if (bell) {

        bell.addEventListener("click", function (e) {

            e.preventDefault();
            e.stopPropagation();

            openNotifications();

        });

    }

});
window.addEventListener("load", () => {
  buildDateStrip();
});

/* ============================================
END OF FILE
============================================ */
