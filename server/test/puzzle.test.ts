import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { formatFor } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser } from './helpers.js';
import { sql } from '../src/db.js';

/* /api/puzzles/hand picks a hand at random from everything the site has
   stored, so this file cannot assert which hand comes back: another test file
   running beside it has hands in the same database. What it can assert is that
   one comes back at all once a gradeable hand exists, and that everything the
   client needs to replay it and grade it is in the payload and internally
   consistent. */

const tag = randomBytes(4).toString('hex');
const matchId = `puz-${tag}`;

describe('the real-hand puzzle route', () => {
  let app: FastifyInstance;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    const one = await mintGuestSession(app);
    const two = await mintGuestSession(app);
    userIds.push(one.id, two.id);

    const seats = [
      { seat: 0, userId: one.id, name: one.name, rating: 1500, bot: false },
      { seat: 1, userId: two.id, name: two.name, rating: 1500, bot: false },
    ];
    await sql`
      insert into matches (id, format, rated, seats, status, reason, hands_played, finished_at)
      values (
        ${matchId},
        ${sql.json({ ...formatFor('heads-up', true) } as never)},
        true,
        ${sql.json(seats as never)},
        'finished',
        'bust',
        1,
        now()
      )
    `;
    // The button raises and the big blind folds: two logged actions, both of
    // them spots the charts have an answer for.
    await sql`
      insert into hands (
        id, match_id, number, seed_hash, seed, button, stacks_start, live_seats,
        actions, board, holes, result, completed_at
      ) values (
        ${`${matchId}-1`}, ${matchId}, 1,
        ${randomBytes(32).toString('hex')}, ${randomBytes(32).toString('hex')},
        0, ${sql.json([200, 200] as never)}, ${[0, 1]},
        ${sql.json([{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'f' }] as never)},
        ${[]},
        ${sql.json({ 0: ['Ah', 'Kd'], 1: ['7c', '2d'] } as never)},
        ${sql.json({ pots: [], awards: [], shown: {} } as never)},
        now()
      )
    `;
  });

  afterAll(async () => {
    await sql`delete from matches where id = ${matchId}`;
    for (const id of userIds) await deleteUser(id);
  });

  it('hands over one decision with everything needed to replay and grade it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/puzzles/hand' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.seats).toHaveLength(2);
    expect(typeof body.seed).toBe('string');
    expect(body.stacksStart.length).toBeGreaterThanOrEqual(2);
    expect(body.bb).toBeGreaterThan(0);

    // The decision points into the log rather than describing it, so the
    // client can replay exactly the actions that came before it.
    expect(body.logIndex).toBeGreaterThanOrEqual(0);
    expect(body.logIndex).toBeLessThan(body.actions.length);
    expect(body.actions[body.logIndex].s).toBe(body.seat);
    expect(body.seat).toBe(body.position === 'sb' ? body.button : 1 - body.button);

    expect(['deep', 'mid', 'short', 'push']).toContain(body.bucket);
    expect(['sb_open', 'bb_vs_open', 'sb_vs_3bet', 'bb_vs_4bet', 'sb_push', 'bb_vs_push']).toContain(body.spot);
    expect(['aggr', 'passive', 'fold']).toContain(body.played);
    expect(body.cards).toHaveLength(2);
    expect(body.hand).toMatch(/^[AKQJT2-9]{2}[so]?$/);
  });
});
