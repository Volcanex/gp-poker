/* Dealing a "who wins" puzzle. Everything here is pure and evaluator free: the
   generator builds a legal deal and the analysis worker says who won, so the
   answer a player is graded against comes from the same evaluator that settles
   pots at the table. Nothing on this page decides a poker hand by hand.

   Difficulty is structural rather than measured, for that same reason. A
   harder deal is not one this file scored and found close, it is one whose
   shape makes it close by construction. Three shapes do that:

   - kicker: every hand pairs the same board card, so the pair is a wash and
     only the kicker is left.
   - counterfeit: the board is paired above everybody, so every hand holds two
     pair and the question is which two pair, and what the fifth card does.
   - board: the board is a straight nobody can beat or extend, so it plays and
     the pot is split. That is the reading players miss most, and it is the one
     shape whose answer is known here without an evaluator, which is what the
     unit test pins.

   The kind is never shown to the player. Saying "this one splits" would be
   giving away the answer. */

import { FULL_DECK, RANK_CHARS } from '@opentable/equity/cards';

export type ShowdownKind = 'random' | 'kicker' | 'counterfeit' | 'board';

export interface ShowdownShape {
  hands: number;
  kind: ShowdownKind;
}

export interface ShowdownPuzzle {
  board: string[];
  hands: [string, string][];
  kind: ShowdownKind;
}

/* Two hands and a plain deal to start, four hands and a split to finish. The
   number of hands never falls as the streak grows, so the page cannot get
   easier for having got harder. */
const RAMP: ShowdownShape[] = [
  { hands: 2, kind: 'random' },
  { hands: 2, kind: 'kicker' },
  { hands: 3, kind: 'random' },
  { hands: 3, kind: 'kicker' },
  { hands: 3, kind: 'counterfeit' },
  { hands: 4, kind: 'random' },
  { hands: 4, kind: 'board' },
];

export const MAX_LEVEL = RAMP.length - 1;

/* Two right answers move you up a step. A wrong one drops the streak to zero,
   which drops the level with it. */
export function levelFor(streak: number): number {
  return Math.min(MAX_LEVEL, Math.max(0, Math.floor(streak / 2)));
}

export function shapeFor(streak: number): ShowdownShape {
  return RAMP[levelFor(streak)];
}

export function valueOf(card: string): number {
  return RANK_CHARS.indexOf(card[0]) + 2;
}

/* phe scores a hand low to high, 1 being a royal flush, so the smallest number
   is the best hand and everybody holding it splits. */
export function winnersFrom(strengths: number[]): number[] {
  const best = Math.min(...strengths);
  const winners: number[] = [];
  strengths.forEach((s, i) => {
    if (s === best) winners.push(i);
  });
  return winners;
}

type Pick = (pred?: (card: string) => boolean) => string;

function makeDealer(random: () => number): Pick {
  const used = new Set<string>();
  return function pick(pred: (card: string) => boolean = () => true): string {
    const free = FULL_DECK.filter((c) => !used.has(c) && pred(c));
    if (free.length === 0) throw new Error('no card left that fits this puzzle');
    const card = free[Math.min(free.length - 1, Math.floor(random() * free.length))];
    used.add(card);
    return card;
  };
}

function choose<T>(items: T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/* A board of distinct ranks with no suit on it more than twice, so a board can
   never carry a flush draw two hole cards could complete. Ranks come from the
   pool the caller allows, which is how a constructed shape reserves the ranks
   it needs. */
function boardOf(pick: Pick, allowed: (rank: string) => boolean, seed: string[] = []): string[] {
  const board = [...seed];
  const suits = new Map<string, number>();
  for (const c of board) suits.set(c[1], (suits.get(c[1]) ?? 0) + 1);
  while (board.length < 5) {
    const ranks = new Set(board.map((c) => c[0]));
    const card = pick((c) => allowed(c[0]) && !ranks.has(c[0]) && (suits.get(c[1]) ?? 0) < 2);
    suits.set(card[1], (suits.get(card[1]) ?? 0) + 1);
    board.push(card);
  }
  return board;
}

function holesOf(pick: Pick, hands: number, allowed: (card: string) => boolean): [string, string][] {
  return Array.from({ length: hands }, () => [pick(allowed), pick(allowed)] as [string, string]);
}

function dealRandom(pick: Pick, hands: number): ShowdownPuzzle {
  const board = [pick(), pick(), pick(), pick(), pick()];
  return { board, hands: holesOf(pick, hands, () => true), kind: 'random' };
}

/* Every hand pairs the same board card, so the pair is a wash and the kicker
   decides, unless the board outranks both kickers and it splits. */
function dealKicker(pick: Pick, random: () => number, hands: number): ShowdownPuzzle {
  const board = boardOf(pick, () => true);
  const byRank = [...board].sort((a, b) => valueOf(b) - valueOf(a));
  const shared = choose(byRank.slice(0, 3), random)[0];
  const boardRanks = new Set(board.map((c) => c[0]));
  const kickerRanks = new Set<string>();
  const holes = Array.from({ length: hands }, () => {
    const paired = pick((c) => c[0] === shared);
    const kicker = pick((c) => !boardRanks.has(c[0]) && !kickerRanks.has(c[0]));
    kickerRanks.add(kicker[0]);
    return [paired, kicker] as [string, string];
  });
  return { board, hands: holes, kind: 'kicker' };
}

/* A board paired above everything anybody holds. Each hand pairs a different
   one of the three side cards, so every hand is two pair with the board's pair
   on top, and the reading is which side card is higher and what the fifth card
   does to the one that is not. */
function dealCounterfeit(pick: Pick, random: () => number, hands: number): ShowdownPuzzle {
  const pairRank = choose([...RANK_CHARS].slice(8), random); // ten up to ace
  const pairIndex = RANK_CHARS.indexOf(pairRank);
  const seed = [pick((c) => c[0] === pairRank), pick((c) => c[0] === pairRank)];
  const board = boardOf(pick, (r) => RANK_CHARS.indexOf(r) < pairIndex, seed);
  const sideCards = board.slice(2);
  const boardRanks = new Set(board.map((c) => c[0]));
  const holes = Array.from({ length: hands }, (_, i) => {
    const side = sideCards[i % sideCards.length];
    const paired = pick((c) => c[0] === side[0]);
    const spare = pick((c) => !boardRanks.has(c[0]));
    return [paired, spare] as [string, string];
  });
  return { board, hands: holes, kind: 'counterfeit' };
}

/* The board is a straight, ten high up to king high, and every hand is two
   cards below the bottom of it. Nothing can extend it upwards, nothing can
   beat it: two low cards cannot make a straight, a flush needs three of a suit
   from a board that holds at most two, and a pair or trips loses to a straight
   anyway. So the board plays and everybody splits, every time. */
function dealBoardPlays(pick: Pick, random: () => number, hands: number): ShowdownPuzzle {
  const bottom = choose([6, 7, 8, 9], random);
  const suits = new Map<string, number>();
  const board: string[] = [];
  for (let i = 0; i < 5; i++) {
    const rank = RANK_CHARS[bottom - 2 + i];
    const card = pick((c) => c[0] === rank && (suits.get(c[1]) ?? 0) < 2);
    suits.set(card[1], (suits.get(card[1]) ?? 0) + 1);
    board.push(card);
  }
  return { board, hands: holesOf(pick, hands, (c) => valueOf(c) < bottom), kind: 'board' };
}

export function dealShowdown(shape: ShowdownShape, random: () => number = Math.random): ShowdownPuzzle {
  const pick = makeDealer(random);
  if (shape.kind === 'kicker') return dealKicker(pick, random, shape.hands);
  if (shape.kind === 'counterfeit') return dealCounterfeit(pick, random, shape.hands);
  if (shape.kind === 'board') return dealBoardPlays(pick, random, shape.hands);
  return dealRandom(pick, shape.hands);
}
