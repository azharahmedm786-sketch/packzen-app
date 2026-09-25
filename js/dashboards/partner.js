/* ===================================================================
   PACKZEN PARTNER PORTAL — partner.js
   Shared logic for every logged-in partner page.
   Requires: firebase-app/auth/firestore-compat, env-config.js,
             firebase-config.js (exposes window._firebase = {auth, db})
   Optional: firebase-storage-compat.js on pages that upload files.
   =================================================================== */

/* -------------------- small utilities -------------------- */
function showToast(msg, dur) {
  dur = dur || 3000;
  let t = document.getElementById("toastMsg");
  if (!t) {
    t = document.createElement("div");
    t.id = "toastMsg";
    t.className = "toast-msg";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(function () { t.classList.remove("show"); }, dur);
}

function pzMoney(n) {
  n = Number(n) || 0;
  return "\u20B9" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function pzDate(ts, opts) {
  if (!ts) return "--";
  var d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-IN", opts || { day: "numeric", month: "short", year: "numeric" });
}

function pzTime(ts) {
  if (!ts) return "";
  var d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function pzEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) { btn.classList.add("btn-loading"); btn.disabled = true; }
  else { btn.classList.remove("btn-loading"); btn.disabled = false; }
}

/* -------------------- firebase readiness -------------------- */
function waitFB(cb, retry) {
  retry = retry || 0;
  if (window._firebase && window._firebase.auth && window._firebase.db) { cb(); return; }
  if (retry > 50) { console.error("Firebase failed to initialise"); return; }
  setTimeout(function () { waitFB(cb, retry + 1); }, 150);
}

var PZ = { uid: null, user: null, partner: null, unsub: [] };

function pzTrackUnsub(fn) { if (typeof fn === "function") PZ.unsub.push(fn); }
function pzClearListeners() { PZ.unsub.forEach(function (u) { try { u(); } catch (e) {} }); PZ.unsub = []; }

/* Redirect helper that preserves intent */
function goLogin() {
  window.location.href = "partner-login.html";
}

/* Core guard: every authenticated page calls this once on load.
   Ensures user is logged in AND status === approved, otherwise redirects. */
function requirePartner(onReady) {
  waitFB(function () {
    window._firebase.auth.onAuthStateChanged(function (user) {
      if (!user) { goLogin(); return; }
      window._firebase.db.collection("partners").doc(user.uid).get()
        .then(function (doc) {
          if (!doc.exists) {
            window._firebase.auth.signOut();
            showToast("Partner profile not found. Please contact support.");
            goLogin();
            return;
          }
          var data = doc.data();
          if (data.verificationStatus === "pending") {
            window.location.href = "registration-success.html?status=pending";
            return;
          }
          if (data.verificationStatus === "rejected") {
            window.location.href = "registration-success.html?status=rejected";
            return;
          }
          PZ.uid = user.uid;
          PZ.user = user;
          PZ.partner = data;
          renderShell(data);
          if (typeof onReady === "function") onReady(data);
        })
        .catch(function (err) {
          console.error(err);
          showToast("⚠️ Couldn't load your account. Please try again.");
        });
    });
  });
}

/* -------------------- shell (sidebar + topbar + bottom nav) -------------------- */
var NAV_ITEMS = [
  { page: "dashboard", href: "partner-dashboard.html", label: "Dashboard", icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  { page: "bookings", href: "partner-bookings.html", label: "Bookings", icon: "M20 7h-3V6a3 3 0 0 0-3-3H10a3 3 0 0 0-3 3v1H4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a1 1 0 0 0-1-1z" },
  { page: "wallet", href: "partner-wallet.html", label: "Wallet", icon: "M21 4H3a1 1 0 0 0-1 1v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a1 1 0 0 0-1-1zM3 9h18" },
  { page: "vehicles", href: "partner-vehicles.html", label: "Vehicles", icon: "M3 13l2-6h10l3 6M5 13h14v5H5zM7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" },
  { page: "drivers", href: "partner-drivers.html", label: "Drivers", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { page: "notifications", href: "partner-notifications.html", label: "Notifications", icon: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" },
  { page: "profile", href: "partner-profile.html", label: "Profile", icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  { page: "support", href: "partner-support.html", label: "Support", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 17h.01" },
  { page: "settings", href: "partner-settings.html", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.5.62 1.51.7" }
];
var BOTTOM_PAGES = ["dashboard", "bookings", "wallet", "notifications", "profile"];

function svgIcon(path, size) {
  size = size || 20;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    path.split("M").filter(Boolean).map(function (p) { return '<path d="M' + p.trim() + '"/>'; }).join("") + '</svg>';
}

function renderShell(partnerData) {
  var shell = document.getElementById("portalShell");
  if (!shell) return;
  var page = document.body.dataset.page || "";
  var initials = (partnerData.businessName || partnerData.ownerName || "P").trim().charAt(0).toUpperCase();

  var sideLinks = NAV_ITEMS.map(function (item) {
    return '<a href="' + item.href + '" class="portal-nav-link' + (item.page === page ? " active" : "") + '">' +
      svgIcon(item.icon, 19) + '<span>' + item.label + '</span></a>';
  }).join("");

  var bottomLinks = BOTTOM_PAGES.map(function (p) {
    var item = NAV_ITEMS.filter(function (i) { return i.page === p; })[0];
    return '<a href="' + item.href + '" class="pnav-item' + (item.page === page ? " active" : "") + '">' +
      svgIcon(item.icon, 21) + '<span>' + item.label + '</span></a>';
  }).join("");

  shell.innerHTML =
    '<div class="portal-sidebar-overlay" id="sidebarOverlay"></div>' +
    '<aside class="portal-sidebar" id="portalSidebar">' +
      '<div class="portal-sidebar-logo">' +
        '<img src="../../assets/logo/packzen-logo.png" alt="PackZen"><span>PackZen Partner</span>' +
      '</div>' +
      '<nav class="portal-nav">' + sideLinks + '<div class="portal-nav-divider"></div>' +
        '<a href="#" class="portal-nav-link" id="sidebarLogout">' + svgIcon("9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9", 19) + '<span>Log Out</span></a>' +
      '</nav>' +
    '</aside>' +
    '<div class="portal-main">' +
      '<header class="portal-topbar">' +
        '<div class="portal-topbar-left">' +
          '<button class="portal-menu-btn" id="menuToggleBtn" aria-label="Menu">' + svgIcon("3 12h18M3 6h18M3 18h18", 20) + '</button>' +
          '<div class="portal-page-title" id="pageTitleText"></div>' +
        '</div>' +
        '<div class="portal-topbar-right">' +
          '<div class="online-toggle-wrap">' +
            '<span class="online-toggle-label" id="onlineLabel">' + (partnerData.online ? "Online" : "Offline") + '</span>' +
            '<button class="online-toggle' + (partnerData.online ? " on" : "") + '" id="topbarOnlineToggle" aria-label="Toggle availability"></button>' +
          '</div>' +
          '<a href="partner-notifications.html" class="portal-icon-btn" aria-label="Notifications">' + svgIcon("18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0", 19) + '<span class="portal-notif-dot" id="notifDot"></span></a>' +
          '<a href="partner-profile.html" class="portal-avatar-btn" aria-label="Profile"><span class="portal-avatar">' + initials + '</span></a>' +
        '</div>' +
      '</header>' +
      '<main class="portal-content" id="portalContent"></main>' +
    '</div>' +
    '<nav class="portal-bottom-nav">' + bottomLinks + '</nav>';

  var titleMap = { dashboard: "Dashboard", bookings: "My Bookings", "booking-details": "Booking Details", wallet: "Wallet", vehicles: "My Vehicles", drivers: "My Drivers", notifications: "Notifications", profile: "My Profile", support: "Help & Support", settings: "Settings" };
  qs("#pageTitleText").textContent = titleMap[page] || "PackZen Partner";

  qs("#menuToggleBtn").addEventListener("click", function () {
    qs("#portalSidebar").classList.add("open");
    qs("#sidebarOverlay").classList.add("show");
  });
  qs("#sidebarOverlay").addEventListener("click", function () {
    qs("#portalSidebar").classList.remove("open");
    qs("#sidebarOverlay").classList.remove("show");
  });
  qs("#sidebarLogout").addEventListener("click", function (e) { e.preventDefault(); doLogout(); });
  qs("#topbarOnlineToggle").addEventListener("click", toggleOnlineStatus);

  listenUnreadNotifications();
}

function toggleOnlineStatus() {
  if (!PZ.uid) return;
  var newVal = !PZ.partner.online;
  window._firebase.db.collection("partners").doc(PZ.uid).update({ online: newVal })
    .then(function () {
      PZ.partner.online = newVal;
      qsa("#topbarOnlineToggle, #settingsOnlineToggle").forEach(function (b) { if (b) b.classList.toggle("on", newVal); });
      var lbl = qs("#onlineLabel"); if (lbl) lbl.textContent = newVal ? "Online" : "Offline";
      showToast(newVal ? "🟢 You're online — receiving bookings" : "⚪ You're offline");
    })
    .catch(function () { showToast("⚠️ Couldn't update status"); });
}

function doLogout() {
  pzClearListeners();
  window._firebase.auth.signOut().then(function () {
    try { localStorage.removeItem("pzPartnerRemember"); } catch (e) {}
    window.location.href = "partner-login.html";
  });
}

function listenUnreadNotifications() {
  if (!PZ.uid) return;
  var unsub = window._firebase.db.collection("partners").doc(PZ.uid).collection("notifications")
    .where("read", "==", false).limit(1)
    .onSnapshot(function (snap) {
      var dot = qs("#notifDot");
      if (dot) dot.classList.toggle("show", !snap.empty);
    }, function () {});
  pzTrackUnsub(unsub);
}

/* ===================================================================
   PAGE: LOGIN  (partner-login.html)
   =================================================================== */
function initLoginPage() {
  waitFB(function () {
    try {
      var remembered = localStorage.getItem("pzPartnerRemember");
      if (remembered) { qs("#loginEmail").value = remembered; qs("#rememberMe").checked = true; }
    } catch (e) {}

    window._firebase.auth.onAuthStateChanged(function (user) {
      if (!user) return;
      window._firebase.db.collection("partners").doc(user.uid).get().then(function (doc) {
        if (!doc.exists) return;
        var status = doc.data().verificationStatus;
        if (status === "approved") window.location.href = "partner-dashboard.html";
        else if (status === "pending") window.location.href = "registration-success.html?status=pending";
        else if (status === "rejected") window.location.href = "registration-success.html?status=rejected";
      });
    });

    qs("#loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = qs("#loginEmail").value.trim();
      var pass = qs("#loginPassword").value;
      var errBox = qs("#loginError");
      errBox.classList.remove("show");
      if (!email || !pass) { errBox.textContent = "Please enter your email and password."; errBox.classList.add("show"); return; }

      var btn = qs("#loginSubmitBtn");
      setBtnLoading(btn, true);
      var persistence = qs("#rememberMe").checked ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;

      window._firebase.auth.setPersistence(persistence)
        .then(function () { return window._firebase.auth.signInWithEmailAndPassword(email, pass); })
        .then(function (cred) {
          try {
            if (qs("#rememberMe").checked) localStorage.setItem("pzPartnerRemember", email);
            else localStorage.removeItem("pzPartnerRemember");
          } catch (er) {}
          return window._firebase.db.collection("partners").doc(cred.user.uid).get();
        })
        .then(function (doc) {
          setBtnLoading(btn, false);
          if (!doc.exists) {
            errBox.textContent = "No partner account found for this login. Please register first.";
            errBox.classList.add("show");
            window._firebase.auth.signOut();
            return;
          }
          var status = doc.data().verificationStatus;
          if (status === "approved") window.location.href = "partner-dashboard.html";
          else if (status === "pending") window.location.href = "registration-success.html?status=pending";
          else window.location.href = "registration-success.html?status=rejected";
        })
        .catch(function (err) {
          console.error('Partner Auth Error:', err.code, err.message);
          setBtnLoading(btn, false);
          errBox.textContent = friendlyAuthError(err);
          errBox.classList.add("show");
        });
    });

    qs("#togglePassBtn").addEventListener("click", function () {
      var f = qs("#loginPassword");
      var show = f.type === "password";
      f.type = show ? "text" : "password";
      this.textContent = show ? "🙈" : "👁";
    });
  });
}

function friendlyAuthError(err) {
  var code = err && err.code || "";
  if (code.indexOf("wrong-password") !== -1 || code.indexOf("invalid-credential") !== -1 || code.indexOf("invalid-login-credentials") !== -1) return "Incorrect email or password.";
  if (code.indexOf("user-not-found") !== -1) return "No account found with this email.";
  if (code.indexOf("too-many-requests") !== -1) return "Too many attempts. Please try again later.";
  if (code.indexOf("network-request-failed") !== -1) return "Network error. Check your connection.";
  if (code.indexOf("user-disabled") !== -1) return "This account has been disabled. Contact support.";
  return "Something went wrong. Please try again.";
}

/* ===================================================================
   PAGE: FORGOT PASSWORD  (partner-forgot-password.html)
   =================================================================== */
function initForgotPasswordPage() {
  waitFB(function () {
    qs("#forgotForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = qs("#forgotEmail").value.trim();
      var errBox = qs("#forgotError");
      var okBox = qs("#forgotSuccess");
      errBox.classList.remove("show"); okBox.classList.remove("show");
      if (!email) { errBox.textContent = "Please enter your registered email."; errBox.classList.add("show"); return; }

      var btn = qs("#forgotSubmitBtn");
      setBtnLoading(btn, true);
      window._firebase.auth.sendPasswordResetEmail(email)
        .then(function () {
          setBtnLoading(btn, false);
          okBox.textContent = "Password reset link sent to " + email + ". Check your inbox (and spam folder).";
          okBox.classList.add("show");
          qs("#forgotForm").reset();
        })
        .catch(function (err) {
          setBtnLoading(btn, false);
          errBox.textContent = friendlyAuthError(err);
          errBox.classList.add("show");
        });
    });
  });
}

/* ===================================================================
   PAGE: REGISTRATION SUCCESS / STATUS  (registration-success.html)
   =================================================================== */
function initRegistrationStatusPage() {
  var status = getParam("status") || "pending";
  var icon = qs("#statusIcon"), title = qs("#statusTitle"), sub = qs("#statusSub"), reasonBox = qs("#statusReason");

  function paint(status, reason) {
    if (status === "approved") {
      icon.textContent = "✅"; title.textContent = "You're Approved!";
      sub.textContent = "Your PackZen Partner account is active. You can now access your dashboard and start receiving bookings.";
      qs("#statusPrimaryBtn").href = "partner-dashboard.html";
      qs("#statusPrimaryBtn").textContent = "Go to Dashboard";
    } else if (status === "rejected") {
      icon.textContent = "❌"; title.textContent = "Application Not Approved";
      sub.textContent = "Unfortunately your partner application wasn't approved this time.";
      if (reason) { reasonBox.textContent = "Reason: " + reason; reasonBox.style.display = "block"; }
      qs("#statusPrimaryBtn").href = "https://wa.me/919945095453"; qs("#statusPrimaryBtn").target = "_blank";
      qs("#statusPrimaryBtn").textContent = "Contact Support";
    } else {
      icon.textContent = "⏳"; title.textContent = "Application Under Review";
      sub.textContent = "Thanks for registering! Our team is verifying your documents. This usually takes 24–48 hours. We'll notify you once your account is approved.";
      qs("#statusPrimaryBtn").href = "https://wa.me/919945095453"; qs("#statusPrimaryBtn").target = "_blank";
      qs("#statusPrimaryBtn").textContent = "Chat on WhatsApp";
    }
  }
  paint(status);

  waitFB(function () {
    window._firebase.auth.onAuthStateChanged(function (user) {
      if (!user) return;
      var unsub = window._firebase.db.collection("partners").doc(user.uid)
        .onSnapshot(function (doc) {
          if (!doc.exists) return;
          var data = doc.data();
          paint(data.verificationStatus, data.rejectionReason);
          var url = new URL(window.location.href);
          url.searchParams.set("status", data.verificationStatus);
          window.history.replaceState({}, "", url);
        });
      pzTrackUnsub(unsub);
    });
  });

  qs("#statusLogoutBtn").addEventListener("click", function () {
    waitFB(function () { window._firebase.auth.signOut().then(function () { window.location.href = "partner.html"; }); });
  });
}

/* ===================================================================
   PAGE: DASHBOARD  (partner-dashboard.html)
   =================================================================== */
function initDashboardPage() {
  requirePartner(function (partner) {
    var name = (partner.ownerName || partner.businessName || "Partner").split(" ")[0];
    qs("#portalContent").innerHTML =
      '<h1 style="font-size:1.2rem;font-weight:800;margin:0 0 4px;">Welcome back, ' + pzEsc(name) + ' 👋</h1>' +
      '<p style="color:var(--text-muted);font-size:0.86rem;margin:0 0 18px;">Here\'s how your business is doing today.</p>' +
      '<div class="pstat-grid">' +
        '<div class="pstat-card"><div class="pstat-icon blue">📦</div><div class="pstat-value" id="statTotalJobs">' + (partner.totalJobs || 0) + '</div><div class="pstat-label">Total Jobs</div></div>' +
        '<div class="pstat-card"><div class="pstat-icon green">✅</div><div class="pstat-value" id="statCompletedJobs">' + (partner.completedJobs || 0) + '</div><div class="pstat-label">Completed</div></div>' +
        '<div class="pstat-card"><div class="pstat-icon amber">💰</div><div class="pstat-value" id="statEarnings">' + pzMoney(partner.totalEarnings || 0) + '</div><div class="pstat-label">Total Earnings</div></div>' +
        '<div class="pstat-card"><div class="pstat-icon purple">⭐</div><div class="pstat-value" id="statRating">' + (partner.rating ? partner.rating.toFixed(1) : "New") + '</div><div class="pstat-label">Rating</div></div>' +
      '</div>' +
      '<div class="psection-head"><h2>Recent Bookings <span id="newRequestsBadge" class="pstatus-pill pstatus-offered" style="display:none;margin-left:6px"></span></h2><a href="partner-bookings.html">View all →</a></div>' +
      '<div id="recentBookingsList"><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div></div>';

    var db = window._firebase.db;
    var listEl = qs("#recentBookingsList");
    var unsub = db.collection("bookings")
      .where("assignedPartnerId", "==", PZ.uid)
      .orderBy("createdAt", "desc")
      .limit(5)
      .onSnapshot(function (snap) {
        if (snap.empty) {
          listEl.innerHTML = emptyStateHtml("📦", "No bookings yet", "New booking requests will appear here.");
          return;
        }
        listEl.innerHTML = snap.docs.map(bookingCardHtml).join("");
        attachBookingCardClicks(listEl);
      }, function (err) {
        console.error(err);
        listEl.innerHTML = '<div class="perror-box">Couldn\'t load bookings. Pull to refresh.</div>';
      });
    pzTrackUnsub(unsub);

    var newCountUnsub = db.collection("bookings")
      .where("assignedPartnerId", "==", PZ.uid)
      .where("partnerStatus", "==", "offered")
      .onSnapshot(function (snap) {
        var badge = qs("#newRequestsBadge");
        if (badge) { badge.textContent = snap.size; badge.style.display = snap.size ? "inline-flex" : "none"; }
      });
    pzTrackUnsub(newCountUnsub);
  });
}

function emptyStateHtml(icon, title, sub) {
  return '<div class="pempty"><div class="pempty-icon">' + icon + '</div><div class="pempty-title">' + pzEsc(title) + '</div><div class="pempty-sub">' + pzEsc(sub) + '</div></div>';
}

function statusLabel(status) {
  var map = { offered: "New Request", accepted: "Accepted", arrived: "Arrived", loading: "Loading", in_transit: "In Transit", delivered: "Delivered", completed: "Completed", rejected: "Rejected", cancelled: "Cancelled" };
  return map[status] || status || "Pending";
}

function bookingCardHtml(doc) {
  var b = doc.data();
  var pickup = (b.pickup && b.pickup.address) || b.pickupAddress || b.pickup || "Pickup location";
  var drop = (b.drop && b.drop.address) || b.dropAddress || b.drop || "Drop location";
  var status = b.partnerStatus || "offered";
  return '<div class="pbk-card" data-id="' + doc.id + '">' +
    '<div class="pbk-top"><span class="pbk-id">#' + doc.id.slice(-6).toUpperCase() + '</span>' +
    '<span class="pstatus-pill pstatus-' + status + '">' + statusLabel(status) + '</span></div>' +
    '<div class="pbk-route">' + pzEsc(pickup) + ' → ' + pzEsc(drop) + '</div>' +
    '<div class="pbk-meta">' +
      '<span>📅 ' + pzDate(b.movingDate || b.createdAt) + '</span>' +
      '<span>🚚 ' + pzEsc(b.vehicleType || "Vehicle") + '</span>' +
      '<span class="pbk-fare">' + pzMoney(b.partnerEarnings || b.fare || 0) + '</span>' +
    '</div></div>';
}

function attachBookingCardClicks(container) {
  qsa(".pbk-card", container).forEach(function (card) {
    card.addEventListener("click", function () {
      window.location.href = "partner-booking-details.html?id=" + card.dataset.id;
    });
  });
}

/* ===================================================================
   PAGE: BOOKINGS LIST  (partner-bookings.html)
   =================================================================== */
var BOOKING_TABS = {
  new: ["offered"],
  active: ["accepted", "arrived", "loading", "in_transit", "delivered"],
  completed: ["completed"],
  cancelled: ["rejected", "cancelled"]
};

function initBookingsPage() {
  requirePartner(function () {
    qs("#portalContent").innerHTML =
      '<div class="ptabs">' +
        '<button class="ptab-btn active" data-tab="new">New Requests</button>' +
        '<button class="ptab-btn" data-tab="active">Active</button>' +
        '<button class="ptab-btn" data-tab="completed">Completed</button>' +
        '<button class="ptab-btn" data-tab="cancelled">Cancelled</button>' +
      '</div>' +
      '<div id="bookingsList"><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div></div>';

    var currentTab = "new";
    loadBookingsTab(currentTab);

    qsa(".ptab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        qsa(".ptab-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        currentTab = btn.dataset.tab;
        loadBookingsTab(currentTab);
      });
    });
  });
}

function loadBookingsTab(tab) {
  var listEl = qs("#bookingsList");
  listEl.innerHTML = '<div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div>';
  pzClearBookingsListener();
  var statuses = BOOKING_TABS[tab] || BOOKING_TABS.new;
  var unsub = window._firebase.db.collection("bookings")
    .where("assignedPartnerId", "==", PZ.uid)
    .where("partnerStatus", "in", statuses)
    .orderBy("createdAt", "desc")
    .limit(50)
    .onSnapshot(function (snap) {
      if (snap.empty) {
        listEl.innerHTML = emptyStateHtml("📦", "Nothing here", "Bookings in this category will show up here.");
        return;
      }
      listEl.innerHTML = snap.docs.map(function (doc) { return bookingCardHtmlWithActions(doc, tab); }).join("");
      attachBookingCardClicks(listEl);
      attachQuickActions(listEl);
    }, function (err) {
      console.error(err);
      listEl.innerHTML = '<div class="perror-box">Couldn\'t load bookings.</div>';
    });
  window._pzBookingsUnsub = unsub;
}
function pzClearBookingsListener() { if (window._pzBookingsUnsub) { try { window._pzBookingsUnsub(); } catch (e) {} } }

function bookingCardHtmlWithActions(doc, tab) {
  var base = bookingCardHtml(doc);
  if (tab !== "new") return base;
  return base.replace('</div></div>',
    '</div><div class="pbk-actions">' +
    '<button class="pz-btn pz-btn-outline pz-btn-sm reject-btn" data-id="' + doc.id + '">Reject</button>' +
    '<button class="pz-btn pz-btn-primary pz-btn-sm accept-btn" data-id="' + doc.id + '">Accept</button>' +
    '</div></div>');
}

function attachQuickActions(container) {
  qsa(".accept-btn", container).forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      updateBookingStatus(btn.dataset.id, "accepted", { acceptedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
  });
  qsa(".reject-btn", container).forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!confirm("Reject this booking request?")) return;
      updateBookingStatus(btn.dataset.id, "rejected", { rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), assignedPartnerId: null });
    });
  });
}

function updateBookingStatus(bookingId, newStatus, extra) {
  var payload = Object.assign({ partnerStatus: newStatus }, extra || {});
  return window._firebase.db.collection("bookings").doc(bookingId).update(payload)
    .then(function () { showToast("✅ Booking " + statusLabel(newStatus).toLowerCase()); })
    .catch(function (err) { console.error(err); showToast("⚠️ Couldn't update booking"); });
}

/* ===================================================================
   PAGE: BOOKING DETAILS  (partner-booking-details.html)
   =================================================================== */
var STATUS_FLOW = ["accepted", "arrived", "loading", "in_transit", "delivered", "completed"];

function initBookingDetailsPage() {
  var bookingId = getParam("id");
  if (!bookingId) { window.location.href = "partner-bookings.html"; return; }

  requirePartner(function () {
    var unsub = window._firebase.db.collection("bookings").doc(bookingId)
      .onSnapshot(function (doc) {
        if (!doc.exists) { qs("#portalContent").innerHTML = '<div class="perror-box">Booking not found.</div>'; return; }
        renderBookingDetails(doc);
      }, function (err) {
        console.error(err);
        showToast("⚠️ Couldn't load booking");
      });
    pzTrackUnsub(unsub);
  });
}

function renderBookingDetails(doc) {
  var b = doc.data();
  var status = b.partnerStatus || "offered";
  var pickup = (b.pickup && b.pickup.address) || b.pickupAddress || b.pickup || "Pickup location";
  var drop = (b.drop && b.drop.address) || b.dropAddress || b.drop || "Drop location";
  var content = qs("#portalContent");

  var actionsHtml = "";
  if (status === "offered") {
    actionsHtml = '<div class="pbk-actions"><button class="pz-btn pz-btn-outline btn-block" id="dtlRejectBtn">Reject</button><button class="pz-btn pz-btn-primary btn-block" id="dtlAcceptBtn">Accept Booking</button></div>';
  } else {
    var idx = STATUS_FLOW.indexOf(status);
    if (idx > -1 && idx < STATUS_FLOW.length - 1) {
      var nextStatus = STATUS_FLOW[idx + 1];
      if (nextStatus === "in_transit" && status === "loading") {
        actionsHtml = '<button class="pz-btn pz-btn-primary btn-block" id="dtlNextBtn" data-next="in_transit">Start Transit</button>';
      } else if (nextStatus === "completed") {
        actionsHtml = '<button class="pz-btn pz-btn-primary btn-block" id="dtlOtpBtn">Verify OTP & Complete</button>';
      } else {
        actionsHtml = '<button class="pz-btn pz-btn-primary btn-block" id="dtlNextBtn" data-next="' + nextStatus + '">Mark as ' + statusLabel(nextStatus) + '</button>';
      }
    } else if (status === "completed") {
      actionsHtml = '<div class="pempty-sub" style="text-align:center;padding:8px 0;">✅ Job completed</div>';
    } else {
      actionsHtml = '<div class="pempty-sub" style="text-align:center;padding:8px 0;">This booking is ' + statusLabel(status).toLowerCase() + '.</div>';
    }
  }

  content.innerHTML =
    '<div class="pdetail-hero">' +
      '<div class="pbk-top"><span class="pbk-id">Booking #' + doc.id.slice(-6).toUpperCase() + '</span><span class="pstatus-pill pstatus-' + status + '">' + statusLabel(status) + '</span></div>' +
      '<div class="pdetail-route-row">' +
        '<div class="pdetail-dots"><div class="pdetail-dot"></div><div class="pdetail-dot-line"></div><div class="pdetail-dot end"></div></div>' +
        '<div style="flex:1">' +
          '<div class="pdetail-addr-label">Pickup</div><div class="pdetail-addr-text">' + pzEsc(pickup) + '</div>' +
          '<div class="pdetail-addr-label">Drop</div><div class="pdetail-addr-text" style="margin-bottom:0">' + pzEsc(drop) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pdetail-grid">' +
        '<div class="pdetail-kv"><div class="pdetail-kv-label">Date</div><div class="pdetail-kv-value">' + pzDate(b.movingDate || b.createdAt) + '</div></div>' +
        '<div class="pdetail-kv"><div class="pdetail-kv-label">Vehicle</div><div class="pdetail-kv-value">' + pzEsc(b.vehicleType || "—") + '</div></div>' +
        '<div class="pdetail-kv"><div class="pdetail-kv-label">Customer</div><div class="pdetail-kv-value">' + pzEsc(b.customerName || "Customer") + '</div></div>' +
        '<div class="pdetail-kv"><div class="pdetail-kv-label">You Earn</div><div class="pdetail-kv-value">' + pzMoney(b.partnerEarnings || 0) + '</div></div>' +
      '</div>' +
    '</div>' +
    (b.customerPhone ? '<a href="tel:' + b.customerPhone + '" class="pz-btn pz-btn-outline btn-block" style="margin-bottom:16px">📞 Call Customer</a>' : "") +
    '<div class="pform-card"><h3>Job Status</h3>' + timelineHtml(status) + '</div>' +
    '<div id="otpSection"></div>' +
    '<div style="margin-top:16px">' + actionsHtml + '</div>';

  qs("#dtlAcceptBtn") && qs("#dtlAcceptBtn").addEventListener("click", function () {
    setBtnLoading(this, true);
    updateBookingStatus(doc.id, "accepted", { acceptedAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
  qs("#dtlRejectBtn") && qs("#dtlRejectBtn").addEventListener("click", function () {
    if (!confirm("Reject this booking request?")) return;
    updateBookingStatus(doc.id, "rejected", { rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), assignedPartnerId: null });
  });
  qs("#dtlNextBtn") && qs("#dtlNextBtn").addEventListener("click", function () {
    var next = this.dataset.next;
    setBtnLoading(this, true);
    var extra = {};
    extra[next + "At"] = firebase.firestore.FieldValue.serverTimestamp();
    if (next === "loading") { extra.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000)); }
    updateBookingStatus(doc.id, next, extra);
  });
  qs("#dtlOtpBtn") && qs("#dtlOtpBtn").addEventListener("click", function () { showOtpEntry(doc.id, b.deliveryOtp); });
}

function timelineHtml(currentStatus) {
  var idx = STATUS_FLOW.indexOf(currentStatus);
  if (currentStatus === "rejected" || currentStatus === "cancelled") idx = -2;
  return '<ul class="ptimeline">' + STATUS_FLOW.map(function (s, i) {
    var done = idx >= i;
    return '<li class="' + (done ? "done" : "") + '"><div class="ptl-dot">' + (done ? "✓" : "") + '</div><div><div class="ptl-title">' + statusLabel(s) + '</div></div></li>';
  }).join("") + '</ul>';
}

function showOtpEntry(bookingId, correctOtp) {
  var section = qs("#otpSection");
  section.innerHTML = '<div class="pform-card"><h3>Enter Delivery OTP</h3><p class="pempty-sub" style="margin-bottom:10px">Ask the customer for the 4-digit OTP to confirm delivery completion.</p>' +
    '<div class="potp-box">' +
    [0, 1, 2, 3].map(function (i) { return '<input type="tel" maxlength="1" class="otp-digit" data-i="' + i + '">'; }).join("") +
    '</div><div id="otpError" class="auth-error-box"></div>' +
    '<button class="pz-btn pz-btn-primary btn-block" id="otpConfirmBtn">Confirm Delivery</button></div>';
  section.scrollIntoView({ behavior: "smooth", block: "center" });

  var digits = qsa(".otp-digit", section);
  digits.forEach(function (inp, i) {
    inp.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 1);
      if (this.value && digits[i + 1]) digits[i + 1].focus();
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !this.value && digits[i - 1]) digits[i - 1].focus();
    });
  });

  qs("#otpConfirmBtn").addEventListener("click", function () {
    var entered = digits.map(function (d) { return d.value; }).join("");
    var errBox = qs("#otpError");
    if (entered.length !== 4) { errBox.textContent = "Enter all 4 digits."; errBox.classList.add("show"); return; }
    if (correctOtp && entered !== String(correctOtp)) { errBox.textContent = "Incorrect OTP. Please check with the customer."; errBox.classList.add("show"); return; }
    setBtnLoading(this, true);
    updateBookingStatus(bookingId, "completed", { completedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(function () {
        return window._firebase.db.collection("partners").doc(PZ.uid).update({
          totalJobs: firebase.firestore.FieldValue.increment(1),
          completedJobs: firebase.firestore.FieldValue.increment(1)
        });
      });
  });
}

/* ===================================================================
   PAGE: PROFILE  (partner-profile.html)
   =================================================================== */
function initProfilePage() {
  requirePartner(function (partner) {
    var bd = partner.bankDetails || {};
    var verified = partner.verificationStatus === "approved";
    qs("#portalContent").innerHTML =
      '<div class="pform-card">' +
        '<h3>Business Details</h3>' +
        '<form id="profileForm" class="pform-row two-col">' +
          '<div><label class="field-label">Business Name</label><input id="pfBusinessName" class="field-input" value="' + pzEsc(partner.businessName) + '" required></div>' +
          '<div><label class="field-label">Owner Name</label><input id="pfOwnerName" class="field-input" value="' + pzEsc(partner.ownerName) + '" required></div>' +
          '<div><label class="field-label">Phone</label><input id="pfPhone" class="field-input" value="' + pzEsc(partner.phone) + '" required></div>' +
          '<div><label class="field-label">Email</label><input id="pfEmail" class="field-input" value="' + pzEsc(partner.email || PZ.user.email) + '" disabled></div>' +
          '<div><label class="field-label">City</label><input id="pfCity" class="field-input" value="' + pzEsc(partner.city) + '"></div>' +
          '<div style="grid-column:1/-1"><label class="field-label">Address</label><input id="pfAddress" class="field-input" value="' + pzEsc(partner.address) + '"></div>' +
        '</form>' +
      '</div>' +
      '<div class="pform-card">' +
        '<h3>Bank / UPI Details</h3>' +
        '<div class="pform-row two-col">' +
          '<div><label class="field-label">Account Holder</label><input id="pfBankHolder" form="profileForm" class="field-input" value="' + pzEsc(bd.accountHolder) + '"></div>' +
          '<div><label class="field-label">Account Number</label><input id="pfBankAccount" form="profileForm" class="field-input" value="' + pzEsc(bd.accountNumber) + '"></div>' +
          '<div><label class="field-label">IFSC Code</label><input id="pfBankIfsc" form="profileForm" class="field-input" value="' + pzEsc(bd.ifsc) + '"></div>' +
          '<div><label class="field-label">UPI ID</label><input id="pfUpi" form="profileForm" class="field-input" value="' + pzEsc(bd.upi) + '"></div>' +
        '</div>' +
        '<div class="pform-actions"><button type="submit" form="profileForm" class="pz-btn pz-btn-primary" id="profileSaveBtn"><span class="btn-label">Save Changes</span></button></div>' +
      '</div>' +
      '<div class="pform-card">' +
        '<h3>KYC Documents <span id="kycStatusBadge" class="kyc-badge ' + (verified ? "verified" : "pending") + '">' + (verified ? "Verified" : "Pending Review") + '</span></h3>' +
        '<div class="pform-row two-col">' +
          '<div><label class="field-label">Aadhaar Card</label>' +
            '<label class="upload-box"><input type="file" id="aadhaarUpload" accept="image/*,.pdf"><div class="upload-box-icon">📄</div><div class="upload-box-text">Upload Aadhaar</div><div class="upload-box-sub">JPG, PNG or PDF, max 5MB</div></label>' +
            '<div class="upload-progress" id="aadhaarUploadProgress"><div class="upload-progress-bar"></div></div>' +
            '<div class="upload-preview" id="aadhaarPreview" style="display:' + (partner.aadhaarUrl ? "flex" : "none") + '">✅ Aadhaar on file</div></div>' +
          '<div><label class="field-label">PAN Card</label>' +
            '<label class="upload-box"><input type="file" id="panUpload" accept="image/*,.pdf"><div class="upload-box-icon">📄</div><div class="upload-box-text">Upload PAN</div><div class="upload-box-sub">JPG, PNG or PDF, max 5MB</div></label>' +
            '<div class="upload-progress" id="panUploadProgress"><div class="upload-progress-bar"></div></div>' +
            '<div class="upload-preview" id="panPreview" style="display:' + (partner.panUrl ? "flex" : "none") + '">✅ PAN on file</div></div>' +
        '</div>' +
      '</div>';

    qs("#profileForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = qs("#profileSaveBtn");
      setBtnLoading(btn, true);
      window._firebase.db.collection("partners").doc(PZ.uid).update({
        businessName: qs("#pfBusinessName").value.trim(),
        ownerName: qs("#pfOwnerName").value.trim(),
        phone: qs("#pfPhone").value.trim(),
        city: qs("#pfCity").value.trim(),
        address: qs("#pfAddress").value.trim(),
        bankDetails: {
          accountHolder: qs("#pfBankHolder").value.trim(),
          accountNumber: qs("#pfBankAccount").value.trim(),
          ifsc: qs("#pfBankIfsc").value.trim().toUpperCase(),
          upi: qs("#pfUpi").value.trim()
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () {
        setBtnLoading(btn, false);
        showToast("✅ Profile updated");
      }).catch(function (err) {
        setBtnLoading(btn, false);
        console.error(err);
        showToast("⚠️ Couldn't save changes");
      });
    });

    setupDocUpload("aadhaarUpload", "aadhaarUrl", "aadhaarPreview");
    setupDocUpload("panUpload", "panUrl", "panPreview");
  });
}

function setupDocUpload(inputId, field, previewId) {
  var input = qs("#" + inputId);
  if (!input) return;
  input.addEventListener("change", function () {
    var file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast("⚠️ File must be under 5MB"); return; }
    var progressWrap = qs("#" + inputId + "Progress");
    var bar = progressWrap ? qs(".upload-progress-bar", progressWrap) : null;
    if (progressWrap) progressWrap.classList.add("show");

    var ref = firebase.storage().ref().child("partners/" + PZ.uid + "/kyc/" + field + "_" + Date.now() + "_" + file.name);
    var task = ref.put(file);
    task.on("state_changed", function (snap) {
      var pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      if (bar) bar.style.width = pct + "%";
    }, function (err) {
      console.error(err);
      showToast("⚠️ Upload failed");
    }, function () {
      task.snapshot.ref.getDownloadURL().then(function (url) {
        var update = {}; update[field] = url;
        window._firebase.db.collection("partners").doc(PZ.uid).update(update).then(function () {
          showToast("✅ Document uploaded");
          var preview = qs("#" + previewId);
          if (preview) { preview.style.display = "flex"; preview.innerHTML = "✅ " + file.name + " uploaded"; }
          if (progressWrap) progressWrap.classList.remove("show");
        });
      });
    });
  });
}

/* ===================================================================
   PAGE: WALLET  (partner-wallet.html)
   =================================================================== */
function initWalletPage() {
  requirePartner(function (partner) {
    qs("#portalContent").innerHTML =
      '<div class="wallet-hero">' +
        '<div class="wallet-hero-label">Available Balance</div>' +
        '<div class="wallet-hero-amount" id="walletBalance">' + pzMoney(partner.walletBalance || 0) + '</div>' +
        '<div class="wallet-hero-row">' +
          '<div class="wallet-hero-sub">Total Earnings<b id="walletTotalEarnings">' + pzMoney(partner.totalEarnings || 0) + '</b></div>' +
          '<div class="wallet-hero-sub">Completed Jobs<b id="walletCompletedJobs">' + (partner.completedJobs || 0) + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="psection-head"><h2>Transaction History</h2></div>' +
      '<div class="pform-card" style="padding:6px 16px" id="transactionsList"><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div></div>';

    var listEl = qs("#transactionsList");
    var unsub = window._firebase.db.collection("partners").doc(PZ.uid).collection("transactions")
      .orderBy("createdAt", "desc").limit(50)
      .onSnapshot(function (snap) {
        if (snap.empty) { listEl.innerHTML = emptyStateHtml("💳", "No transactions yet", "Your earnings and payouts will show up here."); return; }
        listEl.innerHTML = snap.docs.map(function (doc) {
          var t = doc.data();
          var isCredit = t.type === "credit";
          return '<div class="txn-item"><div class="txn-icon ' + t.type + '">' + (isCredit ? "↓" : "↑") + '</div>' +
            '<div class="txn-info"><div class="txn-desc">' + pzEsc(t.description || (isCredit ? "Job earnings" : "Payout")) + '</div>' +
            '<div class="txn-date">' + pzDate(t.createdAt) + ' · ' + pzTime(t.createdAt) + '</div></div>' +
            '<div class="txn-amount ' + t.type + '">' + (isCredit ? "+" : "-") + pzMoney(t.amount) + '</div></div>';
        }).join("");
      }, function (err) {
        console.error(err);
        listEl.innerHTML = '<div class="perror-box">Couldn\'t load transactions.</div>';
      });
    pzTrackUnsub(unsub);
  });
}

/* ===================================================================
   PAGE: NOTIFICATIONS  (partner-notifications.html)
   =================================================================== */
function initNotificationsPage() {
  requirePartner(function () {
    qs("#portalContent").innerHTML = '<div id="notificationsList"><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div></div>';
    var listEl = qs("#notificationsList");
    var unsub = window._firebase.db.collection("partners").doc(PZ.uid).collection("notifications")
      .orderBy("createdAt", "desc").limit(50)
      .onSnapshot(function (snap) {
        if (snap.empty) { listEl.innerHTML = emptyStateHtml("🔔", "No notifications", "Booking updates and alerts will appear here."); return; }
        listEl.innerHTML = snap.docs.map(function (doc) {
          var n = doc.data();
          return '<div class="notif-item ' + (n.read ? "" : "unread") + '" data-id="' + doc.id + '">' +
            '<div class="notif-icon">🔔</div><div style="flex:1"><div class="notif-title">' + pzEsc(n.title || "Update") + '</div>' +
            '<div class="notif-msg">' + pzEsc(n.message || "") + '</div><div class="notif-time">' + pzDate(n.createdAt) + ' · ' + pzTime(n.createdAt) + '</div></div></div>';
        }).join("");
        qsa(".notif-item", listEl).forEach(function (el) {
          el.addEventListener("click", function () {
            window._firebase.db.collection("partners").doc(PZ.uid).collection("notifications").doc(el.dataset.id).update({ read: true });
          });
        });
      }, function (err) { console.error(err); listEl.innerHTML = '<div class="perror-box">Couldn\'t load notifications.</div>'; });
    pzTrackUnsub(unsub);
  });
}

/* ===================================================================
   PAGE: SETTINGS  (partner-settings.html)
   =================================================================== */
function initSettingsPage() {
  requirePartner(function (partner) {
    qs("#portalContent").innerHTML =
      '<div class="pform-card">' +
        '<div class="settings-row"><div><div class="settings-row-label">Online Status</div><div class="settings-row-sub">Receive new booking requests</div></div><button class="settings-switch" id="settingsOnlineToggle"></button></div>' +
        '<div class="settings-row"><div><div class="settings-row-label">Notifications</div><div class="settings-row-sub">Get alerts for booking updates</div></div><button class="settings-switch" id="settingsNotifToggle"></button></div>' +
      '</div>' +
      '<div class="pform-card">' +
        '<h3>Change Password</h3>' +
        '<div id="passwordError" class="auth-error-box"></div>' +
        '<div id="passwordSuccess" class="auth-success-box"></div>' +
        '<form id="changePasswordForm" class="pform-row">' +
          '<div><label class="field-label">Current Password</label><input type="password" id="curPassword" class="field-input" required></div>' +
          '<div><label class="field-label">New Password</label><input type="password" id="newPassword" class="field-input" required minlength="6"></div>' +
          '<div><label class="field-label">Confirm New Password</label><input type="password" id="confirmPassword" class="field-input" required minlength="6"></div>' +
          '<div class="pform-actions"><button type="submit" class="pz-btn pz-btn-primary" id="changePasswordBtn"><span class="btn-label">Update Password</span></button></div>' +
        '</form>' +
      '</div>' +
      '<div class="pform-card"><a href="#" class="danger-link" id="logoutBtn">🚪 Log Out</a></div>';

    var onlineBtn = qs("#settingsOnlineToggle");
    onlineBtn.classList.toggle("on", !!partner.online);
    onlineBtn.addEventListener("click", toggleOnlineStatus);

    var notifBtn = qs("#settingsNotifToggle");
    notifBtn.classList.toggle("on", partner.notificationsEnabled !== false);
    notifBtn.addEventListener("click", function () {
      var newVal = !notifBtn.classList.contains("on");
      window._firebase.db.collection("partners").doc(PZ.uid).update({ notificationsEnabled: newVal }).then(function () {
        notifBtn.classList.toggle("on", newVal);
        showToast(newVal ? "Notifications enabled" : "Notifications muted");
      });
    });

    qs("#changePasswordForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var current = qs("#curPassword").value;
      var next = qs("#newPassword").value;
      var confirmPass = qs("#confirmPassword").value;
      var errBox = qs("#passwordError"), okBox = qs("#passwordSuccess");
      errBox.classList.remove("show"); okBox.classList.remove("show");
      if (next.length < 6) { errBox.textContent = "New password must be at least 6 characters."; errBox.classList.add("show"); return; }
      if (next !== confirmPass) { errBox.textContent = "Passwords do not match."; errBox.classList.add("show"); return; }

      var btn = qs("#changePasswordBtn");
      setBtnLoading(btn, true);
      var cred = firebase.auth.EmailAuthProvider.credential(PZ.user.email, current);
      PZ.user.reauthenticateWithCredential(cred)
        .then(function () { return PZ.user.updatePassword(next); })
        .then(function () {
          setBtnLoading(btn, false);
          okBox.textContent = "Password updated successfully.";
          okBox.classList.add("show");
          qs("#changePasswordForm").reset();
        })
        .catch(function (err) {
          setBtnLoading(btn, false);
          errBox.textContent = err.code && err.code.indexOf("wrong-password") !== -1 ? "Current password is incorrect." : friendlyAuthError(err);
          errBox.classList.add("show");
        });
    });

    qs("#logoutBtn").addEventListener("click", doLogout);
  });
}

/* ===================================================================
   PAGE: DRIVERS  (partner-drivers.html)
   =================================================================== */
function initDriversPage() {
  requirePartner(function () {
    qs("#portalContent").innerHTML =
      '<div class="psection-head"><h2>Your Drivers</h2><button class="pz-btn pz-btn-primary pz-btn-sm" id="addDriverBtn">+ Add Driver</button></div>' +
      '<div id="driversList"><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div></div>' +
      '<div class="modal-overlay" id="driverModal" style="display:none">' +
        '<div class="modal-box">' +
          '<button class="modal-x" id="driverModalClose">✕</button>' +
          '<h2 class="modal-title" id="driverModalTitle">Add Driver</h2>' +
          '<form id="driverForm">' +
            '<input type="hidden" id="driverId">' +
            '<div class="pform-row">' +
              '<div><label class="field-label">Driver Name</label><input id="driverName" class="field-input" required></div>' +
              '<div><label class="field-label">Phone Number</label><input id="driverPhone" type="tel" class="field-input" required></div>' +
              '<div><label class="field-label">License Number</label><input id="driverLicense" class="field-input"></div>' +
            '</div>' +
            '<div class="pform-actions"><button type="submit" class="pz-btn pz-btn-primary btn-block" id="driverSaveBtn"><span class="btn-label">Save Driver</span></button></div>' +
          '</form>' +
        '</div>' +
      '</div>';

    loadDrivers();
    qs("#addDriverBtn").addEventListener("click", function () { openDriverModal(); });
    qs("#driverModalClose").addEventListener("click", closeDriverModal);
    qs("#driverForm").addEventListener("submit", saveDriver);
  });
}

function loadDrivers() {
  var listEl = qs("#driversList");
  var unsub = window._firebase.db.collection("partners").doc(PZ.uid).collection("drivers")
    .orderBy("addedAt", "desc")
    .onSnapshot(function (snap) {
      if (snap.empty) { listEl.innerHTML = emptyStateHtml("👷", "No drivers added", "Add your team's drivers to assign them to jobs."); return; }
      listEl.innerHTML = snap.docs.map(function (doc) {
        var d = doc.data();
        return '<div class="plist-item"><div class="plist-avatar">👤</div><div class="plist-info">' +
          '<div class="plist-name">' + pzEsc(d.name) + '</div><div class="plist-sub">' + pzEsc(d.phone) + ' · License ' + pzEsc(d.licenseNumber || "—") + '</div></div>' +
          '<button class="plist-menu-btn edit-driver-btn" data-id="' + doc.id + '">✏️</button>' +
          '<button class="plist-menu-btn delete-driver-btn" data-id="' + doc.id + '">🗑️</button></div>';
      }).join("");
      qsa(".edit-driver-btn", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          window._firebase.db.collection("partners").doc(PZ.uid).collection("drivers").doc(btn.dataset.id).get()
            .then(function (doc) { openDriverModal(doc.id, doc.data()); });
        });
      });
      qsa(".delete-driver-btn", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (!confirm("Remove this driver?")) return;
          window._firebase.db.collection("partners").doc(PZ.uid).collection("drivers").doc(btn.dataset.id).delete()
            .then(function () { showToast("Driver removed"); });
        });
      });
    }, function (err) { console.error(err); listEl.innerHTML = '<div class="perror-box">Couldn\'t load drivers.</div>'; });
  pzTrackUnsub(unsub);
}

function openDriverModal(id, data) {
  qs("#driverModalTitle").textContent = id ? "Edit Driver" : "Add Driver";
  qs("#driverId").value = id || "";
  qs("#driverName").value = (data && data.name) || "";
  qs("#driverPhone").value = (data && data.phone) || "";
  qs("#driverLicense").value = (data && data.licenseNumber) || "";
  qs("#driverModal").style.display = "flex";
}
function closeDriverModal() { qs("#driverModal").style.display = "none"; }

function saveDriver(e) {
  e.preventDefault();
  var id = qs("#driverId").value;
  var payload = {
    name: qs("#driverName").value.trim(),
    phone: qs("#driverPhone").value.trim(),
    licenseNumber: qs("#driverLicense").value.trim(),
    status: "active"
  };
  if (!payload.name || !payload.phone) { showToast("⚠️ Name and phone are required"); return; }
  var btn = qs("#driverSaveBtn");
  setBtnLoading(btn, true);
  var col = window._firebase.db.collection("partners").doc(PZ.uid).collection("drivers");
  var promise = id ? col.doc(id).update(payload) : col.add(Object.assign({}, payload, { addedAt: firebase.firestore.FieldValue.serverTimestamp() }));
  promise.then(function () {
    setBtnLoading(btn, false);
    showToast(id ? "✅ Driver updated" : "✅ Driver added");
    closeDriverModal();
  }).catch(function (err) {
    setBtnLoading(btn, false);
    console.error(err);
    showToast("⚠️ Couldn't save driver");
  });
}

/* ===================================================================
   PAGE: VEHICLES  (partner-vehicles.html)
   =================================================================== */
function initVehiclesPage() {
  requirePartner(function () {
    qs("#portalContent").innerHTML =
      '<div class="psection-head"><h2>Your Vehicles</h2><button class="pz-btn pz-btn-primary pz-btn-sm" id="addVehicleBtn">+ Add Vehicle</button></div>' +
      '<div id="vehiclesList"><div class="pskeleton pskel-card"></div><div class="pskeleton pskel-card"></div></div>' +
      '<div class="modal-overlay" id="vehicleModal" style="display:none">' +
        '<div class="modal-box">' +
          '<button class="modal-x" id="vehicleModalClose">✕</button>' +
          '<h2 class="modal-title" id="vehicleModalTitle">Add Vehicle</h2>' +
          '<form id="vehicleForm">' +
            '<input type="hidden" id="vehicleId">' +
            '<div class="pform-row">' +
              '<div><label class="field-label">Vehicle Type</label>' +
                '<select id="vehicleType" class="field-input"><option>Tata Ace</option><option>Mini Truck</option><option>Tempo</option><option>Pickup</option></select></div>' +
              '<div><label class="field-label">Vehicle Number</label><input id="vehicleNumber" class="field-input" placeholder="KA 01 AB 1234" required></div>' +
              '<div><label class="field-label">Load Capacity</label><input id="vehicleCapacity" class="field-input" placeholder="e.g. 750 kg"></div>' +
              '<div><label class="field-label">RC Document</label>' +
                '<label class="upload-box"><input type="file" id="vehicleRcUpload" accept="image/*,.pdf"><div class="upload-box-icon">📄</div><div class="upload-box-text">Upload RC</div><div class="upload-box-sub">JPG, PNG or PDF, max 5MB</div></label></div>' +
            '</div>' +
            '<div class="pform-actions"><button type="submit" class="pz-btn pz-btn-primary btn-block" id="vehicleSaveBtn"><span class="btn-label">Save Vehicle</span></button></div>' +
          '</form>' +
        '</div>' +
      '</div>';

    loadVehicles();
    qs("#addVehicleBtn").addEventListener("click", function () { openVehicleModal(); });
    qs("#vehicleModalClose").addEventListener("click", closeVehicleModal);
    qs("#vehicleForm").addEventListener("submit", saveVehicle);
  });
}

var VEHICLE_ICONS = { "Mini Truck": "🚚", "Tata Ace": "🚐", "Tempo": "🚛", "Pickup": "🛻" };

function loadVehicles() {
  var listEl = qs("#vehiclesList");
  var unsub = window._firebase.db.collection("partners").doc(PZ.uid).collection("vehicles")
    .orderBy("addedAt", "desc")
    .onSnapshot(function (snap) {
      if (snap.empty) { listEl.innerHTML = emptyStateHtml("🚚", "No vehicles added", "Add a vehicle to start receiving matching bookings."); return; }
      listEl.innerHTML = snap.docs.map(function (doc) {
        var v = doc.data();
        return '<div class="plist-item"><div class="plist-avatar">' + (VEHICLE_ICONS[v.type] || "🚚") + '</div><div class="plist-info">' +
          '<div class="plist-name">' + pzEsc(v.type) + ' · ' + pzEsc(v.number) + '</div><div class="plist-sub">Capacity: ' + pzEsc(v.capacity || "—") + '</div></div>' +
          '<button class="plist-menu-btn edit-vehicle-btn" data-id="' + doc.id + '">✏️</button>' +
          '<button class="plist-menu-btn delete-vehicle-btn" data-id="' + doc.id + '">🗑️</button></div>';
      }).join("");
      qsa(".edit-vehicle-btn", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          window._firebase.db.collection("partners").doc(PZ.uid).collection("vehicles").doc(btn.dataset.id).get()
            .then(function (doc) { openVehicleModal(doc.id, doc.data()); });
        });
      });
      qsa(".delete-vehicle-btn", listEl).forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (!confirm("Remove this vehicle?")) return;
          window._firebase.db.collection("partners").doc(PZ.uid).collection("vehicles").doc(btn.dataset.id).delete()
            .then(function () { showToast("Vehicle removed"); });
        });
      });
    }, function (err) { console.error(err); listEl.innerHTML = '<div class="perror-box">Couldn\'t load vehicles.</div>'; });
  pzTrackUnsub(unsub);
}

function openVehicleModal(id, data) {
  qs("#vehicleModalTitle").textContent = id ? "Edit Vehicle" : "Add Vehicle";
  qs("#vehicleId").value = id || "";
  qs("#vehicleType").value = (data && data.type) || "Mini Truck";
  qs("#vehicleNumber").value = (data && data.number) || "";
  qs("#vehicleCapacity").value = (data && data.capacity) || "";
  qs("#vehicleModal").style.display = "flex";
}
function closeVehicleModal() { qs("#vehicleModal").style.display = "none"; }

function saveVehicle(e) {
  e.preventDefault();
  var id = qs("#vehicleId").value;
  var payload = {
    type: qs("#vehicleType").value,
    number: qs("#vehicleNumber").value.trim().toUpperCase(),
    capacity: qs("#vehicleCapacity").value.trim(),
    status: "active"
  };
  if (!payload.number) { showToast("⚠️ Vehicle number is required"); return; }
  var btn = qs("#vehicleSaveBtn");
  setBtnLoading(btn, true);
  var col = window._firebase.db.collection("partners").doc(PZ.uid).collection("vehicles");
  var promise = id ? col.doc(id).update(payload) : col.add(Object.assign({}, payload, { addedAt: firebase.firestore.FieldValue.serverTimestamp() }));
  promise.then(function (ref) {
    var vehicleId = id || (ref && ref.id);
    var rcFile = qs("#vehicleRcUpload").files[0];
    if (rcFile && vehicleId) {
      var storageRef = firebase.storage().ref().child("partners/" + PZ.uid + "/vehicles/" + vehicleId + "/rc_" + Date.now() + "_" + rcFile.name);
      return storageRef.put(rcFile).then(function () { return storageRef.getDownloadURL(); })
        .then(function (url) { return col.doc(vehicleId).update({ rcUrl: url }); });
    }
  }).then(function () {
    setBtnLoading(btn, false);
    showToast(id ? "✅ Vehicle updated" : "✅ Vehicle added");
    closeVehicleModal();
  }).catch(function (err) {
    setBtnLoading(btn, false);
    console.error(err);
    showToast("⚠️ Couldn't save vehicle");
  });
}

/* ===================================================================
   PAGE: SUPPORT  (partner-support.html)
   =================================================================== */
function initSupportPage() {
  requirePartner(function () {
    qs("#portalContent").innerHTML =
      '<div class="support-quick-grid">' +
        '<a href="https://wa.me/919945095453" target="_blank" rel="noopener" class="support-quick-card"><div class="support-quick-icon">💬</div><div class="support-quick-label">WhatsApp</div></a>' +
        '<a href="tel:+919945095453" class="support-quick-card"><div class="support-quick-icon">📞</div><div class="support-quick-label">Call Us</div></a>' +
        '<a href="mailto:moveeasyblr@gmail.com" class="support-quick-card"><div class="support-quick-icon">✉️</div><div class="support-quick-label">Email</div></a>' +
        '<a href="#supportForm" class="support-quick-card"><div class="support-quick-icon">📝</div><div class="support-quick-label">Raise Ticket</div></a>' +
      '</div>' +
      '<div class="pform-card">' +
        '<h3>Raise a Support Request</h3>' +
        '<form id="supportForm" class="pform-row">' +
          '<div><label class="field-label">Subject</label><input id="ticketSubject" class="field-input" placeholder="e.g. Payout not received" required></div>' +
          '<div><label class="field-label">Message</label><textarea id="ticketMessage" class="field-input" rows="4" placeholder="Describe your issue in detail" required></textarea></div>' +
          '<div class="pform-actions"><button type="submit" class="pz-btn pz-btn-primary" id="ticketSubmitBtn"><span class="btn-label">Submit Request</span></button></div>' +
        '</form>' +
      '</div>' +
      '<div class="psection-head"><h2>Your Requests</h2></div>' +
      '<div id="ticketsList"><div class="pskeleton pskel-card"></div></div>';

    loadTickets();
    qs("#supportForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var subject = qs("#ticketSubject").value.trim();
      var message = qs("#ticketMessage").value.trim();
      if (!subject || !message) { showToast("⚠️ Please fill in all fields"); return; }
      var btn = qs("#ticketSubmitBtn");
      setBtnLoading(btn, true);
      window._firebase.db.collection("supportTickets").add({
        partnerId: PZ.uid,
        partnerName: PZ.partner.businessName || PZ.partner.ownerName,
        subject: subject,
        message: message,
        status: "open",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () {
        setBtnLoading(btn, false);
        showToast("✅ Support request submitted");
        qs("#supportForm").reset();
      }).catch(function (err) {
        setBtnLoading(btn, false);
        console.error(err);
        showToast("⚠️ Couldn't submit request");
      });
    });
  });
}

function loadTickets() {
  var listEl = qs("#ticketsList");
  var unsub = window._firebase.db.collection("supportTickets")
    .where("partnerId", "==", PZ.uid)
    .orderBy("createdAt", "desc").limit(20)
    .onSnapshot(function (snap) {
      if (snap.empty) { listEl.innerHTML = '<div class="pempty-sub" style="text-align:center;padding:20px">No support requests yet.</div>'; return; }
      listEl.innerHTML = snap.docs.map(function (doc) {
        var t = doc.data();
        return '<div class="ticket-item"><div class="ticket-top"><span class="ticket-subject">' + pzEsc(t.subject) + '</span>' +
          '<span class="pstatus-pill pstatus-' + (t.status === "resolved" ? "completed" : "pending") + '">' + pzEsc(t.status) + '</span></div>' +
          '<div class="ticket-msg">' + pzEsc(t.message) + '</div><div class="ticket-date">' + pzDate(t.createdAt) + '</div></div>';
      }).join("");
    }, function (err) { console.error(err); listEl.innerHTML = '<div class="perror-box">Couldn\'t load requests.</div>'; });
  pzTrackUnsub(unsub);
}

/* ===================================================================
   ROUTER — runs the right init function based on <body data-page="...">
   =================================================================== */
document.addEventListener("DOMContentLoaded", function () {
  var page = document.body.dataset.page;
  var routes = {
    "login": initLoginPage,
    "forgot-password": initForgotPasswordPage,
    "registration-status": initRegistrationStatusPage,
    "dashboard": initDashboardPage,
    "bookings": initBookingsPage,
    "booking-details": initBookingDetailsPage,
    "profile": initProfilePage,
    "wallet": initWalletPage,
    "notifications": initNotificationsPage,
    "settings": initSettingsPage,
    "drivers": initDriversPage,
    "vehicles": initVehiclesPage,
    "support": initSupportPage
  };
  if (routes[page]) routes[page]();
});

window.addEventListener("beforeunload", pzClearListeners);



/* ============================================
FIREBASE EMAIL ACTION HANDLER (PARTNER)
============================================ */
function handleFirebaseActionCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  const oobCode = urlParams.get('oobCode');

  if (!mode || !oobCode) return;

  // We need to wait for firebase auth to be ready
  var checkFB = setInterval(function() {
    if (window._firebase && window._firebase.auth) {
      clearInterval(checkFB);
      const auth = window._firebase.auth;

      if (mode === 'verifyEmail') {
        auth.applyActionCode(oobCode).then(function() {
          const user = auth.currentUser;
          if (user) {
            window._firebase.db.collection('partners').doc(user.uid).update({ emailVerified: true }).catch(function(){});
          }
          alert("Success: Email verified successfully!");
          window.history.replaceState(null, '', window.location.pathname);
        }).catch(function(err) {
          console.error(err);
          alert("⚠️ Invalid or expired link. Please try again.");
        });
      } else if (mode === 'resetPassword') {
        auth.verifyPasswordResetCode(oobCode).then(function(email) {
          var resetUI = qs("#partnerNewPasswordUI");
          var forgotForm = qs("#forgotForm");
          if (resetUI && forgotForm) {
            forgotForm.style.display = 'none';
            qs("#newPasswordEmailDisplay").textContent = email;
            resetUI.style.display = 'block';
          }
        }).catch(function(err) {
          console.error(err);
          alert("⚠️ Invalid or expired reset link. Please try again.");
        });
      }
    }
  }, 100);
}

function submitPartnerNewPassword() {
  const urlParams = new URLSearchParams(window.location.search);
  const oobCode = urlParams.get('oobCode');
  const newPassword = qs('#partnerNewPasswordInput').value;
  const btn = qs('#btnSubmitPartnerNewPassword');
  const errBox = qs('#newPasswordError');
  const okBox = qs('#newPasswordSuccess');

  if (errBox) errBox.classList.remove("show");
  if (okBox) okBox.classList.remove("show");

  if (!newPassword || newPassword.length < 6) {
    if (errBox) { errBox.textContent = "⚠️ Password must be at least 6 characters."; errBox.classList.add("show"); }
    return;
  }

  setBtnLoading(btn, true);

  window._firebase.auth.confirmPasswordReset(oobCode, newPassword).then(function() {
    setBtnLoading(btn, false);
    if (okBox) { okBox.textContent = "✅ Password updated successfully! Redirecting to login..."; okBox.classList.add("show"); }
    setTimeout(function() {
      window.location.href = 'partner-login.html';
    }, 3000);
  }).catch(function(err) {
    setBtnLoading(btn, false);
    console.error(err);
    if (errBox) { errBox.textContent = friendlyAuthError(err); errBox.classList.add("show"); }
  });
}

document.addEventListener("DOMContentLoaded", function() {
  handleFirebaseActionCode();
});
