/**
 * Admin.gs — Server-side analytics aggregation and user/role management.
 */

var QA_LABELS = {
  5: 'Loved it',
  4: 'Liked it',
  3: 'It was okay',
  2: "Didn't like it much",
  1: "Didn't like it at all"
};

var QB_LABELS = {
  5: 'Extremely interested',
  4: 'Very interested',
  3: 'Moderately interested',
  2: 'Slightly interested',
  1: 'Not at all interested'
};

function ctEmptyCountsObj_() {
  return { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 };
}

function ctAddCountsTo_(target, s5, s4, s3, s2, s1) {
  target.score5 += Number(s5 || 0);
  target.score4 += Number(s4 || 0);
  target.score3 += Number(s3 || 0);
  target.score2 += Number(s2 || 0);
  target.score1 += Number(s1 || 0);
}

function ctFormatMonthLabel_(monthKey) {
  var m = /^(\d{4})-(\d{2})$/.exec(monthKey || '');
  if (!m) return monthKey || 'Unknown';
  var idx = parseInt(m[2], 10) - 1;
  return (CT_MONTH_NAMES[idx] || m[2]) + ' ' + m[1];
}

function ctReconcileServerSummary_(filtered, analytics) {
  var discrepancies = [];
  var checksRun = 0;
  var rawStudentsDetails = 0;
  var rawQaTotal = 0;
  var rawQaWeighted = 0;
  var rawQbTotal = 0;
  var rawQbWeighted = 0;
  var rawNpsSum = 0;
  var rawMissingQa = 0;
  var rawSchools = {};

  for (var i = 0; i < filtered.length; i++) {
    var s = filtered[i];
    rawNpsSum += s.teacherNps;
    rawSchools[s.udiseCode] = true;
    for (var j = 0; j < s.details.length; j++) {
      var d = s.details[j];
      rawStudentsDetails += d.studentsPresent;
      var qat = d.questionAScore5 + d.questionAScore4 + d.questionAScore3 + d.questionAScore2 + d.questionAScore1;
      var qaw = 5 * d.questionAScore5 + 4 * d.questionAScore4 + 3 * d.questionAScore3 + 2 * d.questionAScore2 + d.questionAScore1;
      var qbt = d.questionBScore5 + d.questionBScore4 + d.questionBScore3 + d.questionBScore2 + d.questionBScore1;
      var qbw = 5 * d.questionBScore5 + 4 * d.questionBScore4 + 3 * d.questionBScore3 + 2 * d.questionBScore2 + d.questionBScore1;
      rawQaTotal += qat;
      rawQaWeighted += qaw;
      rawQbTotal += qbt;
      rawQbWeighted += qbw;
      rawMissingQa += Math.max(0, d.studentsPresent - qat);
    }
  }

  checksRun++;
  if (analytics.totalSessions !== filtered.length) discrepancies.push('Session count mismatch');
  checksRun++;
  if (analytics.totalStudentsReached !== rawStudentsDetails) discrepancies.push('Student count mismatch');
  checksRun++;
  if (analytics.totalSchoolsCovered !== Object.keys(rawSchools).length) discrepancies.push('School count mismatch');
  checksRun++;
  var expCsat = rawQaTotal > 0 ? ctRound2_(rawQaWeighted / rawQaTotal) : null;
  if (analytics.averageCsat !== expCsat || analytics.totalQuestionAResponses !== rawQaTotal) discrepancies.push('CSAT mismatch');
  checksRun++;
  var expItp = rawQbTotal > 0 ? ctRound2_(rawQbWeighted / rawQbTotal) : null;
  if (analytics.averageItp !== expItp || analytics.totalQuestionBResponses !== rawQbTotal) discrepancies.push('ITP mismatch');
  checksRun++;
  var expNps = filtered.length > 0 ? ctRound2_(rawNpsSum / filtered.length) : null;
  if (analytics.teacherNpsAverage !== expNps) discrepancies.push('Teacher NPS mismatch');
  checksRun++;
  if (analytics.totalMissingResponsesQA !== rawMissingQa) discrepancies.push('Missing QA count mismatch');

  return {
    verified: discrepancies.length === 0,
    checkedAt: ctNowIso_(),
    checksRun: checksRun,
    discrepancies: discrepancies
  };
}

function ctHandleGetDashboardSummary_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var config = ctLoadConfiguration_();
  var filters = (payload && payload.filters) || {};
  var allRows = ctReadAllSessionsWithDetails_(null);
  var allowed = config.allowedDistricts || [];
  var excludedPendingCount = 0;
  for (var p = 0; p < allRows.length; p++) {
    if (!allRows[p].archived && (allRows[p].submissionStatus === 'PENDING' || !ctArrayIncludes_(allowed, allRows[p].district))) {
      excludedPendingCount++;
    }
  }

  var filtered = ctApplySessionFilters_(allRows, filters, config);

  var totalSessions = filtered.length;
  var totalStudentsReached = 0;
  var uniqueSchools = {};
  var uniqueFacs = {};

  var pooledQA = ctEmptyCountsObj_();
  var pooledQB = ctEmptyCountsObj_();
  var totalMissingQa = 0;
  var totalMissingQb = 0;
  var totalClassRows = 0;
  var lowCoverageSessionsCount = 0;
  var qaQbMismatchCount = 0;
  var unconfiguredVideoCount = 0;
  var npsSum = 0;

  var csatCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  var itpCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  var npsDist = { promoter: 0, passive: 0, detractor: 0 };

  function makeGroup() {
    return {
      sessions: 0,
      students: 0,
      qaCounts: ctEmptyCountsObj_(),
      qbCounts: ctEmptyCountsObj_(),
      missingQa: 0,
      missingQb: 0,
      npsSum: 0
    };
  }

  var districtMap = {};
  for (var dIdx = 0; dIdx < allowed.length; dIdx++) {
    var dObj = makeGroup();
    dObj.schools = {};
    districtMap[allowed[dIdx]] = dObj;
  }

  var schoolMap = {};
  var monthMap = {};
  var tourMap = {};
  var languageMap = {};
  var gradeMap = {};
  var dateMap = {};
  var facMap = {};

  for (var i = 0; i < filtered.length; i++) {
    var s = filtered[i];
    uniqueSchools[s.udiseCode] = true;
    uniqueFacs[s.facilitatorEmail] = true;
    npsSum += s.teacherNps;

    if (s.teacherClassification === 'Promoter') npsDist.promoter++;
    else if (s.teacherClassification === 'Passive') npsDist.passive++;
    else npsDist.detractor++;

    if (!s.videoId || s.videoId === 'UNCONFIGURED_VIDEO_ID') unconfiguredVideoCount++;

    var dAgg = districtMap[s.district];
    if (dAgg) {
      dAgg.sessions++;
      dAgg.schools[s.udiseCode] = true;
      dAgg.npsSum += s.teacherNps;
    }

    if (!schoolMap[s.udiseCode]) {
      var scInit = makeGroup();
      scInit.udiseCode = s.udiseCode;
      scInit.schoolName = s.schoolName;
      scInit.district = s.district;
      schoolMap[s.udiseCode] = scInit;
    }
    var scAgg = schoolMap[s.udiseCode];
    scAgg.sessions++;
    scAgg.schoolName = s.schoolName;
    scAgg.npsSum += s.teacherNps;

    var monthKey = /^\d{4}-\d{2}/.test(s.startDate) ? s.startDate.slice(0, 7) : 'Unknown';
    if (!monthMap[monthKey]) {
      var mInit = makeGroup();
      mInit.schools = {};
      mInit.facilitators = {};
      monthMap[monthKey] = mInit;
    }
    var mAgg = monthMap[monthKey];
    mAgg.sessions++;
    mAgg.schools[s.udiseCode] = true;
    mAgg.facilitators[s.facilitatorEmail] = true;
    mAgg.npsSum += s.teacherNps;

    if (!tourMap[s.tourId]) {
      var tInit = makeGroup();
      tInit.tourName = s.tourName;
      tInit.schools = {};
      tourMap[s.tourId] = tInit;
    }
    var tAgg = tourMap[s.tourId];
    tAgg.sessions++;
    tAgg.schools[s.udiseCode] = true;
    tAgg.npsSum += s.teacherNps;

    if (!languageMap[s.language]) languageMap[s.language] = makeGroup();
    var lAgg = languageMap[s.language];
    lAgg.sessions++;
    lAgg.npsSum += s.teacherNps;

    if (!dateMap[s.startDate]) dateMap[s.startDate] = { sessions: 0, students: 0 };
    dateMap[s.startDate].sessions++;

    if (!facMap[s.facilitatorEmail]) {
      var fInit = makeGroup();
      fInit.name = s.facilitatorName;
      fInit.latest = s.submissionTimestamp;
      fInit.schools = {};
      facMap[s.facilitatorEmail] = fInit;
    }
    var fAgg = facMap[s.facilitatorEmail];
    fAgg.sessions++;
    fAgg.schools[s.udiseCode] = true;
    fAgg.npsSum += s.teacherNps;
    if (s.submissionTimestamp > fAgg.latest) fAgg.latest = s.submissionTimestamp;

    var sessStudents = 0;
    var sessQa = 0;
    var sessQb = 0;

    for (var j = 0; j < s.details.length; j++) {
      var det = s.details[j];
      totalClassRows++;
      var present = det.studentsPresent;
      var qaTot = det.questionATotal;
      var qbTot = det.questionBTotal;
      var missQa = Math.max(0, present - qaTot);
      var missQb = Math.max(0, present - qbTot);

      sessStudents += present;
      sessQa += qaTot;
      sessQb += qbTot;

      totalStudentsReached += present;
      totalMissingQa += missQa;
      totalMissingQb += missQb;

      ctAddCountsTo_(pooledQA, det.questionAScore5, det.questionAScore4, det.questionAScore3, det.questionAScore2, det.questionAScore1);
      ctAddCountsTo_(pooledQB, det.questionBScore5, det.questionBScore4, det.questionBScore3, det.questionBScore2, det.questionBScore1);

      var targets = [scAgg, mAgg, tAgg, lAgg, fAgg];
      if (dAgg) targets.push(dAgg);
      for (var tg = 0; tg < targets.length; tg++) {
        targets[tg].students += present;
        targets[tg].missingQa += missQa;
        targets[tg].missingQb += missQb;
        ctAddCountsTo_(targets[tg].qaCounts, det.questionAScore5, det.questionAScore4, det.questionAScore3, det.questionAScore2, det.questionAScore1);
        ctAddCountsTo_(targets[tg].qbCounts, det.questionBScore5, det.questionBScore4, det.questionBScore3, det.questionBScore2, det.questionBScore1);
      }

      if (!gradeMap[det.grade]) {
        var gInit = makeGroup();
        gInit.classesCount = 0;
        gradeMap[det.grade] = gInit;
      }
      var gAgg = gradeMap[det.grade];
      gAgg.classesCount++;
      gAgg.students += present;
      gAgg.missingQa += missQa;
      gAgg.missingQb += missQb;
      ctAddCountsTo_(gAgg.qaCounts, det.questionAScore5, det.questionAScore4, det.questionAScore3, det.questionAScore2, det.questionAScore1);
      ctAddCountsTo_(gAgg.qbCounts, det.questionBScore5, det.questionBScore4, det.questionBScore3, det.questionBScore2, det.questionBScore1);

      csatCounts[5] += det.questionAScore5;
      csatCounts[4] += det.questionAScore4;
      csatCounts[3] += det.questionAScore3;
      csatCounts[2] += det.questionAScore2;
      csatCounts[1] += det.questionAScore1;

      itpCounts[5] += det.questionBScore5;
      itpCounts[4] += det.questionBScore4;
      itpCounts[3] += det.questionBScore3;
      itpCounts[2] += det.questionBScore2;
      itpCounts[1] += det.questionBScore1;
    }

    dateMap[s.startDate].students += sessStudents;
    if (sessQa !== sessQb) qaQbMismatchCount++;
    if (sessStudents > 0) {
      if ((sessQa / sessStudents) * 100 < 75 || (sessQb / sessStudents) * 100 < 75) {
        lowCoverageSessionsCount++;
      }
    }
  }

  var qaSentiment = ctCalculateScaleSentiment_(pooledQA);
  var qbSentiment = ctCalculateScaleSentiment_(pooledQB);

  var districtBreakdown = [];
  for (var dd = 0; dd < allowed.length; dd++) {
    var dName = allowed[dd];
    var dv = districtMap[dName];
    var dQa = ctCalculateScaleSentiment_(dv.qaCounts);
    var dQb = ctCalculateScaleSentiment_(dv.qbCounts);
    districtBreakdown.push({
      district: dName,
      sessions: dv.sessions,
      studentsReached: dv.students,
      schoolsCount: Object.keys(dv.schools).length,
      qaResponses: dQa.total,
      qbResponses: dQb.total,
      missingResponsesQa: dv.missingQa,
      averageCsat: dQa.average,
      averageItp: dQb.average,
      positiveCsatPct: dQa.positivePct,
      positiveItpPct: dQb.positivePct
    });
  }

  var schoolBreakdown = [];
  for (var scId in schoolMap) {
    var sv = schoolMap[scId];
    var sQa = ctCalculateScaleSentiment_(sv.qaCounts);
    var sQb = ctCalculateScaleSentiment_(sv.qbCounts);
    schoolBreakdown.push({
      udiseCode: sv.udiseCode,
      schoolName: sv.schoolName,
      district: sv.district,
      sessions: sv.sessions,
      studentsReached: sv.students,
      qaResponses: sQa.total,
      qbResponses: sQb.total,
      missingResponsesQa: sv.missingQa,
      missingResponsesQb: sv.missingQb,
      averageCsat: sQa.average,
      averageItp: sQb.average,
      positiveCsatPct: sQa.positivePct,
      positiveItpPct: sQb.positivePct
    });
  }
  schoolBreakdown.sort(function (a, b) {
    return b.studentsReached - a.studentsReached || a.schoolName.localeCompare(b.schoolName);
  });

  var monthKeys = Object.keys(monthMap).sort();
  var monthlyBreakdown = [];
  for (var mk = 0; mk < monthKeys.length; mk++) {
    var mKey = monthKeys[mk];
    var mv = monthMap[mKey];
    var mQa = ctCalculateScaleSentiment_(mv.qaCounts);
    var mQb = ctCalculateScaleSentiment_(mv.qbCounts);
    monthlyBreakdown.push({
      monthKey: mKey,
      monthLabel: ctFormatMonthLabel_(mKey),
      sessions: mv.sessions,
      studentsReached: mv.students,
      schoolsCount: Object.keys(mv.schools || {}).length,
      facilitatorsCount: Object.keys(mv.facilitators || {}).length,
      averageCsat: mQa.average,
      averageItp: mQb.average,
      positiveCsatPct: mQa.positivePct,
      positiveItpPct: mQb.positivePct,
      teacherNpsAverage: mv.sessions > 0 ? ctRound2_(mv.npsSum / mv.sessions) : null
    });
  }

  var tourBreakdown = [];
  for (var tId in tourMap) {
    var tv = tourMap[tId];
    var tQa = ctCalculateScaleSentiment_(tv.qaCounts);
    var tQb = ctCalculateScaleSentiment_(tv.qbCounts);
    tourBreakdown.push({
      tourId: tId,
      tourName: tv.tourName,
      sessions: tv.sessions,
      studentsReached: tv.students,
      schoolsCount: Object.keys(tv.schools || {}).length,
      averageCsat: tQa.average,
      averageItp: tQb.average,
      positiveCsatPct: tQa.positivePct,
      positiveItpPct: tQb.positivePct
    });
  }
  tourBreakdown.sort(function (a, b) {
    return b.sessions - a.sessions || b.studentsReached - a.studentsReached || a.tourName.localeCompare(b.tourName);
  });

  var languageBreakdown = [];
  for (var lKey in languageMap) {
    var lv = languageMap[lKey];
    var lQa = ctCalculateScaleSentiment_(lv.qaCounts);
    var lQb = ctCalculateScaleSentiment_(lv.qbCounts);
    languageBreakdown.push({
      language: lKey,
      sessions: lv.sessions,
      studentsReached: lv.students,
      averageCsat: lQa.average,
      averageItp: lQb.average,
      positiveCsatPct: lQa.positivePct,
      positiveItpPct: lQb.positivePct
    });
  }
  languageBreakdown.sort(function (a, b) {
    return b.sessions - a.sessions || a.language.localeCompare(b.language);
  });

  var gradeKeys = Object.keys(gradeMap).sort(function (a, b) {
    return Number(a) - Number(b);
  });
  var gradeBreakdown = [];
  for (var gk = 0; gk < gradeKeys.length; gk++) {
    var gKey = gradeKeys[gk];
    var gv = gradeMap[gKey];
    var gQa = ctCalculateScaleSentiment_(gv.qaCounts);
    var gQb = ctCalculateScaleSentiment_(gv.qbCounts);
    gradeBreakdown.push({
      grade: gKey,
      classesCount: gv.classesCount,
      studentsReached: gv.students,
      averageCsat: gQa.average,
      averageItp: gQb.average,
      positiveCsatPct: gQa.positivePct
    });
  }

  var dateKeys = Object.keys(dateMap).sort();
  var timelineSeries = [];
  for (var dk = 0; dk < dateKeys.length; dk++) {
    var dt = dateKeys[dk];
    timelineSeries.push({
      date: dt,
      sessions: dateMap[dt].sessions,
      studentsReached: dateMap[dt].students
    });
  }

  var scoresOrder = [5, 4, 3, 2, 1];
  var csatDistribution = [];
  var itpDistribution = [];
  for (var sc = 0; sc < scoresOrder.length; sc++) {
    var scoreVal = scoresOrder[sc];
    csatDistribution.push({ score: scoreVal, label: QA_LABELS[scoreVal], count: csatCounts[scoreVal] });
    itpDistribution.push({ score: scoreVal, label: QB_LABELS[scoreVal], count: itpCounts[scoreVal] });
  }

  var facilitatorPanels = [];
  for (var fEmail in facMap) {
    var fv = facMap[fEmail];
    var fQa = ctCalculateScaleSentiment_(fv.qaCounts);
    var fQb = ctCalculateScaleSentiment_(fv.qbCounts);
    facilitatorPanels.push({
      name: fv.name,
      email: fEmail,
      sessions: fv.sessions,
      studentsReached: fv.students,
      schoolsCount: Object.keys(fv.schools || {}).length,
      missingResponsesQa: fv.missingQa,
      averageCsat: fQa.average,
      averageItp: fQb.average,
      positiveCsatPct: fQa.positivePct,
      positiveItpPct: fQb.positivePct,
      teacherNpsAverage: fv.sessions > 0 ? ctRound2_(fv.npsSum / fv.sessions) : null,
      latestSubmission: fv.latest
    });
  }
  facilitatorPanels.sort(function (a, b) {
    return b.sessions - a.sessions || a.name.localeCompare(b.name);
  });

  var missingRateQaPct = totalStudentsReached > 0 ? (totalMissingQa / totalStudentsReached) * 100 : null;
  var missingRateQbPct = totalStudentsReached > 0 ? (totalMissingQb / totalStudentsReached) * 100 : null;

  var summaryObj = {
    totalSessions: totalSessions,
    totalStudentsReached: totalStudentsReached,
    totalSchoolsCovered: Object.keys(uniqueSchools).length,
    totalFacilitatorsActive: Object.keys(uniqueFacs).length,
    totalQuestionAResponses: qaSentiment.total,
    totalQuestionBResponses: qbSentiment.total,
    totalMissingResponsesQA: totalMissingQa,
    totalMissingResponsesQB: totalMissingQb,
    missingResponseRateQaPct: missingRateQaPct,
    missingResponseRateQbPct: missingRateQbPct,
    averageCsat: qaSentiment.average,
    averageItp: qbSentiment.average,
    teacherNpsAverage: totalSessions > 0 ? ctRound2_(npsSum / totalSessions) : null,
    qaSentiment: qaSentiment,
    qbSentiment: qbSentiment,
    districtBreakdown: districtBreakdown,
    schoolBreakdown: schoolBreakdown,
    monthlyBreakdown: monthlyBreakdown,
    tourBreakdown: tourBreakdown,
    languageBreakdown: languageBreakdown,
    gradeBreakdown: gradeBreakdown,
    timelineSeries: timelineSeries,
    csatDistribution: csatDistribution,
    itpDistribution: itpDistribution,
    npsDistribution: npsDist,
    facilitatorPanels: facilitatorPanels,
    dataQuality: {
      totalClassRows: totalClassRows,
      totalMissingQa: totalMissingQa,
      totalMissingQb: totalMissingQb,
      missingRateQaPct: missingRateQaPct,
      missingRateQbPct: missingRateQbPct,
      lowCoverageSessionsCount: lowCoverageSessionsCount,
      qaQbMismatchCount: qaQbMismatchCount,
      unconfiguredVideoCount: unconfiguredVideoCount,
      excludedPendingCount: excludedPendingCount
    },
    reconciliation: null
  };

  summaryObj.reconciliation = ctReconcileServerSummary_(filtered, summaryObj);
  return summaryObj;
}

function ctHandleListManagedUsers_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var admins = ctReadUserRowsFromSheet_(SHEET_NAMES.ADMIN_USERS);
  var facs = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
  var combined = [];
  var allowlisted = ctGetInitialSuperAdmins_();
  var seenAdminEmails = {};

  for (var i = 0; i < admins.length; i++) {
    if (!ctIsAllowlistedSuperAdmin_(admins[i].email)) continue;
    seenAdminEmails[admins[i].email] = true;
    combined.push({
      userId: admins[i].userId,
      name: admins[i].name,
      email: admins[i].email,
      role: 'super_admin',
      active: true,
      status: 'APPROVED',
      createdAt: admins[i].createdAt,
      updatedAt: admins[i].updatedAt
    });
  }

  for (var sa = 0; sa < allowlisted.length; sa++) {
    if (!seenAdminEmails[allowlisted[sa].email]) {
      combined.push({
        userId: allowlisted[sa].userId,
        name: allowlisted[sa].name,
        email: allowlisted[sa].email,
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
        createdAt: '',
        updatedAt: ''
      });
    }
  }

  for (var j = 0; j < facs.length; j++) {
    if (ctIsAllowlistedSuperAdmin_(facs[j].email)) continue;
    combined.push({
      userId: facs[j].userId,
      name: facs[j].name,
      email: facs[j].email,
      role: 'facilitator',
      active: facs[j].active,
      status: facs[j].status || (facs[j].active ? 'APPROVED' : 'DENIED'),
      createdAt: facs[j].createdAt,
      updatedAt: facs[j].updatedAt
    });
  }
  return combined;
}

function ctHandleManageUser_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var input = (payload && payload.user) || {};
  var name = String(input.name || '').trim();
  var email = String(input.email || '').trim().toLowerCase();
  var requestedRole = String(input.role || 'facilitator').trim().toLowerCase();
  var rawStatus = String(input.status || '').trim().toUpperCase();

  if (!name || !email) {
    throw ctApiError_('INVALID_USER', 'Name and email are required.');
  }

  if (ctIsAllowlistedSuperAdmin_(email)) {
    ctAppendAuditLog_(
      actor,
      'MANAGE_USER',
      'User',
      email,
      '',
      'Attempted modification of protected initial Super Administrator',
      'DENIED'
    );
    throw ctApiError_(
      'PROTECTED_ACCOUNT',
      'Initial Super Administrator accounts are protected by server policy and cannot be modified or deactivated.'
    );
  }

  if (requestedRole === 'admin' || requestedRole === 'super_admin') {
    ctAppendAuditLog_(
      actor,
      'MANAGE_USER',
      'User',
      email,
      '',
      'Blocked elevation to privileged role "' + requestedRole + '" for non-allowlisted user',
      'DENIED'
    );
    throw ctApiError_(
      'FORBIDDEN',
      'Administrator privileges are restricted exclusively to allowlisted Super Administrator accounts.'
    );
  }

  if (requestedRole !== 'facilitator') {
    throw ctApiError_('INVALID_ROLE', 'Invalid user role.');
  }

  var status =
    rawStatus === 'APPROVED' || rawStatus === 'PENDING' || rawStatus === 'DENIED'
      ? rawStatus
      : input.active !== false
      ? 'APPROVED'
      : 'DENIED';
  var active = status === 'APPROVED';

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var nowIso = ctNowIso_();
    var facRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
    var matched = null;
    for (var i = 0; i < facRows.length; i++) {
      if ((input.userId && facRows[i].userId === input.userId) || facRows[i].email === email) {
        matched = facRows[i];
        break;
      }
    }

    var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);

    if (matched) {
      var prevSummary = matched.role + ' (status=' + matched.status + ', active=' + matched.active + ')';
      var updated = {
        userId: matched.userId || ('FAC_' + ctShortUuid_().slice(0, 8)),
        name: name,
        email: email,
        role: 'facilitator',
        active: active,
        status: status,
        createdAt: matched.createdAt || nowIso,
        updatedAt: nowIso
      };

      var rowVals = [[
        updated.userId,
        updated.name,
        updated.email,
        'facilitator',
        updated.active ? 'true' : 'false',
        updated.createdAt,
        updated.updatedAt,
        updated.status
      ]];
      var r = facSheet.getRange(matched.rowNumber, 1, 1, 8);
      r.setNumberFormat('@');
      r.setValues(rowVals);

      ctAppendAuditLog_(
        actor,
        'UPDATE_USER',
        'User',
        updated.userId,
        prevSummary,
        'facilitator (status=' + updated.status + ', active=' + updated.active + ')',
        'SUCCESS'
      );
      return updated;
    }

    var created = {
      userId: 'FAC_' + ctShortUuid_().slice(0, 8),
      name: name,
      email: email,
      role: 'facilitator',
      active: active,
      status: status,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    var newRowIdx = Math.max(2, ctFindLastPopulatedRow_(facSheet, 1) + 1);
    var newRange = facSheet.getRange(newRowIdx, 1, 1, 8);
    newRange.setNumberFormat('@');
    newRange.setValues([[
      created.userId,
      created.name,
      created.email,
      'facilitator',
      created.active ? 'true' : 'false',
      created.createdAt,
      created.updatedAt,
      created.status
    ]]);

    ctAppendAuditLog_(
      actor,
      'CREATE_USER',
      'User',
      created.userId,
      '',
      created.email + ' (facilitator, status=' + created.status + ')',
      'SUCCESS'
    );
    return created;
  } finally {
    lock.releaseLock();
  }
}

function ctHandleDeleteUser_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var identifier = String(
    (payload && (payload.userIdOrEmail || payload.email || payload.userId)) || ''
  ).trim();
  if (!identifier) {
    throw ctApiError_('INVALID_USER', 'userIdOrEmail is required.');
  }

  var allowlisted = ctGetInitialSuperAdmins_();
  var cleanLower = identifier.toLowerCase();
  for (var saIdx = 0; saIdx < allowlisted.length; saIdx++) {
    if (allowlisted[saIdx].email === cleanLower || allowlisted[saIdx].userId === identifier) {
      ctAppendAuditLog_(
        actor,
        'DELETE_USER',
        'User',
        identifier,
        '',
        'Attempted deletion of protected initial Super Administrator',
        'DENIED'
      );
      throw ctApiError_(
        'PROTECTED_ACCOUNT',
        'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.'
      );
    }
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var facRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
    var matched = null;
    for (var i = 0; i < facRows.length; i++) {
      if (facRows[i].userId === identifier || facRows[i].email === cleanLower) {
        matched = facRows[i];
        break;
      }
    }
    if (!matched) {
      throw ctApiError_('NOT_FOUND', 'Facilitator user record not found.');
    }
    if (ctIsAllowlistedSuperAdmin_(matched.email)) {
      ctAppendAuditLog_(
        actor,
        'DELETE_USER',
        'User',
        matched.email,
        '',
        'Attempted deletion of protected initial Super Administrator',
        'DENIED'
      );
      throw ctApiError_(
        'PROTECTED_ACCOUNT',
        'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.'
      );
    }

    var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);
    facSheet.deleteRow(matched.rowNumber);

    ctAppendAuditLog_(
      actor,
      'DELETE_USER',
      'User',
      matched.userId || matched.email,
      matched.email + ' (' + matched.name + ', status=' + matched.status + ')',
      'Removed from Facilitators directory',
      'SUCCESS'
    );
    return { deleted: true, email: matched.email };
  } finally {
    lock.releaseLock();
  }
}

function ctSafeJsonParseArray_(str, fallback) {
  if (!str) return fallback;
  try {
    var parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function ctEnsureSheetsConnectionMetadata_(ss, optActorEmail) {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('CONNECTED_DISCONNECTED') || '') === 'true') {
    return false;
  }
  if (!ss) return false;
  if (!ss.getSheetByName(SHEET_NAMES.SESSIONS) || !ss.getSheetByName(SHEET_NAMES.CONFIGURATION)) {
    return false;
  }

  var resolvedId =
    (typeof ss.getId === 'function' && ss.getId()) ||
    String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim() ||
    String(props.getProperty('SPREADSHEET_ID') || '').trim() ||
    CT_DEFAULT_TARGET_SPREADSHEET_ID;
  if (!resolvedId) return false;

  var existingId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  var existingName = String(props.getProperty('CONNECTED_SPREADSHEET_NAME') || '').trim();
  var existingUrl = String(props.getProperty('CONNECTED_SPREADSHEET_URL') || '').trim();
  var existingAccount = String(props.getProperty('CONNECTED_GOOGLE_ACCOUNT') || '').trim();
  var existingAt = String(props.getProperty('CONNECTED_AT') || '').trim();
  var existingBy = String(props.getProperty('CONNECTED_BY') || '').trim();
  var existingTabs = ctSafeJsonParseArray_(props.getProperty('CONNECTED_TABS_JSON'), []);

  if (existingId && existingName && existingUrl && existingAccount && existingTabs.length > 0) {
    return true;
  }

  var ssName =
    existingName ||
    (typeof ss.getName === 'function' && ss.getName()) ||
    'Vidhya Vidhai · Career Tours Database';
  var ssUrl =
    existingUrl ||
    (typeof ss.getUrl === 'function' && ss.getUrl()) ||
    'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit';
  var tabs = existingTabs;
  if (tabs.length === 0) {
    tabs = [];
    for (var t = 0; t < CT_SCHEMA_DEFINITIONS.length; t++) {
      if (ss.getSheetByName(CT_SCHEMA_DEFINITIONS[t].name)) {
        tabs.push(CT_SCHEMA_DEFINITIONS[t].name);
      }
    }
  }
  var cleanActor = String(optActorEmail || '').trim().toLowerCase();
  var nowIso = ctNowIso_();

  if (typeof props.setProperty === 'function') {
    if (!existingId) props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
    if (!existingName) props.setProperty('CONNECTED_SPREADSHEET_NAME', ssName);
    if (!existingUrl) props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
    if (!existingAccount && cleanActor) props.setProperty('CONNECTED_GOOGLE_ACCOUNT', cleanActor);
    if (!existingAt) props.setProperty('CONNECTED_AT', nowIso);
    if (!existingBy && cleanActor) props.setProperty('CONNECTED_BY', cleanActor);
    props.setProperty('CONNECTED_DISCONNECTED', 'false');
    if (existingTabs.length === 0 && tabs.length > 0) {
      props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(tabs));
    }
  }
  return true;
}

function ctBuildSheetsConnectionState_(optActorEmail) {
  var props = PropertiesService.getScriptProperties();
  var disconnected = String(props.getProperty('CONNECTED_DISCONNECTED') || '') === 'true';
  var connectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  var fallbackId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  var effectiveId = !disconnected ? (connectedId || fallbackId) : connectedId;

  if (!disconnected && !effectiveId) {
    try {
      var boundSs = ctGetSpreadsheet_();
      if (boundSs && ctEnsureSheetsConnectionMetadata_(boundSs, optActorEmail)) {
        connectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
        effectiveId = connectedId || fallbackId;
      }
    } catch (ignoreBound) {
      // Ignore if default spreadsheet is not yet accessible
    }
  }

  if (!effectiveId) {
    return {
      connected: false,
      authMethod: 'apps_script',
      connectionProvider: 'apps_script',
      oauthConfigured: false,
      connectedAccount: '',
      spreadsheetId: '',
      spreadsheetName: '',
      spreadsheetUrl: '',
      connectedAt: '',
      connectedBy: '',
      lastSyncedAt: String(props.getProperty('CONNECTED_LAST_SYNC_AT') || ''),
      lastSyncStatus: String(props.getProperty('CONNECTED_LAST_SYNC_STATUS') || 'IDLE'),
      lastSyncMessage: String(props.getProperty('CONNECTED_LAST_SYNC_MESSAGE') || ''),
      initializedTabs: [],
      defaultSpreadsheetId: CT_DEFAULT_TARGET_SPREADSHEET_ID,
      defaultSpreadsheetUrl: CT_DEFAULT_TARGET_SPREADSHEET_URL
    };
  }

  var ssName = String(props.getProperty('CONNECTED_SPREADSHEET_NAME') || '').trim();
  var ssUrl = String(props.getProperty('CONNECTED_SPREADSHEET_URL') || '').trim();
  var initializedTabs = ctSafeJsonParseArray_(props.getProperty('CONNECTED_TABS_JSON'), []);

  if (!ssName || !ssUrl || initializedTabs.length === 0) {
    try {
      var ss = SpreadsheetApp.openById(effectiveId);
      if (ss) {
        if (!ssName && typeof ss.getName === 'function') ssName = ss.getName() || 'Career Tours Database';
        if (!ssUrl && typeof ss.getUrl === 'function') {
          ssUrl = ss.getUrl() || ('https://docs.google.com/spreadsheets/d/' + effectiveId + '/edit');
        }
        if (initializedTabs.length === 0) {
          for (var t = 0; t < CT_SCHEMA_DEFINITIONS.length; t++) {
            if (ss.getSheetByName(CT_SCHEMA_DEFINITIONS[t].name)) {
              initializedTabs.push(CT_SCHEMA_DEFINITIONS[t].name);
            }
          }
        }
        if (typeof ctEnsureSheetsConnectionMetadata_ === 'function') {
          ctEnsureSheetsConnectionMetadata_(ss, optActorEmail);
        }
      }
    } catch (ignore) {
      // Ignore metadata probe failures when building state summary
    }
  }

  var account =
    String(props.getProperty('CONNECTED_GOOGLE_ACCOUNT') || '').trim() ||
    String(optActorEmail || '').trim().toLowerCase();

  return {
    connected: true,
    authMethod: 'apps_script',
    connectionProvider: 'apps_script',
    oauthConfigured: true,
    connectedAccount: account,
    spreadsheetId: effectiveId,
    spreadsheetName: ssName || 'Career Tours Spreadsheet',
    spreadsheetUrl: ssUrl || ('https://docs.google.com/spreadsheets/d/' + effectiveId + '/edit'),
    connectedAt: String(props.getProperty('CONNECTED_AT') || ''),
    connectedBy: String(props.getProperty('CONNECTED_BY') || ''),
    lastSyncedAt: String(props.getProperty('CONNECTED_LAST_SYNC_AT') || ''),
    lastSyncStatus: String(props.getProperty('CONNECTED_LAST_SYNC_STATUS') || 'IDLE'),
    lastSyncMessage: String(props.getProperty('CONNECTED_LAST_SYNC_MESSAGE') || ''),
    initializedTabs: initializedTabs,
    defaultSpreadsheetId: CT_DEFAULT_TARGET_SPREADSHEET_ID,
    defaultSpreadsheetUrl: CT_DEFAULT_TARGET_SPREADSHEET_URL
  };
}

function ctHandleGetSheetsConnection_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
}

function ctHandleConnectGoogleSheet_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var rawTarget = String((payload && payload.spreadsheetUrlOrId) || CT_DEFAULT_TARGET_SPREADSHEET_ID).trim();
  var spreadsheetId = ctParseSpreadsheetId_(rawTarget);
  if (!spreadsheetId) {
    throw ctApiError_(
      'INVALID_SPREADSHEET_ID',
      'Please enter a valid Google Spreadsheet URL or Spreadsheet ID.'
    );
  }
  var shouldInit = !payload || payload.initializeSchema !== false;

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var ss;
    try {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } catch (openErr) {
      throw ctApiError_(
        'SHEET_ACCESS_DENIED',
        'Unable to access spreadsheet "' +
          spreadsheetId +
          '". Confirm the Spreadsheet ID is valid and shared with the authorized Google account.'
      );
    }
    if (!ss) {
      throw ctApiError_('SHEET_NOT_FOUND', 'Target Google Spreadsheet was not found.');
    }

    var tabs = [];
    if (shouldInit) {
      tabs = ctInitializeSpreadsheetObject_(ss, actor.email);
    } else {
      for (var i = 0; i < CT_SCHEMA_DEFINITIONS.length; i++) {
        if (ss.getSheetByName(CT_SCHEMA_DEFINITIONS[i].name)) {
          tabs.push(CT_SCHEMA_DEFINITIONS[i].name);
        }
      }
    }

    var nowIso = ctNowIso_();
    var resolvedId = typeof ss.getId === 'function' && ss.getId() ? ss.getId() : spreadsheetId;
    var ssName =
      typeof ss.getName === 'function' && ss.getName()
        ? ss.getName()
        : 'Vidhya Vidhai · Career Tours';
    var ssUrl =
      typeof ss.getUrl === 'function' && ss.getUrl()
        ? ss.getUrl()
        : 'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit';

    var props = PropertiesService.getScriptProperties();
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
      props.setProperty('CONNECTED_SPREADSHEET_NAME', ssName);
      props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
      props.setProperty('CONNECTED_GOOGLE_ACCOUNT', actor.email);
      props.setProperty('CONNECTED_AT', nowIso);
      props.setProperty('CONNECTED_BY', actor.email);
      props.setProperty('CONNECTED_DISCONNECTED', 'false');
      props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(tabs));
    }

    ctInvalidateConfigCache_();
    ctAppendAuditLog_(
      actor,
      'CONNECT_GOOGLE_SHEET',
      'Configuration',
      resolvedId,
      '',
      'Connected "' + ssName + '" (' + tabs.length + ' tabs initialized=' + shouldInit + ')',
      'SUCCESS'
    );

    return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
  } finally {
    lock.releaseLock();
  }
}

function ctHandleCreateGoogleSheet_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var title = String((payload && payload.title) || 'Vidhya Vidhai · Career Tours Database').trim();
  if (!title) {
    throw ctApiError_('INVALID_TITLE', 'Spreadsheet name is required.');
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var ss = SpreadsheetApp.create(title);
    var tabs = ctInitializeSpreadsheetObject_(ss, actor.email);
    var nowIso = ctNowIso_();
    var resolvedId =
      typeof ss.getId === 'function' && ss.getId() ? ss.getId() : CT_DEFAULT_TARGET_SPREADSHEET_ID;
    var ssUrl =
      typeof ss.getUrl === 'function' && ss.getUrl()
        ? ss.getUrl()
        : 'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit';

    var props = PropertiesService.getScriptProperties();
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
      props.setProperty('CONNECTED_SPREADSHEET_NAME', title);
      props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
      props.setProperty('CONNECTED_GOOGLE_ACCOUNT', actor.email);
      props.setProperty('CONNECTED_AT', nowIso);
      props.setProperty('CONNECTED_BY', actor.email);
      props.setProperty('CONNECTED_DISCONNECTED', 'false');
      props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(tabs));
    }

    ctInvalidateConfigCache_();
    ctAppendAuditLog_(
      actor,
      'CREATE_GOOGLE_SHEET',
      'Configuration',
      resolvedId,
      '',
      'Created and initialized "' + title + '"',
      'SUCCESS'
    );

    return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
  } finally {
    lock.releaseLock();
  }
}

function ctHandleDisconnectGoogleSheet_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var prev = ctBuildSheetsConnectionState_();
    ctAppendAuditLog_(
      actor,
      'DISCONNECT_GOOGLE_SHEET',
      'Configuration',
      prev.spreadsheetId || 'NONE',
      prev.spreadsheetName || '',
      'Disconnected sheet link cleanly without modifying spreadsheet data',
      'SUCCESS'
    );

    var props = PropertiesService.getScriptProperties();
    if (typeof props.deleteProperty === 'function') {
      props.deleteProperty('CONNECTED_SPREADSHEET_ID');
      props.deleteProperty('CONNECTED_SPREADSHEET_NAME');
      props.deleteProperty('CONNECTED_SPREADSHEET_URL');
      props.deleteProperty('CONNECTED_GOOGLE_ACCOUNT');
      props.deleteProperty('CONNECTED_AT');
      props.deleteProperty('CONNECTED_BY');
      props.deleteProperty('CONNECTED_TABS_JSON');
    }
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_DISCONNECTED', 'true');
    }

    ctInvalidateConfigCache_();
    return ctBuildSheetsConnectionState_();
  } finally {
    lock.releaseLock();
  }
}

function ctHandleLoadWorkspace_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var ss = ctGetSpreadsheet_();
  if (!ss.getSheetByName(SHEET_NAMES.SESSIONS) || !ss.getSheetByName(SHEET_NAMES.CONFIGURATION)) {
    ctInitializeSpreadsheetObject_(ss, actor.email);
  }
  ctEnsureSheetsConnectionMetadata_(ss, actor.email);

  var sessionsRaw = ctReadAllSessionsWithDetails_(null);
  var sessions = [];
  for (var i = 0; i < sessionsRaw.length; i++) {
    sessions.push(ctStripInternalRowMeta_(sessionsRaw[i]));
  }

  var schoolSheet = ctGetSheet_(SHEET_NAMES.SCHOOLS);
  var schoolLastRow = schoolSheet.getLastRow();
  var schools = [];
  if (schoolLastRow >= 2) {
    var schoolLayout = ctResolveSchoolSheetLayout_(schoolSheet);
    var schoolVals = schoolSheet.getRange(2, 1, schoolLastRow - 1, schoolLayout.colCount).getValues();
    for (var sIdx = 0; sIdx < schoolVals.length; sIdx++) {
      var rec = ctRowToSchoolRecord_(schoolVals[sIdx], schoolLayout.hasBlock);
      if (rec.udiseCode || rec.schoolName) {
        schools.push(rec);
      }
    }
  }

  var users = ctHandleListManagedUsers_(actor);
  var configuration = ctLoadConfiguration_();
  var auditLogs = ctHandleGetAuditLogs_(actor, { page: 1, pageSize: 25 });
  var syncLogs = ctHandleGetSyncLogs_(actor, { page: 1, pageSize: 25 });

  return {
    connection: ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : ''),
    configuration: configuration,
    sessions: sessions,
    schools: schools,
    users: users,
    auditLogs: auditLogs,
    syncLogs: syncLogs,
    loadedAt: ctNowIso_()
  };
}

function ctHandleSyncAllToGoogleSheet_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var state = ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
    if (!state.connected || !state.spreadsheetId) {
      throw ctApiError_(
        'NOT_CONNECTED',
        'Connect a Google Spreadsheet before running a full data sync.'
      );
    }

    var incomingSessions = (payload && Array.isArray(payload.sessions) && payload.sessions) || [];
    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
    var lastRow = sessionSheet.getLastRow();

    var existingRecordIds = {};
    var existingClientKeys = {};
    var existingSessionIds = {};

    if (lastRow >= 2) {
      var cols = sessionSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < cols.length; i++) {
        var rId = ctCellToString_(cols[i][0]);
        var sId = ctCellToString_(cols[i][1]);
        var cKey = ctCellToString_(cols[i][2]);
        if (rId) existingRecordIds[rId] = true;
        if (sId) existingSessionIds[sId] = true;
        if (cKey) existingClientKeys[cKey] = true;
      }
    }

    var syncedCount = 0;
    var skippedDuplicates = 0;
    var syncedSessionsList = [];
    var nowIso = ctNowIso_();

    for (var sIdx = 0; sIdx < incomingSessions.length; sIdx++) {
      var rec = incomingSessions[sIdx];
      if (!rec) continue;
      var recId = ctCellToString_(rec.sessionRecordId);
      var sessId = ctCellToString_(rec.sessionId);
      var clientKey = ctCellToString_(rec.clientSubmissionKey);

      if (
        (recId && existingRecordIds[recId]) ||
        (clientKey && existingClientKeys[clientKey]) ||
        (sessId && existingSessionIds[sessId])
      ) {
        skippedDuplicates++;
        continue;
      }

      if (!recId) rec.sessionRecordId = 'REC_' + Utilities.getUuid().toUpperCase();
      if (!sessId) continue;

      var rowArr = ctSessionRecordToSheetRow_(rec, sessionLayout.hasBlock);
      var targetRow = Math.max(2, ctFindLastPopulatedRow_(sessionSheet, 1) + 1);
      var sessionRange = sessionSheet.getRange(targetRow, 1, 1, sessionLayout.colCount);
      sessionRange.setNumberFormats([
        ctBuildTextFormatRow_(rowArr, sessionLayout.textColumns)
      ]);
      sessionRange.setValues([rowArr]);

      var dets = Array.isArray(rec.details) ? rec.details : [];
      if (dets.length > 0) {
        var detailRows = [];
        var detailFormats = [];
        for (var dIdx = 0; dIdx < dets.length; dIdx++) {
          var dRow = ctDetailRecordToSheetRow_(dets[dIdx]);
          detailRows.push(dRow);
          detailFormats.push(ctBuildTextFormatRow_(dRow, [1, 2, 3, 4, 5]));
        }
        var detailStart = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
        var detRange = detailSheet.getRange(detailStart, 1, detailRows.length, DETAIL_COL_COUNT);
        detRange.setNumberFormats(detailFormats);
        detRange.setValues(detailRows);
      }

      existingRecordIds[rec.sessionRecordId] = true;
      existingSessionIds[rec.sessionId] = true;
      if (clientKey) existingClientKeys[clientKey] = true;
      syncedSessionsList.push(rec);
      syncedCount++;
    }

    var incomingSchools = (payload && Array.isArray(payload.schools) && payload.schools) || [];
    var syncedSchoolsCount = 0;
    for (var schIdx = 0; schIdx < incomingSchools.length; schIdx++) {
      var sch = incomingSchools[schIdx];
      if (!sch || !ctCellToString_(sch.udiseCode) || !ctCellToString_(sch.schoolName)) continue;
      if (!ctFindSchoolByUdise_(sch.udiseCode)) {
        ctUpsertSchoolWithoutOverwrite_(sch, nowIso);
        syncedSchoolsCount++;
      }
    }
    for (var sSchIdx = 0; sSchIdx < syncedSessionsList.length; sSchIdx++) {
      var sRec = syncedSessionsList[sSchIdx];
      if (ctCellToString_(sRec.udiseCode) && ctCellToString_(sRec.schoolName) && !ctFindSchoolByUdise_(sRec.udiseCode)) {
        ctUpsertSchoolWithoutOverwrite_(sRec, nowIso);
        syncedSchoolsCount++;
      }
    }

    var incomingUsers =
      (payload && Array.isArray(payload.facilitators) && payload.facilitators) ||
      (payload && Array.isArray(payload.users) && payload.users) ||
      [];
    var syncedFacilitatorsCount = 0;
    if (incomingUsers.length > 0) {
      var existingFacs = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
      var existingFacEmails = {};
      for (var ef = 0; ef < existingFacs.length; ef++) {
        existingFacEmails[existingFacs[ef].email] = true;
      }
      var facSheetSync = ctGetSheet_(SHEET_NAMES.FACILITATORS);
      for (var uIdx = 0; uIdx < incomingUsers.length; uIdx++) {
        var u = incomingUsers[uIdx];
        if (!u) continue;
        var uEmail = ctCellToString_(u.email).toLowerCase();
        var uRole = ctCellToString_(u.role || 'facilitator').toLowerCase();
        if (!uEmail || ctIsAllowlistedSuperAdmin_(uEmail) || uRole !== 'facilitator') continue;
        if (existingFacEmails[uEmail]) continue;
        var uName = ctCellToString_(u.name || uEmail);
        var uStatusRaw = ctCellToString_(u.status || '').toUpperCase();
        var uStatus =
          uStatusRaw === 'APPROVED' || uStatusRaw === 'PENDING' || uStatusRaw === 'DENIED'
            ? uStatusRaw
            : u.active !== false
            ? 'APPROVED'
            : 'DENIED';
        var uActive = uStatus === 'APPROVED';
        var uId = ctCellToString_(u.userId) || ('FAC_' + ctShortUuid_().slice(0, 8));
        var nextFacRow = Math.max(2, ctFindLastPopulatedRow_(facSheetSync, 1) + 1);
        var facRange = facSheetSync.getRange(nextFacRow, 1, 1, 8);
        facRange.setNumberFormat('@');
        facRange.setValues([[
          uId,
          uName,
          uEmail,
          'facilitator',
          uActive ? 'true' : 'false',
          ctCellToString_(u.createdAt) || nowIso,
          nowIso,
          uStatus
        ]]);
        existingFacEmails[uEmail] = true;
        syncedFacilitatorsCount++;
      }
    }

    var incomingConfig =
      payload && payload.configuration && typeof payload.configuration === 'object'
        ? payload.configuration
        : null;
    if (incomingConfig) {
      var currentCfg = ctLoadConfiguration_();
      var cfgSheetSync = ctGetSheet_(SHEET_NAMES.CONFIGURATION);
      var syncPropMap = {
        programmeTimezone: 'programme_timezone',
        stateName: 'state_name',
        allowedDistricts: 'allowed_districts',
        gradeOptions: 'grade_options',
        sectionOptions: 'section_options',
        schoolTypes: 'school_types',
        tours: 'tours',
        languageOptions: 'language_options',
        languageCodes: 'language_codes',
        schoolYear: 'school_year',
        partnerName: 'partner_name',
        reportingDefaults: 'reporting_defaults',
        policy: 'policy',
        exportTemplate63: 'export_template_63'
      };
      var cfgUpdated = false;
      for (var cProp in syncPropMap) {
        if (
          !Object.prototype.hasOwnProperty.call(incomingConfig, cProp) ||
          incomingConfig[cProp] === undefined
        ) {
          continue;
        }
        var cVal = incomingConfig[cProp];
        if (
          cProp === 'partnerName' &&
          !String(cVal || '').trim() &&
          String(currentCfg.partnerName || '').trim()
        ) {
          continue;
        }
        if (cProp === 'exportTemplate63') {
          if (cVal === null) continue;
          if (!cVal.columns || cVal.columns.length !== 63) continue;
        }
        if (cProp === 'policy' && cVal && typeof cVal === 'object') {
          cVal = {
            allowFacilitatorDeleteOwn: cVal.allowFacilitatorDeleteOwn !== false,
            allowFacilitatorExportOwn: false,
            facilitatorApprovalMode:
              cVal.facilitatorApprovalMode === 'auto_approve' ? 'auto_approve' : 'manual_allowlist'
          };
        }
        ctUpsertConfigKey_(cfgSheetSync, syncPropMap[cProp], cVal, actor.email);
        cfgUpdated = true;
      }
      if (cfgUpdated) {
        ctInvalidateConfigCache_();
      }
    }

    try {
      var ssSync = ctGetSpreadsheet_();
      var cfgSync = ctLoadConfiguration_();
      if (typeof ctRefreshSummaryAndKpisSheet_ === 'function') {
        ctRefreshSummaryAndKpisSheet_(ssSync, cfgSync);
      }
      if (typeof ctRefreshDeclarationsSheet_ === 'function') {
        ctRefreshDeclarationsSheet_(ssSync, cfgSync);
      }
    } catch (refreshErr) {
      // Non-fatal: Summary & KPIs live formulas stay intact
    }

    var totalSheetSessions = Math.max(0, ctFindLastPopulatedRow_(sessionSheet, 1) - 1);
    var props = PropertiesService.getScriptProperties();
    var extras = [];
    if (syncedSchoolsCount > 0) extras.push(syncedSchoolsCount + ' school(s)');
    if (syncedFacilitatorsCount > 0) extras.push(syncedFacilitatorsCount + ' facilitator(s)');
    var extraSuffix = extras.length > 0 ? ' Plus ' + extras.join(' and ') + '.' : '';
    var msg =
      syncedCount > 0
        ? 'Synced ' +
          syncedCount +
          ' session(s); skipped ' +
          skippedDuplicates +
          ' existing duplicate(s).' +
          extraSuffix
        : 'Verified ' +
          totalSheetSessions +
          ' session(s) up to date (0 duplicates overwritten).' +
          extraSuffix;

    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_LAST_SYNC_AT', nowIso);
      props.setProperty('CONNECTED_LAST_SYNC_STATUS', 'SYNCED');
      props.setProperty('CONNECTED_LAST_SYNC_MESSAGE', msg);
    }

    ctAppendAuditLog_(actor, 'SYNC_GOOGLE_SHEET', 'Configuration', state.spreadsheetId, '', msg, 'SUCCESS');
    ctAppendSyncLog_(actor, 'BULK_SYNC', state.spreadsheetId, 'ALL', 'syncAllToGoogleSheet', 1, 'SYNCED', '');

    return {
      syncedCount: syncedCount,
      skippedDuplicates: skippedDuplicates,
      syncedSchoolsCount: syncedSchoolsCount,
      syncedFacilitatorsCount: syncedFacilitatorsCount,
      totalSheetSessions: totalSheetSessions,
      syncedAt: nowIso,
      message: msg
    };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleGetTeamIntakeConfig_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var intakeKey = ctConfigureFacilitatorIntakeKey_('');
  var cfg = ctLoadConfiguration_();
  return {
    configured: Boolean(intakeKey && intakeKey.length >= 16),
    intakeKey: intakeKey,
    approvalMode:
      cfg && cfg.policy && cfg.policy.facilitatorApprovalMode === 'auto_approve'
        ? 'auto_approve'
        : 'manual_allowlist',
    updatedAt: ctNowIso_()
  };
}

function ctHandleRotateTeamIntakeKey_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var nextKey = ctConfigureFacilitatorIntakeKey_('', true);
    var cfg = ctLoadConfiguration_();
    ctAppendAuditLog_(
      actor,
      'ROTATE_TEAM_INTAKE_KEY',
      'Security',
      'FACILITATOR_INTAKE_KEY',
      '',
      'Rotated Facilitator Team Submission Intake Key (previous share links invalidated)',
      'SUCCESS'
    );
    return {
      configured: true,
      intakeKey: nextKey,
      approvalMode:
        cfg && cfg.policy && cfg.policy.facilitatorApprovalMode === 'auto_approve'
          ? 'auto_approve'
          : 'manual_allowlist',
      updatedAt: ctNowIso_()
    };
  } finally {
    lock.releaseLock();
  }
}

function ctConvertIncomingSessionToFormValues_(rec, fallbackActorEmail) {
  var facEmail = ctCellToString_(rec.facilitatorEmail).toLowerCase() || String(fallbackActorEmail || '').toLowerCase();
  var rawDetails = Array.isArray(rec.details) && rec.details.length > 0 ? rec.details : [];
  var classes = [];
  for (var i = 0; i < rawDetails.length; i++) {
    var d = rawDetails[i] || {};
    classes.push({
      rowId: String(d.detailRecordId || ('imp_' + (i + 1))),
      grade: String(d.grade || ''),
      section: String(d.section || ''),
      studentsPresent: String(d.studentsPresent !== undefined ? d.studentsPresent : ''),
      questionA: {
        score5: String(d.questionAScore5 !== undefined ? d.questionAScore5 : 0),
        score4: String(d.questionAScore4 !== undefined ? d.questionAScore4 : 0),
        score3: String(d.questionAScore3 !== undefined ? d.questionAScore3 : 0),
        score2: String(d.questionAScore2 !== undefined ? d.questionAScore2 : 0),
        score1: String(d.questionAScore1 !== undefined ? d.questionAScore1 : 0)
      },
      questionB: {
        score5: String(d.questionBScore5 !== undefined ? d.questionBScore5 : 0),
        score4: String(d.questionBScore4 !== undefined ? d.questionBScore4 : 0),
        score3: String(d.questionBScore3 !== undefined ? d.questionBScore3 : 0),
        score2: String(d.questionBScore2 !== undefined ? d.questionBScore2 : 0),
        score1: String(d.questionBScore1 !== undefined ? d.questionBScore1 : 0)
      }
    });
  }

  var npsGroup = String(rec.teacherNpsGroup || '').trim().toLowerCase();
  if (npsGroup !== 'promoter' && npsGroup !== 'passive' && npsGroup !== 'detractor') {
    var scoreVal = ctCellToNumOrNull_(rec.teacherScore);
    if (scoreVal !== null) {
      npsGroup = scoreVal >= 9 ? 'promoter' : scoreVal >= 7 ? 'passive' : 'detractor';
    } else {
      var clsLabel = ctCellToString_(rec.teacherClassification).toLowerCase();
      npsGroup = clsLabel === 'detractor' ? 'detractor' : clsLabel === 'passive' ? 'passive' : 'promoter';
    }
  }

  var sessionMode = rec.sessionType === 'combined' || classes.length > 1 ? 'combined' : 'single';
  var startDate = ctCellToString_(rec.startDate);
  var endDate = ctCellToString_(rec.endDate) || startDate;

  return {
    clientSubmissionKey: ctCellToString_(rec.clientSubmissionKey),
    facilitatorName: ctCellToString_(rec.facilitatorName) || facEmail,
    facilitatorEmail: facEmail,
    tourId: ctCellToString_(rec.tourId),
    language: ctCellToString_(rec.language),
    startDate: startDate,
    endDate: endDate,
    startTime: ctCellToString_(rec.startTime),
    endTime: ctCellToString_(rec.endTime),
    schoolName: ctCellToString_(rec.schoolName),
    udiseCode: ctCellToString_(rec.udiseCode),
    schoolType: ctCellToString_(rec.schoolType),
    state: ctCellToString_(rec.state) || 'Tamil Nadu',
    district: ctCellToString_(rec.district),
    pinCode: ctCellToString_(rec.pinCode),
    sessionMode: sessionMode,
    classes: classes,
    teacherNpsGroup: npsGroup,
    teacherExactScore:
      rec.teacherScore !== null && rec.teacherScore !== undefined && String(rec.teacherScore).trim() !== ''
        ? String(rec.teacherScore)
        : ''
  };
}

/**
 * Verified import / recovery of facilitator transfer packages or backup session records.
 * Validates schema server-side, recomputes CSAT/ITP/NPS, deduplicates against existing IDs,
 * registers missing non-admin facilitators as APPROVED, and upserts Schools without overwrite.
 */
function ctHandleImportSessions_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var incoming = (payload && Array.isArray(payload.sessions) && payload.sessions) || null;
  if (!incoming || incoming.length === 0) {
    throw ctApiError_('BAD_REQUEST', 'Select a transfer or backup package containing at least one session.');
  }

  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var config = ctLoadConfiguration_();
    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var facSheet = ctGetSheet_(SHEET_NAMES.FACILITATORS);
    var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
    var lastRow = sessionSheet.getLastRow();

    var existingRecordIds = {};
    var existingSessionIds = {};
    var existingClientKeys = {};

    if (lastRow >= 2) {
      var cols = sessionSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < cols.length; i++) {
        var rId = ctCellToString_(cols[i][0]);
        var sId = ctCellToString_(cols[i][1]);
        var cKey = ctCellToString_(cols[i][2]);
        if (rId) existingRecordIds[rId] = true;
        if (sId) existingSessionIds[sId] = true;
        if (cKey) existingClientKeys[cKey] = true;
      }
    }

    var facRows = ctReadUserRowsFromSheet_(SHEET_NAMES.FACILITATORS);
    var knownFacByEmail = {};
    for (var fi = 0; fi < facRows.length; fi++) {
      knownFacByEmail[facRows[fi].email] = facRows[fi];
    }

    var importedCount = 0;
    var skippedDuplicates = 0;
    var rejectedCount = 0;
    var registeredFacilitators = 0;
    var registeredSchools = 0;
    var errors = [];
    var nowIso = ctNowIso_();

    for (var idx = 0; idx < incoming.length; idx++) {
      var raw = incoming[idx];
      if (!raw || typeof raw !== 'object') {
        rejectedCount++;
        errors.push({ index: idx, sessionId: '', message: 'Malformed record entry.' });
        continue;
      }

      var rawRecId = ctCellToString_(raw.sessionRecordId);
      var rawSessId = ctCellToString_(raw.sessionId);
      var rawClientKey = ctCellToString_(raw.clientSubmissionKey);

      if (
        (rawRecId && existingRecordIds[rawRecId]) ||
        (rawClientKey && existingClientKeys[rawClientKey]) ||
        (rawSessId && existingSessionIds[rawSessId])
      ) {
        skippedDuplicates++;
        continue;
      }

      var values = ctConvertIncomingSessionToFormValues_(raw, actor.email);
      var validation = ctValidateSessionForm_(values, config);
      if (!validation.valid) {
        var errMsgs = [];
        for (var e = 0; e < validation.errors.length; e++) errMsgs.push(validation.errors[e].message);
        rejectedCount++;
        errors.push({
          index: idx,
          sessionId: rawSessId || rawRecId || ('Row ' + (idx + 1)),
          message: errMsgs.join(' ')
        });
        continue;
      }

      var tour = null;
      for (var tIdx = 0; tIdx < (config.tours || []).length; tIdx++) {
        if (config.tours[tIdx].tourId === values.tourId) {
          tour = config.tours[tIdx];
          break;
        }
      }

      var prefix = ctBuildSessionIdPrefix_(values.startDate, values.udiseCode, values.sessionMode, values.classes);
      var sessionId = rawSessId && !existingSessionIds[rawSessId] ? rawSessId : '';
      if (!sessionId) {
        var maxSeq = 0;
        for (var ek in existingSessionIds) {
          if (ek.indexOf(prefix + '_') === 0) {
            var sp = parseInt(ek.slice(prefix.length + 1), 10);
            if (!isNaN(sp) && sp > maxSeq) maxSeq = sp;
          }
        }
        var seq = maxSeq + 1;
        sessionId = ctFormatSessionIdWithSequence_(prefix, seq);
        while (existingSessionIds[sessionId]) {
          seq++;
          sessionId = ctFormatSessionIdWithSequence_(prefix, seq);
        }
      }

      var sessionRecordId = rawRecId || ('REC_' + Utilities.getUuid().toUpperCase());
      var metrics = ctCalculateSessionMetrics_(values.classes, values.teacherNpsGroup, values.teacherExactScore);
      var durationMinutes =
        ctCalculateSessionDurationMinutes_(values.startDate, values.startTime, values.endDate, values.endTime) || 0;
      var videoInfo = ctResolveConfiguredVideoId_(tour, values.language);

      var facEmail = values.facilitatorEmail;
      var facUserId = ctCellToString_(raw.facilitatorUserId);
      var matchedAdmin = ctFindInitialSuperAdminByEmail_(facEmail);
      if (matchedAdmin) {
        facUserId = matchedAdmin.userId;
      } else if (knownFacByEmail[facEmail]) {
        facUserId = knownFacByEmail[facEmail].userId || facUserId || ('USR_' + facEmail);
      } else {
        facUserId = facUserId || ('FAC_' + ctShortUuid_().slice(0, 8));
        var newFacRowIdx = Math.max(2, ctFindLastPopulatedRow_(facSheet, 1) + 1);
        var facRng = facSheet.getRange(newFacRowIdx, 1, 1, 8);
        facRng.setNumberFormat('@');
        facRng.setValues([[
          facUserId,
          values.facilitatorName || facEmail,
          facEmail,
          'facilitator',
          'true',
          nowIso,
          nowIso,
          'APPROVED'
        ]]);
        knownFacByEmail[facEmail] = { userId: facUserId, email: facEmail, status: 'APPROVED', active: true };
        registeredFacilitators++;
      }

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
          createdAt: ctCellToString_(raw.createdAt) || nowIso,
          updatedAt: nowIso
        };
        detailRecords.push(detObj);
        detailRows.push(ctDetailRecordToSheetRow_(detObj));
      }

      var finalStatus = raw.submissionStatus === 'CORRECTED' ? 'CORRECTED' : 'COMMITTED';
      var newRec = {
        sessionRecordId: sessionRecordId,
        sessionId: sessionId,
        clientSubmissionKey: values.clientSubmissionKey || ('IMP_' + sessionRecordId),
        facilitatorName: values.facilitatorName,
        facilitatorEmail: facEmail,
        facilitatorUserId: facUserId,
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
        submissionTimestamp: ctCellToString_(raw.submissionTimestamp) || nowIso,
        submissionDateFormatted:
          ctCellToString_(raw.submissionDateFormatted) || ctFormatISODateToDDMMYYYY_(ctGetTodayKolkataISO_()),
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
        createdAt: ctCellToString_(raw.createdAt) || nowIso,
        updatedAt: nowIso,
        createdBy: facEmail,
        updatedBy: actor.email,
        archived: Boolean(raw.archived),
        details: detailRecords
      };

      var targetSessionRowIdx = Math.max(2, ctFindLastPopulatedRow_(sessionSheet, 1) + 1);
      var sessionRowArr = ctSessionRecordToSheetRow_(newRec, sessionLayout.hasBlock);
      var sessionRange = sessionSheet.getRange(targetSessionRowIdx, 1, 1, sessionLayout.colCount);
      sessionRange.setNumberFormats([ctBuildTextFormatRow_(sessionRowArr, sessionLayout.textColumns)]);
      sessionRange.setValues([sessionRowArr]);

      var detailStart = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
      var detailRange = detailSheet.getRange(detailStart, 1, detailRows.length, DETAIL_COL_COUNT);
      var detFormats = [];
      for (var df = 0; df < detailRows.length; df++) {
        detFormats.push(ctBuildTextFormatRow_(detailRows[df], [1, 2, 3, 4, 5]));
      }
      detailRange.setNumberFormats(detFormats);
      detailRange.setValues(detailRows);

      SpreadsheetApp.flush();
      sessionSheet.getRange(targetSessionRowIdx, sessionLayout.statusCol).setValue(finalStatus);
      newRec.submissionStatus = finalStatus;

      if (!ctFindSchoolByUdise_(values.udiseCode)) {
        ctUpsertSchoolWithoutOverwrite_(values, nowIso);
        registeredSchools++;
      } else {
        ctUpsertSchoolWithoutOverwrite_(values, nowIso);
      }

      existingRecordIds[sessionRecordId] = true;
      existingSessionIds[sessionId] = true;
      if (newRec.clientSubmissionKey) existingClientKeys[newRec.clientSubmissionKey] = true;
      importedCount++;
    }

    try {
      var ssImp = ctGetSpreadsheet_();
      var cfgImp = ctLoadConfiguration_();
      if (typeof ctRefreshSummaryAndKpisSheet_ === 'function') ctRefreshSummaryAndKpisSheet_(ssImp, cfgImp);
      if (typeof ctRefreshDeclarationsSheet_ === 'function') ctRefreshDeclarationsSheet_(ssImp, cfgImp);
    } catch (ignoreRefresh) {}

    ctAppendAuditLog_(
      actor,
      'IMPORT_SESSIONS',
      'Session',
      'IMPORT',
      '',
      'Imported ' +
        importedCount +
        ' verified session(s); skipped ' +
        skippedDuplicates +
        ' duplicate(s); rejected ' +
        rejectedCount,
      importedCount > 0 ? 'SUCCESS' : rejectedCount > 0 ? 'DENIED' : 'SUCCESS'
    );
    ctAppendSyncLog_(
      actor,
      'IMPORT_PACKAGE',
      'IMPORT',
      String(importedCount),
      'importSessions',
      1,
      'SYNCED',
      rejectedCount > 0 ? rejectedCount + ' record(s) failed validation' : ''
    );

    return {
      importedCount: importedCount,
      skippedDuplicates: skippedDuplicates,
      rejectedCount: rejectedCount,
      registeredFacilitators: registeredFacilitators,
      registeredSchools: registeredSchools,
      errors: errors,
      importedAt: nowIso
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ensures the target spreadsheet for a Supabase Edge Function webhook call is open
 * and initialized with all required career tour tabs before mirroring rows.
 */
function ctEnsureWebhookSpreadsheetReady_(actor, payload, req) {
  var requestedId = ctParseSpreadsheetId_(
    (payload && (payload.spreadsheetId || payload.spreadsheetUrlOrId)) ||
      (req && req.spreadsheetId) ||
      ''
  );
  var props = PropertiesService.getScriptProperties();
  var currentConnectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  var needsAttach = Boolean(requestedId && requestedId !== currentConnectedId);

  if (!needsAttach) {
    try {
      var currentSs = ctGetSpreadsheet_();
      var hasSessionsTab = Boolean(currentSs && currentSs.getSheetByName(SHEET_NAMES.SESSIONS));
      var hasDetailsTab = Boolean(currentSs && currentSs.getSheetByName(SHEET_NAMES.SESSION_DETAILS));
      if (hasSessionsTab && hasDetailsTab) {
        return ctBuildSheetsConnectionState_(actor && actor.email ? actor.email : '');
      }
      needsAttach = true;
      if (!requestedId && typeof currentSs.getId === 'function') {
        requestedId = String(currentSs.getId() || '').trim();
      }
    } catch (missingErr) {
      needsAttach = true;
    }
  }

  return ctHandleConnectGoogleSheet_(actor, {
    spreadsheetUrlOrId: requestedId || CT_DEFAULT_TARGET_SPREADSHEET_ID,
    initializeSchema: true
  });
}

function ctHandlePingWebhook_(actor, payload, req) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var state = ctEnsureWebhookSpreadsheetReady_(actor, payload, req);
    return {
      reachable: true,
      spreadsheetId: state.spreadsheetId,
      spreadsheetName: state.spreadsheetName,
      spreadsheetUrl: state.spreadsheetUrl,
      initializedTabs: state.initializedTabs || [],
      message: 'Apps Script webhook connected and sheet schema verified.'
    };
  } finally {
    lock.releaseLock();
  }
}

function ctWriteWebhookSessionDetails_(detailSheet, sessionRecordId, details) {
  var existingRows = ctFindDetailRowsBySessionRecordId_(sessionRecordId);
  var list = Array.isArray(details) ? details : [];
  var minLen = Math.min(existingRows.length, list.length);

  for (var i = 0; i < minLen; i++) {
    var uArr = ctDetailRecordToSheetRow_(list[i]);
    var uRange = detailSheet.getRange(existingRows[i]._rowNumber, 1, 1, DETAIL_COL_COUNT);
    uRange.setNumberFormats([ctBuildTextFormatRow_(uArr, [1, 2, 3, 4, 5])]);
    uRange.setValues([uArr]);
  }
  if (list.length > existingRows.length) {
    var toAppend = [];
    var toAppendFmt = [];
    for (var a = existingRows.length; a < list.length; a++) {
      var aArr = ctDetailRecordToSheetRow_(list[a]);
      toAppend.push(aArr);
      toAppendFmt.push(ctBuildTextFormatRow_(aArr, [1, 2, 3, 4, 5]));
    }
    var appendStart = Math.max(2, ctFindLastPopulatedRow_(detailSheet, 1) + 1);
    var appRange = detailSheet.getRange(appendStart, 1, toAppend.length, DETAIL_COL_COUNT);
    appRange.setNumberFormats(toAppendFmt);
    appRange.setValues(toAppend);
  } else if (existingRows.length > list.length) {
    for (var d = existingRows.length - 1; d >= list.length; d--) {
      detailSheet.deleteRow(existingRows[d]._rowNumber);
    }
  }
}

function ctHandleUpsertSessionWebhook_(actor, payload, req) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    var state = ctEnsureWebhookSpreadsheetReady_(actor, payload, req);
    var rec = (payload && payload.session) || (req && req.session) || null;
    if (!rec || !ctCellToString_(rec.sessionRecordId) || !ctCellToString_(rec.sessionId)) {
      throw ctApiError_('BAD_REQUEST', 'session payload with sessionRecordId and sessionId is required.');
    }

    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
    var sessionLayout = ctResolveSessionSheetLayout_(sessionSheet);
    var lastRow = sessionSheet.getLastRow();

    var targetRecId = ctCellToString_(rec.sessionRecordId);
    var targetSessId = ctCellToString_(rec.sessionId);
    var targetClientKey = ctCellToString_(rec.clientSubmissionKey);
    var matchedRowNumber = -1;

    if (lastRow >= 2) {
      var cols = sessionSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < cols.length; i++) {
        var rId = ctCellToString_(cols[i][0]);
        var sId = ctCellToString_(cols[i][1]);
        var cKey = ctCellToString_(cols[i][2]);
        if (
          (targetRecId && rId === targetRecId) ||
          (targetClientKey && cKey === targetClientKey) ||
          (targetSessId && sId === targetSessId)
        ) {
          matchedRowNumber = i + 2;
          break;
        }
      }
    }

    var rowArr = ctSessionRecordToSheetRow_(rec, sessionLayout.hasBlock);
    var destRow = matchedRowNumber > 0
      ? matchedRowNumber
      : Math.max(2, ctFindLastPopulatedRow_(sessionSheet, 1) + 1);
    var sessionRange = sessionSheet.getRange(destRow, 1, 1, sessionLayout.colCount);
    sessionRange.setNumberFormats([
      ctBuildTextFormatRow_(rowArr, sessionLayout.textColumns)
    ]);
    sessionRange.setValues([rowArr]);

    ctWriteWebhookSessionDetails_(detailSheet, targetRecId, rec.details);

    var nowIso = ctNowIso_();
    if (ctCellToString_(rec.udiseCode) && ctCellToString_(rec.schoolName)) {
      ctUpsertSchoolWithoutOverwrite_(rec, nowIso);
    }

    try {
      var ssUp = ctGetSpreadsheet_();
      var cfgUp = ctLoadConfiguration_();
      if (typeof ctRefreshSummaryAndKpisSheet_ === 'function') ctRefreshSummaryAndKpisSheet_(ssUp, cfgUp);
      if (typeof ctRefreshDeclarationsSheet_ === 'function') ctRefreshDeclarationsSheet_(ssUp, cfgUp);
    } catch (ignoreRefresh) {}

    var props = PropertiesService.getScriptProperties();
    var msg = (matchedRowNumber > 0 ? 'Updated ' : 'Synced ') + targetSessId + ' via webhook.';
    if (typeof props.setProperty === 'function') {
      props.setProperty('CONNECTED_LAST_SYNC_AT', nowIso);
      props.setProperty('CONNECTED_LAST_SYNC_STATUS', 'SYNCED');
      props.setProperty('CONNECTED_LAST_SYNC_MESSAGE', msg);
    }

    ctAppendSyncLog_(
      actor,
      targetClientKey || 'WEBHOOK',
      targetRecId,
      targetSessId,
      'upsertSession',
      1,
      'SYNCED',
      ''
    );

    return {
      syncedCount: 1,
      updatedExisting: matchedRowNumber > 0,
      spreadsheetId: state.spreadsheetId,
      sessionRecordId: targetRecId,
      sessionId: targetSessId,
      syncedAt: nowIso,
      message: msg
    };
  } finally {
    lock.releaseLock();
  }
}

function ctHandleSyncAllWebhook_(actor, payload, req) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = ctAcquireScriptLockWithRetry_(20000, 3);
  try {
    ctEnsureWebhookSpreadsheetReady_(actor, payload, req);
    var mergedPayload = payload ? JSON.parse(JSON.stringify(payload)) : {};
    if (!Array.isArray(mergedPayload.sessions) && req && Array.isArray(req.sessions)) {
      mergedPayload.sessions = req.sessions;
    }
    if (!Array.isArray(mergedPayload.schools) && req && Array.isArray(req.schools)) {
      mergedPayload.schools = req.schools;
    }
    if (!Array.isArray(mergedPayload.facilitators) && req && Array.isArray(req.facilitators)) {
      mergedPayload.facilitators = req.facilitators;
    }
    return ctHandleSyncAllToGoogleSheet_(actor, mergedPayload);
  } finally {
    lock.releaseLock();
  }
}
