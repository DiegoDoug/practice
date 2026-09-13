'use client';

import type { RoutineDay } from '@/lib/types';

type DayTabsProps = {
  days: RoutineDay[];
  activeDay: string;
  completion: Record<string, boolean>;
  onSelect: (dayId: string) => void;
};

export function DayTabs({
  days,
  activeDay,
  completion,
  onSelect,
}: DayTabsProps) {
  return (
    <nav aria-label="Training days" className="mb-3.5">
      <ul className="no-scrollbar flex gap-1.5 overflow-x-auto px-0.5 pb-1">
        {days.map((day) => {
          const isActive = day.dayId === activeDay;
          return (
            <li key={day.dayId} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(day.dayId)}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'rounded-control min-h-11 border px-3 text-[13px] whitespace-nowrap transition-colors duration-150',
                  isActive
                    ? 'border-ocean-blue bg-ocean-blue font-semibold text-white'
                    : 'border-hairline bg-card text-muted hover:text-ocean-deep',
                ].join(' ')}
              >
                {day.name ? `${day.label} · ${day.name}` : day.label}
                {completion[day.dayId] ? (
                  <span className="sr-only"> (completed)</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
