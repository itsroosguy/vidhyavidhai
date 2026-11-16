import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import {
  clearAppsScriptBridgeConfig,
  clearCachedSheetsConnection,
  clearDirectGoogleClientId,
  loadAppsScriptBridgeConfig,
  setRuntimeSheetsBackendUrl,
} from '../../services/authService';
import {
  buildRelativeSpreadsheetTitle,
  clearDirectGoogleSheetsToken,
  hasDirectSheetsAccessToken,
} from '../../services/googleSheetsDirectService';

function createStatefulMockFetch() {
  const sheetsBySpreadsheet = new Map<string, Map<string, unknown[][]>>();
  const titlesBySpreadsheet = new Map<string, string>();
  const recordedUrls: string[] = [];
  let seq = 1;

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
      out.push(endCol >= 200 ? [...row.slice(startCol)] : row.slice(startCol, endCol + 1));
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
    recordedUrls.push(urlStr);
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const method = (init?.method || 'GET').toUpperCase();

    if (urlStr.startsWith('/api/sheets')) {
      return new Response('Not Found', { status: 404 });
    }

    if (urlStr === 'https://www.googleapis.com/oauth2/v3/userinfo') {
      return new Response(
        JSON.stringify({ email: 'brinthajayaprakash888@gmail.com', name: 'Brintha J' }),
        { status: 200 },
      );
    }

    if (urlStr === 'https://sheets.googleapis.com/v4/spreadsheets' && method === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const payload = JSON.parse(bodyText) as {
        properties?: { title?: string };
        sheets?: Array<{ properties?: { title?: string } }>;
      };
      const spreadsheetId = `quick_live_${seq++}`;
      const title = payload.properties?.title || 'Untitled';
      titlesBySpreadsheet.set(spreadsheetId, title);
      const tabMap = new Map<string, unknown[][]>();
      for (const s of payload.sheets || []) {
        if (s.properties?.title) tabMap.set(s.properties.title, []);
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
        for (const row of incoming) rows.push([...row]);
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

    return new Response('{}', { status: 200 });
  });

  return { fetchMock, sheetsBySpreadsheet, titlesBySpreadsheet, recordedUrls };
}

async function submitClassroomSessionViaUi(
  user: ReturnType<typeof userEvent.setup>,
  schoolName: string,
  udiseCode: string,
) {
  await user.click(screen.getByRole('button', { name: /Enter a class/i }));

  await user.click(screen.getByRole('button', { name: /What time did it start\?/i }));
  fireEvent.change(screen.getByLabelText(/What time did it start\? direct time input/i), {
    target: { value: '10:00' },
  });
  await user.click(
    within(screen.getByRole('region', { name: /What time did it start\? clock selector/i })).getByRole(
      'button',
      { name: 'Done' },
    ),
  );

  await user.click(screen.getByRole('button', { name: /What time did it end\?/i }));
  fireEvent.change(screen.getByLabelText(/What time did it end\? direct time input/i), {
    target: { value: '11:00' },
  });
  await user.click(
    within(screen.getByRole('region', { name: /What time did it end\? clock selector/i })).getByRole(
      'button',
      { name: 'Done' },
    ),
  );

  await user.type(screen.getByLabelText(/^School name/i), schoolName);
  await user.type(screen.getByLabelText(/School code \(UDISE\)/i), udiseCode);
  await user.selectOptions(
    screen.getByLabelText(/What kind of school is it\?/i),
    'Government school',
  );
  await user.selectOptions(screen.getByLabelText(/^District/i), 'Cuddalore');
  await user.type(screen.getByLabelText(/^PIN code/i), '607106');

  await user.selectOptions(screen.getByLabelText(/Which class \(grade\) is it\?/i), '8');
  await user.selectOptions(screen.getByLabelText(/^Section/i), 'A');
  await user.type(screen.getByLabelText(/How many students were present\?/i), '40');
  await user.type(screen.getByLabelText(/Grade 8 · A Question A score 5/i), '40');
  await user.type(screen.getByLabelText(/Grade 8 · A Question B score 5/i), '40');
  await user.selectOptions(screen.getByLabelText(/Teacher's score/i), 'promoter');

  await user.click(screen.getByRole('button', { name: /Save this class/i }));
  const reviewDialog = await screen.findByRole('dialog', {
    name: /Review before submitting session/i,
  });
  await user.click(within(reviewDialog).getByRole('button', { name: /Confirm & submit/i }));

  const successDialog = await screen.findByRole('dialog', { name: /Session saved successfully!/i });
  return successDialog;
}

describe('TopGoogleSheetsQuickBar & Sandbox -> Live Google Sheets Workflow', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setRuntimeSheetsBackendUrl('');
    clearAppsScriptBridgeConfig();
    clearDirectGoogleClientId();
    clearCachedSheetsConnection('local_sandbox');
    clearCachedSheetsConnection('apps_script');
    clearDirectGoogleSheetsToken();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    clearDirectGoogleSheetsToken();
    vi.restoreAllMocks();
    delete (window as unknown as { google?: unknown }).google;
  });

  it('shows Quick Google Sheet Sync at top for Super Admin, auto-generates relative title, creates live 10-tab sheet & pushes without duplicates', async () => {
    const user = userEvent.setup();
    const { fetchMock, sheetsBySpreadsheet, titlesBySpreadsheet } = createStatefulMockFetch();
    vi.stubGlobal('fetch', fetchMock);
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: { callback: (resp: { access_token: string; expires_in: number }) => void }) => ({
            requestAccessToken: () =>
              cfg.callback({ access_token: 'tok-quickbar-live', expires_in: 3600 }),
          }),
        },
      },
    };

    render(<App />);

    await user.type(screen.getByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    const quickAside = await screen.findByRole('complementary', {
      name: /Quick Google Sheet Sync/i,
    });
    expect(within(quickAside).getByText('Device Storage · Push Live')).toBeInTheDocument();

    // Submit a classroom session in local device storage first
    const successModal1 = await submitClassroomSessionViaUi(
      user,
      'GHSS Cuddalore Quick Sync',
      '33180100111',
    );
    await user.click(within(successModal1).getByRole('button', { name: /Start a new session/i }));

    // Top Quick Bar updates live with counts and district-aware relative title!
    await waitFor(() => {
      expect(within(quickAside).getByText('1 session')).toBeInTheDocument();
      expect(within(quickAside).getByText('1 pending sync')).toBeInTheDocument();
    });

    const expectedTitle = buildRelativeSpreadsheetTitle({
      programmeName: 'Career Tours',
      sessions: [{ district: 'Cuddalore', startDate: '' }],
    });
    const titleInput = within(quickAside).getByLabelText(
      /New Live Excel \/ Google Sheet Title/i,
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(titleInput.value).toBe(expectedTitle);
    });

    // Enter Web Client ID and click "Create Sheet & Push All Data"
    await user.type(
      within(quickAside).getByLabelText(/Google OAuth 2\.0 Web Client ID \(Direct Sync\)/i),
      '1234567890-quickbar.apps.googleusercontent.com',
    );
    await user.click(
      within(quickAside).getByRole('button', { name: /Create Sheet & Push All Data/i }),
    );

    await waitFor(() => {
      expect(titlesBySpreadsheet.get('quick_live_1')).toBe(expectedTitle);
      expect(within(quickAside).getByText('Google Sheets Live')).toBeInTheDocument();
      expect(within(quickAside).getByText('0 pending sync')).toBeInTheDocument();
      expect(within(quickAside).getByRole('link', { name: /Open Live Sheet/i })).toHaveAttribute(
        'href',
        'https://docs.google.com/spreadsheets/d/quick_live_1/edit',
      );
    });

    const tabs = sheetsBySpreadsheet.get('quick_live_1')!;
    expect(tabs.get('Sessions')).toHaveLength(2);
    expect(tabs.get('Session Details')).toHaveLength(2);
    expect(tabs.get('Schools')).toHaveLength(2);

    // Repeat Push Data Now adds ZERO duplicate rows
    await user.click(within(quickAside).getByRole('button', { name: /Push Data Now/i }));
    await waitFor(() => {
      expect(tabs.get('Sessions')).toHaveLength(2);
    });

    // Token remains strictly in module memory (never written to storage)
    expect(hasDirectSheetsAccessToken('brinthajayaprakash888@gmail.com')).toBe(true);
    const storageDump = JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage } });
    expect(storageDump).not.toContain('tok-quickbar-live');

    // Submit a second classroom session while live -> streams directly into Google Sheets!
    const successModal2 = await submitClassroomSessionViaUi(
      user,
      'GHSS Panruti Direct Live 2',
      '33180100222',
    );
    expect(within(successModal2).getByText('Synced to Google Sheets')).toBeInTheDocument();
    expect(tabs.get('Sessions')).toHaveLength(3);
  }, 20000);

  it('strictly hides Quick Google Sheet Sync and fires zero /api/sheets or googleapis calls for Facilitators', async () => {
    const user = userEvent.setup();
    const { fetchMock, recordedUrls } = createStatefulMockFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await user.type(screen.getByLabelText(/^Email/i), 'priya.facilitator@example.org');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    await screen.findByLabelText(/^School name/i);

    expect(
      screen.queryByRole('complementary', { name: /Quick Google Sheet Sync/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quick Sheet Sync/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Google Sheets/i)).not.toBeInTheDocument();
    expect(
      recordedUrls.some((u) => u.includes('/api/sheets') || u.includes('googleapis.com')),
    ).toBe(false);
  });

  it('connects Apps Script Sync Bridge from Top Quick Bar, copies personalized .gs script, syncs relative-title sheet without duplicates, keeps live status after reload login, and updates Sync Status + Success modals', async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText');
    const bridgeExecUrl = 'https://script.google.com/macros/s/AKfycbQuickBridgeUiTest123456/exec';

    let createdSheetId = '';
    let createdSheetTitle = '';
    const syncedRows: Array<Record<string, unknown>> = [];
    const seenSyncKeys = new Set<string>();

    const bridgeFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('/api/sheets')) {
        return new Response('Not Found', { status: 404 });
      }
      if (urlStr === bridgeExecUrl) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          action: string;
          syncKey?: string;
          actorEmail?: string;
          payload?: Record<string, unknown>;
        };
        if (body.syncKey) seenSyncKeys.add(body.syncKey);

        const buildConn = () => ({
          connected: Boolean(createdSheetId),
          authMethod: 'apps_script' as const,
          connectionProvider: 'apps_script' as const,
          oauthConfigured: true,
          connectedAccount: body.actorEmail || 'brinthajayaprakash888@gmail.com',
          spreadsheetId: createdSheetId,
          spreadsheetName: createdSheetTitle,
          spreadsheetUrl: createdSheetId
            ? `https://docs.google.com/spreadsheets/d/${createdSheetId}/edit`
            : '',
          connectedAt: '2026-11-11T04:00:00Z',
          connectedBy: body.actorEmail || 'brinthajayaprakash888@gmail.com',
          lastSyncedAt: '2026-11-11T04:00:00Z',
          lastSyncStatus: 'SYNCED' as const,
          lastSyncMessage: 'Synced cleanly',
          initializedTabs: [
            'Sessions',
            'Session Details',
            'Facilitators',
            'Schools',
            'Configuration',
            'Admin Users',
            'Audit Log',
            'Sync Log',
          ],
          defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
          defaultSpreadsheetUrl:
            'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
        });

        if (body.action === 'getSheetsConnection') {
          return new Response(JSON.stringify({ ok: true, data: buildConn() }), { status: 200 });
        }
        if (body.action === 'createGoogleSheet') {
          createdSheetId = 'BRIDGE_UI_SHEET_1';
          createdSheetTitle = String(body.payload?.title || 'Relative Bridge Sheet');
          return new Response(JSON.stringify({ ok: true, data: buildConn() }), { status: 200 });
        }
        if (body.action === 'syncAllToGoogleSheet') {
          const incoming = (body.payload?.sessions || []) as Array<Record<string, unknown>>;
          let syncedCount = 0;
          let skippedDuplicates = 0;
          for (const s of incoming) {
            if (syncedRows.some((r) => r.sessionRecordId === s.sessionRecordId)) {
              skippedDuplicates++;
            } else {
              syncedRows.push(s);
              syncedCount++;
            }
          }
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                syncedCount,
                skippedDuplicates,
                totalSheets: 10,
                spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${createdSheetId}/edit`,
                syncedAt: '2026-11-11T04:01:00Z',
                message: `Pushed ${syncedCount} session(s) cleanly.`,
              },
            }),
            { status: 200 },
          );
        }
        if (body.action === 'loadWorkspace') {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                connection: buildConn(),
                configuration: {},
                sessions: syncedRows,
                schools: [],
                users: [],
                auditLogs: { items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 },
                syncLogs: { items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 },
                loadedAt: '2026-11-11T04:02:00Z',
              },
            }),
            { status: 200 },
          );
        }
        if (body.action === 'createSession') {
          const vals = (body.payload?.values || {}) as Record<string, unknown>;
          const newRec = {
            sessionRecordId: `REC_BRIDGE_${syncedRows.length + 1}`,
            sessionId: `CT_IN_20261111_33180100777_08_A_00${syncedRows.length + 1}`,
            clientSubmissionKey: String(vals.clientSubmissionKey || ''),
            facilitatorName: String(vals.facilitatorName || 'Brintha J'),
            facilitatorEmail: body.actorEmail || 'brinthajayaprakash888@gmail.com',
            facilitatorUserId: 'SA_BRINTHA',
            tourId: String(vals.tourId || 'TOUR_AM'),
            tourName: 'Amazon Music: Careers Behind the Beats',
            videoId: 'AFE-IN-AM-OV-TA-2026',
            language: String(vals.language || 'Tamil'),
            startDate: String(vals.startDate || '2026-11-11'),
            endDate: String(vals.endDate || '2026-11-11'),
            startTime: String(vals.startTime || '10:00'),
            endTime: String(vals.endTime || '11:00'),
            durationMinutes: 60,
            durationFormatted: '1 hr',
            reportingMonth: 'November',
            submissionTimestamp: '2026-11-11T04:05:00Z',
            submissionDateFormatted: '11-11-2026',
            schoolName: String(vals.schoolName || ''),
            udiseCode: String(vals.udiseCode || ''),
            schoolType: String(vals.schoolType || 'Government school'),
            state: 'Tamil Nadu',
            district: String(vals.district || 'Cuddalore'),
            pinCode: String(vals.pinCode || '607106'),
            sessionType: 'single',
            totalClasses: 1,
            totalStudentsPresent: 40,
            totalQuestionAResponses: 40,
            totalQuestionBResponses: 40,
            overallCsat: 5,
            overallItp: 5,
            teacherScore: 10,
            teacherClassification: 'Promoter',
            teacherNps: 100,
            submissionStatus: 'COMMITTED',
            syncStatus: 'SYNCED',
            createdAt: '2026-11-11T04:05:00Z',
            updatedAt: '2026-11-11T04:05:00Z',
            createdBy: body.actorEmail || 'brinthajayaprakash888@gmail.com',
            updatedBy: body.actorEmail || 'brinthajayaprakash888@gmail.com',
            archived: false,
            details: [],
          };
          syncedRows.push(newRec);
          return new Response(
            JSON.stringify({ ok: true, data: { session: newRec, warnings: [] } }),
            { status: 200 },
          );
        }
      }
      return new Response('{}', { status: 200 });
    });

    vi.stubGlobal('fetch', bridgeFetchMock);

    // 1. Super Admin logs in with PBKDF2 password
    render(<App />);
    await user.type(screen.getByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    const quickAside = await screen.findByRole('complementary', {
      name: /Quick Google Sheet Sync/i,
    });

    // Switch Top Quick Bar method to Apps Script Web App (defaults to Apps Script Sync Bridge)
    await user.click(within(quickAside).getByRole('button', { name: /^Apps Script Web App$/i }));

    const passphraseInput = within(quickAside).getByLabelText(
      /Sync Bridge Passphrase/i,
    ) as HTMLInputElement;
    const generatedPassphrase = passphraseInput.value;
    expect(generatedPassphrase.length).toBeGreaterThanOrEqual(16);

    // Expand personalized .gs viewer, assert passphrase embedded, and click Invoker Command Copy button
    const summaryToggle = within(quickAside).getByText(
      /Get Personalized CareerToursAllInOne\.gs Script/i,
    );
    await user.click(summaryToggle);

    await waitFor(() => {
      expect(
        within(quickAside).getByText(
          new RegExp(`var CT_PRESET_SANDBOX_SYNC_KEY = '${generatedPassphrase}'`),
        ),
      ).toBeInTheDocument();
    });

    const copyBtn = within(quickAside).getByRole('button', { name: /Copy Script/i });
    await user.click(copyBtn);
    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalled();
      expect(writeTextSpy.mock.calls[0]?.[0]).toContain(
        `var CT_PRESET_SANDBOX_SYNC_KEY = '${generatedPassphrase}'`,
      );
      expect(copyBtn).toHaveAttribute('data-copied', '');
      const copyStatusEl = copyBtn.nextElementSibling as HTMLElement | null;
      expect(copyStatusEl).toHaveAttribute('role', 'status');
      expect(copyStatusEl).toHaveTextContent(/^Copied/);
    });

    // Connect Bridge & create relative-title Google Sheet
    await user.type(
      within(quickAside).getByLabelText(/Bridge Apps Script \/exec URL/i),
      bridgeExecUrl,
    );
    const titleInput = within(quickAside).getByLabelText(
      /New Live Excel \/ Google Sheet Title/i,
    ) as HTMLInputElement;
    const expectedTitle = titleInput.value;
    expect(expectedTitle).toContain('Career Tours');

    await user.click(
      within(quickAside).getByRole('button', { name: /Create Sheet & Connect Bridge/i }),
    );

    await waitFor(() => {
      expect(createdSheetId).toBe('BRIDGE_UI_SHEET_1');
      expect(within(quickAside).getByText('Google Sheets Live')).toBeInTheDocument();
      expect(seenSyncKeys.has(generatedPassphrase)).toBe(true);
    });

    // Open Google Sheets Sync Status modal -> must show green Google Sheets Live & Bridge Active (zero telemetry/jargon)
    await user.click(
      within(screen.getByRole('banner')).getByRole('button', { name: /Google Sheets Live/i }),
    );
    const syncDialog = await screen.findByRole('dialog', {
      name: /Google Sheets Sync Status/i,
    });
    expect(within(syncDialog).getByText('Google Sheets Live')).toBeInTheDocument();
    expect(
      within(syncDialog).getByText(/Connected to Google Sheets via Apps Script Sync Bridge/i),
    ).toBeInTheDocument();
    expect(within(syncDialog).getByText(/Apps Script Sync Bridge Active/i)).toBeInTheDocument();
    expect(within(syncDialog).queryByText(/Pipeline Telemetry/i)).not.toBeInTheDocument();
    expect(within(syncDialog).queryByText(/frontend\/\.env/i)).not.toBeInTheDocument();
    expect(within(syncDialog).queryByText(/Local Sandbox/i)).not.toBeInTheDocument();
    await user.click(within(syncDialog).getByRole('button', { name: /^Close$/ }));

    // Submit a classroom session while Bridge is live -> SubmissionSuccessModal must show Synced to Google Sheets
    const successDialog = await submitClassroomSessionViaUi(
      user,
      'GHSS Bridge Live School',
      '33180100777',
    );
    expect(within(successDialog).getByText('Synced to Google Sheets')).toBeInTheDocument();
    expect(within(successDialog).queryByText(/Local Sandbox/i)).not.toBeInTheDocument();
    expect(syncedRows).toHaveLength(1);
    await user.click(within(successDialog).getByRole('button', { name: /Start a new session/i }));

    // Sign out -> remembered account card + Bridge persisted cleanly -> Sign back in restores green Google Sheets Live
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    expect(loadAppsScriptBridgeConfig()?.appsScriptUrl).toBe(bridgeExecUrl);
    await user.click(screen.getByText('brinthajayaprakash888@gmail.com').closest('button')!);
    const pwAgain = await screen.findByLabelText(/^Password/i);
    await user.type(pwAgain, 'brintha888');
    await user.click(pwAgain.closest('form')!.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Google Sheets Live/i })).toBeInTheDocument();
    });
  }, 25000);
});
