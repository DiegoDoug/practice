/**
 * What makes a set finished.
 *
 * This replaces the old `isCompleteSet`, which required both weight and reps to
 * be finite numbers. That rule quietly made bodyweight work impossible to
 * complete — a pull-up set has no external load to type — so completion now
 * depends on the movement's load mode.
 *
 * It answers only "does this row carry what it needs". Whether the athlete
 * ticked it is `set.done`, and the two are deliberately separate: typing a
 * value must never complete a set or start the rest timer.
 */

import {
  parseAssistance,
  parseLoad,
  parseReps,
  type LoadMode,
} from './measure';
import type { SetEntry, SideEntry } from './types';

export type CompletionMode = {
  loadMode: LoadMode;
  unilateral?: boolean;
  /** Assisted work records how much weight was taken off, not added. */
  assisted?: boolean;
};

const sideIsComplete = (
  side: SideEntry | undefined,
  mode: CompletionMode,
): boolean => {
  if (!side) return false;
  if (parseReps(side.reps) === null) return false;

  if (mode.assisted) {
    // Assistance is required: "how much help" is the load being progressed.
    return parseAssistance(side.assist ?? '') !== null;
  }

  const hasWeight = side.weight.trim() !== '';
  if (mode.loadMode === 'bodyweight') {
    // No load at all is the normal case; added weight must still be valid.
    return !hasWeight || parseLoad(side.weight) !== null;
  }
  return parseLoad(side.weight) !== null;
};

/** True when a row carries everything its mode requires — both sides if unilateral. */
export const isSetComplete = (set: SetEntry, mode: CompletionMode): boolean =>
  mode.unilateral
    ? sideIsComplete(set, mode) && sideIsComplete(set.right, mode)
    : sideIsComplete(set, mode);

/** The kind a set counts as. Absent reads as working, so old logs need no rewrite. */
export const setKind = (set: SetEntry) => set.kind ?? 'working';

/**
 * Eligible for working-set counts and workload targets: explicitly done, and
 * not a warmup. Drop sets count here — they are real work — but not towards
 * records, which `isRecordEligible` decides.
 */
export const isCountedWorkingSet = (set: SetEntry): boolean =>
  set.done === true && setKind(set) !== 'warmup';

/**
 * Eligible to set a weight or rep record. Warmups are not work, and a drop
 * set's load is not a fresh max. `reachedFailure` is irrelevant here: a working
 * set taken to failure is a perfectly good record.
 */
export const isRecordEligible = (set: SetEntry): boolean =>
  set.done === true && setKind(set) === 'working';
