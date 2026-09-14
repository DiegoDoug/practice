'use client';

import { useMemo, useState } from 'react';
import { Dialog } from './dialog';
import { MovementPicker } from './movement-picker';
import { SideComparison } from './side-comparison';
import { GoalsPanel } from './goals-panel';
import {
  eligibleSets,
  loggedMovementIds,
  type HistoryPeriod,
  type SideKey,
} from '@/lib/analytics';
import {
  bestRepsAtWeight,
  bestWeightAtReps,
  exerciseHistory,
} from '@/lib/progress';
import { currentRecords } from '@/lib/records';
import { formatVolume } from '@/lib/volume';
import { convert } from '@/lib/units';
import { formatWeekLabel } from '@/lib/week';
import type { WorkoutState } from '@/lib/types';

type ProgressDialogProps = {
  open: boolean;
  onClose: () => void;
  state: WorkoutState;
  today: string;
  /** Updater-based, so the goal edits below cannot clobber a queued write. */
  onUpdate: (updater: (previous: WorkoutState) => WorkoutState) => void;
};

type Tab = 'exercise' | 'sides' | 'goals';

const PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: '4w', label: '4 weeks' },
  { value: '8w', label: '8 weeks' },
  { value: '12w', label: '12 weeks' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All time' },
];

const SIDE_LABEL: Record<SideKey, string> = {
  bilateral: 'Both sides',
  left: 'Left',
  right: 'Right',
};

const tabClass = (active: boolean): string =>
  [
    'min-h-11 px-3 text-[13px] font-semibold transition-colors duration-150',
    active
      ? 'border-ocean-blue text-ocean-deep border-b-2'
      : 'text-muted hover:text-ocean-deep border-b-2 border-transparent',
  ].join(' ');

export function ProgressDialog({
  open,
  onClose,
  state,
  today,
  onUpdate,
}: ProgressDialogProps) {
  const [tab, setTab] = useState<Tab>('exercise');
  const [movementId, setMovementId] = useState<string | null>(null);
  const [period, setPeriod] = useState<HistoryPeriod>('12w');
  const [targetReps, setTargetReps] = useState('5');

  const logged = useMemo(() => loggedMovementIds(state), [state]);
  const suggested = useMemo(
    () =>
      logged
        .map((id) => state.movements[id])
        .filter((movement) => movement !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [logged, state.movements],
  );

  const movement = movementId ? state.movements[movementId] : undefined;

  const rows = useMemo(
    () =>
      movementId
        ? eligibleSets(state, { movementId, recordOnly: true, period, today })
        : [],
    [movementId, period, state, today],
  );
  const history = useMemo(
    () => (movementId ? exerciseHistory(state, movementId, period, today) : []),
    [movementId, period, state, today],
  );
  // Records are all-time by design: a personal best is not a property of the
  // window you happen to be looking at.
  const records = useMemo(
    () => (movementId ? currentRecords(state, movementId) : null),
    [movementId, state],
  );

  const sidesPresent = (['bilateral', 'left', 'right'] as SideKey[]).filter(
    (side) => records?.[side] !== null && records?.[side] !== undefined,
  );

  const repTarget = Number(targetReps);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Progress"
      description="Pick an exercise to see its history and your records. Loads are shown in the unit each set was logged in."
    >
      <div
        role="tablist"
        aria-label="Progress view"
        className="border-hairline mb-3 flex gap-1 border-b"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'exercise'}
          onClick={() => setTab('exercise')}
          className={tabClass(tab === 'exercise')}
        >
          By exercise
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sides'}
          onClick={() => setTab('sides')}
          className={tabClass(tab === 'sides')}
        >
          Left vs right
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'goals'}
          onClick={() => setTab('goals')}
          className={tabClass(tab === 'goals')}
        >
          Goals
        </button>
      </div>

      {tab === 'goals' ? (
        <GoalsPanel state={state} today={today} onUpdate={onUpdate} />
      ) : tab === 'sides' ? (
        <SideComparison state={state} />
      ) : !movementId ? (
        <>
          <p className="text-muted mb-2 text-[13px]">
            {logged.length === 0
              ? 'Nothing completed yet. Tick a set on any exercise and its history shows up here.'
              : 'Choose an exercise.'}
          </p>
          <MovementPicker
            movements={state.movements}
            suggested={suggested}
            suggestedLabel="Exercises you have trained"
            onPick={setMovementId}
          />
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-ocean-deep text-[16px] font-bold">
              {movement?.name ?? 'Unknown exercise'}
            </h3>
            <button
              type="button"
              onClick={() => setMovementId(null)}
              className="rounded-control border-hairline bg-card text-ocean-blue hover:bg-mist-soft min-h-11 border px-3 text-[13px] font-semibold transition-colors duration-150"
            >
              Change exercise
            </button>
          </div>

          <label className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted font-semibold">Period</span>
            <select
              value={period}
              onChange={(event) =>
                setPeriod(event.target.value as HistoryPeriod)
              }
              className="border-hairline bg-card text-ocean-deep min-h-11 rounded-[10px] border px-2 text-[13px]"
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {period !== 'all' ? (
            <p className="text-muted mb-3 text-[12px]">
              Workouts from an older backup have no recorded date, so they
              appear only under All time.
            </p>
          ) : null}

          {/* --- Records ------------------------------------------------- */}
          <section aria-labelledby="records-heading" className="mb-4">
            <h4
              id="records-heading"
              className="text-ocean-deep mb-1 text-[14px] font-bold"
            >
              Records
            </h4>
            {sidesPresent.length === 0 ? (
              <p className="text-muted text-[13px]">
                No completed working sets for this exercise yet.
              </p>
            ) : (
              <div
                className="-mx-1 overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Records table"
              >
                <table className="w-full min-w-[320px] border-collapse text-left">
                  <thead>
                    <tr className="text-muted text-[11px] font-bold tracking-wide uppercase">
                      <th scope="col" className="py-1 pr-2 font-bold">
                        Side
                      </th>
                      <th scope="col" className="py-1 pr-2 font-bold">
                        Heaviest
                      </th>
                      <th scope="col" className="py-1 pr-2 font-bold">
                        Most reps
                      </th>
                      <th scope="col" className="py-1 font-bold">
                        Best set
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-hairline divide-y">
                    {sidesPresent.map((side) => {
                      const entry = records?.[side];
                      if (!entry) return null;
                      return (
                        <tr key={side} className="text-[13px]">
                          <th
                            scope="row"
                            className="text-muted py-1.5 pr-2 font-normal"
                          >
                            {SIDE_LABEL[side]}
                          </th>
                          <td className="tnum text-ocean-deep py-1.5 pr-2">
                            {entry.heaviest
                              ? `${entry.heaviest.load.value} ${entry.heaviest.load.unit}`
                              : '—'}
                          </td>
                          <td className="tnum text-ocean-deep py-1.5 pr-2">
                            {entry.mostReps ? entry.mostReps.reps : '—'}
                          </td>
                          <td className="tnum text-ocean-deep py-1.5">
                            {entry.volume
                              ? `${entry.volume.load.value} ${entry.volume.load.unit} × ${entry.volume.reps}`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-muted mt-1 text-[12px]">
              Working sets only — warmups and drop sets do not set records. Each
              side is tracked on its own; the two are never added together.
            </p>
          </section>

          {/* --- Best weight at a rep count ------------------------------ */}
          <section aria-labelledby="at-reps-heading" className="mb-4">
            <h4
              id="at-reps-heading"
              className="text-ocean-deep mb-1 text-[14px] font-bold"
            >
              Best weight at a rep count
            </h4>
            <label className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-muted font-semibold">
                At least this many reps
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={targetReps}
                onChange={(event) => setTargetReps(event.target.value)}
                className="tnum border-hairline bg-card text-ocean-deep min-h-11 w-20 rounded-[10px] border px-2 text-center"
              />
            </label>
            <ul className="mt-2 space-y-1">
              {sidesPresent.map((side) => {
                const best =
                  Number.isFinite(repTarget) && repTarget > 0
                    ? bestWeightAtReps(rows, side, repTarget)
                    : null;
                return (
                  <li key={side} className="text-[13px]">
                    <span className="text-muted">{SIDE_LABEL[side]}: </span>
                    <span className="tnum text-ocean-deep font-semibold">
                      {best
                        ? `${best.load.value} ${best.load.unit} × ${best.reps}`
                        : 'nothing at that rep count'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* --- Best reps at each weight -------------------------------- */}
          <section aria-labelledby="reps-at-weight-heading" className="mb-4">
            <h4
              id="reps-at-weight-heading"
              className="text-ocean-deep mb-1 text-[14px] font-bold"
            >
              Best reps at each weight
            </h4>
            {sidesPresent.map((side) => {
              const table = bestRepsAtWeight(rows, side, state.unit);
              if (table.length === 0) return null;
              return (
                <div key={side} className="mb-2">
                  <p className="text-muted text-[12px] font-semibold">
                    {SIDE_LABEL[side]}
                  </p>
                  <ul className="mt-0.5 flex flex-wrap gap-1.5">
                    {table.slice(0, 12).map((row) => (
                      <li
                        key={row.weight}
                        className="rounded-control border-hairline bg-surface tnum border px-2 py-1 text-[12px]"
                      >
                        <span className="text-ocean-deep font-semibold">
                          {row.weight} {state.unit}
                        </span>
                        <span className="text-muted"> × {row.reps}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="text-muted text-[12px]">
              Loads logged in the other unit are converted for grouping, so{' '}
              {convert(100, 'kg', 'lb').toFixed(1)} lb and 100 kg count as one
              weight.
            </p>
          </section>

          {/* --- Session history ---------------------------------------- */}
          <section aria-labelledby="exercise-history-heading">
            <h4
              id="exercise-history-heading"
              className="text-ocean-deep mb-1 text-[14px] font-bold"
            >
              Sessions
            </h4>
            {history.length === 0 ? (
              <p className="text-muted text-[13px]">
                Nothing completed in this period.
              </p>
            ) : (
              <ul className="divide-hairline divide-y">
                {history.map((row) => (
                  <li
                    key={row.sessionId}
                    className="flex items-start justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-ocean-deep text-[13px] font-semibold">
                        {row.title}
                      </p>
                      <p className="tnum text-muted mt-0.5 text-[12px]">
                        {row.sets} {row.sets === 1 ? 'set' : 'sets'} ·{' '}
                        {formatVolume(row.volume)} volume
                        {row.bestLoad
                          ? ` · best ${row.bestLoad.value} ${row.bestLoad.unit}`
                          : ''}
                      </p>
                    </div>
                    <p className="tnum text-muted shrink-0 text-[12px]">
                      {row.dateKnown && row.date
                        ? formatWeekLabel(row.date)
                        : row.weekKey
                          ? `week of ${formatWeekLabel(row.weekKey)}`
                          : 'undated'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Dialog>
  );
}
