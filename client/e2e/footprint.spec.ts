import { expect, test } from '@playwright/test';
import type { Box } from './table.ts';
import {
  boxes, markSettled, shiftSince, stubApi, waitForDock, watchLayoutShift,
} from './table.ts';

/* The rule the whole screen is built on: the header, the felt and the dock keep
   the same box in every state of a hand, and only their contents change. This
   is the test that would have caught the defect the rebuild started from, where
   the action bar mounted on your turn and the felt re-divided under it. */

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const MODES = [
  { name: 'heads-up', url: '/m/mock' },
  { name: 'six-max', url: '/m/mock?mode=six-max' },
];

function diff(a: Record<string, Box>, b: Record<string, Box>): string[] {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

for (const size of SIZES) {
  for (const mode of MODES) {
    test(`${mode.name} keeps one footprint through a hand at ${size.width}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await stubApi(page);
      await watchLayoutShift(page);
      await page.goto(mode.url);

      /* The mock opens on your turn in both scripts. */
      await waitForDock(page, 'turn');
      const settledAt = await markSettled(page);
      const onTurn = await boxes(page);

      await waitForDock(page, 'wait');
      const waiting = await boxes(page);
      expect(diff(onTurn, waiting), 'boxes that moved between your turn and waiting').toEqual([]);

      await waitForDock(page, 'over');
      /* Let the hand-end sequence run: the cards flip, the five are outlined,
         the pot settles. None of it may move a box. */
      await page.waitForTimeout(1200);
      const over = await boxes(page);
      expect(diff(onTurn, over), 'boxes that moved between your turn and hand over').toEqual([]);

      /* And back again for the next hand. */
      await waitForDock(page, 'turn');
      const again = await boxes(page);
      expect(diff(onTurn, again), 'boxes that moved over a whole hand').toEqual([]);

      expect(await shiftSince(page, settledAt)).toBe(0);
    });
  }
}

test('the dock is the same height in all three of its states', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock');

  const heights = new Set<number>();
  for (const state of ['turn', 'wait', 'over'] as const) {
    await waitForDock(page, state);
    const box = await page.locator('.dock').boundingBox();
    heights.add(Math.round(box!.height));
  }
  expect([...heights]).toHaveLength(1);
});

test('the header carries copy and verify before the seed exists', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=0');

  const verify = page.locator('.hand-head .seed >> text=Verify');
  await expect(verify).toBeVisible();
  await expect(verify).toHaveAttribute('aria-disabled', 'true');
  const before = await page.locator('.hand-head').boundingBox();

  /* The same header once the hand is over and the seed is published. */
  await page.goto('/m/mock?step=13');
  await expect(page.locator('.hand-head .seed >> text=Verify')).toBeVisible();
  const after = await page.locator('.hand-head').boundingBox();
  expect(Math.round(after!.height)).toBe(Math.round(before!.height));
});
