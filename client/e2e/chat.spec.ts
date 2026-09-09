import { expect, test } from '@playwright/test';
import type { Box } from './table.ts';
import { boxes, markSettled, shiftSince, stubApi, waitForDock, watchLayoutShift } from './table.ts';

/* Chat is the first thing added to this screen that is not a row of its grid,
   which is exactly why it needs its own case: opening it, sending from it and
   closing it again must leave the header, the felt and the dock in the boxes
   they were already in. Both widths, because the panel is a column beside the
   felt at one and a sheet over it at the other. */

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

function diff(a: Record<string, Box | null>, b: Record<string, Box | null>): string[] {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

for (const size of SIZES) {
  test(`chat opens, sends and closes without moving the table at ${size.width}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await stubApi(page);
    await watchLayoutShift(page);
    await page.goto('/m/mock');

    await waitForDock(page, 'turn');
    const settledAt = await markSettled(page);
    const shut = await boxes(page);

    const panel = page.locator('#table-chat');
    /* On a phone the toggle is the round button on the felt, not the header's
       word: see chat/CLAUDE.md. */
    const toggle = page.locator(size.width <= 560 ? '.chat-fab' : '.chat-toggle');
    await expect(panel).toBeHidden();

    await toggle.click();
    await expect(panel).toBeVisible();
    expect(diff(shut, await boxes(page)), 'boxes that moved when chat opened').toEqual([]);

    /* The scripted conversation, replayed the way a room replays one on join. */
    await expect(page.locator('.chat-line')).toHaveCount(4);
    /* A spectator's line is marked as one, so two conversations in one list can
       be told apart. */
    await expect(page.locator('.chat-line[data-rail]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Good game', exact: true }).click();
    /* Sending starts the same gap the server holds, and the button says so
       rather than failing silently on the next press. Checked first: the gap
       is two seconds, and measuring every box on a loaded machine can take
       longer than that. */
    await expect(page.locator('.chat-send-btn')).toBeDisabled();
    await expect(page.locator('.chat-send-btn')).toContainText(/Send in \ds/);
    await expect(page.locator('.chat-line')).toHaveCount(5);
    await expect(page.locator('.chat-line').last()).toContainText('Good game');
    expect(diff(shut, await boxes(page)), 'boxes that moved when a message was sent').toEqual([]);

    /* The phone's button is not drawn while the panel is open (the panel is
       a sheet over that corner), so there the panel's own Close shuts it. */
    if (size.width <= 560) await panel.getByRole('button', { name: 'Close' }).click();
    else await toggle.click();
    await expect(panel).toBeHidden();
    expect(diff(shut, await boxes(page)), 'boxes that moved when chat closed').toEqual([]);

    expect(await shiftSince(page, settledAt)).toBe(0);
  });
}

/* Where the panel goes at each width. The rule is one sentence: it takes the
   gutter beside the felt when there is one, and covers the felt when there is
   not, and either way it never lands on top of a seat. */
test('the panel takes the gutter beside a felt wide enough to have one', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubApi(page);
  await page.goto('/m/mock');
  await waitForDock(page, 'turn');
  await page.locator('.chat-toggle').click();

  const felt = await page.locator('.felt-in').boundingBox();
  const panel = await page.locator('#table-chat').boundingBox();
  if (!felt || !panel) throw new Error('the felt and the panel must both be on the page');
  expect(panel.x, 'the panel starts after the felt ends').toBeGreaterThanOrEqual(felt.x + felt.width);
  expect(panel.x + panel.width, 'the panel stays inside the window').toBeLessThanOrEqual(1920);
});

test('the panel is a sheet above the dock where there is no gutter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubApi(page);
  await page.goto('/m/mock');
  await waitForDock(page, 'turn');
  await page.locator('.chat-toggle').click();

  const dock = await page.locator('.dock').boundingBox();
  const panel = await page.locator('#table-chat').boundingBox();
  if (!dock || !panel) throw new Error('the dock and the panel must both be on the page');
  expect(Math.round(panel.y + panel.height), 'the sheet stops at the dock').toBe(Math.round(dock.y));
});
