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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <Users className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec4-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0A1B2C]">
                About the class
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#243647] mt-0.5">
              Single grade or combined classroom roster and total attendance count
            </p>
          </div>
        </div>

        <span className="self-start shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-[#F5F2E9] border border-[#C7BEA7] text-[#0A1B2C] ct-num whitespace-nowrap">
          <GraduationCap className="w-3.5 h-3.5 text-[#006BB8] shrink-0" aria-hidden="true" />
          {sessionMode === 'combined'
            ? `Combined · ${classes.length} groups`
            : 'Single class'}
          {metrics.totalStudentsPresent > 0 ? ` · ${metrics.totalStudentsPresent} students` : ''}
        </span>
      </div>

      {/* Single vs Combined selector + quick visual pills */}
      <div className="ct-bento-well p-4 flex flex-col gap-2.5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="sessionMode" className="text-sm font-medium text-[#0A1B2C]">
            Did you take this session for more than one section or grade together?
          </label>
          <div className="inline-flex rounded-full bg-[#FFFFFF] border border-[#8E8674] p-0.5 gap-1">
            <button
              type="button"
              onClick={() => onChangeMode('single')}
              aria-pressed={sessionMode === 'single'}
              className={`ct-interactive-tile px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                sessionMode === 'single'
                  ? 'bg-[#1EA7FF] text-[#0A1B2C]'
                  : 'text-[#243647] hover:text-[#0A1B2C]'
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
                  ? 'bg-[#1EA7FF] text-[#0A1B2C]'
                  : 'text-[#243647] hover:text-[#0A1B2C]'
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
        <p id="sessionMode-hint" className="text-xs text-[#33475B]">
          For example 8A and 8B together, or grade 8 and grade 9 together.
        </p>
      </div>

      {errorMap.classes && (
        <p role="alert" className="mb-3 text-xs text-[#BE123C] font-medium">
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
                  ? 'p-4 rounded-xl bg-[#F5F2E9] border border-[#C7BEA7]'
                  : 'ct-bento-well p-4'
              }
            >
              {sessionMode === 'combined' && (
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <span className="text-sm font-medium text-[#006BB8] ct-num">
                    Class {idx + 1} of {classes.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onClearClassRow(idx)}
                      className="ct-interactive-tile inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#FFFFFF] hover:bg-[#EFE8D6] border border-[#8E8674] text-[#0A1B2C] cursor-pointer transition-colors"
                    >
                      <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                      Clear row
                    </button>
                    {classes.length > 2 && (
                      <button
                        type="button"
                        onClick={() => onRemoveClassRow(idx)}
                        aria-label={`Remove class ${idx + 1}`}
                        className="ct-interactive-tile inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#FFF1F2] hover:bg-[#BE123C]/15 border border-[#BE123C]/35 text-[#BE123C] cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="ct-field-grid-3">
                {/* Grade */}
                <div className="ct-field-col">
                  <div className="ct-field-label">
                    <label htmlFor={`class-grade-${idx}`} className="text-sm font-medium text-[#0A1B2C]">
                      Which class (grade) is{' '}
                      <span className="whitespace-nowrap">
                        it?
                        <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                          *
                        </span>
                      </span>
                    </label>
                  </div>
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
                  <div className="ct-field-meta">
                    {gradeErr && (
                      <p id={`class-grade-${idx}-error`} className="text-xs text-[#BE123C] font-medium">
                        {gradeErr}
                      </p>
                    )}
                  </div>
                </div>

                {/* Section */}
                <div className="ct-field-col">
                  <div className="ct-field-label">
                    <label htmlFor={`class-section-${idx}`} className="text-sm font-medium text-[#0A1B2C]">
                      <span className="whitespace-nowrap">
                        Section
                        <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                          *
                        </span>
                      </span>
                    </label>
                  </div>
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
                  <div className="ct-field-meta">
                    <p id={`class-section-${idx}-hint`} className="text-xs text-[#33475B]">
                      If the class has no sections, choose "No section".
                    </p>
                    {secErr && (
                      <p id={`class-section-${idx}-error`} className="text-xs text-[#BE123C] font-medium">
                        {secErr}
                      </p>
                    )}
                  </div>
                </div>

                {/* Students present */}
                <div className="ct-field-col">
                  <div className="ct-field-label">
                    <label htmlFor={`class-present-${idx}`} className="text-sm font-medium text-[#0A1B2C]">
                      How many students were{' '}
                      <span className="whitespace-nowrap">
                        present?
                        <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                          *
                        </span>
                      </span>
                    </label>
                  </div>
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
                  <div className="ct-field-meta">
                    {presentErr && (
                      <p id={`class-present-${idx}-error`} className="text-xs text-[#BE123C] font-medium">
                        {presentErr}
                      </p>
                    )}
                  </div>
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
            <span className="text-xs text-[#33475B]">
              Combined sessions allow between 2 and 10 class/grade rows.
            </span>
          </div>

          <div className="ct-bento-well p-3 grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs ct-num">
            <div className="col-span-2 sm:col-span-1 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] px-3 py-2 flex flex-col justify-between gap-1">
              <div className="text-[#243647] inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#006BB8] shrink-0" aria-hidden="true" />
                <span>Combined Classes</span>
              </div>
              <div className="text-base font-semibold text-[#0A1B2C]">{metrics.totalClasses}</div>
            </div>
            <div className="rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] px-3 py-2 flex flex-col justify-between gap-1">
              <div className="text-[#243647]">Total Students</div>
              <div className="text-base font-semibold text-[#0A1B2C]">
                {metrics.totalStudentsPresent}
              </div>
            </div>
            <div className="rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] px-3 py-2 flex flex-col justify-between gap-1">
              <div className="text-[#243647]">Q-A Responses</div>
              <div className="text-base font-semibold text-[#0A1B2C]">
                {metrics.totalQuestionAResponses}
              </div>
            </div>
            <div className="rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] px-3 py-2 flex flex-col justify-between gap-1">
              <div className="text-[#243647]">Pooled CSAT</div>
              <div className="text-base font-semibold text-[#006BB8]">
                {formatScore2(metrics.overallCsat)}
              </div>
            </div>
            <div className="rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] px-3 py-2 flex flex-col justify-between gap-1">
              <div className="text-[#243647]">Pooled ITP</div>
              <div className="text-base font-semibold text-[#0A1B2C]">
                {formatScore2(metrics.overallItp)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
