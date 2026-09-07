/* Wire protocol v1. JSON over WebSocket, short keys, every message carries t.
   The server is authoritative: clients send intent only. Any change to the
   shapes below is a protocol change: bump PROTOCOL_VERSION and keep the
   server accepting the previous one for a deploy cycle. */

export const PROTOCOL_VERSION = 1;

export type Card = string; // 'As', 'Td', '2c' (rank + suit, lowercase suit)

export type ActionKind = 'f' | 'x' | 'c' | 'b' | 'r' | 'a'; // fold check call bet raise all-in
export type Street = 'pre' | 'flop' | 'turn' | 'river' | 'showdown' | 'done';

export interface MatchFormat {
  hands: number; // best-of: match ends after this many hands unless someone busts
  stack: number; // starting stack in table units
  sb: number;
  bb: number;
  clockMs: number; // per-decision clock
  graceMs: number; // reconnect grace before the clock runs while disconnected
}

export const DEFAULT_FORMAT: MatchFormat = {
  hands: 25,
  stack: 200,
  sb: 1,
  bb: 2,
  clockMs: 20_000,
  graceMs: 15_000,
};

/* Client -> server */
export type ClientMsg =
  | { t: 'queue' }
  | { t: 'dequeue' }
  | { t: 'join'; m: string } // subscribe to a match as player or spectator
  | { t: 'leave'; m: string }
  | { t: 'act'; m: string; h: number; n: number; a: ActionKind; v?: number } // n = action seq the client is acting at
  | { t: 'ping' };

/* Server -> client */
export type ServerMsg =
  | { t: 'hi'; v: number; u: UserSummary }
  | { t: 'q'; s: 'searching' | 'found' | 'left'; w?: number; range?: number; m?: string }
  | { t: 'state'; s: TableView }
  | { t: 'end'; m: string; r: MatchResult }
  | { t: 'err'; c: 'illegal' | 'stale' | 'not_your_turn' | 'no_match' | 'bad_msg' | 'version'; msg: string }
  | { t: 'pong' };

export interface UserSummary {
  id: string;
  name: string;
  guest: boolean;
  rating: number;
  rd: number;
  provisional: boolean;
}

export interface LastEvent {
  k: 'deal' | 'act' | 'street' | 'showdown' | 'award' | 'newhand' | 'timeout';
  seat?: number;
  a?: ActionKind;
  v?: number;
  cards?: Card[];
}

export interface SeatView {
  i: number;
  uid: string;
  name: string;
  rating: number;
  stack: number;
  bet: number; // committed on the current street
  cards: Card[] | null; // null = no cards; ['?', '?'] = hidden from this viewer
  folded: boolean;
  allin: boolean;
  button: boolean;
  acting: boolean;
  connected: boolean;
  last: { a: ActionKind; v?: number } | null;
}

export interface LegalActions {
  actions: ActionKind[];
  call: number; // amount to call (0 when check is legal)
  min: number; // minimum bet/raise-to amount
  max: number; // maximum bet/raise-to (all-in)
}

export interface TableView {
  m: string; // match id
  h: number; // hand number, 1-based
  n: number; // action seq within the hand; act messages must echo it
  street: Street;
  board: Card[];
  pot: number; // total in the middle including current-street bets
  pots: { amount: number; seats: number[] }[]; // main and side pots once settled
  seats: SeatView[];
  you: number | null; // your seat index, null when spectating
  legal: LegalActions | null; // non-null only when it is your turn
  clock: { seat: number; deadline: number; paused: boolean } | null; // deadline = epoch ms
  seedHash: string;
  seed: string | null; // published when the hand completes
  format: MatchFormat;
  handsPlayed: number;
  last: LastEvent | null;
  result: HandResult | null; // set while street === 'done'
}

export interface HandResult {
  awards: { seat: number; amount: number; hand?: string }[]; // hand = description when shown down
  shown: Record<number, Card[]>; // hole cards revealed at showdown, keyed by seat
}

export interface MatchResult {
  winner: string | null; // user id, null on draw
  reason: 'bust' | 'hands' | 'forfeit' | 'draw' | 'abort';
  stacks: Record<string, number>;
  rated: boolean;
  ratings: Record<string, { before: number; after: number; rdBefore: number; rdAfter: number }>;
}

/* Persisted action log entry: with the seed and format it reconstructs the hand. */
export interface LoggedAction {
  s: number; // seat
  a: ActionKind;
  v?: number; // amount for b/r (raise-to), omitted otherwise
  t: number; // ms since hand start
  to?: boolean; // true when the action was applied by the clock, not the player
}

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m.t !== 'string') return null;
    return m as ClientMsg;
  } catch {
    return null;
  }
}
