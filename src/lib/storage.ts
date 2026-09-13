import { del, get, set as idbSet } from 'idb-keyval';
import { parseBackup, emptyState, CURRENT_SCHEMA_VERSION } from './backup';
import type { WorkoutState } from './types';
import type { LiveSession } from './live-session';

export const STORAGE_KEY = 'weekly-practice-log/state';
/** Key written by the original localStorage-only version, imported once. */
export const LEGACY_STORAGE_KEY = 'workout-state';
/**
 * Holds the document exactly as it was before a schema upgrade. It exists so a
 * rolled-back build — which would reject the newer schemaVersion and otherwise
 * look like total data loss — has a recovery path.
 */
export const PRE_UPGRADE_KEY = 'weekly-practice-log/state.pre-upgrade';

/**
 * The outcome of reading persisted data.
 *
 * `error` is deliberately distinct from `empty`: a document that exists but
 * cannot be parsed must NEVER be treated as "no data", because the store would
 * then autosave an empty state straight over the user's real training log.
 */
export type LoadResult =
  | { status: 'ok'; state: WorkoutState }
  | { status: 'empty'; state: WorkoutState }
  | { status: 'error'; error: string; raw: unknown };

export type StorageAdapter = {
  load(): Promise<LoadResult>;
  save(state: WorkoutState): Promise<void>;
};

const isBrowser = (): boolean => typeof window !== 'undefined';

/** Interpret a stored document, keeping "unreadable" separate from "absent". */
function interpret(raw: unknown): LoadResult {
  const parsed = parseBackup(raw);
  if (!parsed.ok) return { status: 'error', error: parsed.error, raw };
  return { status: 'ok', state: parsed.state };
}

/** localStorage fallback used when IndexedDB is unavailable (e.g. private mode). */
const localAdapter: StorageAdapter = {
  async load() {
    if (!isBrowser()) return { status: 'empty', state: emptyState() };
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { status: 'empty', state: emptyState() };
    try {
      return interpret(JSON.parse(raw));
    } catch {
      return { status: 'error', error: 'Saved data is not valid JSON.', raw };
    }
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

/** Keep the pre-upgrade document so a rollback is recoverable. Best effort. */
async function stashPreUpgrade(raw: unknown): Promise<void> {
  try {
    const existing = await get(PRE_UPGRADE_KEY);
    // Only the first upgrade is stashed; a later one must not clobber the
    // original, which is the version a rollback would actually need.
    if (existing === undefined) await idbSet(PRE_UPGRADE_KEY, raw);
  } catch {
    // A missing stash is not worth failing the load over.
  }
}

/** True when a recoverable pre-upgrade document is present. */
export async function hasPreUpgradeBackup(): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    return (await get(PRE_UPGRADE_KEY)) !== undefined;
  } catch {
    return false;
  }
}

export async function readPreUpgradeBackup(): Promise<unknown> {
  if (!isBrowser()) return undefined;
  try {
    return await get(PRE_UPGRADE_KEY);
  } catch {
    return undefined;
  }
}

export async function clearPreUpgradeBackup(): Promise<void> {
  if (!isBrowser()) return;
  try {
    await del(PRE_UPGRADE_KEY);
  } catch {
    // Nothing to do — the stash is advisory.
  }
}

/** Versioned IndexedDB adapter with a localStorage fallback and legacy import. */
export const storage: StorageAdapter = {
  async load() {
    if (!isBrowser()) return { status: 'empty', state: emptyState() };
    try {
      const stored = await get(STORAGE_KEY);
      if (stored !== undefined) {
        const result = interpret(stored);
        if (result.status === 'ok') {
          const storedVersion = (stored as { schemaVersion?: unknown })
            ?.schemaVersion;
          if (
            typeof storedVersion !== 'number' ||
            storedVersion < CURRENT_SCHEMA_VERSION
          ) {
            await stashPreUpgrade(stored);
          }
        }
        return result;
      }
      const legacy = readLegacyState();
      if (legacy) {
        await idbSet(STORAGE_KEY, legacy);
        return { status: 'ok', state: legacy };
      }
      return { status: 'empty', state: emptyState() };
    } catch {
      try {
        return await localAdapter.load();
      } catch {
        return { status: 'empty', state: emptyState() };
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

// --- Live session ---------------------------------------------------------

/**
 * The in-flight workout lives under its own key, deliberately outside
 * WorkoutState: a half-finished timer has no business in a JSON backup, and
 * restoring a backup should not resurrect someone else's paused session.
 */
export const SESSION_KEY = 'weekly-practice-log/session';

/**
 * A timer stored by a pre-v5 build carried `weekKey` + `dayId` instead of a
 * session id. It fails this check and is therefore discarded on load, which is
 * the safe outcome: the hook that hydrates the timer has no access to
 * WorkoutState, so it cannot resolve which migrated session the timer belonged
 * to without a hydration race. Nothing logged is lost — sets autosave through
 * their own path — only the running clock.
 */
const isLiveSession = (value: unknown): value is LiveSession => {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.sessionId === 'string' &&
    typeof s.startedAt === 'number' &&
    (s.pausedAt === null || typeof s.pausedAt === 'number') &&
    typeof s.pausedMs === 'number' &&
    typeof s.restDefaultSec === 'number'
  );
};

export async function loadSession(): Promise<LiveSession | null> {
  if (!isBrowser()) return null;
  try {
    const stored = await get(SESSION_KEY);
    return isLiveSession(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: LiveSession): Promise<void> {
  if (!isBrowser()) return;
  try {
    await idbSet(SESSION_KEY, session);
  } catch {
    // A lost timer is an inconvenience, never a reason to fail the workout.
  }
}

export async function clearSession(): Promise<void> {
  if (!isBrowser()) return;
  try {
    await del(SESSION_KEY);
  } catch {
    // As above.
  }
}
