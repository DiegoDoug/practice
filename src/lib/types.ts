/** Core domain types for Weekly Practice Log. */

/** A single logged set. Values stay strings at the draft layer so partial
 *  input ("13", "1.") is never destroyed by eager numeric coercion. */
export type SetEntry = {
  weight: string;
  reps: string;
  rpe: string;
};

export type ExerciseLog = {
  sets: SetEntry[];
};

export type WorkoutDayLog = {
  /** Keyed by exercise index within the planned day. */
  exercises: Record<string, ExerciseLog>;
};

export type WorkoutWeek = {
  days: Record<string, WorkoutDayLog>;
  completion: Record<string, boolean>;
};

export type WeightUnit = 'lb' | 'kg';

/** Persisted application state. `weeks` is keyed by local-Monday `YYYY-MM-DD`. */
export type WorkoutState = {
  schemaVersion: 3;
  programVersion: number;
  unit: WeightUnit;
  weeks: Record<string, WorkoutWeek>;
  /** Template display-name overrides, keyed `${dayId}:${exerciseIndex}`. */
  exerciseNames: Record<string, string>;
};

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

export const blankSet = (): SetEntry => ({ weight: '', reps: '', rpe: '' });

/** A row counts as logged when it carries weight or reps. RPE alone does not. */
export const isLoggedSet = (set: SetEntry): boolean =>
  set.weight.trim() !== '' || set.reps.trim() !== '';

/** Looser test used for history/CSV inclusion, matching the source behaviour. */
export const hasAnyValue = (set: SetEntry): boolean =>
  isLoggedSet(set) || set.rpe.trim() !== '';
