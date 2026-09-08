import { botLevelInfo, type BotLevel, type ClientMsg, type Mode } from '@opentable/protocol';
import { generateName, seededRng } from '@opentable/identity';
import { config } from '../config.js';
import {
  ensureBotUser,
  getBotUsers,
  getLadderMatchCounts,
  getRatingsForUsers,
  migrateLegacyBotNames,
  type UserRow,
} from '../db.js';
import { hub } from '../ws/hub.js';
import { roomForPlayer } from '../match/rooms.js';
import { BotPlayer, type Dispatch } from './player.js';

/* The bot roster. Accounts are ordinary users with `bot = true`: real names,
   real Glicko-2 ratings, real match history, no password, never guests. They
   are created once at boot and live for the process's lifetime, registered
   with the hub as virtual connections so anything that sends to a user id
   reaches them.

   Bots are excluded from the leaderboard but their matches are rated. That
   is a deliberate bootstrap choice while there are no other players: the
   alternative (casual bot matches) leaves every early human provisional
   forever with nothing to calibrate against. Revisit once real humans are
   pairing with each other. A practice match is the exception and is never
   rated, because its whole point is to be a place to lose.

   Every bot plays at one of the five levels (see BOT_LEVELS in the protocol),
   three bots per level. The level is a property of the account, not of the
   match: a level 2 bot is a level 2 bot in the rated queue as well, and its
   rating is the honest consequence of that. */

// A fixed roster, generated once from a fixed seed so the names are the
// same on every boot rather than reshuffling each restart. Growing the count
// only appends: the generator walks the same sequence, so the names of the
// bots that already exist (and their ratings and histories) are untouched.
function generateBotNames(count: number): string[] {
  const rng = seededRng('opentable-bots');
  const names = new Set<string>();
  while (names.size < count) names.add(generateName(rng, 2));
  return [...names];
}

export const BOT_ROSTER_SIZE = 15;

const BOT_NAMES = generateBotNames(BOT_ROSTER_SIZE);

// Levels cycle down the roster rather than sitting in blocks, so the first
// bots ever created are spread across the five levels instead of all being
// level 1. Roster index i plays at (i % 5) + 1.
export function levelForIndex(i: number): BotLevel {
  return ((i % 5) + 1) as BotLevel;
}

export interface RosterEntry {
  name: string;
  level: BotLevel;
}

export function botRoster(count = config.botCount): RosterEntry[] {
  return BOT_NAMES.slice(0, Math.max(0, count)).map((name, i) => ({ name, level: levelForIndex(i) }));
}

const players = new Map<string, BotPlayer>();
const levels = new Map<string, BotLevel>();

// Bots send `join` and `act` through the same router a websocket message
// goes through. It is injected rather than imported so this module does not
// have to reach back into the websocket layer that reaches into matchmaking.
let dispatch: Dispatch = () => {};

export function setBotDispatch(fn: Dispatch): void {
  dispatch = fn;
}

// One-time migration from the old `bot-otter` style names to the generated
// roster, in the same order the old roster was read (name_lower asc). A
// database with no legacy rows left (the common case, after the first boot
// that runs this) does nothing. Exported with an overridable name list so
// tests can exercise it without touching the real roster.
export function migrateBotRoster(names: string[] = BOT_NAMES): Promise<void> {
  return migrateLegacyBotNames(names);
}

export async function ensureBots(count = config.botCount): Promise<void> {
  await migrateBotRoster();
  for (const { name, level } of botRoster(count)) {
    const user = await ensureBotUser(name, level);
    if (!user) continue;
    levels.set(user.id, level);
    if (players.has(user.id)) continue;
    const player = new BotPlayer(user.id, (userId, msg: ClientMsg) => dispatch(userId, msg), level);
    players.set(user.id, player);
    hub.attachVirtual(user.id, (msg) => player.receive(msg));
  }
}

// The level a loaded bot is playing at. The database column is the same
// answer; this is the one that does not need a query.
export function levelOf(userId: string): BotLevel | null {
  return levels.get(userId) ?? null;
}

function isFree(u: UserRow): boolean {
  return players.has(u.id) && !roomForPlayer(u.id)?.active;
}

// Bots that are loaded in this process and not sitting in a live match,
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
   to seat a six-max table from one level, so the spread is the normal case
   rather than the fallback: the table is filled with the nearest opposition
   there is, and comes back short only when the roster really is busy. */
export async function availableBotsAtLevel(level: number, limit: number): Promise<UserRow[]> {
  if (limit <= 0) return [];
  const free = (await getBotUsers()).filter(isFree);
  const order = [level];
  for (let d = 1; d <= 4; d++) {
    if (level - d >= 1) order.push(level - d);
    if (level + d <= 5) order.push(level + d);
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
