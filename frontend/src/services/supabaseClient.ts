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
