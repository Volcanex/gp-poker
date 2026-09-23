/* Exports the mark in src/ui/logo.tsx to every static icon: logo.svg,
   favicon.svg, the PNG icons and og.png. White on black whatever the theme.
   Run from client/: `node scripts/icons.mjs`. Needs the repo's playwright. */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const src = readFileSync('src/ui/logo.tsx', 'utf8');
const VIEWBOX = src.match(/LOGO_VIEWBOX = '([^']+)'/)[1];
const PATH = src.match(/LOGO_PATH = '([^']+)'/)[1];
const [, , vw, vh] = VIEWBOX.split(' ').map(Number);
const INK = '#ffffff';
const GROUND = '#000000';

writeFileSync('public/logo.svg', `<?xml version="1.0" encoding="utf-8"?>
<!-- The mark. Exported from client/src/ui/logo.tsx by scripts/icons.mjs. Do not edit; regenerate. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" role="img" aria-label="EveryonePoker">
  <path fill="${GROUND}" d="${PATH}"/>
</svg>
`);

/* The mark centred on a square ground, `ink` of the square's height. */
const tile = (size, ink, rx) => {
  const h = size * ink, s = h / vh, w = vw * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="EveryonePoker">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${GROUND}"/>
  <path fill="${INK}" transform="translate(${((size - w) / 2).toFixed(3)} ${((size - h) / 2).toFixed(3)}) scale(${s.toFixed(5)})" d="${PATH}"/>
</svg>`;
};

writeFileSync('public/favicon.svg', `<!-- Exported from client/src/ui/logo.tsx by scripts/icons.mjs. Do not edit; regenerate. -->\n${tile(64, 0.72, 14)}\n`);

const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${GROUND}"/>
  <path fill="${INK}" transform="translate(120 175) scale(${(280 / vh).toFixed(5)})" d="${PATH}"/>
  <text x="390" y="318" fill="${INK}" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="84">EveryonePoker</text>
  <text x="392" y="372" fill="#a0a0a0" font-family="Inter, system-ui, sans-serif" font-size="30">Free ranked poker. No money, no rake, no ads.</text>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const shoot = async (svg, w, h, out) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
};
/* Full-bleed squares for the platforms that round their own corners. */
for (const [size, out, rx] of [
  [32, 'public/favicon-32.png', 7], [180, 'public/apple-touch-icon.png', 0],
  [192, 'public/icon-192.png', 0], [512, 'public/icon-512.png', 0],
  [32, 'public/logo-32.png', 7], [128, 'public/logo-128.png', 28], [512, 'public/logo-512.png', 112],
]) await shoot(tile(size, 0.66, rx), size, size, out);
await shoot(og, 1200, 630, 'public/og.png');
await browser.close();
console.log('icons written');
