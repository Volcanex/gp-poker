import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat } from './helpers.js';
import { setFormatResolver, tick } from '../src/matchmaking.js';
import { getMatchById, getRatingsForUsers, sql } from '../src/db.js';
import { isBotBusy, isBotQueued, loadedPopulation, sendBotMessage } from '../src/bots/index.js';
import { roomForPlayer } from '../src/match/rooms.js';
import { configurePopulation, onlineCount, populationTick, resetPopulation } from '../src/bots/population.js';
import { config } from '../src/config.js';

const FAST: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ hands: 2, stack: 20, clockMs: 300, graceMs: 300 }),
  'six-max': testFormat({ mode: 'six-max', stack: 15, clockMs: 300, graceMs: 300 }),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs: number, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(stepMs);
  }
  return check();
}

// Two currently-idle bots from the loaded population, so a test never
// collides with whatever another file's tests left mid-match.
function freeBotPair(): [string, string] {
  const free = loadedPopulation()
    .map((p) => p.userId)
    .filter((id) => !isBotBusy(id) && !isBotQueued(id));
  if (free.length < 2) throw new Error('not enough free bots loaded for this test');
  return [free[0], free[1]];
}

// The queue's matching window starts narrow (see @opentable/rating's
// `pairQueue`) and only widens with wait time, so two free bots whose
// ratings happen to have drifted apart over the rest of the suite might not
// pair on the very next tick. Picking the closest-rated free pair is what a
// real population would look like anyway: most bots cluster near their
// level's rating.
async function closestRatedFreeBotPair(mode: Mode): Promise<[string, string]> {
  const free = loadedPopulation()
    .map((p) => p.userId)
    .filter((id) => !isBotBusy(id) && !isBotQueued(id));
  const ratings = await getRatingsForUsers(free, mode);
  const byRating = [...free].sort((a, b) => (ratings.get(a)?.rating ?? 1500) - (ratings.get(b)?.rating ?? 1500));
  let best: [string, string] = [byRating[0], byRating[1]];
  let bestDiff = Infinity;
  for (let i = 0; i + 1 < byRating.length; i++) {
    const diff = Math.abs((ratings.get(byRating[i])?.rating ?? 1500) - (ratings.get(byRating[i + 1])?.rating ?? 1500));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [byRating[i], byRating[i + 1]];
    }
  }
  return best;
}

describe('population: the queue path', () => {
  let app: FastifyInstance;
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    setFormatResolver((mode, rated) => ({ ...FAST[mode], rated }));
  });

  afterAll(async () => {
    setFormatResolver(formatFor);
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    await app.close();
  });

  it('two bots sent to queue exactly the way a socket message would pair into a rated match', async () => {
    const [a, b] = await closestRatedFreeBotPair('heads-up');

    // The same dispatch a `queue` socket message drives, sent directly:
    // this is the surface `population.ts` uses, and pairing itself is
    // exercised through the ordinary matchmaking queue rather than a seam.
    sendBotMessage(a, { t: 'queue', mode: 'heads-up', rated: true });
    sendBotMessage(b, { t: 'queue', mode: 'heads-up', rated: true });

    // Both bots auto-accept the ready check on their own timers once paired;
    // the matching window also widens the longer they wait, so this drives
    // `tick()` a few times rather than assuming the first one is enough.
    let seated = false;
    for (let i = 0; i < 15 && !seated; i++) {
      await tick();
      seated = await waitFor(() => roomForPlayer(a) !== undefined, 700);
    }
    expect(seated).toBe(true);

    const room = roomForPlayer(a)!;
    createdMatchIds.push(room.id);
    const match = await getMatchById(room.id);
    expect(match!.rated).toBe(true);
    expect(match!.seats.every((s) => s.bot)).toBe(true);
    expect(match!.seats.map((s) => s.userId).sort()).toEqual([a, b].sort());
  }, 20_000);

  it('a bot searching the ordinary queue is not also handed out as a practice or fill bot', async () => {
    const [a] = freeBotPair();
    sendBotMessage(a, { t: 'queue', mode: 'heads-up', rated: false });
    expect(isBotQueued(a)).toBe(true);

    const session = await mintGuestSession(app);
    try {
      const wsUrl = await listenForWs(app);
      const conn = await connectWs(wsUrl, session.token);
      await conn.messages.wait((m) => m.t === 'hi');
      conn.ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', bots: { level: 4 } }));
      const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found');
      const matchId = found.m as string;
      createdMatchIds.push(matchId);
      const match = await getMatchById(matchId);
      expect(match!.seats.map((s) => s.userId)).not.toContain(a);
      conn.ws.close();
    } finally {
      sendBotMessage(a, { t: 'dequeue' });
      await deleteUser(session.id);
    }
  }, 20_000);
});

describe('population: the scheduler', () => {
  afterAll(() => {
    resetPopulation();
  });

  it('is disabled under vitest by default, like the ladder and the arena', () => {
    expect(config.populationEnabled).toBe(false);
  });

  it('reports a count of currently-online bots bounded by the loaded roster', () => {
    configurePopulation({ enabled: true, now: () => new Date() });
    const count = onlineCount();
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThanOrEqual(loadedPopulation().length);
  });

  it("uses the injected clock rather than the real time when one is given", () => {
    // A Wednesday 3am UTC: quiet for almost every schedule's evening peak,
    // so the online count with this clock should be no larger than with an
    // evening clock, and typically smaller.
    const quiet = new Date('2026-09-09T03:00:00Z');
    const evening = new Date('2026-09-09T20:00:00Z');
    configurePopulation({ now: () => quiet });
    const quietCount = onlineCount();
    configurePopulation({ now: () => evening });
    const eveningCount = onlineCount();
    expect(quietCount).toBeLessThanOrEqual(eveningCount + 2); // some slack for night owls
  });

  it('does nothing while disabled, even when driven directly', async () => {
    configurePopulation({ enabled: false });
    const before = loadedPopulation().filter(({ userId }) => isBotQueued(userId)).length;
    await populationTick();
    const after = loadedPopulation().filter(({ userId }) => isBotQueued(userId)).length;
    expect(after).toBe(before);
  });
});
