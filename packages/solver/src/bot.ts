/* One heads-up hand, played by a tier that thinks.

   `SolverBot.decide` takes the same `TableView` a browser gets and answers
   with a legal action, always. Where it does not solve, it asks the fallback
   it was given, which is how the older tiers play the streets this one leaves
   alone. Owning the whole hand rather than returning null for the parts it
   skips is what keeps the range tracking honest: a hand where somebody else
   made half our decisions is a hand where our own range is a guess.

   Two tiers live here.

   **`solver`** solves every postflop street. Preflop is a chart read with
   mixed frequencies at the boundaries rather than a solve: the charts are
   heuristic, but a heads-up preflop range is the one part of this game that is
   already written down, and solving it properly needs the whole tree behind it
   rather than one street. Postflop it builds a subgame rooted at the decision
   in front of it and hands it to CFR+; the flop and the turn are depth limited
   (see solve.ts) and the river is exact.

   **`regular`** is the tier in between. It plays the sharp tier's poker
   everywhere except the river, where it runs the exact solve on a shorter
   budget, and it leans on what it has measured about this particular opponent
   the whole way through. It is not a worse solver: it is a different bet about
   where the money is, that a read on a person is worth more than a depth
   limited guess at two streets of play.

   Running the iterations is the caller's job, because whether this can block a
   thread is the caller's problem and not this package's. */

import {
  bucketFor,
  handClass,
  percentileOf,
  chartFor,
  regionsOf,
} from '@opentable/preflop';
import type { ActionKind, BotTier, Card, LegalActions, SeatView, TableView } from '@opentable/protocol';
import { NUM_COMBOS, cardIndex, comboIndex } from './cards.js';
import {
  RangeTracker,
  aggressionFrequency,
  emptyStats,
  foldToBet,
  foldToCbet,
  passivity,
  positionRange,
  priorWeight,
  ranksWithinRange,
  vpipRate,
  type Aggression,
  type AggressionKind,
  type OpponentStats,
  type Position,
} from './opponent.js';
import { headsUpSpot, regionWeight, removeBlocked, type Range } from './range.js';
import { finishSubgame, frequenciesFor, prepareSubgame, type PreparedSubgame, type SubgameSpec } from './solve.js';
import type { Act } from './tree.js';

export type Rng = () => number;

export interface Decision {
  a: ActionKind;
  v?: number;
}

/* Runs the iterations. The server passes one that slices against the event
   loop; a script or a test passes one that just runs them. */
export type SolveRunner = (prepared: PreparedSubgame, budgetMs: number) => Promise<void>;

export const runInline: SolveRunner = async (prepared, budgetMs) => {
  prepared.cfr.run({ budgetMs });
};

/* The one deliberate deviation from the solve, and the reason level 6 beats
   the levels below it rather than merely drawing with them.

   An equilibrium bluffs to make the opponent indifferent between calling and
   folding. Against an opponent who is never going to fold, every one of those
   bluffs is a pure loss, and the same equilibrium calls down light against an
   opponent who never bluffs. Every level below this one calls a bet down to
   about a quarter of the pot in equity and bets only what it has, which is
   exactly that opponent, and it is why an unmodified solve loses hundreds of
   big blinds a hundred hands to level 5.

   So: the more passive an opponent has measurably been, the more the bottom of
   our range stops betting and the more our bluffcatchers stop calling. Both
   scale from nothing at balanced frequencies to most of the way at a station,
   both need a real sample first, and neither touches the top of the range. A
   bot with no read on anybody plays the solve. */
// Iterations below which a solve is not worth acting on.
const MIN_ITERATIONS = 40;

/* Purification. An average strategy is full of low frequency branches that
   exist to keep an equilibrium opponent honest: a two percent jam with air, a
   five percent check with the nuts. Against an opponent who is not looking for
   the pattern they buy nothing and cost variance, and against ours they cost
   real money, because the branches that survive at two percent are the ones
   the model is least sure about. So anything under the threshold is dropped
   and what is left is sharpened a little. This is the standard purification
   and thresholding pair, and it is known to help against opponents who are not
   playing the equilibrium, which is every opponent this bot has. */
const PURIFY_THRESHOLD = 0.08;
const PURIFY_EXPONENT = 1.3;

function purify(weights: number[]): number[] {
  const total = weights.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return weights;
  return weights.map((w) => {
    const share = w / total;
    return share < PURIFY_THRESHOLD ? 0 : Math.pow(share, PURIFY_EXPONENT);
  });
}

/* All three are measured against the opponent's range and not our own: what
   makes a hand a bluff is that it loses to most of what they have, and a hand
   can be the top of a range that is beaten anyway. */
const BLUFF_RANK = 0.5; // beats less than half of what they hold
const CATCH_RANK = 0.6; // calling rather than raising for value
const VALUE_RANK = 0.7; // wants to be paid rather than to fold anybody
const MAX_BLUFF_CUT = 0.9;
const MAX_CATCH_CUT = 0.7;
// The same read that says a bluff will not get through says a value bet will.
// Sizing chosen against somebody who folds correctly is too small against
// somebody who does not, so the top of the range leans on the larger sizes by
// as much again as the frequency the solve gave them.
const MAX_VALUE_TILT = 1.5;

/* The regular tier's four moves, in the order they appear in `exploit`. Each
   is bounded so that a strong read moves the strategy a long way and a weak
   one barely moves it at all. */
const WIDE_VPIP = 0.7; // above this their preflop range is not a chart's
const THIN_VALUE_PERCENTILE = 35; // the part of ours worth raising for value against it
const MAX_THIN_RAISE = 0.5;
const EXTRA_BLUFF_FRACTION = 0.5; // of the pot
const EXTRA_BLUFF_GAIN = 2;
const MAX_EXTRA_BLUFF = 0.45;
const MAX_VALUE_STRETCH = 0.6; // how much bigger a value bet gets against somebody who calls
const PASSIVE_AGGRESSION = 0.3; // below this their bets mean something
const MAX_EXTRA_FOLD = 0.5;

// Preflop sizings, in the units each is naturally read in: an open is a
// multiple of the big blind, a re-raise a multiple of what it faces.
const OPEN_BB = 2.5;
const THREE_BET_MULTIPLE = 3;
const FOUR_BET_MULTIPLE = 2.2;

interface HandState {
  key: string;
  tracker: RangeTracker;
  multiway: boolean;
  seenN: number;
  heroPosition: Position;
  // The size of our own last wager, as a fraction of the pot it went into.
  lastWagerFraction: number;
  // Set when the decision just taken came from a solve, so `record` knows the
  // range has already been narrowed by the exact strategy behind it.
  exactlyTracked: boolean;
  // True while a postflop bet or raise of ours is still unanswered. If the
  // hand ends with it still set and nobody showed a hand, they folded to it.
  pendingBet: boolean;
  // Whether that unanswered bet was on the flop, so a fold can be counted
  // against the street it happened on rather than only in the total.
  pendingBetOnFlop: boolean;
}

/* What plays the streets a tier does not solve, and what answers when a solve
   declines. Injected rather than imported: the older tiers are a pure function
   in the server and this package has no business reaching for it. */
export type Fallback = (view: TableView, rng: Rng) => Decision;

export interface SolverBotOptions {
  tier: Extract<BotTier, 'regular' | 'solver'>;
  fallback: Fallback;
}

export class SolverBot {
  private hand: HandState | null = null;
  private matchId = '';
  private stats: OpponentStats = emptyStats();
  private readonly tier: Extract<BotTier, 'regular' | 'solver'>;
  private readonly fallback: Fallback;

  constructor(options: SolverBotOptions) {
    this.tier = options.tier;
    this.fallback = options.fallback;
  }

  /* Which streets this tier solves for itself. The regular tier solves only
     the river, where the answer is exact; everywhere else it plays the sharp
     tier's poker with a read on top. */
  private solvesStreet(street: TableView['street']): boolean {
    if (street === 'pre') return this.tier === 'solver';
    if (this.tier === 'solver') return true;
    return street === 'river';
  }

  /* Match scoped, deliberately. A read on somebody is worth having inside a
     best of twenty five and is worth nothing at all across two different
     people who happened to sit in the same seat. */
  private resetMatch(matchId: string): void {
    this.matchId = matchId;
    this.stats = emptyStats();
    this.hand = null;
  }

  stateFor(view: TableView): HandState | null {
    if (view.m !== this.matchId) this.resetMatch(view.m);
    const me = view.you === null ? null : view.seats[view.you];
    if (!me) return null;
    const inHand = view.seats.filter((s) => !s.out && !s.folded && s.cards !== null);
    const key = `${view.m}:${view.h}`;
    if (!this.hand || this.hand.key !== key) {
      // A bet of ours that the last hand never answered was folded to. The
      // hand may instead have ended at a showdown, which `observeResult`
      // clears when the server tells us; a harness that never calls it simply
      // sees a slightly high fold rate.
      if (this.hand?.pendingBet) {
        this.stats.foldsToOurBets += 1;
        if (this.hand.pendingBetOnFlop) this.stats.foldsToOurCbets += 1;
        this.hand.pendingBet = false;
      }
      const effective = Math.min(...inHand.map((s) => s.stack + s.bet)) / view.blinds.bb;
      this.hand = {
        key,
        tracker: new RangeTracker(bucketFor(effective), priorWeight(this.stats)),
        multiway: inHand.length > 2,
        seenN: -1,
        heroPosition: me.button ? 'sb' : 'bb',
        lastWagerFraction: 0,
        exactlyTracked: false,
        pendingBet: false,
        pendingBetOnFlop: false,
      };
      this.stats.hands += 1;
    }
    return this.hand;
  }

  /* Fold the opponent's most recent action into their range. Heads-up exactly
     one of their actions separates two of ours, so their `last` is it.

     When the street turned over between our decisions the action is filtered
     against the board as it is now rather than as it was, which reads a flop
     call as a turn call. The filter is a lean blended back towards a prior
     rather than a proof, and carrying the old board through would need state
     that buys nothing else. */
  private observe(state: HandState, view: TableView, me: SeatView, opponent: SeatView): void {
    if (view.n <= state.seenN) return;
    state.seenN = view.n;
    const last = opponent.last;
    if (!last) return;
    // They answered whatever we last put in, so it was not folded to.
    state.pendingBet = false;
    const aggressive = last.a === 'b' || last.a === 'r' || last.a === 'a';
    if (view.street === 'pre') {
      if (state.multiway) return;
      const position: Position = opponent.button ? 'sb' : 'bb';
      state.tracker.preflopAction(position, aggressive, last.a === 'f');
      if (aggressive) this.stats.pfr += 1;
      if (aggressive || last.a === 'c') this.stats.vpip += 1;
      return;
    }
    if (aggressive) this.stats.aggressive += 1;
    else this.stats.passive += 1;
    const position: Position = opponent.button ? 'sb' : 'bb';
    state.tracker.postflopAction(
      position,
      view.board.map(cardIndex),
      observedAction(view, me, opponent, last.a, state.lastWagerFraction)
    );
  }

  private record(state: HandState, view: TableView, me: SeatView, decision: Decision): void {
    const aggressive = decision.a === 'b' || decision.a === 'r' || decision.a === 'a';
    if (view.street === 'pre') {
      if (!state.multiway) state.tracker.preflopAction(state.heroPosition, aggressive, decision.a === 'f');
      return;
    }
    if (decision.a === 'f') return;
    if (aggressive) {
      this.stats.betsFaced += 1;
      state.pendingBet = true;
      state.pendingBetOnFlop = view.board.length === 3;
      if (state.pendingBetOnFlop) this.stats.cbetsFaced += 1;
    }

    const opponent = view.seats.find((s) => s.i !== me.i && !s.folded && s.cards !== null);
    const facing = (opponent?.bet ?? 0) > me.bet;
    const wagered = aggressive ? (decision.v ?? me.stack + me.bet) - me.bet : 0;
    const potBefore = Math.max(1, view.pot - Math.max(0, (opponent?.bet ?? 0) - me.bet));
    const potFraction = wagered / potBefore;
    // Remembered so that when the opponent's call of it turns up on the next
    // street, how big a call it was is still known.
    state.lastWagerFraction = aggressive ? potFraction : 0;

    // A decision that came from a solve has already narrowed our range by the
    // strategy behind it, exactly. Leaning on it again would count it twice.
    if (state.exactlyTracked) {
      state.exactlyTracked = false;
      return;
    }
    const kind: AggressionKind = aggressive ? (facing ? 'raise' : 'bet') : decision.a === 'c' ? 'call' : 'check';
    state.tracker.postflopAction(state.heroPosition, view.board.map(cardIndex), { kind, potFraction });
  }

  /* The end of a hand, which is the only place a fold can be seen: when
     somebody folds, the hand is over and this bot is never asked again. A
     showdown clears the flag instead, since a bet that got to a showdown was
     called rather than folded to. Callers that never send this (a benchmark
     harness that stops at the last decision) lose only the ability to tell a
     called river bet from a folded one, which reads as a fold rate a little
     high rather than as nothing at all. */
  observeResult(view: Pick<TableView, 'm' | 'h' | 'result'>): void {
    if (!this.hand || this.hand.key !== `${view.m}:${view.h}`) return;
    if (!this.hand.pendingBet) return;
    const shown = view.result ? Object.keys(view.result.shown).length : 0;
    if (shown > 0) this.hand.pendingBet = false;
  }

  async decide(view: TableView, rng: Rng, runner: SolveRunner, budgetMs: number): Promise<Decision> {
    const legal = view.legal;
    if (!legal || view.you === null) return this.fallback(view, rng);
    const me = view.seats[view.you];
    const hole = me.cards;
    if (!hole || hole.length !== 2 || hole.includes('?')) return this.fallback(view, rng);

    const state = this.stateFor(view);
    if (!state) return this.fallback(view, rng);
    const inHand = view.seats.filter((s) => !s.out && !s.folded && s.cards !== null);
    const opponent = inHand.find((s) => s.i !== me.i);
    // More than two in the hand is not a game this package plays. A six-max
    // hand that has become heads-up postflop is, and arrives here as one.
    if (!opponent || inHand.length !== 2) return this.fallback(view, rng);

    this.observe(state, view, me, opponent);

    const cards: [Card, Card] = [hole[0], hole[1]];
    let decision: Decision | null = null;
    if (this.solvesStreet(view.street)) {
      decision =
        view.street === 'pre'
          ? this.preflop(state, view, me, opponent, cards, rng)
          : await this.postflop(state, view, me, opponent, cards, rng, runner, budgetMs);
    }
    if (!decision) decision = this.exploit(state, view, me, opponent, cards, this.fallback(view, rng), rng);
    this.record(state, view, me, decision);
    return decision;
  }

  /* The chart read, mixed at the edges. A hand a percentile or two either side
     of a boundary plays both ways at the frequency its distance from the edge
     suggests, so the bot is not a lookup table and a chart that is a little
     wrong in one place is a little wrong rather than categorically wrong. */
  private preflop(
    state: HandState,
    view: TableView,
    me: SeatView,
    opponent: SeatView,
    hole: [Card, Card],
    rng: Rng
  ): Decision | null {
    if (state.multiway) return null;
    const bb = view.blinds.bb;
    const currentBet = Math.max(me.bet, opponent.bet);
    const effective = Math.min(me.stack + me.bet, opponent.stack + opponent.bet) / bb;
    const bucket = bucketFor(effective);
    const position = state.heroPosition;

    // Heads-up the button posts the small blind and acts first, so the number
    // of raises so far reads straight off the two bets.
    let raiseCount: number | null;
    if (position === 'sb') raiseCount = me.bet > bb ? 2 : 0;
    else if (me.bet > bb) raiseCount = 3;
    else raiseCount = opponent.bet > bb ? 1 : null;
    if (raiseCount === null) return null;

    // The same (position, raises) to spot map the accuracy scorer uses, so a
    // chart the bot plays and a chart a person is graded against cannot drift.
    const spot = headsUpSpot(bucket, position, raiseCount);
    if (!spot) return null;
    const chart = regionsOf(chartFor(bucket, spot));
    const percentile = percentileOf(handClass(hole));

    const weights: [string, number][] = [];
    for (const action of ['aggr', 'passive', 'fold'] as const) {
      const region = chart[action];
      if (!region) continue;
      weights.push([action, regionWeight(percentile, region[0], region[1])]);
    }
    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) return giveUp(view.legal!);
    let roll = rng() * total;
    let chosen = weights[weights.length - 1][0];
    for (const [action, w] of weights) {
      roll -= w;
      if (roll <= 0) {
        chosen = action;
        break;
      }
    }

    const legal = view.legal!;
    if (chosen === 'fold') return giveUp(legal);
    if (chosen === 'passive') return legal.call > 0 ? { a: 'c' } : { a: 'x' };
    if (bucket === 'push') return legal.actions.includes('a') ? { a: 'a' } : raiseTo(legal, legal.max);
    const to =
      currentBet <= bb
        ? Math.round(OPEN_BB * bb)
        : raiseCount >= 2
          ? Math.round(FOUR_BET_MULTIPLE * currentBet)
          : Math.round(THREE_BET_MULTIPLE * currentBet);
    return raiseTo(legal, to);
  }

  private async postflop(
    state: HandState,
    view: TableView,
    me: SeatView,
    opponent: SeatView,
    hole: [Card, Card],
    rng: Rng,
    runner: SolveRunner,
    budgetMs: number
  ): Promise<Decision | null> {
    const legal = view.legal!;
    const board = view.board.map(cardIndex);
    if (board.length < 3) return null;
    const dead = [cardIndex(hole[0]), cardIndex(hole[1])];
    const combo = comboIndex(dead[0], dead[1]);

    const heroRange = this.heroRangeFor(state, me, board);
    const villainRange = state.tracker.rangeFor(opponent.button ? 'sb' : 'bb', board, []);
    removeBlocked(villainRange, dead);

    const pot = view.pot - me.bet - opponent.bet;
    const stack = Math.min(me.stack + me.bet, opponent.stack + opponent.bet);
    if (stack <= Math.max(me.bet, opponent.bet)) return null; // nothing left to decide with

    const spec: SubgameSpec = {
      board,
      heroRange,
      villainRange,
      hero: 0,
      pot,
      committed: [me.bet, opponent.bet],
      stack,
      toAct: 0,
      minBet: view.blinds.bb,
      minRaiseTo: legal.min,
      // Postflop heads-up the seat out of position acts first, so facing no
      // bet on the button means the other seat has already checked.
      actedThisRound: me.bet === opponent.bet && me.button,
    };

    const prepared = prepareSubgame(spec);
    await runner(prepared, budgetMs);
    // A solve this short is noise wearing a strategy's clothes. Better to hand
    // the spot to level 5 than to act on it.
    if (prepared.cfr.iterations < MIN_ITERATIONS) return null;
    const result = finishSubgame(prepared);
    const frequencies = frequenciesFor(result, combo);
    if (!frequencies) return null;

    const sticky = foldToBet(this.stats);
    const read = passivity(this.stats);
    const ranks = sticky !== null || read > 0 ? ranksWithinRange(villainRange, board) : null;
    const facing = legal.call > 0;
    const shape = (weights: number[], rank: number): number[] => {
      const out = weights.slice();
      if (!ranks) return purify(out);
      for (let k = 0; k < out.length; k++) {
        const act = result.acts[k];
        const aggressive = act.label === 'b' || act.label === 'r' || act.label === 'a';
        if (aggressive && sticky !== null) {
          // What this particular size needs them to fold, against what they
          // actually fold. A bet that is already priced in is left alone.
          const wager = Math.max(1, act.to - me.bet);
          const breakeven = wager / (view.pot + wager);
          const shortfall = Math.max(0, (breakeven - sticky) / breakeven);
          if (rank < BLUFF_RANK) out[k] *= 1 - MAX_BLUFF_CUT * shortfall * (1 - rank / BLUFF_RANK);
          else if (rank > VALUE_RANK) {
            out[k] *= 1 + MAX_VALUE_TILT * shortfall * ((rank - VALUE_RANK) / (1 - VALUE_RANK));
          }
        }
        if (facing && act.label === 'c' && rank < CATCH_RANK && read > 0) {
          out[k] *= 1 - MAX_CATCH_CUT * read * (1 - rank / CATCH_RANK);
        }
      }
      // Whatever came off has to land on something legal, and giving up always
      // is.
      const giveUpAt = result.acts.findIndex((a) => a.label === (facing ? 'f' : 'x'));
      if (giveUpAt >= 0) {
        const left = out.reduce((sum, v) => sum + v, 0);
        out[giveUpAt] += Math.max(0, 1 - left);
      }
      return purify(out);
    };

    const weights = shape(
      frequencies.map((f) => f.frequency),
      ranks ? ranks[combo] : 0.5
    );
    const total = weights.reduce((sum, v) => sum + v, 0);
    if (!(total > 0)) return null;
    let roll = rng() * total;
    let chosen = weights.length - 1;
    for (let k = 0; k < weights.length; k++) {
      roll -= weights[k];
      if (roll <= 0) {
        chosen = k;
        break;
      }
    }

    /* Our own range narrows by the strategy that produced the action, not by
       the lean an opponent's action gets, because here we know it exactly. It
       is the shaped strategy and not the solved one: what we tell ourselves we
       played has to be what we played, or the range we hand the next street is
       a range for a bot that does not exist. Shaping every combo costs one
       pass over the universe, which is what the ranks sweep above is for. */
    const exact = new Float32Array(NUM_COMBOS);
    const n = result.universe.n;
    const raw = new Array<number>(result.acts.length);
    for (let p = 0; p < n; p++) {
      const c = result.universe.combos[p];
      for (let k = 0; k < raw.length; k++) raw[k] = result.strategy[k * n + p];
      const shaped = shape(raw, ranks ? ranks[c] : 0.5);
      const sum = shaped.reduce((acc, v) => acc + v, 0);
      exact[c] = sum > 0 ? shaped[chosen] / sum : 0;
    }
    state.tracker.applyStrategy(state.heroPosition, board, exact);
    state.exactlyTracked = true;

    return toDecision(result.acts[chosen], legal);
  }

  /* The read, applied to a decision one of the older tiers made.

     This is the whole of what makes `regular` a tier rather than "the solver
     with the turn switched off". The sharp tier plays a fixed strategy against
     everybody; this one has measured how a particular person folds, how often
     they bet, and how many hands they play, and moves in the four places where
     those numbers say the fixed strategy is leaving money behind. Every rule
     is a no-op until its sample is there, so a bot with no read on somebody
     plays exactly the sharp tier.

     It does not touch the solver tier: that one's deviation lives inside the
     solve, where it can be applied per combo rather than to one action. */
  private exploit(
    state: HandState,
    view: TableView,
    me: SeatView,
    opponent: SeatView,
    hole: [Card, Card],
    decision: Decision,
    rng: Rng
  ): Decision {
    if (this.tier !== 'regular') return decision;
    const legal = view.legal;
    if (!legal) return decision;
    const board = view.board.map(cardIndex);

    // Wide preflop is a weak range by the flop, so the hands the charts say to
    // call with are worth raising for value instead.
    if (view.street === 'pre') {
      const vpip = vpipRate(this.stats);
      if (decision.a !== 'c' || vpip === null || vpip <= WIDE_VPIP) return decision;
      if (percentileOf(handClass(hole)) > THIN_VALUE_PERCENTILE) return decision;
      const wideness = (vpip - WIDE_VPIP) / (1 - WIDE_VPIP);
      if (rng() >= Math.min(MAX_THIN_RAISE, wideness)) return decision;
      const bb = view.blinds.bb;
      const facing = Math.max(me.bet, opponent.bet);
      return raiseTo(legal, facing > bb ? Math.round(THREE_BET_MULTIPLE * facing) : Math.round(OPEN_BB * bb));
    }

    if (board.length < 3) return decision;
    const villain = state.tracker.rangeFor(opponent.button ? 'sb' : 'bb', board, []);
    const rank = ranksWithinRange(villain, board)[comboIndex(cardIndex(hole[0]), cardIndex(hole[1]))];

    // Somebody who folds more than the price of a bet is somebody to bet at
    // with the hands that cannot win a showdown.
    if (decision.a === 'x' && legal.call === 0 && rank < BLUFF_RANK) {
      const fold = (board.length === 3 ? foldToCbet(this.stats) : null) ?? foldToBet(this.stats);
      const wager = Math.max(view.blinds.bb, Math.round(EXTRA_BLUFF_FRACTION * view.pot));
      const breakeven = wager / (view.pot + wager);
      const edge = fold === null ? 0 : (fold - breakeven) / Math.max(0.05, 1 - breakeven);
      if (edge > 0 && rng() < Math.min(MAX_EXTRA_BLUFF, edge * EXTRA_BLUFF_GAIN)) {
        return raiseTo(legal, me.bet + wager);
      }
      return decision;
    }

    // Somebody who folds less than the price is somebody to bet bigger at with
    // the hands that beat their range.
    if ((decision.a === 'b' || decision.a === 'r') && decision.v !== undefined && rank > VALUE_RANK) {
      const fold = foldToBet(this.stats);
      const wager = decision.v - me.bet;
      const breakeven = wager / (view.pot + wager);
      if (fold !== null && wager > 0 && fold < breakeven) {
        const shortfall = (breakeven - fold) / breakeven;
        return raiseTo(legal, me.bet + Math.round(wager * (1 + MAX_VALUE_STRETCH * shortfall)));
      }
      return decision;
    }

    // Somebody who rarely bets is somebody whose bets mean something, and
    // calling one down with a hand that beats nothing they are betting is the
    // most expensive habit there is.
    if (decision.a === 'c' && legal.call > 0 && rank < CATCH_RANK) {
      const aggression = aggressionFrequency(this.stats);
      if (aggression !== null && aggression < PASSIVE_AGGRESSION) {
        const timidity = (PASSIVE_AGGRESSION - aggression) / PASSIVE_AGGRESSION;
        if (rng() < MAX_EXTRA_FOLD * timidity * (1 - rank / CATCH_RANK)) return giveUp(legal);
      }
    }

    return decision;
  }

  /* Our own range in this spot, tracked the same way the opponent's is. It is
     not our actual hand: a strategy balanced against the hand we happen to
     hold is not balanced at all. */
  private heroRangeFor(state: HandState, me: SeatView, board: number[]): Range {
    if (state.multiway) {
      const range = positionRange(me.button ? 1 : 0);
      return removeBlocked(range, board);
    }
    return state.tracker.rangeFor(state.heroPosition, board, []);
  }
}

/* What the opponent's action says about how big it was, relative to the pot it
   went into. The view shows the street bets as they stand now, so what we face
   is the difference between them and the pot before it is the rest. */
function observedAction(
  view: TableView,
  me: SeatView,
  opponent: SeatView,
  kind: ActionKind,
  lastWagerFraction: number
): Aggression {
  const wagered = Math.max(0, opponent.bet - me.bet);
  const potBefore = Math.max(1, view.pot - wagered);
  if (kind === 'b' || kind === 'r' || kind === 'a') {
    return { kind: me.bet > 0 ? 'raise' : 'bet', potFraction: wagered / potBefore };
  }
  if (kind === 'c') {
    // The street may have turned since, in which case the bets in the view are
    // both zero and the size of what they called is what we last wagered.
    const called = me.bet > 0 ? me.bet / potBefore : lastWagerFraction;
    return { kind: 'call', potFraction: called };
  }
  return { kind: 'check', potFraction: 0 };
}

function giveUp(legal: LegalActions): Decision {
  return legal.actions.includes('x') && legal.call === 0 ? { a: 'x' } : { a: 'f' };
}

function raiseTo(legal: LegalActions, to: number): Decision {
  const clamped = Math.max(legal.min, Math.min(legal.max, Math.round(to)));
  if (clamped >= legal.max && legal.actions.includes('a')) return { a: 'a' };
  if (legal.actions.includes('r')) return { a: 'r', v: clamped };
  if (legal.actions.includes('b')) return { a: 'b', v: clamped };
  if (legal.actions.includes('a')) return { a: 'a' };
  return giveUp(legal);
}

function toDecision(act: Act, legal: LegalActions): Decision {
  if (act.label === 'f') return giveUp(legal);
  if (act.label === 'x') return legal.call === 0 && legal.actions.includes('x') ? { a: 'x' } : { a: 'c' };
  if (act.label === 'c') return legal.call > 0 ? { a: 'c' } : { a: 'x' };
  return raiseTo(legal, act.to);
}
