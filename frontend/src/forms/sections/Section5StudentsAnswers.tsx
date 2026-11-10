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
    pill: 'bg-[#48B98A]/14 border-[#48B98A]/50 text-[#48B98A]',
    bar: '#48B98A',
  },
  4: {
    pill: 'bg-[#4EBBBB]/14 border-[#4EBBBB]/50 text-[#4EBBBB]',
    bar: '#4EBBBB',
  },
  3: {
    pill: 'bg-[#162D55] border-[#26456F] text-[#A4B7D2]',
    bar: '#A4B7D2',
  },
  2: {
    pill: 'bg-[#392A11] border-[#F2B44D]/50 text-[#F2B44D]',
    bar: '#F2B44D',
  },
  1: {
    pill: 'bg-[#E77B83]/14 border-[#E77B83]/50 text-[#E77B83]',
    bar: '#E77B83',
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
              <h2 id="sec5-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#E8EFFC]">
                Students' answers
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#48B98A]/12 border border-[#48B98A]/45 text-[#48B98A]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs sm:text-[13px] text-[#A4B7D2] leading-relaxed mt-0.5 max-w-2xl">
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
                  ? 'rounded-xl bg-[#162D55] border border-[#26456F] p-4 sm:p-5 flex flex-col gap-5'
                  : 'flex flex-col gap-5'
              }
            >
              {isCombined && (
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#26456F]">
                  <div className="text-sm sm:text-base font-medium text-[#4EBBBB]">
                    {classLabel}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-[#A4B7D2] ct-num">
                    <span>
                      Students present:{' '}
                      <strong className="font-medium text-[#E8EFFC]">
                        {metrics.studentsPresent || '—'}
                      </strong>
                    </span>
                    <span>
                      Q-A coverage:{' '}
                      <strong className="font-medium text-[#E8EFFC]">
                        {formatPct1(metrics.questionACoveragePct)}
                      </strong>
                    </span>
                    <span>
                      Q-B coverage:{' '}
                      <strong className="font-medium text-[#E8EFFC]">
                        {formatPct1(metrics.questionBCoveragePct)}
                      </strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Question A — CSAT */}
              <fieldset className="ct-bento-well p-4 sm:p-5 min-w-0 w-full">
                <legend className="w-full min-w-0 flex flex-wrap items-center justify-between gap-2 mb-3 text-sm sm:text-[15px] font-medium text-[#E8EFFC]">
                  <span className="inline-flex items-start gap-2 min-w-0">
                    <Smile className="w-4 h-4 text-[#4EBBBB] shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="min-w-0 leading-snug">Question A: &quot;{QUESTION_A_PROMPT}&quot;</span>
                  </span>
                  {metrics.questionATotal > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#4EBBBB]/14 border border-[#4EBBBB]/45 text-[#4EBBBB] ct-num">
                      CSAT {formatScore2(metrics.csatAverage)}
                    </span>
                  )}
                </legend>

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
                        className="rounded-xl bg-[#101E3C] border border-[#26456F] hover:border-[#4EBBBB]/50 focus-within:border-[#4EBBBB] px-3 sm:px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors"
                      >
                        <label htmlFor={inputId} className="flex-1 min-w-0 cursor-pointer">
                          <div className="flex items-center gap-3">
                            <span
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-full border text-xs font-medium ct-num shrink-0 ${sStyle.pill}`}
                            >
                              {opt.score}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 text-sm text-[#E8EFFC]">
                                <span className="truncate">{opt.label}</span>
                                {metrics.questionATotal > 0 && (
                                  <span className="text-[11px] text-[#8294B1] ct-num shrink-0">
                                    {sharePct}%
                                  </span>
                                )}
                              </div>
                              <div
                                aria-hidden="true"
                                className="mt-1.5 h-1 rounded-full bg-[#0C1931] overflow-hidden"
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
                          className="ct-input w-20 sm:w-24 text-left font-medium ct-num shrink-0"
                        />
                      </div>
                    );
                  })}
                </div>

                {(metrics.questionATotal > 0 || metrics.studentsPresent > 0) && (
                  <div className="mt-3 p-3 rounded-lg bg-[#0C1931] border border-[#26456F] flex flex-col gap-2 text-xs text-[#A4B7D2] ct-num">
                    {metrics.questionATotal > 0 && (
                      <div
                        aria-hidden="true"
                        className="w-full h-1.5 rounded-full bg-[#162D55] overflow-hidden flex"
                      >
                        <div style={{ width: `${qaPosPct}%`, backgroundColor: '#48B98A' }} />
                        <div style={{ width: `${qaNeuPct}%`, backgroundColor: '#8294B1' }} />
                        <div style={{ width: `${qaNegPct}%`, backgroundColor: '#E77B83' }} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        Total responses:{' '}
                        <strong
                          className={
                            qaExceeded ? 'font-medium text-[#E77B83]' : 'font-medium text-[#E8EFFC]'
                          }
                        >
                          {metrics.questionATotal}
                          {metrics.studentsPresent > 0 ? ` / ${metrics.studentsPresent}` : ''}
                        </strong>
                      </span>
                      <span>
                        Missing:{' '}
                        <strong className="font-medium text-[#E8EFFC]">
                          {metrics.questionAMissingResponses}
                        </strong>
                      </span>
                      <span>
                        Positive (4–5):{' '}
                        <strong className="font-medium text-[#48B98A]">
                          {formatPct1(metrics.questionAPositivePct)}
                        </strong>
                      </span>
                      <span>
                        CSAT average:{' '}
                        <strong className="text-[#4EBBBB] text-sm font-medium">
                          {formatScore2(metrics.csatAverage)}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}

                {(qaFieldErr || qaExceeded) && (
                  <p role="alert" className="mt-3 text-xs text-[#E77B83] font-medium flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {qaFieldErr ||
                        `Question A total (${metrics.questionATotal}) cannot exceed students present (${metrics.studentsPresent}).`}
                    </span>
                  </p>
                )}
              </fieldset>

              {/* Question B — ITP */}
              <fieldset className="ct-bento-well p-4 sm:p-5 min-w-0 w-full">
                <legend className="w-full min-w-0 flex flex-wrap items-center justify-between gap-2 mb-3 text-sm sm:text-[15px] font-medium text-[#E8EFFC]">
                  <span className="inline-flex items-start gap-2 min-w-0">
                    <Compass className="w-4 h-4 text-[#4EBBBB] shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="min-w-0 leading-snug">Question B: &quot;{QUESTION_B_PROMPT}&quot;</span>
                  </span>
                  {metrics.questionBTotal > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#4EBBBB]/14 border border-[#4EBBBB]/45 text-[#4EBBBB] ct-num">
                      ITP {formatScore2(metrics.itpAverage)}
                    </span>
                  )}
                </legend>

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
                        className="rounded-xl bg-[#101E3C] border border-[#26456F] hover:border-[#4EBBBB]/50 focus-within:border-[#4EBBBB] px-3 sm:px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors"
                      >
                        <label htmlFor={inputId} className="flex-1 min-w-0 cursor-pointer">
                          <div className="flex items-center gap-3">
                            <span
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-full border text-xs font-medium ct-num shrink-0 ${sStyle.pill}`}
                            >
                              {opt.score}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 text-sm text-[#E8EFFC]">
                                <span className="truncate">{opt.label}</span>
                                {metrics.questionBTotal > 0 && (
                                  <span className="text-[11px] text-[#8294B1] ct-num shrink-0">
                                    {sharePct}%
                                  </span>
                                )}
                              </div>
                              <div
                                aria-hidden="true"
                                className="mt-1.5 h-1 rounded-full bg-[#0C1931] overflow-hidden"
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
                          className="ct-input w-20 sm:w-24 text-left font-medium ct-num shrink-0"
                        />
                      </div>
                    );
                  })}
                </div>

                {(metrics.questionBTotal > 0 || metrics.studentsPresent > 0) && (
                  <div className="mt-3 p-3 rounded-lg bg-[#0C1931] border border-[#26456F] flex flex-col gap-2 text-xs text-[#A4B7D2] ct-num">
                    {metrics.questionBTotal > 0 && (
                      <div
                        aria-hidden="true"
                        className="w-full h-1.5 rounded-full bg-[#162D55] overflow-hidden flex"
                      >
                        <div style={{ width: `${qbPosPct}%`, backgroundColor: '#48B98A' }} />
                        <div style={{ width: `${qbNeuPct}%`, backgroundColor: '#8294B1' }} />
                        <div style={{ width: `${qbNegPct}%`, backgroundColor: '#E77B83' }} />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        Total responses:{' '}
                        <strong
                          className={
                            qbExceeded ? 'font-medium text-[#E77B83]' : 'font-medium text-[#E8EFFC]'
                          }
                        >
                          {metrics.questionBTotal}
                          {metrics.studentsPresent > 0 ? ` / ${metrics.studentsPresent}` : ''}
                        </strong>
                      </span>
                      <span>
                        Missing:{' '}
                        <strong className="font-medium text-[#E8EFFC]">
                          {metrics.questionBMissingResponses}
                        </strong>
                      </span>
                      <span>
                        Positive (4–5):{' '}
                        <strong className="font-medium text-[#48B98A]">
                          {formatPct1(metrics.questionBPositivePct)}
                        </strong>
                      </span>
                      <span>
                        ITP average:{' '}
                        <strong className="text-[#4EBBBB] text-sm font-medium">
                          {formatScore2(metrics.itpAverage)}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}

                {(qbFieldErr || qbExceeded) && (
                  <p role="alert" className="mt-3 text-xs text-[#E77B83] font-medium flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {qbFieldErr ||
                        `Question B total (${metrics.questionBTotal}) cannot exceed students present (${metrics.studentsPresent}).`}
                    </span>
                  </p>
                )}
              </fieldset>

              {/* Non-blocking warnings */}
              {(totalMismatch || lowCoverage) && !qaExceeded && !qbExceeded && (
                <div className="p-3 rounded-lg bg-[#392A11] border border-[#F2B44D]/45 text-xs text-[#F2B44D] flex flex-col gap-1">
                  {totalMismatch && (
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-[#F2B44D] shrink-0" aria-hidden="true" />
                      <span>
                        Warning: Question A responses ({metrics.questionATotal}) differ from Question
                        B responses ({metrics.questionBTotal}).
                      </span>
                    </div>
                  )}
                  {lowCoverage && (
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-[#F2B44D] shrink-0" aria-hidden="true" />
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
