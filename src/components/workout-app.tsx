'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  CalendarDays,
  FileDown,
  History,
  ListChecks,
  Play,
  TrendingUp,
} from 'lucide-react';
import { AppSkeleton } from './app-skeleton';
import { BackupDialog } from './backup-dialog';
import { CalendarDialog } from './calendar-dialog';
import { ProgressDialog } from './progress-dialog';
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
import {
  formatWeekLabel,
  toLocalDateKey,
  weekKey as currentWeekKey,
} from '@/lib/week';
import { addSessionExercise, resolveDayLink } from '@/lib/calendar';
import { celebrationKey, describeRecord, recordsBrokenBy } from '@/lib/records';
import { useCelebrations } from '@/lib/use-celebrations';
import { blankSet, type SetEntry, type WorkoutState } from '@/lib/types';
import { withCompletion, withSets } from '@/lib/workout';
import {
  ensureWeekDaySession,
  findWeekDaySession,
  newSessionId,
  sessionsInWeek,
  startedSession,
} from '@/lib/sessions';
import {
  activeDays,
  addCustomMovement,
  addExercise,
  clearSessionSubstitution,
  findDay,
  pickInitialDay,
  refreshOpenSnapshots,
  renameSlot,
  resolveSessionRoutine,
  slotHasSetsInSession,
  substituteForSession,
  substitutePermanently,
} from '@/lib/routine';
import type { Movement } from '@/lib/types';

/**
 * Sentinel for the movement picker: the exercise is being added to the active
 * ad-hoc session rather than to a routine day, which has no dayId to name.
 */
const BLANK_SESSION = '\u0000blank-session';

const SAVE_LABEL = {
  idle: 'Autosave is on',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save. Try again.",
} as const;

export function WorkoutApp() {
  const router = useRouter();
  const params = useSearchParams();
  const {
    state,
    hydrated,
    status,
    safeMode,
    update,
    latestState,
    replace,
    flush,
  } = useWorkoutStore();
  const live = useLiveSession();
  const celebrations = useCelebrations();

  // Resolved lazily on first render. The page renders the skeleton until the
  // store has hydrated, so this never reaches the server-rendered HTML and can
  // not cause a timezone hydration mismatch.
  const [weekKey, setWeekKey] = useState(currentWeekKey);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [addingToDay, setAddingToDay] = useState<string | null>(null);
  const [substituting, setSubstituting] = useState<SubstituteTarget | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState('');

  /**
   * Per-day completion for this week, derived from sessions rather than stored.
   * The overview and tabs still think in routine days, which stays correct
   * while one day maps to at most one session; stage 3's calendar is where
   * several sessions per day become selectable.
   */
  const weekSessions = useMemo(
    () => sessionsInWeek(state, weekKey),
    [state, weekKey],
  );
  const completion = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const session of weekSessions) {
      if (!session.routineDayId) continue;
      map[session.routineDayId] =
        map[session.routineDayId] || session.status === 'completed';
    }
    return map;
  }, [weekSessions]);

  /**
   * The URL is the source of truth. `?session=` names a session directly;
   * `?day=` is the legacy form, which is now ambiguous because a routine day
   * can have several sessions in one week. `resolveDayLink` answers what the
   * old link should do and NEVER creates anything, so reloading a bookmark ten
   * times leaves the calendar exactly as it was.
   */
  const days = useMemo(() => activeDays(state), [state]);
  const requestedSession = params.get('session');
  const urlSession = requestedSession
    ? (state.sessions[requestedSession] ?? null)
    : null;
  const requestedDay = params.get('day');
  const urlDay =
    requestedDay && findDay(days, requestedDay) ? requestedDay : null;

  const dayLink = useMemo(
    () =>
      !urlSession && urlDay ? resolveDayLink(state, weekKey, urlDay) : null,
    [state, urlDay, urlSession, weekKey],
  );

  const activeDay = urlSession
    ? urlSession.routineDayId
    : (urlDay ?? pickInitialDay(state, completion));

  /**
   * The session being logged into, or null when nothing has been logged for
   * this day yet. Resolving never creates one — creation happens only in the
   * handlers below and in the calendar.
   */
  const activeSession =
    urlSession ??
    (dayLink?.kind === 'session'
      ? (state.sessions[dayLink.sessionId] ?? null)
      : activeDay
        ? findWeekDaySession(state, weekKey, activeDay)
        : null);

  useEffect(() => {
    // Only write the URL when it names neither a valid session nor a valid
    // day, so an archived or unknown parameter resolves once instead of
    // looping.
    if (!hydrated || urlSession || urlDay || !activeDay) return;
    router.replace(`/?day=${activeDay}`, { scroll: false });
  }, [activeDay, hydrated, router, urlDay, urlSession]);

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

  const selectSession = useCallback(
    (sessionId: string) => {
      void flush();
      router.replace(`/?session=${sessionId}`, { scroll: false });
    },
    [flush, router],
  );

  /**
   * Resolve the session to write into, creating one only when the athlete is
   * logging against a routine day that has none yet. An ad-hoc session is
   * always already there — the calendar created it explicitly.
   */
  const writeTarget = useCallback(
    (
      previous: WorkoutState,
      today: string,
    ): { state: WorkoutState; sessionId: string } | null => {
      if (activeSession) {
        return { state: previous, sessionId: activeSession.sessionId };
      }
      if (!activeDay) return null;
      return ensureWeekDaySession(previous, weekKey, activeDay, today);
    },
    [activeDay, activeSession, weekKey],
  );

  const onSetsChange = useCallback(
    (slotId: string, apply: (previous: SetEntry[]) => SetEntry[]) => {
      if (!activeSession && !activeDay) return;
      update((previous) => {
        // Logging is the explicit act that creates a session for a routine day,
        // so this is one of the few places allowed to mint one.
        const today = toLocalDateKey(new Date());
        const target = writeTarget(previous, today);
        if (!target) return previous;
        const { state: withSession, sessionId } = target;
        // The movement recorded is what THIS SESSION plans — which includes a
        // one-off swap — never the movement a prior performance was logged
        // under.
        const planned = resolveSessionRoutine(
          withSession,
          withSession.sessions[sessionId],
        ).exercises.find((entry) => entry.slotId === slotId);
        // The updater is applied here, against the sets as they stand in the
        // state being written — not against a snapshot the card rendered with.
        const existing = withSession.sessions[sessionId]?.exercises[slotId]
          ?.sets ?? [blankSet(planned?.unilateral)];
        return withSets(
          withSession,
          sessionId,
          slotId,
          apply(existing),
          planned?.movementId ?? 'unknown',
          planned?.unilateral,
          today,
        );
      });
    },
    [activeDay, activeSession, update, writeTarget],
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
    if (!activeSession && !activeDay) return;
    const next = activeSession
      ? activeSession.status !== 'completed'
      : !completion[activeDay as string];
    update((previous) => {
      const target = writeTarget(previous, toLocalDateKey(new Date()));
      if (!target) return previous;
      return withCompletion(target.state, target.sessionId, next, Date.now());
    });
    const label = activeDay
      ? findDay(state.routine, activeDay)?.label
      : 'Workout';
    setAnnouncement(
      next ? `${label} marked complete.` : `${label} marked not complete.`,
    );
  }, [
    activeDay,
    activeSession,
    completion,
    state.routine,
    update,
    writeTarget,
  ]);

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
      update((previous) => {
        const edited = edit(previous);
        // Only this week's unfinished sessions are re-frozen; finished ones and
        // past weeks keep what they were logged under.
        return refreshOpenSnapshots(
          edited,
          sessionsInWeek(edited, weekKey).map((s) => s.sessionId),
        );
      });
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

      // A blank workout has no routine day, so the exercise goes onto the
      // session's own snapshot rather than into the template.
      if (dayId === BLANK_SESSION) {
        const sessionId = activeSession?.sessionId;
        if (!sessionId) return;
        update((previous) =>
          addSessionExercise(previous, sessionId, movementId),
        );
        setAnnouncement(`${name} added to this workout.`);
        return;
      }

      onRoutineEdit(
        (previous) => addExercise(previous, dayId, movementId),
        `${name} added.`,
      );
    },
    [activeSession, addingToDay, onRoutineEdit, state.movements, update],
  );

  /** Calendar edits are plain state changes; no snapshot refresh is involved. */
  const onCalendarEdit = useCallback(
    (edit: (previous: WorkoutState) => WorkoutState, message: string) => {
      update(edit);
      setAnnouncement(message);
    },
    [update],
  );

  /**
   * Start the rest countdown for a set the athlete just ticked.
   *
   * The card fires this only on the unfinished → completed edge. The extra
   * conditions here are that a live, unpaused timer is running AND that it
   * belongs to the session being logged into — completing a set in some other
   * session, a past workout being corrected, say, must not restart the timer
   * on the one actually in progress.
   */
  /**
   * A set was explicitly ticked: start rest if a timer for THIS session is
   * running, then check whether the completion took any records.
   *
   * The record check runs against a PROJECTION of the write that is landing —
   * `state` does not yet contain it at this point — and never against a
   * hydration or an import, because this is the only path that calls it. The
   * celebration memory then filters anything already announced, so reopening a
   * set and ticking it again is silent while genuinely improving it is not.
   */
  const onSetComplete = useCallback(
    (
      slotId: string,
      sets: SetEntry[],
      setId?: string,
      movementId?: string,
      unilateral?: boolean,
    ) => {
      if (live.session && !isPaused(live.session)) {
        if (
          activeSession &&
          live.session.sessionId === activeSession.sessionId
        ) {
          live.startRest();
        }
      }

      if (!setId || !movementId) return;

      // A record is a nicety. Nothing in here may stop a set being logged, so
      // the whole check is guarded: the write has already been dispatched by
      // the caller before this runs.
      try {
        const today = toLocalDateKey(new Date());
        // `latestState()`, not `state`: two completions dispatched from one
        // event would otherwise both project from the same stale base, and the
        // second would be judged without the first.
        const current = latestState();
        const target = writeTarget(current, today);
        if (!target) return;

        const projected = withSets(
          target.state,
          target.sessionId,
          slotId,
          sets,
          movementId,
          unilateral,
          today,
        );
        const broken = recordsBrokenBy(projected, movementId, setId);
        if (broken.length === 0) return;

        const fresh = celebrations.claim(broken.map(celebrationKey));
        const announce = broken.filter((record) =>
          fresh.includes(celebrationKey(record)),
        );
        if (announce.length === 0) return;
        setAnnouncement(
          `New record! ${announce
            .map((record) => describeRecord(record, current.unit))
            .join(' \u00b7 ')}`,
        );
      } catch {
        // Storage or computation trouble loses a congratulation, never a set.
      }
    },
    [activeSession, celebrations, latestState, live, writeTarget],
  );

  const onStartWorkout = useCallback(() => {
    if (!activeSession && !activeDay) return;
    const today = toLocalDateKey(new Date());
    const now = Date.now();
    // Decide the id up front rather than reading it out of the state updater,
    // which has not run yet at the point the timer needs it.
    const sessionId = activeSession?.sessionId ?? newSessionId();
    update((previous) =>
      startedSession(
        activeSession || !activeDay
          ? previous
          : ensureWeekDaySession(previous, weekKey, activeDay, today, sessionId)
              .state,
        sessionId,
        today,
        now,
      ),
    );
    live.start(sessionId);
    setAnnouncement('Workout started.');
  }, [activeDay, activeSession, live, update, weekKey]);

  const onFinishWorkout = useCallback(() => {
    const timer = live.session;
    live.finish();
    if (timer) {
      // Finishing writes to the session the timer was pinned to, whatever the
      // date or week has become since it started.
      const now = Date.now();
      update((previous) =>
        withCompletion(previous, timer.sessionId, true, now),
      );
    }
    setAnnouncement('Workout finished and marked complete.');
  }, [live, update]);

  const onOpenSubstitute = useCallback(
    (slotId: string) => {
      if (!activeDay) return;
      const planned = resolveSessionRoutine(
        state,
        activeSession,
      ).exercises.find((entry) => entry.slotId === slotId);
      if (!planned) return;
      setSubstituting({
        dayId: activeDay,
        slotId,
        movementId: planned.movementId,
        name: planned.name,
        hasSetsThisWeek: activeSession
          ? slotHasSetsInSession(state, activeSession.sessionId, slotId)
          : false,
      });
    },
    [activeDay, activeSession, state],
  );

  const onSubstitute = useCallback(
    (movementId: string, permanent: boolean) => {
      const target = substituting;
      if (!target) return;
      const name = state.movements[movementId]?.name ?? 'the new exercise';
      update((previous) => {
        const resolved = activeSession
          ? { state: previous, sessionId: activeSession.sessionId }
          : ensureWeekDaySession(
              previous,
              weekKey,
              target.dayId,
              toLocalDateKey(new Date()),
            );
        const { state: withSession, sessionId } = resolved;
        return permanent
          ? substitutePermanently(
              withSession,
              sessionId,
              target.slotId,
              movementId,
            )
          : substituteForSession(
              withSession,
              sessionId,
              target.slotId,
              movementId,
            );
      });
      setAnnouncement(
        permanent
          ? `${target.name} replaced with ${name} from now on.`
          : `${target.name} replaced with ${name} for this week.`,
      );
    },
    [activeSession, state.movements, substituting, update, weekKey],
  );

  const onUndoSubstitute = useCallback(
    (slotId: string) => {
      const sessionId = activeSession?.sessionId;
      if (!sessionId) return;
      update((previous) =>
        clearSessionSubstitution(previous, sessionId, slotId),
      );
      setAnnouncement('Swap undone. The planned exercise is back.');
    },
    [activeSession, update],
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setProgressOpen(true)}
            className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
          >
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            Progress
          </button>
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
        completion={completion}
        activeDay={activeDay ?? ''}
        onSelect={selectDay}
      />

      <DayTabs
        days={days}
        activeDay={activeDay ?? ''}
        completion={completion}
        onSelect={selectDay}
      />

      <main>
        {live.session &&
        activeSession &&
        live.session.sessionId === activeSession.sessionId ? (
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

        {dayLink?.kind === 'choose' ? (
          <section className="rounded-card border-hairline bg-card border p-4">
            <h2 className="text-ocean-deep text-[18px] font-bold">
              Which session?
            </h2>
            <p className="text-muted mt-1 text-[13px]">
              You trained this day more than once in the week of{' '}
              {formatWeekLabel(weekKey)}. Pick the one you meant.
            </p>
            <ul className="mt-3 space-y-2">
              {dayLink.sessionIds.map((sessionId) => {
                const option = state.sessions[sessionId];
                const resolved = resolveSessionRoutine(state, option);
                const date = option?.performedDate ?? option?.scheduledDate;
                return (
                  <li key={sessionId}>
                    <button
                      type="button"
                      onClick={() => selectSession(sessionId)}
                      className="rounded-control border-hairline bg-surface hover:bg-mist-soft flex min-h-11 w-full items-center justify-between gap-3 border px-3 text-left text-[13px] font-semibold transition-colors duration-150"
                    >
                      <span className="text-ocean-deep">
                        {resolved.name
                          ? `${resolved.label} — ${resolved.name}`
                          : resolved.label}
                      </span>
                      <span className="tnum text-muted text-[12px]">
                        {date ? formatWeekLabel(date) : 'undated'}
                        {option?.status === 'completed' ? ' · completed' : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : activeSession && !activeSession.routineDayId ? (
          <WorkoutDay
            state={state}
            session={activeSession}
            completed={activeSession.status === 'completed'}
            onToggleComplete={onToggleComplete}
            onSetsChange={onSetsChange}
            onRename={onRename}
            onSubstitute={onOpenSubstitute}
            onUndoSubstitute={onUndoSubstitute}
            onSetComplete={onSetComplete}
            onAddExercise={() => setAddingToDay(BLANK_SESSION)}
          />
        ) : day && activeDay ? (
          <WorkoutDay
            day={day}
            state={state}
            session={activeSession}
            completed={Boolean(completion[activeDay])}
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
      <ProgressDialog
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        state={state}
        today={toLocalDateKey(new Date())}
      />
      <CalendarDialog
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        state={state}
        today={toLocalDateKey(new Date())}
        onEdit={onCalendarEdit}
        onOpenSession={selectSession}
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
