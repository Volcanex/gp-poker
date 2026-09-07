import postgres from 'postgres';
import { DEFAULTS as RATING_DEFAULTS } from '@opentable/rating';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { LoggedAction, MatchFormat, MatchResult, Mode } from '@opentable/protocol';
import type { HandOutcome } from '@opentable/engine';
import type { Decision, SeatStats, Summary } from '@opentable/preflop';
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
// real history, no password and never a guest. Created once at boot.
export async function ensureBotUser(name: string): Promise<UserRow> {
  await sql`
    insert into users (name, name_lower, guest, bot)
    values (${name}, ${name.toLowerCase()}, false, true)
    on conflict (name_lower) do nothing
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
