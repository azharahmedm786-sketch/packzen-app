/**
 * Notifications must be truthful: nothing is marked "sent" unless a provider
 * actually accepted it. Runs the real sendWhatsApp trigger handler (v1 .run()).
 *   node test/notifications-truthful.test.js
 */
"use strict";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "packzen-e7539";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const fns = require("../index.js");

function change(data) {
  const updates = [];
  return { updates, change: { after: { exists: true, data: () => data, ref: { update: async (u) => { updates.push(u); } } } } };
}
const logs = []; const origLog = console.log, origInfo = console.info;
console.log = (...a) => logs.push(a.join(" ")); console.info = (...a) => logs.push(a.join(" "));

(async () => {
  let pass = 0;
  const ok = (n) => { pass++; origLog("  PASS  " + n); };

  // 1. pending message → "skipped", never "sent", no PII in logs
  const c1 = change({ status: "pending", mobile: "9876543210", message: "Your booking PKZ-1 is confirmed" });
  await fns.sendWhatsApp.run(c1.change, { params: { docId: "wa_doc_1" } });
  assert.strictEqual(c1.updates.length, 1);
  assert.strictEqual(c1.updates[0].status, "skipped"); assert.strictEqual(c1.updates[0].skipReason, "whatsapp_not_configured");
  assert.ok(!("sentAt" in c1.updates[0]) && !JSON.stringify(c1.updates[0]).includes("dummy"));
  const all = logs.join("\n"); assert.ok(!all.includes("9876543210") && !all.includes("PKZ-1"), "no phone/message in logs");
  ok("unconfigured WhatsApp is recorded as skipped (not sent), without logging personal data");

  // 2. already-processed docs are ignored (no re-processing loops on onWrite)
  for (const st of ["skipped", "sent", "failed"]) {
    const c = change({ status: st, mobile: "9876543210", message: "x" });
    await fns.sendWhatsApp.run(c.change, { params: { docId: "wa_doc_2" } });
    assert.strictEqual(c.updates.length, 0, st);
  }
  ok("non-pending documents are not touched (no trigger recursion)");

  // 3. invalid docs still fail clearly
  const c3 = change({ status: "pending" });
  await fns.sendWhatsApp.run(c3.change, { params: { docId: "wa_doc_3" } });
  assert.strictEqual(c3.updates[0].status, "failed");
  ok("documents without mobile/message are marked failed");

  // 4. no fake-success code left anywhere in Functions
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(!/dummy:\s*true/.test(src) && !/simulate a successful send/i.test(src));
  ok("no simulated-success code remains");

  console.log = origLog; console.info = origInfo;
  origLog(`\nnotifications-truthful: ${pass} passed, 0 failed`);
  process.exit(0);
})().catch((e) => { console.log = origLog; origLog("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
