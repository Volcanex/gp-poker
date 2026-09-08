import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { formatFor } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser } from './helpers.js';
import { sql } from '../src/db.js';
import { clearMetaCache, clearSitemapCache, escapeHtml, LEARN_SLUGS, SITE_DESCRIPTION } from '../src/meta.js';
/* The one place the server's copy of the lesson list is checked against the
   client's. The titles are duplicated on purpose (the server bundle has no
   business importing a client module), so this import exists to make the
   duplication fail loudly rather than drift quietly. */
import { LESSONS } from '../../client/src/routes/learn/lessons.ts';

/* What a pasted link shows. These are match rows rather than played matches:
   what is under test is the head the first response carries, not the engine
   that filled the table. */

const tag = randomBytes(4).toString('hex');
const id = (name: string) => `${name}-${tag}`;

function seat(n: number, userId: string, name: string, bot = false) {
  return { seat: n, userId, name, rating: 1500, bot };
}

function title(html: string): string | null {
  return html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? null;
}

function meta(html: string, attr: 'name' | 'property', key: string): string | null {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`);
  return html.match(re)?.[1] ?? null;
}

/* Enough of an XML check to catch the ways a hand-built document goes wrong:
   unbalanced or crossed tags, and text that was never escaped. */
function assertWellFormedXml(body: string): void {
  expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const stack: string[] = [];
  const rest = body.slice(body.indexOf('?>') + 2);
  for (const [tagText, close, name] of rest.matchAll(/<(\/?)([a-zA-Z][\w:.-]*)[^>]*>/g)) {
    if (close === '/') expect(stack.pop()).toBe(name);
    else if (!tagText.endsWith('/>')) stack.push(name);
  }
  expect(stack).toEqual([]);
  const text = rest.replace(/<[^>]*>/g, '');
  expect(text).not.toMatch(/<|>/);
  expect(text.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toMatch(/&/);
}

describe('link previews and crawl basics', () => {
  let app: FastifyInstance;
  const userIds: string[] = [];
  const matchIds: string[] = [];
  const challengeIds: string[] = [];
  const gameIds: string[] = [];
  let winner: { id: string; name: string };
  let loser: { id: string; name: string };
  let sharp: { id: string; name: string };
  const finished = id('meta-finished');
  const live = id('meta-live');
  const challenge = id('meta-challenge');
  const lobby = id('meta-lobby');
  const cancelled = id('meta-cancelled');
  // Names are validated to letters, digits and underscore on the way in, so
  // this row can only be made here. The escaping is what stops a name that
  // got in another way (a migration, a fixture, a future rule) from writing
  // markup into everybody's head.
  const rudeName = `Rude<b>${tag}`;

  beforeAll(async () => {
    app = await makeApp();
    winner = await mintGuestSession(app);
    loser = await mintGuestSession(app);
    userIds.push(winner.id, loser.id);

    const sharpId = randomUUID();
    await sql`
      insert into users (id, name, name_lower, guest)
      values (${sharpId}, ${rudeName}, ${rudeName.toLowerCase()}, false)
    `;
    sharp = { id: sharpId, name: rudeName };
    userIds.push(sharpId);

    matchIds.push(finished, live);
    await sql`
      insert into matches (id, format, rated, seats, status, winner, reason, hands_played, finished_at)
      values (
        ${finished},
        ${sql.json({ ...formatFor('heads-up', true) } as never)},
        true,
        ${sql.json([seat(0, winner.id, winner.name), seat(1, sharp.id, sharp.name)] as never)},
        'finished',
        ${winner.id},
        'hands',
        25,
        now()
      )
    `;
    await sql`
      insert into matches (id, format, rated, seats, status, hands_played)
      values (
        ${live},
        ${sql.json({ ...formatFor('heads-up', false) } as never)},
        false,
        ${sql.json([seat(0, winner.id, winner.name), seat(1, loser.id, loser.name)] as never)},
        'playing',
        6
      )
    `;
    await sql`
      insert into hands (id, match_id, number, seed_hash, seed, button, stacks_start, board, result, completed_at)
      values (
        ${`${finished}-1`},
        ${finished},
        1,
        'deadbeef',
        'a-seed',
        0,
        ${sql.json([200, 200] as never)},
        ${['Ah', 'Kd', '7c']},
        ${sql.json({ pots: [], awards: [{ seat: 0, amount: 42 }], shown: {} } as never)},
        now()
      )
    `;

    gameIds.push(lobby, cancelled);
    for (const [gameId, status] of [[lobby, 'open'], [cancelled, 'cancelled']] as const) {
      await sql`
        insert into home_games (id, host_id, rated, bot_level, status, expires_at)
        values (${gameId}, ${winner.id}, true, 3, ${status}, now() + interval '1 day')
      `;
    }
    for (const seated of [winner.id, loser.id]) {
      await sql`insert into home_game_seats (game_id, user_id) values (${lobby}, ${seated})`;
    }

    challengeIds.push(challenge);
    await sql`
      insert into challenges (id, creator_id, mode, rated, expires_at)
      values (${challenge}, ${winner.id}, 'heads-up', true, now() + interval '1 day')
    `;

    clearMetaCache();
    clearSitemapCache();
  });

  afterAll(async () => {
    for (const g of gameIds) await sql`delete from home_games where id = ${g}`;
    for (const c of challengeIds) await sql`delete from challenges where id = ${c}`;
    for (const m of matchIds) await sql`delete from matches where id = ${m}`;
    for (const u of userIds) await deleteUser(u);
    await app.close();
  });

  async function shell(url: string): Promise<{ status: number; html: string }> {
    const res = await app.inject({ method: 'GET', url });
    expect(res.headers['content-type']).toMatch(/text\/html/);
    return { status: res.statusCode, html: res.body };
  }

  it('gives the home page the site title and description', async () => {
    const { status, html } = await shell('/');
    expect(status).toBe(200);
    expect(title(html)).toBe('Open Table');
    expect(meta(html, 'name', 'description')).toBe(escapeHtml(SITE_DESCRIPTION));
    expect(meta(html, 'property', 'og:site_name')).toBe('Open Table');
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
    // One title and one description, not the shell's plus the injected one.
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<meta name="description"/g)).toHaveLength(1);
    // The shell is still the built app, not a page of meta tags.
    expect(html).toMatch(/<div id="root">/);
  });

  it('points every page at the card image, absolutely and with its size', async () => {
    for (const url of ['/', `/m/${finished}`, '/learn/rules']) {
      const { html } = await shell(url);
      expect(meta(html, 'property', 'og:image')).toMatch(/^https?:\/\/[^/]+\/og\.png$/);
      expect(meta(html, 'name', 'twitter:image')).toBe(meta(html, 'property', 'og:image'));
      expect(meta(html, 'property', 'og:image:width')).toBe('1200');
      expect(meta(html, 'property', 'og:image:height')).toBe('630');
    }
  });

  /* The card image and the mark ship in client/public, which the client build
     copies to the root of the served directory. Asserted on disk rather than
     over HTTP because the served directory under test is whatever CLIENT_DIST
     points at, which is a build somebody else made; a link in the head to a
     file that was never committed unfurls as a blank space. */
  it('ships the icons and the card image the head points at', async () => {
    const dir = new URL('../../client/public/', import.meta.url);
    for (const file of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'og.png']) {
      expect([file, existsSync(new URL(file, dir))]).toEqual([file, true]);
    }
    // Cards are fetched by every client that unfurls the link, so the image
    // stays small enough to be one round trip.
    expect(statSync(new URL('og.png', dir)).size).toBeLessThan(150 * 1024);
  });

  // '/' has no file route of its own any more, so the uptime check that asks
  // for the head of the home page has to be answered here.
  it('answers a HEAD of the home page', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('titles a finished match with its result and escapes the names', async () => {
    const { status, html } = await shell(`/m/${finished}`);
    expect(status).toBe(200);
    expect(title(html)).toBe(`Match: ${winner.name} beat Rude&lt;b&gt;${tag}, 25 hands, Open Table`);
    expect(meta(html, 'property', 'og:title')).toBe(`Match: ${winner.name} beat Rude&lt;b&gt;${tag}, 25 hands`);
    expect(meta(html, 'name', 'description')).toMatch(/Heads-up, rated/);
    expect(meta(html, 'property', 'og:url')).toMatch(new RegExp(`/m/${finished}$`));
    // The one thing that must never happen: a name that reaches the head as
    // markup rather than as text.
    expect(html).not.toContain('Rude<b>');
    expect(html).toContain(`Rude&lt;b&gt;${tag}`);
  });

  it('says a live match is live', async () => {
    const { html } = await shell(`/m/${live}`);
    expect(title(html)).toBe(`${winner.name} and ${loser.name}, live now, Open Table`);
    expect(meta(html, 'name', 'description')).toMatch(/Heads-up, casual\. On hand 7 right now/);
  });

  it('titles a hand with its number and puts the board in the description', async () => {
    const { html } = await shell(`/m/${finished}/h/1`);
    expect(title(html)).toBe(`Hand 1, ${winner.name} vs Rude&lt;b&gt;${tag}, Open Table`);
    expect(meta(html, 'name', 'description')).toMatch(/^Board Ah Kd 7c\. .* won 42\./);
  });

  it('titles a profile with the player name', async () => {
    const { html } = await shell(`/u/${winner.name}`);
    expect(title(html)).toBe(`${winner.name}, Open Table`);
    expect(meta(html, 'name', 'description')).toMatch(/No finished matches yet/);
  });

  it('says who is challenging you', async () => {
    const { html } = await shell(`/c/${challenge}`);
    expect(title(html)).toBe(`Play ${winner.name}, Open Table`);
    expect(meta(html, 'name', 'description')).toBe(
      `${winner.name} wants to play you heads-up, rated. Open the link and you are at the table: no signup, no money, no chips to buy.`
    );
  });

  it('invites you to a home game, and says when the table is gone', async () => {
    // The possessive comes back as an entity, which is what escaping the head
    // means: every reader of a title decodes it, and nothing else has to know
    // which characters a name may hold.
    const own = `Join ${escapeHtml(`${winner.name}'s`)} home game, Open Table`;
    const open = await shell(`/g/${lobby}`);
    expect(title(open.html)).toBe(own);
    expect(meta(open.html, 'name', 'description')).toBe(
      'Six-max, rated. 2 of 6 seats taken, empty seats filled by level 3 bots.'
    );
    const gone = await shell(`/g/${cancelled}`);
    expect(title(gone.html)).toBe(own);
    expect(meta(gone.html, 'name', 'description')).toBe('This table was cancelled.');
  });

  it('gives a static page its own title', async () => {
    const { html } = await shell('/learn/rules');
    expect(title(html)).toBe('How a hand plays, Open Table');
    expect(meta(html, 'property', 'og:type')).toBe('article');
    const leaderboard = await shell('/leaderboard');
    expect(title(leaderboard.html)).toBe('Leaderboard, Open Table');
    expect(meta(leaderboard.html, 'property', 'og:type')).toBe('website');
  });

  it('falls back to the plain shell for an id nobody has, still 200', async () => {
    for (const url of ['/m/no-such-match', '/m/no-such-match/h/3', '/u/nobody', '/c/no-such-link', '/g/no-such-table', '/nothing/here']) {
      const { status, html } = await shell(url);
      expect(status).toBe(200);
      expect(title(html)).toBe('Open Table');
      expect(meta(html, 'name', 'description')).toBe(escapeHtml(SITE_DESCRIPTION));
    }
  });

  it('serves robots.txt with the sitemap on it', async () => {
    const res = await app.inject({ method: 'GET', url: '/robots.txt', headers: { host: 'poker.example' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toContain('User-agent: *');
    expect(res.body).toContain('Allow: /');
    expect(res.body).toContain('Sitemap: http://poker.example/sitemap.xml');
  });

  it('serves a well-formed sitemap with the static pages and a known match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
      headers: { host: 'poker.example', 'x-forwarded-proto': 'https' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    assertWellFormedXml(res.body);
    expect(res.body).toContain('<loc>https://poker.example/</loc>');
    expect(res.body).toContain('<loc>https://poker.example/leaderboard</loc>');
    expect(res.body).toContain(`<loc>https://poker.example/m/${finished}</loc>`);
    // A guest and a match still being played are not pages worth crawling.
    expect(res.body).not.toContain(`/m/${live}`);
    expect(res.body).not.toContain(`/u/${winner.name}`);
  });

  it('escapes every character that could close a tag or an attribute', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;'
    );
  });

  it('has a meta entry for every lesson the client ships', () => {
    expect(LEARN_SLUGS).toEqual(LESSONS.map((l) => l.slug));
  });
});
