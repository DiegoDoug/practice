/**
 * Progress readings for one exercise.
 *
 * Everything reads through `eligibleSets`, so a load is only ever compared
 * against another load of the same side, in its own unit, converted at the
 * point of comparison.
 */

import {
  eligibleSets,
  inPeriod,
  type EligibleSet,
  type HistoryPeriod,
  type SideKey,
} from './analytics';
import { orderedSessions } from './sessions';
import { resolveSessionRoutine } from './routine';
import { compareLoads, convert } from './units';
import type { MeasuredLoad } from './units';
import type { WeightUnit, WorkoutState } from './types';
import { parseDateKey, weekKey as weekKeyOf } from './week';

const ofSide = (rows: EligibleSet[], side: SideKey): EligibleSet[] =>
  rows.filter((row) => row.side === side);

/**
 * The heaviest load recorded for a side.
 *
 * Ties resolve to the EARLIER set, so a record has one owner and repeating it
 * does not silently reassign it.
 */
export function bestWeight(
  rows: EligibleSet[],
  side: SideKey,
): EligibleSet | null {
  let best: EligibleSet | null = null;
  for (const row of ofSide(rows, side)) {
    if (best === null || compareLoads(row.load, best.load) > 0) best = row;
  }
  return best;
}

/** The most reps recorded for a side, at any load. Ties go to the earlier set. */
export function bestReps(
  rows: EligibleSet[],
  side: SideKey,
): EligibleSet | null {
  let best: EligibleSet | null = null;
  for (const row of ofSide(rows, side)) {
    if (best === null || row.reps > best.reps) best = row;
  }
  return best;
}

/** Single-set volume, in kg so two units can be compared. */
export const setVolumeKg = (row: EligibleSet): number =>
  convert(row.load.value, row.load.unit, 'kg') * row.reps;

export function bestSetVolume(
  rows: EligibleSet[],
  side: SideKey,
): EligibleSet | null {
  let best: EligibleSet | null = null;
  for (const row of ofSide(rows, side)) {
    if (best === null || setVolumeKg(row) > setVolumeKg(best)) best = row;
  }
  return best;
}

export type RepsAtWeight = {
  /** The load, in the unit asked for. */
  weight: number;
  reps: number;
  row: EligibleSet;
};

/**
 * Best reps achieved at each load, heaviest first.
 *
 * Loads are grouped after conversion, so 100 kg and 220.46 lb are one row
 * rather than two that look like different weights.
 */
export function bestRepsAtWeight(
  rows: EligibleSet[],
  side: SideKey,
  unit: WeightUnit,
): RepsAtWeight[] {
  const byLoad = new Map<string, RepsAtWeight>();
  for (const row of ofSide(rows, side)) {
    const shown = convert(row.load.value, row.load.unit, unit);
    // Round for the grouping key only; the displayed value comes from it too,
    // so a converted load does not sprout false precision.
    const key = shown.toFixed(2);
    const existing = byLoad.get(key);
    if (!existing || row.reps > existing.reps) {
      byLoad.set(key, { weight: Number(key), reps: row.reps, row });
    }
  }
  return [...byLoad.values()].sort((a, b) => b.weight - a.weight);
}

/** The heaviest load carried for AT LEAST `reps` repetitions. */
export function bestWeightAtReps(
  rows: EligibleSet[],
  side: SideKey,
  reps: number,
): EligibleSet | null {
  return bestWeight(
    ofSide(rows, side).filter((row) => row.reps >= reps),
    side,
  );
}

export type HistoryRow = {
  sessionId: string;
  date: string | null;
  dateKnown: boolean;
  weekKey: string | null;
  title: string;
  sets: number;
  /** Work done, summing both sides of a unilateral set. Not a strength figure. */
  volume: number;
  /** Heaviest single-sided load in the session, which IS a strength figure. */
  bestLoad: MeasuredLoad | null;
  bestReps: number | null;
};

/** One row per session in which the movement was performed, newest first. */
export function exerciseHistory(
  state: WorkoutState,
  movementId: string,
  period: HistoryPeriod,
  today: string,
): HistoryRow[] {
  const rows = eligibleSets(state, { movementId, period, today });
  const bySession = new Map<string, EligibleSet[]>();
  for (const row of rows) {
    bySession.set(row.sessionId, [
      ...(bySession.get(row.sessionId) ?? []),
      row,
    ]);
  }

  const out: HistoryRow[] = [];
  for (const session of orderedSessions(state)) {
    const group = bySession.get(session.sessionId);
    if (!group || group.length === 0) continue;
    const resolved = resolveSessionRoutine(state, session);
    const heaviest = group.reduce(
      (best, row) => (compareLoads(row.load, best.load) > 0 ? row : best),
      group[0],
    );
    out.push({
      sessionId: session.sessionId,
      date: group[0].date,
      dateKnown: group[0].dateKnown,
      weekKey: group[0].weekKey,
      title: resolved.name
        ? `${resolved.label} — ${resolved.name}`
        : resolved.label,
      // A unilateral set contributes two rows, so counting distinct set ids
      // keeps "sets" meaning sets rather than measurements.
      sets: new Set(group.map((row) => row.setId)).size,
      volume: group.reduce((sum, row) => sum + row.load.value * row.reps, 0),
      bestLoad: heaviest.load,
      bestReps: group.reduce((most, row) => Math.max(most, row.reps), 0),
    });
  }
  return out.reverse();
}

/**
 * Earlier performances of a movement in the SAME week as a session.
 *
 * Useful when a movement comes round twice in a week: "what did I do on
 * Monday" is a different question from "what did I do last week".
 */
export function sameWeekPrior(
  state: WorkoutState,
  sessionId: string,
  movementId: string,
): HistoryRow[] {
  const session = state.sessions[sessionId];
  if (!session) return [];
  const bucket =
    session.performedDate ?? session.scheduledDate ?? session.legacyWeekKey;
  if (!bucket) return [];
  const week = weekKeyOf(parseDateKey(bucket));

  const ordered = orderedSessions(state);
  const position = ordered.findIndex((entry) => entry.sessionId === sessionId);

  return exerciseHistory(state, movementId, 'all', bucket).filter((row) => {
    if (row.sessionId === sessionId) return false;
    if (row.weekKey !== week) return false;
    const other = ordered.findIndex(
      (entry) => entry.sessionId === row.sessionId,
    );
    return other < position;
  });
}

/** Re-export so callers need one import for a period-filtered read. */
export { inPeriod };
