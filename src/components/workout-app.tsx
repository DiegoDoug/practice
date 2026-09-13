'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, FileDown, History, ListChecks, Play } from 'lucide-react';
import { AppSkeleton } from './app-skeleton';
import { BackupDialog } from './backup-dialog';
import { DayTabs } from './day-tabs';
import { HistoryDialog } from './history-dialog';
import { RoutineDialog } from './routine-dialog';
import { MovementPicker } from './movement-picker';
import { SubstituteDialog, type SubstituteTarget } from './substitute-dialog';
import { Dialog } from './dialog';
import { SafeModeNotice } from './safe-mode-notice';
import { LiveSessionBar } from './live-session-bar';
import { useLiveSession } from '@/lib/use-live-session';
import { isPaused } from '@/lib/live-session';
import { WeeklyOverview } from './weekly-overview';
import { WorkoutDay } from './workout-day';
import { buildWeekCsv, countCsvDataRows, weekCsvFilename } from '@/lib/csv';
import { downloadBlob } from '@/lib/storage';
import { useWorkoutStore } from '@/lib/use-workout-store';
import { weekKey as currentWeekKey } from '@/lib/week';
import type { SetEntry, WorkoutState } from '@/lib/types';
import { getWeek, withCompletion, withSets } from '@/lib/workout';
import {
  activeDays,
  addCustomMovement,
  addExercise,
  clearWeekSubstitution,
  findDay,
  pickInitialDay,
  refreshOpenSnapshots,
  renameSlot,
  resolveWeekRoutine,
  slotHasSetsThisWeek,
  substituteForWeek,
  substitutePermanently,
} from '@/lib/routine';
import type { Movement } from '@/lib/types';

const SAVE_LABEL = {
  idle: 'Autosave is on',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save. Try again.",
} as const;

export function WorkoutApp() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, hydrated, status, safeMode, update, replace, flush } =
    useWorkoutStore();
  const live = useLiveSession();

  // Resolved lazily on first render. The page renders the skeleton until the
  // store has hydrated, so this never reaches the server-rendered HTML and can
  // not cause a timezone hydration mismatch.
  const [weekKey, setWeekKey] = useState(currentWeekKey);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [addingToDay, setAddingToDay] = useState<string | null>(null);
  const [substituting, setSubstituting] = useState<SubstituteTarget | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState('');

  const week = useMemo(() => getWeek(state, weekKey), [state, weekKey]);

  // The URL is the single source of truth for the active day. When no valid
  // day is present we derive today's session and write it back to the URL.
  const days = useMemo(() => activeDays(state), [state]);
  const requestedDay = params.get('day');
  const urlDay =
    requestedDay && findDay(days, requestedDay) ? requestedDay : null;
  const activeDay = urlDay ?? pickInitialDay(state, week.completion);

  useEffect(() => {
    // Only write the URL when it does not already name a valid day, so an
    // archived or unknown ?day= resolves once instead of looping.
    if (!hydrated || urlDay || !activeDay) return;
    router.replace(`/?day=${activeDay}`, { scroll: false });
  }, [activeDay, hydrated, router, urlDay]);

  // Recompute the week if the tab is left open across a Monday boundary.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setWeekKey(currentWeekKey());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const selectDay = useCallback(
    (dayId: string) => {
      void flush();
      router.replace(`/?day=${dayId}`, { scroll: false });
    },
    [flush, router],
  );

  const onSetsChange = useCallback(
    (slotId: string, sets: SetEntry[]) => {
      if (!activeDay) return;
      update((previous) => {
        // The movement recorded is what THIS WEEK plans — which includes a
        // one-off swap — never the movement a prior performance was logged
        // under.
        const planned = resolveWeekRoutine(
          previous,
          weekKey,
          activeDay,
        ).exercises.find((entry) => entry.slotId === slotId);
        const movementId = planned?.movementId ?? 'unknown';
        const unilateral = planned?.unilateral;
        return withSets(
          previous,
          weekKey,
          activeDay,
          slotId,
          sets,
          movementId,
          unilateral,
        );
      });
    },
    [activeDay, update, weekKey],
  );

  const onRename = useCallback(
    (slotId: string, name: string) => {
      if (!activeDay) return;
      update((previous) => renameSlot(previous, activeDay, slotId, name));
      setAnnouncement('Exercise name updated for this template.');
    },
    [activeDay, update],
  );

  const onToggleComplete = useCallback(() => {
    if (!activeDay) return;
    const next = !week.completion[activeDay];
    update((previous) => withCompletion(previous, weekKey, activeDay, next));
    const day = findDay(state.routine, activeDay);
    setAnnouncement(
      next
        ? `${day?.label} marked complete.`
        : `${day?.label} marked not complete.`,
    );
  }, [activeDay, state.routine, update, week.completion, weekKey]);

  const onExportCsv = useCallback(async () => {
    await flush();
    const csv = buildWeekCsv(state, weekKey);
    if (countCsvDataRows(csv) === 0) {
      setAnnouncement('No logged sets in this week to export.');
      return;
    }
    // The BOM keeps UTF-8 characters intact when opened in Excel.
    const blob = new Blob(['﻿', csv], {
      type: 'text/csv;charset=utf-8',
    });
    downloadBlob(blob, weekCsvFilename(weekKey));
    setAnnouncement(`Exported ${countCsvDataRows(csv)} logged sets as CSV.`);
  }, [flush, state, weekKey]);

  /**
   * Apply a routine edit, then re-freeze the current week's snapshots so an
   * in-progress, not-yet-complete day reflects the change while finished
   * sessions and past weeks keep what they were logged under.
   */
  const onRoutineEdit = useCallback(
    (edit: (previous: WorkoutState) => WorkoutState, message: string) => {
      update((previous) => refreshOpenSnapshots(edit(previous), weekKey));
      setAnnouncement(message);
    },
    [update, weekKey],
  );

  const onPickExercise = useCallback(
    (movementId: string) => {
      const dayId = addingToDay;
      if (!dayId) return;
      setAddingToDay(null);
      const name = state.movements[movementId]?.name ?? 'Exercise';
      onRoutineEdit(
        (previous) => addExercise(previous, dayId, movementId),
        `${name} added.`,
      );
    },
    [addingToDay, onRoutineEdit, state.movements],
  );

  /**
   * Start the rest countdown for a set the athlete just finished logging.
   * SetRow decides when a row counts as logged; this only adds the condition
   * that a live, unpaused session is running.
   */
  const onSetComplete = useCallback(() => {
    if (!live.session || isPaused(live.session)) return;
    live.startRest();
  }, [live]);

  const onStartWorkout = useCallback(() => {
    if (!activeDay) return;
    live.start(weekKey, activeDay);
    setAnnouncement('Workout started.');
  }, [activeDay, live, weekKey]);

  const onFinishWorkout = useCallback(() => {
    const session = live.session;
    live.finish();
    if (session) {
      // Finishing writes to the week the session began in, not whatever week
      // it happens to be when the athlete taps the button.
      update((previous) =>
        withCompletion(previous, session.weekKey, session.dayId, true),
      );
    }
    setAnnouncement('Workout finished and marked complete.');
  }, [live, update]);

  const onOpenSubstitute = useCallback(
    (slotId: string) => {
      if (!activeDay) return;
      const planned = resolveWeekRoutine(
        state,
        weekKey,
        activeDay,
      ).exercises.find((entry) => entry.slotId === slotId);
      if (!planned) return;
      setSubstituting({
        dayId: activeDay,
        slotId,
        movementId: planned.movementId,
        name: planned.name,
        hasSetsThisWeek: slotHasSetsThisWeek(state, weekKey, activeDay, slotId),
      });
    },
    [activeDay, state, weekKey],
  );

  const onSubstitute = useCallback(
    (movementId: string, permanent: boolean) => {
      const target = substituting;
      if (!target) return;
      const name = state.movements[movementId]?.name ?? 'the new exercise';
      update((previous) =>
        permanent
          ? substitutePermanently(
              previous,
              weekKey,
              target.dayId,
              target.slotId,
              movementId,
            )
          : substituteForWeek(
              previous,
              weekKey,
              target.dayId,
              target.slotId,
              movementId,
            ),
      );
      setAnnouncement(
        permanent
          ? `${target.name} replaced with ${name} from now on.`
          : `${target.name} replaced with ${name} for this week.`,
      );
    },
    [state.movements, substituting, update, weekKey],
  );

  const onUndoSubstitute = useCallback(
    (slotId: string) => {
      if (!activeDay) return;
      update((previous) =>
        clearWeekSubstitution(previous, weekKey, activeDay, slotId),
      );
      setAnnouncement('Swap undone. The planned exercise is back.');
    },
    [activeDay, update, weekKey],
  );

  const onCreateMovement = useCallback(
    (movement: Omit<Movement, 'id' | 'custom'>): string | null => {
      if (!movement.name.trim()) return null;
      const { state: next, id } = addCustomMovement(state, movement);
      update(() => next);
      return id;
    },
    [state, update],
  );

  const onRestore = useCallback(
    async (next: WorkoutState) => {
      await replace(next);
      setAnnouncement('Backup restored. Your local data has been replaced.');
    },
    [replace],
  );

  if (!hydrated) return <AppSkeleton />;

  const day = activeDay ? findDay(state.routine, activeDay) : undefined;

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pt-5 pb-16">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-ocean-deep text-[24px] leading-tight font-bold">
            Weekly Practice Log
          </h1>
          <p className="text-muted mt-1 text-[13px]">
            Fast logging · saves in this browser · portable backup
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            History
          </button>
          <button
            type="button"
            onClick={() => setBackupOpen(true)}
            className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            Backup
          </button>
          <button
            type="button"
            onClick={() => setRoutineOpen(true)}
            className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Routine
          </button>
        </div>
      </header>

      {safeMode ? (
        <SafeModeNotice
          error={safeMode.error}
          raw={safeMode.raw}
          onOpenBackup={() => setBackupOpen(true)}
        />
      ) : null}

      <WeeklyOverview
        days={days}
        weekKey={weekKey}
        completion={week.completion}
        activeDay={activeDay ?? ''}
        onSelect={selectDay}
      />

      <DayTabs
        days={days}
        activeDay={activeDay ?? ''}
        completion={week.completion}
        onSelect={selectDay}
      />

      <main>
        {live.session && live.session.dayId === activeDay ? (
          <LiveSessionBar
            session={live.session}
            dayTitle={
              day?.name ? `${day.label} — ${day.name}` : (day?.label ?? '')
            }
            onPause={live.pause}
            onResume={live.resume}
            onFinish={onFinishWorkout}
            onSkipRest={live.skipRest}
            onExtendRest={live.extendRest}
          />
        ) : null}

        {day && activeDay ? (
          <WorkoutDay
            day={day}
            state={state}
            weekKey={weekKey}
            completed={Boolean(week.completion[activeDay])}
            onToggleComplete={onToggleComplete}
            onSetsChange={onSetsChange}
            onRename={onRename}
            onSubstitute={onOpenSubstitute}
            onUndoSubstitute={onUndoSubstitute}
            onSetComplete={onSetComplete}
          />
        ) : (
          <section className="rounded-card border-hairline bg-card border p-6 text-center">
            <h2 className="text-ocean-deep text-[18px] font-bold">
              No training days yet
            </h2>
            <p className="text-muted mt-2 text-[13px]">
              Your routine is empty. Add a day to start logging again.
            </p>
          </section>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p
            className={[
              'text-[13px]',
              status === 'error'
                ? 'text-sunset-orange font-semibold'
                : 'text-muted',
            ].join(' ')}
          >
            {SAVE_LABEL[status]}
          </p>
          <div className="flex flex-wrap gap-2">
            {day && activeDay && !live.session ? (
              <button
                type="button"
                onClick={onStartWorkout}
                className="rounded-control bg-ocean-blue hover:bg-ocean-deep inline-flex min-h-11 items-center gap-1.5 px-3 text-[13px] font-semibold text-white transition-colors duration-150"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Start workout
              </button>
            ) : null}
            <button
              type="button"
              onClick={onExportCsv}
              className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => setBackupOpen(true)}
              className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              Backup &amp; restore
            </button>
          </div>
        </div>
      </main>

      {/* Single live region for status changes across the whole app. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <HistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        state={state}
      />
      <RoutineDialog
        open={routineOpen}
        onClose={() => setRoutineOpen(false)}
        state={state}
        onEdit={onRoutineEdit}
        onAddExercise={setAddingToDay}
      />
      <Dialog
        open={addingToDay !== null}
        onClose={() => setAddingToDay(null)}
        title="Add an exercise"
        description="Pick a movement from your library."
      >
        <MovementPicker movements={state.movements} onPick={onPickExercise} />
      </Dialog>
      <SubstituteDialog
        open={substituting !== null}
        onClose={() => setSubstituting(null)}
        state={state}
        target={substituting}
        onSubstitute={onSubstitute}
        onCreateMovement={onCreateMovement}
      />
      <BackupDialog
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        state={state}
        onRestore={onRestore}
      />
    </div>
  );
}
