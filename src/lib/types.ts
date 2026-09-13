/** Core domain types for Weekly Practice Log. */

import type { SessionStatus } from './status';

/** The current persisted schema version. */
export type SchemaVersion = 4;

/** One side's numbers. Values stay strings at the draft layer so partial
 *  input ("13", "1.") is never destroyed by eager numeric coercion. */
export type SideEntry = {
  weight: string;
  reps: string;
  rpe: string;
  /** Assistance taken off, for assisted bodyweight work. Progresses downwards. */
  assist?: string;
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
  /** Stable identity for this row. Circuit progress and records key off it. */
  setId?: string;
  /** Explicitly marked finished by the athlete. Never inferred from values. */
  done?: boolean;
  /** When it was marked done. Absent on migrated sets — that time is unknown. */
  doneAt?: number;
  /** Absent reads as 'working', so existing logs need no rewrite. */
  kind?: SetKind;
  /**
   * Taken to failure. Independent of `kind`, because a working set and a drop
   * set can both end there, and reaching failure disqualifies no record.
   */
  reachedFailure?: boolean;
};

export type ExerciseLog = {
  /** The movement actually performed — survives substitution and reordering. */
  movementId: string;
  /** Mode as recorded, so old logs render the way they were logged. */
  unilateral?: boolean;
  /**
   * The unit these loads were entered in. Stored per log, not read from the
   * global preference, so switching kg/lb changes the display and never the
   * meaning of what was lifted.
   */
  unit?: WeightUnit;
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
  /** Canonical muscles this movement trains directly. Empty means unmapped. */
  primaryMuscles?: MuscleId[];
  /** Muscles meaningfully involved but not the target. Reported separately. */
  secondaryMuscles?: MuscleId[];
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
  /** Supersets and circuits over this day's slots. */
  groups?: ExerciseGroup[];
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

const sideIsComplete = (side: SideEntry | undefined): boolean =>
  side !== undefined &&
  side.weight.trim() !== '' &&
  side.reps.trim() !== '' &&
  Number.isFinite(Number(side.weight)) &&
  Number.isFinite(Number(side.reps));

/**
 * Stricter than `isLoggedSet`: the set is finished, not merely started. Both
 * weight and reps must hold a real number — both sides for a unilateral set —
 * so a half-typed row does not read as done. Drives the rest timer.
 */
export const isCompleteSet = (set: SetEntry, unilateral: boolean): boolean =>
  unilateral
    ? sideIsComplete(set) && sideIsComplete(set.right)
    : sideIsComplete(set);

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

// ---------------------------------------------------------------------------
// Schema v5: dated, independent sessions.
//
// Defined in full here, before any of it is wired up, because a version that
// ships and then grows fields is a version an older build can silently strip
// on restore. Everything v5 will ever hold is declared in this block; a field
// added after release bumps the version instead.
// ---------------------------------------------------------------------------

/**
 * Canonical muscle identity, kept separate from the display labels the routine
 * uses. The seeded program labels things "Length" and "Width", which are
 * useful headings but are not muscles, so they cannot drive workload analytics.
 */
export type MuscleId =
  | 'chest'
  | 'front-delts'
  | 'side-delts'
  | 'rear-delts'
  | 'lats'
  | 'traps'
  | 'upper-back'
  | 'lower-back'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs';

/** What a set was for. Failure is NOT here — see `reachedFailure`. */
export type SetKind = 'working' | 'warmup' | 'drop';

export type ExerciseGroupKind = 'superset' | 'circuit';

/** A superset or circuit, as planned on a routine day or frozen in a session. */
export type ExerciseGroup = {
  groupId: string;
  kind: ExerciseGroupKind;
  /** Member slots, in the order they are performed within a round. */
  slotIds: string[];
  rounds: number;
  restBetweenExercisesSec?: number;
  restBetweenRoundsSec?: number;
};

/** One exercise in a frozen session snapshot. */
export type SnapshotExercise = {
  slotId: string;
  movementId: string;
  name: string;
  group: string;
  unilateral?: boolean;
  loadMode: 'external' | 'bodyweight';
  primaryMuscles: MuscleId[];
  secondaryMuscles: MuscleId[];
};

/**
 * A session's routine as it stood when training began. Frozen so a later
 * template edit cannot rewrite what was performed.
 */
export type SessionSnapshot = {
  label: string;
  name: string;
  exercises: SnapshotExercise[];
  groups: ExerciseGroup[];
};

/**
 * One training session. Independent of the calendar week: several can point at
 * the same routine day, and a session carries its own dates.
 */
export type WorkoutSession = {
  /** Opaque and stable. Never derived from anything that can change. */
  sessionId: string;
  /** Source template, or null for an ad-hoc workout with no routine day. */
  routineDayId: string | null;
  /** Intended local `YYYY-MM-DD`, when known. Rescheduling moves this. */
  scheduledDate?: string;
  /** Actual local `YYYY-MM-DD` it was trained on, when known. */
  performedDate?: string;
  /**
   * The week a migrated session came from, when neither date is known.
   * Migration never invents a date, so this is all the history there is.
   */
  legacyWeekKey?: string;
  status: SessionStatus;
  startedAt?: number;
  finishedAt?: number;
  pausedMs?: number;
  snapshot?: SessionSnapshot;
  /** Logs, still keyed by `slotId`. */
  exercises: Record<string, ExerciseLog>;
  /** One-off swaps for this session, keyed by slotId → movementId. */
  substitutions?: Record<string, string>;
  /** Free text about the session as a whole. */
  note?: string;
  /** Per-slot notes for this session only. */
  slotNotes?: Record<string, string>;
  /** Circuit progress: how many rounds of each group are finished. */
  groupProgress?: Record<string, number>;
};

export type Goal = {
  goalId: string;
  movementId: string;
  targetWeight: number;
  targetReps: number;
  /** The unit the target was set in. Comparison converts; it never assumes. */
  unit: WeightUnit;
  /** Which side a unilateral target applies to; absent means bilateral. */
  side?: 'left' | 'right';
  /** Local date the goal was created. Only later sets can satisfy it. */
  createdAt: string;
  archived?: boolean;
};

/** Durable setup memory for a movement, independent of any one session. */
export type MovementNote = {
  setup: string;
  cues: string;
  updatedAt: string;
};
