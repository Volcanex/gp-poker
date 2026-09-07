import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, deleteUser } from './helpers.js';

describe('auth flow', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('mints a guest on first /api/me call', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.guest).toBe(true);
    expect(body.name).toMatch(/^guest-/);
    expect(body.rating).toBe(1500);
    // Session-scoped and always changing: never cacheable.
    expect(res.headers['cache-control']).toBe('no-store');
    // Flat fields are the heads-up standing; the per-mode map is the real one
    // and a player with no rows yet reads as a fresh 1500/350 in both.
    expect(Object.keys(body.ratings).sort()).toEqual(['heads-up', 'six-max']);
    expect(body.ratings['heads-up']).toEqual({
      rating: 1500,
      rd: 350,
      provisional: true,
      peak: 1500,
      peakAt: null,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    });
    expect(body.ratings['six-max'].rating).toBe(1500);
    // The flat fields are the heads-up standing's own values, so a client
    // falling back from a null standing to a flat field gets the same answer.
    expect(body.peak).toBe(body.ratings['heads-up'].peak);
    expect(body.peakAt).toBe(body.ratings['heads-up'].peakAt);
    expect(body.rating).toBe(body.ratings['heads-up'].rating);
    createdUserIds.push(body.id);
  });

  it('claims a guest into a named account, then logs in and out', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/me' });
    const token = me.cookies.find((c) => c.name === 'ot_session')!.value;
    const guestBody = me.json();
    createdUserIds.push(guestBody.id);

    const name = `claimtest${Date.now().toString(36)}`;
    const claim = await app.inject({
      method: 'POST',
      url: '/api/claim',
      cookies: { ot_session: token },
      payload: { name, password: 'correcthorse' },
    });
    expect(claim.statusCode).toBe(200);
    const claimed = claim.json();
    expect(claimed.guest).toBe(false);
    expect(claimed.name).toBe(name);
    expect(claimed.id).toBe(guestBody.id);

    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { name, password: 'wrongpassword' },
    });
    expect(badLogin.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { name, password: 'correcthorse' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().id).toBe(guestBody.id);
    const loginToken = login.cookies.find((c) => c.name === 'ot_session')!.value;

    const logout = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { ot_session: loginToken },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });

    // the session is gone, so the next /api/me mints a fresh guest
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { ot_session: loginToken },
    });
    expect(afterLogout.json().id).not.toBe(guestBody.id);
    createdUserIds.push(afterLogout.json().id);
  });
});
