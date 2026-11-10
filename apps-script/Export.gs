/**
 * Export.gs — Server-side flattened export builder and audit logging.
 * Expands combined-class sessions strictly into 1 row per grade/section.
 */

function ctBuildFlattenedExportRows_(sessions, config) {
  var rows = [];
  var defaults = (config && config.reportingDefaults) || {
    cc: 'IN',
    completionRate: 100,
    underservedReach: 'Yes',
    dataSource: 'Manual',
    feedbackFrom: 'students and teacher',
    educatorId: 'NA'
  };

  for (var i = 0; i < (sessions || []).length; i++) {
    var s = sessions[i];
    var details = s.details && s.details.length > 0 ? s.details : [
      {
        detailRecordId: s.sessionRecordId + '_D1',
        grade: '',
        section: '',
        studentsPresent: s.totalStudentsPresent,
        questionAScore5: 0,
        questionAScore4: 0,
        questionAScore3: 0,
        questionAScore2: 0,
        questionAScore1: 0,
        questionATotal: s.totalQuestionAResponses,
        questionAWeightedScore: 0,
        csat: s.overallCsat,
        questionBScore5: 0,
        questionBScore4: 0,
        questionBScore3: 0,
        questionBScore2: 0,
        questionBScore1: 0,
        questionBTotal: s.totalQuestionBResponses,
        questionBWeightedScore: 0,
        itp: s.overallItp
      }
    ];

    for (var j = 0; j < details.length; j++) {
      var d = details[j];
      rows.push({
        session_record_id: s.sessionRecordId,
        detail_record_id: d.detailRecordId,
        session_id: s.sessionId,
        cc: defaults.cc || 'IN',
        school_year: (config && config.schoolYear) || '2026-27',
        partner_name: (config && config.partnerName) || '',
        data_source: defaults.dataSource || 'Manual',
        completion_rate: defaults.completionRate || 100,
        underserved_reach: defaults.underservedReach || 'Yes',
        feedback_from: defaults.feedbackFrom || 'students and teacher',
        educator_id: defaults.educatorId || 'NA',
        facilitator_name: s.facilitatorName,
        facilitator_email: s.facilitatorEmail,
        tour_id: s.tourId,
        tour_name: s.tourName,
        video_id: s.videoId,
        language: s.language,
        start_date: ctFormatISODateToDDMMYYYY_(s.startDate),
        end_date: ctFormatISODateToDDMMYYYY_(s.endDate),
        start_time: s.startTime,
        end_time: s.endTime,
        duration_minutes: s.durationMinutes,
        duration_formatted: s.durationFormatted,
        reporting_month: s.reportingMonth,
        submission_date: s.submissionDateFormatted || ctFormatISODateToDDMMYYYY_(s.startDate),
        submission_timestamp: s.submissionTimestamp,
        school_name: s.schoolName,
        udise_code: String(s.udiseCode),
        school_type: s.schoolType,
        state: s.state,
        district: s.district,
        block: s.block,
        pin_code: String(s.pinCode),
        session_type: s.sessionType,
        total_classes: s.totalClasses,
        grade: String(d.grade),
        section: String(d.section),
        students_present: d.studentsPresent,
        qa_5: d.questionAScore5,
        qa_4: d.questionAScore4,
        qa_3: d.questionAScore3,
        qa_2: d.questionAScore2,
        qa_1: d.questionAScore1,
        qa_total: d.questionATotal,
        qa_weighted: d.questionAWeightedScore,
        csat: d.csat === null ? '' : d.csat,
        qb_5: d.questionBScore5,
        qb_4: d.questionBScore4,
        qb_3: d.questionBScore3,
        qb_2: d.questionBScore2,
        qb_1: d.questionBScore1,
        qb_total: d.questionBTotal,
        qb_weighted: d.questionBWeightedScore,
        itp: d.itp === null ? '' : d.itp,
        overall_csat: s.overallCsat === null ? '' : s.overallCsat,
        overall_itp: s.overallItp === null ? '' : s.overallItp,
        teacher_score: s.teacherScore === null ? '' : s.teacherScore,
        teacher_classification: s.teacherClassification,
        teacher_nps: s.teacherNps,
        submission_status: s.submissionStatus
      });
    }
  }
  return rows;
}

function ctBuildTemplateMatrix_(sessions, config) {
  var flat = ctBuildFlattenedExportRows_(sessions, config);
  var tpl = config && config.exportTemplate63;
  if (!tpl || !tpl.columns || tpl.columns.length !== 63) {
    return { ok: false, error: 'Official 63-column reporting template is not configured.' };
  }

  var cols = tpl.columns.slice().sort(function (a, b) { return a.index - b.index; });
  var headers = [];
  for (var h = 0; h < cols.length; h++) headers.push(cols[h].header);

  var matrix = [headers];
  for (var r = 0; r < flat.length; r++) {
    var item = flat[r];
    var row = [];
    for (var c = 0; c < cols.length; c++) {
      var spec = cols[c];
      if (spec.format === 'constant') {
        row.push(spec.constantValue !== undefined ? spec.constantValue : '');
      } else if (!spec.sourceKey || item[spec.sourceKey] === undefined || item[spec.sourceKey] === null) {
        row.push('');
      } else if (spec.format === 'text' || spec.sourceKey === 'udise_code' || spec.sourceKey === 'pin_code') {
        row.push(String(item[spec.sourceKey]));
      } else {
        row.push(item[spec.sourceKey]);
      }
    }
    matrix.push(row);
  }
  return { ok: true, matrix: matrix, rowCount: flat.length, columnCount: 63 };
}

function ctHandleLogExportEvent_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var scope = String((payload && payload.scope) || 'EXPORT');
  var rowCount = Number((payload && payload.rowCount) || 0);
  var format = String((payload && payload.format) || 'xlsx');
  ctAppendAuditLog_(actor, 'EXPORT_XLSX', 'Export', scope, '', rowCount + ' rows (' + format + ')', 'SUCCESS');
  return { logged: true };
}
