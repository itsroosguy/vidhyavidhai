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
  if (!/^\d{11}$/.test(udiseCode)) {
    throw ctApiError_('VALIDATION_FAILED', 'UDISE code must be exactly 11 digits.');
  }
  if (!/^\d{6}$/.test(pinCode)) {
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
