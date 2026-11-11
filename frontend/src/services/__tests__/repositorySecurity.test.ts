import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_SUPER_ADMIN_EMAILS } from '../../config/accessControl';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import {
  SANDBOX_DENIED_USER,
  SANDBOX_PENDING_CANDIDATE,
  SANDBOX_USERS,
  clearActiveGoogleHint,
  clearActiveGoogleIdToken,
  clearAppsScriptBridgeConfig,
  clearCachedSheetsConnection,
  clearRuntimeBackendConfig,
  decodeJwtClaimsUnsafe,
  generateAppsScriptSyncKey,
  getAuthEnvironment,
  isJwtTokenUsable,
  loadActiveGoogleHint,
  loadActiveGoogleIdToken,
  loadAppsScriptBridgeConfig,
  loadCachedSheetsConnection,
  loadRecentGoogleAccounts,
  loadRuntimeBackendConfig,
  probeAppsScriptEndpoint,
  rememberRecentGoogleAccount,
  saveActiveGoogleHint,
  saveActiveGoogleIdToken,
  saveCachedSheetsConnection,
  saveRuntimeBackendConfig,
  validateAppsScriptSyncKey,
  validateAppsScriptWebAppUrl,
  validateGoogleOAuthClientId,
} from '../authService';
import {
  buildPersonalizedAppsScriptBundle,
  loadAppsScriptTemplate,
} from '../appsScriptTemplate';
import { AppsScriptApiClient, LocalSandboxApiClient, WORKSPACE_STORAGE_KEY } from '../apiClient';
import {
  ACTIVE_SANDBOX_SESSION_PROOF_KEY,
  SUPER_ADMIN_PASSWORD_OVERRIDES_KEY,
  clearActiveSandboxSessionProof,
  derivePbkdf2Sha256PureJs,
  loadActiveSandboxSessionProof,
  verifySuperAdminPassword,
} from '../passwordAuthService';
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
    sessionStorage.clear();
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
      api.restoreSession('REC_ANY'),
      api.deleteSession('REC_ANY'),
      api.bulkDeleteSessions(['REC_ANY']),
      api.updateSchool({
        schoolRecordId: 'SCH_1',
        schoolName: 'Tampered',
        udiseCode: '33180100101',
        schoolType: 'Government school',
        district: 'Cuddalore',
        pinCode: '607106',
        active: true,
      }),
      api.deleteSchool('SCH_1'),
      api.deleteUser(SANDBOX_USERS.facilitator_2.userId),
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

  it('supports Super Admin restoreSession, deleteSession, bulkDeleteSessions, deleteUser (with PROTECTED_ACCOUNT), and School CRUD', async () => {
    let actorId: string = SANDBOX_USERS.facilitator.userId;
    const api = new LocalSandboxApiClient(() => actorId, createTestConfig());

    const s1 = await api.createSession(
      createValidFormValues({
        udiseCode: '01234567890',
        schoolName: 'GHSS Alpha',
        pinCode: '006001',
      }),
    );
    const s2 = await api.createSession(
      createValidFormValues({
        udiseCode: '09876543210',
        schoolName: 'GHSS Beta',
        district: 'Nagapattinam',
        pinCode: '006111',
      }),
    );
    const s3 = await api.createSession(
      createValidFormValues({
        udiseCode: '09876543210',
        schoolName: 'GHSS Beta',
        district: 'Nagapattinam',
        startTime: '14:00',
        endTime: '15:00',
        pinCode: '006111',
      }),
    );
    expect(s1.ok && s2.ok && s3.ok).toBe(true);

    actorId = SANDBOX_USERS.super_admin_1.userId;

    // 1. Archive -> Restore session
    const rec1 = s1.data!.session;
    const rec2 = s2.data!.session;
    const rec3 = s3.data!.session;
    expect((await api.archiveSession(rec1.sessionRecordId)).ok).toBe(true);
    expect((await api.getAdminSessions({ includeArchived: false })).data!.total).toBe(2);

    const restored = await api.restoreSession(rec1.sessionRecordId);
    expect(restored.ok).toBe(true);
    expect(restored.data!.archived).toBe(false);
    expect((await api.getAdminSessions({ includeArchived: false })).data!.total).toBe(3);

    // 2. Single delete & Bulk delete (keeps rec2 intact)
    const singleDeleted = await api.deleteSession(rec1.sessionRecordId);
    expect(singleDeleted.ok).toBe(true);
    expect(singleDeleted.data!.deleted).toBe(true);
    expect((await api.getSessionById(rec1.sessionRecordId)).code).toBe('NOT_FOUND');

    const bulkDeleted = await api.bulkDeleteSessions([rec3.sessionRecordId]);
    expect(bulkDeleted.ok).toBe(true);
    expect(bulkDeleted.data!.deletedCount).toBe(1);

    const afterBulk = await api.getAdminSessions({ includeArchived: true });
    expect(afterBulk.data!.items).toHaveLength(1);
    expect(afterBulk.data!.items[0]!.sessionRecordId).toBe(rec2.sessionRecordId);

    // 3. User deletion & protected Super Admin rejection
    expect((await api.deleteUser('brinthajayaprakash888@gmail.com')).code).toBe('PROTECTED_ACCOUNT');
    expect((await api.deleteUser(SANDBOX_USERS.super_admin_2.userId)).code).toBe(
      'PROTECTED_ACCOUNT',
    );
    const delFac2 = await api.deleteUser(SANDBOX_USERS.facilitator_2.userId);
    expect(delFac2.ok).toBe(true);
    expect(delFac2.data!.deleted).toBe(true);
    const managedUsers = await api.listManagedUsers();
    expect(managedUsers.data!.some((u) => u.email === SANDBOX_USERS.facilitator_2.email)).toBe(
      false,
    );

    // 4. School update (leading zeros + DUPLICATE_UDISE guard), inactive filtering & deletion
    const dirAll = await api.searchSchools('', true);
    expect(dirAll.ok).toBe(true);
    expect(dirAll.data!).toHaveLength(2);
    const alpha = dirAll.data!.find((s) => s.udiseCode === '01234567890')!;
    const beta = dirAll.data!.find((s) => s.udiseCode === '09876543210')!;

    const dupUpdate = await api.updateSchool({
      ...beta,
      udiseCode: '01234567890',
    });
    expect(dupUpdate.ok).toBe(false);
    expect(dupUpdate.code).toBe('DUPLICATE_UDISE');

    const editedAlpha = await api.updateSchool({
      ...alpha,
      schoolName: 'GHSS Alpha Canonical',
      udiseCode: '00001234567',
      pinCode: '000607',
      active: false,
    });
    expect(editedAlpha.ok).toBe(true);
    expect(editedAlpha.data!.udiseCode).toBe('00001234567');
    expect(editedAlpha.data!.active).toBe(false);
    expect((await api.searchSchools('00001234567', false)).data!).toHaveLength(0);
    expect((await api.searchSchools('00001234567', true)).data!).toHaveLength(1);

    const delAlpha = await api.deleteSchool(alpha.schoolRecordId);
    expect(delAlpha.ok).toBe(true);
    expect(delAlpha.data!.deleted).toBe(true);
    expect((await api.searchSchools('00001234567', true)).data!).toHaveLength(0);

    // Audit & Sync logs recorded cleanly
    const audit = await api.getAuditLogs(1, 50);
    const actions = audit.data!.items.map((a) => a.action);
    expect(actions).toContain('RESTORE_SESSION');
    expect(actions).toContain('DELETE_SESSION');
    expect(actions).toContain('BULK_DELETE_SESSIONS');
    expect(actions).toContain('DELETE_USER');
    expect(actions).toContain('UPDATE_SCHOOL');
    expect(actions).toContain('DELETE_SCHOOL');

    const syncLog = await api.getSyncLogs(1, 50);
    const ops = syncLog.data!.items.map((s) => s.operation);
    expect(ops).toContain('archiveSession');
    expect(ops).toContain('restoreSession');
    expect(ops).toContain('deleteSession');
    expect(ops).toContain('bulkDeleteSessions');
  });

  it('validates Apps Script /exec URLs & Google OAuth Web Client IDs strictly, rejects secrets, and probes endpoint readiness', async () => {
    expect(validateAppsScriptWebAppUrl('').valid).toBe(false);
    expect(
      validateAppsScriptWebAppUrl('http://script.google.com/macros/s/AKfycb1234567890abcdefghij/exec')
        .valid,
    ).toBe(false);
    expect(
      validateAppsScriptWebAppUrl('https://script.google.com/macros/s/AKfycb1234567890abcdefghij/dev')
        .valid,
    ).toBe(false);
    expect(
      validateAppsScriptWebAppUrl(
        'https://script.google.com/macros/s/AKfycb1234567890abcdefghij/exec?foo=bar',
      ).valid,
    ).toBe(false);
    expect(
      validateAppsScriptWebAppUrl('https://evil.example.com/macros/s/AKfycb1234567890abcdefghij/exec')
        .valid,
    ).toBe(false);
    expect(
      validateAppsScriptWebAppUrl('https://script.google.com/macros/s/AKfycb1234567890abcdefghij/exec')
        .valid,
    ).toBe(true);
    expect(
      validateAppsScriptWebAppUrl(
        'https://script.google.com/a/macros/vidhyavidhai.org/macros/s/AKfycb1234567890abcdefghij/exec',
      ).valid,
    ).toBe(true);

    expect(validateGoogleOAuthClientId('GOCSPX-secret-value').valid).toBe(false);
    expect(validateGoogleOAuthClientId('-----BEGIN PRIVATE KEY-----').valid).toBe(false);
    expect(validateGoogleOAuthClientId('not-a-valid-client').valid).toBe(false);
    expect(
      validateGoogleOAuthClientId('1234567890-abc123.apps.googleusercontent.com').valid,
    ).toBe(true);

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      fetchMock.mockResolvedValueOnce(
        new Response('<html>Sign in - Google Accounts</html>', { status: 200 }),
      );
      const htmlProbe = await probeAppsScriptEndpoint(
        'https://script.google.com/macros/s/AKfycb1234567890abcdefghij/exec',
      );
      expect(htmlProbe.ok).toBe(false);
      expect(htmlProbe.error).toMatch(/Who has access: Anyone/i);

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, status: 'READY', service: 'Career Tours API' }), {
          status: 200,
        }),
      );
      const readyProbe = await probeAppsScriptEndpoint(
        'https://script.google.com/macros/s/AKfycb1234567890abcdefghij/exec',
      );
      expect(readyProbe.ok).toBe(true);
      expect(readyProbe.status).toBe('READY');
    } finally {
      fetchMock.mockRestore();
    }

    saveRuntimeBackendConfig({
      appsScriptUrl: 'https://script.google.com/macros/s/AKfycb1234567890abcdefghij/exec',
      googleClientId: '1234567890-abc123.apps.googleusercontent.com',
      configuredBy: 'brinthajayaprakash888@gmail.com',
    });
    expect(loadRuntimeBackendConfig()?.configuredBy).toBe('brinthajayaprakash888@gmail.com');
    expect(getAuthEnvironment().isLiveBackendConfigured).toBe(true);
    expect(getAuthEnvironment().isRuntimeConfigured).toBe(true);

    // Reject tampered storage containing a secret key instead of Client ID
    localStorage.setItem(
      'ct_live_backend_config_v1',
      JSON.stringify({
        appsScriptUrl: 'https://script.google.com/macros/s/AKfycb1234567890abcdefghij/exec',
        googleClientId: 'GOCSPX-tampered',
      }),
    );
    expect(loadRuntimeBackendConfig()).toBeNull();
    clearRuntimeBackendConfig();
  });

  it('persists live Google ID tokens strictly in sessionStorage, normalizes unpadded JWT claims, and caches only non-secret Sheets metadata', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const rawJson = JSON.stringify({
      email: 'brinthajayaprakash888@gmail.com',
      name: 'Brintha',
      sub: 'sub-1',
      exp: futureExp,
    });
    const unpaddedPayload = btoa(rawJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const validJwt = `eyJhbGciOiJSUzI1NiJ9.${unpaddedPayload}.sig`;

    expect(decodeJwtClaimsUnsafe(validJwt)?.email).toBe('brinthajayaprakash888@gmail.com');
    expect(isJwtTokenUsable(validJwt, 30)).toBe(true);
    expect(isJwtTokenUsable(validJwt, 4000)).toBe(false);

    const clientId = '1234567890-abc123.apps.googleusercontent.com';
    saveActiveGoogleIdToken(validJwt, clientId);
    expect(loadActiveGoogleIdToken(clientId)).toBe(validJwt);
    expect(loadActiveGoogleIdToken('wrong-client.apps.googleusercontent.com')).toBeUndefined();

    // Credential MUST NEVER enter localStorage
    const allLocalValues = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.getItem(localStorage.key(i)!) ?? '',
    ).join(' ');
    expect(allLocalValues).not.toContain(validJwt);
    expect(allLocalValues).not.toContain('idToken');

    clearActiveGoogleIdToken();
    expect(loadActiveGoogleIdToken(clientId)).toBeUndefined();

    // Cached Sheets connection metadata strips stray secrets and clears cleanly
    const secretPolluted = {
      connected: true,
      authMethod: 'apps_script' as const,
      oauthConfigured: false,
      connectedAccount: 'brinthajayaprakash888@gmail.com',
      spreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      spreadsheetName: 'Vidhya Vidhai · Career Tours Database',
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
      connectedAt: '2026-11-11T00:00:00Z',
      connectedBy: 'brinthajayaprakash888@gmail.com',
      lastSyncedAt: '2026-11-11T00:00:00Z',
      lastSyncStatus: 'SYNCED' as const,
      lastSyncMessage: 'Synced',
      initializedTabs: ['Sessions'],
      defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      defaultSpreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
      idToken: validJwt,
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh-token',
    };
    saveCachedSheetsConnection('apps_script', secretPolluted);
    const cached = loadCachedSheetsConnection('apps_script');
    expect(cached?.connected).toBe(true);
    expect(cached?.spreadsheetName).toBe('Vidhya Vidhai · Career Tours Database');
    const serialized = JSON.stringify(cached);
    expect(serialized).not.toContain('idToken');
    expect(serialized).not.toContain('secret-access-token');
    expect(serialized).not.toContain('secret-refresh-token');

    clearCachedSheetsConnection('apps_script');
    expect(loadCachedSheetsConnection('apps_script')).toBeNull();
  });

  it('retries transient 503/HTML Apps Script errors, silently renews UNAUTHENTICATED tokens, and never downgrades getSheetsConnection on transient backend failures', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const makeJwt = (sub: string) =>
      `hdr.${btoa(JSON.stringify({ email: 'brinthajayaprakash888@gmail.com', sub, exp }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')}.sig`;

    let activeToken = makeJwt('tok-1');
    const refreshedToken = makeJwt('tok-2');
    const refreshIdToken = vi.fn(async (force?: boolean) => {
      if (force) {
        activeToken = refreshedToken;
        return refreshedToken;
      }
      return activeToken;
    });
    const onSessionExpired = vi.fn();

    const api = new AppsScriptApiClient(
      'https://script.google.com/macros/s/AKfycb1234567890abcdefghijklmnop/exec',
      () => activeToken,
      '/api/sheets',
      { refreshIdToken, onSessionExpired },
    );

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      // 1. Transient HTTP 503 + HTML gateway interstitial recover automatically on retry
      fetchMock
        .mockResolvedValueOnce(new Response('Service Busy', { status: 503 }))
        .mockResolvedValueOnce(new Response('<html>Temporary Google Proxy Error</html>', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, data: { mode: 'apps_script' } }), { status: 200 }),
        );
      const retryRes = await api.getAppConfiguration();
      expect(retryRes.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // 2. UNAUTHENTICATED triggers silent force refresh once and succeeds without signing out
      fetchMock.mockClear();
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: false, code: 'UNAUTHENTICATED', error: 'Expired' }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ok: true,
              data: { userId: 'SA_BRINTHA', email: 'brinthajayaprakash888@gmail.com' },
            }),
            { status: 200 },
          ),
        );
      const userRes = await api.getCurrentUser();
      expect(userRes.ok).toBe(true);
      expect(refreshIdToken).toHaveBeenCalledWith(true);
      expect(onSessionExpired).not.toHaveBeenCalled();

      // 3. Critical regression fix: /api/sheets returns disconnected while Apps Script is transiently failing -> MUST return ok: false (NOT connected: false)
      fetchMock.mockClear();
      fetchMock.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/sheets')) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: { connected: false, oauthConfigured: false, spreadsheetId: '' },
            }),
            { status: 200 },
          );
        }
        return new Response('Backend cold-start 503', { status: 503 });
      });

      const connErr = await api.getSheetsConnection();
      expect(connErr.ok).toBe(false);
      expect(connErr.code).toBe('NETWORK_ERROR');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('mirrors /api/sheets OAuth connect and disconnect state cleanly into LocalSandboxApiClient storage & cache', async () => {
    const api = new LocalSandboxApiClient(
      () => SANDBOX_USERS.super_admin_1.userId,
      createTestConfig(),
      '/api/sheets',
    );
    const connectedState = {
      connected: true,
      authMethod: 'google_oauth' as const,
      oauthConfigured: true,
      connectedAccount: 'brinthajayaprakash888@gmail.com',
      spreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      spreadsheetName: 'Vidhya Vidhai · Career Tours Database',
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
      connectedAt: '2026-11-11T00:00:00Z',
      connectedBy: 'brinthajayaprakash888@gmail.com',
      lastSyncedAt: '2026-11-11T00:00:00Z',
      lastSyncStatus: 'SYNCED' as const,
      lastSyncMessage: 'Connected',
      initializedTabs: ['Sessions'],
      defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      defaultSpreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: connectedState }), { status: 200 }),
      );
      const conn = await api.connectGoogleSheet({
        spreadsheetUrlOrId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      });
      expect(conn.ok).toBe(true);
      expect(loadCachedSheetsConnection('local_sandbox')?.spreadsheetId).toBe(
        '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      );

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { ...connectedState, connected: false, spreadsheetId: '' } }),
          { status: 200 },
        ),
      );
      const disc = await api.disconnectGoogleSheet();
      expect(disc.ok).toBe(true);
      expect(loadCachedSheetsConnection('local_sandbox')).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('persists Super Admin form CRUD via /api/sheets when Google OAuth is active, fails cleanly offline without faking LOCAL_SANDBOX, and never uses OAuth mode for Facilitators', async () => {
    const oauthState = {
      connected: true,
      authMethod: 'google_oauth' as const,
      oauthConfigured: true,
      connectedAccount: 'brinthajayaprakash888@gmail.com',
      spreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      spreadsheetName: 'Vidhya Vidhai · Career Tours Database',
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
      connectedAt: '2026-11-11T00:00:00Z',
      connectedBy: 'brinthajayaprakash888@gmail.com',
      lastSyncedAt: '2026-11-11T00:00:00Z',
      lastSyncStatus: 'SYNCED' as const,
      lastSyncMessage: 'Connected',
      initializedTabs: ['Sessions', 'Session Details'],
      defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      defaultSpreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
    };
    saveCachedSheetsConnection('local_sandbox', oauthState);

    let actorId: string = SANDBOX_USERS.super_admin_1.userId;
    const api = new LocalSandboxApiClient(() => actorId, createTestConfig(), '/api/sheets');

    const remoteSessions: Array<Record<string, unknown>> = [];
    const postedActions: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const action = String(body.action || '');
      postedActions.push(action);

      if (action === 'loadWorkspace') {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              sessions: remoteSessions,
              schools: [],
              users: [
                {
                  ...SANDBOX_USERS.facilitator,
                  createdAt: '2026-10-01T00:00:00Z',
                  updatedAt: '2026-10-01T00:00:00Z',
                },
              ],
              configurationPatch: {},
              auditLogs: [],
              syncLogs: [],
              spreadsheetId: oauthState.spreadsheetId,
            },
          }),
          { status: 200 },
        );
      }
      if (action === 'createSession') {
        const createdRec = {
          sessionRecordId: 'REC_OAUTH_1',
          sessionId: 'CT_IN_20261015_33180100101_08_A_001',
          clientSubmissionKey: body.values.clientSubmissionKey,
          facilitatorName: body.values.facilitatorName,
          facilitatorEmail: 'brinthajayaprakash888@gmail.com',
          facilitatorUserId: SANDBOX_USERS.super_admin_1.userId,
          tourId: body.values.tourId,
          tourName: 'Amazon Music: Careers Behind the Beats',
          videoId: 'AFE-IN-AM-OV-TA-2026',
          language: body.values.language,
          startDate: body.values.startDate,
          endDate: body.values.endDate,
          startTime: body.values.startTime,
          endTime: body.values.endTime,
          durationMinutes: 60,
          durationFormatted: '1 hr',
          reportingMonth: 'October',
          submissionTimestamp: '2026-10-15T05:00:00Z',
          submissionDateFormatted: '15-10-2026',
          schoolName: body.values.schoolName,
          udiseCode: body.values.udiseCode,
          schoolType: body.values.schoolType,
          state: body.values.state,
          district: body.values.district,
          pinCode: body.values.pinCode,
          sessionType: 'single',
          totalClasses: 1,
          totalStudentsPresent: 40,
          totalQuestionAResponses: 40,
          totalQuestionBResponses: 40,
          overallCsat: 4.5,
          overallItp: 4.4,
          teacherScore: 9,
          teacherClassification: 'Promoter',
          teacherNps: 100,
          submissionStatus: 'COMMITTED',
          syncStatus: 'SYNCED',
          createdAt: '2026-10-15T05:00:00Z',
          updatedAt: '2026-10-15T05:00:00Z',
          createdBy: 'brinthajayaprakash888@gmail.com',
          updatedBy: 'brinthajayaprakash888@gmail.com',
          archived: false,
          details: [],
        };
        remoteSessions.unshift(createdRec);
        return new Response(
          JSON.stringify({ ok: true, data: { session: createdRec, warnings: [] } }),
          { status: 200 },
        );
      }
      if (action === 'updateSession') {
        const updatedRec = {
          ...remoteSessions[0],
          schoolName: body.values.schoolName,
          submissionStatus: 'CORRECTED',
          syncStatus: 'SYNCED',
        };
        remoteSessions[0] = updatedRec;
        return new Response(
          JSON.stringify({ ok: true, data: { session: updatedRec, warnings: [] } }),
          { status: 200 },
        );
      }
      if (action === 'deleteSession') {
        remoteSessions.splice(0, 1);
        return new Response(
          JSON.stringify({ ok: true, data: { deleted: true, deletedDetailsCount: 1 } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected action ${action}`);
    });

    try {
      const formVals = createValidFormValues({
        clientSubmissionKey: 'oauth-test-key-1',
        facilitatorEmail: 'brinthajayaprakash888@gmail.com',
      });
      const created = await api.createSession(formVals);
      expect(created.ok).toBe(true);
      expect(created.data!.session.syncStatus).toBe('SYNCED');
      expect(postedActions).toContain('createSession');

      // Re-hydrating via invalidateWorkspaceCache pulls remote session cleanly
      api.invalidateWorkspaceCache();
      const adminList = await api.getAdminSessions({});
      expect(postedActions).toContain('loadWorkspace');
      expect(adminList.ok).toBe(true);
      expect(adminList.data!.items.some((s) => s.sessionRecordId === 'REC_OAUTH_1')).toBe(true);

      const updated = await api.updateSession('REC_OAUTH_1', {
        ...formVals,
        schoolName: 'GHSS Updated Live',
      });
      expect(updated.ok).toBe(true);
      expect(updated.data!.session.schoolName).toBe('GHSS Updated Live');
      expect(updated.data!.session.syncStatus).toBe('SYNCED');

      // Offline / network outage must return NETWORK_ERROR so outbox queues it instead of faking LOCAL_SANDBOX
      fetchMock.mockRejectedValueOnce(new Error('Network down'));
      const offlineCreate = await api.createSession(
        createValidFormValues({ clientSubmissionKey: 'oauth-offline-key' }),
      );
      expect(offlineCreate.ok).toBe(false);
      expect(offlineCreate.code).toBe('NETWORK_ERROR');

      const deleted = await api.deleteSession('REC_OAUTH_1');
      expect(deleted.ok).toBe(true);
      expect(deleted.data!.deleted).toBe(true);

      // Facilitator actor must NEVER send OAuth Sheets requests
      const callsBeforeFac = fetchMock.mock.calls.length;
      actorId = SANDBOX_USERS.facilitator.userId;
      const facRes = await api.createSession(
        createValidFormValues({ clientSubmissionKey: 'fac-local-key' }),
      );
      expect(facRes.ok).toBe(true);
      expect(facRes.data!.session.syncStatus).toBe('LOCAL_SANDBOX');
      expect(fetchMock.mock.calls.length).toBe(callsBeforeFac);
    } finally {
      fetchMock.mockRestore();
      clearCachedSheetsConnection('local_sandbox');
    }
  });

  it('remembers all signed-in accounts (more than 4), persists non-secret active login hints, and survives LocalSandboxApiClient reloads with zero data loss or leaked credentials', async () => {
    const accounts = [
      { email: 'brinthajayaprakash888@gmail.com', name: 'Brintha', role: 'super_admin' as const },
      { email: 'karunya@vidhyavidhai.org', name: 'Karunya', role: 'super_admin' as const },
      { email: 'facilitator1@vidhyavidhai.org', name: 'Facilitator One', role: 'facilitator' as const },
      { email: 'facilitator2@vidhyavidhai.org', name: 'Facilitator Two', role: 'facilitator' as const },
      { email: 'facilitator3@vidhyavidhai.org', name: 'Facilitator Three', role: 'facilitator' as const },
      { email: 'facilitator4@vidhyavidhai.org', name: 'Facilitator Four', role: 'facilitator' as const },
    ];
    for (const acc of accounts) {
      rememberRecentGoogleAccount(acc);
    }

    const remembered = loadRecentGoogleAccounts();
    expect(remembered).toHaveLength(6);
    expect(remembered[0]!.email).toBe('facilitator4@vidhyavidhai.org');
    expect(remembered.find((a) => a.email === 'karunya@vidhyavidhai.org')?.role).toBe('super_admin');

    // Re-remembering an older account moves it cleanly to the front without duplicating
    rememberRecentGoogleAccount({
      email: 'BRINTHAJAYAPRAKASH888@GMAIL.COM',
      name: 'Brintha J',
      role: 'super_admin',
    });
    const deduped = loadRecentGoogleAccounts();
    expect(deduped).toHaveLength(6);
    expect(deduped[0]!.email).toBe('brinthajayaprakash888@gmail.com');

    // Active Google hint binds to clientId and never stores raw tokens
    const clientId = '1234567890-abc123.apps.googleusercontent.com';
    saveActiveGoogleHint('brinthajayaprakash888@gmail.com', clientId);
    expect(loadActiveGoogleHint(clientId)?.email).toBe('brinthajayaprakash888@gmail.com');
    expect(loadActiveGoogleHint('different-client.apps.googleusercontent.com')).toBeNull();
    clearActiveGoogleHint();
    expect(loadActiveGoogleHint(clientId)).toBeNull();

    // Workspace persistence across reload (fresh LocalSandboxApiClient instance)
    let actorId: string = SANDBOX_USERS.facilitator.userId;
    const api1 = new LocalSandboxApiClient(() => actorId, createTestConfig(), '', undefined, {
      persistWorkspace: true,
    });
    const created = await api1.createSession(
      createValidFormValues({ schoolName: 'GHSS Persisted Reload School', udiseCode: '33180100888' }),
    );
    expect(created.ok).toBe(true);

    actorId = SANDBOX_USERS.super_admin_1.userId;
    const addedUser = await api1.manageUser({
      name: 'Persisted Teacher',
      email: 'persisted.teacher@vidhyavidhai.org',
      role: 'facilitator',
      active: true,
      status: 'APPROVED',
    });
    expect(addedUser.ok).toBe(true);
    const savedCfg = await api1.saveAppConfiguration({ schoolYear: '2027-2028' });
    expect(savedCfg.ok).toBe(true);

    const serializedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY) || '';
    expect(serializedWorkspace).toContain('GHSS Persisted Reload School');
    expect(serializedWorkspace).not.toContain('idToken');
    expect(serializedWorkspace).not.toContain('accessToken');

    // Simulate full browser reload by creating a brand new LocalSandboxApiClient instance
    const api2 = new LocalSandboxApiClient(
      () => SANDBOX_USERS.super_admin_1.userId,
      createTestConfig(),
      '',
      undefined,
      { persistWorkspace: true },
    );
    const reloadedSessions = await api2.getAdminSessions({});
    expect(reloadedSessions.ok).toBe(true);
    expect(
      reloadedSessions.data!.items.some((s) => s.schoolName === 'GHSS Persisted Reload School'),
    ).toBe(true);

    const reloadedUsers = await api2.listManagedUsers();
    expect(reloadedUsers.ok).toBe(true);
    expect(
      reloadedUsers.data!.some((u) => u.email === 'persisted.teacher@vidhyavidhai.org'),
    ).toBe(true);

    const reloadedCfg = await api2.getAppConfiguration();
    expect(reloadedCfg.ok).toBe(true);
    expect(reloadedCfg.data!.schoolYear).toBe('2027-2028');
  });

  it('requires valid salted PBKDF2-SHA256 password or active resumeToken for Super Admins across API login, password change, reload proof, and leaves zero plaintext secrets in storage/audit logs', async () => {
    // 1. Pure-JS PBKDF2-HMAC-SHA256 matches official RFC/Node crypto output for stored initial hashes
    expect(await verifySuperAdminPassword('brinthajayaprakash888@gmail.com', 'brintha888')).toBe(
      true,
    );
    expect(await verifySuperAdminPassword('karunya@vidhyavidhai.org', 'karunya@VV')).toBe(true);
    // Cross-admin passwords fail
    expect(await verifySuperAdminPassword('brinthajayaprakash888@gmail.com', 'karunya@VV')).toBe(
      false,
    );
    expect(await verifySuperAdminPassword('karunya@vidhyavidhai.org', 'brintha888')).toBe(false);
    // Spot-check PBKDF2 pure-JS reference output (hex of 1-iteration RFC/Node vector for 'password'/'salt')
    const enc = new TextEncoder();
    const rfcVecHex = Array.from(
      derivePbkdf2Sha256PureJs(enc.encode('password'), enc.encode('salt'), 1, 32),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(rfcVecHex).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');

    let actorId = '';
    const api = new LocalSandboxApiClient(() => actorId, createTestConfig());

    // 2. Super Admin login without password or with wrong password MUST be rejected
    const missingPw = await api.authenticateSandboxEmail('brinthajayaprakash888@gmail.com');
    expect(missingPw.ok).toBe(false);
    expect(missingPw.code).toBe('PASSWORD_REQUIRED');

    const emptyPw = await api.authenticateSandboxEmail('karunya@vidhyavidhai.org', 'Karunya', {
      password: '',
    });
    expect(emptyPw.ok).toBe(false);
    expect(emptyPw.code).toBe('PASSWORD_REQUIRED');

    const wrongPw = await api.authenticateSandboxEmail('brinthajayaprakash888@gmail.com', 'Brintha', {
      password: 'not-the-password',
    });
    expect(wrongPw.ok).toBe(false);
    expect(wrongPw.code).toBe('INVALID_PASSWORD');

    const invalidToken = await api.authenticateSandboxEmail('karunya@vidhyavidhai.org', 'Karunya', {
      resumeToken: 'forged-token-value',
    });
    expect(invalidToken.ok).toBe(false);
    expect(invalidToken.code).toBe('INVALID_PASSWORD');

    // 3. Valid password login (with whitespace/mixed case email) succeeds and mints active resume proof
    const okLogin = await api.authenticateSandboxEmail(
      '  BRINTHAJAYAPRAKASH888@GMAIL.COM ',
      'Brintha',
      { password: 'brintha888' },
    );
    expect(okLogin.ok).toBe(true);
    expect(okLogin.data!.role).toBe('super_admin');

    const proof1 = loadActiveSandboxSessionProof();
    expect(proof1?.email).toBe('brinthajayaprakash888@gmail.com');
    expect(proof1?.resumeToken.length).toBeGreaterThanOrEqual(16);

    // Reload restoration using valid resumeToken succeeds without retyping password
    const resumeRes = await api.authenticateSandboxEmail(
      'brinthajayaprakash888@gmail.com',
      'Brintha',
      { resumeToken: proof1!.resumeToken },
    );
    expect(resumeRes.ok).toBe(true);
    expect(resumeRes.data!.userId).toBe(SANDBOX_USERS.super_admin_1.userId);

    // 4. Facilitators remain passwordless and cannot invoke changeSuperAdminPassword
    actorId = SANDBOX_USERS.facilitator.userId;
    const facRes = await api.authenticateSandboxEmail(SANDBOX_USERS.facilitator.email);
    expect(facRes.ok).toBe(true);
    expect(facRes.data!.role).toBe('facilitator');
    const facPwChange = await api.changeSuperAdminPassword('anything', 'NewPassword123');
    expect(facPwChange.ok).toBe(false);
    expect(facPwChange.code).toBe('FORBIDDEN');

    // 5. Super Admin password change enforces checks, updates salted hash override, rotates proof, and invalidates old password
    actorId = SANDBOX_USERS.super_admin_1.userId;
    expect((await api.changeSuperAdminPassword('wrong-old', 'BrinthaUpdated1!')).code).toBe(
      'INVALID_CURRENT_PASSWORD',
    );
    expect((await api.changeSuperAdminPassword('brintha888', 'short')).code).toBe('WEAK_PASSWORD');
    expect((await api.changeSuperAdminPassword('brintha888', 'brintha888')).code).toBe(
      'PASSWORD_UNCHANGED',
    );

    const changed = await api.changeSuperAdminPassword('brintha888', 'BrinthaUpdated#2026');
    expect(changed.ok).toBe(true);

    const proof2 = loadActiveSandboxSessionProof();
    expect(proof2?.resumeToken).not.toBe(proof1!.resumeToken);

    // Old password rejected, new password accepted
    expect(
      (
        await api.authenticateSandboxEmail('brinthajayaprakash888@gmail.com', 'Brintha', {
          password: 'brintha888',
        })
      ).code,
    ).toBe('INVALID_PASSWORD');
    expect(
      (
        await api.authenticateSandboxEmail('brinthajayaprakash888@gmail.com', 'Brintha', {
          password: 'BrinthaUpdated#2026',
        })
      ).ok,
    ).toBe(true);

    // 6. Zero plaintext passwords anywhere in localStorage, sessionStorage, or Audit Log
    const rawStorageDump = JSON.stringify({
      ls: { ...localStorage },
      ss: { ...sessionStorage },
    });
    expect(rawStorageDump).not.toContain('brintha888');
    expect(rawStorageDump).not.toContain('karunya@VV');
    expect(rawStorageDump).not.toContain('BrinthaUpdated#2026');

    const storedOverrides = JSON.parse(
      localStorage.getItem(SUPER_ADMIN_PASSWORD_OVERRIDES_KEY) || '{}',
    );
    expect(storedOverrides['brinthajayaprakash888@gmail.com']?.algorithm).toBe('pbkdf2-sha256');
    expect(storedOverrides['brinthajayaprakash888@gmail.com']?.iterations).toBe(100000);

    const audit = await api.getAuditLogs(1, 50);
    const auditActions = audit.data!.items.map((a) => a.action);
    expect(auditActions).toContain('AUTH_PASSWORD_FAILED');
    expect(auditActions).toContain('AUTH_PASSWORD_VERIFIED');
    expect(auditActions).toContain('CHANGE_ADMIN_PASSWORD');
    const serializedAudit = JSON.stringify(audit.data!.items);
    expect(serializedAudit).not.toContain('BrinthaUpdated#2026');
    expect(serializedAudit).not.toContain('brintha888');
    expect(serializedAudit).not.toContain(storedOverrides['brinthajayaprakash888@gmail.com'].hashHex);

    clearActiveSandboxSessionProof();
    expect(localStorage.getItem(ACTIVE_SANDBOX_SESSION_PROOF_KEY)).toBeNull();
  });

  it('bundles personalized CareerToursAllInOne.gs, connects via Apps Script Sync Bridge (auto/create/existing), syncs idempotently, and never leaks syncKeys', async () => {
    clearAppsScriptBridgeConfig();
    const generatedKey = generateAppsScriptSyncKey();
    expect(validateAppsScriptSyncKey(generatedKey).valid).toBe(true);
    expect(validateAppsScriptSyncKey('short-key').valid).toBe(false);

    const template = await loadAppsScriptTemplate();
    expect(template).toContain('CT_PRESET_SANDBOX_SYNC_KEY');
    expect(template).toContain('setupForLocalSandbox');

    const personalized = buildPersonalizedAppsScriptBundle(template, generatedKey);
    expect(personalized).toContain(`var CT_PRESET_SANDBOX_SYNC_KEY = '${generatedKey}';`);
    expect(personalized).not.toContain('__CT_PRESET_SYNC_KEY__');

    // Invalid key leaves template untouched safely
    expect(buildPersonalizedAppsScriptBundle(template, 'bad')).toBe(template);

    const bridgeExecUrl = 'https://script.google.com/macros/s/AKfycbBridgeTest1234567890/exec';
    let actorId: string = SANDBOX_USERS.super_admin_1.userId;
    const api = new LocalSandboxApiClient(() => actorId, createTestConfig());
    const localPreSession = await api.createSession(
      createValidFormValues({
        clientSubmissionKey: 'pre-bridge-local-1',
        schoolName: 'GHSS Pre-Bridge Local',
        udiseCode: '33180100301',
      }),
    );
    expect(localPreSession.ok).toBe(true);

    const syncedRecordIds = new Set<string>();
    const remoteSessions = new Map<string, Record<string, unknown>>();
    const bridgeCalls: Array<{ action: string; syncKey: string; actorEmail: string }> = [];
    let connectedSheet = {
      spreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      spreadsheetName: 'Vidhya Vidhai · Official Target',
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const urlStr = String(input);
      expect(urlStr).toBe(bridgeExecUrl);
      const parsed = JSON.parse(String(init?.body || '{}')) as {
        action: string;
        syncKey?: string;
        actorEmail?: string;
        payload?: Record<string, unknown>;
      };
      bridgeCalls.push({
        action: parsed.action,
        syncKey: parsed.syncKey || '',
        actorEmail: parsed.actorEmail || '',
      });

      const baseConn = {
        connected: true,
        authMethod: 'apps_script',
        connectionProvider: 'apps_script',
        oauthConfigured: true,
        connectedAccount: parsed.actorEmail || 'brinthajayaprakash888@gmail.com',
        spreadsheetId: connectedSheet.spreadsheetId,
        spreadsheetName: connectedSheet.spreadsheetName,
        spreadsheetUrl: connectedSheet.spreadsheetUrl,
        connectedAt: '2026-11-11T04:00:00Z',
        connectedBy: parsed.actorEmail || 'brinthajayaprakash888@gmail.com',
        lastSyncedAt: '2026-11-11T04:00:00Z',
        lastSyncStatus: 'SYNCED',
        lastSyncMessage: 'Bridge synced',
        initializedTabs: [
          'Sessions',
          'Session Details',
          'Facilitators',
          'Schools',
          'Configuration',
          'Admin Users',
          'Audit Log',
          'Sync Log',
        ],
        defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
        defaultSpreadsheetUrl:
          'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit',
      };

      if (parsed.action === 'getSheetsConnection') {
        return new Response(JSON.stringify({ ok: true, data: baseConn }), { status: 200 });
      }
      if (parsed.action === 'createGoogleSheet') {
        const title = String(parsed.payload?.title || 'Relative Sheet');
        connectedSheet = {
          spreadsheetId: 'BRIDGE_CREATED_SHEET_1',
          spreadsheetName: title,
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/BRIDGE_CREATED_SHEET_1/edit',
        };
        syncedRecordIds.clear();
        remoteSessions.clear();
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              ...baseConn,
              spreadsheetId: connectedSheet.spreadsheetId,
              spreadsheetName: title,
              spreadsheetUrl: connectedSheet.spreadsheetUrl,
            },
          }),
          { status: 200 },
        );
      }
      if (parsed.action === 'connectGoogleSheet') {
        const targetId = String(parsed.payload?.spreadsheetUrlOrId || 'EXISTING_SHEET_99');
        connectedSheet = {
          spreadsheetId: targetId,
          spreadsheetName: `Connected ${targetId}`,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${targetId}/edit`,
        };
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              ...baseConn,
              spreadsheetId: connectedSheet.spreadsheetId,
              spreadsheetName: connectedSheet.spreadsheetName,
              spreadsheetUrl: connectedSheet.spreadsheetUrl,
            },
          }),
          { status: 200 },
        );
      }
      if (parsed.action === 'syncAllToGoogleSheet') {
        const incoming = (parsed.payload?.sessions || []) as Array<Record<string, unknown>>;
        let syncedCount = 0;
        let skippedDuplicates = 0;
        for (const s of incoming) {
          const id = String(s.sessionRecordId || '');
          if (syncedRecordIds.has(id)) {
            skippedDuplicates++;
          } else {
            syncedRecordIds.add(id);
            remoteSessions.set(id, s);
            syncedCount++;
          }
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              syncedCount,
              skippedDuplicates,
              totalSheets: 10,
              spreadsheetUrl: connectedSheet.spreadsheetUrl,
              syncedAt: '2026-11-11T04:01:00Z',
              message: `Synced ${syncedCount}, skipped ${skippedDuplicates}`,
            },
          }),
          { status: 200 },
        );
      }
      if (parsed.action === 'loadWorkspace') {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              connection: baseConn,
              configuration: {},
              sessions: [...remoteSessions.values()],
              schools: [],
              users: [],
              auditLogs: { items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 },
              syncLogs: { items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 },
              loadedAt: '2026-11-11T04:02:00Z',
            },
          }),
          { status: 200 },
        );
      }
      if (parsed.action === 'createSession') {
        const vals = (parsed.payload?.values || {}) as Record<string, unknown>;
        const rec = {
          ...localPreSession.data!.session,
          sessionRecordId: 'REC_BRIDGE_LIVE_2',
          sessionId: 'CT_IN_20261111_33180100302_08_A_001',
          clientSubmissionKey: vals.clientSubmissionKey,
          schoolName: vals.schoolName,
          udiseCode: vals.udiseCode,
          syncStatus: 'SYNCED',
        };
        remoteSessions.set(rec.sessionRecordId, rec);
        syncedRecordIds.add(rec.sessionRecordId);
        return new Response(JSON.stringify({ ok: true, data: { session: rec, warnings: [] } }), {
          status: 200,
        });
      }
      if (parsed.action === 'disconnectGoogleSheet') {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { ...baseConn, connected: false, spreadsheetId: '', spreadsheetName: '', spreadsheetUrl: '' },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected bridge action ${parsed.action}`);
    });

    try {
      // 1. Connect via 'auto' mode
      const autoRes = await api.connectAppsScriptBridge!({
        appsScriptUrl: bridgeExecUrl,
        syncKey: generatedKey,
        targetMode: 'auto',
      });
      expect(autoRes.ok).toBe(true);
      expect(autoRes.data!.connection.authMethod).toBe('apps_script');
      expect(autoRes.data!.connection.connectionProvider).toBe('apps_script');
      expect(loadAppsScriptBridgeConfig()?.syncKey).toBe(generatedKey);

      // 2. Create relative-title sheet -> pushes pre-bridge local session cleanly
      const createRes = await api.connectAppsScriptBridge!({
        appsScriptUrl: bridgeExecUrl,
        syncKey: generatedKey,
        targetMode: 'create',
        sheetTitle: 'Career Tours · Cuddalore · Nov 2026',
      });
      expect(createRes.ok).toBe(true);
      expect(createRes.data!.connection.spreadsheetName).toBe('Career Tours · Cuddalore · Nov 2026');
      expect(createRes.data!.syncSummary?.syncedCount).toBe(1);

      // Repeat sync skips duplicate seamlessly
      const secondSync = await api.syncAllToGoogleSheet({ forceAppsScriptBridge: true });
      expect(secondSync.ok).toBe(true);
      expect(secondSync.data!.skippedDuplicates).toBe(1);
      expect(secondSync.data!.syncedCount).toBe(0);

      // 3. Submitting a new form entry routes live via Apps Script Bridge (no local downgrade)
      const liveEntry = await api.createSession(
        createValidFormValues({
          clientSubmissionKey: 'bridge-live-submit-2',
          schoolName: 'GHSS Bridge Live Two',
          udiseCode: '33180100302',
        }),
      );
      expect(liveEntry.ok).toBe(true);
      expect(liveEntry.data!.session.syncStatus).toBe('SYNCED');
      expect(bridgeCalls.some((c) => c.action === 'createSession' && c.syncKey === generatedKey)).toBe(true);

      // 4. Existing target switch mode
      const existingRes = await api.connectAppsScriptBridge!({
        appsScriptUrl: bridgeExecUrl,
        syncKey: generatedKey,
        targetMode: 'existing',
        spreadsheetUrlOrId: 'EXISTING_SHEET_99',
      });
      expect(existingRes.ok).toBe(true);
      expect(existingRes.data!.connection.spreadsheetId).toBe('EXISTING_SHEET_99');

      // 5. Facilitator actor NEVER triggers Bridge requests or accesses connectAppsScriptBridge
      const callCountBeforeFac = fetchMock.mock.calls.length;
      actorId = SANDBOX_USERS.facilitator.userId;
      expect((await api.connectAppsScriptBridge!({
        appsScriptUrl: bridgeExecUrl,
        syncKey: generatedKey,
        targetMode: 'auto',
      })).code).toBe('FORBIDDEN');
      const facCreate = await api.createSession(
        createValidFormValues({ clientSubmissionKey: 'fac-isolated-1', udiseCode: '33180100303' }),
      );
      expect(facCreate.ok).toBe(true);
      expect(facCreate.data!.session.syncStatus).toBe('LOCAL_SANDBOX');
      expect(fetchMock.mock.calls.length).toBe(callCountBeforeFac);

      // 6. Disconnect -> reconnect succeeds via Bridge
      actorId = SANDBOX_USERS.super_admin_1.userId;
      const disc = await api.disconnectGoogleSheet();
      expect(disc.ok).toBe(true);
      expect(disc.data!.connected).toBe(false);

      const reconnected = await api.connectAppsScriptBridge!({
        appsScriptUrl: bridgeExecUrl,
        syncKey: generatedKey,
        targetMode: 'existing',
        spreadsheetUrlOrId: 'BRIDGE_CREATED_SHEET_1',
      });
      expect(reconnected.ok).toBe(true);
      expect(reconnected.data!.connection.connected).toBe(true);

      // 7. Zero passphrase leakage in workspace JSON, cached Sheets connection metadata, Audit Log, or Sync Log
      const workspaceRaw = localStorage.getItem(WORKSPACE_STORAGE_KEY) || '';
      const cachedMetaRaw = JSON.stringify(loadCachedSheetsConnection('local_sandbox') || {});
      const auditRaw = JSON.stringify((await api.getAuditLogs(1, 50)).data?.items || []);
      const syncRaw = JSON.stringify((await api.getSyncLogs(1, 50)).data?.items || []);
      for (const dump of [workspaceRaw, cachedMetaRaw, auditRaw, syncRaw]) {
        expect(dump).not.toContain(generatedKey);
      }
    } finally {
      clearAppsScriptBridgeConfig();
      clearCachedSheetsConnection('local_sandbox');
      fetchMock.mockRestore();
    }
  });
});
