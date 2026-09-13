/** Core domain types for Weekly Practice Log. */

/** The current persisted schema version. */
export type SchemaVersion = 4;

/** One side's numbers. Values stay strings at the draft layer so partial
 *  input ("13", "1.") is never destroyed by eager numeric coercion. */
export type SideEntry = {
  weight: string;
  reps: string;
  rpe: string;
};

/**
 * A single logged set.
 *
 * The base fields carry the whole set for a bilateral exercise, and the LEFT
 * side for a unilateral one, with `right` holding the other side. Keeping the
 * base fields populated in both modes is deliberate: every consumer
 * (`isLoggedSet`, volume, history, CSV) keeps working without needing to know
 * the slot's mode, which a `{ left?, right? }` shape would have required.
 */
export type SetEntry = SideEntry & {
  right?: SideEntry;
};

export type ExerciseLog = {
  /** The movement actually performed — survives substitution and reordering. */
  movementId: string;
  /** Mode as recorded, so old logs render the way they were logged. */
  unilateral?: boolean;
  sets: SetEntry[];
};

export type WorkoutDayLog = {
  /** Keyed by `slotId`, never by position. */
  exercises: Record<string, ExerciseLog>;
};

/**
 * A frozen copy of one routine day as it stood when that session was logged.
 * This is what lets a renamed or reordered routine leave past workouts intact.
 */
export type RoutineDaySnapshot = {
  label: string;
  name: string;
  exercises: {
    slotId: string;
    movementId: string;
    /** Fully resolved display name at log time. */
    name: string;
    /** Fully resolved muscle-group label at log time. */
    group: string;
    unilateral?: boolean;
  }[];
};

export type WorkoutWeek = {
  days: Record<string, WorkoutDayLog>;
  completion: Record<string, boolean>;
  /** Per-day routine as it stood when that day was first logged. */
  routine?: Record<string, RoutineDaySnapshot>;
  /**
   * One-off swaps for this week only, keyed by slotId → movementId.
   *
   * Kept separate from the snapshot so a later routine edit, which re-freezes
   * open snapshots, cannot quietly undo a swap the athlete made mid-week.
   */
  substitutions?: Record<string, string>;
};

export type WeightUnit = 'lb' | 'kg';

export type Equipment =
  'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'other';

/** A movement in the exercise library. */
export type Movement = {
  id: string;
  name: string;
  group: string;
  equipment: Equipment;
  /** Sibling movement ids offered first when substituting, best-first. */
  variations?: string[];
  /** True when the movement is naturally trained one limb at a time. */
  unilateral?: boolean;
  /** User-created rather than seeded. Seeded movements are not deletable. */
  custom?: boolean;
};

export type RoutineExercise = {
  /** Stable across reorder, rename and substitution. Logs key off this. */
  slotId: string;
  movementId: string;
  /** Overrides the movement's name for this slot only. */
  nameOverride?: string;
  /**
   * Overrides the movement's group for this slot only. The seeded program
   * labels the same movement differently per day — Barbell Row is "Length" on
   * Day 2 and "Back" on Day 6 — so the label belongs to the slot.
   */
  groupOverride?: string;
  /** Overrides the movement's default mode for this slot only. */
  unilateral?: boolean;
};

export type RoutineDay = {
  dayId: string;
  label: string;
  name: string;
  warmup: string[];
  exercises: RoutineExercise[];
  /** Removed from the plan; past logs are retained and still shown. */
  archived?: boolean;
};

/** Persisted application state. `weeks` is keyed by local-Monday `YYYY-MM-DD`. */
export type WorkoutState = {
  schemaVersion: SchemaVersion;
  programVersion: number;
  unit: WeightUnit;
  weeks: Record<string, WorkoutWeek>;
  /** The user's editable plan, seeded from `PROGRAM`. */
  routine: RoutineDay[];
  /** Seeded library plus user additions, keyed by movement id. */
  movements: Record<string, Movement>;
};

/** The seeded plan shape. `PROGRAM` is now a seed only, not runtime state. */
export type PlannedExercise = {
  name: string;
  group: string;
};

export type PlannedDay = {
  id: string;
  label: string;
  name: string;
  warmup: string[];
  exercises: PlannedExercise[];
};

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const blankSide = (): SideEntry => ({ weight: '', reps: '', rpe: '' });

export const blankSet = (unilateral = false): SetEntry =>
  unilateral ? { ...blankSide(), right: blankSide() } : blankSide();

const sideHasLoad = (side: SideEntry | undefined): boolean =>
  side !== undefined && (side.weight.trim() !== '' || side.reps.trim() !== '');

const sideHasAny = (side: SideEntry | undefined): boolean =>
  side !== undefined && (sideHasLoad(side) || side.rpe.trim() !== '');

/** A row counts as logged when either side carries weight or reps. RPE alone
 *  does not. */
export const isLoggedSet = (set: SetEntry): boolean =>
  sideHasLoad(set) || sideHasLoad(set.right);

/** Looser test used for history/CSV inclusion, matching the source behaviour. */
export const hasAnyValue = (set: SetEntry): boolean =>
  sideHasAny(set) || sideHasAny(set.right);

/** Copy a set without sharing its nested `right` object. */
export const cloneSet = (set: SetEntry): SetEntry => ({
  weight: set.weight,
  reps: set.reps,
  rpe: set.rpe,
  ...(set.right ? { right: { ...set.right } } : {}),
});
