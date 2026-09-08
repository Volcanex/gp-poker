/* Outs: the cards that would lift hero's made hand into a better category on
   the next street.

   The definition, deliberately narrow and deliberately opponent agnostic:
   deal each unseen card in turn, evaluate hero's seven (or six) cards with the
   same evaluator that settles pots, and count the card if the category improves
   (a pair becomes two pair, ace high becomes a pair, a flush draw fills). It
   asks nothing about the opponent, so it does not know whether an out is enough
   to win, and it counts an out that pairs the board even though that card helps
   everyone. Improving only a kicker is not an out.

   That definition is why the count is usually larger than the number a player
   would quote: a bare flush draw is nine flush cards to them, but two of their
   overcards pairing also improves the category, so this counts fifteen. The
   named draws in `draws` are the structural ones, so a caller that wants the
   familiar "nine outs" reads the draw and the cards of that suit. */

import { evaluateCards, handRank } from 'phe';
import type { Card } from '@opentable/protocol';
import { assertDistinct, deckWithout, rankValue, suitOf, SUIT_CHARS } from './cards.js';
import { suitCounts } from './name.js';

export type DrawName =
  | 'flush draw'
  | 'open-ended straight draw'
  | 'gutshot'
  | 'two overcards'
  | 'backdoor flush draw';

export interface OutsResult {
  cards: Card[];
  count: number;
  draws: DrawName[];
}

/* Ranks as values, with the ace counted twice so the wheel (A2345) falls out of
   the same run search as every other straight. */
function straightValues(cards: Card[]): Set<number> {
  const values = new Set<number>();
  for (const c of cards) {
    const v = rankValue(c);
    values.add(v);
    if (v === 14) values.add(1);
  }
  return values;
}

function hasRun(values: Set<number>, mustInclude?: number, mustTouch?: Set<number>): boolean {
  for (let low = 1; low <= 10; low++) {
    let run = true;
    for (let i = 0; i < 5; i++) if (!values.has(low + i)) run = false;
    if (!run) continue;
    if (mustInclude !== undefined && (mustInclude < low || mustInclude > low + 4)) continue;
    if (mustTouch) {
      let touches = false;
      for (let i = 0; i < 5; i++) if (mustTouch.has(low + i)) touches = true;
      if (!touches) continue;
    }
    return true;
  }
  return false;
}

/* Ranks that would complete a straight using at least one of hero's cards. A
   board that is four to a straight on its own is everybody's straight, not
   hero's draw, so it is not counted here. */
function straightOuts(hero: [Card, Card], board: Card[]): number[] {
  const present = straightValues([...hero, ...board]);
  const live = new Set(deckWithout([...hero, ...board]).map(rankValue));
  if (hasRun(present)) return [];
  const heroValues = straightValues(hero);
  const ranks: number[] = [];
  for (let v = 2; v <= 14; v++) {
    const candidate = new Set(present);
    candidate.add(v);
    if (v === 14) candidate.add(1);
    const target = v === 14 ? [14, 1] : [v];
    if (live.has(v) && target.some((t) => hasRun(candidate, t, heroValues))) ranks.push(v);
  }
  return ranks;
}

function drawsOf(hero: [Card, Card], board: Card[]): DrawName[] {
  const cards = [...hero, ...board];
  const suits = suitCounts(cards);
  const heroSuits = new Set(hero.map(suitOf));
  const draws: DrawName[] = [];

  for (const [suit, count] of suits) {
    if (count === 4 && heroSuits.has(suit)) draws.push('flush draw');
  }

  const straight = straightOuts(hero, board);
  if (straight.length >= 2) draws.push('open-ended straight draw');
  else if (straight.length === 1) draws.push('gutshot');

  const category = handRank(evaluateCards(cards));
  const HIGH_CARD = 8;
  const boardHigh = Math.max(...board.map(rankValue));
  if (category === HIGH_CARD && hero.every((c) => rankValue(c) > boardHigh)) {
    draws.push('two overcards');
  }

  if (board.length === 3) {
    for (const [suit, count] of suits) {
      if (count === 3 && heroSuits.has(suit)) draws.push('backdoor flush draw');
    }
  }

  return draws;
}

export function outs(hero: [Card, Card], board: Card[]): OutsResult {
  if (hero.length !== 2) throw new Error(`hero needs two cards, got ${hero.length}`);
  if (board.length !== 3 && board.length !== 4) {
    throw new Error(`outs needs a flop or a turn, got a board of ${board.length}`);
  }
  assertDistinct([...hero, ...board]);

  const made = handRank(evaluateCards([...hero, ...board]));
  const cards = deckWithout([...hero, ...board]).filter(
    (card) => handRank(evaluateCards([...hero, ...board, card])) < made,
  );
  cards.sort((a, b) => rankValue(b) - rankValue(a) || SUIT_CHARS.indexOf(a[1]) - SUIT_CHARS.indexOf(b[1]));

  return { cards, count: cards.length, draws: drawsOf(hero, board) };
}

/* An open-ended draw and a double gutshot both leave eight cards and are both
   reported as an open-ended straight draw, so this is how a caller counts the
   cards behind that label. */
export function straightOutCards(hero: [Card, Card], board: Card[]): Card[] {
  const ranks = new Set(straightOuts(hero, board));
  return deckWithout([...hero, ...board]).filter((c) => ranks.has(rankValue(c)));
}
