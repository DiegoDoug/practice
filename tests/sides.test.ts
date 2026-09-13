import { describe, expect, it } from 'vitest';
import {
  imbalancePercent,
  setVolume,
  sideTotals,
  sideVolume,
  countLoggedSets,
  totalVolume,
} from '@/lib/volume';
import {
  hasAnyValue,
  isCompleteSet,
  isLoggedSet,
  blankSet,
  cloneSet,
} from '@/lib/types';
import { sideProgression, withSets } from '@/lib/workout';
import { emptyState } from '@/lib/backup';
import { ensureWeekDaySession } from '@/lib/sessions';
import type { SetEntry, WorkoutState } from '@/lib/types';

const both = (
  lw: string,
  lr: string,
  rw: string,
  rr: string,
  rpe = '',
): SetEntry => ({
  weight: lw,
  reps: lr,
  rpe,
  right: { weight: rw, reps: rr, rpe },
});

describe('blankSet', () => {
  it('is one-sided by default', () => {
    expect(blankSet()).toMatchObject({ weight: '', reps: '', rpe: '' });
    expect(blankSet().right).toBeUndefined();
    // Every row carries an id now; circuit progress and records key off it.
    expect(blankSet().setId).toBeTruthy();
  });

  it('carries an empty right side when unilateral', () => {
    expect(blankSet(true).right).toEqual({ weight: '', reps: '', rpe: '' });
  });
});

describe('setVolume', () => {
  it('sums both sides', () => {
    // 50 × 10 per side is 1000 of total work.
    expect(setVolume(both('50', '10', '50', '10'))).toBe(1000);
  });

  it('handles uneven sides', () => {
    expect(setVolume(both('50', '10', '45', '8'))).toBe(500 + 360);
  });

  it('counts a one-sided entry on its own', () => {
    expect(setVolume(both('50', '10', '', ''))).toBe(500);
  });

  it('is unchanged for a bilateral set', () => {
    expect(setVolume({ weight: '135', reps: '8', rpe: '' })).toBe(1080);
  });

  it('ignores a side that does not parse', () => {
    expect(setVolume(both('bodyweight', '10', '50', '10'))).toBe(500);
  });
});

describe('sideVolume', () => {
  it('returns zero for a missing side', () => {
    expect(sideVolume(undefined)).toBe(0);
  });
});

describe('logged-set predicates', () => {
  it('counts a left-only row as logged', () => {
    expect(isLoggedSet(both('50', '10', '', ''))).toBe(true);
  });

  it('counts a right-only row as logged', () => {
    expect(isLoggedSet(both('', '', '50', '10'))).toBe(true);
  });

  it('does not count an empty two-sided row', () => {
    expect(isLoggedSet(blankSet(true))).toBe(false);
  });

  it('counts an RPE-only right side for history but not for progress', () => {
    const set: SetEntry = {
      weight: '',
      reps: '',
      rpe: '',
      right: { weight: '', reps: '', rpe: '8' },
    };
    expect(hasAnyValue(set)).toBe(true);
    expect(isLoggedSet(set)).toBe(false);
  });

  it('counts one L+R row as a single logged set', () => {
    expect(countLoggedSets([both('50', '10', '50', '10')])).toBe(1);
  });

  it('sums volume across rows', () => {
    expect(
      totalVolume([both('50', '10', '50', '10'), both('55', '8', '55', '8')]),
    ).toBe(1000 + 880);
  });
});

describe('cloneSet', () => {
  it('does not share the right side with its source', () => {
    const source = both('50', '10', '50', '9');
    const copy = cloneSet(source);
    copy.right!.reps = '1';
    expect(source.right!.reps).toBe('9');
  });

  it('omits the right side for a bilateral set', () => {
    expect(
      cloneSet({ weight: '1', reps: '2', rpe: '3' }).right,
    ).toBeUndefined();
  });
});

describe('sideTotals', () => {
  it('splits volume and reps by side', () => {
    const totals = sideTotals([
      both('50', '10', '45', '9'),
      both('50', '8', '45', '8'),
    ]);
    expect(totals.left).toBe(500 + 400);
    expect(totals.right).toBe(405 + 360);
    expect(totals.leftReps).toBe(18);
    expect(totals.rightReps).toBe(17);
  });
});

describe('imbalancePercent', () => {
  it('is positive when the left side is ahead', () => {
    expect(imbalancePercent(100, 80)).toBeCloseTo(20);
  });

  it('is negative when the right side is ahead', () => {
    expect(imbalancePercent(80, 100)).toBeCloseTo(-20);
  });

  it('is zero when the sides match', () => {
    expect(imbalancePercent(100, 100)).toBe(0);
  });

  it('is null when either side has no volume', () => {
    expect(imbalancePercent(100, 0)).toBeNull();
    expect(imbalancePercent(0, 0)).toBeNull();
  });
});

describe('sideProgression', () => {
  const unilateralLog = (
    state: WorkoutState,
    weekKey: string,
    sets: SetEntry[],
  ): WorkoutState => {
    const { state: next, sessionId } = ensureWeekDaySession(
      state,
      weekKey,
      'day4',
      weekKey,
    );
    return withSets(
      next,
      sessionId,
      'day4-s2',
      sets,
      'bulgarian-split-squat',
      true,
    );
  };

  it('returns one row per week, oldest first', () => {
    let state = emptyState();
    state = unilateralLog(state, '2026-09-07', [both('50', '10', '45', '10')]);
    state = unilateralLog(state, '2026-08-31', [both('45', '10', '40', '10')]);

    const rows = sideProgression(state, 'bulgarian-split-squat');
    expect(rows.map((r) => r.weekKey)).toEqual(['2026-08-31', '2026-09-07']);
    expect(rows[1].left).toBe(500);
    expect(rows[1].right).toBe(450);
  });

  it('ignores bilateral logs of the same movement', () => {
    const created = ensureWeekDaySession(
      emptyState(),
      '2026-09-07',
      'day4',
      '2026-09-07',
    );
    const state = withSets(
      created.state,
      created.sessionId,
      'day4-s2',
      [{ weight: '50', reps: '10', rpe: '' }],
      'bulgarian-split-squat',
    );
    expect(sideProgression(state, 'bulgarian-split-squat')).toEqual([]);
  });

  it('returns nothing for a movement never logged', () => {
    expect(sideProgression(emptyState(), 'back-squat')).toEqual([]);
  });
});

describe('isCompleteSet', () => {
  const one = (weight: string, reps: string, rpe = ''): SetEntry => ({
    weight,
    reps,
    rpe,
  });

  it('rejects an untouched row', () => {
    expect(isCompleteSet(blankSet(), false)).toBe(false);
    expect(isCompleteSet(blankSet(true), true)).toBe(false);
  });

  it('rejects a row that is only part-way typed', () => {
    expect(isCompleteSet(one('135', ''), false)).toBe(false);
    expect(isCompleteSet(one('', '8'), false)).toBe(false);
    expect(isCompleteSet(one('', '', '8'), false)).toBe(false);
  });

  it('accepts weight and reps, with or without RPE', () => {
    expect(isCompleteSet(one('135', '8'), false)).toBe(true);
    expect(isCompleteSet(one('135', '8', '8.5'), false)).toBe(true);
    expect(isCompleteSet(one('0', '0'), false)).toBe(true);
  });

  it('rejects whitespace and non-numeric entries', () => {
    expect(isCompleteSet(one('  ', '8'), false)).toBe(false);
    expect(isCompleteSet(one('abc', '8'), false)).toBe(false);
  });

  it('needs both sides of a unilateral row', () => {
    expect(isCompleteSet(both('50', '10', '', ''), true)).toBe(false);
    expect(isCompleteSet(both('', '', '50', '10'), true)).toBe(false);
    expect(isCompleteSet(both('50', '10', '50', '9'), true)).toBe(true);
  });

  it('ignores the absent right side when the slot is bilateral', () => {
    expect(isCompleteSet(one('135', '8'), false)).toBe(true);
    expect(isCompleteSet(both('50', '10', '', ''), false)).toBe(true);
  });
});
