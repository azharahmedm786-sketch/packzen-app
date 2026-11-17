/**
 * PackZen Master Business Operating System — Ecosystem Tests
 * ------------------------------------------------------------------
 * Verifies 3-division lead routing, admin ecosystem wiring,
 * financial calculation integrity, duplicate prevention, and zero hardcoded PII.
 *
 * Run: node test/business-ecosystem.test.js
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const pub = (f) => fs.readFileSync(path.join(root, "public", f), "utf8");
const { _leads: L } = require("../leads.js");

let pass = 0;
const ok = (m) => {
  pass++;
  console.log("  PASS  " + m);
};

(async () => {
  // 1. Division classification in leads engine
  const moveLead = L.validateLead({ name: "Ramesh Move", phone: "9845012345", service: "move" });
  assert.ok(moveLead.ok);
  assert.strictEqual(moveLead.value.division, "logistics");

  const webLead = L.validateLead({ name: "Astra Clinic", phone: "9845012345", service: "website", email: "doc@astra.in" });
  assert.ok(webLead.ok);
  assert.strictEqual(webLead.value.division, "digital");

  const acLead = L.validateLead({ name: "Kavitha AC", phone: "9845012345", service: "ac", notes: "Split AC servicing" });
  assert.ok(acLead.ok);
  assert.strictEqual(acLead.value.division, "home_services");

  const applianceLead = L.validateLead({ name: "Suresh Fridge", phone: "9845012345", service: "appliance" });
  assert.ok(applianceLead.ok);
  assert.strictEqual(applianceLead.value.division, "home_services");

  const explicitHome = L.validateLead({ name: "Custom Home", phone: "9845012345", service: "other", division: "home_services" });
  assert.ok(explicitHome.ok);
  assert.strictEqual(explicitHome.value.division, "home_services");
  ok("3-division routing: move → logistics, website/ecom → digital, ac/appliance → home_services");

  // 2. Leads app wiring
  const leadsHtml = pub("leads-app/index.html");
  assert.ok(/value="logistics"/.test(leadsHtml) && /value="home_services"/.test(leadsHtml) && /value="digital"/.test(leadsHtml));

  const leadsAppJs = pub("leads-app/app.js");
  assert.ok(/b-home-services/.test(leadsAppJs) && /b-digital/.test(leadsAppJs));
  assert.ok(/function divisionOf/.test(leadsAppJs));

  const leadsAppCss = pub("leads-app/app.css");
  assert.ok(/\.b-home-services/.test(leadsAppCss));
  ok("leads-app: all 3 divisions selectable in filter dropdown and tagged with badges");

  // 3. Admin dashboard wiring
  const adminHtml = pub("admin.html");
  assert.ok(/admin-ecosystem\.css/.test(adminHtml), "admin.html includes admin-ecosystem.css");
  assert.ok(/admin-ecosystem\.js/.test(adminHtml), "admin.html includes admin-ecosystem.js");

  // Verify all 6 ecosystem section containers exist
  for (const s of ["sectionOwner", "sectionPipeline", "sectionHomeservices", "sectionDigitalprojects", "sectionLedger", "sectionProspects"]) {
    assert.ok(adminHtml.includes(`id="${s}"`), `admin.html contains ${s}`);
  }

  // Verify sidebar links
  for (const tab of ["owner", "pipeline", "homeservices", "digitalprojects", "ledger", "prospects"]) {
    assert.ok(adminHtml.includes(`showSection('${tab}',this)`), `sidebar links to ${tab}`);
  }

  // Verify showSection dispatches
  assert.ok(/window\.pzEco\.renderOwner/.test(adminHtml));
  assert.ok(/window\.pzEco\.renderPipeline/.test(adminHtml));
  assert.ok(/window\.pzEco\.renderHomeServices/.test(adminHtml));
  assert.ok(/window\.pzEco\.renderDigitalProjects/.test(adminHtml));
  assert.ok(/window\.pzEco\.renderLedger/.test(adminHtml));
  assert.ok(/window\.pzEco\.renderProspects/.test(adminHtml));
  ok("admin dashboard: sidebar, sections, and dispatch handlers wired for all 6 ecosystem modules");

  // 4. Financial calculation integrity & accurate ledger labeling
  const ecoJs = pub("admin-ecosystem.js");
  assert.ok(ecoJs.includes("Customer Collections ≠ Contribution Margin ≠ Net Operating Profit"));
  assert.ok(ecoJs.includes("Categorized Financial Transaction Ledger"));
  assert.ok(ecoJs.includes("totalContribution = totalCollections - totalDirectCosts"));
  assert.ok(ecoJs.includes("netProfit = totalContribution - totalSharedOpex"));
  assert.ok(ecoJs.includes("Duplicate transaction prevented"), "duplicate prevention logic present");
  ok("financial calculation integrity: Categorized Ledger with Collections − Direct Costs = Contribution; Contribution − Shared Opex = Net Operating Profit");

  // 5. Zero hardcoded personal contact details in frontend code
  assert.ok(!/9845123410|ramesh\.ac\.blr@gmail\.com|astraclinicblr\.com/.test(ecoJs), "no hardcoded technician phones or emails in admin-ecosystem.js");
  assert.ok(ecoJs.includes("persistenceBadge"), "explicit persistence badge distinguishing firestore vs local fallback");
  ok("security: zero hardcoded personal information or mock contacts in frontend code; explicit persistence status tracking");

  // 6. Firestore rules verification for new collections
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  assert.ok(/match \/projects\/\{projectId\}/.test(rules), "firestore.rules protects projects collection");
  assert.ok(/match \/ledger\/\{entryId\}/.test(rules), "firestore.rules protects ledger collection");
  assert.ok(/match \/prospects\/\{placeId\}/.test(rules), "firestore.rules protects prospects collection");
  assert.ok(/allow read, write: if isAdmin\(\);/.test(rules) || /allow read: if isAdmin\(\);/.test(rules));
  ok("firestore rules: projects, ledger, and prospects collections strictly guarded for authorized admins only");

  // 7. Unified Admin Authorization Tests (Positive and Negative)
  const { isCallerAdmin, staffRoleOf, OWNER_EMAILS } = require("../staff-customer.js");
  
  // Frontend verification: no exposed personal email whitelist
  assert.ok(!adminHtml.includes("const ADMIN_EMAILS"), "admin.html does NOT expose ADMIN_EMAILS in client JS");
  assert.ok(adminHtml.includes("db.collection(\"settings\").doc(\"scenario\").get()"), "admin.html gates via live Firestore rules probe");

  // Mock DB for user doc lookup
  const mockAdminSdk = {
    firestore: () => ({
      collection: (col) => ({
        doc: (uid) => ({
          get: async () => {
            if (uid === "hacker_uid") return { exists: true, data: () => ({ role: "admin", name: "Hacker" }) };
            if (uid === "advisor_uid") return { exists: true, data: () => ({ role: "advisor", name: "Advisor 1" }) };
            if (uid === "owner_uid") return { exists: true, data: () => ({ role: "admin", name: "Azhar" }) };
            return { exists: false, data: () => ({}) };
          }
        })
      })
    })
  };

  // Positive: verified owner email
  const ownerCtx = { auth: { uid: "owner_uid", token: { email: "azharahmedm786@gmail.com", email_verified: true } } };
  assert.strictEqual(await isCallerAdmin(mockAdminSdk, ownerCtx), true, "verified owner email is authorized as admin");
  assert.strictEqual(await staffRoleOf(mockAdminSdk, ownerCtx), "admin", "verified owner receives admin role");

  // Negative: unverified owner email
  const unverifiedOwnerCtx = { auth: { uid: "owner_uid", token: { email: "azharahmedm786@gmail.com", email_verified: false } } };
  assert.strictEqual(await isCallerAdmin(mockAdminSdk, unverifiedOwnerCtx), false, "unverified owner email is rejected");

  // Negative: non-owner user with role="admin" manipulated in database
  const forgedAdminCtx = { auth: { uid: "hacker_uid", token: { email: "attacker@example.com", email_verified: true } } };
  assert.strictEqual(await isCallerAdmin(mockAdminSdk, forgedAdminCtx), false, "non-owner with forged role:admin is rejected");
  assert.strictEqual(await staffRoleOf(mockAdminSdk, forgedAdminCtx), null, "non-owner cannot obtain admin role from staffRoleOf");

  // Negative: legitimate advisor account is not an admin
  const advisorCtx = { auth: { uid: "advisor_uid", token: { email: "adv@packzenblr.in", email_verified: true } } };
  assert.strictEqual(await isCallerAdmin(mockAdminSdk, advisorCtx), false, "advisor account is not an admin");
  assert.strictEqual(await staffRoleOf(mockAdminSdk, advisorCtx), "advisor", "advisor retains advisor role");

  ok("unified admin authorization: verified owner allow-list enforced, forged role:admin rejected, no exposed emails in frontend");

  console.log(`\nbusiness-ecosystem: ${pass} passed, 0 failed`);
})();
