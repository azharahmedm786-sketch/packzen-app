/**
 * Website modernization — marketplace taxonomy, customer booking cards,
 * tracking selection and page wiring. Static + sandboxed checks only.
 *   node test/ui-marketplace.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUB = path.join(__dirname, "..", "..", "public");
const read = (f) => fs.readFileSync(path.join(PUB, f), "utf8");
const mk = require("../../public/marketplace.js");
const PaymentState = require("../../public/payment-state.js");
const BookingFormat = require("../../public/booking-format.js");
const scriptSrc = read("script.js");
const indexSrc = read("index.html");
const servicesSrc = read("services.html");

function loadCardHelpers() {
  const esc = scriptSrc.slice(scriptSrc.indexOf("function escapeHTML(str) {"), scriptSrc.indexOf("}", scriptSrc.indexOf('.replace(/\'/g, "&#039;");')) + 1);
  const cap = scriptSrc.match(/function capitalize\(s\) \{[^\n]*\}/)[0];
  const block = scriptSrc.slice(scriptSrc.indexOf("const BOOKING_STATUS_LABELS"), scriptSrc.indexOf("function attachBookingButtonListeners() {"));
  const pick = scriptSrc.slice(scriptSrc.indexOf("function _pickTrackedBooking(list) {"), scriptSrc.indexOf("function updateTrackingUI(b) {"));
  const ctx = { window: { PackZenPaymentState: PaymentState, PackZenBookingFormat: BookingFormat }, currentBookingId: null,
    localStorage: { getItem: () => null }, Number, Math, String, Array, JSON };
  vm.createContext(ctx);
  vm.runInContext([esc, cap, block, pick, "this.renderBookingCard=renderBookingCard; this._pickTrackedBooking=_pickTrackedBooking;"].join("\n"), ctx);
  return ctx;
}
const BAD = ["undefined", "null", "NaN", "[object Object]"];
const clean = (html) => BAD.forEach((t) => assert.ok(!new RegExp("(^|[^a-zA-Z])" + t.replace(/[[\]]/g, "\\$&") + "([^a-zA-Z]|$)").test(html.replace(/data-[a-z]+="[^"]*"/g, "")), "rendered '" + t + "'"));

const tests = []; const test = (n, f) => tests.push({ n, f });

/* marketplace taxonomy */
test("taxonomy: five categories with every required service", () => {
  const want = {
    moving: ["House shifting", "Office relocation", "Single item", "Packing & unpacking", "Bike transport", "Car transport"],
    ac: ["AC installation", "AC uninstallation", "AC servicing", "AC repair", "AC gas refill", "AC inspection"],
    appliances: ["TV wall mount", "Refrigerator repair", "Washing machine repair", "Geyser repair", "RO / water purifier"],
    home: ["Electrical", "Carpentry", "Plumbing", "Painting", "Cleaning", "Pest control", "Bathroom cleaning", "Kitchen cleaning"],
    delivery: ["Single-item delivery", "Two-wheeler parcel", "Bike transport", "Car transport"],
  };
  assert.deepStrictEqual(mk.CATEGORIES.map((c) => c.id), Object.keys(want));
  for (const c of mk.CATEGORIES) assert.deepStrictEqual(c.services.map((s) => s.name), want[c.id], c.id);
  assert.strictEqual(mk.CITY, "Bangalore");
});
test("taxonomy: navigation only — no prices/amounts defined client-side", () => {
  const src = read("marketplace.js");
  assert.ok(!/₹|\bprice\s*:|\bamount\s*:|\btotal\s*:/.test(src.slice(src.indexOf("var CATEGORIES"), src.indexOf("function esc("))));
});
test("search: keywords and partial words match; no match returns empty", () => {
  const names = (q) => mk.filter(q).map((r) => r.service.name);
  assert.ok(names("ac repair").includes("AC repair"));
  assert.ok(names("fridge").includes("Refrigerator repair"));
  assert.ok(names("plumber").includes("Plumbing"));
  assert.ok(names("scooter").includes("Bike transport"));
  assert.deepStrictEqual(names("helicopter"), []);
  assert.strictEqual(mk.filter("").length, 29);
});
test("routing: moving uses existing quote flow / SEO pages; other services go to catalog search", () => {
  const find = (n) => mk.CATEGORIES.flatMap((c) => c.services).find((s) => s.name === n);
  assert.strictEqual(find("House shifting").move, "home");
  assert.strictEqual(mk.hrefFor(find("AC installation")), "services.html?q=AC%20installation");
  assert.strictEqual(mk.hrefFor(find("Electrical")), "services.html?q=electrician", "search wording matches the catalog item");
  assert.strictEqual(mk.hrefFor(find("AC repair")), null, "not offered → no booking link");
  assert.strictEqual(mk.hrefFor(find("Two-wheeler parcel")), null);
  for (const s of mk.CATEGORIES.flatMap((c) => c.services)) if (s.href && !s.href.includes("#")) assert.ok(fs.existsSync(path.join(PUB, s.href.split("?")[0])), "missing page " + s.href);
});

/* booking cards */
const H = loadCardHelpers();
test("card: online advance booking shows total, paid, balance, badge and next action", () => {
  const html = H.renderBookingCard({ status: "confirmed", pickup: "Koramangala, Bangalore", drop: "Chennai, TN", date: "2026-11-20", shiftTimeLabel: "8 AM – 11 AM",
    total: 4204, paid: 420, balanceDue: 3784, paymentStatus: "partially_paid", paymentId: "pay_x", orderId: "order_x", bookingRef: "PKZ-ABC" }, "order_x");
  assert.ok(html.includes("Koramangala → Chennai")); assert.ok(html.includes("₹4,204")); assert.ok(html.includes("₹420")); assert.ok(html.includes("₹3,784"));
  assert.ok(html.includes("pz-badge--confirmed")); assert.ok(html.includes("8 AM – 11 AM"));
  assert.ok(html.includes("will appear here once assigned")); clean(html);
});
test("card: legacy online booking (no paid field) never invents a balance", () => {
  const html = H.renderBookingCard({ status: "confirmed", total: 300, paymentId: "pay_old", pickup: "A", drop: "B" }, "x1");
  assert.ok(html.includes("Being confirmed")); assert.ok(html.includes("₹300")); clean(html);
});
test("card: fully paid shows 'Fully paid'; service booking titled by items", () => {
  const html = H.renderBookingCard({ bookingType: "service", status: "assigned", items: [{ name: "AC repair" }, { name: "Gas refill" }, { name: "Stand" }],
    total: 1500, paid: 1500, balanceDue: 0, driverName: "Ravi" }, "s1");
  assert.ok(html.includes("AC repair, Gas refill +1 more")); assert.ok(html.includes("Fully paid")); assert.ok(html.includes("Assigned: Ravi")); clean(html);
});
test("card: missing fields never render undefined/null/NaN/[object Object]", () => {
  for (const b of [{}, { status: null, total: undefined, date: null }, { furniture: { sofaCheck: 2 }, total: "abc" }, { items: [null, { name: 5 }], bookingType: "service" }]) {
    clean(H.renderBookingCard(b, "id1"));
  }
});
test("card: hostile values are escaped (text and data attributes)", () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const html = H.renderBookingCard({ status: "confirmed", bookingRef: evil, date: evil, pickup: evil, drop: "B", driverName: evil, deliveryOtp: evil }, "id\"x");
  assert.ok(!html.includes("<img"), "unescaped markup"); assert.ok(!/data-ref="[^"]*"\s*>\s*<img/.test(html));
  assert.ok(html.includes("&quot;&gt;&lt;img"));
});
test("card: action rules unchanged (reschedule only pending/confirmed; cancel not after packing)", () => {
  assert.ok(H.renderBookingCard({ status: "confirmed" }, "a").includes('data-action="reschedule"'));
  assert.ok(!H.renderBookingCard({ status: "assigned" }, "a").includes('data-action="reschedule"'));
  assert.ok(!H.renderBookingCard({ status: "packing" }, "a").includes('data-action="cancel"'));
  assert.ok(H.renderBookingCard({ status: "delivered" }, "a").includes('data-action="rate"'));
});

/* tracking selection */
test("tracking: prefers active booking over older/cancelled ones (R2-10)", () => {
  const list = [{ id: "c", status: "cancelled" }, { id: "b", status: "confirmed" }, { id: "a", status: "delivered" }];
  assert.strictEqual(H._pickTrackedBooking(list).id, "b");
  assert.strictEqual(H._pickTrackedBooking([{ id: "x", status: "delivered" }, { id: "y", status: "cancelled" }]).id, "x");
  H.currentBookingId = "a"; assert.strictEqual(H._pickTrackedBooking(list).id, "a"); H.currentBookingId = null;
  assert.ok(/orderBy\("createdAt","desc"\)\.limit\(10\)\s*\.onSnapshot/.test(scriptSrc));
  assert.ok(scriptSrc.includes('Your driver/technician will appear here once assigned.'));
});

/* page wiring / SEO / hygiene */
test("homepage: marketplace message, sections, Bangalore notice, design system and scripts", () => {
  assert.ok(indexSrc.includes("Moving, Home &amp; Service Solutions <span class=\"purple-gradient\">in Bangalore</span>"));
  for (const id of ['id="marketplace"', 'id="how-it-works"', 'id="service-areas"', 'id="reviews"', 'id="faq"', 'id="quote"', "data-pz-marketplace"]) assert.ok(indexSrc.includes(id), id);
  assert.ok(indexSrc.includes("PackZen services are currently available in Bangalore. Moves start from Bangalore"));
  assert.ok(/pz-ui\.css\?v=\d+/.test(indexSrc));
  assert.ok(/marketplace\.js\?v=\d+"><\/script>\s*<script src="script\.js\?v=\d+">/.test(indexSrc));
  assert.ok(/booking-format\.js\?v=1/.test(indexSrc) && /payment-state\.js\?v=1/.test(indexSrc));
  assert.ok(/<title>PackZen — Packers &amp; Movers, AC &amp; Home Services in Bangalore<\/title>|<title>PackZen — Packers & Movers, AC & Home Services in Bangalore<\/title>/.test(indexSrc));
});
test("services page: Bangalore notice, marketplace + query results wired", () => {
  assert.ok(servicesSrc.includes("currently available in Bangalore only")); assert.ok(servicesSrc.includes('id="pzQueryResult"'));
  assert.ok(/catalog-public\.js"><\/script>\s*<script src="marketplace\.js\?v=\d+">/.test(servicesSrc));
});
test("hygiene: no unpinned lucide, no broken #hero links, payment/invoice wiring intact", () => {
  for (const f of fs.readdirSync(PUB).filter((f) => f.endsWith(".html"))) {
    const t = read(f);
    assert.ok(!t.includes("lucide@latest"), f); assert.ok(!t.includes('href="index.html#hero"'), f);
  }
  assert.ok(scriptSrc.includes("PackZenBookingFormat.itemsSummaryText(b)"));
  assert.ok(scriptSrc.includes('_authedPaymentPost("/verifyRazorpayPayment", body), remaining(), "confirm_deadline"'));
  assert.ok(!/console\.log\("loadUserBookings called"\)/.test(scriptSrc));
});

/* ── pre-merge gate: truthful availability, single contact source, safe HTML ── */
test("availability: every service has an honest status; only real booking paths are linked", () => {
  const all = mk.CATEGORIES.flatMap((c) => c.services);
  for (const sv of all) assert.ok(["book", "addon", "soon"].includes(sv.status), sv.name);
  const st = (n) => all.find((x) => x.name === n).status;
  // Bookable online today: the move-quote flow, or items seeded in the live catalog (tools/seedCatalog.js).
  for (const n of ["House shifting", "Office relocation", "Single item", "Single-item delivery", "AC installation", "AC uninstallation", "TV wall mount", "Electrical", "Carpentry"]) assert.strictEqual(st(n), "book", n);
  for (const n of ["Packing & unpacking", "Bike transport"]) assert.strictEqual(st(n), "addon", n);
  for (const n of ["AC servicing", "AC repair", "AC gas refill", "AC inspection", "Refrigerator repair", "Washing machine repair", "Geyser repair", "RO / water purifier",
                   "Plumbing", "Painting", "Cleaning", "Pest control", "Bathroom cleaning", "Kitchen cleaning", "Two-wheeler parcel", "Car transport"]) assert.strictEqual(st(n), "soon", n);
  const seed = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "seedCatalog.js"), "utf8");
  for (const id of ["ac-installation", "ac-uninstallation", "tv-wall-mount", "carpenter", "electrician"]) assert.ok(seed.includes(id), "catalog item " + id);
});
test("availability: rendered chips — 'Coming soon' is never a link; no unsupported claims", () => {
  const html = renderHtml();
  const soon = mk.CATEGORIES.flatMap((c) => c.services).filter((x) => x.status === "soon").length;
  assert.strictEqual((html.match(/class="pz-chip pz-chip--soon"/g) || []).length, soon);
  assert.ok(!/<a [^>]*pz-chip--soon/.test(html) && !/href="parcel\.html"/.test(html) && !/car-transport-bangalore\.html/.test(html));
  const src = read("marketplace.js");
  assert.ok(!/verified technicians|trusted professionals|same-city parcels|we'll arrange it/i.test(src));
});
test("contact: no hard-coded phone/WhatsApp number in marketplace.js; uses catalog-public.js", () => {
  const src = read("marketplace.js");
  assert.ok(!/\b9\d{9}\b|wa\.me/.test(src), "number must come from catalog-public.js");
  assert.ok(read("catalog-public.js").includes('function contactLink(text)') && read("catalog-public.js").includes("contactLink: contactLink"));
  for (const f of ["index.html", "services.html"]) {
    const h = read(f); assert.ok(h.indexOf("catalog-public.js") > -1 && h.indexOf("catalog-public.js") < h.indexOf("marketplace.js?v="), f + " loads the contact source first");
  }
});
test("xss: query text and catalog values are escaped in showQuery", async () => {
  const el = { innerHTML: "" };
  const payload = '<img src=x onerror=alert(1)>"\'';
  global.window = { PackZenCatalog: { load: () => Promise.resolve({ services: [{ name: "<b>x</b>", description: "" }], packages: [], addons: [] }), formatPrice: () => "<i>₹1</i>", contactLink: (t) => "https://wa.me/X?text=" + encodeURIComponent(t) } };
  const m = require("../../public/marketplace.js");
  m.showQuery(el, payload);
  assert.ok(!el.innerHTML.includes("<img") && el.innerHTML.includes("&lt;img"));
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(!el.innerHTML.includes("<img") && !el.innerHTML.includes("<b>x</b>") || /isn't bookable online/.test(el.innerHTML));
  delete global.window;
});
function renderHtml() { const el = { innerHTML: "", addEventListener() {}, querySelector() { return null; } }; mk.render(el); return el.innerHTML; }

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.message)); } }
  console.log(`\nui-marketplace: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
