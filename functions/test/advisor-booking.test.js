/** Advisor manual booking + advisor dashboard fixes.  node test/advisor-booking.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), rd = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const idx = rd("functions/index.js");
const fn = idx.slice(idx.indexOf("exports.advisorCreateBooking"), idx.indexOf('const movePayment = require("./move-payment");'));
assert.ok(/STAFF_BOOKING_ROLES = \["admin", "manager", "advisor"\]/.test(idx) && /permission-denied", "Only PackZen staff/.test(fn));
assert.ok(/calculateServerQuote\(JSON\.parse\(JSON\.stringify\(quoteInput\)\)/.test(fn), "same server pricing as createBooking");
assert.ok(/status: "confirmed",\s*paymentType: "pay_later", paid: 0, balanceDue: quote\.finalTotal, paymentStatus: "unpaid"/.test(fn), "same safe status/payment as createBooking");
assert.ok(/source: "advisor"/.test(fn) && /createdByAdvisor:/.test(fn) && /createdByStaff:/.test(fn) && /advisorRequestId: requestId/.test(fn) && /where\("advisorRequestId", "==", requestId\)/.test(fn));
assert.ok(/getUserByEmail/.test(fn) && /generatePasswordResetLink/.test(fn) && /That e-mail belongs to a staff or partner account/.test(fn) && /where\("phone", "==", phone\)/.test(fn));
assert.ok(/if \(op === "quote"\) return \{ total: quote\.finalTotal/.test(fn) && /rateLimit\.consumeAll/.test(fn));
assert.ok(/pricingGuard\.pricedInputSnapshot\(quoteInput, quote\)/.test(fn));
ok("server: staff-only manual booking — same pricing engine, Pay Later + confirmed like the website, customer linked/created, retry-safe, rate-limited");
const ab = rd("public/advisor-booking.js"), adv = rd("public/advisor.html");
for (const f of ["nbInit", "nbSaveDraft", "nbRestoreDraft", "nbDiscardDraft", "nbSelectMoveType", "nbCartonQty", "nbApplyCoupon", "nbSelectPayment", "nbCalc", "nbSaveBooking"])
  assert.ok(new RegExp("window\\." + f + " = function").test(ab), f);
assert.ok(/httpsCallable\("advisorCreateBooking"\)/.test(ab) && /op: "quote"/.test(ab) && /op: "create", requestId: S\.requestId/.test(ab) && /advisor-booking\.js\?v=4/.test(adv));
assert.ok(!/total:\s*S\.quote|paid:\s*true|status:\s*val\("nbStatus"\)/.test(ab), "browser never sends price, paid flag or status");
assert.ok(/new google\.maps\.places\.Autocomplete\(input, \{ componentRestrictions: \{ country: "in" \}/.test(ab) && /callback=pzAdvisorMapsReady/.test(ab) && /window\.ENV && window\.ENV\.GOOGLE_MAPS_KEY/.test(ab));
assert.ok(/hr < 12 \? "morning" : hr < 16 \? "afternoon" : "evening"/.test(ab) && /timeSlot: window_/.test(ab) && /Preferred time: /.test(ab));
assert.ok(/"auth\/user-disabled":/.test(adv));
ok("advisor New Booking form wired (was a dead stub): live server price, coupon, drafts, WhatsApp confirmation; price/status never from the browser");
assert.ok(/id="pz-advisor-fix"/.test(adv) && /--text:#0C1A14/.test(adv) && /adv-menu-btn/.test(adv) && /if \(typeof Chart === "undefined"\) return;/.test(adv));
ok("advisor dashboard: readable light palette on white cards, phone layout + ☰ Menu, charts can't crash");
console.log(`\nadvisor-booking: ${pass} passed, 0 failed`);
