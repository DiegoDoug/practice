'use client';

import { useMemo } from 'react';
import { imbalancePercent, formatVolume } from '@/lib/volume';
import { sideProgression } from '@/lib/workout';
import { formatWeekLabel } from '@/lib/week';
import type { WorkoutState } from '@/lib/types';

type SideComparisonProps = {
  state: WorkoutState;
};

/** Movements that have at least one week of two-sided logging. */
function unilateralMovements(state: WorkoutState): string[] {
  const ids = new Set<string>();
  for (const week of Object.values(state.weeks)) {
    for (const day of Object.values(week.days)) {
      for (const log of Object.values(day.exercises)) {
        if (log?.unilateral && (log.sets ?? []).length > 0) {
          ids.add(log.movementId);
        }
      }
    }
  }
  return [...ids];
}

const describeImbalance = (percent: number | null): string => {
  if (percent === null) return 'One side only';
  const rounded = Math.round(Math.abs(percent));
  if (rounded === 0) return 'Even';
  return `${rounded}% ${percent > 0 ? 'left' : 'right'}`;
};

/**
 * Left vs right totals per week for every movement logged one side at a time.
 * Deliberately a plain table rather than a chart: the useful question is "are
 * my sides drifting apart", which a number answers directly.
 */
export function SideComparison({ state }: SideComparisonProps) {
  const rows = useMemo(
    () =>
      unilateralMovements(state)
        .map((movementId) => ({
          movementId,
          name: state.movements[movementId]?.name ?? 'Unknown exercise',
          weeks: sideProgression(state, movementId).slice(-6).reverse(),
        }))
        .filter((entry) => entry.weeks.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state],
  );

  if (rows.length === 0) {
    return (
      <p className="text-muted py-2 text-[13px]">
        Nothing tracked per side yet. Turn on “Track left and right separately”
        for an exercise in your routine, and the comparison shows up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map((entry) => (
        <section key={entry.movementId}>
          <h3 className="text-ocean-deep text-[14px] font-semibold">
            {entry.name}
          </h3>
          <div className="-mx-1 overflow-x-auto">
            <table className="mt-1 w-full min-w-[320px] border-collapse text-left">
              <thead>
                <tr className="text-muted text-[11px] font-bold tracking-wide uppercase">
                  <th scope="col" className="py-1 pr-2 font-bold">
                    Week
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-bold">
                    Left
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-bold">
                    Right
                  </th>
                  <th scope="col" className="py-1 text-right font-bold">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {entry.weeks.map((week) => {
                  const gap = imbalancePercent(week.left, week.right);
                  return (
                    <tr key={week.weekKey} className="text-[13px]">
                      <th
                        scope="row"
                        className="tnum text-muted py-1.5 pr-2 font-normal whitespace-nowrap"
                      >
                        {formatWeekLabel(week.weekKey)}
                      </th>
                      <td className="tnum text-ocean-deep py-1.5 pr-2 text-right">
                        {formatVolume(week.left)}
                      </td>
                      <td className="tnum text-ocean-deep py-1.5 pr-2 text-right">
                        {formatVolume(week.right)}
                      </td>
                      <td
                        className={[
                          'tnum py-1.5 text-right',
                          gap !== null && Math.abs(gap) >= 10
                            ? 'text-sunset-orange font-semibold'
                            : 'text-muted',
                        ].join(' ')}
                      >
                        {describeImbalance(gap)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-muted text-[12px] leading-relaxed">
        Volume is weight × reps for each side. A gap of 10% or more is
        highlighted — worth watching, not necessarily worth worrying about.
      </p>
    </div>
  );
}
