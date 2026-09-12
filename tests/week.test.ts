import { describe, expect, it } from 'vitest';
import {
  parseDateKey,
  priorWeekKeys,
  startOfLocalWeek,
  toLocalDateKey,
  weekKey,
} from '@/lib/week';

describe('weekKey', () => {
  it('returns the Monday of the week for every weekday', () => {
    // Mon 2026-09-07 … Sun 2026-09-13 all belong to the 2026-09-07 week.
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(2026, 8, 7 + offset, 10, 30);
      expect(weekKey(date)).toBe('2026-09-07');
    }
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(weekKey(new Date(2026, 8, 13, 23, 59))).toBe('2026-09-07');
    expect(weekKey(new Date(2026, 8, 14, 0, 1))).toBe('2026-09-14');
  });

  it('uses local calendar fields, not a UTC conversion', () => {
    // Late-evening local time on a Monday is already Tuesday in UTC; a
    // toISOString()-based implementation would return the wrong Monday.
    const lateMonday = new Date(2026, 8, 7, 23, 30);
    expect(weekKey(lateMonday)).toBe('2026-09-07');
    expect(toLocalDateKey(lateMonday)).toBe('2026-09-07');

    // Early-morning local time on a Monday is still Sunday in UTC westwards.
    const earlyMonday = new Date(2026, 8, 7, 0, 15);
    expect(weekKey(earlyMonday)).toBe('2026-09-07');
  });

  it('normalises the Monday to local midnight', () => {
    const monday = startOfLocalWeek(new Date(2026, 8, 10, 17, 45, 30, 500));
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
    expect(monday.getSeconds()).toBe(0);
    expect(monday.getMilliseconds()).toBe(0);
  });

  it('crosses month and year boundaries correctly', () => {
    expect(weekKey(new Date(2027, 0, 1, 9, 0))).toBe('2026-12-28');
    expect(weekKey(new Date(2026, 2, 1, 9, 0))).toBe('2026-02-23');
  });

  it('round-trips a week key back to the same local date', () => {
    const parsed = parseDateKey('2026-09-07');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(8);
    expect(parsed.getDate()).toBe(7);
    expect(toLocalDateKey(parsed)).toBe('2026-09-07');
  });
});

describe('priorWeekKeys', () => {
  it('returns only strictly earlier keys, newest first', () => {
    const keys = ['2026-08-24', '2026-09-07', '2026-08-31', '2026-09-14'];
    expect(priorWeekKeys(keys, '2026-09-07')).toEqual([
      '2026-08-31',
      '2026-08-24',
    ]);
  });

  it('excludes the current week itself', () => {
    expect(priorWeekKeys(['2026-09-07'], '2026-09-07')).toEqual([]);
  });
});
