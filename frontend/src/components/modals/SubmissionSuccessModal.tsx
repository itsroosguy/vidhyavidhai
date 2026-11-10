import React, { useState } from 'react';
import { Check, CheckCircle2, CloudOff, Copy, Database, RefreshCw } from 'lucide-react';
import { formatScore2 } from '../../calculations/metrics';
import type { SessionRecord, SyncStatus } from '../../types/domain';
import { formatISODateToDDMMYYYY } from '../../utils/temporal';
import { GlassModal } from './GlassModal';

interface SubmissionSuccessModalProps {
  open: boolean;
  isEditing: boolean;
  isSuperAdmin?: boolean;
  session: SessionRecord | null;
  syncStatus: SyncStatus;
  warnings: string[];
  schoolUdiseConflict?: string;
  onClose: () => void;
  onStartNewSession: () => void;
  onViewInMyClasses: () => void;
  onOpenSyncStatus?: () => void;
}

export const SubmissionSuccessModal: React.FC<SubmissionSuccessModalProps> = ({
  open,
  isEditing,
  isSuperAdmin = false,
  session,
  syncStatus,
  warnings,
  schoolUdiseConflict,
  onClose,
  onStartNewSession,
  onViewInMyClasses,
  onOpenSyncStatus,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyId = async () => {
    if (!session?.sessionId) return;
    try {
      await navigator.clipboard.writeText(session.sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  return (
    <GlassModal
      open={open && Boolean(session)}
      onClose={onClose}
      size="md"
      eyebrow={isEditing ? 'Record Updated' : 'Submission Committed'}
      title={isEditing ? 'Session updated successfully!' : 'Session saved successfully!'}
      subtitle="All weighted averages, Session ID sequences, and class breakdown rows have been finalized."
      headerBadge={
        syncStatus === 'SYNCED' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#48B98A]/15 border border-[#48B98A]/40 text-[#48B98A]">
            <Database className="w-3 h-3" aria-hidden="true" />
            {isSuperAdmin ? 'Synced to Google Sheets' : 'Saved to records'}
          </span>
        ) : syncStatus === 'PENDING_RETRY' || syncStatus === 'FAILED' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#392A11] border border-[#F2B44D]/45 text-[#F2B44D]">
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Queued offline · Retry pending
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#162D55] border border-[#26456F] text-[#A4B7D2]">
            <CloudOff className="w-3 h-3" aria-hidden="true" />
            {isSuperAdmin ? 'Local Sandbox (not live Google Sheets)' : 'Saved in Local Sandbox'}
          </span>
        )
      }
      footer={
        <>
          {isSuperAdmin && onOpenSyncStatus && (
            <button type="button" onClick={onOpenSyncStatus} className="ct-btn-secondary text-sm">
              Sync status
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onViewInMyClasses();
            }}
            className="ct-btn-secondary text-sm"
          >
            View in My classes
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onStartNewSession();
            }}
            className="ct-btn-primary text-sm"
          >
            Start a new session
          </button>
        </>
      }
    >
      {session && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#48B98A]/12 border border-[#48B98A]/40 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <CheckCircle2
                className="w-5 h-5 text-[#48B98A] shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-[#48B98A] font-medium">
                  Generated Session ID
                </div>
                <div className="font-mono text-sm sm:text-base font-semibold text-[#E8EFFC] break-all mt-0.5">
                  {session.sessionId}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyId()}
              aria-label="Copy Session ID"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#162D55] hover:bg-[#172B4D] border border-[#26456F] text-xs font-medium text-[#E8EFFC] cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#48B98A]" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  Copy ID
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-[#0C1931] border border-[#26456F]">
              <div className="text-[#A4B7D2]">School</div>
              <div className="text-[#E8EFFC] font-medium mt-0.5">{session.schoolName}</div>
            </div>
            <div className="p-3 rounded-lg bg-[#0C1931] border border-[#26456F]">
              <div className="text-[#A4B7D2]">Date & Attendance</div>
              <div className="text-[#E8EFFC] font-medium ct-num mt-0.5">
                {formatISODateToDDMMYYYY(session.startDate)} · {session.totalStudentsPresent}{' '}
                students
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#0C1931] border border-[#26456F] col-span-2 sm:col-span-1">
              <div className="text-[#A4B7D2]">CSAT / ITP / NPS</div>
              <div className="text-[#4EBBBB] font-semibold ct-num mt-0.5">
                {formatScore2(session.overallCsat)} / {formatScore2(session.overallItp)} /{' '}
                {session.teacherNps > 0 ? `+${session.teacherNps}` : session.teacherNps}
              </div>
            </div>
          </div>

          {schoolUdiseConflict && (
            <div className="p-3 rounded-lg bg-[#392A11] border border-[#F2B44D]/45 text-xs text-[#F2B44D]">
              {schoolUdiseConflict}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="p-3 rounded-lg bg-[#0C1931] border border-[#26456F] text-xs text-[#A4B7D2] space-y-1">
              <div className="font-medium text-[#E8EFFC]">Recorded notices:</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </GlassModal>
  );
};
