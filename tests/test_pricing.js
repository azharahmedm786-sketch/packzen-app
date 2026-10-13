const fs = require('fs');

// Mock window and document
global.window = {};
global.document = {
  getElementById: (id) => null
};

// Load script
const code = fs.readFileSync('public/pricing-engine-v2.js', 'utf8');
eval(code);

function test(name, input, expectedFn) {
  const result = window.PackZenPricing.calculateQuote(input);
  if (!result.valid) {
    console.error(`❌ ${name} failed. Errors:`, result.errors);
    return;
  }
  const pass = expectedFn(result);
  if (pass) {
    console.log(`✅ ${name} passed.`);
  } else {
    console.error(`❌ ${name} failed. Result:`, JSON.stringify(result.breakdown, null, 2));
  }
}

// Case 1: 1RK Move (Small vehicle)
test("1RK Move", {
  pickup: "A", drop: "B", km: 15,
  houseValue: 2500, // 1RK
  vehicleHtmlValue: "200", // Tata Ace
  furniture: { bedCheck: 1, fridgeCheck: 1, wmCheck: 1 }, // 8 + 8 + 6 = 22 units
  cartonQty: 5, // 5 units
  pickupFloor: 1, dropFloor: 1, liftAvailable: false,
  packingService: true,
  moveType: "home", extraHelpers: 0
}, (r) => {
  // Tata Ace (40 cap)
  // units: 22 + 5 = 27 units -> 67.5% -> Three Quarter Load
  // Base: 1000
  // Extra km: 5 * 25 = 125
  // Capacity: 600 (Three Quarter Load)
  // Floor: 2 floors * 200 = 400
  // Labour: 1 helper * 400 = 400
  // Packing: 27 units * 20 = 540
  // Subtotal = 1000 + 125 + 600 + 400 + 400 + 540 = 3065
  // Grand = 3065
  return Math.abs(r.breakdown.grandTotal - 3065) < 1;
});

// Case 2: 2BHK Move (Medium vehicle)
test("2BHK Move", {
  pickup: "A", drop: "B", km: 20,
  houseValue: 6500, // 2BHK
  vehicleHtmlValue: "2500", // 14ft Truck
  furniture: { bedCheck: 2, wardrobeCheck: 2, sofaCheck: 1, fridgeCheck: 1 }, // 16 + 30 + 10 + 8 = 64
  cartonQty: 10, // 10 units
  pickupFloor: 2, dropFloor: 3, liftAvailable: true,
  packingService: true,
  moveType: "home", extraHelpers: 1
}, (r) => {
  // 14ft (80 cap)
  // units: 64 + 10 = 74 -> 92.5% -> Full Load
  // Base: 1500
  // Extra km: 10 * 25 = 250
  // Capacity: 1200
  // Floor: 5 floors * 100 = 500
  // Labour: 3 helpers * 400 = 1200
  // Packing: 74 units * 20 = 1480
  // Subtotal = 1500 + 250 + 1200 + 500 + 1200 + 1480 = 6130
  return Math.abs(r.breakdown.grandTotal - 6130) < 1;
});
