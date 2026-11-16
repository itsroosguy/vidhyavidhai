import { describe, expect, it } from 'vitest';
import {
  buildCalculationWorking,
  calculateSessionMetrics,
  resolveTeacherNps,
} from '../metrics';
import type { ClassGroupInput } from '../../types/domain';

describe('Calculation Engine — CSAT, ITP, Combined Pooling & Teacher NPS', () => {
  it('computes 5.00 when all students answer 5', () => {
    const classes: ClassGroupInput[] = [
      {
        rowId: '1',
        grade: '8',
        section: 'A',
        studentsPresent: '30',
        questionA: { score5: '30', score4: '0', score3: '0', score2: '0', score1: '0' },
        questionB: { score5: '30', score4: '0', score3: '0', score2: '0', score1: '0' },
      },
    ];
    const m = calculateSessionMetrics(classes, 'promoter', '10');
    expect(m.overallCsat).toBe(5);
    expect(m.overallItp).toBe(5);
    expect(m.totalQuestionAResponses).toBe(30);
    expect(m.teacherNps).toBe(100);
    expect(m.teacherClassification).toBe('Promoter');
  });

  it('computes 1.00 when all students answer 1', () => {
    const classes: ClassGroupInput[] = [
      {
        rowId: '1',
        grade: '9',
        section: 'B',
        studentsPresent: '15',
        questionA: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '15' },
        questionB: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '15' },
      },
    ];
    const m = calculateSessionMetrics(classes, 'detractor', '4');
    expect(m.overallCsat).toBe(1);
    expect(m.overallItp).toBe(1);
    expect(m.teacherNps).toBe(-100);
    expect(m.teacherClassification).toBe('Detractor');
  });

  it('computes mixed counts rounded accurately to 2 decimal places', () => {
    // Weighted = 5*10 + 4*8 + 3*4 + 2*2 + 1*1 = 50 + 32 + 12 + 4 + 1 = 99; total = 25 -> 99/25 = 3.96
    // QB Weighted = 5*7 + 4*9 + 3*5 + 2*1 + 1*1 = 35 + 36 + 15 + 2 + 1 = 89; total = 23 -> 89/23 = 3.86956 -> 3.87
    const classes: ClassGroupInput[] = [
      {
        rowId: '1',
        grade: '10',
        section: 'C',
        studentsPresent: '30',
        questionA: { score5: '10', score4: '8', score3: '4', score2: '2', score1: '1' },
        questionB: { score5: '7', score4: '9', score3: '5', score2: '1', score1: '1' },
      },
    ];
    const m = calculateSessionMetrics(classes, 'passive', '8');
    expect(m.overallCsat).toBe(3.96);
    expect(m.overallItp).toBe(3.87);
    expect(m.teacherNps).toBe(0);
    expect(m.teacherClassification).toBe('Passive');
  });

  it('handles 0 student responses cleanly without divide-by-zero / NaN', () => {
    const classes: ClassGroupInput[] = [
      {
        rowId: '1',
        grade: '8',
        section: 'A',
        studentsPresent: '25',
        questionA: { score5: '', score4: '', score3: '', score2: '', score1: '' },
        questionB: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '0' },
      },
    ];
    const m = calculateSessionMetrics(classes, '', '');
    expect(m.overallCsat).toBeNull();
    expect(m.overallItp).toBeNull();
    expect(m.totalQuestionAResponses).toBe(0);
    expect(m.overallQuestionACoveragePct).toBe(0);
    expect(m.teacherNps).toBeNull();
  });

  it('computes combined-class pooled average from weighted sums rather than unweighted mean of class averages', () => {
    // Class 1: 40 students respond all 5 => weighted=200, avg=5.00
    // Class 2: 10 students respond all 1 => weighted=10,  avg=1.00
    // Unweighted mean trap would be (5 + 1) / 2 = 3.00
    // True pooled average = (200 + 10) / (40 + 10) = 210 / 50 = 4.20
    const classes: ClassGroupInput[] = [
      {
        rowId: '1',
        grade: '8',
        section: 'A',
        studentsPresent: '40',
        questionA: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
        questionB: { score5: '40', score4: '0', score3: '0', score2: '0', score1: '0' },
      },
      {
        rowId: '2',
        grade: '8',
        section: 'B',
        studentsPresent: '10',
        questionA: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '10' },
        questionB: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '10' },
      },
    ];
    const m = calculateSessionMetrics(classes, 'promoter', '9');
    expect(m.classBreakdown[0]!.csatAverage).toBe(5);
    expect(m.classBreakdown[1]!.csatAverage).toBe(1);
    expect(m.overallCsat).toBe(4.2);
    expect(m.overallCsat).not.toBe(3);

    const working = buildCalculationWorking(m);
    expect(working.csatFormula).toContain('210 ÷ 50 = 4.20');
  });

  it('maps every exact Teacher NPS score 0..10 and group fallback accurately', () => {
    for (let s = 0; s <= 6; s++) {
      const r = resolveTeacherNps('', String(s));
      expect(r.classification).toBe('Detractor');
      expect(r.nps).toBe(-100);
    }
    for (let s = 7; s <= 8; s++) {
      const r = resolveTeacherNps('', String(s));
      expect(r.classification).toBe('Passive');
      expect(r.nps).toBe(0);
    }
    for (let s = 9; s <= 10; s++) {
      const r = resolveTeacherNps('', String(s));
      expect(r.classification).toBe('Promoter');
      expect(r.nps).toBe(100);
    }
    expect(resolveTeacherNps('passive', '')).toEqual({
      exactScore: null,
      classification: 'Passive',
      nps: 0,
    });
  });
});
