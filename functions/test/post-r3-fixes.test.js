/**
 * Post-R3 customer payment + invoice fixes — mocks only.
 *   node test/post-r3-fixes.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const mp = require("../move-payment.js");
const PackZenPricing = require("../pricing-engine-v2.js");
const fmt = require("../../public/booking-format.js");

const PUB = path.join(__dirname, "..", "..", "public");
const scriptSrc = fs.readFileSync(path.join(PUB, "script.js"), "utf8");
const adminSrc = fs.readFileSync(path.join(PUB, "admin.html"), "utf8");
const indexSrc = fs.readFileSync(path.join(PUB, "index.html"), "utf8");
const SECRET = "test_secret_not_real";
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ── tiny in-memory Firestore (serialized transactions) ── */
function makeDb() {
  const store = {};
  const col = (n) => (store[n] = store[n] || {});
  const has = (n, id) => Object.prototype.hasOwnProperty.call(col(n), id);
  const snap = (n, id) => ({ exists: has(n, id), id, data: () => clone(col(n)[id]) });
  const ref = (n, id) => ({ _n: n, id, get: async () => snap(n, id), set: async (d) => { col(n)[id] = clone(d); }, update: async (d) => { Object.assign(col(n)[id], clone(d)); } });
  let chain = Promise.resolve();
  return { col, collection: (n) => ({ doc: (id) => ref(n, id) }),
    runTransaction(fn) {
      const run = chain.then(async () => {
        const w = [];
        const tx = { get: async (r) => snap(r._n, r.id), create: (r, d) => w.push(() => { if (has(r._n, r.id)) throw new Error("EXISTS"); col(r._n)[r.id] = clone(d); }),
          set: (r, d) => w.push(() => { col(r._n)[r.id] = clone(d); }), update: (r, d) => w.push(() => Object.assign(col(r._n)[r.id], clone(d))) };
        const out = await fn(tx); w.forEach((f) => f()); return out;
      });
      chain = run.catch(() => {}); return run;
    } };
}
function env() {
  const db = makeDb(); const payments = {}; let n = 0;
  const base = { db, serverTimestamp: () => "TS", now: () => 1760000000000, logger: { info() {}, warn() {}, error() {} },
    verifyIdToken: async (t) => { if (t !== "tokA") throw new Error("bad"); return { uid: "uidA", email: "a@example.com", email_verified: true }; } };
  return { db, payments,
    create: Object.assign({}, base, { quote: async (qi) => { qi.km = 12; return PackZenPricing.calculateQuote(qi); }, normalize: (qi) => PackZenPricing.validateInput(qi).data,
      createOrder: async (o) => ({ id: "order_FIX" + String(++n).padStart(8, "0"), amount: o.amount, currency: o.currency }) }),
    verify: Object.assign({}, base, { keySecret: SECRET, fetchPayment: async (id) => clone(payments[id]) }) };
}
const QI = { pickup: "Koramangala, Bangalore", drop: "Whitefield, Bangalore", vehicleId: "tata_ace", furniture: { sofaCheck: 2, bedCheck: 1 }, cartonQty: 5, pickupFloor: 1, dropFloor: 2, liftAvailable: false, packingService: true };
const DETAILS = { altPhone: "9123456780", shiftTime: "morning", shiftTimeLabel: "8 AM – 11 AM", house: "2 BHK", unpackingService: true, assembly: true, dismantling: false,
  storageNeeded: true, storageDays: 7, fragileItems: "Glass table", specialItems: "Piano", remarks: "Call before arrival",
  total: 1, paid: 999, customerUid: "attacker", email: "x@evil.test", status: "delivered", balanceDue: 0, paymentStatus: "paid", unknownField: "drop me" };
async function payFlow(e, details) {
  const body = { quoteInput: clone(QI), paymentType: "advance", customerName: "Asha", phone: "9876543210", moveType: "home", pickup: QI.pickup, drop: QI.drop, date: "2026-11-20", requestId: "req_" + crypto.randomBytes(6).toString("hex") };
  if (details !== undefined) body.details = details;
  const o = await mp.handleCreateOrder({ headers: { authorization: "Bearer tokA" }, body }, e.create);
  assert.strictEqual(o.status, 200, JSON.stringify(o.body));
  const pid = "pay_FIX" + crypto.randomBytes(5).toString("hex");
  e.payments[pid] = { id: pid, order_id: o.body.orderId, amount: o.body.amount, currency: "INR", status: "captured" };
  const sig = crypto.createHmac("sha256", SECRET).update(o.body.orderId + "|" + pid).digest("hex");
  const v = await mp.handleVerifyPayment({ headers: { authorization: "Bearer tokA" }, body: { razorpay_order_id: o.body.orderId, razorpay_payment_id: pid, razorpay_signature: sig } }, e.verify);
  assert.strictEqual(v.status, 200, JSON.stringify(v.body));
  return { order: o.body, booking: e.db.col("bookings")[o.body.orderId], pending: e.db.col("pendingPayments")[o.body.orderId] };
}

const tests = []; const test = (n, f) => tests.push({ n, f });

/* ── server: descriptive details ── */
test("details: allow-listed fields stored on pending and booking", async () => {
  const { booking, pending } = await payFlow(env(), DETAILS);
  const want = { altPhone: "9123456780", shiftTime: "morning", shiftTimeLabel: "8 AM – 11 AM", house: "2 BHK", unpackingService: true, assembly: true,
    storageNeeded: true, storageDays: 7, fragileItems: "Glass table", specialItems: "Piano", remarks: "Call before arrival" };
  assert.deepStrictEqual(pending.details, want);
  for (const [k, v] of Object.entries(want)) assert.deepStrictEqual(booking[k], v, k);
  assert.ok(!("dismantling" in booking), "false booleans are not stored"); assert.ok(!("unknownField" in booking));
});
test("details: cannot override authoritative booking fields", async () => {
  const { booking, order } = await payFlow(env(), DETAILS);
  assert.strictEqual(booking.total, order.grandTotal); assert.strictEqual(booking.paid, order.payNow);
  assert.strictEqual(booking.balanceDue, order.grandTotal - order.payNow); assert.strictEqual(booking.paymentStatus, "partially_paid");
  assert.strictEqual(booking.customerUid, "uidA"); assert.strictEqual(booking.email, "a@example.com"); assert.strictEqual(booking.status, "confirmed");
});
test("details: missing/garbage details → booking identical to before (old clients keep working)", async () => {
  for (const d of [undefined, null, "x", [1, 2], {}]) {
    const { booking, pending } = await payFlow(env(), d);
    assert.deepStrictEqual(pending.details, {});
    for (const k of ["altPhone", "shiftTime", "house", "remarks", "storageDays"]) assert.ok(!(k in booking), k);
  }
});
test("details: sanitizer caps lengths and rejects bad values", () => {
  const s = mp._internal.sanitizeDetails;
  const out = s({ altPhone: "12345", remarks: "r".repeat(900), house: 42, storageNeeded: "yes", storageDays: 9999, shiftTime: "  x  ", assembly: "true" });
  assert.deepStrictEqual(out, { shiftTime: "x", remarks: "r".repeat(500) });
  assert.deepStrictEqual(s({ storageNeeded: true, storageDays: 3.5 }), { storageNeeded: true });
  assert.deepStrictEqual(s({ altPhone: "912345678012" }), {}, "over-long phone is rejected, not truncated");
});
test("details: webhook/reconciliation path (finalizeCapture) carries the same details", async () => {
  const e = env();
  const body = { quoteInput: clone(QI), paymentType: "full", customerName: "Asha", phone: "9876543210", moveType: "home", pickup: QI.pickup, drop: QI.drop, date: "2026-11-20", requestId: "req_webhookfirst1", details: DETAILS };
  const o = (await mp.handleCreateOrder({ headers: { authorization: "Bearer tokA" }, body }, e.create)).body;
  const out = await mp.finalizeCapture(e.verify, { orderId: o.orderId, paymentId: "pay_WEBHOOK00001", amountPaise: o.amount, expectedUid: null, via: "webhook" });
  assert.ok(out.created); assert.strictEqual(out.created.shiftTimeLabel, "8 AM – 11 AM"); assert.strictEqual(out.created.paymentStatus, "paid");
});

/* ── invoice formatting ── */
test("format: online-paid furniture object → readable lines (root cause of [object Object])", () => {
  const b = { furniture: { sofaCheck: 2, bedCheck: 1, chairCheck: 0, mysteryWidgetCheck: 3 }, cartonQty: 5 };
  assert.deepStrictEqual(fmt.furnitureLines(b), ["Sofa × 2", "Bed × 1", "Mystery Widget × 3", "Cartons × 5"]);
  const t = fmt.itemsSummaryText(b);
  assert.strictEqual(t, "Furniture:\n- Sofa × 2\n- Bed × 1\n- Mystery Widget × 3\n- Cartons × 5");
  assert.ok(!t.includes("[object"));
});
test("format: pay-later/advisor string summary passes through (no duplicate cartons)", () => {
  assert.deepStrictEqual(fmt.furnitureLines({ furniture: "Sofa ×2, Bed, Cartons ×10", cartonQty: 10 }), ["Sofa ×2", "Bed", "Cartons ×10"]);
});
test("format: legacy selectedFurniture, empty and weird shapes", () => {
  assert.deepStrictEqual(fmt.furnitureLines({ selectedFurniture: { deskCheck: 1, "Chair": 2 } }), ["Office Desk × 1", "Chair × 2"]);
  for (const b of [{}, { furniture: {} }, { furniture: "" }, { furniture: null }, { furniture: 5 }, null]) assert.strictEqual(fmt.itemsSummaryText(b), "None specified", JSON.stringify(b));
  assert.deepStrictEqual(fmt.furnitureLines({ furniture: ["Desk × 1", 3, ""] }), ["Desk × 1"]);
  assert.deepStrictEqual(fmt.furnitureLines({ furniture: { sofaCheck: "2", bedCheck: -1, tvCheck: "x" } }), ["Sofa × 2"]);
});
test("format: every engine furniture key has a human label", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "pricing-engine-v2.js"), "utf8");
  const block = src.slice(src.indexOf("furnitureUnits: {"), src.indexOf("heavyItemsList"));
  const keys = block.match(/[a-zA-Z]+Check/g);
  assert.ok(keys.length > 20);
  for (const k of keys) assert.ok(!/Check$/.test(fmt.furnitureLabel(k)) && fmt.furnitureLabel(k).length > 1, k);
});
test("format: vehicle, time slot and floor labels", () => {
  assert.strictEqual(fmt.vehicleLabel({ vehicle: "Tata Ace (7ft)" }), "Tata Ace (7ft)");
  assert.strictEqual(fmt.vehicleLabel({ vehicleUsed: "truck_14ft", vehicleId: "tata_ace" }), "14 ft Truck");
  assert.strictEqual(fmt.vehicleLabel({ vehicleId: "tata_ace" }), "Tata Ace");
  assert.strictEqual(fmt.vehicleLabel({}), "");
  assert.strictEqual(fmt.timeLabel({ shiftTimeLabel: "8 AM – 11 AM", shiftTime: "morning" }), "8 AM – 11 AM");
  assert.strictEqual(fmt.timeLabel({ shiftTime: "morning" }), "morning"); assert.strictEqual(fmt.timeLabel({}), "");
  assert.strictEqual(fmt.floorLabel(0), "Ground Floor"); assert.strictEqual(fmt.floorLabel(3), "Floor 3"); assert.strictEqual(fmt.floorLabel("2nd Floor"), "2nd Floor");
});
test("invoices (customer + admin) use the formatter; no raw object stringification left", () => {
  for (const [name, src] of [["script.js", scriptSrc], ["admin.html", adminSrc]]) {
    assert.ok(src.includes("PackZenBookingFormat.itemsSummaryText(b)"), name);
    assert.ok(src.includes("PackZenBookingFormat.vehicleLabel(b)"), name);
    assert.ok(src.includes("PackZenBookingFormat.timeLabel(b)"), name);
    assert.ok(!src.includes('let furnText = b.furniture || ""'), name);
    assert.ok(!src.includes("`${k} x${v}`"), name);
  }
  assert.ok(/booking-format\.js\?v=1"><\/script>\s*<script src="script\.js\?v=10">/.test(indexSrc), "index loads formatter before script.js");
  assert.ok(adminSrc.includes('<script src="booking-format.js"></script>'));
});

/* ── payment UI: run the real helper code in a sandbox with fast timers ── */
function loadHelpers({ fetchImpl, getIdToken }) {
  const a = scriptSrc.indexOf("const PAYMENT_TOKEN_TIMEOUT_MS");
  const z = scriptSrc.indexOf("// Descriptive booking details for the paid flow");
  let code = scriptSrc.slice(a, z)
    .replace("const PAYMENT_TOKEN_TIMEOUT_MS = 10000;", "const PAYMENT_TOKEN_TIMEOUT_MS = 40;")
    .replace("const PAYMENT_REQUEST_TIMEOUT_MS = 25000;", "const PAYMENT_REQUEST_TIMEOUT_MS = 60;")
    .replace("[0, 2000, 3000, 5000, 8000, 12000, 15000]", "[0, 5, 5, 5, 5, 5, 5]");
  assert.ok(code.includes("= 40;") && code.includes("= 60;") && code.includes("[0, 5, 5"), "test hooks matched");
  const ctx = { window: { _firebase: { auth: { currentUser: { getIdToken } } } }, currentUser: null, MOVE_PAYMENT_API: "https://x.test",
    fetch: fetchImpl, AbortController, setTimeout, clearTimeout, Promise, Date, JSON, Object, Error };
  vm.createContext(ctx);
  vm.runInContext(code + "\nthis._confirmMovePayment=_confirmMovePayment; this._authedPaymentPost=_authedPaymentPost;", ctx);
  return ctx;
}
const RZP = { razorpay_order_id: "order_X", razorpay_payment_id: "pay_X", razorpay_signature: "s" };
const reply = (status, data) => ({ status, json: async () => data });
const OK = reply(200, { success: true, bookingRef: "PKZ-1", bookingId: "order_X", total: 4204, paid: 420, balanceDue: 3784 });

test("ui: verify 200 → confirmed on first attempt; Bearer token sent", async () => {
  const calls = [];
  const h = loadHelpers({ getIdToken: async () => "TOKEN", fetchImpl: async (u, init) => { calls.push(init.headers.Authorization); return OK; } });
  const r = await h._confirmMovePayment(RZP);
  assert.strictEqual(r.state, "confirmed"); assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0], "Bearer TOKEN");
});
test("ui: webhook-first booking → verify returns existing booking (duplicate) → confirmed", async () => {
  const h = loadHelpers({ getIdToken: async () => "T", fetchImpl: async () => reply(200, { success: true, duplicate: true, bookingRef: "PKZ-1" }) });
  assert.strictEqual((await h._confirmMovePayment(RZP)).state, "confirmed");
});
test("ui: capture lag (202, 202) then 200 → confirmed, progress reported", async () => {
  let n = 0; const seen = [];
  const h = loadHelpers({ getIdToken: async () => "T", fetchImpl: async () => (++n < 3 ? reply(202, { code: "payment_not_captured" }) : OK) });
  const r = await h._confirmMovePayment(RZP, (a) => seen.push(a));
  assert.strictEqual(r.state, "confirmed"); assert.strictEqual(n, 3); assert.deepStrictEqual(seen, [1, 2, 3]);
});
test("ui: hung verify request is aborted and retried; never hangs; ends pending", async () => {
  let n = 0;
  const hang = (u, init) => { n++; return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))); };
  const t0 = Date.now();
  const r = await loadHelpers({ getIdToken: async () => "T", fetchImpl: hang })._confirmMovePayment(RZP);
  assert.strictEqual(r.state, "pending"); assert.strictEqual(n, 7); assert.ok(Date.now() - t0 < 3000);
});
test("ui: hung getIdToken is time-bounded", async () => {
  let n = 0;
  const r = await loadHelpers({ getIdToken: () => new Promise(() => {}), fetchImpl: async () => { n++; return OK; } })._confirmMovePayment(RZP);
  assert.strictEqual(r.state, "pending"); assert.strictEqual(n, 0);
});
test("ui: definitive rejection (409) stops after one call → pending notice, not 'failed'", async () => {
  let n = 0;
  const r = await loadHelpers({ getIdToken: async () => "T", fetchImpl: async () => { n++; return reply(409, { code: "legacy_order" }); } })._confirmMovePayment(RZP);
  assert.strictEqual(r.state, "pending"); assert.strictEqual(n, 1);
});
test("ui: network errors then success → confirmed", async () => {
  let n = 0;
  const r = await loadHelpers({ getIdToken: async () => "T", fetchImpl: async () => { if (++n < 3) throw new TypeError("Failed to fetch"); return OK; } })._confirmMovePayment(RZP);
  assert.strictEqual(r.state, "confirmed");
});
test("ui: handler always resets the button (finally) and ignores a second success callback", () => {
  const h = scriptSrc.slice(scriptSrc.indexOf("handler: async function (response) {"), scriptSrc.indexOf("modal: { ondismiss: _resetPayBtn }"));
  assert.ok(/if \(paymentConfirmInFlight\) return;/.test(h));
  assert.ok(/finally \{\s*paymentConfirmInFlight = false;\s*_resetPayBtn\(\);/.test(h));
  assert.ok(h.indexOf("_resetPayBtn()") < h.indexOf('if (result.state === "confirmed")'), "reset happens before rendering");
  assert.ok(/let paymentConfirmInFlight = false;/.test(scriptSrc));
});
test("ui: paid order sends descriptive details, still no email/total/amount", () => {
  const body = scriptSrc.slice(scriptSrc.indexOf('_authedPaymentPost("/createRazorpayOrder"'), scriptSrc.indexOf("if (status !== 200")).replace(/\/\/.*$/gm, "");
  assert.ok(body.includes("details: _collectMoveDetails()"));
  assert.ok(!/\bemail\b/.test(body) && !/\btotal\b/.test(body) && !/\bamount\b/.test(body));
  const fn = scriptSrc.slice(scriptSrc.indexOf("function _collectMoveDetails()"), scriptSrc.indexOf("function _showPaymentPendingNotice"));
  for (const k of ["shiftTime", "shiftTimeLabel", "house", "remarks", "fragileItems", "specialItems", "altPhone"]) assert.ok(fn.includes(k + ":"), k);
  assert.ok(!/\b(total|amount|price|email|customerUid)\s*:/.test(fn));
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.f(); pass++; console.log("  PASS  " + t.n); }
    catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.message)); }
  }
  console.log(`\npost-r3-fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
