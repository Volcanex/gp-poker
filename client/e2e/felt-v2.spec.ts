import { expect, test } from '@playwright/test';
import { stubApi } from './table.ts';

/* The felt rework (SVG cards and chips, see table/look-v2.css). Its footprint
   is held to zero layout shift by hero-band.spec.ts, which walks a hand at
   390 and 1280 in both shapes; this file checks what is drawn. */

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
  /* And a stack beside the opponent's number, which is where a bet leaves
     from: chips tick between the two stacks, nothing flies. */
  await expect(page.locator('.pos[data-k="1"] .seat-chips .chip').first()).toBeVisible();
  await expect(page.locator('.chip-flights')).toHaveCount(0);
});
