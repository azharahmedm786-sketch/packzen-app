/**
 * PackZen Assistant — Hindi & Kannada without any paid AI.
 *
 * 1. understand(): maps Hindi (Devanagari + Hinglish) and Kannada words to the
 *    English keywords the grounded engine already understands, and converts
 *    Devanagari/Kannada digits, so "2BHK शिफ्ट कितना?" or "ಪಾರ್ಸೆಲ್ 12 ಕಿಮೀ ಎಷ್ಟು"
 *    hit the same verified answers.
 * 2. localize(): rewrites the engine's answer in Hindi or Kannada from fixed,
 *    reviewed templates. Numbers, prices and contact details come from the same
 *    KB values as the English answers, so nothing can drift. Topics without a
 *    translation fall back to the English text with a one-line note.
 */
"use strict";
const KB = require("./assistant-kb");
const { inr, CONTACT, MOVE_PRICES } = KB;

function detectLang(text) {
  const t = String(text || "");
  if (/[\u0C80-\u0CFF]/.test(t)) return "kn";
  if (/[\u0900-\u097F]/.test(t)) return "hi";
  if (/\b(kitna|kitne|kya|hai|nahi|chahiye|kab|kaise|mujhe|aap|bhai|paisa|ghar|saman|samaan|karna|karwana|batao|bataiye)\b/i.test(t)) return "hi";
  if (/\b(eshtu|yaavaga|beku|illa|namaskara|maney|mane|hogbeku|swalpa|heli|maadi)\b/i.test(t)) return "kn";
  return "en";
}

// [regex, english keywords] — appended to the text, never replacing it
const LEXICON = [
  // prices / questions
  [/कितना|कितने|कितनी|दाम|कीमत|रेट|चार्ज|खर्चा|kitna|kitne|kitni|kharcha|daam|keemat/i, " how much price "],
  [/ಎಷ್ಟು|ಬೆಲೆ|ದರ|ಚಾರ್ಜ್|ಖರ್ಚು|eshtu|bele|dara/i, " how much price "],
  // moving
  [/शिफ्ट|शिफ्टिंग|सामान|घर बदल|shift|saman|samaan|ghar badal/i, " moving shift "],
  [/ಶಿಫ್ಟ್|ಸ್ಥಳಾಂತರ|ಮನೆ ಬದಲ|ಸಾಮಾನು|mane shift/i, " moving shift "],
  [/ऑफिस|दफ्तर|ಆಫೀಸ್|ಕಚೇರಿ/i, " office relocation "],
  // booking
  [/बुक|बुकिंग|book karna|booking kaise|ಬುಕ್|ಬುಕಿಂಗ್/i, " book booking "],
  [/कैसे बुक|बुक कैसे|ಹೇಗೆ ಬುಕ್|ಬುಕ್ ಮಾಡುವುದು ಹೇಗೆ/i, " how to book "],
  [/मेरी बुकिंग|बुकिंग स्टेटस|ಬುಕಿಂಗ್ ಸ್ಥಿತಿ|ನನ್ನ ಬುಕಿಂಗ್|meri booking|booking status/i, " my booking status "],
  // cancel / refund / reschedule
  [/रद्द|कैंसल|cancel karna|ರದ್ದು|ಕ್ಯಾನ್ಸಲ್/i, " cancel "],
  [/रिफंड|पैसे वापस|paise wapas|ಹಣ ವಾಪಸ್|ರೀಫಂಡ್|ಮರುಪಾವತಿ/i, " refund "],
  [/तारीख बदल|डेट बदल|date badal|ದಿನಾಂಕ ಬದಲ|ಮುಂದೂಡ/i, " reschedule "],
  // payment
  [/पेमेंट|भुगतान|payment|ಪಾವತಿ|ಪೇಮೆಂಟ್/i, " payment pay "],
  [/पैसे कट|पैसा कट|paisa kat|paise kat|ಹಣ ಕಡಿತ|ಹಣ ಕಟ್/i, " money deducted "],
  // parcel
  [/पार्सल|कूरियर|parcel|courier|ಪಾರ್ಸೆಲ್|ಕೊರಿಯರ್/i, " parcel courier "],
  [/किलोमीटर|किमी|ಕಿಲೋಮೀಟರ್|ಕಿ\.?ಮೀ|ಕಿಮೀ/i, " km "],
  [/किलो|ಕೆ\.?ಜಿ|ಕಿಲೋ/i, " kg "],
  // home services
  [/एसी|ए\.सी|ಎಸಿ|ಏಸಿ/i, " ac service "],
  [/सफाई|क्लीनिंग|safai|ಸ್ವಚ್ಛ|ಕ್ಲೀನಿಂಗ್/i, " deep cleaning "],
  [/बिजली|इलेक्ट्रीशियन|bijli|ಎಲೆಕ್ಟ್ರಿಷಿಯನ್|ವಿದ್ಯುತ್/i, " electrician "],
  [/प्लंबर|नल|ಪ್ಲಂಬರ್|ನಲ್ಲಿ/i, " plumber "],
  [/बढ़ई|कारपेंटर|ಬಡಗಿ|ಕಾರ್ಪೆಂಟರ್/i, " carpenter "],
  [/टीवी|ಟಿವಿ/i, " tv mounting "],
  // other topics
  [/सेवाएं|सर्विस|क्या करते|ಸೇವೆಗಳು|ಸರ್ವಿಸ್|ಏನು ಮಾಡುತ್ತೀರಿ/i, " what services "],
  [/इलाका|एरिया|कहां|पिनकोड|ಪ್ರದೇಶ|ಏರಿಯಾ|ಎಲ್ಲಿ|ಪಿನ್‌?ಕೋಡ್/i, " service area "],
  [/नंबर|संपर्क|फोन|कॉल|ಸಂಪರ್ಕ|ಫೋನ್|ನಂಬರ್|ಕರೆ/i, " contact phone "],
  [/वापस कॉल|कॉल बैक|call back|callback|ವಾಪಸ್ ಕರೆ|ಕಾಲ್ ಬ್ಯಾಕ್/i, " call me back "],
  [/नुकसान|टूट|डैमेज|ಹಾನಿ|ಮುರಿ|ಡ್ಯಾಮೇಜ್/i, " damage "],
  [/ट्रैक|कहाँ है|ಟ್ರ್ಯಾಕ್|ಎಲ್ಲಿದೆ/i, " track "],
  [/धन्यवाद|शुक्रिया|ಧನ್ಯವಾದ/i, " thanks "],
  [/नमस्ते|नमस्कार|ನಮಸ್ಕಾರ|ಹಲೋ/i, " hello "],
];
const DIGITS = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
  "೦": "0", "೧": "1", "೨": "2", "೩": "3", "೪": "4", "೫": "5", "೬": "6", "೭": "7", "೮": "8", "೯": "9" };

function understand(text) {
  let t = String(text || "").replace(/[०-९೦-೯]/g, (d) => DIGITS[d] || d);
  t = t.replace(/(\d+(?:\.\d+)?)\s*(किलोमीटर|किमी|ಕಿಲೋಮೀಟರ್|ಕಿ\.?ಮೀ|ಕಿಮೀ)/gi, "$1 km").replace(/(\d+(?:\.\d+)?)\s*(किलो|ಕೆ\.?ಜಿ|ಕಿಲೋ)/gi, "$1 kg");
  t = t.replace(/(\d)\s*(बीएचके|ಬಿಎಚ್‌?ಕೆ)/gi, "$1 bhk").replace(/(\d)\s*(आरके|ಆರ್‌?ಕೆ)/gi, "$1 rk");
  let extra = "";
  for (const [re, kw] of LEXICON) if (re.test(t)) extra += kw;
  // keep one question together: the engine splits on "?" and would answer the keywords separately
  return extra ? (t.replace(/[?？।]+/g, " ") + " " + extra).replace(/\s+/g, " ").trim() : t;
}

const parcelPricing = require("./parcel-pricing");
function parcelLine(lang, km, kg) {
  let r; try { r = parcelPricing.priceParcel(km, kg || 1); } catch (e) { return null; }
  const w = r.breakdown.weightCharge ? (lang === "hi" ? ", 10 किलो से ज़्यादा पर +₹30" : ", 10 ಕೆಜಿ ಮೀರಿದರೆ +₹30") : "";
  return lang === "hi"
    ? `${km} किमी${kg ? " और " + kg + " किलो" : ""} के पार्सल का दाम ${inr(r.total)} है (पहले 2 किमी ₹49, फिर ₹11 प्रति किमी${w})। दोनों पते डालने पर सटीक दूरी नापी जाती है।`
    : `${km} ಕಿಮೀ${kg ? " ಮತ್ತು " + kg + " ಕೆಜಿ" : ""} ಪಾರ್ಸೆಲ್ ದರ ${inr(r.total)} (ಮೊದಲ 2 ಕಿಮೀ ₹49, ನಂತರ ಪ್ರತಿ ಕಿಮೀ ₹11${w}). ಎರಡೂ ವಿಳಾಸ ಹಾಕಿದಾಗ ನಿಖರ ದೂರ ಅಳೆಯಲಾಗುತ್ತದೆ.`;
}
const range = (p) => p.to ? inr(p.from) + "–" + inr(p.to) : inr(p.from) + "+";
const sizeOf = (k) => MOVE_PRICES[k];

/* reviewed templates: { intent: { hi: fn, kn: fn } } */
const T = {
  greeting: { hi: () => "नमस्ते! मैं PackZen का वर्चुअल असिस्टेंट हूँ। मैं बेंगलुरु में शिफ्टिंग के दाम, बुकिंग, पेमेंट, कैंसलेशन, पार्सल और होम सर्विस में मदद कर सकता हूँ। बताइए, क्या चाहिए?",
              kn: () => "ನಮಸ್ಕಾರ! ನಾನು PackZen ನ ವರ್ಚುವಲ್ ಸಹಾಯಕ. ಬೆಂಗಳೂರಿನಲ್ಲಿ ಮನೆ ಶಿಫ್ಟಿಂಗ್ ದರ, ಬುಕಿಂಗ್, ಪಾವತಿ, ರದ್ದತಿ, ಪಾರ್ಸೆಲ್ ಮತ್ತು ಹೋಮ್ ಸರ್ವಿಸ್‌ಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ಏನು ಬೇಕು?" },
  thanks: { hi: () => "आपका स्वागत है! और कुछ मदद चाहिए?", kn: () => "ಸ್ವಾಗತ! ಇನ್ನೇನಾದರೂ ಸಹಾಯ ಬೇಕೇ?" },
  services: { hi: () => "बेंगलुरु में PackZen की सेवाएं:\n• घर शिफ्टिंग (1 RK से विला तक) और ऑफिस शिफ्टिंग\n• सिंगल आइटम और बाइक ट्रांसपोर्ट\n• पैकिंग और अनपैकिंग\n• टू-व्हीलर पार्सल डिलीवरी (20 किलो तक)\n• होम सर्विस: AC सर्विस/रिपेयर/इंस्टॉलेशन, डीप क्लीनिंग, इलेक्ट्रीशियन, कारपेंटर, प्लंबर और TV माउंटिंग",
              kn: () => "ಬೆಂಗಳೂರಿನಲ್ಲಿ PackZen ಸೇವೆಗಳು:\n• ಮನೆ ಶಿಫ್ಟಿಂಗ್ (1 RK ಇಂದ ವಿಲ್ಲಾ ವರೆಗೆ) ಮತ್ತು ಆಫೀಸ್ ಶಿಫ್ಟಿಂಗ್\n• ಒಂದೇ ವಸ್ತು ಮತ್ತು ಬೈಕ್ ಸಾಗಣೆ\n• ಪ್ಯಾಕಿಂಗ್ ಮತ್ತು ಅನ್‌ಪ್ಯಾಕಿಂಗ್\n• ಟೂ-ವೀಲರ್ ಪಾರ್ಸೆಲ್ ಡೆಲಿವರಿ (20 ಕೆಜಿ ವರೆಗೆ)\n• ಹೋಮ್ ಸರ್ವಿಸ್: AC ಸರ್ವಿಸ್/ರಿಪೇರಿ/ಇನ್‌ಸ್ಟಾಲೇಶನ್, ಡೀಪ್ ಕ್ಲೀನಿಂಗ್, ಎಲೆಕ್ಟ್ರಿಷಿಯನ್, ಕಾರ್ಪೆಂಟರ್, ಪ್ಲಂಬರ್ ಮತ್ತು TV ಮೌಂಟಿಂಗ್" },
  price_general: {
    hi: () => `बेंगलुरु में लोकल शिफ्टिंग ${inr(MOVE_PRICES["1rk"].from)} से शुरू। आम तौर पर:\n• 1 BHK ${range(sizeOf("1bhk"))}\n• 2 BHK ${range(sizeOf("2bhk"))}\n• 3 BHK ${range(sizeOf("3bhk"))}\nसही दाम दूरी, मंज़िल और लिफ्ट, पैकिंग और सामान पर निर्भर है। बुकिंग फॉर्म पर एक मिनट में सटीक दाम मिल जाएगा — जो दिखेगा वही देना होगा।`,
    kn: () => `ಬೆಂಗಳೂರಿನಲ್ಲಿ ಲೋಕಲ್ ಶಿಫ್ಟಿಂಗ್ ${inr(MOVE_PRICES["1rk"].from)} ಇಂದ ಆರಂಭ. ಸಾಮಾನ್ಯವಾಗಿ:\n• 1 BHK ${range(sizeOf("1bhk"))}\n• 2 BHK ${range(sizeOf("2bhk"))}\n• 3 BHK ${range(sizeOf("3bhk"))}\nನಿಖರ ದರ ದೂರ, ಮಹಡಿ ಮತ್ತು ಲಿಫ್ಟ್, ಪ್ಯಾಕಿಂಗ್ ಮತ್ತು ವಸ್ತುಗಳ ಮೇಲೆ ಅವಲಂಬಿತ. ಬುಕಿಂಗ್ ಫಾರ್ಮ್‌ನಲ್ಲಿ ಒಂದು ನಿಮಿಷದಲ್ಲಿ ನಿಖರ ದರ ಸಿಗುತ್ತದೆ — ತೋರಿಸಿದ ದರವೇ ಅಂತಿಮ.` },
  price_size: {
    hi: (c) => { const p = sizeOf(c.size); return p ? `${p.label} शिफ्टिंग: आम तौर पर ${range(p)} (${p.vehicle})। सही दाम दूरी, मंज़िल, लिफ्ट और पैकिंग पर निर्भर है — बुकिंग फॉर्म पर तुरंत देखें।` : null; },
    kn: (c) => { const p = sizeOf(c.size); return p ? `${p.label} ಶಿಫ್ಟಿಂಗ್: ಸಾಮಾನ್ಯವಾಗಿ ${range(p)} (${p.vehicle}). ನಿಖರ ದರ ದೂರ, ಮಹಡಿ, ಲಿಫ್ಟ್ ಮತ್ತು ಪ್ಯಾಕಿಂಗ್ ಮೇಲೆ ಅವಲಂಬಿತ — ಬುಕಿಂಗ್ ಫಾರ್ಮ್‌ನಲ್ಲಿ ತಕ್ಷಣ ನೋಡಿ.` : null; } },
  booking_how: { hi: () => "बुकिंग में करीब एक मिनट लगता है:\n1. “Get Moving Quote” दबाएं, पिकअप, ड्रॉप पता और तारीख डालें।\n2. घर का साइज़, गाड़ी और ऐड-ऑन चुनें — सटीक दाम दिखेगा।\n3. साइन इन करके ऑनलाइन एडवांस या पूरा पेमेंट करें।\nबुकिंग रेफरेंस तुरंत SMS और ईमेल पर मिलेगा।",
                 kn: () => "ಬುಕಿಂಗ್‌ಗೆ ಸುಮಾರು ಒಂದು ನಿಮಿಷ ಸಾಕು:\n1. “Get Moving Quote” ಒತ್ತಿ, ಪಿಕಪ್, ಡ್ರಾಪ್ ವಿಳಾಸ ಮತ್ತು ದಿನಾಂಕ ಹಾಕಿ.\n2. ಮನೆಯ ಗಾತ್ರ, ವಾಹನ ಮತ್ತು ಆಡ್-ಆನ್ ಆರಿಸಿ — ನಿಖರ ದರ ಕಾಣುತ್ತದೆ.\n3. ಸೈನ್ ಇನ್ ಮಾಡಿ ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಮುಂಗಡ ಅಥವಾ ಪೂರ್ಣ ಪಾವತಿ ಮಾಡಿ.\nಬುಕಿಂಗ್ ರೆಫರೆನ್ಸ್ ತಕ್ಷಣ SMS ಮತ್ತು ಇಮೇಲ್‌ನಲ್ಲಿ ಬರುತ್ತದೆ." },
  payment: { hi: () => "पेमेंट Razorpay से सुरक्षित होता है — UPI, कार्ड और नेट बैंकिंग। बुकिंग के हिसाब से एडवांस या पूरा पेमेंट ऑनलाइन कर सकते हैं; बाकी रकम काम पूरा होने पर ली जाती है। पार्सल का पेमेंट सिर्फ ऑनलाइन।",
             kn: () => "ಪಾವತಿ Razorpay ಮೂಲಕ ಸುರಕ್ಷಿತ — UPI, ಕಾರ್ಡ್ ಮತ್ತು ನೆಟ್ ಬ್ಯಾಂಕಿಂಗ್. ಬುಕಿಂಗ್ ಪ್ರಕಾರ ಮುಂಗಡ ಅಥವಾ ಪೂರ್ಣ ಮೊತ್ತ ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಪಾವತಿಸಬಹುದು; ಉಳಿದ ಮೊತ್ತ ಕೆಲಸ ಮುಗಿದಾಗ. ಪಾರ್ಸೆಲ್‌ಗೆ ಆನ್‌ಲೈನ್ ಪಾವತಿ ಮಾತ್ರ." },
  payment_failed: { hi: () => "माफ़ कीजिए। अगर पैसे कट गए हैं तो दोबारा पेमेंट न करें। हमारा सिस्टम Razorpay पेमेंट को अपने-आप बुकिंग से जोड़ देता है, आमतौर पर कुछ मिनट में बुकिंग My Bookings में दिख जाती है। 15 मिनट बाद भी न दिखे तो अपना Razorpay पेमेंट ID (pay_ से शुरू) हमें भेजें।",
                    kn: () => "ಕ್ಷಮಿಸಿ. ಹಣ ಕಡಿತವಾಗಿದ್ದರೆ ಮತ್ತೆ ಪಾವತಿಸಬೇಡಿ. ನಮ್ಮ ವ್ಯವಸ್ಥೆ Razorpay ಪಾವತಿಯನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಬುಕಿಂಗ್‌ಗೆ ಜೋಡಿಸುತ್ತದೆ; ಸಾಮಾನ್ಯವಾಗಿ ಕೆಲವು ನಿಮಿಷಗಳಲ್ಲಿ My Bookings ನಲ್ಲಿ ಕಾಣುತ್ತದೆ. 15 ನಿಮಿಷದ ನಂತರವೂ ಕಾಣದಿದ್ದರೆ ನಿಮ್ಮ Razorpay ಪಾವತಿ ID (pay_ ಇಂದ ಆರಂಭ) ನಮಗೆ ಕಳುಹಿಸಿ." },
  cancel_refund: { hi: () => `कैंसलेशन पॉलिसी:\n• शिफ्टिंग वाले दिन से पहले कभी भी: ऑनलाइन दिए पूरे पैसे वापस — कोई कटौती नहीं।\n• शिफ्टिंग वाले दिन: कृपया ${CONTACT.phone} पर कॉल करें।\n• पैकिंग शुरू होने के बाद: रिफंड नहीं।\nरिफंड उसी पेमेंट तरीके में 5–7 बैंक दिनों में आता है।`,
                   kn: () => `ರದ್ದತಿ ನೀತಿ:\n• ಶಿಫ್ಟಿಂಗ್ ದಿನಕ್ಕಿಂತ ಮೊದಲು ಯಾವಾಗ ಬೇಕಾದರೂ: ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಪಾವತಿಸಿದ ಪೂರ್ಣ ಹಣ ವಾಪಸ್ — ಯಾವುದೇ ಕಡಿತವಿಲ್ಲ.\n• ಶಿಫ್ಟಿಂಗ್ ದಿನ: ದಯವಿಟ್ಟು ${CONTACT.phone} ಗೆ ಕರೆ ಮಾಡಿ.\n• ಪ್ಯಾಕಿಂಗ್ ಆರಂಭವಾದ ನಂತರ: ರೀಫಂಡ್ ಇಲ್ಲ.\nರೀಫಂಡ್ ಅದೇ ಪಾವತಿ ವಿಧಾನಕ್ಕೆ 5–7 ಬ್ಯಾಂಕ್ ದಿನಗಳಲ್ಲಿ ಬರುತ್ತದೆ.` },
  reschedule: { hi: () => `स्लॉट से 12 घंटे पहले तक तारीख मुफ्त बदल सकते हैं (उपलब्धता के अनुसार) — My Bookings में Reschedule या ${CONTACT.phone} पर कॉल करें।`,
                kn: () => `ಸ್ಲಾಟ್‌ಗೆ 12 ಗಂಟೆ ಮೊದಲು ವರೆಗೆ ದಿನಾಂಕವನ್ನು ಉಚಿತವಾಗಿ ಬದಲಿಸಬಹುದು (ಲಭ್ಯತೆಯಂತೆ) — My Bookings ನಲ್ಲಿ Reschedule ಅಥವಾ ${CONTACT.phone} ಗೆ ಕರೆ ಮಾಡಿ.` },
  damage: { hi: () => "PackZen शिफ्टिंग के दौरान हुआ नुकसान हमारी पॉलिसी के अनुसार कवर है — हर बुकिंग पर ₹10,000 तक (अतिरिक्त बीमा लेने पर ज़्यादा)। डिलीवरी के 24 घंटे के अंदर My Bookings से फोटो के साथ रिपोर्ट करें।",
            kn: () => "PackZen ಶಿಫ್ಟಿಂಗ್ ವೇಳೆ ಆದ ಹಾನಿ ನಮ್ಮ ನೀತಿಯಂತೆ ಕವರ್ ಆಗುತ್ತದೆ — ಪ್ರತಿ ಬುಕಿಂಗ್‌ಗೆ ₹10,000 ವರೆಗೆ (ಹೆಚ್ಚುವರಿ ವಿಮೆ ಪಡೆದರೆ ಹೆಚ್ಚು). ಡೆಲಿವರಿಯ 24 ಗಂಟೆಗಳೊಳಗೆ My Bookings ನಿಂದ ಫೋಟೋ ಸಹಿತ ವರದಿ ಮಾಡಿ." },
  area: { hi: () => "हम बेंगलुरु में सेवा देते हैं: सभी 560xxx पिनकोड, साथ में होसकोटे, अनेकल, देवनहल्ली, सरजापुर और अत्तिबेले।\n• शिफ्टिंग बेंगलुरु से शुरू होनी चाहिए, पर भारत में कहीं भी जा सकती है।\n• होम सर्विस के लिए बेंगलुरु का पता चाहिए।\n• पार्सल का पिकअप और ड्रॉप दोनों बेंगलुरु में।",
          kn: () => "ನಾವು ಬೆಂಗಳೂರಿನಲ್ಲಿ ಸೇವೆ ನೀಡುತ್ತೇವೆ: ಎಲ್ಲಾ 560xxx ಪಿನ್‌ಕೋಡ್‌ಗಳು, ಜೊತೆಗೆ ಹೊಸಕೋಟೆ, ಆನೇಕಲ್, ದೇವನಹಳ್ಳಿ, ಸರ್ಜಾಪುರ ಮತ್ತು ಅತ್ತಿಬೆಲೆ.\n• ಶಿಫ್ಟಿಂಗ್ ಬೆಂಗಳೂರಿನಿಂದ ಆರಂಭವಾಗಬೇಕು, ಭಾರತದಲ್ಲಿ ಎಲ್ಲಿಗೆ ಬೇಕಾದರೂ ಹೋಗಬಹುದು.\n• ಹೋಮ್ ಸರ್ವಿಸ್‌ಗೆ ಬೆಂಗಳೂರಿನ ವಿಳಾಸ ಬೇಕು.\n• ಪಾರ್ಸೆಲ್‌ನ ಪಿಕಪ್ ಮತ್ತು ಡ್ರಾಪ್ ಎರಡೂ ಬೆಂಗಳೂರಿನಲ್ಲಿ." },
  parcel: { hi: () => `बेंगलुरु में टू-व्हीलर पार्सल डिलीवरी: पहले 2 किमी ${inr(49)}, फिर ${inr(11)} प्रति किमी, 10 किलो से ज़्यादा पर +${inr(30)}। 20 किलो और 40 किमी तक, पिकअप-ड्रॉप दोनों बेंगलुरु में, ऑनलाइन पेमेंट।`,
            kn: () => `ಬೆಂಗಳೂರಿನಲ್ಲಿ ಟೂ-ವೀಲರ್ ಪಾರ್ಸೆಲ್ ಡೆಲಿವರಿ: ಮೊದಲ 2 ಕಿಮೀ ${inr(49)}, ನಂತರ ಪ್ರತಿ ಕಿಮೀ ${inr(11)}, 10 ಕೆಜಿ ಮೀರಿದರೆ +${inr(30)}. 20 ಕೆಜಿ ಮತ್ತು 40 ಕಿಮೀ ವರೆಗೆ, ಪಿಕಪ್-ಡ್ರಾಪ್ ಎರಡೂ ಬೆಂಗಳೂರಿನಲ್ಲಿ, ಆನ್‌ಲೈನ್ ಪಾವತಿ.` },
  home_services: { hi: () => "हम बेंगलुरु में AC सर्विस, रिपेयर, इंस्टॉलेशन और गैस रिफिल, घर/किचन/बाथरूम की डीप क्लीनिंग, इलेक्ट्रीशियन, कारपेंटर, प्लंबर और TV वॉल माउंटिंग देते हैं — दाम बुकिंग से पहले दिखते हैं।",
                   kn: () => "ನಾವು ಬೆಂಗಳೂರಿನಲ್ಲಿ AC ಸರ್ವಿಸ್, ರಿಪೇರಿ, ಇನ್‌ಸ್ಟಾಲೇಶನ್ ಮತ್ತು ಗ್ಯಾಸ್ ರೀಫಿಲ್, ಮನೆ/ಅಡುಗೆಮನೆ/ಬಾತ್‌ರೂಮ್ ಡೀಪ್ ಕ್ಲೀನಿಂಗ್, ಎಲೆಕ್ಟ್ರಿಷಿಯನ್, ಕಾರ್ಪೆಂಟರ್, ಪ್ಲಂಬರ್ ಮತ್ತು TV ವಾಲ್ ಮೌಂಟಿಂಗ್ ನೀಡುತ್ತೇವೆ — ದರ ಬುಕಿಂಗ್‌ಗೆ ಮೊದಲೇ ಕಾಣುತ್ತದೆ." },
  tracking: { hi: () => "ड्राइवर असाइन होने के बाद आप My Bookings में अपनी शिफ्टिंग देख सकते हैं, और ड्राइवर असाइन होने, सामान रास्ते में होने और काम पूरा होने पर SMS मिलेगा।",
              kn: () => "ಡ್ರೈವರ್ ನಿಯೋಜನೆಯಾದ ನಂತರ My Bookings ನಲ್ಲಿ ನಿಮ್ಮ ಶಿಫ್ಟಿಂಗ್ ನೋಡಬಹುದು; ಡ್ರೈವರ್ ನಿಯೋಜನೆ, ಸಾಮಾನು ಸಾಗಣೆ ಮತ್ತು ಕೆಲಸ ಮುಗಿದಾಗ SMS ಬರುತ್ತದೆ." },
  hours_contact: { hi: () => `PackZen से ${CONTACT.phone} (कॉल या WhatsApp) या ${CONTACT.email} पर संपर्क करें — सोम–रवि, सुबह 8 से रात 9 बजे तक।`,
                   kn: () => `PackZen ಅನ್ನು ${CONTACT.phone} (ಕರೆ ಅಥವಾ WhatsApp) ಅಥವಾ ${CONTACT.email} ಮೂಲಕ ಸಂಪರ್ಕಿಸಿ — ಸೋಮ–ಭಾನು, ಬೆಳಿಗ್ಗೆ 8 ರಿಂದ ರಾತ್ರಿ 9 ರವರೆಗೆ.` },
  human: { hi: () => `मैं हमारी टीम से किसी को आपकी मदद के लिए बुलाता हूँ। अपना नाम और नंबर छोड़ दीजिए, हम काम के घंटों में वापस कॉल करेंगे। आज ही ज़रूरी हो तो ${CONTACT.phone} पर कॉल करें।`,
           kn: () => `ನಮ್ಮ ತಂಡದವರು ನಿಮಗೆ ಸಹಾಯ ಮಾಡುತ್ತಾರೆ. ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ನಂಬರ್ ನೀಡಿ, ಕೆಲಸದ ಸಮಯದಲ್ಲಿ ವಾಪಸ್ ಕರೆ ಮಾಡುತ್ತೇವೆ. ಇಂದೇ ತುರ್ತು ಇದ್ದರೆ ${CONTACT.phone} ಗೆ ಕರೆ ಮಾಡಿ.` },
  parcel_price: { hi: (c) => (c.km ? parcelLine("hi", c.km, c.kg) : null), kn: (c) => (c.km ? parcelLine("kn", c.km, c.kg) : null) },
  booking_status: { hi: () => "बुकिंग देखने के लिए पहले साइन इन करें — प्राइवेसी के लिए बुकिंग सिर्फ उसी अकाउंट को दिखती है जिसने बुक की है।",
                    kn: () => "ಬುಕಿಂಗ್ ನೋಡಲು ಮೊದಲು ಸೈನ್ ಇನ್ ಮಾಡಿ — ಗೌಪ್ಯತೆಗಾಗಿ ಬುಕಿಂಗ್ ಮಾಡಿದ ಖಾತೆಗೆ ಮಾತ್ರ ಅದು ಕಾಣುತ್ತದೆ." },
  unknown: { hi: () => `माफ़ कीजिए, इसका पक्का जवाब मेरे पास नहीं है। आप ${CONTACT.phone} पर कॉल करें या “Request a callback” दबाएं — हमारी टीम मदद करेगी।`,
             kn: () => `ಕ್ಷಮಿಸಿ, ಇದಕ್ಕೆ ನನ್ನ ಬಳಿ ಖಚಿತ ಉತ್ತರವಿಲ್ಲ. ${CONTACT.phone} ಗೆ ಕರೆ ಮಾಡಿ ಅಥವಾ “Request a callback” ಒತ್ತಿ — ನಮ್ಮ ತಂಡ ಸಹಾಯ ಮಾಡುತ್ತದೆ.` },
};
const NOTE = { hi: "(इस विषय का जवाब अभी अंग्रेज़ी में है:)", kn: "(ಈ ವಿಷಯದ ಉತ್ತರ ಸದ್ಯ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿದೆ:)" };

/**
 * Rewrite an engine result in Hindi/Kannada. Intents with templates are translated;
 * dynamic answers the engine computed (exact parcel price, catalog prices, booking
 * details) are kept as they are — numbers stay exact.
 */
function localize(out, lang, ctx) {
  if (!out || !["hi", "kn"].includes(lang) || !out.reply) return out;
  const intents = out.intents || [];
  if (intents.some((i) => i.startsWith("refuse_"))) return out;
  const parts = [];
  let allTranslated = true;
  for (const id of intents) {
    const tpl = T[id] && T[id][lang];
    const txt = tpl ? tpl(ctx || {}) : null;
    if (txt) parts.push(txt); else allTranslated = false;
  }
  if (!parts.length) return Object.assign({}, out, { reply: NOTE[lang] + "\n" + out.reply, lang });
  if (!allTranslated) return Object.assign({}, out, { reply: parts.join("\n\n") + "\n\n" + NOTE[lang] + "\n" + out.reply, lang });
  return Object.assign({}, out, { reply: parts.join("\n\n"), lang });
}

module.exports = { detectLang, understand, localize, TEMPLATES: T };
