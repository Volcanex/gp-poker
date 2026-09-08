import { describe, expect, test } from 'vitest';
import { handName } from './name.js';

describe('handName', () => {
  test('names every category the way a player says it', () => {
    const cases: [string[], string, string][] = [
      [['Ah', 'Kh', 'Qh', 'Jh', 'Th'], 'straight flush', 'Royal flush'],
      [['9h', '8h', '7h', '6h', '5h', '2c', '3d'], 'straight flush', 'Straight flush, nine high'],
      [['5h', '4h', '3h', '2h', 'Ah'], 'straight flush', 'Straight flush, five high'],
      [['7c', '7d', '7h', '7s', '2c'], 'four of a kind', 'Four of a kind, sevens'],
      [['Kc', 'Kd', 'Kh', '9s', '9c'], 'full house', 'Full house, kings over nines'],
      [['Kh', '9h', '7h', '4h', '2h'], 'flush', 'Flush, king high'],
      [['Ah', 'Kd', 'Qc', 'Js', 'Tc'], 'straight', 'Straight, ten to ace'],
      [['5h', '4d', '3c', '2s', 'Ac'], 'straight', 'Straight, ace to five'],
      [['6c', '6d', '6h', 'Ks', '2c'], 'three of a kind', 'Three of a kind, sixes'],
      [['Ac', 'Ad', '9h', '9s', '2c'], 'two pair', 'Two pair, aces and nines'],
      [['Kc', 'Kd', '9h', '5s', '2c'], 'pair', 'Pair of kings'],
      [['Ac', 'Kd', '9h', '5s', '3c'], 'high card', 'Ace high'],
    ];
    for (const [cards, category, name] of cases) {
      expect(handName(cards), cards.join(' ')).toEqual({ category, name });
    }
  });

  test('picks the best five out of seven', () => {
    expect(handName(['Ah', 'Ad', '7c', '7d', '7h', '2s', '3c']).name).toBe('Full house, sevens over aces');
  });

  test('refuses a holding it cannot evaluate', () => {
    expect(() => handName(['Ah', 'Ad', '7c', '7d'])).toThrow(/5 to 7 cards/);
  });
});
