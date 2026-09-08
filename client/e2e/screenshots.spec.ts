import { expect, test } from '@playwright/test';
import { masks, setTheme, stubApi } from './table.ts';

/* One picture per state, per width, per theme. The point is not that the table
   looks nice in a baseline: it is that a change to a token, a breakpoint or a
   dock row shows up as a diff on the state it broke rather than as a bug report
   two weeks later.

   The replay page is not here. It draws a hand fetched from the API, and this
   suite deliberately runs without one. */

const WIDTHS = [360, 390, 430, 768, 1366, 1920];
const THEMES = ['dark', 'light'] as const;

const STATES = [
  { name: 'home', url: '/' },
  { name: 'waiting', url: '/m/mock?step=2' },
  { name: 'turn', url: '/m/mock?step=9' },
  { name: 'hand-over', url: '/m/mock?step=13' },
  { name: 'result', url: '/m/mock?step=18' },
  { name: 'six-max', url: '/m/mock?mode=six-max&step=0' },
  { name: 'six-max-over', url: '/m/mock?mode=six-max&step=6' },
];

/* Reduced motion, so a card that is still dealing cannot decide a baseline. */
test.use({ reducedMotion: 'reduce' });

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    for (const state of STATES) {
      test(`${state.name} at ${width} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await stubApi(page);
        await setTheme(page, theme);
        await page.goto(state.url);
        /* The mock's dev caption is fixed to the corner of the viewport and
           says which step it is on. Hidden rather than masked: a magenta block
           over the dock hides the thing the baseline is for. */
        await page.addStyleTag({ content: '.devnote { display: none !important; }' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1200);

        await expect(page).toHaveScreenshot(`${state.name}-${width}-${theme}.png`, {
          fullPage: true,
          mask: masks(page),
        });
      });
    }
  }
}
