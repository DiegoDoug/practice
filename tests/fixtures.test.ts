/**
 * The fixture corpus is only useful if it is realistic, so this suite pins
 * what each legacy document contains and proves the CURRENT migration path
 * accepts it. Stage 2 changes the destination version; these assertions are
 * the baseline it must not regress.
 */
import { describe, expect, it } from 'vitest';
import { parseBackup } from '@/lib/backup';
import { v2Document, v3Document, v4Document } from './fixtures/legacy';

const parse = (input: unknown) => {
  const result = parseBackup(input);
  if (!result.ok) throw new Error(`fixture did not parse: ${result.error}`);
  return result;
};

describe('v2 fixture', () => {
  it('migrates, reporting where it came from', () => {
    expect(parse(v2Document).migratedFrom).toBe(2);
  });

  it('keeps a day that was marked complete but holds no logged sets', () => {
    const { state } = parse(v2Document);
    const week = state.weeks['2025-06-02'];
    expect(week.completion.day3).toBe(true);
    expect(week.days.day3).toBeDefined();
  });

  it('keeps a half-typed row rather than discarding it', () => {
    const { state } = parse(v2Document);
    const sets = state.weeks['2025-06-02'].days.day1.exercises['day1-s1'].sets;
    expect(sets).toEqual([{ weight: '50', reps: '', rpe: '' }]);
  });

  it('folds a rename into the slot without repointing the movement', () => {
    const { state } = parse(v2Document);
    const slot = state.routine
      .find((day) => day.dayId === 'day1')
      ?.exercises.find((exercise) => exercise.slotId === 'day1-s0');
    expect(slot?.nameOverride).toBe('Bench Press (comp grip)');
    expect(slot?.movementId).toBe('barbell-bench-press');
  });
});

describe('v3 fixture', () => {
  it('migrates and keeps the stored unit preference', () => {
    const { state, migratedFrom } = parse(v3Document);
    expect(migratedFrom).toBe(3);
    expect(state.unit).toBe('kg');
  });

  it('preserves a zero-load bodyweight set exactly as entered', () => {
    const { state } = parse(v3Document);
    const sets = state.weeks['2025-07-07'].days.day2.exercises['day2-s0'].sets;
    expect(sets[0]).toEqual({ weight: '0', reps: '12', rpe: '' });
  });

  it('never drops a non-numeric legacy exercise key', () => {
    const { state } = parse(v3Document);
    const exercises = state.weeks['2025-07-07'].days.day2.exercises;
    const orphan = Object.entries(exercises).find(([key]) =>
      key.includes('legacy'),
    );
    expect(orphan).toBeDefined();
    expect(orphan?.[1].sets[0].weight).toBe('40');
  });

  it('carries the same movement across two weeks, so progression is contiguous', () => {
    const { state } = parse(v3Document);
    const first = state.weeks['2025-07-07'].days.day2.exercises['day2-s0'];
    const second = state.weeks['2025-07-14'].days.day2.exercises['day2-s0'];
    expect(first.movementId).toBe(second.movementId);
  });
});

describe('v4 fixture', () => {
  it('parses as the current version, unchanged', () => {
    const { state, migratedFrom } = parse(v4Document);
    expect(migratedFrom).toBe(4);
    expect(state.schemaVersion).toBe(4);
  });

  it('holds a routine deliberately reordered away from the seeded program', () => {
    const { state } = parse(v4Document);
    expect(state.routine.map((day) => day.dayId).slice(0, 2)).toEqual([
      'day3',
      'day1',
    ]);
  });

  it('holds a substitution keyed by slot id, not day id', () => {
    const week = v4Document.weeks['2025-08-04'];
    // The awkward case stage 2 must resolve rather than treat as a day.
    expect(Object.keys(week.substitutions)).toEqual(['day3-s0', 'dayGone-s4']);
    expect(Object.keys(week.days)).not.toContain('day3-s0');
  });

  it('holds logs under a day the routine no longer plans', () => {
    const { state } = parse(v4Document);
    expect(state.weeks['2025-08-04'].days.dayX).toBeDefined();
    expect(state.routine.some((day) => day.dayId === 'dayX')).toBe(false);
  });

  it('keeps a user-created movement through a round trip', () => {
    const { state } = parse(v4Document);
    expect(state.movements['custom-sled-push'].custom).toBe(true);
  });

  it('keeps an archived day so its history stays reachable', () => {
    const { state } = parse(v4Document);
    expect(state.routine.find((day) => day.dayId === 'dayOld')?.archived).toBe(
      true,
    );
  });
});
