import { describe, expect, it } from 'vitest';
import { DEFAULTS, RD_WIDEN_C, expectedScore, isProvisional, updateRating, widenRd } from '../src/glicko.js';

describe('updateRating', () => {
  it('matches the worked example from the glicko-2 paper', () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const result = updateRating(
      player,
      [
        { rating: 1400, rd: 30, score: 1 },
        { rating: 1550, rd: 100, score: 0 },
        { rating: 1700, rd: 300, score: 0 },
      ],
      0.5
    );

    expect(Math.abs(result.rating - 1464.06)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(result.rd - 151.52)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(result.volatility - 0.05999)).toBeLessThanOrEqual(0.00001);
  });

  it('only widens rd for an empty results array', () => {
    const player = { rating: 1600, rd: 80, volatility: 0.06 };
    const result = updateRating(player, [], DEFAULTS.tau);

    expect(result.rating).toBe(player.rating);
    expect(result.volatility).toBe(player.volatility);
    expect(result.rd).toBeGreaterThan(player.rd);
  });

  it('shrinks rd after a result', () => {
    const player = { rating: 1500, rd: 350, volatility: 0.06 };
    const result = updateRating(player, [{ rating: 1500, rd: 100, score: 1 }]);
    expect(result.rd).toBeLessThan(player.rd);
  });

  it('moves rating up on a win and down on a loss', () => {
    const player = { rating: 1500, rd: 100, volatility: 0.06 };
    const opponent = { rating: 1500, rd: 100 };

    const win = updateRating(player, [{ ...opponent, score: 1 }]);
    const loss = updateRating(player, [{ ...opponent, score: 0 }]);

    expect(win.rating).toBeGreaterThan(player.rating);
    expect(loss.rating).toBeLessThan(player.rating);
  });

  it('is symmetric zero-sum-ish between two equal players', () => {
    const a = { rating: 1500, rd: 100, volatility: 0.06 };
    const b = { rating: 1500, rd: 100, volatility: 0.06 };

    const aAfter = updateRating(a, [{ rating: b.rating, rd: b.rd, score: 1 }]);
    const bAfter = updateRating(b, [{ rating: a.rating, rd: a.rd, score: 0 }]);

    expect(aAfter.rating - a.rating).toBeCloseTo(a.rating - bAfter.rating, 6);
  });

  it('floors rd at 30 and caps it at 350', () => {
    const settled = { rating: 1500, rd: 30, volatility: 0.03 };
    const results = Array.from({ length: 50 }, () => ({ rating: 1500, rd: 30, score: 0.5 as const }));
    const afterMany = updateRating(settled, results);
    expect(afterMany.rd).toBeGreaterThanOrEqual(30);

    const wide = widenRd({ rating: 1500, rd: 340, volatility: 0.06 }, 10000);
    expect(wide.rd).toBe(350);
  });
});

describe('widenRd', () => {
  it('grows rd toward the cap and returns a settled player to 350 after 730 days', () => {
    const settled = { rating: 1500, rd: 50, volatility: 0.06 };
    const widened = widenRd(settled, 730);
    expect(widened.rd).toBeCloseTo(350, 6);
  });

  it('never exceeds the 350 cap', () => {
    const widened = widenRd({ rating: 1500, rd: 349, volatility: 0.06 }, 100000);
    expect(widened.rd).toBe(350);
  });

  it('exports the widening constant used by the cap derivation', () => {
    expect(RD_WIDEN_C).toBeCloseTo(Math.sqrt((350 ** 2 - 50 ** 2) / 730), 10);
  });
});

describe('isProvisional', () => {
  it('is true above rd 110 and false at or below it', () => {
    expect(isProvisional({ rating: 1500, rd: 111, volatility: 0.06 })).toBe(true);
    expect(isProvisional({ rating: 1500, rd: 110, volatility: 0.06 })).toBe(false);
  });
});

describe('expectedScore', () => {
  it('is 0.5 between identical ratings', () => {
    const a = { rating: 1500, rd: 100, volatility: 0.06 };
    const b = { rating: 1500, rd: 100, volatility: 0.06 };
    expect(expectedScore(a, b)).toBeCloseTo(0.5, 6);
  });

  it('favors the higher-rated player', () => {
    const strong = { rating: 1800, rd: 50, volatility: 0.06 };
    const weak = { rating: 1200, rd: 50, volatility: 0.06 };
    expect(expectedScore(strong, weak)).toBeGreaterThan(0.5);
    expect(expectedScore(weak, strong)).toBeLessThan(0.5);
  });
});
