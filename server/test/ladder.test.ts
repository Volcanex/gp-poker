import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, Mode } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, testFormat } from './helpers.js';
import { configureLadder, currentLadderMatch, ladderTick, resetLadder } from '../src/ladder.js';
import { dequeue, enqueue } from '../src/matchmaking.js';
import { availableBots, availableBotsAtLevel } from '../src/bots/index.js';
import { getMatchById, getRating, sql, type MatchRow } from '../src/db.js';

/* The bot ladder: bots playing bots, rated, in the background, so the levels
   spread out before a human ever arrives.

   Nothing here waits on the scheduler's interval. `ladderTick` is the same
   seam `tick` is in matchmaking: one pass, driven by the test, so "only one
   at a time" is an assertion rather than a race. The format seam gives it a
   300 ms clock and two hands, because what is under test is the scheduler,
   not how long twenty-five hands take. */

const FAST = (mode: Mode): MatchFormat =>
  testFormat({ mode, hands: 2, stack: 20, clockMs: 300, graceMs: 300, holdMs: 50, ladder: true });

async function waitForFinish(matchId: string, timeoutMs = 30_000): Promise<MatchRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = await getMatchById(matchId);
    if (match && match.status !== 'playing') return match;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`ladder match ${matchId} did not finish`);
}

// Drives the scheduler until it has a match in flight, so a test does not
// depend on the first tick being the one that seats a table.
async function startOne(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    await ladderTick();
    const id = currentLadderMatch();
    if (id) return id;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('the ladder never started a match');
}

describe('the bot ladder', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    // Enabled explicitly: the ladder is off under vitest by default, so no
    // suite plays poker in the background without asking for it.
    configureLadder({ enabled: true, pauseMs: 20, format: FAST });
  });

  afterAll(async () => {
    resetLadder();
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('plays a rated bot-only match and moves both ratings', async () => {
    const matchId = await startOne();
    createdMatchIds.push(matchId);

    const playing = (await getMatchById(matchId))!;
    expect(playing.seats.length).toBe(2);
    expect(playing.seats.every((s) => s.bot)).toBe(true);
    expect(playing.format.ladder).toBe(true);
    expect(playing.format.rated).toBe(true);
    expect(playing.rated).toBe(true);

    const before = new Map<string, number>();
    for (const seat of playing.seats) {
      before.set(seat.userId, (await getRating(seat.userId, 'heads-up')).matches);
    }

    const finished = await waitForFinish(matchId);
    expect(finished.status).toBe('finished');
    expect(finished.ratings).not.toBeNull();

    for (const seat of finished.seats) {
      const change = finished.ratings![seat.userId];
      expect(change).toBeDefined();
      expect(change.after).not.toBe(change.before);
      const after = await getRating(seat.userId, 'heads-up');
      expect(after.matches).toBe(before.get(seat.userId)! + 1);
    }
  }, 60_000);

  it('runs one match at a time and holds a pause between them', async () => {
    const matchId = await startOne();
    createdMatchIds.push(matchId);

    // A second pass while the first is live must not seat anything.
    await ladderTick();
    expect(currentLadderMatch()).toBe(matchId);
    const live = await sql<{ n: number }[]>`
      select count(*)::int as n from matches
      where status = 'playing' and format->>'ladder' = 'true'
    `;
    expect(live[0].n).toBe(1);

    // Its seats are busy as far as every other seat-filling path is
    // concerned, so a human practising cannot be handed a bot mid-ladder.
    const seated = (await getMatchById(matchId))!.seats.map((s) => s.userId);
    const free = await availableBots(1500, 15, 'heads-up');
    for (const id of seated) expect(free.map((u) => u.id)).not.toContain(id);
    const practice = await availableBotsAtLevel(3, 15);
    for (const id of seated) expect(practice.map((u) => u.id)).not.toContain(id);

    await waitForFinish(matchId);
    // The tick that notices the match ended clears it and starts the pause;
    // it does not seat the next one in the same pass.
    await ladderTick();
    expect(currentLadderMatch()).toBeNull();
    await ladderTick();
    expect(currentLadderMatch()).toBeNull();
  }, 60_000);

  it('does not start a match while a human is queued', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    await enqueue(session.id, 'heads-up', true);

    for (let i = 0; i < 5; i++) await ladderTick();
    expect(currentLadderMatch()).toBeNull();

    dequeue(session.id);
    const matchId = await startOne();
    createdMatchIds.push(matchId);
    await waitForFinish(matchId);
    await ladderTick();
  }, 60_000);

  it('keeps ladder matches out of the live list and the feed', async () => {
    const matchId = await startOne();
    createdMatchIds.push(matchId);

    const live = await app.inject({ method: 'GET', url: '/api/live' });
    expect(live.json().map((m: { id: string }) => m.id)).not.toContain(matchId);

    await waitForFinish(matchId);

    const recent = await app.inject({ method: 'GET', url: '/api/recent?limit=50' });
    expect(recent.json().map((m: { id: string }) => m.id)).not.toContain(matchId);

    const withLadder = await app.inject({ method: 'GET', url: '/api/recent?limit=50&ladder=1' });
    expect(withLadder.json().map((m: { id: string }) => m.id)).toContain(matchId);

    await ladderTick();
  }, 60_000);

  it('reports each bot ladder match count on /api/bots', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots' });
    const rows = res.json() as { ladderMatches: number }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(typeof row.ladderMatches).toBe('number');
    expect(rows.some((r) => r.ladderMatches > 0)).toBe(true);
  });
});

/* The long proof: consecutive ladder matches at the real bot levels, run
   until the levels have separated. Skipped by default because it plays real
   poker for minutes; `LADDER_PROOF=1` runs it, and `LADDER_PROOF_MATCHES`
   sets how many.

   **Five matches is not a measurement.** It is enough to see the scheduler
   work end to end, and it is what this defaults to, but five matches across
   fifteen accounts leaves most bots on 1500 and one lucky level 1 is the
   whole sample: five gave 1500/1500/-/1446/1662 (level 3 never played), which
   passes the assertion by accident. Forty is where the ladder's own signal
   appears, measured on a clean database at a 1 s clock:

     level 1: 1328   level 2: 1292   level 3: 1558
     level 4: 1604   level 5: 1681

   Neighbours 1 and 2 are still inside the noise there, which is the same
   thing `bots/levels.test.ts` needs five hundred deals a pair to resolve. The
   ends are what this is for, and they are three hundred points apart.

   Run it against its own database (`TEST_DATABASE_URL` pointed somewhere
   else): any other boot of the app aborts every match still `playing`, and
   a suite running beside this one will abort the match it is in the middle
   of. */
describe.skipIf(!process.env.LADDER_PROOF)('ladder proof', () => {
  let app: FastifyInstance;
  const played: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    configureLadder({
      enabled: true,
      pauseMs: 20,
      format: (mode) => testFormat({ mode, clockMs: 1000, holdMs: 100, ladder: true }),
    });
  });

  afterAll(async () => {
    resetLadder();
    await app.close();
  });

  it('spreads the levels apart', async () => {
    const count = Number(process.env.LADDER_PROOF_MATCHES ?? 5);
    for (let i = 0; i < count; i++) {
      const id = await startOne();
      played.push(id);
      const finished = await waitForFinish(id, 600_000);
      const names = finished.seats.map((s) => s.name).join(' v ');
      console.log(`match ${i + 1}/${count} ${id} (${finished.format.mode}): ${names}`);
      await ladderTick();
    }

    const rows = await sql<{ botLevel: number; rating: number; matches: number; name: string }[]>`
      select u.name, u.bot_level, r.rating, r.matches
      from users u join ratings r on r.user_id = u.id and r.mode = 'heads-up'
      where u.bot = true
      order by u.bot_level, u.name
    `;
    const byLevel = new Map<number, number[]>();
    for (const r of rows) byLevel.set(r.botLevel, [...(byLevel.get(r.botLevel) ?? []), r.rating]);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const [level, ratings] of [...byLevel].sort((a, b) => a[0] - b[0])) {
      console.log(`level ${level}: ${Math.round(mean(ratings))} (${ratings.map(Math.round).join(', ')})`);
    }

    expect(mean(byLevel.get(5) ?? [1500])).toBeGreaterThan(mean(byLevel.get(1) ?? [1500]));
  }, 3_600_000);
});
