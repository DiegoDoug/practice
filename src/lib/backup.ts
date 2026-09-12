import { z } from 'zod';
import { PROGRAM_VERSION } from './program';
import type { WorkoutState } from './types';

export const CURRENT_SCHEMA_VERSION = 3;

const setEntrySchema = z.object({
  weight: z.string().catch(''),
  reps: z.string().catch(''),
  rpe: z.string().catch(''),
});

const exerciseLogSchema = z.object({
  sets: z.array(setEntrySchema),
});

const workoutDaySchema = z.object({
  exercises: z.record(z.string(), exerciseLogSchema),
});

const workoutWeekSchema = z.object({
  days: z.record(z.string(), workoutDaySchema),
  completion: z.record(z.string(), z.boolean()),
});

const weekKeyedSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Week keys must be YYYY-MM-DD'),
  workoutWeekSchema,
);

/** Shape written by the original localStorage workout log (`version: 2`). */
const legacyV2Schema = z.object({
  version: z.literal(2),
  weeks: weekKeyedSchema,
  exerciseNames: z.record(z.string(), z.string()),
});

/** Current backup envelope. */
const v3Schema = z.object({
  schemaVersion: z.literal(3),
  exportedAt: z.string().optional(),
  programVersion: z.number().int().nonnegative().optional(),
  unit: z.enum(['lb', 'kg']).optional(),
  weeks: weekKeyedSchema,
  exerciseNames: z.record(z.string(), z.string()),
});

export type BackupFile = z.infer<typeof v3Schema>;

export const emptyState = (): WorkoutState => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  programVersion: PROGRAM_VERSION,
  unit: 'lb',
  weeks: {},
  exerciseNames: {},
});

/** Migrations keyed by the schemaVersion they upgrade FROM. */
export const migrations: Record<number, (input: unknown) => WorkoutState> = {
  2: (input) => {
    const parsed = legacyV2Schema.parse(input);
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      programVersion: PROGRAM_VERSION,
      unit: 'lb',
      weeks: parsed.weeks,
      exerciseNames: parsed.exerciseNames,
    };
  },
  3: (input) => {
    const parsed = v3Schema.parse(input);
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      programVersion: parsed.programVersion ?? PROGRAM_VERSION,
      unit: parsed.unit ?? 'lb',
      weeks: parsed.weeks,
      exerciseNames: parsed.exerciseNames,
    };
  },
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

/**
 * Validate and migrate an unknown backup payload. Never throws: callers rely on
 * a failed parse leaving existing stored data untouched.
 */
/** Turn a Zod failure into one short, human-readable sentence fragment. */
function describe(error: unknown): string {
  if (!(error instanceof z.ZodError)) return 'invalid structure';
  const issue = error.issues[0];
  if (!issue) return 'invalid structure';
  const path = issue.path.join('.');
  return path ? `${issue.message} at "${path}"` : issue.message;
}

export function parseBackup(input: unknown): ParseResult {
  const version = detectVersion(input);
  if (version === null) {
    return {
      ok: false,
      error: 'This file is missing a schema version, so it is not a backup.',
    };
  }
  const migrate = migrations[version];
  if (!migrate) {
    return {
      ok: false,
      error: `Backup schema version ${version} is not supported by this app.`,
    };
  }
  try {
    return { ok: true, state: migrate(input), migratedFrom: version };
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
    exerciseNames: state.exerciseNames,
  };
}

export const backupFilename = (exportedAt: Date = new Date()): string =>
  `weekly-practice-log-backup-${exportedAt.toISOString().slice(0, 10)}.json`;
