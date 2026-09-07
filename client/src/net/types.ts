/* The REST payloads, mirroring server/src/routes.ts. Dates arrive as JSON
   strings, not Date objects, so every timestamp is typed as a string here. */
import type { LoggedAction, MatchFormat, MatchResult, UserSummary } from '@opentable/protocol';
import type { HandOutcome } from '@opentable/engine';
import type { Decision } from '@opentable/preflop';

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
}

export interface Profile {
  summary: UserSummary;
  peak: number;
  peakAt: string | null;
  provisional: boolean;
  winRate: number;
  /* Both pending on the server. Read them through src/net/adapt.ts. */
  accuracy?: number | null;
  matches?: number;
  ratingHistory: RatingPoint[];
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
  ratings: MatchResult['ratings'] | null;
  createdAt: string;
  finishedAt: string | null;
  hands: MatchHandSummary[];
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
  board: string[];
  holes: Record<number, [string, string]> | null;
  result: HandOutcome | null;
  stats: Record<number, HandSeatStats> | null;
  study: Record<number, SeatStudy> | null;
  startedAt: string;
  completedAt: string | null;
}
