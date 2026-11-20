# PACKZEN 3.0 — MASTER DATA MODEL & SCHEMA SPECIFICATION
## Authoritative Schema Definitions, Normalization Layer & Index Configuration

**Author:** Principal Database Architect & Systems Modeler  
**Project:** PackZen (`packzen-e7539`)  
**Storage Engine:** Google Cloud Firestore (Native Mode)  
**Region:** `asia-south1`  
**Status:** IMPLEMENTED & TESTED (Non-Destructive Read Normalizers)

---

## 1. STORAGE CONVENTIONS & INTEGRITY POLICY

1. **Non-Destructive Invariant:**
   Existing Firestore collections, document IDs, field names, and data types are strictly preserved. The normalization engine (`functions/unified-models.js`) performs schema alignment at read-time in serverless memory without mutating raw documents on disk.
2. **Double-Entry Financial Separation:**
   Customer inflows (`collection`), refunds (`refund`), direct provider liabilities (`direct_cost`), and overhead (`shared_opex`) are recorded as categorized ledger transactions in the immutable `ledger` collection.
3. **Audit Immutability:**
   Transitions across workflow stages write append-only logs in `workflow_history`. Direct client writes are rejected by `firestore.rules`.

---

## 2. FIRESTORE COLLECTION SCHEMAS

### 2.1 Collection: `bookings`
Stores confirmed and in-progress operational jobs for PackZen Logistics (relocation / moves) and PackZen Home Services (AC / appliance maintenance).

| Field Name | Type | Description | Live/Normalized |
|---|---|---|---|
| `bookingRef` | String | Unique public reference (e.g., `PZB-2026-1001`) | Live |
| `customerUid` | String | Firebase Auth UID of the customer | Live |
| `customerId` | String | Read-only alias pointing to `customerUid` | Normalized |
| `customerName` | String | Primary contact full name | Live |
| `phone` | String | 10-digit Indian mobile number | Live |
| `customerEmail` | String | Customer notification email | Live |
| `date` | String | Scheduled service date (`YYYY-MM-DD`) | Live |
| `flow` | String | Service category: `"move"`, `"parcel"`, or `"service"` | Live |
| `division` | String | Inferred division: `"logistics"` or `"home_services"` | Normalized |
| `pickup` | String | Origin / service address in Bangalore | Live |
| `drop` | String | Destination address (empty for home services) | Live |
| `total` | Number | Authoritative order total in INR | Live |
| `paid` | Number | Total verified customer payments collected | Live |
| `balanceDue` | Number | Outstanding balance: $\max(0, \text{total} - \text{paid})$ | Normalized |
| `status` | String | `"pending"`, `"confirmed"`, `"assigned"`, `"in_transit"`, `"delivered"`, `"completed"`, `"cancelled"` | Live |
| `driverUid` | String | Assigned driver / technician partner UID | Live |
| `partnerId` | String | Read-only alias pointing to `driverUid` | Normalized |
| `createdAt` | Timestamp | Server creation timestamp | Live |

---

### 2.2 Collection: `projects`
Stores high-value client contracts, milestones, and deliverables for PackZen Digital.

| Field Name | Type | Description | Live/Normalized |
|---|---|---|---|
| `projectId` | String | Unique document ID | Live |
| `businessName` | String | Client organization / trade name | Live |
| `clientName` | String | Authorized client representative name | Live |
| `email` | String | Denormalized client contact email | Live |
| `clientEmail` | String | Read-only alias for `email` | Normalized |
| `phone` | String | Client telephone / WhatsApp number | Live |
| `packageId` | String | Digital package: `"custom"`, `"growth"`, `"ecommerce"`, `"seo"` | Live |
| `packageName` | String | Human-readable package description | Live |
| `tier` | String | `"standard"`, `"growth"`, `"enterprise"` | Live |
| `totalAmount` | Number | Total contract contract value in INR | Live |
| `paidAmount` | Number | Advance and milestone payments collected | Live |
| `balanceDue` | Number | Outstanding project receivables | Live |
| `status` | String | `"discovery"`, `"in_progress"`, `"client_review"`, `"completed"`, `"cancelled"` | Live |
| `carePlanStatus` | String | `"none"`, `"pending"`, `"active"`, `"suspended"` | Live |
| `milestones` | Array<Object> | List of milestone objects: `{ id, name, status, targetDate, completedAt }` | Live |
| `createdAt` | Timestamp | Project kick-off timestamp | Live |

---

### 2.3 Collection: `leads`
Inbound commercial inquiries ingested via the website, chat assistant, WhatsApp, and phone.

| Field Name | Type | Description | Live/Normalized |
|---|---|---|---|
| `name` | String | Inquirer contact name | Live |
| `phone` | String | 10-digit mobile number | Live |
| `email` | String | Optional inquirer email address | Live |
| `division` | String | `"logistics"`, `"home_services"`, or `"digital"` | Live / Inferred |
| `service` | String | Service identifier (e.g. `"house_shifting"`, `"ac"`, `"website"`) | Live |
| `status` | String | `"new"`, `"qualified"`, `"quoted"`, `"booked"`, `"lost"`, `"cancelled"` | Live |
| `stage` | String | Read-only alias for workflow stage | Normalized |
| `source` | String | Marketing attribution: `"google"`, `"whatsapp"`, `"referral"`, `"direct"` | Live |
| `area` | String | Bangalore locality (e.g., `"Koramangala"`, `"Whitefield"`) | Live |
| `nextActionDate`| String | Planned advisor follow-up date (`YYYY-MM-DD`) | Live |
| `createdAtMs` | Number | Creation epoch millisecond timestamp | Live |

---

### 2.4 Collection: `ledger`
Statutory financial transaction records for double-entry P&L accounting.

| Field Name | Type | Description | Live/Normalized |
|---|---|---|---|
| `txId` | String | Unique transaction record key | Live |
| `date` | String | Settlement date (`YYYY-MM-DD`) | Live |
| `type` | String | `"collection"`, `"refund"`, `"direct_cost"`, `"shared_opex"`, `"discount"` | Live |
| `category` | String | Read-only alias for `type` | Normalized |
| `amount` | Number | Monetary value in INR | Live |
| `division` | String | `"logistics"`, `"home_services"`, `"digital"`, `"overhead"` | Live |
| `refId` | String | Foreign key to `bookings`, `projects`, or `bills` | Live |
| `referenceId` | String | Read-only alias for `refId` | Normalized |
| `subcat` | String | Subcategory: `"partner_payout"`, `"materials"`, `"gateway_fee"` | Live |
| `notes` | String | Contextual accounting description | Live |
| `createdAt` | Timestamp | Ingestion timestamp | Live |

---

### 2.5 Collection: `automation_outbox`
Transactional outbox store guaranteeing at-least-once cross-channel event processing.

| Field Name | Type | Description |
|---|---|---|
| `eventId` | String | Deterministic SHA-256 idempotency key |
| `eventName` | String | Registered event (e.g., `lead.assigned`, `project.created`) |
| `entityType` | String | Target entity: `"booking"`, `"project"`, `"lead"`, `"partner"` |
| `entityId` | String | Target entity document ID |
| `division` | String | `"logistics"`, `"home_services"`, `"digital"`, or `"overhead"` |
| `priority` | String | `"urgent"`, `"high"`, or `"normal"` |
| `status` | String | `"pending"`, `"processing"`, `"completed"`, `"dead_letter"`, `"failed"` |
| `attempts` | Number | Number of dispatch attempts made (max 5) |
| `leaseExpiresAtMs`| Number | Millisecond timestamp when worker processing lock expires |
| `payload` | Object | Normalized event payload for email/WhatsApp/webhook |
| `createdAtMs` | Number | Outbox enqueue timestamp |

---

### 2.6 Collection: `workflow_history`
Immutable audit log tracking all workflow stage progressions across the platform.

| Field Name | Type | Description |
|---|---|---|
| `historyId` | String | Unique audit entry key |
| `division` | String | `"logistics"`, `"home_services"`, or `"digital"` |
| `entityType` | String | Target entity: `"booking"`, `"project"`, `"lead"` |
| `entityId` | String | Entity document identifier |
| `fromStage` | String | Prior workflow stage |
| `toStage` | String | New workflow stage |
| `isOverride` | Boolean | `true` if this transition bypassed strict single-step sequencing |
| `overrideReason` | String | Mandatory justification when `isOverride` is `true` |
| `updatedBy` | String | Firebase Auth UID of the actor |
| `updatedByRole` | String | Role of actor: `"owner"`, `"admin"`, `"advisor"`, `"system"` |
| `timestamp` | Number | Transition epoch timestamp in milliseconds |

---

## 3. FIRESTORE COMPOSITE INDEXES CONFIGURATION

Stored in `firestore.indexes.json` and registered in `firebase.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "driverUid", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "customerUid", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "ledger",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "division", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "ledger",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "ledger",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "refId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "automation_outbox",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "nextRetryAtMs", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "automation_outbox",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workflow_history",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "entityType", "order": "ASCENDING" },
        { "fieldPath": "entityId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "division", "order": "ASCENDING" },
        { "fieldPath": "createdAtMs", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```
