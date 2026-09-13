import { describe, expect, it } from 'vitest';
import { emptyState } from '@/lib/backup';
import {
  activeDays,
  addCustomMovement,
  addDay,
  addExercise,
  dayHasHistory,
  duplicateDay,
  duplicateExercise,
  ensureDaySnapshot,
  findDay,
  moveDay,
  moveExercise,
  newSlotId,
  refreshOpenSnapshots,
  removeDay,
  removeExercise,
  renameDay,
  resolveSlotGroup,
  resolveWeekRoutine,
  restoreDay,
  seedRoutine,
  setSlotUnilateral,
  slotHasHistory,
  substituteSlot,
} from '@/lib/routine';
import { withCompletion, withSets } from '@/lib/workout';
import { PROGRAM } from '@/lib/program';
import type { WorkoutState } from '@/lib/types';

const set = (weight: string, reps: string) => ({ weight, reps, rpe: '' });

const logged = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
  movementId = 'barbell-bench-press',
): WorkoutState =>
  withSets(state, weekKey, dayId, slotId, [set('135', '8')], movementId);

describe('seedRoutine', () => {
  it('mirrors the seeded program', () => {
    const routine = seedRoutine();
    expect(routine).toHaveLength(PROGRAM.length);
    routine.forEach((day, index) => {
      expect(day.dayId).toBe(PROGRAM[index].id);
      expect(day.label).toBe(PROGRAM[index].label);
      expect(day.name).toBe(PROGRAM[index].name);
      expect(day.exercises).toHaveLength(PROGRAM[index].exercises.length);
    });
  });

  it('mints unique slot ids across the whole routine', () => {
    const ids = seedRoutine().flatMap((day) =>
      day.exercises.map((slot) => slot.slotId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves every muscle-group label from the program', () => {
    const state = emptyState();
    state.routine.forEach((day, dayIndex) => {
      day.exercises.forEach((slot, index) => {
        expect(resolveSlotGroup(state.movements, slot)).toBe(
          PROGRAM[dayIndex].exercises[index].group,
        );
      });
    });
  });
});

describe('day edits', () => {
  it('renames without touching anything else', () => {
    const state = renameDay(emptyState(), 'day1', {
      name: 'Chest, Shoulders & Triceps',
    });
    expect(findDay(state.routine, 'day1')?.name).toBe(
      'Chest, Shoulders & Triceps',
    );
    expect(findDay(state.routine, 'day2')?.name).toBe('Pull');
  });

  it('does not mutate the input state', () => {
    const before = emptyState();
    const snapshot = JSON.stringify(before);
    renameDay(before, 'day1', { name: 'Changed' });
    addDay(before);
    moveDay(before, 'day1', 3);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('appends a new day with a fresh id', () => {
    const state = addDay(emptyState(), 'Conditioning');
    expect(state.routine).toHaveLength(7);
    expect(state.routine[6].name).toBe('Conditioning');
    expect(state.routine[6].exercises).toEqual([]);
  });

  it('duplicates a day with fresh slot ids so history is not shared', () => {
    const state = duplicateDay(emptyState(), 'day1');
    const original = findDay(state.routine, 'day1')!;
    const copy = state.routine[1];

    expect(copy.dayId).not.toBe('day1');
    expect(copy.exercises).toHaveLength(original.exercises.length);
    const originalIds = original.exercises.map((s) => s.slotId);
    for (const slot of copy.exercises) {
      expect(originalIds).not.toContain(slot.slotId);
    }
    // Same movements, different slots.
    expect(copy.exercises.map((s) => s.movementId)).toEqual(
      original.exercises.map((s) => s.movementId),
    );
  });

  it('reorders days', () => {
    const state = moveDay(emptyState(), 'day1', 2);
    expect(state.routine.map((d) => d.dayId).slice(0, 3)).toEqual([
      'day2',
      'day3',
      'day1',
    ]);
  });

  it('deletes a day outright when it has no history', () => {
    const state = removeDay(emptyState(), 'day1');
    expect(findDay(state.routine, 'day1')).toBeUndefined();
    expect(state.routine).toHaveLength(5);
  });

  it('archives a day that has history instead of deleting it', () => {
    let state = logged(emptyState(), '2026-09-07', 'day1', 'day1-s0');
    state = removeDay(state, 'day1');

    const day = findDay(state.routine, 'day1');
    expect(day?.archived).toBe(true);
    expect(activeDays(state).map((d) => d.dayId)).not.toContain('day1');
    // The logs are still there.
    expect(
      state.weeks['2026-09-07'].days.day1.exercises['day1-s0'],
    ).toBeDefined();
  });

  it('restores an archived day', () => {
    let state = logged(emptyState(), '2026-09-07', 'day1', 'day1-s0');
    state = restoreDay(removeDay(state, 'day1'), 'day1');
    expect(findDay(state.routine, 'day1')?.archived).toBeUndefined();
    expect(activeDays(state).map((d) => d.dayId)).toContain('day1');
  });
});

describe('exercise edits', () => {
  it('adds an exercise with a non-colliding slot id', () => {
    const state = addExercise(emptyState(), 'day1', 'face-pull');
    const day = findDay(state.routine, 'day1')!;
    expect(day.exercises).toHaveLength(7);
    const ids = day.exercises.map((s) => s.slotId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries the movement default when adding a unilateral movement', () => {
    const state = addExercise(emptyState(), 'day1', 'bulgarian-split-squat');
    const added = findDay(state.routine, 'day1')!.exercises.at(-1)!;
    expect(added.unilateral).toBe(true);
  });

  it('duplicates an exercise with a fresh slot id, next to the original', () => {
    const state = duplicateExercise(emptyState(), 'day1', 'day1-s0');
    const day = findDay(state.routine, 'day1')!;
    expect(day.exercises).toHaveLength(7);
    expect(day.exercises[1].movementId).toBe(day.exercises[0].movementId);
    expect(day.exercises[1].slotId).not.toBe('day1-s0');
  });

  it('reorders exercises within a day', () => {
    const state = moveExercise(emptyState(), 'day1', 'day1-s0', 2);
    const ids = findDay(state.routine, 'day1')!.exercises.map((s) => s.slotId);
    expect(ids.slice(0, 3)).toEqual(['day1-s1', 'day1-s2', 'day1-s0']);
  });

  it('keeps logged data when a slot is removed from the plan', () => {
    let state = logged(emptyState(), '2026-09-07', 'day1', 'day1-s0');
    state = removeExercise(state, 'day1', 'day1-s0');

    expect(
      findDay(state.routine, 'day1')!.exercises.map((s) => s.slotId),
    ).not.toContain('day1-s0');
    expect(
      state.weeks['2026-09-07'].days.day1.exercises['day1-s0'],
    ).toBeDefined();
  });

  it('substitutes a slot and drops the stale overrides', () => {
    let state = emptyState();
    state = substituteSlot(state, 'day2', 'day2-s2', 'chest-supported-db-row');
    const slot = findDay(state.routine, 'day2')!.exercises[2];
    expect(slot.movementId).toBe('chest-supported-db-row');
    expect(slot.groupOverride).toBeUndefined();
    expect(slot.slotId).toBe('day2-s2'); // the slot itself is stable
  });

  it('toggles unilateral mode on and off', () => {
    let state = setSlotUnilateral(emptyState(), 'day3', 'day3-s4', true);
    expect(findDay(state.routine, 'day3')!.exercises[4].unilateral).toBe(true);
    state = setSlotUnilateral(state, 'day3', 'day3-s4', false);
    expect(
      findDay(state.routine, 'day3')!.exercises[4].unilateral,
    ).toBeUndefined();
  });
});

describe('newSlotId', () => {
  it('never returns an id already in use anywhere in the routine', () => {
    const routine = seedRoutine();
    const taken = new Set(
      routine.flatMap((d) => d.exercises.map((s) => s.slotId)),
    );
    expect(taken.has(newSlotId(routine, 'day1'))).toBe(false);
  });
});

describe('history probes', () => {
  it('detects history for a slot and a day', () => {
    const state = logged(emptyState(), '2026-09-07', 'day1', 'day1-s0');
    expect(slotHasHistory(state, 'day1-s0')).toBe(true);
    expect(slotHasHistory(state, 'day1-s1')).toBe(false);
    expect(dayHasHistory(state, 'day1')).toBe(true);
    expect(dayHasHistory(state, 'day2')).toBe(false);
  });
});

describe('snapshots', () => {
  it('freezes on first write and is idempotent', () => {
    let state = ensureDaySnapshot(emptyState(), '2026-09-07', 'day1');
    const first = state.weeks['2026-09-07'].routine!.day1;

    state = renameDay(state, 'day1', { name: 'Renamed' });
    state = ensureDaySnapshot(state, '2026-09-07', 'day1');
    // A second ensure must not overwrite the frozen copy.
    expect(state.weeks['2026-09-07'].routine!.day1).toEqual(first);
    expect(state.weeks['2026-09-07'].routine!.day1.name).toBe('Push');
  });

  it('is written automatically by withSets', () => {
    const state = logged(emptyState(), '2026-09-07', 'day1', 'day1-s0');
    expect(state.weeks['2026-09-07'].routine?.day1.name).toBe('Push');
  });

  it('is written automatically by withCompletion', () => {
    const state = withCompletion(emptyState(), '2026-09-07', 'day2', true);
    expect(state.weeks['2026-09-07'].routine?.day2.name).toBe('Pull');
  });

  it('refreshes an incomplete day in the current week', () => {
    let state = logged(emptyState(), '2026-09-07', 'day1', 'day1-s0');
    state = renameDay(state, 'day1', { name: 'Renamed' });
    state = refreshOpenSnapshots(state, '2026-09-07');
    expect(state.weeks['2026-09-07'].routine!.day1.name).toBe('Renamed');
  });

  it('leaves a completed day alone', () => {
    let state = logged(emptyState(), '2026-09-07', 'day1', 'day1-s0');
    state = withCompletion(state, '2026-09-07', 'day1', true);
    state = renameDay(state, 'day1', { name: 'Renamed' });
    state = refreshOpenSnapshots(state, '2026-09-07');
    expect(state.weeks['2026-09-07'].routine!.day1.name).toBe('Push');
  });

  it('leaves past weeks alone', () => {
    let state = logged(emptyState(), '2026-08-31', 'day1', 'day1-s0');
    state = renameDay(state, 'day1', { name: 'Renamed' });
    state = refreshOpenSnapshots(state, '2026-09-07');
    expect(state.weeks['2026-08-31'].routine!.day1.name).toBe('Push');
  });
});

describe('resolveWeekRoutine', () => {
  it('returns the frozen snapshot when one exists', () => {
    let state = logged(emptyState(), '2026-08-31', 'day1', 'day1-s0');
    state = renameDay(state, 'day1', { name: 'Renamed' });
    expect(resolveWeekRoutine(state, '2026-08-31', 'day1').name).toBe('Push');
  });

  it('falls back to the current routine for an unlogged week', () => {
    const state = renameDay(emptyState(), 'day1', { name: 'Renamed' });
    expect(resolveWeekRoutine(state, '2026-09-07', 'day1').name).toBe(
      'Renamed',
    );
  });

  it('degrades safely for a day that no longer exists at all', () => {
    const resolved = resolveWeekRoutine(emptyState(), '2026-09-07', 'ghost');
    expect(resolved.label).toBe('ghost');
    expect(resolved.exercises).toEqual([]);
  });
});

describe('addCustomMovement', () => {
  it('adds a movement and returns its id', () => {
    const { state, id } = addCustomMovement(emptyState(), {
      name: 'Zercher Squat',
      group: 'Legs',
      equipment: 'barbell',
    });
    expect(id).toBe('zercher-squat');
    expect(state.movements[id].custom).toBe(true);
  });

  it('never merges into a seeded movement of the same name', () => {
    const { state, id } = addCustomMovement(emptyState(), {
      name: 'Back Squat',
      group: 'Legs',
      equipment: 'dumbbell',
    });
    expect(id).not.toBe('back-squat');
    expect(state.movements['back-squat'].equipment).toBe('barbell');
    expect(state.movements[id].equipment).toBe('dumbbell');
  });
});
