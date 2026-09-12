import type { PlannedDay } from './types';

/** Bump when the seeded plan changes so stored data can be migrated safely. */
export const PROGRAM_VERSION = 1;

/** The exact six-day program carried over from the source workout log. */
export const PROGRAM: readonly PlannedDay[] = [
  {
    id: 'day1',
    label: 'Day 1',
    name: 'Push',
    warmup: [
      '5 min light cardio (bike or row)',
      'Band pull-aparts — 2x15',
      'Arm circles + shoulder dislocates — 2x10',
      '2 ramp-up sets on your first press at 40% then 60% of working weight, 8-10 reps',
    ],
    exercises: [
      { name: 'Barbell Bench Press', group: 'Push' },
      { name: 'Incline DB Press', group: 'Push' },
      { name: 'Seated DB Shoulder Press', group: 'Push' },
      { name: 'Cable Lateral Raise', group: 'Push' },
      { name: 'Dips / Tricep Pushdown', group: 'Push' },
      { name: 'Overhead Cable Tricep Ext', group: 'Push' },
    ],
  },
  {
    id: 'day2',
    label: 'Day 2',
    name: 'Pull',
    warmup: [
      '5 min light cardio',
      'Scapular pull-ups or dead hangs — 2x10-15s',
      'Band face pulls — 2x15',
      '2 ramp-up sets on pull-ups/rows at lighter load before working sets',
    ],
    exercises: [
      { name: 'Wide-Grip Pull-ups', group: 'Width' },
      { name: 'Straight-Arm Pulldown', group: 'Width' },
      { name: 'Barbell Row', group: 'Length' },
      { name: 'Chest-Supported DB Row', group: 'Length' },
      { name: 'Incline DB Curl', group: 'Biceps' },
      { name: 'Spider / Preacher Curl', group: 'Biceps' },
    ],
  },
  {
    id: 'day3',
    label: 'Day 3',
    name: 'Legs',
    warmup: [
      '5-8 min bike or incline walk',
      'Leg swings (front/side) — 2x10 each',
      'Bodyweight squats — 2x10',
      'Hip openers / 90-90 stretch — 2x8 each side',
      '2-3 ramp-up sets on your first compound lift: empty bar → 50% → 70% of working weight',
    ],
    exercises: [
      { name: 'Back Squat', group: 'Legs' },
      { name: 'Romanian Deadlift', group: 'Legs' },
      { name: 'Leg Press', group: 'Legs' },
      { name: 'Leg Curl', group: 'Legs' },
      { name: 'Walking Lunges', group: 'Legs' },
      { name: 'Standing Calf Raise', group: 'Legs' },
    ],
  },
  {
    id: 'day4',
    label: 'Day 4',
    name: 'Legs',
    warmup: [
      '5-8 min bike or incline walk',
      'Leg swings (front/side) — 2x10 each',
      'Bodyweight squats — 2x10',
      'Hip openers / 90-90 stretch — 2x8 each side',
      '2-3 ramp-up sets on your first compound lift: empty bar → 50% → 70% of working weight',
    ],
    exercises: [
      { name: 'Front Squat / Hack Squat', group: 'Legs' },
      { name: 'Stiff-Leg RDL', group: 'Legs' },
      { name: 'Bulgarian Split Squat', group: 'Legs' },
      { name: 'Leg Extension', group: 'Legs' },
      { name: 'Seated Leg Curl', group: 'Legs' },
      { name: 'Seated Calf Raise', group: 'Legs' },
    ],
  },
  {
    id: 'day5',
    label: 'Day 5',
    name: 'Arms',
    warmup: [
      '5 min light cardio',
      'Band external rotations — 2x15',
      'Arm circles + light band pull-aparts — 2x15',
      '1 light warmup set per movement pattern (press, curl, extension) before working weight',
    ],
    exercises: [
      { name: 'Seated DB Shoulder Press', group: 'Shoulders' },
      { name: 'Cable Lateral Raise', group: 'Shoulders' },
      { name: 'Rear Delt Fly', group: 'Shoulders' },
      { name: 'Barbell / EZ Curl', group: 'Biceps' },
      { name: 'Incline DB Curl', group: 'Biceps' },
      { name: 'Overhead Cable Tricep Ext', group: 'Triceps' },
      { name: 'Rope Pushdown', group: 'Triceps' },
    ],
  },
  {
    id: 'day6',
    label: 'Day 6',
    name: 'Chest/Back',
    warmup: [
      '5 min light cardio',
      'Band pull-aparts — 2x15',
      'Push-up to downward dog — 2x8',
      '2 ramp-up sets on your first press and first row/pull movement',
    ],
    exercises: [
      { name: 'Incline Barbell Press', group: 'Chest' },
      { name: 'Weighted Pull-ups', group: 'Back' },
      { name: 'Flat DB Press', group: 'Chest' },
      { name: 'Barbell Row', group: 'Back' },
      { name: 'Cable Fly', group: 'Chest' },
      { name: 'Seated Cable Row', group: 'Back' },
    ],
  },
] as const;

export const getPlannedDay = (dayId: string): PlannedDay | undefined =>
  PROGRAM.find((day) => day.id === dayId);

export const exerciseNameKey = (dayId: string, index: number): string =>
  `${dayId}:${index}`;

/** Resolve an exercise's display name, honouring a saved template override. */
export function resolveExerciseName(
  overrides: Record<string, string>,
  dayId: string,
  index: number,
): string {
  const override = overrides[exerciseNameKey(dayId, index)];
  if (override && override.trim()) return override.trim();
  return getPlannedDay(dayId)?.exercises[index]?.name ?? '';
}

/**
 * Pick the day to open with: today's scheduled slot (Mon–Sat map to Day 1–6),
 * otherwise the first day without a completion mark, otherwise Day 1.
 */
export function pickInitialDay(
  completion: Record<string, boolean>,
  today: Date = new Date(),
): string {
  const weekday = today.getDay(); // 0 Sun … 6 Sat
  if (weekday >= 1 && weekday <= 6) {
    const scheduled = PROGRAM[weekday - 1];
    if (scheduled && !completion[scheduled.id]) return scheduled.id;
  }
  const firstIncomplete = PROGRAM.find((day) => !completion[day.id]);
  return firstIncomplete?.id ?? PROGRAM[0].id;
}
