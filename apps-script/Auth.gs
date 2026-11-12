/**
 * Auth.gs — Server-side Google ID Token / Apps Script Sync Bridge verification and RBAC.
 *
 * SECURITY MODEL:
 * 1. Never trust browser-supplied role claims or raw email headers without cryptographic/secret proof.
 * 2. Verify browser requests using Google Identity Services `idToken` against Google's tokeninfo endpoint
 *    (`aud === GOOGLE_CLIENT_ID`, `email_verified === true`, unexpired `exp`), OR using the server-stored
 *    `SANDBOX_SYNC_KEY` Script Property restricted strictly to allowlisted Super Administrator emails.
 * 3. Only server-side allowlisted SUPER_ADMIN accounts (`brinthajayaprakash888@gmail.com`,
 *    `karunya@vidhyavidhai.org`, `ram@vidhyavidhai.org`, `regi@vidhyavidhai.org`,
 *    and `nisha@vidhyavidhai.org`) may receive `super_admin` privileges or use the Apps Script Sync Bridge.
 * 4. All other users authenticate strictly via Google Sign-In, resolve against `Facilitators`
 *    subject to `policy.facilitatorApprovalMode`, and can never hold administrator roles.
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
 * Authenticates the caller via Google ID token OR Apps Script Sync Bridge (`syncKey` + allowlisted
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
