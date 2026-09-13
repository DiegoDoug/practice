/**
 * Parsers and validators for the three numeric quantities a set can carry.
 *
 * `parsePositive` in `volume.ts` is right for reps but wrong for load: zero
 * external load is exactly what a bodyweight set records, and rejecting it
 * would make pull-ups impossible to complete. So load and reps get separate
 * parsers, and assistance gets a third because it progresses downwards.
 *
 * Every parser takes the draft strings the logging layer holds (see
 * `SideEntry`) and returns null for anything partial, so a half-typed "1."
 * never reaches a metric.
 */

import type { Equipment } from './types';

/** How a movement's load is recorded, which decides what a complete set needs. */
export type LoadMode = 'external' | 'bodyweight';

const finite = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // Number('') is 0 and Number('1.') is 1; the trim above handles the first,
  // and the explicit format test below handles the second.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Reps: a whole number of repetitions, at least one. */
export function parseReps(value: string): number | null {
  const parsed = finite(value);
  if (parsed === null || parsed <= 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * External load. Zero is valid and means "bodyweight only" — it is a real
 * measurement, not a missing one, which is why this is not `parsePositive`.
 */
export function parseLoad(value: string): number | null {
  const parsed = finite(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

/**
 * Assistance, as on an assisted pull-up machine. Stored as a positive number
 * meaning "this much of your bodyweight was taken off", so LESS assistance is
 * progress — the opposite direction to load, and the reason it cannot share
 * load's comparison rules.
 */
export function parseAssistance(value: string): number | null {
  return parseLoad(value);
}

export const loadModeFor = (equipment: Equipment): LoadMode =>
  equipment === 'bodyweight' ? 'bodyweight' : 'external';
