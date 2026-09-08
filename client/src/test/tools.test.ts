import { describe, expect, test } from 'vitest';
import { accuracy, callIsRight, dealSpot, requiredEquity, scoreAfter, type Spot } from '../tools/odds.tsx';
import { readCards } from '../tools/cards.tsx';
import { DIVERGE_CAP, HEAT_CAP, rampFill, rampHue, rangeHeat, RANGE_FLOOR } from '../tools/ramp.ts';
import { CELL_ENTER, centreDelay, GRID_SIZE, WAVE_SPAN } from '../ui/grid-entrance.ts';

const spot = (pot: number, bet: number): Spot => ({ hero: ['Ah', 'Kd'], board: ['2c', '7s', '9h'], pot, bet, opponents: 1 });

describe('pot odds', () => {
  test('the price is the call as a share of the pot it would win', () => {
    expect(requiredEquity(spot(100, 100))).toBeCloseTo(0.5, 12);
    expect(requiredEquity(spot(100, 50))).toBeCloseTo(1 / 3, 12);
    expect(requiredEquity(spot(90, 10))).toBeCloseTo(0.1, 12);
  });

  test('calling is right exactly when equity clears the price', () => {
    expect(callIsRight(0.34, spot(100, 50))).toBe(true);
    expect(callIsRight(0.3, spot(100, 50))).toBe(false);
    expect(callIsRight(1 / 3, spot(100, 50))).toBe(true);
  });
});

describe('scoring', () => {
  test('a streak grows and resets, the best one is kept', () => {
    let score = { right: 0, total: 0, streak: 0, best: 0 };
    score = scoreAfter(score, true);
    score = scoreAfter(score, true);
    expect(score).toEqual({ right: 2, total: 2, streak: 2, best: 2 });
    score = scoreAfter(score, false);
    expect(score).toEqual({ right: 2, total: 3, streak: 0, best: 2 });
    expect(accuracy(score)).toBeCloseTo(66.67, 1);
    expect(accuracy({ right: 0, total: 0, streak: 0, best: 0 })).toBe(0);
  });
});

describe('dealing', () => {
  test('a spot is legal: no card twice, a flop or a turn, a price worth asking', () => {
    let random = 0;
    const cycle = () => {
      random = (random + 0.137) % 1;
      return random;
    };
    for (let i = 0; i < 200; i++) {
      const s = dealSpot(cycle);
      const cards = [...s.hero, ...s.board];
      expect(new Set(cards).size).toBe(cards.length);
      expect([3, 4]).toContain(s.board.length);
      expect(s.bet).toBeGreaterThan(0);
      expect(s.pot).toBeGreaterThanOrEqual(10);
      expect([1, 2]).toContain(s.opponents);
    }
  });
});

describe('reading cards typed by hand', () => {
  test('takes the shapes a player types, refuses the rest', () => {
    expect(readCards('AhKd2c')).toEqual(['Ah', 'Kd', '2c']);
    expect(readCards('ah kd, 2C')).toEqual(['Ah', 'Kd', '2c']);
    expect(readCards('')).toEqual([]);
    expect(readCards('Ah K')).toBe(null);
    expect(readCards('AhAh')).toBe(null);
    expect(readCards('Zh')).toBe(null);
  });
});

describe('the heat ramp', () => {
  test('zero is the bare surface and one is the cap, nothing goes past either', () => {
    expect(rampFill(0)).toBe(0);
    expect(rampFill(1)).toBe(HEAT_CAP);
    expect(rampFill(1, DIVERGE_CAP)).toBe(DIVERGE_CAP);
    expect(rampFill(1.4)).toBe(HEAT_CAP);
    expect(rampFill(-0.3)).toBe(0);
    expect(rampFill(Number.NaN)).toBe(0);
  });

  test('it rises all the way up, and spends more of itself low down', () => {
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const fill = rampFill(t);
      expect(fill).toBeGreaterThan(last);
      last = fill;
    }
    /* The point of the gamma: a quarter of the way up is visibly a quarter,
       which a linear mix into the surface is not. */
    expect(rampFill(0.25)).toBeGreaterThan(HEAT_CAP * 0.25);
    expect(rampFill(0.5)).toBeGreaterThan(HEAT_CAP * 0.5);
  });

  test('the hue travels the whole way, linearly', () => {
    expect(rampHue(0)).toBe(0);
    expect(rampHue(0.5)).toBe(50);
    expect(rampHue(1)).toBe(100);
    expect(rampHue(9)).toBe(100);
  });

  test('a hand in the range is hottest when it enters first', () => {
    /* The top 20 percent: the best hand is at the top of the ramp, the hand
       that only just made the cut sits on the floor, never at zero, or a
       selected cell would look unselected. */
    expect(rangeHeat(0, 20)).toBe(1);
    expect(rangeHeat(20, 20)).toBeCloseTo(RANGE_FLOOR, 12);
    expect(rangeHeat(10, 20)).toBeCloseTo(RANGE_FLOOR + (1 - RANGE_FLOOR) * 0.5, 12);
    /* The ramp is relative to the slider, not absolute: widening the slice
       moves a hand that was already in it further up the ramp, because it now
       entered earlier in the range on show. */
    expect(rangeHeat(10, 40)).toBeGreaterThan(rangeHeat(10, 20));
    /* An empty slice has nothing to rank against. */
    expect(rangeHeat(0, 0)).toBe(1);
  });
});

describe('the grid entrance', () => {
  test('it radiates from the centre, so a cell is later the further out it is', () => {
    const mid = (GRID_SIZE - 1) / 2;
    expect(centreDelay(mid, mid)).toBe(0);
    expect(centreDelay(0, 0)).toBeCloseTo(WAVE_SPAN, 12);
    expect(centreDelay(12, 12)).toBeCloseTo(WAVE_SPAN, 12);
    expect(centreDelay(0, 12)).toBeCloseTo(WAVE_SPAN, 12);
    /* A ring is a ring: same distance out, same moment, whichever way. */
    expect(centreDelay(mid - 2, mid)).toBeCloseTo(centreDelay(mid, mid + 2), 12);
    /* Strictly outward, not row by row. */
    expect(centreDelay(mid - 1, mid)).toBeLessThan(centreDelay(mid - 3, mid));
    expect(centreDelay(0, mid)).toBeLessThan(centreDelay(0, 0));
  });

  test('the whole wave lands inside the budget for a page entrance', () => {
    let worst = 0;
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) worst = Math.max(worst, centreDelay(r, c));
    }
    expect(worst + CELL_ENTER).toBeLessThan(0.6);
    expect(CELL_ENTER).toBeGreaterThanOrEqual(0.12);
    expect(CELL_ENTER).toBeLessThanOrEqual(0.2);
  });
});
