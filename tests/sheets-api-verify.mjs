import assert from 'node:assert/strict';
import {
  DEFAULT_TARGET_SPREADSHEET_ID,
  DEFAULT_TARGET_SPREADSHEET_URL,
  SHEETS_SCHEMA_DEFINITIONS,
  createSheetsHandler,
  decryptCookiePayload,
  encryptCookiePayload,
  parseSpreadsheetId,
} from '../api/sheets.mjs';

function makeMockReq({ method = 'GET', url = '/api/sheets', headers = {}, body } = {}) {
  const req = {
    method,
    url,
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'vidhyavidhai.roosstudiox.com',
      ...headers,
    },
    body,
    async *[Symbol.asyncIterator]() {
      if (typeof body === 'string') {
        yield Buffer.from(body, 'utf8');
      }
    },
  };
  return req;
}

function makeMockRes() {
  const headers = new Map();
  let endedBody = '';
  const res = {
    statusCode: 200,
    setHeader(k, v) {
      headers.set(k.toLowerCase(), v);
    },
    getHeader(k) {
      return headers.get(k.toLowerCase());
    },
    end(chunk = '') {
      endedBody += String(chunk || '');
    },
    getJson() {
      return JSON.parse(endedBody || '{}');
    },
  };
  return res;
}

function extractCookiesFromSetHeader(setCookieHeader) {
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const pairs = [];
  for (const item of arr) {
    const first = String(item).split(';')[0];
    if (first) pairs.push(first);
  }
  return pairs.join('; ');
}

async function runTests() {
  // 1. Parse Spreadsheet ID helper
  assert.equal(
    parseSpreadsheetId(DEFAULT_TARGET_SPREADSHEET_URL),
    DEFAULT_TARGET_SPREADSHEET_ID,
  );
  assert.equal(
    parseSpreadsheetId(DEFAULT_TARGET_SPREADSHEET_ID),
    DEFAULT_TARGET_SPREADSHEET_ID,
  );
  assert.equal(parseSpreadsheetId('not valid!!'), '');

  // 2. AES-256-GCM encryption & tamper resistance
  const secret = 'very-strong-32-char-sheets-secret-key!';
  const token = encryptCookiePayload({ accessToken: 'secret-token', connectedAccount: 'karunya@vidhyavidhai.org' }, secret);
  assert.equal(token.includes('secret-token'), false);
  const decrypted = decryptCookiePayload(token, secret);
  assert.equal(decrypted.accessToken, 'secret-token');
  assert.equal(decryptCookiePayload(`${token}tamper`, secret), null);

  // 3. Fail closed when OAuth env credentials are absent
  const unconfiguredHandler = createSheetsHandler({ env: {} });
  const statusReq = makeMockReq({ method: 'GET', url: '/api/sheets?action=status' });
  const statusRes = makeMockRes();
  await unconfiguredHandler(statusReq, statusRes);
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.getJson().data.oauthConfigured, false);

  const postFailReq = makeMockReq({ method: 'POST', url: '/api/sheets', body: { action: 'connect' } });
  const postFailRes = makeMockRes();
  await unconfiguredHandler(postFailReq, postFailRes);
  assert.equal(postFailRes.statusCode, 503);
  assert.equal(postFailRes.getJson().code, 'SERVER_MISCONFIGURED');

  // 4. Full OAuth 2.0 + Drive/Sheets v4 API workflow with mocked Google endpoints
  const driveFiles = [
    {
      id: DEFAULT_TARGET_SPREADSHEET_ID,
      name: 'Vidhya Vidhai · Career Tours Sheet',
      webViewLink: DEFAULT_TARGET_SPREADSHEET_URL,
      modifiedTime: '2026-11-10T10:00:00Z',
    },
  ];
  const sheetTabs = new Map([[DEFAULT_TARGET_SPREADSHEET_ID, new Set(['Sheet1'])]]);
  const spreadsheetData = new Map([
    [
      DEFAULT_TARGET_SPREADSHEET_ID,
      new Map([
        [
          'Sessions',
          [
            SHEETS_SCHEMA_DEFINITIONS[0].headers,
            ['REC_EXISTING', 'AFE-IN-AM-TA-2026-11-33180100101-SGL-01-001', 'client-key-existing'],
          ],
        ],
      ]),
    ],
  ]);
  const appendedUrls = [];
  const batchUpdateRequests = [];
  const valueUpdates = new Map();
  let revokedToken = null;
  let tokenRefreshCount = 0;

  const colLettersToIndex = (letters) => {
    let idx = 0;
    for (const ch of letters.toUpperCase()) {
      idx = idx * 26 + (ch.charCodeAt(0) - 64);
    }
    return idx - 1;
  };

  const parseA1Range = (rangeStr) => {
    const clean = decodeURIComponent(String(rangeStr || ''));
    const bangIdx = clean.indexOf('!');
    const rawTab = bangIdx === -1 ? clean : clean.slice(0, bangIdx);
    const tabName = rawTab.replace(/^'|'$/g, '');
    const part = bangIdx === -1 ? 'A1:ZZ' : clean.slice(bangIdx + 1);
    if (part === '1:1') {
      return { tabName, startCol: 0, endCol: 200, startRow: 0, endRow: 0 };
    }
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)?(\d+)?)?$/i.exec(part);
    if (!m) {
      return { tabName, startCol: 0, endCol: 200, startRow: 0, endRow: Infinity };
    }
    const startCol = colLettersToIndex(m[1]);
    const startRow = Number(m[2]) - 1;
    const hasColon = part.includes(':');
    const endCol = hasColon ? (m[3] ? colLettersToIndex(m[3]) : startCol) : startCol;
    const endRow = hasColon ? (m[4] ? Number(m[4]) - 1 : Infinity) : startRow;
    return { tabName, startCol, endCol, startRow, endRow };
  };

  const getTabRows = (spreadsheetId, tabName) => {
    let tabsMap = spreadsheetData.get(spreadsheetId);
    if (!tabsMap) {
      tabsMap = new Map();
      spreadsheetData.set(spreadsheetId, tabsMap);
    }
    let rows = tabsMap.get(tabName);
    if (!rows) {
      rows = [];
      tabsMap.set(tabName, rows);
    }
    return rows;
  };

  const readRangeValues = (spreadsheetId, rangeStr) => {
    const { tabName, startCol, endCol, startRow, endRow } = parseA1Range(rangeStr);
    const rows = getTabRows(spreadsheetId, tabName);
    const maxR = Math.min(rows.length - 1, endRow);
    const out = [];
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

  const writeRangeValues = (spreadsheetId, rangeStr, values) => {
    const { tabName, startCol, startRow } = parseA1Range(rangeStr);
    const rows = getTabRows(spreadsheetId, tabName);
    (values || []).forEach((vals, rOff) => {
      const rIdx = startRow + rOff;
      while (rows.length <= rIdx) rows.push([]);
      const targetRow = rows[rIdx];
      (vals || []).forEach((cellVal, cOff) => {
        const cIdx = startCol + cOff;
        while (targetRow.length < cIdx) targetRow.push('');
        targetRow[cIdx] = cellVal;
      });
    });
  };

  const mockFetch = async (url, init = {}) => {
    const strUrl = String(url);
    if (strUrl === 'https://oauth2.googleapis.com/token') {
      const bodyStr = String(init.body || '');
      if (bodyStr.includes('grant_type=authorization_code')) {
        return new Response(
          JSON.stringify({
            access_token: 'access-tok-initial',
            refresh_token: 'refresh-tok-1',
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
      if (bodyStr.includes('grant_type=refresh_token')) {
        tokenRefreshCount++;
        return new Response(
          JSON.stringify({
            access_token: 'access-tok-refreshed',
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
    }

    if (strUrl === 'https://openidconnect.googleapis.com/v1/userinfo') {
      const auth = String(init.headers?.Authorization || '');
      if (auth.includes('access-tok-unauthorized')) {
        return new Response(
          JSON.stringify({ email: 'random.facilitator@example.org', email_verified: true }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ email: 'brinthajayaprakash888@gmail.com', email_verified: true }),
        { status: 200 },
      );
    }

    if (strUrl.startsWith('https://oauth2.googleapis.com/revoke')) {
      revokedToken = new URL(strUrl).searchParams.get('token');
      return new Response('{}', { status: 200 });
    }

    if (strUrl.startsWith('https://www.googleapis.com/drive/v3/files')) {
      if (String(init.headers?.Authorization || '') === 'Bearer access-tok-stale-force-401') {
        return new Response(
          JSON.stringify({ error: { message: 'Invalid Credentials' } }),
          { status: 401 },
        );
      }
      return new Response(JSON.stringify({ files: driveFiles }), { status: 200 });
    }

    if (strUrl === 'https://sheets.googleapis.com/v4/spreadsheets') {
      const parsed = JSON.parse(init.body);
      const newId = 'NEW_SHEET_CREATED_999';
      sheetTabs.set(
        newId,
        new Set(parsed.sheets.map((s) => s.properties.title)),
      );
      return new Response(
        JSON.stringify({
          spreadsheetId: newId,
          properties: { title: parsed.properties.title },
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${newId}/edit`,
        }),
        { status: 200 },
      );
    }

    if (strUrl.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
      const u = new URL(strUrl);
      const pathParts = u.pathname.split('/');
      const rawIdPart = pathParts[3] || '';
      const spreadsheetId = decodeURIComponent(rawIdPart.split(':')[0]);

      if (u.pathname.endsWith('/values:batchUpdate')) {
        const bodyObj = JSON.parse(init.body);
        for (const item of bodyObj.data || []) {
          valueUpdates.set(item.range, {
            valueInputOption: bodyObj.valueInputOption,
            values: item.values,
          });
          writeRangeValues(spreadsheetId, item.range, item.values);
        }
        return new Response(JSON.stringify({ totalUpdatedCells: 100 }), { status: 200 });
      }

      if (u.pathname.endsWith(':batchUpdate')) {
        const bodyObj = JSON.parse(init.body);
        const set = sheetTabs.get(spreadsheetId) || new Set();
        const titleList = [...set];
        for (const reqItem of bodyObj.requests || []) {
          batchUpdateRequests.push(reqItem);
          if (reqItem.addSheet?.properties?.title) {
            set.add(reqItem.addSheet.properties.title);
          }
          if (reqItem.deleteDimension?.range?.sheetId !== undefined) {
            const targetTitle = titleList[reqItem.deleteDimension.range.sheetId];
            if (targetTitle) {
              const rows = getTabRows(spreadsheetId, targetTitle);
              const { dimension, startIndex, endIndex } = reqItem.deleteDimension.range;
              if (dimension === 'COLUMNS') {
                for (const row of rows) {
                  row.splice(startIndex, endIndex - startIndex);
                }
              } else {
                rows.splice(startIndex, endIndex - startIndex);
              }
            }
          }
        }
        sheetTabs.set(spreadsheetId, set);
        return new Response(JSON.stringify({ spreadsheetId }), { status: 200 });
      }

      if (u.pathname.includes('/values:batchGet')) {
        const ranges = u.searchParams.getAll('ranges');
        return new Response(
          JSON.stringify({
            valueRanges: ranges.map((r) => ({ values: readRangeValues(spreadsheetId, r) })),
          }),
          { status: 200 },
        );
      }

      if (u.pathname.includes(':append')) {
        const decodedPath = decodeURIComponent(u.pathname);
        appendedUrls.push(decodedPath);
        const rawRange = decodedPath.split('/values/')[1]?.replace(/:append$/, '') || '';
        const { tabName } = parseA1Range(rawRange);
        const bodyObj = JSON.parse(init.body);
        const rows = getTabRows(spreadsheetId, tabName);
        const firstNewRow1 = rows.length + 1;
        const incoming = bodyObj.values || [];
        for (const r of incoming) {
          rows.push([...r]);
        }
        const lastNewRow1 = rows.length;
        return new Response(
          JSON.stringify({
            updates: {
              updatedRange: `'${tabName}'!A${firstNewRow1}:AO${lastNewRow1}`,
              updatedRows: incoming.length,
            },
          }),
          { status: 200 },
        );
      }

      if (u.pathname.includes('/values/')) {
        const decodedPath = decodeURIComponent(u.pathname);
        const rawRange = decodedPath.split('/values/')[1] || '';
        if (init.method === 'PUT') {
          const bodyObj = JSON.parse(init.body);
          writeRangeValues(spreadsheetId, rawRange, bodyObj.values || []);
          return new Response(JSON.stringify({ updatedRange: rawRange }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ values: readRangeValues(spreadsheetId, rawRange) }),
          { status: 200 },
        );
      }

      // Spreadsheet metadata fetch
      const currentTabs = [...(sheetTabs.get(spreadsheetId) || ['Sheet1'])].map((title, idx) => ({
        properties: {
          sheetId: idx,
          title,
          gridProperties: { columnCount: Math.max(26, getTabRows(spreadsheetId, title)[0]?.length || 26) },
        },
      }));
      return new Response(
        JSON.stringify({
          spreadsheetId,
          properties: { title: 'Vidhya Vidhai · Career Tours Sheet' },
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          sheets: currentTabs,
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected fetch URL in sheets-api-verify: ${strUrl}`);
  };

  const handler = createSheetsHandler({
    env: {
      GOOGLE_CLIENT_ID: 'client-id-123.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'client-secret-xyz',
      SHEETS_TOKEN_SECRET: secret,
    },
    fetchImpl: mockFetch,
  });

  // 4a. Unauthenticated POST is forbidden
  const unauthRes = makeMockRes();
  await handler(
    makeMockReq({ method: 'POST', url: '/api/sheets', body: { action: 'listSpreadsheets' } }),
    unauthRes,
  );
  assert.equal(unauthRes.statusCode, 403);
  assert.equal(unauthRes.getJson().code, 'FORBIDDEN');

  // 4b. oauthStart emits HttpOnly + Secure CSRF state cookie & OAuth URL
  const startRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'GET',
      url: '/api/sheets?action=oauthStart&login_hint=brinthajayaprakash888@gmail.com',
    }),
    startRes,
  );
  assert.equal(startRes.statusCode, 302);
  const authLoc = startRes.getHeader('location');
  assert.ok(authLoc.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
  assert.ok(authLoc.includes('access_type=offline'));
  const stateCookie = extractCookiesFromSetHeader(startRes.getHeader('set-cookie'));
  const stateParam = new URL(authLoc).searchParams.get('state');

  // 4c. Bad OAuth CSRF state rejected cleanly
  const badStateRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'GET',
      url: '/api/sheets?action=oauthCallback&state=wrong-state&code=auth-code-1',
      headers: { cookie: stateCookie },
    }),
    badStateRes,
  );
  assert.equal(badStateRes.statusCode, 302);
  assert.match(badStateRes.getHeader('location'), /reason=invalid_state/);

  // 4d. Valid OAuth callback stores encrypted session cookie and NEVER leaks tokens
  const goodCallbackRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'GET',
      url: `/api/sheets?action=oauthCallback&state=${encodeURIComponent(stateParam)}&code=auth-code-1`,
      headers: { cookie: stateCookie },
    }),
    goodCallbackRes,
  );
  assert.equal(goodCallbackRes.statusCode, 302);
  assert.equal(goodCallbackRes.getHeader('location'), '/admin/overview?sheets_oauth=authorized');
  const setCookies = goodCallbackRes.getHeader('set-cookie');
  assert.ok(setCookies.some((c) => c.includes('HttpOnly') && c.includes('SameSite=Lax') && c.includes('Secure')));
  let sessionCookieHeader = extractCookiesFromSetHeader([setCookies[1]]);

  // Status shows connectedAccount without tokens
  const authStatusRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'GET',
      url: '/api/sheets?action=status',
      headers: { cookie: sessionCookieHeader },
    }),
    authStatusRes,
  );
  const authStatusJson = authStatusRes.getJson();
  assert.equal(authStatusJson.ok, true);
  assert.equal(authStatusJson.data.connectedAccount, 'brinthajayaprakash888@gmail.com');
  assert.equal(JSON.stringify(authStatusJson).includes('access-tok-initial'), false);
  assert.equal(JSON.stringify(authStatusJson).includes('refresh-tok-1'), false);

  // 4e. List spreadsheets via Drive v3
  const listRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: sessionCookieHeader },
      body: { action: 'listSpreadsheets' },
    }),
    listRes,
  );
  assert.equal(listRes.getJson().ok, true);
  assert.equal(listRes.getJson().data[0].spreadsheetId, DEFAULT_TARGET_SPREADSHEET_ID);

  // 4f. Connect default target sheet URL -> initializes all 8 tabs & Admin Users & Configuration
  const connectRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: sessionCookieHeader },
      body: { action: 'connect', spreadsheetUrlOrId: DEFAULT_TARGET_SPREADSHEET_URL },
    }),
    connectRes,
  );
  const connectJson = connectRes.getJson();
  assert.equal(connectJson.ok, true);
  assert.equal(connectJson.data.connected, true);
  assert.equal(connectJson.data.spreadsheetId, DEFAULT_TARGET_SPREADSHEET_ID);
  assert.equal(connectJson.data.initializedTabs.length, 8);
  assert.equal(sheetTabs.get(DEFAULT_TARGET_SPREADSHEET_ID).has('Sessions'), true);
  assert.equal(sheetTabs.get(DEFAULT_TARGET_SPREADSHEET_ID).has('Configuration'), true);
  assert.equal(sheetTabs.get(DEFAULT_TARGET_SPREADSHEET_ID).has('Summary & KPIs'), true);
  assert.equal(sheetTabs.get(DEFAULT_TARGET_SPREADSHEET_ID).has('Declarations'), true);
  assert.ok(batchUpdateRequests.some((r) => Boolean(r.setBasicFilter)));
  assert.ok(batchUpdateRequests.some((r) => Boolean(r.setDataValidation)));
  const summaryWrite = valueUpdates.get("'Summary & KPIs'!A1");
  assert.ok(summaryWrite && summaryWrite.valueInputOption === 'USER_ENTERED');
  assert.ok(JSON.stringify(summaryWrite.values).includes('COUNTIFS(Sessions!'));
  const declWrite = valueUpdates.get("'Declarations'!A1");
  assert.ok(declWrite && declWrite.valueInputOption === 'RAW');
  assert.ok(JSON.stringify(declWrite.values).includes('GOV-01'));
  assert.ok(JSON.stringify(declWrite.values).includes('MET-01'));
  sessionCookieHeader = extractCookiesFromSetHeader(connectRes.getHeader('set-cookie'));

  // 4g. Simulate near-expired token in encrypted cookie and verify refresh_token rotation + deduplicated sync
  const rawCookieVal = decodeURIComponent(sessionCookieHeader.split('=')[1]);
  const decodedSession = decryptCookiePayload(rawCookieVal, secret);
  decodedSession.expiresAt = Date.now() + 5_000; // within 60s expiry window
  const expiringCookieHeader = `ct_sheets_session=${encodeURIComponent(encryptCookiePayload(decodedSession, secret))}`;

  appendedUrls.length = 0;
  const syncRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: expiringCookieHeader },
      body: {
        action: 'sync',
        sessions: [
          {
            sessionRecordId: 'REC_EXISTING',
            sessionId: 'AFE-IN-AM-TA-2026-11-33180100101-SGL-01-001',
            clientSubmissionKey: 'client-key-existing',
          },
          {
            sessionRecordId: 'REC_NEW_1',
            sessionId: 'AFE-IN-AM-TA-2026-11-33180100101-SGL-01-002',
            clientSubmissionKey: 'client-key-new-1',
            details: [
              {
                detailRecordId: 'DET_NEW_1',
                grade: '8',
                section: 'A',
                studentsPresent: 35,
              },
            ],
          },
        ],
      },
    }),
    syncRes,
  );
  const syncJson = syncRes.getJson();
  assert.equal(syncJson.ok, true);
  assert.equal(tokenRefreshCount, 1);
  assert.equal(syncJson.data.syncedCount, 1);
  assert.equal(syncJson.data.skippedDuplicates, 1);
  assert.ok(appendedUrls.some((u) => u.includes("'Sessions'!A1:append")));
  assert.ok(appendedUrls.some((u) => u.includes("'Session Details'!A1:append")));

  // 4h. Create new spreadsheet
  const createRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: sessionCookieHeader },
      body: { action: 'create', title: 'New Career Tours Workbook' },
    }),
    createRes,
  );
  assert.equal(createRes.getJson().ok, true);
  assert.equal(createRes.getJson().data.spreadsheetId, 'NEW_SHEET_CREATED_999');

  // 4i. Disconnect revokes access token and expires cookie cleanly
  const discRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: sessionCookieHeader },
      body: { action: 'disconnect' },
    }),
    discRes,
  );
  assert.equal(discRes.getJson().ok, true);
  assert.equal(discRes.getJson().data.connected, false);
  assert.equal(revokedToken, 'access-tok-initial');
  assert.ok(String(discRes.getHeader('set-cookie')[0]).includes('Max-Age=0'));

  // 4j. Proactive GET ?action=status refresh within 5-minute buffer rotates session cookie
  const refreshCountBeforeStatus = tokenRefreshCount;
  const nearExpiryConnected = {
    ...decodedSession,
    accessToken: 'access-tok-initial',
    refreshToken: 'refresh-tok-1',
    spreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
    expiresAt: Date.now() + 120_000, // inside 300s proactive buffer
  };
  const nearExpiryCookie = `ct_sheets_session=${encodeURIComponent(encryptCookiePayload(nearExpiryConnected, secret))}`;
  const proactiveStatusRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'GET',
      url: '/api/sheets?action=status',
      headers: { cookie: nearExpiryCookie },
    }),
    proactiveStatusRes,
  );
  assert.equal(proactiveStatusRes.statusCode, 200);
  assert.equal(proactiveStatusRes.getJson().data.connected, true);
  assert.equal(tokenRefreshCount, refreshCountBeforeStatus + 1);
  const rotatedStatusCookies = proactiveStatusRes.getHeader('set-cookie');
  assert.ok(Array.isArray(rotatedStatusCookies) && rotatedStatusCookies.length === 1);
  assert.ok(rotatedStatusCookies[0].includes('HttpOnly') && rotatedStatusCookies[0].includes('SameSite=Lax'));

  // 4k. Drive HTTP 401 triggers googleApiWithSession force-refresh & single retry seamlessly
  const stale401Session = {
    ...decodedSession,
    accessToken: 'access-tok-stale-force-401',
    refreshToken: 'refresh-tok-1',
    spreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
    expiresAt: Date.now() + 1_800_000, // unexpired locally, rejected 401 upstream
  };
  const stale401Cookie = `ct_sheets_session=${encodeURIComponent(encryptCookiePayload(stale401Session, secret))}`;
  const refreshCountBefore401 = tokenRefreshCount;
  const retry401Res = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: stale401Cookie },
      body: { action: 'listSpreadsheets' },
    }),
    retry401Res,
  );
  assert.equal(retry401Res.statusCode, 200);
  assert.equal(retry401Res.getJson().ok, true);
  assert.equal(tokenRefreshCount, refreshCountBefore401 + 1);
  const rotated401Cookies = retry401Res.getHeader('set-cookie');
  assert.ok(Array.isArray(rotated401Cookies) && rotated401Cookies.length === 1);

  // 4l. OPTIONS preflight & cross-origin trusted HTTPS receives CORS headers + SameSite=None; Secure
  const optionsRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'OPTIONS',
      url: '/api/sheets',
      headers: { origin: 'https://vidhyavidhai.org' },
    }),
    optionsRes,
  );
  assert.equal(optionsRes.statusCode, 204);
  assert.equal(optionsRes.getHeader('access-control-allow-origin'), 'https://vidhyavidhai.org');
  assert.equal(optionsRes.getHeader('access-control-allow-credentials'), 'true');

  const crossOriginStatusRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'GET',
      url: '/api/sheets?action=status',
      headers: { cookie: nearExpiryCookie, origin: 'https://vidhyavidhai.org' },
    }),
    crossOriginStatusRes,
  );
  assert.equal(crossOriginStatusRes.statusCode, 200);
  assert.equal(crossOriginStatusRes.getHeader('access-control-allow-origin'), 'https://vidhyavidhai.org');
  assert.equal(crossOriginStatusRes.getHeader('access-control-allow-credentials'), 'true');
  const crossCookies = crossOriginStatusRes.getHeader('set-cookie');
  assert.ok(crossCookies[0].includes('SameSite=None') && crossCookies[0].includes('Secure'));

  // 4m. Fail closed on unauthenticated & unconnected CRUD calls
  const unauthCreateRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      body: { action: 'createSession', values: {} },
    }),
    unauthCreateRes,
  );
  assert.equal(unauthCreateRes.statusCode, 403);
  assert.equal(unauthCreateRes.getJson().code, 'FORBIDDEN');

  const noSheetCookie = `ct_sheets_session=${encodeURIComponent(
    encryptCookiePayload(
      {
        ...decodedSession,
        accessToken: 'access-tok-initial',
        refreshToken: 'refresh-tok-1',
        spreadsheetId: '',
        expiresAt: Date.now() + 3_600_000,
      },
      secret,
    ),
  )}`;
  const notConnectedRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: noSheetCookie },
      body: { action: 'loadWorkspace' },
    }),
    notConnectedRes,
  );
  assert.equal(notConnectedRes.statusCode, 400);
  assert.equal(notConnectedRes.getJson().code, 'NOT_CONNECTED');

  // Fresh connected cookie bound to DEFAULT_TARGET_SPREADSHEET_ID for end-to-end CRUD tests
  const liveCrudCookie = `ct_sheets_session=${encodeURIComponent(
    encryptCookiePayload(
      {
        ...decodedSession,
        accessToken: 'access-tok-initial',
        refreshToken: 'refresh-tok-1',
        spreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
        expiresAt: Date.now() + 3_600_000,
      },
      secret,
    ),
  )}`;

  const sampleCombinedFormValues = (overrides = {}) => ({
    clientSubmissionKey: 'key-crud-1',
    facilitatorName: 'Brintha Jayaprakash',
    facilitatorEmail: 'brinthajayaprakash888@gmail.com',
    tourId: 'TOUR_AM',
    language: 'Tamil',
    startDate: '2026-10-15',
    endDate: '2026-10-15',
    startTime: '10:00',
    endTime: '11:30',
    schoolName: 'GHSS Test Cuddalore',
    udiseCode: '33180100999',
    schoolType: 'Government school',
    state: 'Tamil Nadu',
    district: 'Cuddalore',
    pinCode: '607106',
    sessionMode: 'combined',
    classes: [
      {
        rowId: 'r1',
        grade: '8',
        section: 'A',
        studentsPresent: '30',
        questionA: { score5: '20', score4: '10', score3: '0', score2: '0', score1: '0' },
        questionB: { score5: '15', score4: '15', score3: '0', score2: '0', score1: '0' },
      },
      {
        rowId: 'r2',
        grade: '9',
        section: 'B',
        studentsPresent: '20',
        questionA: { score5: '10', score4: '10', score3: '0', score2: '0', score1: '0' },
        questionB: { score5: '10', score4: '10', score3: '0', score2: '0', score1: '0' },
      },
    ],
    teacherNpsGroup: 'promoter',
    teacherExactScore: '10',
    ...overrides,
  });

  // 4n. createSession writes transactional COMMITTED session + 2 details + non-destructive School upsert
  const createS1Res = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'createSession', values: sampleCombinedFormValues() },
    }),
    createS1Res,
  );
  assert.equal(createS1Res.statusCode, 200);
  const createS1Json = createS1Res.getJson();
  assert.equal(createS1Json.ok, true);
  const createdSession1 = createS1Json.data.session;
  assert.equal(createdSession1.sessionId, 'CT_IN_20261015_33180100999_CMB_02C_001');
  assert.equal(createdSession1.submissionStatus, 'COMMITTED');
  assert.equal(createdSession1.syncStatus, 'SYNCED');
  assert.equal(createdSession1.totalStudentsPresent, 50);
  assert.equal(createdSession1.details.length, 2);

  // Idempotent retry returns same record without writing a duplicate row
  const sessCountAfterS1 = getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Sessions').length;
  const dupKeyRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'createSession', values: sampleCombinedFormValues() },
    }),
    dupKeyRes,
  );
  assert.equal(dupKeyRes.statusCode, 200);
  assert.equal(dupKeyRes.getJson().data.session.sessionRecordId, createdSession1.sessionRecordId);
  assert.equal(getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Sessions').length, sessCountAfterS1);

  // Second submission on same UDISE + date increments sequence _002 and preserves existing Schools name on conflict
  const createS2Res = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: {
        action: 'createSession',
        values: sampleCombinedFormValues({
          clientSubmissionKey: 'key-crud-2',
          schoolName: 'Different Name Variant',
        }),
      },
    }),
    createS2Res,
  );
  const createS2Json = createS2Res.getJson();
  assert.equal(createS2Json.ok, true);
  const createdSession2 = createS2Json.data.session;
  assert.equal(createdSession2.sessionId, 'CT_IN_20261015_33180100999_CMB_02C_002');
  assert.ok(createS2Json.data.schoolUdiseConflict.includes('GHSS Test Cuddalore'));
  assert.equal(
    getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Schools').filter((r, i) => i > 0).length,
    1,
  );

  // 4o. loadWorkspace returns hydrated sessions with nested details, schools, users, auditLogs & syncLogs
  const loadWsRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'loadWorkspace' },
    }),
    loadWsRes,
  );
  const wsJson = loadWsRes.getJson();
  assert.equal(wsJson.ok, true);
  assert.ok(wsJson.data.sessions.some((s) => s.sessionRecordId === createdSession1.sessionRecordId && s.details.length === 2));
  assert.ok(wsJson.data.schools.some((sc) => sc.udiseCode === '33180100999'));
  assert.ok(wsJson.data.auditLogs.some((a) => a.action === 'CREATE_SESSION'));
  assert.ok(wsJson.data.syncLogs.some((l) => l.operation === 'createSession'));

  // 4p. updateSession shrinks combined 2 classes -> single 1 class cleanly deleting orphan detail row
  const updateRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: {
        action: 'updateSession',
        sessionRecordId: createdSession1.sessionRecordId,
        values: sampleCombinedFormValues({
          clientSubmissionKey: 'key-crud-1',
          sessionMode: 'single',
          classes: [
            {
              rowId: 'r1',
              grade: '8',
              section: 'A',
              studentsPresent: '40',
              questionA: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
              questionB: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
            },
          ],
        }),
      },
    }),
    updateRes,
  );
  const updJson = updateRes.getJson();
  assert.equal(updJson.ok, true);
  assert.equal(updJson.data.session.submissionStatus, 'CORRECTED');
  assert.equal(updJson.data.session.overallCsat, 5);
  assert.equal(updJson.data.session.details.length, 1);
  assert.equal(
    getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Session Details').filter(
      (r, i) => i > 0 && r[1] === createdSession1.sessionRecordId,
    ).length,
    1,
  );

  // 4q. archiveSession & restoreSession toggle archived flag accurately
  const archRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'archiveSession', sessionRecordId: createdSession1.sessionRecordId },
    }),
    archRes,
  );
  assert.equal(archRes.getJson().data.archived, true);

  const restRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'restoreSession', sessionRecordId: createdSession1.sessionRecordId },
    }),
    restRes,
  );
  assert.equal(restRes.getJson().data.archived, false);

  // 4r. deleteSession & bulkDeleteSessions remove parent + detail rows cleanly
  const delS2Res = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'deleteSession', sessionRecordId: createdSession2.sessionRecordId },
    }),
    delS2Res,
  );
  assert.equal(delS2Res.getJson().ok, true);
  assert.equal(delS2Res.getJson().data.deleted, true);
  assert.equal(delS2Res.getJson().data.deletedDetailsCount, 2);

  const bulkDelRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'bulkDeleteSessions', sessionRecordIds: [createdSession1.sessionRecordId] },
    }),
    bulkDelRes,
  );
  assert.equal(bulkDelRes.getJson().ok, true);
  assert.equal(bulkDelRes.getJson().data.deletedCount, 1);
  assert.equal(bulkDelRes.getJson().data.deletedDetailsCount, 1);

  // 4s. updateSchool & deleteSchool preserve leading zeros & enforce permissions
  const createdSchoolId = getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Schools')[1][0];
  const updSchoolRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: {
        action: 'updateSchool',
        school: {
          schoolRecordId: createdSchoolId,
          schoolName: 'GHSS Updated Leading Zero',
          udiseCode: '00001234567',
          schoolType: 'Government school',
          district: 'Cuddalore',
          pinCode: '006001',
          active: false,
        },
      },
    }),
    updSchoolRes,
  );
  assert.equal(updSchoolRes.statusCode, 200);
  assert.equal(updSchoolRes.getJson().data.udiseCode, '00001234567');
  assert.equal(updSchoolRes.getJson().data.active, false);

  const delSchoolRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'deleteSchool', schoolRecordId: createdSchoolId },
    }),
    delSchoolRes,
  );
  assert.equal(delSchoolRes.statusCode, 200);
  assert.equal(delSchoolRes.getJson().data.deleted, true);
  assert.equal(getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Schools').length, 1);

  // 4t. manageUser & deleteUser enforce allowlisted Super Admin protection and role locks
  const createFacRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: {
        action: 'manageUser',
        user: {
          name: 'Deepa Facilitator',
          email: 'deepa.facilitator@vidhyavidhai.org',
          role: 'facilitator',
          active: true,
          status: 'APPROVED',
        },
      },
    }),
    createFacRes,
  );
  assert.equal(createFacRes.statusCode, 200);
  assert.equal(createFacRes.getJson().data.role, 'facilitator');

  const elevateBlockRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: {
        action: 'manageUser',
        user: {
          name: 'Rogue Admin',
          email: 'deepa.facilitator@vidhyavidhai.org',
          role: 'super_admin',
          active: true,
        },
      },
    }),
    elevateBlockRes,
  );
  assert.equal(elevateBlockRes.statusCode, 403);
  assert.equal(elevateBlockRes.getJson().code, 'FORBIDDEN');

  const protectedDeleteRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'deleteUser', userIdOrEmail: 'brinthajayaprakash888@gmail.com' },
    }),
    protectedDeleteRes,
  );
  assert.equal(protectedDeleteRes.statusCode, 403);
  assert.equal(protectedDeleteRes.getJson().code, 'PROTECTED_ACCOUNT');

  const delFacRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'deleteUser', userIdOrEmail: 'deepa.facilitator@vidhyavidhai.org' },
    }),
    delFacRes,
  );
  assert.equal(delFacRes.statusCode, 200);
  assert.equal(delFacRes.getJson().data.deleted, true);

  // 4u. saveConfiguration, verify 41-col Sessions / 10-col Schools, & logExportEvent
  const saveCfgRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: {
        action: 'saveConfiguration',
        config: {
          partnerName: 'Vidhya Vidhai Tamil Nadu',
          policy: {
            allowFacilitatorDeleteOwn: true,
            allowFacilitatorExportOwn: true,
            facilitatorApprovalMode: 'manual_allowlist',
          },
        },
      },
    }),
    saveCfgRes,
  );
  assert.equal(saveCfgRes.statusCode, 200);
  assert.equal(saveCfgRes.getJson().data.partnerName, 'Vidhya Vidhai Tamil Nadu');
  assert.equal(saveCfgRes.getJson().data.policy.allowFacilitatorExportOwn, false);
  assert.equal(getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Sessions')[0].length, 41);
  assert.equal(getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Sessions')[0].includes('block'), false);
  assert.equal(getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Schools')[0].length, 10);
  assert.equal(getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Schools')[0].includes('block'), false);

  const legacyBlockRpcRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'getBlocksForDistrict', district: 'Cuddalore' },
    }),
    legacyBlockRpcRes,
  );
  assert.equal(legacyBlockRpcRes.statusCode, 400);
  assert.equal(legacyBlockRpcRes.getJson().code, 'UNKNOWN_ACTION');

  const expLogRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: { action: 'logExportEvent', scope: 'ALL', rowCount: 4, format: 'official_63' },
    }),
    expLogRes,
  );
  assert.equal(expLogRes.statusCode, 200);
  assert.equal(expLogRes.getJson().data.logged, true);
  assert.ok(
    getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Audit Log').some((r) => r[4] === 'EXPORT_XLSX'),
  );

  // 4v. Cross-origin OPTIONS CORS preflight & full workspace bulk sync (sessions + schools + facilitators + config, 0 duplicates)
  const corsRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'OPTIONS',
      url: '/api/sheets',
      headers: { origin: 'https://vidhyavidhai.roosstudiox.com' },
    }),
    corsRes,
  );
  assert.equal(corsRes.statusCode, 204);
  assert.equal(corsRes.getHeader('access-control-allow-origin'), 'https://vidhyavidhai.roosstudiox.com');
  assert.equal(corsRes.getHeader('access-control-allow-credentials'), 'true');

  const fullSyncPayload = {
    action: 'sync',
    sessions: [
      {
        sessionRecordId: 'REC_WORKSPACE_1',
        sessionId: 'AFE-IN-AM-TA-2026-11-33180100199-SGL-08A-001',
        clientSubmissionKey: 'client-key-ws-1',
        facilitatorName: 'Kaviya',
        facilitatorEmail: 'kaviya.fac@vidhyavidhai.org',
        tourId: 'TOUR_AM',
        tourName: 'Amazon Music: Careers Behind the Beats',
        language: 'Tamil',
        startDate: '2026-11-11',
        endDate: '2026-11-11',
        startTime: '09:30',
        endTime: '10:15',
        schoolName: 'GHS Cuddalore Port',
        udiseCode: '33180100199',
        schoolType: 'Government school',
        state: 'Tamil Nadu',
        district: 'Cuddalore',
        pinCode: '607003',
        sessionType: 'single',
        totalClasses: 1,
        totalStudentsPresent: 40,
        submissionStatus: 'COMMITTED',
        details: [
          {
            detailRecordId: 'DET_WORKSPACE_1',
            grade: '8',
            section: 'A',
            studentsPresent: 40,
          },
        ],
      },
    ],
    schools: [
      {
        schoolRecordId: 'SCH_WS_1',
        schoolName: 'GHS Cuddalore Port',
        udiseCode: '33180100199',
        schoolType: 'Government school',
        state: 'Tamil Nadu',
        district: 'Cuddalore',
        pinCode: '607003',
        active: true,
      },
    ],
    facilitators: [
      {
        userId: 'FAC_WS_1',
        name: 'Kaviya',
        email: 'kaviya.fac@vidhyavidhai.org',
        role: 'facilitator',
        active: true,
        status: 'APPROVED',
      },
      {
        userId: 'SA_SPOOF',
        name: 'Spoof Super Admin',
        email: 'brinthajayaprakash888@gmail.com',
        role: 'super_admin',
        active: true,
      },
    ],
    configuration: {
      partnerName: 'Vidhya Vidhai · Cuddalore',
    },
  };

  const fullSyncRes1 = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: fullSyncPayload,
    }),
    fullSyncRes1,
  );
  assert.equal(fullSyncRes1.statusCode, 200);
  const fullSyncData1 = fullSyncRes1.getJson().data;
  assert.equal(fullSyncData1.syncedCount, 1);
  assert.equal(fullSyncData1.syncedSchoolsCount, 1);
  assert.equal(fullSyncData1.syncedFacilitatorsCount, 1);
  assert.ok(
    getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Schools').some((r) => r[2] === '33180100199'),
  );
  assert.ok(
    getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Facilitators').some((r) => r[2] === 'kaviya.fac@vidhyavidhai.org'),
  );
  assert.equal(
    getTabRows(DEFAULT_TARGET_SPREADSHEET_ID, 'Facilitators').some((r) => r[2] === 'brinthajayaprakash888@gmail.com'),
    false,
  );

  // Idempotent second sync writes 0 duplicates
  const fullSyncRes2 = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: liveCrudCookie },
      body: fullSyncPayload,
    }),
    fullSyncRes2,
  );
  assert.equal(fullSyncRes2.statusCode, 200);
  const fullSyncData2 = fullSyncRes2.getJson().data;
  assert.equal(fullSyncData2.syncedCount, 0);
  assert.equal(fullSyncData2.skippedDuplicates, 1);
  assert.equal(fullSyncData2.syncedSchoolsCount, 0);
  assert.equal(fullSyncData2.syncedFacilitatorsCount, 0);

  // 4w. Non-destructive migration of legacy 42-col Sessions, 11-col Schools & Configuration district_blocks
  const legacySheetId = 'LEGACY_MIG_API_SHEET_01';
  const sessHeaders41 = [...SHEETS_SCHEMA_DEFINITIONS[0].headers];
  const sessHeaders42 = [...sessHeaders41.slice(0, 24), 'block', ...sessHeaders41.slice(24)];
  const schHeaders10 = [...SHEETS_SCHEMA_DEFINITIONS[3].headers];
  const schHeaders11 = [...schHeaders10.slice(0, 6), 'block', ...schHeaders10.slice(6)];
  const cfgHeaders = [...SHEETS_SCHEMA_DEFINITIONS[4].headers];

  const legacySessionRow42 = [
    'REC_API_LEG_1',
    'CT_IN_20261110_01234567890_08_A_001',
    'api-legacy-key-1',
    'Brintha Jayaprakash',
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
    'GHSS API Legacy School',
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
    'SCH_API_LEG_1',
    'GHSS API Legacy School',
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

  sheetTabs.set(
    legacySheetId,
    new Set(SHEETS_SCHEMA_DEFINITIONS.map((d) => d.name)),
  );
  spreadsheetData.set(
    legacySheetId,
    new Map([
      ['Sessions', [sessHeaders42, legacySessionRow42]],
      ['Session Details', [[...SHEETS_SCHEMA_DEFINITIONS[1].headers]]],
      ['Facilitators', [[...SHEETS_SCHEMA_DEFINITIONS[2].headers]]],
      ['Schools', [schHeaders11, legacySchoolRow11]],
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
      ['Admin Users', [[...SHEETS_SCHEMA_DEFINITIONS[5].headers]]],
      ['Audit Log', [[...SHEETS_SCHEMA_DEFINITIONS[6].headers]]],
      ['Sync Log', [[...SHEETS_SCHEMA_DEFINITIONS[7].headers]]],
    ]),
  );

  const legacyApiCookie = `ct_sheets_session=${encodeURIComponent(
    encryptCookiePayload(
      {
        ...decodedSession,
        accessToken: 'access-tok-initial',
        refreshToken: 'refresh-tok-1',
        spreadsheetId: legacySheetId,
        expiresAt: Date.now() + 3_600_000,
      },
      secret,
    ),
  )}`;

  // Pre-migration read handles 42-col Sessions + 11-col Schools + ignores district_blocks safely
  const preMigLoadRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: legacyApiCookie },
      body: { action: 'loadWorkspace' },
    }),
    preMigLoadRes,
  );
  assert.equal(preMigLoadRes.statusCode, 200);
  const preMigData = preMigLoadRes.getJson().data;
  assert.equal(preMigData.sessions.length, 1);
  assert.equal(preMigData.sessions[0].pinCode, '006001');
  assert.equal(preMigData.sessions[0].totalStudentsPresent, 40);
  assert.equal(preMigData.schools[0].pinCode, '006001');
  assert.equal(preMigData.schools[0].active, true);
  assert.equal('districtBlocks' in preMigData.configurationPatch, false);

  // Connecting initializes & migrates schema non-destructively
  const migConnRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: legacyApiCookie },
      body: { action: 'connect', spreadsheetUrlOrId: legacySheetId, initializeSchema: true },
    }),
    migConnRes,
  );
  assert.equal(migConnRes.statusCode, 200);
  assert.equal(migConnRes.getJson().data.connected, true);

  const migSessRows = getTabRows(legacySheetId, 'Sessions');
  assert.equal(migSessRows[0].length, 41);
  assert.equal(migSessRows[0].includes('block'), false);
  assert.equal(migSessRows[1].length, 41);
  assert.equal(migSessRows[1][24], '006001');
  assert.equal(migSessRows[1][27], 40);

  const migSchRows = getTabRows(legacySheetId, 'Schools');
  assert.equal(migSchRows[0].length, 10);
  assert.equal(migSchRows[0].includes('block'), false);
  assert.equal(migSchRows[1].length, 10);
  assert.equal(migSchRows[1][5], 'Cuddalore');
  assert.equal(migSchRows[1][6], '006001');

  const migCfgKeys = getTabRows(legacySheetId, 'Configuration')
    .slice(1)
    .map((r) => r[0]);
  assert.equal(migCfgKeys.includes('district_blocks'), false);
  assert.equal(migCfgKeys.includes('partner_name'), true);
  assert.equal(migCfgKeys.includes('school_year'), true);

  // Post-migration reload reads preserved records identically
  const postMigLoadRes = makeMockRes();
  await handler(
    makeMockReq({
      method: 'POST',
      url: '/api/sheets',
      headers: { cookie: legacyApiCookie },
      body: { action: 'loadWorkspace' },
    }),
    postMigLoadRes,
  );
  assert.equal(postMigLoadRes.statusCode, 200);
  const postMigData = postMigLoadRes.getJson().data;
  assert.equal(postMigData.sessions.length, 1);
  assert.equal(postMigData.sessions[0].udiseCode, '01234567890');
  assert.equal(postMigData.sessions[0].pinCode, '006001');
  assert.equal(postMigData.schools[0].pinCode, '006001');

  console.log('Google Sheets OAuth 2.0 + API backend verification passed cleanly.');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
