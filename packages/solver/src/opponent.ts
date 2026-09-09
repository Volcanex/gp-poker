/* Carrying two ranges through a heads-up hand.

   The solver needs to be told what each side can hold. Preflop that is a
   chart read: the line a player took picks a spot, and the spot's chart picks
   the region. Postflop there is no chart, so every action narrows the range by
   how well each combo does on the board it was taken on.

   Two deliberate weaknesses, both bounded by the same mechanism. The filter
   reads made hand strength on the board as it stands, so it treats a flush
   draw as the eight high it currently is; and it assumes the opponent bets and
   calls for the same reasons we would. Both are why every filtered range is
   blended back towards a population prior, and why the blend widens against an
   opponent whose measured statistics say they are not playing like us. A range
   that has been narrowed to nothing is a bot that folds the nuts. */

import { bucketFor, type StackBucket } from '@opentable/preflop';
import { NUM_COMBOS } from './cards.js';
import {
  blendRanges,
  chartRange,
  emptyRange,
  cloneRange,
  headsUpSpot,
  rangeFromPercentiles,
  removeBlocked,
  widen,
  type Range,
} from './range.js';
import { rankBoard, universeOf, type Universe } from './showdown.js';

export type Position = 'sb' | 'bb';

export interface PreflopStep {
  position: Position;
  aggressive: boolean; // a bet, raise or all-in; a check or call is not
  folded: boolean;
}

/* How much of the range as it stood *before* an action survives the lean that
   action applies. A quarter leaves the read soft enough to be wrong without
   being fatal, and it is a damper on this action rather than a reset: an
   earlier street's narrowing is kept, which is the whole point. Blending the
   population range back in after every action instead was the first version,
   and it left an opponent who had bet and then raised all-in still holding
   forty percent air, which is a solver that stacks off. */
export const BASE_PRIOR = 0.25;
export const RAISE_PRIOR = 0.08;

// How much of the population range is mixed into the preflop chart read for an
// opponent whose own frequencies say they are not playing a chart at all.
const PRIOR_PER_LOOSENESS = 0.5;

// Nothing an action can do drives a combo below this share of the weight it
// had. A filter is a lean, not a proof.
const FLOOR = 0.03;

/* How sharply an action sorts the range by made hand strength, as the exponent
   the strength is raised to. Bigger wagers lean harder, and a raise leans
   harder than a bet of the same size, because it has to beat something. The
   numbers are set so that a pot sized raise leaves a range concentrated above
   about the eighty-fifth percentile of hands on that board, which is roughly
   where every level below this one starts raising. */
const BET_SHAPE = 2;
const BET_SHAPE_PER_POT = 2;
const RAISE_SHAPE = 8;
const RAISE_SHAPE_PER_POT = 6;
const CALL_SHAPE = 1.2;
const CALL_SHAPE_PER_POT = 0.8;
const CHECK_LEAN = 0.35;
// Past this the extra size says nothing more about the hand.
const MAX_POT_FRACTION = 1.5;

/* The hands a player who is not reading a chart turns up with. Wide, because
   the whole point of the prior is to be wrong in the safe direction. */
export function populationRange(): Range {
  return rangeFromPercentiles(0, 80);
}

/* Six-max opening ranges by how late the seat is, from the same position
   thresholds the older levels use. Lateness is 0 in the small blind and 1 on
   the button. */
export function positionRange(lateness: number): Range {
  const width = 12 + (25 - 12) * Math.max(0, Math.min(1, lateness));
  return rangeFromPercentiles(0, width);
}

export interface OpponentStats {
  hands: number;
  vpip: number; // hands where they put a chip in preflop
  pfr: number; // hands where they raised preflop
  aggressive: number; // postflop bets and raises
  passive: number; // postflop checks and calls
  // Postflop bets and raises of ours that they had to answer, and how many of
  // them they folded to. A fold is only ever seen after the fact: the hand
  // ends and we are never asked again, so it is counted when the next hand
  // starts and the answer never came. See SolverBot.
  betsFaced: number;
  foldsToOurBets: number;
}

/* Postflop actions before the passivity read is allowed to change anything. */
export const MIN_POSTFLOP_SAMPLE = 25;

// Where the read starts to bite and where it is at full strength. Balanced
// play sits somewhere around two thirds passive, so nothing under that is
// evidence of anything.
const PASSIVE_FLOOR = 0.68;
const PASSIVE_CEILING = 0.9;

/* How passive this opponent has been postflop, scaled to 0 (no evidence) to 1
   (they essentially never bet or raise without a hand).

   This one number drives both halves of the only deliberate deviation from
   equilibrium this bot makes, and it drives them because it is the only thing
   about an opponent that can be measured from inside a hand we are still in.
   Whether they fold to a bet cannot be: when they fold, the hand ends and we
   are never asked again. */
export function passivity(stats: OpponentStats): number {
  const actions = stats.aggressive + stats.passive;
  if (actions < MIN_POSTFLOP_SAMPLE) return 0;
  const share = stats.passive / actions;
  return Math.max(0, Math.min(1, (share - PASSIVE_FLOOR) / (PASSIVE_CEILING - PASSIVE_FLOOR)));
}

export function emptyStats(): OpponentStats {
  return { hands: 0, vpip: 0, pfr: 0, aggressive: 0, passive: 0, betsFaced: 0, foldsToOurBets: 0 };
}

/* Bets of ours they have had to answer before the fold rate is allowed to
   change anything. */
export const MIN_BET_SAMPLE = 15;

/* How often this opponent folds to a bet, or null while the sample is too
   small to mean anything. This is the number the decision to bluff actually
   turns on, and it is the reason the plumbing exists to see a fold at all: a
   bluff of b into a pot of p needs them to fold b / (p + b) of the time to
   break even, and against somebody who folds less than that every bluff in a
   balanced strategy is a donation. */
export function foldToBet(stats: OpponentStats): number | null {
  if (stats.betsFaced < MIN_BET_SAMPLE) return null;
  return stats.foldsToOurBets / stats.betsFaced;
}

/* How far the ranges we read off the charts should be widened for this
   opponent. Someone playing eighty percent of hands is not in any chart's
   range, and reading them against one is how a bot ends up folding to a fish
   with nothing. Under a dozen hands the sample says nothing and the base
   blend stands. */
/* How much population range to mix into an opponent's preflop chart read.
   Someone playing eighty percent of hands is not in any chart's range, and
   reading them against one is how a bot ends up folding to a fish with
   nothing. Under a dozen hands the sample says nothing. */
export function priorWeight(stats: OpponentStats): number {
  if (stats.hands < 12) return 0;
  const vpip = stats.vpip / stats.hands;
  // The charts defend around half of hands heads-up. Distance either side of
  // that is what the blend widens for.
  const looseness = Math.min(1, Math.abs(vpip - 0.55) / 0.35);
  return Math.min(0.6, PRIOR_PER_LOOSENESS * looseness);
}

/* Every combo's strength on this board, as a fraction of the combos it beats.
   Board rankings are cached: a hand asks for the same board up to four times
   and re-ranking 1326 combos each time is the one avoidable cost here. */
const strengthCache = new Map<string, Float32Array>();
const STRENGTH_CACHE_MAX = 512;

export function strengthOnBoard(board: number[]): Float32Array {
  const key = board.join(',');
  const cached = strengthCache.get(key);
  if (cached) return cached;

  const all = emptyRange();
  all.fill(1);
  removeBlocked(all, board);
  const universe: Universe = universeOf(all, all, board);
  const ranked = rankBoard(universe, board);
  const out = new Float32Array(NUM_COMBOS);
  const n = universe.n;
  // Walk the ranking worst first, so the share of the field beaten climbs.
  for (let g = ranked.groups.length - 2; g >= 0; g--) {
    const start = ranked.groups[g];
    const end = ranked.groups[g + 1];
    const beaten = n - end;
    const share = n <= 1 ? 0.5 : (beaten + (end - start - 1) / 2) / (n - 1);
    for (let p = start; p < end; p++) out[universe.combos[ranked.order[p]]] = share;
  }

  if (strengthCache.size >= STRENGTH_CACHE_MAX) strengthCache.clear();
  strengthCache.set(key, out);
  return out;
}

/* Where a combo sits inside a range on this board, by weight: 0 is the worst
   hand the range holds, 1 the best. The overlay in bot.ts needs to know
   whether a hand is the top of what we could have or the bottom of it, which
   absolute strength does not say. */
export function rankWithinRange(range: Range, board: number[], combo: number): number {
  const strength = strengthOnBoard(board);
  const mine = strength[combo];
  let total = 0;
  let below = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = range[i];
    if (w <= 0) continue;
    total += w;
    if (strength[i] < mine) below += w;
    else if (strength[i] === mine) below += w / 2;
  }
  return total <= 0 ? 0.5 : below / total;
}

export type AggressionKind = 'bet' | 'raise' | 'call' | 'check';

export interface Aggression {
  kind: AggressionKind;
  // Size of the wager as a fraction of the pot it went into. Zero for a check.
  potFraction: number;
}

function exponentFor(action: Aggression): number {
  const f = Math.min(MAX_POT_FRACTION, Math.max(0, action.potFraction));
  if (action.kind === 'raise') return RAISE_SHAPE + RAISE_SHAPE_PER_POT * f;
  if (action.kind === 'bet') return BET_SHAPE + BET_SHAPE_PER_POT * f;
  return CALL_SHAPE + CALL_SHAPE_PER_POT * f;
}

/* Narrow a range by one postflop action. Mutates and returns the same array,
   since a tracker holds exactly one of these per player per hand. */
export function filterByAction(range: Range, board: number[], action: Aggression): Range {
  const strength = strengthOnBoard(board);
  const exponent = action.kind === 'check' ? 0 : exponentFor(action);
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (range[i] === 0) continue;
    const s = strength[i];
    const lean = action.kind === 'check' ? 1 - CHECK_LEAN * s : Math.pow(s, exponent);
    range[i] *= FLOOR + (1 - FLOOR) * lean;
  }
  return range;
}

/* The chart range a heads-up preflop line leaves a player with. Steps are the
   preflop actions in order, oldest first, the way extract.ts walks them: the
   spot is (position, raises so far) and the region is the action taken. A line
   the charts do not name (a big blind facing a limp, anything past the four
   bet) falls back to the population range rather than to nothing. */
export function preflopRange(bucket: StackBucket, steps: PreflopStep[], who: Position): Range {
  let raises = 0;
  let range: Range | null = null;
  for (const step of steps) {
    if (step.position === who && !step.folded) {
      const spot = headsUpSpot(bucket, who, raises);
      if (spot) {
        range = chartRange(bucket, spot, step.aggressive ? 'aggr' : 'passive');
      } else if (!step.aggressive) {
        // Checking a free option says nothing at all.
        range = populationRange();
      }
    }
    if (step.aggressive) raises += 1;
  }
  return range ?? populationRange();
}

/* Both players' ranges through one hand. The caller feeds it actions as it
   sees them and asks for a range whenever it is about to solve. */
export class RangeTracker {
  private steps: PreflopStep[] = [];
  private postflop = new Map<Position, Range>();

  constructor(
    readonly bucket: StackBucket,
    private prior: number
  ) {}

  static forStacks(effectiveBb: number, prior = BASE_PRIOR): RangeTracker {
    return new RangeTracker(bucketFor(effectiveBb), prior);
  }

  preflopAction(position: Position, aggressive: boolean, folded = false): void {
    this.steps.push({ position, aggressive, folded });
  }

  /* Freeze the preflop reads and start filtering on the board. Called once,
     the first time a postflop range is asked for. */
  private ensurePostflop(who: Position, board: number[]): Range {
    let range = this.postflop.get(who);
    if (!range) {
      const chart = preflopRange(this.bucket, this.steps, who);
      // The population mix goes in here, once, rather than after every
      // postflop action: how much to trust a chart is a fact about the player,
      // not about the street.
      const widened = this.prior > 0 ? blendRanges(chart, populationRange(), this.prior) : chart;
      range = removeBlocked(widened, board);
      this.postflop.set(who, range);
    }
    return range;
  }

  /* Narrow a range by a strategy we actually know rather than by a lean. Our
     own postflop actions come out of a solve, and a solve says what every one
     of our combos does with the action we took, so our own range can be
     tracked exactly. Getting this wrong is worse than it sounds: telling the
     solver our range is the wide heuristic one when our real one is the
     solver's own output makes our hand look like the top of a range it is not
     in, and the answer to that is a value bet that has nothing to beat. */
  applyStrategy(who: Position, board: number[], frequencies: Float32Array): void {
    const range = this.ensurePostflop(who, board);
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (range[i] === 0) continue;
      range[i] *= frequencies[i];
    }
  }

  postflopAction(who: Position, board: number[], action: Aggression): void {
    const range = this.ensurePostflop(who, board);
    const before = cloneRange(range);
    filterByAction(range, board, action);
    // Damp the lean against the range as it stood, not against the population:
    // a read that has already narrowed twice must not be handed back. A raise
    // is damped least, because it is the one action that has to beat something
    // that was already good enough to bet.
    this.postflop.set(who, blendRanges(range, before, action.kind === 'raise' ? RAISE_PRIOR : BASE_PRIOR));
  }

  /* The range to hand the solver, blocked against the board and the cards we
     can see, and never empty. */
  rangeFor(who: Position, board: number[], dead: number[]): Range {
    const base = board.length === 0 ? preflopRange(this.bucket, this.steps, who) : this.ensurePostflop(who, board);
    const out = removeBlocked(cloneRange(base), [...board, ...dead]);
    return widen(out, 0.02, [...board, ...dead]);
  }

}
