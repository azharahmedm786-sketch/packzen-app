/**
 * PackZen — Lead Finder (legal, no ads, no scraping of personal data).
 *
 * 1. Intent Radar — reads PUBLIC RSS/Atom feeds that the platforms publish for this
 *    purpose (Reddit search/subreddit RSS, Google Alerts RSS). Posts where someone is
 *    asking for movers / AC / handyman help in Bangalore become "opportunities" with a
 *    suggested public reply. We store only the post title, link, date and our tags —
 *    never phone numbers or other personal data — and nobody is contacted
 *    automatically: you reply publicly in the thread and they come to you.
 *
 * 2. Partner Finder — searches BUSINESSES (PGs, co-living, brokers, property managers,
 *    apartment complexes, offices) through Google's official Places API. Following
 *    Google Maps Platform terms, only the place_id and your own pipeline status/notes are
 *    stored; names, phones and addresses are fetched live when you open them.
 */
"use strict";
const crypto = require("crypto");

/* ---------------- Intent Radar ---------------- */
const DEFAULT_FEEDS = [
  "https://www.reddit.com/r/bangalore/search.rss?q=packers+OR+movers+OR+shifting+OR+relocating&restrict_sr=1&sort=new",
  "https://www.reddit.com/r/BangaloreRentals/new/.rss",
  "https://www.reddit.com/r/bangalore/search.rss?q=AC+service+OR+electrician+OR+plumber+OR+carpenter&restrict_sr=1&sort=new",
];
const SERVICE_RULES = [
  ["move", /\b(packers?|movers?|shifting|relocat\w*|moving (house|out|in|to)|house shift\w*|move (my|our) (stuff|things|furniture))\b/i],
  ["parcel", /\b(courier|parcel|send (a )?package|deliver (a|my) (box|bag|package))\b/i],
  ["ac", /\b(ac|a\.c\.|air ?con\w*)\b.{0,40}\b(service|repair|gas|install|technician|not cooling)\b|\b(ac technician|ac repair)\b/i],
  ["handyman", /\b(electrician|plumber|carpenter|tv (wall )?mount\w*|furniture assembl\w*)\b/i],
];
const ASKING = /\b(need|needed|looking for|recommend\w*|suggest\w*|any(one)? (know|used|tried)|reliable|good|best|help|planning|how much|cost|charges?|quote)\b|\?/i;
const PROMO = /\b(we (provide|offer)|call us|contact us|dm (me|us) for|our services|best price guaranteed|book now|whatsapp us|discount)\b/i;
const JOBS = /\b(hiring|job|vacancy|salary|resume)\b/i;
const AREAS = ["Koramangala", "HSR Layout", "Whitefield", "Marathahalli", "Bellandur", "Sarjapur", "Electronic City", "Indiranagar", "BTM", "JP Nagar", "Jayanagar", "Banashankari",
  "Hebbal", "Yelahanka", "Hennur", "KR Puram", "Rajajinagar", "Malleshwaram", "Bannerghatta", "Kengeri", "Kanakapura", "Domlur", "Ulsoor", "Frazer Town", "Brookefield",
  "Mahadevapura", "Manyata", "Kundalahalli", "Hoodi", "Varthur", "Panathur", "Kadubeesanahalli", "HAL", "Old Airport Road", "Devanahalli", "Hoskote", "Thanisandra", "RT Nagar", "Basavanagudi", "Vijayanagar"];

function decode(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
/** Minimal RSS 2.0 + Atom parser (title, link, summary, date). */
function parseFeed(xml) {
  const out = [];
  const blocks = String(xml || "").match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  for (const b of blocks) {
    const tag = (re) => { const m = b.match(re); return m ? m[1] : ""; };
    let link = tag(/<link[^>]*href="([^"]+)"/) || decode(tag(/<link>([\s\S]*?)<\/link>/));
    const g = link.match(/[?&]url=([^&]+)/); if (g && /google\./.test(link)) link = decodeURIComponent(g[1]); // Google Alerts redirect
    out.push({
      title: decode(tag(/<title[^>]*>([\s\S]*?)<\/title>/)).slice(0, 300),
      link: link.slice(0, 600),
      summary: decode(tag(/<(?:content|description|summary)[^>]*>([\s\S]*?)<\/(?:content|description|summary)>/)).slice(0, 600),
      date: decode(tag(/<(?:updated|pubDate|published)>([\s\S]*?)<\/(?:updated|pubDate|published)>/)),
    });
  }
  return out.filter((x) => x.link && x.title);
}

/** Is this post someone asking for a service we offer, in Bangalore? */
function classifyPost(p) {
  const text = p.title + " " + p.summary;
  if (PROMO.test(text) || JOBS.test(text)) return null;
  const services = SERVICE_RULES.filter(([, re]) => re.test(text)).map(([s]) => s);
  if (!services.length || !ASKING.test(text)) return null;
  const area = AREAS.find((a) => new RegExp("\\b" + a.replace(/ /g, "\\s*") + "\\b", "i").test(text)) || "";
  let score = 40;
  if (area) score += 20;
  if (/\b(next week|this week|tomorrow|this weekend|urgent|asap|by \w+day|on the \d+)\b/i.test(text)) score += 25;
  if (/\b(bangalore|bengaluru|blr)\b/i.test(text)) score += 10;
  if (/\b(1|2|3|4)\s?bhk\b/i.test(text)) score += 5;
  return { services, area, score: Math.min(100, score), tier: score >= 70 ? "hot" : "warm" };
}

const PAGE = { move: "https://packzenblr.in/", parcel: "https://packzenblr.in/parcel.html", ac: "https://packzenblr.in/ac-service-repair-bangalore.html", handyman: "https://packzenblr.in/electrician-plumber-carpenter-bangalore.html" };
function suggestReply(c) {
  const s = c.services[0];
  const tip = s === "move"
    ? "Tip from moving a lot of Bangalore homes: get a fixed written price that includes packing, loading, floors and the truck, book a weekday if you can (cheaper and easier lift slots), and check whether your society needs a lift booking or gate pass."
    : s === "parcel" ? "For same-day local delivery a two-wheeler courier is usually the cheapest for anything under ~20 kg."
    : s === "ac" ? "If it runs but doesn't cool, ask for a leak check before any gas refill — a refill without fixing the leak only lasts a few weeks."
    : "Ask for the visit charge and the work price before anything starts, so there are no surprises.";
  return `${tip}${c.area ? " " : ""}\n\nDisclosure: I run PackZen, a Bangalore service — if it helps, you can see fixed prices online here: ${PAGE[s] || PAGE.move} (no obligation).`;
}
const idFor = (link) => crypto.createHash("sha1").update(link).digest("hex").slice(0, 24);

/** deps: { db, fetch, now, serverTimestamp, feeds? } */
async function sweepIntent(deps) {
  const cfg = await deps.db.collection("settings").doc("leadFinder").get();
  const feeds = (cfg.exists && Array.isArray(cfg.data().feeds) && cfg.data().feeds.length ? cfg.data().feeds : DEFAULT_FEEDS).slice(0, 15);
  let found = 0, errors = 0;
  for (const url of feeds) {
    let xml = "";
    try {
      const r = await deps.fetch(url, { headers: { "User-Agent": "PackZenLeadFinder/1.0 (+https://packzenblr.in; RSS reader)" } });
      if (!r.ok) { errors++; continue; }
      xml = await r.text();
    } catch (e) { errors++; continue; }
    for (const p of parseFeed(xml).slice(0, 40)) {
      const posted = Date.parse(p.date) || deps.now();
      if (deps.now() - posted > 10 * 86400e3) continue;             // only recent posts
      const c = classifyPost(p); if (!c) continue;
      const ref = deps.db.collection("opportunities").doc(idFor(p.link));
      const ex = await ref.get(); if (ex.exists) continue;
      await ref.set({ title: p.title, link: p.link, excerpt: p.summary.slice(0, 280), source: new URL(p.link).hostname.replace(/^www\./, ""),
        postedAtMs: posted, services: c.services, area: c.area, score: c.score, tier: c.tier, reply: suggestReply(c),
        status: "new", createdAt: deps.serverTimestamp(), createdAtMs: deps.now() });
      found++;
    }
  }
  return { found, errors, feeds: feeds.length };
}

/* ---------------- Partner Finder (Google Places API, official) ---------------- */
const PARTNER_TYPES = {
  pg: "PG accommodation", coliving: "co-living space", broker: "real estate agent rental", property_manager: "property management company",
  apartments: "apartment complex", builder: "real estate developer", office: "coworking space", furniture: "furniture store",
};
class FinderError extends Error { constructor(code, msg) { super(msg); this.code = code; this.publicMessage = msg; } }

async function placesSearch(deps, data) {
  const type = PARTNER_TYPES[data && data.type] ? data.type : null;
  const area = String((data && data.area) || "").replace(/[^\w\s-]/g, "").trim().slice(0, 60);
  if (!type || area.length < 3) throw new FinderError("invalid-argument", "Choose a business type and an area.");
  if (!deps.key) throw new FinderError("failed-precondition", "Places API key not configured.");
  const r = await deps.fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": deps.key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus" },
    body: JSON.stringify({ textQuery: `${PARTNER_TYPES[type]} in ${area}, Bangalore`, maxResultCount: 20, regionCode: "IN", languageCode: "en" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new FinderError("unavailable", (j.error && j.error.message) || "Places search failed.");
  const tracked = new Set();
  for (const p of j.places || []) { const d = await deps.db.collection("prospects").doc(p.id).get(); if (d.exists) tracked.add(p.id); }
  return { results: (j.places || []).filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY").map((p) => ({
    placeId: p.id, name: (p.displayName || {}).text || "", address: p.formattedAddress || "", rating: p.rating || null, reviews: p.userRatingCount || 0, tracked: tracked.has(p.id) })) };
}
async function placeDetails(deps, placeId) {
  if (typeof placeId !== "string" || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new FinderError("invalid-argument", "Invalid place.");
  const r = await deps.fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId), {
    headers: { "X-Goog-Api-Key": deps.key, "X-Goog-FieldMask": "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new FinderError("unavailable", (j.error && j.error.message) || "Details lookup failed.");
  return { placeId, name: (j.displayName || {}).text || "", address: j.formattedAddress || "", phone: j.nationalPhoneNumber || "", intlPhone: j.internationalPhoneNumber || "",
    website: j.websiteUri || "", maps: j.googleMapsUri || "", rating: j.rating || null, reviews: j.userRatingCount || 0 };
}

/** One admin-only callable for the Leads app. ops: search | details | track | sweep */
async function handleFinder(data, context, deps) {
  if (!context || !context.auth) throw new FinderError("unauthenticated", "Please sign in.");
  if (!(await deps.isAdmin(context))) throw new FinderError("permission-denied", "Admins only.");
  const op = data && data.op;
  if (op === "search") return placesSearch(deps, data);
  if (op === "details") return placeDetails(deps, data.placeId);
  if (op === "track") {
    const type = PARTNER_TYPES[data.type] ? data.type : "other";
    if (typeof data.placeId !== "string" || !/^[A-Za-z0-9_-]{10,300}$/.test(data.placeId)) throw new FinderError("invalid-argument", "Invalid place.");
    // Only the place_id and OUR pipeline data are stored (Google Maps Platform terms).
    await deps.db.collection("prospects").doc(data.placeId).set({ placeId: data.placeId, type, area: String(data.area || "").slice(0, 60), status: "to_contact",
      notes: "", createdAtMs: deps.now(), updatedAtMs: deps.now() }, { merge: true });
    return { ok: true };
  }
  if (op === "sweep") return sweepIntent(deps);
  throw new FinderError("invalid-argument", "Unknown action.");
}

module.exports = { parseFeed, classifyPost, suggestReply, sweepIntent, placesSearch, placeDetails, handleFinder, FinderError, DEFAULT_FEEDS, PARTNER_TYPES, idFor };
