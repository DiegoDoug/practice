/**
 * Session status and its permitted transitions.
 *
 * One field rather than independent `completed` / `skipped` booleans, which
 * could disagree with each other and could not describe a session that is
 * merely planned. "Missed" is deliberately absent: it is derived from the
 * scheduled date, so it cannot go stale when a date moves.
 */

export type SessionStatus =
  'scheduled' | 'in_progress' | 'completed' | 'skipped';

/**
 * The only moves allowed. Notably `scheduled → completed` is not one: a
 * session becomes completed by being trained, and jumping straight there
 * would leave a workout with no execution record at all.
 */
export const ALLOWED_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  scheduled: ['in_progress', 'skipped'],
  in_progress: ['completed'],
  completed: ['in_progress'],
  skipped: ['scheduled'],
};

export const canTransition = (
  from: SessionStatus,
  to: SessionStatus,
): boolean => ALLOWED_TRANSITIONS[from].includes(to);

/**
 * A planned session whose date has gone by. Derived rather than stored, and
 * false when no date is known — a migrated workout with an unknown date is
 * not missed, it is undated.
 */
export function isMissed(
  session: { status: SessionStatus; scheduledDate?: string },
  today: string,
): boolean {
  if (session.status !== 'scheduled') return false;
  if (!session.scheduledDate) return false;
  return session.scheduledDate < today;
}
