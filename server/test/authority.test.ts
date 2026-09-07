import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, TableView } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectSession, type Connected } from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { sql } from '../src/db.js';

const TEST_FORMAT: MatchFormat = { hands: 25, stack: 200, sb: 1, bb: 2, clockMs: 20_000, graceMs: 15_000 };

describe('server authority over actions', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  let matchId: string;
  let a: Connected;
  let b: Connected;
  let spectator: Connected;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);

    const sessA = await mintGuestSession(app);
    const sessB = await mintGuestSession(app);
    const sessSpec = await mintGuestSession(app);
    createdUserIds.push(sessA.id, sessB.id, sessSpec.id);

    a = await connectSession(wsUrl, sessA);
    b = await connectSession(wsUrl, sessB);
    spectator = await connectSession(wsUrl, sessSpec);
    await a.messages.wait((m) => m.t === 'hi');
    await b.messages.wait((m) => m.t === 'hi');
    await spectator.messages.wait((m) => m.t === 'hi');

    matchId = await createMatchForPlayers(sessA.id, sessB.id, TEST_FORMAT);

    a.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    b.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    spectator.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    await a.messages.wait((m) => m.t === 'state');
    await b.messages.wait((m) => m.t === 'state');
    await spectator.messages.wait((m) => m.t === 'state');
  });

  afterAll(async () => {
    await sql`delete from matches where id = ${matchId}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  async function freshView(): Promise<TableView> {
    spectator.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    const msg = await spectator.messages.wait((m) => m.t === 'state');
    return msg.s as TableView;
  }

  // The spectator's own view never has `legal` populated (it's only set for
  // the viewer whose turn it is), so fetching the acting player's legal
  // options means asking that player's own connection for a fresh view.
  async function viewOf(conn: Connected): Promise<TableView> {
    conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    const msg = await conn.messages.wait((m) => m.t === 'state');
    return msg.s as TableView;
  }

  async function actingPlayer(view: TableView): Promise<Connected> {
    const seat = view.seats.find((s) => s.acting);
    if (!seat) throw new Error('nobody is acting');
    return seat.uid === a.id ? a : b;
  }

  it('rejects an action from a player whose turn it is not', async () => {
    const before = await freshView();
    const acting = await actingPlayer(before);
    const waiting = acting === a ? b : a;

    waiting.ws.send(JSON.stringify({ t: 'act', m: matchId, h: before.h, n: before.n, a: 'x' }));
    const err = await waiting.messages.wait((m) => m.t === 'err');
    expect(err.c).toBe('not_your_turn');

    const after = await freshView();
    expect(after).toEqual(before);
  });

  it('rejects a stale action sequence', async () => {
    const before = await freshView();
    const acting = await actingPlayer(before);

    acting.ws.send(JSON.stringify({ t: 'act', m: matchId, h: before.h, n: before.n + 999, a: 'x' }));
    const err = await acting.messages.wait((m) => m.t === 'err');
    expect(err.c).toBe('stale');

    const after = await freshView();
    expect(after).toEqual(before);
  });

  it('rejects a raise below the minimum', async () => {
    const before = await freshView();
    const acting = await actingPlayer(before);
    const actingView = await viewOf(acting);
    const legal = actingView.legal!;
    const belowMin = Math.max(0, legal.min - 1);

    acting.ws.send(JSON.stringify({ t: 'act', m: matchId, h: before.h, n: before.n, a: 'r', v: belowMin }));
    const err = await acting.messages.wait((m) => m.t === 'err');
    expect(err.c).toBe('illegal');

    const after = await freshView();
    expect(after).toEqual(before);
  });

  it('rejects an action from a user who is not seated in the match', async () => {
    const before = await freshView();

    spectator.ws.send(JSON.stringify({ t: 'act', m: matchId, h: before.h, n: before.n, a: 'r', v: before.legal?.min ?? 4 }));
    const err = await spectator.messages.wait((m) => m.t === 'err');
    expect(err.c).toBe('not_your_turn');

    const after = await freshView();
    expect(after).toEqual(before);
  });

  it('rejects a malformed action kind', async () => {
    const before = await freshView();
    const acting = await actingPlayer(before);

    acting.ws.send(JSON.stringify({ t: 'act', m: matchId, h: before.h, n: before.n, a: 'zzz' }));
    const err = await acting.messages.wait((m) => m.t === 'err');
    expect(err.c).toBe('illegal');

    const after = await freshView();
    expect(after).toEqual(before);
  });
});
