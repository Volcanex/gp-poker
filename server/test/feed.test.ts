import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { formatFor } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser } from './helpers.js';
import { sql } from '../src/db.js';

/* The feed routes read `matches` directly, so these fixtures are match rows
   rather than played-out matches: what is under test is the shape the home
   page and the watch list read, not the engine that fills the table. Every
   id is suffixed so a file running beside this one cannot collide with it. */

const tag = randomBytes(4).toString('hex');
const id = (name: string) => `${name}-${tag}`;

interface SeatFixture {
  seat: number;
  userId: string;
  name: string;
  rating: number;
  bot: boolean;
}

async function insertFinished(
  matchId: string,
  seats: SeatFixture[],
  opts: {
    mode?: 'heads-up' | 'six-max';
    rated?: boolean;
    handsPlayed?: number;
    finishedAt: Date;
    status?: 'finished' | 'aborted';
    places?: Record<string, number>;
    ratings?: Record<string, { before: number; after: number; rdBefore: number; rdAfter: number }>;
  }
): Promise<void> {
  const format = { ...formatFor(opts.mode ?? 'heads-up', opts.rated ?? true) };
  await sql`
    insert into matches (id, format, rated, seats, status, reason, hands_played, places, ratings, finished_at)
    values (
      ${matchId},
      ${sql.json(format as never)},
      ${opts.rated ?? true},
      ${sql.json(seats as never)},
      ${opts.status ?? 'finished'},
      'bust',
      ${opts.handsPlayed ?? 0},
      ${opts.places ? sql.json(opts.places as never) : null},
      ${opts.ratings ? sql.json(opts.ratings as never) : null},
      ${opts.finishedAt}
    )
  `;
}

async function insertPlaying(matchId: string, seats: SeatFixture[], handsPlayed = 0): Promise<void> {
  await sql`
    insert into matches (id, format, rated, seats, status, hands_played)
    values (
      ${matchId},
      ${sql.json({ ...formatFor('heads-up', true) } as never)},
      true,
      ${sql.json(seats as never)},
      'playing',
      ${handsPlayed}
    )
  `;
}

function seat(n: number, userId: string, name: string, bot = false): SeatFixture {
  return { seat: n, userId, name, rating: 1500, bot };
}

describe('the feed routes', () => {
  let app: FastifyInstance;
  const userIds: string[] = [];
  const matchIds: string[] = [];
  let winner: { id: string; name: string };
  let loser: { id: string; name: string };

  beforeAll(async () => {
    app = await makeApp();
    winner = await mintGuestSession(app);
    loser = await mintGuestSession(app);
    userIds.push(winner.id, loser.id);

    const older = id('older');
    const newer = id('newer');
    const aborted = id('aborted');
    const live = id('live');
    const botsOnly = id('bots-only');
    matchIds.push(older, newer, aborted, live, botsOnly);

    await insertFinished(older, [seat(0, winner.id, winner.name), seat(1, loser.id, loser.name)], {
      handsPlayed: 12,
      finishedAt: new Date(Date.now() - 60_000),
      places: { [winner.id]: 1, [loser.id]: 2 },
      ratings: {
        [winner.id]: { before: 1500, after: 1522.4, rdBefore: 350, rdAfter: 290 },
        [loser.id]: { before: 1500, after: 1477.6, rdBefore: 350, rdAfter: 290 },
      },
    });

    // Seat order deliberately puts the loser first: the route sorts by place.
    await insertFinished(newer, [seat(0, loser.id, loser.name), seat(1, 'bot-seat', 'Otter', true)], {
      handsPlayed: 25,
      rated: false,
      finishedAt: new Date(),
      places: { [loser.id]: 2, 'bot-seat': 1 },
    });

    await insertFinished(aborted, [seat(0, winner.id, winner.name), seat(1, loser.id, loser.name)], {
      status: 'aborted',
      finishedAt: new Date(),
    });

    await insertPlaying(live, [seat(0, winner.id, winner.name), seat(1, 'bot-seat', 'Otter', true)], 3);
    await insertPlaying(botsOnly, [seat(0, 'bot-a', 'Otter', true), seat(1, 'bot-b', 'Heron', true)]);

    await sql`
      insert into hands (id, match_id, number, seed_hash, button, stacks_start, completed_at)
      values (${`${older}-1`}, ${older}, 1, 'deadbeef', 0, ${sql.json([200, 200] as never)}, now())
    `;
  });

  afterAll(async () => {
    for (const m of matchIds) await sql`delete from matches where id = ${m}`;
    for (const u of userIds) await deleteUser(u);
    await app.close();
  });

  it('lists finished matches newest first, with the winner first in each row', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recent?limit=50' });
    expect(res.statusCode).toBe(200);
    const rows: {
      id: string;
      mode: string;
      rated: boolean;
      practice: boolean;
      handsPlayed: number;
      finishedAt: string;
      players: { name: string; bot: boolean; place: number | null; ratingBefore: number | null; ratingAfter: number | null }[];
    }[] = res.json();

    const older = rows.findIndex((r) => r.id === id('older'));
    const newer = rows.findIndex((r) => r.id === id('newer'));
    expect(older).toBeGreaterThan(-1);
    expect(newer).toBeGreaterThan(-1);
    expect(newer).toBeLessThan(older);

    const row = rows[older];
    expect(row.mode).toBe('heads-up');
    expect(row.rated).toBe(true);
    expect(row.practice).toBe(false);
    expect(row.handsPlayed).toBe(12);
    expect(row.players.map((p) => p.name)).toEqual([winner.name, loser.name]);
    // Rating changes are rounded on the way out, the way every other route
    // rounds them, so a fraction never reaches a screen.
    expect(row.players[0].ratingAfter).toBe(1522);
    expect(row.players[1].ratingAfter).toBe(1478);

    // Places decide the order, not the seat number, and a bot is flagged.
    const bots = rows[newer];
    expect(bots.rated).toBe(false);
    expect(bots.players[0]).toMatchObject({ name: 'Otter', bot: true, place: 1 });
    expect(bots.players[1]).toMatchObject({ name: loser.name, bot: false, place: 2 });
    expect(bots.players[1].ratingAfter).toBeNull();
  });

  it('leaves aborted matches out', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recent?limit=50' });
    expect(res.json().map((r: { id: string }) => r.id)).not.toContain(id('aborted'));
  });

  it('caps and defaults the limit', async () => {
    const capped = await app.inject({ method: 'GET', url: '/api/recent?limit=999' });
    expect(capped.json().length).toBeLessThanOrEqual(50);
    const bogus = await app.inject({ method: 'GET', url: '/api/recent?limit=nonsense' });
    expect(bogus.statusCode).toBe(200);
    expect(bogus.json().length).toBeLessThanOrEqual(20);
  });

  it('lists live matches with a person at the table, and only those', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/live' });
    expect(res.statusCode).toBe(200);
    const rows: { id: string; hand: number; players: { name: string; bot: boolean }[]; startedAt: string }[] = res.json();

    const row = rows.find((r) => r.id === id('live'));
    expect(row).toBeDefined();
    // Three hands finished, so the table is on hand four.
    expect(row!.hand).toBe(4);
    expect(row!.players.map((p) => p.bot)).toEqual([false, true]);
    expect(row!.startedAt).toBeTruthy();

    expect(rows.map((r) => r.id)).not.toContain(id('bots-only'));
  });

  it('counts the site, and serves the counts from a short cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.online).toBeGreaterThanOrEqual(0);
    expect(body.inQueue).toBeGreaterThanOrEqual(0);
    expect(body.playing).toBeGreaterThanOrEqual(1);
    expect(body.matchesToday).toBeGreaterThanOrEqual(2);
    expect(body.handsTotal).toBeGreaterThanOrEqual(1);
    expect(body.playersTotal.guest).toBeGreaterThanOrEqual(2);
    expect(body.playersTotal.registered).toBeGreaterThanOrEqual(0);

    // A match finishing inside the cache window does not move the numbers:
    // the strip is polled by every open tab and none of this is worth a
    // round trip per viewer.
    const extra = id('cached');
    matchIds.push(extra);
    await insertFinished(extra, [seat(0, winner.id, winner.name), seat(1, loser.id, loser.name)], {
      finishedAt: new Date(),
    });
    const again = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(again.json()).toEqual(body);
  });
});
