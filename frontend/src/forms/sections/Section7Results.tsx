import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  Hash,
  RotateCcw,
  Smile,
  Sparkles,
} from 'lucide-react';
import { buildCalculationWorking, formatPct1, formatScore2 } from '../../calculations/metrics';
import type {
  AppConfiguration,
  SessionFormValues,
  SessionMetricsSummary,
  SessionRecord,
  SyncStatus,
  ValidationResult,
} from '../../types/domain';
import { buildSessionIdPrefix, resolveConfiguredVideoId } from '../../utils/sessionId';
import {
  calculateSessionDurationMinutes,
  formatDurationHuman,
  formatISODateToDDMMYYYY,
  getMonthNameFromISO,
  getTodayKolkataISO,
} from '../../utils/temporal';

interface Section7Props {
  values: SessionFormValues;
  metrics: SessionMetricsSummary;
  validation: ValidationResult;
  config: AppConfiguration;
  isSuperAdmin?: boolean;
  hasAttemptedSubmit: boolean;
  isSubmitting: boolean;
  isEditing: boolean;
  editingSessionId: string | null;
  savedResult: {
    session: SessionRecord;
    warnings: string[];
    schoolUdiseConflict?: string;
    syncStatus?: SyncStatus;
  } | null;
  onSave: () => void;
  onRequestClear: () => void;
  onStartNewSession: () => void;
  onViewSavedInMyClasses: () => void;
  onOpenSyncStatus?: () => void;
  onCancelModal?: () => void;
}

export const Section7Results: React.FC<Section7Props> = ({
  values,
  metrics,
  validation,
  config,
  isSuperAdmin = false,
  hasAttemptedSubmit,
  isSubmitting,
  isEditing,
  editingSessionId,
  savedResult,
  onSave,
  onRequestClear,
  onStartNewSession,
  onViewSavedInMyClasses,
  onOpenSyncStatus,
  onCancelModal,
}) => {
  const [showAutoFilled, setShowAutoFilled] = useState(true);
  const [showWorking, setShowWorking] = useState(false);

  const selectedTour = config.tours.find((t) => t.tourId === values.tourId);
  const videoInfo = resolveConfiguredVideoId(selectedTour, values.language, config);
  const durationMins = calculateSessionDurationMinutes(
    values.startDate,
    values.startTime,
    values.endDate,
    values.endTime,
    config.programmeTimezone,
  );

  const monthName = getMonthNameFromISO(values.startDate) || '—';
  const todayFormatted = formatISODateToDDMMYYYY(getTodayKolkataISO(config.programmeTimezone));
  const sessionIdPrefix = buildSessionIdPrefix(
    values.startDate,
    values.udiseCode,
    values.sessionMode,
    values.classes,
  );
  const working = buildCalculationWorking(metrics);

  const expectedResponses = metrics.totalStudentsPresent * 2;
  const actualResponses = metrics.totalQuestionAResponses + metrics.totalQuestionBResponses;
  const unansweredResponses = Math.max(0, expectedResponses - actualResponses);

  const csatGaugePct =
    metrics.overallCsat !== null ? Math.min(100, Math.max(0, (metrics.overallCsat / 5) * 100)) : 0;
  const itpGaugePct =
    metrics.overallItp !== null ? Math.min(100, Math.max(0, (metrics.overallItp / 5) * 100)) : 0;

  return (
    <section
      id="section-7"
      tabIndex={-1}
      aria-labelledby="sec7-heading"
      data-complete={validation.valid ? 'true' : 'false'}
      className="ct-form-section p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5">
          <span
            className={`ct-section-icon ${validation.valid ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <Sparkles className="w-4 h-4" />
          </span>
          <div>
            <h2 id="sec7-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#E8EFFC]">
              Your results
            </h2>
            <p className="text-xs sm:text-sm text-[#A4B7D2] mt-0.5">
              These numbers are worked out for you. After you save, view your submission anytime
              under &quot;My classes&quot;.
            </p>
          </div>
        </div>
      </div>

      {/* Primary 3 metric scorecard tiles with live visual fill gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-3.5">
        <div className="rounded-xl p-4 bg-[#4EBBBB]/12 border border-[#4EBBBB]/50 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-wider uppercase text-[#4EBBBB]">
              CSAT AVERAGE (ENJOYED)
            </span>
            <Smile className="w-4 h-4 text-[#4EBBBB]" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-semibold text-[#E8EFFC] ct-num">
            {formatScore2(metrics.overallCsat)}
          </div>
          <div aria-hidden="true" className="mt-2.5 h-1.5 rounded-full bg-[#0C1931] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#4EBBBB] transition-[width] duration-200"
              style={{ width: `${csatGaugePct}%` }}
            />
          </div>
          {metrics.totalQuestionAResponses > 0 && (
            <div className="mt-1.5 text-xs text-[#A4B7D2] ct-num">
              {metrics.totalQuestionAResponses} responses · Pos{' '}
              {formatPct1(metrics.questionASentiment.positivePct)}
            </div>
          )}
        </div>

        <div className="rounded-xl p-4 bg-[#162D55] border border-[#26456F] flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-wider uppercase text-[#A4B7D2]">
              ITP AVERAGE (INTEREST)
            </span>
            <Compass className="w-4 h-4 text-[#4EBBBB]" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-semibold text-[#E8EFFC] ct-num">
            {formatScore2(metrics.overallItp)}
          </div>
          <div aria-hidden="true" className="mt-2.5 h-1.5 rounded-full bg-[#0C1931] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#48B98A] transition-[width] duration-200"
              style={{ width: `${itpGaugePct}%` }}
            />
          </div>
          {metrics.totalQuestionBResponses > 0 && (
            <div className="mt-1.5 text-xs text-[#A4B7D2] ct-num">
              {metrics.totalQuestionBResponses} responses · Pos{' '}
              {formatPct1(metrics.questionBSentiment.positivePct)}
            </div>
          )}
        </div>

        <div className="rounded-xl p-4 bg-[#162D55] border border-[#26456F] flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-wider uppercase text-[#A4B7D2]">
              TEACHER SCORE (NPS)
            </span>
            <Award
              className={`w-4 h-4 ${
                metrics.teacherNps === null
                  ? 'text-[#8294B1]'
                  : metrics.teacherNps > 0
                    ? 'text-[#48B98A]'
                    : metrics.teacherNps === 0
                      ? 'text-[#F2B44D]'
                      : 'text-[#E77B83]'
              }`}
              aria-hidden="true"
            />
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-semibold text-[#E8EFFC] ct-num">
            {metrics.teacherNps !== null
              ? metrics.teacherNps > 0
                ? '+100'
                : String(metrics.teacherNps)
              : '—'}
          </div>
          <div className="mt-2.5 text-xs text-[#A4B7D2] ct-num">
            {metrics.teacherClassification
              ? `${metrics.teacherClassification}${metrics.teacherScoreExact !== null ? ` (${metrics.teacherScoreExact}/10)` : ''}`
              : 'Not entered'}
          </div>
        </div>
      </div>

      {/* Response & attendance tallies strip */}
      {(metrics.totalStudentsPresent > 0 || actualResponses > 0) && (
        <div className="ct-bento-well grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4 p-3.5 text-xs ct-num">
          <div>
            <div className="text-[#8294B1] uppercase text-[10px] font-medium">Students Present</div>
            <div className="text-base font-medium text-[#E8EFFC] mt-0.5">
              {metrics.totalStudentsPresent}
            </div>
          </div>
          <div>
            <div className="text-[#8294B1] uppercase text-[10px] font-medium">Expected Responses</div>
            <div className="text-base font-medium text-[#E8EFFC] mt-0.5">{expectedResponses}</div>
          </div>
          <div>
            <div className="text-[#8294B1] uppercase text-[10px] font-medium">Actual Responses</div>
            <div className="text-base font-medium text-[#E8EFFC] mt-0.5">{actualResponses}</div>
          </div>
          <div>
            <div className="text-[#8294B1] uppercase text-[10px] font-medium">Unanswered</div>
            <div className="text-base font-medium text-[#E8EFFC] mt-0.5">
              {unansweredResponses}
            </div>
          </div>
        </div>
      )}

      {/* Session ID Pass Ticket */}
      <div
        className={`ct-bento-well mb-4 p-4 flex items-center justify-between gap-3 border ${
          savedResult || sessionIdPrefix ? 'border-[#4EBBBB]/55' : 'border-[#26456F]'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div
            aria-hidden="true"
            className="w-9 h-9 rounded-xl bg-[#162D55] border border-[#26456F] flex items-center justify-center text-[#4EBBBB] shrink-0 mt-0.5"
          >
            <Hash className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium tracking-wider uppercase text-[#8294B1]">
              SESSION ID
            </div>
            <div className="mt-0.5 text-sm sm:text-[15px] font-medium font-mono text-[#E8EFFC] break-all ct-num">
              {savedResult
                ? savedResult.session.sessionId
                : isEditing && editingSessionId
                  ? `${editingSessionId} (preserved)`
                  : sessionIdPrefix
                    ? `${sessionIdPrefix}_NNN (sequence assigned on save)`
                    : 'Fill the date, school code and class to see it'}
            </div>
          </div>
        </div>

        {(savedResult || sessionIdPrefix) && (
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#4EBBBB]/12 border border-[#4EBBBB]/45 text-[#4EBBBB] shrink-0">
            {savedResult ? 'Assigned' : 'Preview'}
          </span>
        )}
      </div>

      {/* Also filled in for you */}
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setShowAutoFilled((prev) => !prev)}
          aria-expanded={showAutoFilled}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#E8EFFC] cursor-pointer hover:text-[#4EBBBB] transition-colors"
        >
          {showAutoFilled ? (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          )}
          Also filled in for you (nothing to type)
        </button>

        {showAutoFilled && (
          <dl className="mt-2.5 p-3.5 rounded-xl bg-[#0C1931] border border-[#26456F] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs text-[#A4B7D2] font-mono ct-num">
            <div>Month: {monthName}</div>
            <div>Session length: {formatDurationHuman(durationMins)}</div>
            <div>Feedback from: {config.reportingDefaults.feedbackFrom}</div>
            <div>Data source: {config.reportingDefaults.dataSource}</div>
            <div>Submission date: {todayFormatted}</div>
            <div>Educator ID: {config.reportingDefaults.educatorId} (the guide asks for none)</div>
            <div>
              Video ID:{' '}
              <span className={videoInfo.isConfigured ? 'text-[#4EBBBB]' : 'text-[#F2B44D]'}>
                {videoInfo.videoId || '—'}
              </span>
            </div>
            <div>
              {isSuperAdmin ? 'Rows in the Excel sheet' : 'Class breakdown rows'}:{' '}
              {values.classes.length} (one for each grade and section)
            </div>
            {isSuperAdmin && config.partnerName && (
              <div className="sm:col-span-2">
                School year: {config.schoolYear} · Partner: {config.partnerName}
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Show the working */}
      <div className="mb-5">
        <button
          type="button"
          onClick={() => setShowWorking((prev) => !prev)}
          aria-expanded={showWorking}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#E8EFFC] cursor-pointer hover:text-[#4EBBBB] transition-colors"
        >
          {showWorking ? (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          )}
          Show the working
        </button>

        {showWorking && (
          <div className="mt-2 p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F] text-xs text-[#A4B7D2] space-y-1.5 font-mono ct-num">
            <p>{working.csatFormula}</p>
            <p>{working.itpFormula}</p>
            <p>{working.teacherFormula}</p>
          </div>
        )}
      </div>

      {/* Validation summary */}
      {hasAttemptedSubmit && validation.errors.length > 0 && (
        <div
          role="alert"
          className="mb-4 p-4 rounded-xl bg-[#E77B83]/10 border border-[#E77B83]/45 text-xs sm:text-sm text-[#E77B83]"
        >
          <div className="font-medium flex items-center gap-2 mb-1.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#E77B83]" aria-hidden="true" />
            <span>
              {validation.errors.length} required{' '}
              {validation.errors.length === 1 ? 'issue' : 'issues'} must be fixed before saving:
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-1">
            {validation.errors.map((err, idx) => (
              <li key={`${err.code}-${idx}`}>
                <a href={`#section-${err.section}`} className="underline hover:text-[#E8EFFC]">
                  Section {err.section}:
                </a>{' '}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div
          role="region"
          aria-label="Review warnings"
          className="mb-4 p-4 rounded-xl bg-[#392A11] border border-[#F2B44D]/45 text-xs sm:text-sm text-[#F2B44D]"
        >
          <div className="font-medium flex items-center gap-2 mb-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#F2B44D]" aria-hidden="true" />
            <span>Please double-check before saving (warnings will not block save):</span>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-[#E8EFFC]">
            {validation.warnings.map((w, idx) => (
              <li key={`${w.code}-${idx}`}>
                Section {w.section}: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Post-save confirmation panel */}
      {savedResult && (
        <div
          role="status"
          className="mb-5 p-4 rounded-xl bg-[#48B98A]/10 border border-[#48B98A]/45 text-[#E8EFFC] flex flex-col gap-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-[#48B98A]" aria-hidden="true" />
            <div>
              <h3 className="text-base font-medium">
                {isEditing ? 'Session updated successfully!' : 'Session saved successfully!'}
              </h3>
              <p className="text-xs sm:text-sm mt-1 text-[#A4B7D2]">
                Generated Session ID:{' '}
                <strong className="font-mono font-medium text-[#4EBBBB]">
                  {savedResult.session.sessionId}
                </strong>
                {savedResult.syncStatus && (
                  <span className="ml-2 text-xs text-[#A4B7D2]">
                    (
                    {savedResult.syncStatus === 'SYNCED'
                      ? isSuperAdmin
                        ? 'Synced to Google Sheets'
                        : 'Saved to your records'
                      : savedResult.syncStatus === 'LOCAL_SANDBOX'
                        ? 'Local Sandbox'
                        : savedResult.syncStatus}
                    )
                  </span>
                )}
              </p>
              {savedResult.schoolUdiseConflict && (
                <p className="text-xs mt-1.5 text-[#F2B44D]">{savedResult.schoolUdiseConflict}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={onStartNewSession}
              className="ct-btn-primary text-sm"
            >
              Start a new session
            </button>
            <button
              type="button"
              onClick={onViewSavedInMyClasses}
              className="ct-btn-secondary text-sm"
            >
              View in My classes
            </button>
            {isSuperAdmin && onOpenSyncStatus && (
              <button
                type="button"
                onClick={onOpenSyncStatus}
                className="ct-btn-secondary text-sm"
              >
                Sync status
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="pt-4 border-t border-[#26456F]/65 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isSubmitting || Boolean(savedResult && !isEditing)}
          onClick={onSave}
          className="ct-btn-primary rounded-full"
        >
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          {isSubmitting
            ? 'Saving...'
            : isEditing
              ? 'Save updated session'
              : savedResult
                ? 'Saved'
                : 'Save this class'}
        </button>

        <button
          type="button"
          disabled={isSubmitting}
          onClick={onRequestClear}
          className="ct-btn-secondary rounded-full"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Clear the class details
        </button>

        {onCancelModal && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancelModal}
            className="ct-btn-secondary rounded-full"
          >
            Close
          </button>
        )}
      </div>
    </section>
  );
};
