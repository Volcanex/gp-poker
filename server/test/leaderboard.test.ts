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
    const names: string[] = res.json().map((r: { name: string }) => r.name);

    expect(names).toContain(settled.name);
    expect(names).not.toContain(provisional.name);
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
