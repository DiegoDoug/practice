'use client';

import { X } from 'lucide-react';
import { isCompleteSet, type SetEntry, type SideEntry } from '@/lib/types';

type Side = 'left' | 'right';

type SetRowProps = {
  exerciseName: string;
  setIndex: number;
  set: SetEntry;
  isLastRow: boolean;
  unilateral: boolean;
  onChange: (field: keyof SideEntry, value: string, side: Side) => void;
  onRemove: () => void;
  onAdvance: () => void;
  onSetComplete?: () => void;
  registerWeightInput: (node: HTMLInputElement | null) => void;
};

const cellClass =
  'tnum h-11 w-full min-w-0 rounded-[10px] border border-hairline bg-card px-1 text-center text-ocean-deep transition-colors duration-150 focus:border-ocean-blue';

const gridClass =
  'grid w-full grid-cols-[26px_1fr_1fr_1fr_36px] items-center gap-1.5 sm:grid-cols-[32px_1fr_1fr_1fr_40px] sm:gap-2';

export function SetRow({
  exerciseName,
  setIndex,
  set,
  isLastRow,
  unilateral,
  onChange,
  onRemove,
  onAdvance,
  onSetComplete,
  registerWeightInput,
}: SetRowProps) {
  /**
   * Bilateral labels are byte-identical to the pre-unilateral ones; the side
   * qualifier is only added when the slot actually tracks two sides.
   */
  const label = (field: string, side: Side): string =>
    unilateral
      ? `${exerciseName} set ${setIndex + 1} ${side} ${field}`
      : `${exerciseName} set ${setIndex + 1} ${field}`;

  /**
   * Blur is the signal a set was logged, but it fires on every field, so the
   * rest timer starts only once the row actually holds weight and reps — both
   * sides of a unilateral row — and never part-way through typing a number.
   */
  const onBlur = () => {
    if (isCompleteSet(set, unilateral)) onSetComplete?.();
  };

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

  const sideInputs = (side: Side, values: SideEntry, isLastSide: boolean) => (
    <>
      <input
        ref={side === 'left' ? registerWeightInput : undefined}
        data-set-field="weight"
        data-side={side}
        className={cellClass}
        type="number"
        inputMode="decimal"
        step="0.5"
        min="0"
        aria-label={label('weight', side)}
        value={values.weight}
        onChange={(event) => onChange('weight', event.target.value, side)}
        onBlur={onBlur}
        onKeyDown={onKeyDown(false)}
      />
      <input
        data-set-field="reps"
        data-side={side}
        className={cellClass}
        type="number"
        inputMode="numeric"
        step="1"
        min="0"
        aria-label={label('reps', side)}
        value={values.reps}
        onChange={(event) => onChange('reps', event.target.value, side)}
        onBlur={onBlur}
        onKeyDown={onKeyDown(false)}
      />
      <input
        data-set-field="rpe"
        data-side={side}
        className={cellClass}
        type="number"
        inputMode="decimal"
        step="0.5"
        min="1"
        max="10"
        aria-label={label('RPE', side)}
        value={values.rpe}
        onChange={(event) => onChange('rpe', event.target.value, side)}
        onBlur={onBlur}
        onKeyDown={onKeyDown(isLastSide)}
      />
    </>
  );

  const removeButton = (
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
  );

  if (!unilateral) {
    return (
      <div className={gridClass}>
        <span
          className="tnum text-muted text-center text-[12px]"
          aria-hidden="true"
        >
          {setIndex + 1}
        </span>
        {sideInputs('left', set, true)}
        {removeButton}
      </div>
    );
  }

  const right = set.right ?? { weight: '', reps: '', rpe: '' };

  return (
    <div className="border-hairline rounded-[10px] border border-dashed p-1.5">
      <div className={gridClass}>
        <span
          className="tnum text-muted text-center text-[11px] font-semibold"
          aria-hidden="true"
        >
          {setIndex + 1}L
        </span>
        {sideInputs('left', set, false)}
        {removeButton}
      </div>
      <div className={`${gridClass} mt-1.5`}>
        <span
          className="tnum text-muted text-center text-[11px] font-semibold"
          aria-hidden="true"
        >
          R
        </span>
        {sideInputs('right', right, true)}
        <span />
      </div>
    </div>
  );
}
