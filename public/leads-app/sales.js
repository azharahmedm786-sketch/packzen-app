/* PackZen Leads — sales tools: Send quote link + call script / objection answers. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function open(html) { var c = $("sheetCard"); c.innerHTML = '<button class="x" aria-label="Close">×</button>' + html; $("sheet").hidden = false; c.querySelector(".x").onclick = function () { $("sheet").hidden = true; }; return c; }
  function toast(t) { var el = $("toast") || (function () { var d = document.createElement("div"); d.id = "toast"; d.className = "toast"; document.body.appendChild(d); return d; })(); el.textContent = t; el.classList.add("on"); setTimeout(function () { el.classList.remove("on"); }, 2400); }
  var today = function () { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); };

  window.pzOpenQuoteForm = function (l) {
    var size = /^(1rk|1bhk|2bhk|3bhk)$/.test(l.homeSize || "") ? l.homeSize : "2bhk";
    var c = open('<h2 id="sTitle">Send quote — ' + esc(l.name) + '</h2>' +
      '<p class="meta">Priced by the same engine as the website (distance from Google Maps). The customer gets a link with the fixed price and a Book &amp; pay button.</p>' +
      '<div class="qf">' +
      '<label>Name<input id="qName" value="' + esc(l.name) + '"></label><label>Mobile<input id="qPhone" inputmode="numeric" value="' + esc(l.phone) + '"></label>' +
      '<label>Home size<select id="qSize"><option value="1rk">1 RK</option><option value="1bhk">1 BHK</option><option value="2bhk">2 BHK</option><option value="3bhk">3 BHK</option></select></label>' +
      '<label>Moving date<input id="qDate" type="date" min="' + today() + '" value="' + esc(/^\d{4}-\d{2}-\d{2}$/.test(l.date || "") ? l.date : "") + '"></label>' +
      '<label class="wide">Pickup address (with pincode)<input id="qPickup" value="' + esc(l.area || "") + '"></label>' +
      '<label class="wide">Drop address (with pincode)<input id="qDrop"></label>' +
      '<label>Pickup floor<input id="qPF" type="number" min="0" max="30" value="0"></label><label>Drop floor<input id="qDF" type="number" min="0" max="30" value="0"></label>' +
      '<label class="chk"><input type="checkbox" id="qLift"> Lift available</label><label class="chk"><input type="checkbox" id="qPack" checked> Packing service</label>' +
      '<label>ACs to uninstall + refit<select id="qAC"><option>0</option><option>1</option><option>2</option><option>3</option></select></label>' +
      '<label class="chk"><input type="checkbox" id="qCarp"> Carpenter</label><label class="chk"><input type="checkbox" id="qElec"> Electrician</label>' +
      '<label>Time slot<select id="qSlot"><option>Morning (7–11 AM)</option><option>Afternoon (11 AM–3 PM)</option><option>Evening (3–7 PM)</option></select></label>' +
      '<label>Promo code (optional)<input id="qPromo" placeholder="FIRSTMOVE"></label>' +
      '</div><p id="qErr" class="err"></p><button class="btn" id="qGo" style="width:100%">Price it &amp; create link</button><div id="qOut"></div>');
    $("qSize").value = size;
    $("qGo").onclick = function () {
      var b = $("qGo"); b.disabled = true; b.textContent = "Pricing…"; $("qErr").textContent = "";
      window._firebase.functions.httpsCallable("createSentQuote")({
        leadId: l.id, name: $("qName").value, phone: $("qPhone").value, size: $("qSize").value, date: $("qDate").value,
        pickup: $("qPickup").value, drop: $("qDrop").value, pickupFloor: $("qPF").value, dropFloor: $("qDF").value,
        liftAvailable: $("qLift").checked, packingService: $("qPack").checked, acCount: $("qAC").value,
        needCarpenter: $("qCarp").checked, needElectrician: $("qElec").checked, timeSlot: $("qSlot").value, promoCode: $("qPromo").value,
      }).then(function (r) {
        var d = r.data, phone = String($("qPhone").value).replace(/\D/g, "").slice(-10);
        $("qOut").innerHTML = '<div class="q-result"><b>₹' + d.total.toLocaleString("en-IN") + '</b> all-inclusive · advance ₹' + d.advance.toLocaleString("en-IN") +
          '<pre class="notes">' + esc(d.message) + '</pre><div class="lead-actions">' +
          '<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/91' + phone + "?text=" + encodeURIComponent(d.message) + '">Send on WhatsApp</a>' +
          '<a class="btn ghost" href="sms:+91' + phone + "?body=" + encodeURIComponent(d.message) + '">SMS</a>' +
          '<button class="btn ghost" id="qCopy">Copy link</button></div><p class="meta">You\'ll see “opened” on this lead when the customer views it — call them right then.</p></div>';
        $("qCopy").onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(d.url) : Promise.reject()).then(function () { toast("Link copied"); }, function () { prompt("Copy:", d.url); }); };
        b.textContent = "Re-price"; b.disabled = false;
      }).catch(function (e) { $("qErr").textContent = e.message || "Couldn't create the quote."; b.disabled = false; b.textContent = "Price it & create link"; });
    };
  };

  var SCRIPT = {
    open: "Hi {name}, this is {me} from PackZen — you asked about {service}. Is now a good time for 2 minutes? I'll give you an exact price, not an estimate.",
    discover: ["Where are you moving from and to (area / pincode)?", "Which date, and is it flexible? (Tue–Thu mid-month is 3% cheaper)", "Home size? Any big items — fridge, washing machine, sofa, wardrobes?", "Which floor at both ends, and is there a lift?", "Do you want us to pack, or will you pack? Any ACs or TVs to take down and refit?"],
    close: "Based on that it's ₹{price}, all-inclusive — packing material, loading, truck, unloading. I'll send the link on WhatsApp now; you can book with a 10% advance and pay the rest on moving day. Shall I lock {date} for you?",
  };
  var OBJ = [
    ["“Another mover quoted less.”", "Ask what's included — many quotes leave out packing material, floors, AC/TV work or GST, and add them on the day. Ours is fixed: the price on the link is the price you pay. If their written quote really includes the same things, tell me and I'll see what I can do."],
    ["“Will the price change on moving day?”", "No. The price is fixed for the items, floors and services on your quote. It only changes if you add something on the day — and we tell you before doing it."],
    ["“What if something gets damaged?”", "Every PackZen booking includes damage cover up to ₹10,000 under our policy, and you report it from My Bookings within 24 hours. For expensive items there is optional extra cover."],
    ["“I'll think about it.”", "Of course. I'll send the link so you have the exact price. Dates fill up near month-end, so the advance just holds your slot — and it's fully refundable if you cancel before the moving day."],
    ["“Can you do it cheaper?”", "If it's a small load (up to 5 items, within 10 km, no packing) the mini move is ₹1,499. Tue–Thu between the 5th and 25th is 3% off. First booking above ₹4,000 gets ₹200 off with FIRSTMOVE."],
    ["“Do I pay everything upfront?”", "No — 10% advance online to confirm, the rest on moving day after the job. Online payments are via Razorpay."],
  ];
  window.pzOpenScript = function (l) {
    var me = ((window._firebase.auth.currentUser || {}).email || "").split("@")[0] || "the PackZen team";
    var fill = function (t) { return esc(t).replace("{name}", esc((l.name || "").split(" ")[0] || "there")).replace("{me}", esc(me)).replace("{service}", esc(l.serviceLabel || "your move"))
      .replace("{price}", l.quotedAmount ? Number(l.quotedAmount).toLocaleString("en-IN") : "____").replace("{date}", esc(l.date || "the date")); };
    open('<h2 id="sTitle">Call script — ' + esc(l.name) + '</h2>' +
      '<h3 class="sub-h">1. Open (10 sec)</h3><p>' + fill(SCRIPT.open) + '</p>' +
      '<h3 class="sub-h">2. Ask (1 min)</h3><ul>' + SCRIPT.discover.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ul>" +
      '<h3 class="sub-h">3. Close</h3><p>' + fill(SCRIPT.close) + '</p>' +
      '<h3 class="sub-h">If they say…</h3>' + OBJ.map(function (o) { return "<details><summary>" + esc(o[0]) + "</summary><p>" + esc(o[1]) + "</p></details>"; }).join("") +
      '<p class="meta" style="margin-top:12px">Then tap <b>Send quote link</b> while you are still on the call.</p>');
  };
})();
