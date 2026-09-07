/* Guest and bot identity: generated CamelCase names and deterministic
   geometric avatars. Pure and isomorphic: no node imports, no dependencies,
   safe to import from the client or the server. */

import { ADJECTIVES, THINGS, VERBS } from './words.js';

export { ADJECTIVES, THINGS, VERBS };

export type Rng = () => number;

/* xmur3 hashes a string into a 32-bit seed; mulberry32 turns that seed into
   a fast deterministic float generator. Same seed in, same sequence out,
   every time, on every platform. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next(): number {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRng(seed: string): Rng {
  return mulberry32(xmur3(seed)());
}

function pick<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

export const NAME_CAPACITY = {
  two: ADJECTIVES.length * THINGS.length,
  three: ADJECTIVES.length * (ADJECTIVES.length + VERBS.length) * THINGS.length,
};

export function generateName(rng: Rng, words: 2 | 3 = 2): string {
  const adjective = pick(rng, ADJECTIVES);
  if (words === 2) return adjective + pick(rng, THINGS);
  const middle = rng() < 0.5 ? pick(rng, VERBS) : pick(rng, ADJECTIVES);
  return adjective + middle + pick(rng, THINGS);
}

const ADJECTIVE_SET = new Set(ADJECTIVES);
const THING_SET = new Set(THINGS);
const VERB_SET = new Set(VERBS);

// True when `name` parses exactly into Adjective+Thing or
// Adjective+(Verb|Adjective)+Thing using words from the lists above. Not
// used for anything critical: a handmade name can happen to parse this way
// too, and that is fine.
export function isGeneratedName(name: string): boolean {
  if (!/^[A-Za-z]+$/.test(name)) return false;
  for (let i = 1; i < name.length; i++) {
    if (ADJECTIVE_SET.has(name.slice(0, i)) && THING_SET.has(name.slice(i))) return true;
  }
  for (let i = 1; i < name.length; i++) {
    if (!ADJECTIVE_SET.has(name.slice(0, i))) continue;
    for (let j = i + 1; j < name.length; j++) {
      const middle = name.slice(i, j);
      if (!VERB_SET.has(middle) && !ADJECTIVE_SET.has(middle)) continue;
      if (THING_SET.has(name.slice(j))) return true;
    }
  }
  return false;
}

const HUE_COUNT = 12;
const FIGURE_COUNT = 8;

function hsl(hue: number, s: number, l: number): string {
  return `hsl(${hue * (360 / HUE_COUNT)}, ${s}%, ${l}%)`;
}

function figureBitGrid(rng: Rng, tint: string): string {
  const cell = 6;
  const originX = 4;
  const originY = 4;
  const cols = [0, 1, 2, 1, 0]; // mirrored: col 2 is the centre
  let rects = '';
  for (let row = 0; row < 5; row++) {
    const bits = [rng() < 0.5, rng() < 0.5, rng() < 0.5];
    for (let col = 0; col < 5; col++) {
      if (!bits[cols[col]]) continue;
      const x = originX + col * cell;
      const y = originY + row * cell;
      rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${tint}" />`;
    }
  }
  return rects;
}

function figureRing(rng: Rng, tint: string): string {
  const r = 11;
  const circumference = 2 * Math.PI * r;
  const gap = 10 + rng() * 16;
  const rotation = Math.floor(rng() * 360);
  return (
    `<circle cx="20" cy="20" r="${r}" fill="none" stroke-width="6" ` +
    `stroke-dasharray="${(circumference - gap).toFixed(2)} ${gap.toFixed(2)}" ` +
    `transform="rotate(${rotation} 20 20)" stroke="${tint}" />`
  );
}

function figureBars(rng: Rng, tint: string): string {
  const widths = [10 + rng() * 16, 10 + rng() * 16, 10 + rng() * 16];
  let bars = '';
  widths.forEach((w, i) => {
    const y = 9 + i * 8;
    const x = 20 - w / 2;
    bars += `<rect x="${x.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="5" rx="2.5" fill="${tint}" />`;
  });
  return bars;
}

function figureCorner(rng: Rng, tint: string): string {
  const r = 20;
  const corners = [
    `M4 4 L${4 + r} 4 A${r} ${r} 0 0 1 4 ${4 + r} Z`,
    `M36 4 L36 ${4 + r} A${r} ${r} 0 0 1 ${36 - r} 4 Z`,
    `M4 36 L4 ${36 - r} A${r} ${r} 0 0 1 ${4 + r} 36 Z`,
    `M36 36 L${36 - r} 36 A${r} ${r} 0 0 1 36 ${36 - r} Z`,
  ];
  const d = corners[Math.floor(rng() * corners.length)];
  return `<path d="${d}" fill="${tint}" />`;
}

function figureDiamond(rng: Rng, tint: string): string {
  const size = 12 + rng() * 6;
  const half = size / 2;
  return `<rect x="${(20 - half).toFixed(2)}" y="${(20 - half).toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" transform="rotate(45 20 20)" fill="${tint}" />`;
}

function figureChevron(rng: Rng, tint: string): string {
  const apexY = 11 + rng() * 6;
  return (
    `<path d="M9 27 L20 ${apexY.toFixed(2)} L31 27" fill="none" ` +
    `stroke="${tint}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />`
  );
}

function figureOffsetCircles(rng: Rng, tint: string): string {
  const r = 8 + rng() * 2;
  const dx = 4 + rng() * 4;
  const dy = 4 + rng() * 4;
  return (
    `<circle cx="${(16 - dx / 2).toFixed(2)}" cy="${(16 - dy / 2).toFixed(2)}" r="${r.toFixed(2)}" fill="${tint}" />` +
    `<circle cx="${(24 + dx / 2).toFixed(2)}" cy="${(24 + dy / 2).toFixed(2)}" r="${r.toFixed(2)}" fill="${tint}" fill-opacity="0.75" />`
  );
}

function figureSteppedTriangle(rng: Rng, tint: string): string {
  const rows = 4;
  const rowHeight = 6;
  const baseWidth = 8 + rng() * 4;
  let rects = '';
  for (let i = 0; i < rows; i++) {
    const width = baseWidth + (rows - 1 - i) * 6;
    const x = 20 - width / 2;
    const y = 30 - (i + 1) * rowHeight;
    rects += `<rect x="${x.toFixed(2)}" y="${y}" width="${width.toFixed(2)}" height="${rowHeight}" fill="${tint}" />`;
  }
  return rects;
}

const FIGURES: ((rng: Rng, tint: string) => string)[] = [
  figureBitGrid,
  figureRing,
  figureBars,
  figureCorner,
  figureDiamond,
  figureChevron,
  figureOffsetCircles,
  figureSteppedTriangle,
];

// Deterministic geometric avatar: a rounded-square ground in one of 12 muted
// hues, with one of 8 simple figures drawn over it in a lighter tint of the
// same hue. Same seed always yields byte-identical SVG.
export function avatarSvg(seed: string, size = 40): string {
  const rng = seededRng(seed);
  const hue = Math.floor(rng() * HUE_COUNT);
  const figureIndex = Math.floor(rng() * FIGURE_COUNT);
  const ground = hsl(hue, 34, 40);
  const tint = hsl(hue, 55, 78);
  const figure = FIGURES[figureIndex](rng, tint);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}">` +
    `<rect x="0" y="0" width="40" height="40" rx="8" fill="${ground}" />` +
    figure +
    `</svg>`
  );
}

export function avatarDataUri(seed: string, size = 40): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(seed, size))}`;
}
