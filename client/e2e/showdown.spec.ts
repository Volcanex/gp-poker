import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HERO, stubApi, waitForDock } from './table.ts';

/* "When I lost I'm not sure I saw my cards." The old table replaced the felt
   with the result screen the instant the match ended, and the server sent that
   right after the final hand, so the hand that decided the match was on screen
   for about one frame. This is the test that says it cannot happen again. */

async function heroCards(page: Page) {
  const cards = page.locator(`${HERO} .pcard`);
  const total = await cards.count();
  const faceUp = await page.locator(`${HERO} .pcard:not([data-back]):not([data-empty])`).count();
  return { total, faceUp };
}

test('your cards stay face up through a showdown you lose', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock');

  /* The script's last hand is one you lose at showdown. Mark one of your cards
     while the decision is still yours: if it is still the same element after
     the showdown, your cards were never redrawn, let alone turned over or
     taken away. */
  await page.locator('.stats', { hasText: '25 of 25' }).waitFor({ timeout: 60_000 });
  await waitForDock(page, 'turn');
  await page.locator(`${HERO} .pcard`).first().evaluate((el) => {
    (el as HTMLElement).dataset.pinned = '1';
  });

  await page.locator('.dock-result', { hasText: 'riverrat wins' }).waitFor({ timeout: 60_000 });
  await expect(page.locator(`${HERO} .pcard[data-pinned]`)).toHaveCount(1);

  for (const wait of [0, 1000, 1000, 1500]) {
    await page.waitForTimeout(wait);
    const { total, faceUp } = await heroCards(page);
    expect(total, 'your two cards are still on the table').toBe(2);
    expect(faceUp, 'and both are still face up').toBe(2);
  }

  /* And after the end message, with the result panel under the felt. */
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.match[data-ended] .felt')).toBeVisible();
  const after = await heroCards(page);
  expect(after.faceUp).toBe(2);
  await expect(page.locator(`${HERO} .pcard`).first()).toHaveAttribute('aria-label', /king|nine/);
});

test('the winning five are outlined and the rest of the board goes quiet', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=13');

  /* Step 13 is the showdown you win with a king high flush: four hearts on the
     board and one in your hand. */
  await expect(page.locator('.board .pcard[data-best]')).toHaveCount(3);
  await expect(page.locator('.board .pcard[data-dim]')).toHaveCount(2);
  await expect(page.locator(`${HERO} .pcard[data-best]`)).toHaveCount(2);
  await expect(page.locator('.award-zone .award-chip')).toBeVisible();
});

test('a six-max showdown reads the same way', async ({ page }) => {
  await stubApi(page);
  /* Hand eight: one player was all in and the two hands go to a showdown. */
  await page.goto('/m/mock?mode=six-max&step=4');
  await waitForDock(page, 'over');
  await expect(page.locator('.dock-result')).toContainText('You win 127');
  await expect(page.locator('.board .pcard[data-best]')).toHaveCount(3);
  await expect(page.locator('.award-zone .award-chip')).toBeVisible();
});

test('the award line sits below the pot figure', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=13');
  const chip = await page.locator('.award-zone .award-chip').boundingBox();
  const figure = await page.locator('.pot .v').boundingBox();
  expect(chip!.y).toBeGreaterThan(figure!.y + figure!.height);
});
