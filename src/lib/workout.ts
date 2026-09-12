import { PROGRAM, getPlannedDay } from './program';
import {
  blankSet,
  hasAnyValue,
  isLoggedSet,
  type ExerciseLog,
  type SetEntry,
  type WorkoutState,
  type WorkoutWeek,
} from './types';
import { priorWeekKeys } from './week';
import { setVolume } from './volume';

export const emptyWeek = (): WorkoutWeek => ({ days: {}, completion: {} });

export const getWeek = (state: WorkoutState, key: string): WorkoutWeek =>
  state.weeks[key] ?? emptyWeek();

export function getSets(
  state: WorkoutState,
  key: string,
  dayId: string,
  index: number,
): SetEntry[] {
  const sets = state.weeks[key]?.days[dayId]?.exercises[String(index)]?.sets;
  return sets && sets.length > 0 ? sets : [blankSet()];
}

/** Immutably replace the set list for one planned exercise. */
export function withSets(
  state: WorkoutState,
  key: string,
  dayId: string,
  index: number,
  sets: SetEntry[],
): WorkoutState {
  const week = getWeek(state, key);
  const day = week.days[dayId] ?? { exercises: {} };
  return {
    ...state,
    weeks: {
      ...state.weeks,
      [key]: {
        ...week,
        days: {
          ...week.days,
          [dayId]: {
            ...day,
            exercises: {
              ...day.exercises,
              [String(index)]: { sets },
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
  const week = getWeek(state, key);
  return {
    ...state,
    weeks: {
      ...state.weeks,
      [key]: { ...week, completion: { ...week.completion, [dayId]: done } },
    },
  };
}

export function withExerciseName(
  state: WorkoutState,
  dayId: string,
  index: number,
  name: string,
): WorkoutState {
  const planned = getPlannedDay(dayId)?.exercises[index]?.name ?? '';
  const trimmed = name.trim();
  const overrides = { ...state.exerciseNames };
  const overrideKey = `${dayId}:${index}`;
  if (trimmed === '' || trimmed === planned) {
    delete overrides[overrideKey];
  } else {
    overrides[overrideKey] = trimmed;
  }
  return { ...state, exerciseNames: overrides };
}

export type PriorPerformance = {
  weekKey: string;
  sets: SetEntry[];
};

/**
 * Most recent non-empty logging of the same planned day/exercise, searching
 * only strictly earlier week keys.
 */
export function findPriorPerformance(
  state: WorkoutState,
  currentKey: string,
  dayId: string,
  index: number,
): PriorPerformance | null {
  for (const key of priorWeekKeys(Object.keys(state.weeks), currentKey)) {
    const log: ExerciseLog | undefined =
      state.weeks[key]?.days[dayId]?.exercises[String(index)];
    const sets = (log?.sets ?? []).filter(hasAnyValue);
    if (sets.length > 0) return { weekKey: key, sets };
  }
  return null;
}

/**
 * Append a copy of the prior first logged set. Never overwrites current data:
 * the result is always the existing rows plus exactly one new row.
 */
export function repeatLast(
  current: SetEntry[],
  prior: PriorPerformance | null,
): SetEntry[] {
  const source = prior?.sets.find(isLoggedSet) ?? prior?.sets[0];
  if (!source) return current;
  return [...current, { ...source }];
}

/** Drop one row, keeping a single empty row when the last one is removed. */
export function removeSet(sets: SetEntry[], index: number): SetEntry[] {
  if (sets.length <= 1) return [blankSet()];
  return sets.filter((_, i) => i !== index);
}

export function updateSet(
  sets: SetEntry[],
  index: number,
  field: keyof SetEntry,
  value: string,
): SetEntry[] {
  return sets.map((set, i) => (i === index ? { ...set, [field]: value } : set));
}

/** Count of exercises in a day with at least one logged (weight/reps) row. */
export function countLoggedExercises(
  state: WorkoutState,
  key: string,
  dayId: string,
): number {
  const exercises = state.weeks[key]?.days[dayId]?.exercises ?? {};
  return Object.values(exercises).filter((log) =>
    (log?.sets ?? []).some(isLoggedSet),
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
};

/** Sessions with logged data, newest week first, then program order. */
export function buildHistory(state: WorkoutState): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const keys = Object.keys(state.weeks).sort().reverse();
  for (const key of keys) {
    const week = state.weeks[key];
    for (const day of PROGRAM) {
      const exercises = week.days[day.id]?.exercises;
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
      entries.push({
        weekKey: key,
        dayId: day.id,
        dayLabel: day.label,
        dayName: day.name,
        sets,
        volume,
        completed: Boolean(week.completion[day.id]),
      });
    }
  }
  return entries;
}

export function formatSetSummary(set: SetEntry): string {
  const weight = set.weight.trim() || '—';
  const reps = set.reps.trim() ? `${set.reps.trim()} reps` : '— reps';
  const rpe = set.rpe.trim() ? ` @ RPE ${set.rpe.trim()}` : '';
  return `${weight} × ${reps}${rpe}`;
}
