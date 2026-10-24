/** Customer service SEO pages: verified prices only, schema, links, sitemap.  node test/service-seo.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const PAGES = { "ac-gas-refill-bangalore.html": ["₹2,399"], "ac-installation-uninstallation-bangalore.html": ["₹1,649", "₹799"] };
const published = pub("ac-service-repair-bangalore.html");
for (const [f, prices] of Object.entries(PAGES)) {
  const h = pub(f);
  for (const p of prices) { assert.ok(h.includes(p), f + " " + p); assert.ok(published.includes(p), "price not on an existing page: " + p); }
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocks.some((b) => b["@type"] === "FAQPage") && blocks.some((b) => b["@type"] === "Service"), f);
  assert.ok(h.includes(`<link rel="canonical" href="https://packzenblr.in/${f}">`) && (h.match(/<h1/g) || []).length === 1, f);
  assert.ok(pub("sitemap.xml").includes(f) && pub("index.html").includes(f), f);
  assert.ok(/pz-premium\.css/.test(h) && /pz-leads\.js/.test(h) && /services\.html\?category=/.test(h), f);
}
ok("2 customer service pages: only prices already published by PackZen, Service + FAQ schema, one H1, canonical, sitemap, homepage links, booking CTA");
// PackZen doesn't offer cleaning: no cleaning pages, links, sitemap entries or offers anywhere
for (const f of ["deep-cleaning-bangalore.html","kitchen-deep-cleaning-bangalore.html","bathroom-deep-cleaning-bangalore.html","move-in-move-out-cleaning-bangalore.html","join-cleaning-partner-bangalore.html"])
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "..", "public", f)), f);
const allPublic = fs.readdirSync(path.join(__dirname, "..", "..", "public")).filter((f) => /\.(html|xml)$/.test(f)).map((f) => pub(f)).join("\n");
assert.ok(!/deep-cleaning-bangalore|cleaning-bangalore\.html|join-cleaning-partner/.test(allPublic));
assert.ok(!/deep cleaning/i.test(pub("index.html") + pub("services.html") + pub("pz-leads.js") + pub("pzchatbot.js") + pub("marketplace.js")));
ok("cleaning removed: pages deleted, no links/sitemap entries, not offered in picker, chat, marketplace or homepage");
console.log(`\nservice-seo: ${pass} passed, 0 failed`);
