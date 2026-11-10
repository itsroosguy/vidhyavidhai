# Setup Guide — Career Tours Classroom Data Entry & Feedback Management System

This guide covers end-to-end initial provisioning across **Google Cloud Console (OAuth)**, **Google Sheets**, **Google Apps Script**, and the **React + Vite frontend**.

> **Current repository status:** The local frontend sandbox and the offline Google Apps Script VM test suite are implemented and verified. Live Google Cloud OAuth, Google Sheets spreadsheet creation, and Apps Script Web App deployment require a Google account and must be configured using the steps below.

---

## 1. Prerequisites

- **Node.js** `>= 20` and **npm** (verified in this workspace with Node `v26.8.2` / npm `11.19.1`)
- A **Google Account** with permission to create Google Sheets, Apps Script projects, and Google Cloud OAuth 2.0 Web Client IDs
- Official programme reference inputs (to be uploaded/entered by the Super Administrator after first sign-in):
  1. Official **District–Block master list** (`.csv` or `.xlsx`) strictly for `Cuddalore`, `Nagapattinam`, and `Sivaganga`
  2. Official **63-column reporting Excel template** (`.xlsx`)
  3. **Partner Name** string for reporting exports
  4. **Video ID(s)** for *Robotics Fulfillment Center* (and any non-Tamil languages for *Amazon Music: Careers Behind the Beats*)

---

## 2. Create the Google Identity Services (OAuth 2.0) Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Open **APIs & Services > OAuth consent screen**:
   - Configure App Name (`Career Tours Classroom System`), Support Email, and Audience (`Internal` for Workspace domain only, or `External` in Production for partner Gmail/Workspace facilitators).
3. Open **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - **Application type:** `Web application`
   - **Name:** `Career Tours Web Portal`
   - **Authorized JavaScript origins:**
     - Local development: `http://localhost:5173`
     - Production frontend URL: `https://<your-deployed-domain>`
   - **Authorized redirect URIs:** Not required for the Google Identity Services Sign-In button (`idToken` flow), though adding your origin URL does no harm.
4. Copy the generated **Client ID** (`<something>.apps.googleusercontent.com`). Keep it handy for both Apps Script and `frontend/.env`.

---

## 3. Create the Central Google Spreadsheet & Apps Script Backend

1. Create a new blank Google Spreadsheet in Google Drive (e.g., `Career_Tours_Central_Database_PROD`) and keep it **private** (do not share publicly).
2. Copy its Spreadsheet ID from the browser URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
3. Open [script.google.com](https://script.google.com/) (or open **Extensions > Apps Script** from the spreadsheet) and create a new project (`Career Tours API`).
4. Enable the manifest file in Apps Script:
   - Click **Project Settings** (gear icon) and check **"Show 'appsscript.json' manifest file in editor"**.
5. Replace/create all **12 files** from `/apps-script/` with exact matching filenames:
   - `appsscript.json`
   - `Audit.gs`
   - `Configuration.gs`
   - `Auth.gs`
   - `Calculations.gs`
   - `Validation.gs`
   - `Schools.gs`
   - `SetupDatabase.gs`
   - `Sessions.gs`
   - `Admin.gs`
   - `Export.gs`
   - `Code.gs`
6. Set Script Properties under **Project Settings > Script Properties**:

| Property Key | Required Value |
|---|---|
| `SPREADSHEET_ID` | The Google Spreadsheet ID copied in step 2 (recommended even when container-bound) |
| `GOOGLE_CLIENT_ID` | Your Google OAuth 2.0 Web Client ID from Section 2 |

> **Allowlisted Initial Super Administrators (Zero Hardcoded Passwords):** Only `brinthajayaprakash888@gmail.com` (`SA_BRINTHA`) and `karunya@vidhyavidhai.org` (`SA_KARUNYA`) are permitted `super_admin` privileges via the server-side allowlist in [`Auth.gs`](../apps-script/Auth.gs) and [`accessControl.ts`](../frontend/src/config/accessControl.ts). Never store passwords anywhere in source code, Script Properties, `.env` files, or Google Sheets.

7. In the Apps Script editor, select **`initializeDatabase`** from `SetupDatabase.gs` and click **Run**:
   - Grant requested permissions (`spreadsheets`, `script.external_request` for verifying `idToken` against Google `tokeninfo`, and `userinfo.email`).
   - Confirm all 8 sheets (`Sessions`, `Session Details`, `Facilitators`, `Schools`, `Configuration`, `Admin Users`, `Audit Log`, `Sync Log`) are created with frozen header rows and `@` plain-text formatting, and confirm both protected `super_admin` rows (`brinthajayaprakash888@gmail.com` and `karunya@vidhyavidhai.org`) are seeded into `Admin Users`.
   - Once running, signed-in **Super Administrators** can click the header **Google Sheets connected** / **Local sandbox mode** pill or open **Admin Console → Google Sheets Sync** (`/admin/google-sheets-sync`) to run `pingHealth()` diagnostics and inspect `Sync Log` events. *(Facilitator sessions intentionally hide all Google Sheets telemetry and sync chrome.)*

---

## 4. Deploy Apps Script Web App Endpoint (Brief Check)

1. Click **Deploy > New deployment > Select type: Web app**.
2. Set:
   - **Execute as:** `Me` (`USER_DEPLOYING`)
   - **Who has access:** `Anyone` (`ANYONE_ANONYMOUS`) — required so cross-origin browser `fetch()` requests reach `doPost` without Google Workspace HTML login redirects; every `doPost` call immediately validates the caller's Google Identity Services `idToken` against `https://oauth2.googleapis.com/tokeninfo` and enforces sheet-backed RBAC (`Auth.gs`).
3. Authorize and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
4. Verify health check in a browser or `curl`: visiting the Web App URL (`doGet`) should return JSON with `"ok": true, "status": "READY"`.

*(See [DEPLOYMENT.md](./DEPLOYMENT.md) for version updates and production hosting details.)*

---

## 5. Configure & Run the Frontend Locally

```bash
cd frontend
cp .env.example .env
npm install
```

Edit `frontend/.env`:

```dotenv
# Google Apps Script Web App Deployment URL (from Deploy > Manage deployments)
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec

# Google Identity Services OAuth 2.0 Web Client ID
VITE_GOOGLE_CLIENT_ID=REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com

# Programme timezone
VITE_PROGRAMME_TIMEZONE=Asia/Kolkata
```

> **Local Sandbox Mode:** If `VITE_APPS_SCRIPT_URL` and `VITE_GOOGLE_CLIENT_ID` are left blank, the frontend runs in isolated `local_sandbox` mode ([`LocalSandboxApiClient`](../frontend/src/services/apiClient.ts)) with sandbox role switching so UI, calculations, validation, and `.xlsx` export can be tested locally without connecting to Google servers. Once both `.env` variables are set, live Google Sign-In (`AuthGate`) activates automatically and sandbox switching is disabled.

Start the local development server:

```bash
npm run dev
```

---

## 6. Post-Setup Super Administrator Onboarding Checklist

Sign in with Google using an allowlisted Super Administrator account (`brinthajayaprakash888@gmail.com` or `karunya@vidhyavidhai.org`). You will land automatically on **`/admin/overview`**. Complete these four mandatory steps before onboarding facilitators:

1. **District–Block Master Data (`Admin Console → Settings`):** Upload `.csv` or `.xlsx` (`District, Block, Active`) or paste CSV rows for `Cuddalore`, `Nagapattinam`, and `Sivaganga`, preview validation, and click **Apply Valid Import**.
2. **Partner Name & Tour Video IDs (`Admin Console → Settings`):** Set **Partner Name**, verify `School Year`, select language(s) in **Career Tour Inventory & Configured Video IDs** to enter Video IDs (such as for *Robotics Fulfillment Center*), and set facilitator delete policy (`allowFacilitatorDeleteOwn`; Facilitator `.xlsx` export stays disabled permanently).
3. **Official 63-Column Reporting Template (`Admin Console → Settings`):** Upload your official `.xlsx` template, verify each header `#1..#63` mapping to flattened export fields (plus constants/blanks where applicable), and click **Save System Configuration**.
4. **Facilitator Approval Policy & Directory (`Admin Console → User Management`):** Choose your **Google Sign-In Approval Policy** (`manual_allowlist` default or `auto_approve`), pre-approve Facilitator Google email addresses, and approve or deny pending Google Sign-In requests from the Pending Queue. Admin privileges remain strictly locked to the two protected `SUPER_ADMIN` accounts.
