import { expect, test } from '@playwright/test';
import { stubApi } from './table.ts';

/* The preflop chart appears only once an answer is in, and it enters in a wave
   out from its centre (../src/ui/grid-entrance.ts). There is no baseline for
   this page, so what is pinned here is the pair of things an entrance can
   break: a cell that never finishes and is left invisible, and a page that
   reflows while it runs.

   Nothing is timed. The suite runs under load and a wall clock assertion about
   a 520ms animation is a flake waiting to happen, so the visible state is
   polled instead. Polling rather than waiting for the animations to drain, in
   particular: there is a tick after the cells mount where they are hidden and
   motion has not attached anything yet, and a drain check passes straight
   through it and reads the grid at nothing. */

const CELLS = 169;

async function answerOne(page: import('@playwright/test').Page) {
  await stubApi(page);
  await page.goto('/puzzles/preflop');
  await page.locator('.row .btn-secondary').first().click();
  await page.waitForSelector('.chart-cell');
}

const boxes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const out: Record<string, unknown> = {};
    for (const sel of ['.puzzle-board', '.chart-grid', '.chart-legend', '.score-row']) {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      out[sel] = b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    }
    return out;
  });

const opaque = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.chart-cell')]
      .filter((el) => getComputedStyle(el).opacity === '1').length);

test('every chart cell finishes the entrance visible', async ({ page }) => {
  await answerOne(page);
  await expect.poll(() => opaque(page)).toBe(CELLS);
});

test('the next spot draws a chart that finishes visible too', async ({ page }) => {
  await answerOne(page);
  await expect.poll(() => opaque(page)).toBe(CELLS);
  await page.getByRole('button', { name: 'Deal the next spot' }).click();
  await page.locator('.row .btn-secondary').first().click();
  await page.waitForSelector('.chart-cell');
  await expect.poll(() => opaque(page)).toBe(CELLS);
});

test('nothing on the page moves while the chart arrives', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await answerOne(page);
  const during = await boxes(page);
  await expect.poll(() => opaque(page)).toBe(CELLS);
  expect(await boxes(page)).toEqual(during);
});

test('reduced motion gets the chart with no entrance at all', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await answerOne(page);
  const state = await page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>('.chart-cell')];
    return {
      animating: cells.filter((el) => el.getAnimations().length > 0).length,
      opaque: cells.filter((el) => getComputedStyle(el).opacity === '1').length,
    };
  });
  expect(state).toEqual({ animating: 0, opaque: CELLS });
});
