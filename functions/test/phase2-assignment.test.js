/**
 * Phase 2A (driver profiles, presence, backfill) + 2B (engine, shadow mode,
 * manual assignment). Mocks only.   node test/phase2-assignment.test.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const dp = require("../driver-profile.js");
const engine = require("../assignment-engine.js");
const asg = require("../assignment.js");
const backfill = require("../../scripts/backfill-driver-profiles.js");
const ROOT = path.join(__dirname, "..", "..");
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function makeDb() {
  const store = {}; let seq = 0, writes = 0;
  const col = (n) => (store[n] = store[n] || {});
  const has = (n, id) => Object.prototype.hasOwnProperty.call(col(n), id);
  const snap = (n, id) => ({ exists: has(n, id), id, data: () => clone(col(n)[id]) });
  function ref(n, id) { return { _n: n, id, get: async () => snap(n, id),
    set: async (d) => { writes++; col(n)[id] = clone(d); }, update: async (d) => { writes++; Object.assign(col(n)[id], clone(d)); },
    create: async (d) => { if (has(n, id)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } writes++; col(n)[id] = clone(d); } }; }
  const cmp = (v, op, x) => (op === "==" ? v === x : op === "in" ? x.includes(v) : false);
  function query(n, f, lim) { return { where: (a, op, b) => query(n, f.concat([[a, op, b]]), lim), limit: (k) => query(n, f, k),
    get: async () => { let ids = Object.keys(col(n)).filter((id) => f.every(([a, op, b]) => cmp(col(n)[id][a], op, b))); if (lim) ids = ids.slice(0, lim); return { docs: ids.map((id) => snap(n, id)), empty: !ids.length }; } }; }
  let chain = Promise.resolve();
  return { store, col, writes: () => writes, collection: (n) => Object.assign(query(n, [], null), { doc: (id) => ref(n, id || "auto" + (++seq)) }),
    runTransaction(fn) { const run = chain.then(async () => { const w = [];
      const tx = { get: async (r) => snap(r._n, r.id), set: (r, d) => w.push(() => { col(r._n)[r.id] = clone(d); }), update: (r, d) => w.push(() => { Object.assign(col(r._n)[r.id], clone(d)); }) };
      const out = await fn(tx); w.forEach((x) => { writes++; x(); }); return out; }); chain = run.catch(() => {}); return run; } };
}
const quiet = { info() {}, warn() {}, error() {} };
const tests = []; const test = (n, f) => tests.push({ n, f });
async function rejects(p, code) { try { await p; } catch (e) { assert.strictEqual(e.code, code, "got " + e.code + ": " + e.message); return e; } throw new Error("expected " + code); }
const ctx = (uid) => ({ auth: { uid, token: { email_verified: true } } });
const NOW = Date.parse("2026-10-10T03:30:00Z"); // 09:00 IST, 10 Oct 2026

/* ═════════ 2A: driver profiles ═════════ */
function profEnv() {
  const db = makeDb();
  db.col("users").driverAAA1 = { role: "driver", name: "Ravi", phone: "9000000001" };
  db.col("users").custAAAA01 = { role: "customer" };
  const deps = { db, serverTimestamp: () => "TS", logger: quiet, isAdmin: async (c) => c.auth.uid === "adminAAA01" };
  return { db, deps };
}
test("2A profile: only admins; unauthenticated rejected", async () => {
  const { deps } = profEnv();
  for (const who of ["driverAAA1", "custAAAA01", "advisorAA1"]) await rejects(dp.handleUpsert({ uid: "driverAAA1", profile: { status: "active" } }, ctx(who), deps), "permission-denied");
  await rejects(dp.handleUpsert({ uid: "driverAAA1", profile: {} }, {}, deps), "unauthenticated");
});
test("2A profile: create applies defaults + server fields; update keeps createdAt/server fields", async () => {
  const { db, deps } = profEnv();
  const r = await dp.handleUpsert({ uid: "driverAAA1", profile: { vehicleIds: ["truck_17ft", "truck_17ft"], homeBase: { lat: 12.9716, lng: 77.5946 } } }, ctx("adminAAA01"), deps);
  assert.ok(r.created); const p = db.col("driverProfiles").driverAAA1;
  assert.deepStrictEqual([p.status, p.serviceAreas, p.skills, p.vehicleIds, p.maxJobsPerDay, p.partnerId, p.phoneVerified], ["onboarding", ["bangalore"], ["moving"], ["truck_17ft"], 3, null, false]);
  assert.deepStrictEqual(p.rating, { avg: null, count: 0 }); assert.deepStrictEqual(p.acceptance, { offered: 0, accepted: 0, declined: 0, expired: 0 });
  assert.strictEqual(p.homeBase.geohash, "tdr1v9q"); assert.strictEqual(p.createdAt, "TS"); assert.strictEqual(p.lastOfferedAt, null);
  db.col("driverProfiles").driverAAA1.createdAt = "ORIGINAL"; db.col("driverProfiles").driverAAA1.rating = { avg: 4.5, count: 3 };
  const r2 = await dp.handleUpsert({ uid: "driverAAA1", profile: { status: "active", skills: ["moving", "packing"] } }, ctx("adminAAA01"), deps);
  assert.ok(!r2.created); const q = db.col("driverProfiles").driverAAA1;
  assert.deepStrictEqual([q.status, q.skills, q.createdAt, q.rating.avg, q.vehicleIds], ["active", ["moving", "packing"], "ORIGINAL", 4.5, ["truck_17ft"]]);
});
test("2A profile: strict validation, no field injection", async () => {
  const { deps } = profEnv(); const bad = async (profile) => rejects(dp.handleUpsert({ uid: "driverAAA1", profile }, ctx("adminAAA01"), deps), "invalid-argument");
  for (const p of [{ rating: { avg: 5 } }, { lastOfferedAt: 1 }, { acceptance: {} }, { role: "admin" }, { createdAt: 1 }, { status: "boss" }, { vehicleIds: ["rocket"] }, { vehicleIds: "tata_ace" },
                   { skills: ["hacking"] }, { skills: [] }, { serviceAreas: ["mysore"] }, { serviceAreas: [] }, { maxJobsPerDay: 0 }, { maxJobsPerDay: 2.5 }, { maxJobsPerDay: 11 },
                   { homeBase: { lat: 100, lng: 1 } }, { homeBase: { lat: 1, lng: 2, extra: 3 } }, { partnerId: "../x" }, { phoneVerified: "yes" }]) await bad(p);
  await rejects(dp.handleUpsert({ uid: "custAAAA01", profile: { status: "active" } }, ctx("adminAAA01"), deps), "failed-precondition");
  await rejects(dp.handleUpsert({ uid: "../../x", profile: {} }, ctx("adminAAA01"), deps), "invalid-argument");
});
test("2A vehicle ids come from the pricing model", () => {
  assert.deepStrictEqual(dp.VEHICLE_IDS, Object.keys(require("../pricing-engine-v2.js").config.vehicles));
});

/* ═════════ 2A: presence + rules (static; emulator cases live in tests/rules) ═════════ */
test("2A presence: driver.html dual-writes users + driverPresence with allowed fields only", () => {
  const s = fs.readFileSync(path.join(ROOT, "public/driver.html"), "utf8");
  assert.ok(s.includes('collection("driverPresence").doc(driverUser.uid).set(data, { merge: true })'));
  const calls = [...s.matchAll(/_writePresence\(\{([^}]*)\}\)/g)].map((m) => m[1]);
  assert.strictEqual(calls.length, 4, "toggle, sign-out, login restore, location");
  const allowed = ["online", "lat", "lng", "geohash"];
  for (const c of calls) for (const k of c.replace(/\([^)]*\)/g, "").split(",").map((x) => x.split(":")[0].trim()).filter(Boolean)) assert.ok(allowed.includes(k), "presence field " + k);
  assert.ok(/update\(\{ isOnline: online \}\)/.test(s) && /update\(\{ lat, lng, locationUpdatedAt/.test(s), "users/{uid} writes kept");
});
test("2A rules: profiles client-unwritable; presence owner + allow-list + server time; drivers no longer world-readable", () => {
  const r = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  const blk = (m) => r.slice(r.indexOf(m), r.indexOf("}", r.indexOf(m) + m.length + 200) + 1);
  assert.ok(/match \/driverProfiles\/\{uid\} \{\s*allow read: if isAdmin\(\) \|\| isAdvisor\(\) \|\| \(isDriver\(\) && request\.auth\.uid == uid\);\s*allow write: if false;/.test(r));
  assert.ok(r.includes("request.resource.data.keys().hasOnly(['online', 'lat', 'lng', 'geohash', 'updatedAt', 'appVersion'])"));
  assert.ok(r.includes("request.resource.data.updatedAt == request.time"));
  assert.ok(/match \/drivers\/\{driverUid\} \{\s*allow read: if isAdmin\(\) \|\| isAdvisor\(\) \|\| \(isDriver\(\) && request\.auth\.uid == driverUid\);/.test(r));
  assert.ok(/match \/assignmentRecommendations\/\{bookingId\} \{\s*allow read: if isAdmin\(\) \|\| isAdvisor\(\);\s*allow write: if false;/.test(r));
  assert.ok(blk("match /bookings/{bookingId}").length > 0);
});

/* ═════════ 2A: backfill ═════════ */
function bfEnv() {
  const db = makeDb();
  db.col("users").drvNew0001 = { role: "driver", name: "Secret Name", phone: "9876543210", email: "d@example.com", isOnline: true, lat: 12.97, lng: 77.59, locationUpdatedAt: "2026-10-01T00:00:00Z" };
  db.col("users").drvNoLoc01 = { role: "driver", name: "No Loc" };
  db.col("users").drvHasPro1 = { role: "driver", isOnline: false };
  db.col("users").custBF0001 = { role: "customer" };
  db.col("driverProfiles").drvHasPro1 = { status: "suspended", vehicleIds: ["truck_22ft"], marker: "keep" };
  db.col("driverPresence").drvHasPro1 = { online: false, marker: "keep" };
  return db;
}
const bfRun = (db, apply, lines) => backfill.run({ db, apply, now: () => NOW, serverTimestamp: () => "TS", log: (l) => lines.push(l) });
test("2A backfill: dry run writes nothing and reports the plan (no PII)", async () => {
  const db = bfEnv(); const lines = []; const before = clone(db.store);
  const s = await bfRun(db, false, lines);
  assert.deepStrictEqual(db.store, before); assert.strictEqual(db.writes(), 0);
  assert.deepStrictEqual([s.drivers, s.profilesToCreate, s.presenceToCreate, s.created, s.skippedExisting], [3, 2, 1, 0, 1]);
  const out = lines.join("\n"); for (const pii of ["Secret Name", "9876543210", "d@example.com"]) assert.ok(!out.includes(pii));
  assert.ok(out.includes("DRY RUN"));
});
test("2A backfill: apply creates only missing docs; re-run is a no-op; existing docs untouched", async () => {
  const db = bfEnv(); const lines = [];
  const s1 = await bfRun(db, true, lines);
  assert.strictEqual(s1.created, 3);
  const p = db.col("driverProfiles").drvNew0001; assert.deepStrictEqual([p.status, p.skills, p.vehicleIds, p.createdAt], ["active", ["moving"], [], "TS"]);
  const pr = db.col("driverPresence").drvNew0001; assert.deepStrictEqual([pr.online, pr.lat, pr.lng, pr.geohash, pr.appVersion], [true, 12.97, 77.59, dp.encodeGeohash(12.97, 77.59, 7), "backfill-2a"]);
  assert.ok(!db.col("driverPresence").drvNoLoc01, "no presence without data"); assert.ok(db.col("driverProfiles").drvNoLoc01);
  assert.deepStrictEqual(db.col("driverProfiles").drvHasPro1, { status: "suspended", vehicleIds: ["truck_22ft"], marker: "keep" });
  assert.deepStrictEqual(db.col("driverPresence").drvHasPro1, { online: false, marker: "keep" });
  assert.ok(!db.col("driverProfiles").custBF0001);
  const snapshot = clone(db.store); const w = db.writes();
  const s2 = await bfRun(db, true, []);
  assert.strictEqual(s2.created, 0); assert.deepStrictEqual(db.store, snapshot); assert.strictEqual(db.writes(), w);
});

/* ═════════ 2B: engine ═════════ */
const P = (o) => Object.assign({ status: "active", serviceAreas: ["bangalore"], vehicleIds: ["tata_ace"], skills: ["moving"], maxJobsPerDay: 3 }, o);
const D = (uid, profile, extra) => Object.assign({ uid, name: uid, profile, presence: null, jobsOnDate: [] }, extra || {});
const moveB = (o) => Object.assign({ bookingType: "move", vehicleUsed: "truck_17ft", date: "2026-10-12", shiftTime: "09:00" }, o);
const ev = (b, ds, o) => engine.evaluate(b, ds, Object.assign({ now: NOW, bookingId: "bkTEST0001" }, o || {}));
const excl = (r, uid) => (r.excluded.find((e) => e.uid === uid) || { reasons: [] }).reasons;

test("2B vehicle compatibility: smaller vehicle excluded, same/bigger eligible, none excluded", () => {
  const r = ev(moveB(), [D("small00001", P({ vehicleIds: ["tata_ace"] })), D("same000001", P({ vehicleIds: ["truck_17ft"] })), D("big0000001", P({ vehicleIds: ["truck_22ft"] })), D("none000001", P({ vehicleIds: [] }))]);
  assert.deepStrictEqual(excl(r, "small00001"), ["vehicle_too_small"]); assert.deepStrictEqual(excl(r, "none000001"), ["no_vehicle"]);
  assert.deepStrictEqual(r.ranked.map((x) => x.uid).sort(), ["big0000001", "same000001"]);
});
test("2B skill compatibility for catalog services (and unmapped categories excluded)", () => {
  const svc = { bookingType: "service", items: [{ categoryId: "ac-services" }], date: "2026-10-12", shiftTime: "11:00" };
  const r = ev(svc, [D("acTech0001", P({ skills: ["ac"], vehicleIds: [] })), D("mover00001", P({ skills: ["moving"] }))]);
  assert.deepStrictEqual(r.ranked.map((x) => x.uid), ["acTech0001"]); assert.deepStrictEqual(excl(r, "mover00001"), ["skill_mismatch"]);
  const r2 = ev({ bookingType: "service", items: [{ categoryId: "space-repair" }], date: "2026-10-12" }, [D("acTech0001", P({ skills: SKILLS_ALL() }))]);
  assert.deepStrictEqual(excl(r2, "acTech0001"), ["skill_mismatch"]);
});
function SKILLS_ALL() { return dp.SKILLS.slice(); }
test("2B area matching", () => {
  const r = ev(moveB(), [D("blr0000001", P({ vehicleIds: ["truck_22ft"] })), D("noarea0001", P({ vehicleIds: ["truck_22ft"], serviceAreas: [] }))]);
  assert.deepStrictEqual(excl(r, "noarea0001"), ["area_mismatch"]);
});
test("2B schedule conflicts: overlapping window, distant window, unknown time", () => {
  const ds = [D("overlap001", P({ vehicleIds: ["truck_22ft"] }), { jobsOnDate: [{ bookingId: "x1", startMin: 11 * 60 }] }),
              D("free000001", P({ vehicleIds: ["truck_22ft"] }), { jobsOnDate: [{ bookingId: "x2", startMin: 15 * 60 }] }),
              D("unknown001", P({ vehicleIds: ["truck_22ft"] }), { jobsOnDate: [{ bookingId: "x3", startMin: null }] })];
  const r = ev(moveB(), ds);
  assert.deepStrictEqual(excl(r, "overlap001"), ["schedule_conflict"]); assert.deepStrictEqual(excl(r, "unknown001"), ["schedule_conflict"]);
  assert.ok(r.ranked.some((x) => x.uid === "free000001"));
  const r2 = ev(moveB({ shiftTime: null }), [D("free000001", ds[1].profile, { jobsOnDate: ds[1].jobsOnDate })]);
  assert.deepStrictEqual(excl(r2, "free000001"), ["schedule_conflict"], "unknown booking time = whole day");
  const r3 = ev(moveB(), [D("self000001", P({ vehicleIds: ["truck_22ft"] }), { jobsOnDate: [{ bookingId: "bkTEST0001", startMin: 9 * 60 }] })]);
  assert.strictEqual(r3.ranked.length, 1, "the booking itself never conflicts");
});
test("2B capacity (maxJobsPerDay)", () => {
  const r = ev(moveB({ shiftTime: "17:00" }), [D("full000001", P({ vehicleIds: ["truck_22ft"], maxJobsPerDay: 1 }), { jobsOnDate: [{ bookingId: "x", startMin: 7 * 60 }] })]);
  assert.deepStrictEqual(excl(r, "full000001"), ["at_capacity"]);
});
test("2B same-day/near-term needs online + fresh presence; future jobs don't", () => {
  const soon = moveB({ date: "2026-10-10", shiftTime: "11:00" }); // 2 h away
  const pres = (online, ageMin) => ({ online, lat: 12.97, lng: 77.59, updatedAt: NOW - ageMin * 60000 });
  const ds = [D("online0001", P({ vehicleIds: ["truck_22ft"] }), { presence: pres(true, 2) }), D("offline001", P({ vehicleIds: ["truck_22ft"] }), { presence: pres(false, 2) }),
              D("stale00001", P({ vehicleIds: ["truck_22ft"] }), { presence: pres(true, 45) }), D("nopres0001", P({ vehicleIds: ["truck_22ft"] }))];
  const r = ev(soon, ds);
  assert.deepStrictEqual(r.ranked.map((x) => x.uid), ["online0001"]);
  assert.deepStrictEqual([excl(r, "offline001"), excl(r, "stale00001"), excl(r, "nopres0001")], [["offline_near_term"], ["stale_presence"], ["offline_near_term"]]);
  assert.strictEqual(ev(moveB(), ds).ranked.length, 4, "future job: presence not required");
});
test("2B suspended, onboarding, locked, previously tried excluded", () => {
  const r = ev(moveB(), [D("susp000001", P({ status: "suspended", vehicleIds: ["truck_22ft"] })), D("onb0000001", P({ status: "onboarding", vehicleIds: ["truck_22ft"] })),
    D("lock000001", P({ vehicleIds: ["truck_22ft"], lockedUntil: NOW + 60000 })), D("tried00001", P({ vehicleIds: ["truck_22ft"] })), D("noprof0001", null)], { triedUids: ["tried00001"] });
  assert.deepStrictEqual([excl(r, "susp000001"), excl(r, "onb0000001"), excl(r, "lock000001"), excl(r, "tried00001"), excl(r, "noprof0001")],
    [["status_suspended"], ["status_onboarding"], ["locked"], ["previously_tried"], ["no_profile"]]);
  assert.strictEqual(r.ranked.length, 0);
});
test("2B deterministic: input order and repeats don't change the result; ties break by uid", () => {
  const ds = [D("zeta000001", P({ vehicleIds: ["truck_22ft"] })), D("alpha00001", P({ vehicleIds: ["truck_22ft"] })), D("mid0000001", P({ vehicleIds: ["truck_22ft"] }))];
  const a = ev(moveB(), ds), b = ev(moveB(), [ds[2], ds[0], ds[1]]);
  assert.deepStrictEqual(a, b); assert.deepStrictEqual(a.ranked.map((x) => x.uid), ["alpha00001", "mid0000001", "zeta000001"]);
});
test("2B fairness: longer since last offer ranks higher; weights are configurable", () => {
  const ds = [D("recent0001", P({ vehicleIds: ["truck_22ft"], lastOfferedAt: NOW - 3600e3 })), D("older00001", P({ vehicleIds: ["truck_22ft"], lastOfferedAt: NOW - 5 * 86400e3 }))];
  assert.deepStrictEqual(ev(moveB(), ds).ranked.map((x) => x.uid), ["older00001", "recent0001"]);
  const rated = [D("hiRating01", P({ vehicleIds: ["truck_22ft"], rating: { avg: 5, count: 9 }, lastOfferedAt: NOW - 3600e3 })), D("loRating01", P({ vehicleIds: ["truck_22ft"], rating: { avg: 2, count: 9 }, lastOfferedAt: NOW - 6 * 86400e3 }))];
  assert.strictEqual(ev(moveB(), rated).ranked[0].uid, "loRating01");
  assert.strictEqual(ev(moveB(), rated, { config: { weights: { fairness: 0, rating: 1 } } }).ranked[0].uid, "hiRating01");
});
test("2B golden fixture", () => {
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "assignment-golden.json"), "utf8"));
  const r = engine.evaluate(g.booking, g.drivers, { now: g.now, bookingId: g.booking.id });
  assert.deepStrictEqual(r.ranked.map((x) => ({ uid: x.uid, score: x.score, distanceKm: x.distanceKm })), g.expected.ranked);
  assert.deepStrictEqual(r.excluded, g.expected.excluded);
});

/* ═════════ 2B: shadow mode + manual assignment ═════════ */
function asgEnv() {
  const db = makeDb();
  const u = (uid, o) => { db.col("users")[uid] = Object.assign({ role: "driver", name: uid.toUpperCase(), phone: "90000" + uid.slice(-5) }, o || {}); };
  u("drvBig0001"); u("drvBig0002"); u("drvAce0001"); u("drvNoPro01"); u("drvSusp001"); u("custX00001", { role: "customer" });
  const prof = (uid, o) => { db.col("driverProfiles")[uid] = P(Object.assign({ vehicleIds: ["truck_22ft"] }, o)); };
  prof("drvBig0001"); prof("drvBig0002"); prof("drvAce0001", { vehicleIds: ["tata_ace"] }); prof("drvSusp001", { status: "suspended" });
  db.col("bookings").bkOne00001 = { status: "confirmed", bookingType: "move", vehicleUsed: "truck_17ft", date: "2026-10-12", shiftTime: "09:00", customerUid: "c1", total: 5000, paid: 500, balanceDue: 4500 };
  db.col("bookings").bkTwo00001 = { status: "confirmed", bookingType: "move", vehicleUsed: "truck_17ft", date: "2026-10-12", shiftTime: "10:00", customerUid: "c2" };
  db.col("bookings").bkPack0001 = { status: "packing", date: "2026-10-12", shiftTime: "15:00", driverUid: "drvBig0002", customerUid: "c3" };
  const deps = { db, now: () => NOW, logger: quiet, isAdmin: async (c) => c.auth.uid === "adminAAA01" };
  return { db, deps };
}
const assign = (deps, o, who) => asg.handleAssign(Object.assign({ expectedDriverUid: null }, o), ctx(who || "adminAAA01"), deps);

test("2B shadow: recommendation stored server-side; bookings NEVER modified (driverUid untouched)", async () => {
  const { db, deps } = asgEnv(); const before = clone(db.col("bookings")); const usersBefore = clone(db.col("users"));
  const rec = await asg.recommend(deps, "bkOne00001");
  assert.deepStrictEqual(db.col("bookings"), before, "bookings unchanged"); assert.deepStrictEqual(db.col("users"), usersBefore, "users unchanged");
  assert.ok(!db.col("bookings").bkOne00001.driverUid);
  const stored = db.col("assignmentRecommendations").bkOne00001;
  assert.deepStrictEqual(stored.top.map((x) => x.uid), ["drvBig0001", "drvBig0002"]);
  assert.deepStrictEqual([stored.mode, stored.eligibleCount, stored.candidates], ["shadow", 2, 5]);
  assert.deepStrictEqual(stored.excludedCounts, { vehicle_too_small: 1, no_profile: 1, status_suspended: 1 });
  assert.ok(!JSON.stringify(stored).includes("90000"), "no driver phone numbers in recommendations");
  assert.deepStrictEqual(rec, stored);
});
test("2B shadow sweep: only unassigned upcoming bookings; never assigns; kill switch", async () => {
  const { db, deps } = asgEnv();
  db.col("bookings").bkFar00001 = { status: "confirmed", date: "2026-12-01", shiftTime: "09:00", bookingType: "move", vehicleUsed: "tata_ace" };
  db.col("bookings").bkCanc0001 = { status: "cancelled", date: "2026-10-11" };
  const before = clone(db.col("bookings"));
  const r = await asg.shadowSweep(deps);
  assert.deepStrictEqual(r, { skipped: false, computed: 2 });
  assert.deepStrictEqual(Object.keys(db.col("assignmentRecommendations")).sort(), ["bkOne00001", "bkTwo00001"]);
  assert.deepStrictEqual(db.col("bookings"), before, "sweep never writes bookings");
  db.col("appConfig").assignment = { shadowEnabled: false };
  db.store.assignmentRecommendations = {};
  assert.deepStrictEqual(await asg.shadowSweep(deps), { skipped: true, computed: 0 });
  assert.deepStrictEqual(db.col("assignmentRecommendations"), {});
});
test("2B recommend callable: admin only", async () => {
  const { deps } = asgEnv();
  await rejects(asg.handleRecommend({ bookingId: "bkOne00001" }, ctx("drvBig0001"), deps), "permission-denied");
  await rejects(asg.handleRecommend({ bookingId: "bkOne00001" }, {}, deps), "unauthenticated");
  assert.strictEqual((await asg.handleRecommend({ bookingId: "bkOne00001" }, ctx("adminAAA01"), deps)).top[0].uid, "drvBig0001");
});
test("2B manual assign: authorization and input validation", async () => {
  const { deps } = asgEnv();
  for (const who of ["drvBig0001", "custX00001", "advisorAA1"]) await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" }, who), "permission-denied");
  await rejects(asg.handleAssign({ bookingId: "bkOne00001", driverUid: "drvBig0001" }, ctx("adminAAA01"), deps), "invalid-argument"); // expectedDriverUid missing
  await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "custX00001" }), "failed-precondition");
  await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "drvSusp001" }), "failed-precondition");
  await rejects(assign(deps, { bookingId: "bkPack0001", driverUid: "drvBig0001", expectedDriverUid: "drvBig0002" }), "failed-precondition");
  await rejects(assign(deps, { bookingId: "missing001", driverUid: "drvBig0001" }), "not-found");
});
test("2B manual assign: success writes booking, schedule lock and currentBooking consistently", async () => {
  const { db, deps } = asgEnv();
  const r = await assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" });
  assert.deepStrictEqual([r.ok, r.warnings, r.overridden], [true, [], []]);
  const b = db.col("bookings").bkOne00001;
  assert.deepStrictEqual([b.driverUid, b.driverName, b.driverPhone, b.status, b.assignment.method, b.assignment.by, b.assignment.previousDriverUid, b.assignment.override],
    ["drvBig0001", "DRVBIG0001", "90000g0001", "assigned", "manual", "adminAAA01", null, null]);
  assert.deepStrictEqual([b.total, b.paid, b.balanceDue], [5000, 500, 4500], "money untouched");
  assert.deepStrictEqual(db.col("driverSchedule")["drvBig0001_2026-10-12"].jobs, { bkOne00001: 540 });
  assert.strictEqual(db.col("users").drvBig0001.currentBooking, "bkOne00001");
  assert.strictEqual((await assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001", expectedDriverUid: "drvBig0001" })).already, true);
});
test("2B manual assign: stale expectedDriverUid is rejected (concurrent admins)", async () => {
  const { db, deps } = asgEnv();
  await assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" });
  await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0002", expectedDriverUid: null }), "aborted");
  assert.strictEqual(db.col("bookings").bkOne00001.driverUid, "drvBig0001");
});
test("2B manual assign: two admins at once on the same booking → exactly one wins", async () => {
  const { db, deps } = asgEnv();
  const res = await Promise.allSettled([assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" }), assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0002" })]);
  assert.deepStrictEqual(res.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
  assert.strictEqual(res.find((x) => x.status === "rejected").reason.code, "aborted");
  const winner = db.col("bookings").bkOne00001.driverUid;
  const loser = winner === "drvBig0001" ? "drvBig0002" : "drvBig0001";
  assert.ok(!db.col("users")[loser].currentBooking); assert.ok(!db.col("driverSchedule")[loser + "_2026-10-12"]);
});
test("2B manual assign: same driver, overlapping slots on two bookings at once → one conflict", async () => {
  const { db, deps } = asgEnv();
  const res = await Promise.allSettled([assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" }), assign(deps, { bookingId: "bkTwo00001", driverUid: "drvBig0001" })]);
  assert.deepStrictEqual(res.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
  assert.ok(/schedule_conflict/.test(res.find((x) => x.status === "rejected").reason.publicMessage));
  assert.strictEqual(Object.keys(db.col("driverSchedule")["drvBig0001_2026-10-12"].jobs).length, 1);
});
test("2B manual assign: conflict with an existing (pre-Phase-2) booking is blocking even with override", async () => {
  const { deps } = asgEnv(); // drvBig0002 has the 15:00 packing job
  await rejects(assign(deps, { bookingId: "bkTwo00001", driverUid: "drvBig0002", overrideReason: "customer asked for this driver" }).then(() => assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0002", overrideReason: "x".repeat(20) })), "failed-precondition");
});
test("2B manual assign: ineligible driver needs an override reason, which is recorded", async () => {
  const { db, deps } = asgEnv();
  const e = await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "drvAce0001" }), "failed-precondition");
  assert.deepStrictEqual(e.detail, ["vehicle_too_small"]);
  await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "drvAce0001", overrideReason: "short" }), "failed-precondition");
  const r = await assign(deps, { bookingId: "bkOne00001", driverUid: "drvAce0001", overrideReason: "two trips agreed with customer" });
  assert.deepStrictEqual(r.overridden, ["vehicle_too_small"]);
  assert.deepStrictEqual(db.col("bookings").bkOne00001.assignment.override, { reasons: ["vehicle_too_small"], reason: "two trips agreed with customer" });
});
test("2B manual assign: driver without a profile is still assignable (pre-backfill), with a warning", async () => {
  const { db, deps } = asgEnv();
  const r = await assign(deps, { bookingId: "bkOne00001", driverUid: "drvNoPro01" });
  assert.deepStrictEqual(r.warnings, ["no_profile"]); assert.strictEqual(db.col("bookings").bkOne00001.driverUid, "drvNoPro01");
});
test("2B manual reassign: previous driver's lock and currentBooking released", async () => {
  const { db, deps } = asgEnv();
  await assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" });
  await assign(deps, { bookingId: "bkOne00001", driverUid: "drvNoPro01", expectedDriverUid: "drvBig0001" });
  assert.deepStrictEqual(db.col("driverSchedule")["drvBig0001_2026-10-12"].jobs, {});
  assert.strictEqual(db.col("users").drvBig0001.currentBooking, null);
  assert.strictEqual(db.col("bookings").bkOne00001.assignment.previousDriverUid, "drvBig0001");
});
/* ── review regressions ── */
test("review: stale schedule locks (cancelled, delivered, reassigned, re-dated, deleted) don't block and are pruned", async () => {
  const { db, deps } = asgEnv();
  db.col("bookings").bkCanc0001 = { status: "cancelled", date: "2026-10-12", shiftTime: "09:00", driverUid: "drvBig0001" };
  db.col("bookings").bkDone0001 = { status: "delivered", date: "2026-10-12", shiftTime: "10:00", driverUid: "drvBig0001" };
  db.col("bookings").bkElse0001 = { status: "assigned", date: "2026-10-12", shiftTime: "08:00", driverUid: "drvBig0002" };
  db.col("bookings").bkMoved001 = { status: "assigned", date: "2026-10-20", shiftTime: "09:00", driverUid: "drvBig0001" };
  db.col("driverSchedule")["drvBig0001_2026-10-12"] = { jobs: { bkCanc0001: 540, bkDone0001: 600, bkElse0001: 480, bkMoved001: 540, bkGone0001: 540 } };
  const r = await assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" });
  assert.ok(r.ok);
  assert.deepStrictEqual(db.col("driverSchedule")["drvBig0001_2026-10-12"].jobs, { bkOne00001: 540 });
  const rec = await asg.recommend(deps, "bkTwo00001");
  assert.ok(!rec.top.some((x) => x.uid === "drvBig0001"), "bkOne (09:00) now really blocks 10:00");
});
test("review: an unassigned-looking lock entry (concurrent assignment not yet visible) is kept", () => {
  assert.deepStrictEqual(asg.liveLockJobs({ bkA: 540 }, "drv1", { bkA: { status: "confirmed", driverUid: null } }), { bkA: 540 });
  assert.deepStrictEqual(asg.liveLockJobs({ bkA: 540 }, "drv1", { bkA: { status: "assigned", driverUid: "drv1" } }), { bkA: 540 });
});
test("review: cancellation racing assignment → assignment refused, nothing written", async () => {
  const { db, deps } = asgEnv();
  db.col("bookings").bkOne00001.status = "cancelled";
  await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" }), "failed-precondition");
  assert.ok(!db.col("driverSchedule")["drvBig0001_2026-10-12"]); assert.ok(!db.col("users").drvBig0001.currentBooking);
});
test("review: booking re-dated between pre-read and transaction → aborted", async () => {
  const { db, deps } = asgEnv();
  const origGet = db.runTransaction.bind(db);
  db.runTransaction = (fn) => { db.col("bookings").bkOne00001.date = "2026-10-13"; return origGet(fn); };
  await rejects(assign(deps, { bookingId: "bkOne00001", driverUid: "drvBig0001" }), "aborted");
});
test("review engine: boundaries — exactly 3 h is near-term, exactly 10 min presence is fresh, 4 h apart no conflict", () => {
  const exact3h = moveB({ date: "2026-10-10", shiftTime: "12:00" }); // NOW = 09:00 IST
  const p = (ageMin, online) => ({ online, updatedAt: NOW - ageMin * 60000 });
  const r = ev(exact3h, [D("fresh10m01", P({ vehicleIds: ["truck_22ft"] }), { presence: p(10, true) }), D("stale10m01", P({ vehicleIds: ["truck_22ft"] }), { presence: p(10.01, true) }), D("offline001", P({ vehicleIds: ["truck_22ft"] }))]);
  assert.deepStrictEqual(r.ranked.map((x) => x.uid), ["fresh10m01"]);
  assert.deepStrictEqual([excl(r, "stale10m01"), excl(r, "offline001")], [["stale_presence"], ["offline_near_term"]]);
  const r2 = ev(moveB({ date: "2026-10-10", shiftTime: "12:01" }), [D("offline001", P({ vehicleIds: ["truck_22ft"] }))]);
  assert.strictEqual(r2.ranked.length, 1, "3 h 1 min away is not near-term");
  const r3 = ev(moveB({ shiftTime: "13:00" }), [D("fourH00001", P({ vehicleIds: ["truck_22ft"] }), { jobsOnDate: [{ bookingId: "x", startMin: 9 * 60 }] })]);
  assert.strictEqual(r3.ranked.length, 1, "exactly 4 h apart does not conflict");
});
test("review engine: unknown time, midnight, invalid/past dates, zero/negative/missing profile values", () => {
  const late = Date.parse("2026-10-10T16:30:00Z"); // 22:00 IST
  const tomorrowNoTime = { bookingType: "move", vehicleUsed: "tata_ace", date: "2026-10-11" };
  assert.strictEqual(engine.evaluate(tomorrowNoTime, [D("offline001", P())], { now: late }).ranked.length, 1, "unknown time tomorrow ≠ near-term at 22:00");
  assert.strictEqual(engine.jobStartMs("2026-10-11", "00:00"), Date.parse("2026-10-10T18:30:00Z"), "midnight IST");
  assert.strictEqual(engine.jobStartMs("2026-02-31", "09:00"), null); assert.strictEqual(engine.jobStartMs("11/10/2026", "09:00"), null); assert.strictEqual(engine.jobStartMs(undefined), null);
  assert.strictEqual(engine.slotStartMin("25:00"), null); assert.strictEqual(engine.slotStartMin("9am"), null);
  const badDate = engine.evaluate({ bookingType: "move", vehicleUsed: "tata_ace", date: "2026-02-31", shiftTime: "09:00" }, [D("offline001", P())], { now: NOW });
  assert.strictEqual(badDate.ranked.length, 1);
  const past = ev(moveB({ date: "2026-10-01" }), [D("offline001", P({ vehicleIds: ["truck_22ft"] }))]);
  assert.deepStrictEqual(excl(past, "offline001"), ["offline_near_term"], "past-dated jobs need a live driver");
  const weird = ev(moveB(), [D("zeroCap001", P({ vehicleIds: ["truck_22ft"], maxJobsPerDay: 0 })), D("negCap0001", P({ vehicleIds: ["truck_22ft"], maxJobsPerDay: -2 })),
    D("noFields01", { status: "active" }), D("badRate001", P({ vehicleIds: ["truck_22ft"], rating: { avg: 9, count: -1 }, acceptance: { offered: -3, accepted: 10 }, lastOfferedAt: NOW + 86400e3 }))]);
  assert.deepStrictEqual(excl(weird, "zeroCap001"), ["at_capacity"]); assert.deepStrictEqual(excl(weird, "negCap0001"), ["at_capacity"]);
  assert.ok(excl(weird, "noFields01").includes("area_mismatch") && excl(weird, "noFields01").includes("no_vehicle"));
  const br = weird.ranked.find((x) => x.uid === "badRate001");
  assert.ok(br && br.score >= 0 && br.score <= 1 && Object.values(br.components).every((v) => v >= 0 && v <= 1), "scores stay within 0–1");
});
test("review engine: same-time bookings conflict; already-assigned booking never conflicts with itself", () => {
  const r = ev(moveB(), [D("same000001", P({ vehicleIds: ["truck_22ft"] }), { jobsOnDate: [{ bookingId: "other", startMin: 540 }] })]);
  assert.deepStrictEqual(excl(r, "same000001"), ["schedule_conflict"]);
});
test("review presence: login-restored online state and location updates keep driverPresence.online true", () => {
  const s = fs.readFileSync(path.join(ROOT, "public/driver.html"), "utf8");
  assert.ok(/setOnlineUI\(true\);\s*_writePresence\(\{ online: true \}\);/.test(s));
  assert.ok(s.includes("_writePresence({ online: true, lat, lng, geohash: _geohash(lat, lng, 7) })"));
});
test("review admin UI: no ids interpolated into inline JavaScript", () => {
  const a = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
  assert.ok(!a.includes("value='${escapeHTML(top.uid)}'") && !a.includes("editDriverProfile('${"));
  assert.ok(a.includes('onclick="editDriverProfile(this.dataset.uid)"') && a.includes('getElementById("assignUseRec").addEventListener'));
});
test("review backfill: real write errors are not swallowed; malformed records are safe", async () => {
  const db = makeDb();
  db.col("users").drvBadLoc1 = { role: "driver", lat: "12.9", lng: 77.5, isOnline: "yes" };
  db.col("users").drvNaN0001 = { role: "driver", lat: NaN, lng: 77.5 };
  db.col("users").drvRange01 = { role: "driver", lat: 999, lng: 77.5, isOnline: true };
  const s = await bfRun(db, true, []);
  assert.strictEqual(s.created, 4); // 3 profiles + presence only for drvRange01 (valid online flag, coords dropped)
  assert.deepStrictEqual(backfill.planFor("n", { lat: NaN, lng: 77.5 }, false, false).map((a) => a.type), ["createProfile"], "NaN coords → no presence");
  assert.ok(!db.col("driverPresence").drvBadLoc1);
  assert.ok(!("lat" in db.col("driverPresence").drvRange01) && db.col("driverPresence").drvRange01.online === true);
  const db2 = makeDb(); db2.col("users").drvPerm001 = { role: "driver" };
  const realCreate = db2.collection("driverProfiles").doc("x").create;
  const origCollection = db2.collection;
  db2.collection = (n) => { const c = origCollection(n); const d = c.doc; c.doc = (id) => { const r = d(id); if (n === "driverProfiles") r.create = async () => { const e = new Error("PERMISSION_DENIED: code 16 something 6"); e.code = 7; throw e; }; return r; }; return c; };
  await assert.rejects(bfRun(db2, true, []), /PERMISSION_DENIED/);
  void realCreate;
});

/* ── Phase 2C prerequisite: advisors assign via the callable ── */
const advDeps = (deps) => Object.assign({}, deps, { isAdvisor: async (c) => c.auth.uid === "advisorAA1" });
test("2C-prereq: advisor assigns through the callable (role recorded); customer/driver still denied", async () => {
  const { db, deps } = asgEnv(); const d = advDeps(deps);
  const r = await asg.handleAssign({ bookingId: "bkOne00001", driverUid: "drvBig0001", expectedDriverUid: null }, ctx("advisorAA1"), d);
  assert.ok(r.ok); const b = db.col("bookings").bkOne00001;
  assert.deepStrictEqual([b.driverUid, b.status, b.assignment.byRole, b.assignment.by], ["drvBig0001", "assigned", "advisor", "advisorAA1"]);
  assert.deepStrictEqual(db.col("driverSchedule")["drvBig0001_2026-10-12"].jobs, { bkOne00001: 540 });
  for (const who of ["drvBig0001", "custX00001"]) await rejects(asg.handleAssign({ bookingId: "bkTwo00001", driverUid: "drvBig0002", expectedDriverUid: null }, ctx(who), d), "permission-denied");
});
test("2C-prereq: advisors can't override eligibility (admin only); schedule conflicts still block", async () => {
  const { db, deps } = asgEnv(); const d = advDeps(deps);
  const e = await rejects(asg.handleAssign({ bookingId: "bkOne00001", driverUid: "drvAce0001", expectedDriverUid: null, overrideReason: "two trips agreed with customer" }, ctx("advisorAA1"), d), "failed-precondition");
  assert.ok(/Only an admin/.test(e.publicMessage)); assert.ok(!db.col("bookings").bkOne00001.driverUid);
  await asg.handleAssign({ bookingId: "bkOne00001", driverUid: "drvBig0001", expectedDriverUid: null }, ctx("advisorAA1"), d);
  await rejects(asg.handleAssign({ bookingId: "bkTwo00001", driverUid: "drvBig0001", expectedDriverUid: null }, ctx("advisorAA1"), d), "failed-precondition");
  const r = await asg.handleAssign({ bookingId: "bkOne00001", driverUid: "drvAce0001", expectedDriverUid: "drvBig0001", overrideReason: "two trips agreed with customer" }, ctx("adminAAA01"), d);
  assert.deepStrictEqual(r.overridden, ["vehicle_too_small"]);
});
test("2C-prereq: no client code writes booking driver fields any more", () => {
  const adv = fs.readFileSync(path.join(ROOT, "public/advisor-dashboard-patch.js"), "utf8");
  assert.ok(!/update\(\{\s*driverUid/.test(adv) && !/driverUid: driverUid \|\| null/.test(adv), "advisor direct writes removed");
  assert.ok(adv.includes('httpsCallable("adminAssignDriver")'));
  assert.ok(fs.readFileSync(path.join(ROOT, "public/advisor.html"), "utf8").includes("firebase-functions-compat.js"));
  const r = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  assert.ok(/isAdvisor\(\)\s*&& onlyFields\(\['status'\]\)/.test(r));
  assert.ok(r.includes("request.resource.data.get('driverUid', null) == resource.data.get('driverUid', null)"));
  assert.ok(r.includes("&& request.resource.data.get('driverUid', null) == null;"));
});

test("2B admin UI uses the callables; no direct driverUid write left in admin.html", () => {
  const a = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
  assert.ok(a.includes('_adminCallable("adminAssignDriver")') && a.includes('_adminCallable("adminGetAssignmentRecommendation")') && a.includes('_adminCallable("adminUpsertDriverProfile")'));
  assert.ok(!/update\(\{ driverUid, driverName/.test(a));
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  for (const f of ["adminUpsertDriverProfile", "adminGetAssignmentRecommendation", "adminAssignDriver", "shadowAssignmentSweep"]) assert.ok(new RegExp("exports\\." + f + " = ").test(idx), f);
  assert.ok(!/jobOffers|acceptJobOffer|autoAssign/.test(idx + fs.readFileSync(path.join(__dirname, "..", "assignment.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")), "no 2C automatic offers");
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) { try { await t.f(); pass++; console.log("  PASS  " + t.n); } catch (e) { fail++; console.log("  FAIL  " + t.n + "\n        " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e)); } }
  console.log(`\nphase2-assignment: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
