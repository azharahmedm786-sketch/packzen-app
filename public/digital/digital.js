/* PackZen Digital — analytics, attribution and the enquiry form (→ existing lead engine). */
(function () {
  "use strict";
  // Google Analytics (same property as the main site)
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date()); window.gtag("config", "G-9JXKP58GP3");
  var g = document.createElement("script"); g.async = true; g.src = "https://www.googletagmanager.com/gtag/js?id=G-9JXKP58GP3"; document.head.appendChild(g);
  function track(n, p) { try { window.gtag("event", n, p || {}); } catch (e) {} }

  // Attribution (first touch, same keys as the main site)
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];
  var attr = {};
  try {
    attr = JSON.parse(localStorage.getItem("pz_attr") || "{}") || {};
    var q = new URLSearchParams(location.search), fresh = {};
    KEYS.forEach(function (k) { var v = q.get(k); if (v) fresh[k] = v.slice(0, 120); });
    if (Object.keys(fresh).length && !attr.utm_source && !attr.gclid) { attr = Object.assign(fresh, { landing: location.pathname, referrer: document.referrer.slice(0, 200) }); localStorage.setItem("pz_attr", JSON.stringify(attr)); }
    else if (!attr.landing) { attr.landing = location.pathname; attr.referrer = document.referrer.slice(0, 200); }
  } catch (e) {}

  // Package buttons pre-select the package in the form
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pkg]"); if (!b) return;
    var sel = document.querySelector("#dzForm [name=package]"); if (sel) sel.value = b.getAttribute("data-pkg");
    var svc = document.querySelector("#dzForm [name=service]"); if (svc && b.getAttribute("data-svc")) svc.value = b.getAttribute("data-svc");
    track("select_item", { item_list_name: "digital_packages", items: [{ item_id: b.getAttribute("data-pkg") }] });
  });
  document.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest("a[href*='wa.me/'],a[href^='tel:']"); if (a) track("contact", { method: /wa\.me/.test(a.href) ? "whatsapp" : "phone", division: "digital" }); }, true);

  var f = document.getElementById("dzForm"); if (!f) return;
  var err = f.querySelector(".dz-err"), sending = false;
  f.addEventListener("submit", function (e) {
    e.preventDefault(); if (sending) return; err.textContent = "";
    var v = function (n) { return ((f.elements[n] && f.elements[n].value) || "").trim(); };
    var phone = v("phone").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (v("name").length < 2) return (err.textContent = "Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone)) return (err.textContent = "Please enter a valid 10-digit mobile number.");
    if (v("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v("email"))) return (err.textContent = "Please check your email address.");
    if (!f.elements.consent.checked) return (err.textContent = "Please agree to be contacted about your enquiry.");
    var notes = [v("package") && "package: " + v("package"), v("btype") && "type: " + v("btype"), v("details")].filter(Boolean).join(" | ");
    var btn = f.querySelector("button[type=submit]"); sending = true; btn.disabled = true; btn.textContent = "Sending…";
    fetch("https://asia-south1-packzen-e7539.cloudfunctions.net/submitLead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: v("name"), phone: phone, email: v("email"), business: v("business"), service: v("service") || "website",
        budget: v("budget"), contactPref: v("contactPref"), area: v("area"), notes: notes.slice(0, 480), website: v("website"),
        page: location.pathname, attribution: attr } })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.error) throw new Error(j.error.message || "Could not send.");
      track("generate_lead", { method: "digital_form", service: v("service") || "website", division: "digital" });
      f.hidden = true; var d = document.getElementById("dzDone"); d.hidden = false; d.focus();
    }).catch(function (x) {
      sending = false; btn.disabled = false; btn.textContent = "Get my website quote";
      err.textContent = (x && x.message) || "Could not send — please WhatsApp or call 9945095453.";
    });
  });
})();
