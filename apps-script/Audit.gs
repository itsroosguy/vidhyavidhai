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

/**
 * Returns the configured database Spreadsheet.
 * Reads ScriptProperty SPREADSHEET_ID first; falls back to getActiveSpreadsheet() if bound.
 */
function ctGetSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('SPREADSHEET_ID Script Property is not configured and no active spreadsheet is bound.');
  }
  return active;
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
    var nextRow = Math.max(2, sheet.getLastRow() + 1);
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
    var nextRow = Math.max(2, sheet.getLastRow() + 1);
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
