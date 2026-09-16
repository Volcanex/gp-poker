import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, TableView } from '@opentable/protocol';
import { EXTRA_TIME_MS } from '@opentable/protocol';
import {
  makeApp,
  mintGuestSession,
  deleteUser,
  listenForWs,
  connectSession,
  testFormat,
  type Connected,
} from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { sql } from '../src/db.js';

/* Extra time: two minutes, once a match, on the decision the player is
   actually on. See `server/src/match/CLAUDE.md`.

   Every rule here is a way the allowance could be worth more than one turn of
   the clock, so each one gets a test: spent twice, spent by a seat that is
   not to act, spent by somebody with no seat at all, and spent between hands
   where no clock is running. The fifth test is the one the whole feature is
   for, that the deadline it reports is the deadline the timeout actually
   keeps. */

// A clock short enough that a seat which is NOT given extra time folds itself
// in a fraction of a second, which is what makes the last test's evidence
// worth anything: the same seat with extra time is still deciding a second
// and a half later.
const SHORT: MatchFormat = testFormat({ clockMs: 300, graceMs: 5_000 });
// Long enough to press a button against without racing the fold.
const CALM: MatchFormat = testFormat({ clockMs: 5_000, graceMs: 5_000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* The first view in which this connection has a decision. Everything below
   presses the button against a decision that is definitely open. */
function yourTurn(conn: Connected, timeoutMs = 5_000): Promise<TableView> {
  return conn.messages
    .wait((m) => m.t === 'state' && m.s.legal !== null, timeoutMs)
    .then((m) => m.s as TableView);
}

function extraUsed(view: TableView, uid: string): boolean {
  return view.seats.find((s) => s.uid === uid)?.extraUsed === true;
}

describe('extra time', () => {
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

  /* Two players, joined and dealt in, with seat 0 (the button and small
     blind, heads-up) on the clock first. Returns both connections and the
     first view seat 0 is asked to act in. */
  async function table(format: MatchFormat) {
    const sessA = await mintGuestSession(app); // seat 0, acts first
    const sessB = await mintGuestSession(app); // seat 1
    createdUserIds.push(sessA.id, sessB.id);
    const a = await connectSession(wsUrl, sessA);
    const b = await connectSession(wsUrl, sessB);
    await a.messages.wait((m) => m.t === 'hi');
    await b.messages.wait((m) => m.t === 'hi');
    const matchId = await createMatchForPlayers([sessA.id, sessB.id], format);
    createdMatchIds.push(matchId);
    /* Every view the table sends, kept beside the queue `messages` drains.
       A refusal is the absence of a broadcast as often as it is a broadcast
       that changed nothing, and a test that waited for the next message
       would be waiting for a message the room is right not to send. */
    const views: TableView[] = [];
    a.ws.on('message', (raw: Buffer) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'state') views.push(m.s as TableView);
    });
    a.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    b.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    const view = await yourTurn(a);
    const latest = () => views[views.length - 1] ?? view;
    return { a, b, matchId, view, latest };
  }

  it(
    'moves the deadline of the decision it is spent on, and only once a match',
    async () => {
      const { a, b, matchId, view, latest } = await table(CALM);
      const before = view.clock!.deadline;
      expect(view.clock!.seat).toBe(view.you);
      expect(extraUsed(view, a.id)).toBe(false);

      a.ws.send(JSON.stringify({ t: 'extra', m: matchId }));
      const spent = (await a.messages.wait(
        (m) => m.t === 'state' && m.s.seats.some((s: any) => s.uid === a.id && s.extraUsed),
      )).s as TableView;

      // The same decision, lengthened: the hand and the action sequence have
      // not moved, so this is the deadline the player is answering against.
      expect(spent.h).toBe(view.h);
      expect(spent.n).toBe(view.n);
      expect(spent.clock!.seat).toBe(view.clock!.seat);
      expect(spent.clock!.deadline).toBe(before + EXTRA_TIME_MS);
      expect(spent.clock!.paused).toBe(false);
      expect(extraUsed(spent, a.id)).toBe(true);
      // The table can see it, not just the player who spent it.
      const theirs = (await b.messages.wait(
        (m) => m.t === 'state' && m.s.seats.some((s: any) => s.uid === a.id && s.extraUsed),
      )).s as TableView;
      expect(extraUsed(theirs, a.id)).toBe(true);

      // Spent twice: the second press buys nothing. Proved against the
      // deadline rather than against silence, because silence is also what a
      // message lost on the way would look like.
      a.ws.send(JSON.stringify({ t: 'extra', m: matchId }));
      await sleep(400);
      expect(latest().n).toBe(spent.n);
      expect(latest().clock!.deadline).toBe(before + EXTRA_TIME_MS);

      // And the decision after it opens on the format's own clock again:
      // extra time is spent on one turn, not banked onto the match.
      a.ws.send(JSON.stringify({ t: 'act', m: matchId, h: spent.h, n: spent.n, a: 'c' }));
      const acted = (await a.messages.wait((m) => m.t === 'state' && m.s.n > spent.n)).s as TableView;
      expect(acted.clock!.deadline).toBeLessThan(Date.now() + EXTRA_TIME_MS);

      a.ws.close();
      b.ws.close();
    },
    20_000,
  );

  it(
    'refuses the seat that is not to act, and gives them their allowance back nowhere',
    async () => {
      const { a, b, matchId, view, latest } = await table(CALM);
      const before = view.clock!.deadline;

      // B is at the table and dealt in, but the decision is A's.
      b.ws.send(JSON.stringify({ t: 'extra', m: matchId }));
      await sleep(400);

      // Nothing moved, and B still has theirs: a press from the wrong seat
      // cannot bank time against a decision that has not arrived.
      const now = latest();
      expect(now.clock!.deadline).toBe(before);
      expect(now.clock!.seat).toBe(view.you);
      expect(extraUsed(now, b.id)).toBe(false);
      expect(extraUsed(now, a.id)).toBe(false);

      a.ws.close();
      b.ws.close();
    },
    20_000,
  );

  it(
    'refuses a spectator, who has no clock of their own to lengthen',
    async () => {
      const { a, b, matchId, view, latest } = await table(CALM);
      const sessC = await mintGuestSession(app);
      createdUserIds.push(sessC.id);
      const c = await connectSession(wsUrl, sessC);
      await c.messages.wait((m) => m.t === 'hi');
      c.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      await c.messages.wait((m) => m.t === 'state');

      c.ws.send(JSON.stringify({ t: 'extra', m: matchId }));
      await sleep(400);

      expect(latest().clock!.deadline).toBe(view.clock!.deadline);
      // And a spectator is not quietly given a seat's allowance to spend.
      expect(latest().seats.every((s) => s.extraUsed !== true)).toBe(true);

      a.ws.close();
      b.ws.close();
      c.ws.close();
    },
    20_000,
  );

  it(
    'refuses a press with no clock running, and keeps the allowance for one',
    async () => {
      const { a, b, matchId, view } = await table(CALM);
      /* Fold: heads-up that ends the hand, and for the hold that follows it
         there is no decision open and `clock` is null. A press in that window
         must not be banked against whatever the next hand deals. */
      a.ws.send(JSON.stringify({ t: 'act', m: matchId, h: view.h, n: view.n, a: 'f' }));
      const settled = (await a.messages.wait(
        (m) => m.t === 'state' && m.s.clock === null,
      )).s as TableView;
      expect(settled.clock).toBeNull();

      a.ws.send(JSON.stringify({ t: 'extra', m: matchId }));
      /* The next hand deals with the allowance intact and an ordinary clock
         on it, which is the whole of what "kept for one" means. Whose
         decision it is does not matter: the button has moved, and what is
         being asked is whether a press into the hold was banked. */
      const next = (await a.messages.wait(
        (m) => m.t === 'state' && m.s.h > view.h && m.s.clock !== null,
        15_000,
      )).s as TableView;
      expect(extraUsed(next, a.id)).toBe(false);
      expect(next.clock!.deadline).toBeLessThan(Date.now() + EXTRA_TIME_MS);

      a.ws.close();
      b.ws.close();
    },
    20_000,
  );

  it(
    'lengthens the turn itself, not just the number on it',
    async () => {
      /* The point of the feature, on a 300 ms clock: a seat that says
         nothing is folded almost at once, and the same seat with extra time
         is still being waited for a second and a half later. The evidence is
         that the action it finally sends is accepted against the sequence it
         was handed, which a folded seat's would not be. */
      const { a, b, matchId, view } = await table(SHORT);
      a.ws.send(JSON.stringify({ t: 'extra', m: matchId }));
      const spent = (await a.messages.wait(
        (m) => m.t === 'state' && m.s.seats.some((s: any) => s.uid === a.id && s.extraUsed),
      )).s as TableView;

      await sleep(1_500); // five clocks' worth, and then some

      a.ws.send(JSON.stringify({ t: 'act', m: matchId, h: spent.h, n: spent.n, a: 'c' }));
      const acted = (await a.messages.wait(
        (m) => (m.t === 'state' && m.s.n > spent.n) || m.t === 'err',
        5_000,
      ));
      expect(acted.t).toBe('state');
      // And the call landed as a call, not as the fold a spent clock applies.
      const after = acted.s as TableView;
      expect(after.last?.k).toBe('act');
      expect(after.last?.seat).toBe(view.you);
      expect(after.last?.a).toBe('c');

      a.ws.close();
      b.ws.close();
    },
    20_000,
  );
});
