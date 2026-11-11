import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { AdminDashboardPage } from './admin/AdminDashboardPage';
import { AppHeader, type ActiveTab } from './components/layout/AppHeader';
import { AuthGate, type AuthNoticeState, type EmailSignInOutcome } from './components/layout/AuthGate';
import { GoogleSheetsSyncModal } from './components/modals/GoogleSheetsSyncModal';
import { SubmissionFormModal } from './components/modals/SubmissionFormModal';
import { TopGoogleSheetsQuickBar } from './components/sheets/TopGoogleSheetsQuickBar';
import { ToastNotification, type ToastMessage } from './components/ui/ToastNotification';
import { isAllowlistedSuperAdmin } from './config/accessControl';
import { DEFAULT_APP_CONFIGURATION, generateUuid } from './config/defaults';
import { MyClassesPage } from './dashboard/MyClassesPage';
import { SessionEntryForm } from './forms/SessionEntryForm';
import { createApiClient, WORKSPACE_STORAGE_KEY } from './services/apiClient';
import {
  ACTIVE_GOOGLE_HINT_KEY,
  ACTIVE_SANDBOX_SESSION_EMAIL_KEY,
  RECENT_GOOGLE_ACCOUNTS_KEY,
  TEAM_INTAKE_CONFIG_KEY,
  clearActiveGoogleHint,
  clearActiveGoogleIdToken,
  clearActiveSandboxEmail,
  clearAppsScriptBridgeConfig,
  clearCachedSheetsConnection,
  clearRuntimeBackendConfig,
  consumeGoogleOAuthCallbackHash,
  decodeJwtClaimsUnsafe,
  getAuthEnvironment,
  isJwtTokenUsable,
  loadActiveGoogleHint,
  loadActiveGoogleIdToken,
  loadActiveSandboxEmail,
  loadAppsScriptBridgeConfig,
  loadCachedSheetsConnection,
  loadDirectGoogleClientId,
  loadTeamIntakeConfig,
  parseTeamSetupFromLocation,
  probeSheetsBackendStatus,
  rememberRecentGoogleAccount,
  saveActiveGoogleHint,
  saveActiveGoogleIdToken,
  saveActiveSandboxEmail,
  saveCachedSheetsConnection,
  setRuntimeSheetsBackendUrl,
  subscribeSheetsConnection,
  tryRefreshGoogleIdTokenSilently,
} from './services/authService';
import { hydrateDurableStorageFromIndexedDb } from './services/durableStorage';
import {
  clearDirectGoogleSheetsToken,
  hasDirectSheetsAccessToken,
  subscribeDirectTokenState,
} from './services/googleSheetsDirectService';
import {
  extractEdgeFunctionErrorMessage,
  getSupabaseClient,
  getSupabaseConfig,
  isSupabaseConfigured,
  isSupabaseGoogleOAuthEnabled,
} from './services/supabaseClient';
import {
  ACTIVE_SANDBOX_SESSION_PROOF_KEY,
  clearActiveSandboxSessionProof,
  loadActiveSandboxSessionProof,
} from './services/passwordAuthService';
import {
  appendLocalSyncEvent,
  enqueueSyncOutboxItem,
  loadSyncOutbox,
  removeSyncOutboxItem,
} from './services/syncService';
import type {
  AppConfiguration,
  GoogleSheetsConnectionState,
  SessionRecord,
  SyncOutboxItem,
  UserProfile,
} from './types/domain';
import {
  ADMIN_NAV_ITEMS,
  getDefaultPathForRole,
  navigateToPath,
  parseAppRoute,
  stripBasePath,
  withBasePath,
  type AdminSectionSlug,
} from './utils/routes';

export function App() {
  const [initialTeamSetupOutcome] = useState(() =>
    typeof window !== 'undefined' ? parseTeamSetupFromLocation() : { applied: false },
  );
  const [authEnvVersion, setAuthEnvVersion] = useState(0);
  const env = useMemo(() => getAuthEnvironment(), [authEnvVersion]);

  const idTokenRef = useRef<string | undefined>(undefined);
  const sandboxActorIdRef = useRef<string>('');
  const supabaseAuthUidRef = useRef<string | null>(null);
  const supabaseResolveSeqRef = useRef(0);
  const userRef = useRef<UserProfile | null>(null);
  const refreshPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const outboxReplayInFlightRef = useRef(false);
  const [liveTokenEpoch, setLiveTokenEpoch] = useState(0);
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(null);
  userRef.current = user;
  const [bootRestoringAuth, setBootRestoringAuth] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (isSupabaseConfigured()) return true;
    if (env.isLiveBackendConfigured) {
      const hashOrQuery = `${window.location.hash}${window.location.search}`;
      return Boolean(
        hashOrQuery.includes('id_token=') ||
          loadActiveGoogleIdToken(env.googleClientId, 15) ||
          loadActiveGoogleHint(env.googleClientId),
      );
    }
    const savedEmail = loadActiveSandboxEmail();
    if (!savedEmail) return false;
    if (isAllowlistedSuperAdmin(savedEmail)) {
      const proof = loadActiveSandboxSessionProof();
      return Boolean(proof && proof.email === savedEmail && proof.resumeToken);
    }
    return true;
  });
  const [authNotice, setAuthNotice] = useState<AuthNoticeState | null>(null);
  const [oauthProcessing, setOauthProcessing] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const oauthBootHandledRef = useRef(false);
  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined' ? stripBasePath(window.location.pathname || '/') : '/',
  );
  const [config, setConfig] = useState<AppConfiguration>(DEFAULT_APP_CONFIGURATION);
  const [editingSession, setEditingSession] = useState<SessionRecord | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [outboxItems, setOutboxItems] = useState<SyncOutboxItem[]>([]);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [submissionModalState, setSubmissionModalState] = useState<{
    open: boolean;
    editingSession: SessionRecord | null;
  }>({ open: false, editingSession: null });
  const [dataVersion, setDataVersion] = useState(0);
  const [directTokenEpoch, setDirectTokenEpoch] = useState(0);
  const [sheetsSignalVersion, setSheetsSignalVersion] = useState(0);
  const [oauthSheetsConn, setOauthSheetsConn] = useState<GoogleSheetsConnectionState | null>(() =>
    isSupabaseConfigured()
      ? loadCachedSheetsConnection('supabase')
      : loadCachedSheetsConnection('apps_script') || loadCachedSheetsConnection('local_sandbox'),
  );
  const quickSyncUserToggledRef = useRef(false);
  const quickSyncInitialUserIdRef = useRef<string | null>(null);
  const [quickSyncBarOpen, setQuickSyncBarOpen] = useState<boolean>(() => {
    if (isSupabaseConfigured() || env.isLiveBackendConfigured) return false;
    const cached =
      loadCachedSheetsConnection('apps_script') || loadCachedSheetsConnection('local_sandbox');
    const alreadyHostedLive = Boolean(
      cached?.connected &&
        cached.authMethod === 'google_oauth' &&
        cached.spreadsheetId &&
        cached.connectionProvider !== 'direct_browser',
    );
    const alreadyBridgeLive = Boolean(
      cached?.connected &&
        (cached.connectionProvider === 'apps_script' || cached.authMethod === 'apps_script') &&
        cached.spreadsheetId &&
        loadAppsScriptBridgeConfig(),
    );
    return !(alreadyHostedLive || alreadyBridgeLive);
  });

  const navigate = useCallback((nextPath: string, replace = false) => {
    navigateToPath(nextPath, replace);
    setCurrentPath(stripBasePath(nextPath));
  }, []);

  const refreshLiveIdToken = useCallback(
    async (force = false): Promise<string | undefined> => {
      if (!env.isLiveBackendConfigured || !env.googleClientId) {
        return undefined;
      }

      const currentToken = idTokenRef.current;
      if (!force) {
        if (currentToken && isJwtTokenUsable(currentToken, 60)) {
          return currentToken;
        }
        const sessionToken = loadActiveGoogleIdToken(env.googleClientId, 60);
        if (sessionToken) {
          idTokenRef.current = sessionToken;
          setLiveTokenEpoch((v) => v + 1);
          return sessionToken;
        }
      }

      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current;
      }

      refreshPromiseRef.current = (async () => {
        const emailHint =
          userRef.current?.email || decodeJwtClaimsUnsafe(currentToken ?? '')?.email;
        const nextToken = await tryRefreshGoogleIdTokenSilently(env.googleClientId, emailHint);
        if (nextToken && isJwtTokenUsable(nextToken, 30) && (!force || nextToken !== currentToken)) {
          idTokenRef.current = nextToken;
          saveActiveGoogleIdToken(nextToken, env.googleClientId);
          setLiveTokenEpoch((v) => v + 1);
          return nextToken;
        }
        if (!force && currentToken && isJwtTokenUsable(currentToken, 10)) {
          return currentToken;
        }
        return undefined;
      })().finally(() => {
        refreshPromiseRef.current = null;
      });

      return refreshPromiseRef.current;
    },
    [env.googleClientId, env.isLiveBackendConfigured],
  );

  const handleLiveSessionExpired = useCallback(
    (reason?: string) => {
      if (!userRef.current) return;
      idTokenRef.current = undefined;
      clearDirectGoogleSheetsToken();
      clearActiveGoogleIdToken();
      userRef.current = null;
      setUser(null);
      setOauthError(
        reason || 'Your Google sign-in session expired. Please sign in with Google again.',
      );
      navigate('/auth/google', true);
    },
    [navigate],
  );

  const api = useMemo(
    () =>
      createApiClient(
        () => idTokenRef.current,
        () => sandboxActorIdRef.current,
        {
          refreshIdToken: refreshLiveIdToken,
          onSessionExpired: handleLiveSessionExpired,
        },
      ),
    [authEnvVersion, handleLiveSessionExpired, refreshLiveIdToken],
  );
  const isSupabaseMode = api.mode === 'supabase' && isSupabaseConfigured();
  const [liveSupabaseGoogleEnabled, setLiveSupabaseGoogleEnabled] = useState<boolean>(() =>
    isSupabaseGoogleOAuthEnabled(),
  );

  useEffect(() => {
    if (!isSupabaseMode) {
      setLiveSupabaseGoogleEnabled(false);
      return;
    }
    const cfg = getSupabaseConfig();
    if (!cfg.configured) {
      setLiveSupabaseGoogleEnabled(false);
      return;
    }
    let active = true;
    void fetch(`${cfg.url}/auth/v1/settings`, {
      headers: { apikey: cfg.publishableKey },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { external?: { google?: boolean } };
      })
      .then((settings) => {
        if (!active || !settings) return;
        setLiveSupabaseGoogleEnabled(Boolean(settings.external?.google));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isSupabaseMode]);

  useEffect(() => {
    return subscribeDirectTokenState(() => {
      setDirectTokenEpoch((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeSheetsConnection(() => {
      setOauthSheetsConn(
        isSupabaseMode
          ? loadCachedSheetsConnection('supabase')
          : loadCachedSheetsConnection('apps_script') || loadCachedSheetsConnection('local_sandbox'),
      );
      setSheetsSignalVersion((v) => v + 1);
    });
  }, [isSupabaseMode]);

  useEffect(() => {
    if (isSupabaseMode) return;
    if (typeof window === 'undefined' || env.sheetsBackendUrl) return;
    if (!user || user.role !== 'super_admin') return;
    let active = true;
    void probeSheetsBackendStatus('/api/sheets').then((res) => {
      if (!active || !res.available || userRef.current?.role !== 'super_admin') return;
      setRuntimeSheetsBackendUrl(res.url);
      if (res.connection?.connected && res.connection.spreadsheetId) {
        saveCachedSheetsConnection(
          env.isLiveBackendConfigured ? 'apps_script' : 'local_sandbox',
          res.connection,
        );
        setOauthSheetsConn(res.connection);
        if (
          res.connection.connectionProvider !== 'direct_browser' &&
          !quickSyncUserToggledRef.current
        ) {
          setQuickSyncBarOpen(false);
        }
      }
      setAuthEnvVersion((v) => v + 1);
    });
    return () => {
      active = false;
    };
  }, [env.isLiveBackendConfigured, env.sheetsBackendUrl, isSupabaseMode, user?.role]);

  useEffect(() => {
    if (!user || user.role !== 'super_admin') {
      quickSyncInitialUserIdRef.current = null;
      return;
    }
    let active = true;
    const isInitialCheckForUser = quickSyncInitialUserIdRef.current !== user.userId;
    void api.getSheetsConnection().then((res) => {
      if (!active || !res.ok || !res.data) return;
      quickSyncInitialUserIdRef.current = user.userId;
      if (res.data.connected && res.data.spreadsheetId) {
        saveCachedSheetsConnection(api.mode, res.data);
        setOauthSheetsConn(res.data);
        if (
          isInitialCheckForUser &&
          (res.data.connectionProvider === 'apps_script' ||
            res.data.authMethod === 'apps_script') &&
          (isSupabaseMode || loadAppsScriptBridgeConfig()) &&
          !quickSyncUserToggledRef.current
        ) {
          setQuickSyncBarOpen(false);
        }
      } else {
        clearCachedSheetsConnection(api.mode);
        setOauthSheetsConn(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [api, user?.userId, user?.role]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      setCurrentPath(stripBasePath(window.location.pathname || '/'));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const notify = useCallback(
    (type: ToastMessage['type'], title: string, detail?: string) => {
      setToast({ id: String(Date.now()), type, title, detail });
    },
    [],
  );

  const refreshOutbox = useCallback(() => {
    setOutboxItems(user ? loadSyncOutbox(user.email) : []);
  }, [user]);

  useEffect(() => {
    refreshOutbox();
  }, [refreshOutbox]);

  const initialTeamToastShownRef = useRef(false);
  useEffect(() => {
    if (initialTeamToastShownRef.current) return;
    initialTeamToastShownRef.current = true;
    if (initialTeamSetupOutcome.applied) {
      notify(
        'success',
        'Team Submission Link connected',
        'This device is linked to the Central Programme Database.',
      );
    } else if (initialTeamSetupOutcome.error) {
      notify('error', 'Invalid Team Submission Link', initialTeamSetupOutcome.error);
    }
  }, [initialTeamSetupOutcome, notify]);

  useEffect(() => {
    if (isSupabaseMode) return;
    let active = true;
    void hydrateDurableStorageFromIndexedDb([
      WORKSPACE_STORAGE_KEY,
      TEAM_INTAKE_CONFIG_KEY,
    ]).then((res) => {
      if (!active || res.restoredKeys.length === 0) return;
      api.reloadPersistedWorkspace?.();
      api.invalidateWorkspaceCache?.();
      refreshOutbox();
      setSheetsSignalVersion((v) => v + 1);
      setAuthEnvVersion((v) => v + 1);
      setDataVersion((v) => v + 1);
    });
    return () => {
      active = false;
    };
  }, [api, isSupabaseMode, refreshOutbox]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const route = useMemo(
    () => parseAppRoute(currentPath, user?.role ?? null),
    [currentPath, user?.role],
  );

  // Automatic redirect after a Facilitator visits a restricted administrator route
  useEffect(() => {
    if (!user || passwordRecoveryMode || route.kind !== 'access_denied') return;
    const timer = setTimeout(() => {
      navigate(getDefaultPathForRole(user.role), true);
    }, 1400);
    return () => clearTimeout(timer);
  }, [navigate, passwordRecoveryMode, route.kind, user]);

  // Update document.title dynamically across authentication & navigation routes
  useEffect(() => {
    const brand = 'Vidhya Vidhai Foundation · Career Tours';
    if (passwordRecoveryMode || route.kind === 'reset_password') {
      document.title = `Set New Password | ${brand}`;
      return;
    }
    if (!user) {
      if (bootRestoringAuth) {
        document.title = `Opening Workspace | ${brand}`;
      } else if (authNotice?.kind === 'pending_approval' || route.kind === 'pending_approval') {
        document.title = `Account Pending Approval | ${brand}`;
      } else if (authNotice?.kind === 'access_denied' || route.kind === 'access_denied') {
        document.title = `Access Denied | ${brand}`;
      } else if (route.kind === 'google_auth') {
        document.title = `Sign in with Google | ${brand}`;
      } else if (route.kind === 'auth_callback') {
        document.title = `Completing Google Sign-In | ${brand}`;
      } else {
        document.title = `Sign In | ${brand}`;
      }
      return;
    }

    if (route.kind === 'access_denied') {
      document.title = `Access Denied | ${brand}`;
    } else if (route.kind === 'my_classes') {
      document.title = `My Classes | ${brand}`;
    } else if (route.kind === 'admin') {
      const label =
        ADMIN_NAV_ITEMS.find((i) => i.slug === route.section)?.label ?? 'Overview';
      document.title = `${label} — Admin | ${brand}`;
    } else {
      document.title = `Classroom Data Entry | ${brand}`;
    }
  }, [authNotice?.kind, bootRestoringAuth, passwordRecoveryMode, route, user]);

  const loadConfig = useCallback(async () => {
    const res = await api.getAppConfiguration();
    if (res.ok && res.data) {
      setConfig(res.data);
    }
  }, [api]);

  const hasSavedAppsScriptBridge = useMemo(() => {
    void sheetsSignalVersion;
    void authEnvVersion;
    return Boolean(user?.role === 'super_admin' && loadAppsScriptBridgeConfig());
  }, [authEnvVersion, sheetsSignalVersion, user?.role]);

  const isBridgeSheetsLive = Boolean(
    user?.role === 'super_admin' &&
      !env.isLiveBackendConfigured &&
      oauthSheetsConn?.connected &&
      oauthSheetsConn.spreadsheetId &&
      (isSupabaseMode || hasSavedAppsScriptBridge) &&
      (oauthSheetsConn.connectionProvider === 'apps_script' ||
        oauthSheetsConn.authMethod === 'apps_script'),
  );

  const isDirectProvider = oauthSheetsConn?.connectionProvider === 'direct_browser';
  const hasMemoryDirectToken =
    directTokenEpoch >= 0 &&
    Boolean(user?.role === 'super_admin' && hasDirectSheetsAccessToken(user.email));
  const needsDirectReauth = Boolean(
    user?.role === 'super_admin' &&
      oauthSheetsConn?.connected &&
      oauthSheetsConn.authMethod === 'google_oauth' &&
      oauthSheetsConn.spreadsheetId &&
      isDirectProvider &&
      !hasMemoryDirectToken,
  );
  const isOAuthSheetsLive = Boolean(
    user?.role === 'super_admin' &&
      oauthSheetsConn?.connected &&
      oauthSheetsConn.authMethod === 'google_oauth' &&
      oauthSheetsConn.spreadsheetId &&
      (!isDirectProvider || hasMemoryDirectToken),
  );
  const isGoogleSheetsLive =
    env.isLiveBackendConfigured || isOAuthSheetsLive || isBridgeSheetsLive;

  const teamIntakeConfig = useMemo(() => {
    void sheetsSignalVersion;
    void authEnvVersion;
    return loadTeamIntakeConfig();
  }, [authEnvVersion, sheetsSignalVersion]);

  const isTeamIntakeActive = Boolean(
    !env.isLiveBackendConfigured &&
      teamIntakeConfig?.appsScriptUrl &&
      teamIntakeConfig?.intakeKey,
  );

  useEffect(() => {
    if (needsDirectReauth && !quickSyncUserToggledRef.current) {
      setQuickSyncBarOpen(true);
    }
  }, [needsDirectReauth]);

  const hydratedSheetsKey = isGoogleSheetsLive
    ? `${api.mode}:${env.sheetsBackendUrl}:${user?.userId ?? ''}:${oauthSheetsConn?.connectionProvider ?? ''}:${oauthSheetsConn?.spreadsheetId ?? ''}`
    : '';
  const prevHydratedSheetsKeyRef = useRef('');
  useEffect(() => {
    if (!user || !hydratedSheetsKey) {
      prevHydratedSheetsKeyRef.current = '';
      return;
    }
    if (prevHydratedSheetsKeyRef.current !== hydratedSheetsKey) {
      prevHydratedSheetsKeyRef.current = hydratedSheetsKey;
      api.invalidateWorkspaceCache?.();
      void loadConfig();
      setDataVersion((v) => v + 1);
    }
  }, [api, hydratedSheetsKey, loadConfig, user]);

  const handleGoogleTokenSuccess = useCallback(
    async (idToken: string, opts?: { preserveProtectedPath?: boolean }) => {
      setAuthNotice(null);
      setOauthError(null);
      idTokenRef.current = idToken;
      const userRes = await api.getCurrentUser();
      if (!userRes.ok || !userRes.data) {
        idTokenRef.current = undefined;
        if (userRes.code === 'NETWORK_ERROR' || userRes.code === 'TRANSIENT_AUTH_ERROR') {
          setOauthError(
            userRes.error ||
              'Temporary issue verifying your Google account with the server. Please try again.',
          );
          navigate('/auth/google', true);
          return;
        }
        clearActiveGoogleIdToken();
        clearActiveGoogleHint();
        const claims = decodeJwtClaimsUnsafe(idToken);
        const isPending = userRes.code === 'PENDING_APPROVAL';
        setAuthNotice({
          kind: isPending ? 'pending_approval' : 'access_denied',
          email: claims?.email,
          message:
            userRes.error ||
            `Access denied for ${claims?.email ?? 'Google account'}. Contact an Administrator.`,
        });
        navigate(isPending ? '/pending-approval' : '/access-denied', true);
        return;
      }
      const verifiedToken = idTokenRef.current || idToken;
      saveActiveGoogleIdToken(verifiedToken, env.googleClientId);
      saveActiveGoogleHint(userRes.data.email, env.googleClientId);
      setLiveTokenEpoch((v) => v + 1);
      rememberRecentGoogleAccount({
        email: userRes.data.email,
        name: userRes.data.name,
        role: userRes.data.role,
      });
      setUser(userRes.data);
      setAuthNotice(null);
      const currentSubpath =
        typeof window !== 'undefined'
          ? stripBasePath(window.location.pathname || '/').toLowerCase()
          : '/';
      const isAuthLandingPath =
        currentSubpath === '/' ||
        currentSubpath === '/login' ||
        currentSubpath === '/auth/google' ||
        currentSubpath === '/auth/sso' ||
        currentSubpath === '/auth/callback' ||
        currentSubpath === '/pending-approval' ||
        currentSubpath === '/access-denied';
      if (!opts?.preserveProtectedPath || isAuthLandingPath) {
        navigate(getDefaultPathForRole(userRes.data.role), true);
      }
      await loadConfig();
    },
    [api, env.googleClientId, loadConfig, navigate],
  );

  const handleEmailSignIn = useCallback(
    async (
      emailInput: string,
      options?: { password?: string; resumeToken?: string },
    ): Promise<EmailSignInOutcome> => {
      if (!api.authenticateSandboxEmail) {
        return { ok: false, code: 'UNAVAILABLE', error: 'Sign-in service is unavailable.' };
      }
      setOauthError(null);
      const cleanEmail = emailInput.trim().toLowerCase();
      const res = await api.authenticateSandboxEmail(cleanEmail, undefined, options);
      if (!res.ok || !res.data) {
        if (res.code === 'PASSWORD_REQUIRED' || res.code === 'INVALID_PASSWORD') {
          return {
            ok: false,
            code: res.code,
            error:
              res.error ||
              (res.code === 'PASSWORD_REQUIRED'
                ? 'Enter the password for this Super Administrator account.'
                : 'Incorrect password. Check your password and try again.'),
          };
        }
        clearActiveSandboxEmail();
        clearActiveSandboxSessionProof();
        const isPending = res.code === 'PENDING_APPROVAL';
        setAuthNotice({
          kind: isPending ? 'pending_approval' : 'access_denied',
          email: cleanEmail,
          message:
            res.error ||
            'Access denied. Contact an Administrator to activate your Facilitator account.',
        });
        navigate(isPending ? '/pending-approval' : '/access-denied', true);
        return { ok: false, code: res.code, error: res.error };
      }

      if (res.data.role !== 'super_admin') {
        clearActiveSandboxSessionProof();
      }
      clearDirectGoogleSheetsToken();
      rememberRecentGoogleAccount({
        email: res.data.email,
        name: res.data.name,
        role: res.data.role,
      });
      saveActiveSandboxEmail(res.data.email);
      sandboxActorIdRef.current = res.data.userId;
      setAuthNotice(null);
      setUser(res.data);
      navigate(getDefaultPathForRole(res.data.role), true);
      await loadConfig();
      return { ok: true };
    },
    [api, loadConfig, navigate],
  );

  const resolveCurrentSupabaseSession = useCallback(
    async (opts?: {
      isRecoveryEvent?: boolean;
      forceNavigateDefault?: boolean;
    }): Promise<EmailSignInOutcome> => {
      if (!isSupabaseMode) {
        return { ok: false, error: 'Supabase Auth is not configured.' };
      }

      const seq = ++supabaseResolveSeqRef.current;
      const supabase = getSupabaseClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (seq !== supabaseResolveSeqRef.current) {
        return { ok: false };
      }

      if (sessionError) {
        supabaseAuthUidRef.current = null;
        setBootRestoringAuth(false);
        return { ok: false, error: sessionError.message };
      }

      const currentSubpath =
        typeof window !== 'undefined'
          ? stripBasePath(window.location.pathname || '/').toLowerCase()
          : '/';

      if (
        opts?.isRecoveryEvent ||
        (!opts?.forceNavigateDefault && currentSubpath === '/auth/reset-password')
      ) {
        supabaseAuthUidRef.current = session?.user?.id ?? null;
        setPasswordRecoveryMode(true);
        setAuthNotice(null);
        setBootRestoringAuth(false);
        return { ok: true };
      }

      if (!session) {
        supabaseAuthUidRef.current = null;
        setUser(null);
        setBootRestoringAuth(false);
        if (typeof window !== 'undefined') {
          const searchParams = new URLSearchParams(window.location.search);
          const errDesc =
            searchParams.get('error_description') || searchParams.get('error');
          if (errDesc) {
            setOauthError(errDesc);
            navigate('/login', true);
          }
        }
        return { ok: false, error: 'No active session.' };
      }

      supabaseAuthUidRef.current = session.user.id;
      const res = await api.getCurrentUser();
      if (seq !== supabaseResolveSeqRef.current) {
        return { ok: false };
      }

      if (!res.ok || !res.data) {
        if (res.code === 'PENDING_APPROVAL' || res.code === 'ACCESS_DENIED') {
          const isPending = res.code === 'PENDING_APPROVAL';
          const msg =
            res.error ||
            (isPending
              ? 'Your account is pending approval by a Super Administrator.'
              : 'Your account is not active for this workspace. Contact an Administrator.');
          setUser(null);
          setAuthNotice({
            kind: isPending ? 'pending_approval' : 'access_denied',
            email: session.user.email,
            message: msg,
          });
          setBootRestoringAuth(false);
          navigate(isPending ? '/pending-approval' : '/access-denied', true);
          return { ok: false, code: res.code, error: msg };
        }

        const msg = res.error || 'Unable to verify your workspace profile right now.';
        if (!userRef.current) {
          setOauthError(msg);
        } else {
          notify('warning', 'Session verification warning', msg);
        }
        setBootRestoringAuth(false);
        return { ok: false, code: res.code, error: msg };
      }

      setAuthNotice(null);
      setOauthError(null);
      setPasswordRecoveryMode(false);
      setUser(res.data);
      setBootRestoringAuth(false);

      const isAuthLandingPath =
        currentSubpath === '/' ||
        currentSubpath === '/login' ||
        currentSubpath === '/auth/google' ||
        currentSubpath === '/auth/sso' ||
        currentSubpath === '/auth/callback' ||
        currentSubpath === '/pending-approval' ||
        currentSubpath === '/access-denied' ||
        currentSubpath === '/auth/reset-password';

      if (opts?.forceNavigateDefault || isAuthLandingPath) {
        navigate(getDefaultPathForRole(res.data.role), true);
      }

      await loadConfig();
      return { ok: true };
    },
    [api, isSupabaseMode, loadConfig, navigate, notify],
  );

  const handleSupabaseGoogleOAuth = useCallback(async () => {
    if (!isSupabaseMode) return;
    setOauthError(null);
    setAuthNotice(null);
    const cfg = getSupabaseConfig();
    if (cfg.configured) {
      try {
        const res = await fetch(`${cfg.url}/auth/v1/settings`, {
          headers: { apikey: cfg.publishableKey },
        });
        if (res.ok) {
          const settings = (await res.json()) as { external?: { google?: boolean } };
          if (!settings.external?.google) {
            setLiveSupabaseGoogleEnabled(false);
            setOauthError(
              'Google Sign-In is not yet enabled on the authentication server. Sign in with your registered email and password below.',
            );
            return;
          }
          setLiveSupabaseGoogleEnabled(true);
        }
      } catch {
        // Proceed to Supabase OAuth request if settings preflight cannot be reached.
      }
    }
    const supabase = getSupabaseClient();
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}${withBasePath('/')}` : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      setOauthError(error.message);
    }
  }, [isSupabaseMode]);

  const handleSupabasePasswordSignIn = useCallback(
    async (emailInput: string, passwordInput: string): Promise<EmailSignInOutcome> => {
      if (!isSupabaseMode) {
        return { ok: false, error: 'Supabase Auth is not enabled.' };
      }
      setOauthError(null);
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: emailInput.trim().toLowerCase(),
        password: passwordInput,
      });
      if (error) {
        const lower = error.message.toLowerCase();
        if (lower.includes('invalid login credentials')) {
          return {
            ok: false,
            error:
              'Incorrect email or password, or your account has not been created yet. New facilitators can click "Create Facilitator account" below or ask a Super Administrator to set your login in User Management.',
          };
        }
        if (lower.includes('email not confirmed')) {
          return {
            ok: false,
            error:
              'This email address is awaiting confirmation. Ask a Super Administrator to click "Confirm & Approve" or "Set Password" for your email in User Management (no confirmation link needed).',
          };
        }
        return { ok: false, error: error.message };
      }
      return await resolveCurrentSupabaseSession({ forceNavigateDefault: true });
    },
    [isSupabaseMode, resolveCurrentSupabaseSession],
  );

  const handleSupabaseSignUp = useCallback(
    async (
      fullName: string,
      emailInput: string,
      passwordInput: string,
    ): Promise<EmailSignInOutcome & { requiresEmailConfirmation?: boolean; statusMessage?: string }> => {
      if (!isSupabaseMode) {
        return { ok: false, error: 'Supabase Auth is not enabled.' };
      }
      setOauthError(null);
      const supabase = getSupabaseClient();
      const cleanName = fullName.trim();
      const cleanEmail = emailInput.trim().toLowerCase();

      // Primary path: bypass Supabase's strict 2/hr built-in email confirmation rate limit
      // while enforcing server-side Pre-Approval vs Pending Admin Queue gating.
      if (!supabase.functions?.invoke) {
        return {
          ok: false,
          error:
            'Account registration service is unavailable right now. Ask a Super Administrator to create your account in User Management.',
        };
      }

      try {
        const { data, error } = await supabase.functions.invoke('facilitator-self-register', {
          body: {
            fullName: cleanName,
            email: cleanEmail,
            password: passwordInput,
          },
        });

        if (error) {
          const msg = await extractEdgeFunctionErrorMessage(
            error,
            'Unable to create facilitator account.',
          );
          return { ok: false, error: msg };
        }

        const payload = (data && typeof data === 'object' ? data : null) as
          | {
              ok?: boolean;
              error?: string;
              data?: { approvedImmediately?: boolean; message?: string };
            }
          | null;

        if (!payload || payload.ok === false) {
          return {
            ok: false,
            error: payload?.error || 'Unable to create facilitator account.',
          };
        }

        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: passwordInput,
        });

        if (!signInErr) {
          return await resolveCurrentSupabaseSession({ forceNavigateDefault: true });
        }

        return {
          ok: true,
          statusMessage:
            payload.data?.message ||
            'Account created. Return to Sign In with your email and password.',
        };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error && err.message
              ? err.message
              : 'Unable to reach registration service. Please check your connection and try again.',
        };
      }
    },
    [isSupabaseMode, resolveCurrentSupabaseSession],
  );

  const handleSupabaseForgotPassword = useCallback(
    async (emailInput: string): Promise<{ ok: boolean; error?: string }> => {
      if (!isSupabaseMode) {
        return { ok: false, error: 'Supabase Auth is not enabled.' };
      }
      const supabase = getSupabaseClient();
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}${withBasePath('/auth/reset-password')}`
          : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(
        emailInput.trim().toLowerCase(),
        { redirectTo },
      );
      if (error) {
        const lower = error.message.toLowerCase();
        if (lower.includes('rate limit')) {
          return {
            ok: false,
            error:
              'Password reset emails are temporarily rate-limited. Ask a Super Administrator (Brintha or Karunya) to set a temporary password for you in User Management.',
          };
        }
        return { ok: false, error: error.message };
      }
      return { ok: true };
    },
    [isSupabaseMode],
  );

  const handleSupabaseUpdatePassword = useCallback(
    async (newPassword: string): Promise<{ ok: boolean; error?: string }> => {
      if (!isSupabaseMode) {
        return { ok: false, error: 'Supabase Auth is not enabled.' };
      }
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { ok: false, error: error.message };
      }
      setPasswordRecoveryMode(false);
      const outcome = await resolveCurrentSupabaseSession({ forceNavigateDefault: true });
      if (outcome.ok) {
        notify('success', 'Password updated', 'Your workspace password has been updated.');
      }
      return { ok: outcome.ok, error: outcome.error };
    },
    [isSupabaseMode, notify, resolveCurrentSupabaseSession],
  );

  useEffect(() => {
    if (!isSupabaseMode || typeof window === 'undefined') return;
    let active = true;
    const supabase = getSupabaseClient();

    void resolveCurrentSupabaseSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true);
        setBootRestoringAuth(false);
        navigate('/auth/reset-password', true);
        return;
      }
      if (event === 'SIGNED_OUT' || !session) {
        supabaseAuthUidRef.current = null;
        setPasswordRecoveryMode(false);
        setUser(null);
        setAuthNotice(null);
        setBootRestoringAuth(false);
        setConfig(DEFAULT_APP_CONFIGURATION);
        setOauthSheetsConn(null);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        supabaseAuthUidRef.current = session.user.id;
        if (!userRef.current) {
          void resolveCurrentSupabaseSession();
        }
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isSupabaseMode, navigate, resolveCurrentSupabaseSession]);

  // Live PostgreSQL Realtime synchronization across Facilitators and Super Admins
  useEffect(() => {
    if (!isSupabaseMode || !user || passwordRecoveryMode) return;
    const supabase = getSupabaseClient();
    let debounceTimer: number | null = null;
    const bumpData = () => {
      if (debounceTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        api.invalidateWorkspaceCache?.();
        setDataVersion((v) => v + 1);
      }, 250);
    };

    const uid = supabaseAuthUidRef.current;
    const submissionsFilter =
      user.role !== 'super_admin' && uid ? `user_id=eq.${uid}` : undefined;

    let channel = supabase.channel(`vv-realtime-${user.userId}`).on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'form_submissions',
        ...(submissionsFilter ? { filter: submissionsFilter } : {}),
      },
      bumpData,
    );

    if (user.role === 'super_admin') {
      channel = channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, bumpData)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_logs' }, bumpData);
    }

    channel.subscribe();

    return () => {
      if (debounceTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(debounceTimer);
      }
      void supabase.removeChannel(channel);
    };
  }, [api, isSupabaseMode, passwordRecoveryMode, user]);

  useEffect(() => {
    if (isSupabaseMode) return;
    if (oauthBootHandledRef.current || typeof window === 'undefined') return;
    oauthBootHandledRef.current = true;

    if (env.isLiveBackendConfigured) {
      const callbackResult = consumeGoogleOAuthCallbackHash();
      if (callbackResult?.kind === 'id_token') {
        setOauthProcessing(true);
        void handleGoogleTokenSuccess(callbackResult.idToken).finally(() => {
          setOauthProcessing(false);
          setBootRestoringAuth(false);
        });
      } else if (callbackResult?.kind === 'error') {
        setOauthError(callbackResult.message);
        setBootRestoringAuth(false);
        navigate('/auth/google', true);
      } else {
        const restoredToken = loadActiveGoogleIdToken(env.googleClientId, 15);
        if (restoredToken) {
          setOauthProcessing(true);
          idTokenRef.current = restoredToken;
          void api
            .getCurrentUser()
            .then(async (res) => {
              if (!res.ok || !res.data) {
                idTokenRef.current = undefined;
                if (
                  res.code === 'UNAUTHENTICATED' ||
                  res.code === 'ACCESS_DENIED' ||
                  res.code === 'PENDING_APPROVAL' ||
                  res.code === 'SETUP_REQUIRED'
                ) {
                  clearActiveGoogleIdToken();
                  clearActiveGoogleHint();
                  if (res.code === 'PENDING_APPROVAL' || res.code === 'ACCESS_DENIED') {
                    const claims = decodeJwtClaimsUnsafe(restoredToken);
                    const isPending = res.code === 'PENDING_APPROVAL';
                    setAuthNotice({
                      kind: isPending ? 'pending_approval' : 'access_denied',
                      email: claims?.email,
                      message:
                        res.error ||
                        `Access denied for ${claims?.email ?? 'Google account'}. Contact an Administrator.`,
                    });
                    navigate(isPending ? '/pending-approval' : '/access-denied', true);
                  }
                } else {
                  notify(
                    'warning',
                    'Unable to reach Google Sheets backend right now',
                    res.error || 'Please refresh or sign in again once your connection stabilizes.',
                  );
                }
                return;
              }

              const verifiedToken = idTokenRef.current || restoredToken;
              saveActiveGoogleIdToken(verifiedToken, env.googleClientId);
              saveActiveGoogleHint(res.data.email, env.googleClientId);
              setLiveTokenEpoch((v) => v + 1);
              rememberRecentGoogleAccount({
                email: res.data.email,
                name: res.data.name,
                role: res.data.role,
              });
              setAuthNotice(null);
              setUser(res.data);
              const currentSubpath = stripBasePath(window.location.pathname || '/').toLowerCase();
              if (
                currentSubpath === '/' ||
                currentSubpath === '/login' ||
                currentSubpath === '/auth/google' ||
                currentSubpath === '/auth/sso' ||
                currentSubpath === '/auth/callback' ||
                currentSubpath === '/pending-approval' ||
                currentSubpath === '/access-denied'
              ) {
                navigate(getDefaultPathForRole(res.data.role), true);
              }
              await loadConfig();
            })
            .finally(() => {
              setOauthProcessing(false);
              setBootRestoringAuth(false);
            });
        } else {
          const googleHint = loadActiveGoogleHint(env.googleClientId);
          if (googleHint) {
            setOauthProcessing(true);
            void tryRefreshGoogleIdTokenSilently(env.googleClientId, googleHint.email)
              .then(async (silentToken) => {
                if (silentToken && isJwtTokenUsable(silentToken, 30)) {
                  await handleGoogleTokenSuccess(silentToken, { preserveProtectedPath: true });
                } else if (stripBasePath(window.location.pathname || '/') === '/auth/callback') {
                  navigate('/auth/google', true);
                }
              })
              .finally(() => {
                setOauthProcessing(false);
                setBootRestoringAuth(false);
              });
          } else {
            setBootRestoringAuth(false);
            if (stripBasePath(window.location.pathname || '/') === '/auth/callback') {
              navigate('/auth/google', true);
            }
          }
        }
      }
      return;
    }

    const savedSandboxEmail = loadActiveSandboxEmail();
    if (!savedSandboxEmail || !api.authenticateSandboxEmail) {
      setBootRestoringAuth(false);
      return;
    }

    const savedProof = loadActiveSandboxSessionProof();
    const bootOptions =
      savedProof && savedProof.email === savedSandboxEmail
        ? { resumeToken: savedProof.resumeToken }
        : undefined;

    void api
      .authenticateSandboxEmail(savedSandboxEmail, undefined, bootOptions)
      .then(async (res) => {
        if (!res.ok || !res.data) {
          clearActiveSandboxEmail();
          clearActiveSandboxSessionProof();
          return;
        }
        rememberRecentGoogleAccount({
          email: res.data.email,
          name: res.data.name,
          role: res.data.role,
        });
        sandboxActorIdRef.current = res.data.userId;
        setAuthNotice(null);
        setUser(res.data);
        const currentSubpath = stripBasePath(window.location.pathname || '/').toLowerCase();
        if (
          currentSubpath === '/' ||
          currentSubpath === '/login' ||
          currentSubpath === '/auth/google' ||
          currentSubpath === '/auth/sso' ||
          currentSubpath === '/auth/callback' ||
          currentSubpath === '/pending-approval' ||
          currentSubpath === '/access-denied'
        ) {
          navigate(getDefaultPathForRole(res.data.role), true);
        }
        await loadConfig();
      })
      .finally(() => {
        setBootRestoringAuth(false);
      });
  }, [
    api,
    env.googleClientId,
    env.isLiveBackendConfigured,
    handleGoogleTokenSuccess,
    loadConfig,
    navigate,
    notify,
  ]);

  // Proactive silent GIS token renewal 5 minutes before the 60-minute ID token expires,
  // and whenever a backgrounded tab returns to focus/online.
  useEffect(() => {
    if (
      isSupabaseMode ||
      !user ||
      !env.isLiveBackendConfigured ||
      !env.googleClientId ||
      typeof window === 'undefined'
    ) {
      return;
    }

    const token = idTokenRef.current;
    const claims = token ? decodeJwtClaimsUnsafe(token) : null;
    let timerId: number | null = null;
    if (claims?.exp) {
      const msUntilRefresh = Math.max(10_000, claims.exp * 1000 - Date.now() - 5 * 60 * 1000);
      timerId = window.setTimeout(() => {
        void refreshLiveIdToken(true);
      }, msUntilRefresh);
    }

    const handleResumeCheck = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!isJwtTokenUsable(idTokenRef.current, 600)) {
        void refreshLiveIdToken(false);
      }
    };

    window.addEventListener('focus', handleResumeCheck);
    window.addEventListener('online', handleResumeCheck);
    document.addEventListener('visibilitychange', handleResumeCheck);

    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener('focus', handleResumeCheck);
      window.removeEventListener('online', handleResumeCheck);
      document.removeEventListener('visibilitychange', handleResumeCheck);
    };
  }, [env.googleClientId, env.isLiveBackendConfigured, liveTokenEpoch, refreshLiveIdToken, user]);

  const handleSignOut = useCallback(async () => {
    if (isSupabaseMode) {
      supabaseResolveSeqRef.current += 1;
      supabaseAuthUidRef.current = null;
      setPasswordRecoveryMode(false);
      setUser(null);
      setConfig(DEFAULT_APP_CONFIGURATION);
      setOauthSheetsConn(null);
      try {
        await getSupabaseClient().auth.signOut({ scope: 'local' });
      } catch {
        // Proceed clearing local UI state even if network sign-out fails.
      }
    }
    idTokenRef.current = undefined;
    sandboxActorIdRef.current = '';
    clearDirectGoogleSheetsToken();
    clearActiveGoogleIdToken();
    clearActiveGoogleHint();
    clearActiveSandboxEmail();
    clearActiveSandboxSessionProof();
    clearCachedSheetsConnection();
    clearCachedSheetsConnection('supabase');
    quickSyncUserToggledRef.current = false;
    quickSyncInitialUserIdRef.current = null;
    setQuickSyncBarOpen(!isSupabaseMode && !env.isLiveBackendConfigured);
    setOauthSheetsConn(null);
    setUser(null);
    setAuthNotice(null);
    setOauthError(null);
    setEditingSession(null);
    setSubmissionModalState({ open: false, editingSession: null });
    setSyncModalOpen(false);
    navigate('/login', true);
  }, [env.isLiveBackendConfigured, isSupabaseMode, navigate]);

  const handleLiveBackendActivated = useCallback(() => {
    idTokenRef.current = undefined;
    sandboxActorIdRef.current = '';
    clearDirectGoogleSheetsToken();
    clearActiveGoogleIdToken();
    clearActiveGoogleHint();
    clearActiveSandboxEmail();
    clearActiveSandboxSessionProof();
    clearCachedSheetsConnection();
    quickSyncUserToggledRef.current = false;
    quickSyncInitialUserIdRef.current = null;
    setQuickSyncBarOpen(false);
    setAuthEnvVersion((v) => v + 1);
    setUser(null);
    setAuthNotice(null);
    setOauthError(null);
    setEditingSession(null);
    setSubmissionModalState({ open: false, editingSession: null });
    setSyncModalOpen(false);
    notify(
      'success',
      'Live Google Sheets backend verified & activated',
      'Sign in with your approved Google account to open your live spreadsheet workspace.',
    );
    navigate('/auth/google', true);
  }, [navigate, notify]);

  const handleResetLiveBackend = useCallback(() => {
    clearRuntimeBackendConfig();
    clearAppsScriptBridgeConfig();
    idTokenRef.current = undefined;
    sandboxActorIdRef.current = '';
    clearDirectGoogleSheetsToken();
    clearActiveGoogleIdToken();
    clearActiveGoogleHint();
    clearActiveSandboxEmail();
    clearActiveSandboxSessionProof();
    clearCachedSheetsConnection();
    setOauthSheetsConn(null);
    quickSyncUserToggledRef.current = false;
    quickSyncInitialUserIdRef.current = null;
    setQuickSyncBarOpen(true);
    setAuthEnvVersion((v) => v + 1);
    setUser(null);
    setAuthNotice(null);
    setOauthError(null);
    setEditingSession(null);
    setSubmissionModalState({ open: false, editingSession: null });
    setSyncModalOpen(false);
    notify(
      'success',
      'Switched to local device storage',
      'All records already stored in your Google Sheet remain safely preserved.',
    );
    navigate('/login', true);
  }, [navigate, notify]);

  const handleSheetsConnectionChanged = useCallback(
    (next: GoogleSheetsConnectionState) => {
      setOauthSheetsConn(next);
      if (next.connected && next.spreadsheetId) {
        saveCachedSheetsConnection(api.mode, next);
      } else {
        clearCachedSheetsConnection(api.mode);
      }
    },
    [api.mode],
  );

  const handleSheetsWorkspaceSynced = useCallback(async () => {
    api.reloadPersistedWorkspace?.();
    api.invalidateWorkspaceCache?.();
    await loadConfig();
    refreshOutbox();
    setDataVersion((v) => v + 1);
  }, [api, loadConfig, refreshOutbox]);

  const handleAuthorizeDirectSheetsNow = useCallback(async () => {
    const activeUser = userRef.current;
    if (!activeUser || activeUser.role !== 'super_admin') return;

    const clientId =
      loadDirectGoogleClientId() || env.directGoogleClientId || env.googleClientId;
    if (!clientId) {
      quickSyncUserToggledRef.current = true;
      setQuickSyncBarOpen(true);
      notify(
        'warning',
        'Google OAuth Web Client ID required',
        'Enter your Google OAuth 2.0 Web Client ID in Quick Google Sheet Sync above, then push data.',
      );
      return;
    }

    const syncRes = await api.syncAllToGoogleSheet({
      directClientId: clientId,
      forceDirectOAuth: true,
    });
    if (!syncRes.ok || !syncRes.data) {
      notify(
        'error',
        'Google authorization or sync failed',
        syncRes.error || 'Could not authorize Google Sheets access.',
      );
      return;
    }

    const connRes = await api.getSheetsConnection();
    if (connRes.ok && connRes.data) {
      saveCachedSheetsConnection(api.mode, connRes.data);
      setOauthSheetsConn(connRes.data);
    }
    api.invalidateWorkspaceCache?.();
    await loadConfig();
    refreshOutbox();
    setDataVersion((v) => v + 1);
    notify('success', 'Google Sheets re-authorized & synced', syncRes.data.message);
  }, [api, env.directGoogleClientId, env.googleClientId, loadConfig, notify, refreshOutbox]);

  const handleEditSession = (session: SessionRecord) => {
    setEditingSession(session);
    navigate('/classroom-entry');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRetryOutboxItem = useCallback(
    async (item: SyncOutboxItem, opts?: { quietOnError?: boolean }) => {
      const activeUser = userRef.current ?? user;
      if (!activeUser) return;
      const res =
        item.operation === 'updateSession' && item.sessionRecordId
          ? await api.updateSession(item.sessionRecordId, item.values)
          : await api.createSession(item.values);

      if (res.ok && res.data) {
        removeSyncOutboxItem(activeUser.email, item.clientSubmissionKey);
        appendLocalSyncEvent(activeUser.email, {
          syncId: generateUuid(),
          timestamp: new Date().toISOString(),
          clientSubmissionKey: item.clientSubmissionKey,
          sessionRecordId: res.data.session.sessionRecordId,
          sessionId: res.data.session.sessionId,
          actorEmail: activeUser.email,
          operation: item.operation,
          attempt: item.attempts + 1,
          status: res.data.session.syncStatus ?? (isGoogleSheetsLive ? 'SYNCED' : 'LOCAL_SANDBOX'),
          errorMessage: '',
        });
        refreshOutbox();
        setDataVersion((v) => v + 1);
        notify('success', 'Queued submission synced', `${res.data.session.sessionId} saved.`);
      } else {
        enqueueSyncOutboxItem(activeUser.email, {
          ...item,
          syncStatus: 'FAILED',
          attempts: item.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: res.error || 'Retry failed.',
        });
        appendLocalSyncEvent(activeUser.email, {
          syncId: generateUuid(),
          timestamp: new Date().toISOString(),
          clientSubmissionKey: item.clientSubmissionKey,
          sessionRecordId: item.sessionRecordId ?? '',
          sessionId: item.sessionId ?? '',
          actorEmail: activeUser.email,
          operation: item.operation,
          attempt: item.attempts + 1,
          status: 'FAILED',
          errorMessage: res.error || 'Retry failed.',
        });
        refreshOutbox();
        if (!opts?.quietOnError) {
          notify('error', 'Sync retry failed', res.error);
        }
      }
    },
    [api, isGoogleSheetsLive, notify, refreshOutbox, user],
  );

  const handleRetryAllOutbox = useCallback(
    async (opts?: { quietOnError?: boolean }) => {
      if (outboxReplayInFlightRef.current) return;
      const activeUser = userRef.current ?? user;
      if (!activeUser) return;
      const snapshot = loadSyncOutbox(activeUser.email);
      if (snapshot.length === 0) return;
      outboxReplayInFlightRef.current = true;
      try {
        for (const item of snapshot) {
          await handleRetryOutboxItem(item, opts);
        }
      } finally {
        outboxReplayInFlightRef.current = false;
      }
    },
    [handleRetryOutboxItem, user],
  );

  // Automatic background replay of offline SyncOutbox on reconnect, sign-in/reload, or Central/Live activation
  const effectiveLiveForOutbox =
    isSupabaseMode || isGoogleSheetsLive || (user?.role !== 'super_admin' && isTeamIntakeActive);
  const prevEffectiveOutboxLiveRef = useRef(effectiveLiveForOutbox);
  const prevOutboxUserEmailRef = useRef<string | null>(null);
  useEffect(() => {
    const activeEmail = user?.email ?? null;
    if (typeof window === 'undefined' || !user) {
      prevEffectiveOutboxLiveRef.current = effectiveLiveForOutbox;
      prevOutboxUserEmailRef.current = activeEmail;
      return;
    }

    const becameLive = !prevEffectiveOutboxLiveRef.current && effectiveLiveForOutbox;
    const justAuthenticated = prevOutboxUserEmailRef.current !== activeEmail;
    prevEffectiveOutboxLiveRef.current = effectiveLiveForOutbox;
    prevOutboxUserEmailRef.current = activeEmail;

    const triggerQuietReplay = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (loadSyncOutbox(user.email).length === 0) return;
      void handleRetryAllOutbox({ quietOnError: true });
    };

    if (becameLive || justAuthenticated) {
      triggerQuietReplay();
    }

    window.addEventListener('online', triggerQuietReplay);
    return () => {
      window.removeEventListener('online', triggerQuietReplay);
    };
  }, [effectiveLiveForOutbox, handleRetryAllOutbox, user]);

  // Cross-tab synchronization for workspace data and sign-in/sign-out events
  useEffect(() => {
    if (isSupabaseMode || typeof window === 'undefined') return;
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === WORKSPACE_STORAGE_KEY) {
        api.reloadPersistedWorkspace?.();
        setDataVersion((v) => v + 1);
      }

      if (e.key === TEAM_INTAKE_CONFIG_KEY) {
        setAuthEnvVersion((v) => v + 1);
        setSheetsSignalVersion((v) => v + 1);
      }

      if (!e.key || e.key === RECENT_GOOGLE_ACCOUNTS_KEY) {
        // Trigger re-render if needed via Refresh outbox
        refreshOutbox();
      }

      if (e.key === ACTIVE_GOOGLE_HINT_KEY && !e.newValue && env.isLiveBackendConfigured && userRef.current) {
        idTokenRef.current = undefined;
        clearActiveGoogleIdToken();
        setUser(null);
        navigate('/login', true);
      }

      if (e.key === ACTIVE_SANDBOX_SESSION_EMAIL_KEY && !env.isLiveBackendConfigured) {
        const nextEmail = (e.newValue ?? '').trim().toLowerCase();
        if (!nextEmail && userRef.current) {
          sandboxActorIdRef.current = '';
          setUser(null);
          navigate('/login', true);
        } else if (nextEmail && nextEmail !== userRef.current?.email.toLowerCase()) {
          const proof = loadActiveSandboxSessionProof();
          const syncOptions =
            proof && proof.email === nextEmail ? { resumeToken: proof.resumeToken } : undefined;
          if (!isAllowlistedSuperAdmin(nextEmail) || syncOptions) {
            void handleEmailSignIn(nextEmail, syncOptions);
          }
        }
      }

      if (
        e.key === ACTIVE_SANDBOX_SESSION_PROOF_KEY &&
        !e.newValue &&
        !env.isLiveBackendConfigured &&
        userRef.current?.role === 'super_admin'
      ) {
        sandboxActorIdRef.current = '';
        setUser(null);
        navigate('/login', true);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [api, env.isLiveBackendConfigured, handleEmailSignIn, isSupabaseMode, navigate, refreshOutbox]);

  if (!user || passwordRecoveryMode || route.kind === 'reset_password') {
    const authRouteKind = bootRestoringAuth
      ? 'restoring'
      : passwordRecoveryMode || route.kind === 'reset_password'
        ? 'reset_password'
        : route.kind === 'google_auth' ||
            route.kind === 'auth_callback' ||
            route.kind === 'pending_approval' ||
            route.kind === 'access_denied'
          ? route.kind
          : 'login';

    return (
      <>
        <AuthGate
          routeKind={authRouteKind}
          isLiveBackend={env.isLiveBackendConfigured}
          isSupabaseMode={isSupabaseMode}
          supabaseGoogleOAuthEnabled={liveSupabaseGoogleEnabled}
          googleClientId={env.googleClientId}
          isTeamIntakeConnected={env.isLiveBackendConfigured || isTeamIntakeActive}
          teamIntakeLabel={teamIntakeConfig?.label}
          onTeamIntakeConfigured={() => {
            setAuthEnvVersion((v) => v + 1);
            setSheetsSignalVersion((v) => v + 1);
            notify(
              'success',
              'Team Submission Link connected',
              'Device connected to Central Programme Database.',
            );
          }}
          onNavigate={navigate}
          onGoogleTokenSuccess={handleGoogleTokenSuccess}
          onEmailSignIn={handleEmailSignIn}
          onSupabaseGoogleOAuth={handleSupabaseGoogleOAuth}
          onSupabasePasswordSignIn={handleSupabasePasswordSignIn}
          onSupabaseSignUp={handleSupabaseSignUp}
          onSupabaseForgotPassword={handleSupabaseForgotPassword}
          onSupabaseUpdatePassword={handleSupabaseUpdatePassword}
          onSignOutNoticeAccount={handleSignOut}
          authNotice={authNotice}
          oauthProcessing={oauthProcessing}
          oauthError={oauthError}
          onResetAuthNotice={() => {
            setAuthNotice(null);
            setOauthError(null);
          }}
        />
        <ToastNotification toast={toast} onDismiss={() => setToast(null)} />
      </>
    );
  }

  const isSuperAdmin = user.role === 'super_admin';
  const activeTab: ActiveTab =
    route.kind === 'admin' && isSuperAdmin
      ? 'admin_dashboard'
      : route.kind === 'my_classes'
        ? 'my_classes'
        : 'enter_class';

  const handleHeaderTabSelect = (tab: ActiveTab) => {
    if (tab !== 'enter_class') setEditingSession(null);
    if (tab === 'enter_class') navigate('/classroom-entry');
    else if (tab === 'my_classes') navigate('/my-classes');
    else if (isSuperAdmin) navigate('/admin/overview');
  };

  const handleSelectAdminSection = (section: AdminSectionSlug) => {
    if (!isSuperAdmin) {
      navigate('/access-denied', true);
      return;
    }
    navigate(`/admin/${section}`);
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <a
        href="#main-content"
        className="visually-hidden focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[#1EA7FF] focus:text-[#0A1B2C] focus:font-medium"
      >
        Skip to content
      </a>

      <AppHeader
        user={user}
        activeTab={activeTab}
        onSelectTab={handleHeaderTabSelect}
        onSignOut={() => void handleSignOut()}
        isLiveBackend={isGoogleSheetsLive}
        isSupabaseMode={isSupabaseMode}
        sheetsConnected={Boolean(oauthSheetsConn?.connected && oauthSheetsConn.spreadsheetId)}
        isTeamIntakeActive={isTeamIntakeActive}
        needsDirectReauth={isSuperAdmin ? needsDirectReauth : false}
        quickSyncOpen={isSuperAdmin ? quickSyncBarOpen : false}
        onToggleQuickSyncBar={
          isSuperAdmin
            ? () => {
                quickSyncUserToggledRef.current = true;
                setQuickSyncBarOpen((v) => !v);
              }
            : undefined
        }
        outboxCount={outboxItems.length}
        onOpenSyncStatus={isSuperAdmin ? () => setSyncModalOpen(true) : undefined}
        onRetryOutbox={!isSuperAdmin ? () => void handleRetryAllOutbox() : undefined}
        onOpenQuickAddModal={() =>
          setSubmissionModalState({ open: true, editingSession: null })
        }
      />

      <div id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {isSuperAdmin && (
          <TopGoogleSheetsQuickBar
            api={api}
            user={user}
            config={config}
            isOpen={quickSyncBarOpen}
            onToggleOpen={(nextOpen) => {
              quickSyncUserToggledRef.current = true;
              setQuickSyncBarOpen(nextOpen);
            }}
            isLiveBackend={env.isLiveBackendConfigured}
            isOAuthSheetsLive={isOAuthSheetsLive || isBridgeSheetsLive}
            needsDirectReauth={needsDirectReauth}
            connection={oauthSheetsConn}
            dataVersion={dataVersion}
            onConfigUpdated={(next) => setConfig(next)}
            onConnectionChanged={handleSheetsConnectionChanged}
            onEnvironmentChanged={() => setAuthEnvVersion((v) => v + 1)}
            onLiveBackendActivated={handleLiveBackendActivated}
            onSynced={handleSheetsWorkspaceSynced}
            onOpenSyncStatus={() => setSyncModalOpen(true)}
            onNotify={notify}
          />
        )}
        {route.kind === 'access_denied' ? (
          <main className="w-full max-w-xl mx-auto px-4 sm:px-6 pb-16 pt-4">
            <section
              role="alert"
              className="ct-card rounded-2xl p-6 sm:p-8 border-[#BE123C]/40 flex flex-col gap-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/35 flex items-center justify-center text-[#BE123C] shrink-0">
                  <ShieldAlert className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-medium text-[#0A1B2C]">
                    Access Denied
                  </h2>
                  <p className="text-xs sm:text-sm text-[#243647] mt-1 leading-relaxed">
                    Administrator permissions are required to access{' '}
                    <code className="text-[#BE123C]">{currentPath}</code>. Your Facilitator account is
                    strictly restricted to Classroom Data Entry and your own submissions.
                    Redirecting to Classroom Data Entry...
                  </p>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => navigate('/classroom-entry', true)}
                  className="ct-btn-primary text-sm"
                >
                  Return to Classroom Data Entry
                </button>
              </div>
            </section>
          </main>
        ) : route.kind === 'admin' && isSuperAdmin ? (
          <AdminDashboardPage
            api={api}
            user={user}
            config={config}
            activeSection={route.section}
            onSelectSection={handleSelectAdminSection}
            onConfigUpdated={(next) => setConfig(next)}
            isLiveBackend={isGoogleSheetsLive}
            needsDirectReauth={needsDirectReauth}
            oauthSheetsConnection={oauthSheetsConn}
            onConnectionChanged={handleSheetsConnectionChanged}
            dataVersion={dataVersion}
            outboxItems={outboxItems}
            onRetryOutboxItem={handleRetryOutboxItem}
            onRetryAllOutbox={handleRetryAllOutbox}
            onOutboxChanged={refreshOutbox}
            onEditSession={handleEditSession}
            onOpenNewModal={() =>
              setSubmissionModalState({ open: true, editingSession: null })
            }
            onOpenEditModal={(session) =>
              setSubmissionModalState({ open: true, editingSession: session })
            }
            onOpenSyncStatus={() => setSyncModalOpen(true)}
            onAuthorizeNow={handleAuthorizeDirectSheetsNow}
            onEnvironmentChanged={() => setAuthEnvVersion((v) => v + 1)}
            onLiveBackendActivated={handleLiveBackendActivated}
            onResetLiveBackend={handleResetLiveBackend}
            onNavigateSettings={() => handleSelectAdminSection('settings')}
            onNotify={notify}
          />
        ) : route.kind === 'my_classes' ? (
          <MyClassesPage
            api={api}
            user={user}
            config={config}
            dataVersion={dataVersion}
            isCentralDatabase={
              isSupabaseMode ||
              env.isLiveBackendConfigured ||
              (isSuperAdmin ? isGoogleSheetsLive : isTeamIntakeActive)
            }
            outboxCount={outboxItems.length}
            onRetryOutbox={!isSuperAdmin ? () => void handleRetryAllOutbox() : undefined}
            onEditSession={handleEditSession}
            onOpenNewModal={() =>
              setSubmissionModalState({ open: true, editingSession: null })
            }
            onOpenEditModal={(session) =>
              setSubmissionModalState({ open: true, editingSession: session })
            }
            onNotify={notify}
          />
        ) : (
          <main>
            <SessionEntryForm
              api={api}
              user={user}
              config={config}
              editingSession={editingSession}
              isGoogleSheetsLive={isGoogleSheetsLive}
              isTeamIntakeActive={isTeamIntakeActive}
              sheetsConnection={oauthSheetsConn}
              onCancelEdit={() => setEditingSession(null)}
              onSavedNavigateToMyClasses={() => {
                setEditingSession(null);
                navigate('/my-classes');
              }}
              onSessionSaved={() => {
                refreshOutbox();
                setDataVersion((v) => v + 1);
              }}
              onOpenSyncStatus={isSuperAdmin ? () => setSyncModalOpen(true) : undefined}
              onOutboxEnqueued={refreshOutbox}
              onNotify={notify}
            />
          </main>
        )}
      </div>

      <footer className="py-5 px-4 sm:px-6 text-center text-xs text-[#243647]">
        Developed by{' '}
        <a
          href="https://roosstudiox.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#0A1B2C] hover:text-[#006BB8] underline decoration-[#5F7082] hover:decoration-[#006BB8] underline-offset-4 transition-colors"
        >
          Roos StudioX
        </a>
      </footer>

      {/* Add / Edit Classroom Submission Modal */}
      <SubmissionFormModal
        open={submissionModalState.open}
        onClose={() => setSubmissionModalState({ open: false, editingSession: null })}
        api={api}
        user={user}
        config={config}
        editingSession={submissionModalState.editingSession}
        isGoogleSheetsLive={isGoogleSheetsLive}
        isTeamIntakeActive={isTeamIntakeActive}
        sheetsConnection={oauthSheetsConn}
        onSavedNavigateToMyClasses={() => {
          setSubmissionModalState({ open: false, editingSession: null });
          setDataVersion((v) => v + 1);
          navigate('/my-classes');
        }}
        onSessionSaved={() => {
          refreshOutbox();
          setDataVersion((v) => v + 1);
        }}
        onOpenSyncStatus={
          isSuperAdmin
            ? () => {
                setSubmissionModalState({ open: false, editingSession: null });
                setSyncModalOpen(true);
              }
            : undefined
        }
        onOutboxEnqueued={refreshOutbox}
        onNotify={notify}
      />

      {/* Google Sheets Sync Status & Outbox Modal — mounted strictly for SUPER_ADMIN */}
      {isSuperAdmin && (
        <GoogleSheetsSyncModal
          open={syncModalOpen}
          onClose={() => setSyncModalOpen(false)}
          api={api}
          user={user}
          isLiveBackend={isGoogleSheetsLive}
          needsDirectReauth={needsDirectReauth}
          oauthSheetsConnection={oauthSheetsConn}
          onConnectionChanged={handleSheetsConnectionChanged}
          onSynced={handleSheetsWorkspaceSynced}
          outboxItems={outboxItems}
          onRetryItem={handleRetryOutboxItem}
          onRetryAll={handleRetryAllOutbox}
          onOutboxChanged={refreshOutbox}
          onAuthorizeNow={handleAuthorizeDirectSheetsNow}
          onEnvironmentChanged={() => setAuthEnvVersion((v) => v + 1)}
          onLiveBackendActivated={handleLiveBackendActivated}
          onResetLiveBackend={handleResetLiveBackend}
          onNotify={notify}
        />
      )}

      <ToastNotification toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

export default App;
