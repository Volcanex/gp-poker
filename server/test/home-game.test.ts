import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat, type Session } from './helpers.js';
import { setFormatResolver } from '../src/matchmaking.js';
import { getMatchById, sql } from '../src/db.js';
import { MAX_OPEN_HOME_GAMES } from '../src/home-games.js';

/* Home games: a private six-max table gathered by link and started by its
   host. Nothing here waits on the matchmaking tick, because a home game never
   enters the queue: the host's start is what creates the match, and it is
   announced with the same `q found` a queued match sends.

   The format is a fast one so the tables these tests open play themselves out
   in a second or two instead of sitting on a 20 second clock with four bots
   thinking on it. */

const FAST: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ hands: 1, stack: 20, clockMs: 300, graceMs: 300 }),
  'six-max': testFormat({ mode: 'six-max', stack: 12, clockMs: 300, graceMs: 300 }),
};

describe('home games', () => {
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

  async function guest(): Promise<Session> {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    return session;
  }

  function auth(session: Session) {
    return { cookie: `ot_session=${session.token}` };
  }

  function create(session: Session, body: { rated?: boolean; botLevel?: number } = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/home-games',
      headers: auth(session),
      payload: { rated: true, botLevel: 2, ...body },
    });
  }

  const read = (id: string) => app.inject({ method: 'GET', url: `/api/home-games/${id}` });
  const join = (s: Session, id: string) =>
    app.inject({ method: 'POST', url: `/api/home-games/${id}/join`, headers: auth(s) });
  const leave = (s: Session, id: string) =>
    app.inject({ method: 'POST', url: `/api/home-games/${id}/leave`, headers: auth(s) });
  const start = (s: Session, id: string) =>
    app.inject({ method: 'POST', url: `/api/home-games/${id}/start`, headers: auth(s) });
  const cancel = (s: Session, id: string) =>
    app.inject({ method: 'DELETE', url: `/api/home-games/${id}`, headers: auth(s) });

  it('creates a table with the host already sitting at it', async () => {
    const alice = await guest();
    const res = await create(alice);
    expect(res.statusCode).toBe(200);
    const { id, url } = res.json() as { id: string; url: string };
    expect(id).toMatch(/^[0-9a-z]{8}$/);
    expect(url.endsWith(`/g/${id}`)).toBe(true);

    const view = (await read(id)).json();
    expect(view.status).toBe('open');
    expect(view.rated).toBe(true);
    expect(view.botLevel).toBe(2);
    expect(view.players).toBe(6);
    expect(view.matchId).toBeNull();
    expect(view.host.name).toBe(alice.name);
    expect(view.seats).toHaveLength(1);
    expect(view.seats[0]).toMatchObject({ uid: alice.id, name: alice.name, host: true, rating: 1500 });
  });

  it('answers a table that does not exist with a 404', async () => {
    expect((await read('nosuchid')).statusCode).toBe(404);
  });

  it('seats a visitor, tells the lobby, and seats them back out again', async () => {
    const alice = await guest();
    const bob = await guest();
    const aliceWs = await connectWs(wsUrl, alice.token);
    await aliceWs.messages.wait((m) => m.t === 'hi');

    const { id } = (await create(alice)).json();
    expect((await join(bob, id)).statusCode).toBe(200);

    // The lobby updates in front of the people in it rather than on a poll.
    const push = await aliceWs.messages.wait((m) => m.t === 'lobby' && m.g === id);
    expect(push.status).toBe('open');
    expect(push.seats.map((s: { uid: string }) => s.uid)).toEqual([alice.id, bob.id]);

    // Joining twice is the same seat, not a second one.
    expect((await join(bob, id)).statusCode).toBe(200);
    expect((await read(id)).json().seats).toHaveLength(2);

    expect((await leave(bob, id)).statusCode).toBe(200);
    expect((await read(id)).json().seats).toHaveLength(1);

    // The host's way out is to cancel: leaving would strand the table.
    const hostOut = await leave(alice, id);
    expect(hostOut.statusCode).toBe(400);
    expect(hostOut.json().error).toContain('Cancel it');

    aliceWs.ws.close();
  });

  it('starts on the host, fills the empty seats with bots and tells everyone seated', async () => {
    const alice = await guest();
    const bob = await guest();
    const aliceWs = await connectWs(wsUrl, alice.token);
    const bobWs = await connectWs(wsUrl, bob.token);
    await aliceWs.messages.wait((m) => m.t === 'hi');
    await bobWs.messages.wait((m) => m.t === 'hi');

    const { id } = (await create(alice)).json();
    await join(bob, id);

    const refused = await start(bob, id);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toContain('Only the host');

    const res = await start(alice, id);
    expect(res.statusCode).toBe(200);
    const { matchId, rated, reason } = res.json() as { matchId: string; rated: boolean; reason: string | null };
    createdMatchIds.push(matchId);
    // Two humans is enough for the rating the host asked for.
    expect(rated).toBe(true);
    expect(reason).toBeNull();

    const found = await Promise.all([
      aliceWs.messages.wait((m) => m.t === 'q' && m.s === 'found' && m.m === matchId),
      bobWs.messages.wait((m) => m.t === 'q' && m.s === 'found' && m.m === matchId),
    ]);
    for (const msg of found) expect(msg.mode).toBe('six-max');

    const match = await getMatchById(matchId);
    expect(match!.seats).toHaveLength(6);
    expect(match!.seats.filter((s) => s.bot)).toHaveLength(4);
    expect(match!.seats.filter((s) => !s.bot).map((s) => s.userId).sort()).toEqual([alice.id, bob.id].sort());
    expect(match!.rated).toBe(true);
    // The flag the feed reads to say what kind of table this was.
    expect(match!.format.homeGame).toBe(true);

    const view = (await read(id)).json();
    expect(view.status).toBe('started');
    expect(view.matchId).toBe(matchId);

    // A started table is spent: nobody else can join it and it cannot restart.
    const late = await guest();
    expect((await join(late, id)).statusCode).toBe(409);
    expect((await start(alice, id)).statusCode).toBe(409);

    aliceWs.ws.close();
    bobWs.ws.close();
  });

  it('plays casual when the host is the only human, and says why', async () => {
    const alice = await guest();
    const { id } = (await create(alice)).json();

    const res = await start(alice, id);
    expect(res.statusCode).toBe(200);
    const { matchId, rated, reason } = res.json() as { matchId: string; rated: boolean; reason: string | null };
    createdMatchIds.push(matchId);
    expect(rated).toBe(false);
    expect(reason).toContain('two humans');

    const match = await getMatchById(matchId);
    expect(match!.rated).toBe(false);
    expect(match!.format.rated).toBe(false);
    expect(match!.seats.filter((s) => s.bot)).toHaveLength(5);
  });

  it('is full at six', async () => {
    const alice = await guest();
    const { id } = (await create(alice)).json();
    for (let i = 0; i < 5; i++) {
      const friend = await guest();
      expect((await join(friend, id)).statusCode).toBe(200);
    }
    expect((await read(id)).json().seats).toHaveLength(6);

    const seventh = await guest();
    const res = await join(seventh, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('full');
  });

  it('cancels a table, and only the host can', async () => {
    const alice = await guest();
    const bob = await guest();
    const { id } = (await create(alice)).json();
    await join(bob, id);

    expect((await cancel(bob, id)).statusCode).toBe(403);
    expect((await cancel(alice, id)).statusCode).toBe(200);
    expect((await read(id)).json().status).toBe('cancelled');

    const carol = await guest();
    const late = await join(carol, id);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toContain('cancelled');
    expect((await start(alice, id)).statusCode).toBe(409);
  });

  it('reads a table past its day as expired and refuses it', async () => {
    const alice = await guest();
    const bob = await guest();
    const { id } = (await create(alice)).json();
    await sql`update home_games set expires_at = now() - interval '1 minute' where id = ${id}`;

    expect((await read(id)).json().status).toBe('expired');
    expect((await join(bob, id)).statusCode).toBe(410);
    expect((await start(alice, id)).statusCode).toBe(410);
  });

  it(`stops at ${MAX_OPEN_HOME_GAMES} open tables per host`, async () => {
    const alice = await guest();
    for (let i = 0; i < MAX_OPEN_HOME_GAMES; i++) {
      expect((await create(alice)).statusCode).toBe(200);
    }
    const capped = await create(alice);
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toContain('Cancel one');

    // Cancelling one makes room again: the cap counts tables still waiting,
    // not tables ever made.
    const open = await sql<{ id: string }[]>`
      select id from home_games where host_id = ${alice.id} and status = 'open' limit 1
    `;
    await cancel(alice, open[0].id);
    expect((await create(alice)).statusCode).toBe(200);
  });
});
