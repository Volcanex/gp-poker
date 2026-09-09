import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat, TableView } from '@opentable/protocol';
import { WebSocket } from 'ws';
import {
  makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, testFormat,
} from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { sql } from '../src/db.js';

/* Profile pictures. The server never decodes an image, so what is tested here
   is the boundary rather than the picture: which bytes are let in, what a URL
   promises about how long it stays true, and that a version reaches the places
   a name and a rating already reach.

   Every case uses its own guest, because the upload route is rate limited per
   user and two uploads in one test would race the limiter rather than the
   thing the test is about. */

const SHORT: MatchFormat = testFormat({ hands: 2, stack: 20 });

/* A real 1x1 PNG, so the magic number is not the only thing that is true about
   it. Built rather than read from a fixture: eight bytes of signature and three
   chunks is less to explain than a binary file in the tree. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, out.length - 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x62, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return c ^ 0xffffffff;
}

/* A RIFF container declaring itself WEBP, with a simple lossy chunk after it.
   The server reads the first twelve bytes and stores the rest verbatim, which
   is exactly what this asserts. */
function webp(payload = Buffer.from('VP8 fake picture data')): Buffer {
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(4 + payload.length, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, payload]);
}

const GIF = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 7)]);

describe('profile pictures', () => {
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

  async function guest() {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    return session;
  }

  function put(token: string, type: string, body: Buffer) {
    return app.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      headers: { cookie: `ot_session=${token}`, 'content-type': type },
      payload: body,
    });
  }

  it('takes a webp and serves the same bytes back', async () => {
    const me = await guest();
    const bytes = webp();

    const res = await put(me.token, 'image/webp', bytes);
    expect(res.statusCode).toBe(200);
    expect(res.json().avatarV).toBe(1);

    const got = await app.inject({ method: 'GET', url: `/api/avatars/${me.id}?v=1` });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toContain('image/webp');
    expect(Buffer.from(got.rawPayload).equals(bytes)).toBe(true);
  });

  it('takes a png too', async () => {
    const me = await guest();
    const res = await put(me.token, 'image/png', png());
    expect(res.statusCode).toBe(200);

    const got = await app.inject({ method: 'GET', url: `/api/avatars/${me.id}` });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toContain('image/png');
  });

  /* The header is a claim, not evidence. A gif sent as a png is refused on what
     the bytes actually are, because those bytes would later be served back to a
     browser under whatever type this route recorded. */
  it('refuses a gif, whatever it says it is', async () => {
    const me = await guest();
    const lying = await put(me.token, 'image/png', GIF);
    expect(lying.statusCode).toBe(400);
    expect(lying.json().error).toMatch(/gif|png|webp/i);

    const honest = await put(me.token, 'image/gif', GIF);
    expect(honest.statusCode).toBe(415);
    expect(honest.json().error).toMatch(/webp or image\/png/);
  });

  it('refuses a body over the route limit', async () => {
    const me = await guest();
    const huge = webp(Buffer.alloc(200 * 1024, 9));
    const res = await put(me.token, 'image/webp', huge);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatch(/under 128 KB/);
  });

  it('allows one change every ten seconds', async () => {
    const me = await guest();
    expect((await put(me.token, 'image/webp', webp())).statusCode).toBe(200);
    const again = await put(me.token, 'image/png', png());
    expect(again.statusCode).toBe(429);
  });

  /* Removing bumps the version as an upload does: a page holding the old URL
     was told that URL would never change, so the only way to tell it the
     picture has gone is a number it has not asked about yet. */
  it('removes a picture, bumping the version', async () => {
    const me = await guest();
    expect((await put(me.token, 'image/webp', webp())).statusCode).toBe(200);

    const gone = await app.inject({
      method: 'DELETE',
      url: '/api/me/avatar',
      headers: { cookie: `ot_session=${me.token}` },
    });
    expect(gone.statusCode).toBe(200);
    expect(gone.json().avatarV).toBe(2);

    const got = await app.inject({ method: 'GET', url: `/api/avatars/${me.id}?v=2` });
    expect(got.statusCode).toBe(404);

    const mine = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `ot_session=${me.token}` },
    });
    expect(mine.json().avatarV).toBe(2);
  });

  /* A pinned version can be cached for good, because a new picture is a
     different URL. Without one the answer moves, so the browser is only allowed
     to hold it briefly. */
  it('serves a pinned version immutably and an unpinned one briefly', async () => {
    const me = await guest();
    await put(me.token, 'image/webp', webp());

    const pinned = await app.inject({ method: 'GET', url: `/api/avatars/${me.id}?v=1` });
    expect(pinned.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const loose = await app.inject({ method: 'GET', url: `/api/avatars/${me.id}` });
    expect(loose.headers['cache-control']).toBe('public, max-age=60');
  });

  it('reports zero for a player with no picture, and 404s the bytes', async () => {
    const me = await guest();
    const mine = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `ot_session=${me.token}` },
    });
    expect(mine.json().avatarV).toBe(0);
    expect((await app.inject({ method: 'GET', url: `/api/avatars/${me.id}` })).statusCode).toBe(404);
  });

  it('404s an id that is not a uuid rather than letting Postgres 500 it', async () => {
    const got = await app.inject({ method: 'GET', url: '/api/avatars/u-opp?v=1' });
    expect(got.statusCode).toBe(404);
  });

  it('puts the version on the seat at the table', async () => {
    const a = await guest();
    const b = await guest();
    await put(a.token, 'image/webp', webp());

    const connA = await connectWs(wsUrl, a.token);
    const connB = await connectWs(wsUrl, b.token);
    sockets.push(connA.ws, connB.ws);
    await connA.messages.wait((m) => m.t === 'hi');
    await connB.messages.wait((m) => m.t === 'hi');

    const id = await createMatchForPlayers([a.id, b.id], SHORT);
    matchIds.push(id);
    connA.ws.send(JSON.stringify({ t: 'join', m: id }));
    const state = await connA.messages.wait((m) => m.t === 'state');
    const view = state.s as TableView;

    expect(view.seats.find((s) => s.uid === a.id)?.avatarV).toBe(1);
    expect(view.seats.find((s) => s.uid === b.id)?.avatarV).toBe(0);
  });
});
