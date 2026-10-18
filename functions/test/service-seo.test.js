/** Customer service SEO pages: verified prices only, schema, links, sitemap.  node test/service-seo.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const PAGES = { "ac-gas-refill-bangalore.html": ["₹2,399"], "ac-installation-uninstallation-bangalore.html": ["₹1,649", "₹799"], "kitchen-deep-cleaning-bangalore.html": ["₹999"],
  "bathroom-deep-cleaning-bangalore.html": ["₹449"], "move-in-move-out-cleaning-bangalore.html": ["₹3,299", "₹4,299", "₹5,499"], "furniture-dismantling-assembly-bangalore.html": ["₹149"] };
const published = pub("ac-service-repair-bangalore.html") + pub("deep-cleaning-bangalore.html") + pub("electrician-plumber-carpenter-bangalore.html");
for (const [f, prices] of Object.entries(PAGES)) {
  const h = pub(f);
  for (const p of prices) { assert.ok(h.includes(p), f + " " + p); assert.ok(published.includes(p), "price not on an existing page: " + p); }
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocks.some((b) => b["@type"] === "FAQPage") && blocks.some((b) => b["@type"] === "Service"), f);
  assert.ok(h.includes(`<link rel="canonical" href="https://packzenblr.in/${f}">`) && (h.match(/<h1/g) || []).length === 1, f);
  assert.ok(pub("sitemap.xml").includes(f) && pub("index.html").includes(f), f);
  assert.ok(/pz-premium\.css/.test(h) && /pz-leads\.js/.test(h) && /services\.html\?category=/.test(h), f);
}
ok("6 customer service pages: only prices already published by PackZen, Service + FAQ schema, one H1, canonical, sitemap, homepage links, booking CTA");
console.log(`\nservice-seo: ${pass} passed, 0 failed`);
