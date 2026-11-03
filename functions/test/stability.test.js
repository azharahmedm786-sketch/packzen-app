/** Customer-site stability: error reporting, spike alerts, health check, fallbacks, daily check.
 *  node test/stability.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), rd = (f) => fs.readFileSync(path.join(root, f), "utf8");
const { _siteHealth: H } = require("../site-health.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

assert.strictEqual(H.normalize({ msg: "Script error." }), null);
assert.strictEqual(H.normalize({ msg: "x", src: "chrome-extension://abc/x.js" }), null);
const e = H.normalize({ msg: "TypeError: x is undefined<script>", src: "/script.js:10", page: "/index.html?ref=abc#top", kind: "weird" });
assert.ok(e && !/</.test(e.msg) && e.page === "/index.html" && e.kind === "error");
assert.strictEqual(H.keyOf(e), H.keyOf(Object.assign({}, e)));
const hour = 500000;
const d = H.digest([{ hour, hourCount: 7, msg: "a" }, { hour: hour - 1, hourCount: 4, msg: "b" }, { hour: hour - 5, hourCount: 99, msg: "old" }], hour);
assert.strictEqual(d.total, 11); assert.strictEqual(d.top[0].msg, "a");
ok("error reports: noise and extensions dropped, text cleaned, query strings stripped, de-duplicated; spike digest counts the last hour only");

const sh = rd("functions/site-health.js"), idx = rd("functions/index.js"), rules = rd("firestore.rules");
assert.ok(/ALLOWED_ORIGINS = \["https:\/\/packzenblr\.in"/.test(sh) && /scope: "clientError", subject: ip, limit: 30/.test(sh) && /if \(d\.total < 10\) return null;/.test(sh));
assert.ok(/exports\.healthCheck/.test(sh) && /require\("\.\/site-health"\)/.test(idx) && /match \/clientErrors\/\{id\} \{\s*allow read: if isAdmin\(\);\s*allow write: if false;/.test(rules));
ok("server: only packzenblr.in may report, 30 reports/hour/IP, admin e-mail at ≥10 errors/hour, health check, admin-only storage");

const st = rd("public/pz-stability.js"), sj = rd("public/script.js");
assert.ok(/sent >= 5/.test(st) && /window\.pzFallback = function/.test(st) && /window\.gm_authFailure/.test(st) && /WhatsApp us/.test(st) && /Request a call-back/.test(st));
assert.ok(/window\.pzFallback\("booking"/.test(sj) && /window\.pzFallback\("payment"\)/.test(sj) && /window\.pzFallback\("payment", "razorpay_not_loaded"\)/.test(sj));
assert.ok(/window\.pzFallback\("maps", e && e\.message\);\s*else applyPrice\(15\);/.test(sj) && /window\.pzFallback\("quote", "distance_unavailable:"/.test(sj), "no guessed 15 km price when Maps fails");
for (const f of ["public/index.html", "public/services.html", "public/house-shifting-bangalore.html", "public/digital/index.html", "templates/area-page.template.html"]) assert.ok(/pz-stability\.js\?v=3/.test(rd(f)), f);
ok("customer pages: errors reported (max 5/page), help card with WhatsApp / call-back / call on Maps, quote, booking and payment failures; no made-up prices");

const wf = rd(".github/workflows/booking-check.yml"), bc = rd("scripts/booking-check.mjs");
assert.ok(/cron: "30 1 \* \* \*"/.test(wf) && /node scripts\/booking-check\.mjs/.test(wf) && /workflow_dispatch/.test(wf));
assert.ok(/healthCheck/.test(bc) && /getPlacePredictions/.test(bc) && /catRoot/.test(bc) && /#dzForm/.test(bc) && /process\.exit\(1\)/.test(bc));
assert.ok(/clientErrors/.test(rd("public/admin.html")));
ok("daily robot check at 07:00 IST (health, homepage, booking form + Google address search, catalog, Digital form) + admin website-errors indicator");
{ const m = JSON.parse(rd("public/manifest.json")); const sw = rd("public/sw.js");
  assert.ok(m.id === "/" && m.theme_color === "#1F9D5C" && m.display === "standalone" && m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512") && m.shortcuts.length === 3);
  assert.ok(/OFFLINE_URL = "\/Offline\.html"/.test(sw) && /e\.request\.mode !== "navigate"/.test(sw) && /navigator\.serviceWorker\.register\("\/sw\.js"/.test(st));
  assert.ok(fs.existsSync(path.join(root, "public/assets/logo/icon-512-maskable.png")) && fs.existsSync(path.join(root, "public/Offline.html")));
  ok("Play Store readiness: manifest (id, brand colours, maskable icons, shortcuts), network-first service worker with offline page"); }
console.log(`\nstability: ${pass} passed, 0 failed`);
