import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, MatchResult, TableView } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat } from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { sql } from '../src/db.js';
import { MIN_INSIGHT_HANDS } from '../src/insights.js';

/* The route over a real match, not over fixtures: what the engine wrote to
   the database is what the insights are read back out of. The pure maths is
   covered next door in src/insights.test.ts; what this asks is whether the
   counts still add up once they have been through Postgres.

   Both seats check and call and never raise, so no one can bust and the
   match runs its full cap. That makes the hand count exact, every hand a
   showdown, and the button's rotation the only thing that changes between
   them. */

const HANDS = MIN_INSIGHT_HANDS;
const TEST_FORMAT: MatchFormat = testFormat({ hands: HANDS, stack: 200, clockMs: 500, graceMs: 500 });

async function drivePassive(
  conn: Awaited<ReturnType<typeof connectWs>>,
  timeoutMs = 30_000
): Promise<MatchResult> {
  for (let step = 0; step < 2000; step++) {
    const msg = await conn.messages.wait(
      (m) => (m.t === 'state' && m.s.legal !== null) || m.t === 'end',
      timeoutMs
    );
    if (msg.t === 'end') return msg.r as MatchResult;
    const view = msg.s as TableView;
    const legal = view.legal!;
    const action = legal.actions.includes('x') ? 'x' : legal.actions.includes('c') ? 'c' : 'f';
    conn.ws.send(JSON.stringify({ t: 'act', m: view.m, h: view.h, n: view.n, a: action }));
  }
  throw new Error('too many steps without reaching end');
}

describe('player insights', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  let matchId: string | null = null;
  let result: MatchResult;
  let a: { id: string; name: string; token: string };
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);

    a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id);

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    matchId = await createMatchForPlayers([a.id, b.id], TEST_FORMAT);
    connA.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    connB.ws.send(JSON.stringify({ t: 'join', m: matchId }));

    const [resultA] = await Promise.all([drivePassive(connA), drivePassive(connB)]);
    result = resultA;
    connA.ws.close();
    connB.ws.close();
  }, 120_000);

  afterAll(async () => {
    if (matchId) await sql`delete from matches where id = ${matchId}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  async function insights(name: string, mode?: string) {
    const url = mode
      ? `/api/users/${encodeURIComponent(name)}/insights?mode=${mode}`
      : `/api/users/${encodeURIComponent(name)}/insights`;
    return app.inject({ method: 'GET', url });
  }

  it('played the full cap without anyone busting', () => {
    expect(result.reason).toBe('hands');
  });

  it('counts every hand of the match once', async () => {
    const res = await insights(a.name);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('heads-up');
    expect(body.sample).toEqual({ hands: HANDS, matches: 1 });
    expect(body.minHands).toBe(MIN_INSIGHT_HANDS);
  });

  it('fills the derived groups in at exactly the sample floor', async () => {
    const body = (await insights(a.name)).json();
    expect(body.preflop).not.toBeNull();
    expect(body.postflop).not.toBeNull();
    expect(body.positions).not.toBeNull();
    expect(body.streets).not.toBeNull();
    expect(body.results).not.toBeNull();
  });

  it('reads a table nobody raised at', async () => {
    const body = (await insights(a.name)).json();
    // The button calls the big blind every hand and the big blind checks, so
    // half the hands are played voluntarily and none of them are raised.
    expect(body.preflop.vpip).toBe(50);
    expect(body.preflop.pfr).toBe(0);
    // Nobody opened, so nobody could three-bet or face one.
    expect(body.preflop.threeBet).toBeNull();
    expect(body.preflop.foldToThreeBet).toBeNull();
    // Every street is checked through, which is no bets and no calls.
    expect(body.postflop.aggressionFactor).toBeNull();
    expect(body.postflop.cbet).toBeNull();
  });

  it('takes every hand to showdown', async () => {
    const body = (await insights(a.name)).json();
    expect(body.streets).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0, showdown: 100 });
    expect(body.postflop.wentToShowdown).toBe(100);
    expect(body.postflop.wonAtShowdown).toBeGreaterThanOrEqual(0);
    expect(body.postflop.wonAtShowdown).toBeLessThanOrEqual(100);
  });

  it('splits the hands between the two heads-up positions and nets out to the final stack', async () => {
    const body = (await insights(a.name)).json();
    const keys = body.positions.map((p: { key: string }) => p.key);
    expect(keys).toEqual(['button', 'big-blind']);
    const played = body.positions.reduce((sum: number, p: { hands: number }) => sum + p.hands, 0);
    expect(played).toBe(HANDS);
    // The button alternates every hand over an even number of hands.
    expect(body.positions[0].hands).toBe(HANDS / 2);

    // Net big blinds per hand, weighted back up, is the whole match in chips.
    const netBb = body.positions.reduce(
      (sum: number, p: { hands: number; bbPerHand: number | null }) => sum + p.hands * (p.bbPerHand ?? 0),
      0
    );
    expect(netBb * TEST_FORMAT.bb).toBeCloseTo(result.stacks[a.id] - TEST_FORMAT.stack, 6);
  });

  it('points the biggest pot at a hand that exists', async () => {
    const body = (await insights(a.name)).json();
    const pot = body.results.biggestPot;
    expect(pot).not.toBeNull();
    expect(pot.matchId).toBe(matchId);
    expect(pot.handId).toBe(`${matchId}-${pot.handNumber}`);
    expect(pot.handNumber).toBeGreaterThanOrEqual(1);
    expect(pot.handNumber).toBeLessThanOrEqual(HANDS);
    expect(pot.chips).toBeGreaterThan(0);
    const [row] = await sql<{ id: string }[]>`select id from hands where id = ${pot.handId}`;
    expect(row?.id).toBe(pot.handId);
  });

  it('reports a streak that matches how the one match went, and no forfeits', async () => {
    const body = (await insights(a.name)).json();
    expect(body.results.longestWinStreak).toBe(result.winner === a.id ? 1 : 0);
    expect(body.results.timeouts).toBe(0);
    expect(body.results.averageHandMs).toBeGreaterThan(0);
  });

  it('defaults to heads-up and keeps the other mode empty', async () => {
    const plain = (await insights(a.name)).json();
    const explicit = (await insights(a.name, 'heads-up')).json();
    expect(explicit).toEqual(plain);

    const sixMax = (await insights(a.name, 'six-max')).json();
    expect(sixMax.mode).toBe('six-max');
    expect(sixMax.sample.hands).toBe(0);
    expect(sixMax.preflop).toBeNull();
    expect(sixMax.positions).toBeNull();
  });

  it('falls back to heads-up for a mode it does not know', async () => {
    const body = (await insights(a.name, 'nine-max')).json();
    expect(body.mode).toBe('heads-up');
    expect(body.sample.hands).toBe(HANDS);
  });

  it('serves the same body from the cache on a second read', async () => {
    const first = await insights(a.name);
    const second = await insights(a.name);
    expect(second.json()).toEqual(first.json());
  });

  it('reports nothing but the sample for a player with no hands', async () => {
    const fresh = await mintGuestSession(app);
    createdUserIds.push(fresh.id);
    const body = (await insights(fresh.name)).json();
    expect(body.sample).toEqual({ hands: 0, matches: 0 });
    expect(body.preflop).toBeNull();
    expect(body.results).toBeNull();
  });

  it('is a 404 for a name nobody has', async () => {
    const res = await insights('nobody-by-that-name');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no such user');
  });
});
