import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatFor, walkoutBanMs, type MatchFormat, type Mode, type TableView } from '@opentable/protocol';
import {
  connectSession,
  connectWs,
  deleteUser,
  driveRandomPlay,
  listenForWs,
  makeApp,
  mintGuestSession,
  testFormat,
  unlockRanked,
  type Connected,
  type Session,
} from './helpers.js';
import { createMatchForPlayers, setFormatResolver } from '../src/matchmaking.js';
import { resetReadyChecks } from '../src/ready.js';
import { chargeWalkout, walkoutState } from '../src/walkouts.js';
import { getMatchById, recordWalkout, sql } from '../src/db.js';

/* Leaving a match, and what it costs.

   Driven through the real socket rather than by calling into the room,
   because what is under test is the wire: `resign` has to be a different
   message from `leave` (a page unmounting must never forfeit anybody), the
   ending has to arrive as an `end` a client can draw, and the ban has to be
   a refusal the queue actually sends. The ladder itself is arithmetic and is
   tested against the database it is stored in. */

const RANKED: MatchFormat = testFormat({ hands: 6, stack: 20, clockMs: 1500, graceMs: 1500 });
// Three seats, fifteen units and no hand hold: random play busts the table
// in a handful of hands, and the leaver is blinded off through all of them.
const MULTIWAY: MatchFormat = testFormat({
  mode: 'six-max',
  players: 3,
  stack: 15,
  clockMs: 1500,
  graceMs: 1500,
  holdMs: 30,
});
const PRACTICE: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ hands: 6, stack: 20, clockMs: 1500, graceMs: 1500 }),
  'six-max': testFormat({ mode: 'six-max', stack: 12, clockMs: 1500, graceMs: 1500 }),
};

/* The away limit, shrunk from ten minutes to under a second. `hands: 1` so
   one fold reaches the hold at the end of the match, and a hold timeout far
   longer than the away window so the held table is genuinely still held when
   the window runs out: that is the case the limit exists for, and the one
   where a table with nobody at it used to sit `playing` for good. */
const AWAY_MS = 700;
const AWAY: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({
    hands: 1,
    stack: 20,
    clockMs: 4000,
    graceMs: 4000,
    practiceAwayMs: AWAY_MS,
    practiceHoldTimeoutMs: 30_000,
  }),
  'six-max': testFormat({ mode: 'six-max', stack: 12, clockMs: 4000, graceMs: 4000, practiceAwayMs: AWAY_MS }),
};

/* Deals a practice table and plays the human's seat until the table is
   holding for their `next`, which on a one-hand match is the moment before
   it would finish. Returns the match id with the socket still open. */
async function practiceHeldTable(
  app: FastifyInstance,
  wsUrl: string,
  session: Session
): Promise<{ conn: Connected; matchId: string }> {
  const conn = await connectSession(wsUrl, session);
  await conn.messages.wait((m) => m.t === 'hi');
  conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', bots: { level: 2 } }));
  const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found');
  conn.ws.send(JSON.stringify({ t: 'join', m: found.m }));
  for (let step = 0; step < 40; step++) {
    const msg = await conn.messages.wait(
      (m) => m.t === 'state' && (m.s.legal !== null || m.s.hold === 'you'),
      8000
    );
    const view = msg.s as TableView;
    if (view.hold === 'you') return { conn, matchId: found.m };
    const legal = view.legal!;
    const action = legal.actions.includes('f') ? 'f' : legal.actions[0];
    conn.ws.send(JSON.stringify({ t: 'act', m: view.m, h: view.h, n: view.n, a: action }));
  }
  throw new Error('the practice table never held for the human');
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('leaving a match', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    setFormatResolver(formatFor);
    resetReadyChecks();
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it(
    'hands a heads-up ranked match to the opponent, rates it and charges a walkout',
    async () => {
      const a = await mintGuestSession(app); // the one who leaves
      const b = await mintGuestSession(app);
      createdUserIds.push(a.id, b.id);

      const connA = await connectWs(wsUrl, a.token);
      const connB = await connectWs(wsUrl, b.token);
      await connA.messages.wait((m) => m.t === 'hi');
      await connB.messages.wait((m) => m.t === 'hi');

      const matchId = await createMatchForPlayers([a.id, b.id], RANKED);
      createdMatchIds.push(matchId);
      connA.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      connB.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      await connA.messages.wait((m) => m.t === 'state');

      connA.ws.send(JSON.stringify({ t: 'resign', m: matchId }));

      const end = await connB.messages.wait((m) => m.t === 'end' && m.m === matchId);
      // `left` and not `forfeit`: the panel reads the two differently, and
      // saying a clock took the match when somebody pressed a button is the
      // kind of small lie that makes a result untrustworthy.
      expect(end.r.reason).toBe('left');
      expect(end.r.winner).toBe(b.id);
      expect(end.r.places[a.id]).toBe(2);
      expect(end.r.places[b.id]).toBe(1);

      // Rated as a loss, which is the whole cost of leaving one.
      expect(end.r.rated).toBe(true);
      expect(end.r.ratings[a.id].after).toBeLessThan(end.r.ratings[a.id].before);
      expect(end.r.ratings[b.id].after).toBeGreaterThan(end.r.ratings[b.id].before);

      const row = await getMatchById(matchId);
      expect(row!.status).toBe('finished');
      expect(row!.reason).toBe('left');

      // And a strike, which the first one alone does not ban for.
      const state = await walkoutState(a.id);
      expect(state.strikes).toBe(1);
      expect(state.banUntil).toBeNull();
      expect((await walkoutState(b.id)).strikes).toBe(0);

      connA.ws.close();
      connB.ws.close();
    },
    20_000
  );

  it(
    'sits a multiway seat out for good and plays the match on without them',
    async () => {
      const sessions = [
        await mintGuestSession(app),
        await mintGuestSession(app),
        await mintGuestSession(app),
      ];
      createdUserIds.push(...sessions.map((s) => s.id));
      const conns = [];
      for (const s of sessions) {
        const conn = await connectWs(wsUrl, s.token);
        await conn.messages.wait((m) => m.t === 'hi');
        conns.push(conn);
      }

      const matchId = await createMatchForPlayers(sessions.map((s) => s.id), MULTIWAY);
      createdMatchIds.push(matchId);
      for (const conn of conns) conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      const first = await conns[0].messages.wait((m) => m.t === 'state');
      const seat = (first.s as TableView).you!;

      conns[0].ws.send(JSON.stringify({ t: 'resign', m: matchId }));

      // Forfeiting one seat here would hand the other two a free elimination,
      // so the match is still running a beat later.
      await new Promise((r) => setTimeout(r, 300));
      expect((await getMatchById(matchId))!.status).toBe('playing');

      // The seat reads as sitting out on the wire, which is what the rest of
      // the table sees, and the socket is still open the whole time: leaving
      // is not a disconnect and must not need one to take effect.
      const satOut = await conns[1].messages.wait(
        (m) => m.t === 'state' && m.s.seats.some((x: any) => x.i === seat && x.sittingOut)
      );
      expect(satOut.s.seats.find((x: any) => x.i === seat).sittingOut).toBe(true);

      // And there is no way back into it: a sat-out player is one action from
      // being at the table again, somebody who left is not. Neither door
      // opens, and `back` is the one built for a player who is there and
      // cannot reach the buttons.
      const view = first.s as TableView;
      conns[0].ws.send(
        JSON.stringify({ t: 'act', m: matchId, h: view.h, n: view.n, a: 'f' })
      );
      const refused = await conns[0].messages.wait((m) => m.t === 'err');
      expect(refused.c).toBe('not_your_turn');

      conns[0].ws.send(JSON.stringify({ t: 'back', m: matchId }));
      /* Read from a state the table sent AFTER that, not from whichever one
         is at the head of the queue: the room broadcasts constantly and an
         older frame would say what was true before the message was sent. */
      const after = { h: satOut.s.h as number, n: satOut.s.n as number };
      const still = await conns[1].messages.wait(
        (m) =>
          m.t === 'state' &&
          (m.s.h > after.h || (m.s.h === after.h && m.s.n > after.n)) &&
          m.s.seats.some((x: any) => x.i === seat)
      );
      expect(still.s.seats.find((x: any) => x.i === seat).sittingOut).toBe(true);

      // The other two play it out. The leaver is blinded off and placed with
      // everybody else rather than being dropped from the result.
      const [end] = await Promise.all([
        driveRandomPlay(conns[1], 30_000),
        driveRandomPlay(conns[2], 30_000),
      ]);
      expect(end.reason).not.toBe('left'); // the match ended on its own terms
      // Last of the three, fixed at the moment they left. Without that the
      // blinds can leave them holding chips after the other two have busted
      // each other, and the match goes to the person who walked out of it.
      expect(end.places[sessions[0].id]).toBe(3);
      expect(end.winner).not.toBe(sessions[0].id);
      expect(new Set(Object.values(end.places))).toEqual(new Set([1, 2, 3]));
      expect(typeof seat).toBe('number');

      for (const conn of conns) conn.ws.close();
    },
    40_000
  );

  it(
    'ends a practice table with no rating and no strike',
    async () => {
      setFormatResolver((mode, rated) => ({ ...PRACTICE[mode], rated }));
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectWs(wsUrl, session.token);
      await conn.messages.wait((m) => m.t === 'hi');

      conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', bots: { level: 2 } }));
      const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found');
      createdMatchIds.push(found.m);
      conn.ws.send(JSON.stringify({ t: 'join', m: found.m }));
      await conn.messages.wait((m) => m.t === 'state');

      conn.ws.send(JSON.stringify({ t: 'resign', m: found.m }));
      const end = await conn.messages.wait((m) => m.t === 'end' && m.m === found.m);

      expect(end.r.reason).toBe('left');
      expect(end.r.rated).toBe(false);
      const mine = end.r.ratings[session.id];
      expect(mine.after).toBe(mine.before);
      expect(mine.rdAfter).toBe(mine.rdBefore);
      expect((await walkoutState(session.id)).strikes).toBe(0);

      conn.ws.close();
      setFormatResolver(formatFor);
    },
    20_000
  );

  it(
    'gives a held practice table up once its human has been away long enough',
    async () => {
      setFormatResolver((mode, rated) => ({ ...AWAY[mode], rated }));
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const { conn, matchId } = await practiceHeldTable(app, wsUrl, session);
      createdMatchIds.push(matchId);

      /* The tab closes on a table that is holding for a `next` nobody is
         going to send. Before this limit existed that match stayed `playing`
         for good, with its bots held out of the roster. */
      conn.ws.close();
      await new Promise((r) => setTimeout(r, AWAY_MS + 900));

      const row = await getMatchById(matchId);
      expect(row!.status).toBe('finished');
      // Ended the way they would have ended it themselves, and charged for
      // nothing: practice is never rated and took no game off anybody.
      expect(row!.reason).toBe('left');
      expect(row!.rated).toBe(false);
      expect((await walkoutState(session.id)).strikes).toBe(0);
      setFormatResolver(formatFor);
    },
    20_000
  );

  it(
    'keeps the table when the human comes back inside the window',
    async () => {
      setFormatResolver((mode, rated) => ({ ...AWAY[mode], rated }));
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const { conn, matchId } = await practiceHeldTable(app, wsUrl, session);
      createdMatchIds.push(matchId);

      conn.ws.close();
      await new Promise((r) => setTimeout(r, Math.floor(AWAY_MS / 3)));
      const back = await connectSession(wsUrl, session);
      await back.messages.wait((m) => m.t === 'hi');

      // Well past the moment the window would have run out, had coming back
      // not cleared it.
      await new Promise((r) => setTimeout(r, AWAY_MS + 900));
      const row = await getMatchById(matchId);
      expect(row!.status).toBe('playing');

      // And the table is still theirs to finish: the hold is still up, and
      // answering it ends the one-hand match properly rather than as a walk.
      back.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      const held = await back.messages.wait((m) => m.t === 'state' && m.s.hold === 'you', 8000);
      back.ws.send(JSON.stringify({ t: 'next', m: matchId, h: held.s.h }));
      const end = await back.messages.wait((m) => m.t === 'end' && m.m === matchId, 8000);
      expect(end.r.reason).not.toBe('left');

      back.ws.close();
      setFormatResolver(formatFor);
    },
    25_000
  );

  it('climbs the ladder and lets it decay a strike a day', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    const t0 = Date.now();

    // One walkout is a bad evening, not a pattern.
    expect(await chargeWalkout(session.id, t0)).toEqual({ strikes: 1, banUntil: null });

    // The second inside the day is the first that costs anything.
    const second = await chargeWalkout(session.id, t0 + 1000);
    expect(second.strikes).toBe(2);
    expect(second.banUntil).toBe(t0 + 1000 + walkoutBanMs(2));

    const third = await chargeWalkout(session.id, t0 + 2000);
    expect(third.strikes).toBe(3);
    expect(third.banUntil).toBe(t0 + 2000 + walkoutBanMs(3));

    const fourth = await chargeWalkout(session.id, t0 + 3000);
    expect(fourth.banUntil).toBe(t0 + 3000 + walkoutBanMs(4));

    // Five and everything after is the top of the ladder, eight hours.
    const fifth = await chargeWalkout(session.id, t0 + 4000);
    expect(fifth.strikes).toBe(5);
    expect(fifth.banUntil).toBe(t0 + 4000 + walkoutBanMs(5));
    expect(walkoutBanMs(9)).toBe(walkoutBanMs(5));

    // A day later the count has dropped by one, and it keeps dropping.
    expect((await walkoutState(session.id, t0 + DAY_MS + 5000)).strikes).toBe(4);
    expect((await walkoutState(session.id, t0 + 3 * DAY_MS + 5000)).strikes).toBe(2);
    // And bottoms out at nothing rather than going negative.
    expect((await walkoutState(session.id, t0 + 40 * DAY_MS)).strikes).toBe(0);

    // A walkout after a week lands on the decayed count, not the stored one.
    const later = await chargeWalkout(session.id, t0 + 7 * DAY_MS);
    expect(later.strikes).toBe(1);
    expect(later.banUntil).toBeNull();
  });

  it('never shortens a ban somebody is halfway through', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    const t0 = Date.now();

    /* One strike carrying a long ban. The ladder as it stands cannot reach
       this on its own, because every rung is shorter than the day a strike
       takes to decay, but the ladder is a table somebody will change and the
       rule this guards is the one that has to survive it: the second
       strike's five minutes must never cut an eight hour ban short. */
    const running = t0 + 8 * 60 * 60_000;
    await recordWalkout(session.id, 1, new Date(t0), new Date(running));

    const after = await chargeWalkout(session.id, t0 + 1000);
    expect(after.strikes).toBe(2);
    expect(walkoutBanMs(2)).toBeLessThan(running - t0); // the rung really is shorter
    expect(after.banUntil).toBe(running);
  });

  it('refuses a banned player at the ranked queue and lets them play casual', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    createdMatchIds.push(await unlockRanked(session.id));
    // Two walkouts inside a day, which is the first rung with a ban on it.
    await chargeWalkout(session.id);
    await chargeWalkout(session.id);

    const conn = await connectWs(wsUrl, session.token);
    await conn.messages.wait((m) => m.t === 'hi');

    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: true }));
    const refused = await conn.messages.wait((m) => m.t === 'err' && m.c === 'ranked_ban');
    // It says when, not only no.
    expect(refused.msg).toContain('Ranked opens again in');

    // The refusal is about ranked and nothing else: casual is exactly where
    // somebody serving one is meant to still be able to play.
    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: false }));
    const searching = await conn.messages.wait((m) => m.t === 'q' && m.s === 'searching');
    expect(searching.rated).toBe(false);
    conn.ws.send(JSON.stringify({ t: 'dequeue' }));

    // And /api/me carries the same two facts the play panel draws from.
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `ot_session=${session.token}` },
    });
    const body = me.json();
    expect(body.walkoutStrikes).toBe(2);
    expect(body.rankedBanUntil).toBeGreaterThan(Date.now());

    conn.ws.close();
  }, 15_000);

  it('ignores a resign from somebody with no seat at the table', async () => {
    const a = await mintGuestSession(app);
    const b = await mintGuestSession(app);
    const watcher = await mintGuestSession(app);
    createdUserIds.push(a.id, b.id, watcher.id);

    const connW = await connectWs(wsUrl, watcher.token);
    await connW.messages.wait((m) => m.t === 'hi');

    const matchId = await createMatchForPlayers([a.id, b.id], RANKED);
    createdMatchIds.push(matchId);
    connW.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    await connW.messages.wait((m) => m.t === 'state');

    connW.ws.send(JSON.stringify({ t: 'resign', m: matchId }));
    const refused = await connW.messages.wait((m) => m.t === 'err');
    expect(refused.c).toBe('not_your_turn');
    expect((await getMatchById(matchId))!.status).toBe('playing');
    expect((await walkoutState(watcher.id)).strikes).toBe(0);

    connW.ws.close();
  }, 15_000);
});
