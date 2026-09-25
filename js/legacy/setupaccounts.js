// PackZen — setup-accounts.js
// Run ONCE in browser console on index.html to create admin & driver accounts

(async function setupPackZenAccounts() {
  if (!window._firebase) { console.error("Firebase not loaded. Open index.html first."); return; }
  const { auth, db } = window._firebase;

  async function createAccount(email, password, role, name, phone) {
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      const refCode = role === "driver" ? "DRV" + cred.user.uid.slice(0,5).toUpperCase() : "ADMIN";
      await db.collection("users").doc(cred.user.uid).set({
        name, email, phone, role,
        isOnline: false,
        currentBooking: null,
        referralCode: refCode,
        referralCount: 0,
        referralCredits: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log(`✅ ${role.toUpperCase()} created: ${email}`);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") console.log(`ℹ️ ${email} already exists (OK)`);
      else console.error(`❌ Failed ${email}:`, e.message);
    }
  }

  // Seed promo codes
  async function seedPromos() {
    const promos = [
      { code: "WELCOME200", type: "flat",    value: 200, max: 500, active: true },
      { code: "SAVE10",     type: "percent", value: 10,  max: 100, active: true },
      { code: "FIRST500",   type: "flat",    value: 500, max: 50,  active: true },
    ];
    for (const p of promos) {
      const doc = await db.collection("promos").doc(p.code).get();
      if (!doc.exists) {
        await db.collection("promos").doc(p.code).set({ ...p, used: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        console.log("✅ Promo created:", p.code);
      } else {
        console.log("ℹ️ Promo exists:", p.code);
      }
    }
  }

  // Create accounts
  await createAccount("admin@packzen.com",  "Admin@123",  "admin",  "Admin",       "9945095453");
  await createAccount("driver@packzen.com", "Driver@123", "driver", "Ravi Kumar",  "9876543210");
  await seedPromos();
  await auth.signOut();

  console.log("\n🎉 Setup complete!");
  console.log("─────────────────────────────");
  console.log("Admin:  admin@packzen.com / Admin@123");
  console.log("Driver: driver@packzen.com / Driver@123");
  console.log("─────────────────────────────");
  console.log("Promo codes: WELCOME200, SAVE10, FIRST500");
  console.log("─────────────────────────────");
  console.log("Open admin.html → log in as admin");
  console.log("Open driver.html → log in as driver");
})();
