/* PackZen Leads — Opportunities (Intent Radar) + Partners (Partner Finder). Admin-only. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var opps = [], prospects = [], oppStatus = "new", pipeStatus = "to_contact", started = false;
  var STATUS = { to_contact: "To contact", messaged: "Messaged", partner: "Partner", sending: "Sending leads", no: "Not interested" };
  var SVC = { move: "Shifting", ac: "AC", appliance: "Washing machine / fridge", parcel: "Parcel (old)", handyman: "Handyman (old)" };
  function call(data) { return window._firebase.functions.httpsCallable("leadFinder")(data).then(function (r) { return r.data; }); }
  function ago(ms) { var h = Math.round((Date.now() - (ms || Date.now())) / 3600e3); return h < 1 ? "just now" : h < 48 ? h + "h ago" : Math.round(h / 24) + "d ago"; }
  function toast(t) { var el = $("toast") || (function () { var d = document.createElement("div"); d.id = "toast"; d.className = "toast"; document.body.appendChild(d); return d; })(); el.textContent = t; el.classList.add("on"); setTimeout(function () { el.classList.remove("on"); }, 2400); }
  function db() { return window._firebase.db; }

  function start() {
    if (started) return; started = true;
    db().collection("opportunities").orderBy("createdAtMs", "desc").limit(200).onSnapshot(function (s) { opps = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); renderOpps(); });
    db().collection("prospects").orderBy("updatedAtMs", "desc").limit(300).onSnapshot(function (s) { prospects = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); renderPipe(); });
  }
  // start once the main app has signed in an admin
  var iv = setInterval(function () { if (!$("app").hidden && window._firebase && window._firebase.auth.currentUser) { clearInterval(iv); start(); } }, 500);

  /* ---------- Opportunities ---------- */
  function seg(id, cb) { $(id).addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; Array.prototype.forEach.call($(id).children, function (x) { x.classList.toggle("on", x === b); }); cb(b.getAttribute("data-s")); }); }
  seg("oppSeg", function (s) { oppStatus = s; renderOpps(); });
  function renderOpps() {
    var rows = opps.filter(function (o) { return (o.status || "new") === oppStatus; }).sort(function (a, b) { return (b.score || 0) - (a.score || 0) || (b.postedAtMs || 0) - (a.postedAtMs || 0); });
    $("oppList").innerHTML = rows.length ? rows.map(function (o) {
      return '<article class="lead t-' + esc(o.tier) + '" data-oid="' + o.id + '"><div class="lead-top"><span class="badge b-' + esc(o.tier) + '">' + (o.tier === "hot" ? "🔥 HOT" : "WARM") + " · " + (o.score || 0) + '</span><span class="age">' + esc(o.source) + " · " + ago(o.postedAtMs) + "</span></div>" +
        '<div class="lead-name" style="font-size:1rem">' + esc(o.title) + "</div>" +
        '<div class="lead-meta">' + (o.services || []).map(function (s) { return esc(SVC[s] || s); }).join(", ") + (o.area ? " · " + esc(o.area) : "") + "</div>" +
        (o.excerpt ? '<p class="lead-meta" style="margin:6px 0">' + esc(o.excerpt) + "</p>" : "") +
        '<details><summary>Suggested public reply</summary><pre class="notes">' + esc(o.reply) + "</pre></details>" +
        '<div class="lead-actions"><a class="btn" target="_blank" rel="noopener" href="' + esc(o.link) + '">Open post</a><button class="btn ghost" data-o="copy">Copy reply</button>' +
        (oppStatus === "new" ? '<button class="btn ghost" data-o="replied">Replied</button><button class="btn ghost" data-o="skip">Skip</button>' : "") + "</div></article>";
    }).join("") : '<p class="empty">' + (oppStatus === "new" ? "No new posts right now. The radar checks every 2 hours — or tap “Check now”." : "Nothing here.") + "</p>";
  }
  $("oppList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-o]"); if (!b) return;
    var id = b.closest("[data-oid]").getAttribute("data-oid"), o = opps.find(function (x) { return x.id === id; }); if (!o) return;
    var a = b.getAttribute("data-o");
    if (a === "copy") { (navigator.clipboard ? navigator.clipboard.writeText(o.reply) : Promise.reject()).then(function () { toast("Reply copied — paste it in the thread"); }, function () { prompt("Copy this reply:", o.reply); }); return; }
    db().collection("opportunities").doc(id).update({ status: a, handledAtMs: Date.now() }).then(function () { toast(a === "replied" ? "Marked replied" : "Skipped"); });
  });
  $("oppSweep").addEventListener("click", function () {
    var b = $("oppSweep"); b.disabled = true; b.textContent = "Checking…";
    call({ op: "sweep" }).then(function (r) { toast(r.found + " new post(s) found" + (r.errors ? " · " + r.errors + " source(s) unavailable" : "")); })
      .catch(function (e) { toast("Check failed: " + e.message); }).finally(function () { b.disabled = false; b.textContent = "Check now"; });
  });
  $("oppFeedsBtn").addEventListener("click", function () {
    db().collection("settings").doc("leadFinder").get().then(function (d) {
      var cur = (d.exists && d.data().feeds) || [];
      var v = prompt("RSS feed URLs, one per line (empty = default Reddit searches).\nTip: create Google Alerts for \"packers and movers Bangalore\" with 'Deliver to: RSS feed' and paste the feed URLs here.", cur.join("\n"));
      if (v === null) return;
      var feeds = v.split(/\s+/).map(function (x) { return x.trim(); }).filter(function (x) { return /^https:\/\/[^\s]+$/.test(x); }).slice(0, 15);
      return db().collection("settings").doc("leadFinder").set({ feeds: feeds, updatedAtMs: Date.now() }, { merge: true }).then(function () { toast(feeds.length ? feeds.length + " source(s) saved" : "Using default sources"); });
    });
  });

  /* ---------- Partners ---------- */
  $("pfGo").addEventListener("click", function () {
    var type = $("pfType").value, area = $("pfArea").value.trim(), out = $("pfResults");
    if (area.length < 3) { toast("Enter an area"); return; }
    out.innerHTML = '<p class="empty">Searching…</p>';
    call({ op: "search", type: type, area: area }).then(function (r) {
      out.innerHTML = r.results.length ? r.results.map(function (p) {
        return '<article class="lead" data-pid="' + esc(p.placeId) + '"><div class="lead-name" style="font-size:1rem">' + esc(p.name) + '</div><div class="lead-meta">' + esc(p.address) + (p.rating ? " · ★ " + p.rating + " (" + p.reviews + ")" : "") + "</div>" +
          '<div class="lead-actions">' + (p.tracked ? '<span class="badge">In pipeline</span>' : '<button class="btn" data-p="track">Add to pipeline</button>') + '<button class="btn ghost" data-p="view">Contact details</button></div></article>';
      }).join("") : '<p class="empty">No businesses found. Try a nearby area.</p>';
    }).catch(function (e) { out.innerHTML = '<p class="empty">Search failed: ' + esc(e.message) + "</p>"; });
  });
  $("pfResults").addEventListener("click", function (e) {
    var b = e.target.closest("[data-p]"); if (!b) return;
    var pid = b.closest("[data-pid]").getAttribute("data-pid");
    if (b.getAttribute("data-p") === "track") call({ op: "track", placeId: pid, type: $("pfType").value, area: $("pfArea").value.trim() }).then(function () { b.outerHTML = '<span class="badge">In pipeline</span>'; toast("Added to pipeline"); });
    else openProspect({ id: pid, placeId: pid, type: $("pfType").value, status: null });
  });
  seg("pipeSeg", function (s) { pipeStatus = s; renderPipe(); });
  function renderPipe() {
    var rows = prospects.filter(function (p) { return (p.status || "to_contact") === pipeStatus; });
    $("pipeList").innerHTML = rows.length ? rows.map(function (p) {
      return '<article class="lead" data-pid="' + esc(p.id) + '"><div class="lead-top"><span class="badge">' + esc(STATUS[p.status] || p.status) + '</span><span class="age">' + esc(p.type) + (p.area ? " · " + esc(p.area) : "") + "</span></div>" +
        (p.notes ? '<div class="lead-meta">' + esc(p.notes.split("\n").slice(-1)[0]) + "</div>" : "") +
        '<div class="lead-actions"><button class="btn" data-pp="open">Open</button></div></article>';
    }).join("") : '<p class="empty">Nothing here yet. Search above and add businesses to your pipeline.</p>';
  }
  $("pipeList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pp]"); if (!b) return;
    var pid = b.closest("[data-pid]").getAttribute("data-pid"); openProspect(prospects.find(function (x) { return x.id === pid; }));
  });
  function waText(name, type) {
    var who = { pg: "residents", coliving: "residents", broker: "clients", property_manager: "tenants", apartments: "residents", builder: "buyers", office: "members", furniture: "customers" }[type] || "customers";
    return "Hi " + (name || "") + ", I'm Azhar from PackZen (packzenblr.in), a Bangalore packers & movers and home-services company. Many of your " + who + " move in and out — we'd love to help them with fixed, upfront prices, and we pay ₹300 for every completed booking you refer. Can I share details? You can see us here: https://packzenblr.in/business.html";
  }
  function openProspect(p) {
    var card = $("sheetCard"); $("sheet").hidden = false;
    card.innerHTML = '<button class="x" aria-label="Close">×</button><p class="empty">Loading live details…</p>';
    card.querySelector(".x").onclick = function () { $("sheet").hidden = true; };
    call({ op: "details", placeId: p.placeId || p.id }).then(function (d) {
      var phone = (d.intlPhone || d.phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
      card.innerHTML = '<button class="x" aria-label="Close">×</button><h2 id="sTitle">' + esc(d.name) + '</h2><p class="meta">' + esc(d.address) + (d.rating ? "<br>★ " + d.rating + " (" + d.reviews + " reviews)" : "") + "</p>" +
        '<div class="lead-actions">' + (phone ? '<a class="btn call" href="tel:+' + esc(phone) + '">Call</a><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(phone) + "?text=" + encodeURIComponent(waText(d.name, p.type)) + '">WhatsApp</a>' : '<span class="lead-meta">No public phone listed</span>') +
        (d.website ? '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(d.website) + '">Website</a>' : "") + (d.maps ? '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(d.maps) + '">Maps</a>' : "") + "</div>" +
        (p.status ? '<div class="status-row" style="margin-top:12px">' + Object.keys(STATUS).map(function (s) { return '<button class="chip' + (p.status === s ? " on" : "") + '" data-ps="' + s + '">' + STATUS[s] + "</button>"; }).join("") + "</div>" +
          '<label>Add a note<textarea id="pNote" rows="2" placeholder="Spoke to owner, 40 rooms, wants a call back Monday"></textarea></label><button class="btn" id="pSave">Save note</button>' +
          (p.notes ? '<pre class="notes">' + esc(p.notes) + "</pre>" : "") : '<p class="hint" style="margin-top:12px">Add it to your pipeline to track status and notes.</p>');
      card.querySelector(".x").onclick = function () { $("sheet").hidden = true; };
      card.querySelectorAll("[data-ps]").forEach(function (b) { b.onclick = function () { db().collection("prospects").doc(p.id).update({ status: b.getAttribute("data-ps"), updatedAtMs: Date.now() }).then(function () { toast("Saved"); $("sheet").hidden = true; }); }; });
      var sv = $("pSave"); if (sv) sv.onclick = function () {
        var n = $("pNote").value.trim(); if (!n) return;
        db().collection("prospects").doc(p.id).update({ notes: ((p.notes ? p.notes + "\n" : "") + "[" + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + "] " + n).slice(-2000), updatedAtMs: Date.now() }).then(function () { toast("Saved"); $("sheet").hidden = true; });
      };
    }).catch(function (e) { card.innerHTML = '<button class="x" aria-label="Close">×</button><p class="empty">Could not load details: ' + esc(e.message) + "</p>"; card.querySelector(".x").onclick = function () { $("sheet").hidden = true; }; });
  }
})();
