import { describe, expect, it } from 'vitest';
import {
  isCountedWorkingSet,
  isRecordEligible,
  isSetComplete,
  setKind,
} from '@/lib/completion';
import {
  markDone,
  newSetId,
  reopen,
  setSetKind,
  setReachedFailure,
  toggleDone,
  withSetId,
} from '@/lib/sets';
import { blankSet, cloneSet, type SetEntry } from '@/lib/types';
import { repeatLast, updateSet } from '@/lib/workout';

const NOW = 1_800_000_000_000;

const done = (patch: Partial<SetEntry> = {}): SetEntry => ({
  setId: 'a',
  weight: '60',
  reps: '8',
  rpe: '',
  done: true,
  doneAt: NOW,
  ...patch,
});

const external = { loadMode: 'external' as const };

describe('set ids', () => {
  it('mints ids that do not collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSetId()));
    expect(ids.size).toBe(500);
  });

  it('gives a new blank set an id', () => {
    expect(blankSet().setId).toBeTruthy();
    expect(blankSet(true).setId).toBeTruthy();
  });

  it('gives each blank set a distinct id', () => {
    expect(blankSet().setId).not.toBe(blankSet().setId);
  });

  it('leaves an existing id alone and fills in a missing one', () => {
    expect(
      withSetId({ weight: '', reps: '', rpe: '', setId: 'keep' }).setId,
    ).toBe('keep');
    expect(withSetId({ weight: '', reps: '', rpe: '' }).setId).toBeTruthy();
  });
});

describe('toggleDone', () => {
  const sets = (): SetEntry[] => [
    { setId: 'a', weight: '60', reps: '8', rpe: '' },
    { setId: 'b', weight: '', reps: '', rpe: '' },
  ];

  it('completes a valid set and stamps when it happened', () => {
    const next = toggleDone(sets(), 0, external, NOW);
    expect(next[0].done).toBe(true);
    expect(next[0].doneAt).toBe(NOW);
  });

  it('refuses to complete a set that does not carry what its mode needs', () => {
    const next = toggleDone(sets(), 1, external, NOW);
    expect(next[1].done).toBeFalsy();
    expect(next[1].doneAt).toBeUndefined();
  });

  it('reopens a completed set, clearing the timestamp with it', () => {
    const next = toggleDone([done()], 0, external, NOW + 1000);
    expect(next[0].done).toBeFalsy();
    expect(next[0].doneAt).toBeUndefined();
  });

  it('leaves the other rows untouched', () => {
    const before = sets();
    const next = toggleDone(before, 0, external, NOW);
    expect(next[1]).toBe(before[1]);
  });

  it('does not mutate its input', () => {
    const before = sets();
    toggleDone(before, 0, external, NOW);
    expect(before[0].done).toBeUndefined();
  });
});

describe('markDone is idempotent, so repeated clicks cannot restart rest', () => {
  it('returns the same array when the set is already done', () => {
    const already = [done()];
    expect(markDone(already, 0, external, NOW + 5000)).toBe(already);
  });

  it('keeps the original completion time across repeated calls', () => {
    const first = markDone(
      [{ setId: 'a', weight: '60', reps: '8', rpe: '' }],
      0,
      external,
      NOW,
    );
    const second = markDone(first, 0, external, NOW + 9000);
    expect(second[0].doneAt).toBe(NOW);
  });

  it('returns a new array only when something actually changed', () => {
    const start: SetEntry[] = [
      { setId: 'a', weight: '60', reps: '8', rpe: '' },
    ];
    expect(markDone(start, 0, external, NOW)).not.toBe(start);

    const unchanged = [done()];
    expect(markDone(unchanged, 0, external, NOW)).toBe(unchanged);
  });
});

describe('reopen', () => {
  it('removes a set from every completed-set metric', () => {
    const set = done();
    expect(isCountedWorkingSet(set)).toBe(true);
    expect(isRecordEligible(set)).toBe(true);

    const reopened = reopen([set], 0)[0];
    expect(reopened.done).toBeFalsy();
    expect(isCountedWorkingSet(reopened)).toBe(false);
    expect(isRecordEligible(reopened)).toBe(false);
  });

  it('keeps the values and the id, so nothing is lost by reopening', () => {
    const reopened = reopen([done()], 0)[0];
    expect(reopened.weight).toBe('60');
    expect(reopened.reps).toBe('8');
    expect(reopened.setId).toBe('a');
  });
});

describe('completion by logging mode', () => {
  const bodyweight = { loadMode: 'bodyweight' as const };

  it('completes a bodyweight set with reps alone', () => {
    const sets: SetEntry[] = [{ setId: 'a', weight: '', reps: '12', rpe: '' }];
    expect(toggleDone(sets, 0, bodyweight, NOW)[0].done).toBe(true);
  });

  it('will not complete a bodyweight set with no reps', () => {
    const sets: SetEntry[] = [{ setId: 'a', weight: '', reps: '', rpe: '' }];
    expect(toggleDone(sets, 0, bodyweight, NOW)[0].done).toBeFalsy();
  });

  it('needs both sides of a unilateral set', () => {
    const mode = { loadMode: 'external' as const, unilateral: true };
    const oneSide: SetEntry[] = [
      {
        setId: 'a',
        weight: '50',
        reps: '10',
        rpe: '',
        right: { weight: '', reps: '', rpe: '' },
      },
    ];
    expect(toggleDone(oneSide, 0, mode, NOW)[0].done).toBeFalsy();

    const bothSides: SetEntry[] = [
      {
        setId: 'a',
        weight: '50',
        reps: '10',
        rpe: '',
        right: { weight: '50', reps: '9', rpe: '' },
      },
    ];
    expect(toggleDone(bothSides, 0, mode, NOW)[0].done).toBe(true);
  });
});

describe('editing a completed set', () => {
  it('keeps it complete when the new value is still valid', () => {
    const edited = updateSet([done()], 0, 'weight', '65');
    expect(edited[0].done).toBe(true);
    expect(edited[0].weight).toBe('65');
  });

  it('drops completion when the edit leaves the row unfinished', () => {
    // A set with its reps cleared is no longer a finished set, and must stop
    // counting towards working volume and records immediately.
    const edited = updateSet([done()], 0, 'reps', '');
    expect(edited[0].done).toBeFalsy();
    expect(edited[0].doneAt).toBeUndefined();
    expect(isCountedWorkingSet(edited[0])).toBe(false);
  });

  it('keeps the id through an edit', () => {
    expect(updateSet([done()], 0, 'weight', '65')[0].setId).toBe('a');
  });

  it('never marks an unfinished set complete just by typing into it', () => {
    const draft: SetEntry[] = [{ setId: 'a', weight: '', reps: '', rpe: '' }];
    const typed = updateSet(
      updateSet(draft, 0, 'weight', '60'),
      0,
      'reps',
      '8',
    );
    expect(typed[0].done).toBeFalsy();
  });
});

describe('copying sets', () => {
  it('repeat last produces an unfinished set with a new id', () => {
    const prior = {
      sessionId: 'prev',
      date: '2026-03-02',
      dayId: 'day1',
      slotId: 'day1-s0',
      movementId: 'barbell-bench-press',
      unilateral: false,
      sets: [done()],
    };
    const next = repeatLast([blankSet()], prior);
    expect(next).toHaveLength(2);
    expect(next[1].weight).toBe('60');
    expect(next[1].done).toBeFalsy();
    expect(next[1].doneAt).toBeUndefined();
    expect(next[1].setId).toBeTruthy();
    expect(next[1].setId).not.toBe('a');
  });

  it('cloneSet carries the values but never the completion', () => {
    const copy = cloneSet(done({ kind: 'drop', reachedFailure: true }));
    expect(copy.weight).toBe('60');
    expect(copy.done).toBeUndefined();
    expect(copy.doneAt).toBeUndefined();
    expect(copy.setId).not.toBe('a');
    // Kind is a property of the set being copied, so it comes along.
    expect(copy.kind).toBe('drop');
  });

  it('gives each repeat its own id', () => {
    const prior = {
      sessionId: 'prev',
      date: '2026-03-02',
      dayId: null,
      slotId: 's',
      movementId: 'm',
      unilateral: false,
      sets: [done()],
    };
    let sets = [blankSet()];
    sets = repeatLast(sets, prior);
    sets = repeatLast(sets, prior);
    expect(sets[1].setId).not.toBe(sets[2].setId);
  });
});

describe('set kind and failure are independent', () => {
  it('defaults to a working set', () => {
    expect(setKind(blankSet())).toBe('working');
  });

  it('excludes a warmup from working counts and records', () => {
    const warmup = setSetKind([done()], 0, 'warmup')[0];
    expect(isCountedWorkingSet(warmup)).toBe(false);
    expect(isRecordEligible(warmup)).toBe(false);
  });

  it('counts a drop set as work but not as a record', () => {
    const drop = setSetKind([done()], 0, 'drop')[0];
    expect(isCountedWorkingSet(drop)).toBe(true);
    expect(isRecordEligible(drop)).toBe(false);
  });

  it('keeps a working set taken to failure fully eligible', () => {
    const failed = setReachedFailure([done()], 0, true)[0];
    expect(failed.reachedFailure).toBe(true);
    expect(setKind(failed)).toBe('working');
    expect(isCountedWorkingSet(failed)).toBe(true);
    expect(isRecordEligible(failed)).toBe(true);
  });

  it('lets a drop set also reach failure without changing its kind', () => {
    const dropToFailure = setReachedFailure(
      setSetKind([done()], 0, 'drop'),
      0,
      true,
    )[0];
    expect(setKind(dropToFailure)).toBe('drop');
    expect(dropToFailure.reachedFailure).toBe(true);
    expect(isRecordEligible(dropToFailure)).toBe(false);
  });

  it('never counts an unfinished set, whatever its kind', () => {
    const draft: SetEntry = { setId: 'a', weight: '60', reps: '8', rpe: '' };
    expect(isCountedWorkingSet(draft)).toBe(false);
    expect(isRecordEligible(draft)).toBe(false);
    expect(isSetComplete(draft, external)).toBe(true); // valid, just not ticked
  });
});
