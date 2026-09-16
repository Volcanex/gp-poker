import { expect, test } from '@playwright/test';
import { stubApi } from './table.ts';

/* Thumb reach and target size on the screen most hands are played on, plus the
   sizing model: the typed amount is the source of truth, presets write into it,
   and a number outside the legal range is clamped where you can see it rather
   than quietly turned into something else on the way to the server. */

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every dock control is big enough to hit', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    /* Visible controls only: the slider is in the markup at every width and
       display:none on a phone, where presets and the field replace it. */
    const controls = page.locator('.dock button:visible, .dock input:visible');
    const n = await controls.count();
    expect(n).toBeGreaterThan(6);
    for (let i = 0; i < n; i += 1) {
      const el = controls.nth(i);
      const box = await el.boundingBox();
      const label = (await el.getAttribute('aria-label')) ?? (await el.innerText());
      expect(Math.round(box!.height), `${label} is tall enough to hit`).toBeGreaterThanOrEqual(24);
    }
  });

  test('the primary action is full width and under the thumb', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    const primary = page.locator('.dock-acts .btn[data-primary]');
    await expect(primary).toBeVisible();
    const box = (await primary.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y, 'in the bottom quarter of the screen').toBeGreaterThanOrEqual(844 * 0.75);
    /* It has the row to itself, which is what "full width" means here. */
    const dock = (await page.locator('.dock').boundingBox())!;
    expect(box.width).toBeGreaterThan(dock.width * 0.8);
  });

  test('the slider is dropped and the keypad field is not', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');
    await expect(page.locator('.dock-slider')).toBeHidden();
    await expect(page.locator('.dock-field .input')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.locator('.dock-keys')).toBeHidden();
  });
});

test.describe('sizing', () => {
  test('a preset writes its number into the field and lights up', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    const field = page.locator('.dock-field .input');
    await expect(field).toHaveValue('86'); // the minimum, where every decision starts

    const pot = page.locator('.dock-presets .preset', { hasText: 'Pot' });
    await pot.click();
    await expect(field).toHaveValue('184');
    await expect(pot).toHaveAttribute('aria-pressed', 'true');

    await field.fill('120');
    await expect(pot).toHaveAttribute('aria-pressed', 'false');
  });

  test('a number outside the range is clamped where you can see it', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    const field = page.locator('.dock-field .input');
    await field.fill('4');
    await field.press('Enter');
    /* The clamp lands in the field, and the mock has not advanced: a size you
       did not choose is never sent. */
    await expect(field).toHaveValue('86');
    await expect(page.locator('.dock[data-state="turn"]')).toBeVisible();

    await field.fill('9999');
    await field.press('Enter');
    await expect(field).toHaveValue('186');
  });

  test('the primary button says the number that will be sent', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');
    const field = page.locator('.dock-field .input');
    await field.fill('137');
    await expect(page.locator('.dock-acts .btn[data-primary]')).toHaveText('Raise to 137');
    await field.fill('186');
    await expect(page.locator('.dock-acts .btn[data-primary]')).toHaveText('All in 186');
  });

  test('preflop sizes are multiples of the bet, postflop are pot fractions', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=0');
    await expect(page.locator('.dock-presets .preset')).toHaveText([
      /Min/, /2×/, /2\.5×/, /3×/, /Pot/, /All in/,
    ]);

    await page.goto('/m/mock?step=9');
    await expect(page.locator('.dock-presets .preset')).toHaveText([
      /Min/, /⅓/, /½/, /⅔/, /Pot/, /All in/,
    ]);
  });
});

test.describe('pre-actions', () => {
  test('a pill fires the moment the action reaches you', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock');

    /* Wait until it is somebody else's turn, then arm "call any". The mock
       treats any action as "step forward", so the pill firing shows up as the
       script advancing on its own. */
    await page.locator('.dock[data-state="wait"]').waitFor({ timeout: 30_000 });
    const step = await page.locator('.devnote').innerText();
    await page.locator('.dock-pre .pill', { hasText: 'Call any' }).click();
    await expect(page.locator('.dock-pre .pill[data-on]')).toBeVisible();

    await page.locator('.dock[data-state="turn"]').waitFor({ timeout: 30_000 });
    await expect(page.locator('.devnote')).not.toHaveText(step, { timeout: 5_000 });
    await expect(page.locator('.dock-pre .pill[data-on]')).toHaveCount(0);
  });
});

/* The two columns, at the widths they are actually drawn at. Two promises: a
   generated name fits, and nothing on the felt sits on anything else. Both
   were broken at once on a live six-max table and neither was measured,
   because the mock used short lowercase names and the suite only ever saw
   those. */
test.describe('the columns', () => {
  for (const width of [768, 1280, 1920]) {
    test(`shows a whole name and keeps its seats off the board at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await stubApi(page);
      await page.goto('/m/mock?mode=six-max&step=2');
      await expect(page.locator('.seat').first()).toBeVisible();

      const seen = await page.evaluate(() => {
        const hit = (a: DOMRect, b: DOMRect) => !(
          a.right < b.left + 1 || a.left > b.right - 1
          || a.bottom < b.top + 1 || a.top > b.bottom - 1);
        const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        /* The felt's copy of your own seat is in the markup and not drawn:
           the band is that seat. */
        const drawn = [...document.querySelectorAll('.seat')].filter((e) => e.getClientRects().length > 0);
        const seats = drawn.map((s) => s.getBoundingClientRect());
        const names = drawn.map((s) => s.querySelector('.seat-name') as HTMLElement);
        return {
          longest: Math.max(...names.map((n) => n.textContent!.length)),
          cut: names.filter((n) => n.scrollWidth > n.clientWidth).map((n) => n.textContent),
          onBoard: seats.filter((r) => hit(r, rect('.board'))).length,
          onStats: seats.filter((r) => hit(r, rect('.stats'))).length,
          /* Every badge stays on the name's own line rather than wrapping
             under it, which is what a name that grew used to cause. */
          lines: drawn.map((s) => Math.round(s.querySelector('.seat-line')!.getBoundingClientRect().height)),
        };
      });

      expect(seen.longest, 'the mock deals in names the length people get').toBeGreaterThanOrEqual(15);
      expect(seen.cut, 'names truncated at this width').toEqual([]);
      expect(seen.onBoard, 'seats sitting on the board').toBe(0);
      expect(seen.onStats, 'seats sitting on the stats box').toBe(0);
      expect(new Set(seen.lines).size, 'a name line that wrapped').toBe(1);
    });
  }

  /* Nothing on the felt touches anything else, and the action square is a
     square the seat's height, at four steps of the script: how many seats
     have a word in front of them is the thing that changes. */
  for (const width of [768, 1280, 1920]) {
    test(`keeps every seat clear of everything at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await stubApi(page);

      for (const step of [0, 1, 2, 5]) {
        await page.goto(`/m/mock?mode=six-max&step=${step}`);
        await expect(page.locator('.seat').first()).toBeVisible();
        await page.waitForTimeout(700);

        const seen = await page.evaluate(() => {
          const hit = (a: DOMRect, b: DOMRect) => !(
            a.right < b.left + 1 || a.left > b.right - 1
            || a.bottom < b.top + 1 || a.top > b.bottom - 1);
          const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
          const seats = [...document.querySelectorAll('.seat')]
            .filter((e) => e.getClientRects().length > 0)
            .map((e) => e.getBoundingClientRect());
          const squares = [...document.querySelectorAll('.seat-act')]
            .filter((e) => e.getClientRects().length > 0)
            .map((e) => e.getBoundingClientRect());
          return {
            seats: seats.length,
            worded: document.querySelectorAll('.seat-act:not([data-empty])').length,
            onBoard: seats.filter((r) => hit(r, box('.board'))).length,
            onStats: seats.filter((r) => hit(r, box('.stats'))).length,
            onSeat: seats.filter((r, i) => seats.some((o, j) => j !== i && hit(r, o))).length,
            oblong: squares.filter((r) => Math.abs(r.width - r.height) > 1).length,
          };
        });

        expect(seen.seats, `step ${step} has seats to check`).toBeGreaterThan(0);
        expect(seen.worded, `step ${step} has a word in a square`).toBeGreaterThan(0);
        expect(seen.onBoard, `step ${step}: a seat on the board`).toBe(0);
        expect(seen.onStats, `step ${step}: a seat on the stats box`).toBe(0);
        expect(seen.onSeat, `step ${step}: two seats on each other`).toBe(0);
        expect(seen.oblong, `step ${step}: a square that is not one`).toBe(0);
      }
    });
  }

  /* The dealer button, the blind beside it and the bot badge share a seat on a
     practice table, and on a portrait seat all of them are hanging off a
     corner. Measured against rendered text rather than element boxes: a seat's
     stack row is full width and mostly empty, so overlapping its box means
     nothing. */
  test('never lands the dealer button or the blind on anything at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubApi(page);
    await page.goto('/m/mock?mode=six-max&step=1');
    await expect(page.locator('.seat').first()).toBeVisible();

    const seen = await page.evaluate(() => {
      const hit = (a: DOMRect, b: DOMRect) => !(
        a.right < b.left + 1 || a.left > b.right - 1
        || a.bottom < b.top + 1 || a.top > b.bottom - 1);
      const ink = (root: Element) => {
        const out: DOMRect[] = [];
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.nodeValue!.trim()) continue;
          if ((n.parentElement as Element).closest('.btn-marker, .blind-marker')) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width && r.height) out.push(r);
        }
        return out;
      };
      const clashes: string[] = [];
      let buttons = 0;
      let blinds = 0;
      for (const seat of document.querySelectorAll('.seat')) {
        const marks = [...seat.querySelectorAll('.btn-marker:not([data-off]), .blind-marker:not([data-off])')];
        buttons += seat.querySelectorAll('.btn-marker:not([data-off])').length;
        blinds += seat.querySelectorAll('.blind-marker:not([data-off])').length;
        for (const mark of marks) {
          const box = mark.getBoundingClientRect();
          /* Each other, as well as everything else: the two stand side by
             side in the corner and the seat that is both is heads-up. */
          const others = marks.filter((m) => m !== mark).map((m) => m.getBoundingClientRect());
          if ([...ink(seat), ...others].some((r) => hit(box, r))) {
            clashes.push(`${seat.querySelector('.seat-name')!.textContent!} ${mark.className}`);
          }
        }
      }
      return { buttons, blinds, clashes, bots: document.querySelectorAll('.seat-bot').length };
    });

    expect(seen.buttons, 'somebody is on the button').toBe(1);
    /* Six-max, and your own seat is the band's: one of the two blinds is
       yours as often as not, so the felt draws one or two of them. */
    expect(seen.blinds, 'and the blinds are marked').toBeGreaterThan(0);
    expect(seen.bots, 'and the table has bots on it, as a practice table does')
      .toBeGreaterThan(0);
    expect(seen.clashes, 'markers that landed on something').toEqual([]);
  });
});
