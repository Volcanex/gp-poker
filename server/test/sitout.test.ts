import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, SeatView, TableView } from '@opentable/protocol';
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

/* Sitting out: what a multiway table does with a seat that has stopped
   answering, and what a practice table pointedly does not do with one. See
   server/src/match/CLAUDE.md.

   The defect these were written for: three background suspends on a phone
   read as three timeouts, sat the owner out, and from there every hand folded
   him at a millisecond or two while he sat looking at the table. */

// Three seats, a fast clock and the product's stack: the quiet seat folds
// its way to a sit-out inside three hands and nobody busts on the way.
const THREE_MAX: MatchFormat = testFormat({ mode: 'six-max', clockMs: 300, graceMs: 400 });

function seatOf(view: TableView, uid: string): SeatView {
  const seat = view.seats.find((s) => s.uid === uid);
  if (!seat) throw new Error(`no seat for ${uid}`);
  return seat;
}

/* Checks or calls on this connection's own turn, for as long as it takes the
   room to reach `stop`. Two of these run side by side to keep a three-handed
   table moving while the third seat says nothing at all. */
function drive(conn: Connected, stop: (m: any) => boolean, timeoutMs = 20_000): Promise<any> {
  return (async () => {
    for (let step = 0; step < 200; step++) {
      const msg = await conn.messages.wait((m) => (m.t === 'state' && m.s.legal !== null) || stop(m), timeoutMs);
      if (stop(msg)) return msg;
      const view = msg.s as TableView;
      const legal = view.legal!;
      const action = legal.actions.includes('x') ? 'x' : legal.actions.includes('c') ? 'c' : legal.actions[0];
      conn.ws.send(JSON.stringify({ t: 'act', m: view.m, h: view.h, n: view.n, a: action }));
    }
    throw new Error('too many steps without reaching the stop condition');
  })();
}

/* A decision that is actually theirs, right now. The clock alone is not
   enough: the broadcast that reports a timeout is sent before `rearmClock`
   runs, so it still carries the deadline that has just run out, on the seat
   it ran out on. Asking the engine who is acting as well is what tells the
   two apart. */
function quietIsToAct(uid: string) {
  return (m: any): boolean => {
    if (m.t !== 'state' || m.s.clock == null) return false;
    const view = m.s as TableView;
    const seat = view.seats.find((s) => s.uid === uid);
    return seat != null && seat.acting && view.clock!.seat === seat.i;
  };
}

/* Everything already in a connection's queue is history. `wait` matches
   against the backlog first, so a test that asserts about a live clock has to
   throw the backlog away or it will assert against a deadline that ran out
   three hands ago. */
async function drain(conn: Connected): Promise<void> {
  for (;;) {
    try {
      await conn.messages.wait(() => true, 0);
    } catch {
      return;
    }
  }
}

async function pickBot(): Promise<UserRow> {
  const [bot] = await sql<UserRow[]>`select * from users where bot = true order by name_lower asc limit 1`;
  if (!bot) throw new Error('no bot in the roster to seat');
  return bot;
}

describe('sitting out', () => {
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

  /* A three-handed table where seat 0 joins, watches, and never acts. Runs
     until its own view says seat 0 is sitting out, and hands back the live
     connections so a test can carry on from there. */
  async function tableWithASatOutSeat(): Promise<{
    matchId: string;
    quiet: Connected;
    others: Connected[];
  }> {
    const sessions = [
      await mintGuestSession(app),
      await mintGuestSession(app),
      await mintGuestSession(app),
    ];
    createdUserIds.push(...sessions.map((s) => s.id));
    const conns: Connected[] = [];
    for (const s of sessions) {
      const conn = await connectSession(wsUrl, s);
      await conn.messages.wait((m) => m.t === 'hi');
      conns.push(conn);
    }

    const matchId = await createMatchForPlayers(sessions.map((s) => s.id), THREE_MAX);
    createdMatchIds.push(matchId);
    for (const conn of conns) conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

    const [quiet, ...others] = conns;
    const isSatOut = (m: any) => m.t === 'state' && seatOf(m.s as TableView, quiet.id).sittingOut === true;
    // The quiet seat only watches; the other two keep the hands coming.
    await Promise.all([
      quiet.messages.wait(isSatOut, 25_000),
      ...others.map((c) => drive(c, isSatOut, 25_000)),
    ]);
    return { matchId, quiet, others };
  }

  it(
    'sits a multiway seat out after three consecutive timeouts, and says so on the wire',
    async () => {
      const { quiet, others } = await tableWithASatOutSeat();

      // Every seat at the table can see it, not just the seat it happened to.
      const seen = await others[0].messages.wait(
        (m) => m.t === 'state' && seatOf(m.s as TableView, quiet.id).sittingOut === true,
        10_000,
      );
      const view = seen.s as TableView;
      expect(seatOf(view, quiet.id).sittingOut).toBe(true);
      // Sitting out is not being eliminated: they are still dealt in.
      expect(seatOf(view, quiet.id).out).toBe(false);
      // And nobody else is sitting out for it.
      for (const other of others) expect(seatOf(view, other.id).sittingOut).toBeUndefined();

      for (const conn of [quiet, ...others]) conn.ws.close();
    },
    45_000,
  );

  it(
    'gives a sat-out seat the full clock while its player is still there',
    async () => {
      const { quiet, others } = await tableWithASatOutSeat();
      await drain(quiet);

      /* The defect, precisely: this used to arrive with a deadline of
         Date.now() and a check-fold already queued on a zero-delay timer. A
         player who is at the table gets the clock a player at the table gets,
         whether or not the room has them down as sitting out. */
      const isQuietsTurn = quietIsToAct(quiet.id);
      const [onTurn] = await Promise.all([
        quiet.messages.wait(isQuietsTurn, 20_000),
        ...others.map((c) => drive(c, isQuietsTurn, 20_000)),
      ]);
      const view = onTurn.s as TableView;
      expect(seatOf(view, quiet.id).sittingOut).toBe(true);
      expect(view.clock!.paused).toBe(false);
      expect(view.clock!.deadline - Date.now()).toBeGreaterThan(THREE_MAX.clockMs / 2);

      for (const conn of [quiet, ...others]) conn.ws.close();
    },
    45_000,
  );

  it(
    'un-sits a seat on back, and the next decision there gets a full clock',
    async () => {
      const { matchId, quiet, others } = await tableWithASatOutSeat();
      await drain(quiet);

      quiet.ws.send(JSON.stringify({ t: 'back', m: matchId }));
      const cleared = await quiet.messages.wait(
        (m) => m.t === 'state' && seatOf(m.s as TableView, quiet.id).sittingOut === undefined,
        10_000,
      );
      expect(seatOf(cleared.s as TableView, quiet.id).sittingOut).toBeUndefined();

      const isQuietsTurn = quietIsToAct(quiet.id);
      const [onTurn] = await Promise.all([
        quiet.messages.wait(isQuietsTurn, 20_000),
        ...others.map((c) => drive(c, isQuietsTurn, 20_000)),
      ]);
      const view = onTurn.s as TableView;
      expect(view.clock!.paused).toBe(false);
      expect(view.clock!.deadline - Date.now()).toBeGreaterThan(THREE_MAX.clockMs / 2);

      for (const conn of [quiet, ...others]) conn.ws.close();
    },
    45_000,
  );

  it(
    'never sits a practice human out, and pauses their table for as long as they are away',
    async () => {
      const bot = await pickBot();
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      let conn = await connectSession(wsUrl, session);
      await conn.messages.wait((m) => m.t === 'hi');

      /* graceMs shorter than the wait below is the whole point: three of
         these windows used to expire into three timeouts and a forfeit, so a
         practice player lost the match by putting their phone down. */
      const format = testFormat({
        practice: true,
        rated: false,
        // A clock long enough that closing the socket cannot lose a race
        // with it, and a grace window far shorter than the wait below.
        clockMs: 3_000,
        graceMs: 200,
        holdMs: 30,
        practiceHoldTimeoutMs: 60_000,
      });
      const matchId = await createMatchForPlayers([session.id, bot.id], format);
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const mine = await conn.messages.wait((m) => m.t === 'state' && m.s.legal !== null, 10_000);
      const before = mine.s as TableView;

      // Away, for many times the grace window and many times the clock.
      conn.ws.close();
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      conn = await connectSession(wsUrl, session);
      await conn.messages.wait((m) => m.t === 'hi');
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      /* A forfeited match would answer this join with `end` as well as a
         state, and a timed-out one would have moved on to another decision.
         Neither happened: the table is exactly where they left it. */
      const back = await conn.messages.wait((m) => m.t === 'state', 10_000);
      const after = back.s as TableView;
      expect(after.h).toBe(before.h);
      expect(after.n).toBe(before.n);
      expect(after.legal).not.toBeNull();
      expect(seatOf(after, session.id).sittingOut).toBeUndefined();
      await expect(conn.messages.wait((m) => m.t === 'end', 500)).rejects.toThrow();

      conn.ws.close();
    },
    45_000,
  );
});
