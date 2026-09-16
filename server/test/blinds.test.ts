import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, SeatView, TableView } from '@opentable/protocol';
import {
  makeApp,
  mintGuestSession,
  deleteUser,
  listenForWs,
  connectWs,
  driveRandomPlay,
  testFormat,
  type WsMessages,
} from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { sql } from '../src/db.js';

/* Who is in the blinds is the server's answer and nobody else's: the client
   draws `SeatView.blind` and never counts round from the button itself, so
   what is asserted here is what the felt shows. The rule has two halves and
   both are on the wire in one match: heads-up the button is the small blind,
   multiway the two seats left of it, and a busted seat is skipped rather than
   charged. See server/src/match/CLAUDE.md. */

/* Every blind fact one frame carries. `live` is what the table looks like
   under the marker: a seat that is out has left the hand, so the rule counts
   round the ones still in it. */
function blindsIn(view: TableView) {
  const live = view.seats.filter((s) => !s.out);
  const sb = view.seats.filter((s) => s.blind === 'sb');
  const bb = view.seats.filter((s) => s.blind === 'bb');
  const button = view.seats.find((s) => s.button) ?? null;
  return { live, sb, bb, button };
}

/* The seat that many places clockwise from the button, counting only the
   seats still in the match: the rule, written here so the test says it rather
   than asking the server to agree with itself. */
function fromButton(live: SeatView[], button: SeatView, step: number): SeatView {
  const at = live.findIndex((s) => s.i === button.i);
  return live[(at + step) % live.length];
}

function check(view: TableView, where: string): void {
  const { live, sb, bb, button } = blindsIn(view);
  expect(sb.length, `${where}: one small blind`).toBe(1);
  expect(bb.length, `${where}: one big blind`).toBe(1);
  expect(button, `${where}: somebody on the button`).not.toBeNull();
  expect(sb[0].out, `${where}: a busted seat in the small blind`).toBe(false);
  expect(bb[0].out, `${where}: a busted seat in the big blind`).toBe(false);
  expect(sb[0].i, `${where}: the blinds are two different seats`).not.toBe(bb[0].i);

  if (live.length === 2) {
    expect(sb[0].i, `${where}: heads-up, the button is the small blind`).toBe(button!.i);
    expect(bb[0].i).toBe(fromButton(live, button!, 1).i);
  } else {
    expect(sb[0].i, `${where}: the small blind is left of the button`).toBe(fromButton(live, button!, 1).i);
    expect(bb[0].i, `${where}: the big blind is left of that`).toBe(fromButton(live, button!, 2).i);
    expect(sb[0].i, `${where}: the button posts neither blind multiway`).not.toBe(button!.i);
  }

  /* And the money agrees with the marker. Before the first decision of a
     hand the only chips in front of anybody are the blinds, so the two seats
     that have bet are exactly the two the markers name. A short stack posts
     what it has, which is why this reads the order of the two rather than
     their sizes. */
  if (view.n === 0 && view.street === 'pre') {
    const posted = view.seats.filter((s) => s.bet > 0).map((s) => s.i).sort((a, b) => a - b);
    expect(posted, `${where}: the seats that put chips in`).toEqual([sb[0].i, bb[0].i].sort((a, b) => a - b));
    expect(sb[0].bet, `${where}: the small blind is the smaller of the two`).toBeLessThanOrEqual(bb[0].bet);
  }
}

describe('who the table says is in the blinds', () => {
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

  async function table(format: MatchFormat, seats: number) {
    const sessions = [];
    for (let i = 0; i < seats; i++) sessions.push(await mintGuestSession(app));
    createdUserIds.push(...sessions.map((s) => s.id));

    const conns: { ws: any; messages: WsMessages }[] = [];
    const frames: any[][] = [];
    for (const s of sessions) {
      const conn = await connectWs(wsUrl, s.token);
      await conn.messages.wait((m) => m.t === 'hi');
      const mine: any[] = [];
      conn.ws.on('message', (raw: Buffer) => mine.push(JSON.parse(raw.toString())));
      frames.push(mine);
      conns.push(conn);
    }

    const matchId = await createMatchForPlayers(sessions.map((s) => s.id), format);
    createdMatchIds.push(matchId);
    for (const conn of conns) conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    return { conns, frames };
  }

  it('marks the button as the small blind heads-up', async () => {
    const { conns } = await table(testFormat({ clockMs: 5000, graceMs: 1000 }), 2);
    const msg = await conns[0].messages.wait((m) => m.t === 'state' && m.s.n === 0, 20_000);
    const view = msg.s as TableView;
    expect(view.seats.length).toBe(2);
    check(view, 'the first hand heads-up');
    /* Your own seat carries it too, which is what the hero band draws: a
       marker only opponents get is half the fact. */
    const you = view.seats.find((s) => s.i === view.you)!;
    expect(you.blind === 'sb' || you.blind === 'bb').toBe(true);
    for (const conn of conns) conn.ws.close();
  }, 60_000);

  it(
    'marks the two seats left of the button multiway, and skips the ones that busted',
    async () => {
      /* Three seats played out at random. Every frame of every match is
         checked; the match is repeated only because the shape this test is
         after is not one random play is owed. Most three-handed matches deal
         a hand with a seat already out, but one all-in that busts two at once
         ends the match straight from three, so the table is dealt again until
         both shapes have been seen rather than the assertion being softened
         to whatever one match happened to produce. */
      const format = testFormat({ mode: 'six-max', players: 3, stack: 40, clockMs: 1200, graceMs: 1200 });
      const seatsIn: number[] = [];
      const views: TableView[] = [];
      for (let attempt = 0; attempt < 4 && !seatsIn.includes(2); attempt++) {
        const { conns, frames } = await table(format, 3);
        await Promise.all(conns.map((c) => driveRandomPlay(c, 60_000)));
        for (const conn of conns) conn.ws.close();
        const dealt: TableView[] = frames[0].filter((m) => m.t === 'state').map((m) => m.s as TableView);
        dealt.forEach((view, i) => check(view, `match ${attempt}, frame ${i} of hand ${view.h}`));
        views.push(...dealt);
        seatsIn.push(...dealt.map((v) => v.seats.filter((s) => !s.out).length));
      }

      expect(views.length).toBeGreaterThan(0);
      // The two shapes the rule has, and that the marker leaves a busted seat
      // alone rather than counting it round.
      expect(seatsIn.some((n) => n === 3), 'a hand dealt three-handed').toBe(true);
      expect(seatsIn.some((n) => n === 2), 'a hand dealt with a seat out').toBe(true);
      expect(views.some((v) => v.seats.some((s) => s.out && s.blind === undefined)), 'a busted seat, unmarked').toBe(true);
    },
    120_000,
  );
});
