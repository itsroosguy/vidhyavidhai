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
            <h2 className="text-lg sm:text-xl font-medium text-[#0F172A] flex items-center gap-2">
              <Database className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
              Google Sheets Sync &amp; Apps Script Pipeline
            </h2>
            <p className="text-xs sm:text-sm text-[#475569] mt-0.5">
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

        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-[#0F172A] flex items-center gap-2">
              {isLiveBackend ? (
                health?.connectedToGoogleSheets ? (
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
                  <CloudOff className="w-4 h-4 text-[#475569]" aria-hidden="true" />
                  <span>Running in Local Sandbox Mode (Not Connected to Live Google Sheets)</span>
                </>
              )}
            </div>
            {health?.checkedAt && (
              <span className="text-[11px] text-[#475569] ct-num">
                Checked {new Date(health.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <p className="text-xs text-[#475569] leading-relaxed">
            {isLiveBackend
              ? 'Every submission executes under Apps Script LockService with deterministic clientSubmissionKey idempotency and writes to all 8 Google Sheets tabs.'
              : 'Set VITE_APPS_SCRIPT_URL and VITE_GOOGLE_CLIENT_ID in frontend/.env to connect this console to your live Google Apps Script deployment and Google Spreadsheet.'}
          </p>
          {healthError && (
            <div className="p-2.5 rounded-lg bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#BE123C]">
              {healthError}
            </div>
          )}
        </div>
      </section>

      {/* Retry Outbox */}
      <section className="ct-card p-5 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-[#0F172A] ct-num">
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
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#475569]">
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
                  <div className="font-medium text-[#0F172A]">
                    {item.schoolName || 'Unnamed School'} ({item.udiseCode}) ·{' '}
                    {formatISODateToDDMMYYYY(item.startDate)}
                  </div>
                  <div className="text-[#475569] ct-num">
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
                    className="p-2 rounded-lg bg-[#FFFFFF] hover:bg-[#FFF1F2] border border-[#CBD5E1] hover:border-[#BE123C]/40 text-[#475569] hover:text-[#BE123C] cursor-pointer"
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
        <h3 className="text-base font-medium text-[#0F172A] ct-num">
          Recent Sync Activity ({mergedLogs.length})
        </h3>

        {mergedLogs.length === 0 ? (
          <p className="text-xs text-[#475569] py-4">
            Sync events will appear here after sessions are saved or updated.
          </p>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={captionId}
            className="ct-table-wrapper rounded-xl border border-[#E2E8F0]"
          >
            <table className="w-full text-left text-xs border-collapse min-w-[680px]">
              <caption id={captionId} className="visually-hidden">
                Google Sheets sync execution history
              </caption>
              <thead className="bg-[#F8FAFC] text-[#475569] uppercase text-[11px]">
                <tr>
                  <th scope="col" className="p-2.5 font-medium">Timestamp</th>
                  <th scope="col" className="p-2.5 font-medium">Operation</th>
                  <th scope="col" className="p-2.5 font-medium">Actor</th>
                  <th scope="col" className="p-2.5 font-medium">Session ID</th>
                  <th scope="col" className="p-2.5 font-medium">Attempt</th>
                  <th scope="col" className="p-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {mergedLogs.map((entry) => (
                  <tr key={entry.syncId} className="bg-[#FFFFFF] hover:bg-[#F8FAFC] transition-colors ct-num">
                    <td className="p-2.5 text-[#475569] whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-[#0F172A] font-medium">{entry.operation}</td>
                    <td className="p-2.5 text-[#475569]">{entry.actorEmail}</td>
                    <td className="p-2.5 font-mono text-[#0F766E] whitespace-nowrap">
                      {entry.sessionId || entry.clientSubmissionKey.slice(0, 12)}
                    </td>
                    <td className="p-2.5 text-[#475569]">{entry.attempt}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          entry.status === 'SYNCED'
                            ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                            : entry.status === 'FAILED'
                              ? 'bg-[#FFF1F2] border-[#BE123C]/40 text-[#BE123C]'
                              : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]'
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
