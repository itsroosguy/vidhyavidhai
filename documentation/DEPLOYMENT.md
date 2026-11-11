# Deployment & Operations Guide

This guide describes how to deploy updates safely to production for both the Google Apps Script backend and the React Vite static frontend.

---

## 1. Security & Hosting Architecture Overview

```text
Browser (HTTPS Static Host)
  │  Google Identity Services -> obtains signed Google idToken (JWT)
  │
  └─▶ POST (Content-Type: text/plain;charset=utf-8)
        Body: { action, idToken, payload }
          │
          ▼
Google Apps Script Web App (appsscript.json)
  │  executeAs: USER_DEPLOYING
  │  access: ANYONE_ANONYMOUS
  ├─▶ Auth.gs: UrlFetchApp -> oauth2.googleapis.com/tokeninfo
  │     Checks aud === GOOGLE_CLIENT_ID, email_verified === true, exp > now
  ├─▶ Auth.gs: Reads server-owned Admin Users / Facilitators sheets -> assigns role
  ├─▶ Sessions.gs / Admin.gs: LockService.getScriptLock().waitLock(20000)
  └─▶ Private Google Spreadsheet (Sessions, Session Details, Schools, Facilitators, Admin Users, Configuration, Audit Log, Sync Log)
```

### Why `Content-Type: text/plain;charset=utf-8` and `ANYONE_ANONYMOUS`?
1. Google Apps Script Web Apps do **not** respond to browser `OPTIONS` CORS preflight requests triggered by `application/json`. Sending `Content-Type: text/plain;charset=utf-8` ([`AppsScriptApiClient`](../frontend/src/services/apiClient.ts#L89-L94)) makes every request a simple CORS `POST`, while [`doPost`](../apps-script/Code.gs#L28-L35) parses `e.postData.contents` via `JSON.parse`.
2. Setting Apps Script access to `ANYONE_ANONYMOUS` allows cross-origin `POST` calls from your static web domain without Apps Script returning an HTML interstitial login page. Access to data is strictly blocked unless the payload includes a valid, verified Google `idToken` whose email either matches the server-side `SUPER_ADMIN` allowlist (`brinthajayaprakash888@gmail.com` or `karunya@vidhyavidhai.org`) or resolves as an approved `facilitator` in `Facilitators` (subject to `policy.facilitatorApprovalMode`; pending or denied accounts are rejected with `PENDING_APPROVAL` or `ACCESS_DENIED`).
3. Note why `Session.getActiveUser()` is **not** relied upon: under `executeAs: USER_DEPLOYING` with anonymous web access across different domains or standard `@gmail.com` accounts, `Session.getActiveUser()` is empty or unreliable. Explicit OAuth `idToken` verification solves this cleanly.

---

## 2. Deploying / Updating Google Apps Script Backend

1. Open the Apps Script project bound/connected to your production Spreadsheet.
2. Update any modified `.gs` files or `appsscript.json` from `/apps-script/`.
   - Confirm `appsscript.json` keeps `"timeZone": "Asia/Kolkata"` and `"runtimeVersion": "V8"`.
   - Confirm Script Properties (`SPREADSHEET_ID`, `GOOGLE_CLIENT_ID`) remain intact (zero passwords or admin email overrides stored in Script Properties).
3. Click **Deploy > Manage deployments > Edit (pencil icon) > Version: New version** -> **Deploy**.
   - Re-using the active deployment ID keeps `VITE_APPS_SCRIPT_URL` unchanged across updates!
4. Run a smoke test:
   - Open the deployment URL in browser (`GET`): confirm `{ "ok": true, "status": "READY" }`.
   - If any schema columns changed in `SetupDatabase.gs`, run `initializeDatabase()` manually once.

---

## 3. Building & Deploying the Frontend

### Build Production Bundle

```bash
cd frontend
npm ci
npm run typecheck
npm test
npm run build
```

Verified bundle layout (Vite production build):
- Static assets output to `frontend/dist/`
- `exceljs` is dynamically code-split ([`loadExcelJS`](../frontend/src/services/exportService.ts#L10-L13), [`MasterDataSettings`](../frontend/src/admin/MasterDataSettings.tsx#L158)) so initial page load stays lightweight while full `.xlsx` parsing/generation loads only when exporting or uploading spreadsheets.

### Hosting Options (HTTPS Required for Google Sign-In)

Google Identity Services requires **HTTPS** in production (`http://localhost` works locally). Deploy `frontend/dist/` to any static CDN/host:

- **GitHub Pages (`main` root or `gh-pages` branch + custom domain `vidhyavidhai.roosstudiox.com`):**
  - Build `frontend/dist/` using [`vite.config.ts`](../frontend/vite.config.ts) (`VITE_BASE_PATH=/` for custom domains like `vidhyavidhai.roosstudiox.com`, or `VITE_BASE_PATH=/vidhyavidhai/` if serving directly from `https://<username>.github.io/vidhyavidhai/`). The [`npm run build`](../frontend/package.json) script generates `404.html` and `.nojekyll` automatically for SPA deep links.
  - Both repository root (`/` on `main`) and the `gh-pages` branch contain the synced static bundle (`index.html`, `404.html`, `.nojekyll`, `assets/`, [`CNAME`](../CNAME)), so either `Deploy from a branch -> main / (root)` or `Deploy from a branch -> gh-pages / (root)` serves the app cleanly. After any future `frontend/` update, re-run `VITE_BASE_PATH=/ npm run build` and sync `frontend/dist/` to root/`gh-pages`.
  - Once GitHub finishes DNS verification for `vidhyavidhai.roosstudiox.com` (`CNAME -> itsroosguy.github.io`) and provisions the TLS certificate, enable **Enforce HTTPS** in **Settings → Pages**.
- **Firebase Hosting:**
  - Set `public: "frontend/dist"` and SPA rewrite `"source": "**", "destination": "/index.html"` in `firebase.json`.
  - Run `firebase deploy --only hosting`.
- **Netlify / Vercel / Cloudflare Pages:**
  - **Base / root directory:** `frontend`
  - **Build command:** `npm run build`
  - **Output directory:** `dist`
  - **Environment variables:** Configure `VITE_APPS_SCRIPT_URL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_PROGRAMME_TIMEZONE=Asia/Kolkata` in host build settings **before** building (Vite embeds `VITE_*` variables at build time).

### Update Authorized JavaScript Origins
After receiving your live production URL (e.g., `https://career-tours.example.org`), add that exact origin (scheme + host, no trailing slash) to **Authorized JavaScript origins** in Google Cloud Console under your OAuth 2.0 Web Client ID. Changes typically propagate within 5 minutes.

---

## 4. Production Smoke Verification Checklist (After Live Deployment)

Run these checks directly against the live URL after deployment:
1. **Pending approval & denied rejection:** Under default `manual_allowlist` policy, sign in with an unlisted personal Gmail account -> verify `PENDING_APPROVAL` triggers cleanly, `Account Pending Approval` screen appears with zero app data exposed, and denying that user produces `ACCESS_DENIED` (`AUTH_DENIED` logged in `Audit Log`).
2. **Allowlisted Super Admin sign-in & onboarding:** Sign in via Google OAuth with `brinthajayaprakash888@gmail.com` or `karunya@vidhyavidhai.org` -> verify automatic redirect to `/admin/overview`, set `Partner Name`, upload the 63-column `.xlsx` template, and approve a test Facilitator in `/admin/user-management`.
3. **Facilitator save & Sheet formatting check:** Submit a session with a leading-zero UDISE (e.g., `01234567890`) and PIN (`006001`); inspect Google Sheets directly to confirm leading zeroes remained intact (`'@'` text cells) and `submission_status` shows `COMMITTED`.
4. **Concurrency check:** Have two signed-in test facilitators submit at the same school on the same date at the same moment -> verify distinct `_001` and `_002` Session IDs and zero overwritten rows.
5. **Admin dashboard & 63-column `.xlsx` export:** Sign in as Admin, apply filters, download `.xlsx`, open in Microsoft Excel / LibreOffice / Google Sheets, and verify exact 63 headers and combined-class multi-row expansion.
