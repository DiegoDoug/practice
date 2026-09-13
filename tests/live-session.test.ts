import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REST_SEC,
  STALE_AFTER_MS,
  elapsedMs,
  extendRest,
  formatDuration,
  isPaused,
  isRestComplete,
  isStale,
  pauseSession,
  restRemainingMs,
  resumeSession,
  skipRest,
  startRest,
  startSession,
  togglePause,
} from '@/lib/live-session';

const T0 = 1_800_000_000_000;
const sec = (n: number) => n * 1000;
const min = (n: number) => n * 60_000;

const session = () => startSession('2026-09-07', 'day1', T0);

describe('startSession', () => {
  it('pins the week it began in', () => {
    // Finishing after a Monday rollover must still write to the starting week.
    expect(session().weekKey).toBe('2026-09-07');
  });

  it('starts running, unpaused, with no rest', () => {
    const s = session();
    expect(isPaused(s)).toBe(false);
    expect(s.pausedMs).toBe(0);
    expect(s.rest).toBeNull();
    expect(s.restDefaultSec).toBe(DEFAULT_REST_SEC);
  });
});

describe('elapsedMs', () => {
  it('counts forward while running', () => {
    expect(elapsedMs(session(), T0 + min(5))).toBe(min(5));
  });

  it('is zero at the moment it starts', () => {
    expect(elapsedMs(session(), T0)).toBe(0);
  });

  it('freezes while paused', () => {
    const paused = pauseSession(session(), T0 + min(5));
    expect(elapsedMs(paused, T0 + min(9))).toBe(min(5));
    expect(elapsedMs(paused, T0 + min(30))).toBe(min(5));
  });

  it('excludes paused time once resumed', () => {
    let s = pauseSession(session(), T0 + min(5));
    s = resumeSession(s, T0 + min(8));
    // Three minutes of the ten were spent paused.
    expect(elapsedMs(s, T0 + min(10))).toBe(min(7));
  });

  it('accumulates across two pause cycles', () => {
    let s = pauseSession(session(), T0 + min(5));
    s = resumeSession(s, T0 + min(7));
    s = pauseSession(s, T0 + min(10));
    s = resumeSession(s, T0 + min(14));
    // Six of twenty minutes paused.
    expect(elapsedMs(s, T0 + min(20))).toBe(min(14));
  });

  it('clamps to zero if the clock moves backwards', () => {
    expect(elapsedMs(session(), T0 - min(5))).toBe(0);
  });
});

describe('pause and resume', () => {
  it('pausing twice does not lose time', () => {
    const once = pauseSession(session(), T0 + min(5));
    expect(pauseSession(once, T0 + min(9))).toBe(once);
  });

  it('resuming while already running is a no-op', () => {
    const s = session();
    expect(resumeSession(s, T0 + min(1))).toBe(s);
  });

  it('togglePause flips both ways', () => {
    const paused = togglePause(session(), T0 + min(2));
    expect(isPaused(paused)).toBe(true);
    expect(isPaused(togglePause(paused, T0 + min(3)))).toBe(false);
  });

  it('never mutates its input', () => {
    const s = session();
    const snapshot = JSON.stringify(s);
    pauseSession(s, T0 + min(1));
    startRest(s, T0 + min(1));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('rest timer', () => {
  it('counts down from the default', () => {
    const s = startRest(session(), T0);
    expect(restRemainingMs(s, T0)).toBe(sec(DEFAULT_REST_SEC));
    expect(restRemainingMs(s, T0 + sec(30))).toBe(sec(DEFAULT_REST_SEC - 30));
  });

  it('floors at zero rather than going negative', () => {
    const s = startRest(session(), T0);
    expect(restRemainingMs(s, T0 + sec(500))).toBe(0);
    expect(isRestComplete(s, T0 + sec(500))).toBe(true);
  });

  it('is null when no rest is running', () => {
    expect(restRemainingMs(session(), T0)).toBeNull();
    expect(isRestComplete(session(), T0)).toBe(false);
  });

  it('skipping clears it', () => {
    expect(restRemainingMs(skipRest(startRest(session(), T0)), T0)).toBeNull();
  });

  it('extending adds to the remaining time', () => {
    const s = extendRest(startRest(session(), T0), 30);
    expect(restRemainingMs(s, T0)).toBe(sec(DEFAULT_REST_SEC + 30));
  });

  it('extending does nothing when not resting', () => {
    const s = session();
    expect(extendRest(s, 30)).toBe(s);
  });

  it('survives a suspended tab, because it is derived from timestamps', () => {
    // No ticking counter to fall behind: jumping forward gives the right answer.
    const s = startRest(session(), T0, 120);
    expect(restRemainingMs(s, T0 + sec(119))).toBe(sec(1));
  });
});

describe('isStale', () => {
  it('is false for a session started moments ago', () => {
    expect(isStale(session(), T0 + min(90))).toBe(false);
  });

  it('is true once it has run far too long to be real', () => {
    expect(isStale(session(), T0 + STALE_AFTER_MS + 1)).toBe(true);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [sec(9), '0:09'],
    [sec(75), '1:15'],
    [min(59) + sec(59), '59:59'],
    [min(60), '1:00:00'],
    [min(73) + sec(4), '1:13:04'],
  ])('formats %i as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('never renders a negative duration', () => {
    expect(formatDuration(-5000)).toBe('0:00');
  });
});
