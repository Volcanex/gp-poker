/* One heads-up hand, played by solving it.

   `SolverBot.decide` takes the same `TableView` a browser gets and answers
   with a legal action, or with null when the spot is not one it plays: more
   than two players in the hand, a view with no cards in it, or a solve that
   ran out of budget. Null means "ask the older levels", never "do nothing".

   Preflop is a chart read with mixed frequencies at the boundaries rather than
   a solve: the charts are heuristic, but a heads-up preflop range is the one
   part of this game that is already written down, and solving it properly
   needs the whole tree behind it rather than one street.

   Postflop it builds a subgame rooted at the decision in front of it and hands
   it to CFR+. The flop and the turn are depth limited (see solve.ts); the
   river is exact. Running the iterations is the caller's job, because whether
   this can block a thread is the caller's problem and not this package's. */

import {
  bucketFor,
  handClass,
  percentileOf,
  chartFor,
  regionsOf,
  type StackBucket,
} from '@opentable/preflop';
import type { ActionKind, Card, LegalActions, SeatView, TableView } from '@opentable/protocol';
import { NUM_COMBOS, cardIndex, comboIndex } from './cards.js';
import {
  RangeTracker,
  MIN_BET_SAMPLE,
  emptyStats,
  passivity,
  positionRange,
  priorWeight,
  rankWithinRange,
  type Aggression,
  type AggressionKind,
  type OpponentStats,
  type Position,
} from './opponent.js';
import { regionWeight, removeBlocked, type Range } from './range.js';
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

const BLUFF_RANK = 0.6; // the part of our range whose bets are mostly bluffs
const CATCH_RANK = 0.75; // the part that is calling rather than raising for value
const MAX_BLUFF_CUT = 0.9;
const MAX_CATCH_CUT = 0.7;

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
}

export class SolverBot {
  private hand: HandState | null = null;
  private matchId = '';
  private stats: OpponentStats = emptyStats();

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
    if (decision.a === 'b' || decision.a === 'r' || decision.a === 'a') {
      this.stats.betsFaced += 1;
      state.pendingBet = true;
    }
    if (state.exactlyTracked) {
      state.exactlyTracked = false;
      const wager = decision.a === 'b' || decision.a === 'r' || decision.a === 'a' ? (decision.v ?? me.stack + me.bet) - me.bet : 0;
      const before = Math.max(1, view.pot - Math.max(0, (view.seats.find((s) => s.i !== me.i)?.bet ?? 0) - me.bet));
      state.lastWagerFraction = wager > 0 ? wager / before : 0;
      return;
    }
    const opponent = view.seats.find((s) => s.i !== me.i && !s.folded && s.cards !== null);
    const wagered = decision.a === 'b' || decision.a === 'r' || decision.a === 'a' ? (decision.v ?? me.stack + me.bet) - me.bet : 0;
    const potBefore = Math.max(1, view.pot - Math.max(0, (opponent?.bet ?? 0) - me.bet));
    const facing = (opponent?.bet ?? 0) > me.bet;
    const kind: AggressionKind = aggressive ? (facing ? 'raise' : 'bet') : decision.a === 'c' ? 'call' : 'check';
    const potFraction = wagered / potBefore;
    // Remembered so that when the opponent's call of it turns up on the next
    // street, how big a call it was is still known.
    state.lastWagerFraction = aggressive ? potFraction : 0;
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

  async decide(view: TableView, rng: Rng, runner: SolveRunner, budgetMs: number): Promise<Decision | null> {
    const legal = view.legal;
    if (!legal || view.you === null) return null;
    const me = view.seats[view.you];
    const hole = me.cards;
    if (!hole || hole.length !== 2 || hole.includes('?')) return null;

    const state = this.stateFor(view);
    if (!state) return null;
    const inHand = view.seats.filter((s) => !s.out && !s.folded && s.cards !== null);
    const opponent = inHand.find((s) => s.i !== me.i);
    if (!opponent || inHand.length !== 2) return null;

    this.observe(state, view, me, opponent);

    const decision =
      view.street === 'pre'
        ? this.preflop(state, view, me, opponent, [hole[0], hole[1]], rng)
        : await this.postflop(state, view, me, opponent, [hole[0], hole[1]], rng, runner, budgetMs);
    if (!decision) return null;
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

    const spot = spotOrNull(bucket, position, raiseCount);
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

    const heroRange = this.heroRangeFor(state, view, me, board);
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

    const sticky = this.stats.betsFaced >= MIN_BET_SAMPLE ? this.stats.foldsToOurBets / this.stats.betsFaced : null;
    const read = passivity(this.stats);
    if (sticky !== null || read > 0) {
      const rank = rankWithinRange(heroRange, board, combo);
      const facing = legal.call > 0;
      const potNow = view.pot;
      for (const f of frequencies) {
        const aggressive = f.act.label === 'b' || f.act.label === 'r' || f.act.label === 'a';
        if (aggressive && rank < BLUFF_RANK && sticky !== null) {
          // What this particular size needs them to fold, against what they
          // actually fold. A bet that is already priced in never gets cut.
          const wager = Math.max(1, f.act.to - me.bet);
          const breakeven = wager / (potNow + wager);
          const shortfall = Math.max(0, (breakeven - sticky) / breakeven);
          f.frequency *= 1 - MAX_BLUFF_CUT * shortfall * (1 - rank / BLUFF_RANK);
        }
        if (facing && f.act.label === 'c' && rank < CATCH_RANK && read > 0) {
          f.frequency *= 1 - MAX_CATCH_CUT * read * (1 - rank / CATCH_RANK);
        }
      }
      // Whatever came off has to land on something legal, and giving up is
      // always legal.
      const passiveAct = frequencies.find((f) => f.act.label === (facing ? 'f' : 'x'));
      if (passiveAct) {
        const left = frequencies.reduce((sum, f) => sum + f.frequency, 0);
        passiveAct.frequency += Math.max(0, 1 - left);
      }
    }

    const total = frequencies.reduce((sum, f) => sum + f.frequency, 0);
    if (!(total > 0)) return null;
    let roll = rng() * total;
    let chosen = frequencies.length - 1;
    for (let k = 0; k < frequencies.length; k++) {
      roll -= frequencies[k].frequency;
      if (roll <= 0) {
        chosen = k;
        break;
      }
    }

    // Our own range narrows by the strategy that produced the action, not by
    // the lean an opponent's action gets, because here we know it exactly.
    const exact = new Float32Array(NUM_COMBOS);
    const n = result.universe.n;
    for (let p = 0; p < n; p++) exact[result.universe.combos[p]] = result.strategy[chosen * n + p];
    state.tracker.applyStrategy(state.heroPosition, board, exact);
    state.exactlyTracked = true;

    return toDecision(frequencies[chosen].act, legal);
  }

  /* Our own range in this spot, tracked the same way the opponent's is. It is
     not our actual hand: a strategy balanced against the hand we happen to
     hold is not balanced at all. */
  private heroRangeFor(state: HandState, view: TableView, me: SeatView, board: number[]): Range {
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

function spotOrNull(bucket: StackBucket, position: Position, raiseCount: number) {
  if (bucket === 'push') {
    if (position === 'sb' && raiseCount === 0) return 'sb_push' as const;
    if (position === 'bb' && raiseCount === 1) return 'bb_vs_push' as const;
    return null;
  }
  if (position === 'sb' && raiseCount === 0) return 'sb_open' as const;
  if (position === 'bb' && raiseCount === 1) return 'bb_vs_open' as const;
  if (position === 'sb' && raiseCount === 2) return 'sb_vs_3bet' as const;
  if (position === 'bb' && raiseCount === 3) return 'bb_vs_4bet' as const;
  return null;
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
