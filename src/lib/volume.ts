import { hasAnyValue, type ExerciseLog, type SetEntry } from './types';

/** Parse a draft numeric field, returning null unless it is finite and > 0. */
export function parsePositive(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Volume for one set: weight × reps, counted only when both parse cleanly. */
export function setVolume(set: SetEntry): number {
  const weight = parsePositive(set.weight);
  const reps = parsePositive(set.reps);
  if (weight === null || reps === null) return 0;
  return weight * reps;
}

export function totalVolume(sets: SetEntry[]): number {
  return sets.reduce((sum, set) => sum + setVolume(set), 0);
}

/** Count of rows carrying any value — the source's "logged sets" measure. */
export function countLoggedSets(sets: SetEntry[]): number {
  return sets.filter(hasAnyValue).length;
}

export function summariseDay(exercises: Record<string, ExerciseLog>): {
  sets: number;
  volume: number;
} {
  let sets = 0;
  let volume = 0;
  for (const log of Object.values(exercises)) {
    for (const set of log?.sets ?? []) {
      if (!hasAnyValue(set)) continue;
      sets += 1;
      volume += setVolume(set);
    }
  }
  return { sets, volume };
}

export const formatVolume = (volume: number, locale?: string): string =>
  Math.round(volume).toLocaleString(locale);
