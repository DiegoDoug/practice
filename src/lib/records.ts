/**
 * Personal records.
 *
 * Records are DERIVED, never stored: editing, reopening or deleting a set
 * changes what the records are on the next read, so a stale claim cannot
 * survive a correction.
 *
 * Three dimensions, each kept per side:
 *  - `heaviest` — the biggest load.
 *  - `mostReps` — the most repetitions, at any load.
 *  - `volume`   — the biggest single SET (load × reps), never a session total
 *                 and never a left+right sum.
 */

import { eligibleSets, type EligibleSet, type SideKey } from './analytics';
import { bestReps, bestSetVolume, bestWeight, setVolumeKg } from './progress';
import { compareLoads } from './units';
import type { WorkoutState } from './types';

export type RecordDimension = 'heaviest' | 'mostReps' | 'volume';

export type SideRecords = {
  heaviest: EligibleSet | null;
  mostReps: EligibleSet | null;
  volume: EligibleSet | null;
};

export type MovementRecords = Record<SideKey, SideRecords | null>;

const SIDES: SideKey[] = ['bilateral', 'left', 'right'];

/** Current records for a movement, per side. Null for a side never trained. */
export function currentRecords(
  state: WorkoutState,
  movementId: string,
): MovementRecords {
  const rows = eligibleSets(state, { movementId, recordOnly: true });
  const out = {} as MovementRecords;
  for (const side of SIDES) {
    const ofSide = rows.filter((row) => row.side === side);
    out[side] =
      ofSide.length === 0
        ? null
        : {
            heaviest: bestWeight(rows, side),
            mostReps: bestReps(rows, side),
            volume: bestSetVolume(rows, side),
          };
  }
  return out;
}

export type BrokenRecord = {
  side: SideKey;
  dimension: RecordDimension;
  row: EligibleSet;
};

/**
 * The record dimensions a given set takes, comparing it against every OTHER
 * eligible set of the same side.
 *
 * Strictly greater, so a tie is not a new record — repeating your best is not
 * beating it. This is the only input to a record celebration, and the caller
 * fires it solely on an explicit completion; nothing here runs on hydration,
 * on an import, or on an ordinary edit.
 */
export function recordsBrokenBy(
  state: WorkoutState,
  movementId: string,
  setId: string,
): BrokenRecord[] {
  const rows = eligibleSets(state, { movementId, recordOnly: true });
  const mine = rows.filter((row) => row.setId === setId);
  if (mine.length === 0) return [];

  const broken: BrokenRecord[] = [];
  for (const row of mine) {
    const others = rows.filter(
      (other) => other.side === row.side && other.setId !== setId,
    );
    if (others.every((other) => compareLoads(row.load, other.load) > 0)) {
      broken.push({ side: row.side, dimension: 'heaviest', row });
    }
    if (others.every((other) => row.reps > other.reps)) {
      broken.push({ side: row.side, dimension: 'mostReps', row });
    }
    if (others.every((other) => setVolumeKg(row) > setVolumeKg(other))) {
      broken.push({ side: row.side, dimension: 'volume', row });
    }
  }
  return broken;
}

/**
 * A stable name for "this set took this record at this value".
 *
 * Used to remember which celebrations have already been shown, so reopening a
 * set and ticking it again does not congratulate the athlete twice for the same
 * lift — while genuinely improving it, which changes the value, does.
 */
export const celebrationKey = (broken: BrokenRecord): string =>
  [
    broken.row.setId,
    broken.side,
    broken.dimension,
    broken.dimension === 'mostReps'
      ? broken.row.reps
      : broken.dimension === 'heaviest'
        ? `${broken.row.load.value}${broken.row.load.unit}`
        : setVolumeKg(broken.row).toFixed(3),
  ].join(':');

/** Short human phrasing for a celebration. */
export function describeRecord(
  broken: BrokenRecord,
  unitLabel: string,
): string {
  const sideLabel = broken.side === 'bilateral' ? '' : ` (${broken.side} side)`;
  switch (broken.dimension) {
    case 'heaviest':
      return `Heaviest yet${sideLabel}: ${broken.row.load.value} ${broken.row.load.unit}`;
    case 'mostReps':
      return `Most reps yet${sideLabel}: ${broken.row.reps}`;
    default:
      return `Best set yet${sideLabel}: ${broken.row.load.value} ${unitLabel} × ${broken.row.reps}`;
  }
}
