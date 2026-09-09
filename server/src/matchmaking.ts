import { randomBytes } from 'node:crypto';
import { groupQueue, pairQueue, widenRd, window as ratingWindow, type QueueEntry } from '@opentable/rating';
import {
  DEFAULT_MODE,
  DEFAULT_SPEED,
  RANKED_GATE_MATCHES,
  botLevelInfo,
  formatFor,
  speedOf,
  type MatchFormat,
  type Mode,
  type ReadyFailure,
  type Speed,
} from '@opentable/protocol';
import { hub } from './ws/hub.js';
import {
  countUnratedFinished,
  getRating,
  getRatingsForUsers,
  getUserById,
  insertMatch,
  insertMatchPlayers,
  type MatchSeat,
} from './db.js';
import { chargeNoShow, cooldownUntil, declineReady, openReadyCheck } from './ready.js';
import { rankedBanMessage, rankedBanUntil } from './walkouts.js';
import { isUniqueViolation } from './pgError.js';
import { MatchRoom } from './match/room.js';
import { registerRoom } from './match/rooms.js';
import { availableBots, availableBotsAtLevel } from './bots/index.js';

export type { QueueEntry };

const MATCH_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // base32-ish, no ambiguous chars
const TICK_MS = 1000;

// How long a lone human waits before a bot is brought in. Heads-up is short
// because there is nothing to wait for once no human is queued; six-max is
// longer because gathering real players is worth a little patience.
const BOT_FILL_HEADS_UP_MS = 5_000;
const BOT_FILL_SIX_MAX_MS = 20_000;

interface QueuedPlayer extends QueueEntry {
  mode: Mode;
  rated: boolean;
  speed: Speed;
}

// One queue per (mode, rated, speed) combination, so eight independent
// searches share this map and never pair across each other. Speed is a real
// third dimension and not a tag on a shared queue: a twenty minute six-max
// table and a two hour one are different games, however alike their ratings
// are kept.
const queue = new Map<string, QueuedPlayer>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

// Exported seam, like `tick` and `createMatchForPlayers`: tests replace this
// to run the real queue path against a short clock and a small stack instead
// of the 20-second, 200-unit product format.
let resolveFormat: (mode: Mode, rated: boolean, speed: Speed) => MatchFormat = formatFor;

export function setFormatResolver(fn: (mode: Mode, rated: boolean, speed: Speed) => MatchFormat): void {
  resolveFormat = fn;
}

// The resolver itself, for the paths that create a match outside the queue: a
// challenge link builds its format through here so the seam covers it too,
// and in production it is `formatFor` and nothing else.
export function matchFormat(mode: Mode, rated: boolean, speed: Speed = DEFAULT_SPEED): MatchFormat {
  return resolveFormat(mode, rated, speed);
}

// Exported so a challenge link can be minted from the same alphabet as a
// match id: both are short public ids people read off a URL, and there should
// only ever be one set of characters that appear in one.
export function randomMatchId(): string {
  let s = '';
  for (const b of randomBytes(8)) s += MATCH_ID_ALPHABET[b % MATCH_ID_ALPHABET.length];
  return s;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function bucketKey(mode: Mode, rated: boolean, speed: Speed): string {
  return `${mode}:${rated}:${speed}`;
}

/* Rated play opens after one finished casual or practice match. Enforced here
   rather than only drawn on the home page, because the queue is the door and
   a disabled radio is a hint. It is deliberately a single match: enough that
   nobody's first ever hand moves a rating they had not noticed they had, and
   not so much that it reads as a grind. */
export async function rankedUnlocked(userId: string): Promise<boolean> {
  return (await countUnratedFinished(userId, RANKED_GATE_MATCHES)) >= RANKED_GATE_MATCHES;
}

export async function enqueue(
  userId: string,
  mode: Mode = DEFAULT_MODE,
  rated = true,
  speed: Speed = DEFAULT_SPEED
): Promise<void> {
  if (queue.has(userId)) return;
  const user = await getUserById(userId);
  if (!user) return;

  // Three refusals before anything is entered, all of them about this player
  // rather than about this search, and all of them saying what happens next
  // rather than only that the answer is no.
  const until = cooldownUntil(userId);
  if (until !== null) {
    const seconds = Math.ceil((until - Date.now()) / 1000);
    hub.send(userId, {
      t: 'err',
      c: 'cooldown',
      msg: `You left a table waiting. You can search again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
    });
    return;
  }
  if (rated && !(await rankedUnlocked(userId))) {
    hub.send(userId, {
      t: 'err',
      c: 'ranked_locked',
      msg: 'Play one casual game first. Rated play opens as soon as it finishes.',
    });
    return;
  }
  // The walkout ban, and only on the rated queue: casual and practice are
  // the rooms somebody serving one is meant to still be able to play in.
  if (rated) {
    const banned = await rankedBanUntil(userId);
    if (banned !== null) {
      hub.send(userId, { t: 'err', c: 'ranked_ban', msg: rankedBanMessage(banned) });
      return;
    }
  }

  // The queue matches on the rating for the mode being queued for, so a
  // strong heads-up player enters the six-max queue at their six-max rating.
  // Speed is not part of that: one Glicko-2 pool per mode, with speed as a
  // tag, until the population supports splitting them.
  const standing = await getRating(userId, mode);
  const daysInactive = (Date.now() - standing.ratingAt.getTime()) / (24 * 60 * 60 * 1000);
  const widened = widenRd({ rating: standing.rating, rd: standing.rd, volatility: standing.volatility }, daysInactive);
  const entry: QueuedPlayer = {
    id: userId,
    rating: standing.rating,
    rd: widened.rd,
    joinedAt: Date.now(),
    mode,
    rated,
    speed,
  };
  queue.set(userId, entry);
  sendSearching(entry, countIn(mode, rated, speed));
}

// How many people are searching right now, for the home page's stats strip.
// Bots are never enqueued, so every entry is a human.
export function queueSize(): number {
  return queue.size;
}

/* Practice: no queue, no wait, no rating. The seats around the player are
   filled from the roster at the level they asked for and outwards from it,
   and the match is created on the spot, so the searching screen resolves in
   the time one round trip takes rather than on the bot-fill timer the rated
   queues run on.

   `practice: true` rides on the format like every other format field, so it
   is persisted with the match and read back by anything that renders one. It
   is additive: a format stored before practice existed simply has no key. */
export async function enqueuePractice(
  userId: string,
  mode: Mode,
  level: number,
  speed: Speed = DEFAULT_SPEED
): Promise<void> {
  if (queue.has(userId)) dequeue(userId);
  const user = await getUserById(userId);
  if (!user) return;

  const base = resolveFormat(mode, false, speed);
  const format: MatchFormat = { ...base, rated: false, practice: true };
  const bots = await availableBotsAtLevel(level, format.players - 1);
  if (bots.length < format.players - 1) {
    const info = botLevelInfo(level);
    hub.send(userId, {
      t: 'err',
      c: 'bots_busy',
      msg: `Every bot near ${info.name.toLowerCase()} is in a match. Try again in a moment.`,
    });
    return;
  }

  await createMatchForPlayers(
    shuffled([userId, ...bots.map((b) => b.id)]),
    format
  );
}

/* Stop searching, on purpose. A player sitting in a ready check who presses
   this has not stopped searching, they have declined a table five other
   people are waiting on, so it goes down that path instead and costs what a
   decline costs. */
export function dequeue(userId: string): void {
  if (declineReady(userId)) return;
  if (queue.delete(userId)) {
    hub.send(userId, { t: 'q', s: 'left' });
  }
}

/* The socket dropped. Unlike an explicit cancel this leaves a pending ready
   check alone: the window is twenty seconds and a player who reconnects
   inside it can still accept, which is a much better answer than charging a
   cooldown for a blip. If they do not come back the check times out and
   charges them then. */
export function dequeueOnDisconnect(userId: string): void {
  if (queue.delete(userId)) {
    hub.send(userId, { t: 'q', s: 'left' });
  }
}

function countIn(mode: Mode, rated: boolean, speed: Speed): number {
  let n = 0;
  for (const e of queue.values()) if (e.mode === mode && e.rated === rated && e.speed === speed) n += 1;
  return n;
}

function sendSearching(entry: QueuedPlayer, gathered: number): void {
  const now = Date.now();
  const window = ratingWindow(entry, now);
  const waited = Math.floor((now - entry.joinedAt) / 1000);
  // window() returns Infinity once the search is unbounded; that doesn't
  // survive JSON.stringify (becomes null), so drop the field instead of
  // passing it through raw. It is also derived from a rating deviation,
  // which is a float, and nobody reads a rating range to the decimal.
  const range = Number.isFinite(window) ? Math.round(window) : undefined;
  const seats = resolveFormat(entry.mode, entry.rated, entry.speed).players;
  hub.send(entry.id, {
    t: 'q',
    s: 'searching',
    w: waited,
    range,
    mode: entry.mode,
    rated: entry.rated,
    speed: entry.speed,
    ...(seats > 2 ? { seated: Math.min(gathered, seats) } : {}),
  });
}

// Parameterized by format so tests can create a match with a short
// clockMs/graceMs instead of the real 20s/15s, bypassing the queue entirely.
export async function createMatchForPlayers(
  userIds: string[],
  format: MatchFormat = formatFor(DEFAULT_MODE, true)
): Promise<string> {
  const users = await Promise.all(userIds.map((id) => getUserById(id)));
  if (users.some((u) => u === null)) throw new Error('every seat must exist to create a match');
  // Seats carry the rating for this match's mode, which is what SeatView
  // shows at the table.
  const standings = await getRatingsForUsers(userIds, format.mode);

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomMatchId();
    const seats: MatchSeat[] = users.map((u, i) => ({
      seat: i,
      userId: u!.id,
      name: u!.name,
      rating: Math.round(standings.get(u!.id)!.rating),
      bot: u!.bot,
      avatarV: u!.avatarV,
      // A practice table's bots are bots, not people from somewhere: no flag.
      ...(u!.country && !(format.practice === true && u!.bot) ? { country: u!.country } : {}),
    }));
    try {
      const match = await insertMatch(id, format, seats, format.rated);
      await insertMatchPlayers(
        id,
        seats.map((s) => ({ userId: s.userId, seat: s.seat }))
      );
      const room = new MatchRoom(match);
      registerRoom(room);
      await room.start();
      for (const s of seats) {
        hub.send(s.userId, {
          t: 'q',
          s: 'found',
          m: id,
          mode: format.mode,
          rated: format.rated,
          speed: speedOf(format),
        });
      }
      return id;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique match id');
}

/* A gathered table, offered rather than dealt. Everybody in it comes out of
   the queue for the length of the check, so nobody is offered two tables at
   once and nothing else can pair them while they decide.

   The bots are picked inside `start` and not here. Twenty seconds is long
   enough for another table to take the one this group was going to sit with,
   and a table that starts with a bot in a match somewhere else is a table
   with an empty chair.

   A failed check puts everybody who did accept back exactly as they were,
   original `joinedAt` and all, which is what "the front of the queue" means
   here: both pairing functions order by how long somebody has waited, so
   preserving the timestamp is preserving the place, and it does it without a
   second notion of priority existing anywhere. */
function launch(entries: QueuedPlayer[], botCount: number, format: MatchFormat): void {
  for (const e of entries) queue.delete(e.id);
  const id = randomMatchId();
  const humans = entries.map((e) => e.id);

  const opened = openReadyCheck({
    id,
    format,
    seats: format.players,
    humans,
    start: async () => {
      const bots =
        botCount > 0 ? await availableBots(meanRating(entries), botCount, format.mode) : [];
      if (bots.length < botCount) {
        // The roster emptied while they were deciding. Nobody is at fault, so
        // nobody is charged: they go back to searching where they were.
        for (const e of entries) requeue(e);
        return;
      }
      await createMatchForPlayers(shuffled([...humans, ...bots.map((b) => b.id)]), format);
    },
    onCancel: (failed, kept, why) => {
      for (const uid of failed) chargeNoShow(uid);
      for (const e of entries) {
        if (kept.includes(e.id)) requeue(e);
      }
      void why;
    },
  });

  // Refused only when one of these players is somehow already in a check,
  // which the queue's own bookkeeping should make impossible. Putting them
  // back is the safe answer either way.
  if (!opened) for (const e of entries) requeue(e);
}

/* Back into the queue with the place they had. No `q searching` is sent from
   here: the tick that follows sends one to everybody in the queue anyway, and
   the client has just been told by the `ready cancelled` message why it is
   searching again. */
function requeue(entry: QueuedPlayer): void {
  if (!queue.has(entry.id)) queue.set(entry.id, entry);
}

function meanRating(entries: QueuedPlayer[]): number {
  if (entries.length === 0) return 1500;
  return entries.reduce((sum, e) => sum + e.rating, 0) / entries.length;
}

async function tickHeadsUp(entries: QueuedPlayer[], format: MatchFormat, now: number): Promise<void> {
  for (const [a, b] of pairQueue(entries, now)) {
    if (!queue.has(a.id) || !queue.has(b.id)) continue;
    launch([a, b], 0, format);
  }

  // Nobody left to pair with: give whoever has been waiting longest a bot
  // rather than an empty room. The roster is asked here only so a table is
  // not offered when there is nothing to fill it with; the bot itself is
  // picked again when the check passes.
  const waiting = entries.filter((e) => queue.has(e.id)).sort((a, b) => a.joinedAt - b.joinedAt);
  for (const entry of waiting) {
    if (now - entry.joinedAt < BOT_FILL_HEADS_UP_MS) continue;
    const [bot] = await availableBots(entry.rating, 1, format.mode);
    if (!bot) return;
    launch([entry], 1, format);
  }
}

async function tickMultiway(entries: QueuedPlayer[], format: MatchFormat, now: number): Promise<void> {
  for (const group of groupQueue(entries, format.players, now)) {
    if (group.some((e) => !queue.has(e.id))) continue;
    launch(group, 0, format);
  }

  const waiting = entries.filter((e) => queue.has(e.id)).sort((a, b) => a.joinedAt - b.joinedAt);
  if (waiting.length === 0) return;
  if (now - waiting[0].joinedAt < BOT_FILL_SIX_MAX_MS) return;

  // Six-max fills with bots after the threshold, ranked included. Ranked
  // used to wait for six people, which with one person on the site meant it
  // never dealt at all; bots are the population for now, their matches are
  // rated the same way heads-up bot fills already are, and the pool branch
  // makes them ordinary opponents in the queue anyway.
  const humans = waiting.slice(0, format.players);
  const needed = format.players - humans.length;
  const bots = needed > 0 ? await availableBots(meanRating(humans), needed, format.mode) : [];
  // Bots never fill a table with no human, and a short roster waits rather
  // than seating a table that isn't full.
  if (humans.length === 0 || humans.length + bots.length < format.players) return;
  launch(humans, needed, format);
}

// Exported so tests can pair a queue deterministically instead of waiting on
// the real interval.
export async function tick(): Promise<void> {
  const now = Date.now();
  const buckets = new Map<string, QueuedPlayer[]>();
  for (const entry of queue.values()) {
    const key = bucketKey(entry.mode, entry.rated, entry.speed);
    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  }

  for (const entries of buckets.values()) {
    const { mode, rated, speed } = entries[0];
    const format = resolveFormat(mode, rated, speed);
    if (format.players > 2) await tickMultiway(entries, format, now);
    else await tickHeadsUp(entries, format, now);
  }

  for (const entry of queue.values()) sendSearching(entry, countIn(entry.mode, entry.rated, entry.speed));
}

export function startMatchmaking(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    void tick();
  }, TICK_MS);
}

export function stopMatchmaking(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}
