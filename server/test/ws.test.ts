import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs } from './helpers.js';

describe('websocket connect', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  /* No session is a watcher, not a refusal: it may watch, and anything that
     needs somebody is answered need_session. Nobody is minted for it. */
  it('lets a socket with no session watch, and nothing more', async () => {
    const { ws, messages } = await connectWs(wsUrl, 'nobody');
    const hi = await messages.wait((m) => m.t === 'hi');
    expect(hi.v).toBe(PROTOCOL_VERSION);
    expect(hi.u).toBeUndefined();

    ws.send(JSON.stringify({ t: 'join', m: 'no-such-match' }));
    const noMatch = await messages.wait((m) => m.t === 'err');
    expect(noMatch.c).toBe('no_match');

    ws.send(JSON.stringify({ t: 'queue', mode: 'heads-up', rated: false }));
    const refused = await messages.wait((m) => m.t === 'err');
    expect(refused.c).toBe('need_session');

    ws.send(JSON.stringify({ t: 'ping' }));
    await messages.wait((m) => m.t === 'pong');
    ws.close();
  });

  it('sends hi with the protocol version and user summary on connect', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);

    const { ws, messages } = await connectWs(wsUrl, session.token);
    const hi = await messages.wait((m) => m.t === 'hi');
    expect(hi.v).toBe(PROTOCOL_VERSION);
    expect(hi.u.id).toBe(session.id);
    expect(hi.u.guest).toBe(true);
    expect(hi.u.rating).toBe(hi.u.ratings['heads-up'].rating);
    expect(hi.u.ratings['six-max'].rating).toBe(1500);
    ws.close();
  });

  it('answers ping with pong', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);

    const { ws, messages } = await connectWs(wsUrl, session.token);
    await messages.wait((m) => m.t === 'hi');
    ws.send(JSON.stringify({ t: 'ping' }));
    const pong = await messages.wait((m) => m.t === 'pong');
    expect(pong.t).toBe('pong');
    ws.close();
  });
});
