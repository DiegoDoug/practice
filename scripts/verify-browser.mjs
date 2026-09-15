/**
 * End-to-end verification of a running Weekly Practice Log deployment.
 * Usage: BASE_URL=https://example.com node scripts/verify-browser.mjs
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { runGroupScenario } from './verify-groups.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT =
  process.env.OUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'wpl-verify-'));
const file = (name) => path.join(OUT, name);

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const out = [];
const ok = (n, c, d = '') => {
  out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
  if (!c) process.exitCode = 1;
};

/**
 * The app's own announcement region. Dialogs carry their own status elements,
 * so this is pinned to the app-level one: a `p.sr-only`, which the others are
 * not.
 */
const APP_LIVE_REGION = 'p.sr-only[role="status"][aria-live="polite"]';

/**
 * The Monday of the current training week, as a local date key.
 *
 * A hard-coded date drifts into the previous week as soon as the calendar
 * rolls past it, which changes how many sessions the current week holds and
 * breaks assertions that have nothing to do with dates. Monday is always on or
 * before today, so it is never a workout performed in the future.
 */
const weekStart = () => {
  const now = new Date();
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7),
  );
  const pad = (n) => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
};

/** Today as a local date key, the way the app writes `performedDate`. */
const todayKey = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});

try {
  // ---------- Mobile pass ----------
  const mobile = await browser.newContext({
    viewport: { width: 320, height: 720 },
    acceptDownloads: true,
  });
  const page = await mobile.newPage();
  const appLiveRegion = () => page.locator(APP_LIVE_REGION);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1');

  ok(
    'app renders',
    (await page.textContent('h1')).includes('Weekly Practice Log'),
  );
  ok('URL carries the day', page.url().includes('?day=day'), page.url());

  // no horizontal overflow at 320px
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  ok(
    'no horizontal overflow at 320px',
    overflow <= 0,
    `overflow=${overflow}px`,
  );

  // six day cards + six tabs
  ok(
    'six week cards',
    (await page
      .locator('section[aria-labelledby="week-heading"] ul > li')
      .count()) === 6,
  );
  ok(
    'six day tabs',
    (await page.locator('nav[aria-label="Training days"] li').count()) === 6,
  );

  // day 5 has 7 exercises (Arms)
  await page.getByRole('button', { name: 'Day 5 · Arms' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#day-heading')?.textContent?.includes('Day 5'),
  );
  ok(
    'Day 5 shows 7 exercises',
    (await page.locator('[data-exercise]').count()) === 7,
  );
  ok('warmup rendered', (await page.locator('text=Warmup').count()) > 0);

  // Log sets on Day 1
  await page.getByRole('button', { name: 'Day 1 · Push' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#day-heading')?.textContent?.includes('Day 1'),
  );
  const name = await page
    .locator(
      '[data-exercise="day1:0"] input[type="text"], [data-exercise="day1:0"] input:not([type="number"])',
    )
    .first()
    .inputValue();
  ok('seeded exercise name', name === 'Barbell Bench Press', name);

  await page.getByLabel('Barbell Bench Press set 1 weight').fill('135');
  await page.getByLabel('Barbell Bench Press set 1 reps').fill('8');
  await page.getByLabel('Barbell Bench Press set 1 RPE').fill('7');
  await page.waitForFunction(
    () => document.body.innerText.includes('Saved'),
    null,
    { timeout: 5000 },
  );
  ok('autosave reports Saved', true);

  // Enter in the final field appends a row and focuses its weight input
  await page.getByLabel('Barbell Bench Press set 1 RPE').press('Enter');
  await page.waitForTimeout(200);
  ok(
    'Enter adds a set row',
    (await page
      .locator('[data-exercise="day1:0"] input[data-set-field="weight"]')
      .count()) === 2,
  );
  const focused = await page.evaluate(() =>
    document.activeElement?.getAttribute('aria-label'),
  );
  ok(
    'focus moves to new weight field',
    focused === 'Barbell Bench Press set 2 weight',
    String(focused),
  );

  await page.getByLabel('Barbell Bench Press set 2 weight').fill('145');
  await page.getByLabel('Barbell Bench Press set 2 reps').fill('6');

  // second exercise, then progress
  await page.getByLabel('Incline DB Press set 1 weight').fill('60');
  await page.getByLabel('Incline DB Press set 1 reps').fill('10');
  await page.waitForTimeout(600);
  ok(
    'progress count updates',
    (await page.textContent('#day-heading + p')).includes('2/6'),
    await page.textContent('#day-heading + p'),
  );

  // remove a set keeps others
  await page
    .getByRole('button', { name: 'Remove Barbell Bench Press set 2' })
    .click();
  await page.waitForTimeout(200);
  ok(
    'remove set keeps row 1 data',
    (await page.getByLabel('Barbell Bench Press set 1 weight').inputValue()) ===
      '135',
  );

  // mark complete
  const dayPanel = page.locator('section[aria-labelledby="day-heading"]');
  await dayPanel.getByRole('button', { name: 'Mark complete' }).click();
  await page.waitForTimeout(400);
  ok(
    'mark complete toggles',
    (await dayPanel.getByRole('button', { name: 'Completed' }).count()) === 1,
  );

  // persistence across reload
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-exercise="day1:0"]');
  ok(
    'data survives reload',
    (await page.getByLabel('Barbell Bench Press set 1 weight').inputValue()) ===
      '135',
  );
  ok(
    'completion survives reload',
    (await page
      .locator('section[aria-labelledby="day-heading"]')
      .getByRole('button', { name: 'Completed' })
      .count()) === 1,
  );

  // history
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  const hist = await page.locator('[role="dialog"]').innerText();
  ok(
    'history lists the session',
    hist.includes('Day 1 — Push') && hist.includes('Completed'),
    hist.split('\n').slice(0, 6).join(' | '),
  );
  ok('history shows volume', /1,680|1680/.test(hist), hist);
  // Escape closes and restores focus
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(
    'Escape closes dialog',
    (await page.locator('[role="dialog"]').count()) === 0,
  );
  const restored = await page.evaluate(() =>
    document.activeElement?.textContent?.trim(),
  );
  ok('focus restored to opener', restored === 'History', String(restored));

  // CSV export
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csvPath = await csv.path();
  const csvText = fs.readFileSync(csvPath, 'utf8');
  ok(
    'CSV filename has week',
    /weekly-practice-log-\d{4}-\d{2}-\d{2}\.csv/.test(csv.suggestedFilename()),
    csv.suggestedFilename(),
  );
  ok(
    'CSV header correct',
    csvText.includes(
      'Week,Day,Day Name,Completed,Exercise,Muscle Group,Set,Weight,Reps,RPE',
    ),
  );
  ok(
    'CSV has logged rows only',
    csvText.split('\r\n').filter(Boolean).length === 3,
    String(csvText.split('\r\n').filter(Boolean).length),
  );

  // JSON backup
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON backup' }).click(),
  ]);
  const backupPath = await json.path();
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  ok(
    'backup has schemaVersion/exportedAt/programVersion',
    backup.schemaVersion === 5 &&
      !!backup.exportedAt &&
      backup.programVersion === 1,
    `schemaVersion=${backup.schemaVersion}`,
  );
  ok(
    'backup carries the routine and movement library',
    Array.isArray(backup.routine) &&
      backup.routine.length > 0 &&
      !!backup.movements &&
      Object.keys(backup.movements).length > 0,
  );
  ok(
    'backup no longer carries the retired exerciseNames map',
    !('exerciseNames' in backup),
  );
  ok(
    'backup contains the logged session',
    Object.keys(backup.sessions).length === 1,
  );

  // invalid import leaves data intact
  const badPath = file('bad.json');
  fs.writeFileSync(badPath, '{"nope": true}');
  await page.setInputFiles('input[type="file"]', badPath);
  await page.waitForTimeout(400);
  const msg = await page.locator('[role="dialog"] [role="status"]').innerText();
  ok(
    'invalid import explains failure',
    msg.toLowerCase().includes('not a backup') ||
      msg.toLowerCase().includes('not valid'),
    msg,
  );
  ok('invalid import keeps data', msg.includes('has not been changed'), msg);

  // valid destructive restore requires confirmation
  const restorePath = file('restore.json');
  // Sessions carry their own dates now; take the one this run just logged.
  const logged = Object.values(backup.sessions)[0];
  const loggedDate = logged.performedDate ?? logged.scheduledDate;
  const d = new Date(loggedDate + 'T12:00:00');
  d.setDate(d.getDate() - 7);
  const priorKey = d.toISOString().slice(0, 10);
  const restoreDoc = {
    version: 2,
    weeks: {
      [priorKey]: {
        days: {
          day1: {
            exercises: {
              0: { sets: [{ weight: '125', reps: '8', rpe: '7' }] },
            },
          },
        },
        completion: { day1: true },
      },
    },
    exerciseNames: {},
  };
  fs.writeFileSync(restorePath, JSON.stringify(restoreDoc));
  await page.setInputFiles('input[type="file"]', restorePath);
  await page.waitForSelector('text=Replace all local data?');
  ok('legacy v2 import migrates through the chain and confirms', true);
  await page.getByRole('button', { name: 'Replace my data' }).click();
  await page.waitForTimeout(600);
  const after = await page
    .locator('[role="dialog"] [role="status"]')
    .innerText();
  ok('restore confirms success', after.includes('Restored'), after);
  // A restore brings in completed sets, and must celebrate none of them: the
  // only path that celebrates is an explicit completion.
  ok(
    'restoring a backup celebrates no records',
    !after.includes('New record') &&
      !(await appLiveRegion().innerText()).includes('New record'),
    after.slice(0, 90),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // prior performance + Repeat last now that an earlier week exists
  await page.waitForSelector('[data-exercise="day1:0"]');
  const priorText = await page.locator('[data-exercise="day1:0"]').innerText();
  ok(
    'prior performance shown',
    priorText.includes('Last (') && priorText.includes('125'),
    priorText.split('\n').slice(0, 4).join(' | '),
  );
  const before = await page
    .locator('[data-exercise="day1:0"] input[data-set-field="weight"]')
    .count();
  await page
    .locator('[data-exercise="day1:0"]')
    .getByRole('button', { name: /Repeat last/ })
    .click();
  await page.waitForTimeout(300);
  const afterCount = await page
    .locator('[data-exercise="day1:0"] input[data-set-field="weight"]')
    .count();
  ok(
    'Repeat last appends one row',
    afterCount === before + 1,
    `${before} -> ${afterCount}`,
  );
  ok(
    'Repeat last copies prior set',
    (await page
      .getByLabel('Barbell Bench Press set ' + afterCount + ' weight')
      .inputValue()) === '125',
  );

  // ---------- Routine builder ----------
  // The highest-value assertion in this file: renaming a day must not rewrite
  // what an already-logged session says it was.
  await page.getByRole('button', { name: 'Routine', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  ok('routine dialog opens', true);

  // Scope every routine interaction to the dialog: the week cards and day
  // tabs behind the overlay also match these names.
  const routine = () => page.locator('[role="dialog"]');

  await routine()
    .getByRole('button', { name: /^Day 1/ })
    .first()
    .click();
  await page.waitForSelector('text=Workout name');
  const nameField = routine().getByLabel('Workout name');
  await nameField.fill('Chest, Shoulders & Triceps');
  await nameField.blur();
  await page.waitForTimeout(400);

  await routine().getByRole('button', { name: 'All days' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  ok(
    'renaming a day updates the current day screen',
    (await page.textContent('#day-heading')).includes(
      'Chest, Shoulders & Triceps',
    ),
    await page.textContent('#day-heading'),
  );

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  const historyAfterRename = await page.locator('[role="dialog"]').innerText();
  // Two halves of the snapshot invariant. The restored earlier week is frozen
  // and must keep "Push"; the current week's day is still in progress, so by
  // design it follows the rename.
  ok(
    'a past session keeps the name it was logged under',
    historyAfterRename.includes('Push'),
    historyAfterRename.split('\n').slice(0, 10).join(' | '),
  );
  ok(
    'an in-progress week follows the rename',
    historyAfterRename.includes('Chest, Shoulders & Triceps'),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Reordering must move logged data with the exercise, not with the position.
  // Write a distinctive value first so the assertion does not depend on what
  // earlier steps happened to leave behind.
  await page.getByLabel('Barbell Bench Press set 1 weight').fill('205');
  await page.getByLabel('Barbell Bench Press set 1 reps').fill('3');
  await page.waitForTimeout(700);
  const firstBefore = await page
    .locator('[data-exercise="day1:0"] input[data-set-field="weight"]')
    .first()
    .inputValue();
  ok(
    'day 1 slot 0 holds the value just entered',
    firstBefore === '205',
    firstBefore,
  );

  await page.getByRole('button', { name: 'Routine', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  await routine()
    .getByRole('button', { name: /^Day 1/ })
    .first()
    .click();
  await page.waitForSelector('text=Exercises');
  await routine()
    .getByRole('button', { name: /^Move Barbell Bench Press down$/ })
    .click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const movedName = await page
    .locator('[data-exercise="day1:1"] input:not([type="number"])')
    .first()
    .inputValue();
  const movedWeight = await page
    .locator('[data-exercise="day1:1"] input[data-set-field="weight"]')
    .first()
    .inputValue();
  ok(
    'reorder moves the exercise',
    movedName === 'Barbell Bench Press',
    movedName,
  );
  ok(
    'logged data follows the exercise, not the position',
    movedWeight === '205',
    movedWeight,
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-exercise="day1:1"]');
  ok(
    'reorder survives a reload',
    (await page
      .locator('[data-exercise="day1:1"] input:not([type="number"])')
      .first()
      .inputValue()) === 'Barbell Bench Press',
  );

  // Removing a slot with history keeps its logs in History and CSV.
  const historyRowsBefore = (
    await (async () => {
      await page.getByRole('button', { name: 'History', exact: true }).click();
      await page.waitForSelector('[role="dialog"]');
      const text = await page.locator('[role="dialog"]').innerText();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      return text;
    })()
  ).includes('Day 1');

  await page.getByRole('button', { name: 'Routine', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  await routine()
    .getByRole('button', { name: /^Day 1/ })
    .first()
    .click();
  await page.waitForSelector('text=Exercises');
  await routine()
    .getByRole('button', { name: /^Remove Barbell Bench Press from the plan/ })
    .click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  const historyAfterRemove = await page.locator('[role="dialog"]').innerText();
  ok(
    'a removed exercise keeps its session in history',
    historyRowsBefore && historyAfterRemove.includes('Day 1'),
    historyAfterRemove.split('\n').slice(0, 6).join(' | '),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Adding a day, then confirming the week grid grew.
  await page.getByRole('button', { name: 'Routine', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  await routine().getByRole('button', { name: 'Add day', exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok(
    'adding a day grows the week overview beyond six',
    (await page
      .locator('section[aria-labelledby="week-heading"] ul > li')
      .count()) === 7,
  );
  ok(
    'no horizontal overflow at 320px with seven days',
    (await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )) <= 0,
  );

  // ---------- Substitutions ----------
  // Day 2 slot 2 is Barbell Row, which Day 6 also plans. Swapping one must not
  // disturb the other's history.
  await page.getByRole('button', { name: 'Day 2 · Pull' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#day-heading')?.textContent?.includes('Day 2'),
  );
  await page.getByLabel('Barbell Row set 1 weight').fill('185');
  await page.getByLabel('Barbell Row set 1 reps').fill('8');
  await page.waitForTimeout(700);

  await page
    .locator('[data-exercise="day2:2"]')
    .getByRole('button', { name: /^Substitute/ })
    .click();
  await page.waitForSelector('[role="dialog"]');
  ok('substitute dialog opens', true);

  // Logged sets belong to the movement being replaced, so this must confirm.
  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: /^Chest-Supported DB Row/ })
    .first()
    .click();
  await page.waitForSelector("text=Clear this week's sets?");
  ok('swapping a slot with logged sets asks before clearing them', true);

  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: 'Clear and swap' })
    .click();
  await page.waitForTimeout(600);

  const day2Name = await page
    .locator('[data-exercise="day2:2"] input:not([type="number"])')
    .first()
    .inputValue();
  ok(
    'the slot now shows the substitute',
    day2Name === 'Chest-Supported DB Row',
    day2Name,
  );
  ok(
    'the swap is marked as this-week only',
    (await page.locator('[data-exercise="day2:2"]').innerText()).includes(
      'Swapped this week',
    ),
  );

  // Day 6 also plans Barbell Row; its own card must be untouched.
  await page.getByRole('button', { name: 'Day 6 · Chest/Back' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#day-heading')?.textContent?.includes('Day 6'),
  );
  const day6Name = await page
    .locator('[data-exercise="day6:3"] input:not([type="number"])')
    .first()
    .inputValue();
  ok(
    'substituting one slot leaves the same movement elsewhere alone',
    day6Name === 'Barbell Row',
    day6Name,
  );

  // Undo returns the planned exercise.
  await page.getByRole('button', { name: 'Day 2 · Pull' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#day-heading')?.textContent?.includes('Day 2'),
  );
  await page
    .locator('[data-exercise="day2:2"]')
    .getByRole('button', { name: /^Undo swap/ })
    .click();
  await page.waitForTimeout(600);
  ok(
    'undoing a swap restores the planned exercise',
    (await page
      .locator('[data-exercise="day2:2"] input:not([type="number"])')
      .first()
      .inputValue()) === 'Barbell Row',
  );

  // A custom exercise must not merge into a seeded movement of the same name.
  await page
    .locator('[data-exercise="day2:2"]')
    .getByRole('button', { name: /^Substitute/ })
    .click();
  await page.waitForSelector('[role="dialog"]');
  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: 'Add a custom exercise' })
    .click();
  await page.waitForSelector('text=Exercise name');
  await page
    .locator('[role="dialog"]')
    .getByLabel('Exercise name')
    .fill('Seal Row');
  await page
    .locator('[role="dialog"]')
    .getByLabel('Muscle group')
    .fill('Length');
  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: 'Add and use it' })
    .click();
  await page.waitForTimeout(700);
  ok(
    'a custom exercise can be created and used immediately',
    (await page
      .locator('[data-exercise="day2:2"] input:not([type="number"])')
      .first()
      .inputValue()) === 'Seal Row',
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-exercise="day2:2"]');
  ok(
    'the custom exercise and its swap survive a reload',
    (await page
      .locator('[data-exercise="day2:2"] input:not([type="number"])')
      .first()
      .inputValue()) === 'Seal Row',
  );

  // Back to day 1 so the remaining checks run against a known screen.
  await page.getByRole('button', { name: /^Day 1 · / }).click();
  await page.waitForTimeout(400);

  // ---------- Left / right tracking ----------
  // Turn on per-side tracking for Day 3's Walking Lunges, then log both sides.
  await page.getByRole('button', { name: 'Day 3 · Legs' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#day-heading')?.textContent?.includes('Day 3'),
  );
  const day3SetsBefore = await page
    .locator('[data-exercise="day3:4"] input[data-set-field="weight"]')
    .count();
  ok('a bilateral slot has one weight input per set', day3SetsBefore === 1);

  await page.getByRole('button', { name: 'Routine', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  await routine()
    .getByRole('button', { name: /^Day 3/ })
    .first()
    .click();
  await page.waitForSelector('text=Exercises');
  await routine().getByRole('checkbox').nth(4).check();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  ok(
    'the card is marked unilateral',
    (await page.locator('[data-exercise="day3:4"]').innerText()).includes(
      'Unilateral',
    ),
  );
  ok(
    'one set row now has two weight inputs',
    (await page
      .locator('[data-exercise="day3:4"] input[data-set-field="weight"]')
      .count()) === 2,
  );

  await page.getByLabel('Walking Lunges set 1 left weight').fill('50');
  await page.getByLabel('Walking Lunges set 1 left reps').fill('10');
  await page.getByLabel('Walking Lunges set 1 right weight').fill('50');
  await page.getByLabel('Walking Lunges set 1 right reps').fill('8');
  await page.waitForTimeout(800);

  ok(
    'a two-sided entry still counts as one logged set',
    (await page
      .locator('[data-exercise="day3:4"] input[data-set-field="weight"]')
      .count()) === 2,
  );

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');
  const sessionsText = await page.locator('[role="dialog"]').innerText();
  // 50x10 + 50x8 = 900, summed across both sides.
  ok(
    'history volume sums both sides',
    sessionsText.includes('900'),
    sessionsText.split('\n').slice(0, 10).join(' | '),
  );
  ok(
    'a two-sided row is one set in history',
    /1 logged set\b/.test(sessionsText),
    sessionsText.split('\n').slice(0, 10).join(' | '),
  );

  await page
    .locator('[role="dialog"]')
    .getByRole('tab', { name: 'Left vs right' })
    .click();
  await page.waitForTimeout(300);
  const sidesText = await page.locator('[role="dialog"]').innerText();
  ok(
    'the side comparison lists the movement',
    sidesText.includes('Walking Lunges'),
    sidesText.split('\n').slice(0, 8).join(' | '),
  );
  ok(
    'the side comparison reports the imbalance',
    sidesText.includes('500') &&
      sidesText.includes('400') &&
      sidesText.includes('20% left'),
    sidesText.split('\n').slice(0, 12).join(' | '),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // CSV keeps one row per set and spells out both sides.
  const [sideCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const sideCsvText = fs.readFileSync(await sideCsv.path(), 'utf8');
  const lungeRows = sideCsvText
    .split('\r\n')
    .filter((line) => line.includes('Walking Lunges'));
  ok(
    'a two-sided set is one CSV row',
    lungeRows.length === 1,
    String(lungeRows.length),
  );
  ok(
    'the CSV row carries both sides',
    lungeRows[0]?.includes('unilateral') &&
      // Date and Status now trail the side columns, so match the side block
      // rather than the end of the row.
      lungeRows[0]?.includes('unilateral,50,10,,50,8,'),
    lungeRows[0],
  );

  await page.getByRole('button', { name: /^Day 1 · / }).click();
  await page.waitForTimeout(400);

  // ---------- Live workout mode ----------
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForSelector('section[aria-label="Workout in progress"]');
  ok('starting a workout shows the session bar', true);

  const bar = () => page.locator('section[aria-label="Workout in progress"]');
  const clock = () => bar().locator('[role="timer"]').innerText();

  // The bar must not sit between #day-heading and its sibling paragraph, which
  // the progress assertion above depends on.
  ok(
    'the session bar sits outside the day section',
    (await page
      .locator(
        'section[aria-labelledby="day-heading"] section[aria-label="Workout in progress"]',
      )
      .count()) === 0,
  );

  await page.waitForTimeout(2500);
  const running = await clock();
  ok('the elapsed clock advances', running !== '0:00', running);

  await bar().getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(200);
  const frozenA = await clock();
  await page.waitForTimeout(1600);
  const frozenB = await clock();
  ok(
    'pausing freezes the clock',
    frozenA === frozenB,
    `${frozenA} then ${frozenB}`,
  );

  await bar().getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(1600);
  ok('resuming advances it again', (await clock()) !== frozenB, await clock());

  // Elapsed is derived from timestamps, so a reload keeps counting.
  const beforeReload = await clock();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('section[aria-label="Workout in progress"]');
  const afterReload = await clock();
  const toSeconds = (text) => {
    const parts = text.split(':').map(Number);
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  };
  ok(
    'the session survives a reload and keeps counting',
    toSeconds(afterReload) >= toSeconds(beforeReload),
    `${beforeReload} -> ${afterReload}`,
  );

  // Rest starts when a set row is completed, not part-way through typing.
  // Earlier checks reshape day 1, so read whatever exercise is first now
  // rather than assuming the seeded one is still there.
  const firstExercise = await page
    .locator('[data-exercise="day1:0"] input:not([type="number"])')
    .first()
    .inputValue();
  await page.getByLabel(`${firstExercise} set 1 weight`).fill('145');
  await page.getByLabel(`${firstExercise} set 1 reps`).fill('5');
  await page.getByLabel(`${firstExercise} set 1 RPE`).click();
  await page.waitForTimeout(700);

  // Typing and blurring must NOT start rest any more: completion is an
  // explicit act, and the old blur rule could not tell finishing a set from
  // correcting a typo.
  ok(
    'typing and blurring does not start rest',
    !(await bar().innerText()).includes('Rest'),
    (await bar().innerText()).replace(/\n/g, ' | '),
  );

  const completeButton = page.getByRole('button', {
    name: `Complete ${firstExercise} set 1`,
  });
  await completeButton.click();
  await page.waitForTimeout(600);
  ok(
    'ticking a set starts the rest timer',
    (await bar().innerText()).includes('Rest'),
    (await bar().innerText()).replace(/\n/g, ' | '),
  );

  const restAfterFirst = (await bar().innerText()).match(/\d+:\d\d/g)?.pop();
  await page.waitForTimeout(1600);
  const reopenButton = page.getByRole('button', {
    name: `Reopen ${firstExercise} set 1`,
  });
  ok('a completed set offers to reopen', (await reopenButton.count()) === 1);

  // A second click on an already-completed set must not restart the countdown.
  await completeButton.count();
  const restBeforeRepeat = (await bar().innerText()).match(/\d+:\d\d/g)?.pop();
  ok(
    'the rest countdown is running down, not restarting',
    restBeforeRepeat !== restAfterFirst,
    `${restAfterFirst} -> ${restBeforeRepeat}`,
  );

  // Reopening clears completion and does not start rest.
  await bar().getByRole('button', { name: 'Skip rest' }).click();
  await page.waitForTimeout(300);
  await reopenButton.click();
  await page.waitForTimeout(600);
  ok(
    'reopening a set does not start rest',
    !(await bar().innerText()).includes('Rest'),
    (await bar().innerText()).replace(/\n/g, ' | '),
  );
  ok(
    'a reopened set is offered for completion again',
    (await page
      .getByRole('button', { name: `Complete ${firstExercise} set 1` })
      .count()) === 1,
  );
  ok(
    'reopening keeps the values that were entered',
    (await page.getByLabel(`${firstExercise} set 1 weight`).inputValue()) ===
      '145',
  );

  // Editing a completed set's values away un-completes it.
  await page
    .getByRole('button', { name: `Complete ${firstExercise} set 1` })
    .click();
  await page.waitForTimeout(400);
  await bar().getByRole('button', { name: 'Skip rest' }).click();
  await page.getByLabel(`${firstExercise} set 1 reps`).fill('');
  await page.waitForTimeout(700);
  ok(
    'clearing a required field un-completes the set',
    (await page
      .getByRole('button', { name: `Complete ${firstExercise} set 1` })
      .count()) === 1,
  );
  await page.getByLabel(`${firstExercise} set 1 reps`).fill('5');
  await page.waitForTimeout(400);

  // Set kind and failure are independent controls.
  await page.getByLabel(`${firstExercise} set 1 type`).selectOption('warmup');
  await page.waitForTimeout(500);
  ok(
    'a set can be labelled a warmup',
    (await page.getByLabel(`${firstExercise} set 1 type`).inputValue()) ===
      'warmup',
  );
  await page.getByLabel(`${firstExercise} set 1 type`).selectOption('working');
  await page.waitForTimeout(400);

  // Copying a set must produce an unfinished row.
  await page
    .getByRole('button', { name: `Complete ${firstExercise} set 1` })
    .click();
  await page.waitForTimeout(400);
  await bar().getByRole('button', { name: 'Skip rest' }).click();
  const doneBefore = await page
    .locator('[data-exercise="day1:0"] [data-set-done="true"]')
    .count();
  await page
    .locator('[data-exercise="day1:0"]')
    .getByRole('button', { name: /^Add set/ })
    .click();
  await page.waitForTimeout(500);
  ok(
    'adding a set leaves the new row unfinished',
    (await page
      .locator('[data-exercise="day1:0"] [data-set-done="true"]')
      .count()) === doneBefore,
    String(doneBefore),
  );
  ok(
    'adding a set does not start rest',
    !(await bar().innerText()).includes('Rest'),
  );

  // Leave a countdown running for the extend/skip controls checked next.
  await page
    .getByRole('button', { name: `Reopen ${firstExercise} set 1` })
    .click();
  await page.waitForTimeout(300);
  await page
    .getByRole('button', { name: `Complete ${firstExercise} set 1` })
    .click();
  await page.waitForTimeout(500);

  await bar().getByRole('button', { name: '30s' }).click();
  await page.waitForTimeout(300);
  await bar().getByRole('button', { name: 'Skip rest' }).click();
  await page.waitForTimeout(300);
  ok(
    'skipping rest dismisses the countdown',
    !(await bar().innerText()).includes('Rest '),
  );

  const axeLive = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  ok(
    'axe: no serious violations with the live bar showing',
    axeLive.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
      .length === 0,
    axeLive.violations.map((v) => `${v.id}(${v.impact})`).join(', '),
  );

  await bar().getByRole('button', { name: 'Finish workout' }).click();
  await page.waitForTimeout(600);
  ok(
    'finishing hides the bar',
    (await page
      .locator('section[aria-label="Workout in progress"]')
      .count()) === 0,
  );
  ok(
    'finishing marks the day complete',
    (await page
      .locator('section[aria-labelledby="day-heading"]')
      .getByRole('button', { name: 'Completed' })
      .count()) === 1,
  );

  // ---------- Calendar and session navigation ----------
  const sessionCount = () =>
    page.evaluate(
      async () =>
        await new Promise((res) => {
          const open = indexedDB.open('keyval-store', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('keyval');
          open.onsuccess = () => {
            const r = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get('weekly-practice-log/state');
            r.onsuccess = () =>
              res(Object.keys(r.result?.sessions ?? {}).length);
            r.onerror = () => res(-1);
          };
          open.onerror = () => res(-1);
        }),
    );

  const sessionsBefore = await sessionCount();

  // Reloading a legacy ?day= link must never mint a session.
  await page.goto(`${BASE}/?day=day5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/?day=day5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok(
    'opening a legacy ?day= link creates no sessions',
    (await sessionCount()) === sessionsBefore,
    `${sessionsBefore} -> ${await sessionCount()}`,
  );

  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.waitForSelector('[role="dialog"]');
  ok(
    'calendar opens on a month grid',
    (await page.locator('[role="grid"][aria-label="Month"]').count()) === 1,
  );
  ok(
    'the grid covers whole weeks',
    (await page.locator('[role="gridcell"]').count()) % 7 === 0,
    String(await page.locator('[role="gridcell"]').count()),
  );

  const calTodayCell = page.locator('[role="gridcell"][aria-current="date"]');
  ok('today is marked in the grid', (await calTodayCell.count()) === 1);

  // Schedule an extra session of a day that already has one this week.
  await calTodayCell.click();
  await page.getByRole('button', { name: 'Add workout' }).click();
  await page.waitForTimeout(200);
  const calDayButtons = page
    .locator('[role="dialog"]')
    .getByRole('button', { name: /^Day 1 · / });
  await calDayButtons.first().click();
  await page.waitForTimeout(500);
  ok(
    'scheduling an extra workout adds one session',
    (await sessionCount()) === sessionsBefore + 1,
    `${sessionsBefore} -> ${await sessionCount()}`,
  );
  const calDayPanel = await page.textContent('[role="dialog"]');
  ok(
    'the same routine day can be repeated on one date',
    (calDayPanel.match(/Day 1/g) || []).length >= 2,
    String((calDayPanel.match(/Day 1/g) || []).length),
  );

  // Moving the plan and correcting history are separate controls.
  const planInput = page.locator('[role="dialog"] input[type="date"]').first();
  const trainedInput = page
    .locator('[role="dialog"] input[type="date"]')
    .nth(1);
  const calPlanned = await planInput.inputValue();
  await trainedInput.fill(weekStart());
  await page.waitForTimeout(400);
  ok(
    'correcting the trained date leaves the plan alone',
    (await planInput.inputValue()) === calPlanned,
    `plan ${calPlanned} -> ${await planInput.inputValue()}`,
  );

  // A blank workout, then an exercise added to it.
  await page.getByRole('button', { name: 'Add workout' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Blank workout' }).click();
  await page.waitForTimeout(500);
  ok(
    'a blank workout can be added',
    (await sessionCount()) === sessionsBefore + 2,
    String(await sessionCount()),
  );

  const blankOpen = page
    .locator('[role="dialog"] li', { hasText: 'Extra workout' })
    .getByRole('button', { name: 'Open' });
  await blankOpen.first().click();
  await page.waitForTimeout(600);
  ok(
    'opening a session navigates by session id',
    page.url().includes('?session='),
    page.url(),
  );
  ok(
    'a blank workout offers to add an exercise',
    (await page.getByRole('button', { name: 'Add an exercise' }).count()) === 1,
  );
  await page.getByRole('button', { name: 'Add an exercise' }).click();
  await page.waitForSelector('[role="dialog"]');
  await page
    .getByRole('button', { name: /Barbell Bench Press/ })
    .first()
    .click();
  await page.waitForTimeout(500);
  ok(
    'the exercise lands in the blank workout',
    (await page.textContent('section[aria-labelledby="day-heading"]')).includes(
      'Barbell Bench Press',
    ),
  );

  // Logging into an ad-hoc session writes to that session, not a routine day.
  const blankWeight = page
    .locator(
      'section[aria-labelledby="day-heading"] input[inputmode="decimal"]',
    )
    .first();
  await blankWeight.fill('60');
  await blankWeight.blur();
  await page.waitForTimeout(700);
  ok(
    'an ad-hoc session keeps its own logged value',
    (await blankWeight.inputValue()) === '60',
  );
  ok(
    'logging in an ad-hoc session creates no extra session',
    (await sessionCount()) === sessionsBefore + 2,
    String(await sessionCount()),
  );

  // Two sessions for one routine day make the legacy link ambiguous.
  await page.goto(`${BASE}/?day=day1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const ambiguous = await page.textContent('main');
  ok(
    'an ambiguous ?day= link asks which session',
    ambiguous.includes('Which session?'),
    ambiguous.slice(0, 80),
  );
  ok(
    'the ambiguous link still creates nothing',
    (await sessionCount()) === sessionsBefore + 2,
    String(await sessionCount()),
  );
  await page
    .locator('main')
    .getByRole('button', { name: /Day 1/ })
    .first()
    .click();
  await page.waitForTimeout(500);
  ok(
    'choosing a session switches to it by id',
    page.url().includes('?session='),
    page.url(),
  );

  // Calendar at 320px must not overflow, and must pass axe.
  await page.getByRole('button', { name: 'Calendar' }).click();
  await page.waitForSelector('[role="dialog"]');
  const calOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  ok(
    'no horizontal overflow with the calendar open at 320px',
    calOverflow <= 0,
    `overflow=${calOverflow}px`,
  );
  const calAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const calSerious = calAxe.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact),
  );
  ok(
    'axe: no serious violations with the calendar open',
    calSerious.length === 0,
    calSerious.map((v) => `${v.id}(${v.nodes.length})`).join(', '),
  );

  // Keyboard: Escape closes the calendar and restores focus to its opener.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok(
    'Escape closes the calendar',
    (await page.locator('[role="dialog"]').count()) === 0,
  );
  const calRestored = await page.evaluate(() =>
    document.activeElement?.textContent?.trim(),
  );
  ok(
    'focus returns to the Calendar button',
    calRestored === 'Calendar',
    String(calRestored),
  );

  // ---------- Progress and records ----------
  // By this point day 1 has several sessions, so the legacy link resolves to
  // the chooser rather than a day screen; pick one explicitly.
  await page.goto(`${BASE}/?day=day1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  if ((await page.locator('main').innerText()).includes('Which session?')) {
    await page
      .locator('main')
      .getByRole('button', { name: /Day 1|Extra workout/ })
      .first()
      .click();
    await page.waitForTimeout(600);
  }
  const prExercise = await page
    .locator('[data-exercise] input:not([type="number"])')
    .first()
    .inputValue();

  // Start from a known state: earlier sections may have left this row ticked.
  if (
    (await page
      .getByRole('button', { name: `Reopen ${prExercise} set 1` })
      .count()) > 0
  ) {
    await page
      .getByRole('button', { name: `Reopen ${prExercise} set 1` })
      .click();
    await page.waitForTimeout(400);
  }

  // A clearly record-breaking set, ticked explicitly.
  await page.getByLabel(`${prExercise} set 1 weight`).fill('315');
  await page.getByLabel(`${prExercise} set 1 reps`).fill('9');
  await page.waitForTimeout(500);
  const liveRegion = appLiveRegion;
  await page
    .getByRole('button', { name: `Complete ${prExercise} set 1` })
    .click();
  await page.waitForTimeout(800);
  ok(
    'completing a record set announces it',
    (await liveRegion().innerText()).includes('New record'),
    (await liveRegion().innerText()).slice(0, 90),
  );

  // Reopening and re-ticking the SAME set must not celebrate again.
  //
  // Asserted against the stored celebration keys rather than the live region:
  // the region keeps whatever was last announced, so it cannot distinguish
  // "nothing new was announced" from "the old text is still sitting there".
  /** The persisted document, for asserting what actually reached storage. */
  const storedState = () =>
    page.evaluate(
      async () =>
        await new Promise((res) => {
          const open = indexedDB.open('keyval-store', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('keyval');
          open.onsuccess = () => {
            const r = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get('weekly-practice-log/state');
            r.onsuccess = () => res(r.result ?? null);
            r.onerror = () => res(null);
          };
          open.onerror = () => res(null);
        }),
    );

  /** Every logged set in the saved document, across all sessions and slots. */
  const storedSets = (stored) =>
    Object.values(stored?.sessions ?? {}).flatMap((session) =>
      Object.values(session.exercises ?? {}).flatMap((log) => log.sets ?? []),
    );

  /**
   * Poll until the saved sets satisfy `predicate`, or give up loudly.
   *
   * Waiting for the condition rather than for a fixed span keeps a slow save
   * from being reported as a lost one, while still failing if the write never
   * lands — which is the thing under test.
   */
  const waitForStored = async (predicate, label) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const stored = await storedState();
      if (stored && predicate(storedSets(stored))) return true;
      await page.waitForTimeout(150);
    }
    ok(`stored state settled: ${label}`, false, 'timed out waiting for a save');
    return false;
  };

  const celebrated = () =>
    page.evaluate(
      async () =>
        await new Promise((res) => {
          const open = indexedDB.open('keyval-store', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('keyval');
          open.onsuccess = () => {
            const r = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get('weekly-practice-log/celebrated');
            r.onsuccess = () => res(r.result ?? []);
            r.onerror = () => res([]);
          };
          open.onerror = () => res([]);
        }),
    );

  const keysAfterFirst = await celebrated();
  ok(
    'the celebration is remembered',
    keysAfterFirst.length > 0,
    JSON.stringify(keysAfterFirst).slice(0, 120),
  );

  await page
    .getByRole('button', { name: `Reopen ${prExercise} set 1` })
    .click();
  await page.waitForTimeout(500);
  await page
    .getByRole('button', { name: `Complete ${prExercise} set 1` })
    .click();
  await page.waitForTimeout(900);
  const keysAfterSecond = await celebrated();
  ok(
    're-completing an unchanged set celebrates nothing new',
    JSON.stringify(keysAfterSecond) === JSON.stringify(keysAfterFirst),
    `${JSON.stringify(keysAfterFirst).slice(0, 80)} -> ${JSON.stringify(keysAfterSecond).slice(0, 80)}`,
  );

  // An improved performance on the same set must celebrate again.
  await page.getByLabel(`${prExercise} set 1 weight`).fill('325');
  await page.waitForTimeout(500);
  const beforeImprove = await celebrated();
  if (
    (await page
      .getByRole('button', { name: `Reopen ${prExercise} set 1` })
      .count()) > 0
  ) {
    await page
      .getByRole('button', { name: `Reopen ${prExercise} set 1` })
      .click();
    await page.waitForTimeout(400);
  }
  await page
    .getByRole('button', { name: `Complete ${prExercise} set 1` })
    .click();
  await page.waitForTimeout(900);
  const afterImprove = await celebrated();
  ok(
    'an improved lift celebrates again',
    afterImprove.length > beforeImprove.length,
    `${beforeImprove.length} -> ${afterImprove.length}`,
  );
  ok(
    'the improvement announces a record',
    (await liveRegion().innerText()).includes('New record'),
    (await liveRegion().innerText()).slice(0, 90),
  );

  // Two completions dispatched back to back must each be judged against the
  // other, not both against the same stale state.
  await page
    .locator('[data-exercise]')
    .first()
    .getByRole('button', { name: /^Add set/ })
    .click();
  await page.waitForTimeout(500);
  await page.getByLabel(`${prExercise} set 2 weight`).fill('405');
  await page.getByLabel(`${prExercise} set 2 reps`).fill('2');
  await page.waitForTimeout(500);
  await page
    .locator('[data-exercise]')
    .first()
    .getByRole('button', { name: /^Add set/ })
    .click();
  await page.waitForTimeout(500);
  await page.getByLabel(`${prExercise} set 3 weight`).fill('135');
  await page.getByLabel(`${prExercise} set 3 reps`).fill('2');
  // Both rows must be saved before either is ticked: the point of the check is
  // two completions racing each other, not a completion racing a pending save.
  await waitForStored(
    (sets) =>
      sets.some((set) => set.weight === '405') &&
      sets.some((set) => set.weight === '135'),
    'both rapid-completion sets',
  );

  // Both rows must be saved before either is ticked: the subject is two
  // completions racing each other, not a completion racing a pending save.
  await waitForStored(
    (sets) =>
      sets.some((set) => set.weight === '405') &&
      sets.some((set) => set.weight === '135'),
    'both rapid-completion sets',
  );

  const beforeRapid = await celebrated();

  /**
   * Invoke both real completion buttons from ONE in-page JavaScript task.
   *
   * Two concurrent Playwright pointer clicks do not test this: completing the
   * first set makes the rest-timer bar appear and shifts the layout, so the
   * second click is delivered where its button no longer is. Playwright counts
   * that as dispatched, and the run reads as a lost write — a hit-testing race
   * in the instrument, which an in-page listener confirmed by recording only
   * one click event in a failing run.
   *
   * Calling the buttons directly removes the pointer path while keeping the
   * collision real, and makes it stronger: neither handler can observe a render
   * caused by the other. The buttons are the ones a user presses, found by the
   * accessible name a screen reader would read from their sr-only label.
   */
  const dispatch = await page.evaluate(
    ([heavier, lighter]) => {
      const byName = (name) =>
        [...document.querySelectorAll('button')].find((button) =>
          (button.textContent || '').trim().endsWith(name),
        );
      const first = byName(heavier);
      const second = byName(lighter);
      if (!first || !second) {
        return { found: false, disabled: null, clicked: 0 };
      }
      if (first.disabled || second.disabled) {
        return { found: true, disabled: true, clicked: 0 };
      }
      // Heavier first, then lighter, with nothing between them: the lighter set
      // must not be judged against a state that is missing the heavier one.
      first.click();
      second.click();
      return { found: true, disabled: false, clicked: 2 };
    },
    [`Complete ${prExercise} set 2`, `Complete ${prExercise} set 3`],
  );
  ok(
    'both completion handlers are invoked in one task',
    dispatch.found && dispatch.disabled === false && dispatch.clicked === 2,
    JSON.stringify(dispatch),
  );

  // Both completions must reach storage — the assertion the whole scenario
  // exists for, unchanged in strength.
  const bothStored = (sets) =>
    sets.some((set) => set.weight === '405' && set.done === true) &&
    sets.some((set) => set.weight === '135' && set.done === true);
  await waitForStored(bothStored, 'both rapid completions');
  ok(
    'both rapid completions reach storage',
    bothStored(storedSets(await storedState())),
    JSON.stringify(
      storedSets(await storedState())
        .filter((set) => set.weight === '405' || set.weight === '135')
        .map((set) => `${set.weight}:${set.done ? 'done' : 'UNFINISHED'}`),
    ),
  );

  let afterRapid = await celebrated();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (afterRapid.length > beforeRapid.length) break;
    await page.waitForTimeout(150);
    afterRapid = await celebrated();
  }
  const rapidKeys = afterRapid.filter((key) => !beforeRapid.includes(key));
  ok(
    'the heavier of two rapid completions takes the weight record',
    rapidKeys.some((key) => key.includes(':heaviest:405')),
    JSON.stringify(rapidKeys).slice(0, 160),
  );
  ok(
    'the lighter of two rapid completions takes no weight record',
    !rapidKeys.some((key) => key.includes(':heaviest:135')),
    JSON.stringify(rapidKeys).slice(0, 160),
  );
  ok(
    'both rapid completions are recorded as done',
    (await page
      .locator('[data-exercise]')
      .first()
      .locator('[data-set-done="true"]')
      .count()) >= 2,
    String(
      await page
        .locator('[data-exercise]')
        .first()
        .locator('[data-set-done="true"]')
        .count(),
    ),
  );

  // And they survive the round trip through storage, which is what the athlete
  // actually depends on: what they ticked is still ticked when they come back.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const reopenCount = async (setNumber) =>
    await page
      .getByRole('button', { name: `Reopen ${prExercise} set ${setNumber}` })
      .count();
  ok(
    'both rapid completions survive a reload',
    (await reopenCount(2)) === 1 && (await reopenCount(3)) === 1,
    `set2=${await reopenCount(2)} set3=${await reopenCount(3)}`,
  );

  // Reloading must not celebrate anything on hydration.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  ok(
    'hydration never celebrates a record',
    !(await liveRegion().innerText()).includes('New record'),
    (await liveRegion().innerText()).slice(0, 90),
  );

  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('[role="dialog"]');
  ok(
    'progress dialog opens',
    (await page.locator('[role="dialog"]').count()) === 1,
  );
  ok(
    'it lists exercises that have been trained',
    (await page.textContent('[role="dialog"]')).includes(
      'Exercises you have trained',
    ),
  );

  const pickExercise = async () => {
    const dialogText = await page.textContent('[role="dialog"]');
    if (dialogText.includes('Change exercise')) return;
    await page
      .locator('[role="dialog"]')
      .getByRole('button', { name: new RegExp(prExercise) })
      .first()
      .click();
    await page.waitForTimeout(500);
  };
  await pickExercise();
  const progressText = await page.textContent('[role="dialog"]');
  ok('records are shown', progressText.includes('Records'), '');
  ok(
    'the heaviest completed load appears',
    progressText.includes('405'),
    progressText.slice(0, 120),
  );
  ok(
    'a best-weight-at-reps reading is offered',
    progressText.includes('Best weight at a rep count'),
  );
  ok('the session history is listed', progressText.includes('Sessions'));

  // The period selector filters, and says why undated history is withheld.
  await page.getByLabel('Period').selectOption('all');
  await page.waitForTimeout(400);
  ok(
    'all-time drops the undated-history caveat',
    !(await page.textContent('[role="dialog"]')).includes(
      'appear only under All time',
    ),
  );
  await page.getByLabel('Period').selectOption('4w');
  await page.waitForTimeout(400);
  ok(
    'a bounded period explains that undated workouts are excluded',
    (await page.textContent('[role="dialog"]')).includes(
      'appear only under All time',
    ),
  );

  // Switching the display unit must not change what was recorded.
  ok(
    'the record reads in the unit it was logged in',
    (await page.textContent('[role="dialog"]')).includes('405 lb'),
  );

  const progressAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const progressSerious = progressAxe.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact),
  );
  ok(
    'axe: no serious violations with the progress dialog open',
    progressSerious.length === 0,
    progressSerious.map((v) => `${v.id}(${v.nodes.length})`).join(', '),
  );
  const progressOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  ok(
    'no horizontal overflow with progress open at 320px',
    progressOverflow <= 0,
    `overflow=${progressOverflow}px`,
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok(
    'Escape closes the progress dialog',
    (await page.locator('[role="dialog"]').count()) === 0,
  );

  // A warmup must not hold a record — applied to the set that holds it.
  await page.getByLabel(`${prExercise} set 2 type`).selectOption('warmup');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('[role="dialog"]');
  await pickExercise();
  // Scoped to the records table: a warmup is still real work, so it rightly
  // stays in the session history and in the volume figures — it just cannot
  // hold a record.
  const recordsTable = page.locator(
    '[role="region"][aria-label="Records table"]',
  );
  const recordsText =
    (await recordsTable.count()) > 0 ? await recordsTable.innerText() : '';
  ok(
    'a warmup set holds no record',
    !recordsText.includes('405'),
    recordsText.replace(/\n/g, ' | ').slice(0, 120),
  );
  ok(
    'the warmup still appears in the session history',
    (await page.textContent('[role="dialog"]')).includes('405'),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.getByLabel(`${prExercise} set 2 type`).selectOption('working');
  await page.waitForTimeout(500);

  // ---------- Goals ----------
  // The goal reads the same completed working sets records do, so a goal set
  // now is answered by history already logged — no fresh lift required.
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.getByRole('tab', { name: 'Goals' }).click();
  await page.waitForTimeout(300);
  ok(
    'the goals tab opens with no goals yet',
    (await page.textContent('[role="dialog"]')).includes('No active goals'),
  );

  await page.getByRole('button', { name: 'New goal' }).click();
  await page.waitForTimeout(300);
  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: new RegExp(prExercise) })
    .first()
    .click();
  await page.waitForTimeout(300);
  ok(
    'the goal form names the exercise',
    (await page.textContent('[role="dialog"]')).includes('New goal'),
  );

  // 300 lb for 5. Set 1 is already logged at 315 x 9, which clears both.
  await page.getByLabel('Target weight').fill('300');
  await page.getByLabel('Target reps').fill('5');
  await page.getByRole('button', { name: 'Add goal' }).click();
  await page.waitForTimeout(600);
  const goalsText = () => page.textContent('[role="dialog"]');

  /**
   * Which ordering the app should report, derived rather than assumed.
   *
   * The qualifying set lives in the session whose TRAINED date the calendar
   * section corrected to `weekStart()`, and the goal is created today. Those
   * coincide only when the suite runs on a Monday, so hard-coding the same-day
   * wording made these assertions fail on the other six days of the week. The
   * three timing branches themselves are covered deterministically by
   * `tests/goals.test.ts`; what belongs here is that the UI says the right one.
   */
  const sameDayAchievement = weekStart() === todayKey();
  const achievedLabel = sameDayAchievement ? 'Achieved' : 'Already achieved';
  const achievedDetail = sameDayAchievement
    ? 'there is no record of which came first'
    : 'before setting the goal';
  const otherDetail = sameDayAchievement
    ? 'before setting the goal'
    : 'there is no record of which came first';

  ok(
    'a goal met by existing history reads as achieved straight away',
    (await goalsText()).includes(achievedLabel),
    `expected "${achievedLabel}" in ${(await goalsText()).slice(0, 160)}`,
  );
  ok(
    'the achievement says how it sits relative to the goal being set',
    (await goalsText()).includes(achievedDetail),
    `expected "${achievedDetail}" in ${(await goalsText()).slice(-260)}`,
  );
  ok(
    'and it does not claim the other ordering as well',
    !(await goalsText()).includes(otherDetail),
    `did not expect "${otherDetail}"`,
  );
  ok(
    'both dimensions are reported, with no blended percentage',
    (await goalsText()).includes('Best weight at 5+ reps') &&
      (await goalsText()).includes('Best reps at 300 lb+') &&
      !(await goalsText()).includes('%'),
  );

  // Raising the target must un-achieve it: achievement is derived, not stored.
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('Target weight').fill('500');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await page.waitForTimeout(600);
  ok(
    'raising the target beyond anything logged drops the achievement',
    (await goalsText()).includes('Not yet'),
    (await goalsText()).slice(0, 160),
  );

  // …and lowering it again restores it, from the same untouched history.
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('Target weight').fill('300');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await page.waitForTimeout(600);
  ok(
    'lowering it again restores the achievement',
    (await goalsText()).includes(achievedLabel) &&
      !(await goalsText()).includes('Not yet'),
    (await goalsText()).slice(0, 160),
  );

  // Accessibility and width, with the goals list on screen.
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(300);
  const goalsAxe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  const goalsSerious = goalsAxe.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact),
  );
  ok(
    'axe: no serious violations on the goals tab at 320px',
    goalsSerious.length === 0,
    goalsSerious.map((v) => `${v.id}(${v.nodes.length})`).join(', '),
  );
  const goalsOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  ok(
    'no horizontal overflow on the goals tab at 320px',
    goalsOverflow <= 0,
    `overflow=${goalsOverflow}px`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const goalsWideAxe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  ok(
    'axe: no serious violations on the goals tab at 1280px',
    goalsWideAxe.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact),
    ).length === 0,
    goalsWideAxe.violations.map((v) => v.id).join(', '),
  );

  // Archiving retires the goal without deleting it, or the history behind it.
  await page
    .getByRole('button', { name: /^Archive/ })
    .first()
    .click();
  await page.waitForTimeout(600);
  ok(
    'an archived goal leaves the active list',
    (await goalsText()).includes('No active goals'),
    (await goalsText()).slice(0, 140),
  );
  await page.getByLabel('Show archived goals').check();
  await page.waitForTimeout(400);
  ok(
    'it is still there, marked archived, with its achievement intact',
    (await goalsText()).includes('archived') &&
      (await goalsText()).includes(achievedLabel),
    (await goalsText()).slice(0, 160),
  );

  // It survives a reload, which is what "in the backup" has to mean locally.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.getByRole('tab', { name: 'Goals' }).click();
  await page.getByLabel('Show archived goals').check();
  await page.waitForTimeout(400);
  ok(
    'the goal persists across a reload',
    (await goalsText()).includes('300 lb'),
    (await goalsText()).slice(0, 140),
  );

  // The stored mode must survive an edit: it is what keeps a goal readable
  // after the movement library changes underneath it.
  const storedGoalModes = async () => {
    const stored = await storedState();
    return Object.values(stored?.goals ?? {}).map((g) => g.mode);
  };
  const modesBeforeEdit = await storedGoalModes();
  ok(
    'a goal stores the mode it was set under',
    modesBeforeEdit.length > 0 && modesBeforeEdit.every(Boolean),
    JSON.stringify(modesBeforeEdit),
  );
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('Target reps').fill('4');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await page.waitForTimeout(600);
  ok(
    'editing a target does not restamp the stored mode',
    JSON.stringify(await storedGoalModes()) === JSON.stringify(modesBeforeEdit),
    JSON.stringify(await storedGoalModes()),
  );
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('Target reps').fill('5');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await page.waitForTimeout(600);

  // A unilateral movement has no combined measurement, so a bilateral target
  // for it could never be met. The form must not offer one.
  await page.getByRole('button', { name: 'New goal' }).click();
  await page.waitForTimeout(300);
  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: /Bulgarian Split Squat/ })
    .first()
    .click();
  await page.waitForTimeout(400);
  const sideSelect = page.getByLabel('Applies to');
  ok(
    'a unilateral goal defaults to one side, not to both',
    (await sideSelect.inputValue()) === 'left',
    await sideSelect.inputValue(),
  );
  ok(
    'and an unreachable combined target is not offered at all',
    (await sideSelect.locator('option[value="bilateral"]').count()) === 0,
    String(await sideSelect.locator('option').count()),
  );
  ok(
    'the form explains why the goal is one-sided',
    (await page.textContent('[role="dialog"]')).includes(
      'trained one side at a time',
    ),
  );
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);

  // Deleting removes the goal and leaves the logged sets alone.
  await page
    .getByRole('button', { name: /^Restore/ })
    .first()
    .click();
  await page.waitForTimeout(400);
  await page.getByLabel('Show archived goals').uncheck();
  await page.waitForTimeout(300);
  await page
    .getByRole('button', { name: /^Delete/ })
    .first()
    .click();
  await page.waitForTimeout(600);
  ok(
    'deleting a goal removes it',
    (await goalsText()).includes('No active goals'),
    (await goalsText()).slice(0, 140),
  );

  // Setting the same goal again proves the history behind it is still there:
  // it can only read as achieved by re-reading the very sets that met it.
  await page.getByRole('button', { name: 'New goal' }).click();
  await page.waitForTimeout(300);
  await page
    .locator('[role="dialog"]')
    .getByRole('button', { name: new RegExp(prExercise) })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.getByLabel('Target weight').fill('300');
  await page.getByLabel('Target reps').fill('5');
  await page.getByRole('button', { name: 'Add goal' }).click();
  await page.waitForTimeout(600);
  ok(
    'the sets that met the goal are untouched by deleting it',
    (await goalsText()).includes(achievedLabel),
    (await goalsText()).slice(0, 140),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // A malformed goal fails the whole import rather than being dropped: the
  // athlete would otherwise believe a goal had been restored when it had not.
  await page.getByRole('button', { name: 'Backup' }).first().click();
  await page.waitForSelector('[role="dialog"]');
  const badGoalPath = file('bad-goal.json');
  fs.writeFileSync(
    badGoalPath,
    JSON.stringify({
      schemaVersion: 5,
      unit: 'lb',
      sessions: {},
      routine: [],
      movements: {},
      goals: {
        g1: {
          goalId: 'g1',
          movementId: 'barbell-bench-press',
          targetWeight: 100,
          targetReps: 0,
          unit: 'kg',
          createdAt: '2026-01-01',
        },
      },
    }),
  );
  await page.setInputFiles('input[type="file"]', badGoalPath);
  await page.waitForTimeout(500);
  const badGoalMsg = await page
    .locator('[role="dialog"] [role="status"]')
    .innerText();
  ok(
    'a backup carrying an impossible goal is rejected',
    badGoalMsg.toLowerCase().includes('not valid'),
    badGoalMsg,
  );
  ok(
    'and the rejection leaves local data untouched',
    badGoalMsg.includes('has not been changed'),
    badGoalMsg,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---------- Timer isolation between sessions ----------
  const liveTimer = () =>
    page.evaluate(
      async () =>
        await new Promise((res) => {
          const open = indexedDB.open('keyval-store', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('keyval');
          open.onsuccess = () => {
            const r = open.result
              .transaction('keyval', 'readonly')
              .objectStore('keyval')
              .get('weekly-practice-log/session');
            r.onsuccess = () => res(r.result ?? null);
            r.onerror = () => res(null);
          };
          open.onerror = () => res(null);
        }),
    );

  // Start a workout on the ad-hoc session, so a timer is pinned to it.
  await page.goto(`${BASE}/?day=day1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const blankSessionOpen = page
    .locator('main')
    .getByRole('button', { name: /Extra workout|Day 1/ });
  await blankSessionOpen.first().click();
  await page.waitForTimeout(500);
  if ((await page.getByRole('button', { name: 'Start workout' }).count()) > 0) {
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('section[aria-label="Workout in progress"]');
  }
  const pinned = await liveTimer();
  ok(
    'a timer is pinned to one session',
    Boolean(pinned?.sessionId),
    String(pinned?.sessionId),
  );

  // Now complete a set in a DIFFERENT session and confirm the running timer's
  // rest state is untouched — correcting an old workout must not restart the
  // countdown on the one actually in progress.
  const restBefore = JSON.stringify((await liveTimer())?.rest ?? null);
  await page.goto(`${BASE}/?day=day5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const otherExercise = await page
    .locator(
      'section[aria-labelledby="day-heading"] [data-exercise] input:not([type="number"])',
    )
    .first()
    .inputValue();
  await page.getByLabel(`${otherExercise} set 1 weight`).fill('40');
  await page.getByLabel(`${otherExercise} set 1 reps`).fill('10');
  await page.waitForTimeout(500);
  await page
    .getByRole('button', { name: `Complete ${otherExercise} set 1` })
    .click();
  await page.waitForTimeout(700);
  const stillPinned = await liveTimer();
  ok(
    'completing a set elsewhere does not restart the running timer',
    JSON.stringify(stillPinned?.rest ?? null) === restBefore,
    `${restBefore} -> ${JSON.stringify(stillPinned?.rest ?? null)}`,
  );
  ok(
    'the timer stays pinned to its own session',
    stillPinned?.sessionId === pinned?.sessionId,
    `${pinned?.sessionId} -> ${stillPinned?.sessionId}`,
  );
  ok(
    'the set completed elsewhere is still marked done',
    (await page
      .getByRole('button', { name: `Reopen ${otherExercise} set 1` })
      .count()) === 1,
  );

  await page.screenshot({ path: file('calendar.png'), fullPage: true });

  // keyboard-only reachability
  await page.keyboard.press('Tab');
  const tabbed = await page.evaluate(
    () => !!document.activeElement && document.activeElement !== document.body,
  );
  ok('keyboard focus reaches controls', tabbed);

  // axe scan
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = axe.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact),
  );
  ok(
    'axe: no serious/critical violations',
    serious.length === 0,
    serious.map((v) => `${v.id}(${v.nodes.length})`).join(', '),
  );
  if (axe.violations.length)
    out.push(
      `NOTE  minor axe violations: ${axe.violations.map((v) => v.id + ':' + v.impact).join(', ')}`,
    );

  await page.screenshot({ path: file('mobile.png'), fullPage: true });

  // ---------- Desktop pass ----------
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const dpage = await desktop.newPage();
  dpage.on('pageerror', (e) => errors.push('desktop: ' + String(e)));
  await dpage.goto(BASE, { waitUntil: 'networkidle' });
  await dpage.waitForSelector('h1');
  const mainWidth = await dpage.evaluate(
    () => document.querySelector('main')?.getBoundingClientRect().width ?? 0,
  );
  ok(
    'desktop main constrained to 880px',
    mainWidth <= 880 && mainWidth > 700,
    String(mainWidth),
  );
  await dpage.getByRole('button', { name: 'History', exact: true }).click();
  await dpage.waitForSelector('[role="dialog"]');
  const centered = await dpage.evaluate(() => {
    const r = document.querySelector('[role="dialog"]').getBoundingClientRect();
    return Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2) < 40;
  });
  ok('desktop dialog is vertically centred', centered);
  await dpage.keyboard.press('Escape');
  await dpage.screenshot({ path: file('desktop.png'), fullPage: true });

  // ---------- Supersets and circuits ----------
  // Runs in its own contexts at both widths so the scenario starts from a clean
  // store rather than inheriting whatever the passes above left behind. The
  // same function is what `node scripts/verify-groups.mjs` repeats on its own.
  for (const width of [320, 1280]) {
    await runGroupScenario({ browser, width, ok, file, base: BASE });
  }

  ok(
    'no uncaught page errors',
    errors.length === 0,
    errors.slice(0, 3).join(' | '),
  );
} catch (error) {
  ok('verification run completed', false, String(error).split('\n')[0]);
  // Full stack: the first line alone rarely names the failing locator.
  console.error('\n--- verification error ---\n', error);
} finally {
  await browser.close();
  console.log(out.join('\n'));
  console.log(
    '\n' +
      out.filter((l) => l.startsWith('PASS')).length +
      ' passed, ' +
      out.filter((l) => l.startsWith('FAIL')).length +
      ' failed',
  );
  console.log('Screenshots: ' + OUT);
}
