import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { stubApi } from './table.ts';

/* Choosing a profile picture, end to end but with no server: the point is the
   part that only happens in a browser. A phone photo goes in and 120 KB of
   square has to come out, and no test on the server can see that happen.

   The file is built here rather than kept in `fixtures/` because what matters
   about it is its shape: 800 by 600 is landscape, so a centred square crop has
   something to throw away, and a gradient is something a webp encoder cannot
   answer in four bytes. */

const SOURCE_W = 800;
const SOURCE_H = 600;
const BUDGET = 120 * 1024;

function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[at++] = (x * 255) / width;
      raw[at++] = (y * 255) / height;
      raw[at++] = ((x + y) * 255) / (width + height);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, out.length - 4);
  return out;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return c ^ 0xffffffff;
}

function isWebpOrPng(body: Buffer): boolean {
  const webp = body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF'
    && body.subarray(8, 12).toString('ascii') === 'WEBP';
  const pngMagic = body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return webp || pngMagic;
}

test('crops a photograph to a square under the budget and shows it at once', async ({ page }) => {
  await stubApi(page);

  /* The upload, and what /api/me says afterwards. The dialog refreshes the
     session on success, so the version the header pill draws is whatever this
     hands back on the second call rather than anything the page assumed. */
  let uploaded: Buffer | null = null;
  await page.route('**/api/me/avatar', async (route) => {
    uploaded = Buffer.from(route.request().postDataBuffer() ?? Buffer.alloc(0));
    await route.fulfill({ json: { avatarV: 1 } });
  });
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        id: 'u-e2e', name: 'kestrel', guest: true, bot: false,
        rating: 1518, rd: 84, provisional: false, peak: 1552,
        matches: 40, wins: 22, losses: 17, draws: 1,
        avatarV: uploaded ? 1 : 0,
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
      },
    }));

  await page.goto('/u/kestrel');

  await page.locator('.profile-name').getByRole('button', { name: 'Edit picture' }).click();
  const dialog = page.locator('dialog.pic-dlg[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.pic-stage')).toHaveCount(0);

  /* g owns the file input and turns a choice into the `files` event this
     listens for, so the wait is for g having wired the zone rather than for a
     duration: setting a file into an input g has not reached yet fires a change
     nothing is listening to. */
  await expect(dialog.locator('.g-dropzone[data-dropzone-init]')).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: png(SOURCE_W, SOURCE_H),
  });

  /* The crop stage and all three sizes it will be drawn at, which is the whole
     of what the preview promises. */
  await expect(dialog.locator('.pic-stage')).toBeVisible();
  await expect(dialog.locator('.pic-previews canvas')).toHaveCount(3);

  await dialog.getByRole('button', { name: 'Upload picture' }).click();

  await expect.poll(() => uploaded !== null, { timeout: 10_000 }).toBe(true);
  const body = uploaded!;
  expect(isWebpOrPng(body)).toBe(true);
  expect(body.length).toBeLessThan(BUDGET);
  expect(body.length).toBeGreaterThan(0);

  /* The dialog closes and the top bar is drawing the new version, which is the
     only visible proof the whole round trip landed. */
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.account .avatar img.avatar-photo')).toHaveAttribute('src', /\?v=1$/);
});
