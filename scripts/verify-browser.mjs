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
    backup.schemaVersion === 4 &&
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
  ok('backup contains the logged week', Object.keys(backup.weeks).length === 1);

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
  const priorWeek = Object.keys(backup.weeks)[0];
  const d = new Date(priorWeek + 'T12:00:00');
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
