/**
 * PackZen — booking display formatting (customer invoice, admin invoice)
 * ----------------------------------------------------------------------
 * Bookings store some fields in more than one shape:
 *   furniture  — pay-later / advisor: a readable string ("Sofa ×2, Bed")
 *                online-paid (Phase 1+): an object of engine ids → qty
 *                ({ sofaCheck: 2, bedCheck: 1 })
 *   selectedFurniture — older bookings: object of ids/names → qty
 *   pickupFloor / dropFloor — option text ("2nd Floor") or a number
 *   vehicle — option text; online-paid bookings have vehicleUsed / vehicleId
 * Rendering an object with `${…}` produced "[object Object]" on invoices.
 * These helpers always return plain, human-readable strings. Display only —
 * nothing here affects pricing or payment.
 */
(function (root) {
  "use strict";

  const FURNITURE_LABELS = {
    sofaCheck: "Sofa", sofaCumBedCheck: "Sofa-cum-Bed", reclinerCheck: "Recliner", tvCheck: "TV",
    tvUnitCheck: "TV Unit", coffeeCheck: "Coffee Table", centerTableCheck: "Center Table",
    bookshelfCheck: "Bookshelf", showcaseCheck: "Showcase", shoeRackCheck: "Shoe Rack",
    bedCheck: "Bed", mattressCheck: "Mattress", wardrobeCheck: "Wardrobe", dressingCheck: "Dressing Table",
    sideTableCheck: "Side Table", studyTableCheck: "Study Table", fridgeCheck: "Fridge",
    wmCheck: "Washing Machine", dishwasherCheck: "Dishwasher", microwaveCheck: "Microwave", ovenCheck: "Oven",
    chimneyCheck: "Chimney", diningCheck: "Dining Table", waterPurifierCheck: "Water Purifier",
    acCheck: "AC Unit", deskCheck: "Office Desk", chairCheck: "Chair", serverCheck: "Server/PC",
    printerCheck: "Printer", confCheck: "Conference Table", cabinetCheck: "Filing Cabinet",
    whiteboardCheck: "Whiteboard", bikeCheck: "Bike/Scooter", cycleCheck: "Cycle", gymCheck: "Gym Equipment",
    treadmillCheck: "Treadmill", plantCheck: "Large Plants",
  };

  const VEHICLE_LABELS = { tata_ace: "Tata Ace", truck_14ft: "14 ft Truck", truck_17ft: "17 ft Truck", truck_22ft: "22 ft Truck" };

  function humanize(key) {
    const s = String(key).replace(/Check$/, "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }
  function furnitureLabel(key) {
    if (Object.prototype.hasOwnProperty.call(FURNITURE_LABELS, key)) return FURNITURE_LABELS[key];
    return humanize(key);
  }
  function qtyOf(v) {
    const n = typeof v === "number" ? v : parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /** Lines like "Sofa × 2" from either a string summary or an id → qty object. */
  function furnitureLines(b) {
    b = b || {};
    const src = b.furniture;
    if (typeof src === "string") {
      return src.split(",").map((x) => x.trim()).filter(Boolean);
    }
    const lines = [];
    const fromObject = (obj) => {
      Object.keys(obj).forEach((k) => {
        const q = qtyOf(obj[k]);
        if (q > 0) lines.push(furnitureLabel(k) + " × " + q);
      });
    };
    if (src && typeof src === "object" && !Array.isArray(src)) fromObject(src);
    else if (Array.isArray(src)) src.forEach((x) => { if (typeof x === "string" && x.trim()) lines.push(x.trim()); });
    if (!lines.length && b.selectedFurniture && typeof b.selectedFurniture === "object") fromObject(b.selectedFurniture);
    const cartons = qtyOf(b.cartonQty);
    const hasCartonLine = lines.some((l) => /carton/i.test(l));
    if (cartons > 0 && !hasCartonLine && typeof src !== "string") lines.push("Cartons × " + cartons);
    return lines;
  }

  /** Text block for invoices: "Furniture:\n- Sofa × 2\n- Bed × 1" or "None specified". */
  function itemsSummaryText(b) {
    const lines = furnitureLines(b);
    if (!lines.length) return "None specified";
    return "Furniture:\n" + lines.map((l) => "- " + l).join("\n");
  }

  function vehicleLabel(b) {
    b = b || {};
    if (typeof b.vehicle === "string" && b.vehicle.trim()) return b.vehicle.trim();
    const id = (typeof b.vehicleUsed === "string" && b.vehicleUsed) || (typeof b.vehicleId === "string" && b.vehicleId) || "";
    if (!id) return "";
    const engine = root && root.PackZenPricing && root.PackZenPricing.vehicles;
    if (engine && engine[id] && typeof engine[id].name === "string") return engine[id].name;
    return VEHICLE_LABELS[id] || humanize(id);
  }

  function floorLabel(v) {
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return v === 0 ? "Ground Floor" : "Floor " + v;
    return "";
  }

  function timeLabel(b) {
    b = b || {};
    if (typeof b.shiftTimeLabel === "string" && b.shiftTimeLabel.trim()) return b.shiftTimeLabel.trim();
    if (typeof b.shiftTime === "string" && b.shiftTime.trim()) return b.shiftTime.trim();
    return "";
  }

  const api = { furnitureLines, itemsSummaryText, vehicleLabel, floorLabel, timeLabel, furnitureLabel };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PackZenBookingFormat = api;
})(typeof window !== "undefined" ? window : null);
