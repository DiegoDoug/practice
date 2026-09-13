import { describe, expect, it } from 'vitest';
import { emptyState } from '@/lib/backup';
import {
  clearWeekSubstitution,
  effectiveMovementId,
  findDay,
  refreshOpenSnapshots,
  renameDay,
  resolveWeekRoutine,
  slotHasSetsThisWeek,
  substituteForWeek,
  substitutePermanently,
} from '@/lib/routine';
import { findPriorPerformance, withSets } from '@/lib/workout';
import type { WorkoutState } from '@/lib/types';

const WEEK = '2026-09-07';
const PRIOR = '2026-08-31';
const ROW_SLOT = 'day2-s2'; // Barbell Row on Day 2
const SUB = 'chest-supported-db-row';

const set = (weight: string, reps: string) => ({ weight, reps, rpe: '' });

const log = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
  movementId: string,
  weight = '185',
): WorkoutState =>
  withSets(state, weekKey, dayId, slotId, [set(weight, '8')], movementId);

describe('substituteForWeek', () => {
  it('changes what the week plans without touching the routine', () => {
    const state = substituteForWeek(emptyState(), WEEK, 'day2', ROW_SLOT, SUB);

    expect(effectiveMovementId(state, WEEK, 'day2', ROW_SLOT)).toBe(SUB);
    // The routine itself is unchanged, so next week reverts.
    expect(findDay(state.routine, 'day2')!.exercises[2].movementId).toBe(
      'barbell-row',
    );
    expect(effectiveMovementId(state, '2026-09-14', 'day2', ROW_SLOT)).toBe(
      'barbell-row',
    );
  });

  it('reports the substitute name and group on the day screen', () => {
    const state = substituteForWeek(emptyState(), WEEK, 'day2', ROW_SLOT, SUB);
    const slot = resolveWeekRoutine(state, WEEK, 'day2').exercises[2];
    expect(slot.name).toBe('Chest-Supported DB Row');
    expect(slot.group).toBe('Length');
  });

  it('survives a later routine edit in the same week', () => {
    // refreshOpenSnapshots rebuilds open snapshots from the routine, so the
    // swap has to live outside the snapshot or it would be silently undone.
    let state = substituteForWeek(emptyState(), WEEK, 'day2', ROW_SLOT, SUB);
    state = refreshOpenSnapshots(
      renameDay(state, 'day2', { name: 'Back & Biceps' }),
      WEEK,
    );

    expect(effectiveMovementId(state, WEEK, 'day2', ROW_SLOT)).toBe(SUB);
    expect(resolveWeekRoutine(state, WEEK, 'day2').name).toBe('Back & Biceps');
  });

  it('clears the slot sets, since they belong to the replaced movement', () => {
    let state = log(emptyState(), WEEK, 'day2', ROW_SLOT, 'barbell-row');
    expect(slotHasSetsThisWeek(state, WEEK, 'day2', ROW_SLOT)).toBe(true);

    state = substituteForWeek(state, WEEK, 'day2', ROW_SLOT, SUB);
    expect(slotHasSetsThisWeek(state, WEEK, 'day2', ROW_SLOT)).toBe(false);
  });

  it('leaves earlier weeks untouched', () => {
    let state = log(emptyState(), PRIOR, 'day2', ROW_SLOT, 'barbell-row');
    state = substituteForWeek(state, WEEK, 'day2', ROW_SLOT, SUB);

    expect(
      state.weeks[PRIOR].days.day2.exercises[ROW_SLOT].sets[0].weight,
    ).toBe('185');
    expect(effectiveMovementId(state, PRIOR, 'day2', ROW_SLOT)).toBe(
      'barbell-row',
    );
  });
});

describe('clearWeekSubstitution', () => {
  it('puts the planned movement back', () => {
    let state = substituteForWeek(emptyState(), WEEK, 'day2', ROW_SLOT, SUB);
    state = clearWeekSubstitution(state, WEEK, 'day2', ROW_SLOT);
    expect(effectiveMovementId(state, WEEK, 'day2', ROW_SLOT)).toBe(
      'barbell-row',
    );
  });

  it('is a no-op when nothing was substituted', () => {
    const state = emptyState();
    expect(clearWeekSubstitution(state, WEEK, 'day2', ROW_SLOT)).toBe(state);
  });
});

describe('substitutePermanently', () => {
  it('changes the routine and leaves no week-scoped override behind', () => {
    const state = substitutePermanently(
      emptyState(),
      WEEK,
      'day2',
      ROW_SLOT,
      SUB,
    );

    expect(findDay(state.routine, 'day2')!.exercises[2].movementId).toBe(SUB);
    expect(state.weeks[WEEK].substitutions ?? {}).toEqual({});
    // Both this week and future weeks now plan the substitute.
    expect(effectiveMovementId(state, WEEK, 'day2', ROW_SLOT)).toBe(SUB);
    expect(effectiveMovementId(state, '2026-09-14', 'day2', ROW_SLOT)).toBe(
      SUB,
    );
  });
});

describe('progressions stay separate', () => {
  it('shows the substitute its own history, not the one it replaced', () => {
    // Barbell Row logged last week; the substitute has never been done.
    let state = log(emptyState(), PRIOR, 'day2', ROW_SLOT, 'barbell-row');
    state = substituteForWeek(state, WEEK, 'day2', ROW_SLOT, SUB);

    expect(findPriorPerformance(state, WEEK, SUB)).toBeNull();
    // And the replaced movement's own history is untouched.
    expect(
      findPriorPerformance(state, WEEK, 'barbell-row')?.sets[0].weight,
    ).toBe('185');
  });

  it('brings the substitute its history from another day entirely', () => {
    // Chest-Supported DB Row is planned on day 2 slot 3 as well; log it there
    // last week, then substitute it into slot 2 this week.
    let state = log(
      emptyState(),
      PRIOR,
      'day2',
      'day2-s3',
      'chest-supported-db-row',
      '70',
    );
    state = substituteForWeek(state, WEEK, 'day2', ROW_SLOT, SUB);

    const prior = findPriorPerformance(state, WEEK, SUB, 'day2', ROW_SLOT);
    expect(prior?.sets[0].weight).toBe('70');
    expect(prior?.slotId).toBe('day2-s3');
  });

  it('records the substitute as the movement performed', () => {
    let state = substituteForWeek(emptyState(), WEEK, 'day2', ROW_SLOT, SUB);
    state = withSets(state, WEEK, 'day2', ROW_SLOT, [set('70', '10')], SUB);

    expect(state.weeks[WEEK].days.day2.exercises[ROW_SLOT].movementId).toBe(
      SUB,
    );
    // Next week, the substitute's history is findable and the original's is not
    // polluted by it.
    expect(findPriorPerformance(state, '2026-09-14', SUB)?.sets[0].weight).toBe(
      '70',
    );
    expect(findPriorPerformance(state, '2026-09-14', 'barbell-row')).toBeNull();
  });

  it('restores the original exercise history when the swap is undone', () => {
    let state = log(emptyState(), PRIOR, 'day2', ROW_SLOT, 'barbell-row');
    state = substituteForWeek(state, WEEK, 'day2', ROW_SLOT, SUB);
    state = clearWeekSubstitution(state, WEEK, 'day2', ROW_SLOT);

    const movementId = effectiveMovementId(state, WEEK, 'day2', ROW_SLOT);
    expect(movementId).toBe('barbell-row');
    expect(findPriorPerformance(state, WEEK, movementId)?.sets[0].weight).toBe(
      '185',
    );
  });
});
