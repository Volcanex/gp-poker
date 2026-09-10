/* Player insights: the Lichess-style read of how somebody actually plays,
   derived from their stored hands rather than from a counter kept at write
   time. Nothing here touches the database or a clock, so the whole thing is
   unit-testable against synthetic logs; server/src/db.ts fetches the rows and
   routes.ts caches the answer.

   Every hand is replayed through @opentable/engine rather than re-deriving
   the betting rules here. That is what gives each logged action its street,
   each seat its total commitment and the hand its outcome, and it means a
   change to the rules can never leave this file computing yesterday's poker.
   The stored log is in TABLE seats and the engine speaks ENGINE seats, so
   `liveSeats` is applied on the way in, exactly as handRunner applies it on
   the way out.

   Below MIN_INSIGHT_HANDS the numbers are noise, so every derived group is
   null and only `sample` is filled in. A group that is present can still
   carry a null field: a rate with no denominator (no chance to continuation
   bet, no calls to divide by) is not zero, and printing zero would be a
   claim nobody made. */

import { replay, type HandConfig, type HandState } from '@opentable/engine';
import type { LoggedAction, Mode } from '@opentable/protocol';

export const MIN_INSIGHT_HANDS = 20;

export type PositionKey = 'button' | 'small-blind' | 'big-blind' | 'utg' | 'hijack' | 'cutoff';

/* The positions a mode can produce, in seating order from the button. Six-max
   tables shrink as players bust, so a short-handed hand still lands in one of
   these; the list is the mode's full set, not the set that happened to occur.
   Heads-up has two seats and the button is the small blind, so it has no
   small blind of its own. */
export const POSITIONS: Record<Mode, PositionKey[]> = {
  'heads-up': ['button', 'big-blind'],
  'six-max': ['button', 'small-blind', 'big-blind', 'utg', 'hijack', 'cutoff'],
};

/* Offset is seats clockwise from the button. The three blind-adjacent seats
   are named from the button forwards and the rest from the end backwards, so
   the seat that acts last before the blinds is the cutoff whether five or six
   players are still in. Anything earlier than the hijack is under the gun. */
export function positionKey(offset: number, live: number): PositionKey {
  if (live <= 2) return offset === 0 ? 'button' : 'big-blind';
  if (offset === 0) return 'button';
  if (offset === 1) return 'small-blind';
  if (offset === 2) return 'big-blind';
  const fromEnd = live - 1 - offset;
  if (fromEnd === 0) return 'cutoff';
  if (fromEnd === 1) return 'hijack';
  return 'utg';
}

/* One completed hand, as insights need it: the hand row plus the seat the
   player sat in for that match and the blind level the hand was dealt at.
   Seats, actions and stacks are all TABLE seats, the way they are stored. */
export interface InsightHand {
  id: string;
  matchId: string;
  number: number;
  seat: number;
  seed: string;
  button: number;
  sb: number;
  bb: number;
  stacksStart: number[];
  liveSeats: number[];
  actions: LoggedAction[];
  startedAt: Date;
  completedAt: Date | null;
}

export interface InsightMatch {
  id: string;
  result: 'win' | 'loss' | 'draw';
  finishedAt: Date | null;
}

export interface InsightsInput {
  mode: Mode;
  hands: InsightHand[];
  matches: InsightMatch[];
}

export interface PreflopInsights {
  vpip: number | null;
  pfr: number | null;
  threeBet: number | null;
  foldToThreeBet: number | null;
}

export interface PostflopInsights {
  aggressionFactor: number | null;
  cbet: number | null;
  wentToShowdown: number | null;
  wonAtShowdown: number | null;
  wonWithoutShowdown: number | null;
}

export interface PositionInsight {
  key: PositionKey;
  hands: number;
  bbPerHand: number | null;
}

export interface StreetInsights {
  preflop: number;
  flop: number;
  turn: number;
  river: number;
  showdown: number;
}

export interface BiggestPot {
  chips: number;
  bb: number;
  handId: string;
  matchId: string;
  handNumber: number;
}

export interface ResultInsights {
  biggestPot: BiggestPot | null;
  longestWinStreak: number;
  averageHandMs: number | null;
  timeouts: number;
}

export interface Insights {
  mode: Mode;
  minHands: number;
  sample: { hands: number; matches: number };
  preflop: PreflopInsights | null;
  postflop: PostflopInsights | null;
  positions: PositionInsight[] | null;
  streets: StreetInsights | null;
  results: ResultInsights | null;
}

type StreetBucket = keyof StreetInsights;

interface Totals {
  hands: number;
  vpipHands: number;
  pfrHands: number;
  threeBetSpots: number;
  threeBets: number;
  facedThreeBet: number;
  foldedToThreeBet: number;
  postflopAggressive: number;
  postflopCalls: number;
  cbetSpots: number;
  cbets: number;
  sawFlop: number;
  showdowns: number;
  showdownsWon: number;
  handsWon: number;
  handsWonWithoutShowdown: number;
  streets: Record<StreetBucket, number>;
  positions: Map<PositionKey, { hands: number; netBb: number }>;
  timeouts: number;
  durationMs: number;
  timedHands: number;
  biggestPot: BiggestPot | null;
}

function emptyTotals(): Totals {
  return {
    hands: 0,
    vpipHands: 0,
    pfrHands: 0,
    threeBetSpots: 0,
    threeBets: 0,
    facedThreeBet: 0,
    foldedToThreeBet: 0,
    postflopAggressive: 0,
    postflopCalls: 0,
    cbetSpots: 0,
    cbets: 0,
    sawFlop: 0,
    showdowns: 0,
    showdownsWon: 0,
    handsWon: 0,
    handsWonWithoutShowdown: 0,
    streets: { preflop: 0, flop: 0, turn: 0, river: 0, showdown: 0 },
    positions: new Map(),
    timeouts: 0,
    durationMs: 0,
    timedHands: 0,
    biggestPot: null,
  };
}

/* An all-in is logged as 'a' whether it raised or only called, so the action
   letter alone cannot say which it was. The state the action was taken at
   can: an all-in that cannot reach the current bet is a call. @opentable/
   preflop's handStats counts every 'a' as aggression, which is fine for the
   frequency it feeds; an aggression factor divides by calls, so it has to
   tell the two apart or a player who ran out of chips reads as a maniac. */
function isAggressive(state: HandState, action: LoggedAction): boolean {
  if (action.a === 'b' || action.a === 'r') return true;
  if (action.a !== 'a') return false;
  const seat = state.seats[action.s];
  return seat !== undefined && seat.bet + seat.stack > state.currentBet;
}

function isCall(state: HandState, action: LoggedAction): boolean {
  if (action.a === 'c') return true;
  if (action.a !== 'a') return false;
  const seat = state.seats[action.s];
  return seat !== undefined && seat.bet + seat.stack <= state.currentBet;
}

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return round1((part / whole) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* One hand folded into the running totals. Returns false when the row cannot
   be replayed (a log that no longer reconstructs, a seat that was already
   out), which the caller counts as a hand this player was not in rather than
   as a hand with nothing in it. */
function foldHand(totals: Totals, hand: InsightHand): boolean {
  const live = hand.liveSeats;
  const me = live.indexOf(hand.seat);
  const button = live.indexOf(hand.button);
  if (me === -1 || button === -1) return false;

  const config: HandConfig = {
    seats: live.map((tableSeat) => ({ id: String(tableSeat), stack: hand.stacksStart[tableSeat] ?? 0 })),
    button,
    sb: hand.sb,
    bb: hand.bb,
    seed: hand.seed,
  };

  const actions: LoggedAction[] = [];
  for (const a of hand.actions) {
    const seat = live.indexOf(a.s);
    if (seat === -1) return false;
    actions.push({ ...a, s: seat });
  }

  let states: HandState[];
  try {
    states = replay(config, actions);
  } catch {
    return false;
  }
  const final = states[states.length - 1];
  if (final.street !== 'done' || final.result === null) return false;

  totals.hands += 1;

  let raiseCount = 0;
  let lastPreflopAggressor: number | null = null;
  let foldedPreflop = false;
  let vpip = false;
  let pfr = false;
  let firstFlopAction = -1;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const state = states[i];
    const mine = action.s === me;
    const aggressive = isAggressive(state, action);

    if (mine && action.to === true) totals.timeouts += 1;

    if (state.street === 'pre') {
      if (mine) {
        if (action.a === 'f') foldedPreflop = true;
        if (aggressive) {
          vpip = true;
          pfr = true;
        } else if (isCall(state, action)) {
          vpip = true;
        }
        // raiseCount is raises seen so far, the same counter
        // @opentable/preflop walks with: one raise in front of you is the
        // open, so raising over it is the three-bet, and two raises in front
        // means you are the one facing one.
        if (raiseCount === 1) {
          totals.threeBetSpots += 1;
          if (aggressive) totals.threeBets += 1;
        }
        if (raiseCount === 2) {
          totals.facedThreeBet += 1;
          if (action.a === 'f') totals.foldedToThreeBet += 1;
        }
      }
      if (aggressive) {
        raiseCount += 1;
        lastPreflopAggressor = action.s;
      }
      continue;
    }

    if (state.street === 'flop' || state.street === 'turn' || state.street === 'river') {
      if (mine) {
        if (aggressive) totals.postflopAggressive += 1;
        else if (isCall(state, action)) totals.postflopCalls += 1;
        if (state.street === 'flop' && firstFlopAction === -1) firstFlopAction = i;
      }
    }
  }

  if (vpip) totals.vpipHands += 1;
  if (pfr) totals.pfrHands += 1;

  /* A continuation bet is only measurable where the chance to make one
     existed: this player took the last raise preflop, the flop came, and
     they were asked to act on it with nobody betting in front. Anything else
     is not a missed c-bet, it is a hand that never posed the question. */
  if (lastPreflopAggressor === me && firstFlopAction !== -1) {
    const at = states[firstFlopAction];
    const seat = at.seats[me];
    if (seat && at.currentBet === seat.bet) {
      totals.cbetSpots += 1;
      const action = actions[firstFlopAction];
      if (isAggressive(at, action)) totals.cbets += 1;
    }
  }

  const shown = Object.keys(final.result.shown).length > 0;
  const wentToShowdown = final.result.shown[me] !== undefined;
  const reachedFlop = final.board.length >= 3;
  if (reachedFlop && !foldedPreflop) totals.sawFlop += 1;

  const awarded = final.result.awards
    .filter((a) => a.seat === me)
    .reduce((sum, a) => sum + a.amount, 0);
  const net = final.seats[me].stack - config.seats[me].stack;
  const won = net > 0;
  if (won) totals.handsWon += 1;
  if (wentToShowdown) {
    totals.showdowns += 1;
    if (won) totals.showdownsWon += 1;
  } else if (won) {
    totals.handsWonWithoutShowdown += 1;
  }

  const bucket: StreetBucket = shown
    ? 'showdown'
    : final.board.length >= 5
      ? 'river'
      : final.board.length >= 4
        ? 'turn'
        : final.board.length >= 3
          ? 'flop'
          : 'preflop';
  totals.streets[bucket] += 1;

  const key = positionKey((me - button + live.length) % live.length, live.length);
  const seen = totals.positions.get(key) ?? { hands: 0, netBb: 0 };
  seen.hands += 1;
  seen.netBb += hand.bb > 0 ? net / hand.bb : 0;
  totals.positions.set(key, seen);

  if (awarded > 0 && (totals.biggestPot === null || awarded > totals.biggestPot.chips)) {
    totals.biggestPot = {
      chips: awarded,
      bb: hand.bb > 0 ? round1(awarded / hand.bb) : 0,
      handId: hand.id,
      matchId: hand.matchId,
      handNumber: hand.number,
    };
  }

  if (hand.completedAt) {
    const ms = hand.completedAt.getTime() - hand.startedAt.getTime();
    if (ms >= 0) {
      totals.durationMs += ms;
      totals.timedHands += 1;
    }
  }

  return true;
}

/* Consecutive wins, longest run anywhere in the history. A draw breaks a
   streak the way a loss does: it is not a win. */
export function longestWinStreak(matches: InsightMatch[]): number {
  const order = [...matches].sort((a, b) => time(a.finishedAt) - time(b.finishedAt));
  let best = 0;
  let run = 0;
  for (const m of order) {
    run = m.result === 'win' ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

function time(at: Date | null): number {
  return at ? at.getTime() : 0;
}

export interface RawRate {
  made: number;
  of: number;
  pct: number | null;
}

export interface RawRates {
  hands: number;
  vpip: RawRate;
  pfr: RawRate;
  threeBet: RawRate;
  // 'made' is aggressive postflop actions, 'of' is postflop calls: the same
  // pair aggressionFactor divides, printable as a count either side of a
  // divide-by-zero.
  aggressionFactor: RawRate;
  cbet: RawRate;
  wentToShowdown: RawRate;
}

/* The same fold computeInsights runs, with MIN_INSIGHT_HANDS never applied
   and every rate printed as a count either side of a divide, not a rounded
   percentage. A single finished match rarely reaches twenty hands for one
   seat, so computeInsights is right to say nothing there — that gate is
   about a number being read as a stable tendency, which is not what a match
   review is for. This is for "what actually happened at this table", which a
   count backs at any sample size. The other half of the honesty rule still
   holds: a rate with no denominator is null here too, never a guessed zero. */
export function computeRawRates(input: InsightsInput): RawRates {
  const totals = emptyTotals();
  for (const hand of input.hands) foldHand(totals, hand);
  const rate = (made: number, of: number): RawRate => ({ made, of, pct: pct(made, of) });
  return {
    hands: totals.hands,
    vpip: rate(totals.vpipHands, totals.hands),
    pfr: rate(totals.pfrHands, totals.hands),
    threeBet: rate(totals.threeBets, totals.threeBetSpots),
    aggressionFactor: rate(totals.postflopAggressive, totals.postflopCalls),
    cbet: rate(totals.cbets, totals.cbetSpots),
    wentToShowdown: rate(totals.showdowns, totals.sawFlop),
  };
}

export function computeInsights(input: InsightsInput): Insights {
  const totals = emptyTotals();
  for (const hand of input.hands) foldHand(totals, hand);

  const sample = { hands: totals.hands, matches: input.matches.length };
  const base: Insights = {
    mode: input.mode,
    minHands: MIN_INSIGHT_HANDS,
    sample,
    preflop: null,
    postflop: null,
    positions: null,
    streets: null,
    results: null,
  };
  if (totals.hands < MIN_INSIGHT_HANDS) return base;

  return {
    ...base,
    preflop: {
      vpip: pct(totals.vpipHands, totals.hands),
      pfr: pct(totals.pfrHands, totals.hands),
      threeBet: pct(totals.threeBets, totals.threeBetSpots),
      foldToThreeBet: pct(totals.foldedToThreeBet, totals.facedThreeBet),
    },
    postflop: {
      // Bets and raises per call. With no calls at all there is nothing to
      // divide by, and "infinitely aggressive" is not a number to print.
      aggressionFactor:
        totals.postflopCalls > 0 ? round2(totals.postflopAggressive / totals.postflopCalls) : null,
      cbet: pct(totals.cbets, totals.cbetSpots),
      wentToShowdown: pct(totals.showdowns, totals.sawFlop),
      wonAtShowdown: pct(totals.showdownsWon, totals.showdowns),
      wonWithoutShowdown: pct(totals.handsWonWithoutShowdown, totals.handsWon),
    },
    positions: POSITIONS[input.mode].map((key) => {
      const seen = totals.positions.get(key);
      return {
        key,
        hands: seen?.hands ?? 0,
        bbPerHand: seen && seen.hands > 0 ? round2(seen.netBb / seen.hands) : null,
      };
    }),
    streets: {
      preflop: pct(totals.streets.preflop, totals.hands) ?? 0,
      flop: pct(totals.streets.flop, totals.hands) ?? 0,
      turn: pct(totals.streets.turn, totals.hands) ?? 0,
      river: pct(totals.streets.river, totals.hands) ?? 0,
      showdown: pct(totals.streets.showdown, totals.hands) ?? 0,
    },
    results: {
      biggestPot: totals.biggestPot,
      longestWinStreak: longestWinStreak(input.matches),
      averageHandMs: totals.timedHands > 0 ? Math.round(totals.durationMs / totals.timedHands) : null,
      timeouts: totals.timeouts,
    },
  };
}
