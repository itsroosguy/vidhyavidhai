import { computeDashboardAnalytics, filterSessionRecords } from '../calculations/analytics';
import { calculateSessionMetrics } from '../calculations/metrics';
import { INITIAL_SUPER_ADMINS, isAllowlistedSuperAdmin, normalizeEmail } from '../config/accessControl';
import {
  DEFAULT_APP_CONFIGURATION,
  DEFAULT_TARGET_SPREADSHEET_ID,
  DEFAULT_TARGET_SPREADSHEET_URL,
  generateUuid,
  parseGoogleSpreadsheetId,
} from '../config/defaults';
import type {
  ApiResponse,
  AppConfiguration,
  AuditLogEntry,
  DashboardAnalytics,
  DistrictBlockEntry,
  GoogleSheetsConnectionState,
  GoogleSpreadsheetSummary,
  ManagedUser,
  PaginatedResult,
  SchoolRecord,
  SessionDetailRecord,
  SessionFormValues,
  SessionQueryFilters,
  SessionRecord,
  SheetsSyncSummary,
  SyncLogEntry,
  UserApprovalStatus,
  UserProfile,
  UserRole,
} from '../types/domain';
import { buildSessionIdPrefix, formatSessionIdWithSequence, resolveConfiguredVideoId } from '../utils/sessionId';
import {
  calculateSessionDurationMinutes,
  formatDurationHuman,
  formatISODateToDDMMYYYY,
  getMonthNameFromISO,
  getTodayKolkataISO,
} from '../utils/temporal';
import { validateSessionForm } from '../validations/sessionValidation';
import { SANDBOX_DENIED_USER, SANDBOX_USERS_LIST, getAuthEnvironment } from './authService';

export interface BackendHealthInfo {
  mode: 'apps_script' | 'local_sandbox';
  connectedToGoogleSheets: boolean;
  status: 'READY' | 'LOCAL_SANDBOX';
  checkedAt: string;
  endpointConfigured: boolean;
}

export interface BackendApiClient {
  mode: 'apps_script' | 'local_sandbox';
  pingHealth(): Promise<ApiResponse<BackendHealthInfo>>;
  getCurrentUser(): Promise<ApiResponse<UserProfile>>;
  getAppConfiguration(): Promise<ApiResponse<AppConfiguration>>;
  saveAppConfiguration(config: Partial<AppConfiguration>): Promise<ApiResponse<AppConfiguration>>;
  importBlockMaster(
    entries: DistrictBlockEntry[],
    replaceExisting: boolean,
  ): Promise<ApiResponse<{ importedCount: number; totalCount: number }>>;
  createSession(
    values: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[]; schoolUdiseConflict?: string }>>;
  updateSession(
    sessionRecordId: string,
    values: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[] }>>;
  archiveSession(sessionRecordId: string): Promise<ApiResponse<{ archived: boolean }>>;
  getSessionById(sessionRecordId: string): Promise<ApiResponse<SessionRecord>>;
  getMySessions(filters: SessionQueryFilters): Promise<ApiResponse<PaginatedResult<SessionRecord>>>;
  getAdminSessions(filters: SessionQueryFilters): Promise<ApiResponse<PaginatedResult<SessionRecord>>>;
  getDashboardSummary(filters: SessionQueryFilters): Promise<ApiResponse<DashboardAnalytics>>;
  getSchoolByUdise(udiseCode: string): Promise<ApiResponse<SchoolRecord | null>>;
  searchSchools(query: string): Promise<ApiResponse<SchoolRecord[]>>;
  listManagedUsers(): Promise<ApiResponse<ManagedUser[]>>;
  manageUser(user: {
    userId?: string;
    name: string;
    email: string;
    role: UserRole;
    active: boolean;
    status?: UserApprovalStatus;
  }): Promise<ApiResponse<ManagedUser>>;
  authenticateSandboxEmail?(email: string, name?: string): Promise<ApiResponse<UserProfile>>;
  getAuditLogs(page?: number, pageSize?: number): Promise<ApiResponse<PaginatedResult<AuditLogEntry>>>;
  getSyncLogs(page?: number, pageSize?: number): Promise<ApiResponse<PaginatedResult<SyncLogEntry>>>;
  logExportEvent(scope: string, rowCount: number, format: string): Promise<ApiResponse<{ logged: boolean }>>;
  getSheetsConnection(): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  listGoogleSpreadsheets(): Promise<ApiResponse<GoogleSpreadsheetSummary[]>>;
  connectGoogleSheet(params: {
    spreadsheetUrlOrId: string;
    spreadsheetName?: string;
    initializeSchema?: boolean;
    googleAccount?: string;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  createGoogleSheet(params: {
    title: string;
    googleAccount?: string;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  disconnectGoogleSheet(): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  syncAllToGoogleSheet(): Promise<ApiResponse<SheetsSyncSummary>>;
  getSheetsOAuthStartUrl?(loginHint?: string): string | null;
}

const DEFAULT_SCHEMA_TABS = [
  'Sessions',
  'Session Details',
  'Facilitators',
  'Schools',
  'Configuration',
  'Admin Users',
  'Audit Log',
  'Sync Log',
];

const SANDBOX_SHEETS_CONN_KEY = 'ct_sandbox_sheets_conn_v1';

function buildDisconnectedState(
  authMethod: GoogleSheetsConnectionState['authMethod'],
  oauthConfigured = false,
): GoogleSheetsConnectionState {
  return {
    connected: false,
    authMethod,
    oauthConfigured,
    connectedAccount: '',
    spreadsheetId: '',
    spreadsheetName: '',
    spreadsheetUrl: '',
    connectedAt: '',
    connectedBy: '',
    lastSyncedAt: '',
    lastSyncStatus: 'IDLE',
    lastSyncMessage: '',
    initializedTabs: [],
    defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
    defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
  };
}

class AppsScriptApiClient implements BackendApiClient {
  mode = 'apps_script' as const;
  private url: string;
  private sheetsBackendUrl: string;
  private getIdToken: () => string | undefined;

  constructor(url: string, getIdToken: () => string | undefined, sheetsBackendUrl = '') {
    this.url = url;
    this.getIdToken = getIdToken;
    this.sheetsBackendUrl = sheetsBackendUrl;
  }

  async pingHealth(): Promise<ApiResponse<BackendHealthInfo>> {
    try {
      const res = await fetch(this.url, { method: 'GET' });
      if (!res.ok) {
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          error: `Google Apps Script health check returned HTTP ${res.status}.`,
        };
      }
      const body = (await res.json()) as { ok?: boolean; status?: string };
      return {
        ok: Boolean(body.ok),
        data: {
          mode: 'apps_script',
          connectedToGoogleSheets: Boolean(body.ok),
          status: 'READY',
          checkedAt: new Date().toISOString(),
          endpointConfigured: true,
        },
      };
    } catch (err) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        error: err instanceof Error ? err.message : 'Unable to reach Apps Script Web App URL.',
      };
    }
  }

  private async call<T>(action: string, payload: unknown = {}): Promise<ApiResponse<T>> {
    const idToken = this.getIdToken();
    if (!idToken) {
      return { ok: false, code: 'UNAUTHENTICATED', error: 'Please sign in with Google first.' };
    }

    let lastError = 'Network request failed.';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Content-Type: text/plain avoids CORS preflight OPTIONS failure on Google Apps Script Web Apps
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action, idToken, payload }),
        });
        if (!res.ok) {
          lastError = `Backend HTTP error ${res.status}`;
          continue;
        }
        return (await res.json()) as ApiResponse<T>;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Unable to reach Apps Script backend.';
      }
    }
    return { ok: false, code: 'NETWORK_ERROR', error: lastError };
  }

  getCurrentUser() {
    return this.call<UserProfile>('getCurrentUser');
  }
  getAppConfiguration() {
    return this.call<AppConfiguration>('getAppConfiguration');
  }
  saveAppConfiguration(config: Partial<AppConfiguration>) {
    return this.call<AppConfiguration>('saveAppConfiguration', { config });
  }
  importBlockMaster(entries: DistrictBlockEntry[], replaceExisting: boolean) {
    return this.call<{ importedCount: number; totalCount: number }>('importBlockMaster', {
      entries,
      replaceExisting,
    });
  }
  async createSession(values: SessionFormValues) {
    const res = await this.call<{
      session: SessionRecord;
      warnings: string[];
      schoolUdiseConflict?: string;
    }>('createSession', { values });
    if (res.ok && res.data?.session) {
      res.data.session.syncStatus = 'SYNCED';
      res.data.session.syncedAt = new Date().toISOString();
    }
    return res;
  }
  async updateSession(sessionRecordId: string, values: SessionFormValues) {
    const res = await this.call<{ session: SessionRecord; warnings: string[] }>('updateSession', {
      sessionRecordId,
      values,
    });
    if (res.ok && res.data?.session) {
      res.data.session.syncStatus = 'SYNCED';
      res.data.session.syncedAt = new Date().toISOString();
    }
    return res;
  }
  archiveSession(sessionRecordId: string) {
    return this.call<{ archived: boolean }>('archiveSession', { sessionRecordId });
  }
  getSessionById(sessionRecordId: string) {
    return this.call<SessionRecord>('getSessionById', { sessionRecordId });
  }
  getMySessions(filters: SessionQueryFilters) {
    return this.call<PaginatedResult<SessionRecord>>('getMySessions', { filters });
  }
  getAdminSessions(filters: SessionQueryFilters) {
    return this.call<PaginatedResult<SessionRecord>>('getAdminSessions', { filters });
  }
  getDashboardSummary(filters: SessionQueryFilters) {
    return this.call<DashboardAnalytics>('getDashboardSummary', { filters });
  }
  getSchoolByUdise(udiseCode: string) {
    return this.call<SchoolRecord | null>('getSchoolByUdise', { udiseCode });
  }
  searchSchools(query: string) {
    return this.call<SchoolRecord[]>('searchSchools', { query });
  }
  listManagedUsers() {
    return this.call<ManagedUser[]>('listManagedUsers');
  }
  manageUser(user: {
    userId?: string;
    name: string;
    email: string;
    role: UserRole;
    active: boolean;
    status?: UserApprovalStatus;
  }) {
    return this.call<ManagedUser>('manageUser', { user });
  }
  getAuditLogs(page = 1, pageSize = 25) {
    return this.call<PaginatedResult<AuditLogEntry>>('getAuditLogs', { page, pageSize });
  }
  getSyncLogs(page = 1, pageSize = 25) {
    return this.call<PaginatedResult<SyncLogEntry>>('getSyncLogs', { page, pageSize });
  }
  logExportEvent(scope: string, rowCount: number, format: string) {
    return this.call<{ logged: boolean }>('logExportEvent', { scope, rowCount, format });
  }

  getSheetsOAuthStartUrl(loginHint?: string): string | null {
    if (!this.sheetsBackendUrl) return null;
    const base = this.sheetsBackendUrl.replace(/\/$/, '');
    const q = new URLSearchParams({ action: 'oauthStart' });
    if (loginHint) q.set('login_hint', loginHint);
    return `${base}?${q.toString()}`;
  }

  private async callSheetsBackend<T>(
    method: 'GET' | 'POST',
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<ApiResponse<T>> {
    const base = this.sheetsBackendUrl.replace(/\/$/, '');
    const idToken = this.getIdToken();
    try {
      const url = method === 'GET' ? `${base}?action=${encodeURIComponent(action)}` : base;
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: method === 'POST' ? JSON.stringify({ action, ...payload }) : undefined,
      });
      return (await res.json()) as ApiResponse<T>;
    } catch (err) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        error: err instanceof Error ? err.message : 'Unable to reach OAuth Google Sheets backend.',
      };
    }
  }

  async getSheetsConnection(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    if (this.sheetsBackendUrl) {
      const oauthRes = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthRes.ok && oauthRes.data?.connected) {
        return oauthRes;
      }
      const asRes = await this.call<GoogleSheetsConnectionState>('getSheetsConnection');
      if (asRes.ok && asRes.data) {
        return {
          ok: true,
          data: {
            ...asRes.data,
            oauthConfigured: Boolean(oauthRes.data?.oauthConfigured),
            connectedAccount:
              asRes.data.connectedAccount || oauthRes.data?.connectedAccount || '',
          },
        };
      }
      return oauthRes;
    }
    return this.call<GoogleSheetsConnectionState>('getSheetsConnection');
  }

  async listGoogleSpreadsheets(): Promise<ApiResponse<GoogleSpreadsheetSummary[]>> {
    if (this.sheetsBackendUrl) {
      return this.callSheetsBackend<GoogleSpreadsheetSummary[]>('POST', 'listSpreadsheets');
    }
    const current = await this.call<GoogleSheetsConnectionState>('getSheetsConnection');
    if (current.ok && current.data?.connected && current.data.spreadsheetId) {
      return {
        ok: true,
        data: [
          {
            spreadsheetId: current.data.spreadsheetId,
            name: current.data.spreadsheetName,
            url: current.data.spreadsheetUrl,
          },
        ],
      };
    }
    return {
      ok: true,
      data: [
        {
          spreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
          name: 'Vidhya Vidhai · Target Career Tours Sheet',
          url: DEFAULT_TARGET_SPREADSHEET_URL,
        },
      ],
    };
  }

  async connectGoogleSheet(params: {
    spreadsheetUrlOrId: string;
    spreadsheetName?: string;
    initializeSchema?: boolean;
    googleAccount?: string;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    if (this.sheetsBackendUrl) {
      const oauthStatus = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthStatus.ok && oauthStatus.data?.oauthConfigured) {
        return this.callSheetsBackend<GoogleSheetsConnectionState>('POST', 'connect', params);
      }
    }
    return this.call<GoogleSheetsConnectionState>('connectGoogleSheet', params);
  }

  async createGoogleSheet(params: {
    title: string;
    googleAccount?: string;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    if (this.sheetsBackendUrl) {
      const oauthStatus = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthStatus.ok && oauthStatus.data?.oauthConfigured) {
        return this.callSheetsBackend<GoogleSheetsConnectionState>('POST', 'create', params);
      }
    }
    return this.call<GoogleSheetsConnectionState>('createGoogleSheet', params);
  }

  async disconnectGoogleSheet(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    if (this.sheetsBackendUrl) {
      const oauthStatus = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthStatus.ok && oauthStatus.data?.oauthConfigured && oauthStatus.data.connected) {
        await this.callSheetsBackend<GoogleSheetsConnectionState>('POST', 'disconnect');
      }
    }
    return this.call<GoogleSheetsConnectionState>('disconnectGoogleSheet');
  }

  async syncAllToGoogleSheet(): Promise<ApiResponse<SheetsSyncSummary>> {
    if (this.sheetsBackendUrl) {
      const oauthStatus = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthStatus.ok && oauthStatus.data?.oauthConfigured && oauthStatus.data.connected) {
        const collected: SessionRecord[] = [];
        let page = 1;
        let totalPages = 1;
        do {
          const allRes = await this.call<PaginatedResult<SessionRecord>>('getAdminSessions', {
            filters: { includeArchived: true, page, pageSize: 100 },
          });
          if (!allRes.ok || !allRes.data) break;
          collected.push(...allRes.data.items);
          totalPages = allRes.data.totalPages || 1;
          page++;
        } while (page <= totalPages);
        return this.callSheetsBackend<SheetsSyncSummary>('POST', 'sync', {
          sessions: collected,
        });
      }
    }
    return this.call<SheetsSyncSummary>('syncAllToGoogleSheet', {});
  }
}

/**
 * Isolated in-memory / optional-storage sandbox repository for local development & automated tests
 * when Google Apps Script & Google OAuth have not been provisioned yet.
 * Enforces identical server-side RBAC, LockService-style async mutex, Session ID uniqueness,
 * PENDING -> COMMITTED write semantics, and Audit Log immutability.
 */
export class LocalSandboxApiClient implements BackendApiClient {
  mode = 'local_sandbox' as const;
  private getActorId: () => string;
  private config: AppConfiguration;
  private users: ManagedUser[] = [];
  private sessions: SessionRecord[] = [];
  private schools: SchoolRecord[] = [];
  private auditLogs: AuditLogEntry[] = [];
  private syncLogs: SyncLogEntry[] = [];
  private syncedSessionKeys: Set<string> = new Set();
  private lockQueue: Promise<void> = Promise.resolve();
  private simulatePartialFailureOnce = false;
  private sheetsConnection: GoogleSheetsConnectionState;
  private sheetsBackendUrl: string;

  constructor(getActorId: () => string, initialConfig?: Partial<AppConfiguration>, sheetsBackendUrl = '') {
    this.getActorId = getActorId;
    this.sheetsBackendUrl = sheetsBackendUrl;
    this.config = {
      ...DEFAULT_APP_CONFIGURATION,
      ...initialConfig,
    };

    const now = new Date().toISOString();
    this.users = [...SANDBOX_USERS_LIST, SANDBOX_DENIED_USER].map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      status: u.status ?? (u.active ? 'APPROVED' : 'DENIED'),
      createdAt: now,
      updatedAt: now,
    }));

    this.sheetsConnection = this.loadPersistedSheetsConnection();
  }

  private loadPersistedSheetsConnection(): GoogleSheetsConnectionState {
    if (typeof localStorage === 'undefined') {
      return this.sheetsConnection ?? buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
    }
    try {
      const raw = localStorage.getItem(SANDBOX_SHEETS_CONN_KEY);
      if (!raw) {
        return buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
      }
      const parsed = JSON.parse(raw) as Partial<GoogleSheetsConnectionState>;
      if (!parsed || typeof parsed.connected !== 'boolean') {
        return buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
      }
      return {
        ...buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl)),
        ...parsed,
        defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
      };
    } catch {
      return buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
    }
  }

  private savePersistedSheetsConnection(next: GoogleSheetsConnectionState): void {
    this.sheetsConnection = next;
    if (typeof localStorage === 'undefined') return;
    try {
      if (!next.connected) {
        localStorage.removeItem(SANDBOX_SHEETS_CONN_KEY);
      } else {
        localStorage.setItem(SANDBOX_SHEETS_CONN_KEY, JSON.stringify(next));
      }
    } catch {
      // Ignore storage quota errors
    }
  }

  async pingHealth(): Promise<ApiResponse<BackendHealthInfo>> {
    return {
      ok: true,
      data: {
        mode: 'local_sandbox',
        connectedToGoogleSheets: false,
        status: 'LOCAL_SANDBOX',
        checkedAt: new Date().toISOString(),
        endpointConfigured: false,
      },
    };
  }

  public setSimulatePartialFailureOnce(flag: boolean): void {
    this.simulatePartialFailureOnce = flag;
  }

  public getRawSessionsForTest(): SessionRecord[] {
    return this.sessions;
  }

  private withMutex<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.lockQueue.then(() => fn());
    this.lockQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private resolveActor(): ManagedUser | null {
    const actorId = this.getActorId();
    return this.users.find((u) => u.userId === actorId && u.active) ?? null;
  }

  private recordAudit(
    actor: ManagedUser | null,
    action: string,
    entityType: string,
    entityId: string,
    previousSummary: string,
    newSummary: string,
    result: AuditLogEntry['result'],
  ): void {
    this.auditLogs.unshift({
      auditId: `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      userId: actor?.userId ?? 'UNKNOWN',
      userEmail: actor?.email ?? 'UNKNOWN',
      action,
      entityType,
      entityId,
      previousSummary,
      newSummary,
      result,
    });
  }

  async getCurrentUser(): Promise<ApiResponse<UserProfile>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'User is inactive or unknown.' };
    const authoritativeRole: UserRole = isAllowlistedSuperAdmin(actor.email)
      ? 'super_admin'
      : 'facilitator';
    return {
      ok: true,
      data: {
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        role: authoritativeRole,
        active: actor.active,
        status: actor.status ?? 'APPROVED',
        authMode: 'local_sandbox',
      },
    };
  }

  async authenticateSandboxEmail(email: string, name?: string): Promise<ApiResponse<UserProfile>> {
    return this.withMutex(async () => {
      const cleanEmail = normalizeEmail(email);
      if (!cleanEmail) {
        return { ok: false, code: 'UNAUTHENTICATED', error: 'Email is required.' };
      }

      const allowlisted = INITIAL_SUPER_ADMINS.find((sa) => sa.email === cleanEmail);
      if (allowlisted) {
        return {
          ok: true,
          data: {
            userId: allowlisted.userId,
            name: allowlisted.name,
            email: allowlisted.email,
            role: 'super_admin',
            active: true,
            status: 'APPROVED',
            authMode: 'local_sandbox',
          },
        };
      }

      const matched = this.users.find((u) => normalizeEmail(u.email) === cleanEmail);
      if (matched) {
        if (matched.status === 'PENDING') {
          this.recordAudit(matched, 'AUTH_PENDING', 'Auth', matched.userId, '', 'Pending administrator approval', 'DENIED');
          return {
            ok: false,
            code: 'PENDING_APPROVAL',
            error: `Your Google account ("${cleanEmail}") is pending Administrator approval.`,
          };
        }
        if (!matched.active || matched.status === 'DENIED') {
          this.recordAudit(matched, 'AUTH_DENIED', 'Auth', matched.userId, '', 'Denied user sign-in blocked', 'DENIED');
          return {
            ok: false,
            code: 'ACCESS_DENIED',
            error: `Access denied for "${cleanEmail}". Contact an Administrator.`,
          };
        }
        return {
          ok: true,
          data: {
            userId: matched.userId,
            name: matched.name,
            email: matched.email,
            role: 'facilitator',
            active: true,
            status: 'APPROVED',
            authMode: 'local_sandbox',
          },
        };
      }

      const approvalMode = this.config.policy.facilitatorApprovalMode ?? 'auto_approve';
      const now = new Date().toISOString();
      const newUserId = `FAC_${generateUuid().slice(0, 8).toUpperCase()}`;
      const derivedLocalPart = (cleanEmail.split('@')[0] ?? cleanEmail)
        .replace(/[._-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const displayName = (name ?? (derivedLocalPart || cleanEmail)).trim();

      if (approvalMode === 'auto_approve') {
        const created: ManagedUser = {
          userId: newUserId,
          name: displayName,
          email: cleanEmail,
          role: 'facilitator',
          active: true,
          status: 'APPROVED',
          createdAt: now,
          updatedAt: now,
        };
        this.users.push(created);
        this.recordAudit(created, 'AUTH_AUTO_APPROVED', 'Auth', newUserId, '', 'Auto-approved Google facilitator sign-in', 'SUCCESS');
        return {
          ok: true,
          data: {
            userId: created.userId,
            name: created.name,
            email: created.email,
            role: 'facilitator',
            active: true,
            status: 'APPROVED',
            authMode: 'local_sandbox',
          },
        };
      }

      const pendingUser: ManagedUser = {
        userId: newUserId,
        name: displayName,
        email: cleanEmail,
        role: 'facilitator',
        active: false,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      };
      this.users.push(pendingUser);
      this.recordAudit(pendingUser, 'AUTH_PENDING', 'Auth', newUserId, '', 'Registered as PENDING under manual_allowlist policy', 'DENIED');
      return {
        ok: false,
        code: 'PENDING_APPROVAL',
        error: `Your Google account ("${cleanEmail}") has been recorded and is awaiting Administrator approval.`,
      };
    });
  }

  async getAppConfiguration(): Promise<ApiResponse<AppConfiguration>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    const full = structuredClone(this.config);
    if (actor.role === 'super_admin') {
      return { ok: true, data: full };
    }
    return {
      ok: true,
      data: {
        ...full,
        partnerName: '',
        reportingDefaults: {
          ...full.reportingDefaults,
          cc: '',
          underservedReach: '',
        },
        policy: {
          allowFacilitatorDeleteOwn: Boolean(full.policy.allowFacilitatorDeleteOwn),
          allowFacilitatorExportOwn: false,
          facilitatorApprovalMode: 'manual_allowlist',
        },
        exportTemplate63: null,
      },
    };
  }

  async saveAppConfiguration(partial: Partial<AppConfiguration>): Promise<ApiResponse<AppConfiguration>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'UPDATE_CONFIG', 'Configuration', 'SYSTEM', '', 'Unauthorized attempt', 'DENIED');
      return {
        ok: false,
        code: 'FORBIDDEN',
        error: 'Only Super Administrators can modify system configuration.',
      };
    }
    const prev = JSON.stringify({
      schoolYear: this.config.schoolYear,
      partnerName: this.config.partnerName,
      districts: this.config.allowedDistricts,
    });
    const nextConfig: AppConfiguration = { ...this.config, ...partial };
    if (partial.policy) {
      nextConfig.policy = {
        allowFacilitatorDeleteOwn: partial.policy.allowFacilitatorDeleteOwn !== false,
        allowFacilitatorExportOwn: false,
        facilitatorApprovalMode:
          partial.policy.facilitatorApprovalMode === 'auto_approve'
            ? 'auto_approve'
            : 'manual_allowlist',
      };
    }
    this.config = nextConfig;
    this.recordAudit(
      actor,
      'UPDATE_CONFIG',
      'Configuration',
      'SYSTEM',
      prev,
      JSON.stringify({
        schoolYear: this.config.schoolYear,
        partnerName: this.config.partnerName,
        districts: this.config.allowedDistricts,
      }),
      'SUCCESS',
    );
    return { ok: true, data: structuredClone(this.config) };
  }

  async importBlockMaster(
    entries: DistrictBlockEntry[],
    replaceExisting: boolean,
  ): Promise<ApiResponse<{ importedCount: number; totalCount: number }>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'IMPORT_BLOCKS', 'Configuration', 'BLOCKS', '', 'Denied', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }

    const validMap = new Map<string, DistrictBlockEntry>();
    if (!replaceExisting) {
      for (const existing of this.config.districtBlocks) {
        validMap.set(`${existing.district}::${existing.block.toLowerCase()}`, existing);
      }
    }

    let importedCount = 0;
    for (const row of entries) {
      const d = row.district.trim();
      const b = row.block.trim();
      if (!this.config.allowedDistricts.includes(d) || !b) {
        return {
          ok: false,
          code: 'INVALID_BLOCK_ROW',
          error: `Invalid district/block entry: "${d}" / "${b}".`,
        };
      }
      validMap.set(`${d}::${b.toLowerCase()}`, { district: d, block: b, active: row.active });
      importedCount++;
    }

    this.config.districtBlocks = Array.from(validMap.values());
    this.recordAudit(
      actor,
      'IMPORT_BLOCKS',
      'Configuration',
      'BLOCKS',
      `replace=${replaceExisting}`,
      `imported=${importedCount}, total=${this.config.districtBlocks.length}`,
      'SUCCESS',
    );
    return {
      ok: true,
      data: { importedCount, totalCount: this.config.districtBlocks.length },
    };
  }

  async createSession(
    rawValues: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[]; schoolUdiseConflict?: string }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };

      // Server enforces authoritative identity — never trust browser-supplied email impersonation
      const values: SessionFormValues = {
        ...rawValues,
        facilitatorEmail: actor.email,
        schoolName: rawValues.schoolName.trim(),
        udiseCode: rawValues.udiseCode.trim(),
        pinCode: rawValues.pinCode.trim(),
      };

      // Idempotency / duplicate submission protection
      const existingByKey = this.sessions.find(
        (s) => s.clientSubmissionKey === values.clientSubmissionKey && s.submissionStatus !== 'PENDING',
      );
      if (existingByKey) {
        return {
          ok: true,
          data: { session: structuredClone(existingByKey), warnings: ['Duplicate submission prevented — returned existing record.'] },
        };
      }

      const validation = validateSessionForm(values, this.config);
      if (!validation.valid) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          error: validation.errors.map((e) => e.message).join(' '),
        };
      }

      const tour = this.config.tours.find((t) => t.tourId === values.tourId)!;
      const metrics = calculateSessionMetrics(
        values.classes,
        values.teacherNpsGroup,
        values.teacherExactScore,
      );
      const durationMinutes =
        calculateSessionDurationMinutes(
          values.startDate,
          values.startTime,
          values.endDate,
          values.endTime,
          this.config.programmeTimezone,
        ) ?? 0;

      const prefix = buildSessionIdPrefix(
        values.startDate,
        values.udiseCode,
        values.sessionMode,
        values.classes,
      );
      if (!prefix) {
        return { ok: false, code: 'SESSION_ID_ERROR', error: 'Unable to derive Session ID.' };
      }

      // Collision-safe sequence calculation under mutex
      let maxSeq = 0;
      for (const existing of this.sessions) {
        if (existing.sessionId.startsWith(`${prefix}_`)) {
          const tail = existing.sessionId.slice(prefix.length + 1);
          const n = Number.parseInt(tail, 10);
          if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
        }
      }

      let candidateSeq = maxSeq + 1;
      let sessionId = formatSessionIdWithSequence(prefix, candidateSeq);
      while (this.sessions.some((s) => s.sessionId === sessionId)) {
        candidateSeq++;
        sessionId = formatSessionIdWithSequence(prefix, candidateSeq);
      }

      const nowIso = new Date().toISOString();
      const todayKolkata = getTodayKolkataISO(this.config.programmeTimezone);
      const sessionRecordId = `REC_${generateUuid().toUpperCase()}`;
      const videoInfo = resolveConfiguredVideoId(tour, values.language, this.config);

      const detailRecords: SessionDetailRecord[] = metrics.classBreakdown.map((c, idx) => ({
        detailRecordId: `DET_${sessionRecordId}_${idx + 1}`,
        sessionRecordId,
        sessionId,
        grade: c.grade,
        section: c.section,
        studentsPresent: c.studentsPresent,
        questionAScore5: c.questionACounts.score5,
        questionAScore4: c.questionACounts.score4,
        questionAScore3: c.questionACounts.score3,
        questionAScore2: c.questionACounts.score2,
        questionAScore1: c.questionACounts.score1,
        questionATotal: c.questionATotal,
        questionAWeightedScore: c.questionAWeighted,
        csat: c.csatAverage,
        questionBScore5: c.questionBCounts.score5,
        questionBScore4: c.questionBCounts.score4,
        questionBScore3: c.questionBCounts.score3,
        questionBScore2: c.questionBCounts.score2,
        questionBScore1: c.questionBCounts.score1,
        questionBTotal: c.questionBTotal,
        questionBWeightedScore: c.questionBWeighted,
        itp: c.itpAverage,
        createdAt: nowIso,
        updatedAt: nowIso,
      }));

      const newRecord: SessionRecord = {
        sessionRecordId,
        sessionId,
        clientSubmissionKey: values.clientSubmissionKey,
        facilitatorName: values.facilitatorName.trim(),
        facilitatorEmail: actor.email,
        facilitatorUserId: actor.userId,
        tourId: tour.tourId,
        tourName: tour.tourName,
        videoId: videoInfo.isConfigured ? videoInfo.videoId : 'UNCONFIGURED_VIDEO_ID',
        language: values.language,
        startDate: values.startDate,
        endDate: values.endDate,
        startTime: values.startTime,
        endTime: values.endTime,
        durationMinutes,
        durationFormatted: formatDurationHuman(durationMinutes),
        reportingMonth: getMonthNameFromISO(values.startDate),
        submissionTimestamp: nowIso,
        submissionDateFormatted: formatISODateToDDMMYYYY(todayKolkata),
        schoolName: values.schoolName,
        udiseCode: values.udiseCode,
        schoolType: values.schoolType,
        state: values.state,
        district: values.district,
        block: values.block,
        pinCode: values.pinCode,
        sessionType: values.sessionMode,
        totalClasses: metrics.totalClasses,
        totalStudentsPresent: metrics.totalStudentsPresent,
        totalQuestionAResponses: metrics.totalQuestionAResponses,
        totalQuestionBResponses: metrics.totalQuestionBResponses,
        overallCsat: metrics.overallCsat,
        overallItp: metrics.overallItp,
        teacherScore: metrics.teacherScoreExact,
        teacherClassification: metrics.teacherClassification!,
        teacherNps: metrics.teacherNps!,
        submissionStatus: 'PENDING',
        syncStatus: 'LOCAL_SANDBOX',
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: actor.email,
        updatedBy: actor.email,
        archived: false,
        details: [],
      };

      // Transaction-like PENDING write -> details write -> COMMITTED
      this.sessions.unshift(newRecord);
      if (this.simulatePartialFailureOnce) {
        this.simulatePartialFailureOnce = false;
        this.recordAudit(actor, 'CREATE_SESSION', 'Session', sessionRecordId, '', 'Simulated detail write crash (left PENDING)', 'FAILED');
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: values.clientSubmissionKey,
          sessionRecordId,
          sessionId,
          actorEmail: actor.email,
          operation: 'createSession',
          attempt: 1,
          status: 'FAILED',
          errorMessage: 'Simulated partial detail write failure.',
        });
        return {
          ok: false,
          code: 'PARTIAL_WRITE_DETECTED',
          error: 'Simulated failure writing class details. Record marked PENDING for safe recovery.',
        };
      }

      newRecord.details = detailRecords;
      newRecord.submissionStatus = 'COMMITTED';
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: values.clientSubmissionKey,
        sessionRecordId,
        sessionId,
        actorEmail: actor.email,
        operation: 'createSession',
        attempt: 1,
        status: 'LOCAL_SANDBOX',
        errorMessage: '',
      });

      // Upsert school master WITHOUT overwriting differing school names silently
      let schoolUdiseConflict: string | undefined;
      const existingSchool = this.schools.find((sc) => sc.udiseCode === values.udiseCode);
      if (!existingSchool) {
        this.schools.push({
          schoolRecordId: `SCH_${generateUuid().slice(0, 8).toUpperCase()}`,
          schoolName: values.schoolName,
          udiseCode: values.udiseCode,
          schoolType: values.schoolType,
          state: values.state,
          district: values.district,
          block: values.block,
          pinCode: values.pinCode,
          active: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      } else if (existingSchool.schoolName.toLowerCase() !== values.schoolName.toLowerCase()) {
        schoolUdiseConflict = `UDISE ${values.udiseCode} is already registered to "${existingSchool.schoolName}". School master record was preserved; admin review recommended.`;
      }

      this.recordAudit(
        actor,
        'CREATE_SESSION',
        'Session',
        sessionRecordId,
        '',
        `Session ${sessionId} (${values.district}/${values.block}, ${metrics.totalStudentsPresent} students)`,
        'SUCCESS',
      );

      return {
        ok: true,
        data: {
          session: structuredClone(newRecord),
          warnings: validation.warnings.map((w) => w.message),
          schoolUdiseConflict,
        },
      };
    });
  }

  async updateSession(
    sessionRecordId: string,
    rawValues: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[] }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };

      const target = this.sessions.find((s) => s.sessionRecordId === sessionRecordId);
      if (!target) {
        return { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' };
      }

      const isAdmin = actor.role === 'super_admin';
      if (!isAdmin && target.facilitatorEmail !== actor.email) {
        this.recordAudit(actor, 'UPDATE_SESSION', 'Session', sessionRecordId, '', 'Cross-user access blocked', 'DENIED');
        return {
          ok: false,
          code: 'FORBIDDEN',
          error: 'You are not authorized to edit another facilitator’s session.',
        };
      }

      const values: SessionFormValues = {
        ...rawValues,
        facilitatorEmail: target.facilitatorEmail,
        schoolName: rawValues.schoolName.trim(),
        udiseCode: rawValues.udiseCode.trim(),
        pinCode: rawValues.pinCode.trim(),
      };

      const validation = validateSessionForm(values, this.config);
      if (!validation.valid) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          error: validation.errors.map((e) => e.message).join(' '),
        };
      }

      const tour = this.config.tours.find((t) => t.tourId === values.tourId)!;
      const metrics = calculateSessionMetrics(
        values.classes,
        values.teacherNpsGroup,
        values.teacherExactScore,
      );
      const durationMinutes =
        calculateSessionDurationMinutes(
          values.startDate,
          values.startTime,
          values.endDate,
          values.endTime,
          this.config.programmeTimezone,
        ) ?? 0;

      const prevSummary = `CSAT=${target.overallCsat}, ITP=${target.overallItp}, Students=${target.totalStudentsPresent}`;
      const nowIso = new Date().toISOString();
      const videoInfo = resolveConfiguredVideoId(tour, values.language, this.config);

      // Preserve immutable sessionRecordId and original sessionId!
      target.facilitatorName = values.facilitatorName.trim();
      target.tourId = tour.tourId;
      target.tourName = tour.tourName;
      target.videoId = videoInfo.isConfigured ? videoInfo.videoId : 'UNCONFIGURED_VIDEO_ID';
      target.language = values.language;
      target.startDate = values.startDate;
      target.endDate = values.endDate;
      target.startTime = values.startTime;
      target.endTime = values.endTime;
      target.durationMinutes = durationMinutes;
      target.durationFormatted = formatDurationHuman(durationMinutes);
      target.reportingMonth = getMonthNameFromISO(values.startDate);
      target.schoolName = values.schoolName;
      target.udiseCode = values.udiseCode;
      target.schoolType = values.schoolType;
      target.district = values.district;
      target.block = values.block;
      target.pinCode = values.pinCode;
      target.sessionType = values.sessionMode;
      target.totalClasses = metrics.totalClasses;
      target.totalStudentsPresent = metrics.totalStudentsPresent;
      target.totalQuestionAResponses = metrics.totalQuestionAResponses;
      target.totalQuestionBResponses = metrics.totalQuestionBResponses;
      target.overallCsat = metrics.overallCsat;
      target.overallItp = metrics.overallItp;
      target.teacherScore = metrics.teacherScoreExact;
      target.teacherClassification = metrics.teacherClassification!;
      target.teacherNps = metrics.teacherNps!;
      target.submissionStatus = isAdmin ? 'CORRECTED' : 'COMMITTED';
      target.syncStatus = 'LOCAL_SANDBOX';
      target.updatedAt = nowIso;
      target.updatedBy = actor.email;
      target.details = metrics.classBreakdown.map((c, idx) => ({
        detailRecordId: `DET_${target.sessionRecordId}_${idx + 1}`,
        sessionRecordId: target.sessionRecordId,
        sessionId: target.sessionId,
        grade: c.grade,
        section: c.section,
        studentsPresent: c.studentsPresent,
        questionAScore5: c.questionACounts.score5,
        questionAScore4: c.questionACounts.score4,
        questionAScore3: c.questionACounts.score3,
        questionAScore2: c.questionACounts.score2,
        questionAScore1: c.questionACounts.score1,
        questionATotal: c.questionATotal,
        questionAWeightedScore: c.questionAWeighted,
        csat: c.csatAverage,
        questionBScore5: c.questionBCounts.score5,
        questionBScore4: c.questionBCounts.score4,
        questionBScore3: c.questionBCounts.score3,
        questionBScore2: c.questionBCounts.score2,
        questionBScore1: c.questionBCounts.score1,
        questionBTotal: c.questionBTotal,
        questionBWeightedScore: c.questionBWeighted,
        itp: c.itpAverage,
        createdAt: target.createdAt,
        updatedAt: nowIso,
      }));

      this.recordAudit(
        actor,
        isAdmin ? 'ADMIN_CORRECT_SESSION' : 'UPDATE_SESSION',
        'Session',
        target.sessionRecordId,
        prevSummary,
        `CSAT=${target.overallCsat}, ITP=${target.overallItp}, Students=${target.totalStudentsPresent}`,
        'SUCCESS',
      );
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: values.clientSubmissionKey || target.clientSubmissionKey,
        sessionRecordId: target.sessionRecordId,
        sessionId: target.sessionId,
        actorEmail: actor.email,
        operation: 'updateSession',
        attempt: 1,
        status: 'LOCAL_SANDBOX',
        errorMessage: '',
      });

      return {
        ok: true,
        data: {
          session: structuredClone(target),
          warnings: validation.warnings.map((w) => w.message),
        },
      };
    });
  }

  async archiveSession(sessionRecordId: string): Promise<ApiResponse<{ archived: boolean }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
      const target = this.sessions.find((s) => s.sessionRecordId === sessionRecordId);
      if (!target) return { ok: false, code: 'NOT_FOUND', error: 'Session not found.' };

      const isAdmin = actor.role === 'super_admin';
      if (!isAdmin) {
        if (target.facilitatorEmail !== actor.email) {
          this.recordAudit(actor, 'ARCHIVE_SESSION', 'Session', sessionRecordId, '', 'Cross-user archive blocked', 'DENIED');
          return { ok: false, code: 'FORBIDDEN', error: 'Cannot archive another facilitator’s session.' };
        }
        if (!this.config.policy.allowFacilitatorDeleteOwn) {
          return { ok: false, code: 'POLICY_RESTRICTED', error: 'Facilitator deletion is disabled by administrator policy.' };
        }
      }

      target.archived = true;
      target.updatedAt = new Date().toISOString();
      target.updatedBy = actor.email;
      this.recordAudit(actor, 'ARCHIVE_SESSION', 'Session', sessionRecordId, 'archived=false', 'archived=true', 'SUCCESS');
      return { ok: true, data: { archived: true } };
    });
  }

  async getSessionById(sessionRecordId: string): Promise<ApiResponse<SessionRecord>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    const found = this.sessions.find((s) => s.sessionRecordId === sessionRecordId);
    if (!found) return { ok: false, code: 'NOT_FOUND', error: 'Session not found.' };

    const isAdmin = actor.role === 'super_admin';
    if (!isAdmin && found.facilitatorEmail !== actor.email) {
      this.recordAudit(actor, 'VIEW_SESSION', 'Session', sessionRecordId, '', 'Unauthorized read blocked', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Access denied.' };
    }
    return { ok: true, data: structuredClone(found) };
  }

  private applyFilters(rows: SessionRecord[], filters: SessionQueryFilters): SessionRecord[] {
    return filterSessionRecords(rows, filters, this.config).included;
  }

  private paginate<T>(items: T[], page = 1, pageSize = 15): PaginatedResult<T> {
    const safeSize = Math.max(1, Math.min(pageSize, 100));
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / safeSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * safeSize;
    return {
      items: structuredClone(items.slice(start, start + safeSize)),
      total,
      page: safePage,
      pageSize: safeSize,
      totalPages,
    };
  }

  async getMySessions(filters: SessionQueryFilters): Promise<ApiResponse<PaginatedResult<SessionRecord>>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    const ownOnly = this.sessions.filter((s) => s.facilitatorEmail === actor.email);
    const filtered = this.applyFilters(ownOnly, filters);
    return { ok: true, data: this.paginate(filtered, filters.page, filters.pageSize) };
  }

  async getAdminSessions(filters: SessionQueryFilters): Promise<ApiResponse<PaginatedResult<SessionRecord>>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'ADMIN_LIST_SESSIONS', 'Session', 'ALL', '', 'Unauthorized admin query', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    const filtered = this.applyFilters(this.sessions, filters);
    return { ok: true, data: this.paginate(filtered, filters.page, filters.pageSize) };
  }

  async getDashboardSummary(filters: SessionQueryFilters): Promise<ApiResponse<DashboardAnalytics>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'VIEW_DASHBOARD', 'Analytics', 'SUMMARY', '', 'Unauthorized dashboard query', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }

    return {
      ok: true,
      data: computeDashboardAnalytics(this.sessions, filters, this.config),
    };
  }

  async getSchoolByUdise(udiseCode: string): Promise<ApiResponse<SchoolRecord | null>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    const found = this.schools.find((s) => s.udiseCode === udiseCode.trim()) ?? null;
    return { ok: true, data: found ? structuredClone(found) : null };
  }

  async searchSchools(query: string): Promise<ApiResponse<SchoolRecord[]>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'SEARCH_SCHOOLS', 'School', 'DIRECTORY', '', 'Unauthorized school directory query', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    const q = query.trim().toLowerCase();
    const matches = this.schools.filter(
      (s) => s.schoolName.toLowerCase().includes(q) || s.udiseCode.includes(q),
    );
    return { ok: true, data: structuredClone(matches.slice(0, 20)) };
  }

  async listManagedUsers(): Promise<ApiResponse<ManagedUser[]>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'LIST_USERS', 'User', 'ALL', '', 'Unauthorized user directory access', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    const filtered = this.users.filter(
      (u) => (isAllowlistedSuperAdmin(u.email) && u.role === 'super_admin') || !isAllowlistedSuperAdmin(u.email),
    );
    return { ok: true, data: structuredClone(filtered) };
  }

  async manageUser(input: {
    userId?: string;
    name: string;
    email: string;
    role: UserRole;
    active: boolean;
    status?: UserApprovalStatus;
  }): Promise<ApiResponse<ManagedUser>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'MANAGE_USER', 'User', input.email, '', 'Unauthorized user mutation', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }

    const emailClean = normalizeEmail(input.email);
    if (!emailClean || !input.name.trim()) {
      return { ok: false, code: 'INVALID_USER', error: 'Name and email are required.' };
    }

    if (isAllowlistedSuperAdmin(emailClean)) {
      this.recordAudit(
        actor,
        'MANAGE_USER',
        'User',
        emailClean,
        '',
        'Protected Super Admin account cannot be modified',
        'DENIED',
      );
      return {
        ok: false,
        code: 'PROTECTED_ACCOUNT',
        error: 'Initial Super Administrator accounts are protected by server policy and cannot be modified or deactivated.',
      };
    }

    if ((input.role as string) === 'admin' || input.role === 'super_admin') {
      this.recordAudit(actor, 'MANAGE_USER', 'User', emailClean, '', 'Blocked administrator role elevation', 'DENIED');
      return {
        ok: false,
        code: 'FORBIDDEN',
        error: 'Administrator privileges are restricted exclusively to the two approved Super Administrator accounts.',
      };
    }

    if (input.role !== 'facilitator') {
      return { ok: false, code: 'INVALID_ROLE', error: 'Invalid user role.' };
    }

    const nextStatus: UserApprovalStatus =
      input.status === 'APPROVED' || input.status === 'PENDING' || input.status === 'DENIED'
        ? input.status
        : input.active
        ? 'APPROVED'
        : 'DENIED';
    const nextActive = nextStatus === 'APPROVED';

    const now = new Date().toISOString();
    const existing = this.users.find((u) => u.userId === input.userId || normalizeEmail(u.email) === emailClean);
    if (existing) {
      const prev = `${existing.role} (status=${existing.status}, active=${existing.active})`;
      existing.name = input.name.trim();
      existing.email = emailClean;
      existing.role = 'facilitator';
      existing.status = nextStatus;
      existing.active = nextActive;
      existing.updatedAt = now;
      this.recordAudit(
        actor,
        'UPDATE_USER',
        'User',
        existing.userId,
        prev,
        `facilitator (status=${existing.status}, active=${existing.active})`,
        'SUCCESS',
      );
      return { ok: true, data: structuredClone(existing) };
    }

    const created: ManagedUser = {
      userId: `FAC_${generateUuid().slice(0, 8).toUpperCase()}`,
      name: input.name.trim(),
      email: emailClean,
      role: 'facilitator',
      active: nextActive,
      status: nextStatus,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(created);
    this.recordAudit(
      actor,
      'CREATE_USER',
      'User',
      created.userId,
      '',
      `${created.email} (facilitator, status=${created.status})`,
      'SUCCESS',
    );
    return { ok: true, data: structuredClone(created) };
  }

  async getAuditLogs(page = 1, pageSize = 25): Promise<ApiResponse<PaginatedResult<AuditLogEntry>>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'VIEW_AUDIT_LOG', 'Audit', 'ALL', '', 'Unauthorized audit access', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    return { ok: true, data: this.paginate(this.auditLogs, page, pageSize) };
  }

  async getSyncLogs(page = 1, pageSize = 25): Promise<ApiResponse<PaginatedResult<SyncLogEntry>>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'VIEW_SYNC_LOG', 'SyncLog', 'ALL', '', 'Unauthorized sync log access', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    return { ok: true, data: this.paginate(this.syncLogs, page, pageSize) };
  }

  async logExportEvent(scope: string, rowCount: number, format: string): Promise<ApiResponse<{ logged: boolean }>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'EXPORT_XLSX', 'Export', scope, '', 'Unauthorized export attempt', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required for exports.' };
    }
    this.recordAudit(actor, 'EXPORT_XLSX', 'Export', scope, '', `${rowCount} rows (${format})`, 'SUCCESS');
    return { ok: true, data: { logged: true } };
  }

  getSheetsOAuthStartUrl(loginHint?: string): string | null {
    if (!this.sheetsBackendUrl) return null;
    const base = this.sheetsBackendUrl.replace(/\/$/, '');
    const q = new URLSearchParams({ action: 'oauthStart' });
    if (loginHint) q.set('login_hint', loginHint);
    return `${base}?${q.toString()}`;
  }

  async getSheetsConnection(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'VIEW_SHEETS_CONN', 'Configuration', 'SHEETS', '', 'Unauthorized sheets connection read', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    const localConn = structuredClone(this.loadPersistedSheetsConnection());
    if (this.sheetsBackendUrl) {
      try {
        const res = await fetch(`${this.sheetsBackendUrl.replace(/\/$/, '')}?action=status`, {
          credentials: 'include',
        });
        if (res.ok) {
          const parsed = (await res.json()) as ApiResponse<GoogleSheetsConnectionState>;
          if (parsed.ok && parsed.data) {
            if (parsed.data.connected) {
              return parsed;
            }
            return {
              ok: true,
              data: {
                ...localConn,
                oauthConfigured: parsed.data.oauthConfigured,
                connectedAccount:
                  localConn.connectedAccount || parsed.data.connectedAccount || '',
              },
            };
          }
        }
      } catch {
        // Fallback to local sandbox connection state cleanly
      }
    }
    return { ok: true, data: localConn };
  }

  async listGoogleSpreadsheets(): Promise<ApiResponse<GoogleSpreadsheetSummary[]>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.sheetsBackendUrl) {
      try {
        const res = await fetch(this.sheetsBackendUrl.replace(/\/$/, ''), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'listSpreadsheets' }),
        });
        const parsed = (await res.json()) as ApiResponse<GoogleSpreadsheetSummary[]>;
        if (parsed.ok && parsed.data) {
          return parsed;
        }
      } catch {
        // Ignore and fallback below
      }
    }
    const items: GoogleSpreadsheetSummary[] = [
      {
        spreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        name: 'Vidhya Vidhai · Career Tours Sheet (Target)',
        url: DEFAULT_TARGET_SPREADSHEET_URL,
      },
    ];
    const current = this.loadPersistedSheetsConnection();
    if (current.connected && current.spreadsheetId && current.spreadsheetId !== DEFAULT_TARGET_SPREADSHEET_ID) {
      items.unshift({
        spreadsheetId: current.spreadsheetId,
        name: current.spreadsheetName,
        url: current.spreadsheetUrl,
      });
    }
    return { ok: true, data: items };
  }

  async connectGoogleSheet(params: {
    spreadsheetUrlOrId: string;
    spreadsheetName?: string;
    initializeSchema?: boolean;
    googleAccount?: string;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        this.recordAudit(actor, 'CONNECT_GOOGLE_SHEET', 'Configuration', 'SHEETS', '', 'Unauthorized connection attempt', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      if (this.sheetsBackendUrl) {
        try {
          const res = await fetch(this.sheetsBackendUrl.replace(/\/$/, ''), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'connect', ...params }),
          });
          const parsed = (await res.json()) as ApiResponse<GoogleSheetsConnectionState>;
          if (parsed.ok && parsed.data) {
            return parsed;
          }
          if (parsed.code !== 'OAUTH_REQUIRED' && parsed.code !== 'SERVER_MISCONFIGURED') {
            return parsed;
          }
        } catch {
          // Fall through cleanly to local sandbox connection
        }
      }

      const spreadsheetId = parseGoogleSpreadsheetId(
        params.spreadsheetUrlOrId || DEFAULT_TARGET_SPREADSHEET_ID,
      );
      if (!spreadsheetId) {
        return {
          ok: false,
          code: 'INVALID_SPREADSHEET_ID',
          error: 'Please enter a valid Google Spreadsheet URL or Spreadsheet ID.',
        };
      }

      const nowIso = new Date().toISOString();
      const account = (params.googleAccount || actor.email).trim().toLowerCase();
      const name =
        (params.spreadsheetName || '').trim() ||
        (spreadsheetId === DEFAULT_TARGET_SPREADSHEET_ID
          ? 'Vidhya Vidhai · Career Tours Database'
          : `Career Tours Sheet (${spreadsheetId.slice(0, 8)}…)`);

      const nextState: GoogleSheetsConnectionState = {
        connected: true,
        authMethod: 'local_sandbox',
        oauthConfigured: Boolean(this.sheetsBackendUrl),
        connectedAccount: account,
        spreadsheetId,
        spreadsheetName: name,
        spreadsheetUrl:
          spreadsheetId === DEFAULT_TARGET_SPREADSHEET_ID
            ? DEFAULT_TARGET_SPREADSHEET_URL
            : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        connectedAt: nowIso,
        connectedBy: actor.email,
        lastSyncedAt: nowIso,
        lastSyncStatus: 'SYNCED',
        lastSyncMessage: `${this.sessions.length} session(s) staged · 8 schema tabs ready`,
        initializedTabs: [...DEFAULT_SCHEMA_TABS],
        defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
      };
      this.syncedSessionKeys.clear();
      for (const s of this.sessions) {
        this.syncedSessionKeys.add(s.sessionRecordId);
      }

      this.savePersistedSheetsConnection(nextState);
      this.recordAudit(
        actor,
        'CONNECT_GOOGLE_SHEET',
        'Configuration',
        spreadsheetId,
        '',
        `Connected "${name}" as ${account}`,
        'SUCCESS',
      );
      return { ok: true, data: structuredClone(nextState) };
    });
  }

  async createGoogleSheet(params: {
    title: string;
    googleAccount?: string;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        this.recordAudit(actor, 'CREATE_GOOGLE_SHEET', 'Configuration', 'SHEETS', '', 'Unauthorized sheet creation', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      const cleanTitle = params.title.trim();
      if (!cleanTitle) {
        return { ok: false, code: 'INVALID_TITLE', error: 'Spreadsheet name is required.' };
      }

      if (this.sheetsBackendUrl) {
        try {
          const res = await fetch(this.sheetsBackendUrl.replace(/\/$/, ''), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create', title: cleanTitle }),
          });
          const parsed = (await res.json()) as ApiResponse<GoogleSheetsConnectionState>;
          if (parsed.ok && parsed.data) {
            return parsed;
          }
          if (parsed.code !== 'OAUTH_REQUIRED' && parsed.code !== 'SERVER_MISCONFIGURED') {
            return parsed;
          }
        } catch {
          // Fall through cleanly
        }
      }

      const newId = `SANDBOX_SHEET_${generateUuid().slice(0, 12)}`;
      const nowIso = new Date().toISOString();
      const account = (params.googleAccount || actor.email).trim().toLowerCase();
      const nextState: GoogleSheetsConnectionState = {
        connected: true,
        authMethod: 'local_sandbox',
        oauthConfigured: Boolean(this.sheetsBackendUrl),
        connectedAccount: account,
        spreadsheetId: newId,
        spreadsheetName: cleanTitle,
        spreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
        connectedAt: nowIso,
        connectedBy: actor.email,
        lastSyncedAt: nowIso,
        lastSyncStatus: 'SYNCED',
        lastSyncMessage: `Created "${cleanTitle}" schema (${DEFAULT_SCHEMA_TABS.length} tabs)`,
        initializedTabs: [...DEFAULT_SCHEMA_TABS],
        defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
      };
      this.savePersistedSheetsConnection(nextState);
      this.recordAudit(
        actor,
        'CREATE_GOOGLE_SHEET',
        'Configuration',
        newId,
        '',
        `Created "${cleanTitle}" (${account})`,
        'SUCCESS',
      );
      return { ok: true, data: structuredClone(nextState) };
    });
  }

  async disconnectGoogleSheet(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        this.recordAudit(actor, 'DISCONNECT_GOOGLE_SHEET', 'Configuration', 'SHEETS', '', 'Unauthorized disconnect attempt', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      if (this.sheetsBackendUrl) {
        await fetch(this.sheetsBackendUrl.replace(/\/$/, ''), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect' }),
        }).catch(() => undefined);
      }

      const prev = this.loadPersistedSheetsConnection();
      const next = buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
      this.savePersistedSheetsConnection(next);
      this.recordAudit(
        actor,
        'DISCONNECT_GOOGLE_SHEET',
        'Configuration',
        prev.spreadsheetId || 'NONE',
        prev.spreadsheetName,
        'Disconnected spreadsheet link non-destructively',
        'SUCCESS',
      );
      return { ok: true, data: structuredClone(next) };
    });
  }

  async syncAllToGoogleSheet(): Promise<ApiResponse<SheetsSyncSummary>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      if (this.sheetsBackendUrl) {
        try {
          const statusRes = await fetch(
            `${this.sheetsBackendUrl.replace(/\/$/, '')}?action=status`,
            { credentials: 'include' },
          );
          const statusJson = (await statusRes.json()) as ApiResponse<GoogleSheetsConnectionState>;
          if (statusJson.ok && statusJson.data?.oauthConfigured && statusJson.data.connected) {
            const syncRes = await fetch(this.sheetsBackendUrl.replace(/\/$/, ''), {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'sync', sessions: this.sessions }),
            });
            const syncJson = (await syncRes.json()) as ApiResponse<SheetsSyncSummary>;
            if (syncJson.ok || (syncJson.code !== 'OAUTH_REQUIRED' && syncJson.code !== 'SERVER_MISCONFIGURED')) {
              return syncJson;
            }
          }
        } catch {
          // Fall through cleanly to local sandbox sync
        }
      }

      const conn = this.loadPersistedSheetsConnection();
      if (!conn.connected || !conn.spreadsheetId) {
        return {
          ok: false,
          code: 'NOT_CONNECTED',
          error: 'Connect a Google Sheet before syncing programme data.',
        };
      }

      let syncedCount = 0;
      let skippedDuplicates = 0;
      for (const s of this.sessions) {
        if (this.syncedSessionKeys.has(s.sessionRecordId)) {
          skippedDuplicates++;
        } else {
          this.syncedSessionKeys.add(s.sessionRecordId);
          syncedCount++;
        }
      }
      const nowIso = new Date().toISOString();
      const message =
        syncedCount > 0
          ? `Synced ${syncedCount} session(s); skipped ${skippedDuplicates} existing duplicate(s).`
          : `Verified ${this.sessions.length} session(s) up to date (0 duplicates written).`;

      const updatedConn: GoogleSheetsConnectionState = {
        ...conn,
        lastSyncedAt: nowIso,
        lastSyncStatus: 'SYNCED',
        lastSyncMessage: message,
      };
      this.savePersistedSheetsConnection(updatedConn);
      this.recordAudit(actor, 'SYNC_GOOGLE_SHEET', 'Configuration', conn.spreadsheetId, '', message, 'SUCCESS');
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: 'BULK_SYNC',
        sessionRecordId: conn.spreadsheetId,
        sessionId: 'ALL',
        actorEmail: actor.email,
        operation: 'syncAllToGoogleSheet',
        attempt: 1,
        status: 'LOCAL_SANDBOX',
        errorMessage: '',
      });

      return {
        ok: true,
        data: {
          syncedCount,
          skippedDuplicates,
          totalSheetSessions: this.sessions.length,
          syncedAt: nowIso,
          message,
        },
      };
    });
  }
}

export function createApiClient(
  getIdToken: () => string | undefined,
  getSandboxActorId: () => string,
): BackendApiClient {
  const env = getAuthEnvironment();
  if (env.isLiveBackendConfigured) {
    return new AppsScriptApiClient(env.appsScriptUrl, getIdToken, env.sheetsBackendUrl);
  }
  return new LocalSandboxApiClient(getSandboxActorId, undefined, env.sheetsBackendUrl);
}
