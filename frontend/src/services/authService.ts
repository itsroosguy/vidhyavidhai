import { INITIAL_SUPER_ADMINS } from '../config/accessControl';
import type { UserProfile } from '../types/domain';
import { withBasePath } from '../utils/routes';

export interface AuthEnvironmentConfig {
  appsScriptUrl: string;
  googleClientId: string;
  sheetsBackendUrl: string;
  isLiveBackendConfigured: boolean;
}

export interface RecentGoogleAccount {
  email: string;
  name: string;
  lastUsedAt: string;
}

const RECENT_GOOGLE_ACCOUNTS_KEY = 'ct_recent_google_accounts_v1';
const ACTIVE_SANDBOX_SESSION_EMAIL_KEY = 'ct_active_sandbox_email_v1';
const OAUTH_STATE_SESSION_KEY = 'ct_google_oauth_state_v1';
const OAUTH_NONCE_SESSION_KEY = 'ct_google_oauth_nonce_v1';

function randomHexToken(byteCount = 16): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export function buildGoogleOAuthRedirectUrl(googleClientId: string): string {
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

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
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
              typeof item.name === 'string' &&
              typeof item.lastUsedAt === 'string',
          ),
      )
      .slice(0, 4);
  } catch {
    return [];
  }
}

export function rememberRecentGoogleAccount(account: { email: string; name: string }): void {
  if (typeof localStorage === 'undefined') return;
  const cleanEmail = account.email.trim().toLowerCase();
  if (!cleanEmail) return;
  const cleanName = account.name.trim() || cleanEmail.split('@')[0] || cleanEmail;
  const next: RecentGoogleAccount[] = [
    {
      email: cleanEmail,
      name: cleanName,
      lastUsedAt: new Date().toISOString(),
    },
    ...loadRecentGoogleAccounts().filter((item) => item.email.toLowerCase() !== cleanEmail),
  ].slice(0, 4);
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

export function getAuthEnvironment(): AuthEnvironmentConfig {
  const appsScriptUrl = (import.meta.env.VITE_APPS_SCRIPT_URL ?? '').trim();
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
  const sheetsBackendUrl = (import.meta.env.VITE_SHEETS_BACKEND_URL ?? '').trim();
  return {
    appsScriptUrl,
    googleClientId,
    sheetsBackendUrl,
    isLiveBackendConfigured: Boolean(appsScriptUrl && googleClientId),
  };
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
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join(''),
    );
    return JSON.parse(json) as { sub?: string; email?: string; name?: string; exp?: number };
  } catch {
    return null;
  }
}

let gisScriptPromise: Promise<void> | null = null;

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
      script.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
      document.head.append(script);
    });
  }
  return gisScriptPromise;
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
