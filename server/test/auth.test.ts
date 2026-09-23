import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { isGeneratedName } from '@opentable/identity';
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

  /* Reading never mints: a crawler runs the page and fetches /api/me, and in
     September 2026 that left 12.7k guest rows in a day. */
  it('answers /api/me with null and no cookie for a visitor with no session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBe(null);
    expect(res.cookies.find((c) => c.name === 'ot_session')).toBeUndefined();
  });

  it('never mints on the reads a page makes on load', async () => {
    for (const url of ['/api/arenas', '/api/tournaments']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.cookies.find((c) => c.name === 'ot_session'), url).toBeUndefined();
    }
    const friends = await app.inject({ method: 'GET', url: '/api/friends' });
    expect(friends.statusCode).toBe(401);
    expect(friends.cookies.find((c) => c.name === 'ot_session')).toBeUndefined();
  });

  it('mints a guest on POST /api/session, and answers the same one again', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/session' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.guest).toBe(true);
    expect(isGeneratedName(body.name)).toBe(true);
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

    const token = res.cookies.find((c) => c.name === 'ot_session')!.value;
    const again = await app.inject({ method: 'POST', url: '/api/session', cookies: { ot_session: token } });
    expect(again.json().id).toBe(body.id);
    const read = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: token } });
    expect(read.json().id).toBe(body.id);
  });

  it('claims a guest into a named account, then logs in and out', async () => {
    const me = await app.inject({ method: 'POST', url: '/api/session' });
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

    // the session is gone, so /api/me reads nobody
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { ot_session: loginToken },
    });
    expect(afterLogout.json()).toBe(null);
  });

  it('renames a guest, then refuses a name someone else already has', async () => {
    const me = await app.inject({ method: 'POST', url: '/api/session' });
    const token = me.cookies.find((c) => c.name === 'ot_session')!.value;
    const guestBody = me.json();
    createdUserIds.push(guestBody.id);

    const other = await app.inject({ method: 'POST', url: '/api/session' });
    const otherToken = other.cookies.find((c) => c.name === 'ot_session')!.value;
    const otherBody = other.json();
    createdUserIds.push(otherBody.id);
    const otherName = `renametaken${Date.now().toString(36)}`;
    const claimOther = await app.inject({
      method: 'POST',
      url: '/api/claim',
      cookies: { ot_session: otherToken },
      payload: { name: otherName, password: 'correcthorse' },
    });
    expect(claimOther.statusCode).toBe(200);

    const taken = await app.inject({
      method: 'POST',
      url: '/api/rename',
      cookies: { ot_session: token },
      payload: { name: otherName.toUpperCase() },
    });
    expect(taken.statusCode).toBe(400);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/rename',
      cookies: { ot_session: token },
      payload: { name: 'a b' },
    });
    expect(bad.statusCode).toBe(400);

    const newName = `renamed${Date.now().toString(36)}`;
    const renamed = await app.inject({
      method: 'POST',
      url: '/api/rename',
      cookies: { ot_session: token },
      payload: { name: newName },
    });
    expect(renamed.statusCode).toBe(200);
    const renamedBody = renamed.json();
    expect(renamedBody.id).toBe(guestBody.id);
    expect(renamedBody.name).toBe(newName);
    // Still a guest: renaming does not claim the account.
    expect(renamedBody.guest).toBe(true);

    const lookup = await app.inject({ method: 'GET', url: `/api/users/${newName}` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().summary.id).toBe(guestBody.id);

    const stale = await app.inject({ method: 'GET', url: `/api/users/${guestBody.name}` });
    expect(stale.statusCode).toBe(404);
  });
});
