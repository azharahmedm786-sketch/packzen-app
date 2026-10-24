/** Retired offerings (Oct 2026): two-wheeler parcel delivery, handyman visits, TV mounting and painting.
 *  Hidden in the UI AND refused by the server; historical data untouched.  node test/retired-services.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

(async () => {
  // --- server: parcel functions are gone entirely
  const fnIndex = require("../index.js");
  assert.ok(!("getParcelQuote" in fnIndex) && !("createParcelRazorpayOrder" in fnIndex));
  for (const f of ["parcel-booking.js", "parcel-pricing.js"]) assert.ok(!fs.existsSync(path.join(__dirname, "..", f)), f);
  ok("server: parcel quote and order functions removed (not deployed); parcel modules deleted");

  // --- server: TV remount is never priced, whatever the client sends
  assert.ok(/tvMountCount: 0,   \/\/ TV mounting retired/.test(fs.readFileSync(path.join(__dirname, "..", "pricing-engine-v2.js"), "utf8")));
  assert.strictEqual(fs.readFileSync(path.join(__dirname, "..", "pricing-engine-v2.js"), "utf8"), pub("pricing-engine-v2.js"));
  ok("pricing: TV remount is never priced, whatever the client sends; browser and server engines identical");

  // --- server: handyman catalog items are never loaded for a cart
  const { loadCatalog } = require("../catalog-booking.js")._catalogTest;
  const docs = { services: { electrician: { categoryId: "handyman", basePrice: 149 }, "plumber-visit": { categoryId: "handyman", basePrice: 149 },
    carpenter: { categoryId: "handyman", basePrice: 149 }, "tv-wall-mount": { categoryId: "appliances", basePrice: 499 } } };
  const db = { collection: (c) => ({ doc: (id) => ({ c, id }) }),
    getAll: async (...refs) => refs.map((ref) => ({ id: ref.id, exists: !!(docs[ref.c] || {})[ref.id], data: () => docs[ref.c][ref.id] })) };
  docs.services["painting-site-visit"] = { categoryId: "painting", basePrice: 0 };
  docs.services["wm-repair-visit"] = { categoryId: "appliance-repair", basePrice: 249 };
  const cat = await loadCatalog(db, ["electrician", "plumber-visit", "carpenter", "tv-wall-mount", "painting-site-visit", "wm-repair-visit"].map((id) => ({ type: "services", id })));
  assert.deepStrictEqual(Object.keys(cat.services), ["wm-repair-visit"]);
  ok("server: handyman, TV mounting and painting items can't be booked even if still active in Firestore; appliance repair still can");

  // --- customer-facing: nothing offers the retired services
  for (const f of ["parcel.html", "parcel-tracking.html", "parcel-delivery-bangalore.html", "join-parcel-delivery-rider-bangalore.html", "electrician-plumber-carpenter-bangalore.html",
    "join-electrician-plumber-carpenter-bangalore.html", "furniture-dismantling-assembly-bangalore.html", "parcel-booking.js", "tv-wall-mounting-bangalore.html", "painting-services-bangalore.html"])
    assert.ok(!fs.existsSync(path.join(root, "public", f)), f);
  const pages = fs.readdirSync(path.join(root, "public")).filter((f) => /\.html$/.test(f) && !/^(admin|advisor|driver)\.html$/.test(f));
  for (const f of pages) {
    const h = pub(f).replace(/<!--[\s\S]*?-->/g, "");
    assert.ok(!/two-wheeler parcel|parcel delivery from|parcels from ₹49|href="\/?parcel\.html"/i.test(h.replace(/no longer offer[^<]*/gi, "")), f + " still offers parcels");
    assert.ok(!/electrician-plumber-carpenter|join-parcel-delivery-rider|furniture-dismantling-assembly|tv-wall-mounting-bangalore|painting-services-bangalore|tvMountCount/.test(h), f + " links a retired page/option");
    assert.ok(!/painting|TV (wall )?mounting/i.test(h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/registration or painting/g, "")), f + " still offers painting / TV mounting");
  }
  const sm = pub("sitemap.xml");
  assert.ok(!/parcel-delivery-bangalore|electrician-plumber-carpenter|furniture-dismantling|join-parcel|join-electrician/.test(sm));
  const leads = pub("pz-leads.js"), mk = pub("marketplace.js"), chat = pub("pzchatbot.js"), reg = pub("partner-register.html");
  assert.ok(!/\["parcel", "Parcel delivery"\]|\["electrician", "Electrician"\]|id: "parcel"|id: "home", icon/.test(leads));
  assert.ok(!/Two-wheeler parcel|"Electrical"|"Plumbing"|"Carpentry"/.test(mk));
  assert.ok(!/parcel|Electrician \/ plumber|painting|TV mounting/i.test(chat) && !/id: "tv"|id: "painting"/.test(leads) && !/"TV wall mount"|Home & room painting/.test(mk));
  assert.ok(!/data-value="parcel_rider"|data-value="two_wheeler"|value="electrical"|value="plumbing"|value="carpentry"|handyman: \{ title:/.test(reg));
  ok("UI: retired pages removed (parcel, TV mounting, painting, handyman), no links, sitemap clean, not in Book picker / callback / menu / chat / partner sign-up");

  // --- kept on purpose: moving-day dismantling / disconnection add-ons are part of a move
  assert.ok(/needCarpenter/.test(pub("index.html")) && /needElectrician/.test(pub("index.html")) && !/tvMountCount/.test(pub("index.html")));
  ok("kept: moving-day dismantling / disconnection add-ons; TV remount add-on removed from the booking form");

  // --- homepage: two clear division entry points; moving stays the main CTA
  const idx = pub("index.html");
  assert.ok(/class="pz-divisions"/.test(idx) && /pz-div-card pz-div-log" href="#marketplace"/.test(idx) && /pz-div-card pz-div-dig" href="\/digital\/"/.test(idx));
  assert.ok(/hero-cta-btn primary" onclick="openBookingSheet\(\)">Get Moving Quote/.test(idx));
  ok("homepage: PackZen Logistics and PackZen Digital entry cards under the hero; 'Get Moving Quote' remains primary");
  console.log(`\nretired-services: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
