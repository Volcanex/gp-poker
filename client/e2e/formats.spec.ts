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

const READY = {
  t: 'ready',
  s: 'pending',
  id: 'rc-1',
  mode: 'six-max',
  speed: 'short',
  rated: true,
  seats: 6,
  humans: 4,
  accepted: 1,
  deadline: 0,
};

test.describe('the picker', () => {
  test('puts six handed first and marks it the main game', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    const cards = page.locator('.modes .mode');
    await expect(cards.first()).toContainText('Six-max');
    await expect(cards.first()).toContainText('Main game');
    await expect(cards.nth(1)).toContainText('Heads-up');
    // The main card carries the emphasis, and nothing else does.
    await expect(page.locator('.mode[data-main]')).toHaveCount(1);
    await expect(page.locator('.mode[data-main] .btn-lg')).toBeVisible();
  });

  test('offers short and long on both modes, long by default', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');

    for (const mode of ['six-max', 'heads-up']) {
      const speeds = page.locator(`input[name="speed-${mode}"]`);
      await expect(speeds).toHaveCount(2);
      await expect(speeds.nth(0)).not.toBeChecked(); // short
      await expect(speeds.nth(1)).toBeChecked(); // long
    }
  });

  test('remembers the speed and the stake it was left on', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.addInitScript(() => {
      localStorage.setItem('ot-play-choice', JSON.stringify({ mode: 'six-max', rated: false, speed: 'short' }));
    });
    await page.goto('/');

    const card = page.locator('.mode').first();
    await expect(card.locator('input[name="speed-six-max"]').nth(0)).toBeChecked();
    await expect(card.locator('input[name="stake-six-max"]').nth(1)).toBeChecked();
    await expect(card).toContainText('Last played');
    // The blurb follows the speed rather than describing a table it will not
    // deal: the short one promises the twenty minute ceiling.
    await expect(card).toContainText('20 minutes');
  });

  test('describes the long table it would actually deal', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    await expect(page.locator('.mode').first()).toContainText('2 hours');
  });
});

test.describe('the ranked gate', () => {
  test('disables rated and says what opens it', async ({ page }) => {
    await stubApi(page);
    await page.route('**/api/me', (route) => route.fulfill({ json: { ...ME, rankedUnlocked: false } }));
    await setTheme(page, 'dark');
    await page.goto('/');

    const card = page.locator('.mode').first();
    const rated = card.locator('input[name="stake-six-max"]').nth(0);
    const casual = card.locator('input[name="stake-six-max"]').nth(1);
    await expect(rated).toBeDisabled();
    await expect(casual).toBeChecked();
    await expect(card).toContainText('Play one casual game first');
    // The button is still live: casual is a game somebody can play right now.
    await expect(card.locator('.btn-primary')).toBeEnabled();
  });

  test('leaves rated alone for somebody who has played', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/');
    const card = page.locator('.mode').first();
    await expect(card.locator('input[name="stake-six-max"]').nth(0)).toBeEnabled();
    await expect(card).not.toContainText('Play one casual game first');
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
    await expect(dialog).toContainText('Six-max, short, rated');
    await expect(dialog).toContainText('of 4 accepted');
    await expect(dialog.locator('[role="progressbar"]')).toBeVisible();

    await dialog.getByRole('button', { name: 'Accept the table' }).click();
    const messages = (await sent(page)).map((raw) => JSON.parse(raw));
    expect(messages).toContainEqual({ t: 'ready', a: true });
    // The buttons settle on the press rather than on a round trip.
    await expect(dialog.getByRole('button', { name: 'Accepted' })).toBeDisabled();
    await expect(dialog).toContainText('Waiting for the rest of the table');
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
    await push(page, { t: 'q', s: 'searching', mode: 'six-max', rated: true, speed: 'short', w: 4 });
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
    await push(page, { t: 'q', s: 'found', m: 'mock', mode: 'six-max', rated: true, speed: 'short' });
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

  test('says nothing about a level nobody has reached', async ({ page }) => {
    await stubApi(page);
    await setTheme(page, 'dark');
    await page.goto('/u/newcomer');
    await expect(page.locator('.profile-name .badge')).toHaveCount(0);
    await expect(page.locator('.badge-set')).toHaveCount(0);
  });
});
