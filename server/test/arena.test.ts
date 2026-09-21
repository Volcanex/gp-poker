import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { arenaPoints, type MatchFormat } from '@opentable/protocol';
import {
  acceptReady,
  connectSession,
  deleteUser,
  driveRandomPlay,
  listenForWs,
  makeApp,
  mintGuestSession,
  testFormat,
  type Connected,
  type Session,
} from './helpers.js';
import { resetReadyChecks } from '../src/ready.js';
import {
  arenaListing,
  arenaTick,
  arenaView,
  configureArena,
  periodStart,
  resetArena,
} from '../src/arena.js';
import { emitMatchFinished } from '../src/match/finished.js';
import { getArenaById, getArenaPlayers, getMatchById, getOpenArenas, sql, type ArenaRow } from '../src/db.js';

/* Arenas: an hourly heads-up event that pairs you again the moment your match
   ends.

   Nothing here waits on a real clock. `now` is a seam, the same shape the
   ladder's format seam is, so half an hour of arena passes in a few
   assignments; `arenaTick` is one pass, driven by the test, so "it paired
   them" is an assertion rather than a race. The format seam gives every match
   one hand on a 300 ms clock, because what is under test is the arena and not
   how long twenty-five hands take.

   The clock starts a long way in the future so the rows this file writes
   cannot collide with a previous run's, and every arena it opens is deleted
   afterwards. */

const HOUR = 60 * 60 * 1000;
const DURATION = 30 * 60 * 1000;
const LAST_PAIRING = 3 * 60 * 1000;

// Far enough ahead that no other suite's schedule reaches it, and randomised
// so two runs against the same database do not meet.
const BASE = periodStartAt(Date.now() + (5_000 + Math.floor(Math.random() * 5_000)) * HOUR);

function periodStartAt(at: number): number {
  return Math.floor(at / HOUR) * HOUR;
}

let clock = BASE;

const FAST = (arenaId: string): MatchFormat =>
  testFormat({ hands: 1, stack: 20, clockMs: 300, graceMs: 300, holdMs: 50, arena: arenaId });

async function waitForFinish(matchId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = await getMatchById(matchId);
    if (match && match.status !== 'playing') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`arena match ${matchId} did not finish`);
}

/* The board is written by the listener the match room announces to, which the
   room does not await: the match row says finished a moment before the score
   lands. Polling is what closes that gap without a sleep long enough to be a
   guess. */
async function waitForBoard(
  arenaId: string,
  ready: (rows: Awaited<ReturnType<typeof getArenaPlayers>>) => boolean,
  timeoutMs = 5_000
): Promise<Awaited<ReturnType<typeof getArenaPlayers>>> {
  const deadline = Date.now() + timeoutMs;
  let rows = await getArenaPlayers(arenaId);
  while (Date.now() < deadline) {
    if (ready(rows)) return rows;
    await new Promise((r) => setTimeout(r, 25));
    rows = await getArenaPlayers(arenaId);
  }
  return rows;
}

describe('arenas', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const open: Connected[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
    // Enabled explicitly: the arena is off under vitest by default, so no
    // suite pairs matches in the background without asking for it.
    configureArena({
      enabled: true,
      now: () => clock,
      format: FAST,
      everyMs: HOUR,
      durationMs: DURATION,
      botFillMs: 1_000,
      lastPairingBeforeEndMs: LAST_PAIRING,
    });
  });

  afterAll(async () => {
    for (const c of open) c.ws.close();
    resetArena();
    resetReadyChecks();
    await sql`delete from matches where id in (select match_id from match_players where user_id in ${sql(
      createdUserIds.length > 0 ? createdUserIds : ['00000000-0000-0000-0000-000000000000']
    )})`;
    await sql`delete from arenas where starts_at >= ${new Date(BASE)}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  /* Every arena player has already finished a casual match. An arena is rated
     heads-up, so it is behind the same gate the rated queue is, and a guest
     who has played nothing cannot join one. The row this writes is cleaned up
     by the same sweep as every other match these users played. */
  async function guest(): Promise<Session> {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    return session;
  }

  async function connected(): Promise<Connected> {
    const conn = await connectSession(wsUrl, await guest());
    open.push(conn);
    return conn;
  }

  function auth(session: Session) {
    return { cookie: `ot_session=${session.token}` };
  }

  /* Moves the clock on to the next hour and ticks, which closes whatever was
     running and opens the arena for the period the clock now sits in. Every
     test starts on its own arena that way, so one test's board can never be
     the next one's. */
  async function nextArena(): Promise<ArenaRow> {
    clock = periodStart(clock) + HOUR;
    await arenaTick();
    const running = (await getOpenArenas()).find(
      (a) => a.status === 'running' && a.startsAt.getTime() === clock
    );
    if (!running) throw new Error('no arena opened for this period');
    return running;
  }

  function join(session: Session, arenaId: string) {
    return app.inject({ method: 'POST', url: `/api/arenas/${arenaId}/join`, headers: auth(session) });
  }

  it('keeps a schedule ahead of itself and opens one on the hour', async () => {
    const arena = await nextArena();
    expect(arena.name).toBe('Hourly heads-up arena');
    expect(arena.endsAt.getTime() - arena.startsAt.getTime()).toBe(DURATION);

    // Three more waiting behind it, on the hour, every hour.
    const upcoming = (await getOpenArenas()).filter((a) => a.startsAt.getTime() > arena.startsAt.getTime());
    expect(upcoming.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i++) {
      expect(upcoming[i].startsAt.getTime()).toBe(arena.startsAt.getTime() + (i + 1) * HOUR);
      expect(upcoming[i].status).toBe('upcoming');
    }

    // A second pass creates nothing: starts_at is unique and the schedule is
    // already stocked.
    const before = (await getOpenArenas()).length;
    await arenaTick();
    expect((await getOpenArenas()).length).toBe(before);
  });

  it('puts a guest on the board and takes them off again', async () => {
    const arena = await nextArena();
    const session = await guest();

    expect((await join(session, arena.id)).statusCode).toBe(200);
    const joined = await arenaView(arena.id, session.id);
    expect(joined!.players).toBe(1);
    expect(joined!.you).not.toBeNull();
    expect(joined!.you!.score).toBe(0);
    expect(joined!.you!.rank).toBe(1);
    expect(joined!.standings.map((s) => s.uid)).toContain(session.id);

    const left = await app.inject({
      method: 'POST',
      url: `/api/arenas/${arena.id}/leave`,
      headers: auth(session),
    });
    expect(left.statusCode).toBe(200);
    expect((await arenaView(arena.id, session.id))!.you).toBeNull();
  });

  it('pairs two people with each other and scores the match on the board', async () => {
    const arena = await nextArena();
    const a = await connected();
    const b = await connected();
    await join(a, arena.id);
    await join(b, arena.id);

    await arenaTick();
    // An arena pairing is offered the same way a queued one is, on a shorter
    // window: nobody is dealt a table they have not said they are at.
    await Promise.all([acceptReady(a), acceptReady(b)]);
    const foundA = await a.messages.wait((m) => m.t === 'q' && m.s === 'found');
    const foundB = await b.messages.wait((m) => m.t === 'q' && m.s === 'found');
    expect(foundA.m).toBe(foundB.m);

    const match = (await getMatchById(foundA.m))!;
    expect(match.format.arena).toBe(arena.id);
    expect(match.format.rated).toBe(true);
    expect(match.seats.every((s) => !s.bot)).toBe(true);

    // While it is on, neither of them is paired again.
    await arenaTick();
    expect((await arenaView(arena.id, null))!.playing).toBe(1);

    a.ws.send(JSON.stringify({ t: 'join', m: foundA.m }));
    b.ws.send(JSON.stringify({ t: 'join', m: foundA.m }));
    await Promise.all([driveRandomPlay(a), driveRandomPlay(b)]);
    await waitForFinish(foundA.m);

    // Two points for the win, none for the loss, one match each either way.
    const rows = await waitForBoard(arena.id, (r) => r.every((row) => row.matches === 1));
    expect(rows.map((r) => r.matches)).toEqual([1, 1]);
    expect(rows.reduce((sum, r) => sum + r.wins + r.losses + r.draws, 0)).toBe(2);
    const scores = rows.map((r) => r.score).sort((x, y) => y - x);
    expect(scores[0] === 2 || (scores[0] === 1 && scores[1] === 1)).toBe(true);
  }, 60_000);

  it('brings a bot in for somebody with nobody to play', async () => {
    const arena = await nextArena();
    const lone = await connected();
    await join(lone, arena.id);

    // The first pass only starts the clock on the wait.
    await arenaTick();
    expect((await arenaView(arena.id, null))!.playing).toBe(0);

    clock += 2_000;
    await arenaTick();
    await acceptReady(lone);
    const found = await lone.messages.wait((m) => m.t === 'q' && m.s === 'found');
    const match = (await getMatchById(found.m))!;
    expect(match.format.arena).toBe(arena.id);
    expect(match.seats.filter((s) => s.bot)).toHaveLength(1);
    expect(match.seats.filter((s) => !s.bot)).toHaveLength(1);

    lone.ws.send(JSON.stringify({ t: 'join', m: found.m }));
    await driveRandomPlay(lone);
    await waitForFinish(found.m);

    // A bot opponent counts exactly like a person: one match on the board.
    const [row] = await waitForBoard(arena.id, (r) => r[0]?.matches === 1);
    expect(row.matches).toBe(1);
    expect(row.score).toBe(row.wins * 2);
  }, 60_000);

  it('does not pair a paused player', async () => {
    const arena = await nextArena();
    const a = await connected();
    const b = await connected();
    await join(a, arena.id);
    await join(b, arena.id);

    const paused = await app.inject({
      method: 'POST',
      url: `/api/arenas/${arena.id}/pause`,
      headers: auth(a),
      payload: { paused: true },
    });
    expect(paused.statusCode).toBe(200);

    // Neither of them is paired: one is paused and the other has nobody to
    // meet. Past the bot wait, only the player who is here gets a table.
    await arenaTick();
    clock += 2_000;
    await arenaTick();
    await acceptReady(b);
    const found = await b.messages.wait((m) => m.t === 'q' && m.s === 'found');
    const match = (await getMatchById(found.m))!;
    expect(match.seats.map((s) => s.userId)).not.toContain(a.id);

    b.ws.send(JSON.stringify({ t: 'join', m: found.m }));
    await driveRandomPlay(b);
    await waitForFinish(found.m);

    const rows = await waitForBoard(arena.id, (r) => r.some((row) => row.matches === 1));
    expect(rows.find((r) => r.userId === a.id)!.matches).toBe(0);
    expect(rows.find((r) => r.userId === b.id)!.matches).toBe(1);
  }, 60_000);

  /* Scoring is driven through the same announcement a match room makes, with
     a result written by hand: three wins in a row is not something random play
     can be asked for, and the room's own wiring to this announcement is what
     the two pairing tests above already prove. */
  it('pays a third win in a row three, and resets the run on a loss', async () => {
    const arena = await nextArena();
    const hero = await guest();
    const foil = await guest();
    await join(hero, arena.id);
    await join(foil, arena.id);

    const finish = (winner: string) =>
      emitMatchFinished({
        id: `arena-score-${Math.random().toString(36).slice(2, 10)}`,
        format: FAST(arena.id),
        playerIds: [hero.id, foil.id],
        winner,
        reason: 'hands',
        places: { [hero.id]: winner === hero.id ? 1 : 2, [foil.id]: winner === foil.id ? 1 : 2 },
      });

    const settled = async (matches: number) =>
      (await waitForBoard(arena.id, (r) => (r.find((x) => x.userId === hero.id)?.matches ?? 0) >= matches)).find(
        (r) => r.userId === hero.id
      )!;

    finish(hero.id);
    expect((await settled(1)).score).toBe(2);
    finish(hero.id);
    expect((await settled(2)).score).toBe(4);
    expect((await settled(2)).streak).toBe(2);

    // On fire: the third is worth three.
    finish(hero.id);
    expect((await settled(3)).score).toBe(7);
    expect((await settled(3)).streak).toBe(3);

    // A loss pays nothing and puts the run back to nought.
    finish(foil.id);
    const after = await settled(4);
    expect(after.score).toBe(7);
    expect(after.streak).toBe(0);
    expect(after.losses).toBe(1);
    expect(after.wins).toBe(3);

    // And the next win is worth two again.
    finish(hero.id);
    expect((await settled(5)).score).toBe(9);

    // The board reads highest first, and the loser is under the winner.
    const view = await arenaView(arena.id, hero.id);
    expect(view!.standings.map((s) => s.uid)).toEqual([hero.id, foil.id]);
    expect(view!.you!.rank).toBe(1);
    expect(view!.you!.score).toBe(9);
  });

  it('freezes the standings when the clock runs out', async () => {
    const arena = await nextArena();
    const hero = await guest();
    await join(hero, arena.id);

    emitMatchFinished({
      id: `arena-freeze-${Math.random().toString(36).slice(2, 10)}`,
      format: FAST(arena.id),
      playerIds: [hero.id],
      winner: hero.id,
      reason: 'hands',
      places: { [hero.id]: 1 },
    });
    await waitForBoard(arena.id, (r) => r[0]?.matches === 1);
    expect((await getArenaPlayers(arena.id))[0].score).toBe(2);

    // Past the end. The tick closes it, writes the places and the podium.
    clock = arena.endsAt.getTime() + 1;
    await arenaTick();
    const closed = (await getArenaById(arena.id))!;
    expect(closed.status).toBe('finished');
    expect(closed.podium).toEqual([{ uid: hero.id, avatarV: 0, name: hero.name, score: 2, place: 1 }]);
    expect((await getArenaPlayers(arena.id))[0].place).toBe(1);

    // Nothing scores after the freeze.
    emitMatchFinished({
      id: `arena-late-${Math.random().toString(36).slice(2, 10)}`,
      format: FAST(arena.id),
      playerIds: [hero.id],
      winner: hero.id,
      reason: 'hands',
      places: { [hero.id]: 1 },
    });
    await new Promise((r) => setTimeout(r, 60));
    expect((await getArenaPlayers(arena.id))[0].score).toBe(2);

    // A finished arena cannot be joined either.
    const late = await join(hero, arena.id);
    expect(late.statusCode).toBe(409);
  });

  it('stops pairing in the last three minutes but plays out what started', async () => {
    const arena = await nextArena();
    const a = await connected();
    const b = await connected();
    await join(a, arena.id);
    await join(b, arena.id);

    clock = arena.endsAt.getTime() - LAST_PAIRING + 1;
    await arenaTick();
    expect((await arenaView(arena.id, null))!.playing).toBe(0);
  });

  it('lists the arena to play next and the ones already played', async () => {
    const listing = await arenaListing(null);
    expect(listing.featured).not.toBeNull();
    expect(listing.featured!.status === 'running' || listing.featured!.status === 'upcoming').toBe(true);
    expect(listing.finished.length).toBeGreaterThan(0);
    expect(listing.finished.length).toBeLessThanOrEqual(3);
    for (const a of listing.finished) expect(a.status).toBe('finished');
  });

  it('lists a finished arena on the profile of everyone who played it', async () => {
    const arena = await nextArena();
    const hero = await guest();
    await join(hero, arena.id);
    clock = arena.endsAt.getTime() + 1;
    await arenaTick();

    const res = await app.inject({ method: 'GET', url: `/api/users/${encodeURIComponent(hero.name)}` });
    const arenas = res.json().arenas as { id: string; name: string; place: number; score: number }[];
    const mine = arenas.find((a) => a.id === arena.id);
    expect(mine).toBeDefined();
    expect(mine!.name).toBe('Hourly heads-up arena');
    expect(mine!.place).toBe(1);
    expect(mine!.score).toBe(0);
  });
});

describe('the arena scoring table', () => {
  it('pays two for a win, one for a draw and nothing for a loss', () => {
    expect(arenaPoints('win', 0)).toBe(2);
    expect(arenaPoints('win', 1)).toBe(2);
    expect(arenaPoints('draw', 0)).toBe(1);
    expect(arenaPoints('draw', 5)).toBe(1);
    expect(arenaPoints('loss', 5)).toBe(0);
  });

  it('pays three once two wins are already banked', () => {
    expect(arenaPoints('win', 2)).toBe(3);
    expect(arenaPoints('win', 9)).toBe(3);
  });
});
