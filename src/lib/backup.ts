import { z } from 'zod';
import { PROGRAM_VERSION } from './program';
import { seededMovements, slugify, UNKNOWN_MOVEMENT_ID } from './movements';
import {
  seedRoutine,
  sessionSnapshotOf,
  slotIdFor,
  snapshotDay,
  upgradeSnapshot,
} from './routine';
import { isSetComplete } from './completion';
import { loadModeFor } from './measure';
import { legacySessionId } from './sessions';
import type { RoutineDay, WorkoutState } from './types';

export const CURRENT_SCHEMA_VERSION = 5;

const sideSchema = z.object({
  weight: z.string().catch(''),
  reps: z.string().catch(''),
  rpe: z.string().catch(''),
  assist: z.string().optional(),
});

const setEntrySchema = sideSchema.extend({
  // Explicit rather than `.passthrough()`: unknown keys are still dropped, but
  // per-side data is now declared, so it survives a load instead of being
  // silently stripped.
  right: sideSchema.optional(),
  setId: z.string().optional(),
  done: z.boolean().optional(),
  doneAt: z.number().optional(),
  kind: z.enum(['working', 'warmup', 'drop']).optional(),
  reachedFailure: z.boolean().optional(),
});

const weekKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

const muscleIdSchema = z.enum([
  'chest',
  'front-delts',
  'side-delts',
  'rear-delts',
  'lats',
  'traps',
  'upper-back',
  'lower-back',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
]);

/**
 * One superset or circuit.
 *
 * Every field is checked for what makes it *usable*, not merely present.
 * `.int()` is doing real work on the numbers: it rejects `0`, negatives,
 * fractions, `Infinity` and `NaN` in a single rule, and a group whose rounds
 * are any of those can never render a round count.
 *
 * What CANNOT be decided here is cross-field: whether the slots exist, and
 * whether two groups claim the same one. Both need the owning day, so they live
 * in `refineGroupOwnership` below and are applied wherever groups are owned.
 */
const exerciseGroupSchema = z.object({
  groupId: z.string().min(1, 'A group id cannot be empty'),
  kind: z.enum(['superset', 'circuit']),
  slotIds: z
    .array(z.string().min(1, 'A group slot id cannot be empty'))
    .min(2, 'A group needs at least two exercises'),
  rounds: z.number().int().positive(),
  restBetweenExercisesSec: z.number().int().nonnegative().optional(),
  restBetweenRoundsSec: z.number().int().nonnegative().optional(),
});

type ParsedGroup = z.infer<typeof exerciseGroupSchema>;

/**
 * The cross-field group rules, in ONE place.
 *
 * A group is only meaningful relative to the day or snapshot that owns it, so
 * these four checks are applied by every owner — routine days and frozen
 * session snapshots alike — rather than being restated at each site where they
 * would drift apart.
 */
function refineGroupOwnership(
  groups: ParsedGroup[] | undefined,
  slotIdsInOwner: readonly string[],
  ctx: z.RefinementCtx,
  at: string,
): void {
  if (!groups || groups.length === 0) return;
  const known = new Set(slotIdsInOwner);
  const seenIds = new Set<string>();
  const claimed = new Map<string, string>();

  groups.forEach((group, index) => {
    const path = [at, index] as const;
    if (seenIds.has(group.groupId)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'groupId'],
        message: `Duplicate group id "${group.groupId}"`,
      });
    }
    seenIds.add(group.groupId);

    const distinct = new Set(group.slotIds);
    if (distinct.size !== group.slotIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'slotIds'],
        message: `Group "${group.groupId}" lists the same exercise twice`,
      });
    }
    if (distinct.size < 2) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'slotIds'],
        message: `Group "${group.groupId}" needs at least two distinct exercises`,
      });
    }

    for (const slotId of distinct) {
      if (!known.has(slotId)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'slotIds'],
          message: `Group "${group.groupId}" references missing exercise "${slotId}"`,
        });
        continue;
      }
      const owner = claimed.get(slotId);
      if (owner !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'slotIds'],
          message: `Exercise "${slotId}" is in both "${owner}" and "${group.groupId}"`,
        });
        continue;
      }
      claimed.set(slotId, group.groupId);
    }
  });
}

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
  primaryMuscles: z.array(muscleIdSchema).optional(),
  secondaryMuscles: z.array(muscleIdSchema).optional(),
});

const routineExerciseSchema = z.object({
  slotId: z.string(),
  movementId: z.string(),
  nameOverride: z.string().optional(),
  groupOverride: z.string().optional(),
  unilateral: z.boolean().optional(),
});

const routineDaySchema = z
  .object({
    dayId: z.string(),
    label: z.string(),
    name: z.string(),
    warmup: z.array(z.string()),
    exercises: z.array(routineExerciseSchema),
    archived: z.boolean().optional(),
    groups: z.array(exerciseGroupSchema).optional(),
  })
  .superRefine((day, ctx) => {
    refineGroupOwnership(
      day.groups,
      day.exercises.map((slot) => slot.slotId),
      ctx,
      'groups',
    );
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

// --- v5: dated, independent sessions ---------------------------------------

const snapshotExerciseSchema = z.object({
  slotId: z.string(),
  movementId: z.string(),
  name: z.string(),
  group: z.string(),
  unilateral: z.boolean().optional(),
  loadMode: z.enum(['external', 'bodyweight']).catch('external'),
  primaryMuscles: z.array(muscleIdSchema).catch([]),
  secondaryMuscles: z.array(muscleIdSchema).catch([]),
});

/**
 * `groups` is `.default([])`, not `.catch([])`.
 *
 * A v5 document written before groups existed simply has no `groups` key, and
 * that is a missing field with an obvious answer. A `groups` key holding a
 * malformed group is something else entirely — swallowing it would drop a
 * superset out of a frozen workout without a word, which is exactly the silent
 * data loss strict validation is for.
 */
const sessionSnapshotSchema = z.object({
  label: z.string(),
  name: z.string(),
  exercises: z.array(snapshotExerciseSchema),
  groups: z.array(exerciseGroupSchema).default([]),
});

const exerciseLogSchema = z.object({
  movementId: z.string().catch(UNKNOWN_MOVEMENT_ID),
  unilateral: z.boolean().optional(),
  unit: z.enum(['lb', 'kg']).optional(),
  sets: z.array(setEntrySchema),
});

const sessionSchema = z
  .object({
    sessionId: z.string(),
    routineDayId: z.string().nullable(),
    scheduledDate: z.string().regex(weekKeyPattern).optional(),
    performedDate: z.string().regex(weekKeyPattern).optional(),
    legacyWeekKey: z.string().regex(weekKeyPattern).optional(),
    status: z.enum(['scheduled', 'in_progress', 'completed', 'skipped']),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    pausedMs: z.number().optional(),
    snapshot: sessionSnapshotSchema.optional(),
    exercises: z.record(z.string(), exerciseLogSchema),
    substitutions: z.record(z.string(), z.string()).optional(),
    note: z.string().optional(),
    slotNotes: z.record(z.string(), z.string()).optional(),
    groupProgress: z
      .record(z.string(), z.number().int().nonnegative())
      .optional(),
  })
  .superRefine((session, ctx) => {
    const snapshot = session.snapshot;
    refineGroupOwnership(
      snapshot?.groups,
      snapshot?.exercises.map((slot) => slot.slotId) ?? [],
      ctx,
      'snapshot.groups',
    );

    // This build derives round progress from the logs and never writes this
    // field (see docs/data-contract.md). It is still validated rather than
    // ignored: a document carrying progress for a group that does not exist, or
    // for more rounds than the session could possibly hold, is describing a
    // workout that never happened, and restoring it would show the athlete a
    // round count their own sets contradict.
    for (const [groupId, rounds] of Object.entries(
      session.groupProgress ?? {},
    )) {
      const group = snapshot?.groups.find((entry) => entry.groupId === groupId);
      if (!group) {
        ctx.addIssue({
          code: 'custom',
          path: ['groupProgress', groupId],
          message: `Progress recorded for unknown group "${groupId}"`,
        });
        continue;
      }
      const logged = group.slotIds.reduce(
        (most, slotId) =>
          Math.max(most, session.exercises[slotId]?.sets.length ?? 0),
        0,
      );
      const possible = Math.max(group.rounds, logged);
      if (rounds > possible) {
        ctx.addIssue({
          code: 'custom',
          path: ['groupProgress', groupId],
          message: `Group "${groupId}" claims ${rounds} rounds but only ${possible} are possible`,
        });
      }
    }
  });

/** A local calendar day, `YYYY-MM-DD`, as `week.ts` writes them. */
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * A goal is validated strictly, and a bad one fails the whole file.
 *
 * Dropping it quietly would be worse: the athlete would believe the goal had
 * been restored. The values are the ones evaluation depends on — a negative
 * target, a fractional rep count or a creation date that is not a date would
 * each produce a goal that can never read correctly.
 */
const goalSchema = z.object({
  goalId: z.string().min(1),
  movementId: z.string().min(1),
  targetWeight: z.number().finite().nonnegative(),
  targetReps: z.number().int().positive(),
  unit: z.enum(['lb', 'kg']),
  mode: z.enum(['external', 'bodyweight']).optional(),
  side: z.enum(['left', 'right']).optional(),
  createdAt: dateKeySchema,
  archived: z.boolean().optional(),
});

const movementNoteSchema = z.object({
  setup: z.string().catch(''),
  cues: z.string().catch(''),
  updatedAt: z.string(),
});

const v5Schema = z.object({
  schemaVersion: z.literal(5),
  exportedAt: z.string().optional(),
  programVersion: z.number().int().nonnegative().optional(),
  unit: z.enum(['lb', 'kg']).optional(),
  sessions: z.record(z.string(), sessionSchema),
  routine: z.array(routineDaySchema),
  movements: z.record(z.string(), movementSchema),
  goals: z.record(z.string(), goalSchema).optional(),
  targets: z.partialRecord(muscleIdSchema, z.number().nonnegative()).optional(),
  setupNotes: z.record(z.string(), movementNoteSchema).optional(),
  unresolvedSubstitutions: z.record(z.string(), z.string()).optional(),
});

export type BackupFile = z.infer<typeof v5Schema>;

type V4Document = z.infer<typeof v4Schema>;

export const emptyState = (): WorkoutState => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  programVersion: PROGRAM_VERSION,
  unit: 'lb',
  sessions: {},
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
 * Turn a v4 document into a v5 one.
 *
 * The delicate parts, each of which loses data if done casually:
 *
 *  - Session candidates come from the DAY-keyed collections only: `days`,
 *    `completion` and `routine`. A day marked complete with nothing logged is
 *    a real session and must survive.
 *  - `substitutions` is keyed by SLOT id, unlike every collection beside it.
 *    Treating those keys as days would mint phantom sessions, so each entry is
 *    resolved to the day that owns its slot — via the week's frozen snapshot
 *    first, then the template — and anything unownable is preserved under
 *    `unresolvedSubstitutions` rather than dropped.
 *  - No date is invented. Routine order does not prove when a workout
 *    happened, so both dates stay unset and `legacyWeekKey` records the week.
 *  - Sets are classified with the same completion rule the app now uses, given
 *    deterministic ids, and left WITHOUT `doneAt`: the time this migration ran
 *    is not the time the set was performed.
 */
function upgradeV4ToV5(v4: V4Document): unknown {
  const movements = { ...seededMovements(), ...v4.movements };
  const unit = v4.unit ?? 'lb';
  const byDayId = new Map(v4.routine.map((day) => [day.dayId, day]));
  const sessions: Record<string, unknown> = {};
  const unresolvedSubstitutions: Record<string, string> = {};

  for (const [weekKey, week] of Object.entries(v4.weeks)) {
    // The union of the day-keyed collections. `substitutions` is deliberately
    // absent: its keys are slots, not days.
    const dayIds = new Set([
      ...Object.keys(week.days),
      ...Object.keys(week.completion),
      ...Object.keys(week.routine ?? {}),
    ]);

    /** Which day owns a slot: the week's snapshot first, then the template. */
    const ownerOf = (slotId: string): string | null => {
      for (const [dayId, snapshot] of Object.entries(week.routine ?? {})) {
        if (snapshot.exercises.some((entry) => entry.slotId === slotId)) {
          return dayId;
        }
      }
      for (const day of v4.routine) {
        if (day.exercises.some((entry) => entry.slotId === slotId)) {
          return day.dayId;
        }
      }
      return null;
    };

    const substitutionsByDay = new Map<string, Record<string, string>>();
    for (const [slotId, movementId] of Object.entries(
      week.substitutions ?? {},
    )) {
      const owner = ownerOf(slotId);
      if (owner === null || !dayIds.has(owner)) {
        unresolvedSubstitutions[`${weekKey}:${slotId}`] = movementId;
        continue;
      }
      const existing = substitutionsByDay.get(owner) ?? {};
      existing[slotId] = movementId;
      substitutionsByDay.set(owner, existing);
    }

    for (const dayId of dayIds) {
      const sessionId = legacySessionId(weekKey, dayId);
      const logs = week.days[dayId]?.exercises ?? {};
      const snapshot = week.routine?.[dayId];
      const templateDay = byDayId.get(dayId);

      const exercises: Record<string, unknown> = {};
      for (const [slotId, log] of Object.entries(logs)) {
        const movement = movements[log.movementId];
        const unilateral = Boolean(log.unilateral);
        const mode = {
          loadMode: loadModeFor(movement?.equipment ?? 'other'),
          unilateral,
        };
        exercises[slotId] = {
          ...log,
          unit,
          sets: log.sets.map((set, index) => ({
            ...set,
            setId: `${sessionId}:${slotId}:${index}`,
            // Complete when the row carries what its mode requires. No
            // `doneAt`: that timestamp is genuinely unknown.
            ...(isSetComplete(set, mode) ? { done: true } : {}),
          })),
        };
      }

      const substitutions = substitutionsByDay.get(dayId);
      sessions[sessionId] = {
        sessionId,
        routineDayId: dayId,
        legacyWeekKey: weekKey,
        status: week.completion[dayId] ? 'completed' : 'scheduled',
        exercises,
        ...(snapshot
          ? { snapshot: upgradeSnapshot(movements, snapshot) }
          : templateDay
            ? { snapshot: sessionSnapshotOf(movements, templateDay) }
            : {}),
        ...(substitutions ? { substitutions } : {}),
      };
    }
  }

  return {
    schemaVersion: 5,
    programVersion: v4.programVersion ?? PROGRAM_VERSION,
    unit,
    sessions,
    routine: v4.routine,
    movements: v4.movements,
    ...(Object.keys(unresolvedSubstitutions).length > 0
      ? { unresolvedSubstitutions }
      : {}),
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
  4: (input) => upgradeV4ToV5(v4Schema.parse(input)),
};

const finalize = (input: unknown): WorkoutState => {
  const parsed = v5Schema.parse(input);
  const movements = { ...seededMovements(), ...parsed.movements };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    programVersion: parsed.programVersion ?? PROGRAM_VERSION,
    unit: parsed.unit ?? 'lb',
    sessions: parsed.sessions,
    routine: parsed.routine.length > 0 ? parsed.routine : seedRoutine(),
    movements,
    ...(parsed.goals ? { goals: parsed.goals } : {}),
    ...(parsed.targets ? { targets: parsed.targets } : {}),
    ...(parsed.setupNotes ? { setupNotes: parsed.setupNotes } : {}),
    ...(parsed.unresolvedSubstitutions
      ? { unresolvedSubstitutions: parsed.unresolvedSubstitutions }
      : {}),
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
    sessions: state.sessions,
    routine: state.routine,
    movements: state.movements,
    ...(state.goals ? { goals: state.goals } : {}),
    ...(state.targets ? { targets: state.targets } : {}),
    ...(state.setupNotes ? { setupNotes: state.setupNotes } : {}),
    ...(state.unresolvedSubstitutions
      ? { unresolvedSubstitutions: state.unresolvedSubstitutions }
      : {}),
  };
}

export const backupFilename = (exportedAt: Date = new Date()): string =>
  `weekly-practice-log-backup-${exportedAt.toISOString().slice(0, 10)}.json`;

/** Exported for the migration tests. */
export const __testing = { upgradeV3ToV4, upgradeV4ToV5, slugify, slotIdFor };
