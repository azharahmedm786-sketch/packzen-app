/* PackZen Digital — Modern B2B SaaS & Digital Agency
   Analytics, Attribution, Sample Preview, Scope Estimator, and Verified Lead Submission
*/
(function () {
  "use strict";

  // 1. Google Analytics 4 (Measurement ID: G-9JXKP58GP3)
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", "G-9JXKP58GP3");

  var gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = "https://www.googletagmanager.com/gtag/js?id=G-9JXKP58GP3";
  document.head.appendChild(gaScript);

  function track(eventName, params) {
    try {
      window.gtag("event", eventName, params || {});
    } catch (e) {}
  }

  // 2. First-Touch UTM Attribution
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];
  var attr = {};
  try {
    attr = JSON.parse(localStorage.getItem("pz_attr") || "{}") || {};
    var q = new URLSearchParams(location.search), fresh = {};
    KEYS.forEach(function (k) {
      var v = q.get(k);
      if (v) fresh[k] = v.slice(0, 120);
    });
    if (Object.keys(fresh).length && !attr.utm_source && !attr.gclid) {
      attr = Object.assign(fresh, { landing: location.pathname, referrer: document.referrer.slice(0, 200) });
      localStorage.setItem("pz_attr", JSON.stringify(attr));
    } else if (!attr.landing) {
      attr.landing = location.pathname;
      attr.referrer = document.referrer.slice(0, 200);
    }
  } catch (e) {}

  // 3. Contact & Phone Click Tracking
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href*='wa.me/'],a[href^='tel:']");
    if (a) {
      track("contact", {
        method: /wa\.me/.test(a.href) ? "whatsapp" : "phone",
        division: "digital"
      });
    }
  }, true);

  // 4. Package Button Preselection
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pkg]");
    if (!b) return;
    var pkgName = b.getAttribute("data-pkg");
    var svcName = b.getAttribute("data-svc") || "website";
    var sel = document.querySelector("#dzForm [name=package]");
    if (sel) sel.value = pkgName;
    var svc = document.querySelector("#dzForm [name=service]");
    if (svc) svc.value = svcName;

    // Map budget enum based on package
    var bgt = document.querySelector("#dzForm [name=budget]");
    if (bgt) {
      if (pkgName.indexOf("Starter") !== -1) bgt.value = "under_10k";
      else if (pkgName.indexOf("Business") !== -1) bgt.value = "10k_20k";
      else if (pkgName.indexOf("Advanced") !== -1) bgt.value = "20k_50k";
      else if (pkgName.indexOf("Care") !== -1) bgt.value = "under_10k";
    }

    track("select_item", {
      item_list_name: "digital_packages",
      items: [{ item_id: pkgName }]
    });
  });

  // 5. Hero Interactive Sample Preview Tabs
  function initPreviewTabs() {
    var tabs = document.querySelectorAll(".dz-tab-btn");
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var targetId = tab.getAttribute("data-target");
        if (!targetId) return;
        tabs.forEach(function (t) { t.classList.remove("active"); });
        document.querySelectorAll(".dz-tab-panel").forEach(function (p) { p.classList.remove("active"); });
        tab.classList.add("active");
        var panel = document.getElementById(targetId);
        if (panel) panel.classList.add("active");
      });
    });
  }

  // 6. Interactive Scope Estimator State & Calculation
  function initScopeEstimator() {
    var estBox = document.getElementById("dzEstimator");
    if (!estBox) return;

    var state = {
      pages: "starter", // starter (1-5), business (6-10), custom (10+)
      ecommerce: false,
      booking: false,
      seo: false,
      whatsapp: true,
      customLogic: false
    };

    // Handle Page Radio Pills
    var pagePills = estBox.querySelectorAll("[data-est-pages]");
    pagePills.forEach(function (pill) {
      pill.addEventListener("click", function () {
        pagePills.forEach(function (p) { p.classList.remove("selected"); });
        pill.classList.add("selected");
        state.pages = pill.getAttribute("data-est-pages");
        renderScope();
      });
    });

    // Handle Checkbox Toggles
    var featureBoxes = estBox.querySelectorAll("[data-est-feat]");
    featureBoxes.forEach(function (box) {
      var feat = box.getAttribute("data-est-feat");
      var input = box.querySelector("input[type=checkbox]");
      if (!input) return;
      box.addEventListener("click", function (e) {
        if (e.target !== input) {
          input.checked = !input.checked;
        }
        if (input.checked) box.classList.add("checked");
        else box.classList.remove("checked");
        state[feat] = input.checked;
        renderScope();
      });
    });

    function calculateScope() {
      var result = {
        title: "Starter Business Launch",
        badge: "Starter Package",
        price: "₹7,999",
        priceType: "Fixed one-time",
        timeline: "7–10 days",
        serviceEnum: "website",
        budgetEnum: "under_10k",
        packageName: "Starter Website",
        features: ["Up to 5 Pages", "Mobile-First Design", "WhatsApp & Call Buttons", "Google Maps & Contact Form"],
        isCustom: false
      };

      if (state.ecommerce || state.booking) {
        result.serviceEnum = "ecommerce";
        result.packageName = "Advanced Website";
        if (state.customLogic || state.pages === "custom") {
          result.title = "Custom Store / Booking Application";
          result.badge = "Custom Scope";
          result.price = "Quotation Required";
          result.priceType = "Baseline from ₹29,999";
          result.timeline = "15–21+ days";
          result.budgetEnum = "50k_plus";
          result.isCustom = true;
        } else {
          result.title = state.ecommerce ? "E-Commerce Online Store" : "Service Booking Platform";
          result.badge = "Advanced Package";
          result.price = "From ₹29,999";
          result.priceType = "Quoted per project scope";
          result.timeline = "15–21+ days";
          result.budgetEnum = "20k_50k";
        }
        result.features = [
          state.ecommerce ? "Product Catalog & Online Checkout" : "Service Slots & Booking Calendar",
          "Razorpay Payment Gateway (UPI, Cards, NetBanking)",
          "Admin Dashboard to Manage Orders / Bookings",
          "WhatsApp Order / Booking Alerts"
        ];
        if (state.seo) result.features.push("Local SEO & Google Business Profile");
      } else if (state.customLogic || state.pages === "custom") {
        result.title = "Custom Business Web Application";
        result.badge = "Custom Scope";
        result.price = "Quotation Required";
        result.priceType = "Baseline from ₹29,999";
        result.timeline = "15–21+ days";
        result.serviceEnum = "website";
        result.budgetEnum = "50k_plus";
        result.packageName = "Advanced Website";
        result.isCustom = true;
        result.features = [
          "10+ Custom Web Pages",
          "Custom Business Workflow / Admin Panel",
          "Dedicated Speed & Core Web Vitals Optimization",
          "WhatsApp & Form Lead Integration"
        ];
      } else if (state.pages === "business" || state.seo) {
        result.title = "Business Growth & Local SEO";
        result.badge = "Business Package";
        result.price = "₹14,999";
        result.priceType = "Fixed one-time";
        result.timeline = "10–15 days";
        result.serviceEnum = "website";
        result.budgetEnum = "10k_20k";
        result.packageName = "Business Website";
        result.features = [
          "Up to 10 Pages",
          "Google Business Profile Setup & Maps",
          "Local SEO for up to 5 Key Pages",
          "Enquiry Form + WhatsApp Direct Action"
        ];
      }

      return result;
    }

    function renderScope() {
      var sc = calculateScope();
      var titleEl = document.getElementById("dzEstTitle");
      var badgeEl = document.getElementById("dzEstBadge");
      var priceEl = document.getElementById("dzEstPrice");
      var priceTypeEl = document.getElementById("dzEstPriceType");
      var timeEl = document.getElementById("dzEstTime");
      var listEl = document.getElementById("dzEstList");
      var noteEl = document.getElementById("dzEstNote");

      if (titleEl) titleEl.textContent = sc.title;
      if (badgeEl) badgeEl.textContent = sc.badge;
      if (priceEl) priceEl.textContent = sc.price;
      if (priceTypeEl) priceTypeEl.textContent = sc.priceType;
      if (timeEl) timeEl.textContent = "Estimated delivery: " + sc.timeline;

      if (listEl) {
        listEl.innerHTML = "";
        sc.features.forEach(function (f) {
          var li = document.createElement("li");
          li.textContent = f;
          listEl.appendChild(li);
        });
      }

      if (noteEl) {
        if (sc.isCustom) {
          noteEl.textContent = "Custom scope — quotation required. Final price is confirmed in writing after a free consultation. Domain and hosting billed at actual cost.";
        } else {
          noteEl.textContent = "Transparent fixed starting baseline. 50% advance, balance on launch. Domain and hosting billed at actual cost.";
        }
      }
    }

    // Apply Scope to Lead Form
    var applyBtn = document.getElementById("dzApplyScope");
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        var sc = calculateScope();
        var selSvc = document.querySelector("#dzForm [name=service]");
        var selBgt = document.querySelector("#dzForm [name=budget]");
        var selPkg = document.querySelector("#dzForm [name=package]");
        var txtDetails = document.querySelector("#dzForm [name=details]");

        if (selSvc) selSvc.value = sc.serviceEnum;
        if (selBgt) selBgt.value = sc.budgetEnum;
        if (selPkg) selPkg.value = sc.packageName;

        var featureSummary = [
          "Pages: " + (state.pages === "starter" ? "1-5" : state.pages === "business" ? "6-10" : "10+"),
          state.ecommerce ? "E-commerce/Catalog" : null,
          state.booking ? "Online Booking/Slots" : null,
          state.seo ? "Google Business Profile & SEO" : null,
          state.whatsapp ? "WhatsApp Integration" : null,
          state.customLogic ? "Custom Workflow" : null
        ].filter(Boolean).join(", ");

        var briefNote = "Scope: " + sc.title + " (" + sc.price + ") | " + featureSummary;
        if (txtDetails) {
          var existingText = (txtDetails.value || "").trim();
          var customerNotes = "";
          if (existingText) {
            if (/\s*\|\s*Notes:\s*/i.test(existingText)) {
              customerNotes = existingText.split(/\s*\|\s*Notes:\s*/i).slice(1).join(" | Notes: ").trim();
            } else if (/^Scope:\s*/i.test(existingText)) {
              customerNotes = "";
            } else {
              customerNotes = existingText;
            }
          }

          if (customerNotes) {
            var notesSuffix = " | Notes: " + customerNotes;
            var allowedForBrief = 450 - notesSuffix.length;
            if (allowedForBrief >= briefNote.length) {
              txtDetails.value = briefNote + notesSuffix;
            } else {
              var compactBrief = "Scope: " + sc.title + " (" + sc.price + ")";
              if (allowedForBrief >= compactBrief.length) {
                txtDetails.value = compactBrief + notesSuffix;
              } else {
                var minBrief = "Scope: " + sc.packageName;
                if (allowedForBrief >= minBrief.length) {
                  txtDetails.value = minBrief + notesSuffix;
                } else {
                  // Customer notes take priority — preserve 100% without truncation
                  txtDetails.value = customerNotes;
                }
              }
            }
          } else {
            txtDetails.value = briefNote.slice(0, 450);
          }
        }

        track("select_item", {
          item_list_name: "estimator_scope",
          items: [{ item_id: sc.title }]
        });

        var quoteSec = document.getElementById("quote");
        if (quoteSec) {
          quoteSec.scrollIntoView({ behavior: "smooth" });
          var nameInput = document.querySelector("#dzForm [name=name]");
          if (nameInput) setTimeout(function () { nameInput.focus(); }, 400);
        }
      });
    }

    // Initial render
    renderScope();
  }

  // 7. Lead Form Submission to Existing Cloud Function
  function initLeadForm() {
    var f = document.getElementById("dzForm");
    if (!f) return;
    var err = f.querySelector(".dz-err"), sending = false;

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      err.textContent = "";

      var v = function (n) { return ((f.elements[n] && f.elements[n].value) || "").trim(); };
      var phone = v("phone").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

      if (v("name").length < 2) return (err.textContent = "Please enter your name.");
      if (!/^[6-9]\d{9}$/.test(phone)) return (err.textContent = "Please enter a valid 10-digit Indian mobile number.");
      if (v("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v("email"))) return (err.textContent = "Please check your email address.");
      if (!f.elements.consent.checked) return (err.textContent = "Please agree to be contacted about your enquiry.");

      // Allowed backend enums
      var ALLOWED_SERVICES = ["website", "ecommerce", "seo", "maintenance"];
      var service = v("service") || "website";
      if (ALLOWED_SERVICES.indexOf(service) === -1) service = "website";

      var ALLOWED_BUDGETS = ["under_10k", "10k_20k", "20k_50k", "50k_plus", "not_sure"];
      var budget = v("budget") || "not_sure";
      if (ALLOWED_BUDGETS.indexOf(budget) === -1) budget = "not_sure";

      var ALLOWED_CONTACT = ["whatsapp", "call", "email"];
      var contactPref = v("contactPref") || "whatsapp";
      if (ALLOWED_CONTACT.indexOf(contactPref) === -1) contactPref = "whatsapp";

      // Notes formatted cleanly, max 480 chars, prioritizing customer notes
      var detailsText = v("details");
      var prefix = [
        v("package") && "package: " + v("package"),
        v("btype") && "type: " + v("btype")
      ].filter(Boolean).join(" | ");

      var notes = "";
      if (prefix && detailsText) {
        if ((prefix + " | " + detailsText).length <= 480) {
          notes = prefix + " | " + detailsText;
        } else if (detailsText.length <= 440) {
          var maxPrefix = 480 - 3 - detailsText.length;
          notes = prefix.slice(0, maxPrefix) + " | " + detailsText;
        } else {
          notes = detailsText.slice(0, 480);
        }
      } else {
        notes = (prefix || detailsText).slice(0, 480);
      }

      var btn = f.querySelector("button[type=submit]");
      sending = true;
      btn.disabled = true;
      btn.textContent = "Sending…";

      var submitUrl = (window.PackZenEnv && typeof window.PackZenEnv.getFunctionUrl === "function" && window.PackZenEnv.getFunctionUrl("submitLead")) ||
        (window.ENV && typeof window.ENV.getFunctionUrl === "function" && window.ENV.getFunctionUrl("submitLead")) || null;

      if (!submitUrl) {
        sending = false;
        btn.disabled = false;
        btn.textContent = "Send Message";
        showToast("⚠️ Service temporarily unavailable in this environment.");
        return;
      }

      fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            name: v("name"),
            phone: phone,
            email: v("email"),
            business: v("business"),
            service: service,
            budget: budget,
            contactPref: contactPref,
            area: v("area"),
            notes: notes.slice(0, 480),
            website: v("website"), // Honeypot
            page: location.pathname,
            attribution: attr
          }
        })
      })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.error) throw new Error(j.error.message || "Could not send.");
        track("generate_lead", {
          method: "digital_form",
          service: service,
          division: "digital"
        });
        f.hidden = true;
        var d = document.getElementById("dzDone");
        if (d) {
          d.hidden = false;
          d.focus();
        }
      })
      .catch(function (x) {
        sending = false;
        btn.disabled = false;
        btn.textContent = "Get a Free Consultation";
        err.textContent = (x && x.message) || "Could not send — please WhatsApp or call 9945095453.";
      });
    });
  }

  // DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initPreviewTabs();
      initScopeEstimator();
      initLeadForm();
    });
  } else {
    initPreviewTabs();
    initScopeEstimator();
    initLeadForm();
  }
})();
