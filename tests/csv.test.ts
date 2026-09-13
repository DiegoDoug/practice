import { describe, expect, it } from 'vitest';
import {
  buildWeekCsv,
  countCsvDataRows,
  csvEscape,
  toCsv,
  weekCsvFilename,
} from '@/lib/csv';
import { emptyState } from '@/lib/backup';
import type { WorkoutState } from '@/lib/types';

describe('csvEscape', () => {
  it('leaves plain values untouched', () => {
    expect(csvEscape('Back Squat')).toBe('Back Squat');
    expect(csvEscape(225)).toBe('225');
  });

  it('quotes values containing a comma', () => {
    expect(csvEscape('Dips, weighted')).toBe('"Dips, weighted"');
  });

  it('doubles embedded quotes and wraps the field', () => {
    expect(csvEscape('Pull-ups "wide"')).toBe('"Pull-ups ""wide"""');
  });

  it('quotes values containing line breaks', () => {
    expect(csvEscape('line one\nline two')).toBe('"line one\nline two"');
    expect(csvEscape('carriage\rreturn')).toBe('"carriage\rreturn"');
  });

  it('renders null and undefined as empty fields', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('keeps UTF-8 characters as-is', () => {
    expect(csvEscape('Incline DB Press — 2×10')).toBe(
      'Incline DB Press — 2×10',
    );
  });
});

describe('toCsv', () => {
  it('joins rows with CRLF and escapes each field', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c,1', 'd'],
      ]),
    ).toBe('a,b\r\n"c,1",d');
  });
});

const snapshot = (name: string) => ({
  label: 'Day 1',
  name: 'Push',
  groups: [],
  exercises: [
    {
      slotId: 'day1-s0',
      movementId: 'barbell-bench-press',
      name,
      group: 'Push',
      loadMode: 'external' as const,
      primaryMuscles: [],
      secondaryMuscles: [],
    },
  ],
});

const stateWithWeek = (): WorkoutState => ({
  ...emptyState(),
  sessions: {
    current: {
      sessionId: 'current',
      routineDayId: 'day1',
      performedDate: '2026-09-07',
      status: 'completed',
      snapshot: snapshot('Bench Press, paused'),
      exercises: {
        'day1-s0': {
          movementId: 'barbell-bench-press',
          sets: [
            { weight: '135', reps: '8', rpe: '7' },
            { weight: '', reps: '', rpe: '' },
            { weight: '145', reps: '6', rpe: '8.5' },
          ],
        },
      },
    },
    prior: {
      sessionId: 'prior',
      routineDayId: 'day1',
      performedDate: '2026-08-31',
      status: 'scheduled',
      snapshot: snapshot('Barbell Bench Press'),
      exercises: {
        'day1-s0': {
          movementId: 'barbell-bench-press',
          sets: [{ weight: '125', reps: '8', rpe: '' }],
        },
      },
    },
  },
});

describe('buildWeekCsv', () => {
  it('writes the expected header row', () => {
    const csv = buildWeekCsv(emptyState(), '2026-09-07');
    expect(csv.split('\r\n')[0]).toBe(
      'Week,Day,Day Name,Completed,Exercise,Muscle Group,Set,Weight,Reps,RPE,' +
        'Mode,Left Weight,Left Reps,Left RPE,Right Weight,Right Reps,Right RPE,' +
        'Date,Status',
    );
    expect(countCsvDataRows(csv)).toBe(0);
  });

  it('keeps the original ten columns as a prefix', () => {
    // Side columns are appended, never inserted, so existing importers and the
    // browser verification script keep working.
    const header = buildWeekCsv(emptyState(), '2026-09-07').split('\r\n')[0];
    expect(
      header.startsWith(
        'Week,Day,Day Name,Completed,Exercise,Muscle Group,Set,Weight,Reps,RPE',
      ),
    ).toBe(true);
  });

  it('exports only logged sets from the requested week', () => {
    const csv = buildWeekCsv(stateWithWeek(), '2026-09-07');
    expect(countCsvDataRows(csv)).toBe(2);
    expect(csv).not.toContain('125');
  });

  it('escapes overridden exercise names and keeps the original set numbering', () => {
    const lines = buildWeekCsv(stateWithWeek(), '2026-09-07').split('\r\n');
    expect(lines[1]).toBe(
      '2026-09-07,Day 1,Push,Yes,"Bench Press, paused",Push,1,135,8,7,bilateral,,,,,,,2026-09-07,completed',
    );
    // The blank row two is skipped but row three keeps its real index.
    expect(lines[2]).toBe(
      '2026-09-07,Day 1,Push,Yes,"Bench Press, paused",Push,3,145,6,8.5,bilateral,,,,,,,2026-09-07,completed',
    );
  });

  it('records completion state per day', () => {
    const csv = buildWeekCsv(stateWithWeek(), '2026-08-31');
    expect(csv.split('\r\n')[1]).toContain(',No,');
  });

  it('returns just headers for an unknown week', () => {
    expect(countCsvDataRows(buildWeekCsv(stateWithWeek(), '2020-01-06'))).toBe(
      0,
    );
  });
});

describe('weekCsvFilename', () => {
  it('includes the week key', () => {
    expect(weekCsvFilename('2026-09-07')).toBe(
      'weekly-practice-log-2026-09-07.csv',
    );
  });
});
