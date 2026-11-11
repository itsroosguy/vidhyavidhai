import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import type { ExportTemplateSchema, SessionRecord } from '../../types/domain';
import type { Database } from '../../types/supabase';
import { generateExportCsvString, sanitizeCsvCell } from '../exportService';
import { SupabaseApiClient } from '../supabaseApiClient';
import { getSupabaseConfig, isSupabaseConfigured } from '../supabaseClient';

function makeSampleSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const sessionRecordId = overrides.sessionRecordId ?? 'REC_001';
  const sessionId = overrides.sessionId ?? '2627_33180100101_SGL_01C_001';
  return {
    sessionRecordId,
    sessionId,
    clientSubmissionKey: 'key-csv-1',
    facilitatorName: 'Priya S',
    facilitatorEmail: 'priya@example.org',
    facilitatorUserId: 'FAC_001',
    tourId: 'TOUR_AM',
    tourName: 'Automobile',
    videoId: 'VID_AM_TA',
    language: 'Tamil',
    startDate: '2026-11-05',
    endDate: '2026-11-05',
    startTime: '10:00',
    endTime: '11:00',
    durationMinutes: 60,
    durationFormatted: '1 hr',
    reportingMonth: 'November',
    submissionTimestamp: '2026-11-05T11:05:00.000Z',
    submissionDateFormatted: '05-11-2026',
    schoolName: 'GHSS Panruti',
    udiseCode: '01234567890',
    schoolType: 'Government school',
    state: 'Tamil Nadu',
    district: 'Cuddalore',
    pinCode: '006001',
    sessionType: 'single',
    totalClasses: 1,
    totalStudentsPresent: 40,
    totalQuestionAResponses: 40,
    totalQuestionBResponses: 40,
    overallCsat: 4.5,
    overallItp: 4.38,
    teacherScore: 9,
    teacherClassification: 'Promoter',
    teacherNps: 100,
    submissionStatus: 'COMMITTED',
    syncStatus: 'SYNCED',
    createdAt: '2026-11-05T11:05:00.000Z',
    updatedAt: '2026-11-05T11:05:00.000Z',
    createdBy: 'priya@example.org',
    updatedBy: 'priya@example.org',
    archived: false,
    details: [
      {
        detailRecordId: 'DET_001',
        sessionRecordId,
        sessionId,
        grade: '8',
        section: 'A',
        studentsPresent: 40,
        questionAScore5: 25,
        questionAScore4: 10,
        questionAScore3: 5,
        questionAScore2: 0,
        questionAScore1: 0,
        questionATotal: 40,
        questionAWeightedScore: 180,
        csat: 4.5,
        questionBScore5: 20,
        questionBScore4: 15,
        questionBScore3: 5,
        questionBScore2: 0,
        questionBScore1: 0,
        questionBTotal: 40,
        questionBWeightedScore: 175,
        itp: 4.38,
        createdAt: '2026-11-05T11:05:00.000Z',
        updatedAt: '2026-11-05T11:05:00.000Z',
      },
    ],
    ...overrides,
  };
}

function makeDbSubmissionRow(overrides: {
  id: string;
  sessionRecordId: string;
  submissionReference: string;
  userId: string;
  userCode: string;
  facilitatorName: string;
  facilitatorEmail: string;
  district: string;
  schoolName: string;
}) {
  return {
    id: overrides.id,
    archived: false,
    cc: 'Career Tours',
    client_submission_key: `key-${overrides.id}`,
    completion_date: '2026-11-05',
    completion_rate: 100,
    created_at: '2026-11-05T10:00:00.000Z',
    created_by: overrides.facilitatorEmail,
    distribution_channel_host_id: overrides.userCode,
    district: overrides.district,
    duration_formatted: '1 hr',
    duration_minutes: 60,
    end_date: '2026-11-05',
    end_time: '11:00',
    facilitator_email: overrides.facilitatorEmail,
    facilitator_name: overrides.facilitatorName,
    grade_of_students: '8',
    language: 'Tamil',
    organisation_id: 'org-vv-1',
    overall_csat: 4.5,
    overall_itp: 4.25,
    pin_code: '607106',
    product_name: 'Automobile',
    reporting_month: 'November',
    school_id: 'school-1',
    school_name: overrides.schoolName,
    school_type: 'Government school',
    session_record_id: overrides.sessionRecordId,
    session_type: 'single',
    start_date: '2026-11-05',
    start_time: '10:00',
    state: 'Tamil Nadu',
    student_csat: 4.5,
    submission_date_formatted: '05-11-2026',
    submission_reference: overrides.submissionReference,
    submission_status: 'COMMITTED',
    submission_timestamp: '2026-11-05T10:05:00.000Z',
    submitted_at: '2026-11-05T10:05:00.000Z',
    sync_status: 'SYNCED',
    synced_at: '2026-11-05T10:05:05.000Z',
    teacher_classification: 'Promoter',
    teacher_nps: 100,
    teacher_score: 9,
    total_classes: 1,
    total_question_a_responses: 40,
    total_question_b_responses: 40,
    total_students_present: 40,
    tour_id: 'TOUR_AM',
    tour_name: 'Automobile',
    udise_code: '33180100101',
    underserved_reach: 'Yes',
    unique_student_id: '33180100101_8_A',
    updated_at: '2026-11-05T10:05:00.000Z',
    updated_by: overrides.facilitatorEmail,
    user_id: overrides.userId,
    video_id: 'VID_AM_TA',
    zipcode_postal_code: '607106',
    profiles: { user_code: overrides.userCode },
    form_submission_classes: [
      {
        id: `cls-${overrides.id}`,
        created_at: '2026-11-05T10:05:00.000Z',
        csat: 4.5,
        detail_record_id: `DET_${overrides.id}`,
        grade: '8',
        itp: 4.25,
        question_a_score_1: 0,
        question_a_score_2: 0,
        question_a_score_3: 5,
        question_a_score_4: 10,
        question_a_score_5: 25,
        question_a_total: 40,
        question_a_weighted_score: 180,
        question_b_score_1: 0,
        question_b_score_2: 0,
        question_b_score_3: 10,
        question_b_score_4: 10,
        question_b_score_5: 20,
        question_b_total: 40,
        question_b_weighted_score: 170,
        row_order: 1,
        section: 'A',
        session_id: overrides.submissionReference,
        session_record_id: overrides.sessionRecordId,
        students_present: 40,
        submission_id: overrides.id,
        updated_at: '2026-11-05T10:05:00.000Z',
      },
    ],
  };
}

interface MockSupabaseOptions {
  authUserId: string;
  sessionAccessToken?: string | null;
  profile: {
    userId: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    status: string;
    organisationId?: string;
    organisationName?: string;
  };
  submissions?: ReturnType<typeof makeDbSubmissionRow>[];
  rpcOverrides?: Record<string, (args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>;
}

function createMockSupabaseClient(opts: MockSupabaseOptions) {
  const eqCalls: Array<{ table: string; col: string; val: unknown }> = [];
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const functionCalls: Array<{ fn: string; options?: Record<string, unknown> }> = [];
  const cfg = createTestConfig();

  const makeQueryChain = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      order: () => chain,
      range: () => chain,
      eq: (col: string, val: unknown) => {
        eqCalls.push({ table, col, val });
        filters[col] = val;
        return chain;
      },
      maybeSingle: async () => {
        if (table === 'form_submissions') {
          const rows = (opts.submissions ?? []).filter((r) =>
            Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
          );
          return { data: rows[0] ?? null, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (value: { data: unknown; error: null }) => void) => {
        if (table === 'form_submissions') {
          const rows = (opts.submissions ?? []).filter((r) =>
            Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
          );
          resolve({ data: rows, error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
    };
    return chain;
  };

  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session:
            opts.sessionAccessToken === null
              ? null
              : {
                  access_token: opts.sessionAccessToken ?? 'mock-jwt',
                  user: { id: opts.authUserId, email: opts.profile.email },
                },
        },
        error: null,
      }),
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (opts.rpcOverrides?.[fn]) {
        return opts.rpcOverrides[fn]!(args);
      }
      if (fn === 'get_my_profile') {
        return { data: opts.profile, error: null };
      }
      if (fn === 'get_sanitized_app_settings') {
        return { data: cfg, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => makeQueryChain(table),
    functions: {
      invoke: async (fn: string, options?: Record<string, unknown>) => {
        functionCalls.push({ fn, options });
        if (fn === 'facilitator-auth-admin') {
          const body = (options?.body ?? {}) as Record<string, unknown>;
          if (body.action === 'delete_user') {
            return {
              data: {
                ok: true,
                data: {
                  deleted: true,
                  email: String(body.email ?? ''),
                },
              },
              error: null,
            };
          }
        }
        return { data: { ok: true }, error: null };
      },
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    eqCalls,
    rpcCalls,
    functionCalls,
  };
}

describe('SupabaseApiClient Edge Function Auth & Delete Routing', () => {
  it('injects explicit Bearer access_token on Edge Function invocations and blocks unauthenticated calls', async () => {
    const authed = createMockSupabaseClient({
      authUserId: 'uid-admin',
      sessionAccessToken: 'live-admin-jwt-123',
      profile: {
        userId: 'SA_BRINTHA',
        name: 'Brintha',
        email: 'brinthajayaprakash888@gmail.com',
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
      },
    });
    const authedApi = new SupabaseApiClient(authed.client);
    const provisionRes = await authedApi.provisionFacilitatorAccount({
      name: 'Pilot Facilitator',
      email: 'pilot@example.org',
      password: 'Password123',
    });
    expect(provisionRes.ok).toBe(true);
    expect(authed.functionCalls).toHaveLength(1);
    expect(authed.functionCalls[0]?.fn).toBe('facilitator-auth-admin');
    expect(authed.functionCalls[0]?.options?.headers).toEqual({
      Authorization: 'Bearer live-admin-jwt-123',
    });

    const unauth = createMockSupabaseClient({
      authUserId: 'uid-admin',
      sessionAccessToken: null,
      profile: {
        userId: 'SA_BRINTHA',
        name: 'Brintha',
        email: 'brinthajayaprakash888@gmail.com',
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
      },
    });
    const unauthApi = new SupabaseApiClient(unauth.client);
    const blockedRes = await unauthApi.provisionFacilitatorAccount({
      name: 'Pilot Facilitator',
      email: 'pilot@example.org',
      password: 'Password123',
    });
    expect(blockedRes.ok).toBe(false);
    expect(blockedRes.code).toBe('UNAUTHENTICATED');
    expect(unauth.functionCalls).toHaveLength(0);
  });

  it('routes non-preapproval user deletions through facilitator-auth-admin delete_user with Bearer JWT', async () => {
    const targetUser = {
      userId: 'USR_PILOT01',
      name: 'Pilot User',
      email: 'pilot@example.org',
      role: 'facilitator',
      active: false,
      status: 'PENDING',
    };
    const mock = createMockSupabaseClient({
      authUserId: 'uid-admin',
      sessionAccessToken: 'admin-jwt-del',
      profile: {
        userId: 'SA_KARUNYA',
        name: 'Karunya',
        email: 'karunya@vidhyavidhai.org',
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
      },
      rpcOverrides: {
        list_managed_directory: async () => ({
          data: [targetUser],
          error: null,
        }),
      },
    });
    const api = new SupabaseApiClient(mock.client);
    const res = await api.deleteUser('USR_PILOT01');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ deleted: true, email: 'pilot@example.org' });
    expect(mock.functionCalls).toHaveLength(1);
    expect(mock.functionCalls[0]?.fn).toBe('facilitator-auth-admin');
    expect(mock.functionCalls[0]?.options?.headers).toEqual({
      Authorization: 'Bearer admin-jwt-del',
    });
    expect(mock.functionCalls[0]?.options?.body).toEqual({
      action: 'delete_user',
      userId: 'USR_PILOT01',
      email: 'pilot@example.org',
    });
  });
});

describe('RFC-4180 CSV Export & Formula Sanitization', () => {
  it('neutralizes formula injection while preserving finite negative numbers and RFC-4180 quoting', () => {
    expect(sanitizeCsvCell(undefined)).toBe('');
    expect(sanitizeCsvCell(null)).toBe('');
    expect(sanitizeCsvCell(-100)).toBe('-100');
    expect(sanitizeCsvCell('-100')).toBe('-100');
    expect(sanitizeCsvCell('-3.25')).toBe('-3.25');

    expect(sanitizeCsvCell('=CMD|"/C calc"!A0')).toBe('"\'=CMD|""/C calc""!A0"');
    expect(sanitizeCsvCell('=EVIL,FORMULA')).toBe('"\'=EVIL,FORMULA"');
    expect(sanitizeCsvCell('+1+1')).toBe("'+1+1");
    expect(sanitizeCsvCell('-SUM(A1:A2)')).toBe("'-SUM(A1:A2)");
    expect(sanitizeCsvCell('@SUM(1,2)')).toBe('"\'@SUM(1,2)"');
    expect(sanitizeCsvCell('\t=1')).toBe("'\t=1");
    expect(sanitizeCsvCell('\r=1')).toBe('"\'\r=1"');
    expect(sanitizeCsvCell('GHSS "North", Panruti')).toBe('"GHSS ""North"", Panruti"');
  });

  it('generates UTF-8 BOM + CRLF CSV preserving leading-zero UDISE and PIN in standard and 63-column modes', () => {
    const cfg = createTestConfig();
    const session = makeSampleSessionRecord({
      teacherNps: -100,
      schoolName: 'GHSS =EvilFormula, Cuddalore',
    });

    const std = generateExportCsvString([session], cfg, 'standard');
    expect(std.usedOfficial63Schema).toBe(false);
    expect(std.rowCount).toBe(1);
    expect(std.csv.startsWith('\uFEFF')).toBe(true);
    expect(std.csv).toContain('\r\n');
    expect(std.csv).toContain('01234567890');
    expect(std.csv).toContain('006001');
    expect(std.csv).toContain(',-100,');
    expect(std.csv).toContain('"GHSS =EvilFormula, Cuddalore"');

    const cols63: ExportTemplateSchema['columns'] = Array.from({ length: 63 }, (_, idx) => {
      if (idx === 0) {
        return { index: 1, header: 'Session_ID', sourceKey: 'session_id', format: 'text' };
      }
      if (idx === 1) {
        return { index: 2, header: 'UDISE', sourceKey: 'udise_code', format: 'text' };
      }
      if (idx === 2) {
        return { index: 3, header: 'PIN_Code', sourceKey: 'pin_code', format: 'text' };
      }
      if (idx === 3) {
        return {
          index: 4,
          header: 'Partner',
          sourceKey: '',
          format: 'constant',
          constantValue: 'Vidhya Vidhai',
        };
      }
      return {
        index: idx + 1,
        header: `Extra_${idx + 1}`,
        sourceKey: idx === 4 ? 'teacher_nps' : '',
        format: idx === 4 ? 'number' : 'text',
      };
    });

    const cfg63 = createTestConfig({
      exportTemplate63: {
        templateName: 'official_63.xlsx',
        verified: true,
        uploadedAt: '2026-11-01T00:00:00.000Z',
        uploadedBy: 'brinthajayaprakash888@gmail.com',
        columns: cols63,
      },
    });

    const exp63 = generateExportCsvString([session], cfg63, 'official_63');
    expect(exp63.usedOfficial63Schema).toBe(true);
    expect(exp63.columnCount).toBe(63);
    const lines = exp63.csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    const cells = lines[1]!.split(',');
    expect(cells[0]).toBe('2627_33180100101_SGL_01C_001');
    expect(cells[1]).toBe('01234567890');
    expect(cells[2]).toBe('006001');
    expect(cells[3]).toBe('Vidhya Vidhai');
    expect(cells[4]).toBe('-100');
  });
});

describe('Supabase configuration & SupabaseApiClient RBAC / Error Mapping', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects unconfigured vs configured Supabase environment variables', () => {
    expect(isSupabaseConfigured()).toBe(false);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://exampleproj.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_1234567890abcdef');
    const cfg = getSupabaseConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.url).toBe('https://exampleproj.supabase.co');
  });

  it('gives Super Admin global visibility across all facilitators and districts without user filter', async () => {
    const row1 = makeDbSubmissionRow({
      id: 'sub-1',
      sessionRecordId: 'REC_1',
      submissionReference: '2627_33180100101_SGL_01C_001',
      userId: 'user-fac-1',
      userCode: 'FAC_001',
      facilitatorName: 'Priya S',
      facilitatorEmail: 'priya@example.org',
      district: 'Cuddalore',
      schoolName: 'GHSS Panruti',
    });
    const row2 = makeDbSubmissionRow({
      id: 'sub-2',
      sessionRecordId: 'REC_2',
      submissionReference: '2627_33180100102_SGL_01C_001',
      userId: 'user-fac-2',
      userCode: 'FAC_002',
      facilitatorName: 'Arun K',
      facilitatorEmail: 'arun@example.org',
      district: 'Nagapattinam',
      schoolName: 'GHSS Nagapattinam',
    });

    const { client, eqCalls } = createMockSupabaseClient({
      authUserId: 'sa-uuid-1',
      profile: {
        userId: 'SA_BRINTHA',
        name: 'Brintha Jayaprakash',
        email: 'brinthajayaprakash888@gmail.com',
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
      },
      submissions: [row1, row2],
    });

    const api = new SupabaseApiClient(client);
    const adminList = await api.getAdminSessions({});
    expect(adminList.ok).toBe(true);
    expect(adminList.data!.total).toBe(2);
    expect(adminList.data!.items.map((s) => s.facilitatorEmail)).toEqual(
      expect.arrayContaining(['priya@example.org', 'arun@example.org']),
    );
    expect(eqCalls.some((c) => c.table === 'form_submissions' && c.col === 'user_id')).toBe(false);
  });

  it('isolates facilitator queries to own user_id, blocks admin RPCs, and ignores non-allowlisted admin claims', async () => {
    const ownRow = makeDbSubmissionRow({
      id: 'sub-1',
      sessionRecordId: 'REC_1',
      submissionReference: '2627_33180100101_SGL_01C_001',
      userId: 'user-fac-1',
      userCode: 'FAC_001',
      facilitatorName: 'Priya S',
      facilitatorEmail: 'priya@example.org',
      district: 'Cuddalore',
      schoolName: 'GHSS Panruti',
    });
    const otherRow = makeDbSubmissionRow({
      id: 'sub-2',
      sessionRecordId: 'REC_2',
      submissionReference: '2627_33180100102_SGL_01C_001',
      userId: 'user-fac-2',
      userCode: 'FAC_002',
      facilitatorName: 'Arun K',
      facilitatorEmail: 'arun@example.org',
      district: 'Sivaganga',
      schoolName: 'GHSS Sivaganga',
    });

    // Simulate tampered non-allowlisted role: SupabaseApiClient clamps non-allowlisted emails to 'facilitator'
    const { client, eqCalls, rpcCalls } = createMockSupabaseClient({
      authUserId: 'user-fac-1',
      profile: {
        userId: 'FAC_001',
        name: 'Priya S',
        email: 'priya@example.org',
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
      },
      submissions: [ownRow, otherRow],
    });

    const api = new SupabaseApiClient(client);
    const me = await api.getCurrentUser();
    expect(me.ok).toBe(true);
    expect(me.data!.role).toBe('facilitator');

    const myRes = await api.getMySessions({});
    expect(myRes.ok).toBe(true);
    expect(myRes.data!.total).toBe(1);
    expect(myRes.data!.items[0]!.facilitatorEmail).toBe('priya@example.org');
    expect(
      eqCalls.some(
        (c) => c.table === 'form_submissions' && c.col === 'user_id' && c.val === 'user-fac-1',
      ),
    ).toBe(true);

    const otherDetail = await api.getSessionById('REC_2');
    expect(otherDetail.ok).toBe(false);
    expect(otherDetail.code).toBe('UNAUTHORIZED');

    const rpcCountBefore = rpcCalls.length;
    const [adminSessionsRes, manageRes, saveCfgRes] = await Promise.all([
      api.getAdminSessions({}),
      api.manageUser({
        name: 'Hack',
        email: 'hack@example.org',
        role: 'super_admin',
        active: true,
      }),
      api.saveAppConfiguration({ partnerName: 'Tampered' }),
    ]);

    expect(adminSessionsRes.ok).toBe(false);
    expect(adminSessionsRes.code).toBe('UNAUTHORIZED');
    expect(manageRes.ok).toBe(false);
    expect(manageRes.code).toBe('UNAUTHORIZED');
    expect(saveCfgRes.ok).toBe(false);
    expect(saveCfgRes.code).toBe('UNAUTHORIZED');
    expect(rpcCalls.length).toBe(rpcCountBefore);
  });

  it('rejects PENDING/DENIED profiles, maps 42501 to UNAUTHORIZED, and notifies on expired JWT', async () => {
    const onExpired = vi.fn();
    const { client: pendingClient } = createMockSupabaseClient({
      authUserId: 'user-pending',
      profile: {
        userId: 'FAC_P',
        name: 'Pending User',
        email: 'pending@example.org',
        role: 'facilitator',
        active: false,
        status: 'PENDING',
      },
      rpcOverrides: {
        submit_form_session: async () => ({
          data: null,
          error: { code: '42501', message: 'Insufficient privilege for PENDING account' },
        }),
      },
    });

    const pendingApi = new SupabaseApiClient(pendingClient, onExpired);
    const cfgRes = await pendingApi.getAppConfiguration();
    expect(cfgRes.ok).toBe(false);
    expect(cfgRes.code).toBe('UNAUTHORIZED');

    const submitRes = await pendingApi.createSession(createValidFormValues());
    expect(submitRes.ok).toBe(false);
    expect(submitRes.code).toBe('UNAUTHORIZED');

    const { client: expiredClient } = createMockSupabaseClient({
      authUserId: 'sa-uuid-1',
      profile: {
        userId: 'SA_BRINTHA',
        name: 'Brintha Jayaprakash',
        email: 'brinthajayaprakash888@gmail.com',
        role: 'super_admin',
        active: true,
        status: 'APPROVED',
      },
      rpcOverrides: {
        admin_save_app_settings: async () => ({
          data: null,
          error: { code: '42501', message: 'JWT expired' },
        }),
      },
    });

    const expiredApi = new SupabaseApiClient(expiredClient, onExpired);
    const saveRes = await expiredApi.saveAppConfiguration({ schoolYear: '2026-27' });
    expect(saveRes.ok).toBe(false);
    expect(saveRes.code).toBe('UNAUTHORIZED');
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
