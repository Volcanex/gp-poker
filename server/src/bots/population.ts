import { config } from '../config.js';
import { rankedUnlocked } from '../matchmaking.js';
import { liveRooms } from '../match/rooms.js';
import { isBotBusy, isBotQueued, levelOf, loadedPopulation, sendBotMessage } from './index.js';
import { isOnlineAt } from './population-roster.js';

/* The population scheduler. Every tick it decides, for each loaded bot,
   whether its own weekly schedule says it is online right now
   (`population-roster.ts`'s `isOnlineAt`, pure), and for the ones that are,
   sends them to queue exactly the way a human's socket would: a `queue`
   `ClientMsg` through `sendBotMessage`, which is the same `dispatch`
   `BotPlayer` itself is driven through. Matchmaking does not know the
   difference, which is the point: a bot pairs with a human waiting in the
   same bucket, or with another bot if none is, through the one pairing path
   this site has. Humans are never crowded out by this - they were never in
   competition with it. The bot-fill timers in `matchmaking.ts` still seat a
   lone human within 5-20 seconds regardless of what the population is
   doing, and a table the population starts is an ordinary queue entry with
   no priority over anybody else's.

   This is what makes the ladder (`../ladder.ts`) redundant once the
   population is on: the population already produces rated bot-vs-bot
   matches in public, the way the ladder used to produce them backstage.
   `index.ts` starts one or the other, never both (see its comment). */

const POLL_MS = 30_000; // schedules move in whole minutes; every 30s is plenty
// A soft cap on how many bots this module sends to queue in one tick, so a
// burst of bots all going online in the same minute cannot dispatch
// everybody at once. The table cap below is the one that actually matters;
// this just smooths it out.
const MAX_DISPATCHES_PER_TICK = 10;
// Once a bot has cleared the ranked gate, it plays rated most of the time -
// this is what makes its numbers real - with some casual play mixed in, the
// way a person would.
const RATED_SHARE = 0.75;

export interface PopulationOptions {
  enabled?: boolean;
  maxTables?: number;
  now?: () => Date;
}

let enabled = config.populationEnabled;
let maxTables = config.populationMaxTables;
let clock: () => Date = () => new Date();

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function configurePopulation(opts: PopulationOptions): void {
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (opts.maxTables !== undefined) maxTables = opts.maxTables;
  if (opts.now !== undefined) clock = opts.now;
}

// Back to the configured defaults, for a test that has finished with the
// scheduler and does not want the next file inheriting it.
export function resetPopulation(): void {
  stopPopulation();
  enabled = config.populationEnabled;
  maxTables = config.populationMaxTables;
  clock = () => new Date();
}

export function startPopulation(): void {
  if (timer || !enabled) return;
  timer = setInterval(() => {
    void populationTick();
  }, POLL_MS);
}

export function stopPopulation(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// How many loaded bots the schedule says are online right now, for
// /api/stats' `online` figure. Distinct from "playing": a bot between hands
// or waiting in queue still counts here.
export function onlineCount(): number {
  const now = clock();
  return loadedPopulation().filter(({ bot }) => isOnlineAt(bot.schedule, bot.timezone, now)).length;
}

// Tables with no human at any of them. A rough proxy, not an exact count of
// what this scheduler alone produced (a home game filled entirely by bots
// would count too), which is fine: this exists to bound CPU, not to audit
// attribution.
function botOnlyTableCount(): number {
  return liveRooms().filter((room) => room.playerIds.length > 0 && room.playerIds.every((id) => levelOf(id) !== null))
    .length;
}

/* One pass over the loaded population. Exported so a test can drive it a
   step at a time instead of waiting on the interval, the way `tick` is in
   matchmaking and `ladderTick` is in the ladder.

   Wrapped end to end: this runs from a timer nobody awaits, and a rejection
   escaping it would take the process down along with every live match, which
   is the one thing a background scheduler must never do. */
export async function populationTick(): Promise<void> {
  if (!enabled || ticking) return;
  ticking = true;
  try {
    const now = clock();
    let dispatched = 0;
    for (const { userId, bot } of loadedPopulation()) {
      const online = isOnlineAt(bot.schedule, bot.timezone, now);
      // `isBotBusy` is checked first because it is also where a resolved
      // queue entry gets cleared (see index.ts): a match in progress is left
      // to finish regardless of what the schedule says now.
      if (isBotBusy(userId)) continue;

      const queued = isBotQueued(userId);
      if (!online) {
        // The session ended while still searching: a real person would
        // close the tab rather than let it keep looking.
        if (queued) sendBotMessage(userId, { t: 'dequeue' });
        continue;
      }

      if (queued) continue; // already looking, leave the search running
      if (dispatched >= MAX_DISPATCHES_PER_TICK) continue;
      if (botOnlyTableCount() >= maxTables) continue; // soft cap; existing tables finish on their own

      const rated = (await rankedUnlocked(userId)) && Math.random() < RATED_SHARE;
      sendBotMessage(userId, { t: 'queue', mode: bot.mode, rated, speed: bot.speed });
      dispatched++;
    }
  } catch (err) {
    console.error('population tick failed:', err);
  } finally {
    ticking = false;
  }
}
