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
  window.pzAttribution = function () { var a = readAttr(); return a.last || a.first || {}; };
  captureAttr();

  /* ---------- callback widget ---------- */
  var SERVICES = [["move", "House / office shifting"], ["parcel", "Parcel delivery"], ["vehicle", "Bike / car transport"], ["ac", "AC service & repair"],
    ["cleaning", "Deep cleaning"], ["electrician", "Electrician"], ["plumber", "Plumber"], ["carpenter", "Carpenter"], ["tv", "TV wall mounting"], ["other", "Something else"]];
  function guessService() {
    var path = location.pathname;
    if (/parcel/.test(path)) return "parcel";
    if (/ac-/.test(path)) return "ac";
    if (/clean/.test(path)) return "cleaning";
    if (/electrician|plumber|carpenter/.test(path)) return "electrician";
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
        notes: form.notes.value, website: form.website.value, page: location.pathname, lang: (document.documentElement.lang || "en").slice(0, 2),
        attribution: window.pzAttribution() };
      fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: payload }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (j && j.error) throw new Error(j.error.message || "Could not send.");
          form.innerHTML = '<button type="button" class="pz-cb-x" aria-label="Close">×</button><div class="pz-cb-done"><h2>Thanks! ✓</h2>' +
            "<p>We'll call you on " + phone.replace(/^(\d{2})\d{5}/, "$1XXXXX") + " shortly (8 AM – 9 PM). Need us right now? Call <a href=\"tel:9945095453\">99450 95453</a>.</p></div>";
          form.querySelector(".pz-cb-x").addEventListener("click", close);
          try { if (window.gtag) window.gtag("event", "generate_lead", { method: "callback_form" }); } catch (x) {}
        })
        .catch(function (x) { submit.disabled = false; submit.textContent = "Call me back"; err.textContent = (x && x.message) || "Could not send. Please call 9945095453."; });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();

/* PackZen — one "Book" button for every service (unified booking, phase 2).
 * Opens a picker; each choice goes to that service's own short flow:
 *   moves → the moving booking sheet, parcels → parcel.html, home services → services.html?category=…
 * On any page: window.pzOpenBook(). On the homepage, ?book=move opens the moving form directly. */
(function () {
  "use strict";
  var CHOICES = [
    { id: "move", icon: "M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", title: "Home shifting", sub: "1 RK to villa · from ₹2,150" },
    { id: "office", icon: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3", title: "Office move", sub: "Desks, IT, files" },
    { id: "vehicle", icon: "M5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0M9 17h6M3 12l2-5h9l3 5h3a1 1 0 0 1 1 1v4h-2M3 12v5h2", title: "Bike / car transport", sub: "Safe vehicle moves" },
    { id: "parcel", icon: "M12 3 3 7.5v9L12 21l9-4.5v-9zM3 7.5 12 12l9-4.5M12 12v9", title: "Parcel delivery", sub: "Two-wheeler · from ₹49" },
    { id: "ac", icon: "M3 6h18v7H3zM6 17l-1 3M12 16v4M18 17l1 3M7 10h10", title: "AC service & repair", sub: "Service from ₹429" },
    { id: "cleaning", icon: "M7 21l1-9h8l1 9zM9 12V6a3 3 0 0 1 6 0v6M5 21h14", title: "Deep cleaning", sub: "Home, kitchen, bathroom" },
    { id: "home", icon: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z", title: "Electrician · plumber · carpenter", sub: "Fixed visit prices" },
    { id: "tv", icon: "M3 5h18v11H3zM8 21h8M12 16v5", title: "TV wall mounting", sub: "All screen sizes" },
  ];
  function go(id) {
    var onHome = typeof window.openBookingSheet === "function";
    if (id === "move" || id === "office" || id === "vehicle") {
      if (onHome) { close(); window.openBookingSheet(); return; }
      location.href = "/index.html?book=move"; return;
    }
    if (id === "parcel") { location.href = "/parcel.html"; return; }
    location.href = "/services.html?category=" + encodeURIComponent(id === "tv" ? "home" : id);
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
      }).join("") + '</div><p class="pz-cb-legal">Not sure? <a href="#" data-callback>Request a callback</a> or call <a href="tel:9945095453">99450 95453</a>.</p></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener("click", function (e) {
      var opt = e.target.closest && e.target.closest(".pz-book-opt");
      if (opt) { go(opt.getAttribute("data-id")); return; }
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
