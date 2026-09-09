import { BOT_LEVELS, botLevelInfo, type BotLevel, type ClientMsg, type Mode } from '@opentable/protocol';
import { generateName, seededRng } from '@opentable/identity';
import { config } from '../config.js';
import {
  ensureBotUser,
  getBotUsers,
  getLadderMatchCounts,
  getRatingsForUsers,
  migrateBotNamesToRealistic,
  migrateLegacyBotNames,
  type UserRow,
} from '../db.js';
import { hub } from '../ws/hub.js';
import { roomForPlayer } from '../match/rooms.js';
import { BotPlayer, type Dispatch } from './player.js';
import { generatePopulation, levelForIndex, type PopulationBot } from './population-roster.js';

/* The bot roster. Accounts are ordinary users with `bot = true`: real names,
   real Glicko-2 ratings, real match history, no password, never guests. They
   are created once at boot and live for the process's lifetime, registered
   with the hub as virtual connections so anything that sends to a user id
   reaches them.

   The roster is the bot population (`config.botCount`, `POPULATION_SIZE`):
   `population-roster.ts` generates who each bot is (name, country, level,
   persona, schedule) from a fixed seed, and this module is where that
   becomes real database rows and live `BotPlayer`s. `population.ts` is the
   scheduler that decides, minute to minute, which of them are "online" and
   sends them to queue.

   Bots are excluded from the leaderboard by default but their matches are
   rated; `config.populationPublic` puts them on it. A practice match is
   always the exception and is never rated, because its whole point is to be
   a place to lose.

   Every bot plays at one of the five levels (see BOT_LEVELS in the
   protocol). The level is a property of the account, not of the match: a
   level 2 bot is a level 2 bot in the rated queue as well, and its rating is
   the honest consequence of that. */

// The original fifteen-bot roster's CamelCase names, kept only as the source
// half of the one-time rename onto the population's realistic handles
// (`migrateBotNamesToRealistic`, positional by roster index). Nothing else
// reads this any more.
const LEGACY_ROSTER_SIZE = 15;
function legacyCamelCaseNames(): string[] {
  const rng = seededRng('opentable-bots');
  const names = new Set<string>();
  while (names.size < LEGACY_ROSTER_SIZE) names.add(generateName(rng, 2));
  return [...names];
}

export { levelForIndex };

// The population, generated once from a fixed seed: growing `count` only
// appends, since `generatePopulation` walks the same rng sequence every
// time. Exported for `population.ts` and for tests.
export function populationRoster(count = config.botCount): PopulationBot[] {
  return generatePopulation(Math.max(0, count));
}

const players = new Map<string, BotPlayer>();
const levels = new Map<string, BotLevel>();
// A loaded bot's population spec, by user id, for the scheduler: mode/speed
// preference, schedule, persona and budget all live on this rather than
// being re-derived or re-queried.
const population = new Map<string, PopulationBot>();

// Bots send `join` and `act` through the same router a websocket message
// goes through. It is injected rather than imported so this module does not
// have to reach back into the websocket layer that reaches into matchmaking.
let dispatch: Dispatch = () => {};

export function setBotDispatch(fn: Dispatch): void {
  dispatch = fn;
}

// Bots the population scheduler has told to queue and not yet seen resolve,
// timestamped rather than a bare set so one that never resolves (a
// rejection nothing here ever sees, such as the ranked gate refusing it) is
// not unavailable forever. Tracked here rather than in population.ts because
// `availableBots`/`availableBotsAtLevel` need it too: without it, a bot
// searching the ordinary queue could also be pulled into a practice table or
// a ladder match and end up seated at two tables at once. Bots never sat in
// that queue before the population did, so this case could not arise until
// now.
const queuedAt = new Map<string, number>();
const QUEUE_STALE_MS = 3 * 60_000;

// The population scheduler drives a bot exactly the way its own `BotPlayer`
// drives its actions: through the same router a socket message goes
// through, via the same `dispatch` this module already holds.
export function sendBotMessage(userId: string, msg: ClientMsg): void {
  if (msg.t === 'queue') queuedAt.set(userId, Date.now());
  else if (msg.t === 'dequeue') queuedAt.delete(userId);
  dispatch(userId, msg);
}

// Whether this module believes a bot is currently searching the ordinary
// queue. Self-healing: an entry older than `QUEUE_STALE_MS` is treated as
// resolved even if nothing ever told this module so explicitly.
export function isBotQueued(userId: string): boolean {
  const at = queuedAt.get(userId);
  if (at === undefined) return false;
  if (Date.now() - at > QUEUE_STALE_MS) {
    queuedAt.delete(userId);
    return false;
  }
  return true;
}

// One-time migration from the old `bot-otter` style names, in the same order
// the old roster was read (name_lower asc). A database with no legacy rows
// left (the common case) does nothing. Exported with an overridable name
// list so tests can exercise it without touching the real roster.
export function migrateBotRoster(names: string[] = legacyCamelCaseNames()): Promise<void> {
  return migrateLegacyBotNames(names);
}

export async function ensureBots(count = config.botCount): Promise<void> {
  const legacyNames = legacyCamelCaseNames();
  await migrateBotRoster(legacyNames);
  const roster = populationRoster(count);
  // Positional rename, CamelCase roster index i onto population index i, so
  // the fifteen original bots keep their id, rating and history under a new
  // name. A database that never had the old roster (a fresh test database)
  // does nothing here either.
  await migrateBotNamesToRealistic(legacyNames, roster.map((b) => b.name));

  for (const bot of roster) {
    const createdAt = new Date(Date.now() - bot.createdOffsetDays * 24 * 60 * 60 * 1000);
    const user = await ensureBotUser(bot.name, bot.level, bot.country, createdAt);
    if (!user) continue;
    levels.set(user.id, bot.level);
    population.set(user.id, bot);
    if (players.has(user.id)) continue;
    const player = new BotPlayer(
      user.id,
      (userId, msg: ClientMsg) => dispatch(userId, msg),
      bot.level,
      Math.random,
      bot.persona,
      bot.chat
    );
    players.set(user.id, player);
    hub.attachVirtual(user.id, (msg) => player.receive(msg));
  }
}

// The level a loaded bot is playing at. The database column is the same
// answer; this is the one that does not need a query.
export function levelOf(userId: string): BotLevel | null {
  return levels.get(userId) ?? null;
}

// The population spec for a loaded bot, or null for a human (or a bot not
// yet loaded). What `population.ts`'s scheduler iterates.
export function populationOf(userId: string): PopulationBot | null {
  return population.get(userId) ?? null;
}

// Every loaded bot's user id and population spec together, for the
// scheduler's tick.
export function loadedPopulation(): { userId: string; bot: PopulationBot }[] {
  return [...population.entries()].map(([userId, bot]) => ({ userId, bot }));
}

// Whether a loaded bot is currently sitting in a live match. Shared with the
// scheduler so it does not have to re-derive `isFree` below on its own. Also
// where a resolved queue entry gets cleared: once a bot is seated the room
// itself is the truth, and there is no need to wait out `QUEUE_STALE_MS` to
// notice.
export function isBotBusy(userId: string): boolean {
  const busy = roomForPlayer(userId)?.active === true;
  if (busy) queuedAt.delete(userId);
  return busy;
}

function isFree(u: UserRow): boolean {
  return players.has(u.id) && !isBotBusy(u.id) && !isBotQueued(u.id);
}

// Bots that are loaded in this process, not sitting in a live match and not
// already searching the ordinary queue on their own (see `isBotQueued`),
// closest in rating to `targetRating` first. A finished room lingers for a
// minute after the match ends, so availability asks the room whether it is
// still active rather than whether it exists.
export async function availableBots(targetRating: number, limit: number, mode: Mode): Promise<UserRow[]> {
  if (limit <= 0) return [];
  const rows = (await getBotUsers()).filter(isFree);
  // Closeness is judged on the mode being queued for, not a bot's heads-up
  // record: a bot that has only ever played six-max is still 1500 heads-up.
  const standings = await getRatingsForUsers(
    rows.map((u) => u.id),
    mode
  );
  const distance = (u: UserRow) => Math.abs((standings.get(u.id)?.rating ?? 1500) - targetRating);
  return [...rows].sort((a, b) => distance(a) - distance(b)).slice(0, limit);
}

/* Free bots for a practice table, the asked-for level first and then outwards
   a level at a time (L-1, L+1, L-2, L+2). Three bots per level is not enough
   to seat a six-max table from one level, and level 6 has two, so the spread
   is the normal case rather than the fallback: the table is filled with the
   nearest opposition there is, and comes back short only when the roster
   really is busy. */
export async function availableBotsAtLevel(level: number, limit: number): Promise<UserRow[]> {
  if (limit <= 0) return [];
  const free = (await getBotUsers()).filter(isFree);
  const order = [level];
  for (let d = 1; d < BOT_LEVELS.length; d++) {
    if (level - d >= 1) order.push(level - d);
    if (level + d <= BOT_LEVELS.length) order.push(level + d);
  }

  const picked: UserRow[] = [];
  for (const wanted of order) {
    for (const bot of free) {
      if (picked.length >= limit) return picked;
      if (picked.includes(bot)) continue;
      if ((levels.get(bot.id) ?? bot.botLevel) === wanted) picked.push(bot);
    }
  }
  return picked;
}

/* The whole roster with the level each bot plays at and its standing in every
   mode, for the practice picker. Sorted by level then name, which is the order
   it is offered in. */
export interface BotSummary {
  id: string;
  name: string;
  level: BotLevel;
  levelName: string;
  description: string;
  ratings: Record<Mode, { rating: number; matches: number }>;
  // Matches this bot has played on the ladder, against other bots. Most of
  // its rating comes from there until humans arrive, so the picker can say
  // where the number came from rather than only what it is.
  ladderMatches: number;
}

const MODES: Mode[] = ['heads-up', 'six-max'];

export async function rosterSummary(): Promise<BotSummary[]> {
  const rows = (await getBotUsers()).filter((u) => players.has(u.id));
  const ids = rows.map((u) => u.id);
  const byMode = new Map<Mode, Awaited<ReturnType<typeof getRatingsForUsers>>>();
  for (const mode of MODES) byMode.set(mode, await getRatingsForUsers(ids, mode));
  const ladder = await getLadderMatchCounts();

  const out = rows.map((u) => {
    const level = levels.get(u.id) ?? ((u.botLevel ?? 4) as BotLevel);
    const info = botLevelInfo(level);
    const ratings = {} as Record<Mode, { rating: number; matches: number }>;
    for (const mode of MODES) {
      const standing = byMode.get(mode)!.get(u.id);
      ratings[mode] = { rating: Math.round(standing?.rating ?? 1500), matches: standing?.matches ?? 0 };
    }
    return {
      id: u.id,
      name: u.name,
      level,
      levelName: info.name,
      description: info.description,
      ratings,
      ladderMatches: ladder.get(u.id) ?? 0,
    };
  });

  return out.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
