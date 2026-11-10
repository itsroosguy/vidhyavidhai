# Verification & Test Plan

This document details all automated verification executed in this workspace alongside manual UAT procedures required once live Google Sheets and Google OAuth credentials are provisioned.

---

## 1. Automated Verification Scope & Executed Results

### 1.1 Frontend Typecheck, Unit, Integration & UI Tests (`Vitest` + `Testing Library` + `ExcelJS`)

Executed via:
```bash
cd frontend
npm run typecheck
npm test
npm run build
```

| Suite File | Cases Covered | Verified Behavior |
|---|---|---|
| [metrics.test.ts](../frontend/src/calculations/__tests__/metrics.test.ts) | **6 tests** | Pure all-5 (`5.00`), all-1 (`1.00`), mixed scores rounded to 2 decimal places (`3.96`, `3.87`), `0`-response null/safe division (no `NaN`/`Infinity`), **pooled combined-class weighting** (`(200+10)/(40+10) = 4.20`, avoiding unweighted `(5+1)/2 = 3.00` trap), and full Teacher NPS `0..10` + group fallback (`+100`/`0`/`-100`). |
| [analytics.test.ts](../frontend/src/calculations/__tests__/analytics.test.ts) | **2 tests** | Centralized [`computeDashboardAnalytics`](../frontend/src/calculations/analytics.ts) verifying single-counted attendance across multi-grade sessions, pooled CSAT/ITP weighting, `PENDING`/district exclusions, zero-vote null safety, positive/neutral/negative sentiment breakdowns, missing-response tallies, and all 12 checks inside [`reconcileDashboardAnalytics`](../frontend/src/calculations/analytics.ts) (including detection of artificially tampered totals). |
| [validation.test.ts](../frontend/src/validations/__tests__/validation.test.ts) | **8 tests** | Valid single-class submission, UDISE 11-digit & leading-zero acceptance, PIN 6-digit format, rejection of unapproved districts (`Chennai`) & missing block lists (`"Block list not configured. Please contact the administrator."`), rejection of negative/decimal & over-capacity response counts, non-blocking `<75%` coverage & Q-A/Q-B mismatch warnings, midnight-spanning (`23:15` -> `00:45` = `90 mins` / `1 hr 30 mins`) & future date rejection, and combined `2..10` row + duplicate grade/section checks. |
| [sessionId.test.ts](../frontend/src/utils/__tests__/sessionId.test.ts) | **3 tests** | `CT_IN_YYYYMMDD_UDISE_GG_CLASS_NNN` prefixes (`_08_A_001`, `_09_NS`, `_CMB_03C`), `Promise.all` concurrent same-school/same-day collision serialization (`_001`, `_002`, `_003`), and `clientSubmissionKey` idempotency preventing duplicate rows on retry. |
| [repositorySecurity.test.ts](../frontend/src/services/__tests__/repositorySecurity.test.ts) | **6 tests** | Full create -> update (preserving immutable `sessionRecordId` & `sessionId`) -> archive -> audit log lifecycle; simulated crash mid-write staying `PENDING` and excluded from queries; strict RBAC blocking non-allowlisted admin elevation (`FORBIDDEN`), protecting both allowlisted Super Admins (`PROTECTED_ACCOUNT`), gating Google users via `manual_allowlist` (`PENDING_APPROVAL`) vs `auto_approve` (`facilitator` / `ACCESS_DENIED`), stripping sensitive config/Sheets telemetry for facilitators, and blocking cross-facilitator read/edit/archive; non-destructive UDISE collision handling; and [`syncService.ts`](../frontend/src/services/syncService.ts) idempotent outbox key overwrite, zero `idToken` storage, sync event logging, and `findDuplicateSessionCandidates`. |
| [export.test.ts](../frontend/src/services/__tests__/export.test.ts) | **2 tests** | Rejects non-63-column `.xlsx` templates and accepts valid 63-column `.xlsx`; generates Excel buffer expanding 3 combined classes into 3 output rows across exact 63 headers, verifying via `ExcelJS` round-trip readback that leading zeroes on UDISE (`01234567890`) & PIN (`006001`) retain `@` text format and dates export as `dd-mm-yyyy`. |
| [ui.test.tsx](../frontend/src/forms/__tests__/ui.test.tsx) | **7 tests** | Renders all 7 sections and missing-block notice; drives Validation Error Modal with `Jump`, Analogue Clock Picker + keyboard time input + combined class rows + Q-A/Q-B counts + Teacher NPS + `ReviewSubmissionModal` -> `SubmissionSuccessModal` without leaking Google Sheets telemetry to facilitators; triggers `DuplicateWarningModal`; verifies auto-saved local draft has no `idToken` + `ConfirmDialog` clear flow; tests `NETWORK_ERROR` queuing silently in Sync Outbox; verifies facilitator `MyClassesPage` strips export/totals and exercises all 12 Admin views in `AdminDashboardPage`; and verifies `<App />` URL redirects (`/admin/overview` for Super Admin, `/classroom-entry` for Facilitator), Pending Approval / Access Denied screens, and manual `/admin/overview` URL visit triggering Access Denied + redirect back to `/classroom-entry`. |

**Latest verified frontend execution:** `7` test files passed, **`34 / 34` unit, analytics, security, sync outbox, export, and React UI tests passing**; `npm run typecheck` and `npm run build` exited with code `0`.

---

### 1.2 Google Apps Script Backend End-to-End Verification (`Node VM` Suite)

Executed via:
```bash
node tests/apps-script-verify.mjs
```

The harness in [apps-script-verify.mjs](../tests/apps-script-verify.mjs) executes the 11 production `.gs` modules inside an isolated V8 `vm` context mocking Google Apps Script services (`SpreadsheetApp`, `LockService`, `CacheService`, `PropertiesService`, `Utilities`, `UrlFetchApp`, `ContentService`) and checks:
- `appsscript.json` uses `timeZone: "Asia/Kolkata"` and `runtimeVersion: "V8"`.
- `initializeDatabase()` creates all **8** required sheets (8-column `Facilitators`/`Admin Users` including `status`, zero password columns, and automatic seeding of `brinthajayaprakash888@gmail.com` and `karunya@vidhyavidhai.org`) with frozen headers and text formatting.
- Expired Google tokens -> `UNAUTHENTICATED`; new Google accounts under `manual_allowlist` -> idempotent `PENDING` queue (`PENDING_APPROVAL`); `auto_approve` -> automatic `facilitator` entry; denied users -> `ACCESS_DENIED`.
- Dual allowlisted Super Admins (`SA_BRINTHA` & `SA_KARUNYA`) authenticate cleanly, cannot be deactivated/demoted (`PROTECTED_ACCOUNT`), and cannot elevate non-allowlisted users (`FORBIDDEN`).
- Parity between [Calculations.gs](../apps-script/Calculations.gs) and frontend calculation math (pooled CSAT `4.2`), forged browser `facilitatorEmail` ignored in favor of verified Google token email (`fac1@example.org`), and leading-zero UDISE/PIN preservation.
- Strict facilitator `getAppConfiguration` sanitization (`partnerName: ''`, `exportTemplate63: null`, `allowFacilitatorExportOwn: false`), cross-facilitator isolation (`getSessionById`), and `FORBIDDEN` rejection across all 10 admin/export/school endpoints (`getDashboardSummary`, `getAdminSessions`, `listManagedUsers`, `manageUser`, `getAuditLogs`, `getSyncLogs`, `logExportEvent`, `searchSchools`, `saveAppConfiguration`, `importBlockMaster`).
- Admin `updateSession` reducing detail rows (`2 -> 1`) via row-level deletion while preserving original `sessionId` and setting status to `CORRECTED`, plus backend analytics `reconciliation.verified === true`.
- Every `LockService.getScriptLock().waitLock()` call has a paired `releaseLock()`.
- Both `Audit Log` and `Sync Log` (`createSession` / `updateSession`) entries recorded cleanly for Super Administrators.

---

## 2. Live Environment Verification Status (Pending Administrator Setup)

The following tests **have not yet been run** against live Google cloud infrastructure because no Google Workspace OAuth Client ID or live Google Spreadsheet exists in this offline environment:

| Live UAT Test ID | Procedure After Deployment | Expected Outcome |
|---|---|---|
| **LIVE-01** | Open Web App URL (`doGet`) in browser | Returns JSON `{ "ok": true, "status": "READY" }` |
| **LIVE-02** | Run `initializeDatabase()` in Apps Script editor | Creates/verifies 8 formatted tabs (including `Sync Log`) and seeds `brinthajayaprakash888@gmail.com` & `karunya@vidhyavidhai.org` in `Admin Users` with zero passwords |
| **LIVE-03** | Sign in with unlisted Gmail via live Google Sign-In button | Under `manual_allowlist`, enters `PENDING` queue (`Account Pending Approval`, zero app data exposed); once denied, triggers `Access Denied` + `AUTH_DENIED` audit row |
| **LIVE-04** | Import real `Cuddalore`, `Nagapattinam`, `Sivaganga` blocks & 63-col template | Unapproved district rejected; 63-col template headers saved in `Configuration` |
| **LIVE-05** | Concurrent live submission test from two facilitators at same school/date | Serialized cleanly via `LockService`; `_001` and `_002` generated with no row clobbering |
| **LIVE-06** | Export combined session `.xlsx` from live Admin Console & open in Excel | Exactly 63 headers in order; 1 row per grade/section; leading zeroes preserved on UDISE/PIN |
| **LIVE-07** | Responsive device check (Desktop `1440px`, Tablet `768px`, Mobile `375px` iOS/Android) | Zero horizontal overflow on forms; responsive `<1024px` Admin popover drawer; easy touch targets (`>= 44px` controls) |
