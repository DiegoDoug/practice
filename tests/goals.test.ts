/**
 * Exercise goals.
 *
 * A goal is a claim about a single set: "one working set, this heavy, for this
 * many reps". The tests below pin the three things that make that claim
 * trustworthy — it cannot be assembled from two easier sets, it is compared in
 * physical magnitude rather than in whichever unit happened to be typed, and it
 * is DERIVED from the logs, so correcting history corrects the goal with it.
 */
import { describe, expect, it } from 'vitest';
import { buildBackup, emptyState, parseBackupJson } from '@/lib/backup';
import {
  archiveGoal,
  createGoal,
  deleteGoal,
  goalProgress,
  goalSide,
  listGoals,
  newGoalId,
  unarchiveGoal,
  updateGoal,
} from '@/lib/goals';
import type { Goal, SetEntry, WorkoutSession, WorkoutState } from '@/lib/types';

const BENCH = 'barbell-bench-press';
const PULLUP = 'wide-grip-pull-ups';
const SPLIT = 'bulgarian-split-squat';

let counter = 0;
const set = (patch: Partial<SetEntry> & { weight: string; reps: string }) => ({
  setId: `s${(counter += 1)}`,
  rpe: '',
  done: true,
  ...patch,
});

const logged = (
  sessionId: string,
  date: string,
  movementId: string,
  sets: SetEntry[],
  extra: { unilateral?: boolean; unit?: 'kg' | 'lb' } = {},
): WorkoutSession => ({
  sessionId,
  routineDayId: 'day1',
  status: 'completed',
  performedDate: date,
  exercises: {
    slot: {
      movementId,
      ...(extra.unilateral ? { unilateral: true } : {}),
      ...(extra.unit ? { unit: extra.unit } : {}),
      sets,
    },
  },
});

// Targets below are written in kilos, so the document is a kilo document: a
// log with no unit of its own inherits it, exactly as `eligibleSets` does.
const stateWith = (...sessions: WorkoutSession[]): WorkoutState => ({
  ...emptyState(),
  unit: 'kg',
  sessions: Object.fromEntries(sessions.map((s) => [s.sessionId, s])),
});

const goal = (patch: Partial<Goal> = {}): Goal => ({
  goalId: 'g1',
  movementId: BENCH,
  targetWeight: 100,
  targetReps: 5,
  unit: 'kg',
  createdAt: '2026-01-01',
  ...patch,
});

describe('goal identity and shape', () => {
  it('mints ids that do not collide', () => {
    const ids = new Set(Array.from({ length: 300 }, () => newGoalId()));
    expect(ids.size).toBe(300);
  });

  it('reads an absent side as bilateral', () => {
    expect(goalSide(goal())).toBe('bilateral');
    expect(goalSide(goal({ side: 'left' }))).toBe('left');
  });

  it('records the unit the target was set in', () => {
    const created = createGoal(emptyState(), {
      movementId: BENCH,
      targetWeight: 225,
      targetReps: 5,
      unit: 'lb',
    });
    expect(created.goal.unit).toBe('lb');
    expect(created.state.goals?.[created.goal.goalId]).toEqual(created.goal);
  });

  it('stores the logging mode so a later library edit cannot rewrite it', () => {
    const created = createGoal(emptyState(), {
      movementId: PULLUP,
      targetWeight: 0,
      targetReps: 12,
      unit: 'kg',
    });
    expect(created.goal.mode).toBe('bodyweight');
  });
});

describe('one set must meet both targets together', () => {
  it('does not accept a heavy set and a light set jointly', () => {
    // 100 kg for 3, and 80 kg for 8. Neither is 100 kg for 5.
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '100', reps: '3' }),
        set({ weight: '80', reps: '8' }),
      ]),
    );
    const progress = goalProgress(state, goal());
    expect(progress.achieved).toBe(false);
    expect(progress.achievedBy).toBeNull();
  });

  it('accepts one set meeting both at once', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })]),
    );
    expect(goalProgress(state, goal()).achieved).toBe(true);
  });

  it('accepts a set that exceeds both targets', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '105', reps: '6' })]),
    );
    expect(goalProgress(state, goal()).achieved).toBe(true);
  });

  it('reports each dimension separately rather than one blended figure', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '100', reps: '3' }),
        set({ weight: '80', reps: '8' }),
      ]),
    );
    const progress = goalProgress(state, goal());
    // The heaviest carried for at least 5 reps, and the most reps at 100 kg+.
    expect(progress.bestWeightAtTargetReps?.load.value).toBe(80);
    expect(progress.bestRepsAtTargetWeight?.reps).toBe(3);
  });

  it('leaves both readings null when nothing reaches either target', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '60', reps: '3' })]),
    );
    const progress = goalProgress(state, goal());
    expect(progress.bestWeightAtTargetReps).toBeNull();
    expect(progress.bestRepsAtTargetWeight).toBeNull();
    expect(progress.achieved).toBe(false);
  });
});

describe('units are compared by magnitude, never by the number typed', () => {
  it('satisfies a kilo goal with a pound set of equal weight', () => {
    // 225 lb is about 102 kg, so it clears a 100 kg target.
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '225', reps: '5' })], {
        unit: 'lb',
      }),
    );
    expect(goalProgress(state, goal()).achieved).toBe(true);
  });

  it('does not satisfy it with a pound set that is genuinely lighter', () => {
    // 215 lb is about 97.5 kg — a bigger number, a smaller lift.
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '215', reps: '5' })], {
        unit: 'lb',
      }),
    );
    expect(goalProgress(state, goal()).achieved).toBe(false);
  });

  it('is unaffected by the display preference', () => {
    const base = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })], {
        unit: 'kg',
      }),
    );
    const inPounds: WorkoutState = { ...base, unit: 'lb' };
    const inKilos: WorkoutState = { ...base, unit: 'kg' };
    expect(goalProgress(inPounds, goal()).achieved).toBe(true);
    expect(goalProgress(inKilos, goal()).achieved).toBe(true);
  });
});

describe('sides are kept apart', () => {
  const unilateralState = () =>
    stateWith(
      logged(
        'a',
        '2026-03-02',
        SPLIT,
        [
          set({
            weight: '40',
            reps: '8',
            right: { weight: '30', reps: '8', rpe: '' },
          }),
        ],
        { unilateral: true },
      ),
    );

  const sideGoal = (side: 'left' | 'right') =>
    goal({ movementId: SPLIT, targetWeight: 40, targetReps: 8, side });

  it('satisfies the stronger side only', () => {
    expect(goalProgress(unilateralState(), sideGoal('left')).achieved).toBe(
      true,
    );
    expect(goalProgress(unilateralState(), sideGoal('right')).achieved).toBe(
      false,
    );
  });

  it('never satisfies a bilateral goal from a unilateral set', () => {
    // 40 + 30 is not a 70 kg bilateral lift, and no such measurement exists.
    const bilateral = goal({
      movementId: SPLIT,
      targetWeight: 40,
      targetReps: 8,
    });
    expect(goalProgress(unilateralState(), bilateral).achieved).toBe(false);
  });
});

describe('history already on record counts', () => {
  it('marks a goal achieved by a set performed before it was created', () => {
    const state = stateWith(
      logged('old', '2025-11-04', BENCH, [set({ weight: '100', reps: '5' })]),
    );
    const progress = goalProgress(state, goal({ createdAt: '2026-01-01' }));
    expect(progress.achieved).toBe(true);
    expect(progress.achievedBy?.sessionId).toBe('old');
    // …and says plainly that it was already done, rather than implying the
    // athlete achieved it since setting the goal.
    expect(progress.achievedRelativeToGoal).toBe('before');
    expect(progress.achievedOn).toBe('2025-11-04');
  });

  it('does not claim a later achievement was pre-existing', () => {
    const state = stateWith(
      logged('new', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })]),
    );
    const progress = goalProgress(state, goal({ createdAt: '2026-01-01' }));
    expect(progress.achieved).toBe(true);
    expect(progress.achievedRelativeToGoal).toBe('after');
  });

  it('credits the earliest qualifying set, so the date does not drift', () => {
    const state = stateWith(
      logged('first', '2026-02-01', BENCH, [set({ weight: '100', reps: '5' })]),
      logged('later', '2026-03-02', BENCH, [set({ weight: '110', reps: '6' })]),
    );
    expect(goalProgress(state, goal()).achievedOn).toBe('2026-02-01');
  });

  it('treats an undated legacy set as pre-existing rather than guessing', () => {
    const state = stateWith({
      sessionId: 'legacy',
      routineDayId: 'day1',
      status: 'completed',
      legacyWeekKey: '2025-06-02',
      exercises: {
        slot: { movementId: BENCH, sets: [set({ weight: '100', reps: '5' })] },
      },
    });
    const progress = goalProgress(state, goal());
    expect(progress.achieved).toBe(true);
    expect(progress.achievedRelativeToGoal).toBe('before');
    expect(progress.achievedOn).toBeNull();
  });
});

describe('only a completed working set can satisfy a goal', () => {
  it('ignores a set that was never ticked', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '100', reps: '5', done: false }),
      ]),
    );
    expect(goalProgress(state, goal()).achieved).toBe(false);
  });

  it('ignores a warmup and a drop set, as records do', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '100', reps: '5', kind: 'warmup' }),
        set({ weight: '100', reps: '5', kind: 'drop' }),
      ]),
    );
    expect(goalProgress(state, goal()).achieved).toBe(false);
  });

  it('accepts a working set taken to failure', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '100', reps: '5', reachedFailure: true }),
      ]),
    );
    expect(goalProgress(state, goal()).achieved).toBe(true);
  });
});

describe('bodyweight goals need no external load', () => {
  const pullupGoal = goal({
    movementId: PULLUP,
    targetWeight: 0,
    targetReps: 12,
    mode: 'bodyweight',
  });

  it('is satisfied by reps alone, with the weight field left empty', () => {
    const state = stateWith(
      logged('a', '2026-03-02', PULLUP, [set({ weight: '', reps: '12' })]),
    );
    expect(goalProgress(state, pullupGoal).achieved).toBe(true);
  });

  it('is not satisfied by fewer reps', () => {
    const state = stateWith(
      logged('a', '2026-03-02', PULLUP, [set({ weight: '', reps: '11' })]),
    );
    expect(goalProgress(state, pullupGoal).achieved).toBe(false);
  });

  it('still lets a weighted target require the added load', () => {
    const weighted = goal({
      movementId: PULLUP,
      targetWeight: 20,
      targetReps: 5,
      mode: 'bodyweight',
    });
    const bodyweightOnly = stateWith(
      logged('a', '2026-03-02', PULLUP, [set({ weight: '', reps: '5' })]),
    );
    expect(goalProgress(bodyweightOnly, weighted).achieved).toBe(false);

    const withBelt = stateWith(
      logged('a', '2026-03-02', PULLUP, [set({ weight: '20', reps: '5' })]),
    );
    expect(goalProgress(withBelt, weighted).achieved).toBe(true);
  });
});

describe('achievement is derived, so a correction corrects it', () => {
  const achievedState = () =>
    stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ setId: 'hit', weight: '100', reps: '5' }),
      ]),
    );

  const withSets = (state: WorkoutState, sets: SetEntry[]): WorkoutState => ({
    ...state,
    sessions: {
      ...state.sessions,
      a: {
        ...state.sessions.a,
        exercises: {
          slot: { ...state.sessions.a.exercises.slot, sets },
        },
      },
    },
  });

  it('drops the achievement when the qualifying set is reopened', () => {
    const state = achievedState();
    expect(goalProgress(state, goal()).achieved).toBe(true);
    const reopened = withSets(state, [
      { setId: 'hit', weight: '100', reps: '5', rpe: '' },
    ]);
    expect(goalProgress(reopened, goal()).achieved).toBe(false);
  });

  it('drops it when the set is edited below the target', () => {
    const edited = withSets(achievedState(), [
      { setId: 'hit', weight: '95', reps: '5', rpe: '', done: true },
    ]);
    expect(goalProgress(edited, goal()).achieved).toBe(false);
  });

  it('drops it when the set is deleted', () => {
    expect(goalProgress(withSets(achievedState(), []), goal()).achieved).toBe(
      false,
    );
  });

  it('drops it when the goal is edited to ask for more', () => {
    const state = achievedState();
    const harder = goal({ targetWeight: 110 });
    expect(goalProgress(state, harder).achieved).toBe(false);
    const moreReps = goal({ targetReps: 6 });
    expect(goalProgress(state, moreReps).achieved).toBe(false);
  });

  it('regains it when the goal is edited back down', () => {
    const state = achievedState();
    expect(goalProgress(state, goal({ targetWeight: 90 })).achieved).toBe(true);
  });
});

describe('creating, editing, archiving and deleting', () => {
  const seeded = (): WorkoutState => {
    const { state } = createGoal(
      stateWith(
        logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })]),
      ),
      { movementId: BENCH, targetWeight: 120, targetReps: 5, unit: 'kg' },
      '2026-03-01',
      'g1',
    );
    return state;
  };

  it('creates a goal without touching workout history', () => {
    const before = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })]),
    );
    const { state } = createGoal(
      before,
      { movementId: BENCH, targetWeight: 120, targetReps: 5, unit: 'kg' },
      '2026-03-01',
    );
    expect(state.sessions).toEqual(before.sessions);
    expect(before.goals).toBeUndefined();
  });

  it('edits targets in place, keeping the id and the creation date', () => {
    const edited = updateGoal(seeded(), 'g1', { targetWeight: 100 });
    expect(edited.goals?.g1.goalId).toBe('g1');
    expect(edited.goals?.g1.createdAt).toBe('2026-03-01');
    expect(edited.goals?.g1.targetWeight).toBe(100);
    // And the edit is what decides achievement, immediately.
    expect(goalProgress(edited, edited.goals!.g1).achieved).toBe(true);
  });

  it('refuses to edit a goal that is not there, rather than inventing one', () => {
    const state = seeded();
    expect(updateGoal(state, 'missing', { targetReps: 3 })).toBe(state);
  });

  it('archives and unarchives without deleting anything', () => {
    const before = seeded();
    const archived = archiveGoal(before, 'g1');
    expect(archived.goals?.g1.archived).toBe(true);
    expect(archived.sessions).toEqual(before.sessions);
    expect(unarchiveGoal(archived, 'g1').goals?.g1.archived).toBeUndefined();
  });

  it('keeps an archived goal out of the active list but available on request', () => {
    const archived = archiveGoal(seeded(), 'g1');
    expect(listGoals(archived).map((g) => g.goalId)).toEqual([]);
    expect(
      listGoals(archived, { includeArchived: true }).map((g) => g.goalId),
    ).toEqual(['g1']);
  });

  it('still reports progress for an archived goal', () => {
    const archived = archiveGoal(
      updateGoal(seeded(), 'g1', { targetWeight: 100 }),
      'g1',
    );
    expect(goalProgress(archived, archived.goals!.g1).achieved).toBe(true);
  });

  it('deletes a goal without touching the history that met it', () => {
    const state = seeded();
    const deleted = deleteGoal(state, 'g1');
    expect(deleted.goals?.g1).toBeUndefined();
    expect(deleted.sessions).toEqual(state.sessions);
  });

  it('orders goals oldest first, then by movement, deterministically', () => {
    let state = emptyState();
    state = createGoal(
      state,
      { movementId: PULLUP, targetWeight: 0, targetReps: 12, unit: 'kg' },
      '2026-02-01',
      'later',
    ).state;
    state = createGoal(
      state,
      { movementId: BENCH, targetWeight: 100, targetReps: 5, unit: 'kg' },
      '2026-01-01',
      'earlier',
    ).state;
    expect(listGoals(state).map((g) => g.goalId)).toEqual(['earlier', 'later']);
  });
});

describe('goals survive a backup round trip', () => {
  it('restores every field, including the mode and the archived flag', () => {
    let state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })]),
    );
    state = createGoal(
      state,
      { movementId: BENCH, targetWeight: 100, targetReps: 5, unit: 'kg' },
      '2026-01-01',
      'kept',
    ).state;
    state = createGoal(
      state,
      {
        movementId: SPLIT,
        targetWeight: 40,
        targetReps: 8,
        unit: 'lb',
        side: 'left',
      },
      '2026-01-02',
      'sided',
    ).state;
    state = archiveGoal(state, 'sided');

    const parsed = parseBackupJson(JSON.stringify(buildBackup(state)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.goals).toEqual(state.goals);
    // And the restored goal reads the same achievement as before the trip.
    expect(goalProgress(parsed.state, parsed.state.goals!.kept).achieved).toBe(
      true,
    );
  });

  it('round-trips a document with no goals at all', () => {
    const parsed = parseBackupJson(JSON.stringify(buildBackup(emptyState())));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.goals).toBeUndefined();
  });
});

describe('a same-day achievement is not classified as either', () => {
  // Neither side of the comparison records a time: a goal carries a local DATE
  // and a completed set carries `doneAt` only when it was ticked in this app.
  // Claiming an order would mean inventing one, so the day the goal was set is
  // reported as unknown rather than resolved by a manufactured timestamp.
  const sameDay = () =>
    stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })]),
    );

  it('reports the ordering as unknown when the set lands on the creation date', () => {
    const progress = goalProgress(sameDay(), goal({ createdAt: '2026-03-02' }));
    expect(progress.achieved).toBe(true);
    expect(progress.achievedRelativeToGoal).toBe('unknown');
  });

  it('still resolves a set from an earlier day as before', () => {
    expect(
      goalProgress(sameDay(), goal({ createdAt: '2026-03-03' }))
        .achievedRelativeToGoal,
    ).toBe('before');
  });

  it('still resolves a set from a later day as after', () => {
    expect(
      goalProgress(sameDay(), goal({ createdAt: '2026-03-01' }))
        .achievedRelativeToGoal,
    ).toBe('after');
  });

  it('calls undated legacy history before, which is what it is', () => {
    const state = stateWith({
      sessionId: 'legacy',
      routineDayId: 'day1',
      status: 'completed',
      legacyWeekKey: '2025-06-02',
      exercises: {
        slot: { movementId: BENCH, sets: [set({ weight: '100', reps: '5' })] },
      },
    });
    expect(goalProgress(state, goal()).achievedRelativeToGoal).toBe('before');
  });

  it('reports nothing at all when the goal is unmet', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '60', reps: '5' })]),
    );
    expect(goalProgress(state, goal()).achievedRelativeToGoal).toBeNull();
  });
});

describe('the stored mode is what evaluation and editing use', () => {
  const pullupGoal = goal({
    movementId: PULLUP,
    targetWeight: 0,
    targetReps: 12,
    mode: 'bodyweight',
  });

  /** The library reclassifies the movement as a loaded one, after the fact. */
  const relabelled = (state: WorkoutState): WorkoutState => ({
    ...state,
    movements: {
      ...state.movements,
      [PULLUP]: { ...state.movements[PULLUP], equipment: 'barbell' },
    },
  });

  it('keeps a bodyweight goal reachable after the library is edited', () => {
    const state = stateWith(
      logged('a', '2026-03-02', PULLUP, [set({ weight: '', reps: '12' })]),
    );
    expect(goalProgress(state, pullupGoal).achieved).toBe(true);
    // The blank weight still means zero added load, because the GOAL says the
    // movement is a bodyweight one — not because the library still says so.
    expect(goalProgress(relabelled(state), pullupGoal).achieved).toBe(true);
  });

  it('falls back to the library only when the goal stored no mode', () => {
    const state = stateWith(
      logged('a', '2026-03-02', PULLUP, [set({ weight: '', reps: '12' })]),
    );
    const legacyGoal = goal({
      movementId: PULLUP,
      targetWeight: 0,
      targetReps: 12,
    });
    delete (legacyGoal as { mode?: unknown }).mode;
    expect(goalProgress(state, legacyGoal).achieved).toBe(true);
    expect(goalProgress(relabelled(state), legacyGoal).achieved).toBe(false);
  });

  it('leaves the mode alone when an edit does not mention it', () => {
    const { state } = createGoal(
      emptyState(),
      { movementId: PULLUP, targetWeight: 0, targetReps: 12, unit: 'kg' },
      '2026-01-01',
      'g1',
    );
    expect(state.goals?.g1.mode).toBe('bodyweight');
    const edited = updateGoal(state, 'g1', { targetReps: 15 });
    expect(edited.goals?.g1.mode).toBe('bodyweight');
  });

  it('refuses to erase the mode with an explicit undefined', () => {
    const { state } = createGoal(
      emptyState(),
      { movementId: PULLUP, targetWeight: 0, targetReps: 12, unit: 'kg' },
      '2026-01-01',
      'g1',
    );
    const edited = updateGoal(state, 'g1', { mode: undefined });
    expect(edited.goals?.g1.mode).toBe('bodyweight');
  });

  it('does change the mode when the edit names one', () => {
    const { state } = createGoal(
      emptyState(),
      { movementId: PULLUP, targetWeight: 0, targetReps: 12, unit: 'kg' },
      '2026-01-01',
      'g1',
    );
    expect(updateGoal(state, 'g1', { mode: 'external' }).goals?.g1.mode).toBe(
      'external',
    );
  });
});

describe('v5 rejects a goal that is not a goal', () => {
  const withGoal = (patch: Record<string, unknown>) => {
    const backup = buildBackup(emptyState());
    return JSON.stringify({
      ...backup,
      goals: {
        g1: {
          goalId: 'g1',
          movementId: BENCH,
          targetWeight: 100,
          targetReps: 5,
          unit: 'kg',
          createdAt: '2026-01-01',
          ...patch,
        },
      },
    });
  };

  it('accepts a well-formed goal', () => {
    expect(parseBackupJson(withGoal({})).ok).toBe(true);
  });

  const rejected: [string, Record<string, unknown>][] = [
    ['a negative target weight', { targetWeight: -5 }],
    ['a target weight that is not finite', { targetWeight: Number.NaN }],
    ['zero target reps', { targetReps: 0 }],
    ['fractional target reps', { targetReps: 2.5 }],
    ['negative target reps', { targetReps: -3 }],
    ['an empty goal id', { goalId: '' }],
    ['an empty movement id', { movementId: '' }],
    ['a creation date that is not a date', { createdAt: 'yesterday' }],
    ['a malformed creation date', { createdAt: '2026-1-1' }],
    ['an unknown mode', { mode: 'assisted' }],
    ['an unknown side', { side: 'both' }],
  ];

  for (const [label, patch] of rejected) {
    it(`rejects ${label}`, () => {
      const parsed = parseBackupJson(withGoal(patch));
      expect(parsed.ok).toBe(false);
    });
  }

  it('rejects the whole file rather than dropping the bad goal silently', () => {
    // Losing a goal without saying so would be worse than refusing the import:
    // the athlete would believe it had been restored.
    const parsed = parseBackupJson(withGoal({ targetReps: 0 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('not valid');
  });
});
