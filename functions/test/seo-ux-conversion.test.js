"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "../../public");

function read(file) {
  return fs.readFileSync(path.join(publicDir, file), "utf8");
}

test("1. 17 ft Truck rate display: Consistent vehicle card present", () => {
  const indexHtml = read("index.html");
  const chatbotJs = read("pzchatbot.js");
  const assistantKb = fs.readFileSync(path.join(__dirname, "../assistant-kb.js"), "utf8");

  // Verify vehicle card in index.html
  assert.ok(indexHtml.includes("17 ft Truck"), "17 ft Truck card must exist");
  assert.ok(chatbotJs.includes("2 BHK"), "Chatbot must quote 2 BHK");
  assert.ok(assistantKb.includes('"2bhk":'), "Assistant KB must carry 2 BHK");
});

test("2. Customer-facing contact consistency: Phone and WhatsApp used across public pages", () => {
  const indexHtml = read("index.html");
  const chatbotJs = read("pzchatbot.js");

  // Customer contact displays
  assert.ok(indexHtml.includes("9945095453"), "Index must display customer phone 9945095453");
  assert.ok(chatbotJs.includes("9945095453") || chatbotJs.includes("supportEmail"), "Chatbot config must carry contact");
});

test("3. Internal admin authorization allow-lists preserved", () => {
  const advisorHtml = read("advisor.html");
  const functionsIndex = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const staffCustomer = fs.readFileSync(path.join(__dirname, "../staff-customer.js"), "utf8");

  assert.ok(advisorHtml.includes("moveeasyblr@gmail.com"), "Advisor auth allow-list must preserve moveeasyblr@gmail.com");
  assert.ok(functionsIndex.includes("moveeasyblr@gmail.com"), "Functions index OWNER_EMAILS must preserve moveeasyblr@gmail.com");
  assert.ok(staffCustomer.includes("moveeasyblr@gmail.com"), "Staff customer OWNER_EMAILS must preserve moveeasyblr@gmail.com");
});

test("4. Logo display: Brand logo properly referenced in index and services", () => {
  const indexHtml = read("index.html");
  const servicesHtml = read("services.html");

  assert.ok(indexHtml.includes("assets/logo/packzen-logo.png"), "Index must reference packzen-logo.png");
  assert.ok(servicesHtml.includes("assets/logo/packzen-logo.png"), "Services must reference packzen-logo.png");
});

test("5. Homepage hero section: Restored hero illustration with working hero image", () => {
  const indexHtml = read("index.html");
  assert.ok(indexHtml.includes('class="hero-premium-illustration"'), "Hero illustration container must exist");
  assert.ok(indexHtml.includes('src="images/service-truck.jpg"'), "Hero truck image src must be images/service-truck.jpg");
  assert.ok(indexHtml.includes('class="hero-truck-img"'), "Hero truck image must carry hero-truck-img class");
  assert.ok(indexHtml.includes('fetchpriority="high"'), "Hero truck image must have fetchpriority high");
});

test("6. Service divisions: Clear entry cards under hero for Logistics and Digital", () => {
  const indexHtml = read("index.html");
  assert.ok(indexHtml.includes("PackZen Logistics"), "PackZen Logistics division must exist");
  assert.ok(indexHtml.includes("PackZen Digital"), "PackZen Digital division must exist");
  assert.ok(indexHtml.includes('href="/digital/"'), "Digital entry card must link to /digital/");
});

test("7. Moving quotation journey: Multi-step booking sheet wired and functional", () => {
  const indexHtml = read("index.html");
  const scriptJs = read("script.js");

  assert.ok(indexHtml.includes("openBookingSheet()"), "CTA button must wire openBookingSheet()");
  assert.ok(scriptJs.includes("openBookingSheet"), "openBookingSheet function must be defined");
  assert.ok(scriptJs.includes("calculateServerQuote") || scriptJs.includes("calculateQuote"), "Quotation calculation must be defined");
});

test("8. Trust signals and brand hygiene", () => {
  const indexHtml = read("index.html");
  assert.ok(indexHtml.includes("trust-signals-card"), "Trust signals card must exist");
  assert.ok(indexHtml.includes("From ₹2,150, all-inclusive"), "Base moving price must be displayed");
});
