import React from 'react';
import { CheckCircle2, Eraser, GraduationCap, Plus, Trash2, Users } from 'lucide-react';
import { formatScore2 } from '../../calculations/metrics';
import type {
  AppConfiguration,
  ClassGroupInput,
  SessionMetricsSummary,
  SessionMode,
} from '../../types/domain';

interface Section4Props {
  sessionMode: SessionMode;
  classes: ClassGroupInput[];
  metrics: SessionMetricsSummary;
  config: AppConfiguration;
  isComplete?: boolean;
  errorMap: Record<string, string>;
  onChangeMode: (mode: SessionMode) => void;
  onUpdateClassField: (
    rowIndex: number,
    field: 'grade' | 'section' | 'studentsPresent',
    value: string,
  ) => void;
  onAddClassRow: () => void;
  onRemoveClassRow: (rowIndex: number) => void;
  onClearClassRow: (rowIndex: number) => void;
}

export const Section4AboutClass: React.FC<Section4Props> = ({
  sessionMode,
  classes,
  metrics,
  config,
  isComplete = false,
  errorMap,
  onChangeMode,
  onUpdateClassField,
  onAddClassRow,
  onRemoveClassRow,
  onClearClassRow,
}) => {
  return (
    <section
      id="section-4"
      tabIndex={-1}
      aria-labelledby="sec4-heading"
      data-complete={isComplete ? 'true' : 'false'}
      className="ct-form-section p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <Users className="w-4 h-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec4-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#E8EFFC]">
                About the class
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#48B98A]/12 border border-[#48B98A]/45 text-[#48B98A]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#A4B7D2] mt-0.5">
              Single grade or combined classroom roster and total attendance count
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-[#0C1931] border border-[#26456F] text-[#A4B7D2] ct-num">
          <GraduationCap className="w-3.5 h-3.5 text-[#4EBBBB]" aria-hidden="true" />
          {sessionMode === 'combined'
            ? `Combined · ${classes.length} groups`
            : 'Single class'}
          {metrics.totalStudentsPresent > 0 ? ` · ${metrics.totalStudentsPresent} students` : ''}
        </span>
      </div>

      {/* Single vs Combined selector + quick visual pills */}
      <div className="ct-bento-well p-4 flex flex-col gap-2.5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="sessionMode" className="text-sm font-medium text-[#E8EFFC]">
            Did you take this session for more than one section or grade together?
          </label>
          <div className="inline-flex rounded-full bg-[#101E3C] border border-[#26456F] p-0.5 gap-1">
            <button
              type="button"
              onClick={() => onChangeMode('single')}
              aria-pressed={sessionMode === 'single'}
              className={`ct-interactive-tile px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                sessionMode === 'single'
                  ? 'bg-[#4EBBBB] text-[#0C1326]'
                  : 'text-[#A4B7D2] hover:text-[#E8EFFC]'
              }`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('combined')}
              aria-pressed={sessionMode === 'combined'}
              className={`ct-interactive-tile px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                sessionMode === 'combined'
                  ? 'bg-[#4EBBBB] text-[#0C1326]'
                  : 'text-[#A4B7D2] hover:text-[#E8EFFC]'
              }`}
            >
              Combined
            </button>
          </div>
        </div>

        <select
          id="sessionMode"
          name="sessionMode"
          value={sessionMode}
          onChange={(e) => onChangeMode(e.target.value as SessionMode)}
          aria-describedby="sessionMode-hint"
          className="ct-input ct-select"
        >
          <option value="single">No, one section of one grade</option>
          <option value="combined">Yes, sections or grades were combined</option>
        </select>
        <p id="sessionMode-hint" className="text-xs text-[#8294B1]">
          For example 8A and 8B together, or grade 8 and grade 9 together.
        </p>
      </div>

      {errorMap.classes && (
        <p role="alert" className="mb-3 text-xs text-[#E77B83] font-medium">
          {errorMap.classes}
        </p>
      )}

      {/* Class rows */}
      <div className="flex flex-col gap-4">
        {classes.map((row, idx) => {
          const gradeErr = errorMap[`classes.${idx}.grade`];
          const secErr = errorMap[`classes.${idx}.section`];
          const presentErr = errorMap[`classes.${idx}.studentsPresent`];

          return (
            <div
              key={row.rowId}
              className={
                sessionMode === 'combined'
                  ? 'p-4 rounded-xl bg-[#162D55] border border-[#26456F] shadow-[inset_0_1px_0_rgba(232,239,252,0.06)]'
                  : 'ct-bento-well p-4'
              }
            >
              {sessionMode === 'combined' && (
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <span className="text-sm font-medium text-[#4EBBBB] ct-num">
                    Class {idx + 1} of {classes.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onClearClassRow(idx)}
                      className="ct-interactive-tile inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#0C1931] hover:bg-[#172B4D] border border-[#26456F] text-[#E8EFFC] cursor-pointer transition-colors"
                    >
                      <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                      Clear row
                    </button>
                    {classes.length > 2 && (
                      <button
                        type="button"
                        onClick={() => onRemoveClassRow(idx)}
                        aria-label={`Remove class ${idx + 1}`}
                        className="ct-interactive-tile inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#E77B83]/12 hover:bg-[#E77B83]/22 border border-[#E77B83]/45 text-[#E77B83] cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                {/* Grade */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`class-grade-${idx}`} className="text-sm font-medium text-[#E8EFFC]">
                    Which class (grade) is it?
                    <span className="ml-1 text-[#4EBBBB]" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <select
                    id={`class-grade-${idx}`}
                    required
                    value={row.grade}
                    onChange={(e) => onUpdateClassField(idx, 'grade', e.target.value)}
                    aria-invalid={Boolean(gradeErr)}
                    aria-describedby={gradeErr ? `class-grade-${idx}-error` : undefined}
                    data-error={`class-grade-${idx}-error`}
                    className="ct-input ct-select"
                  >
                    <option value="">Choose...</option>
                    {config.gradeOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  {gradeErr && (
                    <p id={`class-grade-${idx}-error`} className="text-xs text-[#E77B83] font-medium">
                      {gradeErr}
                    </p>
                  )}
                </div>

                {/* Section */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`class-section-${idx}`} className="text-sm font-medium text-[#E8EFFC]">
                    Section
                    <span className="ml-1 text-[#4EBBBB]" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <select
                    id={`class-section-${idx}`}
                    required
                    value={row.section}
                    onChange={(e) => onUpdateClassField(idx, 'section', e.target.value)}
                    aria-invalid={Boolean(secErr)}
                    aria-describedby={
                      secErr ? `class-section-${idx}-hint class-section-${idx}-error` : `class-section-${idx}-hint`
                    }
                    data-error={`class-section-${idx}-error`}
                    className="ct-input ct-select"
                  >
                    <option value="">Choose...</option>
                    {config.sectionOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <p id={`class-section-${idx}-hint`} className="text-xs text-[#8294B1]">
                    If the class has no sections, choose "No section".
                  </p>
                  {secErr && (
                    <p id={`class-section-${idx}-error`} className="text-xs text-[#E77B83] font-medium">
                      {secErr}
                    </p>
                  )}
                </div>

                {/* Students present */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`class-present-${idx}`} className="text-sm font-medium text-[#E8EFFC]">
                    How many students were present?
                    <span className="ml-1 text-[#4EBBBB]" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id={`class-present-${idx}`}
                    type="text"
                    inputMode="numeric"
                    required
                    pattern="[1-9][0-9]*"
                    value={row.studentsPresent}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^\d]/g, '');
                      onUpdateClassField(idx, 'studentsPresent', clean);
                    }}
                    aria-invalid={Boolean(presentErr)}
                    aria-describedby={presentErr ? `class-present-${idx}-error` : undefined}
                    data-error={`class-present-${idx}-error`}
                    className="ct-input ct-num"
                  />
                  {presentErr && (
                    <p id={`class-present-${idx}-error`} className="text-xs text-[#E77B83] font-medium">
                      {presentErr}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Combined classes actions & pooled summary */}
      {sessionMode === 'combined' && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={classes.length >= 10}
              onClick={onAddClassRow}
              className="ct-btn-secondary text-sm"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add Class ({classes.length}/10)
            </button>
            <span className="text-xs text-[#8294B1]">
              Combined sessions allow between 2 and 10 class/grade rows.
            </span>
          </div>

          <div className="ct-bento-well p-3.5 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs ct-num">
            <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
              <Users className="w-4 h-4 text-[#4EBBBB] shrink-0" aria-hidden="true" />
              <div>
                <div className="text-[#A4B7D2]">Combined Classes</div>
                <div className="text-base font-semibold text-[#E8EFFC]">{metrics.totalClasses}</div>
              </div>
            </div>
            <div>
              <div className="text-[#A4B7D2]">Total Students</div>
              <div className="text-base font-semibold text-[#E8EFFC]">
                {metrics.totalStudentsPresent}
              </div>
            </div>
            <div>
              <div className="text-[#A4B7D2]">Q-A Responses</div>
              <div className="text-base font-semibold text-[#E8EFFC]">
                {metrics.totalQuestionAResponses}
              </div>
            </div>
            <div>
              <div className="text-[#A4B7D2]">Pooled CSAT</div>
              <div className="text-base font-semibold text-[#4EBBBB]">
                {formatScore2(metrics.overallCsat)}
              </div>
            </div>
            <div>
              <div className="text-[#A4B7D2]">Pooled ITP</div>
              <div className="text-base font-semibold text-[#E8EFFC]">
                {formatScore2(metrics.overallItp)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
