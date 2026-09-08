import { describe, expect, test } from 'vitest';
import { mulberry32 } from './cards.js';
import { equity } from './equity.js';
import { parseRange } from './range.js';

const seeded = () => ({ rng: mulberry32(42) });

describe('equity', () => {
  test('AA against KK preflop', () => {
    const r = equity(['Ah', 'Ad'], [], [parseRange('KK')], seeded());
    expect(r.exact).toBe(false);
    expect(Math.abs(r.equity * 100 - 81.9)).toBeLessThan(1);
  });

  test('AKs against QQ preflop', () => {
    const r = equity(['As', 'Ks'], [], [parseRange('QQ')], seeded());
    expect(r.equity * 100).toBeGreaterThan(44);
    expect(r.equity * 100).toBeLessThan(48);
  });

  /* Hero has four hearts and nothing else: an ace pairs into the villain's
     trips, a king or an eight is second best, no straight is possible and the
     board cannot pair into a full house. The villain's range is pinned to three
     combinations of black aces because hero holds the ace of hearts, so every
     one of them plays the same. Exactly the nine remaining hearts win, out of
     the forty four cards that can come. */
  test('a nine out flush draw on the turn is exactly 9/44', () => {
    const r = equity(['Ah', '8h'], ['Kh', '3h', 'Jc', '2d'], [parseRange('AA')]);
    expect(r.exact).toBe(true);
    expect(r.win).toBeCloseTo(9 / 44, 12);
    expect(r.tie).toBe(0);
    expect(r.equity).toBeCloseTo(9 / 44, 12);
  });

  test('a heads-up river is enumerated, and quickly', () => {
    const start = performance.now();
    const r = equity(['Ah', '8h'], ['Kh', '3h', 'Jc', '2d', '7s'], ['random']);
    const ms = performance.now() - start;
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(990);
    expect(r.win + r.tie + r.lose).toBeCloseTo(1, 12);
    expect(ms).toBeLessThan(50);
  });

  test('the turn against one random hand is exact, the flop is sampled', () => {
    expect(equity(['Ah', '8h'], ['Kh', '3h', 'Jc', '2d'], ['random']).exact).toBe(true);
    expect(equity(['Ah', '8h'], ['Kh', '3h', 'Jc'], ['random'], seeded()).exact).toBe(false);
  });

  test('multiway equity falls as opponents are added', () => {
    const one = equity(['Ah', 'Ad'], [], ['random'], seeded()).equity;
    const three = equity(['Ah', 'Ad'], [], ['random', 'random', 'random'], seeded()).equity;
    expect(one).toBeGreaterThan(0.8);
    expect(three).toBeLessThan(one);
    expect(three).toBeGreaterThan(0.5);
  });

  test('a split pot is a tie, not a win', () => {
    const r = equity(['Ah', 'Kh'], ['Ac', 'Kc', 'Qd', 'Js', 'Tc'], [parseRange('AK')]);
    expect(r.exact).toBe(true);
    expect(r.tie).toBe(1);
    expect(r.equity).toBeCloseTo(0.5, 12);
  });

  test('says so when a range has no hand left to deal', () => {
    expect(() => equity(['Ah', 'Ad'], ['Ac', 'As', '2d'], [parseRange('AA')])).toThrow(/no hands left/);
  });

  /* The replay knows every hand at the end of it, and against a known holding
     there is one assignment rather than a thousand, so the flop enumerates
     exactly instead of being sampled. */
  test('a villain can be the hand they actually held', () => {
    const r = equity(['Ah', 'Ad'], ['Kh', '3s', '8c'], [['Kc', 'Kd']]);
    expect(r.exact).toBe(true);
    expect(r.equity).toBeLessThan(0.2);
    expect(r.win + r.tie + r.lose).toBeCloseTo(1, 12);
  });

  test('a known hand and an unknown one sit in the same call', () => {
    const r = equity(['Ah', 'Ad'], ['Kh', '3s', '8c', '2d'], [['Kc', 'Kd'], 'random']);
    expect(r.equity).toBeGreaterThan(0);
    expect(r.equity).toBeLessThan(0.25);
  });

  test('says so when the hand a villain held is already on the board', () => {
    expect(() => equity(['Ah', 'Ad'], ['Kh', '3s', '8c'], [['Kh', 'Kd']])).toThrow(/no hands left/);
  });

  test('refuses a hero that is not two cards, or a card dealt twice', () => {
    expect(() => equity(['Ah'], [], ['random'])).toThrow(/two cards/);
    expect(() => equity(['Ah', 'Ad'], ['Ah'], ['random'])).toThrow(/twice/);
  });
});
