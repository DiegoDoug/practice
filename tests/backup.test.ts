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

const legacyV2 = {
  version: 2,
  weeks: {
    '2026-09-07': {
      days: {
        day1: {
          exercises: {
            '0': { sets: [{ weight: '135', reps: '8', rpe: '7' }] },
          },
        },
      },
      completion: { day1: true },
    },
  },
  exerciseNames: { 'day1:0': 'Paused Bench' },
};

const currentV3 = {
  schemaVersion: 3,
  exportedAt: '2026-09-12T10:00:00.000Z',
  programVersion: 1,
  unit: 'lb',
  weeks: legacyV2.weeks,
  exerciseNames: legacyV2.exerciseNames,
};

describe('parseBackup — valid input', () => {
  it('accepts a current v3 backup and preserves its data', () => {
    const result = parseBackup(currentV3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(3);
    expect(result.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.state.unit).toBe('lb');
    expect(result.state.exerciseNames['day1:0']).toBe('Paused Bench');
    expect(
      result.state.weeks['2026-09-07'].days.day1.exercises['0'].sets[0].weight,
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
    expect(result.state.weeks).toEqual(legacyV2.weeks);
    expect(result.state.exerciseNames).toEqual(legacyV2.exerciseNames);
  });

  it('defaults optional v3 fields when they are absent', () => {
    const result = parseBackup({
      schemaVersion: 3,
      weeks: {},
      exerciseNames: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.unit).toBe('lb');
    expect(result.state.programVersion).toBe(PROGRAM_VERSION);
  });
});

describe('parseBackup — rejected input', () => {
  it.each([
    [null, 'missing a schema version'],
    [{}, 'missing a schema version'],
    ['just a string', 'missing a schema version'],
    [{ schemaVersion: 99, weeks: {}, exerciseNames: {} }, 'not supported'],
    [{ version: 1, weeks: {}, exerciseNames: {} }, 'not supported'],
  ])('rejects %j', (input, fragment) => {
    const result = parseBackup(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(fragment);
  });

  it('rejects a v3 payload missing required keys', () => {
    expect(parseBackup({ schemaVersion: 3, weeks: {} }).ok).toBe(false);
    expect(parseBackup({ schemaVersion: 3, exerciseNames: {} }).ok).toBe(false);
  });

  it('rejects week keys that are not YYYY-MM-DD', () => {
    const result = parseBackup({
      schemaVersion: 3,
      weeks: { 'last week': { days: {}, completion: {} } },
      exerciseNames: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('weeks.last week');
  });

  it('rejects a malformed week body', () => {
    expect(
      parseBackup({
        schemaVersion: 3,
        weeks: { '2026-09-07': { days: 'nope', completion: {} } },
        exerciseNames: {},
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
    for (const input of [undefined, 0, [], true, { schemaVersion: '3' }]) {
      expect(() => parseBackup(input)).not.toThrow();
      expect(parseBackup(input).ok).toBe(false);
    }
  });
});

describe('buildBackup', () => {
  it('round-trips through parseBackup without data loss', () => {
    const state = {
      ...emptyState(),
      weeks: legacyV2.weeks,
      exerciseNames: legacyV2.exerciseNames,
    };
    const payload = buildBackup(state, new Date('2026-09-12T10:00:00.000Z'));
    expect(payload.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(payload.exportedAt).toBe('2026-09-12T10:00:00.000Z');
    expect(payload.programVersion).toBe(PROGRAM_VERSION);

    const result = parseBackup(JSON.parse(JSON.stringify(payload)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(state);
  });
});

describe('backupFilename', () => {
  it('includes the export date', () => {
    expect(backupFilename(new Date('2026-09-12T10:00:00.000Z'))).toBe(
      'weekly-practice-log-backup-2026-09-12.json',
    );
  });
});
