'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog } from './dialog';
import { buildHistory } from '@/lib/workout';
import { formatVolume } from '@/lib/volume';
import { formatWeekLabel } from '@/lib/week';
import type { WorkoutState } from '@/lib/types';

const PAGE_SIZE = 60;

type HistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  state: WorkoutState;
};

export function HistoryDialog({ open, onClose, state }: HistoryDialogProps) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const entries = useMemo(() => buildHistory(state), [state]);
  const shown = entries.slice(0, visible);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Workout history"
      description="Sessions with logged sets, newest first. Volume counts weight × reps for every set where both are numbers."
    >
      {shown.length === 0 ? (
        <p className="text-muted py-2 text-[13px]">
          Nothing logged yet. Enter a weight or reps on any exercise and it will
          appear here.
        </p>
      ) : (
        <>
          <ul className="divide-hairline divide-y">
            {shown.map((entry) => (
              <li
                key={`${entry.weekKey}:${entry.dayId}`}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-ocean-deep flex items-center gap-1.5 text-[14px] font-semibold">
                    {entry.dayName
                      ? `${entry.dayLabel} — ${entry.dayName}`
                      : entry.dayLabel}
                    {entry.completed ? (
                      <>
                        <Check
                          className="text-ocean-blue h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        <span className="text-ocean-blue text-[11px] font-medium">
                          Completed
                        </span>
                      </>
                    ) : (
                      <span className="text-muted text-[11px] font-medium">
                        In progress
                      </span>
                    )}
                    {entry.archived ? (
                      <span className="text-muted text-[11px] font-medium">
                        · Removed from plan
                      </span>
                    ) : null}
                  </p>
                  <p className="tnum text-muted mt-1 text-[12px]">
                    {entry.sets} logged {entry.sets === 1 ? 'set' : 'sets'} ·{' '}
                    {formatVolume(entry.volume)} {state.unit}/reps volume
                  </p>
                </div>
                <p className="tnum text-muted shrink-0 text-[12px]">
                  {formatWeekLabel(entry.weekKey)}
                </p>
              </li>
            ))}
          </ul>
          {entries.length > visible ? (
            <button
              type="button"
              onClick={() => setVisible((count) => count + PAGE_SIZE)}
              className="rounded-control border-hairline bg-surface text-ocean-blue hover:bg-mist-soft mt-3 min-h-11 w-full border px-3 text-[13px] font-semibold transition-colors duration-150"
            >
              Load more ({entries.length - visible} older)
            </button>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
