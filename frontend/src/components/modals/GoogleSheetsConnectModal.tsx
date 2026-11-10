import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import { GoogleSheetsIcon } from '../../admin/GoogleSheetsBanner';
import {
  DEFAULT_TARGET_SPREADSHEET_ID,
  DEFAULT_TARGET_SPREADSHEET_URL,
  parseGoogleSpreadsheetId,
} from '../../config/defaults';
import type { BackendApiClient } from '../../services/apiClient';
import type {
  GoogleSheetsConnectionState,
  GoogleSpreadsheetSummary,
  UserProfile,
} from '../../types/domain';
import { GlassModal } from './GlassModal';

interface GoogleSheetsConnectModalProps {
  open: boolean;
  onClose: () => void;
  api: BackendApiClient;
  user: UserProfile;
  connection: GoogleSheetsConnectionState | null;
  oauthFeedback?: { type: 'authorized' | 'error'; message: string } | null;
  onConnectionChanged: (next: GoogleSheetsConnectionState) => void;
  onSynced?: () => Promise<void> | void;
  onDownloadInitializedWorkbook: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const GoogleSheetsConnectModal: React.FC<GoogleSheetsConnectModalProps> = ({
  open,
  onClose,
  api,
  user,
  connection,
  oauthFeedback = null,
  onConnectionChanged,
  onSynced,
  onDownloadInitializedWorkbook,
  onNotify,
}) => {
  const [sourceMode, setSourceMode] = useState<'existing' | 'create'>('existing');
  const [sheetUrlOrId, setSheetUrlOrId] = useState(DEFAULT_TARGET_SPREADSHEET_URL);
  const [customSheetName, setCustomSheetName] = useState('');
  const [newSheetTitle, setNewSheetTitle] = useState('Vidhya Vidhai · Career Tours Database');
  const [initializeSchema, setInitializeSchema] = useState(true);

  const [driveSpreadsheets, setDriveSpreadsheets] = useState<GoogleSpreadsheetSummary[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState('');
  const [loadingDriveList, setLoadingDriveList] = useState(false);

  const [urlTouched, setUrlTouched] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleError, setTitleError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnectConfirming, setDisconnectConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const [liveStatusMessage, setLiveStatusMessage] = useState('');

  const urlInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const keepConnectionBtnRef = useRef<HTMLButtonElement>(null);

  const modeExistingId = useId();
  const modeCreateId = useId();
  const driveSelectId = useId();
  const urlInputId = useId();
  const urlHintId = useId();
  const urlErrorId = useId();
  const customNameId = useId();
  const initCheckId = useId();
  const titleInputId = useId();
  const titleHintId = useId();
  const titleErrorId = useId();

  const isConnected = Boolean(connection?.connected && connection?.spreadsheetId);
  const oauthStartUrl = api.getSheetsOAuthStartUrl?.(connection?.connectedAccount || user.email) ?? null;
  const parsedPreviewId = parseGoogleSpreadsheetId(sheetUrlOrId);

  useEffect(() => {
    if (!open) {
      setDisconnectConfirming(false);
      setUrlError('');
      setTitleError('');
      setUrlTouched(false);
      setTitleTouched(false);
      setSelectedDriveId('');
      setLiveStatusMessage('');
      return;
    }

    if (connection?.connected && connection.spreadsheetUrl) {
      setSheetUrlOrId(connection.spreadsheetUrl);
      setCustomSheetName(connection.spreadsheetName || '');
      setSelectedDriveId(connection.spreadsheetId || '');
    } else if (!sheetUrlOrId.trim()) {
      setSheetUrlOrId(DEFAULT_TARGET_SPREADSHEET_URL);
      setSelectedDriveId('');
    }

    let cancelled = false;
    setLoadingDriveList(true);
    void api
      .listGoogleSpreadsheets()
      .then((res) => {
        if (!cancelled && res.ok && res.data) {
          setDriveSpreadsheets(res.data);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDriveList(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, api, connection?.connected, connection?.spreadsheetUrl, connection?.spreadsheetName]);

  const validateUrlField = (val: string): string => {
    if (!val.trim()) {
      return 'Error: Enter a Google Spreadsheet URL or Spreadsheet ID to continue.';
    }
    if (!parseGoogleSpreadsheetId(val)) {
      return 'Error: Enter a valid Google Sheets URL (https://docs.google.com/spreadsheets/d/...) or Spreadsheet ID.';
    }
    return '';
  };

  const validateTitleField = (val: string): string => {
    if (!val.trim()) {
      return 'Error: Enter a name for the new Google Spreadsheet.';
    }
    if (val.trim().length < 3) {
      return 'Error: Spreadsheet name must be at least 3 characters.';
    }
    return '';
  };

  const handleExistingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateUrlField(sheetUrlOrId);
    setUrlTouched(true);
    setUrlError(err);
    if (err) {
      setLiveStatusMessage(err);
      urlInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setLiveStatusMessage('Connecting Google Sheet and verifying structure…');
    try {
      const res = await api.connectGoogleSheet({
        spreadsheetUrlOrId: sheetUrlOrId.trim(),
        spreadsheetName: customSheetName.trim() || undefined,
        initializeSchema,
        googleAccount: connection?.connectedAccount || user.email,
      });
      if (!res.ok || !res.data) {
        const msg = res.error || 'Unable to connect Google Spreadsheet.';
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Google Sheets connection failed', msg);
        return;
      }

      onConnectionChanged(res.data);
      const syncRes = await api.syncAllToGoogleSheet();
      if (syncRes.ok) {
        const latestConn = await api.getSheetsConnection();
        if (latestConn.ok && latestConn.data) {
          onConnectionChanged(latestConn.data);
        }
        await onSynced?.();
      }
      const successMsg = `Connected "${res.data.spreadsheetName}" (${res.data.initializedTabs.length} tabs verified).`;
      setLiveStatusMessage(successMsg);
      onNotify('success', 'Google Sheets connected', successMsg);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateTitleField(newSheetTitle);
    setTitleTouched(true);
    setTitleError(err);
    if (err) {
      setLiveStatusMessage(err);
      titleInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setLiveStatusMessage('Creating new Google Spreadsheet with 8 programme tabs…');
    try {
      const res = await api.createGoogleSheet({
        title: newSheetTitle.trim(),
        googleAccount: connection?.connectedAccount || user.email,
      });
      if (!res.ok || !res.data) {
        const msg = res.error || 'Unable to create Google Spreadsheet.';
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Spreadsheet creation failed', msg);
        return;
      }

      onConnectionChanged(res.data);
      const syncRes = await api.syncAllToGoogleSheet();
      if (syncRes.ok) {
        const latestConn = await api.getSheetsConnection();
        if (latestConn.ok && latestConn.data) {
          onConnectionChanged(latestConn.data);
        }
        await onSynced?.();
      }
      setSourceMode('existing');
      setSheetUrlOrId(res.data.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL);
      setCustomSheetName(res.data.spreadsheetName);
      const successMsg = `Created and connected "${res.data.spreadsheetName}".`;
      setLiveStatusMessage(successMsg);
      onNotify('success', 'Google Spreadsheet created & connected', successMsg);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setLiveStatusMessage('Synchronizing programme records to Google Sheets…');
    try {
      const res = await api.syncAllToGoogleSheet();
      if (!res.ok || !res.data) {
        const msg = res.error || 'Synchronisation failed.';
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Google Sheets sync failed', msg);
        return;
      }

      const refreshedConn = await api.getSheetsConnection();
      if (refreshedConn.ok && refreshedConn.data) {
        onConnectionChanged(refreshedConn.data);
      }
      await onSynced?.();
      setLiveStatusMessage(res.data.message);
      onNotify('success', 'Google Sheets sync complete', res.data.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setDisconnecting(true);
    setLiveStatusMessage('Disconnecting spreadsheet link…');
    try {
      const res = await api.disconnectGoogleSheet();
      if (!res.ok || !res.data) {
        const msg = res.error || 'Failed to disconnect Google Sheet.';
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Disconnect failed', msg);
        return;
      }
      setDisconnectConfirming(false);
      onConnectionChanged(res.data);
      setLiveStatusMessage('Google Sheet disconnected cleanly. Existing spreadsheet data remains intact.');
      onNotify('success', 'Google Sheet disconnected', 'Spreadsheet data in Google Drive was preserved.');
      onClose();
    } finally {
      setDisconnecting(false);
    }
  };

  const handleDownloadWorkbook = async () => {
    setDownloadingXlsx(true);
    try {
      await onDownloadInitializedWorkbook();
      setLiveStatusMessage('Downloaded initialized 8-tab workbook (.xlsx) ready for Google Sheets import.');
    } finally {
      setDownloadingXlsx(false);
    }
  };

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow="Google Sheets Integration"
      title={isConnected ? 'Manage Google Sheets Connection' : 'Connect Your Google Sheet'}
      subtitle="Authorize your Google account, link an existing or new spreadsheet, and keep programme records synchronised without duplicate writes."
      headerBadge={
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#E6F4EA] border border-[#137333]/25 text-[#137333]">
          <GoogleSheetsIcon className="w-3.5 h-3.5" />
          Administrator Only
        </span>
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          className="ct-btn-secondary text-sm min-h-[42px] px-4"
        >
          Close
        </button>
      }
    >
      {/* Single polite status announcer for async operations and feedback */}
      <div role="status" aria-live="polite" className="visually-hidden">
        {liveStatusMessage}
      </div>

      {/* OAuth callback or inline action feedback */}
      {oauthFeedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs sm:text-sm flex items-start gap-2.5 ${
            oauthFeedback.type === 'authorized'
              ? 'bg-[#E6F4EA] border-[#137333]/30 text-[#0A1B2C]'
              : 'bg-[#FFF1F2] border-[#BE123C]/35 text-[#BE123C]'
          }`}
        >
          {oauthFeedback.type === 'authorized' ? (
            <CheckCircle2 className="w-4 h-4 text-[#137333] shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-[#BE123C] shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span>{oauthFeedback.message}</span>
        </div>
      )}

      {/* Step 1: Google Account & Backend Authorization */}
      <section className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-[#243647] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#137333]" aria-hidden="true" />
              Step 1 · Google Account Authorization
            </div>
            <p className="text-sm text-[#0A1B2C]">
              Active administrator:{' '}
              <span className="font-medium">
                {connection?.connectedAccount || user.email}
              </span>
            </p>
            <p className="text-xs text-[#243647]">
              {connection?.oauthConfigured && oauthStartUrl
                ? 'OAuth 2.0 tokens are stored securely on the backend in encrypted HttpOnly cookies.'
                : api.mode === 'apps_script'
                  ? 'Authenticated via Google Identity Services & Google Apps Script Web App.'
                  : 'Sandbox preview: stage connections here or download the initialized 8-tab workbook (.xlsx) to import directly into your Google Sheet.'}
            </p>
          </div>

          {oauthStartUrl && connection?.oauthConfigured && (
            <button
              type="button"
              onClick={() => window.location.assign(oauthStartUrl)}
              className="ct-btn-secondary text-xs min-h-[40px] px-3.5 border-[#137333]/35 hover:border-[#137333] shrink-0"
            >
              <Link2 className="w-3.5 h-3.5 text-[#137333]" aria-hidden="true" />
              {connection?.connectedAccount && connection.authMethod === 'google_oauth'
                ? 'Reconnect Google Account'
                : 'Authorize with Google OAuth 2.0'}
            </button>
          )}
        </div>
      </section>

      {/* Active Connection Management Summary when connected */}
      {isConnected && connection && (
        <section className="p-4 rounded-xl bg-[#FFFFFF] border border-[#137333]/30 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[#0A1B2C]">
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#188038]" />
              <CheckCircle2 className="w-4 h-4 text-[#137333]" aria-hidden="true" />
              <span>Google Sheets Connected</span>
            </div>
            {connection.lastSyncedAt && (
              <span className="text-xs text-[#243647] ct-num">
                Last sync: {new Date(connection.lastSyncedAt).toLocaleString()}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
              <dt className="text-[#243647]">Spreadsheet Name</dt>
              <dd className="mt-0.5 font-medium text-[#0A1B2C] flex items-center gap-1.5">
                {connection.spreadsheetUrl ? (
                  <a
                    href={connection.spreadsheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#137333] hover:text-[#0D652D] underline underline-offset-2"
                  >
                    <span>{connection.spreadsheetName}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </a>
                ) : (
                  <span>{connection.spreadsheetName}</span>
                )}
              </dd>
            </div>
            <div className="p-2.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
              <dt className="text-[#243647]">Spreadsheet ID</dt>
              <dd className="mt-0.5 font-mono text-[#0A1B2C] break-all">
                {connection.spreadsheetId}
              </dd>
            </div>
          </dl>

          {connection.lastSyncMessage && (
            <p className="text-xs text-[#243647]">{connection.lastSyncMessage}</p>
          )}

          {connection.initializedTabs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {connection.initializedTabs.map((tab) => (
                <span
                  key={tab}
                  className="px-2 py-0.5 rounded-md bg-[#E6F4EA] border border-[#137333]/20 text-[11px] font-medium text-[#137333]"
                >
                  {tab}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSyncNow()}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs font-medium border border-[#0D652D] cursor-pointer disabled:opacity-55"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{syncing ? 'Synchronising…' : 'Sync Programme Data Now'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleDownloadWorkbook()}
                disabled={downloadingXlsx}
                className="ct-btn-secondary text-xs min-h-[40px] px-3.5 py-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#137333]" aria-hidden="true" />
                <span>{downloadingXlsx ? 'Preparing…' : 'Export 8-Tab Sheet (.xlsx)'}</span>
              </button>
            </div>

            {!disconnectConfirming && (
              <button
                type="button"
                onClick={() => {
                  setDisconnectConfirming(true);
                  setTimeout(() => keepConnectionBtnRef.current?.focus(), 0);
                }}
                className="ct-btn-secondary text-xs min-h-[40px] px-3.5 py-1.5 border-[#BE123C]/40 text-[#BE123C] hover:bg-[#FFF1F2]"
              >
                <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            )}
          </div>

          {disconnectConfirming && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/35 flex flex-wrap items-center justify-between gap-2.5 text-xs text-[#0A1B2C]"
            >
              <span>
                Disconnect this Google Sheet link? Existing spreadsheet tabs and programme data in
                Google Drive will not be deleted.
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  ref={keepConnectionBtnRef}
                  type="button"
                  onClick={() => setDisconnectConfirming(false)}
                  className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                >
                  Keep connection
                </button>
                <button
                  type="button"
                  disabled={disconnecting}
                  onClick={() => void handleConfirmDisconnect()}
                  className="ct-btn-danger text-xs min-h-[36px] px-3 py-1"
                >
                  {disconnecting ? 'Disconnecting…' : 'Confirm disconnect'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Step 2: Select Existing or Create New Spreadsheet */}
      <div className="space-y-4">
        <fieldset className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#DFD7C2]">
          <legend className="px-1.5 text-xs font-medium text-[#0A1B2C]">
            {isConnected ? 'Change or Switch Spreadsheet' : 'Step 2 · Choose Google Spreadsheet'}
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-1.5">
            <label
              htmlFor={modeExistingId}
              className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs sm:text-sm cursor-pointer transition-colors ${
                sourceMode === 'existing'
                  ? 'bg-[#E6F4EA] border-[#137333] text-[#0A1B2C] font-medium'
                  : 'bg-[#FAF8F2] border-[#DFD7C2] text-[#243647]'
              }`}
            >
              <input
                id={modeExistingId}
                type="radio"
                name="sheets_source_mode"
                value="existing"
                checked={sourceMode === 'existing'}
                onChange={() => {
                  setSourceMode('existing');
                  setTitleError('');
                }}
                className="w-4 h-4 accent-[#137333]"
              />
              <span>Connect an existing spreadsheet</span>
            </label>

            <label
              htmlFor={modeCreateId}
              className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs sm:text-sm cursor-pointer transition-colors ${
                sourceMode === 'create'
                  ? 'bg-[#E6F4EA] border-[#137333] text-[#0A1B2C] font-medium'
                  : 'bg-[#FAF8F2] border-[#DFD7C2] text-[#243647]'
              }`}
            >
              <input
                id={modeCreateId}
                type="radio"
                name="sheets_source_mode"
                value="create"
                checked={sourceMode === 'create'}
                onChange={() => {
                  setSourceMode('create');
                  setUrlError('');
                }}
                className="w-4 h-4 accent-[#137333]"
              />
              <span>Create a new spreadsheet</span>
            </label>
          </div>
        </fieldset>

        {sourceMode === 'existing' ? (
          <form onSubmit={(e) => void handleExistingSubmit(e)} noValidate className="space-y-3.5">
            {driveSpreadsheets.length > 0 && (
              <div>
                <label
                  htmlFor={driveSelectId}
                  className="block text-xs font-medium text-[#0A1B2C] mb-1"
                >
                  Available Google Spreadsheets
                </label>
                <select
                  id={driveSelectId}
                  name="drive_spreadsheet_picker"
                  value={selectedDriveId}
                  disabled={loadingDriveList}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedDriveId(nextId);
                    const selected = driveSpreadsheets.find((s) => s.spreadsheetId === nextId);
                    if (selected) {
                      setSheetUrlOrId(selected.url || selected.spreadsheetId);
                      setCustomSheetName(selected.name);
                      setUrlError('');
                    }
                  }}
                  className="ct-input ct-select text-sm"
                >
                  <option value="">
                    {loadingDriveList
                      ? 'Loading spreadsheets…'
                      : 'Select a spreadsheet to populate the link below'}
                  </option>
                  {driveSpreadsheets.map((item) => (
                    <option key={item.spreadsheetId} value={item.spreadsheetId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label htmlFor={urlInputId} className="text-xs font-medium text-[#0A1B2C]">
                  Google Spreadsheet URL or ID <span aria-hidden="true">*</span>
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDriveId('');
                      setSheetUrlOrId(DEFAULT_TARGET_SPREADSHEET_URL);
                      setUrlError('');
                    }}
                    className="text-[#137333] hover:text-[#0D652D] underline underline-offset-2 cursor-pointer"
                  >
                    Use official Vidhya Vidhai sheet
                  </button>
                  {parsedPreviewId && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${parsedPreviewId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#006BB8] hover:underline"
                    >
                      <span>Open</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
              <p id={urlHintId} className="text-xs text-[#243647] mb-1.5">
                Format: Full Google Sheets URL or Spreadsheet ID (default sheet ID:{' '}
                <span className="font-mono">{DEFAULT_TARGET_SPREADSHEET_ID.slice(0, 12)}…</span>).
              </p>
              <input
                ref={urlInputRef}
                id={urlInputId}
                name="spreadsheet_url_or_id"
                type="text"
                required
                value={sheetUrlOrId}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={urlError ? 'true' : 'false'}
                aria-describedby={urlError ? `${urlHintId} ${urlErrorId}` : urlHintId}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setSheetUrlOrId(nextVal);
                  setSelectedDriveId('');
                  if (urlTouched || urlError) {
                    setUrlError(validateUrlField(nextVal));
                  }
                }}
                onBlur={() => {
                  setUrlTouched(true);
                  setUrlError(validateUrlField(sheetUrlOrId));
                }}
                placeholder={DEFAULT_TARGET_SPREADSHEET_URL}
                className="ct-input text-sm font-mono"
              />
              {urlError && (
                <p id={urlErrorId} className="mt-1.5 text-xs text-[#BE123C] flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{urlError}</span>
                </p>
              )}
            </div>

            <div>
              <label htmlFor={customNameId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
                Spreadsheet Display Label (optional)
              </label>
              <input
                id={customNameId}
                name="spreadsheet_label"
                type="text"
                value={customSheetName}
                onChange={(e) => setCustomSheetName(e.target.value)}
                placeholder="Vidhya Vidhai · Career Tours Database"
                className="ct-input text-sm"
              />
            </div>

            <div className="flex items-start gap-2.5 pt-0.5">
              <input
                id={initCheckId}
                name="initialize_schema"
                type="checkbox"
                checked={initializeSchema}
                onChange={(e) => setInitializeSchema(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-[#137333]"
              />
              <label htmlFor={initCheckId} className="text-xs text-[#243647] cursor-pointer">
                Initialize all 8 official programme tabs (Sessions, Session Details, Facilitators,
                Schools, Configuration, Admin Users, Audit Log, Sync Log) if missing without
                overwriting existing rows.
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
              {!isConnected && (
                <button
                  type="button"
                  onClick={() => void handleDownloadWorkbook()}
                  disabled={downloadingXlsx}
                  className="ct-btn-secondary text-xs min-h-[42px] px-3.5"
                >
                  <Download className="w-3.5 h-3.5 text-[#137333]" aria-hidden="true" />
                  <span>
                    {downloadingXlsx ? 'Preparing…' : 'Download Initialized Sheet (.xlsx)'}
                  </span>
                </button>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer ml-auto disabled:opacity-55 disabled:cursor-not-allowed"
              >
                <GoogleSheetsIcon className="w-4 h-4 shrink-0" variant="inverted" />
                <span>
                  {submitting
                    ? 'Connecting…'
                    : isConnected
                      ? 'Save & Switch Spreadsheet'
                      : 'Connect Google Sheets'}
                </span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => void handleCreateSubmit(e)} noValidate className="space-y-3.5">
            <div>
              <label htmlFor={titleInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
                New Google Spreadsheet Name <span aria-hidden="true">*</span>
              </label>
              <p id={titleHintId} className="text-xs text-[#243647] mb-1.5">
                Creates a new Google Spreadsheet formatted with all 8 Career Tours database tabs.
              </p>
              <input
                ref={titleInputRef}
                id={titleInputId}
                name="new_spreadsheet_title"
                type="text"
                required
                minLength={3}
                value={newSheetTitle}
                aria-invalid={titleError ? 'true' : 'false'}
                aria-describedby={titleError ? `${titleHintId} ${titleErrorId}` : titleHintId}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setNewSheetTitle(nextVal);
                  if (titleTouched || titleError) {
                    setTitleError(validateTitleField(nextVal));
                  }
                }}
                onBlur={() => {
                  setTitleTouched(true);
                  setTitleError(validateTitleField(newSheetTitle));
                }}
                className="ct-input text-sm"
              />
              {titleError && (
                <p id={titleErrorId} className="mt-1.5 text-xs text-[#BE123C] flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{titleError}</span>
                </p>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>
                  {submitting ? 'Creating spreadsheet…' : 'Create & Connect Spreadsheet'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </GlassModal>
  );
};
