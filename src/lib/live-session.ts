/**
 * Pure timer maths for an in-progress workout.
 *
 * Everything is derived from timestamps rather than counted by a ticking
 * variable, so a throttled or suspended tab (a locked phone, a background tab)
 * comes back with the correct elapsed time instead of a frozen one. The only
 * job of an interval in the UI is to force a re-render.
 */

export type RestState = {
  startedAt: number;
  durationSec: number;
};

export type LiveSession = {
  /**
   * Pinned when the timer starts, so finishing after midnight — or after a
   * week boundary — still writes to the session the workout began in. A
   * session id is stable under rescheduling, which a week key was not.
   */
  sessionId: string;
  startedAt: number;
  /** Epoch ms the session was paused at, or null while running. */
  pausedAt: number | null;
  /** Accumulated paused time, excluding any pause currently open. */
  pausedMs: number;
  rest: RestState | null;
  restDefaultSec: number;
};

export const DEFAULT_REST_SEC = 90;

/** A session running for longer than this is almost certainly forgotten. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export function startSession(
  sessionId: string,
  now: number = Date.now(),
  restDefaultSec: number = DEFAULT_REST_SEC,
): LiveSession {
  return {
    sessionId,
    startedAt: now,
    pausedAt: null,
    pausedMs: 0,
    rest: null,
    restDefaultSec,
  };
}

export const isPaused = (session: LiveSession): boolean =>
  session.pausedAt !== null;

/**
 * Time actually spent training. Clamped at zero so a system clock moved
 * backwards cannot produce a negative duration.
 */
export function elapsedMs(
  session: LiveSession,
  now: number = Date.now(),
): number {
  const until = session.pausedAt ?? now;
  return Math.max(0, until - session.startedAt - session.pausedMs);
}

export function pauseSession(
  session: LiveSession,
  now: number = Date.now(),
): LiveSession {
  if (session.pausedAt !== null) return session;
  return { ...session, pausedAt: now };
}

export function resumeSession(
  session: LiveSession,
  now: number = Date.now(),
): LiveSession {
  if (session.pausedAt === null) return session;
  return {
    ...session,
    pausedAt: null,
    pausedMs: session.pausedMs + Math.max(0, now - session.pausedAt),
  };
}

export const togglePause = (
  session: LiveSession,
  now: number = Date.now(),
): LiveSession =>
  isPaused(session) ? resumeSession(session, now) : pauseSession(session, now);

export function startRest(
  session: LiveSession,
  now: number = Date.now(),
  durationSec: number = session.restDefaultSec,
): LiveSession {
  return { ...session, rest: { startedAt: now, durationSec } };
}

export const skipRest = (session: LiveSession): LiveSession => ({
  ...session,
  rest: null,
});

export function extendRest(session: LiveSession, bySec: number): LiveSession {
  if (!session.rest) return session;
  return {
    ...session,
    rest: {
      ...session.rest,
      durationSec: Math.max(0, session.rest.durationSec + bySec),
    },
  };
}

/** Milliseconds left on the rest timer, floored at zero. Null when not resting. */
export function restRemainingMs(
  session: LiveSession,
  now: number = Date.now(),
): number | null {
  if (!session.rest) return null;
  const endsAt = session.rest.startedAt + session.rest.durationSec * 1000;
  return Math.max(0, endsAt - now);
}

export const isRestComplete = (
  session: LiveSession,
  now: number = Date.now(),
): boolean => {
  const remaining = restRemainingMs(session, now);
  return remaining !== null && remaining === 0;
};

/** True once a session has been running long enough to be a leftover. */
export const isStale = (
  session: LiveSession,
  now: number = Date.now(),
): boolean => now - session.startedAt > STALE_AFTER_MS;

/** `m:ss`, or `h:mm:ss` once it passes an hour. */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
