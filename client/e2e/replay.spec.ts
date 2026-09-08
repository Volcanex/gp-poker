import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/* Read rather than imported: a JSON import needs an import attribute, and what
   that resolves to depends on the transpiler in the middle. A file is a file. */
const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'));

const hand = fixture('hand');
const match = fixture('match');

/* The replay is the one page you can step backwards through, and that is what
   caught the chip flights leaking: a flight's removal timer was cancelled by
   the next state, so a scrub left two chips behind every time and motion
   eventually threw the pile below the felt.

   A real recorded hand, captured from the server and committed beside this
   file, because the whole page is a re-derivation of one: the engine replays
   the actions and the fairness panel rehashes the seed. A mock cannot stand in
   for it. */

const HAND = 'qtabzev9-3';
const MATCH = 'qtabzev9';

/* Catch-all first: Playwright runs the last handler that matches. */
async function stubReplay(page: import('@playwright/test').Page) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/me', (route) => route.fulfill({
    json: { id: 'u-e2e', name: 'kestrel', guest: true, bot: false, rating: 1500, rd: 350, provisional: true, ratings: {} },
  }));
  await page.route(`**/api/matches/${MATCH}`, (route) => route.fulfill({ json: match }));
  await page.route(`**/api/hands/${HAND}`, (route) => route.fulfill({ json: hand }));
}

async function loose(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const felt = document.querySelector('.felt');
    if (!felt) return { chips: -1, outside: -1, flights: -1 };
    const box = felt.getBoundingClientRect();
    /* Bets, and every chip stack on the page: a leftover flight is a bet chip,
       and anything drawn outside the felt is what the bug looked like. */
    const bets = [...document.querySelectorAll('.bet-chip')];
    const chips = [...document.querySelectorAll('.bet-chip, .chips')];
    return {
      bets: bets.length,
      flights: document.querySelectorAll('.flights .bet-chip').length,
      outside: chips.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && (r.bottom > box.bottom + 1 || r.top < box.top - 1
          || r.right > box.right + 1 || r.left < box.left - 1);
      }).length,
    };
  });
}

test('stepping a hand back and forth leaves nothing behind', async ({ page }) => {
  await stubReplay(page);
  await page.goto(`/m/${MATCH}/h/3`);
  await expect(page.locator('.felt')).toBeVisible();
  await expect(page.locator('.act-row').first()).toBeVisible();

  const steps = await page.locator('.act-row').count();
  expect(steps, 'the fixture has a hand worth stepping through').toBeGreaterThan(4);

  /* Scrub the way somebody studying a hand does: to the end, back to the deal,
     over and over, without waiting for anything to settle. */
  for (let cycle = 0; cycle < 6; cycle += 1) {
    for (let i = 0; i <= steps; i += 1) await page.keyboard.press('ArrowRight');
    for (let i = 0; i <= steps; i += 1) await page.keyboard.press('ArrowLeft');
  }
  await page.waitForTimeout(900);

  const after = await loose(page);
  expect(after.flights, 'chips left over the pot').toBe(0);
  expect(after.outside, 'anything drawn outside the felt').toBe(0);
  /* Back at the deal there are two bets on the table, the two blinds. */
  expect(after.bets, 'bets on the table at the deal').toBe(2);
});

test('a recorded hand still replays and verifies', async ({ page }) => {
  await stubReplay(page);
  await page.goto(`/m/${MATCH}/h/3`);
  await expect(page.locator('.felt')).toBeVisible();

  await expect(page.locator('.seat-name').first()).toContainText('Opal');
  /* Both fairness checks run in the browser on the published seed. */
  await expect(page.locator('.checks li[data-ok]')).toHaveCount(2);

  const steps = await page.locator('.act-row').count();
  for (let i = 0; i <= steps; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.board .pcard:not([data-empty])')).toHaveCount(5);
});
