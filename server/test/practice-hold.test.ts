import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { TableView } from '@opentable/protocol';
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

/* The practice hold: a practice table keeps a finished hand on screen for the
   human until they send `next`, rather than dealing on by itself the way
   every other table does. See server/src/match/CLAUDE.md.

   Stacks are left at the format's default (not shrunk the way most tests
   here shrink them) so a single hand busting the human is rare rather than
   common: several of these tests only mean what they say if the match is
   still going afterwards, and a stack shrunk for speed would make that a
   coin flip instead of the exception. */

async function pickBot(): Promise<UserRow> {
  const [bot] = await sql<UserRow[]>`select * from users where bot = true order by name_lower asc limit 1`;
  if (!bot) throw new Error('no bot in the roster to seat');
  return bot;
}

// Checks or calls on the human's own turn until a message matching `stop`
// arrives, same shape as clock.test.ts's helper.
async function checkOrCallUntil(conn: Connected, stop: (m: any) => boolean, timeoutMs = 8000): Promise<any> {
  for (let step = 0; step < 50; step++) {
    const msg = await conn.messages.wait((m) => (m.t === 'state' && m.s.legal !== null) || stop(m), timeoutMs);
    if (stop(msg)) return msg;
    const view = msg.s as TableView;
    const legal = view.legal!;
    const action = legal.actions.includes('x') ? 'x' : legal.actions.includes('c') ? 'c' : legal.actions[0];
    conn.ws.send(JSON.stringify({ t: 'act', m: view.m, h: view.h, n: view.n, a: action }));
  }
  throw new Error('too many steps without reaching the stop condition');
}

// The held view, specifically: the broadcast right after a hand ends (before
// the hold is decided) carries no `hold` yet, so waiting on street === 'done'
// alone can catch that one instead of the one the hold actually sets.
function isHeld(m: any): boolean {
  return m.t === 'state' && m.s.hold === 'you';
}

describe('the practice hold', () => {
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
    'holds a finished hand for the human until next arrives, then deals on',
    async () => {
      const bot = await pickBot();
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectSession(wsUrl, session);
      await conn.messages.wait((m) => m.t === 'hi');

      const format = testFormat({
        practice: true,
        rated: false,
        hands: 3,
        clockMs: 400,
        graceMs: 400,
        holdMs: 30,
        practiceHoldTimeoutMs: 60_000,
      });
      const matchId = await createMatchForPlayers([session.id, bot.id], format);
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const held = await checkOrCallUntil(conn, isHeld);
      const view = held.s as TableView;
      expect(view.result).not.toBeNull();

      // Nothing but `next` (or the safety timeout, set far out here) moves
      // the hold: no unsolicited next-hand view within an ordinary wait.
      await expect(
        conn.messages.wait((m) => m.t === 'state' && m.s.h > view.h, 300)
      ).rejects.toThrow();

      conn.ws.send(JSON.stringify({ t: 'next', m: matchId, h: view.h }));
      const after = await conn.messages.wait((m) => (m.t === 'state' && m.s.h > view.h) || m.t === 'end', 3000);
      // hands: 3 keeps the match open past hand 1 on any ordinary result; a
      // bust busting it early is the one thing that can still finish it,
      // and is not what this test is about, so either ending is accepted.
      if (after.t === 'state') expect(after.s.h).toBe(view.h + 1);
      else expect(after.r).toBeDefined();

      conn.ws.close();
    },
    20_000
  );

  it(
    'holds the last hand of a practice match until next, then finishes it',
    async () => {
      const bot = await pickBot();
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectSession(wsUrl, session);
      await conn.messages.wait((m) => m.t === 'hi');

      const format = testFormat({
        practice: true,
        rated: false,
        hands: 1,
        stack: 20,
        clockMs: 400,
        graceMs: 400,
        holdMs: 30,
        practiceHoldTimeoutMs: 60_000,
      });
      const matchId = await createMatchForPlayers([session.id, bot.id], format);
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const held = await checkOrCallUntil(conn, isHeld);
      const view = held.s as TableView;

      // The match is decided but not announced: `end` waits on `next` too.
      await expect(conn.messages.wait((m) => m.t === 'end', 300)).rejects.toThrow();

      conn.ws.send(JSON.stringify({ t: 'next', m: matchId, h: view.h }));
      const end = await conn.messages.wait((m) => m.t === 'end', 3000);
      expect(end.r).toBeDefined();

      conn.ws.close();
    },
    20_000
  );

  it(
    'ignores next for a stale hand number and from a spectator',
    async () => {
      const bot = await pickBot();
      const session = await mintGuestSession(app);
      const spectatorSession = await mintGuestSession(app);
      createdUserIds.push(session.id, spectatorSession.id);
      const conn = await connectSession(wsUrl, session);
      const spectator = await connectSession(wsUrl, spectatorSession);
      await conn.messages.wait((m) => m.t === 'hi');
      await spectator.messages.wait((m) => m.t === 'hi');

      const format = testFormat({
        practice: true,
        rated: false,
        hands: 3,
        clockMs: 400,
        graceMs: 400,
        holdMs: 30,
        practiceHoldTimeoutMs: 60_000,
      });
      const matchId = await createMatchForPlayers([session.id, bot.id], format);
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      spectator.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const held = await checkOrCallUntil(conn, isHeld);
      const view = held.s as TableView;

      // Wrong hand number, from the human.
      conn.ws.send(JSON.stringify({ t: 'next', m: matchId, h: view.h + 1 }));
      // Right hand number, but from a spectator rather than the human seat.
      spectator.ws.send(JSON.stringify({ t: 'next', m: matchId, h: view.h }));
      await expect(
        conn.messages.wait((m) => (m.t === 'state' && m.s.h > view.h) || m.t === 'end', 400)
      ).rejects.toThrow();

      conn.ws.send(JSON.stringify({ t: 'next', m: matchId, h: view.h }));
      const after = await conn.messages.wait((m) => (m.t === 'state' && m.s.h > view.h) || m.t === 'end', 3000);
      if (after.t === 'state') expect(after.s.h).toBe(view.h + 1);
      else expect(after.r).toBeDefined();

      conn.ws.close();
      spectator.ws.close();
    },
    20_000
  );

  it(
    'deals on by itself once the safety timeout expires with no next',
    async () => {
      const bot = await pickBot();
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectSession(wsUrl, session);
      await conn.messages.wait((m) => m.t === 'hi');

      const format = testFormat({
        practice: true,
        rated: false,
        hands: 3,
        clockMs: 400,
        graceMs: 400,
        holdMs: 30,
        practiceHoldTimeoutMs: 150,
      });
      const matchId = await createMatchForPlayers([session.id, bot.id], format);
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const held = await checkOrCallUntil(conn, isHeld);
      const view = held.s as TableView;

      // No `next` sent at all: the safety timeout deals on (or finishes the
      // match) regardless.
      const after = await conn.messages.wait((m) => (m.t === 'state' && m.s.h > view.h) || m.t === 'end', 3000);
      if (after.t === 'state') expect(after.s.h).toBe(view.h + 1);
      else expect(after.r).toBeDefined();

      conn.ws.close();
    },
    20_000
  );

  it(
    'does not wait on a non-practice table',
    async () => {
      const bot = await pickBot();
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectSession(wsUrl, session);
      await conn.messages.wait((m) => m.t === 'hi');

      const format = testFormat({ rated: false, hands: 1, stack: 20, clockMs: 400, graceMs: 400, holdMs: 30 });
      const matchId = await createMatchForPlayers([session.id, bot.id], format);
      createdMatchIds.push(matchId);
      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const end = await checkOrCallUntil(conn, (m) => m.t === 'end');
      expect(end.r).toBeDefined();

      conn.ws.close();
    },
    20_000
  );
});
