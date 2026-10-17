import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { formatFor } from '@opentable/protocol';
import { makeApp } from './helpers.js';
import { config } from '../src/config.js';
import { getSiteStats, sql } from '../src/db.js';
import { purgeBotOnlyHands, retentionCutoff } from '../src/retention.js';

/* Hand retention over real rows. Every fixture lives in the year 2000 and the
   purge is run with its clock set to 2001-01-01, so a 14-day cutoff falls on
   2000-12-18 and nothing another test file wrote with now() can qualify: the
   counts below are exact rather than "at least".

     botOld      bot-only, finished 2000-06-01, 3 hands   -> hands removed
     botAborted  bot-only, aborted 2000-06-01, 1 hand     -> hands removed
     mixedOld    a bot and a person, 2000-06-01, 2 hands  -> kept, a person sat there
     botRecent   bot-only, finished 2000-12-30, 2 hands   -> kept, inside the window
     botTourney  bot-only tournament match, 2000-06-01    -> kept, an event page
     botPlaying  bot-only, still 'playing', 2000-06-01    -> kept, not over */

const tag = randomBytes(4).toString('hex');
const NOW = new Date('2001-01-01T00:00:00Z');
const OLD = new Date('2000-06-01T00:00:00Z');
const RECENT = new Date('2000-12-30T00:00:00Z');
const id = (name: string) => `ret-${tag}-${name}`;

const ids = {
  botOld: id('bot-old'),
  botAborted: id('bot-aborted'),
  mixedOld: id('mixed-old'),
  botRecent: id('bot-recent'),
  botTourney: id('bot-tourney'),
  botPlaying: id('bot-playing'),
};

async function makeUser(name: string, bot: boolean): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into users (name, name_lower, guest, bot)
    values (${name}, ${name.toLowerCase()}, ${!bot}, ${bot})
    returning id
  `;
  return row.id;
}

async function makeMatch(
  matchId: string,
  players: { id: string; name: string }[],
  opts: { status: string; at: Date; hands: number; format?: Record<string, unknown> }
): Promise<void> {
  const seats = players.map((p, seat) => ({ seat, userId: p.id, name: p.name, rating: 1500 }));
  const format = { ...formatFor('heads-up', true), ...(opts.format ?? {}) };
  await sql`
    insert into matches (id, format, rated, seats, status, reason, hands_played, created_at, finished_at)
    values (
      ${matchId}, ${sql.json(format as never)}, true, ${sql.json(seats as never)},
      ${opts.status}, ${opts.status === 'playing' ? null : 'hands'}, ${opts.hands},
      ${opts.at}, ${opts.status === 'playing' ? null : opts.at}
    )
  `;
  for (const [seat, p] of players.entries()) {
    await sql`insert into match_players (match_id, user_id, seat) values (${matchId}, ${p.id}, ${seat})`;
  }
  for (let n = 1; n <= opts.hands; n++) {
    await sql`
      insert into hands (id, match_id, number, seed_hash, seed, button, stacks_start, live_seats,
                         actions, board, holes, result, started_at, completed_at)
      values (
        ${`${matchId}-${n}`}, ${matchId}, ${n},
        ${randomBytes(32).toString('hex')}, ${randomBytes(32).toString('hex')},
        0, ${sql.json([200, 200] as never)}, ${[0, 1]},
        ${sql.json([{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'f' }] as never)}, ${[]},
        ${sql.json({ 0: ['Ah', 'Kd'], 1: ['7c', '2d'] } as never)},
        ${sql.json({ pots: [], awards: [], shown: {} } as never)},
        ${opts.at}, ${opts.at}
      )
    `;
  }
}

async function handCount(matchId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from hands where match_id = ${matchId}`;
  return row.n;
}

describe('hand retention', () => {
  let app: FastifyInstance;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    const botA = { id: await makeUser(`RetBotA${tag}`, true), name: `RetBotA${tag}` };
    const botB = { id: await makeUser(`RetBotB${tag}`, true), name: `RetBotB${tag}` };
    const person = { id: await makeUser(`RetPerson${tag}`, false), name: `RetPerson${tag}` };
    userIds.push(botA.id, botB.id, person.id);

    await makeMatch(ids.botOld, [botA, botB], { status: 'finished', at: OLD, hands: 3 });
    await makeMatch(ids.botAborted, [botA, botB], { status: 'aborted', at: OLD, hands: 1 });
    await makeMatch(ids.mixedOld, [botA, person], { status: 'finished', at: OLD, hands: 2 });
    await makeMatch(ids.botRecent, [botA, botB], { status: 'finished', at: RECENT, hands: 2 });
    await makeMatch(ids.botTourney, [botA, botB], {
      status: 'finished',
      at: OLD,
      hands: 2,
      format: { tournament: { id: `t-${tag}`, table: 1 } },
    });
    await makeMatch(ids.botPlaying, [botA, botB], { status: 'playing', at: OLD, hands: 1 });
  });

  afterAll(async () => {
    await sql`delete from matches where id = any(${Object.values(ids)})`;
    await sql`delete from users where id = any(${userIds})`;
    await app.close();
  });

  it('refuses a window shorter than a day', () => {
    expect(() => retentionCutoff(0, NOW)).toThrow();
    expect(() => retentionCutoff(Number.NaN, NOW)).toThrow();
    expect(retentionCutoff(14, NOW).toISOString()).toBe('2000-12-18T00:00:00.000Z');
  });

  it('a dry run reports the bot-only old matches and deletes nothing', async () => {
    const r = await purgeBotOnlyHands(sql, { olderThanDays: 14, dryRun: true, now: NOW });
    expect(r).toMatchObject({ dryRun: true, matches: 2, hands: 4, batches: 0 });
    expect(r.rowBytes).toBeGreaterThan(0);
    expect(await handCount(ids.botOld)).toBe(3);
    expect(await handCount(ids.botAborted)).toBe(1);
  });

  it('a dry run works on a read-only connection, which refuses any write', async () => {
    const ro = postgres(config.databaseUrl, { max: 1, connection: { default_transaction_read_only: 'on' } });
    try {
      const r = await purgeBotOnlyHands(ro, { olderThanDays: 14, dryRun: true, now: NOW });
      expect(r).toMatchObject({ matches: 2, hands: 4 });
      await expect(ro`delete from hands where match_id = ${ids.botOld}`).rejects.toThrow(/read-only/);
    } finally {
      await ro.end();
    }
    expect(await handCount(ids.botOld)).toBe(3);
  });

  it('removes only the hands of old bot-only matches and keeps the match rows', async () => {
    const statsBefore = await getSiteStats();

    const r = await purgeBotOnlyHands(sql, { olderThanDays: 14, dryRun: false, now: NOW, batchMatches: 1, pauseMs: 0 });
    expect(r).toMatchObject({ dryRun: false, matches: 2, hands: 4, truncated: false });
    expect(r.batches).toBe(3); // two full batches of one match, then an empty one

    expect(await handCount(ids.botOld)).toBe(0);
    expect(await handCount(ids.botAborted)).toBe(0);
    expect(await handCount(ids.mixedOld)).toBe(2);
    expect(await handCount(ids.botRecent)).toBe(2);
    expect(await handCount(ids.botTourney)).toBe(2);
    expect(await handCount(ids.botPlaying)).toBe(1);

    const rows = await sql<{ id: string; handsPlayed: number; status: string }[]>`
      select id, hands_played, status from matches where id = any(${Object.values(ids)})
    `;
    expect(rows).toHaveLength(6);
    expect(rows.find((m) => m.id === ids.botOld)?.handsPlayed).toBe(3);
    const players = await sql`select 1 from match_players where match_id = ${ids.botOld}`;
    expect(players).toHaveLength(2);

    // The site's hands-played counter is read off the match rows, so a purge
    // does not make the number on the front page go down.
    const statsAfter = await getSiteStats();
    expect(statsAfter.handsTotal).toBe(statsBefore.handsTotal);
  });

  it('a second run finds nothing left to do', async () => {
    const dry = await purgeBotOnlyHands(sql, { olderThanDays: 14, dryRun: true, now: NOW });
    expect(dry).toMatchObject({ matches: 0, hands: 0, rowBytes: 0 });
    const r = await purgeBotOnlyHands(sql, { olderThanDays: 14, dryRun: false, now: NOW, pauseMs: 0 });
    expect(r).toMatchObject({ matches: 0, hands: 0, batches: 1 });
  });

  it('the match page says when a match had its hands expired', async () => {
    const gone = await app.inject({ method: 'GET', url: `/api/matches/${ids.botOld}` });
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toMatchObject({ handsPlayed: 3, hands: [], handsExpired: true });

    const kept = await app.inject({ method: 'GET', url: `/api/matches/${ids.mixedOld}` });
    expect(kept.json().handsExpired).toBe(false);
    expect(kept.json().hands).toHaveLength(2);

    const live = await app.inject({ method: 'GET', url: `/api/matches/${ids.botPlaying}` });
    expect(live.json().handsExpired).toBe(false);
  });
});
