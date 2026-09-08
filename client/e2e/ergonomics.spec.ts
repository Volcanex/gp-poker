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

/* The ring, at the widths it is actually drawn at. Two promises: a generated
   name fits, and nothing on the felt sits on anything else. Both were broken
   at once on a live six-max table and neither was measured, because the mock
   used short lowercase names and the suite only ever saw those. */
test.describe('the ring', () => {
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
        const seats = [...document.querySelectorAll('.seat')].map((s) => s.getBoundingClientRect());
        const names = [...document.querySelectorAll('.seat-name')] as HTMLElement[];
        return {
          longest: Math.max(...names.map((n) => n.textContent!.length)),
          cut: names.filter((n) => n.scrollWidth > n.clientWidth).map((n) => n.textContent),
          onBoard: seats.filter((r) => hit(r, rect('.board'))).length,
          onPot: seats.filter((r) => hit(r, rect('.pot'))).length,
          /* Every badge stays on the name's own line rather than wrapping
             under it, which is what a name that grew used to cause. */
          lines: [...document.querySelectorAll('.seat-line')]
            .map((l) => Math.round(l.getBoundingClientRect().height)),
        };
      });

      expect(seen.longest, 'the mock deals in names the length people get').toBeGreaterThanOrEqual(15);
      expect(seen.cut, 'names truncated at this width').toEqual([]);
      expect(seen.onBoard, 'seats sitting on the board').toBe(0);
      expect(seen.onPot, 'seats sitting on the pot').toBe(0);
      expect(new Set(seen.lines).size, 'a name line that wrapped').toBe(1);
    });
  }

  /* Where a bet chip may sit: beside its own seat, and nowhere near the pot
     figure, the board, another seat or another bet. The ellipse between the
     seats and the middle that these used to ride ran out of room the moment
     the seats grew wide enough to hold a name, and the chips ended up on the
     pot. Four steps of the script, because how many seats have bet in front of
     them is the thing that changes. */
  for (const width of [768, 1280, 1920]) {
    test(`keeps every bet chip clear of everything at ${width}`, async ({ page }) => {
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
          const bets = [...document.querySelectorAll('.seat-bet .bet-chip')]
            .map((e) => e.getBoundingClientRect());
          const seats = [...document.querySelectorAll('.seat')].map((e) => e.getBoundingClientRect());
          return {
            bets: bets.length,
            onPot: bets.filter((r) => hit(r, box('.pot'))).length,
            onBoard: bets.filter((r) => hit(r, box('.board'))).length,
            onSeat: bets.filter((r) => seats.some((s) => hit(r, s))).length,
            onBet: bets.filter((r, i) => bets.some((o, j) => j !== i && hit(r, o))).length,
          };
        });

        expect(seen.bets, `step ${step} has bets to check`).toBeGreaterThan(0);
        expect(seen.onPot, `step ${step}: a chip on the pot`).toBe(0);
        expect(seen.onBoard, `step ${step}: a chip on the board`).toBe(0);
        expect(seen.onSeat, `step ${step}: a chip on a seat`).toBe(0);
        expect(seen.onBet, `step ${step}: two chips on each other`).toBe(0);
      }
    });
  }

  /* The dealer button and the bot badge share a seat on a practice table, and
     on a portrait seat both of them are hanging off a corner. Measured against
     rendered text rather than element boxes: a seat's stack row is full width
     and mostly empty, so overlapping its box means nothing. */
  test('never lands the dealer button on anything at 390', async ({ page }) => {
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
          if ((n.parentElement as Element).closest('.btn-marker')) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width && r.height) out.push(r);
        }
        return out;
      };
      const clashes: string[] = [];
      let buttons = 0;
      for (const seat of document.querySelectorAll('.seat')) {
        const mark = seat.querySelector('.btn-marker:not([data-off])');
        if (!mark) continue;
        buttons += 1;
        const box = mark.getBoundingClientRect();
        if (ink(seat).some((r) => hit(box, r))) {
          clashes.push(seat.querySelector('.seat-name')!.textContent!);
        }
      }
      return { buttons, clashes, bots: document.querySelectorAll('.seat-bot').length };
    });

    expect(seen.buttons, 'somebody is on the button').toBe(1);
    expect(seen.bots, 'and the table has bots on it, as a practice table does')
      .toBeGreaterThan(0);
    expect(seen.clashes, 'seats where the button landed on something').toEqual([]);
  });
});
