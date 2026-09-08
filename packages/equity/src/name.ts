/* Names a five to seven card holding the way a player would say it out loud:
   "Two pair, aces and nines", "Flush, king high", "Straight, ten to ace".
   The category comes from phe (the evaluator the engine settles pots with), so
   a name can never disagree with who won; the wording is derived from the best
   five cards, found by evaluating every five card subset. */

import { evaluateCards, handRank } from 'phe';
import type { Card } from '@opentable/protocol';
import { combinations, rankValue, suitOf } from './cards.js';

export type HandCategory =
  | 'straight flush'
  | 'four of a kind'
  | 'full house'
  | 'flush'
  | 'straight'
  | 'three of a kind'
  | 'two pair'
  | 'pair'
  | 'high card';

// phe's rank buckets, 0 = straight flush .. 8 = high card.
const CATEGORIES: HandCategory[] = [
  'straight flush',
  'four of a kind',
  'full house',
  'flush',
  'straight',
  'three of a kind',
  'two pair',
  'pair',
  'high card',
];

const WORDS: Record<number, string> = {
  14: 'ace',
  13: 'king',
  12: 'queen',
  11: 'jack',
  10: 'ten',
  9: 'nine',
  8: 'eight',
  7: 'seven',
  6: 'six',
  5: 'five',
  4: 'four',
  3: 'three',
  2: 'two',
};

export function rankWord(value: number): string {
  return WORDS[value] ?? String(value);
}

export function rankWordPlural(value: number): string {
  const w = rankWord(value);
  return w === 'six' ? 'sixes' : `${w}s`;
}

export function categoryOf(strength: number): HandCategory {
  return CATEGORIES[handRank(strength)];
}

/* The best five of the cards given, by strength. Ties cannot happen: phe scores
   every distinct five card hand, and equal scores name the same hand anyway. */
export function bestFive(cards: Card[]): { cards: Card[]; strength: number } {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`handName needs 5 to 7 cards, got ${cards.length}`);
  }
  if (cards.length === 5) return { cards: [...cards], strength: evaluateCards(cards) };
  let best: Card[] = [];
  let strength = Infinity;
  for (const five of combinations(cards, 5)) {
    const value = evaluateCards(five);
    if (value < strength) {
      strength = value;
      best = [...five];
    }
  }
  return { cards: best, strength };
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* Ranks of the five cards, grouped by how many of each there are: [count, rank]
   sorted by count then rank, so a full house reads trips first. */
function groups(cards: Card[]): [number, number][] {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankValue(c), (counts.get(rankValue(c)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([rank, count]) => [count, rank] as [number, number])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
}

/* The high card of a straight, taking the wheel (A2345) as five high. Returns
   null when the five cards are not a straight. */
function straightHigh(cards: Card[]): number | null {
  const values = [...new Set(cards.map(rankValue))].sort((a, b) => a - b);
  if (values.length !== 5) return null;
  if (values[4] - values[0] === 4) return values[4];
  if (values[4] === 14 && values[0] === 2 && values[3] === 5) return 5;
  return null;
}

export function handName(cards: Card[]): { category: HandCategory; name: string } {
  const five = bestFive(cards);
  const category = categoryOf(five.strength);
  const g = groups(five.cards);
  const high = straightHigh(five.cards);
  const top = Math.max(...five.cards.map(rankValue));

  switch (category) {
    case 'straight flush': {
      if (high === 14) return { category, name: 'Royal flush' };
      return { category, name: sentence(`straight flush, ${rankWord(high ?? top)} high`) };
    }
    case 'four of a kind':
      return { category, name: sentence(`four of a kind, ${rankWordPlural(g[0][1])}`) };
    case 'full house':
      return {
        category,
        name: sentence(`full house, ${rankWordPlural(g[0][1])} over ${rankWordPlural(g[1][1])}`),
      };
    case 'flush':
      return { category, name: sentence(`flush, ${rankWord(top)} high`) };
    case 'straight': {
      const hi = high ?? top;
      const lo = hi === 5 ? 14 : hi - 4;
      return { category, name: sentence(`straight, ${rankWord(lo)} to ${rankWord(hi)}`) };
    }
    case 'three of a kind':
      return { category, name: sentence(`three of a kind, ${rankWordPlural(g[0][1])}`) };
    case 'two pair':
      return {
        category,
        name: sentence(`two pair, ${rankWordPlural(g[0][1])} and ${rankWordPlural(g[1][1])}`),
      };
    case 'pair':
      return { category, name: sentence(`pair of ${rankWordPlural(g[0][1])}`) };
    default:
      return { category, name: sentence(`${rankWord(top)} high`) };
  }
}

/* Suits present in a holding, counted. Used by the outs module and by anything
   that wants to know how close a flush is without naming the hand. */
export function suitCounts(cards: Card[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(suitOf(c), (counts.get(suitOf(c)) ?? 0) + 1);
  return counts;
}
