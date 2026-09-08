import { expect, test } from '@playwright/test';
import { ME, stubApi } from './table.ts';

/* The country flag beside a name. Three promises, and only the first of them
   is visible: the flag is drawn where somebody set one, the seat line is the
   same width where nobody did, and picking one in the settings menu is what
   saves it. The mock table seats riverrat with a flag and kestrel without,
   which is why both halves can be read off the one table. */

test.use({ reducedMotion: 'reduce' });

const seat = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.seat', { hasText: name }).locator('.seat-line .flag');

test('the table draws a flag for the seat that has one and nothing for the seat that does not', async ({ page }) => {
  await stubApi(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/m/mock?step=2');

  const flagged = seat(page, 'riverrat');
  const bare = seat(page, 'kestrel');
  await expect(flagged).toHaveCount(1);
  await expect(bare).toHaveCount(1);

  /* The country is something the player chose to say and nothing else on the
     row says it, so the image is named rather than left decorative. */
  expect(await flagged.evaluate((el) => el.tagName)).toBe('IMG');
  await expect(flagged).toHaveAttribute('alt', 'United Kingdom');
  await expect(flagged).toHaveAttribute('src', '/flags/gb.svg');

  /* The empty slot is not an image at all: nothing to fetch, nothing to fail
     to load, and no alt text claiming a country nobody picked. */
  expect(await bare.evaluate((el) => el.tagName)).not.toBe('IMG');
  expect(await bare.evaluate((el) => el.getAttribute('src'))).toBeNull();
});

test('a flag and an empty slot measure the same, so a seat line cannot move', async ({ page }) => {
  await stubApi(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/m/mock?step=2');

  const flagged = await seat(page, 'riverrat').boundingBox();
  const bare = await seat(page, 'kestrel').boundingBox();
  expect(flagged).not.toBeNull();
  expect(bare).not.toBeNull();
  expect({ w: Math.round(bare!.width), h: Math.round(bare!.height) }).toEqual({
    w: Math.round(flagged!.width),
    h: Math.round(flagged!.height),
  });

  /* And the rows they sit in are one height, which is the thing a player
     would actually see move. */
  const heights = await page
    .locator('.seat .seat-line')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(1);
  expect(new Set(heights).size).toBe(1);
});

test('the settings menu saves a country, and the account row shows it', async ({ page }) => {
  await stubApi(page);

  /* The PATCH the picker sends, answered here rather than by a server: the
     point is that choosing an option is what saves, and that the answer is
     what the rest of the page then reads. Registered after stubApi, because
     Playwright runs the last handler that matches. */
  const patched: unknown[] = [];
  await page.route('**/api/me', async (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const body = request.postDataJSON() as { country: string | null };
    patched.push(body);
    await route.fulfill({ json: { ...ME, country: body.country } });
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await page.locator('button[popovertarget="settings-menu"]').click();
  await expect(page.locator('#settings-menu')).toBeVisible();

  const field = page.locator('.country-picker .g-combobox input');
  await expect(field).toHaveValue('No flag');
  await field.click();
  await field.fill('United King');
  await page.locator('.country-picker .g-option:not([hidden])').first().click();

  await expect.poll(() => patched).toEqual([{ country: 'gb' }]);
  await expect(field).toHaveValue('United Kingdom');
  /* The picker's own flag, then the account row in the sidebar, which reads
     the session the save updated rather than asking /api/me again. */
  await expect(page.locator('.country-picker .flag')).toHaveAttribute('src', '/flags/gb.svg');
  await expect(page.locator('.account button .flag')).toHaveAttribute('alt', 'United Kingdom');
});
