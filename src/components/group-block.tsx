'use client';

import type { ReactNode } from 'react';
import { Layers, Repeat2 } from 'lucide-react';
import type { ExerciseGroup } from '@/lib/types';
import { groupKindLabel, type GroupProgress } from '@/lib/groups';

/** `90` → `1:30`, `45` → `45s`. Gym shorthand, not a duration format. */
export function formatRest(seconds: number): string {
  if (seconds === 0) return 'none';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** Status word for one round. Never colour alone — this is the state. */
const roundWord = (
  complete: boolean,
  started: boolean,
  current: boolean,
): string => {
  if (complete) return 'done';
  if (started) return 'in progress';
  if (current) return 'current';
  return 'to do';
};

type GroupBlockProps = {
  group: ExerciseGroup;
  progress: GroupProgress;
  /** A, B, C… so a card can call itself A1 the way a coach would write it. */
  letter: string;
  /** Resolved display name per member slot, for the next-up guidance. */
  nameOf: (slotId: string) => string;
  children: ReactNode;
};

/**
 * The visual container for a superset or circuit on the workout screen.
 *
 * It renders progress only — there is no "advance round" control, because a
 * round is finished by ticking its sets and nothing else. A button that could
 * disagree with the logs is a second source of truth, which is exactly what
 * deriving progress is meant to avoid.
 */
export function GroupBlock({
  group,
  progress,
  letter,
  nameOf,
  children,
}: GroupBlockProps) {
  const kind = groupKindLabel(group.kind);
  const headingId = `group-heading-${group.groupId}`;
  const Icon = group.kind === 'circuit' ? Repeat2 : Layers;

  const next = progress.currentSlotId ? nameOf(progress.currentSlotId) : null;
  const after = progress.nextSlotId ? nameOf(progress.nextSlotId) : null;

  const restBits: string[] = [];
  if (group.restBetweenExercisesSec !== undefined) {
    restBits.push(
      `${formatRest(group.restBetweenExercisesSec)} between exercises`,
    );
  }
  if (group.restBetweenRoundsSec !== undefined) {
    restBits.push(`${formatRest(group.restBetweenRoundsSec)} between rounds`);
  }

  return (
    <li
      data-group={group.groupId}
      data-group-kind={group.kind}
      className="border-hairline border-b py-4 last:border-b-0 last:pb-1"
    >
      <section
        aria-labelledby={headingId}
        className="rounded-card border-ocean-mist bg-mist-soft/60 border p-3"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Icon
            className="text-ocean-blue h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <h3 id={headingId} className="text-ocean-deep text-[15px] font-bold">
            {letter} · {kind}
          </h3>
          <span className="bg-ocean-mist/50 text-ocean-deep rounded-md px-2 py-0.5 text-[11px] font-semibold">
            {progress.plannedRounds}{' '}
            {progress.plannedRounds === 1 ? 'round' : 'rounds'}
          </span>
          <span className="bg-card text-ocean-deep border-hairline rounded-md border px-2 py-0.5 text-[11px] font-semibold">
            {group.slotIds.length} exercises
          </span>
        </div>

        <p
          data-group-progress={group.groupId}
          className="tnum text-ocean-deep mt-1.5 text-[13px] font-semibold"
        >
          {progress.complete
            ? `${kind} complete · ${progress.completedRounds} of ${progress.totalRounds} rounds`
            : `Round ${progress.currentRound} of ${progress.totalRounds} · ${progress.completedRounds} done`}
        </p>

        {next ? (
          <p
            data-group-next={group.groupId}
            className="text-muted mt-0.5 text-[13px]"
          >
            Now:{' '}
            <strong className="text-ocean-deep font-semibold">{next}</strong>
            {after ? ` · then ${after}` : null}
          </p>
        ) : (
          <p
            data-group-next={group.groupId}
            className="text-muted mt-0.5 text-[13px]"
          >
            Every round is logged.
          </p>
        )}

        {restBits.length > 0 ? (
          <p className="text-muted mt-0.5 text-[12px]">
            Rest {restBits.join(' · ')}
          </p>
        ) : null}

        {/* Round state as words, not colour. The list is the round readout. */}
        <ol className="mt-2 flex flex-wrap gap-1.5">
          {progress.rounds.map((round) => {
            const current = progress.currentRound === round.round;
            const word = roundWord(round.complete, round.started, current);
            return (
              <li
                key={round.round}
                data-round={round.round}
                data-round-state={word.replace(' ', '-')}
                className={[
                  'rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                  round.complete
                    ? 'border-ocean-blue bg-ocean-blue text-white'
                    : current
                      ? 'border-ocean-blue bg-card text-ocean-deep'
                      : 'border-hairline bg-card text-muted',
                ].join(' ')}
              >
                <span aria-hidden="true">
                  R{round.round}
                  {round.complete ? ' ✓' : ''}
                </span>
                <span className="sr-only">
                  Round {round.round} {word}
                </span>
              </li>
            );
          })}
        </ol>

        <ul className="mt-1">{children}</ul>
      </section>
    </li>
  );
}
