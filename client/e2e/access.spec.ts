import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { stubApi, waitForDock } from './table.ts';

/* Nothing serious or critical, in every state of the dock and on both shapes of
   felt. Colour contrast is included: the palette is g-system's and it is meant
   to hold up, so a failure here is a real finding rather than a rule to turn
   off. */

const STATES = [
  { name: 'your turn', url: '/m/mock?step=9' },
  { name: 'waiting', url: '/m/mock?step=2' },
  { name: 'hand over', url: '/m/mock?step=13' },
  { name: 'the result', url: '/m/mock?step=18' },
  { name: 'six-max', url: '/m/mock?mode=six-max&step=0' },
  /* The run-out's count is the one live figure the felt prints outside a
     seat or the pot, and it is a timer, so it is here for its contrast and
     for the role it announces itself with. */
  { name: 'an all-in run-out', url: '/m/mock?runout=1&step=2' },
  { name: 'home', url: '/' },
  { name: 'an invite', url: '/c/ch-open' },
  { name: 'a lobby', url: '/g/hg-open' },
  /* The two grid pages. Both shade 169 cells on a ramp, which is the one place
     in the app where a colour is doing the reading rather than decorating it,
     so the contrast rule is the point of having them here. */
  { name: 'the range explorer', url: '/tools/ranges' },
  { name: 'the opening explorer', url: '/tools/explorer' },
];

for (const state of STATES) {
  test(`${state.name} has no serious accessibility failures`, async ({ page }) => {
    await stubApi(page);
    await page.goto(state.url);
    await page.waitForTimeout(1500);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}

test('a decision can be made with the keyboard alone', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=9');
  await waitForDock(page, 'turn');

  const field = page.locator('.dock-field .input');

  /* R goes to the amount, wherever the focus was. */
  await page.keyboard.press('r');
  await expect(field).toBeFocused();

  /* The number keys address the presets, and the field is the source of truth
     either way. */
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('5');
  await expect(field).toHaveValue('184');

  /* Type an exact size and send it. */
  await page.keyboard.press('r');
  await page.keyboard.type('137');
  await expect(page.locator('.dock-acts .btn[data-primary]')).toHaveText('Raise to 137');
  const before = await page.locator('.devnote').innerText();
  await page.keyboard.press('Enter');
  await expect(page.locator('.devnote')).not.toHaveText(before);
});

test('every dock control is reachable by tab', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=9');
  await waitForDock(page, 'turn');

  const wanted = await page.locator('.dock button:visible, .dock input:visible').count();
  const seen = new Set<string>();
  for (let i = 0; i < 40 && seen.size < wanted; i += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest('.dock')) return null;
      return `${el.tagName}:${(el as HTMLElement).innerText || (el as HTMLInputElement).ariaLabel}`;
    });
    if (id) seen.add(id);
  }
  expect(seen.size).toBe(wanted);
});

test('the keys are typed into the field, not swallowed by the shortcuts', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=9');
  const field = page.locator('.dock-field .input');
  await field.click();
  await field.fill('');
  /* "c" would be check or call anywhere else on the page. In the field it is
     nothing at all, and the digits land where they were typed. */
  await page.keyboard.type('1c2f3');
  await expect(field).toHaveValue('123');
  await expect(page.locator('.dock[data-state="turn"]')).toBeVisible();
});
