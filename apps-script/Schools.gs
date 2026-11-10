/**
 * Schools.gs — School master lookup, search, and non-destructive UDISE conflict guard.
 */

function ctRowToSchoolRecord_(r) {
  var activeRaw = r[8];
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
    block: String(r[6] || ''),
    pinCode: String(r[7] || '').trim(),
    active: active,
    createdAt: String(r[9] || ''),
    updatedAt: String(r[10] || '')
  };
}

function ctFindSchoolByUdise_(udiseCode) {
  var clean = String(udiseCode || '').trim();
  if (!clean) return null;
  var sheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var rows = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() === clean) {
      return ctRowToSchoolRecord_(rows[i]);
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
  var schoolRecordId = 'SCH_' + ctShortUuid_().slice(0, 8);
  var newRow = [
    schoolRecordId,
    String(values.schoolName || '').trim(),
    String(values.udiseCode || '').trim(),
    String(values.schoolType || ''),
    String(values.state || 'Tamil Nadu'),
    String(values.district || ''),
    String(values.block || ''),
    String(values.pinCode || '').trim(),
    'true',
    nowIso,
    nowIso
  ];

  var nextRow = Math.max(2, sheet.getLastRow() + 1);
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
  var sheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  var matches = [];
  for (var i = 0; i < rows.length; i++) {
    var rec = ctRowToSchoolRecord_(rows[i]);
    if (!rec.active) continue;
    if (
      !q ||
      rec.schoolName.toLowerCase().indexOf(q) !== -1 ||
      rec.udiseCode.indexOf(q) !== -1 ||
      rec.district.toLowerCase().indexOf(q) !== -1
    ) {
      matches.push(rec);
      if (matches.length >= 20) break;
    }
  }
  return matches;
}
