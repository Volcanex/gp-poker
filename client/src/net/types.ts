/* The REST payloads, mirroring server/src/routes.ts. Dates arrive as JSON
   strings, not Date objects, so every timestamp is typed as a string here. */
import type {
  ArenaStanding, ArenaStatus, HomeGameStatus, LobbySeat, LoggedAction, MatchFormat, MatchResult, Mode,
  UserSummary,
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
  /* Absent for everybody but the one account that has it. The admin bar and
     the annotation layer are the only things that read it. */
  admin?: boolean;
  /* Whether rated play is open: one finished casual or practice match is what
     opens it. Optional because a client can outlive the server it talks to,
     and absent reads as open, so an older server never locks a control it
     knows nothing about. The picker refreshes /api/me on every match end, so
     this flips without anything pushing it. */
  rankedUnlocked?: boolean;
}

/* An annotation made on the running site: what is wrong, where it was seen,
   which elements were pointed at and what was drawn over them. Written by
   src/admin/annotate.tsx and read by src/admin/tickets.tsx. */
export interface TicketTarget {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  label: string | null;
}

export interface TicketViewport {
  width: number;
  height: number;
  dpr: number;
  theme: string;
}

/* What a list row carries. The drawing is deliberately not on it: a page of
   titles must not be a page of PNGs. */
export interface TicketSummary {
  id: string;
  createdAt: string;
  url: string;
  path: string;
  title: string;
  note: string;
  viewport: TicketViewport;
  targets: TicketTarget[];
  status: 'open' | 'done';
  build: string | null;
}

export interface Ticket extends TicketSummary {
  drawing: string | null;
  pageShot: string | null;
}

export interface MatchSeat {
  seat: number;
  userId: string;
  name: string;
  /* Pending on the server. Read it through src/net/adapt.ts, never directly. */
  bot?: boolean;
  /* The picture this seat had when the match was made. Absent on a match
     played before pictures existed; read it through avatarVersion(). */
  avatarV?: number;
  /* The flag this seat carried when the match was created. Absent on a seat
     played before countries existed, and on one whose player had none. */
  country?: string | null;
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
  avatarV?: number;
  /* Null for a player with no flag, absent on a server that predates them.
     Both mean the same thing to the row, which draws nothing. */
  country?: string | null;
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
  opponentAvatarV?: number;
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

/* Where a player sits in one mode: their 1-based place counting from the top,
   the size of the field that place is in, and the share of that field rated
   strictly below them. The field is every non-bot with at least one rated match
   in the mode, which is why a bot and a mode nobody has played have no standing
   at all rather than a rank of zero. */
export interface ModeStanding {
  rank: number;
  population: number;
  percentile: number;
}

export interface Profile {
  summary: UserSummary;
  /* The mode this player plays most, which the headline and both mode switches
     open on. Absent on a server from before it; read it through mainMode() in
     src/net/adapt.ts, never directly. */
  main?: Mode;
  /* One standing per mode, null for a mode with no rated match behind it and
     for a bot. Absent on an older server; read it through modeStanding(). */
  percentiles?: Partial<Record<Mode, ModeStanding | null>>;
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
  /* Finished arenas this player took part in, newest first. Absent means a
     server from before arenas existed, which the page renders as no section
     rather than as an empty one. */
  arenas?: ProfileArena[];
}

/* One line of the arenas block on a profile: which arena, when it ended, where
   they came and what they scored. */
export interface ProfileArena {
  id: string;
  name: string;
  endsAt: string;
  place: number | null;
  score: number;
  players: number;
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
  /* The id and the picture version, both absent on a server that predates
     them. Nothing on the feed draws an avatar yet; they are here because a
     row that names a player and cannot say who it means is a row that has to
     be widened again the day it wants to. */
  uid?: string;
  avatarV?: number;
  name: string;
  bot: boolean;
  country?: string | null;
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
  /* The arena this match was paired for, by id. Null on an ordinary match, and
     absent on a server from before arenas existed. */
  arena?: string | null;
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
  homeGame?: boolean;
  arena?: string | null;
  hand: number; // the hand being dealt now, 1-based
  // rating and spectators are optional because a server that predates
  // watching sends neither, and a missing number is hidden rather than
  // printed as a zero.
  players: { uid?: string; avatarV?: number; name: string; bot: boolean; rating?: number; country?: string | null }[];
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

/* An arena, from /api/arenas/:id. The board is the top twenty with your own row
   appended when you are outside them, and `you` is that row again so the page
   can say where you are without searching the list. `podium` is written when
   the arena closes and is null until then. */
export interface Arena {
  id: string;
  name: string;
  status: ArenaStatus;
  startsAt: string;
  endsAt: string;
  players: number;
  playing: number;
  standings: ArenaStanding[];
  you: ArenaStanding | null;
  podium: ArenaPodiumPlace[] | null;
}

export interface ArenaPodiumPlace {
  uid: string;
  name: string;
  score: number;
  place: number;
  /* Written onto the arena row when it closed, so a podium shows the picture
     the winner had that hour. Absent on an arena that finished before pictures
     existed. */
  avatarV?: number;
}

/* A finished arena in the list under the hero card: enough to draw a podium
   and link to the full board. */
export interface ArenaSummary {
  id: string;
  name: string;
  status: ArenaStatus;
  startsAt: string;
  endsAt: string;
  players: number;
  podium: ArenaPodiumPlace[] | null;
}

/* What /api/arenas answers: the arena to play now or next, and the last few
   that are already over. */
export interface ArenaListing {
  featured: Arena | null;
  finished: ArenaSummary[];
}
