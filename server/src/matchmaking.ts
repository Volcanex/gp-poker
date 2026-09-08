import { randomBytes } from 'node:crypto';
import { groupQueue, pairQueue, widenRd, window as ratingWindow, type QueueEntry } from '@opentable/rating';
import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import { hub } from './ws/hub.js';
import { getRating, getRatingsForUsers, getUserById, insertMatch, insertMatchPlayers, type MatchSeat } from './db.js';
import { isUniqueViolation } from './pgError.js';
import { MatchRoom } from './match/room.js';
import { registerRoom } from './match/rooms.js';
import { availableBots } from './bots/index.js';

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
}

// One queue per (mode, rated) combination, so four independent searches
// share this map and never pair across each other.
const queue = new Map<string, QueuedPlayer>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

// Exported seam, like `tick` and `createMatchForPlayers`: tests replace this
// to run the real queue path against a short clock and a small stack instead
// of the 20-second, 200-unit product format.
let resolveFormat: (mode: Mode, rated: boolean) => MatchFormat = formatFor;

export function setFormatResolver(fn: (mode: Mode, rated: boolean) => MatchFormat): void {
  resolveFormat = fn;
}

function randomMatchId(): string {
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

function bucketKey(mode: Mode, rated: boolean): string {
  return `${mode}:${rated}`;
}

export async function enqueue(userId: string, mode: Mode = 'heads-up', rated = true): Promise<void> {
  if (queue.has(userId)) return;
  const user = await getUserById(userId);
  if (!user) return;
  // The queue matches on the rating for the mode being queued for, so a
  // strong heads-up player enters the six-max queue at their six-max rating.
  const standing = await getRating(userId, mode);
  const daysInactive = (Date.now() - standing.ratingAt.getTime()) / (24 * 60 * 60 * 1000);
  const widened = widenRd({ rating: standing.rating, rd: standing.rd, volatility: standing.volatility }, daysInactive);
  const entry: QueuedPlayer = { id: userId, rating: standing.rating, rd: widened.rd, joinedAt: Date.now(), mode, rated };
  queue.set(userId, entry);
  sendSearching(entry, countIn(mode, rated));
}

// How many people are searching right now, for the home page's stats strip.
// Bots are never enqueued, so every entry is a human.
export function queueSize(): number {
  return queue.size;
}

export function dequeue(userId: string): void {
  if (queue.delete(userId)) {
    hub.send(userId, { t: 'q', s: 'left' });
  }
}

function countIn(mode: Mode, rated: boolean): number {
  let n = 0;
  for (const e of queue.values()) if (e.mode === mode && e.rated === rated) n += 1;
  return n;
}

function sendSearching(entry: QueuedPlayer, gathered: number): void {
  const now = Date.now();
  const window = ratingWindow(entry, now);
  const waited = Math.floor((now - entry.joinedAt) / 1000);
  // window() returns Infinity once the search is unbounded; that doesn't
  // survive JSON.stringify (becomes null), so drop the field instead of
  // passing it through raw.
  const range = Number.isFinite(window) ? window : undefined;
  const seats = resolveFormat(entry.mode, entry.rated).players;
  hub.send(entry.id, {
    t: 'q',
    s: 'searching',
    w: waited,
    range,
    mode: entry.mode,
    rated: entry.rated,
    ...(seats > 2 ? { seated: Math.min(gathered, seats) } : {}),
  });
}

// Parameterized by format so tests can create a match with a short
// clockMs/graceMs instead of the real 20s/15s, bypassing the queue entirely.
export async function createMatchForPlayers(
  userIds: string[],
  format: MatchFormat = formatFor('heads-up', true)
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
      for (const s of seats) hub.send(s.userId, { t: 'q', s: 'found', m: id, mode: format.mode, rated: format.rated });
      return id;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique match id');
}

async function launch(entries: QueuedPlayer[], botIds: string[], format: MatchFormat): Promise<void> {
  for (const e of entries) queue.delete(e.id);
  await createMatchForPlayers(shuffled([...entries.map((e) => e.id), ...botIds]), format);
}

function meanRating(entries: QueuedPlayer[]): number {
  if (entries.length === 0) return 1500;
  return entries.reduce((sum, e) => sum + e.rating, 0) / entries.length;
}

async function tickHeadsUp(entries: QueuedPlayer[], format: MatchFormat, now: number): Promise<void> {
  for (const [a, b] of pairQueue(entries, now)) {
    if (!queue.has(a.id) || !queue.has(b.id)) continue;
    await launch([a, b], [], format);
  }

  // Nobody left to pair with: give whoever has been waiting longest a bot
  // rather than an empty room.
  const waiting = entries.filter((e) => queue.has(e.id)).sort((a, b) => a.joinedAt - b.joinedAt);
  for (const entry of waiting) {
    if (now - entry.joinedAt < BOT_FILL_HEADS_UP_MS) continue;
    const [bot] = await availableBots(entry.rating, 1, format.mode);
    if (!bot) return;
    await launch([entry], [bot.id], format);
  }
}

async function tickMultiway(entries: QueuedPlayer[], format: MatchFormat, now: number): Promise<void> {
  for (const group of groupQueue(entries, format.players, now)) {
    if (group.some((e) => !queue.has(e.id))) continue;
    await launch(group, [], format);
  }

  const waiting = entries.filter((e) => queue.has(e.id)).sort((a, b) => a.joinedAt - b.joinedAt);
  if (waiting.length === 0) return;
  if (now - waiting[0].joinedAt < BOT_FILL_SIX_MAX_MS) return;

  const humans = waiting.slice(0, format.players);
  const bots = await availableBots(meanRating(humans), format.players - humans.length, format.mode);
  // Bots never fill a table with no human, and a short roster waits rather
  // than seating a table that isn't full.
  if (humans.length === 0 || humans.length + bots.length < format.players) return;
  await launch(
    humans,
    bots.map((b) => b.id),
    format
  );
}

// Exported so tests can pair a queue deterministically instead of waiting on
// the real interval.
export async function tick(): Promise<void> {
  const now = Date.now();
  const buckets = new Map<string, QueuedPlayer[]>();
  for (const entry of queue.values()) {
    const key = bucketKey(entry.mode, entry.rated);
    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  }

  for (const entries of buckets.values()) {
    const { mode, rated } = entries[0];
    const format = resolveFormat(mode, rated);
    if (format.players > 2) await tickMultiway(entries, format, now);
    else await tickHeadsUp(entries, format, now);
  }

  for (const entry of queue.values()) sendSearching(entry, countIn(entry.mode, entry.rated));
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
