import { QUESTION_A_OPTIONS, QUESTION_B_OPTIONS, TEACHER_NPS_GROUPS } from '../config/defaults';
import type {
  ClassGroupInput,
  ClassMetrics,
  NumericScoreCounts,
  ScaleSentimentBreakdown,
  ScoreCounts,
  SessionMetricsSummary,
  TeacherNpsGroup,
} from '../types/domain';

export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatScore2(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function formatPct1(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${round1(value).toFixed(1)}%`;
}

/**
 * Parses a score count input string for calculation.
 * Blank strings default to 0 (matching Section 5 spec); non-negative integers parse directly.
 */
export function parseCountForCalc(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return 0;
  return Number.parseInt(trimmed, 10);
}

export function isValidWholeNumberString(raw: string, allowEmpty = true): boolean {
  const trimmed = raw.trim();
  if (trimmed === '') return allowEmpty;
  return /^\d+$/.test(trimmed);
}

export function toNumericCounts(counts: ScoreCounts): NumericScoreCounts {
  return {
    score5: parseCountForCalc(counts.score5),
    score4: parseCountForCalc(counts.score4),
    score3: parseCountForCalc(counts.score3),
    score2: parseCountForCalc(counts.score2),
    score1: parseCountForCalc(counts.score1),
  };
}

export function calculateScaleMetrics(counts: NumericScoreCounts): {
  total: number;
  weighted: number;
  exactAverage: number | null;
  average: number | null;
} {
  const total =
    counts.score5 + counts.score4 + counts.score3 + counts.score2 + counts.score1;
  const weighted =
    5 * counts.score5 +
    4 * counts.score4 +
    3 * counts.score3 +
    2 * counts.score2 +
    1 * counts.score1;

  if (total === 0) {
    return { total: 0, weighted: 0, exactAverage: null, average: null };
  }
  const exactAverage = weighted / total;
  return {
    total,
    weighted,
    exactAverage,
    average: round2(exactAverage),
  };
}

/**
 * Calculates full sentiment distribution and exact floating-point percentages for a 5-point scale.
 * Positive = scores 4 + 5; Neutral = score 3; Negative = scores 1 + 2.
 */
export function calculateScaleSentiment(counts: NumericScoreCounts): ScaleSentimentBreakdown {
  const scale = calculateScaleMetrics(counts);
  const positiveCount = counts.score4 + counts.score5;
  const neutralCount = counts.score3;
  const negativeCount = counts.score1 + counts.score2;

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
      negativePct: null,
    };
  }

  return {
    total: scale.total,
    weighted: scale.weighted,
    exactAverage: scale.exactAverage,
    average: scale.average,
    positiveCount,
    neutralCount,
    negativeCount,
    positivePct: (positiveCount / scale.total) * 100,
    neutralPct: (neutralCount / scale.total) * 100,
    negativePct: (negativeCount / scale.total) * 100,
  };
}

export function resolveTeacherNps(
  group: TeacherNpsGroup | '',
  exactScoreRaw: string,
): {
  exactScore: number | null;
  classification: 'Promoter' | 'Passive' | 'Detractor' | null;
  nps: number | null;
} {
  const trimmed = exactScoreRaw.trim();
  if (trimmed !== '' && /^(10|[0-9])$/.test(trimmed)) {
    const score = Number.parseInt(trimmed, 10);
    if (score >= 9) return { exactScore: score, classification: 'Promoter', nps: 100 };
    if (score >= 7) return { exactScore: score, classification: 'Passive', nps: 0 };
    return { exactScore: score, classification: 'Detractor', nps: -100 };
  }

  if (group) {
    const match = TEACHER_NPS_GROUPS.find((g) => g.value === group);
    if (match) {
      return {
        exactScore: null,
        classification: match.classification,
        nps: match.nps,
      };
    }
  }

  return {
    exactScore: null,
    classification: null,
    nps: null,
  };
}

export function calculateSessionMetrics(
  classes: ClassGroupInput[],
  teacherNpsGroup: TeacherNpsGroup | '',
  teacherExactScore: string,
): SessionMetricsSummary {
  const pooledQA: NumericScoreCounts = { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 };
  const pooledQB: NumericScoreCounts = { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 };

  const classBreakdown: ClassMetrics[] = classes.map((row) => {
    const present = parseCountForCalc(row.studentsPresent);
    const qACounts = toNumericCounts(row.questionA);
    const qBCounts = toNumericCounts(row.questionB);
    const qASentiment = calculateScaleSentiment(qACounts);
    const qBSentiment = calculateScaleSentiment(qBCounts);

    pooledQA.score5 += qACounts.score5;
    pooledQA.score4 += qACounts.score4;
    pooledQA.score3 += qACounts.score3;
    pooledQA.score2 += qACounts.score2;
    pooledQA.score1 += qACounts.score1;

    pooledQB.score5 += qBCounts.score5;
    pooledQB.score4 += qBCounts.score4;
    pooledQB.score3 += qBCounts.score3;
    pooledQB.score2 += qBCounts.score2;
    pooledQB.score1 += qBCounts.score1;

    return {
      rowId: row.rowId,
      grade: row.grade,
      section: row.section,
      studentsPresent: present,
      questionACounts: qACounts,
      questionBCounts: qBCounts,
      questionATotal: qASentiment.total,
      questionAWeighted: qASentiment.weighted,
      csatAverage: qASentiment.average,
      questionACoveragePct: present > 0 ? round2((qASentiment.total / present) * 100) : null,
      questionAMissingResponses: Math.max(0, present - qASentiment.total),
      questionAPositivePct: qASentiment.positivePct,
      questionBTotal: qBSentiment.total,
      questionBWeighted: qBSentiment.weighted,
      itpAverage: qBSentiment.average,
      questionBCoveragePct: present > 0 ? round2((qBSentiment.total / present) * 100) : null,
      questionBMissingResponses: Math.max(0, present - qBSentiment.total),
      questionBPositivePct: qBSentiment.positivePct,
    };
  });

  const totalStudentsPresent = classBreakdown.reduce((sum, c) => sum + c.studentsPresent, 0);
  const questionASentiment = calculateScaleSentiment(pooledQA);
  const questionBSentiment = calculateScaleSentiment(pooledQB);

  const totalQuestionAMissing = Math.max(0, totalStudentsPresent - questionASentiment.total);
  const totalQuestionBMissing = Math.max(0, totalStudentsPresent - questionBSentiment.total);

  const overallQuestionACoveragePct =
    totalStudentsPresent > 0
      ? round2((questionASentiment.total / totalStudentsPresent) * 100)
      : null;

  const overallQuestionBCoveragePct =
    totalStudentsPresent > 0
      ? round2((questionBSentiment.total / totalStudentsPresent) * 100)
      : null;

  const teacher = resolveTeacherNps(teacherNpsGroup, teacherExactScore);

  return {
    totalClasses: classBreakdown.length,
    totalStudentsPresent,
    totalQuestionAResponses: questionASentiment.total,
    totalQuestionAWeighted: questionASentiment.weighted,
    totalQuestionAMissing,
    overallCsat: questionASentiment.average,
    overallQuestionACoveragePct,
    questionASentiment,
    totalQuestionBResponses: questionBSentiment.total,
    totalQuestionBWeighted: questionBSentiment.weighted,
    totalQuestionBMissing,
    overallItp: questionBSentiment.average,
    overallQuestionBCoveragePct,
    questionBSentiment,
    teacherScoreExact: teacher.exactScore,
    teacherClassification: teacher.classification,
    teacherNps: teacher.nps,
    classBreakdown,
  };
}

export function buildCalculationWorking(metrics: SessionMetricsSummary): {
  csatFormula: string;
  itpFormula: string;
  teacherFormula: string;
} {
  const pooledQA: NumericScoreCounts = metrics.classBreakdown.reduce(
    (acc, c) => ({
      score5: acc.score5 + c.questionACounts.score5,
      score4: acc.score4 + c.questionACounts.score4,
      score3: acc.score3 + c.questionACounts.score3,
      score2: acc.score2 + c.questionACounts.score2,
      score1: acc.score1 + c.questionACounts.score1,
    }),
    { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 },
  );

  const pooledQB: NumericScoreCounts = metrics.classBreakdown.reduce(
    (acc, c) => ({
      score5: acc.score5 + c.questionBCounts.score5,
      score4: acc.score4 + c.questionBCounts.score4,
      score3: acc.score3 + c.questionBCounts.score3,
      score2: acc.score2 + c.questionBCounts.score2,
      score1: acc.score1 + c.questionBCounts.score1,
    }),
    { score5: 0, score4: 0, score3: 0, score2: 0, score1: 0 },
  );

  const formatTerms = (c: NumericScoreCounts) =>
    `[(5 × ${c.score5}) + (4 × ${c.score4}) + (3 × ${c.score3}) + (2 × ${c.score2}) + (1 × ${c.score1})]`;

  const csatFormula =
    metrics.totalQuestionAResponses > 0
      ? `CSAT = ${formatTerms(pooledQA)} ÷ ${metrics.totalQuestionAResponses} = ${metrics.totalQuestionAWeighted} ÷ ${metrics.totalQuestionAResponses} = ${formatScore2(metrics.overallCsat)}`
      : 'CSAT = No Question A responses entered yet (cannot divide by zero)';

  const itpFormula =
    metrics.totalQuestionBResponses > 0
      ? `ITP = ${formatTerms(pooledQB)} ÷ ${metrics.totalQuestionBResponses} = ${metrics.totalQuestionBWeighted} ÷ ${metrics.totalQuestionBResponses} = ${formatScore2(metrics.overallItp)}`
      : 'ITP = No Question B responses entered yet (cannot divide by zero)';

  const teacherFormula =
    metrics.teacherClassification !== null && metrics.teacherNps !== null
      ? `Teacher NPS = ${metrics.teacherClassification}${metrics.teacherScoreExact !== null ? ` (Score ${metrics.teacherScoreExact}/10)` : ''} → ${metrics.teacherNps > 0 ? '+100' : metrics.teacherNps}`
      : 'Teacher NPS = Not entered yet (Promoter 9–10 = +100, Passive 7–8 = 0, Detractor 0–6 = -100)';

  return { csatFormula, itpFormula, teacherFormula };
}

export { QUESTION_A_OPTIONS, QUESTION_B_OPTIONS };
