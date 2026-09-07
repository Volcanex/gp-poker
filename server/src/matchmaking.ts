import { randomBytes } from 'node:crypto';
import { pairQueue, widenRd, window as ratingWindow, type QueueEntry } from '@opentable/rating';
import { DEFAULT_FORMAT, type MatchFormat } from '@opentable/protocol';
import { hub } from './ws/hub.js';
import { getUserById, insertMatch, insertMatchPlayers, type MatchSeat } from './db.js';
import { isUniqueViolation } from './pgError.js';
import { MatchRoom } from './match/room.js';
import { registerRoom } from './match/rooms.js';

export type { QueueEntry };

const MATCH_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // base32-ish, no ambiguous chars
const TICK_MS = 1000;

const queue = new Map<string, QueueEntry>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function randomMatchId(): string {
  let s = '';
  for (const b of randomBytes(8)) s += MATCH_ID_ALPHABET[b % MATCH_ID_ALPHABET.length];
  return s;
}

export async function enqueue(userId: string): Promise<void> {
  if (queue.has(userId)) return;
  const user = await getUserById(userId);
  if (!user) return;
  const daysInactive = (Date.now() - user.ratingAt.getTime()) / (24 * 60 * 60 * 1000);
  const widened = widenRd({ rating: user.rating, rd: user.rd, volatility: user.volatility }, daysInactive);
  const entry: QueueEntry = { id: userId, rating: user.rating, rd: widened.rd, joinedAt: Date.now() };
  queue.set(userId, entry);
  sendSearching(entry);
}

export function dequeue(userId: string): void {
  if (queue.delete(userId)) {
    hub.send(userId, { t: 'q', s: 'left' });
  }
}

function sendSearching(entry: QueueEntry): void {
  const now = Date.now();
  const window = ratingWindow(entry, now);
  const waited = Math.floor((now - entry.joinedAt) / 1000);
  // window() returns Infinity once the search is unbounded; that doesn't
  // survive JSON.stringify (becomes null), so drop the field instead of
  // passing it through raw.
  const range = Number.isFinite(window) ? window : undefined;
  hub.send(entry.id, { t: 'q', s: 'searching', w: waited, range });
}

// Parameterized by format so tests can create a match with a short
// clockMs/graceMs instead of the real 20s/15s, bypassing the queue entirely.
export async function createMatchForPlayers(
  userIdA: string,
  userIdB: string,
  format: MatchFormat = DEFAULT_FORMAT
): Promise<string> {
  const [userA, userB] = await Promise.all([getUserById(userIdA), getUserById(userIdB)]);
  if (!userA || !userB) throw new Error('both users must exist to create a match');

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomMatchId();
    const seats: MatchSeat[] = [
      { seat: 0, userId: userA.id, name: userA.name, rating: Math.round(userA.rating) },
      { seat: 1, userId: userB.id, name: userB.name, rating: Math.round(userB.rating) },
    ];
    try {
      const match = await insertMatch(id, format, seats, true);
      await insertMatchPlayers(id, [
        { userId: userA.id, seat: 0 },
        { userId: userB.id, seat: 1 },
      ]);
      const room = new MatchRoom(match);
      registerRoom(room);
      await room.start();
      hub.send(userA.id, { t: 'q', s: 'found', m: id });
      hub.send(userB.id, { t: 'q', s: 'found', m: id });
      return id;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique match id');
}

// Exported so tests can pair a queue deterministically instead of waiting on
// the real interval.
export async function tick(): Promise<void> {
  const now = Date.now();
  if (queue.size >= 2) {
    const pairs = pairQueue([...queue.values()], now);
    for (const [a, b] of pairs) {
      queue.delete(a.id);
      queue.delete(b.id);
      await createMatchForPlayers(a.id, b.id);
    }
  }
  for (const entry of queue.values()) sendSearching(entry);
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
