/** Booking confirmation: visible, closes back to the website, booking shows in My Bookings.
 *  node test/booking-confirmation.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const idx = pub("index.html"), js = pub("script.js");

// The tracking window must be closed before the next windows start, otherwise the
// confirmation is nested inside a hidden element and never shows (bug fixed Oct 2026).
const a = idx.indexOf('<div id="trackingModal"'), b = idx.indexOf("<!-- REVIEW MODAL -->");
const block = idx.slice(a, b).replace(/<!--[\s\S]*?-->/g, "");
assert.strictEqual((block.match(/<div\b/g) || []).length, (block.match(/<\/div>/g) || []).length, "tracking window closes all its tags");
assert.ok(idx.indexOf('<div id="paymentModal"') > b);
ok("confirmation window is a top-level window (not trapped inside the hidden tracking window)");

const close = js.slice(js.indexOf("function closeModal() {"), js.indexOf("function viewMyBookingsFromConfirmation"));
assert.ok(/closeBookingSheet\(\)/.test(close) && !/bookingSheet\.classList\.add\("open"\)/.test(close) && /loadUserBookings\(\)/.test(close) && /showTrackOrderBanner\(\)/.test(close));
ok("closing the confirmation returns to the website (booking form stays closed) and refreshes My Bookings");

assert.ok(/function viewMyBookingsFromConfirmation\(\)/.test(js) && /switchDashTab\("bookings"/.test(js));
assert.ok(/onclick="viewMyBookingsFromConfirmation\(\)">📋 View in My Bookings/.test(idx) && /class="cc-btn-close-action" onclick="closeModal\(\)">← Back to website/.test(idx));
assert.ok(/href="\/index\.html#bookings"[^>]*>View in My Bookings/.test(pub("catalog-booking.js")) && /data-act="done">Back to website/.test(pub("catalog-booking.js")));
ok("confirmation offers 'View in My Bookings' and 'Back to website' for moves and home services");
console.log(`\nbooking-confirmation: ${pass} passed, 0 failed`);
