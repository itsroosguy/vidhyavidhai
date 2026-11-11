# Career Tours Classroom Data Entry & Feedback Management System

A production-ready classroom data-entry, feedback calculation, and programme management platform for facilitators and administrators conducting Career Tours sessions across schools in **Tamil Nadu** (`Cuddalore`, `Nagapattinam`, and `Sivaganga`).

---

## Architecture & Directory Structure

```text
├── apps-script/               # Google Apps Script backend (V8, Asia/Kolkata)
│   ├── appsscript.json        # Web App deployment & minimal OAuth scopes
│   ├── SetupDatabase.gs       # Idempotent 8-tab Sheet initializer & text formatting (@)
│   ├── Auth.gs                # Server-side Google idToken verification & RBAC
│   ├── Code.gs                # doGet / doPost HTTP router
│   ├── Sessions.gs            # LockService mutations, PENDING->COMMITTED write, Sync Log & row updates
│   ├── Calculations.gs        # Pure CSAT, ITP, Teacher NPS, Duration, Session ID parity engine
│   ├── Validation.gs          # Authoritative server-side business rules
│   ├── Schools.gs             # UDISE lookup & non-destructive school upsert
│   ├── Configuration.gs       # Master config manager with CacheService acceleration
│   ├── Admin.gs               # Dashboard aggregations + 12-check reconciliation, user/role management
│   ├── Export.gs              # Flattened row builder & 63-column export validation
│   └── Audit.gs               # Append-only Audit Log & Sync Log writers/readers
│
├── frontend/                  # React 19 + TypeScript + Vite + Tailwind CSS v4
│   ├── src/
│   │   ├── admin/             # 12-section Super Admin Console (AdminDashboardPage, AdminNav, UserAccessManager, MasterDataSettings, GoogleSheetsSyncPanel, AuditLogViewer)
│   │   ├── calculations/      # Pooled CSAT/ITP, Teacher NPS, centralized dashboardAnalytics + reconcileDashboardAnalytics & Vitest suite
│   │   ├── components/
│   │   │   ├── charts/        # AnalyticsCharts (DistrictComparisonBars, SentimentStackedChart, MonthlyTrendsChart)
│   │   │   ├── layout/        # AppHeader, AuthGate
│   │   │   ├── modals/        # GlassModal + native top-layer <dialog> workflows (SubmissionForm, Review, Success, Validation, Duplicate, Sync, Export, DetailedAnalytics)
│   │   │   └── ui/            # AnalogueTimePicker, ConfirmDialog (with metadata panel), ToastNotification
│   │   ├── config/            # Approved programme defaults & initial blank form state
│   │   ├── dashboard/         # MyClassesPage & SessionDetailModal
│   │   ├── forms/             # SessionEntryForm + 7 continuous form sections (Section1..Section7)
│   │   ├── services/          # AppsScriptApiClient, LocalSandboxApiClient, syncService (outbox queue), authService, exportService, draftStorage
│   │   ├── styles/            # Google Sans font stack, Roos StudioX dark charcoal/glassmorphism/orange tokens & native <dialog> top-layer CSS
│   │   ├── types/             # Shared strict domain interfaces
│   │   ├── utils/             # Asia/Kolkata Temporal calculations, Session ID formatting, dialogTopLayer helpers, ARIA sync
│   │   └── validations/       # Blocking errors vs non-blocking review warnings
│   └── .env.example           # Required VITE_APPS_SCRIPT_URL & VITE_GOOGLE_CLIENT_ID
│
├── documentation/             # Full setup, deployment, database schema, user guide & test plan
│   ├── SETUP.md
│   ├── DEPLOYMENT.md
│   ├── DATABASE_SCHEMA.md
│   ├── USER_GUIDE.md
│   └── TEST_PLAN.md
│
└── tests/
    └── apps-script-verify.mjs # Node VM end-to-end backend verification harness
```

---

## Core Capabilities

- **Roos StudioX Dark Glassmorphism UI:** Refined `#101318` / `#171C24` charcoal surfaces paired with frosted glass navigation chrome and native top-layer `<dialog>` modals, `#F97316` strategic orange highlights, tabular numerals (`.ct-num`), Google Sans & Inter typography, zero italic styling, continuous 6 numbered sections (`About you`, `About the session`, `About the school`, `About the class`, `Students' answers`, `Teacher's answer` + `Your results`), Analogue Clock Picker + keyboard time entry, and collapsible formula working.
- **10-Modal Native `<dialog>` Workflow:** Quick-add & edit form modal (`SubmissionFormModal`), field-jump error summary (`ValidationErrorModal`), duplicate protection (`DuplicateWarningModal`), pre-submit verification (`ReviewSubmissionModal`), confirmation w/ `Copy ID` (`SubmissionSuccessModal`), rich metadata delete/clear confirmations (`ConfirmDialog`), Google Sheets health & outbox inspection (`GoogleSheetsSyncModal`), `.xlsx` preview & schema toggle (`ExportReportModal`), session inspector (`SessionDetailModal`), and drill-down slice analytics (`DetailedAnalyticsModal`).
- **Mathematically Verified Metrics & Reconciliation:**
  - Class and pooled combined-class **CSAT** & **ITP** averages: `sum(5*s5 + 4*s4 + 3*s3 + 2*s2 + 1*s1) / sum(responses)` (2 decimals; avoids unweighted averaging errors).
  - **Teacher NPS:** `Promoter (9–10)` = `+100`, `Passive (7–8)` = `0`, `Detractor (0–6)` = `-100`.
  - Centralized `computeDashboardAnalytics` + 12-check `reconcileDashboardAnalytics` cross-checking KPI attendance totals, response pools, sentiment splits, and NPS counts.
  - Exact `Asia/Kolkata` duration across midnight/multi-day sessions via `temporal-polyfill`.
- **Concurrency, Sync Outbox & Data Integrity:**
  - Daily collision-safe Session IDs (`CT_IN_YYYYMMDD_UDISE_GG_CLASS_NNN`, supporting `NS` and `CMB_XXC`) generated inside `LockService.getScriptLock()`.
  - `PENDING -> COMMITTED` 2-phase commits with `clientSubmissionKey` idempotency, row-level updates, client-side offline Sync Outbox (`syncService.ts`), and `Sync Log` 8th sheet tracking.
  - 11-digit UDISE & 6-digit PIN preserved as `@` plain text across Google Sheets and `.xlsx` exports; existing School Master names never silently overwritten on UDISE mismatch.
- **Role-Based Access Control & Strict Facilitator Isolation (`Auth.gs` + URL Route Guard):**
  - **Passwordless Google OAuth Sign-In (`idToken` verified server-side):** Zero passwords in frontend code, backend scripts, or Google Sheets.
  - **Dual Protected `SUPER_ADMIN` Allowlist:** Exclusively `brinthajayaprakash888@gmail.com` (`SA_BRINTHA`) and `karunya@vidhyavidhai.org` (`SA_KARUNYA`) resolve to `super_admin` and redirect to `/admin/overview` upon login. Non-allowlisted users can never be elevated to admin privileges (`FORBIDDEN`).
  - **Facilitator Approval Gating & Strict Isolation:** Other Google users resolve only as `facilitator` (subject to `manual_allowlist` or `auto_approve`), redirect directly to `/classroom-entry`, and see **only** the classroom entry form and their own submission history (`/my-classes`) — with zero analytics, KPIs, totals, other facilitators' data, reports, exports, settings, user management, or Google Sheets telemetry. Manual navigation to any restricted URL triggers an explicit **Access Denied** screen and redirects back to `/classroom-entry`.
  - **Architecture Note:** All RBAC policies, server-side authorization, and persistence are implemented in Google Apps Script + private 8-tab Google Sheets (with local offline sandbox mirroring in `LocalSandboxApiClient`) rather than Supabase.
- **Excel `.xlsx` Reporting:** Code-split `ExcelJS` exporter expanding combined sessions strictly to **1 row per grade/section** with strict 63-column official template header validation.

---

## Local Development & Verification

```bash
# Install frontend dependencies
cd frontend
npm install

# Run TypeScript check, Vitest unit/UI/export suite, and Vite production build
npm run typecheck
npm test
npm run build

# Run Google Apps Script V8 backend verification suite (from project root)
cd ..
node tests/apps-script-verify.mjs

# Start local dev server (launches in isolated local sandbox mode when .env is empty)
cd frontend
npm run dev
```

---

## Items Pending Live Configuration by Programme Administrator

Per strict no-fabrication safeguards, no synthetic defaults were invented for unprovided programme data. After completing [SETUP.md](./documentation/SETUP.md), sign in with either allowlisted Super Administrator Google account (`brinthajayaprakash888@gmail.com` or `karunya@vidhyavidhai.org`) and configure inside **Admin Console → Settings** (`/admin/settings`) and **User Management** (`/admin/user-management`):

1. **Partner Name** for reporting rows.
2. **Official 63-Column `.xlsx` Template** upload (to capture exact reporting column headers 1–63).
3. **Tour Video IDs** (e.g., for *Robotics Fulfillment Center* and non-Tamil languages of *Amazon Music*).
4. **Live Google Cloud OAuth Client ID (`VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID`) & Apps Script Deployment (`VITE_APPS_SCRIPT_URL`)**.

See [SETUP.md](./documentation/SETUP.md) and [DEPLOYMENT.md](./documentation/DEPLOYMENT.md) for step-by-step instructions.
