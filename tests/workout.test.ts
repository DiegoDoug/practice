import { describe, expect, it } from 'vitest';
import { emptyState } from '@/lib/backup';
import {
  buildHistory,
  countLoggedExercises,
  findPriorPerformance,
  formatSetSummary,
  getSets,
  removeSet,
  repeatLast,
  updateSet,
  withCompletion,
  withSets,
} from '@/lib/workout';
import {
  findDay,
  pickInitialDay,
  removeDay,
  renameDay,
  renameSlot,
  resolveSlotName,
  resolveWeekRoutine,
  seedRoutine,
} from '@/lib/routine';
import { PROGRAM } from '@/lib/program';
import type { SetEntry, WorkoutState } from '@/lib/types';

const set = (weight: string, reps: string, rpe = ''): SetEntry => ({
  weight,
  reps,
  rpe,
});

const BENCH = 'barbell-bench-press';
const ROW = 'barbell-row';

/** Log a slot using the movement its seeded routine slot points at. */
const log = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
  sets: SetEntry[],
): WorkoutState => {
  const slot = findDay(state.routine, dayId)?.exercises.find(
    (s) => s.slotId === slotId,
  );
  return withSets(
    state,
    weekKey,
    dayId,
    slotId,
    sets,
    slot?.movementId ?? 'unknown',
  );
};

const seeded = (): WorkoutState => {
  let state = emptyState();
  state = log(state, '2026-08-31', 'day1', 'day1-s0', [
    set('125', '8', '7'),
    set('130', '6'),
  ]);
  state = log(state, '2026-09-07', 'day1', 'day1-s0', [set('', '', '')]);
  return state;
};

describe('findPriorPerformance', () => {
  it('finds the most recent earlier week with data', () => {
    let state = seeded();
    state = log(state, '2026-08-24', 'day1', 'day1-s0', [set('115', '8')]);
    const prior = findPriorPerformance(state, '2026-09-07', BENCH);
    expect(prior?.weekKey).toBe('2026-08-31');
    expect(prior?.sets).toHaveLength(2);
  });

  it('ignores the current week and any later week', () => {
    let state = emptyState();
    state = log(state, '2026-09-07', 'day1', 'day1-s0', [set('225', '5')]);
    state = log(state, '2026-09-14', 'day1', 'day1-s0', [set('235', '5')]);
    expect(findPriorPerformance(state, '2026-09-07', BENCH)).toBeNull();
  });

  it('skips weeks where the movement has only empty rows', () => {
    let state = emptyState();
    state = log(state, '2026-08-24', 'day1', 'day1-s0', [set('115', '8')]);
    state = log(state, '2026-08-31', 'day1', 'day1-s0', [
      set('', ''),
      set('', ''),
    ]);
    expect(findPriorPerformance(state, '2026-09-07', BENCH)?.weekKey).toBe(
      '2026-08-24',
    );
  });

  it('finds the movement in a different day and slot', () => {
    // Barbell Row is planned on both day 2 and day 6 in the seeded program.
    let state = emptyState();
    state = log(state, '2026-08-31', 'day2', 'day2-s2', [set('185', '8')]);

    const prior = findPriorPerformance(state, '2026-09-07', ROW, 'day6');
    expect(prior?.weekKey).toBe('2026-08-31');
    expect(prior?.dayId).toBe('day2');
    expect(prior?.sets[0].weight).toBe('185');
  });

  it('prefers the same slot, then the same day, on a tie', () => {
    let state = emptyState();
    state = log(state, '2026-08-31', 'day2', 'day2-s2', [set('185', '8')]);
    state = log(state, '2026-08-31', 'day6', 'day6-s3', [set('195', '8')]);

    expect(
      findPriorPerformance(state, '2026-09-07', ROW, 'day6', 'day6-s3')?.dayId,
    ).toBe('day6');
    expect(
      findPriorPerformance(state, '2026-09-07', ROW, 'day2', 'day2-s2')?.dayId,
    ).toBe('day2');
  });

  it('keeps a substituted movement separate from the one it replaced', () => {
    let state = emptyState();
    state = log(state, '2026-08-31', 'day1', 'day1-s0', [set('225', '5')]);
    // Nothing has ever been logged for this other movement.
    expect(
      findPriorPerformance(state, '2026-09-07', 'flat-db-press'),
    ).toBeNull();
    expect(findPriorPerformance(state, '2026-09-07', BENCH)).not.toBeNull();
  });

  it('returns null for an empty movement id', () => {
    expect(findPriorPerformance(seeded(), '2026-09-07', '')).toBeNull();
  });
});

describe('repeatLast', () => {
  const prior = {
    weekKey: '2026-08-31',
    dayId: 'day1',
    slotId: 'day1-s0',
    movementId: BENCH,
    unilateral: false,
    sets: [set('125', '8', '7')],
  };

  it('appends the prior first set without touching existing rows', () => {
    const current = [set('95', '10'), set('105', '8')];
    const next = repeatLast(current, prior);

    expect(next).toHaveLength(3);
    expect(next[0]).toEqual(current[0]);
    expect(next[1]).toEqual(current[1]);
    expect(next[2]).toEqual({ weight: '125', reps: '8', rpe: '7' });
  });

  it('copies the value rather than sharing the prior object', () => {
    const priorSet = set('125', '8', '7');
    const next = repeatLast([set('', '')], { ...prior, sets: [priorSet] });
    next[1].weight = '999';
    expect(priorSet.weight).toBe('125');
  });

  it('deep-copies the right side so the two rows do not alias', () => {
    const priorSet: SetEntry = {
      weight: '50',
      reps: '10',
      rpe: '',
      right: { weight: '50', reps: '9', rpe: '' },
    };
    const next = repeatLast([set('', '')], { ...prior, sets: [priorSet] });
    next[1].right!.reps = '1';
    expect(priorSet.right!.reps).toBe('9');
  });

  it('appends onto an empty row instead of replacing it', () => {
    const next = repeatLast([set('', '')], prior);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(set('', ''));
  });

  it('uses the first row that actually has weight or reps', () => {
    const next = repeatLast([set('', '')], {
      ...prior,
      sets: [set('', '', '8'), set('140', '5', '9')],
    });
    expect(next[1]).toEqual(set('140', '5', '9'));
  });

  it('is a no-op when there is no prior performance', () => {
    const current = [set('95', '10')];
    expect(repeatLast(current, null)).toEqual(current);
    expect(repeatLast(current, { ...prior, sets: [] })).toEqual(current);
  });

  it('adds exactly one row each time it is applied', () => {
    let sets = [set('', '')];
    sets = repeatLast(sets, prior);
    sets = repeatLast(sets, prior);
    expect(sets).toHaveLength(3);
  });
});

describe('set row editing', () => {
  it('keeps one empty row when the final row is removed', () => {
    expect(removeSet([set('135', '8')], 0)).toEqual([set('', '')]);
  });

  it('keeps a two-sided empty row for a unilateral slot', () => {
    expect(removeSet([set('135', '8')], 0, true)).toEqual([
      {
        weight: '',
        reps: '',
        rpe: '',
        right: { weight: '', reps: '', rpe: '' },
      },
    ]);
  });

  it('removes the requested row when more than one exists', () => {
    const sets = [set('1', '1'), set('2', '2'), set('3', '3')];
    expect(removeSet(sets, 1)).toEqual([set('1', '1'), set('3', '3')]);
  });

  it('updates one field without disturbing the others', () => {
    const sets = [set('135', '8', '7'), set('145', '6', '8')];
    const next = updateSet(sets, 0, 'reps', '10');
    expect(next[0]).toEqual(set('135', '10', '7'));
    expect(next[1]).toEqual(sets[1]);
    expect(sets[0].reps).toBe('8');
  });

  it('writes the right side without disturbing the left', () => {
    const sets = [set('50', '10', '8')];
    const next = updateSet(sets, 0, 'reps', '9', 'right');
    expect(next[0].weight).toBe('50');
    expect(next[0].reps).toBe('10');
    expect(next[0].right).toEqual({ weight: '', reps: '9', rpe: '' });
  });

  it('returns a single empty row for a slot with no data', () => {
    expect(getSets(emptyState(), '2026-09-07', 'day1', 'day1-s0')).toEqual([
      set('', ''),
    ]);
  });
});

describe('state updates', () => {
  it('does not disturb other slots when writing one', () => {
    let state = log(emptyState(), '2026-09-07', 'day1', 'day1-s0', [
      set('135', '8'),
    ]);
    state = log(state, '2026-09-07', 'day1', 'day1-s1', [set('50', '12')]);
    expect(getSets(state, '2026-09-07', 'day1', 'day1-s0')).toEqual([
      set('135', '8'),
    ]);
    expect(getSets(state, '2026-09-07', 'day1', 'day1-s1')).toEqual([
      set('50', '12'),
    ]);
  });

  it('records the movement performed alongside the sets', () => {
    const state = log(emptyState(), '2026-09-07', 'day1', 'day1-s0', [
      set('135', '8'),
    ]);
    expect(
      state.weeks['2026-09-07'].days.day1.exercises['day1-s0'].movementId,
    ).toBe(BENCH);
  });

  it('tracks completion independently of logged data', () => {
    const state = withCompletion(emptyState(), '2026-09-07', 'day3', true);
    expect(state.weeks['2026-09-07'].completion.day3).toBe(true);
    expect(countLoggedExercises(state, '2026-09-07', 'day3')).toBe(0);
  });

  it('counts only slots with weight or reps toward progress', () => {
    let state = log(emptyState(), '2026-09-07', 'day1', 'day1-s0', [
      set('135', '8'),
    ]);
    state = log(state, '2026-09-07', 'day1', 'day1-s1', [set('', '', '8')]);
    state = log(state, '2026-09-07', 'day1', 'day1-s2', [set('', '5')]);
    expect(countLoggedExercises(state, '2026-09-07', 'day1')).toBe(2);
  });

  it('never counts an orphaned log toward progress', () => {
    // A slot that is no longer planned must not inflate the numerator.
    let state = log(emptyState(), '2026-09-07', 'day1', 'day1-s0', [
      set('135', '8'),
    ]);
    state = withSets(
      state,
      '2026-09-07',
      'day1',
      'day1-legacy99',
      [set('99', '9')],
      'unknown',
    );
    expect(countLoggedExercises(state, '2026-09-07', 'day1')).toBe(1);
  });

  it('stores a name override and clears it when reset to the movement name', () => {
    const planned = PROGRAM[0].exercises[0].name;
    let state = renameSlot(emptyState(), 'day1', 'day1-s0', 'Paused Bench');
    let slot = findDay(state.routine, 'day1')!.exercises[0];
    expect(resolveSlotName(state.movements, slot)).toBe('Paused Bench');

    state = renameSlot(state, 'day1', 'day1-s0', planned);
    slot = findDay(state.routine, 'day1')!.exercises[0];
    expect(slot.nameOverride).toBeUndefined();
    expect(resolveSlotName(state.movements, slot)).toBe(planned);

    state = renameSlot(state, 'day1', 'day1-s0', '   ');
    slot = findDay(state.routine, 'day1')!.exercises[0];
    expect(resolveSlotName(state.movements, slot)).toBe(planned);
  });
});

describe('routine snapshots', () => {
  it('freezes the day label used by a logged session', () => {
    let state = log(emptyState(), '2026-08-31', 'day1', 'day1-s0', [
      set('135', '8'),
    ]);
    state = renameDay(state, 'day1', { name: 'Chest, Shoulders & Triceps' });

    // The past week keeps the name it was logged under...
    expect(resolveWeekRoutine(state, '2026-08-31', 'day1').name).toBe('Push');
    // ...while an untouched week reflects the current routine.
    expect(resolveWeekRoutine(state, '2026-09-07', 'day1').name).toBe(
      'Chest, Shoulders & Triceps',
    );
  });

  it('reports the old name in history after a rename', () => {
    let state = log(emptyState(), '2026-08-31', 'day1', 'day1-s0', [
      set('135', '8'),
    ]);
    state = renameDay(state, 'day1', { name: 'Chest, Shoulders & Triceps' });
    expect(buildHistory(state)[0].dayName).toBe('Push');
  });
});

describe('buildHistory', () => {
  it('summarises sessions newest first with sets, volume and completion', () => {
    let state = seeded();
    state = withCompletion(state, '2026-08-31', 'day1', true);
    state = log(state, '2026-09-07', 'day2', 'day2-s0', [set('100', '10')]);

    const history = buildHistory(state);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      weekKey: '2026-09-07',
      dayId: 'day2',
      sets: 1,
      volume: 1000,
      completed: false,
    });
    expect(history[1]).toMatchObject({
      weekKey: '2026-08-31',
      dayId: 'day1',
      sets: 2,
      volume: 125 * 8 + 130 * 6,
      completed: true,
    });
  });

  it('keeps sessions for a day that was removed from the plan', () => {
    let state = log(emptyState(), '2026-08-31', 'day1', 'day1-s0', [
      set('135', '8'),
    ]);
    state = removeDay(state, 'day1');

    const history = buildHistory(state);
    expect(history).toHaveLength(1);
    expect(history[0].archived).toBe(true);
    expect(history[0].dayName).toBe('Push');
  });

  it('omits sessions with no logged rows', () => {
    const state = withCompletion(emptyState(), '2026-09-07', 'day1', true);
    expect(buildHistory(state)).toEqual([]);
  });
});

describe('pickInitialDay', () => {
  it('picks the weekday-aligned session when it is not complete', () => {
    // 2026-09-09 is a Wednesday, so the third day by position.
    expect(pickInitialDay(emptyState(), {}, new Date(2026, 8, 9, 9, 0))).toBe(
      'day3',
    );
  });

  it('falls back to the first incomplete day', () => {
    const completion = { day1: true, day2: true, day3: true };
    expect(
      pickInitialDay(emptyState(), completion, new Date(2026, 8, 9, 9, 0)),
    ).toBe('day4');
  });

  it('falls back to the first day on Sunday when everything is complete', () => {
    const completion = Object.fromEntries(
      seedRoutine().map((d) => [d.dayId, true]),
    );
    expect(
      pickInitialDay(emptyState(), completion, new Date(2026, 8, 13, 9, 0)),
    ).toBe('day1');
  });

  it('returns null for an empty routine', () => {
    const state = { ...emptyState(), routine: [] };
    expect(pickInitialDay(state, {})).toBeNull();
  });
});

describe('formatSetSummary', () => {
  it('renders weight, reps and RPE', () => {
    expect(formatSetSummary(set('135', '8', '7.5'))).toBe(
      '135 × 8 reps @ RPE 7.5',
    );
  });

  it('uses placeholders for missing values', () => {
    expect(formatSetSummary(set('', ''))).toBe('— × — reps');
  });

  it('labels both sides for a unilateral set', () => {
    expect(
      formatSetSummary({
        weight: '50',
        reps: '10',
        rpe: '',
        right: { weight: '50', reps: '9', rpe: '' },
      }),
    ).toBe('L 50 × 10 reps · R 50 × 9 reps');
  });
});

describe('program seed', () => {
  it('matches the source six-day plan', () => {
    expect(PROGRAM.map((d) => [d.name, d.exercises.length])).toEqual([
      ['Push', 6],
      ['Pull', 6],
      ['Legs', 6],
      ['Legs', 6],
      ['Arms', 7],
      ['Chest/Back', 6],
    ]);
    expect(PROGRAM.every((d) => d.warmup.length > 0)).toBe(true);
    expect(PROGRAM.every((d) => d.exercises.every((e) => e.group))).toBe(true);
  });
});
