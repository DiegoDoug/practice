'use client';

import { PROGRAM } from '@/lib/program';

type DayTabsProps = {
  activeDay: string;
  completion: Record<string, boolean>;
  onSelect: (dayId: string) => void;
};

export function DayTabs({ activeDay, completion, onSelect }: DayTabsProps) {
  return (
    <nav aria-label="Training days" className="mb-3.5">
      <ul className="no-scrollbar flex gap-1.5 overflow-x-auto px-0.5 pb-1">
        {PROGRAM.map((day) => {
          const isActive = day.id === activeDay;
          return (
            <li key={day.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(day.id)}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'rounded-control min-h-11 border px-3 text-[13px] whitespace-nowrap transition-colors duration-150',
                  isActive
                    ? 'border-ocean-blue bg-ocean-blue font-semibold text-white'
                    : 'border-hairline bg-card text-muted hover:text-ocean-deep',
                ].join(' ')}
              >
                {day.label} · {day.name}
                {completion[day.id] ? (
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
