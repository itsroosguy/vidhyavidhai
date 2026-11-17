import React, { useState } from 'react';
import { ExternalLink, FileSpreadsheet, Maximize2, Minus, X } from 'lucide-react';

interface LiveReportFloatingBadgeProps {
  sheetUrl?: string;
  publishedUrl?: string;
  defaultMinimized?: boolean;
}

export const DEFAULT_REPORT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0';

export const DEFAULT_REPORT_PUBLISHED_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQHD80E_6yBHsUCD1475f79sqZKvomquSbB1Dk0ehO440RPqI3HcdyXqvP4dBbAUXpFCqKNdrGrJi3F/pubhtml';

const STORAGE_KEY = 'career_tours_live_report_badge_dismissed';

/**
 * Cute, non-intrusive floating notification on the bottom-right for Super Administrators,
 * providing direct one-click access to the 63-column Google Sheet live report.
 */
export const LiveReportFloatingBadge: React.FC<LiveReportFloatingBadgeProps> = ({
  sheetUrl = DEFAULT_REPORT_SHEET_URL,
  publishedUrl = DEFAULT_REPORT_PUBLISHED_URL,
  defaultMinimized = false,
}) => {
  const [minimized, setMinimized] = useState(defaultMinimized);
  const [closed, setClosed] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const handleClose = () => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(STORAGE_KEY, '1');
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
    setClosed(true);
  };

  if (closed) return null;

  if (minimized) {
    return (
      <aside
        aria-label="Live Report Link Shortcut"
        className="fixed bottom-4 right-4 z-40 animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <div className="inline-flex items-center gap-1.5 p-1 bg-white/95 backdrop-blur-md rounded-full border border-[#006BB8]/25 shadow-lg hover:shadow-xl transition-all">
          <a
            href={sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 pl-3 pr-2.5 py-1.5 text-xs font-semibold text-[#006BB8] hover:text-[#00528C] transition-colors"
            title="Open 63-column Google Sheet"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
            <span>Click for report link</span>
            <ExternalLink className="w-3 h-3 text-[#006BB8]/70" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="p-1 rounded-full text-[#5F7082] hover:text-[#0A1B2C] hover:bg-black/5 transition-colors"
            title="Expand notification details"
            aria-label="Expand notification details"
          >
            <Maximize2 className="w-3 h-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-full text-[#5F7082] hover:text-[#0A1B2C] hover:bg-black/5 transition-colors"
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Live Google Sheet Report Notification"
      className="fixed bottom-4 right-4 z-40 w-[310px] sm:w-[330px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white/95 backdrop-blur-md border border-[#006BB8]/20 shadow-xl shadow-blue-950/10 p-3.5 flex flex-col gap-2.5 transition-all duration-200 hover:shadow-2xl animate-in fade-in slide-in-from-bottom-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#ECFDF5] text-[#047857] border border-[#047857]/20">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          5-Min Live Sync Active
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="p-1 rounded-lg text-[#5F7082] hover:text-[#0A1B2C] hover:bg-black/5 transition-colors"
            title="Minimize to pill"
            aria-label="Minimize notification"
          >
            <Minus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-lg text-[#5F7082] hover:text-[#0A1B2C] hover:bg-black/5 transition-colors"
            title="Dismiss notification"
            aria-label="Close notification"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-[#E8F6FF] border border-[#006BB8]/25 flex items-center justify-center text-[#006BB8] shrink-0 mt-0.5 shadow-sm">
          <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#0A1B2C] truncate">
            Classroom Data Entry Report
          </p>
          <p className="text-[11px] text-[#5F7082] mt-0.5 leading-snug">
            63-column master sheet mirrors new facilitator entries automatically.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#006BB8] text-white hover:bg-[#00528C] active:bg-[#004070] transition-colors shadow-sm hover:shadow"
        >
          <span>Click for report link</span>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
        <a
          href={publishedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-xl text-xs font-medium text-[#243647] hover:bg-[#F0F7FD] border border-[#006BB8]/15 transition-colors"
          title="Open web preview"
        >
          Web View ↗
        </a>
      </div>
    </aside>
  );
};
