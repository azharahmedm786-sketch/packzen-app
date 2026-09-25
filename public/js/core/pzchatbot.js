/* ==========================================================================
   PackZen AI Chat Widget — Engine
   File: pz-chatbot.js
   Pure vanilla JavaScript. No external dependencies.

   WHAT THIS FILE DOES
   - Injects a floating chat button + chat window into the page
   - Matches visitor questions against a PackZen knowledge base
     (pricing, vehicles, booking steps, service areas, support)
   - Offers quick-reply buttons and a "Book Now" call-to-action that
     scrolls to your existing booking form
   - Optionally captures a name + phone number as a lead and saves it
     to Firestore when a visitor asks for a human, then hands them to 
     WhatsApp with the conversation context pre-filled
   ========================================================================== */

(function () {
  "use strict";

  /* ======================================================================
     1. CONFIG — edit these values to match your business
     ====================================================================== */
  var CONFIG = {
    // Element on the current page to scroll to when the bot suggests booking.
    // Your existing booking form's id — change this if your form id differs.
   bookingFormSelector: "#quote",


    // Where to send visitors to book if they are NOT already on the page
    // that contains the booking form (e.g. they are on a blog page).
    bookingPageUrl: "/index.html#quote",

    // WhatsApp business number in international format, no "+" or spaces.
    whatsappNumber: "919945095453",

    // Support contact details shown in the "Talk to Support" reply.
    supportPhone: "+91 99450 95453",
    supportEmail: "moveeasyblr@gmail.com",
    supportHours: "Mon–Sun, 8:00 AM – 9:00 PM",

    // Set to true once you have added the Firestore rules in this guide
    // and want chat leads (name + phone) saved to your database.
   enableFirestoreLeadCapture: false,
    firestoreCollection: "chatbot_leads",

    // Delay before the teaser bubble auto-appears next to the button (ms).
    teaserDelayMs: 9000,

    // How many past messages to keep in localStorage so a return visit
    // continues the same conversation.
    historyLimit: 40,
  };

  /* ======================================================================
     2. KNOWLEDGE BASE — edit copy, prices and vehicles to match your rates
     ====================================================================== */
  var KB = {
    greeting:
      "Hi there! 👋 I'm the PackZen Assistant.\nPack Smart. Move Calm. — ask me about pricing, vehicles, booking, or service areas, and I'll help right away.",

    menu: [
      { label: "💰 Pricing & Rates", intent: "pricing" },
      { label: "🚚 Vehicle Options", intent: "vehicles" },
      { label: "📋 How Booking Works", intent: "booking_steps" },
      { label: "📍 Service Areas", intent: "service_area" },
      { label: "💬 Talk to Support", intent: "human" },
      { label: "📅 Book Now", intent: "book_now" },
    ],

    intents: {
      pricing: {
        keywords: [
          "price", "pricing", "cost", "rate", "rates", "charge", "charges",
          "fee", "fees", "how much", "estimate", "quote", "expensive",
          "cheap", "budget", "amount",
        ],
       reply:
  "🏠 PackZen Pricing Guide\n\n" +
  "• 1 RK — ₹2,500 onwards\n" +
  "• 1 BHK — ₹4,500 onwards\n" +
  "• 2 BHK — ₹6,500 onwards\n" +
  "• 3 BHK — ₹8,500 onwards\n" +
  "• 4 BHK — ₹10,500 onwards\n" +
  "• Villa — ₹13,500 onwards\n\n" +
  "Final cost depends on:\n" +
  "✅ Distance\n" +
  "✅ Furniture quantity\n" +
  "✅ Floor charges\n" +
  "✅ Lift availability\n" +
  "✅ Local or Intercity move\n\n" +
  "🏢 Floor Charges:\n" +
"• With Lift: Lower handling charges apply\n" +
"• Without Lift: Additional floor charges apply\n\n" +
  "🚚 Intercity pricing is calculated based on distance, house size and vehicle requirements.\n\n" +
  "Use our Instant Quote form to get an exact price instantly.",
         cta: { type: "book", label: "Get My Instant Quote" },
        followUp: ["vehicles", "booking_steps", "human"],
      },

      vehicles: {
        keywords: [
          "vehicle", "vehicles", "truck", "tempo", "van", "container",
          "ace", "lorry", "capacity", "fleet", "size of truck",
        ],
        reply:
          "We match the vehicle to your home size so you never overpay:\n\n" +
          "🚐 Mini Truck (Tata Ace, open) — best for 1 RK / 1 BHK, ~750 kg load\n" +
          "🚛 Tempo 14ft (covered) — best for 2 BHK, ~1.5 ton load\n" +
          "🚚 Tempo 17ft (covered) — best for 3 BHK, ~2.5 ton load\n" +
          "🛻 Container Truck 19–22ft — best for 4+ BHK / villas, ~4–7 ton load\n\n" +
          "All covered vehicles protect your belongings from weather during transit. The quote form auto-suggests the right vehicle once you enter your BHK.",
        cta: { type: "book", label: "Get Vehicle Recommendation" },
        followUp: ["pricing", "booking_steps"],
      },

      booking_steps: {
        keywords: [
          "book", "booking", "how to book", "process", "steps", "how does it work",
          "how it works", "reserve", "schedule", "procedure",
        ],
        reply:
          "Booking with PackZen takes about 2 minutes:\n\n" +
          "1️⃣ Fill the quote form — pickup, drop, BHK & moving date\n" +
          "2️⃣ See your instant price breakdown — vehicle, charges, total\n" +
          "3️⃣ Confirm & pay a small advance securely via Razorpay (UPI / Card / Netbanking), or book directly over WhatsApp\n" +
          "4️⃣ Get your booking ID and a driver/team assigned to your move\n" +
          "5️⃣ On moving day, our team arrives on time to pack, load, transport and unload\n" +
          "6️⃣ Track everything from your customer dashboard or message us anytime\n\n" +
          "Ready to start?",
        cta: { type: "book", label: "Start Booking" },
        followUp: ["pricing", "service_area"],
      },

      service_area: {
        keywords: [
          "area", "areas", "location", "locations", "city", "cities",
          "where", "cover", "service area", "do you operate", "available in",
        ],
        reply:
          "We're based in Bangalore and cover the whole city, including:\n" +
          "Whitefield, Koramangala, HSR Layout, Indiranagar, Electronic City, Marathahalli, JP Nagar, Hebbal, Yelahanka, and surrounding localities.\n\n" +
          "We also handle intercity moves from Bangalore to Chennai, Hyderabad, Mysore, Coimbatore, Pune, Mumbai, Kochi and other major cities.\n\n" +
          "Not sure if we cover your locality? Tell me the area name and I'll point you in the right direction, or our support team can confirm directly.",
        cta: { type: "book", label: "Check Availability & Get Quote" },
        followUp: ["pricing", "human"],
      },

      human: {
        keywords: [
          "human", "agent", "support", "help", "talk to someone", "representative",
          "call", "contact", "complaint", "issue", "problem", "speak to",
          "customer care", "customer service",
        ],
        reply:
          "Of course — I can connect you with our support team.\n\n" +
          "📞 " + CONFIG.supportPhone + "\n" +
          "✉️ " + CONFIG.supportEmail + "\n" +
          "🕒 " + CONFIG.supportHours + "\n\n" +
          "Or share your name and phone number below and we'll reach out to you directly on WhatsApp.",
        showLeadForm: true,
        followUp: [],
      },

      book_now: {
        keywords: ["book now", "i want to book", "start booking", "lets book"],
        reply:
          "Great choice! Taking you to our quote form now — fill in your pickup, drop and moving date to get an instant price.",
        cta: { type: "book", label: "Open Booking Form" },
        followUp: [],
      },

      thanks: {
        keywords: ["thank", "thanks", "thank you", "thx", "appreciate"],
        reply: "You're very welcome! 😊 Anything else I can help with — pricing, vehicles, or booking?",
        followUp: ["pricing", "vehicles", "booking_steps"],
      },

      greeting_intent: {
        keywords: ["hi", "hello", "hey", "good morning", "good evening", "good afternoon"],
        reply: "Hello! 👋 How can I help with your move today?",
        followUp: [],
      },

      pwa_app: {
        keywords: ["app", "download app", "install", "driver app"],
        reply:
          "PackZen works as an installable app right from your browser — no app store needed. On your phone, open our website and tap \"Add to Home Screen\" from your browser menu.",
        followUp: ["booking_steps"],
      },

      payment: {
        keywords: ["payment", "pay", "razorpay", "upi", "card", "refund", "advance"],
        reply:
          "Payments are handled securely through Razorpay — UPI, debit/credit card, or netbanking are all supported. A small advance confirms your booking, and the balance is settled after your move is complete.",
        followUp: ["booking_steps", "human"],
      },
    },

    fallback:
      "I didn't quite catch that. I can help with pricing, vehicle options, the booking process, service areas, or connecting you to our support team — what would you like to know?",
  };

  /* ======================================================================
     3. STATE
     ====================================================================== */
  var state = {
    open: false,
    history: [],
    leadCaptured: false,
  };

  var STORAGE_KEY = "pzChatHistory_v1";

  function loadHistory() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      var trimmed = state.history.slice(-CONFIG.historyLimit);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      /* localStorage unavailable (private browsing etc.) — fail silently */
    }
  }

  /* ======================================================================
     4. DOM BUILDING
     ====================================================================== */
  var els = {};

  function buildWidget() {
    var root = document.createElement("div");
    root.id = "pz-chat-root";
    root.innerHTML =
      '<div class="pz-chat-teaser" id="pzTeaser" role="button" tabindex="0">' +
      "Need help with your move? Chat with us!" +
      '<button class="pz-teaser-dismiss" id="pzTeaserDismiss" aria-label="Dismiss">✕</button>' +
      "</div>" +
      '<div class="pz-chat-window" id="pzChatWindow" role="dialog" aria-modal="false" aria-label="PackZen chat assistant">' +
      '  <div class="pz-chat-header">' +
      '    <div class="pz-chat-avatar">' + iconBox() + "</div>" +
      '    <div class="pz-chat-header-text">' +
      '      <div class="pz-brand">PackZen Assistant</div>' +
      '      <div class="pz-chat-status"><span class="pz-dot"></span>Online now</div>' +
      "    </div>" +
      '    <button class="pz-chat-header-close" id="pzCloseBtn" aria-label="Close chat">' + iconClose() + "</button>" +
      "  </div>" +
      '  <div class="pz-chat-messages" id="pzMessages" aria-live="polite"></div>' +
      '  <div class="pz-quick-replies" id="pzQuickReplies"></div>' +
      '  <div class="pz-chat-input-row">' +
      '    <textarea class="pz-chat-input" id="pzInput" rows="1" placeholder="Type your question..." aria-label="Type your message"></textarea>' +
      '    <button class="pz-chat-send" id="pzSendBtn" aria-label="Send message">' + iconSend() + "</button>" +
      "  </div>" +
      '  <div class="pz-chat-footer">Pack Smart. Move Calm. · PackZen Assistant</div>' +
      "</div>" +
      '<button class="pz-chat-toggle" id="pzToggleBtn" aria-label="Open chat" aria-expanded="false">' +
      '  <span class="pz-icon-chat">' + iconChat() + "</span>" +
      '  <span class="pz-icon-close">' + iconClose() + "</span>" +
      '  <span class="pz-chat-badge" id="pzBadge">1</span>' +
      "</button>";

    document.body.appendChild(root);

    els.root = root;
    els.toggleBtn = document.getElementById("pzToggleBtn");
    els.closeBtn = document.getElementById("pzCloseBtn");
    els.window = document.getElementById("pzChatWindow");
    els.messages = document.getElementById("pzMessages");
    els.quickReplies = document.getElementById("pzQuickReplies");
    els.input = document.getElementById("pzInput");
    els.sendBtn = document.getElementById("pzSendBtn");
    els.badge = document.getElementById("pzBadge");
    els.teaser = document.getElementById("pzTeaser");
    els.teaserDismiss = document.getElementById("pzTeaserDismiss");
  }

  function iconChat() {
    return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="#C9A227" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function iconClose() {
    return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  function iconSend() {
    return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 11.5 20.5 3 14 20.5l-3.2-7.3L3 11.5z"/></svg>';
  }

  function iconBox() {
    return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7.5 12 3l9 4.5M3 7.5 12 12m-9-4.5V17l9 4.5M21 7.5 12 12m9-4.5V17l-9 4.5M12 12v9" stroke="#0B0B0C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ======================================================================
     5. RENDERING MESSAGES
     ====================================================================== */
  function formatTime() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    if (m < 10) m = "0" + m;
    return h + ":" + m + " " + ampm;
  }

  function appendMessage(from, text, opts) {
    opts = opts || {};
    var row = document.createElement("div");
    row.className = "pz-msg-row " + (from === "user" ? "pz-from-user" : "pz-from-bot");

    var bubble = document.createElement("div");
    bubble.className = "pz-msg-bubble";
    bubble.textContent = text; // textContent only — avoids XSS, whitespace preserved via CSS

    var time = document.createElement("div");
    time.className = "pz-msg-time";
    time.textContent = formatTime();

    row.appendChild(bubble);
    row.appendChild(time);

    if (opts.cta) {
      var ctaBtn = document.createElement("button");
      ctaBtn.className = "pz-cta-btn";
      ctaBtn.textContent = opts.cta.label;
      ctaBtn.addEventListener("click", function () {
        handleCta(opts.cta);
      });
      row.appendChild(ctaBtn);
    }

    if (opts.whatsappLink) {
      var waBtn = document.createElement("button");
      waBtn.className = "pz-cta-btn pz-cta-secondary";
      waBtn.textContent = "Continue on WhatsApp";
      waBtn.addEventListener("click", function () {
        window.open(opts.whatsappLink, "_blank", "noopener");
      });
      row.appendChild(waBtn);
    }

    els.messages.appendChild(row);
    scrollToBottom();

    if (!opts.skipHistory) {
      state.history.push({ from: from, text: text, ts: Date.now() });
      saveHistory();
    }
  }

  function showTyping() {
    var typing = document.createElement("div");
    typing.className = "pz-msg-row pz-from-bot";
    typing.id = "pzTypingRow";
    typing.innerHTML = '<div class="pz-typing"><span></span><span></span><span></span></div>';
    els.messages.appendChild(typing);
    scrollToBottom();
  }

  function hideTyping() {
    var t = document.getElementById("pzTypingRow");
    if (t) t.remove();
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderQuickReplies(intentKeys) {
    els.quickReplies.innerHTML = "";
    var items =
      intentKeys && intentKeys.length
        ? intentKeys.map(function (key) {
            var match = KB.menu.find(function (m) {
              return m.intent === key;
            });
            return match || { label: humanize(key), intent: key };
          })
        : KB.menu;

    items.forEach(function (item) {
      var chip = document.createElement("button");
      chip.className = "pz-chip";
      chip.textContent = item.label;
      chip.addEventListener("click", function () {
        handleUserInput(item.label, item.intent);
      });
      els.quickReplies.appendChild(chip);
    });
  }

  function humanize(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  /* ======================================================================
     6. INTENT MATCHING (lightweight keyword/NLU scoring — no external API)
     ====================================================================== */
  function matchIntent(rawText) {
    var text = (rawText || "").toLowerCase().trim();
    if (!text) return null;

    var bestKey = null;
    var bestScore = 0;

    Object.keys(KB.intents).forEach(function (key) {
      var intent = KB.intents[key];
      var score = 0;
      intent.keywords.forEach(function (kw) {
        if (text.indexOf(kw) !== -1) {
          // Longer, more specific keyword matches score higher.
          score += kw.split(" ").length >= 2 ? 3 : 1;
        }
      });
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    });

    return bestScore > 0 ? bestKey : null;
  }

  /* ======================================================================
     7. CONVERSATION FLOW
     ====================================================================== */
  function handleUserInput(displayText, forcedIntent) {
    if (!displayText || !displayText.trim()) return;

    appendMessage("user", displayText);
    els.quickReplies.innerHTML = "";
    showTyping();

    window.setTimeout(function () {
      hideTyping();
      var intentKey = forcedIntent || matchIntent(displayText);
      respondToIntent(intentKey);
    }, 550 + Math.random() * 350);
  }

  function respondToIntent(intentKey) {
    var intent = intentKey ? KB.intents[intentKey] : null;

    if (!intent) {
      appendMessage("bot", KB.fallback);
      renderQuickReplies();
      return;
    }

    var opts = {};
    if (intent.cta) opts.cta = intent.cta;

    appendMessage("bot", intent.reply, opts);

    if (intent.showLeadForm) {
      renderLeadForm();
    } else {
      renderQuickReplies(intent.followUp && intent.followUp.length ? intent.followUp : null);
    }
  }

  function handleCta(cta) {
    if (cta.type === "book") {
      goToBookingForm();
    }
  }

  function goToBookingForm() {
    var formEl = document.querySelector(CONFIG.bookingFormSelector);
    if (formEl) {
      closeChat();
      window.setTimeout(function () {
        formEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    } else {
      window.location.href = CONFIG.bookingPageUrl;
    }
  }

  /* ======================================================================
     8. LEAD CAPTURE FORM (name + phone -> Firestore + WhatsApp handoff)
     ====================================================================== */
  function renderLeadForm() {
    els.quickReplies.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "pz-lead-form";
    wrap.innerHTML =
      '<input type="text" id="pzLeadName" placeholder="Your name" autocomplete="name" />' +
      '<input type="tel" id="pzLeadPhone" placeholder="Your phone number" autocomplete="tel" />' +
      '<div class="pz-lead-error" id="pzLeadError">Please enter a valid name and 10-digit phone number.</div>' +
      '<button class="pz-cta-btn" id="pzLeadSubmit" type="button">Request a Call Back</button>';

    els.messages.appendChild(wrap);
    scrollToBottom();

    document.getElementById("pzLeadSubmit").addEventListener("click", function () {
      submitLead();
    });
  }

  function submitLead() {
    var nameEl = document.getElementById("pzLeadName");
    var phoneEl = document.getElementById("pzLeadPhone");
    var errorEl = document.getElementById("pzLeadError");

    var name = (nameEl.value || "").trim();
    var phone = (phoneEl.value || "").trim().replace(/\s+/g, "");
    var phoneValid = /^[6-9]\d{9}$/.test(phone.replace(/^(\+?91)/, ""));

    if (!name || !phoneValid) {
      errorEl.classList.add("pz-show");
      return;
    }
    errorEl.classList.remove("pz-show");

    var leadDoc = {
      name: name,
      phone: phone,
      lastMessage: getLastUserMessage(),
      page: window.location.href,
      timestamp: Date.now(),
      source: "chatbot",
    };

    saveLeadToFirestore(leadDoc);

    var waText = encodeURIComponent(
      "Hi PackZen, I'm " + name + ". I was chatting with your website assistant and would like help with my move."
    );
    var waLink = "https://wa.me/" + CONFIG.whatsappNumber + "?text=" + waText;

    appendMessage(
      "bot",
      "Thanks, " + name + "! Our team will call you shortly at " + phone + ". You can also message us directly right now on WhatsApp.",
      { whatsappLink: waLink }
    );

    var formNode = document.querySelector(".pz-lead-form");
    if (formNode) formNode.remove();

    renderQuickReplies();
  }

  function getLastUserMessage() {
    for (var i = state.history.length - 1; i >= 0; i--) {
      if (state.history[i].from === "user") return state.history[i].text;
    }
    return "";
  }

  function saveLeadToFirestore(leadDoc) {
    if (!CONFIG.enableFirestoreLeadCapture) return;

    try {
      // Reuses the Firebase app already initialised elsewhere on the site
      // (e.g. firebase-config.js). Does nothing if Firebase isn't loaded,
      // so the chatbot keeps working even without Firestore.
      if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) {
        return;
      }
      var db = firebase.firestore();
      db.collection(CONFIG.firestoreCollection).add(leadDoc).catch(function (err) {
        console.error("PackZen chatbot: failed to save lead", err);
      });
    } catch (e) {
      console.error("PackZen chatbot: Firestore unavailable", e);
    }
  }

  /* ======================================================================
     9. OPEN / CLOSE / TEASER
     ====================================================================== */
  function openChat() {
    state.open = true;
    els.root.classList.add("pz-open");
    els.toggleBtn.setAttribute("aria-expanded", "true");
    els.badge.classList.add("pz-hidden");
    hideTeaser();
    if (state.history.length === 0) {
      appendMessage("bot", KB.greeting);
      renderQuickReplies();
    }
    window.setTimeout(function () {
      els.input.focus();
    }, 250);
  }

  function closeChat() {
    state.open = false;
    els.root.classList.remove("pz-open");
    els.toggleBtn.setAttribute("aria-expanded", "false");
  }

  function toggleChat() {
    if (state.open) closeChat();
    else openChat();
  }

  function showTeaser() {
    if (state.open) return;
    var dismissed = window.localStorage.getItem("pzTeaserDismissed");
    if (dismissed) return;
    els.teaser.classList.add("pz-show");
    els.toggleBtn.classList.add("pz-nudge");
  }

  function hideTeaser() {
    els.teaser.classList.remove("pz-show");
    els.toggleBtn.classList.remove("pz-nudge");
  }

  function dismissTeaserPermanently() {
    hideTeaser();
    try {
      window.localStorage.setItem("pzTeaserDismissed", "1");
    } catch (e) {}
  }

  /* ======================================================================
     10. EVENT WIRING
     ====================================================================== */
  function wireEvents() {
    els.toggleBtn.addEventListener("click", toggleChat);
    els.closeBtn.addEventListener("click", closeChat);

    els.teaser.addEventListener("click", function () {
      openChat();
    });
    els.teaserDismiss.addEventListener("click", function (e) {
      e.stopPropagation();
      dismissTeaserPermanently();
    });

    els.sendBtn.addEventListener("click", submitInput);
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitInput();
      }
    });
    els.input.addEventListener("input", function () {
      els.input.style.height = "auto";
      els.input.style.height = Math.min(els.input.scrollHeight, 90) + "px";
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) closeChat();
    });

    window.setTimeout(showTeaser, CONFIG.teaserDelayMs);
  }

  function submitInput() {
    var text = els.input.value;
    if (!text || !text.trim()) return;
    els.input.value = "";
    els.input.style.height = "auto";
    handleUserInput(text.trim());
  }

  /* ======================================================================
     11. RESTORE PAST SESSION
     ====================================================================== */
  function restoreHistory() {
    var saved = loadHistory();
    if (!saved.length) return;
    state.history = saved;
    saved.forEach(function (m) {
      appendMessage(m.from, m.text, { skipHistory: true });
    });
    renderQuickReplies();
  }

  /* ======================================================================
     12. INIT
     ====================================================================== */
  function init() {
    if (document.getElementById("pz-chat-root")) return; // prevent double-injection
    buildWidget();
    wireEvents();
    restoreHistory();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
