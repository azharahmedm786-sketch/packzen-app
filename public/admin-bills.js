/* PackZen admin — manual bills (invoices for walk-in / offline / extra work).
 * Numbering: settings/billCounter in a transaction → PZB-<year>-0001 (resets each year).
 * Bills are never deleted (mark "Cancelled" = void) so numbering stays continuous.
 * Totals are recomputed here from the line items before saving; a bill shows the
 * business details saved under "Business details on bills". Print → "Save as PDF". */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  var rup = function (n) { return "₹" + (Math.round(num(n) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
  var db = function () { return window._firebase.db; };
  var BILLS = [], BIZ = null, rows = [{ d: "", q: 1, r: "" }];
  var STATUS = { unpaid: "Unpaid", partial: "Partly paid", paid: "Paid", void: "Cancelled" };
  var METHODS = ["Cash", "UPI", "Bank transfer", "Card", "Razorpay"];

  (function css() {
    var st = document.createElement("style");
    st.textContent = ".pz-bill-row{display:grid;grid-template-columns:minmax(0,3fr) minmax(60px,.8fr) minmax(80px,1.2fr) minmax(80px,1fr) 36px;gap:6px;align-items:center;margin-bottom:8px}" +
      "@media (max-width:600px){.pz-bill-row{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr) 36px;padding-bottom:8px;border-bottom:1px dashed #d6e2dc}.pz-bill-row > :first-child{grid-column:1 / -1}}";
    document.head.appendChild(st);
  })();
  function today() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }
  function calc(items, discount, taxPct) {
    var sub = items.reduce(function (t, it) { return t + num(it.qty) * num(it.rate); }, 0);
    var disc = Math.min(Math.max(0, num(discount)), sub);
    var tax = Math.round((sub - disc) * Math.max(0, Math.min(28, num(taxPct)))) / 100;
    return { subtotal: Math.round(sub * 100) / 100, discount: disc, tax: tax, total: Math.round((sub - disc + tax) * 100) / 100 };
  }

  /* ---------- form ---------- */
  function formHTML() {
    return '<div class="driver-form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">' +
      field("bCust", "Customer name *", "text") + field("bPhone", "Phone", "tel") + field("bEmail", "E-mail", "email") + field("bDate", "Bill date *", "date", today()) +
      '</div>' + field("bAddr", "Customer address", "text") + field("bRef", "Booking ref (optional)", "text") +
      '<div style="font-weight:700;margin:12px 0 6px">Items</div><div id="bRows"></div>' +
      '<button type="button" class="btn-export" onclick="pzBillAddRow()">+ Add item</button>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:12px">' +
      field("bDisc", "Discount (₹)", "number", "0") + field("bTax", "GST % (only if GST-registered)", "number", "0") +
      '<label style="font-size:.82rem;font-weight:600">Payment<select id="bStatus" class="status-sel" style="display:block;width:100%;margin-top:4px"><option value="unpaid">Unpaid</option><option value="partial">Partly paid</option><option value="paid">Paid in full</option></select></label>' +
      field("bPaid", "Amount received (₹)", "number", "0") +
      '<label style="font-size:.82rem;font-weight:600">Method<select id="bMethod" class="status-sel" style="display:block;width:100%;margin-top:4px">' + METHODS.map(function (m) { return "<option>" + m + "</option>"; }).join("") + '</select></label>' +
      '</div>' + field("bNotes", "Notes on the bill (optional)", "text") +
      '<div id="bTotals" class="period-summary" style="margin:12px 0;border-radius:12px"></div>' +
      '<p id="bErr" style="color:#B42318;font-weight:600;min-height:1.2em;margin:4px 0"></p>' +
      '<button type="button" class="btn-primary-sm" id="bSave" onclick="pzBillSave()">💾 Create bill</button>';
  }
  function field(id, label, type, val) {
    return '<label style="display:block;font-size:.82rem;font-weight:600;margin-top:6px">' + esc(label) +
      '<input id="' + id + '" type="' + type + '"' + (type === "number" ? ' min="0" step="0.01"' : "") + ' value="' + esc(val || "") + '" style="display:block;width:100%;margin-top:4px;padding:9px 10px;border:1px solid #d6e2dc;border-radius:10px;font:inherit;font-size:16px"></label>';
  }
  function renderRows() {
    var box = $("bRows"); if (!box) return;
    box.innerHTML = rows.map(function (r, i) {
      return '<div class="pz-bill-row">' +
        '<input data-i="' + i + '" data-k="d" placeholder="Description (e.g. 2 BHK move HSR → Whitefield)" value="' + esc(r.d) + '" style="padding:9px;border:1px solid #d6e2dc;border-radius:10px;font:inherit;font-size:16px;min-width:0">' +
        '<input data-i="' + i + '" data-k="q" type="number" min="0" step="1" placeholder="Qty" value="' + esc(r.q) + '" style="padding:9px;border:1px solid #d6e2dc;border-radius:10px;font:inherit;font-size:16px;min-width:0">' +
        '<input data-i="' + i + '" data-k="r" type="number" min="0" step="0.01" placeholder="Rate ₹" value="' + esc(r.r) + '" style="padding:9px;border:1px solid #d6e2dc;border-radius:10px;font:inherit;font-size:16px;min-width:0">' +
        '<div style="text-align:right;font-weight:700">' + rup(num(r.q) * num(r.r)) + '</div>' +
        '<button type="button" aria-label="Remove item" onclick="pzBillDelRow(' + i + ')" style="border:0;background:#FDECEC;color:#B42318;border-radius:8px;height:34px;cursor:pointer">✕</button></div>';
    }).join("");
    updateTotals();
  }
  function currentItems() { return rows.filter(function (r) { return String(r.d).trim() && num(r.q) > 0; }).map(function (r) { return { desc: String(r.d).trim().slice(0, 200), qty: num(r.q), rate: Math.max(0, num(r.r)) }; }); }
  function updateTotals() {
    var t = calc(currentItems(), $("bDisc") && $("bDisc").value, $("bTax") && $("bTax").value);
    var st = $("bStatus") ? $("bStatus").value : "unpaid";
    if (st === "paid" && $("bPaid")) $("bPaid").value = t.total;
    var paid = Math.min(num($("bPaid") && $("bPaid").value), t.total);
    if ($("bTotals")) $("bTotals").innerHTML = "Subtotal <b>" + rup(t.subtotal) + "</b>" + (t.discount ? " · Discount −" + rup(t.discount) : "") + (t.tax ? " · GST " + rup(t.tax) : "") +
      " · <b>Total " + rup(t.total) + "</b> · Received " + rup(paid) + " · Balance <b>" + rup(Math.max(0, t.total - paid)) + "</b>";
  }
  document.addEventListener("input", function (e) {
    var t = e.target; if (!t.closest || !t.closest("#billForm")) return;
    if (t.dataset && t.dataset.i != null) { rows[+t.dataset.i][t.dataset.k] = t.value; if (t.dataset.k !== "d") { var tot = t.closest("div").children[3]; if (tot) tot.textContent = rup(num(rows[+t.dataset.i].q) * num(rows[+t.dataset.i].r)); } }
    updateTotals();
  });
  document.addEventListener("change", function (e) { if (e.target && e.target.id === "bStatus") updateTotals(); });
  window.pzBillAddRow = function () { if (rows.length < 50) rows.push({ d: "", q: 1, r: "" }); renderRows(); };
  window.pzBillDelRow = function (i) { rows.splice(i, 1); if (!rows.length) rows.push({ d: "", q: 1, r: "" }); renderRows(); };

  /* ---------- save (transactional numbering) ---------- */
  window.pzBillSave = function () {
    var err = $("bErr"); err.textContent = "";
    var name = $("bCust").value.trim(), items = currentItems();
    if (name.length < 2) { err.textContent = "Enter the customer's name."; return; }
    if (!items.length) { err.textContent = "Add at least one item with a description and quantity."; return; }
    if (!$("bDate").value) { err.textContent = "Choose the bill date."; return; }
    var phone = $("bPhone").value.replace(/\D/g, "").slice(-10);
    if ($("bPhone").value && !/^[6-9]\d{9}$/.test(phone)) { err.textContent = "Check the phone number (10 digits)."; return; }
    var t = calc(items, $("bDisc").value, $("bTax").value);
    var status = $("bStatus").value, paid = Math.min(num($("bPaid").value), t.total);
    if (status === "paid") paid = t.total; else if (status === "partial" && !(paid > 0 && paid < t.total)) { err.textContent = "For 'Partly paid', enter an amount between ₹0 and the total."; return; }
    else if (status === "unpaid") paid = 0;
    var btn = $("bSave"); btn.disabled = true; btn.textContent = "Saving…";
    var year = new Date(Date.now() + 5.5 * 3600e3).getUTCFullYear();
    var cRef = db().collection("settings").doc("billCounter"), bRef = db().collection("bills").doc();
    db().runTransaction(function (tx) {
      return tx.get(cRef).then(function (c) {
        var d = c.exists ? c.data() : {}, next = d.year === year && Number.isInteger(d.next) ? d.next : 1;
        var billNo = "PZB-" + year + "-" + String(next).padStart(4, "0");
        var bill = { billNo: billNo, date: $("bDate").value, customer: { name: name.slice(0, 80), phone: phone || null, email: ($("bEmail").value || "").trim().slice(0, 120) || null, address: ($("bAddr").value || "").trim().slice(0, 300) || null },
          bookingRef: ($("bRef").value || "").trim().slice(0, 40) || null, items: items, subtotal: t.subtotal, discount: t.discount, taxPct: Math.max(0, Math.min(28, num($("bTax").value))), tax: t.tax, total: t.total,
          paid: paid, balance: Math.round((t.total - paid) * 100) / 100, status: status, payments: paid > 0 ? [{ amount: paid, method: $("bMethod").value, at: new Date().toISOString() }] : [],
          notes: ($("bNotes").value || "").trim().slice(0, 300) || null, createdBy: (window._firebase.auth.currentUser || {}).email || "admin", createdAt: firebase.firestore.FieldValue.serverTimestamp() };
        tx.set(cRef, { next: next + 1, year: year });
        tx.set(bRef, bill);
        return bill;
      });
    }).then(function (bill) {
      btn.disabled = false; btn.textContent = "💾 Create bill";
      rows = [{ d: "", q: 1, r: "" }]; $("billForm").innerHTML = formHTML(); renderRows();
      if (typeof toast === "function") toast("✅ Bill " + bill.billNo + " created");
      pzLoadBills(function () { window.pzBillPrint(bRef.id); });
    }).catch(function (e) { btn.disabled = false; btn.textContent = "💾 Create bill"; err.textContent = "Could not save: " + (e && e.message); });
  };

  /* ---------- list ---------- */
  window.pzLoadBills = function (after) {
    if (!$("billForm").innerHTML) { $("billForm").innerHTML = formHTML(); renderRows(); }
    Promise.all([db().collection("bills").orderBy("createdAt", "desc").limit(300).get(), db().collection("settings").doc("billing").get().catch(function () { return null; })])
      .then(function (r) { BILLS = r[0].docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); BIZ = r[1] && r[1].exists ? r[1].data() : {}; window.pzRenderBills(); if (after) after(); })
      .catch(function (e) { $("billList").innerHTML = '<div class="empty-td">Could not load bills: ' + esc(e.message) + "</div>"; });
  };
  window.pzRenderBills = function () {
    var q = ($("billSearch").value || "").toLowerCase(), f = $("billFilter").value;
    var list = BILLS.filter(function (b) {
      if (f !== "all" && b.status !== f) return false;
      return !q || [b.billNo, b.customer && b.customer.name, b.customer && b.customer.phone, b.bookingRef].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    var live = list.filter(function (b) { return b.status !== "void"; });
    var tot = live.reduce(function (s, b) { return s + num(b.total); }, 0), rec = live.reduce(function (s, b) { return s + num(b.paid); }, 0);
    $("billSummary").innerHTML = "<b>" + list.length + "</b> bills · Billed <b>" + rup(tot) + "</b> · Received <b>" + rup(rec) + "</b> · Outstanding <b>" + rup(tot - rec) + "</b>";
    $("billList").innerHTML = list.length ? '<table><thead><tr><th>Bill no</th><th>Date</th><th>Customer</th><th>Total</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>' + list.map(function (b) {
      var col = b.status === "paid" ? "#147A45" : b.status === "void" ? "#6B7D74" : b.status === "partial" ? "#A86400" : "#B42318";
      return "<tr><td><b>" + esc(b.billNo) + "</b>" + (b.bookingRef ? '<br><small>' + esc(b.bookingRef) + "</small>" : "") + "</td><td>" + esc(b.date) + "</td><td>" + esc(b.customer && b.customer.name) + (b.customer && b.customer.phone ? "<br><small>" + esc(b.customer.phone) + "</small>" : "") +
        "</td><td>" + rup(b.total) + "</td><td>" + rup(b.paid) + '</td><td style="color:' + col + ';font-weight:700">' + (STATUS[b.status] || b.status) + '</td><td style="white-space:nowrap">' +
        '<button class="btn-export" onclick="pzBillPrint(\'' + b.id + '\')">🖨 Print / PDF</button> ' +
        (b.customer && b.customer.phone ? '<button class="btn-export" onclick="pzBillWhatsApp(\'' + b.id + '\')">WhatsApp</button> ' : "") +
        (b.status === "unpaid" || b.status === "partial" ? '<button class="btn-export" onclick="pzBillPayment(\'' + b.id + '\')">+ Payment</button> ' : "") +
        (b.status !== "void" ? '<button class="btn-export" onclick="pzBillVoid(\'' + b.id + '\')">Cancel</button>' : "") + "</td></tr>";
    }).join("") + "</tbody></table>" : '<div class="empty-td">No bills yet — create one above.</div>';
  };
  function find(id) { return BILLS.filter(function (b) { return b.id === id; })[0]; }

  /* ---------- payments / cancel ---------- */
  window.pzBillPayment = function (id) {
    var b = find(id); if (!b) return;
    var due = Math.round((num(b.total) - num(b.paid)) * 100) / 100;
    var amt = num(prompt("Payment received for " + b.billNo + " (balance " + rup(due) + "):", due)); if (!(amt > 0)) return;
    amt = Math.min(amt, due);
    var method = prompt("Method (" + METHODS.join(" / ") + "):", "UPI") || "Cash";
    var paid = Math.round((num(b.paid) + amt) * 100) / 100, status = paid >= num(b.total) ? "paid" : "partial";
    db().collection("bills").doc(id).update({ paid: paid, balance: Math.round((num(b.total) - paid) * 100) / 100, status: status,
      payments: (b.payments || []).concat([{ amount: amt, method: String(method).slice(0, 20), at: new Date().toISOString() }]), billNo: b.billNo, total: b.total, items: b.items })
      .then(function () { if (typeof toast === "function") toast("✅ Payment recorded"); pzLoadBills(); }).catch(function (e) { alert("Could not save: " + e.message); });
  };
  window.pzBillVoid = function (id) {
    var b = find(id); if (!b || !confirm("Cancel bill " + b.billNo + "? It stays in the list as Cancelled (bills are never deleted).")) return;
    db().collection("bills").doc(id).update({ status: "void", billNo: b.billNo, total: b.total, items: b.items, voidedAt: new Date().toISOString() })
      .then(function () { pzLoadBills(); }).catch(function (e) { alert("Could not cancel: " + e.message); });
  };

  /* ---------- business details shown on bills ---------- */
  window.pzBillBusinessDetails = function () {
    var cur = BIZ || {};
    var addr = prompt("Business address on bills:", cur.address || "Bangalore, Karnataka"); if (addr === null) return;
    var gst = prompt("GSTIN (leave empty if not GST-registered):", cur.gstin || ""); if (gst === null) return;
    var upi = prompt("UPI ID for payment (optional):", cur.upi || ""); if (upi === null) return;
    db().collection("settings").doc("billing").set({ address: addr.slice(0, 200), gstin: gst.trim().toUpperCase().slice(0, 15), upi: upi.trim().slice(0, 60) }, { merge: true })
      .then(function () { BIZ = Object.assign({}, cur, { address: addr, gstin: gst.trim().toUpperCase(), upi: upi.trim() }); if (typeof toast === "function") toast("✅ Saved — shown on new prints"); });
  };

  /* ---------- print / PDF and WhatsApp ---------- */
  window.pzBillPrint = function (id) {
    var b = find(id); if (!b) return;
    var biz = BIZ || {}, c = b.customer || {};
    var w = window.open("", "_blank"); if (!w) { alert("Allow pop-ups to print the bill."); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(b.billNo) + ' — PackZen</title><style>' +
      'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1A14;margin:0;padding:32px;max-width:800px}h1{margin:0;font-size:22px}.muted{color:#5b6b63;font-size:13px}' +
      'table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:9px 6px;border-bottom:1px solid #e3eee8;text-align:left;font-size:14px}th{background:#f3faf6}.r{text-align:right}' +
      '.tot td{border:0;padding:4px 6px}.big{font-size:18px;font-weight:800}.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:12px;background:#eef2f0}' +
      '.void{color:#B42318;font-weight:800;font-size:20px;border:2px solid #B42318;display:inline-block;padding:4px 10px;transform:rotate(-4deg)}@media print{.noprint{display:none}body{padding:0}}</style></head><body>' +
      '<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start"><div><h1>PackZen</h1><div class="muted">' + esc(biz.address || "Bangalore, Karnataka") + '<br>+91 99450 95453 · moveeasyblr@gmail.com · packzenblr.in' + (biz.gstin ? "<br>GSTIN: " + esc(biz.gstin) : "") + '</div></div>' +
      '<div style="text-align:right"><div class="big">' + (num(b.tax) > 0 ? "TAX INVOICE" : "BILL") + '</div><div><b>' + esc(b.billNo) + '</b></div><div class="muted">Date: ' + esc(b.date) + (b.bookingRef ? "<br>Booking: " + esc(b.bookingRef) : "") + '</div></div></div>' +
      (b.status === "void" ? '<p class="void">CANCELLED</p>' : "") +
      '<div style="margin-top:18px"><div class="muted">Bill to</div><b>' + esc(c.name) + '</b><div class="muted">' + [c.phone, c.email, c.address].filter(Boolean).map(esc).join("<br>") + '</div></div>' +
      '<table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>' +
      (b.items || []).map(function (it, i) { return "<tr><td>" + (i + 1) + "</td><td>" + esc(it.desc) + '</td><td class="r">' + esc(it.qty) + '</td><td class="r">' + rup(it.rate) + '</td><td class="r">' + rup(num(it.qty) * num(it.rate)) + "</td></tr>"; }).join("") + "</tbody></table>" +
      '<table class="tot" style="width:320px;margin-left:auto;margin-top:10px"><tr><td>Subtotal</td><td class="r">' + rup(b.subtotal) + "</td></tr>" +
      (num(b.discount) ? "<tr><td>Discount</td><td class=\"r\">−" + rup(b.discount) + "</td></tr>" : "") + (num(b.tax) ? "<tr><td>GST @ " + esc(b.taxPct) + '%</td><td class="r">' + rup(b.tax) + "</td></tr>" : "") +
      '<tr><td class="big">Total</td><td class="r big">' + rup(b.total) + '</td></tr><tr><td>Received</td><td class="r">' + rup(b.paid) + '</td></tr><tr><td><b>Balance due</b></td><td class="r"><b>' + rup(b.balance) + "</b></td></tr></table>" +
      '<p><span class="badge">' + esc(STATUS[b.status] || b.status) + "</span>" + ((b.payments || []).length ? ' <span class="muted">Payments: ' + b.payments.map(function (p) { return rup(p.amount) + " by " + esc(p.method); }).join(", ") + "</span>" : "") + "</p>" +
      (biz.upi && num(b.balance) > 0 ? '<p class="muted">Pay by UPI: <b>' + esc(biz.upi) + "</b></p>" : "") + (b.notes ? '<p class="muted">' + esc(b.notes) + "</p>" : "") +
      '<p class="muted" style="margin-top:28px">Thank you for choosing PackZen. This is a computer-generated bill.</p>' +
      '<p class="noprint"><button onclick="window.print()" style="padding:10px 18px;border-radius:999px;border:0;background:#1F9D5C;color:#fff;font-weight:700;cursor:pointer">🖨 Print / Save as PDF</button></p>' +
      "</body></html>");
    w.document.close(); setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
  };
  window.pzBillWhatsApp = function (id) {
    var b = find(id); if (!b || !b.customer || !b.customer.phone) return;
    var msg = "Hi " + String(b.customer.name || "").split(" ")[0] + ", here is your PackZen bill " + b.billNo + " dated " + b.date + ":\n" +
      (b.items || []).map(function (it) { return "• " + it.desc + " — " + it.qty + " × " + rup(it.rate); }).join("\n") +
      "\nTotal: " + rup(b.total) + "\nReceived: " + rup(b.paid) + "\nBalance due: " + rup(b.balance) + ((BIZ && BIZ.upi && num(b.balance) > 0) ? "\nPay by UPI: " + BIZ.upi : "") + "\nThank you — PackZen, 99450 95453";
    window.open("https://wa.me/91" + b.customer.phone + "?text=" + encodeURIComponent(msg), "_blank", "noopener");
  };
})();
