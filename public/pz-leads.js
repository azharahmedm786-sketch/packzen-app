/* PackZen — Google Analytics 4 on every customer page + one tracking helper.
 * Uses the same GA4 property as the homepage. Events: generate_lead (callback form,
 * chat), select_item (Book picker), begin_checkout (price shown), purchase (paid
 * booking: move, home service), contact (WhatsApp / call taps).
 * Mark generate_lead and purchase as key events in GA4 to use them in Google Ads. */
(function () {
  "use strict";
  var GA_ID = "G-9JXKP58GP3";
  if (!window.gtag) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
    var g = document.createElement("script"); g.async = true; g.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(g);
  }
  window.pzTrack = function (name, params) { try { window.gtag("event", name, params || {}); } catch (e) {} };
  // taps on call / WhatsApp links anywhere
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href^='tel:'], a[href*='wa.me/']");
    if (a) window.pzTrack("contact", { method: /wa\.me/.test(a.href) ? "whatsapp" : "phone", page: location.pathname });
  }, true);
})();

/* PackZen — lead capture on every customer page.
 * 1) Remembers where a visitor came from (UTM tags, Google Ads click id, referrer,
 *    landing page): first touch + last touch, kept in localStorage.
 * 2) "Request a callback" button + short form → submitLead Cloud Function.
 * Works on pages without the Firebase SDK (calls the callable endpoint directly). */
(function () {
  "use strict";
  var FN = "https://asia-south1-packzen-e7539.cloudfunctions.net/submitLead";
  var KEY = "pz_attr_v1";

  /* ---------- attribution ---------- */
  function readAttr() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function captureAttr() {
    var p = new URLSearchParams(location.search), touch = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"].forEach(function (k) { var v = p.get(k); if (v) touch[k] = v.slice(0, 120); });
    var ref = document.referrer && document.referrer.indexOf(location.host) === -1 ? document.referrer.slice(0, 300) : "";
    if (ref) touch.referrer = ref;
    var stored = readAttr();
    var fresh = Object.keys(touch).length > 0;
    if (!stored.first) stored.first = Object.assign({ landing: location.pathname, firstSeen: new Date().toISOString() }, touch);
    if (fresh) stored.last = Object.assign({ landing: location.pathname, firstSeen: new Date().toISOString() }, touch);
    try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch (e) {}
  }
  // last paid/campaign touch wins; otherwise first touch
  // Referral links (packzenblr.in/?ref=CODE): remember the code and pre-fill it at checkout.
  try {
    var ref = new URLSearchParams(location.search).get("ref");
    if (ref && /^[A-Za-z0-9-]{4,20}$/.test(ref)) localStorage.setItem("pz_ref", ref.toUpperCase());
  } catch (e) {}
  document.addEventListener("DOMContentLoaded", function () {
    try { var r = localStorage.getItem("pz_ref"), pi = document.getElementById("promoInput"); if (r && pi && !pi.value) pi.value = r; } catch (e) {}
  });
  window.pzAttribution = function () { var a = readAttr(); return a.last || a.first || {}; };
  captureAttr();

  /* ---------- callback widget ---------- */
  var SERVICES = [["move", "House / office shifting"], ["vehicle", "Bike / car transport"], ["ac", "AC service & repair"], ["appliance", "Washing machine / fridge repair"],
    ["other", "Something else"]];
  function guessService() {
    var path = location.pathname;
    if (/ac-/.test(path)) return "ac";
    if (/washing|refrigerator|fridge|appliance/.test(path)) return "appliance";
    if (/tv-/.test(path)) return "tv";
    if (/bike|car-transport/.test(path)) return "vehicle";
    return "move";
  }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function today() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }

  function build() {
    if (document.getElementById("pzCbFab") || /admin|advisor|driver|partner/.test(location.pathname)) return;
    var fab = el('<button type="button" id="pzCbFab" class="pz-cb-fab" aria-haspopup="dialog">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>' +
      '<span>Request a callback</span></button>');
    var opts = SERVICES.map(function (s) { return '<option value="' + s[0] + '">' + s[1] + "</option>"; }).join("");
    var dlg = el('<div id="pzCbDialog" class="pz-cb-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="pzCbTitle">' +
      '<form class="pz-cb-card" novalidate>' +
      '<button type="button" class="pz-cb-x" aria-label="Close">×</button>' +
      '<h2 id="pzCbTitle">Get a call back</h2><p class="pz-cb-sub">Tell us what you need. We call back within 15 minutes, 8 AM – 9 PM.</p>' +
      '<label>Your name<input name="name" maxlength="80" autocomplete="name" required></label>' +
      '<label>Mobile number<input name="phone" type="tel" inputmode="numeric" maxlength="14" autocomplete="tel" placeholder="10-digit number" required></label>' +
      '<label>What do you need?<select name="service">' + opts + "</select></label>" +
      '<div class="pz-cb-row"><label>When do you need it?<select name="when"><option value="this_week">This week</option><option value="two_weeks">In the next 2 weeks</option><option value="this_month">This month</option><option value="later">Later</option><option value="just_checking">Just checking prices</option></select></label>' +
      '<label class="pz-cb-home">Home size<select name="homeSize"><option value="">—</option><option value="1rk">1 RK</option><option value="1bhk">1 BHK</option><option value="2bhk">2 BHK</option><option value="3bhk">3 BHK</option><option value="4bhk">4 BHK</option><option value="villa">Villa</option><option value="office">Office</option></select></label></div>' +
      '<div class="pz-cb-row"><label>Area / pincode<input name="area" maxlength="200" placeholder="e.g. HSR Layout 560102"></label>' +
      '<label>Preferred date<input name="date" type="date"></label></div>' +
      '<label>Anything else? <small>(optional)</small><input name="notes" maxlength="300" placeholder="2BHK, 3rd floor, no lift…"></label>' +
      '<input name="website" tabindex="-1" autocomplete="off" class="pz-cb-hp" aria-hidden="true">' +
      '<p class="pz-cb-err" role="alert"></p>' +
      '<button type="submit" class="pz-cb-submit">Call me back</button>' +
      '<p class="pz-cb-legal">By submitting you agree to be contacted by PackZen about this request. See our <a href="/legal/privacy.html">privacy policy</a>.</p>' +
      "</form></div>");
    document.body.appendChild(fab); document.body.appendChild(dlg);
    // sit above any bottom bar (home bottom nav, sticky Call/Quote bar on service pages)
    var bar = document.querySelector(".bottom-nav, .svc-sticky-cta");
    if (bar) {
      var place = function () {
        var cs = getComputedStyle(bar), r = bar.getBoundingClientRect();
        var visible = cs.display !== "none" && cs.visibility !== "hidden" && r.height > 0 && r.top < innerHeight;
        fab.style.bottom = visible ? (innerHeight - r.top + 12) + "px" : "";
      };
      place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, { passive: true });
    }
    var form = dlg.querySelector("form"), err = dlg.querySelector(".pz-cb-err"), submit = dlg.querySelector(".pz-cb-submit");
    form.date.min = today(); form.service.value = guessService();
    var syncHome = function () { var h = dlg.querySelector(".pz-cb-home"); if (h) h.style.display = /^(move|vehicle)$/.test(form.service.value) ? "" : "none"; };
    form.service.addEventListener("change", syncHome); syncHome();
    var lastFocus = null;
    function open() { lastFocus = document.activeElement; dlg.hidden = false; setTimeout(function () { form.name.focus(); }, 30); }
    function close() { dlg.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    window.pzOpenCallback = function (service) { if (service) form.service.value = service; open(); };
    fab.addEventListener("click", open);
    dlg.querySelector(".pz-cb-x").addEventListener("click", close);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !dlg.hidden) close(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault(); err.textContent = "";
      var phone = form.phone.value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
      if (form.name.value.trim().length < 2) { err.textContent = "Please enter your name."; return; }
      if (!/^[6-9]\d{9}$/.test(phone)) { err.textContent = "Please enter a valid 10-digit mobile number."; return; }
      submit.disabled = true; submit.textContent = "Sending…";
      var payload = { name: form.name.value, phone: phone, service: form.service.value, area: form.area.value, date: form.date.value,
        notes: form.notes.value, website: form.website.value, when: form.when.value, homeSize: form.homeSize.value, page: location.pathname, lang: (document.documentElement.lang || "en").slice(0, 2),
        attribution: window.pzAttribution() };
      fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: payload }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (j && j.error) throw new Error(j.error.message || "Could not send.");
          form.innerHTML = '<button type="button" class="pz-cb-x" aria-label="Close">×</button><div class="pz-cb-done"><h2>Thanks! ✓</h2>' +
            "<p>We'll call you on " + phone.replace(/^(\d{2})\d{5}/, "$1XXXXX") + " shortly (8 AM – 9 PM). Need us right now? Call <a href=\"tel:9945095453\">99450 95453</a>.</p></div>";
          form.querySelector(".pz-cb-x").addEventListener("click", close);
          if (window.pzTrack) window.pzTrack("generate_lead", { method: "callback_form", service: payload.service });
        })
        .catch(function (x) { submit.disabled = false; submit.textContent = "Call me back"; err.textContent = (x && x.message) || "Could not send. Please call 9945095453."; });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();

/* PackZen — one "Book" button for every service (unified booking, phase 2).
 * Opens a picker; each choice goes to that service's own short flow:
 *   moves → the moving booking sheet, home services → services.html?category=…
 * On any page: window.pzOpenBook(). On the homepage, ?book=move opens the moving form directly. */
(function () {
  "use strict";
  var CHOICES = [
    { id: "move", icon: "M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", title: "Home shifting", sub: "1 RK to villa · from ₹2,150" },
    { id: "office", icon: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3", title: "Office move", sub: "Desks, IT, files" },
    { id: "vehicle", icon: "M5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0M9 17h6M3 12l2-5h9l3 5h3a1 1 0 0 1 1 1v4h-2M3 12v5h2", title: "Bike / car transport", sub: "Safe vehicle moves" },
    { id: "ac", icon: "M3 6h18v7H3zM6 17l-1 3M12 16v4M18 17l1 3M7 10h10", title: "AC service & repair", sub: "Service from ₹429" },
    { id: "appliance", icon: "M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM4 7h16M12 15a3 3 0 1 0 0-.01", title: "Washing machine & fridge", sub: "Repair visit ₹249 · gas refill" },
  ];
  function go(id) {
    var onHome = typeof window.openBookingSheet === "function";
    if (id === "move" || id === "office" || id === "vehicle") {
      if (onHome) { close(); window.openBookingSheet(); return; }
      location.href = "/index.html?book=move"; return;
    }
    location.href = "/services.html?category=" + encodeURIComponent(id === "appliance" ? "appliance-repair" : id);
  }
  var dlg = null;
  function close() { if (dlg) dlg.hidden = true; }
  function build() {
    if (document.getElementById("pzBookDialog") || /admin|advisor|driver|partner/.test(location.pathname)) return;
    dlg = document.createElement("div");
    dlg.id = "pzBookDialog"; dlg.className = "pz-cb-overlay"; dlg.hidden = true;
    dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-labelledby", "pzBookTitle");
    dlg.innerHTML = '<div class="pz-cb-card pz-book-card"><button type="button" class="pz-cb-x" aria-label="Close">×</button>' +
      '<h2 id="pzBookTitle">What would you like to book?</h2><p class="pz-cb-sub">Bangalore · instant prices · pay securely online</p>' +
      '<div class="pz-book-grid">' + CHOICES.map(function (c) {
        return '<button type="button" class="pz-book-opt" data-id="' + c.id + '"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + c.icon + '"/></svg>' +
          '<span><b>' + c.title + '</b><small>' + c.sub + '</small></span></button>';
      }).join("") + '</div><a class="pz-wa-book" target="_blank" rel="noopener" href="https://wa.me/919945095453?text=' + encodeURIComponent("Hi PackZen, I'd like to book: \nService: \nArea / pincode: \nDate: \nHome size or items: ") + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg> Book on WhatsApp instead</a><p class="pz-cb-legal"><a href="/estimate.html">Get a fixed price from photos</a> · <a href="/business.html">For business</a> · <a href="/digital/">PackZen Digital (websites)</a><br>Not sure? <a href="#" data-callback>Request a callback</a> or call <a href="tel:9945095453">99450 95453</a>.</p></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener("click", function (e) {
      var opt = e.target.closest && e.target.closest(".pz-book-opt");
      if (opt) { if (window.pzTrack) window.pzTrack("select_item", { item_list_name: "book_picker", items: [{ item_id: opt.getAttribute("data-id") }] }); go(opt.getAttribute("data-id")); return; }
      if (e.target.closest && e.target.closest("[data-callback]")) { e.preventDefault(); close(); if (window.pzOpenCallback) window.pzOpenCallback(); return; }
      if (e.target === dlg || (e.target.closest && e.target.closest(".pz-cb-x"))) close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && dlg && !dlg.hidden) close(); });
    window.pzOpenBook = function () { dlg.hidden = false; var f = dlg.querySelector(".pz-book-opt"); if (f) setTimeout(function () { f.focus(); }, 30); };

    // Header "Book" button on every customer page
    var right = document.querySelector(".app-bar-right");
    if (right && !document.getElementById("pzHeaderBook")) {
      var b = document.createElement("button");
      b.type = "button"; b.id = "pzHeaderBook"; b.className = "pz-header-book"; b.textContent = "Book";
      b.addEventListener("click", window.pzOpenBook);
      right.insertBefore(b, right.firstChild);
    }
    // Homepage bottom-nav "Book" opens the picker instead of only the moving form
    var bnav = document.getElementById("bnavBook");
    if (bnav) { bnav.removeAttribute("onclick"); bnav.setAttribute("aria-label", "Book a service"); bnav.addEventListener("click", function (e) { e.preventDefault(); window.pzOpenBook(); }); }
    // /index.html?book=move → open the moving form straight away
    if (/[?&]book=move\b/.test(location.search)) {
      var tries = 0, t = setInterval(function () {
        if (typeof window.openBookingSheet === "function") { clearInterval(t); try { window.openBookingSheet(); } catch (x) {} }
        else if (++tries > 40) clearInterval(t);
      }, 150);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
