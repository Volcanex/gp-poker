import { expect, test } from '@playwright/test';
import { markSettled, shiftSince, stubApi, watchLayoutShift } from './table.ts';

/* Pages slide in on load (see ui/enter.tsx), and a rect read mid-slide is a
   rect with a transform in it. Every measurement here waits for the page's
   animations to finish first. */
async function settled(page: import('@playwright/test').Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
}


/* Hovering a square must not move the square. Every page in the learn, tools
   and puzzles section draws a 13 by 13 grid the pointer is meant to sweep, and
   two of them read the cell under it out into a panel beside the grid. If that
   panel sizes to what it is reading, the page reflows on every pointer move:
   the cell shifts out from under the pointer, the cell that took its place
   reports itself instead, and the two states flicker against each other. So the
   rule this file pins is the table's own: on hover nothing in the flow changes
   size, and the layout shift for the whole gesture is nought. */

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const HANDS: string[] = [];
for (let r = 0; r < 13; r++) {
  for (let c = 0; c < 13; c++) {
    HANDS.push(r === c ? `${RANKS[r]}${RANKS[r]}` : r < c ? `${RANKS[r]}${RANKS[c]}s` : `${RANKS[c]}${RANKS[r]}o`);
  }
}

/* A book with all three shapes of row in it, because the panel's three states
   are what the height has to survive: a hand with a full set of rates, a hand
   played once, and a hand nobody has been dealt. A uniform fixture would pass
   this test without testing anything. */
const BOOK = {
  mode: 'heads-up',
  position: 'button',
  facing: 'unopened',
  players: 'all',
  minHands: 50,
  sample: { hands: 4200, matches: 180 },
  since: '2026-06-01T00:00:00.000Z',
  totals: { hands: 4200, raise: 62, call: 18, fold: 20, netBb: 0.12 },
  hands: HANDS.map((hand, i) =>
    i % 7 === 0
      ? { hand, hands: 0, raise: null, call: null, fold: null, netBb: null }
      : {
          hand,
          hands: i % 5 === 0 ? 1 : 10 + (i % 40),
          raise: (i * 7) % 101,
          call: (i * 3) % 40,
          fold: (i * 11) % 60,
          netBb: ((i % 21) - 10) / 5,
        },
  ),
};

interface Page {
  name: string;
  url: string;
  cells: string;
  /* The blocks whose boxes must not move: the grid itself and whatever reads
     out of it. */
  blocks: string[];
  ready?: (page: import('@playwright/test').Page) => Promise<void>;
}

const PAGES: Page[] = [
  {
    name: 'the ranges lesson',
    url: '/learn/ranges',
    cells: '.range-cell',
    blocks: ['main', '.figure', '.range-grid', '.legend'],
  },
  {
    name: 'the range explorer',
    url: '/tools/ranges',
    cells: '.hand-grid .cell',
    blocks: ['main', '.tools-split', '.hand-grid', '.range-meta'],
  },
  {
    name: 'the opening explorer',
    url: '/tools/explorer',
    cells: '.hand-grid .cell',
    blocks: ['main', '.tools-split', '.hand-grid', '.ex-legend', 'section[aria-label="One hand"]'],
  },
  {
    name: 'the preflop puzzle',
    url: '/puzzles/preflop',
    cells: '.chart-cell',
    blocks: ['main', '.chart-grid', '.chart-legend'],
    /* The chart is only drawn once the spot has been answered. */
    ready: async (page) => {
      await page.locator('.row .btn').first().click();
      await page.locator('.chart-grid').waitFor();
      await settled(page);
    },
  },
];

/* A corner, the centre and an edge: the three cells whose readouts differ most,
   since the corners are the extremes of the ranking and the middle is where the
   chart's regions meet. */
const PICKS: [string, number][] = [['the corner', 0], ['the centre', 84], ['an edge', 12]];

function rect(page: import('@playwright/test').Page, sel: string, index = 0) {
  return page.evaluate(
    ([s, i]) => {
      const el = document.querySelectorAll(s as string)[i as number];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: +(r.x + window.scrollX).toFixed(2),
        y: +(r.y + window.scrollY).toFixed(2),
        width: +r.width.toFixed(2),
        height: +r.height.toFixed(2),
      };
    },
    [sel, index] as const,
  );
}

for (const target of PAGES) {
  test(`hovering a square does not move it on ${target.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await stubApi(page);
    await page.route('**/api/explorer*', (route) => route.fulfill({ json: BOOK }));
    await watchLayoutShift(page);
    await page.goto(target.url);
    await page.locator('main').waitFor();
    await target.ready?.(page);
    await page.locator(target.cells).first().waitFor();
    await settled(page);

    const cells = page.locator(target.cells);
    await expect(cells).toHaveCount(169);

    for (const [where, index] of PICKS) {
      /* Park the pointer off every cell first, so each hover is measured from
         the same resting state rather than from the last cell's. */
      await page.mouse.move(4, 4);
      await page.waitForTimeout(150);

      const before: Record<string, unknown> = { cell: await rect(page, target.cells, index) };
      for (const block of target.blocks) before[block] = await rect(page, block);
      const settled = await markSettled(page);

      const box = await cells.nth(index).boundingBox();
      expect(box, `${where} is not on the page`).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.waitForTimeout(300);

      const after: Record<string, unknown> = { cell: await rect(page, target.cells, index) };
      for (const block of target.blocks) after[block] = await rect(page, block);

      expect(after.cell, `${where} moved under the pointer`).toEqual(before.cell);
      for (const block of target.blocks) {
        expect(after[block], `${block} moved while hovering ${where}`).toEqual(before[block]);
      }
      expect(await shiftSince(page, settled), `hovering ${where} shifted the layout`).toBe(0);
    }
  });
}

/* The opening explorer is the one page here whose panel reads the hovered cell
   back, so it gets the sweep as well as the three picks: every one of the 169
   cells, and the panel keeps its box through all of them. */
test('the opening explorer keeps its panel through every cell', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await stubApi(page);
  await page.route('**/api/explorer*', (route) => route.fulfill({ json: BOOK }));
  await page.goto('/tools/explorer');
  await page.locator('.hand-grid .cell').first().waitFor();
  await settled(page);

  const panel = 'section[aria-label="One hand"]';
  const cells = page.locator('.hand-grid .cell');
  const atRest = await rect(page, panel);

  const heights = new Set<number>();
  for (let i = 0; i < 169; i++) {
    const box = await cells.nth(i).boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const now = await rect(page, panel);
    heights.add(now!.height);
    expect(now, `the panel moved while hovering cell ${i}`).toEqual(atRest);
  }
  expect([...heights]).toEqual([atRest!.height]);
});
