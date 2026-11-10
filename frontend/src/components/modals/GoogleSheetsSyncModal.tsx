import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Database,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { BackendApiClient, BackendHealthInfo } from '../../services/apiClient';
import {
  loadLocalSyncEvents,
  loadSyncOutbox,
  removeSyncOutboxItem,
} from '../../services/syncService';
import type { SyncLogEntry, SyncOutboxItem, UserProfile } from '../../types/domain';
import { formatISODateToDDMMYYYY } from '../../utils/temporal';
import { GlassModal } from './GlassModal';

interface GoogleSheetsSyncModalProps {
  open: boolean;
  onClose: () => void;
  api: BackendApiClient;
  user: UserProfile;
  isLiveBackend: boolean;
  outboxItems: SyncOutboxItem[];
  onRetryItem: (item: SyncOutboxItem) => Promise<void>;
  onRetryAll: () => Promise<void>;
  onOutboxChanged: () => void;
}

export const GoogleSheetsSyncModal: React.FC<GoogleSheetsSyncModalProps> = ({
  open,
  onClose,
  api,
  user,
  isLiveBackend,
  outboxItems,
  onRetryItem,
  onRetryAll,
  onOutboxChanged,
}) => {
  const [health, setHealth] = useState<BackendHealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [backendSyncLogs, setBackendSyncLogs] = useState<SyncLogEntry[]>([]);
  const [localEvents, setLocalEvents] = useState<SyncLogEntry[]>([]);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);

  const refreshTelemetry = useCallback(async () => {
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
      void refreshTelemetry();
    }
  }, [open, refreshTelemetry]);

  const handleRetrySingle = async (item: SyncOutboxItem) => {
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

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow="Pipeline Telemetry"
      title="Google Sheets Sync Status"
      subtitle="Live connectivity diagnostics, offline retry outbox, and idempotent write audit trail."
      headerBadge={
        isLiveBackend && health?.connectedToGoogleSheets ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#48B98A]/15 border border-[#48B98A]/40 text-[#48B98A]">
            <Database className="w-3 h-3" aria-hidden="true" />
            Apps Script Live
          </span>
        ) : !isLiveBackend ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#162D55] border border-[#26456F] text-[#A4B7D2]">
            <CloudOff className="w-3 h-3" aria-hidden="true" />
            Local Sandbox
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#392A11] border border-[#F2B44D]/45 text-[#F2B44D]">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            Connectivity Warning
          </span>
        )
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => void refreshTelemetry()}
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
              onClick={() => void onRetryAll().then(() => refreshTelemetry())}
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
      {/* Honest Endpoint Status Card */}
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
            ? 'Every submission carries a deterministic clientSubmissionKey and executes inside Apps Script LockService to prevent duplicate rows or overwritten concurrent sessions.'
            : 'Configure VITE_APPS_SCRIPT_URL and VITE_GOOGLE_CLIENT_ID in frontend/.env to sync live rows into your Google Spreadsheet.'}
        </p>

        {healthError && (
          <div className="p-2.5 rounded-lg bg-[#E77B83]/12 border border-[#E77B83]/45 text-xs text-[#E77B83]">
            {healthError}
          </div>
        )}
      </div>

      {/* Offline / Failed Retry Queue */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[#E8EFFC]">
            Pending Retry Outbox ({currentOutbox.length})
          </h3>
          <span className="text-xs text-[#A4B7D2]">Idempotent replay queue</span>
        </div>

        {currentOutbox.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#0C1931] border border-[#26456F] text-xs text-[#A4B7D2]">
            No failed or offline submissions are waiting for retry.
          </div>
        ) : (
          <div className="space-y-2">
            {currentOutbox.map((item) => (
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
                    className="p-2 rounded-lg bg-[#162D55] hover:bg-[#E77B83]/20 border border-[#26456F] text-[#A4B7D2] hover:text-[#E77B83] cursor-pointer"
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
        <h3 className="text-sm font-medium text-[#E8EFFC]">
          Recent Sync Activity ({mergedLogs.length})
        </h3>

        {mergedLogs.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#0C1931] border border-[#26456F] text-xs text-[#A4B7D2]">
            Sync history will appear here once sessions are submitted or updated.
          </div>
        ) : (
          <div className="ct-table-wrapper rounded-xl border border-[#26456F]">
            <table className="w-full text-left text-xs border-collapse min-w-[520px]">
              <thead className="bg-[#0C1931] text-[#A4B7D2] uppercase text-[11px]">
                <tr>
                  <th scope="col" className="p-2.5 font-medium">Time</th>
                  <th scope="col" className="p-2.5 font-medium">Operation</th>
                  <th scope="col" className="p-2.5 font-medium">Session ID</th>
                  <th scope="col" className="p-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26456F]">
                {mergedLogs.slice(0, 15).map((entry) => (
                  <tr key={entry.syncId} className="bg-[#101E3C] hover:bg-[#162D55] transition-colors">
                    <td className="p-2.5 text-[#A4B7D2] ct-num whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-[#E8EFFC]">{entry.operation}</td>
                    <td className="p-2.5 font-mono text-[#4EBBBB] whitespace-nowrap">
                      {entry.sessionId || entry.clientSubmissionKey.slice(0, 12)}
                    </td>
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
      </div>
    </GlassModal>
  );
};
