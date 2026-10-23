/** PackZen Digital: separate division pages, lead integration, kept out of moving flows.  node test/website-service.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
const A = require("../assistant.js"), I = require("../assistant-i18n.js"), L = require("../leads.js")._leads, Q = require("../lead-quality.js")._quality;
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

const SEG = ["small-business", "packers-movers", "restaurants", "clinics", "real-estate"];
const pages = ["digital/index.html"].concat(SEG.map((k) => `digital/website-design-for-${k}-bangalore.html`));
for (const f of pages) {
  const h = pub(f);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  for (const t of ["Organization", "Service", "FAQPage", "BreadcrumbList"]) assert.ok(ld.some((b) => b["@type"] === t), f + " " + t);
  assert.ok((h.match(/<h1/g) || []).length === 1 && /<link rel="canonical" href="https:\/\/packzenblr\.in\/digital\//.test(h) && /og:title/.test(h), f);
  for (const p of ["₹7,999", "₹14,999", "from ₹29,999", "₹999"]) assert.ok(h.includes(p), f + " " + p);
  assert.ok(/id="dzForm"/.test(h) && /name="consent"/.test(h) && /class="dz-hp"/.test(h) && /digital\.js/.test(h) && /dz-back" href="\/">/.test(h), f);
  assert.ok(!/pz-leads\.js|pzchatbot\.js|openBookingSheet/.test(h), f + " must not load moving flows");
  const cleaned = h.replace(/never promise guaranteed Google rankings/gi, "").replace(/Will you guarantee Google rankings or leads\?/g, "");
  assert.ok(!/guaranteed? (google )?rank|unlimited revisions/i.test(cleaned), f + " no false promises");
}
assert.ok(/Websites That <em>Bring Customers\.<\/em>/.test(pub("digital/index.html")) && /Get a Website Quote/.test(pub("digital/index.html")) && /View Our Work/.test(pub("digital/index.html")));
const js = pub("digital/digital.js");
assert.ok(/submitLead/.test(js) && /if \(sending\) return/.test(js) && /consent\.checked/.test(js) && /division: "digital"/.test(js));
ok("PackZen Digital: home + 5 industry pages, own look, packages with honest scope, schema/canonical/OG, consent form → existing lead engine, no moving flows on these pages");

const sm = pub("sitemap.xml");
assert.ok(sm.includes("https://packzenblr.in/digital/</loc>") && SEG.every((k) => sm.includes(`/digital/website-design-for-${k}-bangalore.html`)) && !/packzenblr\.in\/website-design/.test(sm));
for (const old of ["website-design-bangalore.html"].concat(SEG.map((k) => `website-design-for-${k}-bangalore.html`))) {
  const h = pub(old); assert.ok(/noindex/.test(h) && /http-equiv="refresh" content="0; url=\/digital\//.test(h), old);
}
ok("sitemap lists the digital pages; old URLs forward to /digital/ and are noindex");

const v = L.validateLead({ name: "Ravi K", phone: "9845012345", service: "ecommerce", email: "R@X.in", business: "Ravi Stores", budget: "20k_50k", contactPref: "whatsapp" }).value;
assert.ok(v.division === "digital" && v.email === "r@x.in" && v.business === "Ravi Stores" && v.budget === "20k_50k" && v.contactPref === "whatsapp");
assert.strictEqual(L.validateLead({ name: "A B", phone: "9845012345", service: "move" }).value.division, "logistics");
assert.ok(!L.validateLead({ name: "A B", phone: "9845012345", service: "website", email: "bad@" }).ok);
assert.ok(Q.scoreLead({ name: "Ravi", phone: "9845012345", service: "ecommerce" }, Date.now()).reasons.some((r) => /\+25/.test(r)));
const app = pub("leads-app/app.js");
assert.ok(/function divisionOf/.test(app) && /id="divSel"/.test(pub("leads-app/index.html")) && /b-digital/.test(app));
ok("leads: division (digital/logistics), email, business, budget, contact preference stored and validated; Leads app filters by division");

const leads = pub("pz-leads.js"), mk = pub("marketplace.js"), idx = pub("index.html");
assert.ok(!/id: "website"/.test(leads) && !/\["website",/.test(leads) && !/id: "website"/.test(mk));
assert.ok(/class="pz-digital-pill" href="\/digital\/"/.test(idx) && /class="pz-nav-digital"/.test(idx) && /hero-cta-btn primary" onclick="openBookingSheet\(\)">Get Moving Quote/.test(idx));
assert.ok(/website: "\/digital\/#quote"/.test(pub("pzchatbot.js")));
const ask = (q) => A.answer(I.understand(q), {});
assert.ok(ask("website price").intents.includes("website") && /packzenblr\.in\/digital\//.test(ask("website price").reply) && /packzenblr\.in\/digital\//.test(I.TEMPLATES.website.hi()));
ok("main site: Digital pill + nav link, 'Get Moving Quote' still the main CTA; websites removed from Book picker, callback form and services menu; assistant links to /digital/");
console.log(`\nwebsite-service: ${pass} passed, 0 failed`);
