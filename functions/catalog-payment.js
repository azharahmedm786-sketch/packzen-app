/**
 * PackZen — catalog (service) online payments on the shared payment core
 * ----------------------------------------------------------------------
 * Order creation for catalog carts. Verification, capture check, idempotent
 * booking creation (booking id = Razorpay order id), webhook and hourly
 * reconciliation are the SAME code as moving payments (move-payment.js →
 * finalizeCapture, payment-webhook.js), driven by `flow: "service"` on the
 * pending payment document in `pendingPayments`.
 *
 * deps: { verifyIdToken, db, loadCatalog(items), priceCart, validateDetails,
 *         validRequestId, createOrder, serverTimestamp(), now(), logger,
 *         rateLimit?(uid, req), recordFailure?(source, code) }
 */
"use strict";

const mp = require("./move-payment");

const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_ONLINE = "These items need a quote or final price first, so they can't be paid online. Choose “Pay on service” instead.";

async function handleCreateServiceOrder(req, deps) {
  const logger = deps.logger || console;
  let ctx = {};
  try {
    const user = await mp.authenticate(req, deps.verifyIdToken);
    ctx = { uid: user.uid };
    if (deps.rateLimit) {
      const rl = await deps.rateLimit(user.uid, req);
      if (!rl.ok) return { status: 429, body: { success: false, code: "rate_limited", error: mp.MSG.rateLimited } };
    }
    const body = req.body || {};
    if (!deps.validRequestId(body.requestId)) return { status: 400, body: { success: false, code: "invalid_input", error: "Missing request id." } };

    const catalog = await deps.loadCatalog(body.items);
    const cart = deps.priceCart(catalog, body.items);
    const det = deps.validateDetails(body.details);
    if (!cart.ok) return { status: 400, body: { success: false, code: "invalid_cart", error: cart.errors.join(" ") } };
    if (!det.ok) return { status: 400, body: { success: false, code: "invalid_details", error: det.errors.join(" ") } };
    if (!cart.onlineEligible) return { status: 400, body: { success: false, code: "not_online_eligible", error: NOT_ONLINE } };

    const amount = Math.round(Number(cart.payableNow)); // ₹, server-computed only
    if (!Number.isFinite(amount) || amount <= 0 || amount > mp.MAX_ONLINE_AMOUNT) {
      return { status: 400, body: { success: false, code: "invalid_amount", error: "This cart can't be paid online. Please contact us." } };
    }

    const nowMs = deps.now();
    const order = await deps.createOrder({ amount: amount * 100, currency: mp.CURRENCY, receipt: "svc_" + nowMs,
                                           notes: { uid: user.uid, requestId: body.requestId, flow: "service" } });
    if (!order || !order.id || Number(order.amount) !== amount * 100 || order.currency !== mp.CURRENCY) throw new Error("order creation returned unexpected data");
    ctx.orderId = order.id;

    const details = Object.assign({}, det.value);
    delete details.email; // the browser-typed email is never used for a paid booking
    await deps.db.collection(mp.PENDING_COLLECTION).doc(order.id).set({
      flow: "service",
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      orderId: order.id,
      requestId: body.requestId,
      paymentType: "full",
      grandTotal: amount,
      payNow: amount,
      amount,
      currency: mp.CURRENCY,
      details,
      lines: cart.lines.map((l) => ({ type: l.type, id: l.id, name: l.name, categoryId: l.categoryId, qty: l.qty,
                                      pricingUnit: l.pricingUnit, unitPrice: l.unitPrice, lineTotal: l.lineTotal, kind: l.kind })),
      estimatedTotal: cart.estimatedTotal,
      status: "created",
      createdAt: deps.serverTimestamp(),
      expiresAt: new Date(nowMs + ORDER_TTL_MS),
    });
    logger.info("service_order_created", { uid: user.uid, orderId: order.id, amount });
    return { status: 200, body: { success: true, orderId: order.id, amount: order.amount, currency: order.currency, serverCalculatedTotal: amount } };
  } catch (err) {
    if (err instanceof mp.PaymentError) {
      logger.warn("service_order_rejected", Object.assign({ code: err.code }, ctx));
      return { status: err.status, body: { success: false, code: err.code, error: err.publicMessage } };
    }
    logger.error("service_order_error", Object.assign({ message: String(err && err.message).slice(0, 120) }, ctx));
    if (deps.recordFailure) await deps.recordFailure("createServiceRazorpayOrder", "server_error");
    return { status: 500, body: { success: false, code: "server_error", error: "Could not start payment. Please try again." } };
  }
}

module.exports = { handleCreateServiceOrder };
