/**
 * PackZen — catalog booking UI (cart → checkout → pay)
 * ---------------------------------------------------------------
 * Loaded on services.html after catalog-public.js. Adds:
 *   • "Add" buttons / quantity steppers on every catalog card
 *   • a sticky cart bar
 *   • a checkout dialog (details, pay on service / pay online)
 *
 * The browser only sends { type, id, qty } plus the customer's details.
 * Prices shown here are for display; the server re-prices from Firestore
 * (functions/catalog-booking.js) and is the only source of what is charged.
 */
(function () {
  "use strict";

  var C = window.PackZenCatalog;
  var esc = C.esc;
  var FN_BASE = "https://asia-south1-packzen-e7539.cloudfunctions.net/";
  var WHATSAPP = "919945095453";
  var MAX_ONLINE = 100000;

  var items = {};          // "services/ac-1" → catalog item
  var cart = {};           // "services/ac-1" → qty
  var requestId = null;    // idempotency key for the current attempt
  var busy = false;
  var els = {};

  /* ── Helpers ─────────────────────────────────────────────── */
  var inr = function (n) { return "₹" + Number(n).toLocaleString("en-IN"); };
  var $ = function (id) { return document.getElementById(id); };

  function newRequestId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return "r" + Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  function kindOf(item) {
    var price = Number(item.basePrice);
    if (item.pricingUnit === "quote" || !isFinite(price) || price <= 0) return "quote";
    return item.pricingUnit === "starting_from" ? "estimate" : "fixed";
  }
  function qtyMax(item) { return item.pricingUnit === "per_carton" ? 500 : 20; }

  function totals() {
    var t = { count: 0, fixed: 0, estimate: 0, quotes: 0, lines: [] };
    Object.keys(cart).forEach(function (key) {
      var item = items[key]; if (!item) return;
      var qty = cart[key], kind = kindOf(item);
      var line = kind === "quote" ? 0 : Number(item.basePrice) * qty;
      t.count += qty;
      if (kind === "fixed") t.fixed += line;
      else if (kind === "estimate") t.estimate += line;
      else t.quotes += 1;
      t.lines.push({ key: key, item: item, qty: qty, kind: kind, total: line });
    });
    t.onlineOk = t.lines.length > 0 && t.quotes === 0 && t.estimate === 0 && t.fixed >= 1 && t.fixed <= MAX_ONLINE;
    return t;
  }

  function resetAttempt() { requestId = null; }
  function ensureRequestId() { if (!requestId) requestId = newRequestId(); return requestId; }

  /* ── Card controls ───────────────────────────────────────── */
  function renderControls() {
    document.querySelectorAll(".cat-book[data-key]").forEach(function (box) {
      var key = box.dataset.key, item = items[key]; if (!item) return;
      var qty = cart[key] || 0;
      var wa = box.querySelector(".cat-wa");
      var ctl = box.querySelector(".cat-ctl");
      if (!ctl) { ctl = document.createElement("div"); ctl.className = "cat-ctl"; box.insertBefore(ctl, box.firstChild); }
      if (!qty) {
        ctl.innerHTML = '<button type="button" class="cat-add" data-act="add" data-key="' + esc(key) + '">' +
          (kindOf(item) === "quote" ? "Request quote" : "Add to booking") + "</button>";
      } else {
        ctl.innerHTML = '<div class="cat-stepper" role="group" aria-label="Quantity for ' + esc(item.name) + '">' +
          '<button type="button" data-act="dec" data-key="' + esc(key) + '" aria-label="Decrease">−</button>' +
          '<span aria-live="polite">' + qty + "</span>" +
          '<button type="button" data-act="inc" data-key="' + esc(key) + '" aria-label="Increase">+</button></div>';
      }
      if (wa) wa.style.display = "";
    });
  }

  function renderBar() {
    var t = totals();
    var bar = els.bar;
    if (!t.lines.length) { bar.hidden = true; return; }
    var parts = [];
    if (t.fixed + t.estimate > 0) parts.push((t.estimate || t.quotes ? "Est. " : "") + inr(t.fixed + t.estimate));
    if (t.quotes) parts.push(t.quotes + " to quote");
    bar.querySelector(".cat-bar-text").innerHTML =
      "<strong>" + t.lines.length + (t.lines.length === 1 ? " item" : " items") + "</strong> · " + esc(parts.join(" + ") || "No price yet");
    bar.hidden = false;
  }

  function changeQty(key, delta) {
    var item = items[key]; if (!item) return;
    var next = (cart[key] || 0) + delta;
    if (next <= 0) delete cart[key];
    else cart[key] = Math.min(next, qtyMax(item));
    resetAttempt();
    renderControls(); renderBar();
    if (els.modal.classList.contains("open")) renderSummary();
  }

  /* ── Checkout dialog ─────────────────────────────────────── */
  function buildDom() {
    var bar = document.createElement("div");
    bar.className = "cat-bar"; bar.hidden = true;
    bar.innerHTML = '<div class="cat-bar-text"></div><button type="button" class="cat-bar-btn" data-act="open">Review &amp; book</button>';
    document.body.appendChild(bar);

    var modal = document.createElement("div");
    modal.className = "cat-overlay"; modal.id = "catCheckout";
    modal.innerHTML =
      '<div class="cat-dialog" role="dialog" aria-modal="true" aria-labelledby="catDlgTitle">' +
      '<button type="button" class="cat-close" data-act="close" aria-label="Close">×</button>' +
      '<div id="catDlgBody"></div></div>';
    document.body.appendChild(modal);

    els.bar = bar; els.modal = modal; els.body = modal.querySelector("#catDlgBody");
  }

  function todayIST() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }
  function plusDays(ymd, n) { var d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  function openCheckout() {
    if (!Object.keys(cart).length) return;
    ensureRequestId();
    var user = firebase.auth().currentUser;
    var today = todayIST();
    els.body.innerHTML =
      '<h2 id="catDlgTitle">Your booking</h2>' +
      '<div id="catSummary"></div>' +
      '<form id="catForm" novalidate autocomplete="on">' +
      '<div class="cat-fields">' +
      '<label>Full name<input id="cfName" autocomplete="name" maxlength="80" value="' + esc(user && user.displayName || "") + '"></label>' +
      '<label>Mobile number<input id="cfPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="14" placeholder="10-digit number"></label>' +
      '<label class="cat-wide">Email <small>(optional, for confirmation)</small><input id="cfEmail" type="email" autocomplete="email" maxlength="120" value="' + esc(user && user.email || "") + '"></label>' +
      '<label class="cat-wide">Service address<textarea id="cfAddress" rows="2" maxlength="300" autocomplete="street-address" placeholder="Flat / house no., street, area, Bangalore"></textarea></label>' +
      '<label>Date<input id="cfDate" type="date" min="' + today + '" max="' + plusDays(today, 180) + '"></label>' +
      '<label>Time slot<select id="cfSlot"><option value="">Select…</option>' +
      '<option value="morning">Morning (8am – 12pm)</option><option value="afternoon">Afternoon (12pm – 4pm)</option><option value="evening">Evening (4pm – 8pm)</option></select></label>' +
      '<label class="cat-wide">Notes <small>(optional)</small><textarea id="cfNotes" rows="2" maxlength="500" placeholder="Floor, lift, landmarks, anything we should know"></textarea></label>' +
      "</div>" +
      '<fieldset class="cat-pay" id="catPay"></fieldset>' +
      '<div id="catAuth"></div>' +
      '<div class="cat-error" id="catError" role="alert"></div>' +
      '<button type="submit" class="cat-submit" id="catSubmit">Confirm booking</button>' +
      "</form>";
    renderSummary();
    renderAuth();
    els.modal.classList.add("open");
    document.body.classList.add("cat-lock");
    setTimeout(function () { var f = $("cfName"); if (f) f.focus(); }, 60);
  }

  function closeCheckout() {
    if (busy) return;
    els.modal.classList.remove("open");
    document.body.classList.remove("cat-lock");
  }

  function renderSummary() {
    var t = totals();
    var box = $("catSummary"); if (!box) return;
    if (!t.lines.length) { closeCheckout(); return; }

    var rows = t.lines.map(function (l) {
      var price = l.kind === "quote" ? "Quote" : (l.kind === "estimate" ? "From " : "") + inr(l.total);
      return '<div class="cat-row"><div><strong>' + esc(l.item.name) + "</strong>" +
        '<div class="cat-sub">' + (l.qty > 1 ? l.qty + " × " + esc(C.formatPrice(l.item)) : esc(C.formatPrice(l.item))) + "</div></div>" +
        '<div class="cat-row-right"><span>' + esc(price) + '</span>' +
        '<button type="button" class="cat-rm" data-act="remove" data-key="' + esc(l.key) + '" aria-label="Remove ' + esc(l.item.name) + '">Remove</button></div></div>';
    }).join("");

    var note = "";
    if (t.quotes) note = "Some items are priced after we understand your requirement — we'll call you with the final price. You pay nothing now.";
    else if (t.estimate) note = "“From” prices are starting prices; we'll confirm the final amount before the service.";
    var sum = t.fixed + t.estimate;
    box.innerHTML = rows +
      '<div class="cat-total"><span>' + (t.estimate || t.quotes ? "Estimated total" : "Total") + "</span><strong>" + (sum ? inr(sum) : "—") + "</strong></div>" +
      (note ? '<p class="cat-note">' + esc(note) + "</p>" : "");

    var pay = $("catPay");
    var keep = (pay.querySelector("input:checked") || {}).value;
    var online = t.onlineOk;
    var choice = online && keep === "online" ? "online" : "later";
    pay.innerHTML = "<legend>Payment</legend>" +
      '<label class="cat-opt"><input type="radio" name="catPayMode" value="later"' + (choice === "later" ? " checked" : "") + "> <span><strong>Pay on service</strong><small>Cash or UPI after the work is done</small></span></label>" +
      '<label class="cat-opt' + (online ? "" : " off") + '"><input type="radio" name="catPayMode" value="online"' + (choice === "online" ? " checked" : "") + (online ? "" : " disabled") + "> <span><strong>Pay online" + (online ? " " + inr(t.fixed) : "") + "</strong><small>" +
      (online ? "Secure payment via Razorpay" : "Available when every item has a fixed price") + "</small></span></label>";
    updateSubmitLabel();
  }

  function payMode() { var r = document.querySelector('input[name="catPayMode"]:checked'); return r ? r.value : "later"; }

  function updateSubmitLabel() {
    var b = $("catSubmit"); if (!b || busy) return;
    var t = totals();
    b.textContent = payMode() === "online" ? "Pay " + inr(t.fixed) + " & book"
      : (t.quotes || t.estimate ? "Request booking" : "Confirm booking");
  }

  function renderAuth() {
    var box = $("catAuth"); if (!box) return;
    var user = firebase.auth().currentUser;
    if (user) {
      box.innerHTML = '<p class="cat-signed">Signed in as ' + esc(user.email || user.phoneNumber || user.displayName || "your account") + "</p>";
      return;
    }
    box.innerHTML = '<div class="cat-signin"><p>Sign in so we can save this booking to your account.</p>' +
      '<button type="button" class="cat-google" data-act="google">Continue with Google</button>' +
      '<p class="cat-sub">Use email or phone? <a href="index.html">Sign in on the home page</a>, then come back here — your cart will be waiting.</p></div>';
  }

  function showError(msg) { var e = $("catError"); if (e) e.textContent = msg || ""; }

  function readForm() {
    return {
      customerName: $("cfName").value.trim(), phone: $("cfPhone").value.trim(), email: $("cfEmail").value.trim(),
      address: $("cfAddress").value.trim(), date: $("cfDate").value, timeSlot: $("cfSlot").value, notes: $("cfNotes").value.trim(),
    };
  }

  function clientCheck(d) {
    if (d.customerName.length < 2) return "Please enter your name.";
    if (!/^[6-9]\d{9}$/.test(d.phone.replace(/[\s()-]/g, "").replace(/^\+?91/, ""))) return "Enter a valid 10-digit mobile number.";
    if (d.address.length < 8) return "Please enter the full service address.";
    if (!d.date) return "Choose a service date.";
    if (d.date < todayIST()) return "The service date can't be in the past.";
    if (!d.timeSlot) return "Choose a time slot.";
    return "";
  }

  function cartPayload() {
    return Object.keys(cart).map(function (key) {
      var p = key.split("/"); return { type: p[0], id: p[1], qty: cart[key] };
    });
  }

  function setBusy(on, label) {
    busy = on;
    var b = $("catSubmit"); if (!b) return;
    b.disabled = on;
    if (on) b.textContent = label || "Please wait…"; else updateSubmitLabel();
  }

  /* ── Sign-in (Google popup, same provider as the main site) ── */
  function signInGoogle() {
    showError("");
    var provider = new firebase.auth.GoogleAuthProvider();
    return firebase.auth().signInWithPopup(provider).then(function (res) {
      try { // mirror script.js: create/refresh the user profile (non-blocking)
        if (window._firebase.functions) window._firebase.functions.httpsCallable("syncOAuthUserProfile")().catch(function () {});
      } catch (e) {}
      var u = res.user;
      if (u && !$("cfName").value) $("cfName").value = u.displayName || "";
      if (u && !$("cfEmail").value) $("cfEmail").value = u.email || "";
      renderAuth();
      return u;
    });
  }

  /* ── Submit ──────────────────────────────────────────────── */
  function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    showError("");
    var details = readForm();
    var problem = clientCheck(details);
    if (problem) { showError(problem); return; }

    var user = firebase.auth().currentUser;
    var go = function (u) { return payMode() === "online" ? payOnline(u, details) : payLater(details); };

    if (!user) {
      setBusy(true, "Signing in…");
      signInGoogle().then(function (u) { setBusy(false); return go(u); })
        .catch(function (err) { setBusy(false); showError(err && err.code === "auth/popup-closed-by-user" ? "Sign-in was cancelled." : "Could not sign in. Please try again."); });
      return;
    }
    go(user);
  }

  function friendly(err) {
    var m = err && err.message ? String(err.message) : "";
    if (err && err.code === "functions/unauthenticated") return "Please sign in again and retry.";
    return m && !/internal|unavailable|deadline/i.test(m) ? m.replace(/^.*?:\s*/, "") : "Something went wrong. Please try again, or message us on WhatsApp.";
  }

  function payLater(details) {
    setBusy(true, "Booking…");
    return window._firebase.functions.httpsCallable("createServiceBooking")({
      requestId: ensureRequestId(), items: cartPayload(), details: details,
    }).then(function (res) {
      setBusy(false); success(res.data, false);
    }).catch(function (err) { setBusy(false); showError(friendly(err)); });
  }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = resolve; s.onerror = function () { reject(new Error("Could not load the payment window.")); };
      document.head.appendChild(s);
    });
  }

  function post(path, token, body) {
    return fetch(FN_BASE + path, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }

  function payOnline(user, details) {
    setBusy(true, "Starting payment…");
    var key = window.ENV && window.ENV.RAZORPAY_KEY;
    if (!key) { setBusy(false); showError("Online payment is unavailable right now. Please choose Pay on service."); return; }

    Promise.all([user.getIdToken(), loadRazorpay()]).then(function (r) {
      var token = r[0];
      return post("createServiceRazorpayOrder", token, { requestId: ensureRequestId(), items: cartPayload(), details: details })
        .then(function (order) {
          if (!order.success) throw new Error(order.error || "Could not start payment.");
          setBusy(false);
          setBusy(true, "Waiting for payment…");
          var rzp = new window.Razorpay({
            key: key, amount: order.amount, currency: order.currency, order_id: order.orderId,
            name: "PackZen Packers & Movers", description: "Service booking",
            prefill: { name: details.customerName, contact: details.phone, email: details.email },
            theme: { color: "#2F9E5C" },
            handler: function (resp) {
              setBusy(true, "Confirming payment…");
              post("verifyServiceRazorpayPayment", token, {
                razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature,
              }).then(function (v) {
                setBusy(false);
                if (!v.success) { showError((v.error || "We could not confirm your payment.") + " Payment ID: " + resp.razorpay_payment_id); return; }
                success({ bookingRef: v.bookingRef, status: "confirmed", total: order.serverCalculatedTotal, paymentId: resp.razorpay_payment_id }, true);
              }).catch(function () {
                setBusy(false);
                showError("Payment received but confirmation was interrupted. Please WhatsApp us your payment ID: " + resp.razorpay_payment_id);
              });
            },
            modal: { ondismiss: function () { setBusy(false); } },
          });
          rzp.on("payment.failed", function (f) { setBusy(false); showError("Payment failed: " + ((f.error && f.error.description) || "please try again.")); });
          rzp.open();
        });
    }).catch(function (err) { setBusy(false); showError(friendly(err)); });
  }

  /* ── Success ─────────────────────────────────────────────── */
  function success(data, paid) {
    var ref = data.bookingRef || "";
    var pending = data.status === "pending";
    var msg = paid ? "Payment received — your booking is confirmed."
      : pending ? "We've received your request. Our team will call you shortly to confirm the final price and slot."
        : "Your booking is confirmed. You can pay after the service.";
    var wa = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent("Hi PackZen, my booking reference is " + ref);
    els.body.innerHTML =
      '<div class="cat-done"><div class="cat-tick" aria-hidden="true">✓</div>' +
      '<h2 id="catDlgTitle">' + (pending ? "Request sent" : "Booking confirmed") + "</h2>" +
      "<p>" + esc(msg) + "</p>" +
      '<div class="cat-ref">Reference <strong>' + esc(ref) + "</strong></div>" +
      (data.total ? '<p class="cat-sub">' + (paid ? "Paid " : pending ? "Estimated " : "Total ") + inr(data.total) + "</p>" : "") +
      '<a class="cat-submit" href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a>' +
      '<button type="button" class="cat-link" data-act="done">Done</button></div>';
    cart = {}; resetAttempt();
    renderControls(); renderBar();
  }

  /* ── Events ──────────────────────────────────────────────── */
  function bind() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-act]"); if (!t) return;
      var act = t.dataset.act, key = t.dataset.key;
      if (act === "add" || act === "inc") changeQty(key, 1);
      else if (act === "dec") changeQty(key, -1);
      else if (act === "remove") changeQty(key, -(cart[key] || 0));
      else if (act === "open") openCheckout();
      else if (act === "close" || act === "done") closeCheckout();
      else if (act === "google") {
        setBusy(true, "Signing in…");
        signInGoogle().then(function () { setBusy(false); })
          .catch(function (err) { setBusy(false); showError(err && err.code === "auth/popup-closed-by-user" ? "Sign-in was cancelled." : "Could not sign in. Please try again."); });
      }
    });
    els.modal.addEventListener("click", function (e) { if (e.target === els.modal) closeCheckout(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && els.modal.classList.contains("open")) closeCheckout(); });
    document.addEventListener("submit", function (e) { if (e.target && e.target.id === "catForm") onSubmit(e); });
    document.addEventListener("change", function (e) { if (e.target && e.target.name === "catPayMode") updateSubmitLabel(); });
    firebase.auth().onAuthStateChanged(function () { if (els.modal.classList.contains("open") && $("catAuth")) renderAuth(); });
  }

  /* ── Public API ──────────────────────────────────────────── */
  window.PackZenBooking = {
    // cat = result of PackZenCatalog.load(); call after the cards are in the DOM
    mount: function (cat) {
      items = {};
      ["services", "packages", "addons"].forEach(function (type) {
        (cat[type] || []).forEach(function (it) { items[type + "/" + it.id] = it; });
      });
      if (!els.bar) { buildDom(); bind(); }
      renderControls(); renderBar();
    },
  };
})();
