import { describe, expect, it } from 'vitest';
import { LocalSandboxApiClient } from '../../services/apiClient';
import { SANDBOX_USERS } from '../../services/authService';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import { buildSessionIdPrefix, formatSessionIdWithSequence } from '../sessionId';

describe('Session ID Formatting & Concurrency Collision Safety', () => {
  it('builds exact single-class, No-section (NS), and combined-class (CMB_XXC) prefixes', () => {
    const singleA = buildSessionIdPrefix('2026-11-10', '33180100101', 'single', [
      { grade: '8', section: 'A' },
    ]);
    expect(singleA).toBe('CT_IN_20261110_33180100101_08_A');
    expect(formatSessionIdWithSequence(singleA!, 1)).toBe('CT_IN_20261110_33180100101_08_A_001');

    const noSec = buildSessionIdPrefix('2026-11-10', '01234567890', 'single', [
      { grade: '9', section: 'No section' },
    ]);
    expect(noSec).toBe('CT_IN_20261110_01234567890_09_NS');

    const combined = buildSessionIdPrefix('2026-11-10', '33180100101', 'combined', [
      { grade: '8', section: 'A' },
      { grade: '8', section: 'B' },
      { grade: '9', section: 'A' },
    ]);
    expect(combined).toBe('CT_IN_20261110_33180100101_CMB_03C');
  });

  it('serializes concurrent same-school same-day saves into unique _001, _002, _003 IDs', async () => {
    const api = new LocalSandboxApiClient(
      () => SANDBOX_USERS.facilitator.userId,
      createTestConfig(),
    );

    const v1 = createValidFormValues();
    const v2 = createValidFormValues();
    const v3 = createValidFormValues();

    const [r1, r2, r3] = await Promise.all([
      api.createSession(v1),
      api.createSession(v2),
      api.createSession(v3),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);

    const ids = [r1.data!.session.sessionId, r2.data!.session.sessionId, r3.data!.session.sessionId];
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toMatch(/_001$/);
    expect(ids[1]).toMatch(/_002$/);
    expect(ids[2]).toMatch(/_003$/);
  });

  it('prevents duplicate record creation when same clientSubmissionKey is retried', async () => {
    const api = new LocalSandboxApiClient(
      () => SANDBOX_USERS.facilitator.userId,
      createTestConfig(),
    );

    const sharedKeyValues = createValidFormValues({ clientSubmissionKey: 'idem-key-xyz' });
    const first = await api.createSession(sharedKeyValues);
    const second = await api.createSession(sharedKeyValues);

    expect(first.ok && second.ok).toBe(true);
    expect(second.data!.session.sessionRecordId).toBe(first.data!.session.sessionRecordId);
    expect(second.data!.session.sessionId).toBe(first.data!.session.sessionId);
    expect(api.getRawSessionsForTest()).toHaveLength(1);
  });
});
