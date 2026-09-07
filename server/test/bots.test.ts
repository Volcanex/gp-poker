import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import {
  makeApp,
  mintGuestSession,
  deleteUser,
  listenForWs,
  connectWs,
  driveRandomPlay,
  testFormat,
} from './helpers.js';
import { setFormatResolver, tick } from '../src/matchmaking.js';
import { getHandsForMatch, getMatchById, sql } from '../src/db.js';

// The queue path builds its own format, so the test replaces the resolver
// rather than passing one in: small stacks and a short clock, which also
// caps how long a bot is allowed to think.
const FAST: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ hands: 5, stack: 20, clockMs: 1200, graceMs: 1200 }),
  'six-max': testFormat({ mode: 'six-max', stack: 15, clockMs: 800, graceMs: 800 }),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('bots', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
    setFormatResolver((mode, rated) => ({ ...FAST[mode], rated }));
  });

  afterAll(async () => {
    setFormatResolver(formatFor);
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it(
    'pairs a lone human with a bot heads-up and plays the match out',
    async () => {
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectWs(wsUrl, session.token);
      await conn.messages.wait((m) => m.t === 'hi');

      conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: true }));
      const searching = await conn.messages.wait((m) => m.t === 'q' && m.s === 'searching');
      expect(searching.mode).toBe('heads-up');
      expect(searching.rated).toBe(true);

      // Too soon: a human might still turn up.
      await tick();
      await sleep(5_100);
      await tick();

      const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found');
      const matchId = found.m as string;
      createdMatchIds.push(matchId);

      const match = await getMatchById(matchId);
      expect(match!.seats.length).toBe(2);
      const botSeat = match!.seats.find((s) => s.bot);
      expect(botSeat).toBeDefined();
      expect(botSeat!.name.startsWith('bot-')).toBe(true);

      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      const first = await conn.messages.wait((m) => m.t === 'state');
      const botView = first.s.seats.find((s: any) => s.i === botSeat!.seat);
      expect(botView.bot).toBe(true);
      expect(botView.connected).toBe(true);

      const result = await driveRandomPlay(conn, 60_000);
      expect(['bust', 'hands']).toContain(result.reason);
      expect(Object.keys(result.places).length).toBe(2);

      // A bot decides on a timer it sets itself and never lets the clock
      // run out, so nothing it did was applied by the clock.
      const hands = await getHandsForMatch(matchId);
      expect(hands.length).toBeGreaterThan(0);
      const rows = await sql<{ actions: { s: number; to?: boolean }[] }[]>`
        select actions from hands where match_id = ${matchId}
      `;
      for (const row of rows) {
        for (const action of row.actions) {
          if (action.s === botSeat!.seat) expect(action.to).toBeUndefined();
        }
      }

      conn.ws.close();
    },
    120_000
  );

  it(
    'fills a six-max table with bots around one human and runs it to a winner',
    async () => {
      const session = await mintGuestSession(app);
      createdUserIds.push(session.id);
      const conn = await connectWs(wsUrl, session.token);
      await conn.messages.wait((m) => m.t === 'hi');

      conn.ws.send(JSON.stringify({ t: 'queue', mode: 'six-max', rated: true }));
      const searching = await conn.messages.wait((m) => m.t === 'q' && m.s === 'searching');
      expect(searching.mode).toBe('six-max');
      expect(searching.seated).toBe(1);

      await tick();
      await sleep(20_100);
      await tick();

      const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found');
      const matchId = found.m as string;
      createdMatchIds.push(matchId);

      const match = await getMatchById(matchId);
      expect(match!.seats.length).toBe(6);
      expect(match!.seats.filter((s) => s.bot).length).toBe(5);
      expect(match!.seats.filter((s) => s.userId === session.id).length).toBe(1);

      conn.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      const result = await driveRandomPlay(conn, 120_000);

      expect(Object.keys(result.places).length).toBe(6);
      expect([...Object.values(result.places)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(result.stacks[result.winner!]).toBe(FAST['six-max'].stack * 6);

      conn.ws.close();
    },
    240_000
  );
});
