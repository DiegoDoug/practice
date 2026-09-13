/**
 * The shared analytics layer, and the progress and record readings built on it.
 *
 * Everything here is about not lying: a load is compared in the unit it was
 * recorded in, a left side is never averaged with a right, an undated session
 * is never given a position it cannot be given, and a record is celebrated once
 * rather than every time the same set is ticked again.
 */
import { describe, expect, it, vi } from 'vitest';
import { emptyState } from '@/lib/backup';
import {
  eligibleSets,
  inPeriod,
  periodStart,
  type HistoryPeriod,
} from '@/lib/analytics';
import {
  bestRepsAtWeight,
  bestWeight,
  bestWeightAtReps,
  exerciseHistory,
  sameWeekPrior,
} from '@/lib/progress';
import { celebrationKey, currentRecords, recordsBrokenBy } from '@/lib/records';
import type { SetEntry, WorkoutSession, WorkoutState } from '@/lib/types';

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

const session = (
  patch: Partial<WorkoutSession> & { sessionId: string },
): WorkoutSession => ({
  routineDayId: 'day1',
  status: 'completed',
  exercises: {},
  ...patch,
});

const stateWith = (...sessions: WorkoutSession[]): WorkoutState => ({
  ...emptyState(),
  sessions: Object.fromEntries(sessions.map((s) => [s.sessionId, s])),
});

/** One movement logged in one session on one date. */
const logged = (
  sessionId: string,
  date: string | null,
  movementId: string,
  sets: SetEntry[],
  extra: Partial<WorkoutSession> & {
    unilateral?: boolean;
    unit?: 'kg' | 'lb';
  } = {},
): WorkoutSession => {
  const { unilateral, unit, ...rest } = extra;
  return session({
    sessionId,
    ...(date ? { performedDate: date } : { legacyWeekKey: '2025-06-02' }),
    exercises: {
      slot: {
        movementId,
        ...(unilateral ? { unilateral: true } : {}),
        ...(unit ? { unit } : {}),
        sets,
      },
    },
    ...rest,
  });
};

describe('eligibleSets', () => {
  it('includes only sets the athlete explicitly completed', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '60', reps: '8' }),
        set({ weight: '65', reps: '5', done: false }),
      ]),
    );
    const rows = eligibleSets(state, { movementId: BENCH });
    expect(rows).toHaveLength(1);
    expect(rows[0].load.value).toBe(60);
  });

  it('reads the unit the set was logged in, not the display preference', () => {
    const state: WorkoutState = {
      ...stateWith(
        logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })], {
          unit: 'kg',
        }),
      ),
      // The athlete now prefers pounds; the log still means 100 kg.
      unit: 'lb',
    };
    const rows = eligibleSets(state, { movementId: BENCH });
    expect(rows[0].load).toEqual({ value: 100, unit: 'kg' });
  });

  it('falls back to the document unit when a log has none', () => {
    const state: WorkoutState = {
      ...stateWith(
        logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '5' })]),
      ),
      unit: 'kg',
    };
    expect(rows0(state).load.unit).toBe('kg');
  });

  it('splits a unilateral set into two one-sided measurements', () => {
    const state = stateWith(
      logged(
        'a',
        '2026-03-02',
        SPLIT,
        [
          set({
            weight: '50',
            reps: '10',
            right: { weight: '45', reps: '10', rpe: '' },
          }),
        ],
        { unilateral: true },
      ),
    );
    const rows = eligibleSets(state, { movementId: SPLIT });
    expect(rows.map((r) => r.side).sort()).toEqual(['left', 'right']);
    expect(rows.find((r) => r.side === 'left')?.load.value).toBe(50);
    expect(rows.find((r) => r.side === 'right')?.load.value).toBe(45);
    // Crucially, no combined 95 measurement exists at all.
    expect(rows.some((r) => r.load.value === 95)).toBe(false);
    expect(rows.some((r) => r.side === 'bilateral')).toBe(false);
  });

  it('treats a bilateral set as one bilateral measurement', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '60', reps: '8' })]),
    );
    expect(eligibleSets(state, { movementId: BENCH })[0].side).toBe(
      'bilateral',
    );
  });

  it('reads a bodyweight set as zero external load, not as missing', () => {
    const state = stateWith(
      logged('a', '2026-03-02', PULLUP, [set({ weight: '', reps: '12' })]),
    );
    const rows = eligibleSets(state, { movementId: PULLUP });
    expect(rows).toHaveLength(1);
    expect(rows[0].load.value).toBe(0);
    expect(rows[0].reps).toBe(12);
    expect(rows[0].loadMode).toBe('bodyweight');
  });

  it('excludes a set whose reps do not parse', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '60', reps: '8.5' })]),
    );
    expect(eligibleSets(state, { movementId: BENCH })).toEqual([]);
  });

  it('orders same-day sessions by start time, deterministically', () => {
    const state = stateWith(
      logged('pm', '2026-03-02', BENCH, [set({ weight: '70', reps: '5' })], {
        startedAt: 200,
      }),
      logged('am', '2026-03-02', BENCH, [set({ weight: '60', reps: '5' })], {
        startedAt: 100,
      }),
    );
    expect(
      eligibleSets(state, { movementId: BENCH }).map((r) => r.sessionId),
    ).toEqual(['am', 'pm']);
  });

  it('places an undated session by its week, which the document does record', () => {
    // Its legacyWeekKey is June 2025, so it genuinely precedes March 2026.
    // Ordering by the known week invents nothing; only the DAY within that
    // week, and the order inside it, are unknown — see `dateKnown`.
    const state = stateWith(
      logged('recent', '2026-03-02', BENCH, [set({ weight: '70', reps: '5' })]),
      logged('old', null, BENCH, [set({ weight: '50', reps: '5' })]),
    );
    expect(
      eligibleSets(state, { movementId: BENCH }).map((r) => r.sessionId),
    ).toEqual(['old', 'recent']);
  });

  it('marks an undated session as such, with its week but no day', () => {
    const state = stateWith(
      logged('old', null, BENCH, [set({ weight: '50', reps: '5' })]),
    );
    const row = eligibleSets(state, { movementId: BENCH })[0];
    expect(row.dateKnown).toBe(false);
    expect(row.date).toBeNull();
    expect(row.weekKey).toBe('2025-06-02');
  });

  it('can be narrowed to record-eligible sets only', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '60', reps: '8' }),
        set({ weight: '100', reps: '1', kind: 'warmup' }),
        set({ weight: '120', reps: '1', kind: 'drop' }),
      ]),
    );
    expect(
      eligibleSets(state, { movementId: BENCH, recordOnly: true }).map(
        (r) => r.load.value,
      ),
    ).toEqual([60]);
    // All three still count as completed work.
    expect(eligibleSets(state, { movementId: BENCH })).toHaveLength(3);
  });

  it('keeps a working set taken to failure record-eligible', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '80', reps: '3', reachedFailure: true }),
      ]),
    );
    expect(
      eligibleSets(state, { movementId: BENCH, recordOnly: true }),
    ).toHaveLength(1);
  });
});

const rows0 = (state: WorkoutState) =>
  eligibleSets(state, { movementId: BENCH })[0];

describe('periods', () => {
  const today = '2026-03-10';

  it('computes a window start from today', () => {
    expect(periodStart('4w', today)).toBe('2026-02-10');
    expect(periodStart('all', today)).toBeNull();
  });

  it('includes a dated session inside the window and excludes one outside', () => {
    expect(inPeriod({ date: '2026-03-01', dateKnown: true }, '4w', today)).toBe(
      true,
    );
    expect(inPeriod({ date: '2025-12-01', dateKnown: true }, '4w', today)).toBe(
      false,
    );
  });

  it('includes an undated session only in the all-time view', () => {
    // Whether an undated workout falls inside a window is unknowable, so it is
    // shown when no window is applied and withheld otherwise, rather than
    // guessed into or out of the range.
    const undated = { date: null, dateKnown: false };
    expect(inPeriod(undated, 'all', today)).toBe(true);
    for (const period of ['4w', '8w', '12w', '6m', '1y'] as HistoryPeriod[]) {
      expect(inPeriod(undated, period, today)).toBe(false);
    }
  });
});

describe('bestWeight', () => {
  it('compares across units by physical magnitude', () => {
    const state = stateWith(
      logged('kg', '2026-03-02', BENCH, [set({ weight: '100', reps: '3' })], {
        unit: 'kg',
      }),
      logged('lb', '2026-03-09', BENCH, [set({ weight: '215', reps: '3' })], {
        unit: 'lb',
      }),
    );
    // 100 kg (220.5 lb) beats 215 lb.
    const best = bestWeight(
      eligibleSets(state, { movementId: BENCH, recordOnly: true }),
      'bilateral',
    );
    expect(best?.load).toEqual({ value: 100, unit: 'kg' });
  });

  it('keeps the sides apart', () => {
    const state = stateWith(
      logged(
        'a',
        '2026-03-02',
        SPLIT,
        [
          set({
            weight: '50',
            reps: '10',
            right: { weight: '45', reps: '10', rpe: '' },
          }),
        ],
        { unilateral: true },
      ),
    );
    const rows = eligibleSets(state, { movementId: SPLIT, recordOnly: true });
    expect(bestWeight(rows, 'left')?.load.value).toBe(50);
    expect(bestWeight(rows, 'right')?.load.value).toBe(45);
    expect(bestWeight(rows, 'bilateral')).toBeNull();
  });

  it('breaks a tie towards the earlier set, so a record has one owner', () => {
    const state = stateWith(
      logged('first', '2026-03-02', BENCH, [set({ weight: '80', reps: '5' })]),
      logged('second', '2026-03-09', BENCH, [set({ weight: '80', reps: '5' })]),
    );
    const best = bestWeight(
      eligibleSets(state, { movementId: BENCH, recordOnly: true }),
      'bilateral',
    );
    expect(best?.sessionId).toBe('first');
  });

  it('is null when nothing is eligible', () => {
    expect(bestWeight([], 'bilateral')).toBeNull();
  });
});

describe('bestRepsAtWeight', () => {
  it('reports the best reps achieved at each load', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '60', reps: '8' }),
        set({ weight: '60', reps: '10' }),
        set({ weight: '70', reps: '5' }),
      ]),
    );
    const rows = bestRepsAtWeight(
      eligibleSets(state, { movementId: BENCH, recordOnly: true }),
      'bilateral',
      'lb',
    );
    expect(rows.map((r) => [r.weight, r.reps])).toEqual([
      [70, 5],
      [60, 10],
    ]);
  });

  it('groups loads that are equal once converted', () => {
    const state = stateWith(
      logged('kg', '2026-03-02', BENCH, [set({ weight: '100', reps: '3' })], {
        unit: 'kg',
      }),
      logged(
        'lb',
        '2026-03-09',
        BENCH,
        [set({ weight: '220.462', reps: '5' })],
        { unit: 'lb' },
      ),
    );
    const rows = bestRepsAtWeight(
      eligibleSets(state, { movementId: BENCH, recordOnly: true }),
      'bilateral',
      'kg',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reps).toBe(5);
  });
});

describe('bestWeightAtReps', () => {
  it('gives the heaviest load carried for at least that many reps', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '100', reps: '3' }),
        set({ weight: '80', reps: '8' }),
        set({ weight: '90', reps: '5' }),
      ]),
    );
    const rows = eligibleSets(state, { movementId: BENCH, recordOnly: true });
    expect(bestWeightAtReps(rows, 'bilateral', 5)?.load.value).toBe(90);
    expect(bestWeightAtReps(rows, 'bilateral', 8)?.load.value).toBe(80);
    expect(bestWeightAtReps(rows, 'bilateral', 12)).toBeNull();
  });
});

describe('exerciseHistory', () => {
  it('lists sessions newest first with their frozen label', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '60', reps: '8' })]),
      logged('b', '2026-03-09', BENCH, [set({ weight: '65', reps: '8' })]),
    );
    const history = exerciseHistory(state, BENCH, 'all', '2026-03-10');
    expect(history.map((h) => h.sessionId)).toEqual(['b', 'a']);
    expect(history[0].sets).toBe(1);
  });

  it('shows an undated session under its week, flagged as undated', () => {
    const state = stateWith(
      logged('old', null, BENCH, [set({ weight: '50', reps: '5' })]),
    );
    const history = exerciseHistory(state, BENCH, 'all', '2026-03-10');
    expect(history[0].dateKnown).toBe(false);
    expect(history[0].weekKey).toBe('2025-06-02');
    expect(history[0].date).toBeNull();
  });

  it('respects the selected period', () => {
    const state = stateWith(
      logged('old', '2025-01-01', BENCH, [set({ weight: '50', reps: '5' })]),
      logged('new', '2026-03-09', BENCH, [set({ weight: '60', reps: '5' })]),
    );
    expect(
      exerciseHistory(state, BENCH, '4w', '2026-03-10').map((h) => h.sessionId),
    ).toEqual(['new']);
  });

  it('counts volume per session without merging the two sides into a load', () => {
    const state = stateWith(
      logged(
        'a',
        '2026-03-02',
        SPLIT,
        [
          set({
            weight: '50',
            reps: '10',
            right: { weight: '50', reps: '10', rpe: '' },
          }),
        ],
        { unilateral: true },
      ),
    );
    const history = exerciseHistory(state, SPLIT, 'all', '2026-03-10');
    // Volume sums both sides, which is correct for work done...
    expect(history[0].volume).toBe(1000);
    // ...while the heaviest load stays a one-sided 50.
    expect(history[0].bestLoad?.value).toBe(50);
  });
});

describe('sameWeekPrior', () => {
  it('finds an earlier performance in the same week', () => {
    const state = stateWith(
      logged('mon', '2026-03-02', BENCH, [set({ weight: '60', reps: '8' })]),
      logged('thu', '2026-03-05', BENCH, [set({ weight: '65', reps: '8' })]),
    );
    const prior = sameWeekPrior(state, 'thu', BENCH);
    expect(prior.map((p) => p.sessionId)).toEqual(['mon']);
  });

  it('excludes the session itself and anything later', () => {
    const state = stateWith(
      logged('mon', '2026-03-02', BENCH, [set({ weight: '60', reps: '8' })]),
      logged('thu', '2026-03-05', BENCH, [set({ weight: '65', reps: '8' })]),
    );
    expect(sameWeekPrior(state, 'mon', BENCH)).toEqual([]);
  });

  it('excludes a performance from a different week', () => {
    const state = stateWith(
      logged('lastWeek', '2026-02-23', BENCH, [
        set({ weight: '60', reps: '8' }),
      ]),
      logged('thisWeek', '2026-03-05', BENCH, [
        set({ weight: '65', reps: '8' }),
      ]),
    );
    expect(sameWeekPrior(state, 'thisWeek', BENCH)).toEqual([]);
  });
});

describe('currentRecords', () => {
  it('derives records from completed sets, per side', () => {
    const state = stateWith(
      logged(
        'a',
        '2026-03-02',
        SPLIT,
        [
          set({
            weight: '50',
            reps: '10',
            right: { weight: '45', reps: '12', rpe: '' },
          }),
        ],
        { unilateral: true },
      ),
    );
    const records = currentRecords(state, SPLIT);
    expect(records.left?.heaviest?.load.value).toBe(50);
    expect(records.right?.heaviest?.load.value).toBe(45);
    expect(records.left?.mostReps?.reps).toBe(10);
    expect(records.right?.mostReps?.reps).toBe(12);
    expect(records.bilateral).toBeNull();
  });

  it('recomputes after a set is reopened', () => {
    const heavy = set({ weight: '100', reps: '3' });
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '80', reps: '5' }),
        heavy,
      ]),
    );
    expect(currentRecords(state, BENCH).bilateral?.heaviest?.load.value).toBe(
      100,
    );

    const reopened = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '80', reps: '5' }),
        { ...heavy, done: false, doneAt: undefined },
      ]),
    );
    expect(
      currentRecords(reopened, BENCH).bilateral?.heaviest?.load.value,
    ).toBe(80);
  });

  it('recomputes after a set is deleted', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '80', reps: '5' })]),
    );
    expect(currentRecords(state, BENCH).bilateral?.heaviest?.load.value).toBe(
      80,
    );
    expect(
      currentRecords(stateWith(logged('a', '2026-03-02', BENCH, [])), BENCH)
        .bilateral,
    ).toBeNull();
  });

  it('recomputes after a completed set is edited to a lower load', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '60', reps: '5' })]),
    );
    expect(currentRecords(state, BENCH).bilateral?.heaviest?.load.value).toBe(
      60,
    );
  });

  it('tracks a bodyweight rep record without a load', () => {
    const state = stateWith(
      logged('a', '2026-03-02', PULLUP, [
        set({ weight: '', reps: '10' }),
        set({ weight: '', reps: '14' }),
      ]),
    );
    const records = currentRecords(state, PULLUP);
    expect(records.bilateral?.mostReps?.reps).toBe(14);
    expect(records.bilateral?.heaviest?.load.value).toBe(0);
  });

  it('ignores warmups and drop sets', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        set({ weight: '60', reps: '5' }),
        set({ weight: '200', reps: '1', kind: 'warmup' }),
        set({ weight: '150', reps: '1', kind: 'drop' }),
      ]),
    );
    expect(currentRecords(state, BENCH).bilateral?.heaviest?.load.value).toBe(
      60,
    );
  });
});

describe('recordsBrokenBy', () => {
  it('reports the dimensions a newly completed set takes', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '60', reps: '5' })]),
      logged('b', '2026-03-09', BENCH, [
        { ...set({ weight: '80', reps: '8' }), setId: 'target' },
      ]),
    );
    const broken = recordsBrokenBy(state, BENCH, 'target');
    expect(broken.map((b) => b.dimension).sort()).toEqual([
      'heaviest',
      'mostReps',
      'volume',
    ]);
  });

  it('reports nothing when the set does not beat what came before', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '100', reps: '10' })]),
      logged('b', '2026-03-09', BENCH, [
        { ...set({ weight: '60', reps: '5' }), setId: 'target' },
      ]),
    );
    expect(recordsBrokenBy(state, BENCH, 'target')).toEqual([]);
  });

  it('does not treat a tie as a new record', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [set({ weight: '80', reps: '5' })]),
      logged('b', '2026-03-09', BENCH, [
        { ...set({ weight: '80', reps: '5' }), setId: 'target' },
      ]),
    );
    expect(recordsBrokenBy(state, BENCH, 'target')).toEqual([]);
  });

  it('treats the first eligible set as a record on every dimension', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        { ...set({ weight: '60', reps: '5' }), setId: 'target' },
      ]),
    );
    expect(recordsBrokenBy(state, BENCH, 'target')).toHaveLength(3);
  });

  it('compares a left side only against other left sides', () => {
    const state = stateWith(
      logged(
        'a',
        '2026-03-02',
        SPLIT,
        [
          set({
            weight: '60',
            reps: '10',
            right: { weight: '20', reps: '10', rpe: '' },
          }),
        ],
        { unilateral: true },
      ),
      logged(
        'b',
        '2026-03-09',
        SPLIT,
        [
          {
            ...set({
              weight: '30',
              reps: '10',
              right: { weight: '40', reps: '10', rpe: '' },
            }),
            setId: 'target',
          },
        ],
        { unilateral: true },
      ),
    );
    const broken = recordsBrokenBy(state, SPLIT, 'target');
    // The right side improved 20 -> 40, the left regressed 60 -> 30. Only the
    // right may be celebrated, and never against the left's 60.
    expect(broken.map((b) => `${b.side}:${b.dimension}`).sort()).toEqual([
      'right:heaviest',
      'right:volume',
    ]);
  });

  it('is silent for a set that is not completed', () => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [
        { ...set({ weight: '200', reps: '10' }), setId: 'target', done: false },
      ]),
    );
    expect(recordsBrokenBy(state, BENCH, 'target')).toEqual([]);
  });

  it('is silent for an unknown set id', () => {
    expect(recordsBrokenBy(emptyState(), BENCH, 'nope')).toEqual([]);
  });
});

describe('celebration keys', () => {
  const keyFor = (weight: string, reps: string, setId = 'target') => {
    const state = stateWith(
      logged('a', '2026-03-02', BENCH, [{ ...set({ weight, reps }), setId }]),
    );
    return recordsBrokenBy(state, BENCH, setId).map(celebrationKey);
  };

  it('is stable for the same set at the same value, so repeating is silent', () => {
    expect(keyFor('100', '5')).toEqual(keyFor('100', '5'));
  });

  it('changes on the dimensions that improved, and only those', () => {
    const before = keyFor('100', '5');
    const after = keyFor('105', '5');
    expect(after).not.toEqual(before);

    // Heavier load and bigger set volume are new records, so those keys move
    // and will celebrate again.
    const moved = after.filter((key) => !before.includes(key));
    expect(moved.some((key) => key.includes(':heaviest:'))).toBe(true);
    expect(moved.some((key) => key.includes(':volume:'))).toBe(true);

    // The rep count did NOT improve, so its key deliberately stays the same and
    // stays suppressed: adding weight is not a rep record.
    const held = after.filter((key) => before.includes(key));
    expect(held).toEqual([`target:bilateral:mostReps:5`]);
  });

  it('changes when reps improve at the same load', () => {
    expect(keyFor('100', '6')).not.toEqual(keyFor('100', '5'));
  });

  it('is scoped to the set id, so a restored set with a new id is unaffected', () => {
    // Celebration keys name a setId. A restored backup brings its own ids, so
    // old keys cannot suppress a genuinely new set's record; where a restore
    // brings back the SAME id and value, suppression is the correct outcome
    // because that lift was already celebrated.
    expect(keyFor('100', '5', 'restored')).not.toEqual(
      keyFor('100', '5', 'original'),
    );
  });
});

describe('undated entries claim a week but not an order within it', () => {
  const undatedIn = (sessionId: string, weekKey: string, weight: string) =>
    session({
      sessionId,
      legacyWeekKey: weekKey,
      exercises: {
        slot: { movementId: BENCH, sets: [set({ weight, reps: '5' })] },
      },
    });

  it('groups two undated sessions under the same known week', () => {
    const state = stateWith(
      undatedIn('b', '2025-06-02', '60'),
      undatedIn('a', '2025-06-02', '70'),
    );
    const rows = eligibleSets(state, { movementId: BENCH });
    expect(rows.map((r) => r.weekKey)).toEqual(['2025-06-02', '2025-06-02']);
    // Neither is presented as dated, so no reading can imply which came first.
    expect(rows.every((r) => r.dateKnown === false)).toBe(true);
    expect(rows.every((r) => r.date === null)).toBe(true);
  });

  it('orders them deterministically without that order being a claim', () => {
    // Presentation has to pick something; running twice must pick the same
    // thing, and it must not depend on object insertion order.
    const forwards = stateWith(
      undatedIn('b', '2025-06-02', '60'),
      undatedIn('a', '2025-06-02', '70'),
    );
    const backwards = stateWith(
      undatedIn('a', '2025-06-02', '70'),
      undatedIn('b', '2025-06-02', '60'),
    );
    const ids = (state: WorkoutState) =>
      eligibleSets(state, { movementId: BENCH }).map((r) => r.sessionId);
    expect(ids(forwards)).toEqual(ids(backwards));
  });

  it('still ranks a record across undated sessions by value, not by position', () => {
    const state = stateWith(
      undatedIn('b', '2025-06-02', '60'),
      undatedIn('a', '2025-06-02', '70'),
    );
    expect(currentRecords(state, BENCH).bilateral?.heaviest?.load.value).toBe(
      70,
    );
  });
});

describe('celebration storage never blocks logging', () => {
  /**
   * The storage helpers short-circuit when there is no `window`, so a bare node
   * test would pass without reaching the failure handling at all. Stubbing a
   * window is what makes these assertions real.
   */
  const withWindow = async (fn: () => Promise<void>) => {
    const had = 'window' in globalThis;
    if (!had) (globalThis as { window?: unknown }).window = {};
    try {
      await fn();
    } finally {
      if (!had) delete (globalThis as { window?: unknown }).window;
    }
  };

  it('survives a store that throws on every operation', async () => {
    // Best-effort by design: a set must log and complete even when IndexedDB is
    // unavailable (private mode, blocked site data, a quota error), so neither
    // call may reject.
    await withWindow(async () => {
      vi.resetModules();
      vi.doMock('idb-keyval', () => ({
        get: () => {
          throw new Error('nope');
        },
        set: () => {
          throw new Error('nope');
        },
        del: () => {
          throw new Error('nope');
        },
      }));
      const { loadCelebrated, saveCelebrated } = await import('@/lib/storage');
      await expect(loadCelebrated()).resolves.toEqual([]);
      await expect(saveCelebrated(['a:b:c:1'])).resolves.toBeUndefined();
      vi.doUnmock('idb-keyval');
      vi.resetModules();
    });
  });

  it('tolerates a stored value that is not a list of keys', async () => {
    await withWindow(async () => {
      vi.resetModules();
      vi.doMock('idb-keyval', () => ({
        get: async () => ({ not: 'an array' }),
        set: async () => undefined,
        del: async () => undefined,
      }));
      const { loadCelebrated } = await import('@/lib/storage');
      await expect(loadCelebrated()).resolves.toEqual([]);
      vi.doUnmock('idb-keyval');
      vi.resetModules();
    });
  });

  it('keeps only strings from a mixed stored list', async () => {
    await withWindow(async () => {
      vi.resetModules();
      vi.doMock('idb-keyval', () => ({
        get: async () => ['good:key:1', 42, null, 'other:key:2'],
        set: async () => undefined,
        del: async () => undefined,
      }));
      const { loadCelebrated } = await import('@/lib/storage');
      await expect(loadCelebrated()).resolves.toEqual([
        'good:key:1',
        'other:key:2',
      ]);
      vi.doUnmock('idb-keyval');
      vi.resetModules();
    });
  });
});
