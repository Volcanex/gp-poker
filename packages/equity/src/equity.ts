/* Hot and cold equity: hero's share of the pot if every remaining card were
   dealt out with no more betting.

   Exact when the work fits, sampled when it does not. The rule is one number,
   exactBudget, counted in hand evaluations: (villain assignments) x (board
   runouts) x (players). Under it, every runout is enumerated and the answer is
   the true one; over it, the same loop runs on random deals. One random villain
   on the turn (91k evaluations) or the river (2k) is always exact; the flop is
   not (2.1m), and preflop is not remotely. `exact` in the result says which
   happened, so a caller never has to guess whether a number is noisy. */

import { evaluateCards } from 'phe';
import type { Card } from '@opentable/protocol';
import { assertDistinct, combinations, countCombinations, deckWithout } from './cards.js';
import { combosOf, type Range } from './range.js';

/* A villain is a range, an unknown hand, or a hand you can see. The third is
   what a replay has: every seat's cards are published once the hand ends, so
   the equity on that screen is against the hands that were actually held
   rather than against a cloud. One combination also collapses the assignment
   count to one, which is what makes an exact answer affordable multiway. */
export type Villain = Range | 'random' | readonly [Card, Card];

export interface EquityResult {
  win: number; // hero alone with the best hand
  tie: number; // hero level with the best hand, whatever the split
  lose: number;
  equity: number; // win plus hero's share of the split pots
  samples: number;
  exact: boolean;
}

export interface EquityOptions {
  samples?: number;
  rng?: () => number;
  exactBudget?: number;
}

export const DEFAULT_SAMPLES = 20_000;
export const DEFAULT_EXACT_BUDGET = 1_500_000;

function villainCombos(villain: Villain, deck: Card[], dead: Card[]): [Card, Card][] {
  if (villain === 'random') {
    const out: [Card, Card][] = [];
    for (const pair of combinations(deck, 2)) out.push([pair[0], pair[1]]);
    return out;
  }
  /* A known holding is one combination, and a card of it already in play makes
     it no combination at all, which the caller reports the same way it reports
     a range every combination of which is blocked. */
  if (Array.isArray(villain)) {
    if (villain.length !== 2) throw new Error(`a known villain hand is two cards, got ${villain.length}`);
    const blocked = villain.some((card) => dead.includes(card));
    return blocked ? [] : [[villain[0], villain[1]]];
  }
  return combosOf(villain as Range, dead);
}

export function equity(
  hero: Card[],
  board: Card[],
  villains: Villain[],
  opts: EquityOptions = {},
): EquityResult {
  if (hero.length !== 2) throw new Error(`hero needs two cards, got ${hero.length}`);
  if (board.length > 5) throw new Error(`a board holds at most five cards, got ${board.length}`);
  if (villains.length === 0) throw new Error('equity needs at least one villain');
  assertDistinct([...hero, ...board]);

  const dead = [...hero, ...board];
  const deck = deckWithout(dead);
  const missing = 5 - board.length;
  if (deck.length < missing + 2 * villains.length) {
    throw new Error('not enough cards left to deal every villain a hand and finish the board');
  }
  const lists = villains.map((v, i) => {
    const combos = villainCombos(v, deck, dead);
    if (combos.length === 0) {
      throw new Error(`villain ${i + 1} has no hands left: every combination is blocked by a card already in play`);
    }
    return combos;
  });

  const runouts = countCombinations(deck.length - 2 * lists.length, missing);
  const assignments = lists.reduce((n, l) => n * l.length, 1);
  const work = assignments * runouts * (lists.length + 1);
  const budget = opts.exactBudget ?? DEFAULT_EXACT_BUDGET;

  return work <= budget
    ? enumerate(hero, board, lists, deck, missing)
    : sample(hero, board, lists, deck, missing, opts);
}

interface Tally {
  win: number;
  tie: number;
  lose: number;
  share: number;
  trials: number;
}

function score(tally: Tally, heroRank: number, bestVillain: number, tied: number): void {
  tally.trials++;
  if (heroRank < bestVillain) {
    tally.win++;
    tally.share += 1;
  } else if (heroRank === bestVillain) {
    tally.tie++;
    tally.share += 1 / (1 + tied);
  } else {
    tally.lose++;
  }
}

function finish(tally: Tally, exact: boolean): EquityResult {
  const n = tally.trials || 1;
  return {
    win: tally.win / n,
    tie: tally.tie / n,
    lose: tally.lose / n,
    equity: tally.share / n,
    samples: tally.trials,
    exact,
  };
}

function enumerate(
  hero: Card[],
  board: Card[],
  lists: [Card, Card][][],
  deck: Card[],
  missing: number,
): EquityResult {
  const tally: Tally = { win: 0, tie: 0, lose: 0, share: 0, trials: 0 };
  const used = new Set<Card>();

  const walk = (index: number, heroRank: number, full: Card[], best: number, tied: number): void => {
    if (index === lists.length) {
      score(tally, heroRank, best, tied);
      return;
    }
    for (const combo of lists[index]) {
      if (used.has(combo[0]) || used.has(combo[1])) continue;
      used.add(combo[0]);
      used.add(combo[1]);
      const rank = evaluateCards([...combo, ...full]);
      if (rank < best) walk(index + 1, heroRank, full, rank, 1);
      else if (rank === best) walk(index + 1, heroRank, full, best, tied + 1);
      else walk(index + 1, heroRank, full, best, tied);
      used.delete(combo[0]);
      used.delete(combo[1]);
    }
  };

  const deal = (runout: Card[]): void => {
    const full = [...board, ...runout];
    const heroRank = evaluateCards([...hero, ...full]);
    for (const c of runout) used.add(c);
    walk(0, heroRank, full, Infinity, 0);
    for (const c of runout) used.delete(c);
  };

  if (missing === 0) deal([]);
  else for (const runout of combinations(deck, missing)) deal(runout);

  return finish(tally, true);
}

/* Every villain is redealt when any two of them collide, rather than only the
   one that clashed: rejecting the whole assignment keeps the sample uniform
   over the deals that are actually possible. */
function sample(
  hero: Card[],
  board: Card[],
  lists: [Card, Card][][],
  deck: Card[],
  missing: number,
  opts: EquityOptions,
): EquityResult {
  const rng = opts.rng ?? Math.random;
  const wanted = opts.samples ?? DEFAULT_SAMPLES;
  const tally: Tally = { win: 0, tie: 0, lose: 0, share: 0, trials: 0 };
  const used = new Set<Card>();
  const picks: [Card, Card][] = new Array(lists.length);
  const runout: Card[] = new Array(missing);

  for (let s = 0; s < wanted; s++) {
    let dealt = false;
    for (let attempt = 0; attempt < 500 && !dealt; attempt++) {
      used.clear();
      dealt = true;
      for (let v = 0; v < lists.length; v++) {
        const combo = lists[v][Math.floor(rng() * lists[v].length)];
        if (used.has(combo[0]) || used.has(combo[1])) {
          dealt = false;
          break;
        }
        used.add(combo[0]);
        used.add(combo[1]);
        picks[v] = combo;
      }
    }
    if (!dealt) {
      throw new Error('the villain ranges block each other: no deal gives every villain a hand');
    }

    for (let i = 0; i < missing; i++) {
      let card: Card;
      do {
        card = deck[Math.floor(rng() * deck.length)];
      } while (used.has(card));
      used.add(card);
      runout[i] = card;
    }

    const full = [...board, ...runout];
    const heroRank = evaluateCards([...hero, ...full]);
    let best = Infinity;
    let tied = 0;
    for (const combo of picks) {
      const rank = evaluateCards([...combo, ...full]);
      if (rank < best) {
        best = rank;
        tied = 1;
      } else if (rank === best) {
        tied++;
      }
    }
    score(tally, heroRank, best, tied);
  }

  return finish(tally, false);
}
