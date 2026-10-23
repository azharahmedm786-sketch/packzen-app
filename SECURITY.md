# PackZen — security setup (manual console steps)

The website is static (GitHub Pages, optionally behind Cloudflare). **Security is
enforced on the server**: Firestore rules, Storage rules and Cloud Functions. Client-side
checks (admin sign-in gate, hidden buttons) are convenience only.

## What is already in the code
- **Firestore rules** (`firestore.rules`): every collection locked to its owner, assigned
  driver, staff role or the admin e-mail allow-list (`isAdmin()`); bookings cannot be
  deleted by customers; prices, payments and statuses are written only by Cloud Functions.
- **Storage rules** (`storage.rules`): partner KYC readable only by the owner and admins.
- **Admin pages**: `admin.html` renders nothing until Firebase Auth confirms an allow-listed
  admin; `leads-app/` requires an admin/manager/advisor role.
- **Payments**: Razorpay orders are created and **verified server-side** (HMAC signature in
  `verifyRazorpayPayment` / `verifyServiceRazorpayPayment` / parcel) plus the signed
  webhook; prices and promo codes are recomputed on the server — client totals are ignored.
- **Rate limits**: Firestore-backed limits on bookings, payment orders, leads, assistant,
  support requests, OTP sends and every auth e-mail (sign-up OTP, verification, password
  reset, provider lookup, e-mail change).

## Do these in the consoles
1. **Firebase → Authentication → Sign-in method**: enable *Email/Password* and *Google*
   only; disable anything you don't use.
2. **Admin e-mails**: the allow-list lives in `firestore.rules` (`isAdmin()`) and
   `public/admin.html` (`ADMIN_EMAILS`). Change both together, then
   `firebase deploy --only firestore:rules` and push.
3. **App Check** (Firebase → App Check): register the web app with reCAPTCHA Enterprise,
   watch the metrics for a week in *unenforced* mode, then enforce for Firestore, Storage
   and Cloud Functions.
4. **Google Cloud → APIs & Services → Credentials**:
   - Browser Maps key: *HTTP referrers* = `packzenblr.in/*`, `*.packzenblr.in/*`;
     API restrictions = Maps JavaScript, Places, Distance Matrix.
   - Server Maps key (`GOOGLE_MAPS_KEY` secret): API restrictions only (Distance Matrix,
     Places API (New)) — no referrer restriction.
   - Firebase browser key: restrict to the Firebase APIs it uses.
5. **Brevo → Settings → Security → Authorised IPs**: *Deactivate blocking* (Cloud
   Functions use changing Google IPs). The API key stays in Secret Manager.
6. **Razorpay → Settings → Webhooks**: secret matches the `RAZORPAY_WEBHOOK_SECRET` secret;
   events `payment.captured`, `payment.failed`, `refund.*`.

## Security headers (set at the edge — GitHub Pages can't send custom headers)
CSP is already delivered with `<meta http-equiv="Content-Security-Policy">` on every page.
Headers that **cannot** be set by a meta tag need Cloudflare (if the domain is proxied):
- **SSL/TLS → Edge Certificates → HSTS**: enable, max-age 6 months+, include subdomains;
  add *preload* only after everything is HTTPS for a few weeks.
- **Rules → Transform Rules → Modify response header** (all requests):
  `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` ·
  `Permissions-Policy: geolocation=(self), camera=(), microphone=()` ·
  `X-Frame-Options: SAMEORIGIN` (blocks click-jacking — meta CSP can't do `frame-ancestors`).
- **SSL/TLS mode**: Full (strict).

## Caching / versioning
Assets are versioned with `?v=N` on every `<script>`/`<link>`; bump the number whenever a
file changes so phones load the new copy. No build step is required.
