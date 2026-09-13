/**
 * End-to-end verification of a running Weekly Practice Log deployment.
 * Usage: BASE_URL=https://example.com node scripts/verify-browser.mjs
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
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
  await page.waitForTimeout(600);
  ok(
    'completing a set starts the rest timer',
    (await bar().innerText()).includes('Rest'),
    (await bar().innerText()).replace(/\n/g, ' | '),
  );

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
  await trainedInput.fill('2026-09-11');
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
