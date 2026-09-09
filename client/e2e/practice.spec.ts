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

  const cells = page.locator(`${STRIP} .ls-cell`);
  await expect(cells).toHaveCount(3);
  await expect(cells.nth(0)).toContainText('King high');
  await expect(cells.nth(1)).toContainText('9 outs');
  await expect(cells.nth(2)).toContainText(/\d+\.\d%/);
});

/* The studs: one lit for king high, the flush stud hollow for the four hearts,
   and on the river, with the flush made, six lit and nothing hollow. Before
   the flop none are lit and the holding is named in words. */
test('the studs light up to the hand and mark the draw', async ({ page }) => {
  await stubApi(page);
  const studs = page.locator(`${STRIP} .stud`);

  await page.goto(`${PRACTICE}&step=2`);
  await expect(studs).toHaveCount(9);
  await expect(page.locator(`${STRIP} .stud[data-lit]`)).toHaveCount(0);
  await expect(page.locator(`${STRIP} .ls-name`)).toHaveText('Suited');

  await page.goto(`${PRACTICE}&step=5`);
  await expect(page.locator(`${STRIP} .ls-name`)).toContainText('King high');
  await expect(page.locator(`${STRIP} .stud[data-lit]`)).toHaveCount(1);
  await expect(studs.nth(5)).toHaveAttribute('data-aim', '');
  await expect(page.locator(`${STRIP} .ls-studs`)).toHaveAttribute('aria-label', 'High card, drawing to flush');

  await page.goto(`${PRACTICE}&step=12`);
  await expect(page.locator(`${STRIP} .ls-name`)).toContainText('Flush');
  await expect(page.locator(`${STRIP} .stud[data-lit]`)).toHaveCount(6);
  await expect(page.locator(`${STRIP} .stud[data-aim]`)).toHaveCount(0);
});

/* **On a wide v2 table the readings are a section of the band, not a bar.**
   The owner's note was that the strip should not be its own bar; the felt gets
   that row back and the readings stand on the right of the band, where the
   decision is made. */
test('the readings are a section of the band on a wide v2 table', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubApi(page);
  await page.goto(`${PRACTICE}&v2=1&step=5`);

  await page.locator('.hero-band[data-stats]').waitFor({ timeout: 20_000 });
  await expect(page.locator(STRIP)).toHaveCount(0);

  const cells = page.locator('.hb-stats .ls-cell');
  await expect(cells).toHaveCount(3);
  await expect(cells.nth(0)).toContainText('King high');
  await expect(cells.nth(1)).toContainText('9 outs');
  await expect(cells.nth(2)).toContainText(/\d+\.\d%/);

  /* The count is the glance. The cards that make the outs are the analysis
     panel's: a 248 px column cannot hold nine cards and the reading they
     belong to. */
  await expect(page.locator('.hb-stats .ls-cards')).toBeHidden();

  /* The studs are the same studs in the column: one lit for king high and the
     flush stud hollow for the four hearts, and they keep the bar's width. */
  await expect(page.locator('.hb-stats .stud')).toHaveCount(9);
  await expect(page.locator('.hb-stats .stud[data-lit]')).toHaveCount(1);
  await expect(page.locator('.hb-stats .stud').nth(5)).toHaveAttribute('data-aim', '');
  const column = (await page.locator('.hb-stats').boundingBox())!;
  const studs = (await page.locator('.hb-stats .ls-studs').boundingBox())!;
  expect(studs.x + studs.width).toBeLessThanOrEqual(column.x + column.width);
});

/* Narrower than a third column, it is still the strip: a band split three ways
   leaves the six sizes too narrow to read. */
test('a v2 table too narrow for a third column keeps the strip', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await stubApi(page);
  await page.goto(`${PRACTICE}&v2=1&step=5`);

  await expect(page.locator(STRIP)).toBeVisible();
  await expect(page.locator('.hb-stats')).toHaveCount(0);
  await expect(page.locator('.hero-band[data-stats]')).toHaveCount(0);
});

/* And the section obeys the band's own rule: the readings change every street
   inside a box that may not change size. */
test('the band keeps one footprint with the readings in it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubApi(page);
  await watchLayoutShift(page);
  await page.goto(`${PRACTICE}&v2=1`);

  const FOOTPRINT = [
    '.hand-head', '.felt', '.board', '.pot', '.pot .v', '.hero-band', '.hb-stats',
  ];
  await page.locator('.hero-band[data-state="turn"]').waitFor({ timeout: 30_000 });
  await expect(page.locator('.hb-stats .ls-cell').nth(2)).toContainText(/\d+\.\d%/);
  const settledAt = await markSettled(page);
  const onTurn = await boxes(page, FOOTPRINT);

  await page.locator('.hero-band[data-state="wait"]').waitFor({ timeout: 30_000 });
  expect(diff(onTurn, await boxes(page, FOOTPRINT)), 'boxes that moved while waiting').toEqual([]);

  await page.locator('.hero-band[data-state="over"]').waitFor({ timeout: 45_000 });
  await page.waitForTimeout(1200);
  expect(diff(onTurn, await boxes(page, FOOTPRINT)), 'boxes that moved at hand end').toEqual([]);

  expect(await shiftSince(page, settledAt)).toBe(0);
});

test('a practice table keeps one footprint through a hand', async ({ page }) => {
  await stubApi(page);
  await watchLayoutShift(page);
  await page.goto(PRACTICE);

  await waitForDock(page, 'turn');
  await expect(page.locator(`${STRIP} .ls-cell`).nth(2)).toContainText(/\d+\.\d%/);
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
