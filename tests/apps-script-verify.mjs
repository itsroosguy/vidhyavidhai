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
      createFilter() {
        sheetObj.filter = {
          remove() {
            sheetObj.filter = null;
          },
        };
        return sheetObj.filter;
      },
    };
  }

  function createSheetObj(name) {
    const sheetObj = {
      name,
      data: [],
      frozenRows: 0,
      filter: null,
      getLastRow() {
        for (let i = sheetObj.data.length - 1; i >= 0; i--) {
          if (sheetObj.data[i].some((v) => v !== '' && v !== undefined && v !== null)) {
            return i + 1;
          }
        }
        return 0;
      },
      getLastColumn() {
        let maxC = 0;
        for (let i = 0; i < sheetObj.data.length; i++) {
          if (sheetObj.data[i] && sheetObj.data[i].length > maxC) {
            maxC = sheetObj.data[i].length;
          }
        }
        return maxC;
      },
      getMaxRows() {
        return Math.max(sheetObj.data.length, 200);
      },
      setFrozenRows(n) {
        sheetObj.frozenRows = n;
      },
      getFilter() {
        return sheetObj.filter;
      },
      getRange(r, c, nr = 1, nc = 1) {
        return makeRange(sheetObj, r, c, nr, nc);
      },
      deleteRow(rowNum) {
        if (rowNum >= 1 && rowNum <= sheetObj.data.length) {
          sheetObj.data.splice(rowNum - 1, 1);
        }
      },
      deleteColumn(colNum) {
        if (colNum >= 1) {
          for (let i = 0; i < sheetObj.data.length; i++) {
            if (sheetObj.data[i] && sheetObj.data[i].length >= colNum) {
              sheetObj.data[i].splice(colNum - 1, 1);
            }
          }
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
  const tokenFetchQueues = new Map();

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
      sleep: () => undefined,
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
        const queued = tokenFetchQueues.get(token);
        if (queued && queued.length > 0) {
          const next = queued.shift();
          if (queued.length === 0) tokenFetchQueues.delete(token);
          if (next instanceof Error) throw next;
          return next;
        }
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
    createSpreadsheetObj,
    tokenClaimsMap,
    setTokenFetchSequence: (token, responses) => {
      tokenFetchQueues.set(token, [...responses]);
    },
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
  // 0. Fresh uninitialized spreadsheet (only Sheet1):
  // Non-admin receives SETUP_REQUIRED without leaking admin emails, while allowlisted Super Admin
  // auto-initializes all 10 schema/KPI/Declaration tabs on first Google Sign-In.
  const coldCtx = createAppsScriptSandbox();
  const coldFacRes = coldCtx.callApi('getCurrentUser', 'TOKEN_FAC_1');
  assert.equal(coldFacRes.ok, false);
  assert.equal(coldFacRes.code, 'SETUP_REQUIRED');
  assert.equal(coldFacRes.error.includes('brinthajayaprakash'), false);
  assert.equal(coldFacRes.error.includes('karunya'), false);

  const coldSaRes = coldCtx.callApi('getCurrentUser', 'TOKEN_SA_1');
  assert.equal(coldSaRes.ok, true);
  assert.equal(coldSaRes.data.role, 'super_admin');
  assert.ok(coldCtx.sheets.has('Sessions'));
  assert.ok(coldCtx.sheets.has('Admin Users'));
  assert.ok(coldCtx.sheets.has('Summary & KPIs'));
  assert.ok(coldCtx.sheets.has('Declarations'));
  const coldFacAfterInit = coldCtx.callApi('getCurrentUser', 'TOKEN_FAC_1');
  assert.equal(coldFacAfterInit.ok, false);
  assert.equal(coldFacAfterInit.code, 'PENDING_APPROVAL');

  // Auto-populated Google Sheets connection metadata on cold Super Admin sign-in
  const coldConnRes = coldCtx.callApi('getSheetsConnection', 'TOKEN_SA_1', {});
  assert.equal(coldConnRes.ok, true);
  assert.equal(coldConnRes.data.connected, true);
  assert.equal(coldConnRes.data.spreadsheetId, 'TEST_SHEET_ID');
  assert.equal(coldConnRes.data.spreadsheetName, 'Initial Bound Sheet');
  assert.equal(coldConnRes.data.initializedTabs.length, 8);

  // Transient tokeninfo 503 retries once and recovers; persistent 503 returns TRANSIENT_AUTH_ERROR (not UNAUTHENTICATED)
  coldCtx.setTokenFetchSequence('TOKEN_SA_1', [
    { getResponseCode: () => 503, getContentText: () => 'Service Unavailable' },
    {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify(coldCtx.tokenClaimsMap.TOKEN_SA_1),
    },
  ]);
  const recoveredAuthRes = coldCtx.callApi('getSheetsConnection', 'TOKEN_SA_1', {});
  assert.equal(recoveredAuthRes.ok, true);
  assert.equal(recoveredAuthRes.data.connected, true);

  coldCtx.setTokenFetchSequence('TOKEN_SA_1', [
    { getResponseCode: () => 503, getContentText: () => 'Upstream Down' },
    { getResponseCode: () => 503, getContentText: () => 'Upstream Still Down' },
  ]);
  const persistentTransientRes = coldCtx.callApi('getSheetsConnection', 'TOKEN_SA_1', {});
  assert.equal(persistentTransientRes.ok, false);
  assert.equal(persistentTransientRes.code, 'TRANSIENT_AUTH_ERROR');

  const coldLocks = coldCtx.getLockStats();
  assert.equal(coldLocks.lockAcquiredCount, coldLocks.lockReleasedCount);

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
  assert.ok(ctx.sheets.has('Summary & KPIs'), 'Missing live Summary & KPIs sheet');
  assert.ok(ctx.sheets.has('Declarations'), 'Missing Declarations sheet');
  assert.ok(JSON.stringify(ctx.sheets.get('Summary & KPIs').data).includes('=IFERROR(COUNTIFS(Sessions!'));
  assert.ok(JSON.stringify(ctx.sheets.get('Declarations').data).includes('GOV-01'));
  assert.ok(JSON.stringify(ctx.sheets.get('Declarations').data).includes('INT-01'));
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

  // Restore manual_allowlist & configure Partner Name
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

  // Verify 41-col Sessions & 10-col Schools schema with zero 'block' column or district_blocks key, and removed RPC rejection
  const sessHeadersInit = ctx.sheets.get('Sessions').data[0];
  assert.equal(sessHeadersInit.length, 41);
  assert.equal(sessHeadersInit.includes('block'), false);
  const schHeadersInit = ctx.sheets.get('Schools').data[0];
  assert.equal(schHeadersInit.length, 10);
  assert.equal(schHeadersInit.includes('block'), false);
  const cfgKeysInit = ctx.sheets.get('Configuration').data.slice(1).map((r) => r[0]);
  assert.equal(cfgKeysInit.includes('district_blocks'), false);
  assert.equal(ctx.callApi('getBlocksForDistrict', 'TOKEN_SA_1', { district: 'Cuddalore' }).code, 'UNKNOWN_ACTION');

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
    ['getSheetsConnection', {}],
    ['connectGoogleSheet', { spreadsheetUrlOrId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE' }],
    ['createGoogleSheet', { title: 'Unauthorized Sheet' }],
    ['disconnectGoogleSheet', {}],
    ['syncAllToGoogleSheet', {}],
    ['restoreSession', { sessionRecordId: 'REC_ANY' }],
    ['deleteSession', { sessionRecordId: 'REC_ANY' }],
    ['bulkDeleteSessions', { sessionRecordIds: ['REC_ANY'] }],
    ['updateSchool', { school: { schoolRecordId: 'SCH_1', schoolName: 'X', udiseCode: '33180100101', schoolType: 'Government school', district: 'Cuddalore', pinCode: '607106', active: true } }],
    ['deleteSchool', { schoolRecordId: 'SCH_1' }],
    ['deleteUser', { userIdOrEmail: 'fac2@example.org' }],
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
  assert.ok(targetSs.getSheetByName('Summary & KPIs'), 'Expected Summary & KPIs tab on target sheet');
  assert.ok(targetSs.getSheetByName('Declarations'), 'Expected Declarations tab on target sheet');

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

  // 12b. Super Admin School Master Edit & Delete + DUPLICATE_UDISE guard + includeInactive search
  const createSchool2Res = ctx.callApi('createSession', 'TOKEN_FAC_2', {
    values: {
      clientSubmissionKey: 'idem-apps-script-2',
      facilitatorName: 'Facilitator Two',
      facilitatorEmail: 'fac2@example.org',
      tourId: 'TOUR_RFC',
      language: 'Tamil',
      startDate: today,
      endDate: today,
      startTime: '12:00',
      endTime: '13:00',
      schoolName: 'GHSS Nagapattinam Harbor',
      udiseCode: '09876543210',
      schoolType: 'Government school',
      state: 'Tamil Nadu',
      district: 'Nagapattinam',
      pinCode: '006111',
      sessionMode: 'single',
      classes: [
        {
          rowId: '1',
          grade: '9',
          section: 'A',
          studentsPresent: '30',
          questionA: { score5: '30', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '30', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
      ],
      teacherNpsGroup: 'promoter',
      teacherExactScore: '9',
    },
  });
  assert.equal(createSchool2Res.ok, true);
  const session2 = createSchool2Res.data.session;

  const schoolsBeforeEdit = ctx.callApi('searchSchools', 'TOKEN_SA_1', {
    query: '',
    includeInactive: true,
  });
  assert.equal(schoolsBeforeEdit.ok, true);
  assert.equal(schoolsBeforeEdit.data.length, 2);
  const school1 = schoolsBeforeEdit.data.find((s) => s.udiseCode === '01234567890');
  const school2 = schoolsBeforeEdit.data.find((s) => s.udiseCode === '09876543210');
  assert.ok(school1 && school2);

  // Duplicate UDISE collision rejected cleanly
  const dupUdiseUpdate = ctx.callApi('updateSchool', 'TOKEN_SA_1', {
    school: {
      ...school2,
      udiseCode: '01234567890',
    },
  });
  assert.equal(dupUdiseUpdate.ok, false);
  assert.equal(dupUdiseUpdate.code, 'DUPLICATE_UDISE');

  // Update school1 name, leading-zero UDISE & PIN, and mark inactive -> excluded unless includeInactive
  const updatedSchool1 = ctx.callApi('updateSchool', 'TOKEN_SA_2', {
    school: {
      ...school1,
      schoolName: 'GHSS Panruti Canonical',
      udiseCode: '00001234567',
      pinCode: '000607',
      active: false,
    },
  });
  assert.equal(updatedSchool1.ok, true);
  assert.equal(updatedSchool1.data.schoolName, 'GHSS Panruti Canonical');
  assert.equal(updatedSchool1.data.udiseCode, '00001234567');
  assert.equal(updatedSchool1.data.pinCode, '000607');
  assert.equal(updatedSchool1.data.active, false);

  const activeOnlySearch = ctx.callApi('searchSchools', 'TOKEN_SA_1', {
    query: '00001234567',
    includeInactive: false,
  });
  assert.equal(activeOnlySearch.data.length, 0);
  const allSearch = ctx.callApi('searchSchools', 'TOKEN_SA_1', {
    query: '00001234567',
    includeInactive: true,
  });
  assert.equal(allSearch.data.length, 1);

  const deletedSchool1 = ctx.callApi('deleteSchool', 'TOKEN_SA_1', {
    schoolRecordId: school1.schoolRecordId,
  });
  assert.equal(deletedSchool1.ok, true);
  assert.equal(deletedSchool1.data.deleted, true);
  const afterDeleteSchoolSearch = ctx.callApi('searchSchools', 'TOKEN_SA_1', {
    query: '00001234567',
    includeInactive: true,
  });
  assert.equal(afterDeleteSchoolSearch.data.length, 0);

  // 12c. Super Admin Delete User & Protected Initial Super Admin immutability
  const delProtectedByEmail = ctx.callApi('deleteUser', 'TOKEN_SA_1', {
    userIdOrEmail: 'karunya@vidhyavidhai.org',
  });
  assert.equal(delProtectedByEmail.ok, false);
  assert.equal(delProtectedByEmail.code, 'PROTECTED_ACCOUNT');

  const delProtectedById = ctx.callApi('deleteUser', 'TOKEN_SA_2', {
    userIdOrEmail: 'SA_BRINTHA',
  });
  assert.equal(delProtectedById.ok, false);
  assert.equal(delProtectedById.code, 'PROTECTED_ACCOUNT');

  const delFacRes = ctx.callApi('deleteUser', 'TOKEN_SA_1', {
    userIdOrEmail: 'new.teacher@example.org',
  });
  assert.equal(delFacRes.ok, true);
  assert.equal(delFacRes.data.deleted, true);
  assert.equal(
    ctx.sheets
      .get('Facilitators')
      .data.slice(1)
      .some((r) => r[2] === 'new.teacher@example.org'),
    false,
  );
  // Deleting removes their pre-approved grant, returning them to PENDING_APPROVAL under manual_allowlist
  assert.equal(ctx.callApi('getCurrentUser', 'TOKEN_NEW_GOOGLE').code, 'PENDING_APPROVAL');

  // 12d. Super Admin Session Archive -> Restore, Single Permanent Delete & Bulk Delete
  const archRes = ctx.callApi('archiveSession', 'TOKEN_SA_1', {
    sessionRecordId: createdSession.sessionRecordId,
  });
  assert.equal(archRes.ok, true);
  const activeSessionsAfterArch = ctx.callApi('getAdminSessions', 'TOKEN_SA_1', {
    filters: { includeArchived: false },
  });
  assert.equal(
    activeSessionsAfterArch.data.items.some(
      (s) => s.sessionRecordId === createdSession.sessionRecordId,
    ),
    false,
  );

  const restoreRes = ctx.callApi('restoreSession', 'TOKEN_SA_2', {
    sessionRecordId: createdSession.sessionRecordId,
  });
  assert.equal(restoreRes.ok, true);
  assert.equal(restoreRes.data.archived, false);
  const activeSessionsAfterRestore = ctx.callApi('getAdminSessions', 'TOKEN_SA_1', {
    filters: { includeArchived: false },
  });
  assert.equal(
    activeSessionsAfterRestore.data.items.some(
      (s) => s.sessionRecordId === createdSession.sessionRecordId,
    ),
    true,
  );

  // Create two extra sessions for single & bulk permanent deletion while keeping session2 intact
  const createExtra1 = ctx.callApi('createSession', 'TOKEN_FAC_1', {
    values: {
      clientSubmissionKey: 'idem-extra-delete-1',
      facilitatorName: 'Facilitator One',
      facilitatorEmail: 'fac1@example.org',
      tourId: 'TOUR_AM',
      language: 'Tamil',
      startDate: today,
      endDate: today,
      startTime: '14:00',
      endTime: '15:00',
      schoolName: 'GHSS Panruti Temp 1',
      udiseCode: '33180100991',
      schoolType: 'Government school',
      state: 'Tamil Nadu',
      district: 'Cuddalore',
      pinCode: '607106',
      sessionMode: 'combined',
      classes: [
        {
          rowId: '1',
          grade: '8',
          section: 'A',
          studentsPresent: '20',
          questionA: { score5: '20', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '20', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
        {
          rowId: '2',
          grade: '9',
          section: 'B',
          studentsPresent: '15',
          questionA: { score5: '15', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '15', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
      ],
      teacherNpsGroup: 'promoter',
      teacherExactScore: '10',
    },
  });
  assert.equal(createExtra1.ok, true);
  const extra1 = createExtra1.data.session;

  const createExtra2 = ctx.callApi('createSession', 'TOKEN_FAC_2', {
    values: {
      clientSubmissionKey: 'idem-extra-delete-2',
      facilitatorName: 'Facilitator Two',
      facilitatorEmail: 'fac2@example.org',
      tourId: 'TOUR_RFC',
      language: 'Tamil',
      startDate: today,
      endDate: today,
      startTime: '15:30',
      endTime: '16:30',
      schoolName: 'GHSS Nagapattinam Harbor',
      udiseCode: '09876543210',
      schoolType: 'Government school',
      state: 'Tamil Nadu',
      district: 'Nagapattinam',
      pinCode: '006111',
      sessionMode: 'single',
      classes: [
        {
          rowId: '1',
          grade: '10',
          section: 'A',
          studentsPresent: '25',
          questionA: { score5: '25', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '25', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
      ],
      teacherNpsGroup: 'passive',
      teacherExactScore: '8',
    },
  });
  assert.equal(createExtra2.ok, true);
  const extra2 = createExtra2.data.session;

  // Single permanent delete removes both Sessions row and its 2 Session Details rows
  const singleDel = ctx.callApi('deleteSession', 'TOKEN_SA_1', {
    sessionRecordId: extra1.sessionRecordId,
  });
  assert.equal(singleDel.ok, true);
  assert.equal(singleDel.data.deleted, true);
  assert.equal(singleDel.data.deletedDetailsCount, 2);
  assert.equal(
    ctx.callApi('getSessionById', 'TOKEN_SA_1', { sessionRecordId: extra1.sessionRecordId }).code,
    'NOT_FOUND',
  );

  // Bulk delete removes createdSession + extra2 atomically while leaving session2 and its detail rows intact
  const bulkDel = ctx.callApi('bulkDeleteSessions', 'TOKEN_SA_2', {
    sessionRecordIds: [createdSession.sessionRecordId, extra2.sessionRecordId],
  });
  assert.equal(bulkDel.ok, true);
  assert.equal(bulkDel.data.deletedCount, 2);
  assert.equal(bulkDel.data.deletedDetailsCount, 2);

  const remainingSessions = ctx.callApi('getAdminSessions', 'TOKEN_SA_1', {
    filters: { includeArchived: true },
  });
  assert.equal(remainingSessions.ok, true);
  assert.equal(remainingSessions.data.items.length, 1);
  assert.equal(remainingSessions.data.items[0].sessionRecordId, session2.sessionRecordId);
  assert.equal(remainingSessions.data.items[0].details.length, 1);
  // Header + 1 remaining detail row in Session Details
  assert.equal(ctx.sheets.get('Session Details').getLastRow(), 2);

  // 13. LockService balanced release + Audit & Sync logs verified
  const lockStats = ctx.getLockStats();
  assert.ok(lockStats.lockAcquiredCount >= 14);
  assert.equal(lockStats.lockAcquiredCount, lockStats.lockReleasedCount);

  const auditRes = ctx.callApi('getAuditLogs', 'TOKEN_SA_1', { page: 1, pageSize: 50 });
  assert.equal(auditRes.ok, true);
  const auditActions = auditRes.data.items.map((a) => a.action);
  for (const expectedAction of [
    'UPDATE_SCHOOL',
    'DELETE_SCHOOL',
    'DELETE_USER',
    'RESTORE_SESSION',
    'DELETE_SESSION',
    'BULK_DELETE_SESSIONS',
  ]) {
    assert.ok(auditActions.includes(expectedAction), `Missing audit action ${expectedAction}`);
  }
  const syncLogRes = ctx.callApi('getSyncLogs', 'TOKEN_SA_2', { page: 1, pageSize: 50 });
  assert.equal(syncLogRes.ok, true);
  const syncOps = syncLogRes.data.items.map((s) => s.operation);
  for (const expectedOp of ['archiveSession', 'restoreSession', 'deleteSession', 'bulkDeleteSessions']) {
    assert.ok(syncOps.includes(expectedOp), `Missing sync operation ${expectedOp}`);
  }

  // 14. Built Single-File Bundle (CareerToursAllInOne.gs) + Local Sandbox <-> Apps Script Bridge Verification
  const bundlePath = path.resolve(APPS_SCRIPT_DIR, 'dist/CareerToursAllInOne.gs');
  assert.ok(fs.existsSync(bundlePath), 'Expected built apps-script/dist/CareerToursAllInOne.gs bundle');
  const rawBundleSrc = fs.readFileSync(bundlePath, 'utf8');
  const presetSyncKey = 'VV-SYNC-TEST-BUNDLE-KEY-2026-ALPHA99';
  const personalizedBundleSrc = rawBundleSrc.replace(
    /var\s+CT_PRESET_SANDBOX_SYNC_KEY\s*=\s*['"]__CT_PRESET_SYNC_KEY__['"]\s*;/,
    `var CT_PRESET_SANDBOX_SYNC_KEY = '${presetSyncKey}';`,
  );
  assert.ok(
    personalizedBundleSrc.includes(presetSyncKey),
    'Personalized bundle should inject CT_PRESET_SANDBOX_SYNC_KEY',
  );

  // Boot the single-file bundle inside a fresh Apps Script VM sandbox (no initial bound spreadsheet to test standalone create)
  function createBundleSandbox(withBoundSheet = true) {
    const bundleSpreadsheets = new Map();
    let createdCount = 0;
    const bundleScriptProps = new Map();
    const bundleCache = new Map();
    let bLocksAcq = 0;
    let bLocksRel = 0;

    function makeSheet(name) {
      const s = {
        name,
        data: [],
        filter: null,
        getLastRow() {
          for (let i = s.data.length - 1; i >= 0; i--) {
            if (s.data[i].some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
          }
          return 0;
        },
        getLastColumn() {
          let maxC = 0;
          for (let i = 0; i < s.data.length; i++) {
            if (s.data[i] && s.data[i].length > maxC) maxC = s.data[i].length;
          }
          return maxC;
        },
        getMaxRows() {
          return Math.max(s.data.length, 200);
        },
        setFrozenRows() {},
        getFilter() {
          return s.filter;
        },
        getRange(r, c, nr = 1, nc = 1) {
          return {
            getValues() {
              const out = [];
              for (let rr = 0; rr < nr; rr++) {
                const row = [];
                const srcRow = s.data[r - 1 + rr] || [];
                for (let cc = 0; cc < nc; cc++) {
                  const val = srcRow[c - 1 + cc];
                  row.push(val === undefined ? '' : val);
                }
                out.push(row);
              }
              return out;
            },
            setValues(vals) {
              for (let rr = 0; rr < vals.length; rr++) {
                const ri = r - 1 + rr;
                while (s.data.length <= ri) s.data.push([]);
                for (let cc = 0; cc < vals[rr].length; cc++) {
                  s.data[ri][c - 1 + cc] = vals[rr][cc];
                }
              }
              return this;
            },
            setValue(v) {
              return this.setValues([[v]]);
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
            createFilter() {
              s.filter = {
                remove() {
                  s.filter = null;
                },
              };
              return s.filter;
            },
          };
        },
        deleteRow(rowNum) {
          if (rowNum >= 1 && rowNum <= s.data.length) s.data.splice(rowNum - 1, 1);
        },
        deleteColumn(colNum) {
          if (colNum >= 1) {
            for (let i = 0; i < s.data.length; i++) {
              if (s.data[i] && s.data[i].length >= colNum) s.data[i].splice(colNum - 1, 1);
            }
          }
        },
      };
      return s;
    }

    function makeSpreadsheet(id, title) {
      const ssMap = new Map([['Sheet1', makeSheet('Sheet1')]]);
      return {
        _id: id,
        _title: title,
        _sheets: ssMap,
        getId: () => id,
        getName: () => title,
        getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
        getSheetByName: (tab) => ssMap.get(tab) || null,
        insertSheet: (tab) => {
          const obj = makeSheet(tab);
          ssMap.set(tab, obj);
          return obj;
        },
      };
    }

    const bound = withBoundSheet ? makeSpreadsheet('BOUND_BRIDGE_SHEET', 'Bound Bridge Workbook') : null;
    if (bound) {
      bundleSpreadsheets.set(bound.getId(), bound);
      bundleScriptProps.set('SPREADSHEET_ID', bound.getId());
    }

    const bSandbox = {
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
      Logger: { log: () => undefined },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => bundleScriptProps.get(k) ?? null,
          setProperty: (k, v) => bundleScriptProps.set(k, String(v)),
          deleteProperty: (k) => bundleScriptProps.delete(k),
        }),
      },
      SpreadsheetApp: {
        openById: (id) => {
          const found = bundleSpreadsheets.get(id);
          if (!found) throw new Error(`Spreadsheet not found: ${id}`);
          return found;
        },
        create: (title) => {
          createdCount++;
          const newId = `STANDALONE_CREATED_${createdCount}`;
          const ss = makeSpreadsheet(newId, title);
          bundleSpreadsheets.set(newId, ss);
          return ss;
        },
        getActiveSpreadsheet: () => bound,
        flush: () => undefined,
      },
      CacheService: {
        getScriptCache: () => ({
          get: (k) => bundleCache.get(k) ?? null,
          put: (k, v) => bundleCache.set(k, v),
          remove: (k) => bundleCache.delete(k),
        }),
      },
      LockService: {
        getScriptLock: () => ({
          waitLock: () => {
            bLocksAcq++;
          },
          releaseLock: () => {
            bLocksRel++;
          },
        }),
      },
      Utilities: {
        getUuid: () => crypto.randomUUID(),
        sleep: () => undefined,
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
        fetch: () => {
          throw new Error('Bridge auth tests must not call external tokeninfo');
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
    vm.createContext(bSandbox);
    vm.runInContext(personalizedBundleSrc, bSandbox, { filename: 'CareerToursAllInOne.gs' });
    return {
      bSandbox,
      bundleSpreadsheets,
      bundleScriptProps,
      getLocks: () => ({ bLocksAcq, bLocksRel }),
      callBridge(action, syncKey, actorEmail, payload = {}) {
        const out = bSandbox.doPost({
          postData: { contents: JSON.stringify({ action, syncKey, actorEmail, payload }) },
        });
        return JSON.parse(out.getContent());
      },
    };
  }

  // 14a. Standalone Apps Script (no bound sheet): doGet reports unconfigured before setup,
  // bridge rejects before setupForLocalSandbox(), then setupForLocalSandbox() auto-creates 10-tab sheet & sets key
  const standalone = createBundleSandbox(false);
  const preSetupGet = JSON.parse(standalone.bSandbox.doGet().getContent());
  assert.equal(preSetupGet.ok, true);
  assert.deepEqual(preSetupGet.authModes, [
    'google_oauth',
    'sandbox_sync_bridge',
    'facilitator_intake_link',
  ]);
  assert.equal(preSetupGet.syncKeyConfigured, false);
  assert.equal(preSetupGet.intakeKeyConfigured, false);

  const preSetupPost = standalone.callBridge(
    'getSheetsConnection',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
  );
  assert.equal(preSetupPost.ok, false);
  assert.equal(preSetupPost.code, 'SYNC_KEY_NOT_CONFIGURED');

  const setupInfo = standalone.bSandbox.setupForLocalSandbox();
  assert.equal(setupInfo.ok, true);
  assert.equal(setupInfo.syncKeyConfigured, true);
  assert.equal(standalone.bundleScriptProps.get('SANDBOX_SYNC_KEY'), presetSyncKey);
  assert.ok(setupInfo.spreadsheetId.startsWith('STANDALONE_CREATED_'));

  const postSetupGet = JSON.parse(standalone.bSandbox.doGet().getContent());
  assert.equal(postSetupGet.syncKeyConfigured, true);
  assert.equal(postSetupGet.intakeKeyConfigured, true);

  // 14b. Reject invalid passphrase and non-allowlisted facilitator emails cleanly
  const badKeyRes = standalone.callBridge(
    'getSheetsConnection',
    'WRONG-KEY-1234567890',
    'brinthajayaprakash888@gmail.com',
  );
  assert.equal(badKeyRes.ok, false);
  assert.equal(badKeyRes.code, 'INVALID_SYNC_KEY');

  const facBridgeAttempt = standalone.callBridge(
    'getSheetsConnection',
    presetSyncKey,
    'fac1@example.org',
  );
  assert.equal(facBridgeAttempt.ok, false);
  assert.equal(facBridgeAttempt.code, 'FORBIDDEN');

  // 14c. Both allowlisted Super Admins authenticate via Bridge, create relative-title sheet, & sync idempotently
  const brinthaConn = standalone.callBridge(
    'getSheetsConnection',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
  );
  assert.equal(brinthaConn.ok, true);
  assert.equal(brinthaConn.data.authMethod, 'apps_script');
  assert.equal(brinthaConn.data.connectionProvider, 'apps_script');

  const relCreated = standalone.callBridge(
    'createGoogleSheet',
    presetSyncKey,
    'karunya@vidhyavidhai.org',
    { title: 'Career Tours · Cuddalore · Nov 2026' },
  );
  assert.equal(relCreated.ok, true);
  assert.equal(relCreated.data.spreadsheetName, 'Career Tours · Cuddalore · Nov 2026');
  const createdSsObj = standalone.bundleSpreadsheets.get(relCreated.data.spreadsheetId);
  assert.ok(createdSsObj.getSheetByName('Sessions'));
  assert.ok(createdSsObj.getSheetByName('Summary & KPIs'));
  assert.ok(createdSsObj.getSheetByName('Declarations'));

  const bridgeToday = standalone.bSandbox.ctGetTodayKolkataISO_();
  const sampleBridgeSession = {
    sessionRecordId: 'REC_BRIDGE_1',
    sessionId: `CT_IN_${bridgeToday.replace(/-/g, '')}_33180100777_08_A_001`,
    clientSubmissionKey: 'bridge-verify-key-1',
    facilitatorName: 'Brintha Jayaprakash',
    facilitatorEmail: 'brinthajayaprakash888@gmail.com',
    facilitatorUserId: 'SA_BRINTHA',
    tourId: 'TOUR_AM',
    tourName: 'Amazon Music: Careers Behind the Beats',
    videoId: 'AFE-IN-AM-OV-TA-2026',
    language: 'Tamil',
    startDate: bridgeToday,
    endDate: bridgeToday,
    startTime: '10:00',
    endTime: '11:00',
    durationMinutes: 60,
    durationFormatted: '1 hr',
    reportingMonth: 'November',
    submissionTimestamp: '2026-11-11T04:00:00Z',
    submissionDateFormatted: '11-11-2026',
    schoolName: 'GHSS Bridge Verification High',
    udiseCode: '33180100777',
    schoolType: 'Government school',
    state: 'Tamil Nadu',
    district: 'Cuddalore',
    pinCode: '607106',
    sessionType: 'single',
    totalClasses: 1,
    totalStudentsPresent: 35,
    totalQuestionAResponses: 35,
    totalQuestionBResponses: 35,
    overallCsat: 4.8,
    overallItp: 4.7,
    teacherScore: 10,
    teacherClassification: 'Promoter',
    teacherNps: 100,
    submissionStatus: 'COMMITTED',
    syncStatus: 'SYNCED',
    createdAt: '2026-11-11T04:00:00Z',
    updatedAt: '2026-11-11T04:00:00Z',
    createdBy: 'brinthajayaprakash888@gmail.com',
    updatedBy: 'brinthajayaprakash888@gmail.com',
    archived: false,
    details: [
      {
        detailRecordId: 'DET_BRIDGE_1',
        sessionRecordId: 'REC_BRIDGE_1',
        sessionId: `CT_IN_${bridgeToday.replace(/-/g, '')}_33180100777_08_A_001`,
        clientSubmissionKey: 'bridge-verify-key-1',
        grade: '8',
        section: 'A',
        studentsPresent: 35,
        qAResponses: 35,
        qA5: 30,
        qA4: 5,
        qA3: 0,
        qA2: 0,
        qA1: 0,
        qAAvg: 4.86,
        qBResponses: 35,
        qB5: 25,
        qB4: 10,
        qB3: 0,
        qB2: 0,
        qB1: 0,
        qBAvg: 4.71,
        createdAt: '2026-11-11T04:00:00Z',
      },
    ],
  };

  const syncPass1 = standalone.callBridge(
    'syncAllToGoogleSheet',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
    { sessions: [sampleBridgeSession] },
  );
  assert.equal(syncPass1.ok, true);
  assert.equal(syncPass1.data.syncedCount, 1);
  assert.equal(syncPass1.data.skippedDuplicates, 0);

  const syncPass2 = standalone.callBridge(
    'syncAllToGoogleSheet',
    presetSyncKey,
    'karunya@vidhyavidhai.org',
    { sessions: [sampleBridgeSession] },
  );
  assert.equal(syncPass2.ok, true);
  assert.equal(syncPass2.data.syncedCount, 0);
  assert.equal(syncPass2.data.skippedDuplicates, 1);
  assert.equal(createdSsObj.getSheetByName('Sessions').getLastRow(), 2);

  // Zero secret passphrases stored inside any sheet cell
  for (const [, tabObj] of createdSsObj._sheets.entries()) {
    assert.equal(
      JSON.stringify(tabObj.data).includes(presetSyncKey),
      false,
      `SANDBOX_SYNC_KEY leaked into sheet tab ${tabObj.name}`,
    );
  }
  const bundleLockStats = standalone.getLocks();
  assert.equal(bundleLockStats.bLocksAcq, bundleLockStats.bLocksRel);

  // 15. Non-destructive legacy Apps Script migration (42-col Sessions, 11-col Schools, district_blocks config row)
  const legCtx = createAppsScriptSandbox();
  const legSs = legCtx.createSpreadsheetObj('LEGACY_GAS_MIG_01', 'Legacy GAS Workbook');
  const legSessDef = legCtx.sandbox.CT_SCHEMA_DEFINITIONS[0];
  const legSchDef = legCtx.sandbox.CT_SCHEMA_DEFINITIONS[3];
  const legCfgDef = legCtx.sandbox.CT_SCHEMA_DEFINITIONS[4];

  const legSessHeaders42 = [...legSessDef.headers.slice(0, 24), 'block', ...legSessDef.headers.slice(24)];
  const legSchHeaders11 = [...legSchDef.headers.slice(0, 6), 'block', ...legSchDef.headers.slice(6)];

  const legSessSheet = legSs.insertSheet('Sessions');
  legSessSheet.data.push(legSessHeaders42);
  legSessSheet.data.push([
    'REC_GAS_LEG_1',
    'CT_IN_20261110_01234567890_08_A_001',
    'gas-legacy-key-1',
    'Brintha Jayaprakash',
    'brinthajayaprakash888@gmail.com',
    'SA_BRINTHA',
    'TOUR_AM',
    'Amazon Music: Careers Behind the Beats',
    'AFE-IN-AM-OV-TA-2026',
    'Tamil',
    '2026-11-10',
    '2026-11-10',
    '09:30',
    '10:30',
    60,
    '1 hr',
    'November',
    '2026-11-10T05:00:00Z',
    '10-11-2026',
    'GHSS GAS Legacy School',
    '01234567890',
    'Government school',
    'Tamil Nadu',
    'Cuddalore',
    'Panruti',
    '006001',
    'single',
    1,
    40,
    40,
    40,
    4.5,
    4.25,
    10,
    'Promoter',
    100,
    'COMMITTED',
    '2026-11-10T05:00:00Z',
    '2026-11-10T05:00:00Z',
    'brinthajayaprakash888@gmail.com',
    'brinthajayaprakash888@gmail.com',
    'false',
  ]);
  // Simulate pre-existing AutoFilter on legacy 42-col Sessions sheet
  legSessSheet.getRange(1, 1, 2, 42).createFilter();

  const legSchSheet = legSs.insertSheet('Schools');
  legSchSheet.data.push(legSchHeaders11);
  legSchSheet.data.push([
    'SCH_GAS_LEG_1',
    'GHSS GAS Legacy School',
    '01234567890',
    'Government school',
    'Tamil Nadu',
    'Cuddalore',
    'Panruti',
    '006001',
    'true',
    '2026-11-10T05:00:00Z',
    '2026-11-10T05:00:00Z',
  ]);

  const legCfgSheet = legSs.insertSheet('Configuration');
  legCfgSheet.data.push([...legCfgDef.headers]);
  legCfgSheet.data.push(['partner_name', JSON.stringify('Vidhya Vidhai'), '2026-11-10T00:00:00Z', 'SA_BRINTHA']);
  legCfgSheet.data.push([
    'district_blocks',
    JSON.stringify([{ district: 'Cuddalore', block: 'Panruti', active: true }]),
    '2026-11-10T00:00:00Z',
    'SA_BRINTHA',
  ]);
  legCfgSheet.data.push(['school_year', JSON.stringify('2026-2027'), '2026-11-10T00:00:00Z', 'SA_BRINTHA']);

  // Seed remaining schema tabs on legacy workbook so pre-migration RPC reads run end-to-end
  for (const d of legCtx.sandbox.CT_SCHEMA_DEFINITIONS) {
    if (!legSs.getSheetByName(d.name)) {
      const sh = legSs.insertSheet(d.name);
      sh.data.push([...d.headers]);
    }
  }
  legSs
    .getSheetByName('Admin Users')
    .data.push([
      'SA_BRINTHA',
      'Brintha Jayaprakash',
      'brinthajayaprakash888@gmail.com',
      'super_admin',
      'true',
      '2026-11-10T00:00:00Z',
      '2026-11-10T00:00:00Z',
      'APPROVED',
    ]);

  legCtx.spreadsheetsById.set('LEGACY_GAS_MIG_01', legSs);

  // Header-aware parsers handle un-migrated 42-col Sessions & 11-col Schools cleanly BEFORE migration
  const preConnNoInit = legCtx.callApi('connectGoogleSheet', 'TOKEN_SA_1', {
    spreadsheetUrlOrId: 'LEGACY_GAS_MIG_01',
    initializeSchema: false,
  });
  assert.equal(preConnNoInit.ok, true);
  assert.equal(legSessSheet.data[0].length, 42);
  assert.equal(legSchSheet.data[0].length, 11);

  const preAdminSessRes = legCtx.callApi('getAdminSessions', 'TOKEN_SA_1', { filters: {} });
  assert.equal(preAdminSessRes.ok, true);
  assert.equal(preAdminSessRes.data.items.length, 1);
  assert.equal(preAdminSessRes.data.items[0].pinCode, '006001');
  assert.equal(preAdminSessRes.data.items[0].totalStudentsPresent, 40);
  const preSchoolsRes = legCtx.callApi('searchSchools', 'TOKEN_SA_1', { query: '', includeInactive: true });
  assert.equal(preSchoolsRes.ok, true);
  assert.equal(preSchoolsRes.data.length, 1);
  assert.equal(preSchoolsRes.data[0].pinCode, '006001');
  assert.equal(preSchoolsRes.data[0].active, true);
  const preCfgRes = legCtx.callApi('getAppConfiguration', 'TOKEN_SA_1', {});
  assert.equal(preCfgRes.ok, true);
  assert.equal('districtBlocks' in preCfgRes.data, false);

  // Running initialize / connect migrates 42->41 Sessions, 11->10 Schools, and deletes district_blocks non-destructively
  const migInitRes = legCtx.callApi('connectGoogleSheet', 'TOKEN_SA_1', {
    spreadsheetUrlOrId: 'LEGACY_GAS_MIG_01',
    initializeSchema: true,
  });
  assert.equal(migInitRes.ok, true);
  assert.equal(legSessSheet.data[0].length, 41);
  assert.equal(legSessSheet.data[0].includes('block'), false);
  assert.equal(legSessSheet.data[1].length, 41);
  assert.equal(legSessSheet.data[1][24], '006001');
  assert.equal(legSessSheet.data[1][27], 40);

  assert.equal(legSchSheet.data[0].length, 10);
  assert.equal(legSchSheet.data[0].includes('block'), false);
  assert.equal(legSchSheet.data[1].length, 10);
  assert.equal(legSchSheet.data[1][5], 'Cuddalore');
  assert.equal(legSchSheet.data[1][6], '006001');

  const legCfgKeysAfter = legCfgSheet.data.slice(1).map((r) => r[0]);
  assert.equal(legCfgKeysAfter.includes('district_blocks'), false);
  assert.equal(legCfgKeysAfter.includes('partner_name'), true);
  assert.equal(legCfgKeysAfter.includes('school_year'), true);

  // Post-migration RPC reads still yield exact preserved records
  const postAdminSessRes = legCtx.callApi('getAdminSessions', 'TOKEN_SA_1', { filters: {} });
  assert.equal(postAdminSessRes.ok, true);
  assert.equal(postAdminSessRes.data.items.length, 1);
  assert.equal(postAdminSessRes.data.items[0].udiseCode, '01234567890');
  assert.equal(postAdminSessRes.data.items[0].pinCode, '006001');
  const postSchoolsRes = legCtx.callApi('searchSchools', 'TOKEN_SA_1', { query: '', includeInactive: true });
  assert.equal(postSchoolsRes.ok, true);
  assert.equal(postSchoolsRes.data[0].pinCode, '006001');
  const postCfgRes = legCtx.callApi('getAppConfiguration', 'TOKEN_SA_1', {});
  assert.equal(postCfgRes.ok, true);
  assert.equal('districtBlocks' in postCfgRes.data, false);
  const legLocks = legCtx.getLockStats();
  assert.equal(legLocks.lockAcquiredCount, legLocks.lockReleasedCount);

  // 16. Scoped Facilitator Intake Key + Multi-Device Sync + Import Recovery + Database Health + Trailing Empty Row Guard
  const intakeCfgRes = standalone.callBridge(
    'getTeamIntakeConfig',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
  );
  assert.equal(intakeCfgRes.ok, true);
  assert.equal(intakeCfgRes.data.configured, true);
  assert.ok(intakeCfgRes.data.intakeKey.length >= 16);
  assert.notEqual(intakeCfgRes.data.intakeKey, presetSyncKey);
  const teamIntakeKey = intakeCfgRes.data.intakeKey;

  const callIntake = (action, key, actorEmail, payload = {}, actorName = '') => {
    const out = standalone.bSandbox.doPost({
      postData: { contents: JSON.stringify({ action, intakeKey: key, actorEmail, actorName, payload }) },
    });
    return JSON.parse(out.getContent());
  };

  // Super Admins cannot use intake links, wrong intake keys fail, and restricted admin actions fail
  assert.equal(
    callIntake('createSession', 'WRONG-INTAKE-KEY-1234', 'remote.fac@example.org', { values: {} }).code,
    'INVALID_INTAKE_KEY',
  );
  assert.equal(
    callIntake('getMySessions', teamIntakeKey, 'brinthajayaprakash888@gmail.com', { filters: {} }).code,
    'FORBIDDEN',
  );

  // Manual allowlist queues unknown remote facilitator as PENDING_APPROVAL first
  const remotePending = callIntake(
    'getCurrentUser',
    teamIntakeKey,
    'remote.fac@example.org',
    {},
    'Remote Facilitator',
  );
  assert.equal(remotePending.ok, false);
  assert.equal(remotePending.code, 'PENDING_APPROVAL');

  // Switch approval mode to auto_approve -> brand new remote facilitator submits straight to sheet!
  const setAutoApprove = standalone.callBridge(
    'saveAppConfiguration',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
    {
      config: {
        policy: {
          allowFacilitatorDeleteOwn: true,
          allowFacilitatorExportOwn: false,
          facilitatorApprovalMode: 'auto_approve',
        },
      },
    },
  );
  assert.equal(setAutoApprove.ok, true);

  // Admin actions stay strictly blocked even on auto-approved intake facilitators
  for (const blockedAction of [
    'getAdminSessions',
    'getDashboardSummary',
    'listManagedUsers',
    'saveAppConfiguration',
    'importSessions',
    'getDatabaseHealth',
    'getSheetsConnection',
  ]) {
    const rBlocked = callIntake(blockedAction, teamIntakeKey, 'field.auto@example.org', {});
    assert.equal(rBlocked.ok, false);
    assert.equal(rBlocked.code, 'FORBIDDEN', `Intake link must block ${blockedAction}`);
  }

  // Allowed intake facilitator submits directly to the shared database -> visible to Super Admin
  const intakeSubmitRes = callIntake(
    'createSession',
    teamIntakeKey,
    'field.auto@example.org',
    {
      values: {
        clientSubmissionKey: 'team-intake-sub-1',
        facilitatorName: 'Field Facilitator',
        tourId: 'TOUR_AM',
        language: 'Tamil',
        startDate: '2026-11-11',
        endDate: '2026-11-11',
        startTime: '10:00',
        endTime: '11:00',
        schoolName: 'GHSS MultiDevice Field',
        udiseCode: '33180100888',
        schoolType: 'Government school',
        state: 'Tamil Nadu',
        district: 'Cuddalore',
        pinCode: '607106',
        sessionMode: 'single',
        classes: [
          {
            rowId: 'r1',
            grade: '9',
            section: 'A',
            studentsPresent: '40',
            questionA: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
            questionB: { score5: '20', score4: '20', score3: '0', score2: '0', score1: '0' },
          },
        ],
        teacherNpsGroup: 'promoter',
        teacherExactScore: '10',
      },
    },
    'Field Facilitator',
  );
  assert.equal(intakeSubmitRes.ok, true);
  assert.equal(intakeSubmitRes.data.session.facilitatorEmail, 'field.auto@example.org');

  // Verify admin immediately sees field.auto@example.org's submission via bridge loadWorkspace/getAdminSessions
  const adminLoaded = standalone.callBridge(
    'getAdminSessions',
    presetSyncKey,
    'karunya@vidhyavidhai.org',
    { filters: {} },
  );
  assert.equal(adminLoaded.ok, true);
  assert.ok(
    adminLoaded.data.items.some(
      (s) => s.schoolName === 'GHSS MultiDevice Field' && s.facilitatorEmail === 'field.auto@example.org',
    ),
  );

  // Rotate Team Intake Key -> old key invalidated, SANDBOX_SYNC_KEY remains active
  const rotatedRes = standalone.callBridge(
    'rotateTeamIntakeKey',
    presetSyncKey,
    'karunya@vidhyavidhai.org',
  );
  assert.equal(rotatedRes.ok, true);
  assert.notEqual(rotatedRes.data.intakeKey, teamIntakeKey);
  assert.equal(
    callIntake('getMySessions', teamIntakeKey, 'field.auto@example.org', { filters: {} }).code,
    'INVALID_INTAKE_KEY',
  );

  // Admin verified importSessions: recomputes CSAT/ITP/NPS, skips duplicates, rejects invalid rows, registers facilitator
  const importRes = standalone.callBridge(
    'importSessions',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
    {
      sessions: [
        {
          // duplicate of existing field submission -> skipped
          sessionRecordId: intakeSubmitRes.data.session.sessionRecordId,
          sessionId: intakeSubmitRes.data.session.sessionId,
          clientSubmissionKey: 'team-intake-sub-1',
        },
        {
          // valid trapped local session from another device with tampered metrics (server must recompute!)
          sessionRecordId: 'REC_TRAPPED_OTHER_DEVICE_1',
          clientSubmissionKey: 'trapped-key-1',
          facilitatorName: 'Trapped Facilitator',
          facilitatorEmail: 'trapped.device@example.org',
          tourId: 'TOUR_AM',
          language: 'Tamil',
          startDate: '2026-11-11',
          endDate: '2026-11-11',
          startTime: '14:00',
          endTime: '15:00',
          schoolName: 'GHSS Rescued From Phone',
          udiseCode: '33180100999',
          schoolType: 'Government school',
          state: 'Tamil Nadu',
          district: 'Nagapattinam',
          pinCode: '611104',
          sessionType: 'single',
          overallCsat: 1.0, // tampered -> server computes 5.0
          overallItp: 1.0, // tampered -> server computes 4.0
          teacherScore: 9,
          teacherNps: -100, // tampered -> server computes +100
          details: [
            {
              grade: '10',
              section: 'B',
              studentsPresent: 30,
              questionAScore5: 30,
              questionAScore4: 0,
              questionAScore3: 0,
              questionAScore2: 0,
              questionAScore1: 0,
              questionBScore5: 0,
              questionBScore4: 30,
              questionBScore3: 0,
              questionBScore2: 0,
              questionBScore1: 0,
            },
          ],
        },
        {
          // malformed record (bad UDISE) -> rejected with clear error
          sessionRecordId: 'REC_BAD_1',
          schoolName: 'Bad UDISE',
          udiseCode: '123',
          district: 'Cuddalore',
          tourId: 'TOUR_AM',
          language: 'Tamil',
          startDate: '2026-11-11',
          endDate: '2026-11-11',
          startTime: '09:00',
          endTime: '10:00',
          pinCode: '607106',
          schoolType: 'Government school',
          details: [],
        },
      ],
    },
  );
  assert.equal(importRes.ok, true);
  assert.equal(importRes.data.importedCount, 1);
  assert.equal(importRes.data.skippedDuplicates, 1);
  assert.equal(importRes.data.rejectedCount, 1);
  assert.equal(importRes.data.registeredFacilitators, 1);

  const importedLookup = standalone.callBridge(
    'getSessionById',
    presetSyncKey,
    'karunya@vidhyavidhai.org',
    { sessionRecordId: 'REC_TRAPPED_OTHER_DEVICE_1' },
  );
  assert.equal(importedLookup.ok, true);
  assert.equal(importedLookup.data.overallCsat, 5);
  assert.equal(importedLookup.data.overallItp, 4);
  assert.equal(importedLookup.data.teacherNps, 100);
  assert.equal(importedLookup.data.facilitatorEmail, 'trapped.device@example.org');

  // Trailing empty/whitespace row guard (ctFindLastPopulatedRow_) & getDatabaseHealth / recoverPendingSessions
  const sessTab = createdSsObj.getSheetByName('Sessions');
  const populatedCountBeforeGap = sessTab.getLastRow();
  assert.ok(populatedCountBeforeGap >= 3);
  for (let gap = populatedCountBeforeGap; gap < populatedCountBeforeGap + 4; gap++) {
    sessTab.data[gap] = [];
  }
  sessTab.data[populatedCountBeforeGap + 4] = ['', '', '', '', '   ']; // blank trailing cells in col 5
  assert.equal(
    standalone.bSandbox.ctFindLastPopulatedRow_(sessTab, 1),
    populatedCountBeforeGap,
  );
  const healthBefore = standalone.callBridge(
    'getDatabaseHealth',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
  );
  assert.equal(healthBefore.ok, true);
  assert.equal(healthBefore.data.healthy, true, JSON.stringify(healthBefore.data));

  // Simulate mid-write PENDING row on complete row -> recoverPendingSessions promotes cleanly
  sessTab.data[2][35] = 'PENDING';
  const recHealth = standalone.callBridge(
    'recoverPendingSessions',
    presetSyncKey,
    'brinthajayaprakash888@gmail.com',
  );
  assert.equal(recHealth.ok, true);
  assert.equal(recHealth.data.promotedPendingCount, 1);
  assert.equal(recHealth.data.pendingCount, 0);

  const bundleLockFinal = standalone.getLocks();
  assert.equal(bundleLockFinal.bLocksAcq, bundleLockFinal.bLocksRel);

  console.log(
    `Apps Script RBAC & backend verification passed: ${expectedSheets.length} sheets, dual Super Admins verified, Google Sheets connect/create/sync/disconnect + legacy non-destructive migration + Single-File Bundle Bridge + Scoped Facilitator Intake Key + Verified Import & Health Recovery verified, ${lockStats.lockAcquiredCount} locked mutations balanced cleanly.`,
  );
}

runVerification();
