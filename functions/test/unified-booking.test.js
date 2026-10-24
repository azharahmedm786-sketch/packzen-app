/**
 * Unified booking: one Book picker on every customer page, one admin Operations
 * board for all services, one My Bookings list with filters and add-ons.
 *   node test/unified-booking.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

const leads = pub("pz-leads.js");
for (const id of ["move", "office", "vehicle", "ac", "appliance"]) assert.ok(leads.includes('id: "' + id + '"'), id);
for (const id of ["parcel", "home", "cleaning", "website", "painting", "tv"]) assert.ok(!leads.includes('id: "' + id + '"'), "retired/separated " + id);
assert.ok(/window\.pzOpenBook = function/.test(leads) && /pzHeaderBook/.test(leads) && /bnavBook/.test(leads) && /book=move/.test(leads));
assert.ok(!/location\.href = "\/parcel\.html"/.test(leads) && /services\.html\?category=/.test(leads));
assert.ok(!leads.includes('id: "cleaning"')); ok("Book picker: 5 services (no cleaning, parcel, handyman, painting or TV mounting; websites live in PackZen Digital), header button on every page, bottom-nav Book opens it, ?book=move opens the moving form");

const adm = pub("admin.html");
assert.ok(/id="sectionOps"/.test(adm) && /function loadOps/.test(adm) && /function opsRender/.test(adm));
assert.ok(/where\("date", ">=", _oday\(-7\)\)\.orderBy\("date"\)/.test(adm));
for (const c of ['id: "new"', 'id: "assigned"', 'id: "active"', 'id: "done"']) assert.ok(adm.includes(c), c);
assert.ok(/openAssignModal\(/.test(adm) && /updateStatus\(/.test(adm) && /refundPendingAmount/.test(adm) && /balanceDue/.test(adm));
assert.ok(/opsSetView\('calendar'/.test(adm) && /\.ops-board\[hidden\]/.test(adm));
ok("Operations board: all services, 4 columns + cancelled, filters, money strip, calendar view, uses the existing assign/status actions");

const js = pub("script.js");
assert.ok(/limit\(30\)\.get\(\)/.test(js) && /function _renderMyBookings/.test(js) && /pz-mb-chip/.test(js) && /pz-mb-addons/.test(js));
assert.ok(/b\.bookingType === "parcel"/.test(js) && /escapeHTML\(upcomingMove/.test(js));
ok("My Bookings: every service in one list, filter chips, parcel titles, add-ons for an upcoming move");

console.log(`\nunified-booking: ${pass} passed, 0 failed`);
