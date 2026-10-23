/** Website design service: pages, form → leads, picker/menu/chat, assistant.  node test/website-service.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
const A = require("../assistant.js"), I = require("../assistant-i18n.js"), L = require("../leads.js")._leads, Q = require("../lead-quality.js")._quality;
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

const pages = ["website-design-bangalore", "website-design-for-small-business-bangalore", "website-design-for-packers-movers-bangalore", "website-design-for-restaurants-bangalore", "website-design-for-clinics-bangalore", "website-design-for-real-estate-bangalore"];
for (const s of pages) {
  const h = pub(s + ".html");
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.ok(ld.some((b) => b["@type"] === "FAQPage") && ld.some((b) => b["@type"] === "Service"), s);
  assert.ok((h.match(/<h1/g) || []).length === 1 && h.includes(`href="https://packzenblr.in/${s}.html"`), s);
  for (const p of ["₹7,999", "₹14,999", "from ₹29,999", "₹999 / month"]) assert.ok(h.includes(p), s + " " + p);
  assert.ok(/service: "website"/.test(h) && /submitLead/.test(h) && /name="website" tabindex="-1"/.test(h), s + " form");
  assert.ok(pub("sitemap.xml").includes(s + ".html"), s);
  assert.ok(!/ac-gas-refill-bangalore\.html/.test(h.replace(/svc-related-card[^>]*>/g, "")), s + " leftover");
}
ok("6 website-design pages: packages and prices, Service + FAQ schema, enquiry form → lead engine (spam-protected), sitemap");

assert.strictEqual(L.validateLead({ name: "Ravi", phone: "9845012345", service: "website" }).value.serviceLabel, "Website design");
assert.ok(Q.scoreLead({ name: "Ravi", phone: "9845012345", service: "website", area: "Jayanagar" }, Date.now()).reasons.some((r) => /website \+20/i.test(r)));
ok("website leads are recognised and scored as high value");

const leads = pub("pz-leads.js"), mk = pub("marketplace.js"), chat = pub("pzchatbot.js");
assert.ok(/id: "website"/.test(leads) && /website-design-bangalore\.html/.test(leads) && /\["website", "Website for my business"\]/.test(leads));
assert.ok(/id: "website", icon: "💻"/.test(mk) && /href: "website-design-bangalore\.html"/.test(mk) && /website-design-bangalore\.html/.test(pub("index.html")));
assert.ok(/id: "website", label: "💻 Website for my business"/.test(chat) && /Free consultation/.test(chat));
ok("Book picker, callback form, services menu, homepage link and the Book-in-chat flow include websites");

const ask = (q) => A.answer(I.understand(q), {});
for (const q of ["how much for a website for my shop", "मुझे वेबसाइट बनवानी है", "ವೆಬ್‌ಸೈಟ್ ಬೇಕು", "do you build ecommerce stores?"]) assert.ok(ask(q).intents.includes("website"), q);
assert.ok(/₹7,999/.test(ask("website price").reply) && I.TEMPLATES.website.hi() && I.TEMPLATES.website.kn());
ok("assistant answers website questions in English, Hindi and Kannada");
console.log(`\nwebsite-service: ${pass} passed, 0 failed`);
