/**
 * Shared by staff ("advisor") bookings for moves and home services.
 *  staffRoleOf(admin, context) → "admin" | "manager" | "advisor" | other/null
 *  resolveCustomer(admin, {name, phone, email}, staffUid) → { customerUid, accountCreated, setPasswordLink }
 *    e-mail → existing customer account or a new one (+ set-password link);
 *    no e-mail → existing customer matched by phone; else guest (null).
 */
"use strict";
const OWNER_EMAILS = ["azharahmedm786@gmail.com", "azharahmednaz@gmail.com", "moveeasyblr@gmail.com"]; // = firestore.rules isAdmin
const STAFF_ROLES = ["admin", "manager", "advisor"];

async function staffRoleOf(admin, context) {
  if (!context || !context.auth) return null;
  const t = context.auth.token || {};
  if (OWNER_EMAILS.includes(String(t.email || "").toLowerCase()) && t.email_verified === true) return "admin";
  const u = await admin.firestore().collection("users").doc(context.auth.uid).get();
  return u.exists ? (u.data() || {}).role || null : null;
}

class StaffCustomerError extends Error { constructor(code, msg) { super(msg); this.code = code; this.publicMessage = msg; } }

async function resolveCustomer(admin, { name, phone, email }, staffUid) {
  const db = admin.firestore();
  if (email) {
    let u = null; try { u = await admin.auth().getUserByEmail(email); } catch (e) { u = null; }
    if (u) {
      const ud = await db.collection("users").doc(u.uid).get();
      const r = ud.exists ? (ud.data() || {}).role : null;
      if (r && r !== "customer") throw new StaffCustomerError("failed-precondition", "That e-mail belongs to a staff or partner account. Use the customer's own e-mail.");
      return { customerUid: u.uid, accountCreated: false, setPasswordLink: null };
    }
    u = await admin.auth().createUser({ email, displayName: name, password: require("crypto").randomBytes(18).toString("base64url") });
    await db.collection("users").doc(u.uid).set({ name, email, phone, role: "customer", createdByStaff: staffUid, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    let link = null; try { link = await admin.auth().generatePasswordResetLink(email); } catch (e) { link = null; }
    return { customerUid: u.uid, accountCreated: true, setPasswordLink: link };
  }
  const byPhone = await db.collection("users").where("phone", "==", phone).limit(3).get();
  const cust = byPhone.docs.find((x) => ((x.data() || {}).role || "customer") === "customer");
  return { customerUid: cust ? cust.id : null, accountCreated: false, setPasswordLink: null };
}

function cleanContact(d) {
  return {
    name: String((d && (d.customerName || d.name)) || "").replace(/[<>]/g, "").trim().slice(0, 80),
    phone: String((d && d.phone) || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""),
    email: String((d && d.email) || "").trim().toLowerCase().slice(0, 120),
  };
}

module.exports = { staffRoleOf, resolveCustomer, cleanContact, StaffCustomerError, STAFF_ROLES, OWNER_EMAILS };
