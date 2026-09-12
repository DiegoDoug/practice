# Weekly Practice Log

A fast, private training journal for a recurring six-day gym program. Log the
sets you actually completed, see what you lifted last time at the moment it can
inform the next set, and keep ownership of your data through CSV export and JSON
backup.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS 4, and IndexedDB.

## Local setup

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

| Script              | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm run test`      | Unit tests for week keys, volume, CSV, backup, and workout logic |
| `npm run typecheck` | `tsc --noEmit`                                                   |
| `npm run lint`      | ESLint (Next.js + React Hooks rules)                             |
| `npm run format`    | Prettier, with Tailwind class sorting                            |
| `npm run build`     | Production build (`next build`)                                  |
| `npm run verify`    | Format check → lint → typecheck → tests → build                  |

There are no environment variables and no backend. The app is fully static.

### Browser verification

`scripts/verify-browser.mjs` drives a real Chromium browser through every user
flow (logging, autosave, completion, persistence across reload, history, CSV,
backup/restore, Repeat last) at 320px and 1280px, and runs an axe accessibility
scan:

```bash
npm run build && npm start          # in one terminal
BASE_URL=http://localhost:3000 node scripts/verify-browser.mjs
```

It also runs against a deployed URL by pointing `BASE_URL` at it.

## Local-first storage

All training data lives in **your browser on this device**. Nothing is uploaded,
there is no account, and no data leaves the machine.

- Data is written to **IndexedDB** through a small adapter (`src/lib/storage.ts`)
  with a versioned schema. If IndexedDB is unavailable (private browsing, for
  example) the adapter transparently falls back to `localStorage` with identical
  public behaviour.
- Edits autosave after 400 ms of inactivity, and pending writes are flushed when
  you switch day, hide the tab, or leave the page. The status line reads
  `Saving…`, `Saved`, or `Couldn't save. Try again.`
- Data saved by the original `workout-log-v2.html` page (its `workout-state`
  localStorage key) is imported automatically on first load and migrated to the
  current schema.
- The current week is derived from your **local** Monday date, never from a UTC
  conversion, so the week never flips a day early or late depending on timezone.

### What this means in practice

Clearing site data, using a different browser, or switching devices means the
data is not there. That is what backups are for.

## Backup, restore, and export

**JSON backup** (Backup & restore) downloads every week, completion flag, and
exercise-name override, plus `schemaVersion`, `exportedAt`, `programVersion`, and
the unit preference.

**Restore is destructive and validated.** An imported file is parsed with Zod
before anything is written:

- An invalid file changes nothing and explains what was wrong.
- A valid file shows an explicit confirmation naming the file before replacing
  your data. There is no undo.
- Backups from the original v2 workout log are accepted and migrated forward.
  Migrations live in a registry keyed by `schemaVersion` (`src/lib/backup.ts`),
  so future versions can keep reading today's files.

**CSV export** writes the current week's logged sets only, as UTF-8 (with a BOM
so spreadsheets open it correctly), with fields containing quotes, commas, or
line breaks properly escaped. Columns: week, day, day name, completion state,
exercise, muscle group, set number, weight, reps, RPE.

Download filenames always carry the week or export date.

## The program

The seeded six-day plan (Push / Pull / Legs / Legs / Arms / Chest-Back), its
warmups, exercise order, and muscle-group labels come from the source workout
log and are stored as a versioned constant (`programVersion: 1`) in
`src/lib/program.ts`.

Exercise **display names** are editable; an edit applies to that slot in future
weeks too and is labelled as a template change. Reordering, adding, or removing
exercises is deliberately out of scope.

## Project structure

```text
src/
  app/          layout, page, Ocean Sunset design tokens in globals.css
  components/   weekly overview, day tabs, workout day, exercise card,
                set row, history dialog, backup dialog, accessible dialog
  lib/          program, types, week, volume, csv, backup, storage, workout,
                use-workout-store
tests/          unit tests for the pure modules
scripts/        browser verification
```

All date, CSV, volume, migration, and workout-state logic is pure and unit
tested. React components hold no business rules.

## Design

Ocean Sunset is implemented once as Tailwind theme tokens in
`src/app/globals.css` — `ocean-deep` `#2F4858`, `ocean-blue` `#33658A`,
`ocean-mist` `#86BBB8`, `sun-gold` `#F6AE2D`, `sunset-orange` `#F26419` — and
referenced by name everywhere else. Typography is Inter via `next/font/google`.

Mobile is the primary target: single column, 16px inputs (no iOS zoom focus
zoom), 44px minimum tap targets, horizontally scrollable day tabs, bottom-sheet
dialogs, and no horizontal overflow at 320px. Desktop constrains the log to
880px and centres dialogs. Transitions are 150–200 ms and are disabled under
`prefers-reduced-motion`.

## Accessibility

- Every set input has an explicit label naming exercise, set number, and field.
- Dialogs trap focus, close with Escape, and restore focus to their opener.
- Status changes (save state, completion, import results) are announced through
  `aria-live` regions.
- Completion is conveyed with an icon and text, never colour alone.
- Verified with an axe scan (no serious or critical violations) and a
  keyboard-only pass.

## Deployment

Deployed on Vercel using the native Next.js preset.

- Build command: `next build`
- Output: static; no environment variables, no database, no secrets
- Push to `main` to deploy

## Scope

Deliberately not included: accounts, authentication, cloud sync, sharing, social
features, payments, AI coaching, wearable integrations, and a program builder.
