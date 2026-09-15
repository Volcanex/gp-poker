import { expect, test } from '@playwright/test';
import { stubApi } from './table.ts';

/* "Chips should appear in other players pot before the next round starts not
   after" (g-admin g7hfddbc, and d62s9bgx two days later). The engine deals the
   next street inside the action that closes the betting, so one view of the
   wire carries both the caller's chips and the flop and the pot was still
   ticking up as the cards landed. `?collect=1` is that view, which the
   ordinary script does not have: it splits the call and the flop over two
   steps, which is the felt everybody wanted rather than the one the server
   sends.

   This watches the clock rather than taking a picture, because the thing under
   test is an order of events and not a box. See `../src/table/CLAUDE.md`. */

/* The beat is 400 ms. Asserted well under it because the assertion is
   "these are two events and not one": without the hold the gap is a frame. */
const APART_MS = 200;

interface Moment { pot: string; cards: number; t: number }

test('the pot collects before the street deals', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?collect=1&v2=1');
  await page.locator('.board').waitFor({ timeout: 60_000 });

  /* Sampled in the page: a round trip per reading would put the harness's own
     latency inside the number being measured. */
  const samples: Moment[] = await page.evaluate(() => new Promise((done) => {
    const out: Moment[] = [];
    const t0 = performance.now();
    const id = setInterval(() => {
      out.push({
        pot: document.querySelector('.pot .v')?.textContent ?? '',
        cards: document.querySelectorAll('.board .pcard:not([data-empty])').length,
        t: performance.now() - t0,
      });
      if (performance.now() - t0 > 9_000) {
        clearInterval(id);
        done(out);
      }
    }, 25);
  }));

  const firstAt = (ok: (m: Moment) => boolean, from = 0): number => {
    const hit = samples.find((m) => m.t > from && ok(m));
    expect(hit, 'the script reached this moment inside the sampling window').toBeTruthy();
    return (hit as Moment).t;
  };

  /* The call that closes the preflop betting takes the pot to 12 and deals the
     flop in the same view. The chips have to be in the middle first. */
  const potAt12 = firstAt((m) => m.pot === '12');
  const flopAt = firstAt((m) => m.cards >= 3);
  expect(flopAt - potAt12, 'the flop waits for the pot').toBeGreaterThan(APART_MS);

  // And again into the turn, off a bet and a call rather than the blinds.
  const potAt28 = firstAt((m) => m.pot === '28', flopAt);
  const turnAt = firstAt((m) => m.cards >= 4, flopAt);
  expect(turnAt - potAt28, 'the turn waits for the pot').toBeGreaterThan(APART_MS);
});
