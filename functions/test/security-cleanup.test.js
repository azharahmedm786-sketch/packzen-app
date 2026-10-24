/** Security/cleanup audit items that applied to this codebase.  node test/security-cleanup.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const js = pub("script.js");
assert.strictEqual((js.match(/function showToast\(/g) || []).length, 1);
assert.ok(/function pickTimeSlot\(event, value, label\)/.test(js) && /function pickVehicle\(event, value/.test(js) && /function pickFloor\(event, type/.test(js));
assert.ok(!/function openNotifications/.test(js) && !/navNotifBtn/.test(pub("index.html")));
assert.ok(!/Recovered unsaved booking data/.test(js) && !/STAT_VALUES/.test(js));
assert.strictEqual((js.match(/buildDateStrip\(\);/g) || []).length, 1);
assert.ok(!/fc-price-tag" style="display:none!important/.test(js) && /\.fc-price-tag\{[^}]*display:none!important/.test(js));
assert.ok(/for \(const k in rateLimits\) if \(rateLimits\[k\]\.firstRequest < cutoff\) delete rateLimits\[k\];/.test(js));
assert.ok(/card\.addEventListener\('keydown'/.test(js));
ok("script.js: one showToast, explicit event params, no dead bell / fake toast / fake counters, single date strip, keyboard house cards, rate-limit sweep");
assert.ok(!/2026-0[0-9]-\d\d/.test(pub("sitemap.xml")) && /not access control/.test(pub("robots.txt")));
assert.ok(/preconnect" href="https:\/\/maps\.googleapis\.com/.test(pub("index.html")) && /preconnect" href="https:\/\/firestore\.googleapis\.com/.test(pub("services.html")));
assert.ok(fs.existsSync(path.join(root, "SECURITY.md")) && fs.existsSync(path.join(root, "PRE-LAUNCH-CHECKLIST.md")));
ok("sitemap dates current, robots note, preconnects, SECURITY.md + PRE-LAUNCH-CHECKLIST.md");
const idx2 = pub("index.html");
assert.ok(!/24\/7|Insured Moves|On-time guarantee|always here to help you anytime/.test(idx2) && /Support 8 AM – 9 PM/.test(idx2));
const man = JSON.parse(pub("driver-manifest.json")); assert.ok(man.start_url === "/driver.html" && man.icons.length === 2);
for (const k of ["privacy", "terms", "refund"]) { const h = pub("legal/" + k + ".html"); assert.ok(/name="description"/.test(h) && new RegExp('rel="canonical" href="https://packzenblr.in/legal/' + k + '.html"').test(h), k); }
assert.ok(/rel="canonical" href="https:\/\/packzenblr\.in\/delete-account\.html"/.test(pub("delete-account.html")));
ok("launch QA: no 24/7 / insured / guarantee overclaims, crew app manifest present, legal + delete-account canonicals");
console.log(`\nsecurity-cleanup: ${pass} passed, 0 failed`);
