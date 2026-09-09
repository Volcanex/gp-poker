import { expect, test, type Page } from '@playwright/test';
import { ME, setTheme, stubApi } from './table.ts';

/* The picker, the gate and the ready check.

   Two of the three need no server. The third needs a socket, and the one
   thing this suite cannot route is a websocket, so it puts a fake one in
   front of the app instead: `fakeSocket` replaces `window.WebSocket` before
   the bundle loads and hands the test a way to push a server message into the
   page. That is a real test of the client half of the ready check, which is
   the half that lives here; the server half is `server/test/ready.test.ts`. */

test.use({ reducedMotion: 'reduce' });

/* A WebSocket that never talks to anything, with a `push` on the window so a
   test can be the server. It says `hi` on open, because the real socket
   buffers every send until that arrives and a page that never gets one looks
   permanently disconnected. */
async function fakeSocket(page: Page) {
  await page.addInitScript(() => {
    const sent: string[] = [];
    class FakeSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          this.onopen?.();
          this.onmessage?.({
            data: JSON.stringify({
              t: 'hi',
              v: 5,
              u: { id: 'u-e2e', name: 'kestrel', guest: true, bot: false, rating: 1518, rd: 84, provisional: false, ratings: {} },
            }),
          });
        }, 0);
        (window as unknown as { __ws: FakeSocket }).__ws = this;
      }
      send(raw: string) {
        sent.push(raw);
      }
      close() {
        this.readyState = 3;
      }
      push(msg: unknown) {
        this.onmessage?.({ data: JSON.stringify(msg) });
      }
      get sent() {
        return sent;
      }
    }
    (window as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  });
}

/* The socket is opened only once /api/me has answered, so a test that pushes
   the instant the page loads is pushing at nothing. */
const push = async (page: Page, msg: unknown) => {
  await page.waitForFunction(() => (window as unknown as { __ws?: unknown }).__ws !== undefined);
  await page.evaluate((m) => (window as unknown as { __ws: { push: (x: unknown) => void } }).__ws.push(m), msg);
};

const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ws: { sent: string[] } }).__ws.sent);

/* Web Audio cannot be listened to from a test, so the graph is asked instead:
   every buffer source the page starts records the rate it was started at.
   That is enough to prove the ready check's countdown fires once a second and
   climbs, which is the half of it that is not pure arithmetic. */
interface Played {
  rate: number;
  /* The buffer's own length, which is how a test tells one sound from
     another without being able to hear either. */
  seconds: number;
}

async function recordAudio(page: Page, enabled = true) {
  await page.addInitScript(() => {
    const played: Played[] = [];
    (window as unknown as { __played: Played[] }).__played = played;
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const create = Ctor.prototype.createBufferSource;
    Ctor.prototype.createBufferSource = function patched(this: AudioContext) {
      const src = create.call(this);
      const start = src.start.bind(src);
      src.start = ((...args: Parameters<AudioBufferSourceNode['start']>) => {
        played.push({ rate: src.playbackRate.value, seconds: src.buffer?.duration ?? 0 });
        return start(...args);
      }) as AudioBufferSourceNode['start'];
      return src;
    };
  });
  await page.addInitScript((on) => {
    localStorage.setItem('ot.sound', JSON.stringify({ enabled: on, volume: 0.2, pack: 'felt' }));
  }, enabled);
}

const played = (page: Page) =>
  page.evaluate(() => (window as unknown as { __played: Played[] }).__played);

const playedRates = async (page: Page) => (await played(page)).map((p) => p.rate);

const READY = {
  t: 'ready',
  s: 'pending',
  id: 'rc-1',
  mode: 'six-max',
  speed: 'fast',
  rated: true,
  seats: 6,
  humans: 4,
  accepted: 1,
  deadline: 0,
};

test.describe('the play panel', () => {
  test('is one panel with three switchers and one button', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    const panel = page.locator('.play-panel');
    await expect(panel).toBeVisible();
    // Speed, stake and table size, in that order, each a two option switcher.
    const strips = panel.locator('.play-toggles [role="tablist"]');
    await expect(strips).toHaveCount(3);
    await expect(strips.nth(0)).toContainText('Fast');
    await expect(strips.nth(0)).toContainText('Standard');
    await expect(strips.nth(1)).toContainText('Ranked');
    await expect(strips.nth(1)).toContainText('Casual');
    // Six handed is the main game, so it is the first option offered.
    await expect(strips.nth(2).locator('.tab').first()).toHaveText('Six-max');

    // One primary button, verb first. The switchers above it already say
    // what it would deal, so the button names nothing itself.
    const go = panel.locator('.play-go');
    await expect(go).toHaveClass(/btn-lg/);
    await expect(go).toHaveText('Play');
  });

  test('pins the game this player has played most', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    // The stubbed account has forty heads-up matches and no six handed ones,
    // and has chosen nothing, so the panel opens on heads-up.
    await expect(page.locator('.play-go')).toHaveText('Play');
    await expect(page.locator('.player-bar')).toContainText('Heads-up');
    await expect(page.locator('.play-toggles .tab[data-value="standard"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('opens on the last choice rather than on the pin', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.addInitScript(() => {
      localStorage.setItem('ot-play-choice', JSON.stringify({ mode: 'six-max', rated: false, speed: 'fast' }));
    });
    await page.goto('/');

    await expect(page.locator('.play-go')).toHaveText('Play');
    await expect(page.locator('.play-toggles .tab[data-value="fast"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.play-toggles .tab[data-value="casual"]')).toHaveAttribute('aria-selected', 'true');
    // The line under the switchers follows them: fast promises twenty minutes.
    await expect(page.locator('.play-panel')).toContainText('20 minutes');
  });

  test('describes the standard table it would actually deal', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    await expect(page.locator('.play-panel')).toContainText('2 hours');
  });

  test('offers the other ways to play as one line each', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    const ways = page.locator('.play-ways .way-go');
    await expect(ways).toHaveCount(4);
    await expect(ways.nth(0)).toContainText('Practice against bots');
    await expect(ways.nth(1)).toContainText('Hourly arena');
    await expect(ways.nth(2)).toContainText('Play a friend');
    await expect(ways.nth(3)).toContainText('Home game');
    // Closed until asked for: the controls are there, they are not in the way.
    await expect(page.locator('.way-body')).toHaveCount(0);

    await page.getByRole('button', { name: 'Practice against bots' }).click();
    await expect(page.locator('.way[data-open] .way-body')).toBeVisible();
    await expect(page.locator('.way-body')).toContainText('never rated');

    // Three named presets and a link to the setup page, not a level select.
    const presets = page.locator('.practice-presets button');
    await expect(presets).toHaveCount(3);
    await expect(presets.nth(0)).toHaveText('Easy');
    await expect(presets.nth(1)).toHaveText('Medium');
    await expect(presets.nth(2)).toHaveText('Hard');
    const more = page.locator('.practice-presets a');
    await expect(more).toHaveText('More');
    await expect(more).toHaveAttribute('href', '/bots');
  });

  test('puts puzzles, learning and watching beside the panel', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    const cards = page.locator('.home-side .side-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Puzzles');
    await expect(cards.nth(1)).toContainText('Learn');
    // A live table is stubbed, so the watch card names it rather than the page.
    await expect(cards.nth(2)).toContainText('riverrat and quarrel');
  });

  test('carries no middle dot anywhere on the page', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('\u00b7');
  });
});

test.describe('the ranked gate', () => {
  test('disables ranked and says what opens it', async ({ page }) => {
    await stubApi(page);
    await page.route('**/api/me', (route) => route.fulfill({ json: { ...ME, rankedUnlocked: false } }));
    await setTheme(page, 'dark');
    await page.goto('/');

    const panel = page.locator('.play-panel');
    await expect(panel.locator('.tab[data-value="ranked"]')).toBeDisabled();
    await expect(panel.locator('.tab[data-value="casual"]')).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toContainText('Play one casual game first');
    // The button is still live: casual is a game somebody can play right now.
    await expect(panel.locator('.play-go')).toBeEnabled();
  });

  test('leaves ranked alone for somebody who has played', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    const panel = page.locator('.play-panel');
    await expect(panel.locator('.tab[data-value="ranked"]')).toBeEnabled();
    await expect(panel).not.toContainText('Play one casual game first');
  });
});

test.describe('the practice presets', () => {
  test('a preset deals a table at its level, at whatever the panel is pinned to', async ({ page }) => {
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    // The stubbed account is pinned to heads-up; the preset asks for no
    // table size of its own.
    await expect(page.locator('.player-bar')).toContainText('Heads-up');

    await page.getByRole('button', { name: 'Practice against bots' }).click();
    await page.getByRole('button', { name: 'Hard' }).click();

    const messages = (await sent(page)).map((raw) => JSON.parse(raw));
    expect(messages).toContainEqual({ t: 'queue', mode: 'heads-up', speed: 'standard', bots: { level: 5 } });
  });
});

test.describe('the bots setup page', () => {
  test('lists every level with its roster, in sentence case throughout', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/bots');

    await expect(page.getByRole('heading', { name: 'Practice against bots' })).toBeVisible();

    const rows = page.locator('.level-row');
    await expect(rows).toHaveCount(5);
    await expect(page.locator('.level-bots li').first()).toBeVisible();

    // The old select folded every name flat into lowercase; the name here is
    // its own element, read as `botLevelInfo(level).name` gives it, and never
    // run through `.toLowerCase()`.
    await expect(rows.nth(0).locator('.level-row-head .t')).toHaveText('Loose and passive');
    await expect(rows.nth(1).locator('.level-row-head .t')).toHaveText('Loose');
    await expect(rows.nth(2).locator('.level-row-head .t')).toHaveText('Tight and passive');
    await expect(rows.nth(3).locator('.level-row-head .t')).toHaveText('Solid');
    await expect(rows.nth(4).locator('.level-row-head .t')).toHaveText('Sharp');
  });

  test('starts a practice table at the level and table size chosen here', async ({ page }) => {
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/bots');

    await page.locator('.play-toggles .tab[data-value="heads-up"]').click();
    await page.locator('.level-row').nth(4).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();

    const messages = (await sent(page)).map((raw) => JSON.parse(raw));
    expect(messages).toContainEqual({ t: 'queue', mode: 'heads-up', speed: 'standard', bots: { level: 5 } });
  });
});

test.describe('the ready check', () => {
  test('takes the screen, counts down and accepts', async ({ page }) => {
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    const dialog = page.locator('dialog.ready-dlg');
    await expect(dialog).toBeHidden();

    await push(page, { ...READY, deadline: Date.now() + 20_000 });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Your table is ready');
    // What the table is, in the words the picker used for it.
    await expect(dialog).toContainText('Six-max, fast, ranked');
    await expect(dialog).toContainText('of 4 accepted');
    await expect(dialog.locator('[role="progressbar"]')).toBeVisible();

    await dialog.getByRole('button', { name: 'Accept the table' }).click();
    const messages = (await sent(page)).map((raw) => JSON.parse(raw));
    expect(messages).toContainEqual({ t: 'ready', a: true });
    // The buttons settle on the press rather than on a round trip.
    await expect(dialog.getByRole('button', { name: 'Accepted' })).toBeDisabled();
    await expect(dialog).toContainText('Waiting for the rest of the table');
  });

  /* "Make it cool", and the cool part is the only part a unit test cannot
     reach: that the ticks actually reach the audio graph, one a second, each
     higher than the last. `../src/sound/countdown.ts` owns which rate belongs
     to which second and is tested on its own. */
  test('counts the last seconds down out loud, climbing', async ({ page }) => {
    await recordAudio(page);
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    /* Browsers refuse audio until a gesture, and the app unlocks on the first
       one, so the test has to make one before there is a modal over the page. */
    await page.mouse.click(5, 5);

    await push(page, { ...READY, deadline: Date.now() + 5_500 });
    await expect(page.locator('dialog.ready-dlg')).toBeVisible();

    /* The cue lands with the prompt; the ticks want the window to run down. */
    await expect.poll(async () => (await playedRates(page)).length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(4);
    const rates = await playedRates(page);

    /* Read by pitch rather than by position. Each sound is decoded before it
       is started, so two different samples asked for a second apart can reach
       the graph in either order on a loaded machine, and the prompt losing
       that race to the first tick says nothing about either of them. */
    expect(rates.filter((r) => r === 1), 'the prompt, at the sample its own pitch')
      .not.toHaveLength(0);
    const ticks = rates.filter((r) => r > 1);
    expect(ticks.length, 'one tick a second through the last of the window')
      .toBeGreaterThanOrEqual(3);
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i], `tick ${i} is still the same tick`).toBeLessThan(1.5);
      if (i > 0) {
        expect(ticks[i], `tick ${i} climbs on the one before it`).toBeGreaterThan(ticks[i - 1]);
      }
    }
  });

  /* Two more rules of the check's sound: taking the seat has a noise of its
     own, and turning it down has none. Declining says nothing at all, and it
     stops the countdown with it: the pressure was the point and it is over. */
  test('accepting sounds different from the prompt, and declining says nothing', async ({ page }) => {
    await recordAudio(page);
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    await page.mouse.click(5, 5);

    /* Twenty seconds out, so the window is nowhere near the last ten and the
       only sounds in the graph are the prompt's and the answer's. */
    await push(page, { ...READY, deadline: Date.now() + 20_000 });
    const dialog = page.locator('dialog.ready-dlg');
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await played(page)).length, { timeout: 15_000 }).toBe(1);

    await dialog.getByRole('button', { name: 'Accept the table' }).click();
    await expect.poll(async () => (await played(page)).length, { timeout: 5_000 }).toBe(2);
    const [prompt, confirm] = await played(page);
    expect(confirm.seconds, 'the confirm is a different sound from the prompt')
      .not.toBeCloseTo(prompt.seconds, 3);
  });

  test('declining is silent and stops the countdown', async ({ page }) => {
    await recordAudio(page);
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    await page.mouse.click(5, 5);

    await push(page, { ...READY, deadline: Date.now() + 8_000 });
    const dialog = page.locator('dialog.ready-dlg');
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await played(page)).length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);

    await dialog.getByRole('button', { name: 'Decline' }).click();
    const atDecline = (await played(page)).length;
    await page.waitForTimeout(2_500);
    expect(await played(page)).toHaveLength(atDecline);
  });

  test('makes no noise when the sound preference is off', async ({ page }) => {
    await recordAudio(page, false);
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    await page.mouse.click(5, 5);

    await push(page, { ...READY, deadline: Date.now() + 3_000 });
    await expect(page.locator('dialog.ready-dlg')).toBeVisible();
    await page.waitForTimeout(2_500);
    expect(await played(page)).toEqual([]);
  });

  test('moves the counter when somebody else accepts', async ({ page }) => {
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    await push(page, { ...READY, deadline: Date.now() + 20_000 });
    const dialog = page.locator('dialog.ready-dlg');
    await expect(dialog).toContainText('1of 4 accepted');

    await push(page, { ...READY, s: 'accepted', accepted: 3, deadline: Date.now() + 18_000 });
    await expect(dialog).toContainText('3of 4 accepted');
  });

  test('closes on a cancelled check and says why', async ({ page }) => {
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    // Searching first, so there is a card for the reason to land on.
    await push(page, { t: 'q', s: 'searching', mode: 'six-max', rated: true, speed: 'fast', w: 4 });
    await push(page, { ...READY, deadline: Date.now() + 20_000 });
    const dialog = page.locator('dialog.ready-dlg');
    await expect(dialog).toBeVisible();

    await push(page, { ...READY, s: 'cancelled', why: 'timeout', requeued: true });
    await expect(dialog).toBeHidden();
    await expect(page.locator('.searching-card')).toContainText('did not answer in time');
    await expect(page.locator('.searching-card')).toContainText('front of the queue');
  });

  test('closes when the table is found', async ({ page }) => {
    await fakeSocket(page);
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    await push(page, { ...READY, deadline: Date.now() + 20_000 });
    await expect(page.locator('dialog.ready-dlg')).toBeVisible();
    await push(page, { t: 'q', s: 'found', m: 'mock', mode: 'six-max', rated: true, speed: 'fast' });
    await expect(page.locator('dialog.ready-dlg')).toBeHidden();
  });
});

test.describe('the level', () => {
  test('sits beside the name on a profile, with the badges under it', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/u/kestrel');

    // Forty heads-up matches and twelve six handed is 52, and 45 is the ninth
    // threshold while 55 is the tenth, so level 9.
    await expect(page.locator('.profile-name .badge')).toContainText('Level 9');
    await expect(page.locator('.badge-set')).toBeVisible();
    // First game, level 5, a hundred hands and a six handed win. Not level 10.
    await expect(page.locator('.badge-set .profile-badge[data-earned]')).toHaveCount(4);
    await expect(page.locator('.badge-set')).toContainText('Level 10');
  });

  test('sits beside the rating in the sidebar account row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    // Wide enough for the sidebar, so the account is the row at its foot.
    const row = page.locator('.side-foot .account > .btn');
    await expect(row).toBeVisible();
    await expect(row.locator('.lv')).toHaveText('Lv 8');
  });

  test('sits in the slim top bar once the sidebar is a sheet', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    await expect(page.locator('.top .account > .btn .lv')).toHaveText('Lv 8');
  });

  test('goes with the rating on a phone, where only the name fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    const pill = page.locator('.top .account > .btn');
    await expect(pill).toContainText('kestrel');
    await expect(pill.locator('.lv')).toBeHidden();
    await expect(pill.locator('.r')).toBeHidden();
  });

  test('says nothing about a level nobody has reached', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/u/newcomer');
    await expect(page.locator('.profile-name .badge')).toHaveCount(0);
    await expect(page.locator('.badge-set')).toHaveCount(0);
  });
});
