import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TOURNAMENT_MIN_FIELD, type MatchFormat, type Mode, type TournamentRef } from '@opentable/protocol';
import {
  connectSession,
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
import { resetReadyChecks } from '../src/ready.js';
import { emitMatchFinished } from '../src/match/finished.js';
import {
  configureTournaments,
  defaultTournamentFormat,
  registerForTournament,
  resetTournaments,
  tournamentListing,
  tournamentTick,
  tournamentView,
} from '../src/tournaments/index.js';
import {
  DAILY_SLOT_HOURS,
  FIXTURES,
  dailySlotHour,
  fixtureFor,
  nextStartAfter,
  type TournamentFixture,
} from '../src/tournaments/fixtures.js';
import {
  advanceCount,
  bracketFirstRound,
  bracketRounds,
  bracketSize,
  bracketSlots,
  placeForRound,
  shootoutTables,
  snakeSeats,
} from '../src/tournaments/draw.js';
import {
  getMatchById,
  getOpenTournaments,
  getTournamentById,
  getTournamentPlayers,
  getTournamentTables,
  getUpcomingTournament,
  sql,
} from '../src/db.js';

/* Tournaments: a field that funnels up to a final.

   Nothing here waits on a real clock. `now` is a seam, the fixture calendar is
   a seam so a test runs one fixture rather than three, the match format is the
   same seam the arena's is, and the ready window is one too, so a walkover is
   proved by a decline rather than by sitting out twenty seconds.

   The clock starts a long way in the future and jumps a randomised distance
   between tests, so no two runs against the same database meet on a calendar
   whose start times are fixed. */

const HOUR = 60 * 60 * 1000;

let clock = 0;
const bases: number[] = [];

// A fresh stretch of calendar for one test. Randomised so two runs against the
// same database do not collide on `(kind, starts_at)`, which is unique.
function freshBase(): number {
  clock = Date.now() + (20_000 + Math.floor(Math.random() * 200_000)) * HOUR;
  bases.push(clock);
  return clock;
}

const BRACKET_ONLY: TournamentFixture = { ...(fixtureFor('daily-bracket') as TournamentFixture) };
const SHOOTOUT_ONLY: TournamentFixture = { ...(fixtureFor('sunday-shootout') as TournamentFixture) };

/* A tournament match on a short clock and a small stack: what is under test is
   the funnel, not how long twenty-five hands take. */
const FAST = (mode: Mode, rated: boolean, seats: number, ref: TournamentRef): MatchFormat =>
  testFormat({
    mode,
    rated,
    players: seats,
    ...(mode === 'heads-up' ? { hands: 1 } : {}),
    stack: 15,
    clockMs: 400,
    graceMs: 400,
    holdMs: 50,
    tournament: ref,
  });

const READY_MS = 8_000;

describe('the fixture calendar', () => {
  it('rotates the daily bracket through three slots, one a day', () => {
    expect(DAILY_SLOT_HOURS).toEqual([20, 2, 11]);
    for (let day = 0; day < 9; day++) {
      expect(dailySlotHour(day)).toBe(DAILY_SLOT_HOURS[day % 3]);
    }

    // Walked forward, the schedule is one fixture a day, strictly increasing,
    // and it visits all three slots inside any three consecutive days.
    let at = Date.UTC(2026, 8, 9, 0, 0, 0);
    const hours: number[] = [];
    const days: number[] = [];
    for (let i = 0; i < 9; i++) {
      const next = nextStartAfter('daily-bracket', at);
      expect(next).toBeGreaterThan(at);
      const d = new Date(next);
      hours.push(d.getUTCHours());
      days.push(Math.floor(next / (24 * HOUR)));
      expect(d.getUTCMinutes()).toBe(0);
      at = next;
    }
    for (let i = 1; i < days.length; i++) expect(days[i]).toBe(days[i - 1] + 1);
    for (const h of hours) expect(DAILY_SLOT_HOURS).toContain(h);
    expect(new Set(hours.slice(0, 3)).size).toBe(3);
  });

  it('puts the championship on the first Sunday and the shootout on the others', () => {
    let at = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let i = 0; i < 15; i++) {
      const next = nextStartAfter('monthly-championship', at);
      const d = new Date(next);
      expect(d.getUTCDay()).toBe(0);
      expect(d.getUTCDate()).toBeLessThanOrEqual(7);
      expect(d.getUTCHours()).toBe(18);
      at = next;
    }

    at = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const next = nextStartAfter('sunday-shootout', at);
      const d = new Date(next);
      expect(d.getUTCDay()).toBe(0);
      expect(d.getUTCDate()).toBeGreaterThan(7);
      expect(d.getUTCHours()).toBe(18);
      at = next;
    }
  });

  it('never puts the two Sunday fixtures on the same day', () => {
    let at = Date.UTC(2026, 0, 1, 0, 0, 0);
    const shootouts = new Set<number>();
    for (let i = 0; i < 30; i++) {
      at = nextStartAfter('sunday-shootout', at);
      shootouts.add(at);
    }
    at = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      at = nextStartAfter('monthly-championship', at);
      expect(shootouts.has(at)).toBe(false);
    }
  });

  it('is three fixtures and every one of them names itself', () => {
    expect(FIXTURES).toHaveLength(3);
    for (const f of FIXTURES) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.blurb.length).toBeGreaterThan(0);
      expect(f.seats).toBeGreaterThanOrEqual(TOURNAMENT_MIN_FIELD[f.shape]);
      expect(f.botFloor).toBeLessThanOrEqual(f.seats);
      expect(fixtureFor(f.kind)).not.toBeNull();
    }
    expect(fixtureFor('nothing-like-this')).toBeNull();
  });
});

describe('the draw', () => {
  it('rounds a bracket up to a power of two', () => {
    expect(bracketSize(4)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(32)).toBe(32);
    expect(bracketSize(33)).toBe(64);
    expect(bracketRounds(5)).toBe(3);
    expect(bracketRounds(32)).toBe(5);
  });

  it('seeds a bracket so the top two can only meet in the final', () => {
    expect(bracketSlots(2)).toEqual([1, 2]);
    expect(bracketSlots(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    // Every pair of slots adds to size + 1, which is what 1 v N, 2 v N-1 means.
    const slots = bracketSlots(16);
    for (let i = 0; i < slots.length; i += 2) expect(slots[i] + slots[i + 1]).toBe(17);
  });

  it('gives the byes to the top seeds', () => {
    const round = bracketFirstRound(5);
    expect(round).toHaveLength(4);
    // Three byes, one match, and the byes belong to seeds 1, 2 and 3.
    const byes = round.filter((t) => t.length === 1).map((t) => t[0]).sort((a, b) => a - b);
    expect(byes).toEqual([1, 2, 3]);
    expect(round.find((t) => t.length === 2)).toEqual([4, 5]);

    // A power of two has none of them.
    expect(bracketFirstRound(8).every((t) => t.length === 2)).toBe(true);
  });

  it('balances shootout tables and never seats fewer than three', () => {
    expect(shootoutTables(13)).toEqual([5, 4, 4]);
    expect(shootoutTables(36)).toEqual([6, 6, 6, 6, 6, 6]);
    expect(shootoutTables(7)).toEqual([4, 3]);
    expect(shootoutTables(6)).toEqual([6]);
    for (let field = 7; field <= 216; field++) {
      const sizes = shootoutTables(field);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(field);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(6);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('snakes the seeds across the tables', () => {
    const tables = snakeSeats([1, 2, 3, 4, 5, 6, 7, 8, 9], [3, 3, 3]);
    expect(tables).toEqual([
      [1, 6, 7],
      [2, 5, 8],
      [3, 4, 9],
    ]);
    // Uneven sizes still balance, and every seed is placed exactly once.
    const uneven = snakeSeats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [5, 4, 4]);
    expect(uneven.map((t) => t.length)).toEqual([5, 4, 4]);
    expect(uneven.flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(uneven[0][0]).toBe(1);
    expect(uneven[1][0]).toBe(2);
    expect(uneven[2][0]).toBe(3);
  });

  it('advances three from two tables and two from any more', () => {
    expect(advanceCount(1)).toBe(0);
    expect(advanceCount(2)).toBe(3);
    expect(advanceCount(3)).toBe(2);
    expect(advanceCount(6)).toBe(2);
    // Two tables send six, which is a six-handed final. Three would send nine.
    expect(advanceCount(2) * 2).toBe(6);
    expect(advanceCount(3) * 3).toBe(6);
  });

  it('plays every tournament match fast, at the table\'s own seat count', () => {
    const ref = { id: 'abc', round: 2, table: 1 };
    const heads = defaultTournamentFormat('heads-up', true, 2, ref);
    expect(heads.speed).toBe('fast');
    expect(heads.players).toBe(2);
    expect(heads.rated).toBe(true);
    expect(heads.tournament).toEqual(ref);

    // A balanced shootout table is often four or five rather than six, and a
    // table with one person at it is casual, the home game's rule.
    const four = defaultTournamentFormat('six-max', false, 4, ref);
    expect(four.speed).toBe('fast');
    expect(four.players).toBe(4);
    expect(four.rated).toBe(false);
  });

  it('places a round by how many were still in after it', () => {
    expect(placeForRound(4)).toBe(5);
    expect(placeForRound(2)).toBe(3);
    expect(placeForRound(6)).toBe(7);
  });
});

describe('tournaments', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const open: Connected[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
    configureTournaments({
      enabled: true,
      now: () => clock,
      format: FAST,
      readyMs: READY_MS,
      fixtures: [BRACKET_ONLY],
    });
  });

  afterAll(async () => {
    for (const c of open) c.ws.close();
    resetTournaments();
    resetReadyChecks();
    const ids = createdUserIds.length > 0 ? createdUserIds : ['00000000-0000-0000-0000-000000000000'];
    await sql`delete from matches where id in (select match_id from match_players where user_id in ${sql(ids)})`;
    if (bases.length > 0) await sql`delete from tournaments where starts_at >= ${new Date(Math.min(...bases))}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  /* Every entrant has already finished a casual match. A tournament can
     produce a rated match, so its door asks the same thing the rated queue
     and an arena ask. */
  async function guest(): Promise<Session> {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    await unlockRanked(session.id);
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

  function register(session: Session, id: string) {
    return app.inject({ method: 'POST', url: `/api/tournaments/${id}/register`, headers: auth(session) });
  }

  /* A fresh fixture on a fresh stretch of calendar. Ticked more than once
     because a row an earlier test left upcoming has to be opened (and, with
     nobody in it, cancelled) before the schedule writes the next one. */
  async function nextFixture(fixture: TournamentFixture) {
    configureTournaments({ fixtures: [fixture] });
    freshBase();
    for (let i = 0; i < 6; i++) {
      await tournamentTick();
      const row = await getUpcomingTournament(fixture.kind);
      if (row && row.startsAt.getTime() > clock) return row;
    }
    throw new Error(`no upcoming ${fixture.kind} was scheduled`);
  }

  // Accepts a ready check if one is offered, and says nothing if none is: at
  // any round most seats are not at the table being asked about.
  async function acceptIfAsked(conn: Connected, timeoutMs = 2_000): Promise<boolean> {
    try {
      await conn.messages.wait((m) => m.t === 'ready' && m.s === 'pending', timeoutMs);
    } catch {
      return false;
    }
    conn.ws.send(JSON.stringify({ t: 'ready', a: true }));
    return true;
  }

  async function declineIfAsked(conn: Connected, timeoutMs = 2_000): Promise<boolean> {
    try {
      await conn.messages.wait((m) => m.t === 'ready' && m.s === 'pending', timeoutMs);
    } catch {
      return false;
    }
    conn.ws.send(JSON.stringify({ t: 'ready', a: false }));
    return true;
  }

  // Joins and plays the table this seat was dealt. Only ever called for a seat
  // the tournament's own rows say is at one, so nothing here is a poll.
  async function playDealt(conn: Connected, timeoutMs = 6_000): Promise<string> {
    const found = await conn.messages.wait((m) => m.t === 'q' && m.s === 'found', timeoutMs);
    conn.ws.send(JSON.stringify({ t: 'join', m: found.m }));
    await driveRandomPlay(conn, 60_000);
    return found.m as string;
  }

  // Who is sitting at a round's unplayed tables, read off the rows rather than
  // guessed by waiting on every socket for a prompt that most will not get.
  async function seatsInRound(id: string, round: number, players: Connected[]): Promise<Connected[]> {
    const tables = (await getTournamentTables(id)).filter((r) => r.round === round && r.status !== 'done');
    const seats = tables.flatMap((r) => r.seats);
    return players.filter((p) => seats.includes(p.id));
  }

  // One round, played out: everybody at a live table accepts and plays it.
  async function playRound(id: string, round: number, players: Connected[]): Promise<Connected[]> {
    const at = await seatsInRound(id, round, players);
    await Promise.all(at.map((p) => acceptIfAsked(p)));
    await Promise.all(at.map((p) => playDealt(p)));
    return at;
  }

  async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out waiting');
  }

  it('keeps one upcoming fixture per kind and no more', async () => {
    configureTournaments({ fixtures: FIXTURES });
    freshBase();
    await tournamentTick();
    await tournamentTick();

    const upcoming = (await getOpenTournaments()).filter((t) => t.status === 'upcoming');
    const kinds = upcoming.map((t) => t.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toHaveLength(3);
    for (const t of upcoming) {
      expect(t.startsAt.getTime()).toBeGreaterThan(clock);
      const fixture = fixtureFor(t.kind);
      expect(t.seats).toBe(fixture!.seats);
      expect(t.shape).toBe(fixture!.shape);
      expect(t.round).toBe(0);
    }

    // A second pass writes nothing: one upcoming per kind is the whole rule.
    const before = (await getOpenTournaments()).length;
    await tournamentTick();
    expect((await getOpenTournaments()).length).toBe(before);

    const listing = await tournamentListing(null);
    expect(listing.upcoming).toHaveLength(3);
    for (const card of listing.upcoming) {
      expect(card.blurb.length).toBeGreaterThan(0);
      expect(card.entrants).toBe(0);
      expect(card.registered).toBe(false);
    }
    // The daily is the one fixture whose schedule needs a sentence.
    expect(listing.upcoming.find((c) => c.kind === 'daily-bracket')!.note).toBeTruthy();
  });

  it('registers, withdraws, and refuses both once it has started', async () => {
    const t = await nextFixture(BRACKET_ONLY);
    const hero = await guest();

    expect((await register(hero, t.id)).statusCode).toBe(200);
    let view = await tournamentView(t.id, hero.id);
    expect(view!.entrants).toBe(1);
    expect(view!.registered).toBe(true);
    expect(view!.you!.registered).toBe(true);
    expect(view!.you!.seed).toBeNull();

    // Registering twice is the same registration, not a second seat.
    expect((await register(hero, t.id)).statusCode).toBe(200);
    expect((await tournamentView(t.id, hero.id))!.entrants).toBe(1);

    const gone = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${t.id}/withdraw`,
      headers: auth(hero),
    });
    expect(gone.statusCode).toBe(200);
    view = await tournamentView(t.id, hero.id);
    expect(view!.entrants).toBe(0);
    expect(view!.you).toBeNull();

    // Past the start, with nobody in it: cancelled, and both doors closed.
    clock = t.startsAt.getTime();
    await tournamentTick();
    expect((await getTournamentById(t.id))!.status).toBe('cancelled');
    expect((await register(hero, t.id)).statusCode).toBe(409);
    const late = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${t.id}/withdraw`,
      headers: auth(hero),
    });
    expect(late.statusCode).toBe(409);
  });

  it('cancels a fixture whose field is under the minimum', async () => {
    const t = await nextFixture(BRACKET_ONLY);
    const three = [await guest(), await guest(), await guest()];
    for (const g of three) expect((await register(g, t.id)).statusCode).toBe(200);

    clock = t.startsAt.getTime();
    await tournamentTick();
    const row = (await getTournamentById(t.id))!;
    expect(row.status).toBe('cancelled');
    expect(row.round).toBe(0);
    expect(await getTournamentTables(t.id)).toHaveLength(0);
    // Nobody is seeded and nobody is placed: there was no tournament.
    for (const p of await getTournamentPlayers(t.id)) {
      expect(p.seed).toBeNull();
      expect(p.place).toBeNull();
    }
  });

  it('takes the last seat off the newest bot rather than off a person', async () => {
    // A four-seat fixture rather than thirty-two guests: the cap is the
    // fixture's, and what is under test is what happens when it is reached.
    const t = await nextFixture({ ...BRACKET_ONLY, seats: 4 });
    expect(t.seats).toBe(4);

    const people = [await guest(), await guest()];
    for (const g of people) expect((await register(g, t.id)).statusCode).toBe(200);

    // Two bots, registered in order, fill it up.
    const bots = await sql<{ id: string }[]>`select id from users where bot = true order by name_lower asc limit 2`;
    expect(bots).toHaveLength(2);
    for (const bot of bots) expect((await registerForTournament(t.id, bot.id)).ok).toBe(true);
    expect((await tournamentView(t.id, null))!.entrants).toBe(4);

    // A person arriving at a full field displaces the bot that came last.
    const latecomer = await guest();
    expect((await register(latecomer, t.id)).statusCode).toBe(200);
    const field = await getTournamentPlayers(t.id);
    expect(field).toHaveLength(4);
    expect(field.map((p) => p.userId)).toContain(latecomer.id);
    expect(field.map((p) => p.userId)).not.toContain(bots[1].id);
    expect(field.map((p) => p.userId)).toContain(bots[0].id);

    // A bot arriving at a full field simply does not play.
    const spare = await sql<{ id: string }[]>`
      select id from users where bot = true and id not in ${sql(bots.map((b) => b.id))} limit 1
    `;
    const refused = await registerForTournament(t.id, spare[0].id);
    expect(refused.ok).toBe(false);

    // The next person takes the other bot's seat, and after that the field is
    // four people: a person cannot take a seat off a person.
    const third = await guest();
    expect((await register(third, t.id)).statusCode).toBe(200);
    expect((await getTournamentPlayers(t.id)).filter((p) => p.bot)).toHaveLength(0);

    const fourth = await guest();
    const full = await register(fourth, t.id);
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/full/i);
  });

  it('plays a five-handed bracket through a bye and a walkover to a podium', async () => {
    const t = await nextFixture(BRACKET_ONLY);
    const players: Connected[] = [];
    for (let i = 0; i < 5; i++) {
      const conn = await connected();
      expect((await register(conn, t.id)).statusCode).toBe(200);
      players.push(conn);
    }

    clock = t.startsAt.getTime();
    await tournamentTick();

    const started = (await getTournamentById(t.id))!;
    expect(started.status).toBe('running');
    expect(started.round).toBe(1);

    // The draw: four tables, three of them byes.
    let tables = await getTournamentTables(t.id);
    expect(tables.filter((r) => r.round === 1)).toHaveLength(4);
    const byes = tables.filter((r) => r.round === 1 && r.bye);
    expect(byes).toHaveLength(3);
    for (const bye of byes) {
      expect(bye.status).toBe('done');
      expect(bye.advanced).toHaveLength(1);
      expect(bye.matchId).toBeNull();
    }
    // And the byes belong to the top three seeds.
    const seeded = await getTournamentPlayers(t.id);
    expect(seeded.map((p) => p.seed)).toEqual([1, 2, 3, 4, 5]);
    const byeSeeds = byes
      .map((b) => seeded.find((p) => p.userId === b.advanced![0])!.seed)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(byeSeeds).toEqual([1, 2, 3]);

    // Round one's only match, and it is rated: a heads-up tournament match is
    // rated the way an arena's is.
    const round1 = await playRound(t.id, 1, players);
    expect(round1).toHaveLength(2);
    const dealt = (await getTournamentTables(t.id)).find((r) => r.round === 1 && !r.bye)!;
    const match = (await getMatchById(dealt.matchId!))!;
    expect(match.format.rated).toBe(true);
    expect(match.format.tournament).toEqual({ id: t.id, round: 1, table: dealt.tableNo });

    /* Round two follows the moment that settles, so it is the finished-match
       listener and not the tick that starts it. */
    await waitFor(async () => ((await getTournamentById(t.id))!.round ?? 0) >= 2);
    tables = await getTournamentTables(t.id);
    const round2Rows = tables.filter((r) => r.round === 2);
    expect(round2Rows).toHaveLength(2);
    for (const r of round2Rows) expect(r.seats).toHaveLength(2);

    const round2 = await playRound(t.id, 2, players);
    expect(round2).toHaveLength(4);

    await waitFor(async () => ((await getTournamentById(t.id))!.round ?? 0) >= 3, 20_000);
    tables = await getTournamentTables(t.id);
    expect(tables.filter((r) => r.round === 3)).toHaveLength(1);

    /* The final, decided by a walkover. One seat declines its ready check,
       which withdraws them from the tournament and hands the other the
       tournament with no hand dealt and no walkout charged. */
    const finalSeats = tables.find((r) => r.round === 3)!.seats;
    const atFinal = players.filter((p) => finalSeats.includes(p.id));
    expect(atFinal).toHaveLength(2);
    const [quitter, walkover] = atFinal;
    await Promise.all([declineIfAsked(quitter), acceptIfAsked(walkover)]);

    await waitFor(async () => (await getTournamentById(t.id))!.status === 'finished', 20_000);
    const finished = (await getTournamentById(t.id))!;
    const finalTable = (await getTournamentTables(t.id)).find((r) => r.round === 3)!;
    expect(finalTable.bye).toBe(true);
    expect(finalTable.matchId).toBeNull();
    expect(finalTable.places).toEqual({ [walkover.id]: 1 });

    const field = await getTournamentPlayers(t.id);
    const placeOf = new Map(field.map((p) => [p.userId, p.place]));
    expect(placeOf.get(walkover.id)).toBe(1);
    // The seat that declined the final is placed under the one who played it.
    expect(placeOf.get(quitter.id)).toBe(2);
    expect(field.find((p) => p.userId === quitter.id)!.withdrawn).toBe(true);
    /* Two went out in round two and share third; one went out in round one and
       is fifth, because four players were still in after round one. */
    const places = [...placeOf.values()].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(places).toEqual([1, 2, 3, 3, 5]);

    expect(finished.podium).toHaveLength(3);
    expect(finished.podium![0]).toMatchObject({ uid: walkover.id, place: 1 });
    expect(finished.podium![1]).toMatchObject({ uid: quitter.id, place: 2 });

    // The withdrawal cost nothing else: no walkout strike was charged.
    const [row] = await sql<{ walkoutStrikes: number }[]>`
      select walkout_strikes from users where id = ${quitter.id}
    `;
    expect(row.walkoutStrikes).toBe(0);

    // The bracket a page draws: three columns, narrowing, the winner marked.
    const view = await tournamentView(t.id, walkover.id);
    expect(view!.rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(view!.rounds[0][0].advance).toBe(1);
    expect(view!.rounds[2][0].advance).toBe(0);
    expect(view!.you!.place).toBe(1);

    // And it is on the profile of everybody who played it.
    const res = await app.inject({ method: 'GET', url: `/api/users/${encodeURIComponent(walkover.name)}` });
    const body = res.json();
    expect(body.tournamentRecord).toEqual({ wins: 1, podiums: 1 });
    expect((body.tournaments as { id: string; place: number }[]).find((x) => x.id === t.id)!.place).toBe(1);
  }, 240_000);

  it('replays a drawn heads-up match instead of advancing two players', async () => {
    const t = await nextFixture(BRACKET_ONLY);
    const players: Connected[] = [];
    for (let i = 0; i < 4; i++) {
      const conn = await connected();
      expect((await register(conn, t.id)).statusCode).toBe(200);
      players.push(conn);
    }

    clock = t.startsAt.getTime();
    await tournamentTick();
    await Promise.all(players.map((p) => acceptIfAsked(p)));

    // Both round-one tables are dealt. A draw is not something random play can
    // be asked for, so one is announced by hand, exactly the way the arena's
    // streak test announces a run of wins.
    await waitFor(async () => (await getTournamentTables(t.id)).every((r) => r.matchId !== null));
    const table = (await getTournamentTables(t.id)).find((r) => r.round === 1)!;
    const first = table.matchId!;
    emitMatchFinished({
      id: first,
      format: FAST('heads-up', true, 2, { id: t.id, round: 1, table: table.tableNo }),
      playerIds: table.seats,
      winner: null,
      reason: 'hands',
      places: Object.fromEntries(table.seats.map((uid) => [uid, 1])),
    });

    // The table is dealt again rather than settled: a bracket cannot advance
    // two players, and equal stacks after the hand cap is not a result.
    await waitFor(async () => {
      const again = (await getTournamentTables(t.id)).find((r) => r.round === 1 && r.tableNo === table.tableNo)!;
      return again.matchId !== null && again.matchId !== first;
    });
    const replayed = (await getTournamentTables(t.id)).find(
      (r) => r.round === 1 && r.tableNo === table.tableNo
    )!;
    expect(replayed.status).toBe('playing');
    expect((await getTournamentById(t.id))!.round).toBe(1);
  }, 60_000);

  it('funnels a thirteen-handed shootout through three tables to a final', async () => {
    const t = await nextFixture(SHOOTOUT_ONLY);
    const players: Connected[] = [];
    for (let i = 0; i < 13; i++) {
      const conn = await connected();
      expect((await register(conn, t.id)).statusCode).toBe(200);
      players.push(conn);
    }

    clock = t.startsAt.getTime();
    await tournamentTick();
    expect((await getTournamentById(t.id))!.status).toBe('running');

    // Three tables of five, four and four, snake seeded off the ratings.
    const round1 = (await getTournamentTables(t.id)).filter((r) => r.round === 1);
    expect(round1.map((r) => r.seats.length)).toEqual([5, 4, 4]);
    const seeded = await getTournamentPlayers(t.id);
    expect(seeded.map((p) => p.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const seedOf = new Map(seeded.map((p) => [p.userId, p.seed]));
    expect(round1.map((r) => seedOf.get(r.seats[0]))).toEqual([1, 2, 3]);
    for (const r of round1) expect(r.status).toBe('pending');

    /* Every table has six people at it or fewer and more than one of them is
       a person, so every table is rated: the home game's rule. */
    const played = await playRound(t.id, 1, players);
    expect(played).toHaveLength(13);

    await waitFor(async () => ((await getTournamentById(t.id))!.round ?? 0) >= 2, 60_000);
    const round1Done = (await getTournamentTables(t.id)).filter((r) => r.round === 1);
    for (const r of round1Done) {
      expect(r.status).toBe('done');
      // Three tables, so the top two of each go through: six, a final table.
      expect(r.advanced).toHaveLength(2);
      // A table's places are the elimination order the match already recorded.
      expect(Object.keys(r.places ?? {})).toHaveLength(r.seats.length);
      const top = Object.entries(r.places!)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2)
        .map(([uid]) => uid);
      expect(r.advanced!.slice().sort()).toEqual(top.sort());
      const match = (await getMatchById(r.matchId!))!;
      expect(match.format.rated).toBe(true);
      expect(match.format.tournament!.round).toBe(1);
    }

    const round2 = (await getTournamentTables(t.id)).filter((r) => r.round === 2);
    expect(round2).toHaveLength(1);
    expect(round2[0].seats).toHaveLength(6);

    await playRound(t.id, 2, players);
    await waitFor(async () => (await getTournamentById(t.id))!.status === 'finished', 90_000);

    const finished = (await getTournamentById(t.id))!;
    const field = await getTournamentPlayers(t.id);
    const places = field.map((p) => p.place).sort((a, b) => (a ?? 0) - (b ?? 0));
    /* The final table's places are the top six; the seven the first round put
       out share seventh, because six were still in after it. */
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7]);
    expect(finished.podium).toHaveLength(3);
    expect(finished.podium!.map((p) => p.place)).toEqual([1, 2, 3]);

    const finalPlaces = (await getTournamentTables(t.id)).find((r) => r.round === 2)!.places!;
    const champion = Object.entries(finalPlaces).find(([, place]) => place === 1)![0];
    expect(field.find((p) => p.userId === champion)!.place).toBe(1);

    // The funnel a page draws: two bands, the final set apart by advancing none.
    const view = await tournamentView(t.id, champion);
    expect(view!.rounds).toHaveLength(2);
    expect(view!.rounds[0]).toHaveLength(3);
    expect(view!.rounds[0][0].advance).toBe(2);
    expect(view!.rounds[1]).toHaveLength(1);
    expect(view!.rounds[1][0].advance).toBe(0);
    expect(view!.you!.place).toBe(1);
    expect(view!.rounds[1][0].seats.find((s) => s.uid === champion)!.place).toBe(1);
  }, 600_000);
});
