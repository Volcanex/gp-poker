import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  HEADS_UP_FORMAT, RUNOUT_TICKS, RUNOUT_TICK_MS, runoutTickFor, type TableView,
} from '@opentable/protocol';
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
import { sql, type UserRow } from '../src/db.js';

/* The all-in run-out: every hand still live is all in, nobody has a decision
   left, the cards go up at once and the board arrives a street at a time
   behind a count. See server/src/match/CLAUDE.md.

   The hand is rigged rather than played for. Three seats, two chips each and
   blinds of two: the two blinds are all in before a card is looked at, the
   button is the human, and their fold closes the betting on a hand with a
   whole board still to come. Nothing about it depends on how a bot decides,
   which is what makes the beats assertable. */

const TICK_MS = 60;

function runoutFormat() {
  return testFormat({
    mode: 'six-max',
    players: 3,
    rated: false,
    stack: 2,
    sb: 2,
    bb: 2,
    levels: [{ sb: 2, bb: 2 }],
    clockMs: 3_000,
    graceMs: 3_000,
    holdMs: 30,
    runoutTickMs: TICK_MS,
  });
}

async function pickBots(n: number): Promise<UserRow[]> {
  const bots = await sql<UserRow[]>`select * from users where bot = true order by name_lower asc limit ${n}`;
  if (bots.length < n) throw new Error(`only ${bots.length} bots in the roster, needed ${n}`);
  return bots;
}

function isState(m: any): boolean {
  return m.t === 'state';
}

// Every view this connection is sent from now until the hand is paid, in the
// order they arrived. The same view is broadcast twice where a run-out opens
// (the reveal's own first beat, and the room's broadcast after the action
// that closed the betting), so identical neighbours are dropped.
async function collectHand(conn: Connected, timeoutMs = 10_000): Promise<TableView[]> {
  const views: TableView[] = [];
  const until = Date.now() + timeoutMs;
  for (;;) {
    const left = until - Date.now();
    if (left <= 0) throw new Error('the hand never paid');
    const msg = await conn.messages.wait(isState, left);
    const view = msg.s as TableView;
    const prev = views[views.length - 1];
    if (!prev || JSON.stringify(prev) !== JSON.stringify(view)) views.push(view);
    if (view.result !== null) return views;
  }
}

function holding(view: TableView, seat: number): string[] {
  return view.seats.find((s) => s.i === seat)?.cards ?? [];
}

function isUp(cards: string[]): boolean {
  return cards.length === 2 && cards.every((c) => !c.startsWith('?'));
}

/* The product formats, not `testFormat`: the helper turns the pacing off so
   the rest of the suite does not sit through it, which is exactly the value
   these three want to see the real answer for. */
describe('runoutTickFor', () => {
  it('is one second on a product format', () => {
    expect(runoutTickFor(HEADS_UP_FORMAT)).toBe(RUNOUT_TICK_MS);
  });

  it('never lets one street outlast a decision', () => {
    // A 300 ms clock is a test or a ladder, and neither should spend nine
    // seconds watching a board that is already dealt.
    expect(runoutTickFor({ ...HEADS_UP_FORMAT, clockMs: 300 })).toBe(300 / RUNOUT_TICKS);
  });

  it('takes zero as no pacing at all', () => {
    expect(runoutTickFor({ ...HEADS_UP_FORMAT, runoutTickMs: 0 })).toBe(0);
  });
});

describe('an all-in run-out', () => {
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
    'shows the live hands from the moment the betting closes, and paces the board',
    async () => {
      const bots = await pickBots(2);
      const session = await mintGuestSession(app);
      const watcher = await mintGuestSession(app);
      createdUserIds.push(session.id, watcher.id);
      const conn = await connectSession(wsUrl, session);
      const spectator = await connectSession(wsUrl, watcher);
      await conn.messages.wait((m) => m.t === 'hi');
      await spectator.messages.wait((m) => m.t === 'hi');

      // Seat order is the array's order, and hand one puts the button on the
      // lowest live seat: the human is the button and acts first.
      const matchId = await createMatchForPlayers([session.id, bots[0].id, bots[1].id], runoutFormat());
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      spectator.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const turn = await conn.messages.wait((m) => m.t === 'state' && m.s.legal !== null, 8000);
      const before = turn.s as TableView;
      expect(before.you).toBe(0);
      // Both blinds are already all in and neither hand is shown yet.
      expect(before.seats[1].allin).toBe(true);
      expect(before.seats[2].allin).toBe(true);
      expect(isUp(holding(before, 1))).toBe(false);
      expect(isUp(holding(before, 2))).toBe(false);

      conn.ws.send(JSON.stringify({ t: 'act', m: matchId, h: before.h, n: before.n, a: 'f' }));

      const mine = await collectHand(conn);
      const theirs = await collectHand(spectator);

      const paced = mine.filter((v) => v.runout != null);
      expect(paced.length).toBeGreaterThan(0);

      /* The reveal. Every hand still live is face up from the first beat,
         and it does not wait for the river. */
      for (const view of paced) {
        expect(isUp(holding(view, 1)), 'seat 1 is up').toBe(true);
        expect(isUp(holding(view, 2)), 'seat 2 is up').toBe(true);
        // Nothing is paid, published or clocked until the board is finished.
        expect(view.result).toBeNull();
        expect(view.seed).toBeNull();
        expect(view.clock).toBeNull();
        expect(view.legal).toBeNull();
        expect(view.street).not.toBe('done');
      }

      /* The pacing. Three beats before each of the three streets left, each
         street named as it is counted to, and the board only as long as the
         table has been shown. */
      expect(paced.map((v) => `${v.runout!.next} ${v.runout!.in}`)).toEqual([
        'flop 3', 'flop 2', 'flop 1',
        'turn 3', 'turn 2', 'turn 1',
        'river 3', 'river 2', 'river 1',
      ]);
      const boardAt = (street: string) =>
        [...new Set(paced.filter((v) => v.runout!.next === street).map((v) => v.board.length))];
      expect(boardAt('flop')).toEqual([0]);
      expect(boardAt('turn')).toEqual([3]);
      expect(boardAt('river')).toEqual([4]);
      expect(RUNOUT_TICKS).toBe(3);

      // The board grows a street at a time and never jumps to five.
      expect([...new Set(mine.map((v) => v.board.length))]).toEqual([0, 3, 4, 5]);

      /* And the hand is paid once the river is on the table. */
      const paid = mine[mine.length - 1];
      expect(paid.street).toBe('done');
      expect(paid.board).toHaveLength(5);
      expect(paid.result!.awards.length).toBeGreaterThan(0);

      /* A spectator sees exactly the same run-out, with the seat that folded
         still hidden: the reveal is the showdown's, and a folded hand is no
         part of one. */
      const watched = theirs.filter((v) => v.runout != null);
      expect(watched.map((v) => `${v.runout!.next} ${v.runout!.in}`))
        .toEqual(paced.map((v) => `${v.runout!.next} ${v.runout!.in}`));
      for (const view of watched) {
        expect(view.you).toBeNull();
        expect(holding(view, 0)).toEqual(['?', '?']);
        expect(isUp(holding(view, 1))).toBe(true);
        expect(isUp(holding(view, 2))).toBe(true);
      }
      expect(watched[0].seats[1].cards).toEqual(paced[0].seats[1].cards);
      expect(watched[0].seats[2].cards).toEqual(paced[0].seats[2].cards);

      conn.ws.close();
      spectator.ws.close();
    },
    30_000
  );

  it(
    'deals the whole board at once when the format asks for no pacing',
    async () => {
      const bots = await pickBots(2);
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectSession(wsUrl, session);
      await conn.messages.wait((m) => m.t === 'hi');

      const matchId = await createMatchForPlayers(
        [session.id, bots[0].id, bots[1].id],
        { ...runoutFormat(), runoutTickMs: 0 },
      );
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const turn = await conn.messages.wait((m) => m.t === 'state' && m.s.legal !== null, 8000);
      const before = turn.s as TableView;
      conn.ws.send(JSON.stringify({ t: 'act', m: matchId, h: before.h, n: before.n, a: 'f' }));

      const views = await collectHand(conn);
      expect(views.some((v) => v.runout != null)).toBe(false);
      const paid = views[views.length - 1];
      expect(paid.board).toHaveLength(5);
      expect(paid.result).not.toBeNull();

      conn.ws.close();
    },
    30_000
  );
});
