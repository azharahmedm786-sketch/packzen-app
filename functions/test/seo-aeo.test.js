/** Business SEO pages, AEO (quick answers, speakable, llms.txt), advisor services booking.
 *  node test/seo-aeo.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const B2B = ["corporate-employee-relocation-bangalore", "shop-showroom-shifting-bangalore", "pg-coliving-services-bangalore", "ac-appliance-maintenance-for-businesses-bangalore"];
const sm = pub("sitemap.xml");
for (const s of B2B) {
  const h = pub(s + ".html"); const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  for (const t of ["Service", "FAQPage", "WebPage", "BreadcrumbList"]) assert.ok(ld.some((b) => b["@type"] === t), s + " " + t);
  assert.ok(ld.find((b) => b["@type"] === "Service").audience["@type"] === "BusinessAudience");
  assert.ok(/class="svc-section pz-quick-answer"/.test(h) && (h.match(/<h1/g) || []).length === 1 && sm.includes(s + ".html") && /href="business\.html"/.test(h), s);
  assert.ok(!/2 BHK from ₹6,500/.test(h), s + " price consistent with the site");
}
assert.ok(B2B.every((s) => pub("business.html").includes(s + ".html")));
ok("4 business SEO pages: Service (BusinessAudience) + FAQ + speakable quick answer + breadcrumbs, in sitemap, linked from business page");
const SVC = ["house-shifting-bangalore", "packers-and-movers-bangalore", "office-relocation-bangalore", "ac-service-repair-bangalore", "washing-machine-repair-bangalore", "refrigerator-repair-bangalore", "services"];
for (const s of SVC) { const h = pub(s + ".html"); assert.ok(/pz-quick-answer/.test(h) && /"speakable"/.test(h), s); }
const home = [...pub("index.html").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((b) => b["@type"] === "MovingCompany");
assert.ok(home.hasOfferCatalog.itemListElement.length >= 12 && home.contactPoint.availableLanguage.includes("Kannada"));
ok("AEO: quick answers + speakable markup on every service page; homepage lists all services, languages and contact point");
const llms = pub("llms.txt"), robots = pub("robots.txt");
assert.ok(/^# PackZen/.test(llms) && /₹1,499/.test(llms) && /Not offered/.test(llms) && /parcel delivery/.test(llms) && /\+91 99450 95453/.test(llms));
assert.ok(/User-agent: OAI-SearchBot[\s\S]*?Allow: \/[\s\S]*?Disallow: \/admin\.html/.test(robots) && /llms\.txt/.test(robots));
assert.ok(!fs.existsSync(path.join(root, "public", "msg91-setup-guide.html")) && !/msg91-setup-guide/.test(robots));
ok("llms.txt summary; answer-engine bots allowed but private pages still excluded; internal MSG91 guide no longer public");
const cb = fs.readFileSync(path.join(__dirname, "..", "catalog-booking.js"), "utf8"), ab = pub("advisor-booking.js");
const fn = cb.slice(cb.indexOf("exports.advisorCreateServiceBooking"), cb.indexOf("/* ── 2. Start an online payment"));
assert.ok(/SC\.staffRoleOf/.test(fn) && /priceCart\(catalog, data && data\.items\)/.test(fn) && /buildBooking\(\{ uid: who\.customerUid/.test(fn) && /paymentType: "pay_later"/.test(fn) && /source: "advisor"/.test(fn));
assert.ok(/httpsCallable\("advisorCreateServiceBooking"\)/.test(ab) && /nbSelectMoveType\('services'\)/.test(pub("advisor.html")) && /RETIRED_CATS/.test(ab));
ok("advisor can book every active service (AC, washing machine / fridge) through the same catalog pricing and booking record; retired services excluded");
const NEWP = ["single-item-shifting-bangalore", "intercity-relocation-from-bangalore", "washing-machine-installation-bangalore", "refrigerator-gas-refill-bangalore",
  "digital/ecommerce-website-bangalore", "digital/booking-website-bangalore", "digital/website-maintenance-bangalore", "digital/google-business-profile-seo-setup-bangalore"];
for (const s of NEWP) { const h = pub(s + ".html"); assert.ok(/pz-quick-answer/.test(h) && /pz-facts/.test(h) && /"dateModified"/.test(h) && /"FAQPage"/.test(h) && sm.includes(s + ".html") && (h.match(/<h1/g) || []).length === 1, s); }
const ALL = ["house-shifting-bangalore", "ac-gas-refill-bangalore", "refrigerator-repair-bangalore", "packers-and-movers-hsr-layout", "packers-and-movers-whitefield", "digital/index", "digital/website-design-for-clinics-bangalore", "corporate-employee-relocation-bangalore"];
for (const s of ALL) { const h = pub(s + ".html"); assert.ok(/pz-quick-answer/.test(h) && /pz-facts/.test(h) && /"dateModified"/.test(h), s); }
assert.ok(/Get instant price/.test(pub("house-shifting-bangalore.html")) && /Fixed price before booking/.test(pub("packers-and-movers-hsr-layout.html")));
assert.ok(!/\{\{[A-Z_]+\}\}/.test(pub("packers-and-movers-hsr-layout.html")), "area page fully generated");
const L2 = pub("llms.txt"); assert.ok(/## All pages/.test(L2) && /packers-and-movers-whitefield\.html/.test(L2) && /digital\/ecommerce-website-bangalore\.html/.test(L2));
ok("GEO/LLMO/SXO: 8 new SEO pages; quick answer (with CTA + trust row), At-a-glance facts, freshness and speakable markup on every service, area, business and Digital page; llms.txt maps every page");
console.log(`\nseo-aeo: ${pass} passed, 0 failed`);
