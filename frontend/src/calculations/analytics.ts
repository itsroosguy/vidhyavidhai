import { QUESTION_A_OPTIONS, QUESTION_B_OPTIONS } from '../config/defaults';
import type {
  AppConfiguration,
  DashboardAnalytics,
  NumericScoreCounts,
  ReconciliationReport,
  SessionQueryFilters,
  SessionRecord,
} from '../types/domain';
import { calculateScaleSentiment, formatPct1, formatScore2, round1, round2 } from './metrics';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatMonthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey || 'Unknown';
  const year = m[1];
  const monthIdx = Number.parseInt(m[2]!, 10) - 1;
  return `${MONTH_NAMES[monthIdx] ?? m[2]} ${year}`;
}

function emptyCounts(): NumericScoreCounts {
  return { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 };
}

function addCounts(
  target: NumericScoreCounts,
  s5: number,
  s4: number,
  s3: number,
  s2: number,
  s1: number,
): void {
  target.score5 += s5;
  target.score4 += s4;
  target.score3 += s3;
  target.score2 += s2;
  target.score1 += s1;
}

export function filterSessionRecords(
  rows: SessionRecord[],
  filters: SessionQueryFilters,
  config: AppConfiguration,
): {
  included: SessionRecord[];
  excludedPendingCount: number;
} {
  let excludedPendingCount = 0;
  const included: SessionRecord[] = [];

  for (const s of rows) {
    if (!filters.includeArchived && s.archived) continue;
    if (s.submissionStatus === 'PENDING') {
      excludedPendingCount++;
      continue;
    }
    if (!config.allowedDistricts.includes(s.district)) {
      excludedPendingCount++;
      continue;
    }

    if (filters.district && s.district !== filters.district) continue;
    if (filters.school && !s.schoolName.toLowerCase().includes(filters.school.toLowerCase())) {
      continue;
    }
    if (
      filters.facilitatorEmail &&
      s.facilitatorEmail.toLowerCase() !== filters.facilitatorEmail.toLowerCase()
    ) {
      continue;
    }
    if (filters.tourId && s.tourId !== filters.tourId) continue;
    if (filters.language && s.language !== filters.language) continue;
    if (filters.status && s.submissionStatus !== filters.status) continue;
    if (filters.dateFrom && s.startDate < filters.dateFrom) continue;
    if (filters.dateTo && s.startDate > filters.dateTo) continue;
    if (filters.grade && !s.details.some((d) => d.grade === filters.grade)) continue;
    if (filters.search) {
      const q = filters.search.trim().toLowerCase();
      const hay =
        `${s.sessionId} ${s.schoolName} ${s.udiseCode} ${s.facilitatorName}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    included.push(s);
  }

  return { included, excludedPendingCount };
}

/**
 * Computes complete programme analytics strictly from verified, published, district-approved sessions.
 * Avoids double-counting students across Question A and Question B, avoids averaging already-rounded
 * percentages/scores, handles zero denominators safely (returns null), and embeds independent reconciliation telemetry.
 */
export function computeDashboardAnalytics(
  allSessions: SessionRecord[],
  filters: SessionQueryFilters,
  config: AppConfiguration,
): DashboardAnalytics {
  const { included, excludedPendingCount } = filterSessionRecords(allSessions, filters, config);

  const totalSessions = included.length;
  let totalStudentsReached = 0;
  const uniqueSchools = new Set<string>();
  const uniqueFacs = new Set<string>();

  const pooledQA = emptyCounts();
  const pooledQB = emptyCounts();
  let totalMissingQa = 0;
  let totalMissingQb = 0;
  let npsSum = 0;

  let totalClassRows = 0;
  let lowCoverageSessionsCount = 0;
  let qaQbMismatchCount = 0;
  let unconfiguredVideoCount = 0;

  const csatDist = [5, 4, 3, 2, 1].map((score) => ({
    score,
    label: QUESTION_A_OPTIONS.find((o) => o.score === score)!.label,
    count: 0,
  }));
  const itpDist = [5, 4, 3, 2, 1].map((score) => ({
    score,
    label: QUESTION_B_OPTIONS.find((o) => o.score === score)!.label,
    count: 0,
  }));
  const npsDist = { promoter: 0, passive: 0, detractor: 0 };

  interface GroupAccum {
    sessions: number;
    students: number;
    qaCounts: NumericScoreCounts;
    qbCounts: NumericScoreCounts;
    missingQa: number;
    missingQb: number;
    npsSum: number;
  }

  const createGroupAccum = (): GroupAccum => ({
    sessions: 0,
    students: 0,
    qaCounts: emptyCounts(),
    qbCounts: emptyCounts(),
    missingQa: 0,
    missingQb: 0,
    npsSum: 0,
  });

  const districtMap = new Map<string, GroupAccum & { schools: Set<string> }>();
  for (const d of config.allowedDistricts) {
    districtMap.set(d, { ...createGroupAccum(), schools: new Set() });
  }

  const schoolMap = new Map<
    string,
    GroupAccum & { udiseCode: string; schoolName: string; district: string }
  >();
  const monthMap = new Map<
    string,
    GroupAccum & { schools: Set<string>; facilitators: Set<string> }
  >();
  const tourMap = new Map<string, GroupAccum & { tourName: string; schools: Set<string> }>();
  const languageMap = new Map<string, GroupAccum>();
  const gradeMap = new Map<string, GroupAccum & { classesCount: number }>();
  const dateMap = new Map<string, { sessions: number; students: number }>();
  const facMap = new Map<
    string,
    GroupAccum & { name: string; latest: string; schools: Set<string> }
  >();

  for (const s of included) {
    uniqueSchools.add(s.udiseCode);
    uniqueFacs.add(s.facilitatorEmail);
    npsSum += s.teacherNps;

    if (s.teacherClassification === 'Promoter') npsDist.promoter++;
    else if (s.teacherClassification === 'Passive') npsDist.passive++;
    else npsDist.detractor++;

    if (!s.videoId || s.videoId === 'UNCONFIGURED_VIDEO_ID') {
      unconfiguredVideoCount++;
    }

    const dAgg = districtMap.get(s.district);
    if (dAgg) {
      dAgg.sessions++;
      dAgg.schools.add(s.udiseCode);
      dAgg.npsSum += s.teacherNps;
    }

    const scKey = s.udiseCode;
    const scAgg = schoolMap.get(scKey) ?? {
      ...createGroupAccum(),
      udiseCode: s.udiseCode,
      schoolName: s.schoolName,
      district: s.district,
    };
    scAgg.sessions++;
    scAgg.schoolName = s.schoolName;
    scAgg.npsSum += s.teacherNps;

    const monthKey = /^\d{4}-\d{2}/.test(s.startDate) ? s.startDate.slice(0, 7) : 'Unknown';
    const mAgg = monthMap.get(monthKey) ?? {
      ...createGroupAccum(),
      schools: new Set<string>(),
      facilitators: new Set<string>(),
    };
    mAgg.sessions++;
    mAgg.schools.add(s.udiseCode);
    mAgg.facilitators.add(s.facilitatorEmail);
    mAgg.npsSum += s.teacherNps;

    const tAgg = tourMap.get(s.tourId) ?? {
      ...createGroupAccum(),
      tourName: s.tourName,
      schools: new Set<string>(),
    };
    tAgg.sessions++;
    tAgg.schools.add(s.udiseCode);
    tAgg.npsSum += s.teacherNps;

    const lAgg = languageMap.get(s.language) ?? createGroupAccum();
    lAgg.sessions++;
    lAgg.npsSum += s.teacherNps;

    const dtAgg = dateMap.get(s.startDate) ?? { sessions: 0, students: 0 };
    dtAgg.sessions++;

    const fAgg = facMap.get(s.facilitatorEmail) ?? {
      ...createGroupAccum(),
      name: s.facilitatorName,
      latest: s.submissionTimestamp,
      schools: new Set<string>(),
    };
    fAgg.sessions++;
    fAgg.schools.add(s.udiseCode);
    fAgg.npsSum += s.teacherNps;
    if (s.submissionTimestamp > fAgg.latest) fAgg.latest = s.submissionTimestamp;

    let sessionStudents = 0;
    let sessionQa = 0;
    let sessionQb = 0;

    for (const det of s.details) {
      totalClassRows++;
      const present = det.studentsPresent;
      const qaTot = det.questionATotal;
      const qbTot = det.questionBTotal;
      const missQa = Math.max(0, present - qaTot);
      const missQb = Math.max(0, present - qbTot);

      sessionStudents += present;
      sessionQa += qaTot;
      sessionQb += qbTot;

      totalStudentsReached += present;
      totalMissingQa += missQa;
      totalMissingQb += missQb;

      addCounts(
        pooledQA,
        det.questionAScore5,
        det.questionAScore4,
        det.questionAScore3,
        det.questionAScore2,
        det.questionAScore1,
      );
      addCounts(
        pooledQB,
        det.questionBScore5,
        det.questionBScore4,
        det.questionBScore3,
        det.questionBScore2,
        det.questionBScore1,
      );

      csatDist[0]!.count += det.questionAScore5;
      csatDist[1]!.count += det.questionAScore4;
      csatDist[2]!.count += det.questionAScore3;
      csatDist[3]!.count += det.questionAScore2;
      csatDist[4]!.count += det.questionAScore1;

      itpDist[0]!.count += det.questionBScore5;
      itpDist[1]!.count += det.questionBScore4;
      itpDist[2]!.count += det.questionBScore3;
      itpDist[3]!.count += det.questionBScore2;
      itpDist[4]!.count += det.questionBScore1;

      const targets: GroupAccum[] = [scAgg, mAgg, tAgg, lAgg, fAgg];
      if (dAgg) targets.push(dAgg);
      for (const agg of targets) {
        agg.students += present;
        agg.missingQa += missQa;
        agg.missingQb += missQb;
        addCounts(
          agg.qaCounts,
          det.questionAScore5,
          det.questionAScore4,
          det.questionAScore3,
          det.questionAScore2,
          det.questionAScore1,
        );
        addCounts(
          agg.qbCounts,
          det.questionBScore5,
          det.questionBScore4,
          det.questionBScore3,
          det.questionBScore2,
          det.questionBScore1,
        );
      }

      const gAgg = gradeMap.get(det.grade) ?? { ...createGroupAccum(), classesCount: 0 };
      gAgg.classesCount++;
      gAgg.students += present;
      gAgg.missingQa += missQa;
      gAgg.missingQb += missQb;
      addCounts(
        gAgg.qaCounts,
        det.questionAScore5,
        det.questionAScore4,
        det.questionAScore3,
        det.questionAScore2,
        det.questionAScore1,
      );
      addCounts(
        gAgg.qbCounts,
        det.questionBScore5,
        det.questionBScore4,
        det.questionBScore3,
        det.questionBScore2,
        det.questionBScore1,
      );
      gradeMap.set(det.grade, gAgg);
    }

    dtAgg.students += sessionStudents;
    dateMap.set(s.startDate, dtAgg);
    schoolMap.set(scKey, scAgg);
    monthMap.set(monthKey, mAgg);
    tourMap.set(s.tourId, tAgg);
    languageMap.set(s.language, lAgg);
    facMap.set(s.facilitatorEmail, fAgg);

    if (sessionQa !== sessionQb) qaQbMismatchCount++;
    if (sessionStudents > 0) {
      const qaCov = (sessionQa / sessionStudents) * 100;
      const qbCov = (sessionQb / sessionStudents) * 100;
      if (qaCov < 75 || qbCov < 75) lowCoverageSessionsCount++;
    }
  }

  const qaSentiment = calculateScaleSentiment(pooledQA);
  const qbSentiment = calculateScaleSentiment(pooledQB);

  const missingResponseRateQaPct =
    totalStudentsReached > 0 ? (totalMissingQa / totalStudentsReached) * 100 : null;
  const missingResponseRateQbPct =
    totalStudentsReached > 0 ? (totalMissingQb / totalStudentsReached) * 100 : null;

  const analytics: DashboardAnalytics = {
    totalSessions,
    totalStudentsReached,
    totalSchoolsCovered: uniqueSchools.size,
    totalFacilitatorsActive: uniqueFacs.size,
    totalQuestionAResponses: qaSentiment.total,
    totalQuestionBResponses: qbSentiment.total,
    totalMissingResponsesQA: totalMissingQa,
    totalMissingResponsesQB: totalMissingQb,
    missingResponseRateQaPct,
    missingResponseRateQbPct,
    averageCsat: qaSentiment.average,
    averageItp: qbSentiment.average,
    teacherNpsAverage: totalSessions > 0 ? round2(npsSum / totalSessions) : null,
    qaSentiment,
    qbSentiment,
    districtBreakdown: Array.from(districtMap.entries()).map(([district, v]) => {
      const qa = calculateScaleSentiment(v.qaCounts);
      const qb = calculateScaleSentiment(v.qbCounts);
      return {
        district,
        sessions: v.sessions,
        studentsReached: v.students,
        schoolsCount: v.schools.size,
        qaResponses: qa.total,
        qbResponses: qb.total,
        missingResponsesQa: v.missingQa,
        averageCsat: qa.average,
        averageItp: qb.average,
        positiveCsatPct: qa.positivePct,
        positiveItpPct: qb.positivePct,
      };
    }),
    schoolBreakdown: Array.from(schoolMap.values())
      .map((v) => {
        const qa = calculateScaleSentiment(v.qaCounts);
        const qb = calculateScaleSentiment(v.qbCounts);
        return {
          udiseCode: v.udiseCode,
          schoolName: v.schoolName,
          district: v.district,
          sessions: v.sessions,
          studentsReached: v.students,
          qaResponses: qa.total,
          qbResponses: qb.total,
          missingResponsesQa: v.missingQa,
          missingResponsesQb: v.missingQb,
          averageCsat: qa.average,
          averageItp: qb.average,
          positiveCsatPct: qa.positivePct,
          positiveItpPct: qb.positivePct,
        };
      })
      .sort((a, b) => b.studentsReached - a.studentsReached || a.schoolName.localeCompare(b.schoolName)),
    monthlyBreakdown: Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([monthKey, v]) => {
        const qa = calculateScaleSentiment(v.qaCounts);
        const qb = calculateScaleSentiment(v.qbCounts);
        return {
          monthKey,
          monthLabel: formatMonthLabel(monthKey),
          sessions: v.sessions,
          studentsReached: v.students,
          schoolsCount: v.schools.size,
          facilitatorsCount: v.facilitators.size,
          averageCsat: qa.average,
          averageItp: qb.average,
          positiveCsatPct: qa.positivePct,
          positiveItpPct: qb.positivePct,
          teacherNpsAverage: v.sessions > 0 ? round2(v.npsSum / v.sessions) : null,
        };
      }),
    tourBreakdown: Array.from(tourMap.entries())
      .map(([tourId, v]) => {
        const qa = calculateScaleSentiment(v.qaCounts);
        const qb = calculateScaleSentiment(v.qbCounts);
        return {
          tourId,
          tourName: v.tourName,
          sessions: v.sessions,
          studentsReached: v.students,
          schoolsCount: v.schools.size,
          averageCsat: qa.average,
          averageItp: qb.average,
          positiveCsatPct: qa.positivePct,
          positiveItpPct: qb.positivePct,
        };
      })
      .sort(
        (a, b) =>
          b.sessions - a.sessions ||
          b.studentsReached - a.studentsReached ||
          a.tourName.localeCompare(b.tourName),
      ),
    languageBreakdown: Array.from(languageMap.entries())
      .map(([language, v]) => {
        const qa = calculateScaleSentiment(v.qaCounts);
        const qb = calculateScaleSentiment(v.qbCounts);
        return {
          language,
          sessions: v.sessions,
          studentsReached: v.students,
          averageCsat: qa.average,
          averageItp: qb.average,
          positiveCsatPct: qa.positivePct,
          positiveItpPct: qb.positivePct,
        };
      })
      .sort((a, b) => b.sessions - a.sessions || a.language.localeCompare(b.language)),
    gradeBreakdown: Array.from(gradeMap.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([grade, v]) => {
        const qa = calculateScaleSentiment(v.qaCounts);
        const qb = calculateScaleSentiment(v.qbCounts);
        return {
          grade,
          classesCount: v.classesCount,
          studentsReached: v.students,
          averageCsat: qa.average,
          averageItp: qb.average,
          positiveCsatPct: qa.positivePct,
        };
      }),
    timelineSeries: Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, sessions: v.sessions, studentsReached: v.students })),
    csatDistribution: csatDist,
    itpDistribution: itpDist,
    npsDistribution: npsDist,
    facilitatorPanels: Array.from(facMap.entries())
      .map(([email, v]) => {
        const qa = calculateScaleSentiment(v.qaCounts);
        const qb = calculateScaleSentiment(v.qbCounts);
        return {
          name: v.name,
          email,
          sessions: v.sessions,
          studentsReached: v.students,
          schoolsCount: v.schools.size,
          missingResponsesQa: v.missingQa,
          averageCsat: qa.average,
          averageItp: qb.average,
          positiveCsatPct: qa.positivePct,
          positiveItpPct: qb.positivePct,
          teacherNpsAverage: v.sessions > 0 ? round2(v.npsSum / v.sessions) : null,
          latestSubmission: v.latest,
        };
      })
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
    dataQuality: {
      totalClassRows,
      totalMissingQa,
      totalMissingQb,
      missingRateQaPct: missingResponseRateQaPct,
      missingRateQbPct: missingResponseRateQbPct,
      lowCoverageSessionsCount,
      qaQbMismatchCount,
      unconfiguredVideoCount,
      excludedPendingCount,
    },
    reconciliation: {
      verified: true,
      checkedAt: new Date().toISOString(),
      checksRun: 0,
      discrepancies: [],
    },
  };

  analytics.reconciliation = reconcileDashboardAnalytics(included, analytics);
  return analytics;
}

/**
 * Independent reconciliation verifier that recomputes core totals, weighted ratios,
 * sentiment partitions, and group totals directly from the raw filtered records
 * and flags any numerical discrepancy explicitly instead of masking errors.
 */
export function reconcileDashboardAnalytics(
  rawIncludedSessions: SessionRecord[],
  analytics: DashboardAnalytics,
): ReconciliationReport {
  const discrepancies: string[] = [];
  let checksRun = 0;

  let rawStudentsFromHeaders = 0;
  let rawStudentsFromDetails = 0;
  let rawQaTotal = 0;
  let rawQaWeighted = 0;
  let rawQbTotal = 0;
  let rawQbWeighted = 0;
  let rawNpsSum = 0;
  let rawMissingQa = 0;
  let rawMissingQb = 0;
  let rawExcessRows = 0;
  const rawSchools = new Set<string>();

  for (const s of rawIncludedSessions) {
    rawStudentsFromHeaders += s.totalStudentsPresent;
    rawNpsSum += s.teacherNps;
    rawSchools.add(s.udiseCode);

    for (const d of s.details) {
      rawStudentsFromDetails += d.studentsPresent;
      const qaTot =
        d.questionAScore5 +
        d.questionAScore4 +
        d.questionAScore3 +
        d.questionAScore2 +
        d.questionAScore1;
      const qaW =
        5 * d.questionAScore5 +
        4 * d.questionAScore4 +
        3 * d.questionAScore3 +
        2 * d.questionAScore2 +
        1 * d.questionAScore1;
      const qbTot =
        d.questionBScore5 +
        d.questionBScore4 +
        d.questionBScore3 +
        d.questionBScore2 +
        d.questionBScore1;
      const qbW =
        5 * d.questionBScore5 +
        4 * d.questionBScore4 +
        3 * d.questionBScore3 +
        2 * d.questionBScore2 +
        1 * d.questionBScore1;

      if (qaTot > d.studentsPresent || qbTot > d.studentsPresent) {
        rawExcessRows++;
      }

      rawQaTotal += qaTot;
      rawQaWeighted += qaW;
      rawQbTotal += qbTot;
      rawQbWeighted += qbW;
      rawMissingQa += Math.max(0, d.studentsPresent - qaTot);
      rawMissingQb += Math.max(0, d.studentsPresent - qbTot);
    }
  }

  // 1. Session count
  checksRun++;
  if (analytics.totalSessions !== rawIncludedSessions.length) {
    discrepancies.push(
      `Session count mismatch: KPI=${analytics.totalSessions}, raw=${rawIncludedSessions.length}`,
    );
  }

  // 2. Single-counted student reach (headers vs details vs KPI)
  checksRun++;
  if (
    analytics.totalStudentsReached !== rawStudentsFromDetails ||
    rawStudentsFromHeaders !== rawStudentsFromDetails
  ) {
    discrepancies.push(
      `Student reach mismatch: KPI=${analytics.totalStudentsReached}, detailSum=${rawStudentsFromDetails}, headerSum=${rawStudentsFromHeaders}`,
    );
  }

  // 3. Unique schools count
  checksRun++;
  if (analytics.totalSchoolsCovered !== rawSchools.size) {
    discrepancies.push(
      `School count mismatch: KPI=${analytics.totalSchoolsCovered}, rawDistinctUDISE=${rawSchools.size}`,
    );
  }

  // 4. Pooled weighted CSAT precision & count check
  checksRun++;
  const expectedCsat = rawQaTotal > 0 ? round2(rawQaWeighted / rawQaTotal) : null;
  if (
    analytics.totalQuestionAResponses !== rawQaTotal ||
    analytics.averageCsat !== expectedCsat ||
    (rawQaTotal > 0 &&
      analytics.qaSentiment.exactAverage !== null &&
      Math.abs(analytics.qaSentiment.exactAverage - rawQaWeighted / rawQaTotal) > 1e-9)
  ) {
    discrepancies.push(
      `CSAT reconciliation failed: KPI=${analytics.averageCsat} (${analytics.totalQuestionAResponses} resp) vs raw=${expectedCsat} (${rawQaTotal} resp)`,
    );
  }

  // 5. Pooled weighted ITP precision & count check
  checksRun++;
  const expectedItp = rawQbTotal > 0 ? round2(rawQbWeighted / rawQbTotal) : null;
  if (
    analytics.totalQuestionBResponses !== rawQbTotal ||
    analytics.averageItp !== expectedItp ||
    (rawQbTotal > 0 &&
      analytics.qbSentiment.exactAverage !== null &&
      Math.abs(analytics.qbSentiment.exactAverage - rawQbWeighted / rawQbTotal) > 1e-9)
  ) {
    discrepancies.push(
      `ITP reconciliation failed: KPI=${analytics.averageItp} (${analytics.totalQuestionBResponses} resp) vs raw=${expectedItp} (${rawQbTotal} resp)`,
    );
  }

  // 6. Teacher NPS average
  checksRun++;
  const expectedNps =
    rawIncludedSessions.length > 0 ? round2(rawNpsSum / rawIncludedSessions.length) : null;
  if (analytics.teacherNpsAverage !== expectedNps) {
    discrepancies.push(
      `Teacher NPS mismatch: KPI=${analytics.teacherNpsAverage}, raw=${expectedNps}`,
    );
  }

  // 7. District breakdown partition sum
  checksRun++;
  const distSessions = analytics.districtBreakdown.reduce((a, d) => a + d.sessions, 0);
  const distStudents = analytics.districtBreakdown.reduce((a, d) => a + d.studentsReached, 0);
  if (distSessions !== analytics.totalSessions || distStudents !== analytics.totalStudentsReached) {
    discrepancies.push(
      `District breakdown does not sum to totals (${distSessions}/${distStudents} vs ${analytics.totalSessions}/${analytics.totalStudentsReached})`,
    );
  }

  // 8. School breakdown partition sum
  checksRun++;
  const schSessions = analytics.schoolBreakdown.reduce((a, s) => a + s.sessions, 0);
  const schStudents = analytics.schoolBreakdown.reduce((a, s) => a + s.studentsReached, 0);
  if (schSessions !== analytics.totalSessions || schStudents !== analytics.totalStudentsReached) {
    discrepancies.push(
      `School breakdown does not sum to totals (${schSessions}/${schStudents} vs ${analytics.totalSessions}/${analytics.totalStudentsReached})`,
    );
  }

  // 9. Monthly breakdown partition sum
  checksRun++;
  const monSessions = analytics.monthlyBreakdown.reduce((a, m) => a + m.sessions, 0);
  const monStudents = analytics.monthlyBreakdown.reduce((a, m) => a + m.studentsReached, 0);
  if (monSessions !== analytics.totalSessions || monStudents !== analytics.totalStudentsReached) {
    discrepancies.push(
      `Monthly breakdown does not sum to totals (${monSessions}/${monStudents} vs ${analytics.totalSessions}/${analytics.totalStudentsReached})`,
    );
  }

  // 10. Tour & Language breakdown partition sums
  checksRun++;
  const tourSessions = analytics.tourBreakdown.reduce((a, t) => a + t.sessions, 0);
  const langSessions = analytics.languageBreakdown.reduce((a, l) => a + l.sessions, 0);
  if (tourSessions !== analytics.totalSessions || langSessions !== analytics.totalSessions) {
    discrepancies.push(
      `Tour/Language session sums mismatch: tour=${tourSessions}, lang=${langSessions}, total=${analytics.totalSessions}`,
    );
  }

  // 11. Distribution bucket sums vs response totals
  checksRun++;
  const csatBucketSum = analytics.csatDistribution.reduce((a, b) => a + b.count, 0);
  const itpBucketSum = analytics.itpDistribution.reduce((a, b) => a + b.count, 0);
  if (csatBucketSum !== rawQaTotal || itpBucketSum !== rawQbTotal) {
    discrepancies.push(
      `Distribution histogram sum mismatch: QA=${csatBucketSum}/${rawQaTotal}, QB=${itpBucketSum}/${rawQbTotal}`,
    );
  }

  // 12. Sentiment sums + Missing response bounds + Non-exceeding responses
  checksRun++;
  const qaSentSum =
    analytics.qaSentiment.positiveCount +
    analytics.qaSentiment.neutralCount +
    analytics.qaSentiment.negativeCount;
  const qbSentSum =
    analytics.qbSentiment.positiveCount +
    analytics.qbSentiment.neutralCount +
    analytics.qbSentiment.negativeCount;
  if (
    qaSentSum !== rawQaTotal ||
    qbSentSum !== rawQbTotal ||
    analytics.totalMissingResponsesQA !== rawMissingQa ||
    analytics.totalMissingResponsesQB !== rawMissingQb ||
    rawExcessRows > 0
  ) {
    discrepancies.push(
      `Sentiment/Missing response anomaly: QA_sent=${qaSentSum}/${rawQaTotal}, missingQA=${analytics.totalMissingResponsesQA}/${rawMissingQa}, excessResponseRows=${rawExcessRows}`,
    );
  }

  return {
    verified: discrepancies.length === 0,
    checkedAt: new Date().toISOString(),
    checksRun,
    discrepancies,
  };
}

export type TrendDirection = 'up' | 'down' | 'flat' | 'unavailable';

export interface KpiPeriodMetricComparison {
  direction: TrendDirection;
  deltaBadge: string;
  comparisonLabel: string;
}

export interface KpiPeriodComparisons {
  hasData: boolean;
  hasMultiPeriod: boolean;
  periodCount: number;
  currentPeriodLabel: string | null;
  previousPeriodLabel: string | null;
  metrics: {
    sessions: KpiPeriodMetricComparison;
    studentsReached: KpiPeriodMetricComparison;
    schoolsCovered: KpiPeriodMetricComparison;
    activeFacilitators: KpiPeriodMetricComparison;
    averageCsat: KpiPeriodMetricComparison;
    averageItp: KpiPeriodMetricComparison;
    teacherNps: KpiPeriodMetricComparison;
  };
}

function shortMonthLabel(monthKey: string, monthLabel: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthLabel;
  const idx = Number.parseInt(m[2]!, 10) - 1;
  const abbr = (MONTH_NAMES[idx] ?? monthLabel).slice(0, 3);
  return `${abbr} '${m[1]!.slice(2)}`;
}

function buildCountDelta(
  curr: number | undefined,
  prev: number | undefined,
  prevShort: string,
  currShort: string,
  unit: string,
  showPct = false,
): KpiPeriodMetricComparison {
  if (curr === undefined || prev === undefined) {
    return {
      direction: 'unavailable',
      deltaBadge: 'Single period',
      comparisonLabel: 'Month-level comparison awaits historical data',
    };
  }
  const diff = curr - prev;
  if (diff === 0) {
    return {
      direction: 'flat',
      deltaBadge: `0 vs ${prevShort}`,
      comparisonLabel: `${currShort} (${curr}) matched ${prevShort} (${prev})`,
    };
  }
  const sign = diff > 0 ? '+' : '';
  let badge = `${sign}${diff} vs ${prevShort}`;
  if (showPct && prev > 0) {
    const pct = round1(((curr - prev) / prev) * 100);
    badge = `${pct > 0 ? '+' : ''}${pct}% vs ${prevShort}`;
  }
  return {
    direction: diff > 0 ? 'up' : 'down',
    deltaBadge: badge,
    comparisonLabel: `${currShort}: ${curr} ${unit} vs ${prev} in ${prevShort}`,
  };
}

function buildScoreDelta(
  curr: number | null,
  prev: number | null,
  prevShort: string,
  currShort: string,
  decimals: 2 | 1,
): KpiPeriodMetricComparison {
  if (curr === null || prev === null) {
    return {
      direction: 'unavailable',
      deltaBadge: 'Single period',
      comparisonLabel: 'Historical score baseline unavailable',
    };
  }
  const diff = round2(curr - prev);
  if (Math.abs(diff) < 0.005) {
    return {
      direction: 'flat',
      deltaBadge: `0.00 vs ${prevShort}`,
      comparisonLabel: `${currShort} held steady vs ${prevShort}`,
    };
  }
  const sign = diff > 0 ? '+' : '';
  const formattedDiff = decimals === 2 ? diff.toFixed(2) : String(round1(diff));
  const formattedCurr = decimals === 2 ? curr.toFixed(2) : curr > 0 ? `+${round1(curr)}` : String(round1(curr));
  const formattedPrev = decimals === 2 ? prev.toFixed(2) : prev > 0 ? `+${round1(prev)}` : String(round1(prev));
  return {
    direction: diff > 0 ? 'up' : 'down',
    deltaBadge: `${sign}${formattedDiff} vs ${prevShort}`,
    comparisonLabel: `${currShort}: ${formattedCurr} vs ${formattedPrev} in ${prevShort}`,
  };
}

/**
 * Derives authentic month-over-month KPI comparisons exclusively when two or more valid
 * YYYY-MM months exist in filtered analytics. Never fabricates percentages or trends.
 */
export function computeKpiPeriodComparisons(analytics: DashboardAnalytics): KpiPeriodComparisons {
  const validMonths = analytics.monthlyBreakdown.filter((m) => /^\d{4}-\d{2}$/.test(m.monthKey));
  const emptyItem = (msg: string): KpiPeriodMetricComparison => ({
    direction: 'unavailable',
    deltaBadge: 'No data yet',
    comparisonLabel: msg,
  });

  if (analytics.totalSessions === 0 || validMonths.length === 0) {
    return {
      hasData: false,
      hasMultiPeriod: false,
      periodCount: 0,
      currentPeriodLabel: null,
      previousPeriodLabel: null,
      metrics: {
        sessions: emptyItem('Awaiting committed sessions'),
        studentsReached: emptyItem('Awaiting attendance logs'),
        schoolsCovered: emptyItem('Awaiting school participation'),
        activeFacilitators: emptyItem('Awaiting facilitator activity'),
        averageCsat: emptyItem('0 student ratings yet'),
        averageItp: emptyItem('0 interest ratings yet'),
        teacherNps: emptyItem('0 teacher ratings yet'),
      },
    };
  }

  if (validMonths.length === 1) {
    const only = validMonths[0]!;
    const onlyShort = shortMonthLabel(only.monthKey, only.monthLabel);
    const singleItem: KpiPeriodMetricComparison = {
      direction: 'unavailable',
      deltaBadge: onlyShort,
      comparisonLabel: `Single active month (${only.monthLabel}) · prior period unavailable`,
    };
    return {
      hasData: true,
      hasMultiPeriod: false,
      periodCount: 1,
      currentPeriodLabel: only.monthLabel,
      previousPeriodLabel: null,
      metrics: {
        sessions: singleItem,
        studentsReached: singleItem,
        schoolsCovered: singleItem,
        activeFacilitators: singleItem,
        averageCsat: singleItem,
        averageItp: singleItem,
        teacherNps: singleItem,
      },
    };
  }

  const prev = validMonths[validMonths.length - 2]!;
  const curr = validMonths[validMonths.length - 1]!;
  const prevShort = shortMonthLabel(prev.monthKey, prev.monthLabel);
  const currShort = shortMonthLabel(curr.monthKey, curr.monthLabel);

  return {
    hasData: true,
    hasMultiPeriod: true,
    periodCount: validMonths.length,
    currentPeriodLabel: curr.monthLabel,
    previousPeriodLabel: prev.monthLabel,
    metrics: {
      sessions: buildCountDelta(curr.sessions, prev.sessions, prevShort, currShort, 'sessions', true),
      studentsReached: buildCountDelta(
        curr.studentsReached,
        prev.studentsReached,
        prevShort,
        currShort,
        'students',
        true,
      ),
      schoolsCovered: buildCountDelta(
        curr.schoolsCount,
        prev.schoolsCount,
        prevShort,
        currShort,
        'schools',
        false,
      ),
      activeFacilitators: buildCountDelta(
        curr.facilitatorsCount,
        prev.facilitatorsCount,
        prevShort,
        currShort,
        'facilitators',
        false,
      ),
      averageCsat: buildScoreDelta(curr.averageCsat, prev.averageCsat, prevShort, currShort, 2),
      averageItp: buildScoreDelta(curr.averageItp, prev.averageItp, prevShort, currShort, 2),
      teacherNps: buildScoreDelta(
        curr.teacherNpsAverage,
        prev.teacherNpsAverage,
        prevShort,
        currShort,
        1,
      ),
    },
  };
}

export interface ProgrammeInsightItem {
  id: 'top-district' | 'top-tour' | 'top-grade' | 'monthly-trend' | 'coverage-attention';
  title: string;
  headline: string;
  detail: string;
  tone: 'positive' | 'neutral' | 'attention' | 'empty';
}

export interface ProgrammeInsightsReport {
  hasData: boolean;
  items: ProgrammeInsightItem[];
}

/**
 * Generates factual, filter-responsive observations directly from reconciled analytics.
 * Never outputs fabricated statements or invented trends when historical data is missing.
 */
export function computeProgrammeInsights(
  analytics: DashboardAnalytics,
  config: AppConfiguration,
  filters?: SessionQueryFilters,
): ProgrammeInsightsReport {
  if (analytics.totalSessions === 0) {
    return {
      hasData: false,
      items: [
        {
          id: 'top-district',
          title: 'Top district',
          headline: '—',
          detail: 'Will appear once district sessions are submitted',
          tone: 'empty',
        },
        {
          id: 'top-tour',
          title: 'Most active tour',
          headline: '—',
          detail: 'Will appear once career tour sessions are logged',
          tone: 'empty',
        },
        {
          id: 'top-grade',
          title: 'Most engaged grade',
          headline: '—',
          detail: 'Will appear once grade participation is recorded',
          tone: 'empty',
        },
        {
          id: 'monthly-trend',
          title: 'Participation trend',
          headline: '—',
          detail: 'Will appear across active reporting months',
          tone: 'empty',
        },
        {
          id: 'coverage-attention',
          title: 'Coverage watch',
          headline: '—',
          detail: 'Highlights districts or tours with lower reach',
          tone: 'empty',
        },
      ],
    };
  }

  const activeDistricts = [...analytics.districtBreakdown]
    .filter((d) => d.sessions > 0)
    .sort(
      (a, b) =>
        b.studentsReached - a.studentsReached ||
        b.sessions - a.sessions ||
        a.district.localeCompare(b.district),
    );
  const topDistrict = activeDistricts[0];
  const topDistrictShare =
    topDistrict && analytics.totalStudentsReached > 0
      ? round1((topDistrict.studentsReached / analytics.totalStudentsReached) * 100)
      : 0;

  const topDistrictItem: ProgrammeInsightItem = topDistrict
    ? {
        id: 'top-district',
        title: 'Top district',
        headline: topDistrict.district,
        detail: `${topDistrict.studentsReached.toLocaleString()} students (${topDistrictShare}% of reach) across ${topDistrict.sessions} session${topDistrict.sessions === 1 ? '' : 's'} & ${topDistrict.schoolsCount} school${topDistrict.schoolsCount === 1 ? '' : 's'}`,
        tone: 'positive',
      }
    : {
        id: 'top-district',
        title: 'Top district',
        headline: '—',
        detail: 'No approved district sessions match filters',
        tone: 'empty',
      };

  const sortedTours = [...analytics.tourBreakdown].sort(
    (a, b) =>
      b.sessions - a.sessions ||
      b.studentsReached - a.studentsReached ||
      a.tourName.localeCompare(b.tourName),
  );
  const topTour = sortedTours[0];
  const topTourSchools = topTour?.schoolsCount ?? 0;

  const topTourItem: ProgrammeInsightItem = topTour
    ? {
        id: 'top-tour',
        title: 'Most active tour',
        headline: topTour.tourName,
        detail: `${topTour.sessions} session${topTour.sessions === 1 ? '' : 's'} · ${topTour.studentsReached.toLocaleString()} students · ${topTourSchools} school${topTourSchools === 1 ? '' : 's'} · CSAT ${formatScore2(topTour.averageCsat)}`,
        tone: 'positive',
      }
    : {
        id: 'top-tour',
        title: 'Most active tour',
        headline: '—',
        detail: 'No tour records found',
        tone: 'empty',
      };

  const sortedGrades = [...analytics.gradeBreakdown].sort(
    (a, b) =>
      b.studentsReached - a.studentsReached ||
      b.classesCount - a.classesCount ||
      Number(a.grade) - Number(b.grade),
  );
  const topGrade = sortedGrades[0];

  const topGradeItem: ProgrammeInsightItem = topGrade
    ? {
        id: 'top-grade',
        title: 'Most engaged grade',
        headline: `Grade ${topGrade.grade}`,
        detail: `${topGrade.studentsReached.toLocaleString()} students across ${topGrade.classesCount} class row${topGrade.classesCount === 1 ? '' : 's'}${topGrade.averageCsat !== null ? ` · CSAT ${formatScore2(topGrade.averageCsat)}` : ''}`,
        tone: 'positive',
      }
    : {
        id: 'top-grade',
        title: 'Most engaged grade',
        headline: '—',
        detail: 'No grade participation logged',
        tone: 'empty',
      };

  const validMonths = analytics.monthlyBreakdown.filter((m) => /^\d{4}-\d{2}$/.test(m.monthKey));
  let monthlyTrendItem: ProgrammeInsightItem;
  if (validMonths.length >= 2) {
    const prev = validMonths[validMonths.length - 2]!;
    const curr = validMonths[validMonths.length - 1]!;
    const prevShort = shortMonthLabel(prev.monthKey, prev.monthLabel);
    const currShort = shortMonthLabel(curr.monthKey, curr.monthLabel);
    const diff = curr.studentsReached - prev.studentsReached;
    const pctText =
      prev.studentsReached > 0
        ? ` (${diff >= 0 ? '+' : ''}${round1((diff / prev.studentsReached) * 100)}%)`
        : '';
    monthlyTrendItem = {
      id: 'monthly-trend',
      title: 'Participation trend',
      headline:
        diff > 0
          ? `Growing into ${currShort}`
          : diff < 0
            ? `Softer in ${currShort}`
            : `Steady in ${currShort}`,
      detail: `${curr.studentsReached.toLocaleString()} students in ${currShort} vs ${prev.studentsReached.toLocaleString()} in ${prevShort}${pctText}`,
      tone: diff >= 0 ? 'positive' : 'attention',
    };
  } else if (validMonths.length === 1) {
    const only = validMonths[0]!;
    monthlyTrendItem = {
      id: 'monthly-trend',
      title: 'Participation trend',
      headline: `Baseline · ${shortMonthLabel(only.monthKey, only.monthLabel)}`,
      detail: `${only.studentsReached.toLocaleString()} students in ${only.sessions} session${only.sessions === 1 ? '' : 's'} — trend compares once 2+ months are logged`,
      tone: 'neutral',
    };
  } else {
    monthlyTrendItem = {
      id: 'monthly-trend',
      title: 'Participation trend',
      headline: 'Single window',
      detail: 'Add sessions with valid dates across months to compare trends',
      tone: 'neutral',
    };
  }

  // Coverage watch: if no single district filter is pinning the scope, surface zero-session
  // or lowest-reach districts first; otherwise surface unrun tours or response completeness.
  const uncoveredDistricts = analytics.districtBreakdown
    .filter((d) => d.sessions === 0)
    .map((d) => d.district);
  let coverageItem: ProgrammeInsightItem;

  if (
    !filters?.district &&
    uncoveredDistricts.length > 0 &&
    uncoveredDistricts.length < config.allowedDistricts.length
  ) {
    coverageItem = {
      id: 'coverage-attention',
      title: 'Coverage watch',
      headline:
        uncoveredDistricts.length === 1
          ? `0 sessions in ${uncoveredDistricts[0]}`
          : `${uncoveredDistricts.length} districts unreached`,
      detail: `No committed sessions yet in ${uncoveredDistricts.join(', ')} under the active filters`,
      tone: 'attention',
    };
  } else if (activeDistricts.length >= 2) {
    const lowestDistrict = activeDistricts[activeDistricts.length - 1]!;
    const lowShare =
      analytics.totalStudentsReached > 0
        ? round1((lowestDistrict.studentsReached / analytics.totalStudentsReached) * 100)
        : 0;
    coverageItem = {
      id: 'coverage-attention',
      title: 'Coverage watch',
      headline: `Lowest reach · ${lowestDistrict.district}`,
      detail: `${lowestDistrict.studentsReached.toLocaleString()} students (${lowShare}% share across ${lowestDistrict.schoolsCount} school${lowestDistrict.schoolsCount === 1 ? '' : 's'})`,
      tone: 'attention',
    };
  } else {
    const activeTourIds = new Set(analytics.tourBreakdown.map((t) => t.tourId));
    const missingTours = config.tours.filter((t) => t.active && !activeTourIds.has(t.tourId));
    if (missingTours.length > 0) {
      coverageItem = {
        id: 'coverage-attention',
        title: 'Coverage watch',
        headline: `${missingTours.length} active tour${missingTours.length === 1 ? '' : 's'} unrun`,
        detail: `Not yet represented in current scope: ${missingTours.map((t) => t.tourName).join(', ')}`,
        tone: 'attention',
      };
    } else if (
      analytics.missingResponseRateQaPct !== null &&
      analytics.missingResponseRateQaPct > 10
    ) {
      coverageItem = {
        id: 'coverage-attention',
        title: 'Coverage watch',
        headline: `${formatPct1(analytics.missingResponseRateQaPct)} Q-A gap`,
        detail: `${analytics.totalMissingResponsesQA.toLocaleString()} unanswered student responses across ${analytics.totalSessions} session${analytics.totalSessions === 1 ? '' : 's'}`,
        tone: 'attention',
      };
    } else {
      coverageItem = {
        id: 'coverage-attention',
        title: 'Coverage watch',
        headline: 'Balanced coverage',
        detail: `${analytics.totalSchoolsCovered} school${analytics.totalSchoolsCovered === 1 ? '' : 's'} covered · ${formatPct1(analytics.qaSentiment.positivePct)} positive CSAT`,
        tone: 'positive',
      };
    }
  }

  return {
    hasData: true,
    items: [topDistrictItem, topTourItem, topGradeItem, monthlyTrendItem, coverageItem],
  };
}
