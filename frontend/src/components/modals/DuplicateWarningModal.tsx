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
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#392A11] border border-[#F2B44D]/45 text-[#F2B44D] ct-num">
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
      <div className="p-3.5 rounded-lg bg-[#392A11] border border-[#F2B44D]/45 text-xs sm:text-sm text-[#E8EFFC] flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-[#F2B44D] shrink-0 mt-0.5" aria-hidden="true" />
        <p className="leading-relaxed">
          If you already submitted this session earlier, cancel now and inspect it under{' '}
          <strong className="font-medium text-[#F2B44D]">My classes</strong> to avoid double-counting
          students.
        </p>
      </div>

      <div className="space-y-2.5">
        {candidates.map((c) => (
          <div
            key={c.sessionRecordId}
            className="rounded-xl bg-[#0C1931] border border-[#26456F] p-3.5 text-xs sm:text-sm space-y-1.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-[#4EBBBB] font-medium">{c.sessionId}</span>
              <span className="text-xs text-[#A4B7D2] inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                {formatISODateToDDMMYYYY(c.startDate)} · {formatTime24To12(c.startTime)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[#E8EFFC] font-medium">
              <School className="w-3.5 h-3.5 text-[#A4B7D2]" aria-hidden="true" />
              <span>{c.schoolName}</span>
              <span className="font-mono text-xs text-[#A4B7D2]">({c.udiseCode})</span>
            </div>

            <div className="text-xs text-[#A4B7D2]">
              Tour: <span className="text-[#E8EFFC]">{c.tourName}</span> · Facilitator:{' '}
              <span className="text-[#E8EFFC]">{c.facilitatorName}</span>
            </div>

            {c.overlappingGrades.length > 0 && (
              <div className="text-xs text-[#F2B44D] pt-1">
                Overlapping class entries: {c.overlappingGrades.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassModal>
  );
};
