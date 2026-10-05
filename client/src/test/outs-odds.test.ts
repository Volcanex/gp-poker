import { describe, expect, test } from 'vitest';
import { oddsAgainst, outsOdds } from '../analysis/outs-odds.ts';

describe('outs hit odds', () => {
  test('nine outs use 47 unseen cards on the flop and 46 on the turn', () => {
    const flop = outsOdds(9, 3)!;
    expect(flop.next).toBeCloseTo(9 / 47, 12);
    expect(flop.river).toBeCloseTo(1 - (38 * 37) / (47 * 46), 12);
    expect(oddsAgainst(flop.next)).toBe('4.2 to 1');
    expect(oddsAgainst(flop.river!)).toBe('1.9 to 1');
    expect(outsOdds(9, 4)).toEqual({ next: 9 / 46, river: null });
    expect(oddsAgainst(9 / 46)).toBe('4.1 to 1');
  });

  test('the flop runout is counted without replacement', () => {
    for (const outs of [1, 4, 8, 15]) {
      let hits = 0;
      for (let first = 0; first < 47; first++) {
        for (let second = first + 1; second < 47; second++) {
          if (first < outs || second < outs) hits++;
        }
      }
      expect(outsOdds(outs, 3)?.river).toBeCloseTo(hits / 1081, 12);
    }
  });

  test('zero outs never hit, and every unseen card is certain to hit', () => {
    expect(outsOdds(0, 3)).toEqual({ next: 0, river: 0 });
    expect(oddsAgainst(0)).toBe('∞ to 1');
    expect(outsOdds(47, 3)).toEqual({ next: 1, river: 1 });
    expect(outsOdds(46, 4)).toEqual({ next: 1, river: null });
    expect(oddsAgainst(1)).toBe('0.0 to 1');
  });

  test('preflop and river have no outs reading', () => {
    expect(outsOdds(9, 0)).toBeNull();
    expect(outsOdds(9, 5)).toBeNull();
  });
});
