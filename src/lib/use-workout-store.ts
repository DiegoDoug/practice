'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyState } from './backup';
import { storage } from './storage';
import type { SaveStatus, WorkoutState } from './types';

const SAVE_DEBOUNCE_MS = 400;

type Updater = (previous: WorkoutState) => WorkoutState;

export type WorkoutStore = {
  state: WorkoutState;
  hydrated: boolean;
  status: SaveStatus;
  /** Apply an immutable update and schedule a debounced save. */
  update: (updater: Updater) => void;
  /** Replace all state and persist immediately (used by backup restore). */
  replace: (next: WorkoutState) => Promise<void>;
  flush: () => Promise<void>;
};

export function useWorkoutStore(): WorkoutStore {
  const [state, setState] = useState<WorkoutState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const latest = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    storage
      .load()
      .then((loaded) => {
        if (cancelled) return;
        latest.current = loaded;
        setState(loaded);
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async () => {
    if (!pending.current) return;
    pending.current = false;
    setStatus('saving');
    try {
      await storage.save(latest.current);
      setStatus('saved');
    } catch {
      pending.current = true;
      setStatus('error');
    }
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await persist();
  }, [persist]);

  const schedule = useCallback(() => {
    pending.current = true;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void persist();
    }, SAVE_DEBOUNCE_MS);
  }, [persist]);

  const update = useCallback(
    (updater: Updater) => {
      setState((previous) => {
        const next = updater(previous);
        latest.current = next;
        return next;
      });
      schedule();
    },
    [schedule],
  );

  const replace = useCallback(async (next: WorkoutState) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    latest.current = next;
    setState(next);
    setStatus('saving');
    try {
      await storage.save(next);
      pending.current = false;
      setStatus('saved');
    } catch {
      setStatus('error');
      throw new Error('Could not save restored data.');
    }
  }, []);

  // Flush pending work when the tab is hidden or the page unloads.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  return { state, hydrated, status, update, replace, flush };
}
