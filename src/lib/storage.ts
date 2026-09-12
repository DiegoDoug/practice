import { get, set as idbSet } from 'idb-keyval';
import { parseBackup, emptyState } from './backup';
import type { WorkoutState } from './types';

export const STORAGE_KEY = 'weekly-practice-log/state';
/** Key written by the original localStorage-only version, imported once. */
export const LEGACY_STORAGE_KEY = 'workout-state';

export type StorageAdapter = {
  load(): Promise<WorkoutState>;
  save(state: WorkoutState): Promise<void>;
};

const isBrowser = (): boolean => typeof window !== 'undefined';

/** localStorage fallback used when IndexedDB is unavailable (e.g. private mode). */
const localAdapter: StorageAdapter = {
  async load() {
    if (!isBrowser()) return emptyState();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = parseBackup(JSON.parse(raw));
    return parsed.ok ? parsed.state : emptyState();
  },
  async save(state) {
    if (!isBrowser()) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  },
};

/** Read data left behind by the pre-IndexedDB version, if any. */
function readLegacyState(): WorkoutState | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseBackup(JSON.parse(raw));
    return parsed.ok ? parsed.state : null;
  } catch {
    return null;
  }
}

/** Versioned IndexedDB adapter with a localStorage fallback and legacy import. */
export const storage: StorageAdapter = {
  async load() {
    if (!isBrowser()) return emptyState();
    try {
      const stored = await get(STORAGE_KEY);
      if (stored !== undefined) {
        const parsed = parseBackup(stored);
        if (parsed.ok) return parsed.state;
      }
      const legacy = readLegacyState();
      if (legacy) {
        await idbSet(STORAGE_KEY, legacy);
        return legacy;
      }
      return emptyState();
    } catch {
      try {
        return await localAdapter.load();
      } catch {
        return emptyState();
      }
    }
  },
  async save(state) {
    if (!isBrowser()) return;
    try {
      await idbSet(STORAGE_KEY, state);
    } catch {
      await localAdapter.save(state);
    }
  },
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
