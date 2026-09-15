import { expect, test } from '@playwright/test';
import { stubApi } from './table.ts';

/* The narration bar: the felt's own voice along its bottom edge, the way the
   community cards are along its top (g-admin 72dpkt89). It is typed out a
   character at a time, and the three things that can go wrong with a
   typewriter on this screen are all here: it must move the sentence along
   without moving the felt, it must never be caught printing a sentence the
   table has stopped saying, and its slot must be the same height empty as it
   is full.

   The words themselves are unit tested from `../src/test/table.test.ts`; what
   this suite is for is the typing, which has no meaning without a clock. */

/* The band, not the dock: every assertion here is about the felt people
   actually play on (`?v2=1`), where there is no `.dock` to wait for. */
async function waitForBand(page: import('@playwright/test').Page, state: string, timeout = 45_000) {
  await page.locator(`.hero-band[data-state="${state}"]`).waitFor({ state: 'visible', timeout });
}

interface Moment { typed: string; line: string; t: number }

/* Sampled in the page: a round trip per reading would put the harness's own
   latency inside a measurement about 28 ms per character. */
async function sample(page: import('@playwright/test').Page, forMs: number): Promise<Moment[]> {
  return page.evaluate((ms) => new Promise<Moment[]>((done) => {
    const out: Moment[] = [];
    const t0 = performance.now();
    const id = setInterval(() => {
      out.push({
        typed: document.querySelector('.narrate-typed')?.textContent ?? '',
        line: document.querySelector('.narrate-line')?.textContent ?? '',
        t: performance.now() - t0,
      });
      if (performance.now() - t0 > ms) {
        clearInterval(id);
        done(out);
      }
    }, 25);
  }), forMs);
}

test('the line types itself out, and only ever types what the table is saying', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?v2=1');
  await page.locator('.narrate').waitFor({ timeout: 60_000 });

  const samples = await sample(page, 9_000);
  expect(samples.length, 'the sampler ran').toBeGreaterThan(100);

  /* **The characters on screen always belong to the sentence the table is
     saying now.** An implementation that carried its progress from one line
     into the next, or that finished a line the table had moved on from, fails
     here and nowhere else: every other assertion about a typewriter is happy
     with the wrong sentence typed beautifully. */
  for (const m of samples) {
    expect(m.line.startsWith(m.typed), `"${m.typed}" is the start of "${m.line}"`).toBe(true);
  }

  /* It grows. Counted per line, because a line that is replaced halfway is
     not evidence of typing and neither is one that was already whole when the
     sampler arrived. */
  const growth = new Map<string, Set<number>>();
  for (const m of samples) {
    if (m.line === '') continue;
    const seen = growth.get(m.line) ?? new Set<number>();
    seen.add(m.typed.length);
    growth.set(m.line, seen);
  }
  const typedOut = [...growth.entries()].filter(([line, lens]) => lens.size > 3 && lens.has(line.length));
  expect(typedOut.length, 'at least one line was typed out a character at a time and finished').toBeGreaterThan(0);

  /* And at a readable pace: a line of n characters takes about 28 ms each, so
     a whole sentence is the better part of a second rather than a frame. */
  const [line] = typedOut[0];
  const first = samples.find((m) => m.line === line && m.typed.length > 0) as Moment;
  const whole = samples.find((m) => m.line === line && m.typed === line) as Moment;
  expect(whole.t - first.t, `"${line}" was typed rather than pasted`).toBeGreaterThan(line.length * 12);
});

/* **Nothing in the felt may move while the bar types.** Asserted against the
   shift's own sources rather than against the page's total, because the game
   panel over the felt has a shift of its own at this width that predates this
   bar and is nothing to do with it: the stats box is a flex row of keyed
   values, so a reading that gets shorter moves the reading after it. Filed as
   a nearby problem rather than fixed here. */
test('typing moves the sentence along without moving the felt', async ({ page }) => {
  await stubApi(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __felt: { value: number; at: number }[] };
    w.__felt = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as
        { value: number; at: number; startTime: number;
          hadRecentInput: boolean; sources: { node: Node | null }[] }[]) {
        if (e.hadRecentInput) continue;
        const inFelt = (e.sources ?? []).some(
          (s) => s.node instanceof Element && s.node.closest('.felt') != null,
        );
        if (inFelt) w.__felt.push({ value: e.value, at: e.startTime });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/m/mock?v2=1');
  await waitForBand(page, 'turn');
  /* From the moment the table has settled, the way the kit's own counter is:
     the first paint is not a shift, and a face swapping in during it is the
     browser's business rather than this bar's. */
  await page.evaluate(() => document.fonts.ready);
  const from = await page.evaluate(() => performance.now());

  /* Long enough for several lines to be typed, replaced and typed again. */
  await page.waitForTimeout(6_000);
  const inFelt = await page.evaluate((t) => {
    const w = window as unknown as { __felt: { value: number; at: number }[] };
    return w.__felt.filter((s) => s.at >= t).reduce((n, s) => n + s.value, 0);
  }, from);
  expect(inFelt, 'layout shift inside the felt while the bar was typing').toBe(0);
});

test('the slot is the same height empty as it is full', async ({ page }) => {
  await stubApi(page);
  /* Step 2 is the one moment of the script with nothing to say and nothing
     said before it: the caller has called, nobody is acting and the mock was
     frozen here rather than arriving with a line already in hand. */
  await page.goto('/m/mock?v2=1&step=2');
  const empty = await page.locator('.narrate').boundingBox();
  expect(await page.locator('.narrate-line').textContent()).toBe('');

  await page.goto('/m/mock?v2=1&step=9');
  await expect(page.locator('.narrate-line')).toHaveText('kestrel to call 34');
  const full = await page.locator('.narrate').boundingBox();

  expect(Math.round(empty!.height)).toBe(Math.round(full!.height));
  expect(Math.round(empty!.y)).toBe(Math.round(full!.y));
});

/* The table's voice is the third person for everybody, the viewer included.
   The band's decision line directly under it is the one that speaks to you,
   and the two of them saying the same fact in two grammars is what the band's
   own one-line rule was written to stop. */
test('the felt names you and the band talks to you', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?v2=1&step=13');
  await waitForBand(page, 'over');
  await expect(page.locator('.narrate-line')).toHaveText('kestrel wins 132 with flush, king high');
  await expect(page.locator('.hb-line-text')).toHaveText(/^You win 132 with flush, king high/);
});

/* **A reserved slot has to be paid for somewhere.** The bar is 40 px of the
   felt on a desktop and 20 to 24 on a phone, and a phone's felt had none of
   it spare: a six-max table at 414 by 736 filled its felt to the pixel before
   this existed. So the bar shrinks on a short screen and the compact seats
   step down under 660 (`../src/app.css`), and the felt goes on holding a
   whole table without scrolling itself. The detailed reading is not in this
   list: it overflows a short phone by fifty odd pixels without any narration
   at all, which is a defect of its own and older than this bar. */
const SHORT = [
  { w: 390, h: 844 }, { w: 390, h: 667 }, { w: 360, h: 640 }, { w: 414, h: 736 },
];

for (const s of SHORT) {
  test(`a six-max felt still fits a ${s.w} by ${s.h} phone with the bar on it`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await stubApi(page);
    await page.goto('/m/mock?v2=1&mode=six-max&step=0');
    await page.locator('.narrate').waitFor({ timeout: 60_000 });
    const over = await page.evaluate(() => {
      const felt = document.querySelector('.felt') as HTMLElement;
      return felt.scrollHeight - felt.clientHeight;
    });
    expect(over, 'felt height the table overflows by').toBeLessThanOrEqual(0);
  });
}

test.describe('with the motion turned off', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the whole line is there at once', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?v2=1&step=9');
    /* No interval to wait out: the first paint carries the sentence whole. */
    await expect(page.locator('.narrate-typed')).toHaveText('kestrel to call 34');
    await expect(page.locator('.narrate-rest')).toHaveText('');
  });
});
