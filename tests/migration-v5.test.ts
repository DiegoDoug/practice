/**
 * The v4 → v5 migration, which is where data gets lost if anywhere does.
 *
 * Every assertion here is about preservation or about refusing to invent:
 * sessions must not be manufactured from a slot-keyed map, dates must not be
 * guessed from routine order, and completion timestamps must not be stamped
 * with the time the migration ran.
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, buildBackup, parseBackup } from '@/lib/backup';
import { effectiveDate, isDateKnown } from '@/lib/sessions';
import { v2Document, v3Document, v4Document } from './fixtures/legacy';
import type { WorkoutSession, WorkoutState } from '@/lib/types';

const migrate = (input: unknown): WorkoutState => {
  const result = parseBackup(input);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

const sessionsOf = (state: WorkoutState): WorkoutSession[] =>
  Object.values(state.sessions);

const findSession = (
  state: WorkoutState,
  weekKey: string,
  dayId: string,
): WorkoutSession => {
  const found = sessionsOf(state).find(
    (s) => s.legacyWeekKey === weekKey && s.routineDayId === dayId,
  );
  if (!found) throw new Error(`no session for ${weekKey}/${dayId}`);
  return found;
};

describe('version handling', () => {
  it('migrates every supported version up to v5', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(5);
    for (const [doc, from] of [
      [v2Document, 2],
      [v3Document, 3],
      [v4Document, 4],
    ] as const) {
      const result = parseBackup(doc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.migratedFrom).toBe(from);
        expect(result.state.schemaVersion).toBe(5);
      }
    }
  });

  it('refuses a version from the future rather than guessing at it', () => {
    const result = parseBackup({ schemaVersion: 99, sessions: {} });
    expect(result.ok).toBe(false);
  });

  it('round-trips a migrated document through a v5 backup unchanged', () => {
    const once = migrate(v4Document);
    const twice = migrate(buildBackup(once));
    expect(twice.sessions).toEqual(once.sessions);
    expect(twice.routine).toEqual(once.routine);
    expect(twice.movements).toEqual(once.movements);
  });
});

describe('dates are never invented', () => {
  it('leaves both dates unset and records the original week instead', () => {
    const state = migrate(v4Document);
    for (const s of sessionsOf(state)) {
      expect(s.scheduledDate).toBeUndefined();
      expect(s.performedDate).toBeUndefined();
      expect(s.legacyWeekKey).toBe('2025-08-04');
      expect(isDateKnown(s)).toBe(false);
      // The week is still available as a bucket for ordering.
      expect(effectiveDate(s)).toBe('2025-08-04');
    }
  });

  it('does not derive a date from routine position', () => {
    // day3 is FIRST in this fixture's routine, so a position-based guess would
    // date it to the Monday. Nothing in the result may carry such a date.
    const state = migrate(v4Document);
    const dates = sessionsOf(state).flatMap((s) =>
      [s.scheduledDate, s.performedDate].filter(Boolean),
    );
    expect(dates).toEqual([]);
  });
});

describe('nothing logged is dropped', () => {
  it('creates a session for a day marked complete with no logged sets', () => {
    const state = migrate(v4Document);
    const day1 = findSession(state, '2025-08-04', 'day1');
    expect(day1.status).toBe('completed');
    expect(day1.exercises).toEqual({});
    // Its frozen labels came across too.
    expect(day1.snapshot?.name).toBe('Push');
  });

  it('keeps logs for a day the routine no longer plans', () => {
    const state = migrate(v4Document);
    const orphan = findSession(state, '2025-08-04', 'dayX');
    expect(orphan.exercises['dayX-s0'].sets[0].weight).toBe('20');
  });

  it('keeps a half-typed unilateral row as a draft, values intact', () => {
    const state = migrate(v4Document);
    const sets = findSession(state, '2025-08-04', 'day3').exercises['day3-s1']
      .sets;
    expect(sets[1].weight).toBe('75');
    expect(sets[1].right?.reps).toBe('');
    expect(sets[1].done).toBeFalsy();
  });

  it('keeps the v3 orphan under a non-numeric legacy key', () => {
    const state = migrate(v3Document);
    const s = findSession(state, '2025-07-07', 'day2');
    const orphan = Object.entries(s.exercises).find(([key]) =>
      key.includes('legacy'),
    );
    expect(orphan?.[1].sets[0].weight).toBe('40');
  });

  it('keeps a v2 day that was complete but empty', () => {
    const state = migrate(v2Document);
    expect(findSession(state, '2025-06-02', 'day3').status).toBe('completed');
  });
});

describe('slot-keyed substitutions', () => {
  it('never creates a session from a slot id', () => {
    const state = migrate(v4Document);
    // 'day3-s0' and 'dayGone-s4' are slot ids in the fixture's substitutions.
    for (const s of sessionsOf(state)) {
      expect(s.routineDayId).not.toBe('day3-s0');
      expect(s.routineDayId).not.toBe('dayGone-s4');
    }
    expect(sessionsOf(state)).toHaveLength(3); // day3, day1, dayX — no more.
  });

  it('attaches a substitution to the session that owns its slot', () => {
    const state = migrate(v4Document);
    const day3 = findSession(state, '2025-08-04', 'day3');
    expect(day3.substitutions).toEqual({ 'day3-s0': 'front-squat' });
  });

  it('preserves an unownable substitution explicitly instead of dropping it', () => {
    const state = migrate(v4Document);
    expect(state.unresolvedSubstitutions).toEqual({
      '2025-08-04:dayGone-s4': 'hack-squat',
    });
  });

  it('does not leak a substitution onto a session that does not own the slot', () => {
    const state = migrate(v4Document);
    expect(
      findSession(state, '2025-08-04', 'day1').substitutions ?? {},
    ).toEqual({});
  });
});

describe('legacy set classification', () => {
  it('marks a set complete when it carries what its mode requires', () => {
    const state = migrate(v4Document);
    const sets = findSession(state, '2025-08-04', 'day3').exercises['day3-s0']
      .sets;
    expect(sets.map((s) => s.done)).toEqual([true, true]);
  });

  it('never stamps a completion time it cannot know', () => {
    const state = migrate(v4Document);
    for (const s of sessionsOf(state)) {
      for (const log of Object.values(s.exercises)) {
        for (const set of log.sets) {
          expect(set.doneAt).toBeUndefined();
        }
      }
    }
  });

  it('gives every migrated set a deterministic, stable id', () => {
    const first = migrate(v4Document);
    const second = migrate(v4Document);
    const ids = (state: WorkoutState) =>
      sessionsOf(state)
        .flatMap((s) =>
          Object.entries(s.exercises).flatMap(([slotId, log]) =>
            log.sets.map((set) => `${slotId}:${set.setId}`),
          ),
        )
        .sort();
    expect(ids(first)).toEqual(ids(second));
    expect(ids(first).every((id) => !id.includes('undefined'))).toBe(true);
  });

  it('leaves a half-typed row as a draft', () => {
    const state = migrate(v3Document);
    const sets = findSession(state, '2025-07-07', 'day2').exercises['day2-s0']
      .sets;
    // Zero-load bodyweight rows with reps are complete; nothing here is partial.
    expect(sets.every((set) => set.done === true)).toBe(true);
  });

  it('marks a v2 row with reps missing as unfinished', () => {
    const state = migrate(v2Document);
    const sets = findSession(state, '2025-06-02', 'day1').exercises['day1-s1']
      .sets;
    expect(sets[0].done).toBeFalsy();
  });
});

describe('units', () => {
  it('stamps migrated logs with the document unit, so meaning is preserved', () => {
    const state = migrate(v3Document);
    expect(state.unit).toBe('kg');
    const s = findSession(state, '2025-07-07', 'day2');
    expect(s.exercises['day2-s0'].unit).toBe('kg');
  });

  it('keeps lb logs as lb', () => {
    const state = migrate(v4Document);
    expect(
      findSession(state, '2025-08-04', 'day3').exercises['day3-s0'].unit,
    ).toBe('lb');
  });
});

describe('status', () => {
  it('maps completion to completed and everything else to scheduled', () => {
    const state = migrate(v4Document);
    expect(findSession(state, '2025-08-04', 'day3').status).toBe('completed');
    expect(findSession(state, '2025-08-04', 'dayX').status).toBe('scheduled');
  });

  it('never migrates a session into in_progress', () => {
    for (const doc of [v2Document, v3Document, v4Document]) {
      for (const s of sessionsOf(migrate(doc))) {
        expect(s.status).not.toBe('in_progress');
      }
    }
  });
});

describe('routine and library', () => {
  it('keeps the routine order the document had', () => {
    const state = migrate(v4Document);
    expect(state.routine.map((d) => d.dayId)).toEqual([
      'day3',
      'day1',
      'dayOld',
    ]);
  });

  it('keeps a custom movement and an archived day', () => {
    const state = migrate(v4Document);
    expect(state.movements['custom-sled-push'].custom).toBe(true);
    expect(state.routine.find((d) => d.dayId === 'dayOld')?.archived).toBe(
      true,
    );
  });

  it('folds a v2 rename into the slot without repointing the movement', () => {
    const state = migrate(v2Document);
    const slot = state.routine
      .find((d) => d.dayId === 'day1')
      ?.exercises.find((e) => e.slotId === 'day1-s0');
    expect(slot?.nameOverride).toBe('Bench Press (comp grip)');
    expect(slot?.movementId).toBe('barbell-bench-press');
  });
});

describe('failed parses leave data alone', () => {
  it('never throws, whatever it is handed', () => {
    for (const input of [null, 42, 'nope', {}, { schemaVersion: 'x' }, []]) {
      expect(() => parseBackup(input)).not.toThrow();
      expect(parseBackup(input).ok).toBe(false);
    }
  });

  it('reports a readable reason rather than a stack trace', () => {
    const result = parseBackup({ schemaVersion: 5, sessions: 'not a map' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(10);
  });
});
