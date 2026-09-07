import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { replay, seedHash, type HandConfig } from '@opentable/engine';
import { blindsAt, type MatchFormat, type MatchResult, type TableView } from '@opentable/protocol';
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
import { getHandById, getHandsForMatch, getMatchById, getRating, getRatingHistoryForUser, sql } from '../src/db.js';

// Six seats, six big blinds each and a fast clock: random play busts people
// within a handful of hands, and the escalating blind schedule guarantees an
// end even if it didn't.
const SIX_MAX: MatchFormat = testFormat({ mode: 'six-max', stack: 15, clockMs: 1200, graceMs: 1200 });

describe('a six-max match', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  let matchId: string | null = null;
  const createdMatchIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    if (matchId) await sql`delete from matches where id = ${matchId}`;
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it(
    'runs six players down to one, places them and rates them in one period',
    async () => {
      const sessions = [];
      for (let i = 0; i < 6; i++) sessions.push(await mintGuestSession(app));
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

      matchId = await createMatchForPlayers(
        sessions.map((s) => s.id),
        SIX_MAX
      );
      for (const conn of conns) conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const results = await Promise.all(conns.map((c) => driveRandomPlay(c, 30_000)));
      const result: MatchResult = results[0];
      for (const r of results) expect(r).toEqual(result);

      // One player holds every chip.
      const stacks = Object.values(result.stacks);
      expect(stacks.reduce((a, b) => a + b, 0)).toBe(SIX_MAX.stack * 6);
      expect(stacks.filter((s) => s > 0).length).toBe(1);
      expect(result.winner).not.toBeNull();
      expect(result.stacks[result.winner!]).toBe(SIX_MAX.stack * 6);

      // Places are a permutation of 1..6, and first place is the winner.
      const places = sessions.map((s) => result.places[s.id]);
      expect([...places].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(result.places[result.winner!]).toBe(1);

      const winner = sessions.find((s) => result.places[s.id] === 1)!;
      const last = sessions.find((s) => result.places[s.id] === 6)!;
      expect(result.ratings[winner.id].after).toBeGreaterThan(result.ratings[winner.id].before);
      expect(result.ratings[last.id].after).toBeLessThan(result.ratings[last.id].before);

      for (const s of sessions) {
        const history = await getRatingHistoryForUser(s.id);
        expect(history.length).toBe(1);
        expect(history[0].mode).toBe('six-max');

        // Ratings are per mode: this match moved the six-max row and left
        // the heads-up one untouched.
        const sixMax = await getRating(s.id, 'six-max');
        expect(sixMax.matches).toBe(1);
        expect(Math.round(sixMax.rating)).toBe(result.ratings[s.id].after);
        const headsUp = await getRating(s.id, 'heads-up');
        expect(headsUp.rating).toBe(1500);
        expect(headsUp.rd).toBe(350);
        expect(headsUp.matches).toBe(0);
      }

      const match = await getMatchById(matchId);
      expect(match!.status).toBe('finished');
      expect(match!.seats.length).toBe(6);
      expect(match!.places).toEqual(result.places);
      const seatPlaces = await sql<{ userId: string; place: number }[]>`
        select user_id, place from match_players where match_id = ${matchId}
      `;
      expect(seatPlaces.length).toBe(6);
      for (const row of seatPlaces) expect(row.place).toBe(result.places[row.userId]);

      // Every hand rehashes and replays through its stored seat mapping.
      const hands = await getHandsForMatch(matchId);
      expect(hands.length).toBe(match!.handsPlayed);
      expect(hands.every((h) => h.completedAt !== null)).toBe(true);

      for (let i = 0; i < hands.length; i++) {
        const h = hands[i];
        expect(seedHash(h.seed!)).toBe(h.seedHash);
        const live = h.liveSeats!;
        expect(live.length).toBeGreaterThanOrEqual(2);

        const full = await getHandById(`${matchId}-${h.number}`);
        const holes = full!.holes!;
        const { sb, bb } = blindsAt(match!.format, h.number);
        const config: HandConfig = {
          seats: live.map((tableSeat) => ({
            id: match!.seats[tableSeat].userId,
            stack: h.stacksStart[tableSeat],
          })),
          button: live.indexOf(full!.button),
          sb,
          bb,
          seed: h.seed!,
        };
        // The stored log is in table seats; live_seats is what turns it back
        // into the engine's numbering.
        const engineActions = full!.actions.map((a) => ({ ...a, s: live.indexOf(a.s) }));
        const states = replay(config, engineActions);
        const initial = states[0];
        const final = states[states.length - 1];

        expect(final.board).toEqual(h.board);
        live.forEach((tableSeat, engineSeat) => {
          expect(initial.seats[engineSeat].cards).toEqual(holes[tableSeat]);
        });

        const nextStacks =
          i + 1 < hands.length ? hands[i + 1].stacksStart : match!.seats.map((s) => result.stacks[s.userId]);
        live.forEach((tableSeat, engineSeat) => {
          expect(final.seats[engineSeat].stack).toBe(nextStacks[tableSeat]);
        });
      }

      // Six-max stores no preflop study or stats: the charts are heads-up only.
      const rawHands = await sql<{ stats: unknown; study: unknown }[]>`
        select stats, study from hands where match_id = ${matchId}
      `;
      for (const row of rawHands) {
        expect(row.stats).toBeNull();
        expect(row.study).toBeNull();
      }

      // Nobody ever saw anyone else's hole cards in a live frame.
      frames.forEach((mine, viewer) => {
        for (const frame of mine) {
          if (frame.t !== 'state' || frame.s.street === 'done') continue;
          const view: TableView = frame.s;
          for (const seat of view.seats) {
            if (seat.i === viewer) continue;
            expect(seat.cards === null || seat.cards.every((c) => c === '?')).toBe(true);
          }
        }
      });

      for (const conn of conns) conn.ws.close();
    },
    180_000
  );

  it(
    'sits a player out after three timeouts instead of forfeiting the table',
    async () => {
      // Three seats is enough to prove the rule: heads-up would forfeit here.
      const format = testFormat({ mode: 'six-max', players: 3, stack: 20, clockMs: 250, graceMs: 250 });
      const sessions = [];
      for (let i = 0; i < 3; i++) sessions.push(await mintGuestSession(app));
      createdUserIds.push(...sessions.map((s) => s.id));

      const conns = [];
      for (const s of sessions) {
        const conn = await connectWs(wsUrl, s.token);
        await conn.messages.wait((m) => m.t === 'hi');
        conns.push(conn);
      }

      const id = await createMatchForPlayers(
        sessions.map((s) => s.id),
        format
      );
      createdMatchIds.push(id);
      for (const conn of conns) conn.ws.send(JSON.stringify({ t: 'join', m: id }));

      // Seat 0 never answers. The other two only ever check or call, so the
      // only chips that move are blinds until seat 0 is blinded out.
      const drivePassive = async (conn: (typeof conns)[number]) => {
        for (let step = 0; step < 4000; step++) {
          const msg = await conn.messages.wait((m) => (m.t === 'state' && m.s.legal !== null) || m.t === 'end', 60_000);
          if (msg.t === 'end') return msg.r as MatchResult;
          const view = msg.s as TableView;
          const a = view.legal!.actions.includes('x') ? 'x' : 'c';
          conn.ws.send(JSON.stringify({ t: 'act', m: view.m, h: view.h, n: view.n, a }));
        }
        throw new Error('too many steps without reaching end');
      };
      const silent = conns[0].messages.wait((m) => m.t === 'end', 180_000);
      const [result] = await Promise.all([drivePassive(conns[1]), drivePassive(conns[2]), silent]);

      // Not 'forfeit': the table played on and someone won all the chips.
      expect(result.reason).toBe('bust');
      expect([...Object.values(result.places)].sort((a, b) => a - b)).toEqual([1, 2, 3]);

      const timedOut = await sql<{ actions: { s: number; to?: boolean }[] }[]>`
        select actions from hands where match_id = ${id}
      `;
      // More than three forced actions means seat 0 kept being dealt in and
      // acted on after the third timeout rather than losing the match there.
      const forced = timedOut.flatMap((r) => r.actions).filter((a) => a.s === 0 && a.to);
      expect(forced.length).toBeGreaterThan(3);

      for (const conn of conns) conn.ws.close();
    },
    240_000
  );
});
