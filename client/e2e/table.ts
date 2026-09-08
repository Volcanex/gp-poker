import type { Locator, Page } from '@playwright/test';

/* The mock table needs no server, but three pages ask the API who you are
   before they draw anything. Stubbing that here rather than leaning on a dev
   server is what makes a run reproducible: the real endpoint mints a fresh
   guest with a fresh name every time, and a name nobody chose is a name that
   changes every baseline. */
export const ME = {
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
/* The feed, the counters, the watch page and the practice card. Fixtures rather
   than an empty 404 for each, so the baselines show the pages populated: an
   offline state is a state worth one screenshot, not the only one anybody ever
   sees.

   Times are offsets from now, not fixed dates. The feed prints "2h ago" and a
   pinned timestamp would read differently every day and turn into a date after
   a week, so each one sits in the middle of its bucket and stays there. */
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RECENT = [
  {
    id: 'qtabzev9',
    mode: 'heads-up',
    rated: true,
    practice: false,
    handsPlayed: 25,
    finishedAt: ago(2.5 * HOUR),
    players: [
      { name: 'riverrat', bot: false, place: 1, ratingBefore: 1623, ratingAfter: 1642 },
      { name: 'kestrel', bot: false, place: 2, ratingBefore: 1537, ratingAfter: 1518 },
    ],
  },
  {
    id: 'zqmny5hf',
    mode: 'six-max',
    rated: false,
    practice: true,
    handsPlayed: 31,
    finishedAt: ago(3.5 * DAY),
    players: [
      { name: 'quarrel', bot: false, place: 1, ratingBefore: null, ratingAfter: null },
      { name: 'BriskQuarry', bot: true, place: 2, ratingBefore: null, ratingAfter: null },
      { name: 'FeistyGale', bot: true, place: 3, ratingBefore: null, ratingAfter: null },
    ],
  },
];

const STATS = {
  online: 12,
  inQueue: 2,
  playing: 6,
  matchesToday: 48,
  handsTotal: 9312,
  playersTotal: { registered: 34, guest: 502 },
};

const LIVE = [
  {
    id: 'qtabzev9',
    mode: 'heads-up',
    rated: true,
    practice: false,
    hand: 7,
    players: [
      { name: 'riverrat', bot: false, rating: 1642 },
      { name: 'quarrel', bot: false, rating: 1560 },
    ],
    spectators: 3,
    startedAt: ago(12.5 * MINUTE),
  },
];

/* Three to a level, the five levels the server ships, so the practice card's
   picker has every step in it and the ladder has a roster to draw. */
const BOT_LEVELS = [
  { level: 1, levelName: 'Loose and passive', description: 'Level 1: loose and passive, calls almost everything' },
  { level: 2, levelName: 'Loose', description: 'Level 2: loose, raises only with strong hands' },
  { level: 3, levelName: 'Tight and passive', description: 'Level 3: tight and passive, folds a lot' },
  { level: 4, levelName: 'Solid', description: 'Level 4: solid, bets its good hands' },
  { level: 5, levelName: 'Sharp', description: 'Level 5: sharp, punishes a passive table' },
];

const BOT_NAMES = [
  'BriskQuarry', 'FeistyGale', 'CalmPier',
  'RedTiger', 'OpalChipmunk', 'GleefulCottage',
  'StealthyCyclone', 'TawnyFjord', 'CheerySled',
  'ShadyHarp', 'RegalCloud', 'BreezyWhirlwind',
  'JauntySwan', 'SmokySeal', 'RoyalZinc',
];

const BOTS = BOT_NAMES.map((name, i) => {
  const level = BOT_LEVELS[Math.floor(i / 3)];
  const rating = 1320 + level.level * 60 + (i % 3) * 14;
  return {
    id: `bot-${i + 1}`,
    name,
    level: level.level,
    levelName: level.levelName,
    description: level.description,
    ratings: {
      'heads-up': { rating, matches: 40 - i },
      'six-max': { rating: rating - 40, matches: 12 - (i % 6) },
    },
    ladderMatches: i % 4,
  };
});

/* The two link-landing pages: what somebody sees when a friend sends them a
   table. Both are shown from the visitor's side rather than the host's, because
   that is the side a link is for: an invite from riverrat that kestrel can take,
   and a lobby with three of its six chairs filled and none of them kestrel's. */
const summary = (id: string, name: string, rating: number, rd: number) => ({
  id, name, guest: false, bot: false, rating, rd, provisional: false,
  ratings: {
    'heads-up': { rating, rd, provisional: false, peak: rating, peakAt: null, matches: 90, wins: 50, losses: 39, draws: 1 },
    'six-max': { rating: rating - 30, rd: rd + 6, provisional: false, peak: rating, peakAt: null, matches: 24, wins: 6, losses: 18, draws: 0 },
  },
});

const RIVERRAT = summary('u-riverrat', 'riverrat', 1642, 61);

const CHALLENGE = {
  id: 'ch-open',
  mode: 'heads-up',
  rated: true,
  status: 'open',
  creator: RIVERRAT,
  matchId: null,
  createdAt: ago(6 * MINUTE),
  expiresAt: new Date(Date.now() + 20 * HOUR).toISOString(),
};

const HOME_GAME = {
  id: 'hg-open',
  host: RIVERRAT,
  seats: [
    { uid: 'u-riverrat', name: 'riverrat', rating: 1612, host: true },
    { uid: 'u-quarrel', name: 'quarrel', rating: 1530, host: false },
    { uid: 'u-dredger', name: 'dredger', rating: 1447, host: false },
  ],
  players: 6,
  rated: true,
  botLevel: 4,
  status: 'open',
  matchId: null,
  createdAt: ago(9 * MINUTE),
  expiresAt: new Date(Date.now() + 20 * HOUR).toISOString(),
};

export async function stubApi(page: Page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'not found' } }));
  await page.route('**/api/leaderboard*', (route) => route.fulfill({ json: LEADERBOARD }));
  await page.route('**/api/recent*', (route) => route.fulfill({ json: RECENT }));
  await page.route('**/api/stats', (route) => route.fulfill({ json: STATS }));
  await page.route('**/api/live', (route) => route.fulfill({ json: LIVE }));
  await page.route('**/api/bots', (route) => route.fulfill({ json: BOTS }));
  await page.route('**/api/challenges/*', (route) => route.fulfill({ json: CHALLENGE }));
  await page.route('**/api/home-games/*', (route) => route.fulfill({ json: HOME_GAME }));
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
