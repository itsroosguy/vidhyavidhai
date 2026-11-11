import type { SupabaseClient } from '@supabase/supabase-js';
import { computeDashboardAnalytics, filterSessionRecords } from '../calculations/analytics';
import { isAllowlistedSuperAdmin, normalizeEmail } from '../config/accessControl';
import {
  APPROVED_DISTRICTS,
  DEFAULT_APP_CONFIGURATION,
  DEFAULT_TARGET_SPREADSHEET_ID,
  DEFAULT_TARGET_SPREADSHEET_URL,
  parseGoogleSpreadsheetId,
} from '../config/defaults';
import type {
  ApiResponse,
  AppConfiguration,
  AuditLogEntry,
  DashboardAnalytics,
  DatabaseBackupPackage,
  DatabaseHealthReport,
  GoogleSheetsConnectionState,
  GoogleSpreadsheetSummary,
  ImportSessionsResult,
  ManagedUser,
  PaginatedResult,
  SchoolRecord,
  SessionDetailRecord,
  SessionFormValues,
  SessionQueryFilters,
  SessionRecord,
  SessionTransferPackage,
  SheetsSyncSummary,
  SubmissionStatus,
  SyncLogEntry,
  SyncStatus,
  UserApprovalStatus,
  UserProfile,
  UserRole,
} from '../types/domain';
import type { Database, Json } from '../types/supabase';
import type { BackendApiClient, BackendHealthInfo } from './apiClient';
import { validateAppsScriptWebAppUrl } from './authService';
import {
  buildDatabaseBackupPackage,
  buildFacilitatorTransferPackage,
  normalizeImportSessionsResult,
  parseSessionTransferOrBackupPayload,
} from './durableStorage';
import { getSupabaseClient } from './supabaseClient';

type FormSubmissionDbRow = Database['public']['Tables']['form_submissions']['Row'];
type FormSubmissionClassDbRow = Database['public']['Tables']['form_submission_classes']['Row'];
type SchoolDbRow = Database['public']['Tables']['schools']['Row'];

interface JoinedSubmissionRow extends FormSubmissionDbRow {
  form_submission_classes?: FormSubmissionClassDbRow[] | null;
  profiles?: { user_code?: string | null } | Array<{ user_code?: string | null }> | null;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeIsoTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  return String(value);
}

function mapClassRowToDetailRecord(row: FormSubmissionClassDbRow): SessionDetailRecord {
  return {
    detailRecordId: row.detail_record_id,
    sessionRecordId: row.session_record_id,
    sessionId: row.session_id,
    grade: row.grade,
    section: row.section,
    studentsPresent: Number(row.students_present) || 0,
    questionAScore5: Number(row.question_a_score_5) || 0,
    questionAScore4: Number(row.question_a_score_4) || 0,
    questionAScore3: Number(row.question_a_score_3) || 0,
    questionAScore2: Number(row.question_a_score_2) || 0,
    questionAScore1: Number(row.question_a_score_1) || 0,
    questionATotal: Number(row.question_a_total) || 0,
    questionAWeightedScore: Number(row.question_a_weighted_score) || 0,
    csat: toNullableNumber(row.csat),
    questionBScore5: Number(row.question_b_score_5) || 0,
    questionBScore4: Number(row.question_b_score_4) || 0,
    questionBScore3: Number(row.question_b_score_3) || 0,
    questionBScore2: Number(row.question_b_score_2) || 0,
    questionBScore1: Number(row.question_b_score_1) || 0,
    questionBTotal: Number(row.question_b_total) || 0,
    questionBWeightedScore: Number(row.question_b_weighted_score) || 0,
    itp: toNullableNumber(row.itp),
    createdAt: normalizeIsoTimestamp(row.created_at),
    updatedAt: normalizeIsoTimestamp(row.updated_at),
  };
}

function mapSubmissionRowToSessionRecord(row: JoinedSubmissionRow): SessionRecord {
  const rawClasses = Array.isArray(row.form_submission_classes)
    ? [...row.form_submission_classes]
    : [];
  rawClasses.sort((a, b) => {
    const orderDiff = (Number(a.row_order) || 0) - (Number(b.row_order) || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });

  const details = rawClasses.map(mapClassRowToDetailRecord);
  const profileJoin = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const facilitatorUserId = (profileJoin?.user_code ?? '').trim() || row.user_id;

  const teacherClassification: SessionRecord['teacherClassification'] =
    row.teacher_classification === 'Promoter' ||
    row.teacher_classification === 'Passive' ||
    row.teacher_classification === 'Detractor'
      ? row.teacher_classification
      : 'Passive';

  const submissionStatus: SubmissionStatus =
    row.submission_status === 'CORRECTED' || row.submission_status === 'PENDING'
      ? row.submission_status
      : 'COMMITTED';

  const syncStatus: SyncStatus =
    row.sync_status === 'PENDING_RETRY' ||
    row.sync_status === 'FAILED' ||
    row.sync_status === 'LOCAL_SANDBOX'
      ? row.sync_status
      : 'SYNCED';

  return {
    sessionRecordId: row.session_record_id,
    sessionId: row.submission_reference,
    clientSubmissionKey: row.client_submission_key,
    facilitatorName: row.facilitator_name,
    facilitatorEmail: row.facilitator_email,
    facilitatorUserId,
    tourId: row.tour_id,
    tourName: row.tour_name,
    videoId: row.video_id,
    language: row.language,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10),
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes: Number(row.duration_minutes) || 0,
    durationFormatted: row.duration_formatted,
    reportingMonth: row.reporting_month,
    submissionTimestamp: normalizeIsoTimestamp(row.submission_timestamp || row.submitted_at),
    submissionDateFormatted: row.submission_date_formatted,
    schoolName: row.school_name,
    udiseCode: row.udise_code,
    schoolType: row.school_type,
    state: row.state || 'Tamil Nadu',
    district: row.district,
    pinCode: row.pin_code,
    sessionType: row.session_type === 'combined' ? 'combined' : 'single',
    totalClasses: Number(row.total_classes) || details.length,
    totalStudentsPresent: Number(row.total_students_present) || 0,
    totalQuestionAResponses: Number(row.total_question_a_responses) || 0,
    totalQuestionBResponses: Number(row.total_question_b_responses) || 0,
    overallCsat: toNullableNumber(row.overall_csat),
    overallItp: toNullableNumber(row.overall_itp),
    teacherScore: toNullableNumber(row.teacher_score),
    teacherClassification,
    teacherNps: Number(row.teacher_nps) || 0,
    submissionStatus,
    syncStatus,
    syncedAt: row.synced_at ?? undefined,
    createdAt: normalizeIsoTimestamp(row.created_at),
    updatedAt: normalizeIsoTimestamp(row.updated_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archived: Boolean(row.archived),
    details,
  };
}

function normalizeJsonSessionRecord(raw: unknown): SessionRecord {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawDetails = Array.isArray(rec.details) ? rec.details : [];
  const details: SessionDetailRecord[] = rawDetails.map((item) => {
    const d = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      detailRecordId: String(d.detailRecordId ?? ''),
      sessionRecordId: String(d.sessionRecordId ?? rec.sessionRecordId ?? ''),
      sessionId: String(d.sessionId ?? rec.sessionId ?? ''),
      grade: String(d.grade ?? ''),
      section: String(d.section ?? ''),
      studentsPresent: Number(d.studentsPresent) || 0,
      questionAScore5: Number(d.questionAScore5) || 0,
      questionAScore4: Number(d.questionAScore4) || 0,
      questionAScore3: Number(d.questionAScore3) || 0,
      questionAScore2: Number(d.questionAScore2) || 0,
      questionAScore1: Number(d.questionAScore1) || 0,
      questionATotal: Number(d.questionATotal) || 0,
      questionAWeightedScore: Number(d.questionAWeightedScore) || 0,
      csat: toNullableNumber(d.csat as number | string | null | undefined),
      questionBScore5: Number(d.questionBScore5) || 0,
      questionBScore4: Number(d.questionBScore4) || 0,
      questionBScore3: Number(d.questionBScore3) || 0,
      questionBScore2: Number(d.questionBScore2) || 0,
      questionBScore1: Number(d.questionBScore1) || 0,
      questionBTotal: Number(d.questionBTotal) || 0,
      questionBWeightedScore: Number(d.questionBWeightedScore) || 0,
      itp: toNullableNumber(d.itp as number | string | null | undefined),
      createdAt: String(d.createdAt ?? ''),
      updatedAt: String(d.updatedAt ?? ''),
    };
  });

  const teacherClassification: SessionRecord['teacherClassification'] =
    rec.teacherClassification === 'Promoter' ||
    rec.teacherClassification === 'Passive' ||
    rec.teacherClassification === 'Detractor'
      ? rec.teacherClassification
      : 'Passive';

  return {
    sessionRecordId: String(rec.sessionRecordId ?? ''),
    sessionId: String(rec.sessionId ?? ''),
    clientSubmissionKey: String(rec.clientSubmissionKey ?? ''),
    facilitatorName: String(rec.facilitatorName ?? ''),
    facilitatorEmail: String(rec.facilitatorEmail ?? ''),
    facilitatorUserId: String(rec.facilitatorUserId ?? ''),
    tourId: String(rec.tourId ?? ''),
    tourName: String(rec.tourName ?? ''),
    videoId: String(rec.videoId ?? ''),
    language: String(rec.language ?? ''),
    startDate: String(rec.startDate ?? '').slice(0, 10),
    endDate: String(rec.endDate ?? '').slice(0, 10),
    startTime: String(rec.startTime ?? ''),
    endTime: String(rec.endTime ?? ''),
    durationMinutes: Number(rec.durationMinutes) || 0,
    durationFormatted: String(rec.durationFormatted ?? ''),
    reportingMonth: String(rec.reportingMonth ?? ''),
    submissionTimestamp: String(rec.submissionTimestamp ?? ''),
    submissionDateFormatted: String(rec.submissionDateFormatted ?? ''),
    schoolName: String(rec.schoolName ?? ''),
    udiseCode: String(rec.udiseCode ?? ''),
    schoolType: String(rec.schoolType ?? ''),
    state: String(rec.state ?? 'Tamil Nadu'),
    district: String(rec.district ?? ''),
    pinCode: String(rec.pinCode ?? ''),
    sessionType: rec.sessionType === 'combined' ? 'combined' : 'single',
    totalClasses: Number(rec.totalClasses) || details.length,
    totalStudentsPresent: Number(rec.totalStudentsPresent) || 0,
    totalQuestionAResponses: Number(rec.totalQuestionAResponses) || 0,
    totalQuestionBResponses: Number(rec.totalQuestionBResponses) || 0,
    overallCsat: toNullableNumber(rec.overallCsat as number | string | null | undefined),
    overallItp: toNullableNumber(rec.overallItp as number | string | null | undefined),
    teacherScore: toNullableNumber(rec.teacherScore as number | string | null | undefined),
    teacherClassification,
    teacherNps: Number(rec.teacherNps) || 0,
    submissionStatus:
      rec.submissionStatus === 'CORRECTED' || rec.submissionStatus === 'PENDING'
        ? rec.submissionStatus
        : 'COMMITTED',
    syncStatus:
      rec.syncStatus === 'PENDING_RETRY' ||
      rec.syncStatus === 'FAILED' ||
      rec.syncStatus === 'LOCAL_SANDBOX'
        ? rec.syncStatus
        : 'SYNCED',
    syncedAt: typeof rec.syncedAt === 'string' && rec.syncedAt ? rec.syncedAt : undefined,
    createdAt: String(rec.createdAt ?? ''),
    updatedAt: String(rec.updatedAt ?? ''),
    createdBy: String(rec.createdBy ?? ''),
    updatedBy: String(rec.updatedBy ?? ''),
    archived: Boolean(rec.archived),
    details,
  };
}

function mapSchoolRow(row: SchoolDbRow): SchoolRecord {
  return {
    schoolRecordId: row.school_record_id,
    schoolName: row.school_name,
    udiseCode: row.udise_code,
    schoolType: row.school_type,
    state: row.state || 'Tamil Nadu',
    district: row.district,
    pinCode: row.pin_code,
    active: Boolean(row.active),
    createdAt: normalizeIsoTimestamp(row.created_at),
    updatedAt: normalizeIsoTimestamp(row.updated_at),
  };
}

function normalizeAppConfiguration(raw: unknown): AppConfiguration {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppConfiguration>;
  const mergedReporting = {
    ...DEFAULT_APP_CONFIGURATION.reportingDefaults,
    ...(src.reportingDefaults && typeof src.reportingDefaults === 'object'
      ? src.reportingDefaults
      : {}),
  };
  const mergedPolicy = {
    ...DEFAULT_APP_CONFIGURATION.policy,
    ...(src.policy && typeof src.policy === 'object' ? src.policy : {}),
  };
  const next: AppConfiguration = {
    programmeTimezone: src.programmeTimezone || DEFAULT_APP_CONFIGURATION.programmeTimezone,
    stateName: 'Tamil Nadu',
    allowedDistricts: [...APPROVED_DISTRICTS],
    gradeOptions:
      Array.isArray(src.gradeOptions) && src.gradeOptions.length > 0
        ? src.gradeOptions
        : [...DEFAULT_APP_CONFIGURATION.gradeOptions],
    sectionOptions:
      Array.isArray(src.sectionOptions) && src.sectionOptions.length > 0
        ? src.sectionOptions
        : [...DEFAULT_APP_CONFIGURATION.sectionOptions],
    schoolTypes:
      Array.isArray(src.schoolTypes) && src.schoolTypes.length > 0
        ? src.schoolTypes
        : [...DEFAULT_APP_CONFIGURATION.schoolTypes],
    tours:
      Array.isArray(src.tours) && src.tours.length > 0
        ? src.tours
        : structuredClone(DEFAULT_APP_CONFIGURATION.tours),
    languageOptions:
      Array.isArray(src.languageOptions) && src.languageOptions.length > 0
        ? src.languageOptions
        : [...DEFAULT_APP_CONFIGURATION.languageOptions],
    languageCodes:
      src.languageCodes && typeof src.languageCodes === 'object'
        ? { ...DEFAULT_APP_CONFIGURATION.languageCodes, ...src.languageCodes }
        : { ...DEFAULT_APP_CONFIGURATION.languageCodes },
    schoolYear: src.schoolYear || DEFAULT_APP_CONFIGURATION.schoolYear,
    partnerName: typeof src.partnerName === 'string' ? src.partnerName : DEFAULT_APP_CONFIGURATION.partnerName,
    reportingDefaults: mergedReporting,
    policy: {
      allowFacilitatorDeleteOwn: Boolean(mergedPolicy.allowFacilitatorDeleteOwn),
      allowFacilitatorExportOwn: Boolean(mergedPolicy.allowFacilitatorExportOwn),
      facilitatorApprovalMode:
        mergedPolicy.facilitatorApprovalMode === 'manual_allowlist'
          ? 'manual_allowlist'
          : 'auto_approve',
    },
    exportTemplate63:
      src.exportTemplate63 && typeof src.exportTemplate63 === 'object'
        ? src.exportTemplate63
        : null,
  };
  return next;
}

function normalizeSheetsConnection(raw: unknown): GoogleSheetsConnectionState {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<GoogleSheetsConnectionState>;
  return {
    connected: Boolean(src.connected),
    authMethod: src.authMethod === 'google_oauth' ? 'google_oauth' : 'apps_script',
    connectionProvider:
      src.connectionProvider === 'sheets_backend' || src.connectionProvider === 'direct_browser'
        ? src.connectionProvider
        : 'apps_script',
    oauthConfigured: Boolean(src.oauthConfigured),
    connectedAccount: String(src.connectedAccount ?? ''),
    spreadsheetId: String(src.spreadsheetId ?? DEFAULT_TARGET_SPREADSHEET_ID),
    spreadsheetName: String(src.spreadsheetName ?? 'Career Tours Live Sheet'),
    spreadsheetUrl: String(src.spreadsheetUrl ?? DEFAULT_TARGET_SPREADSHEET_URL),
    connectedAt: String(src.connectedAt ?? ''),
    connectedBy: String(src.connectedBy ?? ''),
    lastSyncedAt: String(src.lastSyncedAt ?? ''),
    lastSyncStatus:
      src.lastSyncStatus === 'SYNCED' || src.lastSyncStatus === 'FAILED'
        ? src.lastSyncStatus
        : 'IDLE',
    lastSyncMessage: String(src.lastSyncMessage ?? ''),
    initializedTabs: Array.isArray(src.initializedTabs)
      ? src.initializedTabs.map(String)
      : ['Sessions', 'Session Details', 'Schools', 'Facilitators', 'Settings'],
    defaultSpreadsheetId: String(src.defaultSpreadsheetId ?? DEFAULT_TARGET_SPREADSHEET_ID),
    defaultSpreadsheetUrl: String(src.defaultSpreadsheetUrl ?? DEFAULT_TARGET_SPREADSHEET_URL),
  };
}

function sortSessionsNewestFirst(list: SessionRecord[]): SessionRecord[] {
  return [...list].sort((a, b) => {
    const dCmp = b.startDate.localeCompare(a.startDate);
    if (dCmp !== 0) return dCmp;
    return (b.submissionTimestamp || b.createdAt).localeCompare(a.submissionTimestamp || a.createdAt);
  });
}

function paginateItems<T>(items: T[], page = 1, pageSize = 15): PaginatedResult<T> {
  const safePageSize = Math.max(1, Math.min(200, pageSize));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

export class SupabaseApiClient implements BackendApiClient {
  mode = 'supabase' as const;
  private cachedUser: UserProfile | null = null;
  private cachedConfig: AppConfiguration | null = null;

  constructor(
    private readonly client: SupabaseClient<Database> = getSupabaseClient(),
    private readonly onSessionExpired?: (reason?: string) => void,
  ) {}

  invalidateWorkspaceCache(): void {
    this.cachedUser = null;
    this.cachedConfig = null;
  }

  reloadPersistedWorkspace(): void {
    this.invalidateWorkspaceCache();
  }

  private mapSupabaseError<T>(err: unknown, fallbackMessage: string): ApiResponse<T> {
    const e = (err && typeof err === 'object' ? err : {}) as {
      code?: string;
      message?: string;
      details?: string;
      status?: number;
    };
    const rawCode = String(e.code ?? '').trim();
    const msg = String(e.message ?? '').trim() || fallbackMessage;
    const lowerMsg = msg.toLowerCase();

    if (
      rawCode === '42501' ||
      lowerMsg.includes('jwt expired') ||
      lowerMsg.includes('authentication required') ||
      lowerMsg.includes('unauthorized')
    ) {
      if (lowerMsg.includes('jwt expired') || lowerMsg.includes('invalid jwt')) {
        this.onSessionExpired?.('Your session expired. Please sign in again.');
      }
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: msg,
      };
    }

    if (rawCode === '23505') {
      return { ok: false, code: 'DUPLICATE', error: msg };
    }
    if (rawCode === '23503') {
      return { ok: false, code: 'FOREIGN_KEY_CONFLICT', error: msg };
    }
    if (rawCode === 'P0002') {
      return { ok: false, code: 'NOT_FOUND', error: msg };
    }
    if (rawCode === '22023') {
      return { ok: false, code: 'VALIDATION_ERROR', error: msg };
    }
    return { ok: false, code: rawCode || 'SUPABASE_ERROR', error: msg };
  }

  private async ensureSignedIn(): Promise<
    { ok: true; authUserId: string; user: UserProfile } | { ok: false; response: ApiResponse<never> }
  > {
    const { data: sessionData, error: sessionErr } = await this.client.auth.getSession();
    if (sessionErr || !sessionData.session) {
      this.cachedUser = null;
      return {
        ok: false,
        response: {
          ok: false,
          code: 'UNAUTHENTICATED',
          error: 'Sign in required to access the programme database.',
        },
      };
    }

    if (this.cachedUser) {
      return {
        ok: true,
        authUserId: sessionData.session.user.id,
        user: this.cachedUser,
      };
    }

    const profileRes = await this.getCurrentUser();
    if (!profileRes.ok || !profileRes.data) {
      return {
        ok: false,
        response: {
          ok: false,
          code: profileRes.code || 'UNAUTHORIZED',
          error: profileRes.error || 'Unable to verify your profile.',
        },
      };
    }

    return {
      ok: true,
      authUserId: sessionData.session.user.id,
      user: profileRes.data,
    };
  }

  private async ensureSuperAdmin(): Promise<
    { ok: true; authUserId: string; user: UserProfile } | { ok: false; response: ApiResponse<never> }
  > {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth;
    if (
      auth.user.role !== 'super_admin' ||
      !isAllowlistedSuperAdmin(auth.user.email) ||
      !auth.user.active ||
      auth.user.status === 'PENDING' ||
      auth.user.status === 'DENIED'
    ) {
      return {
        ok: false,
        response: {
          ok: false,
          code: 'UNAUTHORIZED',
          error: 'Super Administrator access required.',
        },
      };
    }
    return auth;
  }

  private async invokeSheetsEdgeFunction<T>(
    body: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    if (!this.client.functions?.invoke) {
      return {
        ok: false,
        code: 'EDGE_FUNCTION_UNAVAILABLE',
        error: 'Supabase Edge Functions client is unavailable.',
      };
    }

    try {
      const { data, error } = await this.client.functions.invoke('google-sheets-sync', {
        body,
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        let parsedError = '';
        if (ctx && typeof ctx.json === 'function') {
          const errJson = (await ctx.clone().json().catch(() => null)) as
            | { error?: string; message?: string }
            | null;
          parsedError = errJson?.error || errJson?.message || '';
        }
        return {
          ok: false,
          code: 'EDGE_FUNCTION_ERROR',
          error: parsedError || error.message || 'Google Sheets sync function failed.',
        };
      }

      const payload = (data && typeof data === 'object' ? data : null) as
        | { ok?: boolean; data?: T; error?: string }
        | null;

      if (!payload) {
        return {
          ok: false,
          code: 'EMPTY_RESPONSE',
          error: 'Empty response from Google Sheets sync function.',
        };
      }

      if (payload.ok === false) {
        return {
          ok: false,
          code: 'EDGE_FUNCTION_REJECTED',
          error: payload.error || 'Google Sheets sync rejected.',
        };
      }

      return {
        ok: true,
        data: (payload.data !== undefined ? payload.data : (payload as unknown as T)),
      };
    } catch (err) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        error: err instanceof Error ? err.message : 'Failed to invoke Google Sheets sync function.',
      };
    }
  }

  private triggerBackgroundSessionSync(sessionRecordId: string): void {
    if (!sessionRecordId || !this.client.functions?.invoke) return;
    void this.client.functions
      .invoke('google-sheets-sync', {
        body: { action: 'sync_session', sessionRecordId },
      })
      .catch(() => undefined);
  }

  private async fetchAllSubmissions(ownerAuthId?: string): Promise<SessionRecord[]> {
    const collected: SessionRecord[] = [];
    const batchSize = 1000;
    let from = 0;

    while (true) {
      let query = this.client
        .from('form_submissions')
        .select('*, form_submission_classes(*), profiles!form_submissions_user_id_fkey(user_code)')
        .order('start_date', { ascending: false })
        .order('submitted_at', { ascending: false })
        .range(from, from + batchSize - 1);

      if (ownerAuthId) {
        query = query.eq('user_id', ownerAuthId);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as unknown as JoinedSubmissionRow[];
      for (const row of rows) {
        collected.push(mapSubmissionRowToSessionRecord(row));
      }
      if (rows.length < batchSize) break;
      from += batchSize;
    }

    return sortSessionsNewestFirst(collected);
  }

  async pingHealth(): Promise<ApiResponse<BackendHealthInfo>> {
    try {
      const { data: sessionData } = await this.client.auth.getSession();
      let connectedToGoogleSheets = false;

      if (sessionData.session) {
        const profile = this.cachedUser ?? (await this.getCurrentUser()).data ?? null;
        if (profile?.role === 'super_admin' && isAllowlistedSuperAdmin(profile.email)) {
          const { data: conn } = await this.client.rpc('get_sheets_connection_state');
          if (conn && typeof conn === 'object') {
            connectedToGoogleSheets = Boolean((conn as Record<string, unknown>).connected);
          }
        }
      }

      return {
        ok: true,
        data: {
          mode: 'supabase',
          connectedToGoogleSheets,
          status: 'SUPABASE_READY',
          checkedAt: new Date().toISOString(),
          endpointConfigured: true,
          databaseProvider: 'Supabase PostgreSQL',
        },
      };
    } catch (err) {
      return this.mapSupabaseError(err, 'Unable to reach Supabase backend.');
    }
  }

  async getCurrentUser(): Promise<ApiResponse<UserProfile>> {
    const { data: sessionData, error: sessionErr } = await this.client.auth.getSession();
    if (sessionErr || !sessionData.session) {
      this.cachedUser = null;
      return {
        ok: false,
        code: 'UNAUTHENTICATED',
        error: 'No active Supabase session.',
      };
    }

    const { data, error } = await this.client.rpc('get_my_profile');
    if (error || !data || typeof data !== 'object') {
      this.cachedUser = null;
      return this.mapSupabaseError(error, 'Failed to load authenticated profile.');
    }

    const p = data as Record<string, unknown>;
    const rawEmail = normalizeEmail(String(p.email ?? sessionData.session.user.email ?? ''));
    const rawRole: UserRole =
      p.role === 'super_admin' && isAllowlistedSuperAdmin(rawEmail)
        ? 'super_admin'
        : 'facilitator';
    const rawStatus = String(p.status ?? 'PENDING').toUpperCase();
    const status: UserApprovalStatus =
      rawStatus === 'APPROVED' ? 'APPROVED' : rawStatus === 'DENIED' ? 'DENIED' : 'PENDING';

    const user: UserProfile = {
      userId: String(p.userId ?? ''),
      name: String(p.name ?? rawEmail),
      email: rawEmail,
      role: rawRole,
      active: Boolean(p.active) && status === 'APPROVED',
      status,
      authMode: 'supabase',
      organisationId: typeof p.organisationId === 'string' ? p.organisationId : undefined,
      organisationName:
        typeof p.organisationName === 'string' ? p.organisationName : 'Vidhya Vidhai Foundation',
    };

    this.cachedUser = user;
    return { ok: true, data: user };
  }

  async changeSuperAdminPassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<ApiResponse<{ updated: boolean; updatedAt: string }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    if (!currentPassword) {
      return {
        ok: false,
        code: 'INVALID_CURRENT_PASSWORD',
        error: 'Enter your current password.',
      };
    }
    if (newPassword.trim().length < 8) {
      return {
        ok: false,
        code: 'WEAK_PASSWORD',
        error: 'New password must be at least 8 characters.',
      };
    }

    const { error: verifyErr } = await this.client.auth.signInWithPassword({
      email: adminCheck.user.email,
      password: currentPassword,
    });
    if (verifyErr) {
      return {
        ok: false,
        code: 'INVALID_CURRENT_PASSWORD',
        error:
          'Current password is incorrect (if this account uses Google Sign-In only, use Forgot password on the login screen to set an initial email password).',
      };
    }

    const { error: updateErr } = await this.client.auth.updateUser({
      password: newPassword,
    });
    if (updateErr) {
      return this.mapSupabaseError(updateErr, 'Failed to update password.');
    }

    void this.client
      .rpc('log_user_activity', {
        p_activity_type: 'PASSWORD_UPDATED',
        p_description: 'Super Administrator updated account password',
        p_metadata: {},
      })
      .then(undefined, () => undefined);

    return {
      ok: true,
      data: {
        updated: true,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  async getAppConfiguration(): Promise<ApiResponse<AppConfiguration>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    if (auth.user.status !== 'APPROVED' || !auth.user.active) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Account approval required before loading settings.',
      };
    }

    const { data, error } = await this.client.rpc('get_sanitized_app_settings');
    if (error) {
      return this.mapSupabaseError(error, 'Failed to load programme configuration.');
    }
    const normalized = normalizeAppConfiguration(data);
    this.cachedConfig = normalized;
    return { ok: true, data: normalized };
  }

  async saveAppConfiguration(
    configPatch: Partial<AppConfiguration>,
  ): Promise<ApiResponse<AppConfiguration>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const currentRes = await this.getAppConfiguration();
    const base =
      currentRes.ok && currentRes.data
        ? currentRes.data
        : this.cachedConfig ?? DEFAULT_APP_CONFIGURATION;
    const merged = normalizeAppConfiguration({
      ...base,
      ...configPatch,
      reportingDefaults: {
        ...base.reportingDefaults,
        ...(configPatch.reportingDefaults ?? {}),
      },
      policy: {
        ...base.policy,
        ...(configPatch.policy ?? {}),
      },
      stateName: 'Tamil Nadu',
      allowedDistricts: [...APPROVED_DISTRICTS],
    });

    const { data, error } = await this.client.rpc('admin_save_app_settings', {
      p_config: merged as unknown as Json,
    });
    if (error) {
      return this.mapSupabaseError(error, 'Failed to save system configuration.');
    }
    const saved = normalizeAppConfiguration(data);
    this.cachedConfig = saved;
    return { ok: true, data: saved };
  }

  async createSession(
    values: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[]; schoolUdiseConflict?: string }>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    const { data, error } = await this.client.rpc('submit_form_session', {
      p_values: values as unknown as Json,
    });

    if (error || !data || typeof data !== 'object') {
      return this.mapSupabaseError(error, 'Failed to save session to Supabase PostgreSQL.');
    }

    const resObj = data as Record<string, unknown>;
    const session = normalizeJsonSessionRecord(resObj.session);
    const warnings = Array.isArray(resObj.warnings) ? resObj.warnings.map(String) : [];
    const schoolUdiseConflict =
      typeof resObj.schoolUdiseConflict === 'string' && resObj.schoolUdiseConflict
        ? resObj.schoolUdiseConflict
        : undefined;

    if (session.sessionRecordId) {
      this.triggerBackgroundSessionSync(session.sessionRecordId);
    }

    return {
      ok: true,
      data: {
        session,
        warnings,
        schoolUdiseConflict,
      },
      warnings,
    };
  }

  async updateSession(
    sessionRecordId: string,
    values: SessionFormValues,
  ): Promise<ApiResponse<{ session: SessionRecord; warnings: string[] }>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    const { data, error } = await this.client.rpc('update_form_session', {
      p_session_record_id: sessionRecordId,
      p_values: values as unknown as Json,
    });

    if (error || !data || typeof data !== 'object') {
      return this.mapSupabaseError(error, 'Failed to update session in Supabase PostgreSQL.');
    }

    const resObj = data as Record<string, unknown>;
    const session = normalizeJsonSessionRecord(resObj.session);
    const warnings = Array.isArray(resObj.warnings) ? resObj.warnings.map(String) : [];

    if (session.sessionRecordId) {
      this.triggerBackgroundSessionSync(session.sessionRecordId);
    }

    return {
      ok: true,
      data: {
        session,
        warnings,
      },
      warnings,
    };
  }

  async archiveSession(sessionRecordId: string): Promise<ApiResponse<{ archived: boolean }>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    const { data, error } = await this.client.rpc('archive_or_restore_form_session', {
      p_session_record_id: sessionRecordId,
      p_archived: true,
    });
    if (error) {
      return this.mapSupabaseError(error, 'Failed to archive session.');
    }
    const obj = (data && typeof data === 'object' ? data : {}) as { archived?: boolean };
    return { ok: true, data: { archived: Boolean(obj.archived ?? true) } };
  }

  async restoreSession(sessionRecordId: string): Promise<ApiResponse<{ archived: boolean }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('archive_or_restore_form_session', {
      p_session_record_id: sessionRecordId,
      p_archived: false,
    });
    if (error) {
      return this.mapSupabaseError(error, 'Failed to restore session.');
    }
    const obj = (data && typeof data === 'object' ? data : {}) as { archived?: boolean };
    return { ok: true, data: { archived: Boolean(obj.archived ?? false) } };
  }

  async deleteSession(
    sessionRecordId: string,
  ): Promise<ApiResponse<{ deleted: boolean; deletedDetailsCount: number }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { count, error: countErr } = await this.client
      .from('form_submission_classes')
      .select('id', { head: true, count: 'exact' })
      .eq('session_record_id', sessionRecordId);

    if (countErr) {
      return this.mapSupabaseError(countErr, 'Failed to inspect linked class detail rows.');
    }

    const { data: deletedRows, error: delErr } = await this.client
      .from('form_submissions')
      .delete()
      .eq('session_record_id', sessionRecordId)
      .select('session_record_id');

    if (delErr) {
      return this.mapSupabaseError(delErr, 'Failed to permanently delete session.');
    }

    if (!deletedRows || deletedRows.length === 0) {
      return { ok: false, code: 'NOT_FOUND', error: 'Session record was not found.' };
    }

    return {
      ok: true,
      data: {
        deleted: true,
        deletedDetailsCount: Number(count ?? 0),
      },
    };
  }

  async bulkDeleteSessions(
    sessionRecordIds: string[],
  ): Promise<ApiResponse<{ deletedCount: number; deletedDetailsCount: number }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const cleanIds = sessionRecordIds.map((id) => id.trim()).filter(Boolean);
    if (cleanIds.length === 0) {
      return { ok: true, data: { deletedCount: 0, deletedDetailsCount: 0 } };
    }

    const { count, error: countErr } = await this.client
      .from('form_submission_classes')
      .select('id', { head: true, count: 'exact' })
      .in('session_record_id', cleanIds);

    if (countErr) {
      return this.mapSupabaseError(countErr, 'Failed to inspect linked class detail rows.');
    }

    const { data: deletedRows, error: delErr } = await this.client
      .from('form_submissions')
      .delete()
      .in('session_record_id', cleanIds)
      .select('session_record_id');

    if (delErr) {
      return this.mapSupabaseError(delErr, 'Bulk delete failed.');
    }

    return {
      ok: true,
      data: {
        deletedCount: deletedRows?.length ?? 0,
        deletedDetailsCount: Number(count ?? 0),
      },
    };
  }

  async getSessionById(sessionRecordId: string): Promise<ApiResponse<SessionRecord>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    const { data, error } = await this.client
      .from('form_submissions')
      .select('*, form_submission_classes(*), profiles!form_submissions_user_id_fkey(user_code)')
      .eq('session_record_id', sessionRecordId)
      .maybeSingle();

    if (error) {
      return this.mapSupabaseError(error, 'Failed to load session details.');
    }
    if (!data) {
      return { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' };
    }

    const mapped = mapSubmissionRowToSessionRecord(data as unknown as JoinedSubmissionRow);
    const isAdmin =
      auth.user.role === 'super_admin' && isAllowlistedSuperAdmin(auth.user.email);
    if (!isAdmin && normalizeEmail(mapped.facilitatorEmail) !== normalizeEmail(auth.user.email)) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'You can only view your own session records.',
      };
    }

    return { ok: true, data: mapped };
  }

  async getMySessions(
    filters: SessionQueryFilters,
  ): Promise<ApiResponse<PaginatedResult<SessionRecord>>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    try {
      const [ownRows, cfgRes] = await Promise.all([
        this.fetchAllSubmissions(auth.authUserId),
        this.cachedConfig
          ? Promise.resolve({ ok: true as const, data: this.cachedConfig })
          : this.getAppConfiguration(),
      ]);
      const cfg = cfgRes.ok && cfgRes.data ? cfgRes.data : DEFAULT_APP_CONFIGURATION;
      const { included } = filterSessionRecords(
        ownRows,
        {
          ...filters,
          includeArchived: Boolean(filters.includeArchived),
        },
        cfg,
      );
      return {
        ok: true,
        data: paginateItems(included, filters.page ?? 1, filters.pageSize ?? 15),
      };
    } catch (err) {
      return this.mapSupabaseError(err, 'Failed to load your submitted classes.');
    }
  }

  async getAdminSessions(
    filters: SessionQueryFilters,
  ): Promise<ApiResponse<PaginatedResult<SessionRecord>>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    try {
      const [allRows, cfgRes] = await Promise.all([
        this.fetchAllSubmissions(),
        this.cachedConfig
          ? Promise.resolve({ ok: true as const, data: this.cachedConfig })
          : this.getAppConfiguration(),
      ]);
      const cfg = cfgRes.ok && cfgRes.data ? cfgRes.data : DEFAULT_APP_CONFIGURATION;
      const { included } = filterSessionRecords(allRows, filters, cfg);
      return {
        ok: true,
        data: paginateItems(included, filters.page ?? 1, filters.pageSize ?? 15),
      };
    } catch (err) {
      return this.mapSupabaseError(err, 'Failed to load global programme submissions.');
    }
  }

  async getDashboardSummary(
    filters: SessionQueryFilters,
  ): Promise<ApiResponse<DashboardAnalytics>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    try {
      const [allRows, cfgRes] = await Promise.all([
        this.fetchAllSubmissions(),
        this.cachedConfig
          ? Promise.resolve({ ok: true as const, data: this.cachedConfig })
          : this.getAppConfiguration(),
      ]);
      const cfg = cfgRes.ok && cfgRes.data ? cfgRes.data : DEFAULT_APP_CONFIGURATION;
      const analytics = computeDashboardAnalytics(
        allRows,
        {
          ...filters,
          includeArchived: false,
        },
        cfg,
      );
      const pendingExcluded = allRows.filter(
        (s) => !s.archived && s.submissionStatus === 'PENDING',
      ).length;
      analytics.dataQuality.excludedPendingCount = Math.max(
        analytics.dataQuality.excludedPendingCount,
        pendingExcluded,
      );
      return { ok: true, data: analytics };
    } catch (err) {
      return this.mapSupabaseError(err, 'Failed to compute dashboard analytics.');
    }
  }

  async getSchoolByUdise(udiseCode: string): Promise<ApiResponse<SchoolRecord | null>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    const clean = udiseCode.replace(/\D/g, '').trim();
    if (clean.length !== 11) {
      return { ok: true, data: null };
    }

    const { data, error } = await this.client
      .from('schools')
      .select('*')
      .eq('udise_code', clean)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      return this.mapSupabaseError(error, 'Failed to look up UDISE school directory.');
    }

    return { ok: true, data: data ? mapSchoolRow(data) : null };
  }

  async searchSchools(
    query: string,
    includeInactive = false,
  ): Promise<ApiResponse<SchoolRecord[]>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    let dbQuery = this.client
      .from('schools')
      .select('*')
      .order('school_name', { ascending: true });

    if (!includeInactive) {
      dbQuery = dbQuery.eq('active', true);
    }

    const { data, error } = await dbQuery;
    if (error) {
      return this.mapSupabaseError(error, 'Failed to search schools.');
    }

    const q = query.trim().toLowerCase();
    const mapped = (data ?? []).map(mapSchoolRow).filter((sc) => {
      if (!q) return true;
      return (
        sc.schoolName.toLowerCase().includes(q) ||
        sc.udiseCode.includes(q) ||
        sc.district.toLowerCase().includes(q) ||
        sc.pinCode.includes(q)
      );
    });

    return { ok: true, data: mapped };
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
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('update_school_master', {
      p_school_record_id: school.schoolRecordId,
      p_school_name: school.schoolName,
      p_udise_code: school.udiseCode,
      p_school_type: school.schoolType,
      p_state: school.state || 'Tamil Nadu',
      p_district: school.district,
      p_pin_code: school.pinCode,
      p_active: school.active,
    });

    if (error || !data || typeof data !== 'object') {
      return this.mapSupabaseError(error, 'Failed to update school master record.');
    }

    return { ok: true, data: data as unknown as SchoolRecord };
  }

  async deleteSchool(
    schoolRecordIdOrUdise: string,
  ): Promise<ApiResponse<{ deleted: boolean; udiseCode: string }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const clean = schoolRecordIdOrUdise.trim();
    const isUdise = /^\d{11}$/.test(clean);

    const { data, error } = await this.client
      .from('schools')
      .delete()
      .eq(isUdise ? 'udise_code' : 'school_record_id', clean)
      .select('udise_code');

    if (error) {
      return this.mapSupabaseError(error, 'Failed to remove school record.');
    }
    if (!data || data.length === 0) {
      return { ok: false, code: 'NOT_FOUND', error: 'School record not found.' };
    }

    return {
      ok: true,
      data: {
        deleted: true,
        udiseCode: data[0]!.udise_code,
      },
    };
  }

  async listManagedUsers(): Promise<ApiResponse<ManagedUser[]>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('list_managed_directory');
    if (error) {
      return this.mapSupabaseError(error, 'Failed to load user directory.');
    }
    const arr = Array.isArray(data) ? (data as unknown as ManagedUser[]) : [];
    return { ok: true, data: arr };
  }

  async manageUser(userInput: {
    userId?: string;
    name: string;
    email: string;
    role: UserRole;
    active: boolean;
    status?: UserApprovalStatus;
  }): Promise<ApiResponse<ManagedUser>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('admin_manage_facilitator', {
      p_user_id: userInput.userId ?? '',
      p_name: userInput.name,
      p_email: normalizeEmail(userInput.email),
      p_role: userInput.role,
      p_active: userInput.active,
      p_status: userInput.status ?? (userInput.active ? 'APPROVED' : 'DENIED'),
    });

    if (error || !data || typeof data !== 'object') {
      return this.mapSupabaseError(error, 'Failed to save user access entry.');
    }

    return { ok: true, data: data as unknown as ManagedUser };
  }

  async deleteUser(
    userIdOrEmail: string,
  ): Promise<ApiResponse<{ deleted: boolean; email: string }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const targetInput = userIdOrEmail.trim();
    const dirRes = await this.listManagedUsers();
    const matched = dirRes.ok && dirRes.data
      ? dirRes.data.find(
          (u) =>
            u.userId === targetInput ||
            normalizeEmail(u.email) === normalizeEmail(targetInput),
        )
      : undefined;

    const targetEmail = matched ? normalizeEmail(matched.email) : normalizeEmail(targetInput);
    if (isAllowlistedSuperAdmin(targetEmail)) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Allowlisted Super Administrators cannot be removed.',
      };
    }

    if (matched?.userId.startsWith('PRE_') || targetInput.startsWith('PRE_')) {
      const { data: deletedPre, error: preErr } = await this.client
        .from('facilitator_preapprovals')
        .delete()
        .eq('email', targetEmail)
        .select('email');

      if (preErr) {
        return this.mapSupabaseError(preErr, 'Failed to remove preapproved facilitator.');
      }
      if (!deletedPre || deletedPre.length === 0) {
        return { ok: false, code: 'NOT_FOUND', error: 'Preapproved facilitator not found.' };
      }
      return { ok: true, data: { deleted: true, email: deletedPre[0]!.email } };
    }

    let delQuery = this.client.from('profiles').delete();
    if (matched?.userId) {
      delQuery = delQuery.eq('user_code', matched.userId);
    } else if (targetInput.includes('@')) {
      delQuery = delQuery.eq('email', targetEmail);
    } else {
      delQuery = delQuery.eq('user_code', targetInput);
    }

    const { data: deletedProfile, error: profErr } = await delQuery.select('email');
    if (profErr) {
      return this.mapSupabaseError(profErr, 'Failed to delete user profile.');
    }
    if (!deletedProfile || deletedProfile.length === 0) {
      return { ok: false, code: 'NOT_FOUND', error: 'User profile not found.' };
    }

    return { ok: true, data: { deleted: true, email: deletedProfile[0]!.email } };
  }

  async getAuditLogs(
    page = 1,
    pageSize = 25,
  ): Promise<ApiResponse<PaginatedResult<AuditLogEntry>>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const safePageSize = Math.max(1, Math.min(200, pageSize));
    const safePage = Math.max(1, page);
    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;

    const { data, count, error } = await this.client
      .from('submission_audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return this.mapSupabaseError(error, 'Failed to load audit log.');
    }

    const total = Number(count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const items: AuditLogEntry[] = (data ?? []).map((row) => ({
      auditId: row.audit_code,
      timestamp: normalizeIsoTimestamp(row.created_at),
      userId: row.performed_by ?? '',
      userEmail: row.actor_email,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      previousSummary: row.previous_summary,
      newSummary: row.new_summary,
      result:
        row.result === 'DENIED' || row.result === 'FAILED' ? row.result : 'SUCCESS',
    }));

    return {
      ok: true,
      data: {
        items,
        total,
        page: safePage,
        pageSize: safePageSize,
        totalPages,
      },
    };
  }

  async getSyncLogs(
    page = 1,
    pageSize = 25,
  ): Promise<ApiResponse<PaginatedResult<SyncLogEntry>>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const safePageSize = Math.max(1, Math.min(200, pageSize));
    const safePage = Math.max(1, page);
    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;

    const { data, count, error } = await this.client
      .from('sync_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return this.mapSupabaseError(error, 'Failed to load sync history.');
    }

    const total = Number(count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const items: SyncLogEntry[] = (data ?? []).map((row) => ({
      syncId: row.sync_code,
      timestamp: normalizeIsoTimestamp(row.last_attempt_at || row.created_at),
      clientSubmissionKey: row.client_submission_key,
      sessionRecordId: row.session_record_id,
      sessionId: row.session_id,
      actorEmail: row.actor_email,
      operation: row.operation,
      attempt: Number(row.retry_count) || 1,
      status:
        row.sync_status === 'FAILED' ||
        row.sync_status === 'PENDING_RETRY' ||
        row.sync_status === 'LOCAL_SANDBOX'
          ? row.sync_status
          : 'SYNCED',
      errorMessage: row.error_message,
    }));

    return {
      ok: true,
      data: {
        items,
        total,
        page: safePage,
        pageSize: safePageSize,
        totalPages,
      },
    };
  }

  async logExportEvent(
    scope: string,
    rowCount: number,
    format: string,
  ): Promise<ApiResponse<{ logged: boolean }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('log_export_event', {
      p_scope: scope,
      p_row_count: rowCount,
      p_format: format,
    });
    if (error) {
      return this.mapSupabaseError(error, 'Failed to log export event.');
    }
    const obj = (data && typeof data === 'object' ? data : {}) as { logged?: boolean };
    return { ok: true, data: { logged: Boolean(obj.logged ?? true) } };
  }

  async getSheetsConnection(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('get_sheets_connection_state');
    if (error) {
      return this.mapSupabaseError(error, 'Failed to load Google Sheets bridge status.');
    }
    return { ok: true, data: normalizeSheetsConnection(data) };
  }

  async listGoogleSpreadsheets(): Promise<ApiResponse<GoogleSpreadsheetSummary[]>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const connRes = await this.getSheetsConnection();
    const conn = connRes.ok && connRes.data ? connRes.data : null;
    const summary: GoogleSpreadsheetSummary = {
      spreadsheetId: conn?.spreadsheetId || DEFAULT_TARGET_SPREADSHEET_ID,
      name: conn?.spreadsheetName || 'Career Tours Live Sheet',
      url: conn?.spreadsheetUrl || DEFAULT_TARGET_SPREADSHEET_URL,
      modifiedTime: conn?.lastSyncedAt || undefined,
    };
    return { ok: true, data: [summary] };
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
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    try {
      const [sessionsRes, schoolsRes, usersRes] = await Promise.all([
        this.client
          .from('form_submissions')
          .select('district, sync_status')
          .eq('archived', false),
        this.client.from('schools').select('id', { head: true, count: 'exact' }),
        this.listManagedUsers(),
      ]);

      const rows = sessionsRes.data ?? [];
      const unsynced = rows.filter((r) => r.sync_status !== 'SYNCED').length;
      const districts = Array.from(new Set(rows.map((r) => r.district).filter(Boolean)));
      const facilitatorsCount =
        usersRes.ok && usersRes.data
          ? usersRes.data.filter((u) => !isAllowlistedSuperAdmin(u.email)).length
          : 0;

      return {
        ok: true,
        data: {
          sessionsCount: rows.length,
          unsyncedSessionsCount: unsynced,
          schoolsCount: Number(schoolsRes.count ?? 0),
          facilitatorsCount,
          districts,
        },
      };
    } catch (err) {
      return this.mapSupabaseError(err, 'Failed to summarize workspace sync preview.');
    }
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
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const cleanId =
      parseGoogleSpreadsheetId(params.spreadsheetUrlOrId) || DEFAULT_TARGET_SPREADSHEET_ID;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/edit?gid=0#gid=0`;

    let cleanWebhookUrl: string | undefined;
    if (params.appsScriptUrl !== undefined) {
      const trimmed = params.appsScriptUrl.trim();
      if (trimmed) {
        const check = validateAppsScriptWebAppUrl(trimmed);
        if (!check.valid) {
          return {
            ok: false,
            code: 'INVALID_WEBHOOK_URL',
            error: check.error || 'Enter a valid HTTPS Google Apps Script Web App URL.',
          };
        }
        cleanWebhookUrl = check.normalized;
      } else {
        cleanWebhookUrl = '';
      }
    }

    const payload: Record<string, unknown> = {
      connected: true,
      authMethod: 'apps_script',
      connectionProvider: 'apps_script',
      connectedAccount: params.googleAccount || adminCheck.user.email,
      spreadsheetId: cleanId,
      spreadsheetName: params.spreadsheetName?.trim() || 'Career Tours Live Sheet',
      spreadsheetUrl: sheetUrl,
      lastSyncStatus: 'IDLE',
      lastSyncMessage: cleanWebhookUrl
        ? 'Connected Apps Script webhook to Supabase Edge Function.'
        : 'Linked spreadsheet reference in Supabase.',
    };
    if (cleanWebhookUrl !== undefined) {
      payload.appsScriptUrl = cleanWebhookUrl;
    }

    const { data, error } = await this.client.rpc('admin_save_sheets_connection', {
      p_payload: payload as Json,
    });
    if (error) {
      return this.mapSupabaseError(error, 'Failed to save Google Sheets connection.');
    }
    return { ok: true, data: normalizeSheetsConnection(data) };
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
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const cleanTitle = params.title.trim() || 'Vidhya Vidhai · Career Tours Sheet';
    if (params.appsScriptUrl?.trim()) {
      return this.connectGoogleSheet({
        spreadsheetUrlOrId: DEFAULT_TARGET_SPREADSHEET_ID,
        spreadsheetName: cleanTitle,
        googleAccount: params.googleAccount || adminCheck.user.email,
        appsScriptUrl: params.appsScriptUrl,
      });
    }

    return {
      ok: false,
      code: 'WEBHOOK_REQUIRED',
      error:
        'In Supabase mode, Supabase PostgreSQL is your primary database. Link an existing Google Sheet ID + Apps Script Web App URL to mirror rows via the Edge Function.',
    };
  }

  async disconnectGoogleSheet(): Promise<ApiResponse<GoogleSheetsConnectionState>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('admin_save_sheets_connection', {
      p_payload: {
        connected: false,
        appsScriptUrl: '',
        lastSyncStatus: 'IDLE',
        lastSyncMessage:
          'Google Sheets secondary mirror disconnected. All programme records remain in Supabase PostgreSQL.',
      } as Json,
    });
    if (error) {
      return this.mapSupabaseError(error, 'Failed to disconnect Google Sheets mirror.');
    }
    return { ok: true, data: normalizeSheetsConnection(data) };
  }

  async testSheetsWebhook(
    appsScriptUrl: string,
    spreadsheetId?: string,
  ): Promise<ApiResponse<{ reachable: boolean; status: number; message: string }>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const check = validateAppsScriptWebAppUrl(appsScriptUrl);
    if (!check.valid) {
      return {
        ok: false,
        code: 'INVALID_WEBHOOK_URL',
        error: check.error || 'Enter a valid HTTPS Google Apps Script Web App URL.',
      };
    }

    return this.invokeSheetsEdgeFunction<{
      reachable: boolean;
      status: number;
      message: string;
    }>({
      action: 'test_webhook',
      appsScriptUrl: check.normalized,
      spreadsheetId: spreadsheetId || DEFAULT_TARGET_SPREADSHEET_ID,
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
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const check = validateAppsScriptWebAppUrl(params.appsScriptUrl);
    if (!check.valid) {
      return {
        ok: false,
        code: 'INVALID_WEBHOOK_URL',
        error: check.error || 'Enter a valid HTTPS Google Apps Script Web App URL.',
      };
    }

    const connRes = await this.connectGoogleSheet({
      spreadsheetUrlOrId: params.spreadsheetUrlOrId || DEFAULT_TARGET_SPREADSHEET_ID,
      spreadsheetName: params.sheetTitle?.trim() || 'Career Tours Live Sheet',
      appsScriptUrl: check.normalized,
      googleAccount: adminCheck.user.email,
    });
    if (!connRes.ok || !connRes.data) {
      return {
        ok: false,
        code: connRes.code,
        error: connRes.error || 'Failed to store Apps Script webhook settings.',
      };
    }

    const syncRes = await this.syncAllToGoogleSheet({
      appsScriptUrl: check.normalized,
    });

    return {
      ok: true,
      data: {
        connection: connRes.data,
        syncSummary: syncRes.ok && syncRes.data ? syncRes.data : null,
      },
      warnings: !syncRes.ok && syncRes.error ? [syncRes.error] : undefined,
    };
  }

  async syncAllToGoogleSheet(opts?: {
    directClientId?: string;
    forceDirectOAuth?: boolean;
    appsScriptUrl?: string;
    syncKey?: string;
    forceAppsScriptBridge?: boolean;
  }): Promise<ApiResponse<SheetsSyncSummary>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    return this.invokeSheetsEdgeFunction<SheetsSyncSummary>({
      action: 'sync_all',
      ...(opts?.appsScriptUrl ? { appsScriptUrl: opts.appsScriptUrl.trim() } : {}),
    });
  }

  async getDatabaseHealth(): Promise<ApiResponse<DatabaseHealthReport>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('get_database_health');
    if (error) {
      return this.mapSupabaseError(error, 'Failed to check PostgreSQL database health.');
    }
    return { ok: true, data: data as unknown as DatabaseHealthReport };
  }

  async recoverDatabaseHealth(): Promise<ApiResponse<DatabaseHealthReport>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const { data, error } = await this.client.rpc('recover_database_health');
    if (error) {
      return this.mapSupabaseError(error, 'Failed to repair PostgreSQL database health.');
    }
    return { ok: true, data: data as unknown as DatabaseHealthReport };
  }

  async exportFacilitatorTransferPackage(): Promise<ApiResponse<SessionTransferPackage>> {
    const auth = await this.ensureSignedIn();
    if (!auth.ok) return auth.response;

    try {
      const own = await this.fetchAllSubmissions(auth.authUserId);
      const pkg = buildFacilitatorTransferPackage(own, {
        email: auth.user.email,
        name: auth.user.name,
      });
      return { ok: true, data: pkg };
    } catch (err) {
      return this.mapSupabaseError(err, 'Failed to export session transfer package.');
    }
  }

  async exportDatabaseBackupPackage(): Promise<ApiResponse<DatabaseBackupPackage>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    try {
      const [sessions, schoolsRes, usersRes, cfgRes] = await Promise.all([
        this.fetchAllSubmissions(),
        this.searchSchools('', true),
        this.listManagedUsers(),
        this.getAppConfiguration(),
      ]);

      const pkg = buildDatabaseBackupPackage(
        {
          sessions,
          schools: schoolsRes.ok && schoolsRes.data ? schoolsRes.data : [],
          users: usersRes.ok && usersRes.data ? usersRes.data : [],
          configuration: cfgRes.ok && cfgRes.data ? cfgRes.data : DEFAULT_APP_CONFIGURATION,
        },
        {
          email: adminCheck.user.email,
          name: adminCheck.user.name,
        },
      );
      return { ok: true, data: pkg };
    } catch (err) {
      return this.mapSupabaseError(err, 'Failed to generate PostgreSQL database backup.');
    }
  }

  async importSessionsPackage(
    rawPayload: unknown,
  ): Promise<ApiResponse<ImportSessionsResult>> {
    const adminCheck = await this.ensureSuperAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const parsed = parseSessionTransferOrBackupPayload(rawPayload);
    if (!parsed.ok) {
      return { ok: false, code: 'INVALID_IMPORT_FILE', error: parsed.error };
    }

    const { data, error } = await this.client.rpc('admin_import_sessions', {
      p_sessions: parsed.sessions as unknown as Json,
    });
    if (error) {
      return this.mapSupabaseError(error, 'Failed to import sessions into PostgreSQL.');
    }

    return { ok: true, data: normalizeImportSessionsResult(data) };
  }
}
