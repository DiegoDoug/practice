'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCelebrated, saveCelebrated } from './storage';

export type CelebrationStore = {
  /** Filters out keys already celebrated, and remembers the rest. */
  claim: (keys: string[]) => string[];
};

/**
 * Remembers which record celebrations have been shown.
 *
 * `claim` is the whole interface: hand it the keys a completion would
 * celebrate, and it returns only the ones not seen before, recording them as it
 * goes. Nothing celebrates during hydration because nothing calls `claim`
 * during hydration — the only caller is the explicit-completion path.
 */
export function useCelebrations(): CelebrationStore {
  const seen = useRef<Set<string>>(new Set());
  const [, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCelebrated().then((keys) => {
      if (cancelled) return;
      for (const key of keys) seen.current.add(key);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const claim = useCallback((keys: string[]): string[] => {
    const fresh = keys.filter((key) => !seen.current.has(key));
    if (fresh.length === 0) return [];
    for (const key of fresh) seen.current.add(key);
    void saveCelebrated([...seen.current]);
    return fresh;
  }, []);

  return { claim };
}
