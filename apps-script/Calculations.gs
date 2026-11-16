/**
 * Calculations.gs — Pure server-side calculations for CSAT, ITP, Teacher NPS, Duration, and Session IDs.
 * Written as pure JavaScript so both Google Apps Script V8 and Node verification suites execute identical logic.
 */

var CT_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function ctRound1_(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function ctRound2_(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ctParseCountForCalc_(raw) {
  if (raw === null || raw === undefined) return 0;
  var trimmed = String(raw).trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return 0;
  return parseInt(trimmed, 10);
}

function ctIsValidWholeNumberString_(raw, allowEmpty) {
  if (raw === null || raw === undefined) return !!allowEmpty;
  var trimmed = String(raw).trim();
  if (trimmed === '') return !!allowEmpty;
  return /^\d+$/.test(trimmed);
}

function ctToNumericCounts_(counts) {
  var c = counts || {};
  return {
    score5: ctParseCountForCalc_(c.score5),
    score4: ctParseCountForCalc_(c.score4),
    score3: ctParseCountForCalc_(c.score3),
    score2: ctParseCountForCalc_(c.score2),
    score1: ctParseCountForCalc_(c.score1)
  };
}

function ctCalculateScaleMetrics_(counts) {
  var total = counts.score5 + counts.score4 + counts.score3 + counts.score2 + counts.score1;
  var weighted =
    5 * counts.score5 +
    4 * counts.score4 +
    3 * counts.score3 +
    2 * counts.score2 +
    1 * counts.score1;

  if (total === 0) {
    return { total: 0, weighted: 0, average: null };
  }
  return {
    total: total,
    weighted: weighted,
    average: ctRound2_(weighted / total)
  };
}

function ctCalculateScaleSentiment_(counts) {
  var c = counts || { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 };
  var scale = ctCalculateScaleMetrics_(c);
  var positiveCount = Number(c.score4 || 0) + Number(c.score5 || 0);
  var neutralCount = Number(c.score3 || 0);
  var negativeCount = Number(c.score1 || 0) + Number(c.score2 || 0);
  if (scale.total === 0) {
    return {
      total: 0,
      weighted: 0,
      exactAverage: null,
      average: null,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      positivePct: null,
      neutralPct: null,
      negativePct: null
    };
  }
  return {
    total: scale.total,
    weighted: scale.weighted,
    exactAverage: scale.weighted / scale.total,
    average: scale.average,
    positiveCount: positiveCount,
    neutralCount: neutralCount,
    negativeCount: negativeCount,
    positivePct: (positiveCount / scale.total) * 100,
    neutralPct: (neutralCount / scale.total) * 100,
    negativePct: (negativeCount / scale.total) * 100
  };
}

function ctResolveTeacherNps_(group, exactScoreRaw) {
  var trimmed = exactScoreRaw !== null && exactScoreRaw !== undefined ? String(exactScoreRaw).trim() : '';
  if (trimmed !== '' && /^(10|[0-9])$/.test(trimmed)) {
    var score = parseInt(trimmed, 10);
    if (score >= 9) return { exactScore: score, classification: 'Promoter', nps: 100 };
    if (score >= 7) return { exactScore: score, classification: 'Passive', nps: 0 };
    return { exactScore: score, classification: 'Detractor', nps: -100 };
  }

  if (group === 'promoter') return { exactScore: null, classification: 'Promoter', nps: 100 };
  if (group === 'passive') return { exactScore: null, classification: 'Passive', nps: 0 };
  if (group === 'detractor') return { exactScore: null, classification: 'Detractor', nps: -100 };

  return { exactScore: null, classification: null, nps: null };
}

function ctCalculateSessionMetrics_(classes, teacherNpsGroup, teacherExactScore) {
  var rows = classes || [];
  var classBreakdown = [];
  var totalStudentsPresent = 0;
  var totalQuestionAResponses = 0;
  var totalQuestionAWeighted = 0;
  var totalQuestionBResponses = 0;
  var totalQuestionBWeighted = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var present = ctParseCountForCalc_(row.studentsPresent);
    var qACounts = ctToNumericCounts_(row.questionA);
    var qBCounts = ctToNumericCounts_(row.questionB);
    var qA = ctCalculateScaleMetrics_(qACounts);
    var qB = ctCalculateScaleMetrics_(qBCounts);

    totalStudentsPresent += present;
    totalQuestionAResponses += qA.total;
    totalQuestionAWeighted += qA.weighted;
    totalQuestionBResponses += qB.total;
    totalQuestionBWeighted += qB.weighted;

    classBreakdown.push({
      rowId: row.rowId || ('row-' + (i + 1)),
      grade: String(row.grade || ''),
      section: String(row.section || ''),
      studentsPresent: present,
      questionACounts: qACounts,
      questionBCounts: qBCounts,
      questionATotal: qA.total,
      questionAWeighted: qA.weighted,
      csatAverage: qA.average,
      questionACoveragePct: present > 0 ? ctRound2_((qA.total / present) * 100) : null,
      questionBTotal: qB.total,
      questionBWeighted: qB.weighted,
      itpAverage: qB.average,
      questionBCoveragePct: present > 0 ? ctRound2_((qB.total / present) * 100) : null
    });
  }

  // Pooled combined-class average: sum(weighted scores) / sum(total responses)
  var overallCsat =
    totalQuestionAResponses > 0 ? ctRound2_(totalQuestionAWeighted / totalQuestionAResponses) : null;
  var overallItp =
    totalQuestionBResponses > 0 ? ctRound2_(totalQuestionBWeighted / totalQuestionBResponses) : null;

  var teacher = ctResolveTeacherNps_(teacherNpsGroup, teacherExactScore);

  return {
    totalClasses: classBreakdown.length,
    totalStudentsPresent: totalStudentsPresent,
    totalQuestionAResponses: totalQuestionAResponses,
    totalQuestionAWeighted: totalQuestionAWeighted,
    overallCsat: overallCsat,
    overallQuestionACoveragePct:
      totalStudentsPresent > 0 ? ctRound2_((totalQuestionAResponses / totalStudentsPresent) * 100) : null,
    totalQuestionBResponses: totalQuestionBResponses,
    totalQuestionBWeighted: totalQuestionBWeighted,
    overallItp: overallItp,
    overallQuestionBCoveragePct:
      totalStudentsPresent > 0 ? ctRound2_((totalQuestionBResponses / totalStudentsPresent) * 100) : null,
    teacherScoreExact: teacher.exactScore,
    teacherClassification: teacher.classification,
    teacherNps: teacher.nps,
    classBreakdown: classBreakdown
  };
}

function ctIsValidISODate_(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  var parts = dateStr.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  var dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function ctIsValidTime24_(timeStr) {
  if (typeof timeStr !== 'string' || !/^\d{2}:\d{2}$/.test(timeStr)) return false;
  var parts = timeStr.split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function ctGetTodayKolkataISO_() {
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function ctFormatISODateToDDMMYYYY_(dateStr) {
  if (!ctIsValidISODate_(dateStr)) return '';
  var p = dateStr.split('-');
  return p[2] + '-' + p[1] + '-' + p[0];
}

function ctFormatISODateToYYYYMMDD_(dateStr) {
  if (!ctIsValidISODate_(dateStr)) return '';
  return dateStr.replace(/-/g, '');
}

function ctGetMonthNameFromISO_(dateStr) {
  if (!ctIsValidISODate_(dateStr)) return '';
  var monthIdx = parseInt(dateStr.split('-')[1], 10) - 1;
  return CT_MONTH_NAMES[monthIdx] || '';
}

function ctCalculateSessionDurationMinutes_(startDate, startTime, endDate, endTime) {
  if (!ctIsValidISODate_(startDate) || !ctIsValidISODate_(endDate)) return null;
  if (!ctIsValidTime24_(startTime) || !ctIsValidTime24_(endTime)) return null;
  // Asia/Kolkata has fixed +05:30 offset with no daylight saving transitions
  var startMs = Date.parse(startDate + 'T' + startTime + ':00+05:30');
  var endMs = Date.parse(endDate + 'T' + endTime + ':00+05:30');
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return null;
  return Math.round((endMs - startMs) / 60000);
}

function ctFormatDurationHuman_(totalMinutes) {
  if (totalMinutes === null || !isFinite(totalMinutes) || totalMinutes <= 0) return '—';
  var mins = Math.round(totalMinutes);
  var days = Math.floor(mins / 1440);
  var remAfterDays = mins % 1440;
  var hours = Math.floor(remAfterDays / 60);
  var remMins = remAfterDays % 60;

  var parts = [];
  if (days > 0) parts.push(days + ' ' + (days === 1 ? 'day' : 'days'));
  if (hours > 0) parts.push(hours + ' ' + (hours === 1 ? 'hr' : 'hrs'));
  if (remMins > 0 || parts.length === 0) parts.push(remMins + ' ' + (remMins === 1 ? 'min' : 'mins'));
  return parts.join(' ');
}

function ctBuildSessionIdPrefix_(startDate, udiseCode, sessionMode, classes) {
  var yyyymmdd = ctFormatISODateToYYYYMMDD_(startDate);
  if (!yyyymmdd) return null;
  var cleanUdise = String(udiseCode || '').trim();
  if (!/^\d{11}$/.test(cleanUdise)) return null;

  var rows = classes || [];
  var gradeToken = '';
  var classToken = '';

  if (sessionMode === 'single') {
    var first = rows[0];
    if (!first || !String(first.grade || '').trim() || !String(first.section || '').trim()) return null;
    var g = String(first.grade).trim();
    gradeToken = g.length < 2 ? '0' + g : g;
    var secClean = String(first.section).trim().toUpperCase();
    classToken = secClean === 'NO SECTION' ? 'NS' : secClean.replace(/[^A-Z0-9]/g, '');
    if (!classToken) return null;
  } else {
    if (rows.length < 2) return null;
    for (var i = 0; i < rows.length; i++) {
      if (!String(rows[i].grade || '').trim() || !String(rows[i].section || '').trim()) return null;
    }
    gradeToken = 'CMB';
    classToken = (rows.length < 10 ? '0' : '') + String(rows.length) + 'C';
  }

  return 'CT_IN_' + yyyymmdd + '_' + cleanUdise + '_' + gradeToken + '_' + classToken;
}

function ctFormatSessionIdWithSequence_(prefix, sequence) {
  var seqStr = String(sequence);
  while (seqStr.length < 3) seqStr = '0' + seqStr;
  return prefix + '_' + seqStr;
}

function ctResolveConfiguredVideoId_(tour, language) {
  if (!tour) return { videoId: '', isConfigured: false };
  var map = tour.videoIdByLanguage || {};
  var exact = String(map[language] || '').trim();
  if (exact) return { videoId: exact, isConfigured: true };
  return { videoId: 'UNCONFIGURED_VIDEO_ID', isConfigured: false };
}
