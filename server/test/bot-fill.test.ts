import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { connectWs, deleteUser, listenForWs, makeApp, mintGuestSession } from './helpers.js';
import { configureMatchmaking, dequeue, resetMatchmakingConfig, tick } from '../src/matchmaking.js';
import { resetReadyChecks } from '../src/ready.js';
import { sql } from '../src/db.js';

/* Bot fill has two thresholds, not two constants nobody can tell apart on
   sight: alone in the whole queue, a bot is worth bringing in fast; another
   real human searching for anything at all, worth fifteen extra real seconds
   of patience on a site this size. The suite runs both at a few hundred
   milliseconds rather than the real 30s/45s so it stays fast. */
describe('bot fill', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
    configureMatchmaking({ botFillAloneMs: 150, botFillAccompaniedMs: 500 });
  });

  afterAll(async () => {
    resetMatchmakingConfig();
    resetReadyChecks();
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('fills a lone heads-up human with a bot after the alone threshold, not before', async () => {
    const b = await mintGuestSession(app);
    createdUserIds.push(b.id);
    const connB = await connectWs(wsUrl, b.token);
    await connB.messages.wait((m) => m.t === 'hi');

    connB.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: false }));
    await connB.messages.wait((m) => m.t === 'q' && m.s === 'searching');

    await tick();
    await expect(connB.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 50)).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 160));
    await tick();
    const pending = await connB.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 1000);
    expect(pending.humans).toBe(1);

    connB.ws.send(JSON.stringify({ t: 'ready', a: true }));
    const found = await connB.messages.wait((m) => m.t === 'q' && m.s === 'found');
    createdMatchIds.push(found.m);

    connB.ws.close();
  });

  it('waits the longer threshold once another human is queued anywhere, not only at this table', async () => {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    // A sits at a different table entirely (six-max, not heads-up) and can
    // never be paired with B. Its presence in the queue is what "online"
    // means here: not a rating-compatible opponent, just another real
    // person the site knows is out there right now.
    connA.ws.send(JSON.stringify({ t: 'queue', mode: 'six-max', rated: false }));
    connB.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: false }));
    await connA.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    await connB.messages.wait((m) => m.t === 'q' && m.s === 'searching');

    await new Promise((resolve) => setTimeout(resolve, 160));
    await tick();
    // Past the alone threshold, but B is not alone, so nothing has filled yet.
    await expect(connB.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 50)).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 400));
    await tick();
    const pending = await connB.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 1000);
    expect(pending.humans).toBe(1);

    connB.ws.send(JSON.stringify({ t: 'ready', a: true }));
    const found = await connB.messages.wait((m) => m.t === 'q' && m.s === 'found');
    createdMatchIds.push(found.m);

    // A's own six-max search crosses the same threshold at the same moment,
    // since B was its "online" human too. Let it go rather than leaving a
    // ready check open past this test.
    dequeue(a.id);
    connA.ws.close();
    connB.ws.close();
  });

  it('applies the same two thresholds to six-max', async () => {
    const c = await mintGuestSession(app);
    createdUserIds.push(c.id);
    const connC = await connectWs(wsUrl, c.token);
    await connC.messages.wait((m) => m.t === 'hi');

    connC.ws.send(JSON.stringify({ t: 'queue', mode: 'six-max', rated: false }));
    await connC.messages.wait((m) => m.t === 'q' && m.s === 'searching');

    await tick();
    await expect(connC.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 50)).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 160));
    await tick();
    const pending = await connC.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 1000);
    expect(pending.humans).toBe(1);

    connC.ws.send(JSON.stringify({ t: 'ready', a: true }));
    const found = await connC.messages.wait((m) => m.t === 'q' && m.s === 'found');
    createdMatchIds.push(found.m);

    connC.ws.close();
  });
});
