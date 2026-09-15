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
  setSlotUnilateral,
  slotHasHistory,
} from '@/lib/routine';
import {
  groupKindLabel,
  removeGroup,
  saveGroup,
  type GroupProblem,
} from '@/lib/groups';
import { GroupEditor } from './group-editor';
import type {
  ExerciseGroup,
  ExerciseGroupKind,
  WorkoutState,
} from '@/lib/types';

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
  /**
   * The group being built or edited. `groupId: null` is a new one; a refusal
   * from the domain layer comes back as `saveError` and the form stays open
   * with what the athlete typed intact.
   */
  const [editingGroup, setEditingGroup] = useState<{
    groupId: string | null;
    kind: ExerciseGroupKind;
  } | null>(null);
  const [saveError, setSaveError] = useState<GroupProblem[]>([]);

  const days = activeDays(state);
  const day = openDayId ? findDay(state.routine, openDayId) : undefined;

  const close = () => {
    setOpenDayId(null);
    setConfirming(null);
    setEditingGroup(null);
    setSaveError([]);
    onClose();
  };

  const groups = day?.groups ?? [];
  const editingExisting =
    editingGroup?.groupId != null
      ? (groups.find((group) => group.groupId === editingGroup.groupId) ?? null)
      : null;

  const namesIn = (group: ExerciseGroup): string =>
    group.slotIds
      .map((slotId) => {
        const slot = day?.exercises.find((entry) => entry.slotId === slotId);
        return slot ? resolveSlotName(state.movements, slot) : slotId;
      })
      .join(' \u2192 ');

  const onSaveGroup = (draft: ExerciseGroup) => {
    if (!day) return;
    // Validate against the state the edit will actually land on, then apply it
    // through the same pure helper the tests use. A refusal writes nothing.
    const result = saveGroup(state, day.dayId, draft);
    if (!result.ok) {
      setSaveError(result.problems);
      return;
    }
    setSaveError([]);
    setEditingGroup(null);
    onEdit(
      (previous) => {
        const applied = saveGroup(previous, day.dayId, draft);
        return applied.ok ? applied.state : previous;
      },
      `${groupKindLabel(draft.kind)} saved with ${draft.slotIds.length} exercises and ${draft.rounds} rounds.`,
    );
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={
        day && editingGroup
          ? `${day.label} · group`
          : day
            ? `Edit ${day.label}`
            : 'Routine'
      }
      description={
        day && editingGroup
          ? 'Choose the exercises, their order, the rounds and the rest. Removing a group never deletes an exercise or its history.'
          : day
            ? 'Reorder or remove exercises, and group them into supersets or circuits. Anything you have already logged is kept.'
            : 'Add, rename, duplicate or reorder your training days. Past workouts keep the names they were logged under.'
      }
    >
      {day && editingGroup ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setEditingGroup(null);
              setSaveError([]);
            }}
            className={secondaryButton}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {day.label}
          </button>
          {saveError.length > 0 ? (
            <div
              role="alert"
              className="rounded-control border-sunset-orange/50 bg-orange-soft mt-3 border p-3"
            >
              <ul className="text-ocean-deep space-y-1 text-[13px]">
                {saveError.map((problem) => (
                  <li key={`${problem.code}-${problem.message}`}>
                    {problem.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3">
            <GroupEditor
              /* Re-mount per target so a fresh form never inherits the last
                 one's selection. */
              key={editingGroup.groupId ?? 'new'}
              day={day}
              movements={state.movements}
              existing={editingExisting}
              initialKind={editingGroup.kind}
              onSave={onSaveGroup}
              onCancel={() => {
                setEditingGroup(null);
                setSaveError([]);
              }}
            />
          </div>
        </div>
      ) : day ? (
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
                      <label className="text-ocean-deep mt-1 flex items-center gap-2 text-[12px]">
                        <input
                          type="checkbox"
                          checked={Boolean(slot.unilateral)}
                          onChange={(event) =>
                            onEdit(
                              (previous) =>
                                setSlotUnilateral(
                                  previous,
                                  day.dayId,
                                  slot.slotId,
                                  event.target.checked,
                                ),
                              event.target.checked
                                ? `${name} now tracks left and right separately.`
                                : `${name} back to a single entry per set.`,
                            )
                          }
                          className="accent-ocean-blue h-5 w-5 shrink-0"
                        />
                        Track left and right separately
                      </label>
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

          <h3 className="text-ocean-deep mt-6 mb-1 text-[13px] font-bold">
            Supersets &amp; circuits
          </h3>
          {groups.length === 0 ? (
            <p className="text-muted py-1 text-[13px]">
              No groups on this day. Pair two or more exercises to run them back
              to back.
            </p>
          ) : (
            <ul className="divide-hairline divide-y">
              {groups.map((group) => (
                <li
                  key={group.groupId}
                  data-routine-group={group.groupId}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <div className="min-w-[140px] flex-1">
                    <p className="text-ocean-deep text-[14px] font-semibold">
                      {groupKindLabel(group.kind)} · {group.rounds}{' '}
                      {group.rounds === 1 ? 'round' : 'rounds'}
                    </p>
                    <p className="text-muted text-[12px]">{namesIn(group)}</p>
                  </div>
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      setSaveError([]);
                      setEditingGroup({
                        groupId: group.groupId,
                        kind: group.kind,
                      });
                    }}
                  >
                    Edit
                    <span className="sr-only">
                      {groupKindLabel(group.kind)} with {namesIn(group)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() =>
                      onEdit(
                        (previous) =>
                          removeGroup(previous, day.dayId, group.groupId),
                        `${groupKindLabel(group.kind)} removed. Its exercises and everything logged against them are kept.`,
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">
                      Remove this {groupKindLabel(group.kind).toLowerCase()},
                      keeping its exercises
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={day.exercises.length < 2}
              className={`${secondaryButton} flex-1 disabled:opacity-40`}
              onClick={() => {
                setSaveError([]);
                setEditingGroup({ groupId: null, kind: 'superset' });
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New superset
            </button>
            <button
              type="button"
              disabled={day.exercises.length < 2}
              className={`${secondaryButton} flex-1 disabled:opacity-40`}
              onClick={() => {
                setSaveError([]);
                setEditingGroup({ groupId: null, kind: 'circuit' });
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New circuit
            </button>
          </div>
          {day.exercises.length < 2 ? (
            <p className="text-muted mt-1 text-[12px]">
              Add a second exercise to this day before grouping.
            </p>
          ) : null}
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
