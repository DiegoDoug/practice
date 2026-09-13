import { PROGRAM } from './program';
import { UNKNOWN_MOVEMENT_ID, seededMovements, slugify } from './movements';
import { loadModeFor } from './measure';
import type {
  Movement,
  RoutineDay,
  RoutineDaySnapshot,
  RoutineExercise,
  SessionSnapshot,
  SnapshotExercise,
  WorkoutSession,
  WorkoutState,
} from './types';

export const slotIdFor = (dayId: string, index: number): string =>
  `${dayId}-s${index}`;

/** Mint a slot id that cannot collide with any slot already in the routine. */
export function newSlotId(routine: RoutineDay[], dayId: string): string {
  const taken = new Set(
    routine.flatMap((day) => day.exercises.map((exercise) => exercise.slotId)),
  );
  let n = routine.find((day) => day.dayId === dayId)?.exercises.length ?? 0;
  let candidate = slotIdFor(dayId, n);
  while (taken.has(candidate)) {
    n += 1;
    candidate = slotIdFor(dayId, n);
  }
  return candidate;
}

/** Mint a day id that cannot collide with an existing one. */
export function newDayId(routine: RoutineDay[]): string {
  const taken = new Set(routine.map((day) => day.dayId));
  let n = routine.length + 1;
  while (taken.has(`day${n}`)) n += 1;
  return `day${n}`;
}

/**
 * Build the starting routine from the seeded program.
 *
 * Slots deliberately do NOT inherit the movement's `unilateral` flag here:
 * seeding it would silently switch existing users' Legs days to two-sided
 * entry. Unilateral mode is opt-in per slot.
 */
export function seedRoutine(): RoutineDay[] {
  const movements = seededMovements();
  return PROGRAM.map((day) => ({
    dayId: day.id,
    label: day.label,
    name: day.name,
    warmup: [...day.warmup],
    exercises: day.exercises.map((exercise, index) => {
      const movementId = slugify(exercise.name);
      const movement = movements[movementId];
      const slot: RoutineExercise = {
        slotId: slotIdFor(day.id, index),
        movementId,
      };
      // The seeded program labels the same movement differently per day, so
      // keep the program's label whenever it differs from the library default.
      if (movement && movement.group !== exercise.group) {
        slot.groupOverride = exercise.group;
      }
      return slot;
    }),
  }));
}

export const findDay = (
  routine: RoutineDay[],
  dayId: string,
): RoutineDay | undefined => routine.find((day) => day.dayId === dayId);

export const findSlot = (
  day: RoutineDay | undefined,
  slotId: string,
): RoutineExercise | undefined =>
  day?.exercises.find((exercise) => exercise.slotId === slotId);

/** Days still in the plan, in order. Archived days are excluded. */
export const activeDays = (state: WorkoutState): RoutineDay[] =>
  state.routine.filter((day) => !day.archived);

export function resolveSlotName(
  movements: Record<string, Movement>,
  slot: RoutineExercise,
): string {
  const override = slot.nameOverride?.trim();
  if (override) return override;
  return movements[slot.movementId]?.name ?? 'Unknown exercise';
}

export function resolveSlotGroup(
  movements: Record<string, Movement>,
  slot: RoutineExercise,
): string {
  const override = slot.groupOverride?.trim();
  if (override) return override;
  return movements[slot.movementId]?.group ?? '';
}

/**
 * Unilateral mode is per slot, not per movement — see seedRoutine. A slot
 * without the flag is bilateral even when its movement is marked unilateral.
 */
export const isSlotUnilateral = (slot: RoutineExercise): boolean =>
  slot.unilateral ?? false;

/**
 * Build a snapshot of a routine day as it stands right now, with any
 * this-week substitutions applied. A substituted slot reports the substitute's
 * own name and group, and drops the slot's name override, which described the
 * movement being replaced.
 */
export function snapshotDay(
  movements: Record<string, Movement>,
  day: RoutineDay,
  substitutions: Record<string, string> = {},
): RoutineDaySnapshot {
  return {
    label: day.label,
    name: day.name,
    exercises: day.exercises.map((slot) => {
      const substituteId = substitutions[slot.slotId];
      const substitute = substituteId ? movements[substituteId] : undefined;
      if (substitute) {
        return {
          slotId: slot.slotId,
          movementId: substitute.id,
          name: substitute.name,
          group: substitute.group,
          ...(substitute.unilateral ? { unilateral: true } : {}),
        };
      }
      return {
        slotId: slot.slotId,
        movementId: slot.movementId,
        name: resolveSlotName(movements, slot),
        group: resolveSlotGroup(movements, slot),
        ...(isSlotUnilateral(slot) ? { unilateral: true } : {}),
      };
    }),
  };
}

/**
 * Enrich a slot with the facts analytics needs frozen: how its load is
 * recorded, and which muscles it trains. Both are read from the library at
 * freeze time, so a later library edit cannot rewrite historical workload.
 */
const snapshotExercise = (
  movements: Record<string, Movement>,
  entry: {
    slotId: string;
    movementId: string;
    name: string;
    group: string;
    unilateral?: boolean;
  },
): SnapshotExercise => {
  const movement = movements[entry.movementId];
  return {
    ...entry,
    loadMode: loadModeFor(movement?.equipment ?? 'other'),
    primaryMuscles: movement?.primaryMuscles ?? [],
    secondaryMuscles: movement?.secondaryMuscles ?? [],
  };
};

/** Freeze a routine day as a session snapshot, with any swaps applied. */
export function sessionSnapshotOf(
  movements: Record<string, Movement>,
  day: RoutineDay,
  substitutions: Record<string, string> = {},
): SessionSnapshot {
  const base = snapshotDay(movements, day, substitutions);
  return {
    label: base.label,
    name: base.name,
    exercises: base.exercises.map((entry) =>
      snapshotExercise(movements, entry),
    ),
    groups: (day.groups ?? []).map((group) => ({ ...group })),
  };
}

/**
 * Widen a v4 snapshot into a session snapshot. The stored names and groups are
 * kept exactly as they were logged; only the new fields are filled in.
 */
export function upgradeSnapshot(
  movements: Record<string, Movement>,
  snapshot: RoutineDaySnapshot,
): SessionSnapshot {
  return {
    label: snapshot.label,
    name: snapshot.name,
    exercises: snapshot.exercises.map((entry) =>
      snapshotExercise(movements, entry),
    ),
    groups: [],
  };
}

const writeSessionSnapshot = (
  state: WorkoutState,
  sessionId: string,
  snapshot: SessionSnapshot,
): WorkoutState => {
  const session = state.sessions[sessionId];
  if (!session) return state;
  return {
    ...state,
    sessions: { ...state.sessions, [sessionId]: { ...session, snapshot } },
  };
};

/**
 * Freeze a session's routine the first time it is written to.
 *
 * Called from inside the write paths rather than at their call sites, so no
 * write can forget it. Once frozen, only `refreshOpenSnapshots` may change it,
 * and only while the session has not been completed.
 */
export function ensureSessionSnapshot(
  state: WorkoutState,
  sessionId: string,
): WorkoutState {
  const session = state.sessions[sessionId];
  if (!session || session.snapshot) return state;
  const day = session.routineDayId
    ? findDay(state.routine, session.routineDayId)
    : undefined;
  if (!day) return state;
  return writeSessionSnapshot(
    state,
    sessionId,
    sessionSnapshotOf(state.movements, day, session.substitutions),
  );
}

/**
 * Re-freeze open sessions after a routine edit.
 *
 * Only sessions that are not completed are updated — editing the plan must
 * never rewrite what a finished session says it was. A session with no routine
 * day has nothing to re-freeze from.
 */
export function refreshOpenSnapshots(
  state: WorkoutState,
  sessionIds: string[],
): WorkoutState {
  let next = state;
  for (const sessionId of sessionIds) {
    const session = next.sessions[sessionId];
    if (!session || session.status === 'completed') continue;
    if (!session.snapshot || !session.routineDayId) continue;
    const day = findDay(next.routine, session.routineDayId);
    if (!day) continue;
    next = writeSessionSnapshot(
      next,
      sessionId,
      sessionSnapshotOf(next.movements, day, session.substitutions),
    );
  }
  return next;
}

const emptySnapshot = (label: string): SessionSnapshot => ({
  label,
  name: '',
  exercises: [],
  groups: [],
});

/**
 * The routine to render a session with: its frozen snapshot when it has one,
 * otherwise the current routine day. Every consumer — the day screen, History,
 * CSV, the progress count — reads through this.
 */
export function resolveSessionRoutine(
  state: WorkoutState,
  session: WorkoutSession | null | undefined,
): SessionSnapshot {
  if (!session) return emptySnapshot('');
  if (session.snapshot) return session.snapshot;
  const day = session.routineDayId
    ? findDay(state.routine, session.routineDayId)
    : undefined;
  if (day) {
    return sessionSnapshotOf(state.movements, day, session.substitutions);
  }
  return emptySnapshot(session.routineDayId ?? '');
}

/** True when any session holds logged data for this slot. */
export function slotHasHistory(state: WorkoutState, slotId: string): boolean {
  return Object.values(state.sessions).some((session) =>
    Boolean(session.exercises[slotId]?.sets?.length),
  );
}

/** True when any session holds logged data for any slot in this day. */
export function dayHasHistory(state: WorkoutState, dayId: string): boolean {
  return Object.values(state.sessions).some(
    (session) =>
      session.routineDayId === dayId &&
      Object.keys(session.exercises).length > 0,
  );
}

// --- Routine edits -------------------------------------------------------
// Every one of these returns a new state and never mutates its input.

const mapDay = (
  state: WorkoutState,
  dayId: string,
  fn: (day: RoutineDay) => RoutineDay,
): WorkoutState => ({
  ...state,
  routine: state.routine.map((day) => (day.dayId === dayId ? fn(day) : day)),
});

export const renameDay = (
  state: WorkoutState,
  dayId: string,
  patch: { label?: string; name?: string },
): WorkoutState =>
  mapDay(state, dayId, (day) => ({
    ...day,
    label: patch.label?.trim() || day.label,
    name: patch.name?.trim() ?? day.name,
  }));

export function addDay(state: WorkoutState, name = 'New day'): WorkoutState {
  const dayId = newDayId(state.routine);
  const day: RoutineDay = {
    dayId,
    label: `Day ${state.routine.filter((d) => !d.archived).length + 1}`,
    name,
    warmup: [],
    exercises: [],
  };
  return { ...state, routine: [...state.routine, day] };
}

/** Duplicate a day, minting fresh slot ids so the copy has its own history. */
export function duplicateDay(state: WorkoutState, dayId: string): WorkoutState {
  const source = findDay(state.routine, dayId);
  if (!source) return state;
  const newId = newDayId(state.routine);
  const copy: RoutineDay = {
    ...source,
    dayId: newId,
    label: `Day ${state.routine.filter((d) => !d.archived).length + 1}`,
    name: `${source.name} copy`,
    warmup: [...source.warmup],
    exercises: source.exercises.map((slot, index) => ({
      ...slot,
      slotId: slotIdFor(newId, index),
    })),
  };
  const at = state.routine.findIndex((day) => day.dayId === dayId);
  const routine = [...state.routine];
  routine.splice(at + 1, 0, copy);
  return { ...state, routine };
}

/**
 * Remove a day from the plan. Days with logged history are archived rather
 * than deleted, so History and CSV keep showing what was done.
 */
export function removeDay(state: WorkoutState, dayId: string): WorkoutState {
  if (dayHasHistory(state, dayId)) {
    return mapDay(state, dayId, (day) => ({ ...day, archived: true }));
  }
  return {
    ...state,
    routine: state.routine.filter((day) => day.dayId !== dayId),
  };
}

export function restoreDay(state: WorkoutState, dayId: string): WorkoutState {
  return mapDay(state, dayId, ({ archived: _archived, ...day }) => day);
}

const move = <T>(items: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || from >= items.length) return items;
  const bounded = Math.max(0, Math.min(items.length - 1, to));
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(bounded, 0, moved);
  return next;
};

export function moveDay(
  state: WorkoutState,
  dayId: string,
  to: number,
): WorkoutState {
  const from = state.routine.findIndex((day) => day.dayId === dayId);
  if (from === -1) return state;
  return { ...state, routine: move(state.routine, from, to) };
}

export function addExercise(
  state: WorkoutState,
  dayId: string,
  movementId: string,
): WorkoutState {
  const slotId = newSlotId(state.routine, dayId);
  const movement = state.movements[movementId];
  const slot: RoutineExercise = {
    slotId,
    movementId,
    ...(movement?.unilateral ? { unilateral: true } : {}),
  };
  return mapDay(state, dayId, (day) => ({
    ...day,
    exercises: [...day.exercises, slot],
  }));
}

export function duplicateExercise(
  state: WorkoutState,
  dayId: string,
  slotId: string,
): WorkoutState {
  const day = findDay(state.routine, dayId);
  const source = findSlot(day, slotId);
  if (!day || !source) return state;
  const copy: RoutineExercise = {
    ...source,
    slotId: newSlotId(state.routine, dayId),
  };
  const at = day.exercises.findIndex((slot) => slot.slotId === slotId);
  const exercises = [...day.exercises];
  exercises.splice(at + 1, 0, copy);
  return mapDay(state, dayId, (d) => ({ ...d, exercises }));
}

/**
 * Remove an exercise from a day. Slots with logged history are dropped from
 * the plan but their logs are kept and still surface in History and CSV.
 */
export function removeExercise(
  state: WorkoutState,
  dayId: string,
  slotId: string,
): WorkoutState {
  return mapDay(state, dayId, (day) => ({
    ...day,
    exercises: day.exercises.filter((slot) => slot.slotId !== slotId),
  }));
}

export function moveExercise(
  state: WorkoutState,
  dayId: string,
  slotId: string,
  to: number,
): WorkoutState {
  const day = findDay(state.routine, dayId);
  if (!day) return state;
  const from = day.exercises.findIndex((slot) => slot.slotId === slotId);
  if (from === -1) return state;
  return mapDay(state, dayId, (d) => ({
    ...d,
    exercises: move(d.exercises, from, to),
  }));
}

const mapSlot = (
  state: WorkoutState,
  dayId: string,
  slotId: string,
  fn: (slot: RoutineExercise) => RoutineExercise,
): WorkoutState =>
  mapDay(state, dayId, (day) => ({
    ...day,
    exercises: day.exercises.map((slot) =>
      slot.slotId === slotId ? fn(slot) : slot,
    ),
  }));

/** Rename a slot. Clearing it, or matching the movement name, drops the
 *  override rather than storing a redundant copy. */
export function renameSlot(
  state: WorkoutState,
  dayId: string,
  slotId: string,
  name: string,
): WorkoutState {
  return mapSlot(state, dayId, slotId, (slot) => {
    const trimmed = name.trim();
    const movementName = state.movements[slot.movementId]?.name ?? '';
    if (trimmed === '' || trimmed === movementName) {
      const { nameOverride: _drop, ...rest } = slot;
      return rest;
    }
    return { ...slot, nameOverride: trimmed };
  });
}

/**
 * Point a slot at a different movement, permanently. A name override is
 * dropped, since it described the movement being replaced.
 */
export function substituteSlot(
  state: WorkoutState,
  dayId: string,
  slotId: string,
  movementId: string,
): WorkoutState {
  return mapSlot(state, dayId, slotId, (slot) => {
    const { nameOverride: _drop, groupOverride: _dropGroup, ...rest } = slot;
    const movement = state.movements[movementId];
    return {
      ...rest,
      movementId,
      ...(movement?.unilateral ? { unilateral: true } : {}),
    };
  });
}

export function setSlotUnilateral(
  state: WorkoutState,
  dayId: string,
  slotId: string,
  unilateral: boolean,
): WorkoutState {
  return mapSlot(state, dayId, slotId, (slot) => {
    if (!unilateral) {
      const { unilateral: _drop, ...rest } = slot;
      return rest;
    }
    return { ...slot, unilateral: true };
  });
}

/** Add a user-created movement, minting a collision-free id. */
export function addCustomMovement(
  state: WorkoutState,
  movement: Omit<Movement, 'id' | 'custom'>,
): { state: WorkoutState; id: string } {
  const id = mintCustomId(state.movements, movement.name);
  return {
    state: {
      ...state,
      movements: {
        ...state.movements,
        [id]: { ...movement, id, custom: true },
      },
    },
    id,
  };
}

function mintCustomId(
  movements: Record<string, Movement>,
  name: string,
): string {
  const base = slugify(name);
  if (!movements[base] && base !== UNKNOWN_MOVEMENT_ID) return base;
  let suffix = 2;
  while (movements[`${base}-${suffix}`]) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * Choose the day to open with: today's slot by position when the routine is
 * long enough and not already complete, otherwise the first incomplete day,
 * otherwise the first day. Returns null for an empty routine.
 */
export function pickInitialDay(
  state: WorkoutState,
  completion: Record<string, boolean>,
  today: Date = new Date(),
): string | null {
  const days = activeDays(state);
  if (days.length === 0) return null;

  const weekday = today.getDay(); // 0 Sun … 6 Sat
  if (weekday >= 1) {
    const scheduled = days[weekday - 1];
    if (scheduled && !completion[scheduled.dayId]) return scheduled.dayId;
  }
  const firstIncomplete = days.find((day) => !completion[day.dayId]);
  return (firstIncomplete ?? days[0]).dayId;
}

// --- Substitution --------------------------------------------------------

/** The movement a slot is actually being performed as in a given session. */
export function effectiveMovementId(
  state: WorkoutState,
  session: WorkoutSession | null | undefined,
  slotId: string,
): string {
  const resolved = resolveSessionRoutine(state, session).exercises.find(
    (slot) => slot.slotId === slotId,
  );
  if (resolved) return resolved.movementId;
  const dayId = session?.routineDayId ?? '';
  return findSlot(findDay(state.routine, dayId), slotId)?.movementId ?? '';
}

/** True when a session already holds entered values for a slot. */
export function slotHasSetsInSession(
  state: WorkoutState,
  sessionId: string,
  slotId: string,
): boolean {
  const sets = state.sessions[sessionId]?.exercises[slotId]?.sets ?? [];
  const sideHasText = (side: { weight: string; reps: string; rpe: string }) =>
    side.weight.trim() !== '' ||
    side.reps.trim() !== '' ||
    side.rpe.trim() !== '';
  return sets.some(
    (set) => sideHasText(set) || Boolean(set.right && sideHasText(set.right)),
  );
}

const patchSession = (
  state: WorkoutState,
  sessionId: string,
  fn: (session: WorkoutSession) => WorkoutSession,
): WorkoutState => {
  const session = state.sessions[sessionId];
  if (!session) return state;
  return {
    ...state,
    sessions: { ...state.sessions, [sessionId]: fn(session) },
  };
};

/**
 * Swap a slot's movement for one session only, leaving the routine alone.
 *
 * The swap is recorded on the session rather than baked straight into its
 * snapshot, so a later routine edit — which re-freezes open snapshots — cannot
 * quietly undo it. Log rows for the slot are cleared, because they belong to
 * the movement being replaced; callers confirm first.
 */
export function substituteForSession(
  state: WorkoutState,
  sessionId: string,
  slotId: string,
  movementId: string,
): WorkoutState {
  const swapped = patchSession(state, sessionId, (session) => {
    const exercises = { ...session.exercises };
    delete exercises[slotId];
    return {
      ...session,
      exercises,
      substitutions: { ...(session.substitutions ?? {}), [slotId]: movementId },
    };
  });

  const session = swapped.sessions[sessionId];
  const day = session?.routineDayId
    ? findDay(swapped.routine, session.routineDayId)
    : undefined;
  if (!session || !day) return swapped;
  return writeSessionSnapshot(
    swapped,
    sessionId,
    sessionSnapshotOf(swapped.movements, day, session.substitutions),
  );
}

/** Drop a session swap, returning the slot to what the routine plans. */
export function clearSessionSubstitution(
  state: WorkoutState,
  sessionId: string,
  slotId: string,
): WorkoutState {
  if (!state.sessions[sessionId]?.substitutions?.[slotId]) return state;

  const cleared = patchSession(state, sessionId, (session) => {
    const substitutions = { ...session.substitutions };
    delete substitutions[slotId];
    return { ...session, substitutions };
  });

  const session = cleared.sessions[sessionId];
  const day = session?.routineDayId
    ? findDay(cleared.routine, session.routineDayId)
    : undefined;
  if (!session || !day) return cleared;
  return writeSessionSnapshot(
    cleared,
    sessionId,
    sessionSnapshotOf(cleared.movements, day, session.substitutions),
  );
}

/**
 * Make a swap permanent: point the routine slot at the new movement and drop
 * the session-scoped override so the two cannot disagree.
 */
export function substitutePermanently(
  state: WorkoutState,
  sessionId: string,
  slotId: string,
  movementId: string,
): WorkoutState {
  const dayId = state.sessions[sessionId]?.routineDayId;
  const swapped = substituteForSession(state, sessionId, slotId, movementId);
  const permanent = dayId
    ? substituteSlot(swapped, dayId, slotId, movementId)
    : swapped;
  return clearSessionSubstitution(permanent, sessionId, slotId);
}
