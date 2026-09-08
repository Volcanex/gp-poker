import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clearTicketRate, MAX_DRAWING_BYTES } from '../src/admin.js';
import { sql } from '../src/db.js';
import { deleteUser, makeApp, mintGuestSession, type Session } from './helpers.js';

/* The admin layer. Two things are worth a test here rather than a look: that
   every route refuses a player who is not an admin, and that the size cap on
   the drawing is ours (a clear sentence) rather than Fastify's payload error.
   The rest is the list and the patch, which is the loop the tickets page is. */

const PNG = 'data:image/png;base64,';

// A data URL of `bytes` total length, which is what the cap is measured on.
function drawing(bytes: number): string {
  return PNG + 'A'.repeat(Math.max(0, bytes - PNG.length));
}

describe('admin tickets', () => {
  let app: FastifyInstance;
  let admin: Session;
  let player: Session;

  beforeAll(async () => {
    app = await makeApp();
    admin = await mintGuestSession(app);
    player = await mintGuestSession(app);
    // The live grant is in schema.sql, keyed to one id. A test makes its own
    // admin the same way the column is meant to be set: on the row.
    await sql`update users set admin = true where id = ${admin.id}`;
  });

  afterAll(async () => {
    await sql`delete from tickets where user_id in (${admin.id}, ${player.id})`;
    await deleteUser(admin.id);
    await deleteUser(player.id);
    await app.close();
  });

  const body = (note: string, extra: Record<string, unknown> = {}) => ({
    url: 'https://poker.gabrielpenman.com/leaderboard',
    path: '/leaderboard',
    note,
    viewport: { width: 1366, height: 768, dpr: 2, theme: 'dark' },
    targets: [
      {
        selector: 'main.page > div.card > table.table',
        rect: { x: 12, y: 200, width: 900, height: 320 },
        text: 'Player rating matches',
        label: null,
      },
    ],
    ...extra,
  });

  it('refuses every route to a player who is not an admin', async () => {
    const cookies = { ot_session: player.token };
    const post = await app.inject({ method: 'POST', url: '/api/tickets', cookies, payload: body('nope') });
    expect(post.statusCode).toBe(403);
    expect(post.json().error).toBe('Admin only');

    const list = await app.inject({ method: 'GET', url: '/api/admin/tickets', cookies });
    expect(list.statusCode).toBe(403);

    const one = await app.inject({ method: 'GET', url: '/api/admin/tickets/whatever', cookies });
    expect(one.statusCode).toBe(403);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tickets/whatever',
      cookies,
      payload: { status: 'done' },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('refuses an admin route with no session at all, without minting a guest', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/tickets' });
    expect(res.statusCode).toBe(403);
    expect(res.cookies.find((c) => c.name === 'ot_session')).toBeUndefined();
  });

  it('says admin on /api/me for an admin and says nothing at all for a player', async () => {
    const mine = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: admin.token } });
    expect(mine.json().admin).toBe(true);
    const theirs = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: player.token } });
    expect('admin' in theirs.json()).toBe(false);
  });

  it('writes a ticket, lists it without the drawing, and marks it done', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const created = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      cookies,
      payload: body('The rating column is cut off\nAt 1366 the last column clips.', {
        drawing: drawing(2000),
        build: 'abc123',
      }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(id).toBeTruthy();

    const list = await app.inject({ method: 'GET', url: '/api/admin/tickets?status=open', cookies });
    expect(list.statusCode).toBe(200);
    const row = (list.json() as Record<string, unknown>[]).find((t) => t.id === id)!;
    // The first line of the note is the title, so a list reads as sentences.
    expect(row.title).toBe('The rating column is cut off');
    expect(row.path).toBe('/leaderboard');
    expect(row.status).toBe('open');
    expect((row.targets as unknown[]).length).toBe(1);
    // The list is a list of titles, not of megabytes of strokes.
    expect('drawing' in row).toBe(false);

    const full = await app.inject({ method: 'GET', url: `/api/admin/tickets/${id}`, cookies });
    expect(full.statusCode).toBe(200);
    expect(full.json().drawing).toBe(drawing(2000));
    expect(full.json().viewport).toEqual({ width: 1366, height: 768, dpr: 2, theme: 'dark' });
    expect(full.json().build).toBe('abc123');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tickets/${id}`,
      cookies,
      payload: { status: 'done' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({ id, status: 'done' });

    const open = await app.inject({ method: 'GET', url: '/api/admin/tickets?status=open', cookies });
    expect((open.json() as { id: string }[]).some((t) => t.id === id)).toBe(false);
    const done = await app.inject({ method: 'GET', url: '/api/admin/tickets?status=done', cookies });
    expect((done.json() as { id: string }[]).some((t) => t.id === id)).toBe(true);
  });

  it('refuses a drawing over the cap, with a sentence rather than a payload error', async () => {
    clearTicketRate();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      cookies: { ot_session: admin.token },
      payload: body('Too much ink', { drawing: drawing(MAX_DRAWING_BYTES + 100) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toContain('1.5 MB');
  });

  it('refuses a note-less ticket and a second ticket in the same second', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const empty = await app.inject({ method: 'POST', url: '/api/tickets', cookies, payload: body('   ') });
    expect(empty.statusCode).toBe(400);

    const first = await app.inject({ method: 'POST', url: '/api/tickets', cookies, payload: body('One') });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/api/tickets', cookies, payload: body('Two') });
    expect(second.statusCode).toBe(429);
  });
});
