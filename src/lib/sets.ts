/**
 * Explicit set completion.
 *
 * Completion is an act, not an inference. Nothing here reads a set as finished
 * because it happens to hold plausible numbers: the athlete ticks it, and only
 * that transition completes a set or starts the rest timer. The old behaviour —
 * blur on any field completing the row — could not tell "I finished this set"
 * from "I corrected a typo", and restarted rest on both.
 *
 * `markDone` is deliberately idempotent and identity-preserving so a caller can
 * detect "nothing changed" by reference. That is what stops a second click, or
 * a re-render, from restarting a countdown that is already running.
 */

import { isSetComplete, type CompletionMode } from './completion';
import type { SetEntry, SetKind } from './types';

export const newSetId = (): string =>
  `set_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** Give a set an id if it has none. Existing ids are never reissued. */
export const withSetId = (set: SetEntry): SetEntry =>
  set.setId ? set : { ...set, setId: newSetId() };

const replace = (sets: SetEntry[], index: number, next: SetEntry): SetEntry[] =>
  sets.map((set, i) => (i === index ? next : set));

/**
 * Mark a set finished. A no-op — returning the SAME array — when the set is
 * already done or does not carry what its mode requires, so repeated clicks
 * neither restamp the time nor re-trigger anything downstream.
 */
export function markDone(
  sets: SetEntry[],
  index: number,
  mode: CompletionMode,
  now: number,
): SetEntry[] {
  const set = sets[index];
  if (!set || set.done) return sets;
  if (!isSetComplete(set, mode)) return sets;
  return replace(sets, index, { ...withSetId(set), done: true, doneAt: now });
}

/**
 * Reopen a set. The values and the id survive — reopening is "I am not finished
 * after all", not "discard this" — but it leaves every completed-set metric at
 * once, which is why `doneAt` goes too rather than lingering as a stale claim.
 */
export function reopen(sets: SetEntry[], index: number): SetEntry[] {
  const set = sets[index];
  if (!set || !set.done) return sets;
  const next = { ...set };
  delete next.done;
  delete next.doneAt;
  return replace(sets, index, next);
}

export const toggleDone = (
  sets: SetEntry[],
  index: number,
  mode: CompletionMode,
  now: number,
): SetEntry[] =>
  sets[index]?.done ? reopen(sets, index) : markDone(sets, index, mode, now);

export function setSetKind(
  sets: SetEntry[],
  index: number,
  kind: SetKind,
): SetEntry[] {
  const set = sets[index];
  if (!set) return sets;
  return replace(sets, index, { ...withSetId(set), kind });
}

/**
 * Failure is recorded separately from kind: a working set and a drop set can
 * both end there, and reaching failure disqualifies no record.
 */
export function setReachedFailure(
  sets: SetEntry[],
  index: number,
  reached: boolean,
): SetEntry[] {
  const set = sets[index];
  if (!set) return sets;
  const next = { ...withSetId(set) };
  if (reached) next.reachedFailure = true;
  else delete next.reachedFailure;
  return replace(sets, index, next);
}

/**
 * Whether `markDone` would change anything — the set exists, is not already
 * done, and carries what its mode requires.
 *
 * Lets a caller decide to dispatch a completion without first computing the
 * result against a possibly stale copy of the sets.
 */
export function markDoneChanges(
  sets: SetEntry[],
  index: number,
  mode: CompletionMode,
): boolean {
  const set = sets[index];
  return Boolean(set) && !set.done && isSetComplete(set, mode);
}
