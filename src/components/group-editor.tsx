'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  MIN_GROUP_SLOTS,
  groupKindLabel,
  newGroupId,
  validateGroup,
  type GroupProblem,
} from '@/lib/groups';
import { resolveSlotName } from '@/lib/routine';
import type {
  ExerciseGroup,
  ExerciseGroupKind,
  Movement,
  RoutineDay,
} from '@/lib/types';

const iconButton =
  'rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft grid h-11 w-11 shrink-0 place-items-center border transition-colors duration-150 disabled:opacity-40 disabled:hover:bg-card';

const secondaryButton =
  'rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center justify-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150';

const numberField =
  'border-hairline bg-card text-ocean-deep focus:border-ocean-blue mt-1 h-11 w-full rounded-[10px] border px-3 font-normal transition-colors duration-150';

/**
 * Empty means "not set" and inherits the global rest; anything else must be a
 * whole number of seconds. `NaN` is returned rather than silently coerced, so a
 * typo fails validation loudly instead of becoming a rest of zero.
 */
const parseRest = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
};

const parseRounds = (value: string): number => {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
};

type GroupEditorProps = {
  day: RoutineDay;
  movements: Record<string, Movement>;
  /** The group being edited, or null when creating a new one. */
  existing: ExerciseGroup | null;
  initialKind: ExerciseGroupKind;
  onSave: (group: ExerciseGroup) => void;
  onCancel: () => void;
};

/**
 * Build or edit one superset/circuit.
 *
 * Reordering is by BUTTON, not by drag: a keyboard and a screen reader reach
 * the same controls a mouse does, and there is no pointer-only path through
 * this form. Nothing is saved while it is invalid, and an overlap is explained
 * rather than resolved by quietly moving an exercise out of its other group.
 */
export function GroupEditor({
  day,
  movements,
  existing,
  initialKind,
  onSave,
  onCancel,
}: GroupEditorProps) {
  const [kind, setKind] = useState<ExerciseGroupKind>(
    existing?.kind ?? initialKind,
  );
  const [slotIds, setSlotIds] = useState<string[]>(existing?.slotIds ?? []);
  const [rounds, setRounds] = useState(String(existing?.rounds ?? 3));
  const [restExercises, setRestExercises] = useState(
    existing?.restBetweenExercisesSec === undefined
      ? ''
      : String(existing.restBetweenExercisesSec),
  );
  const [restRounds, setRestRounds] = useState(
    existing?.restBetweenRoundsSec === undefined
      ? ''
      : String(existing.restBetweenRoundsSec),
  );
  const [problems, setProblems] = useState<GroupProblem[]>([]);

  const groupId = existing?.groupId ?? newGroupId();
  const others = (day.groups ?? []).filter(
    (group) => group.groupId !== groupId,
  );
  const nameOf = (slotId: string): string => {
    const slot = day.exercises.find((entry) => entry.slotId === slotId);
    return slot ? resolveSlotName(movements, slot) : slotId;
  };
  const ownerOf = (slotId: string): ExerciseGroup | undefined =>
    others.find((group) => group.slotIds.includes(slotId));

  const toggle = (slotId: string, checked: boolean) => {
    setProblems([]);
    setSlotIds((previous) =>
      checked
        ? previous.includes(slotId)
          ? previous
          : [...previous, slotId]
        : previous.filter((entry) => entry !== slotId),
    );
  };

  const moveTo = (slotId: string, to: number) => {
    setSlotIds((previous) => {
      const from = previous.indexOf(slotId);
      if (from === -1) return previous;
      const bounded = Math.max(0, Math.min(previous.length - 1, to));
      if (bounded === from) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(bounded, 0, moved);
      return next;
    });
  };

  const submit = () => {
    const restEx = parseRest(restExercises);
    const restRd = parseRest(restRounds);
    const draft: ExerciseGroup = {
      groupId,
      kind,
      slotIds,
      rounds: parseRounds(rounds),
      ...(restEx !== undefined ? { restBetweenExercisesSec: restEx } : {}),
      ...(restRd !== undefined ? { restBetweenRoundsSec: restRd } : {}),
    };
    const found = validateGroup(
      draft,
      day.exercises.map((slot) => slot.slotId),
      others,
    );
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    setProblems([]);
    onSave(draft);
  };

  return (
    <div>
      <h3 className="text-ocean-deep text-[15px] font-bold">
        {existing ? `Edit ${groupKindLabel(kind).toLowerCase()}` : 'New group'}
      </h3>

      <fieldset className="mt-3">
        <legend className="text-ocean-deep text-[13px] font-semibold">
          Group type
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {(['superset', 'circuit'] as const).map((option) => (
            <label
              key={option}
              className="rounded-control border-hairline bg-card text-ocean-deep inline-flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-[13px] font-semibold"
            >
              <input
                type="radio"
                name={`group-kind-${groupId}`}
                value={option}
                checked={kind === option}
                onChange={() => {
                  setKind(option);
                  setProblems([]);
                }}
                className="accent-ocean-blue h-5 w-5"
              />
              {groupKindLabel(option)}
            </label>
          ))}
        </div>
        <p className="text-muted mt-1 text-[12px]">
          {kind === 'superset'
            ? 'Back-to-back exercises, little or no rest between them.'
            : 'Several exercises in a loop, repeated for rounds.'}
        </p>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-ocean-deep text-[13px] font-semibold">
          Exercises in this group
        </legend>
        <p className="text-muted mt-0.5 text-[12px]">
          Pick at least {MIN_GROUP_SLOTS} from this day.
        </p>
        <ul className="mt-1.5">
          {day.exercises.map((slot) => {
            const owner = ownerOf(slot.slotId);
            const name = resolveSlotName(movements, slot);
            return (
              <li key={slot.slotId} className="py-0.5">
                <label className="text-ocean-deep flex min-h-11 items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={slotIds.includes(slot.slotId)}
                    disabled={Boolean(owner)}
                    onChange={(event) =>
                      toggle(slot.slotId, event.target.checked)
                    }
                    className="accent-ocean-blue h-5 w-5 shrink-0 disabled:opacity-40"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{name}</span>
                    {owner ? (
                      <span className="text-muted block text-[12px]">
                        Already in another{' '}
                        {groupKindLabel(owner.kind).toLowerCase()} — remove it
                        there first
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {slotIds.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-ocean-deep text-[13px] font-semibold">
            Order within a round
          </h4>
          <ol className="divide-hairline mt-1 divide-y">
            {slotIds.map((slotId, index) => (
              <li key={slotId} className="flex items-center gap-2 py-2">
                <span className="tnum text-muted w-6 shrink-0 text-[13px] font-semibold">
                  {index + 1}.
                </span>
                <span className="text-ocean-deep min-w-0 flex-1 truncate text-[14px] font-semibold">
                  {nameOf(slotId)}
                </span>
                <button
                  type="button"
                  className={iconButton}
                  disabled={index === 0}
                  onClick={() => moveTo(slotId, index - 1)}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">
                    Move {nameOf(slotId)} earlier in the group
                  </span>
                </button>
                <button
                  type="button"
                  className={iconButton}
                  disabled={index === slotIds.length - 1}
                  onClick={() => moveTo(slotId, index + 1)}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">
                    Move {nameOf(slotId)} later in the group
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <label className="text-ocean-deep text-[13px] font-semibold">
          Rounds
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={rounds}
            onChange={(event) => {
              setRounds(event.target.value);
              setProblems([]);
            }}
            className={numberField}
          />
        </label>
        <label className="text-ocean-deep text-[13px] font-semibold">
          Rest between exercises (seconds)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="Use my usual rest"
            value={restExercises}
            onChange={(event) => {
              setRestExercises(event.target.value);
              setProblems([]);
            }}
            className={numberField}
          />
        </label>
        <label className="text-ocean-deep text-[13px] font-semibold">
          Rest between rounds (seconds)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="Use my usual rest"
            value={restRounds}
            onChange={(event) => {
              setRestRounds(event.target.value);
              setProblems([]);
            }}
            className={numberField}
          />
        </label>
        <p className="text-muted text-[12px]">
          Leave a rest box empty to keep your usual rest. The last exercise of
          the last round always uses your usual rest.
        </p>
      </div>

      {problems.length > 0 ? (
        <div
          role="alert"
          data-group-error
          className="rounded-control border-sunset-orange/50 bg-orange-soft mt-3 border p-3"
        >
          <ul className="text-ocean-deep space-y-1 text-[13px] leading-relaxed">
            {problems.map((problem) => (
              <li key={`${problem.code}-${problem.message}`}>
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          className="rounded-control bg-ocean-blue hover:bg-ocean-deep inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-[14px] font-semibold text-white transition-colors duration-150"
        >
          Save group
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`${secondaryButton} flex-1`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
