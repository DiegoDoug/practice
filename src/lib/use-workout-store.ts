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
  /**
   * Set when stored data exists but could not be read. The app goes read-only:
   * writing anything would overwrite a log we failed to parse.
   */
  safeMode: { error: string; raw: unknown } | null;
  /** Apply an immutable update and schedule a debounced save. */
  update: (updater: Updater) => void;
  /**
   * The newest state, including a write queued earlier in this same tick.
   *
   * `state` is the last RENDERED value, so two writes in one event would both
   * read the same stale base from it. Anything that has to reason about the
   * result of a write it just made — the record check — reads this instead.
   */
  latestState: () => WorkoutState;
  /** Replace all state and persist immediately (used by backup restore). */
  replace: (next: WorkoutState) => Promise<void>;
  flush: () => Promise<void>;
};

export function useWorkoutStore(): WorkoutStore {
  const [state, setState] = useState<WorkoutState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [safeMode, setSafeMode] = useState<{
    error: string;
    raw: unknown;
  } | null>(null);

  const latest = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  /** Blocks every write path while stored data is unreadable. */
  const readOnly = useRef(false);

  useEffect(() => {
    let cancelled = false;
    storage
      .load()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.status === 'error') {
          readOnly.current = true;
          setSafeMode({ error: loaded.error, raw: loaded.raw });
          setStatus('error');
          return;
        }
        latest.current = loaded.state;
        setState(loaded.state);
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
    if (readOnly.current) return;
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

  /**
   * The updater runs EAGERLY against the ref rather than being handed to
   * `setState`.
   *
   * React defers a functional update until render, so with the old shape
   * `latest.current` lagged behind by a tick and two updates dispatched from one
   * event both saw the same base — the second silently discarding the first.
   * Sequencing through the ref makes each update build on the previous one
   * immediately, and `setState` just mirrors the result.
   */
  const update = useCallback(
    (updater: Updater) => {
      if (readOnly.current) return;
      const next = updater(latest.current);
      latest.current = next;
      setState(next);
      schedule();
    },
    [schedule],
  );

  /**
   * Deliberately permitted in safe mode: restoring a backup is how a user
   * recovers from unreadable stored data, so it clears the read-only latch.
   */
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
      readOnly.current = false;
      setSafeMode(null);
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

  const latestState = useCallback(() => latest.current, []);

  return {
    state,
    hydrated,
    status,
    safeMode,
    update,
    latestState,
    replace,
    flush,
  };
}
