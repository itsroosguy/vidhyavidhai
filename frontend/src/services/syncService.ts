import type {
  DuplicateSessionCandidate,
  SessionFormValues,
  SessionRecord,
  SyncLogEntry,
  SyncOutboxItem,
} from '../types/domain';
import { mirrorKeyToIndexedDb } from './durableStorage';

const OUTBOX_STORAGE_PREFIX = 'career_tours_sync_outbox_v1_';
const SYNC_EVENTS_STORAGE_PREFIX = 'career_tours_sync_events_v1_';
const MAX_LOCAL_SYNC_EVENTS = 50;

function safeOutboxKey(userEmail: string): string {
  return `${OUTBOX_STORAGE_PREFIX}${userEmail.trim().toLowerCase()}`;
}

function safeEventsKey(userEmail: string): string {
  return `${SYNC_EVENTS_STORAGE_PREFIX}${userEmail.trim().toLowerCase()}`;
}

function getSafeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSyncOutbox(userEmail: string): SyncOutboxItem[] {
  if (!userEmail) return [];
  const storage = getSafeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(safeOutboxKey(userEmail));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncOutboxItem[]) : [];
  } catch {
    return [];
  }
}

export function saveSyncOutbox(userEmail: string, items: SyncOutboxItem[]): void {
  if (!userEmail) return;
  const key = safeOutboxKey(userEmail);
  const storage = getSafeStorage();
  if (!storage) return;
  try {
    if (items.length === 0) {
      storage.removeItem(key);
      void mirrorKeyToIndexedDb(key, null);
    } else {
      const serialized = JSON.stringify(items);
      storage.setItem(key, serialized);
      void mirrorKeyToIndexedDb(key, serialized);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function enqueueSyncOutboxItem(userEmail: string, item: SyncOutboxItem): SyncOutboxItem[] {
  const existing = loadSyncOutbox(userEmail);
  const idx = existing.findIndex(
    (entry) => entry.clientSubmissionKey === item.clientSubmissionKey,
  );
  const next = [...existing];
  if (idx >= 0) {
    next[idx] = item;
  } else {
    next.unshift(item);
  }
  saveSyncOutbox(userEmail, next);
  return next;
}

export function removeSyncOutboxItem(
  userEmail: string,
  clientSubmissionKey: string,
): SyncOutboxItem[] {
  const existing = loadSyncOutbox(userEmail);
  const next = existing.filter((entry) => entry.clientSubmissionKey !== clientSubmissionKey);
  saveSyncOutbox(userEmail, next);
  return next;
}

export function loadLocalSyncEvents(userEmail: string): SyncLogEntry[] {
  if (!userEmail) return [];
  const storage = getSafeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(safeEventsKey(userEmail));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendLocalSyncEvent(userEmail: string, event: SyncLogEntry): SyncLogEntry[] {
  if (!userEmail) return [];
  const key = safeEventsKey(userEmail);
  const storage = getSafeStorage();
  const next = [event, ...loadLocalSyncEvents(userEmail)].slice(0, MAX_LOCAL_SYNC_EVENTS);
  if (storage) {
    try {
      const serialized = JSON.stringify(next);
      storage.setItem(key, serialized);
      void mirrorKeyToIndexedDb(key, serialized);
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

/**
 * Checks existing saved sessions for probable duplicates matching UDISE + Start Date + Career Tour.
 */
export function findDuplicateSessionCandidates(
  values: SessionFormValues,
  existingSessions: SessionRecord[],
  excludeSessionRecordId?: string | null,
): DuplicateSessionCandidate[] {
  const udise = values.udiseCode.trim();
  const startDate = values.startDate.trim();
  const tourId = values.tourId.trim();
  if (!udise || !startDate || !tourId) return [];

  const targetClassSet = new Set(
    values.classes
      .filter((c) => c.grade && c.section)
      .map((c) => `${c.grade}::${c.section}`),
  );

  const matches: DuplicateSessionCandidate[] = [];

  for (const s of existingSessions) {
    if (s.archived || s.submissionStatus === 'PENDING') continue;
    if (excludeSessionRecordId && s.sessionRecordId === excludeSessionRecordId) continue;
    if (s.udiseCode !== udise || s.startDate !== startDate || s.tourId !== tourId) continue;

    const overlappingGrades = s.details
      .filter((d) => targetClassSet.has(`${d.grade}::${d.section}`))
      .map((d) => `Grade ${d.grade} (${d.section})`);

    matches.push({
      sessionRecordId: s.sessionRecordId,
      sessionId: s.sessionId,
      schoolName: s.schoolName,
      udiseCode: s.udiseCode,
      startDate: s.startDate,
      startTime: s.startTime,
      tourName: s.tourName,
      facilitatorName: s.facilitatorName,
      overlappingGrades,
    });
  }

  return matches;
}
