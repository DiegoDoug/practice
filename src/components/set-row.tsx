'use client';

import { X } from 'lucide-react';
import type { SetEntry } from '@/lib/types';

type SetRowProps = {
  exerciseName: string;
  setIndex: number;
  set: SetEntry;
  isLastRow: boolean;
  onChange: (field: keyof SetEntry, value: string) => void;
  onRemove: () => void;
  onAdvance: () => void;
  registerWeightInput: (node: HTMLInputElement | null) => void;
};

const cellClass =
  'tnum h-11 w-full min-w-0 rounded-[10px] border border-hairline bg-card px-1 text-center text-ocean-deep transition-colors duration-150 focus:border-ocean-blue';

export function SetRow({
  exerciseName,
  setIndex,
  set,
  isLastRow,
  onChange,
  onRemove,
  onAdvance,
  registerWeightInput,
}: SetRowProps) {
  const label = (field: string) =>
    `${exerciseName} set ${setIndex + 1} ${field}`;

  /** Enter walks forward through the row; from the last field of the last row
   *  it appends a new set and focuses its weight field. */
  const onKeyDown =
    (isFinalField: boolean) =>
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (isFinalField && isLastRow) {
        onAdvance();
        return;
      }
      const inputs = Array.from(
        event.currentTarget
          .closest('[data-exercise]')
          ?.querySelectorAll<HTMLInputElement>('input[data-set-field]') ?? [],
      );
      const position = inputs.indexOf(event.currentTarget);
      const next = inputs[position + 1];
      if (next) next.focus();
      else onAdvance();
    };

  return (
    <div className="grid w-full grid-cols-[26px_1fr_1fr_1fr_36px] items-center gap-1.5 sm:grid-cols-[32px_1fr_1fr_1fr_40px] sm:gap-2">
      <span
        className="tnum text-muted text-center text-[12px]"
        aria-hidden="true"
      >
        {setIndex + 1}
      </span>
      <input
        ref={registerWeightInput}
        data-set-field="weight"
        className={cellClass}
        type="number"
        inputMode="decimal"
        step="0.5"
        min="0"
        aria-label={label('weight')}
        value={set.weight}
        onChange={(event) => onChange('weight', event.target.value)}
        onKeyDown={onKeyDown(false)}
      />
      <input
        data-set-field="reps"
        className={cellClass}
        type="number"
        inputMode="numeric"
        step="1"
        min="0"
        aria-label={label('reps')}
        value={set.reps}
        onChange={(event) => onChange('reps', event.target.value)}
        onKeyDown={onKeyDown(false)}
      />
      <input
        data-set-field="rpe"
        className={cellClass}
        type="number"
        inputMode="decimal"
        step="0.5"
        min="1"
        max="10"
        aria-label={label('RPE')}
        value={set.rpe}
        onChange={(event) => onChange('rpe', event.target.value)}
        onKeyDown={onKeyDown(true)}
      />
      <button
        type="button"
        onClick={onRemove}
        className="border-hairline bg-surface text-muted hover:border-sunset-orange hover:text-sunset-orange grid h-11 w-full place-items-center rounded-[10px] border transition-colors duration-150"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">
          Remove {exerciseName} set {setIndex + 1}
        </span>
      </button>
    </div>
  );
}
