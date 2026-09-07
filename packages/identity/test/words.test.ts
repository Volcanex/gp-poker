import { describe, expect, it } from 'vitest';
import { ADJECTIVES, THINGS, VERBS } from '../src/words.js';

const WORD_RE = /^[A-Za-z]+$/;

function checkList(name: string, list: string[], min: number) {
  it(`${name} has at least ${min} words`, () => {
    expect(list.length).toBeGreaterThanOrEqual(min);
  });

  it(`${name} words are letters only, 3-9 characters, capitalised`, () => {
    for (const word of list) {
      expect(word).toMatch(WORD_RE);
      expect(word.length).toBeGreaterThanOrEqual(3);
      expect(word.length).toBeLessThanOrEqual(9);
      expect(word[0]).toBe(word[0].toUpperCase());
      expect(word.slice(1)).toBe(word.slice(1).toLowerCase());
    }
  });

  it(`${name} has no duplicates`, () => {
    expect(new Set(list).size).toBe(list.length);
  });
}

describe('ADJECTIVES', () => checkList('ADJECTIVES', ADJECTIVES, 220));
describe('THINGS', () => checkList('THINGS', THINGS, 320));
describe('VERBS', () => checkList('VERBS', VERBS, 120));

describe('cross-list hygiene', () => {
  it('no word appears in more than one list', () => {
    const adjectives = new Set(ADJECTIVES);
    const things = new Set(THINGS);
    const verbs = new Set(VERBS);
    for (const word of adjectives) expect(things.has(word) || verbs.has(word)).toBe(false);
    for (const word of things) expect(adjectives.has(word) || verbs.has(word)).toBe(false);
    for (const word of verbs) expect(adjectives.has(word) || things.has(word)).toBe(false);
  });
});
