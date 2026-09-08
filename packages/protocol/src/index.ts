/* Wire protocol v5. JSON over WebSocket, short keys, every message carries t.
   The server is authoritative: clients send intent only. Any change to the
   shapes below is a protocol change: bump PROTOCOL_VERSION and keep the
   server accepting the previous one for a deploy cycle. v4 is additive: the
   `arena` message in both directions and `format.arena`, so a v3 client that
   never sends one is served unchanged. Profile pictures and flags were
   additive inside v4 for the same reason: `avatarV` and `country` are optional
   on every shape that carries them, and a client that has never heard of
   either draws the generated avatar and no flag, as it always did. */

export const PROTOCOL_VERSION = 4;

export type Card = string; // 'As', 'Td', '2c' (rank + suit, lowercase suit)

export type ActionKind = 'f' | 'x' | 'c' | 'b' | 'r' | 'a'; // fold check call bet raise all-in
export type Street = 'pre' | 'flop' | 'turn' | 'river' | 'showdown' | 'done';

export type Mode = 'heads-up' | 'six-max';

export interface MatchFormat {
  mode: Mode;
  players: number; // seats at the table: 2 for heads-up, 6 for six-max
  rated: boolean;
  hands: number | null; // heads-up: match ends after this many hands unless someone busts; null = until one player has every chip
  stack: number; // starting stack in table units
  sb: number; // level 1 blinds; kept flat so old readers still work
  bb: number;
  levels: { sb: number; bb: number }[]; // blind schedule; a single entry means blinds never escalate
  levelHands: number; // hands per level (ignored with a single level)
  clockMs: number; // per-decision clock
  graceMs: number; // reconnect grace before the clock runs while disconnected
  // A practice table: one human, the rest bots of a chosen level, never
  // rated. Optional so a format stored before practice existed still parses.
  practice?: boolean;
  // A ladder table: bots playing each other in the background so their
  // ratings are earned rather than assumed. Rated like any bot match, but
  // kept out of the live list and the feed, because nobody is at it.
  ladder?: boolean;
  // Overrides HAND_HOLD_MS for this format. A ladder hand has no one
  // watching it, so it does not pause four seconds to be watched.
  holdMs?: number;
  // A home game: a private six-max table a host gathered by link, with bots
  // in whatever seats nobody took. Optional for the same reason `practice`
  // is: a format stored before home games existed simply has no key.
  homeGame?: boolean;
  // The arena this match was paired for, by arena id. An arena match is an
  // ordinary rated heads-up match in every other way, so this is the only
  // thing that tells the scorer, the feed and the table it belongs to one.
  arena?: string;
}

export const HEADS_UP_FORMAT: MatchFormat = {
  mode: 'heads-up',
  players: 2,
  rated: true,
  hands: 25,
  stack: 200,
  sb: 1,
  bb: 2,
  levels: [{ sb: 1, bb: 2 }],
  levelHands: 25,
  clockMs: 20_000,
  graceMs: 15_000,
};

/* Sit-and-go: last player with chips wins, blinds climb so it ends. */
export const SIX_MAX_FORMAT: MatchFormat = {
  mode: 'six-max',
  players: 6,
  rated: true,
  hands: null,
  stack: 200,
  sb: 1,
  bb: 2,
  levels: [
    { sb: 1, bb: 2 },
    { sb: 2, bb: 4 },
    { sb: 3, bb: 6 },
    { sb: 5, bb: 10 },
    { sb: 8, bb: 16 },
    { sb: 12, bb: 24 },
    { sb: 20, bb: 40 },
    { sb: 30, bb: 60 },
    { sb: 50, bb: 100 },
  ],
  levelHands: 8,
  clockMs: 20_000,
  graceMs: 15_000,
};

/* How long a finished hand is held on screen before the next one deals, or
   before the match result is sent. The server sleeps it and the client counts
   it down, so it lives here rather than in either of them: two copies of this
   number drift and the countdown starts lying. Capped at the decision clock,
   so a test running a 300 ms clock does not spend four seconds a hand. */
export const HAND_HOLD_MS = 4_000;

/* The hold one format actually uses: its own `holdMs` if it set one, the
   shared default otherwise, and never longer than the decision clock. The
   server sleeps this and the client counts it down, so both ask here. */
export function holdFor(format: MatchFormat): number {
  return Math.min(format.holdMs ?? HAND_HOLD_MS, format.clockMs);
}

export const DEFAULT_FORMAT = HEADS_UP_FORMAT;

/* The five bot levels, one table shared by the server (which plays them and
   labels the roster) and the client (which offers them in the practice
   picker). Level 4 is the bot that existed before levels did; 1 to 3 are
   progressively looser or more passive, 5 is sharper. Monotonic: a higher
   level beats a lower one over a long enough sample. */
export type BotLevel = 1 | 2 | 3 | 4 | 5;

export const DEFAULT_BOT_LEVEL: BotLevel = 4;

export interface BotLevelInfo {
  level: BotLevel;
  name: string; // short label for a picker option
  description: string; // the one line shown beside a bot's name
}

export const BOT_LEVELS: BotLevelInfo[] = [
  { level: 1, name: 'Loose and passive', description: 'Level 1: loose and passive, calls almost everything' },
  { level: 2, name: 'Loose', description: 'Level 2: loose, raises only with strong hands' },
  { level: 3, name: 'Tight and passive', description: 'Level 3: tight but rarely raises' },
  { level: 4, name: 'Solid', description: 'Level 4: solid, plays the charts and pot odds' },
  { level: 5, name: 'Sharp', description: 'Level 5: sharp, semi-bluffs and sizes bets by the board' },
];

export function isBotLevel(n: unknown): n is BotLevel {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
}

// Anything outside 1..5 reads as the default rather than erroring: a level is
// a preference, and a stored or hand-typed one should not break a table.
export function botLevelInfo(level: number): BotLevelInfo {
  return BOT_LEVELS.find((b) => b.level === level) ?? BOT_LEVELS[DEFAULT_BOT_LEVEL - 1];
}

export function formatFor(mode: Mode, rated: boolean): MatchFormat {
  const base = mode === 'six-max' ? SIX_MAX_FORMAT : HEADS_UP_FORMAT;
  return { ...base, rated };
}

export function blindsAt(format: MatchFormat, handNumber: number): { sb: number; bb: number } {
  if (format.levels.length <= 1) return { sb: format.sb, bb: format.bb };
  const level = Math.min(format.levels.length - 1, Math.floor((handNumber - 1) / format.levelHands));
  return format.levels[level];
}

/* A home game lobby: the private six-max table a host is gathering. The
   status is derived from the row's clock when it is read, so `expired` is a
   thing a lobby can be without anything having written it down. */
export type HomeGameStatus = 'open' | 'started' | 'cancelled' | 'expired';

/* One person sitting in a lobby. `uid` is what the avatar is drawn from, so
   a seat carries everything the ring needs and nothing more. */
export interface LobbySeat {
  uid: string;
  name: string;
  rating: number; // their six-max standing, the mode a home game is played in
  host: boolean;
  avatarV?: number; // picture version, 0 for none
  country?: string; // see SeatView.country
}

/* An arena: a half-hour heads-up event that pairs you again the moment your
   match ends. Three statuses and no more: it is upcoming until its clock
   starts, running until its clock ends, and finished for good after that. */
export type ArenaStatus = 'upcoming' | 'running' | 'finished';

/* One row of an arena's board. Everything the standings table draws, so a row
   never needs a second lookup: `rank` is the server's ordering (score, then
   wins, then rating) rather than the row's index, because a page shows the top
   twenty plus you and you may be neither. */
export interface ArenaStanding {
  uid: string;
  name: string;
  bot: boolean;
  rating: number; // heads-up standing, the mode an arena is played in
  rank: number; // 1-based
  score: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number; // consecutive wins; two of them and the next win is worth three
  matches: number;
  paused: boolean;
  avatarV?: number; // picture version, 0 for none
  country?: string; // see SeatView.country
}

/* What a result is worth on the board, and when a run of wins starts paying
   more. Here rather than in the server that applies it, because the client
   draws the flame that promises the next win is worth three and two copies of
   that threshold drift until the promise stops being true. */
export const ARENA_WIN_POINTS = 2;
export const ARENA_DRAW_POINTS = 1;
export const ARENA_LOSS_POINTS = 0;
export const ARENA_FIRE_POINTS = 3;
// Wins in a row already banked before a win pays ARENA_FIRE_POINTS. Two, so
// the third consecutive win is the first one worth three.
export const ARENA_FIRE_FROM = 2;

export function arenaPoints(outcome: 'win' | 'loss' | 'draw', streakBefore: number): number {
  if (outcome === 'draw') return ARENA_DRAW_POINTS;
  if (outcome === 'loss') return ARENA_LOSS_POINTS;
  return streakBefore >= ARENA_FIRE_FROM ? ARENA_FIRE_POINTS : ARENA_WIN_POINTS;
}

/* Client -> server */
export type ClientMsg =
  // defaults: heads-up, rated. `bots` asks for a practice table instead: no
  // human queue, seats filled from the roster at that level, never rated.
  | { t: 'queue'; mode?: Mode; rated?: boolean; bots?: { level: number } }
  | { t: 'dequeue' }
  | { t: 'join'; m: string } // subscribe to a match as player or spectator
  | { t: 'leave'; m: string }
  | { t: 'act'; m: string; h: number; n: number; a: ActionKind; v?: number } // n = action seq the client is acting at
  // Table chat. Anyone subscribed to the match may send one; where it lands is
  // the server's decision, not the sender's (see ChatFrom).
  | { t: 'chat'; m: string; text: string }
  // Watch one arena's board, or `null` to stop. A page on the arena is what
  // the pushes go to, and that is a thing only the page knows, so it says so
  // rather than the server guessing from who joined.
  | { t: 'arena'; a: string | null }
  | { t: 'ping' };

/* Who said something at a table. `seat` is null for a spectator, which is also
   what says which channel the message belongs to: a spectator's line is only
   ever sent to other spectators, the way it works on Lichess, so a table
   cannot be coached from the rail. */
export interface ChatFrom {
  id: string;
  name: string;
  bot: boolean;
  seat: number | null;
  avatarV?: number; // picture version, 0 for none
}

/* The limits, here rather than on either side of the wire, because the client
   counts the same cooldown down that the server enforces and two copies of
   these numbers drift until the countdown starts lying. */
export const CHAT_MAX_LENGTH = 200;
export const CHAT_MIN_GAP_MS = 2_000; // one message per this long
export const CHAT_MAX_PER_MATCH = 20; // per user, for the life of the match
export const CHAT_HISTORY = 100; // kept in memory per channel, replayed on join

/* Server -> client */
export type ServerMsg =
  | { t: 'hi'; v: number; u: UserSummary }
  | { t: 'q'; s: 'searching' | 'found' | 'left'; w?: number; range?: number; m?: string; mode?: Mode; rated?: boolean; seated?: number } // seated = players gathered so far for a multiway table
  | { t: 'state'; s: TableView }
  | { t: 'end'; m: string; r: MatchResult }
  // Who is sitting in a home game lobby, pushed to everyone seated in it so
  // the lobby page updates without polling for it.
  | { t: 'lobby'; g: string; seats: LobbySeat[]; status: HomeGameStatus }
  | { t: 'chat'; m: string; from: ChatFrom; text: string; at: number } // at = epoch ms
  // An arena's board, pushed to everyone watching it on a five second beat and
  // on every score change. `standings` is the top twenty plus you.
  | {
      t: 'arena';
      a: string;
      standings: ArenaStanding[];
      you: ArenaStanding | null;
      status: ArenaStatus;
      endsAt: number; // epoch ms
      playing: number; // arena matches in progress
    }
  | { t: 'err'; c: 'illegal' | 'stale' | 'not_your_turn' | 'no_match' | 'bad_msg' | 'version' | 'bots_busy' | 'chat'; msg: string }
  | { t: 'pong' };

/* One mode's Glicko-2 standing. Ratings are per mode, the way a chess site
   keeps bullet and blitz apart: a six-max result never moves a heads-up
   rating. A player who has not played a mode reads as a fresh 1500/350. */
export interface ModeRating {
  rating: number;
  rd: number;
  provisional: boolean;
  peak: number;
  peakAt: string | null; // ISO, null until the mode has been played
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface UserSummary {
  id: string;
  name: string;
  guest: boolean;
  bot: boolean;
  botLevel?: number; // 1..5, present only on a bot
  /* The flag beside their name, as SeatView.country, except that this one is
     sent as `null` rather than left off when there is none: a summary is
     merged over the one a client already holds, and a key that goes absent
     when a flag is cleared would leave the old flag on the screen. Optional
     only so a v4 server, which sends no key at all, still parses. */
  country?: string | null;
  // Flat fields are the heads-up standing, kept so anything reading a single
  // rating still works. `ratings` is the real answer.
  rating: number;
  rd: number;
  provisional: boolean;
  ratings: Record<Mode, ModeRating>;
  /* Which version of this player's picture to ask for, 0 when they have none.
     Optional so a client talking to a server that predates pictures reads the
     generated avatar rather than a broken image. */
  avatarV?: number;
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
  /* The flag beside the name: a lowercase ISO 3166-1 alpha-2 code the player
     picked for themselves, absent when they have picked none. Optional, and
     omitted rather than sent as null, because most players will never set one
     and a v4 client is served a seat it can already read. Snapshotted with the
     name when the match is created, so changing it mid-match changes the next
     table rather than this one. */
  country?: string;
  rating: number;
  stack: number;
  bet: number; // committed on the current street
  cards: Card[] | null; // null = no cards; ['?', '?'] = hidden from this viewer
  folded: boolean;
  allin: boolean;
  button: boolean;
  acting: boolean;
  connected: boolean;
  bot: boolean;
  out: boolean; // eliminated from a multiway match, seat stays visible with its place
  place: number | null; // finishing position once out (1 = winner), null while in
  last: { a: ActionKind; v?: number } | null;
  /* Picture version, 0 for none. Frozen when the match was created, like the
     name and the rating beside it: a seat is what the table looked like when
     it sat down. */
  avatarV?: number;
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
  blinds: { sb: number; bb: number }; // current level
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
  places: Record<string, number>; // finishing position per user id, 1 = winner; heads-up draw gives both 1
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
