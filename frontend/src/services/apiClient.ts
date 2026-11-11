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
  BulkProvisionFacilitatorsResult,
  DashboardAnalytics,
  DatabaseBackupPackage,
  DatabaseHealthReport,
  GoogleSheetsConnectionState,
  GoogleSpreadsheetSummary,
  ImportSessionsResult,
  ManagedUser,
  PaginatedResult,
  ProvisionFacilitatorResult,
  SchoolRecord,
  SessionDetailRecord,
  SessionFormValues,
  SessionQueryFilters,
  SessionRecord,
  SessionTransferPackage,
  SheetsSyncSummary,
  SyncLogEntry,
  TeamIntakeSetupResponse,
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
import {
  type AppsScriptBridgeConfig,
  SANDBOX_DENIED_USER,
  SANDBOX_USERS_LIST,
  clearCachedSheetsConnection,
  getAuthEnvironment,
  isJwtTokenUsable,
  loadAppsScriptBridgeConfig,
  loadCachedSheetsConnection,
  loadDirectGoogleClientId,
  loadTeamIntakeConfig,
  saveAppsScriptBridgeConfig,
  saveCachedSheetsConnection,
  saveDirectGoogleClientId,
  validateAppsScriptSyncKey,
  validateAppsScriptWebAppUrl,
  validateFacilitatorIntakeKey,
  validateGoogleOAuthClientId,
} from './authService';
import {
  buildDatabaseBackupPackage,
  buildFacilitatorTransferPackage,
  normalizeImportSessionsResult,
  parseSessionTransferOrBackupPayload,
  safeWriteMirroredLocalStorage,
} from './durableStorage';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { SupabaseApiClient } from './supabaseApiClient';
import {
  clearDirectGoogleSheetsToken,
  connectDirectGoogleSheet,
  createDirectGoogleSheetWithSchema,
  createDirectSession,
  deleteDirectSchool,
  deleteDirectSessions,
  deleteDirectUser,
  getDirectGoogleSheetsTokenInfo,
  hasDirectSheetsAccessToken,
  listDirectGoogleSpreadsheets,
  loadDirectWorkspace,
  logDirectExportEvent,
  manageDirectUser,
  requestDirectGoogleSheetsToken,
  saveDirectConfiguration,
  setDirectSessionArchived,
  syncWorkspaceToDirectGoogleSheet,
  updateDirectSchool,
  updateDirectSession,
} from './googleSheetsDirectService';
import {
  mintActiveSandboxSessionProof,
  updateSuperAdminPassword,
  verifyActiveSandboxSessionProof,
  verifySuperAdminPassword,
} from './passwordAuthService';
import { loadSyncOutbox } from './syncService';

export interface CreateApiClientOptions {
  refreshIdToken?: (force?: boolean) => Promise<string | undefined>;
  onSessionExpired?: (reason?: string) => void;
}

export interface LocalSandboxClientOptions {
  persistWorkspace?: boolean;
  workspaceStorageKey?: string;
}

export const WORKSPACE_STORAGE_KEY = 'ct_workspace_store_v1';

export interface BackendHealthInfo {
  mode: 'apps_script' | 'local_sandbox' | 'supabase';
  connectedToGoogleSheets: boolean;
  status: 'READY' | 'LOCAL_SANDBOX' | 'SUPABASE_READY';
  checkedAt: string;
  endpointConfigured: boolean;
  databaseProvider?: string;
}

export interface BackendApiClient {
  mode: 'apps_script' | 'local_sandbox' | 'supabase';
  pingHealth(): Promise<ApiResponse<BackendHealthInfo>>;
  getCurrentUser(): Promise<ApiResponse<UserProfile>>;
  getAppConfiguration(): Promise<ApiResponse<AppConfiguration>>;
  saveAppConfiguration(config: Partial<AppConfiguration>): Promise<ApiResponse<AppConfiguration>>;
  createSession(
    values: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[]; schoolUdiseConflict?: string }>>;
  updateSession(
    sessionRecordId: string,
    values: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[] }>>;
  archiveSession(sessionRecordId: string): Promise<ApiResponse<{ archived: boolean }>>;
  restoreSession(sessionRecordId: string): Promise<ApiResponse<{ archived: boolean }>>;
  deleteSession(
    sessionRecordId: string,
  ): Promise<ApiResponse<{ deleted: boolean; deletedDetailsCount: number }>>;
  bulkDeleteSessions(
    sessionRecordIds: string[],
  ): Promise<ApiResponse<{ deletedCount: number; deletedDetailsCount: number }>>;
  getSessionById(sessionRecordId: string): Promise<ApiResponse<SessionRecord>>;
  getMySessions(filters: SessionQueryFilters): Promise<ApiResponse<PaginatedResult<SessionRecord>>>;
  getAdminSessions(filters: SessionQueryFilters): Promise<ApiResponse<PaginatedResult<SessionRecord>>>;
  getDashboardSummary(filters: SessionQueryFilters): Promise<ApiResponse<DashboardAnalytics>>;
  getSchoolByUdise(udiseCode: string): Promise<ApiResponse<SchoolRecord | null>>;
  searchSchools(query: string, includeInactive?: boolean): Promise<ApiResponse<SchoolRecord[]>>;
  updateSchool(school: {
    schoolRecordId: string;
    schoolName: string;
    udiseCode: string;
    schoolType: string;
    state?: string;
    district: string;
    pinCode: string;
    active: boolean;
  }): Promise<ApiResponse<SchoolRecord>>;
  deleteSchool(
    schoolRecordId: string,
  ): Promise<ApiResponse<{ deleted: boolean; udiseCode: string }>>;
  listManagedUsers(): Promise<ApiResponse<ManagedUser[]>>;
  manageUser(user: {
    userId?: string;
    name: string;
    email: string;
    role: UserRole;
    active: boolean;
    status?: UserApprovalStatus;
  }): Promise<ApiResponse<ManagedUser>>;
  deleteUser(userIdOrEmail: string): Promise<ApiResponse<{ deleted: boolean; email: string }>>;
  provisionFacilitatorAccount?(input: {
    name?: string;
    email: string;
    password: string;
    status?: 'APPROVED' | 'DENIED';
  }): Promise<ApiResponse<ProvisionFacilitatorResult>>;
  bulkProvisionFacilitators?(input: {
    users: Array<{ name?: string; email: string }>;
    sharedPassword: string;
  }): Promise<ApiResponse<BulkProvisionFacilitatorsResult>>;
  confirmFacilitatorEmail?(email: string): Promise<ApiResponse<{ user: ManagedUser }>>;
  authenticateSandboxEmail?(
    email: string,
    name?: string,
    options?: { password?: string; resumeToken?: string },
  ): Promise<ApiResponse<UserProfile>>;
  changeSuperAdminPassword?(
    currentPassword: string,
    newPassword: string,
  ): Promise<ApiResponse<{ updated: boolean; updatedAt: string }>>;
  getAuditLogs(page?: number, pageSize?: number): Promise<ApiResponse<PaginatedResult<AuditLogEntry>>>;
  getSyncLogs(page?: number, pageSize?: number): Promise<ApiResponse<PaginatedResult<SyncLogEntry>>>;
  logExportEvent(scope: string, rowCount: number, format: string): Promise<ApiResponse<{ logged: boolean }>>;
  getSheetsConnection(): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  listGoogleSpreadsheets(): Promise<ApiResponse<GoogleSpreadsheetSummary[]>>;
  getWorkspaceSyncPreview?(): Promise<
    ApiResponse<{
      sessionsCount: number;
      unsyncedSessionsCount: number;
      schoolsCount: number;
      facilitatorsCount: number;
      districts: string[];
    }>
  >;
  connectGoogleSheet(params: {
    spreadsheetUrlOrId: string;
    spreadsheetName?: string;
    initializeSchema?: boolean;
    googleAccount?: string;
    directClientId?: string;
    forceDirectOAuth?: boolean;
    appsScriptUrl?: string;
    syncKey?: string;
    forceAppsScriptBridge?: boolean;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  createGoogleSheet(params: {
    title: string;
    googleAccount?: string;
    directClientId?: string;
    forceDirectOAuth?: boolean;
    appsScriptUrl?: string;
    syncKey?: string;
    forceAppsScriptBridge?: boolean;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  disconnectGoogleSheet(): Promise<ApiResponse<GoogleSheetsConnectionState>>;
  syncAllToGoogleSheet(opts?: {
    directClientId?: string;
    forceDirectOAuth?: boolean;
    appsScriptUrl?: string;
    syncKey?: string;
    forceAppsScriptBridge?: boolean;
  }): Promise<ApiResponse<SheetsSyncSummary>>;
  connectAppsScriptBridge?(params: {
    appsScriptUrl: string;
    syncKey: string;
    targetMode: 'auto' | 'create' | 'existing';
    sheetTitle?: string;
    spreadsheetUrlOrId?: string;
    initializeSchema?: boolean;
  }): Promise<
    ApiResponse<{
      connection: GoogleSheetsConnectionState;
      syncSummary: SheetsSyncSummary | null;
    }>
  >;
  getSheetsOAuthStartUrl?(loginHint?: string): string | null;
  invalidateWorkspaceCache?(): void;
  reloadPersistedWorkspace?(): void;
  setSheetsBackendUrl?(nextUrl: string): void;
  getTeamIntakeSetup?(): Promise<ApiResponse<TeamIntakeSetupResponse>>;
  rotateTeamIntakeKey?(): Promise<ApiResponse<TeamIntakeSetupResponse>>;
  getDatabaseHealth?(): Promise<ApiResponse<DatabaseHealthReport>>;
  recoverDatabaseHealth?(): Promise<ApiResponse<DatabaseHealthReport>>;
  exportFacilitatorTransferPackage?(): Promise<ApiResponse<SessionTransferPackage>>;
  exportDatabaseBackupPackage?(): Promise<ApiResponse<DatabaseBackupPackage>>;
  importSessionsPackage?(rawPayload: unknown): Promise<ApiResponse<ImportSessionsResult>>;
  testSheetsWebhook?(
    appsScriptUrl: string,
    spreadsheetId?: string,
  ): Promise<ApiResponse<{ reachable: boolean; status: number; message: string }>>;
}

export {
  buildDatabaseBackupPackage,
  buildFacilitatorTransferPackage,
  parseSessionTransferOrBackupPayload,
};

function sessionRecordToFormValuesForImport(raw: Record<string, unknown>): SessionFormValues {
  const detailsRaw = Array.isArray(raw.details) ? raw.details : [];
  const classes = detailsRaw.map((d, idx) => {
    const det = (d || {}) as Record<string, unknown>;
    return {
      rowId: typeof det.detailRecordId === 'string' && det.detailRecordId ? det.detailRecordId : `imp_${idx + 1}`,
      grade: String(det.grade ?? '').trim(),
      section: String(det.section ?? '').trim(),
      studentsPresent: String(det.studentsPresent ?? ''),
      questionA: {
        score5: String(det.questionAScore5 ?? 0),
        score4: String(det.questionAScore4 ?? 0),
        score3: String(det.questionAScore3 ?? 0),
        score2: String(det.questionAScore2 ?? 0),
        score1: String(det.questionAScore1 ?? 0),
      },
      questionB: {
        score5: String(det.questionBScore5 ?? 0),
        score4: String(det.questionBScore4 ?? 0),
        score3: String(det.questionBScore3 ?? 0),
        score2: String(det.questionBScore2 ?? 0),
        score1: String(det.questionBScore1 ?? 0),
      },
    };
  });

  const teacherScoreNum =
    raw.teacherScore !== null && raw.teacherScore !== undefined && raw.teacherScore !== ''
      ? Number(raw.teacherScore)
      : null;
  let npsGroup: SessionFormValues['teacherNpsGroup'] = '';
  const clsStr = String(raw.teacherClassification ?? '').toLowerCase();
  if (clsStr === 'promoter') npsGroup = 'promoter';
  else if (clsStr === 'passive') npsGroup = 'passive';
  else if (clsStr === 'detractor') npsGroup = 'detractor';
  else if (teacherScoreNum !== null && Number.isFinite(teacherScoreNum)) {
    npsGroup = teacherScoreNum >= 9 ? 'promoter' : teacherScoreNum >= 7 ? 'passive' : 'detractor';
  }

  return {
    clientSubmissionKey: String(raw.clientSubmissionKey ?? '').trim() || `imp-${generateUuid()}`,
    facilitatorName: String(raw.facilitatorName ?? '').trim(),
    facilitatorEmail: normalizeEmail(String(raw.facilitatorEmail ?? '')),
    tourId: String(raw.tourId ?? '').trim(),
    language: String(raw.language ?? '').trim(),
    startDate: String(raw.startDate ?? '').trim(),
    endDate: String(raw.endDate ?? '').trim() || String(raw.startDate ?? '').trim(),
    startTime: String(raw.startTime ?? '').trim(),
    endTime: String(raw.endTime ?? '').trim(),
    schoolName: String(raw.schoolName ?? '').trim(),
    udiseCode: String(raw.udiseCode ?? '').trim(),
    schoolType: String(raw.schoolType ?? '').trim(),
    state: String(raw.state ?? 'Tamil Nadu').trim(),
    district: String(raw.district ?? '').trim(),
    pinCode: String(raw.pinCode ?? '').trim(),
    sessionMode: String(raw.sessionType ?? raw.sessionMode ?? '') === 'combined' ? 'combined' : 'single',
    classes,
    teacherNpsGroup: npsGroup,
    teacherExactScore:
      teacherScoreNum !== null && Number.isFinite(teacherScoreNum) ? String(teacherScoreNum) : '',
  };
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

export class AppsScriptApiClient implements BackendApiClient {
  mode = 'apps_script' as const;
  private url: string;
  private sheetsBackendUrl: string;
  private getIdToken: () => string | undefined;
  private options?: CreateApiClientOptions;

  constructor(
    url: string,
    getIdToken: () => string | undefined,
    sheetsBackendUrl = '',
    options?: CreateApiClientOptions,
  ) {
    this.url = url;
    this.getIdToken = getIdToken;
    this.sheetsBackendUrl = sheetsBackendUrl;
    this.options = options;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableHttpStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async fetchJsonSafe<T>(
    targetUrl: string,
    init: RequestInit,
    timeoutMs = 25000,
  ): Promise<{
    status: number;
    ok: boolean;
    parsed: T | null;
    isHtml: boolean;
    rawText: string;
  }> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(targetUrl, {
        ...init,
        signal: controller?.signal,
      });
      const rawText = await res.text();
      const trimmed = rawText.trim();
      const isHtml = trimmed.startsWith('<');
      let parsed: T | null = null;
      if (!isHtml && trimmed) {
        try {
          parsed = JSON.parse(trimmed) as T;
        } catch {
          parsed = null;
        }
      }
      return {
        status: res.status,
        ok: res.ok,
        parsed,
        isHtml,
        rawText,
      };
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  async pingHealth(): Promise<ApiResponse<BackendHealthInfo>> {
    try {
      const result = await this.fetchJsonSafe<{ ok?: boolean; status?: string }>(
        this.url,
        { method: 'GET' },
        15000,
      );
      if (!result.ok || !result.parsed) {
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          error: `Google Apps Script health check returned HTTP ${result.status}.`,
        };
      }
      return {
        ok: Boolean(result.parsed.ok),
        data: {
          mode: 'apps_script',
          connectedToGoogleSheets: Boolean(result.parsed.ok),
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
    let idToken = this.getIdToken();
    if (!idToken || (idToken.includes('.') && !isJwtTokenUsable(idToken, 45))) {
      if (this.options?.refreshIdToken) {
        const refreshed = await this.options.refreshIdToken(false);
        if (refreshed) {
          idToken = refreshed;
        }
      }
    }
    if (!idToken) {
      return { ok: false, code: 'UNAUTHENTICATED', error: 'Please sign in with Google first.' };
    }

    const backoffMs = [0, 250, 650];
    let lastError = 'Network request failed.';
    let lastCode = 'NETWORK_ERROR';
    let retriedAuth = false;
    let skipBackoffOnce = false;

    for (let attempt = 0; attempt < backoffMs.length; attempt++) {
      if (!skipBackoffOnce) {
        await this.sleep(backoffMs[attempt] ?? 0);
      }
      skipBackoffOnce = false;

      try {
        // Content-Type: text/plain avoids CORS preflight OPTIONS failure on Google Apps Script Web Apps
        const result = await this.fetchJsonSafe<ApiResponse<T>>(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action, idToken, payload }),
        });

        if (result.isHtml || !result.parsed || typeof result.parsed.ok !== 'boolean') {
          lastCode = 'NETWORK_ERROR';
          lastError = this.isRetryableHttpStatus(result.status)
            ? `Google Apps Script temporarily busy (HTTP ${result.status}).`
            : `Unexpected response from Google Apps Script (HTTP ${result.status}).`;
          continue;
        }

        if (!result.ok && this.isRetryableHttpStatus(result.status)) {
          lastCode = result.parsed.code || 'NETWORK_ERROR';
          lastError = result.parsed.error || `Backend HTTP error ${result.status}`;
          continue;
        }

        if (result.parsed.code === 'TRANSIENT_AUTH_ERROR') {
          lastCode = 'TRANSIENT_AUTH_ERROR';
          lastError =
            result.parsed.error ||
            'Google sign-in verification is temporarily unavailable. Please retry shortly.';
          continue;
        }

        if (result.parsed.code === 'UNAUTHENTICATED') {
          if (!retriedAuth && this.options?.refreshIdToken) {
            retriedAuth = true;
            const nextToken = await this.options.refreshIdToken(true);
            if (
              nextToken &&
              nextToken !== idToken &&
              (!nextToken.includes('.') || isJwtTokenUsable(nextToken, 30))
            ) {
              idToken = nextToken;
              attempt--;
              skipBackoffOnce = true;
              continue;
            }
          }
          this.options?.onSessionExpired?.(result.parsed.error);
          return result.parsed;
        }

        return result.parsed;
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        lastCode = 'NETWORK_ERROR';
        lastError = isAbort
          ? 'Timed out waiting for Google Apps Script backend.'
          : err instanceof Error
            ? err.message
            : 'Unable to reach Apps Script backend.';
      }
    }
    return { ok: false, code: lastCode, error: lastError };
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
  restoreSession(sessionRecordId: string) {
    return this.call<{ archived: boolean }>('restoreSession', { sessionRecordId });
  }
  deleteSession(sessionRecordId: string) {
    return this.call<{ deleted: boolean; deletedDetailsCount: number }>('deleteSession', {
      sessionRecordId,
    });
  }
  bulkDeleteSessions(sessionRecordIds: string[]) {
    return this.call<{ deletedCount: number; deletedDetailsCount: number }>(
      'bulkDeleteSessions',
      { sessionRecordIds },
    );
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
  searchSchools(query: string, includeInactive = false) {
    return this.call<SchoolRecord[]>('searchSchools', { query, includeInactive });
  }
  updateSchool(school: {
    schoolRecordId: string;
    schoolName: string;
    udiseCode: string;
    schoolType: string;
    state?: string;
    district: string;
    pinCode: string;
    active: boolean;
  }) {
    return this.call<SchoolRecord>('updateSchool', { school });
  }
  deleteSchool(schoolRecordId: string) {
    return this.call<{ deleted: boolean; udiseCode: string }>('deleteSchool', { schoolRecordId });
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
  deleteUser(userIdOrEmail: string) {
    return this.call<{ deleted: boolean; email: string }>('deleteUser', { userIdOrEmail });
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
    if (!this.sheetsBackendUrl) {
      return {
        ok: false,
        code: 'SERVER_MISCONFIGURED',
        error: 'OAuth Google Sheets backend URL is not configured.',
      };
    }
    const base = this.sheetsBackendUrl.replace(/\/$/, '');
    let idToken = this.getIdToken();
    if ((!idToken || (idToken.includes('.') && !isJwtTokenUsable(idToken, 45))) && this.options?.refreshIdToken) {
      const refreshed = await this.options.refreshIdToken(false);
      if (refreshed) idToken = refreshed;
    }

    const backoffMs = [0, 300];
    let lastError = 'Unable to reach OAuth Google Sheets backend.';
    for (let attempt = 0; attempt < backoffMs.length; attempt++) {
      await this.sleep(backoffMs[attempt] ?? 0);
      try {
        const url = method === 'GET' ? `${base}?action=${encodeURIComponent(action)}` : base;
        const result = await this.fetchJsonSafe<ApiResponse<T>>(url, {
          method,
          credentials: 'include',
          headers: {
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: method === 'POST' ? JSON.stringify({ action, ...payload }) : undefined,
        });

        if (result.isHtml || !result.parsed || typeof result.parsed.ok !== 'boolean') {
          lastError = `Sheets backend returned HTTP ${result.status}.`;
          if (this.isRetryableHttpStatus(result.status)) continue;
          return { ok: false, code: 'NETWORK_ERROR', error: lastError };
        }
        if (!result.ok && this.isRetryableHttpStatus(result.status)) {
          lastError = result.parsed.error || `Sheets backend HTTP ${result.status}`;
          continue;
        }
        return result.parsed;
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        lastError = isAbort
          ? 'Timed out reaching OAuth Google Sheets backend.'
          : err instanceof Error
            ? err.message
            : 'Unable to reach OAuth Google Sheets backend.';
      }
    }
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      error: lastError,
    };
  }

  async getSheetsConnection(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    if (this.sheetsBackendUrl) {
      const oauthRes = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthRes.ok && oauthRes.data?.connected) {
        saveCachedSheetsConnection(this.mode, oauthRes.data);
        return oauthRes;
      }
      const asRes = await this.call<GoogleSheetsConnectionState>('getSheetsConnection');
      if (asRes.ok && asRes.data) {
        const merged: GoogleSheetsConnectionState = {
          ...asRes.data,
          oauthConfigured: Boolean(oauthRes.data?.oauthConfigured),
          connectedAccount:
            asRes.data.connectedAccount || oauthRes.data?.connectedAccount || '',
        };
        if (merged.connected) {
          saveCachedSheetsConnection(this.mode, merged);
        } else {
          clearCachedSheetsConnection(this.mode);
        }
        return { ok: true, data: merged };
      }
      return {
        ok: false,
        code: asRes.code || 'NETWORK_ERROR',
        error: asRes.error || oauthRes.error || 'Unable to verify Google Sheets connection status.',
      };
    }

    const res = await this.call<GoogleSheetsConnectionState>('getSheetsConnection');
    if (res.ok && res.data) {
      if (res.data.connected) {
        saveCachedSheetsConnection(this.mode, res.data);
      } else {
        clearCachedSheetsConnection(this.mode);
      }
    }
    return res;
  }

  async listGoogleSpreadsheets(): Promise<ApiResponse<GoogleSpreadsheetSummary[]>> {
    if (this.sheetsBackendUrl) {
      const oauthList = await this.callSheetsBackend<GoogleSpreadsheetSummary[]>(
        'POST',
        'listSpreadsheets',
      );
      if (oauthList.ok && oauthList.data) {
        return oauthList;
      }
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
        const oauthConn = await this.callSheetsBackend<GoogleSheetsConnectionState>(
          'POST',
          'connect',
          params,
        );
        if (oauthConn.ok && oauthConn.data) {
          if (oauthConn.data.connected) {
            saveCachedSheetsConnection(this.mode, oauthConn.data);
          }
          return oauthConn;
        }
        if (
          oauthConn.code !== 'OAUTH_REQUIRED' &&
          oauthConn.code !== 'OAUTH_EXPIRED' &&
          oauthConn.code !== 'OAUTH_REFRESH_FAILED' &&
          oauthConn.code !== 'SERVER_MISCONFIGURED' &&
          oauthConn.code !== 'NETWORK_ERROR'
        ) {
          return oauthConn;
        }
      }
    }
    const asRes = await this.call<GoogleSheetsConnectionState>('connectGoogleSheet', params);
    if (asRes.ok && asRes.data?.connected) {
      saveCachedSheetsConnection(this.mode, asRes.data);
    }
    return asRes;
  }

  async createGoogleSheet(params: {
    title: string;
    googleAccount?: string;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    if (this.sheetsBackendUrl) {
      const oauthStatus = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthStatus.ok && oauthStatus.data?.oauthConfigured) {
        const oauthCreate = await this.callSheetsBackend<GoogleSheetsConnectionState>(
          'POST',
          'create',
          params,
        );
        if (oauthCreate.ok && oauthCreate.data) {
          if (oauthCreate.data.connected) {
            saveCachedSheetsConnection(this.mode, oauthCreate.data);
          }
          return oauthCreate;
        }
        if (
          oauthCreate.code !== 'OAUTH_REQUIRED' &&
          oauthCreate.code !== 'OAUTH_EXPIRED' &&
          oauthCreate.code !== 'OAUTH_REFRESH_FAILED' &&
          oauthCreate.code !== 'SERVER_MISCONFIGURED' &&
          oauthCreate.code !== 'NETWORK_ERROR'
        ) {
          return oauthCreate;
        }
      }
    }
    const asRes = await this.call<GoogleSheetsConnectionState>('createGoogleSheet', params);
    if (asRes.ok && asRes.data?.connected) {
      saveCachedSheetsConnection(this.mode, asRes.data);
    }
    return asRes;
  }

  async disconnectGoogleSheet(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    if (this.sheetsBackendUrl) {
      const oauthStatus = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthStatus.ok && oauthStatus.data?.oauthConfigured && oauthStatus.data.connected) {
        await this.callSheetsBackend<GoogleSheetsConnectionState>('POST', 'disconnect');
      }
    }
    const res = await this.call<GoogleSheetsConnectionState>('disconnectGoogleSheet');
    if (res.ok) {
      clearCachedSheetsConnection(this.mode);
    }
    return res;
  }

  async syncAllToGoogleSheet(): Promise<ApiResponse<SheetsSyncSummary>> {
    if (this.sheetsBackendUrl) {
      const oauthStatus = await this.callSheetsBackend<GoogleSheetsConnectionState>('GET', 'status');
      if (oauthStatus.ok && oauthStatus.data?.oauthConfigured && oauthStatus.data.connected) {
        const collected: SessionRecord[] = [];
        let page = 1;
        let totalPages = 1;
        let fetchFailed = false;
        do {
          const allRes = await this.call<PaginatedResult<SessionRecord>>('getAdminSessions', {
            filters: { includeArchived: true, page, pageSize: 100 },
          });
          if (!allRes.ok || !allRes.data) {
            fetchFailed = true;
            break;
          }
          collected.push(...allRes.data.items);
          totalPages = allRes.data.totalPages || 1;
          page++;
        } while (page <= totalPages);

        if (!fetchFailed) {
          const syncRes = await this.callSheetsBackend<SheetsSyncSummary>('POST', 'sync', {
            sessions: collected,
          });
          if (syncRes.ok) {
            return syncRes;
          }
          if (
            syncRes.code !== 'OAUTH_REQUIRED' &&
            syncRes.code !== 'OAUTH_EXPIRED' &&
            syncRes.code !== 'OAUTH_REFRESH_FAILED' &&
            syncRes.code !== 'SERVER_MISCONFIGURED' &&
            syncRes.code !== 'NETWORK_ERROR'
          ) {
            return syncRes;
          }
        }
      }
    }
    return this.call<SheetsSyncSummary>('syncAllToGoogleSheet', {});
  }

  getTeamIntakeSetup() {
    return this.call<TeamIntakeSetupResponse>('getTeamIntakeConfig');
  }

  rotateTeamIntakeKey() {
    return this.call<TeamIntakeSetupResponse>('rotateTeamIntakeKey');
  }

  getDatabaseHealth() {
    return this.call<DatabaseHealthReport>('getDatabaseHealth');
  }

  recoverDatabaseHealth() {
    return this.call<DatabaseHealthReport>('recoverPendingSessions');
  }

  async exportFacilitatorTransferPackage(): Promise<ApiResponse<SessionTransferPackage>> {
    const userRes = await this.getCurrentUser();
    if (!userRes.ok || !userRes.data) {
      return { ok: false, code: userRes.code || 'UNAUTHENTICATED', error: userRes.error || 'Authentication required.' };
    }
    const collected: SessionRecord[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const pageRes = await this.getMySessions({ includeArchived: false, page, pageSize: 100 });
      if (!pageRes.ok || !pageRes.data) {
        return { ok: false, code: pageRes.code, error: pageRes.error };
      }
      collected.push(...pageRes.data.items);
      totalPages = pageRes.data.totalPages || 1;
      page++;
    } while (page <= totalPages);

    return {
      ok: true,
      data: buildFacilitatorTransferPackage(collected, {
        email: userRes.data.email,
        name: userRes.data.name,
      }),
    };
  }

  async exportDatabaseBackupPackage(): Promise<ApiResponse<DatabaseBackupPackage>> {
    const userRes = await this.getCurrentUser();
    if (!userRes.ok || !userRes.data || userRes.data.role !== 'super_admin') {
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required for full database backup.' };
    }
    const collectedSessions: SessionRecord[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const pageRes = await this.getAdminSessions({ includeArchived: true, page, pageSize: 100 });
      if (!pageRes.ok || !pageRes.data) {
        return { ok: false, code: pageRes.code, error: pageRes.error };
      }
      collectedSessions.push(...pageRes.data.items);
      totalPages = pageRes.data.totalPages || 1;
      page++;
    } while (page <= totalPages);

    const [schoolsRes, usersRes, cfgRes] = await Promise.all([
      this.searchSchools('', true),
      this.listManagedUsers(),
      this.getAppConfiguration(),
    ]);
    if (!schoolsRes.ok || !schoolsRes.data) {
      return { ok: false, code: schoolsRes.code, error: schoolsRes.error };
    }
    if (!usersRes.ok || !usersRes.data) {
      return { ok: false, code: usersRes.code, error: usersRes.error };
    }
    if (!cfgRes.ok || !cfgRes.data) {
      return { ok: false, code: cfgRes.code, error: cfgRes.error };
    }

    const pkg = buildDatabaseBackupPackage(
      {
        sessions: collectedSessions,
        schools: schoolsRes.data,
        users: usersRes.data,
        configuration: cfgRes.data,
      },
      { email: userRes.data.email, name: userRes.data.name },
    );
    await this.logExportEvent('database_backup', collectedSessions.length, 'json');
    return { ok: true, data: pkg };
  }

  async importSessionsPackage(rawPayload: unknown): Promise<ApiResponse<ImportSessionsResult>> {
    const parsed = parseSessionTransferOrBackupPayload(rawPayload);
    if (!parsed.ok) {
      return { ok: false, code: 'INVALID_IMPORT_FILE', error: parsed.error };
    }
    const res = await this.call<ImportSessionsResult>('importSessions', {
      sessions: parsed.sessions,
    });
    if (!res.ok || !res.data) return res;
    return {
      ok: true,
      data: normalizeImportSessionsResult(res.data),
    };
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
  private getIdToken?: () => string | undefined;
  private baseConfig: AppConfiguration;
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
  private workspaceHydratedForSheetId = '';
  private lastHydratedAtMs = 0;
  private workspaceHydrationPromise: Promise<void> | null = null;
  private remoteHydratedUserEmails: Set<string> = new Set();
  private readonly persistWorkspace: boolean;
  private readonly workspaceStorageKey: string;
  private static readonly HYDRATION_TTL_MS = 15_000;

  constructor(
    getActorId: () => string,
    initialConfig?: Partial<AppConfiguration>,
    sheetsBackendUrl = '',
    getIdToken?: () => string | undefined,
    options?: LocalSandboxClientOptions,
  ) {
    this.getActorId = getActorId;
    this.sheetsBackendUrl = sheetsBackendUrl;
    this.getIdToken = getIdToken;
    this.persistWorkspace = Boolean(options?.persistWorkspace);
    this.workspaceStorageKey = options?.workspaceStorageKey || WORKSPACE_STORAGE_KEY;
    this.baseConfig = {
      ...DEFAULT_APP_CONFIGURATION,
      ...initialConfig,
    };
    this.config = structuredClone(this.baseConfig);

    this.users = this.buildDefaultUsers();
    this.sheetsConnection = this.loadPersistedSheetsConnection();
    this.loadPersistedWorkspace();
  }

  private buildDefaultUsers(): ManagedUser[] {
    const now = new Date().toISOString();
    return [...SANDBOX_USERS_LIST, SANDBOX_DENIED_USER].map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      status: u.status ?? (u.active ? 'APPROVED' : 'DENIED'),
      createdAt: now,
      updatedAt: now,
    }));
  }

  private mergeAuthoritativeUsers(candidateUsers: ManagedUser[]): ManagedUser[] {
    const nowIso = new Date().toISOString();
    const map = new Map<string, ManagedUser>();
    for (const sa of INITIAL_SUPER_ADMINS) {
      map.set(normalizeEmail(sa.email), {
        userId: sa.userId,
        name: sa.name,
        email: normalizeEmail(sa.email),
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    for (const u of candidateUsers) {
      const cleanEmail = normalizeEmail(u.email);
      if (!cleanEmail || isAllowlistedSuperAdmin(cleanEmail)) continue;
      map.set(cleanEmail, {
        ...u,
        email: cleanEmail,
        role: 'facilitator',
      });
    }
    return Array.from(map.values());
  }

  private loadPersistedWorkspace(): void {
    if (!this.persistWorkspace || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.workspaceStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        version?: number;
        sessions?: SessionRecord[];
        schools?: SchoolRecord[];
        users?: ManagedUser[];
        config?: Partial<AppConfiguration>;
        auditLogs?: AuditLogEntry[];
        syncLogs?: SyncLogEntry[];
        syncedSessionKeys?: string[];
      } | null;
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return;

      if (Array.isArray(parsed.sessions)) {
        this.sessions = parsed.sessions.map((s) => {
          const { block: _legacyBlock, ...cleanSession } = s as SessionRecord & { block?: unknown };
          return cleanSession;
        });
      }
      if (Array.isArray(parsed.schools)) {
        this.schools = parsed.schools.map((sc) => {
          const { block: _legacyBlock, ...cleanSchool } = sc as SchoolRecord & { block?: unknown };
          return cleanSchool;
        });
      }
      if (Array.isArray(parsed.users) && parsed.users.length > 0) {
        this.users = this.mergeAuthoritativeUsers(parsed.users);
      }
      if (parsed.config && typeof parsed.config === 'object') {
        const { districtBlocks: _legacyDistrictBlocks, ...cleanConfig } =
          parsed.config as Partial<AppConfiguration> & { districtBlocks?: unknown };
        this.config = {
          ...structuredClone(this.baseConfig),
          ...cleanConfig,
          reportingDefaults: {
            ...this.baseConfig.reportingDefaults,
            ...(cleanConfig.reportingDefaults || {}),
          },
          policy: {
            ...this.baseConfig.policy,
            ...(cleanConfig.policy || {}),
            allowFacilitatorExportOwn: false,
          },
        };
      }
      if (Array.isArray(parsed.auditLogs)) {
        this.auditLogs = parsed.auditLogs;
      }
      if (Array.isArray(parsed.syncLogs)) {
        this.syncLogs = parsed.syncLogs;
      }
      const restoredKeys = new Set<string>(
        Array.isArray(parsed.syncedSessionKeys)
          ? parsed.syncedSessionKeys.filter((k): k is string => typeof k === 'string' && k.length > 0)
          : [],
      );
      for (const s of this.sessions) {
        if (s.syncStatus === 'SYNCED' && s.sessionRecordId) {
          restoredKeys.add(s.sessionRecordId);
        }
      }
      this.syncedSessionKeys = restoredKeys;
    } catch {
      // Preserve defaults if localStorage is malformed or unavailable
    }
  }

  private savePersistedWorkspace(allowShrinkToEmpty = false): void {
    if (!this.persistWorkspace || typeof localStorage === 'undefined') return;
    const serialize = (maxLogs: number) =>
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        sessions: this.sessions,
        schools: this.schools,
        users: this.users,
        config: this.config,
        auditLogs: this.auditLogs.slice(0, maxLogs),
        syncLogs: this.syncLogs.slice(0, maxLogs),
        syncedSessionKeys: Array.from(this.syncedSessionKeys),
      });
    const wrotePrimary = safeWriteMirroredLocalStorage(
      this.workspaceStorageKey,
      serialize(250),
      allowShrinkToEmpty,
    );
    if (!wrotePrimary) {
      safeWriteMirroredLocalStorage(this.workspaceStorageKey, serialize(40), allowShrinkToEmpty);
    }
  }

  public reloadPersistedWorkspace(): void {
    this.loadPersistedWorkspace();
    this.sheetsConnection = this.loadPersistedSheetsConnection();
  }

  public setSheetsBackendUrl(nextUrl: string): void {
    this.sheetsBackendUrl = nextUrl.trim();
    this.sheetsConnection = this.loadPersistedSheetsConnection();
  }

  public invalidateWorkspaceCache(): void {
    this.workspaceHydratedForSheetId = '';
    this.lastHydratedAtMs = 0;
  }

  private getActiveTeamIntakeForFacilitator(): {
    appsScriptUrl: string;
    intakeKey: string;
    actor: ManagedUser;
  } | null {
    const actor = this.resolveActor();
    if (!actor || actor.role === 'super_admin' || isAllowlistedSuperAdmin(actor.email)) {
      return null;
    }
    const intake = loadTeamIntakeConfig();
    if (!intake || !intake.appsScriptUrl || !intake.intakeKey) {
      return null;
    }
    const urlCheck = validateAppsScriptWebAppUrl(intake.appsScriptUrl);
    const keyCheck = validateFacilitatorIntakeKey(intake.intakeKey);
    if (!urlCheck.valid || !keyCheck.valid) {
      return null;
    }
    return {
      appsScriptUrl: urlCheck.normalized,
      intakeKey: keyCheck.normalized,
      actor,
    };
  }

  private async callTeamIntakePost<T>(
    action: string,
    payload: Record<string, unknown> = {},
    explicitIntake?: {
      appsScriptUrl: string;
      intakeKey: string;
      actorEmail: string;
      actorName?: string;
    },
  ): Promise<ApiResponse<T>> {
    const activeIntake = explicitIntake ? null : this.getActiveTeamIntakeForFacilitator();
    const targetUrl = (explicitIntake?.appsScriptUrl ?? activeIntake?.appsScriptUrl ?? '').trim();
    const intakeKey = (explicitIntake?.intakeKey ?? activeIntake?.intakeKey ?? '').trim();
    const actorEmail = (explicitIntake?.actorEmail ?? activeIntake?.actor.email ?? '')
      .trim()
      .toLowerCase();
    const actorName = (explicitIntake?.actorName ?? activeIntake?.actor.name ?? '').trim();

    if (!targetUrl || !intakeKey || !actorEmail) {
      return {
        ok: false,
        code: 'TEAM_INTAKE_NOT_CONFIGURED',
        error: 'Team Submission Link is not configured on this device.',
      };
    }

    const retryDelays = [0, 250, 650];
    let lastError: ApiResponse<T> = {
      ok: false,
      code: 'NETWORK_ERROR',
      error: 'Unable to reach Central Programme Database.',
    };

    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
      const delayMs = retryDelays[attempt] ?? 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 25000) : null;
      try {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action,
            intakeKey,
            actorEmail,
            ...(actorName ? { actorName } : {}),
            payload,
          }),
          signal: controller?.signal,
        });
        const rawText = await res.text();
        const trimmed = rawText.trim();
        const isHtml = !trimmed || trimmed.startsWith('<');
        if (res.status === 429 || res.status >= 500 || isHtml) {
          lastError = {
            ok: false,
            code: 'NETWORK_ERROR',
            error: `Central database temporary HTTP ${res.status}.`,
          };
          if (attempt < retryDelays.length - 1) continue;
          return lastError;
        }

        const parsed = JSON.parse(trimmed) as ApiResponse<T>;
        if (!parsed || typeof parsed.ok !== 'boolean') {
          return {
            ok: false,
            code: 'BAD_RESPONSE',
            error: 'Unexpected response format from Central Programme Database.',
          };
        }
        return parsed;
      } catch {
        lastError = {
          ok: false,
          code: 'NETWORK_ERROR',
          error: 'Network timeout or offline — unable to reach Central Programme Database.',
        };
        if (attempt < retryDelays.length - 1) continue;
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
    }

    return lastError;
  }

  private isOAuthSheetsActorAllowed(actor: ManagedUser | null): actor is ManagedUser {
    return Boolean(
      actor &&
        actor.active &&
        actor.role === 'super_admin' &&
        isAllowlistedSuperAdmin(actor.email),
    );
  }

  private isDirectBrowserProvider(conn?: GoogleSheetsConnectionState): boolean {
    const target = conn ?? this.sheetsConnection;
    return Boolean(
      target.connected &&
        target.authMethod === 'google_oauth' &&
        target.connectionProvider === 'direct_browser' &&
        target.spreadsheetId,
    );
  }

  private getActiveBridgeConfig(): AppsScriptBridgeConfig | null {
    const actor = this.resolveActor();
    if (!this.isOAuthSheetsActorAllowed(actor)) return null;
    return loadAppsScriptBridgeConfig();
  }

  private isAppsScriptBridgeActive(): boolean {
    const bridge = this.getActiveBridgeConfig();
    if (!bridge) return false;
    const conn = this.sheetsConnection?.connected
      ? this.sheetsConnection
      : this.loadPersistedSheetsConnection();
    if (conn.connected && !this.sheetsConnection.connected) {
      this.sheetsConnection = conn;
    }
    return Boolean(
      conn.connected &&
        conn.spreadsheetId &&
        (conn.connectionProvider === 'apps_script' || conn.authMethod === 'apps_script'),
    );
  }

  private isDirectSheetsActive(): boolean {
    const actor = this.resolveActor();
    if (!this.isOAuthSheetsActorAllowed(actor)) return false;
    const conn = this.sheetsConnection?.connected
      ? this.sheetsConnection
      : this.loadPersistedSheetsConnection();
    if (conn.connected && !this.sheetsConnection.connected) {
      this.sheetsConnection = conn;
    }
    if (!this.isDirectBrowserProvider(conn)) return false;
    return hasDirectSheetsAccessToken(actor.email);
  }

  private isOAuthSheetsActive(): boolean {
    if (!this.sheetsBackendUrl) return false;
    const actor = this.resolveActor();
    if (!this.isOAuthSheetsActorAllowed(actor)) return false;
    const conn = this.sheetsConnection?.connected
      ? this.sheetsConnection
      : this.loadPersistedSheetsConnection();
    if (conn.connected && !this.sheetsConnection.connected) {
      this.sheetsConnection = conn;
    }
    if (conn.connectionProvider === 'direct_browser' || conn.connectionProvider === 'apps_script') {
      return false;
    }
    return Boolean(
      conn.connected &&
        conn.authMethod === 'google_oauth' &&
        conn.spreadsheetId,
    );
  }

  private isRemoteSheetsActive(): boolean {
    return (
      this.isOAuthSheetsActive() ||
      this.isDirectSheetsActive() ||
      this.isAppsScriptBridgeActive()
    );
  }

  private async resolveDirectClientIdAndToken(
    actorEmail: string,
    explicitClientId?: string,
  ): Promise<
    ApiResponse<{
      accessToken: string;
      email: string;
      clientId: string;
    }>
  > {
    const rawCandidate = (explicitClientId ?? '').trim() || loadDirectGoogleClientId();
    if (!rawCandidate) {
      return {
        ok: false,
        code: 'OAUTH_CLIENT_ID_REQUIRED',
        error:
          'Enter your Google OAuth 2.0 Web Client ID (.apps.googleusercontent.com) to sign in with Google and push live.',
      };
    }
    const clientCheck = validateGoogleOAuthClientId(rawCandidate);
    if (!clientCheck.valid) {
      return {
        ok: false,
        code: 'INVALID_CLIENT_ID',
        error: clientCheck.error || 'Enter a valid Google OAuth 2.0 Web Client ID.',
      };
    }
    if (explicitClientId && explicitClientId.trim()) {
      saveDirectGoogleClientId(clientCheck.normalized);
    }

    const existingToken = getDirectGoogleSheetsTokenInfo(actorEmail, 45_000);
    if (existingToken && existingToken.clientId === clientCheck.normalized) {
      return {
        ok: true,
        data: {
          accessToken: existingToken.accessToken,
          email: existingToken.email,
          clientId: existingToken.clientId,
        },
      };
    }

    const tokenRes = await requestDirectGoogleSheetsToken(clientCheck.normalized, actorEmail, {
      prompt: existingToken ? '' : 'consent',
      forceRefresh: true,
    });
    if (!tokenRes.ok || !tokenRes.data) {
      return {
        ok: false,
        code: tokenRes.code || 'OAUTH_FAILED',
        error: tokenRes.error || 'Google Sheets authorization failed.',
      };
    }
    saveDirectGoogleClientId(clientCheck.normalized);
    return {
      ok: true,
      data: {
        accessToken: tokenRes.data.accessToken,
        email: tokenRes.data.email,
        clientId: tokenRes.data.clientId,
      },
    };
  }

  private loadPersistedSheetsConnection(): GoogleSheetsConnectionState {
    const cachedMeta = loadCachedSheetsConnection('local_sandbox');
    if (typeof localStorage === 'undefined') {
      return (
        this.sheetsConnection ??
        cachedMeta ??
        buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl))
      );
    }
    try {
      const raw = localStorage.getItem(SANDBOX_SHEETS_CONN_KEY);
      if (!raw) {
        return cachedMeta ?? buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
      }
      const parsed = JSON.parse(raw) as Partial<GoogleSheetsConnectionState>;
      if (!parsed || typeof parsed.connected !== 'boolean') {
        return cachedMeta ?? buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
      }
      const merged = {
        ...buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl)),
        ...parsed,
        defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
      };
      if (!merged.connected && cachedMeta?.connected) {
        return cachedMeta;
      }
      return merged;
    } catch {
      return cachedMeta ?? buildDisconnectedState('local_sandbox', Boolean(this.sheetsBackendUrl));
    }
  }

  private savePersistedSheetsConnection(next: GoogleSheetsConnectionState): void {
    const sanitized: GoogleSheetsConnectionState = {
      connected: Boolean(next.connected && next.spreadsheetId),
      authMethod: next.authMethod,
      ...(next.connectionProvider ? { connectionProvider: next.connectionProvider } : {}),
      oauthConfigured: Boolean(next.oauthConfigured),
      connectedAccount: String(next.connectedAccount || ''),
      spreadsheetId: String(next.spreadsheetId || ''),
      spreadsheetName: String(next.spreadsheetName || ''),
      spreadsheetUrl: String(next.spreadsheetUrl || ''),
      connectedAt: String(next.connectedAt || ''),
      connectedBy: String(next.connectedBy || ''),
      lastSyncedAt: String(next.lastSyncedAt || ''),
      lastSyncStatus: next.lastSyncStatus,
      lastSyncMessage: String(next.lastSyncMessage || ''),
      initializedTabs: Array.isArray(next.initializedTabs) ? [...next.initializedTabs] : [],
      defaultSpreadsheetId: next.defaultSpreadsheetId || DEFAULT_TARGET_SPREADSHEET_ID,
      defaultSpreadsheetUrl: next.defaultSpreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL,
    };
    this.sheetsConnection = sanitized;
    if (typeof localStorage !== 'undefined') {
      try {
        if (!sanitized.connected) {
          localStorage.removeItem(SANDBOX_SHEETS_CONN_KEY);
        } else {
          localStorage.setItem(SANDBOX_SHEETS_CONN_KEY, JSON.stringify(sanitized));
        }
      } catch {
        // Ignore storage quota errors
      }
    }
    if (sanitized.connected && sanitized.spreadsheetId) {
      saveCachedSheetsConnection(this.mode, sanitized);
    } else {
      clearCachedSheetsConnection(this.mode);
    }
  }

  private async callAppsScriptBridgePost<T>(
    action: string,
    payload: Record<string, unknown> = {},
    explicitBridge?: { appsScriptUrl: string; syncKey: string; actorEmail?: string },
  ): Promise<ApiResponse<T>> {
    const actor = this.resolveActor();
    const saved = this.getActiveBridgeConfig();
    const targetUrl = (explicitBridge?.appsScriptUrl ?? saved?.appsScriptUrl ?? '').trim();
    const syncKey = (explicitBridge?.syncKey ?? saved?.syncKey ?? '').trim();
    const actorEmail = (explicitBridge?.actorEmail ?? actor?.email ?? '').trim().toLowerCase();

    if (!targetUrl || !syncKey || !actorEmail) {
      return {
        ok: false,
        code: 'BRIDGE_NOT_CONFIGURED',
        error: 'Apps Script Sync Bridge is not configured.',
      };
    }

    const retryDelays = [0, 250, 650];
    let lastError: ApiResponse<T> = {
      ok: false,
      code: 'NETWORK_ERROR',
      error: 'Unable to reach Google Apps Script Web App.',
    };

    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
      const delayMs = retryDelays[attempt] ?? 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 25000) : null;
      try {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action,
            syncKey,
            actorEmail,
            payload,
          }),
          signal: controller?.signal,
        });

        const rawText = await res.text();
        const trimmed = rawText.trim();
        const isHtml = !trimmed || trimmed.startsWith('<');
        if (res.status === 429 || res.status >= 500 || isHtml) {
          lastError = {
            ok: false,
            code: 'NETWORK_ERROR',
            error: isHtml
              ? `Apps Script returned non-JSON response (HTTP ${res.status}). Confirm "Execute as: Me" and "Who has access: Anyone".`
              : `Apps Script temporary HTTP ${res.status}.`,
          };
          if (attempt < retryDelays.length - 1) continue;
          return lastError;
        }

        const parsed = JSON.parse(trimmed) as ApiResponse<T>;
        if (!parsed || typeof parsed.ok !== 'boolean') {
          return {
            ok: false,
            code: 'BAD_RESPONSE',
            error: 'Unexpected response format from Google Apps Script Web App.',
          };
        }
        return parsed;
      } catch {
        lastError = {
          ok: false,
          code: 'NETWORK_ERROR',
          error: 'Network timeout or offline — unable to reach Google Apps Script Web App.',
        };
        if (attempt < retryDelays.length - 1) continue;
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
    }

    return lastError;
  }

  private async callOAuthSheetsPost<T>(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<ApiResponse<T>> {
    const targetUrl = this.sheetsBackendUrl.replace(/\/$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const idToken = this.getIdToken?.();
    if (idToken && isJwtTokenUsable(idToken, 10)) {
      headers.Authorization = `Bearer ${idToken}`;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 25000) : null;
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ action, ...payload }),
        signal: controller?.signal,
      });
      const rawText = await res.text();
      const trimmed = rawText.trim();
      if (!trimmed || trimmed.startsWith('<')) {
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          error: `Sheets API returned non-JSON response (HTTP ${res.status}).`,
        };
      }
      const parsed = JSON.parse(trimmed) as ApiResponse<T>;
      if (!parsed || typeof parsed.ok !== 'boolean') {
        return {
          ok: false,
          code: 'BAD_RESPONSE',
          error: 'Unexpected response format from Google Sheets backend.',
        };
      }
      if (
        !parsed.ok &&
        (parsed.code === 'OAUTH_REQUIRED' ||
          parsed.code === 'OAUTH_EXPIRED' ||
          parsed.code === 'OAUTH_REFRESH_FAILED')
      ) {
        this.savePersistedSheetsConnection(buildDisconnectedState('local_sandbox', true));
        this.invalidateWorkspaceCache();
      }
      return parsed;
    } catch {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        error: 'Network timeout or offline — unable to reach Google Sheets backend.',
      };
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  private async ensureWorkspaceHydrated(force = false): Promise<ApiResponse<{ hydrated: boolean }>> {
    const useDirect = this.isDirectSheetsActive();
    const useAppsScriptBridge = !useDirect && this.isAppsScriptBridgeActive();
    const useBackendOAuth = !useDirect && !useAppsScriptBridge && this.isOAuthSheetsActive();
    if (!useDirect && !useAppsScriptBridge && !useBackendOAuth) {
      return { ok: true, data: { hydrated: false } };
    }
    const persistedConn = this.loadPersistedSheetsConnection();
    const sheetId = this.sheetsConnection.spreadsheetId || persistedConn.spreadsheetId;
    if (
      !force &&
      sheetId &&
      this.workspaceHydratedForSheetId === sheetId &&
      Date.now() - this.lastHydratedAtMs < LocalSandboxApiClient.HYDRATION_TTL_MS
    ) {
      return { ok: true, data: { hydrated: true } };
    }
    const actor = this.resolveActor();
    const directToken = useDirect && actor ? getDirectGoogleSheetsTokenInfo(actor.email) : null;
    if (useDirect && (!directToken || !sheetId)) {
      return { ok: true, data: { hydrated: false } };
    }

    if (this.workspaceHydrationPromise) {
      await this.workspaceHydrationPromise;
      return {
        ok: Boolean(this.workspaceHydratedForSheetId === sheetId),
        ...(this.workspaceHydratedForSheetId === sheetId
          ? { data: { hydrated: true } }
          : { code: 'SHEETS_READ_FAILED', error: 'Failed to load data from connected Google Sheet.' }),
      };
    }

    let hydrationResult: ApiResponse<{ hydrated: boolean }> = { ok: true, data: { hydrated: true } };
    this.workspaceHydrationPromise = (async () => {
      type RemoteWorkspaceShape = {
        sessions: SessionRecord[];
        schools: SchoolRecord[];
        users: ManagedUser[];
        configurationPatch?: Partial<AppConfiguration>;
        configuration?: Partial<AppConfiguration>;
        auditLogs: AuditLogEntry[] | PaginatedResult<AuditLogEntry>;
        syncLogs: SyncLogEntry[] | PaginatedResult<SyncLogEntry>;
        spreadsheetId?: string;
        connection?: GoogleSheetsConnectionState;
      };

      const res: ApiResponse<RemoteWorkspaceShape> = useDirect
        ? await loadDirectWorkspace(sheetId, directToken!.accessToken)
        : useAppsScriptBridge
        ? await this.callAppsScriptBridgePost<RemoteWorkspaceShape>('loadWorkspace')
        : await this.callOAuthSheetsPost<RemoteWorkspaceShape>('loadWorkspace');

      if (!res.ok || !res.data) {
        hydrationResult = {
          ok: false,
          code: res.code || 'SHEETS_READ_FAILED',
          error: res.error || 'Failed to load data from connected Google Sheet.',
        };
        return;
      }

      const remote = res.data;
      const remoteSessionsRaw = Array.isArray(remote.sessions) ? remote.sessions : [];
      const remoteSessions: SessionRecord[] = remoteSessionsRaw.map((s) => {
        const { block: _legacyBlock, ...cleanSession } = s as SessionRecord & { block?: unknown };
        return {
          ...cleanSession,
          syncStatus: s.syncStatus || 'SYNCED',
        };
      });
      const remoteSessionRecordIds = new Set(remoteSessions.map((s) => s.sessionRecordId));
      const remoteSubmissionKeys = new Set(
        remoteSessions.map((s) => s.clientSubmissionKey).filter(Boolean),
      );
      const preservedLocalUnsynced = this.sessions.filter(
        (s) =>
          (s.syncStatus === 'LOCAL_SANDBOX' || !this.syncedSessionKeys.has(s.sessionRecordId)) &&
          !remoteSessionRecordIds.has(s.sessionRecordId) &&
          (!s.clientSubmissionKey || !remoteSubmissionKeys.has(s.clientSubmissionKey)),
      );
      this.sessions = [...preservedLocalUnsynced, ...remoteSessions];

      const remoteSchools = (Array.isArray(remote.schools) ? remote.schools : []).map((sc) => {
        const { block: _legacyBlock, ...cleanSchool } = sc as SchoolRecord & { block?: unknown };
        return cleanSchool;
      });
      const remoteUdiseSet = new Set(remoteSchools.map((sc) => sc.udiseCode));
      const preservedLocalSchools = this.schools.filter(
        (sc) =>
          !remoteUdiseSet.has(sc.udiseCode) &&
          preservedLocalUnsynced.some((s) => s.udiseCode === sc.udiseCode),
      );
      this.schools = [...remoteSchools, ...preservedLocalSchools];

      const nowIso = new Date().toISOString();
      const mergedUsers = new Map<string, ManagedUser>();
      for (const sa of INITIAL_SUPER_ADMINS) {
        mergedUsers.set(sa.email, {
          userId: sa.userId,
          name: sa.name,
          email: sa.email,
          role: 'super_admin',
          active: true,
          status: 'APPROVED',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      for (const localUser of this.users) {
        const cleanEmail = normalizeEmail(localUser.email);
        if (
          !cleanEmail ||
          isAllowlistedSuperAdmin(cleanEmail) ||
          this.remoteHydratedUserEmails.has(cleanEmail)
        ) {
          continue;
        }
        mergedUsers.set(cleanEmail, localUser);
      }
      const nextRemoteUserEmails = new Set<string>();
      for (const u of remote.users || []) {
        const cleanEmail = normalizeEmail(u.email);
        if (!cleanEmail || isAllowlistedSuperAdmin(cleanEmail)) continue;
        nextRemoteUserEmails.add(cleanEmail);
        mergedUsers.set(cleanEmail, {
          ...u,
          email: cleanEmail,
          role: 'facilitator',
        });
      }
      this.remoteHydratedUserEmails = nextRemoteUserEmails;
      this.users = Array.from(mergedUsers.values());

      const configPatch = remote.configurationPatch ?? remote.configuration;
      if (configPatch && typeof configPatch === 'object') {
        const { districtBlocks: _legacyDistrictBlocks, ...cleanConfigPatch } =
          configPatch as Partial<AppConfiguration> & { districtBlocks?: unknown };
        this.config = {
          ...structuredClone(this.baseConfig),
          ...cleanConfigPatch,
          reportingDefaults: {
            ...this.baseConfig.reportingDefaults,
            ...(cleanConfigPatch.reportingDefaults || {}),
          },
          policy: {
            ...this.baseConfig.policy,
            ...(cleanConfigPatch.policy || {}),
            allowFacilitatorExportOwn: false,
          },
        };
      }

      this.auditLogs = Array.isArray(remote.auditLogs)
        ? remote.auditLogs
        : Array.isArray(remote.auditLogs?.items)
        ? remote.auditLogs.items
        : [];
      this.syncLogs = Array.isArray(remote.syncLogs)
        ? remote.syncLogs
        : Array.isArray(remote.syncLogs?.items)
        ? remote.syncLogs.items
        : [];

      this.syncedSessionKeys.clear();
      for (const s of remoteSessions) {
        this.syncedSessionKeys.add(s.sessionRecordId);
      }

      if (useAppsScriptBridge && remote.connection?.connected && remote.connection.spreadsheetId) {
        this.savePersistedSheetsConnection({
          ...remote.connection,
          authMethod: 'apps_script',
          connectionProvider: 'apps_script',
        });
      }

      const resolvedSheetId =
        remote.spreadsheetId || remote.connection?.spreadsheetId || sheetId;
      this.workspaceHydratedForSheetId = resolvedSheetId;
      this.lastHydratedAtMs = Date.now();
      this.savePersistedWorkspace();
    })().finally(() => {
      this.workspaceHydrationPromise = null;
    });

    await this.workspaceHydrationPromise;
    return hydrationResult;
  }

  async pingHealth(): Promise<ApiResponse<BackendHealthInfo>> {
    const teamIntake = this.getActiveTeamIntakeForFacilitator();
    if (teamIntake) {
      return {
        ok: true,
        data: {
          mode: 'local_sandbox',
          connectedToGoogleSheets: true,
          status: 'READY',
          checkedAt: new Date().toISOString(),
          endpointConfigured: true,
        },
      };
    }

    if (this.isDirectSheetsActive()) {
      return {
        ok: true,
        data: {
          mode: 'local_sandbox',
          connectedToGoogleSheets: true,
          status: 'READY',
          checkedAt: new Date().toISOString(),
          endpointConfigured: true,
        },
      };
    }

    if (this.isAppsScriptBridgeActive()) {
      const connRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
        'getSheetsConnection',
        {},
      );
      if (!connRes.ok || !connRes.data) {
        return {
          ok: false,
          code: connRes.code || 'NETWORK_ERROR',
          error: connRes.error || 'Unable to reach Google Apps Script Web App.',
        };
      }
      if (connRes.data.connected && connRes.data.spreadsheetId) {
        this.savePersistedSheetsConnection({
          ...connRes.data,
          authMethod: 'apps_script',
          connectionProvider: 'apps_script',
        });
      }
      return {
        ok: true,
        data: {
          mode: 'local_sandbox',
          connectedToGoogleSheets: Boolean(connRes.data.connected && connRes.data.spreadsheetId),
          status: connRes.data.connected ? 'READY' : 'LOCAL_SANDBOX',
          checkedAt: new Date().toISOString(),
          endpointConfigured: true,
        },
      };
    }

    if (this.isOAuthSheetsActive()) {
      const parsed = await this.fetchOAuthSheetsJson<
        GoogleSheetsConnectionState & { oauthError?: string }
      >(`${this.sheetsBackendUrl.replace(/\/$/, '')}?action=status`);
      if (!parsed) {
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          error: 'Unable to reach Google Sheets OAuth backend.',
        };
      }
      if (parsed.ok && parsed.data?.connected) {
        this.savePersistedSheetsConnection(parsed.data);
        return {
          ok: true,
          data: {
            mode: 'local_sandbox',
            connectedToGoogleSheets: true,
            status: 'READY',
            checkedAt: new Date().toISOString(),
            endpointConfigured: true,
          },
        };
      }
      if (
        this.sheetsConnection.authMethod === 'google_oauth' &&
        this.sheetsConnection.connectionProvider !== 'direct_browser' &&
        this.sheetsConnection.connectionProvider !== 'apps_script'
      ) {
        this.savePersistedSheetsConnection(
          buildDisconnectedState('local_sandbox', Boolean(parsed.data?.oauthConfigured ?? true)),
        );
        this.invalidateWorkspaceCache();
      }
      return {
        ok: true,
        data: {
          mode: 'local_sandbox',
          connectedToGoogleSheets: false,
          status: 'LOCAL_SANDBOX',
          checkedAt: new Date().toISOString(),
          endpointConfigured: Boolean(parsed.data?.oauthConfigured),
        },
      };
    }

    return {
      ok: true,
      data: {
        mode: 'local_sandbox',
        connectedToGoogleSheets: false,
        status: 'LOCAL_SANDBOX',
        checkedAt: new Date().toISOString(),
        endpointConfigured: Boolean(
          this.sheetsBackendUrl || loadDirectGoogleClientId() || loadAppsScriptBridgeConfig(),
        ),
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
    this.savePersistedWorkspace();
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

  async authenticateSandboxEmail(
    email: string,
    name?: string,
    options?: { password?: string; resumeToken?: string },
  ): Promise<ApiResponse<UserProfile>> {
    return this.withMutex(async () => {
      const cleanEmail = normalizeEmail(email);
      if (!cleanEmail) {
        return { ok: false, code: 'UNAUTHENTICATED', error: 'Email is required.' };
      }

      const allowlisted = INITIAL_SUPER_ADMINS.find((sa) => sa.email === cleanEmail);
      if (allowlisted) {
        const allowlistedUser: ManagedUser = this.users.find(
          (u) => u.userId === allowlisted.userId,
        ) ?? {
          userId: allowlisted.userId,
          name: allowlisted.name,
          email: allowlisted.email,
          role: 'super_admin',
          active: true,
          status: 'APPROVED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const rawPassword = typeof options?.password === 'string' ? options.password : '';
        const rawResumeToken =
          typeof options?.resumeToken === 'string' ? options.resumeToken.trim() : '';

        if (rawPassword.length > 0) {
          const passwordValid = await verifySuperAdminPassword(allowlisted.email, rawPassword);
          if (!passwordValid) {
            this.recordAudit(
              allowlistedUser,
              'AUTH_PASSWORD_FAILED',
              'Auth',
              allowlisted.userId,
              '',
              'Invalid password submitted for Super Administrator sign-in',
              'DENIED',
            );
            return {
              ok: false,
              code: 'INVALID_PASSWORD',
              error: 'Incorrect password. Check your password and try again.',
            };
          }
          mintActiveSandboxSessionProof(allowlisted.email);
          this.recordAudit(
            allowlistedUser,
            'AUTH_PASSWORD_VERIFIED',
            'Auth',
            allowlisted.userId,
            '',
            'Super Administrator password verified',
            'SUCCESS',
          );
        } else if (rawResumeToken.length > 0) {
          const validProof = verifyActiveSandboxSessionProof(allowlisted.email, rawResumeToken);
          if (!validProof) {
            return {
              ok: false,
              code: 'INVALID_PASSWORD',
              error: 'Your previous administrator session expired. Sign in with your password.',
            };
          }
        } else {
          return {
            ok: false,
            code: 'PASSWORD_REQUIRED',
            error: 'Enter the password for this Super Administrator account.',
          };
        }

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
      const teamIntakeCfg = loadTeamIntakeConfig();
      if (teamIntakeCfg?.appsScriptUrl && teamIntakeCfg?.intakeKey) {
        const remoteAuthRes = await this.callTeamIntakePost<UserProfile>(
          'getCurrentUser',
          {},
          {
            appsScriptUrl: teamIntakeCfg.appsScriptUrl,
            intakeKey: teamIntakeCfg.intakeKey,
            actorEmail: cleanEmail,
            actorName: name?.trim() || matched?.name || '',
          },
        );
        if (remoteAuthRes.ok && remoteAuthRes.data) {
          const now = new Date().toISOString();
          const verifiedUser: ManagedUser = {
            userId: remoteAuthRes.data.userId || matched?.userId || `FAC_${generateUuid().slice(0, 8).toUpperCase()}`,
            name: remoteAuthRes.data.name || name?.trim() || matched?.name || cleanEmail,
            email: cleanEmail,
            role: 'facilitator',
            active: true,
            status: 'APPROVED',
            createdAt: matched?.createdAt || now,
            updatedAt: now,
          };
          const existingIdx = this.users.findIndex((u) => normalizeEmail(u.email) === cleanEmail);
          if (existingIdx !== -1) this.users[existingIdx] = verifiedUser;
          else this.users.push(verifiedUser);
          this.recordAudit(
            verifiedUser,
            'AUTH_INTAKE_VERIFIED',
            'Auth',
            verifiedUser.userId,
            '',
            'Facilitator verified via Team Submission Link',
            'SUCCESS',
          );
          return {
            ok: true,
            data: {
              ...verifiedUser,
              authMode: 'local_sandbox',
            },
          };
        }
        if (remoteAuthRes.code !== 'NETWORK_ERROR') {
          if (remoteAuthRes.code === 'PENDING_APPROVAL' && !matched) {
            const now = new Date().toISOString();
            const pendingLocal: ManagedUser = {
              userId: `FAC_${generateUuid().slice(0, 8).toUpperCase()}`,
              name: name?.trim() || cleanEmail,
              email: cleanEmail,
              role: 'facilitator',
              active: false,
              status: 'PENDING',
              createdAt: now,
              updatedAt: now,
            };
            this.users.push(pendingLocal);
            this.savePersistedWorkspace();
          }
          return {
            ok: false,
            code: remoteAuthRes.code,
            error: remoteAuthRes.error,
          };
        }
        if (matched && matched.active && matched.status !== 'DENIED' && matched.status !== 'PENDING') {
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
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          error:
            remoteAuthRes.error ||
            'Unable to verify your Team Submission Link right now. Check your internet connection and retry.',
        };
      }

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

  async changeSuperAdminPassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<ApiResponse<{ updated: boolean; updatedAt: string }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
        this.recordAudit(
          actor,
          'CHANGE_ADMIN_PASSWORD',
          'Auth',
          actor?.userId ?? 'UNKNOWN',
          '',
          'Unauthorized password update attempt',
          'DENIED',
        );
        return {
          ok: false,
          code: 'FORBIDDEN',
          error: 'Only allowlisted Super Administrators can update this password.',
        };
      }

      const updateRes = await updateSuperAdminPassword(actor.email, currentPassword, newPassword);
      if (!updateRes.ok) {
        if (updateRes.code === 'INVALID_CURRENT_PASSWORD') {
          this.recordAudit(
            actor,
            'AUTH_PASSWORD_FAILED',
            'Auth',
            actor.userId,
            '',
            'Current password verification failed during password update',
            'DENIED',
          );
        }
        return {
          ok: false,
          code: updateRes.code ?? 'VALIDATION_ERROR',
          error: updateRes.error || 'Could not update Super Administrator password.',
        };
      }

      mintActiveSandboxSessionProof(actor.email);
      const updatedAt = updateRes.updatedAt ?? new Date().toISOString();
      this.recordAudit(
        actor,
        'CHANGE_ADMIN_PASSWORD',
        'Auth',
        actor.userId,
        '',
        'Updated Super Administrator password hash (PBKDF2-SHA256)',
        'SUCCESS',
      );
      return {
        ok: true,
        data: {
          updated: true,
          updatedAt,
        },
      };
    });
  }

  async getAppConfiguration(): Promise<ApiResponse<AppConfiguration>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    if (this.isRemoteSheetsActive()) {
      await this.ensureWorkspaceHydrated();
    } else {
      const intake = this.getActiveTeamIntakeForFacilitator();
      if (intake) {
        const remoteCfg = await this.callTeamIntakePost<AppConfiguration>('getAppConfiguration', {});
        if (remoteCfg.ok && remoteCfg.data) {
          this.config = {
            ...structuredClone(this.baseConfig),
            ...remoteCfg.data,
            reportingDefaults: {
              ...this.baseConfig.reportingDefaults,
              ...(remoteCfg.data.reportingDefaults || {}),
            },
            policy: {
              ...this.baseConfig.policy,
              ...(remoteCfg.data.policy || {}),
              allowFacilitatorExportOwn: false,
            },
          };
          this.savePersistedWorkspace();
        }
      }
    }
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

    if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
      let res: ApiResponse<AppConfiguration>;
      if (this.isDirectSheetsActive()) {
        const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
        const sheetId =
          this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
        if (!directToken || !sheetId) {
          return {
            ok: false,
            code: 'OAUTH_EXPIRED',
            error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
          };
        }
        res = await saveDirectConfiguration({
          spreadsheetId: sheetId,
          accessToken: directToken.accessToken,
          actorEmail: actor.email,
          partial,
          fallbackConfig: this.config,
        });
      } else if (this.isAppsScriptBridgeActive()) {
        res = await this.callAppsScriptBridgePost<AppConfiguration>('saveAppConfiguration', {
          config: partial,
        });
      } else {
        res = await this.callOAuthSheetsPost<AppConfiguration>('saveConfiguration', {
          config: partial,
        });
      }
      if (!res.ok || !res.data) {
        return res;
      }
      this.config = res.data;
      this.recordAudit(
        actor,
        'UPDATE_CONFIG',
        'Configuration',
        'SYSTEM',
        '',
        JSON.stringify({
          schoolYear: this.config.schoolYear,
          partnerName: this.config.partnerName,
          districts: this.config.allowedDistricts,
        }),
        'SUCCESS',
      );
      return { ok: true, data: structuredClone(this.config) };
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

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        const validation = validateSessionForm(values, this.config);
        if (!validation.valid) {
          return {
            ok: false,
            code: 'VALIDATION_FAILED',
            error: validation.errors.map((e) => e.message).join(' '),
          };
        }

        let res: ApiResponse<{
          session: SessionRecord;
          warnings: string[];
          schoolUdiseConflict?: string;
        }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await createDirectSession({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            values,
            fallbackConfig: this.config,
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{
            session: SessionRecord;
            warnings: string[];
            schoolUdiseConflict?: string;
          }>('createSession', { values });
        } else {
          res = await this.callOAuthSheetsPost<{
            session: SessionRecord;
            warnings: string[];
            schoolUdiseConflict?: string;
          }>('createSession', { values });
        }

        if (!res.ok || !res.data) {
          return res;
        }

        const savedSession: SessionRecord = {
          ...res.data.session,
          syncStatus: 'SYNCED',
        };
        if (!this.sessions.some((s) => s.sessionRecordId === savedSession.sessionRecordId)) {
          this.sessions.unshift(savedSession);
        }
        this.syncedSessionKeys.add(savedSession.sessionRecordId);
        if (
          !res.data.schoolUdiseConflict &&
          savedSession.udiseCode &&
          !this.schools.some((sc) => sc.udiseCode === savedSession.udiseCode)
        ) {
          this.schools.push({
            schoolRecordId: `SCH_${generateUuid().slice(0, 8).toUpperCase()}`,
            schoolName: savedSession.schoolName,
            udiseCode: savedSession.udiseCode,
            schoolType: savedSession.schoolType,
            state: savedSession.state,
            district: savedSession.district,
            pinCode: savedSession.pinCode,
            active: true,
            createdAt: savedSession.createdAt,
            updatedAt: savedSession.updatedAt,
          });
        }
        const nowIso = savedSession.updatedAt || new Date().toISOString();
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: savedSession.clientSubmissionKey,
          sessionRecordId: savedSession.sessionRecordId,
          sessionId: savedSession.sessionId,
          actorEmail: actor.email,
          operation: 'createSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.recordAudit(
          actor,
          'CREATE_SESSION',
          'Session',
          savedSession.sessionRecordId,
          '',
          `Session ${savedSession.sessionId} (${savedSession.district}, ${savedSession.totalStudentsPresent} students)`,
          'SUCCESS',
        );
        if (this.sheetsConnection.connected) {
          this.savePersistedSheetsConnection({
            ...this.sheetsConnection,
            lastSyncedAt: nowIso,
            lastSyncStatus: 'SYNCED',
            lastSyncMessage: `Synced session ${savedSession.sessionId} to Google Sheets.`,
          });
        }
        this.savePersistedWorkspace();

        return {
          ok: true,
          data: {
            session: structuredClone(savedSession),
            warnings: res.data.warnings || validation.warnings.map((w) => w.message),
            schoolUdiseConflict: res.data.schoolUdiseConflict,
          },
        };
      }

      const teamIntake = this.getActiveTeamIntakeForFacilitator();
      if (teamIntake) {
        const validation = validateSessionForm(values, this.config);
        if (!validation.valid) {
          return {
            ok: false,
            code: 'VALIDATION_FAILED',
            error: validation.errors.map((e) => e.message).join(' '),
          };
        }

        const remoteRes = await this.callTeamIntakePost<{
          session: SessionRecord;
          warnings: string[];
          schoolUdiseConflict?: string;
        }>('createSession', { values });
        if (!remoteRes.ok || !remoteRes.data) {
          return remoteRes;
        }

        const savedSession: SessionRecord = {
          ...remoteRes.data.session,
          syncStatus: 'SYNCED',
        };
        if (!this.sessions.some((s) => s.sessionRecordId === savedSession.sessionRecordId)) {
          this.sessions.unshift(savedSession);
        }
        this.syncedSessionKeys.add(savedSession.sessionRecordId);
        if (
          !remoteRes.data.schoolUdiseConflict &&
          savedSession.udiseCode &&
          !this.schools.some((sc) => sc.udiseCode === savedSession.udiseCode)
        ) {
          this.schools.push({
            schoolRecordId: `SCH_${generateUuid().slice(0, 8).toUpperCase()}`,
            schoolName: savedSession.schoolName,
            udiseCode: savedSession.udiseCode,
            schoolType: savedSession.schoolType,
            state: savedSession.state,
            district: savedSession.district,
            pinCode: savedSession.pinCode,
            active: true,
            createdAt: savedSession.createdAt,
            updatedAt: savedSession.updatedAt,
          });
        }
        const nowIso = savedSession.updatedAt || new Date().toISOString();
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: savedSession.clientSubmissionKey,
          sessionRecordId: savedSession.sessionRecordId,
          sessionId: savedSession.sessionId,
          actorEmail: actor.email,
          operation: 'createSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.recordAudit(
          actor,
          'CREATE_SESSION',
          'Session',
          savedSession.sessionRecordId,
          '',
          `Session ${savedSession.sessionId} (${savedSession.district}, ${savedSession.totalStudentsPresent} students)`,
          'SUCCESS',
        );
        this.savePersistedWorkspace();

        return {
          ok: true,
          data: {
            session: structuredClone(savedSession),
            warnings: remoteRes.data.warnings || validation.warnings.map((w) => w.message),
            schoolUdiseConflict: remoteRes.data.schoolUdiseConflict,
          },
        };
      }

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
        this.savePersistedWorkspace();
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
        `Session ${sessionId} (${values.district}, ${metrics.totalStudentsPresent} students)`,
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

      const cleanId = String(sessionRecordId || '').trim();
      if (!cleanId) {
        return { ok: false, code: 'INVALID_ID', error: 'sessionRecordId is required.' };
      }

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        const existingLocal = this.sessions.find((s) => s.sessionRecordId === cleanId);
        const values: SessionFormValues = {
          ...rawValues,
          facilitatorEmail: existingLocal?.facilitatorEmail || actor.email,
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

        let res: ApiResponse<{ session: SessionRecord; warnings: string[] }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await updateDirectSession({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            sessionRecordId: cleanId,
            values,
            fallbackConfig: this.config,
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{
            session: SessionRecord;
            warnings: string[];
          }>('updateSession', { sessionRecordId: cleanId, values });
        } else {
          res = await this.callOAuthSheetsPost<{
            session: SessionRecord;
            warnings: string[];
          }>('updateSession', { sessionRecordId: cleanId, values });
        }

        if (!res.ok || !res.data) {
          return res;
        }

        const updated: SessionRecord = {
          ...res.data.session,
          syncStatus: 'SYNCED',
        };
        const idx = this.sessions.findIndex((s) => s.sessionRecordId === cleanId);
        if (idx !== -1) {
          this.sessions[idx] = updated;
        } else {
          this.sessions.unshift(updated);
        }
        const nowIso = updated.updatedAt || new Date().toISOString();
        this.recordAudit(
          actor,
          'ADMIN_CORRECT_SESSION',
          'Session',
          updated.sessionRecordId,
          '',
          `CSAT=${updated.overallCsat}, ITP=${updated.overallItp}, Students=${updated.totalStudentsPresent}`,
          'SUCCESS',
        );
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: updated.clientSubmissionKey || '',
          sessionRecordId: updated.sessionRecordId,
          sessionId: updated.sessionId,
          actorEmail: actor.email,
          operation: 'updateSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        if (this.sheetsConnection.connected) {
          this.savePersistedSheetsConnection({
            ...this.sheetsConnection,
            lastSyncedAt: nowIso,
            lastSyncStatus: 'SYNCED',
            lastSyncMessage: `Updated session ${updated.sessionId} in Google Sheets.`,
          });
        }
        this.savePersistedWorkspace();
        return {
          ok: true,
          data: {
            session: structuredClone(updated),
            warnings: res.data.warnings || validation.warnings.map((w) => w.message),
          },
        };
      }

      const existingLocalBeforeIntake = this.sessions.find((s) => s.sessionRecordId === cleanId);
      const teamIntake =
        existingLocalBeforeIntake?.syncStatus === 'LOCAL_SANDBOX'
          ? null
          : this.getActiveTeamIntakeForFacilitator();
      if (teamIntake) {
        const values: SessionFormValues = {
          ...rawValues,
          facilitatorEmail: existingLocalBeforeIntake?.facilitatorEmail || actor.email,
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

        const remoteRes = await this.callTeamIntakePost<{
          session: SessionRecord;
          warnings: string[];
        }>('updateSession', { sessionRecordId: cleanId, values });
        if (!remoteRes.ok || !remoteRes.data) {
          return remoteRes;
        }

        const updated: SessionRecord = {
          ...remoteRes.data.session,
          syncStatus: 'SYNCED',
        };
        const idx = this.sessions.findIndex((s) => s.sessionRecordId === cleanId);
        if (idx !== -1) this.sessions[idx] = updated;
        else this.sessions.unshift(updated);
        this.syncedSessionKeys.add(updated.sessionRecordId);

        const nowIso = updated.updatedAt || new Date().toISOString();
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: updated.clientSubmissionKey || '',
          sessionRecordId: updated.sessionRecordId,
          sessionId: updated.sessionId,
          actorEmail: actor.email,
          operation: 'updateSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.recordAudit(
          actor,
          'UPDATE_SESSION',
          'Session',
          updated.sessionRecordId,
          '',
          `CSAT=${updated.overallCsat}, ITP=${updated.overallItp}, Students=${updated.totalStudentsPresent}`,
          'SUCCESS',
        );
        this.savePersistedWorkspace();
        return {
          ok: true,
          data: {
            session: structuredClone(updated),
            warnings: remoteRes.data.warnings || validation.warnings.map((w) => w.message),
          },
        };
      }

      const target = this.sessions.find((s) => s.sessionRecordId === cleanId);
      if (!target) {
        return { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' };
      }

      const isAdmin = actor.role === 'super_admin';
      if (!isAdmin && target.facilitatorEmail !== actor.email) {
        this.recordAudit(actor, 'UPDATE_SESSION', 'Session', cleanId, '', 'Cross-user access blocked', 'DENIED');
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
      this.savePersistedWorkspace();

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
      const cleanId = sessionRecordId.trim();
      if (!cleanId) return { ok: false, code: 'INVALID_ID', error: 'sessionRecordId is required.' };

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        let res: ApiResponse<{ archived: boolean }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await setDirectSessionArchived({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            sessionRecordId: cleanId,
            archived: true,
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{ archived: boolean }>('archiveSession', {
            sessionRecordId: cleanId,
          });
        } else {
          res = await this.callOAuthSheetsPost<{ archived: boolean }>('archiveSession', {
            sessionRecordId: cleanId,
          });
        }
        if (!res.ok) return res;
        const nowIso = new Date().toISOString();
        const target = this.sessions.find((s) => s.sessionRecordId === cleanId);
        if (target) {
          target.archived = true;
          target.updatedAt = nowIso;
          target.updatedBy = actor.email;
        }
        this.recordAudit(actor, 'ARCHIVE_SESSION', 'Session', cleanId, 'archived=false', 'archived=true', 'SUCCESS');
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: target?.clientSubmissionKey || '',
          sessionRecordId: cleanId,
          sessionId: target?.sessionId || cleanId,
          actorEmail: actor.email,
          operation: 'archiveSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.savePersistedWorkspace();
        return res;
      }

      const existingBeforeArchive = this.sessions.find((s) => s.sessionRecordId === cleanId);
      const teamIntake =
        existingBeforeArchive?.syncStatus === 'LOCAL_SANDBOX'
          ? null
          : this.getActiveTeamIntakeForFacilitator();
      if (teamIntake) {
        const remoteRes = await this.callTeamIntakePost<{ archived: boolean }>('archiveSession', {
          sessionRecordId: cleanId,
        });
        if (!remoteRes.ok) return remoteRes;
        const nowIso = new Date().toISOString();
        if (existingBeforeArchive) {
          existingBeforeArchive.archived = true;
          existingBeforeArchive.syncStatus = 'SYNCED';
          existingBeforeArchive.updatedAt = nowIso;
          existingBeforeArchive.updatedBy = actor.email;
        }
        this.recordAudit(actor, 'ARCHIVE_SESSION', 'Session', cleanId, 'archived=false', 'archived=true', 'SUCCESS');
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: existingBeforeArchive?.clientSubmissionKey || '',
          sessionRecordId: cleanId,
          sessionId: existingBeforeArchive?.sessionId || cleanId,
          actorEmail: actor.email,
          operation: 'archiveSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.savePersistedWorkspace();
        return remoteRes;
      }

      const target = this.sessions.find((s) => s.sessionRecordId === cleanId);
      if (!target) return { ok: false, code: 'NOT_FOUND', error: 'Session not found.' };

      const isAdmin = actor.role === 'super_admin';
      if (!isAdmin) {
        if (target.facilitatorEmail !== actor.email) {
          this.recordAudit(actor, 'ARCHIVE_SESSION', 'Session', cleanId, '', 'Cross-user archive blocked', 'DENIED');
          return { ok: false, code: 'FORBIDDEN', error: 'Cannot archive another facilitator’s session.' };
        }
        if (!this.config.policy.allowFacilitatorDeleteOwn) {
          return { ok: false, code: 'POLICY_RESTRICTED', error: 'Facilitator deletion is disabled by administrator policy.' };
        }
      }

      const nowIso = new Date().toISOString();
      target.archived = true;
      target.updatedAt = nowIso;
      target.updatedBy = actor.email;
      this.recordAudit(actor, 'ARCHIVE_SESSION', 'Session', cleanId, 'archived=false', 'archived=true', 'SUCCESS');
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: target.clientSubmissionKey || '',
        sessionRecordId: cleanId,
        sessionId: target.sessionId,
        actorEmail: actor.email,
        operation: 'archiveSession',
        attempt: 1,
        status: 'LOCAL_SANDBOX',
        errorMessage: '',
      });
      this.savePersistedWorkspace();
      return { ok: true, data: { archived: true } };
    });
  }

  async restoreSession(sessionRecordId: string): Promise<ApiResponse<{ archived: boolean }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
      if (actor.role !== 'super_admin') {
        this.recordAudit(actor, 'RESTORE_SESSION', 'Session', sessionRecordId, '', 'Unauthorized restore attempt', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }
      const cleanId = sessionRecordId.trim();
      if (!cleanId) return { ok: false, code: 'INVALID_ID', error: 'sessionRecordId is required.' };

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        let res: ApiResponse<{ archived: boolean }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await setDirectSessionArchived({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            sessionRecordId: cleanId,
            archived: false,
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{ archived: boolean }>('restoreSession', {
            sessionRecordId: cleanId,
          });
        } else {
          res = await this.callOAuthSheetsPost<{ archived: boolean }>('restoreSession', {
            sessionRecordId: cleanId,
          });
        }
        if (!res.ok) return res;
        const nowIso = new Date().toISOString();
        const target = this.sessions.find((s) => s.sessionRecordId === cleanId);
        if (target) {
          target.archived = false;
          target.updatedAt = nowIso;
          target.updatedBy = actor.email;
        }
        this.recordAudit(actor, 'RESTORE_SESSION', 'Session', cleanId, 'archived=true', 'archived=false', 'SUCCESS');
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: target?.clientSubmissionKey || '',
          sessionRecordId: cleanId,
          sessionId: target?.sessionId || cleanId,
          actorEmail: actor.email,
          operation: 'restoreSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.savePersistedWorkspace();
        return res;
      }

      const target = this.sessions.find((s) => s.sessionRecordId === cleanId);
      if (!target) return { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' };

      const nowIso = new Date().toISOString();
      target.archived = false;
      target.updatedAt = nowIso;
      target.updatedBy = actor.email;
      this.recordAudit(actor, 'RESTORE_SESSION', 'Session', cleanId, 'archived=true', 'archived=false', 'SUCCESS');
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: target.clientSubmissionKey || '',
        sessionRecordId: cleanId,
        sessionId: target.sessionId,
        actorEmail: actor.email,
        operation: 'restoreSession',
        attempt: 1,
        status: 'LOCAL_SANDBOX',
        errorMessage: '',
      });
      this.savePersistedWorkspace();
      return { ok: true, data: { archived: false } };
    });
  }

  async deleteSession(
    sessionRecordId: string,
  ): Promise<ApiResponse<{ deleted: boolean; deletedDetailsCount: number }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
      if (actor.role !== 'super_admin') {
        this.recordAudit(actor, 'DELETE_SESSION', 'Session', sessionRecordId, '', 'Unauthorized permanent delete attempt', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }
      const cleanId = sessionRecordId.trim();
      if (!cleanId) return { ok: false, code: 'INVALID_ID', error: 'sessionRecordId is required.' };

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        let res: ApiResponse<{ deleted: boolean; deletedDetailsCount: number }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          const delRes = await deleteDirectSessions({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            sessionRecordIds: [cleanId],
          });
          res = delRes.ok && delRes.data
            ? {
                ok: true,
                data: {
                  deleted: delRes.data.deletedCount > 0,
                  deletedDetailsCount: delRes.data.deletedDetailsCount,
                },
              }
            : { ok: false, code: delRes.code, error: delRes.error };
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{
            deleted: boolean;
            deletedDetailsCount: number;
          }>('deleteSession', { sessionRecordId: cleanId });
        } else {
          res = await this.callOAuthSheetsPost<{
            deleted: boolean;
            deletedDetailsCount: number;
          }>('deleteSession', { sessionRecordId: cleanId });
        }
        if (!res.ok) return res;
        const idx = this.sessions.findIndex((s) => s.sessionRecordId === cleanId);
        const target = idx !== -1 ? this.sessions[idx] : undefined;
        if (idx !== -1) this.sessions.splice(idx, 1);
        this.syncedSessionKeys.delete(cleanId);
        const nowIso = new Date().toISOString();
        this.recordAudit(actor, 'DELETE_SESSION', 'Session', cleanId, target?.sessionId || cleanId, 'Permanently deleted', 'SUCCESS');
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: target?.clientSubmissionKey || '',
          sessionRecordId: cleanId,
          sessionId: target?.sessionId || cleanId,
          actorEmail: actor.email,
          operation: 'deleteSession',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.savePersistedWorkspace(true);
        return res;
      }

      const idx = this.sessions.findIndex((s) => s.sessionRecordId === cleanId);
      if (idx === -1) return { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' };

      const target = this.sessions[idx]!;
      const deletedDetailsCount = target.details.length;
      const nowIso = new Date().toISOString();
      this.sessions.splice(idx, 1);
      this.syncedSessionKeys.delete(target.sessionRecordId);

      const prevSummary = `Session ${target.sessionId} (${target.schoolName}, ${target.totalStudentsPresent} students, ${deletedDetailsCount} detail rows)`;
      this.recordAudit(actor, 'DELETE_SESSION', 'Session', cleanId, prevSummary, 'Permanently deleted', 'SUCCESS');
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: target.clientSubmissionKey || '',
        sessionRecordId: cleanId,
        sessionId: target.sessionId,
        actorEmail: actor.email,
        operation: 'deleteSession',
        attempt: 1,
        status: 'LOCAL_SANDBOX',
        errorMessage: '',
      });
      this.savePersistedWorkspace(true);
      return { ok: true, data: { deleted: true, deletedDetailsCount } };
    });
  }

  async bulkDeleteSessions(
    sessionRecordIds: string[],
  ): Promise<ApiResponse<{ deletedCount: number; deletedDetailsCount: number }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
      if (actor.role !== 'super_admin') {
        this.recordAudit(actor, 'BULK_DELETE_SESSIONS', 'Session', 'BULK', '', 'Unauthorized bulk delete attempt', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }
      if (!Array.isArray(sessionRecordIds)) {
        return { ok: false, code: 'INVALID_ID', error: 'sessionRecordIds must be an array.' };
      }
      const idSet = new Set(
        sessionRecordIds.map((id) => String(id || '').trim()).filter(Boolean),
      );
      if (idSet.size === 0) {
        return { ok: false, code: 'INVALID_ID', error: 'At least one sessionRecordId is required.' };
      }

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        let res: ApiResponse<{ deletedCount: number; deletedDetailsCount: number }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await deleteDirectSessions({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            sessionRecordIds: Array.from(idSet),
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{
            deletedCount: number;
            deletedDetailsCount: number;
          }>('bulkDeleteSessions', { sessionRecordIds: Array.from(idSet) });
        } else {
          res = await this.callOAuthSheetsPost<{
            deletedCount: number;
            deletedDetailsCount: number;
          }>('bulkDeleteSessions', { sessionRecordIds: Array.from(idSet) });
        }
        if (!res.ok) return res;
        this.sessions = this.sessions.filter((s) => !idSet.has(s.sessionRecordId));
        for (const id of idSet) this.syncedSessionKeys.delete(id);
        const nowIso = new Date().toISOString();
        this.recordAudit(
          actor,
          'BULK_DELETE_SESSIONS',
          'Session',
          'BULK',
          `${idSet.size} ID(s)`,
          `Deleted ${res.data?.deletedCount ?? idSet.size} session(s)`,
          'SUCCESS',
        );
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: nowIso,
          clientSubmissionKey: 'BULK_DELETE',
          sessionRecordId: String(res.data?.deletedCount ?? idSet.size),
          sessionId: 'BULK',
          actorEmail: actor.email,
          operation: 'bulkDeleteSessions',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.savePersistedWorkspace(true);
        return res;
      }

      const matched = this.sessions.filter((s) => idSet.has(s.sessionRecordId));
      if (matched.length === 0) {
        return { ok: false, code: 'NOT_FOUND', error: 'No matching session records found.' };
      }

      let deletedDetailsCount = 0;
      const matchedSessionIds: string[] = [];
      for (const s of matched) {
        deletedDetailsCount += s.details.length;
        matchedSessionIds.push(s.sessionId || s.sessionRecordId);
        this.syncedSessionKeys.delete(s.sessionRecordId);
      }

      this.sessions = this.sessions.filter((s) => !idSet.has(s.sessionRecordId));
      const nowIso = new Date().toISOString();
      const summaryIds =
        matchedSessionIds.slice(0, 10).join(', ') +
        (matchedSessionIds.length > 10 ? ` (+${matchedSessionIds.length - 10} more)` : '');
      this.recordAudit(
        actor,
        'BULK_DELETE_SESSIONS',
        'Session',
        'BULK',
        summaryIds,
        `Deleted ${matched.length} session(s) and ${deletedDetailsCount} detail row(s)`,
        'SUCCESS',
      );
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: 'BULK_DELETE',
        sessionRecordId: String(matched.length),
        sessionId: summaryIds,
        actorEmail: actor.email,
        operation: 'bulkDeleteSessions',
        attempt: 1,
        status: 'LOCAL_SANDBOX',
        errorMessage: '',
      });
      this.savePersistedWorkspace(true);
      return {
        ok: true,
        data: { deletedCount: matched.length, deletedDetailsCount },
      };
    });
  }

  async getSessionById(sessionRecordId: string): Promise<ApiResponse<SessionRecord>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    } else {
      const teamIntake = this.getActiveTeamIntakeForFacilitator();
      if (teamIntake && !this.sessions.some((s) => s.sessionRecordId === sessionRecordId)) {
        const remoteRes = await this.callTeamIntakePost<SessionRecord>('getSessionById', {
          sessionRecordId,
        });
        if (remoteRes.ok && remoteRes.data) {
          const syncedRec: SessionRecord = {
            ...remoteRes.data,
            syncStatus: 'SYNCED',
          };
          this.sessions.unshift(syncedRec);
          this.syncedSessionKeys.add(syncedRec.sessionRecordId);
          this.savePersistedWorkspace();
          return { ok: true, data: structuredClone(syncedRec) };
        }
        if (remoteRes.code !== 'NETWORK_ERROR') {
          return remoteRes;
        }
      }
    }
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
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    } else {
      const teamIntake = this.getActiveTeamIntakeForFacilitator();
      if (teamIntake) {
        const remoteItems: SessionRecord[] = [];
        let page = 1;
        let totalPages = 1;
        let fatalError: ApiResponse<PaginatedResult<SessionRecord>> | null = null;
        let remoteSucceeded = false;
        do {
          const remoteRes = await this.callTeamIntakePost<PaginatedResult<SessionRecord>>(
            'getMySessions',
            { filters: { includeArchived: true, page, pageSize: 100 } },
          );
          if (!remoteRes.ok || !remoteRes.data) {
            if (remoteRes.code !== 'NETWORK_ERROR') {
              fatalError = remoteRes;
            }
            break;
          }
          remoteSucceeded = true;
          remoteItems.push(
            ...remoteRes.data.items.map((item) => ({
              ...item,
              syncStatus: 'SYNCED' as const,
            })),
          );
          totalPages = Math.min(10, remoteRes.data.totalPages || 1);
          page++;
        } while (page <= totalPages);

        if (fatalError) {
          return fatalError;
        }

        if (remoteSucceeded) {
          const remoteIds = new Set(remoteItems.map((s) => s.sessionRecordId));
          const remoteKeys = new Set(
            remoteItems.map((s) => s.clientSubmissionKey).filter(Boolean),
          );
          for (const s of remoteItems) {
            if (s.sessionRecordId) this.syncedSessionKeys.add(s.sessionRecordId);
          }
          const preservedOtherUsers = this.sessions.filter(
            (s) => normalizeEmail(s.facilitatorEmail) !== actor.email,
          );
          const preservedLocalUnsyncedOwn = this.sessions.filter(
            (s) =>
              normalizeEmail(s.facilitatorEmail) === actor.email &&
              s.syncStatus === 'LOCAL_SANDBOX' &&
              !remoteIds.has(s.sessionRecordId) &&
              (!s.clientSubmissionKey || !remoteKeys.has(s.clientSubmissionKey)),
          );
          this.sessions = [...preservedLocalUnsyncedOwn, ...remoteItems, ...preservedOtherUsers];
          this.savePersistedWorkspace();
        }
      }
    }
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
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
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
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    }

    return {
      ok: true,
      data: computeDashboardAnalytics(this.sessions, filters, this.config),
    };
  }

  async getWorkspaceSyncPreview(): Promise<
    ApiResponse<{
      sessionsCount: number;
      unsyncedSessionsCount: number;
      schoolsCount: number;
      facilitatorsCount: number;
      districts: string[];
    }>
  > {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    const sessionsCount = this.sessions.length;
    const unsyncedSessionsCount = this.sessions.filter(
      (s) => s.syncStatus !== 'SYNCED' || !this.syncedSessionKeys.has(s.sessionRecordId),
    ).length;
    const schoolsCount = this.schools.length;
    const facilitatorsCount = this.users.filter(
      (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
    ).length;
    const districts = Array.from(
      new Set(this.sessions.map((s) => (s.district || '').trim()).filter(Boolean)),
    ).sort();
    return {
      ok: true,
      data: {
        sessionsCount,
        unsyncedSessionsCount,
        schoolsCount,
        facilitatorsCount,
        districts,
      },
    };
  }

  async getSchoolByUdise(udiseCode: string): Promise<ApiResponse<SchoolRecord | null>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    const cleanUdise = udiseCode.trim();
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    }
    const found = this.schools.find((s) => s.udiseCode === cleanUdise) ?? null;
    if (!found && cleanUdise) {
      const teamIntake = this.getActiveTeamIntakeForFacilitator();
      if (teamIntake) {
        const remoteRes = await this.callTeamIntakePost<SchoolRecord | null>('getSchoolByUdise', {
          udiseCode: cleanUdise,
        });
        if (remoteRes.ok && remoteRes.data) {
          this.schools.push(remoteRes.data);
          this.savePersistedWorkspace();
          return { ok: true, data: structuredClone(remoteRes.data) };
        }
      }
    }
    return { ok: true, data: found ? structuredClone(found) : null };
  }

  async searchSchools(
    query: string,
    includeInactive = false,
  ): Promise<ApiResponse<SchoolRecord[]>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'SEARCH_SCHOOLS', 'School', 'DIRECTORY', '', 'Unauthorized school directory query', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    }
    const q = query.trim().toLowerCase();
    const matches = this.schools.filter((s) => {
      if (!includeInactive && !s.active) return false;
      if (!q) return true;
      return (
        s.schoolName.toLowerCase().includes(q) ||
        s.udiseCode.includes(q) ||
        (s.district || '').toLowerCase().includes(q) ||
        (s.pinCode || '').includes(q)
      );
    });
    return { ok: true, data: structuredClone(matches.slice(0, 200)) };
  }

  async updateSchool(school: {
    schoolRecordId: string;
    schoolName: string;
    udiseCode: string;
    schoolType: string;
    state?: string;
    district: string;
    pinCode: string;
    active: boolean;
  }): Promise<ApiResponse<SchoolRecord>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        this.recordAudit(
          actor,
          'UPDATE_SCHOOL',
          'School',
          school.schoolRecordId || school.udiseCode,
          '',
          'Unauthorized school update attempt',
          'DENIED',
        );
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      const schoolRecordId = String(school.schoolRecordId || '').trim();
      const schoolName = String(school.schoolName || '').trim();
      const udiseCode = String(school.udiseCode || '').trim();
      const schoolType = String(school.schoolType || '').trim();
      const district = String(school.district || '').trim();
      const pinCode = String(school.pinCode || '').trim();
      const active = school.active !== false;

      if (!schoolRecordId) return { ok: false, code: 'INVALID_ID', error: 'schoolRecordId is required.' };
      if (!schoolName) return { ok: false, code: 'VALIDATION_FAILED', error: 'School name is required.' };
      if (!/^\d{11}$/.test(udiseCode)) {
        return { ok: false, code: 'VALIDATION_FAILED', error: 'UDISE code must be exactly 11 digits.' };
      }
      if (!/^\d{6}$/.test(pinCode)) {
        return { ok: false, code: 'VALIDATION_FAILED', error: 'PIN code must be exactly 6 digits.' };
      }
      if (!schoolType) {
        return { ok: false, code: 'VALIDATION_FAILED', error: 'School type is required.' };
      }
      if (!this.config.allowedDistricts.includes(district)) {
        return {
          ok: false,
          code: 'VALIDATION_FAILED',
          error: 'District must be one of the approved programme districts.',
        };
      }

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        const schoolPayload = {
          schoolRecordId,
          schoolName,
          udiseCode,
          schoolType,
          state: String(school.state || this.config.stateName || 'Tamil Nadu').trim(),
          district,
          pinCode,
          active,
        };
        let res: ApiResponse<SchoolRecord>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await updateDirectSchool({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            school: schoolPayload,
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<SchoolRecord>('updateSchool', {
            school: schoolPayload,
          });
        } else {
          res = await this.callOAuthSheetsPost<SchoolRecord>('updateSchool', {
            school: schoolPayload,
          });
        }
        if (!res.ok || !res.data) return res;
        const idx = this.schools.findIndex((s) => s.schoolRecordId === schoolRecordId);
        if (idx !== -1) this.schools[idx] = res.data;
        else this.schools.push(res.data);
        this.recordAudit(
          actor,
          'UPDATE_SCHOOL',
          'School',
          schoolRecordId,
          '',
          `${udiseCode} (${schoolName}, active=${active})`,
          'SUCCESS',
        );
        return res;
      }

      const target = this.schools.find((s) => s.schoolRecordId === schoolRecordId);
      if (!target) {
        return { ok: false, code: 'NOT_FOUND', error: 'School record not found.' };
      }

      const conflicting = this.schools.find(
        (s) => s.schoolRecordId !== schoolRecordId && s.udiseCode === udiseCode,
      );
      if (conflicting) {
        return {
          ok: false,
          code: 'DUPLICATE_UDISE',
          error: `UDISE ${udiseCode} is already assigned to "${conflicting.schoolName}".`,
        };
      }

      const prevSummary = `${target.udiseCode} (${target.schoolName}, active=${target.active})`;
      const nowIso = new Date().toISOString();
      target.schoolName = schoolName;
      target.udiseCode = udiseCode;
      target.schoolType = schoolType;
      target.state = String(school.state || target.state || this.config.stateName || 'Tamil Nadu').trim();
      target.district = district;
      target.pinCode = pinCode;
      target.active = active;
      target.updatedAt = nowIso;

      this.recordAudit(
        actor,
        'UPDATE_SCHOOL',
        'School',
        target.schoolRecordId,
        prevSummary,
        `${target.udiseCode} (${target.schoolName}, active=${target.active})`,
        'SUCCESS',
      );
      return { ok: true, data: structuredClone(target) };
    });
  }

  async deleteSchool(
    schoolRecordId: string,
  ): Promise<ApiResponse<{ deleted: boolean; udiseCode: string }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        this.recordAudit(
          actor,
          'DELETE_SCHOOL',
          'School',
          schoolRecordId,
          '',
          'Unauthorized school removal attempt',
          'DENIED',
        );
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }
      const cleanId = String(schoolRecordId || '').trim();
      if (!cleanId) return { ok: false, code: 'INVALID_ID', error: 'schoolRecordId is required.' };

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        let res: ApiResponse<{ deleted: boolean; udiseCode: string }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await deleteDirectSchool({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            schoolRecordId: cleanId,
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{ deleted: boolean; udiseCode: string }>(
            'deleteSchool',
            { schoolRecordId: cleanId },
          );
        } else {
          res = await this.callOAuthSheetsPost<{ deleted: boolean; udiseCode: string }>(
            'deleteSchool',
            { schoolRecordId: cleanId },
          );
        }
        if (!res.ok) return res;
        this.schools = this.schools.filter(
          (s) => s.schoolRecordId !== cleanId && s.udiseCode !== cleanId,
        );
        this.recordAudit(
          actor,
          'DELETE_SCHOOL',
          'School',
          cleanId,
          res.data?.udiseCode || cleanId,
          'Removed from Schools directory',
          'SUCCESS',
        );
        this.savePersistedWorkspace(true);
        return res;
      }

      const idx = this.schools.findIndex(
        (s) => s.schoolRecordId === cleanId || s.udiseCode === cleanId,
      );
      if (idx === -1) {
        return { ok: false, code: 'NOT_FOUND', error: 'School record not found.' };
      }

      const prev = this.schools[idx]!;
      this.schools.splice(idx, 1);
      this.recordAudit(
        actor,
        'DELETE_SCHOOL',
        'School',
        prev.schoolRecordId || prev.udiseCode,
        `${prev.udiseCode} (${prev.schoolName})`,
        'Removed from Schools directory',
        'SUCCESS',
      );
      this.savePersistedWorkspace(true);
      return { ok: true, data: { deleted: true, udiseCode: prev.udiseCode } };
    });
  }

  async listManagedUsers(): Promise<ApiResponse<ManagedUser[]>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'LIST_USERS', 'User', 'ALL', '', 'Unauthorized user directory access', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
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

    if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
      const userPayload = {
        ...input,
        name: input.name.trim(),
        email: emailClean,
      };
      let res: ApiResponse<ManagedUser>;
      if (this.isDirectSheetsActive()) {
        const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
        const sheetId =
          this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
        if (!directToken || !sheetId) {
          return {
            ok: false,
            code: 'OAUTH_EXPIRED',
            error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
          };
        }
        res = await manageDirectUser({
          spreadsheetId: sheetId,
          accessToken: directToken.accessToken,
          actorEmail: actor.email,
          user: userPayload,
        });
      } else if (this.isAppsScriptBridgeActive()) {
        res = await this.callAppsScriptBridgePost<ManagedUser>('manageUser', {
          user: userPayload,
        });
      } else {
        res = await this.callOAuthSheetsPost<ManagedUser>('manageUser', {
          user: userPayload,
        });
      }
      if (!res.ok || !res.data) return res;
      const idx = this.users.findIndex(
        (u) => u.userId === res.data!.userId || normalizeEmail(u.email) === emailClean,
      );
      if (idx !== -1) this.users[idx] = res.data;
      else this.users.push(res.data);
      this.recordAudit(
        actor,
        idx !== -1 ? 'UPDATE_USER' : 'CREATE_USER',
        'User',
        res.data.userId,
        '',
        `${res.data.email} (facilitator, status=${res.data.status})`,
        'SUCCESS',
      );
      return res;
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

  async deleteUser(userIdOrEmail: string): Promise<ApiResponse<{ deleted: boolean; email: string }>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        this.recordAudit(actor, 'DELETE_USER', 'User', userIdOrEmail, '', 'Unauthorized user removal attempt', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      const identifier = String(userIdOrEmail || '').trim();
      if (!identifier) {
        return { ok: false, code: 'INVALID_USER', error: 'userIdOrEmail is required.' };
      }

      const cleanLower = normalizeEmail(identifier);
      const isProtectedMatch = INITIAL_SUPER_ADMINS.some(
        (sa) => sa.email === cleanLower || sa.userId === identifier,
      );
      if (isProtectedMatch) {
        this.recordAudit(
          actor,
          'DELETE_USER',
          'User',
          identifier,
          '',
          'Attempted deletion of protected initial Super Administrator',
          'DENIED',
        );
        return {
          ok: false,
          code: 'PROTECTED_ACCOUNT',
          error:
            'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.',
        };
      }

      if (this.isDirectSheetsActive() || this.isAppsScriptBridgeActive() || this.isOAuthSheetsActive()) {
        let res: ApiResponse<{ deleted: boolean; email: string }>;
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (!directToken || !sheetId) {
            return {
              ok: false,
              code: 'OAUTH_EXPIRED',
              error: 'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
            };
          }
          res = await deleteDirectUser({
            spreadsheetId: sheetId,
            accessToken: directToken.accessToken,
            actorEmail: actor.email,
            userIdOrEmail: identifier,
          });
        } else if (this.isAppsScriptBridgeActive()) {
          res = await this.callAppsScriptBridgePost<{ deleted: boolean; email: string }>(
            'deleteUser',
            { userIdOrEmail: identifier },
          );
        } else {
          res = await this.callOAuthSheetsPost<{ deleted: boolean; email: string }>(
            'deleteUser',
            { userIdOrEmail: identifier },
          );
        }
        if (!res.ok) return res;
        this.users = this.users.filter(
          (u) => u.userId !== identifier && normalizeEmail(u.email) !== cleanLower,
        );
        this.recordAudit(
          actor,
          'DELETE_USER',
          'User',
          identifier,
          res.data?.email || cleanLower,
          'Removed from Facilitators directory',
          'SUCCESS',
        );
        return res;
      }

      const idx = this.users.findIndex(
        (u) => u.userId === identifier || normalizeEmail(u.email) === cleanLower,
      );
      if (idx === -1) {
        return { ok: false, code: 'NOT_FOUND', error: 'Facilitator user record not found.' };
      }

      const matched = this.users[idx]!;
      if (isAllowlistedSuperAdmin(matched.email)) {
        this.recordAudit(
          actor,
          'DELETE_USER',
          'User',
          matched.email,
          '',
          'Attempted deletion of protected initial Super Administrator',
          'DENIED',
        );
        return {
          ok: false,
          code: 'PROTECTED_ACCOUNT',
          error:
            'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.',
        };
      }

      this.users.splice(idx, 1);
      this.recordAudit(
        actor,
        'DELETE_USER',
        'User',
        matched.userId || matched.email,
        `${matched.email} (${matched.name}, status=${matched.status})`,
        'Removed from Facilitators directory',
        'SUCCESS',
      );
      return { ok: true, data: { deleted: true, email: matched.email } };
    });
  }

  async getAuditLogs(page = 1, pageSize = 25): Promise<ApiResponse<PaginatedResult<AuditLogEntry>>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'VIEW_AUDIT_LOG', 'Audit', 'ALL', '', 'Unauthorized audit access', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.isAppsScriptBridgeActive()) {
      const remoteRes = await this.callAppsScriptBridgePost<PaginatedResult<AuditLogEntry>>(
        'getAuditLogs',
        { page, pageSize },
      );
      if (remoteRes.ok && remoteRes.data) {
        if (page === 1) this.auditLogs = remoteRes.data.items;
        return remoteRes;
      }
    }
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    }
    return { ok: true, data: this.paginate(this.auditLogs, page, pageSize) };
  }

  async getSyncLogs(page = 1, pageSize = 25): Promise<ApiResponse<PaginatedResult<SyncLogEntry>>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'VIEW_SYNC_LOG', 'SyncLog', 'ALL', '', 'Unauthorized sync log access', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.isAppsScriptBridgeActive()) {
      const remoteRes = await this.callAppsScriptBridgePost<PaginatedResult<SyncLogEntry>>(
        'getSyncLogs',
        { page, pageSize },
      );
      if (remoteRes.ok && remoteRes.data) {
        if (page === 1) this.syncLogs = remoteRes.data.items;
        return remoteRes;
      }
    }
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    }
    return { ok: true, data: this.paginate(this.syncLogs, page, pageSize) };
  }

  async logExportEvent(scope: string, rowCount: number, format: string): Promise<ApiResponse<{ logged: boolean }>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'EXPORT_XLSX', 'Export', scope, '', 'Unauthorized export attempt', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required for exports.' };
    }
    if (this.isDirectSheetsActive()) {
      const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
      const sheetId =
        this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
      if (directToken && sheetId) {
        const res = await logDirectExportEvent({
          spreadsheetId: sheetId,
          accessToken: directToken.accessToken,
          actorEmail: actor.email,
          scope,
          rowCount,
          format,
        });
        if (res.ok) {
          this.recordAudit(actor, 'EXPORT_XLSX', 'Export', scope, '', `${rowCount} rows (${format})`, 'SUCCESS');
        }
        return res;
      }
    }
    if (this.isAppsScriptBridgeActive()) {
      const res = await this.callAppsScriptBridgePost<{ logged: boolean }>('logExportEvent', {
        scope,
        rowCount,
        format,
      });
      if (res.ok) {
        this.recordAudit(actor, 'EXPORT_XLSX', 'Export', scope, '', `${rowCount} rows (${format})`, 'SUCCESS');
      }
      return res;
    }
    if (this.isOAuthSheetsActive()) {
      const res = await this.callOAuthSheetsPost<{ logged: boolean }>('logExportEvent', {
        scope,
        rowCount,
        format,
      });
      if (res.ok) {
        this.recordAudit(actor, 'EXPORT_XLSX', 'Export', scope, '', `${rowCount} rows (${format})`, 'SUCCESS');
      }
      return res;
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

  private async fetchOAuthSheetsJson<T>(
    targetUrl: string,
    init: RequestInit = {},
  ): Promise<ApiResponse<T> | null> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      const res = await fetch(targetUrl, {
        ...init,
        credentials: 'include',
        signal: controller?.signal,
      });
      const rawText = await res.text();
      const trimmed = rawText.trim();
      if (!trimmed || trimmed.startsWith('<')) return null;
      const parsed = JSON.parse(trimmed) as ApiResponse<T>;
      return parsed && typeof parsed.ok === 'boolean' ? parsed : null;
    } catch {
      return null;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  async getSheetsConnection(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      this.recordAudit(actor, 'VIEW_SHEETS_CONN', 'Configuration', 'SHEETS', '', 'Unauthorized sheets connection read', 'DENIED');
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    const localConn = structuredClone(this.loadPersistedSheetsConnection());
    const directClientConfigured = Boolean(loadDirectGoogleClientId());
    const bridgeConfigured = Boolean(loadAppsScriptBridgeConfig());

    if (localConn.connectionProvider === 'direct_browser' && localConn.connected) {
      return {
        ok: true,
        data: {
          ...localConn,
          oauthConfigured: Boolean(directClientConfigured || localConn.oauthConfigured),
        },
      };
    }

    if (
      (localConn.connectionProvider === 'apps_script' || localConn.authMethod === 'apps_script') &&
      localConn.connected &&
      bridgeConfigured
    ) {
      const bridgeRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
        'getSheetsConnection',
        {},
      );
      if (bridgeRes.ok && bridgeRes.data) {
        if (bridgeRes.data.connected && bridgeRes.data.spreadsheetId) {
          const withProvider: GoogleSheetsConnectionState = {
            ...bridgeRes.data,
            authMethod: 'apps_script',
            connectionProvider: 'apps_script',
            oauthConfigured: Boolean(
              bridgeRes.data.oauthConfigured || directClientConfigured || bridgeConfigured,
            ),
          };
          this.savePersistedSheetsConnection(withProvider);
          return { ok: true, data: withProvider };
        }
        const disconnected = buildDisconnectedState(
          'local_sandbox',
          Boolean(this.sheetsBackendUrl || directClientConfigured || bridgeConfigured),
        );
        this.savePersistedSheetsConnection(disconnected);
        this.invalidateWorkspaceCache();
        return { ok: true, data: disconnected };
      }
      return {
        ok: true,
        data: {
          ...localConn,
          oauthConfigured: Boolean(localConn.oauthConfigured || directClientConfigured || bridgeConfigured),
        },
      };
    }

    if (this.sheetsBackendUrl) {
      const parsed = await this.fetchOAuthSheetsJson<
        GoogleSheetsConnectionState & { oauthError?: string }
      >(`${this.sheetsBackendUrl.replace(/\/$/, '')}?action=status`);
      if (parsed?.ok && parsed.data) {
        if (parsed.data.connected) {
          const withProvider: GoogleSheetsConnectionState = {
            ...parsed.data,
            connectionProvider: parsed.data.connectionProvider || 'sheets_backend',
          };
          this.savePersistedSheetsConnection(withProvider);
          return { ok: true, data: withProvider };
        }
        if (
          (parsed.data.oauthError === 'OAUTH_REFRESH_FAILED' ||
            (parsed.data.oauthConfigured && !parsed.data.connected)) &&
          localConn.authMethod === 'google_oauth'
        ) {
          const disconnected = buildDisconnectedState(
            'local_sandbox',
            Boolean(parsed.data.oauthConfigured || directClientConfigured || bridgeConfigured),
          );
          this.savePersistedSheetsConnection(disconnected);
          this.invalidateWorkspaceCache();
          return { ok: true, data: disconnected };
        }
        return {
          ok: true,
          data: {
            ...localConn,
            oauthConfigured: Boolean(
              parsed.data.oauthConfigured || directClientConfigured || bridgeConfigured,
            ),
            connectedAccount:
              localConn.connectedAccount || parsed.data.connectedAccount || '',
          },
        };
      }
    }
    return {
      ok: true,
      data: {
        ...localConn,
        oauthConfigured: Boolean(
          localConn.oauthConfigured || directClientConfigured || bridgeConfigured,
        ),
      },
    };
  }

  async listGoogleSpreadsheets(): Promise<ApiResponse<GoogleSpreadsheetSummary[]>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin') {
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.isDirectSheetsActive()) {
      const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
      if (directToken) {
        return listDirectGoogleSpreadsheets(directToken.accessToken);
      }
    }
    if (this.sheetsBackendUrl) {
      const parsed = await this.fetchOAuthSheetsJson<GoogleSpreadsheetSummary[]>(
        this.sheetsBackendUrl.replace(/\/$/, ''),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'listSpreadsheets' }),
        },
      );
      if (parsed?.ok && parsed.data) {
        return parsed;
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
    directClientId?: string;
    forceDirectOAuth?: boolean;
    appsScriptUrl?: string;
    syncKey?: string;
    forceAppsScriptBridge?: boolean;
  }): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        this.recordAudit(actor, 'CONNECT_GOOGLE_SHEET', 'Configuration', 'SHEETS', '', 'Unauthorized connection attempt', 'DENIED');
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      const wantsDirect = Boolean(params.directClientId?.trim() || params.forceDirectOAuth);
      if (wantsDirect) {
        const tokRes = await this.resolveDirectClientIdAndToken(
          actor.email,
          params.directClientId,
        );
        if (!tokRes.ok || !tokRes.data) {
          return { ok: false, code: tokRes.code, error: tokRes.error };
        }
        const connRes = await connectDirectGoogleSheet({
          accessToken: tokRes.data.accessToken,
          spreadsheetUrlOrId: params.spreadsheetUrlOrId,
          spreadsheetName: params.spreadsheetName,
          initializeSchema: params.initializeSchema,
          actorEmail: tokRes.data.email || actor.email,
        });
        if (!connRes.ok || !connRes.data) {
          return connRes;
        }
        const syncRes = await syncWorkspaceToDirectGoogleSheet({
          spreadsheetId: connRes.data.spreadsheetId,
          accessToken: tokRes.data.accessToken,
          actorEmail: tokRes.data.email || actor.email,
          sessions: this.sessions,
          schools: this.schools,
          users: this.users,
          config: this.config,
        });
        const finalConn: GoogleSheetsConnectionState = {
          ...connRes.data,
          connectionProvider: 'direct_browser',
          ...(syncRes.ok && syncRes.data
            ? {
                lastSyncedAt: syncRes.data.syncedAt,
                lastSyncStatus: 'SYNCED' as const,
                lastSyncMessage: syncRes.data.message,
              }
            : {}),
        };
        if (syncRes.ok) {
          for (const s of this.sessions) {
            s.syncStatus = 'SYNCED';
            this.syncedSessionKeys.add(s.sessionRecordId);
          }
        }
        this.invalidateWorkspaceCache();
        this.savePersistedSheetsConnection(finalConn);
        await this.ensureWorkspaceHydrated(true);
        this.recordAudit(
          actor,
          'CONNECT_GOOGLE_SHEET',
          'Configuration',
          finalConn.spreadsheetId,
          '',
          `Connected "${finalConn.spreadsheetName}" directly via Google OAuth`,
          'SUCCESS',
        );
        this.savePersistedWorkspace();
        return { ok: true, data: structuredClone(finalConn) };
      }

      const savedBridge = this.getActiveBridgeConfig();
      const persistedConn = this.loadPersistedSheetsConnection();
      const wantsBridge = Boolean(
        params.forceAppsScriptBridge ||
          params.appsScriptUrl?.trim() ||
          params.syncKey?.trim() ||
          (savedBridge &&
            !this.sheetsBackendUrl &&
            persistedConn.connectionProvider !== 'direct_browser' &&
            persistedConn.connectionProvider !== 'sheets_backend'),
      );
      if (wantsBridge) {
        const urlCheck = validateAppsScriptWebAppUrl(
          (params.appsScriptUrl ?? '').trim() || savedBridge?.appsScriptUrl || '',
        );
        if (!urlCheck.valid) {
          return {
            ok: false,
            code: 'INVALID_URL',
            error: urlCheck.error || 'Enter a valid Google Apps Script Web App URL (/exec).',
          };
        }
        const keyCheck = validateAppsScriptSyncKey(
          (params.syncKey ?? '').trim() || savedBridge?.syncKey || '',
        );
        if (!keyCheck.valid) {
          return {
            ok: false,
            code: 'INVALID_SYNC_KEY',
            error: keyCheck.error || 'Enter your Sync Bridge Passphrase (minimum 16 characters).',
          };
        }

        const explicitBridge = {
          appsScriptUrl: urlCheck.normalized,
          syncKey: keyCheck.normalized,
          actorEmail: actor.email,
        };
        const connRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
          'connectGoogleSheet',
          {
            spreadsheetUrlOrId: params.spreadsheetUrlOrId || DEFAULT_TARGET_SPREADSHEET_ID,
            initializeSchema: params.initializeSchema !== false,
          },
          explicitBridge,
        );
        if (!connRes.ok || !connRes.data) {
          return connRes;
        }

        saveAppsScriptBridgeConfig({
          appsScriptUrl: urlCheck.normalized,
          syncKey: keyCheck.normalized,
          configuredBy: actor.email,
        });

        const syncRes = await this.callAppsScriptBridgePost<SheetsSyncSummary>(
          'syncAllToGoogleSheet',
          {
            sessions: this.sessions,
            schools: this.schools,
            facilitators: this.users.filter(
              (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
            ),
            configuration: this.config,
          },
          explicitBridge,
        );

        const finalConn: GoogleSheetsConnectionState = {
          ...connRes.data,
          authMethod: 'apps_script',
          connectionProvider: 'apps_script',
          connectedAccount: connRes.data.connectedAccount || actor.email,
          ...(syncRes.ok && syncRes.data
            ? {
                lastSyncedAt: syncRes.data.syncedAt,
                lastSyncStatus: 'SYNCED' as const,
                lastSyncMessage: syncRes.data.message,
              }
            : {}),
        };
        if (syncRes.ok) {
          for (const s of this.sessions) {
            s.syncStatus = 'SYNCED';
            this.syncedSessionKeys.add(s.sessionRecordId);
          }
        }
        this.invalidateWorkspaceCache();
        this.savePersistedSheetsConnection(finalConn);
        await this.ensureWorkspaceHydrated(true);
        this.recordAudit(
          actor,
          'CONNECT_GOOGLE_SHEET',
          'Configuration',
          finalConn.spreadsheetId,
          '',
          `Connected "${finalConn.spreadsheetName}" via Apps Script Sync Bridge`,
          'SUCCESS',
        );
        this.savePersistedWorkspace();
        return { ok: true, data: structuredClone(finalConn) };
      }

      if (this.sheetsBackendUrl) {
        const parsed = await this.fetchOAuthSheetsJson<GoogleSheetsConnectionState>(
          this.sheetsBackendUrl.replace(/\/$/, ''),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'connect', ...params }),
          },
        );
        if (parsed) {
          if (parsed.ok && parsed.data) {
            const withProvider: GoogleSheetsConnectionState = {
              ...parsed.data,
              connectionProvider: parsed.data.connectionProvider || 'sheets_backend',
            };
            this.invalidateWorkspaceCache();
            this.savePersistedSheetsConnection(withProvider);
            return { ok: true, data: withProvider };
          }
          if (
            parsed.code !== 'OAUTH_REQUIRED' &&
            parsed.code !== 'OAUTH_EXPIRED' &&
            parsed.code !== 'OAUTH_REFRESH_FAILED' &&
            parsed.code !== 'SERVER_MISCONFIGURED'
          ) {
            return parsed;
          }
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
        connectionProvider: 'local_sandbox',
        oauthConfigured: Boolean(
          this.sheetsBackendUrl || loadDirectGoogleClientId() || loadAppsScriptBridgeConfig(),
        ),
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
        lastSyncMessage: `${this.sessions.length} session(s) saved locally on this device · activate Live Sync to write rows into Google Sheets`,
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
    directClientId?: string;
    forceDirectOAuth?: boolean;
    appsScriptUrl?: string;
    syncKey?: string;
    forceAppsScriptBridge?: boolean;
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

      const wantsDirect = Boolean(params.directClientId?.trim() || params.forceDirectOAuth);
      if (wantsDirect) {
        const tokRes = await this.resolveDirectClientIdAndToken(
          actor.email,
          params.directClientId,
        );
        if (!tokRes.ok || !tokRes.data) {
          return { ok: false, code: tokRes.code, error: tokRes.error };
        }
        const createRes = await createDirectGoogleSheetWithSchema({
          accessToken: tokRes.data.accessToken,
          title: cleanTitle,
          actorEmail: tokRes.data.email || actor.email,
        });
        if (!createRes.ok || !createRes.data) {
          return createRes;
        }
        const syncRes = await syncWorkspaceToDirectGoogleSheet({
          spreadsheetId: createRes.data.spreadsheetId,
          accessToken: tokRes.data.accessToken,
          actorEmail: tokRes.data.email || actor.email,
          sessions: this.sessions,
          schools: this.schools,
          users: this.users,
          config: this.config,
        });
        const finalConn: GoogleSheetsConnectionState = {
          ...createRes.data,
          connectionProvider: 'direct_browser',
          ...(syncRes.ok && syncRes.data
            ? {
                lastSyncedAt: syncRes.data.syncedAt,
                lastSyncStatus: 'SYNCED' as const,
                lastSyncMessage: syncRes.data.message,
              }
            : {}),
        };
        if (syncRes.ok) {
          for (const s of this.sessions) {
            s.syncStatus = 'SYNCED';
            this.syncedSessionKeys.add(s.sessionRecordId);
          }
        }
        this.workspaceHydratedForSheetId = finalConn.spreadsheetId;
        this.savePersistedSheetsConnection(finalConn);
        this.recordAudit(
          actor,
          'CREATE_GOOGLE_SHEET',
          'Configuration',
          finalConn.spreadsheetId,
          '',
          `Created "${cleanTitle}" and pushed ${this.sessions.length} session(s) directly via Google OAuth`,
          'SUCCESS',
        );
        this.savePersistedWorkspace();
        return { ok: true, data: structuredClone(finalConn) };
      }

      const savedBridge = this.getActiveBridgeConfig();
      const persistedConn = this.loadPersistedSheetsConnection();
      const wantsBridge = Boolean(
        params.forceAppsScriptBridge ||
          params.appsScriptUrl?.trim() ||
          params.syncKey?.trim() ||
          (savedBridge &&
            !this.sheetsBackendUrl &&
            persistedConn.connectionProvider !== 'direct_browser' &&
            persistedConn.connectionProvider !== 'sheets_backend'),
      );
      if (wantsBridge) {
        const urlCheck = validateAppsScriptWebAppUrl(
          (params.appsScriptUrl ?? '').trim() || savedBridge?.appsScriptUrl || '',
        );
        if (!urlCheck.valid) {
          return {
            ok: false,
            code: 'INVALID_URL',
            error: urlCheck.error || 'Enter a valid Google Apps Script Web App URL (/exec).',
          };
        }
        const keyCheck = validateAppsScriptSyncKey(
          (params.syncKey ?? '').trim() || savedBridge?.syncKey || '',
        );
        if (!keyCheck.valid) {
          return {
            ok: false,
            code: 'INVALID_SYNC_KEY',
            error: keyCheck.error || 'Enter your Sync Bridge Passphrase (minimum 16 characters).',
          };
        }

        const explicitBridge = {
          appsScriptUrl: urlCheck.normalized,
          syncKey: keyCheck.normalized,
          actorEmail: actor.email,
        };
        const createRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
          'createGoogleSheet',
          { title: cleanTitle },
          explicitBridge,
        );
        if (!createRes.ok || !createRes.data) {
          return createRes;
        }

        saveAppsScriptBridgeConfig({
          appsScriptUrl: urlCheck.normalized,
          syncKey: keyCheck.normalized,
          configuredBy: actor.email,
        });

        const syncRes = await this.callAppsScriptBridgePost<SheetsSyncSummary>(
          'syncAllToGoogleSheet',
          {
            sessions: this.sessions,
            schools: this.schools,
            facilitators: this.users.filter(
              (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
            ),
            configuration: this.config,
          },
          explicitBridge,
        );

        const finalConn: GoogleSheetsConnectionState = {
          ...createRes.data,
          authMethod: 'apps_script',
          connectionProvider: 'apps_script',
          connectedAccount: createRes.data.connectedAccount || actor.email,
          ...(syncRes.ok && syncRes.data
            ? {
                lastSyncedAt: syncRes.data.syncedAt,
                lastSyncStatus: 'SYNCED' as const,
                lastSyncMessage: syncRes.data.message,
              }
            : {}),
        };
        if (syncRes.ok) {
          for (const s of this.sessions) {
            s.syncStatus = 'SYNCED';
            this.syncedSessionKeys.add(s.sessionRecordId);
          }
        }
        this.workspaceHydratedForSheetId = finalConn.spreadsheetId;
        this.savePersistedSheetsConnection(finalConn);
        this.recordAudit(
          actor,
          'CREATE_GOOGLE_SHEET',
          'Configuration',
          finalConn.spreadsheetId,
          '',
          `Created "${cleanTitle}" and pushed ${this.sessions.length} session(s) via Apps Script Sync Bridge`,
          'SUCCESS',
        );
        this.savePersistedWorkspace();
        return { ok: true, data: structuredClone(finalConn) };
      }

      if (this.sheetsBackendUrl) {
        const parsed = await this.fetchOAuthSheetsJson<GoogleSheetsConnectionState>(
          this.sheetsBackendUrl.replace(/\/$/, ''),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create', title: cleanTitle }),
          },
        );
        if (parsed) {
          if (parsed.ok && parsed.data) {
            const withProvider: GoogleSheetsConnectionState = {
              ...parsed.data,
              connectionProvider: parsed.data.connectionProvider || 'sheets_backend',
            };
            this.invalidateWorkspaceCache();
            this.savePersistedSheetsConnection(withProvider);
            return { ok: true, data: withProvider };
          }
          if (
            parsed.code !== 'OAUTH_REQUIRED' &&
            parsed.code !== 'OAUTH_EXPIRED' &&
            parsed.code !== 'OAUTH_REFRESH_FAILED' &&
            parsed.code !== 'SERVER_MISCONFIGURED'
          ) {
            return parsed;
          }
        }
      }

      const newId = `SANDBOX_SHEET_${generateUuid().slice(0, 12)}`;
      const nowIso = new Date().toISOString();
      const account = (params.googleAccount || actor.email).trim().toLowerCase();
      const nextState: GoogleSheetsConnectionState = {
        connected: true,
        authMethod: 'local_sandbox',
        connectionProvider: 'local_sandbox',
        oauthConfigured: Boolean(
          this.sheetsBackendUrl || loadDirectGoogleClientId() || loadAppsScriptBridgeConfig(),
        ),
        connectedAccount: account,
        spreadsheetId: newId,
        spreadsheetName: cleanTitle,
        spreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
        connectedAt: nowIso,
        connectedBy: actor.email,
        lastSyncedAt: nowIso,
        lastSyncStatus: 'SYNCED',
        lastSyncMessage: `Configured "${cleanTitle}" (${DEFAULT_SCHEMA_TABS.length} tabs) locally on this device · activate Live Sync to create in Google Drive`,
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

      const prev = this.loadPersistedSheetsConnection();
      clearDirectGoogleSheetsToken();

      if (
        (prev.connectionProvider === 'apps_script' || prev.authMethod === 'apps_script') &&
        this.getActiveBridgeConfig()
      ) {
        await this.callAppsScriptBridgePost('disconnectGoogleSheet', {});
      }

      if (
        this.sheetsBackendUrl &&
        prev.connectionProvider !== 'direct_browser' &&
        prev.connectionProvider !== 'apps_script'
      ) {
        await this.fetchOAuthSheetsJson(this.sheetsBackendUrl.replace(/\/$/, ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect' }),
        });
      }

      const next = buildDisconnectedState(
        'local_sandbox',
        Boolean(this.sheetsBackendUrl || loadDirectGoogleClientId() || loadAppsScriptBridgeConfig()),
      );
      this.invalidateWorkspaceCache();
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

  async syncAllToGoogleSheet(opts?: {
    directClientId?: string;
    forceDirectOAuth?: boolean;
    appsScriptUrl?: string;
    syncKey?: string;
    forceAppsScriptBridge?: boolean;
  }): Promise<ApiResponse<SheetsSyncSummary>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin') {
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      const conn = this.loadPersistedSheetsConnection();
      const useDirect = Boolean(
        opts?.forceDirectOAuth ||
          opts?.directClientId?.trim() ||
          conn.connectionProvider === 'direct_browser',
      );

      if (useDirect) {
        if (!conn.connected || !conn.spreadsheetId) {
          return {
            ok: false,
            code: 'NOT_CONNECTED',
            error: 'Connect or create a Google Sheet before pushing programme data.',
          };
        }
        const tokRes = await this.resolveDirectClientIdAndToken(
          actor.email,
          opts?.directClientId,
        );
        if (!tokRes.ok || !tokRes.data) {
          return { ok: false, code: tokRes.code, error: tokRes.error };
        }
        const syncRes = await syncWorkspaceToDirectGoogleSheet({
          spreadsheetId: conn.spreadsheetId,
          accessToken: tokRes.data.accessToken,
          actorEmail: tokRes.data.email || actor.email,
          sessions: this.sessions,
          schools: this.schools,
          users: this.users,
          config: this.config,
        });
        if (!syncRes.ok || !syncRes.data) {
          return { ok: false, code: syncRes.code, error: syncRes.error };
        }
        for (const s of this.sessions) {
          s.syncStatus = 'SYNCED';
          this.syncedSessionKeys.add(s.sessionRecordId);
        }
        this.savePersistedSheetsConnection({
          ...conn,
          authMethod: 'google_oauth',
          connectionProvider: 'direct_browser',
          connectedAccount: tokRes.data.email || conn.connectedAccount || actor.email,
          lastSyncedAt: syncRes.data.syncedAt,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: syncRes.data.message,
        });
        this.recordAudit(
          actor,
          'SYNC_GOOGLE_SHEET',
          'Configuration',
          conn.spreadsheetId,
          '',
          syncRes.data.message,
          'SUCCESS',
        );
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: syncRes.data.syncedAt,
          clientSubmissionKey: 'BULK_SYNC',
          sessionRecordId: conn.spreadsheetId,
          sessionId: 'ALL',
          actorEmail: tokRes.data.email || actor.email,
          operation: 'syncAllToGoogleSheet',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.savePersistedWorkspace();
        return syncRes;
      }

      const savedBridge = this.getActiveBridgeConfig();
      const useAppsScriptBridge = Boolean(
        opts?.forceAppsScriptBridge ||
          opts?.appsScriptUrl?.trim() ||
          opts?.syncKey?.trim() ||
          (savedBridge &&
            !this.sheetsBackendUrl &&
            conn.connectionProvider !== 'direct_browser' &&
            conn.connectionProvider !== 'sheets_backend'),
      );
      if (useAppsScriptBridge) {
        if (!conn.connected || !conn.spreadsheetId) {
          return {
            ok: false,
            code: 'NOT_CONNECTED',
            error: 'Connect or create a Google Sheet before pushing programme data.',
          };
        }
        const urlCheck = validateAppsScriptWebAppUrl(
          (opts?.appsScriptUrl ?? '').trim() || savedBridge?.appsScriptUrl || '',
        );
        if (!urlCheck.valid) {
          return {
            ok: false,
            code: 'INVALID_URL',
            error: urlCheck.error || 'Enter a valid Google Apps Script Web App URL (/exec).',
          };
        }
        const keyCheck = validateAppsScriptSyncKey(
          (opts?.syncKey ?? '').trim() || savedBridge?.syncKey || '',
        );
        if (!keyCheck.valid) {
          return {
            ok: false,
            code: 'INVALID_SYNC_KEY',
            error: keyCheck.error || 'Enter your Sync Bridge Passphrase (minimum 16 characters).',
          };
        }
        saveAppsScriptBridgeConfig({
          appsScriptUrl: urlCheck.normalized,
          syncKey: keyCheck.normalized,
          configuredBy: actor.email,
        });
        const syncRes = await this.callAppsScriptBridgePost<SheetsSyncSummary>(
          'syncAllToGoogleSheet',
          {
            sessions: this.sessions,
            schools: this.schools,
            facilitators: this.users.filter(
              (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
            ),
            configuration: this.config,
          },
          {
            appsScriptUrl: urlCheck.normalized,
            syncKey: keyCheck.normalized,
            actorEmail: actor.email,
          },
        );
        if (!syncRes.ok || !syncRes.data) {
          return { ok: false, code: syncRes.code, error: syncRes.error };
        }
        for (const s of this.sessions) {
          s.syncStatus = 'SYNCED';
          this.syncedSessionKeys.add(s.sessionRecordId);
        }
        this.savePersistedSheetsConnection({
          ...conn,
          authMethod: 'apps_script',
          connectionProvider: 'apps_script',
          connectedAccount: conn.connectedAccount || actor.email,
          lastSyncedAt: syncRes.data.syncedAt,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: syncRes.data.message,
        });
        this.recordAudit(
          actor,
          'SYNC_GOOGLE_SHEET',
          'Configuration',
          conn.spreadsheetId,
          '',
          syncRes.data.message,
          'SUCCESS',
        );
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: syncRes.data.syncedAt,
          clientSubmissionKey: 'BULK_SYNC',
          sessionRecordId: conn.spreadsheetId,
          sessionId: 'ALL',
          actorEmail: actor.email,
          operation: 'syncAllToGoogleSheet',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
        this.savePersistedWorkspace();
        return syncRes;
      }

      if (this.sheetsBackendUrl) {
        const statusJson = await this.fetchOAuthSheetsJson<GoogleSheetsConnectionState>(
          `${this.sheetsBackendUrl.replace(/\/$/, '')}?action=status`,
        );
        if (statusJson?.ok && statusJson.data?.oauthConfigured && statusJson.data.connected) {
          const syncJson = await this.fetchOAuthSheetsJson<SheetsSyncSummary>(
            this.sheetsBackendUrl.replace(/\/$/, ''),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'sync',
                sessions: this.sessions,
                schools: this.schools,
                facilitators: this.users.filter(
                  (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
                ),
                configuration: this.config,
              }),
            },
          );
          if (syncJson) {
            if (syncJson.ok && syncJson.data) {
              for (const s of this.sessions) {
                s.syncStatus = 'SYNCED';
                this.syncedSessionKeys.add(s.sessionRecordId);
              }
              const latestConn = this.loadPersistedSheetsConnection();
              if (latestConn.connected) {
                this.savePersistedSheetsConnection({
                  ...latestConn,
                  lastSyncedAt: syncJson.data.syncedAt,
                  lastSyncStatus: 'SYNCED',
                  lastSyncMessage: syncJson.data.message,
                });
              }
              this.savePersistedWorkspace();
              return syncJson;
            }
            if (
              syncJson.code !== 'OAUTH_REQUIRED' &&
              syncJson.code !== 'OAUTH_EXPIRED' &&
              syncJson.code !== 'OAUTH_REFRESH_FAILED' &&
              syncJson.code !== 'SERVER_MISCONFIGURED'
            ) {
              return syncJson;
            }
          }
        }
      }

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
      this.savePersistedWorkspace();

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

  async connectAppsScriptBridge(params: {
    appsScriptUrl: string;
    syncKey: string;
    targetMode: 'auto' | 'create' | 'existing';
    sheetTitle?: string;
    spreadsheetUrlOrId?: string;
    initializeSchema?: boolean;
  }): Promise<
    ApiResponse<{
      connection: GoogleSheetsConnectionState;
      syncSummary: SheetsSyncSummary | null;
    }>
  > {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
        this.recordAudit(
          actor,
          'CONNECT_APPS_SCRIPT_BRIDGE',
          'Configuration',
          'SHEETS_BRIDGE',
          '',
          'Unauthorized Apps Script Sync Bridge connection attempt',
          'DENIED',
        );
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }

      const urlCheck = validateAppsScriptWebAppUrl(params.appsScriptUrl);
      if (!urlCheck.valid) {
        return {
          ok: false,
          code: 'INVALID_URL',
          error: urlCheck.error || 'Enter a valid Google Apps Script Web App URL (/exec).',
        };
      }

      const keyCheck = validateAppsScriptSyncKey(params.syncKey);
      if (!keyCheck.valid) {
        return {
          ok: false,
          code: 'INVALID_SYNC_KEY',
          error: keyCheck.error || 'Enter your Sync Bridge Passphrase (minimum 16 characters).',
        };
      }

      const explicitBridge = {
        appsScriptUrl: urlCheck.normalized,
        syncKey: keyCheck.normalized,
        actorEmail: actor.email,
      };

      let connRes: ApiResponse<GoogleSheetsConnectionState>;
      if (params.targetMode === 'create') {
        const cleanTitle = (params.sheetTitle || '').trim();
        if (cleanTitle.length < 3) {
          return {
            ok: false,
            code: 'INVALID_TITLE',
            error: 'Spreadsheet name must be at least 3 characters.',
          };
        }
        connRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
          'createGoogleSheet',
          { title: cleanTitle },
          explicitBridge,
        );
      } else if (params.targetMode === 'existing') {
        const targetSheet = (params.spreadsheetUrlOrId || '').trim() || DEFAULT_TARGET_SPREADSHEET_ID;
        if (!parseGoogleSpreadsheetId(targetSheet)) {
          return {
            ok: false,
            code: 'INVALID_SPREADSHEET_ID',
            error: 'Enter a valid Google Spreadsheet URL or Spreadsheet ID.',
          };
        }
        connRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
          'connectGoogleSheet',
          {
            spreadsheetUrlOrId: targetSheet,
            initializeSchema: params.initializeSchema !== false,
          },
          explicitBridge,
        );
      } else {
        const probeRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
          'getSheetsConnection',
          {},
          explicitBridge,
        );
        if (!probeRes.ok) {
          return {
            ok: false,
            code: probeRes.code,
            error: probeRes.error,
          };
        }
        if (probeRes.data?.connected && probeRes.data.spreadsheetId) {
          connRes = probeRes;
        } else {
          connRes = await this.callAppsScriptBridgePost<GoogleSheetsConnectionState>(
            'connectGoogleSheet',
            {
              spreadsheetUrlOrId:
                (params.spreadsheetUrlOrId || '').trim() || DEFAULT_TARGET_SPREADSHEET_ID,
              initializeSchema: params.initializeSchema !== false,
            },
            explicitBridge,
          );
        }
      }

      if (!connRes.ok || !connRes.data || !connRes.data.spreadsheetId) {
        return {
          ok: false,
          code: connRes.code || 'BRIDGE_CONNECT_FAILED',
          error: connRes.error || 'Unable to connect Google Apps Script Web App.',
        };
      }

      clearDirectGoogleSheetsToken();
      saveAppsScriptBridgeConfig({
        appsScriptUrl: urlCheck.normalized,
        syncKey: keyCheck.normalized,
        configuredBy: actor.email,
      });

      const syncRes = await this.callAppsScriptBridgePost<SheetsSyncSummary>(
        'syncAllToGoogleSheet',
        {
          sessions: this.sessions,
          schools: this.schools,
          facilitators: this.users.filter(
            (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
          ),
          configuration: this.config,
        },
        explicitBridge,
      );

      const finalConn: GoogleSheetsConnectionState = {
        ...connRes.data,
        authMethod: 'apps_script',
        connectionProvider: 'apps_script',
        oauthConfigured: true,
        connectedAccount: connRes.data.connectedAccount || actor.email,
        ...(syncRes.ok && syncRes.data
          ? {
              lastSyncedAt: syncRes.data.syncedAt,
              lastSyncStatus: 'SYNCED' as const,
              lastSyncMessage: syncRes.data.message,
            }
          : syncRes.error
            ? {
                lastSyncStatus: 'FAILED' as const,
                lastSyncMessage: syncRes.error,
              }
            : {}),
      };

      if (syncRes.ok) {
        for (const s of this.sessions) {
          s.syncStatus = 'SYNCED';
          this.syncedSessionKeys.add(s.sessionRecordId);
        }
      }

      this.invalidateWorkspaceCache();
      this.savePersistedSheetsConnection(finalConn);
      await this.ensureWorkspaceHydrated(true);

      this.recordAudit(
        actor,
        'CONNECT_APPS_SCRIPT_BRIDGE',
        'Configuration',
        finalConn.spreadsheetId,
        '',
        `Connected "${finalConn.spreadsheetName}" via Apps Script Sync Bridge`,
        'SUCCESS',
      );
      if (syncRes.ok && syncRes.data) {
        this.syncLogs.unshift({
          syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
          timestamp: syncRes.data.syncedAt,
          clientSubmissionKey: 'BRIDGE_CONNECT',
          sessionRecordId: finalConn.spreadsheetId,
          sessionId: 'ALL',
          actorEmail: actor.email,
          operation: 'connectAppsScriptBridge',
          attempt: 1,
          status: 'SYNCED',
          errorMessage: '',
        });
      }
      this.savePersistedWorkspace();

      return {
        ok: true,
        data: {
          connection: structuredClone(finalConn),
          syncSummary: syncRes.ok ? (syncRes.data ?? null) : null,
        },
      };
    });
  }

  private computeAndMaybeRepairLocalHealth(
    performRepair: boolean,
    actor?: ManagedUser,
  ): DatabaseHealthReport {
    const nowIso = new Date().toISOString();
    let committedCount = 0;
    let correctedCount = 0;
    let pendingCount = 0;
    let recoverablePendingCount = 0;
    let archivedCount = 0;
    let promotedPendingCount = 0;
    let orphanPendingCount = 0;
    let orphanDetailRowCount = 0;

    const seenRecordIds = new Set<string>();
    const seenSessionIds = new Set<string>();
    const duplicateRecordIds: string[] = [];
    const duplicateSessionIds: string[] = [];
    const activeCommitted: SessionRecord[] = [];

    for (const s of this.sessions) {
      if (s.sessionRecordId) {
        if (seenRecordIds.has(s.sessionRecordId) && !duplicateRecordIds.includes(s.sessionRecordId)) {
          duplicateRecordIds.push(s.sessionRecordId);
        }
        seenRecordIds.add(s.sessionRecordId);
      }
      if (s.sessionId) {
        if (seenSessionIds.has(s.sessionId) && !duplicateSessionIds.includes(s.sessionId)) {
          duplicateSessionIds.push(s.sessionId);
        }
        seenSessionIds.add(s.sessionId);
      }
      if (s.archived) archivedCount++;

      const hasCompleteDetails =
        Array.isArray(s.details) && s.details.length === s.totalClasses && s.totalClasses > 0;
      if (!hasCompleteDetails && Array.isArray(s.details) && s.details.length === 0) {
        orphanDetailRowCount++;
      }

      if (s.submissionStatus === 'PENDING') {
        if (performRepair && hasCompleteDetails) {
          s.submissionStatus = 'COMMITTED';
          s.updatedAt = nowIso;
          if (actor) s.updatedBy = actor.email;
          promotedPendingCount++;
          committedCount++;
        } else {
          pendingCount++;
          if (hasCompleteDetails) recoverablePendingCount++;
          else orphanPendingCount++;
        }
      } else if (s.submissionStatus === 'CORRECTED') {
        correctedCount++;
      } else {
        committedCount++;
      }

      if (!s.archived && s.submissionStatus !== 'PENDING') {
        activeCommitted.push(s);
      }
    }

    const knownUdises = new Set(this.schools.map((sc) => sc.udiseCode).filter(Boolean));
    const missingSchoolMasterUdise: string[] = [];
    const seenMissingUdises = new Set<string>();
    let repairedSchoolMasters = 0;

    for (const s of activeCommitted) {
      if (!s.udiseCode || !/^\d{11}$/.test(s.udiseCode)) continue;
      if (knownUdises.has(s.udiseCode) || seenMissingUdises.has(s.udiseCode)) continue;
      seenMissingUdises.add(s.udiseCode);
      if (performRepair) {
        this.schools.push({
          schoolRecordId: `SCH_${generateUuid().slice(0, 8).toUpperCase()}`,
          schoolName: s.schoolName,
          udiseCode: s.udiseCode,
          schoolType: s.schoolType,
          state: s.state || this.config.stateName || 'Tamil Nadu',
          district: s.district,
          pinCode: s.pinCode,
          active: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        knownUdises.add(s.udiseCode);
        repairedSchoolMasters++;
      } else {
        missingSchoolMasterUdise.push(s.udiseCode);
      }
    }

    const healthy =
      pendingCount === 0 &&
      orphanPendingCount === 0 &&
      orphanDetailRowCount === 0 &&
      duplicateSessionIds.length === 0 &&
      duplicateRecordIds.length === 0 &&
      missingSchoolMasterUdise.length === 0;

    return {
      healthy,
      totalSessions: this.sessions.length,
      committedCount,
      correctedCount,
      pendingCount,
      recoverablePendingCount,
      archivedCount,
      promotedPendingCount,
      orphanPendingCount,
      orphanDetailRowCount,
      duplicateSessionIds,
      duplicateRecordIds,
      missingSchoolMasterUdise,
      repairedSchoolMasters,
      checkedAt: nowIso,
    };
  }

  private formValuesToTempSessionRecord(
    rawValues: SessionFormValues,
    actor: ManagedUser,
    meta?: { clientSubmissionKey?: string; sessionRecordId?: string; sessionId?: string },
  ): SessionRecord | null {
    const values: SessionFormValues = {
      ...rawValues,
      facilitatorEmail: actor.email,
      schoolName: rawValues.schoolName.trim(),
      udiseCode: rawValues.udiseCode.trim(),
      pinCode: rawValues.pinCode.trim(),
    };
    const validation = validateSessionForm(values, this.config);
    if (!validation.valid) return null;

    const tour = this.config.tours.find((t) => t.tourId === values.tourId);
    if (!tour) return null;

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
    const prefix =
      buildSessionIdPrefix(
        values.startDate,
        values.udiseCode,
        values.sessionMode,
        values.classes,
      ) || 'CT_IN';
    const sessionRecordId = meta?.sessionRecordId || `REC_${generateUuid().toUpperCase()}`;
    const sessionId = meta?.sessionId || formatSessionIdWithSequence(prefix, 901);
    const nowIso = new Date().toISOString();
    const todayKolkata = getTodayKolkataISO(this.config.programmeTimezone);
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

    return {
      sessionRecordId,
      sessionId,
      clientSubmissionKey: meta?.clientSubmissionKey || values.clientSubmissionKey,
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
      submissionStatus: 'COMMITTED',
      syncStatus: 'PENDING_RETRY',
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: actor.email,
      updatedBy: actor.email,
      archived: false,
      details: detailRecords,
    };
  }

  async getTeamIntakeSetup(): Promise<ApiResponse<TeamIntakeSetupResponse>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.getActiveBridgeConfig()) {
      return this.callAppsScriptBridgePost<TeamIntakeSetupResponse>('getTeamIntakeConfig', {});
    }
    return {
      ok: true,
      data: {
        configured: false,
        intakeKey: '',
        approvalMode: this.config.policy.facilitatorApprovalMode,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  async rotateTeamIntakeKey(): Promise<ApiResponse<TeamIntakeSetupResponse>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (!this.getActiveBridgeConfig()) {
      return {
        ok: false,
        code: 'BRIDGE_NOT_CONFIGURED',
        error:
          'Connect the Google Apps Script Sync Bridge before generating or rotating a Team Submission Link.',
      };
    }
    const res = await this.callAppsScriptBridgePost<TeamIntakeSetupResponse>(
      'rotateTeamIntakeKey',
      {},
    );
    if (res.ok) {
      this.recordAudit(
        actor,
        'ROTATE_TEAM_INTAKE_KEY',
        'Configuration',
        'TEAM_INTAKE',
        '',
        'Rotated Facilitator Team Intake key',
        'SUCCESS',
      );
    }
    return res;
  }

  async getDatabaseHealth(): Promise<ApiResponse<DatabaseHealthReport>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }
    if (this.isAppsScriptBridgeActive()) {
      return this.callAppsScriptBridgePost<DatabaseHealthReport>('getDatabaseHealth', {});
    }
    if (this.isDirectSheetsActive() || this.isOAuthSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated();
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    }
    return { ok: true, data: this.computeAndMaybeRepairLocalHealth(false, actor) };
  }

  async recoverDatabaseHealth(): Promise<ApiResponse<DatabaseHealthReport>> {
    return this.withMutex(async () => {
      const actor = this.resolveActor();
      if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
        return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
      }
      if (this.isAppsScriptBridgeActive()) {
        const res = await this.callAppsScriptBridgePost<DatabaseHealthReport>(
          'recoverPendingSessions',
          {},
        );
        if (res.ok && res.data) {
          this.invalidateWorkspaceCache();
          await this.ensureWorkspaceHydrated(true);
          this.recordAudit(
            actor,
            'DATABASE_RECOVERY',
            'Session',
            'HEALTH',
            '',
            `Promoted ${res.data.promotedPendingCount} pending; repaired ${res.data.repairedSchoolMasters} school(s)`,
            'SUCCESS',
          );
        }
        return res;
      }

      if (this.isDirectSheetsActive() || this.isOAuthSheetsActive()) {
        const h = await this.ensureWorkspaceHydrated();
        if (!h.ok) return { ok: false, code: h.code, error: h.error };
      }

      const report = this.computeAndMaybeRepairLocalHealth(true, actor);
      if (report.promotedPendingCount > 0 || report.repairedSchoolMasters > 0) {
        this.recordAudit(
          actor,
          'DATABASE_RECOVERY',
          'Session',
          'HEALTH',
          '',
          `Promoted ${report.promotedPendingCount} pending; repaired ${report.repairedSchoolMasters} school(s)`,
          'SUCCESS',
        );
        this.savePersistedWorkspace();
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (directToken && sheetId) {
            await syncWorkspaceToDirectGoogleSheet({
              spreadsheetId: sheetId,
              accessToken: directToken.accessToken,
              actorEmail: actor.email,
              sessions: this.sessions,
              schools: this.schools,
              users: this.users,
              config: this.config,
            });
          }
        } else if (this.isOAuthSheetsActive()) {
          await this.callOAuthSheetsPost('sync', {
            sessions: this.sessions,
            schools: this.schools,
            facilitators: this.users.filter(
              (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
            ),
            configuration: this.config,
          });
        }
      }
      return { ok: true, data: report };
    });
  }

  async exportFacilitatorTransferPackage(): Promise<ApiResponse<SessionTransferPackage>> {
    const actor = this.resolveActor();
    if (!actor) return { ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' };

    if (this.getActiveTeamIntakeForFacilitator()) {
      await this.getMySessions({ includeArchived: false, page: 1, pageSize: 100 });
    }

    const ownFromWorkspace = this.sessions.filter(
      (s) => normalizeEmail(s.facilitatorEmail) === actor.email && !s.archived,
    );
    const seenKeys = new Set(ownFromWorkspace.map((s) => s.clientSubmissionKey).filter(Boolean));
    const seenRecordIds = new Set(ownFromWorkspace.map((s) => s.sessionRecordId).filter(Boolean));

    const combined: SessionRecord[] = [...ownFromWorkspace];
    const outbox = loadSyncOutbox(actor.email);
    for (const item of outbox) {
      if (item.clientSubmissionKey && seenKeys.has(item.clientSubmissionKey)) continue;
      if (item.sessionRecordId && seenRecordIds.has(item.sessionRecordId)) continue;
      const converted = this.formValuesToTempSessionRecord(item.values, actor, {
        clientSubmissionKey: item.clientSubmissionKey,
        sessionRecordId: item.sessionRecordId,
        sessionId: item.sessionId,
      });
      if (converted) {
        if (converted.clientSubmissionKey) seenKeys.add(converted.clientSubmissionKey);
        seenRecordIds.add(converted.sessionRecordId);
        combined.push(converted);
      }
    }

    const pkg = buildFacilitatorTransferPackage(combined, {
      email: actor.email,
      name: actor.name,
    });
    this.recordAudit(
      actor,
      'EXPORT_TRANSFER_JSON',
      'Session',
      actor.userId,
      '',
      `${pkg.recordCount} session(s) packaged`,
      'SUCCESS',
    );
    return { ok: true, data: pkg };
  }

  async exportDatabaseBackupPackage(): Promise<ApiResponse<DatabaseBackupPackage>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        error: 'Super Administrator access required for full database backup.',
      };
    }
    if (this.isRemoteSheetsActive()) {
      const h = await this.ensureWorkspaceHydrated(true);
      if (!h.ok) return { ok: false, code: h.code, error: h.error };
    }
    const pkg = buildDatabaseBackupPackage(
      {
        sessions: this.sessions,
        schools: this.schools,
        users: this.users,
        configuration: this.config,
      },
      { email: actor.email, name: actor.name },
    );
    this.recordAudit(
      actor,
      'EXPORT_BACKUP',
      'Database',
      'FULL_JSON',
      '',
      `${pkg.recordCount} session(s), ${pkg.schoolsCount} school(s)`,
      'SUCCESS',
    );
    return { ok: true, data: pkg };
  }

  async importSessionsPackage(rawPayload: unknown): Promise<ApiResponse<ImportSessionsResult>> {
    const actor = this.resolveActor();
    if (!actor || actor.role !== 'super_admin' || !isAllowlistedSuperAdmin(actor.email)) {
      this.recordAudit(
        actor,
        'IMPORT_SESSIONS',
        'Session',
        'IMPORT',
        '',
        'Unauthorized session import attempt',
        'DENIED',
      );
      return { ok: false, code: 'FORBIDDEN', error: 'Super Administrator access required.' };
    }

    const parsed = parseSessionTransferOrBackupPayload(rawPayload);
    if (!parsed.ok) {
      return { ok: false, code: 'INVALID_IMPORT_FILE', error: parsed.error };
    }

    if (this.isAppsScriptBridgeActive()) {
      const bridgeRes = await this.callAppsScriptBridgePost<ImportSessionsResult>('importSessions', {
        sessions: parsed.sessions,
      });
      if (!bridgeRes.ok || !bridgeRes.data) return bridgeRes;
      const normalized = normalizeImportSessionsResult(bridgeRes.data);
      this.invalidateWorkspaceCache();
      await this.ensureWorkspaceHydrated(true);
      this.recordAudit(
        actor,
        'IMPORT_SESSIONS',
        'Session',
        'IMPORT',
        '',
        `Imported ${normalized.importedCount}, skipped ${normalized.skippedDuplicates}, rejected ${normalized.rejectedCount}`,
        normalized.importedCount > 0 || normalized.rejectedCount === 0 ? 'SUCCESS' : 'DENIED',
      );
      return { ok: true, data: normalized };
    }

    return this.withMutex(async () => {
      if (this.isRemoteSheetsActive()) {
        const h = await this.ensureWorkspaceHydrated();
        if (!h.ok) return { ok: false, code: h.code, error: h.error };
      }

      const incoming = parsed.sessions.slice(0, 500);
      const existingRecordIds = new Set(this.sessions.map((s) => s.sessionRecordId).filter(Boolean));
      const existingSessionIds = new Set(this.sessions.map((s) => s.sessionId).filter(Boolean));
      const existingClientKeys = new Set(
        this.sessions.map((s) => s.clientSubmissionKey).filter(Boolean),
      );
      const knownFacByEmail = new Map(this.users.map((u) => [normalizeEmail(u.email), u]));
      const knownSchoolUdises = new Set(this.schools.map((sc) => sc.udiseCode).filter(Boolean));

      let importedCount = 0;
      let skippedDuplicates = 0;
      let rejectedCount = 0;
      let registeredFacilitators = 0;
      let repairedSchools = 0;
      const errors: string[] = [];
      const nowIso = new Date().toISOString();
      const todayKolkata = getTodayKolkataISO(this.config.programmeTimezone);
      const importedSessions: SessionRecord[] = [];

      for (let idx = 0; idx < incoming.length; idx++) {
        const raw = incoming[idx] as unknown as Record<string, unknown>;
        if (!raw || typeof raw !== 'object') {
          rejectedCount++;
          errors.push(`Row ${idx + 1}: Malformed record entry.`);
          continue;
        }
        const rawRecId = String(raw.sessionRecordId ?? '').trim();
        const rawSessId = String(raw.sessionId ?? '').trim();
        const rawClientKey = String(raw.clientSubmissionKey ?? '').trim();

        if (
          (rawRecId && existingRecordIds.has(rawRecId)) ||
          (rawClientKey && existingClientKeys.has(rawClientKey)) ||
          (rawSessId && existingSessionIds.has(rawSessId))
        ) {
          skippedDuplicates++;
          continue;
        }

        const values = sessionRecordToFormValuesForImport(raw);
        if (!values.facilitatorEmail) {
          values.facilitatorEmail = actor.email;
        }
        const validation = validateSessionForm(values, this.config);
        if (!validation.valid) {
          rejectedCount++;
          const label = rawSessId || rawRecId || `Row ${idx + 1}`;
          errors.push(`${label}: ${validation.errors.map((e) => e.message).join(' ')}`);
          continue;
        }

        const tour = this.config.tours.find((t) => t.tourId === values.tourId);
        if (!tour) {
          rejectedCount++;
          errors.push(`${rawSessId || `Row ${idx + 1}`}: Unknown tour ${values.tourId}.`);
          continue;
        }

        const prefix =
          buildSessionIdPrefix(
            values.startDate,
            values.udiseCode,
            values.sessionMode,
            values.classes,
          ) || 'CT_IN';
        let sessionId = rawSessId && !existingSessionIds.has(rawSessId) ? rawSessId : '';
        if (!sessionId) {
          let maxSeq = 0;
          for (const existingId of existingSessionIds) {
            if (existingId.startsWith(`${prefix}_`)) {
              const tail = Number.parseInt(existingId.slice(prefix.length + 1), 10);
              if (Number.isInteger(tail) && tail > maxSeq) maxSeq = tail;
            }
          }
          let seq = maxSeq + 1;
          sessionId = formatSessionIdWithSequence(prefix, seq);
          while (existingSessionIds.has(sessionId)) {
            seq++;
            sessionId = formatSessionIdWithSequence(prefix, seq);
          }
        }

        const sessionRecordId = rawRecId || `REC_${generateUuid().toUpperCase()}`;
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
        const videoInfo = resolveConfiguredVideoId(tour, values.language, this.config);

        const facEmail = normalizeEmail(values.facilitatorEmail) || actor.email;
        let facUser = knownFacByEmail.get(facEmail);
        let facUserId = String(raw.facilitatorUserId ?? '').trim();
        const allowAdmin = INITIAL_SUPER_ADMINS.find((sa) => sa.email === facEmail);
        if (allowAdmin) {
          facUserId = allowAdmin.userId;
        } else if (facUser) {
          facUserId = facUser.userId || facUserId;
        } else {
          facUserId = facUserId || `FAC_${generateUuid().slice(0, 8).toUpperCase()}`;
          facUser = {
            userId: facUserId,
            name: values.facilitatorName || facEmail,
            email: facEmail,
            role: 'facilitator',
            active: true,
            status: 'APPROVED',
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          this.users.push(facUser);
          knownFacByEmail.set(facEmail, facUser);
          registeredFacilitators++;
        }

        const detailRecords: SessionDetailRecord[] = metrics.classBreakdown.map((c, cIdx) => ({
          detailRecordId: `DET_${sessionRecordId}_${cIdx + 1}`,
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
          createdAt: String(raw.createdAt ?? '').trim() || nowIso,
          updatedAt: nowIso,
        }));

        const finalStatus = raw.submissionStatus === 'CORRECTED' ? 'CORRECTED' : 'COMMITTED';
        const isRemote = this.isDirectSheetsActive() || this.isOAuthSheetsActive();
        const newRec: SessionRecord = {
          sessionRecordId,
          sessionId,
          clientSubmissionKey: values.clientSubmissionKey || `IMP_${sessionRecordId}`,
          facilitatorName: values.facilitatorName,
          facilitatorEmail: facEmail,
          facilitatorUserId: facUserId,
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
          submissionTimestamp: String(raw.submissionTimestamp ?? '').trim() || nowIso,
          submissionDateFormatted:
            String(raw.submissionDateFormatted ?? '').trim() ||
            formatISODateToDDMMYYYY(todayKolkata),
          schoolName: values.schoolName,
          udiseCode: values.udiseCode,
          schoolType: values.schoolType,
          state: values.state,
          district: values.district,
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
          submissionStatus: finalStatus,
          syncStatus: isRemote ? 'SYNCED' : 'LOCAL_SANDBOX',
          createdAt: String(raw.createdAt ?? '').trim() || nowIso,
          updatedAt: nowIso,
          createdBy: facEmail,
          updatedBy: actor.email,
          archived: Boolean(raw.archived),
          details: detailRecords,
        };

        this.sessions.unshift(newRec);
        importedSessions.push(newRec);
        if (!knownSchoolUdises.has(values.udiseCode)) {
          this.schools.push({
            schoolRecordId: `SCH_${generateUuid().slice(0, 8).toUpperCase()}`,
            schoolName: values.schoolName,
            udiseCode: values.udiseCode,
            schoolType: values.schoolType,
            state: values.state || this.config.stateName || 'Tamil Nadu',
            district: values.district,
            pinCode: values.pinCode,
            active: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          knownSchoolUdises.add(values.udiseCode);
          repairedSchools++;
        }

        existingRecordIds.add(sessionRecordId);
        existingSessionIds.add(sessionId);
        if (newRec.clientSubmissionKey) existingClientKeys.add(newRec.clientSubmissionKey);
        importedCount++;
      }

      if (importedCount > 0) {
        if (this.isDirectSheetsActive()) {
          const directToken = getDirectGoogleSheetsTokenInfo(actor.email);
          const sheetId =
            this.sheetsConnection.spreadsheetId || this.loadPersistedSheetsConnection().spreadsheetId;
          if (directToken && sheetId) {
            const syncRes = await syncWorkspaceToDirectGoogleSheet({
              spreadsheetId: sheetId,
              accessToken: directToken.accessToken,
              actorEmail: actor.email,
              sessions: this.sessions,
              schools: this.schools,
              users: this.users,
              config: this.config,
            });
            if (syncRes.ok) {
              for (const s of importedSessions) {
                s.syncStatus = 'SYNCED';
                this.syncedSessionKeys.add(s.sessionRecordId);
              }
            } else {
              for (const s of importedSessions) s.syncStatus = 'LOCAL_SANDBOX';
            }
          }
        } else if (this.isOAuthSheetsActive()) {
          const syncRes = await this.callOAuthSheetsPost<SheetsSyncSummary>('sync', {
            sessions: this.sessions,
            schools: this.schools,
            facilitators: this.users.filter(
              (u) => !isAllowlistedSuperAdmin(u.email) && u.role !== 'super_admin',
            ),
            configuration: this.config,
          });
          if (syncRes.ok) {
            for (const s of importedSessions) {
              s.syncStatus = 'SYNCED';
              this.syncedSessionKeys.add(s.sessionRecordId);
            }
          } else {
            for (const s of importedSessions) s.syncStatus = 'LOCAL_SANDBOX';
          }
        }
      }

      this.recordAudit(
        actor,
        'IMPORT_SESSIONS',
        'Session',
        'IMPORT',
        '',
        `Imported ${importedCount}, skipped ${skippedDuplicates}, rejected ${rejectedCount}`,
        importedCount > 0 || rejectedCount === 0 ? 'SUCCESS' : 'DENIED',
      );
      this.syncLogs.unshift({
        syncId: `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        timestamp: nowIso,
        clientSubmissionKey: 'IMPORT_PACKAGE',
        sessionRecordId: String(importedCount),
        sessionId: 'IMPORT',
        actorEmail: actor.email,
        operation: 'importSessions',
        attempt: 1,
        status:
          this.isDirectSheetsActive() || this.isOAuthSheetsActive() ? 'SYNCED' : 'LOCAL_SANDBOX',
        errorMessage: rejectedCount > 0 ? `${rejectedCount} record(s) rejected` : '',
      });
      this.savePersistedWorkspace();

      return {
        ok: true,
        data: {
          importedCount,
          skippedDuplicates,
          rejectedCount,
          registeredFacilitators,
          repairedSchools,
          errors,
        },
      };
    });
  }
}

export function createApiClient(
  getIdToken: () => string | undefined,
  getSandboxActorId: () => string,
  options?: CreateApiClientOptions,
): BackendApiClient {
  if (isSupabaseConfigured()) {
    return new SupabaseApiClient(getSupabaseClient(), options?.onSessionExpired);
  }
  const env = getAuthEnvironment();
  if (env.isLiveBackendConfigured) {
    return new AppsScriptApiClient(env.appsScriptUrl, getIdToken, env.sheetsBackendUrl, options);
  }
  return new LocalSandboxApiClient(getSandboxActorId, undefined, env.sheetsBackendUrl, getIdToken, {
    persistWorkspace: true,
  });
}
