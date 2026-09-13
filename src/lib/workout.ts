import {
  blankSet,
  cloneSet,
  hasAnyValue,
  isLoggedSet,
  type ExerciseLog,
  type SetEntry,
  type SideEntry,
  type WorkoutState,
  type WorkoutWeek,
} from './types';
import { priorWeekKeys } from './week';
import { setVolume, sideTotals } from './volume';
import { ensureDaySnapshot, resolveWeekRoutine } from './routine';

export const emptyWeek = (): WorkoutWeek => ({ days: {}, completion: {} });

export const getWeek = (state: WorkoutState, key: string): WorkoutWeek =>
  state.weeks[key] ?? emptyWeek();

export function getLog(
  state: WorkoutState,
  key: string,
  dayId: string,
  slotId: string,
): ExerciseLog | undefined {
  return state.weeks[key]?.days[dayId]?.exercises[slotId];
}

export function getSets(
  state: WorkoutState,
  key: string,
  dayId: string,
  slotId: string,
  unilateral = false,
): SetEntry[] {
  const sets = getLog(state, key, dayId, slotId)?.sets;
  return sets && sets.length > 0 ? sets : [blankSet(unilateral)];
}

/**
 * Immutably replace the set list for one slot.
 *
 * `movementId` is always the slot's CURRENT movement — never one carried over
 * from a prior performance — so a substituted slot records what was actually
 * performed. The snapshot is taken here rather than at call sites so no write
 * path can skip it.
 */
export function withSets(
  state: WorkoutState,
  key: string,
  dayId: string,
  slotId: string,
  sets: SetEntry[],
  movementId: string,
  unilateral?: boolean,
): WorkoutState {
  const snapshotted = ensureDaySnapshot(state, key, dayId);
  const week = getWeek(snapshotted, key);
  const day = week.days[dayId] ?? { exercises: {} };
  return {
    ...snapshotted,
    weeks: {
      ...snapshotted.weeks,
      [key]: {
        ...week,
        days: {
          ...week.days,
          [dayId]: {
            ...day,
            exercises: {
              ...day.exercises,
              [slotId]: {
                movementId,
                ...(unilateral ? { unilateral: true } : {}),
                sets,
              },
            },
          },
        },
      },
    },
  };
}

export function withCompletion(
  state: WorkoutState,
  key: string,
  dayId: string,
  done: boolean,
): WorkoutState {
  const snapshotted = ensureDaySnapshot(state, key, dayId);
  const week = getWeek(snapshotted, key);
  return {
    ...snapshotted,
    weeks: {
      ...snapshotted.weeks,
      [key]: { ...week, completion: { ...week.completion, [dayId]: done } },
    },
  };
}

export type PriorPerformance = {
  weekKey: string;
  dayId: string;
  slotId: string;
  movementId: string;
  unilateral: boolean;
  sets: SetEntry[];
};

/**
 * The most recent logging of a movement, from any earlier week, any day and
 * any slot.
 *
 * Keying on the movement rather than the slot is what keeps a substituted
 * exercise's progression separate from the one it replaced: swap in Front
 * Squat and the card shows Front Squat's own history, wherever it was last
 * performed, while Back Squat's history stays untouched and returns if you
 * swap back. Ties within a week resolve to the same day, then the same slot,
 * so the result is deterministic.
 */
export function findPriorPerformance(
  state: WorkoutState,
  currentKey: string,
  movementId: string,
  preferDayId?: string,
  preferSlotId?: string,
): PriorPerformance | null {
  if (!movementId) return null;

  for (const weekKey of priorWeekKeys(Object.keys(state.weeks), currentKey)) {
    const week = state.weeks[weekKey];
    if (!week) continue;

    const matches: PriorPerformance[] = [];
    for (const [dayId, dayLog] of Object.entries(week.days)) {
      for (const [slotId, log] of Object.entries(dayLog.exercises)) {
        if (log?.movementId !== movementId) continue;
        const sets = (log.sets ?? []).filter(hasAnyValue);
        if (sets.length === 0) continue;
        matches.push({
          weekKey,
          dayId,
          slotId,
          movementId,
          unilateral: Boolean(log.unilateral),
          sets,
        });
      }
    }
    if (matches.length === 0) continue;

    matches.sort((a, b) => rank(a) - rank(b));
    return matches[0];
  }
  return null;

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

export function updateSet(
  sets: SetEntry[],
  index: number,
  field: keyof SideEntry,
  value: string,
  side: 'left' | 'right' = 'left',
): SetEntry[] {
  return sets.map((set, i) => {
    if (i !== index) return set;
    if (side === 'left') return { ...set, [field]: value };
    const right = { ...(set.right ?? { weight: '', reps: '', rpe: '' }) };
    right[field] = value;
    return { ...set, right };
  });
}

/**
 * Exercises in a day with at least one logged row, counted only for slots the
 * day actually plans. Orphaned logs from removed slots are excluded so the
 * "X/Y logged" numerator cannot exceed its denominator.
 */
export function countLoggedExercises(
  state: WorkoutState,
  key: string,
  dayId: string,
): number {
  const planned = resolveWeekRoutine(state, key, dayId).exercises;
  const exercises = state.weeks[key]?.days[dayId]?.exercises ?? {};
  return planned.filter((slot) =>
    (exercises[slot.slotId]?.sets ?? []).some(isLoggedSet),
  ).length;
}

export type HistoryEntry = {
  weekKey: string;
  dayId: string;
  dayLabel: string;
  dayName: string;
  sets: number;
  volume: number;
  completed: boolean;
  archived: boolean;
};

/**
 * Sessions with logged data, newest week first, then routine order.
 *
 * Labels come from the week's frozen snapshot, so renaming a day never
 * rewrites what a past session says it was.
 */
export function buildHistory(state: WorkoutState): HistoryEntry[] {
  const order = new Map(
    state.routine.map((day, index) => [day.dayId, index] as const),
  );
  const archivedIds = new Set(
    state.routine.filter((day) => day.archived).map((day) => day.dayId),
  );
  const entries: HistoryEntry[] = [];

  for (const weekKey of Object.keys(state.weeks).sort().reverse()) {
    const week = state.weeks[weekKey];
    const dayIds = Object.keys(week.days).sort(
      (a, b) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    );

    for (const dayId of dayIds) {
      const exercises = week.days[dayId]?.exercises;
      if (!exercises) continue;

      let sets = 0;
      let volume = 0;
      for (const log of Object.values(exercises)) {
        for (const set of log?.sets ?? []) {
          if (!hasAnyValue(set)) continue;
          sets += 1;
          volume += setVolume(set);
        }
      }
      if (sets === 0) continue;

      const resolved = resolveWeekRoutine(state, weekKey, dayId);
      entries.push({
        weekKey,
        dayId,
        dayLabel: resolved.label,
        dayName: resolved.name,
        sets,
        volume,
        completed: Boolean(week.completion[dayId]),
        archived: archivedIds.has(dayId),
      });
    }
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
  const rows: {
    weekKey: string;
    left: number;
    right: number;
    leftReps: number;
    rightReps: number;
  }[] = [];

  for (const weekKey of Object.keys(state.weeks).sort()) {
    let left = 0;
    let right = 0;
    let leftReps = 0;
    let rightReps = 0;
    let found = false;

    for (const dayLog of Object.values(state.weeks[weekKey].days)) {
      for (const log of Object.values(dayLog.exercises)) {
        if (log?.movementId !== movementId || !log.unilateral) continue;
        const totals = sideTotals(log.sets ?? []);
        left += totals.left;
        right += totals.right;
        leftReps += totals.leftReps;
        rightReps += totals.rightReps;
        found = true;
      }
    }
    if (found) rows.push({ weekKey, left, right, leftReps, rightReps });
  }
  return rows;
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
