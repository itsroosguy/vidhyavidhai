const e=`/**
 * CareerToursAllInOne.gs — Complete Google Apps Script Backend
 * Vidhya Vidhai · Career Tours Classroom Data Entry & Feedback Management System
 *
 * SETUP INSTRUCTIONS (Apps Script Sync Bridge):
 * 1. Open Google Sheets -> Extensions -> Apps Script (or open https://script.google.com).
 * 2. Replace all code inside Code.gs with this entire file and click Save (Ctrl/Cmd + S).
 * 3. Select the function \`setupForLocalSandbox\` from the top toolbar and click Run (grant Google Sheet permissions once).
 *    - Your Sync Passphrase is prefilled in \`CT_PRESET_SANDBOX_SYNC_KEY\` when copied from the app,
 *      OR you may set Script Property \`SANDBOX_SYNC_KEY\` under Project Settings -> Script properties.
 * 4. Click Deploy -> New deployment -> Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web app URL ending in /exec and paste it into the Career Tours top Google Sheets bar.
 */

// ============================================================================
// Module: Audit.gs
// ============================================================================

/**
 * Audit.gs — Immutable audit trail utilities for Career Tours Classroom System.
 */

var SHEET_NAMES = {
  SESSIONS: 'Sessions',
  SESSION_DETAILS: 'Session Details',
  FACILITATORS: 'Facilitators',
  SCHOOLS: 'Schools',
  CONFIGURATION: 'Configuration',
  ADMIN_USERS: 'Admin Users',
  AUDIT_LOG: 'Audit Log',
  SYNC_LOG: 'Sync Log'
};

var CT_DEFAULT_TARGET_SPREADSHEET_ID = '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE';
var CT_DEFAULT_TARGET_SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0';

/**
 * Extracts a valid Google Spreadsheet ID from either a full docs.google.com URL or a raw ID.
 */
function ctParseSpreadsheetId_(urlOrId) {
  var raw = String(urlOrId || '').trim();
  if (!raw) return '';
  var urlMatch = /\\/spreadsheets\\/d\\/([a-zA-Z0-9-_]{10,})/.exec(raw);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9-_]{10,120}$/.test(raw)) {
    return raw;
  }
  return '';
}

/**
 * Returns the configured database Spreadsheet.
 * Resolution order:
 *   1. CONNECTED_SPREADSHEET_ID (set via administrator Connect Google Sheets flow)
 *   2. SPREADSHEET_ID Script Property
 *   3. Approved programme default spreadsheet ID (if accessible)
 *   4. Active container-bound spreadsheet
 */
function ctGetSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var connectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  if (connectedId) {
    return SpreadsheetApp.openById(connectedId);
  }
  var spreadsheetId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  if (CT_DEFAULT_TARGET_SPREADSHEET_ID) {
    try {
      return SpreadsheetApp.openById(CT_DEFAULT_TARGET_SPREADSHEET_ID);
    } catch (err) {
      throw new Error(
        'Unable to open default Google Spreadsheet (' +
          CT_DEFAULT_TARGET_SPREADSHEET_ID +
          ') and SPREADSHEET_ID is not configured: ' +
          (err && err.message ? err.message : err)
      );
    }
  }
  throw new Error('SPREADSHEET_ID Script Property is not configured and no active spreadsheet is bound.');
}

function ctGetSheet_(name) {
  var ss = ctGetSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('Required sheet "' + name + '" does not exist. Run initializeDatabase() first.');
  }
  return sheet;
}

function ctNowIso_() {
  return new Date().toISOString();
}

function ctShortUuid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

/**
 * Returns the 1-based row index of the last populated row by inspecting a key column
 * (default col 1), ignoring trailing blank rows that only have borders, row banding, or dropdowns.
 */
function ctFindLastPopulatedRow_(sheet, optKeyCol) {
  if (!sheet) return 1;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;
  var colIdx = Math.max(1, Number(optKeyCol) || 1);
  var colVals = sheet.getRange(1, colIdx, lastRow, 1).getValues();
  for (var i = colVals.length - 1; i >= 1; i--) {
    var raw = colVals[i][0];
    if (String(raw === null || raw === undefined ? '' : raw).trim() !== '') {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Acquires the Apps Script document lock with bounded jittered retries to prevent
 * concurrent multi-device facilitator submissions from failing on transient lock contention.
 */
function ctAcquireScriptLockWithRetry_(optWaitMs, optMaxAttempts) {
  var lock = LockService.getScriptLock();
  var perAttemptWait = Math.max(5000, Number(optWaitMs) || 20000);
  var attempts = Math.max(1, Math.min(Number(optMaxAttempts) || 3, 5));
  var lastErr = null;
  for (var a = 0; a < attempts; a++) {
    try {
      lock.waitLock(perAttemptWait);
      return lock;
    } catch (err) {
      lastErr = err;
      if (
        a < attempts - 1 &&
        typeof Utilities !== 'undefined' &&
        typeof Utilities.sleep === 'function'
      ) {
        Utilities.sleep(250 + Math.floor(Math.random() * 250));
      }
    }
  }
  throw ctApiError_(
    'SERVICE_BUSY',
    'The programme database is temporarily busy saving another submission. Please try again in a moment. (' +
      (lastErr && lastErr.message ? lastErr.message : 'Lock timeout') +
      ')'
  );
}

/**
 * Appends a single audit log row (append-only, never modifies prior history).
 */
function ctAppendAuditLog_(actor, action, entityType, entityId, previousSummary, newSummary, result) {
  try {
    var sheet = ctGetSheet_(SHEET_NAMES.AUDIT_LOG);
    var auditId = 'AUD_' + ctShortUuid_();
    var ts = ctNowIso_();
    var row = [
      auditId,
      ts,
      actor && actor.userId ? String(actor.userId) : 'UNKNOWN',
      actor && actor.email ? String(actor.email) : 'UNKNOWN',
      String(action || ''),
      String(entityType || ''),
      String(entityId || ''),
      String(previousSummary || '').slice(0, 2000),
      String(newSummary || '').slice(0, 2000),
      String(result || 'SUCCESS')
    ];
    var nextRow = Math.max(2, ctFindLastPopulatedRow_(sheet, 1) + 1);
    var range = sheet.getRange(nextRow, 1, 1, row.length);
    range.setNumberFormat('@');
    range.setValues([row]);
  } catch (err) {
    console.error('Audit log failure: ' + (err && err.message ? err.message : err));
  }
}

/**
 * Paginated Audit Log reader (Administrator / Super Administrator only).
 */
function ctHandleGetAuditLogs_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);

  var page = Number(payload && payload.page) || 1;
  var pageSize = Number(payload && payload.pageSize) || 25;
  pageSize = Math.max(1, Math.min(pageSize, 100));

  var sheet = ctGetSheet_(SHEET_NAMES.AUDIT_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: pageSize,
      totalPages: 1
    };
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  // Return newest first
  var allItems = [];
  for (var i = values.length - 1; i >= 0; i--) {
    var r = values[i];
    if (!r[0]) continue;
    allItems.push({
      auditId: String(r[0]),
      timestamp: String(r[1]),
      userId: String(r[2]),
      userEmail: String(r[3]),
      action: String(r[4]),
      entityType: String(r[5]),
      entityId: String(r[6]),
      previousSummary: String(r[7]),
      newSummary: String(r[8]),
      result: String(r[9])
    });
  }

  var total = allItems.length;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  var safePage = Math.max(1, Math.min(page, totalPages));
  var startIdx = (safePage - 1) * pageSize;

  return {
    items: allItems.slice(startIdx, startIdx + pageSize),
    total: total,
    page: safePage,
    pageSize: pageSize,
    totalPages: totalPages
  };
}

function ctAppendSyncLog_(actor, clientSubmissionKey, sessionRecordId, sessionId, operation, attempt, status, errorMessage) {
  try {
    var sheet = ctGetSheet_(SHEET_NAMES.SYNC_LOG);
    var syncId = 'SYNC_' + ctShortUuid_();
    var ts = ctNowIso_();
    var row = [
      syncId,
      ts,
      String(clientSubmissionKey || ''),
      String(sessionRecordId || ''),
      String(sessionId || ''),
      actor && actor.email ? String(actor.email) : 'UNKNOWN',
      String(operation || ''),
      Number(attempt) || 1,
      String(status || 'SYNCED'),
      String(errorMessage || '').slice(0, 1000)
    ];
    var nextRow = Math.max(2, ctFindLastPopulatedRow_(sheet, 1) + 1);
    var range = sheet.getRange(nextRow, 1, 1, row.length);
    range.setValues([row]);
  } catch (err) {
    console.error('Sync log failure: ' + (err && err.message ? err.message : err));
  }
}

function ctHandleGetSyncLogs_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var page = Number(payload && payload.page) || 1;
  var pageSize = Number(payload && payload.pageSize) || 25;
  pageSize = Math.max(1, Math.min(pageSize, 100));

  var sheet = ctGetSheet_(SHEET_NAMES.SYNC_LOG);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { items: [], total: 0, page: 1, pageSize: pageSize, totalPages: 1 };
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var items = [];
  for (var i = values.length - 1; i >= 0; i--) {
    var r = values[i];
    if (!r[0]) continue;
    items.push({
      syncId: String(r[0]),
      timestamp: String(r[1]),
      clientSubmissionKey: String(r[2]),
      sessionRecordId: String(r[3]),
      sessionId: String(r[4]),
      actorEmail: String(r[5]),
      operation: String(r[6]),
      attempt: Number(r[7]) || 1,
      status: String(r[8]),
      errorMessage: String(r[9] || '')
    });
  }

  var total = items.length;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  var safePage = Math.max(1, Math.min(page, totalPages));
  var startIdx = (safePage - 1) * pageSize;

  return {
    items: items.slice(startIdx, startIdx + pageSize),
    total: total,
    page: safePage,
    pageSize: pageSize,
    totalPages: totalPages
  };
}

// ============================================================================
// Module: Configuration.gs
// ============================================================================

/**
 * Configuration.gs — Master configuration loader, writer, and CacheService manager.
 */

var CONFIG_CACHE_KEY = 'CT_APP_CONFIG_V1';
var CONFIG_CACHE_TTL_SECONDS = 300; // 5 minutes

function ctDefaultConfigObject_() {
  return {
    programmeTimezone: 'Asia/Kolkata',
    stateName: 'Tamil Nadu',
    allowedDistricts: ['Cuddalore', 'Nagapattinam', 'Sivaganga'],
    gradeOptions: ['8', '9', '10', '11', '12'],
    sectionOptions: ['A', 'B', 'C', 'D', 'E', 'F', 'No section'],
    schoolTypes: [
      'Government school',
      'Government aided school',
      'Private school',
      'Central government school (KV, JNV...)',
      'Tribal school (EMRS)',
      'Kasturba Gandhi Balika Vidyalaya (KGBV)',
      'Other'
    ],
    tours: [
      {
        tourId: 'TOUR_AM',
        tourName: 'Amazon Music: Careers Behind the Beats',
        tourCode: 'AM',
        active: true,
        videoIdByLanguage: {
          Tamil: 'AFE-IN-AM-OV-TA-2026'
        }
      },
      {
        tourId: 'TOUR_RFC',
        tourName: 'Robotics Fulfillment Center',
        tourCode: 'RFC',
        active: true,
        videoIdByLanguage: {}
      }
    ],
    languageOptions: ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Gujarati', 'Odia'],
    languageCodes: {
      English: 'EN',
      Hindi: 'HI',
      Tamil: 'TA',
      Telugu: 'TE',
      Kannada: 'KN',
      Marathi: 'MR',
      Gujarati: 'GU',
      Odia: 'OR'
    },
    schoolYear: '2026-27',
    // Partner name must be explicitly configured by Super Administrator; never fabricated
    partnerName: '',
    reportingDefaults: {
      cc: 'IN',
      completionRate: 100,
      underservedReach: 'Yes',
      dataSource: 'Manual',
      feedbackFrom: 'students and teacher',
      educatorId: 'NA'
    },
    policy: {
      allowFacilitatorDeleteOwn: true,
      allowFacilitatorExportOwn: false,
      facilitatorApprovalMode: 'manual_allowlist'
    },
    exportTemplate63: null
  };
}

function ctInvalidateConfigCache_() {
  try {
    CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  } catch (err) {
    console.warn('Cache invalidate error: ' + err);
  }
}

/**
 * Loads AppConfiguration from the Configuration sheet (with ScriptCache acceleration).
 */
function ctLoadConfiguration_() {
  try {
    var cached = CacheService.getScriptCache().get(CONFIG_CACHE_KEY);
    if (cached) {
      var parsedCached = JSON.parse(cached);
      if (parsedCached && Object.prototype.hasOwnProperty.call(parsedCached, 'districtBlocks')) {
        delete parsedCached.districtBlocks;
      }
      return parsedCached;
    }
  } catch (e) {
    // Ignore cache read error and read authoritative sheet
  }

  var cfg = ctDefaultConfigObject_();
  var sheet = ctGetSheet_(SHEET_NAMES.CONFIGURATION);
  var lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var keyMap = {
      programme_timezone: 'programmeTimezone',
      state_name: 'stateName',
      allowed_districts: 'allowedDistricts',
      grade_options: 'gradeOptions',
      section_options: 'sectionOptions',
      school_types: 'schoolTypes',
      tours: 'tours',
      language_options: 'languageOptions',
      language_codes: 'languageCodes',
      school_year: 'schoolYear',
      partner_name: 'partnerName',
      reporting_defaults: 'reportingDefaults',
      policy: 'policy',
      export_template_63: 'exportTemplate63'
    };

    for (var i = 0; i < rows.length; i++) {
      var k = String(rows[i][0] || '').trim();
      var rawVal = String(rows[i][1] || '').trim();
      var targetProp = keyMap[k];
      if (!targetProp || !rawVal) continue;
      try {
        cfg[targetProp] = JSON.parse(rawVal);
      } catch (parseErr) {
        if (typeof cfg[targetProp] === 'string') {
          cfg[targetProp] = rawVal;
        }
      }
    }
  }

  cfg.policy = {
    allowFacilitatorDeleteOwn: cfg.policy ? cfg.policy.allowFacilitatorDeleteOwn !== false : true,
    allowFacilitatorExportOwn: false,
    facilitatorApprovalMode:
      cfg.policy && cfg.policy.facilitatorApprovalMode === 'auto_approve'
        ? 'auto_approve'
        : 'manual_allowlist'
  };

  try {
    CacheService.getScriptCache().put(
      CONFIG_CACHE_KEY,
      JSON.stringify(cfg),
      CONFIG_CACHE_TTL_SECONDS
    );
  } catch (cacheErr) {
    // CacheService skips objects >100KB gracefully without blocking normal sheet operation
    console.warn('Config cache put skipped: ' + cacheErr);
  }

  return cfg;
}

/**
 * Upserts a single configuration key-value row without clearing the whole Configuration sheet.
 */
function ctUpsertConfigKey_(sheet, key, valueObj, actorEmail) {
  var lastRow = sheet.getLastRow();
  var nowIso = ctNowIso_();
  var jsonStr = JSON.stringify(valueObj);

  if (lastRow >= 2) {
    var keyCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keyCol.length; i++) {
      if (String(keyCol[i][0] || '').trim() === key) {
        var rowRange = sheet.getRange(i + 2, 1, 1, 4);
        rowRange.setNumberFormat('@');
        rowRange.setValues([[key, jsonStr, nowIso, actorEmail]]);
        return;
      }
    }
  }

  var appendRowIdx = Math.max(2, ctFindLastPopulatedRow_(sheet, 1) + 1);
  var appendRange = sheet.getRange(appendRowIdx, 1, 1, 4);
  appendRange.setNumberFormat('@');
  appendRange.setValues([[key, jsonStr, nowIso, actorEmail]]);
}

function ctHandleGetAppConfiguration_(actor) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var full = ctLoadConfiguration_();
  if (actor.role === 'super_admin') {
    return full;
  }
  // Facilitators receive strictly classroom entry lookups — never admin export schemas, partner constants, or approval policy
  return {
    programmeTimezone: full.programmeTimezone,
    stateName: full.stateName,
    allowedDistricts: full.allowedDistricts,
    gradeOptions: full.gradeOptions,
    sectionOptions: full.sectionOptions,
    schoolTypes: full.schoolTypes,
    tours: full.tours,
    languageOptions: full.languageOptions,
    languageCodes: full.languageCodes,
    schoolYear: full.schoolYear,
    partnerName: '',
    reportingDefaults: {
      cc: '',
      completionRate: 100,
      underservedReach: '',
      dataSource: full.reportingDefaults ? full.reportingDefaults.dataSource : 'Manual',
      feedbackFrom: full.reportingDefaults ? full.reportingDefaults.feedbackFrom : 'students and teacher',
      educatorId: full.reportingDefaults ? full.reportingDefaults.educatorId : 'NA'
    },
    policy: {
      allowFacilitatorDeleteOwn: Boolean(full.policy && full.policy.allowFacilitatorDeleteOwn),
      allowFacilitatorExportOwn: false,
      facilitatorApprovalMode: 'manual_allowlist'
    },
    exportTemplate63: null
  };
}

function ctHandleSaveAppConfiguration_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);

  var partial = (payload && payload.config) || {};
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var current = ctLoadConfiguration_();
    var prevSummary = JSON.stringify({
      schoolYear: current.schoolYear,
      partnerName: current.partnerName,
      allowedDistricts: current.allowedDistricts,
      toursCount: (current.tours || []).length
    });

    var sheet = ctGetSheet_(SHEET_NAMES.CONFIGURATION);
    var propToSheetKey = {
      programmeTimezone: 'programme_timezone',
      stateName: 'state_name',
      allowedDistricts: 'allowed_districts',
      gradeOptions: 'grade_options',
      sectionOptions: 'section_options',
      schoolTypes: 'school_types',
      tours: 'tours',
      languageOptions: 'language_options',
      languageCodes: 'language_codes',
      schoolYear: 'school_year',
      partnerName: 'partner_name',
      reportingDefaults: 'reporting_defaults',
      policy: 'policy',
      exportTemplate63: 'export_template_63'
    };

    var updatedKeys = [];
    for (var prop in propToSheetKey) {
      if (Object.prototype.hasOwnProperty.call(partial, prop) && partial[prop] !== undefined) {
        // Guard against invalid export template schema
        if (prop === 'exportTemplate63' && partial[prop] !== null) {
          var tpl = partial[prop];
          if (!tpl.columns || tpl.columns.length !== 63) {
            throw ctApiError_('INVALID_TEMPLATE', '63-column export template must contain exactly 63 columns.');
          }
        }
        var valToSave = partial[prop];
        if (prop === 'policy') {
          valToSave = {
            allowFacilitatorDeleteOwn: partial[prop].allowFacilitatorDeleteOwn !== false,
            allowFacilitatorExportOwn: false,
            facilitatorApprovalMode:
              partial[prop].facilitatorApprovalMode === 'auto_approve'
                ? 'auto_approve'
                : 'manual_allowlist'
          };
        }
        ctUpsertConfigKey_(sheet, propToSheetKey[prop], valToSave, actor.email);
        updatedKeys.push(propToSheetKey[prop]);
      }
    }

    ctInvalidateConfigCache_();
    var nextConfig = ctLoadConfiguration_();

    ctAppendAuditLog_(
      actor,
      'UPDATE_CONFIG',
      'Configuration',
      'SYSTEM',
      prevSummary,
      'Updated keys: ' + updatedKeys.join(', '),
      'SUCCESS'
    );

    return nextConfig;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// Module: Auth.gs
// ============================================================================

/**
 * Auth.gs — Server-side Google ID Token / Apps Script Sync Bridge verification and RBAC.
 *
 * SECURITY MODEL:
 * 1. Never trust browser-supplied role claims or raw email headers without cryptographic/secret proof.
 * 2. Verify browser requests using Google Identity Services \`idToken\` against Google's tokeninfo endpoint
 *    (\`aud === GOOGLE_CLIENT_ID\`, \`email_verified === true\`, unexpired \`exp\`), OR using the server-stored
 *    \`SANDBOX_SYNC_KEY\` Script Property restricted strictly to allowlisted Super Administrator emails.
 * 3. Only server-side allowlisted SUPER_ADMIN accounts (\`brinthajayaprakash888@gmail.com\`,
 *    \`karunya@vidhyavidhai.org\`, \`ram@vidhyavidhai.org\`, \`regi@vidhyavidhai.org\`,
 *    and \`nisha@vidhyavidhai.org\`) may receive \`super_admin\` privileges or use the Apps Script Sync Bridge.
 * 4. All other users authenticate strictly via Google Sign-In, resolve against \`Facilitators\`
 *    subject to \`policy.facilitatorApprovalMode\`, and can never hold administrator roles.
 * 5. Zero user passwords are stored or verified in source code, sheets, or configuration.
 */

var ROLE_RANK = {
  facilitator: 1,
  super_admin: 2
};

function ctGetInitialSuperAdmins_() {
  return [
    {
      userId: 'SA_BRINTHA',
      name: 'Brintha Jayaprakash',
      email: 'brinthajayaprakash888@gmail.com'
    },
    {
      userId: 'SA_KARUNYA',
      name: 'Karunya',
      email: 'karunya@vidhyavidhai.org'
    },
    {
      userId: 'SA_RAM',
      name: 'Ram',
      email: 'ram@vidhyavidhai.org'
    },
    {
      userId: 'SA_REGI',
      name: 'Regi',
      email: 'regi@vidhyavidhai.org'
    },
    {
      userId: 'SA_NISHA',
      name: 'Nisha',
      email: 'nisha@vidhyavidhai.org'
    }
  ];
}

function ctFindInitialSuperAdminByEmail_(email) {
  var clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  var list = ctGetInitialSuperAdmins_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].email === clean) {
      return list[i];
    }
  }
  return null;
}

function ctIsAllowlistedSuperAdmin_(email) {
  return Boolean(ctFindInitialSuperAdminByEmail_(email));
}

function ctApiError_(code, message) {
  var err = new Error(message);
  err.apiCode = code;
  return err;
}

function ctConstantTimeEqual_(a, b) {
  var strA = String(a || '');
  var strB = String(b || '');
  var maxLen = Math.max(strA.length, strB.length);
  var diff = strA.length ^ strB.length;
  for (var i = 0; i < maxLen; i++) {
    var cA = i < strA.length ? strA.charCodeAt(i) : 0;
    var cB = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= cA ^ cB;
  }
  return diff === 0 && strA.length > 0;
}

function ctGetSandboxSyncKey_() {
  var props = PropertiesService.getScriptProperties();
  return String(props.getProperty('SANDBOX_SYNC_KEY') || '').trim();
}

function ctConfigureSandboxSyncKey_(optionalCustomKey) {
  var props = PropertiesService.getScriptProperties();
  var placeholder = '__CT_PRESET_' + 'SYNC_KEY__';
  var clean = String(optionalCustomKey || '').trim();
  if (clean === placeholder) {
    clean = '';
  }
  if (clean && clean.length < 16) {
    throw ctApiError_('INVALID_SYNC_KEY', 'Sandbox Sync Key must be at least 16 characters long.');
  }

  var existing = ctGetSandboxSyncKey_();
  var finalKey = clean || (existing.length >= 16 ? existing : 'VV-SYNC-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24).toUpperCase());
  if (typeof props.setProperty === 'function') {
    props.setProperty('SANDBOX_SYNC_KEY', finalKey);
  }
  return finalKey;
}

function ctVerifySandboxBridgeCredentials_(syncKey, actorEmail) {
  var configured = ctGetSandboxSyncKey_();
  if (!configured || configured.length < 16) {
    throw ctApiError_(
      'SYNC_KEY_NOT_CONFIGURED',
      'SANDBOX_SYNC_KEY is not configured on this Apps Script Web App. Run setupForLocalSandbox() in Apps Script first.'
    );
  }
  if (!ctConstantTimeEqual_(String(syncKey || '').trim(), configured)) {
    throw ctApiError_(
      'INVALID_SYNC_KEY',
      'Invalid Sync Bridge Passphrase. Copy the exact Sync Passphrase into Apps Script or update it in the top bar.'
    );
  }

  var cleanEmail = String(actorEmail || '').trim().toLowerCase();
  if (!cleanEmail) {
    throw ctApiError_('UNAUTHENTICATED', 'Missing Super Administrator email for Apps Script Sync Bridge.');
  }
  var allowlistedSa = ctFindInitialSuperAdminByEmail_(cleanEmail);
  if (!allowlistedSa) {
    throw ctApiError_(
      'FORBIDDEN',
      'Apps Script Sync Bridge is restricted strictly to allowlisted Super Administrator accounts.'
    );
  }

  return {
    allowlistedSa: allowlistedSa,
    email: allowlistedSa.email,
    name: allowlistedSa.name
  };
}

var CT_FACILITATOR_INTAKE_ALLOWED_ACTIONS = [
  'getCurrentUser',
  'getAppConfiguration',
  'createSession',
  'updateSession',
  'archiveSession',
  'getSessionById',
  'getMySessions',
  'getSchoolByUdise'
];

function ctGetFacilitatorIntakeKey_() {
  var props = PropertiesService.getScriptProperties();
  return String(props.getProperty('FACILITATOR_INTAKE_KEY') || '').trim();
}

function ctConfigureFacilitatorIntakeKey_(optionalCustomKey, optForceRotate) {
  var props = PropertiesService.getScriptProperties();
  var placeholder = '__CT_PRESET_' + 'INTAKE_KEY__';
  var clean = String(optionalCustomKey || '').trim();
  if (clean === placeholder) {
    clean = '';
  }
  if (clean && clean.length < 16) {
    throw ctApiError_(
      'INVALID_INTAKE_KEY',
      'Team Submission Intake Key must be at least 16 characters long.'
    );
  }

  var existing = optForceRotate ? '' : ctGetFacilitatorIntakeKey_();
  var finalKey =
    clean ||
    (existing.length >= 16
      ? existing
      : 'VV-TEAM-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24).toUpperCase());
  if (typeof props.setProperty === 'function') {
    props.setProperty('FACILITATOR_INTAKE_KEY', finalKey);
  }
  return finalKey;
}

function ctVerifyFacilitatorIntakeCredentials_(intakeKey, actorEmail, optActorName) {
  var configured = ctGetFacilitatorIntakeKey_();
  if (!configured || configured.length < 16) {
    throw ctApiError_(
      'INTAKE_KEY_NOT_CONFIGURED',
      'Team Submission Link is not active on this programme backend yet. Ask your Super Administrator to generate a new Team Submission Link.'
    );
  }
  if (!ctConstantTimeEqual_(String(intakeKey || '').trim(), configured)) {
    throw ctApiError_(
      'INVALID_INTAKE_KEY',
      'Team Submission Link key is invalid or was rotated by the Super Administrator. Request an updated Team Submission Link.'
    );
  }

  var cleanEmail = String(actorEmail || '').trim().toLowerCase();
  if (!cleanEmail || cleanEmail.indexOf('@') === -1) {
    throw ctApiError_('UNAUTHENTICATED', 'Enter a valid email address to submit via a Team Submission Link.');
  }

  if (ctIsAllowlistedSuperAdmin_(cleanEmail)) {
    ctAppendAuditLog_(
      { userId: 'SA_BLOCKED_INTAKE', email: cleanEmail },
      'AUTH_DENIED',
      'Security',
      cleanEmail,
      '',
      'Blocked Super Administrator sign-in via Facilitator Team Intake Link',
      'DENIED'
    );
    throw ctApiError_(
      'FORBIDDEN',
      'Super Administrator accounts cannot use Team Submission Links. Sign in with your password or Google OAuth instead.'
    );
  }

  var ss;
  try {
    ss = ctGetSpreadsheet_();
  } catch (ssErr) {
    throw ctApiError_(
      'SPREADSHEET_NOT_CONNECTED',
      'The central programme database is not connected yet. Please contact your Super Administrator.'
    );
  }
  if (!ss || !ss.getSheetByName(SHEET_NAMES.FACILITATORS)) {
    throw ctApiError_(
      'SETUP_REQUIRED',
      'The programme database is not initialized yet. Ask a Super Administrator to complete setup first.'
    );
  }

  var cleanDisplayName = String(optActorName || '').trim() || cleanEmail;
  var facilitators = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
  var matched = null;
  for (var j = 0; j < facilitators.length; j++) {
    if (facilitators[j].email === cleanEmail) {
      matched = facilitators[j];
      break;
    }
  }

  if (matched) {
    if (matched.status === 'PENDING') {
      throw ctApiError_(
        'PENDING_APPROVAL',
        'Your account ("' + cleanEmail + '") is pending Administrator approval in User Management.'
      );
    }
    if (!matched.active || matched.status === 'DENIED') {
      ctAppendAuditLog_(
        matched,
        'AUTH_DENIED',
        'Auth',
        matched.userId || cleanEmail,
        '',
        'Denied or inactive facilitator attempted Team Intake submission',
        'DENIED'
      );
      throw ctApiError_(
        'ACCESS_DENIED',
        'Access denied for "' + cleanEmail + '". Contact your Administrator.'
      );
    }
    return {
      userId: matched.userId || ('USR_' + cleanEmail),
      name: matched.name || cleanDisplayName,
      email: matched.email,
      role: 'facilitator',
      active: true,
      status: 'APPROVED',
      authMode: 'facilitator_intake_link'
    };
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var freshRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
    var rechecked = null;
    for (var f = 0; f < freshRows.length; f++) {
      if (freshRows[f].email === cleanEmail) {
        rechecked = freshRows[f];
        break;
      }
    }
    if (rechecked) {
      if (rechecked.status === 'PENDING') {
        throw ctApiError_(
          'PENDING_APPROVAL',
          'Your account ("' + cleanEmail + '") is pending Administrator approval in User Management.'
        );
      }
      if (!rechecked.active || rechecked.status === 'DENIED') {
        throw ctApiError_(
          'ACCESS_DENIED',
          'Access denied for "' + cleanEmail + '". Contact your Administrator.'
        );
      }
      return {
        userId: rechecked.userId || ('USR_' + cleanEmail),
        name: rechecked.name || cleanDisplayName,
        email: rechecked.email,
        role: 'facilitator',
        active: true,
        status: 'APPROVED',
        authMode: 'facilitator_intake_link'
      };
    }

    var config = ctLoadConfiguration_();
    var approvalMode =
      config && config.policy && config.policy.facilitatorApprovalMode === 'auto_approve'
        ? 'auto_approve'
        : 'manual_allowlist';
    var nowIso = ctNowIso_();
    var newUserId = 'FAC_' + ctShortUuid_().slice(0, 8);
    var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);
    var nextRow = Math.max(2, ctFindLastPopulatedRow_(facSheet, 1) + 1);
    var rowRange = facSheet.getRange(nextRow, 1, 1, 8);
    rowRange.setNumberFormat('@');

    if (approvalMode === 'auto_approve') {
      rowRange.setValues([
        [newUserId, cleanDisplayName, cleanEmail, 'facilitator', 'true', nowIso, nowIso, 'APPROVED']
      ]);
      ctAppendAuditLog_(
        { userId: newUserId, email: cleanEmail },
        'AUTH_AUTO_APPROVED',
        'Auth',
        newUserId,
        '',
        'Auto-approved facilitator via Team Submission Link',
        'SUCCESS'
      );
      return {
        userId: newUserId,
        name: cleanDisplayName,
        email: cleanEmail,
        role: 'facilitator',
        active: true,
        status: 'APPROVED',
        authMode: 'facilitator_intake_link'
      };
    }

    rowRange.setValues([
      [newUserId, cleanDisplayName, cleanEmail, 'facilitator', 'false', nowIso, nowIso, 'PENDING']
    ]);
    ctAppendAuditLog_(
      { userId: newUserId, email: cleanEmail },
      'AUTH_PENDING',
      'Auth',
      newUserId,
      '',
      'New facilitator via Team Submission Link queued as PENDING approval',
      'DENIED'
    );
    throw ctApiError_(
      'PENDING_APPROVAL',
      'Your account ("' +
        cleanEmail +
        '") was registered and is awaiting Administrator approval in User Management.'
    );
  } finally {
    lock.releaseLock();
  }
}

function ctRequireIntakeActionAllowed_(actor, action) {
  if (!actor || actor.authMode !== 'facilitator_intake_link') return;
  if (actor.role !== 'facilitator') {
    throw ctApiError_('FORBIDDEN', 'Team Submission Links only allow restricted Facilitator access.');
  }
  for (var i = 0; i < CT_FACILITATOR_INTAKE_ALLOWED_ACTIONS.length; i++) {
    if (CT_FACILITATOR_INTAKE_ALLOWED_ACTIONS[i] === action) {
      return;
    }
  }
  ctAppendAuditLog_(
    actor,
    'RBAC_DENIED',
    'Security',
    actor.email,
    '',
    'Blocked restricted action via Team Submission Link: ' + action,
    'DENIED'
  );
  throw ctApiError_(
    'FORBIDDEN',
    'Team Submission Links only allow classroom session entry and viewing your own submissions.'
  );
}

/**
 * Verifies a Google Identity Services ID token JWT server-side.
 * Returns { email, name, sub }.
 */
function ctVerifyGoogleIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw ctApiError_('UNAUTHENTICATED', 'Missing Google ID token. Please sign in.');
  }

  var props = PropertiesService.getScriptProperties();
  var expectedClientId = String(props.getProperty('GOOGLE_CLIENT_ID') || '').trim();
  if (!expectedClientId) {
    throw ctApiError_(
      'SERVER_MISCONFIGURED',
      'GOOGLE_CLIENT_ID Script Property is not configured on Apps Script backend.'
    );
  }

  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  var response = null;
  var fetchError = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var code = response.getResponseCode();
      if (code === 429 || code >= 500) {
        if (attempt === 0 && typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
          Utilities.sleep(250);
          continue;
        }
        throw ctApiError_(
          'TRANSIENT_AUTH_ERROR',
          'Temporary Google authentication verification error (HTTP ' + code + '). Please retry.'
        );
      }
      break;
    } catch (err) {
      if (err && err.apiCode === 'TRANSIENT_AUTH_ERROR') {
        throw err;
      }
      fetchError = err;
      if (attempt === 0 && typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
        Utilities.sleep(250);
        continue;
      }
    }
  }

  if (!response) {
    throw ctApiError_(
      'TRANSIENT_AUTH_ERROR',
      'Temporarily unable to verify Google sign-in token: ' +
        (fetchError && fetchError.message ? fetchError.message : 'Network error')
    );
  }

  if (response.getResponseCode() !== 200) {
    throw ctApiError_('UNAUTHENTICATED', 'Invalid or expired Google sign-in token. Please sign in again.');
  }

  var claims;
  try {
    claims = JSON.parse(response.getContentText() || '{}');
  } catch (parseErr) {
    throw ctApiError_('TRANSIENT_AUTH_ERROR', 'Malformed response from Google token verification.');
  }
  if (String(claims.aud || '') !== expectedClientId) {
    throw ctApiError_('UNAUTHENTICATED', 'Google token audience mismatch.');
  }
  if (String(claims.email_verified) !== 'true' || !claims.email) {
    throw ctApiError_('UNAUTHENTICATED', 'Google account email is not verified.');
  }
  var nowSec = Math.floor(Date.now() / 1000);
  if (Number(claims.exp || 0) <= nowSec) {
    throw ctApiError_('UNAUTHENTICATED', 'Google sign-in session expired. Please sign in again.');
  }

  return {
    email: String(claims.email).trim().toLowerCase(),
    name: String(claims.name || claims.email).trim(),
    sub: String(claims.sub || '')
  };
}

function ctReadUserRowsFromSheet_(sheetName) {
  var sheet = ctGetSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var vals = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var list = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var email = String(r[2] || '').trim().toLowerCase();
    if (!email) continue;
    var activeRaw = r[4];
    var active =
      activeRaw === true ||
      String(activeRaw).trim().toLowerCase() === 'true' ||
      String(activeRaw).trim() === '1';
    var rawStatus = String(r[7] || '').trim().toUpperCase();
    var status =
      rawStatus === 'APPROVED' || rawStatus === 'PENDING' || rawStatus === 'DENIED'
        ? rawStatus
        : active
        ? 'APPROVED'
        : 'DENIED';

    list.push({
      rowNumber: i + 2,
      userId: String(r[0] || '').trim(),
      name: String(r[1] || '').trim(),
      email: email,
      role: String(r[3] || '').trim().toLowerCase(),
      active: active,
      createdAt: String(r[5] || ''),
      updatedAt: String(r[6] || ''),
      status: status
    });
  }
  return list;
}

/**
 * Authenticates the caller via Google ID token OR Apps Script Sync Bridge (\`syncKey\` + allowlisted
 * Super Administrator email) and resolves their authoritative server role.
 */
function ctAuthenticateRequest_(idToken, req) {
  var allowlistedSa = null;
  var verifiedName = '';
  var authMode = 'google_oauth';
  var cleanIdToken = idToken && typeof idToken === 'string' ? idToken.trim() : '';

  if (cleanIdToken) {
    var verified = ctVerifyGoogleIdToken_(cleanIdToken);
    verifiedName = verified.name || '';
    var email = verified.email;

    // 1. Strict server-side allowlist for protected SUPER_ADMIN accounts
    allowlistedSa = ctFindInitialSuperAdminByEmail_(email);
    if (!allowlistedSa) {
      // 2. Every other user authenticates via Google Sign-In and resolves strictly as a Facilitator
      var ssForFac = ctGetSpreadsheet_();
      if (!ssForFac.getSheetByName(SHEET_NAMES.FACILITATORS)) {
        throw ctApiError_(
          'SETUP_REQUIRED',
          'Workspace Google Sheet tabs are not initialized yet. Please ask a Super Administrator to sign in first.'
        );
      }
      var facilitators = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
      var matched = null;
      for (var j = 0; j < facilitators.length; j++) {
        if (facilitators[j].email === email) {
          matched = facilitators[j];
          break;
        }
      }

      if (matched) {
        if (matched.status === 'PENDING') {
          ctAppendAuditLog_(
            matched,
            'AUTH_PENDING',
            'Auth',
            matched.userId || email,
            '',
            'Pending administrator approval on Google sign-in',
            'DENIED'
          );
          throw ctApiError_(
            'PENDING_APPROVAL',
            'Your Google account ("' + email + '") is pending Administrator approval.'
          );
        }
        if (!matched.active || matched.status === 'DENIED') {
          ctAppendAuditLog_(
            matched,
            'AUTH_DENIED',
            'Auth',
            matched.userId || email,
            '',
            'Denied or inactive facilitator attempted sign-in',
            'DENIED'
          );
          throw ctApiError_(
            'ACCESS_DENIED',
            'Access denied for "' + email + '". Contact your Administrator.'
          );
        }

        return {
          userId: matched.userId || ('USR_' + email),
          name: matched.name || verified.name || email,
          email: matched.email,
          role: 'facilitator',
          active: true,
          status: 'APPROVED',
          authMode: 'google_oauth'
        };
      }

      // 3. First-time Google user not yet in Facilitators: apply configured approval policy under ScriptLock
      var lock = ctAcquireScriptLockWithRetry_(20000, 3);
      try {
        var freshRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
        var rechecked = null;
        for (var f = 0; f < freshRows.length; f++) {
          if (freshRows[f].email === email) {
            rechecked = freshRows[f];
            break;
          }
        }

        if (rechecked) {
          if (rechecked.status === 'PENDING') {
            throw ctApiError_(
              'PENDING_APPROVAL',
              'Your Google account ("' + email + '") is pending Administrator approval.'
            );
          }
          if (!rechecked.active || rechecked.status === 'DENIED') {
            throw ctApiError_(
              'ACCESS_DENIED',
              'Access denied for "' + email + '". Contact your Administrator.'
            );
          }
          return {
            userId: rechecked.userId || ('USR_' + email),
            name: rechecked.name || verified.name || email,
            email: rechecked.email,
            role: 'facilitator',
            active: true,
            status: 'APPROVED',
            authMode: 'google_oauth'
          };
        }

        var config = ctLoadConfiguration_();
        var approvalMode =
          config && config.policy && config.policy.facilitatorApprovalMode === 'auto_approve'
            ? 'auto_approve'
            : 'manual_allowlist';
        var nowIso = ctNowIso_();
        var newUserId = 'FAC_' + ctShortUuid_().slice(0, 8);
        var displayName = verified.name || email;
        var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);
        var nextRow = Math.max(2, ctFindLastPopulatedRow_(facSheet, 1) + 1);
        var rowRange = facSheet.getRange(nextRow, 1, 1, 8);
        rowRange.setNumberFormat('@');

        if (approvalMode === 'auto_approve') {
          rowRange.setValues([[newUserId, displayName, email, 'facilitator', 'true', nowIso, nowIso, 'APPROVED']]);
          ctAppendAuditLog_(
            { userId: newUserId, email: email },
            'AUTH_AUTO_APPROVED',
            'Auth',
            newUserId,
            '',
            'Auto-approved Google facilitator registration',
            'SUCCESS'
          );
          return {
            userId: newUserId,
            name: displayName,
            email: email,
            role: 'facilitator',
            active: true,
            status: 'APPROVED',
            authMode: 'google_oauth'
          };
        }

        rowRange.setValues([[newUserId, displayName, email, 'facilitator', 'false', nowIso, nowIso, 'PENDING']]);
        ctAppendAuditLog_(
          { userId: newUserId, email: email },
          'AUTH_PENDING',
          'Auth',
          newUserId,
          '',
          'New Google sign-in queued as PENDING under manual_allowlist policy',
          'DENIED'
        );
        throw ctApiError_(
          'PENDING_APPROVAL',
          'Your Google account ("' + email + '") has been recorded and is awaiting Administrator approval.'
        );
      } finally {
        lock.releaseLock();
      }
    }
  } else if (req && typeof req.syncKey === 'string' && req.syncKey.trim()) {
    var rawActorEmail =
      (req && req.actorEmail) ||
      (req && req.payload && req.payload.actorEmail) ||
      '';
    var bridgeAuth = ctVerifySandboxBridgeCredentials_(req.syncKey, rawActorEmail);
    allowlistedSa = bridgeAuth.allowlistedSa;
    verifiedName = bridgeAuth.name;
    authMode = 'sandbox_sync_bridge';
  } else if (req && typeof req.intakeKey === 'string' && req.intakeKey.trim()) {
    var rawIntakeEmail =
      (req && req.actorEmail) ||
      (req && req.payload && req.payload.actorEmail) ||
      '';
    var rawIntakeName =
      (req && req.actorName) ||
      (req && req.payload && req.payload.actorName) ||
      '';
    return ctVerifyFacilitatorIntakeCredentials_(req.intakeKey, rawIntakeEmail, rawIntakeName);
  } else {
    throw ctApiError_('UNAUTHENTICATED', 'Missing Google ID token or Sandbox Sync Key. Please sign in.');
  }

  // Super Administrator spreadsheet auto-init (gracefully deferred for sheet create/connect/probe actions on standalone scripts)
  var actionName = String((req && req.action) || '').trim();
  var canDeferMissingSpreadsheet =
    actionName === 'createGoogleSheet' ||
    actionName === 'connectGoogleSheet' ||
    actionName === 'getSheetsConnection' ||
    actionName === 'getCurrentUser' ||
    actionName === 'ping' ||
    actionName === 'upsertSession' ||
    actionName === 'syncAll';
  var ss = null;
  try {
    ss = ctGetSpreadsheet_();
  } catch (ssErr) {
    if (!canDeferMissingSpreadsheet) {
      throw ctApiError_(
        'SPREADSHEET_NOT_CONNECTED',
        'No Google Spreadsheet is connected to this Apps Script project yet. Run setupForLocalSandbox() in Apps Script or create/connect a sheet first.'
      );
    }
  }

  var adminRow = null;
  if (ss) {
    if (!ss.getSheetByName(SHEET_NAMES.ADMIN_USERS)) {
      var initLock = ctAcquireScriptLockWithRetry_(20000, 3);
      try {
        ss = ctGetSpreadsheet_();
        if (!ss.getSheetByName(SHEET_NAMES.ADMIN_USERS)) {
          ctInitializeSpreadsheetObject_(ss, allowlistedSa.email);
        }
      } finally {
        initLock.releaseLock();
      }
    }
    if (typeof ctEnsureSheetsConnectionMetadata_ === 'function') {
      ctEnsureSheetsConnectionMetadata_(ss, allowlistedSa.email);
    }
    try {
      var adminRows = ctReadUserRowsFromSheet_(SHEET_NAMES.ADMIN_USERS);
      for (var a = 0; a < adminRows.length; a++) {
        if (adminRows[a].email === allowlistedSa.email) {
          adminRow = adminRows[a];
          break;
        }
      }
    } catch (readAdminErr) {
      adminRow = null;
    }
  }

  return {
    userId: (adminRow && adminRow.userId) || allowlistedSa.userId,
    name: (adminRow && adminRow.name) || verifiedName || allowlistedSa.name,
    email: allowlistedSa.email,
    role: 'super_admin',
    active: true,
    status: 'APPROVED',
    authMode: authMode
  };
}

function ctRequireRole_(actor, allowedRoles) {
  if (!actor || !actor.active) {
    throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  }
  for (var i = 0; i < allowedRoles.length; i++) {
    if (actor.role === allowedRoles[i]) {
      return;
    }
  }
  ctAppendAuditLog_(
    actor,
    'RBAC_DENIED',
    'Security',
    actor.email,
    '',
    'Required role: ' + allowedRoles.join('|') + ', actual: ' + actor.role,
    'DENIED'
  );
  throw ctApiError_('FORBIDDEN', 'You do not have permission to perform this operation.');
}

function ctHandleGetCurrentUser_(actor) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  return actor;
}

// ============================================================================
// Module: Calculations.gs
// ============================================================================

/**
 * Calculations.gs — Pure server-side calculations for CSAT, ITP, Teacher NPS, Duration, and Session IDs.
 * Written as pure JavaScript so both Google Apps Script V8 and Node verification suites execute identical logic.
 */

var CT_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function ctRound1_(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function ctRound2_(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ctParseCountForCalc_(raw) {
  if (raw === null || raw === undefined) return 0;
  var trimmed = String(raw).trim();
  if (trimmed === '' || !/^\\d+$/.test(trimmed)) return 0;
  return parseInt(trimmed, 10);
}

function ctIsValidWholeNumberString_(raw, allowEmpty) {
  if (raw === null || raw === undefined) return !!allowEmpty;
  var trimmed = String(raw).trim();
  if (trimmed === '') return !!allowEmpty;
  return /^\\d+$/.test(trimmed);
}

function ctToNumericCounts_(counts) {
  var c = counts || {};
  return {
    score5: ctParseCountForCalc_(c.score5),
    score4: ctParseCountForCalc_(c.score4),
    score3: ctParseCountForCalc_(c.score3),
    score2: ctParseCountForCalc_(c.score2),
    score1: ctParseCountForCalc_(c.score1)
  };
}

function ctCalculateScaleMetrics_(counts) {
  var total = counts.score5 + counts.score4 + counts.score3 + counts.score2 + counts.score1;
  var weighted =
    5 * counts.score5 +
    4 * counts.score4 +
    3 * counts.score3 +
    2 * counts.score2 +
    1 * counts.score1;

  if (total === 0) {
    return { total: 0, weighted: 0, average: null };
  }
  return {
    total: total,
    weighted: weighted,
    average: ctRound2_(weighted / total)
  };
}

function ctCalculateScaleSentiment_(counts) {
  var c = counts || { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 };
  var scale = ctCalculateScaleMetrics_(c);
  var positiveCount = Number(c.score4 || 0) + Number(c.score5 || 0);
  var neutralCount = Number(c.score3 || 0);
  var negativeCount = Number(c.score1 || 0) + Number(c.score2 || 0);
  if (scale.total === 0) {
    return {
      total: 0,
      weighted: 0,
      exactAverage: null,
      average: null,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      positivePct: null,
      neutralPct: null,
      negativePct: null
    };
  }
  return {
    total: scale.total,
    weighted: scale.weighted,
    exactAverage: scale.weighted / scale.total,
    average: scale.average,
    positiveCount: positiveCount,
    neutralCount: neutralCount,
    negativeCount: negativeCount,
    positivePct: (positiveCount / scale.total) * 100,
    neutralPct: (neutralCount / scale.total) * 100,
    negativePct: (negativeCount / scale.total) * 100
  };
}

function ctResolveTeacherNps_(group, exactScoreRaw) {
  var trimmed = exactScoreRaw !== null && exactScoreRaw !== undefined ? String(exactScoreRaw).trim() : '';
  if (trimmed !== '' && /^(10|[0-9])$/.test(trimmed)) {
    var score = parseInt(trimmed, 10);
    if (score >= 9) return { exactScore: score, classification: 'Promoter', nps: 100 };
    if (score >= 7) return { exactScore: score, classification: 'Passive', nps: 0 };
    return { exactScore: score, classification: 'Detractor', nps: -100 };
  }

  if (group === 'promoter') return { exactScore: null, classification: 'Promoter', nps: 100 };
  if (group === 'passive') return { exactScore: null, classification: 'Passive', nps: 0 };
  if (group === 'detractor') return { exactScore: null, classification: 'Detractor', nps: -100 };

  return { exactScore: null, classification: null, nps: null };
}

function ctCalculateSessionMetrics_(classes, teacherNpsGroup, teacherExactScore) {
  var rows = classes || [];
  var classBreakdown = [];
  var totalStudentsPresent = 0;
  var totalQuestionAResponses = 0;
  var totalQuestionAWeighted = 0;
  var totalQuestionBResponses = 0;
  var totalQuestionBWeighted = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var present = ctParseCountForCalc_(row.studentsPresent);
    var qACounts = ctToNumericCounts_(row.questionA);
    var qBCounts = ctToNumericCounts_(row.questionB);
    var qA = ctCalculateScaleMetrics_(qACounts);
    var qB = ctCalculateScaleMetrics_(qBCounts);

    totalStudentsPresent += present;
    totalQuestionAResponses += qA.total;
    totalQuestionAWeighted += qA.weighted;
    totalQuestionBResponses += qB.total;
    totalQuestionBWeighted += qB.weighted;

    classBreakdown.push({
      rowId: row.rowId || ('row-' + (i + 1)),
      grade: String(row.grade || ''),
      section: String(row.section || ''),
      studentsPresent: present,
      questionACounts: qACounts,
      questionBCounts: qBCounts,
      questionATotal: qA.total,
      questionAWeighted: qA.weighted,
      csatAverage: qA.average,
      questionACoveragePct: present > 0 ? ctRound2_((qA.total / present) * 100) : null,
      questionBTotal: qB.total,
      questionBWeighted: qB.weighted,
      itpAverage: qB.average,
      questionBCoveragePct: present > 0 ? ctRound2_((qB.total / present) * 100) : null
    });
  }

  // Pooled combined-class average: sum(weighted scores) / sum(total responses)
  var overallCsat =
    totalQuestionAResponses > 0 ? ctRound2_(totalQuestionAWeighted / totalQuestionAResponses) : null;
  var overallItp =
    totalQuestionBResponses > 0 ? ctRound2_(totalQuestionBWeighted / totalQuestionBResponses) : null;

  var teacher = ctResolveTeacherNps_(teacherNpsGroup, teacherExactScore);

  return {
    totalClasses: classBreakdown.length,
    totalStudentsPresent: totalStudentsPresent,
    totalQuestionAResponses: totalQuestionAResponses,
    totalQuestionAWeighted: totalQuestionAWeighted,
    overallCsat: overallCsat,
    overallQuestionACoveragePct:
      totalStudentsPresent > 0 ? ctRound2_((totalQuestionAResponses / totalStudentsPresent) * 100) : null,
    totalQuestionBResponses: totalQuestionBResponses,
    totalQuestionBWeighted: totalQuestionBWeighted,
    overallItp: overallItp,
    overallQuestionBCoveragePct:
      totalStudentsPresent > 0 ? ctRound2_((totalQuestionBResponses / totalStudentsPresent) * 100) : null,
    teacherScoreExact: teacher.exactScore,
    teacherClassification: teacher.classification,
    teacherNps: teacher.nps,
    classBreakdown: classBreakdown
  };
}

function ctIsValidISODate_(dateStr) {
  if (typeof dateStr !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr)) return false;
  var parts = dateStr.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  var dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function ctIsValidTime24_(timeStr) {
  if (typeof timeStr !== 'string' || !/^\\d{2}:\\d{2}$/.test(timeStr)) return false;
  var parts = timeStr.split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function ctGetTodayKolkataISO_() {
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function ctFormatISODateToDDMMYYYY_(dateStr) {
  if (!ctIsValidISODate_(dateStr)) return '';
  var p = dateStr.split('-');
  return p[2] + '-' + p[1] + '-' + p[0];
}

function ctFormatISODateToYYYYMMDD_(dateStr) {
  if (!ctIsValidISODate_(dateStr)) return '';
  return dateStr.replace(/-/g, '');
}

function ctGetMonthNameFromISO_(dateStr) {
  if (!ctIsValidISODate_(dateStr)) return '';
  var monthIdx = parseInt(dateStr.split('-')[1], 10) - 1;
  return CT_MONTH_NAMES[monthIdx] || '';
}

function ctCalculateSessionDurationMinutes_(startDate, startTime, endDate, endTime) {
  if (!ctIsValidISODate_(startDate) || !ctIsValidISODate_(endDate)) return null;
  if (!ctIsValidTime24_(startTime) || !ctIsValidTime24_(endTime)) return null;
  // Asia/Kolkata has fixed +05:30 offset with no daylight saving transitions
  var startMs = Date.parse(startDate + 'T' + startTime + ':00+05:30');
  var endMs = Date.parse(endDate + 'T' + endTime + ':00+05:30');
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return null;
  return Math.round((endMs - startMs) / 60000);
}

function ctFormatDurationHuman_(totalMinutes) {
  if (totalMinutes === null || !isFinite(totalMinutes) || totalMinutes <= 0) return '—';
  var mins = Math.round(totalMinutes);
  var days = Math.floor(mins / 1440);
  var remAfterDays = mins % 1440;
  var hours = Math.floor(remAfterDays / 60);
  var remMins = remAfterDays % 60;

  var parts = [];
  if (days > 0) parts.push(days + ' ' + (days === 1 ? 'day' : 'days'));
  if (hours > 0) parts.push(hours + ' ' + (hours === 1 ? 'hr' : 'hrs'));
  if (remMins > 0 || parts.length === 0) parts.push(remMins + ' ' + (remMins === 1 ? 'min' : 'mins'));
  return parts.join(' ');
}

function ctBuildSessionIdPrefix_(startDate, udiseCode, sessionMode, classes) {
  var yyyymmdd = ctFormatISODateToYYYYMMDD_(startDate);
  if (!yyyymmdd) return null;
  var cleanUdise = String(udiseCode || '').trim();
  if (!/^\\d{11}$/.test(cleanUdise)) return null;

  var rows = classes || [];
  var gradeToken = '';
  var classToken = '';

  if (sessionMode === 'single') {
    var first = rows[0];
    if (!first || !String(first.grade || '').trim() || !String(first.section || '').trim()) return null;
    var g = String(first.grade).trim();
    gradeToken = g.length < 2 ? '0' + g : g;
    var secClean = String(first.section).trim().toUpperCase();
    classToken = secClean === 'NO SECTION' ? 'NS' : secClean.replace(/[^A-Z0-9]/g, '');
    if (!classToken) return null;
  } else {
    if (rows.length < 2) return null;
    for (var i = 0; i < rows.length; i++) {
      if (!String(rows[i].grade || '').trim() || !String(rows[i].section || '').trim()) return null;
    }
    gradeToken = 'CMB';
    classToken = (rows.length < 10 ? '0' : '') + String(rows.length) + 'C';
  }

  return 'CT_IN_' + yyyymmdd + '_' + cleanUdise + '_' + gradeToken + '_' + classToken;
}

function ctFormatSessionIdWithSequence_(prefix, sequence) {
  var seqStr = String(sequence);
  while (seqStr.length < 3) seqStr = '0' + seqStr;
  return prefix + '_' + seqStr;
}

function ctResolveConfiguredVideoId_(tour, language) {
  if (!tour) return { videoId: '', isConfigured: false };
  var map = tour.videoIdByLanguage || {};
  var exact = String(map[language] || '').trim();
  if (exact) return { videoId: exact, isConfigured: true };
  return { videoId: 'UNCONFIGURED_VIDEO_ID', isConfigured: false };
}

// ============================================================================
// Module: Validation.gs
// ============================================================================

/**
 * Validation.gs — Authoritative server-side form & business rule validation.
 */

function ctArrayIncludes_(arr, item) {
  if (!arr || !arr.length) return false;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === item) return true;
  }
  return false;
}

function ctValidateSessionForm_(values, config) {
  var errors = [];
  var warnings = [];
  var todayKolkata = ctGetTodayKolkataISO_();

  if (!values || typeof values !== 'object') {
    return {
      valid: false,
      errors: [{ code: 'PAYLOAD_INVALID', field: 'form', section: 1, severity: 'error', message: 'Invalid session payload.' }],
      warnings: []
    };
  }

  // Section 1
  if (!String(values.facilitatorName || '').trim()) {
    errors.push({ code: 'FACILITATOR_NAME_REQUIRED', field: 'facilitatorName', section: 1, severity: 'error', message: 'Enter your facilitator name.' });
  }
  if (!String(values.facilitatorEmail || '').trim()) {
    errors.push({ code: 'FACILITATOR_EMAIL_REQUIRED', field: 'facilitatorEmail', section: 1, severity: 'error', message: 'Signed-in facilitator email is required.' });
  }

  // Section 2
  var selectedTour = null;
  for (var tIdx = 0; tIdx < (config.tours || []).length; tIdx++) {
    var t = config.tours[tIdx];
    if (t.active && t.tourId === values.tourId) {
      selectedTour = t;
      break;
    }
  }
  if (!selectedTour) {
    errors.push({ code: 'TOUR_REQUIRED', field: 'tourId', section: 2, severity: 'error', message: 'Choose which Career Tour video you showed.' });
  }

  if (!values.language || !ctArrayIncludes_(config.languageOptions, values.language)) {
    errors.push({ code: 'LANGUAGE_REQUIRED', field: 'language', section: 2, severity: 'error', message: 'Select the session language.' });
  }

  var startDateValid = ctIsValidISODate_(values.startDate);
  var endDateValid = ctIsValidISODate_(values.endDate);

  if (!startDateValid) {
    errors.push({ code: 'START_DATE_INVALID', field: 'startDate', section: 2, severity: 'error', message: 'Enter a valid session start date.' });
  } else if (values.startDate > todayKolkata) {
    errors.push({ code: 'START_DATE_FUTURE', field: 'startDate', section: 2, severity: 'error', message: 'Session start date cannot be in the future.' });
  }

  if (!endDateValid) {
    errors.push({ code: 'END_DATE_INVALID', field: 'endDate', section: 2, severity: 'error', message: 'Enter a valid session end date.' });
  } else if (values.endDate > todayKolkata) {
    errors.push({ code: 'END_DATE_FUTURE', field: 'endDate', section: 2, severity: 'error', message: 'Session end date cannot be in the future.' });
  }

  if (startDateValid && endDateValid && values.endDate < values.startDate) {
    errors.push({ code: 'END_DATE_BEFORE_START', field: 'endDate', section: 2, severity: 'error', message: 'Session end date cannot be earlier than the start date.' });
  }

  var startTimeValid = ctIsValidTime24_(values.startTime);
  var endTimeValid = ctIsValidTime24_(values.endTime);

  if (!startTimeValid) {
    errors.push({ code: 'START_TIME_REQUIRED', field: 'startTime', section: 2, severity: 'error', message: 'Choose the session start time.' });
  }
  if (!endTimeValid) {
    errors.push({ code: 'END_TIME_REQUIRED', field: 'endTime', section: 2, severity: 'error', message: 'Choose the session end time.' });
  }

  if (startDateValid && endDateValid && startTimeValid && endTimeValid && values.endDate >= values.startDate) {
    var dur = ctCalculateSessionDurationMinutes_(values.startDate, values.startTime, values.endDate, values.endTime);
    if (dur === null) {
      errors.push({
        code: 'END_BEFORE_START_TIME',
        field: 'endTime',
        section: 2,
        severity: 'error',
        message: 'Session end date and time must be later than the start date and time. If the session ran past midnight, set the end date to the next day.'
      });
    } else if (dur > 480) {
      warnings.push({
        code: 'LONG_SESSION_DURATION',
        field: 'endTime',
        section: 2,
        severity: 'warning',
        message: 'Session duration is ' + Math.round(dur / 60) + ' hours (' + dur + ' mins). Confirm start/end dates and AM/PM are correct.'
      });
    }
  }

  // Section 3
  if (!String(values.schoolName || '').trim()) {
    errors.push({ code: 'SCHOOL_NAME_REQUIRED', field: 'schoolName', section: 3, severity: 'error', message: 'Enter the school name.' });
  }

  var udise = String(values.udiseCode || '').trim();
  if (!/^\\d{11}$/.test(udise)) {
    errors.push({ code: 'UDISE_INVALID', field: 'udiseCode', section: 3, severity: 'error', message: 'School code (UDISE) must be exactly 11 numeric digits.' });
  }

  if (!values.schoolType || !ctArrayIncludes_(config.schoolTypes, values.schoolType)) {
    errors.push({ code: 'SCHOOL_TYPE_REQUIRED', field: 'schoolType', section: 3, severity: 'error', message: 'Select the school type.' });
  }

  if (!values.district || !ctArrayIncludes_(config.allowedDistricts, values.district)) {
    errors.push({
      code: 'DISTRICT_INVALID',
      field: 'district',
      section: 3,
      severity: 'error',
      message: 'District must be one of: ' + (config.allowedDistricts || []).join(', ') + '.'
    });
  }

  var pin = String(values.pinCode || '').trim();
  if (!/^\\d{6}$/.test(pin)) {
    errors.push({ code: 'PIN_INVALID', field: 'pinCode', section: 3, severity: 'error', message: 'PIN code must be exactly 6 numeric digits.' });
  }

  // Section 4 & 5
  var classes = values.classes || [];
  if (values.sessionMode === 'single') {
    if (classes.length !== 1) {
      errors.push({ code: 'SINGLE_CLASS_ROW_COUNT', field: 'classes', section: 4, severity: 'error', message: 'Single class mode must contain exactly one class row.' });
    }
  } else if (values.sessionMode === 'combined') {
    if (classes.length < 2 || classes.length > 10) {
      errors.push({ code: 'COMBINED_CLASS_ROW_COUNT', field: 'classes', section: 4, severity: 'error', message: 'Combined class sessions must include between 2 and 10 class/grade rows.' });
    }
  } else {
    errors.push({ code: 'SESSION_MODE_INVALID', field: 'sessionMode', section: 4, severity: 'error', message: 'Invalid session mode.' });
  }

  var seenClassKeys = {};
  var scoreKeys = ['score5', 'score4', 'score3', 'score2', 'score1'];

  for (var i = 0; i < classes.length; i++) {
    var row = classes[i];
    var label = 'Class ' + (i + 1);
    if (!row.grade || !ctArrayIncludes_(config.gradeOptions, String(row.grade))) {
      errors.push({ code: 'GRADE_REQUIRED', field: 'classes.' + i + '.grade', section: 4, severity: 'error', message: label + ': Select the class (grade).' });
    }
    if (!row.section || !ctArrayIncludes_(config.sectionOptions, String(row.section))) {
      errors.push({ code: 'SECTION_REQUIRED', field: 'classes.' + i + '.section', section: 4, severity: 'error', message: label + ': Select the section (or choose "No section").' });
    }
    if (row.grade && row.section) {
      var cKey = row.grade + '::' + row.section;
      if (seenClassKeys[cKey]) {
        errors.push({ code: 'DUPLICATE_CLASS_ROW', field: 'classes.' + i + '.section', section: 4, severity: 'error', message: 'Duplicate class entry: Grade ' + row.grade + ' (' + row.section + ') appears more than once.' });
      }
      seenClassKeys[cKey] = true;
    }

    var rawStudents = String(row.studentsPresent || '').trim();
    var studentsValidInt = /^\\d+$/.test(rawStudents);
    var studentsPresent = studentsValidInt ? parseInt(rawStudents, 10) : 0;
    if (!studentsValidInt || studentsPresent <= 0) {
      errors.push({ code: 'STUDENTS_PRESENT_INVALID', field: 'classes.' + i + '.studentsPresent', section: 4, severity: 'error', message: label + ': Number of students present must be a whole number greater than 0.' });
    }

    var qaFormatError = false;
    var qbFormatError = false;
    for (var kIdx = 0; kIdx < scoreKeys.length; kIdx++) {
      var sk = scoreKeys[kIdx];
      if (!ctIsValidWholeNumberString_(row.questionA && row.questionA[sk], true)) {
        qaFormatError = true;
        errors.push({ code: 'SCORE_COUNT_INVALID', field: 'classes.' + i + '.questionA.' + sk, section: 5, severity: 'error', message: label + ' (Question A): Enter whole numbers (0 or greater) only — no negative or decimal counts.' });
        break;
      }
    }
    for (var kIdx2 = 0; kIdx2 < scoreKeys.length; kIdx2++) {
      var sk2 = scoreKeys[kIdx2];
      if (!ctIsValidWholeNumberString_(row.questionB && row.questionB[sk2], true)) {
        qbFormatError = true;
        errors.push({ code: 'SCORE_COUNT_INVALID', field: 'classes.' + i + '.questionB.' + sk2, section: 5, severity: 'error', message: label + ' (Question B): Enter whole numbers (0 or greater) only — no negative or decimal counts.' });
        break;
      }
    }

    if (!qaFormatError && !qbFormatError) {
      var qaCalc = ctCalculateScaleMetrics_(ctToNumericCounts_(row.questionA));
      var qbCalc = ctCalculateScaleMetrics_(ctToNumericCounts_(row.questionB));

      if (studentsPresent > 0 && qaCalc.total > studentsPresent) {
        errors.push({ code: 'QA_EXCEEDS_PRESENT', field: 'classes.' + i + '.questionA', section: 5, severity: 'error', message: label + ': Question A total (' + qaCalc.total + ') cannot exceed students present (' + studentsPresent + ').' });
      }
      if (studentsPresent > 0 && qbCalc.total > studentsPresent) {
        errors.push({ code: 'QB_EXCEEDS_PRESENT', field: 'classes.' + i + '.questionB', section: 5, severity: 'error', message: label + ': Question B total (' + qbCalc.total + ') cannot exceed students present (' + studentsPresent + ').' });
      }
      if (qaCalc.total !== qbCalc.total) {
        warnings.push({ code: 'QA_QB_TOTAL_MISMATCH', field: 'classes.' + i + '.questionB', section: 5, severity: 'warning', message: label + ': Question A responses (' + qaCalc.total + ') differ from Question B responses (' + qbCalc.total + ').' });
      }
      if (studentsPresent > 0) {
        var qaCov = (qaCalc.total / studentsPresent) * 100;
        var qbCov = (qbCalc.total / studentsPresent) * 100;
        if (qaCalc.total === 0 || qbCalc.total === 0) {
          warnings.push({ code: 'ZERO_STUDENT_RESPONSES', field: 'classes.' + i + '.questionA', section: 5, severity: 'warning', message: label + ': At least one question has 0 student responses recorded.' });
        } else if (qaCov < 75 || qbCov < 75) {
          warnings.push({ code: 'LOW_RESPONSE_COVERAGE', field: 'classes.' + i + '.questionA', section: 5, severity: 'warning', message: label + ': Response coverage is below 75%.' });
        }
      }
    }
  }

  // Section 6
  var trimmedExact = String(values.teacherExactScore || '').trim();
  if (trimmedExact !== '') {
    if (!/^(10|[0-9])$/.test(trimmedExact)) {
      errors.push({ code: 'TEACHER_EXACT_SCORE_INVALID', field: 'teacherExactScore', section: 6, severity: 'error', message: "Teacher's exact score must be a whole number from 0 to 10." });
    } else if (values.teacherNpsGroup) {
      var tScore = parseInt(trimmedExact, 10);
      var expectedGroup = tScore >= 9 ? 'promoter' : tScore >= 7 ? 'passive' : 'detractor';
      if (expectedGroup !== values.teacherNpsGroup) {
        errors.push({ code: 'TEACHER_SCORE_GROUP_MISMATCH', field: 'teacherExactScore', section: 6, severity: 'error', message: 'Exact score ' + tScore + ' belongs to ' + expectedGroup + ', which does not match the selected group.' });
      }
    }
  } else if (!values.teacherNpsGroup) {
    errors.push({ code: 'TEACHER_NPS_REQUIRED', field: 'teacherNpsGroup', section: 6, severity: 'error', message: "Select the teacher's NPS recommendation score or group." });
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

// ============================================================================
// Module: Schools.gs
// ============================================================================

/**
 * Schools.gs — School master lookup, search, and non-destructive UDISE conflict guard.
 */

var SCHOOL_COL_COUNT = 10;

function ctResolveSchoolSheetLayout_(sheet) {
  var lastCol = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 0;
  var probeCols = lastCol >= 1 ? Math.max(SCHOOL_COL_COUNT, lastCol) : SCHOOL_COL_COUNT;
  var hasBlock = false;
  if (sheet.getLastRow() >= 1) {
    var hdrs = sheet.getRange(1, 1, 1, probeCols).getValues()[0];
    for (var i = 0; i < hdrs.length; i++) {
      if (String(hdrs[i] || '').trim().toLowerCase() === 'block') {
        hasBlock = true;
        break;
      }
    }
  }
  return {
    hasBlock: hasBlock,
    colCount: hasBlock ? 11 : SCHOOL_COL_COUNT
  };
}

function ctRowToSchoolRecord_(r, optHasBlock) {
  var hasBlock =
    optHasBlock !== undefined
      ? Boolean(optHasBlock)
      : r.length >= 11 ||
        ['true', 'false'].indexOf(String(r[8] || '').trim().toLowerCase()) !== -1;
  var off = hasBlock ? 1 : 0;
  var activeRaw = r[7 + off];
  var active =
    activeRaw === true ||
    String(activeRaw).trim().toLowerCase() === 'true' ||
    String(activeRaw).trim() === '1';

  return {
    schoolRecordId: String(r[0] || ''),
    schoolName: String(r[1] || ''),
    udiseCode: String(r[2] || '').trim(),
    schoolType: String(r[3] || ''),
    state: String(r[4] || ''),
    district: String(r[5] || ''),
    pinCode: String(r[6 + off] || '').trim(),
    active: active,
    createdAt: String(r[8 + off] || ''),
    updatedAt: String(r[9 + off] || '')
  };
}

function ctSchoolRecordToSheetRow_(rec, optHasBlock) {
  var activeStr =
    typeof rec.active === 'string'
      ? rec.active
      : rec.active === false
      ? 'false'
      : 'true';
  var row = [
    rec.schoolRecordId,
    rec.schoolName,
    rec.udiseCode,
    rec.schoolType,
    rec.state,
    rec.district
  ];
  if (optHasBlock) {
    row.push('');
  }
  row.push(rec.pinCode, activeStr, rec.createdAt, rec.updatedAt);
  return row;
}

function ctFindSchoolByUdise_(udiseCode) {
  var clean = String(udiseCode || '').trim();
  if (!clean) return null;
  var sheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var layout = ctResolveSchoolSheetLayout_(sheet);
  var rows = sheet.getRange(2, 1, lastRow - 1, layout.colCount).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() === clean) {
      return ctRowToSchoolRecord_(rows[i], layout.hasBlock);
    }
  }
  return null;
}

/**
 * Inserts a new School master record if its UDISE does not exist yet.
 * If the UDISE already exists under a DIFFERENT school name, NEVER silently overwrites the existing
 * school master entry — instead flags a warning for administrator review.
 */
function ctUpsertSchoolWithoutOverwrite_(values, nowIso) {
  var existing = ctFindSchoolByUdise_(values.udiseCode);
  if (existing) {
    if (existing.schoolName.toLowerCase() !== String(values.schoolName || '').trim().toLowerCase()) {
      return (
        'UDISE ' +
        values.udiseCode +
        ' is already registered to "' +
        existing.schoolName +
        '". School master record was preserved; admin review recommended.'
      );
    }
    return undefined;
  }

  var sheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var layout = ctResolveSchoolSheetLayout_(sheet);
  var schoolRecordId = 'SCH_' + ctShortUuid_().slice(0, 8);
  var newRow = ctSchoolRecordToSheetRow_(
    {
      schoolRecordId: schoolRecordId,
      schoolName: String(values.schoolName || '').trim(),
      udiseCode: String(values.udiseCode || '').trim(),
      schoolType: String(values.schoolType || ''),
      state: String(values.state || 'Tamil Nadu'),
      district: String(values.district || ''),
      pinCode: String(values.pinCode || '').trim(),
      active: 'true',
      createdAt: nowIso,
      updatedAt: nowIso
    },
    layout.hasBlock
  );

  var nextRow = Math.max(2, ctFindLastPopulatedRow_(sheet, 1) + 1);
  var range = sheet.getRange(nextRow, 1, 1, newRow.length);
  range.setNumberFormat('@'); // Preserves leading zeroes on 11-digit UDISE and 6-digit PIN
  range.setValues([newRow]);
  return undefined;
}

function ctHandleGetSchoolByUdise_(actor, payload) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var udise = String((payload && payload.udiseCode) || '').trim();
  return ctFindSchoolByUdise_(udise);
}

function ctHandleSearchSchools_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var q = String((payload && payload.query) || '').trim().toLowerCase();
  var includeInactive = Boolean(payload && payload.includeInactive);
  var sheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var layout = ctResolveSchoolSheetLayout_(sheet);
  var rows = sheet.getRange(2, 1, lastRow - 1, layout.colCount).getValues();
  var matches = [];
  for (var i = 0; i < rows.length; i++) {
    var rec = ctRowToSchoolRecord_(rows[i], layout.hasBlock);
    if (!includeInactive && !rec.active) continue;
    if (
      !q ||
      rec.schoolName.toLowerCase().indexOf(q) !== -1 ||
      rec.udiseCode.indexOf(q) !== -1 ||
      rec.district.toLowerCase().indexOf(q) !== -1 ||
      rec.pinCode.indexOf(q) !== -1
    ) {
      matches.push(rec);
      if (matches.length >= 200) break;
    }
  }
  return matches;
}

function ctHandleUpdateSchool_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var input = (payload && payload.school) || {};
  var schoolRecordId = String(input.schoolRecordId || '').trim();
  var schoolName = String(input.schoolName || '').trim();
  var udiseCode = String(input.udiseCode || '').trim();
  var schoolType = String(input.schoolType || '').trim();
  var district = String(input.district || '').trim();
  var pinCode = String(input.pinCode || '').trim();
  var active = input.active !== false;

  if (!schoolRecordId) throw ctApiError_('INVALID_ID', 'schoolRecordId is required.');
  if (!schoolName) throw ctApiError_('VALIDATION_FAILED', 'School name is required.');
  if (!/^\\d{11}$/.test(udiseCode)) {
    throw ctApiError_('VALIDATION_FAILED', 'UDISE code must be exactly 11 digits.');
  }
  if (!/^\\d{6}$/.test(pinCode)) {
    throw ctApiError_('VALIDATION_FAILED', 'PIN code must be exactly 6 digits.');
  }
  if (!schoolType) {
    throw ctApiError_('VALIDATION_FAILED', 'School type is required.');
  }

  var config = ctLoadConfiguration_();
  if (!ctArrayIncludes_(config.allowedDistricts || [], district)) {
    throw ctApiError_('VALIDATION_FAILED', 'District must be one of the approved programme districts.');
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var sheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw ctApiError_('NOT_FOUND', 'School record not found.');
    }

    var layout = ctResolveSchoolSheetLayout_(sheet);
    var rows = sheet.getRange(2, 1, lastRow - 1, layout.colCount).getValues();
    var matchedIdx = -1;
    var duplicateUdiseOwner = '';
    for (var i = 0; i < rows.length; i++) {
      var rowId = String(rows[i][0] || '').trim();
      var rowUdise = String(rows[i][2] || '').trim();
      if (rowId === schoolRecordId) {
        matchedIdx = i;
      } else if (rowUdise === udiseCode) {
        duplicateUdiseOwner = String(rows[i][1] || rowUdise);
      }
    }

    if (matchedIdx === -1) {
      throw ctApiError_('NOT_FOUND', 'School record not found.');
    }
    if (duplicateUdiseOwner) {
      throw ctApiError_(
        'DUPLICATE_UDISE',
        'UDISE ' + udiseCode + ' is already assigned to "' + duplicateUdiseOwner + '".'
      );
    }

    var prevRec = ctRowToSchoolRecord_(rows[matchedIdx], layout.hasBlock);
    var nowIso = ctNowIso_();
    var resolvedState = String(input.state || prevRec.state || config.stateName || 'Tamil Nadu').trim();
    var nextRow = ctSchoolRecordToSheetRow_(
      {
        schoolRecordId: prevRec.schoolRecordId,
        schoolName: schoolName,
        udiseCode: udiseCode,
        schoolType: schoolType,
        state: resolvedState,
        district: district,
        pinCode: pinCode,
        active: active ? 'true' : 'false',
        createdAt: prevRec.createdAt || nowIso,
        updatedAt: nowIso
      },
      layout.hasBlock
    );

    var range = sheet.getRange(matchedIdx + 2, 1, 1, nextRow.length);
    range.setNumberFormat('@');
    range.setValues([nextRow]);

    var updatedRec = ctRowToSchoolRecord_(nextRow, layout.hasBlock);
    ctAppendAuditLog_(
      actor,
      'UPDATE_SCHOOL',
      'School',
      prevRec.schoolRecordId,
      prevRec.udiseCode + ' (' + prevRec.schoolName + ', active=' + prevRec.active + ')',
      updatedRec.udiseCode + ' (' + updatedRec.schoolName + ', active=' + updatedRec.active + ')',
      'SUCCESS'
    );
    return updatedRec;
  } finally {
    lock.releaseLock();
  }
}

function ctHandleDeleteSchool_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var schoolRecordId = String((payload && (payload.schoolRecordId || payload.udiseCode)) || '').trim();
  if (!schoolRecordId) throw ctApiError_('INVALID_ID', 'schoolRecordId is required.');

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var sheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw ctApiError_('NOT_FOUND', 'School record not found.');
    }

    var layout = ctResolveSchoolSheetLayout_(sheet);
    var rows = sheet.getRange(2, 1, lastRow - 1, layout.colCount).getValues();
    var matchedIdx = -1;
    for (var i = 0; i < rows.length; i++) {
      var rowId = String(rows[i][0] || '').trim();
      var rowUdise = String(rows[i][2] || '').trim();
      if (rowId === schoolRecordId || rowUdise === schoolRecordId) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx === -1) {
      throw ctApiError_('NOT_FOUND', 'School record not found.');
    }

    var prevRec = ctRowToSchoolRecord_(rows[matchedIdx], layout.hasBlock);
    sheet.deleteRow(matchedIdx + 2);

    ctAppendAuditLog_(
      actor,
      'DELETE_SCHOOL',
      'School',
      prevRec.schoolRecordId || prevRec.udiseCode,
      prevRec.udiseCode + ' (' + prevRec.schoolName + ')',
      'Removed from Schools directory',
      'SUCCESS'
    );
    return { deleted: true, udiseCode: prevRec.udiseCode };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// Module: SetupDatabase.gs
// ============================================================================

/**
 * SetupDatabase.gs — Idempotent Google Sheets schema initializer & formatter.
 * Run \`initializeDatabase()\` (or \`setupForLocalSandbox()\` for Apps Script Sync Bridge) once from the
 * Apps Script editor. Safe to re-run — never deletes existing data rows.
 */

var CT_PRESET_SANDBOX_SYNC_KEY = '__CT_PRESET_SYNC_KEY__';
var CT_PRESET_FACILITATOR_INTAKE_KEY = '__CT_PRESET_INTAKE_KEY__';

var CT_SCHEMA_DEFINITIONS = [
  {
    name: 'Sessions',
    headers: [
      'session_record_id',
      'session_id',
      'client_submission_key',
      'facilitator_name',
      'facilitator_email',
      'facilitator_user_id',
      'tour_id',
      'tour_name',
      'video_id',
      'language',
      'start_date',
      'end_date',
      'start_time',
      'end_time',
      'duration_minutes',
      'duration_formatted',
      'reporting_month',
      'submission_timestamp',
      'submission_date_formatted',
      'school_name',
      'udise_code',
      'school_type',
      'state',
      'district',
      'pin_code',
      'session_type',
      'total_classes',
      'total_students_present',
      'total_qa_responses',
      'total_qb_responses',
      'overall_csat',
      'overall_itp',
      'teacher_score',
      'teacher_classification',
      'teacher_nps',
      'submission_status',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
      'archived'
    ],
    textColumns: [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 25, 36, 37, 38, 41]
  },
  {
    name: 'Session Details',
    headers: [
      'detail_record_id',
      'session_record_id',
      'session_id',
      'grade',
      'section',
      'students_present',
      'qa_score_5',
      'qa_score_4',
      'qa_score_3',
      'qa_score_2',
      'qa_score_1',
      'qa_total',
      'qa_weighted_score',
      'csat',
      'qb_score_5',
      'qb_score_4',
      'qb_score_3',
      'qb_score_2',
      'qb_score_1',
      'qb_total',
      'qb_weighted_score',
      'itp',
      'created_at',
      'updated_at'
    ],
    textColumns: [1, 2, 3, 4, 5]
  },
  {
    name: 'Facilitators',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8]
  },
  {
    name: 'Schools',
    headers: [
      'school_record_id',
      'school_name',
      'udise_code',
      'school_type',
      'state',
      'district',
      'pin_code',
      'active',
      'created_at',
      'updated_at'
    ],
    textColumns: [1, 3, 7, 8]
  },
  {
    name: 'Configuration',
    headers: ['config_key', 'config_value_json', 'updated_at', 'updated_by'],
    textColumns: [1, 2, 3, 4]
  },
  {
    name: 'Admin Users',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8]
  },
  {
    name: 'Audit Log',
    headers: [
      'audit_id',
      'timestamp',
      'user_id',
      'user_email',
      'action',
      'entity_type',
      'entity_id',
      'previous_summary',
      'new_summary',
      'result'
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  },
  {
    name: 'Sync Log',
    headers: [
      'sync_id',
      'timestamp',
      'client_submission_key',
      'session_record_id',
      'session_id',
      'actor_email',
      'operation',
      'attempt',
      'status',
      'error_message'
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 9, 10]
  }
];

var CT_COLUMN_WIDTHS_BY_HEADER = {
  session_record_id: 260,
  session_id: 300,
  client_submission_key: 260,
  facilitator_name: 175,
  facilitator_email: 225,
  facilitator_user_id: 165,
  tour_id: 110,
  tour_name: 260,
  video_id: 195,
  language: 120,
  start_date: 115,
  end_date: 115,
  start_time: 105,
  end_time: 105,
  duration_minutes: 135,
  duration_formatted: 135,
  reporting_month: 135,
  submission_timestamp: 190,
  submission_date_formatted: 175,
  school_name: 250,
  udise_code: 140,
  school_type: 205,
  state: 115,
  district: 135,
  pin_code: 115,
  session_type: 120,
  total_classes: 115,
  total_students_present: 155,
  total_qa_responses: 145,
  total_qb_responses: 145,
  overall_csat: 115,
  overall_itp: 115,
  teacher_score: 120,
  teacher_classification: 165,
  teacher_nps: 115,
  submission_status: 145,
  created_at: 185,
  updated_at: 185,
  created_by: 215,
  updated_by: 215,
  archived: 100,
  detail_record_id: 240,
  grade: 95,
  section: 115,
  students_present: 135,
  qa_score_5: 100,
  qa_score_4: 100,
  qa_score_3: 100,
  qa_score_2: 100,
  qa_score_1: 100,
  qa_total: 100,
  qa_weighted_score: 140,
  csat: 95,
  qb_score_5: 100,
  qb_score_4: 100,
  qb_score_3: 100,
  qb_score_2: 100,
  qb_score_1: 100,
  qb_total: 100,
  qb_weighted_score: 140,
  itp: 95,
  user_id: 170,
  name: 190,
  email: 245,
  role: 125,
  active: 95,
  status: 125,
  school_record_id: 185,
  config_key: 195,
  config_value_json: 560,
  audit_id: 195,
  timestamp: 185,
  user_email: 225,
  action: 185,
  entity_type: 135,
  entity_id: 220,
  previous_summary: 260,
  new_summary: 280,
  result: 115,
  sync_id: 195,
  actor_email: 225,
  operation: 175,
  attempt: 95,
  error_message: 310
};

var CT_HEADER_NOTES_BY_NAME = {
  session_record_id: 'Primary UUID (Text @). Unique internal key for each session header row.',
  session_id: 'Official Career Tours Session ID (Text @). Natural deduplication key.',
  client_submission_key: 'Client-generated UUID ensuring retry & offline idempotency.',
  udise_code: '11-digit school UDISE code stored strictly as Plain Text (@) to preserve leading zeroes.',
  pin_code: '6-digit PIN code stored strictly as Plain Text (@) to preserve leading zeroes.',
  district: 'Approved Tamil Nadu district: Cuddalore, Nagapattinam, Sivaganga.',
  total_students_present: 'Total students present in the session (single-counted; never duplicated across combined rows).',
  overall_csat: 'Weighted Q-A Student Enjoyment score (1.00–5.00): SUM(qa_weighted_score)/SUM(qa_total).',
  overall_itp: 'Weighted Q-B Career Interest score (1.00–5.00): SUM(qb_weighted_score)/SUM(qb_total).',
  teacher_nps: 'Teacher NPS weight: Promoter (9–10)=+100, Passive (7–8)=0, Detractor (0–6)=-100.',
  submission_status: 'Two-phase lock status. Only COMMITTED and CORRECTED rows enter programme analytics & exports.',
  students_present: 'Class-row attendance for a single grade/section (1:N expansion row).',
  config_value_json: 'JSON payload managed by Super Administrators. Never store passwords here.'
};

function ctColIndexToLetter_(colIdx) {
  var num = colIdx;
  var letters = '';
  while (num > 0) {
    var rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters || 'A';
}

function ctGetDropdownChoices_(headerName, defaults) {
  if (headerName === 'district') return (defaults && defaults.allowedDistricts) || ['Cuddalore', 'Nagapattinam', 'Sivaganga'];
  if (headerName === 'language') return (defaults && defaults.languageOptions) || ['Tamil', 'English'];
  if (headerName === 'grade') return (defaults && defaults.gradeOptions) || ['8', '9', '10', '11', '12'];
  if (headerName === 'section') return (defaults && defaults.sectionOptions) || ['A', 'B', 'C', 'D', 'E', 'F', 'No section'];
  if (headerName === 'school_type') return (defaults && defaults.schoolTypes) || [];
  if (headerName === 'session_type') return ['single', 'combined'];
  if (headerName === 'submission_status') return ['COMMITTED', 'CORRECTED', 'PENDING'];
  if (headerName === 'archived' || headerName === 'active') return ['true', 'false'];
  if (headerName === 'status') return ['APPROVED', 'PENDING', 'DENIED'];
  if (headerName === 'role') return ['super_admin', 'facilitator'];
  if (headerName === 'teacher_classification') return ['Promoter', 'Passive', 'Detractor'];
  return null;
}

function ctApplySafeHeaderStyle_(range, bgHex, fgHex) {
  range.setFontWeight('bold');
  range.setBackground(bgHex);
  range.setFontColor(fgHex);
  if (typeof range.setVerticalAlignment === 'function') range.setVerticalAlignment('middle');
  if (typeof range.setHorizontalAlignment === 'function') range.setHorizontalAlignment('left');
  if (typeof range.setWrapStrategy === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.WrapStrategy) {
    range.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  }
  if (typeof range.setBorder === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.BorderStyle) {
    range.setBorder(true, true, true, true, true, false, '#334155', SpreadsheetApp.BorderStyle.SOLID);
    range.setBorder(null, null, true, null, null, null, '#1EA7FF', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
}

function ctEnhanceSheetTableStructure_(sheet, def, defaults, optForceRefreshFilter) {
  var colCount = def.headers.length;
  var headerRange = sheet.getRange(1, 1, 1, colCount);
  ctApplySafeHeaderStyle_(headerRange, '#171C24', '#F8FAFC');

  if (typeof sheet.setRowHeight === 'function') {
    try { sheet.setRowHeight(1, 34); } catch (e) {}
  }

  sheet.setFrozenRows(1);

  var maxRows = Math.max(sheet.getMaxRows(), 200);
  var isTextCol = {};
  for (var t = 0; t < def.textColumns.length; t++) {
    isTextCol[def.textColumns[t]] = true;
  }

  for (var cIdx = 1; cIdx <= colCount; cIdx++) {
    var hdr = def.headers[cIdx - 1];
    if (typeof sheet.setColumnWidth === 'function') {
      try { sheet.setColumnWidth(cIdx, CT_COLUMN_WIDTHS_BY_HEADER[hdr] || 155); } catch (eWidth) {}
    }

    if (isTextCol[cIdx]) {
      sheet.getRange(1, cIdx, maxRows, 1).setNumberFormat('@');
    } else if (hdr === 'csat' || hdr === 'itp' || hdr === 'overall_csat' || hdr === 'overall_itp') {
      sheet.getRange(2, cIdx, maxRows - 1, 1).setNumberFormat('0.00');
    }

    // Header hover note explaining validation & programme rule
    var headerCell = sheet.getRange(1, cIdx, 1, 1);
    if (typeof headerCell.setNote === 'function') {
      var noteText =
        CT_HEADER_NOTES_BY_NAME[hdr] ||
        ('Column ' + cIdx + ' (' + def.name + '): ' + hdr + (isTextCol[cIdx] ? ' [Plain Text @]' : ''));
      try { headerCell.setNote(noteText); } catch (eNote) {}
    }

    // Dropdown validation for categorical columns (rows 2..min(maxRows,500))
    var choices = ctGetDropdownChoices_(hdr, defaults);
    if (
      choices &&
      choices.length > 0 &&
      typeof SpreadsheetApp !== 'undefined' &&
      typeof SpreadsheetApp.newDataValidation === 'function'
    ) {
      try {
        var rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(choices, true)
          .setAllowInvalid(true)
          .setHelpText('Allowed values: ' + choices.join(', '))
          .build();
        sheet.getRange(2, cIdx, Math.min(maxRows - 1, 499), 1).setDataValidation(rule);
      } catch (eDv) {}
    }
  }

  // Wrap JSON values neatly inside Configuration without expanding rows prematurely
  if (def.name === 'Configuration' && maxRows >= 2) {
    var cfgValRange = sheet.getRange(2, 2, maxRows - 1, 1);
    if (typeof cfgValRange.setWrapStrategy === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.WrapStrategy) {
      try { cfgValRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); } catch (eWrap) {}
    }
  }

  // Native Google Sheets Filter across headers + data range
  if (typeof sheet.getFilter === 'function') {
    var existingFilter = sheet.getFilter();
    if (existingFilter && optForceRefreshFilter) {
      try { existingFilter.remove(); } catch (eRmFilter) {}
      existingFilter = null;
    }
    if (!existingFilter) {
      try {
        var filterRows = Math.max(sheet.getLastRow(), 2);
        sheet.getRange(1, 1, filterRows, colCount).createFilter();
      } catch (eFilter) {}
    }
  }

  // Subtle zebra banding (created once idempotently)
  if (
    typeof sheet.getBandings === 'function' &&
    sheet.getBandings().length === 0 &&
    typeof SpreadsheetApp !== 'undefined' &&
    SpreadsheetApp.BandingTheme
  ) {
    try {
      var bandingRange = sheet.getRange(1, 1, Math.min(maxRows, 500), colCount);
      var banding = bandingRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
      if (banding && typeof banding.setHeaderRowColor === 'function') {
        banding.setHeaderRowColor('#171C24');
        banding.setFirstRowColor('#FFFFFF');
        banding.setSecondRowColor('#F8FAFC');
      }
    } catch (eBand) {}
  }
}

function ctRefreshSummaryAndKpisSheet_(ss, defaults) {
  var sheet = ss.getSheetByName('Summary & KPIs');
  if (!sheet) {
    sheet = ss.insertSheet('Summary & KPIs');
  }
  if (typeof sheet.getFilter === 'function' && sheet.getFilter()) {
    try { sheet.getFilter().remove(); } catch (eF) {}
  }

  var sDef = CT_SCHEMA_DEFINITIONS[0]; // Sessions
  var dDef = CT_SCHEMA_DEFINITIONS[1]; // Session Details
  var sCol = function (name) { return ctColIndexToLetter_(sDef.headers.indexOf(name) + 1); };
  var dCol = function (name) { return ctColIndexToLetter_(dDef.headers.indexOf(name) + 1); };

  var sStatus = sCol('submission_status');
  var sArch = sCol('archived');
  var sStudents = sCol('total_students_present');
  var sDistrict = sCol('district');
  var sTourId = sCol('tour_id');
  var sLang = sCol('language');
  var sCsat = sCol('overall_csat');
  var sItp = sCol('overall_itp');
  var sNps = sCol('teacher_nps');

  var dGrade = dCol('grade');
  var dStud = dCol('students_present');
  var dQaTot = dCol('qa_total');
  var dQaW = dCol('qa_weighted_score');
  var dQbTot = dCol('qb_total');
  var dQbW = dCol('qb_weighted_score');
  var R = 2500;

  var rows = [];
  var rowTypes = []; // 'banner' | 'subtitle' | 'spacer' | 'section' | 'subheader' | 'data' | 'total'

  rows.push(['Vidhya Vidhai · Career Tours Programme Summary & Live KPIs', '', '', '', '', '', '', '']);
  rowTypes.push('banner');
  rows.push([
    'State: ' + defaults.stateName + ' · Approved Districts: ' + defaults.allowedDistricts.join(', ') + ' · Timezone: ' + defaults.programmeTimezone + ' · Live Formulas referencing Sessions & Session Details',
    '', '', '', '', '', '', ''
  ]);
  rowTypes.push('subtitle');
  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');

  rows.push(['1. Official Programme Key Performance Indicators (Live Formulas)', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['Metric Code', 'Programme Indicator', 'Live Value', 'Unit / Scale', 'Formula Declaration', '', '', '']);
  rowTypes.push('subheader');

  var kpiItems = [
    ['KPI-01', 'Total Committed Sessions', '=IFERROR(COUNTIFS(Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)', 'Sessions', 'Counts Sessions where submission_status <> PENDING and archived = false'],
    ['KPI-02', 'Total Students Reached (Single-Counted)', '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)', 'Students', 'Single-counted attendance across committed non-archived sessions'],
    ['KPI-03', 'Total Class Groups Covered', "=IFERROR(COUNTA('Session Details'!A2:A" + R + '),0)', 'Class rows', 'Expanded 1:N grade/section rows in Session Details'],
    ['KPI-04', 'Registered Canonical Schools', '=IFERROR(COUNTA(Schools!A2:A' + R + '),0)', 'Schools', 'Canonical 11-digit UDISE schools in Schools tab'],
    ['KPI-05', 'Approved Facilitators', '=IFERROR(COUNTIF(Facilitators!H2:H' + R + ',"APPROVED"),0)', 'Accounts', 'Approved facilitator rows in Facilitators tab'],
    ['KPI-06', 'Protected / Approved Super Admins', "=IFERROR(COUNTIF('Admin Users'!H2:H" + R + ',"APPROVED"),0)', 'Accounts', 'Approved Super Administrators in Admin Users tab'],
    ['KPI-07', 'Pooled Student CSAT (Q-A Enjoyment)', "=IFERROR(SUM('Session Details'!" + dQaW + '2:' + dQaW + R + ")/SUM('Session Details'!" + dQaTot + '2:' + dQaTot + R + '),0)', '1.00–5.00', 'SUM(qa_weighted_score) / SUM(qa_total)'],
    ['KPI-08', 'Pooled Student ITP (Q-B Career Interest)', "=IFERROR(SUM('Session Details'!" + dQbW + '2:' + dQbW + R + ")/SUM('Session Details'!" + dQbTot + '2:' + dQbTot + R + '),0)', '1.00–5.00', 'SUM(qb_weighted_score) / SUM(qb_total)'],
    ['KPI-09', 'Pooled Teacher NPS (-100 to +100)', '=IFERROR(AVERAGEIFS(Sessions!' + sNps + '2:' + sNps + R + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)', 'NPS Index', 'Mean session teacher_nps (+100 / 0 / -100)'],
    ['KPI-10', 'Question A Response Coverage Rate', "=IFERROR(SUM('Session Details'!" + dQaTot + '2:' + dQaTot + R + ")/SUM('Session Details'!" + dStud + '2:' + dStud + R + '),0)', 'Percentage', 'SUM(qa_total) / SUM(students_present)']
  ];
  for (var k = 0; k < kpiItems.length; k++) {
    rows.push([kpiItems[k][0], kpiItems[k][1], kpiItems[k][2], kpiItems[k][3], kpiItems[k][4], '', '', '']);
    rowTypes.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');
  rows.push(['2. Approved District-wise Programme Reach (Tamil Nadu)', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['District', 'State', 'School Year', 'Sessions', 'Students Reached', 'Avg CSAT', 'Avg ITP', 'Avg Teacher NPS']);
  rowTypes.push('subheader');

  var distStartRow = rows.length + 1;
  for (var d = 0; d < defaults.allowedDistricts.length; d++) {
    var distName = defaults.allowedDistricts[d];
    var rNum = rows.length + 1;
    rows.push([
      distName,
      defaults.stateName,
      defaults.schoolYear,
      '=IFERROR(COUNTIFS(Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sCsat + '2:' + sCsat + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sItp + '2:' + sItp + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sNps + '2:' + sNps + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)'
    ]);
    rowTypes.push('data');
  }
  var distEndRow = rows.length;
  rows.push([
    'Total / Pooled',
    defaults.stateName,
    defaults.schoolYear,
    '=SUM(D' + distStartRow + ':D' + distEndRow + ')',
    '=SUM(E' + distStartRow + ':E' + distEndRow + ')',
    "=IFERROR(SUM('Session Details'!" + dQaW + '2:' + dQaW + R + ")/SUM('Session Details'!" + dQaTot + '2:' + dQaTot + R + '),0)',
    "=IFERROR(SUM('Session Details'!" + dQbW + '2:' + dQbW + R + ")/SUM('Session Details'!" + dQbTot + '2:' + dQbTot + R + '),0)',
    '=IFERROR(AVERAGEIFS(Sessions!' + sNps + '2:' + sNps + R + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)'
  ]);
  rowTypes.push('total');

  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');
  rows.push(['3. Career Tours Catalog & Delivery Breakdown', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['Tour ID', 'Career Tour Name', 'Code', 'Active', 'Tamil Video ID', 'Sessions', 'Students Reached', 'Avg CSAT']);
  rowTypes.push('subheader');

  for (var tIdx = 0; tIdx < defaults.tours.length; tIdx++) {
    var tr = defaults.tours[tIdx];
    var trNum = rows.length + 1;
    rows.push([
      tr.tourId,
      tr.tourName,
      tr.tourCode,
      tr.active ? 'Active' : 'Inactive',
      (tr.videoIdByLanguage && tr.videoIdByLanguage.Tamil) || 'Pending',
      '=IFERROR(COUNTIFS(Sessions!' + sTourId + '2:' + sTourId + R + ',A' + trNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sTourId + '2:' + sTourId + R + ',A' + trNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sCsat + '2:' + sCsat + R + ',Sessions!' + sTourId + '2:' + sTourId + R + ',A' + trNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)'
    ]);
    rowTypes.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');
  rows.push(['4. Grade-wise & Language Breakdown (Live Formulas)', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['Dimension', 'Category', 'Value Key', 'Class / Session Count', 'Students Reached', 'Avg CSAT', '', '']);
  rowTypes.push('subheader');

  for (var gIdx = 0; gIdx < defaults.gradeOptions.length; gIdx++) {
    var gr = defaults.gradeOptions[gIdx];
    var gRowNum = rows.length + 1;
    rows.push([
      'Grade',
      'Grade ' + gr,
      gr,
      "=IFERROR(COUNTIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + '),0)',
      "=IFERROR(SUMIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + ",'Session Details'!" + dStud + '2:' + dStud + R + '),0)',
      "=IFERROR(SUMIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + ",'Session Details'!" + dQaW + '2:' + dQaW + R + ")/SUMIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + ",'Session Details'!" + dQaTot + '2:' + dQaTot + R + '),0)',
      '',
      ''
    ]);
    rowTypes.push('data');
  }
  for (var lIdx = 0; lIdx < defaults.languageOptions.length; lIdx++) {
    var lg = defaults.languageOptions[lIdx];
    var lRowNum = rows.length + 1;
    rows.push([
      'Language',
      lg,
      (defaults.languageCodes && defaults.languageCodes[lg]) || lg.slice(0, 2).toUpperCase(),
      '=IFERROR(COUNTIFS(Sessions!' + sLang + '2:' + sLang + R + ',B' + lRowNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sLang + '2:' + sLang + R + ',B' + lRowNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sCsat + '2:' + sCsat + R + ',Sessions!' + sLang + '2:' + sLang + R + ',B' + lRowNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '',
      ''
    ]);
    rowTypes.push('data');
  }

  var existingLastRow = Math.max(sheet.getLastRow(), rows.length);
  if (existingLastRow > 0) {
    var clearRng = sheet.getRange(1, 1, existingLastRow, 8);
    if (typeof clearRng.clearContent === 'function') clearRng.clearContent();
  }

  sheet.getRange(1, 1, rows.length, 8).setValues(rows);
  sheet.setFrozenRows(2);

  var summaryWidths = [165, 290, 155, 130, 340, 125, 135, 135];
  if (typeof sheet.setColumnWidth === 'function') {
    for (var w = 0; w < summaryWidths.length; w++) {
      try { sheet.setColumnWidth(w + 1, summaryWidths[w]); } catch (eSw) {}
    }
  }

  for (var rIdx = 0; rIdx < rowTypes.length; rIdx++) {
    var rowRange = sheet.getRange(rIdx + 1, 1, 1, 8);
    var kind = rowTypes[rIdx];
    if (kind === 'banner') {
      rowRange.setBackground('#0B1220');
      rowRange.setFontColor('#F8FAFC');
      rowRange.setFontWeight('bold');
      if (typeof rowRange.setFontSize === 'function') rowRange.setFontSize(13);
      if (typeof rowRange.mergeAcross === 'function') {
        try { rowRange.mergeAcross(); } catch (eM1) {}
      }
    } else if (kind === 'subtitle') {
      rowRange.setBackground('#E8F6FF');
      rowRange.setFontColor('#006BB8');
      if (typeof rowRange.mergeAcross === 'function') {
        try { rowRange.mergeAcross(); } catch (eM2) {}
      }
    } else if (kind === 'section') {
      rowRange.setBackground('#F0F4F8');
      rowRange.setFontColor('#0A1B2C');
      rowRange.setFontWeight('bold');
      if (typeof rowRange.mergeAcross === 'function') {
        try { rowRange.mergeAcross(); } catch (eM3) {}
      }
    } else if (kind === 'subheader') {
      ctApplySafeHeaderStyle_(rowRange, '#171C24', '#F8FAFC');
    } else if (kind === 'total') {
      rowRange.setBackground('#EFF6FF');
      rowRange.setFontColor('#0A1B2C');
      rowRange.setFontWeight('bold');
    } else if (kind === 'data') {
      rowRange.setBackground(rIdx % 2 === 1 ? '#F8FAFC' : '#FFFFFF');
      rowRange.setFontColor('#0A1B2C');
      rowRange.setFontWeight('normal');
    }
  }
}

function ctRefreshDeclarationsSheet_(ss, defaults) {
  var sheet = ss.getSheetByName('Declarations');
  if (!sheet) {
    sheet = ss.insertSheet('Declarations');
  }

  var headers = [
    'declaration_category',
    'target_tab_or_scope',
    'ref_or_col_num',
    'field_or_rule_key',
    'display_title',
    'type_format_or_formula',
    'validation_and_official_declaration'
  ];

  var initialAdmins = ctGetInitialSuperAdmins_().map(function (a) { return a.email; }).join(', ');
  var declRows = [
    headers,
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-01',
      'GOV-01',
      'Approved Geography & Timezone',
      'State: ' + defaults.stateName + ' · Districts: ' + defaults.allowedDistricts.join(', ') + ' · TZ: ' + defaults.programmeTimezone,
      'Only schools within Tamil Nadu and approved districts (Cuddalore, Nagapattinam, Sivaganga) are valid. All dates use Asia/Kolkata (IST).'
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-02',
      'GOV-02',
      'Protected Super Administrators & RBAC',
      initialAdmins,
      'Only allowlisted Super Administrators may connect sheets, alter Configuration, archive/restore records, delete data, or export official .xlsx files. Zero passwords are stored.'
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-03',
      'GOV-03',
      'Zero Fabricated Data Policy',
      'Empty initial DB tables (0 sample classrooms, 0 fabricated partners)',
      'Core database tabs contain no sample/dummy session rows. Summary & KPIs live formulas cleanly evaluate to 0 until genuine sessions are committed.'
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-01',
      'MET-01',
      'Pooled Student CSAT (Question A)',
      'CSAT = SUM(qa_weighted_score) / SUM(qa_total)',
      'Scale 1.00–5.00. Weighted across all student respondents, never an unweighted average of class averages.'
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-02',
      'MET-02',
      'Pooled Student ITP (Question B)',
      'ITP = SUM(qb_weighted_score) / SUM(qb_total)',
      'Scale 1.00–5.00. Weighted across all Question B respondents on committed non-archived rows.'
    ],
    [
      'Metric Formula',
      'Sessions',
      'MET-03',
      'MET-03',
      'Teacher Net Promoter Score (Teacher NPS)',
      'Promoter (9–10)=+100, Passive (7–8)=0, Detractor (0–6)=-100 · AVERAGE(teacher_nps)',
      'Evaluated once per unique classroom session header (never double-weighted across combined classes).'
    ],
    [
      'Metric Formula',
      'Sessions -> Session Details',
      'MET-04',
      'MET-04',
      'Combined-Class 1:N Expansion & Single Counting',
      '1 Session Header -> N Session Details rows',
      'Each Grade/Section row holds its own attendance and Q-A/Q-B votes so attendance totals never double-count.'
    ],
    [
      'Data Integrity',
      'Sessions / Schools',
      'INT-01',
      'INT-01',
      'Plain Text (@) Leading-Zero Preservation',
      'numFmt = "@" on udise_code (11 chars), pin_code (6 chars), session_id, dates & times',
      'Protects leading zeroes on UDISE codes, PIN codes, and ISO/DD-MM-YYYY date strings in Google Sheets & Excel.'
    ],
    [
      'Data Integrity',
      'Sessions / Sync Log / Audit Log',
      'INT-02',
      'INT-02',
      'Atomic LockService Two-Phase Commit & 3-Key Deduplication',
      'Unique keys: session_record_id + session_id + client_submission_key',
      'Two-phase write (PENDING -> COMMITTED/CORRECTED) inside ScriptLock prevents duplicates on retries and logs every mutation.'
    ]
  ];

  // Append column-by-column Data Dictionary across all 8 schema tabs
  for (var t = 0; t < CT_SCHEMA_DEFINITIONS.length; t++) {
    var tabDef = CT_SCHEMA_DEFINITIONS[t];
    var textSet = {};
    for (var tc = 0; tc < tabDef.textColumns.length; tc++) textSet[tabDef.textColumns[tc]] = true;
    for (var h = 0; h < tabDef.headers.length; h++) {
      var colNum = h + 1;
      var colLetter = ctColIndexToLetter_(colNum);
      var hdrName = tabDef.headers[h];
      var isTxt = Boolean(textSet[colNum]);
      declRows.push([
        'Data Dictionary (' + tabDef.name + ')',
        tabDef.name,
        'Col ' + colNum + ' (' + colLetter + ')',
        hdrName,
        hdrName.replace(/_/g, ' ').replace(/\\b\\w/g, function (ch) { return ch.toUpperCase(); }),
        isTxt ? 'Plain Text (@)' : 'Numeric / Decimal',
        CT_HEADER_NOTES_BY_NAME[hdrName] || ('Canonical field in "' + tabDef.name + '" tab.')
      ]);
    }
  }

  var existingLast = Math.max(sheet.getLastRow(), declRows.length);
  if (existingLast > 0) {
    var clr = sheet.getRange(1, 1, existingLast, headers.length);
    if (typeof clr.clearContent === 'function') clr.clearContent();
  }

  var fullRng = sheet.getRange(1, 1, declRows.length, headers.length);
  fullRng.setNumberFormat('@');
  fullRng.setValues(declRows);
  if (typeof fullRng.setWrapStrategy === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.WrapStrategy) {
    try { fullRng.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); } catch (eW) {}
  }

  ctApplySafeHeaderStyle_(sheet.getRange(1, 1, 1, headers.length), '#171C24', '#F8FAFC');
  sheet.setFrozenRows(1);

  var widths = [175, 165, 110, 210, 225, 250, 440];
  if (typeof sheet.setColumnWidth === 'function') {
    for (var wi = 0; wi < widths.length; wi++) {
      try { sheet.setColumnWidth(wi + 1, widths[wi]); } catch (eDw) {}
    }
  }
  if (typeof sheet.getFilter === 'function' && !sheet.getFilter()) {
    try { sheet.getRange(1, 1, declRows.length, headers.length).createFilter(); } catch (eDf) {}
  }
}

function ctInitializeSpreadsheetObject_(ss, optActorEmail) {
  if (!ss) {
    throw ctApiError_('INVALID_SPREADSHEET', 'A valid Google Spreadsheet instance is required.');
  }
  var actorLabel = String(optActorEmail || 'SYSTEM_INIT');
  var nowIso = ctNowIso_();
  var initializedTabs = [];
  var defaults = ctDefaultConfigObject_();

  for (var i = 0; i < CT_SCHEMA_DEFINITIONS.length; i++) {
    var def = CT_SCHEMA_DEFINITIONS[i];
    var sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
    }

    // Set headers cleanly in row 1 if blank, migrate legacy 'block' column non-destructively, or append missing trailing columns safely
    var lastCol =
      typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : def.headers.length + 1;
    var probeWidth = Math.max(def.headers.length, lastCol);
    var existingHeaders = sheet.getRange(1, 1, 1, probeWidth).getValues()[0];
    var hasHeader = String(existingHeaders[0] || '').trim() !== '';
    var migratedSchema = false;

    if (!hasHeader) {
      var headerRange = sheet.getRange(1, 1, 1, def.headers.length);
      headerRange.setValues([def.headers]);
    } else {
      if (def.name === 'Sessions' || def.name === 'Schools') {
        var blockColIdx = -1;
        for (var hIdx = 0; hIdx < existingHeaders.length; hIdx++) {
          if (String(existingHeaders[hIdx] || '').trim().toLowerCase() === 'block') {
            blockColIdx = hIdx;
            break;
          }
        }
        if (blockColIdx !== -1 && typeof sheet.deleteColumn === 'function') {
          if (typeof sheet.getFilter === 'function' && sheet.getFilter()) {
            try { sheet.getFilter().remove(); } catch (eFlt) {}
          }
          sheet.deleteColumn(blockColIdx + 1);
          sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
          migratedSchema = true;
        }
      }
      if (!migratedSchema && def.headers.length >= 8 && String(existingHeaders[7] || '').trim() === '') {
        sheet.getRange(1, 8, 1, 1).setValue(def.headers[7]);
      }
    }

    ctEnhanceSheetTableStructure_(sheet, def, defaults, migratedSchema);
    initializedTabs.push(def.name);
  }

  // Create & refresh live formula Summary & KPIs + comprehensive Declarations tabs
  ctRefreshSummaryAndKpisSheet_(ss, defaults);
  ctRefreshDeclarationsSheet_(ss, defaults);

  // Seed default configuration keys ONLY if missing (never overwrite custom admin edits)
  var cfgSheet = ss.getSheetByName(SHEET_NAMES.CONFIGURATION);
  var existingKeys = {};
  if (cfgSheet.getLastRow() >= 2) {
    var col = cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 1).getValues();
    var legacyRows = [];
    for (var r = 0; r < col.length; r++) {
      var k = String(col[r][0] || '').trim();
      if (k === 'district_blocks') {
        legacyRows.push(r + 2);
        continue;
      }
      if (k) existingKeys[k] = true;
    }
    for (var dr = legacyRows.length - 1; dr >= 0; dr--) {
      cfgSheet.deleteRow(legacyRows[dr]);
    }
  }

  var seedPairs = [
    ['programme_timezone', defaults.programmeTimezone],
    ['state_name', defaults.stateName],
    ['allowed_districts', defaults.allowedDistricts],
    ['grade_options', defaults.gradeOptions],
    ['section_options', defaults.sectionOptions],
    ['school_types', defaults.schoolTypes],
    ['tours', defaults.tours],
    ['language_options', defaults.languageOptions],
    ['language_codes', defaults.languageCodes],
    ['school_year', defaults.schoolYear],
    ['partner_name', defaults.partnerName],
    ['reporting_defaults', defaults.reportingDefaults],
    ['policy', defaults.policy]
  ];

  for (var sIdx = 0; sIdx < seedPairs.length; sIdx++) {
    if (!existingKeys[seedPairs[sIdx][0]]) {
      ctUpsertConfigKey_(cfgSheet, seedPairs[sIdx][0], seedPairs[sIdx][1], actorLabel);
    }
  }

  // Idempotently ensure protected allowlisted SUPER_ADMIN accounts exist in Admin Users (zero passwords stored)
  var initialSuperAdmins = ctGetInitialSuperAdmins_();
  var adminSheet = ss.getSheetByName(SHEET_NAMES.ADMIN_USERS);
  var existingAdmins = [];
  var adminLastRow = adminSheet.getLastRow();
  if (adminLastRow >= 2) {
    var adminVals = adminSheet.getRange(2, 1, adminLastRow - 1, 8).getValues();
    for (var av = 0; av < adminVals.length; av++) {
      var admRow = adminVals[av];
      var admEmail = String(admRow[2] || '').trim().toLowerCase();
      if (!admEmail) continue;
      var activeRaw = admRow[4];
      var activeBool =
        activeRaw === true ||
        String(activeRaw).trim().toLowerCase() === 'true' ||
        String(activeRaw).trim() === '1';
      existingAdmins.push({
        rowNumber: av + 2,
        userId: String(admRow[0] || '').trim(),
        name: String(admRow[1] || '').trim(),
        email: admEmail,
        role: String(admRow[3] || '').trim().toLowerCase(),
        active: activeBool,
        createdAt: String(admRow[5] || ''),
        status: String(admRow[7] || '').trim().toUpperCase()
      });
    }
  }

  for (var saIdx = 0; saIdx < initialSuperAdmins.length; saIdx++) {
    var sa = initialSuperAdmins[saIdx];
    var matchedRow = null;
    for (var aIdx = 0; aIdx < existingAdmins.length; aIdx++) {
      if (existingAdmins[aIdx].email === sa.email) {
        matchedRow = existingAdmins[aIdx];
        break;
      }
    }

    if (!matchedRow) {
      var nextRow = Math.max(2, ctFindLastPopulatedRow_(adminSheet, 1) + 1);
      var admRange = adminSheet.getRange(nextRow, 1, 1, 8);
      admRange.setNumberFormat('@');
      admRange.setValues([[
        sa.userId,
        sa.name,
        sa.email,
        'super_admin',
        'true',
        nowIso,
        nowIso,
        'APPROVED'
      ]]);
    } else if (
      matchedRow.role !== 'super_admin' ||
      !matchedRow.active ||
      matchedRow.status !== 'APPROVED'
    ) {
      var repairRange = adminSheet.getRange(matchedRow.rowNumber, 1, 1, 8);
      repairRange.setNumberFormat('@');
      repairRange.setValues([[
        matchedRow.userId || sa.userId,
        matchedRow.name || sa.name,
        sa.email,
        'super_admin',
        'true',
        matchedRow.createdAt || nowIso,
        nowIso,
        'APPROVED'
      ]]);
    }
  }

  ctInvalidateConfigCache_();
  return initializedTabs;
}

function initializeDatabase() {
  var ss = ctGetSpreadsheet_();
  ctInitializeSpreadsheetObject_(ss, 'SYSTEM_INIT');
  return 'Career Tours database initialized cleanly at ' + ctNowIso_();
}

/**
 * One-click initializer for the Apps Script Sync Bridge.
 * Sets \`SANDBOX_SYNC_KEY\` in Script Properties (using custom key, copied preset key, or fresh key),
 * initializes all 10 tabs (8 schema tabs + Summary & KPIs + Declarations) on the connected/bound
 * spreadsheet (or creates a dedicated spreadsheet automatically for standalone scripts),
 * and records connection metadata without storing any secret inside any sheet cell.
 */
function setupForLocalSandbox(optionalCustomSyncKey, optionalSpreadsheetUrlOrId, optionalCustomIntakeKey) {
  var presetKey =
    typeof CT_PRESET_SANDBOX_SYNC_KEY !== 'undefined' ? String(CT_PRESET_SANDBOX_SYNC_KEY || '').trim() : '';
  var placeholder = '__CT_PRESET_' + 'SYNC_KEY__';
  var chosenKey = '';
  if (optionalCustomSyncKey && String(optionalCustomSyncKey).trim()) {
    chosenKey = String(optionalCustomSyncKey).trim();
  } else if (presetKey && presetKey !== placeholder) {
    chosenKey = presetKey;
  }

  var presetIntakeKey =
    typeof CT_PRESET_FACILITATOR_INTAKE_KEY !== 'undefined'
      ? String(CT_PRESET_FACILITATOR_INTAKE_KEY || '').trim()
      : '';
  var intakePlaceholder = '__CT_PRESET_' + 'INTAKE_KEY__';
  var chosenIntakeKey = '';
  if (optionalCustomIntakeKey && String(optionalCustomIntakeKey).trim()) {
    chosenIntakeKey = String(optionalCustomIntakeKey).trim();
  } else if (presetIntakeKey && presetIntakeKey !== intakePlaceholder) {
    chosenIntakeKey = presetIntakeKey;
  }

  var syncKey = ctConfigureSandboxSyncKey_(chosenKey);
  var intakeKey =
    typeof ctConfigureFacilitatorIntakeKey_ === 'function'
      ? ctConfigureFacilitatorIntakeKey_(chosenIntakeKey)
      : '';
  var props = PropertiesService.getScriptProperties();
  var explicitTargetId = ctParseSpreadsheetId_(optionalSpreadsheetUrlOrId);
  var ss = null;

  if (explicitTargetId) {
    ss = SpreadsheetApp.openById(explicitTargetId);
  } else {
    try {
      ss = ctGetSpreadsheet_();
    } catch (err) {
      ss = SpreadsheetApp.create('Vidhya Vidhai · Career Tours Database');
    }
  }

  var initializedTabs = ctInitializeSpreadsheetObject_(ss, 'SYSTEM_LOCAL_SANDBOX_SETUP');
  var resolvedId =
    typeof ss.getId === 'function' && ss.getId()
      ? ss.getId()
      : explicitTargetId || '';
  var ssName =
    typeof ss.getName === 'function' && ss.getName()
      ? ss.getName()
      : 'Vidhya Vidhai · Career Tours Database';
  var ssUrl =
    typeof ss.getUrl === 'function' && ss.getUrl()
      ? ss.getUrl()
      : resolvedId
      ? 'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit'
      : '';

  if (resolvedId && typeof props.setProperty === 'function') {
    props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
    props.setProperty('CONNECTED_SPREADSHEET_NAME', ssName);
    props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
    props.setProperty('CONNECTED_DISCONNECTED', 'false');
    props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(initializedTabs));
  }

  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(
      'Apps Script Sync Bridge ready. Spreadsheet: ' +
        ssName +
        ' (' +
        ssUrl +
        ') | Tabs: ' +
        initializedTabs.join(', ') +
        ' | SANDBOX_SYNC_KEY configured (length=' +
        syncKey.length +
        ') | FACILITATOR_INTAKE_KEY configured (length=' +
        intakeKey.length +
        ').'
    );
  }

  return {
    ok: true,
    syncKeyConfigured: true,
    syncKeyLength: syncKey.length,
    intakeKeyConfigured: Boolean(intakeKey && intakeKey.length >= 16),
    intakeKeyLength: intakeKey ? intakeKey.length : 0,
    spreadsheetId: resolvedId,
    spreadsheetName: ssName,
    spreadsheetUrl: ssUrl,
    initializedTabs: initializedTabs
  };
}

// ============================================================================
// Module: Sessions.gs
// ============================================================================

/**
 * Sessions.gs — Concurrency-safe classroom session persistence, ID generation,
 * PENDING->COMMITTED write workflow, row-level updates, filtering, and pagination.
 */

var SESSION_COL_COUNT = 41;
var SESSION_TEXT_COLS = [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 25, 36, 37, 38, 41];
var SESSION_LEGACY_TEXT_COLS = [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 26, 37, 38, 39, 42];
var DETAIL_COL_COUNT = 24;

function ctResolveSessionSheetLayout_(sheet) {
  var lastCol = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 0;
  var probeCols = lastCol >= 1 ? Math.max(SESSION_COL_COUNT, lastCol) : SESSION_COL_COUNT;
  var hasBlock = false;
  if (sheet.getLastRow() >= 1) {
    var hdrs = sheet.getRange(1, 1, 1, probeCols).getValues()[0];
    for (var i = 0; i < hdrs.length; i++) {
      if (String(hdrs[i] || '').trim().toLowerCase() === 'block') {
        hasBlock = true;
        break;
      }
    }
  }
  var offset = hasBlock ? 1 : 0;
  return {
    hasBlock: hasBlock,
    colCount: hasBlock ? 42 : SESSION_COL_COUNT,
    textColumns: hasBlock ? SESSION_LEGACY_TEXT_COLS : SESSION_TEXT_COLS,
    pinCol: 25 + offset,
    totalClassesIdx: 26 + offset,
    statusCol: 36 + offset,
    statusIdx: 35 + offset,
    updatedAtCol: 38 + offset,
    updatedByCol: 40 + offset,
    archivedCol: 41 + offset
  };
}

function ctCellToString_(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function ctCellToBool_(val) {
  if (val === true) return true;
  var s = String(val || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function ctCellToNumber_(val, fallback) {
  if (val === '' || val === null || val === undefined) return fallback;
  var n = Number(val);
  return isNaN(n) ? fallback : n;
}

function ctCellToNumOrNull_(val) {
  if (val === '' || val === null || val === undefined) return null;
  var n = Number(val);
  return isNaN(n) ? null : n;
}

function ctCellToISODate_(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  return ctCellToString_(val);
}

function ctCellToTime24_(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Asia/Kolkata', 'HH:mm');
  }
  return ctCellToString_(val);
}

function ctBuildTextFormatRow_(valuesArray, textColumnIndicesOneBased) {
  var rowFmt = [];
  var textSet = {};
  for (var i = 0; i < textColumnIndicesOneBased.length; i++) {
    textSet[textColumnIndicesOneBased[i] - 1] = true;
  }
  for (var c = 0; c < valuesArray.length; c++) {
    rowFmt.push(textSet[c] ? '@' : 'General');
  }
  return rowFmt;
}

function ctSessionRecordToSheetRow_(rec, optHasBlock) {
  var row = [
    rec.sessionRecordId,
    rec.sessionId,
    rec.clientSubmissionKey,
    rec.facilitatorName,
    rec.facilitatorEmail,
    rec.facilitatorUserId,
    rec.tourId,
    rec.tourName,
    rec.videoId,
    rec.language,
    rec.startDate,
    rec.endDate,
    rec.startTime,
    rec.endTime,
    rec.durationMinutes,
    rec.durationFormatted,
    rec.reportingMonth,
    rec.submissionTimestamp,
    rec.submissionDateFormatted,
    rec.schoolName,
    rec.udiseCode,
    rec.schoolType,
    rec.state,
    rec.district
  ];
  if (optHasBlock) {
    row.push('');
  }
  row.push(
    rec.pinCode,
    rec.sessionType,
    rec.totalClasses,
    rec.totalStudentsPresent,
    rec.totalQuestionAResponses,
    rec.totalQuestionBResponses,
    rec.overallCsat === null ? '' : rec.overallCsat,
    rec.overallItp === null ? '' : rec.overallItp,
    rec.teacherScore === null ? '' : rec.teacherScore,
    rec.teacherClassification,
    rec.teacherNps,
    rec.submissionStatus,
    rec.createdAt,
    rec.updatedAt,
    rec.createdBy,
    rec.updatedBy,
    rec.archived ? 'true' : 'false'
  );
  return row;
}

function ctDetailRecordToSheetRow_(d) {
  return [
    d.detailRecordId,
    d.sessionRecordId,
    d.sessionId,
    String(d.grade),
    String(d.section),
    d.studentsPresent,
    d.questionAScore5,
    d.questionAScore4,
    d.questionAScore3,
    d.questionAScore2,
    d.questionAScore1,
    d.questionATotal,
    d.questionAWeightedScore,
    d.csat === null ? '' : d.csat,
    d.questionBScore5,
    d.questionBScore4,
    d.questionBScore3,
    d.questionBScore2,
    d.questionBScore1,
    d.questionBTotal,
    d.questionBWeightedScore,
    d.itp === null ? '' : d.itp,
    d.createdAt,
    d.updatedAt
  ];
}

function ctSheetRowToDetailRecord_(r, rowNumber) {
  return {
    _rowNumber: rowNumber,
    detailRecordId: ctCellToString_(r[0]),
    sessionRecordId: ctCellToString_(r[1]),
    sessionId: ctCellToString_(r[2]),
    grade: ctCellToString_(r[3]),
    section: ctCellToString_(r[4]),
    studentsPresent: ctCellToNumber_(r[5], 0),
    questionAScore5: ctCellToNumber_(r[6], 0),
    questionAScore4: ctCellToNumber_(r[7], 0),
    questionAScore3: ctCellToNumber_(r[8], 0),
    questionAScore2: ctCellToNumber_(r[9], 0),
    questionAScore1: ctCellToNumber_(r[10], 0),
    questionATotal: ctCellToNumber_(r[11], 0),
    questionAWeightedScore: ctCellToNumber_(r[12], 0),
    csat: ctCellToNumOrNull_(r[13]),
    questionBScore5: ctCellToNumber_(r[14], 0),
    questionBScore4: ctCellToNumber_(r[15], 0),
    questionBScore3: ctCellToNumber_(r[16], 0),
    questionBScore2: ctCellToNumber_(r[17], 0),
    questionBScore1: ctCellToNumber_(r[18], 0),
    questionBTotal: ctCellToNumber_(r[19], 0),
    questionBWeightedScore: ctCellToNumber_(r[20], 0),
    itp: ctCellToNumOrNull_(r[21]),
    createdAt: ctCellToString_(r[22]),
    updatedAt: ctCellToString_(r[23])
  };
}

function ctSheetRowToSessionRecord_(r, rowNumber, detailsList, optHasBlock) {
  var st25 = ctCellToString_(r[25]);
  var st26 = ctCellToString_(r[26]);
  var hasBlock =
    optHasBlock !== undefined
      ? Boolean(optHasBlock)
      : r.length >= 42 ||
        ((st26 === 'single' || st26 === 'combined') && st25 !== 'single' && st25 !== 'combined');
  var off = hasBlock ? 1 : 0;

  return {
    _rowNumber: rowNumber,
    sessionRecordId: ctCellToString_(r[0]),
    sessionId: ctCellToString_(r[1]),
    clientSubmissionKey: ctCellToString_(r[2]),
    facilitatorName: ctCellToString_(r[3]),
    facilitatorEmail: ctCellToString_(r[4]).toLowerCase(),
    facilitatorUserId: ctCellToString_(r[5]),
    tourId: ctCellToString_(r[6]),
    tourName: ctCellToString_(r[7]),
    videoId: ctCellToString_(r[8]),
    language: ctCellToString_(r[9]),
    startDate: ctCellToISODate_(r[10]),
    endDate: ctCellToISODate_(r[11]),
    startTime: ctCellToTime24_(r[12]),
    endTime: ctCellToTime24_(r[13]),
    durationMinutes: ctCellToNumber_(r[14], 0),
    durationFormatted: ctCellToString_(r[15]),
    reportingMonth: ctCellToString_(r[16]),
    submissionTimestamp: ctCellToString_(r[17]),
    submissionDateFormatted: ctCellToString_(r[18]),
    schoolName: ctCellToString_(r[19]),
    udiseCode: ctCellToString_(r[20]),
    schoolType: ctCellToString_(r[21]),
    state: ctCellToString_(r[22]),
    district: ctCellToString_(r[23]),
    pinCode: ctCellToString_(r[24 + off]),
    sessionType: ctCellToString_(r[25 + off]),
    totalClasses: ctCellToNumber_(r[26 + off], 1),
    totalStudentsPresent: ctCellToNumber_(r[27 + off], 0),
    totalQuestionAResponses: ctCellToNumber_(r[28 + off], 0),
    totalQuestionBResponses: ctCellToNumber_(r[29 + off], 0),
    overallCsat: ctCellToNumOrNull_(r[30 + off]),
    overallItp: ctCellToNumOrNull_(r[31 + off]),
    teacherScore: ctCellToNumOrNull_(r[32 + off]),
    teacherClassification: ctCellToString_(r[33 + off]),
    teacherNps: ctCellToNumber_(r[34 + off], 0),
    submissionStatus: ctCellToString_(r[35 + off]),
    createdAt: ctCellToString_(r[36 + off]),
    updatedAt: ctCellToString_(r[37 + off]),
    createdBy: ctCellToString_(r[38 + off]),
    updatedBy: ctCellToString_(r[39 + off]),
    archived: ctCellToBool_(r[40 + off]),
    details: detailsList || []
  };
}

function ctReadAllDetailsGrouped_() {
  var sheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow < 2) return map;

  var rows = sheet.getRange(2, 1, lastRow - 1, DETAIL_COL_COUNT).getValues();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    var d = ctSheetRowToDetailRecord_(r, i + 2);
    if (!map[d.sessionRecordId]) map[d.sessionRecordId] = [];
    map[d.sessionRecordId].push(d);
  }
  return map;
}

function ctReadAllSessionsWithDetails_(ownerEmailFilter) {
  var sheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var layout = ctResolveSessionSheetLayout_(sheet);
  var detailsMap = ctReadAllDetailsGrouped_();
  var rows = sheet.getRange(2, 1, lastRow - 1, layout.colCount).getValues();
  var list = [];
  var targetOwner = ownerEmailFilter ? String(ownerEmailFilter).trim().toLowerCase() : null;

  // Read newest rows first so latest submissions appear first
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (!r[0]) continue;
    var email = ctCellToString_(r[4]).toLowerCase();
    if (targetOwner && email !== targetOwner) continue;
    var recId = ctCellToString_(r[0]);
    var rawDetails = detailsMap[recId] || [];
    var cleanDetails = [];
    for (var j = 0; j < rawDetails.length; j++) {
      var detCopy = JSON.parse(JSON.stringify(rawDetails[j]));
      delete detCopy._rowNumber;
      cleanDetails.push(detCopy);
    }
    var sess = ctSheetRowToSessionRecord_(r, i + 2, cleanDetails, layout.hasBlock);
    list.push(sess);
  }
  return list;
}

function ctStripInternalRowMeta_(sessionRec) {
  var copy = JSON.parse(JSON.stringify(sessionRec));
  delete copy._rowNumber;
  return copy;
}

function ctCreateSessionCore_(actor, rawValues) {
  var config = ctLoadConfiguration_();

  // Enforce verified identity from server auth — ignore forged browser email
  var values = JSON.parse(JSON.stringify(rawValues || {}));
  values.facilitatorEmail = actor.email;
  values.schoolName = String(values.schoolName || '').trim();
  values.udiseCode = String(values.udiseCode || '').trim();
  values.pinCode = String(values.pinCode || '').trim();

  var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
  var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
  var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
  var lastSessionRow = sessionSheet.getLastRow();

  // Read IDs & client keys to check idempotency and guarantee Session ID uniqueness
  var existingSessionIds = {};
  var maxSeq = 0;
  var existingByKeyRecId = null;

  var validation = ctValidateSessionForm_(values, config);
  if (!validation.valid) {
    var errs = [];
    for (var e = 0; e < validation.errors.length; e++) {
      errs.push(validation.errors[e].message);
    }
    throw ctApiError_('VALIDATION_FAILED', errs.join(' '));
  }

  var prefix = ctBuildSessionIdPrefix_(values.startDate, values.udiseCode, values.sessionMode, values.classes);
  if (!prefix) {
    throw ctApiError_('SESSION_ID_ERROR', 'Unable to build Session ID prefix.');
  }

  if (lastSessionRow >= 2) {
    // Columns 1..3 (session_record_id, session_id, client_submission_key) + submission_status column
    var keyRange = sessionSheet.getRange(2, 1, lastSessionRow - 1, 3).getValues();
    var statusCol = sessionSheet.getRange(2, sessionLayout.statusCol, lastSessionRow - 1, 1).getValues();
    for (var i = 0; i < keyRange.length; i++) {
      var sid = ctCellToString_(keyRange[i][1]);
      var cKey = ctCellToString_(keyRange[i][2]);
      var st = ctCellToString_(statusCol[i][0]);
      if (values.clientSubmissionKey && cKey === values.clientSubmissionKey && st !== 'PENDING') {
        existingByKeyRecId = ctCellToString_(keyRange[i][0]);
      }
      if (sid) {
        existingSessionIds[sid] = true;
        if (sid.indexOf(prefix + '_') === 0) {
          var seqPart = parseInt(sid.slice(prefix.length + 1), 10);
          if (!isNaN(seqPart) && seqPart > maxSeq) maxSeq = seqPart;
        }
      }
    }
  }

  if (existingByKeyRecId) {
    var existingRec = ctFindSessionByRecordId_(existingByKeyRecId);
    if (existingRec) {
      return {
        session: ctStripInternalRowMeta_(existingRec),
        warnings: ['Duplicate submission prevented — returned existing record.']
      };
    }
  }

  var candidateSeq = maxSeq + 1;
  var sessionId = ctFormatSessionIdWithSequence_(prefix, candidateSeq);
  while (existingSessionIds[sessionId]) {
    candidateSeq++;
    sessionId = ctFormatSessionIdWithSequence_(prefix, candidateSeq);
  }

  var tour = null;
  for (var tIdx = 0; tIdx < (config.tours || []).length; tIdx++) {
    if (config.tours[tIdx].tourId === values.tourId) {
      tour = config.tours[tIdx];
      break;
    }
  }

  var metrics = ctCalculateSessionMetrics_(values.classes, values.teacherNpsGroup, values.teacherExactScore);
  var durationMinutes =
    ctCalculateSessionDurationMinutes_(values.startDate, values.startTime, values.endDate, values.endTime) || 0;
  var nowIso = ctNowIso_();
  var todayKolkata = ctGetTodayKolkataISO_();
  var sessionRecordId = 'REC_' + Utilities.getUuid().toUpperCase();
  var videoInfo = ctResolveConfiguredVideoId_(tour, values.language);

  var detailRecords = [];
  var detailRows = [];
  for (var cIdx = 0; cIdx < metrics.classBreakdown.length; cIdx++) {
    var c = metrics.classBreakdown[cIdx];
    var detObj = {
      detailRecordId: 'DET_' + sessionRecordId + '_' + (cIdx + 1),
      sessionRecordId: sessionRecordId,
      sessionId: sessionId,
      grade: c.grade,
      section: c.section,
      studentsPresent: c.studentsPresent,
      questionAScore5: c.questionACounts.score5,
      questionAScore4: c.questionACounts.score4,
      questionAScore3: c.questionACounts.score3,
      questionAScore2: c.questionACounts.score2,
      questionAScore1: c.questionACounts.score1,
      questionATotal: c.questionATotal,
      questionAWeightedScore: c.questionAWeighted,
      csat: c.csatAverage,
      questionBScore5: c.questionBCounts.score5,
      questionBScore4: c.questionBCounts.score4,
      questionBScore3: c.questionBCounts.score3,
      questionBScore2: c.questionBCounts.score2,
      questionBScore1: c.questionBCounts.score1,
      questionBTotal: c.questionBTotal,
      questionBWeightedScore: c.questionBWeighted,
      itp: c.itpAverage,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    detailRecords.push(detObj);
    detailRows.push(ctDetailRecordToSheetRow_(detObj));
  }

  var newRecord = {
    sessionRecordId: sessionRecordId,
    sessionId: sessionId,
    clientSubmissionKey: values.clientSubmissionKey || '',
    facilitatorName: String(values.facilitatorName || '').trim(),
    facilitatorEmail: actor.email,
    facilitatorUserId: actor.userId,
    tourId: tour.tourId,
    tourName: tour.tourName,
    videoId: videoInfo.isConfigured ? videoInfo.videoId : 'UNCONFIGURED_VIDEO_ID',
    language: values.language,
    startDate: values.startDate,
    endDate: values.endDate,
    startTime: values.startTime,
    endTime: values.endTime,
    durationMinutes: durationMinutes,
    durationFormatted: ctFormatDurationHuman_(durationMinutes),
    reportingMonth: ctGetMonthNameFromISO_(values.startDate),
    submissionTimestamp: nowIso,
    submissionDateFormatted: ctFormatISODateToDDMMYYYY_(todayKolkata),
    schoolName: values.schoolName,
    udiseCode: values.udiseCode,
    schoolType: values.schoolType,
    state: values.state,
    district: values.district,
    pinCode: values.pinCode,
    sessionType: values.sessionMode,
    totalClasses: metrics.totalClasses,
    totalStudentsPresent: metrics.totalStudentsPresent,
    totalQuestionAResponses: metrics.totalQuestionAResponses,
    totalQuestionBResponses: metrics.totalQuestionBResponses,
    overallCsat: metrics.overallCsat,
    overallItp: metrics.overallItp,
    teacherScore: metrics.teacherScoreExact,
    teacherClassification: metrics.teacherClassification,
    teacherNps: metrics.teacherNps,
    submissionStatus: 'PENDING',
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: actor.email,
    updatedBy: actor.email,
    archived: false,
    details: detailRecords
  };

  // Phase 1: Insert Session master row as PENDING (append single row, never rewrite sheet)
  var targetSessionRowIdx = Math.max(2, ctFindLastPopulatedRow_(sessionSheet, 1) + 1);
  var sessionRowArr = ctSessionRecordToSheetRow_(newRecord, sessionLayout.hasBlock);
  var sessionRange = sessionSheet.getRange(targetSessionRowIdx, 1, 1, sessionLayout.colCount);
  sessionRange.setNumberFormats([
    ctBuildTextFormatRow_(sessionRowArr, sessionLayout.textColumns)
  ]);
  sessionRange.setValues([sessionRowArr]);

  // Phase 2: Insert class detail rows
  var detailStartRow = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
  var detailRange = detailSheet.getRange(detailStartRow, 1, detailRows.length, DETAIL_COL_COUNT);
  var detFormats = [];
  for (var df = 0; df < detailRows.length; df++) {
    detFormats.push(ctBuildTextFormatRow_(detailRows[df], [1, 2, 3, 4, 5]));
  }
  detailRange.setNumberFormats(detFormats);
  detailRange.setValues(detailRows);

  // Verify count before finalizing COMMITTED
  SpreadsheetApp.flush();

  // Phase 3: Promote submission_status cell ONLY from PENDING -> COMMITTED
  sessionSheet.getRange(targetSessionRowIdx, sessionLayout.statusCol).setValue('COMMITTED');
  newRecord.submissionStatus = 'COMMITTED';

  // Phase 4: Upsert School Master without silent overwrite
  var schoolUdiseConflict = ctUpsertSchoolWithoutOverwrite_(values, nowIso);

  var warningMsgs = [];
  for (var w = 0; w < validation.warnings.length; w++) {
    warningMsgs.push(validation.warnings[w].message);
  }

  ctAppendAuditLog_(
    actor,
    'CREATE_SESSION',
    'Session',
    sessionRecordId,
    '',
    'Session ' + sessionId + ' (' + values.district + ', ' + metrics.totalStudentsPresent + ' students)',
    'SUCCESS'
  );
  ctAppendSyncLog_(
    actor,
    values.clientSubmissionKey,
    sessionRecordId,
    sessionId,
    'createSession',
    1,
    'SYNCED',
    ''
  );
  newRecord.syncStatus = 'SYNCED';
  newRecord.syncedAt = nowIso;

  return {
    session: newRecord,
    warnings: warningMsgs,
    schoolUdiseConflict: schoolUdiseConflict
  };
}

function ctHandleCreateSession_(actor, payload) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    return ctCreateSessionCore_(actor, payload && payload.values);
  } finally {
    lock.releaseLock();
  }
}

function ctFindSessionByRecordId_(sessionRecordId) {
  var sheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var layout = ctResolveSessionSheetLayout_(sheet);
  var rows = sheet.getRange(2, 1, lastRow - 1, layout.colCount).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (ctCellToString_(rows[i][0]) === sessionRecordId) {
      var details = ctFindDetailRowsBySessionRecordId_(sessionRecordId);
      var clean = [];
      for (var j = 0; j < details.length; j++) {
        var c = JSON.parse(JSON.stringify(details[j]));
        delete c._rowNumber;
        clean.push(c);
      }
      return ctSheetRowToSessionRecord_(rows[i], i + 2, clean, layout.hasBlock);
    }
  }
  return null;
}

function ctFindDetailRowsBySessionRecordId_(sessionRecordId) {
  var sheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
  var lastRow = sheet.getLastRow();
  var out = [];
  if (lastRow < 2) return out;
  var rows = sheet.getRange(2, 1, lastRow - 1, DETAIL_COL_COUNT).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (ctCellToString_(rows[i][1]) === sessionRecordId) {
      out.push(ctSheetRowToDetailRecord_(rows[i], i + 2));
    }
  }
  return out;
}

function ctHandleUpdateSession_(actor, payload) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var sessionRecordId = String((payload && payload.sessionRecordId) || '').trim();
  if (!sessionRecordId) throw ctApiError_('INVALID_ID', 'sessionRecordId is required.');

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var existing = ctFindSessionByRecordId_(sessionRecordId);
    if (!existing) throw ctApiError_('NOT_FOUND', 'Session record not found.');

    var isAdmin = actor.role === 'super_admin';
    if (!isAdmin && existing.facilitatorEmail !== actor.email) {
      ctAppendAuditLog_(actor, 'UPDATE_SESSION', 'Session', sessionRecordId, '', 'Cross-user update blocked', 'DENIED');
      throw ctApiError_('FORBIDDEN', 'You are not authorized to edit another facilitator’s session.');
    }

    var config = ctLoadConfiguration_();
    var values = JSON.parse(JSON.stringify((payload && payload.values) || {}));
    // Preserve original submission owner
    values.facilitatorEmail = existing.facilitatorEmail;
    values.schoolName = String(values.schoolName || '').trim();
    values.udiseCode = String(values.udiseCode || '').trim();
    values.pinCode = String(values.pinCode || '').trim();

    var validation = ctValidateSessionForm_(values, config);
    if (!validation.valid) {
      var errs = [];
      for (var e = 0; e < validation.errors.length; e++) errs.push(validation.errors[e].message);
      throw ctApiError_('VALIDATION_FAILED', errs.join(' '));
    }

    var tour = null;
    for (var tIdx = 0; tIdx < (config.tours || []).length; tIdx++) {
      if (config.tours[tIdx].tourId === values.tourId) {
        tour = config.tours[tIdx];
        break;
      }
    }

    var metrics = ctCalculateSessionMetrics_(values.classes, values.teacherNpsGroup, values.teacherExactScore);
    var durationMinutes =
      ctCalculateSessionDurationMinutes_(values.startDate, values.startTime, values.endDate, values.endTime) || 0;
    var nowIso = ctNowIso_();
    var videoInfo = ctResolveConfiguredVideoId_(tour, values.language);
    var prevSummary =
      'CSAT=' + existing.overallCsat + ', ITP=' + existing.overallItp + ', Students=' + existing.totalStudentsPresent;

    var updatedDetails = [];
    for (var cIdx = 0; cIdx < metrics.classBreakdown.length; cIdx++) {
      var c = metrics.classBreakdown[cIdx];
      updatedDetails.push({
        detailRecordId: 'DET_' + existing.sessionRecordId + '_' + (cIdx + 1),
        sessionRecordId: existing.sessionRecordId,
        sessionId: existing.sessionId, // Immutable original Session ID preserved
        grade: c.grade,
        section: c.section,
        studentsPresent: c.studentsPresent,
        questionAScore5: c.questionACounts.score5,
        questionAScore4: c.questionACounts.score4,
        questionAScore3: c.questionACounts.score3,
        questionAScore2: c.questionACounts.score2,
        questionAScore1: c.questionACounts.score1,
        questionATotal: c.questionATotal,
        questionAWeightedScore: c.questionAWeighted,
        csat: c.csatAverage,
        questionBScore5: c.questionBCounts.score5,
        questionBScore4: c.questionBCounts.score4,
        questionBScore3: c.questionBCounts.score3,
        questionBScore2: c.questionBCounts.score2,
        questionBScore1: c.questionBCounts.score1,
        questionBTotal: c.questionBTotal,
        questionBWeightedScore: c.questionBWeighted,
        itp: c.itpAverage,
        createdAt: existing.createdAt,
        updatedAt: nowIso
      });
    }

    var updatedRecord = {
      sessionRecordId: existing.sessionRecordId,
      sessionId: existing.sessionId,
      clientSubmissionKey: existing.clientSubmissionKey,
      facilitatorName: String(values.facilitatorName || '').trim(),
      facilitatorEmail: existing.facilitatorEmail,
      facilitatorUserId: existing.facilitatorUserId,
      tourId: tour.tourId,
      tourName: tour.tourName,
      videoId: videoInfo.isConfigured ? videoInfo.videoId : 'UNCONFIGURED_VIDEO_ID',
      language: values.language,
      startDate: values.startDate,
      endDate: values.endDate,
      startTime: values.startTime,
      endTime: values.endTime,
      durationMinutes: durationMinutes,
      durationFormatted: ctFormatDurationHuman_(durationMinutes),
      reportingMonth: ctGetMonthNameFromISO_(values.startDate),
      submissionTimestamp: existing.submissionTimestamp,
      submissionDateFormatted: existing.submissionDateFormatted,
      schoolName: values.schoolName,
      udiseCode: values.udiseCode,
      schoolType: values.schoolType,
      state: values.state,
      district: values.district,
      pinCode: values.pinCode,
      sessionType: values.sessionMode,
      totalClasses: metrics.totalClasses,
      totalStudentsPresent: metrics.totalStudentsPresent,
      totalQuestionAResponses: metrics.totalQuestionAResponses,
      totalQuestionBResponses: metrics.totalQuestionBResponses,
      overallCsat: metrics.overallCsat,
      overallItp: metrics.overallItp,
      teacherScore: metrics.teacherScoreExact,
      teacherClassification: metrics.teacherClassification,
      teacherNps: metrics.teacherNps,
      submissionStatus: isAdmin ? 'CORRECTED' : 'COMMITTED',
      createdAt: existing.createdAt,
      updatedAt: nowIso,
      createdBy: existing.createdBy,
      updatedBy: actor.email,
      archived: existing.archived,
      details: updatedDetails
    };

    // Row-level update ONLY on the matched Sessions row
    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
    var sessionRowArr = ctSessionRecordToSheetRow_(updatedRecord, sessionLayout.hasBlock);
    var sessionRange = sessionSheet.getRange(existing._rowNumber, 1, 1, sessionLayout.colCount);
    sessionRange.setNumberFormats([
      ctBuildTextFormatRow_(sessionRowArr, sessionLayout.textColumns)
    ]);
    sessionRange.setValues([sessionRowArr]);

    // Row-level sync on Session Details rows belonging to this sessionRecordId
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var existingDetailRows = ctFindDetailRowsBySessionRecordId_(sessionRecordId);
    var minLen = Math.min(existingDetailRows.length, updatedDetails.length);

    for (var u = 0; u < minLen; u++) {
      var uArr = ctDetailRecordToSheetRow_(updatedDetails[u]);
      var uRange = detailSheet.getRange(existingDetailRows[u]._rowNumber, 1, 1, DETAIL_COL_COUNT);
      uRange.setNumberFormats([ctBuildTextFormatRow_(uArr, [1, 2, 3, 4, 5])]);
      uRange.setValues([uArr]);
    }
    if (updatedDetails.length > existingDetailRows.length) {
      var toAppend = [];
      var toAppendFmt = [];
      for (var a = existingDetailRows.length; a < updatedDetails.length; a++) {
        var aArr = ctDetailRecordToSheetRow_(updatedDetails[a]);
        toAppend.push(aArr);
        toAppendFmt.push(ctBuildTextFormatRow_(aArr, [1, 2, 3, 4, 5]));
      }
      var appendStart = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
      var appRange = detailSheet.getRange(appendStart, 1, toAppend.length, DETAIL_COL_COUNT);
      appRange.setNumberFormats(toAppendFmt);
      appRange.setValues(toAppend);
    } else if (existingDetailRows.length > updatedDetails.length) {
      // Delete excess rows bottom-up to preserve row indices
      for (var d = existingDetailRows.length - 1; d >= updatedDetails.length; d--) {
        detailSheet.deleteRow(existingDetailRows[d]._rowNumber);
      }
    }

    var warningMsgs = [];
    for (var w = 0; w < validation.warnings.length; w++) {
      warningMsgs.push(validation.warnings[w].message);
    }

    ctAppendAuditLog_(
      actor,
      isAdmin ? 'ADMIN_CORRECT_SESSION' : 'UPDATE_SESSION',
      'Session',
      sessionRecordId,
      prevSummary,
      'CSAT=' + updatedRecord.overallCsat + ', ITP=' + updatedRecord.overallItp + ', Students=' + updatedRecord.totalStudentsPresent,
      'SUCCESS'
    );
    ctAppendSyncLog_(
      actor,
      updatedRecord.clientSubmissionKey || '',
      sessionRecordId,
      updatedRecord.sessionId,
      'updateSession',
      1,
      'SYNCED',
      ''
    );
    updatedRecord.syncStatus = 'SYNCED';
    updatedRecord.syncedAt = nowIso;

    return { session: updatedRecord, warnings: warningMsgs };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleArchiveSession_(actor, payload) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var sessionRecordId = String((payload && payload.sessionRecordId) || '').trim();
  if (!sessionRecordId) throw ctApiError_('INVALID_ID', 'sessionRecordId is required.');

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var existing = ctFindSessionByRecordId_(sessionRecordId);
    if (!existing) throw ctApiError_('NOT_FOUND', 'Session record not found.');

    var config = ctLoadConfiguration_();
    var isAdmin = actor.role === 'super_admin';
    if (!isAdmin) {
      if (existing.facilitatorEmail !== actor.email) {
        ctAppendAuditLog_(actor, 'ARCHIVE_SESSION', 'Session', sessionRecordId, '', 'Cross-user archive blocked', 'DENIED');
        throw ctApiError_('FORBIDDEN', 'Cannot archive another facilitator’s session.');
      }
      if (!config.policy.allowFacilitatorDeleteOwn) {
        throw ctApiError_('POLICY_RESTRICTED', 'Facilitator deletion is disabled by administrator policy.');
      }
    }

    var sheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var layout = ctResolveSessionSheetLayout_(sheet);
    var nowIso = ctNowIso_();
    // updated_at, updated_by, archived (single-row cells; header-aware for 41-col & legacy 42-col sheets)
    sheet.getRange(existing._rowNumber, layout.updatedAtCol).setValue(nowIso);
    sheet.getRange(existing._rowNumber, layout.updatedByCol).setValue(actor.email);
    sheet.getRange(existing._rowNumber, layout.archivedCol).setNumberFormat('@').setValue('true');

    ctAppendAuditLog_(actor, 'ARCHIVE_SESSION', 'Session', sessionRecordId, 'archived=false', 'archived=true', 'SUCCESS');
    ctAppendSyncLog_(actor, existing.clientSubmissionKey || '', sessionRecordId, existing.sessionId, 'archiveSession', 1, 'SYNCED', '');
    return { archived: true };
  } finally {
    lock.releaseLock();
  }
}

function ctDeleteRowsDescending_(sheet, rowNumbers) {
  if (!rowNumbers || rowNumbers.length === 0) return;
  var seen = {};
  var unique = [];
  for (var i = 0; i < rowNumbers.length; i++) {
    var num = Number(rowNumbers[i]);
    if (num >= 2 && !seen[num]) {
      seen[num] = true;
      unique.push(num);
    }
  }
  unique.sort(function (a, b) { return b - a; });
  for (var j = 0; j < unique.length; j++) {
    sheet.deleteRow(unique[j]);
  }
}

function ctHandleRestoreSession_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var sessionRecordId = String((payload && payload.sessionRecordId) || '').trim();
  if (!sessionRecordId) throw ctApiError_('INVALID_ID', 'sessionRecordId is required.');

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var existing = ctFindSessionByRecordId_(sessionRecordId);
    if (!existing) throw ctApiError_('NOT_FOUND', 'Session record not found.');

    var sheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var layout = ctResolveSessionSheetLayout_(sheet);
    var nowIso = ctNowIso_();
    sheet.getRange(existing._rowNumber, layout.updatedAtCol).setValue(nowIso);
    sheet.getRange(existing._rowNumber, layout.updatedByCol).setValue(actor.email);
    sheet.getRange(existing._rowNumber, layout.archivedCol).setNumberFormat('@').setValue('false');

    ctAppendAuditLog_(actor, 'RESTORE_SESSION', 'Session', sessionRecordId, 'archived=true', 'archived=false', 'SUCCESS');
    ctAppendSyncLog_(actor, existing.clientSubmissionKey || '', sessionRecordId, existing.sessionId, 'restoreSession', 1, 'SYNCED', '');
    return { archived: false };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleDeleteSession_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var sessionRecordId = String((payload && payload.sessionRecordId) || '').trim();
  if (!sessionRecordId) throw ctApiError_('INVALID_ID', 'sessionRecordId is required.');

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var existing = ctFindSessionByRecordId_(sessionRecordId);
    if (!existing) throw ctApiError_('NOT_FOUND', 'Session record not found.');

    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var detailRows = ctFindDetailRowsBySessionRecordId_(sessionRecordId);
    var detailRowNums = [];
    for (var i = 0; i < detailRows.length; i++) {
      detailRowNums.push(detailRows[i]._rowNumber);
    }

    ctDeleteRowsDescending_(detailSheet, detailRowNums);
    ctDeleteRowsDescending_(sessionSheet, [existing._rowNumber]);

    var prevSummary =
      'Session ' + existing.sessionId + ' (' + existing.schoolName + ', ' + existing.totalStudentsPresent + ' students, ' + detailRowNums.length + ' detail rows)';
    ctAppendAuditLog_(actor, 'DELETE_SESSION', 'Session', sessionRecordId, prevSummary, 'Permanently deleted', 'SUCCESS');
    ctAppendSyncLog_(actor, existing.clientSubmissionKey || '', sessionRecordId, existing.sessionId, 'deleteSession', 1, 'SYNCED', '');
    return { deleted: true, deletedDetailsCount: detailRowNums.length };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleBulkDeleteSessions_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var rawIds = payload && payload.sessionRecordIds;
  if (!Array.isArray(rawIds)) {
    throw ctApiError_('INVALID_ID', 'sessionRecordIds must be an array.');
  }

  var targetIdMap = {};
  var requestedIds = [];
  for (var i = 0; i < rawIds.length; i++) {
    var cleanId = String(rawIds[i] || '').trim();
    if (cleanId && !targetIdMap[cleanId]) {
      targetIdMap[cleanId] = true;
      requestedIds.push(cleanId);
    }
  }
  if (requestedIds.length === 0) {
    throw ctApiError_('INVALID_ID', 'At least one sessionRecordId is required.');
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var lastSessionRow = sessionSheet.getLastRow();
    var matchedSessionRowNums = [];
    var matchedRecordIdMap = {};
    var matchedSessionIds = [];

    if (lastSessionRow >= 2) {
      var sessRows = sessionSheet.getRange(2, 1, lastSessionRow - 1, 2).getValues();
      for (var sIdx = 0; sIdx < sessRows.length; sIdx++) {
        var recId = ctCellToString_(sessRows[sIdx][0]);
        if (recId && targetIdMap[recId]) {
          matchedRecordIdMap[recId] = true;
          matchedSessionRowNums.push(sIdx + 2);
          matchedSessionIds.push(ctCellToString_(sessRows[sIdx][1]) || recId);
        }
      }
    }

    if (matchedSessionRowNums.length === 0) {
      throw ctApiError_('NOT_FOUND', 'No matching session records found.');
    }

    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var lastDetailRow = detailSheet.getLastRow();
    var matchedDetailRowNums = [];
    if (lastDetailRow >= 2) {
      var detRows = detailSheet.getRange(2, 1, lastDetailRow - 1, 2).getValues();
      for (var dIdx = 0; dIdx < detRows.length; dIdx++) {
        var parentId = ctCellToString_(detRows[dIdx][1]);
        if (parentId && matchedRecordIdMap[parentId]) {
          matchedDetailRowNums.push(dIdx + 2);
        }
      }
    }

    ctDeleteRowsDescending_(detailSheet, matchedDetailRowNums);
    ctDeleteRowsDescending_(sessionSheet, matchedSessionRowNums);

    var summaryIds = matchedSessionIds.slice(0, 10).join(', ') + (matchedSessionIds.length > 10 ? ' (+' + (matchedSessionIds.length - 10) + ' more)' : '');
    ctAppendAuditLog_(
      actor,
      'BULK_DELETE_SESSIONS',
      'Session',
      'BULK',
      summaryIds,
      'Deleted ' + matchedSessionRowNums.length + ' session(s) and ' + matchedDetailRowNums.length + ' detail row(s)',
      'SUCCESS'
    );
    ctAppendSyncLog_(
      actor,
      'BULK_DELETE',
      String(matchedSessionRowNums.length),
      summaryIds,
      'bulkDeleteSessions',
      1,
      'SYNCED',
      ''
    );

    return {
      deletedCount: matchedSessionRowNums.length,
      deletedDetailsCount: matchedDetailRowNums.length
    };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleGetSessionById_(actor, payload) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var sessionRecordId = String((payload && payload.sessionRecordId) || '').trim();
  var found = ctFindSessionByRecordId_(sessionRecordId);
  if (!found) throw ctApiError_('NOT_FOUND', 'Session record not found.');

  var isAdmin = actor.role === 'super_admin';
  if (!isAdmin && found.facilitatorEmail !== actor.email) {
    ctAppendAuditLog_(actor, 'VIEW_SESSION', 'Session', sessionRecordId, '', 'Unauthorized read blocked', 'DENIED');
    throw ctApiError_('FORBIDDEN', 'Access denied.');
  }
  return ctStripInternalRowMeta_(found);
}

function ctApplySessionFilters_(rows, filters, config) {
  var f = filters || {};
  var allowed = config.allowedDistricts || [];
  var out = [];
  var qSearch = String(f.search || '').trim().toLowerCase();
  var qSchool = String(f.school || '').trim().toLowerCase();
  var qFac = String(f.facilitatorEmail || '').trim().toLowerCase();

  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    if (!f.includeArchived && s.archived) continue;
    if (s.submissionStatus === 'PENDING') continue;
    if (!ctArrayIncludes_(allowed, s.district)) continue;

    if (f.district && s.district !== f.district) continue;
    if (qSchool && s.schoolName.toLowerCase().indexOf(qSchool) === -1) continue;
    if (qFac && s.facilitatorEmail.toLowerCase() !== qFac) continue;
    if (f.tourId && s.tourId !== f.tourId) continue;
    if (f.language && s.language !== f.language) continue;
    if (f.status && s.submissionStatus !== f.status) continue;
    if (f.dateFrom && s.startDate < f.dateFrom) continue;
    if (f.dateTo && s.startDate > f.dateTo) continue;

    if (f.grade) {
      var hasGrade = false;
      for (var g = 0; g < s.details.length; g++) {
        if (String(s.details[g].grade) === String(f.grade)) {
          hasGrade = true;
          break;
        }
      }
      if (!hasGrade) continue;
    }

    if (qSearch) {
      var hay = (s.sessionId + ' ' + s.schoolName + ' ' + s.udiseCode + ' ' + s.facilitatorName).toLowerCase();
      if (hay.indexOf(qSearch) === -1) continue;
    }

    out.push(ctStripInternalRowMeta_(s));
  }
  return out;
}

function ctPaginateArray_(items, page, pageSize) {
  var safeSize = Math.max(1, Math.min(Number(pageSize) || 15, 100));
  var total = items.length;
  var totalPages = Math.max(1, Math.ceil(total / safeSize));
  var safePage = Math.max(1, Math.min(Number(page) || 1, totalPages));
  var start = (safePage - 1) * safeSize;
  return {
    items: items.slice(start, start + safeSize),
    total: total,
    page: safePage,
    pageSize: safeSize,
    totalPages: totalPages
  };
}

function ctHandleGetMySessions_(actor, payload) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var config = ctLoadConfiguration_();
  var filters = (payload && payload.filters) || {};
  // Facilitators are strictly scoped to their own verified email
  var ownRows = ctReadAllSessionsWithDetails_(actor.email);
  var filtered = ctApplySessionFilters_(ownRows, filters, config);
  return ctPaginateArray_(filtered, filters.page, filters.pageSize || 10);
}

function ctHandleGetAdminSessions_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var config = ctLoadConfiguration_();
  var filters = (payload && payload.filters) || {};
  var allRows = ctReadAllSessionsWithDetails_(null);
  var filtered = ctApplySessionFilters_(allRows, filters, config);
  return ctPaginateArray_(filtered, filters.page, filters.pageSize || 15);
}

/**
 * Computes full structural health & recovery metrics across Sessions, Session Details, and Schools.
 * When \`optPerformRepair\` is true, promotes recoverable PENDING sessions (whose detail rows are
 * complete) to COMMITTED and inserts missing canonical Schools rows without overwriting existing ones.
 */
function ctBuildDatabaseHealth_(optPerformRepair, optActor) {
  var sheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
  var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
  var schoolSheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var performRepair = Boolean(optPerformRepair);

  var totalSessions = 0;
  var committedCount = 0;
  var correctedCount = 0;
  var pendingCount = 0;
  var recoverablePendingCount = 0;
  var archivedCount = 0;
  var promotedPendingCount = 0;
  var orphanPendingCount = 0;
  var orphanDetailRowCount = 0;
  var duplicateSessionIds = [];
  var duplicateRecordIds = [];
  var missingSchoolMasterUdise = [];
  var repairedSchoolMasters = 0;

  var detailsMap = ctReadAllDetailsGrouped_();
  var sessionRecordIds = {};
  var seenSessionIds = {};
  var seenRecordIds = {};
  var duplicateSessionIdMap = {};
  var duplicateRecordIdMap = {};
  var committedSessions = [];

  var lastSessionRow = sheet.getLastRow();
  if (lastSessionRow >= 2) {
    var layout = ctResolveSessionSheetLayout_(sheet);
    var rows = sheet.getRange(2, 1, lastSessionRow - 1, layout.colCount).getValues();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var recId = ctCellToString_(r[0]);
      var sessId = ctCellToString_(r[1]);
      if (!recId && !sessId) continue;

      totalSessions++;
      if (recId) {
        if (seenRecordIds[recId] && !duplicateRecordIdMap[recId]) {
          duplicateRecordIdMap[recId] = true;
          duplicateRecordIds.push(recId);
        }
        seenRecordIds[recId] = true;
        sessionRecordIds[recId] = true;
      }
      if (sessId) {
        if (seenSessionIds[sessId] && !duplicateSessionIdMap[sessId]) {
          duplicateSessionIdMap[sessId] = true;
          duplicateSessionIds.push(sessId);
        }
        seenSessionIds[sessId] = true;
      }

      var status = ctCellToString_(r[layout.statusIdx]);
      var archived = ctCellToBool_(r[40 + (layout.hasBlock ? 1 : 0)]);
      if (archived) archivedCount++;

      if (status === 'PENDING') {
        pendingCount++;
        var expectedClasses = ctCellToNumber_(r[layout.totalClassesIdx], 1);
        var actualDetails = (detailsMap[recId] || []).length;
        if (recId && actualDetails === expectedClasses && expectedClasses > 0) {
          recoverablePendingCount++;
          if (performRepair) {
            sheet.getRange(i + 2, layout.statusCol).setValue('COMMITTED');
            promotedPendingCount++;
            pendingCount--;
            committedCount++;
            recoverablePendingCount--;
            status = 'COMMITTED';
          }
        } else {
          orphanPendingCount++;
        }
      } else if (status === 'CORRECTED') {
        correctedCount++;
      } else {
        committedCount++;
      }

      if (!archived && status !== 'PENDING') {
        committedSessions.push(ctSheetRowToSessionRecord_(r, i + 2, [], layout.hasBlock));
      }
    }
  }

  var lastDetailRow = detailSheet.getLastRow();
  if (lastDetailRow >= 2) {
    var detRows = detailSheet.getRange(2, 1, lastDetailRow - 1, 2).getValues();
    for (var dIdx = 0; dIdx < detRows.length; dIdx++) {
      var detId = ctCellToString_(detRows[dIdx][0]);
      var parentRecId = ctCellToString_(detRows[dIdx][1]);
      if (!detId && !parentRecId) continue;
      if (!parentRecId || !sessionRecordIds[parentRecId]) {
        orphanDetailRowCount++;
      }
    }
  }

  var existingUdises = {};
  var lastSchoolRow = schoolSheet.getLastRow();
  if (lastSchoolRow >= 2) {
    var schLayout = ctResolveSchoolSheetLayout_(schoolSheet);
    var schRows = schoolSheet.getRange(2, 1, lastSchoolRow - 1, schLayout.colCount).getValues();
    for (var sIdx = 0; sIdx < schRows.length; sIdx++) {
      var uCode = ctCellToString_(schRows[sIdx][2]);
      if (uCode) existingUdises[uCode] = true;
    }
  }

  var nowIso = ctNowIso_();
  var seenMissingUdises = {};
  for (var cs = 0; cs < committedSessions.length; cs++) {
    var csRec = committedSessions[cs];
    if (!csRec.udiseCode || existingUdises[csRec.udiseCode] || seenMissingUdises[csRec.udiseCode]) {
      continue;
    }
    seenMissingUdises[csRec.udiseCode] = true;
    if (performRepair) {
      ctUpsertSchoolWithoutOverwrite_(csRec, nowIso);
      existingUdises[csRec.udiseCode] = true;
      repairedSchoolMasters++;
    } else {
      missingSchoolMasterUdise.push(csRec.udiseCode);
    }
  }

  if (performRepair && (promotedPendingCount > 0 || repairedSchoolMasters > 0)) {
    ctAppendAuditLog_(
      optActor || { userId: 'SYSTEM_RECOVERY', email: 'SYSTEM_RECOVERY' },
      'DATABASE_RECOVERY',
      'Session',
      'HEALTH',
      '',
      'Promoted ' +
        promotedPendingCount +
        ' COMPLETE PENDING session(s) and restored ' +
        repairedSchoolMasters +
        ' missing School master record(s)',
      'SUCCESS'
    );
    try {
      var ssRec = ctGetSpreadsheet_();
      var cfgRec = ctLoadConfiguration_();
      if (typeof ctRefreshSummaryAndKpisSheet_ === 'function') ctRefreshSummaryAndKpisSheet_(ssRec, cfgRec);
    } catch (ignoreRef) {}
  }

  var healthy =
    pendingCount === 0 &&
    orphanPendingCount === 0 &&
    orphanDetailRowCount === 0 &&
    duplicateSessionIds.length === 0 &&
    duplicateRecordIds.length === 0 &&
    missingSchoolMasterUdise.length === 0;

  return {
    healthy: healthy,
    totalSessions: totalSessions,
    committedCount: committedCount,
    correctedCount: correctedCount,
    pendingCount: pendingCount,
    recoverablePendingCount: recoverablePendingCount,
    archivedCount: archivedCount,
    promotedPendingCount: promotedPendingCount,
    orphanPendingCount: orphanPendingCount,
    orphanDetailRowCount: orphanDetailRowCount,
    duplicateSessionIds: duplicateSessionIds,
    duplicateRecordIds: duplicateRecordIds,
    missingSchoolMasterUdise: missingSchoolMasterUdise,
    repairedSchoolMasters: repairedSchoolMasters,
    checkedAt: nowIso
  };
}

function ctHandleGetDatabaseHealth_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  return ctBuildDatabaseHealth_(false, actor);
}

function ctHandleRecoverPendingSessions_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    return ctBuildDatabaseHealth_(true, actor);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Administrative diagnostic helper to inspect stale PENDING sessions if an execution crashed mid-write.
 */
function recoverPendingSessions() {
  var sheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
  if (sheet.getLastRow() < 2) return 'No session rows exist.';
  var res = ctBuildDatabaseHealth_(true, null);
  return (
    'Recovered COMPLETE pending rows: ' +
    res.promotedPendingCount +
    '; Incomplete pending rows: ' +
    (res.orphanPendingCount || 'none') +
    '; Repaired school masters: ' +
    res.repairedSchoolMasters
  );
}

// ============================================================================
// Module: Admin.gs
// ============================================================================

/**
 * Admin.gs — Server-side analytics aggregation and user/role management.
 */

var QA_LABELS = {
  5: 'Loved it',
  4: 'Liked it',
  3: 'It was okay',
  2: "Didn't like it much",
  1: "Didn't like it at all"
};

var QB_LABELS = {
  5: 'Extremely interested',
  4: 'Very interested',
  3: 'Moderately interested',
  2: 'Slightly interested',
  1: 'Not at all interested'
};

function ctEmptyCountsObj_() {
  return { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 };
}

function ctAddCountsTo_(target, s5, s4, s3, s2, s1) {
  target.score5 += Number(s5 || 0);
  target.score4 += Number(s4 || 0);
  target.score3 += Number(s3 || 0);
  target.score2 += Number(s2 || 0);
  target.score1 += Number(s1 || 0);
}

function ctFormatMonthLabel_(monthKey) {
  var m = /^(\\d{4})-(\\d{2})$/.exec(monthKey || '');
  if (!m) return monthKey || 'Unknown';
  var idx = parseInt(m[2], 10) - 1;
  return (CT_MONTH_NAMES[idx] || m[2]) + ' ' + m[1];
}

function ctReconcileServerSummary_(filtered, analytics) {
  var discrepancies = [];
  var checksRun = 0;
  var rawStudentsDetails = 0;
  var rawQaTotal = 0;
  var rawQaWeighted = 0;
  var rawQbTotal = 0;
  var rawQbWeighted = 0;
  var rawNpsSum = 0;
  var rawMissingQa = 0;
  var rawSchools = {};

  for (var i = 0; i < filtered.length; i++) {
    var s = filtered[i];
    rawNpsSum += s.teacherNps;
    rawSchools[s.udiseCode] = true;
    for (var j = 0; j < s.details.length; j++) {
      var d = s.details[j];
      rawStudentsDetails += d.studentsPresent;
      var qat = d.questionAScore5 + d.questionAScore4 + d.questionAScore3 + d.questionAScore2 + d.questionAScore1;
      var qaw = 5 * d.questionAScore5 + 4 * d.questionAScore4 + 3 * d.questionAScore3 + 2 * d.questionAScore2 + d.questionAScore1;
      var qbt = d.questionBScore5 + d.questionBScore4 + d.questionBScore3 + d.questionBScore2 + d.questionBScore1;
      var qbw = 5 * d.questionBScore5 + 4 * d.questionBScore4 + 3 * d.questionBScore3 + 2 * d.questionBScore2 + d.questionBScore1;
      rawQaTotal += qat;
      rawQaWeighted += qaw;
      rawQbTotal += qbt;
      rawQbWeighted += qbw;
      rawMissingQa += Math.max(0, d.studentsPresent - qat);
    }
  }

  checksRun++;
  if (analytics.totalSessions !== filtered.length) discrepancies.push('Session count mismatch');
  checksRun++;
  if (analytics.totalStudentsReached !== rawStudentsDetails) discrepancies.push('Student count mismatch');
  checksRun++;
  if (analytics.totalSchoolsCovered !== Object.keys(rawSchools).length) discrepancies.push('School count mismatch');
  checksRun++;
  var expCsat = rawQaTotal > 0 ? ctRound2_(rawQaWeighted / rawQaTotal) : null;
  if (analytics.averageCsat !== expCsat || analytics.totalQuestionAResponses !== rawQaTotal) discrepancies.push('CSAT mismatch');
  checksRun++;
  var expItp = rawQbTotal > 0 ? ctRound2_(rawQbWeighted / rawQbTotal) : null;
  if (analytics.averageItp !== expItp || analytics.totalQuestionBResponses !== rawQbTotal) discrepancies.push('ITP mismatch');
  checksRun++;
  var expNps = filtered.length > 0 ? ctRound2_(rawNpsSum / filtered.length) : null;
  if (analytics.teacherNpsAverage !== expNps) discrepancies.push('Teacher NPS mismatch');
  checksRun++;
  if (analytics.totalMissingResponsesQA !== rawMissingQa) discrepancies.push('Missing QA count mismatch');

  return {
    verified: discrepancies.length === 0,
    checkedAt: ctNowIso_(),
    checksRun: checksRun,
    discrepancies: discrepancies
  };
}

function ctHandleGetDashboardSummary_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var config = ctLoadConfiguration_();
  var filters = (payload && payload.filters) || {};
  var allRows = ctReadAllSessionsWithDetails_(null);
  var allowed = config.allowedDistricts || [];
  var excludedPendingCount = 0;
  for (var p = 0; p < allRows.length; p++) {
    if (!allRows[p].archived && (allRows[p].submissionStatus === 'PENDING' || !ctArrayIncludes_(allowed, allRows[p].district))) {
      excludedPendingCount++;
    }
  }

  var filtered = ctApplySessionFilters_(allRows, filters, config);

  var totalSessions = filtered.length;
  var totalStudentsReached = 0;
  var uniqueSchools = {};
  var uniqueFacs = {};

  var pooledQA = ctEmptyCountsObj_();
  var pooledQB = ctEmptyCountsObj_();
  var totalMissingQa = 0;
  var totalMissingQb = 0;
  var totalClassRows = 0;
  var lowCoverageSessionsCount = 0;
  var qaQbMismatchCount = 0;
  var unconfiguredVideoCount = 0;
  var npsSum = 0;

  var csatCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  var itpCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  var npsDist = { promoter: 0, passive: 0, detractor: 0 };

  function makeGroup() {
    return {
      sessions: 0,
      students: 0,
      qaCounts: ctEmptyCountsObj_(),
      qbCounts: ctEmptyCountsObj_(),
      missingQa: 0,
      missingQb: 0,
      npsSum: 0
    };
  }

  var districtMap = {};
  for (var dIdx = 0; dIdx < allowed.length; dIdx++) {
    var dObj = makeGroup();
    dObj.schools = {};
    districtMap[allowed[dIdx]] = dObj;
  }

  var schoolMap = {};
  var monthMap = {};
  var tourMap = {};
  var languageMap = {};
  var gradeMap = {};
  var dateMap = {};
  var facMap = {};

  for (var i = 0; i < filtered.length; i++) {
    var s = filtered[i];
    uniqueSchools[s.udiseCode] = true;
    uniqueFacs[s.facilitatorEmail] = true;
    npsSum += s.teacherNps;

    if (s.teacherClassification === 'Promoter') npsDist.promoter++;
    else if (s.teacherClassification === 'Passive') npsDist.passive++;
    else npsDist.detractor++;

    if (!s.videoId || s.videoId === 'UNCONFIGURED_VIDEO_ID') unconfiguredVideoCount++;

    var dAgg = districtMap[s.district];
    if (dAgg) {
      dAgg.sessions++;
      dAgg.schools[s.udiseCode] = true;
      dAgg.npsSum += s.teacherNps;
    }

    if (!schoolMap[s.udiseCode]) {
      var scInit = makeGroup();
      scInit.udiseCode = s.udiseCode;
      scInit.schoolName = s.schoolName;
      scInit.district = s.district;
      schoolMap[s.udiseCode] = scInit;
    }
    var scAgg = schoolMap[s.udiseCode];
    scAgg.sessions++;
    scAgg.schoolName = s.schoolName;
    scAgg.npsSum += s.teacherNps;

    var monthKey = /^\\d{4}-\\d{2}/.test(s.startDate) ? s.startDate.slice(0, 7) : 'Unknown';
    if (!monthMap[monthKey]) {
      var mInit = makeGroup();
      mInit.schools = {};
      mInit.facilitators = {};
      monthMap[monthKey] = mInit;
    }
    var mAgg = monthMap[monthKey];
    mAgg.sessions++;
    mAgg.schools[s.udiseCode] = true;
    mAgg.facilitators[s.facilitatorEmail] = true;
    mAgg.npsSum += s.teacherNps;

    if (!tourMap[s.tourId]) {
      var tInit = makeGroup();
      tInit.tourName = s.tourName;
      tInit.schools = {};
      tourMap[s.tourId] = tInit;
    }
    var tAgg = tourMap[s.tourId];
    tAgg.sessions++;
    tAgg.schools[s.udiseCode] = true;
    tAgg.npsSum += s.teacherNps;

    if (!languageMap[s.language]) languageMap[s.language] = makeGroup();
    var lAgg = languageMap[s.language];
    lAgg.sessions++;
    lAgg.npsSum += s.teacherNps;

    if (!dateMap[s.startDate]) dateMap[s.startDate] = { sessions: 0, students: 0 };
    dateMap[s.startDate].sessions++;

    if (!facMap[s.facilitatorEmail]) {
      var fInit = makeGroup();
      fInit.name = s.facilitatorName;
      fInit.latest = s.submissionTimestamp;
      fInit.schools = {};
      facMap[s.facilitatorEmail] = fInit;
    }
    var fAgg = facMap[s.facilitatorEmail];
    fAgg.sessions++;
    fAgg.schools[s.udiseCode] = true;
    fAgg.npsSum += s.teacherNps;
    if (s.submissionTimestamp > fAgg.latest) fAgg.latest = s.submissionTimestamp;

    var sessStudents = 0;
    var sessQa = 0;
    var sessQb = 0;

    for (var j = 0; j < s.details.length; j++) {
      var det = s.details[j];
      totalClassRows++;
      var present = det.studentsPresent;
      var qaTot = det.questionATotal;
      var qbTot = det.questionBTotal;
      var missQa = Math.max(0, present - qaTot);
      var missQb = Math.max(0, present - qbTot);

      sessStudents += present;
      sessQa += qaTot;
      sessQb += qbTot;

      totalStudentsReached += present;
      totalMissingQa += missQa;
      totalMissingQb += missQb;

      ctAddCountsTo_(pooledQA, det.questionAScore5, det.questionAScore4, det.questionAScore3, det.questionAScore2, det.questionAScore1);
      ctAddCountsTo_(pooledQB, det.questionBScore5, det.questionBScore4, det.questionBScore3, det.questionBScore2, det.questionBScore1);

      var targets = [scAgg, mAgg, tAgg, lAgg, fAgg];
      if (dAgg) targets.push(dAgg);
      for (var tg = 0; tg < targets.length; tg++) {
        targets[tg].students += present;
        targets[tg].missingQa += missQa;
        targets[tg].missingQb += missQb;
        ctAddCountsTo_(targets[tg].qaCounts, det.questionAScore5, det.questionAScore4, det.questionAScore3, det.questionAScore2, det.questionAScore1);
        ctAddCountsTo_(targets[tg].qbCounts, det.questionBScore5, det.questionBScore4, det.questionBScore3, det.questionBScore2, det.questionBScore1);
      }

      if (!gradeMap[det.grade]) {
        var gInit = makeGroup();
        gInit.classesCount = 0;
        gradeMap[det.grade] = gInit;
      }
      var gAgg = gradeMap[det.grade];
      gAgg.classesCount++;
      gAgg.students += present;
      gAgg.missingQa += missQa;
      gAgg.missingQb += missQb;
      ctAddCountsTo_(gAgg.qaCounts, det.questionAScore5, det.questionAScore4, det.questionAScore3, det.questionAScore2, det.questionAScore1);
      ctAddCountsTo_(gAgg.qbCounts, det.questionBScore5, det.questionBScore4, det.questionBScore3, det.questionBScore2, det.questionBScore1);

      csatCounts[5] += det.questionAScore5;
      csatCounts[4] += det.questionAScore4;
      csatCounts[3] += det.questionAScore3;
      csatCounts[2] += det.questionAScore2;
      csatCounts[1] += det.questionAScore1;

      itpCounts[5] += det.questionBScore5;
      itpCounts[4] += det.questionBScore4;
      itpCounts[3] += det.questionBScore3;
      itpCounts[2] += det.questionBScore2;
      itpCounts[1] += det.questionBScore1;
    }

    dateMap[s.startDate].students += sessStudents;
    if (sessQa !== sessQb) qaQbMismatchCount++;
    if (sessStudents > 0) {
      if ((sessQa / sessStudents) * 100 < 75 || (sessQb / sessStudents) * 100 < 75) {
        lowCoverageSessionsCount++;
      }
    }
  }

  var qaSentiment = ctCalculateScaleSentiment_(pooledQA);
  var qbSentiment = ctCalculateScaleSentiment_(pooledQB);

  var districtBreakdown = [];
  for (var dd = 0; dd < allowed.length; dd++) {
    var dName = allowed[dd];
    var dv = districtMap[dName];
    var dQa = ctCalculateScaleSentiment_(dv.qaCounts);
    var dQb = ctCalculateScaleSentiment_(dv.qbCounts);
    districtBreakdown.push({
      district: dName,
      sessions: dv.sessions,
      studentsReached: dv.students,
      schoolsCount: Object.keys(dv.schools).length,
      qaResponses: dQa.total,
      qbResponses: dQb.total,
      missingResponsesQa: dv.missingQa,
      averageCsat: dQa.average,
      averageItp: dQb.average,
      positiveCsatPct: dQa.positivePct,
      positiveItpPct: dQb.positivePct
    });
  }

  var schoolBreakdown = [];
  for (var scId in schoolMap) {
    var sv = schoolMap[scId];
    var sQa = ctCalculateScaleSentiment_(sv.qaCounts);
    var sQb = ctCalculateScaleSentiment_(sv.qbCounts);
    schoolBreakdown.push({
      udiseCode: sv.udiseCode,
      schoolName: sv.schoolName,
      district: sv.district,
      sessions: sv.sessions,
      studentsReached: sv.students,
      qaResponses: sQa.total,
      qbResponses: sQb.total,
      missingResponsesQa: sv.missingQa,
      missingResponsesQb: sv.missingQb,
      averageCsat: sQa.average,
      averageItp: sQb.average,
      positiveCsatPct: sQa.positivePct,
      positiveItpPct: sQb.positivePct
    });
  }
  schoolBreakdown.sort(function (a, b) {
    return b.studentsReached - a.studentsReached || a.schoolName.localeCompare(b.schoolName);
  });

  var monthKeys = Object.keys(monthMap).sort();
  var monthlyBreakdown = [];
  for (var mk = 0; mk < monthKeys.length; mk++) {
    var mKey = monthKeys[mk];
    var mv = monthMap[mKey];
    var mQa = ctCalculateScaleSentiment_(mv.qaCounts);
    var mQb = ctCalculateScaleSentiment_(mv.qbCounts);
    monthlyBreakdown.push({
      monthKey: mKey,
      monthLabel: ctFormatMonthLabel_(mKey),
      sessions: mv.sessions,
      studentsReached: mv.students,
      schoolsCount: Object.keys(mv.schools || {}).length,
      facilitatorsCount: Object.keys(mv.facilitators || {}).length,
      averageCsat: mQa.average,
      averageItp: mQb.average,
      positiveCsatPct: mQa.positivePct,
      positiveItpPct: mQb.positivePct,
      teacherNpsAverage: mv.sessions > 0 ? ctRound2_(mv.npsSum / mv.sessions) : null
    });
  }

  var tourBreakdown = [];
  for (var tId in tourMap) {
    var tv = tourMap[tId];
    var tQa = ctCalculateScaleSentiment_(tv.qaCounts);
    var tQb = ctCalculateScaleSentiment_(tv.qbCounts);
    tourBreakdown.push({
      tourId: tId,
      tourName: tv.tourName,
      sessions: tv.sessions,
      studentsReached: tv.students,
      schoolsCount: Object.keys(tv.schools || {}).length,
      averageCsat: tQa.average,
      averageItp: tQb.average,
      positiveCsatPct: tQa.positivePct,
      positiveItpPct: tQb.positivePct
    });
  }
  tourBreakdown.sort(function (a, b) {
    return b.sessions - a.sessions || b.studentsReached - a.studentsReached || a.tourName.localeCompare(b.tourName);
  });

  var languageBreakdown = [];
  for (var lKey in languageMap) {
    var lv = languageMap[lKey];
    var lQa = ctCalculateScaleSentiment_(lv.qaCounts);
    var lQb = ctCalculateScaleSentiment_(lv.qbCounts);
    languageBreakdown.push({
      language: lKey,
      sessions: lv.sessions,
      studentsReached: lv.students,
      averageCsat: lQa.average,
      averageItp: lQb.average,
      positiveCsatPct: lQa.positivePct,
      positiveItpPct: lQb.positivePct
    });
  }
  languageBreakdown.sort(function (a, b) {
    return b.sessions - a.sessions || a.language.localeCompare(b.language);
  });

  var gradeKeys = Object.keys(gradeMap).sort(function (a, b) {
    return Number(a) - Number(b);
  });
  var gradeBreakdown = [];
  for (var gk = 0; gk < gradeKeys.length; gk++) {
    var gKey = gradeKeys[gk];
    var gv = gradeMap[gKey];
    var gQa = ctCalculateScaleSentiment_(gv.qaCounts);
    var gQb = ctCalculateScaleSentiment_(gv.qbCounts);
    gradeBreakdown.push({
      grade: gKey,
      classesCount: gv.classesCount,
      studentsReached: gv.students,
      averageCsat: gQa.average,
      averageItp: gQb.average,
      positiveCsatPct: gQa.positivePct
    });
  }

  var dateKeys = Object.keys(dateMap).sort();
  var timelineSeries = [];
  for (var dk = 0; dk < dateKeys.length; dk++) {
    var dt = dateKeys[dk];
    timelineSeries.push({
      date: dt,
      sessions: dateMap[dt].sessions,
      studentsReached: dateMap[dt].students
    });
  }

  var scoresOrder = [5, 4, 3, 2, 1];
  var csatDistribution = [];
  var itpDistribution = [];
  for (var sc = 0; sc < scoresOrder.length; sc++) {
    var scoreVal = scoresOrder[sc];
    csatDistribution.push({ score: scoreVal, label: QA_LABELS[scoreVal], count: csatCounts[scoreVal] });
    itpDistribution.push({ score: scoreVal, label: QB_LABELS[scoreVal], count: itpCounts[scoreVal] });
  }

  var facilitatorPanels = [];
  for (var fEmail in facMap) {
    var fv = facMap[fEmail];
    var fQa = ctCalculateScaleSentiment_(fv.qaCounts);
    var fQb = ctCalculateScaleSentiment_(fv.qbCounts);
    facilitatorPanels.push({
      name: fv.name,
      email: fEmail,
      sessions: fv.sessions,
      studentsReached: fv.students,
      schoolsCount: Object.keys(fv.schools || {}).length,
      missingResponsesQa: fv.missingQa,
      averageCsat: fQa.average,
      averageItp: fQb.average,
      positiveCsatPct: fQa.positivePct,
      positiveItpPct: fQb.positivePct,
      teacherNpsAverage: fv.sessions > 0 ? ctRound2_(fv.npsSum / fv.sessions) : null,
      latestSubmission: fv.latest
    });
  }
  facilitatorPanels.sort(function (a, b) {
    return b.sessions - a.sessions || a.name.localeCompare(b.name);
  });

  var missingRateQaPct = totalStudentsReached > 0 ? (totalMissingQa / totalStudentsReached) * 100 : null;
  var missingRateQbPct = totalStudentsReached > 0 ? (totalMissingQb / totalStudentsReached) * 100 : null;

  var summaryObj = {
    totalSessions: totalSessions,
    totalStudentsReached: totalStudentsReached,
    totalSchoolsCovered: Object.keys(uniqueSchools).length,
    totalFacilitatorsActive: Object.keys(uniqueFacs).length,
    totalQuestionAResponses: qaSentiment.total,
    totalQuestionBResponses: qbSentiment.total,
    totalMissingResponsesQA: totalMissingQa,
    totalMissingResponsesQB: totalMissingQb,
    missingResponseRateQaPct: missingRateQaPct,
    missingResponseRateQbPct: missingRateQbPct,
    averageCsat: qaSentiment.average,
    averageItp: qbSentiment.average,
    teacherNpsAverage: totalSessions > 0 ? ctRound2_(npsSum / totalSessions) : null,
    qaSentiment: qaSentiment,
    qbSentiment: qbSentiment,
    districtBreakdown: districtBreakdown,
    schoolBreakdown: schoolBreakdown,
    monthlyBreakdown: monthlyBreakdown,
    tourBreakdown: tourBreakdown,
    languageBreakdown: languageBreakdown,
    gradeBreakdown: gradeBreakdown,
    timelineSeries: timelineSeries,
    csatDistribution: csatDistribution,
    itpDistribution: itpDistribution,
    npsDistribution: npsDist,
    facilitatorPanels: facilitatorPanels,
    dataQuality: {
      totalClassRows: totalClassRows,
      totalMissingQa: totalMissingQa,
      totalMissingQb: totalMissingQb,
      missingRateQaPct: missingRateQaPct,
      missingRateQbPct: missingRateQbPct,
      lowCoverageSessionsCount: lowCoverageSessionsCount,
      qaQbMismatchCount: qaQbMismatchCount,
      unconfiguredVideoCount: unconfiguredVideoCount,
      excludedPendingCount: excludedPendingCount
    },
    reconciliation: null
  };

  summaryObj.reconciliation = ctReconcileServerSummary_(filtered, summaryObj);
  return summaryObj;
}

function ctHandleListManagedUsers_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var admins = ctReadUserRowsFromSheet_(SHEET_NAMES.ADMIN_USERS);
  var facs = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
  var combined = [];
  var allowlisted = ctGetInitialSuperAdmins_();
  var seenAdminEmails = {};

  for (var i = 0; i < admins.length; i++) {
    if (!ctIsAllowlistedSuperAdmin_(admins[i].email)) continue;
    seenAdminEmails[admins[i].email] = true;
    combined.push({
      userId: admins[i].userId,
      name: admins[i].name,
      email: admins[i].email,
      role: 'super_admin',
      active: true,
      status: 'APPROVED',
      createdAt: admins[i].createdAt,
      updatedAt: admins[i].updatedAt
    });
  }

  for (var sa = 0; sa < allowlisted.length; sa++) {
    if (!seenAdminEmails[allowlisted[sa].email]) {
      combined.push({
        userId: allowlisted[sa].userId,
        name: allowlisted[sa].name,
        email: allowlisted[sa].email,
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
        createdAt: '',
        updatedAt: ''
      });
    }
  }

  for (var j = 0; j < facs.length; j++) {
    if (ctIsAllowlistedSuperAdmin_(facs[j].email)) continue;
    combined.push({
      userId: facs[j].userId,
      name: facs[j].name,
      email: facs[j].email,
      role: 'facilitator',
      active: facs[j].active,
      status: facs[j].status || (facs[j].active ? 'APPROVED' : 'DENIED'),
      createdAt: facs[j].createdAt,
      updatedAt: facs[j].updatedAt
    });
  }
  return combined;
}

function ctHandleManageUser_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var input = (payload && payload.user) || {};
  var name = String(input.name || '').trim();
  var email = String(input.email || '').trim().toLowerCase();
  var requestedRole = String(input.role || 'facilitator').trim().toLowerCase();
  var rawStatus = String(input.status || '').trim().toUpperCase();

  if (!name || !email) {
    throw ctApiError_('INVALID_USER', 'Name and email are required.');
  }

  if (ctIsAllowlistedSuperAdmin_(email)) {
    ctAppendAuditLog_(
      actor,
      'MANAGE_USER',
      'User',
      email,
      '',
      'Attempted modification of protected initial Super Administrator',
      'DENIED'
    );
    throw ctApiError_(
      'PROTECTED_ACCOUNT',
      'Initial Super Administrator accounts are protected by server policy and cannot be modified or deactivated.'
    );
  }

  if (requestedRole === 'admin' || requestedRole === 'super_admin') {
    ctAppendAuditLog_(
      actor,
      'MANAGE_USER',
      'User',
      email,
      '',
      'Blocked elevation to privileged role "' + requestedRole + '" for non-allowlisted user',
      'DENIED'
    );
    throw ctApiError_(
      'FORBIDDEN',
      'Administrator privileges are restricted exclusively to allowlisted Super Administrator accounts.'
    );
  }

  if (requestedRole !== 'facilitator') {
    throw ctApiError_('INVALID_ROLE', 'Invalid user role.');
  }

  var status =
    rawStatus === 'APPROVED' || rawStatus === 'PENDING' || rawStatus === 'DENIED'
      ? rawStatus
      : input.active !== false
      ? 'APPROVED'
      : 'DENIED';
  var active = status === 'APPROVED';

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var nowIso = ctNowIso_();
    var facRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
    var matched = null;
    for (var i = 0; i < facRows.length; i++) {
      if ((input.userId && facRows[i].userId === input.userId) || facRows[i].email === email) {
        matched = facRows[i];
        break;
      }
    }

    var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);

    if (matched) {
      var prevSummary = matched.role + ' (status=' + matched.status + ', active=' + matched.active + ')';
      var updated = {
        userId: matched.userId || ('FAC_' + ctShortUuid_().slice(0, 8)),
        name: name,
        email: email,
        role: 'facilitator',
        active: active,
        status: status,
        createdAt: matched.createdAt || nowIso,
        updatedAt: nowIso
      };

      var rowVals = [[
        updated.userId,
        updated.name,
        updated.email,
        'facilitator',
        updated.active ? 'true' : 'false',
        updated.createdAt,
        updated.updatedAt,
        updated.status
      ]];
      var r = facSheet.getRange(matched.rowNumber, 1, 1, 8);
      r.setNumberFormat('@');
      r.setValues(rowVals);

      ctAppendAuditLog_(
        actor,
        'UPDATE_USER',
        'User',
        updated.userId,
        prevSummary,
        'facilitator (status=' + updated.status + ', active=' + updated.active + ')',
        'SUCCESS'
      );
      return updated;
    }

    var created = {
      userId: 'FAC_' + ctShortUuid_().slice(0, 8),
      name: name,
      email: email,
      role: 'facilitator',
      active: active,
      status: status,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    var newRowIdx = Math.max(2, ctFindLastPopulatedRow_(facSheet, 1) + 1);
    var newRange = facSheet.getRange(newRowIdx, 1, 1, 8);
    newRange.setNumberFormat('@');
    newRange.setValues([[
      created.userId,
      created.name,
      created.email,
      'facilitator',
      created.active ? 'true' : 'false',
      created.createdAt,
      created.updatedAt,
      created.status
    ]]);

    ctAppendAuditLog_(
      actor,
      'CREATE_USER',
      'User',
      created.userId,
      '',
      created.email + ' (facilitator, status=' + created.status + ')',
      'SUCCESS'
    );
    return created;
  } finally {
    lock.releaseLock();
  }
}

function ctHandleDeleteUser_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var identifier = String(
    (payload && (payload.userIdOrEmail || payload.email || payload.userId)) || ''
  ).trim();
  if (!identifier) {
    throw ctApiError_('INVALID_USER', 'userIdOrEmail is required.');
  }

  var allowlisted = ctGetInitialSuperAdmins_();
  var cleanLower = identifier.toLowerCase();
  for (var saIdx = 0; saIdx < allowlisted.length; saIdx++) {
    if (allowlisted[saIdx].email === cleanLower || allowlisted[saIdx].userId === identifier) {
      ctAppendAuditLog_(
        actor,
        'DELETE_USER',
        'User',
        identifier,
        '',
        'Attempted deletion of protected initial Super Administrator',
        'DENIED'
      );
      throw ctApiError_(
        'PROTECTED_ACCOUNT',
        'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.'
      );
    }
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var facRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
    var matched = null;
    for (var i = 0; i < facRows.length; i++) {
      if (facRows[i].userId === identifier || facRows[i].email === cleanLower) {
        matched = facRows[i];
        break;
      }
    }
    if (!matched) {
      throw ctApiError_('NOT_FOUND', 'Facilitator user record not found.');
    }
    if (ctIsAllowlistedSuperAdmin_(matched.email)) {
      ctAppendAuditLog_(
        actor,
        'DELETE_USER',
        'User',
        matched.email,
        '',
        'Attempted deletion of protected initial Super Administrator',
        'DENIED'
      );
      throw ctApiError_(
        'PROTECTED_ACCOUNT',
        'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.'
      );
    }

    var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);
    facSheet.deleteRow(matched.rowNumber);

    ctAppendAuditLog_(
      actor,
      'DELETE_USER',
      'User',
      matched.userId || matched.email,
      matched.email + ' (' + matched.name + ', status=' + matched.status + ')',
      'Removed from Facilitators directory',
      'SUCCESS'
    );
    return { deleted: true, email: matched.email };
  } finally {
    lock.releaseLock();
  }
}

function ctSafeJsonParseArray_(str, fallback) {
  if (!str) return fallback;
  try {
    var parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function ctEnsureSheetsConnectionMetadata_(ss, optActorEmail) {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('CONNECTED_DISCONNECTED') || '') === 'true') {
    return false;
  }
  if (!ss) return false;
  if (!ss.getSheetByName(SHEET_NAMES.SESSIONS) || !ss.getSheetByName(SHEET_NAMES.CONFIGURATION)) {
    return false;
  }

  var resolvedId =
    (typeof ss.getId === 'function' && ss.getId()) ||
    String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim() ||
    String(props.getProperty('SPREADSHEET_ID') || '').trim() ||
    CT_DEFAULT_TARGET_SPREADSHEET_ID;
  if (!resolvedId) return false;

  var existingId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  var existingName = String(props.getProperty('CONNECTED_SPREADSHEET_NAME') || '').trim();
  var existingUrl = String(props.getProperty('CONNECTED_SPREADSHEET_URL') || '').trim();
  var existingAccount = String(props.getProperty('CONNECTED_GOOGLE_ACCOUNT') || '').trim();
  var existingAt = String(props.getProperty('CONNECTED_AT') || '').trim();
  var existingBy = String(props.getProperty('CONNECTED_BY') || '').trim();
  var existingTabs = ctSafeJsonParseArray_(props.getProperty('CONNECTED_TABS_JSON'), []);

  if (existingId && existingName && existingUrl && existingAccount && existingTabs.length > 0) {
    return true;
  }

  var ssName =
    existingName ||
    (typeof ss.getName === 'function' && ss.getName()) ||
    'Vidhya Vidhai · Career Tours Database';
  var ssUrl =
    existingUrl ||
    (typeof ss.getUrl === 'function' && ss.getUrl()) ||
    'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit';
  var tabs = existingTabs;
  if (tabs.length === 0) {
    tabs = [];
    for (var t = 0; t < CT_SCHEMA_DEFINITIONS.length; t++) {
      if (ss.getSheetByName(CT_SCHEMA_DEFINITIONS[t].name)) {
        tabs.push(CT_SCHEMA_DEFINITIONS[t].name);
      }
    }
  }
  var cleanActor = String(optActorEmail || '').trim().toLowerCase();
  var nowIso = ctNowIso_();

  if (typeof props.setProperty === 'function') {
    if (!existingId) props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
    if (!existingName) props.setProperty('CONNECTED_SPREADSHEET_NAME', ssName);
    if (!existingUrl) props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
    if (!existingAccount && cleanActor) props.setProperty('CONNECTED_GOOGLE_ACCOUNT', cleanActor);
    if (!existingAt) props.setProperty('CONNECTED_AT', nowIso);
    if (!existingBy && cleanActor) props.setProperty('CONNECTED_BY', cleanActor);
    props.setProperty('CONNECTED_DISCONNECTED', 'false');
    if (existingTabs.length === 0 && tabs.length > 0) {
      props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(tabs));
    }
  }
  return true;
}

function ctBuildSheetsConnectionState_(optActorEmail) {
  var props = PropertiesService.getScriptProperties();
  var disconnected = String(props.getProperty('CONNECTED_DISCONNECTED') || '') === 'true';
  var connectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  var fallbackId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  var effectiveId = !disconnected ? (connectedId || fallbackId) : connectedId;

  if (!disconnected && !effectiveId) {
    try {
      var boundSs = ctGetSpreadsheet_();
      if (boundSs && ctEnsureSheetsConnectionMetadata_(boundSs, optActorEmail)) {
        connectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
        effectiveId = connectedId || fallbackId;
      }
    } catch (ignoreBound) {
      // Ignore if default spreadsheet is not yet accessible
    }
  }

  if (!effectiveId) {
    return {
      connected: false,
      authMethod: 'apps_script',
      connectionProvider: 'apps_script',
      oauthConfigured: false,
      connectedAccount: '',
      spreadsheetId: '',
      spreadsheetName: '',
      spreadsheetUrl: '',
      connectedAt: '',
      connectedBy: '',
      lastSyncedAt: String(props.getProperty('CONNECTED_LAST_SYNC_AT') || ''),
      lastSyncStatus: String(props.getProperty('CONNECTED_LAST_SYNC_STATUS') || 'IDLE'),
      lastSyncMessage: String(props.getProperty('CONNECTED_LAST_SYNC_MESSAGE') || ''),
      initializedTabs: [],
      defaultSpreadsheetId: CT_DEFAULT_TARGET_SPREADSHEET_ID,
      defaultSpreadsheetUrl: CT_DEFAULT_TARGET_SPREADSHEET_URL
    };
  }

  var ssName = String(props.getProperty('CONNECTED_SPREADSHEET_NAME') || '').trim();
  var ssUrl = String(props.getProperty('CONNECTED_SPREADSHEET_URL') || '').trim();
  var initializedTabs = ctSafeJsonParseArray_(props.getProperty('CONNECTED_TABS_JSON'), []);

  if (!ssName || !ssUrl || initializedTabs.length === 0) {
    try {
      var ss = SpreadsheetApp.openById(effectiveId);
      if (ss) {
        if (!ssName && typeof ss.getName === 'function') ssName = ss.getName() || 'Career Tours Database';
        if (!ssUrl && typeof ss.getUrl === 'function') {
          ssUrl = ss.getUrl() || ('https://docs.google.com/spreadsheets/d/' + effectiveId + '/edit');
        }
        if (initializedTabs.length === 0) {
          for (var t = 0; t < CT_SCHEMA_DEFINITIONS.length; t++) {
            if (ss.getSheetByName(CT_SCHEMA_DEFINITIONS[t].name)) {
              initializedTabs.push(CT_SCHEMA_DEFINITIONS[t].name);
            }
          }
        }
        if (typeof ctEnsureSheetsConnectionMetadata_ === 'function') {
          ctEnsureSheetsConnectionMetadata_(ss, optActorEmail);
        }
      }
    } catch (ignore) {
      // Ignore metadata probe failures when building state summary
    }
  }

  var account =
    String(props.getProperty('CONNECTED_GOOGLE_ACCOUNT') || '').trim() ||
    String(optActorEmail || '').trim().toLowerCase();

  return {
    connected: true,
    authMethod: 'apps_script',
    connectionProvider: 'apps_script',
    oauthConfigured: true,
    connectedAccount: account,
    spreadsheetId: effectiveId,
    spreadsheetName: ssName || 'Career Tours Spreadsheet',
    spreadsheetUrl: ssUrl || ('https://docs.google.com/spreadsheets/d/' + effectiveId + '/edit'),
    connectedAt: String(props.getProperty('CONNECTED_AT') || ''),
    connectedBy: String(props.getProperty('CONNECTED_BY') || ''),
    lastSyncedAt: String(props.getProperty('CONNECTED_LAST_SYNC_AT') || ''),
    lastSyncStatus: String(props.getProperty('CONNECTED_LAST_SYNC_STATUS') || 'IDLE'),
    lastSyncMessage: String(props.getProperty('CONNECTED_LAST_SYNC_MESSAGE') || ''),
    initializedTabs: initializedTabs,
    defaultSpreadsheetId: CT_DEFAULT_TARGET_SPREADSHEET_ID,
    defaultSpreadsheetUrl: CT_DEFAULT_TARGET_SPREADSHEET_URL
  };
}

function ctHandleGetSheetsConnection_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
}

function ctHandleConnectGoogleSheet_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var rawTarget = String((payload && payload.spreadsheetUrlOrId) || CT_DEFAULT_TARGET_SPREADSHEET_ID).trim();
  var spreadsheetId = ctParseSpreadsheetId_(rawTarget);
  if (!spreadsheetId) {
    throw ctApiError_(
      'INVALID_SPREADSHEET_ID',
      'Please enter a valid Google Spreadsheet URL or Spreadsheet ID.'
    );
  }
  var shouldInit = !payload || payload.initializeSchema !== false;

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var ss;
    try {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } catch (openErr) {
      throw ctApiError_(
        'SHEET_ACCESS_DENIED',
        'Unable to access spreadsheet "' +
          spreadsheetId +
          '". Confirm the Spreadsheet ID is valid and shared with the authorized Google account.'
      );
    }
    if (!ss) {
      throw ctApiError_('SHEET_NOT_FOUND', 'Target Google Spreadsheet was not found.');
    }

    var tabs = [];
    if (shouldInit) {
      tabs = ctInitializeSpreadsheetObject_(ss, actor.email);
    } else {
      for (var i = 0; i < CT_SCHEMA_DEFINITIONS.length; i++) {
        if (ss.getSheetByName(CT_SCHEMA_DEFINITIONS[i].name)) {
          tabs.push(CT_SCHEMA_DEFINITIONS[i].name);
        }
      }
    }

    var nowIso = ctNowIso_();
    var resolvedId = typeof ss.getId === 'function' && ss.getId() ? ss.getId() : spreadsheetId;
    var ssName =
      typeof ss.getName === 'function' && ss.getName()
        ? ss.getName()
        : 'Vidhya Vidhai · Career Tours';
    var ssUrl =
      typeof ss.getUrl === 'function' && ss.getUrl()
        ? ss.getUrl()
        : 'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit';

    var props = PropertiesService.getScriptProperties();
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
      props.setProperty('CONNECTED_SPREADSHEET_NAME', ssName);
      props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
      props.setProperty('CONNECTED_GOOGLE_ACCOUNT', actor.email);
      props.setProperty('CONNECTED_AT', nowIso);
      props.setProperty('CONNECTED_BY', actor.email);
      props.setProperty('CONNECTED_DISCONNECTED', 'false');
      props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(tabs));
    }

    ctInvalidateConfigCache_();
    ctAppendAuditLog_(
      actor,
      'CONNECT_GOOGLE_SHEET',
      'Configuration',
      resolvedId,
      '',
      'Connected "' + ssName + '" (' + tabs.length + ' tabs initialized=' + shouldInit + ')',
      'SUCCESS'
    );

    return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
  } finally {
    lock.releaseLock();
  }
}

function ctHandleCreateGoogleSheet_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var title = String((payload && payload.title) || 'Vidhya Vidhai · Career Tours Database').trim();
  if (!title) {
    throw ctApiError_('INVALID_TITLE', 'Spreadsheet name is required.');
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var ss = SpreadsheetApp.create(title);
    var tabs = ctInitializeSpreadsheetObject_(ss, actor.email);
    var nowIso = ctNowIso_();
    var resolvedId =
      typeof ss.getId === 'function' && ss.getId() ? ss.getId() : CT_DEFAULT_TARGET_SPREADSHEET_ID;
    var ssUrl =
      typeof ss.getUrl === 'function' && ss.getUrl()
        ? ss.getUrl()
        : 'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit';

    var props = PropertiesService.getScriptProperties();
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
      props.setProperty('CONNECTED_SPREADSHEET_NAME', title);
      props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
      props.setProperty('CONNECTED_GOOGLE_ACCOUNT', actor.email);
      props.setProperty('CONNECTED_AT', nowIso);
      props.setProperty('CONNECTED_BY', actor.email);
      props.setProperty('CONNECTED_DISCONNECTED', 'false');
      props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(tabs));
    }

    ctInvalidateConfigCache_();
    ctAppendAuditLog_(
      actor,
      'CREATE_GOOGLE_SHEET',
      'Configuration',
      resolvedId,
      '',
      'Created and initialized "' + title + '"',
      'SUCCESS'
    );

    return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
  } finally {
    lock.releaseLock();
  }
}

function ctHandleDisconnectGoogleSheet_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var prev = ctBuildSheetsConnectionState_();
    ctAppendAuditLog_(
      actor,
      'DISCONNECT_GOOGLE_SHEET',
      'Configuration',
      prev.spreadsheetId || 'NONE',
      prev.spreadsheetName || '',
      'Disconnected sheet link cleanly without modifying spreadsheet data',
      'SUCCESS'
    );

    var props = PropertiesService.getScriptProperties();
    if (typeof props.deleteProperty === 'function') {
      props.deleteProperty('CONNECTED_SPREADSHEET_ID');
      props.deleteProperty('CONNECTED_SPREADSHEET_NAME');
      props.deleteProperty('CONNECTED_SPREADSHEET_URL');
      props.deleteProperty('CONNECTED_GOOGLE_ACCOUNT');
      props.deleteProperty('CONNECTED_AT');
      props.deleteProperty('CONNECTED_BY');
      props.deleteProperty('CONNECTED_TABS_JSON');
    }
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_DISCONNECTED', 'true');
    }

    ctInvalidateConfigCache_();
    return ctBuildSheetsConnectionState_();
  } finally {
    lock.releaseLock();
  }
}

function ctHandleLoadWorkspace_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var ss = ctGetSpreadsheet_();
  if (!ss.getSheetByName(SHEET_NAMES.SESSIONS) || !ss.getSheetByName(SHEET_NAMES.CONFIGURATION)) {
    ctInitializeSpreadsheetObject_(ss, actor.email);
  }
  ctEnsureSheetsConnectionMetadata_(ss, actor.email);

  var sessionsRaw = ctReadAllSessionsWithDetails_(null);
  var sessions = [];
  for (var i = 0; i < sessionsRaw.length; i++) {
    sessions.push(ctStripInternalRowMeta_(sessionsRaw[i]));
  }

  var schoolSheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var schoolLastRow = schoolSheet.getLastRow();
  var schools = [];
  if (schoolLastRow >= 2) {
    var schoolLayout = ctResolveSchoolSheetLayout_(schoolSheet);
    var schoolVals = schoolSheet.getRange(2, 1, schoolLastRow - 1, schoolLayout.colCount).getValues();
    for (var sIdx = 0; sIdx < schoolVals.length; sIdx++) {
      var rec = ctRowToSchoolRecord_(schoolVals[sIdx], schoolLayout.hasBlock);
      if (rec.udiseCode || rec.schoolName) {
        schools.push(rec);
      }
    }
  }

  var users = ctHandleListManagedUsers_(actor);
  var configuration = ctLoadConfiguration_();
  var auditLogs = ctHandleGetAuditLogs_(actor, { page: 1, pageSize: 25 });
  var syncLogs = ctHandleGetSyncLogs_(actor, { page: 1, pageSize: 25 });

  return {
    connection: ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : ''),
    configuration: configuration,
    sessions: sessions,
    schools: schools,
    users: users,
    auditLogs: auditLogs,
    syncLogs: syncLogs,
    loadedAt: ctNowIso_()
  };
}

function ctHandleSyncAllToGoogleSheet_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var state = ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
    if (!state.connected || !state.spreadsheetId) {
      throw ctApiError_(
        'NOT_CONNECTED',
        'Connect a Google Spreadsheet before running a full data sync.'
      );
    }

    var incomingSessions = (payload && Array.isArray(payload.sessions) && payload.sessions) || [];
    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
    var lastRow = sessionSheet.getLastRow();

    var existingRecordIds = {};
    var existingClientKeys = {};
    var existingSessionIds = {};

    if (lastRow >= 2) {
      var cols = sessionSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < cols.length; i++) {
        var rId = ctCellToString_(cols[i][0]);
        var sId = ctCellToString_(cols[i][1]);
        var cKey = ctCellToString_(cols[i][2]);
        if (rId) existingRecordIds[rId] = true;
        if (sId) existingSessionIds[sId] = true;
        if (cKey) existingClientKeys[cKey] = true;
      }
    }

    var syncedCount = 0;
    var skippedDuplicates = 0;
    var syncedSessionsList = [];
    var nowIso = ctNowIso_();

    for (var sIdx = 0; sIdx < incomingSessions.length; sIdx++) {
      var rec = incomingSessions[sIdx];
      if (!rec) continue;
      var recId = ctCellToString_(rec.sessionRecordId);
      var sessId = ctCellToString_(rec.sessionId);
      var clientKey = ctCellToString_(rec.clientSubmissionKey);

      if (
        (recId && existingRecordIds[recId]) ||
        (clientKey && existingClientKeys[clientKey]) ||
        (sessId && existingSessionIds[sessId])
      ) {
        skippedDuplicates++;
        continue;
      }

      if (!recId) rec.sessionRecordId = 'REC_' + Utilities.getUuid().toUpperCase();
      if (!sessId) continue;

      var rowArr = ctSessionRecordToSheetRow_(rec, sessionLayout.hasBlock);
      var targetRow = Math.max(2, ctFindLastPopulatedRow_(sessionSheet, 1) + 1);
      var sessionRange = sessionSheet.getRange(targetRow, 1, 1, sessionLayout.colCount);
      sessionRange.setNumberFormats([
        ctBuildTextFormatRow_(rowArr, sessionLayout.textColumns)
      ]);
      sessionRange.setValues([rowArr]);

      var dets = Array.isArray(rec.details) ? rec.details : [];
      if (dets.length > 0) {
        var detailRows = [];
        var detailFormats = [];
        for (var dIdx = 0; dIdx < dets.length; dIdx++) {
          var dRow = ctDetailRecordToSheetRow_(dets[dIdx]);
          detailRows.push(dRow);
          detailFormats.push(ctBuildTextFormatRow_(dRow, [1, 2, 3, 4, 5]));
        }
        var detailStart = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
        var detRange = detailSheet.getRange(detailStart, 1, detailRows.length, DETAIL_COL_COUNT);
        detRange.setNumberFormats(detailFormats);
        detRange.setValues(detailRows);
      }

      existingRecordIds[rec.sessionRecordId] = true;
      existingSessionIds[rec.sessionId] = true;
      if (clientKey) existingClientKeys[clientKey] = true;
      syncedSessionsList.push(rec);
      syncedCount++;
    }

    var incomingSchools = (payload && Array.isArray(payload.schools) && payload.schools) || [];
    var syncedSchoolsCount = 0;
    for (var schIdx = 0; schIdx < incomingSchools.length; schIdx++) {
      var sch = incomingSchools[schIdx];
      if (!sch || !ctCellToString_(sch.udiseCode) || !ctCellToString_(sch.schoolName)) continue;
      if (!ctFindSchoolByUdise_(sch.udiseCode)) {
        ctUpsertSchoolWithoutOverwrite_(sch, nowIso);
        syncedSchoolsCount++;
      }
    }
    for (var sSchIdx = 0; sSchIdx < syncedSessionsList.length; sSchIdx++) {
      var sRec = syncedSessionsList[sSchIdx];
      if (ctCellToString_(sRec.udiseCode) && ctCellToString_(sRec.schoolName) && !ctFindSchoolByUdise_(sRec.udiseCode)) {
        ctUpsertSchoolWithoutOverwrite_(sRec, nowIso);
        syncedSchoolsCount++;
      }
    }

    var incomingUsers =
      (payload && Array.isArray(payload.facilitators) && payload.facilitators) ||
      (payload && Array.isArray(payload.users) && payload.users) ||
      [];
    var syncedFacilitatorsCount = 0;
    if (incomingUsers.length > 0) {
      var existingFacs = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
      var existingFacEmails = {};
      for (var ef = 0; ef < existingFacs.length; ef++) {
        existingFacEmails[existingFacs[ef].email] = true;
      }
      var facSheetSync = ctGetSheet_(SHEET_NAMES.FACILITATORS);
      for (var uIdx = 0; uIdx < incomingUsers.length; uIdx++) {
        var u = incomingUsers[uIdx];
        if (!u) continue;
        var uEmail = ctCellToString_(u.email).toLowerCase();
        var uRole = ctCellToString_(u.role || 'facilitator').toLowerCase();
        if (!uEmail || ctIsAllowlistedSuperAdmin_(uEmail) || uRole !== 'facilitator') continue;
        if (existingFacEmails[uEmail]) continue;
        var uName = ctCellToString_(u.name || uEmail);
        var uStatusRaw = ctCellToString_(u.status || '').toUpperCase();
        var uStatus =
          uStatusRaw === 'APPROVED' || uStatusRaw === 'PENDING' || uStatusRaw === 'DENIED'
            ? uStatusRaw
            : u.active !== false
            ? 'APPROVED'
            : 'DENIED';
        var uActive = uStatus === 'APPROVED';
        var uId = ctCellToString_(u.userId) || ('FAC_' + ctShortUuid_().slice(0, 8));
        var nextFacRow = Math.max(2, ctFindLastPopulatedRow_(facSheetSync, 1) + 1);
        var facRange = facSheetSync.getRange(nextFacRow, 1, 1, 8);
        facRange.setNumberFormat('@');
        facRange.setValues([[
          uId,
          uName,
          uEmail,
          'facilitator',
          uActive ? 'true' : 'false',
          ctCellToString_(u.createdAt) || nowIso,
          nowIso,
          uStatus
        ]]);
        existingFacEmails[uEmail] = true;
        syncedFacilitatorsCount++;
      }
    }

    var incomingConfig =
      payload && payload.configuration && typeof payload.configuration === 'object'
        ? payload.configuration
        : null;
    if (incomingConfig) {
      var currentCfg = ctLoadConfiguration_();
      var cfgSheetSync = ctGetSheet_(SHEET_NAMES.CONFIGURATION);
      var syncPropMap = {
        programmeTimezone: 'programme_timezone',
        stateName: 'state_name',
        allowedDistricts: 'allowed_districts',
        gradeOptions: 'grade_options',
        sectionOptions: 'section_options',
        schoolTypes: 'school_types',
        tours: 'tours',
        languageOptions: 'language_options',
        languageCodes: 'language_codes',
        schoolYear: 'school_year',
        partnerName: 'partner_name',
        reportingDefaults: 'reporting_defaults',
        policy: 'policy',
        exportTemplate63: 'export_template_63'
      };
      var cfgUpdated = false;
      for (var cProp in syncPropMap) {
        if (
          !Object.prototype.hasOwnProperty.call(incomingConfig, cProp) ||
          incomingConfig[cProp] === undefined
        ) {
          continue;
        }
        var cVal = incomingConfig[cProp];
        if (
          cProp === 'partnerName' &&
          !String(cVal || '').trim() &&
          String(currentCfg.partnerName || '').trim()
        ) {
          continue;
        }
        if (cProp === 'exportTemplate63') {
          if (cVal === null) continue;
          if (!cVal.columns || cVal.columns.length !== 63) continue;
        }
        if (cProp === 'policy' && cVal && typeof cVal === 'object') {
          cVal = {
            allowFacilitatorDeleteOwn: cVal.allowFacilitatorDeleteOwn !== false,
            allowFacilitatorExportOwn: false,
            facilitatorApprovalMode:
              cVal.facilitatorApprovalMode === 'auto_approve' ? 'auto_approve' : 'manual_allowlist'
          };
        }
        ctUpsertConfigKey_(cfgSheetSync, syncPropMap[cProp], cVal, actor.email);
        cfgUpdated = true;
      }
      if (cfgUpdated) {
        ctInvalidateConfigCache_();
      }
    }

    try {
      var ssSync = ctGetSpreadsheet_();
      var cfgSync = ctLoadConfiguration_();
      if (typeof ctRefreshSummaryAndKpisSheet_ === 'function') {
        ctRefreshSummaryAndKpisSheet_(ssSync, cfgSync);
      }
      if (typeof ctRefreshDeclarationsSheet_ === 'function') {
        ctRefreshDeclarationsSheet_(ssSync, cfgSync);
      }
    } catch (refreshErr) {
      // Non-fatal: Summary & KPIs live formulas stay intact
    }

    var totalSheetSessions = Math.max(0, ctFindLastPopulatedRow_(sessionSheet, 1) - 1);
    var props = PropertiesService.getScriptProperties();
    var extras = [];
    if (syncedSchoolsCount > 0) extras.push(syncedSchoolsCount + ' school(s)');
    if (syncedFacilitatorsCount > 0) extras.push(syncedFacilitatorsCount + ' facilitator(s)');
    var extraSuffix = extras.length > 0 ? ' Plus ' + extras.join(' and ') + '.' : '';
    var msg =
      syncedCount > 0
        ? 'Synced ' +
          syncedCount +
          ' session(s); skipped ' +
          skippedDuplicates +
          ' existing duplicate(s).' +
          extraSuffix
        : 'Verified ' +
          totalSheetSessions +
          ' session(s) up to date (0 duplicates overwritten).' +
          extraSuffix;

    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_LAST_SYNC_AT', nowIso);
      props.setProperty('CONNECTED_LAST_SYNC_STATUS', 'SYNCED');
      props.setProperty('CONNECTED_LAST_SYNC_MESSAGE', msg);
    }

    ctAppendAuditLog_(actor, 'SYNC_GOOGLE_SHEET', 'Configuration', state.spreadsheetId, '', msg, 'SUCCESS');
    ctAppendSyncLog_(actor, 'BULK_SYNC', state.spreadsheetId, 'ALL', 'syncAllToGoogleSheet', 1, 'SYNCED', '');

    return {
      syncedCount: syncedCount,
      skippedDuplicates: skippedDuplicates,
      syncedSchoolsCount: syncedSchoolsCount,
      syncedFacilitatorsCount: syncedFacilitatorsCount,
      totalSheetSessions: totalSheetSessions,
      syncedAt: nowIso,
      message: msg
    };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleGetTeamIntakeConfig_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var intakeKey = ctConfigureFacilitatorIntakeKey_('');
  var cfg = ctLoadConfiguration_();
  return {
    configured: Boolean(intakeKey && intakeKey.length >= 16),
    intakeKey: intakeKey,
    approvalMode:
      cfg && cfg.policy && cfg.policy.facilitatorApprovalMode === 'auto_approve'
        ? 'auto_approve'
        : 'manual_allowlist',
    updatedAt: ctNowIso_()
  };
}

function ctHandleRotateTeamIntakeKey_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var nextKey = ctConfigureFacilitatorIntakeKey_('', true);
    var cfg = ctLoadConfiguration_();
    ctAppendAuditLog_(
      actor,
      'ROTATE_TEAM_INTAKE_KEY',
      'Security',
      'FACILITATOR_INTAKE_KEY',
      '',
      'Rotated Facilitator Team Submission Intake Key (previous share links invalidated)',
      'SUCCESS'
    );
    return {
      configured: true,
      intakeKey: nextKey,
      approvalMode:
        cfg && cfg.policy && cfg.policy.facilitatorApprovalMode === 'auto_approve'
          ? 'auto_approve'
          : 'manual_allowlist',
      updatedAt: ctNowIso_()
    };
  } finally {
    lock.releaseLock();
  }
}

function ctConvertIncomingSessionToFormValues_(rec, fallbackActorEmail) {
  var facEmail = ctCellToString_(rec.facilitatorEmail).toLowerCase() || String(fallbackActorEmail || '').toLowerCase();
  var rawDetails = Array.isArray(rec.details) && rec.details.length > 0 ? rec.details : [];
  var classes = [];
  for (var i = 0; i < rawDetails.length; i++) {
    var d = rawDetails[i] || {};
    classes.push({
      rowId: String(d.detailRecordId || ('imp_' + (i + 1))),
      grade: String(d.grade || ''),
      section: String(d.section || ''),
      studentsPresent: String(d.studentsPresent !== undefined ? d.studentsPresent : ''),
      questionA: {
        score5: String(d.questionAScore5 !== undefined ? d.questionAScore5 : 0),
        score4: String(d.questionAScore4 !== undefined ? d.questionAScore4 : 0),
        score3: String(d.questionAScore3 !== undefined ? d.questionAScore3 : 0),
        score2: String(d.questionAScore2 !== undefined ? d.questionAScore2 : 0),
        score1: String(d.questionAScore1 !== undefined ? d.questionAScore1 : 0)
      },
      questionB: {
        score5: String(d.questionBScore5 !== undefined ? d.questionBScore5 : 0),
        score4: String(d.questionBScore4 !== undefined ? d.questionBScore4 : 0),
        score3: String(d.questionBScore3 !== undefined ? d.questionBScore3 : 0),
        score2: String(d.questionBScore2 !== undefined ? d.questionBScore2 : 0),
        score1: String(d.questionBScore1 !== undefined ? d.questionBScore1 : 0)
      }
    });
  }

  var npsGroup = String(rec.teacherNpsGroup || '').trim().toLowerCase();
  if (npsGroup !== 'promoter' && npsGroup !== 'passive' && npsGroup !== 'detractor') {
    var scoreVal = ctCellToNumOrNull_(rec.teacherScore);
    if (scoreVal !== null) {
      npsGroup = scoreVal >= 9 ? 'promoter' : scoreVal >= 7 ? 'passive' : 'detractor';
    } else {
      var clsLabel = ctCellToString_(rec.teacherClassification).toLowerCase();
      npsGroup = clsLabel === 'detractor' ? 'detractor' : clsLabel === 'passive' ? 'passive' : 'promoter';
    }
  }

  var sessionMode = rec.sessionType === 'combined' || classes.length > 1 ? 'combined' : 'single';
  var startDate = ctCellToString_(rec.startDate);
  var endDate = ctCellToString_(rec.endDate) || startDate;

  return {
    clientSubmissionKey: ctCellToString_(rec.clientSubmissionKey),
    facilitatorName: ctCellToString_(rec.facilitatorName) || facEmail,
    facilitatorEmail: facEmail,
    tourId: ctCellToString_(rec.tourId),
    language: ctCellToString_(rec.language),
    startDate: startDate,
    endDate: endDate,
    startTime: ctCellToString_(rec.startTime),
    endTime: ctCellToString_(rec.endTime),
    schoolName: ctCellToString_(rec.schoolName),
    udiseCode: ctCellToString_(rec.udiseCode),
    schoolType: ctCellToString_(rec.schoolType),
    state: ctCellToString_(rec.state) || 'Tamil Nadu',
    district: ctCellToString_(rec.district),
    pinCode: ctCellToString_(rec.pinCode),
    sessionMode: sessionMode,
    classes: classes,
    teacherNpsGroup: npsGroup,
    teacherExactScore:
      rec.teacherScore !== null && rec.teacherScore !== undefined && String(rec.teacherScore).trim() !== ''
        ? String(rec.teacherScore)
        : ''
  };
}

/**
 * Verified import / recovery of facilitator transfer packages or backup session records.
 * Validates schema server-side, recomputes CSAT/ITP/NPS, deduplicates against existing IDs,
 * registers missing non-admin facilitators as APPROVED, and upserts Schools without overwrite.
 */
function ctHandleImportSessions_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var incoming = (payload && Array.isArray(payload.sessions) && payload.sessions) || null;
  if (!incoming || incoming.length === 0) {
    throw ctApiError_('BAD_REQUEST', 'Select a transfer or backup package containing at least one session.');
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var config = ctLoadConfiguration_();
    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);
    var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
    var lastRow = sessionSheet.getLastRow();

    var existingRecordIds = {};
    var existingSessionIds = {};
    var existingClientKeys = {};

    if (lastRow >= 2) {
      var cols = sessionSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < cols.length; i++) {
        var rId = ctCellToString_(cols[i][0]);
        var sId = ctCellToString_(cols[i][1]);
        var cKey = ctCellToString_(cols[i][2]);
        if (rId) existingRecordIds[rId] = true;
        if (sId) existingSessionIds[sId] = true;
        if (cKey) existingClientKeys[cKey] = true;
      }
    }

    var facRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
    var knownFacByEmail = {};
    for (var fi = 0; fi < facRows.length; fi++) {
      knownFacByEmail[facRows[fi].email] = facRows[fi];
    }

    var importedCount = 0;
    var skippedDuplicates = 0;
    var rejectedCount = 0;
    var registeredFacilitators = 0;
    var registeredSchools = 0;
    var errors = [];
    var nowIso = ctNowIso_();

    for (var idx = 0; idx < incoming.length; idx++) {
      var raw = incoming[idx];
      if (!raw || typeof raw !== 'object') {
        rejectedCount++;
        errors.push({ index: idx, sessionId: '', message: 'Malformed record entry.' });
        continue;
      }

      var rawRecId = ctCellToString_(raw.sessionRecordId);
      var rawSessId = ctCellToString_(raw.sessionId);
      var rawClientKey = ctCellToString_(raw.clientSubmissionKey);

      if (
        (rawRecId && existingRecordIds[rawRecId]) ||
        (rawClientKey && existingClientKeys[rawClientKey]) ||
        (rawSessId && existingSessionIds[rawSessId])
      ) {
        skippedDuplicates++;
        continue;
      }

      var values = ctConvertIncomingSessionToFormValues_(raw, actor.email);
      var validation = ctValidateSessionForm_(values, config);
      if (!validation.valid) {
        var errMsgs = [];
        for (var e = 0; e < validation.errors.length; e++) errMsgs.push(validation.errors[e].message);
        rejectedCount++;
        errors.push({
          index: idx,
          sessionId: rawSessId || rawRecId || ('Row ' + (idx + 1)),
          message: errMsgs.join(' ')
        });
        continue;
      }

      var tour = null;
      for (var tIdx = 0; tIdx < (config.tours || []).length; tIdx++) {
        if (config.tours[tIdx].tourId === values.tourId) {
          tour = config.tours[tIdx];
          break;
        }
      }

      var prefix = ctBuildSessionIdPrefix_(values.startDate, values.udiseCode, values.sessionMode, values.classes);
      var sessionId = rawSessId && !existingSessionIds[rawSessId] ? rawSessId : '';
      if (!sessionId) {
        var maxSeq = 0;
        for (var ek in existingSessionIds) {
          if (ek.indexOf(prefix + '_') === 0) {
            var sp = parseInt(ek.slice(prefix.length + 1), 10);
            if (!isNaN(sp) && sp > maxSeq) maxSeq = sp;
          }
        }
        var seq = maxSeq + 1;
        sessionId = ctFormatSessionIdWithSequence_(prefix, seq);
        while (existingSessionIds[sessionId]) {
          seq++;
          sessionId = ctFormatSessionIdWithSequence_(prefix, seq);
        }
      }

      var sessionRecordId = rawRecId || ('REC_' + Utilities.getUuid().toUpperCase());
      var metrics = ctCalculateSessionMetrics_(values.classes, values.teacherNpsGroup, values.teacherExactScore);
      var durationMinutes =
        ctCalculateSessionDurationMinutes_(values.startDate, values.startTime, values.endDate, values.endTime) || 0;
      var videoInfo = ctResolveConfiguredVideoId_(tour, values.language);

      var facEmail = values.facilitatorEmail;
      var facUserId = ctCellToString_(raw.facilitatorUserId);
      var matchedAdmin = ctFindInitialSuperAdminByEmail_(facEmail);
      if (matchedAdmin) {
        facUserId = matchedAdmin.userId;
      } else if (knownFacByEmail[facEmail]) {
        facUserId = knownFacByEmail[facEmail].userId || facUserId || ('USR_' + facEmail);
      } else {
        facUserId = facUserId || ('FAC_' + ctShortUuid_().slice(0, 8));
        var newFacRowIdx = Math.max(2, ctFindLastPopulatedRow_(facSheet, 1) + 1);
        var facRng = facSheet.getRange(newFacRowIdx, 1, 1, 8);
        facRng.setNumberFormat('@');
        facRng.setValues([[
          facUserId,
          values.facilitatorName || facEmail,
          facEmail,
          'facilitator',
          'true',
          nowIso,
          nowIso,
          'APPROVED'
        ]]);
        knownFacByEmail[facEmail] = { userId: facUserId, email: facEmail, status: 'APPROVED', active: true };
        registeredFacilitators++;
      }

      var detailRecords = [];
      var detailRows = [];
      for (var cIdx = 0; cIdx < metrics.classBreakdown.length; cIdx++) {
        var c = metrics.classBreakdown[cIdx];
        var detObj = {
          detailRecordId: 'DET_' + sessionRecordId + '_' + (cIdx + 1),
          sessionRecordId: sessionRecordId,
          sessionId: sessionId,
          grade: c.grade,
          section: c.section,
          studentsPresent: c.studentsPresent,
          questionAScore5: c.questionACounts.score5,
          questionAScore4: c.questionACounts.score4,
          questionAScore3: c.questionACounts.score3,
          questionAScore2: c.questionACounts.score2,
          questionAScore1: c.questionACounts.score1,
          questionATotal: c.questionATotal,
          questionAWeightedScore: c.questionAWeighted,
          csat: c.csatAverage,
          questionBScore5: c.questionBCounts.score5,
          questionBScore4: c.questionBCounts.score4,
          questionBScore3: c.questionBCounts.score3,
          questionBScore2: c.questionBCounts.score2,
          questionBScore1: c.questionBCounts.score1,
          questionBTotal: c.questionBTotal,
          questionBWeightedScore: c.questionBWeighted,
          itp: c.itpAverage,
          createdAt: ctCellToString_(raw.createdAt) || nowIso,
          updatedAt: nowIso
        };
        detailRecords.push(detObj);
        detailRows.push(ctDetailRecordToSheetRow_(detObj));
      }

      var finalStatus = raw.submissionStatus === 'CORRECTED' ? 'CORRECTED' : 'COMMITTED';
      var newRec = {
        sessionRecordId: sessionRecordId,
        sessionId: sessionId,
        clientSubmissionKey: values.clientSubmissionKey || ('IMP_' + sessionRecordId),
        facilitatorName: values.facilitatorName,
        facilitatorEmail: facEmail,
        facilitatorUserId: facUserId,
        tourId: tour.tourId,
        tourName: tour.tourName,
        videoId: videoInfo.isConfigured ? videoInfo.videoId : 'UNCONFIGURED_VIDEO_ID',
        language: values.language,
        startDate: values.startDate,
        endDate: values.endDate,
        startTime: values.startTime,
        endTime: values.endTime,
        durationMinutes: durationMinutes,
        durationFormatted: ctFormatDurationHuman_(durationMinutes),
        reportingMonth: ctGetMonthNameFromISO_(values.startDate),
        submissionTimestamp: ctCellToString_(raw.submissionTimestamp) || nowIso,
        submissionDateFormatted:
          ctCellToString_(raw.submissionDateFormatted) || ctFormatISODateToDDMMYYYY_(ctGetTodayKolkataISO_()),
        schoolName: values.schoolName,
        udiseCode: values.udiseCode,
        schoolType: values.schoolType,
        state: values.state,
        district: values.district,
        pinCode: values.pinCode,
        sessionType: values.sessionMode,
        totalClasses: metrics.totalClasses,
        totalStudentsPresent: metrics.totalStudentsPresent,
        totalQuestionAResponses: metrics.totalQuestionAResponses,
        totalQuestionBResponses: metrics.totalQuestionBResponses,
        overallCsat: metrics.overallCsat,
        overallItp: metrics.overallItp,
        teacherScore: metrics.teacherScoreExact,
        teacherClassification: metrics.teacherClassification,
        teacherNps: metrics.teacherNps,
        submissionStatus: 'PENDING',
        createdAt: ctCellToString_(raw.createdAt) || nowIso,
        updatedAt: nowIso,
        createdBy: facEmail,
        updatedBy: actor.email,
        archived: Boolean(raw.archived),
        details: detailRecords
      };

      var targetSessionRowIdx = Math.max(2, ctFindLastPopulatedRow_(sessionSheet, 1) + 1);
      var sessionRowArr = ctSessionRecordToSheetRow_(newRec, sessionLayout.hasBlock);
      var sessionRange = sessionSheet.getRange(targetSessionRowIdx, 1, 1, sessionLayout.colCount);
      sessionRange.setNumberFormats([ctBuildTextFormatRow_(sessionRowArr, sessionLayout.textColumns)]);
      sessionRange.setValues([sessionRowArr]);

      var detailStart = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
      var detailRange = detailSheet.getRange(detailStart, 1, detailRows.length, DETAIL_COL_COUNT);
      var detFormats = [];
      for (var df = 0; df < detailRows.length; df++) {
        detFormats.push(ctBuildTextFormatRow_(detailRows[df], [1, 2, 3, 4, 5]));
      }
      detailRange.setNumberFormats(detFormats);
      detailRange.setValues(detailRows);

      SpreadsheetApp.flush();
      sessionSheet.getRange(targetSessionRowIdx, sessionLayout.statusCol).setValue(finalStatus);
      newRec.submissionStatus = finalStatus;

      if (!ctFindSchoolByUdise_(values.udiseCode)) {
        ctUpsertSchoolWithoutOverwrite_(values, nowIso);
        registeredSchools++;
      } else {
        ctUpsertSchoolWithoutOverwrite_(values, nowIso);
      }

      existingRecordIds[sessionRecordId] = true;
      existingSessionIds[sessionId] = true;
      if (newRec.clientSubmissionKey) existingClientKeys[newRec.clientSubmissionKey] = true;
      importedCount++;
    }

    try {
      var ssImp = ctGetSpreadsheet_();
      var cfgImp = ctLoadConfiguration_();
      if (typeof ctRefreshSummaryAndKpisSheet_ === 'function') ctRefreshSummaryAndKpisSheet_(ssImp, cfgImp);
      if (typeof ctRefreshDeclarationsSheet_ === 'function') ctRefreshDeclarationsSheet_(ssImp, cfgImp);
    } catch (ignoreRefresh) {}

    ctAppendAuditLog_(
      actor,
      'IMPORT_SESSIONS',
      'Session',
      'IMPORT',
      '',
      'Imported ' +
        importedCount +
        ' verified session(s); skipped ' +
        skippedDuplicates +
        ' duplicate(s); rejected ' +
        rejectedCount,
      importedCount > 0 ? 'SUCCESS' : rejectedCount > 0 ? 'DENIED' : 'SUCCESS'
    );
    ctAppendSyncLog_(
      actor,
      'IMPORT_PACKAGE',
      'IMPORT',
      String(importedCount),
      'importSessions',
      1,
      'SYNCED',
      rejectedCount > 0 ? rejectedCount + ' record(s) failed validation' : ''
    );

    return {
      importedCount: importedCount,
      skippedDuplicates: skippedDuplicates,
      rejectedCount: rejectedCount,
      registeredFacilitators: registeredFacilitators,
      registeredSchools: registeredSchools,
      errors: errors,
      importedAt: nowIso
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ensures the target spreadsheet for a Supabase Edge Function webhook call is open
 * and initialized with all required career tour tabs before mirroring rows.
 */
function ctEnsureWebhookSpreadsheetReady_(actor, payload, req) {
  var requestedId = ctParseSpreadsheetId_(
    (payload && (payload.spreadsheetId || payload.spreadsheetUrlOrId)) ||
      (req && req.spreadsheetId) ||
      ''
  );
  var props = PropertiesService.getScriptProperties();
  var currentConnectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  var needsAttach = Boolean(requestedId && requestedId !== currentConnectedId);

  if (!needsAttach) {
    try {
      var currentSs = ctGetSpreadsheet_();
      var hasSessionsTab = Boolean(currentSs && currentSs.getSheetByName(SHEET_NAMES.SESSIONS));
      var hasDetailsTab = Boolean(currentSs && currentSs.getSheetByName(SHEET_NAMES.SESSION_DETAILS));
      if (hasSessionsTab && hasDetailsTab) {
        return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
      }
      needsAttach = true;
      if (!requestedId && typeof currentSs.getId === 'function') {
        requestedId = String(currentSs.getId() || '').trim();
      }
    } catch (missingErr) {
      needsAttach = true;
    }
  }

  return ctHandleConnectGoogleSheet_(actor, {
    spreadsheetUrlOrId: requestedId || CT_DEFAULT_TARGET_SPREADSHEET_ID,
    initializeSchema: true
  });
}

function ctHandlePingWebhook_(actor, payload, req) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var state = ctEnsureWebhookSpreadsheetReady_(actor, payload, req);
    return {
      reachable: true,
      spreadsheetId: state.spreadsheetId,
      spreadsheetName: state.spreadsheetName,
      spreadsheetUrl: state.spreadsheetUrl,
      initializedTabs: state.initializedTabs || [],
      message: 'Apps Script webhook connected and sheet schema verified.'
    };
  } finally {
    lock.releaseLock();
  }
}

function ctWriteWebhookSessionDetails_(detailSheet, sessionRecordId, details) {
  var existingRows = ctFindDetailRowsBySessionRecordId_(sessionRecordId);
  var list = Array.isArray(details) ? details : [];
  var minLen = Math.min(existingRows.length, list.length);

  for (var i = 0; i < minLen; i++) {
    var uArr = ctDetailRecordToSheetRow_(list[i]);
    var uRange = detailSheet.getRange(existingRows[i]._rowNumber, 1, 1, DETAIL_COL_COUNT);
    uRange.setNumberFormats([ctBuildTextFormatRow_(uArr, [1, 2, 3, 4, 5])]);
    uRange.setValues([uArr]);
  }
  if (list.length > existingRows.length) {
    var toAppend = [];
    var toAppendFmt = [];
    for (var a = existingRows.length; a < list.length; a++) {
      var aArr = ctDetailRecordToSheetRow_(list[a]);
      toAppend.push(aArr);
      toAppendFmt.push(ctBuildTextFormatRow_(aArr, [1, 2, 3, 4, 5]));
    }
    var appendStart = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
    var appRange = detailSheet.getRange(appendStart, 1, toAppend.length, DETAIL_COL_COUNT);
    appRange.setNumberFormats(toAppendFmt);
    appRange.setValues(toAppend);
  } else if (existingRows.length > list.length) {
    for (var d = existingRows.length - 1; d >= list.length; d--) {
      detailSheet.deleteRow(existingRows[d]._rowNumber);
    }
  }
}

function ctHandleUpsertSessionWebhook_(actor, payload, req) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var state = ctEnsureWebhookSpreadsheetReady_(actor, payload, req);
    var rec = (payload && payload.session) || (req && req.session) || null;
    if (!rec || !ctCellToString_(rec.sessionRecordId) || !ctCellToString_(rec.sessionId)) {
      throw ctApiError_('BAD_REQUEST', 'session payload with sessionRecordId and sessionId is required.');
    }

    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
    var lastRow = sessionSheet.getLastRow();

    var targetRecId = ctCellToString_(rec.sessionRecordId);
    var targetSessId = ctCellToString_(rec.sessionId);
    var targetClientKey = ctCellToString_(rec.clientSubmissionKey);
    var matchedRowNumber = -1;

    if (lastRow >= 2) {
      var cols = sessionSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < cols.length; i++) {
        var rId = ctCellToString_(cols[i][0]);
        var sId = ctCellToString_(cols[i][1]);
        var cKey = ctCellToString_(cols[i][2]);
        if (
          (targetRecId && rId === targetRecId) ||
          (targetClientKey && cKey === targetClientKey) ||
          (targetSessId && sId === targetSessId)
        ) {
          matchedRowNumber = i + 2;
          break;
        }
      }
    }

    var rowArr = ctSessionRecordToSheetRow_(rec, sessionLayout.hasBlock);
    var destRow = matchedRowNumber > 0
      ? matchedRowNumber
      : Math.max(2, ctFindLastPopulatedRow_(sessionSheet, 1) + 1);
    var sessionRange = sessionSheet.getRange(destRow, 1, 1, sessionLayout.colCount);
    sessionRange.setNumberFormats([
      ctBuildTextFormatRow_(rowArr, sessionLayout.textColumns)
    ]);
    sessionRange.setValues([rowArr]);

    ctWriteWebhookSessionDetails_(detailSheet, targetRecId, rec.details);

    var nowIso = ctNowIso_();
    if (ctCellToString_(rec.udiseCode) && ctCellToString_(rec.schoolName)) {
      ctUpsertSchoolWithoutOverwrite_(rec, nowIso);
    }

    try {
      var ssUp = ctGetSpreadsheet_();
      var cfgUp = ctLoadConfiguration_();
      if (typeof ctRefreshSummaryAndKpisSheet_ === 'function') ctRefreshSummaryAndKpisSheet_(ssUp, cfgUp);
      if (typeof ctRefreshDeclarationsSheet_ === 'function') ctRefreshDeclarationsSheet_(ssUp, cfgUp);
    } catch (ignoreRefresh) {}

    var props = PropertiesService.getScriptProperties();
    var msg = (matchedRowNumber > 0 ? 'Updated ' : 'Synced ') + targetSessId + ' via webhook.';
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_LAST_SYNC_AT', nowIso);
      props.setProperty('CONNECTED_LAST_SYNC_STATUS', 'SYNCED');
      props.setProperty('CONNECTED_LAST_SYNC_MESSAGE', msg);
    }

    ctAppendSyncLog_(
      actor,
      targetClientKey || 'WEBHOOK',
      targetRecId,
      targetSessId,
      'upsertSession',
      1,
      'SYNCED',
      ''
    );

    return {
      syncedCount: 1,
      updatedExisting: matchedRowNumber > 0,
      spreadsheetId: state.spreadsheetId,
      sessionRecordId: targetRecId,
      sessionId: targetSessId,
      syncedAt: nowIso,
      message: msg
    };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleSyncAllWebhook_(actor, payload, req) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    ctEnsureWebhookSpreadsheetReady_(actor, payload, req);
    var mergedPayload = payload ? JSON.parse(JSON.stringify(payload)) : {};
    if (!Array.isArray(mergedPayload.sessions) && req && Array.isArray(req.sessions)) {
      mergedPayload.sessions = req.sessions;
    }
    if (!Array.isArray(mergedPayload.schools) && req && Array.isArray(req.schools)) {
      mergedPayload.schools = req.schools;
    }
    if (!Array.isArray(mergedPayload.facilitators) && req && Array.isArray(req.facilitators)) {
      mergedPayload.facilitators = req.facilitators;
    }
    return ctHandleSyncAllToGoogleSheet_(actor, mergedPayload);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// Module: Export.gs
// ============================================================================

/**
 * Export.gs — Server-side flattened export builder and audit logging.
 * Expands combined-class sessions strictly into 1 row per grade/section.
 */

function ctBuildFlattenedExportRows_(sessions, config) {
  var rows = [];
  var defaults = (config && config.reportingDefaults) || {
    cc: 'IN',
    completionRate: 100,
    underservedReach: 'Yes',
    dataSource: 'Manual',
    feedbackFrom: 'students and teacher',
    educatorId: 'NA'
  };

  for (var i = 0; i < (sessions || []).length; i++) {
    var s = sessions[i];
    var details = s.details && s.details.length > 0 ? s.details : [
      {
        detailRecordId: s.sessionRecordId + '_D1',
        grade: '',
        section: '',
        studentsPresent: s.totalStudentsPresent,
        questionAScore5: 0,
        questionAScore4: 0,
        questionAScore3: 0,
        questionAScore2: 0,
        questionAScore1: 0,
        questionATotal: s.totalQuestionAResponses,
        questionAWeightedScore: 0,
        csat: s.overallCsat,
        questionBScore5: 0,
        questionBScore4: 0,
        questionBScore3: 0,
        questionBScore2: 0,
        questionBScore1: 0,
        questionBTotal: s.totalQuestionBResponses,
        questionBWeightedScore: 0,
        itp: s.overallItp
      }
    ];

    for (var j = 0; j < details.length; j++) {
      var d = details[j];
      rows.push({
        session_record_id: s.sessionRecordId,
        detail_record_id: d.detailRecordId,
        session_id: s.sessionId,
        cc: defaults.cc || 'IN',
        school_year: (config && config.schoolYear) || '2026-27',
        partner_name: (config && config.partnerName) || '',
        data_source: defaults.dataSource || 'Manual',
        completion_rate: defaults.completionRate || 100,
        underserved_reach: defaults.underservedReach || 'Yes',
        feedback_from: defaults.feedbackFrom || 'students and teacher',
        educator_id: defaults.educatorId || 'NA',
        facilitator_name: s.facilitatorName,
        facilitator_email: s.facilitatorEmail,
        tour_id: s.tourId,
        tour_name: s.tourName,
        video_id: s.videoId,
        language: s.language,
        start_date: ctFormatISODateToDDMMYYYY_(s.startDate),
        end_date: ctFormatISODateToDDMMYYYY_(s.endDate),
        start_time: s.startTime,
        end_time: s.endTime,
        duration_minutes: s.durationMinutes,
        duration_formatted: s.durationFormatted,
        reporting_month: s.reportingMonth,
        submission_date: s.submissionDateFormatted || ctFormatISODateToDDMMYYYY_(s.startDate),
        submission_timestamp: s.submissionTimestamp,
        school_name: s.schoolName,
        udise_code: String(s.udiseCode),
        school_type: s.schoolType,
        state: s.state,
        district: s.district,
        pin_code: String(s.pinCode),
        session_type: s.sessionType,
        total_classes: s.totalClasses,
        grade: String(d.grade),
        section: String(d.section),
        students_present: d.studentsPresent,
        qa_5: d.questionAScore5,
        qa_4: d.questionAScore4,
        qa_3: d.questionAScore3,
        qa_2: d.questionAScore2,
        qa_1: d.questionAScore1,
        qa_total: d.questionATotal,
        qa_weighted: d.questionAWeightedScore,
        csat: d.csat === null ? '' : d.csat,
        qb_5: d.questionBScore5,
        qb_4: d.questionBScore4,
        qb_3: d.questionBScore3,
        qb_2: d.questionBScore2,
        qb_1: d.questionBScore1,
        qb_total: d.questionBTotal,
        qb_weighted: d.questionBWeightedScore,
        itp: d.itp === null ? '' : d.itp,
        overall_csat: s.overallCsat === null ? '' : s.overallCsat,
        overall_itp: s.overallItp === null ? '' : s.overallItp,
        teacher_score: s.teacherScore === null ? '' : s.teacherScore,
        teacher_classification: s.teacherClassification,
        teacher_nps: s.teacherNps,
        submission_status: s.submissionStatus
      });
    }
  }
  return rows;
}

function ctBuildTemplateMatrix_(sessions, config) {
  var flat = ctBuildFlattenedExportRows_(sessions, config);
  var tpl = config && config.exportTemplate63;
  if (!tpl || !tpl.columns || tpl.columns.length !== 63) {
    return { ok: false, error: 'Official 63-column reporting template is not configured.' };
  }

  var cols = tpl.columns.slice().sort(function (a, b) { return a.index - b.index; });
  var headers = [];
  for (var h = 0; h < cols.length; h++) headers.push(cols[h].header);

  var matrix = [headers];
  for (var r = 0; r < flat.length; r++) {
    var item = flat[r];
    var row = [];
    for (var c = 0; c < cols.length; c++) {
      var spec = cols[c];
      if (spec.format === 'constant') {
        row.push(spec.constantValue !== undefined ? spec.constantValue : '');
      } else if (!spec.sourceKey || item[spec.sourceKey] === undefined || item[spec.sourceKey] === null) {
        row.push('');
      } else if (spec.format === 'text' || spec.sourceKey === 'udise_code' || spec.sourceKey === 'pin_code') {
        row.push(String(item[spec.sourceKey]));
      } else {
        row.push(item[spec.sourceKey]);
      }
    }
    matrix.push(row);
  }
  return { ok: true, matrix: matrix, rowCount: flat.length, columnCount: 63 };
}

function ctHandleLogExportEvent_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var scope = String((payload && payload.scope) || 'EXPORT');
  var rowCount = Number((payload && payload.rowCount) || 0);
  var format = String((payload && payload.format) || 'xlsx');
  ctAppendAuditLog_(actor, 'EXPORT_XLSX', 'Export', scope, '', rowCount + ' rows (' + format + ')', 'SUCCESS');
  return { logged: true };
}

// ============================================================================
// Module: Code.gs
// ============================================================================

/**
 * Code.gs — Web App HTTP entrypoints (doGet / doPost) and centralized RPC dispatcher.
 */

function ctJsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Health check endpoint (returns no sensitive or database data).
 */
function doGet() {
  var configured =
    typeof ctGetSandboxSyncKey_ === 'function' ? ctGetSandboxSyncKey_().length >= 16 : false;
  var intakeConfigured =
    typeof ctGetFacilitatorIntakeKey_ === 'function'
      ? ctGetFacilitatorIntakeKey_().length >= 16
      : false;
  return ctJsonResponse_({
    ok: true,
    service: 'Career Tours Classroom Data Entry & Feedback Management API',
    timezone: 'Asia/Kolkata',
    status: 'READY',
    authModes: ['google_oauth', 'sandbox_sync_bridge', 'facilitator_intake_link'],
    syncKeyConfigured: configured,
    intakeKeyConfigured: intakeConfigured,
    capabilities: [
      'loadWorkspace',
      'createSession',
      'connectGoogleSheet',
      'createGoogleSheet',
      'syncAllToGoogleSheet',
      'importSessions',
      'getDatabaseHealth',
      'recoverPendingSessions',
      'getTeamIntakeConfig'
    ]
  });
}

/**
 * Main JSON API entrypoint.
 * Expects POST body \`{ action, idToken?, syncKey?, actorEmail?, payload }\` with
 * \`Content-Type: text/plain;charset=utf-8\` so browser requests succeed without preflight OPTIONS
 * errors on Google Apps Script Web Apps.
 */
function doPost(e) {
  var action = '';
  try {
    var rawBody = (e && e.postData && e.postData.contents) || '{}';
    var req = JSON.parse(rawBody);
    action = String(req.action || '').trim();
    var idToken = req.idToken;
    var payload = req.payload || {};

    if (!action) {
      return ctJsonResponse_({ ok: false, code: 'BAD_REQUEST', error: 'Missing API action.' });
    }

    // Verify caller identity and resolve server-side role from sheets
    var actor = ctAuthenticateRequest_(idToken, req);
    if (typeof ctRequireIntakeActionAllowed_ === 'function') {
      ctRequireIntakeActionAllowed_(actor, action);
    }
    var data;

    switch (action) {
      case 'getCurrentUser':
        data = ctHandleGetCurrentUser_(actor);
        break;
      case 'loadWorkspace':
        data = ctHandleLoadWorkspace_(actor);
        break;
      case 'getAppConfiguration':
        data = ctHandleGetAppConfiguration_(actor);
        break;
      case 'saveAppConfiguration':
        data = ctHandleSaveAppConfiguration_(actor, payload);
        break;
      case 'createSession':
        data = ctHandleCreateSession_(actor, payload);
        break;
      case 'updateSession':
        data = ctHandleUpdateSession_(actor, payload);
        break;
      case 'archiveSession':
        data = ctHandleArchiveSession_(actor, payload);
        break;
      case 'restoreSession':
        data = ctHandleRestoreSession_(actor, payload);
        break;
      case 'deleteSession':
        data = ctHandleDeleteSession_(actor, payload);
        break;
      case 'bulkDeleteSessions':
        data = ctHandleBulkDeleteSessions_(actor, payload);
        break;
      case 'getSessionById':
        data = ctHandleGetSessionById_(actor, payload);
        break;
      case 'getMySessions':
        data = ctHandleGetMySessions_(actor, payload);
        break;
      case 'getAdminSessions':
        data = ctHandleGetAdminSessions_(actor, payload);
        break;
      case 'getDashboardSummary':
        data = ctHandleGetDashboardSummary_(actor, payload);
        break;
      case 'getSchoolByUdise':
        data = ctHandleGetSchoolByUdise_(actor, payload);
        break;
      case 'searchSchools':
        data = ctHandleSearchSchools_(actor, payload);
        break;
      case 'updateSchool':
        data = ctHandleUpdateSchool_(actor, payload);
        break;
      case 'deleteSchool':
        data = ctHandleDeleteSchool_(actor, payload);
        break;
      case 'listManagedUsers':
        data = ctHandleListManagedUsers_(actor);
        break;
      case 'manageUser':
        data = ctHandleManageUser_(actor, payload);
        break;
      case 'deleteUser':
        data = ctHandleDeleteUser_(actor, payload);
        break;
      case 'getAuditLogs':
        data = ctHandleGetAuditLogs_(actor, payload);
        break;
      case 'getSyncLogs':
        data = ctHandleGetSyncLogs_(actor, payload);
        break;
      case 'logExportEvent':
        data = ctHandleLogExportEvent_(actor, payload);
        break;
      case 'getSheetsConnection':
        data = ctHandleGetSheetsConnection_(actor);
        break;
      case 'connectGoogleSheet':
        data = ctHandleConnectGoogleSheet_(actor, payload);
        break;
      case 'createGoogleSheet':
        data = ctHandleCreateGoogleSheet_(actor, payload);
        break;
      case 'disconnectGoogleSheet':
        data = ctHandleDisconnectGoogleSheet_(actor);
        break;
      case 'syncAllToGoogleSheet':
        data = ctHandleSyncAllToGoogleSheet_(actor, payload);
        break;
      case 'getTeamIntakeConfig':
        data = ctHandleGetTeamIntakeConfig_(actor);
        break;
      case 'rotateTeamIntakeKey':
        data = ctHandleRotateTeamIntakeKey_(actor);
        break;
      case 'getDatabaseHealth':
        data = ctHandleGetDatabaseHealth_(actor);
        break;
      case 'recoverPendingSessions':
        data = ctHandleRecoverPendingSessions_(actor);
        break;
      case 'importSessions':
        data = ctHandleImportSessions_(actor, payload);
        break;
      case 'ping':
        data = ctHandlePingWebhook_(actor, payload, req);
        break;
      case 'upsertSession':
        data = ctHandleUpsertSessionWebhook_(actor, payload, req);
        break;
      case 'syncAll':
        data = ctHandleSyncAllWebhook_(actor, payload, req);
        break;
      default:
        return ctJsonResponse_({
          ok: false,
          code: 'UNKNOWN_ACTION',
          error: 'Unknown API action: ' + action
        });
    }

    return ctJsonResponse_({ ok: true, data: data });
  } catch (err) {
    var code = (err && err.apiCode) || 'INTERNAL_ERROR';
    var msg = (err && err.message) ? String(err.message) : 'Unexpected server error.';
    console.error('doPost[' + action + '] error (' + code + '): ' + msg);
    return ctJsonResponse_({
      ok: false,
      code: code,
      error: msg
    });
  }
}
`;export{e as default};
