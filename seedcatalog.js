#!/usr/bin/env node
/**
 * PackZen — Service Catalog Seeder
 * ---------------------------------------------------------------
 * Populates: serviceCategories, services, packages, addons
 *
 * IDEMPOTENT: every document has a fixed ID and is written with
 *   .set(data, { merge: true })
 * so re-running updates prices/fields in place and never creates
 * duplicates. Fields you add by hand in the admin panel that are NOT
 * listed here are left untouched.
 *
 * !! Re-running resets the fields listed below (including basePrice and
 * !! isActive) back to the values in this file. Edit prices HERE if you
 * !! want the script to be your source of truth, or stop re-running it
 * !! once you manage prices from the admin panel.
 *
 * USAGE
 *   1. cd functions && npm install            (installs firebase-admin)
 *   2. Download a service-account key: Firebase Console → Project settings
 *      → Service accounts → Generate new private key  (keep it OUT of git)
 *   3. Windows PowerShell:
 *        $env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\packzen-admin.json"
 *        node tools/seedCatalog.js
 *      macOS / Linux:
 *        GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node tools/seedCatalog.js
 *
 *   Preview without writing anything:   node tools/seedCatalog.js --dry-run
 */

"use strict";

const path = require("path");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "packzen-e7539";
const DRY_RUN = process.argv.includes("--dry-run");

/* ================================================================
   SEED DATA
   Common fields on every service / package / add-on:
     name, categoryId, basePrice, pricingUnit, isActive, displayOrder
   ================================================================ */

// ── Categories ──────────────────────────────────────────────────
const categories = [
  { id: "moving",      name: "Moving Services",   icon: "🚚", displayOrder: 1, description: "Home, office and intercity relocation" },
  { id: "packing",     name: "Packing Services",  icon: "📦", displayOrder: 2, description: "Packing and unpacking with quality material tiers" },
  { id: "ac-services", name: "AC Services",       icon: "❄️", displayOrder: 3, description: "AC installation, uninstallation and repair" },
  { id: "appliances",  name: "Appliance Services",icon: "📺", displayOrder: 4, description: "TV mounting and appliance handling" },
  { id: "handyman",    name: "Handyman Services", icon: "🛠️", displayOrder: 5, description: "Carpenter and electrician work" },
].map((c) => ({ ...c, isActive: true }));

// ── Services ────────────────────────────────────────────────────
// pricingUnit: "fixed" | "starting_from" | "per_item" | "per_carton" | "quote"
// 1999 = minimumFare in pricing-engine-v2.js. 0 + "quote" = priced per enquiry.
const services = [
  { id: "local-house-shifting",  categoryId: "moving", name: "Local House Shifting (within Bangalore)", basePrice: 1999, pricingUnit: "starting_from", displayOrder: 1, description: "Door-to-door household shifting within the city" },
  { id: "intercity-relocation",  categoryId: "moving", name: "Intercity Relocation",                    basePrice: 0,    pricingUnit: "quote",         displayOrder: 2, description: "Long-distance household moves — quoted per route" },
  { id: "office-relocation",     categoryId: "moving", name: "Office Relocation",                       basePrice: 0,    pricingUnit: "quote",         displayOrder: 3, description: "Commercial and office shifting — quoted per inventory" },
].map((s) => ({ ...s, isActive: true }));

// ── Packages ────────────────────────────────────────────────────
// Moving packages by home size.
// !! PLACEHOLDER PRICES — review before going live. They are starting
// !! points only and are NOT yet connected to pricing-engine-v2.js.
const movingPackages = [
  { id: "moving-1rk",  homeSize: "1 RK / Studio", name: "1 RK / Studio Move", basePrice: 2999,  displayOrder: 1, includes: ["Tata Ace / mini truck", "1 helper", "Loading & unloading"] },
  { id: "moving-1bhk", homeSize: "1 BHK",         name: "1 BHK Move",         basePrice: 4999,  displayOrder: 2, includes: ["14 ft truck", "2 helpers", "Loading & unloading"] },
  { id: "moving-2bhk", homeSize: "2 BHK",         name: "2 BHK Move",         basePrice: 7999,  displayOrder: 3, includes: ["17 ft truck", "3 helpers", "Loading & unloading"] },
  { id: "moving-3bhk", homeSize: "3 BHK",         name: "3 BHK Move",         basePrice: 11999, displayOrder: 4, includes: ["17 ft truck", "4 helpers", "Loading & unloading"] },
  { id: "moving-4bhk", homeSize: "4 BHK / Villa", name: "4 BHK / Villa Move", basePrice: 16999, displayOrder: 5, includes: ["22 ft truck", "5 helpers", "Loading & unloading"] },
].map((p) => ({
  ...p,
  categoryId: "moving",
  pricingUnit: "starting_from",
  description: `Complete ${p.homeSize} household shifting package`,
  isActive: true,
}));

// Packing tiers — per-carton rates. Basic / Premium Bubble / Wooden Crating
// match packagingTiers in pricing-engine-v2.js (20 / 35 / 60).
// !! "Standard" (28) is a PLACEHOLDER — the engine has no Standard tier yet.
const packingPackages = [
  { id: "packing-basic",    name: "Basic Packing",           basePrice: 20, displayOrder: 1, description: "Standard corrugated cartons and tape", includes: ["Corrugated cartons", "Tape & labelling"] },
  { id: "packing-standard", name: "Standard Packing",        basePrice: 28, displayOrder: 2, description: "Cartons plus furniture wrapping and fragile care", includes: ["Corrugated cartons", "Furniture wrapping", "Fragile labelling"] },
  { id: "packing-premium",  name: "Premium Bubble Packing",  basePrice: 35, displayOrder: 3, description: "3-layer bubble wrap and film for fragile items", includes: ["3-layer bubble wrap", "Stretch film", "Fragile-safe cartons"] },
  { id: "packing-crating",  name: "Wooden Crating",          basePrice: 60, displayOrder: 4, description: "Wooden crating and waterproofing for high-value items", includes: ["Wooden crate", "Waterproofing", "Corner protection"] },
].map((p) => ({ ...p, categoryId: "packing", pricingUnit: "per_carton", isActive: true }));

const packages = [...movingPackages, ...packingPackages];

// ── Add-ons ─────────────────────────────────────────────────────
// Prices match specializedServices in pricing-engine-v2.js.
const addons = [
  { id: "ac-installation",   categoryId: "ac-services", name: "AC Installation",    basePrice: 1400, pricingUnit: "per_item", displayOrder: 1, description: "Per AC unit" },
  { id: "ac-uninstallation", categoryId: "ac-services", name: "AC Uninstallation",  basePrice: 800,  pricingUnit: "per_item", displayOrder: 2, description: "Per AC unit" },
  { id: "tv-wall-mount",     categoryId: "appliances",  name: "TV Wall Mount",      basePrice: 350,  pricingUnit: "per_item", displayOrder: 3, description: "Wall-mount install / removal per TV" },
  { id: "carpenter",         categoryId: "handyman",    name: "Carpenter Work",     basePrice: 500,  pricingUnit: "fixed",    displayOrder: 4, description: "Dismantling and reassembly of furniture" },
  { id: "electrician",       categoryId: "handyman",    name: "Electrician Work",   basePrice: 450,  pricingUnit: "fixed",    displayOrder: 5, description: "Fans, lights and fittings" },
].map((a) => ({ ...a, isActive: true }));

/* ================================================================
   WRITE LOGIC
   ================================================================ */

const COLLECTIONS = [
  { name: "serviceCategories", docs: categories },
  { name: "services",          docs: services },
  { name: "packages",          docs: packages },
  { name: "addons",            docs: addons },
];

// Light sanity checks so a typo can't seed a broken catalog.
function validate() {
  const categoryIds = new Set(categories.map((c) => c.id));
  const problems = [];
  for (const { name, docs } of COLLECTIONS) {
    const seen = new Set();
    for (const d of docs) {
      if (!d.id) problems.push(`${name}: document without id`);
      if (seen.has(d.id)) problems.push(`${name}: duplicate id "${d.id}"`);
      seen.add(d.id);
      if (!d.name) problems.push(`${name}/${d.id}: missing name`);
      if (typeof d.isActive !== "boolean") problems.push(`${name}/${d.id}: isActive must be boolean`);
      if (typeof d.displayOrder !== "number") problems.push(`${name}/${d.id}: displayOrder must be a number`);
      if (name !== "serviceCategories") {
        if (typeof d.basePrice !== "number") problems.push(`${name}/${d.id}: basePrice must be a number`);
        if (!categoryIds.has(d.categoryId)) problems.push(`${name}/${d.id}: unknown categoryId "${d.categoryId}"`);
      }
    }
  }
  return problems;
}

async function main() {
  const problems = validate();
  if (problems.length) {
    console.error("Seed data problems:\n - " + problems.join("\n - "));
    process.exit(1);
  }

  const total = COLLECTIONS.reduce((n, c) => n + c.docs.length, 0);

  if (DRY_RUN) {
    console.log(`DRY RUN — nothing written. Project: ${PROJECT_ID}`);
    for (const { name, docs } of COLLECTIONS) {
      console.log(`  ${name}: ${docs.length} docs → ${docs.map((d) => d.id).join(", ")}`);
    }
    console.log(`Total: ${total} documents.`);
    return;
  }

  // Resolve firebase-admin from /functions (where it is already a dependency).
  let admin;
  try {
    const resolved = require.resolve("firebase-admin", {
      paths: [path.join(__dirname, "..", "functions"), __dirname, process.cwd()],
    });
    admin = require(resolved);
  } catch (e) {
    console.error("firebase-admin not found. Run:  cd functions && npm install");
    process.exit(1);
  }

  admin.initializeApp({
    projectId: PROJECT_ID,
    credential: admin.credential.applicationDefault(),
  });
  const db = admin.firestore();
  const serverTs = admin.firestore.FieldValue.serverTimestamp();

  console.log(`Seeding project "${PROJECT_ID}" (${total} documents)…`);

  // Firestore batches hold up to 500 writes; we are far below, but chunk anyway.
  const writes = [];
  for (const { name, docs } of COLLECTIONS) {
    for (const { id, ...fields } of docs) {
      writes.push({ ref: db.collection(name).doc(id), data: { ...fields, updatedAt: serverTs } });
    }
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
    await batch.commit();
  }

  for (const { name, docs } of COLLECTIONS) console.log(`  ✔ ${name}: ${docs.length}`);
  console.log("Done. Safe to re-run — existing documents are updated, never duplicated.");
}

main().catch((err) => {
  console.error("Seed failed:", err.message || err);
  process.exit(1);
});
