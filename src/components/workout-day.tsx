'use client';

import { Check, Flame } from 'lucide-react';
import { ExerciseCard } from './exercise-card';
import { PROGRAM, resolveExerciseName } from '@/lib/program';
import type { PlannedDay, SetEntry, WorkoutState } from '@/lib/types';
import {
  countLoggedExercises,
  findPriorPerformance,
  getSets,
} from '@/lib/workout';

type WorkoutDayProps = {
  day: PlannedDay;
  state: WorkoutState;
  weekKey: string;
  completed: boolean;
  onToggleComplete: () => void;
  onSetsChange: (index: number, sets: SetEntry[]) => void;
  onRename: (index: number, name: string) => void;
};

export function WorkoutDay({
  day,
  state,
  weekKey,
  completed,
  onToggleComplete,
  onSetsChange,
  onRename,
}: WorkoutDayProps) {
  const total = day.exercises.length;
  const logged = countLoggedExercises(state, weekKey, day.id);
  const percent = total === 0 ? 0 : Math.min(100, (logged / total) * 100);

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
            {day.label} — {day.name}
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

      <ul className="mt-1">
        {day.exercises.map((exercise, index) => (
          <ExerciseCard
            key={`${day.id}:${index}`}
            dayId={day.id}
            index={index}
            name={resolveExerciseName(state.exerciseNames, day.id, index)}
            group={exercise.group}
            sets={getSets(state, weekKey, day.id, index)}
            prior={findPriorPerformance(state, weekKey, day.id, index)}
            onSetsChange={(sets) => onSetsChange(index, sets)}
            onRename={(name) => onRename(index, name)}
          />
        ))}
      </ul>
    </section>
  );
}

export const PROGRAM_DAY_IDS = PROGRAM.map((day) => day.id);
