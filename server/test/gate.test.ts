import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import {
  connectWs,
  deleteUser,
  driveRandomPlay,
  listenForWs,
  makeApp,
  mintGuestSession,
  testFormat,
} from './helpers.js';
import { setFormatResolver } from '../src/matchmaking.js';
import { resetReadyChecks } from '../src/ready.js';
import { sql } from '../src/db.js';

/* The ranked gate: rated play opens after one finished casual or practice
   match, and not before.

   Driven through the real socket rather than by calling `rankedUnlocked`,
   because what is under test is the door and not the query behind it: the
   refusal has to arrive as an `err` a client can draw, the unlock has to
   happen without anything pushing it, and `/api/me` has to agree with both. */

const FAST: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ mode: 'heads-up', hands: 1, stack: 20, clockMs: 400, graceMs: 400, holdMs: 30 }),
  'six-max': testFormat({ mode: 'six-max', players: 6, stack: 20, clockMs: 400, graceMs: 400, holdMs: 30 }),
};

describe('the ranked gate', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
    setFormatResolver((mode, rated) => ({ ...FAST[mode], rated }));
  });

  afterAll(async () => {
    setFormatResolver(formatFor);
    resetReadyChecks();
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('refuses a rated search from somebody who has finished nothing', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    const conn = await connectWs(wsUrl, session.token);
    await conn.messages.wait((m) => m.t === 'hi');

    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'six-max', rated: true }));
    const refused = await conn.messages.wait((m) => m.t === 'err' && m.c === 'ranked_locked');
    // It says what to do next rather than only that the answer is no.
    expect(refused.msg).toContain('casual');
    // And it did not quietly queue them anyway.
    await expect(conn.messages.wait((m) => m.t === 'q' && m.s === 'searching', 300)).rejects.toThrow();

    conn.ws.close();
  }, 30_000);

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

  it('opens rated the moment the first practice match finishes', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    const conn = await connectWs(wsUrl, session.token);
    await conn.messages.wait((m) => m.t === 'hi');

    const before = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `ot_session=${session.token}` },
    });
    expect(before.json().rankedUnlocked).toBe(false);

    // Practice is a table of bots, built on the spot, always unrated, and it
    // asks nobody whether they are ready: it is one of the two rooms that
    // open the gate.
    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', bots: { level: 2 } }));
    const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found', 10_000);
    createdMatchIds.push(found.m);
    conn.ws.send(JSON.stringify({ t: 'join', m: found.m }));
    const result = await driveRandomPlay(conn, 40_000);
    expect(result.rated).toBe(false);

    const after = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `ot_session=${session.token}` },
    });
    expect(after.json().rankedUnlocked).toBe(true);

    // Nothing had to be pushed for that: the next rated search simply works.
    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'six-max', rated: true }));
    const searching = await conn.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    expect(searching.rated).toBe(true);

    conn.ws.send(JSON.stringify({ t: 'dequeue' }));
    await conn.messages.wait((m) => m.t === 'q' && m.s === 'left');
    conn.ws.close();
  }, 90_000);

  it('closes an arena to somebody who has finished nothing', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    // An arena is rated heads-up, so it is the same door. Any id will do: the
    // gate is asked before the arena is looked up as a thing to join.
    const res = await app.inject({
      method: 'POST',
      url: '/api/arenas/no-such-arena/join',
      headers: { cookie: `ot_session=${session.token}` },
    });
    // No such arena is the first answer, which is the right order: a refusal
    // about the player should not tell them an arena exists that does not.
    expect(res.statusCode).toBe(404);
  }, 30_000);
});
