/* The opening explorer: what players on this site actually did preflop, by
   hand class. Lichess's opening book for a poker table. For a mode, a
   position and the situation a seat was facing, every one of the 169 hand
   classes carries how often it was raised, called or folded, and how the
   hand went in big blinds.

   Derived from the stored hands, like server/src/insights.ts and for the
   same reason: the betting rules live in @opentable/engine and nowhere else.
   Every hand is replayed from its seed, which is what gives each logged
   action its street, each seat its hole cards and the hand its net result.
   No database, no clock, no Fastify in this file, so the whole derivation is
   unit-testable against synthetic logs.

   The unit of counting is a decision, not a hand. One seat can act preflop
   more than once, so a hand where the button opens and then faces a three-bet
   is counted twice: once under "unopened" and once under "threebet". Within
   one (position, facing) bucket only a seat's first decision is taken, so a
   seat that faces a three-bet and then a four-bet is not counted twice in the
   same bucket. The net big blinds attached to a decision is the whole hand's
   result for that seat: what a player wants to know is how the hand went from
   here, not what this one action was worth.

   The cube holds every (position, facing, hand class) at once and both player
   scopes, because the expensive part is the replay and slicing it afterwards
   is free. Building it once per mode means a route can answer any combination
   of the controls without touching the database again.

   It is also built to be *added to* rather than rebuilt. Every count in it is
   a sum, so folding in the hands that finished since the last read gives the
   same cube a rebuild would have, for the cost of those hands alone. That
   matters because the alternative blocks: a replay is about 0.15ms, so
   rebuilding a five thousand hand book costs the best part of a second of
   event loop, and doing that every time a match finished would stutter every
   live table on the site. */

import { replay, type HandConfig, type HandState } from '@opentable/engine';
import { allHandClasses, handClass } from '@opentable/preflop';
import type { Card, LoggedAction, Mode } from '@opentable/protocol';
import { POSITIONS, positionKey, type PositionKey } from './insights.js';

/* Below this many decisions in a selection the percentages are noise. The
   rows are still returned: the count is the honest answer to "how much is
   there", and the client says so rather than colouring in a grid built on
   nine hands. */
export const MIN_EXPLORER_HANDS = 50;

/* What a seat was facing when it acted, counted in raises already made this
   street. Nobody has raised yet, one raise stands (the open), or two or more
   do (the three-bet and everything above it). Three buckets rather than six
   because a four-bet spot on this site is a handful of hands a month, and a
   bucket nobody lands in is a control that never does anything. */
export type Facing = 'unopened' | 'open' | 'threebet';
export const FACINGS: Facing[] = ['unopened', 'open', 'threebet'];

/* Bots outnumber people while the site is young, so every number is kept
   twice and the reader chooses which population they are looking at. */
export type PlayersFilter = 'all' | 'humans';
export const PLAYER_FILTERS: PlayersFilter[] = ['all', 'humans'];

/* A check is a call: both are the passive answer to the question the spot
   asked, and @opentable/preflop's own categoryOf reads them the same way. */
export type ExplorerAction = 'raise' | 'call' | 'fold';

/* One completed hand as the explorer needs it. Seats, actions and stacks are
   TABLE seats, the way they are stored; `liveSeats` maps them onto the engine
   seats the replay speaks. */
export interface ExplorerHand {
  matchId: string;
  button: number;
  sb: number;
  bb: number;
  seed: string;
  stacksStart: number[];
  liveSeats: number[];
  actions: LoggedAction[];
  /* Per table seat, whether a bot sat in it. A seat with no entry is read as
     a person, which is the safe way round: it puts an unknown seat in both
     populations rather than quietly deleting it from the human one. */
  bots: boolean[];
  finishedAt: Date | null;
}

export interface ExplorerInput {
  mode: Mode;
  hands: ExplorerHand[];
}

interface Tally {
  hands: number;
  raise: number;
  call: number;
  fold: number;
  netBb: number;
}

interface Scoped {
  all: Tally;
  humans: Tally;
}

interface Corpus {
  matches: Set<string>;
  since: Date | null;
}

/* Everything derived from one mode's hands, before any control has been
   read. `cells` is keyed `position|facing|handClass`; a key that never came
   up is simply absent. */
export interface ExplorerCube {
  mode: Mode;
  cells: Map<string, Scoped>;
  corpus: { all: Corpus; humans: Corpus };
}

export interface ExplorerQuery {
  position: PositionKey;
  facing: Facing;
  players: PlayersFilter;
}

export interface ExplorerRates {
  hands: number;
  raise: number | null;
  call: number | null;
  fold: number | null;
  netBb: number | null;
}

export interface ExplorerRow extends ExplorerRates {
  hand: string;
}

export interface ExplorerView extends ExplorerQuery {
  mode: Mode;
  minHands: number;
  /* `hands` is this selection's decisions; `matches` is every finished match
     the cube was built from in this player scope, which is what the "since"
     date belongs to. They answer different questions and are not a ratio. */
  sample: { hands: number; matches: number };
  since: string | null;
  totals: ExplorerRates;
  hands: ExplorerRow[];
}

function emptyTally(): Tally {
  return { hands: 0, raise: 0, call: 0, fold: 0, netBb: 0 };
}

function emptyCorpus(): Corpus {
  return { matches: new Set(), since: null };
}

export function cellKey(position: PositionKey, facing: Facing, hand: string): string {
  return `${position}|${facing}|${hand}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return round1((part / whole) * 100);
}

/* An all-in is logged as 'a' whether it raised or only called, so the letter
   alone cannot say which. The state it was taken at can: an all-in that
   cannot reach the current bet is a call. The same reading insights.ts makes,
   and for the same reason. */
function actionAt(state: HandState, action: LoggedAction): ExplorerAction {
  if (action.a === 'f') return 'fold';
  if (action.a === 'b' || action.a === 'r') return 'raise';
  if (action.a === 'c' || action.a === 'x') return 'call';
  const seat = state.seats[action.s];
  return seat !== undefined && seat.bet + seat.stack > state.currentBet ? 'raise' : 'call';
}

function facingFor(raises: number): Facing {
  if (raises === 0) return 'unopened';
  if (raises === 1) return 'open';
  return 'threebet';
}

function add(tally: Tally, action: ExplorerAction, netBb: number): void {
  tally.hands += 1;
  tally[action] += 1;
  tally.netBb += netBb;
}

/* One hand folded into the cube. Returns false when the row cannot be
   replayed, which the caller treats as a hand that was never here rather
   than as a hand with nothing in it. */
function foldHand(cube: ExplorerCube, hand: ExplorerHand): boolean {
  const live = hand.liveSeats;
  const button = live.indexOf(hand.button);
  if (button === -1) return false;

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
  if (hand.bb <= 0) return false;

  /* Hole cards come off the opening state rather than the stored `holes`
     column: a fold never clears them, so the deal the seed produced is the
     one thing every seat's class is read from. */
  const dealt = states[0].seats;

  const netBb: number[] = final.seats.map(
    (seat, engineSeat) => (seat.stack - config.seats[engineSeat].stack) / hand.bb
  );

  const seen = new Set<string>();
  let raises = 0;

  for (let i = 0; i < actions.length; i++) {
    const state = states[i];
    if (state.street !== 'pre') break;

    const action = actions[i];
    const kind = actionAt(state, action);
    const engineSeat = action.s;
    const cards = dealt[engineSeat]?.cards;
    if (cards) {
      const position = positionKey((engineSeat - button + live.length) % live.length, live.length);
      const facing = facingFor(raises);
      const bucket = `${engineSeat}|${facing}`;
      if (!seen.has(bucket)) {
        seen.add(bucket);
        const tableSeat = live[engineSeat];
        const human = hand.bots[tableSeat] !== true;
        const key = cellKey(position, facing, handClass(cards as [Card, Card]));
        let cell = cube.cells.get(key);
        if (!cell) {
          cell = { all: emptyTally(), humans: emptyTally() };
          cube.cells.set(key, cell);
        }
        add(cell.all, kind, netBb[engineSeat]);
        if (human) add(cell.humans, kind, netBb[engineSeat]);
      }
    }

    if (kind === 'raise') raises += 1;
  }

  note(cube.corpus.all, hand);
  if (hand.bots.some((bot) => bot !== true)) note(cube.corpus.humans, hand);
  return true;
}

function note(corpus: Corpus, hand: ExplorerHand): void {
  corpus.matches.add(hand.matchId);
  const at = hand.finishedAt;
  if (at && (corpus.since === null || at < corpus.since)) corpus.since = at;
}

export function emptyExplorerCube(mode: Mode): ExplorerCube {
  return { mode, cells: new Map(), corpus: { all: emptyCorpus(), humans: emptyCorpus() } };
}

/* Adds hands to a cube in place and returns how many of them counted. Order
   does not matter and neither does how the hands are split across calls: the
   same set of hands always produces the same cube. */
export function foldExplorerHands(cube: ExplorerCube, hands: ExplorerHand[]): number {
  let counted = 0;
  for (const hand of hands) if (foldHand(cube, hand)) counted += 1;
  return counted;
}

export function computeExplorer(input: ExplorerInput): ExplorerCube {
  const cube = emptyExplorerCube(input.mode);
  foldExplorerHands(cube, input.hands);
  return cube;
}

function rates(tally: Tally): ExplorerRates {
  return {
    hands: tally.hands,
    raise: pct(tally.raise, tally.hands),
    call: pct(tally.call, tally.hands),
    fold: pct(tally.fold, tally.hands),
    netBb: tally.hands > 0 ? round2(tally.netBb / tally.hands) : null,
  };
}

/* One reading of the cube: the controls the page carries, turned into 169
   rows and their total. Every class is returned, including the ones nobody
   was dealt here, so the grid is a fixed shape and an absent hand reads as
   zero rather than as a hole. */
export function sliceExplorer(cube: ExplorerCube, query: ExplorerQuery): ExplorerView {
  const total = emptyTally();
  const rows: ExplorerRow[] = [];

  for (const hand of allHandClasses()) {
    const cell = cube.cells.get(cellKey(query.position, query.facing, hand));
    const tally = cell ? cell[query.players] : emptyTally();
    total.hands += tally.hands;
    total.raise += tally.raise;
    total.call += tally.call;
    total.fold += tally.fold;
    total.netBb += tally.netBb;
    rows.push({ hand, ...rates(tally) });
  }

  const corpus = cube.corpus[query.players];
  return {
    ...query,
    mode: cube.mode,
    minHands: MIN_EXPLORER_HANDS,
    sample: { hands: total.hands, matches: corpus.matches.size },
    since: corpus.since ? corpus.since.toISOString() : null,
    totals: rates(total),
    hands: rows,
  };
}

/* The controls, read off a query string. Anything unrecognised falls back to
   the first option rather than erroring, the same bargain /api/leaderboard
   makes with its mode. A position that belongs to the other mode is not a
   position here, so it falls back too. */
export function explorerQuery(mode: Mode, raw: { position?: string; facing?: string; players?: string }): ExplorerQuery {
  const positions = POSITIONS[mode];
  const position = positions.includes(raw.position as PositionKey)
    ? (raw.position as PositionKey)
    : positions[0];
  return {
    position,
    facing: FACINGS.includes(raw.facing as Facing) ? (raw.facing as Facing) : 'unopened',
    players: PLAYER_FILTERS.includes(raw.players as PlayersFilter) ? (raw.players as PlayersFilter) : 'all',
  };
}
