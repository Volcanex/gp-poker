import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BOT_LEVELS, formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat } from './helpers.js';
import { createMatchForPlayers, setFormatResolver } from '../src/matchmaking.js';
import { getMatchById, sql, type UserRow } from '../src/db.js';

/* Practice mode: a table of bots on demand, at a level the player picks,
   never rated. Nothing here waits on the matchmaking tick, because practice
   does not use the queue at all. */

const FAST: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ hands: 2, stack: 20, clockMs: 1000, graceMs: 1000 }),
  'six-max': testFormat({ mode: 'six-max', stack: 12, clockMs: 800, graceMs: 800 }),
};

function botsAtLevel(level: number): Promise<UserRow[]> {
  return sql<UserRow[]>`select * from users where bot = true and bot_level = ${level} order by name_lower asc`;
}

describe('practice against bots', () => {
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

  it('gives every bot in the roster a level', async () => {
    const rows = await sql<{ botLevel: number | null; n: string }[]>`
      select bot_level, count(*)::text as n from users where bot = true group by bot_level order by bot_level
    `;
    for (const row of rows) expect(row.botLevel).not.toBeNull();
    // Read off the protocol rather than written down, so adding a level is a
    // roster change and not a test failure.
    expect(rows.length).toBe(BOT_LEVELS.length);
  });

  it('seats a six-max practice table immediately, unrated, with five bots', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    const conn = await connectWs(wsUrl, session.token);
    await conn.messages.wait((m) => m.t === 'hi');

    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'six-max', bots: { level: 2 } }));
    // No tick: practice does not queue, so the match exists by the time the
    // server has read the message.
    const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found');
    createdMatchIds.push(found.m);

    const match = await getMatchById(found.m);
    expect(match!.seats.length).toBe(6);
    expect(match!.seats.filter((s) => s.bot).length).toBe(5);
    expect(match!.format.practice).toBe(true);
    expect(match!.format.rated).toBe(false);
    expect(match!.rated).toBe(false);

    conn.ws.close();
  });

  it('falls back to the nearest level when the asked-for one is busy', async () => {
    const level3 = await botsAtLevel(3);
    expect(level3.length).toBeGreaterThanOrEqual(2);

    // Sit every level 3 bot in a live match, which is what "busy" means to
    // availableBotsAtLevel.
    const busy = await createMatchForPlayers(
      level3.map((b) => b.id),
      testFormat({ mode: 'six-max', players: level3.length, stack: 200, clockMs: 20_000, graceMs: 20_000 })
    );
    createdMatchIds.push(busy);

    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    const conn = await connectWs(wsUrl, session.token);
    await conn.messages.wait((m) => m.t === 'hi');

    conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', bots: { level: 3 } }));
    const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found');
    createdMatchIds.push(found.m);

    const match = await getMatchById(found.m);
    const botSeat = match!.seats.find((s) => s.bot)!;
    const [row] = await sql<UserRow[]>`select * from users where id = ${botSeat.userId}`;
    expect([2, 4]).toContain(row.botLevel);

    conn.ws.close();
  }, 30_000);

  it('lists the roster with its levels on /api/bots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { name: string; level: number; description: string; ratings: Record<string, unknown> }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.level)).toEqual([...rows.map((r) => r.level)].sort((a, b) => a - b));
    expect(rows[0].description).toContain('Level ');
    expect(rows[0].ratings['heads-up']).toBeDefined();
  });
});
