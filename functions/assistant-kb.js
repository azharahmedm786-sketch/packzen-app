/**
 * PackZen virtual assistant — verified knowledge base.
 *
 * Every answer here is taken from what the live site, the pricing engine and
 * the published policies actually say (Oct 2026). Do NOT add prices, policies,
 * cover amounts or services that are not published. When something changes on
 * the site, change it here too (test/assistant.test.js checks key numbers).
 */
"use strict";

const CONTACT = { phone: "9945095453", whatsapp: "https://wa.me/919945095453", email: "moveeasyblr@gmail.com", hours: "Mon–Sun, 8:00 AM – 9:00 PM" };

// Same figures as the homepage price table / chatbot guide (engine-derived).
const MOVE_PRICES = {
  "1rk":   { label: "1 RK", from: 2150, to: 3900, vehicle: "Tata Ace" },
  "1bhk":  { label: "1 BHK", from: 4200, to: 6500, vehicle: "14 ft truck" },
  "2bhk":  { label: "2 BHK", from: 6500, to: 9500, vehicle: "17 ft truck" },
  "3bhk":  { label: "3 BHK", from: 9100, to: 13000, vehicle: "22 ft truck" },
  "4bhk":  { label: "4 BHK", from: 11000, to: null, vehicle: "22 ft truck" },
  "villa": { label: "Villa", from: 14000, to: null, vehicle: "22 ft truck" },
};

const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");

/**
 * Entries: id, phrases (strong, multi-word), words (single tokens), answer, actions.
 * Matching is done by assistant.js; answers are plain text (rendered as text, never HTML).
 */
const ENTRIES = [
  { id: "greeting", words: ["hi", "hello", "hey", "hii", "namaste", "namaskara", "vanakkam"], phrases: ["good morning", "good evening", "good afternoon"], weak: true,
    answer: () => "Hi! I'm PackZen's virtual assistant. I can help with moving prices, booking, payments, cancellations and home services in Bangalore. What do you need?" },
  { id: "thanks", words: ["thanks", "thank", "thx", "thankyou", "dhanyavaad", "shukriya"], weak: true,
    answer: () => "You're welcome! Anything else I can help with?" },

  { id: "services", phrases: ["what services", "what do you do", "services do you", "do you offer", "what all"], words: ["services", "offer"],
    answer: () => "PackZen offers, in Bangalore:\n• Home shifting (1 RK to villas) and office relocation\n• Single-item moves and bike transport\n• Packing & unpacking\n• Home services: AC service/repair/installation, washing machine & fridge repair\n• Websites for businesses through PackZen Digital\nWe no longer offer two-wheeler parcel delivery, electrician / plumber / carpenter visits, painting or TV mounting.\nWe don't offer cleaning services. Car transport and pest control are coming later — call us if you need one of those.",
    actions: [{ type: "link", label: "See all services", href: "/services.html" }] },

  { id: "price_general", phrases: ["how much", "price list", "rate card", "starting price", "minimum charge", "kitna", "estimate", "charges for"], words: ["price", "prices", "pricing", "cost", "costs", "charges", "rate", "rates", "quote", "fare", "expensive", "cheap", "budget"],
    answer: () => "Local moves in Bangalore start from " + inr(2150) + " (short Tata Ace move). Typical ranges:\n• 1 BHK " + inr(4200) + "–" + inr(6500) + "\n• 2 BHK " + inr(6500) + "–" + inr(9500) + "\n• 3 BHK " + inr(9100) + "–" + inr(13000) + "\nThe exact price depends on distance, floors and lift, packing, helpers and items. Tell me your house size, or get an exact quote in under a minute on the booking form — the price is calculated by our system, so what you see is what you pay.",
    actions: [{ type: "book", label: "Get exact quote" }] },

  { id: "price_factors", phrases: ["why is the price", "why price", "price change", "price changed", "price increase", "hidden charges", "extra charges", "floor charges"], words: ["hidden", "extra", "factors", "lift", "floors", "helpers"],
    answer: () => "Your price is calculated by our server from: distance (via Google Maps), vehicle size, floors and whether there's a lift, packing service, extra helpers and the items you add. If you change any of these, the quote updates. There are no hidden charges — the price shown before payment is the price you pay for those details." },

  { id: "booking_how", phrases: ["how to book", "how do i book", "want to book", "book a move", "book now", "make a booking", "booking process"], words: ["book", "booking", "schedule"],
    answer: () => "Booking takes about a minute:\n1. Tap “Get Moving Quote”, enter pickup and drop addresses and the date.\n2. Choose house size, vehicle and any add-ons — you'll see the exact price.\n3. Sign in and pay the advance or full amount online (or choose pay later where offered).\nYou'll get a booking reference by SMS and email straight away.",
    actions: [{ type: "book", label: "Start booking" }] },

  { id: "advance_booking", phrases: ["how early", "book in advance", "same day", "today itself", "urgent move", "tomorrow"], words: ["advance", "early", "urgent"],
    answer: () => "We recommend booking at least 1–3 days in advance to secure your preferred date. For a same-day or next-day move, call " + CONTACT.phone + " and we'll check availability — I can't confirm a slot myself." },

  { id: "offers", phrases: ["any offer", "any discount", "coupon code", "promo code", "first move", "mini move", "weekday saver", "cheaper option", "lowest price", "best price", "too expensive", "reduce price", "small move"], words: ["offer", "offers", "discount", "coupon", "cheaper", "expensive", "costly", "deal"],
    answer: () => "Current PackZen offers (one discount per booking — you automatically get the bigger one):\n• Mini move ₹1,499 — up to 5 items, within 10 km, no packing (Tata Ace + driver + helper). Applied automatically.\n• Weekday saver 3% off — move Tuesday to Thursday between the 5th and 25th. Applied automatically.\n• ₹200 off your first move — code FIRSTMOVE on bookings above ₹4,000.\nThe booking form shows your final price before you pay." },

  { id: "payment", phrases: ["payment options", "how to pay", "pay online", "pay later", "cash on", "upi"], words: ["payment", "pay", "razorpay", "upi", "card", "gpay", "phonepe", "netbanking"],
    answer: () => "Payments are taken securely through Razorpay — UPI, cards and net banking. Depending on the booking you can pay an advance or the full amount online; any balance is collected at the end of the job (online or recorded by the crew). Parcel deliveries are prepaid online only." },

  { id: "payment_failed", phrases: ["payment failed", "money deducted", "amount deducted", "paid but", "payment done but", "no confirmation", "not confirmed", "debited"], words: ["deducted", "debited"],
    answer: () => "Sorry about that. If money left your account, don't pay again. Our system automatically matches Razorpay payments to bookings (including when the page closed early), so your booking usually appears in My Bookings within a few minutes. If it isn't there after 15 minutes, share your Razorpay payment ID (starts with “pay_”) with us and we'll sort it out.",
    actions: [{ type: "escalate", label: "Get help with this payment" }] },

  { id: "cancel_refund", phrases: ["cancel my", "cancellation policy", "refund policy", "get refund", "money back", "want to cancel"], words: ["cancel", "cancellation", "refund", "refunds"],
    answer: () => "Our cancellation policy:\n• Any time before the day of your move: full refund of everything you paid online — no fees deducted.\n• On the day of the move: please call us on " + CONTACT.phone + ".\n• After packing has started: no refund.\nCancel from My Bookings or by calling us. Refunds go back to the original payment method; the bank usually credits them in 5–7 business days.",
    actions: [{ type: "link", label: "Read refund policy", href: "/legal/refund.html" }] },

  { id: "reschedule", phrases: ["change date", "change my date", "reschedule", "postpone", "prepone", "move my booking"], words: ["reschedule", "postpone", "prepone"],
    answer: () => "You can reschedule for free up to 12 hours before your slot, subject to availability — use Reschedule in My Bookings or call " + CONTACT.phone + ". Rescheduling isn't a cancellation, so no fees apply." },

  { id: "damage", phrases: ["something broke", "item broken", "damaged item", "damage claim", "is my move covered", "insurance"], words: ["damage", "damaged", "broken", "broke", "insurance", "insured", "claim", "scratch", "missing"],
    answer: () => "Damage caused during a PackZen move is covered as set out in our policies — up to ₹10,000 per booking unless you buy additional insurance. Please report it within 24 hours of delivery from My Bookings (Report damage), with photos. I can also raise a support request now so the team reviews it.",
    actions: [{ type: "escalate", label: "Report a problem" }] },

  { id: "packing", phrases: ["packing material", "do you pack", "packing service", "boxes", "bubble wrap"], words: ["packing", "pack", "boxes", "cartons", "unpacking", "wrap"],
    answer: () => "Yes. Our team brings quality packing materials — bubble wrap, cartons and protective sheets — and can pack and unpack for you. Add “Packing service” on the booking form to include it in your quote." },

  { id: "fragile", phrases: ["fragile items", "glass items", "tv safely"], words: ["fragile", "glass", "glassware", "mirror", "tv", "television", "fridge", "refrigerator", "washing"],
    answer: () => "Yes — fragile items like TVs, mirrors and glassware are packed with special protective materials, and appliances like fridges and washing machines are moved upright with care. Mention special items on the booking form so the crew is prepared." },

  { id: "area", phrases: ["service area", "which areas", "do you serve", "outside bangalore", "other city", "intercity", "outstation", "which city"], words: ["area", "areas", "location", "pincode", "intercity", "outstation", "mysore", "mysuru", "chennai", "hyderabad", "pune", "mumbai", "hosur", "tumkur"],
    answer: () => "We serve Bangalore: all 560xxx pincodes plus Hoskote, Anekal, Devanahalli, Sarjapur and Attibele.\n• Moves must start in Bangalore but can go anywhere in India.\n• Home services need a Bangalore address.\n• Parcels need pickup and drop both in Bangalore." },

  { id: "parcel", phrases: ["send a parcel", "parcel delivery", "courier"], words: ["parcel", "courier", "package", "documents", "deliver"],
    answer: () => "PackZen no longer offers two-wheeler parcel delivery. For a single item or a few boxes — a sofa, fridge, bike or cartons — book a mini move (₹1,499 for up to 5 items within 10 km) or a single-item move, and you'll see the exact price before paying.",
    actions: [{ type: "link", label: "Book a single-item move", href: "/index.html?book=move" }] },

  { id: "website", phrases: ["website design", "make a website", "build a website", "website for my", "web design", "online store", "ecommerce website", "website cost", "website price", "landing page"], words: ["website", "websites", "webpage", "webdesign", "ecommerce"],
    answer: () => "PackZen Digital (our website division) builds websites for Bangalore businesses:\n• Starter ₹7,999 — up to 5 pages, mobile-friendly, WhatsApp & call buttons, Google Maps, contact form, basic SEO\n• Business ₹14,999 — up to 10 pages, enquiry/booking form, Google Business Profile setup, SEO for 5 pages\n• Booking / Online store — from ₹29,999 with Razorpay payments and an admin panel\n• Care plan ₹999/month (optional)\nDomain & hosting at actual cost, delivery in 7–21 days. Free consultation: packzenblr.in/digital/" },

  { id: "appliance_repair", phrases: ["washing machine", "fridge repair", "refrigerator repair", "fridge service", "repair fridge", "repair my fridge", "fridge repair needed", "fridge not cooling", "fridge is not cooling", "refrigerator not cooling", "fridge not working", "fridge gas", "refrigerator gas", "washer not", "not spinning", "not draining"], words: ["washer", "fridge", "refrigerator"],
    answer: () => "Washing machine & refrigerator services in Bangalore:\n• Washing machine repair — ₹249 visit + diagnosis; the repair is quoted on site before any work\n• Washing machine installation ₹449 · uninstallation ₹299 (per machine — handy before a move)\n• Refrigerator repair — ₹249 visit + diagnosis, repair quoted on site\n• Refrigerator gas refill ₹1,999 with leak check\nBook online: packzenblr.in/services.html?category=appliance-repair" },

  { id: "painting", phrases: ["painting", "paint my", "wall paint", "house painting", "room painting", "painter", "tv mounting", "tv wall mount", "mount my tv", "mount tv"], words: ["painting", "painter", "paint", "repaint", "mounting"],
    answer: () => "PackZen no longer offers painting or TV wall mounting. We can help with house and office shifting, single-item moves, AC service and washing machine & fridge repair in Bangalore." },

  { id: "no_cleaning", phrases: ["deep cleaning", "home cleaning", "house cleaning", "kitchen cleaning", "bathroom cleaning", "sofa cleaning", "cleaning service", "move in cleaning", "move out cleaning"], words: ["cleaning", "cleaner", "cleaners", "maid", "housekeeping"],
    answer: () => "Sorry — PackZen doesn't offer cleaning services. We can help with house shifting, office moves, AC and appliance repair in Bangalore." },

  { id: "no_handyman", phrases: ["electrician", "plumber", "carpenter", "handyman", "plumbing work", "electrical work"], words: ["electrician", "electricians", "plumber", "plumbers", "plumbing", "carpenter", "carpenters", "carpentry", "handyman", "wiring"],
    answer: () => "PackZen no longer offers electrician, plumber or carpenter visits. If you're moving with us, you can add furniture dismantling & reassembly or light/fan disconnection to your move in the booking form. We still do AC service and washing machine & fridge repair." },

  { id: "home_services", phrases: ["ac service", "ac repair", "ac installation"], words: ["ac", "aircon"],
    answer: () => "We offer AC service, repair, installation and gas refill, and washing machine & fridge repair in Bangalore, with prices shown before you book.",
    actions: [{ type: "link", label: "Book a home service", href: "/services.html" }] },

  { id: "unsupported", phrases: ["car transport", "pest control"], words: ["pest", "termite"],
    answer: () => "That service isn't bookable online yet — car transport and pest control are coming later. Call " + CONTACT.phone + " and we'll tell you if we can help." },

  { id: "vehicles", phrases: ["which vehicle", "truck size", "vehicle size"], words: ["vehicle", "vehicles", "truck", "tempo", "ace", "lorry"],
    answer: () => "Vehicles: Tata Ace (1 RK / small moves), 14 ft truck (typically 1 BHK), 17 ft (2 BHK) and 22 ft (3 BHK and larger). The booking form suggests a size and upgrades it automatically if your items need more space." },

  { id: "tracking", phrases: ["track my", "where is my", "live location", "driver location"], words: ["track", "tracking", "gps", "status"],
    answer: () => "Once a driver is assigned you can follow your move in My Bookings, and you'll get SMS updates when the driver is assigned, when goods are in transit and when the job is complete.", needsAuth: "booking_status" },

  { id: "hours_contact", phrases: ["contact number", "phone number", "customer care", "working hours", "call you"], words: ["contact", "phone", "call", "email", "hours", "timing", "timings", "whatsapp"],
    answer: () => "You can reach PackZen on " + CONTACT.phone + " (call or WhatsApp) or " + CONTACT.email + ", " + CONTACT.hours + "." },

  { id: "account", phrases: ["forgot password", "reset password", "can't login", "cannot login", "login problem", "verify email", "otp not"], words: ["login", "password", "signup", "register", "otp", "account", "verification"],
    answer: () => "To sign in, use email (with OTP verification) or Google. If you forgot your password, tap “Forgot password” on the login screen and we'll email a reset link. Not receiving an OTP? Check spam, wait a minute and try again — there's a short limit on repeated requests for security." },

  { id: "privacy", phrases: ["delete my account", "my data", "privacy policy", "stop messages", "stop sending", "unsubscribe", "opt out"], words: ["privacy", "delete", "unsubscribe", "spam"],
    answer: () => "You can request account deletion from the Delete Account page, and our Privacy Policy explains how your data is used. To stop non-essential messages, tell us and we'll update your preferences.",
    actions: [{ type: "link", label: "Privacy Policy", href: "/legal/privacy.html" }] },

  { id: "otp_completion", phrases: ["completion otp", "job otp", "otp for driver"], words: [],
    answer: () => "At the end of the job, the crew asks for a completion OTP shown in your My Bookings. Only share it once you're satisfied the job is done — it confirms completion." },

  { id: "discount", phrases: ["any offer", "discount code", "promo code", "coupon"], words: ["discount", "offer", "offers", "promo", "coupon"],
    answer: () => "Current offers are shown on the homepage. Enter a promo code on the booking form — our system checks it and applies the valid discount automatically, so the final price shown is what you pay." },

  { id: "human", phrases: ["talk to human", "real person", "speak to someone", "talk to someone", "customer support", "call me back", "callback", "agent"], words: ["human", "agent", "executive", "manager", "complaint", "complain", "callback"],
    answer: () => "I'll get a person from our team to help. Leave your name and number and what it's about, and we'll call you back during working hours (" + CONTACT.hours + "). For something urgent today, call " + CONTACT.phone + ".",
    actions: [{ type: "escalate", label: "Request a callback" }] },
];

module.exports = { ENTRIES, MOVE_PRICES, CONTACT, inr };
