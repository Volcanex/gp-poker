/* The pure half of the replay's analysis panel: which hands are known at a
   step, what a call cost the player who made it, and the questions the worker
   has to be asked to fill a street strip in.

   Nothing here evaluates a card. It builds the asks and reads the log; the
   equity, the hand names and the outs all come back from the worker, keyed by
   the strings this module writes. Keeping the keys here is what lets one
   answer serve the panel, the price beside an action and the strip at once:
   the same seat, board and field of opponents is the same question however it
   came to be asked. */

import type { HandState } from '@opentable/engine';
import type { LoggedAction, Street } from '@opentable/protocol';
import type { Card, Villain } from './index.ts';

export type Hole = [Card, Card];

export interface KnownInput {
  /* Every holding in the hand, published when it ended. Null while it is still
     being played, which is the case where nothing can be known. */
  holes: Record<number, Hole> | null;
  seats: number[]; // table seats dealt in
  revealed: number[]; // table seats the engine shows at this step
  mine: number | null; // the viewer's own seat, if they played this hand
  showAll: boolean;
}

/* What a viewer may be told at this step. A hand nobody showed is nobody's to
   analyse, so by default the panel knows what the felt knows: your own cards
   if you were in the hand, and everybody's once the hand reached a showdown.
   "Show all cards" is the viewer saying they want the rest, and the panel
   follows it rather than keeping a second, quieter rule of its own. */
export function knownHoles(input: KnownInput): Map<number, Hole> {
  const out = new Map<number, Hole>();
  if (!input.holes) return out;
  for (const seat of input.seats) {
    const hole = input.holes[seat];
    if (!hole) continue;
    if (input.showAll || seat === input.mine || input.revealed.includes(seat)) out.set(seat, hole);
  }
  return out;
}

/* The seats the engine is showing at this step, in table seats. Only a
   showdown reveals anything: before that the result is null. */
export function revealedSeats(state: HandState, seatMap: number[]): number[] {
  const shown = state.result?.shown;
  if (!shown) return [];
  return Object.keys(shown)
    .map(Number)
    .filter((i) => state.seats[i] != null)
    .map((i) => seatMap[i] ?? i);
}

/* Everyone still in the hand at this step, in table seats. All in counts: the
   chips are in and the cards are live. */
export function contestingSeats(state: HandState, seatMap: number[]): number[] {
  const out: number[] = [];
  state.seats.forEach((s, i) => {
    if (!s.folded) out.push(seatMap[i] ?? i);
  });
  return out;
}

export interface Price {
  toCall: number; // what this seat had to put in
  pot: number; // what was out there before they did, the bet they face included
  needed: number; // the share of the final pot the call has to win to break even
}

/* The price a call or a raise was paid at, read off the state the action was
   made in. The pot is every chip committed so far, which is what the felt
   shows, and the call is capped by the stack behind: calling all in for less
   than the bet is a cheaper price than the bet asked for.

   A bet or a check faces nothing, and a fold pays nothing, so neither has a
   price to quote. */
export function priceAt(before: HandState, action: LoggedAction, seatMap: number[]): Price | null {
  if (action.a !== 'c' && action.a !== 'r' && action.a !== 'a') return null;
  const engineSeat = seatMap.indexOf(action.s);
  const seat = before.seats[engineSeat];
  if (!seat) return null;
  const toCall = Math.min(Math.max(0, before.currentBet - seat.bet), seat.stack);
  if (toCall <= 0) return null;
  const pot = before.seats.reduce((sum, s) => sum + s.committed, 0);
  return { toCall, pot, needed: toCall / (pot + toCall) };
}

export interface EquityAsk {
  key: string;
  seat: number;
  hero: Hole;
  board: Card[];
  villains: Villain[];
}

/* One question for the worker. The other known hands go in as themselves and
   the rest as random hands, which is the honest shape of what a replay knows:
   a seat that folded before a showdown never showed, so it is a cloud even
   when everyone else is a pair of cards.

   The key is order independent because the answer is: a field of opponents is
   a set, not a list, and two seats asking about the same board and the same
   field are asking the same question. */
export function askFor(
  seat: number,
  board: Card[],
  live: number[],
  known: Map<number, Hole>,
): EquityAsk | null {
  const hero = known.get(seat);
  if (!hero || !live.includes(seat)) return null;
  const villains: Villain[] = [];
  const parts: string[] = [];
  for (const other of live) {
    if (other === seat) continue;
    const hole = known.get(other);
    if (hole) {
      villains.push([hole[0], hole[1]]);
      parts.push(`${hole[0]}${hole[1]}`);
    } else {
      villains.push('random');
      parts.push('??');
    }
  }
  /* Everybody else folded: there is no equity question left, only a pot. */
  if (villains.length === 0) return null;
  const key = `${hero.join('')}/${board.join('')}/${[...parts].sort().join(',')}`;
  return { key, seat, hero, board, villains };
}

export interface StreetPoint {
  street: Street;
  step: number; // the state index this street opened at
  board: Card[];
  live: number[]; // table seats still in the hand when it opened
}

/* The first state of each street the hand reached, which is the moment the new
   card is down and before anyone has acted on it. Four points at most, and a
   hand that ends on the flop has two. */
export function streetPoints(states: HandState[], seatMap: number[]): StreetPoint[] {
  const wanted: Street[] = ['pre', 'flop', 'turn', 'river'];
  const out: StreetPoint[] = [];
  for (const street of wanted) {
    const step = states.findIndex((s) => s.street === street);
    if (step < 0) continue;
    const state = states[step];
    out.push({ street, step, board: [...state.board], live: contestingSeats(state, seatMap) });
  }
  return out;
}

export interface StreetCell {
  street: Street;
  ask: EquityAsk | null;
}

export interface StreetRow {
  seat: number;
  hero: Hole;
  cells: StreetCell[];
}

/* The strip: one row per known seat, one cell per street that seat was still
   in the hand for. A seat that folded preflop has one cell, and a cell whose
   ask is null is a street the seat took down uncontested rather than a gap in
   the numbers. */
export function streetRows(points: StreetPoint[], known: Map<number, Hole>): StreetRow[] {
  const rows: StreetRow[] = [];
  for (const [seat, hero] of [...known.entries()].sort((a, b) => a[0] - b[0])) {
    const cells = points
      .filter((p) => p.live.includes(seat))
      .map((p) => ({ street: p.street, ask: askFor(seat, p.board, p.live, known) }));
    if (cells.length > 0) rows.push({ seat, hero, cells });
  }
  return rows;
}

export interface PracticeSpot {
  hand: string;
  board: Card[];
  pot: number;
  bet: number;
  opponents: number;
}

/* The spot behind a call, in the shape the pot odds trainer takes. Only a call
   makes one: a raise is a price plus a decision the trainer does not ask
   about, and a spot with nobody to beat is not a spot. */
export function practiceSpot(
  before: HandState,
  action: LoggedAction,
  seatMap: number[],
  known: Map<number, Hole>,
): PracticeSpot | null {
  if (action.a !== 'c' && action.a !== 'a') return null;
  const price = priceAt(before, action, seatMap);
  const hero = known.get(action.s);
  if (!price || !hero) return null;
  const opponents = contestingSeats(before, seatMap).filter((s) => s !== action.s).length;
  if (opponents < 1) return null;
  return {
    hand: hero.join(''),
    board: [...before.board],
    pot: price.pot,
    bet: price.toCall,
    opponents: Math.min(8, opponents),
  };
}

export function practiceQuery(spot: PracticeSpot): string {
  const params = new URLSearchParams({
    hand: spot.hand,
    board: spot.board.join(''),
    pot: String(spot.pot),
    bet: String(spot.bet),
    opponents: String(spot.opponents),
  });
  return `/tools/odds?${params.toString()}`;
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/* The price and the equity in one line, which is the whole of pot odds said
   out loud. Without a number for the hand it is still worth saying what the
   call needed. */
export function priceText(price: Price, equity: number | null): string {
  const needed = `needed ${percent(price.needed)}`;
  return equity == null ? needed : `${needed}, had ${percent(equity)}`;
}
