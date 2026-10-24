/** Retired offerings (Oct 2026): two-wheeler parcel delivery and handyman visits.
 *  Hidden in the UI AND refused by the server; historical data untouched.  node test/retired-services.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."), pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

(async () => {
  // --- server: parcel
  const { _parcel } = require("../parcel-booking.js");
  assert.strictEqual(_parcel.PARCEL_RETIRED, true);
  const r = await _parcel.handleCreateParcelOrder({ headers: { authorization: "Bearer t" }, body: { requestId: "req_12345678", details: {} } }, {});
  assert.strictEqual(r.status, 410); assert.strictEqual(r.body.code, "service_retired");
  const src = fs.readFileSync(path.join(__dirname, "..", "parcel-booking.js"), "utf8");
  assert.ok(/if \(PARCEL_RETIRED\) throw new functions\.https\.HttpsError\("failed-precondition"/.test(src));
  ok("server: new parcel orders → 410 service_retired; parcel quotes → failed-precondition");

  // --- server: handyman catalog items are never loaded for a cart
  const { loadCatalog } = require("../catalog-booking.js")._catalogTest;
  const docs = { services: { electrician: { categoryId: "handyman", basePrice: 149 }, "plumber-visit": { categoryId: "handyman", basePrice: 149 },
    carpenter: { categoryId: "handyman", basePrice: 149 }, "tv-wall-mount": { categoryId: "appliances", basePrice: 499 } } };
  const db = { collection: (c) => ({ doc: (id) => ({ c, id }) }),
    getAll: async (...refs) => refs.map((ref) => ({ id: ref.id, exists: !!(docs[ref.c] || {})[ref.id], data: () => docs[ref.c][ref.id] })) };
  const cat = await loadCatalog(db, [{ type: "services", id: "electrician" }, { type: "services", id: "plumber-visit" }, { type: "services", id: "carpenter" }, { type: "services", id: "tv-wall-mount" }]);
  assert.deepStrictEqual(Object.keys(cat.services), ["tv-wall-mount"]);
  ok("server: electrician / plumber / carpenter items can't be booked even if still active in Firestore; TV mounting still can");

  // --- customer-facing: nothing offers the retired services
  for (const f of ["parcel-delivery-bangalore.html", "join-parcel-delivery-rider-bangalore.html", "electrician-plumber-carpenter-bangalore.html", "join-electrician-plumber-carpenter-bangalore.html", "furniture-dismantling-assembly-bangalore.html", "parcel-booking.js"])
    assert.ok(!fs.existsSync(path.join(root, "public", f)), f);
  const parcel = pub("parcel.html");
  assert.ok(/noindex/.test(parcel) && /no longer offered/i.test(parcel) && !/parcel-booking\.js/.test(parcel));
  const pages = fs.readdirSync(path.join(root, "public")).filter((f) => /\.html$/.test(f) && !/^(admin|advisor|driver|parcel-tracking|parcel)\.html$/.test(f));
  for (const f of pages) {
    const h = pub(f).replace(/<!--[\s\S]*?-->/g, "");
    assert.ok(!/two-wheeler parcel|parcel delivery from|parcels from ₹49|href="\/?parcel\.html"/i.test(h.replace(/no longer offer[^<]*/gi, "")), f + " still offers parcels");
    assert.ok(!/electrician-plumber-carpenter|join-parcel-delivery-rider|furniture-dismantling-assembly/.test(h), f + " links a retired page");
  }
  const sm = pub("sitemap.xml");
  assert.ok(!/parcel-delivery-bangalore|electrician-plumber-carpenter|furniture-dismantling|join-parcel|join-electrician/.test(sm));
  const leads = pub("pz-leads.js"), mk = pub("marketplace.js"), chat = pub("pzchatbot.js"), reg = pub("partner-register.html");
  assert.ok(!/\["parcel", "Parcel delivery"\]|\["electrician", "Electrician"\]|id: "parcel"|id: "home", icon/.test(leads));
  assert.ok(!/Two-wheeler parcel|"Electrical"|"Plumbing"|"Carpentry"/.test(mk));
  assert.ok(!/parcel|Electrician \/ plumber/.test(chat));
  assert.ok(!/data-value="parcel_rider"|data-value="two_wheeler"|value="electrical"|value="plumbing"|value="carpentry"|handyman: \{ title:/.test(reg));
  ok("UI: retired pages removed (parcel.html is a noindex notice), no links, sitemap clean, not in Book picker / callback / menu / chat / partner sign-up");

  // --- kept on purpose
  assert.ok(fs.existsSync(path.join(root, "public", "tv-wall-mounting-bangalore.html")) && /needCarpenter/.test(pub("index.html")) && /needElectrician/.test(pub("index.html")));
  assert.ok(fs.existsSync(path.join(root, "public", "parcel-tracking.html")));
  ok("kept: TV mounting (installation service), moving-day dismantling/disconnection add-ons, tracking for existing parcel orders");

  // --- homepage: two clear division entry points; moving stays the main CTA
  const idx = pub("index.html");
  assert.ok(/class="pz-divisions"/.test(idx) && /pz-div-card pz-div-log" href="#marketplace"/.test(idx) && /pz-div-card pz-div-dig" href="\/digital\/"/.test(idx));
  assert.ok(/hero-cta-btn primary" onclick="openBookingSheet\(\)">Get Moving Quote/.test(idx));
  ok("homepage: PackZen Logistics and PackZen Digital entry cards under the hero; 'Get Moving Quote' remains primary");
  console.log(`\nretired-services: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
