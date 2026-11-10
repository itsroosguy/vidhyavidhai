import crypto from 'node:crypto';

export const ALLOWLISTED_SUPER_ADMINS = [
  { userId: 'SA_BRINTHA', name: 'Brintha Jayaprakash', email: 'brinthajayaprakash888@gmail.com' },
  { userId: 'SA_KARUNYA', name: 'Karunya', email: 'karunya@vidhyavidhai.org' },
];

export const DEFAULT_TARGET_SPREADSHEET_ID = '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE';
export const DEFAULT_TARGET_SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0';

const SESSION_COOKIE_NAME = 'ct_sheets_session';
const OAUTH_STATE_COOKIE_NAME = 'ct_sheets_oauth_state';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB guard

export const SHEETS_SCHEMA_DEFINITIONS = [
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
      'block',
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
  },
  {
    name: 'Facilitators',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
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
      'block',
      'pin_code',
      'active',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'Configuration',
    headers: ['config_key', 'config_value_json', 'updated_at', 'updated_by'],
  },
  {
    name: 'Admin Users',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
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
  },
];

export function isAllowlistedSuperAdminEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  return ALLOWLISTED_SUPER_ADMINS.some((sa) => sa.email === clean);
}

export function findAllowlistedSuperAdmin(email) {
  const clean = String(email || '').trim().toLowerCase();
  return ALLOWLISTED_SUPER_ADMINS.find((sa) => sa.email === clean) || null;
}

export function parseSpreadsheetId(urlOrId) {
  const raw = String(urlOrId || '').trim();
  if (!raw) return '';
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{10,})/.exec(raw);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{10,120}$/.test(raw)) return raw;
  return '';
}

function deriveEncryptionKey(secret) {
  if (!secret || String(secret).trim().length < 16) {
    return null;
  }
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function encryptCookiePayload(obj, secret) {
  const key = deriveEncryptionKey(secret);
  if (!key) {
    throw new Error('SHEETS_TOKEN_SECRET missing or shorter than 16 characters.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptCookiePayload(token, secret) {
  const key = deriveEncryptionKey(secret);
  if (!key || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const pair of String(cookieHeader).split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) map[k] = decodeURIComponent(v);
  }
  return map;
}

function formatCookie(name, value, { maxAgeSeconds = 60 * 60 * 24 * 30, secure = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (typeof maxAgeSeconds === 'number') parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function sendJson(res, statusCode, body, cookiesToSet = []) {
  if (cookiesToSet.length > 0) {
    res.setHeader('Set-Cookie', cookiesToSet);
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendRedirect(res, location, cookiesToSet = []) {
  if (cookiesToSet.length > 0) {
    res.setHeader('Set-Cookie', cookiesToSet);
  }
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request payload exceeds maximum limit.'), { statusCode: 413, apiCode: 'PAYLOAD_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function resolveBaseOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

function isSecureRequest(req) {
  const origin = resolveBaseOrigin(req);
  return origin.startsWith('https://');
}

function a1Tab(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function sanitizePublicConnectionState(session, oauthConfigured) {
  if (!session || !session.spreadsheetId) {
    return {
      connected: false,
      authMethod: 'google_oauth',
      oauthConfigured,
      connectedAccount: session?.connectedAccount || '',
      spreadsheetId: '',
      spreadsheetName: '',
      spreadsheetUrl: '',
      connectedAt: '',
      connectedBy: '',
      lastSyncedAt: session?.lastSyncedAt || '',
      lastSyncStatus: session?.lastSyncStatus || 'IDLE',
      lastSyncMessage: session?.lastSyncMessage || '',
      initializedTabs: [],
      defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
      defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
    };
  }

  return {
    connected: true,
    authMethod: 'google_oauth',
    oauthConfigured,
    connectedAccount: session.connectedAccount || '',
    spreadsheetId: session.spreadsheetId,
    spreadsheetName: session.spreadsheetName || 'Career Tours Spreadsheet',
    spreadsheetUrl:
      session.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${session.spreadsheetId}/edit`,
    connectedAt: session.connectedAt || '',
    connectedBy: session.connectedBy || '',
    lastSyncedAt: session.lastSyncedAt || '',
    lastSyncStatus: session.lastSyncStatus || 'IDLE',
    lastSyncMessage: session.lastSyncMessage || '',
    initializedTabs: Array.isArray(session.initializedTabs) ? session.initializedTabs : [],
    defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
    defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
  };
}

export function createSheetsHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  async function verifyIdTokenHeader(authHeader, clientId) {
    if (!authHeader || !String(authHeader).startsWith('Bearer ')) return null;
    const idToken = String(authHeader).slice('Bearer '.length).trim();
    if (!idToken || !clientId) return null;
    const res = await fetchImpl(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) return null;
    const claims = await res.json();
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      String(claims.aud || '') !== clientId ||
      String(claims.email_verified) !== 'true' ||
      Number(claims.exp || 0) <= nowSec ||
      !isAllowlistedSuperAdminEmail(claims.email)
    ) {
      return null;
    }
    return String(claims.email).trim().toLowerCase();
  }

  async function ensureFreshAccessToken(session, clientId, clientSecret) {
    if (!session || !session.accessToken) {
      throw Object.assign(new Error('Google OAuth authorization required.'), {
        statusCode: 401,
        apiCode: 'OAUTH_REQUIRED',
      });
    }
    const now = Date.now();
    if (!session.expiresAt || session.expiresAt - now > 60_000) {
      return { session, refreshed: false };
    }
    if (!session.refreshToken) {
      throw Object.assign(new Error('Google OAuth session expired. Please reconnect your Google account.'), {
        statusCode: 401,
        apiCode: 'OAUTH_EXPIRED',
      });
    }

    const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: session.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!tokenRes.ok) {
      throw Object.assign(new Error('Failed to refresh Google OAuth token. Please reconnect your Google account.'), {
        statusCode: 401,
        apiCode: 'OAUTH_REFRESH_FAILED',
      });
    }

    const refreshedTokens = await tokenRes.json();
    const updatedSession = {
      ...session,
      accessToken: refreshedTokens.access_token || session.accessToken,
      expiresAt: Date.now() + Number(refreshedTokens.expires_in || 3600) * 1000,
    };
    return { session: updatedSession, refreshed: true };
  }

  async function googleApiJson(url, accessToken, options = {}) {
    const res = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const apiMsg = parsed?.error?.message || `Google API returned HTTP ${res.status}`;
      const err = new Error(apiMsg);
      err.statusCode = res.status === 403 ? 403 : res.status === 404 ? 404 : 502;
      err.apiCode = res.status === 403 ? 'SHEET_ACCESS_DENIED' : 'GOOGLE_API_ERROR';
      throw err;
    }
    return parsed;
  }

  async function initializeSpreadsheetSchema(spreadsheetId, accessToken, actorEmail) {
    const meta = await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets(properties(sheetId,title))`,
      accessToken,
    );

    const existingTitles = new Set((meta.sheets || []).map((s) => s.properties?.title).filter(Boolean));
    const missingDefs = SHEETS_SCHEMA_DEFINITIONS.filter((d) => !existingTitles.has(d.name));

    if (missingDefs.length > 0) {
      await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            requests: missingDefs.map((d) => ({
              addSheet: {
                properties: {
                  title: d.name,
                  gridProperties: { frozenRowCount: 1 },
                },
              },
            })),
          }),
        },
      );
    }

    // Write row 1 headers cleanly ONLY if row 1 is currently empty (never erase user rows)
    const headerRanges = SHEETS_SCHEMA_DEFINITIONS.map((d) => `${a1Tab(d.name)}!1:1`);
    const existingHeaderData = await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values:batchGet?${headerRanges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')}`,
      accessToken,
    );

    const updates = [];
    (existingHeaderData.valueRanges || []).forEach((vr, idx) => {
      const def = SHEETS_SCHEMA_DEFINITIONS[idx];
      const firstRow = (vr.values && vr.values[0]) || [];
      if (!firstRow[0] || String(firstRow[0]).trim() === '') {
        updates.push({
          range: `${a1Tab(def.name)}!A1`,
          values: [def.headers],
        });
      }
    });

    if (updates.length > 0) {
      await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            valueInputOption: 'RAW',
            data: updates,
          }),
        },
      );
    }

    // Idempotently ensure the two protected Super Admin accounts exist in Admin Users
    const adminCheck = await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Admin Users')}!C2:C`)}`,
      accessToken,
    );
    const existingAdminEmails = new Set(
      (adminCheck.values || []).flat().map((e) => String(e || '').trim().toLowerCase()),
    );
    const nowIso = new Date().toISOString();
    const missingAdmins = ALLOWLISTED_SUPER_ADMINS.filter((sa) => !existingAdminEmails.has(sa.email));
    if (missingAdmins.length > 0) {
      await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Admin Users')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            values: missingAdmins.map((sa) => [
              sa.userId,
              sa.name,
              sa.email,
              'super_admin',
              'true',
              nowIso,
              nowIso,
              'APPROVED',
            ]),
          }),
        },
      );
    }

    // Seed missing Configuration keys idempotently without overwriting existing admin config
    const cfgCheck = await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A2:A`)}`,
      accessToken,
    );
    const existingCfgKeys = new Set(
      (cfgCheck.values || []).flat().map((k) => String(k || '').trim()),
    );
    const defaultCfgPairs = [
      ['programme_timezone', 'Asia/Kolkata'],
      ['state_name', 'Tamil Nadu'],
      ['allowed_districts', ['Cuddalore', 'Nagapattinam', 'Sivaganga']],
      ['grade_options', ['8', '9', '10', '11', '12']],
      ['section_options', ['A', 'B', 'C', 'D', 'E', 'F', 'No section']],
      ['school_year', '2026-27'],
    ];
    const missingCfgRows = defaultCfgPairs
      .filter(([k]) => !existingCfgKeys.has(k))
      .map(([k, v]) => [k, JSON.stringify(v), nowIso, actorEmail]);
    if (missingCfgRows.length > 0) {
      await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ values: missingCfgRows }),
        },
      );
    }

    // Append initial audit event safely
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Audit Log')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          values: [
            [
              `AUD_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
              nowIso,
              findAllowlistedSuperAdmin(actorEmail)?.userId || 'SA_ADMIN',
              actorEmail,
              'CONNECT_GOOGLE_SHEET',
              'Configuration',
              spreadsheetId,
              '',
              `Connected & initialized schema in "${meta.properties?.title || spreadsheetId}"`,
              'SUCCESS',
            ],
          ],
        }),
      },
    );

    return {
      spreadsheetId: meta.spreadsheetId || spreadsheetId,
      spreadsheetName: meta.properties?.title || 'Career Tours Spreadsheet',
      spreadsheetUrl:
        meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      initializedTabs: SHEETS_SCHEMA_DEFINITIONS.map((d) => d.name),
    };
  }

  return async function handleSheetsRequest(req, res) {
    const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
    const tokenSecret = String(env.SHEETS_TOKEN_SECRET || '').trim();
    const oauthConfigured = Boolean(clientId && clientSecret && tokenSecret.length >= 16);
    const secureCookie = isSecureRequest(req);

    const requestUrl = new URL(req.url || '/api/sheets', resolveBaseOrigin(req));
    const action = requestUrl.searchParams.get('action') || '';
    const cookies = parseCookies(req.headers.cookie);

    if (req.method === 'GET') {
      if (action === 'status') {
        const session = oauthConfigured
          ? decryptCookiePayload(cookies[SESSION_COOKIE_NAME], tokenSecret)
          : null;
        return sendJson(res, 200, {
          ok: true,
          data: sanitizePublicConnectionState(session, oauthConfigured),
        });
      }

      if (action === 'oauthStart') {
        if (!oauthConfigured) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=oauth_not_configured',
          );
        }
        const state = crypto.randomBytes(24).toString('base64url');
        const redirectUri = `${resolveBaseOrigin(req)}/api/sheets?action=oauthCallback`;
        const hintEmail = String(requestUrl.searchParams.get('login_hint') || '').trim().toLowerCase();
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope:
            'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly',
          access_type: 'offline',
          prompt: 'consent',
          state,
        });
        if (hintEmail && isAllowlistedSuperAdminEmail(hintEmail)) {
          params.set('login_hint', hintEmail);
        }
        const encryptedState = encryptCookiePayload(
          { state, createdAt: Date.now() },
          tokenSecret,
        );
        return sendRedirect(
          res,
          `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          [formatCookie(OAUTH_STATE_COOKIE_NAME, encryptedState, { maxAgeSeconds: 600, secure: secureCookie })],
        );
      }

      if (action === 'oauthCallback') {
        const clearStateCookie = formatCookie(OAUTH_STATE_COOKIE_NAME, '', {
          maxAgeSeconds: 0,
          secure: secureCookie,
        });
        if (!oauthConfigured) {
          return sendRedirect(res, '/admin/overview?sheets_oauth=error&reason=oauth_not_configured', [
            clearStateCookie,
          ]);
        }

        const oauthErr = requestUrl.searchParams.get('error');
        if (oauthErr) {
          return sendRedirect(
            res,
            `/admin/overview?sheets_oauth=error&reason=${encodeURIComponent(oauthErr)}`,
            [clearStateCookie],
          );
        }

        const returnedState = requestUrl.searchParams.get('state') || '';
        const code = requestUrl.searchParams.get('code') || '';
        const savedStatePayload = decryptCookiePayload(cookies[OAUTH_STATE_COOKIE_NAME], tokenSecret);
        if (!savedStatePayload || savedStatePayload.state !== returnedState || !code) {
          return sendRedirect(res, '/admin/overview?sheets_oauth=error&reason=invalid_state', [
            clearStateCookie,
          ]);
        }

        const redirectUri = `${resolveBaseOrigin(req)}/api/sheets?action=oauthCallback`;
        const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        if (!tokenRes.ok) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=token_exchange_failed',
            [clearStateCookie],
          );
        }

        const tokens = await tokenRes.json();
        const userRes = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!userRes.ok) {
          return sendRedirect(res, '/admin/overview?sheets_oauth=error&reason=userinfo_failed', [
            clearStateCookie,
          ]);
        }
        const profile = await userRes.json();
        const email = String(profile.email || '').trim().toLowerCase();
        if (!profile.email_verified || !isAllowlistedSuperAdminEmail(email)) {
          return sendRedirect(res, '/admin/overview?sheets_oauth=error&reason=unauthorized_admin', [
            clearStateCookie,
          ]);
        }

        const existingSession =
          decryptCookiePayload(cookies[SESSION_COOKIE_NAME], tokenSecret) || {};
        const nextSession = {
          ...existingSession,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existingSession.refreshToken || '',
          expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
          connectedAccount: email,
        };
        const encryptedSession = encryptCookiePayload(nextSession, tokenSecret);

        return sendRedirect(res, '/admin/overview?sheets_oauth=authorized', [
          clearStateCookie,
          formatCookie(SESSION_COOKIE_NAME, encryptedSession, { secure: secureCookie }),
        ]);
      }

      return sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: 'Unknown GET action.' });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' });
    }

    if (!oauthConfigured) {
      return sendJson(res, 503, {
        ok: false,
        code: 'SERVER_MISCONFIGURED',
        error:
          'Google OAuth 2.0 server credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SHEETS_TOKEN_SECRET) are not configured on the backend.',
      });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, {
        ok: false,
        code: err.apiCode || 'BAD_REQUEST',
        error: err.message || 'Invalid JSON body.',
      });
    }

    const postAction = String(body.action || action || '').trim();
    const rawSession = decryptCookiePayload(cookies[SESSION_COOKIE_NAME], tokenSecret);
    const idTokenEmail = await verifyIdTokenHeader(req.headers.authorization, clientId);
    const actorEmail =
      (rawSession?.connectedAccount && isAllowlistedSuperAdminEmail(rawSession.connectedAccount)
        ? rawSession.connectedAccount
        : '') || idTokenEmail;

    if (!actorEmail || !isAllowlistedSuperAdminEmail(actorEmail)) {
      return sendJson(res, 403, {
        ok: false,
        code: 'FORBIDDEN',
        error: 'Only approved Super Administrators may manage Google Sheets connections.',
      });
    }

    try {
      if (postAction === 'disconnect') {
        if (rawSession?.accessToken) {
          // Best-effort token revocation on Google side
          await fetchImpl(
            `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rawSession.accessToken)}`,
            { method: 'POST' },
          ).catch(() => undefined);
        }
        const cleared = formatCookie(SESSION_COOKIE_NAME, '', {
          maxAgeSeconds: 0,
          secure: secureCookie,
        });
        return sendJson(
          res,
          200,
          { ok: true, data: sanitizePublicConnectionState(null, oauthConfigured) },
          [cleared],
        );
      }

      const { session, refreshed } = await ensureFreshAccessToken(rawSession, clientId, clientSecret);
      const pendingCookies = [];
      const persistSession = (next) => {
        pendingCookies.push(
          formatCookie(SESSION_COOKIE_NAME, encryptCookiePayload(next, tokenSecret), {
            secure: secureCookie,
          }),
        );
      };

      if (postAction === 'listSpreadsheets') {
        const driveRes = await googleApiJson(
          "https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'+and+trashed%3Dfalse&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime+desc&pageSize=25",
          session.accessToken,
        );
        if (refreshed) persistSession(session);
        return sendJson(
          res,
          200,
          {
            ok: true,
            data: (driveRes.files || []).map((f) => ({
              spreadsheetId: f.id,
              name: f.name,
              url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
              modifiedTime: f.modifiedTime || '',
            })),
          },
          pendingCookies,
        );
      }

      if (postAction === 'connect') {
        const spreadsheetId = parseSpreadsheetId(body.spreadsheetUrlOrId || DEFAULT_TARGET_SPREADSHEET_ID);
        if (!spreadsheetId) {
          return sendJson(res, 400, {
            ok: false,
            code: 'INVALID_SPREADSHEET_ID',
            error: 'Please provide a valid Google Spreadsheet URL or ID.',
          });
        }
        const info = await initializeSpreadsheetSchema(spreadsheetId, session.accessToken, actorEmail);
        const nowIso = new Date().toISOString();
        const updatedSession = {
          ...session,
          spreadsheetId: info.spreadsheetId,
          spreadsheetName: info.spreadsheetName,
          spreadsheetUrl: info.spreadsheetUrl,
          initializedTabs: info.initializedTabs,
          connectedAt: nowIso,
          connectedBy: actorEmail,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: 'Connected and verified 8 schema tabs cleanly.',
        };
        persistSession(updatedSession);
        return sendJson(
          res,
          200,
          { ok: true, data: sanitizePublicConnectionState(updatedSession, oauthConfigured) },
          pendingCookies,
        );
      }

      if (postAction === 'create') {
        const title = String(body.title || 'Vidhya Vidhai · Career Tours Database').trim();
        if (!title) {
          return sendJson(res, 400, {
            ok: false,
            code: 'INVALID_TITLE',
            error: 'Spreadsheet name is required.',
          });
        }
        const created = await googleApiJson(
          'https://sheets.googleapis.com/v4/spreadsheets',
          session.accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              properties: { title, timeZone: 'Asia/Kolkata' },
              sheets: SHEETS_SCHEMA_DEFINITIONS.map((d) => ({
                properties: { title: d.name, gridProperties: { frozenRowCount: 1 } },
              })),
            }),
          },
        );
        const info = await initializeSpreadsheetSchema(created.spreadsheetId, session.accessToken, actorEmail);
        const nowIso = new Date().toISOString();
        const updatedSession = {
          ...session,
          spreadsheetId: info.spreadsheetId,
          spreadsheetName: info.spreadsheetName,
          spreadsheetUrl: info.spreadsheetUrl,
          initializedTabs: info.initializedTabs,
          connectedAt: nowIso,
          connectedBy: actorEmail,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: `Created "${info.spreadsheetName}" with 8 schema tabs.`,
        };
        persistSession(updatedSession);
        return sendJson(
          res,
          200,
          { ok: true, data: sanitizePublicConnectionState(updatedSession, oauthConfigured) },
          pendingCookies,
        );
      }

      if (postAction === 'sync') {
        if (!session.spreadsheetId) {
          return sendJson(res, 400, {
            ok: false,
            code: 'NOT_CONNECTED',
            error: 'Connect a Google Spreadsheet before syncing programme data.',
          });
        }

        const existingKeysRes = await googleApiJson(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            session.spreadsheetId,
          )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!A2:C`)}`,
          session.accessToken,
        );
        const seenRecordIds = new Set();
        const seenSessionIds = new Set();
        const seenClientKeys = new Set();
        for (const r of existingKeysRes.values || []) {
          if (r[0]) seenRecordIds.add(String(r[0]).trim());
          if (r[1]) seenSessionIds.add(String(r[1]).trim());
          if (r[2]) seenClientKeys.add(String(r[2]).trim());
        }

        const incomingSessions = Array.isArray(body.sessions) ? body.sessions : [];
        const sessionRowsToAppend = [];
        const detailRowsToAppend = [];
        let skippedDuplicates = 0;

        for (const s of incomingSessions) {
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
          sessionRowsToAppend.push([
            rId,
            sId,
            cKey,
            s.facilitatorName || '',
            s.facilitatorEmail || '',
            s.facilitatorUserId || '',
            s.tourId || '',
            s.tourName || '',
            s.videoId || '',
            s.language || '',
            s.startDate || '',
            s.endDate || '',
            s.startTime || '',
            s.endTime || '',
            s.durationMinutes ?? 0,
            s.durationFormatted || '',
            s.reportingMonth || '',
            s.submissionTimestamp || '',
            s.submissionDateFormatted || '',
            s.schoolName || '',
            String(s.udiseCode || ''),
            s.schoolType || '',
            s.state || '',
            s.district || '',
            s.block || '',
            String(s.pinCode || ''),
            s.sessionType || '',
            s.totalClasses ?? 1,
            s.totalStudentsPresent ?? 0,
            s.totalQuestionAResponses ?? 0,
            s.totalQuestionBResponses ?? 0,
            s.overallCsat ?? '',
            s.overallItp ?? '',
            s.teacherScore ?? '',
            s.teacherClassification || '',
            s.teacherNps ?? 0,
            s.submissionStatus || 'COMMITTED',
            s.createdAt || '',
            s.updatedAt || '',
            s.createdBy || '',
            s.updatedBy || '',
            s.archived ? 'true' : 'false',
          ]);
          for (const d of s.details || []) {
            detailRowsToAppend.push([
              d.detailRecordId || '',
              s.sessionRecordId || '',
              s.sessionId || '',
              String(d.grade || ''),
              String(d.section || ''),
              d.studentsPresent ?? 0,
              d.questionAScore5 ?? 0,
              d.questionAScore4 ?? 0,
              d.questionAScore3 ?? 0,
              d.questionAScore2 ?? 0,
              d.questionAScore1 ?? 0,
              d.questionATotal ?? 0,
              d.questionAWeightedScore ?? 0,
              d.csat ?? '',
              d.questionBScore5 ?? 0,
              d.questionBScore4 ?? 0,
              d.questionBScore3 ?? 0,
              d.questionBScore2 ?? 0,
              d.questionBScore1 ?? 0,
              d.questionBTotal ?? 0,
              d.questionBWeightedScore ?? 0,
              d.itp ?? '',
              d.createdAt || s.createdAt || '',
              d.updatedAt || s.updatedAt || '',
            ]);
          }
          if (rId) seenRecordIds.add(rId);
          seenSessionIds.add(sId);
          if (cKey) seenClientKeys.add(cKey);
        }

        if (sessionRowsToAppend.length > 0) {
          await googleApiJson(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              session.spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            session.accessToken,
            { method: 'POST', body: JSON.stringify({ values: sessionRowsToAppend }) },
          );
        }
        if (detailRowsToAppend.length > 0) {
          await googleApiJson(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              session.spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Session Details')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            session.accessToken,
            { method: 'POST', body: JSON.stringify({ values: detailRowsToAppend }) },
          );
        }

        const nowIso = new Date().toISOString();
        const message =
          sessionRowsToAppend.length > 0
            ? `Synced ${sessionRowsToAppend.length} session(s); skipped ${skippedDuplicates} existing duplicate(s).`
            : `Verified ${seenRecordIds.size} session(s) up to date (0 duplicates written).`;

        await googleApiJson(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            session.spreadsheetId,
          )}/values/${encodeURIComponent(`${a1Tab('Sync Log')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          session.accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              values: [
                [
                  `SYNC_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
                  nowIso,
                  'BULK_SYNC',
                  session.spreadsheetId,
                  'ALL',
                  actorEmail,
                  'syncAllToGoogleSheet',
                  1,
                  'SYNCED',
                  '',
                ],
              ],
            }),
          },
        );

        const updatedSession = {
          ...session,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: message,
        };
        persistSession(updatedSession);
        return sendJson(
          res,
          200,
          {
            ok: true,
            data: {
              syncedCount: sessionRowsToAppend.length,
              skippedDuplicates,
              totalSheetSessions: seenRecordIds.size,
              syncedAt: nowIso,
              message,
            },
          },
          pendingCookies,
        );
      }

      return sendJson(res, 400, {
        ok: false,
        code: 'UNKNOWN_ACTION',
        error: `Unknown action: ${postAction}`,
      });
    } catch (err) {
      return sendJson(res, err.statusCode || 500, {
        ok: false,
        code: err.apiCode || 'INTERNAL_ERROR',
        error: err.message || 'Unexpected error communicating with Google Sheets API.',
      });
    }
  };
}

export default createSheetsHandler();
