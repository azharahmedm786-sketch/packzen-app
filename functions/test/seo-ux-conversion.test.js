"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "../../public");

function read(file) {
  return fs.readFileSync(path.join(publicDir, file), "utf8");
}

test("1. 17 ft Truck rate standardization: ₹6,500 consistent across all customer touchpoints", () => {
  const indexHtml = read("index.html");
  const chatbotJs = read("pzchatbot.js");
  const assistantKb = fs.readFileSync(path.join(__dirname, "../assistant-kb.js"), "utf8");

  // Verify vehicle card in index.html
  assert.ok(indexHtml.includes('<div class="vc-name">17 ft Truck</div>'), "17 ft Truck card must exist");
  assert.ok(!indexHtml.includes("₹6,450"), "Legacy ₹6,450 must not exist in index.html");
  assert.ok(indexHtml.includes('<div class="vc-rate">₹6,500</div>'), "17 ft Truck must display ₹6,500");

  // Verify chatbot pricing guide
  assert.ok(chatbotJs.includes("• 2 BHK — ₹6,500 onwards"), "Chatbot must quote 2 BHK from ₹6,500");
  assert.ok(!chatbotJs.includes("₹6,450"), "Chatbot must not mention ₹6,450");

  // Verify virtual assistant KB
  assert.ok(assistantKb.includes('"2bhk":  { label: "2 BHK", from: 6500'), "Assistant KB must standardise 2 BHK from 6500");
});

test("2. Customer-facing email consistency: support@packzenblr.in used across public pages", () => {
  const indexHtml = read("index.html");
  const chatbotJs = read("pzchatbot.js");
  const billsJs = read("admin-bills.js");
  const assistantKb = fs.readFileSync(path.join(__dirname, "../assistant-kb.js"), "utf8");

  // Customer contact displays
  assert.ok(indexHtml.includes("mailto:support@packzenblr.in"), "Index footer mailto must point to support@packzenblr.in");
  assert.ok(chatbotJs.includes('supportEmail: "support@packzenblr.in"'), "Chatbot config must use support@packzenblr.in");
  assert.ok(billsJs.includes("support@packzenblr.in"), "Bills invoice header must show support@packzenblr.in");
  assert.ok(assistantKb.includes('email: "support@packzenblr.in"'), "Assistant KB must answer support@packzenblr.in");

  // Check service landing pages
  const servicePages = ["ac-service-repair-bangalore.html", "house-shifting-bangalore.html", "washing-machine-repair-bangalore.html"];
  for (const page of servicePages) {
    const html = read(page);
    assert.ok(html.includes("support@packzenblr.in"), `${page} footer must use support@packzenblr.in`);
    assert.ok(!html.includes("mailto:moveeasyblr@gmail.com"), `${page} must not have customer-facing moveeasyblr mailto`);
  }
});

test("3. Internal admin authorization allow-lists preserved", () => {
  const advisorHtml = read("advisor.html");
  const functionsIndex = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const staffCustomer = fs.readFileSync(path.join(__dirname, "../staff-customer.js"), "utf8");

  assert.ok(advisorHtml.includes("moveeasyblr@gmail.com"), "Advisor auth allow-list must preserve moveeasyblr@gmail.com");
  assert.ok(functionsIndex.includes("moveeasyblr@gmail.com"), "Functions index OWNER_EMAILS must preserve moveeasyblr@gmail.com");
  assert.ok(staffCustomer.includes("moveeasyblr@gmail.com"), "Staff customer OWNER_EMAILS must preserve moveeasyblr@gmail.com");
});

test("4. Logo accessibility: decorative img has empty alt and aria-hidden", () => {
  const indexHtml = read("index.html");
  const servicesHtml = read("services.html");

  assert.ok(
    indexHtml.includes('<img src="assets/logo/packzen-logo.png" width="36" height="36" alt="" aria-hidden="true" fetchpriority="high">'),
    "Index logo img must have alt='' and aria-hidden='true'"
  );
  assert.ok(
    servicesHtml.includes('<img src="assets/logo/packzen-logo.png" width="36" height="36" alt="" aria-hidden="true" fetchpriority="high">'),
    "Services logo img must have alt='' and aria-hidden='true'"
  );
});

test("5. Homepage hero 5-category service selector is present and functional", () => {
  const indexHtml = read("index.html");
  assert.ok(indexHtml.includes('class="hero-service-selector"'), "Hero service selector must exist");
  assert.ok(indexHtml.includes("Home / Office Moving"), "Home/Office Moving category must exist in hero");
  assert.ok(indexHtml.includes("AC Service &amp; Repair"), "AC Service & Repair category must exist in hero");
  assert.ok(indexHtml.includes("Refrigerator Repair"), "Refrigerator Repair category must exist in hero");
  assert.ok(indexHtml.includes("Washing Machine Repair"), "Washing Machine Repair category must exist in hero");
  assert.ok(indexHtml.includes("Single Item / Bike Move"), "Single Item/Bike category must exist in hero");
});

test("6. Step 1 Moving Quotation Flow: Compact WhatsApp quick lead capture present", () => {
  const indexHtml = read("index.html");
  const scriptJs = read("script.js");

  assert.ok(indexHtml.includes('id="pzWaQuickLeadCard"'), "WhatsApp quick lead card must exist in Step 1");
  assert.ok(indexHtml.includes('id="waLeadName"'), "Name input must exist");
  assert.ok(indexHtml.includes('id="waLeadPhone"'), "Phone input must exist");
  assert.ok(indexHtml.includes('id="waLeadSize"'), "Move size selector must exist");
  assert.ok(indexHtml.includes("submitWhatsAppQuickLead"), "Submit trigger must be wired");

  // Validate script logic
  assert.ok(scriptJs.includes("submitWhatsAppQuickLead"), "submitWhatsAppQuickLead function must be defined");
  assert.ok(scriptJs.includes("https://wa.me/919945095453"), "WhatsApp URL must point to 9945095453");
});

test("7. Two-step appliance booking modal present with validation and technician compatibility", () => {
  const indexHtml = read("index.html");
  const scriptJs = read("script.js");

  assert.ok(indexHtml.includes('id="applianceModal"'), "Appliance modal markup must exist");
  assert.ok(indexHtml.includes('id="appModalStep1"'), "Step 1 (Service & Slot) must exist");
  assert.ok(indexHtml.includes('id="appModalStep2"'), "Step 2 (Customer & Pay) must exist");
  assert.ok(indexHtml.includes('id="appModalSuccess"'), "Success confirmation step must exist");

  // Script methods
  assert.ok(scriptJs.includes("openApplianceModal"), "openApplianceModal must be defined");
  assert.ok(scriptJs.includes("closeApplianceModal"), "closeApplianceModal must be defined");
  assert.ok(scriptJs.includes("selectApplianceCategory"), "selectApplianceCategory must be defined");
  assert.ok(scriptJs.includes("goToApplianceStep2"), "goToApplianceStep2 must be defined");
  assert.ok(scriptJs.includes("confirmApplianceBooking"), "confirmApplianceBooking must be defined");
  assert.ok(scriptJs.includes('division: "home_services"'), "Payload must tag home_services division for technician dispatch");
});

test("8. Footer planned labels and unauthenticated DOM hygiene", () => {
  const indexHtml = read("index.html");

  // Planned labels removed
  assert.ok(!indexHtml.includes("Other Home Services <small>Planned</small>"), "Other Home Services planned chip removed");
  assert.ok(!indexHtml.includes("Digital Marketing <small>Planned</small>"), "Digital Marketing planned chip removed");
  assert.ok(!indexHtml.includes("Business Automation <small>Planned</small>"), "Business Automation planned chip removed");

  // Legacy unauthenticated driver creation form removed
  assert.ok(!indexHtml.includes('id="newDriverPassword"'), "Driver creation form removed from client DOM");
});
