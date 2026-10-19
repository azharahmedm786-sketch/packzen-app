/**
 * Partner applications → working crew: review rules, profile mapping, portal wiring.
 *   node test/partners.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const PR = require("../partner-review.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

(async () => {
  let p = PR.profileFromApplication({ uid: "u1", businessType: "packers_movers", vehicleType: "17ft_truck" });
  assert.deepStrictEqual([p.status, p.vehicleIds, p.skills], ["active", ["truck_17ft"], ["moving", "packing", "assembly"]]);
  p = PR.profileFromApplication({ uid: "u2", businessType: "parcel_rider", vehicleType: "two_wheeler" });
  assert.deepStrictEqual([p.vehicleIds, p.skills], [[], ["parcel"]]);
  p = PR.profileFromApplication({ uid: "u3", businessType: "technician", vehicleType: "none", skills: ["ac", "electrical", "bogus"] });
  assert.deepStrictEqual(p.skills, ["ac", "electrical"]);
  ok("application → crew profile: vehicle mapped to pricing vehicles, skills from the form or business type, two-wheelers get parcel");

  const store = { partners: { abcdef1: { ownerName: "Ravi", ownerPhone: "+919876543210", email: "r@x.in", businessType: "vehicle_owner", vehicleType: "tata_ace", verificationStatus: "pending" } },
    users: {}, driverProfiles: {} };
  const ref = (c, id) => ({ _c: c, id });
  const db = { collection: (c) => ({ doc: (id) => ref(c, id) }),
    runTransaction: async (fn) => fn({ get: async (r) => ({ exists: !!store[r._c][r.id], data: () => store[r._c][r.id] }),
      update: (r, u) => Object.assign(store[r._c][r.id], u), set: (r, d, o) => { store[r._c][r.id] = Object.assign(o && o.merge ? (store[r._c][r.id] || {}) : {}, d); } }) };
  const sent = [];
  const deps = (admin) => ({ db, isAdmin: async () => admin, serverTimestamp: () => "TS", now: () => 0, notify: async (n) => sent.push(n), logger: { info() {}, warn() {} } });
  const ctx = { auth: { uid: "adminuid" } };
  await assert.rejects(PR.handleReview({ uid: "abcdef1", decision: "approve" }, ctx, deps(false)), /Only admins/);
  await assert.rejects(PR.handleReview({ uid: "abcdef1", decision: "reject", reason: "" }, ctx, deps(true)), /short reason/);
  const r = await PR.handleReview({ uid: "abcdef1", decision: "approve" }, ctx, deps(true));
  assert.ok(r.approved && store.partners.abcdef1.verificationStatus === "approved");
  assert.ok(store.users.abcdef1.role === "driver" && store.users.abcdef1.phone === "9876543210");
  assert.ok(store.driverProfiles.abcdef1.status === "active" && store.driverProfiles.abcdef1.vehicleIds.includes("tata_ace"));
  assert.ok(sent[0].approved && sent[0].phone === "9876543210");
  store.users.staff1 = { role: "admin" }; store.partners.staff1 = { verificationStatus: "pending" };
  await assert.rejects(PR.handleReview({ uid: "staff1", decision: "approve" }, ctx, deps(true)), /staff role/);
  await PR.handleReview({ uid: "abcdef1", decision: "reject", reason: "RC expired" }, ctx, deps(true));
  assert.ok(store.partners.abcdef1.verificationStatus === "rejected" && store.partners.abcdef1.rejectionReason === "RC expired");
  ok("review: admin only; approve → role driver + active crew profile + SMS; reject needs a reason; staff accounts protected");

  const pub = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
  const reg = pub("partner-register.html");
  assert.ok(/aadhaarLast4/.test(reg) && !/aadhaarNumber:\s+aadRaw/.test(reg) && /name="skills"/.test(reg) && /parcel_rider/.test(reg) && /two_wheeler/.test(reg));
  const pj = pub("partner.js");
  assert.ok(/window\.location\.href = "driver\.html"/.test(pj) && /Open crew app/.test(pj));
  assert.ok(/id="sectionPartners"/.test(pub("admin.html")) && /adminReviewPartner/.test(pub("admin.html")));
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "storage.rules"), "utf8");
  assert.ok(/match \/partner-docs\/\{uid\}\/\{file\}/.test(rules) && /10 \* 1024 \* 1024/.test(rules) && /allow read, write: if false/.test(rules));
  assert.ok(/"storage"/.test(fs.readFileSync(path.join(__dirname, "..", "..", "firebase.json"), "utf8")));
  // separate sign-up per service
  assert.ok(/partnerCategory:\s+window\.PZ_PARTNER_TYPE/.test(reg) && /ac:\s+\{ title: "AC Technician partner"/.test(reg) && /parcel:\s+\{ title: "Parcel Delivery Rider"/.test(reg));
  for (const [f, svc] of [["join-packers-movers-partner-bangalore.html","movers"],["join-ac-technician-bangalore.html","ac"],["join-electrician-plumber-carpenter-bangalore.html","handyman"],["join-parcel-delivery-rider-bangalore.html","parcel"]]) {
    const h = pub(f); assert.ok(h.includes("partner-register.html?type=" + svc) && /FAQPage/.test(h) && pub("sitemap.xml").includes(f) && pub("partner.html").includes(f), f);
  }
  assert.ok(/id="partnerTrack"/.test(pub("admin.html")));
  ok("separate sign-up per service: 5 recruitment pages (FAQ schema, sitemap) → registration preset per service → admin filter by service");
  ok("wiring: Aadhaar number not stored (last 4 only), skills on sign-up, approved partners go to the crew app, admin Partners tab, storage rules");

  console.log(`\npartners: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
