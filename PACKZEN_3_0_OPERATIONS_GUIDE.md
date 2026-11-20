# PACKZEN 3.0 — OWNER & STAFF OPERATIONS GUIDE
## Daily Operating Console, Workflow Orchestration, Customer 360 & Incident Runbooks

**Author:** Staff Operations Architect & Customer Success Lead  
**Project:** PackZen (`packzen-e7539`)  
**Portal:** `https://packzenblr.in/admin.html`  
**Target Roles:** Platform Owner, Business Operations Lead, Sales Advisors, Dispatchers  

---

## 1. THE 2-3 HOUR OWNER DAILY MANAGEMENT ROUTINE

The PackZen 3.0 Command Center structures daily executive management into four focused time-blocks:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   OWNER DAILY OPERATING TIME-BLOCKS                    │
├─────────────────────┬──────────────────┬──────────────────┬────────────┤
│ 1. LOGISTICS (60m)  │ 2. DIGITAL (45m) │ 3. SERVICES(30m) │4.FINANCE15m│
│ - Crew assignments  │ - Scope reviews  │ - Tech screening │ - Collections
│ - Packing stock     │ - Wireframe sign │ - Trial jobs     │ - Payouts
│ - Move quotations   │ - Launch staging │ - Callback SLA   │ - P&L audit
└─────────────────────┴──────────────────┴──────────────────┴────────────┘
```

### 1.1 Logistics Focus (60 Minutes)
1. Navigate to `admin.html#owner`.
2. Inspect **Today's Active Moves** and **Driver Assignments**.
3. Verify vehicle coordination for pending shifts.
4. Review move quotes pending in the Unified Pipeline (`#pipeline`).

### 1.2 Digital Focus (45 Minutes)
1. Review active PackZen Digital client projects (`#digitalprojects`).
2. Inspect pending milestone deliverables (UI Design, Staging Link, SEO Audit).
3. Sign off on completed client milestones to trigger automated outbox notifications.
4. Check recurring Care Plan retainers and staging servers.

### 1.3 Home Services Focus (30 Minutes)
1. Inspect AC and appliance partner screening queues (`#homeservices`).
2. Review technicians currently performing trial jobs in North/South Bangalore.
3. Review customer feedback ratings and warranty claims.

### 1.4 Finance & P&L Reconciliation (15 Minutes)
1. Inspect Net Customer Collections vs Direct Service Costs in the Executive Financial Ribbon.
2. Confirm Contribution Margin and Net Operating Profit.
3. Review pending partner wallet payouts due and Razorpay settlement balances.

---

## 2. DECISION ACTION STREAM ("WHAT NEEDS ATTENTION TODAY")

The Action Stream dynamically bubbles up high-priority operational items:
- **Red Alert (Critical):** Inbound inquiries uncontacted for $>15$ minutes (SLA breach).
  - *Action:* Click `💬 WhatsApp` to initiate first contact, or click `Update` to reassign to an available advisor.
- **Amber Alert (Warning):** Digital client milestones exceeding scheduled target delivery dates.
  - *Action:* Open Project modal to update milestone staging notes or contact client.
- **Orange Alert (Notice):** Completed moves or delivered projects with outstanding balance $>₹5,000$.
  - *Action:* Click `Collect Balance` to generate and send Razorpay payment link.
- **System Alert (Dead Letter):** Failed automation outbox notifications.
  - *Action:* Click `🟢 System Health` $\rightarrow$ `Retry Event` to re-enqueue.

---

## 3. UNIFIED CUSTOMER 360 VIEWER

To inspect any customer's cross-division interactions:
1. In the Command Center header, click `👥 Customer 360`.
2. Enter the customer's phone number, email address, or user UID.
3. The viewer displays:
   - **Customer Identity & Tier:** Full name, phone, email, and VIP/Loyal status badge.
   - **Lifetime Value:** Total historical paid collections and current outstanding receivables.
   - **Logistics History:** Past and active move bookings, routes, inventory size, and delivery OTP status.
   - **Digital Projects:** Contracted web development packages, milestones, and care plans.
   - **Inbound Inquiries:** Historical lead requests and advisor follow-up notes.

---

## 4. INCIDENT RECOVERY RUNBOOKS

### Runbook 1: Inbound Lead SLA Escalation
1. **Trigger:** SLA Breach Alert received via email or in the Owner Action Stream.
2. **Diagnosis:** Lead sits unassigned in `leads` collection with `createdAtMs` $>15$ minutes ago.
3. **Resolution:**
   - In `admin.html#leads`, filter by `Status: New`.
   - Click the unassigned lead $\rightarrow$ Select Sales Advisor $\rightarrow$ Click `Assign Advisor`.
   - System updates `assignedTo` and automatically enqueues `lead.assigned` outbox notification.

### Runbook 2: Outbox Worker Dead-Letter Recovery
1. **Trigger:** System Health badge displays `WARNING` or `CRITICAL`.
2. **Diagnosis:** Event exhausted 5 retries due to downstream provider outage.
3. **Resolution:**
   - Navigate to `admin.html#automation`.
   - Filter by `Status: Dead Letter`.
   - Inspect `lastError` (e.g. Brevo timeout or WhatsApp template rate limit).
   - Click `🔄 Retry Event` to clear error history and re-enqueue for the worker batch.

### Runbook 3: Digital Project Milestone Reversion
1. **Trigger:** Client requests scope revision on an already completed milestone.
2. **Diagnosis:** Milestone state machine blocks reversion without override.
3. **Resolution:**
   - Open Digital Project in `#digitalprojects`.
   - Enter explicit `Override Reason` (e.g., "Client requested colorway revision").
   - Click `Revert Milestone` (logged permanently in `workflow_history`).
