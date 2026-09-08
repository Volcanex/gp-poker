/* The REST payloads, mirroring server/src/routes.ts. Dates arrive as JSON
   strings, not Date objects, so every timestamp is typed as a string here. */
import type { LoggedAction, MatchFormat, MatchResult, Mode, UserSummary } from '@opentable/protocol';
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
  result: 'win' | 'loss' | 'draw';
  ratingChange: number;
  finishedAt: string | null;
  /* Multiway matches and casual play. Pending on the server; read them through
     src/net/adapt.ts, which is where a placing turns into "1st of 6". */
  place?: number | null;
  players?: number | null;
  rated?: boolean | null;
  mode?: Mode | null;
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
  stats: {
    hands: number;
    vpip: number;
    pfr: number;
    aggressionFrequency: number;
    foldTo3bet: number;
  };
  lastMatches: UserMatchSummary[];
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

export interface FeedMatch {
  id: string;
  mode: Mode;
  rated: boolean;
  practice: boolean;
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
  players: { name: string; bot: boolean }[];
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
