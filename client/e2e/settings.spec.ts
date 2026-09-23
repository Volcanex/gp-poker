import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PALETTES, contrastOf, defaultAccentFor } from '../src/ui/prefs.ts';
import { stubApi } from './table.ts';

/* The settings menu, and the two promises it makes that a screenshot cannot
   check: every accent and every palette stays readable, and a choice survives a
   reload. */

const ACCENTS = ['default', 'ocean', 'jade', 'violet', 'clay', 'ember'];
const PALETTE_IDS = PALETTES.map((p) => p.id);

/* Read through real elements rather than off the custom properties: a custom
   property whose value is another var() comes back unresolved, and half of
   these are exactly that. A probe painted with the pair reports what the eye
   would see. */
async function samples(page: import('@playwright/test').Page, palette: string) {
  return page.evaluate((p) => {
    const el = document.documentElement;
    if (p === 'slate') el.removeAttribute('data-palette');
    else el.setAttribute('data-palette', p);

    const probe = document.createElement('span');
    document.body.append(probe);
    const read = (bg: string, fg: string) => {
      probe.style.background = bg;
      probe.style.color = fg;
      const s = getComputedStyle(probe);
      return [s.backgroundColor, s.color] as [string, string];
    };
    const out = {
      primaryOn1: read('var(--surface-1)', 'var(--text-primary)'),
      primaryOn2: read('var(--surface-2)', 'var(--text-primary)'),
      secondaryOn1: read('var(--surface-1)', 'var(--text-secondary)'),
      secondaryOn2: read('var(--surface-2)', 'var(--text-secondary)'),
      accent: read('var(--accent-fill)', 'var(--accent-fg)'),
    };
    probe.remove();
    return out;
  }, palette);
}

/* The theme has to be stamped into the app's own record, not into g's key.
   setTheme in table.ts writes g-theme and the attribute, and applyPrefs
   overwrites both from ot.prefs the moment the app mounts, so a page set up
   that way is dark whatever the test is called. */
async function useTheme(
  page: import('@playwright/test').Page,
  theme: 'dark-felt' | 'room' | 'dark' | 'light',
  palette = 'slate',
  accent = 'default',
) {
  await page.addInitScript((v) => {
    localStorage.setItem('ot.prefs', JSON.stringify(v));
    localStorage.setItem('g-theme', (v as { theme: string }).theme);
  }, { theme, palette, accent, fourColour: false });
}

async function openMenu(page: import('@playwright/test').Page) {
  await page.locator('button[popovertarget="settings-menu"]').click();
  await expect(page.locator('#settings-menu')).toBeVisible();
}

test('a theme survives a reload, and lands before the first paint', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await openMenu(page);
  await page.locator('.choices .choice', { hasText: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  /* Stamped by the inline script in index.html, before React or g-ui have run,
     which is what stops the page flashing dark on the way to light. */
  const early = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  expect(early).toBe('light');
});

/* Dark felt is what a visitor gets before choosing anything, stamped by
   the inline script before React or g-ui run and agreed by g's own key once
   the app has mounted. While it is on, the palette and accent rows are not
   offered; another theme brings them back. */
test('a visitor with no preference gets dark felt, before the first paint', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  const early = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  expect(early).toBe('dark-felt');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-felt');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('g-theme'))).toBe('dark-felt');

  await openMenu(page);
  await expect(page.locator('.choices .choice[aria-checked="true"]')).toHaveText('Dark felt');
  await expect(page.locator('.pswatches')).toHaveCount(0);
  await expect(page.locator('.swatches')).toHaveCount(0);

  await page.locator('.choices .choice', { hasText: /^Dark$/ }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.locator('.pswatches')).toBeVisible();
  await expect(page.locator('.swatches')).toBeVisible();
});

/* A stored palette and accent are kept while the room is on, and worn again
   the moment another theme is chosen. */
test('the games room keeps a chosen palette and accent for later', async ({ page }) => {
  await stubApi(page);
  await useTheme(page, 'room', 'sky', 'violet');
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'room');
  await expect(page.locator('html')).not.toHaveAttribute('data-palette');
  await expect(page.locator('html')).not.toHaveAttribute('data-accent');

  await openMenu(page);
  await page.locator('.choices .choice', { hasText: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sky');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
});

test('an accent and a deck survive a reload', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await openMenu(page);
  /* Off the games room first: it hides the accent row. Chosen here rather
     than stamped by an init script, which would run again on the reload and
     put the record back. */
  await page.locator('.choices .choice', { hasText: /^Dark$/ }).click();
  await page.locator('.swatch[data-accent="jade"]').click();
  await page.locator('.settings-menu .switch').first().check();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'jade');
  await expect(page.locator('html')).toHaveAttribute('data-deck', 'four');
  expect(await page.evaluate(() => localStorage.getItem('ot.prefs'))).toContain('jade');
});

/* The one thing a rebrand can get wrong that nobody notices until somebody
   cannot read a button. The values come out of the stylesheet that shipped, so
   this cannot pass on a colour nobody sees. */
for (const theme of ['dark', 'light'] as const) {
  test(`every accent keeps its label readable in ${theme}`, async ({ page }) => {
    await stubApi(page);
    await useTheme(page, theme);
    await page.goto('/');

    for (const accent of ACCENTS) {
      /* Read through a real element rather than off the custom properties: a
         custom property whose value is another var() comes back unresolved,
         and the default accent is exactly that. A probe painted with the two
         colours reports what the eye would see. */
      const pair = await page.evaluate((a) => {
        const el = document.documentElement;
        if (a === 'default') el.removeAttribute('data-accent');
        else el.setAttribute('data-accent', a);
        const probe = document.createElement('span');
        probe.style.background = 'var(--accent-fill)';
        probe.style.color = 'var(--accent-fg)';
        document.body.append(probe);
        const s = getComputedStyle(probe);
        const out = [s.backgroundColor, s.color];
        probe.remove();
        return out;
      }, accent);

      const ratio = contrastOf(pair[0], pair[1]);
      expect(ratio, `${accent} resolves to two colours`).not.toBe(null);
      expect(
        ratio!,
        `${accent} in ${theme}: label on the primary button`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('the four colour deck gives each suit its own colour', async ({ page }) => {
  await stubApi(page);
  await page.goto('/m/mock?step=13');

  const suits = () => page.evaluate(() => {
    const pick = (s: string) => {
      const el = document.querySelector(`.pcard[data-suit="${s}"]`);
      return el ? getComputedStyle(el).color : null;
    };
    return { h: pick('h'), d: pick('d'), c: pick('c') };
  });

  const two = await suits();
  expect(two.h, 'red suits match by default').toBe(two.d);

  await page.evaluate(() => document.documentElement.setAttribute('data-deck', 'four'));
  const four = await suits();
  expect(four.h, 'hearts stay red').toBe(two.h);
  expect(four.d, 'diamonds go their own way').not.toBe(four.h);
  expect(four.c, 'and so do clubs').not.toBe(four.d);
});

/* A palette re-declares the twelve greys the whole site is built out of, so a
   badly chosen step 11 is unreadable body text everywhere at once rather than
   one button nobody can read. Every palette, both themes, both surfaces. */
for (const theme of ['dark', 'light'] as const) {
  test(`every palette keeps its text readable in ${theme}`, async ({ page }) => {
    await stubApi(page);
    await useTheme(page, theme);
    await page.goto('/');

    for (const palette of PALETTE_IDS) {
      const s = await samples(page, palette);
      const pairs: [string, [string, string]][] = [
        ['text-primary on surface-1', s.primaryOn1],
        ['text-primary on surface-2', s.primaryOn2],
        ['text-secondary on surface-1', s.secondaryOn1],
        ['text-secondary on surface-2', s.secondaryOn2],
      ];
      for (const [what, pair] of pairs) {
        const ratio = contrastOf(pair[0], pair[1]);
        expect(ratio, `${palette} in ${theme}: ${what} resolves`).not.toBe(null);
        expect(ratio!, `${palette} in ${theme}: ${what}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /* The accent a palette arrives with, on the palette's own ground. The accent
     loop above walks the accents against g's slate; this one walks the pairing
     the player actually gets by choosing a palette and touching nothing else. */
  test(`every palette keeps its own accent readable in ${theme}`, async ({ page }) => {
    await stubApi(page);
    await useTheme(page, theme);
    await page.goto('/');

    for (const palette of PALETTE_IDS) {
      const accent = defaultAccentFor(palette);
      await page.evaluate((a) => {
        const el = document.documentElement;
        if (a === 'default') el.removeAttribute('data-accent');
        else el.setAttribute('data-accent', a);
      }, accent);
      const s = await samples(page, palette);
      const ratio = contrastOf(s.accent[0], s.accent[1]);
      expect(ratio, `${palette} accent resolves`).not.toBe(null);
      expect(
        ratio!,
        `${palette} in ${theme}: ${accent} label on the primary button`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}

/* The games room is a whole set rather than twelve greys, so it is measured as
   one: text on the walnut, text on the baize and its panel, every status text
   on both, the brass accent under its ink, and the pips on the paper. Text at
   4.5, pips at 5, the same bar look-v2.css sets for the slate deck. */
for (const set of ['room', 'dark-felt'] as const) {
test(`${set} keeps its text and its pips readable`, async ({ page }) => {
  await stubApi(page);
  await useTheme(page, set);
  await page.goto('/');

  const pairs = await page.evaluate(() => {
    /* Two probes: one on the page, one inside a `.felt`, because the felt
       re-maps the panel and the secondary text and a probe on the body would
       report the walnut's pairing on the baize's ground. */
    const probe = document.createElement('span');
    document.body.append(probe);
    const island = document.createElement('div');
    island.className = 'felt';
    const feltProbe = document.createElement('span');
    island.append(feltProbe);
    document.body.append(island);
    const read = (bg: string, fg: string, el = probe) => {
      el.style.background = bg;
      el.style.color = fg;
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.color] as [string, string];
    };
    const grounds: [string, string, HTMLElement][] = [
      ['surface-1', 'var(--surface-1)', probe], ['surface-2', 'var(--surface-2)', probe],
      ['felt', 'var(--felt)', feltProbe], ['felt panel', 'var(--surface-2)', feltProbe],
    ];
    const texts: [string, string][] = [
      ['text-primary', 'var(--text-primary)'], ['text-secondary', 'var(--text-secondary)'],
      ['ok-text', 'var(--ok-text)'], ['warn-text', 'var(--warn-text)'],
      ['danger-text', 'var(--danger-text)'], ['info-text', 'var(--info-text)'],
    ];
    const out: { what: string; pair: [string, string]; floor: number }[] = [];
    for (const [g, gv, el] of grounds) {
      for (const [t, tv] of texts) out.push({ what: `${t} on ${g}`, pair: read(gv, tv, el), floor: 4.5 });
    }
    out.push({ what: 'accent-fg on accent-fill', pair: read('var(--accent-fill)', 'var(--accent-fg)'), floor: 4.5 });
    out.push({ what: 'accent-fg on accent-fill-hover', pair: read('var(--accent-fill-hover)', 'var(--accent-fg)'), floor: 4.5 });
    out.push({ what: 'danger-fg on danger-fill', pair: read('var(--danger-fill)', 'var(--danger-fg)'), floor: 4.5 });
    out.push({ what: 'go-fg on go-fill', pair: read('var(--go-fill)', 'var(--go-fg)'), floor: 4.5 });
    for (const pip of ['card-ink', 'card-red', 'card-blue', 'card-green']) {
      out.push({ what: `${pip} on card-face`, pair: read('var(--card-face)', `var(--${pip})`), floor: 5 });
    }
    probe.remove();
    island.remove();
    return out;
  });

  for (const { what, pair, floor } of pairs) {
    const ratio = contrastOf(pair[0], pair[1]);
    expect(ratio, `${set}: ${what} resolves`).not.toBe(null);
    expect(ratio!, `${set}: ${what}`).toBeGreaterThanOrEqual(floor);
  }
});
}

/* Home and the heads-up v2 felt. The six-max felt is not here: it overflows at
   the default viewport and axe flags the scrollable region as unfocusable in
   every theme, which is a table matter and not a colour one. */
for (const url of ['/', '/m/mock?v2=1&step=6']) {
  test(`the games room has no serious accessibility failures on ${url}`, async ({ page }) => {
    await stubApi(page);
    await useTheme(page, 'room');
    await page.goto(url);
    await page.waitForTimeout(1500);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const bad = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}

/* Contrast measured off a probe is the palette's arithmetic. axe is the same
   claim made against the pages as they are drawn, where a colour sits on a
   material rather than on a token. Home and the felt, every palette. */
for (const palette of PALETTES) {
  for (const theme of ['dark', 'light'] as const) {
    for (const url of ['/', '/m/mock?step=6']) {
      test(`${palette.id} in ${theme} has no serious accessibility failures on ${url}`, async ({ page }) => {
        await stubApi(page);
        await useTheme(page, theme, palette.id, palette.accent);
        await page.goto(url);
        await page.waitForTimeout(1500);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        const bad = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(
          bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        ).toEqual([]);
      });
    }
  }
}

/* A palette arrives wearing an accent, and takes it unless the player has moved
   off the one they had. */
test('choosing a palette brings its accent, and keeps a chosen one', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await openMenu(page);
  await page.locator('.choices .choice', { hasText: /^Dark$/ }).click();

  await page.locator('.pswatch[title="Felt"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'felt');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'ember');

  await page.locator('.swatch[data-accent="violet"]').click();
  await page.locator('.pswatch[title="Sky"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sky');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sky');
});

/* The second way in. It opens the panel that already exists rather than a
   second copy of the controls. */
test('the profile opens the same settings panel', async ({ page }) => {
  await stubApi(page);
  await page.goto('/u/kestrel');
  await page.locator('.appearance .btn').click();
  await expect(page.locator('#settings-menu')).toBeVisible();
  await expect(page.locator('#settings-menu')).toHaveCount(1);
});

for (const theme of ['room', 'dark', 'light'] as const) {
  test(`the settings menu looks right in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubApi(page);
    await useTheme(page, theme);
    await page.goto('/m/mock?step=9');
    await page.addStyleTag({ content: '.devnote { display: none !important; }' });
    await openMenu(page);
    await page.waitForTimeout(400);
    await expect(page.locator('#settings-menu')).toHaveScreenshot(`settings-${theme}.png`);
  });
}
