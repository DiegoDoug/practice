/**
 * Guards the fixture corpus itself.
 *
 * The migration suites assert what these documents turn INTO. This one asserts
 * they still contain the cases worth migrating: if someone tidies a fixture and
 * removes its awkward edge, the migration tests would keep passing while
 * quietly testing nothing, and that is exactly the failure this catches.
 */
import { describe, expect, it } from 'vitest';
import { v2Document, v3Document, v4Document } from './fixtures/legacy';

describe('v2 fixture', () => {
  it('declares its version so it is detected, not guessed at', () => {
    expect(v2Document.version).toBe(2);
  });

  it('has a day marked complete with no logged exercises', () => {
    const week = v2Document.weeks['2025-06-02'];
    expect(week.completion.day3).toBe(true);
    expect(Object.keys(week.days.day3.exercises)).toEqual([]);
  });

  it('has a half-typed row', () => {
    const sets = v2Document.weeks['2025-06-02'].days.day1.exercises['1'].sets;
    expect(sets[0].weight).toBe('50');
    expect(sets[0].reps).toBe('');
  });

  it('has a rename pointing at a slot index the day does not have', () => {
    expect(v2Document.exerciseNames['day1:99']).toBeDefined();
  });
});

describe('v3 fixture', () => {
  it('carries a unit other than the default, so unit handling is exercised', () => {
    expect(v3Document.unit).toBe('kg');
  });

  it('has a zero-load bodyweight set', () => {
    const sets = v3Document.weeks['2025-07-07'].days.day2.exercises['0'].sets;
    expect(sets[0].weight).toBe('0');
    expect(sets[0].reps).toBe('12');
  });

  it('has a non-numeric exercise key', () => {
    expect(
      v3Document.weeks['2025-07-07'].days.day2.exercises.legacy,
    ).toBeDefined();
  });

  it('spans two weeks, so contiguous progression can be checked', () => {
    expect(Object.keys(v3Document.weeks)).toHaveLength(2);
  });
});

describe('v4 fixture', () => {
  it('has a routine reordered away from the seeded program', () => {
    // day3 first means anything deriving a date from routine position is
    // visibly wrong rather than accidentally right.
    expect(v4Document.routine.map((day) => day.dayId)).toEqual([
      'day3',
      'day1',
      'dayOld',
    ]);
  });

  it('keys substitutions by slot id while its siblings key by day id', () => {
    const week = v4Document.weeks['2025-08-04'];
    expect(Object.keys(week.substitutions)).toEqual(['day3-s0', 'dayGone-s4']);
    for (const slotId of Object.keys(week.substitutions)) {
      expect(Object.keys(week.days)).not.toContain(slotId);
    }
  });

  it('has one substitution that belongs to no day at all', () => {
    const owned = v4Document.routine.flatMap((day) =>
      day.exercises.map((exercise) => exercise.slotId),
    );
    expect(owned).not.toContain('dayGone-s4');
  });

  it('has a day marked complete with no logged exercises', () => {
    const week = v4Document.weeks['2025-08-04'];
    expect(week.completion.day1).toBe(true);
    expect(Object.keys(week.days.day1.exercises)).toEqual([]);
  });

  it('has logs under a day the routine no longer plans', () => {
    const week = v4Document.weeks['2025-08-04'];
    expect(week.days.dayX).toBeDefined();
    const planned: string[] = v4Document.routine.map((day) => day.dayId);
    expect(planned).not.toContain('dayX');
  });

  it('has a half-typed unilateral row', () => {
    const sets =
      v4Document.weeks['2025-08-04'].days.day3.exercises['day3-s1'].sets;
    expect(sets[1].weight).toBe('75');
    expect(sets[1].right?.reps).toBe('');
  });

  it('has an archived day and a custom movement', () => {
    expect(
      v4Document.routine.find((day) => day.dayId === 'dayOld')?.archived,
    ).toBe(true);
    expect(v4Document.movements['custom-sled-push'].custom).toBe(true);
  });
});
