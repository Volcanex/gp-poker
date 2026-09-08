import { expect, test } from '@playwright/test';
import type { Box } from './table.ts';
import {
  boxes, markSettled, shiftSince, stubApi, waitForDock, watchLayoutShift,
} from './table.ts';

/* The analysis strip belongs to practice tables and to nothing else, and it has
   to earn its place in a column where nothing may size to its content. These
   guard both halves: that it is there when the format says practice and gone
   when it does not, and that having it changes none of the boxes around it. */

const PRACTICE = '/m/mock?practice=1';
const STRIP = '.practice-strip';

function diff(a: Record<string, Box>, b: Record<string, Box>): string[] {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

for (const size of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }]) {
  test(`the strip is on a practice table and off a rated one at ${size.width}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await stubApi(page);

    await page.goto(PRACTICE);
    await expect(page.locator(STRIP)).toBeVisible();

    await page.goto('/m/mock');
    await waitForDock(page, 'turn');
    await expect(page.locator(STRIP)).toHaveCount(0);
  });
}

test('the strip reads the hand, the outs and the equity', async ({ page }) => {
  await stubApi(page);
  /* Step 5 is the flop of the first hand: king high with four hearts, which is
     the case the whole outs presentation exists for. A player counts nine. */
  await page.goto(`${PRACTICE}&step=5`);

  const rows = page.locator(`${STRIP} .ls-row`);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('King high');
  await expect(rows.nth(1)).toContainText('9 outs');
  await expect(rows.nth(2)).toContainText(/\d+\.\d%/);
});

test('a practice table keeps one footprint through a hand', async ({ page }) => {
  await stubApi(page);
  await watchLayoutShift(page);
  await page.goto(PRACTICE);

  await waitForDock(page, 'turn');
  await expect(page.locator(`${STRIP} .ls-row`).nth(2)).toContainText(/\d+\.\d%/);
  const settledAt = await markSettled(page);
  const onTurn = await boxes(page);
  const strip = await page.locator(STRIP).boundingBox();

  await waitForDock(page, 'wait');
  expect(diff(onTurn, await boxes(page)), 'boxes that moved between your turn and waiting').toEqual([]);

  await waitForDock(page, 'over');
  await page.waitForTimeout(1200);
  expect(diff(onTurn, await boxes(page)), 'boxes that moved between your turn and hand over').toEqual([]);

  await waitForDock(page, 'turn');
  expect(diff(onTurn, await boxes(page)), 'boxes that moved over a whole hand').toEqual([]);

  /* The strip's own box too: its three readings change on every street, and
     each one sits in a slot wide enough for the longest of them. */
  const after = await page.locator(STRIP).boundingBox();
  expect(after).toEqual(strip);

  expect(await shiftSince(page, settledAt)).toBe(0);
});

test('the strip takes its own room, not the dock or the header', async ({ page }) => {
  /* Tall enough that the felt has room to give: at 720 the stacked felt is
     already at its content height and the page scrolls, so nothing could be
     taken from it either way. */
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubApi(page);

  await page.goto('/m/mock');
  await waitForDock(page, 'turn');
  const rated = await boxes(page);

  await page.goto(PRACTICE);
  await waitForDock(page, 'turn');
  const practice = await boxes(page);

  expect(practice['.dock'].height).toBe(rated['.dock'].height);
  expect(practice['.hand-head'].height).toBe(rated['.hand-head'].height);
  /* The felt gives up exactly the strip's height and nothing else. */
  const strip = await page.locator(STRIP).boundingBox();
  expect(rated['.felt'].height - practice['.felt'].height).toBe(Math.round(strip!.height));
});
