/**
 * PackZen — service marketplace discovery (homepage + services page)
 * ------------------------------------------------------------------
 * One static taxonomy for every PackZen category (Bangalore only). It drives
 * NAVIGATION only: moving entries open the existing secure move-quote flow;
 * other services open services.html, where live prices come from the
 * Firestore catalog (server-priced at booking). No prices or amounts are
 * defined or trusted here.
 *
 *   PackZenMarketplace.CATEGORIES          taxonomy
 *   PackZenMarketplace.render(el, opts)    category cards + chips + search
 *   PackZenMarketplace.filter(text)        → matching {category, service} list
 */
(function (root) {
  "use strict";

  var CITY = "Bangalore";
  var CATEGORIES = [
    { id: "moving", icon: "🚚", name: "Packers & Movers", sub: "Home, office and single-item moves across Bangalore", services: [
      { name: "House shifting", move: "home", href: "house-shifting-bangalore.html", keywords: "home flat apartment villa relocation" },
      { name: "Office relocation", move: "office", href: "office-relocation-bangalore.html", keywords: "corporate business" },
      { name: "Single item", move: "single", href: "index.html#quote", keywords: "sofa fridge bed furniture" },
      { name: "Bike transport", href: "bike-transport-bangalore.html", keywords: "scooter two wheeler" },
      { name: "Car transport", href: "car-transport-bangalore.html", keywords: "vehicle" },
      { name: "Packing & unpacking", href: "packing-unpacking-services-bangalore.html", keywords: "boxes cartons" } ] },
    { id: "ac", icon: "❄️", name: "AC Services", sub: "Install, service and repair by verified technicians", services: [
      { name: "AC installation" }, { name: "AC uninstallation" }, { name: "AC servicing", keywords: "cleaning wet service" },
      { name: "AC repair" }, { name: "AC gas refill", keywords: "gas charging cooling" }, { name: "AC inspection" } ] },
    { id: "appliances", icon: "🔌", name: "Appliance Services", sub: "Repairs and installation for everyday appliances", services: [
      { name: "Refrigerator", keywords: "fridge" }, { name: "Washing machine", keywords: "washer" }, { name: "TV", keywords: "television mount" },
      { name: "Geyser", keywords: "water heater" }, { name: "RO / water purifier", keywords: "ro purifier water filter" } ] },
    { id: "home", icon: "🏠", name: "Home Services", sub: "Trusted professionals for everyday home jobs", services: [
      { name: "Plumbing", keywords: "plumber tap leak" }, { name: "Electrical", keywords: "electrician wiring switch" },
      { name: "Carpentry", keywords: "carpenter furniture repair" }, { name: "Painting", keywords: "painter wall" },
      { name: "Cleaning", keywords: "deep cleaning home" }, { name: "Pest control", keywords: "termite cockroach" },
      { name: "Bathroom cleaning" }, { name: "Kitchen cleaning" } ] },
    { id: "delivery", icon: "📦", name: "Delivery & Transport", sub: "Same-city parcels and vehicle transport", services: [
      { name: "Two-wheeler parcel", href: "parcel.html", keywords: "courier package documents" },
      { name: "Single-item delivery", move: "single", href: "index.html#quote", keywords: "furniture appliance" },
      { name: "Bike transport", href: "bike-transport-bangalore.html" },
      { name: "Car transport", href: "car-transport-bangalore.html" } ] }
  ];

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(t) { return String(t == null ? "" : t).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }

  /** Where a service chip leads. Non-moving services go to the live catalog search. */
  function hrefFor(s) { return s.href || ("services.html?q=" + encodeURIComponent(s.name)); }

  function filter(text) {
    var q = norm(text);
    var out = [];
    CATEGORIES.forEach(function (c) {
      c.services.forEach(function (s) {
        var hay = norm(c.name + " " + s.name + " " + (s.keywords || ""));
        if (!q || q.split(" ").every(function (w) { return hay.indexOf(w) !== -1; })) out.push({ category: c, service: s });
      });
    });
    return out;
  }

  function render(el, opts) {
    if (!el) return;
    opts = opts || {};
    var html = "";
    if (opts.search !== false) {
      html += '<form class="pz-search" role="search" action="services.html" method="get">' +
        '<label class="pz-visually-hidden" for="pzSearchInput">Search PackZen services in ' + CITY + "</label>" +
        '<span class="pz-search-icon" aria-hidden="true">🔍</span>' +
        '<input id="pzSearchInput" name="q" type="search" autocomplete="off" placeholder="Search services — e.g. AC repair, house shifting">' +
        "</form>" +
        '<p class="pz-visually-hidden" id="pzSearchStatus" aria-live="polite"></p>';
    }
    html += '<div class="pz-grid">';
    CATEGORIES.forEach(function (c) {
      html += '<article class="pz-card pz-cat" data-cat="' + esc(c.id) + '">' +
        '<div class="pz-cat-head"><span class="pz-cat-icon" aria-hidden="true">' + c.icon + "</span>" +
        "<div><h3 class=\"pz-cat-title\">" + esc(c.name) + '</h3><p class="pz-cat-sub">' + esc(c.sub) + "</p></div></div>" +
        '<div class="pz-chips">' + c.services.map(function (s) {
          return '<a class="pz-chip" href="' + esc(hrefFor(s)) + '"' + (s.move ? ' data-move="' + esc(s.move) + '"' : "") +
            ' data-name="' + esc(norm(c.name + " " + s.name + " " + (s.keywords || ""))) + '">' + esc(s.name) + "</a>";
        }).join("") + "</div></article>";
    });
    html += "</div>";
    html += '<div class="pz-state" id="pzNoMatch" hidden><h3>No matching service yet</h3>' +
      '<p>We may still be able to help in ' + CITY + '. Tell us what you need.</p>' +
      '<a class="pz-btn pz-btn--secondary" href="https://wa.me/919945095453" target="_blank" rel="noopener noreferrer">Ask on WhatsApp</a></div>';
    el.innerHTML = html;

    // Moving chips open the existing secure quote sheet when available.
    el.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a.pz-chip[data-move]");
      if (!a) return;
      if (typeof root.selectMoveTypeFromHome === "function") { e.preventDefault(); root.selectMoveTypeFromHome(a.getAttribute("data-move")); }
    });

    var input = el.querySelector("#pzSearchInput");
    if (input) {
      input.addEventListener("input", function () {
        var q = norm(input.value), shown = 0;
        el.querySelectorAll(".pz-cat").forEach(function (card) {
          var any = false;
          card.querySelectorAll(".pz-chip").forEach(function (chip) {
            var ok = !q || q.split(" ").every(function (w) { return chip.getAttribute("data-name").indexOf(w) !== -1; });
            chip.hidden = !ok; if (ok) { any = true; shown++; }
          });
          card.hidden = !any;
        });
        var none = el.querySelector("#pzNoMatch"); if (none) none.hidden = shown > 0;
        var st = el.querySelector("#pzSearchStatus"); if (st) st.textContent = q ? shown + " matching services" : "";
      });
    }
  }

  /**
   * services.html?q=… — show live catalog matches for the searched service, or
   * a clear "not bookable online yet" state. Catalog prices are display hints;
   * the final amount is always computed by the server at booking.
   */
  function showQuery(resultEl, q) {
    if (!resultEl || !q) return;
    var safeQ = esc(q);
    resultEl.innerHTML = '<div class="pz-state" role="status"><p>Looking up “' + safeQ + '” in Bangalore…</p></div>';
    var cat = root && root.PackZenCatalog;
    var done = function (items) {
      if (items.length) {
        resultEl.innerHTML = '<div class="pz-card"><h2 class="pz-h2">Results for “' + safeQ + '”</h2><div class="pz-chips">' +
          items.map(function (i) {
            return '<a class="pz-chip" href="#catRoot">' + esc(i.name) + " · " + esc(cat.formatPrice(i)) + "</a>";
          }).join("") + "</div></div>";
        return;
      }
      var wa = "https://wa.me/919945095453?text=" + encodeURIComponent("Hi PackZen, I need " + q + " in Bangalore.");
      resultEl.innerHTML = '<div class="pz-state pz-card" role="status"><h3>' + safeQ + " isn’t bookable online yet</h3>" +
        "<p>We’re adding more services in Bangalore. Message us and we’ll arrange it for you.</p>" +
        '<a class="pz-btn pz-btn--primary" href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">Request on WhatsApp</a></div>';
    };
    if (!cat || typeof cat.load !== "function") return done([]);
    var nq = norm(q);
    cat.load().then(function (c) {
      var all = [].concat(c.services || [], c.packages || []);
      done(all.filter(function (i) {
        var hay = norm((i.name || "") + " " + (i.description || ""));
        return nq.split(" ").every(function (w) { return hay.indexOf(w) !== -1; });
      }).slice(0, 12));
    }).catch(function () { done([]); });
  }

  function autoInit() {
    if (typeof document === "undefined") return;
    var q = "";
    try { q = (new URLSearchParams(root.location.search).get("q") || "").slice(0, 80); } catch (e) {}
    document.querySelectorAll("[data-pz-marketplace]").forEach(function (el) {
      render(el);
      var input = el.querySelector("#pzSearchInput");
      if (input && q) { input.value = q; input.dispatchEvent(new Event("input")); }
    });
    showQuery(document.getElementById("pzQueryResult"), q);
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoInit);
    else autoInit();
  }

  var api = { CATEGORIES: CATEGORIES, CITY: CITY, render: render, filter: filter, hrefFor: hrefFor, showQuery: showQuery };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PackZenMarketplace = api;
})(typeof window !== "undefined" ? window : null);
