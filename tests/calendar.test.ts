import { describe, expect, it } from 'vitest';
import { emptyState } from '@/lib/backup';
import {
  addBlankSession,
  addExtraSession,
  addSessionExercise,
  calendarMonth,
  monthGrid,
  monthLabel,
  nextMonth,
  previousMonth,
  resolveDayLink,
  shiftDate,
  undatedByWeek,
} from '@/lib/calendar';
import { addSession, setStatus } from '@/lib/sessions';
import type { WorkoutSession, WorkoutState } from '@/lib/types';

const session = (patch: Partial<WorkoutSession>): WorkoutSession => ({
  sessionId: patch.sessionId ?? 's1',
  routineDayId: 'day1',
  status: 'scheduled',
  exercises: {},
  ...patch,
});

const withSessions = (...list: WorkoutSession[]): WorkoutState => ({
  ...emptyState(),
  sessions: Object.fromEntries(list.map((s) => [s.sessionId, s])),
});

describe('shiftDate', () => {
  it('moves by whole days without drifting across a DST boundary', () => {
    // 2026-03-29 is when European clocks go forward; the day after is the 30th
    // whatever the offset does.
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftDate('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('monthGrid', () => {
  it('starts on a Monday and covers whole weeks', () => {
    const grid = monthGrid(2026, 3);
    expect(grid.length % 7).toBe(0);
    // 2026-03-01 is a Sunday, so the grid opens on Monday 2026-02-23.
    expect(grid[0].date).toBe('2026-02-23');
    expect(grid[grid.length - 1].date).toBe('2026-04-05');
  });

  it('marks which cells belong to the month being shown', () => {
    const grid = monthGrid(2026, 3);
    expect(grid[0].inMonth).toBe(false);
    expect(grid.find((cell) => cell.date === '2026-03-01')?.inMonth).toBe(true);
    expect(grid.find((cell) => cell.date === '2026-03-31')?.inMonth).toBe(true);
    expect(grid[grid.length - 1].inMonth).toBe(false);
  });

  it('contains every day of the month exactly once', () => {
    const grid = monthGrid(2026, 2);
    const inMonth = grid.filter((cell) => cell.inMonth).map((c) => c.date);
    expect(inMonth).toHaveLength(28);
    expect(new Set(inMonth).size).toBe(28);
  });
});

describe('previousMonth / nextMonth / monthLabel', () => {
  it('wraps across the year boundary in both directions', () => {
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({
      year: 2027,
      month: 1,
    });
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({
      year: 2025,
      month: 12,
    });
  });

  it('labels a month without relying on a locale-specific parse', () => {
    expect(monthLabel({ year: 2026, month: 3 }, 'en-US')).toBe('March 2026');
  });
});

describe('calendarMonth', () => {
  it('places a session on its performed date, not its scheduled one', () => {
    const state = withSessions(
      session({
        sessionId: 'late',
        scheduledDate: '2026-03-02',
        performedDate: '2026-03-03',
        status: 'completed',
      }),
    );
    const grid = calendarMonth(state, { year: 2026, month: 3 }, '2026-03-10');
    const planned = grid.find((cell) => cell.date === '2026-03-02');
    const trained = grid.find((cell) => cell.date === '2026-03-03');
    expect(planned?.sessions).toEqual([]);
    expect(trained?.sessions.map((s) => s.sessionId)).toEqual(['late']);
  });

  it('shows several sessions on one date, in order', () => {
    const state = withSessions(
      session({ sessionId: 'pm', performedDate: '2026-03-04', startedAt: 200 }),
      session({ sessionId: 'am', performedDate: '2026-03-04', startedAt: 100 }),
    );
    const grid = calendarMonth(state, { year: 2026, month: 3 }, '2026-03-10');
    expect(
      grid
        .find((c) => c.date === '2026-03-04')
        ?.sessions.map((s) => s.sessionId),
    ).toEqual(['am', 'pm']);
  });

  it('never places an undated migrated session on a calendar day', () => {
    // Its legacyWeekKey is a Monday; pinning it there would be a claim the
    // document does not support.
    const state = withSessions(
      session({ sessionId: 'old', legacyWeekKey: '2026-03-02' }),
    );
    const grid = calendarMonth(state, { year: 2026, month: 3 }, '2026-03-10');
    expect(grid.every((cell) => cell.sessions.length === 0)).toBe(true);
  });

  it('flags a scheduled session whose date has passed as missed', () => {
    const state = withSessions(
      session({ sessionId: 'gone', scheduledDate: '2026-03-05' }),
      session({ sessionId: 'soon', scheduledDate: '2026-03-20' }),
    );
    const grid = calendarMonth(state, { year: 2026, month: 3 }, '2026-03-10');
    expect(grid.find((c) => c.date === '2026-03-05')?.missed).toBe(true);
    expect(grid.find((c) => c.date === '2026-03-20')?.missed).toBe(false);
  });

  it('does not flag a skipped or completed session as missed', () => {
    const state = withSessions(
      session({
        sessionId: 'skipped',
        scheduledDate: '2026-03-05',
        status: 'skipped',
      }),
    );
    const grid = calendarMonth(state, { year: 2026, month: 3 }, '2026-03-10');
    expect(grid.find((c) => c.date === '2026-03-05')?.missed).toBe(false);
  });

  it('marks today', () => {
    const grid = calendarMonth(
      emptyState(),
      { year: 2026, month: 3 },
      '2026-03-10',
    );
    expect(grid.filter((c) => c.isToday).map((c) => c.date)).toEqual([
      '2026-03-10',
    ]);
  });
});

describe('undatedByWeek', () => {
  it('groups undated sessions under the week they were logged in', () => {
    const state = withSessions(
      session({ sessionId: 'a', legacyWeekKey: '2025-06-02' }),
      session({ sessionId: 'b', legacyWeekKey: '2025-06-02' }),
      session({ sessionId: 'c', legacyWeekKey: '2025-06-09' }),
      session({ sessionId: 'dated', performedDate: '2026-03-02' }),
    );
    const groups = undatedByWeek(state);
    expect(groups.map((g) => g.weekKey)).toEqual(['2025-06-09', '2025-06-02']);
    expect(groups[1].sessions.map((s) => s.sessionId)).toEqual(['a', 'b']);
  });

  it('excludes anything with a real date', () => {
    const state = withSessions(session({ performedDate: '2026-03-02' }));
    expect(undatedByWeek(state)).toEqual([]);
  });

  it('ignores a session with no week at all rather than inventing one', () => {
    const state = withSessions(session({ sessionId: 'nowhere' }));
    expect(undatedByWeek(state)).toEqual([]);
  });
});

describe('resolveDayLink', () => {
  const day1 = (patch: Partial<WorkoutSession>) =>
    session({ routineDayId: 'day1', ...patch });

  it('resolves to the one matching session when there is exactly one', () => {
    const state = withSessions(
      day1({ sessionId: 'only', performedDate: '2026-03-03' }),
    );
    expect(resolveDayLink(state, '2026-03-02', 'day1')).toEqual({
      kind: 'session',
      sessionId: 'only',
    });
  });

  it('offers a choice when several sessions match the day in that week', () => {
    const state = withSessions(
      day1({ sessionId: 'a', performedDate: '2026-03-02' }),
      day1({ sessionId: 'b', performedDate: '2026-03-05' }),
    );
    const resolved = resolveDayLink(state, '2026-03-02', 'day1');
    expect(resolved.kind).toBe('choose');
    if (resolved.kind === 'choose') {
      expect(resolved.sessionIds).toEqual(['a', 'b']);
    }
  });

  it('offers a start action when nothing matches', () => {
    expect(resolveDayLink(emptyState(), '2026-03-02', 'day1')).toEqual({
      kind: 'start',
      dayId: 'day1',
    });
  });

  it('is pure: resolving never adds a session, however many times it runs', () => {
    const state = emptyState();
    for (let i = 0; i < 10; i += 1) {
      resolveDayLink(state, '2026-03-02', 'day1');
    }
    expect(Object.keys(state.sessions)).toEqual([]);
  });

  it('reports an unknown day as unknown rather than offering to start it', () => {
    expect(resolveDayLink(emptyState(), '2026-03-02', 'ghost')).toEqual({
      kind: 'unknown',
    });
  });
});

describe('addExtraSession', () => {
  it('schedules an extra workout from a routine day on a chosen date', () => {
    const { state, sessionId } = addExtraSession(
      emptyState(),
      '2026-03-04',
      'day1',
    );
    const added = state.sessions[sessionId];
    expect(added.routineDayId).toBe('day1');
    expect(added.scheduledDate).toBe('2026-03-04');
    expect(added.performedDate).toBeUndefined();
    expect(added.status).toBe('scheduled');
  });

  it('allows the same routine day twice in one week', () => {
    let state = addExtraSession(emptyState(), '2026-03-02', 'day1').state;
    state = addExtraSession(state, '2026-03-05', 'day1').state;
    expect(Object.keys(state.sessions)).toHaveLength(2);
    expect(
      Object.values(state.sessions).every((s) => s.routineDayId === 'day1'),
    ).toBe(true);
  });

  it('allows the same routine day twice on one date', () => {
    let state = addExtraSession(emptyState(), '2026-03-02', 'day1').state;
    state = addExtraSession(state, '2026-03-02', 'day1').state;
    expect(Object.keys(state.sessions)).toHaveLength(2);
  });
});

describe('addBlankSession', () => {
  it('creates a workout with no routine day and an empty snapshot', () => {
    const { state, sessionId } = addBlankSession(emptyState(), '2026-03-04');
    const added = state.sessions[sessionId];
    expect(added.routineDayId).toBeNull();
    expect(added.scheduledDate).toBe('2026-03-04');
    expect(added.snapshot?.exercises).toEqual([]);
    expect(added.snapshot?.label).toBeTruthy();
  });
});

describe('addSessionExercise', () => {
  it('adds an exercise to a blank session, minting a slot id', () => {
    const created = addBlankSession(emptyState(), '2026-03-04');
    const next = addSessionExercise(
      created.state,
      created.sessionId,
      'barbell-bench-press',
    );
    const snapshot = next.sessions[created.sessionId].snapshot;
    expect(snapshot?.exercises).toHaveLength(1);
    expect(snapshot?.exercises[0].movementId).toBe('barbell-bench-press');
    expect(snapshot?.exercises[0].name).toBe('Barbell Bench Press');
    expect(snapshot?.exercises[0].slotId).toBeTruthy();
  });

  it('mints a distinct slot id per exercise, even for the same movement', () => {
    const created = addBlankSession(emptyState(), '2026-03-04');
    let state = addSessionExercise(
      created.state,
      created.sessionId,
      'barbell-bench-press',
    );
    state = addSessionExercise(state, created.sessionId, 'barbell-bench-press');
    const slots = state.sessions[created.sessionId].snapshot!.exercises.map(
      (e) => e.slotId,
    );
    expect(new Set(slots).size).toBe(2);
  });

  it('carries the movement load mode into the snapshot', () => {
    const created = addBlankSession(emptyState(), '2026-03-04');
    const next = addSessionExercise(
      created.state,
      created.sessionId,
      'wide-grip-pull-ups',
    );
    expect(
      next.sessions[created.sessionId].snapshot?.exercises[0].loadMode,
    ).toBe('bodyweight');
  });

  it('leaves a session that does not exist untouched', () => {
    const state = emptyState();
    expect(addSessionExercise(state, 'nope', 'barbell-bench-press')).toBe(
      state,
    );
  });
});

describe('skipping and restoring', () => {
  it('skips a scheduled session and puts it back', () => {
    const { state, sessionId } = addExtraSession(
      emptyState(),
      '2026-03-04',
      'day1',
    );
    const skipped = setStatus(state, sessionId, 'skipped');
    expect(skipped.sessions[sessionId].status).toBe('skipped');
    const restored = setStatus(skipped, sessionId, 'scheduled');
    expect(restored.sessions[sessionId].status).toBe('scheduled');
  });

  it('refuses to skip a completed session', () => {
    const created = addSession(emptyState(), {
      routineDayId: 'day1',
      status: 'completed',
      performedDate: '2026-03-04',
    });
    expect(
      setStatus(created.state, created.sessionId, 'skipped').sessions[
        created.sessionId
      ].status,
    ).toBe('completed');
  });
});
