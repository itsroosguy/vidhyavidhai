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
 * Expects POST body `{ action, idToken?, syncKey?, actorEmail?, payload }` with
 * `Content-Type: text/plain;charset=utf-8` so browser requests succeed without preflight OPTIONS
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

/**
 * Automatically fetches the latest programme data from Supabase PostgreSQL and
 * updates the connected Google Sheet tabs (Sessions, Session Details, Schools, Facilitators).
 */
function ctAutoSyncFromSupabase() {
  var props = PropertiesService.getScriptProperties();
  var syncKey =
    props.getProperty('SANDBOX_SYNC_KEY') ||
    (typeof CT_PRESET_SANDBOX_SYNC_KEY !== 'undefined' ? CT_PRESET_SANDBOX_SYNC_KEY : '') ||
    'VV-WH-1D85E77814DE4513ABE078F6CD1DC020';
  var supabaseUrl = props.getProperty('SUPABASE_URL') || 'https://gjkworgzniinnpnoinsd.supabase.co';
  var anonKey =
    props.getProperty('SUPABASE_ANON_KEY') ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdqa3dvcmd6bmlpbm5wbm9pbnNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTY5MzMsImV4cCI6MjEwODQzMjkzM30.ZELMnC_5k05rWOIefMc9T4etJ3WM7hxwN131PxUYgoI';

  var url = supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/get_programme_sheets_data';
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'apikey': anonKey,
      'Authorization': 'Bearer ' + anonKey,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ p_sync_key: syncKey }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var rawText = response.getContentText();
  if (code !== 200) {
    throw new Error('Supabase sync returned HTTP ' + code + ': ' + rawText);
  }

  var resData = JSON.parse(rawText);
  if (!resData || !Array.isArray(resData.sessions)) {
    throw new Error('Invalid JSON payload received from Supabase database.');
  }

  var actor = {
    userId: 'AUTO_SYNC_DAEMON',
    name: 'Supabase 5-Min Sync Daemon',
    email: 'brinthajayaprakash888@gmail.com',
    role: 'super_admin',
    active: true,
    status: 'APPROVED',
    authMode: 'sandbox_sync_bridge'
  };

  return ctHandleSyncAllToGoogleSheet_(actor, {
    sessions: resData.sessions,
    schools: resData.schools,
    facilitators: resData.facilitators
  });
}

/**
 * Installs a time-driven trigger that runs `ctAutoSyncFromSupabase` every 5 minutes.
 */
function ctInstall5MinuteSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ctAutoSyncFromSupabase') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('ctAutoSyncFromSupabase')
    .timeBased()
    .everyMinutes(5)
    .create();

  var res = ctAutoSyncFromSupabase();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      '5-Minute Auto-Sync is now active! Synced ' + (res.syncedCount || 0) + ' sessions.',
      'Career Tours 🚀',
      8
    );
  } catch (e) {}
  return res;
}

/**
 * Removes the 5-minute automated sync trigger.
 */
function ctRemove5MinuteSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ctAutoSyncFromSupabase') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Auto-sync stopped (' + removed + ' trigger removed).',
      'Career Tours 🚀',
      6
    );
  } catch (e) {}
  return { ok: true, removed: removed };
}

/**
 * Adds a top-level menu to the Google Spreadsheet for instant manual and automated sync.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('Career Tours 🚀')
      .addItem('▶ Sync Now from Supabase', 'ctMenuSyncNow_')
      .addItem('⏱ Enable 5-Minute Auto-Sync', 'ctInstall5MinuteSyncTrigger')
      .addItem('⏹ Stop Auto-Sync', 'ctRemove5MinuteSyncTrigger')
      .addToUi();
  } catch (e) {
    // Non-UI context
  }
}

function ctMenuSyncNow_() {
  var res = ctAutoSyncFromSupabase();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      res.message || ('Synced ' + (res.syncedCount || 0) + ' sessions.'),
      'Sync Completed ✅',
      8
    );
  } catch (e) {}
}
