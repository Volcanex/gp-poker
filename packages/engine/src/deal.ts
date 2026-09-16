import type { Card } from '@opentable/protocol';
import type { HandConfig, HandState, SeatState } from './types.js';
import { deckFromSeed } from './random.js';
import { resolveShowdown } from './showdown.js';

const STREETS = ['pre', 'flop', 'turn', 'river'] as const;

export function holeCardsUsed(n: number): number {
  return n * 2;
}

export function nextActiveSeatFrom(state: HandState, fromIdx: number): number | null {
  const n = state.seats.length;
  for (let i = 0; i < n; i++) {
    const idx = (fromIdx + i) % n;
    const s = state.seats[idx];
    if (!s.folded && !s.allin) return idx;
  }
  return null;
}

function postBlind(state: HandState, seatIdx: number, amount: number): void {
  const seat = state.seats[seatIdx];
  const pay = Math.min(amount, seat.stack);
  seat.stack -= pay;
  seat.bet += pay;
  seat.committed += pay;
  if (seat.stack === 0) seat.allin = true;
}

/* Reveal the next street's cards (no burns; board continues straight from
   where hole cards left off in deck order) and reset betting for it. */
export function dealNextStreet(state: HandState): void {
  const idx = STREETS.indexOf(state.street as (typeof STREETS)[number]);
  const next = STREETS[idx + 1];
  const need = next === 'flop' ? 3 : 1;
  const used = holeCardsUsed(state.seats.length) + state.board.length;
  const cards: Card[] = state.deck.slice(used, used + need);
  state.board = [...state.board, ...cards];
  state.street = next;
  for (const s of state.seats) {
    if (!s.folded) {
      s.bet = 0;
      s.acted = false;
    }
  }
  state.currentBet = 0;
  state.minRaise = state.config.bb;
  state.lastAggressor = null;
}

export function runOutAndShowdown(state: HandState): void {
  while (state.street !== 'river') dealNextStreet(state);
  resolveShowdown(state);
  state.toAct = null;
}

export function createHand(config: HandConfig): HandState {
  return createHandWithDeck(config, deckFromSeed(config.seed));
}

export function createHandWithDeck(config: HandConfig, deck: Card[]): HandState {
  const n = config.seats.length;
  const seats: SeatState[] = config.seats.map((s) => ({
    id: s.id,
    stack: s.stack,
    bet: 0,
    committed: 0,
    cards: null,
    folded: false,
    allin: false,
    acted: false,
  }));

  /* Two cards per seat, round-robin starting left of the button, one card
     to each seat before the second. */
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push((config.button + 1 + i) % n);
  let cardIdx = 0;
  const first: Record<number, Card> = {};
  for (const seatIdx of order) first[seatIdx] = deck[cardIdx++];
  for (const seatIdx of order) seats[seatIdx].cards = [first[seatIdx], deck[cardIdx++]];

  const sbSeat = n === 2 ? config.button : (config.button + 1) % n;
  const bbSeat = n === 2 ? (config.button + 1) % n : (config.button + 2) % n;

  const state: HandState = {
    config,
    deck,
    seats,
    street: 'pre',
    board: [],
    toAct: null,
    lastAggressor: null,
    currentBet: 0,
    minRaise: config.bb,
    actions: [],
    seq: 0,
    result: null,
    blinds: { sb: sbSeat, bb: bbSeat },
  };

  postBlind(state, sbSeat, config.sb);
  postBlind(state, bbSeat, config.bb);
  state.currentBet = Math.max(seats[sbSeat].bet, seats[bbSeat].bet);
  state.minRaise = config.bb;

  const preflopStart = nextActiveSeatFrom(state, (bbSeat + 1) % n);
  const canAct = seats.filter((s) => !s.allin);
  if (canAct.length === 0) {
    runOutAndShowdown(state);
  } else {
    state.toAct = preflopStart;
  }

  return state;
}
