import { evaluateCards } from 'phe';
import { bucketFor, chartFor, handClass, percentileOf, regionsOf, spotFor, type DecisionAction } from '@opentable/preflop';
import {
  DEFAULT_BOT_LEVEL,
  LEVEL_TIER,
  type ActionKind,
  type BotLevel,
  type BotTier,
  type Card,
  type LegalActions,
  type SeatView,
  type TableView,
} from '@opentable/protocol';
import { NEUTRAL_PERSONA, type Persona } from './persona.js';

export type { Persona } from './persona.js';

/* The bot brain. Pure: it takes the same TableView a client gets, plus a
   random source, and returns one action that is guaranteed to be in that
   view's legal set. Nothing here touches a socket, a room or the database,
   so every branch is reachable from a synthetic view in a unit test.

   Preflop it reuses @opentable/preflop: the hand's percentile in the equity
   ranking, read against the heads-up charts when the table is heads-up, and
   against position-aware thresholds when it is not (the charts only model
   two players, so applying them six-handed would be worse than a rule of
   thumb). Postflop it is all hand strength: the fraction of the opponent
   holdings still possible on this board that the bot's hand beats.

   Seven levels, not seven brains, and only five tiers are in here: the two
   that think (`regular` and `solver`) live in solver.ts. Nothing below
   branches on a level number, only on the tier the protocol maps it to, so
   renumbering the ladder does not reach into the strategy. Level 4 is that
   bot, unchanged and still the default: every other level reuses the same context, the same strength
   number and the same action helpers, and differs only in a handful of named
   constants and which rule it reaches for. Levels 1 to 3 replace the chart
   read with a plain percentile threshold and vary how loose, how passive and
   how price-aware they are; level 5 keeps level 4 whole and adds semi-bluffs,
   continuation bets, board-aware sizing, thinner river value and the odd
   3-bet bluff. The ordering is asserted, not asserted-by-hand: levels.test.ts
   plays them against each other through the engine. */

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

/* Levels 1 to 3 preflop. `play` is the percentile of the equity ranking the
   level will put a chip in with when nobody has raised, `playVsRaise` the
   same once someone has (level 1 barely tightens, level 3 tightens hard),
   `raise` how good a hand has to be before it raises at all and `raiseChance`
   how often it bothers. `callCap` is the largest call it will make as a
   fraction of its own stack, which is what stops a station calling off 100
   big blinds with a nine. `priceDefend` is the level 3 trait: a threshold it
   widens to when the call is cheap against the pot, because folding the small
   blind seventy times in a hundred is a bigger leak than any of the ones it is
   supposed to have. */
interface PreflopProfile {
  play: number;
  playVsRaise: number;
  priceDefend: number;
  raise: number;
  raiseChance: number;
  callCap: number;
}

// A call costing less than this share of the pot is a price worth widening
// for, which only the level that reads prices at all does.
const CHEAP_CALL = 0.4;

const PREFLOP: Record<'station' | 'loose' | 'tight', PreflopProfile> = {
  station: { play: 85, playVsRaise: 75, priceDefend: 85, raise: 2, raiseChance: 0.12, callCap: 0.6 },
  loose: { play: 60, playVsRaise: 42, priceDefend: 60, raise: 8, raiseChance: 0.7, callCap: 0.55 },
  tight: { play: 30, playVsRaise: 16, priceDefend: 60, raise: 8, raiseChance: 0.35, callCap: 0.25 },
};

// The station tier (level 1): bets only a hand that is nearly always best, calls anything that
// is a pair, a draw or two overcards, and folds nothing else unless the bet
// is more than half the pot it is being offered.
const STATION_BET = 0.93;
const STATION_FOLD_POT_FRACTION = 0.5;

// The loose tier (level 2): calls on hand strength alone rather than on the price, bets only
// the hands it is sure of (a medium hand gets checked back, which is where
// most of the value it never collects goes) and fires the occasional bet with
// nothing.
const LOOSE_CALL = 0.12;
const LOOSE_BLUFF_CHANCE = 0.12;

// The tight tier (level 3): has the hand but not the nerve. These are how often it bets a
// strong or a medium hand when checked to, and how often it raises a strong
// one rather than just calling.
const TIGHT_BET_STRONG = 0.9;
const TIGHT_BET_MEDIUM = 0.4;
const TIGHT_RAISE_STRONG = 0.35;

/* The sharp tier (level 5). Sizing runs from SHARP_DRY of the pot on a dry board to SHARP_WET
   on a wet one, since a bet on a board nobody can have hit needs to ask for
   less, and a value bet is sized up again on top of that. The river value
   threshold is thinner than level 4's STRONG, the continuation bet fires on
   the flop when the bot was the preflop aggressor, and a strong draw is worth
   both a semi-bluff in position and the extra equity it is owed when calling.

   The bluffing frequencies are deliberately low. Every level below this one
   calls a bet down to a quarter of the pot in equity, so against the field it
   actually plays, folding equity is scarce and the money is in value: a sharp
   player bluffs a calling station less, not more. */
const SHARP_DRY = 0.5;
const SHARP_WET = 0.85;
const SHARP_VALUE_EXTRA = 0.2; // added to the pot fraction once the hand is a clear favourite
const SHARP_RIVER_VALUE = 0.7;
const SHARP_CBET_CHANCE = 0.3;
const SHARP_SEMI_BLUFF_CHANCE = 0.4;
const SHARP_THREE_BET_BLUFF = 0.12;
const DRAW_EQUITY = 0.18;
// Level 4 treats the strength it has right now as its equity, which overcalls
// on the flop and the turn: there are streets left to pay for. Level 5 wants
// that much more than the price before it calls without a draw.
const SHARP_CALL_MARGIN = 0.15;
// Sizing jitter, as a fraction of the bet: the same spot twice is not the
// same number twice.
const SIZE_JITTER = 0.12;

const RANK_VALUES = new Map<string, number>([...RANKS].map((r, i) => [r, i]));

function rankOf(card: Card): number {
  return RANK_VALUES.get(card[0]) ?? -1;
}

function suitOf(card: Card): string {
  return card[1];
}

/* What the bot's two cards are doing on this board, in the terms the looser
   levels reason in ("any pair, any draw, two overcards") and the sharp level
   sizes by. `wetness` is a board property only: how many ways someone could
   have hit it, 0 on a rainbow of unconnected ranks and 1 on a three-flush
   with a straight in it. */
interface Texture {
  madePair: boolean;
  flushDraw: boolean;
  openEnder: boolean;
  overcards: boolean;
  wetness: number;
}

function boardWetness(board: Card[]): number {
  if (board.length === 0) return 0;
  const suits = new Map<string, number>();
  for (const c of board) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1);
  const maxSuit = Math.max(...suits.values());
  const ranks = [...new Set(board.map(rankOf))].sort((a, b) => a - b);

  let w = 0;
  if (maxSuit >= 3) w += 0.5;
  else if (maxSuit === 2) w += 0.25;

  let closest = 99;
  for (let i = 1; i < ranks.length; i++) closest = Math.min(closest, ranks[i] - ranks[i - 1]);
  if (closest <= 1) w += 0.3;
  else if (closest <= 2) w += 0.15;

  if (ranks.length < board.length) w -= 0.15; // a paired board is fewer draws, not more
  return clamp(w, 0, 1);
}

function readTexture(hole: [Card, Card], board: Card[]): Texture {
  const holeRanks = [rankOf(hole[0]), rankOf(hole[1])];
  const boardRanks = board.map(rankOf);
  const madePair = holeRanks[0] === holeRanks[1] || holeRanks.some((r) => boardRanks.includes(r));
  const top = boardRanks.length > 0 ? Math.max(...boardRanks) : -1;
  const overcards = holeRanks.every((r) => r > top);

  const suits = new Map<string, number>();
  for (const c of [...hole, ...board]) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1);
  const flushDraw =
    board.length < 5 && [...suits.entries()].some(([s, n]) => n === 4 && hole.some((c) => suitOf(c) === s));

  const present = new Set([...holeRanks, ...boardRanks]);
  const has = (r: number) => present.has(r);
  let made = false;
  for (let lo = 0; lo + 4 <= 12; lo++) if ([0, 1, 2, 3, 4].every((k) => has(lo + k))) made = true;
  let openEnder = false;
  // Open-ended means four in a row with room to extend at both ends, using at
  // least one of the bot's own cards. A run against either edge (A K Q J) has
  // only one card that finishes it, so it does not count.
  for (let lo = 1; lo + 3 <= 11; lo++) {
    const run = [lo, lo + 1, lo + 2, lo + 3];
    if (run.every(has) && holeRanks.some((r) => run.includes(r))) openEnder = true;
  }
  if (made || board.length === 5) openEnder = false;

  return { madePair, flushDraw, openEnder, overcards, wetness: boardWetness(board) };
}

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
/* Memoised because a bot is asked more than once on the same street (a bet,
   then the raise that comes back at it) and the answer cannot have changed:
   same cards, same number. The cap is a bound on a process that never
   restarts, not a tuned size; when it is hit the whole map goes rather than
   evicting one entry, since nothing here is worth an LRU. */
const STRENGTH_CACHE_MAX = 20_000;
const strengthCache = new Map<string, number>();

export function handStrength(hole: [Card, Card], board: Card[]): number {
  const key = [...hole].sort().join('') + '|' + board.join('');
  const cached = strengthCache.get(key);
  if (cached !== undefined) return cached;
  const value = computeHandStrength(hole, board);
  if (strengthCache.size >= STRENGTH_CACHE_MAX) strengthCache.clear();
  strengthCache.set(key, value);
  return value;
}

function computeHandStrength(hole: [Card, Card], board: Card[]): number {
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
  persona: Persona;
}

// The one chokepoint every bet and raise in this file passes through, which
// is what makes `persona.aggression` a single-line change rather than a
// scaling factor threaded into every call site by hand. At the neutral
// persona (aggression 1) `targetIncrease * 1 === targetIncrease` exactly, so
// this changes nothing for the byte-for-byte level 4 pin.
function aggressive(ctx: Ctx, targetIncrease: number): BotDecision {
  const { legal, currentBet, myTotal } = ctx;
  const scaled = targetIncrease * ctx.persona.aggression;
  const raiseTo = clamp(Math.round(currentBet + scaled), legal.min, legal.max);
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
    if (lateStreet && ctx.rng() < BLUFF_CHANCE * ctx.persona.bluffChance) {
      return aggressive(ctx, Math.max(ctx.bb, Math.round(ctx.pot * 0.5)));
    }
    return { a: 'x' };
  }
  return potOddsOk(ctx, strength) ? passive(ctx) : giveUp(ctx);
}

// A bet of `fraction` of the pot, never smaller than a big blind, blurred a
// little so a level does not size identically in identical spots.
function sized(ctx: Ctx, fraction: number): number {
  const jitter = 1 + (ctx.rng() * 2 - 1) * SIZE_JITTER;
  return Math.max(ctx.bb, Math.round(ctx.pot * fraction * jitter));
}

// Last to act among the seats still in the hand. Preflop heads-up that is the
// big blind, since the button posts the small blind and acts first.
function inPosition(ctx: Ctx): boolean {
  if (ctx.view.street === 'pre' && ctx.inHand.length === 2) return !ctx.me.button;
  return lateness(ctx) > 0.5;
}

/* Levels 1 to 3 preflop: one percentile threshold, one raise threshold and a
   cap on what it will call, rather than the chart read level 4 does. */
function preflopProfile(ctx: Ctx, percentile: number, p: PreflopProfile): BotDecision {
  const raised = ctx.currentBet > ctx.bb;
  const call = ctx.legal.call;

  if (percentile <= p.raise && ctx.rng() < Math.min(1, p.raiseChance * ctx.persona.aggression)) {
    return aggressive(ctx, raised ? 2 * ctx.currentBet : 2 * ctx.bb);
  }
  if (call === 0) {
    if (percentile > p.play) return giveUp(ctx);
    return ctx.legal.actions.includes('x') ? { a: 'x' } : passive(ctx);
  }
  const cheap = call <= CHEAP_CALL * ctx.pot;
  const threshold = Math.max(raised ? p.playVsRaise : p.play, cheap ? p.priceDefend : 0);
  if (percentile > threshold) return giveUp(ctx);
  if (call > p.callCap * ctx.persona.callCap * ctx.myTotal) return giveUp(ctx);
  return passive(ctx);
}

/* Level 5 preflop: level 4's read, plus a 3-bet with a hand that plays well
   when it is called. Only in position, only facing a single raise, only with
   a suited connector or a suited ace, and only sometimes. */
function threeBetBluff(ctx: Ctx): boolean {
  if (ctx.currentBet <= ctx.bb) return false;
  if (ctx.inHand.some((s) => s.i !== ctx.me.i && s.bet > 2 * ctx.bb && s.bet >= ctx.currentBet)) {
    // already a real raise war; a bluff here is just a donation
    if (ctx.currentBet > 4 * ctx.bb) return false;
  }
  if (!inPosition(ctx)) return false;
  if (ctx.legal.call > 0.15 * ctx.myTotal) return false;
  const [a, b] = ctx.hole;
  if (suitOf(a) !== suitOf(b)) return false;
  const ra = rankOf(a);
  const rb = rankOf(b);
  const connector = Math.abs(ra - rb) <= 1 && Math.min(ra, rb) >= 3;
  const suitedAce = Math.max(ra, rb) === 12;
  if (!connector && !suitedAce) return false;
  return ctx.rng() < Math.min(1, SHARP_THREE_BET_BLUFF * ctx.persona.bluffChance);
}

// Level 1: calls with anything that could still be best and never gets out of
// line. It folds only when it has nothing at all and the price is worse than
// half the pot it is being offered.
function postflopStation(ctx: Ctx): BotDecision {
  const strength = handStrength(ctx.hole, ctx.view.board);
  const texture = readTexture(ctx.hole, ctx.view.board);
  const call = ctx.legal.call;

  if (call === 0) {
    if (strength > STATION_BET) return aggressive(ctx, sized(ctx, 0.5));
    return { a: 'x' };
  }
  if (texture.madePair || texture.flushDraw || texture.openEnder || texture.overcards) return passive(ctx);
  const potBefore = Math.max(1, ctx.pot - call);
  if (call > STATION_FOLD_POT_FRACTION * ctx.persona.callCap * potBefore) return giveUp(ctx);
  return passive(ctx);
}

// Level 2: values hands the way level 4 does but calls on strength rather
// than on the price, and bluffs at random rather than at a spot.
function postflopLoose(ctx: Ctx): BotDecision {
  const strength = handStrength(ctx.hole, ctx.view.board);
  const checkedTo = ctx.legal.call === 0;

  if (strength > STRONG) return aggressive(ctx, sized(ctx, 0.66));
  if (checkedTo) {
    if (ctx.rng() < Math.min(1, LOOSE_BLUFF_CHANCE * ctx.persona.bluffChance)) return aggressive(ctx, sized(ctx, 0.5));
    return { a: 'x' };
  }
  return strength >= LOOSE_CALL ? passive(ctx) : giveUp(ctx);
}

// Level 3: the pot odds are right and the hand reading is fine, but it checks
// and calls the hands level 4 bets and raises.
function postflopTightPassive(ctx: Ctx): BotDecision {
  const strength = handStrength(ctx.hole, ctx.view.board);
  const checkedTo = ctx.legal.call === 0;

  if (checkedTo) {
    if (strength > STRONG && ctx.rng() < TIGHT_BET_STRONG) return aggressive(ctx, sized(ctx, 0.5));
    if (strength >= MEDIUM && ctx.rng() < TIGHT_BET_MEDIUM) return aggressive(ctx, sized(ctx, 0.45));
    return { a: 'x' };
  }
  if (strength > STRONG && ctx.rng() < TIGHT_RAISE_STRONG) return aggressive(ctx, sized(ctx, 0.6));
  return potOddsOk(ctx, strength) ? passive(ctx) : giveUp(ctx);
}

/* Level 5. Everything level 4 does, plus the four things it does not: bets
   sized by how wet the board is, a continuation bet on a flop its own preflop
   raise fits, a semi-bluff with a real draw in position, and a river value bet
   with a hand level 4 would only check. */
function postflopSharp(ctx: Ctx): BotDecision {
  const strength = handStrength(ctx.hole, ctx.view.board);
  const texture = readTexture(ctx.hole, ctx.view.board);
  const checkedTo = ctx.legal.call === 0;
  const river = ctx.view.street === 'river';
  const wet = SHARP_DRY + (SHARP_WET - SHARP_DRY) * texture.wetness;
  const valueAt = river ? SHARP_RIVER_VALUE : STRONG;

  if (strength > valueAt) return aggressive(ctx, sized(ctx, wet + (strength > STRONG ? SHARP_VALUE_EXTRA : 0)));

  // Divided rather than multiplied: a bigger callCap means a smaller margin,
  // i.e. a bot that calls more readily needs less extra equity to do it. At
  // the neutral persona (callCap 1) this is exactly SHARP_CALL_MARGIN.
  const margin = river ? 0 : SHARP_CALL_MARGIN / ctx.persona.callCap;
  if (strength >= MEDIUM) {
    if (checkedTo) return aggressive(ctx, sized(ctx, wet * 0.8));
    return potOddsOk(ctx, strength - margin) ? passive(ctx) : giveUp(ctx);
  }

  const drawing = texture.flushDraw || texture.openEnder;
  if (checkedTo) {
    if (drawing && !river && inPosition(ctx) && ctx.rng() < Math.min(1, SHARP_SEMI_BLUFF_CHANCE * ctx.persona.bluffChance)) {
      return aggressive(ctx, sized(ctx, SHARP_DRY));
    }
    // The flop is the one street where the bot's last action is still its
    // preflop one, so this is where "I raised, this board fits my raise" can
    // be read straight off the view.
    const wasAggressor = ctx.me.last !== null && ['b', 'r', 'a'].includes(ctx.me.last.a);
    const boardFits = texture.wetness < 0.5 || texture.overcards || texture.madePair;
    if (ctx.view.street === 'flop' && wasAggressor && boardFits && ctx.rng() < Math.min(1, SHARP_CBET_CHANCE * ctx.persona.bluffChance)) {
      return aggressive(ctx, sized(ctx, SHARP_DRY * 0.8));
    }
    const lateStreet = ctx.view.street === 'turn' || river;
    if (lateStreet && ctx.rng() < Math.min(1, BLUFF_CHANCE * ctx.persona.bluffChance)) return aggressive(ctx, sized(ctx, 0.5));
    return { a: 'x' };
  }

  // A draw is worth more than the showdown value it has right now.
  if (drawing && potOddsOk(ctx, strength + DRAW_EQUITY)) return passive(ctx);
  return potOddsOk(ctx, strength - margin) ? passive(ctx) : giveUp(ctx);
}

export function decide(
  view: TableView,
  rng: Rng = Math.random,
  level: BotLevel = DEFAULT_BOT_LEVEL,
  persona: Persona = NEUTRAL_PERSONA
): BotDecision {
  // The thinking tiers are not in here: they need a clock and state across a
  // hand, so they live in solver.ts and answer asynchronously. What they fall
  // back to when the budget is gone or the spot is multiway is the sharp tier,
  // and saying so here is what stops such a view reaching this function and
  // playing the default tier by accident.
  const mapped = LEVEL_TIER[level] ?? LEVEL_TIER[DEFAULT_BOT_LEVEL];
  const tier: BotTier = mapped === 'regular' || mapped === 'solver' ? 'sharp' : mapped;
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
    persona,
  };

  let decision: BotDecision;
  if (view.street === 'pre') {
    // Divided by looseness rather than multiplied: percentile 0 is the best
    // hand, so a looser bot needs a *smaller* number to read as playable,
    // and dividing by a looseness above 1 does exactly that. At the neutral
    // persona (looseness 1) this is exactly the unadjusted percentile.
    const percentile = clamp(
      (percentileOf(handClass(ctx.hole)) + (rng() * 2 - 1) * JITTER) / persona.looseness,
      0,
      100
    );
    if (tier === 'station' || tier === 'loose' || tier === 'tight') {
      decision = preflopProfile(ctx, percentile, PREFLOP[tier]);
    } else if (tier === 'sharp' && threeBetBluff(ctx)) {
      decision = aggressive(ctx, 2 * ctx.currentBet);
    } else {
      decision = (inHand.length === 2 ? preflopHeadsUp(ctx, percentile) : null) ?? preflopMultiway(ctx, percentile);
    }
  } else if (tier === 'station') {
    decision = postflopStation(ctx);
  } else if (tier === 'loose') {
    decision = postflopLoose(ctx);
  } else if (tier === 'tight') {
    decision = postflopTightPassive(ctx);
  } else if (tier === 'sharp') {
    decision = postflopSharp(ctx);
  } else {
    decision = postflop(ctx);
  }

  return ensureLegal(decision, legal);
}
