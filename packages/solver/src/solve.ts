/* Solving one street of a heads-up subgame: build the universe of combos,
   build the betting tree, run CFR+ against a clock, and hand back the root
   strategy for the hand actually held.

   The subgame is rooted at the decision in front of us rather than at the top
   of the street. That keeps every real spot solvable, including one the size
   set would never have produced (a person bets 41% of the pot), at the cost of
   not being able to read the opponent's range off the solve of the action they
   just took. Range tracking is a separate, cheaper job: see opponent.ts.

   The river is solved exactly. The turn is depth limited: when the street
   closes without a fold, the leaf is worth the equity of the two ranges over a
   sample of river cards times the pot, which assumes no more betting happens.
   That undervalues the nutted part of a range and overvalues the marginal
   part, and it is the single biggest approximation in this package. */

import { Cfr, type CfrOptions, type ShowdownEvaluator } from './cfr.js';
import { NUM_CARDS } from './cards.js';
import type { Range } from './range.js';
import {
  accumulateShowdown,
  projectRange,
  rankBoard,
  universeOf,
  type RankedBoard,
  type Universe,
} from './showdown.js';
import {
  DEFAULT_ALL_IN_SPR,
  DEFAULT_BET_SIZES,
  DEFAULT_RAISE_CAP,
  DEFAULT_RAISE_SIZES,
  buildTree,
  type Act,
  type DecisionNode,
  type Tree,
} from './tree.js';

export interface SubgameSpec {
  board: number[]; // four cards for a turn solve, five for a river
  heroRange: Range;
  villainRange: Range;
  hero: 0 | 1; // which seat the bot is
  pot: number; // chips in the pot before this street's contributions
  committed: [number, number]; // street contributions so far
  stack: number; // cap on either player's street contribution
  toAct: 0 | 1;
  minBet: number;
  minRaiseTo: number;
  actedThisRound: boolean;
  betSizes?: number[];
  raiseSizes?: number[];
  raiseCap?: number;
  allInSpr?: number;
  leafDiscount?: number; // how much of a depth limited leaf's value is realised
  runoutWindow?: number; // runouts swept per iteration at a depth limited leaf
  flopRunouts?: number; // flop solves only: how many two card runouts to rank
}

export interface SolveResult {
  acts: Act[];
  // Frequency of each root action for every combo, as `actions * combos`.
  strategy: Float32Array;
  universe: Universe;
  root: DecisionNode;
  tree: Tree;
  iterations: number;
  ms: number;
  cfr: Cfr;
}

export class RiverEvaluator implements ShowdownEvaluator {
  constructor(
    private universe: Universe,
    private ranked: RankedBoard
  ) {}
  evaluate(oppW: Float32Array, payoff: number, out: Float32Array): void {
    accumulateShowdown(this.universe, this.ranked, oppW, payoff, out);
  }
}

/* The depth limited leaf, used on the turn and on the flop. When the street
   closes without a fold the hand is worth its share of the pot at showdown,
   averaged over the cards still to come, and no further betting is modelled.

   Ranking a board is the expensive part of a sweep and it does not change
   between iterations, so every runout in the sample is ranked once up front
   and each iteration sweeps a rotating window of them. The rotation is
   deterministic, so two solves of the same spot give the same answer.

   Opponent combos that use a runout card are zeroed for that runout, which
   keeps card removal honest. Our own blocked combos are not renormalised: a
   combo blocks a small fraction of the runouts, and the leaf is already an
   approximation of two streets of play.

   This is the single biggest approximation in the package. It undervalues the
   nutted part of a range, which earns money on later streets, and overvalues
   the marginal part, which pays it. It is why the turn solve measures around
   two percent of the pot exploitable where the river measures a tenth of
   that. */
export class RunoutEvaluator implements ShowdownEvaluator {
  private ranked: RankedBoard[] = [];
  private blocked: Uint8Array[] = [];
  private blockedAt: Int32Array[] = [];
  private masked: Float32Array;
  private saved: Float32Array;
  private offset = 0;
  private rankPerIteration: number;

  constructor(
    private universe: Universe,
    private runouts: number[][], // the cards that complete the board, one entry per runout
    private board: number[],
    private window: number,
    private discount: number,
    rankPerIteration = RANK_PER_ITERATION
  ) {
    this.rankPerIteration = rankPerIteration;
    this.masked = new Float32Array(universe.n);
    this.saved = new Float32Array(universe.n);
    this.rankMore(Math.min(window, runouts.length));
  }

  /* Ranking every runout up front is the one part of a solve big enough to
     stall an event loop on its own: a flop asks for a hundred boards over a
     thousand combos. They are ranked a few per iteration instead, so the
     longest thing this package ever does without returning is a single CFR
     iteration. Early iterations sweep a coarser leaf than late ones, which
     CFR+ already discounts by weighting the average strategy linearly. */
  private rankMore(count: number): void {
    const target = Math.min(this.runouts.length, this.ranked.length + count);
    for (let r = this.ranked.length; r < target; r++) {
      const runout = this.runouts[r];
      this.ranked.push(rankBoard(this.universe, [...this.board, ...runout]));
      const flags = new Uint8Array(this.universe.n);
      const positions: number[] = [];
      for (let p = 0; p < this.universe.n; p++) {
        const blocked = runout.includes(this.universe.cardA[p]) || runout.includes(this.universe.cardB[p]);
        flags[p] = blocked ? 1 : 0;
        if (blocked) positions.push(p);
      }
      this.blocked.push(flags);
      this.blockedAt.push(Int32Array.from(positions));
    }
  }

  nextIteration(iteration: number): void {
    this.rankMore(this.rankPerIteration);
    const width = Math.min(this.window, this.ranked.length);
    this.offset = (iteration * width) % this.ranked.length;
  }

  evaluate(oppW: Float32Array, payoff: number, out: Float32Array): void {
    const width = Math.min(this.window, this.ranked.length);
    const share = (payoff * this.discount) / width;
    for (let s = 0; s < width; s++) {
      const r = (this.offset + s) % this.ranked.length;
      const flags = this.blocked[r];
      for (let p = 0; p < this.universe.n; p++) this.masked[p] = flags[p] ? 0 : oppW[p];
      // A combo that uses a runout card cannot be held on that runout. Its
      // opponent weight is zeroed above, and its own value is rolled back
      // below, so the leaf drops the pair from both sides at once and the
      // subgame stays zero sum.
      const positions = this.blockedAt[r];
      for (let k = 0; k < positions.length; k++) this.saved[positions[k]] = out[positions[k]];
      accumulateShowdown(this.universe, this.ranked[r], this.masked, share, out);
      for (let k = 0; k < positions.length; k++) out[positions[k]] = this.saved[positions[k]];
    }
  }
}

/* Every one card completion of a turn board. */
function turnRunouts(board: number[]): number[][] {
  const dead = new Set(board);
  const out: number[][] = [];
  for (let card = 0; card < NUM_CARDS; card++) if (!dead.has(card)) out.push([card]);
  return out;
}

/* A spread of two card completions of a flop. All 1081 of them cannot be
   ranked inside a decision budget, so a fixed stride through the enumeration
   is taken instead: a stride rather than a random draw so the sample is the
   same on every solve of the same board, and spread rather than contiguous so
   no suit or rank is systematically missing. */
function flopRunouts(board: number[], count: number): number[][] {
  const dead = new Set(board);
  const live: number[] = [];
  for (let card = 0; card < NUM_CARDS; card++) if (!dead.has(card)) live.push(card);
  const all: number[][] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) all.push([live[i], live[j]]);
  }
  if (count >= all.length) return all;
  // A plain stride through a list ordered by card index keeps landing on the
  // same ranks. Stepping by a prime that is coprime with the length walks the
  // whole enumeration instead, and is still the same sample every time.
  const step = 389;
  const out: number[][] = [];
  for (let k = 0; k < count; k++) out.push(all[(k * step) % all.length]);
  return out;
}

// Runouts swept per iteration at a depth limited leaf. Eight covers every
// river card inside six turn iterations while each iteration stays cheap;
// measured against a full enumeration it costs about a fifth of a percent of
// the pot in exploitability over sweeping all of them.
export const RUNOUT_WINDOW = 8;

// Two card runouts ranked up front on a flop, out of the 1081 there are.
// Ranking is the setup cost of a solve. Measured against a full enumeration,
// 96 leaves about one and a half percent of the pot on the table and 32 leaves
// rather more, while the setup cost is roughly linear in the count.
export const FLOP_RUNOUTS = 96;

// Runouts ranked per iteration while the solve warms up. Four keeps a single
// iteration under the few milliseconds a cooperative scheduler slices on.
export const RANK_PER_ITERATION = 4;

/* How much of a hand's share of the pot at a depth limited leaf actually
   reaches it. Nothing, in that leaf, models the streets still to come: a hand
   with fifty five percent equity is worth fifty five percent of whatever ends
   up in the middle, however it got there. That is false in the direction that
   costs the most money. A medium hand does not realise its equity against
   further betting, it pays off the top of a range and folds to the rest, and a
   solver that believes otherwise is happy to get a hundred big blinds in with
   top pair.

   Discounting the whole leaf makes winning the pot now worth relatively more
   than winning it at showdown, which is the shape of the error. It stays zero
   sum because both sides are scaled together. The flop is discounted harder
   than the turn because two streets of betting realise less than one.

   This is a correction for a known bias, not a tuned constant: the values were
   picked by measuring level 6 against levels 4 and 5 at a hundred big blinds,
   where an undiscounted leaf loses its whole stack in one hand out of twenty
   and a discounted one does not. */
export const TURN_LEAF_DISCOUNT = Number(process.env.SOLVER_TURN_DISCOUNT ?? 0.85);
export const FLOP_LEAF_DISCOUNT = Number(process.env.SOLVER_FLOP_DISCOUNT ?? 0.72);

/* Every runout, swept at every leaf. Too slow to solve with on the box, but it
   is the honest yardstick the sampled leaf is measured against. */
export function leafDiscountFor(board: number[]): number {
  return board.length === 4 ? TURN_LEAF_DISCOUNT : FLOP_LEAF_DISCOUNT;
}

export function fullRunoutEvaluator(
  universe: Universe,
  board: number[],
  discount = leafDiscountFor(board)
): ShowdownEvaluator {
  const runouts = board.length === 4 ? turnRunouts(board) : flopRunouts(board, Infinity);
  return new RunoutEvaluator(universe, runouts, board, runouts.length, discount);
}

export interface PreparedSubgame {
  cfr: Cfr;
  tree: Tree;
  universe: Universe;
  root: DecisionNode;
  started: number;
}

/* Everything a solve needs before its first iteration. Split out so a caller
   that has to share a thread can run the iterations in slices of its own. */
export function prepareSubgame(spec: SubgameSpec): PreparedSubgame {
  const started = Date.now();
  const universe = universeOf(spec.heroRange, spec.villainRange, spec.board);
  const hero = projectRange(universe, spec.heroRange);
  const villain = projectRange(universe, spec.villainRange);
  const ranges: [Float32Array, Float32Array] = spec.hero === 0 ? [hero, villain] : [villain, hero];

  const tree = buildTree({
    pot: spec.pot,
    stack: spec.stack,
    committed: spec.committed,
    toAct: spec.toAct,
    minBet: spec.minBet,
    minRaiseTo: spec.minRaiseTo,
    actedThisRound: spec.actedThisRound,
    betSizes: spec.betSizes ?? DEFAULT_BET_SIZES,
    raiseSizes: spec.raiseSizes ?? DEFAULT_RAISE_SIZES,
    raiseCap: spec.raiseCap ?? DEFAULT_RAISE_CAP,
    // The river solve is exact, so an all-in there is valued honestly however
    // deep the stacks are.
    allInSpr: spec.allInSpr ?? (spec.board.length >= 5 ? Infinity : DEFAULT_ALL_IN_SPR),
  });

  const window = spec.runoutWindow ?? RUNOUT_WINDOW;
  const evaluator: ShowdownEvaluator =
    spec.board.length >= 5
      ? new RiverEvaluator(universe, rankBoard(universe, spec.board))
      : new RunoutEvaluator(
          universe,
          spec.board.length === 4 ? turnRunouts(spec.board) : flopRunouts(spec.board, spec.flopRunouts ?? FLOP_RUNOUTS),
          spec.board,
          window,
          spec.leafDiscount ?? (spec.board.length === 4 ? TURN_LEAF_DISCOUNT : FLOP_LEAF_DISCOUNT)
        );

  const cfr = new Cfr(tree, universe, ranges, evaluator);
  return { cfr, tree, universe, root: tree.root as DecisionNode, started };
}

export function finishSubgame(prepared: PreparedSubgame): SolveResult {
  return {
    acts: prepared.root.acts,
    strategy: prepared.cfr.averageStrategy(prepared.root),
    universe: prepared.universe,
    root: prepared.root,
    tree: prepared.tree,
    iterations: prepared.cfr.iterations,
    ms: Date.now() - prepared.started,
    cfr: prepared.cfr,
  };
}

export function solveSubgame(spec: SubgameSpec, options: CfrOptions = {}): SolveResult {
  const prepared = prepareSubgame(spec);
  prepared.cfr.run(options);
  return finishSubgame(prepared);
}

/* The root action frequencies for one concrete hand. A combo the universe
   never held (both ranges gave it zero) comes back null rather than as a
   uniform guess, so a caller can fall back rather than act on nothing. */
export function frequenciesFor(result: SolveResult, combo: number): { act: Act; frequency: number }[] | null {
  const p = result.universe.slot[combo];
  if (p < 0) return null;
  const n = result.universe.n;
  return result.acts.map((act, k) => ({ act, frequency: result.strategy[k * n + p] }));
}

