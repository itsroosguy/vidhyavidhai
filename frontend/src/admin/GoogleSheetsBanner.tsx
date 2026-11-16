import React, { useId } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { loadAppsScriptBridgeConfig } from '../services/authService';
import type { GoogleSheetsConnectionState } from '../types/domain';

interface GoogleSheetsBannerProps {
  connection: GoogleSheetsConnectionState | null;
  loading?: boolean;
  isLiveBackend?: boolean;
  isSupabaseMode?: boolean;
  needsDirectReauth?: boolean;
  authorizing?: boolean;
  userEmail: string;
  onConnectClick: () => void;
  onManageClick: () => void;
  onActivateLiveClick?: () => void;
  onAuthorizeNow?: () => void;
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
  isLiveBackend = false,
  isSupabaseMode = false,
  needsDirectReauth = false,
  authorizing = false,
  userEmail,
  onConnectClick,
  onManageClick,
  onActivateLiveClick,
  onAuthorizeNow,
}) => {
  const headingId = useId();
  const hasSelectedSheet = Boolean(connection?.connected && connection?.spreadsheetId);
  const hasSavedBridge = Boolean(loadAppsScriptBridgeConfig());
  const isLiveVerified = Boolean(
    !needsDirectReauth &&
      hasSelectedSheet &&
      connection &&
      (isSupabaseMode ||
        isLiveBackend ||
        connection.authMethod === 'google_oauth' ||
        (connection.authMethod === 'apps_script' && (isLiveBackend || hasSavedBridge))),
  );

  if (hasSelectedSheet && connection && needsDirectReauth) {
    const accountLabel = connection.connectedAccount || userEmail;
    const sheetTitle = connection.spreadsheetName || 'Linked Google Sheet';

    return (
      <section
        role="region"
        aria-labelledby={headingId}
        className="mb-5 p-4 sm:px-5 sm:py-4 rounded-xl bg-[#FFFFFF] border border-[#B45309]/40 shadow-[0_6px_22px_rgba(10,27,44,0.05)] text-[#0A1B2C]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-lg bg-[#FFFBEB] border border-[#B45309]/25 inline-flex items-center justify-center shrink-0">
              <GoogleSheetsIcon className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0" aria-hidden="true" />
                <h2
                  id={headingId}
                  className="text-sm sm:text-base font-medium text-[#0A1B2C] leading-snug"
                >
                  Re-authorize Google Account (Session Reloaded)
                </h2>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-[#243647]">
                <span className="truncate max-w-full">
                  Account: <span className="font-medium text-[#0A1B2C]">{accountLabel}</span>
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
                      className="inline-flex items-center gap-1 font-medium text-[#006BB8] hover:underline underline-offset-2 truncate max-w-[230px] sm:max-w-[360px]"
                    >
                      <span className="truncate">{sheetTitle}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="font-medium text-[#0A1B2C] truncate">{sheetTitle}</span>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#78350F] leading-relaxed">
                For security, Direct Browser OAuth access tokens remain strictly in browser memory
                and clear when reloaded. Re-authorize once to push pending entries and resume live
                sync.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onAuthorizeNow && (
              <button
                type="button"
                disabled={authorizing}
                onClick={onAuthorizeNow}
                className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer disabled:opacity-55"
              >
                <GoogleSheetsIcon className="w-4 h-4 shrink-0" variant="inverted" />
                <span>{authorizing ? 'Authorizing…' : 'Authorize & Push Pending'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onManageClick}
              className="ct-btn-secondary text-xs sm:text-sm min-h-[42px] px-3.5 py-1.5"
            >
              Manage Connection
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (hasSelectedSheet && connection && isLiveVerified) {
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
                  {isSupabaseMode ? 'Primary DB: Supabase PostgreSQL · Account: ' : 'Google account: '}
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

  if (hasSelectedSheet && connection) {
    const accountLabel = connection.connectedAccount || userEmail;
    const sheetTitle = connection.spreadsheetName || 'Selected Target Spreadsheet';

    return (
      <section
        role="region"
        aria-labelledby={headingId}
        className="mb-5 p-4 sm:px-5 sm:py-4 rounded-xl bg-[#FFFFFF] border border-[#B45309]/35 shadow-[0_6px_22px_rgba(10,27,44,0.05)] text-[#0A1B2C]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-lg bg-[#FFFBEB] border border-[#B45309]/25 inline-flex items-center justify-center shrink-0">
              <GoogleSheetsIcon className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0" aria-hidden="true" />
                <h2
                  id={headingId}
                  className="text-sm sm:text-base font-medium text-[#0A1B2C] leading-snug"
                >
                  Target Sheet Selected (Local Storage)
                </h2>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-[#243647]">
                <span className="truncate max-w-full">
                  Account: <span className="font-medium text-[#0A1B2C]">{accountLabel}</span>
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
                      className="inline-flex items-center gap-1 font-medium text-[#006BB8] hover:underline underline-offset-2 truncate max-w-[230px] sm:max-w-[360px]"
                    >
                      <span className="truncate">{sheetTitle}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="font-medium text-[#0A1B2C] truncate">{sheetTitle}</span>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#78350F] leading-relaxed">
                Saved on this device only — team submissions are not saving online into Google Sheets
                yet. Activate Live Sync to store all data in Google Sheets.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onActivateLiveClick && (
              <button
                type="button"
                onClick={onActivateLiveClick}
                className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer"
              >
                <GoogleSheetsIcon className="w-4 h-4 shrink-0" variant="inverted" />
                <span>Activate Live Sync</span>
              </button>
            )}
            <button
              type="button"
              onClick={onManageClick}
              className="ct-btn-secondary text-xs sm:text-sm min-h-[42px] px-3.5 py-1.5"
            >
              Manage Connection
            </button>
          </div>
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
              {isSupabaseMode
                ? 'Supabase PostgreSQL Active · Optional Google Sheets Mirror'
                : 'Connect Your Google Sheet'}
            </h2>
            <p className="text-xs sm:text-sm text-[#243647] mt-0.5 leading-relaxed">
              {isSupabaseMode
                ? 'All programme records save permanently in Supabase PostgreSQL. Optionally link a Google Sheet and Apps Script Web App webhook to mirror records to Google Sheets.'
                : 'Connect your Google Sheet to securely store, manage and access all programme data in one place.'}
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
