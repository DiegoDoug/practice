/**
 * Calendar maths and session scheduling.
 *
 * Two rules shape everything here:
 *
 * Sessions are placed by `performedDate` when it exists and `scheduledDate`
 * otherwise, but an UNDATED migrated session is never placed on a day at all.
 * Its `legacyWeekKey` is a Monday, and dropping it on that Monday would assert
 * something the old document never recorded. Those sessions surface through
 * `undatedByWeek` instead, under the week they were logged in.
 *
 * Nothing in this module creates a session as a side effect of looking at one.
 * `resolveDayLink` answers a navigation question and returns an intent; the
 * caller decides whether to act on it.
 */

import { loadModeFor } from './measure';
import { addSession, orderedSessions, sessionsInWeek } from './sessions';
import { findDay } from './routine';
import { isMissed } from './status';
import type { WorkoutSession, WorkoutState } from './types';
import { parseDateKey, toLocalDateKey, weekKey as weekKeyOf } from './week';

export type YearMonth = { year: number; month: number };

/**
 * Move a `YYYY-MM-DD` key by whole days.
 *
 * Goes through `parseDateKey`, which lands on local noon, so a day that is 23
 * or 25 hours long because the clocks changed still advances by exactly one
 * calendar day.
 */
export function shiftDate(date: string, days: number): string {
  const parsed = parseDateKey(date);
  parsed.setDate(parsed.getDate() + days);
  return toLocalDateKey(parsed);
}

export const nextMonth = ({ year, month }: YearMonth): YearMonth =>
  month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

export const previousMonth = ({ year, month }: YearMonth): YearMonth =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

export const monthLabel = (
  { year, month }: YearMonth,
  locale?: string,
): string =>
  new Date(year, month - 1, 1, 12).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

export type GridCell = {
  date: string;
  /** False for the leading and trailing days borrowed from adjacent months. */
  inMonth: boolean;
};

/**
 * Whole Monday-start weeks covering a month. Monday-start matches the week
 * keys the rest of the app uses, so a grid row is exactly one `weekKey`.
 */
export function monthGrid(year: number, month: number): GridCell[] {
  const first = new Date(year, month - 1, 1, 12);
  const last = new Date(year, month, 0, 12);
  const start = parseDateKey(weekKeyOf(first));
  const cells: GridCell[] = [];

  let cursor = toLocalDateKey(start);
  const endExclusive = shiftDate(weekKeyOf(last), 7);
  while (cursor !== endExclusive) {
    const parsed = parseDateKey(cursor);
    cells.push({
      date: cursor,
      inMonth: parsed.getFullYear() === year && parsed.getMonth() === month - 1,
    });
    cursor = shiftDate(cursor, 1);
  }
  return cells;
}

export type DayCell = GridCell & {
  sessions: WorkoutSession[];
  /** Any scheduled session here whose date has gone by. */
  missed: boolean;
  isToday: boolean;
};

/** The month grid with each day's sessions attached. */
export function calendarMonth(
  state: WorkoutState,
  month: YearMonth,
  today: string,
): DayCell[] {
  const byDate = new Map<string, WorkoutSession[]>();
  for (const session of orderedSessions(state)) {
    // Only a session with a real date belongs on a day.
    const date = session.performedDate ?? session.scheduledDate;
    if (!date) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), session]);
  }

  return monthGrid(month.year, month.month).map((cell) => {
    const sessions = byDate.get(cell.date) ?? [];
    return {
      ...cell,
      sessions,
      missed: sessions.some((session) => isMissed(session, today)),
      isToday: cell.date === today,
    };
  });
}

export type UndatedGroup = {
  weekKey: string;
  sessions: WorkoutSession[];
};

/**
 * Migrated sessions with no known date, grouped by their original week, newest
 * week first. These are shown as a list beside the grid rather than pinned to
 * a day, because which day they happened on was never recorded.
 */
export function undatedByWeek(state: WorkoutState): UndatedGroup[] {
  const groups = new Map<string, WorkoutSession[]>();
  for (const session of orderedSessions(state)) {
    if (session.performedDate || session.scheduledDate) continue;
    if (!session.legacyWeekKey) continue;
    const existing = groups.get(session.legacyWeekKey) ?? [];
    existing.push(session);
    groups.set(session.legacyWeekKey, existing);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([weekKey, sessions]) => ({ weekKey, sessions }));
}

/**
 * What a legacy `?day=` link should do now that a routine day can map to
 * several sessions in one week.
 *
 * Returns an intent, never a mutated state: navigation must not create
 * sessions, or reloading an old bookmark would quietly fill the calendar with
 * empty workouts.
 */
export type DayLink =
  | { kind: 'session'; sessionId: string }
  | { kind: 'choose'; sessionIds: string[] }
  | { kind: 'start'; dayId: string }
  | { kind: 'unknown' };

export function resolveDayLink(
  state: WorkoutState,
  weekKey: string,
  dayId: string,
): DayLink {
  const matches = sessionsInWeek(state, weekKey).filter(
    (session) => session.routineDayId === dayId,
  );
  if (matches.length === 1) {
    return { kind: 'session', sessionId: matches[0].sessionId };
  }
  if (matches.length > 1) {
    return { kind: 'choose', sessionIds: matches.map((s) => s.sessionId) };
  }
  if (!findDay(state.routine, dayId)) return { kind: 'unknown' };
  return { kind: 'start', dayId };
}

/**
 * Schedule an extra workout from a routine day.
 *
 * Deliberately does not look for an existing session first: "add another
 * session of Day 1 this week" is a thing the athlete can now ask for, and
 * de-duplicating would make it impossible.
 */
export const addExtraSession = (
  state: WorkoutState,
  scheduledDate: string,
  dayId: string,
): { state: WorkoutState; sessionId: string } =>
  addSession(state, { routineDayId: dayId, scheduledDate });

/**
 * An ad-hoc workout with no routine day. It gets an empty snapshot
 * immediately, because a blank session has no template to freeze later and its
 * exercises have nowhere else to live.
 */
export function addBlankSession(
  state: WorkoutState,
  scheduledDate: string,
  label = 'Extra workout',
): { state: WorkoutState; sessionId: string } {
  return addSession(state, {
    routineDayId: null,
    scheduledDate,
    snapshot: { label, name: '', exercises: [], groups: [] },
  });
}

/** Add an exercise to a session's own snapshot, for blank workouts. */
export function addSessionExercise(
  state: WorkoutState,
  sessionId: string,
  movementId: string,
): WorkoutState {
  const session = state.sessions[sessionId];
  if (!session) return state;

  const movement = state.movements[movementId];
  const snapshot = session.snapshot ?? {
    label: 'Extra workout',
    name: '',
    exercises: [],
    groups: [],
  };

  // Slot ids are minted against the session, not the routine, and must stay
  // unique even when the same movement is added twice.
  const taken = new Set(snapshot.exercises.map((entry) => entry.slotId));
  let index = snapshot.exercises.length;
  let slotId = `${sessionId}-s${index}`;
  while (taken.has(slotId)) {
    index += 1;
    slotId = `${sessionId}-s${index}`;
  }

  return {
    ...state,
    sessions: {
      ...state.sessions,
      [sessionId]: {
        ...session,
        snapshot: {
          ...snapshot,
          exercises: [
            ...snapshot.exercises,
            {
              slotId,
              movementId,
              name: movement?.name ?? 'Unknown exercise',
              group: movement?.group ?? '',
              ...(movement?.unilateral ? { unilateral: true } : {}),
              loadMode: loadModeFor(movement?.equipment ?? 'other'),
              primaryMuscles: movement?.primaryMuscles ?? [],
              secondaryMuscles: movement?.secondaryMuscles ?? [],
            },
          ],
        },
      },
    },
  };
}
