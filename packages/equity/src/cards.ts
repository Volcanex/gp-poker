/* Card primitives shared by the naming, equity and outs modules. A Card is the
   protocol's two-character string ('As', 'Td', '2c'): rank then lowercase suit. */

import type { Card } from '@opentable/protocol';

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc';

export const FULL_DECK: Card[] = (() => {
  const deck: Card[] = [];
  for (const r of RANK_CHARS) for (const s of SUIT_CHARS) deck.push(`${r}${s}`);
  return deck;
})();

/* 2..14, ace high. Straights that use the ace as a one are handled where they
   are named, not here. */
export function rankValue(card: Card): number {
  const i = RANK_CHARS.indexOf(card[0].toUpperCase());
  if (i < 0) throw new Error(`not a card: ${card}`);
  return i + 2;
}

export function suitOf(card: Card): string {
  return card[1];
}

export function normaliseCard(card: string): Card {
  const c = `${card[0]?.toUpperCase() ?? ''}${card[1]?.toLowerCase() ?? ''}`;
  if (c.length !== 2 || !RANK_CHARS.includes(c[0]) || !SUIT_CHARS.includes(c[1])) {
    throw new Error(`not a card: ${card}`);
  }
  return c;
}

export function assertDistinct(cards: Card[]): void {
  const seen = new Set<Card>();
  for (const c of cards) {
    if (seen.has(c)) throw new Error(`card used twice: ${c}`);
    seen.add(c);
  }
}

export function deckWithout(dead: Iterable<Card>): Card[] {
  const out = new Set(dead);
  return FULL_DECK.filter((c) => !out.has(c));
}

/* Every k-subset of items, yielded as a reused array: callers must not keep the
   array they are handed. Enumeration is hot enough that allocating a fresh array
   per subset dominates the evaluator. */
export function* combinations<T>(items: T[], k: number): Generator<T[]> {
  const n = items.length;
  if (k > n || k < 0) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  const buf = new Array<T>(k);
  for (;;) {
    for (let i = 0; i < k; i++) buf[i] = items[idx[i]];
    yield buf;
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

export function countCombinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1);
  return Math.round(out);
}

/* The same seeded PRNG the preflop equity table was generated with, so a test
   can pin a Monte Carlo run without pulling in a dependency. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
