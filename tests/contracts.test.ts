import { describe, expect, it } from 'vitest';
import {
  parseReps,
  parseLoad,
  parseAssistance,
  loadModeFor,
  type LoadMode,
} from '@/lib/measure';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  isMissed,
  type SessionStatus,
} from '@/lib/status';
import {
  convert,
  compareLoads,
  normaliseLoad,
  type MeasuredLoad,
} from '@/lib/units';

describe('parseReps', () => {
  it('accepts a positive integer', () => {
    expect(parseReps('8')).toBe(8);
    expect(parseReps(' 12 ')).toBe(12);
  });

  it('rejects zero, negatives, fractions and drafts', () => {
    for (const value of ['0', '-3', '8.5', '', '  ', '1.', 'abc', 'NaN']) {
      expect(parseReps(value)).toBeNull();
    }
  });
});

describe('parseLoad', () => {
  it('accepts zero, which is what bodyweight work logs', () => {
    expect(parseLoad('0')).toBe(0);
  });

  it('accepts positive and fractional loads', () => {
    expect(parseLoad('60')).toBe(60);
    expect(parseLoad('2.5')).toBe(2.5);
  });

  it('rejects negatives and drafts', () => {
    for (const value of ['-5', '', '  ', '1.', 'x']) {
      expect(parseLoad(value)).toBeNull();
    }
  });
});

describe('parseAssistance', () => {
  it('accepts zero and positive assistance', () => {
    expect(parseAssistance('0')).toBe(0);
    expect(parseAssistance('20')).toBe(20);
  });

  it('rejects negative assistance', () => {
    expect(parseAssistance('-1')).toBeNull();
  });
});

describe('loadModeFor', () => {
  it('treats bodyweight equipment as a bodyweight load mode', () => {
    expect(loadModeFor('bodyweight')).toBe<LoadMode>('bodyweight');
  });

  it('treats every loaded equipment type as external', () => {
    for (const equipment of [
      'barbell',
      'dumbbell',
      'cable',
      'machine',
      'other',
    ] as const) {
      expect(loadModeFor(equipment)).toBe<LoadMode>('external');
    }
  });
});

describe('session status transitions', () => {
  it('permits exactly the documented moves', () => {
    expect(canTransition('scheduled', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('scheduled', 'skipped')).toBe(true);
    expect(canTransition('completed', 'in_progress')).toBe(true);
    expect(canTransition('skipped', 'scheduled')).toBe(true);
  });

  it('refuses moves that would skip or invent history', () => {
    expect(canTransition('scheduled', 'completed')).toBe(false);
    expect(canTransition('completed', 'skipped')).toBe(false);
    expect(canTransition('skipped', 'completed')).toBe(false);
    expect(canTransition('in_progress', 'skipped')).toBe(false);
  });

  it('is a total map over every status', () => {
    const statuses: SessionStatus[] = [
      'scheduled',
      'in_progress',
      'completed',
      'skipped',
    ];
    for (const status of statuses) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('isMissed', () => {
  const today = '2026-03-10';

  it('is true only for a scheduled session whose date has passed', () => {
    expect(
      isMissed({ status: 'scheduled', scheduledDate: '2026-03-09' }, today),
    ).toBe(true);
  });

  it('is false today, in the future, and for any non-scheduled status', () => {
    expect(isMissed({ status: 'scheduled', scheduledDate: today }, today)).toBe(
      false,
    );
    expect(
      isMissed({ status: 'scheduled', scheduledDate: '2026-03-11' }, today),
    ).toBe(false);
    expect(
      isMissed({ status: 'completed', scheduledDate: '2026-03-01' }, today),
    ).toBe(false);
    expect(
      isMissed({ status: 'skipped', scheduledDate: '2026-03-01' }, today),
    ).toBe(false);
  });

  it('is false when no date is known, rather than guessing', () => {
    expect(isMissed({ status: 'scheduled' }, today)).toBe(false);
  });
});

describe('units', () => {
  const kg = (value: number): MeasuredLoad => ({ value, unit: 'kg' });
  const lb = (value: number): MeasuredLoad => ({ value, unit: 'lb' });

  it('round-trips a conversion without drifting', () => {
    expect(convert(100, 'kg', 'lb')).toBeCloseTo(220.462, 3);
    expect(convert(convert(100, 'kg', 'lb'), 'lb', 'kg')).toBeCloseTo(100, 9);
  });

  it('is an identity conversion within one unit', () => {
    expect(convert(60, 'kg', 'kg')).toBe(60);
  });

  it('compares across units by physical magnitude', () => {
    // 100 kg is heavier than 200 lb.
    expect(compareLoads(kg(100), lb(200))).toBeGreaterThan(0);
    expect(compareLoads(lb(200), kg(100))).toBeLessThan(0);
    expect(compareLoads(kg(100), lb(220.462))).toBeCloseTo(0, 3);
  });

  it('normalises into a requested display unit without mutating the source', () => {
    const source = kg(100);
    const shown = normaliseLoad(source, 'lb');
    expect(shown.unit).toBe('lb');
    expect(shown.value).toBeCloseTo(220.462, 3);
    expect(source).toEqual({ value: 100, unit: 'kg' });
  });
});
