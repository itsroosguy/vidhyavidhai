import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import { LocalSandboxApiClient } from '../apiClient';
import { SANDBOX_USERS } from '../authService';
import {
  DIRECT_ALL_INITIALIZED_TABS,
  DIRECT_SHEETS_SCHEMA_DEFINITIONS,
  buildRelativeSpreadsheetTitle,
  clearDirectGoogleSheetsToken,
  connectDirectGoogleSheet,
  createDirectGoogleSheetWithSchema,
  createDirectSession,
  getDirectGoogleSheetsTokenInfo,
  hasDirectSheetsAccessToken,
  loadDirectWorkspace,
  requestDirectGoogleSheetsToken,
  syncWorkspaceToDirectGoogleSheet,
  updateDirectSession,
} from '../googleSheetsDirectService';

function createStatefulMockGoogleFetch() {
  const sheetsBySpreadsheet = new Map<string, Map<string, unknown[][]>>();
  const titlesBySpreadsheet = new Map<string, string>();
  let nextCreatedId = 1;

  const colLettersToIndex = (letters: string) => {
    let idx = 0;
    for (const ch of letters.toUpperCase()) {
      idx = idx * 26 + (ch.charCodeAt(0) - 64);
    }
    return idx - 1;
  };

  const parseA1 = (rangeStr: string) => {
    const clean = decodeURIComponent(String(rangeStr || ''));
    const bang = clean.indexOf('!');
    const rawTab = bang === -1 ? clean : clean.slice(0, bang);
    const tabName = rawTab.replace(/^'|'$/g, '');
    const part = bang === -1 ? 'A1:ZZ' : clean.slice(bang + 1);
    const rowOnly = /^(\d+):(\d+)$/.exec(part);
    if (rowOnly) {
      return {
        tabName,
        startCol: 0,
        endCol: 200,
        startRow: Number(rowOnly[1]) - 1,
        endRow: Number(rowOnly[2]) - 1,
      };
    }
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)?(\d+)?)?$/i.exec(part);
    if (!m) {
      return { tabName, startCol: 0, endCol: 200, startRow: 0, endRow: Infinity };
    }
    const startCol = colLettersToIndex(m[1]!);
    const startRow = Number(m[2]) - 1;
    const hasColon = part.includes(':');
    const endCol = hasColon ? (m[3] ? colLettersToIndex(m[3]) : startCol) : startCol;
    const endRow = hasColon ? (m[4] ? Number(m[4]) - 1 : Infinity) : startRow;
    return { tabName, startCol, endCol, startRow, endRow };
  };

  const getTabRows = (spreadsheetId: string, tabName: string) => {
    let tabs = sheetsBySpreadsheet.get(spreadsheetId);
    if (!tabs) {
      tabs = new Map();
      sheetsBySpreadsheet.set(spreadsheetId, tabs);
    }
    let rows = tabs.get(tabName);
    if (!rows) {
      rows = [];
      tabs.set(tabName, rows);
    }
    return rows;
  };

  const readRange = (spreadsheetId: string, rangeStr: string) => {
    const { tabName, startCol, endCol, startRow, endRow } = parseA1(rangeStr);
    const rows = getTabRows(spreadsheetId, tabName);
    const maxR = Math.min(rows.length - 1, endRow);
    const out: unknown[][] = [];
    for (let r = startRow; r <= maxR; r++) {
      const row = rows[r] || [];
      if (endCol >= 200) {
        out.push([...row.slice(startCol)]);
      } else {
        out.push(row.slice(startCol, endCol + 1));
      }
    }
    return out;
  };

  const writeRange = (spreadsheetId: string, rangeStr: string, values: unknown[][]) => {
    const { tabName, startCol, startRow } = parseA1(rangeStr);
    const rows = getTabRows(spreadsheetId, tabName);
    (values || []).forEach((vals, rOff) => {
      const rIdx = startRow + rOff;
      while (rows.length <= rIdx) rows.push([]);
      const targetRow = rows[rIdx]!;
      (vals || []).forEach((cellVal, cOff) => {
        const cIdx = startCol + cOff;
        while (targetRow.length < cIdx) targetRow.push('');
        targetRow[cIdx] = cellVal;
      });
    });
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const method = (init?.method || 'GET').toUpperCase();

    if (urlStr === 'https://www.googleapis.com/oauth2/v3/userinfo') {
      const auth = String((init?.headers as Record<string, string>)?.Authorization || '');
      if (auth.includes('tok-fac')) {
        return new Response(
          JSON.stringify({ email: 'priya.facilitator@example.org', name: 'Priya S' }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ email: 'brinthajayaprakash888@gmail.com', name: 'Brintha J' }),
        { status: 200 },
      );
    }

    if (urlStr === 'https://sheets.googleapis.com/v4/spreadsheets' && method === 'POST') {
      const payload = JSON.parse(bodyText) as {
        properties?: { title?: string };
        sheets?: Array<{ properties?: { title?: string } }>;
      };
      const spreadsheetId = `direct_sheet_${nextCreatedId++}`;
      const title = payload.properties?.title || 'Untitled';
      titlesBySpreadsheet.set(spreadsheetId, title);
      const tabMap = new Map<string, unknown[][]>();
      for (const s of payload.sheets || []) {
        if (s.properties?.title) {
          tabMap.set(s.properties.title, []);
        }
      }
      sheetsBySpreadsheet.set(spreadsheetId, tabMap);
      return new Response(
        JSON.stringify({
          spreadsheetId,
          properties: { title },
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        }),
        { status: 200 },
      );
    }

    if (urlStr.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
      const u = new URL(urlStr);
      const rawSeg = u.pathname.split('/')[3] || '';
      const spreadsheetId = decodeURIComponent(rawSeg.split(':')[0] || '');
      const tabMap = sheetsBySpreadsheet.get(spreadsheetId) || new Map<string, unknown[][]>();
      sheetsBySpreadsheet.set(spreadsheetId, tabMap);

      if (u.pathname.endsWith('/values:batchUpdate')) {
        const bodyObj = JSON.parse(bodyText) as {
          data?: Array<{ range: string; values: unknown[][] }>;
        };
        for (const entry of bodyObj.data || []) {
          writeRange(spreadsheetId, entry.range, entry.values);
        }
        return new Response(JSON.stringify({ totalUpdatedCells: 50 }), { status: 200 });
      }

      if (u.pathname.endsWith(':batchUpdate')) {
        const bodyObj = JSON.parse(bodyText) as {
          requests?: Array<{
            addSheet?: { properties?: { title?: string } };
            deleteDimension?: {
              range?: { sheetId?: number; dimension?: string; startIndex?: number; endIndex?: number };
            };
          }>;
        };
        const titles = [...tabMap.keys()];
        for (const r of bodyObj.requests || []) {
          if (r.addSheet?.properties?.title && !tabMap.has(r.addSheet.properties.title)) {
            tabMap.set(r.addSheet.properties.title, []);
          }
          if (r.deleteDimension?.range?.sheetId !== undefined) {
            const targetTitle = titles[r.deleteDimension.range.sheetId];
            if (targetTitle) {
              const rows = tabMap.get(targetTitle) || [];
              const start = r.deleteDimension.range.startIndex || 0;
              const end = r.deleteDimension.range.endIndex || start;
              if (r.deleteDimension.range.dimension === 'COLUMNS') {
                for (const row of rows) {
                  row.splice(start, end - start);
                }
              } else {
                rows.splice(start, end - start);
              }
            }
          }
        }
        return new Response(JSON.stringify({ spreadsheetId }), { status: 200 });
      }

      if (u.pathname.endsWith('/values:batchGet')) {
        const ranges = u.searchParams.getAll('ranges');
        return new Response(
          JSON.stringify({
            valueRanges: ranges.map((r) => ({ values: readRange(spreadsheetId, r) })),
          }),
          { status: 200 },
        );
      }

      if (u.pathname.includes(':append')) {
        const decoded = decodeURIComponent(u.pathname);
        const rawRange = decoded.split('/values/')[1]?.replace(/:append$/, '') || '';
        const { tabName } = parseA1(rawRange);
        const bodyObj = JSON.parse(bodyText) as { values?: unknown[][] };
        const rows = getTabRows(spreadsheetId, tabName);
        const startRow1 = rows.length + 1;
        const incoming = bodyObj.values || [];
        for (const row of incoming) {
          rows.push([...row]);
        }
        return new Response(
          JSON.stringify({
            updates: {
              updatedRange: `'${tabName}'!A${startRow1}:AP${rows.length}`,
              updatedRows: incoming.length,
            },
          }),
          { status: 200 },
        );
      }

      if (u.pathname.includes('/values/')) {
        const decoded = decodeURIComponent(u.pathname);
        const rawRange = decoded.split('/values/')[1] || '';
        if (method === 'PUT') {
          const bodyObj = JSON.parse(bodyText) as { values?: unknown[][] };
          writeRange(spreadsheetId, rawRange, bodyObj.values || []);
          return new Response(JSON.stringify({ updatedRange: rawRange }), { status: 200 });
        }
        return new Response(JSON.stringify({ values: readRange(spreadsheetId, rawRange) }), {
          status: 200,
        });
      }

      // Spreadsheet metadata GET
      const sheetsMeta = [...tabMap.keys()].map((t, idx) => ({
        properties: { sheetId: idx, title: t, gridProperties: { columnCount: 45 } },
      }));
      return new Response(
        JSON.stringify({
          spreadsheetId,
          properties: { title: titlesBySpreadsheet.get(spreadsheetId) || 'Career Tours Sheet' },
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          sheets: sheetsMeta,
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ error: `Unexpected URL: ${urlStr}` }), { status: 404 });
  });

  return { fetchMock, sheetsBySpreadsheet, titlesBySpreadsheet };
}

describe('googleSheetsDirectService — relative title, memory-only OAuth & 10-tab live push', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearDirectGoogleSheetsToken();
  });

  afterEach(() => {
    clearDirectGoogleSheetsToken();
    vi.restoreAllMocks();
    delete (window as unknown as { google?: unknown }).google;
  });

  it('builds deterministic relative titles from partner, programme, session districts, and IST month', () => {
    expect(
      buildRelativeSpreadsheetTitle({
        programmeName: 'Career Tours',
        nowDate: '2026-11-11T04:00:00.000Z',
      }),
    ).toBe('Vidhya Vidhai · Career Tours · Nov 2026');

    expect(
      buildRelativeSpreadsheetTitle({
        programmeName: 'Career Tours',
        partnerName: 'Tamil Nadu Schools',
        district: 'Cuddalore',
        nowDate: '2026-11-30T20:00:00.000Z', // Dec 1 01:30 AM IST in Asia/Kolkata!
      }),
    ).toBe('Tamil Nadu Schools · Career Tours · Cuddalore · Dec 2026');

    expect(
      buildRelativeSpreadsheetTitle({
        programmeName: 'Career Tours',
        sessions: [
          { district: 'Sivaganga', startDate: '2026-11-11' },
          { district: 'Cuddalore', startDate: '2026-11-11' },
        ],
        nowDate: '2026-11-11T04:00:00.000Z',
      }),
    ).toBe('Vidhya Vidhai · Career Tours · Cuddalore & Sivaganga · Nov 2026');

    expect(
      buildRelativeSpreadsheetTitle({
        programmeName: 'Career Tours',
        sessions: [
          { district: 'Cuddalore', startDate: '2026-11-11' },
          { district: 'Nagapattinam', startDate: '2026-11-11' },
          { district: 'Sivaganga', startDate: '2026-11-11' },
        ],
        nowDate: '2026-11-11T04:00:00.000Z',
      }),
    ).toBe('Vidhya Vidhai · Career Tours · 3 Districts · Nov 2026');

    const longTitle = buildRelativeSpreadsheetTitle({
      partnerName: 'A'.repeat(120),
      programmeName: 'Career Tours',
      district: 'Cuddalore',
      nowDate: '2026-11-11T04:00:00.000Z',
    });
    expect(longTitle.length).toBeLessThanOrEqual(100);
  });

  it('stores OAuth access tokens strictly in module memory, rejects non-admin emails, and clears on demand', async () => {
    const { fetchMock } = createStatefulMockGoogleFetch();
    vi.stubGlobal('fetch', fetchMock);

    let nextTok = 'tok-fac-unauthorized';
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: { callback: (resp: { access_token: string; expires_in: number }) => void }) => ({
            requestAccessToken: () => cfg.callback({ access_token: nextTok, expires_in: 3600 }),
          }),
        },
      },
    };

    const rejected = await requestDirectGoogleSheetsToken(
      '1234567890-direct.apps.googleusercontent.com',
      'priya.facilitator@example.org',
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('FORBIDDEN');
    expect(hasDirectSheetsAccessToken()).toBe(false);

    nextTok = 'tok-sa-memory-only-secret';
    const approved = await requestDirectGoogleSheetsToken(
      '1234567890-direct.apps.googleusercontent.com',
      'brinthajayaprakash888@gmail.com',
    );
    expect(approved.ok).toBe(true);
    expect(hasDirectSheetsAccessToken('brinthajayaprakash888@gmail.com')).toBe(true);
    expect(getDirectGoogleSheetsTokenInfo('brinthajayaprakash888@gmail.com')?.accessToken).toBe(
      'tok-sa-memory-only-secret',
    );

    // Strictly verify zero access tokens leaked to localStorage or sessionStorage
    const allStorageText = JSON.stringify({
      ls: { ...localStorage },
      ss: { ...sessionStorage },
    });
    expect(allStorageText).not.toContain('tok-sa-memory-only-secret');

    clearDirectGoogleSheetsToken();
    expect(hasDirectSheetsAccessToken('brinthajayaprakash888@gmail.com')).toBe(false);
  });

  it('creates a 10-tab sheet with relative title, pushes workspace idempotently, and supports live session CRUD', async () => {
    const { fetchMock, sheetsBySpreadsheet, titlesBySpreadsheet } = createStatefulMockGoogleFetch();
    vi.stubGlobal('fetch', fetchMock);

    const cfg = createTestConfig({ partnerName: '' });
    let actorId = SANDBOX_USERS.facilitator.userId;
    const localApi = new LocalSandboxApiClient(() => actorId, cfg);
    const localCreated = await localApi.createSession(createValidFormValues());
    expect(localCreated.ok).toBe(true);
    const localSession = localCreated.data!.session;

    actorId = SANDBOX_USERS.super_admin_1.userId;
    const adminSess = await localApi.getAdminSessions({});
    const schoolsRes = await localApi.searchSchools('', true);
    const usersRes = await localApi.listManagedUsers();

    const relativeTitle = buildRelativeSpreadsheetTitle({
      programmeName: 'Career Tours',
      partnerName: cfg.partnerName,
      sessions: adminSess.data!.items,
      nowDate: '2026-11-11T04:00:00.000Z',
    });
    expect(relativeTitle).toBe('Vidhya Vidhai · Career Tours · Cuddalore · Nov 2026');

    const createdSheet = await createDirectGoogleSheetWithSchema({
      accessToken: 'tok-sa-direct',
      title: relativeTitle,
      actorEmail: SANDBOX_USERS.super_admin_1.email,
    });
    expect(createdSheet.ok).toBe(true);
    const sheetId = createdSheet.data!.spreadsheetId;
    expect(titlesBySpreadsheet.get(sheetId)).toBe(relativeTitle);

    const tabs = sheetsBySpreadsheet.get(sheetId)!;
    expect(DIRECT_ALL_INITIALIZED_TABS).toHaveLength(10);
    for (const tabName of DIRECT_ALL_INITIALIZED_TABS) {
      expect(tabs.has(tabName)).toBe(true);
    }

    // First workspace push writes sessions, details, schools, non-admin facilitators, config
    const push1 = await syncWorkspaceToDirectGoogleSheet({
      spreadsheetId: sheetId,
      accessToken: 'tok-sa-direct',
      actorEmail: SANDBOX_USERS.super_admin_1.email,
      sessions: adminSess.data!.items,
      schools: schoolsRes.data!,
      users: usersRes.data!,
      config: cfg,
    });
    expect(push1.ok).toBe(true);
    expect(push1.data!.syncedCount).toBe(1);
    expect(push1.data!.syncedSchoolsCount).toBe(1);
    expect(tabs.get('Sessions')).toHaveLength(2);
    expect(tabs.get('Session Details')).toHaveLength(2);
    expect(tabs.get('Schools')).toHaveLength(2);
    const facilitatorEmails = (tabs.get('Facilitators') || []).slice(1).map((r) => r[2]);
    expect(facilitatorEmails).not.toContain(SANDBOX_USERS.super_admin_1.email);
    expect(facilitatorEmails).toContain(SANDBOX_USERS.facilitator.email);

    // Repeat push is strictly idempotent: 0 duplicate rows written
    const push2 = await syncWorkspaceToDirectGoogleSheet({
      spreadsheetId: sheetId,
      accessToken: 'tok-sa-direct',
      actorEmail: SANDBOX_USERS.super_admin_1.email,
      sessions: adminSess.data!.items,
      schools: schoolsRes.data!,
      users: usersRes.data!,
      config: cfg,
    });
    expect(push2.ok).toBe(true);
    expect(push2.data!.syncedCount).toBe(0);
    expect(push2.data!.skippedDuplicates).toBe(1);
    expect(tabs.get('Sessions')).toHaveLength(2);

    // Load back workspace & verify fidelity
    const hydrated = await loadDirectWorkspace(sheetId, 'tok-sa-direct');
    expect(hydrated.ok).toBe(true);
    expect(hydrated.data!.sessions).toHaveLength(1);
    expect(hydrated.data!.sessions[0]!.sessionId).toBe(localSession.sessionId);
    expect(hydrated.data!.schools).toHaveLength(1);

    // Live session creation directly into sheet + duplicate replay protection + update
    const liveValues = createValidFormValues({
      clientSubmissionKey: 'direct-live-key-1',
      schoolName: 'GHSS Kurinjipadi Direct',
      udiseCode: '33180200456',
      district: 'Cuddalore',
    });
    const liveCreate = await createDirectSession({
      spreadsheetId: sheetId,
      accessToken: 'tok-sa-direct',
      actorEmail: SANDBOX_USERS.super_admin_1.email,
      values: liveValues,
      fallbackConfig: cfg,
    });
    expect(liveCreate.ok).toBe(true);
    expect(liveCreate.data!.session.submissionStatus).toBe('COMMITTED');
    expect(tabs.get('Sessions')).toHaveLength(3);

    const dupReplay = await createDirectSession({
      spreadsheetId: sheetId,
      accessToken: 'tok-sa-direct',
      actorEmail: SANDBOX_USERS.super_admin_1.email,
      values: liveValues,
      fallbackConfig: cfg,
    });
    expect(dupReplay.ok).toBe(true);
    expect(dupReplay.data!.session.sessionId).toBe(liveCreate.data!.session.sessionId);
    expect(tabs.get('Sessions')).toHaveLength(3);

    const liveUpdate = await updateDirectSession({
      spreadsheetId: sheetId,
      accessToken: 'tok-sa-direct',
      actorEmail: SANDBOX_USERS.super_admin_1.email,
      sessionRecordId: liveCreate.data!.session.sessionRecordId,
      values: { ...liveValues, schoolName: 'GHSS Kurinjipadi Edited' },
      fallbackConfig: cfg,
    });
    expect(liveUpdate.ok).toBe(true);
    expect(liveUpdate.data!.session.submissionStatus).toBe('CORRECTED');
    expect(tabs.get('Sessions')![2]![19]).toBe('GHSS Kurinjipadi Edited');
    expect(tabs.get('Sessions')![0]).toHaveLength(41);
    expect(tabs.get('Sessions')![0]).not.toContain('block');
    expect(tabs.get('Schools')![0]).toHaveLength(10);
    expect(tabs.get('Schools')![0]).not.toContain('block');
  });

  it('non-destructively migrates legacy 42-col Sessions, 11-col Schools, and Configuration district_blocks rows while preserving existing data', async () => {
    const { fetchMock, sheetsBySpreadsheet, titlesBySpreadsheet } = createStatefulMockGoogleFetch();
    vi.stubGlobal('fetch', fetchMock);

    const legacySheetId = '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE';
    titlesBySpreadsheet.set(legacySheetId, 'Vidhya Vidhai · Legacy Sheet');

    const sessHeaders41 = [...DIRECT_SHEETS_SCHEMA_DEFINITIONS[0]!.headers];
    const sessHeaders42 = [...sessHeaders41.slice(0, 24), 'block', ...sessHeaders41.slice(24)];
    const schoolHeaders10 = [...DIRECT_SHEETS_SCHEMA_DEFINITIONS[3]!.headers];
    const schoolHeaders11 = [...schoolHeaders10.slice(0, 6), 'block', ...schoolHeaders10.slice(6)];
    const cfgHeaders = [...DIRECT_SHEETS_SCHEMA_DEFINITIONS[4]!.headers];

    const legacySessionRow42 = [
      'REC_LEG_1',
      'CT_IN_20261110_01234567890_08_A_001',
      'legacy-client-key-1',
      'Brintha J',
      'brinthajayaprakash888@gmail.com',
      'SA_BRINTHA',
      'TOUR_AM',
      'Amazon Music: Careers Behind the Beats',
      'AFE-IN-AM-OV-TA-2026',
      'Tamil',
      '2026-11-10',
      '2026-11-10',
      '09:30',
      '10:30',
      60,
      '1 hr',
      'November',
      '2026-11-10T05:00:00Z',
      '10-11-2026',
      'GHSS Legacy Leading Zero',
      '01234567890',
      'Government school',
      'Tamil Nadu',
      'Cuddalore',
      'Panruti',
      '006001',
      'single',
      1,
      40,
      40,
      40,
      4.5,
      4.25,
      10,
      'Promoter',
      100,
      'COMMITTED',
      '2026-11-10T05:00:00Z',
      '2026-11-10T05:00:00Z',
      'brinthajayaprakash888@gmail.com',
      'brinthajayaprakash888@gmail.com',
      'false',
    ];

    const legacySchoolRow11 = [
      'SCH_LEG_1',
      'GHSS Legacy Leading Zero',
      '01234567890',
      'Government school',
      'Tamil Nadu',
      'Cuddalore',
      'Panruti',
      '006001',
      'true',
      '2026-11-10T05:00:00Z',
      '2026-11-10T05:00:00Z',
    ];

    const legacyTabMap = new Map<string, unknown[][]>([
      ['Sessions', [sessHeaders42, legacySessionRow42]],
      ['Session Details', [[...DIRECT_SHEETS_SCHEMA_DEFINITIONS[1]!.headers]]],
      ['Facilitators', [[...DIRECT_SHEETS_SCHEMA_DEFINITIONS[2]!.headers]]],
      ['Schools', [schoolHeaders11, legacySchoolRow11]],
      [
        'Configuration',
        [
          cfgHeaders,
          ['partner_name', JSON.stringify('Vidhya Vidhai'), '2026-11-10T00:00:00Z', 'SA_BRINTHA'],
          [
            'district_blocks',
            JSON.stringify([{ district: 'Cuddalore', block: 'Panruti', active: true }]),
            '2026-11-10T00:00:00Z',
            'SA_BRINTHA',
          ],
          ['school_year', JSON.stringify('2026-2027'), '2026-11-10T00:00:00Z', 'SA_BRINTHA'],
        ],
      ],
      ['Admin Users', [[...DIRECT_SHEETS_SCHEMA_DEFINITIONS[5]!.headers]]],
      ['Audit Log', [[...DIRECT_SHEETS_SCHEMA_DEFINITIONS[6]!.headers]]],
      ['Sync Log', [[...DIRECT_SHEETS_SCHEMA_DEFINITIONS[7]!.headers]]],
    ]);
    sheetsBySpreadsheet.set(legacySheetId, legacyTabMap);

    // 1. Pre-migration load parses 42-col Sessions, 11-col Schools, and ignores legacy district_blocks cleanly
    const beforeLoad = await loadDirectWorkspace(legacySheetId, 'tok-sa-direct');
    expect(beforeLoad.ok).toBe(true);
    expect(beforeLoad.data!.sessions).toHaveLength(1);
    expect(beforeLoad.data!.sessions[0]!.pinCode).toBe('006001');
    expect(beforeLoad.data!.sessions[0]!.totalStudentsPresent).toBe(40);
    expect(beforeLoad.data!.schools[0]!.pinCode).toBe('006001');
    expect(beforeLoad.data!.schools[0]!.active).toBe(true);
    expect('districtBlocks' in beforeLoad.data!.configurationPatch).toBe(false);

    // 2. Connecting migrates Sessions (42->41), Schools (11->10), and strips district_blocks non-destructively
    const conn = await connectDirectGoogleSheet({
      accessToken: 'tok-sa-direct',
      spreadsheetUrlOrId: legacySheetId,
      initializeSchema: true,
      actorEmail: SANDBOX_USERS.super_admin_1.email,
    });
    expect(conn.ok).toBe(true);

    expect(legacyTabMap.get('Sessions')![0]).toHaveLength(41);
    expect(legacyTabMap.get('Sessions')![0]).not.toContain('block');
    expect(legacyTabMap.get('Sessions')![1]).toHaveLength(41);
    expect(legacyTabMap.get('Sessions')![1]![24]).toBe('006001');
    expect(legacyTabMap.get('Sessions')![1]![27]).toBe(40);

    expect(legacyTabMap.get('Schools')![0]).toHaveLength(10);
    expect(legacyTabMap.get('Schools')![0]).not.toContain('block');
    expect(legacyTabMap.get('Schools')![1]).toHaveLength(10);
    expect(legacyTabMap.get('Schools')![1]![5]).toBe('Cuddalore');
    expect(legacyTabMap.get('Schools')![1]![6]).toBe('006001');

    const cfgKeysAfter = legacyTabMap.get('Configuration')!.slice(1).map((r) => r[0]);
    expect(cfgKeysAfter).toContain('partner_name');
    expect(cfgKeysAfter).toContain('school_year');
    expect(cfgKeysAfter).not.toContain('district_blocks');

    // 3. Post-migration workspace reload still reads all preserved data accurately
    const afterLoad = await loadDirectWorkspace(legacySheetId, 'tok-sa-direct');
    expect(afterLoad.ok).toBe(true);
    expect(afterLoad.data!.sessions).toHaveLength(1);
    expect(afterLoad.data!.sessions[0]!.udiseCode).toBe('01234567890');
    expect(afterLoad.data!.sessions[0]!.pinCode).toBe('006001');
    expect(afterLoad.data!.schools).toHaveLength(1);
    expect(afterLoad.data!.schools[0]!.pinCode).toBe('006001');
  });
});
