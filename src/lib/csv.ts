import { PROGRAM, resolveExerciseName } from './program';
import { hasAnyValue, type WorkoutState } from './types';

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

/** Build the CSV for one week: logged sets only, planned order preserved. */
export function buildWeekCsv(state: WorkoutState, key: string): string {
  const rows: (string | number)[][] = [[...CSV_HEADERS]];
  const week = state.weeks[key];
  if (!week) return toCsv(rows);

  for (const day of PROGRAM) {
    const exercises = week.days[day.id]?.exercises ?? {};
    day.exercises.forEach((exercise, index) => {
      const sets = exercises[String(index)]?.sets ?? [];
      sets.forEach((set, setIndex) => {
        if (!hasAnyValue(set)) return;
        rows.push([
          key,
          day.label,
          day.name,
          week.completion[day.id] ? 'Yes' : 'No',
          resolveExerciseName(state.exerciseNames, day.id, index),
          exercise.group,
          setIndex + 1,
          set.weight,
          set.reps,
          set.rpe,
        ]);
      });
    });
  }
  return toCsv(rows);
}

export function countCsvDataRows(csv: string): number {
  const lines = csv.split('\r\n').filter((line) => line.length > 0);
  return Math.max(0, lines.length - 1);
}

export const weekCsvFilename = (key: string): string =>
  `weekly-practice-log-${key}.csv`;
