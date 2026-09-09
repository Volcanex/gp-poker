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

/* Sitting out is a state of the same box. The room sits a seat out for three
   timeouts and then check-folds it on arrival while its player is away, and
   before this the client said nothing about either: the owner sat looking at a
   table that folded every hand for him in a millisecond or two. The band says
   so and offers the one press that answers it, and neither may cost a pixel. */
for (const { name: where, size } of SIZES) {
  test(`sitting out says so and keeps one footprint on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
    await stubApi(page);
    await watchLayoutShift(page);
    await page.goto('/m/mock?v2=1&sitout=1');

    const band = page.locator('.hero-band[data-sitout]');
    await band.waitFor({ state: 'visible', timeout: 45_000 });
    await expect(page.locator('.hb-line-text')).toHaveText('You are sitting out. Press to come back');
    await expect(page.locator('.hb-back-btn')).toHaveText('Come back');
    /* One press, not three disabled controls: the only decision a sat-out
       player has is whether to be at the table at all. */
    await expect(page.locator('.hb-act-fold')).toHaveCount(0);
    await expect(page.locator('.hb-act-call')).toHaveCount(0);
    await expect(page.locator('.hb-act-bet')).toHaveCount(0);

    const settledAt = await markSettled(page);
    const satOut = await boxes(page, BAND_FOOTPRINT);

    /* The hand ends: the result takes the line back, because who won is worth
       reading, and the prompt returns with the next hand. Neither move. */
    await waitForBand(page, 'over');
    await page.waitForTimeout(1200);
    await expect(page.locator('.hb-back-btn')).toHaveCount(0);
    expect(
      diff(satOut, await boxes(page, BAND_FOOTPRINT)),
      'boxes that moved between sitting out and the hand ending',
    ).toEqual([]);

    await band.waitFor({ state: 'visible', timeout: 45_000 });
    expect(
      diff(satOut, await boxes(page, BAND_FOOTPRINT)),
      'boxes that moved over a whole hand sitting out',
    ).toEqual([]);
    expect(await shiftSince(page, settledAt)).toBe(0);
  });
}

/* The band is your seat, drawn large, at every width: the wide felt drew the
   same cards, name, stack, last action and clock a hundred pixels above the
   band that was drawing them again. The felt must therefore stop drawing the
   bottom row at all. */
for (const { name: where, size } of SIZES) {
  test(`the felt gives up your seat to the band on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
    await stubApi(page);
    await page.goto('/m/mock?v2=1&step=9');
    await waitForBand(page, 'turn');

    await expect(page.locator('.pos[data-k="0"] .seat')).toBeHidden();
    await expect(page.locator('.hb-cards .pcard')).toHaveCount(2);

    /* And the clock the seat carried is the band's: the bar under the decision
       line and the seconds at the line's end. */
    await expect(page.locator('.hb-line .turn-bar')).toBeVisible();
    await expect(page.locator('.hb-line .turn-secs')).toBeVisible();

    /* Your chips stand beside your figure, the way a seat's do. */
    await expect(page.locator('.hb-nums .hb-chips .chip-col')).toHaveCount(3);

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

/* Fold is a button, in the fold colour, at every width. It was a slide; the
   owner cut it. Where folding is not legal it is disabled, never dropped, so
   the column keeps its shape. The mock advances a step on any action, which
   is how the test knows a press was sent. */
for (const { name: where, size } of SIZES) {
  test(`fold is a button on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
    await stubApi(page);
    await page.goto('/m/mock?v2=1&step=9');
    await waitForBand(page, 'turn');
    await expect(page.locator('.hb-fold')).toHaveCount(0);

    const before = await page.locator('.devnote').innerText();
    await page.locator('.hb-act-fold').click();
    await expect
      .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
      .not.toBe(before);

    /* Facing a check there is nothing to fold to. */
    await page.goto('/m/mock?v2=1&step=4');
    await waitForBand(page, 'turn');
    await expect(page.locator('.hb-act-fold')).toBeVisible();
    await expect(page.locator('.hb-act-fold')).toBeDisabled();
    await expect(page.locator('.hb-act-call')).toHaveText('Check');
    /* Under a mouse the button carries the size it will send; under a thumb it
       is the way to the sweep and carries the word alone. */
    await expect(page.locator('.hb-bet')).toContainText('Bet');
  });
}

/* One line says what there is to decide. It is the band's top edge, the
   clock's bar is its floor, and it is the only status the band prints: the
   pot note, the waiting line, the result line and its countdown badge all
   folded into it. It is the same box in every state. */
for (const { name: where, size } of SIZES) {
  test(`the decision line says what there is to decide on ${where}`, async ({ page }) => {
    await page.setViewportSize(size);
    await stubApi(page);

    await page.goto('/m/mock?v2=1&step=9');
    await waitForBand(page, 'turn');
    const line = page.locator('.hb-line');
    await expect(line.locator('.hb-line-text')).toHaveText('34 to call');
    await expect(line.locator('.turn-secs')).toBeVisible();
    await expect(line.locator('.turn-bar')).toBeVisible();
    await expect(line).toHaveAttribute('data-whose', 'you');
    const onTurn = (await line.boundingBox())!;

    await page.goto('/m/mock?v2=1&step=4');
    await waitForBand(page, 'turn');
    await expect(line.locator('.hb-line-text')).toHaveText('Check or bet');

    await page.goto('/m/mock?v2=1&step=1');
    await waitForBand(page, 'wait');
    await expect(line.locator('.hb-line-text')).toHaveText('riverrat to act');
    await expect(line.locator('.turn-secs')).toBeVisible();
    await expect(line).toHaveAttribute('data-whose', 'them');
    expect(await line.boundingBox(), 'one box while waiting').toEqual(onTurn);

    await page.goto('/m/mock?v2=1&step=13');
    await waitForBand(page, 'over');
    await expect(line.locator('.hb-line-text')).toHaveText('You win 132 with flush, king high');
    await expect(line.locator('.hb-line-end')).toContainText('Next hand in');
    expect(await line.boundingBox(), 'one box at hand end').toEqual(onTurn);

    await page.goto('/m/mock?v2=1&step=1&watch=1');
    await waitForBand(page, 'watch');
    await expect(line.locator('.hb-line-text')).toHaveText('Watching, riverrat to act');

    /* And nothing else on the band says any of it. */
    for (const url of ['/m/mock?v2=1&step=9', '/m/mock?v2=1&step=1', '/m/mock?v2=1&step=13']) {
      await page.goto(url);
      await page.locator('.hero-band').waitFor();
      await expect(page.locator('.hero-band .hb-status')).toHaveCount(0);
      await expect(page.locator('.hero-band .dock-result')).toHaveCount(0);
      await expect(page.locator('.hero-band .hb-note')).toHaveCount(0);
    }
  });
}

/* The sizer is a sweep: press anywhere on the track and drag. At the top of
   the range the button says it is putting the stack in. */
test('the sizer sweeps to the top of the range', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=0');
  await waitForBand(page, 'turn');

  await expect(page.locator('.hb-act-bet')).toHaveText('Raise');
  await page.locator('.hb-act-bet').click();
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
  await expect(page.locator('.hb-act-bet')).toHaveText('Raise');
  await expect(page.locator('.hb-line-text')).toHaveText('1 to call');
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

/* A practice table holds a finished hand until you deal on. The button stands
   in the countdown's slot, so the line is the same box held or counting, and
   Enter or N press it. */
test('a held hand offers the next deal in the countdown\'s slot', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=13');
  await waitForBand(page, 'over');
  const counting = (await page.locator('.hb-line').boundingBox())!;
  await expect(page.locator('.hb-line-next')).toHaveCount(0);

  await page.goto('/m/mock?v2=1&step=13&hold=1');
  await waitForBand(page, 'over');
  const next = page.locator('.hb-line-end .hb-line-next');
  await expect(next).toHaveText('Deal the next hand');
  await expect(page.locator('.hb-line-end')).not.toContainText('Next hand in');
  expect(await page.locator('.hb-line').boundingBox(), 'one box, held or counting').toEqual(counting);
  const line = (await page.locator('.hb-line').boundingBox())!;
  const btn = (await next.boundingBox())!;
  expect(Math.round(btn.x + btn.width), 'on the line\'s right end').toBe(Math.round(line.x + line.width));

  const before = await page.locator('.devnote').innerText();
  await page.keyboard.press('n');
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);

  await page.goto('/m/mock?v2=1&step=13&hold=1');
  await waitForBand(page, 'over');
  await next.click();
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);
});

/* The band is your seat, so its figure moves when the seat's would: when the
   pot has actually landed, not when the result message arrives. The result
   carries the paid stack, so a band reading it straight out of the view would
   only ever print the number you won and this would see one value; holding it
   is what puts the number you had in front of it.

   Recorded in the page rather than polled from here. The hold is 700ms and a
   round trip through the driver can spend most of it, which made a poll pass
   nine times in ten. */
test("the band's figure waits for the pot to land", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __figures: string[] };
    w.__figures = [];
    const read = () => {
      const text = document.querySelector('.hb-stack')?.textContent?.trim();
      if (text && text !== w.__figures[w.__figures.length - 1]) w.__figures.push(text);
    };
    const id = setInterval(read, 16);
    setTimeout(() => clearInterval(id), 8000);
  });

  await page.goto('/m/mock?v2=1&step=13');
  await waitForBand(page, 'over');
  await expect(page.locator('.award-chip')).toBeVisible();
  await page.waitForTimeout(400);

  const figures = await page.evaluate(
    () => (window as unknown as { __figures: string[] }).__figures,
  );
  expect(figures, 'the stack you had, then the stack you won').toEqual(['134', '266']);
});

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

  await page.locator('.hb-act-bet').click();
  const track = (await page.locator('.hb-track').boundingBox())!;
  expect(track.x, 'the sweep runs up the near edge').toBeLessThan(acts.x + acts.width / 2);
});

/* The wide band has no sweep. A mouse gets six sizes in one row over the
   button that sends one: **a box says its amount and nothing else**, pressing
   it loads that amount into the button, and the button is what sends. A box
   that would say a number another box already says is drawn blank and
   disabled rather than dropped, so the keys stay put. */
test('the wide band raises from six stack sizes over one button', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await expect(page.locator('.hb-track')).toHaveCount(0);
  const sizes = page.locator('.hb-sizes .hb-size');
  const amount = (i: number) => sizes.nth(i).locator('.s-v');
  await expect(sizes).toHaveCount(6);
  /* Fractions of what this seat has, which is 186 all in: a half is 93 and
     three quarters is 140. The box says the amount and its key, and nothing
     about the pot or what the size is called. */
  await expect(amount(0)).toHaveText('86');
  await expect(amount(3)).toHaveText('93');
  await expect(amount(4)).toHaveText('140');
  await expect(amount(5)).toHaveText('186');
  await expect(sizes.nth(3).locator('.s-k')).toHaveText('4');

  /* One row, with a gap between neighbours rather than a shared edge. */
  const first = (await sizes.nth(0).boundingBox())!;
  const second = (await sizes.nth(1).boundingBox())!;
  const last = (await sizes.nth(5).boundingBox())!;
  expect(second.x, 'a gap between boxes').toBeGreaterThan(first.x + first.width + 2);
  expect(Math.round(last.y), 'all six on one row').toBe(Math.round(first.y));

  /* A tenth and a quarter of this stack are both under the minimum raise, so
     they say what Min says and go blank. */
  await expect(sizes.nth(1)).toBeDisabled();
  await expect(sizes.nth(2)).toBeDisabled();
  await expect(sizes.nth(1)).toHaveText('');
  await expect(sizes.nth(1)).toHaveAttribute('aria-hidden', 'true');
  await expect(sizes.nth(3)).toBeEnabled();

  /* The same six before the flop as after it, off the same stack. */
  await page.goto('/m/mock?v2=1&step=0');
  await waitForBand(page, 'turn');
  await expect(amount(1)).toHaveText('20');
  await expect(amount(2)).toHaveText('50');
  await expect(amount(5)).toHaveText('200');

  /* Pressing a box loads it and sends nothing: the decision opens on Min, and
     the mock, which advances a step on any action, has not moved. */
  const bet = page.locator('.hb-bet');
  await expect(bet).toHaveText('Raise to 4');
  const before = await page.locator('.devnote').innerText();
  await sizes.nth(3).click();
  await expect(bet).toHaveText('Raise to 100');
  await expect(sizes.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  expect(await page.locator('.devnote').innerText()).toBe(before);

  /* And the button sends it. */
  await bet.click();
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);
});

/* A size of your own is a field in the sizes' own box, reached with `r`: it
   starts from the quarter, the button under it says what it will send, and
   Enter sends. Escape puts the six back. */
test('the wide band takes a size of its own', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await page.keyboard.press('r');
  const field = page.locator('.hb-custom-field .input');
  await expect(field).toBeFocused();
  await expect(page.locator('.hb-sizes')).toHaveCount(0);
  /* A quarter of this stack is under the minimum, so the sizer starts from
     the first size above it that is its own number. */
  await expect(field).toHaveValue('93');

  await page.keyboard.press('Escape');
  await expect(page.locator('.hb-sizes')).toBeVisible();

  await page.keyboard.press('r');
  await field.fill('120');
  await expect(page.locator('.hb-bet')).toHaveText('Raise to 120');

  /* Out of range is clamped into the field and not sent. */
  const before = await page.locator('.devnote').innerText();
  await field.fill('9999');
  await field.press('Enter');
  await expect(field).toHaveValue('186');
  await page.waitForTimeout(300);
  expect(await page.locator('.devnote').innerText()).toBe(before);

  await field.press('Enter');
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);
});

/* The band answers to the dock's keys, because they are the dock's handlers.
   A number key does what pressing its box does, which is load that size into
   the button rather than send it: the keys choose and Enter sends, so a
   mistyped digit costs nothing. F folds outright. */
test('the wide band takes the same keys the dock does', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=9');
  await waitForBand(page, 'turn');

  await expect(page.locator('.hb-keys')).toBeVisible();
  const bet = page.locator('.hb-bet');
  const before = await page.locator('.devnote').innerText();

  /* 5 is three quarters of the stack. It loads and sends nothing. */
  await page.keyboard.press('5');
  await expect(bet).toHaveText('Raise to 140');
  await page.waitForTimeout(300);
  expect(await page.locator('.devnote').innerText()).toBe(before);

  /* A key whose box is blank does nothing either: 2 is a tenth of this stack,
     which is the minimum's number. */
  await page.keyboard.press('2');
  await expect(bet).toHaveText('Raise to 140');

  /* 6 is the all in at the end of the row, and Enter sends what is loaded. */
  await page.keyboard.press('6');
  await expect(bet).toHaveText('All in 186');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.locator('.devnote').innerText(), { timeout: 10_000 })
    .not.toBe(before);

  /* And F folds outright. From a fresh decision rather than the one the key
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
