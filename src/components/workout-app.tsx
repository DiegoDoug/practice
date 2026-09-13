'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, FileDown, History } from 'lucide-react';
import { AppSkeleton } from './app-skeleton';
import { BackupDialog } from './backup-dialog';
import { DayTabs } from './day-tabs';
import { HistoryDialog } from './history-dialog';
import { SafeModeNotice } from './safe-mode-notice';
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
  findDay,
  findSlot,
  pickInitialDay,
  renameSlot,
  resolveWeekRoutine,
} from '@/lib/routine';

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

  // Resolved lazily on first render. The page renders the skeleton until the
  // store has hydrated, so this never reaches the server-rendered HTML and can
  // not cause a timezone hydration mismatch.
  const [weekKey, setWeekKey] = useState(currentWeekKey);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
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
        // The movement recorded is always the slot's current one, never the
        // movement a prior performance was logged under.
        const slot = findSlot(findDay(previous.routine, activeDay), slotId);
        const snapshot = resolveWeekRoutine(
          previous,
          weekKey,
          activeDay,
        ).exercises.find((entry) => entry.slotId === slotId);
        const movementId =
          slot?.movementId ?? snapshot?.movementId ?? 'unknown';
        const unilateral = slot?.unilateral ?? snapshot?.unilateral;
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
        {day && activeDay ? (
          <WorkoutDay
            day={day}
            state={state}
            weekKey={weekKey}
            completed={Boolean(week.completion[activeDay])}
            onToggleComplete={onToggleComplete}
            onSetsChange={onSetsChange}
            onRename={onRename}
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
      <BackupDialog
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        state={state}
        onRestore={onRestore}
      />
    </div>
  );
}
