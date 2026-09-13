'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  isStale,
  pauseSession,
  resumeSession,
  skipRest as skipRestOf,
  startRest as startRestOf,
  startSession,
  extendRest as extendRestOf,
  type LiveSession,
} from './live-session';
import { clearSession, loadSession, saveSession } from './storage';

export type LiveSessionStore = {
  session: LiveSession | null;
  hydrated: boolean;
  start: (weekKey: string, dayId: string) => void;
  pause: () => void;
  resume: () => void;
  finish: () => void;
  discard: () => void;
  startRest: () => void;
  skipRest: () => void;
  extendRest: (bySec: number) => void;
};

/**
 * Owns the in-flight workout. Note there is no ticking state here: the clock
 * lives inside the bar that renders it, so a running session does not
 * re-render the exercise list once a second.
 */
export function useLiveSession(): LiveSessionStore {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSession()
      .then((loaded) => {
        if (cancelled) return;
        // A session left running overnight is a leftover, not a workout.
        if (loaded && isStale(loaded)) {
          void clearSession();
          return;
        }
        if (loaded) setSession(loaded);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const write = useCallback((next: LiveSession | null) => {
    setSession(next);
    if (next) void saveSession(next);
    else void clearSession();
  }, []);

  const mutate = useCallback((fn: (current: LiveSession) => LiveSession) => {
    setSession((current) => {
      if (!current) return current;
      const next = fn(current);
      void saveSession(next);
      return next;
    });
  }, []);

  const start = useCallback(
    (weekKey: string, dayId: string) => write(startSession(weekKey, dayId)),
    [write],
  );

  const pause = useCallback(() => mutate((s) => pauseSession(s)), [mutate]);
  const resume = useCallback(() => mutate((s) => resumeSession(s)), [mutate]);
  const finish = useCallback(() => write(null), [write]);
  const discard = useCallback(() => write(null), [write]);
  const startRest = useCallback(() => mutate((s) => startRestOf(s)), [mutate]);
  const skipRest = useCallback(() => mutate((s) => skipRestOf(s)), [mutate]);
  const extendRest = useCallback(
    (bySec: number) => mutate((s) => extendRestOf(s, bySec)),
    [mutate],
  );

  return {
    session,
    hydrated,
    start,
    pause,
    resume,
    finish,
    discard,
    startRest,
    skipRest,
    extendRest,
  };
}
