'use client';

import { Check } from 'lucide-react';
import type { RoutineDay } from '@/lib/types';
import { formatWeekLabel } from '@/lib/week';

type WeeklyOverviewProps = {
  days: RoutineDay[];
  weekKey: string;
  completion: Record<string, boolean>;
  activeDay: string;
  onSelect: (dayId: string) => void;
};

export function WeeklyOverview({
  days,
  weekKey,
  completion,
  activeDay,
  onSelect,
}: WeeklyOverviewProps) {
  const done = days.filter((day) => completion[day.dayId]).length;

  return (
    <section
      aria-labelledby="week-heading"
      className="rounded-card border-hairline bg-card mb-3.5 border p-4 shadow-[0_2px_10px_rgba(47,72,88,0.05)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-heading" className="text-ocean-deep text-[13px] font-bold">
          This week
        </h2>
        <p className="text-muted text-[12px]">
          <span className="tnum">{formatWeekLabel(weekKey)}</span> ·{' '}
          <span className="tnum">
            {done}/{days.length}
          </span>{' '}
          complete
        </p>
      </div>
      <ul className="mt-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {days.map((day) => {
          const isDone = Boolean(completion[day.dayId]);
          const isActive = day.dayId === activeDay;
          return (
            <li key={day.dayId} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(day.dayId)}
                aria-current={isActive ? 'true' : undefined}
                className={[
                  'flex min-h-[64px] w-full flex-col items-center justify-center gap-1 rounded-[11px] border px-0.5 py-2 transition-colors duration-150',
                  isDone
                    ? 'border-ocean-mist bg-ocean-mist/30'
                    : 'border-hairline bg-surface',
                  isActive ? 'ring-ocean-blue ring-2' : '',
                ].join(' ')}
              >
                <span
                  className={[
                    'grid h-5 w-5 place-items-center rounded-full border-2',
                    isDone
                      ? 'border-ocean-blue bg-ocean-blue text-white'
                      : 'border-hairline bg-card',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {isDone ? (
                    <Check className="h-3 w-3" strokeWidth={3} />
                  ) : null}
                </span>
                <span className="text-muted w-full truncate text-[10px]">
                  {day.label}
                </span>
                <span className="text-ocean-deep w-full truncate text-[11px] font-semibold">
                  {day.name}
                </span>
                <span className="sr-only">
                  {isDone ? 'Completed' : 'Not completed'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
