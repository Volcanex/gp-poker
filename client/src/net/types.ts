/* The REST payloads, mirroring server/src/routes.ts. Dates arrive as JSON
   strings, not Date objects, so every timestamp is typed as a string here. */
import type {
  HomeGameStatus, LobbySeat, LoggedAction, MatchFormat, MatchResult, Mode, UserSummary,
} from '@opentable/protocol';
import type { HandOutcome } from '@opentable/engine';
import type { Decision } from '@opentable/preflop';

/* The flat fields here are the heads-up standing, the same bargain the wire
   makes. Anything per mode comes from `summary.ratings` through
   `modeRating()`, never from these. */
export interface Me extends UserSummary {
  peak: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface MatchSeat {
  seat: number;
  userId: string;
  name: string;
  /* Pending on the server. Read it through src/net/adapt.ts, never directly. */
  bot?: boolean;
}

export interface LeaderboardRow {
  /* Read it through avatarSeed() in src/net/adapt.ts: the server sends this
     now, but a client can outlive the server it talks to. */
  id?: string;
  name: string;
  rating: number;
  rd: number;
  matches: number;
  peak: number;
}

export interface RatingPoint {
  rating: number;
  rd: number;
  at: string;
  matchId: string | null;
}

export interface UserMatchSummary {
  id: string;
  opponent: string;
  /* Same bargain as the leaderboard's id: read it through avatarSeed(). */
  opponentId?: string;
  result: 'win' | 'loss' | 'draw';
  ratingChange: number;
  finishedAt: string | null;
  /* Multiway matches and casual play. Pending on the server; read them through
     src/net/adapt.ts, which is where a placing turns into "1st of 6". */
  place?: number | null;
  players?: number | null;
  rated?: boolean | null;
  mode?: Mode | null;
  /* A practice table is unrated like a casual one, so only this tells them
     apart. Absent means a server from before practice existed. */
  practice?: boolean | null;
}

/* One bot on the roster, from /api/bots. The level table itself lives in
   @opentable/protocol (BOT_LEVELS) so the picker and the server cannot
   describe a level differently; this is the live part, which is who plays at
   each level and how they are doing. */
export interface BotRow {
  id: string;
  name: string;
  level: number;
  levelName: string;
  description: string;
  ratings: Record<Mode, { rating: number; matches: number }>;
}

export interface Profile {
  summary: UserSummary;
  /* Flat fields are the heads-up standing. Per mode, read summary.ratings
     through modeRating() in src/net/adapt.ts. */
  peak: number;
  peakAt: string | null;
  provisional: boolean;
  winRate: number;
  /* Pending on the server. Read it through src/net/adapt.ts. */
  accuracy?: number | null;
  /* One line per mode. A server that has not shipped that yet sends a single
     flat array, which is why nothing reads this without ratingHistoryFor(). */
  ratingHistory: Record<Mode, RatingPoint[]> | RatingPoint[];
  /* Only `hands` is read. The four rates are the old lifetime "play style"
     block, which came off the profile when Insights started giving the same
     four per mode; the server still sends them for a deploy cycle. Do not
     start reading them again: the per-mode answer is the one on screen. */
  stats: {
    hands: number;
    vpip: number;
    pfr: number;
    aggressionFrequency: number;
    foldTo3bet: number;
  };
  lastMatches: UserMatchSummary[];
}

/* /api/users/:name/insights. Derived from the player's stored hands rather
   than from a counter, one answer per mode. Every group is null until the
   mode has `minHands` hands behind it, and a group that is present can still
   carry a null field: a rate with no denominator is not zero, so the tile
   says what is missing instead of printing one. */
export type PositionKey = 'button' | 'small-blind' | 'big-blind' | 'utg' | 'hijack' | 'cutoff';

export interface Insights {
  mode: Mode;
  minHands: number;
  sample: { hands: number; matches: number };
  preflop: {
    vpip: number | null;
    pfr: number | null;
    threeBet: number | null;
    foldToThreeBet: number | null;
  } | null;
  postflop: {
    aggressionFactor: number | null;
    cbet: number | null;
    wentToShowdown: number | null;
    wonAtShowdown: number | null;
    wonWithoutShowdown: number | null;
  } | null;
  positions: { key: PositionKey; hands: number; bbPerHand: number | null }[] | null;
  streets: { preflop: number; flop: number; turn: number; river: number; showdown: number } | null;
  results: {
    biggestPot: { chips: number; bb: number; handId: string; matchId: string; handNumber: number } | null;
    longestWinStreak: number;
    averageHandMs: number | null;
    timeouts: number;
  } | null;
}

/* The opening explorer at /tools/explorer: what players here did preflop from
   one position, by hand class. Every one of the 169 classes is always in
   `hands`, so the grid is a fixed shape; a class nobody was dealt here reads
   as zero hands and null rates rather than as a missing row. */
export type ExplorerFacing = 'unopened' | 'open' | 'threebet';
export type ExplorerPlayers = 'all' | 'humans';

export interface ExplorerRow {
  hand: string;
  hands: number;
  raise: number | null;
  call: number | null;
  fold: number | null;
  netBb: number | null;
}

export interface Explorer {
  mode: Mode;
  position: PositionKey;
  facing: ExplorerFacing;
  players: ExplorerPlayers;
  minHands: number;
  /* `hands` is this selection's decisions; `matches` is every finished match
     the book was built from, which is what `since` dates. */
  sample: { hands: number; matches: number };
  since: string | null;
  totals: Omit<ExplorerRow, 'hand'>;
  hands: ExplorerRow[];
}

export interface MatchHandSummary {
  number: number;
  completedAt: string | null;
  seedHash: string;
  seed: string | null;
  board: string[];
  stacks: number[];
  awards: HandOutcome['awards'] | null;
  /* Pending on the server. Read it through src/net/adapt.ts, never directly. */
  accuracy?: Record<number, number | null> | (number | null)[] | null;
}

export interface Match {
  id: string;
  format: MatchFormat;
  rated: boolean;
  seats: MatchSeat[];
  status: 'playing' | 'finished' | 'aborted';
  winner: string | null;
  reason: MatchResult['reason'] | null;
  handsPlayed: number;
  finalStacks: Record<string, number> | null;
  places?: Record<string, number> | null; // finishing position per user id, 1 = winner
  ratings: MatchResult['ratings'] | null;
  createdAt: string;
  finishedAt: string | null;
  hands: MatchHandSummary[];
}

/* The home feed and the watch list: /api/recent, /api/stats and /api/live.
   These three routes read the match rows rather than the live rooms, so the
   count in the strip and the list underneath it always agree. */

export interface FeedPlayer {
  name: string;
  bot: boolean;
  place: number | null; // 1 = winner; null on a match stored before places existed
  ratingBefore: number | null; // null when the match was casual or practice
  ratingAfter: number | null;
}

/* One real preflop decision to be graded, from GET /api/puzzles/hand. The
   server walks the stored action log with @opentable/preflop (which cannot run
   in a browser) and hands over the spot it found; the client replays the log
   to logIndex with the engine to draw the table as it stood. */
export interface PuzzleHand {
  handId: string;
  matchId: string;
  number: number;
  seats: { seat: number; name: string; bot: boolean }[];
  button: number;
  sb: number;
  bb: number;
  stacksStart: number[];
  seed: string;
  actions: LoggedAction[];
  seat: number;
  logIndex: number;
  position: 'sb' | 'bb';
  bucket: 'deep' | 'mid' | 'short' | 'push';
  spot: string;
  effectiveBb: number;
  hand: string;
  cards: [string, string];
  played: 'aggr' | 'passive' | 'fold';
}

export interface FeedMatch {
  id: string;
  mode: Mode;
  rated: boolean;
  practice: boolean;
  /* A private table somebody gathered by link. Absent means a server from
     before home games existed. */
  homeGame?: boolean;
  handsPlayed: number;
  finishedAt: string | null;
  players: FeedPlayer[]; // finishing order, winner first
}

export interface SiteStats {
  online: number;
  inQueue: number;
  playing: number;
  matchesToday: number;
  handsTotal: number;
  playersTotal: { registered: number; guest: number };
}

export interface LiveMatch {
  id: string;
  mode: Mode;
  rated: boolean;
  practice: boolean;
  hand: number; // the hand being dealt now, 1-based
  // rating and spectators are optional because a server that predates
  // watching sends neither, and a missing number is hidden rather than
  // printed as a zero.
  players: { name: string; bot: boolean; rating?: number }[];
  spectators?: number;
  startedAt: string;
}

/* study is written by the server as {seat: {decisions, evLost, accuracy}}
   (server/db/schema.sql). Every field is optional here: a hand scored before
   the study writer existed, or a hand with no preflop decision, has none. */
export interface SeatStudy {
  decisions?: Decision[];
  evLost?: number;
  accuracy?: number;
  count?: number;
}

export interface HandSeatStats {
  vpip: boolean;
  pfr: boolean;
  aggr: number;
  passive: number;
  faced3bet: boolean;
  foldTo3bet: boolean;
}

export interface Hand {
  id: string;
  matchId: string;
  number: number;
  seats: MatchSeat[];
  button: number;
  sb: number;
  bb: number;
  stacksStart: number[];
  seedHash: string;
  seed: string | null;
  actions: LoggedAction[];
  /* Engine seat index to table seat, for a hand dealt to some of a multiway
     table. Absent means the two are the same thing. Read it through
     src/net/adapt.ts, which supplies that identity. */
  live_seats?: number[] | null;
  board: string[];
  holes: Record<number, [string, string]> | null;
  result: HandOutcome | null;
  stats: Record<number, HandSeatStats> | null;
  study: Record<number, SeatStudy> | null;
  startedAt: string;
  completedAt: string | null;
}

/* A "play a friend" link, from /api/challenges/:id. `expired` is derived by
   the server from the link's day-long life rather than stored, so a page that
   sits open does not need to work the clock out for itself: it re-reads. */
export interface Challenge {
  id: string;
  mode: Mode;
  rated: boolean;
  status: 'open' | 'accepted' | 'cancelled' | 'expired';
  creator: UserSummary;
  /* Set once the link has been accepted, so a spent link can still offer the
     table it turned into. */
  matchId: string | null;
  createdAt: string;
  expiresAt: string;
}

/* What creating one hands back: the id, and the whole address to share. The
   url is built by the server from the host the request arrived on, so it is
   right behind the proxy without the client guessing at the origin. */
export interface CreatedChallenge {
  id: string;
  url: string;
}

/* A home game lobby: the six-max version of a challenge link. The host holds a
   seat like everybody else, so `seats` is the whole guest list and `host` only
   says whose table it is. `players` is how many chairs there are, empty ones
   included, so the ring is drawn from the server's answer rather than a six
   written into the page. */
export interface HomeGame {
  id: string;
  host: UserSummary;
  seats: LobbySeat[];
  players: number;
  rated: boolean;
  botLevel: number;
  status: HomeGameStatus;
  /* Set once the table has started, so a spent lobby can still offer the match
     it turned into. */
  matchId: string | null;
  createdAt: string;
  expiresAt: string;
}

/* What creating one hands back, the same shape a challenge link does: the id,
   and the whole address to share. */
export interface CreatedHomeGame {
  id: string;
  url: string;
}

/* What starting one hands back. `reason` is filled in only when the table is
   playing for something other than what the host asked for. */
export interface StartedHomeGame {
  matchId: string;
  rated: boolean;
  reason: string | null;
}
