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
      set: (ref,d)=>{ col(ref._n)[ref.id]=d; }, delete: ref=>{ delete col(ref._n)[ref.id]; } })
  };
  return db;
}
const fakeDb = makeDb();
const fs = () => fakeDb; fs.FieldValue = { serverTimestamp: () => "TS" };
Object.defineProperty(admin, "firestore", { value: fs, configurable: true });
let tokenUid = "uid1";
Object.defineProperty(admin, "auth", { value: () => ({ verifyIdToken: async t => { if(t!=="good") throw new Error("bad"); return {uid:tokenUid}; } }), configurable:true });

// fake Razorpay
require.cache[require.resolve("razorpay")] = { exports: function(){ this.orders={ create: async o=>({id:"order_1",amount:o.amount,currency:o.currency}) }; }, loaded:true, id:"x", filename:"x", children:[], paths:[] };

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
  // good order → amount from server, pending stored
  r = await call(fns.createServiceRazorpayOrder,{requestId:"req-00005",items:[{type:"addons",id:"ac-installation",qty:2}],details,amount:1,total:1});
  assert.strictEqual(r.code,200); assert.strictEqual(r.body.amount,280000); assert.strictEqual(r.body.orderId,"order_1");
  assert.strictEqual(col("pendingServicePayments")["order_1"].amount,2800);

  // verify: bad signature
  const sig = id => crypto.createHmac("sha256","sekret").update("order_1|"+id).digest("hex");
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_1",razorpay_payment_id:"pay_1",razorpay_signature:"deadbeef"}); assert.strictEqual(r.code,400);
  // verify: other user's account blocked, and pending survives
  tokenUid="uid2"; r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_1",razorpay_payment_id:"pay_1",razorpay_signature:sig("pay_1")}); assert.strictEqual(r.code,403); assert(col("pendingServicePayments")["order_1"]);
  tokenUid="uid1";
  // verify: success creates a paid booking once; retry returns same ref
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_1",razorpay_payment_id:"pay_1",razorpay_signature:sig("pay_1")});
  assert.strictEqual(r.code,200,JSON.stringify(r.body)); const ref1=r.body.bookingRef;
  const paid = Object.values(col("bookings")).find(b=>b.paymentId==="pay_1"); assert.strictEqual(paid.paid,2800); assert.strictEqual(paid.paymentStatus,"paid"); assert.strictEqual(paid.status,"confirmed"); assert(!col("pendingServicePayments")["order_1"]);
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_1",razorpay_payment_id:"pay_1",razorpay_signature:sig("pay_1")});
  assert.strictEqual(r.code,200); assert.strictEqual(r.body.bookingRef,ref1);
  assert.strictEqual(Object.values(col("bookings")).filter(b=>b.paymentId==="pay_1").length,1);
  // unknown order with valid signature
  const sig2 = crypto.createHmac("sha256","sekret").update("order_9|pay_9").digest("hex");
  r = await call(fns.verifyServiceRazorpayPayment,{razorpay_order_id:"order_9",razorpay_payment_id:"pay_9",razorpay_signature:sig2}); assert.strictEqual(r.code,400);
  console.log("ALL HANDLER TESTS PASSED");
})().catch(e=>{console.error("FAIL:",e);process.exit(1)});
