import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { connectWs, deleteUser, listenForWs, makeApp, mintGuestSession } from './helpers.js';
import { resetReadyChecks } from '../src/ready.js';

/* The rated door, and that a brand new guest walks straight through it.

   There was a gate here until this was written: rated play opened only after
   one finished casual or practice match, so that nobody's first ever hand
   moved a rating they had not noticed they had. It went because it was the
   first thing a visitor met and it read as a chore, and because the ladder
   never rested on it. The leaderboard drops anybody still provisional
   (`rd <= 110`, in `getLeaderboard`), so a fresh account cannot reach the
   board however many rated matches it queues for, gate or no gate.

   The cooldown and the walkout ban are still on this door and have their own
   tests. What is under test here is that nothing else stands in front of it,
   and that `/api/me` no longer describes a gate that is gone. */

describe('the rated door', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    resetReadyChecks();
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  /* Both modes, because the gate was asked before the mode was looked at and
     a mode-shaped remnant of it would be invisible in only one of them. */
  for (const mode of ['six-max', 'heads-up'] as const) {
    it(`lets a brand new guest straight into a rated ${mode} search`, async () => {
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectWs(wsUrl, session.token);
      await conn.messages.wait((m) => m.t === 'hi');

      conn.ws.send(JSON.stringify({ t: 'queue', mode, rated: true }));
      const searching = await conn.messages.wait((m) => m.t === 'q' && m.s === 'searching');
      // And it is the rated search that was asked for, not a casual one
      // entered on its behalf.
      expect(searching.rated).toBe(true);

      conn.ws.send(JSON.stringify({ t: 'dequeue' }));
      await conn.messages.wait((m) => m.t === 'q' && m.s === 'left');
      conn.ws.close();
    }, 30_000);
  }

  it('lets casual through untouched', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    const conn = await connectWs(wsUrl, session.token);
    await conn.messages.wait((m) => m.t === 'hi');

    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'six-max', rated: false }));
    const searching = await conn.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    expect(searching.rated).toBe(false);

    conn.ws.send(JSON.stringify({ t: 'dequeue' }));
    await conn.messages.wait((m) => m.t === 'q' && m.s === 'left');
    conn.ws.close();
  }, 30_000);

  it('does not describe a gate on /api/me', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `ot_session=${session.token}` },
    });
    /* Absent rather than true. The client reads a missing field as open, so
       an older client talking to this server behaves correctly; a field left
       permanently true would be a gate nobody can close, kept on the wire for
       no reader. */
    expect(res.json()).not.toHaveProperty('rankedUnlocked');
  }, 30_000);
});
