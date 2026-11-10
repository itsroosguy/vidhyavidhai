import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Database,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { BackendApiClient, BackendHealthInfo } from '../services/apiClient';
import {
  loadLocalSyncEvents,
  removeSyncOutboxItem,
} from '../services/syncService';
import type { SyncLogEntry, SyncOutboxItem, UserProfile } from '../types/domain';
import { formatISODateToDDMMYYYY } from '../utils/temporal';

interface GoogleSheetsSyncPanelProps {
  api: BackendApiClient;
  user: UserProfile;
  isLiveBackend: boolean;
  outboxItems: SyncOutboxItem[];
  onRetryItem?: (item: SyncOutboxItem) => Promise<void>;
  onRetryAll?: () => Promise<void>;
  onOutboxChanged?: () => void;
  onOpenSyncModal?: () => void;
}

export const GoogleSheetsSyncPanel: React.FC<GoogleSheetsSyncPanelProps> = ({
  api,
  user,
  isLiveBackend,
  outboxItems,
  onRetryItem,
  onRetryAll,
  onOutboxChanged,
  onOpenSyncModal,
}) => {
  const [health, setHealth] = useState<BackendHealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [backendSyncLogs, setBackendSyncLogs] = useState<SyncLogEntry[]>([]);
  const [localEvents, setLocalEvents] = useState<SyncLogEntry[]>([]);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const captionId = useId();

  const refreshTelemetry = useCallback(async () => {
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
    void refreshTelemetry();
  }, [refreshTelemetry]);

  const handleRetrySingle = async (item: SyncOutboxItem) => {
    if (!onRetryItem) return;
    setRetryingKey(item.clientSubmissionKey);
    try {
      await onRetryItem(item);
      await refreshTelemetry();
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
            <h2 className="text-lg sm:text-xl font-medium text-[#E8EFFC] flex items-center gap-2">
              <Database className="w-5 h-5 text-[#4EBBBB]" aria-hidden="true" />
              Google Sheets Sync &amp; Apps Script Pipeline
            </h2>
            <p className="text-xs sm:text-sm text-[#A4B7D2] mt-0.5">
              Administrator-only connectivity telemetry, idempotent LockService sync status, and
              offline retry outbox.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refreshTelemetry()}
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

        <div className="p-4 rounded-xl bg-[#0C1931] border border-[#26456F] space-y-2 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-[#E8EFFC] flex items-center gap-2">
              {isLiveBackend ? (
                health?.connectedToGoogleSheets ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#48B98A]" aria-hidden="true" />
                    <span>Connected to Google Sheets Apps Script Web App</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-[#F2B44D]" aria-hidden="true" />
                    <span>Apps Script endpoint configured, health probe failed</span>
                  </>
                )
              ) : (
                <>
                  <CloudOff className="w-4 h-4 text-[#A4B7D2]" aria-hidden="true" />
                  <span>Running in Local Sandbox Mode (Not Connected to Live Google Sheets)</span>
                </>
              )}
            </div>
            {health?.checkedAt && (
              <span className="text-[11px] text-[#A4B7D2] ct-num">
                Checked {new Date(health.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <p className="text-xs text-[#A4B7D2] leading-relaxed">
            {isLiveBackend
              ? 'Every submission executes under Apps Script LockService with deterministic clientSubmissionKey idempotency and writes to all 8 Google Sheets tabs.'
              : 'Set VITE_APPS_SCRIPT_URL and VITE_GOOGLE_CLIENT_ID in frontend/.env to connect this console to your live Google Apps Script deployment and Google Spreadsheet.'}
          </p>
          {healthError && (
            <div className="p-2.5 rounded-lg bg-[#E77B83]/12 border border-[#E77B83]/45 text-xs text-[#E77B83]">
              {healthError}
            </div>
          )}
        </div>
      </section>

      {/* Retry Outbox */}
      <section className="ct-card p-5 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-[#E8EFFC] ct-num">
            Pending Retry Outbox ({outboxItems.length})
          </h3>
          {outboxItems.length > 0 && onRetryAll && (
            <button
              type="button"
              onClick={() => void onRetryAll().then(() => refreshTelemetry())}
              className="ct-btn-primary text-xs min-h-[36px] px-3.5 py-1"
            >
              Retry all queued ({outboxItems.length})
            </button>
          )}
        </div>

        {outboxItems.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#0C1931] border border-[#26456F] text-xs text-[#A4B7D2]">
            No failed or offline submissions are queued for retry.
          </div>
        ) : (
          <div className="space-y-2">
            {outboxItems.map((item) => (
              <div
                key={item.clientSubmissionKey}
                className="p-3.5 rounded-xl bg-[#392A11] border border-[#F2B44D]/45 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-[#E8EFFC]">
                    {item.schoolName || 'Unnamed School'} ({item.udiseCode}) ·{' '}
                    {formatISODateToDDMMYYYY(item.startDate)}
                  </div>
                  <div className="text-[#A4B7D2] ct-num">
                    Key: <span className="font-mono">{item.clientSubmissionKey.slice(0, 8)}</span> ·
                    Attempts: {item.attempts} · Status: {item.syncStatus}
                  </div>
                  {item.lastError && <div className="text-[#E77B83]">{item.lastError}</div>}
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
                    className="p-2 rounded-lg bg-[#162D55] hover:bg-[#E77B83]/20 border border-[#26456F] text-[#A4B7D2] hover:text-[#E77B83] cursor-pointer"
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
        <h3 className="text-base font-medium text-[#E8EFFC] ct-num">
          Recent Sync Activity ({mergedLogs.length})
        </h3>

        {mergedLogs.length === 0 ? (
          <p className="text-xs text-[#A4B7D2] py-4">
            Sync events will appear here after sessions are saved or updated.
          </p>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={captionId}
            className="ct-table-wrapper rounded-xl border border-[#26456F]"
          >
            <table className="w-full text-left text-xs border-collapse min-w-[680px]">
              <caption id={captionId} className="visually-hidden">
                Google Sheets sync execution history
              </caption>
              <thead className="bg-[#0C1931] text-[#A4B7D2] uppercase text-[11px]">
                <tr>
                  <th scope="col" className="p-2.5 font-medium">Timestamp</th>
                  <th scope="col" className="p-2.5 font-medium">Operation</th>
                  <th scope="col" className="p-2.5 font-medium">Actor</th>
                  <th scope="col" className="p-2.5 font-medium">Session ID</th>
                  <th scope="col" className="p-2.5 font-medium">Attempt</th>
                  <th scope="col" className="p-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26456F]">
                {mergedLogs.map((entry) => (
                  <tr key={entry.syncId} className="bg-[#101E3C] hover:bg-[#162D55] transition-colors ct-num">
                    <td className="p-2.5 text-[#A4B7D2] whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-[#E8EFFC] font-medium">{entry.operation}</td>
                    <td className="p-2.5 text-[#A4B7D2]">{entry.actorEmail}</td>
                    <td className="p-2.5 font-mono text-[#4EBBBB] whitespace-nowrap">
                      {entry.sessionId || entry.clientSubmissionKey.slice(0, 12)}
                    </td>
                    <td className="p-2.5 text-[#A4B7D2]">{entry.attempt}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          entry.status === 'SYNCED'
                            ? 'bg-[#48B98A]/15 border-[#48B98A]/40 text-[#48B98A]'
                            : entry.status === 'FAILED'
                              ? 'bg-[#E77B83]/15 border-[#E77B83]/45 text-[#E77B83]'
                              : 'bg-[#162D55] border-[#26456F] text-[#A4B7D2]'
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
