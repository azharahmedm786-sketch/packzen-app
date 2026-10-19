/* PackZen Leads — separate lead-handling app (admins only).
 * Hot leads first, one-tap call/WhatsApp, quick status, follow-ups, quality report.
 * Data: Firestore `leads` (scored by the onLeadScore Cloud Function). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var leads = [], tier = "open", firstLoad = true, soundOn = localStorage.getItem("pzl_sound") !== "off", unsub = null;
  var SVC = { move: "Shifting", vehicle: "Vehicle", parcel: "Parcel", ac: "AC", electrician: "Electrician", plumber: "Plumber", carpenter: "Carpenter", tv: "TV mount", business: "Business", estimate: "Photo quote", other: "Other" };
  var WHEN = { this_week: "This week", two_weeks: "≤ 2 weeks", this_month: "This month", later: "Later", just_checking: "Just checking" };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function ago(ms) { if (!ms) return ""; var m = Math.round((Date.now() - ms) / 60000); if (m < 1) return "now"; if (m < 60) return m + "m"; var h = Math.round(m / 60); if (h < 48) return h + "h"; return Math.round(h / 24) + "d"; }
  function tierOf(l) { return l.tierManual || l.tier || "unscored"; }
  function isOpen(l) { return ["new", "contacted", "quoted"].indexOf(l.status || "new") >= 0; }
  function db() { return window._firebase.db; }
  function me() { return (window._firebase.auth.currentUser || {}).email || "admin"; }
  function update(id, patch, msg) {
    patch.updatedAtMs = Date.now();
    return db().collection("leads").doc(id).update(patch).then(function () { if (msg) toast(msg); }).catch(function (e) { toast("Could not save: " + e.message); });
  }
  function history(status) { return firebase.firestore.FieldValue.arrayUnion({ at: Date.now(), status: status, by: me() }); }
  var tt; function toast(t) { var el = $("toast"); if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove("on"); }, 2200); }
  function beep() {
    if (!soundOn) return;
    try { var c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); setTimeout(function () { o.frequency.value = 1320; }, 140); setTimeout(function () { o.stop(); c.close(); }, 320); } catch (e) {}
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  /* ---------- auth ---------- */
  function showLogin(msg) { $("app").hidden = true; $("login").hidden = false; $("lErr").textContent = msg || ""; }
  $("lBtn").addEventListener("click", function () {
    $("lErr").textContent = ""; $("lBtn").disabled = true;
    window._firebase.auth.signInWithEmailAndPassword($("lEmail").value.trim(), $("lPass").value)
      .catch(function () { $("lErr").textContent = "Wrong email or password."; }).finally(function () { $("lBtn").disabled = false; });
  });
  $("outBtn").addEventListener("click", function () { window._firebase.auth.signOut(); });
  $("soundBtn").addEventListener("click", function () { soundOn = !soundOn; localStorage.setItem("pzl_sound", soundOn ? "on" : "off"); $("soundBtn").textContent = soundOn ? "🔔" : "🔕"; toast(soundOn ? "Hot-lead alert sound on" : "Sound off"); if (soundOn) beep(); });
  $("soundBtn").textContent = soundOn ? "🔔" : "🔕";

  window._firebase.auth.onAuthStateChanged(function (u) {
    if (unsub) { unsub(); unsub = null; }
    if (!u) return showLogin();
    db().collection("users").doc(u.uid).get().then(function (d) {
      if (!d.exists || d.data().role !== "admin") { window._firebase.auth.signOut(); return showLogin("This app is for PackZen admins only."); }
      $("login").hidden = true; $("app").hidden = false; start();
    }).catch(function () { showLogin("Could not check your access. Try again."); });
  });

  /* ---------- data ---------- */
  function start() {
    firstLoad = true;
    unsub = db().collection("leads").orderBy("createdAtMs", "desc").limit(800).onSnapshot(function (snap) {
      var before = {}; leads.forEach(function (l) { before[l.id] = l.tier; });
      leads = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      if (!firstLoad && leads.some(function (l) { return l.tier === "hot" && before[l.id] !== "hot" && isOpen(l); })) { beep(); toast("🔥 New hot lead"); }
      firstLoad = false; $("liveDot").classList.add("on"); render();
    }, function (e) { $("liveDot").classList.remove("on"); toast("Connection problem: " + e.message); });
  }

  /* ---------- views ---------- */
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.toggle("active", x === b); });
      document.querySelectorAll(".pane").forEach(function (p) { p.hidden = p.id !== b.getAttribute("data-tab"); });
      render();
    });
  });
  $("tierSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; tier = b.getAttribute("data-tier");
    Array.prototype.forEach.call($("tierSeg").children, function (x) { x.classList.toggle("on", x === b); }); render();
  });
  $("q").addEventListener("input", render);

  var RANK = { hot: 0, warm: 1, unscored: 2, cold: 3, junk: 4 };
  function card(l) {
    var t = tierOf(l), late = (l.status || "new") === "new" && Date.now() - (l.createdAtMs || 0) > 10 * 60000;
    var wa = "https://wa.me/91" + esc(l.phone) + "?text=" + encodeURIComponent("Hi " + (l.name || "") + ", this is PackZen about your " + (l.serviceLabel || "enquiry") + ".");
    return '<article class="lead t-' + t + '" data-id="' + l.id + '">' +
      '<div class="lead-top"><span class="badge b-' + t + '">' + (t === "hot" ? "🔥 HOT" : t.toUpperCase()) + (l.score != null ? " · " + l.score : "") + '</span>' +
      '<span class="age' + (late ? " late" : "") + '">' + (late ? "waiting " : "") + ago(l.createdAtMs) + '</span></div>' +
      '<div class="lead-name">' + esc(l.name || "—") + ' <span class="svc">' + esc(SVC[l.service] || l.serviceLabel || "") + (l.homeSize ? " · " + esc(l.homeSize.toUpperCase()) : "") + '</span></div>' +
      '<div class="lead-meta">' + esc(l.area || "No area") + ' · ' + esc(WHEN[l.when] || l.date || "No date") + ' · ' + esc(l.channel || l.source || "direct") + '</div>' +
      '<div class="lead-status">Status: <b>' + esc(l.status || "new") + '</b>' + (l.followUpAt ? ' · follow-up ' + new Date(l.followUpAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "") + '</div>' +
      '<div class="lead-actions"><a class="btn call" href="tel:' + esc(l.phone) + '" data-act="call">Call</a><a class="btn wa" target="_blank" rel="noopener" href="' + wa + '" data-act="wa">WhatsApp</a><button class="btn ghost" data-act="open">Details</button></div>' +
      '</article>';
  }
  function render() {
    var q = ($("q").value || "").toLowerCase().trim();
    var rows = leads.filter(function (l) {
      var t = tierOf(l);
      if (tier === "open" && (!isOpen(l) || t === "junk")) return false;
      if (["hot", "warm", "cold", "junk"].indexOf(tier) >= 0 && t !== tier) return false;
      if (q && ((l.name || "") + " " + (l.phone || "") + " " + (l.area || "")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (RANK[tierOf(a)] - RANK[tierOf(b)]) || ((b.score || 0) - (a.score || 0)) || ((b.createdAtMs || 0) - (a.createdAtMs || 0)); });
    var openHot = leads.filter(function (l) { return tierOf(l) === "hot" && isOpen(l); }).length;
    var waiting = leads.filter(function (l) { return (l.status || "new") === "new" && tierOf(l) !== "junk" && Date.now() - (l.createdAtMs || 0) > 10 * 60000; }).length;
    var d30 = leads.filter(function (l) { return (l.createdAtMs || 0) > Date.now() - 30 * 86400e3; });
    var booked = d30.filter(function (l) { return l.status === "booked"; }).length;
    var real = d30.filter(function (l) { return tierOf(l) !== "junk"; }).length;
    $("kpis").innerHTML = [["🔥 Hot open", openHot], ["Waiting >10m", waiting], ["Real leads (30d)", real], ["Booked (30d)", booked], ["Conversion", real ? Math.round(booked * 100 / real) + "%" : "—"]]
      .map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join("");
    $("list").innerHTML = rows.length ? rows.map(card).join("") : '<p class="empty">No leads here.</p>';
    var due = leads.filter(function (l) { return l.followUpAt && isOpen(l) && l.followUpAt <= Date.now() + 86400e3; }).sort(function (a, b) { return a.followUpAt - b.followUpAt; });
    $("fuList").innerHTML = due.length ? due.map(card).join("") : '<p class="empty">No follow-ups due today. Set one from a lead\'s Details.</p>';
    renderReport();
  }
  function renderReport() {
    var since = Date.now() - 30 * 86400e3, by = {};
    leads.filter(function (l) { return (l.createdAtMs || 0) >= since; }).forEach(function (l) {
      var c = l.channel || l.source || "direct", r = by[c] = by[c] || { n: 0, hot: 0, junk: 0, booked: 0, value: 0 };
      r.n++; if (tierOf(l) === "hot") r.hot++; if (tierOf(l) === "junk") r.junk++; if (l.status === "booked") { r.booked++; r.value += Number(l.bookedValue) || 0; }
    });
    var keys = Object.keys(by).sort(function (a, b) { return by[b].booked - by[a].booked || by[b].hot - by[a].hot; });
    var pct = function (a, b) { return b ? Math.round(a * 100 / b) + "%" : "—"; };
    $("rep").innerHTML = '<p class="hint">Last 30 days by source. Spend more where <b>Hot %</b> and <b>Booked</b> are high; cut sources with high <b>Junk %</b>.</p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>Source</th><th>Leads</th><th>Hot %</th><th>Junk %</th><th>Booked</th><th>Conv.</th><th>Value</th></tr></thead><tbody>' +
      (keys.length ? keys.map(function (k) { var r = by[k]; return "<tr><td>" + esc(k) + "</td><td>" + r.n + "</td><td>" + pct(r.hot, r.n) + "</td><td>" + pct(r.junk, r.n) + "</td><td>" + r.booked + "</td><td>" + pct(r.booked, r.n - r.junk) + "</td><td>₹" + r.value.toLocaleString("en-IN") + "</td></tr>"; }).join("") : '<tr><td colspan="7">No leads in the last 30 days.</td></tr>') +
      "</tbody></table></div>";
  }

  /* ---------- actions ---------- */
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-act]"); if (!a) return;
    var el = a.closest(".lead"), l = el && leads.find(function (x) { return x.id === el.getAttribute("data-id"); });
    if (!l) return;
    var act = a.getAttribute("data-act");
    if ((act === "call" || act === "wa") && (l.status || "new") === "new") update(l.id, { status: "contacted", firstContactAtMs: Date.now(), history: history("contacted") });
    if (act === "open") openSheet(l);
  });
  function openSheet(l) {
    var t = tierOf(l);
    $("sheetCard").innerHTML = '<button class="x" aria-label="Close">×</button>' +
      '<h2 id="sTitle">' + esc(l.name) + ' <span class="badge b-' + t + '">' + t.toUpperCase() + (l.score != null ? " · " + l.score : "") + '</span></h2>' +
      '<p class="meta"><a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a> · ' + esc(l.serviceLabel || l.service || "") + (l.homeSize ? " · " + esc(l.homeSize.toUpperCase()) : "") + '<br>' + esc(l.area || "No area") + ' · ' + esc(WHEN[l.when] || l.date || "No date") + ' · source ' + esc(l.channel || l.source || "direct") + '</p>' +
      (l.scoreReasons ? '<details><summary>Why this score</summary><ul>' + l.scoreReasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul></details>" : "") +
      '<div class="status-row">' + ["contacted", "quoted", "booked", "lost"].map(function (s) { return '<button class="chip' + (l.status === s ? " on" : "") + '" data-st="' + s + '">' + s + "</button>"; }).join("") + "</div>" +
      '<label>Follow-up on<input type="date" id="fuDate" value="' + (l.followUpAt ? new Date(l.followUpAt + 5.5 * 3600e3).toISOString().slice(0, 10) : "") + '"></label>' +
      '<label>Add a note<textarea id="noteTxt" rows="2" placeholder="Spoke to customer, wants Sunday slot…"></textarea></label>' +
      '<div class="row"><button class="btn" id="saveSheet">Save</button>' + (t !== "junk" ? '<button class="btn ghost" id="junkBtn">Mark as junk</button>' : "") + "</div>" +
      (l.notes ? '<pre class="notes">' + esc(l.notes) + "</pre>" : "");
    $("sheet").hidden = false;
    var card = $("sheetCard");
    card.querySelector(".x").onclick = closeSheet;
    card.querySelectorAll("[data-st]").forEach(function (b) {
      b.onclick = function () {
        var s = b.getAttribute("data-st"), extra = { status: s, history: history(s) };
        if (s === "lost") { var why = prompt("Why was it lost? (price, date, no answer, went elsewhere…)", ""); if (why === null) return; extra.lostReason = why.slice(0, 200); }
        if (s === "quoted") { var amt = prompt("Quoted amount (₹)", ""); if (amt === null) return; extra.quotedAmount = Math.round(Number(amt)) || null; }
        if (s === "booked") { var val = prompt("Booking value (₹)", String(l.quotedAmount || "")); if (val === null) return; extra.bookedValue = Math.round(Number(val)) || 0; extra.bookedAtMs = Date.now(); }
        update(l.id, extra, "Saved: " + s).then(closeSheet);
      };
    });
    $("saveSheet").onclick = function () {
      var patch = {}, d = $("fuDate").value, n = $("noteTxt").value.trim();
      if (d) patch.followUpAt = Date.parse(d + "T10:00:00+05:30");
      if (n) patch.notes = ((l.notes ? l.notes + "\n" : "") + "[" + new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + "] " + n).slice(-3000);
      if (!Object.keys(patch).length) return closeSheet();
      update(l.id, patch, "Saved").then(closeSheet);
    };
    if ($("junkBtn")) $("junkBtn").onclick = function () { update(l.id, { status: "lost", lostReason: "junk", tierManual: "junk", history: history("lost") }, "Marked as junk").then(closeSheet); };
  }
  function closeSheet() { $("sheet").hidden = true; }
  $("sheet").addEventListener("click", function (e) { if (e.target === $("sheet")) closeSheet(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
})();
