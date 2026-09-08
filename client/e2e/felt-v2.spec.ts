import { expect, test } from '@playwright/test';
import type { Box } from './table.ts';
import { boxes, markSettled, shiftSince, stubApi, waitForDock, watchLayoutShift } from './table.ts';

/* The felt rework (SVG cards and chips, see table/look-v2.css) is held to the
   same rule as the felt it replaces: one footprint through a hand and a layout
   shift of exactly zero. The desktop cases live here; the phone hero band has
   its own spec. */

const MODES = [
  { name: 'heads-up', url: '/m/mock?v2=1' },
  { name: 'six-max', url: '/m/mock?mode=six-max&v2=1' },
];

function diff(a: Record<string, Box>, b: Record<string, Box>): string[] {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

for (const mode of MODES) {
  test(`v2 ${mode.name} keeps one footprint through a hand at 1280`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubApi(page);
    await watchLayoutShift(page);
    await page.goto(mode.url);
    await expect(page.locator('.match[data-look="v2"]')).toBeVisible();
    await expect(page.locator('.pc-face').first()).toBeVisible();

    await waitForDock(page, 'turn');
    const settledAt = await markSettled(page);
    const onTurn = await boxes(page);

    await waitForDock(page, 'wait');
    expect(diff(onTurn, await boxes(page)), 'boxes that moved between your turn and waiting').toEqual([]);

    await waitForDock(page, 'over');
    await page.waitForTimeout(1400);
    expect(diff(onTurn, await boxes(page)), 'boxes that moved between your turn and hand over').toEqual([]);

    await waitForDock(page, 'turn');
    expect(diff(onTurn, await boxes(page)), 'boxes that moved over a whole hand').toEqual([]);

    expect(await shiftSince(page, settledAt)).toBe(0);
  });
}

test('v2 draws every card from the sprite and every chip from the chip symbol', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=6');
  await expect(page.locator('.deck-sprite')).toHaveCount(1);
  /* Three board cards and two hole cards face up, two face down. */
  await expect(page.locator('.board .pc-face')).toHaveCount(3);
  await expect(page.locator('.seat .pc[data-back]')).toHaveCount(2);
  const pips = await page.locator('.pc-face use').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(new Set(pips)).toEqual(new Set(['#pip-h', '#pip-c']));
  await expect(page.locator('.pot-chips .chip').first()).toBeVisible();
  /* No stack drawn beside a player's own number: chips only where they move. */
  const stacks = page.locator('.stack-chips');
  await expect(stacks).toHaveCount(2);
  for (const stack of await stacks.all()) await expect(stack).toBeHidden();
});
