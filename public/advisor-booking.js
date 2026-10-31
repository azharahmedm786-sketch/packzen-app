/* PackZen advisor panel — New Booking (phone / walk-in bookings made by staff).
 * Price and booking are created on the server by advisorCreateBooking, using the SAME
 * pricing engine and record format as a website booking, so everything downstream
 * (confirmation e-mail, ops board, assignment, completion code, reviews) is identical.
 * The browser only collects details; it never decides the price or the status. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var DRAFT_KEY = "pz_adv_nb_draft";
  var VEHICLES = [["tata_ace", "Tata Ace", "1 RK / few items"], ["truck_14ft", "14 ft truck", "1 BHK"], ["truck_17ft", "17 ft truck", "2 BHK"], ["truck_22ft", "22 ft truck", "3 BHK+"]];
  var SIZES = {
    home: [["1rk", "1 RK", "tata_ace"], ["1bhk", "1 BHK", "truck_14ft"], ["2bhk", "2 BHK", "truck_17ft"], ["3bhk", "3 BHK", "truck_22ft"], ["villa", "4 BHK / Villa", "truck_22ft"]],
    office: [["small", "Small office (≤10 desks)", "truck_14ft"], ["medium", "Medium (10–30 desks)", "truck_17ft"], ["large", "Large (30+ desks)", "truck_22ft"]],
    single: [["few", "A few items", "tata_ace"]]
  };
  var PRESETS = {
    "1rk": { bedCheck: 1, mattressCheck: 1, fridgeCheck: 1, tvCheck: 1, _cartons: 10 },
    "1bhk": { sofaCheck: 1, bedCheck: 1, mattressCheck: 1, wardrobeCheck: 1, fridgeCheck: 1, wmCheck: 1, tvCheck: 1, tvUnitCheck: 1, _cartons: 20 },
    "2bhk": { sofaCheck: 1, bedCheck: 2, mattressCheck: 2, wardrobeCheck: 2, fridgeCheck: 1, wmCheck: 1, tvCheck: 1, tvUnitCheck: 1, diningCheck: 1, shoeRackCheck: 1, _cartons: 35 },
    "3bhk": { sofaCheck: 2, bedCheck: 3, mattressCheck: 3, wardrobeCheck: 3, fridgeCheck: 1, wmCheck: 1, tvCheck: 2, tvUnitCheck: 1, diningCheck: 1, showcaseCheck: 1, shoeRackCheck: 1, _cartons: 50 },
    "villa": { sofaCheck: 2, reclinerCheck: 1, bedCheck: 4, mattressCheck: 4, wardrobeCheck: 4, fridgeCheck: 2, wmCheck: 1, tvCheck: 3, tvUnitCheck: 2, diningCheck: 1, showcaseCheck: 1, shoeRackCheck: 2, _cartons: 70 },
    "small": { deskCheck: 8, chairCheck: 10, cabinetCheck: 2, printerCheck: 1, _cartons: 20 },
    "medium": { deskCheck: 20, chairCheck: 25, cabinetCheck: 5, printerCheck: 2, confCheck: 1, _cartons: 45 },
    "large": { deskCheck: 40, chairCheck: 50, cabinetCheck: 10, printerCheck: 3, confCheck: 2, serverCheck: 1, _cartons: 90 },
    "few": { _cartons: 0 }
  };
  var LABELS = { sofaCheck: "Sofa", sofaCumBedCheck: "Sofa-cum-bed", reclinerCheck: "Recliner", tvCheck: "TV", tvUnitCheck: "TV unit", coffeeCheck: "Coffee table",
    centerTableCheck: "Centre table", bookshelfCheck: "Bookshelf", showcaseCheck: "Showcase", shoeRackCheck: "Shoe rack", bedCheck: "Bed", mattressCheck: "Mattress",
    wardrobeCheck: "Wardrobe", dressingCheck: "Dressing table", sideTableCheck: "Side table", studyTableCheck: "Study table", fridgeCheck: "Fridge", wmCheck: "Washing machine",
    dishwasherCheck: "Dishwasher", microwaveCheck: "Microwave", ovenCheck: "Oven", chimneyCheck: "Chimney", diningCheck: "Dining table", waterPurifierCheck: "Water purifier",
    deskCheck: "Desk", chairCheck: "Chair", serverCheck: "Server rack", printerCheck: "Printer", confCheck: "Conference table", cabinetCheck: "Cabinet", bikeCheck: "Bike",
    cycleCheck: "Cycle", gymCheck: "Gym equipment", treadmillCheck: "Treadmill" };
  var RETIRED_CATS = ["handyman", "painting", "cleaning", "appliances", "ac-installation", "washing-machine-and-fridge"];
  var SVC = { list: [], cats: {}, qty: {}, loaded: false };
  function loadServices() {
    if (SVC.loaded) return Promise.resolve();
    var db = window._firebase && window._firebase.db; if (!db) return Promise.resolve();
    return Promise.all([db.collection("serviceCategories").get(), db.collection("services").get(), db.collection("addons").get()]).then(function (r) {
      r[0].docs.forEach(function (d) { SVC.cats[d.id] = d.data(); });
      var ok = function (x) { var c = SVC.cats[x.categoryId] || {}; return x.isActive !== false && c.isActive !== false && RETIRED_CATS.indexOf(x.categoryId) < 0 && !/clean/i.test(x.categoryId || "") && x.categoryId !== "moving" && x.categoryId !== "packing"; };
      r[1].docs.forEach(function (d) { var x = d.data(); if (ok(x)) SVC.list.push({ type: "services", id: d.id, name: x.name, price: x.basePrice, unit: x.pricingUnit, cat: x.categoryId }); });
      r[2].docs.forEach(function (d) { var x = d.data(); if (ok(x)) SVC.list.push({ type: "addons", id: d.id, name: x.name, price: x.basePrice, unit: x.pricingUnit, cat: x.categoryId }); });
      SVC.list.sort(function (a, b) { return String(a.cat).localeCompare(String(b.cat)) || String(a.name).localeCompare(String(b.name)); });
      SVC.loaded = true;
    }).catch(function () { SVC.loaded = false; });
  }
  function svcCard() {
    var card = $("nbSvcCard"); if (card) return card;
    card = document.createElement("div"); card.className = "nb-card"; card.id = "nbSvcCard"; card.style.display = "none";
    card.innerHTML = '<h3>🔧 Services</h3><div id="nbSvcList" class="nb-furniture-grid"><span style="color:var(--muted)">Loading services…</span></div>';
    var typeCard = $("nbTypeGrid") && $("nbTypeGrid").closest(".nb-card"); if (typeCard) typeCard.parentNode.insertBefore(card, typeCard.nextSibling);
    return card;
  }
  function renderSvc() {
    var box = $("nbSvcList"); if (!box) return;
    if (!SVC.list.length) { box.innerHTML = '<span style="color:var(--muted)">' + (SVC.loaded ? "No active services in the catalog." : "Loading services…") + "</span>"; return; }
    var lastCat = null;
    box.innerHTML = SVC.list.map(function (x) {
      var q = SVC.qty[x.type + ":" + x.id] || 0, head = "";
      if (x.cat !== lastCat) { lastCat = x.cat; head = '<div style="grid-column:1/-1;font-weight:800;margin-top:6px">' + esc((SVC.cats[x.cat] || {}).name || x.cat) + "</div>"; }
      var price = x.unit === "quote" ? "Quote on visit" : "₹" + Number(x.price || 0).toLocaleString("en-IN") + (x.unit === "per_item" ? " each" : "");
      return head + '<div class="nb-furn-card' + (q ? " active" : "") + '"><div style="font-size:.8rem;font-weight:700">' + esc(x.name) + '</div><div style="font-size:.72rem;color:var(--muted)">' + esc(price) + '</div>' +
        '<div class="nb-qty-row"><button type="button" class="nb-qty-btn" data-svc="' + esc(x.type + ":" + x.id) + '" data-d="-1">−</button><span style="min-width:22px;text-align:center;font-weight:800">' + q +
        '</span><button type="button" class="nb-qty-btn" data-svc="' + esc(x.type + ":" + x.id) + '" data-d="1">+</button></div></div>';
    }).join("");
  }
  function svcItems() { return Object.keys(SVC.qty).filter(function (k) { return SVC.qty[k] > 0; }).map(function (k) { var p = k.split(":"); return { type: p[0], id: p[1], qty: SVC.qty[k] }; }); }
  function setServiceMode(on) {
    svcCard().style.display = on ? "" : "none";
    var hide = [$("nbDrop") && $("nbDrop").closest(".nb-field"), $("nbMap"), $("nbDistanceInfo"), $("nbVehicleCard") || ($("nbVehicleGrid") && $("nbVehicleGrid").closest(".nb-card")),
      $("nbPickupFloor") && $("nbPickupFloor").closest(".nb-card"), $("nbFurnitureGrid") && $("nbFurnitureGrid").closest(".nb-card"), $("nbSizeGrid") && $("nbSizeGrid").parentNode];
    hide.forEach(function (el) { if (el) el.style.display = on ? "none" : ""; });
    var pl = $("nbPickup"); if (pl) { pl.placeholder = on ? "Service address (house / flat, area, Bangalore)" : "Enter pickup address"; var lab = pl.closest(".nb-field") && pl.closest(".nb-field").querySelector("label"); if (lab) lab.textContent = on ? "Service Address *" : "Pickup Address *"; }
    if (on) loadServices().then(renderSvc);
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-svc]"); if (!t) return;
    var k = t.dataset.svc; SVC.qty[k] = Math.max(0, Math.min(20, (SVC.qty[k] || 0) + Number(t.dataset.d))); renderSvc(); window.nbCalc();
  });
  function callSvc(data) { return firebase.app().functions("asia-south1").httpsCallable("advisorCreateServiceBooking")(data).then(function (r) { return r.data; }); }

  var S = { moveType: "home", size: "", vehicleId: "", furniture: {}, cartons: 0, coupon: "", quote: null, requestId: null, busy: false };
  var calcTimer = null, calcSeq = 0;

  function call(data) { return firebase.app().functions("asia-south1").httpsCallable("advisorCreateBooking")(data).then(function (r) { return r.data; }); }
  function val(id) { var el = $(id); return el ? String(el.value || "").trim() : ""; }
  function chk(id) { var el = $(id); return !!(el && el.checked); }
  function err(msg) { var e = $("nbFormErr"); if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; } }
  function rid() { return "adv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  /* ---------- grids ---------- */
  function renderSizes() {
    var g = $("nbSizeGrid"); if (!g) return;
    var lbl = $("nbSizeLabel"); if (lbl) lbl.textContent = S.moveType === "office" ? "Office size" : S.moveType === "single" ? "Items" : "House type";
    g.innerHTML = (SIZES[S.moveType] || []).map(function (s) {
      return '<button type="button" class="nb-select-card' + (S.size === s[0] ? " selected" : "") + '" data-size="' + s[0] + '">' + esc(s[1]) + "</button>";
    }).join("");
  }
  function renderVehicles() {
    var g = $("nbVehicleGrid"); if (!g) return;
    g.innerHTML = VEHICLES.map(function (v) {
      return '<button type="button" class="nb-select-card' + (S.vehicleId === v[0] ? " selected" : "") + '" data-veh="' + v[0] + '"><b>' + esc(v[1]) + "</b><br><small>" + esc(v[2]) + "</small></button>";
    }).join("");
  }
  function renderFurniture() {
    var g = $("nbFurnitureGrid"); if (!g) return;
    var ids = Object.keys(LABELS);
    g.innerHTML = ids.map(function (k) {
      var q = S.furniture[k] || 0;
      return '<div class="nb-furn-card' + (q ? " active" : "") + '"><div style="font-size:.78rem;font-weight:700">' + esc(LABELS[k]) + '</div>' +
        '<div class="nb-qty-row"><button type="button" class="nb-qty-btn" data-f="' + k + '" data-d="-1" aria-label="Fewer ' + esc(LABELS[k]) + '">−</button>' +
        '<span style="min-width:22px;text-align:center;font-weight:800">' + q + '</span><button type="button" class="nb-qty-btn" data-f="' + k + '" data-d="1" aria-label="More ' + esc(LABELS[k]) + '">+</button></div></div>';
    }).join("");
    if ($("nbCartonQty")) $("nbCartonQty").textContent = S.cartons;
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-size],[data-veh],[data-f]"); if (!t || !t.closest("#secNewbooking")) return;
    if (t.dataset.size) {
      S.size = t.dataset.size; var p = PRESETS[S.size] || {}, sz = (SIZES[S.moveType] || []).filter(function (x) { return x[0] === S.size; })[0];
      S.furniture = {}; Object.keys(p).forEach(function (k) { if (k !== "_cartons") S.furniture[k] = p[k]; });
      S.cartons = p._cartons || 0; if (sz) S.vehicleId = sz[2];
      renderSizes(); renderVehicles(); renderFurniture();
    } else if (t.dataset.veh) { S.vehicleId = t.dataset.veh; renderVehicles(); }
    else if (t.dataset.f) { var k = t.dataset.f; S.furniture[k] = Math.max(0, Math.min(99, (S.furniture[k] || 0) + Number(t.dataset.d))); renderFurniture(); }
    window.nbSaveDraft(); window.nbCalc();
  });

  /* ---------- public functions used by the form ---------- */
  window.nbSelectMoveType = function (type) {
    S.moveType = type; S.size = ""; S.furniture = {}; S.cartons = 0;
    setServiceMode(type === "services");
    document.querySelectorAll("#nbTypeGrid .nb-type-card").forEach(function (c) { c.classList.toggle("selected", (c.getAttribute("onclick") || "").indexOf("'" + type + "'") >= 0); });
    renderSizes(); renderFurniture(); window.nbSaveDraft(); window.nbCalc();
  };
  window.nbCartonQty = function (d) { S.cartons = Math.max(0, Math.min(500, S.cartons + d * 5)); if ($("nbCartonQty")) $("nbCartonQty").textContent = S.cartons; window.nbSaveDraft(); window.nbCalc(); };
  window.nbSelectPayment = function (mode) {
    document.querySelectorAll(".nb-pay-opt").forEach(function (o) { o.classList.toggle("selected", (o.getAttribute("onclick") || "").indexOf("'pay_later'") >= 0); });
    if (mode !== "pay_later") err("Phone bookings are Pay Later. The customer can pay the advance online from My Bookings, or the crew collects on the day.");
    else err("");
  };
  window.nbApplyCoupon = function () {
    S.coupon = val("nbCoupon").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);
    var m = $("nbCouponMsg"); if (m) m.textContent = S.coupon ? "Checking " + S.coupon + "…" : "";
    window.nbCalc(true);
  };

  function quoteInput() {
    return { pickup: val("nbPickup"), drop: val("nbDrop"), km: 0, vehicleId: S.vehicleId || "tata_ace", furniture: Object.assign({}, S.furniture),
      cartonQty: S.cartons, pickupFloor: parseInt(val("nbPickupFloor") || "0", 10) || 0, dropFloor: parseInt(val("nbDropFloor") || "0", 10) || 0,
      liftAvailable: chk("nbLift"), packingService: chk("nbPacking"), extraHelpers: 0, acCount: 0,
      needCarpenter: chk("nbDismantle") || chk("nbAssembly"), needElectrician: false, isInterstate: false,
      promoCode: S.coupon || null, moveDate: val("nbDate") };
  }
  function details() {
    var t = $("nbTime"), sz = (SIZES[S.moveType] || []).filter(function (x) { return x[0] === S.size; })[0], v = VEHICLES.filter(function (x) { return x[0] === S.vehicleId; })[0];
    var furn = Object.keys(S.furniture).filter(function (k) { return S.furniture[k] > 0; }).map(function (k) { return LABELS[k] + " × " + S.furniture[k]; }).join(", ");
    var pf = $("nbPickupFloor"), df = $("nbDropFloor"), src = val("nbLeadSource");
    return { customerName: val("nbName"), phone: val("nbPhone"), altPhone: val("nbAltPhone"), email: val("nbEmail"),
      pickup: val("nbPickup"), drop: val("nbDrop"), date: val("nbDate"), shiftTime: val("nbTime"), shiftTimeLabel: t && t.selectedIndex > 0 ? t.options[t.selectedIndex].text : "",
      moveType: S.moveType, house: sz ? sz[1] : "", vehicle: v ? v[1] : "", furniture: furn,
      pickupFloor: pf && pf.selectedIndex >= 0 ? pf.options[pf.selectedIndex].text : "", dropFloor: df && df.selectedIndex >= 0 ? df.options[df.selectedIndex].text : "",
      liftAvailable: chk("nbLift"), packingService: chk("nbPacking"), unpackingService: chk("nbUnpacking"), dismantling: chk("nbDismantle"), assembly: chk("nbAssembly"),
      fragileItems: val("nbFragile"), specialItems: val("nbSpecial"), remarks: (src ? "[source: " + src + "] " : "") + val("nbRemarks"), leadSource: src || null, isIntercity: false };
  }

  window.nbCalc = function (now) {
    clearTimeout(calcTimer);
    if (S.moveType === "services") {
      calcTimer = setTimeout(function () {
        var box = $("nbSummaryLines"), tot = $("nbTotalDisplay"), items = svcItems();
        if (!items.length) { if (box) box.innerHTML = '<div class="nb-summary-line"><span>Choose at least one service</span></div>'; if (tot) tot.textContent = "—"; S.quote = null; return; }
        var seq = ++calcSeq; if (tot) tot.textContent = "…";
        callSvc({ op: "quote", items: items }).then(function (q) {
          if (seq !== calcSeq) return; S.quote = q; err("");
          if (box) box.innerHTML = (q.lines || []).map(function (l) { return '<div class="nb-summary-line"><span>' + esc(l.name) + (l.qty > 1 ? " × " + l.qty : "") + "</span><strong>" + (l.lineTotal != null ? "₹" + Math.round(l.lineTotal).toLocaleString("en-IN") : "Quote") + "</strong></div>"; }).join("") +
            (q.needsQuote ? '<div class="nb-summary-line"><span>Includes items priced on visit</span></div>' : "");
          if (tot) tot.textContent = "₹" + Math.round(q.total || 0).toLocaleString("en-IN") + (q.needsQuote ? "+" : "");
        }).catch(function (e) { if (seq !== calcSeq) return; S.quote = null; if (tot) tot.textContent = "—"; err((e && e.message) || "Couldn't price these services."); });
      }, now ? 50 : 400);
      return;
    }
    calcTimer = setTimeout(function () {
      var box = $("nbSummaryLines"), tot = $("nbTotalDisplay");
      if (!val("nbPickup") || !val("nbDrop") || !S.size) { if (box) box.innerHTML = '<div class="nb-summary-line"><span>Enter pickup, drop and size to see the price</span></div>'; if (tot) tot.textContent = "—"; S.quote = null; return; }
      var seq = ++calcSeq; if (tot) tot.textContent = "…";
      call({ op: "quote", quoteInput: quoteInput(), bookingDetails: { pickup: val("nbPickup"), drop: val("nbDrop"), date: val("nbDate") } }).then(function (q) {
        if (seq !== calcSeq) return; S.quote = q; err("");
        var b = q.breakdown || {}, lines = Object.keys(b).filter(function (k) { return typeof b[k] === "number" && b[k] !== 0; }).slice(0, 10);
        if (box) box.innerHTML = '<div class="nb-summary-line"><span>Distance</span><strong>' + esc(q.km) + " km</strong></div>" +
          lines.map(function (k) { return '<div class="nb-summary-line"><span>' + esc(k.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); })) + "</span><strong>₹" + Math.round(b[k]).toLocaleString("en-IN") + "</strong></div>"; }).join("");
        if (tot) tot.textContent = "₹" + Math.round(q.total).toLocaleString("en-IN");
        var m = $("nbCouponMsg"); if (m && S.coupon) m.textContent = q.promo ? "✅ " + S.coupon + ": −₹" + Math.round(q.promo.applied || 0).toLocaleString("en-IN") : "⚠️ " + S.coupon + " doesn't apply to this booking";
      }).catch(function (e) { if (seq !== calcSeq) return; S.quote = null; if (tot) tot.textContent = "—"; err((e && e.message) || "Couldn't price this move."); });
    }, now ? 50 : 700);
  };

  window.nbSaveBooking = function () {
    if (S.busy) return; err("");
    if (S.moveType === "services") return saveServices();
    var d = details();
    if (d.customerName.length < 2) return err("Enter the customer's name.");
    if (!/^[6-9]\d{9}$/.test(d.phone.replace(/\D/g, "").slice(-10))) return err("Enter a valid 10-digit mobile number.");
    if (!d.pickup || !d.drop) return err("Enter pickup and drop addresses.");
    if (!S.size) return err("Choose the house / office size.");
    if (!d.date) return err("Choose the moving date.");
    if (!d.shiftTime) return err("Choose a time slot.");
    if (!S.quote) return err("Wait for the price to load (check the addresses).");
    if (!confirm("Create this booking for " + d.customerName + " — ₹" + Math.round(S.quote.total).toLocaleString("en-IN") + " (Pay Later)?")) return;
    S.busy = true; S.requestId = S.requestId || rid();
    var btn = $("nbSaveBtn"); if (btn) { btn.disabled = true; btn.textContent = "Creating booking…"; }
    call({ op: "create", requestId: S.requestId, quoteInput: quoteInput(), bookingDetails: d }).then(function (r) {
      S.busy = false; S.requestId = null; try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      var msg = "Hi " + d.customerName.split(" ")[0] + ", your PackZen booking is confirmed ✅\nBooking ID: " + r.bookingRef + "\nDate: " + d.date + " (" + (d.shiftTimeLabel || "") + ")\n" +
        d.pickup + " → " + d.drop + "\nTotal: ₹" + Math.round(r.total).toLocaleString("en-IN") + " (pay later)\n" +
        (r.setPasswordLink ? "Set your password to track it in My Bookings: " + r.setPasswordLink + "\n" : r.customerLinked ? "Track it anytime in My Bookings at packzenblr.in\n" : "") + "Questions? Call 99450 95453.";
      var wa = "https://wa.me/91" + d.phone.replace(/\D/g, "").slice(-10) + "?text=" + encodeURIComponent(msg);
      var sec = $("secNewbooking");
      var box = document.createElement("div"); box.className = "nb-card"; box.id = "nbDone";
      box.innerHTML = "<h3>✅ Booking created</h3><p style=\"margin:0 0 10px\"><b>" + esc(r.bookingRef) + "</b> · ₹" + Math.round(r.total).toLocaleString("en-IN") + " · " + esc(r.km) + " km · Pay Later</p>" +
        "<p style=\"margin:0 0 12px;color:var(--muted)\">" + (r.accountCreated ? "A customer account was created — send them the message so they can set a password and see the booking." : r.customerLinked ? "Linked to the customer's existing account (shows in their My Bookings)." : "Saved as a guest booking (no e-mail given). They'll get the completion code by SMS on the day.") +
        " The confirmation e-mail goes out automatically if an e-mail was given.</p>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="nb-btn-save" style="text-decoration:none;text-align:center" target="_blank" rel="noopener" href="' + esc(wa) + '">Send WhatsApp to customer</a>' +
        '<button type="button" class="nb-btn-save" style="background:var(--surface);color:var(--text);border:1px solid var(--border)" onclick="document.getElementById(\'nbDone\').remove();nbInit(true)">New booking</button></div>';
      if (sec) sec.insertBefore(box, sec.firstChild);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (btn) { btn.disabled = false; btn.textContent = "✅ Create Booking"; }
      if (typeof window.showToast === "function") window.showToast("✅ Booking " + r.bookingRef + " created");
    }).catch(function (e) {
      S.busy = false; if (btn) { btn.disabled = false; btn.textContent = "✅ Create Booking"; }
      err((e && e.message) || "Could not create the booking. Please try again.");
    });
  };

  function saveServices() {
    var name = val("nbName"), phone = val("nbPhone").replace(/\D/g, "").slice(-10), t = $("nbTime");
    if (name.length < 2) return err("Enter the customer's name.");
    if (!/^[6-9]\d{9}$/.test(phone)) return err("Enter a valid 10-digit mobile number.");
    if (!val("nbPickup")) return err("Enter the service address.");
    if (!svcItems().length) return err("Choose at least one service.");
    if (!val("nbDate")) return err("Choose the date.");
    if (!val("nbTime")) return err("Choose a time slot.");
    if (!S.quote) return err("Wait for the price to load.");
    if (!confirm("Create this service booking for " + name + " — ₹" + Math.round(S.quote.total || 0).toLocaleString("en-IN") + (S.quote.needsQuote ? "+ (some items priced on visit)" : "") + " (Pay Later)?")) return;
    S.busy = true; S.requestId = S.requestId || rid();
    var btn = $("nbSaveBtn"); if (btn) { btn.disabled = true; btn.textContent = "Creating booking…"; }
    var details = { customerName: name, phone: phone, email: val("nbEmail"), address: val("nbPickup"), date: val("nbDate"),
      timeSlot: t && t.selectedIndex > 0 ? t.options[t.selectedIndex].text : val("nbTime"), notes: val("nbRemarks") };
    callSvc({ op: "create", requestId: S.requestId, items: svcItems(), details: details, leadSource: val("nbLeadSource") }).then(function (r) {
      S.busy = false; S.requestId = null; SVC.qty = {}; renderSvc(); try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      var msg = "Hi " + name.split(" ")[0] + ", your PackZen service booking is " + (r.status === "pending" ? "received" : "confirmed") + " ✅\nBooking ID: " + r.bookingRef +
        "\nDate: " + details.date + " (" + details.timeSlot + ")\nAddress: " + details.address + "\nTotal: ₹" + Math.round(r.total || 0).toLocaleString("en-IN") + (r.needsQuote ? "+ (final price after inspection)" : "") + " — pay later\n" +
        (r.setPasswordLink ? "Set your password to track it in My Bookings: " + r.setPasswordLink + "\n" : r.customerLinked ? "Track it in My Bookings at packzenblr.in\n" : "") + "Questions? Call 99450 95453.";
      showDone(r, "https://wa.me/91" + phone + "?text=" + encodeURIComponent(msg), btn);
    }).catch(function (e) { S.busy = false; if (btn) { btn.disabled = false; btn.textContent = "✅ Create Booking"; } err((e && e.message) || "Could not create the booking."); });
  }
  function showDone(r, wa, btn) {
    var sec = $("secNewbooking"), old = $("nbDone"); if (old) old.remove();
    var box = document.createElement("div"); box.className = "nb-card"; box.id = "nbDone";
    box.innerHTML = "<h3>✅ Booking created</h3><p style=\"margin:0 0 10px\"><b>" + esc(r.bookingRef) + "</b> · ₹" + Math.round(r.total || 0).toLocaleString("en-IN") + " · Pay Later" + (r.status === "pending" ? " · awaiting price confirmation" : "") + "</p>" +
      "<p style=\"margin:0 0 12px;color:var(--muted)\">" + (r.accountCreated ? "A customer account was created — send the message so they can set a password and see the booking." : r.customerLinked ? "Linked to the customer's account (shows in My Bookings)." : "Saved as a guest booking (no e-mail given).") + "</p>" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="nb-btn-save" style="text-decoration:none;text-align:center" target="_blank" rel="noopener" href="' + esc(wa) + '">Send WhatsApp to customer</a>' +
      '<button type="button" class="nb-btn-save" style="background:var(--surface);color:var(--text);border:1px solid var(--border)" onclick="document.getElementById(\'nbDone\').remove();nbInit(true)">New booking</button></div>';
    if (sec) sec.insertBefore(box, sec.firstChild); window.scrollTo({ top: 0, behavior: "smooth" });
    if (btn) { btn.disabled = false; btn.textContent = "✅ Create Booking"; }
  }

  /* ---------- drafts ---------- */
  var FIELDS = ["nbName", "nbPhone", "nbAltPhone", "nbEmail", "nbLeadSource", "nbPickup", "nbDrop", "nbDate", "nbTime", "nbPickupFloor", "nbDropFloor", "nbFragile", "nbSpecial", "nbRemarks", "nbCoupon"];
  var TOGGLES = ["nbLift", "nbPacking", "nbUnpacking", "nbDismantle", "nbAssembly"];
  window.nbSaveDraft = function () {
    try {
      var d = { S: { moveType: S.moveType, size: S.size, vehicleId: S.vehicleId, furniture: S.furniture, cartons: S.cartons, coupon: S.coupon }, f: {}, t: {}, at: Date.now() };
      FIELDS.forEach(function (id) { if ($(id)) d.f[id] = $(id).value; }); TOGGLES.forEach(function (id) { if ($(id)) d.t[id] = $(id).checked; });
      if (d.f.nbName || d.f.nbPhone || d.f.nbPickup) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch (e) {}
  };
  window.nbRestoreDraft = function () {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); if (!d) return;
      Object.assign(S, d.S || {}); Object.keys(d.f || {}).forEach(function (id) { if ($(id)) $(id).value = d.f[id]; }); Object.keys(d.t || {}).forEach(function (id) { if ($(id)) $(id).checked = d.t[id]; });
      document.querySelectorAll("#nbTypeGrid .nb-type-card").forEach(function (c) { c.classList.toggle("selected", (c.getAttribute("onclick") || "").indexOf("'" + S.moveType + "'") >= 0); });
      renderSizes(); renderVehicles(); renderFurniture(); window.nbCalc(true);
    } catch (e) {}
    if ($("nbDraftBanner")) $("nbDraftBanner").style.display = "none";
  };
  window.nbDiscardDraft = function () { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} if ($("nbDraftBanner")) $("nbDraftBanner").style.display = "none"; };

  /* Google address suggestions on pickup / drop (same Maps key and Places library as the
     website's booking form). Picking a suggestion fills the full address and re-prices. */
  var mapsRequested = false;
  function attachAutocomplete() {
    if (typeof google === "undefined" || !google.maps || !google.maps.places) return false;
    ["nbPickup", "nbDrop"].forEach(function (id) {
      var input = $(id); if (!input || input._pzAuto) return;
      var ac = new google.maps.places.Autocomplete(input, { componentRestrictions: { country: "in" }, fields: ["formatted_address", "geometry", "name"] });
      input._pzAuto = ac;
      ac.addListener("place_changed", function () {
        var pl = ac.getPlace();
        if (pl && pl.formatted_address) input.value = (pl.name && pl.formatted_address.indexOf(pl.name) !== 0 ? pl.name + ", " : "") + pl.formatted_address;
        window.nbSaveDraft(); window.nbCalc(true);
      });
    });
    return true;
  }
  function loadMaps() {
    if (attachAutocomplete() || mapsRequested) return;
    var key = window.ENV && window.ENV.GOOGLE_MAPS_KEY; if (!key) return;
    mapsRequested = true;
    window.pzAdvisorMapsReady = function () { attachAutocomplete(); };
    var sc = document.createElement("script");
    sc.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&libraries=places&callback=pzAdvisorMapsReady";
    sc.async = true; sc.defer = true; document.head.appendChild(sc);
  }

  window.nbInit = function (reset) {
    loadMaps();
    if (reset) {
      FIELDS.forEach(function (id) { if ($(id)) $(id).value = ""; }); TOGGLES.forEach(function (id) { if ($(id)) $(id).checked = false; });
      Object.assign(S, { moveType: "home", size: "", vehicleId: "", furniture: {}, cartons: 0, coupon: "", quote: null, requestId: null });
    }
    var dt = $("nbDate"); if (dt) dt.min = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    // the server decides status and payment — hide controls that would suggest otherwise
    ["nbStatus", "nbPaidToggle", "nbInsurance"].forEach(function (id) { var el = $(id); var row = el && (el.closest(".nb-toggle-row") || el.closest(".nb-field")); if (row) row.style.display = "none"; });
    document.querySelectorAll(".nb-pay-opt").forEach(function (o) { var pl = (o.getAttribute("onclick") || "").indexOf("'pay_later'") >= 0; o.style.display = pl ? "" : "none"; o.classList.toggle("selected", pl); });
    var ops = $("nbStatus"); var opsCard = ops && ops.closest(".nb-card"); if (opsCard && !opsCard.querySelector("input:not([type=hidden]),textarea,select:not(#nbStatus)")) opsCard.style.display = "none";
    ["nbPickup", "nbDrop"].forEach(function (id) { var el = $(id); if (el && !el._nb) { el._nb = 1; el.addEventListener("input", function () { window.nbSaveDraft(); window.nbCalc(); }); } });
    ["nbLift", "nbPacking", "nbUnpacking", "nbDismantle", "nbAssembly"].forEach(function (id) { var el = $(id); if (el && !el._nb) { el._nb = 1; el.addEventListener("change", function () { window.nbSaveDraft(); window.nbCalc(); }); } });
    if (!S.moveType) S.moveType = "home";
    setServiceMode(S.moveType === "services");
    document.querySelectorAll("#nbTypeGrid .nb-type-card").forEach(function (c) { c.classList.toggle("selected", (c.getAttribute("onclick") || "").indexOf("'" + S.moveType + "'") >= 0); });
    renderSizes(); renderVehicles(); renderFurniture();
    var btn = $("nbSaveBtn"); if (btn) btn.textContent = "✅ Create Booking";
    try { var d = localStorage.getItem(DRAFT_KEY); if ($("nbDraftBanner")) $("nbDraftBanner").style.display = d && !reset ? "flex" : "none"; } catch (e) {}
    window.nbCalc(true);
  };
})();
