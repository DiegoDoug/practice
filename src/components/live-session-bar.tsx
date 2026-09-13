'use client';

import { useEffect, useState } from 'react';
import { Check, Pause, Play, Plus, SkipForward, Timer } from 'lucide-react';
import {
  elapsedMs,
  formatDuration,
  isPaused,
  restRemainingMs,
  type LiveSession,
} from '@/lib/live-session';

type LiveSessionBarProps = {
  session: LiveSession;
  dayTitle: string;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onSkipRest: () => void;
  onExtendRest: (bySec: number) => void;
};

const control =
  'rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150';

/**
 * The clock lives here rather than in the app shell: the once-a-second tick
 * re-renders this bar only, not the whole exercise list. Everything shown is
 * derived from the session's timestamps, so a suspended tab catches up on wake
 * instead of drifting.
 */
export function LiveSessionBar({
  session,
  dayTitle,
  onPause,
  onResume,
  onFinish,
  onSkipRest,
  onExtendRest,
}: LiveSessionBarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    // Catch up immediately when the tab comes back, rather than waiting for
    // the next interval that a throttled tab may not have been firing.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const paused = isPaused(session);
  const elapsed = formatDuration(elapsedMs(session, now));
  const restLeft = restRemainingMs(session, now);
  const resting = restLeft !== null && restLeft > 0;
  const restDone = restLeft === 0;

  return (
    // The wrapper carries an opaque page-coloured background and the bottom
    // gap: the bar's own tint is translucent, so without this the exercise
    // list scrolls visibly through it.
    <div className="bg-surface sticky top-0 z-20 pb-3.5">
      <section
        aria-label="Workout in progress"
        className={[
          'rounded-card border p-3 shadow-[0_2px_10px_rgba(47,72,88,0.08)]',
          restDone
            ? 'border-gold-edge bg-gold-soft'
            : 'border-ocean-mist bg-ocean-mist/30',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-muted truncate text-[12px]">
              {paused ? 'Paused' : 'Training'} · {dayTitle}
            </p>
            <p
              className="tnum text-ocean-deep text-[24px] leading-tight font-bold"
              role="timer"
              aria-live="off"
            >
              {elapsed}
            </p>
            <span className="sr-only" role="status" aria-live="polite">
              {paused ? 'Workout paused' : 'Workout running'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={paused ? onResume : onPause}
              className={control}
            >
              {paused ? (
                <>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4" aria-hidden="true" />
                  Pause
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onFinish}
              className="rounded-control bg-ocean-blue hover:bg-ocean-deep inline-flex min-h-11 items-center gap-1.5 px-3 text-[13px] font-semibold text-white transition-colors duration-150"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Finish workout
            </button>
          </div>
        </div>

        {restLeft !== null ? (
          <div className="border-hairline mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <p className="text-ocean-deep flex items-center gap-1.5 text-[13px] font-semibold">
              <Timer className="h-4 w-4" aria-hidden="true" />
              {restDone ? (
                <>Rest done — next set</>
              ) : (
                <>
                  Rest <span className="tnum">{formatDuration(restLeft)}</span>
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {resting ? (
                <button
                  type="button"
                  onClick={() => onExtendRest(30)}
                  className={control}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  30s
                </button>
              ) : null}
              <button type="button" onClick={onSkipRest} className={control}>
                <SkipForward className="h-4 w-4" aria-hidden="true" />
                {restDone ? 'Dismiss' : 'Skip rest'}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
