'use client';

import { Check, X } from 'lucide-react';
import type { SetEntry, SetKind, SideEntry } from '@/lib/types';
import { isSetComplete, setKind } from '@/lib/completion';
import type { LoadMode } from '@/lib/measure';

type Side = 'left' | 'right';

const KIND_OPTIONS: { value: SetKind; label: string }[] = [
  { value: 'working', label: 'Working' },
  { value: 'warmup', label: 'Warmup' },
  { value: 'drop', label: 'Drop' },
];

type SetRowProps = {
  exerciseName: string;
  setIndex: number;
  set: SetEntry;
  isLastRow: boolean;
  unilateral: boolean;
  loadMode: LoadMode;
  onChange: (field: keyof SideEntry, value: string, side: Side) => void;
  onRemove: () => void;
  onAdvance: () => void;
  /** Toggle the explicit completion state. The ONLY thing that starts rest. */
  onToggleDone: () => void;
  onKindChange: (kind: SetKind) => void;
  onFailureChange: (reached: boolean) => void;
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
  loadMode,
  onChange,
  onRemove,
  onAdvance,
  onToggleDone,
  onKindChange,
  onFailureChange,
  registerWeightInput,
}: SetRowProps) {
  const isDone = set.done === true;
  const canComplete = isSetComplete(set, { loadMode, unilateral });
  /**
   * Bilateral labels are byte-identical to the pre-unilateral ones; the side
   * qualifier is only added when the slot actually tracks two sides.
   */
  const label = (field: string, side: Side): string =>
    unilateral
      ? `${exerciseName} set ${setIndex + 1} ${side} ${field}`
      : `${exerciseName} set ${setIndex + 1} ${field}`;

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
        onKeyDown={onKeyDown(isLastSide)}
      />
    </>
  );

  /**
   * The row number doubles as the completion control. Finishing a set is the
   * commonest action in a session, so it gets the leading cell rather than a
   * sixth column that would not fit a 320px screen.
   */
  const doneButton = (label: string) => (
    <button
      type="button"
      onClick={onToggleDone}
      disabled={!isDone && !canComplete}
      aria-pressed={isDone}
      data-set-done={isDone ? 'true' : 'false'}
      className={[
        'grid h-11 w-full place-items-center rounded-[10px] border transition-colors duration-150',
        isDone
          ? 'border-ocean-blue bg-ocean-blue text-white'
          : 'border-hairline bg-surface text-muted',
        !isDone && !canComplete ? 'cursor-not-allowed opacity-45' : '',
      ].join(' ')}
    >
      {isDone ? (
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
      ) : (
        <span className="tnum text-[12px]" aria-hidden="true">
          {label}
        </span>
      )}
      <span className="sr-only">
        {isDone ? 'Reopen' : 'Complete'} {exerciseName} set {setIndex + 1}
      </span>
    </button>
  );

  /**
   * Kind and failure are separate controls because they are separate facts: a
   * working set and a drop set can both be taken to failure.
   */
  const kindControls = (
    <div className="mt-1 flex flex-wrap items-center gap-2 pl-0.5">
      <label className="text-muted flex items-center gap-1 text-[11px]">
        <span className="sr-only">
          {exerciseName} set {setIndex + 1} type
        </span>
        <select
          value={setKind(set)}
          onChange={(event) => onKindChange(event.target.value as SetKind)}
          className="border-hairline bg-card text-ocean-deep min-h-11 rounded-[8px] border px-1.5 text-[11px]"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-muted flex min-h-11 items-center gap-1 text-[11px]">
        <input
          type="checkbox"
          checked={set.reachedFailure === true}
          onChange={(event) => onFailureChange(event.target.checked)}
          className="accent-ocean-blue h-4 w-4"
        />
        To failure
      </label>
    </div>
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
      <div>
        <div className={gridClass}>
          {doneButton(String(setIndex + 1))}
          {sideInputs('left', set, true)}
          {removeButton}
        </div>
        {kindControls}
      </div>
    );
  }

  const right = set.right ?? { weight: '', reps: '', rpe: '' };

  return (
    <div className="border-hairline rounded-[10px] border border-dashed p-1.5">
      <div className={gridClass}>
        {doneButton(`${setIndex + 1}L`)}
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
      {kindControls}
    </div>
  );
}
