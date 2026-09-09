import { expect, test } from '@playwright/test';
import { ME, boxes, markSettled, shiftSince, stubApi, waitForDock, watchLayoutShift } from './table.ts';

/* Leaving a game.

   The control is in the header row and never in reach of the action buttons,
   so the two cases worth driving are that it is there without moving the
   table, and that a ranked table asks before it takes the match away. The
   mock is rated unless the URL says otherwise, which is what lets both be
   staged with no server at all.

   The mock has nothing to resign to, so confirming leaves the page: what is
   under test here is the control and the warning, and the server's half is
   in `server/test/leave.test.ts`. */

const LEAVE = 'button:has-text("Leave game")';

test('the leave control sits in the header and moves nothing', async ({ page }) => {
  await stubApi(page);
  await watchLayoutShift(page);
  await page.goto('/m/mock');

  await waitForDock(page, 'turn');
  const settledAt = await markSettled(page);
  const before = await boxes(page);

  const leave = page.locator(LEAVE);
  await expect(leave).toBeVisible();
  // In the header's row of controls, beside the two that were already there.
  await expect(page.locator('.head-acts > button, .head-acts > a, .head-acts > span.btn')).toHaveCount(3);

  await leave.click();
  const dialog = page.locator('dialog[aria-label="Leave this match"]');
  await expect(dialog).toBeVisible();

  // A dialog is in the top layer, and the table underneath must not have
  // noticed it: same boxes, no shift.
  expect(await boxes(page)).toEqual(before);
  expect(await shiftSince(page, settledAt)).toBe(0);
});

test('a ranked table says what leaving costs and takes no for an answer', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock');
  await waitForDock(page, 'turn');

  await page.locator(LEAVE).click();
  const dialog = page.locator('dialog[aria-label="Leave this match"]');
  await expect(dialog).toBeVisible();

  // Both halves of the cost: this match, and the next one.
  await expect(dialog).toContainText('forfeited on the spot and rated as a loss');
  await expect(dialog).toContainText('counts as a walkout');
  await expect(dialog).toContainText('5 minutes');

  await expect(dialog).toHaveScreenshot('leave-ranked.png');

  await dialog.locator('button:has-text("Keep playing")').click();
  await expect(dialog).toBeHidden();
  // Still at the table, still playing.
  await expect(page.locator('.felt')).toBeVisible();
  expect(page.url()).toContain('/m/mock');
});

test('the warning climbs the ladder with the strikes already standing', async ({ page }) => {
  await stubApi(page);
  // Three strikes standing, so leaving now is the fourth and costs two hours.
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { ...ME, walkoutStrikes: 3, rankedBanUntil: null } })
  );
  await page.goto('/m/mock');
  await waitForDock(page, 'turn');

  await page.locator(LEAVE).click();
  const dialog = page.locator('dialog[aria-label="Leave this match"]');
  await expect(dialog).toContainText('your fourth walkout');
  await expect(dialog).toContainText('2 hours');
});

test('a casual table leaves without asking', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?rated=casual');
  await waitForDock(page, 'turn');

  await page.locator(LEAVE).click();
  // No warning, because there is nothing to warn about: no rating, no strike.
  await expect(page.locator('dialog[aria-label="Leave this match"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test('a spectator has no game to leave', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?watch=1');
  await page.locator('.watch-bar').waitFor({ state: 'visible' });
  await expect(page.locator(LEAVE)).toHaveCount(0);
});
