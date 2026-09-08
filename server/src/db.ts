import postgres from 'postgres';
import { DEFAULTS as RATING_DEFAULTS } from '@opentable/rating';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { LoggedAction, MatchFormat, MatchResult, Mode } from '@opentable/protocol';
import { blindsAt } from '@opentable/protocol';
import type { HandOutcome } from '@opentable/engine';
import type { Decision, SeatStats, Summary } from '@opentable/preflop';
import type { InsightHand, InsightMatch } from './insights.js';
import type { ExplorerHand } from './explorer.js';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const sql = postgres(config.databaseUrl, { transform: postgres.camel });

// sql.json()'s JSONValue type requires an index signature, which our named
// interfaces don't have even though every value in them is plain JSON data.
// This is the one cast boundary for that mismatch.
function jsonb<T>(value: T): postgres.JSONValue {
  return value as unknown as postgres.JSONValue;
}

// Arbitrary constant: an advisory lock held for the duration of the
// migration transaction. Without it, concurrent boots (multiple test
// workers, or a rolling deploy) can race on `create extension if not
// exists` and similar DDL that Postgres doesn't make fully concurrent-safe.
const SCHEMA_LOCK_KEY = 727100;

export async function applySchema() {
  const schemaPath = path.resolve(here, '..', 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${SCHEMA_LOCK_KEY})`;
    await tx.unsafe(schema);
  });
}

export interface UserRow {
  id: string;
  name: string;
  nameLower: string;
  passwordHash: string | null;
  guest: boolean;
  bot: boolean;
  botLevel: number | null; // 1..5 on a bot, null on a person
  admin: boolean; // the annotation layer and the tickets it writes, nothing else
  createdAt: Date;
  lastSeenAt: Date;
  rating: number;
  rd: number;
  volatility: number;
  ratingAt: Date;
  peakRating: number;
  peakAt: Date | null;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

/* One row per (user, mode). This is where the Glicko-2 state lives now; the
   matching columns on `users` are legacy, mirrored from the heads-up row on
   write and never read. A missing row is a player who has not played that
   mode: it reads as a fresh 1500/350/0.06 rather than being created eagerly,
   so a guest who never plays leaves nothing behind. */
export interface RatingRow {
  userId: string;
  mode: Mode;
  rating: number;
  rd: number;
  volatility: number;
  ratingAt: Date;
  peakRating: number;
  peakAt: Date | null;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export const MODES: Mode[] = ['heads-up', 'six-max'];

export function defaultRating(userId: string, mode: Mode): RatingRow {
  return {
    userId,
    mode,
    rating: 1500,
    rd: 350,
    volatility: 0.06,
    ratingAt: new Date(),
    peakRating: 1500,
    peakAt: null,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

export async function getRating(userId: string, mode: Mode): Promise<RatingRow> {
  const [row] = await sql<RatingRow[]>`
    select * from ratings where user_id = ${userId} and mode = ${mode}
  `;
  return row ?? defaultRating(userId, mode);
}

// Every mode for one user, defaults filled in for the ones never played.
export async function getRatingsFor(userId: string): Promise<Record<Mode, RatingRow>> {
  const rows = await sql<RatingRow[]>`select * from ratings where user_id = ${userId}`;
  const out = {} as Record<Mode, RatingRow>;
  for (const mode of MODES) out[mode] = rows.find((r) => r.mode === mode) ?? defaultRating(userId, mode);
  return out;
}

export async function getRatingsForUsers(userIds: string[], mode: Mode): Promise<Map<string, RatingRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await sql<RatingRow[]>`
    select * from ratings where mode = ${mode} and user_id in ${sql(userIds)}
  `;
  const out = new Map<string, RatingRow>();
  for (const id of userIds) out.set(id, rows.find((r) => r.userId === id) ?? defaultRating(id, mode));
  return out;
}

export interface SessionRow {
  token: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface MatchSeat {
  seat: number;
  userId: string;
  name: string;
  rating: number;
  bot: boolean;
}

export interface MatchRow {
  id: string;
  format: MatchFormat;
  rated: boolean;
  seats: MatchSeat[];
  status: 'playing' | 'finished' | 'aborted';
  winner: string | null;
  reason: string | null;
  handsPlayed: number;
  finalStacks: Record<string, number> | null;
  places: Record<string, number> | null;
  ratings: MatchResult['ratings'] | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface HandRow {
  id: string;
  matchId: string;
  number: number;
  seedHash: string;
  seed: string | null;
  button: number;
  stacksStart: number[];
  liveSeats: number[] | null;
  actions: LoggedAction[];
  board: string[];
  holes: Record<number, [string, string]> | null;
  result: HandOutcome | null;
  stats: Record<number, SeatStats> | null;
  study: Record<number, HandStudy> | null;
  startedAt: Date;
  completedAt: Date | null;
}

// Per seat, per hand: the preflop decisions extracted from the action log
// plus their EV-lost/accuracy summary. Built by @opentable/preflop.
export interface HandStudy {
  decisions: Decision[];
  summary: Summary;
}

export interface RatingHistoryRow {
  id: number;
  userId: string;
  matchId: string | null;
  mode: Mode;
  rating: number;
  rd: number;
  at: Date;
}

// ---- users ----

export async function insertGuestUser(name: string): Promise<UserRow> {
  const [row] = await sql<UserRow[]>`
    insert into users (name, name_lower, guest)
    values (${name}, ${name.toLowerCase()}, true)
    returning *
  `;
  return row;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`select * from users where id = ${id}`;
  return row ?? null;
}

export async function getUserByNameLower(nameLower: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`select * from users where name_lower = ${nameLower}`;
  return row ?? null;
}

export async function claimGuestUser(
  id: string,
  name: string,
  passwordHash: string
): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`
    update users
    set name = ${name}, name_lower = ${name.toLowerCase()}, password_hash = ${passwordHash}, guest = false
    where id = ${id} and guest = true
    returning *
  `;
  return row ?? null;
}

// Bot accounts are ordinary users with bot = true: real names, real ratings,
// real history, no password and never a guest. Created once at boot. The level
// is re-asserted on every boot rather than only at creation, so the roster in
// code stays the source of truth for who plays how.
export async function ensureBotUser(name: string, level: number): Promise<UserRow> {
  await sql`
    insert into users (name, name_lower, guest, bot, bot_level)
    values (${name}, ${name.toLowerCase()}, false, true, ${level})
    on conflict (name_lower) do nothing
  `;
  await sql`
    update users set bot_level = ${level}
    where name_lower = ${name.toLowerCase()} and bot = true and bot_level is distinct from ${level}
  `;
  const [row] = await sql<UserRow[]>`select * from users where name_lower = ${name.toLowerCase()}`;
  return row;
}

export async function getBotUsers(): Promise<UserRow[]> {
  return sql<UserRow[]>`select * from users where bot = true order by name_lower asc`;
}

// Advisory-locked so two concurrent boots (a rolling deploy, or several
// test workers) can't both read the pre-identity-package `bot-otter` style
// rows and race to rename them into the same new names. Whichever
// transaction gets the lock first does the whole rename; by the time the
// second one gets it, there are no legacy rows left and it does nothing.
const BOT_MIGRATION_LOCK_KEY = 727101;

export async function migrateLegacyBotNames(names: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BOT_MIGRATION_LOCK_KEY})`;
    const legacy = await tx<UserRow[]>`
      select * from users where bot = true and name_lower like 'bot-%' order by name_lower asc
    `;
    for (let i = 0; i < legacy.length && i < names.length; i++) {
      await tx`
        update users set name = ${names[i]}, name_lower = ${names[i].toLowerCase()}
        where id = ${legacy[i].id}
      `;
    }
  });
}

export async function touchLastSeen(id: string): Promise<void> {
  await sql`update users set last_seen_at = now() where id = ${id}`;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  rating: number;
  rd: number;
  matches: number;
  peakRating: number;
}

export async function getLeaderboard(mode: Mode, limit = 100): Promise<LeaderboardRow[]> {
  // 110 mirrors @opentable/rating's isProvisional threshold (see userView.ts);
  // it's duplicated here only because SQL can't call into that package.
  return sql<LeaderboardRow[]>`
    select u.id, u.name, r.rating, r.rd, r.matches, r.peak_rating
    from ratings r
    join users u on u.id = r.user_id
    where r.mode = ${mode} and r.rd <= 110 and u.bot = false
    order by r.rating desc
    limit ${limit}
  `;
}

export interface UserHandStatsAgg {
  totalHands: number;
  vpipHands: number;
  pfrHands: number;
  faced3betHands: number;
  foldTo3betHands: number;
  aggrTotal: number;
  passiveTotal: number;
}

export async function getUserHandStats(userId: string): Promise<UserHandStatsAgg> {
  const [row] = await sql<UserHandStatsAgg[]>`
    select
      count(*)::int as total_hands,
      count(*) filter (where (h.stats -> mp.seat::text ->> 'vpip')::boolean)::int as vpip_hands,
      count(*) filter (where (h.stats -> mp.seat::text ->> 'pfr')::boolean)::int as pfr_hands,
      count(*) filter (where (h.stats -> mp.seat::text ->> 'faced3bet')::boolean)::int as faced3bet_hands,
      count(*) filter (where (h.stats -> mp.seat::text ->> 'foldTo3bet')::boolean)::int as fold_to3bet_hands,
      coalesce(sum((h.stats -> mp.seat::text ->> 'aggr')::int), 0)::int as aggr_total,
      coalesce(sum((h.stats -> mp.seat::text ->> 'passive')::int), 0)::int as passive_total
    from hands h
    join match_players mp on mp.match_id = h.match_id
    where mp.user_id = ${userId} and h.completed_at is not null and h.stats is not null
  `;
  return (
    row ?? {
      totalHands: 0,
      vpipHands: 0,
      pfrHands: 0,
      faced3betHands: 0,
      foldTo3betHands: 0,
      aggrTotal: 0,
      passiveTotal: 0,
    }
  );
}

// Mean of hands.study's per-seat summary.accuracy, over completed hands
// where the user actually had a scoreable preflop decision (count > 0) -
// otherwise a hand where they never got a named spot would silently drag
// the average up via summarise()'s vacuous accuracy: 100 for zero decisions.
// Null when there are none.
export async function getUserPreflopAccuracy(userId: string): Promise<number | null> {
  const [row] = await sql<{ accuracy: number | null }[]>`
    select avg((h.study -> mp.seat::text -> 'summary' ->> 'accuracy')::numeric)::float8 as accuracy
    from hands h
    join match_players mp on mp.match_id = h.match_id
    where mp.user_id = ${userId}
      and h.completed_at is not null
      and h.study is not null
      and (h.study -> mp.seat::text -> 'summary' ->> 'count')::int > 0
  `;
  return row?.accuracy ?? null;
}

// ---- sessions ----

export async function insertSession(token: string, userId: string, expiresAt: Date): Promise<void> {
  await sql`insert into sessions (token, user_id, expires_at) values (${token}, ${userId}, ${expiresAt})`;
}

export async function getSessionUser(token: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`
    select u.* from sessions s
    join users u on u.id = s.user_id
    where s.token = ${token} and s.expires_at > now()
  `;
  return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await sql`delete from sessions where token = ${token}`;
}

// ---- matches ----

export async function insertMatch(
  id: string,
  format: MatchFormat,
  seats: MatchSeat[],
  rated: boolean
): Promise<MatchRow> {
  const [row] = await sql<MatchRow[]>`
    insert into matches (id, format, rated, seats)
    values (${id}, ${sql.json(jsonb(format))}, ${rated}, ${sql.json(jsonb(seats))})
    returning *
  `;
  return row;
}

export async function insertMatchPlayers(
  matchId: string,
  players: { userId: string; seat: number }[]
): Promise<void> {
  for (const p of players) {
    await sql`
      insert into match_players (match_id, user_id, seat)
      values (${matchId}, ${p.userId}, ${p.seat})
    `;
  }
}

export async function getMatchById(id: string): Promise<MatchRow | null> {
  const [row] = await sql<MatchRow[]>`select * from matches where id = ${id}`;
  return row ?? null;
}

export async function updateMatchHandsPlayed(matchId: string, handsPlayed: number): Promise<void> {
  await sql`update matches set hands_played = ${handsPlayed} where id = ${matchId}`;
}

// Run once at boot: a match still 'playing' means the process died mid-match
// last time around. There's no way to safely resume live hand state across a
// restart, so these are aborted, and an aborted match changes nobody's
// rating (no `ratings` jsonb, no rating_history rows).
//
// This deliberately does NOT touch `rated`. That column is a copy of
// `format.rated` and nothing else; "was a rating actually written" is what
// status/reason and the absence of a `ratings` payload say. Writing false
// here used to make the column disagree with the format, and any process
// running this against a database with a live match elsewhere (a test suite
// pointed at the live URL, say) silently rewrote that match's flag
// underneath it.
export async function abortStalePlayingMatches(): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update matches
    set status = 'aborted', reason = 'abort', finished_at = now()
    where status = 'playing'
    returning id
  `;
  return rows.length;
}

export interface UserMatchSummary {
  id: string;
  mode: MatchFormat['mode'];
  opponent: string; // the other seat heads-up, the next seat along multiway
  opponentId: string | null;
  players: number; // seats in the match, so a client can render "3rd of 6"
  place: number | null;
  result: 'win' | 'loss' | 'draw';
  rated: boolean;
  practice: boolean; // a table of bots, always unrated
  ratingChange: number;
  finishedAt: Date | null;
}

export async function getMatchesForUser(userId: string, limit = 20): Promise<UserMatchSummary[]> {
  const rows = await sql<MatchRow[]>`
    select m.* from matches m
    join match_players mp on mp.match_id = m.id
    where mp.user_id = ${userId} and m.status = 'finished'
    order by m.finished_at desc
    limit ${limit}
  `;
  return rows.map((m) => {
    const opponentSeat = m.seats.find((s) => s.userId !== userId);
    const mine = m.ratings?.[userId];
    const place = m.places?.[userId] ?? null;
    // Multiway has no draws: anything but first place is a loss.
    const result: 'win' | 'loss' | 'draw' =
      m.seats.length > 2
        ? place === 1
          ? 'win'
          : 'loss'
        : m.winner === null
          ? 'draw'
          : m.winner === userId
            ? 'win'
            : 'loss';
    return {
      id: m.id,
      mode: m.format.mode,
      opponent: opponentSeat?.name ?? 'unknown',
      opponentId: opponentSeat?.userId ?? null,
      players: m.seats.length,
      place,
      result,
      rated: m.rated,
      // A practice match is unrated, but so is a casual one: the flag is what
      // lets a history row say which of the two it was.
      practice: m.format.practice === true,
      ratingChange: mine ? Math.round(mine.after - mine.before) : 0,
      finishedAt: m.finishedAt,
    };
  });
}

export interface FinishMatchResult {
  status: 'finished' | 'aborted';
  mode: Mode; // which rating row this match settles against
  rated: boolean; // straight from format.rated; re-asserted so the column cannot drift
  winner: string | null;
  reason: string;
  finalStacks: Record<string, number>;
  places: Record<string, number>;
  ratings: MatchResult['ratings'];
  // Every seat, rated or not. `rating` is null for a casual match: the
  // win/loss/draw and match counters still move, the Glicko-2 state and
  // rating_history do not.
  players: {
    userId: string;
    place: number;
    outcome: 'win' | 'loss' | 'draw';
    rating: { rating: number; rd: number; volatility: number } | null;
  }[];
}

export async function finishMatch(matchId: string, result: FinishMatchResult): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      update matches set
        status = ${result.status},
        rated = ${result.rated},
        winner = ${result.winner},
        reason = ${result.reason},
        final_stacks = ${sql.json(jsonb(result.finalStacks))},
        places = ${sql.json(jsonb(result.places))},
        ratings = ${sql.json(jsonb(result.ratings))},
        finished_at = now()
      where id = ${matchId}
    `;
    for (const p of result.players) {
      const winsInc = p.outcome === 'win' ? 1 : 0;
      const lossesInc = p.outcome === 'loss' ? 1 : 0;
      const drawsInc = p.outcome === 'draw' ? 1 : 0;
      await tx`
        update match_players set place = ${p.place}
        where match_id = ${matchId} and user_id = ${p.userId}
      `;

      // Upsert, because a rating row is only created the first time a player
      // finishes a match in that mode.
      if (p.rating) {
        const { rating, rd, volatility } = p.rating;
        // Everyone starts at the default rating, so a first match that went
        // badly peaked at 1500, not at the rating it ended on, and has no
        // peak timestamp because nothing was ever exceeded. Getting this
        // wrong made peak_at depend on whether the row happened to exist
        // already, which is not something a caller can predict. The casts
        // are load-bearing: greatest() over two bare bind parameters gives
        // Postgres nothing to infer a type from and it refuses the statement.
        const start = RATING_DEFAULTS.rating;
        await tx`
          insert into ratings (user_id, mode, rating, rd, volatility, rating_at, peak_rating, peak_at, matches, wins, losses, draws)
          values (
            ${p.userId}, ${result.mode}, ${rating}, ${rd}, ${volatility}, now(),
            greatest(${start}::float8, ${rating}::float8),
            case when ${rating}::float8 > ${start}::float8 then now() else null end,
            1, ${winsInc}, ${lossesInc}, ${drawsInc}
          )
          on conflict (user_id, mode) do update set
            rating = excluded.rating,
            rd = excluded.rd,
            volatility = excluded.volatility,
            rating_at = now(),
            peak_rating = greatest(ratings.peak_rating, excluded.rating),
            peak_at = case when excluded.rating > ratings.peak_rating then now() else ratings.peak_at end,
            matches = ratings.matches + 1,
            wins = ratings.wins + excluded.wins,
            losses = ratings.losses + excluded.losses,
            draws = ratings.draws + excluded.draws
        `;
        await tx`
          insert into rating_history (user_id, match_id, mode, rating, rd)
          values (${p.userId}, ${matchId}, ${result.mode}, ${rating}, ${rd})
        `;
      } else {
        await tx`
          insert into ratings (user_id, mode, matches, wins, losses, draws)
          values (${p.userId}, ${result.mode}, 1, ${winsInc}, ${lossesInc}, ${drawsInc})
          on conflict (user_id, mode) do update set
            matches = ratings.matches + 1,
            wins = ratings.wins + excluded.wins,
            losses = ratings.losses + excluded.losses,
            draws = ratings.draws + excluded.draws
        `;
      }

      // Legacy mirror: the columns on `users` are nothing but a copy of the
      // heads-up row now, kept so anything still reading them sees something
      // sane. Nothing in the server reads them.
      if (result.mode === 'heads-up') {
        await tx`
          update users set
            rating = r.rating,
            rd = r.rd,
            volatility = r.volatility,
            rating_at = r.rating_at,
            peak_rating = r.peak_rating,
            peak_at = r.peak_at,
            matches = r.matches,
            wins = r.wins,
            losses = r.losses,
            draws = r.draws
          from ratings r
          where r.user_id = users.id and r.mode = 'heads-up' and users.id = ${p.userId}
        `;
      }
    }
  });
}

// ---- hands ----

export async function insertHand(hand: {
  id: string;
  matchId: string;
  number: number;
  seedHash: string;
  button: number;
  stacksStart: number[];
  liveSeats: number[];
}): Promise<HandRow> {
  const [row] = await sql<HandRow[]>`
    insert into hands (id, match_id, number, seed_hash, button, stacks_start, live_seats)
    values (${hand.id}, ${hand.matchId}, ${hand.number}, ${hand.seedHash}, ${hand.button}, ${sql.json(jsonb(hand.stacksStart))}, ${hand.liveSeats})
    returning *
  `;
  return row;
}

export async function updateHand(
  id: string,
  patch: Partial<{
    seed: string;
    actions: LoggedAction[];
    board: string[];
    holes: Record<number, [string, string]>;
    result: HandOutcome;
    stats: Record<number, SeatStats>;
    study: Record<number, HandStudy>;
    completedAt: Date;
  }>
): Promise<void> {
  await sql`
    update hands set
      seed = coalesce(${patch.seed ?? null}, seed),
      actions = coalesce(${patch.actions ? sql.json(jsonb(patch.actions)) : null}, actions),
      board = coalesce(${patch.board ?? null}, board),
      holes = coalesce(${patch.holes ? sql.json(jsonb(patch.holes)) : null}, holes),
      result = coalesce(${patch.result ? sql.json(jsonb(patch.result)) : null}, result),
      stats = coalesce(${patch.stats ? sql.json(jsonb(patch.stats)) : null}, stats),
      study = coalesce(${patch.study ? sql.json(jsonb(patch.study)) : null}, study),
      completed_at = coalesce(${patch.completedAt ?? null}, completed_at)
    where id = ${id}
  `;
}

export async function getHandById(id: string): Promise<HandRow | null> {
  const [row] = await sql<HandRow[]>`select * from hands where id = ${id}`;
  return row ?? null;
}

export interface HandSummary {
  number: number;
  completedAt: Date | null;
  seedHash: string;
  seed: string | null;
  board: string[];
  stacksStart: number[];
  liveSeats: number[] | null;
  result: HandOutcome | null;
  study: Record<number, HandStudy> | null;
}

export async function getHandsForMatch(matchId: string): Promise<HandSummary[]> {
  return sql<HandSummary[]>`
    select number, completed_at, seed_hash, seed, board, stacks_start, live_seats, result, study
    from hands
    where match_id = ${matchId}
    order by number asc
  `;
}

// ---- rating history ----

export async function getRatingHistoryForUser(userId: string): Promise<RatingHistoryRow[]> {
  return sql<RatingHistoryRow[]>`
    select * from rating_history where user_id = ${userId} order by at asc
  `;
}

// ---- audit log ----

// Table chat, written as it is said. Nothing reads it back yet: the room
// replays from memory, and this row exists so somebody reported for what they
// said at a table can be looked up later.
export async function insertChatMessage(entry: {
  matchId: string;
  userId: string;
  seat: number | null;
  text: string;
  at: Date;
}): Promise<void> {
  await sql`
    insert into chat (match_id, user_id, seat, text, at)
    values (${entry.matchId}, ${entry.userId}, ${entry.seat}, ${entry.text}, ${entry.at})
  `;
}

export async function insertAuditLog(entry: {
  kind: string;
  userId?: string | null;
  matchId?: string | null;
  detail?: unknown;
  ip?: string | null;
}): Promise<void> {
  await sql`
    insert into audit_log (kind, user_id, match_id, detail, ip)
    values (${entry.kind}, ${entry.userId ?? null}, ${entry.matchId ?? null}, ${sql.json(jsonb(entry.detail ?? {}))}, ${entry.ip ?? null})
  `;
}

// ---- feed ----

// The home feed and the watch list. Both read `matches` directly rather than
// the live rooms, so the two figures on screen come from one source and
// cannot disagree with each other. A match left 'playing' by a dead process
// is aborted at boot (abortStalePlayingMatches), which is what keeps the
// live query honest.

/* Ladder matches are left out by default. They are real rated matches and
   they are readable by their own id, but there are far more of them than
   there are matches somebody played, so a feed that included them would be
   nothing else. The filter is in the query rather than over the results
   because filtering after the limit would return an almost empty page. */
export async function getRecentMatches(limit = 20, includeLadder = false): Promise<MatchRow[]> {
  return sql<MatchRow[]>`
    select * from matches
    where status = 'finished'
    ${includeLadder ? sql`` : sql`and format->>'ladder' is distinct from 'true'`}
    order by finished_at desc
    limit ${limit}
  `;
}

/* How many ladder matches each bot has played, for the round robin (fewest
   played goes next) and for /api/bots. Keyed by user id; a bot that has not
   played one is simply absent. Aborted matches do not count: a match killed
   by a restart moved nobody's rating. */
export async function getLadderMatchCounts(): Promise<Map<string, number>> {
  const rows = await sql<{ userId: string; n: number }[]>`
    select mp.user_id, count(*)::int as n
    from match_players mp
    join matches m on m.id = mp.match_id
    where m.format->>'ladder' = 'true' and m.status <> 'aborted'
    group by mp.user_id
  `;
  return new Map(rows.map((r) => [r.userId, r.n]));
}

/* Candidates for the "from a real hand" puzzle: completed hands from finished,
   rated-or-casual heads-up matches, with the seed and the hole cards published.
   Whether a hand actually holds a preflop decision worth grading is a walk of
   its action log rather than a column, so a shallow random window is drawn here
   and the caller walks it. `order by random()` is a sequential scan and is the
   right shape at this size; it is the first thing to change if the table grows
   past what a scan can carry. */
export async function getPuzzleHandCandidates(limit = 40): Promise<HandRow[]> {
  return sql<HandRow[]>`
    select h.* from hands h
    join matches m on m.id = h.match_id
    where m.status = 'finished'
      and m.format->>'mode' = 'heads-up'
      and coalesce((m.format->>'practice')::boolean, false) = false
      and h.completed_at is not null
      and h.seed is not null
      and h.holes is not null
    order by random()
    limit ${limit}
  `;
}

export async function getLiveMatches(limit = 50): Promise<MatchRow[]> {
  return sql<MatchRow[]>`
    select * from matches
    where status = 'playing'
    order by created_at desc
    limit ${limit}
  `;
}

export interface SiteStats {
  matchesToday: number;
  handsTotal: number;
  playersRegistered: number;
  playersGuest: number;
}

// One round trip for the whole strip: four counts that are always shown
// together and never read apart.
export async function getSiteStats(): Promise<SiteStats> {
  const [row] = await sql<SiteStats[]>`
    select
      (select count(*) from matches
        where status = 'finished' and finished_at >= date_trunc('day', now()))::int as matches_today,
      (select count(*) from hands where completed_at is not null)::int as hands_total,
      (select count(*) from users where bot = false and guest = false)::int as players_registered,
      (select count(*) from users where bot = false and guest = true)::int as players_guest
  `;
  return row;
}

// ---- challenges ----

/* A "play a friend" link. The row is the whole feature: created when someone
   asks for a link, spent when the friend opens it and accepts. `expired` is
   never a stored status, only one derived from `expiresAt` at read time, so
   there is nothing to sweep. */
export interface ChallengeRow {
  id: string;
  creatorId: string;
  mode: Mode;
  rated: boolean;
  status: 'open' | 'accepted' | 'cancelled';
  acceptedBy: string | null;
  matchId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export async function insertChallenge(
  id: string,
  creatorId: string,
  mode: Mode,
  rated: boolean,
  expiresAt: Date
): Promise<ChallengeRow> {
  const [row] = await sql<ChallengeRow[]>`
    insert into challenges (id, creator_id, mode, rated, expires_at)
    values (${id}, ${creatorId}, ${mode}, ${rated}, ${expiresAt})
    returning *
  `;
  return row;
}

export async function getChallengeById(id: string): Promise<ChallengeRow | null> {
  const [row] = await sql<ChallengeRow[]>`select * from challenges where id = ${id}`;
  return row ?? null;
}

// Links still worth counting against the cap: cancelled and accepted ones are
// spent, and an expired one is nobody's open link even though the column
// still says open.
export async function countOpenChallenges(creatorId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from challenges
    where creator_id = ${creatorId} and status = 'open' and expires_at > now()
  `;
  return row.n;
}

/* Claims a link for one accepter and nobody else. The status test is inside
   the update, so two friends opening the same link at the same moment cannot
   both be handed a match: the loser gets null and reads "already taken". */
export async function claimChallenge(id: string, userId: string): Promise<ChallengeRow | null> {
  const [row] = await sql<ChallengeRow[]>`
    update challenges
    set status = 'accepted', accepted_by = ${userId}
    where id = ${id} and status = 'open' and expires_at > now()
    returning *
  `;
  return row ?? null;
}

export async function setChallengeMatch(id: string, matchId: string): Promise<void> {
  await sql`update challenges set match_id = ${matchId} where id = ${id}`;
}

// Puts a claimed link back after the match it was claimed for failed to be
// created, so a database error does not silently eat somebody's link.
export async function releaseChallenge(id: string): Promise<void> {
  await sql`
    update challenges set status = 'open', accepted_by = null
    where id = ${id} and status = 'accepted' and match_id is null
  `;
}

export async function cancelOpenChallenge(id: string, creatorId: string): Promise<ChallengeRow | null> {
  const [row] = await sql<ChallengeRow[]>`
    update challenges set status = 'cancelled'
    where id = ${id} and creator_id = ${creatorId} and status = 'open'
    returning *
  `;
  return row ?? null;
}

// ---- home games ----

/* A home game: the six-max version of a challenge link. The host holds a seat
   like everybody else, so the seat table is the whole guest list and `hostId`
   only says whose table it is. `expired` is derived from `expiresAt` at read
   time and never stored, the same bargain the challenges table makes. */
export interface HomeGameRow {
  id: string;
  hostId: string;
  rated: boolean;
  botLevel: number;
  status: 'open' | 'started' | 'cancelled';
  matchId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface HomeGameSeatRow {
  userId: string;
  name: string;
  joinedAt: Date;
}

export async function insertHomeGame(
  id: string,
  hostId: string,
  rated: boolean,
  botLevel: number,
  expiresAt: Date
): Promise<HomeGameRow> {
  const [row] = await sql<HomeGameRow[]>`
    insert into home_games (id, host_id, rated, bot_level, expires_at)
    values (${id}, ${hostId}, ${rated}, ${botLevel}, ${expiresAt})
    returning *
  `;
  return row;
}

export async function getHomeGameById(id: string): Promise<HomeGameRow | null> {
  const [row] = await sql<HomeGameRow[]>`select * from home_games where id = ${id}`;
  return row ?? null;
}

// Lobbies still worth counting against the host's cap: started and cancelled
// ones are spent, and an expired one is nobody's open table even though the
// column still says open.
export async function countOpenHomeGames(hostId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from home_games
    where host_id = ${hostId} and status = 'open' and expires_at > now()
  `;
  return row.n;
}

// In join order, which is the order the lobby fills its seats in.
export async function getHomeGameSeats(gameId: string): Promise<HomeGameSeatRow[]> {
  return sql<HomeGameSeatRow[]>`
    select s.user_id, u.name, s.joined_at
    from home_game_seats s join users u on u.id = s.user_id
    where s.game_id = ${gameId}
    order by s.joined_at asc
  `;
}

/* Seats somebody, and says whether that seat was free. The capacity test is
   inside the insert, so six people opening the link at the same moment cannot
   all be seated at a table with six chairs: everyone past the sixth gets
   false and reads "this table is full". */
export async function insertHomeGameSeat(gameId: string, userId: string, capacity: number): Promise<boolean> {
  const rows = await sql`
    insert into home_game_seats (game_id, user_id)
    select ${gameId}, ${userId}
    where (select count(*) from home_game_seats where game_id = ${gameId}) < ${capacity}
    on conflict do nothing
    returning user_id
  `;
  return rows.length > 0;
}

export async function deleteHomeGameSeat(gameId: string, userId: string): Promise<void> {
  await sql`delete from home_game_seats where game_id = ${gameId} and user_id = ${userId}`;
}

/* Claims a lobby for the one start that gets to happen. The status test is
   inside the update, so a host double-clicking cannot open two tables. */
export async function claimHomeGame(id: string, hostId: string): Promise<HomeGameRow | null> {
  const [row] = await sql<HomeGameRow[]>`
    update home_games set status = 'started'
    where id = ${id} and host_id = ${hostId} and status = 'open' and expires_at > now()
    returning *
  `;
  return row ?? null;
}

export async function setHomeGameMatch(id: string, matchId: string): Promise<void> {
  await sql`update home_games set match_id = ${matchId} where id = ${id}`;
}

// Puts a claimed lobby back after the match it was claimed for failed to be
// created, so a database error does not silently eat somebody's table.
export async function releaseHomeGame(id: string): Promise<void> {
  await sql`
    update home_games set status = 'open'
    where id = ${id} and status = 'started' and match_id is null
  `;
}

export async function cancelOpenHomeGame(id: string, hostId: string): Promise<HomeGameRow | null> {
  const [row] = await sql<HomeGameRow[]>`
    update home_games set status = 'cancelled'
    where id = ${id} and host_id = ${hostId} and status = 'open'
    returning *
  `;
  return row ?? null;
}

// ---- insights ----

/* The rows behind /api/users/:name/insights. Everything else on a profile is
   a counter the write path already maintained; insights are derived from the
   hands themselves, so this is the one place that pulls a player's whole
   history out at once. Bounded, because it is a request path: a player with
   more hands than this reads their most recent ones, which is the window
   anyone actually means by "how am I playing".
   Matches store their mode inside `format`, and a row written before modes
   existed was heads-up, so the filter coalesces rather than dropping it. */
export const INSIGHT_HAND_LIMIT = 3000;

export async function getInsightHandsForUser(
  userId: string,
  mode: Mode,
  limit = INSIGHT_HAND_LIMIT
): Promise<InsightHand[]> {
  const rows = await sql<
    {
      id: string;
      matchId: string;
      number: number;
      seat: number;
      seed: string;
      button: number;
      stacksStart: number[];
      liveSeats: number[] | null;
      actions: LoggedAction[];
      format: MatchFormat;
      startedAt: Date;
      completedAt: Date | null;
    }[]
  >`
    select
      h.id, h.match_id, h.number, h.seed, h.button, h.stacks_start, h.live_seats,
      h.actions, h.started_at, h.completed_at, mp.seat, m.format
    from hands h
    join matches m on m.id = h.match_id
    join match_players mp on mp.match_id = h.match_id and mp.user_id = ${userId}
    where m.status = 'finished'
      and coalesce(m.format ->> 'mode', 'heads-up') = ${mode}
      and h.completed_at is not null
      and h.seed is not null
    order by h.completed_at desc
    limit ${limit}
  `;
  return rows.map((r) => {
    const { sb, bb } = blindsAt(r.format, r.number);
    return {
      id: r.id,
      matchId: r.matchId,
      number: r.number,
      seat: r.seat,
      seed: r.seed,
      button: r.button,
      sb,
      bb,
      stacksStart: r.stacksStart,
      // A heads-up hand written before the map existed had table seats and
      // engine seats as the same thing, which is what the identity says.
      liveSeats: r.liveSeats ?? r.stacksStart.map((_, i) => i),
      actions: r.actions,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    };
  });
}

/* Win, loss or draw for one player in one finished match. Multiway has no
   draws: anything but first place is a loss.
   getMatchesForUser() decides this inline as well. Fold it onto this once
   the routes it shares a file with have stopped moving. */
export function matchResultForUser(match: MatchRow, userId: string): 'win' | 'loss' | 'draw' {
  if (match.seats.length > 2) return (match.places?.[userId] ?? null) === 1 ? 'win' : 'loss';
  if (match.winner === null) return 'draw';
  return match.winner === userId ? 'win' : 'loss';
}

/* Finished matches in one mode, newest first. The first row is also what the
   insights cache is keyed on: a player's numbers can only change when a new
   match of theirs finishes. */
export async function getInsightMatchesForUser(userId: string, mode: Mode): Promise<InsightMatch[]> {
  const rows = await sql<MatchRow[]>`
    select m.* from matches m
    join match_players mp on mp.match_id = m.id
    where mp.user_id = ${userId}
      and m.status = 'finished'
      and coalesce(m.format ->> 'mode', 'heads-up') = ${mode}
    order by m.finished_at desc
  `;
  return rows.map((m) => ({
    id: m.id,
    result: matchResultForUser(m, userId),
    finishedAt: m.finishedAt,
  }));
}

// ---- explorer ----

/* The rows behind /api/explorer. Every finished hand of one mode, not one
   player's: the opening explorer is the site's book, so there is no user to
   narrow it by. Practice tables are left out because they are unrated
   sandboxes, and ladder tables because nobody played them, which would make
   the book a picture of the bots talking to themselves.

   Read as a window rather than as a whole table. `before` is the settled
   edge (see config.explorerLagMs) and `after` is how far the caller has already
   read, so a warm cache asks only for the hands that arrived since. The limit
   only ever bites on the first read of a process, which is the one that has
   no `after` to start from. */
export const EXPLORER_HAND_LIMIT = 5000;

export interface ExplorerWindow {
  before: Date;
  after?: Date | null;
  limit?: number;
}

export async function getExplorerHands(mode: Mode, window: ExplorerWindow): Promise<ExplorerHand[]> {
  const after = window.after ?? null;
  const rows = await sql<
    {
      matchId: string;
      number: number;
      seed: string;
      button: number;
      stacksStart: number[];
      liveSeats: number[] | null;
      actions: LoggedAction[];
      format: MatchFormat;
      seats: MatchSeat[];
      finishedAt: Date | null;
    }[]
  >`
    select
      h.match_id, h.number, h.seed, h.button, h.stacks_start, h.live_seats, h.actions,
      m.format, m.seats, m.finished_at
    from hands h
    join matches m on m.id = h.match_id
    where m.status = 'finished'
      and coalesce(m.format ->> 'mode', 'heads-up') = ${mode}
      and coalesce((m.format ->> 'practice')::boolean, false) = false
      and coalesce((m.format ->> 'ladder')::boolean, false) = false
      and h.completed_at is not null
      and h.completed_at <= ${window.before}
      and (${after}::timestamptz is null or h.completed_at > ${after})
      and h.seed is not null
    order by h.completed_at desc
    limit ${window.limit ?? EXPLORER_HAND_LIMIT}
  `;
  return rows.map((r) => {
    // A format written before blind levels existed has no `levels` array and
    // never escalated, so its level-1 blinds are its blinds for every hand.
    // blindsAt reads the array without checking, which is a throw on those
    // rows rather than a fallback.
    const { sb, bb } = r.format.levels ? blindsAt(r.format, r.number) : { sb: r.format.sb, bb: r.format.bb };
    // Dense by table seat, so a seat the match never names still reads as a
    // person rather than as a hole in the array.
    const bots: boolean[] = r.stacksStart.map(() => false);
    for (const seat of r.seats) if (seat.seat < bots.length) bots[seat.seat] = seat.bot === true;
    return {
      matchId: r.matchId,
      button: r.button,
      sb,
      bb,
      seed: r.seed,
      stacksStart: r.stacksStart,
      // A heads-up hand written before the map existed had table seats and
      // engine seats as the same thing, which is what the identity says.
      liveSeats: r.liveSeats ?? r.stacksStart.map((_, i) => i),
      actions: r.actions,
      bots,
      finishedAt: r.finishedAt,
    };
  });
}

// ---- arenas ----

/* An arena and the people in it. The board is a set of counters rather than a
   derivation, which is the one place on this site that keeps a running score:
   the streak bonus makes each result depend on the ones before it, so a board
   rebuilt from the matches would have to replay them in order anyway. */

export interface ArenaRow {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  status: 'upcoming' | 'running' | 'finished';
  podium: { uid: string; name: string; score: number; place: number }[] | null;
  createdAt: Date;
}

export interface ArenaPlayerRow {
  arenaId: string;
  userId: string;
  name: string;
  bot: boolean;
  rating: number; // heads-up, filled in by the join below
  joinedAt: Date;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  matches: number;
  paused: boolean;
  place: number | null;
}

/* Creates the arena that starts at this hour, or does nothing because it is
   already there. `starts_at` is unique, so two processes scheduling the same
   hour cannot both win: the second one inserts nothing and reads the first
   one's row. */
export async function ensureArena(id: string, name: string, startsAt: Date, endsAt: Date): Promise<ArenaRow> {
  const [row] = await sql<ArenaRow[]>`
    insert into arenas (id, name, starts_at, ends_at)
    values (${id}, ${name}, ${startsAt}, ${endsAt})
    on conflict (starts_at) do nothing
    returning *
  `;
  if (row) return row;
  const [existing] = await sql<ArenaRow[]>`select * from arenas where starts_at = ${startsAt}`;
  return existing;
}

export async function getArenaById(id: string): Promise<ArenaRow | null> {
  const [row] = await sql<ArenaRow[]>`select * from arenas where id = ${id}`;
  return row ?? null;
}

// Every arena that has not finished, soonest first. Short by construction: the
// scheduler keeps three ahead and closes each one as its clock runs out.
export async function getOpenArenas(): Promise<ArenaRow[]> {
  return sql<ArenaRow[]>`
    select * from arenas where status <> 'finished' order by starts_at asc
  `;
}

export async function getFinishedArenas(limit = 3): Promise<ArenaRow[]> {
  return sql<ArenaRow[]>`
    select * from arenas where status = 'finished' order by ends_at desc limit ${limit}
  `;
}

export async function setArenaStatus(id: string, status: 'running' | 'finished'): Promise<void> {
  await sql`update arenas set status = ${status} where id = ${id}`;
}

/* Closes an arena in one transaction: the places go onto the rows, the podium
   onto the arena, and the status last. Nothing may score after this, which is
   what the caller's status check rests on, so the three writes are one. */
export async function finishArena(
  id: string,
  places: { userId: string; place: number }[],
  podium: ArenaRow['podium']
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const p of places) {
      await tx`
        update arena_players set place = ${p.place}
        where arena_id = ${id} and user_id = ${p.userId}
      `;
    }
    await tx`
      update arenas set status = 'finished', podium = ${sql.json(jsonb(podium))} where id = ${id}
    `;
  });
}

/* The board, already in the order it is read in: score, then wins, then
   rating. The rating is the player's heads-up standing, which is the mode an
   arena is played in, and a player with no row there reads as the 1500
   everyone starts on rather than being left out of the ordering. */
export async function getArenaPlayers(arenaId: string): Promise<ArenaPlayerRow[]> {
  return sql<ArenaPlayerRow[]>`
    select
      ap.arena_id, ap.user_id, u.name, u.bot, ap.joined_at, ap.score, ap.wins,
      ap.losses, ap.draws, ap.streak, ap.matches, ap.paused, ap.place,
      coalesce(r.rating, 1500) as rating
    from arena_players ap
    join users u on u.id = ap.user_id
    left join ratings r on r.user_id = ap.user_id and r.mode = 'heads-up'
    where ap.arena_id = ${arenaId}
    order by ap.score desc, ap.wins desc, coalesce(r.rating, 1500) desc, u.name asc
  `;
}

export async function insertArenaPlayer(arenaId: string, userId: string): Promise<void> {
  await sql`
    insert into arena_players (arena_id, user_id) values (${arenaId}, ${userId})
    on conflict (arena_id, user_id) do update set paused = false
  `;
}

export async function deleteArenaPlayer(arenaId: string, userId: string): Promise<void> {
  await sql`delete from arena_players where arena_id = ${arenaId} and user_id = ${userId}`;
}

export async function setArenaPaused(arenaId: string, userId: string, paused: boolean): Promise<boolean> {
  const rows = await sql`
    update arena_players set paused = ${paused}
    where arena_id = ${arenaId} and user_id = ${userId}
    returning user_id
  `;
  return rows.length > 0;
}

/* One result onto the board. The streak is written rather than incremented so
   the caller, which already worked out what the run was worth, is the only
   thing that decides what a run is: two places computing "consecutive wins"
   is exactly the drift this avoids. */
export async function addArenaResult(
  arenaId: string,
  userId: string,
  result: { points: number; outcome: 'win' | 'loss' | 'draw'; streak: number }
): Promise<void> {
  await sql`
    update arena_players set
      score = score + ${result.points},
      wins = wins + ${result.outcome === 'win' ? 1 : 0},
      losses = losses + ${result.outcome === 'loss' ? 1 : 0},
      draws = draws + ${result.outcome === 'draw' ? 1 : 0},
      streak = ${result.streak},
      matches = matches + 1
    where arena_id = ${arenaId} and user_id = ${userId}
  `;
}

/* What a profile shows: every finished arena this player took part in, newest
   first. `place` is null on a row that somehow escaped the freeze, which the
   profile renders as a dash rather than as a placing nobody earned. */
export interface UserArenaSummary {
  id: string;
  name: string;
  endsAt: Date;
  place: number | null;
  score: number;
  players: number;
}

export async function getArenasForUser(userId: string, limit = 20): Promise<UserArenaSummary[]> {
  return sql<UserArenaSummary[]>`
    select
      a.id, a.name, a.ends_at, ap.place, ap.score,
      (select count(*)::int from arena_players x where x.arena_id = a.id) as players
    from arena_players ap
    join arenas a on a.id = ap.arena_id
    where ap.user_id = ${userId} and a.status = 'finished'
    order by a.ends_at desc
    limit ${limit}
  `;
}

/* Tickets: the annotation layer's rows. `drawing` is a PNG data URL and is the
   only large column here, so a list never selects it: a page of ticket titles
   is a page of ticket titles, not a megabyte of strokes each. */
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

export interface TicketRow {
  id: string;
  createdAt: Date;
  userId: string;
  url: string;
  path: string;
  title: string;
  note: string;
  viewport: TicketViewport;
  targets: TicketTarget[];
  drawing: string | null;
  pageShot: string | null;
  status: string;
  build: string | null;
}

export type TicketListRow = Omit<TicketRow, 'drawing' | 'pageShot'>;

export interface NewTicket {
  id: string;
  userId: string;
  url: string;
  path: string;
  title: string;
  note: string;
  viewport: TicketViewport;
  targets: TicketTarget[];
  drawing: string | null;
  build: string | null;
}

export async function insertTicket(ticket: NewTicket): Promise<TicketRow> {
  const [row] = await sql<TicketRow[]>`
    insert into tickets (id, user_id, url, path, title, note, viewport, targets, drawing, build)
    values (
      ${ticket.id}, ${ticket.userId}, ${ticket.url}, ${ticket.path}, ${ticket.title},
      ${ticket.note}, ${sql.json(jsonb(ticket.viewport))}, ${sql.json(jsonb(ticket.targets))},
      ${ticket.drawing}, ${ticket.build}
    )
    returning *
  `;
  return row;
}

export async function getTickets(status: string | null, limit = 200): Promise<TicketListRow[]> {
  return sql<TicketListRow[]>`
    select id, created_at, user_id, url, path, title, note, viewport, targets, status, build
    from tickets
    ${status ? sql`where status = ${status}` : sql``}
    order by created_at desc
    limit ${limit}
  `;
}

export async function getTicketById(id: string): Promise<TicketRow | null> {
  const [row] = await sql<TicketRow[]>`select * from tickets where id = ${id}`;
  return row ?? null;
}

export async function setTicketStatus(id: string, status: string): Promise<TicketRow | null> {
  const [row] = await sql<TicketRow[]>`
    update tickets set status = ${status} where id = ${id} returning *
  `;
  return row ?? null;
}

export async function deleteTicketsForUser(userId: string): Promise<void> {
  await sql`delete from tickets where user_id = ${userId}`;
}
