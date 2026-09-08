import type { Locator, Page } from '@playwright/test';

/* The mock table needs no server, but three pages ask the API who you are
   before they draw anything. Stubbing that here rather than leaning on a dev
   server is what makes a run reproducible: the real endpoint mints a fresh
   guest with a fresh name every time, and a name nobody chose is a name that
   changes every baseline. */
const ME = {
  id: 'u-e2e',
  name: 'kestrel',
  guest: true,
  bot: false,
  rating: 1518,
  rd: 84,
  provisional: false,
  peak: 1552,
  matches: 40,
  wins: 22,
  losses: 17,
  draws: 1,
  ratings: {
    'heads-up': {
      rating: 1518, rd: 84, provisional: false, peak: 1552,
      peakAt: '2026-08-01T00:00:00.000Z', matches: 40, wins: 22, losses: 17, draws: 1,
    },
    'six-max': {
      rating: 1500, rd: 350, provisional: true, peak: 1500,
      peakAt: null, matches: 0, wins: 0, losses: 0, draws: 0,
    },
  },
};

const LEADERBOARD = [
  { name: 'riverrat', rating: 1642, rd: 61, matches: 210, peak: 1660 },
  { name: 'quarrel', rating: 1560, rd: 62, matches: 96, peak: 1571 },
  { name: 'kestrel', rating: 1518, rd: 84, matches: 40, peak: 1552 },
];

/* **The catch-all goes first.** Playwright runs the last matching handler it
   was given, so a catch-all registered after the fixtures swallows them: this
   stub served 404 to everything for its whole life, and the two payloads below
   never reached a page. It is why the accessibility run never saw a logged-in
   top bar, which is exactly where the contrast defect was hiding. */
export async function stubApi(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'not found' } }));
  await page.route('**/api/leaderboard*', (route) => route.fulfill({ json: LEADERBOARD }));
  await page.route('**/api/me', (route) => route.fulfill({ json: ME }));
}

/* An explicit theme, stored the way g stores it: g-ui reads its own key at load
   and writes the attribute itself, so setting the attribute alone is undone a
   moment later. "system" is not a thing a baseline can pin. */
export async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    localStorage.setItem('g-theme', t as string);
    document.documentElement.setAttribute('data-theme', t as string);
  }, theme);
}

/* What cannot be pinned to a pixel: a clock that depletes, a countdown, a pot
   mid-count, and the dev caption under the mock. Everything else is compared. */
export function masks(page: Page): Locator[] {
  return [
    page.locator('.pot .v'),
    page.locator('.turn-bar'),
    page.locator('.turn-secs'),
    page.locator('.dock-result .badge'),
  ];
}

/* The regions whose boxes must not move between dock states. The felt and the
   dock are the whole point; the board, the pot and your own seat are there
   because a felt that keeps its box can still shuffle its contents. */
export const FOOTPRINT = ['.hand-head', '.felt', '.board', '.pot', '.seat:has(.seat-you)', '.dock'];

/* The same regions for somebody with no seat of their own: the bottom slot is
   seat 0's when nobody is sitting in it for you. */
export const WATCHING_FOOTPRINT = [
  '.hand-head', '.felt', '.board', '.pot', '.pos[data-half="bottom"] .seat', '.dock',
];

export interface Box { x: number; y: number; width: number; height: number }

export async function boxes(page: Page, which = FOOTPRINT): Promise<Record<string, Box>> {
  const out: Record<string, Box> = {};
  for (const sel of which) {
    const box = await page.locator(sel).first().boundingBox();
    if (!box) throw new Error(`${sel} is not on the page`);
    out[sel] = {
      x: Math.round(box.x), y: Math.round(box.y),
      width: Math.round(box.width), height: Math.round(box.height),
    };
  }
  return out;
}

/* Layout shift, accumulated from the moment the table has settled rather than
   from navigation: the first paint is not a shift, but a webfont swapping in
   during it is, and that is the browser's business, not the table's. */
export async function watchLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { value: number; at: number }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as
        { value: number; hadRecentInput: boolean; startTime: number }[]) {
        if (!e.hadRecentInput) w.__shifts.push({ value: e.value, at: e.startTime });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

export async function markSettled(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => performance.now());
}

export async function shiftSince(page: Page, from: number): Promise<number> {
  return page.evaluate((t) => {
    const w = window as unknown as { __shifts: { value: number; at: number }[] };
    return w.__shifts.filter((s) => s.at >= t).reduce((n, s) => n + s.value, 0);
  }, from);
}

/* The mock advances itself on a timer. Waiting for a dock state is how a test
   says "when the hand reaches this point", without pinning step numbers that
   would go stale the first time the script gains a beat. */
export async function waitForDock(page: Page, state: 'wait' | 'turn' | 'over', timeout = 45_000) {
  await page.locator(`.dock[data-state="${state}"]`).waitFor({ state: 'visible', timeout });
}

export const HERO = '.seat:has(.seat-you)';
