/**
 * Sessions.gs — Concurrency-safe classroom session persistence, ID generation,
 * PENDING->COMMITTED write workflow, row-level updates, filtering, and pagination.
 */

var SESSION_COL_COUNT = 42;
var DETAIL_COL_COUNT = 24;

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

function ctSessionRecordToSheetRow_(rec) {
  return [
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
    rec.district,
    rec.block,
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
  ];
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

function ctSheetRowToSessionRecord_(r, rowNumber, detailsList) {
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
    block: ctCellToString_(r[24]),
    pinCode: ctCellToString_(r[25]),
    sessionType: ctCellToString_(r[26]),
    totalClasses: ctCellToNumber_(r[27], 1),
    totalStudentsPresent: ctCellToNumber_(r[28], 0),
    totalQuestionAResponses: ctCellToNumber_(r[29], 0),
    totalQuestionBResponses: ctCellToNumber_(r[30], 0),
    overallCsat: ctCellToNumOrNull_(r[31]),
    overallItp: ctCellToNumOrNull_(r[32]),
    teacherScore: ctCellToNumOrNull_(r[33]),
    teacherClassification: ctCellToString_(r[34]),
    teacherNps: ctCellToNumber_(r[35], 0),
    submissionStatus: ctCellToString_(r[36]),
    createdAt: ctCellToString_(r[37]),
    updatedAt: ctCellToString_(r[38]),
    createdBy: ctCellToString_(r[39]),
    updatedBy: ctCellToString_(r[40]),
    archived: ctCellToBool_(r[41]),
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

  var detailsMap = ctReadAllDetailsGrouped_();
  var rows = sheet.getRange(2, 1, lastRow - 1, SESSION_COL_COUNT).getValues();
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
    var sess = ctSheetRowToSessionRecord_(r, i + 2, cleanDetails);
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
    // Columns 1..3 (session_record_id, session_id, client_submission_key) + col 37 (submission_status)
    var keyRange = sessionSheet.getRange(2, 1, lastSessionRow - 1, 3).getValues();
    var statusCol = sessionSheet.getRange(2, 37, lastSessionRow - 1, 1).getValues();
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
    block: values.block,
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
  var targetSessionRowIdx = Math.max(2, sessionSheet.getLastRow() + 1);
  var sessionRowArr = ctSessionRecordToSheetRow_(newRecord);
  var sessionRange = sessionSheet.getRange(targetSessionRowIdx, 1, 1, SESSION_COL_COUNT);
  sessionRange.setNumberFormats([
    ctBuildTextFormatRow_(sessionRowArr, [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 26, 37, 38, 39, 42])
  ]);
  sessionRange.setValues([sessionRowArr]);

  // Phase 2: Insert class detail rows
  var detailStartRow = Math.max(2, detailSheet.getLastRow() + 1);
  var detailRange = detailSheet.getRange(detailStartRow, 1, detailRows.length, DETAIL_COL_COUNT);
  var detFormats = [];
  for (var df = 0; df < detailRows.length; df++) {
    detFormats.push(ctBuildTextFormatRow_(detailRows[df], [1, 2, 3, 4, 5]));
  }
  detailRange.setNumberFormats(detFormats);
  detailRange.setValues(detailRows);

  // Verify count before finalizing COMMITTED
  SpreadsheetApp.flush();

  // Phase 3: Promote status cell (col 37) ONLY from PENDING -> COMMITTED
  sessionSheet.getRange(targetSessionRowIdx, 37).setValue('COMMITTED');
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
    'Session ' + sessionId + ' (' + values.district + (values.block ? '/' + values.block : '') + ', ' + metrics.totalStudentsPresent + ' students)',
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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

  var rows = sheet.getRange(2, 1, lastRow - 1, SESSION_COL_COUNT).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (ctCellToString_(rows[i][0]) === sessionRecordId) {
      var details = ctFindDetailRowsBySessionRecordId_(sessionRecordId);
      var clean = [];
      for (var j = 0; j < details.length; j++) {
        var c = JSON.parse(JSON.stringify(details[j]));
        delete c._rowNumber;
        clean.push(c);
      }
      return ctSheetRowToSessionRecord_(rows[i], i + 2, clean);
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

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
      block: values.block,
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
    var sessionRowArr = ctSessionRecordToSheetRow_(updatedRecord);
    var sessionRange = sessionSheet.getRange(existing._rowNumber, 1, 1, SESSION_COL_COUNT);
    sessionRange.setNumberFormats([
      ctBuildTextFormatRow_(sessionRowArr, [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 26, 37, 38, 39, 42])
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
      var appendStart = Math.max(2, detailSheet.getLastRow() + 1);
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

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
    var nowIso = ctNowIso_();
    // Column 39 = updated_at, Column 41 = updated_by, Column 42 = archived (single-row cells)
    sheet.getRange(existing._rowNumber, 39).setValue(nowIso);
    sheet.getRange(existing._rowNumber, 41).setValue(actor.email);
    sheet.getRange(existing._rowNumber, 42).setNumberFormat('@').setValue('true');

    ctAppendAuditLog_(actor, 'ARCHIVE_SESSION', 'Session', sessionRecordId, 'archived=false', 'archived=true', 'SUCCESS');
    return { archived: true };
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
    if (f.block && s.block !== f.block) continue;
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
      var hay = (s.sessionId + ' ' + s.schoolName + ' ' + s.udiseCode + ' ' + s.facilitatorName + ' ' + s.block).toLowerCase();
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
 * Administrative diagnostic helper to inspect stale PENDING sessions if an execution crashed mid-write.
 */
function recoverPendingSessions() {
  var sheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'No session rows exist.';
  var detailsMap = ctReadAllDetailsGrouped_();
  var rows = sheet.getRange(2, 1, lastRow - 1, SESSION_COL_COUNT).getValues();
  var recovered = 0;
  var incomplete = [];

  for (var i = 0; i < rows.length; i++) {
    if (ctCellToString_(rows[i][36]) === 'PENDING') {
      var recId = ctCellToString_(rows[i][0]);
      var expectedClasses = ctCellToNumber_(rows[i][27], 1);
      var actualDetails = (detailsMap[recId] || []).length;
      if (actualDetails === expectedClasses) {
        sheet.getRange(i + 2, 37).setValue('COMMITTED');
        recovered++;
      } else {
        incomplete.push(recId + ' (expected ' + expectedClasses + ' details, found ' + actualDetails + ')');
      }
    }
  }
  return 'Recovered COMPLETE pending rows: ' + recovered + '; Incomplete pending rows: ' + (incomplete.join('; ') || 'none');
}
