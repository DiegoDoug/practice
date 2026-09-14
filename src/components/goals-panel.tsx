'use client';

import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, Archive, RotateCcw } from 'lucide-react';
import { MovementPicker } from './movement-picker';
import {
  archiveGoal,
  createGoal,
  deleteGoal,
  goalProgress,
  goalSide,
  listGoals,
  unarchiveGoal,
  updateGoal,
  type GoalProgress,
} from '@/lib/goals';
import { loadModeFor, parseLoad, parseReps } from '@/lib/measure';
import { formatWeekLabel } from '@/lib/week';
import type { Goal, WeightUnit, WorkoutState } from '@/lib/types';

type GoalsPanelProps = {
  state: WorkoutState;
  today: string;
  /** Updater-based, so two edits dispatched in one tick cannot clobber. */
  onUpdate: (updater: (previous: WorkoutState) => WorkoutState) => void;
};

type Draft = {
  movementId: string;
  weight: string;
  reps: string;
  unit: WeightUnit;
  side: 'bilateral' | 'left' | 'right';
};

const SIDE_LABEL = {
  bilateral: 'Both sides',
  left: 'Left side',
  right: 'Right side',
} as const;

const control =
  'rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150';

const field =
  'tnum border-hairline bg-card text-ocean-deep min-h-11 rounded-[10px] border px-2 text-center';

/** What the badge says, and why. Never "achieved" without saying when. */
function statusLine(progress: GoalProgress): {
  label: string;
  detail: string;
  tone: 'done' | 'open';
} {
  if (!progress.achieved) {
    return { label: 'Not yet', detail: '', tone: 'open' };
  }
  if (progress.alreadyAchievedWhenCreated) {
    return {
      label: 'Already achieved',
      detail: progress.achievedOn
        ? `You had already done this on ${formatWeekLabel(progress.achievedOn)}, before setting the goal.`
        : 'You had already done this in an older, undated workout.',
      tone: 'done',
    };
  }
  return {
    label: 'Achieved',
    detail: progress.achievedOn
      ? `First done on ${formatWeekLabel(progress.achievedOn)}.`
      : 'First done in an undated workout.',
    tone: 'done',
  };
}

export function GoalsPanel({ state, today, onUpdate }: GoalsPanelProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const goals = useMemo(
    () => listGoals(state, { includeArchived: showArchived }),
    [showArchived, state],
  );

  const modeOf = (movementId: string) =>
    loadModeFor(state.movements[movementId]?.equipment ?? 'other');

  const beginDraft = (movementId: string) => {
    setPicking(false);
    setEditing(null);
    setDraft({
      movementId,
      weight: modeOf(movementId) === 'bodyweight' ? '0' : '',
      reps: '5',
      unit: state.unit,
      side: 'bilateral',
    });
  };

  const beginEdit = (goal: Goal) => {
    setPicking(false);
    setEditing(goal.goalId);
    setDraft({
      movementId: goal.movementId,
      weight: String(goal.targetWeight),
      reps: String(goal.targetReps),
      unit: goal.unit,
      side: goalSide(goal),
    });
  };

  const cancel = () => {
    setDraft(null);
    setEditing(null);
    setPicking(false);
  };

  const parsed = draft
    ? {
        weight: parseLoad(draft.weight),
        reps: parseReps(draft.reps),
      }
    : null;
  const valid = parsed?.weight !== null && parsed?.reps !== null;

  const save = () => {
    if (!draft || !parsed || parsed.weight === null || parsed.reps === null) {
      return;
    }
    const side = draft.side === 'bilateral' ? undefined : draft.side;
    const goalId = editing;
    onUpdate((previous) =>
      goalId
        ? updateGoal(previous, goalId, {
            movementId: draft.movementId,
            targetWeight: parsed.weight as number,
            targetReps: parsed.reps as number,
            unit: draft.unit,
            side,
            mode: modeOf(draft.movementId),
          })
        : createGoal(
            previous,
            {
              movementId: draft.movementId,
              targetWeight: parsed.weight as number,
              targetReps: parsed.reps as number,
              unit: draft.unit,
              side,
            },
            today,
          ).state,
    );
    cancel();
  };

  if (picking) {
    return (
      <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-ocean-deep text-[16px] font-bold">
            Which exercise?
          </h3>
          <button type="button" onClick={cancel} className={control}>
            Cancel
          </button>
        </div>
        <MovementPicker movements={state.movements} onPick={beginDraft} />
      </>
    );
  }

  if (draft) {
    const movement = state.movements[draft.movementId];
    const bodyweight = modeOf(draft.movementId) === 'bodyweight';
    return (
      <section aria-labelledby="goal-form-heading">
        <h3
          id="goal-form-heading"
          className="text-ocean-deep mb-2 text-[16px] font-bold"
        >
          {editing ? 'Edit goal' : 'New goal'} — {movement?.name ?? 'Exercise'}
        </h3>
        {bodyweight ? (
          <p className="text-muted mb-2 text-[12px]">
            A bodyweight exercise. Leave the added weight at 0 for a reps-only
            goal, or set it to the load you want to hang from a belt.
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted font-semibold">
              {bodyweight ? 'Added weight' : 'Target weight'}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={draft.weight}
              onChange={(event) =>
                setDraft({ ...draft, weight: event.target.value })
              }
              className={`${field} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted font-semibold">Unit</span>
            <select
              value={draft.unit}
              onChange={(event) =>
                setDraft({ ...draft, unit: event.target.value as WeightUnit })
              }
              className={`${field} px-2`}
            >
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted font-semibold">Target reps</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={draft.reps}
              onChange={(event) =>
                setDraft({ ...draft, reps: event.target.value })
              }
              className={`${field} w-20`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted font-semibold">Applies to</span>
            <select
              value={draft.side}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  side: event.target.value as Draft['side'],
                })
              }
              className={`${field} px-2`}
            >
              <option value="bilateral">Both sides</option>
              <option value="left">Left side</option>
              <option value="right">Right side</option>
            </select>
          </label>
        </div>
        <p className="text-muted mt-2 text-[12px]">
          One working set must meet both targets at once. A heavy triple plus a
          lighter set of eight is not a heavy set of eight.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!valid}
            className={`${control} bg-ocean-blue border-ocean-blue text-white disabled:opacity-50`}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {editing ? 'Save goal' : 'Add goal'}
          </button>
          <button type="button" onClick={cancel} className={control}>
            Cancel
          </button>
        </div>
        {!valid ? (
          <p className="text-muted mt-2 text-[12px]">
            Enter a weight of zero or more and at least one rep.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="goals-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3
          id="goals-heading"
          className="text-ocean-deep text-[16px] font-bold"
        >
          Goals
        </h3>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className={control}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New goal
        </button>
      </div>

      {goals.length === 0 ? (
        <p className="text-muted text-[13px]">
          {showArchived
            ? 'No goals yet.'
            : 'No active goals. Set one and it will read from the sets you have already logged.'}
        </p>
      ) : (
        <ul className="divide-hairline divide-y">
          {goals.map((goal) => {
            const progress = goalProgress(state, goal);
            const status = statusLine(progress);
            const movement = state.movements[goal.movementId];
            return (
              <li key={goal.goalId} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-ocean-deep text-[14px] font-bold">
                      {movement?.name ?? 'Unknown exercise'}
                      {goal.archived ? (
                        <span className="text-muted font-normal">
                          {' '}
                          · archived
                        </span>
                      ) : null}
                    </p>
                    <p className="tnum text-muted mt-0.5 text-[13px]">
                      {goal.targetWeight} {goal.unit} × {goal.targetReps} ·{' '}
                      {SIDE_LABEL[goalSide(goal)]}
                    </p>
                  </div>
                  <p
                    className={[
                      'rounded-control px-2 py-1 text-[12px] font-bold',
                      status.tone === 'done'
                        ? 'bg-mist-soft text-ocean-deep'
                        : 'text-muted border-hairline border',
                    ].join(' ')}
                  >
                    {status.label}
                  </p>
                </div>

                {status.detail ? (
                  <p className="text-muted mt-1 text-[12px]">{status.detail}</p>
                ) : null}

                <ul className="tnum text-muted mt-1 space-y-0.5 text-[12px]">
                  <li>
                    Best weight at {goal.targetReps}+ reps:{' '}
                    <span className="text-ocean-deep font-semibold">
                      {progress.bestWeightAtTargetReps
                        ? `${progress.bestWeightAtTargetReps.load.value} ${progress.bestWeightAtTargetReps.load.unit}`
                        : 'nothing yet'}
                    </span>
                  </li>
                  <li>
                    Best reps at {goal.targetWeight} {goal.unit}+:{' '}
                    <span className="text-ocean-deep font-semibold">
                      {progress.bestRepsAtTargetWeight
                        ? progress.bestRepsAtTargetWeight.reps
                        : 'nothing yet'}
                    </span>
                  </li>
                </ul>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => beginEdit(goal)}
                    className={control}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    <span>Edit</span>
                    <span className="sr-only">
                      {movement?.name ?? 'goal'} goal
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((previous) =>
                        goal.archived
                          ? unarchiveGoal(previous, goal.goalId)
                          : archiveGoal(previous, goal.goalId),
                      )
                    }
                    className={control}
                  >
                    {goal.archived ? (
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Archive className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{goal.archived ? 'Restore' : 'Archive'}</span>
                    <span className="sr-only">
                      {movement?.name ?? 'goal'} goal
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate((previous) => deleteGoal(previous, goal.goalId))
                    }
                    className={control}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span>Delete</span>
                    <span className="sr-only">
                      {movement?.name ?? 'goal'} goal
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <label className="mt-3 flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-muted font-semibold">Show archived goals</span>
      </label>
      <p className="text-muted mt-2 text-[12px]">
        Archiving keeps the goal and every set that met it. Goals read the same
        completed working sets as your records, in whichever unit each set was
        logged in.
      </p>
    </section>
  );
}
