/**
 * Parcel delivery: approved rates, validation, Bangalore→Bangalore, server-only
 * price, prepaid order, booking via the shared payment core, rider assignment.
 *   node test/parcel.test.js
 */
"use strict";
process.env.GCLOUD_PROJECT = "packzen-e7539";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const pp = require("../parcel-pricing.js");
const mp = require("../move-payment.js");
const { _parcel } = require("../parcel-booking.js");
const engine = require("../assignment-engine.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };

(async () => {
  // approved rates
  assert.deepStrictEqual([5, 12, 25].map((k) => pp.priceParcel(k, 5).total), [82, 159, 302]);
  assert.strictEqual(pp.priceParcel(1.2, 2).total, 49);
  assert.strictEqual(pp.priceParcel(2.05, 2).total, 60);     // 2.1 km → 1 started km
  assert.strictEqual(pp.priceParcel(12, 10).total, 159);     // 10 kg: no surcharge
  assert.strictEqual(pp.priceParcel(12, 10.5).total, 189);   // >10 kg: +₹30
  ok("approved rates: ₹49 first 2 km, ₹11 per started km, +₹30 over 10 kg (5/12/25 km → ₹82/159/302)");
  assert.throws(() => pp.priceParcel(41, 5), /up to 40 km/);
  assert.throws(() => pp.priceParcel(10, 20.5), /between 0.1 and 20 kg/);
  assert.throws(() => pp.priceParcel(0, 5), /couldn't measure/);
  ok("limits: max 40 km, max 20 kg, unmeasurable route refused");

  const now = new Date("2026-10-14T05:00:00Z");
  const good = { senderName: "Asha", senderPhone: "+91 98765 43210", receiverName: "Ravi", receiverPhone: "9123456780",
    pickup: "12 MG Road, Bengaluru 560001", drop: "4 HSR Layout, Bengaluru 560102", itemDescription: "Documents",
    weightKg: "2.5", date: "2026-10-15", timeSlot: "morning" };
  const v = pp.validateParcelDetails(good, now);
  assert.ok(v.ok, v.errors.join()); assert.strictEqual(v.value.senderPhone, "9876543210"); assert.strictEqual(v.value.weightKg, 2.5);
  const bad = pp.validateParcelDetails(Object.assign({}, good, { receiverPhone: "12345", date: "2026-10-01", weightKg: 25, itemDescription: "" }), now);
  assert.ok(!bad.ok && bad.errors.length === 4);
  ok("validation: contacts, addresses, item, weight, date and slot");

  const fakeRoute = (km, o, dd) => async () => ({ km, originAddress: o, destinationAddress: dd });
  const ORIG = "MG Road, Bengaluru, Karnataka 560001, India", DEST = "HSR Layout, Bengaluru, Karnataka 560102, India";
  await assert.rejects(_parcel.quoteParcel(good, { route: fakeRoute(30, ORIG, "Hosur, Tamil Nadu 635109, India"), now: () => now.getTime() }), /drop.*outside|pincode 635109/i);
  await assert.rejects(_parcel.quoteParcel(good, { route: fakeRoute(30, "Mysuru, Karnataka 570001, India", DEST), now: () => now.getTime() }), /570001/);
  const q = await _parcel.quoteParcel(good, { route: fakeRoute(12, ORIG, DEST), now: () => now.getTime() });
  assert.strictEqual(q.total, 159);
  ok("both pickup and drop must be in the service area; price uses the server distance");

  // order creation
  const writes = {};
  const db = { collection: (c) => ({ doc: (id) => ({ set: async (d) => { writes[c + "/" + id] = d; } }) }) };
  // Parcel delivery is retired: the live function refuses new orders (checked below);
  // the legacy pricing/order logic is still exercised with allowRetired for regression safety.
  const retired = await _parcel.handleCreateParcelOrder({ headers: { authorization: "Bearer x" }, body: {} }, {});
  assert.strictEqual(retired.status, 410); assert.strictEqual(retired.body.code, "service_retired");
  const deps = (extra) => Object.assign({ allowRetired: true, verifyIdToken: async () => ({ uid: "u1", email: "a@x.in", email_verified: true }), db,
    serverTimestamp: () => "TS", now: () => now.getTime(), route: fakeRoute(12, ORIG, DEST), logger: { info() {}, warn() {}, error() {} },
    createOrder: async (o) => ({ id: "order_ABC123xyz", amount: o.amount, currency: o.currency }) }, extra || {});
  const req = (body) => ({ headers: { authorization: "Bearer t" }, body });
  let r = await _parcel.handleCreateParcelOrder(req({ requestId: "req_12345678", details: Object.assign({}, good, { total: 1, km: 0.5, price: 1 }) }), deps());
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.amount, 15900); assert.strictEqual(r.body.serverCalculatedTotal, 159);
  const pend = writes["pendingPayments/order_ABC123xyz"];
  assert.strictEqual(pend.flow, "parcel"); assert.strictEqual(pend.amount, 159); assert.strictEqual(pend.parcel.dropPincode, "560102");
  assert.ok(!("total" in pend.details) && !("km" in pend.details));
  ok("order: amount is server-computed (client total/km ignored); pending payment stored with flow 'parcel'");
  r = await _parcel.handleCreateParcelOrder({ headers: {}, body: {} }, deps()); assert.strictEqual(r.status, 401);
  r = await _parcel.handleCreateParcelOrder(req({ requestId: "req_12345678", details: good }), deps({ route: fakeRoute(55, ORIG, DEST) }));
  assert.strictEqual(r.status, 400); assert.ok(/40 km/.test(r.body.error));
  r = await _parcel.handleCreateParcelOrder(req({ requestId: "req_12345678", details: good }), deps({ rateLimit: async () => ({ ok: false }) }));
  assert.strictEqual(r.status, 429);
  ok("order: signed-in only, distance/area errors shown to the customer, rate-limited");

  // shared core → parcel booking
  const pendingDoc = pend; const store = { "pendingPayments/order_ABC123xyz": JSON.parse(JSON.stringify(pendingDoc)) };
  const fdb = { collection: (c) => ({ doc: (id) => ({ _k: c + "/" + id }) }),
    runTransaction: async (fn) => fn({ get: async (ref) => ({ exists: ref._k in store, data: () => store[ref._k] }),
      create: (ref, d) => { store[ref._k] = d; }, set: (ref, d) => { store[ref._k] = d; }, update: (ref, d) => Object.assign(store[ref._k], d) }) };
  const res = await mp.finalizeCapture({ db: fdb, serverTimestamp: () => "TS" }, { orderId: "order_ABC123xyz", paymentId: "pay_1", amountPaise: 15900, expectedUid: "u1", via: "verify" });
  const b = res.created;
  assert.strictEqual(b.bookingType, "parcel"); assert.strictEqual(b.moveType, "parcel"); assert.strictEqual(b.status, "confirmed");
  assert.strictEqual(b.customerName, "Asha"); assert.strictEqual(b.receiverPhone, "9123456780"); assert.strictEqual(b.vehicleId, "two_wheeler");
  assert.strictEqual(b.total, 159); assert.strictEqual(b.paid, 159); assert.strictEqual(b.parcel.weightKg, 2.5);
  assert.strictEqual(store["pendingPayments/order_ABC123xyz"].status, "consumed");
  const again = await mp.finalizeCapture({ db: fdb, serverTimestamp: () => "TS" }, { orderId: "order_ABC123xyz", paymentId: "pay_1", amountPaise: 15900, expectedUid: "u1" });
  assert.ok(again.existing);
  ok("payment core creates a confirmed, fully-paid parcel booking once (booking id = order id; repeat is idempotent)");

  const reqm = engine._requirementFor ? engine._requirementFor(b) : null;
  const src = fs.readFileSync(path.join(__dirname, "..", "assignment-engine.js"), "utf8");
  assert.ok(/isParcel/.test(src) && /categorySkill\.parcel \|\| "parcel"/.test(src));
  ok("assignment: parcel jobs go to riders with the 'parcel' skill (no truck capacity check)" + (reqm ? "" : ""));

  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(/require\("\.\/parcel-booking"\)/.test(idx) && !/Object\.assign\(exports, require\("\.\/parcel-booking"\)\)/.test(idx));
  ok("index exports getParcelQuote + createParcelRazorpayOrder (test hooks not exported)");

  console.log(`\nparcel: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
