import React, { useId } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import type { GoogleSheetsConnectionState } from '../types/domain';

interface GoogleSheetsBannerProps {
  connection: GoogleSheetsConnectionState | null;
  loading?: boolean;
  userEmail: string;
  onConnectClick: () => void;
  onManageClick: () => void;
}

/**
 * Official Google Sheets document icon rendered inline with zero external network fetches.
 */
export const GoogleSheetsIcon: React.FC<{
  className?: string;
  variant?: 'default' | 'inverted';
}> = ({ className = 'w-5 h-5', variant = 'default' }) => {
  const isInverted = variant === 'inverted';
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M14.5 2H6.5C5.67 2 5 2.67 5 3.5V20.5C5 21.33 5.67 22 6.5 22H17.5C18.33 22 19 21.33 19 20.5V6.5L14.5 2Z"
        fill={isInverted ? '#FFFFFF' : '#0F9D58'}
      />
      <path d="M14.5 2V6.5H19L14.5 2Z" fill={isInverted ? '#D2E3FC' : '#0B8043'} />
      <path
        d="M8.5 11.25H15.5V17.75H8.5V11.25ZM9.75 12.5V13.85H11.45V12.5H9.75ZM12.55 12.5V13.85H14.25V12.5H12.55ZM9.75 15V16.5H11.45V15H9.75ZM12.55 15V16.5H14.25V15H12.55Z"
        fill={isInverted ? '#137333' : '#FFFFFF'}
      />
    </svg>
  );
};

export const GoogleSheetsBanner: React.FC<GoogleSheetsBannerProps> = ({
  connection,
  loading = false,
  userEmail,
  onConnectClick,
  onManageClick,
}) => {
  const headingId = useId();
  const isConnected = Boolean(connection?.connected && connection?.spreadsheetId);

  if (isConnected && connection) {
    const accountLabel = connection.connectedAccount || userEmail;
    const sheetTitle = connection.spreadsheetName || 'Connected Google Sheet';

    return (
      <section
        role="region"
        aria-labelledby={headingId}
        className="mb-5 p-4 sm:px-5 sm:py-4 rounded-xl bg-[#FFFFFF] border border-[#137333]/30 shadow-[0_6px_22px_rgba(10,27,44,0.05),0_1px_2px_rgba(19,115,51,0.08)] text-[#0A1B2C]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-lg bg-[#E6F4EA] border border-[#137333]/20 inline-flex items-center justify-center shrink-0">
              <GoogleSheetsIcon className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full bg-[#188038] shrink-0"
                />
                <CheckCircle2
                  className="w-4 h-4 text-[#137333] shrink-0"
                  aria-hidden="true"
                />
                <h2
                  id={headingId}
                  className="text-sm sm:text-base font-medium text-[#0A1B2C] leading-snug"
                >
                  Google Sheets Connected
                </h2>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-[#243647]">
                <span className="truncate max-w-full">
                  Google account:{' '}
                  <span className="font-medium text-[#0A1B2C]">{accountLabel}</span>
                </span>
                <span aria-hidden="true" className="text-[#8E8674] hidden sm:inline">
                  ·
                </span>
                <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                  <span className="shrink-0">Spreadsheet:</span>
                  {connection.spreadsheetUrl ? (
                    <a
                      href={connection.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[#137333] hover:text-[#0D652D] underline underline-offset-2 truncate max-w-[230px] sm:max-w-[360px]"
                    >
                      <span className="truncate">{sheetTitle}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="font-medium text-[#0A1B2C] truncate">{sheetTitle}</span>
                  )}
                </span>
              </div>

              {connection.lastSyncStatus === 'FAILED' && connection.lastSyncMessage && (
                <p
                  role="alert"
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[#BE123C]"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{connection.lastSyncMessage}</span>
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onManageClick}
            className="ct-btn-secondary w-full sm:w-auto text-xs sm:text-sm min-h-[44px] sm:min-h-[42px] px-4 py-1.5 border-[#137333]/35 hover:border-[#137333] text-[#0A1B2C] shrink-0"
          >
            Manage Connection
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="mb-5 p-4 sm:px-5 sm:py-4 rounded-xl bg-[#FFFFFF] border border-[#137333]/25 shadow-[0_6px_22px_rgba(10,27,44,0.05),0_1px_2px_rgba(19,115,51,0.06)] text-[#0A1B2C]"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg bg-[#E6F4EA] border border-[#137333]/20 inline-flex items-center justify-center shrink-0">
            <GoogleSheetsIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id={headingId}
              className="text-sm sm:text-base font-medium text-[#0A1B2C] leading-snug"
            >
              Connect Your Google Sheet
            </h2>
            <p className="text-xs sm:text-sm text-[#243647] mt-0.5 leading-relaxed">
              Connect your Google Sheet to securely store, manage and access all programme data in
              one place.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onConnectClick}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] active:scale-[0.985] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] transition-all cursor-pointer shrink-0 disabled:opacity-55 disabled:cursor-not-allowed"
        >
          <GoogleSheetsIcon className="w-4 h-4 shrink-0" variant="inverted" />
          <span>{loading ? 'Checking…' : 'Connect Google Sheets'}</span>
        </button>
      </div>
    </section>
  );
};
