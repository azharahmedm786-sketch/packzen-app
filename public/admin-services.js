/**
 * PackZen Admin — Services Catalog (CRUD)
 * ---------------------------------------------------------------
 * Manages four Firestore collections from one tab:
 *   serviceCategories · services · packages · addons
 *
 * Depends on globals already defined in admin.html:
 *   requireAdmin(cb), toast(msg), waitFB(cb), window._firebase.db, firebase
 *
 * Data is kept live with onSnapshot listeners (started the first time the
 * tab is opened), so edits made in another browser appear instantly.
 */
(function () {
  "use strict";

  /* ── Tab configuration ─────────────────────────────────────── */
  const TABS = {
    categories: { coll: "serviceCategories", label: "Categories", one: "Category", hasCategory: false, hasPrice: false },
    services:   { coll: "services",          label: "Services",   one: "Service",  hasCategory: true,  hasPrice: true  },
    packages:   { coll: "packages",          label: "Packages",   one: "Package",  hasCategory: true,  hasPrice: true  },
    addons:     { coll: "addons",            label: "Add-ons",    one: "Add-on",   hasCategory: true,  hasPrice: true  },
  };

  const UNIT_LABELS = {
    fixed: "Fixed",
    starting_from: "Starting from",
    per_item: "Per item",
    per_carton: "Per carton",
    quote: "Get a quote",
  };

  const data = { categories: [], services: [], packages: [], addons: [] };
  let activeTab = "services";
  let editingId = null; // null = creating a new document
  let listening = false;
  let idTouched = false; // true once the admin types in the ID field

  /* ── Small helpers ─────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const say = (m) => (typeof toast === "function" ? toast(m) : console.log(m));

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  const byOrder = (a, b) =>
    (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""));

  const db = () => window._firebase.db;
  const now = () => firebase.firestore.FieldValue.serverTimestamp();

  function categoryName(id) {
    const c = data.categories.find((x) => x.id === id);
    return c ? c.name : null;
  }

  function formatPrice(item) {
    if (item.pricingUnit === "quote") return "Get a quote";
    const n = Number(item.basePrice);
    if (!isFinite(n)) return "—";
    const base = "₹" + n.toLocaleString("en-IN");
    switch (item.pricingUnit) {
      case "starting_from": return "From " + base;
      case "per_item": return base + " / item";
      case "per_carton": return base + " / carton";
      default: return base;
    }
  }

  /* ── Live listeners ────────────────────────────────────────── */
  function startListeners() {
    if (listening) return;
    listening = true;
    Object.keys(TABS).forEach((key) => {
      db().collection(TABS[key].coll).onSnapshot(
        (snap) => {
          data[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
          render();
        },
        (err) => {
          console.error("[catalog]", TABS[key].coll, err);
          say("❌ Could not load " + TABS[key].label + ": " + err.message);
        }
      );
    });
  }

  window.loadServicesCatalog = function () {
    waitFB(() => {
      startListeners();
      render();
    });
  };

  /* ── Rendering ─────────────────────────────────────────────── */
  function render() {
    const cfg = TABS[activeTab];
    if (!$("svcTable")) return;

    $("svcTitle").textContent = cfg.label;
    document.querySelectorAll("#svcTabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === activeTab);
    });
    Object.keys(TABS).forEach((k) => {
      const c = $("svcCount-" + k);
      if (c) c.textContent = data[k].length;
    });

    const head = $("svcHead");
    const tbody = $("svcTable");
    const rows = data[activeTab];

    if (activeTab === "categories") {
      head.innerHTML = "<tr><th>Order</th><th>Name</th><th>Items</th><th>Status</th><th>Action</th></tr>";
    } else {
      head.innerHTML = "<tr><th>Order</th><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th>Action</th></tr>";
    }

    if (!rows.length) {
      const span = activeTab === "categories" ? 5 : 6;
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="' + span + '">No ' + esc(cfg.label.toLowerCase()) +
        " yet. Click “+ Add” to create one.</td></tr>";
      return;
    }

    tbody.innerHTML = rows.map((r) => {
      const status =
        '<span class="badge ' + (r.isActive ? "badge-delivered" : "badge-pending") + '">' +
        (r.isActive ? "Active" : "Inactive") + "</span>";
      const actions =
        '<button class="btn-sm btn-assign" data-act="edit" data-id="' + esc(r.id) + '">Edit</button> ' +
        '<button class="btn-sm btn-assign" data-act="toggle" data-id="' + esc(r.id) + '">' + (r.isActive ? "Pause" : "Activate") + "</button> " +
        '<button class="btn-sm" style="background:rgba(229,62,62,.1);color:#e53e3e" data-act="delete" data-id="' + esc(r.id) + '">Delete</button>';

      if (activeTab === "categories") {
        const used = ["services", "packages", "addons"]
          .reduce((n, k) => n + data[k].filter((x) => x.categoryId === r.id).length, 0);
        return (
          "<tr><td>" + esc(r.displayOrder) + "</td>" +
          "<td><strong>" + esc(r.icon || "") + " " + esc(r.name) + "</strong><br><small style='color:var(--text-muted)'>" + esc(r.id) + "</small></td>" +
          "<td>" + used + "</td><td>" + status + "</td><td>" + actions + "</td></tr>"
        );
      }

      const cat = categoryName(r.categoryId);
      return (
        "<tr><td>" + esc(r.displayOrder) + "</td>" +
        "<td><strong>" + esc(r.name) + "</strong>" +
        (r.description ? "<br><small style='color:var(--text-muted)'>" + esc(r.description) + "</small>" : "") + "</td>" +
        "<td>" + (cat ? esc(cat) : "<span style='color:#e53e3e'>⚠ missing</span>") + "</td>" +
        "<td>" + esc(formatPrice(r)) + "</td><td>" + status + "</td><td>" + actions + "</td></tr>"
      );
    }).join("");
  }

  // One click handler for all row buttons (no inline ids in HTML strings).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("#svcTable [data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "edit") svcOpenModal(id);
    else if (btn.dataset.act === "toggle") toggleActive(id);
    else if (btn.dataset.act === "delete") removeItem(id);
  });

  window.svcSwitchTab = function (tab) {
    if (!TABS[tab]) return;
    activeTab = tab;
    render();
  };

  /* ── Modal ─────────────────────────────────────────────────── */
  function fillCategorySelect(selectedId) {
    const sel = $("svcCategory");
    const options = data.categories.map((c) =>
      '<option value="' + esc(c.id) + '"' + (c.id === selectedId ? " selected" : "") + ">" +
      esc((c.icon ? c.icon + " " : "") + c.name) + (c.isActive ? "" : " (inactive)") + "</option>"
    );
    sel.innerHTML = options.length
      ? options.join("")
      : '<option value="">— create a category first —</option>';
  }

  window.svcOpenModal = function (id) {
    const cfg = TABS[activeTab];

    if (cfg.hasCategory && !data.categories.length) {
      say("⚠️ Create a category first (Categories tab).");
      return;
    }

    const item = id ? data[activeTab].find((x) => x.id === id) : null;
    if (id && !item) { say("⚠️ Item not found."); return; }

    editingId = item ? item.id : null;
    idTouched = !!item;

    $("svcModalTitle").textContent = (item ? "Edit " : "Add ") + cfg.one;
    $("svcName").value = item ? item.name || "" : "";
    $("svcDesc").value = item ? item.description || "" : "";
    $("svcOrder").value = item && item.displayOrder != null
      ? item.displayOrder
      : data[activeTab].length + 1;
    $("svcActive").checked = item ? !!item.isActive : true;

    $("svcId").value = item ? item.id : "";
    $("svcId").disabled = !!item;

    $("svcCategoryWrap").style.display = cfg.hasCategory ? "" : "none";
    $("svcPriceWrap").style.display = cfg.hasPrice ? "" : "none";
    $("svcUnitWrap").style.display = cfg.hasPrice ? "" : "none";
    $("svcIconWrap").style.display = cfg.hasPrice ? "none" : "";
    $("svcIcon").value = item ? item.icon || "" : "";

    if (cfg.hasCategory) fillCategorySelect(item ? item.categoryId : (data.categories[0] || {}).id);
    if (cfg.hasPrice) {
      $("svcPrice").value = item && item.basePrice != null ? item.basePrice : "";
      $("svcUnit").value = item && item.pricingUnit ? item.pricingUnit : "fixed";
    }

    $("svcSaveBtn").disabled = false;
    $("svcSaveBtn").textContent = "Save";
    $("svcModal").classList.add("open");
    setTimeout(() => $("svcName").focus(), 50);
  };

  window.svcCloseModal = function () {
    $("svcModal").classList.remove("open");
    editingId = null;
  };

  // Auto-suggest the ID from the name until the admin edits the ID by hand.
  document.addEventListener("input", (e) => {
    if (!e.target) return;
    if (e.target.id === "svcId") idTouched = true;
    if (e.target.id === "svcName" && !editingId && !idTouched) {
      $("svcId").value = slugify(e.target.value);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("svcModal") && $("svcModal").classList.contains("open")) svcCloseModal();
  });

  /* ── Create / update ───────────────────────────────────────── */
  window.svcSave = function () {
    requireAdmin(async () => {
      const cfg = TABS[activeTab];
      const name = $("svcName").value.trim();
      if (!name) { say("⚠️ Name is required"); return; }

      const payload = {
        name,
        description: $("svcDesc").value.trim(),
        displayOrder: Number($("svcOrder").value) || 0,
        isActive: $("svcActive").checked,
        updatedAt: now(),
      };

      if (cfg.hasCategory) {
        const categoryId = $("svcCategory").value;
        if (!categoryId) { say("⚠️ Choose a category"); return; }
        payload.categoryId = categoryId;
      }

      if (cfg.hasPrice) {
        const raw = $("svcPrice").value;
        const price = Number(raw);
        if (raw === "" || !isFinite(price) || price < 0) { say("⚠️ Enter a valid base price (0 or more)"); return; }
        payload.basePrice = Math.round(price);
        payload.pricingUnit = $("svcUnit").value;
      } else {
        payload.icon = $("svcIcon").value.trim();
      }

      const id = editingId || slugify($("svcId").value || name);
      if (!id) { say("⚠️ Could not build an ID — add letters or numbers"); return; }

      const btn = $("svcSaveBtn");
      btn.disabled = true;
      btn.textContent = "Saving…";

      try {
        const ref = db().collection(cfg.coll).doc(id);

        if (!editingId) {
          const existing = await ref.get();
          if (existing.exists) {
            say("⚠️ ID “" + id + "” already exists — pick a different ID or edit the existing item.");
            btn.disabled = false;
            btn.textContent = "Save";
            return;
          }
          payload.createdAt = now();
        }

        await ref.set(payload, { merge: true });
        say(editingId ? "✅ " + cfg.one + " updated" : "✅ " + cfg.one + " created");
        svcCloseModal();
      } catch (err) {
        console.error("[catalog] save failed", err);
        say("❌ " + err.message);
        btn.disabled = false;
        btn.textContent = "Save";
      }
    });
  };

  /* ── Toggle / delete ───────────────────────────────────────── */
  function toggleActive(id) {
    requireAdmin(() => {
      const cfg = TABS[activeTab];
      const item = data[activeTab].find((x) => x.id === id);
      if (!item) return;
      const next = !item.isActive;
      db().collection(cfg.coll).doc(id).update({ isActive: next, updatedAt: now() })
        .then(() => say(next ? "✅ " + cfg.one + " activated" : "⏸ " + cfg.one + " paused"))
        .catch((err) => say("❌ " + err.message));
    });
  }

  function removeItem(id) {
    requireAdmin(() => {
      const cfg = TABS[activeTab];
      const item = data[activeTab].find((x) => x.id === id);
      if (!item) return;

      // Don't orphan items: a category still in use can only be paused.
      if (activeTab === "categories") {
        const inUse = ["services", "packages", "addons"]
          .reduce((n, k) => n + data[k].filter((x) => x.categoryId === id).length, 0);
        if (inUse) {
          say("⚠️ " + inUse + " item(s) still use this category. Move or delete them first, or just pause the category.");
          return;
        }
      }

      if (!confirm("Delete “" + item.name + "”? This cannot be undone.\n\nTip: use Pause to hide it without deleting.")) return;

      db().collection(cfg.coll).doc(id).delete()
        .then(() => say("🗑️ " + cfg.one + " deleted"))
        .catch((err) => say("❌ " + err.message));
    });
  }
})();
