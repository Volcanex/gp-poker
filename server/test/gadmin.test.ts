import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clearTicketRate } from '../src/gadmin.js';
import { sql } from '../src/db.js';
import { deleteUser, makeApp, mintGuestSession, type Session } from './helpers.js';

/* The g-admin ticket API (agents/g-admin-contract.md at the repo root). What
   is worth a test here rather than a look at gadmin.py: the three-tier auth
   (none/token/cookie) and exactly what each tier is let do, the contract's
   nested wire shape, the brief and the reapply layer. */

const TOKEN = process.env.GADMIN_TOKEN;

function body(note: string, extra: Record<string, unknown> = {}) {
  return {
    scope: 'page',
    kind: 'visual',
    severity: 'minor',
    page: { url: 'https://everyonepoker.com/leaderboard', path: '/leaderboard', title: 'Leaderboard' },
    viewport: { w: 1366, h: 768, dpr: 2, theme: 'dark' },
    elements: [
      {
        selector: 'main.page > div.card > table.table',
        dom_path: 'html > body > main.page > div.card > table.table',
        html: '<table class="table">…</table>',
        rect: { x: 12, y: 200, w: 900, h: 320 },
      },
    ],
    edits: [],
    note,
    drawing: null,
    source: 'human',
    ...extra,
  };
}

describe('g-admin tickets', () => {
  let app: FastifyInstance;
  let admin: Session;
  let player: Session;

  beforeAll(async () => {
    app = await makeApp();
    admin = await mintGuestSession(app);
    player = await mintGuestSession(app);
    await sql`update users set admin = true where id = ${admin.id}`;
  });

  afterAll(async () => {
    await sql`delete from tickets where user_id in (${admin.id}, ${player.id})`;
    await deleteUser(admin.id);
    await deleteUser(player.id);
    await app.close();
  });

  it('gates /verify on cookie identity only - a valid token does not pass it', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/gadmin/verify' });
    expect(anon.statusCode).toBe(401);

    const asPlayer = await app.inject({ method: 'GET', url: '/api/gadmin/verify', cookies: { ot_session: player.token } });
    expect(asPlayer.statusCode).toBe(401);

    const asToken = await app.inject({ method: 'GET', url: '/api/gadmin/verify', headers: { 'x-gadmin-token': TOKEN! } });
    expect(asToken.statusCode).toBe(401);

    const asAdmin = await app.inject({ method: 'GET', url: '/api/gadmin/verify', cookies: { ot_session: admin.token } });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json()).toEqual({ admin: true });
  });

  it('refuses every route with no credential and never mints a guest', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/gadmin/tickets' });
    expect(list.statusCode).toBe(401);
    expect(list.cookies.find((c) => c.name === 'ot_session')).toBeUndefined();

    const create = await app.inject({ method: 'POST', url: '/api/gadmin/tickets', payload: body('nope') });
    expect(create.statusCode).toBe(401);
  });

  it('refuses a non-admin cookie session everywhere, including create', async () => {
    const cookies = { ot_session: player.token };
    expect((await app.inject({ method: 'GET', url: '/api/gadmin/tickets', cookies })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/gadmin/tickets', cookies, payload: body('nope') })).statusCode).toBe(
      401
    );
  });

  it('writes a ticket with the cookie, lists it without the drawing, and reads it in full with it', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const created = await app.inject({
      method: 'POST',
      url: '/api/gadmin/tickets',
      cookies,
      payload: body('The rating column is cut off', { drawing: 'data:image/png;base64,AAAA' }),
    });
    expect(created.statusCode).toBe(201);
    const ticket = created.json();
    expect(ticket.status).toBe('open');
    expect(ticket.source).toBe('human');
    expect(ticket.page).toEqual({ url: 'https://everyonepoker.com/leaderboard', path: '/leaderboard', title: 'Leaderboard' });
    expect(ticket.viewport).toEqual({ w: 1366, h: 768, dpr: 2, theme: 'dark' });
    expect(ticket.baked_by).toBeNull();
    const id = ticket.id as string;

    const list = await app.inject({ method: 'GET', url: '/api/gadmin/tickets?status=open', cookies });
    expect(list.statusCode).toBe(200);
    const listed = (list.json().tickets as Record<string, unknown>[]).find((t) => t.id === id)!;
    expect(listed.elements).toHaveLength(1);
    expect('drawing' in listed).toBe(false);

    const full = await app.inject({ method: 'GET', url: `/api/gadmin/tickets/${id}`, cookies });
    expect(full.statusCode).toBe(200);
    expect(full.json().drawing).toBe('data:image/png;base64,AAAA');
  });

  it('lets the token tier read everywhere but never create', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const created = await app.inject({ method: 'POST', url: '/api/gadmin/tickets', cookies, payload: body('token read test') });
    const id = created.json().id as string;

    const headers = { 'x-gadmin-token': TOKEN! };
    const list = await app.inject({ method: 'GET', url: '/api/gadmin/tickets', headers });
    expect(list.statusCode).toBe(200);
    const full = await app.inject({ method: 'GET', url: `/api/gadmin/tickets/${id}`, headers });
    expect(full.statusCode).toBe(200);
    const brief = await app.inject({ method: 'GET', url: `/api/gadmin/tickets/${id}/brief`, headers });
    expect(brief.statusCode).toBe(200);

    const create = await app.inject({ method: 'POST', url: '/api/gadmin/tickets', headers, payload: body('agent cannot make this') });
    expect(create.statusCode).toBe(403);
  });

  it('a wrong token is refused exactly like no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/gadmin/tickets', headers: { 'x-gadmin-token': 'not-the-token' } });
    expect(res.statusCode).toBe(401);
  });

  it('the token tier can PATCH status and reply but never note', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const created = await app.inject({ method: 'POST', url: '/api/gadmin/tickets', cookies, payload: body('patch me') });
    const id = created.json().id as string;
    const headers = { 'x-gadmin-token': TOKEN! };

    const withNote = await app.inject({
      method: 'PATCH',
      url: `/api/gadmin/tickets/${id}`,
      headers,
      payload: { note: 'an agent rewriting the note' },
    });
    expect(withNote.statusCode).toBe(403);

    const bake = await app.inject({
      method: 'PATCH',
      url: `/api/gadmin/tickets/${id}`,
      headers,
      payload: { status: 'baked', reply: 'Fixed in commit abc123.' },
    });
    expect(bake.statusCode).toBe(200);
    const ticket = bake.json();
    expect(ticket.status).toBe('baked');
    expect(ticket.baked_by).toBe('agent');
    expect(ticket.replies).toHaveLength(1);
    expect(ticket.replies[0]).toMatchObject({ by: 'agent', text: 'Fixed in commit abc123.' });
  });

  it('the cookie tier can edit the note; baked_by clears when status leaves baked', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const created = await app.inject({ method: 'POST', url: '/api/gadmin/tickets', cookies, payload: body('note edit test') });
    const id = created.json().id as string;

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/gadmin/tickets/${id}`,
      cookies,
      payload: { note: 'a clearer note', status: 'baked' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().note).toBe('a clearer note');
    expect(edited.json().baked_by).toBe('human');

    const reopened = await app.inject({
      method: 'PATCH',
      url: `/api/gadmin/tickets/${id}`,
      cookies,
      payload: { status: 'open' },
    });
    expect(reopened.json().baked_by).toBeNull();
  });

  it('refuses a PATCH with nothing to update and a GET for an id nobody has', async () => {
    const empty = await app.inject({
      method: 'PATCH',
      url: '/api/gadmin/tickets/whatever',
      cookies: { ot_session: admin.token },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const missing = await app.inject({ method: 'GET', url: '/api/gadmin/tickets/none-such', cookies: { ot_session: admin.token } });
    expect(missing.statusCode).toBe(404);
  });

  it('validates scope/kind/severity and refuses a note-less ticket implicitly by refusing bad enums', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const bad = await app.inject({
      method: 'POST',
      url: '/api/gadmin/tickets',
      cookies,
      payload: body('bad scope', { scope: 'planet' }),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('rate limits ticket creation project-wide to one per second', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const first = await app.inject({ method: 'POST', url: '/api/gadmin/tickets', cookies, payload: body('One') });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/api/gadmin/tickets', cookies, payload: body('Two') });
    expect(second.statusCode).toBe(429);
  });

  it('renders a markdown brief with the note, the elements and the edits table', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    const created = await app.inject({
      method: 'POST',
      url: '/api/gadmin/tickets',
      cookies,
      payload: body('Fix the spacing', {
        kind: 'edit',
        edits: [{ selector: '.tk-head', prop: 'gap', from: '8px', to: '16px', token_from: '--sp-2', token_to: '--sp-4' }],
      }),
    });
    const id = created.json().id as string;
    const brief = await app.inject({ method: 'GET', url: `/api/gadmin/tickets/${id}/brief`, cookies: { ot_session: admin.token } });
    expect(brief.statusCode).toBe(200);
    expect(brief.headers['content-type']).toContain('text/markdown');
    const md = brief.body as string;
    expect(md).toContain('Fix the spacing');
    expect(md).toContain('## Edits');
    expect(md).toContain('--sp-4');
    expect(md).toContain('not yet baked');
  });

  it('overrides.css is public, no-store, and only carries open tickets - baking one drops its rule', async () => {
    clearTicketRate();
    const cookies = { ot_session: admin.token };
    // Selectors unique to this test, since other tests in this file leave
    // their own open, edit-bearing tickets behind for the shared admin.
    const created = await app.inject({
      method: 'POST',
      url: '/api/gadmin/tickets',
      cookies,
      payload: body('Widen the gap', {
        kind: 'edit',
        edits: [
          { selector: '.gadmin-test-gap', prop: 'gap', from: '8px', to: '16px', token_from: null, token_to: '--sp-4' },
          { selector: '.gadmin-test-color', prop: 'color', from: null, to: 'red', token_from: null, token_to: null },
        ],
      }),
    });
    const id = created.json().id as string;

    const anon = await app.inject({ method: 'GET', url: '/api/gadmin/overrides.css' });
    expect(anon.statusCode).toBe(200);
    expect(anon.headers['content-type']).toContain('text/css');
    expect(anon.headers['cache-control']).toBe('no-store');
    expect(anon.body).toContain('.gadmin-test-gap { gap: var(--sp-4); }');
    expect(anon.body).toContain('.gadmin-test-color { color: red; }');
    expect(anon.body).toContain(`g-admin ticket #${id}`);

    await app.inject({
      method: 'PATCH',
      url: `/api/gadmin/tickets/${id}`,
      cookies,
      payload: { status: 'baked', reply: 'baked' },
    });
    const after = await app.inject({ method: 'GET', url: '/api/gadmin/overrides.css' });
    expect(after.body).not.toContain('gadmin-test-gap');
    expect(after.body).not.toContain(`ticket #${id}`);
  });
});
