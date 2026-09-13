import { describe, expect, it } from 'vitest';
import { parseBackup } from '@/lib/backup';
import { UNKNOWN_MOVEMENT_ID } from '@/lib/movements';
import { findDay } from '@/lib/routine';
import type { WorkoutState } from '@/lib/types';

const v3 = (
  overrides: Partial<{
    weeks: Record<string, unknown>;
    exerciseNames: Record<string, string>;
  }> = {},
) => ({
  schemaVersion: 3,
  programVersion: 1,
  unit: 'lb',
  weeks: {},
  exerciseNames: {},
  ...overrides,
});

const migrate = (input: unknown): WorkoutState => {
  const result = parseBackup(input);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

/**
 * The session a legacy (week, day) migrated into. These suites now run the
 * whole v3 → v5 chain, which is what a real backup goes through.
 */
const sessionOf = (state: WorkoutState, weekKey: string, dayId: string) => {
  const found = Object.values(state.sessions).find(
    (session) =>
      session.legacyWeekKey === weekKey && session.routineDayId === dayId,
  );
  if (!found) throw new Error(`no migrated session for ${weekKey}/${dayId}`);
  return found;
};

describe('v3 migration: log keys', () => {
  it('maps a positional key onto a deterministic slot id', () => {
    const state = migrate(
      v3({
        weeks: {
          '2026-09-07': {
            days: {
              day1: {
                exercises: {
                  '0': { sets: [{ weight: '135', reps: '8', rpe: '7' }] },
                  '3': { sets: [{ weight: '25', reps: '15', rpe: '' }] },
                },
              },
            },
            completion: {},
          },
        },
      }),
    );

    const exercises = sessionOf(state, '2026-09-07', 'day1').exercises;
    expect(Object.keys(exercises).sort()).toEqual(['day1-s0', 'day1-s3']);
    expect(exercises['day1-s0'].sets[0].weight).toBe('135');
    expect(exercises['day1-s3'].sets[0].reps).toBe('15');
  });

  it('is deterministic across repeated migrations', () => {
    const input = v3({
      weeks: {
        '2026-09-07': {
          days: { day1: { exercises: { '0': { sets: [] } } } },
          completion: {},
        },
      },
    });
    expect(migrate(input)).toEqual(migrate(input));
  });

  it('stamps the movement each slot was pointing at', () => {
    const state = migrate(
      v3({
        weeks: {
          '2026-09-07': {
            days: {
              day2: {
                exercises: {
                  '2': { sets: [{ weight: '185', reps: '8', rpe: '' }] },
                },
              },
            },
            completion: {},
          },
        },
      }),
    );
    // Day 2 slot 2 is Barbell Row in the seeded program.
    expect(
      sessionOf(state, '2026-09-07', 'day2').exercises['day2-s2'].movementId,
    ).toBe('barbell-row');
  });
});

describe('v3 → v4 name overrides', () => {
  it('folds exerciseNames into the routine slot', () => {
    const state = migrate(v3({ exerciseNames: { 'day1:0': 'Paused Bench' } }));
    const slot = findDay(state.routine, 'day1')!.exercises[0];
    expect(slot.nameOverride).toBe('Paused Bench');
    // Still the seeded movement, so history stays contiguous.
    expect(slot.movementId).toBe('barbell-bench-press');
  });

  it('drops an override that merely repeats the movement name', () => {
    const state = migrate(
      v3({ exerciseNames: { 'day1:0': 'Barbell Bench Press' } }),
    );
    expect(
      findDay(state.routine, 'day1')!.exercises[0].nameOverride,
    ).toBeUndefined();
  });

  it('retires the exerciseNames map', () => {
    const state = migrate(v3({ exerciseNames: { 'day1:0': 'Paused Bench' } }));
    expect('exerciseNames' in state).toBe(false);
  });
});

describe('v3 migration: orphaned logs', () => {
  it('keeps a log whose key is out of range', () => {
    const state = migrate(
      v3({
        weeks: {
          '2026-09-07': {
            days: {
              day1: {
                exercises: {
                  '99': { sets: [{ weight: '1', reps: '1', rpe: '' }] },
                },
              },
            },
            completion: {},
          },
        },
      }),
    );
    const exercises = sessionOf(state, '2026-09-07', 'day1').exercises;
    expect(exercises['day1-legacy99']).toBeDefined();
    expect(exercises['day1-legacy99'].movementId).toBe(UNKNOWN_MOVEMENT_ID);
    expect(exercises['day1-legacy99'].sets[0].weight).toBe('1');
  });

  it('keeps a log whose key is not a number', () => {
    const state = migrate(
      v3({
        weeks: {
          '2026-09-07': {
            days: {
              day1: {
                exercises: {
                  odd: { sets: [{ weight: '2', reps: '2', rpe: '' }] },
                },
              },
            },
            completion: {},
          },
        },
      }),
    );
    expect(
      sessionOf(state, '2026-09-07', 'day1').exercises['day1-legacyodd'],
    ).toBeDefined();
  });

  it('keeps a day the seeded program does not know, archived', () => {
    const state = migrate(
      v3({
        weeks: {
          '2026-09-07': {
            days: {
              day9: {
                exercises: {
                  '0': { sets: [{ weight: '3', reps: '3', rpe: '' }] },
                },
              },
            },
            completion: {},
          },
        },
      }),
    );
    const day = findDay(state.routine, 'day9');
    expect(day?.archived).toBe(true);
    expect(
      sessionOf(state, '2026-09-07', 'day9').exercises['day9-legacy0'],
    ).toBeDefined();
  });
});

describe('v3 migration: snapshots', () => {
  it('backfills a snapshot for every logged day', () => {
    const state = migrate(
      v3({
        weeks: {
          '2026-09-07': {
            days: {
              day1: {
                exercises: {
                  '0': { sets: [{ weight: '135', reps: '8', rpe: '' }] },
                },
              },
            },
            completion: {},
          },
        },
        exerciseNames: { 'day1:0': 'Paused Bench' },
      }),
    );

    const snapshot = sessionOf(state, '2026-09-07', 'day1').snapshot;
    expect(snapshot?.label).toBe('Day 1');
    expect(snapshot?.name).toBe('Push');
    // The name recorded is the one that was in effect, override included.
    expect(snapshot?.exercises[0].name).toBe('Paused Bench');
    expect(snapshot?.exercises[0].group).toBe('Push');
  });

  it('keeps a day that was completed with nothing logged', () => {
    // v4 wrote no snapshot for such a day; v5 still has to keep the session,
    // or a finished workout would vanish because it happened to be empty.
    const state = migrate(
      v3({
        weeks: {
          '2026-09-07': {
            days: { day1: { exercises: {} } },
            completion: { day1: true },
          },
        },
      }),
    );
    const session = sessionOf(state, '2026-09-07', 'day1');
    expect(session.status).toBe('completed');
    expect(session.exercises).toEqual({});
  });
});

describe('v3 migration: routine seeding', () => {
  it('preserves the seeded program shape', () => {
    const state = migrate(v3());
    expect(state.routine.map((d) => d.exercises.length)).toEqual([
      6, 6, 6, 6, 7, 6,
    ]);
    expect(state.routine.map((d) => d.name)).toEqual([
      'Push',
      'Pull',
      'Legs',
      'Legs',
      'Arms',
      'Chest/Back',
    ]);
  });

  it('keeps the per-day muscle-group label where it differs from the movement', () => {
    // Barbell Row is "Length" on Day 2 and "Back" on Day 6 in the source plan.
    const state = migrate(v3());
    const day2 = findDay(state.routine, 'day2')!.exercises[2];
    const day6 = findDay(state.routine, 'day6')!.exercises[3];
    expect(day2.movementId).toBe('barbell-row');
    expect(day6.movementId).toBe('barbell-row');
    expect(day6.groupOverride).toBe('Back');
  });

  it('leaves every seeded slot bilateral', () => {
    // PR 1 is behaviour-preserving: unilateral mode is opt-in, never seeded.
    const state = migrate(v3());
    for (const day of state.routine) {
      for (const slot of day.exercises) {
        expect(slot.unilateral).toBeUndefined();
      }
    }
  });
});
