/* Public contract of the engine. The server and the replay viewer program
   against these shapes; the implementation lives beside this file. The engine
   is pure: every function returns a new state and never touches a clock,
   a socket or the database. N-player capable (2..9) even though the rated
   product is heads-up, because side pots only exist multiway and the tests
   need them. */

import type { ActionKind, Card, LoggedAction, Street } from '@opentable/protocol';

export interface HandConfig {
  seats: { id: string; stack: number }[]; // seat index = array index; stack > 0
  button: number; // seat index of the dealer button
  sb: number;
  bb: number;
  seed: string; // hex, 32 bytes; the deck is derived deterministically from it
}

export interface SeatState {
  id: string;
  stack: number; // chips behind
  bet: number; // committed on the current street
  committed: number; // committed over the whole hand (for pot building)
  cards: [Card, Card] | null;
  folded: boolean;
  allin: boolean;
  acted: boolean; // has acted since the last aggression on this street
}

export interface Pot {
  amount: number;
  eligible: number[]; // seat indexes that can win it
}

export interface HandState {
  config: HandConfig;
  deck: Card[]; // full shuffled deck; board and holes are dealt from it in order
  seats: SeatState[];
  street: Street;
  board: Card[];
  toAct: number | null; // seat index, null when no decision is pending
  lastAggressor: number | null;
  currentBet: number; // highest bet on this street
  minRaise: number; // size of the last raise (raise-to must be >= currentBet + minRaise)
  actions: LoggedAction[];
  seq: number; // number of actions applied; the wire n field
  result: HandOutcome | null; // set once street === 'done'
  /* The seats that posted, as seat indexes: heads-up the button is the small
     blind, otherwise the two seats left of it. Recorded where the blinds are
     actually posted rather than left to be re-derived from `button`, so
     nothing downstream can disagree with who paid. */
  blinds: { sb: number; bb: number };
}

export interface HandOutcome {
  pots: Pot[];
  awards: { seat: number; amount: number; hand?: string }[];
  shown: Record<number, [Card, Card]>; // seats that had to reveal at showdown
}

export interface Legal {
  actions: ActionKind[];
  call: number;
  min: number; // minimum raise-to / bet amount
  max: number; // all-in raise-to / bet amount
}

export interface Action {
  a: ActionKind;
  v?: number; // for 'b' and 'r': the raise-to / bet-to total on this street
}

export class IllegalAction extends Error {}
