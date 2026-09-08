import { expect, test } from '@playwright/test';
import { HERO, stubApi, waitForDock } from './table.ts';

/* Reduced motion is a different path through the same code: cards stop dealing,
   chips stop flying, numbers stop counting and the hand-end sequence lands on
   its last step straight away. What it must never be is a different amount of
   information. */

test.use({ reducedMotion: 'reduce' });

test('a showdown says everything it says with the motion turned off', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=13');
  await waitForDock(page, 'over');

  await expect(page.locator(`${HERO} .pcard:not([data-back])`)).toHaveCount(2);
  await expect(page.locator('.board .pcard[data-best]')).toHaveCount(3);
  await expect(page.locator('.board .pcard[data-dim]')).toHaveCount(2);
  await expect(page.locator('.award-zone .award-chip')).toBeVisible();
  await expect(page.locator('.dock-result')).toContainText('You win 132');
  /* The pot figure is a NumberFlow, whose digits live in a shadow root as a
     reel: reading it as text reads every digit. The chip that just landed says
     the same thing in plain markup. */
  await expect(page.locator('.award-zone .award-chip')).toHaveText('132 to kestrel');
});

test('the dock still changes state, it just does not fade', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock');
  await waitForDock(page, 'turn');
  await expect(page.locator('.dock-acts .btn[data-primary]')).toBeVisible();
  await waitForDock(page, 'wait');
  await expect(page.locator('.dock-pre .pill')).toHaveCount(3);
});

test('the clock still counts down', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=9');
  await expect(page.locator('.turn-secs')).toBeVisible();
  const first = await page.locator('.turn-secs').innerText();
  await page.waitForTimeout(2200);
  expect(await page.locator('.turn-secs').innerText()).not.toBe(first);
});
