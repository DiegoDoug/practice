/**
 * Stage 7 — supersets and circuits, verified against a running deployment.
 *
 * Exported so `verify-browser.mjs` runs it at 320px and 1280px inside its own
 * suite, and runnable on its own (`node scripts/verify-groups.mjs`) so the
 * group-transition scenario can be repeated on its own without the rest of the
 * suite. Both paths execute exactly the same assertions.
 *
 * Every probe reads a control or a persisted record and fails when it is
 * missing: there is no branch here that quietly does nothing.
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Matches DEFAULT_REST_SEC in src/lib/live-session.ts. */
const GLOBAL_REST_SEC = 90;

const A1 = 'Barbell Bench Press';
const A2 = 'Incline DB Press';

/** The live timer record, straight out of IndexedDB. */
const liveTimer = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
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

/**
 * Wait for a NEW rest countdown and return it.
 *
 * Keyed on `startedAt` changing rather than on a fixed pause, so this cannot
 * read the previous boundary's duration and call it a pass. A timer that never
 * arrives throws, which is the loud failure we want.
 */
async function waitForNewRest(page, previousStartedAt, what) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const timer = await liveTimer(page);
    const rest = timer?.rest ?? null;
    if (rest && rest.startedAt !== previousStartedAt) return rest;
    if (Date.now() > deadline) {
      throw new Error(
        `no new rest timer after ${what} (last startedAt=${previousStartedAt}, saw ${JSON.stringify(rest)})`,
      );
    }
    await page.waitForTimeout(100);
  }
}

const groupProgressText = (page) =>
  page.locator('[data-group-progress]').first().innerText();
const groupNextText = (page) =>
  page.locator('[data-group-next]').first().innerText();

/** Poll a text probe until it matches, then assert — never a bare sleep. */
async function waitForText(read, matches, what, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last = '';
  for (;;) {
    last = (await read()).replace(/\s+/g, ' ').trim();
    if (matches(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(`${what}: never matched, last was "${last}"`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Fill a set row and tick it, returning the rest the completion started. */
async function completeSet(page, exercise, index, weight, reps) {
  const before = (await liveTimer(page))?.rest?.startedAt ?? null;
  await page.getByLabel(`${exercise} set ${index} weight`).fill(weight);
  await page.getByLabel(`${exercise} set ${index} reps`).fill(reps);
  const tick = page.getByRole('button', {
    name: `Complete ${exercise} set ${index}`,
  });
  await tick.waitFor({ state: 'visible' });
  await tick.click();
  return waitForNewRest(page, before, `completing ${exercise} set ${index}`);
}

export async function runGroupScenario({ browser, width, ok, file, base }) {
  const at = `${width}px`;
  const context = await browser.newContext({
    viewport: { width, height: width === 320 ? 720 : 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  try {
    await page.goto(`${base}/?day=day1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#day-heading');

    const routine = () => page.locator('[role="dialog"]');

    // ---- 1. Create a group with keyboard-accessible controls -------------
    await page.getByRole('button', { name: 'Routine', exact: true }).click();
    await page.waitForSelector('[role="dialog"]');
    await routine()
      .getByRole('button', { name: /^Day 1/ })
      .first()
      .click();
    await routine()
      .getByRole('button', { name: 'New superset' })
      .waitFor({ state: 'visible' });

    ok(
      `${at}: the routine editor offers superset and circuit creation`,
      (await routine()
        .getByRole('button', { name: 'New superset' })
        .count()) === 1 &&
        (await routine()
          .getByRole('button', { name: 'New circuit' })
          .count()) === 1,
    );

    await routine().getByRole('button', { name: 'New superset' }).click();
    await routine()
      .getByRole('checkbox', { name: A1 })
      .waitFor({ state: 'visible' });

    // Selection by keyboard only: focus, then Space. No pointer involved.
    const first = routine().getByRole('checkbox', { name: A1 });
    const second = routine().getByRole('checkbox', { name: A2 });

    // Pick the SECOND exercise first, so the order below has to be corrected
    // by the move controls rather than falling out of the selection order.
    await second.focus();
    await page.keyboard.press('Space');
    ok(
      `${at}: an exercise can be chosen from the keyboard`,
      await second.isChecked(),
    );

    // ---- 2. Configure rounds and rest -----------------------------------
    const rounds = routine().getByLabel('Rounds', { exact: true });
    await rounds.fill('');
    await rounds.type('2');
    const restEx = routine().getByLabel('Rest between exercises (seconds)');
    await restEx.fill('');
    await restEx.type('20');
    const restRounds = routine().getByLabel('Rest between rounds (seconds)');
    await restRounds.fill('');
    await restRounds.type('150');

    // Reordering is offered as buttons, not drag alone, and they are reachable.
    const moveButtons = routine().getByRole('button', {
      name: /Move .* (earlier|later) in the group/,
    });
    ok(
      `${at}: group order has keyboard move controls`,
      (await moveButtons.count()) >= 2,
      `count=${await moveButtons.count()}`,
    );
    const moveBox = await moveButtons.first().boundingBox();
    ok(
      `${at}: group move controls are at least 44px`,
      Boolean(moveBox) && moveBox.width >= 44 && moveBox.height >= 44,
      moveBox ? `${moveBox.width}x${moveBox.height}` : 'missing',
    );

    // A group must refuse to save while it is invalid, with the reason shown.
    const save = routine().getByRole('button', { name: 'Save group' });
    await save.focus();
    await page.keyboard.press('Enter');
    await routine()
      .locator('[data-group-error]')
      .waitFor({ state: 'visible', timeout: 5000 });
    ok(
      `${at}: a one-exercise group is refused with an explanation`,
      (await routine().locator('[data-group-error]').innerText()).includes(
        'at least 2',
      ),
      await routine().locator('[data-group-error]').innerText(),
    );

    await first.focus();
    await page.keyboard.press('Space');
    ok(
      `${at}: both exercises are now selected`,
      (await first.isChecked()) && (await second.isChecked()),
    );

    // Reorder for real: selection put A2 first, and the move control must be
    // what puts A1 back at the front.
    const orderText = () => routine().locator('ol li').first().innerText();
    ok(
      `${at}: the order list follows selection before reordering`,
      (await orderText()).includes(A2),
      await orderText(),
    );
    await routine()
      .getByRole('button', { name: `Move ${A1} earlier in the group` })
      .click();
    ok(
      `${at}: a move control reorders the group from the keyboard path`,
      (
        await waitForText(
          orderText,
          (t) => t.includes(A1),
          `${at} order after move`,
        )
      ).includes(A1),
    );

    await save.focus();
    await page.keyboard.press('Enter');
    await routine()
      .locator('[data-routine-group]')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
    const savedRow = await routine()
      .locator('[data-routine-group]')
      .first()
      .innerText();
    ok(
      `${at}: the group is saved and listed on the day`,
      savedRow.includes('Superset') &&
        savedRow.includes('2 rounds') &&
        savedRow.includes(A1) &&
        savedRow.includes(A2),
      savedRow.replace(/\n/g, ' | '),
    );

    // Overlap is refused rather than silently reassigning an exercise.
    await routine().getByRole('button', { name: 'New circuit' }).click();
    await routine()
      .getByRole('checkbox', { name: A1 })
      .waitFor({ state: 'visible' });
    ok(
      `${at}: an exercise already in a group cannot be added to another`,
      await routine().getByRole('checkbox', { name: A1 }).isDisabled(),
    );
    await routine().getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ---- 3. The group renders on the workout screen ----------------------
    await page.locator('[data-group]').first().waitFor({ state: 'visible' });
    ok(
      `${at}: the workout screen shows one group block`,
      (await page.locator('[data-group]').count()) === 1,
    );
    ok(
      `${at}: the block names its kind and rounds`,
      (await page.locator('[data-group]').first().innerText()).includes(
        'Superset',
      ),
    );
    ok(
      `${at}: members are labelled in performed order`,
      (await page.locator('[data-group] [data-slot]').count()) === 2,
    );
    ok(
      `${at}: round state is given as words, not colour alone`,
      (await page.locator('[data-group] [data-round-state]').count()) === 2,
      await page
        .locator('[data-group] [data-round-state]')
        .first()
        .getAttribute('data-round-state'),
    );
    ok(
      `${at}: progress starts at round 1 with nothing done`,
      (await groupProgressText(page)).includes('Round 1 of 2'),
      await groupProgressText(page),
    );
    ok(
      `${at}: next-exercise guidance names the first member`,
      (await groupNextText(page)).includes(A1),
      await groupNextText(page),
    );

    // ---- 4/5. Execute across every boundary, checking rest each time -----
    await page.getByRole('button', { name: 'Start workout' }).click();
    await page.waitForSelector('section[aria-label="Workout in progress"]');

    const exerciseBoundary = await completeSet(page, A1, 1, '135', '8');
    ok(
      `${at}: an exercise boundary uses the between-exercises rest`,
      exerciseBoundary.durationSec === 20,
      `durationSec=${exerciseBoundary.durationSec}`,
    );
    ok(
      `${at}: mid-round progress still reads round 1`,
      (
        await waitForText(
          () => groupProgressText(page),
          (t) => t.includes('Round 1 of 2'),
          `${at} progress after first set`,
        )
      ).includes('0 done'),
      await groupProgressText(page),
    );
    ok(
      `${at}: guidance advances to the second exercise`,
      (
        await waitForText(
          () => groupNextText(page),
          (t) => t.includes(A2),
          `${at} guidance after first set`,
        )
      ).includes(A2),
    );

    const roundBoundary = await completeSet(page, A2, 1, '60', '10');
    ok(
      `${at}: a round boundary uses the between-rounds rest`,
      roundBoundary.durationSec === 150,
      `durationSec=${roundBoundary.durationSec}`,
    );
    ok(
      `${at}: round 1 is counted done and round 2 becomes current`,
      (
        await waitForText(
          () => groupProgressText(page),
          (t) => t.includes('Round 2 of 2') && t.includes('1 done'),
          `${at} progress after round 1`,
        )
      ).length > 0,
    );
    ok(
      `${at}: guidance loops back to the first exercise for round 2`,
      (
        await waitForText(
          () => groupNextText(page),
          (t) => t.includes(A1),
          `${at} guidance after round 1`,
        )
      ).includes(A1),
    );

    // Round 2 needs a second set on each member.
    await page.getByRole('button', { name: `Add set to ${A1}` }).click();
    const secondExercise = await completeSet(page, A1, 2, '135', '7');
    ok(
      `${at}: the second round's exercise boundary uses group rest again`,
      secondExercise.durationSec === 20,
      `durationSec=${secondExercise.durationSec}`,
    );

    await page.getByRole('button', { name: `Add set to ${A2}` }).click();
    const groupBoundary = await completeSet(page, A2, 2, '60', '9');
    ok(
      `${at}: the last exercise of the last round falls back to the usual rest`,
      groupBoundary.durationSec === GLOBAL_REST_SEC,
      `durationSec=${groupBoundary.durationSec}`,
    );
    ok(
      `${at}: the group reports itself complete`,
      (
        await waitForText(
          () => groupProgressText(page),
          (t) => t.includes('Superset complete') && t.includes('2 of 2'),
          `${at} group completion`,
        )
      ).length > 0,
    );

    ok(
      `${at}: exactly one rest timer is live`,
      (await page
        .locator('section[aria-label="Workout in progress"]')
        .count()) === 1,
    );

    // ---- 6. Reload: completion and progress survive ----------------------
    await page.waitForTimeout(700);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-group]').first().waitFor({ state: 'visible' });
    ok(
      `${at}: group completion survives a reload`,
      (
        await waitForText(
          () => groupProgressText(page),
          (t) => t.includes('Superset complete'),
          `${at} progress after reload`,
        )
      ).includes('2 of 2'),
    );
    ok(
      `${at}: the four completed sets survive a reload`,
      (await page.locator('[data-set-done="true"]').count()) === 4,
      `done=${await page.locator('[data-set-done="true"]').count()}`,
    );

    // ---- 7. Reopening a set re-derives progress --------------------------
    const restBeforeReopen = JSON.stringify((await liveTimer(page))?.rest);
    await page.getByRole('button', { name: `Reopen ${A2} set 2` }).click();
    ok(
      `${at}: reopening a set re-derives the group as unfinished`,
      (
        await waitForText(
          () => groupProgressText(page),
          (t) => t.includes('Round 2 of 2') && t.includes('1 done'),
          `${at} progress after reopen`,
        )
      ).length > 0,
    );
    ok(
      `${at}: reopening points guidance back at the reopened exercise`,
      (await groupNextText(page)).includes(A2),
      await groupNextText(page),
    );
    await page.waitForTimeout(400);
    ok(
      `${at}: reopening a set starts no new timer`,
      JSON.stringify((await liveTimer(page))?.rest) === restBeforeReopen,
      `${restBeforeReopen} -> ${JSON.stringify((await liveTimer(page))?.rest)}`,
    );

    // Put it back so the frozen history below is the finished workout.
    await page.getByRole('button', { name: `Complete ${A2} set 2` }).click();
    await waitForText(
      () => groupProgressText(page),
      (t) => t.includes('Superset complete'),
      `${at} progress after re-completing`,
    );

    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForTimeout(700);

    // ---- 8. A later routine edit must not rewrite the frozen session -----
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.waitForSelector('[role="dialog"]');
    await page
      .locator('[data-history-groups]')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
    const historyBefore = (
      await page.locator('[data-history-groups]').first().innerText()
    ).replace(/\s+/g, ' ');
    ok(
      `${at}: history shows the frozen group structure`,
      historyBefore.includes('Superset') && historyBefore.includes('2/2'),
      historyBefore,
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Routine', exact: true }).click();
    await page.waitForSelector('[role="dialog"]');
    await routine()
      .getByRole('button', { name: /^Day 1/ })
      .first()
      .click();
    await routine().getByRole('button', { name: /^Edit/ }).first().click();
    await routine()
      .getByRole('radio', { name: 'Circuit' })
      .waitFor({ state: 'visible' });
    await routine().getByRole('radio', { name: 'Circuit' }).check();
    const editRounds = routine().getByLabel('Rounds', { exact: true });
    await editRounds.fill('');
    await editRounds.type('5');
    await routine().getByRole('button', { name: 'Save group' }).click();
    await routine()
      .locator('[data-routine-group]')
      .first()
      .waitFor({ state: 'visible' });
    ok(
      `${at}: the routine group is now a 5-round circuit`,
      (await routine().locator('[data-routine-group]').first().innerText())
        .replace(/\s+/g, ' ')
        .includes('Circuit · 5 rounds'),
      await routine().locator('[data-routine-group]').first().innerText(),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.waitForSelector('[role="dialog"]');
    await page
      .locator('[data-history-groups]')
      .first()
      .waitFor({ state: 'visible' });
    const historyAfter = (
      await page.locator('[data-history-groups]').first().innerText()
    ).replace(/\s+/g, ' ');
    ok(
      `${at}: the finished session keeps the superset it was logged under`,
      historyAfter === historyBefore,
      `${historyBefore} -> ${historyAfter}`,
    );
    ok(
      `${at}: the routine edit did not relabel history as a circuit`,
      !historyAfter.includes('Circuit'),
      historyAfter,
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ---- 9. Backup round trip with groups --------------------------------
    await page.getByRole('button', { name: 'Backup', exact: true }).click();
    await page.waitForSelector('[role="dialog"]');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON backup' }).click(),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    const day1 = exported.routine.find((day) => day.dayId === 'day1');
    ok(
      `${at}: the backup carries the routine group`,
      Array.isArray(day1?.groups) &&
        day1.groups.length === 1 &&
        day1.groups[0].slotIds.length === 2,
      JSON.stringify(day1?.groups),
    );
    const frozen = Object.values(exported.sessions)
      .map((session) => session.snapshot?.groups ?? [])
      .find((groups) => groups.length > 0);
    ok(
      `${at}: the backup carries the frozen group`,
      Boolean(frozen) &&
        frozen[0].kind === 'superset' &&
        frozen[0].rounds === 2,
      JSON.stringify(frozen),
    );

    // A malformed group must fail the whole file and change nothing.
    const tampered = JSON.parse(JSON.stringify(exported));
    tampered.routine.find((day) => day.dayId === 'day1').groups[0].rounds = 0;
    const badPath = file(`groups-bad-${width}.json`);
    fs.writeFileSync(badPath, JSON.stringify(tampered));
    await page
      .getByLabel('Choose a JSON backup file to import')
      .setInputFiles(badPath);
    await page.waitForTimeout(600);
    ok(
      `${at}: a malformed group is refused instead of being imported`,
      (await page.getByRole('button', { name: 'Replace my data' }).count()) ===
        0,
      await page.locator('[role="dialog"]').innerText(),
    );

    const goodPath = file(`groups-good-${width}.json`);
    fs.writeFileSync(goodPath, JSON.stringify(exported));
    await page
      .getByLabel('Choose a JSON backup file to import')
      .setInputFiles(goodPath);
    await page
      .getByRole('button', { name: 'Replace my data' })
      .waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: 'Replace my data' }).click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.goto(`${base}/?day=day1`, { waitUntil: 'networkidle' });
    await page.locator('[data-group]').first().waitFor({ state: 'visible' });
    ok(
      `${at}: a restored backup still renders its group and progress`,
      (
        await waitForText(
          () => groupProgressText(page),
          (t) => t.includes('Round') || t.includes('complete'),
          `${at} progress after restore`,
        )
      ).length > 0,
      await groupProgressText(page),
    );
    ok(
      `${at}: the restored session keeps its completed sets`,
      (await page.locator('[data-set-done="true"]').count()) === 4,
      `done=${await page.locator('[data-set-done="true"]').count()}`,
    );

    // ---- 10. Responsive and axe -----------------------------------------
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    ok(
      `${at}: no horizontal overflow with a group on screen`,
      overflow <= 0,
      `overflow=${overflow}px`,
    );

    const axeGroups = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = axeGroups.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact),
    );
    ok(
      `${at}: axe finds nothing serious with a group on screen`,
      serious.length === 0,
      serious.map((v) => `${v.id}(${v.nodes.length})`).join(', '),
    );

    // The editor itself, which is where most of the new controls live.
    await page.getByRole('button', { name: 'Routine', exact: true }).click();
    await page.waitForSelector('[role="dialog"]');
    await routine()
      .getByRole('button', { name: /^Day 1/ })
      .first()
      .click();
    await routine().getByRole('button', { name: /^Edit/ }).first().click();
    await routine()
      .getByRole('button', { name: 'Save group' })
      .waitFor({ state: 'visible' });
    const editorOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    ok(
      `${at}: no horizontal overflow in the group editor`,
      editorOverflow <= 0,
      `overflow=${editorOverflow}px`,
    );
    const axeEditor = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const editorSerious = axeEditor.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact),
    );
    ok(
      `${at}: axe finds nothing serious in the group editor`,
      editorSerious.length === 0,
      editorSerious.map((v) => `${v.id}(${v.nodes.length})`).join(', '),
    );

    // Keyboard-only removal, and the exercises must survive it.
    const remove = routine().getByRole('button', {
      name: /Remove this (superset|circuit), keeping its exercises/,
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Routine', exact: true }).click();
    await routine()
      .getByRole('button', { name: /^Day 1/ })
      .first()
      .click();
    await remove.first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    ok(
      `${at}: a group can be removed from the keyboard`,
      (await routine().locator('[data-routine-group]').count()) === 0,
    );
    const stillThere = await routine().innerText();
    ok(
      `${at}: removing a group keeps its exercises on the day`,
      stillThere.includes(A1) && stillThere.includes(A2),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok(
      `${at}: removing a group loses no exercise from the day`,
      (await page.locator('[data-slot]').count()) === 6,
      `slots=${await page.locator('[data-slot]').count()}`,
    );
    // The session on screen is finished, so it renders its FROZEN structure:
    // deleting the group from the template must not rewrite what was trained.
    ok(
      `${at}: a finished session keeps its group after the template drops it`,
      (await page.locator('[data-group]').count()) === 1,
      `groups=${await page.locator('[data-group]').count()}`,
    );

    // A day with no session yet reads from the template, where the group is
    // now gone — the other half of the same invariant.
    await page.goto(`${base}/?day=day4`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#day-heading');
    ok(
      `${at}: an untouched day shows no group`,
      (await page.locator('[data-group]').count()) === 0,
    );

    ok(
      `${at}: no uncaught page errors in the group scenario`,
      errors.length === 0,
      errors.slice(0, 3).join(' | '),
    );

    await page.screenshot({
      path: file(`groups-${width}.png`),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}

// --- Standalone entry point -------------------------------------------------

const isMain =
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  const OUT =
    process.env.OUT_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'wpl-groups-'));
  const out = [];
  const ok = (n, c, d = '') => {
    out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    if (!c) process.exitCode = 1;
  };
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });
  try {
    for (const width of [320, 1280]) {
      await runGroupScenario({
        browser,
        width,
        ok,
        file: (name) => path.join(OUT, name),
        base: process.env.BASE_URL || 'http://localhost:3000',
      });
    }
  } catch (error) {
    ok('group scenario completed', false, String(error).split('\n')[0]);
    console.error('\n--- group scenario error ---\n', error);
  } finally {
    await browser.close();
    console.log(out.join('\n'));
    console.log(
      `\n${out.filter((l) => l.startsWith('PASS')).length} passed, ${
        out.filter((l) => l.startsWith('FAIL')).length
      } failed`,
    );
  }
}
