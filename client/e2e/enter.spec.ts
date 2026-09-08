import { expect, test } from '@playwright/test';
import { shiftSince, stubApi, watchLayoutShift } from './table.ts';

/* The page entrance, which is one system for the whole app: the blocks a page
   is made of slide in from the leading edge, in order, once, and then the page
   is a page. Three things have to hold, and none of them is how it looks.

   It has to finish. It must not move anything. And it must not exist at all
   under reduced motion or on the table, which holds one footprint through a
   hand and has a suite that measures it. */

const BLOCKS = '.page > *';

/* Read back what the browser actually resolved, rather than trusting the
   stylesheet: the point of the animation is that it leaves nothing behind. */
async function resting(page: import('@playwright/test').Page) {
  return page.$$eval(BLOCKS, (els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return { opacity: s.opacity, transform: s.transform, animation: s.animationName };
    }));
}

test('the home page is at rest within 600ms of loading', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await expect(page.locator('.home-top')).toBeVisible();

  /* The entrance is on, which is what makes the assertion below mean
     something rather than pass because the rule went missing. */
  const running = await resting(page);
  expect(running.length).toBeGreaterThan(2);
  expect(running.some((b) => b.animation === 'page-enter')).toBe(true);

  await page.waitForTimeout(600);
  for (const block of await resting(page)) {
    expect(block.opacity).toBe('1');
    expect(block.transform).toBe('none');
  }
});

test('a block waiting on the network stays at rest until its content lands', async ({ page }) => {
  await stubApi(page);
  await page.goto('/watch');
  /* Every block that fetches says so, and every one of them ends up ready. */
  await expect(page.locator('[data-enter-ready]').first()).toBeVisible();
  await expect(page.locator('[data-enter-ready="no"]')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(600);
  for (const block of await resting(page)) {
    expect(block.opacity).toBe('1');
    expect(block.transform).toBe('none');
  }
});

test('an entrance moves nothing on the page it enters', async ({ page }) => {
  await stubApi(page);
  await watchLayoutShift(page);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  /* Measured from a home page that has already settled, so the fonts are in
     and the feeds have landed: what happens after this is the entrance and
     nothing else. Tools fetches nothing at all. */
  await page.waitForTimeout(1500);
  const from = await page.evaluate(() => performance.now());

  await page.getByRole('link', { name: 'Tools', exact: true }).click();
  await expect(page.locator('.tools-page')).toBeVisible();
  await page.waitForTimeout(900);

  expect(await shiftSince(page, from)).toBe(0);
});

test('the table takes no entrance', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock');
  await expect(page.locator('.match')).toBeVisible();
  await expect(page.locator('[data-enter]')).toHaveCount(0);
});

test.describe('with motion turned down', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the blocks are at rest on the first frame', async ({ page }) => {
    await stubApi(page);
    await page.goto('/learn');
    await expect(page.locator('.learn-index')).toBeVisible();
    for (const block of await resting(page)) {
      expect(block.animation).toBe('none');
      expect(block.opacity).toBe('1');
      expect(block.transform).toBe('none');
    }
  });
});
