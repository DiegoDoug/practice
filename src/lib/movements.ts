import type { Equipment, Movement } from './types';

/**
 * Stable id for a movement name. Deterministic, so the same backup migrates to
 * the same ids on every device.
 */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      // Drop combining marks so "Bulgarian Split Squat" and an accented
      // variant do not produce two ids for one movement.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'movement'
  );
}

type Seed = {
  name: string;
  group: string;
  equipment: Equipment;
  unilateral?: boolean;
  variations?: string[];
};

const seed = (
  name: string,
  group: string,
  equipment: Equipment,
  extra: Omit<Seed, 'name' | 'group' | 'equipment'> = {},
): Movement => ({
  id: slugify(name),
  name,
  group,
  equipment,
  ...extra,
});

/**
 * The 32 distinct movements from the seeded six-day program, plus a curated
 * catalog of common substitutes per muscle group so every slot has somewhere
 * to swap to. `variations` lists sibling ids offered first when substituting.
 */
export const MOVEMENT_LIBRARY: readonly Movement[] = [
  // ---- Chest / push ----
  seed('Barbell Bench Press', 'Chest', 'barbell', {
    variations: [
      'flat-db-press',
      'incline-barbell-press',
      'machine-chest-press',
    ],
  }),
  seed('Incline Barbell Press', 'Chest', 'barbell', {
    variations: ['incline-db-press', 'barbell-bench-press'],
  }),
  seed('Incline DB Press', 'Chest', 'dumbbell', {
    variations: ['incline-barbell-press', 'flat-db-press'],
  }),
  seed('Flat DB Press', 'Chest', 'dumbbell', {
    variations: ['barbell-bench-press', 'machine-chest-press'],
  }),
  seed('Cable Fly', 'Chest', 'cable', {
    variations: ['pec-deck', 'db-fly'],
  }),
  seed('Machine Chest Press', 'Chest', 'machine', {
    variations: ['barbell-bench-press', 'flat-db-press'],
  }),
  seed('Pec Deck', 'Chest', 'machine', { variations: ['cable-fly', 'db-fly'] }),
  seed('DB Fly', 'Chest', 'dumbbell', {
    variations: ['cable-fly', 'pec-deck'],
  }),
  seed('Push-up', 'Chest', 'bodyweight', {
    variations: ['flat-db-press', 'machine-chest-press'],
  }),

  // ---- Shoulders ----
  seed('Seated DB Shoulder Press', 'Shoulders', 'dumbbell', {
    variations: ['overhead-barbell-press', 'machine-shoulder-press'],
  }),
  seed('Overhead Barbell Press', 'Shoulders', 'barbell', {
    variations: ['seated-db-shoulder-press', 'machine-shoulder-press'],
  }),
  seed('Machine Shoulder Press', 'Shoulders', 'machine', {
    variations: ['seated-db-shoulder-press'],
  }),
  seed('Cable Lateral Raise', 'Shoulders', 'cable', {
    variations: ['db-lateral-raise'],
  }),
  seed('DB Lateral Raise', 'Shoulders', 'dumbbell', {
    variations: ['cable-lateral-raise'],
  }),
  seed('Rear Delt Fly', 'Shoulders', 'dumbbell', {
    variations: ['face-pull', 'reverse-pec-deck'],
  }),
  seed('Face Pull', 'Shoulders', 'cable', {
    variations: ['rear-delt-fly', 'reverse-pec-deck'],
  }),
  seed('Reverse Pec Deck', 'Shoulders', 'machine', {
    variations: ['rear-delt-fly', 'face-pull'],
  }),

  // ---- Back: width ----
  seed('Wide-Grip Pull-ups', 'Width', 'bodyweight', {
    variations: ['lat-pulldown', 'weighted-pull-ups'],
  }),
  seed('Weighted Pull-ups', 'Back', 'bodyweight', {
    variations: ['wide-grip-pull-ups', 'lat-pulldown'],
  }),
  seed('Lat Pulldown', 'Width', 'machine', {
    variations: ['wide-grip-pull-ups', 'straight-arm-pulldown'],
  }),
  seed('Straight-Arm Pulldown', 'Width', 'cable', {
    variations: ['lat-pulldown'],
  }),

  // ---- Back: thickness ----
  seed('Barbell Row', 'Length', 'barbell', {
    variations: [
      'chest-supported-db-row',
      'seated-cable-row',
      'single-arm-db-row',
    ],
  }),
  seed('Chest-Supported DB Row', 'Length', 'dumbbell', {
    variations: ['barbell-row', 'seated-cable-row'],
  }),
  seed('Seated Cable Row', 'Back', 'cable', {
    variations: ['barbell-row', 'chest-supported-db-row'],
  }),
  seed('Single-Arm DB Row', 'Length', 'dumbbell', {
    unilateral: true,
    variations: ['chest-supported-db-row', 'barbell-row'],
  }),
  seed('T-Bar Row', 'Length', 'barbell', {
    variations: ['barbell-row', 'chest-supported-db-row'],
  }),

  // ---- Biceps ----
  seed('Barbell / EZ Curl', 'Biceps', 'barbell', {
    variations: ['incline-db-curl', 'cable-curl'],
  }),
  seed('Incline DB Curl', 'Biceps', 'dumbbell', {
    variations: ['spider-preacher-curl', 'barbell-ez-curl'],
  }),
  seed('Spider / Preacher Curl', 'Biceps', 'dumbbell', {
    variations: ['incline-db-curl', 'cable-curl'],
  }),
  seed('Cable Curl', 'Biceps', 'cable', {
    variations: ['barbell-ez-curl', 'incline-db-curl'],
  }),
  seed('Hammer Curl', 'Biceps', 'dumbbell', {
    variations: ['incline-db-curl', 'cable-curl'],
  }),

  // ---- Triceps ----
  seed('Overhead Cable Tricep Ext', 'Triceps', 'cable', {
    variations: ['rope-pushdown', 'skullcrusher'],
  }),
  seed('Rope Pushdown', 'Triceps', 'cable', {
    variations: ['overhead-cable-tricep-ext', 'dips-tricep-pushdown'],
  }),
  seed('Dips / Tricep Pushdown', 'Push', 'bodyweight', {
    variations: ['rope-pushdown', 'skullcrusher'],
  }),
  seed('Skullcrusher', 'Triceps', 'barbell', {
    variations: ['overhead-cable-tricep-ext', 'rope-pushdown'],
  }),

  // ---- Legs: squat pattern ----
  seed('Back Squat', 'Legs', 'barbell', {
    variations: ['front-squat-hack-squat', 'leg-press', 'goblet-squat'],
  }),
  seed('Front Squat / Hack Squat', 'Legs', 'barbell', {
    variations: ['back-squat', 'leg-press'],
  }),
  seed('Leg Press', 'Legs', 'machine', {
    variations: ['back-squat', 'front-squat-hack-squat'],
  }),
  seed('Goblet Squat', 'Legs', 'dumbbell', {
    variations: ['back-squat', 'leg-press'],
  }),
  seed('Bulgarian Split Squat', 'Legs', 'dumbbell', {
    unilateral: true,
    variations: ['walking-lunges', 'db-lunge', 'single-leg-press'],
  }),
  seed('Walking Lunges', 'Legs', 'dumbbell', {
    unilateral: true,
    variations: ['bulgarian-split-squat', 'db-lunge'],
  }),
  seed('DB Lunge', 'Legs', 'dumbbell', {
    unilateral: true,
    variations: ['walking-lunges', 'bulgarian-split-squat'],
  }),
  seed('Single-Leg Press', 'Legs', 'machine', {
    unilateral: true,
    variations: ['leg-press', 'bulgarian-split-squat'],
  }),

  // ---- Legs: hinge and isolation ----
  seed('Romanian Deadlift', 'Legs', 'barbell', {
    variations: ['stiff-leg-rdl', 'db-romanian-deadlift'],
  }),
  seed('Stiff-Leg RDL', 'Legs', 'barbell', {
    variations: ['romanian-deadlift', 'db-romanian-deadlift'],
  }),
  seed('DB Romanian Deadlift', 'Legs', 'dumbbell', {
    variations: ['romanian-deadlift', 'stiff-leg-rdl'],
  }),
  seed('Leg Curl', 'Legs', 'machine', {
    variations: ['seated-leg-curl', 'romanian-deadlift'],
  }),
  seed('Seated Leg Curl', 'Legs', 'machine', { variations: ['leg-curl'] }),
  seed('Leg Extension', 'Legs', 'machine', {
    variations: ['back-squat', 'leg-press'],
  }),
  seed('Standing Calf Raise', 'Legs', 'machine', {
    variations: ['seated-calf-raise'],
  }),
  seed('Seated Calf Raise', 'Legs', 'machine', {
    variations: ['standing-calf-raise'],
  }),
] as const;

/** Movement id used when a legacy log cannot be matched to a known movement. */
export const UNKNOWN_MOVEMENT_ID = 'unknown';

export const seededMovements = (): Record<string, Movement> =>
  Object.fromEntries(MOVEMENT_LIBRARY.map((m) => [m.id, { ...m }]));

export const resolveMovement = (
  movements: Record<string, Movement>,
  movementId: string,
): Movement | undefined => movements[movementId];

/**
 * Mint an id that does not collide with an existing movement. A user adding a
 * custom "Back Squat" must never merge into the seeded one's history.
 */
export function mintMovementId(
  movements: Record<string, Movement>,
  name: string,
): string {
  const base = slugify(name);
  if (!movements[base]) return base;
  let suffix = 2;
  while (movements[`${base}-${suffix}`]) suffix += 1;
  return `${base}-${suffix}`;
}

/** Substitute candidates for a movement: its variations first, then same group. */
export function substitutesFor(
  movements: Record<string, Movement>,
  movementId: string,
): Movement[] {
  const source = movements[movementId];
  const seen = new Set<string>([movementId]);
  const out: Movement[] = [];

  for (const id of source?.variations ?? []) {
    const candidate = movements[id];
    if (candidate && !seen.has(id)) {
      seen.add(id);
      out.push(candidate);
    }
  }
  if (source) {
    for (const candidate of Object.values(movements)) {
      if (seen.has(candidate.id)) continue;
      if (candidate.group !== source.group) continue;
      seen.add(candidate.id);
      out.push(candidate);
    }
  }
  return out;
}
