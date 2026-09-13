import { describe, expect, it } from 'vitest';
import { emptyState } from '@/lib/backup';
import {
  clearSessionSubstitution,
  effectiveMovementId as effectiveMovementIdOf,
  findDay,
  refreshOpenSnapshots,
  renameDay,
  resolveSessionRoutine,
  slotHasSetsInSession,
  substituteForSession,
  substitutePermanently as substitutePermanentlyIn,
} from '@/lib/routine';
import { findPriorPerformance, withSets } from '@/lib/workout';
import { ensureWeekDaySession } from '@/lib/sessions';
import { logsFor, sessionFor, sessionIdFor } from './helpers/sessions';
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
): WorkoutState => {
  const { state: next, sessionId } = ensureWeekDaySession(
    state,
    weekKey,
    dayId,
    weekKey,
  );
  return withSets(next, sessionId, slotId, [set(weight, '8')], movementId);
};

/**
 * Week-flavoured wrappers. Substitution is now scoped to a session, but these
 * tests are about "swapped for this week", so they materialise the week's
 * session first and then act on it.
 */
const session = (state: WorkoutState, weekKey: string, dayId: string) =>
  ensureWeekDaySession(state, weekKey, dayId, weekKey);

const substituteForWeek = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
  movementId: string,
): WorkoutState => {
  const { state: next, sessionId } = session(state, weekKey, dayId);
  return substituteForSession(next, sessionId, slotId, movementId);
};

const substitutePermanently = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
  movementId: string,
): WorkoutState => {
  const { state: next, sessionId } = session(state, weekKey, dayId);
  return substitutePermanentlyIn(next, sessionId, slotId, movementId);
};

const clearWeekSubstitution = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
): WorkoutState =>
  clearSessionSubstitution(state, sessionIdFor(state, weekKey, dayId), slotId);

const effectiveMovementId = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
): string => {
  const found = sessionFor(state, weekKey, dayId);
  return effectiveMovementIdOf(
    state,
    found ?? {
      sessionId: '',
      routineDayId: dayId,
      status: 'scheduled',
      exercises: {},
    },
    slotId,
  );
};

const resolveWeekRoutine = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
) =>
  resolveSessionRoutine(
    state,
    sessionFor(state, weekKey, dayId) ?? {
      sessionId: '',
      routineDayId: dayId,
      status: 'scheduled',
      exercises: {},
    },
  );

const slotHasSetsThisWeek = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
): boolean =>
  slotHasSetsInSession(state, sessionIdFor(state, weekKey, dayId), slotId);

/**
 * Anchor "prior" at a week: its day-2 session when one exists, otherwise the
 * date itself, which is all there is to go on before anything is logged.
 */
const anchorAt = (state: WorkoutState, weekKey: string) => {
  const sessionId = sessionIdFor(state, weekKey, 'day2');
  return sessionId ? { sessionId } : { date: weekKey };
};

/** Re-freeze every session, matching the old whole-week refresh. */
const refreshWeek = (state: WorkoutState, _weekKey: string): WorkoutState =>
  refreshOpenSnapshots(state, Object.keys(state.sessions));

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
    state = refreshWeek(
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

    expect(logsFor(state, PRIOR, 'day2')[ROW_SLOT].sets[0].weight).toBe('185');
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
    expect(sessionFor(state, WEEK, 'day2')?.substitutions ?? {}).toEqual({});
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

    expect(findPriorPerformance(state, anchorAt(state, WEEK), SUB)).toBeNull();
    // And the replaced movement's own history is untouched.
    expect(
      findPriorPerformance(state, anchorAt(state, WEEK), 'barbell-row')?.sets[0]
        .weight,
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

    const prior = findPriorPerformance(
      state,
      anchorAt(state, WEEK),
      SUB,
      'day2',
      ROW_SLOT,
    );
    expect(prior?.sets[0].weight).toBe('70');
    expect(prior?.slotId).toBe('day2-s3');
  });

  it('records the substitute as the movement performed', () => {
    let state = substituteForWeek(emptyState(), WEEK, 'day2', ROW_SLOT, SUB);
    state = withSets(
      state,
      sessionIdFor(state, WEEK, 'day2'),
      ROW_SLOT,
      [set('70', '10')],
      SUB,
    );

    expect(logsFor(state, WEEK, 'day2')[ROW_SLOT].movementId).toBe(SUB);
    // Next week, the substitute's history is findable and the original's is not
    // polluted by it.
    expect(
      findPriorPerformance(state, anchorAt(state, '2026-09-14'), SUB)?.sets[0]
        .weight,
    ).toBe('70');
    expect(
      findPriorPerformance(state, anchorAt(state, '2026-09-14'), 'barbell-row'),
    ).toBeNull();
  });

  it('restores the original exercise history when the swap is undone', () => {
    let state = log(emptyState(), PRIOR, 'day2', ROW_SLOT, 'barbell-row');
    state = substituteForWeek(state, WEEK, 'day2', ROW_SLOT, SUB);
    state = clearWeekSubstitution(state, WEEK, 'day2', ROW_SLOT);

    const movementId = effectiveMovementId(state, WEEK, 'day2', ROW_SLOT);
    expect(movementId).toBe('barbell-row');
    expect(
      findPriorPerformance(state, anchorAt(state, WEEK), movementId)?.sets[0]
        .weight,
    ).toBe('185');
  });
});
