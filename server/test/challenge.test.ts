import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat, type Session } from './helpers.js';
import { setFormatResolver } from '../src/matchmaking.js';
import { getMatchById, sql } from '../src/db.js';
import { MAX_OPEN_CHALLENGES } from '../src/challenges.js';

/* Play a friend: a link instead of a queue. Nothing here waits on the
   matchmaking tick, because a challenge never enters the queue: the match is
   created by the accept and announced with the same `q found` a queued match
   sends. The format is a fast one so the tables these tests open finish on
   their own instead of sitting on a 20 second clock. */

const FAST: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ hands: 1, stack: 20, clockMs: 300, graceMs: 300 }),
  'six-max': testFormat({ mode: 'six-max', stack: 12, clockMs: 300, graceMs: 300 }),
};

describe('challenge links', () => {
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

  function create(session: Session, body: { mode?: string; rated?: boolean } = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/challenges',
      headers: auth(session),
      payload: { mode: 'heads-up', rated: true, ...body },
    });
  }

  function accept(session: Session, id: string) {
    return app.inject({ method: 'POST', url: `/api/challenges/${id}/accept`, headers: auth(session) });
  }

  it('creates a link and serves it back with the creator on it', async () => {
    const alice = await guest();
    const res = await create(alice);
    expect(res.statusCode).toBe(200);
    const { id, url } = res.json() as { id: string; url: string };
    expect(id).toMatch(/^[0-9a-z]{8}$/);
    expect(url.endsWith(`/c/${id}`)).toBe(true);

    const read = await app.inject({ method: 'GET', url: `/api/challenges/${id}` });
    expect(read.statusCode).toBe(200);
    const view = read.json();
    expect(view.status).toBe('open');
    expect(view.mode).toBe('heads-up');
    expect(view.rated).toBe(true);
    expect(view.matchId).toBeNull();
    expect(view.creator.name).toBe(alice.name);
    expect(view.creator.ratings['heads-up'].rating).toBe(1500);
  });

  it('is heads-up only for now', async () => {
    const alice = await guest();
    const res = await create(alice, { mode: 'six-max' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('heads-up');
  });

  it('answers a link that does not exist with a 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/challenges/nosuchid' });
    expect(res.statusCode).toBe(404);
  });

  it('seats both players on accept and tells them the way the queue does', async () => {
    const alice = await guest();
    const bob = await guest();
    const aliceWs = await connectWs(wsUrl, alice.token);
    const bobWs = await connectWs(wsUrl, bob.token);
    await aliceWs.messages.wait((m) => m.t === 'hi');
    await bobWs.messages.wait((m) => m.t === 'hi');

    const { id } = (await create(alice)).json();
    const before = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(alice) })).json();
    expect(before.playing).toBeNull();
    const res = await accept(bob, id);
    expect(res.statusCode).toBe(200);
    const { matchId } = res.json() as { matchId: string };
    createdMatchIds.push(matchId);

    // The creator's waiting page navigates on this message and nothing else,
    // so both sides have to get it.
    const found = await Promise.all([
      aliceWs.messages.wait((m) => m.t === 'q' && m.s === 'found' && m.m === matchId),
      bobWs.messages.wait((m) => m.t === 'q' && m.s === 'found' && m.m === matchId),
    ]);
    for (const msg of found) expect(msg.mode).toBe('heads-up');

    const match = await getMatchById(matchId);
    expect(match!.seats.length).toBe(2);
    expect(match!.seats.map((s) => s.userId).sort()).toEqual([alice.id, bob.id].sort());
    expect(match!.rated).toBe(true);

    const view = (await app.inject({ method: 'GET', url: `/api/challenges/${id}` })).json();
    expect(view.status).toBe('accepted');
    expect(view.matchId).toBe(matchId);

    // A creator whose socket was down when the link was taken has only this
    // to find the table by, so both seats read it off /api/me too.
    for (const s of [alice, bob]) {
      const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(s) })).json();
      expect(me.playing).toBe(matchId);
    }

    aliceWs.ws.close();
    bobWs.ws.close();
  });

  it('refuses a second accept once the link is spent', async () => {
    const alice = await guest();
    const bob = await guest();
    const carol = await guest();
    const { id } = (await create(alice)).json();

    const first = await accept(bob, id);
    expect(first.statusCode).toBe(200);
    createdMatchIds.push(first.json().matchId);

    const second = await accept(carol, id);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain('already taken');
  });

  it('refuses the creator accepting their own link', async () => {
    const alice = await guest();
    const { id } = (await create(alice)).json();
    const res = await accept(alice, id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('your own link');
  });

  it('cancels a link, and only the creator can', async () => {
    const alice = await guest();
    const bob = await guest();
    const { id } = (await create(alice)).json();

    const wrongHands = await app.inject({ method: 'DELETE', url: `/api/challenges/${id}`, headers: auth(bob) });
    expect(wrongHands.statusCode).toBe(403);

    const res = await app.inject({ method: 'DELETE', url: `/api/challenges/${id}`, headers: auth(alice) });
    expect(res.statusCode).toBe(200);

    const view = (await app.inject({ method: 'GET', url: `/api/challenges/${id}` })).json();
    expect(view.status).toBe('cancelled');

    const taken = await accept(bob, id);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toContain('cancelled');
  });

  it('reads a link past its day as expired and refuses it', async () => {
    const alice = await guest();
    const bob = await guest();
    const { id } = (await create(alice)).json();
    await sql`update challenges set expires_at = now() - interval '1 minute' where id = ${id}`;

    const view = (await app.inject({ method: 'GET', url: `/api/challenges/${id}` })).json();
    expect(view.status).toBe('expired');

    const res = await accept(bob, id);
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toContain('expired');
  });

  it(`stops at ${MAX_OPEN_CHALLENGES} open links per player`, async () => {
    const alice = await guest();
    for (let i = 0; i < MAX_OPEN_CHALLENGES; i++) {
      expect((await create(alice)).statusCode).toBe(200);
    }
    const capped = await create(alice);
    expect(capped.statusCode).toBe(429);

    // Cancelling one makes room again: the cap counts links that are still
    // waiting, not links ever made.
    const open = await sql<{ id: string }[]>`
      select id from challenges where creator_id = ${alice.id} and status = 'open' limit 1
    `;
    await app.inject({ method: 'DELETE', url: `/api/challenges/${open[0].id}`, headers: auth(alice) });
    expect((await create(alice)).statusCode).toBe(200);
  });
});
