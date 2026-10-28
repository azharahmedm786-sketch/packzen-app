/** UAT round 1 fixes (Oct 2026).  node test/uat-round1.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path"); const vm = require("vm");
const root = path.join(__dirname, "..", ".."), pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

// 1. saved addresses: rules exist (owner-only, validated); booking form shows them
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
assert.ok(/match \/users\/\{uid\}\/addresses\/\{addrId\} \{\s*allow read, delete: if isOwner\(uid\);\s*allow create, update: if isOwner\(uid\)/.test(rules));
assert.ok(/hasOnly\(\['address', 'label', 'createdAt'\]\)/.test(rules) && /address\.size\(\) <= 300/.test(rules));
const js = pub("script.js");
assert.ok(/function renderSavedAddressChips\(\)/.test(js) && /renderSavedAddressChips\(\)/.test(pub("index.html")));
ok("saved addresses: owner-only Firestore rule (was missing → every save refused) + one-tap chips in the booking form");

// 2. crew app: deactivated partners blocked; admin-created drivers active; one-tap (de)activate
const drv = pub("driver.html"), adm = pub("admin.html");
assert.ok(/window\.pzCrewGate = function/.test(drv) && /status === "suspended"/.test(drv) && (drv.match(/pzCrewGate\(/g) || []).length >= 2);
assert.ok(/function setDriverActive\(uid, active\)/.test(adm) && /status: active \? "active" : "suspended"/.test(adm));
assert.ok(/adminUpsertDriverProfile"\)\(\{ uid: driverUid, profile: \{ status: "active"/.test(adm));
ok("crew app: suspended partners can't sign in; admin-created drivers get an active profile; Deactivate/Activate buttons");

// 3. leads app: owner emails get in; read errors are shown
const la = pub("leads-app/app.js");
assert.ok(/OWNER = \["azharahmedm786@gmail\.com"/.test(la) && /Could not load leads/.test(la));
for (const e of ["azharahmedm786@gmail.com", "azharahmednaz@gmail.com", "moveeasyblr@gmail.com"]) assert.ok(rules.includes("'" + e + "'") && la.includes('"' + e + '"'), e);
ok("leads app: owner allow-list matches firestore.rules; permission errors are visible instead of an empty list");

// 4. digital enquiries emailed immediately
const lq = fs.readFileSync(path.join(__dirname, "..", "lead-quality.js"), "utf8");
assert.ok(/!change\.before\.exists && isDigital && q\.tier !== "junk"/.test(lq) && /New PackZen Digital enquiry/.test(lq));
ok("every new PackZen Digital enquiry triggers an admin email");

// 5. admin bookings: filters, period revenue, CSV
const start = adm.indexOf("function _bType(b)"), end = adm.indexOf('// "Delivered" can\'t be written from the browser');
const exStart = adm.indexOf("function exportCSV() {"), exEnd = adm.indexOf("\nfunction viewBooking(id) {");
const els = { filterStatus: { value: "all" }, filterType: { value: "all" }, filterFrom: { value: "" }, filterTo: { value: "" }, searchInput: { value: "" }, bookingPeriodSummary: { innerHTML: "" } };
let downloaded = null; const toasts = [];
const ctx = { document: { getElementById: (id) => els[id] || null, createElement: () => ({ click() { downloaded = this; }, remove() {} }), body: { appendChild() {} } },
  renderBookingsTable() {}, toast: (t) => toasts.push(t), Blob: function (parts) { this.text = parts.join(""); }, URL: { createObjectURL: (b) => (ctx._blob = b, "blob:x"), revokeObjectURL() {} }, setTimeout() {},
  allBookings: [
    { id: "a1", bookingRef: "PZ1", customerName: "Asha, K", phone: "9845012345", date: "2026-10-05", total: 6500, paid: 650, balanceDue: 5850, status: "confirmed", pickup: 'HSR "Layout"' },
    { id: "a2", bookingRef: "PZ2", customerName: "Ravi", phone: "9123456780", date: "2026-10-20", total: 449, paid: 449, status: "delivered", bookingType: "service" },
    { id: "a3", bookingRef: "PZ3", customerName: "Meera", phone: "9988776655", date: "2026-11-02", total: 4000, status: "cancelled" } ], filteredBookings: [] };
vm.createContext(ctx); vm.runInContext("var filteredBookings = []; var allBookings = this.allBookings;" + adm.slice(start, end) + adm.slice(exStart, exEnd), ctx);
els.filterFrom.value = "2026-10-01"; els.filterTo.value = "2026-10-31"; vm.runInContext("filterBookings('')", ctx);
assert.strictEqual(vm.runInContext("filteredBookings.length", ctx), 2);
assert.ok(/₹6,949/.test(els.bookingPeriodSummary.innerHTML) && /Paid online <b>₹1,099/.test(els.bookingPeriodSummary.innerHTML) && /Completed <b>1<\/b>/.test(els.bookingPeriodSummary.innerHTML));
els.filterType.value = "service"; vm.runInContext("filterBookings('')", ctx); assert.strictEqual(vm.runInContext("filteredBookings.length", ctx), 1);
els.filterType.value = "all"; els.filterStatus.value = "completed"; vm.runInContext("filterBookings('')", ctx); assert.strictEqual(vm.runInContext("filteredBookings[0].id", ctx), "a2");
ok("admin bookings: date range, service type and status filters; revenue summary for the selected period");
els.filterStatus.value = "all"; vm.runInContext("filterBookings(''); exportCSV()", ctx);
const csv = ctx._blob.text;
assert.ok(csv.charCodeAt(0) === 0xfeff && /^\ufeffBooking ref,/.test(csv) && csv.includes('"Asha, K"') && csv.includes('"HSR ""Layout"""') && downloaded && /\.csv$/.test(downloaded.download));
assert.strictEqual(csv.trim().split("\r\n").length, 3);
ok("CSV export: Excel-safe UTF-8, proper quoting (commas/quotes), exactly the filtered rows, Blob download");
console.log(`\nuat-round1: ${pass} passed, 0 failed`);
