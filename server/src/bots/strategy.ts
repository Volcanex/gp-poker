import { evaluateCards } from 'phe';
import { bucketFor, chartFor, handClass, percentileOf, regionsOf, spotFor, type DecisionAction } from '@opentable/preflop';
import type { ActionKind, Card, LegalActions, SeatView, TableView } from '@opentable/protocol';

/* The bot brain. Pure: it takes the same TableView a client gets, plus a
   random source, and returns one action that is guaranteed to be in that
   view's legal set. Nothing here touches a socket, a room or the database,
   so every branch is reachable from a synthetic view in a unit test.

   Preflop it reuses @opentable/preflop: the hand's percentile in the equity
   ranking, read against the heads-up charts when the table is heads-up, and
   against position-aware thresholds when it is not (the charts only model
   two players, so applying them six-handed would be worse than a rule of
   thumb). Postflop it is all hand strength: the fraction of the opponent
   holdings still possible on this board that the bot's hand beats. */

export type Rng = () => number;

export interface BotDecision {
  a: ActionKind;
  v?: number;
}

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

const FULL_DECK: Card[] = (() => {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}`);
  return deck;
})();

// Percentile jitter, in points of the equity ranking. Enough to blur the
// edge of every threshold so the bot is not a lookup table anyone can read
// off after a dozen hands, small enough not to change a clear decision.
const JITTER = 3;

// Position-aware multiway preflop thresholds, as percentiles (0 = best hand).
const RAISE_EARLY = 12;
const RAISE_BUTTON = 25;
const CALL_OPEN = 40;
const THREE_BET = 6;
const CALL_THREE_BET = 12;
const SHORT_STACK_BB = 12;
const SHORT_JAM = 25;

const STRONG = 0.85;
const MEDIUM = 0.55;
const BLUFF_CHANCE = 0.08;

// Above this fraction of the stack a raise is just an all-in with extra steps.
const ALL_IN_FRACTION = 0.8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fallback(legal: LegalActions): BotDecision {
  for (const a of ['x', 'c', 'f'] as ActionKind[]) if (legal.actions.includes(a)) return { a };
  return { a: legal.actions[0] };
}

// The one gate every decision leaves through: an action the view did not
// offer, or an amount outside the legal window, becomes the safest thing
// that was actually available.
export function ensureLegal(decision: BotDecision, legal: LegalActions): BotDecision {
  if (!legal.actions.includes(decision.a)) return fallback(legal);
  if (decision.a === 'b' || decision.a === 'r') {
    if (decision.v === undefined || !Number.isFinite(decision.v)) return fallback(legal);
    return { a: decision.a, v: clamp(Math.round(decision.v), legal.min, legal.max) };
  }
  return { a: decision.a };
}

/* Fraction of the opponent two-card holdings still possible on this board
   that the bot's hand beats, ties counting a half. Every card the bot can
   see (its own two and the board) is removed from the deck first; the rest
   are enumerated in pairs. Board of three: 990 combinations, one phe
   evaluation each. */
export function handStrength(hole: [Card, Card], board: Card[]): number {
  const seen = new Set<string>([...hole, ...board]);
  const rest = FULL_DECK.filter((c) => !seen.has(c));
  const mine = evaluateCards([...hole, ...board]);
  let score = 0;
  let total = 0;
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const theirs = evaluateCards([rest[i], rest[j], ...board]);
      if (theirs > mine) score += 1;
      else if (theirs === mine) score += 0.5;
      total += 1;
    }
  }
  return total === 0 ? 0 : score / total;
}

interface Ctx {
  view: TableView;
  legal: LegalActions;
  me: SeatView;
  inHand: SeatView[];
  hole: [Card, Card];
  bb: number;
  currentBet: number;
  pot: number;
  myTotal: number; // chips behind plus what is already in front of me
  effectiveBb: number;
  rng: Rng;
}

function aggressive(ctx: Ctx, targetIncrease: number): BotDecision {
  const { legal, currentBet, myTotal } = ctx;
  const raiseTo = clamp(Math.round(currentBet + targetIncrease), legal.min, legal.max);
  if (raiseTo >= ALL_IN_FRACTION * myTotal && legal.actions.includes('a')) return { a: 'a' };
  if (legal.actions.includes('b')) return { a: 'b', v: raiseTo };
  if (legal.actions.includes('r')) return { a: 'r', v: raiseTo };
  if (legal.actions.includes('a')) return { a: 'a' };
  return fallback(legal);
}

function passive(ctx: Ctx): BotDecision {
  return ctx.legal.call > 0 ? { a: 'c' } : { a: 'x' };
}

// Folding when checking is free is never right, so "fold" means "give up as
// cheaply as the spot allows".
function giveUp(ctx: Ctx): BotDecision {
  return ctx.legal.actions.includes('x') && ctx.legal.call === 0 ? { a: 'x' } : { a: 'f' };
}

function fromCategory(ctx: Ctx, category: DecisionAction): BotDecision {
  if (category === 'aggr') return aggressive(ctx, Math.max(2 * ctx.bb, Math.round(ctx.pot * 0.75)));
  if (category === 'passive') return passive(ctx);
  return giveUp(ctx);
}

function potOddsOk(ctx: Ctx, strength: number): boolean {
  const call = ctx.legal.call;
  if (call <= 0) return true;
  return call / (ctx.pot + call) < strength;
}

// Postflop order, small blind first and the button last, over the seats
// still in the hand. Lateness is 1 on the button and 0 in the small blind.
function lateness(ctx: Ctx): number {
  const seats = ctx.view.seats;
  const n = seats.length;
  const buttonSeat = seats.findIndex((s) => s.button);
  const order: number[] = [];
  for (let k = 1; k <= n; k++) {
    const idx = (buttonSeat + k) % n;
    if (ctx.inHand.some((s) => s.i === idx)) order.push(idx);
  }
  if (order.length <= 1) return 1;
  const myIdx = order.indexOf(ctx.me.i);
  const after = order.length - 1 - myIdx;
  return 1 - after / (order.length - 1);
}

function preflopHeadsUp(ctx: Ctx, percentile: number): BotDecision | null {
  const opponent = ctx.inHand.find((s) => s.i !== ctx.me.i);
  if (!opponent) return null;
  const bucket = bucketFor(ctx.effectiveBb);
  const position = ctx.me.button ? 'sb' : 'bb';

  // Heads-up the button is the small blind and acts first preflop, so how
  // many raises have gone in is readable straight off the two bets: a seat
  // that has put in more than a big blind has raised.
  let raiseCount: number | null;
  if (position === 'sb') raiseCount = ctx.me.bet > ctx.bb ? 2 : 0;
  else if (ctx.me.bet > ctx.bb) raiseCount = 3;
  else raiseCount = opponent.bet > ctx.bb ? 1 : null;

  const spot = raiseCount === null ? null : spotFor(bucket, position, raiseCount);
  if (!spot) return null;

  const regions = regionsOf(chartFor(bucket, spot));
  const category =
    (['aggr', 'passive', 'fold'] as DecisionAction[]).find((a) => {
      const r = regions[a];
      return r && percentile >= r[0] && percentile <= r[1];
    }) ?? 'fold';
  return fromCategory(ctx, category);
}

function preflopMultiway(ctx: Ctx, percentile: number): BotDecision {
  if (ctx.effectiveBb < SHORT_STACK_BB) {
    if (percentile <= SHORT_JAM) return ctx.legal.actions.includes('a') ? { a: 'a' } : aggressive(ctx, ctx.myTotal);
    return giveUp(ctx);
  }

  const raiseThreshold = RAISE_EARLY + (RAISE_BUTTON - RAISE_EARLY) * lateness(ctx);
  const raised = ctx.currentBet > ctx.bb;
  const aggressors = ctx.inHand.filter((s) => s.bet > ctx.bb).length;

  if (!raised) {
    if (percentile <= raiseThreshold) return aggressive(ctx, 2 * ctx.bb);
    if (ctx.legal.call === 0) return { a: 'x' };
    if (percentile <= CALL_OPEN && ctx.legal.call <= 2 * ctx.bb) return passive(ctx);
    return giveUp(ctx);
  }

  if (aggressors < 2) {
    if (percentile <= THREE_BET) return aggressive(ctx, 2 * ctx.currentBet);
    if (percentile <= CALL_OPEN && ctx.legal.call <= 0.25 * ctx.myTotal) return passive(ctx);
    return giveUp(ctx);
  }

  if (percentile <= CALL_THREE_BET) return passive(ctx);
  return giveUp(ctx);
}

function postflop(ctx: Ctx): BotDecision {
  const strength = handStrength(ctx.hole, ctx.view.board);
  const checkedTo = ctx.legal.call === 0;

  if (strength > STRONG) return aggressive(ctx, Math.max(ctx.bb, Math.round(ctx.pot * 0.66)));

  if (strength >= MEDIUM) {
    if (checkedTo) return aggressive(ctx, Math.max(ctx.bb, Math.round(ctx.pot * 0.5)));
    return potOddsOk(ctx, strength) ? passive(ctx) : giveUp(ctx);
  }

  if (checkedTo) {
    const lateStreet = ctx.view.street === 'turn' || ctx.view.street === 'river';
    if (lateStreet && ctx.rng() < BLUFF_CHANCE) return aggressive(ctx, Math.max(ctx.bb, Math.round(ctx.pot * 0.5)));
    return { a: 'x' };
  }
  return potOddsOk(ctx, strength) ? passive(ctx) : giveUp(ctx);
}

export function decide(view: TableView, rng: Rng = Math.random): BotDecision {
  const legal = view.legal;
  if (!legal) throw new Error('decide called on a view with no legal actions');
  const me = view.you === null ? undefined : view.seats[view.you];
  if (!me) return fallback(legal);

  const hole = me.cards;
  if (!hole || hole.length !== 2 || hole.includes('?')) return fallback(legal);

  const inHand = view.seats.filter((s) => !s.out && !s.folded && s.cards !== null);
  const bb = view.blinds.bb;
  const currentBet = Math.max(...view.seats.map((s) => s.bet), 0);
  const myTotal = me.stack + me.bet;
  const effective = Math.min(...inHand.map((s) => s.stack + s.bet));

  const ctx: Ctx = {
    view,
    legal,
    me,
    inHand,
    hole: [hole[0], hole[1]],
    bb,
    currentBet,
    pot: view.pot,
    myTotal,
    effectiveBb: effective / bb,
    rng,
  };

  let decision: BotDecision;
  if (view.street === 'pre') {
    const percentile = clamp(percentileOf(handClass(ctx.hole)) + (rng() * 2 - 1) * JITTER, 0, 100);
    decision = (inHand.length === 2 ? preflopHeadsUp(ctx, percentile) : null) ?? preflopMultiway(ctx, percentile);
  } else {
    decision = postflop(ctx);
  }

  return ensureLegal(decision, legal);
}
