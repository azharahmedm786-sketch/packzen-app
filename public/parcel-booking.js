/* PackZen — parcel delivery booking page.
 * The browser sends only addresses, contacts, item and weight. The price comes
 * from the server (getParcelQuote / createParcelRazorpayOrder); payment is
 * confirmed by the shared verifyServiceRazorpayPayment endpoint. */
(function () {
  "use strict";
  var FN_BASE = "https://asia-south1-packzen-e7539.cloudfunctions.net/";
  var WHATSAPP = "919945095453";
  var $ = function (id) { return document.getElementById(id); };
  var requestId = null, quoted = null, busy = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function inr(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
  function todayIST() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }
  function plusDays(ymd, n) { var d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function newRequestId() { return "pcl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function showError(m) { $("pcError").textContent = m || ""; }
  function setBusy(on, label) {
    busy = on;
    $("pcQuote").disabled = on;
    $("pcPay").disabled = on || !quoted;
    if (label) $("pcPay").textContent = on ? label : "Pay & book";
    else if (!on) $("pcPay").textContent = quoted ? "Pay " + inr(quoted.total) + " & book" : "Pay & book";
  }

  function readForm() {
    return {
      pickup: $("pcPickup").value.trim(), drop: $("pcDrop").value.trim(),
      senderName: $("pcSenderName").value.trim(), senderPhone: $("pcSenderPhone").value.trim(),
      receiverName: $("pcReceiverName").value.trim(), receiverPhone: $("pcReceiverPhone").value.trim(),
      itemDescription: $("pcItem").value.trim(), weightKg: $("pcWeight").value,
      date: $("pcDate").value, timeSlot: $("pcSlot").value, notes: $("pcNotes").value.trim(),
    };
  }
  function friendly(err) {
    var m = (err && (err.message || err.error)) || "";
    if (err && err.code === "functions/unauthenticated") return "Please sign in first.";
    return m || "Something went wrong. Please try again.";
  }

  // Any edit invalidates the shown price.
  function invalidate() {
    if (!quoted) return;
    quoted = null; requestId = null; $("pcPrice").innerHTML = ""; setBusy(false);
  }

  function renderAuth() {
    var box = $("pcAuth"), user = firebase.auth().currentUser;
    if (user) {
      box.innerHTML = "Signed in as " + esc(user.email || user.phoneNumber || user.displayName || "your account");
      if (!$("pcSenderName").value && user.displayName) $("pcSenderName").value = user.displayName;
      return;
    }
    box.innerHTML = 'Sign in to book. <br><button type="button" class="pc-btn pc-btn-ghost" id="pcGoogle">Continue with Google</button>' +
      ' <span class="pc-small">Email or phone? <a href="/">Sign in on the home page</a>, then come back.</span>';
    $("pcGoogle").onclick = function () {
      firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () {
        try { window._firebase.functions.httpsCallable("syncOAuthUserProfile")().catch(function () {}); } catch (e) {}
      }).catch(function (e) { showError(e && e.code === "auth/popup-closed-by-user" ? "Sign-in was cancelled." : "Could not sign in. Please try again."); });
    };
  }

  function getQuote() {
    showError("");
    if (!firebase.auth().currentUser) { showError("Please sign in first."); return; }
    setBusy(true);
    $("pcQuote").textContent = "Checking…";
    window._firebase.functions.httpsCallable("getParcelQuote")({ details: readForm() }).then(function (res) {
      quoted = res.data; requestId = newRequestId();
      var b = quoted.breakdown || {};
      $("pcPrice").innerHTML = "<div>Price for " + esc(b.km) + " km · " + esc(b.weightKg) + " kg</div><strong>" + inr(quoted.total) + "</strong>" +
        "<ul><li>Base fare (first " + esc(b.includedKm) + " km): " + inr(b.baseFare) + "</li>" +
        (b.extraKm ? "<li>" + esc(b.extraKm) + " km × ₹11: " + inr(b.distanceCharge) + "</li>" : "") +
        (b.weightCharge ? "<li>Over 10 kg: " + inr(b.weightCharge) + "</li>" : "") + "</ul>";
      $("pcQuote").textContent = "Update price"; setBusy(false);
    }).catch(function (err) { $("pcQuote").textContent = "Get price"; setBusy(false); showError(friendly(err)); });
  }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = resolve; s.onerror = function () { reject(new Error("Could not load the payment window.")); };
      document.head.appendChild(s);
    });
  }
  function post(path, token, body) {
    return fetch(FN_BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  function pay() {
    var user = firebase.auth().currentUser;
    if (!user) { showError("Please sign in first."); return; }
    if (!quoted) { showError("Get the price first."); return; }
    var key = window.ENV && window.ENV.RAZORPAY_KEY;
    if (!key) { showError("Online payment is unavailable right now. Please call us to book."); return; }
    showError(""); setBusy(true, "Starting payment…");
    var details = readForm();
    Promise.all([user.getIdToken(), loadRazorpay()]).then(function (r) {
      var token = r[0];
      return post("createParcelRazorpayOrder", token, { requestId: requestId, details: details }).then(function (order) {
        if (!order.success) throw new Error(order.error || "Could not start payment.");
        setBusy(true, "Waiting for payment…");
        var rzp = new window.Razorpay({
          key: key, amount: order.amount, currency: order.currency, order_id: order.orderId,
          name: "PackZen", description: "Parcel delivery", theme: { color: "#2F9E5C" },
          prefill: { name: details.senderName, contact: details.senderPhone, email: user.email || "" },
          handler: function (resp) {
            setBusy(true, "Confirming payment…");
            post("verifyServiceRazorpayPayment", token, { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature })
              .then(function (v) {
                if (!v.success) { setBusy(false); showError((v.error || "We could not confirm your payment.") + " Payment ID: " + resp.razorpay_payment_id); return; }
                done(v.bookingRef, order.serverCalculatedTotal);
              }).catch(function () { setBusy(false); showError("Payment received but confirmation was interrupted. Please WhatsApp us your payment ID: " + resp.razorpay_payment_id); });
          },
          modal: { ondismiss: function () { setBusy(false); } },
        });
        rzp.on("payment.failed", function (f) { setBusy(false); showError("Payment failed: " + ((f.error && f.error.description) || "please try again.")); });
        rzp.open();
      });
    }).catch(function (err) { setBusy(false); showError(friendly(err)); });
  }

  function done(ref, total) {
    if (window.pzTrack) window.pzTrack("purchase", { transaction_id: ref, value: Number(total) || 0, currency: "INR", items: [{ item_name: "Parcel delivery", item_category: "parcel", price: Number(total) || 0 }] });
    var wa = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent("Hi PackZen, my parcel booking reference is " + ref);
    $("pcForm").hidden = true;
    var box = $("pcDone");
    box.innerHTML = "<h2>Parcel booked ✓</h2><p>Payment of " + inr(total) + " received. We'll SMS you when a rider is assigned.</p>" +
      '<div class="pc-ref">Reference <strong>' + esc(ref) + "</strong></div>" +
      '<a class="pc-btn" href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a>';
    box.hidden = false; box.scrollIntoView({ behavior: "smooth" });
  }

  function initPlaces() {
    var k = window.ENV && window.ENV.GOOGLE_MAPS_KEY;
    if (!k || (window.google && window.google.maps)) return;
    window.__pcPlaces = function () {
      try {
        var opts = { componentRestrictions: { country: "in" }, fields: ["formatted_address"] };
        ["pcPickup", "pcDrop"].forEach(function (id) {
          var ac = new google.maps.places.Autocomplete($(id), opts);
          ac.addListener("place_changed", function () { var p = ac.getPlace(); if (p && p.formatted_address) $(id).value = p.formatted_address; invalidate(); });
        });
      } catch (e) {}
    };
    var s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(k) + "&libraries=places&callback=__pcPlaces";
    s.async = true; document.head.appendChild(s);
  }

  function init() {
    var t = todayIST(); $("pcDate").min = t; $("pcDate").max = plusDays(t, 30); $("pcDate").value = t;
    $("pcQuote").onclick = function () { if (!busy) getQuote(); };
    $("pcPay").onclick = function () { if (!busy) pay(); };
    Array.prototype.forEach.call(document.querySelectorAll("#pcForm input, #pcForm select"), function (el) { el.addEventListener("input", invalidate); el.addEventListener("change", invalidate); });
    firebase.auth().onAuthStateChanged(renderAuth);
    renderAuth(); initPlaces();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
