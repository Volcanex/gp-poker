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
import { COMBO_HIGH, COMBO_LOW, NUM_CARDS } from './cards.js';
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
  private window: number;

  constructor(
    private universe: Universe,
    runouts: number[][], // the cards that complete the board, one entry per runout
    board: number[],
    window: number
  ) {
    for (const runout of runouts) {
      this.ranked.push(rankBoard(universe, [...board, ...runout]));
      const flags = new Uint8Array(universe.n);
      for (let p = 0; p < universe.n; p++) {
        flags[p] = runout.includes(universe.cardA[p]) || runout.includes(universe.cardB[p]) ? 1 : 0;
      }
      this.blocked.push(flags);
      const positions: number[] = [];
      for (let p = 0; p < universe.n; p++) if (flags[p]) positions.push(p);
      this.blockedAt.push(Int32Array.from(positions));
    }
    this.window = Math.min(window, this.ranked.length);
    this.masked = new Float32Array(universe.n);
    this.saved = new Float32Array(universe.n);
  }

  nextIteration(iteration: number): void {
    this.offset = (iteration * this.window) % this.ranked.length;
  }

  evaluate(oppW: Float32Array, payoff: number, out: Float32Array): void {
    const share = payoff / this.window;
    for (let s = 0; s < this.window; s++) {
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

/* Every runout, swept at every leaf. Too slow to solve with on the box, but it
   is the honest yardstick the sampled leaf is measured against. */
export function fullRunoutEvaluator(universe: Universe, board: number[]): ShowdownEvaluator {
  const runouts = board.length === 4 ? turnRunouts(board) : flopRunouts(board, Infinity);
  return new RunoutEvaluator(universe, runouts, board, runouts.length);
}

export function solveSubgame(spec: SubgameSpec, options: CfrOptions = {}): SolveResult {
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
  });

  const window = spec.runoutWindow ?? RUNOUT_WINDOW;
  const evaluator: ShowdownEvaluator =
    spec.board.length >= 5
      ? new RiverEvaluator(universe, rankBoard(universe, spec.board))
      : new RunoutEvaluator(
          universe,
          spec.board.length === 4 ? turnRunouts(spec.board) : flopRunouts(spec.board, spec.flopRunouts ?? FLOP_RUNOUTS),
          spec.board,
          window
        );

  const cfr = new Cfr(tree, universe, ranges, evaluator);
  const iterations = cfr.run(options);
  const root = tree.root as DecisionNode;

  return {
    acts: root.acts,
    strategy: cfr.averageStrategy(root),
    universe,
    root,
    tree,
    iterations,
    ms: Date.now() - started,
    cfr,
  };
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

export function comboFromCards(a: number, b: number): number {
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  return (hi * (hi - 1)) / 2 + lo;
}

export { COMBO_HIGH, COMBO_LOW };
