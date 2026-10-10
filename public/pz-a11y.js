/**
 * PackZen — dialog accessibility layer (customer, admin, driver, partner pages)
 * ----------------------------------------------------------------------------
 * Progressive enhancement for the existing modals/sheets. It never opens or
 * closes anything on its own:
 *   • role="dialog" + aria-modal + aria-labelledby (from the dialog's title)
 *   • on open: remembers the trigger and moves focus into the dialog
 *   • Tab / Shift+Tab stay inside the top-most open dialog
 *   • Escape clicks the dialog's own close control (same code path as a tap)
 *   • on close: focus returns to the element that opened it
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var DIALOG_SELECTOR = ".modal-overlay, .booking-sheet, .assign-overlay, .assign-modal, [data-pz-dialog]";
  var TITLE_SELECTOR = ".modal-title, .auth-title, .sheet-title, h2, h3";
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var CLOSE_SELECTOR = '[data-close], .modal-close, .modal-x, .sheet-close, .cc-close, .chat-close-btn, .close-btn, .assign-close, button[aria-label^="Close" i]';
  var seq = 0;
  var openState = new WeakMap();

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }
  function focusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), function (n) { return visible(n); });
  }
  function enhance(el) {
    if (el.__pzA11y) return;
    el.__pzA11y = true;
    if (!el.getAttribute("role")) el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    if (!el.getAttribute("aria-labelledby") && !el.getAttribute("aria-label")) {
      var t = el.querySelector(TITLE_SELECTOR);
      if (t) { if (!t.id) t.id = "pzDialogTitle" + (++seq); el.setAttribute("aria-labelledby", t.id); }
    }
    el.querySelectorAll(CLOSE_SELECTOR).forEach(function (b) {
      if (!b.getAttribute("aria-label") && !/[a-z]{3,}/i.test(String(b.textContent || ""))) b.setAttribute("aria-label", "Close");
      if (b.tagName === "BUTTON" && !b.getAttribute("type")) b.setAttribute("type", "button");
    });
  }
  function openDialogs() { return Array.prototype.filter.call(document.querySelectorAll(DIALOG_SELECTOR), visible); }
  function topDialog() {
    var list = openDialogs();
    if (!list.length) return null;
    return list.reduce(function (a, b) {
      var za = Number(getComputedStyle(a).zIndex) || 0, zb = Number(getComputedStyle(b).zIndex) || 0;
      return zb >= za ? b : a;
    });
  }
  function sync() {
    document.querySelectorAll(DIALOG_SELECTOR).forEach(function (el) {
      enhance(el);
      var isOpen = visible(el), was = openState.get(el) || false;
      if (isOpen && !was) {
        openState.set(el, true);
        el.__pzReturnFocus = document.activeElement;
        setTimeout(function () {
          if (!visible(el) || el.contains(document.activeElement)) return;
          var target = el.querySelector("[autofocus]") || focusables(el)[0];
          if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
          else { el.setAttribute("tabindex", "-1"); el.focus(); }
        }, 60);
      } else if (!isOpen && was) {
        openState.set(el, false);
        var r = el.__pzReturnFocus;
        if (r && r.isConnected && visible(r)) { try { r.focus({ preventScroll: true }); } catch (e) { r.focus(); } }
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    var d = topDialog();
    if (!d) return;
    if (e.key === "Escape") {
      var close = Array.prototype.find.call(d.querySelectorAll(CLOSE_SELECTOR), visible);
      if (close) { e.preventDefault(); close.click(); }
      return;
    }
    if (e.key !== "Tab") return;
    var f = focusables(d);
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  var pending = false;
  // Overlays fade in (CSS animation/transition from opacity 0), so re-check
  // once the fade has had time to finish as well as on animation/transition end.
  function schedule() {
    if (pending) return; pending = true;
    requestAnimationFrame(function () { pending = false; sync(); });
    setTimeout(sync, 250);
  }
  function start() {
    sync();
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["class", "style", "hidden"], subtree: true, childList: true });
    document.addEventListener("transitionend", schedule, true);
    document.addEventListener("animationend", schedule, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  window.PackZenA11y = { sync: sync, topDialog: topDialog };
})();
