import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
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
import {
  loadAppsScriptBridgeConfig,
  loadDirectGoogleClientId,
  saveDirectGoogleClientId,
  validateAppsScriptWebAppUrl,
  validateGoogleOAuthClientId,
} from '../../services/authService';
import { buildRelativeSpreadsheetTitle } from '../../services/googleSheetsDirectService';
import type {
  AppConfiguration,
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
  config?: AppConfiguration;
  isLiveBackend?: boolean;
  needsDirectReauth?: boolean;
  connection: GoogleSheetsConnectionState | null;
  oauthFeedback?: { type: 'authorized' | 'error'; message: string } | null;
  onConnectionChanged: (next: GoogleSheetsConnectionState) => void;
  onEnvironmentChanged?: () => void;
  onSynced?: () => Promise<void> | void;
  onDownloadInitializedWorkbook: () => Promise<void>;
  onOpenSyncSetup?: () => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const GoogleSheetsConnectModal: React.FC<GoogleSheetsConnectModalProps> = ({
  open,
  onClose,
  api,
  user,
  config,
  isLiveBackend = false,
  needsDirectReauth = false,
  connection,
  oauthFeedback = null,
  onConnectionChanged,
  onEnvironmentChanged,
  onSynced,
  onDownloadInitializedWorkbook,
  onOpenSyncSetup,
  onNotify,
}) => {
  const isSupabaseMode = api.mode === 'supabase';
  const [sourceMode, setSourceMode] = useState<'existing' | 'create'>('existing');
  const [sheetUrlOrId, setSheetUrlOrId] = useState(DEFAULT_TARGET_SPREADSHEET_URL);
  const [customSheetName, setCustomSheetName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookUrlTouched, setWebhookUrlTouched] = useState(false);
  const [webhookUrlError, setWebhookUrlError] = useState('');
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [previewDistricts, setPreviewDistricts] = useState<string[]>([]);
  const relativeDefaultTitle = useMemo(
    () =>
      buildRelativeSpreadsheetTitle({
        programmeName: 'Career Tours',
        partnerName: config?.partnerName,
        sessions: previewDistricts.map((d) => ({ district: d, startDate: '' })),
      }),
    [config?.partnerName, previewDistricts],
  );
  const [newSheetTitle, setNewSheetTitle] = useState(() =>
    buildRelativeSpreadsheetTitle({
      programmeName: 'Career Tours',
      partnerName: config?.partnerName,
    }),
  );
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [directClientId, setDirectClientId] = useState(() => loadDirectGoogleClientId());
  const [directClientError, setDirectClientError] = useState('');
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
  const webhookInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const keepConnectionBtnRef = useRef<HTMLButtonElement>(null);

  const modeExistingId = useId();
  const modeCreateId = useId();
  const driveSelectId = useId();
  const urlInputId = useId();
  const urlHintId = useId();
  const urlErrorId = useId();
  const webhookInputId = useId();
  const webhookHintId = useId();
  const webhookErrorId = useId();
  const customNameId = useId();
  const initCheckId = useId();
  const titleInputId = useId();
  const titleHintId = useId();
  const titleErrorId = useId();
  const directClientInputId = useId();
  const directClientErrId = useId();

  const isConnected = Boolean(connection?.connected && connection?.spreadsheetId);
  const hasSavedBridge = Boolean(loadAppsScriptBridgeConfig());
  const oauthStartUrl = api.getSheetsOAuthStartUrl?.(connection?.connectedAccount || user.email) ?? null;
  const parsedPreviewId = parseGoogleSpreadsheetId(sheetUrlOrId);

  useEffect(() => {
    if (!titleManuallyEdited) {
      setNewSheetTitle(relativeDefaultTitle);
    }
  }, [relativeDefaultTitle, titleManuallyEdited]);

  useEffect(() => {
    if (!open) {
      setDisconnectConfirming(false);
      setUrlError('');
      setTitleError('');
      setDirectClientError('');
      setWebhookUrlError('');
      setWebhookUrlTouched(false);
      setWebhookTestResult(null);
      setUrlTouched(false);
      setTitleTouched(false);
      setTitleManuallyEdited(false);
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
    void Promise.all([
      api.listGoogleSpreadsheets(),
      api.getWorkspaceSyncPreview?.() ?? Promise.resolve(null),
    ])
      .then(([res, previewRes]) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setDriveSpreadsheets(res.data);
        }
        if (previewRes && previewRes.ok && previewRes.data) {
          setPreviewDistricts(previewRes.data.districts);
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

  const validateWebhookField = (val: string): string => {
    const trimmed = val.trim();
    if (!trimmed) return '';
    const check = validateAppsScriptWebAppUrl(trimmed);
    return check.valid
      ? ''
      : `Error: ${check.error || 'Enter a valid HTTPS Google Apps Script Web App (/exec) URL.'}`;
  };

  const handleTestWebhook = async () => {
    const targetUrl = webhookUrl.trim();
    if (!targetUrl) {
      const msg = 'Error: Enter your Apps Script Web App (/exec) URL to test connectivity.';
      setWebhookUrlTouched(true);
      setWebhookUrlError(msg);
      setLiveStatusMessage(msg);
      webhookInputRef.current?.focus();
      return;
    }
    const err = validateWebhookField(targetUrl);
    setWebhookUrlTouched(true);
    setWebhookUrlError(err);
    if (err) {
      setLiveStatusMessage(err);
      webhookInputRef.current?.focus();
      return;
    }
    if (!api.testSheetsWebhook) return;
    setTestingWebhook(true);
    setWebhookTestResult(null);
    setLiveStatusMessage('Testing Apps Script Web App webhook via Supabase Edge Function…');
    try {
      const res = await api.testSheetsWebhook(
        targetUrl,
        parsedPreviewId || connection?.spreadsheetId || DEFAULT_TARGET_SPREADSHEET_ID,
      );
      if (!res.ok || !res.data) {
        const msg = res.error || 'Apps Script webhook test failed.';
        setWebhookTestResult({ ok: false, message: msg });
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Webhook test failed', msg);
        return;
      }
      setWebhookTestResult({ ok: res.data.reachable, message: res.data.message });
      setLiveStatusMessage(res.data.message);
      onNotify(
        res.data.reachable ? 'success' : 'warning',
        'Apps Script webhook tested',
        res.data.message,
      );
    } finally {
      setTestingWebhook(false);
    }
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

    if (isSupabaseMode && webhookUrl.trim()) {
      const webhookErr = validateWebhookField(webhookUrl);
      setWebhookUrlTouched(true);
      setWebhookUrlError(webhookErr);
      if (webhookErr) {
        setLiveStatusMessage(webhookErr);
        webhookInputRef.current?.focus();
        return;
      }
    }

    let resolvedDirectClientId: string | undefined;
    if (!isSupabaseMode && directClientId.trim()) {
      const check = validateGoogleOAuthClientId(directClientId);
      if (!check.valid) {
        setDirectClientError(check.error || 'Invalid Google OAuth Web Client ID.');
        return;
      }
      resolvedDirectClientId = saveDirectGoogleClientId(check.normalized);
    }

    setSubmitting(true);
    setLiveStatusMessage('Connecting Google Sheet and verifying structure…');
    try {
      const useBridge = Boolean(
        !isSupabaseMode &&
          !resolvedDirectClientId &&
          connection?.connectionProvider !== 'direct_browser' &&
          (connection?.connectionProvider === 'apps_script' ||
            connection?.authMethod === 'apps_script' ||
            hasSavedBridge),
      );
      const res = await api.connectGoogleSheet({
        spreadsheetUrlOrId: sheetUrlOrId.trim(),
        spreadsheetName: customSheetName.trim() || undefined,
        initializeSchema,
        googleAccount: connection?.connectedAccount || user.email,
        ...(isSupabaseMode
          ? {
              ...(webhookUrl.trim() ? { appsScriptUrl: webhookUrl.trim() } : {}),
            }
          : resolvedDirectClientId
            ? { directClientId: resolvedDirectClientId, forceDirectOAuth: true }
            : connection?.connectionProvider === 'direct_browser'
              ? { forceDirectOAuth: true }
              : useBridge
                ? { forceAppsScriptBridge: true }
                : {}),
      });
      if (!res.ok || !res.data) {
        const msg = res.error || 'Unable to connect Google Spreadsheet.';
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Google Sheets connection failed', msg);
        return;
      }

      onConnectionChanged(res.data);
      const syncRes = isSupabaseMode
        ? await api.syncAllToGoogleSheet(
            webhookUrl.trim() ? { appsScriptUrl: webhookUrl.trim() } : undefined,
          )
        : res.data.connectionProvider === 'direct_browser'
          ? { ok: true, error: undefined }
          : await api.syncAllToGoogleSheet();
      if (syncRes.ok) {
        const latestConn = await api.getSheetsConnection();
        if (latestConn.ok && latestConn.data && latestConn.data.connected) {
          onConnectionChanged(latestConn.data);
        }
        await onSynced?.();
      }
      if (!isSupabaseMode && resolvedDirectClientId) {
        onEnvironmentChanged?.();
      }
      const isLocalDeviceOnly =
        !isSupabaseMode && !isLiveBackend && res.data.authMethod === 'local_sandbox';
      const successMsg = isSupabaseMode
        ? syncRes.ok
          ? `Linked "${res.data.spreadsheetName}" in Supabase PostgreSQL and mirrored records to Google Sheets.`
          : webhookUrl.trim()
            ? `Saved "${res.data.spreadsheetName}" in Supabase, but Google Sheets webhook sync reported: ${syncRes.error || 'Check URL deployment.'}`
            : `Linked "${res.data.spreadsheetName}" in Supabase PostgreSQL. Add and test an Apps Script /exec webhook URL when ready to mirror rows automatically.`
        : isLocalDeviceOnly
          ? `Saved "${res.data.spreadsheetName}" on this device (${res.data.initializedTabs.length} tabs). Activate Live Google Sync to write online.`
          : `Connected "${res.data.spreadsheetName}" (${res.data.initializedTabs.length} tabs verified).`;
      setLiveStatusMessage(successMsg);
      onNotify(
        isSupabaseMode && !syncRes.ok && Boolean(webhookUrl.trim()) ? 'warning' : 'success',
        isSupabaseMode
          ? 'Google Sheets mirror settings saved'
          : isLocalDeviceOnly
            ? 'Target spreadsheet selected (Local Storage)'
            : 'Google Sheets connected',
        successMsg,
      );
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

    if (isSupabaseMode && webhookUrl.trim()) {
      const webhookErr = validateWebhookField(webhookUrl);
      setWebhookUrlTouched(true);
      setWebhookUrlError(webhookErr);
      if (webhookErr) {
        setLiveStatusMessage(webhookErr);
        webhookInputRef.current?.focus();
        return;
      }
    }

    let resolvedDirectClientId: string | undefined;
    if (!isSupabaseMode && directClientId.trim()) {
      const check = validateGoogleOAuthClientId(directClientId);
      if (!check.valid) {
        setDirectClientError(check.error || 'Invalid Google OAuth Web Client ID.');
        return;
      }
      resolvedDirectClientId = saveDirectGoogleClientId(check.normalized);
    }

    setSubmitting(true);
    setLiveStatusMessage(
      isSupabaseMode
        ? 'Saving Google Sheets mirror label in Supabase PostgreSQL…'
        : 'Creating new Google Spreadsheet with 8 core DB tabs + Summary & KPIs + Declarations…',
    );
    try {
      const useBridge = Boolean(
        !isSupabaseMode &&
          !resolvedDirectClientId &&
          connection?.connectionProvider !== 'direct_browser' &&
          (connection?.connectionProvider === 'apps_script' ||
            connection?.authMethod === 'apps_script' ||
            hasSavedBridge),
      );
      const res = await api.createGoogleSheet({
        title: newSheetTitle.trim(),
        googleAccount: connection?.connectedAccount || user.email,
        ...(isSupabaseMode
          ? {
              ...(webhookUrl.trim() ? { appsScriptUrl: webhookUrl.trim() } : {}),
            }
          : resolvedDirectClientId
            ? { directClientId: resolvedDirectClientId, forceDirectOAuth: true }
            : connection?.connectionProvider === 'direct_browser'
              ? { forceDirectOAuth: true }
              : useBridge
                ? { forceAppsScriptBridge: true }
                : {}),
      });
      if (!res.ok || !res.data) {
        const msg = res.error || 'Unable to create Google Spreadsheet.';
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Spreadsheet creation failed', msg);
        return;
      }

      onConnectionChanged(res.data);
      const syncRes = isSupabaseMode
        ? await api.syncAllToGoogleSheet(
            webhookUrl.trim() ? { appsScriptUrl: webhookUrl.trim() } : undefined,
          )
        : res.data.connectionProvider === 'direct_browser'
          ? { ok: true }
          : await api.syncAllToGoogleSheet();
      if (syncRes.ok) {
        const latestConn = await api.getSheetsConnection();
        if (latestConn.ok && latestConn.data && latestConn.data.connected) {
          onConnectionChanged(latestConn.data);
        }
        await onSynced?.();
      }
      if (!isSupabaseMode && resolvedDirectClientId) {
        onEnvironmentChanged?.();
      }
      const isLocalDeviceOnly =
        !isSupabaseMode && !isLiveBackend && res.data.authMethod === 'local_sandbox';
      setSourceMode('existing');
      setSheetUrlOrId(res.data.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL);
      setCustomSheetName(res.data.spreadsheetName);
      const successMsg = isSupabaseMode
        ? `Linked "${res.data.spreadsheetName}" in Supabase PostgreSQL.`
        : isLocalDeviceOnly
          ? `Configured "${res.data.spreadsheetName}" on this device. Activate Live Google Sync to create it in Google Drive.`
          : `Created and connected "${res.data.spreadsheetName}".`;
      setLiveStatusMessage(successMsg);
      onNotify(
        'success',
        isSupabaseMode
          ? 'Google Sheets mirror linked'
          : isLocalDeviceOnly
            ? 'Target spreadsheet selected (Local Storage)'
            : 'Google Spreadsheet created & connected',
        successMsg,
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncNow = async () => {
    if (isSupabaseMode && webhookUrl.trim()) {
      const webhookErr = validateWebhookField(webhookUrl);
      setWebhookUrlTouched(true);
      setWebhookUrlError(webhookErr);
      if (webhookErr) {
        setLiveStatusMessage(webhookErr);
        webhookInputRef.current?.focus();
        return;
      }
    }
    setSyncing(true);
    setLiveStatusMessage('Synchronizing programme records to Google Sheets…');
    try {
      let resolvedDirectClientId: string | undefined;
      if (!isSupabaseMode && directClientId.trim()) {
        const check = validateGoogleOAuthClientId(directClientId);
        if (!check.valid) {
          setDirectClientError(check.error || 'Invalid Google OAuth Web Client ID.');
          return;
        }
        resolvedDirectClientId = saveDirectGoogleClientId(check.normalized);
      }
      const useBridge = Boolean(
        !isSupabaseMode &&
          !resolvedDirectClientId &&
          connection?.connectionProvider !== 'direct_browser' &&
          (connection?.connectionProvider === 'apps_script' ||
            connection?.authMethod === 'apps_script' ||
            hasSavedBridge),
      );
      const res = await api.syncAllToGoogleSheet(
        isSupabaseMode
          ? webhookUrl.trim()
            ? { appsScriptUrl: webhookUrl.trim() }
            : undefined
          : resolvedDirectClientId
            ? { directClientId: resolvedDirectClientId, forceDirectOAuth: true }
            : connection?.connectionProvider === 'direct_browser'
              ? { forceDirectOAuth: true }
              : useBridge
                ? { forceAppsScriptBridge: true }
                : undefined,
      );
      if (!res.ok || !res.data) {
        const msg = res.error || 'Synchronisation failed.';
        setLiveStatusMessage(`Error: ${msg}`);
        onNotify('error', 'Google Sheets sync failed', msg);
        return;
      }

      const refreshedConn = await api.getSheetsConnection();
      if (refreshedConn.ok && refreshedConn.data && refreshedConn.data.connected) {
        onConnectionChanged(refreshedConn.data);
      }
      await onSynced?.();
      if (!isSupabaseMode && resolvedDirectClientId) {
        onEnvironmentChanged?.();
      }
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
      setLiveStatusMessage(
        'Downloaded initialized 10-tab workbook (.xlsx) ready for Google Sheets import.',
      );
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
              {isSupabaseMode ? (
                <Database className="w-4 h-4 text-[#047857]" aria-hidden="true" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-[#137333]" aria-hidden="true" />
              )}
              {isSupabaseMode
                ? 'Step 1 · Supabase PostgreSQL & Webhook Mirror'
                : 'Step 1 · Google Account Authorization'}
            </div>
            <p className="text-sm text-[#0A1B2C]">
              Active administrator:{' '}
              <span className="font-medium">
                {connection?.connectedAccount || user.email}
              </span>
            </p>
            <p className="text-xs text-[#243647]">
              {isSupabaseMode
                ? 'Supabase PostgreSQL is your primary database. Link an existing Google Sheet and optionally provide an Apps Script Web App (/exec) URL to mirror rows via Edge Function google-sheets-sync.'
                : connection?.oauthConfigured && oauthStartUrl
                  ? 'OAuth 2.0 tokens are stored securely on the backend in encrypted HttpOnly cookies.'
                  : api.mode === 'apps_script'
                    ? 'Authenticated via Google Identity Services & Google Apps Script Web App.'
                    : hasSavedBridge
                      ? 'Authenticated via remembered Password & Apps Script Sync Bridge.'
                      : 'Local Storage Mode: choose your target spreadsheet link or download the ready 10-tab workbook (.xlsx) here, then activate Live Sync to write team records directly online.'}
            </p>
          </div>

          {oauthStartUrl && connection?.oauthConfigured && !isSupabaseMode ? (
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
          ) : (
            !isSupabaseMode &&
            !isLiveBackend &&
            api.mode !== 'apps_script' &&
            onOpenSyncSetup && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSyncSetup();
                }}
                className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs font-medium border border-[#0D652D] cursor-pointer shrink-0"
              >
                <GoogleSheetsIcon className="w-3.5 h-3.5" variant="inverted" />
                <span>Activate Live Sync</span>
              </button>
            )
          )}
        </div>

        {!isSupabaseMode && !oauthStartUrl && api.mode !== 'apps_script' && (
          <div className="pt-2 border-t border-[#DFD7C2] space-y-1.5">
            <label
              htmlFor={directClientInputId}
              className="block text-xs font-medium text-[#0A1B2C]"
            >
              Direct Google Sign-In Web Client ID (optional — writes straight to live Google Sheets)
            </label>
            <input
              id={directClientInputId}
              name="modal_direct_google_client_id"
              type="text"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={directClientId}
              placeholder="1234567890-abcdef.apps.googleusercontent.com"
              aria-invalid={directClientError ? 'true' : 'false'}
              aria-describedby={directClientError ? directClientErrId : undefined}
              onChange={(e) => {
                setDirectClientId(e.target.value);
                if (directClientError) {
                  const check = validateGoogleOAuthClientId(e.target.value);
                  setDirectClientError(check.valid || !e.target.value.trim() ? '' : check.error || '');
                }
              }}
              className="ct-input text-xs font-mono"
            />
            {directClientError && (
              <p id={directClientErrId} role="alert" className="text-xs text-[#BE123C]">
                {directClientError}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Active Connection Management Summary when connected */}
      {isConnected && connection && (
        <section
          className={`p-4 rounded-xl bg-[#FFFFFF] border space-y-3 ${
            isSupabaseMode ||
            (!needsDirectReauth &&
              (isLiveBackend ||
                connection.authMethod === 'google_oauth' ||
                (connection.authMethod === 'apps_script' && (isLiveBackend || hasSavedBridge))))
              ? 'border-[#137333]/30'
              : 'border-[#B45309]/35'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[#0A1B2C]">
              {isSupabaseMode ||
              (!needsDirectReauth &&
                (isLiveBackend ||
                  connection.authMethod === 'google_oauth' ||
                  (connection.authMethod === 'apps_script' && (isLiveBackend || hasSavedBridge)))) ? (
                <>
                  <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#188038]" />
                  <CheckCircle2 className="w-4 h-4 text-[#137333]" aria-hidden="true" />
                  <span>Google Sheets Connected</span>
                </>
              ) : needsDirectReauth ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                  <span>Direct Google OAuth Re-authorization Needed</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
                  <span>Target Sheet Selected (Local Storage)</span>
                </>
              )}
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
                <span>{downloadingXlsx ? 'Preparing…' : 'Export 10-Tab Sheet (.xlsx)'}</span>
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

            {isSupabaseMode && (
              <div className="p-3 rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] space-y-2">
                <label
                  htmlFor={webhookInputId}
                  className="block text-xs font-medium text-[#0A1B2C]"
                >
                  Apps Script Web App Webhook URL (/exec) — Optional
                </label>
                <p id={webhookHintId} className="text-[11px] text-[#243647]">
                  Paste a deployed <code className="font-mono">https://script.google.com/macros/s/…/exec</code> URL
                  to mirror rows through Edge Function <code className="font-mono">google-sheets-sync</code>, or
                  leave blank to preserve an already stored webhook.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={webhookInputRef}
                    id={webhookInputId}
                    name="supabase_apps_script_webhook_url"
                    type="url"
                    value={webhookUrl}
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                    aria-invalid={webhookUrlError ? 'true' : 'false'}
                    aria-describedby={
                      webhookUrlError ? `${webhookHintId} ${webhookErrorId}` : webhookHintId
                    }
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setWebhookUrl(nextVal);
                      setWebhookTestResult(null);
                      if (webhookUrlError || webhookUrlTouched) {
                        setWebhookUrlError(nextVal.trim() ? validateWebhookField(nextVal) : '');
                      }
                    }}
                    onBlur={() => {
                      if (!webhookUrl.trim()) {
                        setWebhookUrlError('');
                        return;
                      }
                      setWebhookUrlTouched(true);
                      setWebhookUrlError(validateWebhookField(webhookUrl));
                    }}
                    className="ct-input text-xs font-mono flex-1 min-w-[220px]"
                  />
                  {api.testSheetsWebhook && (
                    <button
                      type="button"
                      disabled={testingWebhook || submitting}
                      onClick={() => void handleTestWebhook()}
                      className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1 shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${testingWebhook ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span>{testingWebhook ? 'Testing…' : 'Test Webhook'}</span>
                    </button>
                  )}
                </div>
                {webhookUrlError && (
                  <p
                    id={webhookErrorId}
                    className="text-xs text-[#BE123C] flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{webhookUrlError}</span>
                  </p>
                )}
                {webhookTestResult && (
                  <div
                    className={`p-2 rounded-lg border text-xs flex items-center gap-1.5 ${
                      webhookTestResult.ok
                        ? 'bg-[#ECFDF5] border-[#047857]/30 text-[#047857]'
                        : 'bg-[#FFF1F2] border-[#BE123C]/35 text-[#BE123C]'
                    }`}
                  >
                    {webhookTestResult.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>{webhookTestResult.message}</span>
                  </div>
                )}
              </div>
            )}

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
                Initialize all 8 official programme database tabs (Sessions, Session Details,
                Facilitators, Schools, Configuration, Admin Users, Audit Log, Sync Log) plus{' '}
                <strong>Summary &amp; KPIs</strong> (live formulas) and{' '}
                <strong>Declarations</strong> (filters &amp; rules) without overwriting existing
                rows.
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
            {isSupabaseMode && (
              <div className="p-3 rounded-xl bg-[#E8F6FF]/80 border border-[#0284C7]/35 text-xs text-[#0A1B2C] space-y-2">
                <p className="leading-relaxed">
                  <strong>Supabase PostgreSQL stores all tables permanently.</strong> Creating brand-new
                  Google Drive spreadsheets from scratch is only available via Google OAuth. To mirror
                  rows to a Google Sheet, paste its link in{' '}
                  <button
                    type="button"
                    onClick={() => setSourceMode('existing')}
                    className="underline font-medium text-[#006BB8] cursor-pointer"
                  >
                    Connect an existing spreadsheet
                  </button>{' '}
                  or supply an Apps Script Web App (/exec) URL below.
                </p>
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label htmlFor={titleInputId} className="text-xs font-medium text-[#0A1B2C]">
                  New Google Spreadsheet Name <span aria-hidden="true">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setTitleManuallyEdited(false);
                    setNewSheetTitle(relativeDefaultTitle);
                    setTitleError('');
                  }}
                  className="inline-flex items-center gap-1 text-xs text-[#137333] hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>Auto relative title</span>
                </button>
              </div>
              <p id={titleHintId} className="text-xs text-[#243647] mb-1.5">
                Creates a new Google Spreadsheet formatted with all 8 Career Tours database tabs
                plus live <strong>Summary &amp; KPIs</strong> and <strong>Declarations</strong>.
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
                  setTitleManuallyEdited(true);
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

            {isSupabaseMode && (
              <div className="p-3 rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] space-y-2">
                <label
                  htmlFor={webhookInputId}
                  className="block text-xs font-medium text-[#0A1B2C]"
                >
                  Apps Script Web App Webhook URL (/exec) <span aria-hidden="true">*</span>
                </label>
                <p id={webhookHintId} className="text-[11px] text-[#243647]">
                  Required when linking via this tab in Supabase mode (
                  <code className="font-mono">https://script.google.com/macros/s/…/exec</code>).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={webhookInputRef}
                    id={webhookInputId}
                    name="supabase_create_apps_script_webhook_url"
                    type="url"
                    required
                    value={webhookUrl}
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                    aria-invalid={webhookUrlError ? 'true' : 'false'}
                    aria-describedby={
                      webhookUrlError ? `${webhookHintId} ${webhookErrorId}` : webhookHintId
                    }
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setWebhookUrl(nextVal);
                      setWebhookTestResult(null);
                      if (webhookUrlError || webhookUrlTouched) {
                        setWebhookUrlError(nextVal.trim() ? validateWebhookField(nextVal) : '');
                      }
                    }}
                    onBlur={() => {
                      if (!webhookUrl.trim()) {
                        setWebhookUrlError('');
                        return;
                      }
                      setWebhookUrlTouched(true);
                      setWebhookUrlError(validateWebhookField(webhookUrl));
                    }}
                    className="ct-input text-xs font-mono flex-1 min-w-[220px]"
                  />
                  {api.testSheetsWebhook && (
                    <button
                      type="button"
                      disabled={testingWebhook || submitting}
                      onClick={() => void handleTestWebhook()}
                      className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1 shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${testingWebhook ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span>{testingWebhook ? 'Testing…' : 'Test Webhook'}</span>
                    </button>
                  )}
                </div>
                {webhookUrlError && (
                  <p
                    id={webhookErrorId}
                    className="text-xs text-[#BE123C] flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{webhookUrlError}</span>
                  </p>
                )}
              </div>
            )}

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
