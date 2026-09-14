# Data contract

Four rules decide whether the app's numbers can be trusted: **dates,
completion, units, snapshots**. They are settled here, once, because progress,
records, goals, workload and circuits all read the same logs and must not
disagree about what those logs mean.

Two principles run through everything below.

**Never manufacture data.** If a date, an order, or a muscle mapping is not
known, it is reported as unknown. Nothing is inferred from a proxy that merely
looks plausible — routine position is not a date, and a global unit preference
is not the unit a set was lifted in.

**Derive anything recomputable.** Records, "missed", and goal achievement are
computed from logs on read, never stored. An edited or deleted set therefore
cannot leave a stale claim behind.

## Dates

Three separate facts, never collapsed into one field:

| Field                                   | Meaning                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `scheduledDate`                         | The date a session is _planned_ for. Rescheduling moves this.     |
| `performedDate`                         | The date it was _actually trained_. Correcting history sets this. |
| `startedAt` / `finishedAt` / `pausedMs` | Execution timing, in epoch ms.                                    |

A Monday plan trained on Tuesday keeps both facts. Analytics that asks "what
did I train this week" reads `performedDate`; the calendar reads
`scheduledDate`.

`performedDate` is captured from the local date when a session starts, or at
first logging if it was never explicitly started, and is **held across
midnight** — a session begun at 23:40 stays that day's workout unless the
athlete corrects it.

Migrated data has **neither** date. It keeps `legacyWeekKey` instead and shows
as an undated workout in its original week. Migration does not invent a date
from routine order: reordering a routine, or having more than seven days, would
make such a guess actively misleading.

## Status

One field: `scheduled | in_progress | completed | skipped`. Independent
booleans were rejected because `completed && skipped` has no meaning and
neither describes a session that is merely planned.

Permitted transitions:

```
scheduled  → in_progress | skipped
in_progress → completed
completed  → in_progress        (reopen)
skipped    → scheduled          (put it back on the plan)
```

`scheduled → completed` is **not** permitted: a session becomes completed by
being trained, and jumping there would leave a workout with no execution record.

`in_progress` belongs solely to the one session the live timer is attached to.
At most one session is `in_progress` at a time, enforced in the reducer. A
historical session holding partial logs is `scheduled` or `completed` — never
`in_progress`, so migration can never resurrect an abandoned workout as the
running one.

**Missed** is derived: `scheduled` with a `scheduledDate` strictly before
today. A session with no known date is not missed; it is undated.

## Completion

A set is completed only by an **explicit** transition — the athlete ticking it.
Typing a value, or blurring a field, never completes a set and never starts the
rest timer. Reopening a set removes it from every completed-set metric
immediately.

What "complete" requires depends on the movement's load mode:

| Mode         | Requires                          |
| ------------ | --------------------------------- |
| `external`   | reps, and a load ≥ 0              |
| `bodyweight` | reps; load may be absent or zero  |
| assisted     | reps, and an assistance value ≥ 0 |

A unilateral set requires both sides.

Legacy sets are classified on migration: a set carrying everything its mode
requires becomes `done`, with a deterministic `setId` and **no `doneAt`** —
migration time is not workout time, and stamping it would fabricate a
timestamp. Partial rows stay drafts.

### Set kinds and eligibility

`kind` is `working | warmup | drop`, absent reading as `working`.
`reachedFailure` is a **separate** flag, because a working set and a drop set
can both end at failure.

|                  | Volume    | Workload targets | Weight / rep records                      |
| ---------------- | --------- | ---------------- | ----------------------------------------- |
| `working`        | yes       | yes              | yes                                       |
| `warmup`         | yes       | no               | no                                        |
| `drop`           | yes       | yes              | no — a drop set's load is not a fresh max |
| `reachedFailure` | no effect | no effect        | no effect — disqualifies nothing          |

Total volume may still be reported, but it is labelled separately from
completed working volume so the two are never confused.

### Records vs PR events

_Current records_ are derived and recomputed after any edit or deletion.
A _PR event_ — the celebration — fires only when an eligible set is explicitly
completed. It never fires retroactively from a migration or an edit.

## Record celebrations

A _record_ is derived from the logs on every read. A _celebration_ is the
one-off announcement that a set just took a record, and it fires only from the
explicit-completion path. Hydration, a backup restore, an import, and an
ordinary edit all leave it silent, because none of them calls it.

Celebrations are remembered so that repeating a lift does not congratulate you
twice. That memory lives under its own storage key
(`weekly-practice-log/celebrated`), deliberately outside `WorkoutState`:

- it is interface memory, not training data, so it has no place in a backup;
- restoring someone else's backup must not tell you that you have already seen
  their personal bests;
- keeping it out means it costs no schema version.

It is best-effort. Both reads and writes swallow failure, and the whole check is
guarded at the call site, so a blocked IndexedDB (private mode, cleared site
data, a quota error) can lose a congratulation but never a logged set.

Each key names a set **and** the value it achieved
(`<setId>:<side>:<dimension>:<value>`). Two consequences follow:

- Reopening a set and ticking it again is silent — same set, same value, same
  key. Improving it changes the value on the dimensions that improved, so those
  celebrate again while the unimproved ones stay quiet. Adding weight is not a
  rep record.
- **After a restore**, keys refer to set ids from the data that was replaced.
  Restored sets carry their own ids from the backup, so old keys cannot suppress
  a genuinely new set's record. Where a restore brings back the same id _and_
  the same value — restoring your own backup — suppression is the correct
  outcome: that lift was already celebrated.

## Units

`state.unit` is a **display preference**. The unit each set was entered in is
stored on its exercise log. Switching kg/lb re-renders the numbers and never
reinterprets what was lifted.

Comparisons convert by physical magnitude before ordering. A comparison that
cannot be resolved is reported as incomparable rather than guessed.

Migration stamps legacy logs with the document's `unit` field. If a v4 user
changed that preference partway through their history, the earlier logs'
true unit is unrecoverable — the old schema simply did not record it. This is
stated rather than papered over.

## Numeric parsing

`parsePositive` is correct for reps and wrong for load, so the three quantities
have separate parsers (`src/lib/measure.ts`):

- **reps** — positive integer.
- **external load** — `≥ 0`. Zero is a real measurement meaning bodyweight
  only, not a missing value.
- **assistance** — `≥ 0`, subtractive: _less_ assistance is progress, the
  opposite direction to load, which is why it cannot share load's comparison
  rules.

All three reject drafts (`""`, `"1."`, `"abc"`), so a half-typed row never
reaches a metric.

## Snapshots

A session's snapshot freezes when it starts, or at first logging. It carries
exercise order, resolved names, modes, **canonical muscle assignments** and
group definitions.

A template edit never alters a frozen session. Updating an unstarted
`scheduled` session from its template is a separate, explicitly named
operation — not a side effect of editing the routine.

## Muscles

Canonical `MuscleId`s are separate from display labels. The seeded program's
"Length" and "Width" are useful day headings but are not muscles, so they
cannot drive workload analytics.

`primaryMuscles` and `secondaryMuscles` are reported as **separate figures**.
Secondary involvement is not folded into primary counts by a fractional
weight, which would look like a precise measurement while being an arbitrary
choice. A movement with no mapping is listed as unmapped rather than silently
counted as zero.

## Goals

A goal is satisfied only by a **single set** meeting target weight and target
reps together, performed **on or after** the goal's `createdAt`. Pre-existing
history does not retroactively complete a goal, and a heavy low-rep set plus a
lighter high-rep set never jointly satisfy one.

Progress is reported on both dimensions — best weight at the target reps, best
reps at the target weight — rather than one percentage that would hide which
half is short.

## Schema versioning

The **complete** v5 shape, including goals, targets, notes, set ids, muscle ids
and groups, is declared before release. A version that ships and then grows
fields is a version an older build can silently strip on restore, so any field
added after release bumps the version instead.

Backup validation is strict on v5's own fields. A document declaring a version
this build does not know is refused, and a failed parse leaves stored data
untouched — the `error`-vs-`empty` distinction in `storage.ts` exists exactly
so an unreadable document is never autosaved over.

## Legacy field inventory

Every field in a v2/v3/v4 document, and where it goes:

| Legacy field                               | Destination                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `weeks[k]`                                 | Sessions carrying `legacyWeekKey = k`.                                                                                                                 |
| `weeks[k].days[d].exercises[slot]`         | `session.exercises[slot]`, unchanged.                                                                                                                  |
| `weeks[k].days[d].exercises[slot].sets`    | Same sets, plus `setId` and `done`. No `doneAt`.                                                                                                       |
| `weeks[k].completion[d]`                   | `status: 'completed'`. Creates a session if the day logged nothing.                                                                                    |
| `weeks[k].routine[d]`                      | `session.snapshot`, extended with load mode and muscles.                                                                                               |
| `weeks[k].substitutions[slot]`             | Resolved to the owning day via snapshot, then template → that session. Unownable entries go to `unresolvedSubstitutions`. **Never creates a session.** |
| `exerciseNames['day:index']` (v2/v3)       | `slot.nameOverride`, movement id left alone.                                                                                                           |
| Out-of-range / non-numeric exercise keys   | Orphan slots, retained and still exported.                                                                                                             |
| `unit`                                     | Display preference, and stamped onto migrated logs.                                                                                                    |
| `programVersion`, `routine`, `movements`   | Carried across unchanged.                                                                                                                              |
| `weekly-practice-log/session` (live timer) | Re-pointed at the migrated session only if genuinely current; otherwise discarded.                                                                     |
