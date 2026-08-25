const assert = require('assert');
const PackZenPricing = require('../functions/pricing-engine-v2.js');

let fetchCalled = false;
global.fetch = async (url) => {
  fetchCalled = true;
  return { json: async () => ({ status: "OK", rows: [{ elements: [{ status: "OK", distance: { value: 15000 } }] }] }) };
};
global.GOOGLE_MAPS_KEY = { value: () => "mock_key" };

// Extracted test subject
async function getGoogleMapsDistance(pickup, drop) {
  if (!pickup || !drop) return 0;
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(drop)}&key=${GOOGLE_MAPS_KEY.value()}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
      return data.rows[0].elements[0].distance.value / 1000;
    }
  } catch (err) { }
  return 0;
}

async function calculateServerQuote(quoteInput, pickup, drop) {
  const computedKm = await getGoogleMapsDistance(pickup, drop);
  if (computedKm > 0) {
    quoteInput.km = computedKm;
  } else if (quoteInput.km && computedKm === 0) {
    throw new Error("Could not calculate distance server-side.");
  }

  if (quoteInput.furniture) {
    for (const [key, qty] of Object.entries(quoteInput.furniture)) {
      const parsedQty = parseInt(qty, 10) || 0;
      if (parsedQty < 0) throw new Error("Invalid item quantity.");
      quoteInput.furniture[key] = parsedQty;
    }
  }

  quoteInput.cartonQty = parseInt(quoteInput.cartonQty, 10) || 0;
  if (quoteInput.cartonQty < 0) throw new Error("Invalid item quantity.");

  quoteInput.pickupFloor = parseInt(quoteInput.pickupFloor, 10) || 0;
  if (quoteInput.pickupFloor < 0) throw new Error("Invalid floor count.");

  quoteInput.dropFloor = parseInt(quoteInput.dropFloor, 10) || 0;
  if (quoteInput.dropFloor < 0) throw new Error("Invalid floor count.");

  if (quoteInput.vehicleId && !PackZenPricing.vehicles[quoteInput.vehicleId]) {
     throw new Error("Unknown vehicle ID.");
  }

  const validation = PackZenPricing.validateInput(quoteInput);
  if (!validation.valid) throw new Error("Validation error");

  const quote = PackZenPricing.calculateQuote(quoteInput);
  if (!quote.valid) throw new Error("Pricing error");
  return quote;
}

async function runTests() {
  console.log("Running Security Tests...");

  const fakeInput = { pickup: "Origin", drop: "Dest", km: 2.5, vehicleId: "tata_ace", cartonQty: 5, pickupFloor: 2, dropFloor: 1 };
  const result = await calculateServerQuote(fakeInput, "Origin", "Dest");

  assert.strictEqual(result.km, 15, "Server must override client km with API distance (15)");
  console.log("✅ Distance manipulation rejected.");

  // Test G: Invalid item quantities
  const negativeInput = { km: 10, vehicleId: "tata_ace", pickup: "A", drop: "B", cartonQty: -5, pickupFloor: -2 };
  try {
      await calculateServerQuote(negativeInput, "A", "B");
      assert.fail("Should throw negative item error");
  } catch (e) {
      assert(e.message.includes("Invalid item quantity") || e.message.includes("Invalid floor count"), "Expected invalid quantity/floor error");
  }
  console.log("✅ Negative item quantities rejected.");

  console.log("All tests passed!");
}

runTests().catch(console.error);