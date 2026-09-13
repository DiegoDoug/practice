import { hasAnyValue, type SetEntry, type WorkoutState } from './types';
import { resolveWeekRoutine } from './routine';

/**
 * The original ten columns, unchanged and in their original order, followed by
 * the side columns. Appending rather than inserting keeps existing importers —
 * and the header assertion in the browser verification script — working.
 */
export const CSV_HEADERS = [
  'Week',
  'Day',
  'Day Name',
  'Completed',
  'Exercise',
  'Muscle Group',
  'Set',
  'Weight',
  'Reps',
  'RPE',
  'Mode',
  'Left Weight',
  'Left Reps',
  'Left RPE',
  'Right Weight',
  'Right Reps',
  'Right RPE',
] as const;

/** Quote a CSV field when it contains a quote, comma, or line break. */
export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

const sideCells = (set: SetEntry): string[] =>
  set.right
    ? [
        'unilateral',
        set.weight,
        set.reps,
        set.rpe,
        set.right.weight,
        set.right.reps,
        set.right.rpe,
      ]
    : ['bilateral', '', '', '', '', '', ''];

/**
 * Build the CSV for one week: logged sets only, in the order the routine had
 * when the week was logged. A unilateral set stays one row, with its left side
 * in the original Weight/Reps/RPE columns and both sides spelled out after.
 */
export function buildWeekCsv(state: WorkoutState, key: string): string {
  const rows: (string | number)[][] = [[...CSV_HEADERS]];
  const week = state.weeks[key];
  if (!week) return toCsv(rows);

  for (const [dayId, dayLog] of Object.entries(week.days)) {
    const resolved = resolveWeekRoutine(state, key, dayId);
    const planned = resolved.exercises;
    const plannedIds = new Set(planned.map((slot) => slot.slotId));
    const completed = week.completion[dayId] ? 'Yes' : 'No';

    // Planned slots first, in routine order, then any orphans left behind by a
    // removed or archived slot — logged data is never silently dropped.
    const orphans = Object.keys(dayLog.exercises).filter(
      (slotId) => !plannedIds.has(slotId),
    );

    const emit = (slotId: string, name: string, group: string): void => {
      const log = dayLog.exercises[slotId];
      if (!log) return;
      log.sets.forEach((set, setIndex) => {
        if (!hasAnyValue(set)) return;
        rows.push([
          key,
          resolved.label,
          resolved.name,
          completed,
          name,
          group,
          setIndex + 1,
          set.weight,
          set.reps,
          set.rpe,
          ...sideCells(set),
        ]);
      });
    };

    for (const slot of planned) emit(slot.slotId, slot.name, slot.group);
    for (const slotId of orphans) {
      const log = dayLog.exercises[slotId];
      const movement = log ? state.movements[log.movementId] : undefined;
      emit(slotId, movement?.name ?? 'Unknown exercise', movement?.group ?? '');
    }
  }
  return toCsv(rows);
}

export function countCsvDataRows(csv: string): number {
  const lines = csv.split('\r\n').filter((line) => line.length > 0);
  return Math.max(0, lines.length - 1);
}

export const weekCsvFilename = (key: string): string =>
  `weekly-practice-log-${key}.csv`;
