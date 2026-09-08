import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { handClass } from '@opentable/preflop';
import type { Card, MatchFormat, MatchResult, TableView } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat } from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { sql } from '../src/db.js';
import { MIN_EXPLORER_HANDS } from '../src/explorer.js';

/* The route over a real match, not over fixtures: what the engine wrote to
   the database is what the book is read back out of. The maths is covered
   next door in src/explorer.test.ts; what this asks is whether a match played
   through the socket turns up in the explorer afterwards.

   The explorer is the whole site's book, so the numbers cannot be asserted
   exactly the way a per-player route's can: the test database holds whatever
   the suite running beside this one has not cleaned up yet. Every assertion
   here is therefore "at least this match", which is the claim being made.

   Both seats check and call and never raise, so nobody busts, the match runs
   its full cap, and every preflop decision is the same one: the button limps,
   the big blind checks. */

const HANDS = 6;
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

interface Row {
  hand: string;
  hands: number;
  raise: number | null;
  call: number | null;
  fold: number | null;
  netBb: number | null;
}

describe('opening explorer', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  let matchId: string | null = null;
  let result: MatchResult;
  const createdUserIds: string[] = [];
  /* The class dealt to each seat each hand, read off the stored holes column
     rather than off anything the explorer derives, so the two never agree by
     construction. */
  let buttonClasses: string[] = [];
  let bigBlindClasses: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);

    const a = await mintGuestSession(app);
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

    const rows = await sql<{ button: number; holes: Record<number, [Card, Card]> }[]>`
      select button, holes from hands
      where match_id = ${matchId} and completed_at is not null and holes is not null
      order by number
    `;
    buttonClasses = rows.map((r) => handClass(r.holes[r.button]));
    bigBlindClasses = rows.map((r) => handClass(r.holes[r.button === 0 ? 1 : 0]));
  }, 120_000);

  afterAll(async () => {
    if (matchId) await sql`delete from matches where id = ${matchId}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  async function explorer(query = '') {
    return app.inject({ method: 'GET', url: `/api/explorer${query}` });
  }

  function rowFor(body: { hands: Row[] }, cls: string): Row {
    const found = body.hands.find((r) => r.hand === cls);
    if (!found) throw new Error(`${cls} is not in the grid`);
    return found;
  }

  it('played the full cap without anyone busting', () => {
    expect(result.reason).toBe('hands');
    expect(buttonClasses).toHaveLength(HANDS);
  });

  it('answers with a full grid and the controls it was asked for', async () => {
    const res = await explorer('?mode=heads-up&position=big-blind&facing=open&players=humans');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('heads-up');
    expect(body.position).toBe('big-blind');
    expect(body.facing).toBe('open');
    expect(body.players).toBe('humans');
    expect(body.minHands).toBe(MIN_EXPLORER_HANDS);
    expect(body.hands).toHaveLength(169);
  });

  it('lets a browser hold the answer for a minute', async () => {
    const res = await explorer();
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('counts the button limping in every hand of the match', async () => {
    const body = (await explorer('?mode=heads-up&position=button&facing=unopened')).json();
    expect(body.sample.hands).toBeGreaterThanOrEqual(HANDS);
    expect(body.sample.matches).toBeGreaterThanOrEqual(1);
    expect(body.since).not.toBeNull();
    for (const cls of buttonClasses) {
      const row = rowFor(body, cls);
      expect(row.hands).toBeGreaterThanOrEqual(1);
      // A limp is a call, so a class only this match put here cannot read as
      // all folds.
      expect(row.call).toBeGreaterThan(0);
    }
  });

  it('counts the big blind checking behind the limp', async () => {
    const body = (await explorer('?mode=heads-up&position=big-blind&facing=unopened')).json();
    expect(body.sample.hands).toBeGreaterThanOrEqual(HANDS);
    for (const cls of bigBlindClasses) {
      expect(rowFor(body, cls).hands).toBeGreaterThanOrEqual(1);
      expect(rowFor(body, cls).call).toBeGreaterThan(0);
    }
  });

  it('sees the same hands whether or not bots are counted, at a table with none', async () => {
    const all = (await explorer('?mode=heads-up&position=button&facing=unopened&players=all')).json();
    const humans = (await explorer('?mode=heads-up&position=button&facing=unopened&players=humans')).json();
    for (const cls of buttonClasses) {
      expect(rowFor(humans, cls).hands).toBe(rowFor(all, cls).hands);
    }
  });

  it('falls back rather than erroring on controls it does not know', async () => {
    const body = (await explorer('?mode=nonsense&position=nonsense&facing=nonsense&players=nonsense')).json();
    expect(body.mode).toBe('heads-up');
    expect(body.position).toBe('button');
    expect(body.facing).toBe('unopened');
    expect(body.players).toBe('all');
  });

  it('has a grid for six-max whether or not anyone has played one', async () => {
    const body = (await explorer('?mode=six-max&position=cutoff&facing=open')).json();
    expect(body.mode).toBe('six-max');
    expect(body.position).toBe('cutoff');
    expect(body.hands).toHaveLength(169);
    expect(body.sample.hands).toBeGreaterThanOrEqual(0);
  });
});
