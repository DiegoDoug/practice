/**
 * Bridge helpers for the suites written against the week/day model.
 *
 * Logs now live on sessions, but "log day 1 of this week" is still the clearest
 * way to write most of these tests, so these helpers do the resolution once
 * instead of scattering session plumbing through every assertion.
 */
import { ensureWeekDaySession, findWeekDaySession } from '@/lib/sessions';
import { findDay } from '@/lib/routine';
import { withCompletion, withSets } from '@/lib/workout';
import type { SetEntry, WorkoutSession, WorkoutState } from '@/lib/types';

/** A date inside a week: the Monday the key names. */
export const dateInWeek = (weekKey: string): string => weekKey;

export const sessionIdFor = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
): string => findWeekDaySession(state, weekKey, dayId)?.sessionId ?? '';

export const sessionFor = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
): WorkoutSession | null => findWeekDaySession(state, weekKey, dayId);

/** The exercise logs for a (week, day), or an empty map when none exist. */
export const logsFor = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
): WorkoutSession['exercises'] =>
  findWeekDaySession(state, weekKey, dayId)?.exercises ?? {};

export const setsFor = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
): SetEntry[] => logsFor(state, weekKey, dayId)[slotId]?.sets ?? [];

/** Log a slot, creating the week's session for that day on first write. */
export function logDay(
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  slotId: string,
  sets: SetEntry[],
  movementId?: string,
): WorkoutState {
  const { state: withSession, sessionId } = ensureWeekDaySession(
    state,
    weekKey,
    dayId,
    dateInWeek(weekKey),
  );
  const slot = findDay(withSession.routine, dayId)?.exercises.find(
    (entry) => entry.slotId === slotId,
  );
  return withSets(
    withSession,
    sessionId,
    slotId,
    sets,
    movementId ?? slot?.movementId ?? 'unknown',
    slot?.unilateral,
  );
}

/** Mark a (week, day) complete, creating its session if needed. */
export function completeDay(
  state: WorkoutState,
  weekKey: string,
  dayId: string,
  done = true,
): WorkoutState {
  const { state: withSession, sessionId } = ensureWeekDaySession(
    state,
    weekKey,
    dayId,
    dateInWeek(weekKey),
  );
  return withCompletion(withSession, sessionId, done);
}

/** Per-day completion for a week, the shape the day tabs still consume. */
export function completionOf(
  state: WorkoutState,
  weekKey: string,
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const session of Object.values(state.sessions)) {
    if (!session.routineDayId) continue;
    if (findWeekDaySession(state, weekKey, session.routineDayId) !== session) {
      continue;
    }
    map[session.routineDayId] = session.status === 'completed';
  }
  return map;
}
