import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Box } from './table.ts';
import { boxes, markSettled, shiftSince, stubApi, watchLayoutShift } from './table.ts';

/* The v2 band, which replaces the dock at every width. The footprint rule is
   the same rule the dock lives under and the reason this file exists: the band
   is a fixed box with four states drawn inside it, and a hand that walks
   through all of them must not move a pixel of the felt above.

   The band's own selectors are used rather than FOOTPRINT, because on a phone
   the felt stops drawing your seat: there, the band is that seat. */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const BAND_FOOTPRINT = ['.hand-head', '.felt', '.board', '.pot', '.hero-band'];

function diff(a: Record<string, Box>, b: Record<string, Box>): string[] {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

async function waitForBand(page: import('@playwright/test').Page, state: string, timeout = 45_000) {
  await page.locator(`.hero-band[data-state="${state}"]`).waitFor({ state: 'visible', timeout });
}

const SIZES = [
  { name: 'phone', size: PHONE },
  { name: 'desktop', size: DESKTOP },
];

const MODES = [
  { name: 'heads-up', url: '/m/mock?v2=1' },
  { name: 'six-max', url: '/m/mock?mode=six-max&v2=1' },
];

for (const { name: where, size } of SIZES) {
  for (const mode of MODES) {
    test(`the band keeps one footprint through a ${mode.name} hand on ${where}`, async ({ page }) => {
      await page.setViewportSize(size);
      await stubApi(page);
      await watchLayoutShift(page);
      await page.goto(mode.url);

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
  }
}

/* The band is your seat, drawn large, at every width: the wide felt drew the
   same cards, name, stack, last action and clock a hundred pixels above the
   band that was drawing them again. The felt must therefore stop drawing the
   seat, and must keep the bet that hangs off it, because that is where a chip
   flies from. */
for (const { name: where, size } of SIZES) {
  test(`the felt gives up your seat to the band and keeps your bet on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
    await stubApi(page);
    await page.goto('/m/mock?v2=1&step=9');
    await waitForBand(page, 'turn');

    await expect(page.locator('.pos[data-k="0"] .seat')).toBeHidden();
    await expect(page.locator('.pos[data-k="0"] .seat-bet')).toBeVisible();
    await expect(page.locator('.hb-cards .pcard')).toHaveCount(2);

    /* And the clock the seat carried is the band's: the bar on its top edge
       and the seconds in the meta's reserved slot. */
    await expect(page.locator('.hero-band .turn-bar')).toBeVisible();
    await expect(page.locator('.hb-clock .turn-secs')).toBeVisible();

    /* v1 at the same width keeps the seat it has always had. */
    await page.goto('/m/mock?step=9');
    await expect(page.locator('.pos[data-k="0"] .seat')).toBeVisible();
    await expect(page.locator('.hero-band')).toHaveCount(0);
  });
}

/* The band's content sits on the felt's column: the cards start on the felt's
   left edge and the controls end on its right one, in both shapes of felt. A
   band spanning the window put 1300 px between the two on a 1366 px laptop. */
for (const mode of MODES) {
  test(`the band sits on the felt's column in ${mode.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await stubApi(page);
    await page.goto(mode.url);
    await waitForBand(page, 'turn');

    const felt = (await page.locator('.felt-in').boundingBox())!;
    const cards = (await page.locator('.hb-cards').boundingBox())!;
    const col = (await page.locator('.hb-col').boundingBox())!;
    const meta = (await page.locator('.hb-nums').boundingBox())!;

    expect(Math.round(cards.x), 'the hand starts on the felt').toBe(Math.round(felt.x));
    expect(Math.round(meta.x), 'and so do the figures under it').toBe(Math.round(felt.x));
    expect(Math.round(col.x + col.width), 'the controls end on it').toBe(Math.round(felt.x + felt.width));

    /* And the whole table is one screen: the band is the one thing that must
       never be under the fold. */
    const fits = await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    );
    expect(fits, 'the table fits 1366 by 768 without a page scrollbar').toBe(true);
  });
}

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

for (const { name: where, size } of SIZES) {
  test(`the band has no serious accessibility failures on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
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
}

/* The mock's caption printed over the hero's cards, which are the one thing on
   this screen you have to be able to read. */
test('the mock caption stands clear of the band', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  const note = (await page.locator('.devnote').boundingBox())!;
  const band = (await page.locator('.hero-band').boundingBox())!;
  expect(note.y + note.height, 'the caption is above the band').toBeLessThanOrEqual(band.y);
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

/* The wide band has no sweep. A mouse gets the six sizes as six segments, each
   printing what it will send, and one press sends it. */
test('the wide band raises from a row of sizes rather than a sweep', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await expect(page.locator('.hb-track')).toHaveCount(0);
  await expect(page.locator('.hb-sizes .hb-size')).toHaveCount(7);
  await expect(page.locator('.hb-size').nth(0)).toContainText('Min');
  await expect(page.locator('.hb-size').nth(4)).toContainText('Pot');
  await expect(page.locator('.hb-size').nth(5)).toContainText('All in');
  await expect(page.locator('.hb-size').nth(6)).toContainText('Custom');

  /* Pressing one sends that raise: the mock advances a step on any action. */
  const before = await page.locator('.devnote').innerText();
  await page.locator('.hb-size').nth(1).click();
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);
});

/* Custom is a field in the segments' own box: Enter sends it, Escape puts the
   six back. `r` reaches for it, the way it reaches for the dock's field. */
test('the wide band takes a size of its own', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await page.keyboard.press('r');
  const field = page.locator('.hb-custom-field .input');
  await expect(field).toBeFocused();
  await expect(page.locator('.hb-sizes')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('.hb-sizes')).toBeVisible();

  await page.locator('.hb-size-custom').click();
  await field.fill('120');
  await expect(page.locator('.hb-custom-send')).toHaveText('Raise to 120');

  const before = await page.locator('.devnote').innerText();
  await field.press('Enter');
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);
});

/* The band answers to the dock's keys, because they are the dock's handlers.
   A number key does what pressing its segment does, which on a wide band is
   send it, and F folds outright. */
test('the wide band takes the same keys the dock does', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await expect(page.locator('.hb-keys')).toBeVisible();

  const before = await page.locator('.devnote').innerText();
  await page.keyboard.press('5');
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);

  /* And F folds outright. From the same decision rather than the one the key
     above just sent, because the step after it is not always a decision. */
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');
  const next = await page.locator('.devnote').innerText();
  await page.keyboard.press('f');
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(next);
});

/* The legend leaves the table's grid on v2: it is inside the band. v1 keeps
   the row it has always had. In the band it is one quiet line under the
   controls, not a column standing in the space between your hand and them. */
test('the key legend moves into the band and out of the table grid', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);

  await page.goto('/m/mock?step=9');
  await expect(page.locator('.match > .dock-keys')).toBeVisible();

  await page.goto('/m/mock?v2=1&step=9');
  await expect(page.locator('.match > .dock-keys')).toHaveCount(0);
  const keys = page.locator('.hero-band .hb-keys');
  await expect(keys).toBeVisible();

  const legend = (await keys.boundingBox())!;
  const col = (await page.locator('.hb-col').boundingBox())!;
  expect(legend.height, 'one line, not a column').toBeLessThan(20);
  expect(Math.round(legend.x), 'under the controls').toBe(Math.round(col.x));
});
