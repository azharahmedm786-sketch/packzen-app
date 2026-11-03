// Daily "fake customer" check of the LIVE site (run by .github/workflows/booking-check.yml).
// Fails (→ GitHub e-mails the repo owner) if a customer could not start a booking.
import { chromium } from "playwright";
const SITE = process.env.SITE || "https://packzenblr.in";
const HEALTH = "https://asia-south1-packzen-e7539.cloudfunctions.net/healthCheck";
const failures = [];
const check = async (name, fn) => { try { await fn(); console.log("PASS  " + name); } catch (e) { failures.push(name + ": " + (e && e.message ? e.message.split("\n")[0] : e)); console.log("FAIL  " + name + " — " + (e && e.message)); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "PackZenBookingCheck/1.0 (+https://packzenblr.in)" });

await check("server health (functions + database)", async () => {
  const r = await fetch(HEALTH); const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error("healthCheck returned " + r.status);
});

await check("homepage loads without script errors", async () => {
  const pg = await ctx.newPage(); const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 120)));
  const res = await pg.goto(SITE + "/", { waitUntil: "load", timeout: 30000 });
  if (!res || res.status() >= 400) throw new Error("HTTP " + (res && res.status()));
  await pg.getByText("Get Moving Quote").first().waitFor({ timeout: 15000 });
  await pg.waitForTimeout(2000);
  const real = errs.filter((m) => !/ResizeObserver|Script error/i.test(m));
  if (real.length) throw new Error("page errors: " + real.slice(0, 3).join(" | "));
  await pg.close();
});

await check("booking form opens and Google address search works", async () => {
  const pg = await ctx.newPage();
  await pg.goto(SITE + "/", { waitUntil: "load", timeout: 30000 });
  await pg.getByText("Get Moving Quote").first().click();
  await pg.waitForFunction(() => document.getElementById("bookingSheet") && document.getElementById("bookingSheet").classList.contains("open"), null, { timeout: 10000 });
  await pg.getByText("Home Move").first().waitFor({ state: "visible", timeout: 10000 });
  // Google Maps + Places must load and return suggestions (this is what customers type into)
  await pg.waitForFunction(() => !!(window.google && google.maps && google.maps.places), null, { timeout: 25000 });
  const n = await pg.evaluate(() => new Promise((res) => {
    new google.maps.places.AutocompleteService().getPlacePredictions({ input: "HSR Layout Bangalore", componentRestrictions: { country: "in" } },
      (p, status) => res(status === "OK" && p ? p.length : 0));
    setTimeout(() => res(-1), 15000);
  }));
  if (!(n > 0)) throw new Error("Google address search returned no suggestions (status/timeout " + n + ") — check the Maps key, billing and allowed websites");
  await pg.close();
});

await check("services catalog loads from the database", async () => {
  const pg = await ctx.newPage();
  await pg.goto(SITE + "/services.html", { waitUntil: "load", timeout: 30000 });
  await pg.waitForFunction(() => { const r = document.getElementById("catRoot"); return r && /₹\s?\d/.test(r.textContent || ""); }, null, { timeout: 25000 });
  await pg.close();
});

await check("PackZen Digital enquiry form present", async () => {
  const pg = await ctx.newPage();
  await pg.goto(SITE + "/digital/", { waitUntil: "load", timeout: 30000 });
  await pg.locator("#dzForm").waitFor({ timeout: 15000 });
  await pg.close();
});

await browser.close();
if (failures.length) { console.error("\nBOOKING CHECK FAILED:\n- " + failures.join("\n- ")); process.exit(1); }
console.log("\nAll customer checks passed.");
