import { randomBytes } from 'node:crypto';
import { pairQueue, widenRd, window as ratingWindow, type QueueEntry } from '@opentable/rating';
import { DEFAULT_FORMAT } from '@opentable/protocol';
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
  const range = ratingWindow(entry, now);
  const waited = Math.floor((now - entry.joinedAt) / 1000);
  hub.send(entry.id, { t: 'q', s: 'searching', w: waited, range });
}

async function createMatch(a: QueueEntry, b: QueueEntry): Promise<void> {
  const [userA, userB] = await Promise.all([getUserById(a.id), getUserById(b.id)]);
  if (!userA || !userB) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomMatchId();
    const seats: MatchSeat[] = [
      { seat: 0, userId: userA.id, name: userA.name },
      { seat: 1, userId: userB.id, name: userB.name },
    ];
    try {
      const match = await insertMatch(id, DEFAULT_FORMAT, seats, true);
      await insertMatchPlayers(id, [
        { userId: userA.id, seat: 0 },
        { userId: userB.id, seat: 1 },
      ]);
      registerRoom(new MatchRoom(match));
      hub.send(userA.id, { t: 'q', s: 'found', m: id });
      hub.send(userB.id, { t: 'q', s: 'found', m: id });
      return;
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
      await createMatch(a, b);
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
