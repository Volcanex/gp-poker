import type { ClientMsg, Mode } from '@opentable/protocol';
import { generateName, seededRng } from '@opentable/identity';
import { config } from '../config.js';
import { ensureBotUser, getBotUsers, getRatingsForUsers, migrateLegacyBotNames, type UserRow } from '../db.js';
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
   pairing with each other. */

// A fixed roster, generated once from a fixed seed so the names are the
// same on every boot rather than reshuffling each restart.
function generateBotNames(count: number): string[] {
  const rng = seededRng('opentable-bots');
  const names = new Set<string>();
  while (names.size < count) names.add(generateName(rng, 2));
  return [...names];
}

const BOT_NAMES = generateBotNames(8);

const players = new Map<string, BotPlayer>();

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
  for (const name of BOT_NAMES.slice(0, Math.max(0, count))) {
    const user = await ensureBotUser(name);
    if (!user || players.has(user.id)) continue;
    const player = new BotPlayer(user.id, (userId, msg: ClientMsg) => dispatch(userId, msg));
    players.set(user.id, player);
    hub.attachVirtual(user.id, (msg) => player.receive(msg));
  }
}

// Bots that are loaded in this process and not sitting in a live match,
// closest in rating to `targetRating` first. A finished room lingers for a
// minute after the match ends, so availability asks the room whether it is
// still active rather than whether it exists.
export async function availableBots(targetRating: number, limit: number, mode: Mode): Promise<UserRow[]> {
  if (limit <= 0) return [];
  const rows = (await getBotUsers()).filter((u) => players.has(u.id) && !roomForPlayer(u.id)?.active);
  // Closeness is judged on the mode being queued for, not a bot's heads-up
  // record: a bot that has only ever played six-max is still 1500 heads-up.
  const standings = await getRatingsForUsers(
    rows.map((u) => u.id),
    mode
  );
  const distance = (u: UserRow) => Math.abs((standings.get(u.id)?.rating ?? 1500) - targetRating);
  return [...rows].sort((a, b) => distance(a) - distance(b)).slice(0, limit);
}
