import { normalizeEmail } from '../config/accessControl';
import type {
  AppConfiguration,
  DatabaseBackupPackage,
  ImportSessionsResult,
  ManagedUser,
  SchoolRecord,
  SessionRecord,
  SessionTransferPackage,
} from '../types/domain';

export const DURABLE_DB_NAME = 'vidhya_vidhai_career_tours_db';
export const DURABLE_DB_VERSION = 1;
export const DURABLE_STORE_NAME = 'kv';
export const STORAGE_INTEGRITY_META_KEY = 'ct_storage_integrity_v1';

interface IntegrityRecord {
  version: 1;
  hash: string;
  sessionCount: number;
  schoolCount: number;
  updatedAt: string;
}

export interface StorageDurabilityStatus {
  indexedDbAvailable: boolean;
  persistentStorageGranted: boolean;
  mirroredAt: string;
  integrityValid: boolean;
  mirroredWorkspaceSessions: number;
}

const DURABLE_PREFIXES = [
  'ct_workspace_store_v1',
  'ct_team_intake_config_v1',
  'career_tours_sync_outbox_v1_',
  'career_tours_sync_events_v1_',
];

function isMirroredKey(key: string): boolean {
  return DURABLE_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix));
}

export function computeIntegrityHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function summarizeWorkspacePayload(rawJson: string): {
  valid: boolean;
  sessionCount: number;
  schoolCount: number;
} {
  if (!rawJson) return { valid: false, sessionCount: 0, schoolCount: 0 };
  try {
    const parsed = JSON.parse(rawJson) as {
      version?: unknown;
      sessions?: unknown;
      schools?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return { valid: false, sessionCount: 0, schoolCount: 0 };
    }
    const sessionCount = Array.isArray(parsed.sessions) ? parsed.sessions.length : 0;
    const schoolCount = Array.isArray(parsed.schools) ? parsed.schools.length : 0;
    return { valid: true, sessionCount, schoolCount };
  } catch {
    return { valid: false, sessionCount: 0, schoolCount: 0 };
  }
}

function openDurableDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    const timer =
      typeof setTimeout === 'function' ? setTimeout(() => finish(null), 2500) : null;
    try {
      const req = indexedDB.open(DURABLE_DB_NAME, DURABLE_DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(DURABLE_STORE_NAME)) {
            db.createObjectStore(DURABLE_STORE_NAME);
          }
        } catch {
          // Ignore upgrade errors gracefully
        }
      };
      req.onsuccess = () => {
        if (timer !== null) clearTimeout(timer);
        finish(req.result);
      };
      req.onerror = () => {
        if (timer !== null) clearTimeout(timer);
        finish(null);
      };
      req.onblocked = () => {
        if (timer !== null) clearTimeout(timer);
        finish(null);
      };
    } catch {
      if (timer !== null) clearTimeout(timer);
      finish(null);
    }
  });
}

async function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(DURABLE_STORE_NAME, 'readonly');
      const store = tx.objectStore(DURABLE_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(typeof req.result === 'string' ? req.result : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(db: IDBDatabase, key: string, value: string | null): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DURABLE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DURABLE_STORE_NAME);
      const req = value === null ? store.delete(key) : store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbGetAllKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    try {
      const tx = db.transaction(DURABLE_STORE_NAME, 'readonly');
      const store = tx.objectStore(DURABLE_STORE_NAME);
      if (typeof store.getAllKeys !== 'function') {
        resolve([]);
        return;
      }
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const res = Array.isArray(req.result) ? req.result : [];
        resolve(res.filter((k): k is string => typeof k === 'string'));
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function mirrorKeyToIndexedDb(key: string, value: string | null): Promise<void> {
  if (!key) return;
  const db = await openDurableDb();
  if (!db) return;
  try {
    await idbSet(db, key, value);
  } finally {
    try {
      db.close();
    } catch {
      // Ignore close failure
    }
  }
}

export function loadWorkspaceIntegrityMeta(): IntegrityRecord | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_INTEGRITY_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IntegrityRecord> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.hash !== 'string') return null;
    return {
      version: 1,
      hash: parsed.hash,
      sessionCount: typeof parsed.sessionCount === 'number' ? parsed.sessionCount : 0,
      schoolCount: typeof parsed.schoolCount === 'number' ? parsed.schoolCount : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

function saveWorkspaceIntegrityMeta(rawJson: string, summary: { sessionCount: number; schoolCount: number }): void {
  if (typeof localStorage === 'undefined') return;
  const meta: IntegrityRecord = {
    version: 1,
    hash: computeIntegrityHash(rawJson),
    sessionCount: summary.sessionCount,
    schoolCount: summary.schoolCount,
    updatedAt: new Date().toISOString(),
  };
  const serializedMeta = JSON.stringify(meta);
  try {
    localStorage.setItem(STORAGE_INTEGRITY_META_KEY, serializedMeta);
    void mirrorKeyToIndexedDb(STORAGE_INTEGRITY_META_KEY, serializedMeta);
  } catch {
    // Ignore storage quota failures
  }
}

/**
 * Atomically validates JSON payload, refuses silent overwrite of non-empty persisted workspace
 * with empty/corrupt data unless `allowShrinkToEmpty` is explicitly true (intentional deletes),
 * writes to `localStorage`, updates integrity checksum metadata, and mirrors asynchronously to IndexedDB.
 */
export function safeWriteMirroredLocalStorage(
  key: string,
  rawJson: string,
  allowShrinkToEmpty = false,
): boolean {
  if (typeof localStorage === 'undefined' || !key) return false;
  const nextSummary = summarizeWorkspacePayload(rawJson);

  if (key.startsWith('ct_workspace_store') && !nextSummary.valid) {
    return false;
  }

  if (key.startsWith('ct_workspace_store') && !allowShrinkToEmpty) {
    try {
      const prevRaw = localStorage.getItem(key) ?? '';
      const prevSummary = summarizeWorkspacePayload(prevRaw);
      if (
        prevSummary.valid &&
        (prevSummary.sessionCount > 0 || prevSummary.schoolCount > 0) &&
        nextSummary.sessionCount === 0 &&
        nextSummary.schoolCount === 0
      ) {
        return false;
      }
    } catch {
      // Ignore read errors before write
    }
  }

  try {
    localStorage.setItem(key, rawJson);
  } catch {
    return false;
  }

  if (key.startsWith('ct_workspace_store') && nextSummary.valid) {
    saveWorkspaceIntegrityMeta(rawJson, nextSummary);
  }
  void mirrorKeyToIndexedDb(key, rawJson);
  return true;
}

export async function requestPersistentBrowserStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  try {
    const storageApi = navigator.storage as
      | {
          persisted?: () => Promise<boolean>;
          persist?: () => Promise<boolean>;
        }
      | undefined;
    if (!storageApi) return false;
    if (typeof storageApi.persisted === 'function') {
      const already = await storageApi.persisted();
      if (already) return true;
    }
    if (typeof storageApi.persist === 'function') {
      return await storageApi.persist();
    }
    return false;
  } catch {
    return false;
  }
}

function isUsableJsonValue(key: string, raw: string | null): boolean {
  if (!raw || !raw.trim()) return false;
  if (key.startsWith('ct_workspace_store')) {
    return summarizeWorkspacePayload(raw).valid;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

/**
 * Hydrates missing or corrupted `localStorage` durability keys from the IndexedDB mirror
 * (and requests persistent storage permission when available). Conversely, if `localStorage`
 * holds fresh data that IndexedDB does not yet mirror, backfills IndexedDB silently.
 */
export async function hydrateDurableStorageFromIndexedDb(extraKeys: string[] = []): Promise<{
  restoredKeys: string[];
  persistentGranted: boolean;
  indexedDbAvailable: boolean;
}> {
  const persistentGranted = await requestPersistentBrowserStorage();
  const db = await openDurableDb();
  if (!db || typeof localStorage === 'undefined') {
    return { restoredKeys: [], persistentGranted, indexedDbAvailable: Boolean(db) };
  }

  const restoredKeys: string[] = [];
  try {
    const idbKeys = await idbGetAllKeys(db);
    const candidateKeys = new Set<string>([
      'ct_workspace_store_v1',
      'ct_team_intake_config_v1',
      STORAGE_INTEGRITY_META_KEY,
      ...extraKeys.filter(Boolean),
      ...idbKeys.filter((k) => isMirroredKey(k) || k === STORAGE_INTEGRITY_META_KEY),
    ]);

    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (lsKey && isMirroredKey(lsKey)) {
        candidateKeys.add(lsKey);
      }
    }

    for (const key of candidateKeys) {
      const lsVal = localStorage.getItem(key);
      const idbVal = await idbGet(db, key);
      const lsValid = isUsableJsonValue(key, lsVal);
      const idbValid = isUsableJsonValue(key, idbVal);

      if (!lsValid && idbValid && idbVal !== null) {
        try {
          localStorage.setItem(key, idbVal);
          restoredKeys.push(key);
        } catch {
          // Ignore quota error during restore
        }
        continue;
      }

      if (key.startsWith('ct_workspace_store') && lsValid && idbValid && lsVal && idbVal) {
        const lsSum = summarizeWorkspacePayload(lsVal);
        const idbSum = summarizeWorkspacePayload(idbVal);
        if (lsSum.sessionCount === 0 && lsSum.schoolCount === 0 && idbSum.sessionCount > 0) {
          try {
            localStorage.setItem(key, idbVal);
            saveWorkspaceIntegrityMeta(idbVal, idbSum);
            restoredKeys.push(key);
          } catch {
            // Ignore quota error
          }
          continue;
        }
      }

      if (lsValid && lsVal && lsVal !== idbVal) {
        await idbSet(db, key, lsVal);
      }
    }
  } finally {
    try {
      db.close();
    } catch {
      // Ignore close failure
    }
  }

  return {
    restoredKeys,
    persistentGranted,
    indexedDbAvailable: true,
  };
}

export async function getStorageDurabilityStatus(
  workspaceKey = 'ct_workspace_store_v1',
): Promise<StorageDurabilityStatus> {
  let persistentStorageGranted = false;
  if (typeof navigator !== 'undefined') {
    try {
      const storageApi = navigator.storage as { persisted?: () => Promise<boolean> } | undefined;
      if (storageApi && typeof storageApi.persisted === 'function') {
        persistentStorageGranted = await storageApi.persisted();
      }
    } catch {
      persistentStorageGranted = false;
    }
  }

  let integrityValid = true;
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(workspaceKey);
    const meta = loadWorkspaceIntegrityMeta();
    if (raw && meta) {
      integrityValid = computeIntegrityHash(raw) === meta.hash;
    } else if (raw) {
      integrityValid = summarizeWorkspacePayload(raw).valid;
    }
  }

  const db = await openDurableDb();
  if (!db) {
    return {
      indexedDbAvailable: false,
      persistentStorageGranted,
      mirroredAt: loadWorkspaceIntegrityMeta()?.updatedAt ?? '',
      integrityValid,
      mirroredWorkspaceSessions: 0,
    };
  }

  try {
    const mirroredRaw = await idbGet(db, workspaceKey);
    const summary = mirroredRaw ? summarizeWorkspacePayload(mirroredRaw) : null;
    const metaRaw = await idbGet(db, STORAGE_INTEGRITY_META_KEY);
    let mirroredAt = loadWorkspaceIntegrityMeta()?.updatedAt ?? '';
    if (metaRaw) {
      try {
        const parsedMeta = JSON.parse(metaRaw) as Partial<IntegrityRecord>;
        if (typeof parsedMeta.updatedAt === 'string') {
          mirroredAt = parsedMeta.updatedAt;
        }
      } catch {
        // Ignore parse failure
      }
    }
    return {
      indexedDbAvailable: true,
      persistentStorageGranted,
      mirroredAt,
      integrityValid,
      mirroredWorkspaceSessions: summary?.valid ? summary.sessionCount : 0,
    };
  } finally {
    try {
      db.close();
    } catch {
      // Ignore close failure
    }
  }
}

export function triggerJsonDownload(filename: string, payload: unknown): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

export function buildFacilitatorTransferPackage(
  sessions: SessionRecord[],
  actor: { email: string; name: string },
): SessionTransferPackage {
  const cleanEmail = normalizeEmail(actor.email);
  const ownOnly = sessions
    .filter((s) => normalizeEmail(s.facilitatorEmail) === cleanEmail && !s.archived)
    .map((s) => structuredClone(s));
  const integrityHash = computeIntegrityHash(JSON.stringify(ownOnly));
  return {
    format: 'VV_FACILITATOR_TRANSFER_V1',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: {
      email: cleanEmail,
      name: (actor.name || cleanEmail).trim(),
    },
    recordCount: ownOnly.length,
    integrityHash,
    sessions: ownOnly,
  };
}

export function buildDatabaseBackupPackage(
  state: {
    sessions: SessionRecord[];
    schools: SchoolRecord[];
    users: ManagedUser[];
    configuration: AppConfiguration;
  },
  actor: { email: string; name: string },
): DatabaseBackupPackage {
  const cleanEmail = normalizeEmail(actor.email);
  const clonedSessions = structuredClone(state.sessions);
  const clonedSchools = structuredClone(state.schools);
  const sanitizedUsers = state.users.map((u) => ({
    userId: u.userId,
    name: u.name,
    email: normalizeEmail(u.email),
    role: u.role,
    active: u.active,
    status: u.status,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));
  const clonedConfig = structuredClone(state.configuration);
  const integrityHash = computeIntegrityHash(
    JSON.stringify({
      sessions: clonedSessions,
      schools: clonedSchools,
      users: sanitizedUsers,
    }),
  );
  return {
    format: 'VV_DATABASE_BACKUP_V1',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: {
      email: cleanEmail,
      name: (actor.name || cleanEmail).trim(),
    },
    recordCount: clonedSessions.length,
    schoolsCount: clonedSchools.length,
    usersCount: sanitizedUsers.length,
    integrityHash,
    sessions: clonedSessions,
    schools: clonedSchools,
    users: sanitizedUsers,
    configuration: clonedConfig,
  };
}

export function parseSessionTransferOrBackupPayload(rawPayload: unknown):
  | {
      ok: true;
      sourceFormat: string;
      sessions: SessionRecord[];
      hashVerified: boolean | null;
    }
  | {
      ok: false;
      error: string;
    } {
  let obj: unknown = rawPayload;
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      return { ok: false, error: 'Selected file is empty.' };
    }
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: 'Invalid JSON transfer file. Select a .json transfer or backup file.' };
    }
  }

  if (Array.isArray(obj)) {
    return {
      ok: true,
      sourceFormat: 'RAW_ARRAY',
      sessions: obj as SessionRecord[],
      hashVerified: null,
    };
  }

  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'Unsupported file structure.' };
  }

  const record = obj as Record<string, unknown>;
  const format = typeof record.format === 'string' ? record.format : 'JSON_OBJECT';
  if (!Array.isArray(record.sessions)) {
    return { ok: false, error: 'File does not contain a sessions array.' };
  }

  if (format === 'VV_FACILITATOR_TRANSFER_V1' && typeof record.integrityHash === 'string') {
    const expected = computeIntegrityHash(JSON.stringify(record.sessions));
    if (expected !== record.integrityHash) {
      return {
        ok: false,
        error: 'Transfer file integrity verification failed — the file may be incomplete or modified.',
      };
    }
    return {
      ok: true,
      sourceFormat: format,
      sessions: record.sessions as SessionRecord[],
      hashVerified: true,
    };
  }

  if (
    format === 'VV_DATABASE_BACKUP_V1' &&
    typeof record.integrityHash === 'string' &&
    Array.isArray(record.schools) &&
    Array.isArray(record.users)
  ) {
    const expected = computeIntegrityHash(
      JSON.stringify({
        sessions: record.sessions,
        schools: record.schools,
        users: record.users,
      }),
    );
    if (expected !== record.integrityHash) {
      return {
        ok: false,
        error: 'Database backup integrity check failed — the backup file may be corrupted or modified.',
      };
    }
    return {
      ok: true,
      sourceFormat: format,
      sessions: record.sessions as SessionRecord[],
      hashVerified: true,
    };
  }

  return {
    ok: true,
    sourceFormat: format,
    sessions: record.sessions as SessionRecord[],
    hashVerified: null,
  };
}

export function normalizeImportSessionsResult(raw: unknown): ImportSessionsResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawErrors = Array.isArray(r.errors) ? r.errors : [];
  const formattedErrors = rawErrors.map((err) => {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      const sid = typeof e.sessionId === 'string' && e.sessionId ? e.sessionId : 'Row';
      const msg = typeof e.message === 'string' && e.message ? e.message : 'Validation failed.';
      return `${sid}: ${msg}`;
    }
    return String(err ?? 'Invalid row');
  });
  return {
    importedCount: typeof r.importedCount === 'number' ? r.importedCount : 0,
    skippedDuplicates: typeof r.skippedDuplicates === 'number' ? r.skippedDuplicates : 0,
    rejectedCount: typeof r.rejectedCount === 'number' ? r.rejectedCount : 0,
    registeredFacilitators:
      typeof r.registeredFacilitators === 'number' ? r.registeredFacilitators : 0,
    repairedSchools:
      typeof r.repairedSchools === 'number'
        ? r.repairedSchools
        : typeof r.registeredSchools === 'number'
          ? r.registeredSchools
          : 0,
    errors: formattedErrors,
  };
}
