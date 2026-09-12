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
  withExerciseName,
  withSets,
} from '@/lib/workout';
import { PROGRAM, pickInitialDay, resolveExerciseName } from '@/lib/program';
import type { SetEntry, WorkoutState } from '@/lib/types';

const set = (weight: string, reps: string, rpe = ''): SetEntry => ({
  weight,
  reps,
  rpe,
});

const seeded = (): WorkoutState => {
  let state = emptyState();
  state = withSets(state, '2026-08-31', 'day1', 0, [
    set('125', '8', '7'),
    set('130', '6'),
  ]);
  state = withSets(state, '2026-09-07', 'day1', 0, [set('', '', '')]);
  return state;
};

describe('findPriorPerformance', () => {
  it('finds the most recent earlier week with data', () => {
    let state = seeded();
    state = withSets(state, '2026-08-24', 'day1', 0, [set('115', '8')]);
    const prior = findPriorPerformance(state, '2026-09-07', 'day1', 0);
    expect(prior?.weekKey).toBe('2026-08-31');
    expect(prior?.sets).toHaveLength(2);
  });

  it('ignores the current week and any later week', () => {
    let state = emptyState();
    state = withSets(state, '2026-09-07', 'day1', 0, [set('225', '5')]);
    state = withSets(state, '2026-09-14', 'day1', 0, [set('235', '5')]);
    expect(findPriorPerformance(state, '2026-09-07', 'day1', 0)).toBeNull();
  });

  it('skips weeks where the exercise has only empty rows', () => {
    let state = emptyState();
    state = withSets(state, '2026-08-24', 'day1', 0, [set('115', '8')]);
    state = withSets(state, '2026-08-31', 'day1', 0, [
      set('', ''),
      set('', ''),
    ]);
    expect(findPriorPerformance(state, '2026-09-07', 'day1', 0)?.weekKey).toBe(
      '2026-08-24',
    );
  });

  it('matches on both day id and exercise index', () => {
    const state = seeded();
    expect(findPriorPerformance(state, '2026-09-07', 'day1', 1)).toBeNull();
    expect(findPriorPerformance(state, '2026-09-07', 'day2', 0)).toBeNull();
  });
});

describe('repeatLast', () => {
  it('appends the prior first set without touching existing rows', () => {
    const current = [set('95', '10'), set('105', '8')];
    const prior = { weekKey: '2026-08-31', sets: [set('125', '8', '7')] };
    const next = repeatLast(current, prior);

    expect(next).toHaveLength(3);
    expect(next[0]).toEqual(current[0]);
    expect(next[1]).toEqual(current[1]);
    expect(next[2]).toEqual({ weight: '125', reps: '8', rpe: '7' });
  });

  it('copies the value rather than sharing the prior object', () => {
    const priorSet = set('125', '8', '7');
    const next = repeatLast([set('', '')], {
      weekKey: '2026-08-31',
      sets: [priorSet],
    });
    next[1].weight = '999';
    expect(priorSet.weight).toBe('125');
  });

  it('appends onto an empty row instead of replacing it', () => {
    const next = repeatLast([set('', '')], {
      weekKey: '2026-08-31',
      sets: [set('125', '8')],
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(set('', ''));
  });

  it('uses the first row that actually has weight or reps', () => {
    const prior = {
      weekKey: '2026-08-31',
      sets: [set('', '', '8'), set('140', '5', '9')],
    };
    expect(repeatLast([set('', '')], prior)[1]).toEqual(set('140', '5', '9'));
  });

  it('is a no-op when there is no prior performance', () => {
    const current = [set('95', '10')];
    expect(repeatLast(current, null)).toEqual(current);
    expect(repeatLast(current, { weekKey: '2026-08-31', sets: [] })).toEqual(
      current,
    );
  });

  it('can be applied repeatedly, adding exactly one row each time', () => {
    const prior = { weekKey: '2026-08-31', sets: [set('125', '8')] };
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

  it('returns a single empty row for an exercise with no data', () => {
    expect(getSets(emptyState(), '2026-09-07', 'day1', 0)).toEqual([
      set('', ''),
    ]);
  });
});

describe('state updates', () => {
  it('does not disturb other exercises when writing one', () => {
    let state = withSets(emptyState(), '2026-09-07', 'day1', 0, [
      set('135', '8'),
    ]);
    state = withSets(state, '2026-09-07', 'day1', 1, [set('50', '12')]);
    expect(getSets(state, '2026-09-07', 'day1', 0)).toEqual([set('135', '8')]);
    expect(getSets(state, '2026-09-07', 'day1', 1)).toEqual([set('50', '12')]);
  });

  it('tracks completion independently of logged data', () => {
    const state = withCompletion(emptyState(), '2026-09-07', 'day3', true);
    expect(state.weeks['2026-09-07'].completion.day3).toBe(true);
    expect(countLoggedExercises(state, '2026-09-07', 'day3')).toBe(0);
  });

  it('counts only exercises with weight or reps toward progress', () => {
    let state = withSets(emptyState(), '2026-09-07', 'day1', 0, [
      set('135', '8'),
    ]);
    state = withSets(state, '2026-09-07', 'day1', 1, [set('', '', '8')]);
    state = withSets(state, '2026-09-07', 'day1', 2, [set('', '5')]);
    expect(countLoggedExercises(state, '2026-09-07', 'day1')).toBe(2);
  });

  it('stores a name override and clears it when reset to the planned name', () => {
    const planned = PROGRAM[0].exercises[0].name;
    let state = withExerciseName(emptyState(), 'day1', 0, 'Paused Bench');
    expect(resolveExerciseName(state.exerciseNames, 'day1', 0)).toBe(
      'Paused Bench',
    );

    state = withExerciseName(state, 'day1', 0, planned);
    expect(state.exerciseNames['day1:0']).toBeUndefined();
    expect(resolveExerciseName(state.exerciseNames, 'day1', 0)).toBe(planned);

    state = withExerciseName(state, 'day1', 0, '   ');
    expect(resolveExerciseName(state.exerciseNames, 'day1', 0)).toBe(planned);
  });
});

describe('buildHistory', () => {
  it('summarises sessions newest first with sets, volume and completion', () => {
    let state = seeded();
    state = withCompletion(state, '2026-08-31', 'day1', true);
    state = withSets(state, '2026-09-07', 'day2', 0, [set('100', '10')]);

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

  it('omits sessions with no logged rows', () => {
    const state = withCompletion(emptyState(), '2026-09-07', 'day1', true);
    expect(buildHistory(state)).toEqual([]);
  });
});

describe('pickInitialDay', () => {
  it('picks the weekday-aligned session when it is not complete', () => {
    // 2026-09-09 is a Wednesday, so Day 3.
    expect(pickInitialDay({}, new Date(2026, 8, 9, 9, 0))).toBe('day3');
  });

  it('falls back to the first incomplete day', () => {
    const completion = { day1: true, day2: true, day3: true };
    expect(pickInitialDay(completion, new Date(2026, 8, 9, 9, 0))).toBe('day4');
  });

  it('falls back to day 1 on Sunday when everything is complete', () => {
    const completion = Object.fromEntries(PROGRAM.map((d) => [d.id, true]));
    expect(pickInitialDay(completion, new Date(2026, 8, 13, 9, 0))).toBe(
      'day1',
    );
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
