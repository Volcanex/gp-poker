import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, TableView } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectSession, type Connected } from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { getHandById, sql } from '../src/db.js';

// Short enough that waiting out a real timeout is fast; graceMs is generous
// relative to how quickly this process can reconnect a websocket, since
// tests 2 relies on reconnecting comfortably inside the grace window.
const SHORT_FORMAT: MatchFormat = { hands: 1, stack: 200, sb: 1, bb: 2, clockMs: 300, graceMs: 1000 };
// Same clock, but enough hands that natural completion never preempts the
// forfeit test, forfeit always fires within hand 1 anyway.
const FORFEIT_FORMAT: MatchFormat = { hands: 25, stack: 200, sb: 1, bb: 2, clockMs: 300, graceMs: 1000 };

// Always checks or calls (never folds, never raises) whenever it's this
// connection's turn, so the hand progresses deterministically. Resolves once
// a message matching `stop` arrives.
async function checkOrCallUntil(conn: Connected, stop: (m: any) => boolean): Promise<any> {
  for (let step = 0; step < 50; step++) {
    const msg = await conn.messages.wait((m) => (m.t === 'state' && m.s.legal !== null) || stop(m), 5000);
    if (stop(msg)) return msg;
    const view = msg.s as TableView;
    const legal = view.legal!;
    const action = legal.actions.includes('x') ? 'x' : legal.actions.includes('c') ? 'c' : legal.actions[0];
    conn.ws.send(JSON.stringify({ t: 'act', m: view.m, h: view.h, n: view.n, a: action }));
  }
  throw new Error('too many steps without reaching the stop condition');
}

describe('the decision clock', () => {
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

  it(
    'check-folds an unresponsive player on timeout, logged with to: true',
    async () => {
      const sessA = await mintGuestSession(app); // seat 0: button/SB, never responds
      const sessB = await mintGuestSession(app); // seat 1: BB, plays normally
      createdUserIds.push(sessA.id, sessB.id);

      const connA = await connectSession(wsUrl, sessA); // stays open, never acts
      const connB = await connectSession(wsUrl, sessB);
      await connA.messages.wait((m) => m.t === 'hi');
      await connB.messages.wait((m) => m.t === 'hi');

      const matchId = await createMatchForPlayers(sessA.id, sessB.id, SHORT_FORMAT);
      createdMatchIds.push(matchId);
      connB.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const end = await checkOrCallUntil(connB, (m) => m.t === 'end');
      expect(end.r.reason).toBe('hands'); // the only hand in a 1-hand match, finished by the fold
      expect(end.r.winner).toBe(sessB.id); // A (button/SB) folded to B

      const hand = await getHandById(`${matchId}-1`);
      expect(hand).not.toBeNull();
      expect(hand!.completedAt).not.toBeNull();
      expect(hand!.actions.length).toBe(1);
      expect(hand!.actions[0]).toMatchObject({ s: 0, a: 'f', to: true });

      connA.ws.close();
      connB.ws.close();
    },
    15_000
  );

  it(
    'pauses the clock on disconnect and resumes on reconnect within grace',
    async () => {
      const sessA = await mintGuestSession(app); // seat 0: button/SB, disconnects mid-decision
      const sessB = await mintGuestSession(app); // seat 1: BB, observes then plays
      createdUserIds.push(sessA.id, sessB.id);

      let connA = await connectSession(wsUrl, sessA);
      const connB = await connectSession(wsUrl, sessB);
      await connA.messages.wait((m) => m.t === 'hi');
      await connB.messages.wait((m) => m.t === 'hi');

      const matchId = await createMatchForPlayers(sessA.id, sessB.id, SHORT_FORMAT);
      createdMatchIds.push(matchId);
      connA.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      connB.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      await connA.messages.wait((m) => m.t === 'state');

      connA.ws.close();

      const paused = await connB.messages.wait((m) => m.t === 'state' && m.s.clock?.paused === true);
      const aSeat = paused.s.seats.find((s: any) => s.uid === sessA.id);
      expect(aSeat.connected).toBe(false);

      connA = await connectSession(wsUrl, sessA);
      await connA.messages.wait((m) => m.t === 'hi');
      connA.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      const resumed = await connA.messages.wait((m) => m.t === 'state' && m.s.clock?.paused === false);
      expect(resumed.s.legal).not.toBeNull();

      const [end] = await Promise.all([
        checkOrCallUntil(connA, (m) => m.t === 'end'),
        checkOrCallUntil(connB, (m) => m.t === 'end'),
      ]);
      expect(end.r.reason).toBe('hands');

      connA.ws.close();
      connB.ws.close();
    },
    15_000
  );

  it(
    'forfeits the match after three consecutive timeouts',
    async () => {
      const sessResponsive = await mintGuestSession(app); // seat 0
      const sessTimeout = await mintGuestSession(app); // seat 1, never responds
      createdUserIds.push(sessResponsive.id, sessTimeout.id);

      const connResponsive = await connectSession(wsUrl, sessResponsive);
      const connTimeout = await connectSession(wsUrl, sessTimeout); // stays open, never joins or acts
      await connResponsive.messages.wait((m) => m.t === 'hi');
      await connTimeout.messages.wait((m) => m.t === 'hi');

      const matchId = await createMatchForPlayers(sessResponsive.id, sessTimeout.id, FORFEIT_FORMAT);
      createdMatchIds.push(matchId);
      connResponsive.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const end = await checkOrCallUntil(connResponsive, (m) => m.t === 'end');
      expect(end.r.reason).toBe('forfeit');
      expect(end.r.winner).toBe(sessResponsive.id);

      connResponsive.ws.close();
      connTimeout.ws.close();
    },
    15_000
  );

  // Regression for a bug found live: once a disconnected player's grace
  // window had already fired once (timing them out), rearmClock kept
  // pausing the clock on every later turn just because they were still
  // disconnected, freezing the match on them forever. The clock must run
  // (and keep timing them out) once grace has already been used up.
  it(
    'keeps timing out a still-disconnected player after grace has already fired once',
    async () => {
      const sessResponsive = await mintGuestSession(app); // seat 0
      const sessGone = await mintGuestSession(app); // seat 1, disconnects and never returns
      createdUserIds.push(sessResponsive.id, sessGone.id);

      const connResponsive = await connectSession(wsUrl, sessResponsive);
      const connGone = await connectSession(wsUrl, sessGone);
      await connResponsive.messages.wait((m) => m.t === 'hi');
      await connGone.messages.wait((m) => m.t === 'hi');

      const matchId = await createMatchForPlayers(sessResponsive.id, sessGone.id, FORFEIT_FORMAT);
      createdMatchIds.push(matchId);
      connResponsive.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      // Gone disconnects before ever acting (before their first grace
      // window even starts ticking) and never comes back. Grace expires,
      // timing them out once; if the bug were still there, every turn after
      // that would show clock.paused forever and driveResponsive would hang
      // waiting for a `state` that never gets a fresh deadline.
      connGone.ws.close();

      const end = await checkOrCallUntil(connResponsive, (m) => m.t === 'end');
      expect(end.r.reason).toBe('forfeit');
      expect(end.r.winner).toBe(sessResponsive.id);

      connResponsive.ws.close();
    },
    15_000
  );
});
