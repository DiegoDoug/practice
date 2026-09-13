import { describe, expect, it } from 'vitest';
import {
  countLoggedSets,
  formatVolume,
  parsePositive,
  setVolume,
  summariseDay,
  totalVolume,
} from '@/lib/volume';
import { isLoggedSet, type SetEntry } from '@/lib/types';

const set = (weight: string, reps: string, rpe = ''): SetEntry => ({
  weight,
  reps,
  rpe,
});

describe('parsePositive', () => {
  it.each([
    ['135', 135],
    [' 62.5 ', 62.5],
    ['0', null],
    ['-20', null],
    ['', null],
    ['   ', null],
    ['abc', null],
    ['Infinity', null],
    ['NaN', null],
  ])('parses %j as %j', (input, expected) => {
    expect(parsePositive(input)).toBe(expected);
  });
});

describe('setVolume', () => {
  it('multiplies weight by reps', () => {
    expect(setVolume(set('135', '8'))).toBe(1080);
  });

  it('supports decimal weights', () => {
    expect(setVolume(set('62.5', '10'))).toBe(625);
  });

  it('counts nothing when either field is missing or non-numeric', () => {
    expect(setVolume(set('135', ''))).toBe(0);
    expect(setVolume(set('', '8'))).toBe(0);
    expect(setVolume(set('bodyweight', '8'))).toBe(0);
    expect(setVolume(set('0', '8'))).toBe(0);
  });

  it('ignores RPE entirely', () => {
    expect(setVolume(set('100', '5', '9.5'))).toBe(500);
  });
});

describe('totalVolume and counts', () => {
  const sets = [
    set('135', '8'),
    set('145', '6'),
    set('', '', '8'),
    set('bw', '10'),
  ];

  it('sums only the parseable sets', () => {
    expect(totalVolume(sets)).toBe(1080 + 870);
  });

  it('counts every row carrying any value as a logged set', () => {
    expect(countLoggedSets(sets)).toBe(4);
  });

  it('does not count an RPE-only row as a logged set for progress', () => {
    expect(isLoggedSet(set('', '', '8'))).toBe(false);
    expect(isLoggedSet(set('100', ''))).toBe(true);
    expect(isLoggedSet(set('', '5'))).toBe(true);
  });
});

describe('summariseDay', () => {
  it('aggregates sets and volume across exercises', () => {
    const summary = summariseDay({
      a: {
        movementId: 'back-squat',
        sets: [set('100', '10'), set('100', '10')],
      },
      b: { movementId: 'leg-press', sets: [set('50', '12'), set('', '', '')] },
    });
    expect(summary.sets).toBe(3);
    expect(summary.volume).toBe(1000 + 1000 + 600);
  });

  it('returns zeroes for an empty day', () => {
    expect(summariseDay({})).toEqual({ sets: 0, volume: 0 });
  });
});

describe('formatVolume', () => {
  it('rounds and groups thousands', () => {
    expect(formatVolume(12345.6, 'en-US')).toBe('12,346');
  });
});
