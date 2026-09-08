import { describe, expect, test } from 'vitest';
import { accuracy, callIsRight, dealSpot, requiredEquity, scoreAfter, type Spot } from '../tools/odds.tsx';
import { readCards } from '../tools/cards.tsx';

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
