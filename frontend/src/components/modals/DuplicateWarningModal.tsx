import React from 'react';
import { AlertTriangle, Calendar, School } from 'lucide-react';
import type { DuplicateSessionCandidate } from '../../types/domain';
import { formatISODateToDDMMYYYY, formatTime24To12 } from '../../utils/temporal';
import { GlassModal } from './GlassModal';

interface DuplicateWarningModalProps {
  open: boolean;
  candidates: DuplicateSessionCandidate[];
  onCancel: () => void;
  onProceedAnyway: () => void;
}

export const DuplicateWarningModal: React.FC<DuplicateWarningModalProps> = ({
  open,
  candidates,
  onCancel,
  onProceedAnyway,
}) => {
  return (
    <GlassModal
      open={open}
      onClose={onCancel}
      size="md"
      eyebrow="Duplicate Protection"
      title="Similar classroom submission already exists"
      subtitle="A committed record for this school, date, and Career Tour was found. Confirm whether this is an additional separate session."
      headerBadge={
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFBEB] border border-[#B45309]/40 text-[#92400E] ct-num">
          {candidates.length} {candidates.length === 1 ? 'match' : 'matches'}
        </span>
      }
      footer={
        <>
          <button type="button" onClick={onCancel} autoFocus className="ct-btn-secondary text-sm">
            Go back & review
          </button>
          <button type="button" onClick={onProceedAnyway} className="ct-btn-primary text-sm">
            Proceed to review anyway
          </button>
        </>
      }
    >
      <div className="p-3.5 rounded-lg bg-[#FFFBEB] border border-[#B45309]/40 text-xs sm:text-sm text-[#78350F] flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
        <p className="leading-relaxed">
          If you already submitted this session earlier, cancel now and inspect it under{' '}
          <strong className="font-medium text-[#92400E]">My classes</strong> to avoid double-counting
          students.
        </p>
      </div>

      <div className="space-y-2.5">
        {candidates.map((c) => (
          <div
            key={c.sessionRecordId}
            className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3.5 text-xs sm:text-sm space-y-1.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-[#0F766E] font-medium">{c.sessionId}</span>
              <span className="text-xs text-[#475569] inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                {formatISODateToDDMMYYYY(c.startDate)} · {formatTime24To12(c.startTime)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[#0F172A] font-medium">
              <School className="w-3.5 h-3.5 text-[#475569]" aria-hidden="true" />
              <span>{c.schoolName}</span>
              <span className="font-mono text-xs text-[#475569]">({c.udiseCode})</span>
            </div>

            <div className="text-xs text-[#475569]">
              Tour: <span className="text-[#0F172A]">{c.tourName}</span> · Facilitator:{' '}
              <span className="text-[#0F172A]">{c.facilitatorName}</span>
            </div>

            {c.overlappingGrades.length > 0 && (
              <div className="text-xs text-[#B45309] pt-1">
                Overlapping class entries: {c.overlappingGrades.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassModal>
  );
};
