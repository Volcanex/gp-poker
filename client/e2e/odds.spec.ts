import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { boxes, stubApi } from './table.ts';

/* The pot odds trainer is answered in a rhythm, so its whole layout is built
   on reserved boxes: answering must not move the figures, the cards or the
   buttons. That is a promise a stylesheet can break silently, which is what
   this file is for. No baselines: the assertion is the geometry itself. */

const SPOT = '/tools/odds?hand=AhKd&board=Qs7h2c&pot=52&bet=26&opponents=1';
const FOOTPRINT = ['.odds-figures', '.odds-hands', '.odds-acts', '.odds-score'];

const SEED = {
  right: 0, total: 0, streak: 0, best: 0, timer: false,
  streets: ['flop', 'turn', 'river'],
};

/* setTheme in table.ts writes g-ui's own key, but this app applies ot.prefs on
   mount and that call wins, so a theme has to be stamped where the app reads
   it or the page comes back dark whatever was asked for. */
const stamp = (page: Page, theme: 'dark' | 'light') =>
  page.addInitScript(
    ([t, seed]) => {
      localStorage.setItem('ot.prefs', JSON.stringify({ theme: t, accent: 'default', fourColour: false }));
      localStorage.setItem('ot.odds', JSON.stringify(seed));
    },
    [theme, SEED] as const,
  );

test.use({ reducedMotion: 'reduce' });

/* Both keys, because the two verdicts are not the same width: the wide badge
   wraps the sentence at phone widths and the narrow one does not, and a
   reserve one line short passes on the right answer and fails on the wrong
   one. That is exactly how this broke the first time. */
for (const width of [360, 390, 1366] as const) {
  for (const key of ['c', 'f'] as const) {
    test(`answering ${key} moves nothing at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await stubApi(page);
      await stamp(page, 'dark');
      await page.goto(SPOT);
      await expect(page.locator('.odds-acts .btn').first()).toBeEnabled({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);

      const before = await boxes(page, FOOTPRINT);
      await page.keyboard.press(key);
      await expect(page.locator('.odds-reveal .badge')).toBeVisible();
      expect(await boxes(page, FOOTPRINT)).toEqual(before);
    });
  }
}

for (const theme of ['dark', 'light'] as const) {
  test(`the trainer has no serious accessibility failures in ${theme}`, async ({ page }) => {
    await stubApi(page);
    await stamp(page, theme);
    await page.goto(SPOT);
    await expect(page.locator('.odds-acts .btn').first()).toBeEnabled({ timeout: 20_000 });

    const scan = async () => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      return results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    };

    expect(await scan()).toEqual([]);
    await page.keyboard.press('c');
    await expect(page.locator('.odds-reveal .badge')).toBeVisible();
    expect(await scan()).toEqual([]);
  });
}
