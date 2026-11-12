import { INITIAL_SUPER_ADMINS, isAllowlistedSuperAdmin } from '../config/accessControl';
import {
  DEFAULT_TARGET_SPREADSHEET_ID,
  DEFAULT_TARGET_SPREADSHEET_URL,
} from '../config/defaults';
import type {
  GoogleSheetsConnectionState,
  TeamIntakeConfig,
  UserProfile,
} from '../types/domain';
import { withBasePath } from '../utils/routes';
import { mirrorKeyToIndexedDb } from './durableStorage';

export interface RuntimeBackendConfig {
  appsScriptUrl: string;
  googleClientId: string;
  configuredAt: string;
  configuredBy: string;
}

export interface AppsScriptBridgeConfig {
  appsScriptUrl: string;
  syncKey: string;
  configuredBy: string;
  configuredAt: string;
}

export interface AuthEnvironmentConfig {
  appsScriptUrl: string;
  googleClientId: string;
  directGoogleClientId: string;
  sheetsBackendUrl: string;
  isLiveBackendConfigured: boolean;
  hasBuildTimeConfig: boolean;
  isRuntimeConfigured: boolean;
  runtimeConfiguredAt?: string;
  runtimeConfiguredBy?: string;
}

export interface RecentGoogleAccount {
  email: string;
  name: string;
  lastUsedAt: string;
  role?: 'super_admin' | 'facilitator';
}

export interface ActiveGoogleHint {
  email: string;
  googleClientId: string;
  updatedAt: string;
}

export const RECENT_GOOGLE_ACCOUNTS_KEY = 'ct_recent_google_accounts_v1';
export const ACTIVE_SANDBOX_SESSION_EMAIL_KEY = 'ct_active_sandbox_email_v1';
export const ACTIVE_GOOGLE_HINT_KEY = 'ct_active_google_hint_v1';
export const SHEETS_BACKEND_URL_KEY = 'ct_sheets_backend_url_v1';
export const DIRECT_GOOGLE_CLIENT_ID_KEY = 'ct_direct_google_client_id_v1';
export const APPS_SCRIPT_BRIDGE_KEY = 'ct_apps_script_bridge_v1';
export const TEAM_INTAKE_CONFIG_KEY = 'ct_team_intake_config_v1';
export const MAX_RECENT_GOOGLE_ACCOUNTS = 50;
const ACTIVE_GOOGLE_SESSION_KEY = 'ct_active_google_session_v1';
const CACHED_SHEETS_CONN_PREFIX = 'ct_sheets_conn_meta_v1_';
const RUNTIME_BACKEND_CONFIG_KEY = 'ct_live_backend_config_v1';
const OAUTH_STATE_SESSION_KEY = 'ct_google_oauth_state_v1';
const OAUTH_NONCE_SESSION_KEY = 'ct_google_oauth_nonce_v1';

function loadSavedSheetsBackendUrl(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    const raw = (localStorage.getItem(SHEETS_BACKEND_URL_KEY) ?? '').trim();
    if (!raw) return '';
    const check = validateSheetsBackendUrl(raw);
    return check.valid ? check.normalized : '';
  } catch {
    return '';
  }
}

let runtimeSheetsBackendUrl = '';
const sheetsConnectionListeners = new Set<() => void>();

function notifySheetsConnectionListeners(): void {
  for (const listener of sheetsConnectionListeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

export function setRuntimeSheetsBackendUrl(url: string, persist = false): void {
  const clean = url.trim().replace(/\/$/, '');
  runtimeSheetsBackendUrl = clean;
  if (persist && typeof localStorage !== 'undefined') {
    try {
      if (!clean) {
        localStorage.removeItem(SHEETS_BACKEND_URL_KEY);
      } else {
        const check = validateSheetsBackendUrl(clean);
        if (check.valid) {
          runtimeSheetsBackendUrl = check.normalized;
          localStorage.setItem(SHEETS_BACKEND_URL_KEY, check.normalized);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }
}

export function clearRuntimeSheetsBackendUrl(): void {
  runtimeSheetsBackendUrl = '';
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(SHEETS_BACKEND_URL_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

export function getRuntimeSheetsBackendUrl(): string {
  return runtimeSheetsBackendUrl || loadSavedSheetsBackendUrl();
}

export function loadDirectGoogleClientId(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    const raw = (localStorage.getItem(DIRECT_GOOGLE_CLIENT_ID_KEY) ?? '').trim();
    if (!raw) return '';
    const check = validateGoogleOAuthClientId(raw);
    return check.valid ? check.normalized : '';
  } catch {
    return '';
  }
}

export function saveDirectGoogleClientId(rawClientId: string): string {
  const check = validateGoogleOAuthClientId(rawClientId);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid Google OAuth 2.0 Web Client ID.');
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(DIRECT_GOOGLE_CLIENT_ID_KEY, check.normalized);
    } catch {
      // Ignore storage errors
    }
  }
  return check.normalized;
}

export function clearDirectGoogleClientId(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(DIRECT_GOOGLE_CLIENT_ID_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

export function subscribeSheetsConnection(listener: () => void): () => void {
  sheetsConnectionListeners.add(listener);
  return () => {
    sheetsConnectionListeners.delete(listener);
  };
}

const APPS_SCRIPT_EXEC_PATTERN =
  /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/)?macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
const GOOGLE_CLIENT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{6,140}\.apps\.googleusercontent\.com$/;

function randomHexToken(byteCount = 16): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export function buildGoogleOAuthRedirectUrl(
  googleClientId: string,
  loginHint?: string,
): string {
  const state = randomHexToken(16);
  const nonce = randomHexToken(16);
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(OAUTH_STATE_SESSION_KEY, state);
    sessionStorage.setItem(OAUTH_NONCE_SESSION_KEY, nonce);
  }
  const redirectUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}${withBasePath('/auth/callback')}`
      : '/auth/callback';

  const cleanHint = (loginHint ?? '').trim().toLowerCase();
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    ...(cleanHint ? { login_hint: cleanHint } : { prompt: 'select_account' }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function consumeGoogleOAuthCallbackHash():
  | { kind: 'id_token'; idToken: string }
  | { kind: 'error'; message: string }
  | null {
  if (typeof window === 'undefined') return null;
  const rawHash = window.location.hash.replace(/^#/, '');
  const rawSearch = window.location.search.replace(/^\?/, '');
  const params = new URLSearchParams(rawHash || rawSearch);
  const idToken = params.get('id_token');
  const returnedState = params.get('state');
  const oauthError = params.get('error');
  const oauthErrorDescription = params.get('error_description');

  if (!idToken && !oauthError) return null;

  // Strip OAuth response parameters from the browser address bar immediately
  window.history.replaceState(null, '', window.location.pathname);

  const expectedState =
    typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(OAUTH_STATE_SESSION_KEY)
      : null;
  const expectedNonce =
    typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(OAUTH_NONCE_SESSION_KEY)
      : null;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(OAUTH_STATE_SESSION_KEY);
    sessionStorage.removeItem(OAUTH_NONCE_SESSION_KEY);
  }

  if (oauthError) {
    return {
      kind: 'error',
      message:
        oauthError === 'access_denied'
          ? 'Google sign-in was cancelled before completion.'
          : oauthErrorDescription || `Google sign-in failed (${oauthError}).`,
    };
  }

  if (expectedState && returnedState !== expectedState) {
    return {
      kind: 'error',
      message: 'Google sign-in state verification failed. Please initiate sign-in again.',
    };
  }

  if (!idToken) return null;
  const claims = decodeJwtClaimsUnsafe(idToken) as { nonce?: string } | null;
  if (expectedNonce && claims?.nonce && claims.nonce !== expectedNonce) {
    return {
      kind: 'error',
      message: 'Google sign-in nonce mismatch. Please initiate sign-in again.',
    };
  }

  return { kind: 'id_token', idToken };
}

export function loadRecentGoogleAccounts(): RecentGoogleAccount[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_GOOGLE_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentGoogleAccount =>
          Boolean(
            item &&
              typeof item.email === 'string' &&
              item.email.trim().length > 0 &&
              typeof item.name === 'string' &&
              typeof item.lastUsedAt === 'string',
          ),
      )
      .map((item) => ({
        email: item.email.trim().toLowerCase(),
        name: item.name.trim() || item.email.trim().toLowerCase(),
        lastUsedAt: item.lastUsedAt,
        ...(item.role === 'super_admin' || item.role === 'facilitator' ? { role: item.role } : {}),
      }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, MAX_RECENT_GOOGLE_ACCOUNTS);
  } catch {
    return [];
  }
}

export function rememberRecentGoogleAccount(account: {
  email: string;
  name: string;
  role?: 'super_admin' | 'facilitator';
}): void {
  if (typeof localStorage === 'undefined') return;
  const cleanEmail = account.email.trim().toLowerCase();
  if (!cleanEmail) return;
  const cleanName = account.name.trim() || cleanEmail.split('@')[0] || cleanEmail;
  const existing = loadRecentGoogleAccounts().find((item) => item.email.toLowerCase() === cleanEmail);
  const resolvedRole = account.role ?? existing?.role;
  const next: RecentGoogleAccount[] = [
    {
      email: cleanEmail,
      name: cleanName,
      lastUsedAt: new Date().toISOString(),
      ...(resolvedRole ? { role: resolvedRole } : {}),
    },
    ...loadRecentGoogleAccounts().filter((item) => item.email.toLowerCase() !== cleanEmail),
  ].slice(0, MAX_RECENT_GOOGLE_ACCOUNTS);
  try {
    localStorage.setItem(RECENT_GOOGLE_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export function forgetRecentGoogleAccount(email: string): RecentGoogleAccount[] {
  if (typeof localStorage === 'undefined') return [];
  const cleanEmail = email.trim().toLowerCase();
  const next = loadRecentGoogleAccounts().filter((item) => item.email.toLowerCase() !== cleanEmail);
  try {
    localStorage.setItem(RECENT_GOOGLE_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}

/**
 * Stores ONLY the non-secret signed-in Google email hint across tabs/browser restarts
 * so new tabs or relaunched browsers can restore the user's session via silent GIS refresh
 * without ever writing ID tokens or OAuth credentials into localStorage.
 */
export function saveActiveGoogleHint(email: string, googleClientId: string): void {
  if (typeof localStorage === 'undefined') return;
  const cleanEmail = email.trim().toLowerCase();
  const cleanClientId = googleClientId.trim();
  if (!cleanEmail || !cleanClientId) return;
  try {
    const payload: ActiveGoogleHint = {
      email: cleanEmail,
      googleClientId: cleanClientId,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(ACTIVE_GOOGLE_HINT_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadActiveGoogleHint(googleClientId: string): ActiveGoogleHint | null {
  if (typeof localStorage === 'undefined') return null;
  const cleanClientId = googleClientId.trim();
  if (!cleanClientId) return null;
  try {
    const raw = localStorage.getItem(ACTIVE_GOOGLE_HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveGoogleHint> | null;
    if (
      !parsed ||
      typeof parsed.email !== 'string' ||
      !parsed.email.trim() ||
      parsed.googleClientId !== cleanClientId
    ) {
      return null;
    }
    return {
      email: parsed.email.trim().toLowerCase(),
      googleClientId: parsed.googleClientId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export function clearActiveGoogleHint(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE_GOOGLE_HINT_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

export function loadActiveSandboxEmail(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return (localStorage.getItem(ACTIVE_SANDBOX_SESSION_EMAIL_KEY) ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}

export function saveActiveSandboxEmail(email: string): void {
  if (typeof localStorage === 'undefined') return;
  const clean = email.trim().toLowerCase();
  try {
    if (clean) localStorage.setItem(ACTIVE_SANDBOX_SESSION_EMAIL_KEY, clean);
    else localStorage.removeItem(ACTIVE_SANDBOX_SESSION_EMAIL_KEY);
  } catch {
    // Ignore storage quota errors
  }
}

export function clearActiveSandboxEmail(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE_SANDBOX_SESSION_EMAIL_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function validateAppsScriptWebAppUrl(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const clean = raw.trim();
  if (!clean) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter your Google Apps Script Web App URL ending in /exec.',
    };
  }
  if (/^http:\/\//i.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error: 'Google Apps Script Web App URL must use secure https://.',
    };
  }
  if (clean.includes('?') || clean.includes('#')) {
    return {
      valid: false,
      normalized: '',
      error: 'Remove query parameters or # fragments from the Web App URL (it must end cleanly with /exec).',
    };
  }
  if (/\/dev\/?$/i.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error: 'Use the published deployment URL ending in /exec (not the test /dev URL).',
    };
  }
  if (!APPS_SCRIPT_EXEC_PATTERN.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error:
        'Enter a valid Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec).',
    };
  }
  return { valid: true, normalized: clean };
}

export function validateGoogleOAuthClientId(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const clean = raw.trim();
  if (!clean) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter your Google OAuth 2.0 Web Client ID (.apps.googleusercontent.com).',
    };
  }
  if (/^GOCSPX-/i.test(clean) || /-----BEGIN/i.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error:
        'Do not paste a Google Client Secret (GOCSPX-...) or private key. Enter only the public Web Client ID ending in .apps.googleusercontent.com.',
    };
  }
  if (/\s/.test(clean) || !GOOGLE_CLIENT_ID_PATTERN.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error:
        'Enter a valid Google OAuth 2.0 Web Client ID ending in .apps.googleusercontent.com.',
    };
  }
  return { valid: true, normalized: clean };
}

export function validateSheetsBackendUrl(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const clean = raw.trim().replace(/\/+$/, '');
  if (!clean) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter a hosted Sheets backend URL (for example /api/sheets or https://your-app.vercel.app/api/sheets).',
    };
  }
  if (clean.includes('?') || clean.includes('#')) {
    return {
      valid: false,
      normalized: '',
      error: 'Remove query parameters or # fragments from the /api/sheets URL.',
    };
  }
  if (clean.startsWith('/')) {
    if (!/^\/[A-Za-z0-9/_-]+$/.test(clean)) {
      return {
        valid: false,
        normalized: '',
        error: 'Enter a valid relative backend path such as /api/sheets.',
      };
    }
    return { valid: true, normalized: clean };
  }
  try {
    const u = new URL(clean);
    const isLocalHost =
      u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(isLocalHost && u.protocol === 'http:')) {
      return {
        valid: false,
        normalized: '',
        error: 'Hosted /api/sheets backend URL must use secure https://.',
      };
    }
    return { valid: true, normalized: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
  } catch {
    return {
      valid: false,
      normalized: '',
      error: 'Enter a valid /api/sheets URL (relative /api/sheets or full https://... URL).',
    };
  }
}

export async function probeAppsScriptEndpoint(rawUrl: string): Promise<{
  ok: boolean;
  service?: string;
  status?: string;
  authModes?: string[];
  syncKeyConfigured?: boolean;
  capabilities?: string[];
  error?: string;
}> {
  const check = validateAppsScriptWebAppUrl(rawUrl);
  if (!check.valid) {
    return { ok: false, error: check.error };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout =
    controller && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), 12000)
      : null;

  try {
    const res = await fetch(check.normalized, {
      method: 'GET',
      signal: controller?.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Apps Script Web App returned HTTP ${res.status}. Verify it is deployed with "Execute as: Me" and "Who has access: Anyone".`,
      };
    }

    const rawText = await res.text();
    let parsed: {
      ok?: boolean;
      status?: string;
      service?: string;
      authModes?: string[];
      syncKeyConfigured?: boolean;
      capabilities?: string[];
    } | null = null;
    try {
      parsed = JSON.parse(rawText) as {
        ok?: boolean;
        status?: string;
        service?: string;
        authModes?: string[];
        syncKeyConfigured?: boolean;
        capabilities?: string[];
      };
    } catch {
      parsed = null;
    }

    if (!parsed || parsed.ok !== true || String(parsed.status || '').toUpperCase() !== 'READY') {
      return {
        ok: false,
        error:
          'The URL responded, but did not return the Vidhya Vidhai Career Tours API READY status. Confirm you deployed CareerToursAllInOne.gs (or Code.gs) and set "Who has access: Anyone".',
      };
    }

    return {
      ok: true,
      service: parsed.service,
      status: parsed.status,
      ...(Array.isArray(parsed.authModes) ? { authModes: parsed.authModes } : {}),
      ...(typeof parsed.syncKeyConfigured === 'boolean'
        ? { syncKeyConfigured: parsed.syncKeyConfigured }
        : {}),
      ...(Array.isArray(parsed.capabilities) ? { capabilities: parsed.capabilities } : {}),
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort
        ? 'Timed out waiting for Google Apps Script to respond. Check your connection and Web App permissions.'
        : 'Could not reach the Google Apps Script Web App from this browser. Confirm "Who has access: Anyone" is enabled on your /exec deployment.',
    };
  } finally {
    if (timeout !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeout);
    }
  }
}

export function validateAppsScriptSyncKey(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const clean = raw.trim();
  if (!clean) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter your Sync Passphrase (minimum 16 characters).',
    };
  }
  if (/\s/.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error: 'Remove spaces from the Sync Passphrase.',
    };
  }
  if (clean === '__CT_PRESET_' + 'SYNC_KEY__') {
    return {
      valid: false,
      normalized: '',
      error: 'Generate or enter a custom Sync Passphrase before connecting.',
    };
  }
  if (clean.length < 16) {
    return {
      valid: false,
      normalized: '',
      error: 'Sync Passphrase must be at least 16 characters long.',
    };
  }
  return { valid: true, normalized: clean };
}

export function generateAppsScriptSyncKey(): string {
  return `VV-SYNC-${randomHexToken(10).toUpperCase()}`;
}

export function validateFacilitatorIntakeKey(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const clean = raw.trim();
  if (!clean) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter the Team Submission Key (minimum 16 characters).',
    };
  }
  if (/\s/.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error: 'Remove spaces from the Team Submission Key.',
    };
  }
  if (clean === '__CT_PRESET_' + 'INTAKE_KEY__' || clean === '__CT_PRESET_' + 'SYNC_KEY__') {
    return {
      valid: false,
      normalized: '',
      error: 'Generate a custom Team Submission Key first.',
    };
  }
  if (/^GOCSPX-/i.test(clean) || /-----BEGIN/i.test(clean)) {
    return {
      valid: false,
      normalized: '',
      error: 'Invalid key format.',
    };
  }
  if (clean.length < 16) {
    return {
      valid: false,
      normalized: '',
      error: 'Team Submission Key must be at least 16 characters long.',
    };
  }
  return { valid: true, normalized: clean };
}

export function generateFacilitatorIntakeKey(): string {
  return `VV-TEAM-${randomHexToken(10).toUpperCase()}`;
}

export function loadTeamIntakeConfig(): TeamIntakeConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TEAM_INTAKE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TeamIntakeConfig> | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const urlStr = String(parsed.appsScriptUrl ?? '').trim();
    const keyStr = String(parsed.intakeKey ?? '').trim();
    const clientStr = String(parsed.googleClientId ?? '').trim();

    if (urlStr && keyStr) {
      const urlCheck = validateAppsScriptWebAppUrl(urlStr);
      const keyCheck = validateFacilitatorIntakeKey(keyStr);
      if (!urlCheck.valid || !keyCheck.valid) return null;
      return {
        appsScriptUrl: urlCheck.normalized,
        intakeKey: keyCheck.normalized,
        ...(typeof parsed.label === 'string' && parsed.label.trim()
          ? { label: parsed.label.trim() }
          : {}),
        ...(typeof parsed.configuredBy === 'string' && parsed.configuredBy.trim()
          ? { configuredBy: parsed.configuredBy.trim().toLowerCase() }
          : {}),
        configuredAt: typeof parsed.configuredAt === 'string' ? parsed.configuredAt : '',
      };
    }

    if (urlStr && clientStr) {
      const urlCheck = validateAppsScriptWebAppUrl(urlStr);
      const clientCheck = validateGoogleOAuthClientId(clientStr);
      if (!urlCheck.valid || !clientCheck.valid) return null;
      return {
        appsScriptUrl: urlCheck.normalized,
        googleClientId: clientCheck.normalized,
        ...(typeof parsed.label === 'string' && parsed.label.trim()
          ? { label: parsed.label.trim() }
          : {}),
        configuredAt: typeof parsed.configuredAt === 'string' ? parsed.configuredAt : '',
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function saveTeamIntakeConfig(params: {
  appsScriptUrl?: string;
  intakeKey?: string;
  googleClientId?: string;
  label?: string;
  configuredBy?: string;
}): TeamIntakeConfig {
  const urlCheck = validateAppsScriptWebAppUrl(params.appsScriptUrl ?? '');
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error || 'Invalid submission endpoint URL.');
  }

  let next: TeamIntakeConfig;
  if (params.intakeKey && params.intakeKey.trim()) {
    const keyCheck = validateFacilitatorIntakeKey(params.intakeKey);
    if (!keyCheck.valid) {
      throw new Error(keyCheck.error || 'Invalid Team Submission Key.');
    }
    next = {
      appsScriptUrl: urlCheck.normalized,
      intakeKey: keyCheck.normalized,
      configuredAt: new Date().toISOString(),
      ...(params.label?.trim() ? { label: params.label.trim() } : {}),
      ...(params.configuredBy?.trim()
        ? { configuredBy: params.configuredBy.trim().toLowerCase() }
        : {}),
    };
  } else if (params.googleClientId && params.googleClientId.trim()) {
    const clientCheck = validateGoogleOAuthClientId(params.googleClientId);
    if (!clientCheck.valid) {
      throw new Error(clientCheck.error || 'Invalid Google OAuth Web Client ID.');
    }
    next = {
      appsScriptUrl: urlCheck.normalized,
      googleClientId: clientCheck.normalized,
      configuredAt: new Date().toISOString(),
      ...(params.label?.trim() ? { label: params.label.trim() } : {}),
    };
  } else {
    throw new Error('Either a Team Submission Key or Google OAuth Client ID is required.');
  }

  const serialized = JSON.stringify(next);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(TEAM_INTAKE_CONFIG_KEY, serialized);
  }
  void mirrorKeyToIndexedDb(TEAM_INTAKE_CONFIG_KEY, serialized);
  notifySheetsConnectionListeners();
  return next;
}

export function clearTeamIntakeConfig(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(TEAM_INTAKE_CONFIG_KEY);
    } catch {
      // Ignore storage removal errors
    }
  }
  void mirrorKeyToIndexedDb(TEAM_INTAKE_CONFIG_KEY, null);
  notifySheetsConnectionListeners();
}

function encodeBase64UrlJson(data: unknown): string {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlJson<T>(token: string): T | null {
  try {
    const clean = token.trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!clean) return null;
    const padded = clean.padEnd(Math.ceil(clean.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function buildTeamShareUrl(params: {
  mode: 'intake' | 'oauth';
  appsScriptUrl: string;
  intakeKey?: string;
  googleClientId?: string;
  label?: string;
  baseUrl?: string;
}): string {
  const urlCheck = validateAppsScriptWebAppUrl(params.appsScriptUrl);
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error || 'Invalid Apps Script Web App URL.');
  }
  const baseOriginAndPath =
    params.baseUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}${withBasePath('/login')}`
      : '/login');

  if (params.mode === 'intake') {
    const keyCheck = validateFacilitatorIntakeKey(params.intakeKey ?? '');
    if (!keyCheck.valid) {
      throw new Error(keyCheck.error || 'Invalid Team Submission Key.');
    }
    const token = encodeBase64UrlJson({
      v: 1,
      u: urlCheck.normalized,
      k: keyCheck.normalized,
      ...(params.label?.trim() ? { l: params.label.trim().slice(0, 60) } : {}),
    });
    return `${baseOriginAndPath}#team_intake=${token}`;
  }

  const clientCheck = validateGoogleOAuthClientId(params.googleClientId ?? '');
  if (!clientCheck.valid) {
    throw new Error(clientCheck.error || 'Invalid Google OAuth Web Client ID.');
  }
  const token = encodeBase64UrlJson({
    v: 1,
    u: urlCheck.normalized,
    c: clientCheck.normalized,
    ...(params.label?.trim() ? { l: params.label.trim().slice(0, 60) } : {}),
  });
  return `${baseOriginAndPath}#team_setup=${token}`;
}

export function parseTeamSetupFromLocation(rawInput?: string): {
  applied: boolean;
  mode?: 'intake' | 'oauth';
  config?: TeamIntakeConfig;
  error?: string;
} {
  let fragment = '';
  let query = '';
  const fromBrowserLocation = typeof rawInput !== 'string';

  if (fromBrowserLocation) {
    if (typeof window === 'undefined') return { applied: false };
    fragment = window.location.hash.replace(/^#/, '');
    query = window.location.search.replace(/^\?/, '');
  } else {
    const trimmed = rawInput.trim();
    if (!trimmed) return { applied: false };
    if (trimmed.includes('#')) {
      fragment = trimmed.split('#').slice(1).join('#');
    } else if (trimmed.includes('?')) {
      query = trimmed.split('?').slice(1).join('?');
    } else if (trimmed.startsWith('team_intake=') || trimmed.startsWith('team_setup=')) {
      fragment = trimmed;
    } else if (/^eyJ[A-Za-z0-9_-]+$/.test(trimmed)) {
      fragment = `team_intake=${trimmed}`;
    } else {
      return {
        applied: false,
        error: 'Paste the full Team Submission Link or code shared by your programme administrator.',
      };
    }
  }

  const params = new URLSearchParams(fragment || query);
  const intakeToken = params.get('team_intake');
  const setupToken = params.get('team_setup');

  if (!intakeToken && !setupToken) {
    return {
      applied: false,
      ...(fromBrowserLocation
        ? {}
        : { error: 'No valid Team Submission parameter found in that link.' }),
    };
  }

  if (fromBrowserLocation && typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', window.location.pathname);
  }

  if (intakeToken) {
    const decoded = decodeBase64UrlJson<{ v?: number; u?: string; k?: string; l?: string }>(
      intakeToken,
    );
    if (!decoded || typeof decoded.u !== 'string' || typeof decoded.k !== 'string') {
      return { applied: false, error: 'That Team Submission Link is invalid or incomplete.' };
    }
    try {
      const cfg = saveTeamIntakeConfig({
        appsScriptUrl: decoded.u,
        intakeKey: decoded.k,
        label: typeof decoded.l === 'string' ? decoded.l : 'Central Programme Database',
      });
      return { applied: true, mode: 'intake', config: cfg };
    } catch (err) {
      return {
        applied: false,
        error: err instanceof Error ? err.message : 'Unable to validate Team Submission Link.',
      };
    }
  }

  if (setupToken) {
    const decoded = decodeBase64UrlJson<{ v?: number; u?: string; c?: string; l?: string }>(
      setupToken,
    );
    if (!decoded || typeof decoded.u !== 'string' || typeof decoded.c !== 'string') {
      return { applied: false, error: 'That Team Setup Link is invalid or incomplete.' };
    }
    try {
      saveRuntimeBackendConfig({
        appsScriptUrl: decoded.u,
        googleClientId: decoded.c,
        configuredBy: 'team_setup_link',
      });
      const cfg = saveTeamIntakeConfig({
        appsScriptUrl: decoded.u,
        googleClientId: decoded.c,
        label: typeof decoded.l === 'string' ? decoded.l : 'Central Programme Database',
      });
      return { applied: true, mode: 'oauth', config: cfg };
    } catch (err) {
      return {
        applied: false,
        error: err instanceof Error ? err.message : 'Unable to validate Team Setup Link.',
      };
    }
  }

  return { applied: false };
}

export function loadAppsScriptBridgeConfig(): AppsScriptBridgeConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(APPS_SCRIPT_BRIDGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppsScriptBridgeConfig> | null;
    const urlCheck = validateAppsScriptWebAppUrl(String(parsed?.appsScriptUrl ?? ''));
    const keyCheck = validateAppsScriptSyncKey(String(parsed?.syncKey ?? ''));
    const cleanBy = String(parsed?.configuredBy ?? '').trim().toLowerCase();
    if (!urlCheck.valid || !keyCheck.valid || !isAllowlistedSuperAdmin(cleanBy)) {
      return null;
    }
    return {
      appsScriptUrl: urlCheck.normalized,
      syncKey: keyCheck.normalized,
      configuredBy: cleanBy,
      configuredAt: typeof parsed?.configuredAt === 'string' ? parsed.configuredAt : '',
    };
  } catch {
    return null;
  }
}

export function saveAppsScriptBridgeConfig(params: {
  appsScriptUrl: string;
  syncKey: string;
  configuredBy: string;
}): AppsScriptBridgeConfig {
  const urlCheck = validateAppsScriptWebAppUrl(params.appsScriptUrl);
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error || 'Invalid Google Apps Script Web App URL.');
  }
  const keyCheck = validateAppsScriptSyncKey(params.syncKey);
  if (!keyCheck.valid) {
    throw new Error(keyCheck.error || 'Invalid Sync Bridge Passphrase.');
  }
  const cleanBy = params.configuredBy.trim().toLowerCase();
  if (!isAllowlistedSuperAdmin(cleanBy)) {
    throw new Error('Only allowlisted Super Administrators can configure the Apps Script Bridge.');
  }
  const next: AppsScriptBridgeConfig = {
    appsScriptUrl: urlCheck.normalized,
    syncKey: keyCheck.normalized,
    configuredBy: cleanBy,
    configuredAt: new Date().toISOString(),
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(APPS_SCRIPT_BRIDGE_KEY, JSON.stringify(next));
  }
  notifySheetsConnectionListeners();
  return next;
}

export function clearAppsScriptBridgeConfig(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(APPS_SCRIPT_BRIDGE_KEY);
    } catch {
      // Ignore storage removal errors
    }
  }
  notifySheetsConnectionListeners();
}

export async function verifyAppsScriptSandboxBridge(params: {
  appsScriptUrl: string;
  syncKey: string;
  actorEmail: string;
}): Promise<{
  ok: boolean;
  code?: string;
  connection?: GoogleSheetsConnectionState;
  error?: string;
}> {
  const urlCheck = validateAppsScriptWebAppUrl(params.appsScriptUrl);
  if (!urlCheck.valid) {
    return { ok: false, code: 'INVALID_URL', error: urlCheck.error };
  }
  const keyCheck = validateAppsScriptSyncKey(params.syncKey);
  if (!keyCheck.valid) {
    return { ok: false, code: 'INVALID_SYNC_KEY', error: keyCheck.error };
  }
  const cleanEmail = params.actorEmail.trim().toLowerCase();
  if (!isAllowlistedSuperAdmin(cleanEmail)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      error: 'Only allowlisted Super Administrators can connect the Apps Script Sync Bridge.',
    };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout =
    controller && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), 15000)
      : null;

  try {
    const res = await fetch(urlCheck.normalized, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getSheetsConnection',
        syncKey: keyCheck.normalized,
        actorEmail: cleanEmail,
        payload: { actorEmail: cleanEmail },
      }),
      signal: controller?.signal,
    });
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (!trimmed || trimmed.startsWith('<')) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        error: `Apps Script Web App returned non-JSON response (HTTP ${res.status}). Confirm "Execute as: Me" and "Who has access: Anyone".`,
      };
    }
    const parsed = JSON.parse(trimmed) as {
      ok?: boolean;
      code?: string;
      error?: string;
      data?: Partial<GoogleSheetsConnectionState>;
    };
    if (!parsed || !parsed.ok || !parsed.data) {
      return {
        ok: false,
        code: parsed?.code || 'AUTH_FAILED',
        error:
          parsed?.error ||
          'Apps Script rejected the Sync Passphrase. Run setupForLocalSandbox() in Apps Script and verify SANDBOX_SYNC_KEY.',
      };
    }

    saveAppsScriptBridgeConfig({
      appsScriptUrl: urlCheck.normalized,
      syncKey: keyCheck.normalized,
      configuredBy: cleanEmail,
    });

    return {
      ok: true,
      connection: normalizeCachedSheetsConnection({
        ...parsed.data,
        authMethod: 'apps_script',
        connectionProvider: 'apps_script',
      }),
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      error: isAbort
        ? 'Timed out waiting for Apps Script Web App.'
        : 'Unable to reach Apps Script Web App. Check your /exec URL and deployment permissions.',
    };
  } finally {
    if (timeout !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeout);
    }
  }
}

export function loadRuntimeBackendConfig(): RuntimeBackendConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RUNTIME_BACKEND_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RuntimeBackendConfig>;
    const urlCheck = validateAppsScriptWebAppUrl(String(parsed?.appsScriptUrl ?? ''));
    const clientCheck = validateGoogleOAuthClientId(String(parsed?.googleClientId ?? ''));
    if (!urlCheck.valid || !clientCheck.valid) {
      return null;
    }
    return {
      appsScriptUrl: urlCheck.normalized,
      googleClientId: clientCheck.normalized,
      configuredAt: typeof parsed?.configuredAt === 'string' ? parsed.configuredAt : '',
      configuredBy: typeof parsed?.configuredBy === 'string' ? parsed.configuredBy : '',
    };
  } catch {
    return null;
  }
}

export function saveRuntimeBackendConfig(params: {
  appsScriptUrl: string;
  googleClientId: string;
  configuredBy?: string;
}): RuntimeBackendConfig {
  const urlCheck = validateAppsScriptWebAppUrl(params.appsScriptUrl);
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error || 'Invalid Google Apps Script Web App URL.');
  }
  const clientCheck = validateGoogleOAuthClientId(params.googleClientId);
  if (!clientCheck.valid) {
    throw new Error(clientCheck.error || 'Invalid Google OAuth 2.0 Web Client ID.');
  }
  const next: RuntimeBackendConfig = {
    appsScriptUrl: urlCheck.normalized,
    googleClientId: clientCheck.normalized,
    configuredAt: new Date().toISOString(),
    configuredBy: (params.configuredBy ?? '').trim().toLowerCase(),
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RUNTIME_BACKEND_CONFIG_KEY, JSON.stringify(next));
  }
  return next;
}

export function clearRuntimeBackendConfig(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(RUNTIME_BACKEND_CONFIG_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

export function getAuthEnvironment(): AuthEnvironmentConfig {
  const buildAppsScriptUrl = (import.meta.env.VITE_APPS_SCRIPT_URL ?? '').trim();
  const buildGoogleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
  const buildSheetsBackendUrl = (import.meta.env.VITE_SHEETS_BACKEND_URL ?? '').trim();
  const sheetsBackendUrl =
    buildSheetsBackendUrl || runtimeSheetsBackendUrl || loadSavedSheetsBackendUrl();
  const hasBuildTimeConfig = Boolean(buildAppsScriptUrl && buildGoogleClientId);

  const runtime = hasBuildTimeConfig ? null : loadRuntimeBackendConfig();
  const appsScriptUrl = hasBuildTimeConfig
    ? buildAppsScriptUrl
    : runtime?.appsScriptUrl || buildAppsScriptUrl;
  const googleClientId = hasBuildTimeConfig
    ? buildGoogleClientId
    : runtime?.googleClientId || buildGoogleClientId;
  const directGoogleClientId = loadDirectGoogleClientId() || googleClientId;

  return {
    appsScriptUrl,
    googleClientId,
    directGoogleClientId,
    sheetsBackendUrl,
    isLiveBackendConfigured: Boolean(appsScriptUrl && googleClientId),
    hasBuildTimeConfig,
    isRuntimeConfigured: Boolean(!hasBuildTimeConfig && runtime),
    runtimeConfiguredAt: runtime?.configuredAt,
    runtimeConfiguredBy: runtime?.configuredBy,
  };
}

export async function probeSheetsBackendStatus(
  candidateUrl = '/api/sheets',
): Promise<{
  available: boolean;
  url: string;
  connection?: GoogleSheetsConnectionState;
}> {
  const cleanUrl = candidateUrl.trim().replace(/\/$/, '');
  if (!cleanUrl || typeof fetch !== 'function') {
    return { available: false, url: '' };
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), 5000)
      : null;

  try {
    const res = await fetch(`${cleanUrl}?action=status`, {
      method: 'GET',
      credentials: 'include',
      signal: controller?.signal,
    });
    if (!res.ok) {
      return { available: false, url: '' };
    }
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (!trimmed || trimmed.startsWith('<')) {
      return { available: false, url: '' };
    }
    const parsed = JSON.parse(trimmed) as {
      ok?: boolean;
      data?: GoogleSheetsConnectionState;
    };
    if (
      !parsed ||
      parsed.ok !== true ||
      !parsed.data ||
      typeof parsed.data.oauthConfigured !== 'boolean'
    ) {
      return { available: false, url: '' };
    }
    return {
      available: true,
      url: cleanUrl,
      connection: normalizeCachedSheetsConnection(parsed.data),
    };
  } catch {
    return { available: false, url: '' };
  } finally {
    if (timeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutId);
    }
  }
}

/**
 * Decodes only the non-sensitive display claims of a Google ID token JWT for UI preview.
 * Authoritative signature and audience verification ALWAYS runs on the Apps Script server.
 */
export function decodeJwtClaimsUnsafe(jwt: string): {
  sub?: string;
  email?: string;
  name?: string;
  exp?: number;
} | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const rawBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = rawBase64.padEnd(Math.ceil(rawBase64.length / 4) * 4, '=');
    const json = decodeURIComponent(
      atob(paddedBase64)
        .split('')
        .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join(''),
    );
    return JSON.parse(json) as { sub?: string; email?: string; name?: string; exp?: number };
  } catch {
    return null;
  }
}

export function isJwtTokenUsable(jwt?: string, minRemainingSeconds = 30): boolean {
  if (!jwt || typeof jwt !== 'string') return false;
  const claims = decodeJwtClaimsUnsafe(jwt.trim());
  if (!claims || typeof claims.email !== 'string' || !claims.email.trim()) {
    return false;
  }
  if (typeof claims.exp === 'number') {
    const remainingMs = claims.exp * 1000 - Date.now();
    return remainingMs > minRemainingSeconds * 1000;
  }
  return true;
}

/**
 * Stores live Google ID tokens strictly in sessionStorage (never localStorage, drafts, or SyncOutbox)
 * so reloads preserve an active session within the tab without writing credentials to persistent storage.
 */
export function saveActiveGoogleIdToken(idToken: string, googleClientId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const cleanToken = idToken.trim();
  const cleanClientId = googleClientId.trim();
  if (!cleanToken || !cleanClientId || !isJwtTokenUsable(cleanToken, 10)) return;
  const claims = decodeJwtClaimsUnsafe(cleanToken);
  try {
    sessionStorage.setItem(
      ACTIVE_GOOGLE_SESSION_KEY,
      JSON.stringify({
        idToken: cleanToken,
        googleClientId: cleanClientId,
        email: (claims?.email ?? '').trim().toLowerCase(),
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function loadActiveGoogleIdToken(
  googleClientId: string,
  minRemainingSeconds = 30,
): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  const cleanClientId = googleClientId.trim();
  if (!cleanClientId) return undefined;
  try {
    const raw = sessionStorage.getItem(ACTIVE_GOOGLE_SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as {
      idToken?: string;
      googleClientId?: string;
    } | null;
    if (
      !parsed ||
      typeof parsed.idToken !== 'string' ||
      parsed.googleClientId !== cleanClientId ||
      !isJwtTokenUsable(parsed.idToken, minRemainingSeconds)
    ) {
      clearActiveGoogleIdToken();
      return undefined;
    }
    return parsed.idToken;
  } catch {
    clearActiveGoogleIdToken();
    return undefined;
  }
}

export function clearActiveGoogleIdToken(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ACTIVE_GOOGLE_SESSION_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

function normalizeCachedSheetsConnection(
  conn: Partial<GoogleSheetsConnectionState>,
): GoogleSheetsConnectionState {
  const authMethod =
    conn.authMethod === 'google_oauth' || conn.authMethod === 'apps_script'
      ? conn.authMethod
      : 'local_sandbox';
  const connectionProvider =
    conn.connectionProvider === 'direct_browser' ||
    conn.connectionProvider === 'sheets_backend' ||
    conn.connectionProvider === 'apps_script' ||
    conn.connectionProvider === 'local_sandbox'
      ? conn.connectionProvider
      : undefined;
  return {
    connected: Boolean(conn.connected && conn.spreadsheetId),
    authMethod,
    ...(connectionProvider ? { connectionProvider } : {}),
    oauthConfigured: Boolean(conn.oauthConfigured),
    connectedAccount: typeof conn.connectedAccount === 'string' ? conn.connectedAccount : '',
    spreadsheetId: typeof conn.spreadsheetId === 'string' ? conn.spreadsheetId : '',
    spreadsheetName: typeof conn.spreadsheetName === 'string' ? conn.spreadsheetName : '',
    spreadsheetUrl: typeof conn.spreadsheetUrl === 'string' ? conn.spreadsheetUrl : '',
    connectedAt: typeof conn.connectedAt === 'string' ? conn.connectedAt : '',
    connectedBy: typeof conn.connectedBy === 'string' ? conn.connectedBy : '',
    lastSyncedAt: typeof conn.lastSyncedAt === 'string' ? conn.lastSyncedAt : '',
    lastSyncStatus:
      conn.lastSyncStatus === 'SYNCED' || conn.lastSyncStatus === 'FAILED'
        ? conn.lastSyncStatus
        : 'IDLE',
    lastSyncMessage: typeof conn.lastSyncMessage === 'string' ? conn.lastSyncMessage : '',
    initializedTabs: Array.isArray(conn.initializedTabs)
      ? conn.initializedTabs.filter((t): t is string => typeof t === 'string')
      : [],
    defaultSpreadsheetId:
      typeof conn.defaultSpreadsheetId === 'string' && conn.defaultSpreadsheetId
        ? conn.defaultSpreadsheetId
        : DEFAULT_TARGET_SPREADSHEET_ID,
    defaultSpreadsheetUrl:
      typeof conn.defaultSpreadsheetUrl === 'string' && conn.defaultSpreadsheetUrl
        ? conn.defaultSpreadsheetUrl
        : DEFAULT_TARGET_SPREADSHEET_URL,
  };
}

/**
 * Saves ONLY non-secret spreadsheet metadata so UI banners survive transient network glitches and reloads.
 */
export function saveCachedSheetsConnection(
  scopeKey: string,
  conn: GoogleSheetsConnectionState,
): void {
  if (typeof localStorage !== 'undefined') {
    const cleanScope = scopeKey.trim() || 'default';
    try {
      if (!conn.connected || !conn.spreadsheetId) {
        localStorage.removeItem(`${CACHED_SHEETS_CONN_PREFIX}${cleanScope}`);
      } else {
        const sanitized = normalizeCachedSheetsConnection(conn);
        localStorage.setItem(`${CACHED_SHEETS_CONN_PREFIX}${cleanScope}`, JSON.stringify(sanitized));
      }
    } catch {
      // Ignore storage quota errors
    }
  }
  notifySheetsConnectionListeners();
}

export function loadCachedSheetsConnection(scopeKey: string): GoogleSheetsConnectionState | null {
  if (typeof localStorage === 'undefined') return null;
  const cleanScope = scopeKey.trim() || 'default';
  try {
    const raw = localStorage.getItem(`${CACHED_SHEETS_CONN_PREFIX}${cleanScope}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoogleSheetsConnectionState> | null;
    if (!parsed || !parsed.connected || !parsed.spreadsheetId) {
      return null;
    }
    return normalizeCachedSheetsConnection(parsed);
  } catch {
    return null;
  }
}

export function clearCachedSheetsConnection(scopeKey?: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      if (scopeKey) {
        localStorage.removeItem(`${CACHED_SHEETS_CONN_PREFIX}${scopeKey.trim() || 'default'}`);
      } else {
        localStorage.removeItem(`${CACHED_SHEETS_CONN_PREFIX}apps_script`);
        localStorage.removeItem(`${CACHED_SHEETS_CONN_PREFIX}local_sandbox`);
        localStorage.removeItem(`${CACHED_SHEETS_CONN_PREFIX}default`);
      }
    } catch {
      // Ignore storage removal errors
    }
  }
  notifySheetsConnectionListeners();
}

let gisScriptPromise: Promise<void> | null = null;
let silentRefreshInFlight: Promise<string | null> | null = null;

interface GisPromptNotification {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
}

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser window'));
  if ((window as unknown as { google?: { accounts?: unknown } }).google?.accounts) {
    return Promise.resolve();
  }
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisScriptPromise = null;
        reject(new Error('Failed to load Google Identity Services script.'));
      };
      document.head.append(script);
    });
  }
  return gisScriptPromise;
}

export async function tryRefreshGoogleIdTokenSilently(
  googleClientId: string,
  loginHint?: string,
): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const cleanClientId = googleClientId.trim();
  if (!cleanClientId) return null;
  if (silentRefreshInFlight) {
    return silentRefreshInFlight;
  }

  silentRefreshInFlight = (async () => {
    try {
      await loadGoogleIdentityScript();
    } catch {
      return null;
    }

    const googleId = (
      window as unknown as {
        google?: {
          accounts?: {
            id?: {
              initialize: (cfg: Record<string, unknown>) => void;
              prompt: (cb?: (notification: GisPromptNotification) => void) => void;
            };
          };
        };
      }
    ).google?.accounts?.id;

    if (!googleId || typeof googleId.initialize !== 'function' || typeof googleId.prompt !== 'function') {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (token: string | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(token);
      };

      const timer = window.setTimeout(() => finish(null), 4500);

      try {
        googleId.initialize({
          client_id: cleanClientId,
          auto_select: true,
          itp_support: true,
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: false,
          ...(loginHint && loginHint.trim() ? { login_hint: loginHint.trim().toLowerCase() } : {}),
          callback: (response: { credential?: string }) => {
            const cred = typeof response?.credential === 'string' ? response.credential : '';
            if (cred && isJwtTokenUsable(cred, 30)) {
              finish(cred);
            } else {
              finish(null);
            }
          },
        });

        googleId.prompt((notification: GisPromptNotification) => {
          if (settled) return;
          const notDisplayed = Boolean(notification?.isNotDisplayed?.());
          const skipped = Boolean(notification?.isSkippedMoment?.());
          const dismissed = Boolean(notification?.isDismissedMoment?.());
          const dismissedReason = notification?.getDismissedReason?.() ?? '';
          if (notDisplayed || skipped || (dismissed && dismissedReason !== 'credential_returned')) {
            finish(null);
          }
        });
      } catch {
        finish(null);
      }
    });
  })().finally(() => {
    silentRefreshInFlight = null;
  });

  return silentRefreshInFlight;
}

export const SANDBOX_USERS = {
  super_admin_1: {
    userId: INITIAL_SUPER_ADMINS[0].userId,
    name: INITIAL_SUPER_ADMINS[0].name,
    email: INITIAL_SUPER_ADMINS[0].email,
    role: 'super_admin',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
  super_admin_2: {
    userId: INITIAL_SUPER_ADMINS[1].userId,
    name: INITIAL_SUPER_ADMINS[1].name,
    email: INITIAL_SUPER_ADMINS[1].email,
    role: 'super_admin',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
  super_admin_3: {
    userId: INITIAL_SUPER_ADMINS[2].userId,
    name: INITIAL_SUPER_ADMINS[2].name,
    email: INITIAL_SUPER_ADMINS[2].email,
    role: 'super_admin',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
  super_admin_4: {
    userId: INITIAL_SUPER_ADMINS[3].userId,
    name: INITIAL_SUPER_ADMINS[3].name,
    email: INITIAL_SUPER_ADMINS[3].email,
    role: 'super_admin',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
  super_admin_5: {
    userId: INITIAL_SUPER_ADMINS[4].userId,
    name: INITIAL_SUPER_ADMINS[4].name,
    email: INITIAL_SUPER_ADMINS[4].email,
    role: 'super_admin',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
  facilitator: {
    userId: 'SANDBOX_FAC_01',
    name: 'Priya S',
    email: 'priya.facilitator@example.org',
    role: 'facilitator',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
  facilitator_2: {
    userId: 'SANDBOX_FAC_02',
    name: 'Arun K',
    email: 'arun.facilitator@example.org',
    role: 'facilitator',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
  facilitator_3: {
    userId: 'SANDBOX_FAC_03',
    name: 'Kavitha M',
    email: 'kavitha.facilitator@example.org',
    role: 'facilitator',
    active: true,
    status: 'APPROVED',
    authMode: 'local_sandbox',
  },
} satisfies Record<string, UserProfile>;

export const SANDBOX_USERS_LIST: UserProfile[] = Object.values(SANDBOX_USERS);

export const SANDBOX_PENDING_CANDIDATE = {
  email: 'deepa.new@example.org',
  name: 'Deepa K (New Google Sign-In)',
};

export const SANDBOX_DENIED_USER: UserProfile = {
  userId: 'SANDBOX_FAC_DENIED',
  name: 'Revoked Facilitator',
  email: 'denied.user@example.org',
  role: 'facilitator',
  active: false,
  status: 'DENIED',
  authMode: 'local_sandbox',
};
