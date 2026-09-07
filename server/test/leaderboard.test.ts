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
    await sql`update users set rd = 60, rating = 2400 where id = ${settled.id}`;

    const res = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().map((r: { name: string }) => r.name);

    expect(names).toContain(settled.name);
    expect(names).not.toContain(provisional.name);
  });
});
