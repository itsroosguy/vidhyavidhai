import type { SessionFormValues } from '../types/domain';

const DRAFT_PREFIX = 'ct_form_draft_v1_';

export interface StoredDraft {
  savedAt: string;
  editingSessionRecordId: string | null;
  editingSessionId: string | null;
  values: SessionFormValues;
}

function getKey(userEmail: string): string {
  const safeEmail = userEmail.trim().toLowerCase() || 'anonymous';
  return `${DRAFT_PREFIX}${safeEmail}`;
}

export function saveFormDraft(
  userEmail: string,
  values: SessionFormValues,
  editingSessionRecordId: string | null = null,
  editingSessionId: string | null = null,
): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    // Strip nothing auth-related because SessionFormValues contains no credentials/tokens.
    const payload: StoredDraft = {
      savedAt: new Date().toISOString(),
      editingSessionRecordId,
      editingSessionId,
      values,
    };
    window.localStorage.setItem(getKey(userEmail), JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function loadFormDraft(userEmail: string): StoredDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(getKey(userEmail));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed || typeof parsed !== 'object' || !parsed.values || !Array.isArray(parsed.values.classes)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearFormDraft(userEmail: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(getKey(userEmail));
  } catch {
    // Ignore storage errors
  }
}
