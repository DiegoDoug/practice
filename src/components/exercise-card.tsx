'use client';

import { useCallback, useRef, useState } from 'react';
import { Plus, Repeat, RotateCcw } from 'lucide-react';
import { SetRow } from './set-row';
import {
  blankSet,
  type SetEntry,
  type SetKind,
  type SideEntry,
} from '@/lib/types';
import { markDone, reopen, setReachedFailure, setSetKind } from '@/lib/sets';
import type { LoadMode } from '@/lib/measure';
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
  /** Render position — used for the DOM hook and the accessible index only. */
  index: number;
  slotId: string;
  name: string;
  group: string;
  unilateral: boolean;
  loadMode: LoadMode;
  sets: SetEntry[];
  prior: PriorPerformance | null;
  /** Set when the prior performance was logged under a different movement. */
  priorNote?: string;
  onSetsChange: (sets: SetEntry[]) => void;
  onRename: (name: string) => void;
  /** Called only when a set actually transitions into completed. */
  onSetComplete?: () => void;
  onSubstitute?: () => void;
  /** Set when this slot is swapped for this week only. */
  substituted?: boolean;
  onUndoSubstitute?: () => void;
};

export function ExerciseCard({
  dayId,
  index,
  slotId,
  name,
  group,
  unilateral,
  loadMode,
  sets,
  prior,
  priorNote,
  onSetsChange,
  onRename,
  onSetComplete,
  onSubstitute,
  substituted,
  onUndoSubstitute,
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
    onSetsChange([...sets, blankSet(unilateral)]);
    focusLastWeight();
  }, [focusLastWeight, onSetsChange, sets, unilateral]);

  /**
   * Completion is the one action that starts rest, and only on the
   * unfinished → completed edge. `markDone` returns the same array when
   * nothing changed, so a second click on an already-ticked set cannot
   * restart a countdown that is already running.
   */
  const onToggleDone = useCallback(
    (setIndex: number) => {
      if (sets[setIndex]?.done) {
        onSetsChange(reopen(sets, setIndex));
        return;
      }
      const next = markDone(
        sets,
        setIndex,
        { loadMode, unilateral },
        Date.now(),
      );
      if (next === sets) return;
      onSetsChange(next);
      onSetComplete?.();
    },
    [loadMode, onSetComplete, onSetsChange, sets, unilateral],
  );

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
      data-slot={slotId}
      className="border-hairline border-b py-4 last:border-b-0 last:pb-1"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="min-w-[180px] flex-1">
          <span className="sr-only">Exercise {index + 1} display name</span>
          <input
            /* Keyed on the resolved name so an external change (a restore, a
               substitution, a different day) re-seeds the field. */
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
        {unilateral ? (
          <span className="bg-gold-soft text-gold-ink border-gold-edge rounded-md border px-2 py-0.5 text-[11px] font-semibold">
            Unilateral
          </span>
        ) : null}
        {substituted ? (
          <span className="bg-gold-soft text-gold-ink border-gold-edge rounded-md border px-2 py-0.5 text-[11px] font-semibold">
            Swapped this week
          </span>
        ) : null}
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
          Last{prior.date ? ` (${formatWeekLabel(prior.date)})` : ''}:{' '}
          <strong className="tnum text-ocean-deep font-semibold">
            {formatSetSummary(prior.sets[0])}
          </strong>
          {prior.sets.length > 1 ? ` · ${prior.sets.length} sets` : null}
          {priorNote ? ` · ${priorNote}` : null}
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
            key={set.setId ?? setIndex}
            exerciseName={name}
            setIndex={setIndex}
            set={set}
            unilateral={unilateral}
            isLastRow={setIndex === sets.length - 1}
            registerWeightInput={(node) => {
              weightInputs.current[setIndex] = node;
            }}
            loadMode={loadMode}
            onChange={(field: keyof SideEntry, value, side) =>
              onSetsChange(
                updateSet(sets, setIndex, field, value, side, {
                  loadMode,
                  unilateral,
                }),
              )
            }
            onRemove={() => {
              weightInputs.current = [];
              onSetsChange(removeSet(sets, setIndex, unilateral));
            }}
            onAdvance={addSet}
            onToggleDone={() => onToggleDone(setIndex)}
            onKindChange={(kind: SetKind) =>
              onSetsChange(setSetKind(sets, setIndex, kind))
            }
            onFailureChange={(reached: boolean) =>
              onSetsChange(setReachedFailure(sets, setIndex, reached))
            }
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
        {onSubstitute ? (
          <button
            type="button"
            onClick={onSubstitute}
            className="rounded-control text-ocean-blue hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 px-1.5 text-[13px] font-semibold transition-colors duration-150"
          >
            <Repeat className="h-4 w-4" aria-hidden="true" />
            Substitute
            <span className="sr-only">{name}</span>
          </button>
        ) : null}
        {substituted && onUndoSubstitute ? (
          <button
            type="button"
            onClick={onUndoSubstitute}
            className="rounded-control text-ocean-blue hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 px-1.5 text-[13px] font-semibold transition-colors duration-150"
          >
            Undo swap
            <span className="sr-only">for {name}</span>
          </button>
        ) : null}
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
