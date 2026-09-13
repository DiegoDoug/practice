import { describe, expect, it } from 'vitest';
import {
  MOVEMENT_LIBRARY,
  mintMovementId,
  seededMovements,
  slugify,
  substitutesFor,
} from '@/lib/movements';
import { PROGRAM } from '@/lib/program';

describe('slugify', () => {
  it.each([
    ['Back Squat', 'back-squat'],
    ['Barbell / EZ Curl', 'barbell-ez-curl'],
    ['Dips / Tricep Pushdown', 'dips-tricep-pushdown'],
    ['Wide-Grip Pull-ups', 'wide-grip-pull-ups'],
    ['Front Squat / Hack Squat', 'front-squat-hack-squat'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
  ])('slugifies %j to %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('is stable across repeated calls', () => {
    expect(slugify('Barbell Row')).toBe(slugify('Barbell Row'));
  });

  it('strips accents rather than minting a second id', () => {
    expect(slugify('Bulgarian Split Squat')).toBe(
      slugify('Bulgarián Split Squat'),
    );
  });

  it('never returns an empty id', () => {
    expect(slugify('///')).toBe('movement');
    expect(slugify('')).toBe('movement');
  });
});

describe('MOVEMENT_LIBRARY', () => {
  it('has no duplicate ids', () => {
    const ids = MOVEMENT_LIBRARY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every movement a name, group and equipment', () => {
    for (const movement of MOVEMENT_LIBRARY) {
      expect(movement.name.trim()).not.toBe('');
      expect(movement.group.trim()).not.toBe('');
      expect(movement.equipment).toBeTruthy();
    }
  });

  it('resolves every declared variation id', () => {
    const ids = new Set(MOVEMENT_LIBRARY.map((m) => m.id));
    for (const movement of MOVEMENT_LIBRARY) {
      for (const variation of movement.variations ?? []) {
        expect(
          ids.has(variation),
          `${movement.id} → missing variation ${variation}`,
        ).toBe(true);
      }
    }
  });

  it('never lists itself as one of its own variations', () => {
    for (const movement of MOVEMENT_LIBRARY) {
      expect(movement.variations ?? []).not.toContain(movement.id);
    }
  });

  it('covers every exercise in the seeded program', () => {
    const ids = new Set(MOVEMENT_LIBRARY.map((m) => m.id));
    for (const day of PROGRAM) {
      for (const exercise of day.exercises) {
        expect(
          ids.has(slugify(exercise.name)),
          `no library movement for "${exercise.name}"`,
        ).toBe(true);
      }
    }
  });

  it('marks the naturally single-limb movements as unilateral', () => {
    const byId = seededMovements();
    expect(byId['bulgarian-split-squat'].unilateral).toBe(true);
    expect(byId['walking-lunges'].unilateral).toBe(true);
    expect(byId['single-arm-db-row'].unilateral).toBe(true);
  });

  it('leaves day-1 movements bilateral', () => {
    // Day 1 aria-labels are load-bearing in the browser verification script;
    // a unilateral seed there would change every one of them.
    const byId = seededMovements();
    for (const exercise of PROGRAM[0].exercises) {
      expect(byId[slugify(exercise.name)].unilateral).toBeUndefined();
    }
  });
});

describe('mintMovementId', () => {
  it('uses the plain slug when nothing collides', () => {
    expect(mintMovementId({}, 'Zercher Squat')).toBe('zercher-squat');
  });

  it('never collides with a seeded movement', () => {
    const movements = seededMovements();
    const minted = mintMovementId(movements, 'Back Squat');
    expect(minted).not.toBe('back-squat');
    expect(movements[minted]).toBeUndefined();
  });

  it('keeps counting past an existing suffix', () => {
    const movements = seededMovements();
    const first = mintMovementId(movements, 'Back Squat');
    movements[first] = {
      id: first,
      name: 'Back Squat',
      group: 'Legs',
      equipment: 'barbell',
      custom: true,
    };
    expect(mintMovementId(movements, 'Back Squat')).not.toBe(first);
  });
});

describe('substitutesFor', () => {
  const movements = seededMovements();

  it('offers declared variations first', () => {
    const result = substitutesFor(movements, 'back-squat').map((m) => m.id);
    expect(result.slice(0, 3)).toEqual([
      'front-squat-hack-squat',
      'leg-press',
      'goblet-squat',
    ]);
  });

  it('never offers the movement itself', () => {
    for (const id of ['back-squat', 'barbell-row', 'cable-fly']) {
      expect(substitutesFor(movements, id).map((m) => m.id)).not.toContain(id);
    }
  });

  it('falls back to same-group movements after the variations', () => {
    const result = substitutesFor(movements, 'cable-fly').map((m) => m.id);
    expect(result).toContain('barbell-bench-press'); // same group, not a variation
  });

  it('returns nothing for an unknown movement', () => {
    expect(substitutesFor(movements, 'no-such-movement')).toEqual([]);
  });

  it('returns no duplicates', () => {
    const result = substitutesFor(movements, 'barbell-row').map((m) => m.id);
    expect(new Set(result).size).toBe(result.length);
  });
});
