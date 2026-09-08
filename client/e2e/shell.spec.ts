import { expect, test } from '@playwright/test';
import { setTheme, stubApi } from './table.ts';

/* The chrome, which is g-system's `.g-shell`. Three things are worth holding:
   that the sidebar is a landmark with a name on a wide window, that the sheet
   opens and shuts on a phone by every route a reader has, and that a table
   gets the sheet at every width because the felt is measured against the whole
   window.

   The sheet is where the keyboard work is. A drawer that opens with a click
   and can only be shut with another one strands whoever opened it by keyboard,
   so Escape and the scrim both close it and both put the focus back on the
   control that opened it. */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1366, height: 900 };

const toggle = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Menu' });
const sidebar = (page: import('@playwright/test').Page) => page.locator('#site-nav');

test.describe('on a wide window', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.setViewportSize(DESKTOP);
  });

  test('the sections are a named landmark, and the one you are in says so', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveText([
      'Play', 'Arena', 'Learn', 'Puzzles', 'Tools', 'Watch', 'Leaderboard',
    ]);
    await expect(nav.getByRole('link', { name: 'Play' })).toHaveAttribute('aria-current', 'page');

    /* The section follows the page, and a page that is not a section marks
       none of them. */
    await nav.getByRole('link', { name: 'Watch' }).click();
    await expect(page).toHaveURL(/\/watch$/);
    await expect(nav.getByRole('link', { name: 'Watch' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

    await page.goto('/u/kestrel');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
  });

  test('the sidebar is there, so there is nothing to open', async ({ page }) => {
    await page.goto('/');
    await expect(sidebar(page)).toBeVisible();
    await expect(toggle(page)).toBeHidden();
    /* Who you are and how it looks sit at the foot of it, not in the top bar. */
    await expect(page.locator('.side-foot .account > button')).toBeVisible();
    await expect(page.locator('.side-foot button[popovertarget="settings-menu"]')).toBeVisible();
    await expect(page.locator('#settings-menu')).toHaveCount(1);
  });

  test('a table has no sidebar beside it, and the page keeps the width', async ({ page }) => {
    await page.goto('/m/mock?step=9');
    await expect(page.locator('.match')).toBeVisible();
    await expect(toggle(page)).toBeVisible();

    /* Not narrowed by a column: the felt starts at the left edge of the
       window, which is what the footprint suite measures it against. */
    const main = (await page.locator('.shell-main').boundingBox())!;
    expect(Math.round(main.x)).toBe(0);
    expect(Math.round(main.width)).toBe(DESKTOP.width);

    /* And the two controls come back to the top bar, still one of each. */
    await expect(page.locator('.top .account > button')).toBeVisible();
    await expect(page.locator('#settings-menu')).toHaveCount(1);
  });
});

test.describe('on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await expect(page.locator('.top')).toBeVisible();
  });

  test('a shut sheet is out of the tab order', async ({ page }) => {
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toHaveAttribute('aria-controls', 'site-nav');
    /* Seven links off the screen are seven tab stops nobody asked for. */
    await expect(sidebar(page)).toHaveAttribute('inert', '');
    await toggle(page).focus();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('#site-nav')),
        'the tab order walked into the shut sheet',
      ).toBe(false);
    }
  });

  test('the toggle opens it and Escape shuts it, with the focus back where it was',
    async ({ page }) => {
      await toggle(page).click();
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(sidebar(page).getByRole('link', { name: 'Leaderboard' })).toBeVisible();
      await expect(sidebar(page)).not.toHaveAttribute('inert', '');

      await page.keyboard.press('Escape');
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(sidebar(page)).toHaveAttribute('inert', '');
      await expect(toggle(page)).toBeFocused();
    });

  test('the scrim shuts it, and so does going somewhere', async ({ page }) => {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    /* Off to the right of the sheet: the scrim covers the window and the sheet
       covers its left 248px, so the middle of it is not the part a reader can
       reach. */
    await page.locator('.g-scrim').click({ position: { x: 340, y: 400 } });
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toBeFocused();

    await toggle(page).click();
    await sidebar(page).getByRole('link', { name: 'Puzzles' }).click();
    await expect(page).toHaveURL(/\/puzzles$/);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toBeFocused();
  });

  test('the account and the settings are in the top bar while the sidebar is a sheet',
    async ({ page }) => {
      await expect(page.locator('.top .account > button')).toBeVisible();
      await expect(page.locator('.top button[popovertarget="settings-menu"]')).toBeVisible();
      await expect(page.locator('#settings-menu')).toHaveCount(1);
      await expect(page.locator('.side-foot')).toHaveCount(0);
    });
});
