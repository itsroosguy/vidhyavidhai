import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

export const SUPABASE_AUTH_STORAGE_KEY = 'vv_career_tours_supabase_auth';

let cachedClient: SupabaseClient<Database> | null = null;
let cachedSignature = '';

function readTrimmedEnv(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getSupabaseConfig(): {
  url: string;
  publishableKey: string;
  configured: boolean;
} {
  const url = readTrimmedEnv(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '');
  const publishableKey =
    readTrimmedEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    readTrimmedEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);

  const validUrl = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(url);
  const validKey = publishableKey.length >= 20;

  return {
    url,
    publishableKey,
    configured: validUrl && validKey,
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().configured;
}

export function isSupabaseGoogleOAuthEnabled(): boolean {
  return (
    readTrimmedEnv(import.meta.env.VITE_SUPABASE_GOOGLE_OAUTH_ENABLED).toLowerCase() === 'true'
  );
}

export async function extractEdgeFunctionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (!error || typeof error !== 'object') return fallback;
  const errObj = error as { context?: Response; message?: string };
  if (errObj.context && typeof errObj.context.json === 'function') {
    const errJson = (await errObj.context
      .clone()
      .json()
      .catch(() => null)) as { error?: string; message?: string } | null;
    const parsed = errJson?.error || errJson?.message;
    if (parsed && parsed.trim()) return parsed.trim();
  }
  return errObj.message?.trim() || fallback;
}

export function getSupabaseClient(): SupabaseClient<Database> {
  const cfg = getSupabaseConfig();
  if (!cfg.configured) {
    throw new Error(
      'Supabase client requested before VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY were configured.',
    );
  }
  const signature = `${cfg.url}|${cfg.publishableKey}`;
  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = createClient<Database>(cfg.url, cfg.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
      realtime: {
        params: {
          eventsPerSecond: 4,
        },
      },
    });
    cachedSignature = signature;
  }
  return cachedClient;
}
