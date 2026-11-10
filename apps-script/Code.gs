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
  return ctJsonResponse_({
    ok: true,
    service: 'Career Tours Classroom Data Entry & Feedback Management API',
    timezone: 'Asia/Kolkata',
    status: 'READY'
  });
}

/**
 * Main JSON API entrypoint.
 * Expects POST body `{ action, idToken, payload }` with `Content-Type: text/plain;charset=utf-8`
 * so browser requests succeed without preflight OPTIONS errors on Google Apps Script Web Apps.
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
    var actor = ctAuthenticateRequest_(idToken);
    var data;

    switch (action) {
      case 'getCurrentUser':
        data = ctHandleGetCurrentUser_(actor);
        break;
      case 'getAppConfiguration':
        data = ctHandleGetAppConfiguration_(actor);
        break;
      case 'saveAppConfiguration':
        data = ctHandleSaveAppConfiguration_(actor, payload);
        break;
      case 'importBlockMaster':
        data = ctHandleImportBlockMaster_(actor, payload);
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
      case 'listManagedUsers':
        data = ctHandleListManagedUsers_(actor);
        break;
      case 'manageUser':
        data = ctHandleManageUser_(actor, payload);
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
