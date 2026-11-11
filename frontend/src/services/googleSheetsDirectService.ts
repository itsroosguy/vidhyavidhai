import {
  INITIAL_SUPER_ADMINS,
  isAllowlistedSuperAdmin,
  normalizeEmail,
} from '../config/accessControl';
import {
  DEFAULT_APP_CONFIGURATION,
  DEFAULT_TARGET_SPREADSHEET_ID,
  DEFAULT_TARGET_SPREADSHEET_URL,
  PROGRAMME_TIMEZONE,
  generateUuid,
  parseGoogleSpreadsheetId,
} from '../config/defaults';
import { calculateSessionMetrics } from '../calculations/metrics';
import type {
  ApiResponse,
  AppConfiguration,
  AuditLogEntry,
  GoogleSheetsConnectionState,
  GoogleSpreadsheetSummary,
  ManagedUser,
  SchoolRecord,
  SessionDetailRecord,
  SessionFormValues,
  SessionRecord,
  SheetsSyncSummary,
  SyncLogEntry,
  UserApprovalStatus,
  UserRole,
} from '../types/domain';
import {
  buildSessionIdPrefix,
  formatSessionIdWithSequence,
  resolveConfiguredVideoId,
} from '../utils/sessionId';
import {
  calculateSessionDurationMinutes,
  formatDurationHuman,
  formatISODateToDDMMYYYY,
  getMonthNameFromISO,
  getTodayKolkataISO,
} from '../utils/temporal';
import { validateSessionForm } from '../validations/sessionValidation';
import {
  loadGoogleIdentityScript,
  validateGoogleOAuthClientId,
} from './authService';

export interface DirectGoogleTokenInfo {
  accessToken: string;
  email: string;
  name?: string;
  expiresAt: number;
  clientId: string;
}

export interface DirectSheetsSyncSummary extends SheetsSyncSummary {
  syncedSchoolsCount: number;
  syncedFacilitatorsCount: number;
}

export interface RelativeTitleInput {
  programmeName?: string;
  partnerName?: string;
  district?: string;
  sessions?: Array<Pick<SessionRecord, 'district' | 'startDate'>>;
  nowDate?: Date | string;
}

const DIRECT_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
  'profile',
].join(' ');

const MONTH_ABBR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PROGRAMME_TIMEZONE,
  month: 'short',
  year: 'numeric',
});

/**
 * Builds a deterministic, context-aware Google Spreadsheet title using real
 * programme metadata, active filter / session districts, and Asia/Kolkata month/year.
 * Never fabricates sample partner names, districts, or metric values.
 */
export function buildRelativeSpreadsheetTitle(input: RelativeTitleInput = {}): string {
  const partner = (input.partnerName ?? '').trim();
  const orgPrefix = partner || 'Vidhya Vidhai';
  const programme = (input.programmeName ?? '').trim() || 'Career Tours';

  let districtPart = '';
  const explicitDistrict = (input.district ?? '').trim();
  if (explicitDistrict && explicitDistrict.toUpperCase() !== 'ALL') {
    districtPart = explicitDistrict;
  } else if (Array.isArray(input.sessions) && input.sessions.length > 0) {
    const distinctDistricts = Array.from(
      new Set(
        input.sessions
          .map((s) => (s.district ?? '').trim())
          .filter(Boolean),
      ),
    ).sort();
    if (distinctDistricts.length === 1) {
      districtPart = distinctDistricts[0]!;
    } else if (distinctDistricts.length === 2) {
      districtPart = `${distinctDistricts[0]} & ${distinctDistricts[1]}`;
    } else if (distinctDistricts.length > 2) {
      districtPart = `${distinctDistricts.length} Districts`;
    }
  }

  let dateObj: Date;
  if (input.nowDate instanceof Date && !Number.isNaN(input.nowDate.getTime())) {
    dateObj = input.nowDate;
  } else if (typeof input.nowDate === 'string' && input.nowDate.trim()) {
    const parsed = new Date(input.nowDate);
    dateObj = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    dateObj = new Date();
  }
  const datePart = MONTH_ABBR_FORMATTER.format(dateObj);

  const rawTitle = [orgPrefix, programme, districtPart, datePart]
    .filter((part) => part.trim().length > 0)
    .join(' · ');
  return rawTitle.slice(0, 100);
}

// Module-memory OAuth token store ONLY — never written to localStorage or sessionStorage.
let memoryDirectToken: DirectGoogleTokenInfo | null = null;
const directTokenListeners = new Set<() => void>();

function notifyDirectTokenListeners(): void {
  for (const listener of directTokenListeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeDirectTokenState(listener: () => void): () => void {
  directTokenListeners.add(listener);
  return () => {
    directTokenListeners.delete(listener);
  };
}

export function getDirectGoogleSheetsTokenInfo(
  expectedEmail?: string,
  minRemainingMs = 30_000,
): DirectGoogleTokenInfo | null {
  if (!memoryDirectToken) return null;
  if (memoryDirectToken.expiresAt - Date.now() <= minRemainingMs) {
    memoryDirectToken = null;
    notifyDirectTokenListeners();
    return null;
  }
  if (expectedEmail) {
    const cleanExpected = normalizeEmail(expectedEmail);
    if (cleanExpected && normalizeEmail(memoryDirectToken.email) !== cleanExpected) {
      return null;
    }
  }
  return { ...memoryDirectToken };
}

export function hasDirectSheetsAccessToken(expectedEmail?: string): boolean {
  return Boolean(getDirectGoogleSheetsTokenInfo(expectedEmail));
}

export function clearDirectGoogleSheetsToken(): void {
  if (!memoryDirectToken) return;
  memoryDirectToken = null;
  notifyDirectTokenListeners();
}

interface GisOAuth2TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

export async function requestDirectGoogleSheetsToken(
  rawClientId: string,
  loginHint?: string,
  options?: { prompt?: '' | 'consent' | 'select_account'; forceRefresh?: boolean },
): Promise<ApiResponse<DirectGoogleTokenInfo>> {
  const clientCheck = validateGoogleOAuthClientId(rawClientId);
  if (!clientCheck.valid) {
    return {
      ok: false,
      code: 'INVALID_CLIENT_ID',
      error: clientCheck.error || 'Enter a valid Google OAuth 2.0 Web Client ID.',
    };
  }
  const cleanClientId = clientCheck.normalized;
  const cleanHint = normalizeEmail(loginHint ?? '');

  if (!options?.forceRefresh) {
    const existing = getDirectGoogleSheetsTokenInfo(cleanHint || undefined, 60_000);
    if (existing && existing.clientId === cleanClientId) {
      return { ok: true, data: existing };
    }
  }

  try {
    await loadGoogleIdentityScript();
  } catch (err) {
    return {
      ok: false,
      code: 'GIS_LOAD_FAILED',
      error:
        err instanceof Error
          ? err.message
          : 'Unable to load Google Identity Services library in this browser.',
    };
  }

  const oauth2Api = (
    window as unknown as {
      google?: {
        accounts?: {
          oauth2?: {
            initTokenClient?: (cfg: {
              client_id: string;
              scope: string;
              hint?: string;
              prompt?: string;
              callback: (resp: GisOAuth2TokenResponse) => void;
              error_callback?: (err: { type?: string; message?: string }) => void;
            }) => GisTokenClient;
          };
        };
      };
    }
  ).google?.accounts?.oauth2;

  if (!oauth2Api || typeof oauth2Api.initTokenClient !== 'function') {
    return {
      ok: false,
      code: 'GIS_UNAVAILABLE',
      error: 'Google OAuth 2.0 Token Client is unavailable in this browser.',
    };
  }

  const promptMode = options?.prompt ?? 'consent';

  return new Promise<ApiResponse<DirectGoogleTokenInfo>>((resolve) => {
    let settled = false;
    const finish = (result: ApiResponse<DirectGoogleTokenInfo>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        ok: false,
        code: 'OAUTH_TIMEOUT',
        error: 'Timed out waiting for Google authorization popup. Please try again and allow popups.',
      });
    }, 90_000);

    try {
      const tokenClient = oauth2Api.initTokenClient!({
        client_id: cleanClientId,
        scope: DIRECT_SHEETS_SCOPES,
        ...(cleanHint ? { hint: cleanHint } : {}),
        prompt: promptMode,
        error_callback: (err) => {
          const type = err?.type ?? '';
          finish({
            ok: false,
            code: type === 'popup_closed' ? 'OAUTH_CANCELLED' : 'OAUTH_POPUP_ERROR',
            error:
              type === 'popup_failed_to_open'
                ? 'Browser blocked the Google sign-in popup. Allow popups for this site and retry.'
                : 'Google Sheets authorization popup was dismissed before granting access.',
          });
        },
        callback: (resp) => {
          void (async () => {
            if (resp.error || !resp.access_token) {
              finish({
                ok: false,
                code: 'OAUTH_DENIED',
                error:
                  resp.error_description ||
                  (resp.error ? `Google OAuth denied (${resp.error}).` : 'Google did not return an access token.'),
              });
              return;
            }

            try {
              const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${resp.access_token}` },
              });
              if (!userRes.ok) {
                finish({
                  ok: false,
                  code: 'USERINFO_FAILED',
                  error: 'Unable to verify the authorized Google account email.',
                });
                return;
              }
              const profile = (await userRes.json()) as {
                email?: string;
                email_verified?: boolean | string;
                name?: string;
              };
              const email = normalizeEmail(profile.email ?? '');
              if (!email || !isAllowlistedSuperAdmin(email)) {
                finish({
                  ok: false,
                  code: 'FORBIDDEN',
                  error: `Google account "${email || 'unknown'}" is not an approved Super Administrator.`,
                });
                return;
              }

              const expiresInSec = Number(resp.expires_in ?? 3599);
              const tokenInfo: DirectGoogleTokenInfo = {
                accessToken: resp.access_token,
                email,
                name: profile.name,
                expiresAt: Date.now() + Math.max(120, expiresInSec) * 1000,
                clientId: cleanClientId,
              };
              memoryDirectToken = tokenInfo;
              notifyDirectTokenListeners();
              finish({ ok: true, data: { ...tokenInfo } });
            } catch {
              finish({
                ok: false,
                code: 'NETWORK_ERROR',
                error: 'Network error while verifying Google account authorization.',
              });
            }
          })();
        },
      });

      tokenClient.requestAccessToken({
        prompt: promptMode,
        ...(cleanHint ? { hint: cleanHint } : {}),
      });
    } catch (err) {
      finish({
        ok: false,
        code: 'OAUTH_INIT_ERROR',
        error:
          err instanceof Error
            ? err.message
            : 'Unable to initialize Google OAuth token request.',
      });
    }
  });
}

// ---------- Canonical 10-Tab Schema & Formatting Helpers (aligned with api/sheets.mjs) ----------

interface SheetSchemaDef {
  name: string;
  headers: string[];
  textColumns: number[];
}

export const DIRECT_SHEETS_SCHEMA_DEFINITIONS: SheetSchemaDef[] = [
  {
    name: 'Sessions',
    headers: [
      'session_record_id',
      'session_id',
      'client_submission_key',
      'facilitator_name',
      'facilitator_email',
      'facilitator_user_id',
      'tour_id',
      'tour_name',
      'video_id',
      'language',
      'start_date',
      'end_date',
      'start_time',
      'end_time',
      'duration_minutes',
      'duration_formatted',
      'reporting_month',
      'submission_timestamp',
      'submission_date_formatted',
      'school_name',
      'udise_code',
      'school_type',
      'state',
      'district',
      'pin_code',
      'session_type',
      'total_classes',
      'total_students_present',
      'total_qa_responses',
      'total_qb_responses',
      'overall_csat',
      'overall_itp',
      'teacher_score',
      'teacher_classification',
      'teacher_nps',
      'submission_status',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
      'archived',
    ],
    textColumns: [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 25, 36, 37, 38, 41],
  },
  {
    name: 'Session Details',
    headers: [
      'detail_record_id',
      'session_record_id',
      'session_id',
      'grade',
      'section',
      'students_present',
      'qa_score_5',
      'qa_score_4',
      'qa_score_3',
      'qa_score_2',
      'qa_score_1',
      'qa_total',
      'qa_weighted_score',
      'csat',
      'qb_score_5',
      'qb_score_4',
      'qb_score_3',
      'qb_score_2',
      'qb_score_1',
      'qb_total',
      'qb_weighted_score',
      'itp',
      'created_at',
      'updated_at',
    ],
    textColumns: [1, 2, 3, 4, 5],
  },
  {
    name: 'Facilitators',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8],
  },
  {
    name: 'Schools',
    headers: [
      'school_record_id',
      'school_name',
      'udise_code',
      'school_type',
      'state',
      'district',
      'pin_code',
      'active',
      'created_at',
      'updated_at',
    ],
    textColumns: [1, 3, 7, 8],
  },
  {
    name: 'Configuration',
    headers: ['config_key', 'config_value_json', 'updated_at', 'updated_by'],
    textColumns: [1, 2, 3, 4],
  },
  {
    name: 'Admin Users',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8],
  },
  {
    name: 'Audit Log',
    headers: [
      'audit_id',
      'timestamp',
      'user_id',
      'user_email',
      'action',
      'entity_type',
      'entity_id',
      'previous_summary',
      'new_summary',
      'result',
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    name: 'Sync Log',
    headers: [
      'sync_id',
      'timestamp',
      'client_submission_key',
      'session_record_id',
      'session_id',
      'actor_email',
      'operation',
      'attempt',
      'status',
      'error_message',
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 9, 10],
  },
];

const AUX_SUMMARY_TAB = 'Summary & KPIs';
const AUX_DECLARATIONS_TAB = 'Declarations';

export const DIRECT_ALL_INITIALIZED_TABS = [
  ...DIRECT_SHEETS_SCHEMA_DEFINITIONS.map((d) => d.name),
  AUX_SUMMARY_TAB,
  AUX_DECLARATIONS_TAB,
];

const DECLARATIONS_HEADERS = [
  'declaration_category',
  'target_tab_or_scope',
  'ref_or_col_num',
  'field_or_rule_key',
  'display_title',
  'type_format_or_formula',
  'validation_and_official_declaration',
];

const COLUMN_PIXEL_WIDTHS: Record<string, number> = {
  session_record_id: 260,
  session_id: 300,
  client_submission_key: 260,
  facilitator_name: 175,
  facilitator_email: 225,
  facilitator_user_id: 165,
  tour_id: 110,
  tour_name: 260,
  video_id: 195,
  language: 120,
  start_date: 115,
  end_date: 115,
  start_time: 105,
  end_time: 105,
  duration_minutes: 135,
  duration_formatted: 135,
  reporting_month: 135,
  submission_timestamp: 190,
  submission_date_formatted: 175,
  school_name: 250,
  udise_code: 140,
  school_type: 205,
  state: 115,
  district: 135,
  pin_code: 115,
  session_type: 120,
  total_classes: 115,
  total_students_present: 155,
  total_qa_responses: 145,
  total_qb_responses: 145,
  overall_csat: 115,
  overall_itp: 115,
  teacher_score: 120,
  teacher_classification: 165,
  teacher_nps: 115,
  submission_status: 145,
  created_at: 185,
  updated_at: 185,
  created_by: 215,
  updated_by: 215,
  archived: 100,
  detail_record_id: 240,
  grade: 95,
  section: 115,
  students_present: 135,
  qa_score_5: 100,
  qa_score_4: 100,
  qa_score_3: 100,
  qa_score_2: 100,
  qa_score_1: 100,
  qa_total: 100,
  qa_weighted_score: 140,
  csat: 95,
  qb_score_5: 100,
  qb_score_4: 100,
  qb_score_3: 100,
  qb_score_2: 100,
  qb_score_1: 100,
  qb_total: 100,
  qb_weighted_score: 140,
  itp: 95,
  user_id: 170,
  name: 190,
  email: 245,
  role: 125,
  active: 95,
  status: 125,
  school_record_id: 185,
  config_key: 195,
  config_value_json: 560,
  audit_id: 195,
  timestamp: 185,
  user_email: 225,
  action: 185,
  entity_type: 135,
  entity_id: 220,
  previous_summary: 260,
  new_summary: 280,
  result: 115,
  sync_id: 195,
  actor_email: 225,
  operation: 175,
  attempt: 95,
  error_message: 310,
};

const HEADER_NOTES_BY_NAME: Record<string, string> = {
  session_record_id: 'Primary UUID (Text @). Unique internal key for each session header row.',
  session_id: 'Official Career Tours Session ID (Text @). Natural deduplication key.',
  client_submission_key: 'Client-generated UUID ensuring retry & offline idempotency.',
  udise_code: '11-digit school UDISE code stored strictly as Plain Text (@) to preserve leading zeroes.',
  pin_code: '6-digit PIN code stored strictly as Plain Text (@) to preserve leading zeroes.',
  district: 'Approved Tamil Nadu district: Cuddalore, Nagapattinam, Sivaganga.',
  total_students_present: 'Total students present in the session (single-counted; never duplicated across combined rows).',
  overall_csat: 'Weighted Q-A Student Enjoyment score (1.00–5.00): SUM(qa_weighted_score)/SUM(qa_total).',
  overall_itp: 'Weighted Q-B Career Interest score (1.00–5.00): SUM(qb_weighted_score)/SUM(qb_total).',
  teacher_nps: 'Teacher NPS weight: Promoter (9–10)=+100, Passive (7–8)=0, Detractor (0–6)=-100.',
  submission_status: 'Two-phase lock status. Only COMMITTED and CORRECTED rows enter programme analytics & exports.',
  students_present: 'Class-row attendance for a single grade/section (1:N expansion row).',
  config_value_json: 'JSON payload managed by Super Administrators. Never store passwords here.',
};

const DROPDOWN_LISTS_BY_HEADER: Record<string, string[]> = {
  district: ['Cuddalore', 'Nagapattinam', 'Sivaganga'],
  language: ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Gujarati', 'Odia'],
  grade: ['8', '9', '10', '11', '12'],
  section: ['A', 'B', 'C', 'D', 'E', 'F', 'No section'],
  school_type: [
    'Government school',
    'Government aided school',
    'Private school',
    'Central government school (KV, JNV...)',
    'Tribal school (EMRS)',
    'Kasturba Gandhi Balika Vidyalaya (KGBV)',
    'Other',
  ],
  session_type: ['single', 'combined'],
  submission_status: ['COMMITTED', 'CORRECTED', 'PENDING'],
  archived: ['true', 'false'],
  active: ['true', 'false'],
  status: ['APPROVED', 'PENDING', 'DENIED'],
  role: ['super_admin', 'facilitator'],
  teacher_classification: ['Promoter', 'Passive', 'Detractor'],
};

function a1Tab(name: string): string {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function colIndexToLetter(colIdx: number): string {
  let num = colIdx;
  let letters = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters || 'A';
}

function toNullableNumber(val: unknown): number | null {
  if (val === '' || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(val: unknown, fallback = 0): number {
  if (val === '' || val === null || val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function resolveActorInfo(emailInput: string) {
  const clean = normalizeEmail(emailInput);
  const found = INITIAL_SUPER_ADMINS.find((sa) => normalizeEmail(sa.email) === clean);
  if (found) return found;
  return {
    userId: `SA_${clean.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || 'ADMIN'}`,
    name: clean.split('@')[0] || clean,
    email: clean,
  };
}

class GoogleDirectApiError extends Error {
  rawStatus: number;
  apiCode: string;

  constructor(message: string, rawStatus: number, apiCode: string) {
    super(message);
    this.rawStatus = rawStatus;
    this.apiCode = apiCode;
  }
}

async function googleDirectJson<T = Record<string, unknown>>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 30_000) : null;
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: controller?.signal,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      const apiErrObj = parsed.error as { message?: string } | undefined;
      const msg = apiErrObj?.message || `Google API returned HTTP ${res.status}`;
      if (res.status === 401) {
        clearDirectGoogleSheetsToken();
        throw new GoogleDirectApiError(
          'Google OAuth authorization expired. Re-authorize Google Sheets access and retry.',
          401,
          'OAUTH_EXPIRED',
        );
      }
      if (res.status === 403) {
        throw new GoogleDirectApiError(msg, 403, 'SHEET_ACCESS_DENIED');
      }
      if (res.status === 404) {
        throw new GoogleDirectApiError(msg, 404, 'NOT_FOUND');
      }
      throw new GoogleDirectApiError(msg, res.status, 'GOOGLE_API_ERROR');
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof GoogleDirectApiError) throw err;
    throw new GoogleDirectApiError(
      err instanceof Error ? err.message : 'Network error calling Google Sheets API.',
      0,
      'NETWORK_ERROR',
    );
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

function handleDirectError<T>(err: unknown, fallbackMessage: string): ApiResponse<T> {
  if (err instanceof GoogleDirectApiError) {
    return { ok: false, code: err.apiCode, error: err.message };
  }
  return {
    ok: false,
    code: 'SHEETS_ERROR',
    error: err instanceof Error ? err.message : fallbackMessage,
  };
}

async function batchGetRanges(
  spreadsheetId: string,
  accessToken: string,
  ranges: string[],
): Promise<unknown[][][]> {
  if (ranges.length === 0) return [];
  const data = await googleDirectJson<{ valueRanges?: Array<{ values?: unknown[][] }> }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values:batchGet?${ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')}`,
    accessToken,
  );
  return (data.valueRanges || []).map((vr) => vr.values || []);
}

export function buildSummaryAndKpisSheetPayload(): { rows: string[][]; rowKinds: string[] } {
  const sDef = DIRECT_SHEETS_SCHEMA_DEFINITIONS[0]!;
  const dDef = DIRECT_SHEETS_SCHEMA_DEFINITIONS[1]!;
  const sCol = (name: string) => colIndexToLetter(sDef.headers.indexOf(name) + 1);
  const dCol = (name: string) => colIndexToLetter(dDef.headers.indexOf(name) + 1);

  const sStatus = sCol('submission_status');
  const sArch = sCol('archived');
  const sStudents = sCol('total_students_present');
  const sDistrict = sCol('district');
  const sTourId = sCol('tour_id');
  const sLang = sCol('language');
  const sCsat = sCol('overall_csat');
  const sItp = sCol('overall_itp');
  const sNps = sCol('teacher_nps');

  const dGrade = dCol('grade');
  const dStud = dCol('students_present');
  const dQaTot = dCol('qa_total');
  const dQaW = dCol('qa_weighted_score');
  const dQbTot = dCol('qb_total');
  const dQbW = dCol('qb_weighted_score');
  const R = 2500;

  const rows: string[][] = [];
  const rowKinds: string[] = [];

  rows.push(['Vidhya Vidhai · Career Tours Programme Summary & Live KPIs', '', '', '', '', '', '', '']);
  rowKinds.push('banner');
  rows.push([
    'State: Tamil Nadu · Approved Districts: Cuddalore, Nagapattinam, Sivaganga · Timezone: Asia/Kolkata · Live Formulas referencing Sessions & Session Details',
    '', '', '', '', '', '', '',
  ]);
  rowKinds.push('subtitle');
  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');

  rows.push(['1. Official Programme Key Performance Indicators (Live Formulas)', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['Metric Code', 'Programme Indicator', 'Live Value', 'Unit / Scale', 'Formula Declaration', '', '', '']);
  rowKinds.push('subheader');

  const kpiRows = [
    ['KPI-01', 'Total Committed Sessions', `=IFERROR(COUNTIFS(Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, 'Sessions', 'Counts Sessions where submission_status <> PENDING and archived = false'],
    ['KPI-02', 'Total Students Reached (Single-Counted)', `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, 'Students', 'Single-counted attendance across committed non-archived sessions'],
    ['KPI-03', 'Total Class Groups Covered', `=IFERROR(COUNTA('Session Details'!A2:A${R}),0)`, 'Class rows', 'Expanded 1:N grade/section rows in Session Details'],
    ['KPI-04', 'Registered Canonical Schools', `=IFERROR(COUNTA(Schools!A2:A${R}),0)`, 'Schools', 'Canonical 11-digit UDISE schools in Schools tab'],
    ['KPI-05', 'Approved Facilitators', `=IFERROR(COUNTIF(Facilitators!H2:H${R},"APPROVED"),0)`, 'Accounts', 'Approved facilitator rows in Facilitators tab'],
    ['KPI-06', 'Protected / Approved Super Admins', `=IFERROR(COUNTIF('Admin Users'!H2:H${R},"APPROVED"),0)`, 'Accounts', 'Approved Super Administrators in Admin Users tab'],
    ['KPI-07', 'Pooled Student CSAT (Q-A Enjoyment)', `=IFERROR(SUM('Session Details'!${dQaW}2:${dQaW}${R})/SUM('Session Details'!${dQaTot}2:${dQaTot}${R}),0)`, '1.00–5.00', 'SUM(qa_weighted_score) / SUM(qa_total)'],
    ['KPI-08', 'Pooled Student ITP (Q-B Career Interest)', `=IFERROR(SUM('Session Details'!${dQbW}2:${dQbW}${R})/SUM('Session Details'!${dQbTot}2:${dQbTot}${R}),0)`, '1.00–5.00', 'SUM(qb_weighted_score) / SUM(qb_total)'],
    ['KPI-09', 'Pooled Teacher NPS (-100 to +100)', `=IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, 'NPS Index', 'Mean session teacher_nps (+100 / 0 / -100)'],
    ['KPI-10', 'Question A Response Coverage Rate', `=IFERROR(SUM('Session Details'!${dQaTot}2:${dQaTot}${R})/SUM('Session Details'!${dStud}2:${dStud}${R}),0)`, 'Percentage', 'SUM(qa_total) / SUM(students_present)'],
  ];
  for (const item of kpiRows) {
    rows.push([...item, '', '', '']);
    rowKinds.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');
  rows.push(['2. Approved District-wise Programme Reach (Tamil Nadu)', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['District', 'State', 'School Year', 'Sessions', 'Students Reached', 'Avg CSAT', 'Avg ITP', 'Avg Teacher NPS']);
  rowKinds.push('subheader');

  const distStartRow = rows.length + 1;
  for (const distName of ['Cuddalore', 'Nagapattinam', 'Sivaganga']) {
    const rNum = rows.length + 1;
    rows.push([
      distName,
      'Tamil Nadu',
      '2026-27',
      `=IFERROR(COUNTIFS(Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sItp}2:${sItp}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
    ]);
    rowKinds.push('data');
  }
  const distEndRow = rows.length;
  rows.push([
    'Total / Pooled',
    'Tamil Nadu',
    '2026-27',
    `=SUM(D${distStartRow}:D${distEndRow})`,
    `=SUM(E${distStartRow}:E${distEndRow})`,
    `=IFERROR(SUM('Session Details'!${dQaW}2:${dQaW}${R})/SUM('Session Details'!${dQaTot}2:${dQaTot}${R}),0)`,
    `=IFERROR(SUM('Session Details'!${dQbW}2:${dQbW}${R})/SUM('Session Details'!${dQbTot}2:${dQbTot}${R}),0)`,
    `=IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
  ]);
  rowKinds.push('total');

  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');
  rows.push(['3. Career Tours Catalog & Delivery Breakdown', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['Tour ID', 'Career Tour Name', 'Code', 'Active', 'Tamil Video ID', 'Sessions', 'Students Reached', 'Avg CSAT']);
  rowKinds.push('subheader');

  const tours = [
    ['TOUR_AM', 'Amazon Music: Careers Behind the Beats', 'AM', 'Active', 'AFE-IN-AM-OV-TA-2026'],
    ['TOUR_RFC', 'Robotics Fulfillment Center', 'RFC', 'Active', 'Pending'],
  ];
  for (const t of tours) {
    const rNum = rows.length + 1;
    rows.push([
      t[0]!,
      t[1]!,
      t[2]!,
      t[3]!,
      t[4]!,
      `=IFERROR(COUNTIFS(Sessions!${sTourId}2:${sTourId}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sTourId}2:${sTourId}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sTourId}2:${sTourId}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
    ]);
    rowKinds.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');
  rows.push(['4. Grade-wise & Language Breakdown (Live Formulas)', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['Dimension', 'Category', 'Value Key', 'Class / Session Count', 'Students Reached', 'Avg CSAT', '', '']);
  rowKinds.push('subheader');

  for (const grade of ['8', '9', '10', '11', '12']) {
    const rNum = rows.length + 1;
    rows.push([
      'Grade',
      `Grade ${grade}`,
      grade,
      `=IFERROR(COUNTIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum}),0)`,
      `=IFERROR(SUMIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum},'Session Details'!${dStud}2:${dStud}${R}),0)`,
      `=IFERROR(SUMIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum},'Session Details'!${dQaW}2:${dQaW}${R})/SUMIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum},'Session Details'!${dQaTot}2:${dQaTot}${R}),0)`,
      '',
      '',
    ]);
    rowKinds.push('data');
  }

  const langs: ReadonlyArray<readonly [string, string]> = [
    ['English', 'EN'],
    ['Hindi', 'HI'],
    ['Tamil', 'TA'],
    ['Telugu', 'TE'],
    ['Kannada', 'KN'],
    ['Marathi', 'MR'],
    ['Gujarati', 'GU'],
    ['Odia', 'OR'],
  ];
  for (const [lang, code] of langs) {
    const rNum = rows.length + 1;
    rows.push([
      'Language',
      lang,
      code,
      `=IFERROR(COUNTIFS(Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      '',
      '',
    ]);
    rowKinds.push('data');
  }

  return { rows, rowKinds };
}

export function buildDeclarationsSheetRows(): string[][] {
  const adminEmails = INITIAL_SUPER_ADMINS.map((a) => `${a.name} <${a.email}>`).join('; ');
  const rows: string[][] = [
    DECLARATIONS_HEADERS,
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-01',
      'GOV-01',
      'Approved Geography & Timezone',
      'State: Tamil Nadu · Districts: Cuddalore, Nagapattinam, Sivaganga · TZ: Asia/Kolkata',
      'Only schools within Tamil Nadu and approved districts (Cuddalore, Nagapattinam, Sivaganga) are valid. All dates evaluate in Asia/Kolkata (IST).',
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-02',
      'GOV-02',
      'Protected Super Administrators & RBAC',
      adminEmails,
      'Only allowlisted Super Administrators may connect sheets, modify Configuration, archive/restore records, delete data, or export official .xlsx files. Zero passwords stored.',
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-03',
      'GOV-03',
      'Zero Fabricated Data Policy',
      'Empty initial DB tables (0 sample classrooms, 0 fabricated partners)',
      'Core database tabs hold no sample/dummy sessions. Summary & KPIs live formulas cleanly evaluate to 0 until real classroom sessions are committed.',
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-01',
      'MET-01',
      'Pooled Student CSAT (Question A)',
      'CSAT = SUM(qa_weighted_score) / SUM(qa_total)',
      'Scale 1.00–5.00. Weighted across all student respondents, never an unweighted average of class averages.',
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-02',
      'MET-02',
      'Pooled Student ITP (Question B)',
      'ITP = SUM(qb_weighted_score) / SUM(qb_total)',
      'Scale 1.00–5.00. Weighted across all Question B respondents on committed non-archived rows.',
    ],
    [
      'Metric Formula',
      'Sessions',
      'MET-03',
      'MET-03',
      'Teacher Net Promoter Score (Teacher NPS)',
      'Promoter (9–10)=+100, Passive (7–8)=0, Detractor (0–6)=-100 · AVERAGE(teacher_nps)',
      'Evaluated once per unique classroom session header (never multiplied across expanded combined-class rows).',
    ],
    [
      'Metric Formula',
      'Sessions -> Session Details',
      'MET-04',
      'MET-04',
      'Combined-Class 1:N Expansion & Single Counting',
      '1 Session Header -> N Session Details rows',
      'Each Grade/Section row holds its own attendance and Q-A/Q-B votes so attendance totals never double-count.',
    ],
    [
      'Data Integrity',
      'Sessions / Schools',
      'INT-01',
      'INT-01',
      'Plain Text (@) Leading-Zero Preservation',
      'numFmt = "@" on udise_code (11 chars), pin_code (6 chars), session_id, dates & times',
      'Protects leading zeroes on UDISE codes, PIN codes, and ISO/DD-MM-YYYY date strings in Google Sheets & Excel.',
    ],
    [
      'Data Integrity',
      'Sessions / Sync Log / Audit Log',
      'INT-02',
      'INT-02',
      'Atomic LockService Two-Phase Commit & 3-Key Deduplication',
      'Unique keys: session_record_id + session_id + client_submission_key',
      'Two-phase write (PENDING -> COMMITTED/CORRECTED) inside backend locks prevents duplicates on retries and logs every mutation.',
    ],
  ];

  for (const def of DIRECT_SHEETS_SCHEMA_DEFINITIONS) {
    const textSet = new Set(def.textColumns || []);
    def.headers.forEach((hdr, idx) => {
      const colNum = idx + 1;
      const isText = textSet.has(colNum);
      rows.push([
        `Data Dictionary (${def.name})`,
        def.name,
        `Col ${colNum} (${colIndexToLetter(colNum)})`,
        hdr,
        hdr.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
        isText ? 'Plain Text (@)' : 'Numeric / Decimal',
        HEADER_NOTES_BY_NAME[hdr] || `Canonical field in "${def.name}" tab.`,
      ]);
    });
  }

  return rows;
}

export async function initializeDirectSpreadsheetSchema(
  spreadsheetId: string,
  accessToken: string,
): Promise<{
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl: string;
  initializedTabs: string[];
}> {
  const metaFields =
    'spreadsheetId,properties.title,spreadsheetUrl,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),bandedRanges(bandedRangeId))';
  interface SheetMetaResp {
    spreadsheetId: string;
    properties?: { title?: string };
    spreadsheetUrl?: string;
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
      bandedRanges?: Array<{ bandedRangeId?: number }>;
    }>;
  }

  let meta = await googleDirectJson<SheetMetaResp>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}?fields=${encodeURIComponent(metaFields)}`,
    accessToken,
  );

  const existingTitles = new Set((meta.sheets || []).map((s) => s.properties?.title).filter(Boolean));
  const requiredTabSpecs = [
    ...DIRECT_SHEETS_SCHEMA_DEFINITIONS.map((d) => ({
      title: d.name,
      frozenRowCount: 1,
      columnCount: Math.max(26, d.headers.length),
    })),
    { title: AUX_SUMMARY_TAB, frozenRowCount: 2, columnCount: 26 },
    { title: AUX_DECLARATIONS_TAB, frozenRowCount: 1, columnCount: 26 },
  ];
  const missingTabs = requiredTabSpecs.filter((t) => !existingTitles.has(t.title));

  if (missingTabs.length > 0) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missingTabs.map((t) => ({
            addSheet: {
              properties: {
                title: t.title,
                gridProperties: {
                  frozenRowCount: t.frozenRowCount,
                  rowCount: 1000,
                  columnCount: t.columnCount,
                },
              },
            },
          })),
        }),
      },
    );
    meta = await googleDirectJson<SheetMetaResp>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}?fields=${encodeURIComponent(metaFields)}`,
      accessToken,
    );
  }

  const sheetByTitle = new Map<string, NonNullable<SheetMetaResp['sheets']>[number]>();
  for (const s of meta.sheets || []) {
    if (s.properties?.title) sheetByTitle.set(s.properties.title, s);
  }

  const headerRanges = DIRECT_SHEETS_SCHEMA_DEFINITIONS.map((d) => `${a1Tab(d.name)}!1:1`);
  const fetchedHeaderAndConfig = await batchGetRanges(spreadsheetId, accessToken, [
    ...headerRanges,
    `${a1Tab('Configuration')}!A2:A`,
  ]);
  const existingHeaders = fetchedHeaderAndConfig.slice(0, headerRanges.length);
  const cfgKeyRows = fetchedHeaderAndConfig[headerRanges.length] || [];

  const migrationRequests: unknown[] = [];
  const migratedTabs = new Set<string>();
  const rawUpdates: Array<{ range: string; values: unknown[][] }> = [];

  existingHeaders.forEach((rows, idx) => {
    const def = DIRECT_SHEETS_SCHEMA_DEFINITIONS[idx]!;
    const firstRow = rows[0] || [];
    const sheetObj = sheetByTitle.get(def.name);
    const sheetId = sheetObj?.properties?.sheetId;
    if ((def.name === 'Sessions' || def.name === 'Schools') && firstRow.length > 0) {
      const legacyBlockIdx0 = firstRow.findIndex(
        (h) => String(h || '').trim().toLowerCase() === 'block',
      );
      if (legacyBlockIdx0 !== -1 && sheetId !== undefined) {
        migrationRequests.push({
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: legacyBlockIdx0,
              endIndex: legacyBlockIdx0 + 1,
            },
          },
        });
        migratedTabs.add(def.name);
      }
    }
    if (!firstRow[0] || String(firstRow[0]).trim() === '' || migratedTabs.has(def.name)) {
      rawUpdates.push({
        range: `${a1Tab(def.name)}!A1`,
        values: [def.headers],
      });
    }
  });

  const cfgSheetId = sheetByTitle.get('Configuration')?.properties?.sheetId;
  if (cfgSheetId !== undefined && cfgKeyRows.length > 0) {
    const legacyBlockRowNums0: number[] = [];
    cfgKeyRows.forEach((r, idx) => {
      if (String(r[0] || '').trim() === 'district_blocks') {
        legacyBlockRowNums0.push(idx + 1);
      }
    });
    legacyBlockRowNums0.sort((a, b) => b - a);
    for (const row0 of legacyBlockRowNums0) {
      migrationRequests.push({
        deleteDimension: {
          range: {
            sheetId: cfgSheetId,
            dimension: 'ROWS',
            startIndex: row0,
            endIndex: row0 + 1,
          },
        },
      });
    }
  }

  if (migrationRequests.length > 0) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: migrationRequests }),
      },
    );
  }

  const declarationsRows = buildDeclarationsSheetRows();
  rawUpdates.push({
    range: `${a1Tab(AUX_DECLARATIONS_TAB)}!A1`,
    values: declarationsRows,
  });

  const summaryPayload = buildSummaryAndKpisSheetPayload();
  const formatRequests: unknown[] = [];
  const headerDarkFormat = {
    backgroundColor: { red: 0.09, green: 0.11, blue: 0.14 },
    textFormat: {
      bold: true,
      fontSize: 10,
      foregroundColor: { red: 0.973, green: 0.98, blue: 0.988 },
    },
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'MIDDLE',
    wrapStrategy: 'WRAP',
    borders: {
      bottom: { style: 'SOLID_MEDIUM', color: { red: 0.118, green: 0.655, blue: 1.0 } },
    },
  };
  const headerDarkFields =
    'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders.bottom)';

  const summaryMeta = sheetByTitle.get(AUX_SUMMARY_TAB);
  const declMeta = sheetByTitle.get(AUX_DECLARATIONS_TAB);
  if (summaryMeta?.properties?.sheetId !== undefined) {
    formatRequests.push({
      repeatCell: {
        range: { sheetId: summaryMeta.properties.sheetId },
        cell: {},
        fields: 'userEnteredValue,userEnteredFormat',
      },
    });
  }
  if (declMeta?.properties?.sheetId !== undefined) {
    formatRequests.push({
      repeatCell: {
        range: { sheetId: declMeta.properties.sheetId },
        cell: {},
        fields: 'userEnteredValue,userEnteredFormat',
      },
    });
  }

  for (const def of DIRECT_SHEETS_SCHEMA_DEFINITIONS) {
    const sheetObj = sheetByTitle.get(def.name);
    const sheetId = sheetObj?.properties?.sheetId;
    if (sheetId === undefined) continue;

    const rawColCount = sheetObj?.properties?.gridProperties?.columnCount;
    const currentColCount =
      typeof rawColCount === 'number'
        ? rawColCount - (migratedTabs.has(def.name) ? 1 : 0)
        : undefined;
    if (typeof currentColCount === 'number' && currentColCount < def.headers.length) {
      formatRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { columnCount: def.headers.length, frozenRowCount: 1 },
          },
          fields: 'gridProperties.columnCount,gridProperties.frozenRowCount',
        },
      });
    } else {
      formatRequests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }

    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    });
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: def.headers.length,
        },
        cell: { userEnteredFormat: headerDarkFormat },
        fields: headerDarkFields,
      },
    });
    formatRequests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: def.headers.length,
        },
        rows: [
          {
            values: def.headers.map((hdr, idx) => ({
              note:
                HEADER_NOTES_BY_NAME[hdr] ||
                `Column ${idx + 1} (${def.name}): ${hdr}${def.textColumns.includes(idx + 1) ? ' [Plain Text @]' : ''}`,
            })),
          },
        ],
        fields: 'note',
      },
    });

    const textSet = new Set(def.textColumns);
    def.headers.forEach((hdr, col0) => {
      const col1 = col0 + 1;
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: col0, endIndex: col0 + 1 },
          properties: { pixelSize: COLUMN_PIXEL_WIDTHS[hdr] || 155 },
          fields: 'pixelSize',
        },
      });
      if (textSet.has(col1)) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 0, startColumnIndex: col0, endColumnIndex: col0 + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      } else if (hdr === 'csat' || hdr === 'itp' || hdr === 'overall_csat' || hdr === 'overall_itp') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0.00' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }

      const listChoices = DROPDOWN_LISTS_BY_HEADER[hdr];
      if (listChoices && listChoices.length > 0) {
        formatRequests.push({
          setDataValidation: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: listChoices.map((v) => ({ userEnteredValue: v })),
              },
              strict: false,
              showCustomUi: true,
            },
          },
        });
      }
    });

    if (def.name === 'Configuration') {
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
          cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
          fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
        },
      });
    }

    formatRequests.push({
      setBasicFilter: {
        filter: {
          range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: def.headers.length },
        },
      },
    });

    if (!(sheetObj?.bandedRanges && sheetObj.bandedRanges.length > 0)) {
      formatRequests.push({
        addBanding: {
          bandedRange: {
            range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: def.headers.length },
            rowProperties: {
              headerColor: { red: 0.09, green: 0.11, blue: 0.14 },
              firstBandColor: { red: 1.0, green: 1.0, blue: 1.0 },
              secondBandColor: { red: 0.973, green: 0.98, blue: 0.988 },
            },
          },
        },
      });
    }
  }

  if (summaryMeta?.properties?.sheetId !== undefined) {
    const sSheetId = summaryMeta.properties.sheetId;
    const summaryColWidths = [165, 290, 155, 130, 340, 125, 135, 135];
    formatRequests.push({
      updateSheetProperties: {
        properties: { sheetId: sSheetId, gridProperties: { frozenRowCount: 2 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });
    summaryColWidths.forEach((px, col0) => {
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId: sSheetId, dimension: 'COLUMNS', startIndex: col0, endIndex: col0 + 1 },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      });
    });
    summaryPayload.rowKinds.forEach((kind, row0) => {
      if (kind === 'banner') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.043, green: 0.071, blue: 0.125 },
                textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 0.973, green: 0.98, blue: 0.988 } },
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
          },
        });
      } else if (kind === 'subtitle') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.91, green: 0.965, blue: 1.0 },
                textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.0, green: 0.42, blue: 0.72 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        });
      } else if (kind === 'section') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.941, green: 0.957, blue: 0.973 },
                textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.039, green: 0.106, blue: 0.173 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        });
      } else if (kind === 'subheader') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: { userEnteredFormat: headerDarkFormat },
            fields: headerDarkFields,
          },
        });
      } else if (kind === 'total') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.937, green: 0.965, blue: 1.0 },
                textFormat: { bold: true, foregroundColor: { red: 0.039, green: 0.106, blue: 0.173 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        });
      } else if (kind === 'data') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                backgroundColor: row0 % 2 === 1 ? { red: 0.973, green: 0.98, blue: 0.988 } : { red: 1.0, green: 1.0, blue: 1.0 },
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        });
      }
    });
  }

  if (declMeta?.properties?.sheetId !== undefined) {
    const dSheetId = declMeta.properties.sheetId;
    const declWidths = [175, 165, 110, 210, 225, 250, 440];
    formatRequests.push({
      updateSheetProperties: {
        properties: { sheetId: dSheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });
    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId: dSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    });
    formatRequests.push({
      repeatCell: {
        range: { sheetId: dSheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'TEXT', pattern: '@' },
            wrapStrategy: 'WRAP',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,wrapStrategy,verticalAlignment)',
      },
    });
    formatRequests.push({
      repeatCell: {
        range: { sheetId: dSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: { userEnteredFormat: headerDarkFormat },
        fields: headerDarkFields,
      },
    });
    declWidths.forEach((px, col0) => {
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId: dSheetId, dimension: 'COLUMNS', startIndex: col0, endColumnIndex: col0 + 1 },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      });
    });
    formatRequests.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId: dSheetId,
            startRowIndex: 0,
            endRowIndex: declarationsRows.length,
            startColumnIndex: 0,
            endColumnIndex: 7,
          },
        },
      },
    });
    if (!(declMeta.bandedRanges && declMeta.bandedRanges.length > 0)) {
      formatRequests.push({
        addBanding: {
          bandedRange: {
            range: {
              sheetId: dSheetId,
              startRowIndex: 0,
              endRowIndex: declarationsRows.length,
              startColumnIndex: 0,
              endColumnIndex: 7,
            },
            rowProperties: {
              headerColor: { red: 0.09, green: 0.11, blue: 0.14 },
              firstBandColor: { red: 1.0, green: 1.0, blue: 1.0 },
              secondBandColor: { red: 0.973, green: 0.98, blue: 0.988 },
            },
          },
        },
      });
    }
  }

  if (formatRequests.length > 0) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: formatRequests }),
      },
    );
  }

  if (rawUpdates.length > 0) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: rawUpdates,
        }),
      },
    );
  }

  await googleDirectJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `${a1Tab(AUX_SUMMARY_TAB)}!A1`,
            values: summaryPayload.rows,
          },
        ],
      }),
    },
  );

  // Idempotently ensure protected Super Admin rows exist in Admin Users
  const [adminColC] = await batchGetRanges(spreadsheetId, accessToken, [`${a1Tab('Admin Users')}!C2:C`]);
  const existingAdminEmails = new Set(
    (adminColC || []).map((r) => normalizeEmail(String(r[0] || ''))).filter(Boolean),
  );
  const nowIso = new Date().toISOString();
  const missingAdmins = INITIAL_SUPER_ADMINS.filter(
    (sa) => !existingAdminEmails.has(normalizeEmail(sa.email)),
  ).map((sa) => [sa.userId, sa.name, sa.email, 'super_admin', 'true', nowIso, nowIso, 'APPROVED']);

  if (missingAdmins.length > 0) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Admin Users')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ values: missingAdmins }),
      },
    );
  }

  return {
    spreadsheetId,
    spreadsheetName: meta.properties?.title || 'Vidhya Vidhai · Career Tours Spreadsheet',
    spreadsheetUrl:
      meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    initializedTabs: [...DIRECT_ALL_INITIALIZED_TABS],
  };
}

// ---------- Serializers & Parsers ----------

export function buildConfigKeyValuesFromPartial(
  partial: Partial<AppConfiguration>,
): Array<[string, string]> {
  const mapping: Array<[keyof AppConfiguration, string]> = [
    ['programmeTimezone', 'programme_timezone'],
    ['stateName', 'state_name'],
    ['allowedDistricts', 'allowed_districts'],
    ['gradeOptions', 'grade_options'],
    ['sectionOptions', 'section_options'],
    ['schoolTypes', 'school_types'],
    ['tours', 'tours'],
    ['languageOptions', 'language_options'],
    ['languageCodes', 'language_codes'],
    ['schoolYear', 'school_year'],
    ['partnerName', 'partner_name'],
    ['reportingDefaults', 'reporting_defaults'],
    ['policy', 'policy'],
    ['exportTemplate63', 'export_template_63'],
  ];
  const entries: Array<[string, string]> = [];
  for (const [prop, sheetKey] of mapping) {
    if (partial[prop] !== undefined) {
      let val: unknown = partial[prop];
      if (prop === 'policy' && val && typeof val === 'object') {
        const p = val as AppConfiguration['policy'];
        val = {
          allowFacilitatorDeleteOwn: p.allowFacilitatorDeleteOwn !== false,
          allowFacilitatorExportOwn: false,
          facilitatorApprovalMode:
            p.facilitatorApprovalMode === 'auto_approve' ? 'auto_approve' : 'manual_allowlist',
        };
      }
      entries.push([sheetKey, JSON.stringify(val)]);
    }
  }
  return entries;
}

export function parseConfigFromSheetRows(rows: unknown[][]): {
  config: AppConfiguration;
  configurationPatch: Partial<AppConfiguration>;
} {
  const patch: Partial<AppConfiguration> = {};
  for (const r of rows || []) {
    const key = String(r[0] || '').trim();
    const rawJson = String(r[1] || '').trim();
    if (!key || !rawJson) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = rawJson;
    }
    switch (key) {
      case 'programme_timezone':
        if (typeof parsed === 'string' && parsed.trim()) patch.programmeTimezone = parsed.trim();
        break;
      case 'state_name':
        if (typeof parsed === 'string' && parsed.trim()) patch.stateName = parsed.trim();
        break;
      case 'allowed_districts':
        if (Array.isArray(parsed) && parsed.length > 0) patch.allowedDistricts = parsed.map(String);
        break;
      case 'grade_options':
        if (Array.isArray(parsed) && parsed.length > 0) patch.gradeOptions = parsed.map(String);
        break;
      case 'section_options':
        if (Array.isArray(parsed) && parsed.length > 0) patch.sectionOptions = parsed.map(String);
        break;
      case 'school_types':
        if (Array.isArray(parsed) && parsed.length > 0) patch.schoolTypes = parsed.map(String);
        break;
      case 'tours':
        if (Array.isArray(parsed) && parsed.length > 0) patch.tours = parsed as AppConfiguration['tours'];
        break;
      case 'language_options':
        if (Array.isArray(parsed) && parsed.length > 0) patch.languageOptions = parsed.map(String);
        break;
      case 'language_codes':
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          patch.languageCodes = parsed as Record<string, string>;
        }
        break;
      case 'school_year':
        if (typeof parsed === 'string') patch.schoolYear = parsed;
        break;
      case 'partner_name':
        if (typeof parsed === 'string') patch.partnerName = parsed;
        break;
      case 'reporting_defaults':
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          patch.reportingDefaults = {
            ...DEFAULT_APP_CONFIGURATION.reportingDefaults,
            ...(parsed as Partial<AppConfiguration['reportingDefaults']>),
          };
        }
        break;
      case 'policy':
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const p = parsed as Partial<AppConfiguration['policy']>;
          patch.policy = {
            allowFacilitatorDeleteOwn: p.allowFacilitatorDeleteOwn !== false,
            allowFacilitatorExportOwn: false,
            facilitatorApprovalMode:
              p.facilitatorApprovalMode === 'manual_allowlist' ? 'manual_allowlist' : 'auto_approve',
          };
        }
        break;
      case 'export_template_63':
        patch.exportTemplate63 = (parsed as AppConfiguration['exportTemplate63']) || null;
        break;
      default:
        break;
    }
  }
  return {
    config: {
      ...structuredClone(DEFAULT_APP_CONFIGURATION),
      ...patch,
    },
    configurationPatch: patch,
  };
}

interface DirectSessionSheetLayout {
  hasBlock: boolean;
  statusCol1: number;
  createdAtCol0: number;
  updatedAtCol1: number;
  updatedByCol1: number;
  archivedCol1: number;
  totalCols: number;
}

interface DirectSchoolSheetLayout {
  hasBlock: boolean;
  createdAtCol0: number;
  totalCols: number;
}

function resolveSessionSheetLayout(headerRow?: unknown[]): DirectSessionSheetLayout {
  const norm = (headerRow || []).map((h) => String(h || '').trim().toLowerCase());
  if (norm.includes('session_record_id')) {
    const hasBlock = norm.includes('block');
    const idxOr = (name: string, fallbackIdx: number) => {
      const idx = norm.indexOf(name);
      return idx !== -1 ? idx : fallbackIdx;
    };
    return {
      hasBlock,
      statusCol1: idxOr('submission_status', hasBlock ? 36 : 35) + 1,
      createdAtCol0: idxOr('created_at', hasBlock ? 37 : 36),
      updatedAtCol1: idxOr('updated_at', hasBlock ? 38 : 37) + 1,
      updatedByCol1: idxOr('updated_by', hasBlock ? 40 : 39) + 1,
      archivedCol1: idxOr('archived', hasBlock ? 41 : 40) + 1,
      totalCols: hasBlock ? 42 : 41,
    };
  }
  return {
    hasBlock: false,
    statusCol1: 36,
    createdAtCol0: 36,
    updatedAtCol1: 38,
    updatedByCol1: 40,
    archivedCol1: 41,
    totalCols: 41,
  };
}

function resolveSchoolSheetLayout(headerRow?: unknown[]): DirectSchoolSheetLayout {
  const norm = (headerRow || []).map((h) => String(h || '').trim().toLowerCase());
  if (norm.includes('school_record_id')) {
    const hasBlock = norm.includes('block');
    const createdIdx = norm.indexOf('created_at');
    return {
      hasBlock,
      createdAtCol0: createdIdx !== -1 ? createdIdx : hasBlock ? 9 : 8,
      totalCols: hasBlock ? 11 : 10,
    };
  }
  return {
    hasBlock: false,
    createdAtCol0: 8,
    totalCols: 10,
  };
}

export function serializeSessionRow(s: SessionRecord, includeLegacyBlockCol = false): unknown[] {
  const tail = [
    String(s.pinCode || ''),
    String(s.sessionType || 'single'),
    toNumberOrZero(s.totalClasses, 1),
    toNumberOrZero(s.totalStudentsPresent, 0),
    toNumberOrZero(s.totalQuestionAResponses, 0),
    toNumberOrZero(s.totalQuestionBResponses, 0),
    s.overallCsat === null || s.overallCsat === undefined ? '' : s.overallCsat,
    s.overallItp === null || s.overallItp === undefined ? '' : s.overallItp,
    s.teacherScore === null || s.teacherScore === undefined ? '' : s.teacherScore,
    String(s.teacherClassification || ''),
    toNumberOrZero(s.teacherNps, 0),
    String(s.submissionStatus || 'COMMITTED'),
    String(s.createdAt || ''),
    String(s.updatedAt || ''),
    String(s.createdBy || ''),
    String(s.updatedBy || ''),
    s.archived ? 'true' : 'false',
  ];
  return [
    String(s.sessionRecordId || ''),
    String(s.sessionId || ''),
    String(s.clientSubmissionKey || ''),
    String(s.facilitatorName || ''),
    String(s.facilitatorEmail || ''),
    String(s.facilitatorUserId || ''),
    String(s.tourId || ''),
    String(s.tourName || ''),
    String(s.videoId || ''),
    String(s.language || ''),
    String(s.startDate || ''),
    String(s.endDate || ''),
    String(s.startTime || ''),
    String(s.endTime || ''),
    toNumberOrZero(s.durationMinutes, 0),
    String(s.durationFormatted || ''),
    String(s.reportingMonth || ''),
    String(s.submissionTimestamp || ''),
    String(s.submissionDateFormatted || ''),
    String(s.schoolName || ''),
    String(s.udiseCode || ''),
    String(s.schoolType || ''),
    String(s.state || ''),
    String(s.district || ''),
    ...(includeLegacyBlockCol ? [''] : []),
    ...tail,
  ];
}

export function serializeDetailRow(d: SessionDetailRecord): unknown[] {
  return [
    String(d.detailRecordId || ''),
    String(d.sessionRecordId || ''),
    String(d.sessionId || ''),
    String(d.grade || ''),
    String(d.section || ''),
    toNumberOrZero(d.studentsPresent, 0),
    toNumberOrZero(d.questionAScore5, 0),
    toNumberOrZero(d.questionAScore4, 0),
    toNumberOrZero(d.questionAScore3, 0),
    toNumberOrZero(d.questionAScore2, 0),
    toNumberOrZero(d.questionAScore1, 0),
    toNumberOrZero(d.questionATotal, 0),
    toNumberOrZero(d.questionAWeightedScore, 0),
    d.csat === null || d.csat === undefined ? '' : d.csat,
    toNumberOrZero(d.questionBScore5, 0),
    toNumberOrZero(d.questionBScore4, 0),
    toNumberOrZero(d.questionBScore3, 0),
    toNumberOrZero(d.questionBScore2, 0),
    toNumberOrZero(d.questionBScore1, 0),
    toNumberOrZero(d.questionBTotal, 0),
    toNumberOrZero(d.questionBWeightedScore, 0),
    d.itp === null || d.itp === undefined ? '' : d.itp,
    String(d.createdAt || ''),
    String(d.updatedAt || ''),
  ];
}

export function serializeSchoolRow(sc: SchoolRecord, includeLegacyBlockCol = false): unknown[] {
  return [
    String(sc.schoolRecordId || ''),
    String(sc.schoolName || ''),
    String(sc.udiseCode || ''),
    String(sc.schoolType || ''),
    String(sc.state || ''),
    String(sc.district || ''),
    ...(includeLegacyBlockCol ? [''] : []),
    String(sc.pinCode || ''),
    sc.active === false ? 'false' : 'true',
    String(sc.createdAt || ''),
    String(sc.updatedAt || ''),
  ];
}

export function serializeFacilitatorRow(u: ManagedUser): unknown[] {
  const status: UserApprovalStatus =
    u.status === 'APPROVED' || u.status === 'PENDING' || u.status === 'DENIED'
      ? u.status
      : u.active
        ? 'APPROVED'
        : 'DENIED';
  const active = status === 'APPROVED';
  return [
    String(u.userId || ''),
    String(u.name || ''),
    normalizeEmail(u.email),
    'facilitator',
    active ? 'true' : 'false',
    String(u.createdAt || ''),
    String(u.updatedAt || ''),
    status,
  ];
}

function parseDetailRow(r: unknown[]): SessionDetailRecord | null {
  if (!r || !r[0] || !r[1]) return null;
  return {
    detailRecordId: String(r[0] || '').trim(),
    sessionRecordId: String(r[1] || '').trim(),
    sessionId: String(r[2] || '').trim(),
    grade: String(r[3] || '').trim(),
    section: String(r[4] || '').trim(),
    studentsPresent: toNumberOrZero(r[5], 0),
    questionAScore5: toNumberOrZero(r[6], 0),
    questionAScore4: toNumberOrZero(r[7], 0),
    questionAScore3: toNumberOrZero(r[8], 0),
    questionAScore2: toNumberOrZero(r[9], 0),
    questionAScore1: toNumberOrZero(r[10], 0),
    questionATotal: toNumberOrZero(r[11], 0),
    questionAWeightedScore: toNumberOrZero(r[12], 0),
    csat: toNullableNumber(r[13]),
    questionBScore5: toNumberOrZero(r[14], 0),
    questionBScore4: toNumberOrZero(r[15], 0),
    questionBScore3: toNumberOrZero(r[16], 0),
    questionBScore2: toNumberOrZero(r[17], 0),
    questionBScore1: toNumberOrZero(r[18], 0),
    questionBTotal: toNumberOrZero(r[19], 0),
    questionBWeightedScore: toNumberOrZero(r[20], 0),
    itp: toNullableNumber(r[21]),
    createdAt: String(r[22] || '').trim(),
    updatedAt: String(r[23] || '').trim(),
  };
}

function parseSessionRow(
  r: unknown[],
  detailsBySessionRecordId: Map<string, SessionDetailRecord[]>,
  headerRow?: unknown[],
): SessionRecord | null {
  if (!r || !r[0] || !r[1]) return null;
  const sessionRecordId = String(r[0] || '').trim();
  const hasExplicitHeader = Boolean(
    headerRow &&
      headerRow.some((h) => String(h || '').trim().toLowerCase() === 'session_record_id'),
  );
  const isLegacy42 = hasExplicitHeader
    ? resolveSessionSheetLayout(headerRow).hasBlock
    : r.length >= 42 ||
      (String(r[25] ?? '').trim() !== 'single' &&
        String(r[25] ?? '').trim() !== 'combined' &&
        (String(r[26] ?? '').trim() === 'single' || String(r[26] ?? '').trim() === 'combined'));
  const off = isLegacy42 ? 1 : 0;

  const statusRaw = String(r[35 + off] || 'COMMITTED').trim().toUpperCase();
  const submissionStatus =
    statusRaw === 'PENDING' || statusRaw === 'CORRECTED' ? statusRaw : 'COMMITTED';
  const clsRaw = String(r[33 + off] || '').trim();
  const teacherClassification =
    clsRaw === 'Promoter' || clsRaw === 'Passive' || clsRaw === 'Detractor' ? clsRaw : 'Passive';

  return {
    sessionRecordId,
    sessionId: String(r[1] || '').trim(),
    clientSubmissionKey: String(r[2] || '').trim(),
    facilitatorName: String(r[3] || '').trim(),
    facilitatorEmail: normalizeEmail(String(r[4] || '')),
    facilitatorUserId: String(r[5] || '').trim(),
    tourId: String(r[6] || '').trim(),
    tourName: String(r[7] || '').trim(),
    videoId: String(r[8] || '').trim(),
    language: String(r[9] || '').trim(),
    startDate: String(r[10] || '').trim(),
    endDate: String(r[11] || '').trim(),
    startTime: String(r[12] || '').trim(),
    endTime: String(r[13] || '').trim(),
    durationMinutes: toNumberOrZero(r[14], 0),
    durationFormatted: String(r[15] || '').trim(),
    reportingMonth: String(r[16] || '').trim(),
    submissionTimestamp: String(r[17] || '').trim(),
    submissionDateFormatted: String(r[18] || '').trim(),
    schoolName: String(r[19] || '').trim(),
    udiseCode: String(r[20] || '').trim(),
    schoolType: String(r[21] || '').trim(),
    state: String(r[22] || '').trim(),
    district: String(r[23] || '').trim(),
    pinCode: String(r[24 + off] || '').trim(),
    sessionType: String(r[25 + off] || '').trim() === 'combined' ? 'combined' : 'single',
    totalClasses: toNumberOrZero(r[26 + off], 1),
    totalStudentsPresent: toNumberOrZero(r[27 + off], 0),
    totalQuestionAResponses: toNumberOrZero(r[28 + off], 0),
    totalQuestionBResponses: toNumberOrZero(r[29 + off], 0),
    overallCsat: toNullableNumber(r[30 + off]),
    overallItp: toNullableNumber(r[31 + off]),
    teacherScore: toNullableNumber(r[32 + off]),
    teacherClassification,
    teacherNps: toNumberOrZero(r[34 + off], 0),
    submissionStatus,
    syncStatus: 'SYNCED',
    createdAt: String(r[36 + off] || '').trim(),
    updatedAt: String(r[37 + off] || '').trim(),
    createdBy: normalizeEmail(String(r[38 + off] || '')),
    updatedBy: normalizeEmail(String(r[39 + off] || '')),
    archived: String(r[40 + off] ?? '').trim().toLowerCase() === 'true',
    details: detailsBySessionRecordId.get(sessionRecordId) || [],
  };
}

function parseSchoolRow(r: unknown[], headerRow?: unknown[]): SchoolRecord | null {
  if (!r || !r[0] || !r[2]) return null;
  const hasExplicitHeader = Boolean(
    headerRow &&
      headerRow.some((h) => String(h || '').trim().toLowerCase() === 'school_record_id'),
  );
  const col8Lower = String(r[8] ?? '').trim().toLowerCase();
  const isLegacy11 = hasExplicitHeader
    ? resolveSchoolSheetLayout(headerRow).hasBlock
    : r.length >= 11 || col8Lower === 'true' || col8Lower === 'false';
  const off = isLegacy11 ? 1 : 0;

  return {
    schoolRecordId: String(r[0] || '').trim(),
    schoolName: String(r[1] || '').trim(),
    udiseCode: String(r[2] || '').trim(),
    schoolType: String(r[3] || '').trim(),
    state: String(r[4] || '').trim(),
    district: String(r[5] || '').trim(),
    pinCode: String(r[6 + off] || '').trim(),
    active: String(r[7 + off] ?? 'true').trim().toLowerCase() !== 'false',
    createdAt: String(r[8 + off] || '').trim(),
    updatedAt: String(r[9 + off] || '').trim(),
  };
}

function parseUserRow(r: unknown[], fallbackRole: UserRole = 'facilitator'): ManagedUser | null {
  if (!r || !r[0] || !r[2]) return null;
  const email = normalizeEmail(String(r[2] || ''));
  const isSa = isAllowlistedSuperAdmin(email);
  const rawRole = String(r[3] || fallbackRole).trim().toLowerCase();
  const role: UserRole = isSa ? 'super_admin' : rawRole === 'super_admin' ? 'facilitator' : 'facilitator';
  const statusRaw = String(r[7] || '').trim().toUpperCase();
  const activeFlag = isSa ? true : String(r[4] ?? 'true').trim().toLowerCase() !== 'false';
  const status: UserApprovalStatus = isSa
    ? 'APPROVED'
    : statusRaw === 'APPROVED' || statusRaw === 'PENDING' || statusRaw === 'DENIED'
      ? statusRaw
      : activeFlag
        ? 'APPROVED'
        : 'DENIED';
  return {
    userId: String(r[0] || '').trim(),
    name: String(r[1] || '').trim(),
    email,
    role,
    active: status === 'APPROVED',
    status,
    createdAt: String(r[5] || '').trim(),
    updatedAt: String(r[6] || '').trim(),
  };
}

function parseAuditRow(r: unknown[]): AuditLogEntry | null {
  if (!r || !r[0]) return null;
  const resRaw = String(r[9] || 'SUCCESS').trim().toUpperCase();
  return {
    auditId: String(r[0] || '').trim(),
    timestamp: String(r[1] || '').trim(),
    userId: String(r[2] || '').trim(),
    userEmail: normalizeEmail(String(r[3] || '')),
    action: String(r[4] || '').trim(),
    entityType: String(r[5] || '').trim(),
    entityId: String(r[6] || '').trim(),
    previousSummary: String(r[7] || ''),
    newSummary: String(r[8] || ''),
    result: resRaw === 'DENIED' || resRaw === 'FAILED' ? resRaw : 'SUCCESS',
  };
}

function parseSyncRow(r: unknown[]): SyncLogEntry | null {
  if (!r || !r[0]) return null;
  const stRaw = String(r[8] || 'SYNCED').trim().toUpperCase();
  const status: SyncLogEntry['status'] =
    stRaw === 'LOCAL_SANDBOX' || stRaw === 'PENDING_RETRY' || stRaw === 'FAILED'
      ? stRaw
      : 'SYNCED';
  return {
    syncId: String(r[0] || '').trim(),
    timestamp: String(r[1] || '').trim(),
    clientSubmissionKey: String(r[2] || '').trim(),
    sessionRecordId: String(r[3] || '').trim(),
    sessionId: String(r[4] || '').trim(),
    actorEmail: normalizeEmail(String(r[5] || '')),
    operation: String(r[6] || '').trim(),
    attempt: toNumberOrZero(r[7], 1),
    status,
    errorMessage: String(r[9] || ''),
  };
}

async function appendLogRows(
  spreadsheetId: string,
  accessToken: string,
  { auditRow, syncRow }: { auditRow?: unknown[]; syncRow?: unknown[] },
): Promise<void> {
  if (auditRow) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Audit Log')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      accessToken,
      { method: 'POST', body: JSON.stringify({ values: [auditRow] }) },
    );
  }
  if (syncRow) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Sync Log')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      accessToken,
      { method: 'POST', body: JSON.stringify({ values: [syncRow] }) },
    );
  }
}

async function deleteSheetRowsDescending(
  spreadsheetId: string,
  accessToken: string,
  items: Array<{ sheetTitle: string; rowNum: number }>,
): Promise<void> {
  if (items.length === 0) return;
  const meta = await googleDirectJson<{
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`,
    accessToken,
  );
  const sheetIdByTitle = new Map<string, number>();
  for (const s of meta.sheets || []) {
    if (s.properties?.title && s.properties.sheetId !== undefined) {
      sheetIdByTitle.set(s.properties.title, s.properties.sheetId);
    }
  }
  const sorted = [...items].sort((a, b) => b.rowNum - a.rowNum);
  const requests = [];
  for (const item of sorted) {
    const sheetId = sheetIdByTitle.get(item.sheetTitle);
    if (sheetId === undefined || !Number.isInteger(item.rowNum) || item.rowNum < 2) continue;
    requests.push({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: item.rowNum - 1,
          endIndex: item.rowNum,
        },
      },
    });
  }
  if (requests.length > 0) {
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      { method: 'POST', body: JSON.stringify({ requests }) },
    );
  }
}

// ---------- High-level Workspace Operations ----------

export async function listDirectGoogleSpreadsheets(
  accessToken: string,
): Promise<ApiResponse<GoogleSpreadsheetSummary[]>> {
  try {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    const fields = encodeURIComponent('files(id,name,webViewLink,modifiedTime)');
    const data = await googleDirectJson<{
      files?: Array<{ id?: string; name?: string; webViewLink?: string; modifiedTime?: string }>;
    }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=30&orderBy=modifiedTime%20desc`,
      accessToken,
    );
    const items: GoogleSpreadsheetSummary[] = (data.files || [])
      .filter((f) => Boolean(f.id))
      .map((f) => ({
        spreadsheetId: String(f.id),
        name: String(f.name || 'Untitled Spreadsheet'),
        url: String(f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`),
        modifiedTime: f.modifiedTime,
      }));
    return { ok: true, data: items };
  } catch (err) {
    return handleDirectError(err, 'Unable to list Google Spreadsheets.');
  }
}

export async function createDirectGoogleSheetWithSchema(params: {
  accessToken: string;
  title: string;
  actorEmail: string;
}): Promise<ApiResponse<GoogleSheetsConnectionState>> {
  try {
    const cleanTitle = params.title.trim();
    if (!cleanTitle) {
      return { ok: false, code: 'INVALID_TITLE', error: 'Spreadsheet name is required.' };
    }
    const created = await googleDirectJson<{
      spreadsheetId: string;
      properties?: { title?: string };
      spreadsheetUrl?: string;
    }>('https://sheets.googleapis.com/v4/spreadsheets', params.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: cleanTitle, timeZone: PROGRAMME_TIMEZONE },
        sheets: DIRECT_SHEETS_SCHEMA_DEFINITIONS.map((d) => ({
          properties: {
            title: d.name,
            gridProperties: { frozenRowCount: 1, rowCount: 1000, columnCount: Math.max(26, d.headers.length) },
          },
        })),
      }),
    });

    const schemaInfo = await initializeDirectSpreadsheetSchema(
      created.spreadsheetId,
      params.accessToken,
    );
    const nowIso = new Date().toISOString();
    const actor = resolveActorInfo(params.actorEmail);
    await appendLogRows(created.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        'CREATE_GOOGLE_SHEET',
        'Configuration',
        schemaInfo.spreadsheetId,
        '',
        `Created "${schemaInfo.spreadsheetName}" directly via Google OAuth 2.0`,
        'SUCCESS',
      ],
    });

    return {
      ok: true,
      data: {
        connected: true,
        authMethod: 'google_oauth',
        connectionProvider: 'direct_browser',
        oauthConfigured: true,
        connectedAccount: actor.email,
        spreadsheetId: schemaInfo.spreadsheetId,
        spreadsheetName: cleanTitle,
        spreadsheetUrl: schemaInfo.spreadsheetUrl,
        connectedAt: nowIso,
        connectedBy: actor.email,
        lastSyncedAt: '',
        lastSyncStatus: 'IDLE',
        lastSyncMessage: `Created "${cleanTitle}" with 10 formatted tabs.`,
        initializedTabs: schemaInfo.initializedTabs,
        defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
      },
    };
  } catch (err) {
    return handleDirectError(err, 'Failed to create Google Spreadsheet.');
  }
}

export async function connectDirectGoogleSheet(params: {
  accessToken: string;
  spreadsheetUrlOrId: string;
  spreadsheetName?: string;
  initializeSchema?: boolean;
  actorEmail: string;
}): Promise<ApiResponse<GoogleSheetsConnectionState>> {
  try {
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

    const meta = await googleDirectJson<{
      spreadsheetId: string;
      properties?: { title?: string };
      spreadsheetUrl?: string;
      sheets?: Array<{ properties?: { title?: string } }>;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets(properties.title)`,
      params.accessToken,
    );

    const schemaInfo =
      params.initializeSchema !== false
        ? await initializeDirectSpreadsheetSchema(spreadsheetId, params.accessToken)
        : {
            spreadsheetId,
            spreadsheetName: meta.properties?.title || 'Connected Google Spreadsheet',
            spreadsheetUrl:
              meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
            initializedTabs: (meta.sheets || [])
              .map((s) => s.properties?.title || '')
              .filter(Boolean),
          };

    const nowIso = new Date().toISOString();
    const actor = resolveActorInfo(params.actorEmail);
    const displayName =
      (params.spreadsheetName || '').trim() ||
      schemaInfo.spreadsheetName ||
      'Vidhya Vidhai · Career Tours Database';

    await appendLogRows(spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        'CONNECT_GOOGLE_SHEET',
        'Configuration',
        spreadsheetId,
        '',
        `Connected "${displayName}" directly via Google OAuth 2.0`,
        'SUCCESS',
      ],
    });

    return {
      ok: true,
      data: {
        connected: true,
        authMethod: 'google_oauth',
        connectionProvider: 'direct_browser',
        oauthConfigured: true,
        connectedAccount: actor.email,
        spreadsheetId,
        spreadsheetName: displayName,
        spreadsheetUrl: schemaInfo.spreadsheetUrl,
        connectedAt: nowIso,
        connectedBy: actor.email,
        lastSyncedAt: '',
        lastSyncStatus: 'IDLE',
        lastSyncMessage: `Connected "${displayName}" (${schemaInfo.initializedTabs.length} tabs verified).`,
        initializedTabs: schemaInfo.initializedTabs,
        defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
      },
    };
  } catch (err) {
    return handleDirectError(err, 'Unable to connect Google Spreadsheet.');
  }
}

export async function loadDirectWorkspace(
  spreadsheetId: string,
  accessToken: string,
): Promise<
  ApiResponse<{
    sessions: SessionRecord[];
    schools: SchoolRecord[];
    users: ManagedUser[];
    configurationPatch: Partial<AppConfiguration>;
    auditLogs: AuditLogEntry[];
    syncLogs: SyncLogEntry[];
    spreadsheetId: string;
  }>
> {
  try {
    const [
      sessionRows,
      detailRows,
      facilitatorRows,
      schoolRows,
      cfgRows,
      adminRows,
      auditRows,
      syncRows,
      sessionHeaderRows,
      schoolHeaderRows,
    ] = await batchGetRanges(spreadsheetId, accessToken, [
      `${a1Tab('Sessions')}!A2:AP`,
      `${a1Tab('Session Details')}!A2:X`,
      `${a1Tab('Facilitators')}!A2:H`,
      `${a1Tab('Schools')}!A2:K`,
      `${a1Tab('Configuration')}!A2:D`,
      `${a1Tab('Admin Users')}!A2:H`,
      `${a1Tab('Audit Log')}!A2:J`,
      `${a1Tab('Sync Log')}!A2:J`,
      `${a1Tab('Sessions')}!A1:AP1`,
      `${a1Tab('Schools')}!A1:K1`,
    ]);
    const sessionHeader = sessionHeaderRows?.[0];
    const schoolHeader = schoolHeaderRows?.[0];

    const detailsBySession = new Map<string, SessionDetailRecord[]>();
    for (const r of detailRows || []) {
      const parsed = parseDetailRow(r);
      if (!parsed) continue;
      const list = detailsBySession.get(parsed.sessionRecordId) || [];
      list.push(parsed);
      detailsBySession.set(parsed.sessionRecordId, list);
    }

    const sessions = (sessionRows || [])
      .map((r) => parseSessionRow(r, detailsBySession, sessionHeader))
      .filter((s): s is SessionRecord => Boolean(s));
    sessions.sort((a, b) =>
      String(b.createdAt || b.startDate).localeCompare(String(a.createdAt || a.startDate)),
    );

    const schools = (schoolRows || [])
      .map((r) => parseSchoolRow(r, schoolHeader))
      .filter((sc): sc is SchoolRecord => Boolean(sc));

    const usersMap = new Map<string, ManagedUser>();
    for (const r of [...(adminRows || []), ...(facilitatorRows || [])]) {
      const parsed = parseUserRow(r);
      if (!parsed) continue;
      usersMap.set(parsed.email, parsed);
    }

    const { configurationPatch } = parseConfigFromSheetRows(cfgRows || []);
    const auditLogs = (auditRows || [])
      .map(parseAuditRow)
      .filter((a): a is AuditLogEntry => Boolean(a))
      .reverse();
    const syncLogs = (syncRows || [])
      .map(parseSyncRow)
      .filter((s): s is SyncLogEntry => Boolean(s))
      .reverse();

    return {
      ok: true,
      data: {
        sessions,
        schools,
        users: Array.from(usersMap.values()),
        configurationPatch,
        auditLogs,
        syncLogs,
        spreadsheetId,
      },
    };
  } catch (err) {
    return handleDirectError(err, 'Failed to read programme data from Google Sheets.');
  }
}

export async function syncWorkspaceToDirectGoogleSheet(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  sessions: SessionRecord[];
  schools: SchoolRecord[];
  users: ManagedUser[];
  config: AppConfiguration;
}): Promise<ApiResponse<DirectSheetsSyncSummary>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const [
      existingSessionKeys,
      existingDetailIds,
      existingSchoolRows,
      existingFacilitatorRows,
      existingCfgRows,
      sessionHeaderRows,
      schoolHeaderRows,
    ] = await batchGetRanges(params.spreadsheetId, params.accessToken, [
      `${a1Tab('Sessions')}!A2:C`,
      `${a1Tab('Session Details')}!A2:A`,
      `${a1Tab('Schools')}!A2:C`,
      `${a1Tab('Facilitators')}!A2:C`,
      `${a1Tab('Configuration')}!A2:D`,
      `${a1Tab('Sessions')}!A1:AP1`,
      `${a1Tab('Schools')}!A1:K1`,
    ]);
    const sessionLayout = resolveSessionSheetLayout(sessionHeaderRows?.[0]);
    const schoolLayout = resolveSchoolSheetLayout(schoolHeaderRows?.[0]);

    const seenRecordIds = new Set<string>();
    const seenSessionIds = new Set<string>();
    const seenClientKeys = new Set<string>();
    for (const r of existingSessionKeys || []) {
      if (r[0]) seenRecordIds.add(String(r[0]).trim());
      if (r[1]) seenSessionIds.add(String(r[1]).trim());
      if (r[2]) seenClientKeys.add(String(r[2]).trim());
    }

    const seenDetailIds = new Set<string>();
    for (const r of existingDetailIds || []) {
      if (r[0]) seenDetailIds.add(String(r[0]).trim());
    }

    const sessionRowsToAppend: unknown[][] = [];
    const detailRowsToAppend: unknown[][] = [];
    let skippedDuplicates = 0;

    for (const s of params.sessions) {
      if (!s || !s.sessionId) continue;
      const rId = String(s.sessionRecordId || '').trim();
      const sId = String(s.sessionId || '').trim();
      const cKey = String(s.clientSubmissionKey || '').trim();
      if (
        (rId && seenRecordIds.has(rId)) ||
        (sId && seenSessionIds.has(sId)) ||
        (cKey && seenClientKeys.has(cKey))
      ) {
        skippedDuplicates++;
        continue;
      }
      sessionRowsToAppend.push(serializeSessionRow(s, sessionLayout.hasBlock));
      for (const d of s.details || []) {
        const dId = String(d.detailRecordId || '').trim();
        if (dId && seenDetailIds.has(dId)) continue;
        detailRowsToAppend.push(serializeDetailRow(d));
        if (dId) seenDetailIds.add(dId);
      }
      if (rId) seenRecordIds.add(rId);
      seenSessionIds.add(sId);
      if (cKey) seenClientKeys.add(cKey);
    }

    if (sessionRowsToAppend.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ values: sessionRowsToAppend }) },
      );
    }
    if (detailRowsToAppend.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Session Details')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ values: detailRowsToAppend }) },
      );
    }

    // Deduplicated Schools sync (including schools referenced only in sessions)
    const seenSchoolIds = new Set<string>();
    const seenSchoolUdises = new Set<string>();
    for (const r of existingSchoolRows || []) {
      if (r[0]) seenSchoolIds.add(String(r[0]).trim());
      if (r[2]) seenSchoolUdises.add(String(r[2]).trim());
    }
    const nowIso = new Date().toISOString();
    const schoolCandidates: SchoolRecord[] = [...params.schools];
    for (const s of params.sessions) {
      const udise = String(s.udiseCode || '').trim();
      if (!udise) continue;
      if (!schoolCandidates.some((sc) => sc.udiseCode === udise)) {
        schoolCandidates.push({
          schoolRecordId: `SCH_${udise}`,
          schoolName: s.schoolName,
          udiseCode: udise,
          schoolType: s.schoolType,
          state: s.state,
          district: s.district,
          pinCode: s.pinCode,
          active: true,
          createdAt: s.createdAt || nowIso,
          updatedAt: s.updatedAt || nowIso,
        });
      }
    }
    const schoolRowsToAppend: unknown[][] = [];
    for (const sc of schoolCandidates) {
      const id = String(sc.schoolRecordId || '').trim();
      const udise = String(sc.udiseCode || '').trim();
      if ((id && seenSchoolIds.has(id)) || (udise && seenSchoolUdises.has(udise))) continue;
      schoolRowsToAppend.push(serializeSchoolRow(sc, schoolLayout.hasBlock));
      if (id) seenSchoolIds.add(id);
      if (udise) seenSchoolUdises.add(udise);
    }
    if (schoolRowsToAppend.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Schools')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ values: schoolRowsToAppend }) },
      );
    }

    // Deduplicated Facilitators sync (never insert Super Admins into Facilitators tab)
    const seenFacIds = new Set<string>();
    const seenFacEmails = new Set<string>();
    for (const r of existingFacilitatorRows || []) {
      if (r[0]) seenFacIds.add(String(r[0]).trim());
      if (r[2]) seenFacEmails.add(normalizeEmail(String(r[2])));
    }
    const facRowsToAppend: unknown[][] = [];
    for (const u of params.users) {
      const cleanEmail = normalizeEmail(u.email);
      if (!cleanEmail || isAllowlistedSuperAdmin(cleanEmail) || u.role === 'super_admin') continue;
      const uId = String(u.userId || '').trim();
      if ((uId && seenFacIds.has(uId)) || seenFacEmails.has(cleanEmail)) continue;
      facRowsToAppend.push(serializeFacilitatorRow(u));
      if (uId) seenFacIds.add(uId);
      seenFacEmails.add(cleanEmail);
    }
    if (facRowsToAppend.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Facilitators')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ values: facRowsToAppend }) },
      );
    }

    // Upsert Configuration keys cleanly
    const cfgKeyToRowNum = new Map<string, number>();
    (existingCfgRows || []).forEach((r, idx) => {
      const k = String(r[0] || '').trim();
      if (k) cfgKeyToRowNum.set(k, idx + 2);
    });
    const cfgEntries = buildConfigKeyValuesFromPartial(params.config);
    const cfgBatchUpdates: Array<{ range: string; values: unknown[][] }> = [];
    const cfgAppendRows: unknown[][] = [];
    for (const [k, valJson] of cfgEntries) {
      const rowValues = [k, valJson, nowIso, actor.email];
      const existingRowNum = cfgKeyToRowNum.get(k);
      if (existingRowNum) {
        cfgBatchUpdates.push({
          range: `${a1Tab('Configuration')}!A${existingRowNum}:D${existingRowNum}`,
          values: [rowValues],
        });
      } else {
        cfgAppendRows.push(rowValues);
      }
    }
    if (cfgBatchUpdates.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values:batchUpdate`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: cfgBatchUpdates }) },
      );
    }
    if (cfgAppendRows.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ values: cfgAppendRows }) },
      );
    }

    const parts: string[] = [];
    if (sessionRowsToAppend.length > 0) {
      parts.push(`${sessionRowsToAppend.length} session(s)`);
    }
    if (schoolRowsToAppend.length > 0) {
      parts.push(`${schoolRowsToAppend.length} school(s)`);
    }
    if (facRowsToAppend.length > 0) {
      parts.push(`${facRowsToAppend.length} facilitator(s)`);
    }
    const message =
      parts.length > 0
        ? `Pushed ${parts.join(', ')} + programme settings to live Google Sheet (skipped ${skippedDuplicates} duplicate session(s)).`
        : `Verified ${seenRecordIds.size} session(s) and programme configuration up to date in live Google Sheet (0 duplicates written).`;

    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        'SYNC_GOOGLE_SHEET',
        'Configuration',
        params.spreadsheetId,
        '',
        message,
        'SUCCESS',
      ],
      syncRow: [
        `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        'BULK_SYNC',
        params.spreadsheetId,
        'ALL',
        actor.email,
        'syncAllToGoogleSheet',
        1,
        'SYNCED',
        '',
      ],
    });

    return {
      ok: true,
      data: {
        syncedCount: sessionRowsToAppend.length,
        skippedDuplicates,
        totalSheetSessions: seenRecordIds.size,
        syncedAt: nowIso,
        message,
        syncedSchoolsCount: schoolRowsToAppend.length,
        syncedFacilitatorsCount: facRowsToAppend.length,
      },
    };
  } catch (err) {
    return handleDirectError(err, 'Failed to push local data to Google Sheets.');
  }
}

export async function createDirectSession(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  values: SessionFormValues;
  fallbackConfig: AppConfiguration;
}): Promise<ApiResponse<{ session: SessionRecord; warnings: string[]; schoolUdiseConflict?: string }>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const [cfgRows, sessionRows, schoolRows, sessionHeaderRows, schoolHeaderRows] = await batchGetRanges(
      params.spreadsheetId,
      params.accessToken,
      [
        `${a1Tab('Configuration')}!A2:D`,
        `${a1Tab('Sessions')}!A2:AP`,
        `${a1Tab('Schools')}!A2:K`,
        `${a1Tab('Sessions')}!A1:AP1`,
        `${a1Tab('Schools')}!A1:K1`,
      ],
    );
    const sessionHeader = sessionHeaderRows?.[0];
    const schoolHeader = schoolHeaderRows?.[0];
    const sessionLayout = resolveSessionSheetLayout(sessionHeader);
    const schoolLayout = resolveSchoolSheetLayout(schoolHeader);
    const parsedCfg = parseConfigFromSheetRows(cfgRows || []);
    const effectiveConfig: AppConfiguration =
      Object.keys(parsedCfg.configurationPatch).length > 0
        ? parsedCfg.config
        : params.fallbackConfig;

    const values: SessionFormValues = {
      ...params.values,
      facilitatorEmail: actor.email,
      schoolName: params.values.schoolName.trim(),
      udiseCode: params.values.udiseCode.trim(),
      pinCode: params.values.pinCode.trim(),
    };

    const existingSessionsByKey = new Map<string, SessionRecord>();
    const existingSessionIds = new Set<string>();
    for (const r of sessionRows || []) {
      const s = parseSessionRow(r, new Map(), sessionHeader);
      if (!s) continue;
      existingSessionIds.add(s.sessionId);
      if (s.clientSubmissionKey) existingSessionsByKey.set(s.clientSubmissionKey, s);
    }

    if (values.clientSubmissionKey && existingSessionsByKey.has(values.clientSubmissionKey)) {
      const ex = existingSessionsByKey.get(values.clientSubmissionKey)!;
      if (ex.submissionStatus !== 'PENDING') {
        return {
          ok: true,
          data: {
            session: ex,
            warnings: ['Duplicate submission prevented — returned existing Google Sheet record.'],
          },
        };
      }
    }

    const validation = validateSessionForm(values, effectiveConfig);
    if (!validation.valid) {
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        error: validation.errors.map((e) => e.message).join(' '),
      };
    }

    const tour = effectiveConfig.tours.find((t) => t.tourId === values.tourId)!;
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
        effectiveConfig.programmeTimezone,
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

    let maxSeq = 0;
    for (const existingId of existingSessionIds) {
      if (existingId.startsWith(`${prefix}_`)) {
        const tail = existingId.slice(prefix.length + 1);
        const n = Number.parseInt(tail, 10);
        if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
      }
    }
    let candidateSeq = maxSeq + 1;
    let sessionId = formatSessionIdWithSequence(prefix, candidateSeq);
    while (existingSessionIds.has(sessionId)) {
      candidateSeq++;
      sessionId = formatSessionIdWithSequence(prefix, candidateSeq);
    }

    const nowIso = new Date().toISOString();
    const todayKolkata = getTodayKolkataISO(effectiveConfig.programmeTimezone);
    const sessionRecordId = `REC_${generateUuid().toUpperCase()}`;
    const videoInfo = resolveConfiguredVideoId(tour, values.language, effectiveConfig);

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

    const sessionRecord: SessionRecord = {
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
      syncStatus: 'SYNCED',
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: actor.email,
      updatedBy: actor.email,
      archived: false,
      details: detailRecords,
    };

    const appendSessionRes = await googleDirectJson<{
      updates?: { updatedRange?: string };
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        params.spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      params.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ values: [serializeSessionRow(sessionRecord, sessionLayout.hasBlock)] }),
      },
    );

    const updatedRange = appendSessionRes.updates?.updatedRange || '';
    const match = /![A-Z]+(\d+)/i.exec(updatedRange);
    const appendedRowNum = match?.[1] ? Number.parseInt(match[1], 10) : null;

    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        params.spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Session Details')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      params.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ values: detailRecords.map(serializeDetailRow) }),
      },
    );

    sessionRecord.submissionStatus = 'COMMITTED';
    if (appendedRowNum) {
      const statusColLetter = colIndexToLetter(sessionLayout.statusCol1);
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!${statusColLetter}${appendedRowNum}`)}?valueInputOption=RAW`,
        params.accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({ values: [['COMMITTED']] }),
        },
      );
    }

    let schoolUdiseConflict: string | undefined;
    const existingSchool = (schoolRows || [])
      .map((r) => parseSchoolRow(r, schoolHeader))
      .find((sc) => sc && sc.udiseCode === values.udiseCode);
    if (!existingSchool) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Schools')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            values: [
              serializeSchoolRow(
                {
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
                },
                schoolLayout.hasBlock,
              ),
            ],
          }),
        },
      );
    } else if (existingSchool.schoolName.toLowerCase() !== values.schoolName.toLowerCase()) {
      schoolUdiseConflict = `UDISE ${values.udiseCode} is already registered to "${existingSchool.schoolName}". School master record was preserved.`;
    }

    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        'CREATE_SESSION',
        'Session',
        sessionRecordId,
        '',
        `Session ${sessionId} (${values.district}, ${metrics.totalStudentsPresent} students)`,
        'SUCCESS',
      ],
      syncRow: [
        `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        values.clientSubmissionKey,
        sessionRecordId,
        sessionId,
        actor.email,
        'createSession',
        1,
        'SYNCED',
        '',
      ],
    });

    return {
      ok: true,
      data: {
        session: sessionRecord,
        warnings: validation.warnings.map((w) => w.message),
        schoolUdiseConflict,
      },
    };
  } catch (err) {
    return handleDirectError(err, 'Failed to write session to Google Sheets.');
  }
}

export async function updateDirectSession(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  sessionRecordId: string;
  values: SessionFormValues;
  fallbackConfig: AppConfiguration;
}): Promise<ApiResponse<{ session: SessionRecord; warnings: string[] }>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const [cfgRows, sessionRows, detailRows, sessionHeaderRows] = await batchGetRanges(
      params.spreadsheetId,
      params.accessToken,
      [
        `${a1Tab('Configuration')}!A2:D`,
        `${a1Tab('Sessions')}!A2:AP`,
        `${a1Tab('Session Details')}!A2:X`,
        `${a1Tab('Sessions')}!A1:AP1`,
      ],
    );
    const sessionHeader = sessionHeaderRows?.[0];
    const sessionLayout = resolveSessionSheetLayout(sessionHeader);
    const parsedCfg = parseConfigFromSheetRows(cfgRows || []);
    const effectiveConfig =
      Object.keys(parsedCfg.configurationPatch).length > 0
        ? parsedCfg.config
        : params.fallbackConfig;

    const rowIdx = (sessionRows || []).findIndex(
      (r) => String(r[0] || '').trim() === params.sessionRecordId,
    );
    if (rowIdx === -1) {
      return { ok: false, code: 'NOT_FOUND', error: 'Session record not found in Google Sheet.' };
    }
    const existingSession = parseSessionRow(sessionRows![rowIdx]!, new Map(), sessionHeader);
    if (!existingSession) {
      return { ok: false, code: 'NOT_FOUND', error: 'Session record is malformed.' };
    }

    const values: SessionFormValues = {
      ...params.values,
      facilitatorEmail: existingSession.facilitatorEmail || actor.email,
      schoolName: params.values.schoolName.trim(),
      udiseCode: params.values.udiseCode.trim(),
      pinCode: params.values.pinCode.trim(),
    };
    const validation = validateSessionForm(values, effectiveConfig);
    if (!validation.valid) {
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        error: validation.errors.map((e) => e.message).join(' '),
      };
    }

    const tour = effectiveConfig.tours.find((t) => t.tourId === values.tourId)!;
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
        effectiveConfig.programmeTimezone,
      ) ?? 0;

    const nowIso = new Date().toISOString();
    const videoInfo = resolveConfiguredVideoId(tour, values.language, effectiveConfig);
    const detailRecords: SessionDetailRecord[] = metrics.classBreakdown.map((c, idx) => ({
      detailRecordId: `DET_${existingSession.sessionRecordId}_${idx + 1}`,
      sessionRecordId: existingSession.sessionRecordId,
      sessionId: existingSession.sessionId,
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
      createdAt: existingSession.createdAt,
      updatedAt: nowIso,
    }));

    const updatedRecord: SessionRecord = {
      ...existingSession,
      facilitatorName: values.facilitatorName.trim(),
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
      submissionStatus: 'CORRECTED',
      syncStatus: 'SYNCED',
      updatedAt: nowIso,
      updatedBy: actor.email,
      details: detailRecords,
    };

    const rowNum = rowIdx + 2;
    const endColLetter = colIndexToLetter(sessionLayout.totalCols);
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        params.spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!A${rowNum}:${endColLetter}${rowNum}`)}?valueInputOption=RAW`,
      params.accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          values: [serializeSessionRow(updatedRecord, sessionLayout.hasBlock)],
        }),
      },
    );

    const detailRowsToDelete: Array<{ sheetTitle: string; rowNum: number }> = [];
    (detailRows || []).forEach((r, idx) => {
      if (String(r[1] || '').trim() === params.sessionRecordId) {
        detailRowsToDelete.push({ sheetTitle: 'Session Details', rowNum: idx + 2 });
      }
    });
    if (detailRowsToDelete.length > 0) {
      await deleteSheetRowsDescending(params.spreadsheetId, params.accessToken, detailRowsToDelete);
    }
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        params.spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Session Details')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      params.accessToken,
      { method: 'POST', body: JSON.stringify({ values: detailRecords.map(serializeDetailRow) }) },
    );

    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        'ADMIN_CORRECT_SESSION',
        'Session',
        updatedRecord.sessionRecordId,
        '',
        `CSAT=${updatedRecord.overallCsat}, ITP=${updatedRecord.overallItp}, Students=${updatedRecord.totalStudentsPresent}`,
        'SUCCESS',
      ],
      syncRow: [
        `SYNC_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        updatedRecord.clientSubmissionKey || '',
        updatedRecord.sessionRecordId,
        updatedRecord.sessionId,
        actor.email,
        'updateSession',
        1,
        'SYNCED',
        '',
      ],
    });

    return {
      ok: true,
      data: {
        session: updatedRecord,
        warnings: validation.warnings.map((w) => w.message),
      },
    };
  } catch (err) {
    return handleDirectError(err, 'Failed to update session in Google Sheets.');
  }
}

export async function setDirectSessionArchived(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  sessionRecordId: string;
  archived: boolean;
}): Promise<ApiResponse<{ archived: boolean }>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const [sessionRows, sessionHeaderRows] = await batchGetRanges(
      params.spreadsheetId,
      params.accessToken,
      [`${a1Tab('Sessions')}!A2:AP`, `${a1Tab('Sessions')}!A1:AP1`],
    );
    const sessionLayout = resolveSessionSheetLayout(sessionHeaderRows?.[0]);
    const idx = (sessionRows || []).findIndex(
      (r) => String(r[0] || '').trim() === params.sessionRecordId,
    );
    if (idx === -1) {
      return { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' };
    }
    const rowNum = idx + 2;
    const nowIso = new Date().toISOString();
    const updatedAtLetter = colIndexToLetter(sessionLayout.updatedAtCol1);
    const updatedByLetter = colIndexToLetter(sessionLayout.updatedByCol1);
    const archivedLetter = colIndexToLetter(sessionLayout.archivedCol1);
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        params.spreadsheetId,
      )}/values:batchUpdate`,
      params.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: [
            { range: `${a1Tab('Sessions')}!${updatedAtLetter}${rowNum}`, values: [[nowIso]] },
            { range: `${a1Tab('Sessions')}!${updatedByLetter}${rowNum}`, values: [[actor.email]] },
            {
              range: `${a1Tab('Sessions')}!${archivedLetter}${rowNum}`,
              values: [[params.archived ? 'true' : 'false']],
            },
          ],
        }),
      },
    );
    return { ok: true, data: { archived: params.archived } };
  } catch (err) {
    return handleDirectError(err, 'Failed to update archive flag in Google Sheets.');
  }
}

export async function deleteDirectSessions(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  sessionRecordIds: string[];
}): Promise<ApiResponse<{ deletedCount: number; deletedDetailsCount: number }>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const idSet = new Set(params.sessionRecordIds.map((id) => id.trim()).filter(Boolean));
    const [sessionRows, detailRows] = await batchGetRanges(
      params.spreadsheetId,
      params.accessToken,
      [`${a1Tab('Sessions')}!A2:B`, `${a1Tab('Session Details')}!A2:B`],
    );
    const toDelete: Array<{ sheetTitle: string; rowNum: number }> = [];
    let deletedSessionsCount = 0;
    let deletedDetailsCount = 0;
    (sessionRows || []).forEach((r, idx) => {
      if (idSet.has(String(r[0] || '').trim())) {
        toDelete.push({ sheetTitle: 'Sessions', rowNum: idx + 2 });
        deletedSessionsCount++;
      }
    });
    (detailRows || []).forEach((r, idx) => {
      if (idSet.has(String(r[1] || '').trim())) {
        toDelete.push({ sheetTitle: 'Session Details', rowNum: idx + 2 });
        deletedDetailsCount++;
      }
    });
    if (deletedSessionsCount === 0) {
      return { ok: false, code: 'NOT_FOUND', error: 'No matching sessions found in Google Sheet.' };
    }
    await deleteSheetRowsDescending(params.spreadsheetId, params.accessToken, toDelete);
    const nowIso = new Date().toISOString();
    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        deletedSessionsCount > 1 ? 'BULK_DELETE_SESSIONS' : 'DELETE_SESSION',
        'Session',
        deletedSessionsCount === 1 ? Array.from(idSet)[0]! : 'BULK',
        `${deletedSessionsCount} session(s)`,
        `Permanently deleted ${deletedSessionsCount} session(s) and ${deletedDetailsCount} detail row(s)`,
        'SUCCESS',
      ],
    });
    return {
      ok: true,
      data: { deletedCount: deletedSessionsCount, deletedDetailsCount },
    };
  } catch (err) {
    return handleDirectError(err, 'Failed to delete session rows in Google Sheets.');
  }
}

export async function updateDirectSchool(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  school: {
    schoolRecordId: string;
    schoolName: string;
    udiseCode: string;
    schoolType: string;
    state: string;
    district: string;
    pinCode: string;
    active: boolean;
  };
}): Promise<ApiResponse<SchoolRecord>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const [schoolRows, schoolHeaderRows] = await batchGetRanges(
      params.spreadsheetId,
      params.accessToken,
      [`${a1Tab('Schools')}!A2:K`, `${a1Tab('Schools')}!A1:K1`],
    );
    const schoolLayout = resolveSchoolSheetLayout(schoolHeaderRows?.[0]);
    const idx = (schoolRows || []).findIndex(
      (r) => String(r[0] || '').trim() === params.school.schoolRecordId,
    );
    if (idx === -1) {
      return { ok: false, code: 'NOT_FOUND', error: 'School record not found in Google Sheet.' };
    }
    const conflicting = (schoolRows || []).find(
      (r) =>
        String(r[0] || '').trim() !== params.school.schoolRecordId &&
        String(r[2] || '').trim() === params.school.udiseCode,
    );
    if (conflicting) {
      return {
        ok: false,
        code: 'DUPLICATE_UDISE',
        error: `UDISE ${params.school.udiseCode} is already assigned to "${String(conflicting[1] || '').trim()}".`,
      };
    }
    const existingRow = schoolRows![idx]!;
    const parsedExisting = parseSchoolRow(existingRow, schoolHeaderRows?.[0]);
    const createdAt =
      parsedExisting?.createdAt ||
      String(existingRow[schoolLayout.createdAtCol0] || new Date().toISOString());
    const nowIso = new Date().toISOString();
    const updated: SchoolRecord = {
      ...params.school,
      createdAt,
      updatedAt: nowIso,
    };
    const rowNum = idx + 2;
    const endColLetter = colIndexToLetter(schoolLayout.totalCols);
    await googleDirectJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        params.spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Schools')}!A${rowNum}:${endColLetter}${rowNum}`)}?valueInputOption=RAW`,
      params.accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [serializeSchoolRow(updated, schoolLayout.hasBlock)] }),
      },
    );
    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        'UPDATE_SCHOOL',
        'School',
        updated.schoolRecordId,
        '',
        `${updated.udiseCode} (${updated.schoolName}, active=${updated.active})`,
        'SUCCESS',
      ],
    });
    return { ok: true, data: updated };
  } catch (err) {
    return handleDirectError(err, 'Failed to update school in Google Sheets.');
  }
}

export async function deleteDirectSchool(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  schoolRecordId: string;
}): Promise<ApiResponse<{ deleted: boolean; udiseCode: string }>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const [schoolRows] = await batchGetRanges(params.spreadsheetId, params.accessToken, [
      `${a1Tab('Schools')}!A2:K`,
    ]);
    const idx = (schoolRows || []).findIndex(
      (r) =>
        String(r[0] || '').trim() === params.schoolRecordId ||
        String(r[2] || '').trim() === params.schoolRecordId,
    );
    if (idx === -1) {
      return { ok: false, code: 'NOT_FOUND', error: 'School record not found in Google Sheet.' };
    }
    const udiseCode = String(schoolRows![idx]![2] || '').trim();
    await deleteSheetRowsDescending(params.spreadsheetId, params.accessToken, [
      { sheetTitle: 'Schools', rowNum: idx + 2 },
    ]);
    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        new Date().toISOString(),
        actor.userId,
        actor.email,
        'DELETE_SCHOOL',
        'School',
        params.schoolRecordId,
        udiseCode,
        'Removed from Schools directory',
        'SUCCESS',
      ],
    });
    return { ok: true, data: { deleted: true, udiseCode } };
  } catch (err) {
    return handleDirectError(err, 'Failed to delete school from Google Sheets.');
  }
}

export async function manageDirectUser(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  user: {
    userId?: string;
    name: string;
    email: string;
    role: UserRole;
    active: boolean;
    status?: UserApprovalStatus;
  };
}): Promise<ApiResponse<ManagedUser>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const emailClean = normalizeEmail(params.user.email);
    const nameClean = params.user.name.trim();
    const nextStatus: UserApprovalStatus =
      params.user.status === 'APPROVED' ||
      params.user.status === 'PENDING' ||
      params.user.status === 'DENIED'
        ? params.user.status
        : params.user.active
          ? 'APPROVED'
          : 'DENIED';
    const nextActive = nextStatus === 'APPROVED';

    const [facRows] = await batchGetRanges(params.spreadsheetId, params.accessToken, [
      `${a1Tab('Facilitators')}!A2:H`,
    ]);
    const idx = (facRows || []).findIndex(
      (r) =>
        (params.user.userId && String(r[0] || '').trim() === params.user.userId) ||
        normalizeEmail(String(r[2] || '')) === emailClean,
    );
    const nowIso = new Date().toISOString();
    let resultUser: ManagedUser;

    if (idx !== -1) {
      const existingRow = facRows![idx]!;
      const userId = String(existingRow[0] || `FAC_${generateUuid().slice(0, 8).toUpperCase()}`);
      const createdAt = String(existingRow[5] || nowIso);
      resultUser = {
        userId,
        name: nameClean,
        email: emailClean,
        role: 'facilitator',
        active: nextActive,
        status: nextStatus,
        createdAt,
        updatedAt: nowIso,
      };
      const rowNum = idx + 2;
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Facilitators')}!A${rowNum}:H${rowNum}`)}?valueInputOption=RAW`,
        params.accessToken,
        { method: 'PUT', body: JSON.stringify({ values: [serializeFacilitatorRow(resultUser)] }) },
      );
    } else {
      resultUser = {
        userId: `FAC_${generateUuid().slice(0, 8).toUpperCase()}`,
        name: nameClean,
        email: emailClean,
        role: 'facilitator',
        active: nextActive,
        status: nextStatus,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Facilitators')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ values: [serializeFacilitatorRow(resultUser)] }) },
      );
    }

    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        idx !== -1 ? 'UPDATE_USER' : 'CREATE_USER',
        'User',
        resultUser.userId,
        '',
        `${emailClean} (facilitator, status=${nextStatus})`,
        'SUCCESS',
      ],
    });
    return { ok: true, data: resultUser };
  } catch (err) {
    return handleDirectError(err, 'Failed to save facilitator user in Google Sheets.');
  }
}

export async function deleteDirectUser(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  userIdOrEmail: string;
}): Promise<ApiResponse<{ deleted: boolean; email: string }>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const identifier = params.userIdOrEmail.trim();
    const cleanLower = normalizeEmail(identifier);
    const [facRows] = await batchGetRanges(params.spreadsheetId, params.accessToken, [
      `${a1Tab('Facilitators')}!A2:H`,
    ]);
    const idx = (facRows || []).findIndex(
      (r) => String(r[0] || '').trim() === identifier || normalizeEmail(String(r[2] || '')) === cleanLower,
    );
    if (idx === -1) {
      return { ok: false, code: 'NOT_FOUND', error: 'Facilitator user record not found in Google Sheet.' };
    }
    const targetEmail = normalizeEmail(String(facRows![idx]![2] || ''));
    if (isAllowlistedSuperAdmin(targetEmail)) {
      return {
        ok: false,
        code: 'PROTECTED_ACCOUNT',
        error: 'Initial Super Administrator accounts are protected and cannot be deleted.',
      };
    }
    await deleteSheetRowsDescending(params.spreadsheetId, params.accessToken, [
      { sheetTitle: 'Facilitators', rowNum: idx + 2 },
    ]);
    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        new Date().toISOString(),
        actor.userId,
        actor.email,
        'DELETE_USER',
        'User',
        identifier,
        targetEmail,
        'Removed from Facilitators directory',
        'SUCCESS',
      ],
    });
    return { ok: true, data: { deleted: true, email: targetEmail } };
  } catch (err) {
    return handleDirectError(err, 'Failed to delete facilitator in Google Sheets.');
  }
}

export async function saveDirectConfiguration(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  partial: Partial<AppConfiguration>;
  fallbackConfig: AppConfiguration;
}): Promise<ApiResponse<AppConfiguration>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    const [cfgRows] = await batchGetRanges(params.spreadsheetId, params.accessToken, [
      `${a1Tab('Configuration')}!A2:D`,
    ]);
    const parsedCfg = parseConfigFromSheetRows(cfgRows || []);
    const baseCfg =
      Object.keys(parsedCfg.configurationPatch).length > 0
        ? parsedCfg.config
        : params.fallbackConfig;

    const nowIso = new Date().toISOString();
    const keyToRowNum = new Map<string, number>();
    (cfgRows || []).forEach((r, idx) => {
      const k = String(r[0] || '').trim();
      if (k) keyToRowNum.set(k, idx + 2);
    });
    const entries = buildConfigKeyValuesFromPartial(params.partial);
    const batchUpdates: Array<{ range: string; values: unknown[][] }> = [];
    const appendRows: unknown[][] = [];
    for (const [k, valJson] of entries) {
      const rowValues = [k, valJson, nowIso, actor.email];
      const existingRowNum = keyToRowNum.get(k);
      if (existingRowNum) {
        batchUpdates.push({
          range: `${a1Tab('Configuration')}!A${existingRowNum}:D${existingRowNum}`,
          values: [rowValues],
        });
      } else {
        appendRows.push(rowValues);
      }
    }
    if (batchUpdates.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values:batchUpdate`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: batchUpdates }) },
      );
    }
    if (appendRows.length > 0) {
      await googleDirectJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          params.spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        params.accessToken,
        { method: 'POST', body: JSON.stringify({ values: appendRows }) },
      );
    }

    const mergedConfig: AppConfiguration = {
      ...baseCfg,
      ...params.partial,
      ...(params.partial.policy
        ? {
            policy: {
              allowFacilitatorDeleteOwn: params.partial.policy.allowFacilitatorDeleteOwn !== false,
              allowFacilitatorExportOwn: false,
              facilitatorApprovalMode:
                params.partial.policy.facilitatorApprovalMode === 'auto_approve'
                  ? 'auto_approve'
                  : 'manual_allowlist',
            },
          }
        : {}),
    };

    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        nowIso,
        actor.userId,
        actor.email,
        'UPDATE_CONFIG',
        'Configuration',
        'SYSTEM',
        '',
        JSON.stringify({
          schoolYear: mergedConfig.schoolYear,
          partnerName: mergedConfig.partnerName,
          districts: mergedConfig.allowedDistricts,
        }),
        'SUCCESS',
      ],
    });
    return { ok: true, data: mergedConfig };
  } catch (err) {
    return handleDirectError(err, 'Failed to save configuration to Google Sheets.');
  }
}

export async function logDirectExportEvent(params: {
  spreadsheetId: string;
  accessToken: string;
  actorEmail: string;
  scope: string;
  rowCount: number;
  format: string;
}): Promise<ApiResponse<{ logged: boolean }>> {
  try {
    const actor = resolveActorInfo(params.actorEmail);
    await appendLogRows(params.spreadsheetId, params.accessToken, {
      auditRow: [
        `AUD_${generateUuid().slice(0, 8).toUpperCase()}`,
        new Date().toISOString(),
        actor.userId,
        actor.email,
        'EXPORT_XLSX',
        'Export',
        params.scope,
        '',
        `${params.rowCount} rows (${params.format})`,
        'SUCCESS',
      ],
    });
    return { ok: true, data: { logged: true } };
  } catch (err) {
    return handleDirectError(err, 'Failed to write export audit log.');
  }
}
