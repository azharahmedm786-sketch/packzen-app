/**
 * PackZen — Work Gallery & Lightbox Controller (Vanilla JS, CSP-Compliant)
 */
(function (root) {
  "use strict";

  var currentIndex = 0;
  var visibleItems = [];
  var lastFocusedElement = null;

  // Initialize gallery components
  function initGallery() {
    var galleryContainer = document.querySelector("[data-pz-gallery]");
    if (!galleryContainer) return;

    var filterButtons = document.querySelectorAll("[data-gallery-filter]");
    var cards = Array.from(galleryContainer.querySelectorAll(".pz-gallery-card"));

    // Filter functionality
    filterButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var category = btn.getAttribute("data-gallery-filter");

        // Update active filter button state
        filterButtons.forEach(function (b) {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");

        // Filter cards
        var hasVisibleCards = false;
        cards.forEach(function (card) {
          var cardCategory = card.getAttribute("data-category");
          var matches = (category === "all" || cardCategory === category);
          card.style.display = matches ? "" : "none";
          if (matches) hasVisibleCards = true;
        });

        // Show/hide curation notice for categories without active photos
        var curationNotice = document.getElementById("pzGalleryCurationNotice");
        if (curationNotice) {
          var noticeCategory = curationNotice.getAttribute("data-show-for");
          if (category === "appliance" || (!hasVisibleCards && category !== "all")) {
            curationNotice.style.display = "block";
          } else {
            curationNotice.style.display = (category === "all") ? "block" : "none";
          }
        }
      });
    });

    // Lightbox triggers
    cards.forEach(function (card, idx) {
      var mediaWrap = card.querySelector(".pz-gallery-media-wrap");
      if (mediaWrap) {
        mediaWrap.setAttribute("tabindex", "0");
        mediaWrap.setAttribute("role", "button");
        mediaWrap.setAttribute("aria-label", "View larger image for " + (card.querySelector(".pz-gallery-title") ? card.querySelector(".pz-gallery-title").textContent.trim() : "project"));

        function openForCard() {
          lastFocusedElement = mediaWrap;
          openLightbox(card);
        }

        mediaWrap.addEventListener("click", openForCard);
        mediaWrap.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openForCard();
          }
        });
      }
    });

    setupLightboxControls();
  }

  function getCurrentlyVisibleCards() {
    var cards = Array.from(document.querySelectorAll(".pz-gallery-card"));
    return cards.filter(function (c) {
      return window.getComputedStyle(c).display !== "none";
    });
  }

  function openLightbox(targetCard) {
    var overlay = document.getElementById("pzLightboxOverlay");
    if (!overlay) return;

    visibleItems = getCurrentlyVisibleCards();
    currentIndex = visibleItems.indexOf(targetCard);
    if (currentIndex === -1) currentIndex = 0;

    renderLightboxContent();
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    // Focus close button initially
    var closeBtn = document.getElementById("pzLightboxClose");
    if (closeBtn) closeBtn.focus();
  }

  function closeLightbox() {
    var overlay = document.getElementById("pzLightboxOverlay");
    if (!overlay) return;

    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    // Restore focus
    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  function renderLightboxContent() {
    if (!visibleItems.length || currentIndex < 0 || currentIndex >= visibleItems.length) return;

    var card = visibleItems[currentIndex];
    var img = card.querySelector(".pz-gallery-img");
    var title = card.querySelector(".pz-gallery-title");
    var cat = card.querySelector(".pz-gallery-category-badge");
    var loc = card.querySelector(".pz-gallery-locality-badge");
    var cta = card.querySelector(".pz-gallery-cta-btn");

    var lbImg = document.getElementById("pzLightboxImg");
    var lbTitle = document.getElementById("pzLightboxTitle");
    var lbCat = document.getElementById("pzLightboxCat");
    var lbLoc = document.getElementById("pzLightboxLoc");
    var lbCounter = document.getElementById("pzLightboxCounter");
    var lbCta = document.getElementById("pzLightboxCta");

    if (lbImg && img) {
      lbImg.src = img.src;
      lbImg.alt = img.alt || "PackZen Project Photo";
    }
    if (lbTitle && title) lbTitle.textContent = title.textContent;
    if (lbCat && cat) lbCat.textContent = cat.textContent;
    if (lbLoc && loc) lbLoc.innerHTML = loc.innerHTML;
    if (lbCounter) lbCounter.textContent = (currentIndex + 1) + " of " + visibleItems.length;

    if (lbCta && cta) {
      lbCta.textContent = cta.textContent;
      lbCta.href = cta.getAttribute("href") || "#";
      // Forward onclick attribute or book handler
      if (cta.hasAttribute("onclick")) {
        lbCta.setAttribute("onclick", cta.getAttribute("onclick"));
      } else {
        lbCta.removeAttribute("onclick");
      }
    }
  }

  function prevImage() {
    if (!visibleItems.length) return;
    currentIndex = (currentIndex - 1 + visibleItems.length) % visibleItems.length;
    renderLightboxContent();
  }

  function nextImage() {
    if (!visibleItems.length) return;
    currentIndex = (currentIndex + 1) % visibleItems.length;
    renderLightboxContent();
  }

  function setupLightboxControls() {
    var overlay = document.getElementById("pzLightboxOverlay");
    if (!overlay) return;

    var closeBtn = document.getElementById("pzLightboxClose");
    var prevBtn = document.getElementById("pzLightboxPrev");
    var nextBtn = document.getElementById("pzLightboxNext");
    var lbCta = document.getElementById("pzLightboxCta");

    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    if (prevBtn) prevBtn.addEventListener("click", prevImage);
    if (nextBtn) nextBtn.addEventListener("click", nextImage);
    if (lbCta) lbCta.addEventListener("click", closeLightbox);

    // Backdrop click closes lightbox
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeLightbox();
    });

    // Keyboard navigation
    document.addEventListener("keydown", function (e) {
      if (!overlay.classList.contains("active")) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevImage();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nextImage();
      } else if (e.key === "Tab") {
        // Trap focus inside lightbox
        var focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Mobile touch swipe gestures
    var touchStartX = 0;
    var touchEndX = 0;
    var bodyArea = overlay.querySelector(".pz-lightbox-body");
    if (bodyArea) {
      bodyArea.addEventListener("touchstart", function (e) {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });

      bodyArea.addEventListener("touchend", function (e) {
        touchEndX = e.changedTouches[0].screenX;
        var diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 40) {
          if (diff > 0) nextImage();
          else prevImage();
        }
      }, { passive: true });
    }
  }

  // Preselection handler for URL parameters on load (e.g. ?book=home or ?book=office)
  function handleUrlPreselection() {
    try {
      var params = new URLSearchParams(window.location.search);
      var bookType = params.get("book");
      if (!bookType) return;

      var executed = false;
      function tryTrigger() {
        if (executed) return true;
        if (typeof root.selectMoveTypeFromHome === "function") {
          executed = true;
          setTimeout(function () {
            root.selectMoveTypeFromHome(bookType);
          }, 400);
          return true;
        }
        return false;
      }

      // 1. Try immediate execution if ready
      if (document.readyState === "complete" || document.readyState === "interactive") {
        tryTrigger();
      }

      // 2. Attach DOMContentLoaded / load fallbacks if not yet executed
      if (!executed) {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", tryTrigger);
        }
        window.addEventListener("load", tryTrigger);
      }
    } catch (e) {}
  }

  handleUrlPreselection();

  // Self-init on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGallery);
  } else {
    initGallery();
  }

  root.PackZenGallery = {
    init: initGallery,
    open: openLightbox,
    close: closeLightbox
  };
})(window);
