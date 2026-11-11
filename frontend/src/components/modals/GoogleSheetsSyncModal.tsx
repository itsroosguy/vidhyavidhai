import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Database,
  ExternalLink,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { BackendApiClient, BackendHealthInfo } from '../../services/apiClient';
import { getAuthEnvironment, loadAppsScriptBridgeConfig } from '../../services/authService';
import {
  loadLocalSyncEvents,
  loadSyncOutbox,
  removeSyncOutboxItem,
} from '../../services/syncService';
import type {
  GoogleSheetsConnectionState,
  SyncLogEntry,
  SyncOutboxItem,
  UserProfile,
} from '../../types/domain';
import { formatISODateToDDMMYYYY } from '../../utils/temporal';
import { LiveBackendSetupCard } from '../sheets/LiveBackendSetupCard';
import { GlassModal } from './GlassModal';

interface GoogleSheetsSyncModalProps {
  open: boolean;
  onClose: () => void;
  api: BackendApiClient;
  user: UserProfile;
  isLiveBackend: boolean;
  needsDirectReauth?: boolean;
  oauthSheetsConnection?: GoogleSheetsConnectionState | null;
  outboxItems: SyncOutboxItem[];
  onRetryItem: (item: SyncOutboxItem) => Promise<void>;
  onRetryAll: () => Promise<void>;
  onOutboxChanged: () => void;
  onAuthorizeNow?: () => Promise<void> | void;
  onConnectionChanged?: (next: GoogleSheetsConnectionState) => void;
  onSynced?: () => Promise<void> | void;
  onEnvironmentChanged?: () => void;
  onLiveBackendActivated?: () => void;
  onResetLiveBackend?: () => void;
  onNotify?: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const GoogleSheetsSyncModal: React.FC<GoogleSheetsSyncModalProps> = ({
  open,
  onClose,
  api,
  user,
  isLiveBackend,
  needsDirectReauth = false,
  oauthSheetsConnection = null,
  outboxItems,
  onRetryItem,
  onRetryAll,
  onOutboxChanged,
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

  const refreshSyncStatus = useCallback(async () => {
    setLocalEvents(loadLocalSyncEvents(user.email));
    setCheckingHealth(true);
    setHealthError(null);
    try {
      const [hRes, logRes] = await Promise.all([
        api.pingHealth(),
        api.getSyncLogs(1, 20),
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
    if (open) {
      void refreshSyncStatus();
    }
  }, [open, refreshSyncStatus]);

  const handleRetrySingle = async (item: SyncOutboxItem) => {
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
    onOutboxChanged();
  };

  const mergedLogs: SyncLogEntry[] = [...backendSyncLogs];
  for (const ev of localEvents) {
    if (!mergedLogs.some((m) => m.syncId === ev.syncId)) {
      mergedLogs.push(ev);
    }
  }
  mergedLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const currentOutbox =
    outboxItems.length > 0 ? outboxItems : loadSyncOutbox(user.email);
  const effectiveHealthOk = Boolean(
    health?.connectedToGoogleSheets ||
      ((isOAuthConnected || isBridgeConnected) && !healthError),
  );

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={isSupabaseMode ? 'Supabase Primary DB + Sheets Mirror' : 'Google Sheets Integration'}
      title="Google Sheets Sync Status"
      subtitle={
        isSupabaseMode
          ? 'Supabase PostgreSQL is your primary permanent database. Configure or verify your optional Google Sheets webhook mirror below.'
          : 'Verify live online storage, activate your official spreadsheet backend, and monitor pending retries.'
      }
      headerBadge={
        isSupabaseMode ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
            <Database className="w-3 h-3" aria-hidden="true" />
            {oauthSheetsConnection?.connected && oauthSheetsConnection.spreadsheetId
              ? 'Supabase Primary DB · Sheets Mirror Live'
              : 'Supabase Primary DB'}
          </span>
        ) : effectiveLive && effectiveHealthOk ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
            <Database className="w-3 h-3" aria-hidden="true" />
            Google Sheets Live
          </span>
        ) : !effectiveLive ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFBEB] border border-[#B45309]/40 text-[#92400E]">
            <CloudOff className="w-3 h-3" aria-hidden="true" />
            Local Storage · Setup Needed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFBEB] border border-[#B45309]/40 text-[#92400E]">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            Connection Needs Attention
          </span>
        )
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => void refreshSyncStatus()}
            disabled={checkingHealth}
            className="ct-btn-secondary text-sm"
          >
            <RefreshCw
              className={`w-4 h-4 ${checkingHealth ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {checkingHealth ? 'Checking...' : 'Check connectivity'}
          </button>
          {currentOutbox.length > 0 && (
            <button
              type="button"
              onClick={() => void onRetryAll().then(() => refreshSyncStatus())}
              className="ct-btn-primary text-sm"
            >
              Retry all queued ({currentOutbox.length})
            </button>
          )}
          <button type="button" onClick={onClose} className="ct-btn-secondary text-sm">
            Close
          </button>
        </>
      }
    >
      {/* Modal interactive body — mounted strictly when open to prevent duplicate form controls in DOM */}
      {open && (
        <>
          {/* Honest Endpoint Status Card */}
      <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] space-y-2 text-xs sm:text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium text-[#0A1B2C] flex items-center gap-2">
            {isSupabaseMode ? (
              oauthSheetsConnection?.connected && oauthSheetsConnection.spreadsheetId ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  <span>Primary Database: Supabase PostgreSQL Online · Sheets Mirror Linked</span>
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
            ) : isBridgeConnected && !authEnv.isLiveBackendConfigured ? (
              effectiveHealthOk ? (
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
            ) : isOAuthConnected ? (
              effectiveHealthOk ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                  <span>Connected to Google Sheets via Google OAuth 2.0</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                  <span>Google OAuth Sheets connection needs re-authorization</span>
                </>
              )
            ) : effectiveLive ? (
              effectiveHealthOk ? (
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
            ? 'All programme submissions, schools, user approvals, and audit logs already save permanently in Supabase PostgreSQL. Configure an Apps Script Web App webhook below if you want to mirror rows into Google Sheets.'
            : isBridgeConnected && !authEnv.isLiveBackendConfigured
              ? `Every session submission, edit, school directory update, and configuration change saves directly into "${oauthSheetsConnection?.spreadsheetName || 'your connected Google Sheet'}" via the Apps Script Sync Bridge while retaining remembered local password sign-in.`
              : isOAuthConnected
                ? `Every session submission, update, delete, school directory update, and configuration change saves directly into "${oauthSheetsConnection?.spreadsheetName || 'your connected Google Sheet'}" (${oauthSheetsConnection?.connectedAccount || user.email}) under Google OAuth 2.0 protection.`
                : effectiveLive
                  ? 'Every submission saves straight to Google Sheets under server concurrency locks and Google Sign-In verification.'
                  : 'Entries saved right now remain temporary on this browser and will not appear inside Google Sheets across devices. Activate your live Google Sheets backend below so every facilitator writes directly online.'}
        </p>

        {(isOAuthConnected ||
          isBridgeConnected ||
          (isSupabaseMode && Boolean(oauthSheetsConnection?.connected))) &&
          oauthSheetsConnection?.spreadsheetUrl && (
          <div>
            <a
              href={oauthSheetsConnection.spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#137333] hover:underline"
            >
              <span>
                Open {oauthSheetsConnection.spreadsheetName || 'Connected Google Sheet'}
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

      {/* Super Admin Live Google Sheets Activation & Connection Card */}
      <LiveBackendSetupCard
        api={api}
        isLiveBackend={effectiveLive}
        needsDirectReauth={needsDirectReauth}
        oauthSheetsConnection={oauthSheetsConnection}
        hasBuildTimeConfig={authEnv.hasBuildTimeConfig}
        isRuntimeConfigured={authEnv.isRuntimeConfigured}
        activeAppsScriptUrl={authEnv.appsScriptUrl}
        activeGoogleClientId={authEnv.googleClientId}
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

      {/* Offline / Failed Retry Queue */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[#0A1B2C]">
            Pending Retry Outbox ({currentOutbox.length})
          </h3>
          <span className="text-xs text-[#243647]">Automatic retry queue</span>
        </div>

        {currentOutbox.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs text-[#243647]">
            No failed or offline submissions are waiting for retry.
          </div>
        ) : (
          <div className="space-y-2">
            {currentOutbox.map((item) => (
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
                  <button
                    type="button"
                    disabled={retryingKey === item.clientSubmissionKey}
                    onClick={() => void handleRetrySingle(item)}
                    className="ct-btn-primary text-xs min-h-[34px] px-3 py-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    {retryingKey === item.clientSubmissionKey ? 'Retrying...' : 'Retry Sync'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDiscardOutboxItem(item.clientSubmissionKey)}
                    aria-label={`Remove queued item ${item.clientSubmissionKey}`}
                    className="p-2 rounded-lg bg-[#FFFFFF] hover:bg-[#FFF1F2] border border-[#8E8674] text-[#243647] hover:text-[#BE123C] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sync Log History */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-[#0A1B2C]">
          Recent Sync Activity ({mergedLogs.length})
        </h3>

        {mergedLogs.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs text-[#243647]">
            Sync history will appear here once sessions are submitted or updated.
          </div>
        ) : (
          <div className="ct-table-wrapper rounded-xl border border-[#DFD7C2]">
            <table className="w-full text-left text-xs border-collapse min-w-[520px]">
              <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                <tr>
                  <th scope="col" className="p-2.5 font-medium">Time</th>
                  <th scope="col" className="p-2.5 font-medium">Operation</th>
                  <th scope="col" className="p-2.5 font-medium">Session ID</th>
                  <th scope="col" className="p-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DFD7C2]">
                {mergedLogs.slice(0, 15).map((entry) => (
                  <tr key={entry.syncId} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors">
                    <td className="p-2.5 text-[#243647] ct-num whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-[#0A1B2C]">{entry.operation}</td>
                    <td className="p-2.5 font-mono text-[#006BB8] whitespace-nowrap">
                      {entry.sessionId || entry.clientSubmissionKey.slice(0, 12)}
                    </td>
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
      </div>
        </>
      )}
    </GlassModal>
  );
};
