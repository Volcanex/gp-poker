import { expect, test } from '@playwright/test';
import { masks, setTheme, stubApi } from './table.ts';

/* One picture per state, per width, per theme. The point is not that the table
   looks nice in a baseline: it is that a change to a token, a breakpoint or a
   dock row shows up as a diff on the state it broke rather than as a bug report
   two weeks later.

   The replay page is not here. It draws a hand fetched from the API, and this
   suite deliberately runs without one. */

const WIDTHS = [360, 390, 430, 768, 1366, 1920];
const THEMES = ['dark', 'light'] as const;

interface Shot {
  name: string;
  url: string;
  /* A settings record to stamp before the page loads, for the states that are
     about a setting rather than about a moment in a hand. */
  prefs?: Record<string, unknown>;
  /* Selectors this state cannot pin, on top of the ones every state masks. */
  hides?: string[];
}

const STATES: Shot[] = [
  { name: 'home', url: '/' },
  { name: 'waiting', url: '/m/mock?step=2' },
  { name: 'turn', url: '/m/mock?step=9' },
  { name: 'hand-over', url: '/m/mock?step=13' },
  { name: 'result', url: '/m/mock?step=18' },
  { name: 'six-max', url: '/m/mock?mode=six-max&step=0' },
  { name: 'six-max-over', url: '/m/mock?mode=six-max&step=6' },
  /* The list of tables to watch: the one page whose whole content is the live
     endpoint, so it is worth a picture now that the endpoint has fixtures. */
  { name: 'watch', url: '/watch' },
  /* The profile twice: somebody rated, whose headline carries a peak and a
     place in the field, and somebody who has played nothing, whose headline
     says so rather than printing a rating they never earned. */
  { name: 'profile', url: '/u/kestrel' },
  { name: 'profile-unrated', url: '/u/newcomer' },
  /* The two pages a shared link opens on, from the side that receives it. */
  { name: 'invite', url: '/c/ch-open' },
  { name: 'lobby', url: '/g/hg-open' },
  /* The two settings that change the felt: a four colour deck and an accent
     that is not g's own. Chips are in every state above; this is the one that
     pins their colours against a different accent. */
  {
    name: 'four-colour',
    url: '/m/mock?step=13',
    prefs: { theme: 'dark', accent: 'jade', fourColour: true },
  },
  /* The two grid pages. What a picture of either is for is the heat ramp and
     the rank strips, so the equity panel's numbers, which come off a twenty
     thousand deal sample and land a tenth either way each run, are masked. */
  { name: 'ranges', url: '/tools/ranges', hides: ['.results dd.num'] },
  { name: 'explorer', url: '/tools/explorer' },
];

/* Reduced motion, so a card that is still dealing cannot decide a baseline. */
test.use({ reducedMotion: 'reduce' });

async function shoot(
  page: import('@playwright/test').Page,
  state: Shot,
  width: number,
  theme: 'room' | 'dark' | 'light',
) {
  await page.setViewportSize({ width, height: 900 });
  await stubApi(page);
  await setTheme(page, theme);
  if (state.prefs) {
    await page.addInitScript((p) => {
      localStorage.setItem('ot.prefs', JSON.stringify(p));
    }, { ...state.prefs, theme });
  }
  await page.goto(state.url);
  /* The mock's dev caption is fixed to the corner of the viewport and
     says which step it is on. Hidden rather than masked: a magenta block
     over the dock hides the thing the baseline is for. */
  await page.addStyleTag({ content: '.devnote { display: none !important; }' });
  /* **Every face, not just the ready promise.** The first page in a fresh
     context lays its text out on the metric-matched fallback and swaps the real
     face in afterwards, and `fonts.ready` can resolve either side of that: the
     hand header's Copy link came out 101 px wide on a cold context and 103 on a
     warm one, which is a hundred pixels of diff on a button nobody had touched
     and the reason this suite flaked a handful of shots a run. Loading each
     face and then waiting settles it. A face that cannot be fetched is not
     worth failing a screenshot over. */
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => undefined)));
    await document.fonts.ready;
  });
  /* And every avatar. They are inline SVG data URIs, so they never hit
     the network and it is tempting to assume they are there, but the
     decode is still asynchronous: a shot taken between layout and paint
     differs from one taken after by a few hundred pixels, which is how
     the whole suite started flaking the day the API stub began serving a
     logged-in top bar. */
  await page.evaluate(() => Promise.all(
    [...document.images].map((img) => img.decode().catch(() => undefined)),
  ));
  await page.waitForTimeout(1200);

  await expect(page).toHaveScreenshot(`${state.name}-${width}-${theme}.png`, {
    fullPage: true,
    mask: [...masks(page), ...(state.hides ?? []).map((sel) => page.locator(sel))],
  });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    for (const state of STATES) {
      test(`${state.name} at ${width} in ${theme}`, async ({ page }) => {
        await shoot(page, state, width, theme);
      });
    }
  }
}

/* The games room, the default, on the two pages that are the whole point of
   it: the home page and the v2 felt, phone and desktop. The states above stay
   dark and light, because they pin layout and the room changes only colour. */
const ROOM_STATES: Shot[] = [
  { name: 'home', url: '/' },
  { name: 'turn-v2', url: '/m/mock?v2=1&step=9' },
  { name: 'six-max-v2', url: '/m/mock?v2=1&mode=six-max&step=0' },
];
for (const width of [390, 1366]) {
  for (const state of ROOM_STATES) {
    test(`${state.name} at ${width} in room`, async ({ page }) => {
      await shoot(page, state, width, 'room');
    });
  }
}
