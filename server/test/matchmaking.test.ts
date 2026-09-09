import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  acceptReady,
  connectWs,
  deleteUser,
  driveRandomPlay,
  listenForWs,
  makeApp,
  mintGuestSession,
  testFormat,
  unlockRanked,
} from './helpers.js';
import { __queueForTest, createMatchForPlayers, dequeue, enqueue, tick } from '../src/matchmaking.js';
import { resetReadyChecks } from '../src/ready.js';
import { getMatchById, getRatingHistoryForUser, sql } from '../src/db.js';

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
    resetReadyChecks();
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('round-trips queue and dequeue', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    createdMatchIds.push(await unlockRanked(session.id));

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
    createdMatchIds.push(await unlockRanked(a.id), await unlockRanked(b.id));

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    connA.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up' }));
    connB.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up' }));
    await connA.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    await connB.messages.wait((m) => m.t === 'q' && m.s === 'searching');

    await tick();
    // The table is offered before it is dealt: both seats say they are there
    // and only then does the match exist.
    await Promise.all([acceptReady(connA), acceptReady(connB)]);

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

  it('pairs two people before either is given a bot that was searching first', async () => {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);
    const [bot] = await sql<{ id: string }[]>`select id from users where bot limit 1`;
    expect(bot).toBeDefined();
    // The bot has been searching longest, so the ordinary order would hand
    // it the first person to arrive.
    await enqueue(bot.id, 'heads-up', false, 'standard');

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');
    connA.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: false, speed: 'standard' }));
    connB.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: false, speed: 'standard' }));
    await connA.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    await connB.messages.wait((m) => m.t === 'q' && m.s === 'searching');

    await tick();
    const readyA = await connA.messages.wait((m) => m.t === 'ready' && m.s === 'pending');
    const readyB = await connB.messages.wait((m) => m.t === 'ready' && m.s === 'pending');
    expect(readyA.id).toBe(readyB.id);
    expect(readyA.humans).toBe(2);
    // The bot is still searching: nobody was given it.
    expect(__queueForTest().has(bot.id)).toBe(true);

    dequeue(bot.id);
    connA.ws.send(JSON.stringify({ t: 'ready', a: false }));
    resetReadyChecks();
    connA.ws.close();
    connB.ws.close();
  });

  it('keeps the mode, rated and speed queues apart', async () => {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);
    createdMatchIds.push(await unlockRanked(a.id), await unlockRanked(b.id));

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

    await expect(connA.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 300)).rejects.toThrow();

    connA.ws.send(JSON.stringify({ t: 'dequeue' }));
    connB.ws.send(JSON.stringify({ t: 'dequeue' }));
    await connA.messages.wait((m) => m.t === 'q' && m.s === 'left');
    await connB.messages.wait((m) => m.t === 'q' && m.s === 'left');

    // Speed is the third dimension and separates the queues exactly as the
    // other two do: same mode, same rated flag, different game.
    connA.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: true, speed: 'fast' }));
    connB.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: true, speed: 'standard' }));
    const fastSearch = await connA.messages.wait((m) => m.t === 'q' && m.s === 'searching' && m.speed === 'fast');
    const standardSearch = await connB.messages.wait((m) => m.t === 'q' && m.s === 'searching' && m.speed === 'standard');
    expect(fastSearch.speed).toBe('fast');
    expect(standardSearch.speed).toBe('standard');

    await tick();
    await expect(connA.messages.wait((m) => m.t === 'ready' && m.s === 'pending', 300)).rejects.toThrow();

    connA.ws.send(JSON.stringify({ t: 'dequeue' }));
    connB.ws.send(JSON.stringify({ t: 'dequeue' }));
    connA.ws.close();
    connB.ws.close();
  });

  it('defaults a bare queue message to a rated standard six-max match', async () => {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    const others = await Promise.all([
      mintGuestSession(app), mintGuestSession(app), mintGuestSession(app), mintGuestSession(app),
    ]);
    createdUserIds.push(a.id, b.id, ...others.map((o) => o.id));
    for (const id of [a.id, b.id, ...others.map((o) => o.id)]) createdMatchIds.push(await unlockRanked(id));

    // No mode, no rated, no speed: six handed and standard is what that means now,
    // and a full ring needs six people before it deals.
    const conns = await Promise.all([a, b, ...others].map((sess) => connectWs(wsUrl, sess.token)));
    const connA = conns[0];
    for (const c of conns) await c.messages.wait((m) => m.t === 'hi');
    for (const c of conns) c.ws.send(JSON.stringify({ t: 'queue' }));
    for (const c of conns) await c.messages.wait((m) => m.t === 'q' && m.s === 'searching');

    await tick();
    await Promise.all(conns.map((c) => acceptReady(c)));
    const found = await connA.messages.wait((m) => m.t === 'q' && m.s === 'found');
    createdMatchIds.push(found.m);

    const match = await getMatchById(found.m);
    expect(match!.format.mode).toBe('six-max');
    expect(match!.format.speed).toBe('standard');
    expect(match!.format.rated).toBe(true);
    // The column is a copy of the format and must never disagree with it.
    expect(match!.rated).toBe(true);
    expect(match!.rated).toBe(match!.format.rated);

    for (const c of conns) c.ws.close();
  });

  it('re-asserts rated from the format when the row is changed underneath it', async () => {
    // Exactly what happened live: another process ran the boot-time abort
    // against a match that was still being played here, rewriting its flag.
    // The finish has to put the format's answer back, and the rating write
    // must key off the format rather than the column it just read.
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    const matchId = await createMatchForPlayers([a.id, b.id], testFormat({ hands: 1, stack: 20 }));
    createdMatchIds.push(matchId);
    connA.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    connB.ws.send(JSON.stringify({ t: 'join', m: matchId }));

    await sql`update matches set rated = false where id = ${matchId}`;

    const [result] = await Promise.all([driveRandomPlay(connA), driveRandomPlay(connB)]);
    expect(result.rated).toBe(true);

    const match = await getMatchById(matchId);
    expect(match!.rated).toBe(true);
    expect(match!.rated).toBe(match!.format.rated);
    expect(await getRatingHistoryForUser(a.id)).toHaveLength(1);
    expect(await getRatingHistoryForUser(b.id)).toHaveLength(1);

    connA.ws.close();
    connB.ws.close();
  });
});
