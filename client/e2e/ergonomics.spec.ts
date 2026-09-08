import { expect, test } from '@playwright/test';
import { stubApi } from './table.ts';

/* Thumb reach and target size on the screen most hands are played on, plus the
   sizing model: the typed amount is the source of truth, presets write into it,
   and a number outside the legal range is clamped where you can see it rather
   than quietly turned into something else on the way to the server. */

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every dock control is big enough to hit', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    /* Visible controls only: the slider is in the markup at every width and
       display:none on a phone, where presets and the field replace it. */
    const controls = page.locator('.dock button:visible, .dock input:visible');
    const n = await controls.count();
    expect(n).toBeGreaterThan(6);
    for (let i = 0; i < n; i += 1) {
      const el = controls.nth(i);
      const box = await el.boundingBox();
      const label = (await el.getAttribute('aria-label')) ?? (await el.innerText());
      expect(Math.round(box!.height), `${label} is tall enough to hit`).toBeGreaterThanOrEqual(24);
    }
  });

  test('the primary action is full width and under the thumb', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    const primary = page.locator('.dock-acts .btn[data-primary]');
    await expect(primary).toBeVisible();
    const box = (await primary.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y, 'in the bottom quarter of the screen').toBeGreaterThanOrEqual(844 * 0.75);
    /* It has the row to itself, which is what "full width" means here. */
    const dock = (await page.locator('.dock').boundingBox())!;
    expect(box.width).toBeGreaterThan(dock.width * 0.8);
  });

  test('the slider is dropped and the keypad field is not', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');
    await expect(page.locator('.dock-slider')).toBeHidden();
    await expect(page.locator('.dock-field .input')).toHaveAttribute('inputmode', 'numeric');
    await expect(page.locator('.dock-keys')).toBeHidden();
  });
});

test.describe('sizing', () => {
  test('a preset writes its number into the field and lights up', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    const field = page.locator('.dock-field .input');
    await expect(field).toHaveValue('86'); // the minimum, where every decision starts

    const pot = page.locator('.dock-presets .preset', { hasText: 'Pot' });
    await pot.click();
    await expect(field).toHaveValue('184');
    await expect(pot).toHaveAttribute('aria-pressed', 'true');

    await field.fill('120');
    await expect(pot).toHaveAttribute('aria-pressed', 'false');
  });

  test('a number outside the range is clamped where you can see it', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');

    const field = page.locator('.dock-field .input');
    await field.fill('4');
    await field.press('Enter');
    /* The clamp lands in the field, and the mock has not advanced: a size you
       did not choose is never sent. */
    await expect(field).toHaveValue('86');
    await expect(page.locator('.dock[data-state="turn"]')).toBeVisible();

    await field.fill('9999');
    await field.press('Enter');
    await expect(field).toHaveValue('186');
  });

  test('the primary button says the number that will be sent', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=9');
    const field = page.locator('.dock-field .input');
    await field.fill('137');
    await expect(page.locator('.dock-acts .btn[data-primary]')).toHaveText('Raise to 137');
    await field.fill('186');
    await expect(page.locator('.dock-acts .btn[data-primary]')).toHaveText('All in 186');
  });

  test('preflop sizes are multiples of the bet, postflop are pot fractions', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock?step=0');
    await expect(page.locator('.dock-presets .preset')).toHaveText([
      /Min/, /2×/, /2\.5×/, /3×/, /Pot/, /All in/,
    ]);

    await page.goto('/m/mock?step=9');
    await expect(page.locator('.dock-presets .preset')).toHaveText([
      /Min/, /⅓/, /½/, /⅔/, /Pot/, /All in/,
    ]);
  });
});

test.describe('pre-actions', () => {
  test('a pill fires the moment the action reaches you', async ({ page }) => {
    await stubApi(page);
    await page.goto('/m/mock');

    /* Wait until it is somebody else's turn, then arm "call any". The mock
       treats any action as "step forward", so the pill firing shows up as the
       script advancing on its own. */
    await page.locator('.dock[data-state="wait"]').waitFor({ timeout: 30_000 });
    const step = await page.locator('.devnote').innerText();
    await page.locator('.dock-pre .pill', { hasText: 'Call any' }).click();
    await expect(page.locator('.dock-pre .pill[data-on]')).toBeVisible();

    await page.locator('.dock[data-state="turn"]').waitFor({ timeout: 30_000 });
    await expect(page.locator('.devnote')).not.toHaveText(step, { timeout: 5_000 });
    await expect(page.locator('.dock-pre .pill[data-on]')).toHaveCount(0);
  });
});
