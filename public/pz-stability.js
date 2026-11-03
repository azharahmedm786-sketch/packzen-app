/* PackZen customer-site stability (loaded on customer pages).
 * 1. Error reporting: uncaught errors / promise rejections are sent (max 5 per page
 *    view, de-duplicated) to logClientError, so admin hears about problems early.
 * 2. Graceful fallbacks: window.pzFallback(kind, detail) shows a small help card with
 *    WhatsApp, Request a call-back and Call — used when Google Maps, the booking, or the
 *    payment fails, so a customer never hits a dead end.
 * 3. Maps watchdog: if Google Maps can't load (key / quota / network), customers are
 *    told and offered the same help instead of seeing a wrong default price. */
(function () {
  "use strict";
  var ENDPOINT = "https://asia-south1-packzen-e7539.cloudfunctions.net/logClientError";
  var sent = 0, seen = {};
  function report(kind, msg, src) {
    try {
      msg = String(msg || "").slice(0, 300); src = String(src || "").slice(0, 200);
      if (!msg || sent >= 5 || seen[msg + src]) return;
      if (/^Script error\.?$/i.test(msg) || /extension:/i.test(src)) return;
      seen[msg + src] = 1; sent++;
      var body = JSON.stringify({ kind: kind, msg: msg, src: src, page: location.pathname, ua: navigator.userAgent.slice(0, 160) });
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
      else fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(function () {});
    } catch (e) {}
  }
  window.addEventListener("error", function (e) {
    if (!e || !e.message) return;   // resource load errors have no message
    report("error", e.message, (e.filename || "").replace(location.origin, "") + ":" + (e.lineno || 0));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason; report("rejection", r && (r.message || r.code) ? (r.code ? r.code + ": " : "") + (r.message || "") : String(r), "");
  });
  window.pzReportError = report;

  /* ---------- offline page (needed for the Play Store app) ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {}); });
  }

  /* ---------- help card ---------- */
  var COPY = {
    maps: ["Address search isn't working right now", "You can still book: send us your pickup and drop on WhatsApp, or ask for a call-back and we'll give you the exact price."],
    booking: ["We couldn't complete the booking", "Nothing was charged. Message us on WhatsApp or request a call-back and we'll book it for you right away."],
    payment: ["The payment didn't go through", "No money was taken for this attempt. Try again, or message us and we'll help you finish the booking."],
    quote: ["We couldn't calculate your price", "Send us your pickup, drop and home size on WhatsApp, or request a call-back for the exact price."],
    generic: ["Something didn't work", "We're here to help — message us on WhatsApp or request a call-back."]
  };
  var shown = {};
  window.pzFallback = function (kind, detail) {
    kind = COPY[kind] ? kind : "generic";
    report("fallback", "fallback:" + kind + (detail ? " — " + String(detail).slice(0, 120) : ""), "");
    if (shown[kind]) return; shown[kind] = 1;
    var old = document.getElementById("pzHelpCard"); if (old) old.remove();
    var c = COPY[kind], wa = "https://wa.me/919945095453?text=" + encodeURIComponent("Hi PackZen, I need help booking (" + kind + " issue on the website).");
    var card = document.createElement("div"); card.id = "pzHelpCard"; card.setAttribute("role", "alert");
    card.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:100000;max-width:440px;margin:0 auto;background:#fff;color:#0C1A14;border:1px solid rgba(10,40,28,.15);border-radius:18px;box-shadow:0 18px 40px -16px rgba(0,0,0,.45);padding:14px 16px;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
    card.innerHTML = '<button type="button" aria-label="Close" style="position:absolute;top:6px;right:8px;border:0;background:none;font-size:20px;cursor:pointer;color:#6B7D74">×</button>' +
      '<div style="font-weight:800;margin-right:22px">' + c[0] + '</div><div style="color:#3E5248;margin:4px 0 10px;font-size:.92rem">' + c[1] + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<a href="' + wa + '" target="_blank" rel="noopener" style="flex:1;min-width:120px;text-align:center;text-decoration:none;background:#25D366;color:#fff;font-weight:700;border-radius:999px;padding:10px 12px">WhatsApp us</a>' +
      '<button type="button" data-cb style="flex:1;min-width:120px;border:1px solid rgba(10,40,28,.2);background:#fff;color:#0C1A14;font-weight:700;border-radius:999px;padding:10px 12px;cursor:pointer">Request a call-back</button>' +
      '<a href="tel:+919945095453" style="flex:1 1 100%;text-align:center;color:#147A45;font-weight:700;text-decoration:none;padding:4px">or call 99450 95453 (8 AM – 9 PM)</a></div>';
    card.querySelector("button[aria-label=Close]").onclick = function () { card.remove(); };
    card.querySelector("[data-cb]").onclick = function () { card.remove(); if (typeof window.pzOpenCallback === "function") window.pzOpenCallback("move"); else location.href = "/index.html#callback"; };
    document.body.appendChild(card);
  };

  /* ---------- Google Maps watchdog (only matters on pages that use it) ---------- */
  var mapsBroken = false;
  window.gm_authFailure = function () { mapsBroken = true; report("error", "Google Maps auth failure (key / billing / referrer)", "maps"); };
  function mapsOk() { return !!(window.google && window.google.maps && window.google.maps.places); }
  window.addEventListener("load", function () {
    if (!document.getElementById("pickup")) return;          // no address fields on this page
    setTimeout(function () { if (!mapsOk()) { mapsBroken = true; report("error", "Google Maps did not load within 15s", "maps"); } }, 15000);
  });
  // when a customer starts entering addresses and Maps is down, offer help
  document.addEventListener("focusin", function (e) {
    if (!e.target || (e.target.id !== "pickup" && e.target.id !== "drop")) return;
    if (mapsBroken || (document.readyState === "complete" && performance.now() > 15000 && !mapsOk())) window.pzFallback("maps");
  });
})();
