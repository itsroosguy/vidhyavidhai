import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Unlink,
  X,
} from 'lucide-react';
import { GoogleSheetsIcon } from '../../admin/GoogleSheetsBanner';
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
  generateAppsScriptSyncKey,
  getAuthEnvironment,
  loadAppsScriptBridgeConfig,
  loadDirectGoogleClientId,
  probeAppsScriptEndpoint,
  probeSheetsBackendStatus,
  saveDirectGoogleClientId,
  saveRuntimeBackendConfig,
  setRuntimeSheetsBackendUrl,
  validateAppsScriptSyncKey,
  validateAppsScriptWebAppUrl,
  validateGoogleOAuthClientId,
  validateSheetsBackendUrl,
} from '../../services/authService';
import { buildRelativeSpreadsheetTitle } from '../../services/googleSheetsDirectService';
import type {
  AppConfiguration,
  FacilitatorApprovalMode,
  GoogleSheetsConnectionState,
  TeamIntakeSetupResponse,
  UserProfile,
} from '../../types/domain';

type SyncConnectionMethod = 'direct_browser' | 'sheets_backend' | 'apps_script';
type TargetSheetAction = 'create' | 'existing';

interface WorkspaceSyncPreview {
  sessionsCount: number;
  unsyncedSessionsCount: number;
  schoolsCount: number;
  facilitatorsCount: number;
  districts: string[];
}

interface TopGoogleSheetsQuickBarProps {
  api: BackendApiClient;
  user: UserProfile;
  config: AppConfiguration;
  isOpen: boolean;
  onToggleOpen: (nextOpen: boolean) => void;
  isLiveBackend: boolean;
  isOAuthSheetsLive: boolean;
  needsDirectReauth: boolean;
  connection: GoogleSheetsConnectionState | null;
  dataVersion: number;
  activeDistrict?: string;
  onConfigUpdated?: (next: AppConfiguration) => void;
  onConnectionChanged: (next: GoogleSheetsConnectionState) => void;
  onEnvironmentChanged: () => void;
  onLiveBackendActivated: () => void;
  onSynced: () => Promise<void> | void;
  onOpenSyncStatus: () => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const TopGoogleSheetsQuickBar: React.FC<TopGoogleSheetsQuickBarProps> = ({
  api,
  user,
  config,
  isOpen,
  onToggleOpen,
  isLiveBackend,
  isOAuthSheetsLive,
  needsDirectReauth,
  connection,
  dataVersion,
  activeDistrict = '',
  onConfigUpdated,
  onConnectionChanged,
  onEnvironmentChanged,
  onLiveBackendActivated,
  onSynced,
  onOpenSyncStatus,
  onNotify,
}) => {
  const isSupabaseMode = api.mode === 'supabase';
  const authEnv = getAuthEnvironment();
  const initialBridge = loadAppsScriptBridgeConfig();
  const isEffectiveLive = (isLiveBackend || isOAuthSheetsLive) && !needsDirectReauth;
  const hasLinkedSheet = Boolean(connection?.connected && connection?.spreadsheetId);

  const [method, setMethod] = useState<SyncConnectionMethod>(() => {
    if (
      authEnv.isLiveBackendConfigured ||
      connection?.connectionProvider === 'apps_script' ||
      connection?.authMethod === 'apps_script' ||
      Boolean(initialBridge)
    ) {
      return 'apps_script';
    }
    if (
      connection?.connectionProvider === 'sheets_backend' ||
      (authEnv.sheetsBackendUrl && connection?.connectionProvider !== 'direct_browser')
    ) {
      return 'sheets_backend';
    }
    return 'direct_browser';
  });
  const [appsScriptMode, setAppsScriptMode] = useState<'sandbox_bridge' | 'oauth_webapp'>(() =>
    authEnv.isLiveBackendConfigured ? 'oauth_webapp' : 'sandbox_bridge',
  );

  const [sheetAction, setSheetAction] = useState<TargetSheetAction>(() =>
    hasLinkedSheet &&
    (connection?.authMethod === 'google_oauth' || connection?.authMethod === 'apps_script')
      ? 'existing'
      : 'create',
  );

  const [preview, setPreview] = useState<WorkspaceSyncPreview>({
    sessionsCount: 0,
    unsyncedSessionsCount: 0,
    schoolsCount: 0,
    facilitatorsCount: 0,
    districts: [],
  });

  const computedRelativeTitle = useMemo(
    () =>
      buildRelativeSpreadsheetTitle({
        programmeName: 'Career Tours',
        partnerName: config.partnerName,
        district: activeDistrict,
        sessions: preview.districts.map((d) => ({ district: d, startDate: '' })),
      }),
    [activeDistrict, config.partnerName, preview.districts],
  );

  const [newSheetTitle, setNewSheetTitle] = useState<string>(computedRelativeTitle);
  const [titleEditedManually, setTitleEditedManually] = useState(false);

  const [sheetUrlOrId, setSheetUrlOrId] = useState<string>(
    connection?.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL,
  );
  const [sheetLabel, setSheetLabel] = useState<string>(connection?.spreadsheetName || '');

  const [directClientId, setDirectClientId] = useState<string>(
    () => authEnv.directGoogleClientId || loadDirectGoogleClientId() || authEnv.googleClientId || '',
  );
  const [hostedBackendUrl, setHostedBackendUrl] = useState<string>(
    () => authEnv.sheetsBackendUrl || '/api/sheets',
  );
  const [appsScriptUrl, setAppsScriptUrl] = useState<string>(() => authEnv.appsScriptUrl || '');
  const [appsScriptClientId, setAppsScriptClientId] = useState<string>(
    () => authEnv.googleClientId || '',
  );
  const [bridgeUrl, setBridgeUrl] = useState<string>(() => initialBridge?.appsScriptUrl || '');
  const [bridgeSyncKey, setBridgeSyncKey] = useState<string>(
    () => initialBridge?.syncKey || generateAppsScriptSyncKey(),
  );
  const [bridgeScriptTemplate, setBridgeScriptTemplate] = useState<string>(
    () => getCachedAppsScriptTemplate() || '',
  );
  const [bridgeScriptLoading, setBridgeScriptLoading] = useState(false);
  const [bridgeScriptLoadErr, setBridgeScriptLoadErr] = useState('');
  const [sbWebhookUrl, setSbWebhookUrl] = useState('');
  const [sbWebhookErr, setSbWebhookErr] = useState('');
  const [sbTestingWebhook, setSbTestingWebhook] = useState(false);

  const [directClientErr, setDirectClientErr] = useState('');
  const [hostedUrlErr, setHostedUrlErr] = useState('');
  const [appsScriptUrlErr, setAppsScriptUrlErr] = useState('');
  const [appsScriptClientErr, setAppsScriptClientErr] = useState('');
  const [bridgeUrlErr, setBridgeUrlErr] = useState('');
  const [bridgeKeyErr, setBridgeKeyErr] = useState('');
  const [sheetTitleErr, setSheetTitleErr] = useState('');
  const [sheetUrlErr, setSheetUrlErr] = useState('');

  const [busyAction, setBusyAction] = useState<
    'none' | 'submit' | 'push' | 'save_backend' | 'disconnect'
  >('none');
  const [hostedOAuthPendingUrl, setHostedOAuthPendingUrl] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<{
    kind: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(
    () => !isEffectiveLive || needsDirectReauth,
  );
  const [teamIntakeSetup, setTeamIntakeSetup] = useState<TeamIntakeSetupResponse | null>(null);
  const [rotatingIntakeKey, setRotatingIntakeKey] = useState(false);
  const [savingApprovalMode, setSavingApprovalMode] = useState(false);
  const detailsUserToggledRef = useRef(false);
  const methodUserToggledRef = useRef(false);

  const directClientRef = useRef<HTMLInputElement>(null);
  const hostedUrlRef = useRef<HTMLInputElement>(null);
  const appsUrlRef = useRef<HTMLInputElement>(null);
  const appsClientRef = useRef<HTMLInputElement>(null);
  const bridgeUrlRef = useRef<HTMLInputElement>(null);
  const bridgeKeyRef = useRef<HTMLInputElement>(null);
  const sheetTitleRef = useRef<HTMLInputElement>(null);
  const sheetUrlRef = useRef<HTMLInputElement>(null);
  const sbWebhookRef = useRef<HTMLInputElement>(null);

  const regionId = useId();
  const panelBodyId = useId();
  const sbWebhookInputId = useId();
  const sbWebhookHintId = useId();
  const sbWebhookErrId = useId();
  const directClientInputId = useId();
  const directClientHintId = useId();
  const directClientErrId = useId();
  const hostedUrlInputId = useId();
  const hostedUrlHintId = useId();
  const hostedUrlErrId = useId();
  const appsUrlInputId = useId();
  const appsUrlHintId = useId();
  const appsUrlErrId = useId();
  const appsClientInputId = useId();
  const appsClientHintId = useId();
  const appsClientErrId = useId();
  const bridgeUrlInputId = useId();
  const bridgeUrlHintId = useId();
  const bridgeUrlErrId = useId();
  const bridgeKeyInputId = useId();
  const bridgeKeyHintId = useId();
  const bridgeKeyErrId = useId();
  const bridgeCodeId = useId();
  const teamShareCodeId = useId();
  const titleInputId = useId();
  const titleHintId = useId();
  const titleErrId = useId();
  const existingUrlInputId = useId();
  const existingUrlHintId = useId();
  const existingUrlErrId = useId();
  const existingLabelInputId = useId();

  useEffect(() => {
    if (user.role !== 'super_admin' || !isOpen) return;
    return ensureCopyCommandListener();
  }, [isOpen, user.role]);

  const normalizedValidBridgeKey = useMemo(() => {
    const check = validateAppsScriptSyncKey(bridgeSyncKey);
    return check.valid ? check.normalized : '';
  }, [bridgeSyncKey]);

  const personalizedBridgeScript = useMemo(() => {
    if (!bridgeScriptTemplate) return '';
    return buildPersonalizedAppsScriptBundle(
      bridgeScriptTemplate,
      normalizedValidBridgeKey,
      teamIntakeSetup?.intakeKey,
    );
  }, [bridgeScriptTemplate, normalizedValidBridgeKey, teamIntakeSetup?.intakeKey]);

  const teamShareUrl = useMemo(() => {
    if (method === 'apps_script' && appsScriptMode === 'oauth_webapp') {
      const u = validateAppsScriptWebAppUrl(appsScriptUrl || authEnv.appsScriptUrl);
      const c = validateGoogleOAuthClientId(appsScriptClientId || authEnv.googleClientId);
      if (u.valid && c.valid) {
        try {
          return buildTeamShareUrl({
            mode: 'oauth',
            appsScriptUrl: u.normalized,
            googleClientId: c.normalized,
            label: config.partnerName || 'Central Programme Database',
          });
        } catch {
          return '';
        }
      }
    }

    const bridgeExecCandidate = bridgeUrl || loadAppsScriptBridgeConfig()?.appsScriptUrl || authEnv.appsScriptUrl;
    const uBridge = validateAppsScriptWebAppUrl(bridgeExecCandidate);
    if (uBridge.valid && teamIntakeSetup?.intakeKey) {
      try {
        return buildTeamShareUrl({
          mode: 'intake',
          appsScriptUrl: uBridge.normalized,
          intakeKey: teamIntakeSetup.intakeKey,
          label: config.partnerName || 'Central Programme Database',
        });
      } catch {
        return '';
      }
    }

    if (authEnv.isLiveBackendConfigured && authEnv.appsScriptUrl && authEnv.googleClientId) {
      try {
        return buildTeamShareUrl({
          mode: 'oauth',
          appsScriptUrl: authEnv.appsScriptUrl,
          googleClientId: authEnv.googleClientId,
          label: config.partnerName || 'Central Programme Database',
        });
      } catch {
        return '';
      }
    }
    return '';
  }, [
    appsScriptClientId,
    appsScriptMode,
    appsScriptUrl,
    authEnv.appsScriptUrl,
    authEnv.googleClientId,
    authEnv.isLiveBackendConfigured,
    bridgeUrl,
    config.partnerName,
    method,
    teamIntakeSetup?.intakeKey,
  ]);

  const ensureBridgeScriptLoaded = async (): Promise<string> => {
    if (bridgeScriptTemplate) return bridgeScriptTemplate;
    setBridgeScriptLoading(true);
    setBridgeScriptLoadErr('');
    try {
      const raw = await loadAppsScriptTemplate();
      setBridgeScriptTemplate(raw);
      return raw;
    } catch {
      const msg = 'Could not load CareerToursAllInOne.gs template.';
      setBridgeScriptLoadErr(msg);
      return '';
    } finally {
      setBridgeScriptLoading(false);
    }
  };

  useEffect(() => {
    if (!titleEditedManually) {
      setNewSheetTitle(computedRelativeTitle);
    }
  }, [computedRelativeTitle, titleEditedManually]);

  useEffect(() => {
    if (needsDirectReauth) {
      setMethod('direct_browser');
      setDetailsOpen(true);
      return;
    }
    if (isEffectiveLive && hasLinkedSheet && !detailsUserToggledRef.current) {
      setDetailsOpen(false);
    }
  }, [hasLinkedSheet, isEffectiveLive, needsDirectReauth]);

  useEffect(() => {
    if (
      !methodUserToggledRef.current &&
      connection?.connected &&
      (connection.connectionProvider === 'apps_script' || connection.authMethod === 'apps_script')
    ) {
      setMethod('apps_script');
      if (!authEnv.isLiveBackendConfigured) {
        setAppsScriptMode('sandbox_bridge');
      }
    }
  }, [
    authEnv.isLiveBackendConfigured,
    connection?.authMethod,
    connection?.connected,
    connection?.connectionProvider,
  ]);

  useEffect(() => {
    if (
      connection?.connected &&
      connection.spreadsheetUrl &&
      (connection.authMethod === 'google_oauth' || connection.authMethod === 'apps_script')
    ) {
      setSheetUrlOrId(connection.spreadsheetUrl);
      if (connection.spreadsheetName) {
        setSheetLabel(connection.spreadsheetName);
      }
    }
  }, [connection?.connected, connection?.authMethod, connection?.spreadsheetName, connection?.spreadsheetUrl]);

  const refreshPreview = useCallback(async () => {
    if (!api.getWorkspaceSyncPreview) return;
    const res = await api.getWorkspaceSyncPreview();
    if (res.ok && res.data) {
      setPreview(res.data);
    }
  }, [api]);

  const refreshTeamIntakeSetup = useCallback(async () => {
    if (user.role !== 'super_admin' || !api.getTeamIntakeSetup) return;
    const res = await api.getTeamIntakeSetup();
    if (res.ok && res.data) {
      setTeamIntakeSetup(res.data);
    }
  }, [api, user.role]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview, dataVersion, isOpen, connection?.lastSyncedAt]);

  useEffect(() => {
    if (user.role !== 'super_admin' || !isOpen) return;
    void refreshTeamIntakeSetup();
  }, [isOpen, refreshTeamIntakeSetup, connection?.lastSyncedAt, user.role]);

  // Never expose Google Sheets controls to Facilitators
  if (user.role !== 'super_admin' || !isOpen) {
    return null;
  }

  const clearValidationErrors = () => {
    setDirectClientErr('');
    setHostedUrlErr('');
    setAppsScriptUrlErr('');
    setAppsScriptClientErr('');
    setBridgeUrlErr('');
    setBridgeKeyErr('');
    setSheetTitleErr('');
    setSheetUrlErr('');
    setHostedOAuthPendingUrl(null);
  };

  const validateNewSheetTitle = (val: string): string => {
    const trimmed = val.trim();
    if (!trimmed) {
      return 'Error: Enter a Google Spreadsheet title.';
    }
    if (trimmed.length < 3) {
      return 'Error: Spreadsheet title must be at least 3 characters.';
    }
    return '';
  };

  const validateExistingSheetField = (val: string): string => {
    const trimmed = val.trim();
    if (!trimmed) {
      return 'Error: Enter a Google Spreadsheet URL or Spreadsheet ID.';
    }
    if (!parseGoogleSpreadsheetId(trimmed)) {
      return 'Error: Enter a valid Google Sheets URL (https://docs.google.com/spreadsheets/d/...) or Spreadsheet ID.';
    }
    return '';
  };

  const handleResetRelativeTitle = () => {
    setTitleEditedManually(false);
    setNewSheetTitle(computedRelativeTitle);
    setSheetTitleErr('');
  };

  const handleSaveAndProbeHostedBackend = async (deferEnvRefresh = false): Promise<{
    readyToWrite: boolean;
    oauthStartUrl?: string;
  }> => {
    const check = validateSheetsBackendUrl(hostedBackendUrl);
    if (!check.valid) {
      const msg = `Error: ${check.error || 'Enter a valid /api/sheets URL.'}`;
      setHostedUrlErr(msg);
      hostedUrlRef.current?.focus();
      return { readyToWrite: false };
    }

    setRuntimeSheetsBackendUrl(check.normalized, true);
    api.setSheetsBackendUrl?.(check.normalized);
    if (!deferEnvRefresh) {
      onEnvironmentChanged();
    }
    const probe = await probeSheetsBackendStatus(check.normalized);
    if (!probe.available) {
      if (deferEnvRefresh) onEnvironmentChanged();
      setStatusFeedback({
        kind: 'error',
        text: `Hosted backend at ${check.normalized} is unreachable or not deployed. Use Direct Google Sign-In or verify your Vercel /api/sheets deployment.`,
      });
      return { readyToWrite: false };
    }

    if (!probe.connection?.oauthConfigured) {
      if (deferEnvRefresh) onEnvironmentChanged();
      setStatusFeedback({
        kind: 'error',
        text: `Hosted endpoint ${check.normalized} responded, but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured on that server. Use Direct Google Sign-In here for instant live Excel sync.`,
      });
      return { readyToWrite: false };
    }

    if (!probe.connection?.connectedAccount) {
      if (deferEnvRefresh) onEnvironmentChanged();
      const startHref = `${check.normalized.replace(/\/$/, '')}?action=oauthStart&login_hint=${encodeURIComponent(user.email)}`;
      setHostedOAuthPendingUrl(startHref);
      setStatusFeedback({
        kind: 'info',
        text: `Hosted backend ${check.normalized} is ready. Authorize your Google account once to push data directly to Sheets.`,
      });
      return { readyToWrite: false, oauthStartUrl: startHref };
    }

    setHostedOAuthPendingUrl(null);
    return { readyToWrite: true };
  };

  const handlePushPendingOnly = async () => {
    if (!connection?.connected || !connection?.spreadsheetId) return;
    setStatusFeedback(null);
    setBusyAction('push');

    try {
      const usingDirect =
        connection.connectionProvider === 'direct_browser' ||
        (connection.connectionProvider !== 'sheets_backend' &&
          connection.connectionProvider !== 'apps_script' &&
          connection.authMethod !== 'apps_script' &&
          !isLiveBackend &&
          !loadAppsScriptBridgeConfig() &&
          method === 'direct_browser');
      const usingBridge = Boolean(
        !usingDirect &&
          (connection.connectionProvider === 'apps_script' ||
            connection.authMethod === 'apps_script' ||
            loadAppsScriptBridgeConfig()),
      );
      let normalizedDirectId = '';
      if (!isSupabaseMode && usingDirect) {
        const cCheck = validateGoogleOAuthClientId(directClientId);
        if (!cCheck.valid) {
          setDetailsOpen(true);
          setMethod('direct_browser');
          setDirectClientErr(`Error: ${cCheck.error || 'Invalid Google OAuth Web Client ID.'}`);
          setTimeout(() => directClientRef.current?.focus(), 0);
          return;
        }
        normalizedDirectId = saveDirectGoogleClientId(cCheck.normalized);
      }

      const syncRes = isSupabaseMode
        ? await api.syncAllToGoogleSheet(
            sbWebhookUrl.trim() ? { appsScriptUrl: sbWebhookUrl.trim() } : undefined,
          )
        : await api.syncAllToGoogleSheet(
            usingDirect
              ? { directClientId: normalizedDirectId, forceDirectOAuth: true }
              : usingBridge
                ? { forceAppsScriptBridge: true }
                : undefined,
          );
      if (!syncRes.ok || !syncRes.data) {
        const msg = syncRes.error || 'Could not push pending data to Google Sheets.';
        setStatusFeedback({ kind: 'error', text: msg });
        onNotify('error', 'Google Sheets push failed', msg);
        return;
      }

      const latestConn = await api.getSheetsConnection();
      if (latestConn.ok && latestConn.data) {
        onConnectionChanged(latestConn.data);
      }
      await onSynced();
      await refreshPreview();
      if (usingDirect) {
        onEnvironmentChanged();
      }
      setStatusFeedback({ kind: 'success', text: syncRes.data.message });
      onNotify('success', 'Data pushed to live Google Sheet', syncRes.data.message);
      setDetailsOpen(false);
    } finally {
      setBusyAction('none');
    }
  };

  const handleSubmitSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusFeedback(null);
    setHostedOAuthPendingUrl(null);

    if (method === 'apps_script' && appsScriptMode === 'oauth_webapp') {
      const uCheck = validateAppsScriptWebAppUrl(appsScriptUrl);
      const cCheck = validateGoogleOAuthClientId(appsScriptClientId);
      setAppsScriptUrlErr(uCheck.valid ? '' : `Error: ${uCheck.error || 'Invalid Apps Script URL.'}`);
      setAppsScriptClientErr(
        cCheck.valid ? '' : `Error: ${cCheck.error || 'Invalid Google OAuth Client ID.'}`,
      );
      if (!uCheck.valid) {
        appsUrlRef.current?.focus();
        return;
      }
      if (!cCheck.valid) {
        appsClientRef.current?.focus();
        return;
      }

      setBusyAction('submit');
      try {
        const probe = await probeAppsScriptEndpoint(uCheck.normalized);
        if (!probe.ok) {
          const msg =
            probe.error ||
            'Unable to verify the Google Apps Script Web App URL. Confirm deployment access is "Anyone".';
          setStatusFeedback({ kind: 'error', text: msg });
          onNotify('error', 'Apps Script verification failed', msg);
          return;
        }
        saveRuntimeBackendConfig({
          appsScriptUrl: uCheck.normalized,
          googleClientId: cCheck.normalized,
          configuredBy: user.email,
        });
        onLiveBackendActivated();
      } finally {
        setBusyAction('none');
      }
      return;
    }

    // Validate target spreadsheet inputs first
    if (sheetAction === 'create') {
      const titleErr = validateNewSheetTitle(newSheetTitle);
      setSheetTitleErr(titleErr);
      if (titleErr) {
        sheetTitleRef.current?.focus();
        return;
      }
    } else {
      const urlErr = validateExistingSheetField(sheetUrlOrId);
      setSheetUrlErr(urlErr);
      if (urlErr) {
        sheetUrlRef.current?.focus();
        return;
      }
    }

    if (method === 'apps_script' && appsScriptMode === 'sandbox_bridge') {
      const uCheck = validateAppsScriptWebAppUrl(bridgeUrl);
      const kCheck = validateAppsScriptSyncKey(bridgeSyncKey);
      setBridgeUrlErr(uCheck.valid ? '' : `Error: ${uCheck.error || 'Invalid Apps Script /exec URL.'}`);
      setBridgeKeyErr(
        kCheck.valid ? '' : `Error: ${kCheck.error || 'Enter a 16+ character Sync Passphrase.'}`,
      );
      if (!uCheck.valid) {
        bridgeUrlRef.current?.focus();
        return;
      }
      if (!kCheck.valid) {
        bridgeKeyRef.current?.focus();
        return;
      }
      if (!api.connectAppsScriptBridge) {
        setStatusFeedback({
          kind: 'error',
          text: 'Apps Script Sync Bridge is unavailable in this session mode.',
        });
        return;
      }

      onToggleOpen(true);
      setBusyAction('submit');
      try {
        const res = await api.connectAppsScriptBridge({
          appsScriptUrl: uCheck.normalized,
          syncKey: kCheck.normalized,
          targetMode: sheetAction,
          sheetTitle: sheetAction === 'create' ? newSheetTitle.trim() : undefined,
          spreadsheetUrlOrId: sheetAction === 'existing' ? sheetUrlOrId.trim() : undefined,
          initializeSchema: true,
        });
        if (!res.ok || !res.data) {
          const msg = res.error || 'Unable to connect via Apps Script Sync Bridge.';
          setStatusFeedback({ kind: 'error', text: msg });
          onNotify('error', 'Apps Script Sync Bridge connection failed', msg);
          return;
        }
        onConnectionChanged(res.data.connection);
        await onSynced();
        await refreshPreview();
        await refreshTeamIntakeSetup();
        onEnvironmentChanged();
        const summaryMsg =
          res.data.syncSummary?.message ||
          `Connected "${res.data.connection.spreadsheetName}" via Apps Script Sync Bridge.`;
        setStatusFeedback({ kind: 'success', text: summaryMsg });
        onNotify(
          'success',
          sheetAction === 'create'
            ? `Live Sheet created: ${res.data.connection.spreadsheetName}`
            : 'Apps Script Bridge connected',
          summaryMsg,
        );
        setDetailsOpen(false);
      } finally {
        setBusyAction('none');
      }
      return;
    }

    if (method === 'direct_browser') {
      const clientCheck = validateGoogleOAuthClientId(directClientId);
      if (!clientCheck.valid) {
        const msg = `Error: ${clientCheck.error || 'Enter a valid Google OAuth Web Client ID.'}`;
        setDirectClientErr(msg);
        directClientRef.current?.focus();
        return;
      }

      onToggleOpen(true);
      setBusyAction('submit');
      try {
        const normalizedClientId = saveDirectGoogleClientId(clientCheck.normalized);

        const res =
          sheetAction === 'create'
            ? await api.createGoogleSheet({
                title: newSheetTitle.trim(),
                googleAccount: user.email,
                directClientId: normalizedClientId,
                forceDirectOAuth: true,
              })
            : await api.connectGoogleSheet({
                spreadsheetUrlOrId: sheetUrlOrId.trim(),
                spreadsheetName: sheetLabel.trim() || undefined,
                initializeSchema: true,
                googleAccount: user.email,
                directClientId: normalizedClientId,
                forceDirectOAuth: true,
              });

        if (!res.ok || !res.data) {
          const msg = res.error || 'Unable to authorize and sync with Google Sheets.';
          setStatusFeedback({ kind: 'error', text: msg });
          onNotify('error', 'Google Sheets sync failed', msg);
          return;
        }

        onConnectionChanged(res.data);
        await onSynced();
        await refreshPreview();
        onEnvironmentChanged();
        const summaryMsg =
          res.data.lastSyncMessage ||
          `Pushed data to live Google Sheet "${res.data.spreadsheetName}".`;
        setStatusFeedback({ kind: 'success', text: summaryMsg });
        onNotify(
          'success',
          sheetAction === 'create'
            ? `Live Sheet created: ${res.data.spreadsheetName}`
            : 'Live Google Sheet synced',
          summaryMsg,
        );
        setDetailsOpen(false);
      } finally {
        setBusyAction('none');
      }
      return;
    }

    // Hosted /api/sheets backend flow
    onToggleOpen(true);
    setBusyAction('submit');
    try {
      const probeRes = await handleSaveAndProbeHostedBackend(true);
      if (!probeRes.readyToWrite) {
        return;
      }

      const res =
        sheetAction === 'create'
          ? await api.createGoogleSheet({
              title: newSheetTitle.trim(),
              googleAccount: user.email,
            })
          : await api.connectGoogleSheet({
              spreadsheetUrlOrId: sheetUrlOrId.trim(),
              spreadsheetName: sheetLabel.trim() || undefined,
              initializeSchema: true,
              googleAccount: user.email,
            });

      if (!res.ok || !res.data) {
        onEnvironmentChanged();
        const msg = res.error || 'Hosted backend could not configure the target Google Sheet.';
        setStatusFeedback({ kind: 'error', text: msg });
        onNotify('error', 'Google Sheets sync failed', msg);
        return;
      }

      onConnectionChanged(res.data);
      const syncRes = await api.syncAllToGoogleSheet();
      const latestConn = await api.getSheetsConnection();
      if (latestConn.ok && latestConn.data) {
        onConnectionChanged(latestConn.data);
      }
      await onSynced();
      await refreshPreview();
      onEnvironmentChanged();

      const summaryMsg =
        syncRes.ok && syncRes.data
          ? syncRes.data.message
          : res.data.lastSyncMessage || `Connected "${res.data.spreadsheetName}".`;
      setStatusFeedback({ kind: 'success', text: summaryMsg });
      onNotify(
        'success',
        sheetAction === 'create'
          ? `Live Sheet created: ${res.data.spreadsheetName}`
          : 'Live Google Sheet synced',
        summaryMsg,
      );
      setDetailsOpen(false);
    } finally {
      setBusyAction('none');
    }
  };

  const handleDisconnectConfirm = async () => {
    setBusyAction('disconnect');
    try {
      const res = await api.disconnectGoogleSheet();
      setConfirmDisconnect(false);
      if (!res.ok || !res.data) {
        const msg = res.error || 'Could not disconnect Google Sheet.';
        setStatusFeedback({ kind: 'error', text: msg });
        onNotify('error', 'Disconnect failed', msg);
        return;
      }
      onConnectionChanged(res.data);
      setStatusFeedback({
        kind: 'info',
        text: 'Disconnected browser link safely. Spreadsheet data in Google Drive remains untouched.',
      });
      onNotify(
        'success',
        'Google Sheet link disconnected',
        'All records already saved in Google Drive stay intact.',
      );
      setDetailsOpen(true);
    } finally {
      setBusyAction('none');
    }
  };

  const handleRotateTeamIntakeKey = async () => {
    if (rotatingIntakeKey || !api.rotateTeamIntakeKey) return;
    setRotatingIntakeKey(true);
    try {
      const res = await api.rotateTeamIntakeKey();
      if (!res.ok || !res.data) {
        onNotify('error', 'Could not rotate Team Submission Key', res.error);
        return;
      }
      setTeamIntakeSetup(res.data);
      onNotify(
        'success',
        'Team Submission Link rotated',
        'A fresh multi-device submission link is ready. Older intake links are now inactive.',
      );
    } finally {
      setRotatingIntakeKey(false);
    }
  };

  const currentApprovalMode: FacilitatorApprovalMode =
    config.policy.facilitatorApprovalMode ??
    teamIntakeSetup?.approvalMode ??
    'manual_allowlist';

  const handleSetApprovalMode = async (nextMode: FacilitatorApprovalMode) => {
    if (savingApprovalMode || nextMode === currentApprovalMode) return;
    setSavingApprovalMode(true);
    try {
      const res = await api.saveAppConfiguration({
        policy: {
          ...config.policy,
          facilitatorApprovalMode: nextMode,
        },
      });
      if (!res.ok || !res.data) {
        onNotify('error', 'Could not update Facilitator Access Policy', res.error);
        return;
      }
      onConfigUpdated?.(res.data);
      setTeamIntakeSetup((prev) => (prev ? { ...prev, approvalMode: nextMode } : prev));
      onNotify(
        'success',
        'Facilitator Access Policy updated',
        nextMode === 'auto_approve'
          ? 'Team members using your Team Submission Link can sign in and submit directly.'
          : 'Only facilitators pre-approved in User Management can sign in and submit.',
      );
    } finally {
      setSavingApprovalMode(false);
    }
  };

  const validateSbWebhook = (val: string): string => {
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
    const err = validateSbWebhook(targetUrl);
    setSbWebhookErr(err);
    if (err) {
      sbWebhookRef.current?.focus();
      return;
    }
    if (!api.testSheetsWebhook) return;
    setSbTestingWebhook(true);
    setStatusFeedback(null);
    try {
      const res = await api.testSheetsWebhook(
        targetUrl,
        parseGoogleSpreadsheetId(sheetUrlOrId) || DEFAULT_TARGET_SPREADSHEET_ID,
      );
      if (!res.ok || !res.data) {
        const msg = res.error || 'Webhook probe failed.';
        setStatusFeedback({ kind: 'error', text: msg });
        onNotify('error', 'Apps Script webhook test failed', msg);
        return;
      }
      setStatusFeedback({
        kind: res.data.reachable ? 'success' : 'error',
        text: res.data.message,
      });
      onNotify(
        res.data.reachable ? 'success' : 'warning',
        'Apps Script webhook tested',
        res.data.message,
      );
    } finally {
      setSbTestingWebhook(false);
    }
  };

  const handleSbQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusFeedback(null);

    const urlErr = validateExistingSheetField(sheetUrlOrId);
    const hookErr = validateSbWebhook(sbWebhookUrl);
    setSheetUrlErr(urlErr);
    setSbWebhookErr(hookErr);
    if (urlErr) {
      sheetUrlRef.current?.focus();
      return;
    }
    if (hookErr) {
      sbWebhookRef.current?.focus();
      return;
    }

    onToggleOpen(true);
    setBusyAction('submit');
    try {
      const res = await api.connectGoogleSheet({
        spreadsheetUrlOrId: sheetUrlOrId.trim(),
        spreadsheetName: sheetLabel.trim() || undefined,
        googleAccount: user.email,
        ...(sbWebhookUrl.trim() ? { appsScriptUrl: sbWebhookUrl.trim() } : {}),
      });
      if (!res.ok || !res.data) {
        const msg = res.error || 'Could not save Google Sheets mirror settings.';
        setStatusFeedback({ kind: 'error', text: msg });
        onNotify('error', 'Google Sheets mirror failed', msg);
        return;
      }

      onConnectionChanged(res.data);
      const syncRes = await api.syncAllToGoogleSheet(
        sbWebhookUrl.trim() ? { appsScriptUrl: sbWebhookUrl.trim() } : undefined,
      );
      const latestConn = await api.getSheetsConnection();
      if (latestConn.ok && latestConn.data) {
        onConnectionChanged(latestConn.data);
      }
      await onSynced();
      await refreshPreview();
      onEnvironmentChanged();

      if (syncRes.ok && syncRes.data) {
        setStatusFeedback({ kind: 'success', text: syncRes.data.message });
        onNotify('success', 'Google Sheets mirror updated', syncRes.data.message);
        setDetailsOpen(false);
      } else {
        const msg = sbWebhookUrl.trim()
          ? `Saved spreadsheet link in Supabase, but webhook push returned: ${syncRes.error || 'Check Web App deployment.'}`
          : `Linked "${res.data.spreadsheetName}" in Supabase PostgreSQL. Add and test an Apps Script /exec URL to push rows automatically.`;
        setStatusFeedback({ kind: sbWebhookUrl.trim() ? 'error' : 'info', text: msg });
        onNotify(
          sbWebhookUrl.trim() ? 'warning' : 'success',
          'Google Sheets mirror settings saved',
          msg,
        );
      }
    } finally {
      setBusyAction('none');
    }
  };

  const showTeamShareStrip = !isSupabaseMode && Boolean(teamShareUrl);
  const parsedExistingId = parseGoogleSpreadsheetId(sheetUrlOrId);
  const canShowQuickPush = Boolean(
    hasLinkedSheet &&
      (isSupabaseMode ||
        connection?.authMethod === 'google_oauth' ||
        connection?.authMethod === 'apps_script' ||
        connection?.connectionProvider === 'apps_script' ||
        isLiveBackend) &&
      connection?.spreadsheetId,
  );

  return (
    <aside
      aria-labelledby={regionId}
      className="w-full max-w-[1220px] mx-auto px-4 sm:px-6 mb-5"
    >
      <div
        className={`rounded-2xl bg-[#FFFFFF]/95 border shadow-[0_8px_26px_rgba(10,27,44,0.06)] transition-colors ${
          needsDirectReauth
            ? 'border-[#B45309]/45'
            : isEffectiveLive && hasLinkedSheet
              ? 'border-[#137333]/30'
              : 'border-[#DFD7C2]'
        }`}
      >
        {/* Top Summary Strip */}
        <div
          className={`px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 bg-[#FAF8F2]/80 ${
            detailsOpen || showTeamShareStrip ? 'rounded-t-2xl' : 'rounded-2xl'
          }`}
        >
          <div className="flex items-start sm:items-center gap-2.5 min-w-0 max-w-full flex-1 basis-[260px]">
            <div
              className={`w-8 h-8 rounded-lg border inline-flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${
                needsDirectReauth
                  ? 'bg-[#FFFBEB] border-[#B45309]/30'
                  : 'bg-[#E6F4EA] border-[#137333]/25'
              }`}
            >
              <GoogleSheetsIcon className="w-4 h-4" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={regionId} className="text-xs sm:text-sm font-medium text-[#0A1B2C]">
                  {isSupabaseMode ? 'Google Sheets Webhook Mirror' : 'Quick Google Sheet Sync'}
                </h2>
                {isSupabaseMode ? (
                  hasLinkedSheet ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                      <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                      Supabase DB + Sheets Mirror
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                      <Database className="w-3 h-3" aria-hidden="true" />
                      Supabase Primary DB
                    </span>
                  )
                ) : isEffectiveLive && hasLinkedSheet ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                    Google Sheets Live
                  </span>
                ) : needsDirectReauth ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFBEB] border border-[#B45309]/40 text-[#92400E]">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                    Re-authorize Direct Google OAuth
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFBEB] border border-[#B45309]/35 text-[#92400E]">
                    <Database className="w-3 h-3" aria-hidden="true" />
                    Device Storage · Push Live
                  </span>
                )}
              </div>

              <div className="text-[11px] text-[#243647] ct-num flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                <span>
                  {preview.sessionsCount} session{preview.sessionsCount === 1 ? '' : 's'}
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    preview.unsyncedSessionsCount > 0 ? 'font-medium text-[#92400E]' : undefined
                  }
                >
                  {preview.unsyncedSessionsCount} pending sync
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {preview.schoolsCount} school{preview.schoolsCount === 1 ? '' : 's'}
                </span>
                {connection?.connected && connection?.spreadsheetName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="break-words min-w-0 max-w-full sm:truncate sm:max-w-[340px] text-[#0A1B2C]">
                      Sheet: {connection.spreadsheetName}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            {connection?.connected && connection?.spreadsheetUrl && (
              <a
                href={connection.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1 border-[#137333]/35 text-[#137333] hover:border-[#137333]"
              >
                <span>Open Live Sheet</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}

            {canShowQuickPush && (
              <button
                type="button"
                disabled={busyAction !== 'none'}
                onClick={() => void handlePushPendingOnly()}
                className="inline-flex items-center justify-center gap-1.5 min-h-[34px] px-3 py-1 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs font-medium border border-[#0D652D] cursor-pointer disabled:opacity-55"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${busyAction === 'push' ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {needsDirectReauth
                    ? preview.unsyncedSessionsCount > 0
                      ? `Authorize & Push Pending (${preview.unsyncedSessionsCount})`
                      : 'Authorize Live Sync'
                    : busyAction === 'push'
                      ? 'Pushing…'
                      : 'Push Data Now'}
                </span>
              </button>
            )}

            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={panelBodyId}
              onClick={() => {
                detailsUserToggledRef.current = true;
                setDetailsOpen((v) => !v);
              }}
              className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
            >
              <span>{detailsOpen ? 'Collapse' : 'Configure Sync'}</span>
              {detailsOpen ? (
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onToggleOpen(false)}
              aria-label="Hide quick Google Sheet sync bar"
              className="min-w-[34px] min-h-[34px] inline-flex items-center justify-center rounded-lg text-[#243647] hover:bg-[#EFE8D6] hover:text-[#0A1B2C] cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Team Multi-Device Submission Link & Access Policy */}
        {showTeamShareStrip && (
          <div
            className={`px-4 py-2.5 border-t border-[#DFD7C2] bg-[#ECFDF5]/55 flex flex-col gap-2 text-xs ${
              detailsOpen ? '' : 'rounded-b-2xl'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium text-[#0A1B2C]">
                <Link2 className="w-3.5 h-3.5 text-[#047857] shrink-0" aria-hidden="true" />
                <span>Team Multi-Device Submission Link</span>
                <span className="text-[11px] font-normal text-[#243647]">
                  (Share with facilitators so their entries flow straight into your admin dashboard — zero admin secret exposed)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Facilitator Access Policy"
                  className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2]"
                >
                  <button
                    type="button"
                    disabled={savingApprovalMode}
                    aria-pressed={currentApprovalMode === 'manual_allowlist'}
                    onClick={() => void handleSetApprovalMode('manual_allowlist')}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                      currentApprovalMode === 'manual_allowlist'
                        ? 'bg-[#E8F6FF] text-[#006BB8] border border-[#0284C7]/35'
                        : 'text-[#243647] hover:text-[#0A1B2C]'
                    }`}
                  >
                    Manual Allowlist
                  </button>
                  <button
                    type="button"
                    disabled={savingApprovalMode}
                    aria-pressed={currentApprovalMode === 'auto_approve'}
                    onClick={() => void handleSetApprovalMode('auto_approve')}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                      currentApprovalMode === 'auto_approve'
                        ? 'bg-[#E6F4EA] text-[#137333] border border-[#137333]/35'
                        : 'text-[#243647] hover:text-[#0A1B2C]'
                    }`}
                  >
                    Auto-Approve via Team Link
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px] px-2.5 py-1.5 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] font-mono text-[11px] text-[#0A1B2C] truncate">
                <code id={teamShareCodeId}>{teamShareUrl}</code>
              </div>
              <span className="ct-copy-wrap shrink-0">
                <button
                  type="button"
                  className="ct-btn-secondary ct-copy-btn text-xs min-h-[32px] px-2.5 py-1"
                  {...({
                    command: '--copy',
                    commandfor: teamShareCodeId,
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
              {api.rotateTeamIntakeKey && teamIntakeSetup?.intakeKey && (
                <button
                  type="button"
                  disabled={rotatingIntakeKey}
                  onClick={() => void handleRotateTeamIntakeKey()}
                  className="ct-btn-secondary text-xs min-h-[32px] px-2.5 py-1 shrink-0"
                >
                  <RotateCcw
                    className={`w-3.5 h-3.5 ${rotatingIntakeKey ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{rotatingIntakeKey ? 'Rotating…' : 'Rotate Team Key'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Expanded Sync Configuration & One-Click Live Push Form */}
        {detailsOpen && (
          <div id={panelBodyId} className="p-4 border-t border-[#DFD7C2] space-y-3.5 text-xs sm:text-sm">
            {/* Single polite status announcer */}
            <div role="status" aria-live="polite" className="visually-hidden">
              {statusFeedback?.kind !== 'error' ? statusFeedback?.text || '' : ''}
            </div>

            {statusFeedback && (
              <div
                role={statusFeedback.kind === 'error' ? 'alert' : undefined}
                className={`p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
                  statusFeedback.kind === 'error'
                    ? 'bg-[#FFF1F2] border-[#BE123C]/40 text-[#BE123C]'
                    : statusFeedback.kind === 'success'
                      ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                      : 'bg-[#E8F6FF]/80 border-[#0284C7]/35 text-[#0A1B2C]'
                }`}
              >
                <span className="flex items-start gap-2 min-w-0">
                  {statusFeedback.kind === 'error' ? (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <span>{statusFeedback.text}</span>
                </span>
                {hostedOAuthPendingUrl && (
                  <button
                    type="button"
                    onClick={() => window.location.assign(hostedOAuthPendingUrl)}
                    className="ct-btn-primary text-xs min-h-[34px] px-3 py-1"
                  >
                    Authorize Google Account Now
                  </button>
                )}
              </div>
            )}

            {isSupabaseMode ? (
              <form onSubmit={(e) => void handleSbQuickSubmit(e)} noValidate className="space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-[#243647]">
                    <strong>Supabase PostgreSQL</strong> is your primary permanent database. Link an
                    existing Google Sheet and Apps Script (<code className="font-mono">/exec</code>)
                    webhook to mirror rows via Edge Function{' '}
                    <code className="font-mono">google-sheets-sync</code>.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={onOpenSyncStatus}
                      className="text-xs font-medium text-[#006BB8] hover:underline cursor-pointer"
                    >
                      Open Full Sync Status &amp; Retry Queue
                    </button>
                    {connection?.connected && !confirmDisconnect && (
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(true)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#BE123C] hover:underline cursor-pointer"
                      >
                        <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Disconnect</span>
                      </button>
                    )}
                  </div>
                </div>

                {confirmDisconnect && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/35 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0A1B2C]"
                  >
                    <span>
                      Disconnect Google Sheets mirror? Records in Supabase PostgreSQL and Google
                      Drive remain intact.
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(false)}
                        className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                      >
                        Keep link
                      </button>
                      <button
                        type="button"
                        disabled={busyAction === 'disconnect'}
                        onClick={() => void handleDisconnectConfirm()}
                        className="ct-btn-danger text-xs min-h-[34px] px-3 py-1"
                      >
                        {busyAction === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
                  <div className="lg:col-span-6 min-w-0 p-3 rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] space-y-2.5">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor={existingUrlInputId}
                          className="text-xs font-medium text-[#0A1B2C]"
                        >
                          Target Google Sheet URL or ID <span aria-hidden="true">*</span>
                        </label>
                        <div className="flex items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => {
                              setSheetUrlOrId(DEFAULT_TARGET_SPREADSHEET_URL);
                              setSheetUrlErr('');
                            }}
                            className="text-[#137333] hover:underline cursor-pointer"
                          >
                            Official sheet
                          </button>
                          {parsedExistingId && (
                            <a
                              href={`https://docs.google.com/spreadsheets/d/${parsedExistingId}/edit`}
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
                      <p id={existingUrlHintId} className="text-[11px] text-[#243647] mb-1">
                        Full <code className="font-mono">docs.google.com/spreadsheets/d/…</code> link or
                        Spreadsheet ID.
                      </p>
                      <input
                        ref={sheetUrlRef}
                        id={existingUrlInputId}
                        name="sb_quick_existing_sheet_url"
                        type="text"
                        required
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={sheetUrlOrId}
                        aria-invalid={sheetUrlErr ? 'true' : 'false'}
                        aria-describedby={
                          sheetUrlErr
                            ? `${existingUrlHintId} ${existingUrlErrId}`
                            : existingUrlHintId
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setSheetUrlOrId(v);
                          if (sheetUrlErr) {
                            setSheetUrlErr(validateExistingSheetField(v));
                          }
                        }}
                        onBlur={() => {
                          if (!sheetUrlOrId.trim()) return;
                          setSheetUrlErr(validateExistingSheetField(sheetUrlOrId));
                        }}
                        placeholder={DEFAULT_TARGET_SPREADSHEET_URL}
                        className="ct-input text-xs font-mono"
                      />
                      {sheetUrlErr && (
                        <p
                          id={existingUrlErrId}
                          className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{sheetUrlErr}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor={existingLabelInputId}
                        className="block text-xs font-medium text-[#0A1B2C] mb-1"
                      >
                        Display Label (optional)
                      </label>
                      <input
                        id={existingLabelInputId}
                        name="sb_quick_existing_sheet_label"
                        type="text"
                        value={sheetLabel}
                        placeholder={computedRelativeTitle}
                        onChange={(e) => setSheetLabel(e.target.value)}
                        className="ct-input text-xs"
                      />
                    </div>
                  </div>

                  <div className="lg:col-span-6 min-w-0 p-3 rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] space-y-2.5">
                    <div>
                      <label
                        htmlFor={sbWebhookInputId}
                        className="block text-xs font-medium text-[#0A1B2C] mb-1"
                      >
                        Apps Script Web App Webhook URL (/exec)
                      </label>
                      <p id={sbWebhookHintId} className="text-[11px] text-[#243647] mb-1">
                        Leave blank to keep stored webhook, or paste{' '}
                        <code className="font-mono">https://script.google.com/macros/s/…/exec</code>.
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          ref={sbWebhookRef}
                          id={sbWebhookInputId}
                          name="sb_quick_webhook_url"
                          type="url"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={sbWebhookUrl}
                          placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                          aria-invalid={sbWebhookErr ? 'true' : 'false'}
                          aria-describedby={
                            sbWebhookErr
                              ? `${sbWebhookHintId} ${sbWebhookErrId}`
                              : sbWebhookHintId
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setSbWebhookUrl(v);
                            if (sbWebhookErr) {
                              setSbWebhookErr(v.trim() ? validateSbWebhook(v) : '');
                            }
                          }}
                          onBlur={() => {
                            if (!sbWebhookUrl.trim()) {
                              setSbWebhookErr('');
                              return;
                            }
                            setSbWebhookErr(validateSbWebhook(sbWebhookUrl));
                          }}
                          className="ct-input text-xs font-mono flex-1 min-w-[180px]"
                        />
                        {api.testSheetsWebhook && (
                          <button
                            type="button"
                            disabled={sbTestingWebhook || busyAction !== 'none'}
                            onClick={() => void handleSbTestWebhook()}
                            className="ct-btn-secondary text-xs min-h-[36px] px-2.5 py-1 shrink-0"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${sbTestingWebhook ? 'animate-spin' : ''}`}
                              aria-hidden="true"
                            />
                            <span>{sbTestingWebhook ? 'Testing…' : 'Test Webhook'}</span>
                          </button>
                        )}
                      </div>
                      {sbWebhookErr && (
                        <p
                          id={sbWebhookErrId}
                          className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{sbWebhookErr}</span>
                        </p>
                      )}
                    </div>

                    <details
                      className="rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] p-2.5 text-[11px] text-[#243647]"
                      onToggle={(e) => {
                        if (e.currentTarget.open) {
                          void ensureBridgeScriptLoaded();
                        }
                      }}
                    >
                      <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#137333]">
                        Copy or Download Apps Script (CareerToursAllInOne.gs)
                      </summary>
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="ct-copy-wrap">
                            <button
                              type="button"
                              className="ct-btn-secondary ct-copy-btn text-[11px] min-h-[28px] px-2 py-0.5"
                              {...({
                                command: '--copy',
                                commandfor: bridgeCodeId,
                              } as Record<string, string>)}
                            >
                              <span className="ct-copy-icon-idle inline-flex items-center gap-1">
                                <Copy className="w-3 h-3" aria-hidden="true" />
                                <span>Copy Script</span>
                              </span>
                              <span className="ct-copy-icon-done inline-flex items-center gap-1 text-[#137333]">
                                <Check className="w-3 h-3" aria-hidden="true" />
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
                            disabled={bridgeScriptLoading}
                            onClick={() => {
                              void ensureBridgeScriptLoaded().then((raw) => {
                                if (!raw) return;
                                const bundled = buildPersonalizedAppsScriptBundle(
                                  raw,
                                  normalizedValidBridgeKey,
                                  teamIntakeSetup?.intakeKey,
                                );
                                triggerAppsScriptBundleDownload(
                                  bundled,
                                  'CareerToursAllInOne.gs',
                                );
                                onNotify(
                                  'success',
                                  'Downloaded CareerToursAllInOne.gs',
                                  'Deploy Web App in script.google.com and paste its /exec URL above.',
                                );
                              });
                            }}
                            className="ct-btn-secondary text-[11px] min-h-[28px] px-2 py-0.5"
                          >
                            <Download className="w-3 h-3 text-[#137333]" aria-hidden="true" />
                            <span>Download .gs</span>
                          </button>
                        </div>
                        {bridgeScriptLoadErr ? (
                          <p className="text-[#BE123C]">{bridgeScriptLoadErr}</p>
                        ) : (
                          <div className="w-full overflow-hidden rounded border border-[#DFD7C2] bg-[#FAF8F2]">
                            <pre
                              tabIndex={0}
                              className="max-h-32 w-full overflow-auto p-2 text-[10px] font-mono text-[#0A1B2C]"
                            >
                              <code id={bridgeCodeId}>
                                {bridgeScriptLoading
                                  ? '// Loading CareerToursAllInOne.gs…'
                                  : personalizedBridgeScript ||
                                    '// Open to load CareerToursAllInOne.gs'}
                              </code>
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>

                    <div className="pt-1 flex justify-end">
                      <button
                        type="submit"
                        disabled={busyAction !== 'none'}
                        className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                      >
                        <GoogleSheetsIcon className="w-4 h-4 shrink-0" variant="inverted" />
                        <span>
                          {busyAction === 'submit'
                            ? 'Saving & Pushing…'
                            : 'Save & Sync Mirror Sheet'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            ) : (
            <form onSubmit={(e) => void handleSubmitSync(e)} noValidate className="space-y-3.5">
              {/* Connection Method Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="group"
                  aria-label="Google Sheets sync method"
                  className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] max-w-full"
                >
                  {(
                    [
                      ['direct_browser', 'Direct Google Sign-In'],
                      ['sheets_backend', 'Hosted /api/sheets'],
                      ['apps_script', 'Apps Script Web App'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={method === value}
                      onClick={() => {
                        methodUserToggledRef.current = true;
                        setMethod(value);
                        clearValidationErrors();
                        setStatusFeedback(null);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        method === value
                          ? 'bg-[#FFFFFF] text-[#0A1B2C] border border-[#0284C7]/50 shadow-2xs'
                          : 'text-[#243647] hover:text-[#0A1B2C]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenSyncStatus}
                    className="text-xs font-medium text-[#006BB8] hover:underline cursor-pointer"
                  >
                    Open Full Sync Status &amp; Retry Queue
                  </button>
                  {connection?.connected && !confirmDisconnect && (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#BE123C] hover:underline cursor-pointer"
                    >
                      <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Disconnect</span>
                    </button>
                  )}
                </div>
              </div>

              {confirmDisconnect && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/35 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0A1B2C]"
                >
                  <span>
                    Disconnect spreadsheet link? Your live spreadsheet in Google Drive stays intact.
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(false)}
                      className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                    >
                      Keep link
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === 'disconnect'}
                      onClick={() => void handleDisconnectConfirm()}
                      className="ct-btn-danger text-xs min-h-[34px] px-3 py-1"
                    >
                      {busyAction === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}
                    </button>
                  </div>
                </div>
              )}

              {/* Grid: Left = Method Details, Right = Target Sheet (Create Relative Title or Existing URL/ID) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
                {/* Left Column: Method Credential / Endpoint */}
                <div className="lg:col-span-5 min-w-0 p-3 rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] space-y-2.5">
                  {method === 'direct_browser' && (
                    <div>
                      <label
                        htmlFor={directClientInputId}
                        className="block text-xs font-medium text-[#0A1B2C] mb-1"
                      >
                        Google OAuth 2.0 Web Client ID (Direct Sync) <span aria-hidden="true">*</span>
                      </label>
                      <p id={directClientHintId} className="text-[11px] text-[#243647] mb-1.5">
                        Public <code className="font-mono break-all">.apps.googleusercontent.com</code> ID — creates
                        your sheet and writes all 10 tabs straight from this browser with no backend
                        needed.
                      </p>
                      <input
                        ref={directClientRef}
                        id={directClientInputId}
                        name="quick_direct_google_client_id"
                        type="text"
                        required
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={directClientId}
                        aria-invalid={directClientErr ? 'true' : 'false'}
                        aria-describedby={
                          directClientErr
                            ? `${directClientHintId} ${directClientErrId}`
                            : directClientHintId
                        }
                        placeholder="1234567890-abcdef.apps.googleusercontent.com"
                        onChange={(e) => {
                          const v = e.target.value;
                          setDirectClientId(v);
                          if (directClientErr) {
                            const check = validateGoogleOAuthClientId(v);
                            setDirectClientErr(check.valid ? '' : `Error: ${check.error || ''}`);
                          }
                        }}
                        onBlur={() => {
                          if (!directClientId.trim()) return;
                          const check = validateGoogleOAuthClientId(directClientId);
                          setDirectClientErr(check.valid ? '' : `Error: ${check.error || ''}`);
                        }}
                        className="ct-input text-xs font-mono"
                      />
                      {directClientErr && (
                        <p
                          id={directClientErrId}
                          className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{directClientErr}</span>
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-[#33475B] flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#047857] shrink-0" aria-hidden="true" />
                        <span>OAuth access token stays strictly in browser memory (zero storage).</span>
                      </p>
                    </div>
                  )}

                  {method === 'sheets_backend' && (
                    <div className="space-y-2">
                      <div>
                        <label
                          htmlFor={hostedUrlInputId}
                          className="block text-xs font-medium text-[#0A1B2C] mb-1"
                        >
                          Hosted /api/sheets Backend URL <span aria-hidden="true">*</span>
                        </label>
                        <p id={hostedUrlHintId} className="text-[11px] text-[#243647] mb-1.5">
                          Same-origin <code className="font-mono">/api/sheets</code> or hosted HTTPS
                          endpoint (for example <code className="font-mono">https://…/api/sheets</code>).
                        </p>
                        <input
                          ref={hostedUrlRef}
                          id={hostedUrlInputId}
                          name="quick_hosted_sheets_url"
                          type="text"
                          required
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={hostedBackendUrl}
                          aria-invalid={hostedUrlErr ? 'true' : 'false'}
                          aria-describedby={
                            hostedUrlErr ? `${hostedUrlHintId} ${hostedUrlErrId}` : hostedUrlHintId
                          }
                          placeholder="/api/sheets"
                          onChange={(e) => {
                            const v = e.target.value;
                            setHostedBackendUrl(v);
                            if (hostedUrlErr) {
                              const check = validateSheetsBackendUrl(v);
                              setHostedUrlErr(check.valid ? '' : `Error: ${check.error || ''}`);
                            }
                          }}
                          onBlur={() => {
                            if (!hostedBackendUrl.trim()) return;
                            const check = validateSheetsBackendUrl(hostedBackendUrl);
                            setHostedUrlErr(check.valid ? '' : `Error: ${check.error || ''}`);
                          }}
                          className="ct-input text-xs font-mono"
                        />
                        {hostedUrlErr && (
                          <p
                            id={hostedUrlErrId}
                            className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{hostedUrlErr}</span>
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={busyAction !== 'none'}
                        onClick={() => {
                          setBusyAction('save_backend');
                          void handleSaveAndProbeHostedBackend().finally(() => setBusyAction('none'));
                        }}
                        className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                      >
                        <Link2 className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
                        <span>
                          {busyAction === 'save_backend'
                            ? 'Checking endpoint…'
                            : 'Save & Check /api/sheets'}
                        </span>
                      </button>
                    </div>
                  )}

                  {method === 'apps_script' && (
                    <div className="space-y-2.5">
                      <div
                        role="group"
                        aria-label="Apps Script connection mode"
                        className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] max-w-full"
                      >
                        <button
                          type="button"
                          aria-pressed={appsScriptMode === 'sandbox_bridge'}
                          onClick={() => {
                            setAppsScriptMode('sandbox_bridge');
                            clearValidationErrors();
                          }}
                          className={`px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                            appsScriptMode === 'sandbox_bridge'
                              ? 'bg-[#E6F4EA] text-[#137333] border border-[#137333]/35'
                              : 'text-[#243647] hover:text-[#0A1B2C]'
                          }`}
                        >
                          Apps Script Sync Bridge
                        </button>
                        <button
                          type="button"
                          aria-pressed={appsScriptMode === 'oauth_webapp'}
                          onClick={() => {
                            setAppsScriptMode('oauth_webapp');
                            clearValidationErrors();
                          }}
                          className={`px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                            appsScriptMode === 'oauth_webapp'
                              ? 'bg-[#E6F4EA] text-[#137333] border border-[#137333]/35'
                              : 'text-[#243647] hover:text-[#0A1B2C]'
                          }`}
                        >
                          Google Sign-In Web App
                        </button>
                      </div>

                      {appsScriptMode === 'sandbox_bridge' ? (
                        <div className="space-y-2.5">
                          <div>
                            <label
                              htmlFor={bridgeKeyInputId}
                              className="block text-xs font-medium text-[#0A1B2C] mb-1"
                            >
                              Sync Bridge Passphrase <span aria-hidden="true">*</span>
                            </label>
                            <p id={bridgeKeyHintId} className="text-[11px] text-[#243647] mb-1">
                              16+ characters without spaces; synced only with Apps Script Script
                              Properties.
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <input
                                ref={bridgeKeyRef}
                                id={bridgeKeyInputId}
                                name="quick_bridge_sync_key"
                                type="text"
                                required
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                value={bridgeSyncKey}
                                aria-invalid={bridgeKeyErr ? 'true' : 'false'}
                                aria-describedby={
                                  bridgeKeyErr
                                    ? `${bridgeKeyHintId} ${bridgeKeyErrId}`
                                    : bridgeKeyHintId
                                }
                                placeholder="VV-SYNC-..."
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setBridgeSyncKey(v);
                                  if (bridgeKeyErr) {
                                    const check = validateAppsScriptSyncKey(v);
                                    setBridgeKeyErr(check.valid ? '' : `Error: ${check.error || ''}`);
                                  }
                                }}
                                onBlur={() => {
                                  if (!bridgeSyncKey.trim()) return;
                                  const check = validateAppsScriptSyncKey(bridgeSyncKey);
                                  setBridgeKeyErr(check.valid ? '' : `Error: ${check.error || ''}`);
                                }}
                                className="ct-input text-xs font-mono flex-1 min-w-[150px]"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setBridgeSyncKey(generateAppsScriptSyncKey());
                                  setBridgeKeyErr('');
                                }}
                                className="ct-btn-secondary text-[11px] min-h-[34px] px-2.5 py-1 shrink-0"
                              >
                                Generate
                              </button>
                            </div>
                            {bridgeKeyErr && (
                              <p
                                id={bridgeKeyErrId}
                                className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5"
                              >
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{bridgeKeyErr}</span>
                              </p>
                            )}
                          </div>

                          <div>
                            <label
                              htmlFor={bridgeUrlInputId}
                              className="block text-xs font-medium text-[#0A1B2C] mb-1"
                            >
                              Bridge Apps Script /exec URL <span aria-hidden="true">*</span>
                            </label>
                            <p id={bridgeUrlHintId} className="text-[11px] text-[#243647] mb-1">
                              Format: <code className="font-mono">https://script.google.com/macros/s/…/exec</code>
                            </p>
                            <input
                              ref={bridgeUrlRef}
                              id={bridgeUrlInputId}
                              name="quick_bridge_apps_script_url"
                              type="url"
                              required
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              value={bridgeUrl}
                              aria-invalid={bridgeUrlErr ? 'true' : 'false'}
                              aria-describedby={
                                bridgeUrlErr
                                  ? `${bridgeUrlHintId} ${bridgeUrlErrId}`
                                  : bridgeUrlHintId
                              }
                              placeholder="https://script.google.com/macros/s/.../exec"
                              onChange={(e) => {
                                const v = e.target.value;
                                setBridgeUrl(v);
                                if (bridgeUrlErr) {
                                  const check = validateAppsScriptWebAppUrl(v);
                                  setBridgeUrlErr(check.valid ? '' : `Error: ${check.error || ''}`);
                                }
                              }}
                              onBlur={() => {
                                if (!bridgeUrl.trim()) return;
                                const check = validateAppsScriptWebAppUrl(bridgeUrl);
                                setBridgeUrlErr(check.valid ? '' : `Error: ${check.error || ''}`);
                              }}
                              className="ct-input text-xs font-mono"
                            />
                            {bridgeUrlErr && (
                              <p
                                id={bridgeUrlErrId}
                                className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5"
                              >
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{bridgeUrlErr}</span>
                              </p>
                            )}
                          </div>

                          <details
                            className="rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] p-2.5 text-[11px] text-[#243647]"
                            onToggle={(e) => {
                              if (e.currentTarget.open) {
                                void ensureBridgeScriptLoaded();
                              }
                            }}
                          >
                            <summary className="cursor-pointer font-medium text-[#0A1B2C] select-none hover:text-[#137333]">
                              Get Personalized CareerToursAllInOne.gs Script
                            </summary>
                            <div className="mt-2 space-y-2">
                              <p className="leading-relaxed">
                                Paste into <strong>script.google.com</strong>, run{' '}
                                <code className="font-mono text-[#006BB8]">setupForLocalSandbox</code>{' '}
                                once, then deploy Web App (Execute as: Me, Access: Anyone).
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="ct-copy-wrap">
                                  <button
                                    type="button"
                                    className="ct-btn-secondary ct-copy-btn text-[11px] min-h-[28px] px-2 py-0.5"
                                    {...({
                                      command: '--copy',
                                      commandfor: bridgeCodeId,
                                    } as Record<string, string>)}
                                  >
                                    <span className="ct-copy-icon-idle inline-flex items-center gap-1">
                                      <Copy className="w-3 h-3" aria-hidden="true" />
                                      <span>Copy Script</span>
                                    </span>
                                    <span className="ct-copy-icon-done inline-flex items-center gap-1 text-[#137333]">
                                      <Check className="w-3 h-3" aria-hidden="true" />
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
                                  disabled={bridgeScriptLoading}
                                  onClick={() => {
                                    void ensureBridgeScriptLoaded().then((raw) => {
                                      if (!raw) return;
                                      const bundled = buildPersonalizedAppsScriptBundle(
                                        raw,
                                        normalizedValidBridgeKey,
                                        teamIntakeSetup?.intakeKey,
                                      );
                                      triggerAppsScriptBundleDownload(bundled, 'CareerToursAllInOne.gs');
                                      onNotify(
                                        'success',
                                        'Downloaded CareerToursAllInOne.gs',
                                        'Paste into script.google.com and run setupForLocalSandbox() once.',
                                      );
                                    });
                                  }}
                                  className="ct-btn-secondary text-[11px] min-h-[28px] px-2 py-0.5"
                                >
                                  <Download className="w-3 h-3 text-[#137333]" aria-hidden="true" />
                                  <span>Download .gs</span>
                                </button>
                              </div>
                              {bridgeScriptLoadErr ? (
                                <p className="text-[#BE123C]">{bridgeScriptLoadErr}</p>
                              ) : (
                                <div className="w-full overflow-hidden rounded border border-[#DFD7C2] bg-[#FAF8F2]">
                                  <pre
                                    tabIndex={0}
                                    className="max-h-36 w-full overflow-auto p-2 text-[10px] font-mono text-[#0A1B2C]"
                                  >
                                    <code id={bridgeCodeId}>
                                      {bridgeScriptLoading
                                        ? '// Loading CareerToursAllInOne.gs…'
                                        : personalizedBridgeScript ||
                                          '// Open to load CareerToursAllInOne.gs'}
                                    </code>
                                  </pre>
                                </div>
                              )}
                            </div>
                          </details>
                        </div>
                      ) : (
                        <>
                          <div>
                            <label
                              htmlFor={appsUrlInputId}
                              className="block text-xs font-medium text-[#0A1B2C] mb-1"
                            >
                              Apps Script /exec Web App URL <span aria-hidden="true">*</span>
                            </label>
                            <p id={appsUrlHintId} className="text-[11px] text-[#243647] mb-1">
                              Format: <code className="font-mono">https://script.google.com/macros/s/…/exec</code>
                            </p>
                            <input
                              ref={appsUrlRef}
                              id={appsUrlInputId}
                              name="quick_apps_script_url"
                              type="url"
                              required
                              value={appsScriptUrl}
                              aria-invalid={appsScriptUrlErr ? 'true' : 'false'}
                              aria-describedby={
                                appsScriptUrlErr ? `${appsUrlHintId} ${appsUrlErrId}` : appsUrlHintId
                              }
                              placeholder="https://script.google.com/macros/s/.../exec"
                              onChange={(e) => {
                                const v = e.target.value;
                                setAppsScriptUrl(v);
                                if (appsScriptUrlErr) {
                                  const check = validateAppsScriptWebAppUrl(v);
                                  setAppsScriptUrlErr(check.valid ? '' : `Error: ${check.error || ''}`);
                                }
                              }}
                              className="ct-input text-xs font-mono"
                            />
                            {appsScriptUrlErr && (
                              <p
                                id={appsUrlErrId}
                                className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5"
                              >
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{appsScriptUrlErr}</span>
                              </p>
                            )}
                          </div>

                          <div>
                            <label
                              htmlFor={appsClientInputId}
                              className="block text-xs font-medium text-[#0A1B2C] mb-1"
                            >
                              Apps Script OAuth Web Client ID <span aria-hidden="true">*</span>
                            </label>
                            <p id={appsClientHintId} className="text-[11px] text-[#243647] mb-1">
                              Public Client ID ending in <code className="font-mono">.apps.googleusercontent.com</code>
                            </p>
                            <input
                              ref={appsClientRef}
                              id={appsClientInputId}
                              name="quick_apps_script_client_id"
                              type="text"
                              required
                              value={appsScriptClientId}
                              aria-invalid={appsScriptClientErr ? 'true' : 'false'}
                              aria-describedby={
                                appsScriptClientErr
                                  ? `${appsClientHintId} ${appsClientErrId}`
                                  : appsClientHintId
                              }
                              placeholder="1234567890-abcdef.apps.googleusercontent.com"
                              onChange={(e) => {
                                const v = e.target.value;
                                setAppsScriptClientId(v);
                                if (appsScriptClientErr) {
                                  const check = validateGoogleOAuthClientId(v);
                                  setAppsScriptClientErr(
                                    check.valid ? '' : `Error: ${check.error || ''}`,
                                  );
                                }
                              }}
                              className="ct-input text-xs font-mono"
                            />
                            {appsScriptClientErr && (
                              <p
                                id={appsClientErrId}
                                className="mt-1 text-xs text-[#BE123C] flex items-start gap-1.5"
                              >
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{appsScriptClientErr}</span>
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Column: Target Sheet Details (Create Relative Title vs Connect Existing) */}
                <div className="lg:col-span-7 min-w-0 p-3 rounded-xl bg-[#FAF8F2] border border-[#DFD7C2] space-y-2.5">
                  {method !== 'apps_script' || appsScriptMode === 'sandbox_bridge' ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div
                          role="group"
                          aria-label="Target Google Sheet action"
                          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] max-w-full"
                        >
                          <button
                            type="button"
                            aria-pressed={sheetAction === 'create'}
                            onClick={() => {
                              setSheetAction('create');
                              setSheetUrlErr('');
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                              sheetAction === 'create'
                                ? 'bg-[#E6F4EA] text-[#137333] border border-[#137333]/35'
                                : 'text-[#243647] hover:text-[#0A1B2C]'
                            }`}
                          >
                            Create New Sheet (Relative Title)
                          </button>
                          <button
                            type="button"
                            aria-pressed={sheetAction === 'existing'}
                            onClick={() => {
                              setSheetAction('existing');
                              setSheetTitleErr('');
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                              sheetAction === 'existing'
                                ? 'bg-[#E6F4EA] text-[#137333] border border-[#137333]/35'
                                : 'text-[#243647] hover:text-[#0A1B2C]'
                            }`}
                          >
                            Connect Existing Sheet URL / ID
                          </button>
                        </div>
                      </div>

                      {sheetAction === 'create' ? (
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <label
                              htmlFor={titleInputId}
                              className="text-xs font-medium text-[#0A1B2C]"
                            >
                              New Live Excel / Google Sheet Title <span aria-hidden="true">*</span>
                            </label>
                            <button
                              type="button"
                              onClick={handleResetRelativeTitle}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#137333] hover:underline cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" aria-hidden="true" />
                              <span>Auto title</span>
                            </button>
                          </div>
                          <p id={titleHintId} className="text-[11px] text-[#243647] mb-1.5">
                            Generated from your real programme name, active district(s), and IST month;
                            creates all 10 formatted tabs and pushes local sessions &amp; schools.
                          </p>
                          <input
                            ref={sheetTitleRef}
                            id={titleInputId}
                            name="quick_new_spreadsheet_title"
                            type="text"
                            required
                            minLength={3}
                            maxLength={100}
                            value={newSheetTitle}
                            aria-invalid={sheetTitleErr ? 'true' : 'false'}
                            aria-describedby={
                              sheetTitleErr ? `${titleHintId} ${titleErrId}` : titleHintId
                            }
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              setTitleEditedManually(true);
                              setNewSheetTitle(nextVal);
                              if (sheetTitleErr) {
                                setSheetTitleErr(validateNewSheetTitle(nextVal));
                              }
                            }}
                            onBlur={() => {
                              if (!newSheetTitle.trim()) return;
                              setSheetTitleErr(validateNewSheetTitle(newSheetTitle));
                            }}
                            className="ct-input text-xs sm:text-sm"
                          />
                          {sheetTitleErr && (
                            <p
                              id={titleErrId}
                              className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5"
                            >
                              <AlertTriangle
                                className="w-3.5 h-3.5 shrink-0 mt-0.5"
                                aria-hidden="true"
                              />
                              <span>{sheetTitleErr}</span>
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                              <label
                                htmlFor={existingUrlInputId}
                                className="text-xs font-medium text-[#0A1B2C]"
                              >
                                Target Google Sheet URL or ID <span aria-hidden="true">*</span>
                              </label>
                              <div className="flex items-center gap-2 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSheetUrlOrId(DEFAULT_TARGET_SPREADSHEET_URL);
                                    setSheetUrlErr('');
                                  }}
                                  className="text-[#137333] hover:underline cursor-pointer"
                                >
                                  Official sheet
                                </button>
                                {parsedExistingId && (
                                  <a
                                    href={`https://docs.google.com/spreadsheets/d/${parsedExistingId}/edit`}
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
                            <p id={existingUrlHintId} className="text-[11px] text-[#243647] mb-1.5">
                              Paste any existing Google Sheets link or ID; existing rows stay safe
                              without duplicates.
                            </p>
                            <input
                              ref={sheetUrlRef}
                              id={existingUrlInputId}
                              name="quick_existing_sheet_url"
                              type="text"
                              required
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              value={sheetUrlOrId}
                              aria-invalid={sheetUrlErr ? 'true' : 'false'}
                              aria-describedby={
                                sheetUrlErr
                                  ? `${existingUrlHintId} ${existingUrlErrId}`
                                  : existingUrlHintId
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                setSheetUrlOrId(v);
                                if (sheetUrlErr) {
                                  setSheetUrlErr(validateExistingSheetField(v));
                                }
                              }}
                              onBlur={() => {
                                if (!sheetUrlOrId.trim()) return;
                                setSheetUrlErr(validateExistingSheetField(sheetUrlOrId));
                              }}
                              placeholder={DEFAULT_TARGET_SPREADSHEET_URL}
                              className="ct-input text-xs font-mono"
                            />
                            {sheetUrlErr && (
                              <p
                                id={existingUrlErrId}
                                className="mt-1.5 text-xs text-[#BE123C] flex items-start gap-1.5"
                              >
                                <AlertTriangle
                                  className="w-3.5 h-3.5 shrink-0 mt-0.5"
                                  aria-hidden="true"
                                />
                                <span>{sheetUrlErr}</span>
                              </p>
                            )}
                          </div>

                          <div>
                            <label
                              htmlFor={existingLabelInputId}
                              className="block text-xs font-medium text-[#0A1B2C] mb-1"
                            >
                              Display Label (optional)
                            </label>
                            <input
                              id={existingLabelInputId}
                              name="quick_existing_sheet_label"
                              type="text"
                              value={sheetLabel}
                              placeholder={computedRelativeTitle}
                              onChange={(e) => setSheetLabel(e.target.value)}
                              className="ct-input text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] text-xs text-[#243647] leading-relaxed">
                      Apps Script mode authenticates every team member using Google Sign-In ID tokens
                      and writes directly to your Web App deployment&apos;s configured 10-tab sheet.
                    </div>
                  )}

                  <div className="pt-1 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="submit"
                      disabled={busyAction !== 'none'}
                      className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-1.5 rounded-[10px] bg-[#137333] hover:bg-[#0D652D] text-[#FFFFFF] text-xs sm:text-sm font-medium border border-[#0D652D] shadow-[0_2px_8px_rgba(19,115,51,0.22)] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                      {method === 'apps_script' && appsScriptMode === 'oauth_webapp' ? (
                        <>
                          <KeyRound className="w-4 h-4" aria-hidden="true" />
                          <span>
                            {busyAction === 'submit'
                              ? 'Verifying Apps Script…'
                              : 'Verify & Activate Apps Script Sync'}
                          </span>
                        </>
                      ) : method === 'apps_script' && appsScriptMode === 'sandbox_bridge' ? (
                        sheetAction === 'create' ? (
                          <>
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            <span>
                              {busyAction === 'submit'
                                ? 'Creating Sheet & Connecting Bridge…'
                                : 'Create Sheet & Connect Bridge'}
                            </span>
                          </>
                        ) : (
                          <>
                            <GoogleSheetsIcon className="w-4 h-4 shrink-0" variant="inverted" />
                            <span>
                              {busyAction === 'submit'
                                ? 'Connecting Bridge & Pushing…'
                                : 'Connect Bridge & Push All Data'}
                            </span>
                          </>
                        )
                      ) : sheetAction === 'create' ? (
                        <>
                          <Plus className="w-4 h-4" aria-hidden="true" />
                          <span>
                            {busyAction === 'submit'
                              ? 'Creating Sheet & Pushing Data…'
                              : 'Create Sheet & Push All Data'}
                          </span>
                        </>
                      ) : (
                        <>
                          <GoogleSheetsIcon className="w-4 h-4 shrink-0" variant="inverted" />
                          <span>
                            {busyAction === 'submit'
                              ? 'Connecting & Pushing Data…'
                              : 'Connect Sheet & Push All Data'}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </form>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
