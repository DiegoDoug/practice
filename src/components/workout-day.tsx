'use client';

import { Check, Flame } from 'lucide-react';
import { ExerciseCard } from './exercise-card';
import type {
  RoutineDay,
  SetEntry,
  SnapshotExercise,
  WorkoutSession,
  WorkoutState,
} from '@/lib/types';
import {
  countLoggedExercises,
  findPriorPerformance,
  getSets,
} from '@/lib/workout';
import { resolveSessionRoutine } from '@/lib/routine';
import { deriveGroupProgress, layoutDay } from '@/lib/groups';
import { GroupBlock } from './group-block';

/** Stand-in used only to resolve the routine before a session exists. */
const blankSession: WorkoutSession = {
  sessionId: '',
  routineDayId: null,
  status: 'scheduled',
  exercises: {},
};

type WorkoutDayProps = {
  /** Absent for an ad-hoc workout, which has no routine day behind it. */
  day?: RoutineDay;
  state: WorkoutState;
  /** Null until the athlete logs something, which is what creates a session. */
  session: WorkoutSession | null;
  completed: boolean;
  onToggleComplete: () => void;
  onSetsChange: (
    slotId: string,
    update: (previous: SetEntry[]) => SetEntry[],
  ) => void;
  onRename: (slotId: string, name: string) => void;
  onSetComplete?: (
    slotId: string,
    sets: SetEntry[],
    setId?: string,
    movementId?: string,
    unilateral?: boolean,
  ) => void;
  onSubstitute: (slotId: string) => void;
  onUndoSubstitute: (slotId: string) => void;
  /** Only offered for an ad-hoc workout; a routine day is edited in Routine. */
  onAddExercise?: () => void;
};

export function WorkoutDay({
  day,
  state,
  session,
  completed,
  onToggleComplete,
  onSetsChange,
  onRename,
  onSetComplete,
  onSubstitute,
  onUndoSubstitute,
  onAddExercise,
}: WorkoutDayProps) {
  // Render through the resolved routine so an in-progress session shows the
  // plan it was logged under rather than one edited midway. With no session
  // yet, that resolves to the current routine day.
  const resolved = resolveSessionRoutine(
    state,
    session ?? { ...blankSession, routineDayId: day?.dayId ?? null },
  );
  const sessionId = session?.sessionId ?? '';
  const substitutions = session?.substitutions ?? {};
  const total = resolved.exercises.length;
  const logged = session ? countLoggedExercises(state, sessionId) : 0;
  const percent = total === 0 ? 0 : Math.min(100, (logged / total) * 100);

  // Groups sit where their first member sits; standalone exercises keep their
  // places around them. Members render once, inside their group.
  const blocks = layoutDay(resolved);
  const letters = new Map<string, string>();
  for (const block of blocks) {
    if (block.kind !== 'group') continue;
    letters.set(
      block.group.groupId,
      String.fromCharCode(65 + (letters.size % 26)),
    );
  }

  /** Render position, used for the DOM hook and the accessible index only. */
  const indexOf = new Map(
    resolved.exercises.map((slot, index) => [slot.slotId, index] as const),
  );
  const nameOf = (slotId: string): string =>
    resolved.exercises.find((slot) => slot.slotId === slotId)?.name ?? '';

  const renderCard = (slot: SnapshotExercise, orderLabel?: string) => {
    const prior = findPriorPerformance(
      state,
      // With no session yet, nothing has been logged for this exercise today,
      // so everything already logged counts as prior.
      session ? { sessionId } : {},
      slot.movementId,
      day?.dayId,
      slot.slotId,
    );
    const plannedName = state.movements[slot.movementId]?.name ?? slot.name;
    return (
      <ExerciseCard
        key={slot.slotId}
        dayId={day?.dayId ?? ''}
        index={indexOf.get(slot.slotId) ?? 0}
        slotId={slot.slotId}
        name={slot.name}
        group={slot.group}
        orderLabel={orderLabel}
        unilateral={Boolean(slot.unilateral)}
        loadMode={slot.loadMode}
        movementId={slot.movementId}
        sets={getSets(state, sessionId, slot.slotId, Boolean(slot.unilateral))}
        prior={prior}
        priorNote={
          prior && day && prior.dayId !== day.dayId
            ? `as ${plannedName}`
            : undefined
        }
        onSetsChange={(update) => onSetsChange(slot.slotId, update)}
        onRename={(name) => onRename(slot.slotId, name)}
        onSetComplete={onSetComplete}
        onSubstitute={() => onSubstitute(slot.slotId)}
        substituted={Boolean(substitutions[slot.slotId])}
        onUndoSubstitute={() => onUndoSubstitute(slot.slotId)}
      />
    );
  };

  return (
    <section
      aria-labelledby="day-heading"
      className="rounded-card border-hairline bg-card border p-4 shadow-[0_2px_10px_rgba(47,72,88,0.05)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="day-heading"
            className="text-ocean-deep text-[18px] leading-tight font-bold"
          >
            {resolved.name
              ? `${resolved.label} — ${resolved.name}`
              : resolved.label}
          </h2>
          <p className="tnum text-muted mt-1 text-[13px]">
            {total} exercises · {logged}/{total} logged
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleComplete}
          aria-pressed={completed}
          className={[
            'rounded-control inline-flex min-h-11 items-center gap-2 px-4 text-[14px] font-semibold transition-colors duration-150',
            completed
              ? 'border-ocean-mist bg-ocean-mist/40 text-ocean-deep border'
              : 'bg-ocean-blue hover:bg-ocean-deep text-white',
          ].join(' ')}
        >
          {completed ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              Completed
            </>
          ) : (
            'Mark complete'
          )}
        </button>
      </div>

      <div
        className="bg-mist-soft mt-3 h-1.5 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={logged}
        aria-label={`${logged} of ${total} exercises logged`}
      >
        <span
          className="bg-ocean-blue block h-full rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {day && day.warmup.length > 0 ? (
        <div className="rounded-control border-gold-edge bg-gold-soft mt-4 border p-3">
          <h3 className="text-gold-ink mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />
            Warmup
          </h3>
          <ul className="text-gold-ink list-disc space-y-1 pl-4.5 text-[13px] leading-relaxed">
            {day.warmup.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {total === 0 ? (
        <p className="text-muted mt-4 text-[13px]">
          {onAddExercise
            ? 'This workout is empty. Add an exercise to start logging.'
            : 'This day has no exercises yet. Add some from the routine editor.'}
        </p>
      ) : (
        <ul className="mt-1">
          {blocks.map((block) =>
            block.kind === 'exercise' ? (
              renderCard(block.slot)
            ) : (
              <GroupBlock
                key={block.group.groupId}
                group={block.group}
                progress={deriveGroupProgress(block.group, session?.exercises)}
                letter={letters.get(block.group.groupId) ?? 'A'}
                nameOf={nameOf}
              >
                {block.slots.map((slot, position) =>
                  renderCard(
                    slot,
                    `${letters.get(block.group.groupId) ?? 'A'}${position + 1}`,
                  ),
                )}
              </GroupBlock>
            ),
          )}
        </ul>
      )}

      {onAddExercise ? (
        <button
          type="button"
          onClick={onAddExercise}
          className="rounded-control border-hairline bg-surface text-ocean-blue hover:bg-mist-soft mt-3 min-h-11 w-full border px-3 text-[13px] font-semibold transition-colors duration-150"
        >
          Add an exercise
        </button>
      ) : null}
    </section>
  );
}
