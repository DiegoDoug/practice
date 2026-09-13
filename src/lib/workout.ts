import {
  blankSet,
  cloneSet,
  hasAnyValue,
  isLoggedSet,
  type ExerciseLog,
  type SetEntry,
  type SideEntry,
  type WorkoutSession,
  type WorkoutState,
} from './types';
import { setVolume, sideTotals } from './volume';
import { isSetComplete, type CompletionMode } from './completion';
import { ensureSessionSnapshot, resolveSessionRoutine } from './routine';
import {
  compareSessions,
  effectiveDate,
  isDateKnown,
  orderedSessions,
} from './sessions';
import { parseDateKey, weekKey as weekKeyOf } from './week';

export function getLog(
  state: WorkoutState,
  sessionId: string,
  slotId: string,
): ExerciseLog | undefined {
  return state.sessions[sessionId]?.exercises[slotId];
}

export function getSets(
  state: WorkoutState,
  sessionId: string,
  slotId: string,
  unilateral = false,
): SetEntry[] {
  const sets = getLog(state, sessionId, slotId)?.sets;
  return sets && sets.length > 0 ? sets : [blankSet(unilateral)];
}

/**
 * Immutably replace the set list for one slot of one session.
 *
 * `movementId` is always the slot's CURRENT movement — never one carried over
 * from a prior performance — so a substituted slot records what was actually
 * performed. The snapshot is frozen here rather than at call sites so no write
 * path can skip it, and the performed date is captured on this first write for
 * the same reason.
 */
export function withSets(
  state: WorkoutState,
  sessionId: string,
  slotId: string,
  sets: SetEntry[],
  movementId: string,
  unilateral?: boolean,
  today?: string,
): WorkoutState {
  const snapshotted = ensureSessionSnapshot(state, sessionId);
  const session = snapshotted.sessions[sessionId];
  if (!session) return state;
  return {
    ...snapshotted,
    sessions: {
      ...snapshotted.sessions,
      [sessionId]: {
        ...session,
        // Logging is training: if nothing has dated this session yet, the date
        // it was first logged on is the date it happened.
        ...(today && !session.performedDate ? { performedDate: today } : {}),
        exercises: {
          ...session.exercises,
          [slotId]: {
            movementId,
            ...(unilateral ? { unilateral: true } : {}),
            unit: session.exercises[slotId]?.unit ?? snapshotted.unit,
            sets,
          },
        },
      },
    },
  };
}

/**
 * Mark a session finished, or reopen it. Goes through the status contract, so
 * an impossible transition is refused rather than written.
 */
export function withCompletion(
  state: WorkoutState,
  sessionId: string,
  done: boolean,
  now?: number,
): WorkoutState {
  const snapshotted = ensureSessionSnapshot(state, sessionId);
  const session = snapshotted.sessions[sessionId];
  if (!session) return state;

  if (done) {
    if (session.status === 'completed') return snapshotted;
    return {
      ...snapshotted,
      sessions: {
        ...snapshotted.sessions,
        [sessionId]: {
          ...session,
          status: 'completed',
          ...(now ? { finishedAt: now } : {}),
        },
      },
    };
  }
  if (session.status !== 'completed') return snapshotted;
  return {
    ...snapshotted,
    sessions: {
      ...snapshotted.sessions,
      [sessionId]: { ...session, status: 'scheduled' },
    },
  };
}

export type PriorPerformance = {
  sessionId: string;
  /** The date it was performed, or null for an undated migrated session. */
  date: string | null;
  dayId: string | null;
  slotId: string;
  movementId: string;
  unilateral: boolean;
  sets: SetEntry[];
};

/**
 * Where to measure "prior" from: a session, or a bare date for the common case
 * where nothing has been logged yet and so no session exists. An empty anchor
 * means "everything logged so far", which is the right answer when the athlete
 * has not started this exercise.
 */
export type PriorAnchor = {
  sessionId?: string;
  date?: string | null;
};

/**
 * The most recent logging of a movement, from any earlier session, any day and
 * any slot.
 *
 * Keying on the movement rather than the slot is what keeps a substituted
 * exercise's progression separate from the one it replaced: swap in Front Squat
 * and the card shows Front Squat's own history, wherever it was last performed,
 * while Back Squat's history stays untouched and returns if you swap back.
 *
 * "Earlier" is chronological order over sessions, so a workout trained late
 * counts as later. Ties inside one session resolve to the same day, then the
 * same slot, so the result is deterministic.
 */
export function findPriorPerformance(
  state: WorkoutState,
  anchor: PriorAnchor,
  movementId: string,
  preferDayId?: string,
  preferSlotId?: string,
): PriorPerformance | null {
  if (!movementId) return null;

  const current: WorkoutSession | null =
    (anchor.sessionId ? state.sessions[anchor.sessionId] : undefined) ??
    (anchor.date
      ? {
          sessionId: '',
          routineDayId: null,
          status: 'scheduled',
          exercises: {},
          performedDate: anchor.date,
        }
      : null);

  // Newest first, excluding the anchor itself and anything at or after it.
  const earlier = orderedSessions(state)
    .filter((session) => session.sessionId !== anchor.sessionId)
    .filter((session) => !current || compareSessions(session, current) < 0)
    .reverse();

  // Sessions sharing a date are one tier: the athlete did both on the same
  // day, so "which of these two" is a preference question, not a recency one.
  // Collecting the whole tier before ranking is what keeps prefer-same-slot and
  // prefer-same-day meaningful when a movement appears twice in a week.
  const matches: PriorPerformance[] = [];
  let tierDate: string | null | undefined;

  for (const session of earlier) {
    const date = effectiveDate(session);
    if (matches.length > 0 && date !== tierDate) break;

    for (const [slotId, log] of Object.entries(session.exercises)) {
      if (log?.movementId !== movementId) continue;
      const sets = (log.sets ?? []).filter(hasAnyValue);
      if (sets.length === 0) continue;
      matches.push({
        sessionId: session.sessionId,
        date,
        dayId: session.routineDayId,
        slotId,
        movementId,
        unilateral: Boolean(log.unilateral),
        sets,
      });
      tierDate = date;
    }
  }
  if (matches.length === 0) return null;

  matches.sort((a, b) => rank(a) - rank(b));
  return matches[0];

  function rank(match: PriorPerformance): number {
    if (preferSlotId && match.slotId === preferSlotId) return 0;
    if (preferDayId && match.dayId === preferDayId) return 1;
    return 2;
  }
}

/**
 * Append a copy of the prior first logged set. Never overwrites current data:
 * the result is always the existing rows plus exactly one new row. The copy is
 * deep, so the new row's per-side values are not shared with the source.
 */
export function repeatLast(
  current: SetEntry[],
  prior: PriorPerformance | null,
): SetEntry[] {
  const source = prior?.sets.find(isLoggedSet) ?? prior?.sets[0];
  if (!source) return current;
  return [...current, cloneSet(source)];
}

/** Drop one row, keeping a single empty row when the last one is removed. */
export function removeSet(
  sets: SetEntry[],
  index: number,
  unilateral = false,
): SetEntry[] {
  if (sets.length <= 1) return [blankSet(unilateral)];
  return sets.filter((_, i) => i !== index);
}

/**
 * Edit one field of one set.
 *
 * Editing NEVER completes a set — that is an explicit act — but it can
 * un-complete one: a row whose reps have just been cleared is no longer a
 * finished set, and leaving `done` on it would keep counting work that is no
 * longer recorded. The completion mode is optional so callers that have no
 * movement context (tests, CSV tooling) keep the plain behaviour.
 */
export function updateSet(
  sets: SetEntry[],
  index: number,
  field: keyof SideEntry,
  value: string,
  side: 'left' | 'right' = 'left',
  mode?: CompletionMode,
): SetEntry[] {
  return sets.map((set, i) => {
    if (i !== index) return set;

    let next: SetEntry;
    if (side === 'left') {
      next = { ...set, [field]: value };
    } else {
      const right = { ...(set.right ?? { weight: '', reps: '', rpe: '' }) };
      right[field] = value;
      next = { ...set, right };
    }

    const check = mode ?? {
      loadMode: 'external' as const,
      unilateral: Boolean(next.right),
    };
    if (next.done && !isSetComplete(next, check)) {
      delete next.done;
      delete next.doneAt;
    }
    return next;
  });
}

/**
 * Exercises in a session with at least one logged row, counted only for slots
 * the session actually plans. Orphaned logs from removed slots are excluded so
 * the "X/Y logged" numerator cannot exceed its denominator.
 */
export function countLoggedExercises(
  state: WorkoutState,
  sessionId: string,
): number {
  const session = state.sessions[sessionId];
  if (!session) return 0;
  const planned = resolveSessionRoutine(state, session).exercises;
  return planned.filter((slot) =>
    (session.exercises[slot.slotId]?.sets ?? []).some(isLoggedSet),
  ).length;
}

export type HistoryEntry = {
  sessionId: string;
  /** The routine day it came from, or null for an ad-hoc workout. */
  dayId: string | null;
  /** Null for a migrated session whose date was never recorded. */
  date: string | null;
  /** The week it falls in, which a migrated session still knows. */
  weekKey: string | null;
  dayLabel: string;
  dayName: string;
  sets: number;
  volume: number;
  completed: boolean;
  archived: boolean;
};

/**
 * Sessions with logged data, newest first.
 *
 * Labels come from each session's frozen snapshot, so renaming a day never
 * rewrites what a past session says it was.
 */
export function buildHistory(state: WorkoutState): HistoryEntry[] {
  const archivedIds = new Set(
    state.routine.filter((day) => day.archived).map((day) => day.dayId),
  );
  const entries: HistoryEntry[] = [];

  for (const session of orderedSessions(state).reverse()) {
    let sets = 0;
    let volume = 0;
    for (const log of Object.values(session.exercises)) {
      for (const set of log?.sets ?? []) {
        if (!hasAnyValue(set)) continue;
        sets += 1;
        volume += setVolume(set);
      }
    }
    if (sets === 0) continue;

    const resolved = resolveSessionRoutine(state, session);
    const date = effectiveDate(session);
    entries.push({
      sessionId: session.sessionId,
      dayId: session.routineDayId,
      date: isDateKnown(session) ? date : null,
      weekKey: date === null ? null : weekKeyOf(parseDateKey(date)),
      dayLabel: resolved.label,
      dayName: resolved.name,
      sets,
      volume,
      completed: session.status === 'completed',
      archived: session.routineDayId
        ? archivedIds.has(session.routineDayId)
        : false,
    });
  }
  return entries;
}

/** Per-week left/right totals for one movement, oldest week first. */
export function sideProgression(
  state: WorkoutState,
  movementId: string,
): {
  weekKey: string;
  left: number;
  right: number;
  leftReps: number;
  rightReps: number;
}[] {
  const byWeek = new Map<
    string,
    { left: number; right: number; leftReps: number; rightReps: number }
  >();

  for (const session of orderedSessions(state)) {
    const date = effectiveDate(session);
    if (date === null) continue;
    const key = weekKeyOf(parseDateKey(date));

    for (const log of Object.values(session.exercises)) {
      if (log?.movementId !== movementId || !log.unilateral) continue;
      const totals = sideTotals(log.sets ?? []);
      const row = byWeek.get(key) ?? {
        left: 0,
        right: 0,
        leftReps: 0,
        rightReps: 0,
      };
      row.left += totals.left;
      row.right += totals.right;
      row.leftReps += totals.leftReps;
      row.rightReps += totals.rightReps;
      byWeek.set(key, row);
    }
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekKey, row]) => ({ weekKey, ...row }));
}

const formatSide = (side: SideEntry): string => {
  const weight = side.weight.trim() || '—';
  const reps = side.reps.trim() ? `${side.reps.trim()} reps` : '— reps';
  const rpe = side.rpe.trim() ? ` @ RPE ${side.rpe.trim()}` : '';
  return `${weight} × ${reps}${rpe}`;
};

export function formatSetSummary(set: SetEntry): string {
  if (!set.right) return formatSide(set);
  return `L ${formatSide(set)} · R ${formatSide(set.right)}`;
}
