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
