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

  it('rejects the upgrade without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/ws' });
    expect(res.statusCode).toBe(401);
  });

  it('sends hi with the protocol version and user summary on connect', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);

    const { ws, messages } = await connectWs(wsUrl, session.token);
    const hi = await messages.wait((m) => m.t === 'hi');
    expect(hi.v).toBe(PROTOCOL_VERSION);
    expect(hi.u.id).toBe(session.id);
    expect(hi.u.guest).toBe(true);
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
