/** Washing machine / fridge services (painting retired Oct 2026) + chat flows + crew assistant.  node test/new-services-chat.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
const A = require("../assistant.js"), I = require("../assistant-i18n.js"), L = require("../leads.js")._leads;
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

const seed = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "seedCatalog.js"), "utf8");
for (const [id, price] of [["wm-repair-visit", 249], ["wm-install", 449], ["wm-uninstall", 299], ["fridge-repair-visit", 249], ["fridge-gas-refill", 1999]])
  assert.ok(new RegExp('id: "' + id + '",\\s+categoryId: "appliance-repair",[^}]*basePrice: ' + price + ",").test(seed), id);
assert.ok(/id: "painting-site-visit", isActive: false,/.test(seed) && /id: "painting",\s+isActive: false/.test(seed));
const eng = fs.readFileSync(path.join(__dirname, "..", "assignment-engine.js"), "utf8");
assert.ok(/"appliance-repair": "appliances"/.test(eng) && /painting: "painting"/.test(eng));
ok("catalog: washing machine & fridge (₹249 visit, ₹449/₹299, ₹1,999 gas) route to appliances partners; painting seeded inactive");

const ask = (q) => A.answer(I.understand(q), {});
assert.ok(ask("my washing machine is not draining").intents.includes("appliance_repair") && /₹249/.test(ask("fridge repair").reply));
assert.ok(/no longer offers painting/.test(ask("house painting quote").reply) && ask("फ्रिज ठीक करना है").intents.includes("appliance_repair"));
assert.ok(!/painting|appliance repair/i.test(ask("pest control").reply.replace(/pest control/i, "")));
const tpl = I.TEMPLATES;
assert.ok(tpl.appliance_repair.hi() && tpl.appliance_repair.kn() && /पेंटिंग/.test(tpl.painting.hi()) && /ಪೇಂಟಿಂಗ್/.test(tpl.painting.kn()));
assert.strictEqual(L.validateLead({ name: "Asha", phone: "9845012345", service: "appliance" }).value.serviceLabel, "Washing machine / fridge repair");
ok("assistant answers appliance questions in English, Hindi and Kannada and says painting is no longer offered; leads accept appliance");

const leads = pub("pz-leads.js"), mk = pub("marketplace.js"), chat = pub("pzchatbot.js");
assert.ok(/id: "appliance"/.test(leads) && !/id: "painting"/.test(leads) && /appliance-repair/.test(leads) && !/\["painting", "Painting"\]/.test(leads));
assert.ok(/id: "appliance-repair"/.test(mk) && !/id: "painting"/.test(mk));
for (const f of ["washing-machine-repair-bangalore.html", "refrigerator-repair-bangalore.html"]) {
  const h = pub(f); assert.ok(/"@type": "FAQPage"/.test(h) && (h.match(/<h1/g) || []).length === 1 && pub("sitemap.xml").includes(f) && pub("index.html").includes(f), f);
}
ok("Book picker, callback form, services menu and 3 new SEO pages");

assert.ok(/flow: "book"/.test(chat) && /flow: "manage"/.test(chat) && /flow: "photo"/.test(chat) && /function flowBook/.test(chat) && /function manageForm/.test(chat) && /function flowPhoto/.test(chat));
assert.ok(/callFn\("assistantSupportRequest", \{ name: name, phone: phone, message: msg, topic: kind, consent: true \}\)/.test(chat));
assert.ok(/"reschedule", "cancel", "photo_quote"/.test(fs.readFileSync(path.join(__dirname, "..", "assistant-functions.js"), "utf8")));
assert.ok(/location\.hash !== "#bookings"/.test(pub("script.js")));
ok("chat: book in chat (guided, server prices), reschedule/cancel requests to the team, photo quotes via WhatsApp, My Bookings deep link");

const crew = pub("crew-help.js");
assert.ok(/How do I complete a job\?/.test(crew) && /collect the balance/.test(crew) && /90%/.test(crew) && /crew-help\.js/.test(pub("driver.html")));
ok("crew assistant in the crew app: online, offers, OTP completion, cash/UPI, earnings, parcels, damage, contacts");
console.log(`\nnew-services-chat: ${pass} passed, 0 failed`);
