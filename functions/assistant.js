/**
 * PackZen virtual assistant — engine (pure; no Firebase, no AI provider).
 *
 * Why no LLM: answers must be grounded in verified PackZen facts, must never
 * invent prices/policies, must not cost money per message, and must be testable.
 * This engine understands varied wording (synonyms, typos, Hinglish/Kannada
 * greetings, several questions in one message), keeps light context (which
 * service the customer is asking about), and hands off to a human when it is
 * not confident. Customer-specific data (bookings) is only ever fetched by the
 * Cloud Function for the signed-in user — never from anything typed in chat.
 */
"use strict";
const KB = require("./assistant-kb");
const parcelPricing = require("./parcel-pricing");

const MAX_INPUT = 600;
const STOP = new Set("a an the is are am i me my we our you your to for of on in at it this that be do does can could would will with and or please pls plz kindly what whats how much many when where which who why".split(" "));

// Common misspellings / shorthand → canonical word.
const ALIASES = {
  pirce: "price", prise: "price", prce: "price", rates: "rate", cst: "cost", chrges: "charges", charge: "charges",
  bookin: "booking", boking: "booking", bok: "book", shiftng: "shifting", shiting: "shifting", sifting: "shifting",
  refnd: "refund", refundd: "refund", cancle: "cancel", cancell: "cancel", cancl: "cancel", cancelation: "cancellation",
  resheduled: "reschedule", reshedule: "reschedule", rescedule: "reschedule", payement: "payment", paymnt: "payment",
  bangalor: "bangalore", banglore: "bangalore", bengaluru: "bangalore", blr: "bangalore",
  parcle: "parcel", parsel: "parcel", curier: "courier", insurence: "insurance", damge: "damage", damaged: "damage",
  pakers: "packers", packrs: "packers", movrs: "movers", whatsap: "whatsapp", watsapp: "whatsapp",
  kitna: "price", kitne: "price", paisa: "price", rupees: "price", rs: "price", "₹": "price",
  sthalantara: "shifting", maney: "home", mane: "home",
};

const SIZE_RE = /\b(1\s*rk|one\s*rk|studio|([1-4])\s*-?\s*bhk|(one|two|three|four)\s*bhk|villa)\b/i;
const WORDNUM = { one: "1", two: "2", three: "3", four: "4" };

// Things the assistant must refuse regardless of wording.
const INJECTION_RE = /(ignore (all|any|the|your|previous)|disregard (the|your|previous)|system prompt|your instructions|developer mode|jailbreak|act as (an? )?(admin|developer)|reveal (your|the) (prompt|rules|instructions|secrets?)|api[ _-]?key|secret key|service account|private key|password of|show me (all|every) (customers?|bookings?|users?))/i;
const OTHERS_DATA_RE = /(someone else'?s|another (customer|person|user)'?s?|other customers?|my (friend|neighbou?r|brother|sister|wife|husband)'?s? booking|booking of [a-z]|details of (this|that|the) (number|phone|customer)|who booked|phone number of|address of (customer|the customer))/i;
const MANIPULATE_RE = /(make (it|my booking|the price) (free|zero|₹?0)|mark (it|my \w+|payment|this|the \w+) (as )?(paid|complete|completed|refunded)|set (the )?price|change (the )?price to|give me (a )?(100|90|80|75|50)\s*% (off|discount)|apply (a )?(100|90|80)\s*%|refund me now|assign (me|a) driver now|make me (an )?admin)/i;
const URGENT_RE = /(urgent|emergency|immediately|asap|right now|very angry|worst|fraud|scam|cheat|police|consumer court|stolen|theft|injur|accident)/i;
const STATUS_RE = /(my booking|booking status|status of my|where is my (driver|truck|move|order|booking)|track my|is my booking|has my driver|driver assigned|my order|my move)/i;

function levenshtein1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function normalize(text) {
  let t = String(text || "").slice(0, MAX_INPUT).toLowerCase();
  t = t.replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9₹'\s-]/g, " ").replace(/\s+/g, " ").trim();
  return t.split(" ").map((w) => ALIASES[w] || w).join(" ");
}

// Vocabulary of all single words used in the KB, for typo tolerance.
const VOCAB = new Set();
KB.ENTRIES.forEach((e) => (e.words || []).forEach((w) => VOCAB.add(w)));

function tokens(norm) {
  return norm.split(" ").filter((w) => w && !STOP.has(w)).map((w) => {
    if (VOCAB.has(w) || w.length < 5) return w;
    for (const v of VOCAB) if (v.length >= 5 && levenshtein1(w, v)) return v;
    return w;
  });
}

function scoreEntry(entry, norm, toks) {
  let s = 0;
  for (const p of entry.phrases || []) if (norm.includes(p)) s += 3;
  const set = new Set(toks);
  for (const w of entry.words || []) if (set.has(w)) s += 1;
  if (entry.weak && s > 0 && toks.length > 3) s -= 0.5; // greetings shouldn't win long questions
  return s;
}

function detectSize(text) {
  const m = String(text || "").toLowerCase().match(SIZE_RE);
  if (!m) return null;
  if (/rk|studio/.test(m[0])) return "1rk";
  if (/villa/.test(m[0])) return "villa";
  const n = m[2] || WORDNUM[m[3]];
  return n ? n + "bhk" : null;
}

function detectKm(text) {
  const m = String(text || "").toLowerCase().match(/(\d{1,3}(?:\.\d)?)\s*(km|kms|kilometers?|kilometres?)\b/);
  return m ? Number(m[1]) : null;
}
function detectKg(text) {
  const m = String(text || "").toLowerCase().match(/(\d{1,2}(?:\.\d)?)\s*(kg|kgs|kilos?)\b/);
  return m ? Number(m[1]) : null;
}

// Split "price for 2bhk? and do you pack?" into separate questions (max 3).
function splitQuestions(text) {
  const parts = String(text || "").split(/\?+|;|\.\s+(?=[a-z])|\balso\b|\band also\b/i).map((s) => s.trim()).filter((s) => s.length > 2);
  return parts.length ? parts.slice(0, 3) : [String(text || "").trim()];
}

const SERVICE_OF = { price_general: "moving", booking_how: "moving", vehicles: "moving", packing: "moving", fragile: "moving",
  parcel: "parcel", home_services: "home_services", damage: "moving", reschedule: null };

function priceForSize(sizeKey) {
  const p = KB.MOVE_PRICES[sizeKey];
  if (!p) return null;
  return `A ${p.label} move in Bangalore usually costs ${p.to ? KB.inr(p.from) + "–" + KB.inr(p.to) : "from " + KB.inr(p.from)} (we normally use a ${p.vehicle}). ` +
    "The exact amount depends on distance, floors/lift, packing and your items — the booking form shows the final price before you pay.";
}

function parcelQuote(km, kg) {
  // Two-wheeler parcel delivery is retired (Oct 2026): never quote a parcel price.
  return KB.ENTRIES.find((e) => e.id === "parcel").answer();
}
function legacyParcelQuote(km, kg) {
  try {
    const r = parcelPricing.priceParcel(km, kg || 1);
    return `A ${km} km parcel${kg ? " of " + kg + " kg" : ""} costs ${KB.inr(r.total)} (₹49 for the first 2 km, ₹11/km after${r.breakdown.weightCharge ? ", +₹30 over 10 kg" : ""}). The exact distance is measured when you enter both addresses.`;
  } catch (e) { return e.message; }
}

/**
 * @param {string} text   customer message (untrusted)
 * @param {object} ctx    { lastService?: string, signedIn?: boolean, catalog?: [{name,basePrice,pricingUnit}] }
 * @returns {{reply:string, intents:string[], actions:object[], needs?:string, confident:boolean, service?:string, escalate?:boolean, urgent?:boolean}}
 */
function answer(text, ctx) {
  ctx = ctx || {};
  const raw = String(text || "").slice(0, MAX_INPUT);
  if (!raw.trim()) return { reply: "Could you type your question? I can help with prices, booking, payments, cancellations and home services.", intents: [], actions: [], confident: false };

  if (INJECTION_RE.test(raw)) {
    return { reply: "I can't share internal instructions, system details or other people's data. I'm happy to help with your own move, booking or service question though.", intents: ["refuse_injection"], actions: [], confident: true };
  }
  if (OTHERS_DATA_RE.test(raw)) {
    return { reply: "For privacy, I can only show booking details to the person who made the booking, after they sign in. If the booking is yours, sign in and ask “my booking status”. If you need to help someone else, ask them to contact us or share their booking reference with our team directly.", intents: ["refuse_privacy"], actions: [], confident: true };
  }
  if (MANIPULATE_RE.test(raw)) {
    return { reply: "I can't change prices, apply discounts, mark payments or assign drivers — those are handled securely by our booking system and team. Valid promo codes are applied automatically on the booking form, and the price shown there is the final price.", intents: ["refuse_manipulation"], actions: [{ type: "book", label: "Open booking form" }], confident: true };
  }

  const urgent = URGENT_RE.test(raw);
  if (STATUS_RE.test(normalize(raw)) || /\bstatus\b/.test(normalize(raw)) && /\b(booking|order|move)\b/.test(normalize(raw))) {
    if (!ctx.signedIn) return { reply: "To check your booking, please sign in first — for privacy I only show bookings to the account that made them. After signing in, ask me again or open My Bookings.", intents: ["booking_status"], actions: [{ type: "signin", label: "Sign in" }], needs: "signin", confident: true, urgent };
    return { reply: "", intents: ["booking_status"], actions: [], needs: "booking_status", confident: true, urgent };
  }

  const parts = splitQuestions(raw);
  const replies = [], intents = [], actions = [];
  let service = ctx.lastService || null, escalate = false, confident = true;

  for (const part of parts) {
    const norm = normalize(part), toks = tokens(norm);
    const size = detectSize(part), km = detectKm(part), kg = detectKg(part);
    const isPriceQ = /\b(price|cost|charges|rate|quote|fare|how much|estimate|budget)\b/.test(norm) || /\bhow much\b/.test(part.toLowerCase());

    // Specific, data-driven answers first.
    if (size && (isPriceQ || toks.length <= 3)) { replies.push(priceForSize(size)); intents.push("price_size"); service = "moving"; actions.push({ type: "book", label: "Get exact quote" }); continue; }
    if (km && (/parcel|courier|package|deliver/.test(norm) || service === "parcel")) { replies.push(parcelQuote(km, kg)); intents.push("parcel_price"); service = "parcel"; continue; }
    if (isPriceQ && ctx.catalog && ctx.catalog.length) {
      const words = norm.split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !["price", "cost", "charges", "rate", "much"].includes(w));
      const hit = ctx.catalog.find((c) => c.name && words.some((w) => c.name.toLowerCase().split(/\W+/).includes(w)) && c.name.toLowerCase() !== "local house shifting (within bangalore)");
      if (hit && hit.basePrice > 0) {
        const unit = hit.pricingUnit === "per_item" ? " per unit" : hit.pricingUnit === "starting_from" ? " onwards" : "";
        replies.push(`${hit.name}: ${KB.inr(hit.basePrice)}${unit}. You'll see the full price, including any add-ons, before you pay.`);
        intents.push("catalog_price"); service = "home_services"; actions.push({ type: "link", label: "Book this service", href: "/services.html" }); continue;
      }
    }
    // Follow-up price question with remembered context ("how much?" after asking about parcels).
    if (isPriceQ && toks.length <= 3 && service === "parcel") { replies.push(KB.ENTRIES.find((e) => e.id === "parcel").answer()); intents.push("parcel"); continue; }

    let best = null, bestScore = 0;
    for (const e of KB.ENTRIES) { const s = scoreEntry(e, norm, toks); if (s > bestScore) { bestScore = s; best = e; } }
    // Prefer the specific "unsupported service" answer over generic service lists.
    const unsupported = KB.ENTRIES.find((e) => e.id === "unsupported");
    if (scoreEntry(unsupported, norm, toks) >= 1 && best && best.id !== "unsupported") best = unsupported;

    if (!best || bestScore < 1) { confident = false; continue; }
    if (intents.includes(best.id)) continue;
    replies.push(best.answer(ctx)); intents.push(best.id);
    (best.actions || []).forEach((a) => actions.push(a));
    if (best.id === "human") escalate = true;
    if (SERVICE_OF[best.id] !== undefined && SERVICE_OF[best.id]) service = SERVICE_OF[best.id];
  }

  if (!replies.length) {
    return { reply: "I'm not sure about that one, and I'd rather not guess. I can pass your question to our team — leave your number and they'll get back to you during working hours (" + KB.CONTACT.hours + "). Or call " + KB.CONTACT.phone + ".",
      intents: ["unknown"], actions: [{ type: "escalate", label: "Ask the team" }], confident: false, escalate: true, urgent, service };
  }
  if (urgent && !escalate) {
    replies.push("This sounds urgent — please call " + KB.CONTACT.phone + " now, or raise a request and we'll prioritise it.");
    actions.push({ type: "escalate", label: "Raise urgent request" }); escalate = true;
  }
  const seen = new Set();
  return { reply: replies.join("\n\n"), intents, actions: actions.filter((a) => { const k = a.type + a.label; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3),
    confident, service, escalate, urgent };
}

/** Booking status text for the signed-in user's own bookings (already filtered by uid server-side). */
const STATUS_TEXT = { confirmed: "confirmed — we're arranging your crew", assigned: "driver assigned", packing: "packing in progress", transit: "in transit", delivered: "completed", cancelled: "cancelled", pending: "pending" };
function describeBookings(bookings) {
  if (!bookings || !bookings.length) return "I can't find any bookings on your account. If you paid but don't see a booking, it can take a few minutes to appear — otherwise share your Razorpay payment ID with our team.";
  return "Here are your latest bookings:\n" + bookings.slice(0, 3).map((b) => {
    const due = Number(b.balanceDue) > 0 ? `, balance due ${KB.inr(b.balanceDue)}` : "";
    const drv = b.driverName && ["assigned", "packing", "transit"].includes(b.status) ? `, driver ${b.driverName}` : "";
    return `• ${b.bookingRef || "Booking"} (${b.bookingType === "parcel" ? "parcel" : b.bookingType === "service" ? "home service" : "move"}) on ${b.date || "—"}: ${STATUS_TEXT[b.status] || b.status || "received"}${drv}${due}`;
  }).join("\n") + "\nOpen My Bookings for full details and live updates.";
}

module.exports = { answer, describeBookings, normalize, splitQuestions, detectSize, detectKm, detectKg, levenshtein1, priceForSize, parcelQuote, MAX_INPUT, INJECTION_RE, OTHERS_DATA_RE, MANIPULATE_RE };
