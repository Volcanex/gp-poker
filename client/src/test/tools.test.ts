import { describe, expect, test } from 'vitest';
import {
  accuracy,
  answerIsRight,
  callIsRight,
  dealSpot,
  priceRatio,
  readStreets,
  requiredEquity,
  scoreAfter,
  streakTone,
  timedOut,
  timerLeft,
  verdictLine,
  TIMER_MS,
  type Spot,
} from '../tools/odds.tsx';
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

describe('the price as a player says it', () => {
  test('reduces to whole numbers, and falls back to against one', () => {
    expect(priceRatio(52, 26)).toBe('2 to 1');
    expect(priceRatio(100, 50)).toBe('2 to 1');
    expect(priceRatio(30, 20)).toBe('3 to 2');
    expect(priceRatio(24, 8)).toBe('3 to 1');
    /* 37 to 14 is nothing anybody quotes, so it is read against one. */
    expect(priceRatio(37, 14)).toBe('2.6 to 1');
    expect(priceRatio(0, 10)).toBe('');
    expect(priceRatio(10, 0)).toBe('');
  });

  test('the verdict names the action and both numbers', () => {
    expect(verdictLine(0.41, spot(52, 26))).toBe('Call. You win 41% and needed 33%.');
    expect(verdictLine(0.12, spot(50, 50))).toBe('Fold. You win 12% and needed 50%.');
  });
});

describe('the streak tones', () => {
  test('steps at three, five and ten and nowhere else', () => {
    expect([0, 1, 2].map(streakTone)).toEqual(['none', 'none', 'none']);
    expect([3, 4].map(streakTone)).toEqual(['warm', 'warm']);
    expect([5, 6, 9].map(streakTone)).toEqual(['hot', 'hot', 'hot']);
    expect([10, 40].map(streakTone)).toEqual(['blaze', 'blaze']);
  });
});

describe('the timer', () => {
  test('the bar depletes and clamps at both ends', () => {
    expect(timerLeft(0)).toBe(1);
    expect(timerLeft(TIMER_MS / 2)).toBeCloseTo(0.5, 12);
    expect(timerLeft(TIMER_MS)).toBe(0);
    /* A tab that slept through the spot comes back to an empty bar, not a
       negative one. */
    expect(timerLeft(TIMER_MS * 4)).toBe(0);
    expect(timerLeft(-500)).toBe(1);
  });

  test('running out of time is a wrong answer whatever the equity said', () => {
    const s = spot(100, 50);
    expect(timedOut(TIMER_MS - 1)).toBe(false);
    expect(timedOut(TIMER_MS)).toBe(true);
    expect(answerIsRight('timeout', 0.9, s)).toBe(false);
    expect(answerIsRight('timeout', 0.1, s)).toBe(false);
    expect(answerIsRight('call', 0.9, s)).toBe(true);
    expect(answerIsRight('fold', 0.1, s)).toBe(true);
  });
});

describe('the street filter', () => {
  test('anything unreadable or empty means every street', () => {
    expect(readStreets(['turn', 'flop'])).toEqual(['flop', 'turn']);
    expect(readStreets(['river'])).toEqual(['river']);
    expect(readStreets([])).toEqual(['flop', 'turn', 'river']);
    expect(readStreets(['preflop'])).toEqual(['flop', 'turn', 'river']);
    expect(readStreets(undefined)).toEqual(['flop', 'turn', 'river']);
    expect(readStreets('flop')).toEqual(['flop', 'turn', 'river']);
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
  test('a spot is legal: no card twice, a real street, a price worth asking', () => {
    let random = 0;
    const cycle = () => {
      random = (random + 0.137) % 1;
      return random;
    };
    for (let i = 0; i < 200; i++) {
      const s = dealSpot(cycle);
      const cards = [...s.hero, ...s.board];
      expect(new Set(cards).size).toBe(cards.length);
      expect([3, 4, 5]).toContain(s.board.length);
      expect(s.bet).toBeGreaterThan(0);
      expect(s.pot).toBeGreaterThanOrEqual(10);
      expect([1, 2]).toContain(s.opponents);
    }
  });

  test('the filter is the only street that gets dealt', () => {
    let random = 0;
    const cycle = () => {
      random = (random + 0.137) % 1;
      return random;
    };
    for (let i = 0; i < 100; i++) {
      expect(dealSpot(cycle, ['river']).board).toHaveLength(5);
      expect([3, 4]).toContain(dealSpot(cycle, ['flop', 'turn']).board.length);
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
