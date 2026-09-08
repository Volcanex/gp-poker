import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Box } from './table.ts';
import { boxes, markSettled, shiftSince, stubApi, watchLayoutShift } from './table.ts';

/* The phone's v2 band, which replaces the dock below 560px. The footprint rule
   is the same rule the dock lives under and the reason this file exists: the
   band is a fixed box with four states drawn inside it, and a hand that walks
   through all of them must not move a pixel of the felt above.

   The band's own selectors are used rather than FOOTPRINT, because the felt
   stops drawing your seat when the band is on screen: the band is that seat. */
const PHONE = { width: 390, height: 844 };
const BAND_FOOTPRINT = ['.hand-head', '.felt', '.board', '.pot', '.hero-band'];

function diff(a: Record<string, Box>, b: Record<string, Box>): string[] {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

async function waitForBand(page: import('@playwright/test').Page, state: string, timeout = 45_000) {
  await page.locator(`.hero-band[data-state="${state}"]`).waitFor({ state: 'visible', timeout });
}

test('the hero band keeps one footprint through a hand', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await stubApi(page);
  await watchLayoutShift(page);
  await page.goto('/m/mock?v2=1');

  await waitForBand(page, 'turn');
  const settledAt = await markSettled(page);
  const onTurn = await boxes(page, BAND_FOOTPRINT);

  await waitForBand(page, 'wait');
  expect(
    diff(onTurn, await boxes(page, BAND_FOOTPRINT)),
    'boxes that moved between your turn and waiting',
  ).toEqual([]);

  await waitForBand(page, 'over');
  /* The hand-end sequence: the cards flip, the five are outlined, the pot
     settles. None of it may move a box. */
  await page.waitForTimeout(1200);
  expect(
    diff(onTurn, await boxes(page, BAND_FOOTPRINT)),
    'boxes that moved between your turn and hand over',
  ).toEqual([]);

  await waitForBand(page, 'turn');
  expect(
    diff(onTurn, await boxes(page, BAND_FOOTPRINT)),
    'boxes that moved over a whole hand',
  ).toEqual([]);

  expect(await shiftSince(page, settledAt)).toBe(0);
});

/* The band is your seat, drawn large. The felt must therefore stop drawing it,
   and must keep the bet that hangs off it, because that is where a chip flies
   from. */
test('the felt gives up your seat to the band and keeps your bet', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await expect(page.locator('.pos[data-k="0"] .seat')).toBeHidden();
  await expect(page.locator('.pos[data-k="0"] .seat-bet')).toBeVisible();
  await expect(page.locator('.hb-cards .pcard')).toHaveCount(2);

  /* v1 at the same width keeps the seat it has always had. */
  await page.goto('/m/mock?step=9');
  await expect(page.locator('.pos[data-k="0"] .seat')).toBeVisible();
  await expect(page.locator('.hero-band')).toHaveCount(0);
});

/* Fold is a slide, not a tap. Dragging the handle most of the way across sends
   it; the mock advances a step on any action, which is how the test knows. */
test('the fold bar folds when it is dragged across', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  const before = await page.locator('.devnote').innerText();
  const bar = page.locator('.hb-fold');
  const box = (await bar.boundingBox())!;
  const y = box.y + box.height / 2;

  /* A tap does nothing but nudge: the handle springs back and the hand is
     still yours. */
  await page.mouse.move(box.x + 24, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await page.locator('.devnote').innerText()).toBe(before);

  await page.mouse.move(box.x + 24, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 8, y, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);
});

/* The sizer is a sweep: press anywhere on the track and drag. At the top of
   the range the button says it is putting the stack in. */
test('the sizer sweeps to the top of the range', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=0');
  await waitForBand(page, 'turn');

  await page.locator('.hb-turn .btn[data-primary]').click();
  const track = page.locator('.hb-track');
  await expect(track).toBeVisible();

  const box = (await track.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height - 4);
  await page.mouse.down();
  /* Past the end of the track: the value clamps, which is what a thumb
     running off the top of the screen does. */
  await page.mouse.move(x, box.y - 20, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('.hb-confirm')).toHaveText('All in 200');
  await expect(page.locator('.hb-amount')).toHaveText('200');

  /* Back leaves the decision exactly as it was found. */
  await page.locator('.hb-back').click();
  await expect(page.locator('.hb-turn .btn[data-primary]')).toHaveText('Raise to 4');
});

test('the band has no serious accessibility failures', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await stubApi(page);

  for (const url of ['/m/mock?v2=1&step=9', '/m/mock?v2=1&step=2', '/m/mock?v2=1&step=13']) {
    await page.goto(url);
    await page.waitForTimeout(1200);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      bad.map((v) => `${url} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  }
});

/* The band mirrors on one attribute, stamped before the first paint. */
test('a left-handed table puts the cards and the sweep the other way round', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await stubApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('ot.prefs', JSON.stringify({
      theme: 'dark', accent: 'default', fourColour: false, hand: 'left',
    }));
  });
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await expect(page.locator('html')).toHaveAttribute('data-hand', 'left');
  const cards = (await page.locator('.hb-cards').boundingBox())!;
  const acts = (await page.locator('.hb-col').boundingBox())!;
  expect(cards.x, 'the hand sits on the far side from the thumb').toBeGreaterThan(acts.x);

  await page.locator('.hb-turn .btn[data-primary]').click();
  const track = (await page.locator('.hb-track').boundingBox())!;
  expect(track.x, 'the sweep runs up the near edge').toBeLessThan(acts.x + acts.width / 2);
});
