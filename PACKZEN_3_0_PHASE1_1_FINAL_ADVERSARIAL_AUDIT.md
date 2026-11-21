# PACKZEN 3.0 — PHASE 1.1 FINAL ADVERSARIAL CODE AUDIT
## Independent DevSecOps Verification of Staging Deployment Guard and CLI Wrapper

**Date:** November 21, 2026  
**Auditor:** Independent Principal DevSecOps Auditor  
**Audit Mode:** STRICT READ-ONLY VERIFICATION  
**Repository:** `azharahmedm786-sketch/packzen-app`  
**Branch:** `firebase-hosting-migration`  
**HEAD Commit:** `d69e69d9ec1f6319e3c8aa22f6d6b5c1f8048202`  
**Overall Verdict:** **PASS**

---

## 1. Executive Summary

This independent audit conducted a comprehensive, adversarial source-code inspection, dynamic simulation, and regression test execution of the Phase 1.1 implementation. 

The audit confirms that Phase 1.1 achieves full fail-closed production shielding, resolves previously documented architectural gaps (notably Gap G-01), strictly enforces an isolated deployment pathway for `packzen-staging-3`, and preserves existing production configurations and rollback assets without mutation.

All 66 test suites across the Cloud Functions codebase executed successfully with zero failures and zero skipped tests.

---

## 2. File-by-File Inspection & Git Diff Analysis

### 2.1 Tracked File Modifications (`git diff`)

#### 1. `.firebaserc`
- **Diff:**
  ```diff
   {
     "projects": {
  -    "default": "packzen-e7539"
  +    "default": "packzen-e7539",
  +    "production": "packzen-e7539",
  +    "staging": "packzen-staging-3"
     },
     "targets": {},
     "etags": {}
   }
  ```
- **Auditor Assessment: PASS.**  
  `default` remains pinned to production (`packzen-e7539`). Explicit named aliases `production` and `staging` are mapped deterministically. No unauthorized projects or syntax anomalies exist.

#### 2. `firebase.json`
- **Diff:** Added predeploy hook `"predeploy": ["node scripts/guard-staging-deploy.js"]` across four service targets:
  - `hosting.predeploy`
  - `functions.predeploy`
  - `firestore.predeploy` (protecting both `firestore.rules` and `firestore.indexes.json`)
  - `storage.predeploy` (protecting `storage.rules`)
- **Auditor Assessment: PASS.**  
  Predeploy hooks intercept any native `firebase deploy` targeting hosting, backend cloud functions, firestore security rules/indexes, and cloud storage rules.

#### 3. `functions/package.json`
- **Diff:** Added npm test scripts:
  - `"test:guard": "node test/deploy-guard.test.js"`
  - `"test:staging-wrapper": "node test/staging-wrapper.test.js"`
  - Appended `&& node test/deploy-guard.test.js && node test/staging-wrapper.test.js` to the root `"test"` script.
- **Auditor Assessment: PASS.**  
  Both security suites are integrated into continuous integration regression runs.

### 2.2 Newly Authored Implementation Files

#### 1. `scripts/guard-staging-deploy.js` (360 lines)
- Implements `resolveAllDeploymentTargets()`, `resolveDeploymentTarget()`, `validateDeploymentTarget()`, and `runGuard()`.
- Evaluates:
  - CLI flags: `--project <val>`, `-P <val>`, `--project=<val>`, `-P=<val>`.
  - Environment variables: `GCLOUD_PROJECT`, `FIREBASE_PROJECT`, `PROJECT_ID`.
  - Argument injection detection: rejects duplicate `--project` flags with divergent targets.
  - Active project fallback: queries `firebase use` and `.firebaserc` default only when zero explicit flags or environment variables are provided.
- Fail-closed error codes:
  - `FORBIDDEN_PRODUCTION`: Explicit or passive target resolves to `packzen-e7539`.
  - `AMBIGUOUS_PROJECT_CONFLICT`: Mismatch among supplied explicit targets (G-01 resolution).
  - `ARGUMENT_INJECTION_CONFLICT`: Multiple conflicting `--project` CLI flags.
  - `UNAUTHORIZED_PROJECT`: Target does not match `packzen-staging-3`.
  - `MISSING_PROJECT`: No project targets declared and active project unset.

#### 2. `scripts/pz-staging.js` (465 lines)
- Implements restricted staging CLI wrapper.
- Enforces:
  - Command allowlist: `deploy`, `hosting:channel:deploy`, `functions:secrets:set|destroy|get|prune`.
  - 16-secret allowlist for Secret Manager actions.
  - Explicit confirmation token requirement for destruction: `--confirm-destroy=<KEY>@packzen-staging-3`.
  - Preview channel name regex and reserved channel rejection (`live`, `prod`, `production`, `main`, `master`, `release`, `staging`, `default`).
  - Preview TTL enforcement ($\le 7$ days).
  - Subprocess execution: `spawnSync` with discrete argument arrays (no shell interpretation), forcing `--project packzen-staging-3`, `GCLOUD_PROJECT=packzen-staging-3`, and `FIREBASE_PROJECT=packzen-staging-3`.
  - Secret masking in logging.

### 2.3 Rollback Asset Verification
- `firebase.rollback.json`: Present, 155 bytes, intact.
- `firestore.rules.prod_backup`: Present, 24,530 bytes, intact.
- `functions_prod_backup/`: Present, directory containing backup functions, intact.
- **Auditor Assessment: PASS.** None of the rollback assets were modified, deleted, or staged.

---

## 3. Production Isolation Adversarial Verification

The auditor tested the guard and wrapper against multiple attack vectors:

| Attack Vector / Input Scenario | Guard / Wrapper Defense | Behavior | Status |
|---|---|---|:---:|
| **Wrapper with `--project production`** | `assertNoProjectOverride()` rejects production alias | Exits with `ARGUMENT_INJECTION_BLOCKED` (Code 1) | **PASS** |
| **Wrapper with `-P packzen-e7539`** | `assertNoProjectOverride()` rejects production project ID | Exits with `ARGUMENT_INJECTION_BLOCKED` (Code 1) | **PASS** |
| **Wrapper with `GCLOUD_PROJECT=packzen-e7539`** | Pre-flight `validateDeploymentTarget()` catches env override | Exits with `FORBIDDEN_PRODUCTION` (Code 1) | **PASS** |
| **Wrapper with `FIREBASE_PROJECT=packzen-e7539`** | Pre-flight `validateDeploymentTarget()` catches env override | Exits with `FORBIDDEN_PRODUCTION` (Code 1) | **PASS** |
| **CLI staging + `GCLOUD_PROJECT=packzen-e7539`** | Strict conflict detector identifies production divergence | Exits with `FORBIDDEN_PRODUCTION` (Code 1) | **PASS** |
| **CLI staging + `GCLOUD_PROJECT=rogue-project`** | Strict conflict detector identifies divergent targets | Exits with `AMBIGUOUS_PROJECT_CONFLICT` (Code 1) | **PASS** |
| **Duplicate CLI args (`--project staging --project production`)** | Argument injection detector detects multiple project flags | Exits with `ARGUMENT_INJECTION_CONFLICT` (Code 1) | **PASS** |
| **Bare `firebase deploy` with active production** | Active project fallback detects `packzen-e7539` | Exits with `FORBIDDEN_PRODUCTION` (Code 1) | **PASS** |
| **Subprocess Argument Tampering** | Child process spawned with discrete array; strips user project args | Exactly ONE `--project packzen-staging-3` injected | **PASS** |
| **Active CLI project state** | No `firebase use` mutation executed | `packzen-e7539` remains active default | **PASS** |

---

## 4. Secret Handling Verification

### 4.1 Allowlist Integrity
The wrapper hard-codes `APPROVED_STAGING_SECRETS` containing exactly the 16 approved staging secrets:
1. `RAZORPAY_KEY_ID`
2. `RAZORPAY_KEY_SECRET`
3. `RAZORPAY_WEBHOOK_SECRET`
4. `COMPLETION_OTP_PEPPER`
5. `GOOGLE_MAPS_KEY`
6. `BREVO_API_KEY`
7. `BREVO_SENDER_EMAIL`
8. `BREVO_SENDER_NAME`
9. `WHATSAPP_ACCESS_TOKEN`
10. `WHATSAPP_PHONE_NUMBER_ID`
11. `WHATSAPP_BUSINESS_ACCOUNT_ID`
12. `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
13. `WHATSAPP_APP_SECRET`
14. `N8N_WEBHOOK_URL`
15. `N8N_WEBHOOK_SECRET`
16. `MSG91_AUTHKEY`

- Reconciled against `defineSecret()` declarations across `functions/`: **Exact 100% match**.
- Any secret outside this list (e.g. `functions:secrets:set STRIPE_SECRET`) is blocked: `UNAPPROVED_SECRET_NAME`.

### 4.2 Leakage & Exposure Prevention
- **Inline CLI Secret Value Exposure:** Attempting `functions:secrets:set KEY=value` or `functions:secrets:set KEY value` is blocked immediately with `INSECURE_SECRET_ARGUMENT`. Values must be entered via secure stdin/prompt.
- **Log / Stdout Exposure:** Wrapper logs explicitly sanitize outputs: `Secret: <NAME> (Value: [REDACTED/MASKED])`.
- **Process Table Exposure:** Subprocess invocation receives only `["functions:secrets:set", "<NAME>", "--project", "packzen-staging-3"]`. No secret value is ever passed in child process `argv`.
- **File System Exposure:** Zero temporary files or intermediate artifacts are written to disk.
- **Destruction Confirmation:** Deleting a secret requires passing `--confirm-destroy=<KEY>@packzen-staging-3`. Any mismatched key or mismatched project fails closed.

---

## 5. Deployment and Preview Restrictions

### 5.1 Command Allowlists & Blocks
- **Allowed:**
  - `deploy` (full, or scoped to `hosting`, `functions`, `firestore`, `firestore:rules`, `firestore:indexes`, `storage`).
  - `hosting:channel:deploy <channelId>`.
  - `functions:secrets:set`, `functions:secrets:destroy`, `functions:secrets:get`, `functions:secrets:prune`.
- **Prohibited & Blocked:**
  - `firestore:delete` (`PROHIBITED_COMMAND`)
  - `auth:delete`, `auth:export`, `auth:import` (`PROHIBITED_COMMAND`)
  - `database:*` (`PROHIBITED_COMMAND`)
  - `projects:*`, `apps:*` (`PROHIBITED_COMMAND`)
  - Arbitrary commands like `init`, `emulators:start` (`UNSUPPORTED_COMMAND`)

### 5.2 Preview Channel Controls
- **Channel Name Syntax:** Must match regex `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`.
- **Reserved Names:** Rejects `live`, `production`, `prod`, `master`, `main`, `release`, `staging`, `default`.
- **TTL Limit:** Maximum duration is strictly 7 days (`7d` / `168h` / `10080m`). Passing `8d` or `30d` triggers `PREVIEW_EXPIRY_EXCEEDED`.
- **Promotion Safety:** Preview channel deployment cannot deploy to the live site.

---

## 6. Predeploy Hook Scope Analysis & Administrative Limitations

> [!IMPORTANT]
> **DevSecOps Critical Analysis:**  
> A common misconception in Firebase security is assuming that `firebase.json` predeploy hooks protect all CLI operations. They do not.

### Actual Predeploy Hook Behavior
| Operation | Command | Triggers `predeploy` Hook? | Protected By |
|---|---|:---:|---|
| **Full Deploy** | `firebase deploy` | **YES** | `firebase.json` hooks (`guard-staging-deploy.js`) |
| **Hosting Deploy** | `firebase deploy --only hosting` | **YES** | `hosting.predeploy` |
| **Functions Deploy** | `firebase deploy --only functions` | **YES** | `functions.predeploy` |
| **Firestore Rules** | `firebase deploy --only firestore:rules` | **YES** | `firestore.predeploy` |
| **Firestore Indexes** | `firebase deploy --only firestore:indexes` | **YES** | `firestore.predeploy` |
| **Storage Rules** | `firebase deploy --only storage` | **YES** | `storage.predeploy` |
| **Preview Channel** | `firebase hosting:channel:deploy <ch>` | **NO** | **`scripts/pz-staging.js` ONLY** |
| **Secret Management** | `firebase functions:secrets:*` | **NO** | **`scripts/pz-staging.js` ONLY** |
| **Data Deletion** | `firebase firestore:delete` | **NO** | **`scripts/pz-staging.js` ONLY** |
| **Auth Admin** | `firebase auth:*` | **NO** | **`scripts/pz-staging.js` ONLY** |

### Defense-in-Depth Implication
Because Firebase CLI administrative commands (`hosting:channel:deploy`, `functions:secrets:*`) bypass `firebase.json` predeploy hooks by design of the Firebase CLI engine, **the restricted wrapper `scripts/pz-staging.js` is an indispensable security layer**, not merely a convenience wrapper. 

If an engineer executes direct CLI administrative commands without `pz-staging.js`, predeploy hooks will not run. Therefore, team operational runbooks and CI/CD pipelines must mandate invocation through `node scripts/pz-staging.js`.

---

## 7. Independent Automated Test Verification

All test suites were executed independently during this audit.

### 7.1 Deploy Guard Test Suite (`functions/test/deploy-guard.test.js`)
- **Command:** `node functions/test/deploy-guard.test.js`
- **Runner:** Node.js native `node:test` (TAP format)
- **Suites:** 5 suites
  - `PACKZEN 3.0 — PHASE 1 DEPLOYMENT TARGET SAFETY GUARD`
  - `1. Target Resolution & Alias Mapping` (8 tests)
  - `2. Project Validation Rules` (7 tests)
  - `3. Subprocess CLI Exit Codes` (5 tests)
  - `4. Configuration Consistency (.firebaserc & firebase.json)` (5 tests)
- **Total Tests:** 25
- **Passed:** 25
- **Failed:** 0
- **Skipped:** 0
- **Exit Code:** `0`

### 7.2 Staging Wrapper Test Suite (`functions/test/staging-wrapper.test.js`)
- **Command:** `node functions/test/staging-wrapper.test.js`
- **Runner:** Node.js native `node:test` (TAP format)
- **Suites:** 1 suite (`PACKZEN 3.0 — PHASE 1.1 RESTRICTED STAGING WRAPPER SUITE`)
- **Total Tests:** 18
- **Passed:** 18
- **Failed:** 0
- **Skipped:** 0
- **Exit Code:** `0`
- **Subprocess Mocking Verification:**  
  The tests genuinely exercise the wrapper dispatcher (`executeWrapper`) with an injected `executor` mock function, verifying argument sanitation, injection defenses, pre-flight validation, and exact child-process arguments without contacting remote Firebase infrastructure.

### 7.3 Full Regression Test Run (`npm --prefix functions test`)
- **Command:** `npm --prefix functions test`
- **Total Test Files Executed:** 66
- **Total Individual Passed Checks / Tests:** 651
- **Total Failed Checks / Tests:** 0
- **Total Skipped Checks / Tests:** 0
- **Final Process Exit Code:** `0`

---

## 8. Detailed Findings Matrix

| Finding ID | Audit Area | Description | Status |
|:---:|---|---|:---:|
| **F-01** | Production Shielding | Production project `packzen-e7539` blocked under all wrapper and CLI permutations | **PASS** |
| **F-02** | Staging Resolution | Staging targets resolve strictly to `packzen-staging-3` | **PASS** |
| **F-03** | Gap G-01 Remediation | Conflicting environment variables and CLI flags fail closed (`AMBIGUOUS_PROJECT_CONFLICT`) | **PASS** |
| **F-04** | Flag Injection Defense | Duplicate `--project` / `-P` flags with divergent targets fail closed (`ARGUMENT_INJECTION_CONFLICT`) | **PASS** |
| **F-05** | Child Process Isolation | Wrapper injects exactly one validated `--project packzen-staging-3` into child process | **PASS** |
| **F-06** | Passive Project State | Workspace active Firebase CLI project remains production `packzen-e7539` without drift | **PASS** |
| **F-07** | Predeploy Defense | Bare `firebase deploy` blocked by predeploy guard (`FORBIDDEN_PRODUCTION`) | **PASS** |
| **F-08** | Secret Allowlist | Secret commands strictly restricted to the 16 approved staging secrets | **PASS** |
| **F-09** | Secret CLI Exposure | Passing secret values via CLI arguments rejected (`INSECURE_SECRET_ARGUMENT`) | **PASS** |
| **F-10** | Secret Logging | Zero secret values printed to console, logs, or process table (masked as `[REDACTED/MASKED]`) | **PASS** |
| **F-11** | Secret Destruction | Destruction strictly requires exact token `--confirm-destroy=<KEY>@packzen-staging-3` | **PASS** |
| **F-12** | Command Scope | Destructive and administrative commands blocked (`firestore:delete`, `auth:*`, `database:*`) | **PASS** |
| **F-13** | Preview Channels | Preview channel names validated; reserved names rejected; TTL capped at $\le 7$ days | **PASS** |
| **F-14** | Predeploy Coverage | `predeploy` hooks configured in `firebase.json` for hosting, functions, firestore, and storage | **PASS** |
| **F-15** | Predeploy Limitations | Hook bypass for non-deploy commands (`channel:deploy`, `secrets:*`) documented accurately | **PASS** |
| **F-16** | Test Suite Integrity | All 25 guard tests, 18 wrapper tests, and 651 full regression tests passed with exit code 0 | **PASS** |
| **F-17** | Rollback Protection | Untracked rollback files verified bit-for-bit intact | **PASS** |
| **F-18** | Read-Only Boundaries | Zero remote deployments, zero commits, zero pushes, zero GCP mutations performed | **PASS** |

---

## 9. Residual Risks & Recommended Actions for Phase 2

1. **Direct CLI Administrative Bypass Risk:**
   - *Risk:* If an operator bypasses `scripts/pz-staging.js` and runs `firebase functions:secrets:set` directly while their active project is `packzen-e7539`, the predeploy hook will not intercept it because `predeploy` only fires on `firebase deploy`.
   - *Mitigation:* Require developers and CI runners to invoke only `node scripts/pz-staging.js` for staging operations. In CI/CD, configure the pipeline runner with zero production credentials.
2. **Phase 2 Readiness (Notification Isolation):**
   - Phase 1.1 establishes deployment safety. However, the runtime Cloud Functions code does not yet implement `STAGING_NOTIFICATION_KILL_SWITCH`.
   - Proceeding to Phase 2 (implementing notification isolation in Brevo, WhatsApp, and n8n adapters) is required before any remote staging deployment can be safely executed.

---

## 10. Final Audit Verdict

### Overall Verdict: **PASS**

Phase 1.1 satisfies all architectural specifications, adversarial requirements, and devsecops standards. No code modifications, git commits, or remote operations were performed during this audit.
