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
