import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  CloudOff,
  Copy,
  Database,
  Download,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { formatScore2 } from '../../calculations/metrics';
import type { SessionRecord, SyncStatus } from '../../types/domain';
import { formatISODateToDDMMYYYY } from '../../utils/temporal';
import { GlassModal } from './GlassModal';

interface SubmissionSuccessModalProps {
  open: boolean;
  isEditing: boolean;
  isSuperAdmin?: boolean;
  isSupabaseMode?: boolean;
  session: SessionRecord | null;
  syncStatus: SyncStatus;
  spreadsheetName?: string;
  spreadsheetUrl?: string;
  warnings: string[];
  schoolUdiseConflict?: string;
  onClose: () => void;
  onStartNewSession: () => void;
  onViewInMyClasses: () => void;
  onOpenSyncStatus?: () => void;
  onDownloadTransferFile?: () => Promise<void> | void;
  downloadingTransfer?: boolean;
}

export const SubmissionSuccessModal: React.FC<SubmissionSuccessModalProps> = ({
  open,
  isEditing,
  isSuperAdmin = false,
  isSupabaseMode = false,
  session,
  syncStatus,
  spreadsheetName,
  spreadsheetUrl,
  warnings,
  schoolUdiseConflict,
  onClose,
  onStartNewSession,
  onViewInMyClasses,
  onOpenSyncStatus,
  onDownloadTransferFile,
  downloadingTransfer = false,
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
      subtitle={
        isSupabaseMode
          ? isSuperAdmin
            ? 'All weighted averages, Session ID sequences, and class breakdown rows are permanently saved in Supabase PostgreSQL.'
            : 'All weighted averages, Session ID sequences, and class breakdown rows have been finalized.'
          : isSuperAdmin && syncStatus === 'SYNCED'
            ? 'All weighted averages, Session ID sequences, and class breakdown rows have been saved live into your Google Sheet.'
            : 'All weighted averages, Session ID sequences, and class breakdown rows have been finalized.'
      }
      headerBadge={
        isSupabaseMode ? (
          syncStatus === 'PENDING_RETRY' || syncStatus === 'FAILED' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFBEB] border border-[#B45309]/40 text-[#92400E]">
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Queued offline · Retry pending
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
              <Database className="w-3 h-3" aria-hidden="true" />
              {syncStatus === 'SYNCED'
                ? isSuperAdmin
                  ? 'Saved in Supabase + Sheets'
                  : 'Saved to Central Database'
                : isSuperAdmin
                  ? 'Saved in Supabase PostgreSQL'
                  : 'Saved to Central Database'}
            </span>
          )
        ) : syncStatus === 'SYNCED' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
            <Database className="w-3 h-3" aria-hidden="true" />
            {isSuperAdmin ? 'Synced to Google Sheets' : 'Synced to Central Database'}
          </span>
        ) : syncStatus === 'PENDING_RETRY' || syncStatus === 'FAILED' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFBEB] border border-[#B45309]/40 text-[#92400E]">
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Queued offline · Retry pending
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F5F2E9] border border-[#C7BEA7] text-[#243647]">
            <CloudOff className="w-3 h-3" aria-hidden="true" />
            {isSuperAdmin
              ? 'Saved locally · not synced to Google Sheets'
              : 'Saved on this device'}
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
          <div className="p-4 rounded-xl bg-[#ECFDF5] border border-[#047857]/35 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <CheckCircle2
                className="w-5 h-5 text-[#047857] shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-[#047857] font-medium">
                  Generated Session ID
                </div>
                <div className="font-mono text-sm sm:text-base font-semibold text-[#0A1B2C] break-all mt-0.5">
                  {session.sessionId}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyId()}
              aria-label="Copy Session ID"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FFFFFF] hover:bg-[#F5F2E9] border border-[#8E8674] text-xs font-medium text-[#0A1B2C] cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
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
            <div className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
              <div className="text-[#243647]">School</div>
              <div className="text-[#0A1B2C] font-medium mt-0.5">{session.schoolName}</div>
            </div>
            <div className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
              <div className="text-[#243647]">Date & Attendance</div>
              <div className="text-[#0A1B2C] font-medium ct-num mt-0.5">
                {formatISODateToDDMMYYYY(session.startDate)} · {session.totalStudentsPresent}{' '}
                students
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#E8F6FF] border border-[#0284C7]/45 col-span-2 sm:col-span-1">
              <div className="text-[#006BB8] font-medium">CSAT / ITP / NPS</div>
              <div className="text-[#0A1B2C] font-semibold ct-num mt-0.5">
                {formatScore2(session.overallCsat)} / {formatScore2(session.overallItp)} /{' '}
                {session.teacherNps > 0 ? `+${session.teacherNps}` : session.teacherNps}
              </div>
            </div>
          </div>

          {isSuperAdmin && syncStatus === 'SYNCED' && (spreadsheetName || spreadsheetUrl) && (
            <div className="p-3 rounded-lg bg-[#ECFDF5]/70 border border-[#047857]/30 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0A1B2C]">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Database className="w-3.5 h-3.5 text-[#047857] shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Destination: Google Sheet{' '}
                  <strong>{spreadsheetName || 'Connected Spreadsheet'}</strong>
                </span>
              </span>
              {spreadsheetUrl && (
                <a
                  href={spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#047857] hover:underline shrink-0"
                >
                  <span>Open in Google Sheets</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          )}

          {schoolUdiseConflict && (
            <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#B45309]/40 text-xs text-[#92400E]">
              {schoolUdiseConflict}
            </div>
          )}

          {!isSuperAdmin && syncStatus !== 'SYNCED' && onDownloadTransferFile && (
            <div className="p-3.5 rounded-xl bg-[#FFFBEB] border border-[#B45309]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#0A1B2C]">
              <div>
                <p className="font-medium text-[#92400E]">
                  Share this submission with your Programme Administrator
                </p>
                <p className="text-[#243647] mt-0.5 leading-relaxed">
                  Your device is not linked to the Central Programme Database yet. Download a verified
                  Transfer File (.json) and send it to an Administrator to merge your records safely.
                </p>
              </div>
              <button
                type="button"
                disabled={downloadingTransfer}
                onClick={() => void onDownloadTransferFile()}
                className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1.5 shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
                {downloadingTransfer ? 'Preparing...' : 'Download Transfer File (.json)'}
              </button>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] text-xs text-[#243647] space-y-1">
              <div className="font-medium text-[#0A1B2C]">Recorded notices:</div>
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
