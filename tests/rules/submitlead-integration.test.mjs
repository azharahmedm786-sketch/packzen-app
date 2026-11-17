/**
 * PackZen — submitLead Cloud Function Integration Test
 * -------------------------------------------------------------------------
 * Invokes the actual `submitLead.run(data, context)` handler against the
 * local Firestore emulator under project `demo-packzen`.
 *
 * Verifies:
 * 1. Division classification (logistics, home_services, digital)
 * 2. Input validation (name, phone, email)
 * 3. Duplicate prevention (24-hour phone+service touch merge)
 * 4. Rate limiting (IP threshold exhaustion)
 * 5. Successful persistence in Firestore
 * 6. No external SMS, WhatsApp, email, or payment activity
 */
import assert from "node:assert";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../../functions/node_modules/firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "demo-packzen" });
}

const db = admin.firestore();
const leadsModule = require("../../functions/leads.js");
const submitLead = leadsModule.submitLead;

let passCount = 0;
function pass(msg) {
  passCount++;
  console.log(`  [PASS] ${msg}`);
}

// Spy on outbound network calls to verify zero SMS/WhatsApp/Email/Payment requests
let outboundRequests = [];
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;

function wrapRequest(proto, orig) {
  return function (options, cb) {
    const host = typeof options === "string" ? options : (options.host || options.hostname || "");
    // Ignore internal emulator communication (127.0.0.1, localhost)
    if (!host.includes("localhost") && !host.includes("127.0.0.1")) {
      outboundRequests.push({ proto, host });
    }
    return orig.apply(this, arguments);
  };
}

http.request = wrapRequest("http", originalHttpRequest);
https.request = wrapRequest("https", originalHttpsRequest);

async function runTests() {
  console.log("\nStarting submitLead Cloud Function Integration Test Suite...\n");

  const contextIp1 = { rawRequest: { headers: { "x-forwarded-for": "203.0.113.1" }, connection: { remoteAddress: "203.0.113.1" } } };
  const contextIp2 = { rawRequest: { headers: { "x-forwarded-for": "203.0.113.2" }, connection: { remoteAddress: "203.0.113.2" } } };

  // 1. Division Classification & Persistence: Logistics
  const res1 = await submitLead.run({
    name: "Vikram Logistics",
    phone: "9876543210",
    service: "move",
    area: "Whitefield, Bengaluru 560066",
    notes: "Need 2BHK shifting",
  }, contextIp1);
  assert.strictEqual(res1.ok, true, "Logistics lead submission must succeed");

  const snap1 = await db.collection("leads").where("phone", "==", "9876543210").get();
  assert.strictEqual(snap1.size, 1, "Exactly 1 logistics lead document persisted");
  const doc1 = snap1.docs[0].data();
  assert.strictEqual(doc1.division, "logistics", "Service 'move' classified as logistics");
  assert.strictEqual(doc1.service, "move");
  assert.strictEqual(doc1.status, "new");
  pass("1. Logistics lead division classification and persistence verified");

  // 2. Division Classification & Persistence: Home Services
  const res2 = await submitLead.run({
    name: "Sunita Home Services",
    phone: "9876543211",
    service: "ac",
    area: "Indiranagar, Bengaluru 560038",
    notes: "AC deep cleaning",
  }, contextIp1);
  assert.strictEqual(res2.ok, true, "Home services lead submission must succeed");

  const snap2 = await db.collection("leads").where("phone", "==", "9876543211").get();
  assert.strictEqual(snap2.size, 1, "Exactly 1 home services lead document persisted");
  const doc2 = snap2.docs[0].data();
  assert.strictEqual(doc2.division, "home_services", "Service 'ac' classified as home_services");
  assert.strictEqual(doc2.service, "ac");
  assert.strictEqual(doc2.status, "new");
  pass("2. Home services division classification and persistence verified");

  // 3. Division Classification & Persistence: Digital
  const res3 = await submitLead.run({
    name: "Pooja Digital",
    phone: "9876543212",
    service: "website",
    division: "digital",
    email: "pooja@business.com",
    business: "Pooja Boutiques",
    budget: "20k_50k",
    notes: "Custom e-commerce store",
  }, contextIp1);
  assert.strictEqual(res3.ok, true, "Digital lead submission must succeed");

  const snap3 = await db.collection("leads").where("phone", "==", "9876543212").get();
  assert.strictEqual(snap3.size, 1, "Exactly 1 digital lead document persisted");
  const doc3 = snap3.docs[0].data();
  assert.strictEqual(doc3.division, "digital", "Explicit digital division classified as digital");
  assert.strictEqual(doc3.email, "pooja@business.com", "Digital lead email persisted");
  assert.strictEqual(doc3.business, "Pooja Boutiques", "Digital business name persisted");
  assert.strictEqual(doc3.budget, "20k_50k", "Digital budget persisted");
  pass("3. Digital division classification and persistence verified");

  // 4. Input Validation (Short Name, Bad Phone, Bad Email)
  await assert.rejects(async () => {
    await submitLead.run({ name: "A", phone: "9876543213", service: "move" }, contextIp1);
  }, (err) => err.code === "invalid-argument", "Short name must be rejected with invalid-argument");

  await assert.rejects(async () => {
    await submitLead.run({ name: "Valid Name", phone: "12345", service: "move" }, contextIp1);
  }, (err) => err.code === "invalid-argument", "Invalid phone number must be rejected with invalid-argument");

  await assert.rejects(async () => {
    await submitLead.run({
      name: "Valid Name",
      phone: "9876543213",
      service: "website",
      division: "digital",
      email: "not-an-email",
    }, contextIp1);
  }, (err) => err.code === "invalid-argument", "Malformed digital email must be rejected with invalid-argument");
  pass("4. Input validation (name, phone, email) rejected invalid data");

  // 5. Duplicate Prevention (24-hour Phone + Service Touch Merge)
  const resDup = await submitLead.run({
    name: "Vikram Logistics",
    phone: "9876543210", // Same phone as res1
    service: "move",     // Same service
    notes: "Also need 5 large cartons added",
  }, contextIp1);
  assert.strictEqual(resDup.ok, true);

  const snapDup = await db.collection("leads").where("phone", "==", "9876543210").get();
  assert.strictEqual(snapDup.size, 1, "Duplicate submission within 24h did NOT create a second lead document");
  const docDup = snapDup.docs[0].data();
  assert.strictEqual(docDup.touches.length, 2, "Touches array merged new submission");
  assert.ok(docDup.notes.includes("Need 2BHK shifting"), "Original note preserved");
  assert.ok(docDup.notes.includes("5 large cartons added"), "Appended note preserved");
  pass("5. Duplicate prevention verified (24-hour phone+service touch merge without duplication)");

  // 6. Rate Limiting Enforcement
  let rateLimited = false;
  try {
    for (let i = 0; i < 20; i++) {
      await submitLead.run({
        name: `Burst User ${i}`,
        phone: `98765432${i < 10 ? "2" + i : "3" + (i - 10)}`,
        service: "move",
      }, contextIp2);
    }
  } catch (err) {
    if (err.code === "resource-exhausted" || (err.message && err.message.includes("Too many requests"))) {
      rateLimited = true;
    }
  }
  assert.strictEqual(rateLimited, true, "Burst requests from same IP must trigger resource-exhausted rate limit");
  pass("6. Rate limiting verified (burst requests safely blocked with resource-exhausted)");

  // 7. Honeypot Bot Trap
  const resBot = await submitLead.run({
    name: "Spam Bot",
    phone: "9876543999",
    service: "move",
    website: "http://spam-link.ru", // Honeypot field filled
  }, contextIp1);
  assert.strictEqual(resBot.ok, true, "Honeypot returns { ok: true } to fool bot");
  const snapBot = await db.collection("leads").where("phone", "==", "9876543999").get();
  assert.strictEqual(snapBot.size, 0, "Honeypot submission must NOT persist to Firestore");
  pass("7. Honeypot bot trap verified (pretends success, zero Firestore write)");

  // 8. Zero External SMS / WhatsApp / Email / Payment Activity
  assert.strictEqual(outboundRequests.length, 0, "Zero outbound external HTTP/S requests made");
  pass("8. Zero external SMS, WhatsApp, email, or payment activity confirmed");

  console.log(`\nAll ${passCount} submitLead integration tests PASSED successfully!\n`);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
