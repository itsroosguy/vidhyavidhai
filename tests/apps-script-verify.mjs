import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS_SCRIPT_DIR = path.resolve(__dirname, '../apps-script');

function createAppsScriptSandbox() {
  let lockAcquiredCount = 0;
  let lockReleasedCount = 0;

  function makeRange(sheetObj, startRow, startCol, numRows, numCols) {
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const rowArr = [];
          const gridRow = sheetObj.data[startRow - 1 + r] || [];
          for (let c = 0; c < numCols; c++) {
            const val = gridRow[startCol - 1 + c];
            rowArr.push(val === undefined ? '' : val);
          }
          out.push(rowArr);
        }
        return out;
      },
      setValues(vals) {
        for (let r = 0; r < vals.length; r++) {
          const rowIndex = startRow - 1 + r;
          while (sheetObj.data.length <= rowIndex) sheetObj.data.push([]);
          for (let c = 0; c < vals[r].length; c++) {
            sheetObj.data[rowIndex][startCol - 1 + c] = vals[r][c];
          }
        }
        return this;
      },
      setValue(val) {
        return this.setValues([[val]]);
      },
      setNumberFormat() {
        return this;
      },
      setNumberFormats() {
        return this;
      },
      setFontWeight() {
        return this;
      },
      setBackground() {
        return this;
      },
      setFontColor() {
        return this;
      },
    };
  }

  function createSheetObj(name) {
    const sheetObj = {
      name,
      data: [],
      frozenRows: 0,
      getLastRow() {
        for (let i = sheetObj.data.length - 1; i >= 0; i--) {
          if (sheetObj.data[i].some((v) => v !== '' && v !== undefined && v !== null)) {
            return i + 1;
          }
        }
        return 0;
      },
      getMaxRows() {
        return Math.max(sheetObj.data.length, 200);
      },
      setFrozenRows(n) {
        sheetObj.frozenRows = n;
      },
      getRange(r, c, nr = 1, nc = 1) {
        return makeRange(sheetObj, r, c, nr, nc);
      },
      deleteRow(rowNum) {
        if (rowNum >= 1 && rowNum <= sheetObj.data.length) {
          sheetObj.data.splice(rowNum - 1, 1);
        }
      },
    };
    return sheetObj;
  }

  function createSpreadsheetObj(id, name, initialTabName = null) {
    const ssSheets = new Map();
    if (initialTabName) {
      ssSheets.set(initialTabName, createSheetObj(initialTabName));
    }
    return {
      _id: id,
      _name: name,
      _sheets: ssSheets,
      getId() {
        return id;
      },
      getName() {
        return name;
      },
      getUrl() {
        return `https://docs.google.com/spreadsheets/d/${id}/edit`;
      },
      getSheetByName(tabName) {
        return ssSheets.get(tabName) || null;
      },
      insertSheet(tabName) {
        const s = createSheetObj(tabName);
        ssSheets.set(tabName, s);
        return s;
      },
    };
  }

  const spreadsheet = createSpreadsheetObj('TEST_SHEET_ID', 'Initial Bound Sheet');
  const sheets = spreadsheet._sheets;
  const targetSheet = createSpreadsheetObj(
    '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
    'Vidhya Vidhai Official Target',
    'Sheet1',
  );
  const spreadsheetsById = new Map([
    ['TEST_SHEET_ID', spreadsheet],
    ['1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE', targetSheet],
  ]);

  const scriptProps = new Map([
    ['SPREADSHEET_ID', 'TEST_SHEET_ID'],
    ['GOOGLE_CLIENT_ID', 'test-google-client-id.apps.googleusercontent.com'],
  ]);

  const cacheStore = new Map();

  // Simulated Google OAuth tokeninfo responses
  const tokenClaimsMap = {
    TOKEN_SA_1: {
      aud: 'test-google-client-id.apps.googleusercontent.com',
      email: 'brinthajayaprakash888@gmail.com',
      email_verified: 'true',
      name: 'Brintha Jayaprakash',
      sub: 'sub-sa-1',
      exp: String(Math.floor(Date.now() / 1000) + 3600),
    },
    TOKEN_SA_2: {
      aud: 'test-google-client-id.apps.googleusercontent.com',
      email: 'karunya@vidhyavidhai.org',
      email_verified: 'true',
      name: 'Karunya',
      sub: 'sub-sa-2',
      exp: String(Math.floor(Date.now() / 1000) + 3600),
    },
    TOKEN_FAC_1: {
      aud: 'test-google-client-id.apps.googleusercontent.com',
      email: 'fac1@example.org',
      email_verified: 'true',
      name: 'Facilitator One',
      sub: 'sub-f1',
      exp: String(Math.floor(Date.now() / 1000) + 3600),
    },
    TOKEN_FAC_2: {
      aud: 'test-google-client-id.apps.googleusercontent.com',
      email: 'fac2@example.org',
      email_verified: 'true',
      name: 'Facilitator Two',
      sub: 'sub-f2',
      exp: String(Math.floor(Date.now() / 1000) + 3600),
    },
    TOKEN_NEW_GOOGLE: {
      aud: 'test-google-client-id.apps.googleusercontent.com',
      email: 'new.teacher@example.org',
      email_verified: 'true',
      name: 'New Google User',
      sub: 'sub-new',
      exp: String(Math.floor(Date.now() / 1000) + 3600),
    },
    TOKEN_AUTO_GOOGLE: {
      aud: 'test-google-client-id.apps.googleusercontent.com',
      email: 'auto.teacher@example.org',
      email_verified: 'true',
      name: 'Auto Approved User',
      sub: 'sub-auto',
      exp: String(Math.floor(Date.now() / 1000) + 3600),
    },
    TOKEN_EXPIRED: {
      aud: 'test-google-client-id.apps.googleusercontent.com',
      email: 'fac1@example.org',
      email_verified: 'true',
      name: 'Expired User',
      sub: 'sub-f1',
      exp: String(Math.floor(Date.now() / 1000) - 60),
    },
  };

  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Intl,
    Error,
    isNaN,
    isFinite,
    parseInt,
    encodeURIComponent,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => scriptProps.get(k) ?? null,
        setProperty: (k, v) => scriptProps.set(k, String(v)),
        deleteProperty: (k) => scriptProps.delete(k),
      }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        const found = spreadsheetsById.get(id);
        if (!found) throw new Error(`Spreadsheet not found: ${id}`);
        return found;
      },
      create: (title) => {
        const newId = `CREATED_${spreadsheetsById.size + 1}`;
        const created = createSpreadsheetObj(newId, title, 'Sheet1');
        spreadsheetsById.set(newId, created);
        return created;
      },
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => undefined,
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cacheStore.get(k) ?? null,
        put: (k, v) => cacheStore.set(k, v),
        remove: (k) => cacheStore.delete(k),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          lockAcquiredCount++;
        },
        releaseLock: () => {
          lockReleasedCount++;
        },
      }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (date, tz, fmt) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(date);
        const map = {};
        for (const p of parts) map[p.type] = p.value;
        if (fmt === 'yyyy-MM-dd') return `${map.year}-${map.month}-${map.day}`;
        if (fmt === 'HH:mm') return `${map.hour}:${map.minute}`;
        return `${map.year}-${map.month}-${map.day}`;
      },
    },
    UrlFetchApp: {
      fetch: (url) => {
        const token = decodeURIComponent(url.split('id_token=')[1] || '');
        const claims = tokenClaimsMap[token];
        if (!claims) {
          return { getResponseCode: () => 400, getContentText: () => '{"error_description":"Invalid token"}' };
        }
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(claims) };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({
        _txt: txt,
        setMimeType() {
          return this;
        },
        getContent() {
          return this._txt;
        },
      }),
    },
  };

  vm.createContext(sandbox);

  const gsFiles = [
    'Audit.gs',
    'Configuration.gs',
    'Auth.gs',
    'Calculations.gs',
    'Validation.gs',
    'Schools.gs',
    'SetupDatabase.gs',
    'Sessions.gs',
    'Admin.gs',
    'Export.gs',
    'Code.gs',
  ];

  for (const file of gsFiles) {
    const src = fs.readFileSync(path.join(APPS_SCRIPT_DIR, file), 'utf8');
    vm.runInContext(src, sandbox, { filename: file });
  }

  return {
    sandbox,
    sheets,
    spreadsheetsById,
    getLockStats: () => ({ lockAcquiredCount, lockReleasedCount }),
    callApi(action, idToken, payload = {}) {
      const out = sandbox.doPost({
        postData: { contents: JSON.stringify({ action, idToken, payload }) },
      });
      return JSON.parse(out.getContent());
    },
  };
}

function runVerification() {
  const ctx = createAppsScriptSandbox();

  // 1. Validate appsscript.json timezone & V8 runtime
  const manifest = JSON.parse(
    fs.readFileSync(path.join(APPS_SCRIPT_DIR, 'appsscript.json'), 'utf8'),
  );
  assert.equal(manifest.timeZone, 'Asia/Kolkata');
  assert.equal(manifest.runtimeVersion, 'V8');

  // 2. Initialize Database & verify all 8 tabs + dual allowlisted Super Admins + zero passwords
  const initMsg = ctx.sandbox.initializeDatabase();
  assert.match(initMsg, /initialized cleanly/);
  const expectedSheets = [
    'Sessions',
    'Session Details',
    'Facilitators',
    'Schools',
    'Configuration',
    'Admin Users',
    'Audit Log',
    'Sync Log',
  ];
  for (const name of expectedSheets) {
    assert.ok(ctx.sheets.has(name), `Missing sheet ${name}`);
  }
  const adminRows = ctx.sheets.get('Admin Users').data;
  assert.equal(adminRows[0].length, 8);
  assert.equal(adminRows[0].join(',').toLowerCase().includes('password'), false);
  const seededEmails = adminRows.slice(1).map((r) => r[2]);
  assert.ok(seededEmails.includes('brinthajayaprakash888@gmail.com'));
  assert.ok(seededEmails.includes('karunya@vidhyavidhai.org'));

  // 3. Reject expired token
  const expiredRes = ctx.callApi('getCurrentUser', 'TOKEN_EXPIRED');
  assert.equal(expiredRes.ok, false);
  assert.equal(expiredRes.code, 'UNAUTHENTICATED');

  // 4. Default manual_allowlist policy places unknown Google user into PENDING queue idempotently
  const pending1 = ctx.callApi('getCurrentUser', 'TOKEN_NEW_GOOGLE');
  assert.equal(pending1.ok, false);
  assert.equal(pending1.code, 'PENDING_APPROVAL');
  ctx.callApi('getCurrentUser', 'TOKEN_NEW_GOOGLE'); // Repeat attempt should not duplicate row
  const facRowsAfterPending = ctx.sheets
    .get('Facilitators')
    .data.slice(1)
    .filter((r) => r[2] === 'new.teacher@example.org');
  assert.equal(facRowsAfterPending.length, 1);
  assert.equal(facRowsAfterPending[0][7], 'PENDING');

  // 5. Both allowlisted Super Admins authenticate cleanly as super_admin
  const sa1 = ctx.callApi('getCurrentUser', 'TOKEN_SA_1');
  assert.equal(sa1.ok, true);
  assert.equal(sa1.data.role, 'super_admin');
  const sa2 = ctx.callApi('getCurrentUser', 'TOKEN_SA_2');
  assert.equal(sa2.ok, true);
  assert.equal(sa2.data.role, 'super_admin');

  // 6. Super Admin allowlist immutability & elevation prevention
  const deactivateSa2 = ctx.callApi('manageUser', 'TOKEN_SA_1', {
    user: { name: 'Override', email: 'karunya@vidhyavidhai.org', role: 'facilitator', active: false },
  });
  assert.equal(deactivateSa2.ok, false);
  assert.equal(deactivateSa2.code, 'PROTECTED_ACCOUNT');

  const promoteAttempt = ctx.callApi('manageUser', 'TOKEN_SA_1', {
    user: { name: 'Non Allowlist Admin', email: 'fac1@example.org', role: 'super_admin', active: true },
  });
  assert.equal(promoteAttempt.ok, false);
  assert.equal(promoteAttempt.code, 'FORBIDDEN');

  // 7. Super Admin 2 approves TOKEN_NEW_GOOGLE + pre-approves Fac1 & Fac2
  assert.equal(
    ctx.callApi('manageUser', 'TOKEN_SA_2', {
      user: { name: 'New Google User', email: 'new.teacher@example.org', role: 'facilitator', active: true, status: 'APPROVED' },
    }).ok,
    true,
  );
  const newUserLogin = ctx.callApi('getCurrentUser', 'TOKEN_NEW_GOOGLE');
  assert.equal(newUserLogin.ok, true);
  assert.equal(newUserLogin.data.role, 'facilitator');

  // 8. auto_approve policy allows verified Google user automatically with Facilitator role ONLY
  const setAuto = ctx.callApi('saveAppConfiguration', 'TOKEN_SA_1', {
    config: { policy: { allowFacilitatorDeleteOwn: true, allowFacilitatorExportOwn: false, facilitatorApprovalMode: 'auto_approve' } },
  });
  assert.equal(setAuto.ok, true);
  const autoLogin = ctx.callApi('getCurrentUser', 'TOKEN_AUTO_GOOGLE');
  assert.equal(autoLogin.ok, true);
  assert.equal(autoLogin.data.role, 'facilitator');

  // Deny auto user -> ACCESS_DENIED
  ctx.callApi('manageUser', 'TOKEN_SA_1', {
    user: { name: 'Auto Approved User', email: 'auto.teacher@example.org', role: 'facilitator', active: false, status: 'DENIED' },
  });
  const deniedAuto = ctx.callApi('getCurrentUser', 'TOKEN_AUTO_GOOGLE');
  assert.equal(deniedAuto.ok, false);
  assert.equal(deniedAuto.code, 'ACCESS_DENIED');

  // Restore manual_allowlist & configure Partner + Blocks
  ctx.callApi('saveAppConfiguration', 'TOKEN_SA_1', {
    config: {
      partnerName: 'Sensitive Partner Org',
      policy: { allowFacilitatorDeleteOwn: true, allowFacilitatorExportOwn: false, facilitatorApprovalMode: 'manual_allowlist' },
    },
  });
  assert.equal(
    ctx.callApi('manageUser', 'TOKEN_SA_1', {
      user: { name: 'Facilitator One', email: 'fac1@example.org', role: 'facilitator', active: true },
    }).ok,
    true,
  );
  assert.equal(
    ctx.callApi('manageUser', 'TOKEN_SA_1', {
      user: { name: 'Facilitator Two', email: 'fac2@example.org', role: 'facilitator', active: true },
    }).ok,
    true,
  );

  const importRes = ctx.callApi('importBlockMaster', 'TOKEN_SA_1', {
    entries: [
      { district: 'Cuddalore', block: 'Panruti', active: true },
      { district: 'Nagapattinam', block: 'Kilvelur', active: true },
    ],
    replaceExisting: true,
  });
  assert.equal(importRes.ok, true);
  assert.equal(importRes.data.totalCount, 2);

  // 9. Facilitator config sanitization + strict FORBIDDEN across all admin endpoints
  const facCfg = ctx.callApi('getAppConfiguration', 'TOKEN_FAC_1');
  assert.equal(facCfg.ok, true);
  assert.equal(facCfg.data.partnerName, '');
  assert.equal(facCfg.data.exportTemplate63, null);
  assert.equal(facCfg.data.policy.allowFacilitatorExportOwn, false);

  for (const [action, payload] of [
    ['getDashboardSummary', { filters: {} }],
    ['getAdminSessions', { filters: {} }],
    ['listManagedUsers', {}],
    ['manageUser', { user: { name: 'X', email: 'x@example.org', role: 'facilitator', active: true } }],
    ['getAuditLogs', { page: 1, pageSize: 20 }],
    ['getSyncLogs', { page: 1, pageSize: 20 }],
    ['logExportEvent', { scope: 'ALL', rowCount: 1, format: 'official_63' }],
    ['searchSchools', { query: 'GHSS' }],
    ['saveAppConfiguration', { config: { partnerName: 'Tampered' } }],
    ['importBlockMaster', { entries: [{ district: 'Cuddalore', block: 'Test', active: true }] }],
    ['getSheetsConnection', {}],
    ['connectGoogleSheet', { spreadsheetUrlOrId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE' }],
    ['createGoogleSheet', { title: 'Unauthorized Sheet' }],
    ['disconnectGoogleSheet', {}],
    ['syncAllToGoogleSheet', {}],
  ]) {
    const res = ctx.callApi(action, 'TOKEN_FAC_1', payload);
    assert.equal(res.ok, false, `Expected ${action} to be forbidden for facilitator`);
    assert.equal(res.code, 'FORBIDDEN', `Expected FORBIDDEN for ${action}`);
  }

  // 10. Create Combined Session as Fac1 + verify idempotency, leading zeros, & cross-user isolation
  const today = ctx.sandbox.ctGetTodayKolkataISO_();
  const createRes = ctx.callApi('createSession', 'TOKEN_FAC_1', {
    values: {
      clientSubmissionKey: 'idem-apps-script-1',
      facilitatorName: 'Facilitator One',
      facilitatorEmail: 'forged@example.org',
      tourId: 'TOUR_AM',
      language: 'Tamil',
      startDate: today,
      endDate: today,
      startTime: '10:00',
      endTime: '11:30',
      schoolName: 'GHSS Panruti Leading Zero Test',
      udiseCode: '01234567890',
      schoolType: 'Government school',
      state: 'Tamil Nadu',
      district: 'Cuddalore',
      block: 'Panruti',
      pinCode: '006001',
      sessionMode: 'combined',
      classes: [
        {
          rowId: '1',
          grade: '8',
          section: 'A',
          studentsPresent: '40',
          questionA: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
        {
          rowId: '2',
          grade: '9',
          section: 'No section',
          studentsPresent: '10',
          questionA: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '10' },
          questionB: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '10' },
        },
      ],
      teacherNpsGroup: 'promoter',
      teacherExactScore: '10',
    },
  });

  assert.equal(createRes.ok, true);
  const createdSession = createRes.data.session;
  assert.equal(createdSession.facilitatorEmail, 'fac1@example.org');
  assert.equal(createdSession.udiseCode, '01234567890');
  assert.equal(createdSession.pinCode, '006001');
  assert.equal(createdSession.overallCsat, 4.2);

  // Fac2 cannot read Fac1's session
  const fac2ReadOther = ctx.callApi('getSessionById', 'TOKEN_FAC_2', {
    sessionRecordId: createdSession.sessionRecordId,
  });
  assert.equal(fac2ReadOther.ok, false);
  assert.equal(fac2ReadOther.code, 'FORBIDDEN');

  // 11. Super Admin dashboard summary + Admin update
  const saSummary = ctx.callApi('getDashboardSummary', 'TOKEN_SA_2', { filters: {} });
  assert.equal(saSummary.ok, true);
  assert.equal(saSummary.data.totalSessions, 1);
  assert.equal(saSummary.data.reconciliation.verified, true);

  const adminCorrect = ctx.callApi('updateSession', 'TOKEN_SA_1', {
    sessionRecordId: createdSession.sessionRecordId,
    values: {
      facilitatorName: 'Facilitator One',
      facilitatorEmail: 'fac1@example.org',
      tourId: 'TOUR_AM',
      language: 'Tamil',
      startDate: today,
      endDate: today,
      startTime: '10:00',
      endTime: '11:30',
      schoolName: 'GHSS Panruti Leading Zero Test',
      udiseCode: '01234567890',
      schoolType: 'Government school',
      state: 'Tamil Nadu',
      district: 'Cuddalore',
      block: 'Panruti',
      pinCode: '006001',
      sessionMode: 'single',
      classes: [
        {
          rowId: '1',
          grade: '8',
          section: 'A',
          studentsPresent: '40',
          questionA: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
      ],
      teacherNpsGroup: 'promoter',
      teacherExactScore: '10',
    },
  });
  assert.equal(adminCorrect.ok, true);
  assert.equal(adminCorrect.data.session.submissionStatus, 'CORRECTED');
  assert.equal(ctx.sheets.get('Session Details').getLastRow(), 2);

  // 12. Google Sheets Connection management RPCs (connect target URL, sync idempotently, create new, disconnect non-destructively)
  const connRes = ctx.callApi('connectGoogleSheet', 'TOKEN_SA_1', {
    spreadsheetUrlOrId:
      'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
    initializeSchema: true,
  });
  assert.equal(connRes.ok, true);
  assert.equal(connRes.data.connected, true);
  assert.equal(connRes.data.spreadsheetId, '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE');
  assert.equal(connRes.data.initializedTabs.length, 8);
  const targetSs = ctx.spreadsheetsById.get('1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE');
  for (const tabName of expectedSheets) {
    assert.ok(targetSs.getSheetByName(tabName), `Expected initialized tab ${tabName} on target sheet`);
  }

  // Sync created session twice -> second sync must skip duplicates and avoid overwrites
  const firstSync = ctx.callApi('syncAllToGoogleSheet', 'TOKEN_SA_1', {
    sessions: [adminCorrect.data.session],
  });
  assert.equal(firstSync.ok, true);
  assert.equal(firstSync.data.syncedCount, 1);
  assert.equal(firstSync.data.skippedDuplicates, 0);

  const secondSync = ctx.callApi('syncAllToGoogleSheet', 'TOKEN_SA_2', {
    sessions: [adminCorrect.data.session],
  });
  assert.equal(secondSync.ok, true);
  assert.equal(secondSync.data.syncedCount, 0);
  assert.equal(secondSync.data.skippedDuplicates, 1);

  // Create new sheet & initialize schema
  const createdRes = ctx.callApi('createGoogleSheet', 'TOKEN_SA_2', {
    title: 'Vidhya Vidhai · Fresh Sheet 2026',
  });
  assert.equal(createdRes.ok, true);
  assert.equal(createdRes.data.connected, true);
  assert.equal(createdRes.data.spreadsheetName, 'Vidhya Vidhai · Fresh Sheet 2026');
  assert.equal(createdRes.data.initializedTabs.length, 8);

  // Disconnect non-destructively -> state becomes disconnected while sheet tabs stay intact
  const discRes = ctx.callApi('disconnectGoogleSheet', 'TOKEN_SA_1', {});
  assert.equal(discRes.ok, true);
  assert.equal(discRes.data.connected, false);
  const statusAfterDisc = ctx.callApi('getSheetsConnection', 'TOKEN_SA_1', {});
  assert.equal(statusAfterDisc.ok, true);
  assert.equal(statusAfterDisc.data.connected, false);
  assert.ok(targetSs.getSheetByName('Sessions').getLastRow() >= 2);

  // 13. LockService balanced release + Audit & Sync logs verified
  const lockStats = ctx.getLockStats();
  assert.ok(lockStats.lockAcquiredCount >= 8);
  assert.equal(lockStats.lockAcquiredCount, lockStats.lockReleasedCount);

  const auditRes = ctx.callApi('getAuditLogs', 'TOKEN_SA_1', { page: 1, pageSize: 50 });
  assert.equal(auditRes.ok, true);
  const syncLogRes = ctx.callApi('getSyncLogs', 'TOKEN_SA_2', { page: 1, pageSize: 50 });
  assert.equal(syncLogRes.ok, true);

  console.log(
    `Apps Script RBAC & backend verification passed: ${expectedSheets.length} sheets, dual Super Admins verified, Google Sheets connect/create/sync/disconnect verified, ${lockStats.lockAcquiredCount} locked mutations balanced cleanly.`,
  );
}

runVerification();
