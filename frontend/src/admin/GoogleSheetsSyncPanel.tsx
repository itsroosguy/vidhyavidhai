import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Database,
  ExternalLink,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { LiveBackendSetupCard } from '../components/sheets/LiveBackendSetupCard';
import { DEFAULT_TARGET_SPREADSHEET_URL } from '../config/defaults';
import type { BackendApiClient, BackendHealthInfo } from '../services/apiClient';
import { getAuthEnvironment, loadAppsScriptBridgeConfig } from '../services/authService';
import {
  loadLocalSyncEvents,
  removeSyncOutboxItem,
} from '../services/syncService';
import type {
  GoogleSheetsConnectionState,
  SyncLogEntry,
  SyncOutboxItem,
  UserProfile,
} from '../types/domain';
import { formatISODateToDDMMYYYY } from '../utils/temporal';

interface GoogleSheetsSyncPanelProps {
  api: BackendApiClient;
  user: UserProfile;
  isLiveBackend: boolean;
  needsDirectReauth?: boolean;
  oauthSheetsConnection?: GoogleSheetsConnectionState | null;
  outboxItems: SyncOutboxItem[];
  onRetryItem?: (item: SyncOutboxItem) => Promise<void>;
  onRetryAll?: () => Promise<void>;
  onOutboxChanged?: () => void;
  onOpenSyncModal?: () => void;
  onAuthorizeNow?: () => Promise<void> | void;
  onConnectionChanged?: (next: GoogleSheetsConnectionState) => void;
  onSynced?: () => Promise<void> | void;
  onEnvironmentChanged?: () => void;
  onLiveBackendActivated?: () => void;
  onResetLiveBackend?: () => void;
  onNotify?: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const GoogleSheetsSyncPanel: React.FC<GoogleSheetsSyncPanelProps> = ({
  api,
  user,
  isLiveBackend,
  needsDirectReauth = false,
  oauthSheetsConnection = null,
  outboxItems,
  onRetryItem,
  onRetryAll,
  onOutboxChanged,
  onOpenSyncModal,
  onAuthorizeNow,
  onConnectionChanged,
  onSynced,
  onEnvironmentChanged,
  onLiveBackendActivated,
  onResetLiveBackend,
  onNotify,
}) => {
  const isSupabaseMode = api.mode === 'supabase';
  const authEnv = getAuthEnvironment();
  const hasSavedBridge = Boolean(loadAppsScriptBridgeConfig());
  const isOAuthConnected = Boolean(
    !needsDirectReauth &&
      oauthSheetsConnection?.connected &&
      oauthSheetsConnection.authMethod === 'google_oauth' &&
      oauthSheetsConnection.spreadsheetId,
  );
  const isBridgeConnected = Boolean(
    !needsDirectReauth &&
      oauthSheetsConnection?.connected &&
      oauthSheetsConnection.spreadsheetId &&
      (oauthSheetsConnection.connectionProvider === 'apps_script' ||
        oauthSheetsConnection.authMethod === 'apps_script') &&
      (isLiveBackend || hasSavedBridge),
  );
  const effectiveLive = (isLiveBackend || isOAuthConnected || isBridgeConnected) && !needsDirectReauth;
  const [health, setHealth] = useState<BackendHealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [backendSyncLogs, setBackendSyncLogs] = useState<SyncLogEntry[]>([]);
  const [localEvents, setLocalEvents] = useState<SyncLogEntry[]>([]);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const captionId = useId();

  const refreshSyncStatus = useCallback(async () => {
    setLocalEvents(loadLocalSyncEvents(user.email));
    setCheckingHealth(true);
    setHealthError(null);
    try {
      const [hRes, logRes] = await Promise.all([
        api.pingHealth(),
        api.getSyncLogs(1, 25),
      ]);
      if (hRes.ok && hRes.data) {
        setHealth(hRes.data);
      } else {
        setHealthError(hRes.error || 'Health check failed.');
      }
      if (logRes.ok && logRes.data) {
        setBackendSyncLogs(logRes.data.items);
      }
    } finally {
      setCheckingHealth(false);
    }
  }, [api, user.email]);

  useEffect(() => {
    void refreshSyncStatus();
  }, [refreshSyncStatus]);

  const handleRetrySingle = async (item: SyncOutboxItem) => {
    if (!onRetryItem) return;
    setRetryingKey(item.clientSubmissionKey);
    try {
      await onRetryItem(item);
      await refreshSyncStatus();
    } finally {
      setRetryingKey(null);
    }
  };

  const handleDiscardOutboxItem = (key: string) => {
    removeSyncOutboxItem(user.email, key);
    onOutboxChanged?.();
  };

  const mergedLogs: SyncLogEntry[] = [...backendSyncLogs];
  for (const ev of localEvents) {
    if (!mergedLogs.some((m) => m.syncId === ev.syncId)) {
      mergedLogs.push(ev);
    }
  }
  mergedLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="flex flex-col gap-5">
      {/* Connectivity & Endpoint Status */}
      <section className="ct-card p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-medium text-[#0A1B2C] flex items-center gap-2">
                <Database className="w-5 h-5 text-[#006BB8]" aria-hidden="true" />
                {isSupabaseMode
                  ? 'Google Sheets Webhook Mirror & Sync Status'
                  : 'Google Sheets Online Sync & Storage Setup'}
              </h2>
              <p className="text-xs sm:text-sm text-[#243647] mt-0.5">
                {isSupabaseMode
                  ? 'Supabase PostgreSQL is your primary database. Optionally link a Google Sheet and Apps Script Web App URL to mirror records via Edge Function google-sheets-sync.'
                  : 'Connect your official Google Sheet, verify online sync status, and review queued updates.'}
              </p>
            </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refreshSyncStatus()}
              disabled={checkingHealth}
              className="ct-btn-secondary text-xs min-h-[38px] px-3.5"
            >
              <RefreshCw
                className={`w-4 h-4 ${checkingHealth ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {checkingHealth ? 'Checking...' : 'Check connectivity'}
            </button>
            {onOpenSyncModal && (
              <button
                type="button"
                onClick={onOpenSyncModal}
                className="ct-btn-secondary text-xs min-h-[38px] px-3.5"
              >
                Open Sync Modal
              </button>
            )}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] space-y-2 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-[#0A1B2C] flex items-center gap-2">
              {isSupabaseMode ? (
                oauthSheetsConnection?.connected && oauthSheetsConnection.spreadsheetId ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                    <span>
                      Primary Database: Supabase PostgreSQL Online · Sheets Mirror Linked
                    </span>
                  </>
                ) : (
                  <>
                    <Database className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                    <span>
                      Primary Database: Supabase PostgreSQL Online · Optional Google Sheets Webhook
                    </span>
                  </>
                )
              ) : needsDirectReauth ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                  <span>Direct Google OAuth Session Reloaded — Authorization Needed</span>
                </>
              ) : effectiveLive ? (
                isBridgeConnected && !authEnv.isLiveBackendConfigured ? (
                  (health?.connectedToGoogleSheets ?? !healthError) ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                      <span>Connected to Google Sheets via Apps Script Sync Bridge</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                      <span>Apps Script Sync Bridge check failed</span>
                    </>
                  )
                ) : isOAuthConnected && !authEnv.appsScriptUrl ? (
                  (health?.connectedToGoogleSheets ?? !healthError) ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                      <span>Connected to Google Sheets via Google OAuth 2.0</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                      <span>Google OAuth session requires re-authorization or probe failed</span>
                    </>
                  )
                ) : health?.connectedToGoogleSheets ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                    <span>Connected to Google Sheets Apps Script Web App</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                    <span>Apps Script endpoint configured, health probe failed</span>
                  </>
                )
              ) : (
                <>
                  <CloudOff className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                  <span>Not Connected Online Yet — Saving Locally on This Device</span>
                </>
              )}
            </div>
            {health?.checkedAt && (
              <span className="text-[11px] text-[#243647] ct-num">
                Checked {new Date(health.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <p className="text-xs text-[#243647] leading-relaxed">
            {isSupabaseMode
              ? 'All programme submissions, schools, user approvals, and audit logs already save permanently in Supabase PostgreSQL under Row Level Security. Configure an Apps Script Web App webhook below if you want to mirror rows into Google Sheets.'
              : effectiveLive
                ? isBridgeConnected && !authEnv.isLiveBackendConfigured
                  ? `Form submissions, edits, school directory updates, configuration changes, and logs write live into ${
                      oauthSheetsConnection?.spreadsheetName || 'your connected Google Spreadsheet'
                    } via the Apps Script Sync Bridge while retaining remembered local password sign-in.`
                  : isOAuthConnected && !authEnv.appsScriptUrl
                    ? `Form submissions, edits, school directory updates, and user approvals write live into ${
                        oauthSheetsConnection?.spreadsheetName || 'your connected Google Spreadsheet'
                      } under transactional locks and Google OAuth 2.0.`
                    : 'All sessions write safely to your 10-tab Google Spreadsheet under server concurrency locks and Google Sign-In verification.'
                : 'Changes saved right now stay only in this browser tab. Activate Live Google Sheets Storage below so facilitators save straight into Google Sheets online.'}
          </p>
          {(isOAuthConnected ||
            isBridgeConnected ||
            (isSupabaseMode && Boolean(oauthSheetsConnection?.connected))) &&
            oauthSheetsConnection?.spreadsheetId && (
            <div className="pt-0.5">
              <a
                href={oauthSheetsConnection.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#047857] hover:underline"
              >
                <span>
                  Open {oauthSheetsConnection.spreadsheetName || oauthSheetsConnection.spreadsheetId}
                </span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>
          )}
          {healthError && (
            <div className="p-2.5 rounded-lg bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#BE123C]">
              {healthError}
            </div>
          )}
        </div>

        <LiveBackendSetupCard
          api={api}
          isLiveBackend={effectiveLive}
          needsDirectReauth={needsDirectReauth}
          hasBuildTimeConfig={authEnv.hasBuildTimeConfig}
          isRuntimeConfigured={authEnv.isRuntimeConfigured}
          activeAppsScriptUrl={authEnv.appsScriptUrl}
          activeGoogleClientId={authEnv.googleClientId}
          oauthSheetsConnection={oauthSheetsConnection}
          userEmail={user.email}
          onConnectionChanged={(next) => {
            onConnectionChanged?.(next);
            void refreshSyncStatus();
            void onSynced?.();
          }}
          onAuthorizeNow={() => {
            void onAuthorizeNow?.();
          }}
          onEnvironmentChanged={onEnvironmentChanged}
          onActivated={() => {
            onLiveBackendActivated?.();
          }}
          onReset={onResetLiveBackend}
          onNotify={onNotify}
        />
      </section>

      {/* Retry Outbox */}
      <section className="ct-card p-5 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-[#0A1B2C] ct-num">
            Pending Retry Outbox ({outboxItems.length})
          </h3>
          {outboxItems.length > 0 && onRetryAll && (
            <button
              type="button"
              onClick={() => void onRetryAll().then(() => refreshSyncStatus())}
              className="ct-btn-primary text-xs min-h-[36px] px-3.5 py-1"
            >
              Retry all queued ({outboxItems.length})
            </button>
          )}
        </div>

        {outboxItems.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs text-[#243647]">
            No failed or offline submissions are queued for retry.
          </div>
        ) : (
          <div className="space-y-2">
            {outboxItems.map((item) => (
              <div
                key={item.clientSubmissionKey}
                className="p-3.5 rounded-xl bg-[#FFFBEB] border border-[#B45309]/40 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-[#0A1B2C]">
                    {item.schoolName || 'Unnamed School'} ({item.udiseCode}) ·{' '}
                    {formatISODateToDDMMYYYY(item.startDate)}
                  </div>
                  <div className="text-[#243647] ct-num">
                    Key: <span className="font-mono">{item.clientSubmissionKey.slice(0, 8)}</span> ·
                    Attempts: {item.attempts} · Status: {item.syncStatus}
                  </div>
                  {item.lastError && <div className="text-[#BE123C]">{item.lastError}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {onRetryItem && (
                    <button
                      type="button"
                      disabled={retryingKey === item.clientSubmissionKey}
                      onClick={() => void handleRetrySingle(item)}
                      className="ct-btn-primary text-xs min-h-[34px] px-3 py-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      {retryingKey === item.clientSubmissionKey ? 'Retrying...' : 'Retry Sync'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDiscardOutboxItem(item.clientSubmissionKey)}
                    aria-label={`Remove queued item ${item.clientSubmissionKey}`}
                    className="p-2 rounded-lg bg-[#FFFFFF] hover:bg-[#FFF1F2] border border-[#8E8674] hover:border-[#BE123C]/40 text-[#243647] hover:text-[#BE123C] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sync Log History */}
      <section className="ct-card p-5 sm:p-6 space-y-3">
        <h3 className="text-base font-medium text-[#0A1B2C] ct-num">
          Recent Sync Activity ({mergedLogs.length})
        </h3>

        {mergedLogs.length === 0 ? (
          <p className="text-xs text-[#243647] py-4">
            Sync events will appear here after sessions are saved or updated.
          </p>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={captionId}
            className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
          >
            <table className="w-full text-left text-xs border-collapse min-w-[680px]">
              <caption id={captionId} className="visually-hidden">
                Google Sheets sync execution history
              </caption>
              <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                <tr>
                  <th scope="col" className="p-2.5 font-medium">Timestamp</th>
                  <th scope="col" className="p-2.5 font-medium">Operation</th>
                  <th scope="col" className="p-2.5 font-medium">Actor</th>
                  <th scope="col" className="p-2.5 font-medium">Session ID</th>
                  <th scope="col" className="p-2.5 font-medium">Attempt</th>
                  <th scope="col" className="p-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DFD7C2]">
                {mergedLogs.map((entry) => (
                  <tr key={entry.syncId} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num">
                    <td className="p-2.5 text-[#243647] whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-[#0A1B2C] font-medium">{entry.operation}</td>
                    <td className="p-2.5 text-[#243647]">{entry.actorEmail}</td>
                    <td className="p-2.5 font-mono text-[#006BB8] whitespace-nowrap">
                      {entry.sessionId || entry.clientSubmissionKey.slice(0, 12)}
                    </td>
                    <td className="p-2.5 text-[#243647]">{entry.attempt}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          entry.status === 'SYNCED'
                            ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                            : entry.status === 'FAILED'
                              ? 'bg-[#FFF1F2] border-[#BE123C]/40 text-[#BE123C]'
                              : 'bg-[#F5F2E9] border-[#C7BEA7] text-[#243647]'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
