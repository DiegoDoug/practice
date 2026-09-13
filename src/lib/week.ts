/** Local-time week helpers. All keys are `YYYY-MM-DD` for the local Monday. */

const pad = (n: number): string => String(n).padStart(2, '0');

/** Format a Date as `YYYY-MM-DD` using its LOCAL calendar fields.
 *  `toISOString()` would shift the date across the UTC boundary for any
 *  timezone behind or ahead of UTC, which is the bug this avoids. */
export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The Monday that starts the local week containing `date`. */
export function startOfLocalWeek(date: Date = new Date()): Date {
  const monday = new Date(date.getTime());
  monday.setHours(0, 0, 0, 0);
  const day = monday.getDay() === 0 ? 7 : monday.getDay(); // Sunday closes the week
  monday.setDate(monday.getDate() - day + 1);
  return monday;
}

/** Week key (local Monday, `YYYY-MM-DD`) for the week containing `date`. */
export function weekKey(date: Date = new Date()): string {
  return toLocalDateKey(startOfLocalWeek(date));
}

/** Parse a week key at local noon, which is safe against DST shifts. */
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function formatWeekLabel(key: string, locale?: string): string {
  return parseDateKey(key).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Week keys strictly before `key`, newest first. */
export function priorWeekKeys(keys: string[], key: string): string[] {
  return keys
    .filter((candidate) => candidate < key)
    .sort()
    .reverse();
}

export const isWeekKey = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value);
