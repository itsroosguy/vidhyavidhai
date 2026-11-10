# User Guide — Facilitators & Super Administrators

This guide explains day-to-day workflows for **Facilitators** and **Super Administrators** using the Career Tours Classroom Data Entry & Feedback Management System.

---

## 1. Signing In, Account Security & Approval Policy

1. Open the portal URL in Chrome, Edge, Safari, or a mobile browser.
2. Click the **Sign in with Google** button ([AuthGate](../frontend/src/components/layout/AuthGate.tsx)). Zero passwords are stored or accepted in the application.
   - **Initial Super Administrators:** Only `brinthajayaprakash888@gmail.com` and `karunya@vidhyavidhai.org` authenticate with full `SUPER_ADMIN` access and automatically redirect to **`/admin/overview`**.
   - **All Other Users (Facilitators):** Authenticated automatically via their verified Google email and assigned the **`Facilitator`** role only (subject to the configured approval policy):
     - Under **`manual_allowlist` (default):** First-time Google users are automatically logged as `PENDING` and shown **Account Pending Approval** with zero programme data exposed until a Super Administrator approves them in `/admin/user-management`.
     - Under **`auto_approve`:** Verified Google users enter directly into the classroom entry form (`DENIED` accounts remain blocked on an **Access Denied** screen).
   - Approved Facilitators automatically redirect directly to **`/classroom-entry`**.
3. **Strict Facilitator Navigation & UI Isolation:**
   - **Facilitator:** Top header contains **only** `Enter a class` (`/classroom-entry`), `My classes` (`/my-classes`), account identity chip, and **Sign out**. Facilitators **never** see Google Sheets status pills/modals, total submission counters, KPI summaries, analytics charts, school/district/facilitator reports, other users' submissions, user management, settings, or `.xlsx` exports. Manually visiting any restricted URL (such as `/admin/overview` or `/reports`) displays **Access Denied** and redirects automatically back to `/classroom-entry`.
   - **Super Administrator (`SUPER_ADMIN`):** Sees Google Sheets sync status pill/modal (`Sync Log` + outbox retry), `Enter a class`, `My classes`, and **`Admin Console`** (`/admin/*` with all 12 management views).

> *(Local Development Note: When running locally without live `.env` Google OAuth credentials, a Sandbox Sign-In bar lets developers preview `Super Admin 1`, `Super Admin 2`, `Facilitator 1`, `Facilitator 2`, plus `Pending Approval` and `Access Denied` states against isolated in-memory storage. Notice how switching to a Facilitator strips Google Sheets badges, Admin tabs, and redirects away from `/admin/*` immediately.)*

---

## 2. Facilitator Workflow — Entering a Session (`Enter a class`)

The continuous form contains **6 numbered input sections** followed by the live **Your results** summary card.

### Local Draft Auto-Save & Recovery
- Unsubmitted entries save automatically to your browser's local storage (`draftStorage.ts`) every 500 ms (no authentication tokens are ever saved in drafts).
- If your browser closes mid-entry, the next time you open **Enter a class**, a banner offers **Restore draft** or **Discard draft**.

---

### Section 1 — About you
1. **Your name:** Confirm or type your facilitator display name.
   *(Your submission ownership is tied server-side to your signed-in verified Google account; when an Administrator edits another facilitator's session, a context badge reminds the admin that the original facilitator remains owner.)*

### Section 2 — About the session
1. **Which video did you show?:** Select the Career Tour video (e.g., *Amazon Music*, *Robotics Fulfillment Center*).
2. **In which language?:** Choose English, Hindi, Tamil, Telugu, Kannada, Marathi, Gujarati, or Odia.
3. **Date the session started** & **Date the session ended:** Defaults to today in Indian Standard Time (`Asia/Kolkata`). Future dates and end dates earlier than the start date are blocked.
   - **Month** (`reportingMonth`) and **Date of submission** (`dd-mm-yyyy`) auto-fill automatically.
4. **What time did it start?** & **What time did it end?:**
   - Click `Choose time` to open the interactive **Analogue Clock Picker** (toggle **AM** / **PM**, tap Hour on the `1..12` clock dial, then Minutes at 5-minute steps, and click **Done**), **or** type directly into the compact `HH:MM` keyboard input inside the expanded clock panel.
   - Sessions crossing midnight (e.g., `23:15` to `00:45` the next day) are calculated cleanly when **Date the session ended** is set to the next calendar day.

### Section 3 — About the school
1. **School name:** Enter the full school name.
2. **School code (UDISE):** Enter the exact **11-digit numeric** UDISE code. Leading zeroes (e.g. `01234567890`) are accepted and preserved as text.
   - If the UDISE already exists in the central `Schools` sheet, a helper card appears allowing you to click **Fill school details**. If your entered school name differs from the saved master name, an amber notice reminds you that the existing master record will not be overwritten.
3. **What kind of school is it?:** Choose from the approved school category list.
4. **State:** Pre-set to `Tamil Nadu`.
5. **District:** Choose from the three approved districts: **`Cuddalore`**, **`Nagapattinam`**, or **`Sivaganga`**. Changing District clears the Block selection automatically.
6. **Block:** Once a District is chosen, select an approved **Block** (includes a quick search filter when more than 8 blocks exist). *(If you see `"Block list not configured. Please contact the administrator."`, an Administrator must import the official block list under **Admin: all facilitators → Master Data, Users & Settings** first.)*
7. **PIN code:** Enter the exact **6-digit numeric** postal PIN code (leading zeroes preserved).

### Section 4 — About the class
1. Answer **"Did you take this session for more than one section or grade together?"**:
   - **No, one section of one grade:** Enter **Which class (grade)** (`8`..`12`), **Section** (`A`..`F` or `No section`), and **How many students were present?** (`> 0`).
   - **Yes, sections or grades were combined:** Starts with 2 class rows. Use **+ Add another class** (up to **10** class/grade rows) or **Remove** / **Clear row**. Duplicate grade + section pairs (e.g., two rows for `8` + `A`) are blocked.
   - Live pooled combined summary cards display total classes, total students, Q-A responses, **Pooled CSAT**, and **Pooled ITP**.

### Section 5 — Students' answers
- Each class row from Section 4 receives its own block (single classes render directly inside Section 5; combined classes render labelled Grade & Section blocks so you count each class separately).
- **Question A (CSAT):** *"How much did you enjoy this Career Tour?"* — Enter whole-number counts (`0` or higher; no decimals/negatives) for scores **5** (*5 · Loved it*) through **1** (*1 · Didn't like it*).
- **Question B (ITP):** *"After watching, how interested are you in learning more about careers of the future?"* — Enter counts for scores **5** (*5 · Extremely interested*) through **1** (*1 · Not at all interested*).
- **Validation rules:**
  - Total Q-A or Q-B responses for any class **cannot exceed** `studentsPresent` for that class (blocking error).
  - If response coverage is `< 75%` or Q-A and Q-B response totals differ, a non-blocking **amber warning** alerts you to double-check before saving.

### Section 6 — Teacher's answer
- Ask the teacher(s) who sat in: *"How likely are you to recommend this Career Tour to another teacher?"*
- Choose **Teacher's score** from the dropdown:
  - `9–10 · Promoter (Loved it)` -> **+100** NPS
  - `7–8 · Passive (It was fine)` -> **0** NPS
  - `0–6 · Detractor (Not satisfied)` -> **-100** NPS
- Optionally click **Record exact 0–10 score (optional)** to tap the exact numeric rating **0–10** alongside the group.

### Your results (Summary & Save)
1. Review the live KPI cards (**CSAT AVERAGE**, **ITP AVERAGE**, **TEACHER SCORE (NPS)**), the 4-cell count strip (**Students Present**, **Expected Responses**, **Actual Responses**, **Unanswered**), **SESSION ID** preview (`CT_IN_YYYYMMDD_UDISE_GG_CLASS_NNN`), and expandable sections:
   - **Also filled in for you (nothing to type)** — shows Month, Session length, Feedback from, Data source, Submission date, Educator ID, Video ID, Excel row count, School year, and Partner Name.
   - **Show the working** — expands exact pooled arithmetic (`Sum of (score × count) ÷ Total responses = Average`).
2. Click **Save this class** (or **Save updated session** when editing). Dedicated native modals guide each step cleanly:
   - **Validation Errors Modal (`ValidationErrorModal`):** Groups missing or invalid fields by section with **Jump** buttons that scroll and focus the exact field.
   - **Duplicate Warning Modal (`DuplicateWarningModal`):** Alerts you if a committed session already exists for the same school, date, and tour before you proceed.
   - **Review Before Submission Modal (`ReviewSubmissionModal`):** Summarizes attendance, pooled scores, school details, and non-blocking warnings prior to final lock; click **Confirm & submit** (or **Confirm & update session**).
   - **Success Modal (`SubmissionSuccessModal`):** Displays your locked Session ID with a one-click **Copy ID** control, sync status badge (`Synced to Google Sheets`, `Queued offline · Retry pending`, or `Local Sandbox`), **Start a new session**, **View in My classes**, and **Sync status**.
   - *(Offline Resilience)* If a transient `NETWORK_ERROR` occurs, your exact submission stays safely in your per-user **Sync Outbox** (`GoogleSheetsSyncModal`) for idempotent retry using the same `clientSubmissionKey`.
3. Use **Clear the class details** anytime to reset after confirming inside the warning dialog (or **New submission** in the header or **My classes** to add a session via modal).

---

## 3. Managing Saved Sessions (`My classes` — `/my-classes`)

- View only the committed sessions owned by your signed-in account. *(For Facilitators, summary count strips, analytics KPIs, Google Sheets badges, and `.xlsx` export buttons are strictly omitted — Admins access full reporting under `Admin Console`.)*
- **Search & Filter:** Filter by school/UDISE/Session ID keyword, District (`Cuddalore`, `Nagapattinam`, `Sivaganga`), Career Tour, Grade, or From/To date range.
- **Row Actions:**
  - **View (`Eye` icon):** Opens [SessionDetailModal](../frontend/src/dashboard/SessionDetailModal.tsx) with full session breakdown, per-class metrics, and formula working.
  - **Edit (`Pencil` icon):** Loads the session into the quick-edit modal (`SubmissionFormModal`) or form. Saving updates only the matching database rows while preserving `sessionRecordId` and original `sessionId`.
  - **Archive (`Archive` icon):** Soft-archives a session after confirmation inside the structured metadata confirmation dialog (when permitted by `allowFacilitatorDeleteOwn`).

---

## 4. Super Administrator Console (`/admin/*` — 12 Dedicated Views)

Only allowlisted Super Administrators (`brinthajayaprakash888@gmail.com` and `karunya@vidhyavidhai.org`) can open **Admin Console** and navigate across the 12 single-source navigation views ([AdminNav](../frontend/src/admin/AdminNav.tsx), responsive drawer on mobile, persistent rail on desktop):

1. **`Overview` (`/admin/overview`):** Executive setup readiness checklist, key KPI strip (Total Sessions, Students Reached, Schools Covered, Active Facilitators, Pooled CSAT/ITP, Teacher NPS), District reach bars, and Student Sentiment / NPS summary charts.
2. **`Analytics` (`/admin/analytics`):** Full visual analytics across District comparisons, Monthly trajectory trend chart, Career Tour & Language summaries, Grade-level reach table, and `DetailedAnalyticsModal` **Inspect** drill-downs.
3. **`All Submissions` (`/admin/all-submissions`):** Filterable, paginated cross-facilitator submission ledger supporting View, Admin Edit (`CORRECTED` status + `Audit Log` trail while preserving the original `facilitatorEmail` owner), Archive, and `Export Filtered (.xlsx)`.
4. **`Schools` (`/admin/schools`):** Accessible sortable **School-wise Performance** table (`School / UDISE`, `District / Block`, `Sessions`, `Students Reached`, `Pooled CSAT`, `Pooled ITP`, `Unanswered`) plus live UDISE School Master directory search.
5. **`Facilitators` (`/admin/facilitators`):** Expandable Facilitator activity & pooled feedback panels across all educators.
6. **`Student Feedback` (`/admin/student-feedback`):** Detailed Question A (CSAT) & Question B (ITP) `5..1` vote histograms and per-session breakdowns.
7. **`Teacher Feedback` (`/admin/teacher-feedback`):** Dedicated Teacher NPS score breakdown (`Promoter 9–10`, `Passive 7–8`, `Detractor 0–6`) and verbatim session log.
8. **`Performance Reports` (`/admin/performance-reports`):** Partner readiness metrics (`School Year`, `Partner Name`, `63-Column Template` status) and `Export Official Workbook (.xlsx)` launching the **Export Programme Report** preview modal (`1 row per grade/section` expansion + `@` plain-text formatting).
9. **`Data Quality` (`/admin/data-quality`):** 12 automated cross-checks (`reconcileDashboardAnalytics`), response coverage %, missing-answer tallies, and `UNCONFIGURED_VIDEO_ID` warnings.
10. **`Google Sheets Sync` (`/admin/google-sheets-sync`):** Live `pingHealth()` diagnostic, queued offline Sync Outbox retry, and `Sync Log` event ledger ([GoogleSheetsSyncPanel](../frontend/src/admin/GoogleSheetsSyncPanel.tsx)).
11. **`User Management` (`/admin/user-management`):** Read-only Protected Super Administrators card, **Google Sign-In Approval Policy** toggle (`manual_allowlist` vs `auto_approve`), Pending Approval Queue (`Approve` / `Deny`), Facilitator creation by Google email (zero password fields, zero admin escalation options), and status directory ([UserAccessManager](../frontend/src/admin/UserAccessManager.tsx)).
12. **`Settings` (`/admin/settings`):** District–Block `.csv` / `.xlsx` importer, `School Year` & `Partner Name`, Career Tour & language-matched Video ID editor, `allowFacilitatorDeleteOwn` policy toggle, Official 63-Column `.xlsx` template mapper ([MasterDataSettings](../frontend/src/admin/MasterDataSettings.tsx)), and paginated immutable `Audit Log` viewer ([AuditLogViewer](../frontend/src/admin/AuditLogViewer.tsx)).
