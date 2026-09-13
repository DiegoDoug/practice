import { describe, expect, it } from 'vitest';
import { emptyState } from '@/lib/backup';
import {
  addSession,
  compareSessions,
  ensureWeekDaySession,
  effectiveDate,
  findWeekDaySession,
  isDateKnown,
  removeSession,
  reschedule,
  sessionsInWeek,
  sessionsOnDate,
  setPerformedDate,
  setStatus,
  startedSession,
  newSessionId,
  legacySessionId,
} from '@/lib/sessions';
import { isSetComplete } from '@/lib/completion';
import type { WorkoutSession } from '@/lib/types';

const session = (patch: Partial<WorkoutSession>): WorkoutSession => ({
  sessionId: patch.sessionId ?? 's1',
  routineDayId: 'day1',
  status: 'scheduled',
  exercises: {},
  ...patch,
});

const withSessions = (...list: WorkoutSession[]) => ({
  ...emptyState(),
  sessions: Object.fromEntries(list.map((s) => [s.sessionId, s])),
});

describe('session ids', () => {
  it('mints opaque ids that do not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSessionId()));
    expect(ids.size).toBe(500);
  });

  it('does not encode a date in a new id, since dates move', () => {
    expect(newSessionId()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('mints deterministic ids for migrated sessions only', () => {
    expect(legacySessionId('2025-06-02', 'day1')).toBe(
      legacySessionId('2025-06-02', 'day1'),
    );
    expect(legacySessionId('2025-06-02', 'day1')).not.toBe(
      legacySessionId('2025-06-09', 'day1'),
    );
  });
});

describe('effectiveDate', () => {
  it('prefers the performed date over the scheduled one', () => {
    const s = session({
      scheduledDate: '2026-03-02',
      performedDate: '2026-03-03',
    });
    expect(effectiveDate(s)).toBe('2026-03-03');
    expect(isDateKnown(s)).toBe(true);
  });

  it('falls back to the scheduled date when not yet performed', () => {
    expect(effectiveDate(session({ scheduledDate: '2026-03-02' }))).toBe(
      '2026-03-02',
    );
  });

  it('falls back to the legacy week for a migrated session, flagged unknown', () => {
    const s = session({ legacyWeekKey: '2025-06-02' });
    expect(effectiveDate(s)).toBe('2025-06-02');
    // The date is a bucket, not a claim about which day it happened.
    expect(isDateKnown(s)).toBe(false);
  });

  it('is null when nothing at all is known', () => {
    expect(effectiveDate(session({}))).toBeNull();
  });
});

describe('sessionsInWeek', () => {
  it('buckets by the performed date, not the scheduled one', () => {
    // Planned for Sunday 2026-03-08 (week of Mar 2), trained Monday Mar 9.
    const late = session({
      sessionId: 'late',
      scheduledDate: '2026-03-08',
      performedDate: '2026-03-09',
      status: 'completed',
    });
    const state = withSessions(late);
    expect(sessionsInWeek(state, '2026-03-09').map((s) => s.sessionId)).toEqual(
      ['late'],
    );
    expect(sessionsInWeek(state, '2026-03-02')).toEqual([]);
  });

  it('buckets a migrated session under its original week', () => {
    const state = withSessions(
      session({ sessionId: 'old', legacyWeekKey: '2025-06-02' }),
    );
    expect(sessionsInWeek(state, '2025-06-02').map((s) => s.sessionId)).toEqual(
      ['old'],
    );
  });

  it('holds several sessions for the same routine day in one week', () => {
    const state = withSessions(
      session({ sessionId: 'a', performedDate: '2026-03-02' }),
      session({ sessionId: 'b', performedDate: '2026-03-05' }),
    );
    expect(sessionsInWeek(state, '2026-03-02')).toHaveLength(2);
  });
});

describe('sessionsOnDate', () => {
  it('returns every session on one date, in a deterministic order', () => {
    const state = withSessions(
      session({ sessionId: 'b', performedDate: '2026-03-02', startedAt: 200 }),
      session({ sessionId: 'a', performedDate: '2026-03-02', startedAt: 100 }),
      session({ sessionId: 'c', performedDate: '2026-03-03' }),
    );
    expect(sessionsOnDate(state, '2026-03-02').map((s) => s.sessionId)).toEqual(
      ['a', 'b'],
    );
  });
});

describe('reschedule', () => {
  it('moves the scheduled date while keeping identity and logs', () => {
    const state = withSessions(
      session({
        sessionId: 's1',
        scheduledDate: '2026-03-02',
        exercises: {
          'day1-s0': {
            movementId: 'barbell-bench-press',
            sets: [{ weight: '60', reps: '8', rpe: '' }],
          },
        },
      }),
    );
    const next = reschedule(state, 's1', '2026-03-04');
    expect(next.sessions.s1.sessionId).toBe('s1');
    expect(next.sessions.s1.scheduledDate).toBe('2026-03-04');
    expect(next.sessions.s1.exercises['day1-s0'].sets).toHaveLength(1);
  });

  it('leaves the performed date alone — moving a plan is not correcting history', () => {
    const state = withSessions(
      session({
        sessionId: 's1',
        scheduledDate: '2026-03-02',
        performedDate: '2026-03-02',
      }),
    );
    expect(
      reschedule(state, 's1', '2026-03-09').sessions.s1.performedDate,
    ).toBe('2026-03-02');
  });
});

describe('setPerformedDate', () => {
  it('corrects history without touching the plan', () => {
    const state = withSessions(
      session({ sessionId: 's1', scheduledDate: '2026-03-02' }),
    );
    const next = setPerformedDate(state, 's1', '2026-03-03');
    expect(next.sessions.s1.performedDate).toBe('2026-03-03');
    expect(next.sessions.s1.scheduledDate).toBe('2026-03-02');
  });
});

describe('setStatus', () => {
  it('applies a permitted transition', () => {
    const state = withSessions(session({ sessionId: 's1' }));
    expect(setStatus(state, 's1', 'in_progress').sessions.s1.status).toBe(
      'in_progress',
    );
  });

  it('refuses a forbidden one, leaving the state untouched', () => {
    const state = withSessions(session({ sessionId: 's1' }));
    expect(setStatus(state, 's1', 'completed')).toBe(state);
  });

  it('never allows two sessions to be in progress at once', () => {
    const state = withSessions(
      session({ sessionId: 'a', status: 'in_progress' }),
      session({ sessionId: 'b' }),
    );
    const next = setStatus(state, 'b', 'in_progress');
    // Starting one closes the other rather than leaving two live timers.
    expect(next.sessions.b.status).toBe('in_progress');
    expect(next.sessions.a.status).not.toBe('in_progress');
  });
});

describe('startedSession', () => {
  it('captures the performed date and start time on start', () => {
    const state = withSessions(
      session({ sessionId: 's1', scheduledDate: '2026-03-02' }),
    );
    const next = startedSession(state, 's1', '2026-03-03', 1000);
    expect(next.sessions.s1.status).toBe('in_progress');
    expect(next.sessions.s1.performedDate).toBe('2026-03-03');
    expect(next.sessions.s1.startedAt).toBe(1000);
  });

  it('holds the performed date across midnight once captured', () => {
    const state = withSessions(
      session({ sessionId: 's1', performedDate: '2026-03-02' }),
    );
    // Re-opening the next calendar day must not silently re-date the workout.
    const next = startedSession(state, 's1', '2026-03-03', 2000);
    expect(next.sessions.s1.performedDate).toBe('2026-03-02');
  });
});

describe('addSession and removeSession', () => {
  it('adds an ad-hoc session with no routine day', () => {
    const next = addSession(emptyState(), {
      routineDayId: null,
      scheduledDate: '2026-03-04',
    });
    const added = Object.values(next.state.sessions)[0];
    expect(added.routineDayId).toBeNull();
    expect(added.status).toBe('scheduled');
    expect(next.sessionId).toBe(added.sessionId);
  });

  it('removes one session without disturbing the others', () => {
    const state = withSessions(
      session({ sessionId: 'a' }),
      session({ sessionId: 'b' }),
    );
    const next = removeSession(state, 'a');
    expect(Object.keys(next.sessions)).toEqual(['b']);
  });
});

describe('findWeekDaySession', () => {
  it('finds the session for a routine day in a week', () => {
    const state = withSessions(
      session({
        sessionId: 's1',
        routineDayId: 'day1',
        performedDate: '2026-03-03',
      }),
    );
    expect(findWeekDaySession(state, '2026-03-02', 'day1')?.sessionId).toBe(
      's1',
    );
  });

  it('returns null rather than creating one', () => {
    expect(findWeekDaySession(emptyState(), '2026-03-02', 'day1')).toBeNull();
  });
});

describe('compareSessions', () => {
  it('orders by date, then by start time, then stably by id', () => {
    const a = session({ sessionId: 'a', performedDate: '2026-03-02' });
    const b = session({
      sessionId: 'b',
      performedDate: '2026-03-02',
      startedAt: 50,
    });
    const c = session({ sessionId: 'c', performedDate: '2026-03-03' });
    expect(compareSessions(a, c)).toBeLessThan(0);
    expect(compareSessions(b, a)).toBeLessThan(0);
    expect(compareSessions(a, a)).toBe(0);
  });

  it('sorts undated sessions last rather than guessing where they belong', () => {
    const dated = session({ sessionId: 'a', performedDate: '2026-03-02' });
    const undated = session({ sessionId: 'z' });
    expect(compareSessions(dated, undated)).toBeLessThan(0);
  });
});

describe('isSetComplete', () => {
  const set = (weight: string, reps: string, extra = {}) => ({
    weight,
    reps,
    rpe: '',
    ...extra,
  });

  it('needs reps and a load for an external movement', () => {
    expect(isSetComplete(set('60', '8'), { loadMode: 'external' })).toBe(true);
    expect(isSetComplete(set('', '8'), { loadMode: 'external' })).toBe(false);
    expect(isSetComplete(set('60', ''), { loadMode: 'external' })).toBe(false);
  });

  it('accepts zero load for an external movement — that is a real value', () => {
    expect(isSetComplete(set('0', '8'), { loadMode: 'external' })).toBe(true);
  });

  it('completes a bodyweight set with no load at all', () => {
    expect(isSetComplete(set('', '12'), { loadMode: 'bodyweight' })).toBe(true);
    expect(isSetComplete(set('', ''), { loadMode: 'bodyweight' })).toBe(false);
  });

  it('accepts added weight on a bodyweight movement', () => {
    expect(isSetComplete(set('20', '6'), { loadMode: 'bodyweight' })).toBe(
      true,
    );
  });

  it('rejects a half-typed draft', () => {
    expect(isSetComplete(set('1.', '8'), { loadMode: 'external' })).toBe(false);
    expect(isSetComplete(set('60', '8.5'), { loadMode: 'external' })).toBe(
      false,
    );
  });

  it('needs both sides for a unilateral set', () => {
    const both = { ...set('50', '10'), right: set('50', '9') };
    const leftOnly = { ...set('50', '10'), right: set('', '') };
    expect(
      isSetComplete(both, { loadMode: 'external', unilateral: true }),
    ).toBe(true);
    expect(
      isSetComplete(leftOnly, { loadMode: 'external', unilateral: true }),
    ).toBe(false);
  });
});

describe('ensureWeekDaySession', () => {
  const monday = '2026-03-02';
  const wednesday = '2026-03-04';

  it('creates a session dated today, so it is findable again', () => {
    const first = ensureWeekDaySession(emptyState(), monday, 'day1', wednesday);
    expect(first.state.sessions[first.sessionId].performedDate).toBe(wednesday);
    expect(findWeekDaySession(first.state, monday, 'day1')?.sessionId).toBe(
      first.sessionId,
    );
  });

  it('is idempotent: a second call never creates a duplicate', () => {
    const first = ensureWeekDaySession(emptyState(), monday, 'day1', wednesday);
    const second = ensureWeekDaySession(first.state, monday, 'day1', wednesday);
    expect(second.sessionId).toBe(first.sessionId);
    expect(Object.keys(second.state.sessions)).toHaveLength(1);
    expect(second.state).toBe(first.state);
  });

  it('schedules rather than dates a session for a week that is not today', () => {
    const next = ensureWeekDaySession(
      emptyState(),
      '2026-03-09',
      'day1',
      wednesday,
    );
    const created = next.state.sessions[next.sessionId];
    expect(created.performedDate).toBeUndefined();
    expect(created.scheduledDate).toBe(wednesday);
  });
});

describe('ensureWeekDaySession with a preferred id', () => {
  it('creates the session under the id the caller minted', () => {
    // Callers that need the id before the state update lands — starting the
    // timer — must be able to decide it up front.
    const next = ensureWeekDaySession(
      emptyState(),
      '2026-03-02',
      'day1',
      '2026-03-02',
      'chosen',
    );
    expect(next.sessionId).toBe('chosen');
    expect(next.state.sessions.chosen).toBeDefined();
  });

  it('still returns the existing session, ignoring the preferred id', () => {
    const first = ensureWeekDaySession(
      emptyState(),
      '2026-03-02',
      'day1',
      '2026-03-02',
    );
    const second = ensureWeekDaySession(
      first.state,
      '2026-03-02',
      'day1',
      '2026-03-02',
      'chosen',
    );
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.state.sessions.chosen).toBeUndefined();
  });
});
