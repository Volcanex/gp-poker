import { describe, expect, it } from 'vitest';
import { DEFAULTS, type Rating, updateRating } from '../src/glicko.js';

// Deterministic PRNG (mulberry32) so the simulation is reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function eloWinProbability(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

describe('glicko-2 simulation', () => {
  it('recovers the true strength ordering of five bots over 1000 random matches', () => {
    const rand = mulberry32(42);
    const trueRatings = [1200, 1400, 1600, 1800, 2000];
    const bots: Rating[] = trueRatings.map(() => ({ ...DEFAULTS }));

    for (let match = 0; match < 1000; match += 1) {
      const i = Math.floor(rand() * bots.length);
      let j = Math.floor(rand() * bots.length);
      while (j === i) j = Math.floor(rand() * bots.length);

      const pIWins = eloWinProbability(trueRatings[i], trueRatings[j]);
      const iWins = rand() < pIWins;
      const scoreI = iWins ? 1 : 0;
      const scoreJ = iWins ? 0 : 1;

      const [nextI, nextJ] = [
        updateRating(bots[i], [{ rating: bots[j].rating, rd: bots[j].rd, score: scoreI }]),
        updateRating(bots[j], [{ rating: bots[i].rating, rd: bots[i].rd, score: scoreJ }]),
      ];
      bots[i] = nextI;
      bots[j] = nextJ;
    }

    const finalOrder = bots
      .map((r, idx) => ({ idx, rating: r.rating }))
      .sort((a, b) => b.rating - a.rating)
      .map((x) => x.idx);
    expect(finalOrder).toEqual([4, 3, 2, 1, 0]);

    for (const bot of bots) {
      expect(bot.rd).toBeLessThan(110);
    }

    const top = Math.max(...bots.map((b) => b.rating));
    const bottom = Math.min(...bots.map((b) => b.rating));
    expect(top - bottom).toBeGreaterThanOrEqual(400);
  });
});
