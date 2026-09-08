import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, TableView } from '@opentable/protocol';
import { WebSocket } from 'ws';
import {
  makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat, type Session,
} from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { COUNTRY_CODES, readCountry } from '../src/countries.js';
import { COUNTRIES } from '../../client/src/ui/countries.js';
import { sql } from '../src/db.js';

/* The flag beside a player's name: setting it, clearing it, refusing a code
   that is not a country, and the fact that a seat at a table carries it. */

const SHORT: MatchFormat = testFormat({ hands: 3, stack: 20 });

describe('country', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];
  const matchIds: string[] = [];
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    for (const ws of sockets) ws.close();
    for (const id of matchIds) await sql`delete from matches where id = ${id}`;
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

  it('is null on a fresh guest, and stays null until somebody says otherwise', async () => {
    const me = await guest();
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(me) });
    expect(res.statusCode).toBe(200);
    // Sent as null rather than left off: a summary is merged over the one the
    // client already holds, so "no flag" has to be said out loud.
    expect(res.json().country).toBeNull();
  });

  it('sets a country, uppercase and padding included, and reports it back everywhere', async () => {
    const me = await guest();
    const set = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(me),
      payload: { country: ' GB ' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().country).toBe('gb');

    // The PATCH answers with the whole of /api/me, so the two cannot disagree.
    const read = await app.inject({ method: 'GET', url: '/api/me', headers: auth(me) });
    expect(read.json()).toEqual(set.json());

    const profile = await app.inject({ method: 'GET', url: `/api/users/${me.name.toLowerCase()}` });
    expect(profile.json().summary.country).toBe('gb');
  });

  it('clears a country back to no flag', async () => {
    const me = await guest();
    await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(me), payload: { country: 'ie' } });
    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: auth(me),
      payload: { country: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().country).toBeNull();
  });

  it('refuses a code that is not a country, and changes nothing', async () => {
    const me = await guest();
    await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(me), payload: { country: 'jp' } });

    for (const bad of ['zz', 'gbr', 'x', 'eu', 'gb-sct', 42, true]) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: auth(me),
        payload: { country: bad },
      });
      expect(res.statusCode, `${String(bad)} should be refused`).toBe(400);
    }

    const read = await app.inject({ method: 'GET', url: '/api/me', headers: auth(me) });
    expect(read.json().country).toBe('jp');
  });

  it('puts the flag on a seat at the table', async () => {
    const a = await guest();
    const b = await guest();
    await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(a), payload: { country: 'gb' } });

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    sockets.push(connA.ws, connB.ws);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    const id = await createMatchForPlayers([a.id, b.id], SHORT);
    matchIds.push(id);
    connA.ws.send(JSON.stringify({ t: 'join', m: id }));
    const view = (await connA.messages.wait((m) => m.t === 'state' && m.s.m === id)).s as TableView;

    const mine = view.seats.find((s) => s.uid === a.id)!;
    const theirs = view.seats.find((s) => s.uid === b.id)!;
    expect(mine.country).toBe('gb');
    // Omitted rather than sent as null: a seat goes out on every action, and a
    // reader that has never heard of a flag should see the seat it always saw.
    expect('country' in theirs).toBe(false);
  });

  it('reads a code the way the route does, and nothing else', () => {
    expect(readCountry('gb')).toBe('gb');
    expect(readCountry('GB')).toBe('gb');
    expect(readCountry(null)).toBeNull();
    // An empty field is how a form says "no flag", so it clears rather than
    // failing: the picker sends it when somebody backs out of a choice.
    expect(readCountry('')).toBeNull();
    expect(readCountry(undefined)).toBeUndefined();
    expect(readCountry('zz')).toBeUndefined();
  });

  /* The codes are duplicated on purpose: the server needs to validate them and
     the client needs to name them, and @opentable/protocol has no business
     carrying 249 English country names to do it. Duplicated lists drift, so
     this is the thing that stops them, by importing both. Both are generated
     by client/scripts/flags.mjs, so a drift means one was hand-edited. */
  it('holds exactly the codes the client lists', () => {
    expect([...COUNTRY_CODES].sort()).toEqual(COUNTRIES.map((c) => c.code).sort());
  });

  it('lists only lowercase two-letter codes, each one once', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(200);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[a-z]{2}$/);
  });
});
