/**
 * The shared analytics layer.
 *
 * Every reading about past training — progress tables, records, and the
 * workload and goal features to come — goes through `eligibleSets`, so they
 * cannot disagree about what counts, what unit it was in, or what order it
 * happened in.
 *
 * Three rules are enforced here rather than in each consumer:
 *
 *  - A measurement carries the unit it was LOGGED in. The display preference
 *    converts on the way out; it never rewrites what was lifted.
 *  - A unilateral set produces two one-sided measurements and no combined one.
 *    That is what makes it impossible for a left+right total to become a
 *    strength record: no such number exists to compare.
 *  - An undated session is flagged as undated. It keeps its week, because that
 *    much the old document did record, and is sorted last rather than being
 *    given a day it never had.
 */

import { isRecordEligible, setKind } from './completion';
import { loadModeFor, parseLoad, parseReps, type LoadMode } from './measure';
import { orderedSessions } from './sessions';
import type { MeasuredLoad } from './units';
import type { SetKind, WorkoutState } from './types';
import { parseDateKey, weekKey as weekKeyOf } from './week';
import { shiftDate } from './calendar';

/** Which limb a measurement belongs to. Never merged. */
export type SideKey = 'bilateral' | 'left' | 'right';

export type EligibleSet = {
  sessionId: string;
  slotId: string;
  setId: string;
  movementId: string;
  side: SideKey;
  /** The load as recorded, with its own unit. */
  load: MeasuredLoad;
  reps: number;
  kind: SetKind;
  reachedFailure: boolean;
  loadMode: LoadMode;
  /** The day it happened, or null when the document never recorded one. */
  date: string | null;
  dateKnown: boolean;
  /** Known even for an undated migrated session. */
  weekKey: string | null;
  doneAt?: number;
  /** Chronological position. Stable, and shared by both sides of one set. */
  order: number;
};

export type HistoryPeriod = 'all' | '4w' | '8w' | '12w' | '6m' | '1y';

const PERIOD_DAYS: Record<Exclude<HistoryPeriod, 'all'>, number> = {
  '4w': 28,
  '8w': 56,
  '12w': 84,
  '6m': 182,
  '1y': 365,
};

/** The first date a period includes, or null for all time. */
export const periodStart = (
  period: HistoryPeriod,
  today: string,
): string | null =>
  period === 'all' ? null : shiftDate(today, -PERIOD_DAYS[period]);

/**
 * Whether a dated thing falls inside a period.
 *
 * An UNDATED session is included only in the all-time view. Whether it fell
 * inside a window is genuinely unknowable, so it is neither guessed in nor
 * quietly counted as recent.
 */
export function inPeriod(
  row: { date: string | null; dateKnown: boolean },
  period: HistoryPeriod,
  today: string,
): boolean {
  if (period === 'all') return true;
  if (!row.dateKnown || row.date === null) return false;
  const start = periodStart(period, today);
  return start === null || row.date >= start;
}

export type EligibleOptions = {
  movementId?: string;
  /** Working sets only — excludes warmups and drop sets. */
  recordOnly?: boolean;
  period?: HistoryPeriod;
  today?: string;
  /**
   * Read every row under THIS logging mode instead of the session snapshot's
   * or the library's.
   *
   * A goal stores the mode it was set under, and that stored mode has to stay
   * authoritative: if the library is later edited to call a bodyweight movement
   * a loaded one, a blank weight would stop reading as zero added load and a
   * reps-only goal would become permanently unreachable. Overriding here keeps
   * the decision in one place rather than reinterpreting rows afterwards.
   */
  loadMode?: LoadMode;
};

/**
 * Every completed set, oldest first, flattened into one-sided measurements.
 *
 * "Completed" means the athlete ticked it — never inferred from the values.
 */
export function eligibleSets(
  state: WorkoutState,
  options: EligibleOptions = {},
): EligibleSet[] {
  const {
    movementId,
    recordOnly,
    period = 'all',
    today,
    loadMode: loadModeOverride,
  } = options;
  const rows: EligibleSet[] = [];
  let order = 0;

  for (const session of orderedSessions(state)) {
    const date = session.performedDate ?? session.scheduledDate ?? null;
    const dateKnown = date !== null;
    const bucket = date ?? session.legacyWeekKey ?? null;
    const week = bucket === null ? null : weekKeyOf(parseDateKey(bucket));

    if (period !== 'all' && today) {
      if (!inPeriod({ date, dateKnown }, period, today)) continue;
    }

    // Snapshot order first, so rows follow the session as it was performed.
    const snapshotOrder =
      session.snapshot?.exercises.map((e) => e.slotId) ?? [];
    const slotIds = [
      ...snapshotOrder.filter((slotId) => session.exercises[slotId]),
      ...Object.keys(session.exercises)
        .filter((slotId) => !snapshotOrder.includes(slotId))
        .sort(),
    ];

    for (const slotId of slotIds) {
      const log = session.exercises[slotId];
      if (!log) continue;
      if (movementId && log.movementId !== movementId) continue;

      const snapshotEntry = session.snapshot?.exercises.find(
        (entry) => entry.slotId === slotId,
      );
      const loadMode: LoadMode =
        loadModeOverride ??
        snapshotEntry?.loadMode ??
        loadModeFor(state.movements[log.movementId]?.equipment ?? 'other');
      const unit = log.unit ?? state.unit;
      const unilateral = Boolean(log.unilateral);

      for (const set of log.sets ?? []) {
        // Completion is the only gate. Kind travels with the row so callers
        // that care — workload excludes warmups, records exclude drop sets —
        // filter explicitly rather than relying on what this layer dropped.
        if (set.done !== true) continue;
        if (recordOnly && !isRecordEligible(set)) continue;
        order += 1;

        const sides: { side: SideKey; weight: string; reps: string }[] =
          unilateral
            ? [
                { side: 'left', weight: set.weight, reps: set.reps },
                {
                  side: 'right',
                  weight: set.right?.weight ?? '',
                  reps: set.right?.reps ?? '',
                },
              ]
            : [{ side: 'bilateral', weight: set.weight, reps: set.reps }];

        for (const entry of sides) {
          const reps = parseReps(entry.reps);
          if (reps === null) continue;
          const load =
            entry.weight.trim() === '' && loadMode === 'bodyweight'
              ? 0
              : parseLoad(entry.weight);
          if (load === null) continue;

          rows.push({
            sessionId: session.sessionId,
            slotId,
            setId: set.setId ?? `${session.sessionId}:${slotId}:${order}`,
            movementId: log.movementId,
            side: entry.side,
            load: { value: load, unit },
            reps,
            kind: setKind(set),
            reachedFailure: set.reachedFailure === true,
            loadMode,
            date,
            dateKnown,
            weekKey: week,
            ...(set.doneAt !== undefined ? { doneAt: set.doneAt } : {}),
            order,
          });
        }
      }
    }
  }
  return rows;
}

/** Movements with at least one completed set, for the picker's suggestions. */
export function loggedMovementIds(state: WorkoutState): string[] {
  const ids = new Set<string>();
  for (const row of eligibleSets(state)) ids.add(row.movementId);
  return [...ids];
}
