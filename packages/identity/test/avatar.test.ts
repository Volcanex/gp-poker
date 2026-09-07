import { describe, expect, it } from 'vitest';
import { avatarDataUri, avatarSvg, seededRng } from '../src/index.js';

function isWellFormedSvg(svg: string): boolean {
  if (!svg.startsWith('<svg')) return false;
  if (!svg.endsWith('</svg>')) return false;
  const tags = svg.match(/<\/?[a-zA-Z][^<>]*>/g) ?? [];
  let opens = 0;
  for (const tag of tags) {
    if (tag.startsWith('</')) opens--;
    else if (!tag.endsWith('/>')) opens++;
  }
  return tags.length > 0 && opens === 0;
}

describe('avatarSvg', () => {
  it('is byte-identical for the same seed', () => {
    expect(avatarSvg('gabriel')).toBe(avatarSvg('gabriel'));
    expect(avatarSvg('gabriel', 96)).toBe(avatarSvg('gabriel', 96));
  });

  it('produces well-formed, sized SVG', () => {
    const svg = avatarSvg('a-user-id', 64);
    expect(isWellFormedSvg(svg)).toBe(true);
    expect(svg).toContain('viewBox="0 0 40 40"');
    expect(svg).toContain('width="64"');
    expect(svg).toContain('height="64"');
  });

  it('has no text and no gradients', () => {
    const svg = avatarSvg('another-seed');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('Gradient');
  });

  it('differs for most seeds', () => {
    const seeds = Array.from({ length: 100 }, (_, i) => `seed-${i}`);
    const rendered = new Set(seeds.map((s) => avatarSvg(s)));
    expect(rendered.size).toBeGreaterThanOrEqual(95);
  });

  it('covers the full hue and figure range over many seeds', () => {
    const hues = new Set<number>();
    const figures = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const rng = seededRng(`cover-${i}`);
      hues.add(Math.floor(rng() * 12));
      figures.add(Math.floor(rng() * 8));
    }
    expect(hues.size).toBe(12);
    expect(figures.size).toBe(8);
  });

  it('every seed used elsewhere in this suite renders without throwing', () => {
    for (const seed of ['', 'x', 'a very long seed string indeed', '0000000000']) {
      expect(() => avatarSvg(seed)).not.toThrow();
    }
  });
});

describe('avatarDataUri', () => {
  it('wraps the svg as an encoded data uri', () => {
    const uri = avatarDataUri('gabriel', 40);
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length))).toBe(avatarSvg('gabriel', 40));
  });
});
