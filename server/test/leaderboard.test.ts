import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, mintGuestSession, deleteUser } from './helpers.js';
import { sql } from '../src/db.js';

describe('GET /api/leaderboard', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('excludes provisional players (rd > 110)', async () => {
    const settled = await mintGuestSession(app);
    const provisional = await mintGuestSession(app);
    createdUserIds.push(settled.id, provisional.id);

    // settled: rd well below the provisional threshold and a very high
    // rating so it's easy to spot; provisional: left at its default rd 350.
    // The board reads the per-mode ratings table, not the legacy columns.
    await sql`
      insert into ratings (user_id, mode, rating, rd) values (${settled.id}, 'heads-up', 2400, 60)
      on conflict (user_id, mode) do update set rating = 2400, rd = 60
    `;

    const res = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(res.statusCode).toBe(200);
    const rows: { id: string; name: string }[] = res.json();

    const settledRow = rows.find((r) => r.name === settled.name);
    expect(settledRow).toBeDefined();
    expect(settledRow!.id).toBe(settled.id);
    expect(rows.map((r) => r.name)).not.toContain(provisional.name);
  });

  it('is per mode: a six-max standing does not appear on the heads-up board', async () => {
    const player = await mintGuestSession(app);
    createdUserIds.push(player.id);
    await sql`
      insert into ratings (user_id, mode, rating, rd) values (${player.id}, 'six-max', 2600, 50)
      on conflict (user_id, mode) do update set rating = 2600, rd = 50
    `;

    const headsUp = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(headsUp.json().map((r: { name: string }) => r.name)).not.toContain(player.name);

    const sixMax = await app.inject({ method: 'GET', url: '/api/leaderboard?mode=six-max' });
    const row = sixMax.json().find((r: { name: string }) => r.name === player.name);
    expect(row).toBeDefined();
    expect(row.rating).toBe(2600);

    // An unknown mode falls back to heads-up rather than erroring.
    const bogus = await app.inject({ method: 'GET', url: '/api/leaderboard?mode=nonsense' });
    expect(bogus.statusCode).toBe(200);
    expect(bogus.json().map((r: { name: string }) => r.name)).not.toContain(player.name);
  });
});

describe('GET /api/users/:name', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('carries the per-mode standings and a mode-keyed rating history', async () => {
    const player = await mintGuestSession(app);
    createdUserIds.push(player.id);

    const res = await app.inject({ method: 'GET', url: `/api/users/${player.name}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.summary.id).toBe(player.id);
    expect(Object.keys(body.summary.ratings).sort()).toEqual(['heads-up', 'six-max']);
    for (const mode of ['heads-up', 'six-max']) {
      const standing = body.summary.ratings[mode];
      expect(standing.rating).toBe(1500);
      expect(standing.provisional).toBe(true);
      expect(standing.peak).toBe(1500);
      expect(standing.peakAt).toBeNull();
      expect(standing.matches).toBe(0);
    }

    // History is grouped by mode rather than one line with both spliced in.
    expect(Object.keys(body.ratingHistory).sort()).toEqual(['heads-up', 'six-max']);
    expect(body.ratingHistory['heads-up']).toEqual([]);
    expect(body.ratingHistory['six-max']).toEqual([]);

    // Flat fields stay heads-up for compatibility, and are read off the
    // heads-up standing so the two can never disagree.
    const headsUp = body.summary.ratings['heads-up'];
    expect(body.peak).toBe(headsUp.peak);
    expect(body.peakAt).toBe(headsUp.peakAt);
    expect(body.provisional).toBe(headsUp.provisional);
    expect(body.matches).toBe(headsUp.matches);
    expect(body.peakAt).toBeNull();
  });

  it('404s an unknown name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users/nobody-here' });
    expect(res.statusCode).toBe(404);
  });
});

/* Percentiles are the one number on the profile that is about everybody else,
   so what counts as everybody else is the whole test: five people who have
   played, two bots who also hold ratings, and nobody who has only ever been
   handed a default 1500.

   The five are seated above every other rated player in the database rather
   than in the middle of it, so their ranks are 1, 3 and 5 whatever else the
   suite has left lying around, and the percentiles are checked against the
   field size the route actually reports. A test that pinned the population to
   five would be testing how clean the test database happens to be. */
describe('GET /api/users/:name percentiles', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const players: { id: string; name: string; rating: number }[] = [];
  const RATINGS = [3900, 3800, 3700, 3600, 3500];
  const BOT_RATINGS = [3850, 3650];

  beforeAll(async () => {
    app = await makeApp();

    for (const rating of RATINGS) {
      const player = await mintGuestSession(app);
      createdUserIds.push(player.id);
      players.push({ ...player, rating });
      await sql`
        insert into ratings (user_id, mode, rating, rd, matches, wins, losses, draws)
        values (${player.id}, 'heads-up', ${rating}, 90, 10, 5, 5, 0)
        on conflict (user_id, mode) do update set rating = ${rating}, rd = 90, matches = 10
      `;
    }

    // Two bots rated straight through the middle of that field. They hold
    // rating rows like anybody else, which is exactly why they have to be
    // excluded rather than assumed absent.
    for (const [i, rating] of BOT_RATINGS.entries()) {
      const name = `PercentileBot${i + 1}`;
      const [bot] = await sql<{ id: string }[]>`
        insert into users (name, name_lower, guest, bot, bot_level)
        values (${name}, ${name.toLowerCase()}, false, true, 4)
        returning id
      `;
      createdUserIds.push(bot.id);
      await sql`
        insert into ratings (user_id, mode, rating, rd, matches)
        values (${bot.id}, 'heads-up', ${rating}, 90, 10)
      `;
    }
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  const standing = async (name: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/users/${name}` });
    expect(res.statusCode).toBe(200);
    return res.json().percentiles['heads-up'];
  };

  // The share of the field rated strictly below somebody, to one decimal:
  // the same arithmetic the route does, written out here rather than reused.
  const shareBelow = (below: number, population: number) =>
    Math.round((below / population) * 1000) / 10;

  it('ranks a player among the humans who have played, and nobody else', async () => {
    const top = await standing(players[0].name);
    const middle = await standing(players[2].name);
    const bottom = await standing(players[4].name);

    // The two bots are rated between these five and are still neither above
    // nor below any of them, so the top of the field is rank 1 and not rank 2.
    expect(top.rank).toBe(1);
    expect(middle.rank).toBe(3);
    expect(bottom.rank).toBe(5);

    const field = top.population;
    expect(field).toBeGreaterThanOrEqual(5);
    expect(middle.population).toBe(field);
    expect(bottom.population).toBe(field);

    // Four of the five are below the top one, and everything outside the five
    // is below all of them, which is what a field of `field` minus five adds.
    expect(top.percentile).toBe(shareBelow(field - 1, field));
    expect(middle.percentile).toBe(shareBelow(field - 3, field));
    expect(bottom.percentile).toBe(shareBelow(field - 5, field));

    // A field of exactly these five would read 80, 40 and 0: the share below,
    // not the share at or below, so the best of five is not 100.
    expect(top.percentile).toBeGreaterThan(middle.percentile);
    expect(middle.percentile).toBeGreaterThan(bottom.percentile);
  });

  it('leaves out a mode with no rated match behind it, and a bot entirely', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/users/${players[0].name}` });
    expect(res.json().percentiles['six-max']).toBeNull();

    const bot = await app.inject({ method: 'GET', url: '/api/users/percentilebot1' });
    expect(bot.statusCode).toBe(200);
    expect(bot.json().percentiles['heads-up']).toBeNull();
  });

  it('calls the mode with the most rated matches main, the rating breaking a tie', async () => {
    const player = players[1];
    const headsUp = await app.inject({ method: 'GET', url: `/api/users/${player.name}` });
    expect(headsUp.json().main).toBe('heads-up');

    // More six-max matches than heads-up, so six-max is where they play even
    // though their heads-up rating is far higher.
    await sql`
      insert into ratings (user_id, mode, rating, rd, matches)
      values (${player.id}, 'six-max', 1400, 90, 30)
      on conflict (user_id, mode) do update set rating = 1400, matches = 30
    `;
    const sixMax = await app.inject({ method: 'GET', url: `/api/users/${player.name}` });
    expect(sixMax.json().main).toBe('six-max');
  });
});
