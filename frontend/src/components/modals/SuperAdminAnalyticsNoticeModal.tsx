import React from 'react';
import { ArrowRight, BarChart3, CheckCircle2, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { GlassModal } from './GlassModal';

interface SuperAdminAnalyticsNoticeModalProps {
  open: boolean;
  onClose: () => void;
  onOpenAnalytics: () => void;
}

/**
 * Dismissible notification dialog shown to Super Administrators upon opening the
 * workspace, reminding them to download Excel reports in Analytics while the
 * Google Sheets auto data feed is being finalized.
 */
export const SuperAdminAnalyticsNoticeModal: React.FC<SuperAdminAnalyticsNoticeModalProps> = ({
  open,
  onClose,
  onOpenAnalytics,
}) => {
  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="sm"
      eyebrow="Super Admin Notice"
      title="Download Excel Reports in Analytics"
      subtitle="Live classroom submissions continue saving safely without interruption."
      headerBadge={
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
          Reports Ready
        </span>
      }
      footer={
        <>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="ct-btn-secondary text-sm"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={onOpenAnalytics}
            className="ct-btn-primary text-sm"
          >
            <BarChart3 className="w-4 h-4" aria-hidden="true" />
            Open Analytics
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      }
    >
      <div className="p-4 rounded-xl bg-[#E8F6FF] border border-[#0284C7]/40 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#FFFFFF] border border-[#0284C7]/35 flex items-center justify-center text-[#006BB8] shrink-0">
          <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="text-xs sm:text-sm text-[#0A1B2C] leading-relaxed">
          <p className="font-medium">Please download your Excel reports from Analytics.</p>
          <p className="text-[#243647] mt-1">
            Go to <span className="font-medium text-[#0A1B2C]">Analytics → Export Filtered (.xlsx)</span>{' '}
            to download clean spreadsheets with formatted start and end times.
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-[#FFFBEB] border border-[#B45309]/35 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#FFFFFF] border border-[#B45309]/30 flex items-center justify-center text-[#B45309] shrink-0">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="text-xs sm:text-sm text-[#0A1B2C] leading-relaxed">
          <p className="font-medium">Google Sheet Auto Data Feed — Live Soon</p>
          <p className="text-[#243647] mt-1">
            We are currently working on the automated Google Sheet data feed and it will be live
            soon. Facilitator entries continue recording safely in the live database.
          </p>
        </div>
      </div>
    </GlassModal>
  );
};
