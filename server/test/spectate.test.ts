import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, TableView } from '@opentable/protocol';
import { WebSocket } from 'ws';
import {
  makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, driveRandomPlay, testFormat,
} from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { getRoom } from '../src/match/rooms.js';
import { sql } from '../src/db.js';

/* Watching a table. A spectator is anyone who sends `join` for a match they
   have no seat in: they get the same stripped view an opponent gets, they get
   `end`, and they can do nothing else. The point of this file is the stripping
   and the fact that a seat's own view is not changed by anybody watching it. */

const SHORT: MatchFormat = testFormat({ hands: 3, stack: 20 });
const PRACTICE: MatchFormat = testFormat({ rated: false, hands: 2, stack: 20, practice: true });

function hidden(view: TableView): boolean {
  return view.seats.every((s) => s.cards === null || (s.cards[0] === '?' && s.cards[1] === '?'));
}

describe('spectating a live match', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const matchIds: string[] = [];
  const createdUserIds: string[] = [];
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    for (const ws of sockets) ws.close();
    for (const id of matchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  async function seatTwo() {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);
    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    sockets.push(connA.ws, connB.ws);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');
    return { a, b, connA, connB };
  }

  async function spectator() {
    const c = await mintGuestSession(app);
    createdUserIds.push(c.id);
    const conn = await connectWs(wsUrl, c.token);
    sockets.push(conn.ws);
    await conn.messages.wait((m) => m.t === 'hi');
    return { ...c, ...conn };
  }

  it('sends a seatless view with every hole card hidden, and cannot act', async () => {
    const { a, b, connA, connB } = await seatTwo();
    const watcher = await spectator();

    const id = await createMatchForPlayers([a.id, b.id], SHORT);
    matchIds.push(id);
    connA.ws.send(JSON.stringify({ t: 'join', m: id }));
    connB.ws.send(JSON.stringify({ t: 'join', m: id }));
    watcher.ws.send(JSON.stringify({ t: 'join', m: id }));

    const seated = (await connA.messages.wait((m) => m.t === 'state' && m.s.m === id)).s as TableView;
    const watched = (await watcher.messages.wait((m) => m.t === 'state' && m.s.m === id)).s as TableView;

    // The seated player is unaffected by anybody watching: a seat, their own
    // two cards, and their opponent's still masked.
    expect(seated.you).not.toBeNull();
    expect(seated.seats[seated.you!].cards).not.toEqual(['?', '?']);
    expect(seated.seats[1 - seated.you!].cards).toEqual(['?', '?']);

    expect(watched.you).toBeNull();
    expect(watched.legal).toBeNull();
    expect(watched.street).not.toBe('done');
    expect(hidden(watched)).toBe(true);
    // Same table, same hand: the spectator is not being shown a different match.
    expect(watched.h).toBe(seated.h);
    expect(watched.seats.map((s) => s.name)).toEqual(seated.seats.map((s) => s.name));

    // No seat means no turn, whatever the message claims.
    watcher.ws.send(JSON.stringify({ t: 'act', m: id, h: watched.h, n: watched.n, a: 'f' }));
    const refused = await watcher.messages.wait((m) => m.t === 'err');
    expect(refused.c).toBe('not_your_turn');

    expect(getRoom(id)!.spectatorCount).toBe(1);
  });

  it('stops sending frames after leave and after a disconnect', async () => {
    const { a, b, connA, connB } = await seatTwo();
    const watcher = await spectator();

    const id = await createMatchForPlayers([a.id, b.id], SHORT);
    matchIds.push(id);
    connA.ws.send(JSON.stringify({ t: 'join', m: id }));
    connB.ws.send(JSON.stringify({ t: 'join', m: id }));
    watcher.ws.send(JSON.stringify({ t: 'join', m: id }));
    await watcher.messages.wait((m) => m.t === 'state' && m.s.m === id);

    // Every frame this socket is ever sent, independent of what the waiters
    // above consume, so "nothing arrived after leave" can actually be checked.
    const frames: any[] = [];
    watcher.ws.on('message', (raw: Buffer) => frames.push(JSON.parse(raw.toString())));

    watcher.ws.send(JSON.stringify({ t: 'leave', m: id }));
    // The leave has to be processed before the action that follows it, and
    // the room is the only thing that can say so.
    await expect
      .poll(() => getRoom(id)!.spectatorCount, { timeout: 2000 })
      .toBe(0);
    const seen = frames.length;

    // One real action, so there is definitely a broadcast to have missed.
    const acting = await Promise.race([
      connA.messages.wait((m) => m.t === 'state' && m.s.legal !== null).then((m) => ({ conn: connA, view: m.s as TableView })),
      connB.messages.wait((m) => m.t === 'state' && m.s.legal !== null).then((m) => ({ conn: connB, view: m.s as TableView })),
    ]);
    const legal = acting.view.legal!;
    const action = legal.actions.includes('x') ? 'x' : legal.actions.includes('c') ? 'c' : 'f';
    acting.conn.ws.send(JSON.stringify({ t: 'act', m: id, h: acting.view.h, n: acting.view.n, a: action }));
    await acting.conn.messages.wait((m) => m.t === 'state' && m.s.n !== acting.view.n);

    expect(frames.length).toBe(seen);

    // And a spectator who simply closes the tab is dropped the same way.
    watcher.ws.send(JSON.stringify({ t: 'join', m: id }));
    await expect.poll(() => getRoom(id)!.spectatorCount, { timeout: 2000 }).toBe(1);
    watcher.ws.close();
    await expect.poll(() => getRoom(id)!.spectatorCount, { timeout: 2000 }).toBe(0);
  });

  it('reaches the end of a practice table and still answers a late join', async () => {
    const { a, b, connA, connB } = await seatTwo();
    const watcher = await spectator();

    const id = await createMatchForPlayers([a.id, b.id], PRACTICE);
    matchIds.push(id);
    connA.ws.send(JSON.stringify({ t: 'join', m: id }));
    connB.ws.send(JSON.stringify({ t: 'join', m: id }));
    watcher.ws.send(JSON.stringify({ t: 'join', m: id }));

    const first = (await watcher.messages.wait((m) => m.t === 'state' && m.s.m === id)).s as TableView;
    expect(first.you).toBeNull();
    expect(first.format.practice).toBe(true);

    const [result] = await Promise.all([
      driveRandomPlay(connA),
      driveRandomPlay(connB),
      // A watcher never acts, so it only ever waits for the result.
      watcher.messages.wait((m) => m.t === 'end' && m.m === id, 25_000),
    ]);
    expect(result.rated).toBe(false);

    // The room lingers a minute after finishing, so a link followed late
    // still opens on the final board rather than on an error.
    const late = await spectator();
    late.ws.send(JSON.stringify({ t: 'join', m: id }));
    const final = (await late.messages.wait((m) => m.t === 'state' && m.s.m === id)).s as TableView;
    expect(final.you).toBeNull();
    expect(final.street).toBe('done');
    await late.messages.wait((m) => m.t === 'end' && m.m === id);
  }, 40_000);

  it('refuses a match id nobody is playing', async () => {
    const watcher = await spectator();
    watcher.ws.send(JSON.stringify({ t: 'join', m: 'nosuchmatch' }));
    const refused = await watcher.messages.wait((m) => m.t === 'err');
    expect(refused.c).toBe('no_match');
  });

  it('reports the watchers and the seat ratings on /api/live', async () => {
    const { a, b, connA, connB } = await seatTwo();
    const watcher = await spectator();

    const id = await createMatchForPlayers([a.id, b.id], SHORT);
    matchIds.push(id);
    connA.ws.send(JSON.stringify({ t: 'join', m: id }));
    connB.ws.send(JSON.stringify({ t: 'join', m: id }));
    watcher.ws.send(JSON.stringify({ t: 'join', m: id }));
    await expect.poll(() => getRoom(id)!.spectatorCount, { timeout: 2000 }).toBe(1);

    const res = await app.inject({ method: 'GET', url: '/api/live' });
    const row = res.json().find((m: { id: string }) => m.id === id);
    expect(row).toBeDefined();
    expect(row.spectators).toBe(1);
    expect(row.players.map((p: { name: string }) => p.name).sort()).toEqual([a.name, b.name].sort());
    for (const p of row.players) expect(Number.isInteger(p.rating)).toBe(true);
  });
});
