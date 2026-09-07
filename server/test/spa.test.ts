import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

describe('static/SPA fallback', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves index.html for an unknown client route', async () => {
    const res = await app.inject({ method: 'GET', url: '/match/abcd1234' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('does not fall back to index.html for an unknown /api route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('does not fall back to index.html for /ws without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/ws' });
    expect(res.statusCode).toBe(401);
  });
});
