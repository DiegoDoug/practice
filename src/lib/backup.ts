import { z } from 'zod';
import { PROGRAM_VERSION } from './program';
import { seededMovements, slugify, UNKNOWN_MOVEMENT_ID } from './movements';
import { seedRoutine, slotIdFor, snapshotDay } from './routine';
import type { RoutineDay, WorkoutState } from './types';

export const CURRENT_SCHEMA_VERSION = 4;

const sideSchema = z.object({
  weight: z.string().catch(''),
  reps: z.string().catch(''),
  rpe: z.string().catch(''),
});

const setEntrySchema = sideSchema.extend({
  // Explicit rather than `.passthrough()`: unknown keys are still dropped, but
  // per-side data is now declared, so it survives a load instead of being
  // silently stripped.
  right: sideSchema.optional(),
});

const weekKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

// --- v2: the original localStorage workout log -----------------------------

const v2ExerciseLogSchema = z.object({ sets: z.array(sideSchema) });

const v2WeekSchema = z.object({
  days: z.record(
    z.string(),
    z.object({ exercises: z.record(z.string(), v2ExerciseLogSchema) }),
  ),
  completion: z.record(z.string(), z.boolean()),
});

const legacyV2Schema = z.object({
  version: z.literal(2),
  weeks: z.record(
    z.string().regex(weekKeyPattern, 'Week keys must be YYYY-MM-DD'),
    v2WeekSchema,
  ),
  exerciseNames: z.record(z.string(), z.string()),
});

// --- v3: index-keyed logs, name overrides in a flat map --------------------

const v3Schema = z.object({
  schemaVersion: z.literal(3),
  exportedAt: z.string().optional(),
  programVersion: z.number().int().nonnegative().optional(),
  unit: z.enum(['lb', 'kg']).optional(),
  weeks: z.record(
    z.string().regex(weekKeyPattern, 'Week keys must be YYYY-MM-DD'),
    v2WeekSchema,
  ),
  exerciseNames: z.record(z.string(), z.string()),
});

type V3Document = z.infer<typeof v3Schema>;

// --- v4: slot-keyed logs, editable routine, movement library ---------------

const movementSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  equipment: z
    .enum(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'other'])
    .catch('other'),
  variations: z.array(z.string()).optional(),
  unilateral: z.boolean().optional(),
  custom: z.boolean().optional(),
});

const routineExerciseSchema = z.object({
  slotId: z.string(),
  movementId: z.string(),
  nameOverride: z.string().optional(),
  groupOverride: z.string().optional(),
  unilateral: z.boolean().optional(),
});

const routineDaySchema = z.object({
  dayId: z.string(),
  label: z.string(),
  name: z.string(),
  warmup: z.array(z.string()),
  exercises: z.array(routineExerciseSchema),
  archived: z.boolean().optional(),
});

const snapshotSchema = z.object({
  label: z.string(),
  name: z.string(),
  exercises: z.array(
    z.object({
      slotId: z.string(),
      movementId: z.string(),
      name: z.string(),
      group: z.string(),
      unilateral: z.boolean().optional(),
    }),
  ),
});

const v4WeekSchema = z.object({
  days: z.record(
    z.string(),
    z.object({
      exercises: z.record(
        z.string(),
        z.object({
          movementId: z.string().catch(UNKNOWN_MOVEMENT_ID),
          unilateral: z.boolean().optional(),
          sets: z.array(setEntrySchema),
        }),
      ),
    }),
  ),
  completion: z.record(z.string(), z.boolean()),
  routine: z.record(z.string(), snapshotSchema).optional(),
  substitutions: z.record(z.string(), z.string()).optional(),
});

const v4Schema = z.object({
  schemaVersion: z.literal(4),
  exportedAt: z.string().optional(),
  programVersion: z.number().int().nonnegative().optional(),
  unit: z.enum(['lb', 'kg']).optional(),
  weeks: z.record(
    z.string().regex(weekKeyPattern, 'Week keys must be YYYY-MM-DD'),
    v4WeekSchema,
  ),
  routine: z.array(routineDaySchema),
  movements: z.record(z.string(), movementSchema),
});

export type BackupFile = z.infer<typeof v4Schema>;

export const emptyState = (): WorkoutState => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  programVersion: PROGRAM_VERSION,
  unit: 'lb',
  weeks: {},
  routine: seedRoutine(),
  movements: seededMovements(),
});

// --- Migration -------------------------------------------------------------

/**
 * Turn a v3 document into a v4 one.
 *
 * Three things have to hold:
 *  - logs move from positional keys to deterministic slot ids, so the same
 *    backup migrates identically on every device;
 *  - name overrides fold into the routine slot, retiring the parallel
 *    `exerciseNames` map;
 *  - every logged (week, day) gets a routine snapshot, or all existing history
 *    would re-label itself the first time the user renames a day.
 */
function upgradeV3ToV4(v3: V3Document): unknown {
  const movements = seededMovements();
  const routine: RoutineDay[] = seedRoutine().map((day) => ({
    ...day,
    exercises: day.exercises.map((slot, index) => {
      const override = v3.exerciseNames[`${day.dayId}:${index}`]?.trim();
      const movementName = movements[slot.movementId]?.name;
      // Keep the slot pointing at the seeded movement so history stays
      // contiguous; the rename becomes a per-slot label.
      return override && override !== movementName
        ? { ...slot, nameOverride: override }
        : slot;
    }),
  }));

  const byDayId = new Map(routine.map((day) => [day.dayId, day]));
  const weeks: Record<string, unknown> = {};

  for (const [weekKey, week] of Object.entries(v3.weeks)) {
    const days: Record<string, unknown> = {};
    const snapshots: Record<string, unknown> = {};

    for (const [dayId, dayLog] of Object.entries(week.days)) {
      let routineDay = byDayId.get(dayId);
      if (!routineDay) {
        // A day the seeded program does not know about: keep it, archived, so
        // its logs stay reachable from History and CSV.
        routineDay = {
          dayId,
          label: dayId,
          name: '',
          warmup: [],
          exercises: [],
          archived: true,
        };
        byDayId.set(dayId, routineDay);
        routine.push(routineDay);
      }

      const exercises: Record<string, unknown> = {};
      for (const [key, log] of Object.entries(dayLog.exercises)) {
        const index = Number(key);
        const slot = Number.isInteger(index)
          ? routineDay.exercises[index]
          : undefined;
        if (slot) {
          exercises[slot.slotId] = {
            movementId: slot.movementId,
            sets: log.sets,
          };
        } else {
          // Never drop logged data. An out-of-range or non-numeric key becomes
          // an orphan slot that History and CSV still surface.
          exercises[`${dayId}-legacy${key}`] = {
            movementId: UNKNOWN_MOVEMENT_ID,
            sets: log.sets,
          };
        }
      }
      days[dayId] = { exercises };

      if (Object.keys(exercises).length > 0) {
        snapshots[dayId] = snapshotDay(movements, routineDay);
      }
    }

    weeks[weekKey] = {
      days,
      completion: week.completion,
      ...(Object.keys(snapshots).length > 0 ? { routine: snapshots } : {}),
    };
  }

  return {
    schemaVersion: 4,
    programVersion: v3.programVersion ?? PROGRAM_VERSION,
    unit: v3.unit ?? 'lb',
    weeks,
    routine,
    movements,
  };
}

/**
 * One-step upgrades keyed by the schema version they upgrade FROM. Each returns
 * a document at version + 1 — never the final state — so the chain composes and
 * a new version cannot accidentally mislabel older data.
 */
const upgrades: Record<number, (input: unknown) => unknown> = {
  2: (input) => {
    const v2 = legacyV2Schema.parse(input);
    return {
      schemaVersion: 3,
      programVersion: PROGRAM_VERSION,
      unit: 'lb',
      weeks: v2.weeks,
      exerciseNames: v2.exerciseNames,
    };
  },
  3: (input) => upgradeV3ToV4(v3Schema.parse(input)),
};

const finalize = (input: unknown): WorkoutState => {
  const parsed = v4Schema.parse(input);
  const movements = { ...seededMovements(), ...parsed.movements };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    programVersion: parsed.programVersion ?? PROGRAM_VERSION,
    unit: parsed.unit ?? 'lb',
    weeks: parsed.weeks,
    routine: parsed.routine.length > 0 ? parsed.routine : seedRoutine(),
    movements,
  };
};

export type ParseResult =
  | { ok: true; state: WorkoutState; migratedFrom: number }
  | { ok: false; error: string };

const detectVersion = (input: unknown): number | null => {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.schemaVersion === 'number') return record.schemaVersion;
  if (typeof record.version === 'number') return record.version;
  return null;
};

/** Turn a Zod failure into one short, human-readable sentence fragment. */
function describe(error: unknown): string {
  if (!(error instanceof z.ZodError)) return 'invalid structure';
  const issue = error.issues[0];
  if (!issue) return 'invalid structure';
  const path = issue.path.join('.');
  return path ? `${issue.message} at "${path}"` : issue.message;
}

/**
 * Validate and migrate an unknown backup payload. Never throws: callers rely on
 * a failed parse leaving existing stored data untouched.
 */
export function parseBackup(input: unknown): ParseResult {
  const detected = detectVersion(input);
  if (detected === null) {
    return {
      ok: false,
      error: 'This file is missing a schema version, so it is not a backup.',
    };
  }
  if (detected > CURRENT_SCHEMA_VERSION || !Number.isInteger(detected)) {
    return {
      ok: false,
      error: `Backup schema version ${detected} is not supported by this app.`,
    };
  }

  try {
    let document = input;
    let version = detected;
    while (version < CURRENT_SCHEMA_VERSION) {
      const upgrade = upgrades[version];
      if (!upgrade) {
        return {
          ok: false,
          error: `Backup schema version ${detected} is not supported by this app.`,
        };
      }
      document = upgrade(document);
      version += 1;
    }
    return { ok: true, state: finalize(document), migratedFrom: detected };
  } catch (error) {
    return {
      ok: false,
      error: `Backup file is not valid: ${describe(error)}.`,
    };
  }
}

export function parseBackupJson(text: string): ParseResult {
  try {
    return parseBackup(JSON.parse(text));
  } catch {
    return { ok: false, error: 'Backup file is not valid JSON.' };
  }
}

export function buildBackup(
  state: WorkoutState,
  exportedAt: Date = new Date(),
): BackupFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    programVersion: state.programVersion,
    unit: state.unit,
    weeks: state.weeks,
    routine: state.routine,
    movements: state.movements,
  };
}

export const backupFilename = (exportedAt: Date = new Date()): string =>
  `weekly-practice-log-backup-${exportedAt.toISOString().slice(0, 10)}.json`;

/** Exported for the migration tests. */
export const __testing = { upgradeV3ToV4, slugify, slotIdFor };
