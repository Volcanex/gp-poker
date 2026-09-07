import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with ok and a db check even while the process is healthy', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.db.ok).toBe(true);
  });
});
