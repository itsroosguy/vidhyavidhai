# Google Sheets Database Schema & Transactional Architecture

The Career Tours Classroom Data Entry & Feedback Management System uses a central, private Google Sheets workbook as its relational-style backing store, initialized and managed exclusively by Google Apps Script ([SetupDatabase.gs](../apps-script/SetupDatabase.gs)).

> **Access control rule:** Never share the backing Google Spreadsheet publicly (`Anyone with the link`). Only the Google account owning/deploying the Apps Script Web App (`executeAs: USER_DEPLOYING`) needs edit access to the spreadsheet. End users authenticate via Google Identity Services (`idToken`) and communicate solely through [`doPost`](../apps-script/Code.gs).

---

## 1. Workbook Structure (8 Sheets)

Running `initializeDatabase()` in [SetupDatabase.gs](../apps-script/SetupDatabase.gs) creates and formats all eight tabs idempotently without clearing existing data rows.

### 1.1 `Sessions` (42 Columns — Session Header)

One row per submitted classroom session (`single` or `combined`). Columns formatted with plain-text `@` number format preserve leading zeroes, ISO dates, and timestamps without spreadsheet auto-conversion.

| Col # | Header | Type / Format | Description & Notes |
|---:|---|---|---|
| 1 | `session_record_id` | Text (`@`) | Immutable internal UUID key (`REC_<UUID>`) |
| 2 | `session_id` | Text (`@`) | Immutable business ID (`CT_IN_YYYYMMDD_UDISE_GG_CLASS_NNN`) |
| 3 | `client_submission_key` | Text (`@`) | Client idempotency UUID preventing duplicate writes on retry |
| 4 | `facilitator_name` | String | Facilitator display name recorded at submission |
| 5 | `facilitator_email` | String (lowercase) | **Authoritative owner** resolved from verified Google ID token |
| 6 | `facilitator_user_id` | String | User ID from `Facilitators` / `Admin Users` |
| 7 | `tour_id` | String | Selected Career Tour ID (e.g. `TOUR_AM`, `TOUR_RFC`) |
| 8 | `tour_name` | String | Career Tour display title |
| 9 | `video_id` | String | Language-matched Video ID or `UNCONFIGURED_VIDEO_ID` |
| 10 | `language` | String | Audio/video language shown |
| 11 | `start_date` | Text (`@`) | ISO date `YYYY-MM-DD` (`Asia/Kolkata`) |
| 12 | `end_date` | Text (`@`) | ISO date `YYYY-MM-DD` (`Asia/Kolkata`) |
| 13 | `start_time` | Text (`@`) | 24-hour `HH:MM` start time |
| 14 | `end_time` | Text (`@`) | 24-hour `HH:MM` end time |
| 15 | `duration_minutes` | Number | Exact duration in minutes across dates/midnight |
| 16 | `duration_formatted` | String | Human-readable length (e.g. `1 hr 30 mins`) |
| 17 | `reporting_month` | String | English month name derived from `start_date` |
| 18 | `submission_timestamp` | Text (`@`) | ISO-8601 UTC timestamp |
| 19 | `submission_date_formatted` | Text (`@`) | Date formatted as `dd-mm-yyyy` (`Asia/Kolkata`) |
| 20 | `school_name` | String | School name |
| 21 | `udise_code` | Text (`@`) | Exactly 11 numeric digits; leading zeroes preserved |
| 22 | `school_type` | String | Approved category from `Configuration` |
| 23 | `state` | String | Configured state (`Tamil Nadu`) |
| 24 | `district` | String | Strictly one of `Cuddalore`, `Nagapattinam`, `Sivaganga` |
| 25 | `block` | String | Approved block belonging to the selected district |
| 26 | `pin_code` | Text (`@`) | Exactly 6 numeric digits; leading zeroes preserved |
| 27 | `session_type` | String | `single` or `combined` |
| 28 | `total_classes` | Number | `1` for single class; `2..10` for combined |
| 29 | `total_students_present` | Number | Sum of `students_present` across all detail rows |
| 30 | `total_qa_responses` | Number | Pooled count of Question A responses |
| 31 | `total_qb_responses` | Number | Pooled count of Question B responses |
| 32 | `overall_csat` | Number (2 dp) / Blank | Pooled session CSAT: `sum(QA weighted) / sum(QA responses)` |
| 33 | `overall_itp` | Number (2 dp) / Blank | Pooled session ITP: `sum(QB weighted) / sum(QB responses)` |
| 34 | `teacher_score` | Number (`0..10`) / Blank | Exact teacher score if recorded |
| 35 | `teacher_classification` | String | `Promoter`, `Passive`, or `Detractor` |
| 36 | `teacher_nps` | Number | `100`, `0`, or `-100` |
| 37 | `submission_status` | Text (`@`) | `PENDING`, `COMMITTED`, or `CORRECTED` |
| 38 | `created_at` | Text (`@`) | ISO creation timestamp |
| 39 | `updated_at` | Text (`@`) | ISO last-modified timestamp |
| 40 | `created_by` | String | Email of creator |
| 41 | `updated_by` | String | Email of last editor |
| 42 | `archived` | Text (`@`) | `'true'` or `'false'` (soft delete) |

---

### 1.2 `Session Details` (24 Columns — Class/Grade Child Rows)

Stores 1 row per grade/section in a `single` session (`1` child row) or a `combined` session (`2..10` child rows), joined via `session_record_id` and `session_id`. During Excel export ([Export.gs](../apps-script/Export.gs)), each row in `Session Details` produces one output row.

| Col # | Header | Format | Description |
|---:|---|---|---|
| 1 | `detail_record_id` | Text (`@`) | `DET_<session_record_id>_<index>` |
| 2 | `session_record_id` | Text (`@`) | Foreign key to `Sessions.session_record_id` |
| 3 | `session_id` | Text (`@`) | Denormalized immutable Session ID |
| 4 | `grade` | Text (`@`) | Grade (`8`, `9`, `10`, `11`, `12`, etc.) |
| 5 | `section` | Text (`@`) | Section (`A`..`F` or `No section`) |
| 6 | `students_present` | Number | Whole number `> 0` for this grade/section |
| 7–11 | `qa_score_5` .. `qa_score_1` | Number | Question A score counts (5 to 1) |
| 12 | `qa_total` | Number | Sum of Q-A counts for this class |
| 13 | `qa_weighted_score` | Number | `5*s5 + 4*s4 + 3*s3 + 2*s2 + 1*s1` |
| 14 | `csat` | Number (2 dp) / Blank | Class-level CSAT average |
| 15–19 | `qb_score_5` .. `qb_score_1` | Number | Question B score counts (5 to 1) |
| 20 | `qb_total` | Number | Sum of Q-B counts for this class |
| 21 | `qb_weighted_score` | Number | `5*s5 + 4*s4 + 3*s3 + 2*s2 + 1*s1` |
| 22 | `itp` | Number (2 dp) / Blank | Class-level ITP average |
| 23 | `created_at` | String | ISO creation timestamp |
| 24 | `updated_at` | String | ISO update timestamp |

---

### 1.3 `Facilitators` and `Admin Users` (8 Columns Each)

Identical schema managed by [`ctHandleManageUser_`](../apps-script/Admin.gs) without storing any credentials or passwords anywhere in the workbook:

| Col # | Header | Format | Description |
|---:|---|---|---|
| 1 | `user_id` | Text (`@`) | `USR_<hex>` identifier (`SA_BRINTHA` / `SA_KARUNYA` for initial Super Admins) |
| 2 | `name` | String | Full display name |
| 3 | `email` | Text (`@`) | Lowercase Google account email |
| 4 | `role` | Text (`@`) | `facilitator` (in `Facilitators`), or `super_admin` (in `Admin Users` — strictly allowlisted accounts only) |
| 5 | `active` | Text (`@`) | `'true'` or `'false'` |
| 6 | `created_at` | String | ISO creation timestamp |
| 7 | `updated_at` | String | ISO update timestamp |
| 8 | `status` | Text (`@`) | Approval status: `'APPROVED'`, `'PENDING'`, or `'DENIED'` |

**Initial Allowlist & Seeding Policy:** `initializeDatabase()` idempotently seeds the two initial `SUPER_ADMIN` accounts (`brinthajayaprakash888@gmail.com` and `karunya@vidhyavidhai.org`) into `Admin Users` as `APPROVED` / `active: 'true'`. Both server-side (`Auth.gs`) and frontend allowlists prevent modifying, deactivating, or demoting these accounts (`PROTECTED_ACCOUNT`) and reject granting `super_admin` privileges to any other email (`FORBIDDEN`).

---

### 1.4 `Schools` (11 Columns — School Master)

Populated safely via [`ctUpsertSchoolWithoutOverwrite_`](../apps-script/Schools.gs) and queried for auto-fill by UDISE code.

| Col # | Header | Format | Description |
|---:|---|---|---|
| 1 | `school_record_id` | Text (`@`) | `SCH_<hex>` identifier |
| 2 | `school_name` | String | Registered school name |
| 3 | `udise_code` | Text (`@`) | 11-digit UDISE code with leading zeroes preserved |
| 4 | `school_type` | String | School category |
| 5 | `state` | String | State name (`Tamil Nadu`) |
| 6 | `district` | String | Approved district name |
| 7 | `block` | String | Approved block name |
| 8 | `pin_code` | Text (`@`) | 6-digit PIN code with leading zeroes preserved |
| 9 | `active` | Text (`@`) | `'true'` or `'false'` |
| 10–11 | `created_at`, `updated_at` | String | ISO timestamps |

**Conflict Protection:** If a facilitator submits a session using an existing 11-digit UDISE code with a different school name, the existing `Schools` master record is **preserved** (never overwritten silently) and a warning is returned for admin review.

---

### 1.5 `Configuration` (4 Columns — Key/JSON Store)

Backed by `CacheService.getScriptCache()` (5-minute TTL, invalidated on admin writes) via [Configuration.gs](../apps-script/Configuration.gs).

| Col # | Header | Format | Description |
|---:|---|---|---|
| 1 | `config_key` | Text (`@`) | Setting key (`allowed_districts`, `district_blocks`, `tours`, `partner_name`, `export_template_63`, etc.) |
| 2 | `config_value_json` | Text (`@`) | JSON-encoded value |
| 3 | `updated_at` | Text (`@`) | ISO timestamp |
| 4 | `updated_by` | Text (`@`) | Email of administrator / `SYSTEM_INIT` |

---

### 1.6 `Audit Log` (10 Columns — Append-Only Immutable History)

Every authentication denial, RBAC denial, create/update/archive session, block import, config mutation, user change, and export event is appended via [`ctAppendAuditLog_`](../apps-script/Audit.gs).

| Col # | Header | Format | Description |
|---:|---|---|---|
| 1 | `audit_id` | Text (`@`) | `AUD_<hex>` identifier |
| 2 | `timestamp` | Text (`@`) | ISO-8601 timestamp |
| 3 | `user_id` | Text (`@`) | Acting user ID or `UNREGISTERED` |
| 4 | `user_email` | Text (`@`) | Verified user email |
| 5 | `action` | Text (`@`) | e.g., `CREATE_SESSION`, `UPDATE_SESSION`, `ADMIN_CORRECT_SESSION`, `ARCHIVE_SESSION`, `EXPORT_XLSX`, `RBAC_DENIED`, `AUTH_DENIED`, `UPDATE_CONFIG`, `IMPORT_BLOCKS`, `CREATE_USER`, `UPDATE_USER` |
| 6 | `entity_type` | Text (`@`) | `Session`, `Configuration`, `User`, `Export`, `Auth`, `Security` |
| 7 | `entity_id` | Text (`@`) | Affected record ID or key |
| 8 | `previous_summary` | Text (`@`) | Prior summary (capped at 2,000 chars) |
| 9 | `new_summary` | Text (`@`) | New summary (capped at 2,000 chars) |
| 10 | `result` | Text (`@`) | `SUCCESS`, `DENIED`, or `FAILED` |

---

### 1.7 `Sync Log` (10 Columns — Submission Sync & Recovery Ledger)

Tracks backend sync attempts (`createSession`, `updateSession`, and duplicate-key idempotency replays) via [`ctAppendSyncLog_`](../apps-script/Audit.gs) and serves role-scoped sync history to the client via [`ctHandleGetSyncLogs_`](../apps-script/Audit.gs). Paired with the browser-side `syncService.ts` outbox queue so transient `NETWORK_ERROR` failures are queued per user and retried idempotently using the same `client_submission_key`.

| Col # | Header | Format | Description |
|---:|---|---|---|
| 1 | `sync_id` | Text (`@`) | `SYNC_<hex>` identifier |
| 2 | `timestamp` | Text (`@`) | ISO-8601 timestamp |
| 3 | `client_submission_key` | Text (`@`) | Client idempotency UUID |
| 4 | `session_record_id` | Text (`@`) | Linked `Sessions.session_record_id` |
| 5 | `session_id` | Text (`@`) | Linked business `Session ID` (`CT_IN_...`) |
| 6 | `actor_email` | Text (`@`) | Verified user email performing sync |
| 7 | `operation` | Text (`@`) | `createSession` or `updateSession` |
| 8 | `attempt` | Number | Attempt count (starting at `1`) |
| 9 | `status` | Text (`@`) | `SYNCED` (committed) or failure state |
| 10 | `error_message` | Text (`@`) | Error text (capped at 1,000 chars; empty on success) |

---

## 2. Session ID Generation & Concurrency Control

- **Format:** `CT_IN_YYYYMMDD_UDISE_GG_CLASS_NNN`
  - Single class: zero-padded 2-digit grade (`08`, `09`, `10`, `11`, `12`) and sanitized section (`A`..`F`, or `NS` for `No section`).
  - Combined class: `CMB` and `<count>C` (e.g., `CMB_02C`..`CMB_10C`).
  - Sequence `_NNN`: 3-digit daily counter per prefix (`001`, `002`, ...) assigned inside `LockService.getScriptLock()` (`waitLock(20000)`) in [Sessions.gs](../apps-script/Sessions.gs).
- **Idempotency:** Retrying an identical `clientSubmissionKey` (e.g. after a transient network timeout) returns the already committed session without creating a duplicate row.
- **Row-Level Updates (No Full-Sheet Rewrite):** Edits update only the matched row index (`_rowNumber`) in `Sessions` and update/append/bottom-up-delete only child rows for that `session_record_id` in `Session Details`.

---

## 3. Two-Phase Write Safety & Crash Recovery

[`ctCreateSessionCore_`](../apps-script/Sessions.gs) prevents partial writes from leaking into analytics or reports:

1. **Phase 1:** Append master row to `Sessions` with `submission_status = 'PENDING'`.
2. **Phase 2:** Append `1..10` child rows to `Session Details` and call `SpreadsheetApp.flush()`.
3. **Phase 3:** Promote `submission_status` cell (Column 37) from `'PENDING'` to `'COMMITTED'`.

All normal query endpoints (`getMySessions`, `getAdminSessions`, `getDashboardSummary`) ignore rows with `submission_status === 'PENDING'`. If an Apps Script execution times out mid-write, an administrator can open the Apps Script Editor and run `recoverPendingSessions()` ([Sessions.gs](../apps-script/Sessions.gs#L848-L871)), which promotes complete pending rows and lists any incomplete orphans for inspection.

---

## 4. Backup & Disaster Recovery Recommendations

- Enable Google Drive **Version History** on the central spreadsheet so point-in-time snapshots are automatic.
- Maintain a weekly scheduled export (`.xlsx` or Google Drive copy) restricted to Super Administrators.
- Do not sort or manually delete rows inside `Sessions` or `Session Details` in the Google Sheets UI while live traffic is active, because row edits during a concurrent request can shift row numbers mid-read; always perform corrections through the application Admin UI so the Audit Log and `Session Details` stay synchronized.
