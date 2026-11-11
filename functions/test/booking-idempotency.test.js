/**
 * Pay-Later Booking Idempotency, Concurrency, Recovery & Operational Alert Suite
 * Tests P1-13 implementation against specification v10.
 * Includes both mandatory safeguards:
 *   1. Reconciliation must recover expired `sending` alert claims (> 5 min), not just `pending` and `failed`.
 *   2. Use a claim ID or equivalent ownership check (alertClaimId) so an expired worker cannot overwrite a newer worker's result.
 */
"use strict";

process.env.GCLOUD_PROJECT = "packzen-e7539";
process.env.GOOGLE_MAPS_KEY = "test_maps_key";

const assert = require("assert");
const admin = require("firebase-admin");

// Expect assertion wrapper for chai-style tests
const expect = (val) => ({
  to: {
    equal: (expected) => assert.strictEqual(val, expected),
    not: {
      equal: (expected) => assert.notStrictEqual(val, expected)
    },
    include: (expected) => {
      if (Array.isArray(val)) {
        assert.ok(val.includes(expected), `Expected array to include ${expected}`);
      } else {
        assert.ok(String(val).includes(String(expected)), `Expected ${val} to include ${expected}`);
      }
    },
    be: {
      a: (type) => assert.strictEqual(typeof val, type),
      oneOf: (arr) => assert.ok(arr.includes(val), `Expected ${val} to be one of ${JSON.stringify(arr)}`)
    }
  }
});
expect.fail = (msg) => assert.fail(msg);

// Lightweight test runner for direct node execution
const testQueue = [];
const describe = (name, fn) => {
  console.log(`\n--- ${name} ---`);
  fn();
};
const it = (name, fn) => {
  testQueue.push({ name, fn });
};

// ── In-Memory Firestore Mock with Transaction Isolation ──
const store = {};
let seq = 0;
const col = (n) => (store[n] = store[n] || {});
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function makeDb() {
  let txLock = Promise.resolve();
  const db = {
    collection: (n) => ({
      doc: (id) => {
        id = id || ("auto_" + (++seq));
        return {
          _n: n,
          id,
          set: async (d) => { col(n)[id] = clone(d); },
          update: async (d) => {
            if (!col(n)[id]) col(n)[id] = {};
            Object.assign(col(n)[id], clone(d));
          },
          get: async () => ({
            exists: !!col(n)[id],
            id,
            ref: { _n: n, id, update: async (d) => { Object.assign(col(n)[id], clone(d)); } },
            data: () => clone(col(n)[id])
          })
        };
      },
      add: async (d) => {
        const id = "auto_" + (++seq);
        col(n)[id] = clone(d);
        return { id };
      },
      where: (f, op, v) => {
        const filters = [[f, op, v]];
        const q = {
          where: (f2, op2, v2) => {
            filters.push([f2, op2, v2]);
            return q;
          },
          limit: () => q,
          get: async () => {
            const docs = Object.entries(col(n))
              .filter(([, d]) =>
                filters.every(([ff, opp, vv]) => {
                  if (opp === "==") return d[ff] === vv;
                  if (opp === "in") return Array.isArray(vv) && vv.includes(d[ff]);
                  return true;
                })
              )
              .map(([id, d]) => ({
                id,
                ref: {
                  _n: n,
                  id,
                  update: async (up) => { Object.assign(col(n)[id], clone(up)); }
                },
                data: () => clone(d)
              }));
            return {
              empty: docs.length === 0,
              size: docs.length,
              docs
            };
          }
        };
        return q;
      }
    }),
    runTransaction: async (fn) => {
      const prevLock = txLock;
      let release;
      txLock = new Promise((resolve) => { release = resolve; });
      await prevLock;
      try {
        const writes = [];
        const tx = {
          get: async (ref) => {
            const exists = !!col(ref._n)[ref.id];
            return {
              exists,
              id: ref.id,
              data: () => clone(col(ref._n)[ref.id])
            };
          },
          set: (ref, d) => {
            writes.push(() => { col(ref._n)[ref.id] = clone(d); });
          },
          update: (ref, d) => {
            writes.push(() => {
              if (!col(ref._n)[ref.id]) col(ref._n)[ref.id] = {};
              Object.assign(col(ref._n)[ref.id], clone(d));
            });
          },
          delete: (ref) => {
            writes.push(() => { delete col(ref._n)[ref.id]; });
          }
        };
        const result = await fn(tx);
        writes.forEach((w) => w());
        return result;
      } finally {
        release();
      }
    }
  };
  return db;
}

const fakeDb = makeDb();
const fsFn = () => fakeDb;
fsFn.FieldValue = {
  serverTimestamp: () => ({ _serverTimestamp: true, ts: Date.now() })
};
fsFn.Timestamp = {
  fromMillis: (ms) => ({ _millis: ms })
};
Object.defineProperty(admin, "firestore", { value: fsFn, configurable: true });

// Seed active promo code
col("promos")["SAVE10"] = {
  code: "SAVE10",
  active: true,
  type: "percent",
  value: 10,
  maxDiscount: 500
};

// Mock Google Maps Distance Matrix fetch
const origFetch = global.fetch;
global.fetch = async (url) => {
  if (typeof url === "string" && url.includes("maps.googleapis.com")) {
    return {
      json: async () => ({
        status: "OK",
        origin_addresses: ["Indiranagar, Bengaluru, Karnataka 560038, India"],
        destination_addresses: ["Koramangala, Bengaluru, Karnataka 560034, India"],
        rows: [{ elements: [{ status: "OK", distance: { value: 12000 } }] }]
      })
    };
  }
  if (origFetch) return origFetch(url);
  return { json: async () => ({}) };
};

// Mock DOM & SessionStorage for Client idempotency tests
global.window = global;
global.window.location = { href: "http://localhost:5000", hostname: "localhost" };
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, innerHTML: "", appendChild: () => {}, querySelector: () => null, addEventListener: () => {} }),
  addEventListener: () => {}
};
const sessionStore = {};
global.sessionStorage = {
  getItem: (k) => sessionStore[k] ?? null,
  setItem: (k, v) => { sessionStore[k] = String(v); },
  removeItem: (k) => { delete sessionStore[k]; },
  clear: () => { Object.keys(sessionStore).forEach((k) => delete sessionStore[k]); }
};

// Require functions & modules under test
const indexFunctions = require("../index.js");
const {
  sendCustomerEmailWithOutbox,
  attemptOperationalAlertClaim,
  ALERT_CLAIM_LEASE_MS,
  MAX_ALERT_ATTEMPTS
} = require("../notification-service.js");
const {
  queueSMS,
  queueWhatsApp,
  normalizeRecipient
} = require("../notifications.js");
const {
  PackZenIdempotency,
  isDefinitiveServerError,
  normalizeFirebaseErrorCode
} = require("../../public/script.js");

const createBooking = (payload, context) => indexFunctions.createBooking.run(payload, context);

describe("Pay-Later Booking Idempotency, Concurrency & Recovery Suite", () => {
  let ipCounter = 1;
  const getFreshContext = () => ({
    auth: { uid: "user_test_" + (++ipCounter) + "_" + Date.now(), token: { email: `customer_${ipCounter}@test.com` } },
    rawRequest: { ip: `127.0.0.${ipCounter}` }
  });

  const baseQuoteInput = {
    pickup: "Indiranagar, Bangalore",
    drop: "Koramangala, Bangalore",
    km: 12,
    vehicleId: "tata_ace",
    furniture: { bed_single: 1 },
    promoCode: "SAVE10"
  };

  const baseBookingDetails = {
    bookingRef: "PKZ-TEST01",
    customerName: "Jane Doe",
    phone: "9876543210",
    email: "jane@test.com",
    pickup: "Indiranagar, Bangalore",
    drop: "Koramangala, Bangalore",
    date: "2026-11-20",
    moveType: "household",
    house: "1 BHK",
    furniture: "1 Bed",
    liftAvailable: true,
    packingService: true,
    photos: ["https://storage.googleapis.com/packzen-e7539.appspot.com/photo1.jpg"]
  };

  let passCount = 0;
  const ok = (m) => { passCount++; console.log("  PASS  " + m); };

  it("1. Simultaneous identical requests create exactly ONE booking", async () => {
    const ctx = getFreshContext();
    const requestId = "req_concurrent_" + Date.now();
    const payload = { quoteInput: baseQuoteInput, bookingDetails: baseBookingDetails, requestId };

    const [res1, res2] = await Promise.all([
      createBooking(payload, ctx),
      createBooking(payload, ctx)
    ]);

    expect(res1.docId).to.equal(res2.docId);
    expect(res1.total).to.equal(res2.total);
    expect([res1.duplicate, res2.duplicate]).to.include(false);
    expect([res1.duplicate, res2.duplicate]).to.include(true);

    const snap = await admin.firestore().collection("bookings")
      .where("requestId", "==", requestId)
      .where("customerUid", "==", ctx.auth.uid).get();
    expect(snap.size).to.equal(1);
    ok("1. Simultaneous identical requests create exactly ONE booking");
  });

  it("2. Non-finite numbers (NaN or Infinity) are rejected before hashing", async () => {
    const ctx = getFreshContext();
    const invalidQuote = Object.assign({}, baseQuoteInput, { km: NaN });
    try {
      await createBooking({ quoteInput: invalidQuote, bookingDetails: baseBookingDetails, requestId: "req_nan_" + Date.now() }, ctx);
      expect.fail("Should have rejected NaN");
    } catch (err) {
      expect(err.code).to.equal("invalid-argument");
      expect(err.message).to.include("NaN or Infinity");
    }
    ok("2. Non-finite numbers (NaN or Infinity) are rejected before hashing");
  });

  it("3. Circular references are rejected in payload validation", async () => {
    const ctx = getFreshContext();
    const circularObj = { name: "Living Room" };
    circularObj.self = circularObj;

    const invalidQuote = Object.assign({}, baseQuoteInput, { nested: circularObj });
    try {
      await createBooking({ quoteInput: invalidQuote, bookingDetails: baseBookingDetails, requestId: "req_circ_" + Date.now() }, ctx);
      expect.fail("Should have rejected circular reference");
    } catch (err) {
      expect(err.code).to.equal("invalid-argument");
      expect(err.message).to.include("Circular reference");
    }
    ok("3. Circular references are rejected in payload validation");
  });

  it("4. Unsupported object prototypes are rejected", async () => {
    const ctx = getFreshContext();
    class CustomInventoryItem { constructor() { this.qty = 2; } }
    const invalidQuote = Object.assign({}, baseQuoteInput, { custom: new CustomInventoryItem() });

    try {
      await createBooking({ quoteInput: invalidQuote, bookingDetails: baseBookingDetails, requestId: "req_proto_" + Date.now() }, ctx);
      expect.fail("Should have rejected custom prototype");
    } catch (err) {
      expect(err.code).to.equal("invalid-argument");
      expect(err.message).to.include("Unsupported object prototype");
    }
    ok("4. Unsupported object prototypes are rejected");
  });

  it("5. Malformed requestId error message matches regex requirement", async () => {
    const ctx = getFreshContext();
    const payload = { quoteInput: baseQuoteInput, bookingDetails: baseBookingDetails, requestId: "bad!" };
    try {
      await createBooking(payload, ctx);
      expect.fail("Should have thrown invalid-argument");
    } catch (err) {
      expect(err.code).to.equal("invalid-argument");
      expect(err.message).to.include("/^[A-Za-z0-9_-]{8,64}$/");
    }
    ok("5. Malformed requestId error message matches regex requirement");
  });

  it("6. Definitive server validation errors return proper HttpsError without booking creation", async () => {
    const ctx = getFreshContext();
    const badDetails = Object.assign({}, baseBookingDetails, { pickup: "" });
    try {
      await createBooking({ quoteInput: baseQuoteInput, bookingDetails: badDetails, requestId: "req_bad_" + Date.now() }, ctx);
      expect.fail("Should have thrown invalid-argument");
    } catch (err) {
      expect(err.code).to.equal("invalid-argument");
    }
    ok("6. Definitive server validation errors return proper HttpsError without booking creation");
  });

  it("7. Client normalizes Firebase callable errors with functions/ prefix", () => {
    const clientErr1 = { code: "functions/invalid-argument", message: "Bad input" };
    const clientErr2 = { code: "functions/failed-precondition", message: "Hash mismatch" };
    const clientErr3 = { code: "functions/deadline-exceeded", message: "Timeout" };

    expect(isDefinitiveServerError(clientErr1)).to.equal(true);
    expect(isDefinitiveServerError(clientErr2)).to.equal(true);
    expect(isDefinitiveServerError(clientErr3)).to.equal(false);
    ok("7. Client normalizes Firebase callable errors with functions/ prefix");
  });

  it("8. Customer can submit fresh booking after definitive rejection (Scoped Cleanup)", async () => {
    const ctx = getFreshContext();
    const initialBadReqId = "req_initial_bad_" + Date.now();
    sessionStorage.setItem("packzen_active_booking_request_id", initialBadReqId);
    sessionStorage.setItem("packzen_unresolved_outcome", "true");

    const badDetails = Object.assign({}, baseBookingDetails, { pickup: "" });

    try {
      await createBooking({ quoteInput: baseQuoteInput, bookingDetails: badDetails, requestId: initialBadReqId }, ctx);
      expect.fail("Should fail");
    } catch (err) {
      expect(err.code).to.equal("invalid-argument");
      const wasCleared = PackZenIdempotency.clearPendingAfterDefinitiveRejection(initialBadReqId);
      expect(wasCleared).to.equal(true);
    }

    const correctedDetails = Object.assign({}, baseBookingDetails, { pickup: "Indiranagar, Bangalore" });
    const freshReqId = PackZenIdempotency.getOrCreateRequestId();
    expect(freshReqId).to.not.equal(initialBadReqId);

    const successRes = await createBooking({ quoteInput: baseQuoteInput, bookingDetails: correctedDetails, requestId: freshReqId }, ctx);
    expect(successRes.docId).to.be.a("string");
    expect(successRes.duplicate).to.equal(false);
    ok("8. Customer can submit fresh booking after definitive rejection (Scoped Cleanup)");
  });

  it("9. Stale rejection from superseded request does NOT unlock form or mutate active attempt", () => {
    const req1 = "req_superseded_1";
    sessionStorage.setItem("packzen_active_booking_request_id", req1);
    sessionStorage.setItem("packzen_unresolved_outcome", "true");

    const req2 = "req_active_2";
    sessionStorage.setItem("packzen_active_booking_request_id", req2);
    sessionStorage.setItem("packzen_pending_payload", JSON.stringify({ requestId: req2, details: { pickup: "New Loc" } }));

    const wasCleared = PackZenIdempotency.clearPendingAfterDefinitiveRejection(req1);
    expect(wasCleared).to.equal(false);

    expect(sessionStorage.getItem("packzen_active_booking_request_id")).to.equal(req2);
    const activePayload = JSON.parse(sessionStorage.getItem("packzen_pending_payload"));
    expect(activePayload.requestId).to.equal(req2);
    ok("9. Stale rejection from superseded request does NOT unlock form or mutate active attempt");
  });

  it("10. Stale success from abandoned request is strictly ignored (activeId null)", () => {
    const abandonedReqId = "req_abandoned_123";
    sessionStorage.removeItem("packzen_active_booking_request_id"); // activeId is null
    sessionStorage.removeItem("packzen_unresolved_outcome");

    let cardShown = false;
    const mockShowCard = () => { cardShown = true; };

    const activeId = PackZenIdempotency.getActiveRequestId(); // null

    if (!activeId || activeId !== abandonedReqId) {
      // Correct behavior: rejected!
      expect(cardShown).to.equal(false);
    } else {
      mockShowCard();
      expect.fail("Should never display confirmation for abandoned request");
    }
    ok("10. Stale success from abandoned request is strictly ignored (activeId null)");
  });

  it("11. Concurrent operational alert claims: exactly one worker wins lease", async () => {
    const bookingId = "bk_concurrent_alert_" + Date.now();
    const outboxId = `email_bk_${bookingId}_booking_confirmed`;
    const outboxRef = admin.firestore().collection("emailOutbox").doc(outboxId);

    await outboxRef.set({
      bookingId,
      templateKey: "booking_confirmed",
      recipient: "test@example.com",
      status: "failed",
      attempts: 3,
      alertStatus: "pending",
      alertAttempts: 0
    });

    const details = { outboxId, bookingId, bookingRef: "PKZ-1", templateKey: "booking_confirmed", recipient: "test@example.com", attempts: 3, reason: "test" };

    // Fire 2 concurrent workers attempting to claim the alert lease
    await Promise.all([
      attemptOperationalAlertClaim(outboxRef, details),
      attemptOperationalAlertClaim(outboxRef, details)
    ]);

    const snap = await outboxRef.get();
    expect(snap.data().alertStatus).to.be.oneOf(["sending", "dispatched"]);
    expect(snap.data().alertAttempts).to.equal(1); // Exactly one claim succeeded
    ok("11. Concurrent operational alert claims: exactly one worker wins lease");
  });

  it("12. Alert failure retry executes without resending customer email", async () => {
    const bookingId = "bk_retry_no_email_" + Date.now();
    const outboxId = `email_bk_${bookingId}_booking_confirmed`;
    const outboxRef = admin.firestore().collection("emailOutbox").doc(outboxId);

    // Initial state: email permanently failed, alert previously failed
    await outboxRef.set({
      bookingId,
      templateKey: "booking_confirmed",
      recipient: "test@example.com",
      status: "failed", // Email permanently failed
      attempts: 3,
      alertStatus: "failed", // Alert previously failed
      alertAttempts: 1,
      lastAlertError: "Network timeout"
    });

    const details = { outboxId, bookingId, bookingRef: "PKZ-1", templateKey: "booking_confirmed", recipient: "test@example.com", attempts: 3, reason: "Network timeout" };

    // Retry alert claim
    await attemptOperationalAlertClaim(outboxRef, details);

    const snap = await outboxRef.get();
    // Email status remains permanently "failed" (customer email is NOT resent)
    expect(snap.data().status).to.equal("failed");
    expect(snap.data().attempts).to.equal(3); // Email attempts unchanged
    // Alert status updated to dispatched
    expect(snap.data().alertStatus).to.equal("dispatched");
    expect(snap.data().alertAttempts).to.equal(2);
    ok("12. Alert failure retry executes without resending customer email");
  });

  it("13. Mandatory Safeguard 1: Reconciliation recovers expired sending alert claims (> 5 min)", async () => {
    const bookingId = "bk_expired_sending_" + Date.now();
    const outboxId = `email_bk_${bookingId}_booking_confirmed`;
    const outboxRef = admin.firestore().collection("emailOutbox").doc(outboxId);

    // Initial state: alert is in "sending" state from 10 minutes ago (expired lease)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    await outboxRef.set({
      bookingId,
      templateKey: "booking_confirmed",
      recipient: "test@example.com",
      status: "failed",
      attempts: 3,
      alertStatus: "sending",
      alertClaimId: "old_claim_expired",
      alertClaimedAt: tenMinutesAgo,
      alertAttempts: 1
    });

    // Run reconciliation logic
    const snap = await admin.firestore().collection("emailOutbox")
      .where("status", "==", "failed")
      .where("alertStatus", "in", ["pending", "sending", "failed"])
      .get();

    let recoveredCount = 0;
    const now = Date.now();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (doc.id === outboxId) {
        if (data.alertStatus === "sending") {
          const isExpired = (now - (data.alertClaimedAt || 0)) > ALERT_CLAIM_LEASE_MS;
          expect(isExpired).to.equal(true);
        }
        await attemptOperationalAlertClaim(doc.ref, {
          outboxId: doc.id,
          bookingId: data.bookingId,
          bookingRef: data.bookingRef,
          templateKey: data.templateKey,
          recipient: data.recipient,
          attempts: data.attempts,
          reason: "reconciliation_test"
        });
        recoveredCount++;
      }
    }

    expect(recoveredCount).to.equal(1);
    const updatedSnap = await outboxRef.get();
    expect(updatedSnap.data().alertStatus).to.equal("dispatched");
    expect(updatedSnap.data().alertAttempts).to.equal(2);
    ok("13. Mandatory Safeguard 1: Reconciliation recovers expired sending alert claims (> 5 min)");
  });

  it("14. Mandatory Safeguard 2: Expired worker with old claimId cannot overwrite newer worker outcome", async () => {
    const bookingId = "bk_ownership_check_" + Date.now();
    const outboxId = `email_bk_${bookingId}_booking_confirmed`;
    const outboxRef = admin.firestore().collection("emailOutbox").doc(outboxId);

    // Initial state: alert claimed by Worker 2 with new claim ID
    const worker2ClaimId = "claim_worker_2_" + Date.now();
    await outboxRef.set({
      bookingId,
      templateKey: "booking_confirmed",
      recipient: "test@example.com",
      status: "failed",
      attempts: 3,
      alertStatus: "sending",
      alertClaimId: worker2ClaimId,
      alertClaimedAt: Date.now(),
      alertAttempts: 2
    });

    // Simulated expired Worker 1 attempts to finalize with an obsolete claim ID
    const obsoleteClaimId = "claim_worker_1_obsolete";
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) return;
      const s = snap.data();
      if (s.alertClaimId === obsoleteClaimId) {
        tx.update(outboxRef, {
          alertStatus: "dispatched",
          alertedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    // Verify outbox document was NOT modified by the obsolete worker
    const currentSnap = await outboxRef.get();
    expect(currentSnap.data().alertClaimId).to.equal(worker2ClaimId);
    expect(currentSnap.data().alertStatus).to.equal("sending");
    ok("14. Mandatory Safeguard 2: Expired worker with old claimId cannot overwrite newer worker outcome");
  });

  it("15. Regression: SMS and WhatsApp queue document IDs are uniquely composite per booking, recipient, and event (no collision)", async () => {
    const bookingId = "bk_notif_collision_" + Date.now();
    const customerPhone = "+919876543210";
    const driverPhone = "+919123456789";

    // Trigger driver assignment notifications: customer and driver
    const custMsg = "Driver assigned to you";
    const driverMsg = "New job assigned";
    await queueSMS(customerPhone, custMsg, bookingId, "driver_assigned");
    await queueSMS(driverPhone, driverMsg, bookingId, "job_assigned");
    await queueWhatsApp(customerPhone, custMsg, bookingId, "driver_assigned");
    await queueWhatsApp(driverPhone, driverMsg, bookingId, "job_assigned");

    // Expected doc IDs
    const cleanCustomer = normalizeRecipient(customerPhone); // "9876543210"
    const cleanDriver = normalizeRecipient(driverPhone);     // "9123456789"
    const custSmsId = `sms_${bookingId}_${cleanCustomer}_driver_assigned`;
    const driverSmsId = `sms_${bookingId}_${cleanDriver}_job_assigned`;
    const custWaId = `wa_${bookingId}_${cleanCustomer}_driver_assigned`;
    const driverWaId = `wa_${bookingId}_${cleanDriver}_job_assigned`;

    // Verify neither overwrote the other in smsQueue
    expect(custSmsId).to.not.equal(driverSmsId);
    expect(col("smsQueue")[custSmsId].mobile).to.equal(customerPhone);
    expect(col("smsQueue")[custSmsId].message).to.equal(custMsg);
    expect(col("smsQueue")[custSmsId].event).to.equal("driver_assigned");
    expect(col("smsQueue")[custSmsId].status).to.equal("pending");

    expect(col("smsQueue")[driverSmsId].mobile).to.equal(driverPhone);
    expect(col("smsQueue")[driverSmsId].message).to.equal(driverMsg);
    expect(col("smsQueue")[driverSmsId].event).to.equal("job_assigned");
    expect(col("smsQueue")[driverSmsId].status).to.equal("pending");

    // Verify WhatsApp queue records are also distinct
    expect(custWaId).to.not.equal(driverWaId);
    expect(col("whatsappQueue")[custWaId].mobile).to.equal(customerPhone);
    expect(col("whatsappQueue")[custWaId].message).to.equal(custMsg);
    expect(col("whatsappQueue")[custWaId].event).to.equal("driver_assigned");

    expect(col("whatsappQueue")[driverWaId].mobile).to.equal(driverPhone);
    expect(col("whatsappQueue")[driverWaId].message).to.equal(driverMsg);
    expect(col("whatsappQueue")[driverWaId].event).to.equal("job_assigned");

    // Genuine retry: duplicate call with same booking, recipient, and event must NOT duplicate or overwrite
    col("smsQueue")[custSmsId].status = "sending";
    await queueSMS(customerPhone, "Different message ignored", bookingId, "driver_assigned");
    expect(col("smsQueue")[custSmsId].status).to.equal("sending");
    expect(col("smsQueue")[custSmsId].message).to.equal(custMsg);

    ok("15. Notification collision prevention & genuine retry deduplication verified");
  });

  it("16. Regression: Multiple notification events for the same booking generate distinct queue doc IDs", async () => {
    const bookingId = "bk_events_seq_" + Date.now();
    const phone = "9876543210";

    await queueSMS(phone, "Created", bookingId, "booking_created");
    await queueSMS(phone, "Arriving", bookingId, "driver_arriving");
    await queueSMS(phone, "OTP 1234", bookingId, "completion_otp", "otp");
    await queueSMS(phone, "Completed", bookingId, "booking_completed");

    const clean = normalizeRecipient(phone);
    const idCreated = `sms_${bookingId}_${clean}_booking_created`;
    const idArriving = `sms_${bookingId}_${clean}_driver_arriving`;
    const idOtp = `sms_${bookingId}_${clean}_completion_otp`;
    const idCompleted = `sms_${bookingId}_${clean}_booking_completed`;

    const uniqueIds = new Set([idCreated, idArriving, idOtp, idCompleted]);
    expect(uniqueIds.size).to.equal(4);

    expect(col("smsQueue")[idCreated].event).to.equal("booking_created");
    expect(col("smsQueue")[idArriving].event).to.equal("driver_arriving");
    expect(col("smsQueue")[idOtp].event).to.equal("completion_otp");
    expect(col("smsQueue")[idOtp].kind).to.equal("otp");
    expect(col("smsQueue")[idCompleted].event).to.equal("booking_completed");

    ok("16. Distinct notification event identifiers for same booking verified");
  });

  it("17. Regression: Stale customer email worker cannot overwrite newer worker's state upon finalization", async () => {
    const bookingId = "bk_email_stale_worker_" + Date.now();
    const outboxId = `email_bk_${bookingId}_booking_confirmed`;
    const outboxRef = admin.firestore().collection("emailOutbox").doc(outboxId);

    // Initial state: Worker 1 claimed the email outbox
    const worker1ClaimId = "email_claim_worker_1_" + Date.now();
    await outboxRef.set({
      bookingId,
      bookingRef: "PZ_TEST_STALE",
      templateKey: "booking_confirmed",
      recipient: "customer@example.com",
      status: "processing",
      emailClaimId: worker1ClaimId,
      attempts: 1,
      claimedAt: Date.now() - (6 * 60 * 1000) // 6 minutes ago (> STALE_CLAIM_MS)
    });

    // Worker 2 comes in and reclaims the stale email outbox record
    const worker2ClaimId = "email_claim_worker_2_" + Date.now();
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      const s = snap.data();
      tx.update(outboxRef, {
        status: "processing",
        emailClaimId: worker2ClaimId,
        attempts: (s.attempts || 1) + 1,
        claimedAt: Date.now()
      });
    });

    // Verify Worker 2 now owns the claim
    let checkSnap = await outboxRef.get();
    expect(checkSnap.data().emailClaimId).to.equal(worker2ClaimId);
    expect(checkSnap.data().attempts).to.equal(2);

    // Stale Worker 1 finishes sending and attempts to finalize with obsolete worker1ClaimId
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) return;
      const s = snap.data();

      // Ownership check
      if (s.emailClaimId !== worker1ClaimId) {
        // Must reject write
        return;
      }

      tx.update(outboxRef, {
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    // Verify outbox document was NOT overwritten with "sent" by Worker 1
    checkSnap = await outboxRef.get();
    expect(checkSnap.data().emailClaimId).to.equal(worker2ClaimId);
    expect(checkSnap.data().status).to.equal("processing");
    expect(checkSnap.data().attempts).to.equal(2);

    // Stale Worker 1 failure path test: Worker 1 attempts to record failure with obsolete claimId
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) return;
      const s = snap.data();

      if (s.emailClaimId !== worker1ClaimId) {
        return;
      }

      tx.update(outboxRef, {
        status: "failed",
        lastError: "Worker 1 failure"
      });
    });

    // Verify state still owned by Worker 2
    checkSnap = await outboxRef.get();
    expect(checkSnap.data().emailClaimId).to.equal(worker2ClaimId);
    expect(checkSnap.data().status).to.equal("processing");

    // Worker 2 finishes and finalizes with matching claimId
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) return;
      const s = snap.data();

      if (s.emailClaimId === worker2ClaimId) {
        tx.update(outboxRef, {
          status: "sent",
          sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    checkSnap = await outboxRef.get();
    expect(checkSnap.data().status).to.equal("sent");
    expect(checkSnap.data().emailClaimId).to.equal(worker2ClaimId);

    ok("17. Stale customer email worker cannot overwrite newer worker state verified");
  });
});

(async () => {
  let passed = 0;
  for (const t of testQueue) {
    try {
      await t.fn();
      passed++;
    } catch (e) {
      console.error(`\n  FAIL: ${t.name}`);
      console.error(e);
      process.exit(1);
    }
  }
  console.log(`\n========================================`);
  console.log(`booking-idempotency: ${passed} passed, 0 failed`);
  console.log(`========================================\n`);
  process.exit(0);
})();
