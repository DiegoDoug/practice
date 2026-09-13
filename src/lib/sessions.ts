/**
 * Independent, dated training sessions.
 *
 * The old model keyed logs by `weeks[weekKey].days[dayId]`, which allowed a
 * routine day at most once per week and gave a workout no date of its own.
 * Sessions replace that: several can point at the same routine day, one can be
 * moved between dates without losing its identity, and one can exist with no
 * routine day at all.
 *
 * Three date facts stay separate throughout — see `docs/data-contract.md`.
 * Nothing here ever fills one in from another.
 */

import { canTransition, type SessionStatus } from './status';
import type { WorkoutSession, WorkoutState } from './types';
import { weekKey as weekKeyOf, parseDateKey } from './week';

/**
 * An opaque id. Deliberately carries no date and no day: both can change, and
 * an id that encodes mutable facts stops being an identity the moment they do.
 */
export const newSessionId = (): string =>
  `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * The one place ids are derived rather than minted: a migrated session, so the
 * same backup migrates to the same ids on every device.
 */
export const legacySessionId = (weekKey: string, dayId: string): string =>
  `legacy_${weekKey}_${dayId}`;

/**
 * The date to file a session under: what actually happened if known, otherwise
 * what was planned, otherwise the week a migrated session came from. Null when
 * the document says nothing at all.
 */
export function effectiveDate(session: WorkoutSession): string | null {
  return (
    session.performedDate ??
    session.scheduledDate ??
    session.legacyWeekKey ??
    null
  );
}

/**
 * Whether the date is a fact or a bucket. False for a migrated session, whose
 * `legacyWeekKey` says only which week it belonged to — never which day.
 */
export const isDateKnown = (session: WorkoutSession): boolean =>
  Boolean(session.performedDate ?? session.scheduledDate);

/**
 * Chronological order. Dated sessions first, oldest first; within a date, by
 * start time; then by id so the result is stable rather than merely sorted.
 * Undated sessions sort last instead of being guessed into a position.
 */
export function compareSessions(a: WorkoutSession, b: WorkoutSession): number {
  const dateA = effectiveDate(a);
  const dateB = effectiveDate(b);
  if (dateA !== dateB) {
    if (dateA === null) return 1;
    if (dateB === null) return -1;
    return dateA < dateB ? -1 : 1;
  }
  const startA = a.startedAt ?? a.finishedAt;
  const startB = b.startedAt ?? b.finishedAt;
  if (startA !== startB) {
    if (startA === undefined) return 1;
    if (startB === undefined) return -1;
    return startA - startB;
  }
  if (a.sessionId === b.sessionId) return 0;
  return a.sessionId < b.sessionId ? -1 : 1;
}

/** Every session, oldest first. The iterator the analytics layers read through. */
export const orderedSessions = (state: WorkoutState): WorkoutSession[] =>
  Object.values(state.sessions).sort(compareSessions);

/**
 * Sessions belonging to a calendar week, bucketed by `effectiveDate` — so a
 * Monday plan trained on Tuesday counts in Tuesday's week, and a migrated
 * session stays in the week it was logged in.
 */
export function sessionsInWeek(
  state: WorkoutState,
  key: string,
): WorkoutSession[] {
  return orderedSessions(state).filter((session) => {
    const date = effectiveDate(session);
    return date !== null && weekKeyOf(parseDateKey(date)) === key;
  });
}

export function sessionsOnDate(
  state: WorkoutState,
  date: string,
): WorkoutSession[] {
  return orderedSessions(state).filter(
    (session) => effectiveDate(session) === date,
  );
}

const write = (state: WorkoutState, session: WorkoutSession): WorkoutState => ({
  ...state,
  sessions: { ...state.sessions, [session.sessionId]: session },
});

const patch = (
  state: WorkoutState,
  sessionId: string,
  fn: (session: WorkoutSession) => WorkoutSession,
): WorkoutState => {
  const session = state.sessions[sessionId];
  if (!session) return state;
  return write(state, fn(session));
};

export function addSession(
  state: WorkoutState,
  init: Partial<WorkoutSession> & { routineDayId: string | null },
): { state: WorkoutState; sessionId: string } {
  const sessionId = init.sessionId ?? newSessionId();
  const session: WorkoutSession = {
    status: 'scheduled',
    exercises: {},
    ...init,
    sessionId,
  };
  return { state: write(state, session), sessionId };
}

export function removeSession(
  state: WorkoutState,
  sessionId: string,
): WorkoutState {
  if (!state.sessions[sessionId]) return state;
  const sessions = { ...state.sessions };
  delete sessions[sessionId];
  return { ...state, sessions };
}

/** Move a plan. Identity, logs and the performed date are all left alone. */
export const reschedule = (
  state: WorkoutState,
  sessionId: string,
  scheduledDate: string,
): WorkoutState =>
  patch(state, sessionId, (session) => ({ ...session, scheduledDate }));

/** Correct history. Distinct from rescheduling, which moves the plan. */
export const setPerformedDate = (
  state: WorkoutState,
  sessionId: string,
  performedDate: string,
): WorkoutState =>
  patch(state, sessionId, (session) => ({ ...session, performedDate }));

/**
 * Apply a status change, refusing anything the contract does not permit.
 *
 * Moving a session to `in_progress` closes any other live one, so the "at most
 * one in-progress session" invariant is enforced here rather than left to
 * callers to remember.
 */
export function setStatus(
  state: WorkoutState,
  sessionId: string,
  status: SessionStatus,
): WorkoutState {
  const session = state.sessions[sessionId];
  if (!session) return state;
  if (session.status === status) return state;
  if (!canTransition(session.status, status)) return state;

  let next = write(state, { ...session, status });
  if (status === 'in_progress') {
    for (const other of Object.values(next.sessions)) {
      if (other.sessionId === sessionId) continue;
      if (other.status !== 'in_progress') continue;
      next = write(next, {
        ...other,
        status: other.finishedAt ? 'completed' : 'scheduled',
      });
    }
  }
  return next;
}

/**
 * Start training a session: mark it in progress, stamp the start time, and
 * capture the performed date IF it is not already known — so a session begun
 * before midnight and resumed after it stays the day it started on.
 */
export function startedSession(
  state: WorkoutState,
  sessionId: string,
  today: string,
  now: number,
): WorkoutState {
  const started = patch(state, sessionId, (session) => ({
    ...session,
    startedAt: session.startedAt ?? now,
    performedDate: session.performedDate ?? today,
  }));
  return setStatus(started, sessionId, 'in_progress');
}

/**
 * The session for a routine day in a week, or null.
 *
 * Never creates one: creation is always an explicit action, so navigating
 * cannot leave duplicates behind. Several sessions can now match one day in a
 * week; this returns the earliest, and stage 3's calendar is where the athlete
 * picks between them explicitly.
 */
export function findWeekDaySession(
  state: WorkoutState,
  key: string,
  dayId: string,
): WorkoutSession | null {
  return (
    sessionsInWeek(state, key).find(
      (session) => session.routineDayId === dayId,
    ) ?? null
  );
}

/**
 * Get the session for a routine day in a week, creating one if there is none.
 *
 * Called ONLY from explicit user actions — logging a set, starting a workout,
 * marking a day done — never from navigation or render, so opening a link
 * cannot leave sessions behind.
 *
 * A session created this way is dated `today` rather than left undated,
 * because the act that creates it is the athlete training now. That also keeps
 * it findable: an undated session falls outside `sessionsInWeek`, so the next
 * keystroke would create a second one. `today` is expected to fall inside
 * `key`; when it does not, the session is scheduled rather than dated, since
 * nothing was performed.
 */
export function ensureWeekDaySession(
  state: WorkoutState,
  key: string,
  dayId: string,
  today: string,
  /**
   * Id to use if one has to be created. Callers that need the id BEFORE the
   * state update lands — starting the timer, say — mint it first and pass it
   * here, so they never have to read it back out of a pending update.
   */
  preferredId?: string,
): { state: WorkoutState; sessionId: string } {
  const existing = findWeekDaySession(state, key, dayId);
  if (existing) return { state, sessionId: existing.sessionId };

  const todayIsInWeek = weekKeyOf(parseDateKey(today)) === key;
  return addSession(state, {
    routineDayId: dayId,
    ...(preferredId ? { sessionId: preferredId } : {}),
    ...(todayIsInWeek ? { performedDate: today } : { scheduledDate: today }),
  });
}
