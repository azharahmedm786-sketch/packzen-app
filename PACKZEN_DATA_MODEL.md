# PACKZEN 3.0 — Firestore Data Model & Schema Specification
## Database Architecture, Collection Schemas, Indexes & Security Boundaries

**Document Version:** 3.0.0  
**Status:** Approved Data Architecture  
**Database:** Cloud Firestore (Native Mode, `asia-south1`)  
**Target Environment:** `packzen-e7539`

---

## 1. Global Data Model Topology

PackZen 3.0 organizes its data into strict, domain-driven root collections and targeted subcollections to achieve high query efficiency, sub-millisecond document lookups, and clear security isolation:

```
+---------------------------------------------------------------------------------------+
|                                FIRESTORE ROOT TOPOLOGY                                |
+------------------------------------+--------------------------------------------------+
| 1. CORE OPERATIONAL ENTITIES       | leads, bookings, partners, projects              |
| 2. PRIORITY ONE AUTOMATION ENGINE  | automation_outbox, automation_events,            |
|                                    | automation_logs, automation_templates,           |
|                                    | automation_preferences                           |
| 3. FINANCIAL & RECONCILIATION      | ledger, payouts                                  |
| 4. SYSTEM & GOVERNANCE             | staff_roles, settings, scenarios                 |
+------------------------------------+--------------------------------------------------+
```

---

## 2. Collection Schemas & Detailed Field Definitions

### 2.1 Collection: `leads`
Represents an incoming inquiry or potential service booking across all three divisions.

| Field Name | Type | Constraints / Allowed Values | Description |
|---|---|---|---|
| `leadId` | `string` | Unique document ID | Identifier (e.g. `lead_20261117_x89a`) |
| `division` | `string` | `"logistics" \| "home_services" \| "digital"` | Operating business division |
| `status` | `string` | `"new" \| "contacted" \| "qualified" \| "quotation_pending" \| "quotation_sent" \| "negotiation" \| "converted" \| "lost" \| "closed"` | Current stage in the 9-stage pipeline |
| `statusReason` | `string` | Optional; mandatory if `"lost"` | Reason for status transition or cancellation |
| `customer` | `map` | Non-null | Customer contact data |
| `customer.name` | `string` | Min 2 chars | Full name of customer |
| `customer.phone` | `string` | E.164 (+91...) | Normalized mobile number |
| `customer.email` | `string` | Optional; valid email | Email address |
| `customer.city` | `string` | Default: `"Bengaluru"` | Base city |
| `serviceRequirements` | `map` | Non-null | Division-specialized requirement payload |
| `serviceRequirements.serviceType`| `string` | e.g. `"house_shifting"`, `"ac_repair"`, `"web_design"` | Specific service catalog item |
| `serviceRequirements.pickupLocation` | `string` | For Logistics / Home Services | Origin address / locality |
| `serviceRequirements.dropLocation` | `string` | For Logistics | Destination address / locality |
| `serviceRequirements.scheduledDate` | `string` | ISO Date (`YYYY-MM-DD`) | Target execution date |
| `serviceRequirements.inventorySummary` | `string` | Optional | Free-text or structured items |
| `quoteDetails` | `map` | Optional | Dynamic quotation details |
| `quoteDetails.estimatedAmount` | `number` | Positive integer (INR) | Calculated base quotation |
| `quoteDetails.advanceRequired` | `number` | Default: 999 or 30% | Token advance required for booking |
| `quoteDetails.quoteGeneratedAt` | `timestamp` | Optional | When quote was calculated |
| `score` | `number` | 0 - 100 | Automated intent and quality score |
| `assignedAdvisor` | `string` | Optional UID | UID of the PackZen sales staff member |
| `source` | `string` | `"google_ads" \| "seo" \| "direct" \| "whatsapp" \| "referral"` | Marketing acquisition channel |
| `sla` | `map` | Non-null | SLA monitoring block |
| `sla.firstResponseDueAt` | `timestamp` | T+15m from creation | Hard SLA deadline for initial contact |
| `sla.isBreached` | `boolean` | Default: `false` | Set to true if first contact exceeds SLA |
| `sla.contactedAt` | `timestamp` | Optional | Exact timestamp when marked contacted |
| `createdAt` | `timestamp` | Server timestamp | Record creation time |
| `updatedAt` | `timestamp` | Server timestamp | Last mutation time |

---

### 2.2 Collection: `bookings`
Represents an active, scheduled, or completed service order.

| Field Name | Type | Constraints / Allowed Values | Description |
|---|---|---|---|
| `bookingId` | `string` | Document ID (`PZ-BLR-...`) | Human-readable order reference |
| `leadId` | `string` | Valid `leads` doc reference | Originating lead document |
| `division` | `string` | `"logistics" \| "home_services"` | Division executing the order |
| `status` | `string` | `"confirmed" \| "dispatch_pending" \| "assigned" \| "in_transit" \| "arrived" \| "in_progress" \| "completed" \| "cancelled"` | Operational execution state |
| `customer` | `map` | Customer details | Phone, name, email |
| `assignedPartner` | `map` | Optional | Field partner details |
| `assignedPartner.partnerId` | `string` | Valid `partners` reference | Partner UID |
| `assignedPartner.name` | `string` | String | Driver / Technician name |
| `assignedPartner.phone` | `string` | Phone | Direct contact number |
| `assignedPartner.vehicleNumber`| `string` | Optional | Vehicle registration plate |
| `financials` | `map` | Non-null | Financial settlement figures |
| `financials.totalAmount` | `number` | Positive integer (INR) | Final agreed booking price |
| `financials.advancePaid` | `number` | Positive integer (INR) | Amount collected online |
| `financials.balanceDue` | `number` | Positive integer (INR) | Remaining balance to collect |
| `financials.partnerPayout` | `number` | Positive integer (INR) | Agreed commission / fee to partner |
| `financials.platformMargin` | `number` | Positive integer (INR) | PackZen net take |
| `paymentDetails` | `map` | Non-null | Razorpay payment tracking |
| `paymentDetails.orderId` | `string` | `order_...` | Razorpay Order ID |
| `paymentDetails.paymentId` | `string` | `pay_...` | Razorpay Payment ID |
| `paymentDetails.paidAt` | `timestamp` | Timestamp | Advance confirmation timestamp |
| `verification` | `map` | Non-null | Completion security block |
| `verification.otpHash` | `string` | SHA-256 string | Hashed 4-digit completion PIN |
| `verification.otpExpiresAt` | `timestamp` | Timestamp | OTP expiry (2 hours from issue) |
| `verification.verifiedAt` | `timestamp` | Optional | Verification completion timestamp |
| `verification.proofPhotos` | `array` | Optional GCS URLs | Uploaded proof of delivery / service |
| `createdAt` | `timestamp` | Server timestamp | Order creation timestamp |
| `updatedAt` | `timestamp` | Server timestamp | Last update timestamp |

#### Subcollection: `bookings/{bookingId}/timeline`
Stores append-only audit milestones:
- `timestamp`: Server timestamp.
- `stage`: e.g. `"ADVANCE_PAID"`, `"CREW_DISPATCHED"`, `"ARRIVED_PICKUP"`, `"OTP_VERIFIED"`.
- `actor`: UID / system string.
- `metadata`: Coordinate latitude/longitude, IP address, or user agent.

---

### 2.3 Collection: `partners`
Represents registered drivers, packers, movers, and appliance technicians.

| Field Name | Type | Constraints / Allowed Values | Description |
|---|---|---|---|
| `partnerId` | `string` | Firebase Auth UID | Unique partner user identifier |
| `type` | `string` | `"driver" \| "technician" \| "fleet_owner"` | Partner capability classification |
| `name` | `string` | String | Full legal name |
| `phone` | `string` | E.164 (+91...) | Registered phone number |
| `verificationStatus` | `string` | `"pending_kyc" \| "verified" \| "suspended" \| "rejected"` | Administrative review status |
| `kycDocuments` | `map` | Map of document references | Cloud Storage paths to Aadhaar, DL, RC |
| `serviceCapabilities` | `array` | Strings | e.g. `["house_shifting", "ac_repair", "single_item"]` |
| `serviceZones` | `array` | Pincodes / Localities | e.g. `["560034", "560102", "Whitefield", "Koramangala"]` |
| `walletBalance` | `number` | Integer (INR) | Accrued balance available for payout |
| `rating` | `number` | 1.0 - 5.0 | Average customer satisfaction rating |
| `jobsCompleted` | `number` | Integer >= 0 | Lifetime count of verified completed jobs |
| `isActive` | `boolean` | Default: `true` | Availability toggle for dispatch |
| `createdAt` | `timestamp` | Server timestamp | Registration date |

---

### 2.4 Collection: `projects`
Represents client engagements in the Digital Solutions division.

| Field Name | Type | Constraints / Allowed Values | Description |
|---|---|---|---|
| `projectId` | `string` | Unique ID (`PZ-DIG-...`) | Project identifier |
| `leadId` | `string` | Valid `leads` reference | Originating inquiry |
| `client` | `map` | Map | Business name, contact person, phone, email |
| `scope` | `string` | `"starter_website" \| "custom_web_app" \| "seo_growth" \| "maintenance"` | Project tier |
| `totalValue` | `number` | Integer (INR) | Total contract value |
| `status` | `string` | `"discovery" \| "design" \| "development" \| "staging" \| "launched" \| "archived"` | Project milestone state |
| `stagingUrl` | `string` | Optional URL | Preview deployment link |
| `productionUrl` | `string` | Optional URL | Final live website URL |
| `milestones` | `array` | Array of Milestone maps | Milestone name, percentage, due date, status |
| `createdAt` | `timestamp` | Server timestamp | Project kick-off timestamp |

---

### 2.5 Priority One Automation Collections

#### `automation_outbox`
The transactional outbox queue consumed by serverless event processors.
- `eventId`: UUIDv4 document key.
- `eventType`: String (`LEAD_CREATED`, `QUOTE_GENERATED`, `OTP_REQUESTED`, `BOOKING_CONFIRMED`).
- `division`: `"logistics" | "home_services" | "digital"`.
- `entityId`: Document ID being acted upon.
- `idempotencyKey`: SHA-256 deterministic deduplication key.
- `status`: `"pending" | "processing" | "completed" | "failed" | "dead_letter"`.
- `channel`: `"whatsapp" | "sms" | "email" | "n8n_webhook"`.
- `payload`: Map containing recipient info, template IDs, and dynamic variables.
- `retryCount`: Integer (0-5).
- `createdAt` / `updatedAt`: Timestamps.

#### `automation_logs`
Permanent, immutable audit trail for every dispatched message or triggered webhook.
- `logId`: Unique hash.
- `eventId`: Correlating outbox event ID.
- `idempotencyKey`: Verified key.
- `channel`: Target channel gateway.
- `recipient`: Phone number / email.
- `status`: `"delivered" | "failed" | "bounced" | "rejected"`.
- `gatewayResponse`: Raw response payload from Meta / MSG91 / Brevo.
- `executionDurationMs`: Response latency in milliseconds.
- `dispatchedAt`: Timestamp.

#### `automation_templates`
Centralized definition of approved templates across channels.
- `templateKey`: Unique key (e.g. `logistics_lead_ack`).
- `channel`: `"whatsapp" | "sms" | "email"`.
- `providerTemplateId`: External gateway ID (Meta template name or MSG91 flow ID).
- `contentBody`: Localized message template text.
- `requiredVariables`: Array of expected keys (e.g. `["CUSTOMER_NAME", "MOVE_DATE"]`).

---

### 2.6 Collection: `ledger`
Auditable, double-entry aligned financial ledger for absolute financial visibility.

| Field Name | Type | Allowed Values | Description |
|---|---|---|---|
| `transactionId` | `string` | Document ID (`TXN_...`) | Unique ledger transaction ID |
| `bookingId` | `string` | Optional | Correlating booking reference |
| `projectId` | `string` | Optional | Correlating digital project reference |
| `division` | `string` | `"logistics" \| "home_services" \| "digital" \| "corporate"` | Operating division |
| `type` | `string` | `"customer_advance" \| "balance_collection" \| "partner_payout" \| "gateway_fee" \| "refund" \| "opex"` | Nature of transaction |
| `direction` | `string` | `"credit" \| "debit"` | Inflow (+) vs. Outflow (-) |
| `amount` | `number` | Positive integer (INR) | Transaction amount |
| `paymentMethod` | `string` | `"razorpay" \| "upi_direct" \| "cash" \| "bank_transfer"` | Settlement channel |
| `referenceId` | `string` | External ID | Razorpay payment ID or UTR number |
| `recordedBy` | `string` | User UID / `"SYSTEM"` | Staff or automated process |
| `createdAt` | `timestamp` | Server timestamp | Immutable entry timestamp |

---

## 3. Required Firestore Composite Indexes

To support high-velocity queries across administrative consoles, partner dispatchers, and SLA monitoring schedulers without query runtime errors:

```json
{
  "indexes": [
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "division", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "sla.isBreached", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "division", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "serviceRequirements.scheduledDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assignedPartner.partnerId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "automation_outbox",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "ledger",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "division", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

## 4. Query Partitioning & Hotspotting Mitigations

1. **Deterministic Time-Bound Sharding:** In the outbox engine, high-throughput writes distribute event IDs using random UUID suffixes (`evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`) preventing monotonic index hotspotting on standard Firestore partitions.
2. **Document Size Caps:** All subdocuments (e.g., inventory summaries, logs) strictly stay below 64KB, well below the Firestore 1MB document limit.
3. **Audit Immutability:** Historical timeline milestones and automation execution logs write directly to isolated subcollections or append-only collections to keep parent entity reads fast and lean.
