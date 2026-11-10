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
  const existingSessionRows = [
    ['REC_EXISTING', 'AFE-IN-AM-TA-2026-11-33180100101-SGL-01-001', 'client-key-existing'],
  ];
  const appendedUrls = [];
  let revokedToken = null;
  let tokenRefreshCount = 0;

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

      if (u.pathname.endsWith(':batchUpdate')) {
        const bodyObj = JSON.parse(init.body);
        const set = sheetTabs.get(spreadsheetId) || new Set();
        for (const reqItem of bodyObj.requests || []) {
          if (reqItem.addSheet?.properties?.title) {
            set.add(reqItem.addSheet.properties.title);
          }
        }
        sheetTabs.set(spreadsheetId, set);
        return new Response(JSON.stringify({ spreadsheetId }), { status: 200 });
      }

      if (u.pathname.includes('/values:batchGet')) {
        return new Response(
          JSON.stringify({
            valueRanges: SHEETS_SCHEMA_DEFINITIONS.map(() => ({ values: [] })),
          }),
          { status: 200 },
        );
      }

      if (u.pathname.endsWith('/values:batchUpdate')) {
        return new Response(JSON.stringify({ totalUpdatedCells: 100 }), { status: 200 });
      }

      if (u.pathname.includes(':append')) {
        appendedUrls.push(decodeURIComponent(u.pathname));
        return new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 });
      }

      if (u.pathname.includes('/values/')) {
        if (decodeURIComponent(u.pathname).includes('Sessions')) {
          return new Response(JSON.stringify({ values: existingSessionRows }), { status: 200 });
        }
        return new Response(JSON.stringify({ values: [] }), { status: 200 });
      }

      // Spreadsheet metadata fetch
      const currentTabs = [...(sheetTabs.get(spreadsheetId) || ['Sheet1'])].map((title, idx) => ({
        properties: { sheetId: idx, title },
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

  console.log('Google Sheets OAuth 2.0 + API backend verification passed cleanly.');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
