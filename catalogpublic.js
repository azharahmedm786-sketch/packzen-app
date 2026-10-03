/**
 * PackZen — Public Service Catalog loader
 * ---------------------------------------------------------------
 * Reads the four catalog collections (managed from Admin → Services
 * Catalog) and exposes helpers for the homepage and services.html.
 *
 *   PackZenCatalog.load()      → Promise<{ categories, services, packages, addons }>
 *   PackZenCatalog.formatPrice(item)
 *   PackZenCatalog.whatsappLink(item)
 *   PackZenCatalog.esc(text)   → HTML-escape (use for every Firestore string)
 *
 * Only documents with isActive == true are returned. Firestore rules allow
 * public read on these collections, so no login is required.
 * Requires: firebase-app/auth/firestore compat SDKs + firebase-config.js
 * (which sets window._firebase).
 */
(function () {
  "use strict";

  const WHATSAPP_NUMBER = "919945095453";
  const COLLECTIONS = {
    categories: "serviceCategories",
    services: "services",
    packages: "packages",
    addons: "addons",
  };

  let cached = null; // one fetch per page view

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function byOrder(a, b) {
    return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""));
  }

  // firebase-config.js runs before us, but wait briefly in case of slow loads.
  function whenFirebaseReady(tries) {
    tries = tries || 0;
    return new Promise(function (resolve, reject) {
      (function check(n) {
        if (window._firebase && window._firebase.db) return resolve(window._firebase.db);
        if (n > 40) return reject(new Error("Firebase did not load"));
        setTimeout(function () { check(n + 1); }, 150);
      })(tries);
    });
  }

  function fetchCollection(db, name) {
    return db.collection(name).where("isActive", "==", true).get().then(function (snap) {
      return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(byOrder);
    });
  }

  function load() {
    if (cached) return cached;
    cached = whenFirebaseReady().then(function (db) {
      const keys = Object.keys(COLLECTIONS);
      return Promise.all(keys.map(function (k) { return fetchCollection(db, COLLECTIONS[k]); }))
        .then(function (lists) {
          const out = {};
          keys.forEach(function (k, i) { out[k] = lists[i]; });
          return out;
        });
    });
    // Allow a retry after a failure instead of caching the rejection.
    cached.catch(function () { cached = null; });
    return cached;
  }

  function formatPrice(item) {
    if (!item || item.pricingUnit === "quote") return "Get a quote";
    const n = Number(item.basePrice);
    if (!isFinite(n)) return "Get a quote";
    const base = "₹" + n.toLocaleString("en-IN");
    switch (item.pricingUnit) {
      case "starting_from": return "From " + base;
      case "per_item": return base + " / item";
      case "per_carton": return base + " / carton";
      default: return base;
    }
  }

  function whatsappLink(item) {
    const msg = "Hi PackZen, I'd like to book: " + item.name + " (" + formatPrice(item) + ")";
    return "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(msg);
  }

  window.PackZenCatalog = { load: load, formatPrice: formatPrice, whatsappLink: whatsappLink, esc: esc };
})();
