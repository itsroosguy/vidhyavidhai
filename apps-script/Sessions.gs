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
 * When `optPerformRepair` is true, promotes recoverable PENDING sessions (whose detail rows are
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
