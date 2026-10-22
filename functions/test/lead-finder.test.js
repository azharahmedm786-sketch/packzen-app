/**
 * Lead Finder: Intent Radar (public RSS) + Partner Finder (official Places API).
 *   node test/lead-finder.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const F = require("../lead-finder.js");
let pass = 0; const ok = (m) => { pass++; console.log("  PASS  " + m); };
const now = Date.parse("2026-10-21T06:00:00Z");

(async () => {
  const atom = `<feed><entry><title>Need packers and movers from HSR Layout to Whitefield next week - any recommendations?</title><link href="https://www.reddit.com/r/bangalore/comments/abc/need_packers/"/><updated>2026-10-20T10:00:00+00:00</updated><content type="html">&lt;p&gt;Moving a 2BHK, budget around 8k. Who is reliable?&lt;/p&gt;</content></entry>
<entry><title>We provide best packers and movers, call us for discount!</title><link href="https://www.reddit.com/r/bangalore/comments/def/ad/"/><updated>2026-10-20T10:00:00+00:00</updated><content>promo</content></entry>
<entry><title>Hiring packers and movers helpers, salary 15k</title><link href="https://www.reddit.com/r/bangalore/comments/ghi/job/"/><updated>2026-10-20T10:00:00+00:00</updated><content>job</content></entry>
<entry><title>Best biryani in Koramangala?</title><link href="https://www.reddit.com/r/bangalore/comments/jkl/food/"/><updated>2026-10-20T10:00:00+00:00</updated><content>food</content></entry>
<entry><title>Old post: shifting help needed</title><link href="https://www.reddit.com/r/bangalore/comments/old/x/"/><updated>2026-09-01T10:00:00+00:00</updated><content>need movers?</content></entry></feed>`;
  const rss = `<rss><channel><item><title><![CDATA[AC not cooling in Indiranagar, need a good AC technician?]]></title><link>https://www.google.com/url?rct=j&amp;url=https://example.in/forum/ac-help&amp;ct=ga</link><pubDate>Mon, 20 Oct 2026 08:00:00 GMT</pubDate><description>any suggestions</description></item></channel></rss>`;
  const items = F.parseFeed(atom).concat(F.parseFeed(rss));
  assert.strictEqual(items.length, 6);
  assert.strictEqual(items[5].link, "https://example.in/forum/ac-help");
  const c = F.classifyPost(items[0]);
  assert.ok(c && c.services.includes("move") && c.area === "HSR Layout" && c.tier === "hot");
  assert.strictEqual(F.classifyPost(items[1]), null); assert.strictEqual(F.classifyPost(items[2]), null); assert.strictEqual(F.classifyPost(items[3]), null);
  assert.ok(F.classifyPost(items[5]).services.includes("ac"));
  assert.ok(/Disclosure: I run PackZen/.test(F.suggestReply(c)));
  ok("radar: parses Reddit Atom + Google Alerts RSS; keeps real requests (area, urgency → hot); drops ads, job posts, off-topic");

  const store = {};
  const db = { collection: (n) => ({ doc: (id) => ({ get: async () => ({ exists: !!(store[n] && store[n][id]), data: () => (store[n] || {})[id] }),
    set: async (d, o) => { store[n] = store[n] || {}; store[n][id] = Object.assign(o && o.merge ? (store[n][id] || {}) : {}, d); } }) }) };
  const fetchFeed = async (url) => ({ ok: true, text: async () => (/reddit/.test(url) ? atom : rss) });
  const deps = { db, fetch: fetchFeed, now: () => now, serverTimestamp: () => "TS" };
  store.settings = { leadFinder: { feeds: ["https://www.reddit.com/r/bangalore/new/.rss", "https://www.google.com/alerts/feeds/1/2"] } };
  const r1 = await F.sweepIntent(deps), r2 = await F.sweepIntent(deps);
  assert.deepStrictEqual([r1.found, r2.found], [2, 0]);
  const saved = Object.values(store.opportunities);
  assert.ok(saved.every((o) => o.status === "new" && o.reply && !("phone" in o) && !("author" in o)));
  ok("sweep: recent matching posts saved once (deduped), no personal data stored, nobody contacted");

  const calls = [];
  const fake = async (url, opt) => { calls.push([url, opt]); return { ok: true, json: async () => (/searchText/.test(url)
    ? { places: [{ id: "ChIJabcdefghijk1", displayName: { text: "Green PG" }, formattedAddress: "HSR", rating: 4.2, userRatingCount: 10 }, { id: "ChIJclosedplace1", displayName: { text: "Old PG" }, businessStatus: "CLOSED_PERMANENTLY" }] }
    : { id: "ChIJabcdefghijk1", displayName: { text: "Green PG" }, nationalPhoneNumber: "098450 12345", internationalPhoneNumber: "+91 98450 12345" }) }; };
  const pdeps = { db, fetch: fake, now: () => now, key: "K", isAdmin: async (c) => c.auth.uid === "admin" };
  const ctx = { auth: { uid: "admin" } };
  await assert.rejects(F.handleFinder({ op: "search", type: "pg", area: "HSR" }, { auth: { uid: "x" } }, pdeps), /Admins only/);
  const s = await F.handleFinder({ op: "search", type: "pg", area: "HSR Layout" }, ctx, pdeps);
  assert.ok(s.results.length === 1 && s.results[0].name === "Green PG");
  assert.ok(/PG accommodation in HSR Layout, Bangalore/.test(calls[0][1].body) && calls[0][1].headers["X-Goog-Api-Key"] === "K");
  await F.handleFinder({ op: "track", placeId: "ChIJabcdefghijk1", type: "pg", area: "HSR Layout" }, ctx, pdeps);
  const pr = store.prospects["ChIJabcdefghijk1"];
  assert.ok(pr.placeId && pr.status === "to_contact" && !("name" in pr) && !("phone" in pr) && !("address" in pr));
  const d = await F.handleFinder({ op: "details", placeId: "ChIJabcdefghijk1" }, ctx, pdeps);
  assert.strictEqual(d.intlPhone, "+91 98450 12345");
  await assert.rejects(F.handleFinder({ op: "search", type: "pg", area: "x" }, ctx, pdeps), /business type and an area/);
  ok("partner finder: admin-only; official Places API; closed businesses dropped; only place_id + our status stored (Google terms); details fetched live");

  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  assert.ok(/match \/opportunities\/\{id\} \{\s*allow create: if false;\s*allow read, update: if isAdmin\(\) \|\| isAdvisor\(\);/.test(rules) && /match \/prospects\/\{placeId\}/.test(rules));
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "public", "leads-app", "finder.js"), "utf8");
  assert.ok(/httpsCallable\("leadFinder"\)/.test(app) && /Disclosure|publicly/.test(fs.readFileSync(path.join(__dirname, "..", "..", "public", "leads-app", "index.html"), "utf8")));
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(/exports\.leadFinder/.test(idx) && /exports\.intentRadarSweep/.test(idx));
  ok("wiring: admin-only rules, Leads app tabs, callable + 2-hourly radar exported");

  console.log(`\nlead-finder: ${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL:", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); process.exit(1); });
