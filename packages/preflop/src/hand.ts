/* The 169 canonical heads-up preflop hand classes: 13 pairs, 78 suited, 78
   offsuit combos ('AA', 'AKs', 'AKo', ...). Suit identity never matters for
   classification or equity, only whether the two cards share a suit. */

import type { Card } from '@opentable/protocol';

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export type Rank = (typeof RANKS)[number];

function parseCard(card: Card): { rank: Rank; suit: string } {
  return { rank: card[0] as Rank, suit: card[1] };
}

export function handClass(cards: [Card, Card]): string {
  const [a, b] = cards.map(parseCard);
  const ia = RANKS.indexOf(a.rank);
  const ib = RANKS.indexOf(b.rank);
  if (ia === ib) return `${a.rank}${a.rank}`;
  const [hi, lo] = ia < ib ? [a, b] : [b, a];
  const suited = a.suit === b.suit;
  return `${hi.rank}${lo.rank}${suited ? 's' : 'o'}`;
}

export function allHandClasses(): string[] {
  const classes: string[] = [];
  for (let i = 0; i < RANKS.length; i++) classes.push(`${RANKS[i]}${RANKS[i]}`);
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i + 1; j < RANKS.length; j++) classes.push(`${RANKS[i]}${RANKS[j]}s`);
  }
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i + 1; j < RANKS.length; j++) classes.push(`${RANKS[i]}${RANKS[j]}o`);
  }
  return classes;
}
