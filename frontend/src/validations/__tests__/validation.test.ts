import { describe, expect, it } from 'vitest';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import {
  calculateSessionDurationMinutes,
  formatDurationHuman,
  getTodayKolkataISO,
} from '../../utils/temporal';
import { validateSessionForm } from '../sessionValidation';

describe('Form Validation & Temporal Rules (Asia/Kolkata)', () => {
  it('accepts a valid single-class submission with zero errors or warnings', () => {
    const cfg = createTestConfig();
    const values = createValidFormValues();
    const res = validateSessionForm(values, cfg);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).toHaveLength(0);
  });

  it('rejects UDISE codes shorter/longer than 11 digits or non-numeric, while accepting leading zeroes', () => {
    const cfg = createTestConfig();
    expect(
      validateSessionForm(createValidFormValues({ udiseCode: '12345' }), cfg).errors.some(
        (e) => e.code === 'UDISE_INVALID',
      ),
    ).toBe(true);
    expect(
      validateSessionForm(createValidFormValues({ udiseCode: '3318010010A' }), cfg).errors.some(
        (e) => e.code === 'UDISE_INVALID',
      ),
    ).toBe(true);
    expect(
      validateSessionForm(createValidFormValues({ udiseCode: '01234567890' }), cfg).valid,
    ).toBe(true);
  });

  it('rejects invalid PIN codes', () => {
    const cfg = createTestConfig();
    const res = validateSessionForm(createValidFormValues({ pinCode: '6071' }), cfg);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.code === 'PIN_INVALID')).toBe(true);
  });

  it('rejects unapproved districts and unconfigured block lists', () => {
    const cfg = createTestConfig();
    const badDistrict = validateSessionForm(
      createValidFormValues({ district: 'Chennai', block: 'Adyar' }),
      cfg,
    );
    expect(badDistrict.errors.some((e) => e.code === 'DISTRICT_INVALID')).toBe(true);

    const emptyBlocksCfg = createTestConfig({ districtBlocks: [] });
    const unconfiguredBlock = validateSessionForm(
      createValidFormValues({ district: 'Cuddalore', block: '' }),
      emptyBlocksCfg,
    );
    expect(
      unconfiguredBlock.errors.some(
        (e) =>
          e.code === 'BLOCKS_NOT_CONFIGURED' &&
          e.message === 'Block list not configured. Please contact the administrator.',
      ),
    ).toBe(true);
  });

  it('rejects negative/decimal student counts and response counts exceeding students present', () => {
    const cfg = createTestConfig();
    const badDecimal = createValidFormValues();
    badDecimal.classes[0]!.questionA.score5 = '4.5';
    expect(validateSessionForm(badDecimal, cfg).errors.some((e) => e.code === 'SCORE_COUNT_INVALID')).toBe(true);

    const badNeg = createValidFormValues();
    badNeg.classes[0]!.questionB.score1 = '-1';
    expect(validateSessionForm(badNeg, cfg).errors.some((e) => e.code === 'SCORE_COUNT_INVALID')).toBe(true);

    const exceeds = createValidFormValues();
    exceeds.classes[0]!.studentsPresent = '20';
    exceeds.classes[0]!.questionA.score5 = '25';
    expect(validateSessionForm(exceeds, cfg).errors.some((e) => e.code === 'QA_EXCEEDS_PRESENT')).toBe(true);
  });

  it('emits non-blocking warnings when coverage < 75% or Question A/B counts differ', () => {
    const cfg = createTestConfig();
    const values = createValidFormValues();
    values.classes[0]!.studentsPresent = '40';
    values.classes[0]!.questionA = { score5: '20', score4: '0', score3: '0', score2: '0', score1: '0' }; // 50%
    values.classes[0]!.questionB = { score5: '25', score4: '0', score3: '0', score2: '0', score1: '0' }; // differs from QA

    const res = validateSessionForm(values, cfg);
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.code === 'LOW_RESPONSE_COVERAGE')).toBe(true);
    expect(res.warnings.some((w) => w.code === 'QA_QB_TOTAL_MISMATCH')).toBe(true);
  });

  it('handles overnight and multi-day sessions accurately and blocks end <= start or future dates', () => {
    const cfg = createTestConfig();
    // Overnight session: yesterday 23:15 -> today 00:45 = 90 mins (1 hr 30 mins)
    const today = getTodayKolkataISO();
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);

    const minsOvernight = calculateSessionDurationMinutes(yesterday, '23:15', today, '00:45');
    expect(minsOvernight).toBe(90);
    expect(formatDurationHuman(minsOvernight)).toBe('1 hr 30 mins');

    const overnightRes = validateSessionForm(
      createValidFormValues({
        startDate: yesterday,
        endDate: today,
        startTime: '23:15',
        endTime: '00:45',
      }),
      cfg,
    );
    expect(overnightRes.valid).toBe(true);

    // Same day end before start is rejected
    const badTime = validateSessionForm(
      createValidFormValues({
        startDate: yesterday,
        endDate: yesterday,
        startTime: '14:00',
        endTime: '13:30',
      }),
      cfg,
    );
    expect(badTime.errors.some((e) => e.code === 'END_BEFORE_START_TIME')).toBe(true);

    // Future date rejected
    const future = new Date(`${today}T00:00:00Z`);
    future.setUTCDate(future.getUTCDate() + 2);
    const futureRes = validateSessionForm(
      createValidFormValues({ startDate: future.toISOString().slice(0, 10) }),
      cfg,
    );
    expect(futureRes.errors.some((e) => e.code === 'START_DATE_FUTURE')).toBe(true);
  });

  it('enforces combined-class row count (2..10) and duplicate grade/section rejection', () => {
    const cfg = createTestConfig();
    const oneRowCombined = createValidFormValues({ sessionMode: 'combined' });
    expect(
      validateSessionForm(oneRowCombined, cfg).errors.some((e) => e.code === 'COMBINED_CLASS_ROW_COUNT'),
    ).toBe(true);

    const dupRows = createValidFormValues({
      sessionMode: 'combined',
      classes: [
        {
          rowId: 'r1',
          grade: '8',
          section: 'A',
          studentsPresent: '20',
          questionA: { score5: '20', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '20', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
        {
          rowId: 'r2',
          grade: '8',
          section: 'A',
          studentsPresent: '25',
          questionA: { score5: '25', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '25', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
      ],
    });
    expect(
      validateSessionForm(dupRows, cfg).errors.some((e) => e.code === 'DUPLICATE_CLASS_ROW'),
    ).toBe(true);
  });
});
