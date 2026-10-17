import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { formatFor } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser } from './helpers.js';
import * as db from '../src/db.js';
import { sql } from '../src/db.js';

/* The profile route used to run two full scans of a user's hands. These tests
   pin the two things that replaced them: the combined query returns exactly
   what the two old ones did, and a profile read memoises on the user's latest
   finished match. */

const tag = randomBytes(4).toString('hex');
const matchA = `pa-a-${tag}`;
const matchB = `pa-b-${tag}`;

async function seedMatch(id: string, userId: string, otherId: string, seat: number) {
  const seats = [
    { seat, userId, name: 'x', rating: 1500, bot: false },
    { seat: 1 - seat, userId: otherId, name: 'y', rating: 1500, bot: false },
  ];
  await sql`
    insert into matches (id, format, rated, seats, status, reason, hands_played, finished_at)
    values (${id}, ${sql.json({ ...formatFor('heads-up', true) } as never)}, true,
      ${sql.json(seats as never)}, 'finished', 'bust', 0, now())
  `;
  await sql`insert into match_players (match_id, user_id, seat) values (${id}, ${userId}, ${seat})`;
  await sql`insert into match_players (match_id, user_id, seat) values (${id}, ${otherId}, ${1 - seat})`;
}

async function seedHand(
  matchId: string,
  n: number,
  opts: { stats: unknown; study: unknown; completed?: boolean }
) {
  await sql`
    insert into hands (id, match_id, number, seed_hash, seed, button, stacks_start, live_seats,
      actions, board, holes, result, stats, study, completed_at)
    values (${`${matchId}-${n}`}, ${matchId}, ${n},
      ${randomBytes(32).toString('hex')}, ${randomBytes(32).toString('hex')},
      0, ${sql.json([200, 200] as never)}, ${[0, 1]},
      ${sql.json([] as never)}, ${[]}, ${sql.json({} as never)},
      ${sql.json({ pots: [], awards: [], shown: {} } as never)},
      ${opts.stats === null ? null : sql.json(opts.stats as never)},
      ${opts.study === null ? null : sql.json(opts.study as never)},
      ${opts.completed === false ? null : new Date()})
  `;
}

describe('profile hand aggregates', () => {
  let app: FastifyInstance;
  let userId = '';
  let userName = '';
  let otherId = '';

  beforeAll(async () => {
    app = await makeApp();
    const one = await mintGuestSession(app);
    const two = await mintGuestSession(app);
    userId = one.id;
    userName = one.name;
    otherId = two.id;
    await seedMatch(matchA, userId, otherId, 1);
    const st = (v: boolean, p: boolean, f3: boolean, ft: boolean, a: number, pa: number) => ({
      1: { vpip: v, pfr: p, faced3bet: f3, foldTo3bet: ft, aggr: a, passive: pa },
      0: { vpip: false, pfr: false, faced3bet: false, foldTo3bet: false, aggr: 9, passive: 9 },
    });
    const sd = (count: number, accuracy: number) => ({
      1: { summary: { count, accuracy } },
      0: { summary: { count: 5, accuracy: 1 } },
    });
    await seedHand(matchA, 1, { stats: st(true, true, true, false, 3, 1), study: sd(2, 80) });
    await seedHand(matchA, 2, { stats: st(true, false, true, true, 1, 2), study: sd(0, 100) });
    await seedHand(matchA, 3, { stats: null, study: sd(1, 40) });
    await seedHand(matchA, 4, { stats: st(false, false, false, false, 5, 5), study: null });
    await seedHand(matchA, 5, { stats: st(true, true, true, true, 7, 7), study: sd(3, 10), completed: false });
  });

  afterAll(async () => {
    await sql`delete from matches where id in (${matchA}, ${matchB})`;
    await deleteUser(userId);
    await deleteUser(otherId);
  });

  it('the combined query returns exactly what the two old ones did', async () => {
    const stats = await db.getUserHandStats(userId);
    const accuracy = await db.getUserPreflopAccuracy(userId);
    expect(stats.totalHands).toBe(3);
    expect(accuracy).toBe(60);
    const combined = await db.getUserHandAggregates(userId);
    expect(combined).toEqual({ stats, accuracy });
  });

  it('a user with no hands gets zeroes and a null accuracy', async () => {
    const combined = await db.getUserHandAggregates(randomUUID());
    expect(combined.stats.totalHands).toBe(0);
    expect(combined.accuracy).toBeNull();
  });

  it('a second profile read runs no hands aggregate until a new match finishes', async () => {
    const spy = vi.spyOn(db, 'getUserHandAggregates');
    const url = `/api/users/${encodeURIComponent(userName)}`;
    const first = await app.inject({ method: 'GET', url });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url });
    expect(second.json()).toEqual(first.json());
    expect(spy).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 5));
    await seedMatch(matchB, userId, otherId, 1);
    await seedHand(matchB, 1, {
      stats: { 1: { vpip: true, pfr: true, faced3bet: false, foldTo3bet: false, aggr: 1, passive: 0 } },
      study: null,
    });
    const third = await app.inject({ method: 'GET', url });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(third.json().stats.hands).toBe(4);
    spy.mockRestore();
  });
});
