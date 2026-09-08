/* Card and combo primitives for the solver. Everything downstream indexes by
   integers rather than by the protocol's two character strings: a river solve
   touches every combo in both ranges a few hundred thousand times and string
   keys would dominate the run.

   A card is `rank * 4 + suit` over the same rank and suit orders the rest of
   the codebase uses, so `cardOf(cardIndex(c)) === c`. A combo is an unordered
   pair of cards, numbered `a * (a - 1) / 2 + b` with `a > b`, which is the
   dense triangular numbering: 1326 combos, no gaps. */

import type { Card } from '@opentable/protocol';

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export const NUM_CARDS = 52;
export const NUM_COMBOS = 1326;

const CARD_STRINGS: Card[] = (() => {
  const out: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) out.push(`${r}${s}`);
  return out;
})();

const INDEX_BY_CARD = new Map<string, number>(CARD_STRINGS.map((c, i) => [c, i]));

export function cardIndex(card: Card): number {
  const i = INDEX_BY_CARD.get(card);
  if (i === undefined) throw new Error(`not a card: ${card}`);
  return i;
}

export function cardOf(index: number): Card {
  const c = CARD_STRINGS[index];
  if (c === undefined) throw new Error(`not a card index: ${index}`);
  return c;
}

export function rankOfCard(index: number): number {
  return index >> 2;
}

export function suitOfCard(index: number): number {
  return index & 3;
}

export function comboIndex(x: number, y: number): number {
  const a = x > y ? x : y;
  const b = x > y ? y : x;
  return (a * (a - 1)) / 2 + b;
}

/* The two cards of every combo, as flat lookup tables. Built once; a solve
   reads them in its inner loops and never allocates. */
export const COMBO_HIGH = new Int8Array(NUM_COMBOS);
export const COMBO_LOW = new Int8Array(NUM_COMBOS);

for (let a = 1; a < NUM_CARDS; a++) {
  for (let b = 0; b < a; b++) {
    const i = (a * (a - 1)) / 2 + b;
    COMBO_HIGH[i] = a;
    COMBO_LOW[i] = b;
  }
}

export function comboCards(combo: number): [Card, Card] {
  return [cardOf(COMBO_HIGH[combo]), cardOf(COMBO_LOW[combo])];
}

export function comboOfCards(cards: [Card, Card]): number {
  return comboIndex(cardIndex(cards[0]), cardIndex(cards[1]));
}

/* A 52 bit mask of the cards a board (or any dead set) uses, held as a pair of
   26 bit halves so it stays a small integer pair rather than a BigInt. Combo
   blocking is checked against the two halves directly. */
export function deadMask(cards: Iterable<number>): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const c of cards) {
    if (c < 26) lo |= 1 << c;
    else hi |= 1 << (c - 26);
  }
  return [lo, hi];
}

export function cardBlocked(card: number, mask: [number, number]): boolean {
  return card < 26 ? (mask[0] & (1 << card)) !== 0 : (mask[1] & (1 << (card - 26))) !== 0;
}

export function comboBlocked(combo: number, mask: [number, number]): boolean {
  return cardBlocked(COMBO_HIGH[combo], mask) || cardBlocked(COMBO_LOW[combo], mask);
}
