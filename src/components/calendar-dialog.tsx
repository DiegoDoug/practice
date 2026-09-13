'use client';

import { useMemo, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Dialog } from './dialog';
import {
  addBlankSession,
  addExtraSession,
  calendarMonth,
  monthLabel,
  nextMonth,
  previousMonth,
  undatedByWeek,
  type YearMonth,
} from '@/lib/calendar';
import {
  removeSession,
  reschedule,
  setPerformedDate,
  setStatus,
} from '@/lib/sessions';
import { activeDays, resolveSessionRoutine } from '@/lib/routine';
import { formatWeekLabel, parseDateKey } from '@/lib/week';
import type { WorkoutSession, WorkoutState } from '@/lib/types';

type CalendarDialogProps = {
  open: boolean;
  onClose: () => void;
  state: WorkoutState;
  today: string;
  onEdit: (
    edit: (previous: WorkoutState) => WorkoutState,
    message: string,
  ) => void;
  onOpenSession: (sessionId: string) => void;
};

const STATUS_LABEL: Record<WorkoutSession['status'], string> = {
  scheduled: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
};

const control =
  'rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `5 Mar` — enough to confirm a date without repeating the year everywhere. */
const shortDate = (date: string, locale?: string): string =>
  parseDateKey(date).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
  });

export function CalendarDialog({
  open,
  onClose,
  state,
  today,
  onEdit,
  onOpenSession,
}: CalendarDialogProps) {
  const [month, setMonth] = useState<YearMonth>(() => {
    const parsed = parseDateKey(today);
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
  });
  const [selected, setSelected] = useState<string>(today);
  const [adding, setAdding] = useState(false);

  const cells = useMemo(
    () => calendarMonth(state, month, today),
    [month, state, today],
  );
  const undated = useMemo(() => undatedByWeek(state), [state]);
  const days = useMemo(() => activeDays(state), [state]);
  /** Seven-day rows, so the grid can carry the row structure ARIA requires. */
  const weeks = useMemo(() => {
    const rows: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [cells]);
  const selectedCell = cells.find((cell) => cell.date === selected);
  const selectedSessions = selectedCell?.sessions ?? [];

  const titleOf = (session: WorkoutSession): string => {
    const resolved = resolveSessionRoutine(state, session);
    return resolved.name
      ? `${resolved.label} — ${resolved.name}`
      : resolved.label;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Calendar"
      description="Schedule workouts on a date, move a missed one, or add an extra session. Dates you trained are kept separately from dates you planned."
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth(previousMonth(month))}
          className={control}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Previous month</span>
        </button>
        <p
          className="text-ocean-deep text-[14px] font-bold"
          aria-live="polite"
          role="status"
        >
          {monthLabel(month)}
        </p>
        <button
          type="button"
          onClick={() => setMonth(nextMonth(month))}
          className={control}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Next month</span>
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            className="text-muted text-center text-[10px] font-semibold"
          >
            {day}
          </span>
        ))}
      </div>

      <div role="grid" aria-label="Month" className="grid grid-cols-7 gap-1">
        {weeks.map((week) => (
          <div role="row" key={week[0].date} style={{ display: 'contents' }}>
            {week.map((cell) => {
              const isSelected = cell.date === selected;
              const count = cell.sessions.length;
              const done = cell.sessions.filter(
                (session) => session.status === 'completed',
              ).length;
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-current={cell.isToday ? 'date' : undefined}
                  onClick={() => setSelected(cell.date)}
                  className={[
                    'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[9px] border px-0.5 py-1.5 transition-colors duration-150',
                    cell.inMonth
                      ? 'border-hairline bg-surface'
                      : 'border-transparent bg-transparent',
                    done > 0 ? 'border-ocean-mist bg-ocean-mist/30' : '',
                    cell.missed ? 'border-gold-edge bg-gold-soft' : '',
                    isSelected ? 'ring-ocean-blue ring-2' : '',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'tnum text-[12px]',
                      cell.inMonth ? 'text-ocean-deep' : 'text-muted',
                      cell.isToday ? 'font-bold' : '',
                    ].join(' ')}
                  >
                    {parseDateKey(cell.date).getDate()}
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex h-1.5 items-center gap-0.5"
                  >
                    {cell.sessions.slice(0, 3).map((session) => (
                      <span
                        key={session.sessionId}
                        className={[
                          'block h-1.5 w-1.5 rounded-full',
                          session.status === 'completed'
                            ? 'bg-ocean-blue'
                            : session.status === 'skipped'
                              ? 'bg-muted'
                              : 'bg-gold-ink',
                        ].join(' ')}
                      />
                    ))}
                  </span>
                  <span className="sr-only">
                    {shortDate(cell.date)}
                    {cell.isToday ? ', today' : ''}
                    {count === 0
                      ? ', nothing scheduled'
                      : `, ${count} ${count === 1 ? 'session' : 'sessions'}`}
                    {cell.missed ? ', missed' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section aria-labelledby="calendar-day-heading" className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="calendar-day-heading"
            className="text-ocean-deep text-[14px] font-bold"
          >
            {parseDateKey(selected).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h3>
          <button
            type="button"
            onClick={() => setAdding((value) => !value)}
            aria-expanded={adding}
            className={control}
          >
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Add workout
          </button>
        </div>

        {adding ? (
          <div className="rounded-control border-hairline bg-surface mt-2 border p-2.5">
            <p className="text-muted mb-2 text-[12px]">
              Add another session on {shortDate(selected)} — the same training
              day can be repeated as often as you like.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {days.map((day) => (
                <button
                  key={day.dayId}
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    onEdit(
                      (previous) =>
                        addExtraSession(previous, selected, day.dayId).state,
                      `${day.label} scheduled for ${shortDate(selected)}.`,
                    );
                  }}
                  className={control}
                >
                  {day.label}
                  {day.name ? ` · ${day.name}` : ''}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  onEdit(
                    (previous) => addBlankSession(previous, selected).state,
                    `Blank workout added on ${shortDate(selected)}.`,
                  );
                }}
                className={control}
              >
                Blank workout
              </button>
            </div>
          </div>
        ) : null}

        {selectedSessions.length === 0 ? (
          <p className="text-muted mt-2 text-[13px]">
            Nothing scheduled on this date yet.
          </p>
        ) : (
          <ul className="divide-hairline mt-1 divide-y">
            {selectedSessions.map((session) => (
              <li key={session.sessionId} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-ocean-deep text-[14px] font-semibold">
                    {titleOf(session)}
                  </p>
                  <span className="text-muted text-[11px] font-medium">
                    {STATUS_LABEL[session.status]}
                    {session.performedDate
                      ? ` · trained ${shortDate(session.performedDate)}`
                      : session.scheduledDate
                        ? ` · planned ${shortDate(session.scheduledDate)}`
                        : ''}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSession(session.sessionId);
                      onClose();
                    }}
                    className={control}
                  >
                    Open
                  </button>

                  {/* Moving a plan and correcting history are different acts,
                      so they are different controls rather than one date box. */}
                  <label className="text-muted flex items-center gap-1 text-[12px]">
                    Move plan to
                    <input
                      type="date"
                      value={session.scheduledDate ?? ''}
                      onChange={(event) => {
                        const date = event.target.value;
                        if (!date) return;
                        onEdit(
                          (previous) =>
                            reschedule(previous, session.sessionId, date),
                          `Moved to ${shortDate(date)}.`,
                        );
                        setSelected(date);
                      }}
                      className="rounded-control border-hairline bg-card text-ocean-deep min-h-11 border px-2 text-[13px]"
                    />
                  </label>

                  <label className="text-muted flex items-center gap-1 text-[12px]">
                    Trained on
                    <input
                      type="date"
                      value={session.performedDate ?? ''}
                      onChange={(event) => {
                        const date = event.target.value;
                        if (!date) return;
                        onEdit(
                          (previous) =>
                            setPerformedDate(previous, session.sessionId, date),
                          `Recorded as trained on ${shortDate(date)}.`,
                        );
                        setSelected(date);
                      }}
                      className="rounded-control border-hairline bg-card text-ocean-deep min-h-11 border px-2 text-[13px]"
                    />
                  </label>

                  {session.status === 'scheduled' ? (
                    <button
                      type="button"
                      onClick={() =>
                        onEdit(
                          (previous) =>
                            setStatus(previous, session.sessionId, 'skipped'),
                          'Session marked skipped.',
                        )
                      }
                      className={control}
                    >
                      Skip
                    </button>
                  ) : null}
                  {session.status === 'skipped' ? (
                    <button
                      type="button"
                      onClick={() =>
                        onEdit(
                          (previous) =>
                            setStatus(previous, session.sessionId, 'scheduled'),
                          'Session put back on the plan.',
                        )
                      }
                      className={control}
                    >
                      Put back
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() =>
                      onEdit(
                        (previous) =>
                          removeSession(previous, session.sessionId),
                        'Session deleted.',
                      )
                    }
                    className="rounded-control border-hairline bg-card text-sunset-orange hover:bg-mist-soft inline-flex min-h-11 items-center gap-1.5 border px-3 text-[13px] font-semibold transition-colors duration-150"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {undated.length > 0 ? (
        <section aria-labelledby="undated-heading" className="mt-5">
          <h3
            id="undated-heading"
            className="text-ocean-deep text-[14px] font-bold"
          >
            Undated workouts
          </h3>
          <p className="text-muted mt-1 text-[12px]">
            These came from an older backup that recorded the week but not the
            day. They are listed under the week they were logged in; set a
            trained date to place one on the calendar.
          </p>
          <ul className="divide-hairline mt-2 divide-y">
            {undated.map((group) => (
              <li key={group.weekKey} className="py-2.5">
                <p className="tnum text-muted text-[12px]">
                  Week of {formatWeekLabel(group.weekKey)}
                </p>
                <ul className="mt-1.5 space-y-2">
                  {group.sessions.map((session) => (
                    <li
                      key={session.sessionId}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-ocean-deep text-[13px] font-semibold">
                        {titleOf(session)}
                      </span>
                      <label className="text-muted flex items-center gap-1 text-[12px]">
                        Trained on
                        <input
                          type="date"
                          onChange={(event) => {
                            const date = event.target.value;
                            if (!date) return;
                            onEdit(
                              (previous) =>
                                setPerformedDate(
                                  previous,
                                  session.sessionId,
                                  date,
                                ),
                              `Dated to ${shortDate(date)}.`,
                            );
                          }}
                          className="rounded-control border-hairline bg-card text-ocean-deep min-h-11 border px-2 text-[13px]"
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-muted mt-4 text-[12px]">
        Today is{' '}
        {parseDateKey(today).toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        .
      </p>
    </Dialog>
  );
}
