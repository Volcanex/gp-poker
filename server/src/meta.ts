import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  getChallengeById,
  getHandsForMatch,
  getMatchById,
  getRatingsFor,
  getUserById,
  getUserByNameLower,
  MODES,
  sql,
  type MatchRow,
  type RatingRow,
} from './db.js';
import { statusOf } from './challenges.js';

/* What a pasted link shows.

   The client renders every page in the browser, so a crawler, a chat client
   unfurling a link and the first paint all see whatever the built index.html
   says: one title and one description for the whole site. This module reads
   that shell once at boot and, per request, swaps in a title and a set of
   meta tags that are true of the page being asked for.

   The client's own useTitle stays: it is what changes the tab as somebody
   moves around a session. This is what the first response carries.

   Nothing here may fail a page. An unknown id, a name nobody has, a database
   that is having a moment: all of them fall back to the generic shell with a
   200, and the SPA renders its own not-found. */

export const SITE_NAME = 'Open Table';

// The one description the site has when a page has nothing more specific to
// say. Kept identical to the tag in client/index.html so the shell reads the
// same whether it was injected or served untouched.
export const SITE_DESCRIPTION =
  "Free ranked no-limit hold'em, heads-up or six handed. No money, no ads, no rake.";

export interface PageMeta {
  // The page's own name. Null on the home page, where the product name is the
  // whole title. The product name is appended here, the way ui/title.ts
  // appends it in the client, so it is spelled in one place.
  title: string | null;
  description: string;
  type: 'website' | 'article';
}

const DEFAULT_META: PageMeta = { title: null, description: SITE_DESCRIPTION, type: 'website' };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* The lessons, mirrored from client/src/routes/learn/lessons.ts. The client
   list is JSX-adjacent and the server bundle has no business importing it, so
   the titles live here too; server/test/meta.test.ts compares the two lists
   and fails if a lesson is added, renamed or removed on one side only. */
const LEARN_PAGES: { slug: string; title: string; description: string }[] = [
  { slug: 'rules', title: 'How a hand plays', description: 'The deal, the blinds, the four streets and the showdown.' },
  { slug: 'hands', title: 'Hand rankings', description: 'Royal flush down to high card, and the kicker rule that settles ties.' },
  { slug: 'positions', title: 'Position', description: 'Who acts when, heads-up and six handed, and why acting last is worth so much.' },
  { slug: 'odds', title: 'Pot odds and outs', description: 'Counting outs, the rule of two and four, and the price the pot is offering.' },
  { slug: 'ranges', title: 'Ranges', description: 'The 169 starting hands, the grid everyone draws them on, and the baseline chart this site scores against.' },
  { slug: 'rating', title: 'How the rating works', description: 'Glicko-2 in plain words: 1500, the deviation, and why six-max is one rating period.' },
  { slug: 'fair', title: 'Provably fair', description: 'The deck is committed to before it is dealt, and you can check it afterwards.' },
  { slug: 'formats', title: 'The two formats', description: 'Heads-up best of 25, the six-max sit-and-go, the clock, and practice against bots.' },
];

export const STATIC_PAGES: Record<string, PageMeta> = {
  '/': DEFAULT_META,
  '/leaderboard': {
    title: 'Leaderboard',
    description: 'The top 100 by rating in each mode. A player joins the board once their deviation settles.',
    type: 'website',
  },
  '/watch': {
    title: 'Watch',
    description: 'Every table being played right now, and the hand it is on. Any match can be watched from the rail.',
    type: 'website',
  },
  '/learn': {
    title: 'Learn',
    description: 'Eight short pages, in order, from never having played to how the rating and the shuffle work.',
    type: 'website',
  },
  '/puzzles': {
    title: 'Puzzles',
    description: 'Four questions a day: who wins the showdown, what to do before the flop, the price the pot is offering, and a decision somebody actually faced here.',
    type: 'website',
  },
  '/puzzles/showdown': {
    title: 'Who wins',
    description: 'Two hands and a board, settled by the same evaluator that settles pots at the table.',
    type: 'website',
  },
  '/puzzles/preflop': {
    title: 'Preflop puzzles',
    description: 'A hand, a position and a stack depth. Play it the way the baseline chart would.',
    type: 'website',
  },
  '/puzzles/hand': {
    title: 'From a real hand',
    description: 'A preflop decision somebody actually faced here, replayed to the moment it was made.',
    type: 'website',
  },
  '/tools': {
    title: 'Tools',
    description: 'A range explorer and a pot odds trainer, both running entirely in your browser.',
    type: 'website',
  },
  '/tools/ranges': {
    title: 'Range explorer',
    description: 'Paint a range on the 13 by 13 grid, read it back as notation, and run any hand against it.',
    type: 'website',
  },
  '/tools/odds': {
    title: 'Pot odds trainer',
    description: 'A spot and a price. Call or fold, then see the equity, the outs and what the call needed.',
    type: 'website',
  },
  ...Object.fromEntries(
    LEARN_PAGES.map((l) => [`/learn/${l.slug}`, { title: l.title, description: l.description, type: 'article' as const }])
  ),
};

export const LEARN_SLUGS = LEARN_PAGES.map((l) => l.slug);

// ---- the shell ----

let shellHtml: string | null = null;

/* Reads the built index.html once and strips the two tags that are replaced
   per request, so a request only has to insert. A shell that cannot be read
   (no client build) leaves this null and the caller serves the file the way
   it always did, which keeps that failure as loud as it was. */
export async function loadShell(clientDist: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(clientDist, 'index.html'), 'utf8');
    shellHtml = raw
      .replace(/[ \t]*<title>[\s\S]*?<\/title>\n?/i, '')
      .replace(/[ \t]*<meta\s+name="description"[^>]*>\n?/i, '');
    return true;
  } catch {
    shellHtml = null;
    return false;
  }
}

export function shellLoaded(): boolean {
  return shellHtml !== null;
}

/* One card image for the whole site: the wordmark and what the site is. It
   is the same picture on every page because the alternative is rendering one
   per match, and a card that says "Open Table" under a title that already
   says who beat whom is the honest version of that. Absolute, because a
   crawler is not required to resolve a relative one. Rendered from
   client/public/favicon.svg and shipped in client/public. */
const OG_IMAGE = { path: '/og.png', width: 1200, height: 630 };

export function renderShell(meta: PageMeta, origin: string, pathname: string): string {
  if (shellHtml === null) throw new Error('shell not loaded');
  const title = meta.title ? `${meta.title}, ${SITE_NAME}` : SITE_NAME;
  const image = escapeHtml(`${origin}${OG_IMAGE.path}`);
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title ?? SITE_NAME)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:url" content="${escapeHtml(`${origin}${pathname}`)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(`${SITE_NAME}: free ranked poker`)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('\n    ');
  return shellHtml.replace('</head>', `  ${tags}\n  </head>`);
}

// ---- per-page meta ----

/* A shared link that goes round a chat is the same URL fetched by every
   client that unfurls it, so the lookup behind it is cached for long enough
   to absorb that burst and short enough that a match finishing changes the
   preview almost at once. Bounded by insertion order, like the insights
   cache: a process that runs for weeks cannot keep every id it was shown. */
const META_TTL_MS = 10_000;
const META_CACHE_MAX = 500;
const metaCache = new Map<string, { at: number; meta: PageMeta }>();

async function cached(key: string, build: () => Promise<PageMeta | null>): Promise<PageMeta> {
  const now = Date.now();
  const hit = metaCache.get(key);
  if (hit && now - hit.at < META_TTL_MS) return hit.meta;
  let meta: PageMeta;
  try {
    meta = (await build()) ?? DEFAULT_META;
  } catch {
    // A preview is never worth a failed page: the SPA still renders.
    meta = DEFAULT_META;
  }
  metaCache.delete(key);
  metaCache.set(key, { at: now, meta });
  while (metaCache.size > META_CACHE_MAX) {
    const oldest = metaCache.keys().next().value;
    if (oldest === undefined) break;
    metaCache.delete(oldest);
  }
  return meta;
}

export function clearMetaCache(): void {
  metaCache.clear();
}

// Ids are short and names are capped at 20 characters, so anything longer is
// not a row anybody can have: refuse it here rather than in the database.
const MAX_ID = 64;

export async function metaForPath(pathname: string): Promise<PageMeta> {
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const table = STATIC_PAGES[clean];
  if (table) return table;

  const seg = clean.split('/').filter((s) => s.length > 0);
  const tooLong = seg.some((s) => s.length > MAX_ID);
  if (tooLong) return DEFAULT_META;

  if (seg[0] === 'm' && seg.length === 2) return cached(`m:${seg[1]}`, () => matchMeta(seg[1]));
  if (seg[0] === 'm' && seg.length === 4 && seg[2] === 'h') {
    const number = Number(seg[3]);
    if (!Number.isInteger(number) || number < 1) return DEFAULT_META;
    return cached(`h:${seg[1]}:${number}`, () => handMeta(seg[1], number));
  }
  if (seg[0] === 'u' && seg.length === 2) return cached(`u:${seg[1].toLowerCase()}`, () => userMeta(seg[1]));
  if (seg[0] === 'c' && seg.length === 2) return cached(`c:${seg[1]}`, () => challengeMeta(seg[1]));
  return DEFAULT_META;
}

const MODE_NAME: Record<string, string> = { 'heads-up': 'Heads-up', 'six-max': 'Six-max' };

function modeName(mode: string): string {
  return MODE_NAME[mode] ?? mode;
}

// Rated, casual and practice are three different things and a preview that
// says which is the difference between a result meaning something and not.
function stakeWord(match: MatchRow): string {
  if (match.format.practice === true) return 'practice';
  return match.rated ? 'rated' : 'casual';
}

function listNames(names: string[]): string {
  if (names.length === 0) return 'nobody';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

function handsWord(n: number): string {
  return n === 1 ? '1 hand' : `${n} hands`;
}

async function matchMeta(id: string): Promise<PageMeta | null> {
  const match = await getMatchById(id);
  if (!match) return null;
  const names = match.seats.map((s) => s.name);
  const where = `${modeName(match.format.mode)}, ${stakeWord(match)}.`;

  if (match.status === 'playing') {
    return {
      title: `${listNames(names)}, live now`,
      description: `${where} On hand ${match.handsPlayed + 1} right now. Watch it from the rail, every hand face up as it is shown down.`,
      type: 'website',
    };
  }

  if (match.status === 'aborted') {
    return {
      title: `${listNames(names)}, unfinished`,
      description: `${where} This match was abandoned before it finished, so it changed nobody's rating.`,
      type: 'website',
    };
  }

  const winner = match.winner ? match.seats.find((s) => s.userId === match.winner) : null;
  const outcome = winner
    ? match.seats.length === 2
      ? `${winner.name} beat ${match.seats.find((s) => s.userId !== match.winner)?.name ?? 'their opponent'}`
      : `${winner.name} won`
    : `${listNames(names)} drew`;
  return {
    title: `Match: ${outcome}, ${handsWord(match.handsPlayed)}`,
    description: `${where} ${outcome} after ${handsWord(match.handsPlayed)}. Every hand can be replayed action by action, with the seed it was dealt from.`,
    type: 'website',
  };
}

async function handMeta(id: string, number: number): Promise<PageMeta | null> {
  const match = await getMatchById(id);
  if (!match) return null;
  const hands = await getHandsForMatch(id);
  const hand = hands.find((h) => h.number === number);
  if (!hand) return null;

  const names = match.seats.map((s) => s.name);
  const title = `Hand ${number}, ${match.seats.length === 2 ? names.join(' vs ') : listNames(names)}`;
  if (hand.completedAt === null || !hand.result) {
    return { title, description: `${modeName(match.format.mode)}, ${stakeWord(match)}. This hand is still being played.`, type: 'website' };
  }

  // Awards are stored in table seats, the same space as match.seats, so the
  // winning seat maps straight onto a name.
  const best = hand.result.awards.reduce<{ seat: number; amount: number } | null>(
    (top, a) => (top === null || a.amount > top.amount ? { seat: a.seat, amount: a.amount } : top),
    null
  );
  const winner = best ? (match.seats.find((s) => s.seat === best.seat)?.name ?? null) : null;
  const board = hand.board.length > 0 ? `Board ${hand.board.join(' ')}.` : 'No flop.';
  const took = winner ? ` ${winner} won ${best?.amount}.` : '';
  return {
    title,
    description: `${board}${took} Replay it action by action and check the shuffle against the seed it was dealt from.`,
    type: 'website',
  };
}

function standing(mode: string, row: RatingRow): string | null {
  if (row.matches === 0) return null;
  return `${modeName(mode).toLowerCase()} ${Math.round(row.rating)} over ${row.matches === 1 ? '1 match' : `${row.matches} matches`}`;
}

async function userMeta(name: string): Promise<PageMeta | null> {
  const user = await getUserByNameLower(name.toLowerCase());
  if (!user) return null;
  const ratings = await getRatingsFor(user.id);
  const standings = MODES.map((mode) => standing(mode, ratings[mode])).filter((s): s is string => s !== null);
  const who = user.bot ? `${user.name} is a bot at level ${user.botLevel ?? '?'}` : `${user.name} plays on ${SITE_NAME}`;
  const record =
    standings.length > 0
      ? `Rated ${standings.join(', ')}.`
      : 'No finished matches yet.';
  return {
    title: user.name,
    description: `${who}. ${record} Every match they have played has a page, with its hands and its shuffle.`,
    type: 'website',
  };
}

async function challengeMeta(id: string): Promise<PageMeta | null> {
  const row = await getChallengeById(id);
  if (!row) return null;
  const creator = await getUserById(row.creatorId);
  if (!creator) return null;
  const state = statusOf(row);
  const format = `${modeName(row.mode).toLowerCase()}, ${row.rated ? 'rated' : 'casual'}`;
  const description =
    state === 'open'
      ? `${creator.name} wants to play you ${format}. Open the link and you are at the table: no signup, no money, no chips to buy.`
      : state === 'accepted'
        ? `${creator.name} sent this link and somebody has already taken it.`
        : state === 'expired'
          ? `${creator.name} sent this link and it has expired. Links last a day.`
          : `${creator.name} sent this link and then cancelled it.`;
  return { title: `Play ${creator.name}`, description, type: 'website' };
}

// ---- crawl basics ----

/* One sitemap for the whole site, rebuilt at most every ten minutes: the
   pages in it move on the timescale of matches finishing, and a crawler that
   asks more often than that is asking for the same answer. Keyed by origin as
   well as by time, because the body is absolute URLs and the same process
   answers to more than one hostname in development. */
const SITEMAP_TTL_MS = 10 * 60 * 1000;
const SITEMAP_MATCHES = 500;
let sitemapCache: { at: number; origin: string; body: string } | null = null;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(origin: string, urlPath: string, lastmod: Date | null): string {
  const loc = xmlEscape(`${origin}${urlPath}`);
  const stamp = lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
  return `  <url>\n    <loc>${loc}</loc>${stamp}\n  </url>`;
}

/* The two queries the sitemap is made of. They live here rather than in db.ts
   because they are read-only, wanted by nothing else, and db.ts was being
   edited by another workstream while this was written; move them across when
   somebody is next in there.

   Ladder matches are left out for the same reason the feed leaves them out:
   they are real matches nobody played, and there are enough of them to be the
   entire sitemap. Guests and bots are left out of the user list: a guest is a
   throwaway row and a bot's page is reachable from the practice picker. */
async function sitemapMatches(limit: number): Promise<{ id: string; finishedAt: Date | null }[]> {
  return sql<{ id: string; finishedAt: Date | null }[]>`
    select id, finished_at from matches
    where status = 'finished'
      and format->>'ladder' is distinct from 'true'
    order by finished_at desc
    limit ${limit}
  `;
}

async function sitemapUsers(): Promise<{ name: string; lastSeenAt: Date }[]> {
  return sql<{ name: string; lastSeenAt: Date }[]>`
    select name, last_seen_at from users
    where bot = false and guest = false
    order by name asc
  `;
}

export async function buildSitemap(origin: string): Promise<string> {
  const matches = await sitemapMatches(SITEMAP_MATCHES);
  const users = await sitemapUsers();
  const entries = [
    ...Object.keys(STATIC_PAGES).map((p) => urlEntry(origin, p, null)),
    ...matches.map((m) => urlEntry(origin, `/m/${encodeURIComponent(m.id)}`, m.finishedAt)),
    ...users.map((u) => urlEntry(origin, `/u/${encodeURIComponent(u.name)}`, u.lastSeenAt)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

export function clearSitemapCache(): void {
  sitemapCache = null;
}

/* The absolute address of this site as the caller reached it: nginx
   terminates TLS, so Fastify's own view of the protocol is http on every
   request that matters. routes.ts reads the forwarded headers the same way
   for the challenge link it hands out; the two should become one helper the
   next time somebody is editing that file. */
function originOf(request: FastifyRequest): string {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const proto = first(request.headers['x-forwarded-proto'])?.split(',')[0]?.trim() || request.protocol;
  const host = first(request.headers['x-forwarded-host'])?.split(',')[0]?.trim() || request.headers.host;
  return `${proto}://${host}`;
}

/* The shell for whatever page was asked for, meta tags and all. Used by the
   not-found handler, which is where every client route lands: index.html is
   the only file in the build that is not a hashed asset, and it is served
   from here rather than from disk so a crawler is never handed the generic
   head. Cache-Control matches what @fastify/static would have set for it. */
export async function sendShell(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const pathname = (request.raw.url ?? '/').split('?')[0];
  const meta = await metaForPath(pathname);
  return reply
    .code(200)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-cache')
    .send(renderShell(meta, originOf(request), pathname));
}

export function registerCrawlRoutes(app: FastifyInstance): void {
  app.get('/robots.txt', async (request, reply) => {
    return reply
      .type('text/plain; charset=utf-8')
      .send(`User-agent: *\nAllow: /\n\nSitemap: ${originOf(request)}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', async (request, reply) => {
    const origin = originOf(request);
    const now = Date.now();
    if (!sitemapCache || sitemapCache.origin !== origin || now - sitemapCache.at > SITEMAP_TTL_MS) {
      sitemapCache = { at: now, origin, body: await buildSitemap(origin) };
    }
    return reply.type('application/xml; charset=utf-8').send(sitemapCache.body);
  });
}
