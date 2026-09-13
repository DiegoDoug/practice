/**
 * Hand-built legacy documents, one per supported schema version.
 *
 * These are the corpus every migration test runs against. Each one is written
 * to carry at least one awkward case that a naive migration would lose:
 * completion with no logged sets, a substitution whose slot is keyed
 * differently from everything around it, an orphaned exercise key, a routine
 * reordered away from the seeded program, and half-typed draft rows.
 *
 * They are deliberately literal rather than generated. A fixture built by the
 * same helpers as the code under test can only prove the code agrees with
 * itself.
 */

const side = (weight: string, reps: string, rpe = '') => ({
  weight,
  reps,
  rpe,
});

/** v2: the original localStorage log. Index-keyed exercises, flat name map. */
export const v2Document = {
  version: 2,
  weeks: {
    '2025-06-02': {
      days: {
        day1: {
          exercises: {
            '0': { sets: [side('135', '10'), side('155', '8', '8')] },
            // A row the athlete started and never finished.
            '1': { sets: [side('50', '')] },
          },
        },
        // Marked done, nothing logged. A migration that only walks `days`
        // with entries would drop this session entirely.
        day3: { exercises: {} },
      },
      completion: { day1: true, day3: true },
    },
  },
  exerciseNames: {
    'day1:0': 'Bench Press (comp grip)',
    // Points at a slot index the day does not have.
    'day1:99': 'Ghost exercise',
  },
} as const;

/** v3: same log shape, explicit schema version, unit preference. */
export const v3Document = {
  schemaVersion: 3,
  programVersion: 1,
  unit: 'kg',
  weeks: {
    '2025-07-07': {
      days: {
        day2: {
          exercises: {
            '0': { sets: [side('0', '12'), side('0', '10')] },
            '2': { sets: [side('60', '8')] },
            // Non-numeric key: must survive as an orphan, never be discarded.
            legacy: { sets: [side('40', '15')] },
          },
        },
      },
      completion: { day2: false },
    },
    '2025-07-14': {
      days: { day2: { exercises: { '0': { sets: [side('0', '14')] } } } },
      completion: { day2: true },
    },
  },
  exerciseNames: { 'day2:0': 'Pull-ups (wide)' },
} as const;

/**
 * v4: slot-keyed logs, editable routine, movement library.
 *
 * The routine here is deliberately NOT the seeded order — day3 comes first and
 * an archived day trails it — so any migration that infers a date from routine
 * position produces something obviously wrong.
 */
export const v4Document = {
  schemaVersion: 4,
  programVersion: 1,
  unit: 'lb',
  weeks: {
    '2025-08-04': {
      days: {
        day3: {
          exercises: {
            'day3-s0': {
              movementId: 'back-squat',
              sets: [side('225', '5'), side('245', '3', '9')],
            },
            'day3-s1': {
              movementId: 'romanian-deadlift',
              unilateral: true,
              sets: [
                { ...side('70', '10'), right: side('70', '9') },
                // Half-typed: left only, right blank.
                { ...side('75', ''), right: side('', '') },
              ],
            },
          },
        },
        // Completion-only, plus a snapshot, but no logged exercises.
        day1: { exercises: {} },
        // Logs under a day the routine no longer plans.
        dayX: {
          exercises: {
            'dayX-s0': { movementId: 'unknown', sets: [side('20', '20')] },
          },
        },
      },
      completion: { day3: true, day1: true },
      routine: {
        day3: {
          label: 'Day 3',
          name: 'Legs',
          exercises: [
            {
              slotId: 'day3-s0',
              movementId: 'back-squat',
              name: 'Back Squat',
              group: 'Legs',
            },
            {
              slotId: 'day3-s1',
              movementId: 'romanian-deadlift',
              name: 'RDL',
              group: 'Legs',
              unilateral: true,
            },
          ],
        },
        day1: {
          label: 'Day 1',
          name: 'Push',
          exercises: [
            {
              slotId: 'day1-s0',
              movementId: 'barbell-bench-press',
              name: 'Barbell Bench Press',
              group: 'Push',
            },
          ],
        },
      },
      // Keyed by SLOT id, unlike every sibling collection. `day3-s0` resolves
      // through the snapshot; `dayGone-s4` belongs to no session at all.
      substitutions: { 'day3-s0': 'front-squat', 'dayGone-s4': 'hack-squat' },
    },
  },
  routine: [
    {
      dayId: 'day3',
      label: 'Day 3',
      name: 'Legs',
      warmup: ['Bike 5 min'],
      exercises: [
        { slotId: 'day3-s0', movementId: 'back-squat' },
        {
          slotId: 'day3-s1',
          movementId: 'romanian-deadlift',
          unilateral: true,
          nameOverride: 'RDL',
        },
      ],
    },
    {
      dayId: 'day1',
      label: 'Day 1',
      name: 'Push',
      warmup: [],
      exercises: [
        {
          slotId: 'day1-s0',
          movementId: 'barbell-bench-press',
          groupOverride: 'Chest',
        },
      ],
    },
    {
      dayId: 'dayOld',
      label: 'Day Old',
      name: 'Retired',
      warmup: [],
      exercises: [],
      archived: true,
    },
  ],
  movements: {
    'back-squat': {
      id: 'back-squat',
      name: 'Back Squat',
      group: 'Legs',
      equipment: 'barbell',
    },
    'front-squat': {
      id: 'front-squat',
      name: 'Front Squat',
      group: 'Legs',
      equipment: 'barbell',
    },
    'romanian-deadlift': {
      id: 'romanian-deadlift',
      name: 'Romanian Deadlift',
      group: 'Legs',
      equipment: 'barbell',
    },
    'barbell-bench-press': {
      id: 'barbell-bench-press',
      name: 'Barbell Bench Press',
      group: 'Chest',
      equipment: 'barbell',
    },
    'custom-sled-push': {
      id: 'custom-sled-push',
      name: 'Sled Push',
      group: 'Legs',
      equipment: 'other',
      custom: true,
    },
  },
} as const;
