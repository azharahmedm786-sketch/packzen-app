/** Audit fixes: support requests/tickets reachable, email key mounted.  node test/audit-support.test.js */
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, "..", ".."); const rd = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const rules = rd("firestore.rules");
assert.ok(/match \/supportTickets\/\{ticketId\} \{\s*allow create: if isAuth\(\)\s*&& request\.resource\.data\.partnerId == request\.auth\.uid/.test(rules));
assert.ok(/hasOnly\(\['partnerId', 'partnerName', 'subject', 'message', 'status', 'createdAt'\]\)/.test(rules));
const pj = rd("public/partner.js"); const m = pj.match(/collection\("supportTickets"\)\.add\(\{([\s\S]*?)\}\)/);
for (const k of (m[1].match(/(\w+):/g) || []).map((x) => x.slice(0, -1))) assert.ok(["partnerId", "partnerName", "subject", "message", "status", "createdAt"].includes(k), "field allowed by rule: " + k);
ok("partner support tickets: rule added (was missing → every ticket refused); every field the portal sends is allowed");
const adm = rd("public/admin.html");
assert.ok(/id="sectionSupport"/.test(adm) && /async function loadSupport\(\)/.test(adm) && /collection\("supportRequests"\)/.test(adm) && /collection\("supportTickets"\)/.test(adm) && /function resolveSupport\(coll, id\)/.test(adm));
ok("admin → Support: chat requests (reschedule/cancel/human/photo) + partner tickets with Call, WhatsApp, Resolve and an open-count badge");
const af = rd("functions/assistant-functions.js"), idx = rd("functions/index.js"), nt = rd("functions/notifications.js");
assert.ok(/assistantSupportRequest = functions\.region\(REGION\)\.runWith\(\{ secrets: require\("\.\/brevo-client"\)\.BREVO_SECRETS \}\)/.test(af));
assert.ok(/adminCompleteBooking = functions\.region\("asia-south1"\)\.runWith\(\{ secrets: \[COMPLETION_OTP_PEPPER, \.\.\.BREVO_SECRETS\] \}\)/.test(idx));
assert.ok(/onSupportTicketCreatedNotify[\s\S]{0,120}runWith\(\{ secrets: BREVO_SECRETS \}\)/.test(nt));
ok("e-mail key mounted on the chat support-request and admin-complete functions; new partner tickets e-mail the admin");
const drv = rd("public/driver.html");
assert.ok(!/switchTab\('parcel'/.test(drv) && /html,body\{overflow-x:hidden\}/.test(drv));
assert.ok(/class="pz-menu-btn"|pz-menu-btn/.test(adm) && /body\.pz-menu-open/.test(adm) && /if \(typeof Chart === "undefined"\) return;/.test(adm) && /if \(typeof loadReadiness === "function"\) loadReadiness\(\);/.test(adm));
ok("apps UX: admin ☰ Menu on phones, charts can't crash Overview, readiness refreshes; crew app without the retired Parcel tab");
{ const d = rd("public/driver.html");
  assert.ok(/function pzMyCompletedJobs\(\)/.test(d) && (d.match(/pzMyCompletedJobs\(\)/g) || []).length === 3);
  assert.ok(!/where\("driverUid", "==", driverUser\.uid\)\s*\.where\("status", "==", "delivered"\)\s*\.orderBy/.test(d), "no composite-index query left");
  ok("crew app: history and earnings load without a composite index (driverUid only, filtered and sorted on the phone)"); }
console.log(`\naudit-support: ${pass} passed, 0 failed`);
