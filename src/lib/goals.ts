/**
 * Exercise goals.
 *
 * A goal is a claim about ONE set: "a working set, this heavy, for this many
 * reps". Three properties make that claim trustworthy, and all three come from
 * the shared analytics layer rather than from anything stored here:
 *
 *  - **One set, both targets.** A heavy triple plus a light set of eight is not
 *    a heavy set of eight. Qualification is evaluated per measurement, never
 *    assembled across rows.
 *  - **Magnitude, not notation.** 225 lb clears a 100 kg target and 215 lb does
 *    not, because `compareLoads` converts before comparing. The display
 *    preference is not consulted at all.
 *  - **Derived, never stored.** No `achieved` flag exists to go stale:
 *    reopening, editing or deleting the qualifying set — or raising the target —
 *    changes the answer on the next read.
 *
 * Existing history counts. A goal set today for a lift already on record reads
 * as achieved immediately, flagged `alreadyAchievedWhenCreated` so the UI can
 * say "you have already done this" rather than implying it was earned since.
 */

import { eligibleSets, type EligibleSet, type SideKey } from './analytics';
import { loadModeFor, type LoadMode } from './measure';
import { compareLoads } from './units';
import type { Goal, WeightUnit, WorkoutState } from './types';

export type GoalInput = {
  movementId: string;
  targetWeight: number;
  targetReps: number;
  unit: WeightUnit;
  side?: 'left' | 'right';
  mode?: LoadMode;
};

export type GoalProgress = {
  goal: Goal;
  achieved: boolean;
  /** The earliest qualifying set, so the achievement date does not drift. */
  achievedBy: EligibleSet | null;
  /** Its date, or null when the document never recorded one. */
  achievedOn: string | null;
  /**
   * Whether the qualifying set predates the goal. An undated legacy set counts
   * as pre-existing: it is history from an older document, and claiming it
   * happened after the goal was set would be a guess.
   */
  alreadyAchievedWhenCreated: boolean;
  /** The heaviest load carried for at least the target reps. */
  bestWeightAtTargetReps: EligibleSet | null;
  /** The most reps done at or above the target load. */
  bestRepsAtTargetWeight: EligibleSet | null;
};

let goalCounter = 0;

/** Opaque, stable goal identity. */
export const newGoalId = (): string =>
  `goal_${Date.now().toString(36)}_${(goalCounter += 1).toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

/** An absent side means the target is a bilateral lift. */
export const goalSide = (goal: Goal): SideKey => goal.side ?? 'bilateral';

/** The logging mode a goal was set under, falling back to the library's. */
export const goalLoadMode = (state: WorkoutState, goal: Goal): LoadMode =>
  goal.mode ??
  loadModeFor(state.movements[goal.movementId]?.equipment ?? 'other');

const meetsWeight = (row: EligibleSet, goal: Goal): boolean =>
  compareLoads(row.load, { value: goal.targetWeight, unit: goal.unit }) >= 0;

/**
 * Progress towards one goal.
 *
 * Reads record-eligible sets only — the same narrowing records use, so a
 * warmup or a drop set cannot quietly complete a goal that a working set of the
 * same numbers would have earned.
 */
export function goalProgress(state: WorkoutState, goal: Goal): GoalProgress {
  const rows = eligibleSets(state, {
    movementId: goal.movementId,
    recordOnly: true,
  }).filter((row) => row.side === goalSide(goal));

  // `eligibleSets` is chronological, so the first match is the earliest.
  const achievedBy =
    rows.find((row) => row.reps >= goal.targetReps && meetsWeight(row, goal)) ??
    null;

  let bestWeightAtTargetReps: EligibleSet | null = null;
  let bestRepsAtTargetWeight: EligibleSet | null = null;
  for (const row of rows) {
    if (row.reps >= goal.targetReps) {
      if (
        bestWeightAtTargetReps === null ||
        compareLoads(row.load, bestWeightAtTargetReps.load) > 0
      ) {
        bestWeightAtTargetReps = row;
      }
    }
    if (meetsWeight(row, goal)) {
      if (
        bestRepsAtTargetWeight === null ||
        row.reps > bestRepsAtTargetWeight.reps
      ) {
        bestRepsAtTargetWeight = row;
      }
    }
  }

  return {
    goal,
    achieved: achievedBy !== null,
    achievedBy,
    achievedOn: achievedBy?.dateKnown ? achievedBy.date : null,
    alreadyAchievedWhenCreated:
      achievedBy !== null &&
      !(
        achievedBy.dateKnown &&
        achievedBy.date !== null &&
        achievedBy.date >= goal.createdAt
      ),
    bestWeightAtTargetReps,
    bestRepsAtTargetWeight,
  };
}

export type ListGoalOptions = { includeArchived?: boolean };

/**
 * Goals in a stable order: oldest first, then by movement and id, so the list
 * never reshuffles under an unrelated edit.
 */
export function listGoals(
  state: WorkoutState,
  { includeArchived = false }: ListGoalOptions = {},
): Goal[] {
  return Object.values(state.goals ?? {})
    .filter((goal) => includeArchived || goal.archived !== true)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.movementId.localeCompare(b.movementId) ||
        a.goalId.localeCompare(b.goalId),
    );
}

/**
 * Add a goal. Returns the new state and the goal, so a caller using the store's
 * updater pattern can dispatch the state and still name what it just created.
 *
 * `goalId` is injectable purely so tests can be deterministic; production
 * callers let it be minted.
 */
export function createGoal(
  state: WorkoutState,
  input: GoalInput,
  createdAt: string = new Date().toISOString().slice(0, 10),
  goalId: string = newGoalId(),
): { state: WorkoutState; goal: Goal } {
  const goal: Goal = {
    goalId,
    movementId: input.movementId,
    targetWeight: input.targetWeight,
    targetReps: input.targetReps,
    unit: input.unit,
    mode:
      input.mode ??
      loadModeFor(state.movements[input.movementId]?.equipment ?? 'other'),
    ...(input.side ? { side: input.side } : {}),
    createdAt,
  };
  return {
    state: { ...state, goals: { ...(state.goals ?? {}), [goalId]: goal } },
    goal,
  };
}

/** Editable fields. The id and the creation date are not among them. */
export type GoalPatch = Partial<
  Pick<
    Goal,
    'movementId' | 'targetWeight' | 'targetReps' | 'unit' | 'side' | 'mode'
  >
>;

/**
 * Edit a goal in place. Returns the SAME state when the goal is not there, so a
 * stale dialog cannot resurrect a deleted goal as a half-built new one.
 */
export function updateGoal(
  state: WorkoutState,
  goalId: string,
  patch: GoalPatch,
): WorkoutState {
  const existing = state.goals?.[goalId];
  if (!existing) return state;
  const next: Goal = { ...existing, ...patch };
  // An explicit `side: undefined` in the patch means "make this bilateral".
  if ('side' in patch && patch.side === undefined) delete next.side;
  return { ...state, goals: { ...state.goals, [goalId]: next } };
}

const setArchived = (
  state: WorkoutState,
  goalId: string,
  archived: boolean,
): WorkoutState => {
  const existing = state.goals?.[goalId];
  if (!existing) return state;
  const next: Goal = { ...existing, archived: true };
  if (!archived) delete next.archived;
  return { ...state, goals: { ...state.goals, [goalId]: next } };
};

/** Retire a goal. The history that met it is untouched. */
export const archiveGoal = (state: WorkoutState, goalId: string) =>
  setArchived(state, goalId, true);

export const unarchiveGoal = (state: WorkoutState, goalId: string) =>
  setArchived(state, goalId, false);

/** Remove a goal. Workout history is never involved. */
export function deleteGoal(state: WorkoutState, goalId: string): WorkoutState {
  if (!state.goals?.[goalId]) return state;
  const goals = { ...state.goals };
  delete goals[goalId];
  return { ...state, goals };
}
