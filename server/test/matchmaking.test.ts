import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs } from './helpers.js';
import { tick } from '../src/matchmaking.js';
import { getMatchById, sql } from '../src/db.js';

describe('matchmaking', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('round-trips queue and dequeue', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);

    const { ws, messages } = await connectWs(wsUrl, session.token);
    await messages.wait((m) => m.t === 'hi');

    ws.send(JSON.stringify({ t: 'queue' }));
    const searching = await messages.wait((m) => m.t === 'q' && m.s === 'searching');
    expect(searching.s).toBe('searching');

    ws.send(JSON.stringify({ t: 'dequeue' }));
    const left = await messages.wait((m) => m.t === 'q' && m.s === 'left');
    expect(left.s).toBe('left');

    ws.close();
  });

  it('pairs two queued users into the same match', async () => {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    connA.ws.send(JSON.stringify({ t: 'queue' }));
    connB.ws.send(JSON.stringify({ t: 'queue' }));
    await connA.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    await connB.messages.wait((m) => m.t === 'q' && m.s === 'searching');

    await tick();

    const foundA = await connA.messages.wait((m) => m.t === 'q' && m.s === 'found');
    const foundB = await connB.messages.wait((m) => m.t === 'q' && m.s === 'found');
    expect(foundA.m).toBeDefined();
    expect(foundA.m).toBe(foundB.m);
    createdMatchIds.push(foundA.m);

    const match = await getMatchById(foundA.m);
    expect(match).not.toBeNull();
    expect(match!.seats.map((s) => s.userId).sort()).toEqual([a.id, b.id].sort());

    connA.ws.close();
    connB.ws.close();
  });

  it('keeps the four mode/rated queues apart', async () => {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    // Same mode, different rated flag: never each other's opponent.
    connA.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: true }));
    connB.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: false }));
    const searchingA = await connA.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    const searchingB = await connB.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    expect(searchingA.rated).toBe(true);
    expect(searchingB.rated).toBe(false);

    await tick();

    await expect(connA.messages.wait((m) => m.t === 'q' && m.s === 'found', 300)).rejects.toThrow();

    connA.ws.send(JSON.stringify({ t: 'dequeue' }));
    connB.ws.send(JSON.stringify({ t: 'dequeue' }));
    connA.ws.close();
    connB.ws.close();
  });
});
