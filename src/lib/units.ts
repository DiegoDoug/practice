/**
 * Weight units.
 *
 * `state.unit` is a DISPLAY PREFERENCE. The unit a set was logged under is
 * stored on the log itself, so switching the preference re-renders the
 * numbers without reinterpreting what was lifted. Anything that compares two
 * loads — records, goals — converts first rather than assuming a shared unit.
 */

import type { WeightUnit } from './types';

/** A load that knows what it was measured in. */
export type MeasuredLoad = {
  value: number;
  unit: WeightUnit;
};

const LB_PER_KG = 2.2046226218487757;

export function convert(
  value: number,
  from: WeightUnit,
  to: WeightUnit,
): number {
  if (from === to) return value;
  return from === 'kg' ? value * LB_PER_KG : value / LB_PER_KG;
}

/** The same load expressed in `unit`. Returns a new object; never mutates. */
export const normaliseLoad = (
  load: MeasuredLoad,
  unit: WeightUnit,
): MeasuredLoad => ({
  value: convert(load.value, load.unit, unit),
  unit,
});

/**
 * Order two loads by physical magnitude, whatever they were logged in.
 * Negative when `a` is lighter, positive when heavier, zero when equal.
 */
export const compareLoads = (a: MeasuredLoad, b: MeasuredLoad): number =>
  convert(a.value, a.unit, 'kg') - convert(b.value, b.unit, 'kg');
