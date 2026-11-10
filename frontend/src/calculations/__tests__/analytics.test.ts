import { describe, expect, it } from 'vitest';
import { computeDashboardAnalytics, reconcileDashboardAnalytics } from '../analytics';
import { LocalSandboxApiClient } from '../../services/apiClient';
import { SANDBOX_USERS } from '../../services/authService';
import { createTestConfig, createValidFormValues } from '../../testFixtures';

describe('Program Analytics Pooling, Sentiment, Missing Responses & Reconciliation', () => {
  it('computes pooled unweighted-response-sum CSAT/ITP without averaging rounded session means, counts single-counted attendance, and reconciles cleanly', async () => {
    let actorId = SANDBOX_USERS.facilitator.userId;
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => actorId, cfg);

    // Session 1: 100 students, all 100 vote 5 on Q-A -> CSAT = 5.00; 80 vote 4 on Q-B -> Missing QB = 20
    const s1 = await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Panruti North',
        udiseCode: '33180100101',
        district: 'Cuddalore',
        block: 'Panruti',
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        classes: [
          {
            rowId: 'r1',
            grade: '8',
            section: 'A',
            studentsPresent: '100',
            questionA: { score5: '100', score4: '0', score3: '0', score2: '0', score1: '0' },
            questionB: { score5: '0', score4: '80', score3: '0', score2: '0', score1: '0' },
          },
        ],
        teacherNpsGroup: 'promoter',
        teacherExactScore: '10',
      }),
    );
    expect(s1.ok).toBe(true);

    // Session 2: 10 students, all 10 vote 1 on Q-A -> CSAT = 1.00; 10 vote 1 on Q-B
    // Unweighted mean of session CSATs would wrongly be (5.00 + 1.00)/2 = 3.00.
    // Correct pooled CSAT = (500 + 10) / 110 = 4.64!
    const s2 = await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Kilvelur South',
        udiseCode: '33190200202',
        district: 'Nagapattinam',
        block: 'Kilvelur',
        tourId: 'TOUR_RFC',
        language: 'English',
        startDate: '2026-11-05',
        endDate: '2026-11-05',
        classes: [
          {
            rowId: 'r2',
            grade: '9',
            section: 'B',
            studentsPresent: '10',
            questionA: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '10' },
            questionB: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '10' },
          },
        ],
        teacherNpsGroup: 'passive',
        teacherExactScore: '7',
      }),
    );
    expect(s2.ok).toBe(true);

    // Inject one PENDING session & one unapproved district session (must be excluded)
    api.setSimulatePartialFailureOnce(true);
    const pendingAttempt = await api.createSession(
      createValidFormValues({ udiseCode: '33180100888', schoolName: 'Crashed Session' }),
    );
    expect(pendingAttempt.ok).toBe(false);

    const rawAll = api.getRawSessionsForTest();
    expect(rawAll).toHaveLength(3);

    const analytics = computeDashboardAnalytics(rawAll, {}, cfg);

    expect(analytics.totalSessions).toBe(2);
    // Single-counted attendance: 100 + 10 = 110 (never double-counted across Q-A & Q-B)
    expect(analytics.totalStudentsReached).toBe(110);
    expect(analytics.totalSchoolsCovered).toBe(2);
    expect(analytics.totalQuestionAResponses).toBe(110);
    expect(analytics.totalQuestionBResponses).toBe(90);
    expect(analytics.totalMissingResponsesQA).toBe(0);
    expect(analytics.totalMissingResponsesQB).toBe(20);
    expect(analytics.averageCsat).toBe(4.64);
    expect(analytics.averageItp).toBe(3.67); // (320 + 10) / 90 = 3.6666...
    expect(analytics.teacherNpsAverage).toBe(50); // (+100 + 0) / 2
    expect(analytics.qaSentiment.positiveCount).toBe(100);
    expect(analytics.qaSentiment.negativeCount).toBe(10);
    expect(analytics.monthlyBreakdown.map((m) => m.monthKey)).toEqual(['2026-10', '2026-11']);
    expect(analytics.schoolBreakdown).toHaveLength(2);
    expect(analytics.languageBreakdown).toHaveLength(2);
    expect(analytics.dataQuality.excludedPendingCount).toBe(1);
    expect(analytics.dataQuality.qaQbMismatchCount).toBe(1);
    expect(analytics.reconciliation.verified).toBe(true);
    expect(analytics.reconciliation.checksRun).toBe(12);
    expect(analytics.reconciliation.discrepancies).toHaveLength(0);

    // Switch actor to Super Admin and verify API endpoint returns identical reconciled totals
    actorId = SANDBOX_USERS.super_admin_1.userId;
    const summaryRes1 = await api.getDashboardSummary({});
    expect(summaryRes1.ok).toBe(true);
    expect(summaryRes1.data!.averageCsat).toBe(4.64);
    expect(summaryRes1.data!.reconciliation.verified).toBe(true);

    actorId = SANDBOX_USERS.super_admin_2.userId;
    const summaryRes2 = await api.getDashboardSummary({});
    expect(summaryRes2.ok).toBe(true);
    expect(summaryRes2.data!.averageCsat).toBe(4.64);
  });

  it('handles zero sessions and zero votes safely (null instead of NaN/Infinity) and detects injected reconciliation discrepancies', () => {
    const cfg = createTestConfig();
    const empty = computeDashboardAnalytics([], {}, cfg);

    expect(empty.totalSessions).toBe(0);
    expect(empty.totalStudentsReached).toBe(0);
    expect(empty.averageCsat).toBeNull();
    expect(empty.averageItp).toBeNull();
    expect(empty.teacherNpsAverage).toBeNull();
    expect(empty.missingResponseRateQaPct).toBeNull();
    expect(empty.reconciliation.verified).toBe(true);
    expect(Number.isNaN(empty.averageCsat as unknown as number)).toBe(false);

    // Inject tampering mismatch -> reconcileDashboardAnalytics must catch and report it explicitly
    const tampered = { ...empty, totalStudentsReached: 42, averageCsat: 4.5 };
    const report = reconcileDashboardAnalytics([], tampered);
    expect(report.verified).toBe(false);
    expect(report.discrepancies.length).toBeGreaterThanOrEqual(2);
  });
});
