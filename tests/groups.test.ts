import { describe, expect, it } from 'vitest';
import { buildBackup, emptyState, parseBackup } from '@/lib/backup';
import {
  MIN_GROUP_SLOTS,
  countGroupWorkingSets,
  deriveGroupProgress,
  groupOfSlot,
  layoutDay,
  moveGroupSlot,
  removeGroup,
  restForCompletion,
  sanitizeGroups,
  saveGroup,
  validateGroup,
  validateGroups,
} from '@/lib/groups';
import {
  duplicateDay,
  ensureSessionSnapshot,
  findDay,
  refreshOpenSnapshots,
  removeExercise,
  resolveSessionRoutine,
  substituteForSession,
} from '@/lib/routine';
import { ensureWeekDaySession } from '@/lib/sessions';
import { buildHistory, withCompletion, withSets } from '@/lib/workout';
import { markDone, reopen } from '@/lib/sets';
import type {
  ExerciseGroup,
  SetEntry,
  WorkoutSession,
  WorkoutState,
} from '@/lib/types';

const WEEK = '2025-06-02';
const DAY = 'day1';

const slots = (state: WorkoutState, dayId = DAY): string[] =>
  findDay(state.routine, dayId)?.exercises.map((slot) => slot.slotId) ?? [];

const group = (over: Partial<ExerciseGroup> = {}): ExerciseGroup => ({
  groupId: 'g1',
  kind: 'superset',
  slotIds: ['day1-s0', 'day1-s1'],
  rounds: 3,
  ...over,
});

const set = (weight = '100', reps = '8'): SetEntry => ({
  weight,
  reps,
  rpe: '',
  setId: `set_${Math.random().toString(36).slice(2, 10)}`,
});

/** A set that is already ticked, the way the completion path leaves it. */
const done = (weight = '100', reps = '8'): SetEntry => ({
  ...set(weight, reps),
  done: true,
  doneAt: 1_700_000_000_000,
});

/** A state with one superset on day 1 and a session logging against it. */
function withGroup(over: Partial<ExerciseGroup> = {}): {
  state: WorkoutState;
  sessionId: string;
  g: ExerciseGroup;
} {
  const base = emptyState();
  const g = group(over);
  const saved = saveGroup(base, DAY, g);
  if (!saved.ok) throw new Error(saved.problems[0].message);
  const { state, sessionId } = ensureWeekDaySession(
    saved.state,
    WEEK,
    DAY,
    WEEK,
  );
  return { state: ensureSessionSnapshot(state, sessionId), sessionId, g };
}

const log = (
  state: WorkoutState,
  sessionId: string,
  slotId: string,
  sets: SetEntry[],
): WorkoutState =>
  withSets(state, sessionId, slotId, sets, 'barbell-bench-press');

const sessionOf = (state: WorkoutState, sessionId: string): WorkoutSession =>
  state.sessions[sessionId];

// ---------------------------------------------------------------------------

describe('creating groups', () => {
  it('creates a valid superset on a routine day', () => {
    const result = saveGroup(emptyState(), DAY, group());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = findDay(result.state.routine, DAY)?.groups ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      groupId: 'g1',
      kind: 'superset',
      slotIds: ['day1-s0', 'day1-s1'],
      rounds: 3,
    });
  });

  it('creates a circuit with three exercises, rounds and both rests', () => {
    const result = saveGroup(
      emptyState(),
      DAY,
      group({
        groupId: 'c1',
        kind: 'circuit',
        slotIds: ['day1-s0', 'day1-s1', 'day1-s2'],
        rounds: 4,
        restBetweenExercisesSec: 15,
        restBetweenRoundsSec: 120,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findDay(result.state.routine, DAY)?.groups?.[0]).toMatchObject({
      kind: 'circuit',
      rounds: 4,
      restBetweenExercisesSec: 15,
      restBetweenRoundsSec: 120,
    });
  });

  it('stores a defensive copy, so the caller cannot mutate saved order', () => {
    const draft = group();
    const result = saveGroup(emptyState(), DAY, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    draft.slotIds.reverse();
    expect(findDay(result.state.routine, DAY)?.groups?.[0].slotIds).toEqual([
      'day1-s0',
      'day1-s1',
    ]);
  });
});

describe('group invariants', () => {
  const day = ['s0', 's1', 's2'];

  it('needs at least two distinct exercises', () => {
    expect(MIN_GROUP_SLOTS).toBe(2);
    expect(
      validateGroup(group({ slotIds: ['s0'] }), day).map((p) => p.code),
    ).toContain('too-few-slots');
    expect(
      validateGroup(group({ slotIds: ['s0', 's0'] }), day).map((p) => p.code),
    ).toEqual(expect.arrayContaining(['duplicate-slot', 'too-few-slots']));
  });

  it('rejects a member that is not on the day', () => {
    expect(
      validateGroup(group({ slotIds: ['s0', 'ghost'] }), day).map(
        (p) => p.code,
      ),
    ).toContain('missing-slot');
  });

  it('rejects an empty group id', () => {
    expect(
      validateGroup(group({ groupId: '  ', slotIds: ['s0', 's1'] }), day).map(
        (p) => p.code,
      ),
    ).toContain('empty-id');
  });

  it('rejects a duplicate group id', () => {
    const other = group({ groupId: 'g1', slotIds: ['s2', 's1'] });
    expect(
      validateGroup(group({ slotIds: ['s0', 's1'] }), day, [other]).map(
        (p) => p.code,
      ),
    ).toContain('duplicate-id');
  });

  it('rejects an invalid kind', () => {
    const bad = { ...group(), kind: 'tri-set' } as unknown as ExerciseGroup;
    expect(validateGroup(bad, day).map((p) => p.code)).toContain(
      'invalid-kind',
    );
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects rounds of %p',
    (rounds) => {
      expect(
        validateGroup(group({ rounds, slotIds: ['s0', 's1'] }), day).map(
          (p) => p.code,
        ),
      ).toContain('invalid-rounds');
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects rest of %p',
    (rest) => {
      expect(
        validateGroup(
          group({ slotIds: ['s0', 's1'], restBetweenExercisesSec: rest }),
          day,
        ).map((p) => p.code),
      ).toContain('invalid-rest');
      expect(
        validateGroup(
          group({ slotIds: ['s0', 's1'], restBetweenRoundsSec: rest }),
          day,
        ).map((p) => p.code),
      ).toContain('invalid-rest');
    },
  );

  it('accepts a rest of zero — straight into the next exercise', () => {
    expect(
      validateGroup(
        group({
          slotIds: ['s0', 's1'],
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 0,
        }),
        day,
      ),
    ).toEqual([]);
  });

  it('validateGroups checks every group against its siblings', () => {
    const groups = [
      group({ groupId: 'a', slotIds: ['s0', 's1'] }),
      group({ groupId: 'b', slotIds: ['s1', 's2'] }),
    ];
    expect(validateGroups(groups, day).map((p) => p.code)).toContain(
      'overlapping-slot',
    );
  });
});

describe('overlapping membership', () => {
  it('refuses a second group claiming a slot, and moves nothing', () => {
    const first = saveGroup(emptyState(), DAY, group());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = saveGroup(
      first.state,
      DAY,
      group({
        groupId: 'g2',
        kind: 'circuit',
        slotIds: ['day1-s1', 'day1-s2'],
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.problems.map((p) => p.code)).toContain('overlapping-slot');
    // The first group is untouched — nothing was silently reassigned.
    expect(findDay(first.state.routine, DAY)?.groups).toHaveLength(1);
    expect(findDay(first.state.routine, DAY)?.groups?.[0].slotIds).toEqual([
      'day1-s0',
      'day1-s1',
    ]);
  });

  it('lets a group be edited without colliding with itself', () => {
    const first = saveGroup(emptyState(), DAY, group());
    if (!first.ok) throw new Error('setup');
    const edited = saveGroup(
      first.state,
      DAY,
      group({ slotIds: ['day1-s0', 'day1-s1', 'day1-s2'], rounds: 5 }),
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(findDay(edited.state.routine, DAY)?.groups).toHaveLength(1);
    expect(findDay(edited.state.routine, DAY)?.groups?.[0].rounds).toBe(5);
  });
});

describe('stable slot-based membership', () => {
  it('keeps a substituted movement in the same group', () => {
    const { state, sessionId } = withGroup();
    const swapped = substituteForSession(
      state,
      sessionId,
      'day1-s0',
      'flat-db-press',
    );
    const snapshot = resolveSessionRoutine(
      swapped,
      sessionOf(swapped, sessionId),
    );
    expect(snapshot.groups[0].slotIds).toEqual(['day1-s0', 'day1-s1']);
    // The movement changed; the membership did not.
    expect(
      snapshot.exercises.find((e) => e.slotId === 'day1-s0')?.movementId,
    ).toBe('flat-db-press');
    expect(groupOfSlot(snapshot.groups, 'day1-s0')?.groupId).toBe('g1');
  });

  it('follows slot ids, not render order, when the day is reordered', () => {
    const { state } = withGroup({ slotIds: ['day1-s2', 'day1-s0'] });
    const g = findDay(state.routine, DAY)?.groups?.[0];
    expect(g?.slotIds).toEqual(['day1-s2', 'day1-s0']);
    const snapshot = resolveSessionRoutine(state, {
      sessionId: 'x',
      routineDayId: DAY,
      status: 'scheduled',
      exercises: {},
    });
    // Rendering puts the group at its first member's position, in slot order.
    const blocks = layoutDay(snapshot);
    const groupBlock = blocks.find((b) => b.kind === 'group');
    expect(
      groupBlock?.kind === 'group' && groupBlock.slots.map((s) => s.slotId),
    ).toEqual(['day1-s2', 'day1-s0']);
  });
});

describe('reordering, editing and deletion', () => {
  it('moves a member within its group', () => {
    const { state } = withGroup({
      slotIds: ['day1-s0', 'day1-s1', 'day1-s2'],
    });
    const moved = moveGroupSlot(state, DAY, 'g1', 'day1-s2', 0);
    expect(findDay(moved.routine, DAY)?.groups?.[0].slotIds).toEqual([
      'day1-s2',
      'day1-s0',
      'day1-s1',
    ]);
  });

  it('clamps an out-of-range move instead of dropping the member', () => {
    const { state } = withGroup();
    const moved = moveGroupSlot(state, DAY, 'g1', 'day1-s0', 99);
    expect(findDay(moved.routine, DAY)?.groups?.[0].slotIds).toEqual([
      'day1-s1',
      'day1-s0',
    ]);
  });

  it('removes a group without deleting its exercises or their history', () => {
    const { state, sessionId } = withGroup();
    const logged = log(state, sessionId, 'day1-s0', [done()]);
    const removed = removeGroup(logged, DAY, 'g1');
    expect(findDay(removed.routine, DAY)?.groups).toBeUndefined();
    expect(slots(removed)).toEqual(slots(state));
    expect(
      sessionOf(removed, sessionId).exercises['day1-s0'].sets,
    ).toHaveLength(1);
  });

  it('drops a removed exercise from its group, keeping the logs', () => {
    const { state, sessionId } = withGroup({
      slotIds: ['day1-s0', 'day1-s1', 'day1-s2'],
    });
    const logged = log(state, sessionId, 'day1-s1', [done()]);
    const pruned = removeExercise(logged, DAY, 'day1-s1');
    expect(findDay(pruned.routine, DAY)?.groups?.[0].slotIds).toEqual([
      'day1-s0',
      'day1-s2',
    ]);
    expect(sessionOf(pruned, sessionId).exercises['day1-s1'].sets).toHaveLength(
      1,
    );
  });

  it('dissolves a group that falls below two exercises', () => {
    const { state } = withGroup();
    const pruned = removeExercise(state, DAY, 'day1-s1');
    expect(findDay(pruned.routine, DAY)?.groups).toBeUndefined();
    expect(slots(pruned)).toContain('day1-s0');
  });

  it('re-points a duplicated day at its own slots and its own group ids', () => {
    const { state } = withGroup();
    const copied = duplicateDay(state, DAY);
    const copy = copied.routine[1];
    expect(copy.dayId).not.toBe(DAY);
    const copiedGroup = copy.groups?.[0];
    expect(copiedGroup).toBeDefined();
    expect(copiedGroup?.groupId).not.toBe('g1');
    expect(copiedGroup?.slotIds.every((id) => id.startsWith(copy.dayId))).toBe(
      true,
    );
  });
});

describe('sanitizeGroups', () => {
  it('drops dangling members and groups that fall below two', () => {
    expect(
      sanitizeGroups(
        [
          group({ slotIds: ['s0', 'ghost', 's1'] }),
          group({ groupId: 'g2', slotIds: ['s2', 'gone'] }),
        ],
        ['s0', 's1', 's2'],
      ),
    ).toEqual([
      { groupId: 'g1', kind: 'superset', slotIds: ['s0', 's1'], rounds: 3 },
    ]);
  });

  it('gives an overlapped slot to the first group only', () => {
    const kept = sanitizeGroups(
      [
        group({ groupId: 'a', slotIds: ['s0', 's1'] }),
        group({ groupId: 'b', slotIds: ['s1', 's2'] }),
      ],
      ['s0', 's1', 's2'],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].groupId).toBe('a');
  });

  it('drops a group with impossible rounds rather than repairing it', () => {
    expect(
      sanitizeGroups([group({ rounds: 0 })], ['day1-s0', 'day1-s1']),
    ).toEqual([]);
  });
});

describe('round derivation', () => {
  const g = group({ rounds: 3 });

  it('is zero with nothing logged, and names round 1 as current', () => {
    const p = deriveGroupProgress(g, {});
    expect(p.completedRounds).toBe(0);
    expect(p.currentRound).toBe(1);
    expect(p.currentSlotId).toBe('day1-s0');
    expect(p.nextSlotId).toBe('day1-s1');
    expect(p.complete).toBe(false);
  });

  it('does not close round 1 before the second exercise has any row', () => {
    const p = deriveGroupProgress(g, {
      'day1-s0': { movementId: 'm', sets: [done()] },
    });
    expect(p.rounds[0].complete).toBe(false);
    expect(p.completedRounds).toBe(0);
    expect(p.currentRound).toBe(1);
    expect(p.currentSlotId).toBe('day1-s1');
  });

  it('completes a round only when every expected set in it is done', () => {
    const half = {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [set()] },
    };
    const partial = deriveGroupProgress(g, half);
    expect(partial.completedRounds).toBe(0);
    expect(partial.currentRound).toBe(1);
    expect(partial.currentSlotId).toBe('day1-s1');
    expect(partial.rounds[0].started).toBe(true);

    const whole = deriveGroupProgress(g, {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [done()] },
    });
    expect(whole.completedRounds).toBe(1);
    expect(whole.currentRound).toBe(2);
    expect(whole.currentSlotId).toBe('day1-s0');
  });

  it('finishes the group when every planned round is complete', () => {
    const three = [done(), done(), done()];
    const p = deriveGroupProgress(g, {
      'day1-s0': { movementId: 'm', sets: three },
      'day1-s1': { movementId: 'm', sets: three },
    });
    expect(p.complete).toBe(true);
    expect(p.completedRounds).toBe(3);
    expect(p.currentRound).toBeNull();
    expect(p.currentSlotId).toBeNull();
    expect(p.nextSlotId).toBeNull();
  });

  it('never manufactures a round that was not logged', () => {
    const p = deriveGroupProgress(g, {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [done()] },
    });
    // Rounds 2 and 3 are planned but hold no sets: outstanding, not invented.
    expect(p.rounds[1].members.every((m) => !m.present)).toBe(true);
    expect(p.rounds[1].complete).toBe(false);
    expect(p.totalRounds).toBe(3);
  });

  it('widens past the plan when extra sets are logged, never shrinking', () => {
    const p = deriveGroupProgress(group({ rounds: 2 }), {
      'day1-s0': { movementId: 'm', sets: [done(), done(), done()] },
      'day1-s1': { movementId: 'm', sets: [done(), done(), done()] },
    });
    expect(p.totalRounds).toBe(3);
    expect(p.completedRounds).toBe(3);
    expect(p.complete).toBe(true);
  });

  it('counts completed working sets across the group', () => {
    expect(
      countGroupWorkingSets(g, {
        'day1-s0': { movementId: 'm', sets: [done(), set()] },
        'day1-s1': { movementId: 'm', sets: [{ ...done(), kind: 'warmup' }] },
      }),
    ).toBe(1);
  });
});

describe('unequal set counts', () => {
  const g = group({ rounds: 3 });
  const uneven = {
    'day1-s0': { movementId: 'm', sets: [done(), done(), done()] },
    'day1-s1': { movementId: 'm', sets: [done(), done()] },
  };

  it('keeps a round the plan still asks for open until every member is done', () => {
    const p = deriveGroupProgress(g, uneven);
    expect(p.rounds[2].members).toEqual([
      { slotId: 'day1-s0', present: true, expected: true, done: true },
      // Round 3 is still within the plan, so s1 is waited on rather than
      // dropped — the round was not completed as planned, and says so.
      { slotId: 'day1-s1', present: false, expected: true, done: false },
    ]);
    expect(p.rounds[2].complete).toBe(false);
    expect(p.complete).toBe(false);
    expect(p.completedRounds).toBe(2);
    expect(p.currentRound).toBe(3);
    expect(p.currentSlotId).toBe('day1-s1');
  });

  it('does not invent an obligation in rounds beyond the plan', () => {
    const p = deriveGroupProgress(group({ rounds: 2 }), uneven);
    // Round 3 is past the plan: only s0 logged into it, so only s0 counts.
    expect(p.rounds[2].members).toEqual([
      { slotId: 'day1-s0', present: true, expected: true, done: true },
      { slotId: 'day1-s1', present: false, expected: false, done: false },
    ]);
    expect(p.rounds[2].complete).toBe(true);
    expect(p.complete).toBe(true);
    expect(p.totalRounds).toBe(3);
  });

  it('never names a member the round is not waiting on', () => {
    const p = deriveGroupProgress(group({ rounds: 2 }), {
      ...uneven,
      'day1-s0': { movementId: 'm', sets: [done(), done(), set()] },
    });
    expect(p.currentRound).toBe(3);
    expect(p.currentSlotId).toBe('day1-s0');
    expect(p.nextSlotId).toBeNull();
  });
});

describe('reopening and deleting sets', () => {
  const g = group({ rounds: 2 });

  it('re-derives a round as incomplete when a set is reopened', () => {
    const sets = [done(), done()];
    const before = deriveGroupProgress(g, {
      'day1-s0': { movementId: 'm', sets },
      'day1-s1': { movementId: 'm', sets: [done(), done()] },
    });
    expect(before.complete).toBe(true);

    const after = deriveGroupProgress(g, {
      'day1-s0': { movementId: 'm', sets: reopen(sets, 0) },
      'day1-s1': { movementId: 'm', sets: [done(), done()] },
    });
    expect(after.complete).toBe(false);
    expect(after.completedRounds).toBe(1);
    expect(after.currentRound).toBe(1);
    expect(after.currentSlotId).toBe('day1-s0');
  });

  it('re-derives when a set is deleted outright', () => {
    const p = deriveGroupProgress(g, {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [done(), done()] },
    });
    // s0 lost its second set, and round 2 is still in the plan, so the round
    // reopens and points back at s0 rather than quietly closing without it.
    expect(p.rounds[1].complete).toBe(false);
    expect(p.complete).toBe(false);
    expect(p.currentRound).toBe(2);
    expect(p.currentSlotId).toBe('day1-s0');
  });

  it('nothing is stored: progress lives only in the sets', () => {
    const { state, sessionId } = withGroup();
    const logged = log(state, sessionId, 'day1-s0', [done()]);
    expect(sessionOf(logged, sessionId).groupProgress).toBeUndefined();
  });

  it('marking a set done through the real path advances the round', () => {
    const g2 = group({ rounds: 1 });
    const draft = [set('100', '8')];
    const mode = { loadMode: 'external' as const };
    const exercises = {
      'day1-s0': { movementId: 'm', sets: markDone(draft, 0, mode, 1) },
      'day1-s1': { movementId: 'm', sets: [set('50', '10')] },
    };
    expect(deriveGroupProgress(g2, exercises).currentSlotId).toBe('day1-s1');
    expect(
      deriveGroupProgress(g2, {
        ...exercises,
        'day1-s1': {
          movementId: 'm',
          sets: markDone([set('50', '10')], 0, mode, 2),
        },
      }).complete,
    ).toBe(true);
  });
});

describe('rest selection at every group boundary', () => {
  const DEFAULT = 90;
  const g = group({
    rounds: 2,
    restBetweenExercisesSec: 20,
    restBetweenRoundsSec: 150,
  });
  const groups = [g];

  it('uses the global default for an ungrouped exercise', () => {
    expect(restForCompletion(groups, {}, 'day1-s4', 0, DEFAULT)).toEqual({
      sec: DEFAULT,
      boundary: 'none',
    });
  });

  it('uses between-exercises rest inside a round', () => {
    const after = {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [set()] },
    };
    expect(restForCompletion(groups, after, 'day1-s0', 0, DEFAULT)).toEqual({
      sec: 20,
      boundary: 'exercise',
    });
  });

  it('uses between-rounds rest when a round closes', () => {
    const after = {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [done()] },
    };
    expect(restForCompletion(groups, after, 'day1-s1', 0, DEFAULT)).toEqual({
      sec: 150,
      boundary: 'round',
    });
  });

  it('falls back to the global default after the last round', () => {
    const after = {
      'day1-s0': { movementId: 'm', sets: [done(), done()] },
      'day1-s1': { movementId: 'm', sets: [done(), done()] },
    };
    expect(restForCompletion(groups, after, 'day1-s1', 1, DEFAULT)).toEqual({
      sec: DEFAULT,
      boundary: 'group',
    });
  });

  it('falls back through between-exercises when no round rest is set', () => {
    const only = [group({ rounds: 2, restBetweenExercisesSec: 20 })];
    const after = {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [done()] },
    };
    expect(restForCompletion(only, after, 'day1-s1', 0, DEFAULT)).toEqual({
      sec: 20,
      boundary: 'round',
    });
  });

  it('falls back to the global default when the group sets no rest at all', () => {
    const bare = [group({ rounds: 2 })];
    const after = {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [set()] },
    };
    expect(restForCompletion(bare, after, 'day1-s0', 0, DEFAULT)).toEqual({
      sec: DEFAULT,
      boundary: 'exercise',
    });
  });

  it('honours a rest of zero rather than treating it as unset', () => {
    const zero = [group({ rounds: 2, restBetweenExercisesSec: 0 })];
    const after = {
      'day1-s0': { movementId: 'm', sets: [done()] },
      'day1-s1': { movementId: 'm', sets: [set()] },
    };
    expect(restForCompletion(zero, after, 'day1-s0', 0, DEFAULT).sec).toBe(0);
  });

  it('does not treat a half-done planned round as a round boundary', () => {
    const after = {
      'day1-s0': { movementId: 'm', sets: [done(), done()] },
      'day1-s1': { movementId: 'm', sets: [done()] },
    };
    // Round 2 is still in the plan and s1 has not logged into it, so finishing
    // s0's second set is an exercise boundary, not the end of the round.
    expect(restForCompletion(groups, after, 'day1-s0', 1, DEFAULT)).toEqual({
      sec: 20,
      boundary: 'exercise',
    });
  });

  it('gives exercise rest when the next member has no row yet', () => {
    // The case a superset hits on its very first set: s1 has no log entry at
    // all, and round 1 must not read as closed.
    const after = { 'day1-s0': { movementId: 'm', sets: [done()] } };
    expect(restForCompletion(groups, after, 'day1-s0', 0, DEFAULT)).toEqual({
      sec: 20,
      boundary: 'exercise',
    });
  });
});

describe('snapshot freezing', () => {
  it('copies the group definitions into the frozen snapshot', () => {
    const { state, sessionId } = withGroup({
      restBetweenExercisesSec: 30,
      restBetweenRoundsSec: 90,
    });
    expect(sessionOf(state, sessionId).snapshot?.groups).toEqual([
      {
        groupId: 'g1',
        kind: 'superset',
        slotIds: ['day1-s0', 'day1-s1'],
        rounds: 3,
        restBetweenExercisesSec: 30,
        restBetweenRoundsSec: 90,
      },
    ]);
  });

  it('does not share the slot order array with the routine', () => {
    const { state, sessionId } = withGroup();
    const frozen = sessionOf(state, sessionId).snapshot?.groups[0].slotIds;
    const planned = findDay(state.routine, DAY)?.groups?.[0].slotIds;
    expect(frozen).toEqual(planned);
    expect(frozen).not.toBe(planned);
  });

  it('leaves a completed session alone when the routine changes', () => {
    const { state, sessionId } = withGroup();
    const logged = log(state, sessionId, 'day1-s0', [done()]);
    const finished = withCompletion(logged, sessionId, true, 1);

    const edited = saveGroup(finished, DAY, group({ rounds: 9 }));
    if (!edited.ok) throw new Error('setup');
    const refreshed = refreshOpenSnapshots(edited.state, [sessionId]);
    expect(sessionOf(refreshed, sessionId).snapshot?.groups[0].rounds).toBe(3);
  });

  it('refreshes an unstarted scheduled session from the current routine', () => {
    const { state, sessionId } = withGroup();
    expect(sessionOf(state, sessionId).status).toBe('scheduled');
    const edited = saveGroup(state, DAY, group({ rounds: 6, kind: 'circuit' }));
    if (!edited.ok) throw new Error('setup');
    const refreshed = refreshOpenSnapshots(edited.state, [sessionId]);
    expect(sessionOf(refreshed, sessionId).snapshot?.groups[0]).toMatchObject({
      rounds: 6,
      kind: 'circuit',
    });
  });

  it('drops a group from the snapshot when the routine removes it', () => {
    const { state, sessionId } = withGroup();
    const removed = removeGroup(state, DAY, 'g1');
    const refreshed = refreshOpenSnapshots(removed, [sessionId]);
    expect(sessionOf(refreshed, sessionId).snapshot?.groups).toEqual([]);
  });
});

describe('history shows the frozen structure', () => {
  it('reports a past session from its own snapshot, not the routine', () => {
    const { state, sessionId } = withGroup({ rounds: 2 });
    let logged = log(state, sessionId, 'day1-s0', [done(), done()]);
    logged = log(logged, sessionId, 'day1-s1', [done(), done()]);
    const finished = withCompletion(logged, sessionId, true, 1);

    const edited = saveGroup(
      finished,
      DAY,
      group({ kind: 'circuit', rounds: 9 }),
    );
    if (!edited.ok) throw new Error('setup');

    const entry = buildHistory(edited.state).find(
      (item) => item.sessionId === sessionId,
    );
    expect(entry?.groups).toHaveLength(1);
    // Frozen as a 2-round superset, and it stays one.
    expect(entry?.groups[0]).toMatchObject({
      kindLabel: 'Superset',
      plannedRounds: 2,
      completedRounds: 2,
      totalRounds: 2,
    });
  });

  it('keeps ungrouped exercises in history', () => {
    const { state, sessionId } = withGroup();
    const logged = log(state, sessionId, 'day1-s4', [done()]);
    const entry = buildHistory(logged).find((i) => i.sessionId === sessionId);
    expect(entry?.sets).toBe(1);
    expect(entry?.groups[0].exercises).not.toContain('day1-s4');
  });
});

describe('layout', () => {
  it('keeps ungrouped exercises and renders members once', () => {
    const { state } = withGroup({ slotIds: ['day1-s1', 'day1-s3'] });
    const snapshot = resolveSessionRoutine(state, {
      sessionId: 'x',
      routineDayId: DAY,
      status: 'scheduled',
      exercises: {},
    });
    const blocks = layoutDay(snapshot);
    const flat = blocks.flatMap((b) =>
      b.kind === 'group' ? b.slots.map((s) => s.slotId) : [b.slot.slotId],
    );
    expect(flat).toHaveLength(snapshot.exercises.length);
    expect(new Set(flat).size).toBe(flat.length);
    // The group sits where its first member sat — second, after day1-s0.
    expect(blocks[0].kind).toBe('exercise');
    expect(blocks[1].kind).toBe('group');
  });
});

describe('backup round trip and rejection', () => {
  const restore = (mutate: (doc: Record<string, unknown>) => void) => {
    const { state, sessionId } = withGroup({
      restBetweenExercisesSec: 20,
      restBetweenRoundsSec: 120,
    });
    const logged = log(state, sessionId, 'day1-s0', [done()]);
    const doc = JSON.parse(JSON.stringify(buildBackup(logged))) as Record<
      string,
      unknown
    >;
    mutate(doc);
    return parseBackup(doc);
  };

  it('round-trips a routine group and a frozen one unchanged', () => {
    const result = restore(() => {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findDay(result.state.routine, DAY)?.groups?.[0]).toEqual({
      groupId: 'g1',
      kind: 'superset',
      slotIds: ['day1-s0', 'day1-s1'],
      rounds: 3,
      restBetweenExercisesSec: 20,
      restBetweenRoundsSec: 120,
    });
    const session = Object.values(result.state.sessions)[0];
    expect(session.snapshot?.groups[0].slotIds).toEqual(['day1-s0', 'day1-s1']);
  });

  const routineGroup = (doc: Record<string, unknown>) =>
    (doc.routine as { dayId: string; groups?: unknown[] }[]).find(
      (day) => day.dayId === DAY,
    )!.groups![0] as Record<string, unknown>;

  const snapshotGroup = (doc: Record<string, unknown>) => {
    const sessions = doc.sessions as Record<
      string,
      { snapshot: { groups: Record<string, unknown>[] } }
    >;
    return Object.values(sessions)[0].snapshot.groups[0];
  };

  it.each([
    [
      'an empty group id',
      (d: Record<string, unknown>) => {
        routineGroup(d).groupId = '';
      },
    ],
    [
      'fewer than two slots',
      (d: Record<string, unknown>) => {
        routineGroup(d).slotIds = ['day1-s0'];
      },
    ],
    [
      'duplicate slot ids',
      (d: Record<string, unknown>) => {
        routineGroup(d).slotIds = ['day1-s0', 'day1-s0'];
      },
    ],
    [
      'a missing referenced slot',
      (d: Record<string, unknown>) => {
        routineGroup(d).slotIds = ['day1-s0', 'nope'];
      },
    ],
    [
      'an invalid kind',
      (d: Record<string, unknown>) => {
        routineGroup(d).kind = 'triset';
      },
    ],
    [
      'zero rounds',
      (d: Record<string, unknown>) => {
        routineGroup(d).rounds = 0;
      },
    ],
    [
      'negative rounds',
      (d: Record<string, unknown>) => {
        routineGroup(d).rounds = -2;
      },
    ],
    [
      'fractional rounds',
      (d: Record<string, unknown>) => {
        routineGroup(d).rounds = 2.5;
      },
    ],
    [
      'negative rest',
      (d: Record<string, unknown>) => {
        routineGroup(d).restBetweenExercisesSec = -1;
      },
    ],
    [
      'fractional rest',
      (d: Record<string, unknown>) => {
        routineGroup(d).restBetweenRoundsSec = 1.5;
      },
    ],
    [
      'a malformed frozen group',
      (d: Record<string, unknown>) => {
        snapshotGroup(d).rounds = 0;
      },
    ],
    [
      'a frozen group naming a missing slot',
      (d: Record<string, unknown>) => {
        snapshotGroup(d).slotIds = ['day1-s0', 'ghost'];
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const result = restore(mutate);
    expect(result.ok).toBe(false);
  });

  it('rejects two groups claiming the same exercise', () => {
    const result = restore((doc) => {
      const day = (doc.routine as { dayId: string; groups?: unknown[] }[]).find(
        (entry) => entry.dayId === DAY,
      )!;
      day.groups!.push({
        groupId: 'g2',
        kind: 'circuit',
        slotIds: ['day1-s1', 'day1-s2'],
        rounds: 2,
      });
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('day1-s1');
  });

  it('rejects duplicate group ids', () => {
    const result = restore((doc) => {
      const day = (doc.routine as { dayId: string; groups?: unknown[] }[]).find(
        (entry) => entry.dayId === DAY,
      )!;
      day.groups!.push({
        groupId: 'g1',
        kind: 'circuit',
        slotIds: ['day1-s2', 'day1-s3'],
        rounds: 2,
      });
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Duplicate group id');
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects %s rounds, which JSON carries as null', (_label, rounds) => {
    // JSON.stringify writes both as `null`, which is not a number at all.
    const result = restore((d) => {
      routineGroup(d).rounds = rounds;
    });
    expect(result.ok).toBe(false);
  });

  it('rejects impossible persisted group progress', () => {
    const result = restore((doc) => {
      const sessions = doc.sessions as Record<string, Record<string, unknown>>;
      Object.values(sessions)[0].groupProgress = { g1: 99 };
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('rounds');
  });

  it.each([
    ['a negative round count', -1],
    ['a fractional round count', 1.5],
  ])('rejects group progress with %s', (_label, value) => {
    const result = restore((doc) => {
      const sessions = doc.sessions as Record<string, Record<string, unknown>>;
      Object.values(sessions)[0].groupProgress = { g1: value };
    });
    expect(result.ok).toBe(false);
  });

  it('rejects progress recorded for a group that does not exist', () => {
    const result = restore((doc) => {
      const sessions = doc.sessions as Record<string, Record<string, unknown>>;
      Object.values(sessions)[0].groupProgress = { ghost: 1 };
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('ghost');
  });

  it('accepts progress a session could actually have reached', () => {
    const result = restore((doc) => {
      const sessions = doc.sessions as Record<string, Record<string, unknown>>;
      Object.values(sessions)[0].groupProgress = { g1: 2 };
    });
    expect(result.ok).toBe(true);
  });

  it('leaves stored data untouched when a group fails to parse', () => {
    const { state } = withGroup();
    const before = JSON.stringify(state);
    const result = restore((d) => {
      routineGroup(d).rounds = 0;
    });
    expect(result.ok).toBe(false);
    // Parsing is pure: the state it was built from is byte-identical after.
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('migration compatibility', () => {
  it('gives a v4 document empty groups rather than inventing them', () => {
    const v4 = {
      schemaVersion: 4,
      programVersion: 1,
      unit: 'lb',
      weeks: {
        [WEEK]: {
          days: {
            day1: {
              exercises: {
                'day1-s0': {
                  movementId: 'barbell-bench-press',
                  sets: [{ weight: '100', reps: '5', rpe: '' }],
                },
              },
            },
          },
          completion: {},
        },
      },
      routine: emptyState().routine,
      movements: emptyState().movements,
    };
    const result = parseBackup(v4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = Object.values(result.state.sessions)[0];
    expect(session.snapshot?.groups).toEqual([]);
    expect(session.groupProgress).toBeUndefined();
  });

  it('accepts a v5 document written before groups existed', () => {
    const { state, sessionId } = withGroup();
    const doc = JSON.parse(JSON.stringify(buildBackup(state))) as Record<
      string,
      unknown
    >;
    const day = (doc.routine as { dayId: string; groups?: unknown[] }[]).find(
      (entry) => entry.dayId === DAY,
    )!;
    delete day.groups;
    const sessions = doc.sessions as Record<
      string,
      { snapshot: Record<string, unknown> }
    >;
    delete sessions[sessionId].snapshot.groups;

    const result = parseBackup(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.sessions[sessionId].snapshot?.groups).toEqual([]);
    expect(findDay(result.state.routine, DAY)?.groups).toBeUndefined();
  });
});

describe('failure isolation', () => {
  it('derives progress from a session that has no logs at all', () => {
    expect(() => deriveGroupProgress(group(), undefined)).not.toThrow();
    expect(deriveGroupProgress(group(), undefined).completedRounds).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -3])(
    'never reads a group with %p rounds as complete',
    (rounds) => {
      const p = deriveGroupProgress(group({ rounds }), {});
      expect(p.complete).toBe(false);
      expect(p.totalRounds).toBeGreaterThanOrEqual(1);
      expect(p.currentRound).toBe(1);
    },
  );

  it('chooses a rest even when the group is unknown to the snapshot', () => {
    expect(restForCompletion(undefined, undefined, 'day1-s0', 0, 90)).toEqual({
      sec: 90,
      boundary: 'none',
    });
  });

  it('logging a set does not depend on any group being valid', () => {
    const base = emptyState();
    // A day carrying a group the validator would refuse: logging still works,
    // because the log path never consults groups.
    const broken: WorkoutState = {
      ...base,
      routine: base.routine.map((day) =>
        day.dayId === DAY
          ? { ...day, groups: [group({ rounds: 0, slotIds: ['ghost'] })] }
          : day,
      ),
    };
    const { state, sessionId } = ensureWeekDaySession(broken, WEEK, DAY, WEEK);
    const logged = log(state, sessionId, 'day1-s0', [done()]);
    expect(logged.sessions[sessionId].exercises['day1-s0'].sets).toHaveLength(
      1,
    );
    // And the broken group never reaches the frozen snapshot.
    expect(logged.sessions[sessionId].snapshot?.groups).toEqual([]);
  });
});
