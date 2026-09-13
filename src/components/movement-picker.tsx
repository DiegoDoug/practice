'use client';

import { useMemo, useState } from 'react';
import type { Movement } from '@/lib/types';

type MovementPickerProps = {
  movements: Record<string, Movement>;
  /** Shown first, above the full list. */
  suggested?: Movement[];
  suggestedLabel?: string;
  onPick: (movementId: string) => void;
  /** Movement to leave out, e.g. the one being replaced. */
  excludeId?: string;
};

const groupOf = (movement: Movement): string => movement.group || 'Other';

/**
 * Searchable list of library movements, grouped by muscle group. Shared by the
 * routine builder's "add exercise" and the substitute flow.
 */
export function MovementPicker({
  movements,
  suggested = [],
  suggestedLabel = 'Suggested',
  onPick,
  excludeId,
}: MovementPickerProps) {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = Object.values(movements)
      .filter((movement) => movement.id !== excludeId)
      .filter(
        (movement) =>
          needle === '' ||
          movement.name.toLowerCase().includes(needle) ||
          movement.group.toLowerCase().includes(needle) ||
          movement.equipment.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    const byGroup = new Map<string, Movement[]>();
    for (const movement of matches) {
      const key = groupOf(movement);
      byGroup.set(key, [...(byGroup.get(key) ?? []), movement]);
    }
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [excludeId, movements, query]);

  const row = (movement: Movement) => (
    <li key={movement.id}>
      <button
        type="button"
        onClick={() => onPick(movement.id)}
        className="hover:bg-mist-soft rounded-control flex min-h-11 w-full items-center justify-between gap-3 px-2 py-2 text-left transition-colors duration-150"
      >
        <span className="text-ocean-deep min-w-0 truncate text-[14px] font-semibold">
          {movement.name}
        </span>
        <span className="text-muted shrink-0 text-[12px]">
          {movement.equipment}
          {movement.unilateral ? ' · per side' : ''}
        </span>
      </button>
    </li>
  );

  const visibleSuggested = suggested.filter((m) => m.id !== excludeId);

  return (
    <div>
      <label className="block">
        <span className="sr-only">Search exercises</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, muscle group or equipment"
          className="border-hairline bg-card text-ocean-deep focus:border-ocean-blue h-11 w-full rounded-[10px] border px-3 transition-colors duration-150"
        />
      </label>

      <div className="mt-3 max-h-[45dvh] overflow-y-auto">
        {visibleSuggested.length > 0 && query.trim() === '' ? (
          <section className="mb-3">
            <h3 className="text-muted mb-1 px-2 text-[11px] font-bold tracking-wide uppercase">
              {suggestedLabel}
            </h3>
            <ul>{visibleSuggested.map(row)}</ul>
          </section>
        ) : null}

        {grouped.length === 0 ? (
          <p className="text-muted px-2 py-3 text-[13px]">
            No exercises match “{query.trim()}”.
          </p>
        ) : (
          grouped.map(([group, items]) => (
            <section key={group} className="mb-3">
              <h3 className="text-muted mb-1 px-2 text-[11px] font-bold tracking-wide uppercase">
                {group}
              </h3>
              <ul>{items.map(row)}</ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
