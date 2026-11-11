import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Link2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Unlink,
} from 'lucide-react';
import type { GoogleSheetsConnectionState, TeamIntakeSetupResponse } from '../../types/domain';
import {
  DEFAULT_TARGET_SPREADSHEET_ID,
  DEFAULT_TARGET_SPREADSHEET_URL,
  parseGoogleSpreadsheetId,
} from '../../config/defaults';
import type { BackendApiClient } from '../../services/apiClient';
import {
  buildPersonalizedAppsScriptBundle,
  ensureCopyCommandListener,
  getCachedAppsScriptTemplate,
  loadAppsScriptTemplate,
  triggerAppsScriptBundleDownload,
} from '../../services/appsScriptTemplate';
import {
  buildTeamShareUrl,
  clearAppsScriptBridgeConfig,
  generateAppsScriptSyncKey,
  getAuthEnvironment,
  loadAppsScriptBridgeConfig,
  probeAppsScriptEndpoint,
  probeSheetsBackendStatus,
  saveRuntimeBackendConfig,
  setRuntimeSheetsBackendUrl,
  validateAppsScriptSyncKey,
  validateAppsScriptWebAppUrl,
  validateGoogleOAuthClientId,
  validateSheetsBackendUrl,
  verifyAppsScriptSandboxBridge,
} from '../../services/authService';
import { buildRelativeSpreadsheetTitle } from '../../services/googleSheetsDirectService';

interface LiveBackendSetupCardProps {
  api?: BackendApiClient;
  isLiveBackend: boolean;
  needsDirectReauth?: boolean;
  hasBuildTimeConfig: boolean;
  isRuntimeConfigured: boolean;
  activeAppsScriptUrl?: string;
  activeGoogleClientId?: string;
  oauthSheetsConnection?: GoogleSheetsConnectionState | null;
  userEmail: string;
  onConnectionChanged?: (next: GoogleSheetsConnectionState) => void;
  onActivated?: (config: { appsScriptUrl: string; googleClientId: string }) => void;
  onAuthorizeNow?: () => void;
  onEnvironmentChanged?: () => void;
  onReset?: () => void;
  onNotify?: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const LiveBackendSetupCard: React.FC<LiveBackendSetupCardProps> = ({
  api,
  isLiveBackend,
  needsDirectReauth = false,
  hasBuildTimeConfig,
  isRuntimeConfigured,
  activeAppsScriptUrl = '',
  activeGoogleClientId = '',
  oauthSheetsConnection = null,
  userEmail,
  onConnectionChanged,
  onActivated,
  onAuthorizeNow,
  onEnvironmentChanged,
  onReset,
  onNotify,
}) => {
  const isSupabaseMode = api?.mode === 'supabase';
  const initialBridge = loadAppsScriptBridgeConfig();
  const [sbSheetUrl, setSbSheetUrl] = useState(
    () => oauthSheetsConnection?.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL,
  );
  const [sbSheetName, setSbSheetName] = useState(
    () => oauthSheetsConnection?.spreadsheetName || 'Career Tours Live Sheet',
  );
  const [sbWebhookUrl, setSbWebhookUrl] = useState('');
  const [sbSheetUrlErr, setSbSheetUrlErr] = useState('');
  const [sbWebhookErr, setSbWebhookErr] = useState('');
  const [sbFeedback, setSbFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [sbBusy, setSbBusy] = useState<'none' | 'test' | 'save' | 'sync' | 'disconnect'>('none');
  const [sbConfirmDisconnect, setSbConfirmDisconnect] = useState(false);

  const [appsScriptUrl, setAppsScriptUrl] = useState(activeAppsScriptUrl);
  const [googleClientId, setGoogleClientId] = useState(activeGoogleClientId);
  const [hostedUrl, setHostedUrl] = useState(() => getAuthEnvironment().sheetsBackendUrl || '/api/sheets');
  const [urlError, setUrlError] = useState('');
  const [clientIdError, setClientIdError] = useState('');
  const [hostedUrlError, setHostedUrlError] = useState('');
  const [probeError, setProbeError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [savingHostedUrl, setSavingHostedUrl] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);

  // Local Sandbox <-> Apps Script Bridge state (keeps remembered local PBKDF2 password sign-in)
  const [bridgeUrl, setBridgeUrl] = useState(() => initialBridge?.appsScriptUrl || '');
  const [bridgeSyncKey, setBridgeSyncKey] = useState(
    () => initialBridge?.syncKey || generateAppsScriptSyncKey(),
  );
  const [bridgeTargetMode, setBridgeTargetMode] = useState<'auto' | 'create' | 'existing'>('auto');
  const [bridgeSheetTitle, setBridgeSheetTitle] = useState(() =>
    buildRelativeSpreadsheetTitle({ programmeName: 'Career Tours' }),
  );
  const [bridgeSheetUrl, setBridgeSheetUrl] = useState(
    () => oauthSheetsConnection?.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL,
  );
  const [bridgeUrlError, setBridgeUrlError] = useState('');
  const [bridgeKeyError, setBridgeKeyError] = useState('');
  const [bridgeTitleError, setBridgeTitleError] = useState('');
  const [bridgeSheetUrlError, setBridgeSheetUrlError] = useState('');
  const [bridgeSubmitError, setBridgeSubmitError] = useState('');
  const [bridgeSubmitting, setBridgeSubmitting] = useState(false);
  const [confirmBridgeDisconnectOpen, setConfirmBridgeDisconnectOpen] = useState(false);
  const [bridgeDisconnecting, setBridgeDisconnecting] = useState(false);
  const [scriptTemplate, setScriptTemplate] = useState(() => getCachedAppsScriptTemplate() || '');
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptLoadError, setScriptLoadError] = useState('');
  const [teamIntakeSetup, setTeamIntakeSetup] = useState<TeamIntakeSetupResponse | null>(null);
  const [rotatingIntakeKey, setRotatingIntakeKey] = useState(false);

  const bridgeUrlRef = useRef<HTMLInputElement>(null);
  const bridgeKeyRef = useRef<HTMLInputElement>(null);
  const bridgeTitleRef = useRef<HTMLInputElement>(null);
  const bridgeSheetUrlRef = useRef<HTMLInputElement>(null);
  const sbSheetUrlRef = useRef<HTMLInputElement>(null);
  const sbWebhookRef = useRef<HTMLInputElement>(null);

  const urlInputId = useId();
  const urlHintId = useId();
  const urlErrId = useId();
  const clientInputId = useId();
  const clientHintId = useId();
  const clientErrId = useId();
  const hostedUrlInputId = useId();
  const hostedUrlErrId = useId();
  const bridgeUrlInputId = useId();
  const bridgeUrlHintId = useId();
  const bridgeUrlErrId = useId();
  const bridgeKeyInputId = useId();
  const bridgeKeyHintId = useId();
  const bridgeKeyErrId = useId();
  const bridgeTitleInputId = useId();
  const bridgeTitleErrId = useId();
  const bridgeSheetUrlInputId = useId();
  const bridgeSheetUrlErrId = useId();
  const bridgeScriptCodeId = useId();
  const bridgeShareCodeId = useId();
  const oauthShareCodeId = useId();
  const sbSheetUrlId = useId();
  const sbSheetUrlHintId = useId();
  const sbSheetUrlErrId = useId();
  const sbSheetNameId = useId();
  const sbWebhookId = useId();
  const sbWebhookHintId = useId();
  const sbWebhookErrId = useId();

  useEffect(() => ensureCopyCommandListener(), []);

  useEffect(() => {
    if (!isSupabaseMode || !oauthSheetsConnection) return;
    if (oauthSheetsConnection.spreadsheetUrl) {
      setSbSheetUrl(oauthSheetsConnection.spreadsheetUrl);
    }
    if (oauthSheetsConnection.spreadsheetName) {
      setSbSheetName(oauthSheetsConnection.spreadsheetName);
    }
  }, [
    isSupabaseMode,
    oauthSheetsConnection?.spreadsheetName,
    oauthSheetsConnection?.spreadsheetUrl,
  ]);

  useEffect(() => {
    if (!api?.getTeamIntakeSetup) return;
    let active = true;
    void api.getTeamIntakeSetup().then((res) => {
      if (active && res.ok && res.data) {
        setTeamIntakeSetup(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [api, oauthSheetsConnection?.lastSyncedAt, oauthSheetsConnection?.connected]);

  const ensureScriptLoaded = async (): Promise<string> => {
    if (scriptTemplate) return scriptTemplate;
    setScriptLoading(true);
    setScriptLoadError('');
    try {
      const raw = await loadAppsScriptTemplate();
      setScriptTemplate(raw);
      return raw;
    } catch {
      const msg = 'Could not load the CareerToursAllInOne.gs template bundle in this browser.';
      setScriptLoadError(msg);
      return '';
    } finally {
      setScriptLoading(false);
    }
  };

  const normalizedValidSyncKey = useMemo(() => {
    const check = validateAppsScriptSyncKey(bridgeSyncKey);
    return check.valid ? check.normalized : '';
  }, [bridgeSyncKey]);

  const personalizedScript = useMemo(() => {
    if (!scriptTemplate) return '';
    return buildPersonalizedAppsScriptBundle(
      scriptTemplate,
      normalizedValidSyncKey,
      teamIntakeSetup?.intakeKey,
    );
  }, [normalizedValidSyncKey, scriptTemplate, teamIntakeSetup?.intakeKey]);

  const handleDownloadBridgeScript = async () => {
    const raw = await ensureScriptLoaded();
    if (!raw) return;
    const personalized = buildPersonalizedAppsScriptBundle(
      raw,
      normalizedValidSyncKey,
      teamIntakeSetup?.intakeKey,
    );
    triggerAppsScriptBundleDownload(personalized, 'CareerToursAllInOne.gs');
    onNotify?.(
      'success',
      'Downloaded CareerToursAllInOne.gs',
      normalizedValidSyncKey
        ? 'Your Sync Passphrase is pre-filled inside the script. Paste it into script.google.com and run setupForLocalSandbox() once.'
        : 'Paste into script.google.com and run setupForLocalSandbox("YOUR-PASSPHRASE") once.',
    );
  };

  const originLabel =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://vidhyavidhai.roosstudiox.com';

  const handleActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProbeError('');

    const uCheck = validateAppsScriptWebAppUrl(appsScriptUrl);
    const cCheck = validateGoogleOAuthClientId(googleClientId);
    setUrlError(uCheck.valid ? '' : uCheck.error || 'Invalid Web App URL.');
    setClientIdError(cCheck.valid ? '' : cCheck.error || 'Invalid Google Client ID.');

    if (!uCheck.valid || !cCheck.valid) {
      return;
    }

    setSubmitting(true);
    try {
      const probe = await probeAppsScriptEndpoint(uCheck.normalized);
      if (!probe.ok) {
        const msg =
          probe.error ||
          'Unable to verify the Google Apps Script Web App URL. Please confirm deployment settings.';
        setProbeError(msg);
        onNotify?.('error', 'Live backend verification failed', msg);
        return;
      }

      saveRuntimeBackendConfig({
        appsScriptUrl: uCheck.normalized,
        googleClientId: cCheck.normalized,
        configuredBy: userEmail,
      });

      onActivated?.({
        appsScriptUrl: uCheck.normalized,
        googleClientId: cCheck.normalized,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyBuildSnippet = async () => {
    const cleanUrl = appsScriptUrl.trim() || activeAppsScriptUrl;
    const cleanId = googleClientId.trim() || activeGoogleClientId;
    const block = [
      `VITE_APPS_SCRIPT_URL=${cleanUrl}`,
      `VITE_GOOGLE_CLIENT_ID=${cleanId}`,
      'VITE_PROGRAMME_TIMEZONE=Asia/Kolkata',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(block);
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2200);
    } catch {
      onNotify?.('warning', 'Copy unavailable', 'Select and copy the fields manually.');
    }
  };

  const handleSaveHostedUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateSheetsBackendUrl(hostedUrl);
    if (!check.valid) {
      setHostedUrlError(check.error || 'Enter a valid hosted /api/sheets URL.');
      return;
    }
    setHostedUrlError('');
    setSavingHostedUrl(true);
    try {
      setRuntimeSheetsBackendUrl(check.normalized, true);
      onEnvironmentChanged?.();
      const probe = await probeSheetsBackendStatus(check.normalized);
      if (!probe.available) {
        setHostedUrlError(
          `Backend endpoint at ${check.normalized} was not reachable. Deploy /api/sheets on Vercel or use Direct Google Sign-In.`,
        );
        return;
      }
      onNotify?.(
        'success',
        'Hosted Sheets backend saved',
        probe.connection?.oauthConfigured
          ? `Connected to ${check.normalized}.`
          : `Reached ${check.normalized}; configure OAuth env vars or use Direct Google Sign-In.`,
      );
    } finally {
      setSavingHostedUrl(false);
    }
  };

  const savedBridge = loadAppsScriptBridgeConfig();
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
      Boolean(savedBridge),
  );

  const handleBridgeConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBridgeSubmitError('');

    const uCheck = validateAppsScriptWebAppUrl(bridgeUrl);
    const kCheck = validateAppsScriptSyncKey(bridgeSyncKey);
    const titleErr =
      bridgeTargetMode === 'create' && bridgeSheetTitle.trim().length < 3
        ? 'Spreadsheet name must be at least 3 characters.'
        : '';
    const sheetErr =
      bridgeTargetMode === 'existing' && !parseGoogleSpreadsheetId(bridgeSheetUrl)
        ? 'Enter a valid Google Spreadsheet URL or Spreadsheet ID.'
        : '';

    setBridgeUrlError(uCheck.valid ? '' : uCheck.error || 'Enter a valid Apps Script /exec URL.');
    setBridgeKeyError(
      kCheck.valid ? '' : kCheck.error || 'Enter a Sync Passphrase (minimum 16 characters).',
    );
    setBridgeTitleError(titleErr);
    setBridgeSheetUrlError(sheetErr);

    if (!uCheck.valid) {
      bridgeUrlRef.current?.focus();
      return;
    }
    if (!kCheck.valid) {
      bridgeKeyRef.current?.focus();
      return;
    }
    if (titleErr) {
      bridgeTitleRef.current?.focus();
      return;
    }
    if (sheetErr) {
      bridgeSheetUrlRef.current?.focus();
      return;
    }

    setBridgeSubmitting(true);
    try {
      if (api?.connectAppsScriptBridge) {
        const res = await api.connectAppsScriptBridge({
          appsScriptUrl: uCheck.normalized,
          syncKey: kCheck.normalized,
          targetMode: bridgeTargetMode,
          sheetTitle: bridgeTargetMode === 'create' ? bridgeSheetTitle.trim() : undefined,
          spreadsheetUrlOrId:
            bridgeTargetMode === 'existing' ? bridgeSheetUrl.trim() : undefined,
          initializeSchema: true,
        });
        if (!res.ok || !res.data) {
          const msg = res.error || 'Unable to connect via Apps Script Sync Bridge.';
          setBridgeSubmitError(msg);
          onNotify?.('error', 'Apps Script Sync Bridge connection failed', msg);
          return;
        }
        onConnectionChanged?.(res.data.connection);
        onEnvironmentChanged?.();
        if (api.getTeamIntakeSetup) {
          void api.getTeamIntakeSetup().then((intakeRes) => {
            if (intakeRes.ok && intakeRes.data) {
              setTeamIntakeSetup(intakeRes.data);
            }
          });
        }
        onNotify?.(
          'success',
          'Apps Script Sync Bridge connected',
          res.data.syncSummary?.message ||
            `Live Google Sheets sync active for "${res.data.connection.spreadsheetName}".`,
        );
        return;
      }

      const verifyRes = await verifyAppsScriptSandboxBridge({
        appsScriptUrl: uCheck.normalized,
        syncKey: kCheck.normalized,
        actorEmail: userEmail,
      });
      if (!verifyRes.ok || !verifyRes.connection) {
        const msg = verifyRes.error || 'Unable to verify Apps Script Sync Bridge.';
        setBridgeSubmitError(msg);
        onNotify?.('error', 'Apps Script Sync Bridge connection failed', msg);
        return;
      }
      onConnectionChanged?.(verifyRes.connection);
      onEnvironmentChanged?.();
      onNotify?.(
        'success',
        'Apps Script Bridge verified',
        `Connected "${verifyRes.connection.spreadsheetName}".`,
      );
    } finally {
      setBridgeSubmitting(false);
    }
  };

  const handleDisconnectBridge = async () => {
    setBridgeDisconnecting(true);
    try {
      clearAppsScriptBridgeConfig();
      if (api) {
        const res = await api.disconnectGoogleSheet();
        if (res.ok && res.data) {
          onConnectionChanged?.(res.data);
        }
      }
      setConfirmBridgeDisconnectOpen(false);
      onEnvironmentChanged?.();
      onNotify?.(
        'success',
        'Apps Script Bridge disconnected',
        'Existing data in your Google Sheet remains safely preserved.',
      );
    } finally {
      setBridgeDisconnecting(false);
    }
  };

  const handleRotateIntakeKey = async () => {
    if (!api?.rotateTeamIntakeKey || rotatingIntakeKey) return;
    setRotatingIntakeKey(true);
    try {
      const res = await api.rotateTeamIntakeKey();
      if (!res.ok || !res.data) {
        onNotify?.('error', 'Could not rotate Team Submission Link', res.error);
        return;
      }
      setTeamIntakeSetup(res.data);
      onNotify?.(
        'success',
        'Team Submission Link rotated',
        'Share the new link with facilitators. Older links are now revoked.',
      );
    } finally {
      setRotatingIntakeKey(false);
    }
  };

  const bridgeShareUrl = useMemo(() => {
    if (!savedBridge?.appsScriptUrl || !teamIntakeSetup?.intakeKey) return '';
    try {
      return buildTeamShareUrl({
        mode: 'intake',
        appsScriptUrl: savedBridge.appsScriptUrl,
        intakeKey: teamIntakeSetup.intakeKey,
      });
    } catch {
      return '';
    }
  }, [savedBridge?.appsScriptUrl, teamIntakeSetup?.intakeKey]);

  const oauthShareUrl = useMemo(() => {
    if (!activeAppsScriptUrl || !activeGoogleClientId) return '';
    try {
      return buildTeamShareUrl({
        mode: 'oauth',
        appsScriptUrl: activeAppsScriptUrl,
        googleClientId: activeGoogleClientId,
      });
    } catch {
      return '';
    }
  }, [activeAppsScriptUrl, activeGoogleClientId]);

  const bridgeSetupSection = (
    <div className="p-4 rounded-xl bg-[#FAF8F2] border border-[#137333]/30 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#0A1B2C]">
            <Sparkles className="w-4 h-4 text-[#137333]" aria-hidden="true" />
            <span>Option A · Connect This Device via Apps Script Sync Bridge (Recommended)</span>
          </div>
          <p className="text-[11px] sm:text-xs text-[#243647] leading-relaxed">
            Keep remembered password sign-in while every classroom session, edit, school, and tab
            syncs live into Google Sheets through your Apps Script Web App.
          </p>
        </div>
      </div>

      <ol className="p-3 rounded-xl bg-[#FFFFFF] border border-[#DFD7C2] space-y-1.5 text-[11px] sm:text-xs text-[#243647] list-decimal pl-5 leading-relaxed">
        <li>
          Generate a Sync Passphrase below, then expand{' '}
          <strong className="font-medium text-[#0A1B2C]">
            Copy or Download Apps Script (CareerToursAllInOne.gs)
          </strong>{' '}
          and paste or upload it into{' '}
          <strong className="font-medium text-[#0A1B2C]">script.google.com</strong> (or{' '}
          <em>Extensions → Apps Script</em> on your target sheet).
        </li>
        <li>
          Run function <code className="font-mono text-[#006BB8]">setupForLocalSandbox</code> once in
          the Apps Script editor, then deploy via{' '}
          <strong className="font-medium text-[#0A1B2C]">Deploy → New deployment → Web app</strong>{' '}
          (<strong className="font-medium text-[#0A1B2C]">Execute as: Me</strong>,{' '}
          <strong className="font-medium text-[#0A1B2C]">Who has access: Anyone</strong>).
        </li>
        <li>
          Paste your deployed <code className="font-mono text-[#006BB8]">/exec</code> URL below and
          click <strong className="font-medium text-[#0A1B2C]">Connect Apps Script Sync Bridge</strong>.
        </li>
      </ol>

      <details
        className="rounded-xl bg-[#FFFFFF] border border-[#DFD7C2] p-3 text-xs text-[#243647]"
        onToggle={(e) => {
          if (e.currentTarget.open) {
            void ensureScriptLoaded();
          }
        }}
      >
        <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#137333]">
          Copy or Download Apps Script (CareerToursAllInOne.gs)
        </summary>
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#33475B]">
              {normalizedValidSyncKey
                ? 'Your current Sync Passphrase is pre-filled inside this ready-to-paste Apps Script file.'
                : 'Enter or generate a 16+ character passphrase below so it is embedded automatically.'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="ct-copy-wrap">
                <button
                  type="button"
                  className="ct-btn-secondary ct-copy-btn text-xs min-h-[28px] px-2.5 py-1"
                  {...({ command: '--copy', commandfor: bridgeScriptCodeId } as Record<
                    string,
                    string
                  >)}
                >
                  <span className="ct-copy-icon-idle inline-flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Apps Script</span>
                  </span>
                  <span className="ct-copy-icon-done inline-flex items-center gap-1.5 text-[#137333]">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copied</span>
                  </span>
                </button>
                <span
                  className="ct-copy-status text-[11px] font-medium text-[#137333]"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                />
              </span>
              <button
                type="button"
                onClick={() => void handleDownloadBridgeScript()}
                disabled={scriptLoading}
                className="ct-btn-secondary text-xs min-h-[28px] px-2.5 py-1"
              >
                <Download className="w-3.5 h-3.5 text-[#137333]" aria-hidden="true" />
                <span>Download CareerToursAllInOne.gs</span>
              </button>
            </div>
          </div>

          {scriptLoadError ? (
            <p className="text-xs text-[#BE123C]">{scriptLoadError}</p>
          ) : (
            <div className="w-full overflow-hidden rounded-lg border border-[#DFD7C2] bg-[#FAF8F2]">
              <pre
                tabIndex={0}
                className="max-h-48 w-full overflow-auto p-3 text-[11px] font-mono text-[#0A1B2C] leading-relaxed"
              >
                <code id={bridgeScriptCodeId}>
                  {scriptLoading
                    ? '// Loading CareerToursAllInOne.gs bundle…'
                    : personalizedScript || '// Open to load CareerToursAllInOne.gs'}
                </code>
              </pre>
            </div>
          )}
        </div>
      </details>

      <form onSubmit={(e) => void handleBridgeConnectSubmit(e)} noValidate className="space-y-3">
        {bridgeSubmitError && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#BE123C] flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{bridgeSubmitError}</span>
          </div>
        )}

        <div>
          <label htmlFor={bridgeKeyInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
            Sync Bridge Passphrase <span aria-hidden="true">*</span>
          </label>
          <p id={bridgeKeyHintId} className="text-[11px] text-[#33475B] mb-1.5">
            Shared passphrase between this browser and Apps Script Script Properties (16+ characters,
            no spaces). Never written to any sheet cell.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={bridgeKeyRef}
              id={bridgeKeyInputId}
              name="apps_script_bridge_sync_key"
              type="text"
              required
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={bridgeSyncKey}
              placeholder="VV-SYNC-..."
              aria-invalid={Boolean(bridgeKeyError)}
              aria-describedby={
                bridgeKeyError ? `${bridgeKeyHintId} ${bridgeKeyErrId}` : bridgeKeyHintId
              }
              onChange={(e) => {
                const v = e.target.value;
                setBridgeSyncKey(v);
                setBridgeSubmitError('');
                if (bridgeKeyError) {
                  const check = validateAppsScriptSyncKey(v);
                  setBridgeKeyError(check.valid ? '' : check.error || '');
                }
              }}
              onBlur={() => {
                if (!bridgeSyncKey.trim()) return;
                const check = validateAppsScriptSyncKey(bridgeSyncKey);
                setBridgeKeyError(check.valid ? '' : check.error || '');
              }}
              className="ct-input text-xs font-mono flex-1 min-w-[200px]"
            />
            <button
              type="button"
              onClick={() => {
                const nextKey = generateAppsScriptSyncKey();
                setBridgeSyncKey(nextKey);
                setBridgeKeyError('');
              }}
              className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1 shrink-0"
            >
              Generate Passphrase
            </button>
          </div>
          {bridgeKeyError && (
            <p id={bridgeKeyErrId} className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{bridgeKeyError}</span>
            </p>
          )}
        </div>

        <div>
          <label htmlFor={bridgeUrlInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
            Bridge Apps Script Web App URL (/exec) <span aria-hidden="true">*</span>
          </label>
          <p id={bridgeUrlHintId} className="text-[11px] text-[#33475B] mb-1.5">
            Deployed Apps Script endpoint starting with{' '}
            <code className="font-mono">https://script.google.com/macros/s/</code> and ending in{' '}
            <code className="font-mono">/exec</code>.
          </p>
          <input
            ref={bridgeUrlRef}
            id={bridgeUrlInputId}
            name="apps_script_bridge_web_app_url"
            type="url"
            required
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={bridgeUrl}
            placeholder="https://script.google.com/macros/s/AKfycb.../exec"
            aria-invalid={Boolean(bridgeUrlError)}
            aria-describedby={
              bridgeUrlError ? `${bridgeUrlHintId} ${bridgeUrlErrId}` : bridgeUrlHintId
            }
            onChange={(e) => {
              const v = e.target.value;
              setBridgeUrl(v);
              setBridgeSubmitError('');
              if (bridgeUrlError) {
                const check = validateAppsScriptWebAppUrl(v);
                setBridgeUrlError(check.valid ? '' : check.error || '');
              }
            }}
            onBlur={() => {
              if (!bridgeUrl.trim()) return;
              const check = validateAppsScriptWebAppUrl(bridgeUrl);
              setBridgeUrlError(check.valid ? '' : check.error || '');
            }}
            className="ct-input text-xs sm:text-sm font-mono"
          />
          {bridgeUrlError && (
            <p id={bridgeUrlErrId} className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{bridgeUrlError}</span>
            </p>
          )}
        </div>

        <fieldset className="p-3 rounded-xl bg-[#FFFFFF] border border-[#DFD7C2] space-y-2">
          <legend className="px-1 text-xs font-medium text-[#0A1B2C]">Target Google Spreadsheet</legend>
          <div className="flex flex-wrap gap-2 text-xs">
            {(
              [
                ['auto', 'Script default / Official sheet'],
                ['create', 'Create new sheet (Relative title)'],
                ['existing', 'Existing Google Sheet URL / ID'],
              ] as const
            ).map(([mode, label]) => (
              <label
                key={mode}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                  bridgeTargetMode === mode
                    ? 'bg-[#E6F4EA] border-[#137333] text-[#0A1B2C] font-medium'
                    : 'bg-[#FAF8F2] border-[#DFD7C2] text-[#243647]'
                }`}
              >
                <input
                  type="radio"
                  name="bridge_target_mode"
                  value={mode}
                  checked={bridgeTargetMode === mode}
                  onChange={() => {
                    setBridgeTargetMode(mode);
                    setBridgeTitleError('');
                    setBridgeSheetUrlError('');
                  }}
                  className="w-3.5 h-3.5 accent-[#137333]"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {bridgeTargetMode === 'create' && (
            <div>
              <label htmlFor={bridgeTitleInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
                New Spreadsheet Title <span aria-hidden="true">*</span>
              </label>
              <input
                ref={bridgeTitleRef}
                id={bridgeTitleInputId}
                name="bridge_new_sheet_title"
                type="text"
                required
                minLength={3}
                value={bridgeSheetTitle}
                aria-invalid={Boolean(bridgeTitleError)}
                aria-describedby={bridgeTitleError ? bridgeTitleErrId : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setBridgeSheetTitle(v);
                  if (bridgeTitleError && v.trim().length >= 3) setBridgeTitleError('');
                }}
                onBlur={() => {
                  if (!bridgeSheetTitle.trim()) return;
                  setBridgeTitleError(
                    bridgeSheetTitle.trim().length < 3
                      ? 'Spreadsheet name must be at least 3 characters.'
                      : '',
                  );
                }}
                className="ct-input text-xs"
              />
              {bridgeTitleError && (
                <p id={bridgeTitleErrId} className="mt-1 text-xs text-[#BE123C]">
                  {bridgeTitleError}
                </p>
              )}
            </div>
          )}

          {bridgeTargetMode === 'existing' && (
            <div>
              <label htmlFor={bridgeSheetUrlInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
                Google Sheet URL or ID <span aria-hidden="true">*</span>
              </label>
              <input
                ref={bridgeSheetUrlRef}
                id={bridgeSheetUrlInputId}
                name="bridge_existing_sheet_url"
                type="text"
                required
                value={bridgeSheetUrl}
                aria-invalid={Boolean(bridgeSheetUrlError)}
                aria-describedby={bridgeSheetUrlError ? bridgeSheetUrlErrId : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setBridgeSheetUrl(v);
                  if (bridgeSheetUrlError && parseGoogleSpreadsheetId(v)) setBridgeSheetUrlError('');
                }}
                onBlur={() => {
                  if (!bridgeSheetUrl.trim()) return;
                  setBridgeSheetUrlError(
                    parseGoogleSpreadsheetId(bridgeSheetUrl)
                      ? ''
                      : 'Enter a valid Google Spreadsheet URL or Spreadsheet ID.',
                  );
                }}
                placeholder={DEFAULT_TARGET_SPREADSHEET_URL}
                className="ct-input text-xs font-mono"
              />
              {bridgeSheetUrlError && (
                <p id={bridgeSheetUrlErrId} className="mt-1 text-xs text-[#BE123C]">
                  {bridgeSheetUrlError}
                </p>
              )}
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="submit"
            disabled={bridgeSubmitting}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
          >
            {bridgeSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Connecting Apps Script Bridge…</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                <span>Connect Apps Script Sync Bridge</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );

  const appsScriptSetupBody = (
    <>
      <ol className="p-3.5 rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] space-y-2 text-xs text-[#243647] list-decimal pl-6 leading-relaxed">
        <li>
          Open your target spreadsheet (ID:{' '}
          <span className="font-mono text-[#0A1B2C]">{DEFAULT_TARGET_SPREADSHEET_ID}</span>) → click{' '}
          <strong className="font-medium text-[#0A1B2C]">Extensions → Apps Script</strong>, copy in
          the project <code className="font-mono text-[#006BB8]">apps-script/</code> files, set Script
          Property <code className="font-mono text-[#006BB8]">GOOGLE_CLIENT_ID</code>, and choose{' '}
          <strong className="font-medium text-[#0A1B2C]">Deploy → New deployment → Web app</strong>{' '}
          (<strong className="font-medium text-[#0A1B2C]">Execute as: Me</strong>,{' '}
          <strong className="font-medium text-[#0A1B2C]">Who has access: Anyone</strong>).
        </li>
        <li>
          In Google Cloud Console → <strong className="font-medium text-[#0A1B2C]">Credentials</strong>
          , create an <strong className="font-medium text-[#0A1B2C]">OAuth 2.0 Web Client ID</strong>{' '}
          with Authorized JavaScript origin <code className="font-mono text-[#006BB8]">{originLabel}</code>{' '}
          and Redirect URI <code className="font-mono text-[#006BB8]">{`${originLabel}/auth/callback`}</code>.
        </li>
        <li>
          Paste those two public values below and click{' '}
          <strong className="font-medium text-[#0A1B2C]">Verify &amp; Activate Live Google Sync</strong>
          . On your first Google Sign-In, the 10-tab sheet initializes automatically.
        </li>
      </ol>

      <form onSubmit={(e) => void handleActivateSubmit(e)} noValidate className="space-y-3.5">
        {probeError && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#BE123C] flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{probeError}</span>
          </div>
        )}

        <div>
          <label htmlFor={urlInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
            Google Apps Script Web App URL <span aria-hidden="true">*</span>
          </label>
          <p id={urlHintId} className="text-[11px] text-[#33475B] mb-1.5">
            Must start with <code className="font-mono">https://script.google.com/macros/s/</code>{' '}
            and end cleanly in <code className="font-mono">/exec</code>.
          </p>
          <input
            id={urlInputId}
            name="apps_script_web_app_url"
            type="url"
            required
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={appsScriptUrl}
            placeholder="https://script.google.com/macros/s/AKfycb.../exec"
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? `${urlHintId} ${urlErrId}` : urlHintId}
            onChange={(e) => {
              const v = e.target.value;
              setAppsScriptUrl(v);
              setProbeError('');
              if (urlError) {
                const check = validateAppsScriptWebAppUrl(v);
                setUrlError(check.valid ? '' : check.error || '');
              }
            }}
            onBlur={() => {
              if (!appsScriptUrl.trim()) return;
              const check = validateAppsScriptWebAppUrl(appsScriptUrl);
              setUrlError(check.valid ? '' : check.error || '');
            }}
            className="ct-input text-xs sm:text-sm font-mono"
          />
          {urlError && (
            <p id={urlErrId} role="alert" className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{urlError}</span>
            </p>
          )}
        </div>

        <div>
          <label htmlFor={clientInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
            Google Sign-In OAuth Web Client ID <span aria-hidden="true">*</span>
          </label>
          <p id={clientHintId} className="text-[11px] text-[#33475B] mb-1.5">
            Public identifier ending in <code className="font-mono">.apps.googleusercontent.com</code>{' '}
            — never enter any Client Secret or private key.
          </p>
          <input
            id={clientInputId}
            name="google_oauth_client_id"
            type="text"
            required
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={googleClientId}
            placeholder="1234567890-abcdef.apps.googleusercontent.com"
            aria-invalid={Boolean(clientIdError)}
            aria-describedby={clientIdError ? `${clientHintId} ${clientErrId}` : clientHintId}
            onChange={(e) => {
              const v = e.target.value;
              setGoogleClientId(v);
              if (clientIdError) {
                const check = validateGoogleOAuthClientId(v);
                setClientIdError(check.valid ? '' : check.error || '');
              }
            }}
            onBlur={() => {
              if (!googleClientId.trim()) return;
              const check = validateGoogleOAuthClientId(googleClientId);
              setClientIdError(check.valid ? '' : check.error || '');
            }}
            className="ct-input text-xs sm:text-sm font-mono"
          />
          {clientIdError && (
            <p id={clientErrId} role="alert" className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{clientIdError}</span>
            </p>
          )}
        </div>

        <div className="p-2.5 rounded-lg bg-[#E8F6FF]/70 border border-[#0284C7]/30 text-[11px] text-[#243647] flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-[#006BB8] shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Zero secrets are stored here. Access is verified on Google Apps Script servers on every
            request using signed Google ID tokens, and restricted exclusively to approved accounts.
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Verifying Web App…</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                <span>Verify &amp; Activate Live Google Sync</span>
              </>
            )}
          </button>
        </div>
      </form>

      <details className="pt-2 border-t border-[#DFD7C2] text-xs text-[#243647]">
        <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#006BB8]">
          Publish permanently for all facilitators &amp; devices
        </summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            Activating above connects this browser right away so you can test with your live Google
            Sheet. To make all team phones and laptops open straight into live Google Sign-In
            automatically, copy these build settings when publishing the site bundle:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyBuildSnippet()}
              className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
            >
              {copiedEnv ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                  <span>Copied Build Config</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copy Build Config</span>
                </>
              )}
            </button>
          </div>
        </div>
      </details>

      <details className="pt-2 border-t border-[#DFD7C2] text-xs text-[#243647]">
        <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#006BB8]">
          Or configure hosted /api/sheets backend URL
        </summary>
        <form onSubmit={(e) => void handleSaveHostedUrl(e)} noValidate className="mt-2.5 space-y-2.5">
          <div>
            <label htmlFor={hostedUrlInputId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
              Hosted /api/sheets Endpoint URL
            </label>
            <input
              id={hostedUrlInputId}
              name="hosted_sheets_backend_url"
              type="text"
              value={hostedUrl}
              placeholder="/api/sheets"
              aria-invalid={hostedUrlError ? 'true' : 'false'}
              aria-describedby={hostedUrlError ? hostedUrlErrId : undefined}
              onChange={(e) => {
                setHostedUrl(e.target.value);
                if (hostedUrlError) {
                  const check = validateSheetsBackendUrl(e.target.value);
                  setHostedUrlError(check.valid ? '' : check.error || '');
                }
              }}
              className="ct-input text-xs font-mono"
            />
            {hostedUrlError && (
              <p id={hostedUrlErrId} role="alert" className="mt-1 text-xs text-[#BE123C]">
                {hostedUrlError}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={savingHostedUrl}
            className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
          >
            {savingHostedUrl ? 'Checking /api/sheets…' : 'Save & Check /api/sheets URL'}
          </button>
        </form>
      </details>
    </>
  );

  if (isSupabaseMode && api) {
    const parsedSbSheetId = parseGoogleSpreadsheetId(sbSheetUrl);

    const validateSbSheetUrlField = (val: string): string => {
      if (!val.trim()) {
        return 'Error: Enter a Google Spreadsheet URL or ID.';
      }
      if (!parseGoogleSpreadsheetId(val)) {
        return 'Error: Enter a valid Google Sheets URL (https://docs.google.com/spreadsheets/d/...) or Spreadsheet ID.';
      }
      return '';
    };

    const validateSbWebhookField = (val: string): string => {
      const trimmed = val.trim();
      if (!trimmed) return '';
      const check = validateAppsScriptWebAppUrl(trimmed);
      return check.valid
        ? ''
        : `Error: ${check.error || 'Enter a valid HTTPS Google Apps Script /exec URL.'}`;
    };

    const handleSbTestWebhook = async () => {
      const targetUrl = sbWebhookUrl.trim();
      if (!targetUrl) {
        const msg = 'Error: Enter your Apps Script Web App (/exec) URL to test connectivity.';
        setSbWebhookErr(msg);
        sbWebhookRef.current?.focus();
        return;
      }
      const err = validateSbWebhookField(targetUrl);
      setSbWebhookErr(err);
      if (err) {
        sbWebhookRef.current?.focus();
        return;
      }
      if (!api.testSheetsWebhook) return;
      setSbBusy('test');
      setSbFeedback(null);
      try {
        const res = await api.testSheetsWebhook(
          targetUrl,
          parsedSbSheetId || DEFAULT_TARGET_SPREADSHEET_ID,
        );
        if (!res.ok || !res.data) {
          const msg = res.error || 'Apps Script webhook probe failed.';
          setSbFeedback({ ok: false, text: msg });
          onNotify?.('error', 'Webhook test failed', msg);
          return;
        }
        setSbFeedback({ ok: res.data.reachable, text: res.data.message });
        onNotify?.(
          res.data.reachable ? 'success' : 'warning',
          'Apps Script webhook tested',
          res.data.message,
        );
      } finally {
        setSbBusy('none');
      }
    };

    const handleSbSaveMirror = async (e: React.FormEvent) => {
      e.preventDefault();
      setSbFeedback(null);
      const sheetErr = validateSbSheetUrlField(sbSheetUrl);
      const hookErr = validateSbWebhookField(sbWebhookUrl);
      setSbSheetUrlErr(sheetErr);
      setSbWebhookErr(hookErr);
      if (sheetErr) {
        sbSheetUrlRef.current?.focus();
        return;
      }
      if (hookErr) {
        sbWebhookRef.current?.focus();
        return;
      }

      setSbBusy('save');
      try {
        const res = await api.connectGoogleSheet({
          spreadsheetUrlOrId: sbSheetUrl.trim(),
          spreadsheetName: sbSheetName.trim() || undefined,
          googleAccount: userEmail,
          ...(sbWebhookUrl.trim() ? { appsScriptUrl: sbWebhookUrl.trim() } : {}),
        });
        if (!res.ok || !res.data) {
          const msg = res.error || 'Failed to save Google Sheets mirror configuration.';
          setSbFeedback({ ok: false, text: msg });
          onNotify?.('error', 'Mirror configuration failed', msg);
          return;
        }

        onConnectionChanged?.(res.data);
        const syncRes = await api.syncAllToGoogleSheet(
          sbWebhookUrl.trim() ? { appsScriptUrl: sbWebhookUrl.trim() } : undefined,
        );
        if (syncRes.ok && syncRes.data) {
          const latest = await api.getSheetsConnection();
          if (latest.ok && latest.data) {
            onConnectionChanged?.(latest.data);
          }
          setSbFeedback({ ok: true, text: syncRes.data.message });
          onNotify?.('success', 'Google Sheets mirror updated', syncRes.data.message);
        } else {
          const detail = sbWebhookUrl.trim()
            ? `Saved spreadsheet link in Supabase, but webhook push returned: ${syncRes.error || 'Check Web App deployment.'}`
            : `Linked "${res.data.spreadsheetName}" in Supabase PostgreSQL. Add and test an Apps Script /exec URL to push rows automatically.`;
          setSbFeedback({ ok: true, text: detail });
          onNotify?.(
            sbWebhookUrl.trim() ? 'warning' : 'success',
            'Google Sheets mirror settings saved',
            detail,
          );
        }
        onEnvironmentChanged?.();
      } finally {
        setSbBusy('none');
      }
    };

    const handleSbSyncNow = async () => {
      const hookErr = validateSbWebhookField(sbWebhookUrl);
      setSbWebhookErr(hookErr);
      if (hookErr) {
        sbWebhookRef.current?.focus();
        return;
      }
      setSbBusy('sync');
      setSbFeedback(null);
      try {
        const res = await api.syncAllToGoogleSheet(
          sbWebhookUrl.trim() ? { appsScriptUrl: sbWebhookUrl.trim() } : undefined,
        );
        if (!res.ok || !res.data) {
          const msg = res.error || 'Failed to push records to Google Sheets webhook.';
          setSbFeedback({ ok: false, text: msg });
          onNotify?.('error', 'Google Sheets sync failed', msg);
          return;
        }
        const latest = await api.getSheetsConnection();
        if (latest.ok && latest.data) {
          onConnectionChanged?.(latest.data);
        }
        setSbFeedback({ ok: true, text: res.data.message });
        onNotify?.('success', 'Google Sheets mirror synced', res.data.message);
      } finally {
        setSbBusy('none');
      }
    };

    const handleSbDisconnect = async () => {
      setSbBusy('disconnect');
      try {
        const res = await api.disconnectGoogleSheet();
        if (!res.ok || !res.data) {
          const msg = res.error || 'Failed to disconnect Google Sheets mirror.';
          setSbFeedback({ ok: false, text: msg });
          onNotify?.('error', 'Disconnect failed', msg);
          return;
        }
        setSbConfirmDisconnect(false);
        setSbWebhookUrl('');
        onConnectionChanged?.(res.data);
        onEnvironmentChanged?.();
        setSbFeedback({
          ok: true,
          text: 'Google Sheets secondary mirror disconnected. Programme records stay in Supabase PostgreSQL.',
        });
        onNotify?.(
          'success',
          'Google Sheets mirror disconnected',
          'Supabase PostgreSQL remains active with all existing data untouched.',
        );
      } finally {
        setSbBusy('none');
      }
    };

    return (
      <section
        aria-label="Google Sheets webhook mirror in Supabase mode"
        className={`p-4 sm:p-5 rounded-xl border space-y-4 text-xs sm:text-sm ${
          oauthSheetsConnection?.connected
            ? 'bg-[#ECFDF5]/60 border-[#047857]/30'
            : 'bg-[#FFFFFF] border-[#137333]/30'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <Database className="w-5 h-5 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <div className="font-medium text-[#0A1B2C] flex flex-wrap items-center gap-2">
                <span>Google Sheets Webhook Mirror (Supabase Edge Function)</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  {oauthSheetsConnection?.connected ? 'Mirror Linked' : 'Primary DB: Supabase Active'}
                </span>
              </div>
              <p className="text-xs text-[#243647] leading-relaxed">
                All form submissions, school records, user approvals, and audit trails are stored
                permanently in Supabase PostgreSQL. Link a Google Sheet URL and Apps Script Web App
                (<code className="font-mono">/exec</code>) webhook below to push live spreadsheet
                mirrors via Edge Function <code className="font-mono">google-sheets-sync</code>.
              </p>
            </div>
          </div>

          <a
            href={oauthSheetsConnection?.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1.5 shrink-0 border-[#137333]/35 text-[#137333] hover:border-[#137333]"
          >
            <span>Open Target Google Sheet</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>

        {sbFeedback && (
          <div
            role={sbFeedback.ok ? 'status' : 'alert'}
            className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
              sbFeedback.ok
                ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                : 'bg-[#FFF1F2] border-[#BE123C]/40 text-[#BE123C]'
            }`}
          >
            {sbFeedback.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span>{sbFeedback.text}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSbSaveMirror(e)} noValidate className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label htmlFor={sbSheetUrlId} className="text-xs font-medium text-[#0A1B2C]">
                  Target Google Spreadsheet URL or ID <span aria-hidden="true">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSbSheetUrl(DEFAULT_TARGET_SPREADSHEET_URL);
                    setSbSheetUrlErr('');
                  }}
                  className="text-[11px] text-[#137333] hover:underline cursor-pointer"
                >
                  Use official sheet
                </button>
              </div>
              <p id={sbSheetUrlHintId} className="text-[11px] text-[#33475B] mb-1">
                Full <code className="font-mono">docs.google.com/spreadsheets/d/…</code> URL or ID.
              </p>
              <input
                ref={sbSheetUrlRef}
                id={sbSheetUrlId}
                name="supabase_mirror_sheet_url"
                type="text"
                required
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={sbSheetUrl}
                aria-invalid={Boolean(sbSheetUrlErr)}
                aria-describedby={
                  sbSheetUrlErr ? `${sbSheetUrlHintId} ${sbSheetUrlErrId}` : sbSheetUrlHintId
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setSbSheetUrl(v);
                  if (sbSheetUrlErr) {
                    setSbSheetUrlErr(validateSbSheetUrlField(v));
                  }
                }}
                onBlur={() => {
                  setSbSheetUrlErr(validateSbSheetUrlField(sbSheetUrl));
                }}
                placeholder={DEFAULT_TARGET_SPREADSHEET_URL}
                className="ct-input text-xs font-mono"
              />
              {sbSheetUrlErr && (
                <p id={sbSheetUrlErrId} className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{sbSheetUrlErr}</span>
                </p>
              )}
            </div>

            <div>
              <label htmlFor={sbSheetNameId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
                Spreadsheet Display Label
              </label>
              <p className="text-[11px] text-[#33475B] mb-1">
                Shown in admin dashboards and sync summaries.
              </p>
              <input
                id={sbSheetNameId}
                name="supabase_mirror_sheet_name"
                type="text"
                value={sbSheetName}
                onChange={(e) => setSbSheetName(e.target.value)}
                placeholder="Career Tours Live Sheet"
                className="ct-input text-xs"
              />
            </div>
          </div>

          <div>
            <label htmlFor={sbWebhookId} className="block text-xs font-medium text-[#0A1B2C] mb-1">
              Apps Script Web App Webhook URL (/exec)
            </label>
            <p id={sbWebhookHintId} className="text-[11px] text-[#33475B] mb-1.5">
              Leave blank to keep any previously stored webhook, or paste a deployed{' '}
              <code className="font-mono">https://script.google.com/macros/s/…/exec</code> URL.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={sbWebhookRef}
                id={sbWebhookId}
                name="supabase_apps_script_webhook_url"
                type="url"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={sbWebhookUrl}
                placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                aria-invalid={Boolean(sbWebhookErr)}
                aria-describedby={
                  sbWebhookErr ? `${sbWebhookHintId} ${sbWebhookErrId}` : sbWebhookHintId
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setSbWebhookUrl(v);
                  if (sbWebhookErr) {
                    setSbWebhookErr(v.trim() ? validateSbWebhookField(v) : '');
                  }
                }}
                onBlur={() => {
                  if (!sbWebhookUrl.trim()) {
                    setSbWebhookErr('');
                    return;
                  }
                  setSbWebhookErr(validateSbWebhookField(sbWebhookUrl));
                }}
                className="ct-input text-xs font-mono flex-1 min-w-[220px]"
              />
              {api.testSheetsWebhook && (
                <button
                  type="button"
                  disabled={sbBusy !== 'none'}
                  onClick={() => void handleSbTestWebhook()}
                  className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1 shrink-0"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${sbBusy === 'test' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{sbBusy === 'test' ? 'Testing…' : 'Test Webhook'}</span>
                </button>
              )}
            </div>
            {sbWebhookErr && (
              <p id={sbWebhookErrId} className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{sbWebhookErr}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={sbBusy !== 'none'}
                className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer disabled:opacity-55"
              >
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                <span>{sbBusy === 'save' ? 'Saving & Pushing…' : 'Save & Push to Google Sheets'}</span>
              </button>

              {oauthSheetsConnection?.connected && (
                <button
                  type="button"
                  disabled={sbBusy !== 'none'}
                  onClick={() => void handleSbSyncNow()}
                  className="ct-btn-secondary text-xs min-h-[40px] px-3.5 py-1.5 border-[#137333]/35 text-[#137333]"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${sbBusy === 'sync' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{sbBusy === 'sync' ? 'Syncing…' : 'Sync All Records Now'}</span>
                </button>
              )}
            </div>

            {oauthSheetsConnection?.connected && !sbConfirmDisconnect && (
              <button
                type="button"
                disabled={sbBusy !== 'none'}
                onClick={() => setSbConfirmDisconnect(true)}
                className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1.5 border-[#BE123C]/40 text-[#BE123C] hover:bg-[#FFF1F2]"
              >
                <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Disconnect Mirror</span>
              </button>
            )}
          </div>
        </form>

        {sbConfirmDisconnect && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/35 flex flex-wrap items-center justify-between gap-2.5 text-xs text-[#0A1B2C]"
          >
            <span>
              Disconnect Google Sheets mirror? Programme records in Supabase PostgreSQL and existing
              Google Sheet tabs remain intact.
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setSbConfirmDisconnect(false)}
                className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
              >
                Keep Mirror
              </button>
              <button
                type="button"
                disabled={sbBusy === 'disconnect'}
                onClick={() => void handleSbDisconnect()}
                className="ct-btn-danger text-xs min-h-[34px] px-3 py-1"
              >
                {sbBusy === 'disconnect' ? 'Disconnecting…' : 'Confirm Disconnect'}
              </button>
            </div>
          </div>
        )}

        <details
          className="rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] p-3 text-xs text-[#243647]"
          onToggle={(e) => {
            if (e.currentTarget.open) {
              void ensureScriptLoaded();
            }
          }}
        >
          <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#137333]">
            Copy or Download Apps Script (CareerToursAllInOne.gs)
          </summary>
          <div className="mt-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-[#33475B]">
                Deploy as a Google Apps Script Web App (<code className="font-mono">/exec</code>) and
                paste its URL above.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="ct-copy-wrap">
                  <button
                    type="button"
                    className="ct-btn-secondary ct-copy-btn text-xs min-h-[28px] px-2.5 py-1"
                    {...({ command: '--copy', commandfor: bridgeScriptCodeId } as Record<
                      string,
                      string
                    >)}
                  >
                    <span className="ct-copy-icon-idle inline-flex items-center gap-1.5">
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copy Apps Script</span>
                    </span>
                    <span className="ct-copy-icon-done inline-flex items-center gap-1.5 text-[#137333]">
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copied</span>
                    </span>
                  </button>
                  <span
                    className="ct-copy-status text-[11px] font-medium text-[#137333]"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  />
                </span>
                <button
                  type="button"
                  onClick={() => void handleDownloadBridgeScript()}
                  disabled={scriptLoading}
                  className="ct-btn-secondary text-xs min-h-[28px] px-2.5 py-1"
                >
                  <Download className="w-3.5 h-3.5 text-[#137333]" aria-hidden="true" />
                  <span>Download CareerToursAllInOne.gs</span>
                </button>
              </div>
            </div>

            {scriptLoadError ? (
              <p className="text-xs text-[#BE123C]">{scriptLoadError}</p>
            ) : (
              <div className="w-full overflow-hidden rounded-lg border border-[#DFD7C2] bg-[#FFFFFF]">
                <pre
                  tabIndex={0}
                  className="max-h-48 w-full overflow-auto p-3 text-[11px] font-mono text-[#0A1B2C] leading-relaxed"
                >
                  <code id={bridgeScriptCodeId}>
                    {scriptLoading
                      ? '// Loading CareerToursAllInOne.gs bundle…'
                      : personalizedScript || '// Open to load CareerToursAllInOne.gs'}
                  </code>
                </pre>
              </div>
            )}
          </div>
        </details>
      </section>
    );
  }

  if (needsDirectReauth && oauthSheetsConnection?.spreadsheetId) {
    return (
      <section
        aria-label="Re-authorize Direct Google OAuth Session"
        className="p-4 sm:p-5 rounded-xl bg-[#FFFBEB] border border-[#B45309]/40 space-y-3 text-xs sm:text-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <div className="font-medium text-[#0A1B2C]">
                Direct Google OAuth Session Reloaded — Authorization Needed
              </div>
              <p className="text-xs text-[#78350F] leading-relaxed">
                Your browser holds the spreadsheet link cleanly, while OAuth access tokens remain
                strictly in browser memory and cleared on reload. Re-authorize once to push pending
                changes into{' '}
                <strong className="font-medium text-[#0A1B2C]">
                  {oauthSheetsConnection.spreadsheetName || oauthSheetsConnection.spreadsheetId}
                </strong>
                .
              </p>
            </div>
          </div>

          {onAuthorizeNow && (
            <button
              type="button"
              onClick={onAuthorizeNow}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs font-medium border border-[#0D652D] cursor-pointer shrink-0"
            >
              <span>Authorize Direct Google Sync</span>
            </button>
          )}
        </div>
      </section>
    );
  }

  if (isOAuthConnected && !activeAppsScriptUrl) {
    return (
      <section
        aria-label="Live Google Sheets backend connection"
        className="p-4 sm:p-5 rounded-xl bg-[#ECFDF5] border border-[#047857]/30 space-y-3 text-xs sm:text-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <div className="font-medium text-[#0A1B2C] flex flex-wrap items-center gap-2">
                <span>Online Google Sheets Storage Active</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFFFF] border border-[#047857]/35 text-[#047857]">
                  Google OAuth 2.0 Link
                </span>
              </div>
              <p className="text-xs text-[#243647] leading-relaxed">
                Form submissions, edits, school directory updates, user approvals, and audit logs
                save live directly to your connected Google Spreadsheet through your authorized
                Google OAuth 2.0 session.
              </p>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#047857]/20 min-w-0">
            <dt className="text-[#33475B]">Connected Spreadsheet</dt>
            <dd className="mt-0.5 font-medium text-[#0A1B2C] break-words">
              <a
                href={oauthSheetsConnection?.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#047857] hover:underline"
              >
                <span>
                  {oauthSheetsConnection?.spreadsheetName ||
                    oauthSheetsConnection?.spreadsheetId}
                </span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </a>
            </dd>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#047857]/20 min-w-0">
            <dt className="text-[#33475B]">Authorized Google Account</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-[#0A1B2C] break-all">
              {oauthSheetsConnection?.connectedAccount || userEmail}
            </dd>
          </div>
        </dl>

        <details className="pt-2 border-t border-[#047857]/20 text-xs text-[#243647]">
          <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#047857] inline-flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
            <span>Optional: Enable Apps Script Web App URL for multi-device facilitators</span>
          </summary>
          <div className="mt-3 p-4 rounded-xl bg-[#FFFFFF] border border-[#DFD7C2] space-y-4">
            {appsScriptSetupBody}
          </div>
        </details>
      </section>
    );
  }

  if (isBridgeConnected && !hasBuildTimeConfig && !isRuntimeConfigured) {
    return (
      <section
        aria-label="Apps Script Sync Bridge active"
        className="p-4 sm:p-5 rounded-xl bg-[#ECFDF5] border border-[#047857]/30 space-y-3 text-xs sm:text-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <div className="font-medium text-[#0A1B2C] flex flex-wrap items-center gap-2">
                <span>Apps Script Sync Bridge Active</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFFFF] border border-[#047857]/35 text-[#047857]">
                  Remembered Local Sign-In
                </span>
              </div>
              <p className="text-xs text-[#243647] leading-relaxed">
                Super Administrator sessions retain remembered local password sign-in while all 10
                spreadsheet tabs sync live into Google Sheets through your Apps Script Web App.
              </p>
            </div>
          </div>

          {!confirmBridgeDisconnectOpen && (
            <button
              type="button"
              onClick={() => setConfirmBridgeDisconnectOpen(true)}
              className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1.5 border-[#BE123C]/40 text-[#BE123C] hover:bg-[#FFF1F2] shrink-0"
            >
              <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
              Disconnect Bridge
            </button>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#047857]/20 min-w-0">
            <dt className="text-[#33475B]">Connected Spreadsheet</dt>
            <dd className="mt-0.5 font-medium text-[#0A1B2C] break-words">
              <a
                href={oauthSheetsConnection?.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#047857] hover:underline"
              >
                <span>
                  {oauthSheetsConnection?.spreadsheetName ||
                    oauthSheetsConnection?.spreadsheetId}
                </span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </a>
            </dd>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#047857]/20 min-w-0">
            <dt className="text-[#33475B]">Bridge Apps Script Endpoint</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-[#0A1B2C] break-all">
              {savedBridge?.appsScriptUrl}
            </dd>
          </div>
        </dl>

        <div className="p-3 rounded-lg bg-[#FFFFFF] border border-[#047857]/25 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-[#0A1B2C] inline-flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              Team Multi-Device Submission Link
            </span>
            {api?.rotateTeamIntakeKey && (
              <button
                type="button"
                disabled={rotatingIntakeKey}
                onClick={() => void handleRotateIntakeKey()}
                className="ct-btn-secondary text-[11px] min-h-[30px] px-2.5 py-0.5"
              >
                <RotateCcw
                  className={`w-3 h-3 ${rotatingIntakeKey ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {rotatingIntakeKey
                    ? 'Generating…'
                    : bridgeShareUrl
                      ? 'Rotate Team Key'
                      : 'Generate Team Link'}
                </span>
              </button>
            )}
          </div>
          {bridgeShareUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded bg-[#FAF8F2] border border-[#DFD7C2] font-mono text-[11px] text-[#0A1B2C] truncate">
                <code id={bridgeShareCodeId}>{bridgeShareUrl}</code>
              </div>
              <span className="ct-copy-wrap shrink-0">
                <button
                  type="button"
                  className="ct-btn-secondary ct-copy-btn text-xs min-h-[32px] px-2.5 py-1"
                  {...({
                    command: '--copy',
                    commandfor: bridgeShareCodeId,
                  } as Record<string, string>)}
                >
                  <span className="ct-copy-icon-idle inline-flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Team Submission Link</span>
                  </span>
                  <span className="ct-copy-icon-done inline-flex items-center gap-1 text-[#137333]">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copied</span>
                  </span>
                </button>
                <span
                  className="ct-copy-status text-[11px] font-medium text-[#137333]"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                />
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-[#243647]">
              Click <strong>Generate Team Link</strong> to issue a facilitator submission link that sends entries from other devices straight into this spreadsheet without exposing admin credentials.
            </p>
          )}
        </div>

        {confirmBridgeDisconnectOpen && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/35 flex flex-wrap items-center justify-between gap-2.5 text-xs text-[#0A1B2C]"
          >
            <span>
              Disconnect the Apps Script Sync Bridge? Existing rows already written in your Google
              Sheet stay preserved.
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setConfirmBridgeDisconnectOpen(false)}
                className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
              >
                Keep Bridge
              </button>
              <button
                type="button"
                disabled={bridgeDisconnecting}
                onClick={() => void handleDisconnectBridge()}
                className="ct-btn-danger text-xs min-h-[34px] px-3 py-1"
              >
                {bridgeDisconnecting ? 'Disconnecting…' : 'Confirm Disconnect Bridge'}
              </button>
            </div>
          </div>
        )}

        <details className="pt-2 border-t border-[#047857]/20 text-xs text-[#243647]">
          <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#047857] inline-flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
            <span>Switch Spreadsheet or Update Bridge Settings</span>
          </summary>
          <div className="mt-3">{bridgeSetupSection}</div>
        </details>
      </section>
    );
  }

  if (isLiveBackend) {
    return (
      <section
        aria-label="Live Google Sheets backend connection"
        className="p-4 sm:p-5 rounded-xl bg-[#ECFDF5] border border-[#047857]/30 space-y-3 text-xs sm:text-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-[#047857] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <div className="font-medium text-[#0A1B2C] flex flex-wrap items-center gap-2">
                <span>Online Google Sheets Storage Active</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFFFF] border border-[#047857]/35 text-[#047857]">
                  {hasBuildTimeConfig ? 'Published Build Config' : 'Super Admin Browser Link'}
                </span>
              </div>
              <p className="text-xs text-[#243647] leading-relaxed">
                All facilitator submissions, edits, school master updates, user approvals, and
                audit logs write directly to your Google Spreadsheet with server-side concurrency
                locks and Google Sign-In verification.
              </p>
            </div>
          </div>

          {isRuntimeConfigured && !hasBuildTimeConfig && onReset && !confirmResetOpen && (
            <button
              type="button"
              onClick={() => setConfirmResetOpen(true)}
              className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1.5 border-[#BE123C]/40 text-[#BE123C] hover:bg-[#FFF1F2] shrink-0"
            >
              <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
              Disconnect Backend
            </button>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#047857]/20 min-w-0">
            <dt className="text-[#33475B]">Apps Script Web App Endpoint</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-[#0A1B2C] break-all">
              {activeAppsScriptUrl}
            </dd>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#047857]/20 min-w-0">
            <dt className="text-[#33475B]">Google Sign-In Web Client ID</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-[#0A1B2C] break-all">
              {activeGoogleClientId}
            </dd>
          </div>
        </dl>

        {oauthShareUrl && (
          <div className="p-3 rounded-lg bg-[#FFFFFF] border border-[#047857]/25 space-y-2 text-xs">
            <div className="font-medium text-[#0A1B2C] inline-flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
              <span>Team Multi-Device Submission Link</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded bg-[#FAF8F2] border border-[#DFD7C2] font-mono text-[11px] text-[#0A1B2C] truncate">
                <code id={oauthShareCodeId}>{oauthShareUrl}</code>
              </div>
              <span className="ct-copy-wrap shrink-0">
                <button
                  type="button"
                  className="ct-btn-secondary ct-copy-btn text-xs min-h-[32px] px-2.5 py-1"
                  {...({
                    command: '--copy',
                    commandfor: oauthShareCodeId,
                  } as Record<string, string>)}
                >
                  <span className="ct-copy-icon-idle inline-flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Team Submission Link</span>
                  </span>
                  <span className="ct-copy-icon-done inline-flex items-center gap-1 text-[#137333]">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copied</span>
                  </span>
                </button>
                <span
                  className="ct-copy-status text-[11px] font-medium text-[#137333]"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                />
              </span>
            </div>
          </div>
        )}

        {confirmResetOpen && onReset && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/35 flex flex-wrap items-center justify-between gap-2.5 text-xs text-[#0A1B2C]"
          >
            <span>
              Disconnect online backend from this browser? All records already saved in your Google
              Sheet stay safely preserved.
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
              >
                Keep Active
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmResetOpen(false);
                  onReset();
                }}
                className="ct-btn-danger text-xs min-h-[34px] px-3 py-1"
              >
                Confirm Disconnect
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Activate live Google Sheets synchronization"
      className="p-4 sm:p-5 rounded-xl bg-[#FFFFFF] border border-[#137333]/30 space-y-4 text-xs sm:text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0A1B2C]">
              <Globe className="w-4 h-4 text-[#137333]" aria-hidden="true" />
              Activate Online Google Sheets Storage
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E6F4EA] border border-[#137333]/25 text-[#137333]">
              <Lock className="w-3 h-3" aria-hidden="true" />
              Super Admin Setup
            </span>
          </div>
          <p className="text-xs text-[#243647] leading-relaxed">
            Connect your official Vidhya Vidhai Google Spreadsheet so every facilitator submission,
            edit, school directory update, and user approval saves online securely with Google
            OAuth tokens and never writes passwords into your spreadsheet.
          </p>
        </div>

        <a
          href={DEFAULT_TARGET_SPREADSHEET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1.5 shrink-0 border-[#137333]/35 text-[#137333] hover:border-[#137333]"
        >
          <span>Open Target Google Sheet</span>
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      </div>

      {bridgeSetupSection}

      <div className="pt-2 border-t border-[#DFD7C2] space-y-3">
        <div className="text-xs sm:text-sm font-medium text-[#0A1B2C]">
          Option B · Multi-Device Google Sign-In Web App (Full Apps Script Mode)
        </div>
        {appsScriptSetupBody}
      </div>
    </section>
  );
};
