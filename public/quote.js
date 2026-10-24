/* PackZen — the customer's quote link: fixed price, what's included, book & pay. */
(function () {
  "use strict";
  var API = "https://asia-south1-packzen-e7539.cloudfunctions.net";
  var box = document.getElementById("qBox"), Q = null, token = new URLSearchParams(location.search).get("t") || "";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var inr = function (n) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); };
  function ready(cb, n) { n = n || 0; if (window._firebase && window._firebase.functions) return cb(); if (n > 60) { box.innerHTML = "<p>Couldn't load. Please refresh or call 99450 95453.</p>"; return; } setTimeout(function () { ready(cb, n + 1); }, 150); }

  function render() {
    var x = Q.extras || {}, items = [];
    if (x.packingService) items.push("Packing with quality materials");
    if (x.acCount > 0) items.push(x.acCount + " AC uninstall + refit");
    if (x.needCarpenter) items.push("Carpenter (dismantle & reassemble)");
    if (x.needElectrician) items.push("Electrician (disconnect & refit)");
    box.innerHTML = '<h1 style="font-family:var(--nb-display);margin:0 0 4px">Hi ' + esc(Q.firstName) + ', here’s your quote</h1>' +
      '<p class="q-adv">' + esc(Q.sizeLabel) + ' move · ' + esc(Q.date) + (Q.timeSlot ? " · " + esc(Q.timeSlot) : "") + '</p>' +
      '<div class="q-total">' + inr(Q.total) + '</div><p class="q-adv">All-inclusive, fixed price' + (Q.discount > 0 ? " · includes " + inr(Q.discount) + (Q.discountKind === "weekday" ? " weekday saver" : " discount") : "") + '</p>' +
      '<div class="q-row"><span>From</span><span>' + esc(Q.pickup) + '</span></div><div class="q-row"><span>To</span><span>' + esc(Q.drop) + '</span></div>' +
      '<div class="q-row"><span>Book now with</span><span><b>' + inr(Q.advance) + '</b> advance (10%)</span></div><div class="q-row"><span>Pay on moving day</span><span>' + inr(Q.total - Q.advance) + '</span></div>' +
      '<ul class="q-inc"><li>Loading &amp; unloading</li><li>Truck &amp; fuel</li><li>Floors as discussed</li><li>Damage cover up to ₹10,000</li>' + items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + '</ul>' +
      (Q.expired ? '<p class="pc-error">This quote has expired. Call <a href="tel:9945095453">99450 95453</a> and we’ll refresh it.</p>' :
        '<button class="pc-btn q-cta" id="qBook">Book &amp; pay ' + inr(Q.advance) + ' advance</button><div id="qAuth"></div><p class="q-note">Full refund if you cancel before your moving day. Secure payment by Razorpay.</p>') +
      '<p class="q-note">Questions? <a href="tel:9945095453">Call</a> or <a href="https://wa.me/919945095453" target="_blank" rel="noopener">WhatsApp</a> us.</p>';
    var b = document.getElementById("qBook"); if (b) b.onclick = book;
  }

  function signInUI() {
    var a = document.getElementById("qAuth");
    a.innerHTML = '<div class="q-signin"><p class="q-note" style="margin:0">Sign in once so your booking appears in My Bookings:</p>' +
      '<button class="pc-btn" id="qGoogle" style="background:#fff;color:#0C1A14;border:1px solid rgba(10,40,28,.18)">Continue with Google</button></div>';
    document.getElementById("qGoogle").onclick = function () {
      var p = new firebase.auth.GoogleAuthProvider();
      window._firebase.auth.signInWithPopup(p).then(function () { a.innerHTML = ""; book(); }).catch(function (e) { a.innerHTML += '<p class="pc-error">' + esc(e.message) + "</p>"; });
    };
  }
  function post(path, body) {
    return window._firebase.auth.currentUser.getIdToken().then(function (t) {
      return fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); });
    });
  }
  function rid() { try { return crypto.randomUUID().replace(/-/g, ""); } catch (e) { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); } }

  function book() {
    if (!window._firebase.auth.currentUser) return signInUI();
    var b = document.getElementById("qBook"); b.disabled = true; b.textContent = "Starting secure payment…";
    post("/createRazorpayOrder", { quoteInput: Q.quoteInput, paymentType: "advance", customerName: Q.customerName, phone: Q.phone, moveType: Q.sizeLabel + " (quote link)",
      pickup: Q.pickup, drop: Q.drop, date: Q.date, details: { timeSlot: Q.timeSlot || "", notes: "Booked from quote link" }, requestId: rid() })
      .then(function (r) {
        if (r.status !== 200 || !r.data.success) throw new Error(r.data.error || "Couldn't start the payment.");
        var o = r.data;
        new Razorpay({ key: (window.ENV && window.ENV.RAZORPAY_KEY) || "", amount: o.amount, currency: o.currency, order_id: o.orderId, name: "PackZen Packers & Movers",
          description: "Advance for your " + Q.sizeLabel + " move", prefill: { name: Q.customerName, contact: Q.phone }, theme: { color: "#1F9D5C" },
          handler: function (resp) {
            b.textContent = "Payment received — confirming…";
            post("/verifyRazorpayPayment", { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature })
              .then(function (v) {
                if (window.pzTrack) window.pzTrack("purchase", { transaction_id: v.data.bookingRef || o.orderId, value: Q.advance, currency: "INR", items: [{ item_name: "Moving (quote link)", item_category: "move", price: Q.total }] });
                box.innerHTML = '<h1 style="font-family:var(--nb-display)">Booked ✓</h1><p>' + (v.data.bookingRef ? "Booking <b>" + esc(v.data.bookingRef) + "</b> is confirmed." : "Payment received — your booking is being confirmed and will appear in My Bookings in a few minutes.") +
                  ' You’ll get an SMS and email. Balance ' + inr(Q.total - Q.advance) + ' is payable on moving day.</p><a class="pc-btn" href="/index.html#dashboard">Go to My Bookings</a>';
              }).catch(function () { box.innerHTML = "<h1>Payment received</h1><p>Your booking is being confirmed and will appear in My Bookings shortly. Call 99450 95453 if it doesn’t within 15 minutes.</p>"; });
          },
          modal: { ondismiss: function () { b.disabled = false; b.innerHTML = "Book &amp; pay " + inr(Q.advance) + " advance"; } },
        }).open();
      })
      .catch(function (e) { b.disabled = false; b.innerHTML = "Book &amp; pay " + inr(Q.advance) + " advance"; alert(e.message || "Couldn't start the payment."); });
  }

  ready(function () {
    window._firebase.functions.httpsCallable("getSentQuote")({ t: token })
      .then(function (r) { Q = r.data; render(); if (window.pzTrack) window.pzTrack("view_item", { value: Q.total, currency: "INR", items: [{ item_name: "Moving quote", item_category: "move" }] }); })
      .catch(function (e) { box.innerHTML = "<h1>Quote not found</h1><p>" + esc(e.message || "This link isn't valid.") + ' Call <a href="tel:9945095453">99450 95453</a> and we’ll help.</p>'; });
  });
})();
