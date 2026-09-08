/* Draw outs: the cards a player would actually count.

   @opentable/equity's `outs` answers a narrower question than a player asks. It
   returns every card that improves the made hand category, which is the honest
   definition and the right one for the package, but at the table it says 26
   outs for an open-ender because pairing either hole card also improves the
   category. Nobody has ever called that 26 outs.

   So the table shows the cards the named draws complete: the straight outs, the
   flush outs, or both, deduplicated. This lives here rather than in the package
   because it needs the evaluator, which only the worker may load. The package
   decides whether a draw exists; this only asks which cards finish it, and then
   keeps only those that improve the hand, so a flush card is never offered to a
   made full house. */

import { outs, straightOutCards, type OutsResult } from '@opentable/equity';
import type { Card } from './protocol.ts';

export interface OutsRead extends OutsResult {
  /* The cards behind `draws`. Empty when there is no named draw, which is the
     signal to show the category count instead. */
  drawCards: Card[];
}

/* The one suit four of which are already in play with at least one in hand.
   There can only be one, since two suits of four needs nine cards. */
function drawingSuit(hero: [Card, Card], board: Card[]): string | null {
  const counts = new Map<string, number>();
  for (const card of [...hero, ...board]) counts.set(card[1], (counts.get(card[1]) ?? 0) + 1);
  const held = new Set(hero.map((card) => card[1]));
  for (const [suit, n] of counts) if (n === 4 && held.has(suit)) return suit;
  return null;
}

export function readOuts(hero: [Card, Card], board: Card[]): OutsRead {
  const base = outs(hero, board);
  const straight = new Set<Card>(straightOutCards(hero, board));
  const suit = base.draws.includes('flush draw') ? drawingSuit(hero, board) : null;
  const drawCards = base.cards.filter((card) => straight.has(card) || card[1] === suit);
  return { ...base, drawCards };
}
