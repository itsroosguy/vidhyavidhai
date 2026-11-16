import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatPct1, formatScore2 } from '../../calculations/metrics';
import type {
  AppConfiguration,
  SessionFormValues,
  SessionMetricsSummary,
  ValidationIssue,
} from '../../types/domain';
import { resolveConfiguredVideoId } from '../../utils/sessionId';
import {
  calculateSessionDurationMinutes,
  formatDurationHuman,
  formatISODateToDDMMYYYY,
  formatTime24To12,
  getMonthNameFromISO,
} from '../../utils/temporal';
import { GlassModal } from './GlassModal';

interface ReviewSubmissionModalProps {
  open: boolean;
  isEditing: boolean;
  isSubmitting: boolean;
  values: SessionFormValues;
  metrics: SessionMetricsSummary;
  warnings: ValidationIssue[];
  config: AppConfiguration;
  onBackToEdit: () => void;
  onConfirmSubmit: () => void;
}

export const ReviewSubmissionModal: React.FC<ReviewSubmissionModalProps> = ({
  open,
  isEditing,
  isSubmitting,
  values,
  metrics,
  warnings,
  config,
  onBackToEdit,
  onConfirmSubmit,
}) => {
  const tour = config.tours.find((t) => t.tourId === values.tourId);
  const videoInfo = resolveConfiguredVideoId(tour, values.language, config);
  const durationMins = calculateSessionDurationMinutes(
    values.startDate,
    values.startTime,
    values.endDate,
    values.endTime,
    config.programmeTimezone,
  );
  const monthName = getMonthNameFromISO(values.startDate) || '—';

  return (
    <GlassModal
      open={open}
      onClose={onBackToEdit}
      size="lg"
      eyebrow={isEditing ? 'Pre-Update Review' : 'Pre-Submission Verification'}
      title={isEditing ? 'Review before updating session' : 'Review before submitting session'}
      subtitle="Verify attendance counts, student scores, and school details prior to generating the locked record."
      disableLightDismiss={isSubmitting}
      footer={
        <>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onBackToEdit}
            className="ct-btn-secondary text-sm"
          >
            Back to edit
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirmSubmit}
            className="ct-btn-primary text-sm"
          >
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            {isSubmitting
              ? 'Submitting...'
              : isEditing
                ? 'Confirm & update session'
                : 'Confirm & submit'}
          </button>
        </>
      }
    >
      {/* Headline Metric Verification Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#243647]">
            Students Present
          </div>
          <div className="text-xl font-semibold text-[#0A1B2C] ct-num mt-1">
            {metrics.totalStudentsPresent}
          </div>
          <div className="text-[11px] text-[#243647] mt-0.5 ct-num">
            {metrics.totalClasses} {metrics.totalClasses === 1 ? 'class' : 'classes'}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-[#E8F6FF] border border-[#0284C7]/45">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#006BB8]">
            Pooled CSAT (Q-A)
          </div>
          <div className="text-xl font-semibold text-[#0A1B2C] ct-num mt-1">
            {formatScore2(metrics.overallCsat)}
          </div>
          <div className="text-[11px] text-[#243647] mt-0.5 ct-num">
            Pos {formatPct1(metrics.questionASentiment.positivePct)} · Miss{' '}
            {metrics.totalQuestionAMissing}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#243647]">
            Pooled ITP (Q-B)
          </div>
          <div className="text-xl font-semibold text-[#0A1B2C] ct-num mt-1">
            {formatScore2(metrics.overallItp)}
          </div>
          <div className="text-[11px] text-[#243647] mt-0.5 ct-num">
            Pos {formatPct1(metrics.questionBSentiment.positivePct)} · Miss{' '}
            {metrics.totalQuestionBMissing}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#243647]">
            Teacher NPS
          </div>
          <div className="text-xl font-semibold text-[#0A1B2C] ct-num mt-1">
            {metrics.teacherNps !== null
              ? metrics.teacherNps > 0
                ? '+100'
                : String(metrics.teacherNps)
              : '—'}
          </div>
          <div className="text-[11px] text-[#243647] mt-0.5">
            {metrics.teacherClassification ?? 'Not entered'}
            {metrics.teacherScoreExact !== null ? ` (${metrics.teacherScoreExact}/10)` : ''}
          </div>
        </div>
      </div>

      {/* Session & School Metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs sm:text-sm">
        <div>
          <span className="text-[#243647]">Facilitator:</span>{' '}
          <span className="font-medium text-[#0A1B2C]">{values.facilitatorName}</span>
        </div>
        <div>
          <span className="text-[#243647]">Tour / Language:</span>{' '}
          <span className="font-medium text-[#0A1B2C]">
            {tour?.tourName ?? values.tourId} · {values.language}
          </span>
        </div>
        <div>
          <span className="text-[#243647]">School:</span>{' '}
          <span className="font-medium text-[#0A1B2C]">{values.schoolName}</span>
        </div>
        <div>
          <span className="text-[#243647]">UDISE / PIN:</span>{' '}
          <span className="font-mono font-medium text-[#0A1B2C]">
            {values.udiseCode} / {values.pinCode}
          </span>
        </div>
        <div>
          <span className="text-[#243647]">District:</span>{' '}
          <span className="font-medium text-[#0A1B2C]">
            {values.district}
          </span>
        </div>
        <div>
          <span className="text-[#243647]">Schedule ({monthName}):</span>{' '}
          <span className="font-medium text-[#0A1B2C] ct-num">
            {formatISODateToDDMMYYYY(values.startDate)} ({formatTime24To12(values.startTime)} →{' '}
            {formatTime24To12(values.endTime)}) · {formatDurationHuman(durationMins)}
          </span>
        </div>
        <div className="sm:col-span-2 text-xs text-[#243647]">
          Video ID:{' '}
          <span className="font-mono text-[#0A1B2C]">
            {videoInfo.isConfigured ? videoInfo.videoId : 'UNCONFIGURED_VIDEO_ID'}
          </span>
        </div>
      </div>

      {/* Per-Class Summary Table */}
      <div className="ct-table-wrapper rounded-xl border border-[#DFD7C2]">
        <table className="w-full text-left text-xs border-collapse min-w-[540px]">
          <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
            <tr>
              <th scope="col" className="p-2.5 font-medium">Class</th>
              <th scope="col" className="p-2.5 font-medium">Present</th>
              <th scope="col" className="p-2.5 font-medium">Q-A Resp / Miss</th>
              <th scope="col" className="p-2.5 font-medium">CSAT</th>
              <th scope="col" className="p-2.5 font-medium">Q-B Resp / Miss</th>
              <th scope="col" className="p-2.5 font-medium">ITP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DFD7C2]">
            {metrics.classBreakdown.map((c) => (
              <tr key={c.rowId} className="bg-[#FFFFFF] ct-num">
                <td className="p-2.5 font-medium text-[#0A1B2C]">
                  Grade {c.grade} · {c.section}
                </td>
                <td className="p-2.5 text-[#0A1B2C]">{c.studentsPresent}</td>
                <td className="p-2.5 text-[#243647]">
                  <span className="text-[#0A1B2C]">{c.questionATotal}</span> /{' '}
                  {c.questionAMissingResponses}
                </td>
                <td className="p-2.5 font-medium text-[#006BB8]">{formatScore2(c.csatAverage)}</td>
                <td className="p-2.5 text-[#243647]">
                  <span className="text-[#0A1B2C]">{c.questionBTotal}</span> /{' '}
                  {c.questionBMissingResponses}
                </td>
                <td className="p-2.5 font-medium text-[#0A1B2C]">{formatScore2(c.itpAverage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Non-blocking Warnings */}
      {warnings.length > 0 && (
        <div className="p-3.5 rounded-lg bg-[#FFFBEB] border border-[#B45309]/40 text-xs text-[#78350F] space-y-1">
          <div className="font-medium flex items-center gap-1.5 text-[#B45309]">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            Non-blocking quality reminders ({warnings.length})
          </div>
          <ul className="list-disc pl-5 space-y-0.5">
            {warnings.map((w, idx) => (
              <li key={`${w.code}-${idx}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </GlassModal>
  );
};
