'use client';

import { useCallback, useRef, useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import { SetRow } from './set-row';
import { blankSet, type SetEntry } from '@/lib/types';
import {
  formatSetSummary,
  removeSet,
  repeatLast,
  updateSet,
  type PriorPerformance,
} from '@/lib/workout';
import { formatWeekLabel } from '@/lib/week';

type ExerciseCardProps = {
  dayId: string;
  index: number;
  name: string;
  group: string;
  sets: SetEntry[];
  prior: PriorPerformance | null;
  onSetsChange: (sets: SetEntry[]) => void;
  onRename: (name: string) => void;
};

export function ExerciseCard({
  dayId,
  index,
  name,
  group,
  sets,
  prior,
  onSetsChange,
  onRename,
}: ExerciseCardProps) {
  const [renamed, setRenamed] = useState(false);
  const weightInputs = useRef<(HTMLInputElement | null)[]>([]);

  const focusLastWeight = useCallback(() => {
    requestAnimationFrame(() => {
      const inputs = weightInputs.current.filter(Boolean);
      inputs[inputs.length - 1]?.focus();
    });
  }, []);

  const addSet = useCallback(() => {
    onSetsChange([...sets, blankSet()]);
    focusLastWeight();
  }, [focusLastWeight, onSetsChange, sets]);

  const onRepeatLast = useCallback(() => {
    onSetsChange(repeatLast(sets, prior));
    focusLastWeight();
  }, [focusLastWeight, onSetsChange, prior, sets]);

  const commitName = (value: string) => {
    const next = value.trim();
    if (next === name) return;
    onRename(next);
    setRenamed(true);
  };

  return (
    <li
      data-exercise={`${dayId}:${index}`}
      className="border-hairline border-b py-4 last:border-b-0 last:pb-1"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="min-w-[180px] flex-1">
          <span className="sr-only">Exercise {index + 1} display name</span>
          <input
            /* Keyed on the resolved name so an external change (a restore, a
               different day) re-seeds the field without extra state. */
            key={name}
            className="text-ocean-deep hover:border-hairline focus:border-ocean-blue focus:bg-card w-full rounded-[10px] border border-transparent bg-transparent px-1.5 py-1 text-[16px] font-bold transition-colors duration-150"
            defaultValue={name}
            onBlur={(event) => commitName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <span className="bg-ocean-mist/40 text-ocean-deep rounded-md px-2 py-0.5 text-[11px] font-semibold">
          {group}
        </span>
      </div>

      {renamed ? (
        <p className="text-muted mb-1.5 px-1.5 text-[12px]">
          Renamed for this template — it applies to this exercise in future
          weeks too.
        </p>
      ) : null}

      {prior ? (
        <p className="text-muted mb-2 px-1.5 text-[13px]">
          Last ({formatWeekLabel(prior.weekKey)}):{' '}
          <strong className="tnum text-ocean-deep font-semibold">
            {formatSetSummary(prior.sets[0])}
          </strong>
          {prior.sets.length > 1 ? ` · ${prior.sets.length} sets` : null}
        </p>
      ) : (
        <p className="text-muted mb-2 px-1.5 text-[13px]">
          No previous entry for this exercise yet.
        </p>
      )}

      <div
        className="text-muted mb-1 grid max-w-[520px] grid-cols-[26px_1fr_1fr_1fr_36px] gap-1.5 px-1 text-[10px] font-semibold tracking-wide uppercase sm:grid-cols-[32px_1fr_1fr_1fr_40px] sm:gap-2"
        aria-hidden="true"
      >
        <span className="text-center">Set</span>
        <span className="text-center">Weight</span>
        <span className="text-center">Reps</span>
        <span className="text-center">RPE</span>
        <span />
      </div>

      <div className="flex max-w-[520px] flex-col gap-1.5">
        {sets.map((set, setIndex) => (
          <SetRow
            key={setIndex}
            exerciseName={name}
            setIndex={setIndex}
            set={set}
            isLastRow={setIndex === sets.length - 1}
            registerWeightInput={(node) => {
              weightInputs.current[setIndex] = node;
            }}
            onChange={(field, value) =>
              onSetsChange(updateSet(sets, setIndex, field, value))
            }
            onRemove={() => {
              weightInputs.current = [];
              onSetsChange(removeSet(sets, setIndex));
            }}
            onAdvance={addSet}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={addSet}
          className="rounded-control text-ocean-blue hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 px-1.5 text-[13px] font-semibold transition-colors duration-150"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add set
          <span className="sr-only">to {name}</span>
        </button>
        {prior ? (
          <button
            type="button"
            onClick={onRepeatLast}
            className="rounded-control text-ocean-blue hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 px-1.5 text-[13px] font-semibold transition-colors duration-150"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Repeat last
            <span className="sr-only">set for {name}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}
