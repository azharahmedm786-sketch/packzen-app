process.env.GCLOUD_PROJECT = "packzen-e7539";
process.env.RAZORPAY_KEY_ID = "rzp_test_x"; process.env.RAZORPAY_KEY_SECRET = "sekret";
const assert = require("assert"); const crypto = require("crypto");
const admin = require("firebase-admin");
admin.initializeApp();

// ── in-memory Firestore ──
const store = {}; let seq = 0;
const col = n => (store[n] = store[n] || {});
function makeDb(){
  const db = {
    collection: n => ({
      doc: id => { id = id || ("auto"+(++seq)); return { _n:n, id, set: async d=>{ col(n)[id]=d; }, get: async()=>({exists: !!col(n)[id], id, data:()=>col(n)[id]}) }; },
      add: async d => { const id="auto"+(++seq); col(n)[id]=d; return {id}; },
      where: (f,op,v)=>{ const filters=[[f,v]]; const q={ where:(f2,o,v2)=>{filters.push([f2,v2]);return q;}, limit:()=>q,
        get: async()=>{ const docs=Object.entries(col(n)).filter(([,d])=>filters.every(([ff,vv])=>d[ff]===vv)).map(([id,d])=>({id,data:()=>d})); return {empty:!docs.length,docs}; } }; return q; }
    }),
    getAll: async (...refs)=> refs.map(r=>({exists:!!col(r._n)[r.id], id:r.id, data:()=>col(r._n)[r.id]})),
    runTransaction: async fn => fn({
      get: async ref=>({exists:!!col(ref._n)[ref.id], data:()=>col(ref._n)[ref.id]}),
      set: (ref,d)=>{ col(ref._n)[ref.id]=d; }, delete: ref=>{ delete col(ref._n)[ref.id]; },
      update: (ref,d)=>{ Object.assign(col(ref._n)[ref.id],d); },
      create: (ref,d)=>{ if (col(ref._n)[ref.id]) throw new Error("ALREADY_EXISTS"); col(ref._n)[ref.id]=d; } })
  };
  return db;
}
const fakeDb = makeDb();
const fs = () => fakeDb; fs.FieldValue = { serverTimestamp: () => "TS" };
Object.defineProperty(admin, "firestore", { value: fs, configurable: true });
let tokenUid = "uid1";
Object.defineProperty(admin, "auth", { value: () => ({ verifyIdToken: async t => { if(t!=="good") throw new Error("bad"); return {uid:tokenUid}; } }), configurable:true });

// fake Razorpay
const PAYMENTS = {};
require.cache[require.resolve("razorpay")] = { exports: function(){ this.orders={ create: async o=>({id:"order_TEST0001",amount:o.amount,currency:o.currency}) }; this.payments={ fetch: async id=>{ if(!PAYMENTS[id]) throw new Error("not found"); return PAYMENTS[id]; } }; }, loaded:true, id:"x", filename:"x", children:[], paths:[] };

col("serviceCategories")["ac-services"]={isActive:true,name:"AC"}; col("serviceCategories")["moving"]={isActive:true};
col("addons")["ac-installation"]={isActive:true,categoryId:"ac-services",name:"AC Install",basePrice:1400,pricingUnit:"per_item"};
col("services")["local"]={isActive:true,categoryId:"moving",name:"Local",basePrice:1999,pricingUnit:"starting_from"};

const fns = require("../catalog-booking.js");
const details = {customerName:"Asha",phone:"9845095453",email:"",address:"12 MG Road Bangalore",date:new Date(Date.now()+5.5*3600e3+10*864e5).toISOString().slice(0,10),timeSlot:"morning",notes:""};
const res = () => { const r={headers:{}, code:200, body:null, set(k,v){r.headers[k]=v;}, status(c){r.code=c;return r;}, json(b){r.body=b;return r;}, send(b){r.body=b;return r;}, getHeader(){}, setHeader(){}, end(){}}; return r; };
const call = async (fn, body, token="good") => { const r=res(); await fn({method:"POST",headers:{authorization:"Bearer "+token,origin:"https://packzenblr.in"},body}, r); await new Promise(x=>setTimeout(x,20)); return r; };

(async()=>{
  // callable: unauthenticated rejected
  await assert.rejects(()=>fns.createServiceBooking.run({requestId:"req-00001",items:[],details},{}), /sign in/i);
  // pay-later, definite price → confirmed, server total
  let out = await fns.createServiceBooking.run({requestId:"req-00001",items:[{type:"addons",id:"ac-installation",qty:2,basePrice:1}],details,total:1},{auth:{uid:"uid1"}});
  assert.strictEqual(out.status,"confirmed"); assert.strictEqual(out.total,2800);
  const saved = Object.values(col("bookings"))[0]; assert.strictEqual(saved.paid,0); assert.strictEqual(saved.paymentStatus,"unpaid"); assert.strictEqual(saved.customerUid,"uid1"); assert.strictEqual(saved.moveType,"service"); assert.strictEqual(saved.drop,"");
  // idempotent
  out = await fns.createServiceBooking.run({requestId:"req-00001",items:[{type:"addons",id:"ac-installation"}],details},{auth:{uid:"uid1"}});
  assert(out.duplicate); assert.strictEqual(Object.keys(col("bookings")).length,1);
  // estimate → pending
  out = await fns.createServiceBooking.run({requestId:"req-00002",items:[{type:"services",id:"local"}],details},{auth:{uid:"uid1"}});
  assert.strictEqual(out.status,"pending");
  // bad details rejected
  await assert.rejects(()=>fns.createServiceBooking.run({requestId:"req-00003",items:[{type:"addons",id:"ac-installation"}],details:{...details,phone:"1"}},{auth:{uid:"uid1"}}), /mobile/i);

  // online order: unauthenticated / invalid token
  assert.strictEqual((await call(fns.createServiceRazorpayOrder,{},"nope")).code,401);
  // estimate item not payable online
  let r = await call(fns.createServiceRazorpayOrder,{requestId:"req-00004",items:[{type:"services",id:"local"}],details}); assert.strictEqual(r.code,400); assert(/Pay on service/.test(r.body.error));
  // good order -> amount from server, pending stored in the SHARED pendingPayments (flow:"service")
  r = await call(fns.createServiceRazorpayOrder,{requestId:"req-00005",items:[{type:"addons",id:"ac-installation",qty:2}],details,amount:1,total:1});
  assert.strictEqual(r.code,200,JSON.stringify(r.body)); assert.strictEqual(r.body.amount,280000); assert.strictEqual(r.body.orderId,"order_TEST0001");
  const pend = col("pendingPayments")["order_TEST0001"];
  assert.strictEqual(pend.flow,"service"); assert.strictEqual(pend.payNow,2800); assert.strictEqual(pend.grandTotal,2800);
  assert.strictEqual(pend.uid,"uid1"); assert.strictEqual(pend.status,"created"); assert(!("email" in (pend.details||{})),"typed email not trusted");
  assert(!col("pendingServicePayments")["order_TEST0001"],"no new legacy pending docs");

  const sig = id => crypto.createHmac("sha256","sekret").update("order_TEST0001|"+id).digest("hex");
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_TEST0001",razorpay_payment_id:"pay_1abcdef",razorpay_signature:"0".repeat(64)}); assert.strictEqual(r.code,400);
  PAYMENTS["pay_1abcdef"]={id:"pay_1abcdef",order_id:"order_TEST0001",amount:280000,currency:"INR",status:"captured"};
  tokenUid="uid2"; r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_TEST0001",razorpay_payment_id:"pay_1abcdef",razorpay_signature:sig("pay_1abcdef")}); assert.strictEqual(r.code,403); assert(col("pendingPayments")["order_TEST0001"]);
  tokenUid="uid1";
  PAYMENTS["pay_1abcdef"].status="authorized";
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_TEST0001",razorpay_payment_id:"pay_1abcdef",razorpay_signature:sig("pay_1abcdef")});
  assert.strictEqual(r.code,202); assert(!col("bookings")["order_TEST0001"]);
  PAYMENTS["pay_1abcdef"].status="captured"; PAYMENTS["pay_1abcdef"].amount=100;
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_TEST0001",razorpay_payment_id:"pay_1abcdef",razorpay_signature:sig("pay_1abcdef")});
  assert.strictEqual(r.code,400); assert(!col("bookings")["order_TEST0001"]);
  PAYMENTS["pay_1abcdef"].amount=280000;
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_TEST0001",razorpay_payment_id:"pay_1abcdef",razorpay_signature:sig("pay_1abcdef")});
  assert.strictEqual(r.code,200,JSON.stringify(r.body)); const ref1=r.body.bookingRef;
  const paid = col("bookings")["order_TEST0001"];
  assert.strictEqual(paid.bookingType,"service"); assert.strictEqual(paid.paid,2800); assert.strictEqual(paid.total,2800); assert.strictEqual(paid.balanceDue,0);
  assert.strictEqual(paid.paymentStatus,"paid"); assert.strictEqual(paid.status,"confirmed"); assert.strictEqual(paid.customerUid,"uid1"); assert.strictEqual(paid.orderId,"order_TEST0001");
  assert.strictEqual(col("pendingPayments")["order_TEST0001"].status,"consumed");
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_TEST0001",razorpay_payment_id:"pay_1abcdef",razorpay_signature:sig("pay_1abcdef")});
  assert.strictEqual(r.code,200); assert.strictEqual(r.body.bookingRef,ref1); assert.strictEqual(r.body.duplicate,true);
  assert.strictEqual(Object.values(col("bookings")).filter(b=>b.paymentId==="pay_1abcdef").length,1);
  const sig2 = crypto.createHmac("sha256","sekret").update("order_9zzzzz|pay_9zzzzzz").digest("hex");
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_9zzzzz",razorpay_payment_id:"pay_9zzzzzz",razorpay_signature:sig2}); assert(r.code>=400 && r.code<500);

  // legacy drain: orders created before this release (pendingServicePayments) are now capture-checked
  col("pendingServicePayments")["order_LEGACY1"]={uid:"uid1",amount:1400,requestId:"req-legacy",details,lines:[{type:"addons",id:"ac-installation",name:"AC Install",qty:1,unitPrice:1400,lineTotal:1400}],estimatedTotal:1400};
  const sigL = crypto.createHmac("sha256","sekret").update("order_LEGACY1|pay_LEGACY01").digest("hex");
  PAYMENTS["pay_LEGACY01"]={id:"pay_LEGACY01",order_id:"order_LEGACY1",amount:140000,currency:"INR",status:"authorized"};
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_LEGACY1",razorpay_payment_id:"pay_LEGACY01",razorpay_signature:sigL});
  assert.strictEqual(r.code,202); assert(col("pendingServicePayments")["order_LEGACY1"]);
  PAYMENTS["pay_LEGACY01"].status="captured";
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_LEGACY1",razorpay_payment_id:"pay_LEGACY01",razorpay_signature:sigL});
  assert.strictEqual(r.code,200,JSON.stringify(r.body)); assert(col("bookings")["order_LEGACY1"],"legacy booking id = order id");
  assert.strictEqual(col("bookings")["order_LEGACY1"].balanceDue,0);
  console.log("ALL HANDLER TESTS PASSED");
})().catch(e=>{console.error("FAIL:",e);process.exit(1)});
