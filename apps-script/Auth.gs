/**
 * Auth.gs — Server-side Google ID Token verification and Role-Based Access Control (RBAC).
 *
 * SECURITY MODEL:
 * 1. Never trust browser-supplied email, userId, or role claims.
 * 2. Verify every request's Google Identity Services `idToken` against Google's tokeninfo endpoint
 *    and assert `aud === GOOGLE_CLIENT_ID`, `email_verified === true`, and unexpired `exp`.
 * 3. Only the two server-side allowlisted SUPER_ADMIN accounts (`brinthajayaprakash888@gmail.com`
 *    and `karunya@vidhyavidhai.org`) may receive `super_admin` privileges.
 * 4. All other users authenticate strictly via Google Sign-In, resolve against `Facilitators`
 *    subject to `policy.facilitatorApprovalMode`, and can never hold administrator roles.
 * 5. Zero passwords are stored or verified in source code, sheets, or configuration.
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

  var response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );

  if (response.getResponseCode() !== 200) {
    throw ctApiError_('UNAUTHENTICATED', 'Invalid or expired Google sign-in token. Please sign in again.');
  }

  var claims = JSON.parse(response.getContentText() || '{}');
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
 * Authenticates the caller via Google ID token and resolves their authoritative server role.
 */
function ctAuthenticateRequest_(idToken) {
  var verified = ctVerifyGoogleIdToken_(idToken);
  var email = verified.email;

  // 1. Strict server-side allowlist for the two initial SUPER_ADMIN accounts
  var allowlistedSa = ctFindInitialSuperAdminByEmail_(email);
  if (allowlistedSa) {
    var adminRows = ctReadUserRowsFromSheet_(SHEET_NAMES.ADMIN_USERS);
    var adminRow = null;
    for (var a = 0; a < adminRows.length; a++) {
      if (adminRows[a].email === email) {
        adminRow = adminRows[a];
        break;
      }
    }
    return {
      userId: (adminRow && adminRow.userId) || allowlistedSa.userId,
      name: (adminRow && adminRow.name) || verified.name || allowlistedSa.name,
      email: allowlistedSa.email,
      role: 'super_admin',
      active: true,
      status: 'APPROVED',
      authMode: 'google_oauth'
    };
  }

  // 2. Every other user authenticates via Google Sign-In and resolves strictly as a Facilitator
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
    var nextRow = Math.max(2, facSheet.getLastRow() + 1);
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
