/**
 * Website modernization — Stage 2 regression checks (static; browser QA is
 * done separately). Covers the production bugs found in browser QA.
 *   node test/ui-stage2.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PUB = path.join(ROOT, "public");
const read = (f) => fs.readFileSync(path.join(PUB, f), "utf8");
const pages = fs.readdirSync(PUB).filter((f) => f.endsWith(".html"));
const LUCIDE_SRI = "sha384-T6tTFChJBlmkxgMux1AgYV/mFGa/YZBBqpGIIaIfLMX2qvKRZVRZN148LkpWUjFN"; // lucide@1.52.0 dist/umd/lucide.js
const tests = []; const test = (n, f) => tests.push({ n, f });

test("every page's external scripts are allowed by its own CSP (icons were silently blocked)", () => {
  for (const f of pages) {
    const s = read(f);
    const m = s.match(/Content-Security-Policy" content="([^"]+)"/);
    if (!m) continue;
    const src = (m[1].match(/script-src([^;]*)/) || [, ""])[1].split(/\s+/);
    for (const host of new Set([...s.matchAll(/<script[^>]+src="https:\/\/([^/"]+)/g)].map((x) => x[1]))) {
      const ok = src.includes("https://" + host) || src.some((a) => a.startsWith("https://*.") && host.endsWith(a.slice(9)));
      assert.ok(ok, f + " loads " + host + " which its CSP blocks");
    }
  }
});
test("lucide pinned to 1.52.0 everywhere; CSP pages use jsDelivr with the verified SRI", () => {
  for (const f of pages) {
    const s = read(f);
    for (const tag of s.match(/<script[^>]+lucide[^>]*>/g) || []) {
      assert.ok(/lucide@1\.52\.0\/dist\/umd\/lucide\.js/.test(tag), f + ": " + tag);
      if (tag.includes("cdn.jsdelivr.net") && s.includes("Content-Security-Policy")) assert.ok(tag.includes(LUCIDE_SRI) && tag.includes('crossorigin="anonymous"'), f);
    }
  }
});
test("no dead resources: no /sw.js registration without the file, no Cloudflare email-decode stub", () => {
  for (const f of pages) {
    const s = read(f);
    if (/serviceWorker\.register\(['"]\/?sw\.js/.test(s)) assert.ok(fs.existsSync(path.join(PUB, "sw.js")), f + " registers missing sw.js");
    assert.ok(!s.includes("cdn-cgi/scripts"), f);
  }
});
test("index.html has no duplicate ids", () => {
  const ids = [...read("index.html").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepStrictEqual([...new Set(dup)], []);
});
test("trust claims on the homepage/hub match the published damage policy (up to ₹10,000)", () => {
  assert.ok(read("legal/refund.html").includes("₹10,000 per booking"));
  for (const f of ["index.html", "packers-and-movers-bangalore.html"]) {
    const s = read(f);
    assert.ok(!/fully insured|100% insured|zero damage|no questions asked|includes transit insurance/i.test(s), f);
  }
  const idx = read("index.html");
  assert.ok(idx.includes("up to ₹10,000 per booking"));
  assert.ok(!idx.includes("confirmed in 30 min"));
});
test("reviews: CSP-blocked Elfsight widget removed; real Google reviews link kept", () => {
  const idx = read("index.html");
  assert.ok(!idx.includes("elfsightcdn.com") && !idx.includes("elfsight-app-"));
  assert.ok(idx.includes('href="https://g.page/r/CR_hUMH7jJOvEBM/review"'));
});
test("dialog accessibility layer is loaded on customer and staff pages", () => {
  const a11y = read("pz-a11y.js");
  for (const sel of [".modal-overlay", ".booking-sheet", ".assign-overlay"]) assert.ok(a11y.includes(sel), sel);
  for (const sel of [".modal-close", ".modal-x", ".sheet-close"]) assert.ok(a11y.includes(sel), sel);
  assert.ok(/key === "Escape"/.test(a11y) && /key !== "Tab"/.test(a11y) && a11y.includes("__pzReturnFocus"));
  for (const f of ["index.html", "services.html", "admin.html", "driver.html", "advisor.html", "partner.html", "partner-dashboard.html", "partner-register.html"]) {
    assert.ok(/<script src="pz-a11y\.js\?v=\d+" defer><\/script>/.test(read(f)), f);
  }
});
test("booking sheet: inline step errors and progress semantics", () => {
  const s = read("script.js"); const idx = read("index.html");
  assert.ok(s.includes("function _stepError(msg)"));
  const ns = s.slice(s.indexOf("function nextStep() {"), s.indexOf("function prevStep()"));
  assert.ok(!/showToast\(/.test(ns), "nextStep validation still toast-only"); assert.ok((ns.match(/_stepError\(/g) || []).length >= 9);
  assert.ok(idx.includes('class="step-progress-track" role="progressbar"') && idx.includes('id="dot0" aria-current="step"'));
  assert.ok(s.includes('d.setAttribute("aria-current", "step")'));
});
test("dashboard tabs have tab semantics; script.js has no debug console.log", () => {
  const idx = read("index.html"); const s = read("script.js");
  assert.ok(idx.includes('role="tablist"')); assert.strictEqual((idx.match(/role="tab" aria-selected/g) || []).length, 5);
  // Payment code (startPayment) is deliberately left byte-identical to production,
  // including its one "UI only" amount log; every other debug log is removed.
  const a = s.indexOf("async function startPayment()");
  const rest = s.slice(0, a) + s.slice(s.indexOf("\nasync function ", a + 10) > 0 ? Math.min(...["\nfunction ", "\nasync function "].map((m) => s.indexOf(m, a + 10)).filter((i) => i > 0)) : s.length);
  assert.ok(!rest.includes("console.log("), "debug console.log outside the untouched payment code");
});
test("staff pages load the ops layer after their own styles", () => {
  for (const f of ["admin.html", "driver.html", "advisor.html", "partner.html", "partner-dashboard.html"]) {
    const s = read(f); const link = s.indexOf('href="pz-ops.css'), style = s.indexOf("<style");
    assert.ok(link > 0, f); if (style > 0) assert.ok(link > style, f + " ops layer must come after inline styles");
  }
});
test("removed duplicates are unreferenced anywhere (incl. templates)", () => {
  const gone = ["css/modules/pzchatbot.css", "css/modules/services.css", "css/themes/theme-dg.css", "css/themes/theme-purple.css", "js/legacy/chatbot.js", "js/core/pzchatbot.js"];
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git"].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|js|css|json|yml)$/.test(e.name)) files.push(p); } })(ROOT);
  for (const g of gone) {
    assert.ok(!fs.existsSync(path.join(PUB, g)), g + " still exists");
    for (const f of files.filter((x) => !x.endsWith("ui-stage2.test.js"))) assert.ok(!fs.readFileSync(f, "utf8").includes(g), path.relative(ROOT, f) + " still references " + g);
  }
});

test("no broken internal page links; third-party scripts pinned to exact versions", () => {
  for (const f of pages) {
    const s = read(f);
    for (const m of s.matchAll(/href="([^"#?:]+\.html)(?:[#?][^"]*)?"/g)) assert.ok(fs.existsSync(path.join(PUB, m[1])), f + " → " + m[1]);
    for (const m of s.matchAll(/<script[^>]+src="(https:\/\/[^"]+)"/g)) assert.ok(!/@latest|@\d+\//.test(m[1]), f + " unpinned " + m[1]);
  }
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.message)); } }
  console.log(`\nui-stage2: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
