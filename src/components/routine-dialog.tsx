'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';
import { Dialog } from './dialog';
import {
  activeDays,
  addDay,
  dayHasHistory,
  duplicateDay,
  duplicateExercise,
  findDay,
  moveDay,
  moveExercise,
  removeDay,
  removeExercise,
  renameDay,
  resolveSlotGroup,
  resolveSlotName,
  slotHasHistory,
} from '@/lib/routine';
import type { WorkoutState } from '@/lib/types';

type RoutineDialogProps = {
  open: boolean;
  onClose: () => void;
  state: WorkoutState;
  /** Applies an edit and re-freezes the current week's open snapshots. */
  onEdit: (
    edit: (previous: WorkoutState) => WorkoutState,
    announcement: string,
  ) => void;
  onAddExercise: (dayId: string) => void;
};

const iconButton =
  'rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft grid h-11 w-11 shrink-0 place-items-center border transition-colors duration-150 disabled:opacity-40 disabled:hover:bg-card';

const secondaryButton =
  'rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150';

export function RoutineDialog({
  open,
  onClose,
  state,
  onEdit,
  onAddExercise,
}: RoutineDialogProps) {
  const [openDayId, setOpenDayId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const days = activeDays(state);
  const day = openDayId ? findDay(state.routine, openDayId) : undefined;

  const close = () => {
    setOpenDayId(null);
    setConfirming(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={day ? `Edit ${day.label}` : 'Routine'}
      description={
        day
          ? 'Reorder or remove exercises. Anything you have already logged is kept.'
          : 'Add, rename, duplicate or reorder your training days. Past workouts keep the names they were logged under.'
      }
    >
      {day ? (
        <div>
          <button
            type="button"
            onClick={() => setOpenDayId(null)}
            className={secondaryButton}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All days
          </button>

          <div className="mt-4 flex flex-col gap-2">
            <label className="text-ocean-deep text-[13px] font-semibold">
              Day label
              <input
                key={`${day.dayId}-label`}
                defaultValue={day.label}
                onBlur={(event) =>
                  onEdit(
                    (previous) =>
                      renameDay(previous, day.dayId, {
                        label: event.target.value,
                      }),
                    'Day label updated.',
                  )
                }
                className="border-hairline bg-card text-ocean-deep focus:border-ocean-blue mt-1 h-11 w-full rounded-[10px] border px-3 font-normal transition-colors duration-150"
              />
            </label>
            <label className="text-ocean-deep text-[13px] font-semibold">
              Workout name
              <input
                key={`${day.dayId}-name`}
                defaultValue={day.name}
                placeholder="e.g. Chest, Shoulders &amp; Triceps"
                onBlur={(event) =>
                  onEdit(
                    (previous) =>
                      renameDay(previous, day.dayId, {
                        name: event.target.value,
                      }),
                    'Workout name updated.',
                  )
                }
                className="border-hairline bg-card text-ocean-deep focus:border-ocean-blue mt-1 h-11 w-full rounded-[10px] border px-3 font-normal transition-colors duration-150"
              />
            </label>
          </div>

          <h3 className="text-ocean-deep mt-5 mb-1 text-[13px] font-bold">
            Exercises
          </h3>
          {day.exercises.length === 0 ? (
            <p className="text-muted py-2 text-[13px]">
              No exercises yet. Add one to start logging this day.
            </p>
          ) : (
            <ul className="divide-hairline divide-y">
              {day.exercises.map((slot, index) => {
                const hasHistory = slotHasHistory(state, slot.slotId);
                const name = resolveSlotName(state.movements, slot);
                return (
                  <li
                    key={slot.slotId}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-ocean-deep truncate text-[14px] font-semibold">
                        {name}
                      </p>
                      <p className="text-muted text-[12px]">
                        {resolveSlotGroup(state.movements, slot)}
                        {hasHistory ? ' · has history' : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={iconButton}
                      disabled={index === 0}
                      onClick={() =>
                        onEdit(
                          (previous) =>
                            moveExercise(
                              previous,
                              day.dayId,
                              slot.slotId,
                              index - 1,
                            ),
                          `${name} moved up.`,
                        )
                      }
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Move {name} up</span>
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      disabled={index === day.exercises.length - 1}
                      onClick={() =>
                        onEdit(
                          (previous) =>
                            moveExercise(
                              previous,
                              day.dayId,
                              slot.slotId,
                              index + 1,
                            ),
                          `${name} moved down.`,
                        )
                      }
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Move {name} down</span>
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      onClick={() =>
                        onEdit(
                          (previous) =>
                            duplicateExercise(previous, day.dayId, slot.slotId),
                          `${name} duplicated.`,
                        )
                      }
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Duplicate {name}</span>
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      onClick={() =>
                        onEdit(
                          (previous) =>
                            removeExercise(previous, day.dayId, slot.slotId),
                          hasHistory
                            ? `${name} removed from the plan. Its logged sets are kept.`
                            : `${name} removed.`,
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">
                        Remove {name}
                        {hasHistory
                          ? ' from the plan, keeping its history'
                          : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={() => onAddExercise(day.dayId)}
            className="rounded-control bg-ocean-blue hover:bg-ocean-deep mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-[14px] font-semibold text-white transition-colors duration-150"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add exercise
          </button>
        </div>
      ) : (
        <div>
          <ul className="divide-hairline divide-y">
            {days.map((entry, index) => {
              const hasHistory = dayHasHistory(state, entry.dayId);
              const title = entry.name
                ? `${entry.label} — ${entry.name}`
                : entry.label;
              return (
                <li key={entry.dayId} className="flex items-center gap-2 py-2">
                  <button
                    type="button"
                    onClick={() => setOpenDayId(entry.dayId)}
                    className="hover:bg-mist-soft rounded-control min-w-0 flex-1 px-1 py-2 text-left transition-colors duration-150"
                  >
                    <span className="text-ocean-deep block truncate text-[14px] font-semibold">
                      {title}
                    </span>
                    <span className="text-muted text-[12px]">
                      {entry.exercises.length}{' '}
                      {entry.exercises.length === 1 ? 'exercise' : 'exercises'}
                      {hasHistory ? ' · has history' : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === 0}
                    onClick={() =>
                      onEdit(
                        (previous) => moveDay(previous, entry.dayId, index - 1),
                        `${title} moved up.`,
                      )
                    }
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Move {title} up</span>
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === days.length - 1}
                    onClick={() =>
                      onEdit(
                        (previous) => moveDay(previous, entry.dayId, index + 1),
                        `${title} moved down.`,
                      )
                    }
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Move {title} down</span>
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() =>
                      onEdit(
                        (previous) => duplicateDay(previous, entry.dayId),
                        `${title} duplicated.`,
                      )
                    }
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Duplicate {title}</span>
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => setConfirming(entry.dayId)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove {title}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {confirming ? (
            <div className="rounded-control border-sunset-orange/50 bg-orange-soft mt-3 border p-3">
              <p className="text-ocean-deep text-[13px] leading-relaxed">
                {dayHasHistory(state, confirming)
                  ? 'This day has logged sessions. It will be removed from your plan, but everything you logged is kept and still appears in History and CSV exports.'
                  : 'This day has never been logged, so it will be deleted outright.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-control bg-sunset-orange min-h-11 flex-1 px-4 text-[14px] font-semibold text-white transition-colors duration-150 hover:brightness-95"
                  onClick={() => {
                    const target = confirming;
                    setConfirming(null);
                    onEdit(
                      (previous) => removeDay(previous, target),
                      dayHasHistory(state, target)
                        ? 'Day removed from the plan. Its logged sessions are kept.'
                        : 'Day deleted.',
                    );
                  }}
                >
                  Remove day
                </button>
                <button
                  type="button"
                  className={`${secondaryButton} flex-1 justify-center`}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => onEdit((previous) => addDay(previous), 'Day added.')}
            className="rounded-control bg-ocean-blue hover:bg-ocean-deep mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-[14px] font-semibold text-white transition-colors duration-150"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add day
          </button>
        </div>
      )}
    </Dialog>
  );
}
