import { describe, expect, it } from 'vitest';
import {
  ADJECTIVES,
  NAME_CAPACITY,
  THINGS,
  VERBS,
  generateName,
  isGeneratedName,
  seededRng,
} from '../src/index.js';

describe('NAME_CAPACITY', () => {
  it('matches the word list sizes', () => {
    expect(NAME_CAPACITY.two).toBe(ADJECTIVES.length * THINGS.length);
    expect(NAME_CAPACITY.three).toBe(ADJECTIVES.length * (ADJECTIVES.length + VERBS.length) * THINGS.length);
  });

  it('the two-word space exceeds 70,000', () => {
    expect(NAME_CAPACITY.two).toBeGreaterThan(70_000);
  });

  it('the three-word space exceeds 10 million', () => {
    expect(NAME_CAPACITY.three).toBeGreaterThan(10_000_000);
  });
});

describe('generateName', () => {
  it('produces a two-word CamelCase name by default', () => {
    const name = generateName(seededRng('a'));
    expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
    expect(isGeneratedName(name)).toBe(true);
  });

  it('produces a three-word CamelCase name on request', () => {
    const name = generateName(seededRng('b'), 3);
    expect(name).toMatch(/^([A-Z][a-z]+){3}$/);
    expect(isGeneratedName(name)).toBe(true);
  });

  it('is deterministic for a given rng seed', () => {
    expect(generateName(seededRng('same-seed'))).toBe(generateName(seededRng('same-seed')));
    expect(generateName(seededRng('same-seed'), 3)).toBe(generateName(seededRng('same-seed'), 3));
  });

  it('varies with the seed', () => {
    const names = new Set(Array.from({ length: 50 }, (_, i) => generateName(seededRng(`seed-${i}`))));
    expect(names.size).toBeGreaterThan(40);
  });

});

describe('isGeneratedName', () => {
  it('accepts names produced by generateName', () => {
    for (let i = 0; i < 100; i++) {
      const words = i % 2 === 0 ? 2 : 3;
      const name = generateName(seededRng(`check-${i}`), words as 2 | 3);
      expect(isGeneratedName(name)).toBe(true);
    }
  });

  it('rejects a name with no valid parse', () => {
    expect(isGeneratedName('Zzzzznotaword')).toBe(false);
    expect(isGeneratedName('')).toBe(false);
    expect(isGeneratedName('lowercase')).toBe(false);
    expect(isGeneratedName('Has123Numbers')).toBe(false);
  });

  it('accepts a hand-built two-word combination', () => {
    expect(isGeneratedName(ADJECTIVES[0] + THINGS[0])).toBe(true);
  });

  it('accepts a hand-built adjective+adjective+thing combination', () => {
    expect(isGeneratedName(ADJECTIVES[0] + ADJECTIVES[1] + THINGS[0])).toBe(true);
  });

  it('accepts a hand-built adjective+verb+thing combination', () => {
    expect(isGeneratedName(ADJECTIVES[0] + VERBS[0] + THINGS[0])).toBe(true);
  });
});
