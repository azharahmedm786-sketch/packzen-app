/**
 * Bangalore service area (560xxx + approved outskirts).
 *   node test/service-area.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const sa = require("../service-area.js");
const { validateDetails } = require("../catalog-pricing.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

for (const a of ["12, 5th Cross, Koramangala, Bengaluru, Karnataka 560034, India", "Whitefield 560066", "KIA, Devanahalli 560300"]) assert.ok(sa.checkAddress(a).ok, a);
ok("any 560xxx pincode is in the area");
for (const [pin, name] of Object.entries(sa.EXTRA_PINCODES)) assert.ok(sa.checkAddress(`${name}, Karnataka ${pin}`).ok, name);
assert.deepStrictEqual(Object.values(sa.EXTRA_PINCODES).sort(), ["Anekal", "Attibele", "Devanahalli", "Hoskote", "Sarjapur"]);
ok("approved outskirts accepted: Hoskote, Anekal, Devanahalli, Sarjapur, Attibele");
for (const a of ["MG Road, Mysuru, Karnataka 570001", "Hosur, Tamil Nadu 635109", "Andheri, Mumbai 400053", "Tumakuru 572101"]) {
  const r = sa.checkAddress(a); assert.ok(!r.ok && r.reason === "outside", a);
}
ok("other cities refused (Mysuru, Hosur, Mumbai, Tumakuru)");
assert.strictEqual(sa.checkAddress("Flat 4B, Prestige Lakeside, Bangalore").reason, "city_name");
assert.strictEqual(sa.checkAddress("Flat 4B, Prestige Lakeside").ok, false);
assert.ok(/include the pickup pincode/.test(sa.messageFor(sa.checkAddress("Flat 4B"), "pickup")));
ok("no pincode: accepted only if the address names Bangalore/Bengaluru; otherwise asks for the pincode");
assert.strictEqual(sa.checkAddress("Hosur Road, Bengaluru, Karnataka 560068, India", "Hosur 635109").pincode, "560068");
assert.strictEqual(sa.extractPincode("House 1234, 2nd Main, 560076"), "560076");
assert.strictEqual(sa.extractPincode("Plot 12345678 Bangalore"), null);
ok("Google's formatted address decides first; house numbers are not mistaken for pincodes");

const base = { customerName: "Asha", phone: "9876543210", date: "2099-01-01", timeSlot: "morning" };
const now = new Date("2098-12-30T05:00:00Z");
assert.ok(validateDetails(Object.assign({ address: "14, HSR Layout Sector 2, Bengaluru 560102" }, base), now).ok);
const bad = validateDetails(Object.assign({ address: "22 Brigade Road, Chennai 600002" }, base), now);
assert.ok(!bad.ok && bad.errors.some((e) => /outside our service area/.test(e)));
ok("home/appliance services: service address outside the area is refused with a clear message");

const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
assert.ok(/serviceArea\.checkAddress\(route\.originAddress, pickup\)/.test(idx));
assert.ok(!/checkAddress\(route\.destinationAddress/.test(idx));
ok("moves: pickup must be in the area; destination may be anywhere (intercity allowed)");
const mp = fs.readFileSync(path.join(__dirname, "..", "move-payment.js"), "utf8");
assert.ok(/service area\|pincode/.test(mp)); ok("paid move flow shows the service-area message to the customer");

console.log(`\nservice-area: ${pass} passed, 0 failed`);
