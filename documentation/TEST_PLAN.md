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
VITE_BASE_PATH=/ npm run build
```

| Suite File | Cases Covered | Verified Behavior |
|---|---|---|
| [metrics.test.ts](../frontend/src/calculations/__tests__/metrics.test.ts) | **6 tests** | Pure all-5 (`5.00`), all-1 (`1.00`), mixed scores rounded to 2 decimal places (`3.96`, `3.87`), `0`-response null/safe division (no `NaN`/`Infinity`), **pooled combined-class weighting** (`(200+10)/(40+10) = 4.20`, avoiding unweighted `(5+1)/2 = 3.00` trap), and full Teacher NPS `0..10` + group fallback (`+100`/`0`/`-100`). |
| [analytics.test.ts](../frontend/src/calculations/__tests__/analytics.test.ts) | **3 tests** | Centralized [`computeDashboardAnalytics`](../frontend/src/calculations/analytics.ts) verifying single-counted attendance across multi-grade sessions, pooled CSAT/ITP weighting, `PENDING`/district exclusions, zero-vote null safety, positive/neutral/negative sentiment breakdowns, missing-response tallies, single-month baseline vs multi-month period comparisons, and all 12 checks inside [`reconcileDashboardAnalytics`](../frontend/src/calculations/analytics.ts) (including detection of artificially tampered totals). |
| [validation.test.ts](../frontend/src/validations/__tests__/validation.test.ts) | **8 tests** | Valid single-class submission, UDISE 11-digit & leading-zero acceptance, PIN 6-digit format, rejection of unapproved districts (`Chennai`) while accepting approved Tamil Nadu districts cleanly without any Block dependency, rejection of negative/decimal & over-capacity response counts, non-blocking `<75%` coverage & Q-A/Q-B mismatch warnings, midnight-spanning (`23:15` -> `00:45` = `90 mins` / `1 hr 30 mins`) & future date rejection, and combined `2..10` row + duplicate grade/section checks. |
| [sessionId.test.ts](../frontend/src/utils/__tests__/sessionId.test.ts) | **3 tests** | `CT_IN_YYYYMMDD_UDISE_GG_CLASS_NNN` prefixes (`_08_A_001`, `_09_NS`, `_CMB_03C`), `Promise.all` concurrent same-school/same-day collision serialization (`_001`, `_002`, `_003`), and `clientSubmissionKey` idempotency preventing duplicate rows on retry. |
| [routes.test.ts](../frontend/src/utils/__tests__/routes.test.ts) | **2 tests** | SPA path normalization and RBAC route parsing for both root (`/`) and subpath (`/vidhyavidhai/`) deployments. |
| [repositorySecurity.test.ts](../frontend/src/services/__tests__/repositorySecurity.test.ts) | **15 tests** | Full create -> update (preserving immutable `sessionRecordId` & `sessionId`) -> archive/restore -> delete/bulk-delete -> audit log lifecycle; simulated crash mid-write staying `PENDING` and excluded from queries; strict RBAC blocking non-allowlisted admin elevation (`FORBIDDEN`), protecting both allowlisted Super Admins (`PROTECTED_ACCOUNT`), salted PBKDF2-SHA256 Super Admin authentication + resume tokens, remembered accounts (>4) across reloads, gating Google users via `manual_allowlist` vs `auto_approve`, stripping sensitive config/Sheets telemetry for facilitators, and blocking cross-facilitator read/edit/archive; non-destructive UDISE collision handling; `syncService.ts` idempotent outbox key overwrite; `/api/sheets` OAuth CRUD & transient retry; and Apps Script Sync Bridge bundle (`CareerToursAllInOne.gs`) verification. |
| [export.test.ts](../frontend/src/services/__tests__/export.test.ts) | **4 tests** | Validates official 63-column `.xlsx` templates (rejecting non-63-col files), expands combined-class sessions across 63 headers with leading-zero `@` text retention and `dd-mm-yyyy` dates, and validates generated schema-ready initialized database workbooks (asserting 41-col `Sessions` and 10-col `Schools` without any `block` column, plus 0-row Summary & KPIs and Declarations). |
| [googleSheetsDirectService.test.ts](../frontend/src/services/__tests__/googleSheetsDirectService.test.ts) | **4 tests** | Deterministic IST-aware relative spreadsheet titles (`<= 100` chars), memory-only OAuth access token isolation, idempotent 10-tab workspace push + live CRUD (verifying 41-col `Sessions` and 10-col `Schools`), and non-destructive migration of legacy 42-col `Sessions`, 11-col `Schools`, and `Configuration` `district_blocks` rows while preserving existing data. |
| [topQuickSync.test.tsx](../frontend/src/components/__tests__/topQuickSync.test.tsx) | **3 tests** | `TopGoogleSheetsQuickBar` end-to-end UI flow for Super Admins (relative title generation, OAuth create & idempotent push without duplicates, personalized `CareerToursAllInOne.gs` Apps Script Bridge connection + persistence across sign-out/sign-in) and complete hiding with zero `/api/sheets` or `googleapis` calls for Facilitators. |
| [ui.test.tsx](../frontend/src/forms/__tests__/ui.test.tsx) | **17 tests** | Renders all 7 form sections cleanly without any Block dropdown/field or Settings block coverage cards; drives Validation Error Modal with `Jump`, Analogue Clock Picker + keyboard time input, combined class rows, Q-A/Q-B counts, Teacher NPS, `ReviewSubmissionModal` -> `SubmissionSuccessModal` without leaking Sheets telemetry to facilitators; tests `DuplicateWarningModal`, synchronous `pagehide` draft flush, offline Sync Outbox replay, Facilitator `MyClassesPage` isolation, all 12 Admin views, empty-state vs filtered Analytics charts, OAuth/Live Google Sheets banners & transient polling resilience, remembered accounts across reloads, and inline accessible PBKDF2 password login & password updates without `/access-denied` redirects. |

**Latest verified frontend execution:** **`10` test files passed, `65 / 65` unit, analytics, security, sync, export, migration, and React UI tests passing**; `npm run typecheck` and `VITE_BASE_PATH=/ npm run build` exited with code `0`.

---

### 1.2 Google Apps Script Backend End-to-End Verification (`Node VM` Suite)

Executed via:
```bash
node tests/apps-script-verify.mjs
```

The harness in [apps-script-verify.mjs](../tests/apps-script-verify.mjs) executes the 11 production `.gs` modules inside an isolated V8 `vm` context mocking Google Apps Script services (`SpreadsheetApp`, `LockService`, `CacheService`, `PropertiesService`, `Utilities`, `UrlFetchApp`, `ContentService`), plus the built single-file [`CareerToursAllInOne.gs`](../apps-script/dist/CareerToursAllInOne.gs) bundle, and checks across **15 sections**:
- `appsscript.json` uses `timeZone: "Asia/Kolkata"` and `runtimeVersion: "V8"`.
- `initializeDatabase()` creates/verifies all **8** required sheets (41-col `Sessions` and 10-col `Schools` with zero `block` column, 8-col `Admin Users`/`Facilitators`, frozen headers, `@` text formatting, and automatic seeding of `brinthajayaprakash888@gmail.com` and `karunya@vidhyavidhai.org` with zero passwords).
- Expired Google tokens -> `UNAUTHENTICATED`; new Google accounts under `manual_allowlist` -> idempotent `PENDING` queue (`PENDING_APPROVAL`); `auto_approve` -> automatic `facilitator` entry; denied users -> `ACCESS_DENIED`.
- Dual allowlisted Super Admins (`SA_BRINTHA` & `SA_KARUNYA`) authenticate cleanly, cannot be deactivated/demoted (`PROTECTED_ACCOUNT`), and cannot elevate non-allowlisted users (`FORBIDDEN`).
- Parity between [Calculations.gs](../apps-script/Calculations.gs) and frontend calculation math (pooled CSAT `4.2`), forged browser `facilitatorEmail` ignored in favor of verified Google token email (`fac1@example.org`), and leading-zero UDISE/PIN preservation.
- Strict facilitator `getAppConfiguration` sanitization (`partnerName: ''`, `exportTemplate63: null`, `allowFacilitatorExportOwn: false`), cross-facilitator isolation (`getSessionById`), and `FORBIDDEN` rejection across all admin/export/school endpoints (`getDashboardSummary`, `getAdminSessions`, `listManagedUsers`, `manageUser`, `getAuditLogs`, `getSyncLogs`, `logExportEvent`, `searchSchools`, `saveAppConfiguration`, plus `UNKNOWN_ACTION` for retired `importBlockMaster` / `getBlocksForDistrict`).
- Admin `updateSession` reducing detail rows (`2 -> 1`) via row-level deletion while preserving original `sessionId` and setting status to `CORRECTED`, plus backend analytics `reconciliation.verified === true`.
- Google Sheets connection RPCs (`connectGoogleSheet`, `syncAllToGoogleSheet`, `createGoogleSheet`, `disconnectGoogleSheet`), single-file bundle bridge authentication via `CT_PRESET_SANDBOX_SYNC_KEY`, non-destructive migration of legacy 42-col `Sessions`, 11-col `Schools`, and `Configuration` `district_blocks` rows while preserving existing session/school/config data, and balanced `LockService.getScriptLock().waitLock()` / `releaseLock()` pairing across all `Audit Log` and `Sync Log` writes.

---

### 1.3 Vercel Google Sheets OAuth 2.0 + Sheets v4 API Verification (`Node` Suite)

Executed via:
```bash
node tests/sheets-api-verify.mjs
```

The harness in [sheets-api-verify.mjs](../tests/sheets-api-verify.mjs) exercises [api/sheets.mjs](../api/sheets.mjs) end-to-end against stateful Drive v3 & Sheets v4 mocks across:
- Spreadsheet ID parsing, AES-256-GCM cookie encryption + tamper resistance, fail-closed missing-credential checks, OAuth CSRF state validation, proactive 5-minute token refresh rotation, HTTP 401 retry recovery, and cross-origin `SameSite=None; Secure` CORS preflight.
- Full authenticated Sheets CRUD (`createSession`, `loadWorkspace`, `updateSession`, `archiveSession`, `restoreSession`, `deleteSession`, `bulkDeleteSessions`, `updateSchool`, `deleteSchool`, `manageUser`, `deleteUser`, `saveConfiguration`, `logExportEvent`) verifying 41-col `Sessions` and 10-col `Schools` without any `block` column, plus non-destructive migration (`Section 4w`) of legacy 42-col `Sessions`, 11-col `Schools`, and `Configuration` `district_blocks` rows.

---

## 2. Live Environment Verification Status (Pending Administrator Setup)

The following tests **have not yet been run** against live Google cloud infrastructure because no Google Workspace OAuth Client ID or live Google Spreadsheet exists in this offline environment:

| Live UAT Test ID | Procedure After Deployment | Expected Outcome |
|---|---|---|
| **LIVE-01** | Open Web App URL (`doGet`) in browser | Returns JSON `{ "ok": true, "status": "READY" }` |
| **LIVE-02** | Run `initializeDatabase()` in Apps Script editor | Creates/verifies 8 formatted tabs (including `Sync Log`) and seeds `brinthajayaprakash888@gmail.com` & `karunya@vidhyavidhai.org` in `Admin Users` with zero passwords |
| **LIVE-03** | Sign in with unlisted Gmail via live Google Sign-In button | Under `manual_allowlist`, enters `PENDING` queue (`Account Pending Approval`, zero app data exposed); once denied, triggers `Access Denied` + `AUTH_DENIED` audit row |
| **LIVE-04** | Configure `Partner Name`, tours & 63-col template in Settings | Unapproved district rejected; 63-col template headers saved in `Configuration` |
| **LIVE-05** | Concurrent live submission test from two facilitators at same school/date | Serialized cleanly via `LockService`; `_001` and `_002` generated with no row clobbering |
| **LIVE-06** | Export combined session `.xlsx` from live Admin Console & open in Excel | Exactly 63 headers in order; 1 row per grade/section; leading zeroes preserved on UDISE/PIN |
| **LIVE-07** | Responsive device check (Desktop `1440px`, Tablet `768px`, Mobile `375px` iOS/Android) | Zero horizontal overflow on forms; responsive `<1024px` Admin popover drawer; easy touch targets (`>= 44px` controls) |
