import { describe, expect, it } from 'vitest';
import type { Card } from '@opentable/protocol';
import { cardIndex, comboIndex } from './cards.js';
import {
  MIN_BET_SAMPLE,
  MIN_HAND_SAMPLE,
  MIN_POSTFLOP_SAMPLE,
  aggressionFrequency,
  emptyStats,
  foldToBet,
  foldToCbet,
  passivity,
  ranksWithinRange,
  vpipRate,
} from './opponent.js';
import { rangeFromPercentiles, removeBlocked } from './range.js';

/* The four statistics the regular tier's deviations key on. Each one has to
   answer null until its sample is there, because a rule that fires on two
   hands is a rule that plays somebody else's poker. */

describe('opponent statistics', () => {
  it('says nothing until the sample is there', () => {
    const stats = emptyStats();
    expect(foldToBet(stats)).toBeNull();
    expect(foldToCbet(stats)).toBeNull();
    expect(aggressionFrequency(stats)).toBeNull();
    expect(vpipRate(stats)).toBeNull();
    expect(passivity(stats)).toBe(0);
  });

  it('reads a fold rate once enough bets have been answered', () => {
    const stats = emptyStats();
    stats.betsFaced = MIN_BET_SAMPLE;
    stats.foldsToOurBets = Math.round(MIN_BET_SAMPLE / 3);
    expect(foldToBet(stats)).toBeCloseTo(1 / 3, 2);
    // The flop rate is its own sample and is not implied by the total.
    expect(foldToCbet(stats)).toBeNull();
    stats.cbetsFaced = MIN_BET_SAMPLE;
    stats.foldsToOurCbets = MIN_BET_SAMPLE;
    expect(foldToCbet(stats)).toBe(1);
  });

  it('reads aggression and how many hands they play', () => {
    const stats = emptyStats();
    stats.aggressive = 5;
    stats.passive = MIN_POSTFLOP_SAMPLE - 5;
    expect(aggressionFrequency(stats)).toBeCloseTo(5 / MIN_POSTFLOP_SAMPLE, 3);
    stats.hands = MIN_HAND_SAMPLE;
    stats.vpip = MIN_HAND_SAMPLE;
    expect(vpipRate(stats)).toBe(1);
  });

  /* Passivity drives the solver tier's calling cut and is deliberately zero
     across the whole range a balanced player sits in, so an opponent nobody
     has read yet is played straight. */
  it('only calls somebody passive once they are past balanced', () => {
    const stats = emptyStats();
    stats.aggressive = 40;
    stats.passive = 60;
    expect(passivity(stats)).toBe(0);
    stats.aggressive = 5;
    stats.passive = 95;
    expect(passivity(stats)).toBe(1);
  });
});

describe('rank within a range', () => {
  it('puts the best hand at the top and the worst at the bottom', () => {
    const board = (['Ah', 'Kd', '7c', '2s', '9h'] as Card[]).map(cardIndex);
    const range = removeBlocked(rangeFromPercentiles(0, 100), board);
    const ranks = ranksWithinRange(range, board);
    // Two pair aces and kings against a hand that misses everything.
    const strong = comboIndex(cardIndex('As' as Card), cardIndex('Kh' as Card));
    const weak = comboIndex(cardIndex('3d' as Card), cardIndex('4c' as Card));
    expect(ranks[strong]).toBeGreaterThan(0.9);
    expect(ranks[weak]).toBeLessThan(0.3);
  });

  it('is half way up against a range that holds nothing', () => {
    const board = (['Ah', 'Kd', '7c'] as Card[]).map(cardIndex);
    const ranks = ranksWithinRange(new Float32Array(1326), board);
    expect(ranks[comboIndex(cardIndex('As' as Card), cardIndex('Ad' as Card))]).toBe(0.5);
  });
});
