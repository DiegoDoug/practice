/**
 * Supersets and circuits: planning structure over a day's slots.
 *
 * A group is NOT a second copy of workout data. Exercises and sets stay the
 * canonical log, and everything an athlete sees about a group — rounds done,
 * which exercise is next, whether the group is finished — is DERIVED from the
 * completed sets on every read. Nothing here is persisted beyond the group
 * definition itself, so reopening, editing, deleting, restoring or migrating a
 * set cannot leave a stale claim behind.
 *
 * The round mapping is the one rule everything else follows:
 *
 *     round r (1-based) of a member slot === set index r - 1 of that slot
 *
 * It needs no extra field, it survives a reload, and it re-derives correctly
 * the instant a set is reopened.
 */

import type {
  ExerciseGroup,
  ExerciseGroupKind,
  ExerciseLog,
  RoutineDay,
  SessionSnapshot,
  SnapshotExercise,
  WorkoutState,
} from './types';
import { isCountedWorkingSet } from './completion';

/** The fewest distinct exercises that make a group a group. */
export const MIN_GROUP_SLOTS = 2;

export const groupKindLabel = (kind: ExerciseGroupKind): string =>
  kind === 'superset' ? 'Superset' : 'Circuit';

export const newGroupId = (): string =>
  `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

// --- Validation ------------------------------------------------------------

export type GroupProblem = {
  /** Stable code for tests; the message is what the athlete reads. */
  code:
    | 'empty-id'
    | 'duplicate-id'
    | 'invalid-kind'
    | 'too-few-slots'
    | 'duplicate-slot'
    | 'missing-slot'
    | 'overlapping-slot'
    | 'invalid-rounds'
    | 'invalid-rest';
  message: string;
};

const isWholeAtLeast = (value: unknown, min: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= min;

/** Finite, non-negative, whole — or absent. Rest is seconds, not a fraction. */
const isRestValue = (value: unknown): boolean =>
  value === undefined || isWholeAtLeast(value, 0);

/**
 * Everything wrong with one group, given the day it belongs to.
 *
 * `others` are the day's OTHER groups, which is what makes overlap detectable:
 * a slot may belong to at most one group, and the athlete is told which group
 * already claims it rather than having the exercise silently moved.
 */
export function validateGroup(
  group: ExerciseGroup,
  slotIdsInDay: readonly string[],
  others: readonly ExerciseGroup[] = [],
): GroupProblem[] {
  const problems: GroupProblem[] = [];
  const known = new Set(slotIdsInDay);

  if (typeof group.groupId !== 'string' || group.groupId.trim() === '') {
    problems.push({ code: 'empty-id', message: 'A group needs an id.' });
  }
  if (others.some((other) => other.groupId === group.groupId)) {
    problems.push({
      code: 'duplicate-id',
      message: 'Two groups share the same id.',
    });
  }
  if (group.kind !== 'superset' && group.kind !== 'circuit') {
    problems.push({
      code: 'invalid-kind',
      message: 'A group is either a superset or a circuit.',
    });
  }

  const slotIds = Array.isArray(group.slotIds) ? group.slotIds : [];
  const distinct = new Set(slotIds);
  if (distinct.size !== slotIds.length) {
    problems.push({
      code: 'duplicate-slot',
      message: 'An exercise is listed twice in this group.',
    });
  }
  if (distinct.size < MIN_GROUP_SLOTS) {
    problems.push({
      code: 'too-few-slots',
      message: `Pick at least ${MIN_GROUP_SLOTS} exercises.`,
    });
  }
  for (const slotId of distinct) {
    if (!known.has(slotId)) {
      problems.push({
        code: 'missing-slot',
        message: 'An exercise in this group is not on this day.',
      });
      break;
    }
  }
  for (const slotId of distinct) {
    const owner = others.find((other) => other.slotIds.includes(slotId));
    if (owner) {
      problems.push({
        code: 'overlapping-slot',
        message: `An exercise is already in ${groupKindLabel(owner.kind).toLowerCase()} "${owner.groupId}". Remove it there first.`,
      });
      break;
    }
  }

  if (!isWholeAtLeast(group.rounds, 1)) {
    problems.push({
      code: 'invalid-rounds',
      message: 'Rounds must be a whole number, 1 or more.',
    });
  }
  if (
    !isRestValue(group.restBetweenExercisesSec) ||
    !isRestValue(group.restBetweenRoundsSec)
  ) {
    problems.push({
      code: 'invalid-rest',
      message: 'Rest must be a whole number of seconds, 0 or more.',
    });
  }

  return problems;
}

/** Every problem across a day's whole group list. */
export function validateGroups(
  groups: readonly ExerciseGroup[],
  slotIdsInDay: readonly string[],
): GroupProblem[] {
  return groups.flatMap((group, index) =>
    validateGroup(
      group,
      slotIdsInDay,
      groups.filter((_, other) => other !== index),
    ),
  );
}

/** A defensive copy — the slot order is data, so it must not be shared. */
export const copyGroup = (group: ExerciseGroup): ExerciseGroup => ({
  groupId: group.groupId,
  kind: group.kind,
  slotIds: [...group.slotIds],
  rounds: group.rounds,
  ...(group.restBetweenExercisesSec !== undefined
    ? { restBetweenExercisesSec: group.restBetweenExercisesSec }
    : {}),
  ...(group.restBetweenRoundsSec !== undefined
    ? { restBetweenRoundsSec: group.restBetweenRoundsSec }
    : {}),
});

/**
 * Drop what a group can no longer reference, so rendering never has to.
 *
 * Removing an exercise from a routine day leaves its groups pointing at a slot
 * that is gone; a group that falls below two members stops being a group. This
 * is applied when a day is edited and when a snapshot is frozen, so neither a
 * live screen nor a frozen session ever holds a dangling member.
 */
export function sanitizeGroups(
  groups: readonly ExerciseGroup[] | undefined,
  slotIdsInDay: readonly string[],
): ExerciseGroup[] {
  const known = new Set(slotIdsInDay);
  const claimed = new Set<string>();
  const seenIds = new Set<string>();
  const kept: ExerciseGroup[] = [];

  for (const group of groups ?? []) {
    if (group.kind !== 'superset' && group.kind !== 'circuit') continue;
    if (typeof group.groupId !== 'string' || group.groupId.trim() === '')
      continue;
    if (seenIds.has(group.groupId)) continue;
    if (!isWholeAtLeast(group.rounds, 1)) continue;
    if (
      !isRestValue(group.restBetweenExercisesSec) ||
      !isRestValue(group.restBetweenRoundsSec)
    )
      continue;

    const slotIds: string[] = [];
    for (const slotId of group.slotIds ?? []) {
      // First group to claim a slot keeps it: membership is single-valued, and
      // dropping the later claim is the only resolution that moves nothing.
      if (!known.has(slotId) || claimed.has(slotId) || slotIds.includes(slotId))
        continue;
      slotIds.push(slotId);
    }
    if (slotIds.length < MIN_GROUP_SLOTS) continue;

    for (const slotId of slotIds) claimed.add(slotId);
    seenIds.add(group.groupId);
    kept.push({ ...copyGroup(group), slotIds });
  }
  return kept;
}

/** The group a slot belongs to, or null. */
export const groupOfSlot = (
  groups: readonly ExerciseGroup[] | undefined,
  slotId: string,
): ExerciseGroup | null =>
  (groups ?? []).find((group) => group.slotIds.includes(slotId)) ?? null;

// --- Derived progress ------------------------------------------------------

export type RoundMember = {
  slotId: string;
  /** The slot has a set at this round's index. */
  present: boolean;
  /**
   * The round is waiting on this member.
   *
   * True while the PLAN still asks for the round, and true for any member that
   * actually logged a set there. The two together are what separate "I have not
   * got to the incline press yet" from "this round is past the plan and only
   * involves whoever logged into it" — a distinction the set list cannot make
   * on its own, so the planned round count settles it.
   */
  expected: boolean;
  done: boolean;
};

export type RoundState = {
  /** 1-based. */
  round: number;
  members: RoundMember[];
  /** Every member the round is waiting on is ticked. */
  complete: boolean;
  /** At least one set in this round is ticked. */
  started: boolean;
};

export type GroupProgress = {
  groupId: string;
  kind: ExerciseGroupKind;
  /** What the plan asks for. */
  plannedRounds: number;
  /** Planned, widened by any extra sets actually logged. Never shrunk. */
  totalRounds: number;
  rounds: RoundState[];
  /** How many rounds are fully complete. Not "how far along" — how many done. */
  completedRounds: number;
  /** The first incomplete round, or null when the group is finished. */
  currentRound: number | null;
  /** The next exercise to perform, or null when the group is finished. */
  currentSlotId: string | null;
  /** The one after that, which may be the first of the next round. */
  nextSlotId: string | null;
  complete: boolean;
};

/**
 * Rounds done, and what comes next, computed from the logs alone.
 *
 * Unequal set counts are the interesting case, and the plan is what resolves
 * it. Inside the planned rounds every member is waiting, so a superset does not
 * announce round 1 as finished the moment the first exercise is ticked and the
 * second has not been typed into yet. Past the planned rounds only the members
 * that actually logged a set take part, so extra work on one exercise does not
 * invent an obligation on another.
 *
 * A member that ran fewer sets than the plan therefore leaves its round
 * unfinished. That is the honest reading: the round was not completed as
 * planned. Nothing is manufactured to close it.
 */
export function deriveGroupProgress(
  group: ExerciseGroup,
  exercises: Record<string, ExerciseLog> | undefined,
): GroupProgress {
  const setsOf = (slotId: string) => exercises?.[slotId]?.sets ?? [];
  const longest = group.slotIds.reduce(
    (most, slotId) => Math.max(most, setsOf(slotId).length),
    0,
  );
  // Validation and `sanitizeGroups` both refuse a non-finite round count, but
  // this is the function that decides whether a group reads as FINISHED, and a
  // NaN falling through to an empty round list would say "complete" about a
  // group nobody has trained. One round is the honest floor.
  const plannedRounds = Number.isFinite(group.rounds)
    ? Math.max(1, Math.trunc(group.rounds))
    : 1;
  const totalRounds = Math.max(plannedRounds, longest);

  const rounds: RoundState[] = [];
  for (let round = 1; round <= totalRounds; round += 1) {
    const members: RoundMember[] = group.slotIds.map((slotId) => {
      const set = setsOf(slotId)[round - 1];
      const present = set !== undefined;
      return {
        slotId,
        present,
        expected: present || round <= plannedRounds,
        done: set?.done === true,
      };
    });
    const expected = members.filter((member) => member.expected);
    rounds.push({
      round,
      members,
      complete: expected.length > 0 && expected.every((member) => member.done),
      started: members.some((member) => member.done),
    });
  }

  const completedRounds = rounds.filter((round) => round.complete).length;
  const currentIndex = rounds.findIndex((round) => !round.complete);
  const currentRound = currentIndex === -1 ? null : currentIndex + 1;

  /**
   * What is still to do in a round, in slot order.
   *
   * Exactly the members `complete` above is waiting on, so guidance and
   * completion can never disagree: nothing is named as the next thing to do and
   * then ignored when the round closes, and nothing closes a round while it is
   * still being pointed at.
   */
  const outstandingIn = (round: RoundState | undefined): string[] =>
    (round?.members ?? [])
      .filter((member) => member.expected && !member.done)
      .map((member) => member.slotId);

  const pending =
    currentIndex === -1 ? [] : outstandingIn(rounds[currentIndex]);
  const current = pending[0] ?? null;
  const next =
    currentIndex === -1
      ? null
      : (pending[1] ?? outstandingIn(rounds[currentIndex + 1])[0] ?? null);

  return {
    groupId: group.groupId,
    kind: group.kind,
    plannedRounds,
    totalRounds,
    rounds,
    completedRounds,
    currentRound,
    currentSlotId: current,
    nextSlotId: next,
    complete: currentIndex === -1,
  };
}

/** Completed working sets logged against a group's members. Derived, as ever. */
export const countGroupWorkingSets = (
  group: ExerciseGroup,
  exercises: Record<string, ExerciseLog> | undefined,
): number =>
  group.slotIds.reduce(
    (total, slotId) =>
      total +
      (exercises?.[slotId]?.sets ?? []).filter(isCountedWorkingSet).length,
    0,
  );

// --- Rest selection --------------------------------------------------------

export type RestBoundary = 'none' | 'exercise' | 'round' | 'group';

export type RestChoice = { sec: number; boundary: RestBoundary };

/**
 * Which rest a just-completed set earns.
 *
 * Deterministic and documented in `docs/data-contract.md`:
 *
 *  1. slot in no group            → the global default (Stage 1–6, unchanged)
 *  2. group now finished          → the global default; the group is over
 *  3. round now finished          → between-rounds, else between-exercises,
 *                                   else the global default
 *  4. otherwise (mid-round)       → between-exercises, else the global default
 *
 * Rule 2 wins over rule 3 deliberately: the last round's boundary is not a
 * boundary between rounds, because there is no round after it.
 */
export function restForCompletion(
  groups: readonly ExerciseGroup[] | undefined,
  exercisesAfter: Record<string, ExerciseLog> | undefined,
  slotId: string,
  setIndex: number,
  defaultSec: number,
): RestChoice {
  const group = groupOfSlot(groups, slotId);
  if (!group) return { sec: defaultSec, boundary: 'none' };

  const progress = deriveGroupProgress(group, exercisesAfter);
  if (progress.complete) return { sec: defaultSec, boundary: 'group' };

  const round = progress.rounds[setIndex];
  const between = group.restBetweenExercisesSec;
  if (round?.complete) {
    const sec = group.restBetweenRoundsSec ?? between ?? defaultSec;
    return { sec, boundary: 'round' };
  }
  return { sec: between ?? defaultSec, boundary: 'exercise' };
}

// --- Rendering order -------------------------------------------------------

export type DayBlock =
  | { kind: 'exercise'; slot: SnapshotExercise }
  | {
      kind: 'group';
      group: ExerciseGroup;
      slots: SnapshotExercise[];
    };

/**
 * Lay a session out as standalone exercises and group blocks.
 *
 * A group takes the position of its FIRST member in the day's own order, and
 * its members are then shown in `slotIds` order — which is why supersets and
 * circuits are representable independently of display order. Members appear
 * once, inside their group; ungrouped exercises keep their place around them.
 */
export function layoutDay(snapshot: SessionSnapshot): DayBlock[] {
  const groups = sanitizeGroups(
    snapshot.groups,
    snapshot.exercises.map((slot) => slot.slotId),
  );
  const bySlot = new Map(
    snapshot.exercises.map((slot) => [slot.slotId, slot] as const),
  );
  const emitted = new Set<string>();
  const blocks: DayBlock[] = [];

  for (const slot of snapshot.exercises) {
    if (emitted.has(slot.slotId)) continue;
    const group = groupOfSlot(groups, slot.slotId);
    if (!group) {
      emitted.add(slot.slotId);
      blocks.push({ kind: 'exercise', slot });
      continue;
    }
    const slots = group.slotIds
      .map((slotId) => bySlot.get(slotId))
      .filter((entry): entry is SnapshotExercise => entry !== undefined);
    for (const member of slots) emitted.add(member.slotId);
    blocks.push({ kind: 'group', group, slots });
  }
  return blocks;
}

// --- Routine edits ---------------------------------------------------------
// Pure, immutable, and never touching a day's exercises: removing a group is a
// planning change, not a deletion of work.

const mapRoutineDay = (
  state: WorkoutState,
  dayId: string,
  fn: (day: RoutineDay) => RoutineDay,
): WorkoutState => ({
  ...state,
  routine: state.routine.map((day) => (day.dayId === dayId ? fn(day) : day)),
});

export type GroupEditResult =
  { ok: true; state: WorkoutState } | { ok: false; problems: GroupProblem[] };

/**
 * Create or replace one group on a day.
 *
 * Invalid or overlapping definitions are REFUSED, with the conflict named.
 * Nothing is silently moved out of another group to make room: an exercise
 * leaving a superset is a decision the athlete makes, not a side effect.
 */
export function saveGroup(
  state: WorkoutState,
  dayId: string,
  group: ExerciseGroup,
): GroupEditResult {
  const day = state.routine.find((entry) => entry.dayId === dayId);
  if (!day) {
    return {
      ok: false,
      problems: [{ code: 'missing-slot', message: 'That day is gone.' }],
    };
  }
  const slotIds = day.exercises.map((slot) => slot.slotId);
  const others = (day.groups ?? []).filter(
    (entry) => entry.groupId !== group.groupId,
  );
  const problems = validateGroup(group, slotIds, others);
  if (problems.length > 0) return { ok: false, problems };

  const saved = copyGroup(group);
  const existing = (day.groups ?? []).some(
    (entry) => entry.groupId === group.groupId,
  );
  const groups = existing
    ? (day.groups ?? []).map((entry) =>
        entry.groupId === group.groupId ? saved : entry,
      )
    : [...(day.groups ?? []), saved];

  return {
    ok: true,
    state: mapRoutineDay(state, dayId, (entry) => ({ ...entry, groups })),
  };
}

/** Remove a group. Its exercises, and everything logged against them, stay. */
export function removeGroup(
  state: WorkoutState,
  dayId: string,
  groupId: string,
): WorkoutState {
  return mapRoutineDay(state, dayId, (day) => {
    const groups = (day.groups ?? []).filter(
      (group) => group.groupId !== groupId,
    );
    if (groups.length === 0) {
      const { groups: _dropped, ...rest } = day;
      return rest;
    }
    return { ...day, groups };
  });
}

/** Move one member within its group. Order is data; it never follows the DOM. */
export function moveGroupSlot(
  state: WorkoutState,
  dayId: string,
  groupId: string,
  slotId: string,
  to: number,
): WorkoutState {
  return mapRoutineDay(state, dayId, (day) => ({
    ...day,
    groups: (day.groups ?? []).map((group) => {
      if (group.groupId !== groupId) return group;
      const from = group.slotIds.indexOf(slotId);
      if (from === -1) return group;
      const bounded = Math.max(0, Math.min(group.slotIds.length - 1, to));
      if (bounded === from) return group;
      const slotIds = [...group.slotIds];
      const [moved] = slotIds.splice(from, 1);
      slotIds.splice(bounded, 0, moved);
      return { ...group, slotIds };
    }),
  }));
}
