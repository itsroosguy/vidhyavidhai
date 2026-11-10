import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_SUPER_ADMIN_EMAILS } from '../../config/accessControl';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import { SANDBOX_DENIED_USER, SANDBOX_PENDING_CANDIDATE, SANDBOX_USERS } from '../authService';
import { LocalSandboxApiClient } from '../apiClient';
import {
  appendLocalSyncEvent,
  enqueueSyncOutboxItem,
  findDuplicateSessionCandidates,
  loadLocalSyncEvents,
  loadSyncOutbox,
  removeSyncOutboxItem,
} from '../syncService';

describe('Database CRUD, Partial-Failure Handling, Strict RBAC & Audit Trail', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('supports create, update (preserving immutable IDs), archive, and Super Admin audit logging', async () => {
    let currentActorId = SANDBOX_USERS.facilitator.userId;
    const api = new LocalSandboxApiClient(() => currentActorId, createTestConfig());

    const created = await api.createSession(createValidFormValues());
    expect(created.ok).toBe(true);
    const rec = created.data!.session;
    expect(rec.submissionStatus).toBe('COMMITTED');

    // Update own session (facilitator)
    const editedValues = createValidFormValues({
      schoolName: 'GHSS Panruti Updated',
      classes: [
        {
          rowId: 'row-1',
          grade: '8',
          section: 'A',
          studentsPresent: '50',
          questionA: { score5: '50', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '50', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
      ],
    });
    const updated = await api.updateSession(rec.sessionRecordId, editedValues);
    expect(updated.ok).toBe(true);
    expect(updated.data!.session.sessionRecordId).toBe(rec.sessionRecordId);
    expect(updated.data!.session.sessionId).toBe(rec.sessionId);
    expect(updated.data!.session.overallCsat).toBe(5);

    // Archive own session
    const archived = await api.archiveSession(rec.sessionRecordId);
    expect(archived.ok).toBe(true);

    // Excluded from default list after archive
    const myList = await api.getMySessions({});
    expect(myList.data!.items).toHaveLength(0);

    // Audit log readable by Super Admin
    currentActorId = SANDBOX_USERS.super_admin_1.userId;
    const audit = await api.getAuditLogs(1, 50);
    expect(audit.ok).toBe(true);
    const actions = audit.data!.items.map((a) => a.action);
    expect(actions).toContain('CREATE_SESSION');
    expect(actions).toContain('UPDATE_SESSION');
    expect(actions).toContain('ARCHIVE_SESSION');
  });

  it('prevents partial writes from surfacing as COMMITTED records', async () => {
    const api = new LocalSandboxApiClient(
      () => SANDBOX_USERS.facilitator.userId,
      createTestConfig(),
    );

    api.setSimulatePartialFailureOnce(true);
    const failed = await api.createSession(createValidFormValues());
    expect(failed.ok).toBe(false);
    expect(failed.code).toBe('PARTIAL_WRITE_DETECTED');

    expect(api.getRawSessionsForTest()[0]!.submissionStatus).toBe('PENDING');
    const visible = await api.getMySessions({});
    expect(visible.data!.total).toBe(0);
  });

  it('enforces dual Super Admin allowlist, strips facilitator config, blocks every admin endpoint for facilitators, and isolates user records', async () => {
    let actorId = SANDBOX_USERS.facilitator.userId;
    const api = new LocalSandboxApiClient(
      () => actorId,
      createTestConfig({
        partnerName: 'Sensitive Partner Org',
        policy: {
          allowFacilitatorDeleteOwn: true,
          allowFacilitatorExportOwn: true,
          facilitatorApprovalMode: 'manual_allowlist',
        },
      }),
    );

    // Facilitators receive sanitized config with sensitive partner/policy/export schema removed
    const facCfg = await api.getAppConfiguration();
    expect(facCfg.ok).toBe(true);
    expect(facCfg.data!.partnerName).toBe('');
    expect(facCfg.data!.exportTemplate63).toBeNull();
    expect(facCfg.data!.policy.allowFacilitatorExportOwn).toBe(false);

    // Facilitators cannot overwrite their owner email even if client payload forged it
    const forged = await api.createSession(
      createValidFormValues({ facilitatorEmail: 'someone.else@example.org' }),
    );
    expect(forged.ok).toBe(true);
    expect(forged.data!.session.facilitatorEmail).toBe(SANDBOX_USERS.facilitator.email);

    // Facilitators are strictly FORBIDDEN from EVERY admin endpoint
    const blockedCalls = await Promise.all([
      api.getDashboardSummary({}),
      api.getAdminSessions({}),
      api.saveAppConfiguration({ partnerName: 'Hacked Partner' }),
      api.importBlockMaster([{ district: 'Cuddalore', block: 'Kurinjipadi', active: true }], false),
      api.listManagedUsers(),
      api.manageUser({
        name: 'Rogue Admin',
        email: 'rogue@example.org',
        role: 'super_admin',
        active: true,
      }),
      api.getAuditLogs(1, 20),
      api.getSyncLogs(1, 20),
      api.logExportEvent('ALL', 1, 'official_63'),
      api.searchSchools('GHSS'),
    ]);
    for (const res of blockedCalls) {
      expect(res.ok).toBe(false);
      expect(res.code).toBe('FORBIDDEN');
    }

    // Both initial Super Admins authenticate with SUPER_ADMIN privileges
    for (const saUser of [SANDBOX_USERS.super_admin_1, SANDBOX_USERS.super_admin_2]) {
      actorId = saUser.userId;
      const me = await api.getCurrentUser();
      expect(me.ok).toBe(true);
      expect(me.data!.role).toBe('super_admin');
      expect(INITIAL_SUPER_ADMIN_EMAILS).toContain(me.data!.email);

      const saCfg = await api.getAppConfiguration();
      expect(saCfg.ok).toBe(true);
      expect(saCfg.data!.partnerName).toBe('Sensitive Partner Org');
    }

    // Initial Super Admin accounts cannot be deactivated or altered by API
    actorId = SANDBOX_USERS.super_admin_1.userId;
    const deactivatePartnerAdmin = await api.manageUser({
      name: 'Attempt Override',
      email: SANDBOX_USERS.super_admin_2.email,
      role: 'facilitator',
      active: false,
      status: 'DENIED',
    });
    expect(deactivatePartnerAdmin.ok).toBe(false);
    expect(deactivatePartnerAdmin.code).toBe('PROTECTED_ACCOUNT');

    // Non-allowlisted users can NEVER be promoted to super_admin or legacy admin
    const promoteAttempt = await api.manageUser({
      name: 'Cannot Elevate',
      email: SANDBOX_USERS.facilitator_2.email,
      role: 'super_admin',
      active: true,
    });
    expect(promoteAttempt.ok).toBe(false);
    expect(promoteAttempt.code).toBe('FORBIDDEN');

    // Cross-facilitator isolation across Facilitator 1 and Facilitator 2
    actorId = SANDBOX_USERS.facilitator_2.userId;
    const targetRecId = forged.data!.session.sessionRecordId;
    expect((await api.getSessionById(targetRecId)).code).toBe('FORBIDDEN');
    expect((await api.updateSession(targetRecId, createValidFormValues())).code).toBe('FORBIDDEN');
    expect((await api.archiveSession(targetRecId)).code).toBe('FORBIDDEN');
    expect((await api.getMySessions({})).data!.items).toHaveLength(0);
  });

  it('enforces Google login manual_allowlist approval queue, auto_approve mode, and denied gating', async () => {
    let actorId: string = SANDBOX_USERS.super_admin_1.userId;
    const api = new LocalSandboxApiClient(() => actorId, createTestConfig());

    // Manual allowlist: new user is recorded as PENDING and denied immediate app entry
    const firstTry = await api.authenticateSandboxEmail(
      SANDBOX_PENDING_CANDIDATE.email,
      SANDBOX_PENDING_CANDIDATE.name,
    );
    expect(firstTry.ok).toBe(false);
    expect(firstTry.code).toBe('PENDING_APPROVAL');

    // Repeated attempt stays idempotent (no duplicate PENDING user rows)
    await api.authenticateSandboxEmail(
      SANDBOX_PENDING_CANDIDATE.email,
      SANDBOX_PENDING_CANDIDATE.name,
    );
    const listedBefore = await api.listManagedUsers();
    const pendingMatches = listedBefore.data!.filter(
      (u) => u.email === SANDBOX_PENDING_CANDIDATE.email,
    );
    expect(pendingMatches).toHaveLength(1);
    expect(pendingMatches[0]!.status).toBe('PENDING');
    expect(pendingMatches[0]!.active).toBe(false);

    // Denied user is rejected with ACCESS_DENIED
    const deniedTry = await api.authenticateSandboxEmail(
      SANDBOX_DENIED_USER.email,
      SANDBOX_DENIED_USER.name,
    );
    expect(deniedTry.ok).toBe(false);
    expect(deniedTry.code).toBe('ACCESS_DENIED');

    // Super Admin 2 approves the pending user as Facilitator
    actorId = SANDBOX_USERS.super_admin_2.userId;
    const approveRes = await api.manageUser({
      userId: pendingMatches[0]!.userId,
      name: pendingMatches[0]!.name,
      email: pendingMatches[0]!.email,
      role: 'facilitator',
      active: true,
      status: 'APPROVED',
    });
    expect(approveRes.ok).toBe(true);

    const approvedLogin = await api.authenticateSandboxEmail(
      SANDBOX_PENDING_CANDIDATE.email,
      SANDBOX_PENDING_CANDIDATE.name,
    );
    expect(approvedLogin.ok).toBe(true);
    expect(approvedLogin.data!.role).toBe('facilitator');

    // Switch approval mode to auto_approve -> unrecognized Google account signs in automatically as facilitator
    const modeRes = await api.saveAppConfiguration({
      policy: {
        allowFacilitatorDeleteOwn: true,
        allowFacilitatorExportOwn: false,
        facilitatorApprovalMode: 'auto_approve',
      },
    });
    expect(modeRes.ok).toBe(true);

    const autoLogin = await api.authenticateSandboxEmail(
      'auto.teacher@example.org',
      'Auto Teacher',
    );
    expect(autoLogin.ok).toBe(true);
    expect(autoLogin.data!.role).toBe('facilitator');
  });

  it('preserves existing School Master name on UDISE collision instead of overwriting silently', async () => {
    let actorId = SANDBOX_USERS.facilitator.userId;
    const api = new LocalSandboxApiClient(() => actorId, createTestConfig());

    const first = await api.createSession(
      createValidFormValues({
        udiseCode: '33180100999',
        schoolName: 'Official GHSS Cuddalore',
      }),
    );
    expect(first.ok).toBe(true);
    expect(first.data!.schoolUdiseConflict).toBeUndefined();

    const second = await api.createSession(
      createValidFormValues({
        udiseCode: '33180100999',
        schoolName: 'Typo School Name Variant',
      }),
    );
    expect(second.ok).toBe(true);
    expect(second.data!.schoolUdiseConflict).toContain('Official GHSS Cuddalore');

    const masterLookup = await api.getSchoolByUdise('33180100999');
    expect(masterLookup.data!.schoolName).toBe('Official GHSS Cuddalore');
  });

  it('manages Sync Outbox idempotent keys, duplicate candidates, and stores zero credentials', async () => {
    const email = SANDBOX_USERS.facilitator.email;
    const formValues = createValidFormValues({
      clientSubmissionKey: 'idem-sync-key-1',
      udiseCode: '33180100123',
      schoolName: 'GHSS Sync Verify',
    });

    enqueueSyncOutboxItem(email, {
      clientSubmissionKey: formValues.clientSubmissionKey,
      operation: 'createSession',
      schoolName: formValues.schoolName,
      udiseCode: formValues.udiseCode,
      startDate: formValues.startDate,
      facilitatorEmail: email,
      syncStatus: 'PENDING_RETRY',
      attempts: 1,
      lastAttemptAt: '2026-11-10T10:00:00Z',
      lastError: 'Timeout',
      values: formValues,
    });
    enqueueSyncOutboxItem(email, {
      clientSubmissionKey: formValues.clientSubmissionKey,
      operation: 'createSession',
      schoolName: formValues.schoolName,
      udiseCode: formValues.udiseCode,
      startDate: formValues.startDate,
      facilitatorEmail: email,
      syncStatus: 'FAILED',
      attempts: 2,
      lastAttemptAt: '2026-11-10T10:01:00Z',
      lastError: 'Still offline',
      values: formValues,
    });

    const outbox = loadSyncOutbox(email);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.attempts).toBe(2);
    expect(JSON.stringify(outbox)).not.toContain('idToken');

    appendLocalSyncEvent(email, {
      syncId: 'sync-ev-1',
      timestamp: '2026-11-10T10:01:00Z',
      clientSubmissionKey: formValues.clientSubmissionKey,
      sessionRecordId: '',
      sessionId: '',
      actorEmail: email,
      operation: 'createSession',
      attempt: 2,
      status: 'FAILED',
      errorMessage: 'Still offline',
    });
    expect(loadLocalSyncEvents(email)).toHaveLength(1);

    removeSyncOutboxItem(email, formValues.clientSubmissionKey);
    expect(loadSyncOutbox(email)).toHaveLength(0);

    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, createTestConfig());
    const saved = await api.createSession(formValues);
    expect(saved.ok).toBe(true);

    const dups = findDuplicateSessionCandidates(formValues, api.getRawSessionsForTest());
    expect(dups).toHaveLength(1);
    expect(dups[0]!.overlappingGrades).toContain('Grade 8 (A)');
    expect(
      findDuplicateSessionCandidates(
        formValues,
        api.getRawSessionsForTest(),
        saved.data!.session.sessionRecordId,
      ),
    ).toHaveLength(0);
  });
});
