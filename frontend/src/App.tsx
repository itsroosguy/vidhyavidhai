import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { AdminDashboardPage } from './admin/AdminDashboardPage';
import { AppHeader, type ActiveTab } from './components/layout/AppHeader';
import { AuthGate, type AuthNoticeState } from './components/layout/AuthGate';
import { GoogleSheetsSyncModal } from './components/modals/GoogleSheetsSyncModal';
import { SubmissionFormModal } from './components/modals/SubmissionFormModal';
import { ToastNotification, type ToastMessage } from './components/ui/ToastNotification';
import { DEFAULT_APP_CONFIGURATION, generateUuid } from './config/defaults';
import { MyClassesPage } from './dashboard/MyClassesPage';
import { SessionEntryForm } from './forms/SessionEntryForm';
import { createApiClient } from './services/apiClient';
import {
  decodeJwtClaimsUnsafe,
  getAuthEnvironment,
} from './services/authService';
import {
  appendLocalSyncEvent,
  enqueueSyncOutboxItem,
  loadSyncOutbox,
  removeSyncOutboxItem,
} from './services/syncService';
import type {
  AppConfiguration,
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
  type AdminSectionSlug,
} from './utils/routes';

export function App() {
  const env = useMemo(() => getAuthEnvironment(), []);

  const idTokenRef = useRef<string | undefined>(undefined);
  const sandboxActorIdRef = useRef<string>('');

  const api = useMemo(
    () =>
      createApiClient(
        () => idTokenRef.current,
        () => sandboxActorIdRef.current,
      ),
    [],
  );

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authNotice, setAuthNotice] = useState<AuthNoticeState | null>(null);
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

  const navigate = useCallback((nextPath: string, replace = false) => {
    navigateToPath(nextPath, replace);
    setCurrentPath(stripBasePath(nextPath));
  }, []);

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
    if (!user || route.kind !== 'access_denied') return;
    const timer = setTimeout(() => {
      navigate(getDefaultPathForRole(user.role), true);
    }, 1400);
    return () => clearTimeout(timer);
  }, [navigate, route.kind, user]);

  // Update document.title dynamically across authentication & navigation routes
  useEffect(() => {
    const brand = 'Vidhya Vidhai Foundation · Career Tours';
    if (!user) {
      if (authNotice?.kind === 'pending_approval') {
        document.title = `Account Pending Approval | ${brand}`;
      } else if (authNotice?.kind === 'access_denied') {
        document.title = `Access Denied | ${brand}`;
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
  }, [authNotice?.kind, route, user]);

  const loadConfig = useCallback(async () => {
    const res = await api.getAppConfiguration();
    if (res.ok && res.data) {
      setConfig(res.data);
    }
  }, [api]);

  const handleGoogleTokenSuccess = useCallback(
    async (idToken: string) => {
      setAuthNotice(null);
      idTokenRef.current = idToken;
      const userRes = await api.getCurrentUser();
      if (!userRes.ok || !userRes.data) {
        idTokenRef.current = undefined;
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
      setUser(userRes.data);
      setAuthNotice(null);
      navigate(getDefaultPathForRole(userRes.data.role), true);
      await loadConfig();
    },
    [api, loadConfig, navigate],
  );

  const handleEmailSignIn = useCallback(
    async (emailInput: string) => {
      if (!api.authenticateSandboxEmail) return;
      const cleanEmail = emailInput.trim().toLowerCase();
      const res = await api.authenticateSandboxEmail(cleanEmail);
      if (!res.ok || !res.data) {
        const isPending = res.code === 'PENDING_APPROVAL';
        setAuthNotice({
          kind: isPending ? 'pending_approval' : 'access_denied',
          email: cleanEmail,
          message:
            res.error ||
            'Access denied. Contact an Administrator to activate your Facilitator account.',
        });
        navigate(isPending ? '/pending-approval' : '/access-denied', true);
        return;
      }

      sandboxActorIdRef.current = res.data.userId;
      setAuthNotice(null);
      setUser(res.data);
      navigate(getDefaultPathForRole(res.data.role), true);
      await loadConfig();
    },
    [api, loadConfig, navigate],
  );

  const handleSignOut = () => {
    idTokenRef.current = undefined;
    sandboxActorIdRef.current = '';
    setUser(null);
    setAuthNotice(null);
    setEditingSession(null);
    setSubmissionModalState({ open: false, editingSession: null });
    setSyncModalOpen(false);
    navigate('/login', true);
  };

  const handleEditSession = (session: SessionRecord) => {
    setEditingSession(session);
    navigate('/classroom-entry');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRetryOutboxItem = useCallback(
    async (item: SyncOutboxItem) => {
      if (!user) return;
      const res =
        item.operation === 'updateSession' && item.sessionRecordId
          ? await api.updateSession(item.sessionRecordId, item.values)
          : await api.createSession(item.values);

      if (res.ok && res.data) {
        removeSyncOutboxItem(user.email, item.clientSubmissionKey);
        appendLocalSyncEvent(user.email, {
          syncId: generateUuid(),
          timestamp: new Date().toISOString(),
          clientSubmissionKey: item.clientSubmissionKey,
          sessionRecordId: res.data.session.sessionRecordId,
          sessionId: res.data.session.sessionId,
          actorEmail: user.email,
          operation: item.operation,
          attempt: item.attempts + 1,
          status: env.isLiveBackendConfigured ? 'SYNCED' : 'LOCAL_SANDBOX',
          errorMessage: '',
        });
        refreshOutbox();
        setDataVersion((v) => v + 1);
        notify('success', 'Queued submission synced', `${res.data.session.sessionId} saved.`);
      } else {
        enqueueSyncOutboxItem(user.email, {
          ...item,
          syncStatus: 'FAILED',
          attempts: item.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: res.error || 'Retry failed.',
        });
        appendLocalSyncEvent(user.email, {
          syncId: generateUuid(),
          timestamp: new Date().toISOString(),
          clientSubmissionKey: item.clientSubmissionKey,
          sessionRecordId: item.sessionRecordId ?? '',
          sessionId: item.sessionId ?? '',
          actorEmail: user.email,
          operation: item.operation,
          attempt: item.attempts + 1,
          status: 'FAILED',
          errorMessage: res.error || 'Retry failed.',
        });
        refreshOutbox();
        notify('error', 'Sync retry failed', res.error);
      }
    },
    [api, env.isLiveBackendConfigured, notify, refreshOutbox, user],
  );

  const handleRetryAllOutbox = useCallback(async () => {
    for (const item of [...outboxItems]) {
      await handleRetryOutboxItem(item);
    }
  }, [handleRetryOutboxItem, outboxItems]);

  if (!user) {
    return (
      <>
        <AuthGate
          isLiveBackend={env.isLiveBackendConfigured}
          googleClientId={env.googleClientId}
          onGoogleTokenSuccess={handleGoogleTokenSuccess}
          onEmailSignIn={handleEmailSignIn}
          authNotice={authNotice}
          onResetAuthNotice={() => {
            setAuthNotice(null);
            navigate('/login', true);
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
        onSignOut={handleSignOut}
        isLiveBackend={env.isLiveBackendConfigured}
        outboxCount={outboxItems.length}
        onOpenSyncStatus={isSuperAdmin ? () => setSyncModalOpen(true) : undefined}
        onRetryOutbox={!isSuperAdmin ? () => void handleRetryAllOutbox() : undefined}
        onOpenQuickAddModal={() =>
          setSubmissionModalState({ open: true, editingSession: null })
        }
      />

      <div id="main-content" tabIndex={-1} className="flex-1 outline-none">
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
            isLiveBackend={env.isLiveBackendConfigured}
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
            onNavigateSettings={() => handleSelectAdminSection('settings')}
            onNotify={notify}
          />
        ) : route.kind === 'my_classes' ? (
          <MyClassesPage
            api={api}
            user={user}
            config={config}
            dataVersion={dataVersion}
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
          isLiveBackend={env.isLiveBackendConfigured}
          outboxItems={outboxItems}
          onRetryItem={handleRetryOutboxItem}
          onRetryAll={handleRetryAllOutbox}
          onOutboxChanged={refreshOutbox}
        />
      )}

      <ToastNotification toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

export default App;
