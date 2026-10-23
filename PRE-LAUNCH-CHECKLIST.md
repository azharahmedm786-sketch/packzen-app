# PackZen — pre-launch checklist (human steps)

## Consoles
- [ ] Firebase Auth: Email/Password + Google enabled, nothing else
- [ ] App Check registered (unenforced → enforced after a week of clean metrics)
- [ ] Google Cloud keys restricted (see SECURITY.md §4); *Places API (New)* enabled
- [ ] Brevo: Authorised-IP blocking **off**; test e-mail arrives
- [ ] Razorpay: live keys in Secret Manager, webhook secret set and events subscribed
- [ ] Cloudflare (if used): SSL Full (strict), HSTS, response-header rule (SECURITY.md)
- [ ] Firestore: FIRSTMOVE promo doc; services catalog items current; cleaning items off
- [ ] Google Analytics: `generate_lead` and `purchase` marked as key events
- [ ] Search Console: domain verified, `sitemap.xml` submitted

## End-to-end tests (real phone, small amounts)
- [ ] Move: quote → pay advance → admin assigns → crew accepts → transit → OTP complete → review request
- [ ] Parcel: book + pay → receiver gets delivery code → complete
- [ ] Home service (AC / appliance): book + pay → assigned to the right skill → complete
- [ ] Cancellation before the day → refund visible in Razorpay → SMS/e-mail
- [ ] Partner: register → admin approves → crew app sign-in → receives an offer
- [ ] Leads: callback form → Leads app (scored) → HOT e-mail; chat flows (book, reschedule, photo)
- [ ] Admin/staff: add a team member → set-password link works → Leads app access

## Deploy & rollback
- Deploy: `git push origin main` (website) and
  `firebase deploy --only functions,firestore:rules,storage` (backend).
- **Rollback website**: `git revert <bad-commit>` then `git push origin main`
  (GitHub Pages republishes the previous files within a minute or two).
- **Rollback functions**: `git checkout <good-commit> -- functions` then
  `firebase deploy --only functions`, and commit the restore.
- Nightly Firestore backups: `gs://packzen-e7539-backups/firestore/<date>/` (restore with
  `gcloud firestore import`).
