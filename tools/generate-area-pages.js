#!/usr/bin/env node
/**
 * Generates the 8 PackZen area landing pages (packers-and-movers-<slug>.html)
 * from one shared template + a per-city data file.
 *
 * Usage: node generate-area-pages.js <outputDir>
 */
const fs = require("fs");
const path = require("path");

const TEMPLATE_PATH = path.join(__dirname, "..", "templates", "area-page.template.html");
const DATA_PATH = path.join(__dirname, "..", "data", "areas.json");

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: node generate-area-pages.js <outputDir>");
  process.exit(1);
}

const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
const areas = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

function buildFaqJsonLd(faq) {
  return faq.map(({ q, a }) => (
`    {
      "@type": "Question",
      "name": "${q}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${a}"
      }
    }`
  )).join(",\n");
}

function buildFaqHtml(faq) {
  return faq.map(({ q, a }) => (
`    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)">${q}<span class="faq-arrow">&#9662;</span></button>
      <div class="faq-a">${a}</div>
    </div>`
  )).join("\n");
}

function buildBullets(bullets) {
  return bullets.map(b => `    <li>${b}</li>`).join("\n");
}

function buildRelatedCards(related) {
  return related.map(r => (
`    <a class="svc-related-card" href="${r.href}">
      <div class="svc-related-title">${r.title}</div>
      <div class="svc-related-sub">${r.sub}</div>
    </a>`
  )).join("\n");
}

fs.mkdirSync(outDir, { recursive: true });

for (const [slug, d] of Object.entries(areas)) {
  let page = template;
  const replacements = {
    "{{TITLE_FULL}}": d.title_full,
    "{{META_DESCRIPTION}}": d.meta_description,
    "{{CANONICAL}}": d.canonical,
    "{{OG_TITLE}}": d.og_title,
    "{{OG_DESCRIPTION}}": d.og_description,
    "{{OG_URL}}": d.og_url,
    "{{TWITTER_TITLE}}": d.twitter_title,
    "{{TWITTER_DESCRIPTION}}": d.twitter_description,
    "{{LD_SERVICE_TYPE}}": d.ld_serviceType,
    "{{LD_NAME}}": d.ld_name,
    "{{LD_DESCRIPTION}}": d.ld_description,
    "{{LD_URL}}": d.ld_url,
    "{{LD_AREA_NAME}}": d.ld_area_name,
    "{{BREADCRUMB_NAME}}": d.breadcrumb_name,
    "{{BREADCRUMB_ITEM}}": d.breadcrumb_item,
    "{{FAQ_JSONLD_ITEMS}}": buildFaqJsonLd(d.faq),
    "{{CITY_BARE}}": d.breadcrumb_current,
    "{{H1}}": d.h1,
    "{{INTRO_P1}}": d.intro_p1,
    "{{INTRO_P2}}": d.intro_p2,
    "{{H2_WHAT_TO_KNOW}}": d.h2_what_to_know,
    "{{H2_SERVICES_AVAILABLE}}": d.h2_services_available,
    "{{H2_READY}}": d.h2_ready,
    "{{BULLETS_ITEMS}}": buildBullets(d.bullets),
    "{{RELATED_CARDS_ITEMS}}": buildRelatedCards(d.related),
    "{{FAQ_HTML_ITEMS}}": buildFaqHtml(d.faq),
  };

  // CITY_BARE appears many times, so use split/join (global) for it;
  // all others are designed to appear exactly once in the template.
  for (const [token, value] of Object.entries(replacements)) {
    if (token === "{{CITY_BARE}}") {
      page = page.split(token).join(value);
    } else {
      if (!page.includes(token)) {
        throw new Error(`Token ${token} not found in template for ${slug}`);
      }
      page = page.replace(token, value);
    }
  }

  // Sanity check: no leftover template tokens
  const leftover = page.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    throw new Error(`Leftover tokens in ${slug}: ${leftover.join(", ")}`);
  }

  const outPath = path.join(outDir, `packers-and-movers-${slug}.html`);
  fs.writeFileSync(outPath, page, "utf8");
  console.log(`Generated ${outPath}`);
}
