/**
 * Admin.gs — Server-side analytics aggregation, block master import, and user/role management.
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
      scInit.block = s.block;
      schoolMap[s.udiseCode] = scInit;
    }
    var scAgg = schoolMap[s.udiseCode];
    scAgg.sessions++;
    scAgg.schoolName = s.schoolName;
    scAgg.block = s.block;
    scAgg.npsSum += s.teacherNps;

    var monthKey = /^\d{4}-\d{2}/.test(s.startDate) ? s.startDate.slice(0, 7) : 'Unknown';
    if (!monthMap[monthKey]) monthMap[monthKey] = makeGroup();
    var mAgg = monthMap[monthKey];
    mAgg.sessions++;
    mAgg.npsSum += s.teacherNps;

    if (!tourMap[s.tourId]) {
      var tInit = makeGroup();
      tInit.tourName = s.tourName;
      tourMap[s.tourId] = tInit;
    }
    var tAgg = tourMap[s.tourId];
    tAgg.sessions++;
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
      facMap[s.facilitatorEmail] = fInit;
    }
    var fAgg = facMap[s.facilitatorEmail];
    fAgg.sessions++;
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
      block: sv.block,
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
      averageCsat: tQa.average,
      averageItp: tQb.average,
      positiveCsatPct: tQa.positivePct,
      positiveItpPct: tQb.positivePct
    });
  }

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

function ctHandleImportBlockMaster_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var entries = (payload && payload.entries) || [];
  var replaceExisting = Boolean(payload && payload.replaceExisting);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var config = ctLoadConfiguration_();
    var validMap = {};

    if (!replaceExisting && config.districtBlocks) {
      for (var eIdx = 0; eIdx < config.districtBlocks.length; eIdx++) {
        var existing = config.districtBlocks[eIdx];
        validMap[existing.district + '::' + existing.block.toLowerCase()] = existing;
      }
    }

    var importedCount = 0;
    for (var i = 0; i < entries.length; i++) {
      var row = entries[i];
      var d = String((row && row.district) || '').trim();
      var b = String((row && row.block) || '').trim();
      if (!ctArrayIncludes_(config.allowedDistricts, d) || !b) {
        throw ctApiError_(
          'INVALID_BLOCK_ROW',
          'Invalid district/block entry: "' + d + '" / "' + b + '".'
        );
      }
      validMap[d + '::' + b.toLowerCase()] = {
        district: d,
        block: b,
        active: row.active !== false
      };
      importedCount++;
    }

    var nextBlocks = [];
    for (var k in validMap) {
      nextBlocks.push(validMap[k]);
    }

    var cfgSheet = ctGetSheet_(SHEET_NAMES.CONFIGURATION);
    ctUpsertConfigKey_(cfgSheet, 'district_blocks', nextBlocks, actor.email);
    ctInvalidateConfigCache_();

    ctAppendAuditLog_(
      actor,
      'IMPORT_BLOCKS',
      'Configuration',
      'BLOCKS',
      'replace=' + replaceExisting,
      'imported=' + importedCount + ', total=' + nextBlocks.length,
      'SUCCESS'
    );

    return { importedCount: importedCount, totalCount: nextBlocks.length };
  } finally {
    lock.releaseLock();
  }
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
      'Administrator privileges are restricted exclusively to the two approved Super Administrator accounts.'
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

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
    var newRowIdx = Math.max(2, facSheet.getLastRow() + 1);
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

function ctSafeJsonParseArray_(str, fallback) {
  if (!str) return fallback;
  try {
    var parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function ctBuildSheetsConnectionState_() {
  var props = PropertiesService.getScriptProperties();
  var disconnected = String(props.getProperty('CONNECTED_DISCONNECTED') || '') === 'true';
  var connectedId = String(props.getProperty('CONNECTED_SPREADSHEET_ID') || '').trim();
  var fallbackId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  var effectiveId = !disconnected ? (connectedId || fallbackId) : connectedId;

  if (!effectiveId) {
    return {
      connected: false,
      authMethod: 'apps_script',
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
      }
    } catch (ignore) {
      // Ignore metadata probe failures when building state summary
    }
  }

  return {
    connected: true,
    authMethod: 'apps_script',
    oauthConfigured: true,
    connectedAccount: String(props.getProperty('CONNECTED_GOOGLE_ACCOUNT') || ''),
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
  return ctBuildSheetsConnectionState_();
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

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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

    ctAppendAuditLog_(
      actor,
      'CONNECT_GOOGLE_SHEET',
      'Configuration',
      resolvedId,
      '',
      'Connected "' + ssName + '" (' + tabs.length + ' tabs initialized=' + shouldInit + ')',
      'SUCCESS'
    );

    return ctBuildSheetsConnectionState_();
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

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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

    ctAppendAuditLog_(
      actor,
      'CREATE_GOOGLE_SHEET',
      'Configuration',
      resolvedId,
      '',
      'Created and initialized "' + title + '"',
      'SUCCESS'
    );

    return ctBuildSheetsConnectionState_();
  } finally {
    lock.releaseLock();
  }
}

function ctHandleDisconnectGoogleSheet_(actor) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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

    return ctBuildSheetsConnectionState_();
  } finally {
    lock.releaseLock();
  }
}

function ctHandleSyncAllToGoogleSheet_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var state = ctBuildSheetsConnectionState_();
    if (!state.connected || !state.spreadsheetId) {
      throw ctApiError_(
        'NOT_CONNECTED',
        'Connect a Google Spreadsheet before running a full data sync.'
      );
    }

    var incomingSessions = (payload && Array.isArray(payload.sessions) && payload.sessions) || [];
    var sessionSheet = ctGetSheet_(SHEET_NAMES.SESSIONS);
    var detailSheet = ctGetSheet_(SHEET_NAMES.SESSION_DETAILS);
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

      var rowArr = ctSessionRecordToSheetRow_(rec);
      var targetRow = Math.max(2, sessionSheet.getLastRow() + 1);
      var sessionRange = sessionSheet.getRange(targetRow, 1, 1, SESSION_COL_COUNT);
      sessionRange.setNumberFormats([
        ctBuildTextFormatRow_(rowArr, [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 26, 37, 38, 39, 42])
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
        var detailStart = Math.max(2, detailSheet.getLastRow() + 1);
        var detRange = detailSheet.getRange(detailStart, 1, detailRows.length, DETAIL_COL_COUNT);
        detRange.setNumberFormats(detailFormats);
        detRange.setValues(detailRows);
      }

      existingRecordIds[rec.sessionRecordId] = true;
      existingSessionIds[rec.sessionId] = true;
      if (clientKey) existingClientKeys[clientKey] = true;
      syncedCount++;
    }

    var totalSheetSessions = Math.max(0, sessionSheet.getLastRow() - 1);
    var props = PropertiesService.getScriptProperties();
    var msg =
      syncedCount > 0
        ? 'Synced ' + syncedCount + ' session(s); skipped ' + skippedDuplicates + ' existing duplicate(s).'
        : 'Verified ' + totalSheetSessions + ' session(s) up to date (0 duplicates overwritten).';

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
      totalSheetSessions: totalSheetSessions,
      syncedAt: nowIso,
      message: msg
    };
  } finally {
    lock.releaseLock();
  }
}
