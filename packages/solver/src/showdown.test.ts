import { describe, expect, it } from 'vitest';
import { evaluateCardCodes } from 'phe';
import { cardIndex } from './cards.js';
import { emptyRange, rangeFromPercentiles, removeBlocked } from './range.js';
import { accumulateShowdown, foldValues, projectRange, rankBoard, universeOf } from './showdown.js';
import type { Card } from '@opentable/protocol';

const board = (['Ah', 'Kd', '7c', '2s', '9h'] as Card[]).map(cardIndex);

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('showdown sweep', () => {
  it('matches a pairwise comparison of every combo', () => {
    const hero = removeBlocked(rangeFromPercentiles(0, 40), board);
    const villain = removeBlocked(rangeFromPercentiles(0, 60), board);
    const u = universeOf(hero, villain, board);
    const ranked = rankBoard(u, board);
    const oppW = projectRange(u, villain);

    const out = new Float32Array(u.n);
    accumulateShowdown(u, ranked, oppW, 10, out);

    const ranks = new Int32Array(u.n);
    for (let p = 0; p < u.n; p++) ranks[p] = evaluateCardCodes([...board, u.cardA[p], u.cardB[p]]);

    for (let i = 0; i < u.n; i++) {
      let expected = 0;
      for (let j = 0; j < u.n; j++) {
        if (u.cardA[j] === u.cardA[i] || u.cardA[j] === u.cardB[i]) continue;
        if (u.cardB[j] === u.cardA[i] || u.cardB[j] === u.cardB[i]) continue;
        if (ranks[j] > ranks[i]) expected += 10 * oppW[j];
        else if (ranks[j] < ranks[i]) expected -= 10 * oppW[j];
      }
      expect(out[i]).toBeCloseTo(expected, 2);
    }
  });

  it('accumulates rather than overwrites', () => {
    const hero = removeBlocked(rangeFromPercentiles(0, 20), board);
    const u = universeOf(hero, hero, board);
    const ranked = rankBoard(u, board);
    const oppW = projectRange(u, hero);
    const once = new Float32Array(u.n);
    const twice = new Float32Array(u.n);
    accumulateShowdown(u, ranked, oppW, 3, once);
    accumulateShowdown(u, ranked, oppW, 3, twice);
    accumulateShowdown(u, ranked, oppW, 3, twice);
    for (let i = 0; i < u.n; i++) expect(twice[i]).toBeCloseTo(2 * once[i], 3);
  });

  it('values a fold by the opponent weight that does not block us', () => {
    const rng = mulberry32(4);
    const villain = emptyRange();
    for (let i = 0; i < villain.length; i++) villain[i] = rng() < 0.3 ? rng() : 0;
    removeBlocked(villain, board);
    const u = universeOf(villain, villain, board);
    const oppW = projectRange(u, villain);
    const out = new Float32Array(u.n);
    foldValues(u, oppW, -2, out);

    for (let i = 0; i < u.n; i++) {
      let expected = 0;
      for (let j = 0; j < u.n; j++) {
        if (u.cardA[j] === u.cardA[i] || u.cardA[j] === u.cardB[i]) continue;
        if (u.cardB[j] === u.cardA[i] || u.cardB[j] === u.cardB[i]) continue;
        expected += -2 * oppW[j];
      }
      expect(out[i]).toBeCloseTo(expected, 2);
    }
  });

  it('is zero sum over the two ranges at a showdown', () => {
    const hero = removeBlocked(rangeFromPercentiles(0, 30), board);
    const villain = removeBlocked(rangeFromPercentiles(10, 70), board);
    const u = universeOf(hero, villain, board);
    const ranked = rankBoard(u, board);
    const h = projectRange(u, hero);
    const v = projectRange(u, villain);

    const heroValues = new Float32Array(u.n);
    const villainValues = new Float32Array(u.n);
    accumulateShowdown(u, ranked, v, 1, heroValues);
    accumulateShowdown(u, ranked, h, 1, villainValues);

    let sum = 0;
    for (let i = 0; i < u.n; i++) sum += h[i] * heroValues[i] + v[i] * villainValues[i];
    expect(Math.abs(sum)).toBeLessThan(1e-2);
  });
});
