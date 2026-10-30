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
console.log(`\nseo-aeo: ${pass} passed, 0 failed`);
