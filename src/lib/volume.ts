import {
  hasAnyValue,
  type ExerciseLog,
  type SetEntry,
  type SideEntry,
} from './types';

/** Parse a draft numeric field, returning null unless it is finite and > 0. */
export function parsePositive(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Volume for one side: weight × reps, counted only when both parse cleanly. */
export function sideVolume(side: SideEntry | undefined): number {
  if (!side) return 0;
  const weight = parsePositive(side.weight);
  const reps = parsePositive(side.reps);
  if (weight === null || reps === null) return 0;
  return weight * reps;
}

/**
 * Volume for one set. A unilateral set sums both sides — a set of 50 × 10 per
 * side is 1000 of total work — while still counting as a single logged set.
 */
export function setVolume(set: SetEntry): number {
  return sideVolume(set) + sideVolume(set.right);
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

/** Left/right totals for one exercise log. */
export function sideTotals(sets: SetEntry[]): {
  left: number;
  right: number;
  leftReps: number;
  rightReps: number;
} {
  let left = 0;
  let right = 0;
  let leftReps = 0;
  let rightReps = 0;
  for (const set of sets) {
    left += sideVolume(set);
    right += sideVolume(set.right);
    leftReps += parsePositive(set.reps) ?? 0;
    rightReps += parsePositive(set.right?.reps ?? '') ?? 0;
  }
  return { left, right, leftReps, rightReps };
}

/**
 * Imbalance as a signed share of the larger side, in percent. Positive means
 * the left side is ahead. Returns null when either side has no volume.
 */
export function imbalancePercent(left: number, right: number): number | null {
  const larger = Math.max(left, right);
  if (larger <= 0 || left <= 0 || right <= 0) return null;
  return ((left - right) / larger) * 100;
}
