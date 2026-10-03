# 🚚 PackZen – Packers & Movers Platform

> A modern, full-stack Packers & Movers booking platform built for Bangalore with real-time pricing, secure authentication, online payments, live booking management, and an admin dashboard.

![Status](https://img.shields.io/badge/Status-Production%20Ready-success)
![Firebase](https://img.shields.io/badge/Firebase-v9-orange)
![License](https://img.shields.io/badge/License-MIT-blue)
![Responsive](https://img.shields.io/badge/Mobile-Friendly-success)

---

# 🌐 Live Website

**https://packzenblr.in**

---

# 📖 About

PackZen is a complete relocation management platform that allows customers to instantly book home shifting, office relocation, vehicle transport, parcel delivery, and packing services online.

The platform includes:

- Customer Booking Portal
- Secure Authentication
- Admin Dashboard
- Driver Dashboard
- Advisor Dashboard
- Firebase Backend
- Razorpay Payment Gateway
- Google Maps Integration
- Automated Pricing Engine
- OTP Email Verification
- Real-time Booking Management

---

# ✨ Features

## Customer

- Instant Moving Quote
- Multi-step Booking Form
- Google Address Autocomplete
- Distance Calculation
- Live Pricing
- Email OTP Verification
- Google Sign In
- Booking History
- Online Payment
- Advance Payment Option
- Responsive Mobile UI
- FAQ
- Reviews
- Pricing Calculator

---

## Admin

- Complete Booking Management
- Customer Management
- Driver Assignment
- Booking Status Updates
- Revenue Dashboard
- Firestore Integration
- Analytics
- Secure Admin Login

---

## Driver

- Driver Login
- Assigned Jobs
- Booking Details
- Update Job Status
- Customer Information

---

## Advisor

- Lead Management
- Customer Follow-up
- Quote Generation
- Booking Assistance

---

# 🛠 Tech Stack

## Frontend

- HTML5
- CSS3
- JavaScript (Vanilla)

## Backend

- Firebase Authentication
- Cloud Firestore
- Firebase Functions
- Firebase Hosting

## Integrations

- Razorpay
- Google Maps API
- Google Places API
- Distance Matrix API
- Brevo Email API

---

# 🔒 Security

- Firebase Authentication
- Email OTP Verification
- Google Authentication
- Firestore Security Rules
- App Check
- Rate Limiting
- Input Validation
- Secure Cloud Functions
- Protected Admin Routes

---

# 📂 Project Structure

```
/
│
├── index.html
├── admin.html
├── advisor.html
├── driver.html
├── parcel.html
├── pricing.html
├── services.html
├── reviews.html
├── faq.html
├── style.css
├── script.js
├── images/
├── public/
├── functions/
├── firebase.json
└── README.md
```

---

# 🚀 Installation

Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
```

Install Firebase Functions

```bash
cd functions
npm install
```

Deploy

```bash
firebase deploy
```

Run locally

```bash
firebase emulators:start
```

---

# 📦 Services

- Home Shifting
- Office Relocation
- Bike Transport
- Car Transport
- Parcel Delivery
- Packing & Unpacking
- Loading & Unloading
- Storage Solutions

---

# 📱 Responsive

Optimized for

- Desktop
- Laptop
- Tablet
- Android
- iPhone

---

# 🎯 Current Features

- ✅ Online Booking
- ✅ Instant Quote
- ✅ Google Login
- ✅ Email OTP Authentication
- ✅ Razorpay Payments
- ✅ Booking Dashboard
- ✅ Driver Dashboard
- ✅ Advisor Dashboard
- ✅ Firebase Backend
- ✅ Responsive Design
- ✅ Google Maps Integration

---

# 🚧 Upcoming Features

- Live Driver Tracking
- WhatsApp Notifications
- SMS Notifications
- AI Moving Assistant
- Referral Program
- Coupons & Promotions
- Customer Loyalty Program
- Route Optimization

---

# 🤝 Contributing

Contributions are welcome.

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to your branch
5. Open a Pull Request

---

# 📄 License

This project is licensed under the MIT License.

---

# 👨‍💻 Developed By

**PackZen Technologies**

🌐 https://packzenblr.in

---

### Move Smarter. Move Safer. 🚚
PackZen catalog update — drop-in files
======================================
Folder layout matches your repo root. Copy these three folders INTO the repo
(replace when asked), keeping the folder names exactly:

  public/     -> website files (this is the folder Firebase Hosting deploys)
  functions/  -> Cloud Functions (new booking + payment functions, tests)
  tools/      -> seedCatalog.js

firestore.rules is already updated in your repo (the catalog block is live there).

Then, from the repo folder:
  1. cd functions && npm install && npm test        (expect two PASSED lines)
  2. Seed the catalog once:  node ../tools/seedCatalog.js --dry-run   then without --dry-run
  3. firebase deploy --only firestore:rules,functions,hosting
