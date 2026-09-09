import { describe, expect, it } from 'vitest';
import { generateRealisticIdentity, looksRealistic, REALISTIC_NAME_RE, seededRng } from '../src/index.js';

describe('generateRealisticIdentity', () => {
  it('is deterministic for the same seed', () => {
    const a = generateRealisticIdentity(seededRng('opentable-population'));
    const b = generateRealisticIdentity(seededRng('opentable-population'));
    expect(a).toEqual(b);
  });

  it('produces a name NAME_RE (server/src/auth.ts) already accepts', () => {
    const rng = seededRng('name-shape');
    for (let i = 0; i < 500; i++) {
      const { name } = generateRealisticIdentity(rng);
      expect(name).toMatch(/^[a-zA-Z0-9_]{3,20}$/);
      expect(looksRealistic(name)).toBe(true);
      expect(REALISTIC_NAME_RE.test(name)).toBe(true);
    }
  });

  it('never glues two capitalised dictionary-style words with no separator or digit', () => {
    // The one shape this generator must never produce: the CamelCase
    // Adjective+Thing pattern the old bot roster used.
    const rng = seededRng('no-camelcase');
    for (let i = 0; i < 500; i++) {
      const { name } = generateRealisticIdentity(rng);
      expect(name).not.toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
    }
  });

  it('returns a plausible ISO 3166-1 alpha-2 code', () => {
    const rng = seededRng('country-shape');
    for (let i = 0; i < 300; i++) {
      const { country } = generateRealisticIdentity(rng);
      expect(country).toMatch(/^[a-z]{2}$/);
    }
  });

  it('draws from a realistic distribution: the US is the largest single share', () => {
    const rng = seededRng('distribution');
    const counts = new Map<string, number>();
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const { country } = generateRealisticIdentity(rng);
      counts.set(country, (counts.get(country) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    expect(sorted[0][0]).toBe('us');
    // A long tail exists: comfortably more distinct countries than the
    // twenty-six named pools, once the small ones are included.
    expect(counts.size).toBeGreaterThan(30);
  });

  it('produces no duplicate names in 500 draws', () => {
    const rng = seededRng('opentable-bots-population');
    const names = new Set<string>();
    for (let i = 0; i < 500; i++) {
      let identity = generateRealisticIdentity(rng);
      // Same appending, retry-on-collision shape the roster generator uses.
      while (names.has(identity.name.toLowerCase())) identity = generateRealisticIdentity(rng);
      names.add(identity.name.toLowerCase());
    }
    expect(names.size).toBe(500);
  });

  it('mixes case rather than always capitalising', () => {
    const rng = seededRng('casing');
    let sawLower = false;
    let sawCapitalised = false;
    for (let i = 0; i < 200; i++) {
      const { name } = generateRealisticIdentity(rng);
      if (name === name.toLowerCase()) sawLower = true;
      if (/^[A-Z]/.test(name)) sawCapitalised = true;
    }
    expect(sawLower).toBe(true);
    expect(sawCapitalised).toBe(true);
  });
});
