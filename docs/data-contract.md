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
operation — `refreshOpenSnapshots` — not a side effect of editing the routine.
It re-freezes group definitions along with everything else, and it refuses to
touch a `completed` session.

Group membership is by `slotId`, so a **substituted** movement stays in its
group: the group holds the slot, not the movement performed in it.

## Supersets and circuits

A group is **planning structure**, not a second copy of workout data. Exercises
and sets remain the canonical log; everything an athlete sees about a group is
derived from the completed sets on every read.

### Shape

`ExerciseGroup` lives on a `RoutineDay` and is copied into a `SessionSnapshot`
when the session freezes. Its invariants:

| Rule                                             | Why                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Members are `slotId`s                            | Stable across reorder, rename and substitution. A rendered index is not an identity.              |
| A group belongs to exactly one day or snapshot   | A group is part of a plan, and a frozen session's plan is its own.                                |
| At least two distinct exercises                  | One exercise is not a superset.                                                                   |
| Every member exists in the owning day            | A dangling member has nothing to render.                                                          |
| A slot is in at most one group                   | Membership is single-valued; an overlap is refused, never resolved by moving an exercise.         |
| Order is `slotIds`                               | So supersets and circuits are representable independently of display order.                       |
| `rounds` is a positive integer                   | Zero, negative, fractional, `Infinity` and `NaN` are all refused by one `.int().positive()` rule. |
| Rest is a whole number of seconds ≥ 0, or absent | Absent means "use my usual rest". **Zero is a value**, meaning straight into the next exercise.   |

Removing an exercise removes it from its groups, and a group left with fewer
than two members is dissolved. Neither touches a logged set. Duplicating a day
re-points its groups at the copy's own slots and mints fresh group ids, because
two days must never claim one group.

### The round mapping

One rule drives everything:

> **round _r_ (1-based) of a member slot is set index _r − 1_ of that slot.**

It needs no extra field, it survives a reload, and it re-derives the instant a
set is reopened, edited or deleted.

### Execution rules

| Question                                      | Answer                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What completes one exercise within round _r_? | Its set at index _r − 1_ is explicitly `done`.                                                                                                                                                                                                                                                                                                            |
| What completes a round?                       | Every member the round is waiting on is done — within the planned rounds that is all of them; past the planned rounds it is whoever logged a set there.                                                                                                                                                                                                   |
| Exercises with different set counts?          | The **plan** settles it. Within the planned rounds every member is waited on, so a member that ran fewer sets leaves that round unfinished — the honest reading, since the round was not completed as planned. Past the planned rounds only members that actually logged a set take part, so extra work on one exercise invents no obligation on another. |
| A set is reopened?                            | Its round is incomplete again on the next read. Nothing to invalidate — nothing was stored.                                                                                                                                                                                                                                                               |
| Manual round advancement?                     | **Not offered.** A control that could disagree with the logs would be a second source of truth. Rounds advance by ticking sets.                                                                                                                                                                                                                           |
| Skipped or partially completed rounds?        | Each round stands alone. `completedRounds` counts the rounds that are fully complete; `currentRound` is the first that is not. A partly-ticked round is neither.                                                                                                                                                                                          |
| What is "next"?                               | The first member of the current round that is waited on and not done, in `slotIds` order — exactly the members that decide whether the round closes, so guidance and completion can never disagree.                                                                                                                                                       |
| The last exercise of the last round?          | Completes the group. The group block reads "complete", and rest falls back to the global default (see below).                                                                                                                                                                                                                                             |
| Standalone exercises?                         | Unaffected. A group renders at the position of its first member; ungrouped exercises keep their places around it, and each exercise renders exactly once.                                                                                                                                                                                                 |

`totalRounds` is `max(plannedRounds, longest member set count)`: extra sets
beyond the plan are shown, and the plan is never shrunk to hide unlogged rounds.
Rounds that were planned but hold no sets stay outstanding — they are **not**
manufactured as complete.

The rule that a member is waited on while `round <= plannedRounds` is what stops
a superset reporting round 1 as finished the moment its first exercise is ticked
and the second has not been typed into yet. It is a deliberate product decision:
the logs alone cannot tell "I have not got to the incline press yet" from "I
meant to do fewer sets of it", and of the two readings only this one keeps the
round counter, the next-up guidance and the rest timer honest during the set
that is actually being performed.

### Why `groupProgress` is not written

`WorkoutSession.groupProgress` is part of the released v5 shape and is still
**validated** on restore, but this build never writes it. Derivation is
sufficient: the completed sets already answer every question above, and they
answer it correctly after an edit, a deletion, a reopen, a restore and a
migration without any reconciliation step. A stored count would have to be
invalidated by six different write paths, and the first one that forgot would
show an athlete a round total their own logs contradict.

A restored document that carries the field is checked rather than trusted:
progress for a group that does not exist in that session's snapshot, or for
more rounds than the session could possibly hold
(`max(rounds, longest member set count)`), fails the whole file.

### Rest, and which duration wins

Completing a set is still the **only** thing that starts rest. The duration is
then chosen deterministically:

| Situation                             | Rest                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| The slot is in no group               | The global default — Stage 1–6 behaviour, unchanged                             |
| The completion finished the **group** | The global default                                                              |
| The completion closed a **round**     | `restBetweenRoundsSec`, else `restBetweenExercisesSec`, else the global default |
| Otherwise (mid-round)                 | `restBetweenExercisesSec`, else the global default                              |

The group rule outranks the round rule deliberately: the last round's boundary
is not a boundary _between_ rounds, because there is no round after it.

Every Stage 1–6 timer guarantee is preserved. There is still at most one live
rest timer; it still survives navigation and reload; completing a set is still
durable even when timer storage fails; **no** timer starts from hydration,
restore, migration or ordinary editing; and reopening a set still creates no
timer. Choosing a group duration happens on the same explicit-completion edge
that already started rest, and the whole computation is guarded — a boundary
that cannot be worked out falls back to the session default rather than
skipping rest or, worse, failing the set.

### History

A past session's groups are read from `session.snapshot` alone, never from the
current routine. Editing, renaming or deleting a group in the template does not
relabel a finished workout, sets are never merged across exercises, missing
rounds are never manufactured, ungrouped exercises are never lost, and
completion is never inferred from routine position.

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
reps together. A heavy low-rep set plus a lighter high-rep set never jointly
satisfy one.

**Existing history counts.** An earlier draft of this contract required the
qualifying set to fall on or after the goal's `createdAt`; it no longer does,
because a goal is a statement about a lift, not about a date, and telling an
athlete they have not done something already in their log is simply wrong.
A goal met by earlier history reads as achieved from the moment it is created,
and `achievedRelativeToGoal` says where the qualifying set sits:

| Value     | Meaning                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `before`  | The set predates the goal, or is undated legacy history. The UI says "already achieved". |
| `after`   | The set was performed after the goal was set.                                            |
| `unknown` | The set landed on the **same day** the goal was created.                                 |

`unknown` is not a gap to be closed later. A goal carries a local **date** and
a set carries `doneAt` only when it was ticked in this app, so for a same-day
achievement nothing in the document records which came first. Resolving it
would mean manufacturing a timestamp, so the UI says the order is unknown
instead of picking one. An **undated** legacy set is `before`: it came from an
older document, and dating it after the goal would be a guess.

Achievement is **derived** from the logs, never stored. Reopening, editing or
deleting the qualifying set — or raising the target — changes the answer on the
next read, so no stale flag can survive a correction. Archiving a goal retires
it without touching the history that met it.

Goals reuse the record eligibility rules: completed **working** sets only, so a
warmup or a drop set cannot complete a goal. Loads are compared by physical
magnitude, so a target set in kilos can be met by a set logged in pounds; the
display preference is not consulted. A goal stores the logging `mode` it was
set under, and that stored mode is **authoritative wherever the goal is read**:
evaluation passes it down to the analytics layer instead of consulting the
library, so reclassifying a movement afterwards cannot make a reps-only goal
permanently unreachable. Editing a target never restamps it — only a genuine
change of exercise re-reads the mode, and a patch carrying `mode: undefined`
leaves the stored one alone rather than erasing it.

A **unilateral** movement yields left and right measurements and no combined
one, so a bilateral target for it could never be met. The goal form defaults
such a goal to a side and does not offer "Both sides": presenting an
unreachable target as a choice is a trap, not a choice.

Goal fields are validated strictly on restore — a non-negative finite target
weight, a positive whole target rep count, non-empty ids, and a `YYYY-MM-DD`
creation date. A malformed goal fails the **whole file** rather than being
dropped, because a silently dropped goal leaves the athlete believing it was
restored.

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
