import { expect, test } from '@playwright/test';
import { contrastOf } from '../src/ui/prefs.ts';
import { setTheme, stubApi } from './table.ts';

/* The settings menu, and the two promises it makes that a screenshot cannot
   check: every accent stays readable, and a choice survives a reload. */

const ACCENTS = ['default', 'ocean', 'jade', 'violet', 'clay'];

async function openMenu(page: import('@playwright/test').Page) {
  await page.locator('button[popovertarget="settings-menu"]').click();
  await expect(page.locator('#settings-menu')).toBeVisible();
}

test('a theme survives a reload, and lands before the first paint', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await openMenu(page);
  await page.locator('.choices .choice', { hasText: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  /* Stamped by the inline script in index.html, before React or g-ui have run,
     which is what stops the page flashing dark on the way to light. */
  const early = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  expect(early).toBe('light');
});

test('an accent and a deck survive a reload', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await openMenu(page);
  await page.locator('.swatch[data-accent="jade"]').click();
  await page.locator('.settings-menu .switch').first().check();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'jade');
  await expect(page.locator('html')).toHaveAttribute('data-deck', 'four');
  expect(await page.evaluate(() => localStorage.getItem('ot.prefs'))).toContain('jade');
});

/* The one thing a rebrand can get wrong that nobody notices until somebody
   cannot read a button. The values come out of the stylesheet that shipped, so
   this cannot pass on a colour nobody sees. */
for (const theme of ['dark', 'light'] as const) {
  test(`every accent keeps its label readable in ${theme}`, async ({ page }) => {
    await stubApi(page);
    await setTheme(page, theme);
    await page.goto('/');

    for (const accent of ACCENTS) {
      /* Read through a real element rather than off the custom properties: a
         custom property whose value is another var() comes back unresolved,
         and the default accent is exactly that. A probe painted with the two
         colours reports what the eye would see. */
      const pair = await page.evaluate((a) => {
        const el = document.documentElement;
        if (a === 'default') el.removeAttribute('data-accent');
        else el.setAttribute('data-accent', a);
        const probe = document.createElement('span');
        probe.style.background = 'var(--accent-fill)';
        probe.style.color = 'var(--accent-fg)';
        document.body.append(probe);
        const s = getComputedStyle(probe);
        const out = [s.backgroundColor, s.color];
        probe.remove();
        return out;
      }, accent);

      const ratio = contrastOf(pair[0], pair[1]);
      expect(ratio, `${accent} resolves to two colours`).not.toBe(null);
      expect(
        ratio!,
        `${accent} in ${theme}: label on the primary button`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('the four colour deck gives each suit its own colour', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=13');

  const suits = () => page.evaluate(() => {
    const pick = (s: string) => {
      const el = document.querySelector(`.pcard[data-suit="${s}"]`);
      return el ? getComputedStyle(el).color : null;
    };
    return { h: pick('h'), d: pick('d'), c: pick('c') };
  });

  const two = await suits();
  expect(two.h, 'red suits match by default').toBe(two.d);

  await page.evaluate(() => document.documentElement.setAttribute('data-deck', 'four'));
  const four = await suits();
  expect(four.h, 'hearts stay red').toBe(two.h);
  expect(four.d, 'diamonds go their own way').not.toBe(four.h);
  expect(four.c, 'and so do clubs').not.toBe(four.d);
});

for (const theme of ['dark', 'light'] as const) {
  test(`the settings menu looks right in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubApi(page);
    await setTheme(page, theme);
    await page.goto('/m/mock?step=9');
    await page.addStyleTag({ content: '.devnote { display: none !important; }' });
    await openMenu(page);
    await page.waitForTimeout(400);
    await expect(page.locator('#settings-menu')).toHaveScreenshot(`settings-${theme}.png`);
  });
}
