import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Compass,
  ListChecks,
  Smile,
} from 'lucide-react';
import {
  QUESTION_A_OPTIONS,
  QUESTION_A_PROMPT,
  QUESTION_B_OPTIONS,
  QUESTION_B_PROMPT,
} from '../../config/defaults';
import { formatPct1, formatScore2 } from '../../calculations/metrics';
import type {
  ClassGroupInput,
  ClassMetrics,
  ScoreCounts,
  SessionMode,
} from '../../types/domain';

interface Section5Props {
  sessionMode: SessionMode;
  classes: ClassGroupInput[];
  classMetrics: ClassMetrics[];
  isComplete?: boolean;
  errorMap: Record<string, string>;
  onUpdateCount: (
    rowIndex: number,
    question: 'questionA' | 'questionB',
    scoreKey: keyof ScoreCounts,
    rawValue: string,
  ) => void;
}

const SCORE_STYLE_MAP: Record<number, { pill: string; bar: string }> = {
  5: {
    pill: 'bg-[#ECFDF5] border-[#047857]/40 text-[#047857]',
    bar: '#047857',
  },
  4: {
    pill: 'bg-[#E8F6FF] border-[#0284C7]/45 text-[#006BB8]',
    bar: '#1EA7FF',
  },
  3: {
    pill: 'bg-[#F5F2E9] border-[#C7BEA7] text-[#243647]',
    bar: '#5F7082',
  },
  2: {
    pill: 'bg-[#FFFBEB] border-[#B45309]/40 text-[#B45309]',
    bar: '#B45309',
  },
  1: {
    pill: 'bg-[#FFF1F2] border-[#BE123C]/40 text-[#BE123C]',
    bar: '#BE123C',
  },
};

export const Section5StudentsAnswers: React.FC<Section5Props> = ({
  sessionMode,
  classes,
  classMetrics,
  isComplete = false,
  errorMap,
  onUpdateCount,
}) => {
  const isCombined = sessionMode === 'combined' || classes.length > 1;

  return (
    <section
      id="section-5"
      tabIndex={-1}
      aria-labelledby="sec5-heading"
      data-complete={isComplete ? 'true' : 'false'}
      className="ct-form-section p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3.5">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <ListChecks className="w-4 h-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec5-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0A1B2C]">
                Students' answers
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/40 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs sm:text-[13px] text-[#243647] leading-relaxed mt-0.5 max-w-2xl">
              Enter student response counts for each rating (enter 0 if none). Distribution bars and
              averages calculate automatically as you type.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {classes.map((row, idx) => {
          const metrics = classMetrics[idx]!;
          const classLabel =
            row.grade || row.section
              ? `Grade ${row.grade || '?'} · ${row.section || 'Section ?'}`
              : `Class ${idx + 1}`;

          const qaExceeded =
            metrics.studentsPresent > 0 && metrics.questionATotal > metrics.studentsPresent;
          const qbExceeded =
            metrics.studentsPresent > 0 && metrics.questionBTotal > metrics.studentsPresent;
          const totalMismatch = metrics.questionATotal !== metrics.questionBTotal;
          const lowCoverage =
            metrics.studentsPresent > 0 &&
            ((metrics.questionATotal > 0 &&
              (metrics.questionATotal / metrics.studentsPresent) * 100 < 75) ||
              (metrics.questionBTotal > 0 &&
                (metrics.questionBTotal / metrics.studentsPresent) * 100 < 75));

          const qaFieldErr =
            errorMap[`classes.${idx}.questionA`] ||
            errorMap[`classes.${idx}.questionA.score5`] ||
            errorMap[`classes.${idx}.questionA.score4`] ||
            errorMap[`classes.${idx}.questionA.score3`] ||
            errorMap[`classes.${idx}.questionA.score2`] ||
            errorMap[`classes.${idx}.questionA.score1`];

          const qbFieldErr =
            errorMap[`classes.${idx}.questionB`] ||
            errorMap[`classes.${idx}.questionB.score5`] ||
            errorMap[`classes.${idx}.questionB.score4`] ||
            errorMap[`classes.${idx}.questionB.score3`] ||
            errorMap[`classes.${idx}.questionB.score2`] ||
            errorMap[`classes.${idx}.questionB.score1`];

          const qaPosPct =
            metrics.questionATotal > 0
              ? ((metrics.questionACounts.score5 + metrics.questionACounts.score4) /
                  metrics.questionATotal) *
                100
              : 0;
          const qaNeuPct =
            metrics.questionATotal > 0
              ? (metrics.questionACounts.score3 / metrics.questionATotal) * 100
              : 0;
          const qaNegPct =
            metrics.questionATotal > 0
              ? ((metrics.questionACounts.score2 + metrics.questionACounts.score1) /
                  metrics.questionATotal) *
                100
              : 0;

          const qbPosPct =
            metrics.questionBTotal > 0
              ? ((metrics.questionBCounts.score5 + metrics.questionBCounts.score4) /
                  metrics.questionBTotal) *
                100
              : 0;
          const qbNeuPct =
            metrics.questionBTotal > 0
              ? (metrics.questionBCounts.score3 / metrics.questionBTotal) * 100
              : 0;
          const qbNegPct =
            metrics.questionBTotal > 0
              ? ((metrics.questionBCounts.score2 + metrics.questionBCounts.score1) /
                  metrics.questionBTotal) *
                100
              : 0;

          return (
            <div
              key={row.rowId}
              className={
                isCombined
                  ? 'rounded-xl bg-[#F5F2E9] border border-[#C7BEA7] p-4 sm:p-5 flex flex-col gap-5'
                  : 'flex flex-col gap-5'
              }
            >
              {isCombined && (
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#C7BEA7]">
                  <div className="text-sm sm:text-base font-medium text-[#006BB8]">
                    {classLabel}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-[#243647] ct-num">
                    <span>
                      Students present:{' '}
                      <strong className="font-medium text-[#0A1B2C]">
                        {metrics.studentsPresent || '—'}
                      </strong>
                    </span>
                    <span>
                      Q-A coverage:{' '}
                      <strong className="font-medium text-[#0A1B2C]">
                        {formatPct1(metrics.questionACoveragePct)}
                      </strong>
                    </span>
                    <span>
                      Q-B coverage:{' '}
                      <strong className="font-medium text-[#0A1B2C]">
                        {formatPct1(metrics.questionBCoveragePct)}
                      </strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Question A — CSAT */}
              <div
                role="group"
                aria-labelledby={`qa-heading-${idx}`}
                className="ct-bento-well p-4 sm:p-5 min-w-0 w-full"
              >
                <div className="flex flex-wrap items-start justify-between gap-2.5 mb-3.5 pb-2.5 border-b border-[#DFD7C2]">
                  <h3
                    id={`qa-heading-${idx}`}
                    className="inline-flex items-start gap-2 min-w-0 flex-1 text-sm sm:text-[15px] font-medium text-[#0A1B2C]"
                  >
                    <Smile className="w-4 h-4 text-[#006BB8] shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="min-w-0 leading-snug">
                      Question A: &quot;{QUESTION_A_PROMPT}&quot;
                    </span>
                  </h3>
                  {metrics.questionATotal > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E8F6FF] border border-[#0284C7]/45 text-[#006BB8] ct-num shrink-0 whitespace-nowrap">
                      CSAT {formatScore2(metrics.csatAverage)}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {QUESTION_A_OPTIONS.map((opt) => {
                    const key = `score${opt.score}` as keyof ScoreCounts;
                    const inputId = `qa-${idx}-${key}`;
                    const countNum = Number.parseInt(row.questionA[key] || '0', 10) || 0;
                    const sharePct =
                      metrics.questionATotal > 0
                        ? Math.round((countNum / metrics.questionATotal) * 100)
                        : 0;
                    const sStyle = SCORE_STYLE_MAP[opt.score] ?? SCORE_STYLE_MAP[3]!;
                    return (
                      <div
                        key={opt.score}
                        className="rounded-xl bg-[#FFFFFF] border border-[#C7BEA7] hover:border-[#0284C7] focus-within:border-[#006BB8] px-3 sm:px-3.5 py-2.5 grid grid-cols-[minmax(0,1fr)_5rem] sm:grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 transition-colors"
                      >
                        <label htmlFor={inputId} className="min-w-0 cursor-pointer">
                          <div className="flex items-center gap-2.5 sm:gap-3">
                            <span
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-full border text-xs font-medium ct-num shrink-0 ${sStyle.pill}`}
                            >
                              {opt.score}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2 text-sm text-[#0A1B2C]">
                                <span className="leading-snug">{opt.label}</span>
                                {metrics.questionATotal > 0 && (
                                  <span className="text-[11px] text-[#33475B] ct-num shrink-0 whitespace-nowrap">
                                    {sharePct}%
                                  </span>
                                )}
                              </div>
                              <div
                                aria-hidden="true"
                                className="mt-1.5 h-1 rounded-full bg-[#DFD7C2] overflow-hidden"
                              >
                                <div
                                  className="h-full rounded-full transition-[width] duration-200"
                                  style={{
                                    width: `${sharePct}%`,
                                    backgroundColor: sStyle.bar,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </label>
                        <input
                          id={inputId}
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          aria-label={`${classLabel} Question A score ${opt.score} (${opt.label}) count`}
                          value={row.questionA[key]}
                          onChange={(e) => onUpdateCount(idx, 'questionA', key, e.target.value)}
                          className="ct-input w-full text-center sm:text-left font-medium ct-num"
                        />
                      </div>
                    );
                  })}
                </div>

                {(metrics.questionATotal > 0 || metrics.studentsPresent > 0) && (
                  <div className="mt-3 p-3 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] flex flex-col gap-2 text-xs text-[#243647] ct-num">
                    {metrics.questionATotal > 0 && (
                      <div
                        aria-hidden="true"
                        className="w-full h-1.5 rounded-full bg-[#DFD7C2] overflow-hidden flex"
                      >
                        <div style={{ width: `${qaPosPct}%`, backgroundColor: '#047857' }} />
                        <div style={{ width: `${qaNeuPct}%`, backgroundColor: '#5F7082' }} />
                        <div style={{ width: `${qaNegPct}%`, backgroundColor: '#BE123C' }} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        Total responses:{' '}
                        <strong
                          className={
                            qaExceeded ? 'font-medium text-[#BE123C]' : 'font-medium text-[#0A1B2C]'
                          }
                        >
                          {metrics.questionATotal}
                          {metrics.studentsPresent > 0 ? ` / ${metrics.studentsPresent}` : ''}
                        </strong>
                      </span>
                      <span>
                        Missing:{' '}
                        <strong className="font-medium text-[#0A1B2C]">
                          {metrics.questionAMissingResponses}
                        </strong>
                      </span>
                      <span>
                        Positive (4–5):{' '}
                        <strong className="font-medium text-[#047857]">
                          {formatPct1(metrics.questionAPositivePct)}
                        </strong>
                      </span>
                      <span>
                        CSAT average:{' '}
                        <strong className="text-[#006BB8] text-sm font-medium">
                          {formatScore2(metrics.csatAverage)}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}

                {(qaFieldErr || qaExceeded) && (
                  <p role="alert" className="mt-3 text-xs text-[#BE123C] font-medium flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {qaFieldErr ||
                        `Question A total (${metrics.questionATotal}) cannot exceed students present (${metrics.studentsPresent}).`}
                    </span>
                  </p>
                )}
              </div>

              {/* Question B — ITP */}
              <div
                role="group"
                aria-labelledby={`qb-heading-${idx}`}
                className="ct-bento-well p-4 sm:p-5 min-w-0 w-full"
              >
                <div className="flex flex-wrap items-start justify-between gap-2.5 mb-3.5 pb-2.5 border-b border-[#DFD7C2]">
                  <h3
                    id={`qb-heading-${idx}`}
                    className="inline-flex items-start gap-2 min-w-0 flex-1 text-sm sm:text-[15px] font-medium text-[#0A1B2C]"
                  >
                    <Compass className="w-4 h-4 text-[#006BB8] shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="min-w-0 leading-snug">
                      Question B: &quot;{QUESTION_B_PROMPT}&quot;
                    </span>
                  </h3>
                  {metrics.questionBTotal > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E8F6FF] border border-[#0284C7]/45 text-[#006BB8] ct-num shrink-0 whitespace-nowrap">
                      ITP {formatScore2(metrics.itpAverage)}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {QUESTION_B_OPTIONS.map((opt) => {
                    const key = `score${opt.score}` as keyof ScoreCounts;
                    const inputId = `qb-${idx}-${key}`;
                    const countNum = Number.parseInt(row.questionB[key] || '0', 10) || 0;
                    const sharePct =
                      metrics.questionBTotal > 0
                        ? Math.round((countNum / metrics.questionBTotal) * 100)
                        : 0;
                    const sStyle = SCORE_STYLE_MAP[opt.score] ?? SCORE_STYLE_MAP[3]!;
                    return (
                      <div
                        key={opt.score}
                        className="rounded-xl bg-[#FFFFFF] border border-[#C7BEA7] hover:border-[#0284C7] focus-within:border-[#006BB8] px-3 sm:px-3.5 py-2.5 grid grid-cols-[minmax(0,1fr)_5rem] sm:grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 transition-colors"
                      >
                        <label htmlFor={inputId} className="min-w-0 cursor-pointer">
                          <div className="flex items-center gap-2.5 sm:gap-3">
                            <span
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-full border text-xs font-medium ct-num shrink-0 ${sStyle.pill}`}
                            >
                              {opt.score}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2 text-sm text-[#0A1B2C]">
                                <span className="leading-snug">{opt.label}</span>
                                {metrics.questionBTotal > 0 && (
                                  <span className="text-[11px] text-[#33475B] ct-num shrink-0 whitespace-nowrap">
                                    {sharePct}%
                                  </span>
                                )}
                              </div>
                              <div
                                aria-hidden="true"
                                className="mt-1.5 h-1 rounded-full bg-[#DFD7C2] overflow-hidden"
                              >
                                <div
                                  className="h-full rounded-full transition-[width] duration-200"
                                  style={{
                                    width: `${sharePct}%`,
                                    backgroundColor: sStyle.bar,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </label>
                        <input
                          id={inputId}
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          aria-label={`${classLabel} Question B score ${opt.score} (${opt.label}) count`}
                          value={row.questionB[key]}
                          onChange={(e) => onUpdateCount(idx, 'questionB', key, e.target.value)}
                          className="ct-input w-full text-center sm:text-left font-medium ct-num"
                        />
                      </div>
                    );
                  })}
                </div>

                {(metrics.questionBTotal > 0 || metrics.studentsPresent > 0) && (
                  <div className="mt-3 p-3 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] flex flex-col gap-2 text-xs text-[#243647] ct-num">
                    {metrics.questionBTotal > 0 && (
                      <div
                        aria-hidden="true"
                        className="w-full h-1.5 rounded-full bg-[#DFD7C2] overflow-hidden flex"
                      >
                        <div style={{ width: `${qbPosPct}%`, backgroundColor: '#047857' }} />
                        <div style={{ width: `${qbNeuPct}%`, backgroundColor: '#5F7082' }} />
                        <div style={{ width: `${qbNegPct}%`, backgroundColor: '#BE123C' }} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        Total responses:{' '}
                        <strong
                          className={
                            qbExceeded ? 'font-medium text-[#BE123C]' : 'font-medium text-[#0A1B2C]'
                          }
                        >
                          {metrics.questionBTotal}
                          {metrics.studentsPresent > 0 ? ` / ${metrics.studentsPresent}` : ''}
                        </strong>
                      </span>
                      <span>
                        Missing:{' '}
                        <strong className="font-medium text-[#0A1B2C]">
                          {metrics.questionBMissingResponses}
                        </strong>
                      </span>
                      <span>
                        Positive (4–5):{' '}
                        <strong className="font-medium text-[#047857]">
                          {formatPct1(metrics.questionBPositivePct)}
                        </strong>
                      </span>
                      <span>
                        ITP average:{' '}
                        <strong className="text-[#006BB8] text-sm font-medium">
                          {formatScore2(metrics.itpAverage)}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}

                {(qbFieldErr || qbExceeded) && (
                  <p role="alert" className="mt-3 text-xs text-[#BE123C] font-medium flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {qbFieldErr ||
                        `Question B total (${metrics.questionBTotal}) cannot exceed students present (${metrics.studentsPresent}).`}
                    </span>
                  </p>
                )}
              </div>

              {/* Non-blocking warnings */}
              {(totalMismatch || lowCoverage) && !qaExceeded && !qbExceeded && (
                <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#B45309]/40 text-xs text-[#92400E] flex flex-col gap-1">
                  {totalMismatch && (
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0" aria-hidden="true" />
                      <span>
                        Warning: Question A responses ({metrics.questionATotal}) differ from Question
                        B responses ({metrics.questionBTotal}).
                      </span>
                    </div>
                  )}
                  {lowCoverage && (
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0" aria-hidden="true" />
                      <span>
                        Warning: Response coverage is below 75% of students present ({metrics.studentsPresent}).
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
