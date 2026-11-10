import { INITIAL_SUPER_ADMINS } from '../config/accessControl';
import type { UserProfile } from '../types/domain';

export interface AuthEnvironmentConfig {
  appsScriptUrl: string;
  googleClientId: string;
  isLiveBackendConfigured: boolean;
}

export function getAuthEnvironment(): AuthEnvironmentConfig {
  const appsScriptUrl = (import.meta.env.VITE_APPS_SCRIPT_URL ?? '').trim();
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
  return {
    appsScriptUrl,
    googleClientId,
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
