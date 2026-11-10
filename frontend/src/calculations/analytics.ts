import { QUESTION_A_OPTIONS, QUESTION_B_OPTIONS } from '../config/defaults';
import type {
  AppConfiguration,
  DashboardAnalytics,
  NumericScoreCounts,
  ReconciliationReport,
  SessionQueryFilters,
  SessionRecord,
} from '../types/domain';
import { calculateScaleSentiment, round2 } from './metrics';

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
    if (filters.block && s.block !== filters.block) continue;
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
        `${s.sessionId} ${s.schoolName} ${s.udiseCode} ${s.facilitatorName} ${s.block}`.toLowerCase();
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
    GroupAccum & { udiseCode: string; schoolName: string; district: string; block: string }
  >();
  const monthMap = new Map<string, GroupAccum>();
  const tourMap = new Map<string, GroupAccum & { tourName: string }>();
  const languageMap = new Map<string, GroupAccum>();
  const gradeMap = new Map<string, GroupAccum & { classesCount: number }>();
  const dateMap = new Map<string, { sessions: number; students: number }>();
  const facMap = new Map<string, GroupAccum & { name: string; latest: string }>();

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
      block: s.block,
    };
    scAgg.sessions++;
    scAgg.schoolName = s.schoolName;
    scAgg.block = s.block;
    scAgg.npsSum += s.teacherNps;

    const monthKey = /^\d{4}-\d{2}/.test(s.startDate) ? s.startDate.slice(0, 7) : 'Unknown';
    const mAgg = monthMap.get(monthKey) ?? createGroupAccum();
    mAgg.sessions++;
    mAgg.npsSum += s.teacherNps;

    const tAgg = tourMap.get(s.tourId) ?? { ...createGroupAccum(), tourName: s.tourName };
    tAgg.sessions++;
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
    };
    fAgg.sessions++;
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
          block: v.block,
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
          averageCsat: qa.average,
          averageItp: qb.average,
          positiveCsatPct: qa.positivePct,
          positiveItpPct: qb.positivePct,
          teacherNpsAverage: v.sessions > 0 ? round2(v.npsSum / v.sessions) : null,
        };
      }),
    tourBreakdown: Array.from(tourMap.entries()).map(([tourId, v]) => {
      const qa = calculateScaleSentiment(v.qaCounts);
      const qb = calculateScaleSentiment(v.qbCounts);
      return {
        tourId,
        tourName: v.tourName,
        sessions: v.sessions,
        studentsReached: v.students,
        averageCsat: qa.average,
        averageItp: qb.average,
        positiveCsatPct: qa.positivePct,
        positiveItpPct: qb.positivePct,
      };
    }),
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
