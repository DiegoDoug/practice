import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  backupFilename,
  buildBackup,
  emptyState,
  parseBackup,
  parseBackupJson,
} from '@/lib/backup';
import { PROGRAM_VERSION } from '@/lib/program';

const weeks = {
  '2026-09-07': {
    days: {
      day1: {
        exercises: { '0': { sets: [{ weight: '135', reps: '8', rpe: '7' }] } },
      },
    },
    completion: { day1: true },
  },
};

const legacyV2 = {
  version: 2,
  weeks,
  exerciseNames: { 'day1:0': 'Paused Bench' },
};

const currentV3 = {
  schemaVersion: 3,
  exportedAt: '2026-09-12T10:00:00.000Z',
  programVersion: 1,
  unit: 'lb',
  weeks,
  exerciseNames: { 'day1:0': 'Paused Bench' },
};

describe('parseBackup — valid input', () => {
  it('migrates a v3 backup and preserves its logged data', () => {
    const result = parseBackup(currentV3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(3);
    expect(result.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.state.unit).toBe('lb');
    expect(
      result.state.weeks['2026-09-07'].days.day1.exercises['day1-s0'].sets[0]
        .weight,
    ).toBe('135');
    expect(result.state.weeks['2026-09-07'].completion.day1).toBe(true);
  });

  it('migrates a legacy v2 backup from the original workout log', () => {
    const result = parseBackup(legacyV2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(2);
    expect(result.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.state.programVersion).toBe(PROGRAM_VERSION);
    expect(result.state.unit).toBe('lb');
  });

  it('chains v2 through v3 to the same result as importing the v3 file', () => {
    const fromV2 = parseBackup(legacyV2);
    const fromV3 = parseBackup(currentV3);
    expect(fromV2.ok && fromV3.ok).toBe(true);
    if (!fromV2.ok || !fromV3.ok) return;
    expect(fromV2.state).toEqual(fromV3.state);
  });

  it('seeds a routine and movement library for a v4 file without them', () => {
    const result = parseBackup({
      schemaVersion: 4,
      weeks: {},
      routine: [],
      movements: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.routine.length).toBeGreaterThan(0);
    expect(Object.keys(result.state.movements).length).toBeGreaterThan(0);
    expect(result.state.unit).toBe('lb');
  });

  it('keeps per-side data through a load', () => {
    // Regression: the set schema declares `right` explicitly, so it is not
    // stripped the way an undeclared key would be.
    const result = parseBackup({
      schemaVersion: 4,
      weeks: {
        '2026-09-07': {
          days: {
            day1: {
              exercises: {
                'day1-s0': {
                  movementId: 'bulgarian-split-squat',
                  unilateral: true,
                  sets: [
                    {
                      weight: '50',
                      reps: '10',
                      rpe: '8',
                      right: { weight: '50', reps: '9', rpe: '8' },
                    },
                  ],
                },
              },
            },
          },
          completion: {},
        },
      },
      routine: [],
      movements: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const log = result.state.weeks['2026-09-07'].days.day1.exercises['day1-s0'];
    expect(log.unilateral).toBe(true);
    expect(log.sets[0].right).toEqual({ weight: '50', reps: '9', rpe: '8' });
  });
});

describe('parseBackup — rejected input', () => {
  it.each([
    [null, 'missing a schema version'],
    [{}, 'missing a schema version'],
    ['just a string', 'missing a schema version'],
    [{ schemaVersion: 99, weeks: {}, movements: {} }, 'not supported'],
    [{ schemaVersion: 5, weeks: {}, movements: {} }, 'not supported'],
    [{ version: 1, weeks: {}, exerciseNames: {} }, 'not supported'],
  ])('rejects %j', (input, fragment) => {
    const result = parseBackup(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(fragment);
  });

  it('rejects a v4 payload missing required keys', () => {
    expect(parseBackup({ schemaVersion: 4, weeks: {} }).ok).toBe(false);
    expect(parseBackup({ schemaVersion: 4, routine: [] }).ok).toBe(false);
  });

  it('rejects week keys that are not YYYY-MM-DD', () => {
    const result = parseBackup({
      schemaVersion: 4,
      weeks: { 'last week': { days: {}, completion: {} } },
      routine: [],
      movements: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('weeks.last week');
  });

  it('rejects a malformed week body', () => {
    expect(
      parseBackup({
        schemaVersion: 4,
        weeks: { '2026-09-07': { days: 'nope', completion: {} } },
        routine: [],
        movements: {},
      }).ok,
    ).toBe(false);
  });

  it('rejects invalid JSON without throwing', () => {
    const result = parseBackupJson('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not valid JSON');
  });

  it('never throws for arbitrary input', () => {
    for (const input of [undefined, 0, [], true, { schemaVersion: '4' }]) {
      expect(() => parseBackup(input)).not.toThrow();
      expect(parseBackup(input).ok).toBe(false);
    }
  });
});

describe('buildBackup', () => {
  it('round-trips through parseBackup without data loss', () => {
    const state = emptyState();
    const payload = buildBackup(state, new Date('2026-09-12T10:00:00.000Z'));
    expect(payload.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(payload.exportedAt).toBe('2026-09-12T10:00:00.000Z');
    expect(payload.programVersion).toBe(PROGRAM_VERSION);

    const result = parseBackup(JSON.parse(JSON.stringify(payload)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(state);
  });

  it('exports the routine and movement library', () => {
    const payload = buildBackup(emptyState());
    expect(Array.isArray(payload.routine)).toBe(true);
    expect(payload.routine.length).toBe(6);
    expect(Object.keys(payload.movements).length).toBeGreaterThan(0);
  });
});

describe('backupFilename', () => {
  it('includes the export date', () => {
    expect(backupFilename(new Date('2026-09-12T10:00:00.000Z'))).toBe(
      'weekly-practice-log-backup-2026-09-12.json',
    );
  });
});
