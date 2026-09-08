import { expect, test, type Page } from '@playwright/test';
import { setTheme, stubApi } from './table.ts';

/* The admin layer, driven the way it is actually used: the bar is there or it
   is not, and the annotate flow goes from a shortcut to a posted ticket
   without leaving the page.

   The rest of the suite stubs /api/me as an ordinary player, so nothing here
   changes what any other spec sees. That is also the point of the last case:
   a player must not be handed the bar, or anything else about it, in the DOM. */

const ADMIN_ME = {
  id: 'u-e2e',
  name: 'kestrel',
  guest: false,
  bot: false,
  admin: true,
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

const VIEWPORT = { width: 1366, height: 768, dpr: 1, theme: 'dark' };

const OPEN_TICKETS = [
  {
    id: 'tk-one',
    createdAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    url: 'http://localhost/leaderboard',
    path: '/leaderboard',
    title: 'The rating column is cut off',
    note: 'The rating column is cut off\nAt 1366 the deviation wraps under the number.',
    viewport: VIEWPORT,
    targets: [
      {
        selector: 'main.page > div.card > table.table',
        rect: { x: 24, y: 220, width: 880, height: 300 },
        text: 'Player rating matches peak',
        label: null,
      },
    ],
    status: 'open',
    build: null,
  },
  {
    id: 'tk-two',
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    url: 'http://localhost/watch',
    path: '/watch',
    title: 'The watch page has no empty state',
    note: 'The watch page has no empty state',
    viewport: VIEWPORT,
    targets: [],
    status: 'open',
    build: null,
  },
];

// A one pixel PNG: the detail page renders whatever it is given, and what it
// is given in life is a viewport-sized strokes layer.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function stubAdmin(page: Page) {
  await stubApi(page);
  // Registered after the stub, so these win: Playwright runs the last
  // matching handler.
  await page.route('**/api/me', (route) => route.fulfill({ json: ADMIN_ME }));
  await page.route('**/api/admin/tickets?*', (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    return route.fulfill({ json: status === 'done' ? [] : OPEN_TICKETS });
  });
  await page.route('**/api/admin/tickets/*', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: { id: 'tk-one', status: 'done' } });
    return route.fulfill({ json: { ...OPEN_TICKETS[0], drawing: PIXEL, pageShot: null } });
  });
}

test.describe('the admin layer', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark');
    await page.setViewportSize({ width: 1366, height: 768 });
  });

  test('shows the bar with the open count, the shortcut hint and a hide button', async ({ page }) => {
    await stubAdmin(page);
    await page.goto('/');
    const bar = page.locator('.admin-bar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.ab-label')).toHaveText('Admin');
    await expect(bar.locator('.ab-tickets .badge')).toHaveText('2');
    await expect(bar.locator('.kbd')).toHaveCount(3);
    // The bar sits above the site header rather than over it.
    const barBox = (await bar.boundingBox())!;
    const topBox = (await page.locator('.top').boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(topBox.y + 1);

    await bar.getByRole('button', { name: 'Hide' }).click();
    await expect(page.locator('.admin-bar')).toHaveCount(0);
    // Hidden for the session, so a second page does not bring it back.
    await page.goto('/leaderboard');
    await expect(page.locator('.admin-bar')).toHaveCount(0);
  });

  test('annotates a page and posts the ticket the annotation makes', async ({ page }) => {
    await stubAdmin(page);
    let posted: Record<string, unknown> | null = null;
    await page.route('**/api/tickets', (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'tk-new' } });
    });

    await page.goto('/leaderboard');
    await expect(page.locator('.admin-bar')).toBeVisible();

    // The shortcut, on the platform this runs on.
    await page.keyboard.press('Control+Shift+K');
    const overlay = page.locator('.anno');
    await expect(overlay).toBeVisible();

    // Highlight the leaderboard's own heading: a hover outlines it, a click
    // takes it.
    const heading = page.locator('main .h1').first();
    const box = (await heading.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await expect(overlay.locator('.anno-outline')).toBeVisible();
    await page.mouse.click(at.x, at.y);
    await expect(overlay.locator('.anno-target')).toHaveCount(1);

    // Draw one stroke with the pen.
    await overlay.getByRole('radio', { name: 'Draw' }).click();
    await page.mouse.move(400, 400);
    await page.mouse.down();
    for (const dx of [30, 60, 90, 120]) await page.mouse.move(400 + dx, 400 + dx / 2);
    await page.mouse.up();
    await expect(overlay.locator('.anno-count')).toContainText('1 stroke');

    const note = overlay.getByLabel('What is wrong here');
    const save = overlay.getByRole('button', { name: 'Save ticket' });
    await expect(save).toBeDisabled();
    await note.fill('The heading is too close to the tabs\nIt reads as part of them.');
    await expect(save).toBeEnabled();
    await save.click();

    await expect(overlay).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Ticket saved');

    const body = posted as unknown as {
      note: string;
      targets: { selector: string; text: string }[];
      drawing: string;
      viewport: { width: number; height: number; theme: string };
      path: string;
    } | null;
    expect(body).not.toBeNull();
    expect(body!.path).toBe('/leaderboard');
    expect(body!.targets.length).toBeGreaterThanOrEqual(1);
    expect(body!.targets[0].selector).toContain('h1');
    // The title is the note's first line, derived on the server, so what the
    // body has to carry is a note that starts with it.
    expect(body!.note.split('\n')[0]).toBe('The heading is too close to the tabs');
    expect(body!.drawing.startsWith('data:image/png;base64,')).toBe(true);
    expect(body!.viewport).toMatchObject({ width: 1366, theme: 'dark' });
  });

  test('closes the overlay on escape without posting anything', async ({ page }) => {
    await stubAdmin(page);
    let posts = 0;
    await page.route('**/api/tickets', (route) => {
      posts += 1;
      return route.fulfill({ status: 201, json: { id: 'tk-new' } });
    });
    await page.goto('/');
    // The shortcut is bound once /api/me has said admin, so the bar being
    // there is what says the listener is.
    await expect(page.locator('.admin-bar')).toBeVisible();
    await page.keyboard.press('Control+Shift+K');
    await expect(page.locator('.anno')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.anno')).toHaveCount(0);
    expect(posts).toBe(0);
  });

  test('lists the open tickets and opens one in full', async ({ page }) => {
    await stubAdmin(page);
    await page.goto('/admin/tickets');
    const rows = page.locator('.tk-rows tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('The rating column is cut off');
    await expect(rows.first()).toContainText('/leaderboard');

    await page.getByRole('link', { name: 'The rating column is cut off' }).click();
    await expect(page).toHaveURL(/\/admin\/tickets\/tk-one$/);
    await expect(page.locator('.tk-note')).toContainText('the deviation wraps');
    await expect(page.locator('.tk-targets li')).toHaveCount(1);
    await expect(page.locator('.tk-targets .sel')).toContainText('table.table');
    await expect(page.locator('.tk-shot img')).toBeVisible();

    await page.getByRole('button', { name: 'Mark done' }).click();
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  });

  test('gives a player nothing: no bar, and the not-found page at the admin url', async ({ page }) => {
    await stubApi(page);
    await page.goto('/');
    await expect(page.locator('.top')).toBeVisible();
    await expect(page.locator('.admin-bar')).toHaveCount(0);
    // Not a hidden node either: nothing about the admin layer is in the DOM.
    await expect(page.locator('text=Annotate')).toHaveCount(0);

    await page.goto('/admin/tickets');
    await expect(page.locator('.e-title')).toHaveText('No page here');
  });
});
