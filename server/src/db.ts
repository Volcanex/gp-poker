import postgres from 'postgres';
import { DEFAULTS as RATING_DEFAULTS } from '@opentable/rating';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { LoggedAction, MatchFormat, MatchResult, Mode, Speed } from '@opentable/protocol';
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
  botLevel: number | null; // 1..7 on a bot, null on a person
  admin: boolean; // the annotation layer and the tickets it writes, nothing else
  // The flag beside their name: lowercase ISO 3166-1 alpha-2, or null for
  // none, which is what everyone starts as. See ./countries.ts.
  country: string | null;
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
  avatarType: string | null; // null while they have no picture
  avatarV: number; // bumped on every change, 0 while they have never had one
  /* Ranked walkouts. The count as it stood at `walkoutAt`, not a running
     total: strikes decay a day at a time and the decay is applied on read
     (`walkoutStrikesNow`), so nothing sweeps these. See ../walkouts.ts. */
  walkoutStrikes: number;
  walkoutAt: Date | null;
  rankedBanUntil: Date | null;
  /* The Google account this one signs in with, as Google's stable subject id,
     or null for everybody who has never used it. The email is deliberately
     not kept: see the column comment in ../db/schema.sql. */
  googleSub: string | null;
}

/* Every column of `users` except the picture itself, which is the one column
   nothing but `/api/avatars/:id` ever wants. `select *` would put up to 128 KB
   of image bytes on the wire for every session lookup, and a session lookup
   runs on every request. The list is beside `UserRow` because a new column has
   to be added to both anyway, so the two cannot drift apart quietly. */
const USER_COLS = sql`
  id, name, name_lower, password_hash, guest, bot, bot_level, created_at,
  last_seen_at, rating, rd, volatility, rating_at, peak_rating, peak_at,
  matches, wins, losses, draws, admin, avatar_type, avatar_v, country,
  walkout_strikes, walkout_at, ranked_ban_until, google_sub
`;

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

/* Where one player sits among everybody else in a mode. `population` is the
   field this is measured against, `rank` is their 1-based place in it counting
   from the top, and `percentile` is the share of that field rated strictly
   below them, 0 to 100. */
export interface ModeStanding {
  mode: Mode;
  rank: number;
  population: number;
  percentile: number;
}

/* The field a percentile is a share of: every non-bot with at least one rated
   match in that mode. Two exclusions, both deliberate. Bots are users and hold
   ratings the ladder keeps moving, so counting them would make a person's place
   depend on how many robots the box happens to run. And a row with no rated
   match behind it is a default 1500 nobody earned, which would stack a crowd of
   ghosts in the middle of the board and push every real player outwards.

   Unlike the leaderboard this does **not** drop provisional players (rd > 110):
   somebody four matches in is still somebody you are ahead of or behind, and
   leaving them out would make the population shrink as the site got busier.

   Ranks are `rank()`, not `row_number()`, so players on the same rating share a
   place. Counting from the bottom gives the number strictly below for free:
   ties share the lower rank, so `from_bottom - 1` is exactly that count. */
export async function getModeStandings(userId: string): Promise<ModeStanding[]> {
  const rows = await sql<{ mode: Mode; rank: number; fromBottom: number; population: number }[]>`
    with rated as (
      select r.user_id, r.mode, r.rating
      from ratings r
      join users u on u.id = r.user_id
      where u.bot = false and r.matches > 0
    ),
    placed as (
      select
        user_id,
        mode,
        rank() over (partition by mode order by rating desc)::int as rank,
        rank() over (partition by mode order by rating asc)::int as from_bottom,
        count(*) over (partition by mode)::int as population
      from rated
    )
    select mode, rank, from_bottom, population from placed where user_id = ${userId}
  `;
  return rows.map((r) => ({
    mode: r.mode,
    rank: r.rank,
    population: r.population,
    percentile: round1(((r.fromBottom - 1) / r.population) * 100),
  }));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
  /* Whether this seat was a guest when the table was made. Snapshotted like
     the name beside it, and absent on every match stored before friends
     existed, which is why nothing reads it as a boolean: a result panel
     offers to add a friend only for a seat that says `false`, since a name
     that might belong to a browser somebody has closed is not somebody to
     offer. */
  guest?: boolean;
  /* Picture version at the moment the table was made, 0 for none. Stored with
     the seat like the name and the rating are, so a finished match reads back
     as it looked, and absent on a match played before pictures existed. */
  avatarV?: number;
  // Snapshotted with the name and the rating when the match is created, and
  // left off the row entirely when the player has no flag, so a match stored
  // before countries existed reads the same way as one played by somebody who
  // never set one.
  country?: string;
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
  // The blinds this hand was dealt at. Null on every hand written before the
  // column existed; read them through `handBlinds`, never straight off here.
  sb: number | null;
  bb: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

/* The blinds a stored hand was dealt at. The row records them now, because a
   short format climbs its schedule on elapsed match time and nothing reading
   the row afterwards knows how long the match had been running. A row written
   before the column existed has none, and every one of those belongs to a
   format whose level is a function of the hand number alone, so recomputing
   it is exactly right for them and only for them. */
export function handBlinds(
  hand: { number: number; sb?: number | null; bb?: number | null },
  format: MatchFormat
): { sb: number; bb: number } {
  if (typeof hand.sb === 'number' && typeof hand.bb === 'number') return { sb: hand.sb, bb: hand.bb };
  // A format written before blind levels existed has no `levels` array at all
  // and never escalated, so its level-1 blinds are its blinds for every hand.
  if (!format.levels) return { sb: format.sb, bb: format.bb };
  return blindsAt(format, hand.number);
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
    returning ${USER_COLS}
  `;
  return row;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`select ${USER_COLS} from users where id = ${id}`;
  return row ?? null;
}

export async function getUserByNameLower(nameLower: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`select ${USER_COLS} from users where name_lower = ${nameLower}`;
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
    returning ${USER_COLS}
  `;
  return row ?? null;
}

export async function getUserByGoogleSub(sub: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`select ${USER_COLS} from users where google_sub = ${sub}`;
  return row ?? null;
}

/* Claiming with Google. The same update `claimGuestUser` makes, minus the two
   things Google does not give us: the name stays the generated one the guest
   has been playing under, and there is no password, so this account signs in
   with Google and only with Google. `guest = true` in the where clause is what
   keeps a second call from re-claiming an account that is already somebody's,
   exactly as it does for the password path. */
export async function claimGuestWithGoogle(id: string, sub: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`
    update users
    set google_sub = ${sub}, guest = false
    where id = ${id} and guest = true
    returning ${USER_COLS}
  `;
  return row ?? null;
}

/* Adding Google to an account that already exists: someone who claimed with a
   name and a password and now wants the button as well. `google_sub is null`
   is the guard that makes it additive - an account already linked to some
   other Google identity is left exactly as it is, and the caller reads the
   null as a refusal rather than overwriting a link somebody relies on. A sub
   already spent on another account fails on the unique index instead, which
   is the case the caller has to tell apart. */
export async function linkGoogleToUser(id: string, sub: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`
    update users
    set google_sub = ${sub}
    where id = ${id} and google_sub is null
    returning ${USER_COLS}
  `;
  return row ?? null;
}

/* Sets or clears the flag beside a player's name. Guests included: a guest
   plays here like anybody else, and the flag belongs to the seat rather than
   to the account. The code is validated against ./countries.ts before it
   reaches this, so anything arriving here is already a country or null. */
export async function updateUserCountry(id: string, country: string | null): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`
    update users set country = ${country} where id = ${id} returning *
  `;
  return row ?? null;
}

/* Renaming, for a guest or a claimed account alike: the name belongs to the
   player, not to the act of claiming. Format and uniqueness are the caller's
   job (./auth.ts's validateName, ./routes.ts checking name_lower first) —
   this is the write, and the unique index on name_lower is what actually
   guarantees it against a race the pre-check missed. */
export async function updateUserName(id: string, name: string): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`
    update users set name = ${name}, name_lower = ${name.toLowerCase()}
    where id = ${id}
    returning ${USER_COLS}
  `;
  return row ?? null;
}

/* Record a walkout. The count and the moment it was written are set
   together, because the pair is what the decay is computed from: writing a
   count without its timestamp would leave a strike that never expires.

   `until` is what the ladder charged, already worked out by the caller
   (../walkouts.ts) from the decayed count, so this is a write and not a
   policy. Returned so the caller can tell the player what it cost. */
export async function recordWalkout(
  id: string,
  strikes: number,
  at: Date,
  until: Date | null
): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`
    update users
       set walkout_strikes = ${strikes},
           walkout_at = ${at},
           ranked_ban_until = ${until}
     where id = ${id}
    returning ${USER_COLS}
  `;
  return row ?? null;
}

// Bot accounts are ordinary users with bot = true: real names, real ratings,
// real history, no password and never a guest. Created once at boot. The level
// is re-asserted on every boot rather than only at creation, so the roster in
// code stays the source of truth for who plays how.
// `country` and `createdAt` only ever take on their given value at
// insertion: a bot already on the roster keeps the country and join date it
// was created with, the same way a real account would, and only its level
// (which is a property of the code, not the account) is re-asserted every
// boot.
export async function ensureBotUser(
  name: string,
  level: number,
  country: string | null = null,
  createdAt: Date = new Date()
): Promise<UserRow> {
  await sql`
    insert into users (name, name_lower, guest, bot, bot_level, country, created_at)
    values (${name}, ${name.toLowerCase()}, false, true, ${level}, ${country}, ${createdAt})
    on conflict (name_lower) do nothing
  `;
  await sql`
    update users set bot_level = ${level}
    where name_lower = ${name.toLowerCase()} and bot = true and bot_level is distinct from ${level}
  `;
  // Backfills the fifteen bots the CamelCase-to-realistic rename (see
  // `migrateBotNamesToRealistic`) carried a null country into: that
  // migration only ever touched name/name_lower, so ensureBots's own call
  // here is the one place left that knows the roster's country for them.
  // Never overwrites a country already set, in case a real user's row ever
  // reached this function with bot backfilled onto it.
  if (country) {
    await sql`
      update users set country = ${country}
      where name_lower = ${name.toLowerCase()} and bot = true and country is null
    `;
  }
  const [row] = await sql<UserRow[]>`select ${USER_COLS} from users where name_lower = ${name.toLowerCase()}`;
  return row;
}

export async function getBotUsers(): Promise<UserRow[]> {
  return sql<UserRow[]>`select ${USER_COLS} from users where bot = true order by name_lower asc`;
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
    const legacy = await tx<{ id: string }[]>`
      select id from users where bot = true and name_lower like 'bot-%' order by name_lower asc
    `;
    for (let i = 0; i < legacy.length && i < names.length; i++) {
      await tx`
        update users set name = ${names[i]}, name_lower = ${names[i].toLowerCase()}
        where id = ${legacy[i].id}
      `;
    }
  });
}

// Same shape, one migration later: the fifteen bots the CamelCase generator
// named (`RedTiger`, `SlyRunningFox`, ...) get renamed onto the population's
// realistic handles, positional by roster index rather than by matching a
// name pattern, since a CamelCase name gives no hint that it used to be a
// bot's name and nothing else. Idempotent for the same reason the migration
// above is: a row already renamed no longer matches `oldNames[i]`, so a
// second run does nothing.
const POPULATION_NAME_MIGRATION_LOCK_KEY = 727102;

export async function migrateBotNamesToRealistic(oldNames: string[], newNames: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${POPULATION_NAME_MIGRATION_LOCK_KEY})`;
    for (let i = 0; i < oldNames.length && i < newNames.length; i++) {
      if (oldNames[i].toLowerCase() === newNames[i].toLowerCase()) continue;
      await tx`
        update users set name = ${newNames[i]}, name_lower = ${newNames[i].toLowerCase()}
        where bot = true and name_lower = ${oldNames[i].toLowerCase()}
      `;
    }
  });
}

export async function touchLastSeen(id: string): Promise<void> {
  await sql`update users set last_seen_at = now() where id = ${id}`;
}

// ---- profile pictures ----

/* The one query that reads the bytes. Everything else about a user goes
   through USER_COLS, which leaves the picture behind on purpose. */
export interface AvatarRow {
  avatar: Buffer;
  avatarType: string;
  avatarV: number;
}

export async function getUserAvatar(id: string): Promise<AvatarRow | null> {
  const [row] = await sql<AvatarRow[]>`
    select avatar, avatar_type, avatar_v from users
    where id = ${id} and avatar is not null and avatar_type is not null
  `;
  return row ?? null;
}

/* Stores a picture and returns the version it now has. The bump is part of the
   same statement as the write, so a version can never be handed out for bytes
   that are not there yet. */
export async function setUserAvatar(id: string, bytes: Buffer, type: string): Promise<number | null> {
  const [row] = await sql<{ avatarV: number }[]>`
    update users
    set avatar = ${bytes}, avatar_type = ${type}, avatar_v = avatar_v + 1
    where id = ${id}
    returning avatar_v
  `;
  return row ? row.avatarV : null;
}

/* Removing a picture bumps the version too: a page holding the old URL is
   holding an immutable answer, so the only way to tell it the picture has gone
   is to give it a different number to ask about. Removing a picture nobody had
   changes nothing and reports the version that already stood. */
export async function clearUserAvatar(id: string): Promise<number | null> {
  const [row] = await sql<{ avatarV: number }[]>`
    update users
    set avatar = null, avatar_type = null, avatar_v = avatar_v + 1
    where id = ${id} and avatar is not null
    returning avatar_v
  `;
  if (row) return row.avatarV;
  const [current] = await sql<{ avatarV: number }[]>`select avatar_v from users where id = ${id}`;
  return current ? current.avatarV : null;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  rating: number;
  rd: number;
  matches: number;
  wins: number;
  peakRating: number;
  avatarV: number;
  country: string | null;
}

// `includeBots` is `config.populationPublic`: off, this is exactly the human
// leaderboard it always was; on, the population's own results are real rated
// results and belong beside everyone else's.
export async function getLeaderboard(mode: Mode, limit = 100, includeBots = false): Promise<LeaderboardRow[]> {
  // 110 mirrors @opentable/rating's isProvisional threshold (see userView.ts);
  // it's duplicated here only because SQL can't call into that package.
  return sql<LeaderboardRow[]>`
    select u.id, u.name, u.country, r.rating, r.rd, r.matches, r.wins, r.peak_rating, u.avatar_v
    from ratings r
    join users u on u.id = r.user_id
    where r.mode = ${mode} and r.rd <= 110 ${includeBots ? sql`` : sql`and u.bot = false`}
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
    select ${USER_COLS} from users
    where id = (
      select user_id from sessions where token = ${token} and expires_at > now()
    )
  `;
  return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await sql`delete from sessions where token = ${token}`;
}

// ---- oauth states ----

export interface OauthStateRow {
  state: string;
  codeVerifier: string;
  nonce: string;
  sessionToken: string;
  redirectTo: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function insertOauthState(row: {
  state: string;
  codeVerifier: string;
  nonce: string;
  sessionToken: string;
  redirectTo: string;
  expiresAt: Date;
}): Promise<void> {
  await sql`
    insert into oauth_states (state, code_verifier, nonce, session_token, redirect_to, expires_at)
    values (${row.state}, ${row.codeVerifier}, ${row.nonce}, ${row.sessionToken}, ${row.redirectTo}, ${row.expiresAt})
  `;
}

/* Reading a state spends it: the delete and the read are one statement, so two
   callbacks racing on the same `state` cannot both come back with a row, and a
   replayed callback finds nothing however quickly it follows the first. The
   row is returned even when it has expired, because the caller has to tell a
   state that timed out from one that was never issued only in its own head:
   both answer the browser the same way. */
export async function takeOauthState(state: string): Promise<OauthStateRow | null> {
  const [row] = await sql<OauthStateRow[]>`
    delete from oauth_states where state = ${state} returning *
  `;
  return row ?? null;
}

// Nothing sweeps these on a timer: a start spends the cost of clearing
// whatever the last ten minutes left behind, which for a site this size is
// always none or nearly none.
export async function deleteExpiredOauthStates(): Promise<void> {
  await sql`delete from oauth_states where expires_at < now()`;
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
  opponentAvatarV: number; // their picture as the match stored it, 0 for none
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
      opponentAvatarV: opponentSeat?.avatarV ?? 0,
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

/* How many unrated matches this player has finished: casual, practice and a
   casual home game all count, because all three are somewhere to learn the
   controls without a rating moving. This is the ranked gate's whole question
   (`RANKED_GATE_MATCHES` in the protocol), asked at the moment somebody
   queues rated, which happens once a search rather than once a request.

   Counted off the match rows rather than kept as a column: a counter would
   be a second copy of something `matches` already knows, and the answer stops
   mattering the moment it is one. */
export async function countUnratedFinished(userId: string, limit = 4): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    select m.id
    from match_players mp
    join matches m on m.id = mp.match_id
    where mp.user_id = ${userId}
      and m.status = 'finished'
      and m.rated = false
    limit ${limit}
  `;
  return rows.length;
}

export async function insertHand(hand: {
  id: string;
  matchId: string;
  number: number;
  seedHash: string;
  button: number;
  stacksStart: number[];
  liveSeats: number[];
  sb: number;
  bb: number;
}): Promise<HandRow> {
  const [row] = await sql<HandRow[]>`
    insert into hands (id, match_id, number, seed_hash, button, stacks_start, live_seats, sb, bb)
    values (${hand.id}, ${hand.matchId}, ${hand.number}, ${hand.seedHash}, ${hand.button}, ${sql.json(jsonb(hand.stacksStart))}, ${hand.liveSeats}, ${hand.sb}, ${hand.bb})
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

// The full rows for one match, actions included: what the match review needs
// to fold every seat's hands through the engine the way insights.ts does.
// getHandsForMatch leaves actions out because the ordinary match page never
// reads them; this is the one caller that does.
export async function getHandRowsForMatch(matchId: string): Promise<HandRow[]> {
  return sql<HandRow[]>`select * from hands where match_id = ${matchId} order by number asc`;
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
  /* Null on every link made before speed reached this table, which means the
     same thing a stored format with no speed does. Read it through
     `speedOf`-style defaulting at the boundary, never off the row. */
  speed: Speed | null;
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
  speed: Speed,
  expiresAt: Date
): Promise<ChallengeRow> {
  const [row] = await sql<ChallengeRow[]>`
    insert into challenges (id, creator_id, mode, rated, speed, expires_at)
    values (${id}, ${creatorId}, ${mode}, ${rated}, ${speed}, ${expiresAt})
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
  avatarV: number;
  country: string | null;
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
    select s.user_id, u.name, u.avatar_v, u.country, s.joined_at
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

// ---- friends ----

/* One friendship, and which way round it was asked. `requesterId` asked;
   while the status is pending, `addresseeId` has yet to answer. A decline, a
   cancel and an unfriend all delete the row rather than writing a third
   status: see ../db/schema.sql for why none of them is a state to keep. */
export interface FriendshipRow {
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted';
  createdAt: Date;
  respondedAt: Date | null;
}

/* An edge as the person at one end of it sees it: the row, plus who the other
   person is. One query answers the friends list, the requests in and the
   requests out, because all three are the same table read from the same end
   and only the status and the direction tell them apart. */
export interface FriendEdgeRow extends FriendshipRow {
  otherId: string;
  name: string;
  guest: boolean;
  bot: boolean;
  country: string | null;
  avatarV: number;
  lastSeenAt: Date;
}

export async function getFriendEdges(userId: string): Promise<FriendEdgeRow[]> {
  return sql<FriendEdgeRow[]>`
    select f.requester_id, f.addressee_id, f.status, f.created_at, f.responded_at,
           u.id as other_id, u.name, u.guest, u.bot, u.country, u.avatar_v, u.last_seen_at
    from friendships f
    join users u
      on u.id = case when f.requester_id = ${userId} then f.addressee_id else f.requester_id end
    where f.requester_id = ${userId} or f.addressee_id = ${userId}
    order by u.name asc
  `;
}

// The pair in either direction, which is the only way to ask about one: the
// unique index on the unordered pair means at most one row can come back.
export async function getFriendship(a: string, b: string): Promise<FriendshipRow | null> {
  const [row] = await sql<FriendshipRow[]>`
    select * from friendships
    where (requester_id = ${a} and addressee_id = ${b})
       or (requester_id = ${b} and addressee_id = ${a})
  `;
  return row ?? null;
}

export async function countFriends(userId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from friendships
    where status = 'accepted' and (requester_id = ${userId} or addressee_id = ${userId})
  `;
  return row.n;
}

// Requests this person has out and nobody has answered. The cap is about
// somebody spraying requests at a list of names, so it counts only the ones
// still waiting.
export async function countOutgoingRequests(userId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from friendships
    where requester_id = ${userId} and status = 'pending'
  `;
  return row.n;
}

/* Asks. Null when the edge already exists, which the unique index on the
   unordered pair is what decides: two people pressing Add on each other at
   the same moment is one row and one loser, and the loser reads the row that
   won and accepts it instead. */
export async function insertFriendRequest(requesterId: string, addresseeId: string): Promise<FriendshipRow | null> {
  const rows = await sql<FriendshipRow[]>`
    insert into friendships (requester_id, addressee_id)
    values (${requesterId}, ${addresseeId})
    on conflict do nothing
    returning *
  `;
  return rows[0] ?? null;
}

/* Answers yes. The direction is in the where clause, so the person who asked
   cannot accept their own request, and the status test is there too, so
   accepting twice is the second one answering null. */
export async function acceptFriendRequest(requesterId: string, addresseeId: string): Promise<FriendshipRow | null> {
  const [row] = await sql<FriendshipRow[]>`
    update friendships set status = 'accepted', responded_at = now()
    where requester_id = ${requesterId} and addressee_id = ${addresseeId} and status = 'pending'
    returning *
  `;
  return row ?? null;
}

// Declining, cancelling and unfriending are one statement: the row goes, and
// which of the three it was is a thing only the caller and the row's status
// knew. Answers the row it deleted so the caller can say who to tell.
export async function deleteFriendship(a: string, b: string): Promise<FriendshipRow | null> {
  const [row] = await sql<FriendshipRow[]>`
    delete from friendships
    where (requester_id = ${a} and addressee_id = ${b})
       or (requester_id = ${b} and addressee_id = ${a})
    returning *
  `;
  return row ?? null;
}

// Who to tell when this person arrives, goes, or changes something about the
// graph. Accepted edges only: a pending request is not somebody who should be
// told when you come online.
export async function getAcceptedFriendIds(userId: string): Promise<string[]> {
  const rows = await sql<{ otherId: string }[]>`
    select case when requester_id = ${userId} then addressee_id else requester_id end as other_id
    from friendships
    where status = 'accepted' and (requester_id = ${userId} or addressee_id = ${userId})
  `;
  return rows.map((r) => r.otherId);
}

/* Every mode of several players at once, defaults filled in for the ones
   never played, so a friends list can name each person's own main mode
   without a query per friend. `getRatingsForUsers` is the same thing for one
   known mode; this is the shape `mainMode` needs. */
export async function getRatingsForUsersByMode(userIds: string[]): Promise<Map<string, Record<Mode, RatingRow>>> {
  const out = new Map<string, Record<Mode, RatingRow>>();
  if (userIds.length === 0) return out;
  const rows = await sql<RatingRow[]>`select * from ratings where user_id in ${sql(userIds)}`;
  for (const id of userIds) {
    const mine = {} as Record<Mode, RatingRow>;
    for (const mode of MODES) {
      mine[mode] = rows.find((r) => r.userId === id && r.mode === mode) ?? defaultRating(id, mode);
    }
    out.set(id, mine);
  }
  return out;
}

/* Who this player has actually sat down with, newest first. This is where
   friends come from on a poker site: the list is people, not accounts, so
   bots are out and so are guests, whose names are generated and who cannot
   be friends anyway. Distinct by person rather than by match, ordered by the
   most recent table they shared. */
export interface PlayedOpponentRow {
  id: string;
  name: string;
  country: string | null;
  avatarV: number;
  lastPlayedAt: Date;
}

export async function getPlayedOpponents(userId: string, limit = 20): Promise<PlayedOpponentRow[]> {
  return sql<PlayedOpponentRow[]>`
    select u.id, u.name, u.country, u.avatar_v, max(m.created_at) as last_played_at
    from match_players mine
    join match_players theirs
      on theirs.match_id = mine.match_id and theirs.user_id <> mine.user_id
    join matches m on m.id = mine.match_id
    join users u on u.id = theirs.user_id
    where mine.user_id = ${userId} and u.bot = false and u.guest = false
    group by u.id, u.name, u.country, u.avatar_v
    order by max(m.created_at) desc
    limit ${limit}
  `;
}

/* An invite: a link, and who it is for. The row carries no state about the
   game, so nothing here can disagree with the link it points at. */
export interface FriendInviteRow {
  toId: string;
  fromId: string;
  kind: 'challenge' | 'home';
  linkId: string;
  createdAt: Date;
}

export async function insertFriendInvite(
  toId: string,
  fromId: string,
  kind: 'challenge' | 'home',
  linkId: string
): Promise<void> {
  await sql`
    insert into friend_invites (to_id, from_id, kind, link_id)
    values (${toId}, ${fromId}, ${kind}, ${linkId})
    on conflict (to_id, kind, link_id) do nothing
  `;
}

/* Invites waiting for this person, with the link's own state beside each one,
   because whether an invite is worth anything is the link's answer and never
   a column here. An invite whose link has gone comes back with nulls and
   reads as spent. */
export interface FriendInviteWithLink extends FriendInviteRow {
  linkStatus: string | null;
  linkExpiresAt: Date | null;
  matchId: string | null;
}

export async function getFriendInvitesFor(userId: string): Promise<FriendInviteWithLink[]> {
  return sql<FriendInviteWithLink[]>`
    select i.to_id, i.from_id, i.kind, i.link_id, i.created_at,
           c.status as link_status, c.expires_at as link_expires_at, c.match_id
    from friend_invites i
    left join challenges c on c.id = i.link_id
    where i.to_id = ${userId} and i.kind = 'challenge'
    union all
    select i.to_id, i.from_id, i.kind, i.link_id, i.created_at,
           g.status as link_status, g.expires_at as link_expires_at, g.match_id
    from friend_invites i
    left join home_games g on g.id = i.link_id
    where i.to_id = ${userId} and i.kind = 'home'
    order by created_at desc
  `;
}

// Unfriending takes the invites between the two with it: an invite from
// somebody who is no longer a friend is a table nobody should still be
// offered, and it would otherwise sit in the list until its link expired.
export async function deleteFriendInvitesBetween(a: string, b: string): Promise<void> {
  await sql`
    delete from friend_invites
    where (to_id = ${a} and from_id = ${b}) or (to_id = ${b} and from_id = ${a})
  `;
}

// The lobby an invite reuses rather than opening a fourth one: a host who
// invites three friends in a row is gathering one table, not three.
export async function getOpenHomeGameForHost(hostId: string): Promise<HomeGameRow | null> {
  const [row] = await sql<HomeGameRow[]>`
    select * from home_games
    where host_id = ${hostId} and status = 'open' and expires_at > now()
    order by created_at desc
    limit 1
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
      sb: number | null;
      bb: number | null;
      format: MatchFormat;
      startedAt: Date;
      completedAt: Date | null;
    }[]
  >`
    select
      h.id, h.match_id, h.number, h.seed, h.button, h.stacks_start, h.live_seats,
      h.actions, h.sb, h.bb, h.started_at, h.completed_at, mp.seat, m.format
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
    const { sb, bb } = handBlinds(r, r.format);
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
      sb: number | null;
      bb: number | null;
      format: MatchFormat;
      seats: MatchSeat[];
      finishedAt: Date | null;
    }[]
  >`
    select
      h.match_id, h.number, h.seed, h.button, h.stacks_start, h.live_seats, h.actions, h.sb, h.bb,
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
    const { sb, bb } = handBlinds(r, r.format);
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
  podium: { uid: string; avatarV?: number; name: string; score: number; place: number }[] | null;
  createdAt: Date;
}

export interface ArenaPlayerRow {
  arenaId: string;
  userId: string;
  name: string;
  bot: boolean;
  avatarV: number;
  country: string | null;
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
      ap.arena_id, ap.user_id, u.name, u.bot, u.avatar_v, u.country, ap.joined_at, ap.score,
      ap.wins, ap.losses, ap.draws, ap.streak, ap.matches, ap.paused, ap.place,
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

// ---- tournaments ----

/* A tournament, its field and its tables. Unlike the arena's board none of
   this is a running total: a tournament's state is which tables have been
   played and who came through them, so every row here is a record of
   something that happened rather than a counter something adds to. */

export interface TournamentRow {
  id: string;
  kind: string;
  shape: 'bracket' | 'shootout';
  mode: Mode;
  name: string;
  seats: number;
  startsAt: Date;
  status: 'upcoming' | 'running' | 'finished' | 'cancelled';
  round: number;
  podium: { uid: string; avatarV?: number; name: string; place: number }[] | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface TournamentPlayerRow {
  tournamentId: string;
  userId: string;
  name: string;
  bot: boolean;
  avatarV: number;
  country: string | null;
  registeredAt: Date;
  seed: number | null;
  /* Frozen at the start. Before then there is nothing stored, so the join
     below reports their live standing in the tournament's mode instead, which
     is what an entrant list before the start should show. */
  rating: number;
  place: number | null;
  outRound: number | null;
  withdrawn: boolean;
}

export interface TournamentTableRow {
  tournamentId: string;
  round: number;
  tableNo: number;
  matchId: string | null;
  status: 'pending' | 'playing' | 'done';
  bye: boolean;
  seats: string[];
  places: Record<string, number> | null;
  advanced: string[] | null;
}

/* Creates a fixture's next row, or does nothing because it is already there.
   `(kind, starts_at)` is unique, so two processes stocking the same schedule
   produce one tournament, the way `arenas.starts_at` does. */
export async function ensureTournament(t: {
  id: string;
  kind: string;
  shape: string;
  mode: Mode;
  name: string;
  seats: number;
  startsAt: Date;
}): Promise<TournamentRow> {
  const [row] = await sql<TournamentRow[]>`
    insert into tournaments (id, kind, shape, mode, name, seats, starts_at)
    values (${t.id}, ${t.kind}, ${t.shape}, ${t.mode}, ${t.name}, ${t.seats}, ${t.startsAt})
    on conflict (kind, starts_at) do nothing
    returning *
  `;
  if (row) return row;
  const [existing] = await sql<TournamentRow[]>`
    select * from tournaments where kind = ${t.kind} and starts_at = ${t.startsAt}
  `;
  return existing;
}

export async function getTournamentById(id: string): Promise<TournamentRow | null> {
  const [row] = await sql<TournamentRow[]>`select * from tournaments where id = ${id}`;
  return row ?? null;
}

// Everything not yet settled, soonest first. Short by construction: one
// upcoming per fixture plus whatever is running.
export async function getOpenTournaments(): Promise<TournamentRow[]> {
  return sql<TournamentRow[]>`
    select * from tournaments
    where status in ('upcoming', 'running')
    order by starts_at asc
  `;
}

export async function getUpcomingTournament(kind: string): Promise<TournamentRow | null> {
  const [row] = await sql<TournamentRow[]>`
    select * from tournaments
    where kind = ${kind} and status = 'upcoming'
    order by starts_at asc limit 1
  `;
  return row ?? null;
}

/* The results list, paged. Cancelled ones are in it: a fixture nobody turned
   up to is part of the record, and hiding it would make the calendar look like
   it skipped a day. */
export async function getSettledTournaments(limit = 10, offset = 0): Promise<TournamentRow[]> {
  return sql<TournamentRow[]>`
    select * from tournaments
    where status in ('finished', 'cancelled')
    order by starts_at desc
    limit ${limit} offset ${offset}
  `;
}

export async function countSettledTournaments(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from tournaments where status in ('finished', 'cancelled')
  `;
  return row?.n ?? 0;
}

export async function setTournamentStatus(
  id: string,
  status: 'running' | 'finished' | 'cancelled',
  round?: number
): Promise<void> {
  if (round === undefined) {
    await sql`update tournaments set status = ${status} where id = ${id}`;
    return;
  }
  await sql`update tournaments set status = ${status}, round = ${round} where id = ${id}`;
}

export async function setTournamentRound(id: string, round: number): Promise<void> {
  await sql`update tournaments set round = ${round} where id = ${id}`;
}

/* Closes a tournament in one transaction: every place onto its player row, the
   podium and the status onto the tournament. One write, for the reason
   `finishArena` is one: nothing may settle a table afterwards, and the status
   is what says so. */
export async function finishTournament(
  id: string,
  places: { userId: string; place: number }[],
  podium: TournamentRow['podium']
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const p of places) {
      await tx`
        update tournament_players set place = ${p.place}
        where tournament_id = ${id} and user_id = ${p.userId}
      `;
    }
    await tx`
      update tournaments
      set status = 'finished', podium = ${sql.json(jsonb(podium))}, finished_at = now()
      where id = ${id}
    `;
  });
}

/* The field. Ordered by seed once there is one, and by rating before then,
   which is the order the entrant list is read in and the order the seeding
   itself is computed from. `rating` is the frozen one where it exists and the
   player's live standing in the tournament's mode where it does not. */
export async function getTournamentPlayers(tournamentId: string): Promise<TournamentPlayerRow[]> {
  return sql<TournamentPlayerRow[]>`
    select
      tp.tournament_id, tp.user_id, u.name, u.bot, u.avatar_v, u.country,
      tp.registered_at, tp.seed, tp.place, tp.out_round, tp.withdrawn,
      coalesce(tp.rating, r.rating, 1500) as rating
    from tournament_players tp
    join tournaments t on t.id = tp.tournament_id
    join users u on u.id = tp.user_id
    left join ratings r on r.user_id = tp.user_id and r.mode = t.mode
    where tp.tournament_id = ${tournamentId}
    order by tp.seed asc nulls last, coalesce(tp.rating, r.rating, 1500) desc, tp.registered_at asc
  `;
}

/* One registration, with the seat cap tested inside the insert. Answers false
   when the field is already full, so thirty-two people opening the page at
   once cannot all take the last seat: the same bargain the home game's
   seating insert makes, and for the same reason. */
export async function insertTournamentPlayer(
  tournamentId: string,
  userId: string,
  cap: number
): Promise<boolean> {
  const rows = await sql`
    insert into tournament_players (tournament_id, user_id)
    select ${tournamentId}::text, ${userId}::uuid
    where (select count(*) from tournament_players where tournament_id = ${tournamentId}) < ${cap}
    on conflict (tournament_id, user_id) do nothing
    returning user_id
  `;
  return rows.length > 0;
}

export async function isTournamentPlayer(tournamentId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    select 1 from tournament_players where tournament_id = ${tournamentId} and user_id = ${userId}
  `;
  return rows.length > 0;
}

export async function deleteTournamentPlayer(tournamentId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    delete from tournament_players
    where tournament_id = ${tournamentId} and user_id = ${userId}
    returning user_id
  `;
  return rows.length > 0;
}

/* Out of a tournament they were already in: silence or a decline at a round's
   ready check. The row stays, because they still have a place coming to them,
   and `out_round` is what ties it to everybody else who went out that round. */
export async function withdrawTournamentPlayer(
  tournamentId: string,
  userId: string,
  round: number
): Promise<void> {
  await sql`
    update tournament_players set withdrawn = true, out_round = ${round}
    where tournament_id = ${tournamentId} and user_id = ${userId} and withdrawn = false
  `;
}

// The seeding, written once at the start, along with the rating it was
// computed from.
export async function setTournamentSeeds(
  tournamentId: string,
  seeds: { userId: string; seed: number; rating: number }[]
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const s of seeds) {
      await tx`
        update tournament_players set seed = ${s.seed}, rating = ${s.rating}
        where tournament_id = ${tournamentId} and user_id = ${s.userId}
      `;
    }
  });
}

// Which round a player went out in, for everybody a round eliminated. Written
// as the round settles rather than at the end, so a page can say "out in round
// two" while the tournament is still running.
export async function setTournamentOutRound(
  tournamentId: string,
  userIds: string[],
  round: number
): Promise<void> {
  if (userIds.length === 0) return;
  await sql`
    update tournament_players set out_round = ${round}
    where tournament_id = ${tournamentId} and user_id in ${sql(userIds)} and out_round is null
  `;
}

export async function getTournamentTables(tournamentId: string): Promise<TournamentTableRow[]> {
  return sql<TournamentTableRow[]>`
    select * from tournament_tables where tournament_id = ${tournamentId}
    order by round asc, table_no asc
  `;
}

export async function getTournamentTablesForRound(
  tournamentId: string,
  round: number
): Promise<TournamentTableRow[]> {
  return sql<TournamentTableRow[]>`
    select * from tournament_tables
    where tournament_id = ${tournamentId} and round = ${round}
    order by table_no asc
  `;
}

/* A round's tables, written in one transaction so a round either exists whole
   or not at all: a tick that failed halfway through would otherwise leave a
   round whose remaining tables nobody ever deals. */
export async function insertTournamentTables(
  tournamentId: string,
  round: number,
  tables: { tableNo: number; seats: string[] }[]
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const t of tables) {
      await tx`
        insert into tournament_tables (tournament_id, round, table_no, seats)
        values (${tournamentId}, ${round}, ${t.tableNo}, ${sql.json(jsonb(t.seats))})
        on conflict (tournament_id, round, table_no) do nothing
      `;
    }
  });
}

export async function setTournamentTableMatch(
  tournamentId: string,
  round: number,
  tableNo: number,
  matchId: string
): Promise<void> {
  await sql`
    update tournament_tables set match_id = ${matchId}, status = 'playing'
    where tournament_id = ${tournamentId} and round = ${round} and table_no = ${tableNo}
  `;
}

/* A table settled. Answers false when it was already done, which is what
   makes the finished-match listener and the tick safe to both run: whoever
   gets there first settles it and the other one finds nothing to do. */
export async function finishTournamentTable(
  tournamentId: string,
  round: number,
  tableNo: number,
  result: { places: Record<string, number>; advanced: string[]; bye: boolean }
): Promise<boolean> {
  const rows = await sql`
    update tournament_tables set
      status = 'done',
      places = ${sql.json(jsonb(result.places))},
      advanced = ${sql.json(jsonb(result.advanced))},
      bye = ${result.bye}
    where tournament_id = ${tournamentId} and round = ${round} and table_no = ${tableNo}
      and status <> 'done'
    returning table_no
  `;
  return rows.length > 0;
}

/* What a profile shows: every settled tournament this player was in, newest
   first, with where they came. */
export interface UserTournamentSummary {
  id: string;
  name: string;
  kind: string;
  shape: 'bracket' | 'shootout';
  startsAt: Date;
  status: 'finished' | 'cancelled';
  place: number | null;
  players: number;
}

export async function getTournamentsForUser(userId: string, limit = 20): Promise<UserTournamentSummary[]> {
  return sql<UserTournamentSummary[]>`
    select
      t.id, t.name, t.kind, t.shape, t.starts_at, t.status, tp.place,
      (select count(*)::int from tournament_players x where x.tournament_id = t.id) as players
    from tournament_players tp
    join tournaments t on t.id = tp.tournament_id
    where tp.user_id = ${userId} and t.status in ('finished', 'cancelled')
    order by t.starts_at desc
    limit ${limit}
  `;
}

/* The headline tile's two numbers: tournaments won and podium finishes. One
   query rather than counting the list above, because the list is capped and a
   career total must not be. */
export async function getTournamentRecord(userId: string): Promise<{ wins: number; podiums: number }> {
  const [row] = await sql<{ wins: number; podiums: number }[]>`
    select
      count(*) filter (where tp.place = 1)::int as wins,
      count(*) filter (where tp.place <= 3)::int as podiums
    from tournament_players tp
    join tournaments t on t.id = tp.tournament_id
    where tp.user_id = ${userId} and t.status = 'finished' and tp.place is not null
  `;
  return { wins: row?.wins ?? 0, podiums: row?.podiums ?? 0 };
}

/* How many people are registered for each of a list of tournaments, in one
   query. The listing draws three cards and each one says "n of m", which is
   three counts and should not be three round trips. */
export async function countTournamentPlayers(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await sql<{ tournamentId: string; n: number }[]>`
    select tournament_id, count(*)::int as n
    from tournament_players
    where tournament_id in ${sql(ids)}
    group by tournament_id
  `;
  return new Map(rows.map((r) => [r.tournamentId, r.n]));
}

/* Tickets: what the g-admin overlay writes (agents/g-admin-contract.md at the
   repo root). `drawing` is a PNG data URL and the only large column, so a
   list never selects it: a page of tickets is a page of tickets, not a
   megabyte of strokes each.

   The contract's ticket JSON nests `page`, `viewport` and `elements`
   objects; this table keeps them under the flat columns the old annotate
   layer already had (`url`/`path`/`title`, `viewport`, `targets`), so the
   migration that added the g-admin fields (scope, kind, severity, edits,
   replies, baked_by, updated_at, source) needed no rename. gadmin.ts
   assembles the nested contract shape only at the API boundary. */
// Field names here are camelCase, unlike the contract's own JSON (dom_path,
// token_from, token_to), because `sql`'s `transform: postgres.camel`
// recursively camelizes/decamelizes jsonb content on every round trip, not
// just top-level column names: a snake_case key stored here comes back
// re-cased, silently. gadmin.ts converts to and from the contract's wire
// shape at the API boundary instead of fighting the transform.
export interface GadminElement {
  selector: string;
  domPath: string;
  html: string;
  rect: { x: number; y: number; w: number; h: number };
}

export interface GadminEdit {
  selector: string;
  prop: string;
  from: string | null;
  to: string | null;
  tokenFrom: string | null;
  tokenTo: string | null;
}

export interface GadminReply {
  at: string;
  by: 'human' | 'agent';
  text: string;
}

export interface GadminViewport {
  w: number;
  h: number;
  dpr: number;
  theme: string;
}

export type TicketStatus = 'open' | 'baked' | 'dismissed';
export type TicketScope = 'page' | 'site';
export type TicketKind = 'edit' | 'bug' | 'visual' | 'content' | 'idea';
export type TicketSeverity = 'critical' | 'major' | 'minor' | 'polish';
export type TicketSource = 'human' | 'agent';

export interface TicketRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  url: string;
  path: string;
  title: string;
  status: TicketStatus;
  scope: TicketScope;
  kind: TicketKind;
  severity: TicketSeverity;
  viewport: GadminViewport;
  targets: GadminElement[];
  edits: GadminEdit[];
  note: string;
  drawing: string | null;
  replies: GadminReply[];
  source: TicketSource;
  bakedBy: string | null;
}

export type TicketListRow = Omit<TicketRow, 'drawing'>;

export interface NewTicket {
  id: string;
  userId: string;
  url: string;
  path: string;
  title: string;
  scope: TicketScope;
  kind: TicketKind;
  severity: TicketSeverity;
  viewport: GadminViewport;
  targets: GadminElement[];
  edits: GadminEdit[];
  note: string;
  drawing: string | null;
  source: TicketSource;
}

const TICKET_LIST_COLUMNS = sql`
  id, created_at, updated_at, user_id, url, path, title, status, scope, kind,
  severity, viewport, targets, edits, note, replies, source, baked_by
`;

export async function insertTicket(ticket: NewTicket): Promise<TicketRow> {
  const [row] = await sql<TicketRow[]>`
    insert into tickets (
      id, user_id, url, path, title, scope, kind, severity, viewport, targets,
      edits, note, drawing, source
    )
    values (
      ${ticket.id}, ${ticket.userId}, ${ticket.url}, ${ticket.path}, ${ticket.title},
      ${ticket.scope}, ${ticket.kind}, ${ticket.severity},
      ${sql.json(jsonb(ticket.viewport))}, ${sql.json(jsonb(ticket.targets))},
      ${sql.json(jsonb(ticket.edits))}, ${ticket.note}, ${ticket.drawing}, ${ticket.source}
    )
    returning *
  `;
  return row;
}

export async function getTickets(status: TicketStatus | null, limit = 200): Promise<TicketListRow[]> {
  return sql<TicketListRow[]>`
    select ${TICKET_LIST_COLUMNS}
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

export interface TicketPatchFields {
  status?: TicketStatus;
  note?: string;
  appendReply?: GadminReply;
  bakedBy?: string | null;
}

/* One statement for every PATCH, because a status change, a note edit and a
   reply can all land in the same request. `baked_by` follows status exactly
   as the reference server does: set the moment a PATCH first turns a ticket
   baked, cleared the moment a PATCH turns it anything else. */
export async function patchTicket(id: string, patch: TicketPatchFields): Promise<TicketRow | null> {
  const current = await getTicketById(id);
  if (!current) return null;
  const status = patch.status ?? current.status;
  const note = patch.note ?? current.note;
  const replies = patch.appendReply ? [...current.replies, patch.appendReply] : current.replies;
  let bakedBy = current.bakedBy;
  if (patch.status === 'baked' && current.status !== 'baked') bakedBy = patch.bakedBy ?? null;
  else if (patch.status !== undefined && patch.status !== 'baked') bakedBy = null;

  const [row] = await sql<TicketRow[]>`
    update tickets set
      status = ${status}, note = ${note}, replies = ${sql.json(jsonb(replies))},
      baked_by = ${bakedBy}, updated_at = now()
    where id = ${id}
    returning *
  `;
  return row ?? null;
}

export async function deleteTicketsForUser(userId: string): Promise<void> {
  await sql`delete from tickets where user_id = ${userId}`;
}
