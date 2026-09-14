import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveSessionUser } from './auth.js';
import {
  getTicketById,
  getTickets,
  insertTicket,
  patchTicket,
  type GadminEdit,
  type GadminElement,
  type GadminReply,
  type GadminViewport,
  type TicketKind,
  type TicketListRow,
  type TicketRow,
  type TicketScope,
  type TicketSeverity,
  type TicketSource,
  type TicketStatus,
} from './db.js';
import { randomMatchId } from './matchmaking.js';
import { isUniqueViolation } from './pgError.js';
import { config } from './config.js';

/* The g-admin overlay's ticket API (agents/g-admin-contract.md at the repo
   root). This file is a TypeScript port of the contract's reference server
   (g-system's `packages/g-admin/server/gadmin.py`), backed here by the
   existing Postgres `tickets` table rather than that file's own SQLite, and
   gated by this project's own admin session rather than a seed-style
   `core/api/admin.py`. See `../db/CLAUDE.md` for the migration that added
   the columns this reads.

   Nothing here writes to source. Every saved annotation or edit becomes a
   ticket; a baking agent applies it afterwards, guided by `/brief`, then
   PATCHes the ticket to `baked`. */

const STATUSES: TicketStatus[] = ['open', 'baked', 'dismissed'];
const SCOPES: TicketScope[] = ['page', 'site'];
const KINDS: TicketKind[] = ['edit', 'bug', 'visual', 'content', 'idea'];
const SEVERITIES: TicketSeverity[] = ['critical', 'major', 'minor', 'polish'];
const SOURCES: TicketSource[] = ['human', 'agent'];

// Straight from the contract's ticket schema ("html <=10k chars", "drawing
// ... <=1.5MB"). Over-cap is a 400, not a silent truncation: the client
// enforces these before sending, the server's job is to refuse.
const MAX_ELEMENT_HTML = 10_000;
const MAX_SELECTOR = 1000;
// The contract calls dom_path "the full untruncated path" on purpose, so
// this is a defensive ceiling against abuse, not a length anyone expects a
// real selector chain to approach.
const MAX_DOM_PATH = 20_000;
const MAX_DRAWING_CHARS = 1_500_000;
const MAX_NOTE_CHARS = 20_000;
const MAX_REPLY_CHARS = 20_000;
const MAX_URL = 2000;
const MAX_PATH = 500;
const MAX_TITLE = 300;
const MAX_ELEMENTS = 40;
const MAX_EDITS = 100;

// One ticket per second, project-wide, exactly as the reference server: a
// stuck-button guard, not abuse protection (the auth gate is that).
const RATE_MS = 1000;
let lastCreateAt = 0;

export function clearTicketRate(): void {
  lastCreateAt = 0;
}

// ---------------------------------------------------------------- auth --

const NONE = 0;
const TOKEN = 1;
const FULL = 2;

async function isAdminCookie(request: FastifyRequest): Promise<boolean> {
  const user = await resolveSessionUser(request);
  return user?.admin === true;
}

// Checked with a constant-time compare so a leaked-token guess cannot be
// timed byte by byte, the same reasoning as password verification.
function tokenOk(request: FastifyRequest): boolean {
  const expected = process.env.GADMIN_TOKEN;
  if (!expected) return false;
  const header = request.headers['x-gadmin-token'];
  const supplied = Array.isArray(header) ? header[0] : header;
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Low to high, but TOKEN is not "below" FULL in a read/write sense - it is a
// narrower slice (GET everywhere, PATCH status/reply only), never a weaker
// version of FULL. Ordering them this way just keeps `level === NONE` and
// `level !== FULL` checks readable.
async function authLevel(request: FastifyRequest): Promise<number> {
  if (await isAdminCookie(request)) return FULL;
  if (tokenOk(request)) return TOKEN;
  return NONE;
}

function requireRead(level: number, reply: FastifyReply): boolean {
  if (level === NONE) {
    reply.code(401).send({ error: 'admin only' });
    return false;
  }
  return true;
}

// ------------------------------------------------------------- shaping --

// The contract's element/edit shape, snake_case, is what the client sends
// and what the brief and gcommand's tickets panel read. `db.ts` stores both
// camelCase (see the comment on GadminElement/GadminEdit there), so these
// are where the two shapes meet.
interface ContractElement {
  selector: string;
  dom_path: string;
  html: string;
  rect: { x: number; y: number; w: number; h: number };
}

interface ContractEdit {
  selector: string;
  prop: string;
  from: string | null;
  to: string | null;
  token_from: string | null;
  token_to: string | null;
}

/* The wire shape the contract's ticket JSON declares, assembled from the
   table's flat `url`/`path`/`title` and the `targets` column (kept under its
   old name - see db.ts). Top-level keys are snake_case because that is what
   the contract, the g-admin client and gcommand's tickets panel all read. */
interface ContractTicket {
  id: string;
  created_at: string;
  updated_at: string;
  status: TicketStatus;
  scope: TicketScope;
  kind: TicketKind;
  severity: TicketSeverity;
  page: { url: string; path: string; title: string };
  viewport: GadminViewport;
  elements: ContractElement[];
  edits: ContractEdit[];
  note: string;
  drawing?: string | null;
  replies: GadminReply[];
  source: TicketSource;
  baked_by: string | null;
}

function toContractElement(e: GadminElement): ContractElement {
  return { selector: e.selector, dom_path: e.domPath, html: e.html, rect: e.rect };
}

function toContractEdit(e: GadminEdit): ContractEdit {
  return { selector: e.selector, prop: e.prop, from: e.from, to: e.to, token_from: e.tokenFrom, token_to: e.tokenTo };
}

function toContractTicket(row: TicketListRow | TicketRow): ContractTicket {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    status: row.status,
    scope: row.scope,
    kind: row.kind,
    severity: row.severity,
    page: { url: row.url, path: row.path, title: row.title },
    viewport: row.viewport,
    elements: row.targets.map(toContractElement),
    edits: row.edits.map(toContractEdit),
    note: row.note,
    replies: row.replies,
    source: row.source,
    baked_by: row.bakedBy,
    ...('drawing' in row ? { drawing: row.drawing } : {}),
  };
}

function statusParam(raw: unknown): TicketStatus | null {
  return typeof raw === 'string' && (STATUSES as string[]).includes(raw) ? (raw as TicketStatus) : null;
}

// ------------------------------------------------------------ creating --

interface TicketCreateBody {
  scope?: unknown;
  kind?: unknown;
  severity?: unknown;
  page?: { url?: unknown; path?: unknown; title?: unknown };
  viewport?: { w?: unknown; h?: unknown; dpr?: unknown; theme?: unknown };
  elements?: unknown;
  edits?: unknown;
  note?: unknown;
  drawing?: unknown;
  source?: unknown;
}

function cleanViewport(raw: TicketCreateBody['viewport']): GadminViewport {
  return {
    w: Math.round(Number(raw?.w) || 0),
    h: Math.round(Number(raw?.h) || 0),
    dpr: Number(raw?.dpr) || 1,
    theme: typeof raw?.theme === 'string' ? raw.theme.slice(0, 20) : 'dark',
  };
}

// Input is the contract's snake_case wire shape; output is db.ts's
// camelCase storage shape (see the comment on GadminElement there). Over-cap
// is a string (the caller turns it into a 400) rather than a truncation.
function cleanElements(raw: unknown): GadminElement[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'elements must be an array';
  if (raw.length > MAX_ELEMENTS) return `elements exceeds ${MAX_ELEMENTS}`;
  const out: GadminElement[] = [];
  for (const item of raw) {
    const e = item as Partial<ContractElement>;
    if (typeof e?.selector !== 'string' || e.selector.length === 0) return 'each element needs a selector';
    if (e.selector.length > MAX_SELECTOR) return `an element selector exceeds ${MAX_SELECTOR} chars`;
    const domPath = typeof e.dom_path === 'string' ? e.dom_path : '';
    if (domPath.length > MAX_DOM_PATH) return `an element dom_path exceeds ${MAX_DOM_PATH} chars`;
    const html = typeof e.html === 'string' ? e.html : '';
    if (html.length > MAX_ELEMENT_HTML) return `an element html snippet exceeds ${MAX_ELEMENT_HTML} chars`;
    const rect = e.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    out.push({
      selector: e.selector,
      domPath,
      html,
      rect: {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        w: Number(rect.w) || 0,
        h: Number(rect.h) || 0,
      },
    });
  }
  return out;
}

function cleanEdits(raw: unknown): GadminEdit[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'edits must be an array';
  if (raw.length > MAX_EDITS) return `edits exceeds ${MAX_EDITS}`;
  const out: GadminEdit[] = [];
  for (const item of raw) {
    const e = item as Partial<ContractEdit>;
    if (typeof e?.selector !== 'string' || typeof e?.prop !== 'string') return 'each edit needs a selector and a prop';
    out.push({
      selector: e.selector.slice(0, MAX_SELECTOR),
      prop: e.prop.slice(0, 100),
      from: typeof e.from === 'string' ? e.from.slice(0, 200) : null,
      to: typeof e.to === 'string' ? e.to.slice(0, 200) : null,
      tokenFrom: typeof e.token_from === 'string' ? e.token_from.slice(0, 50) : null,
      tokenTo: typeof e.token_to === 'string' ? e.token_to.slice(0, 50) : null,
    });
  }
  return out;
}

function cleanDrawing(raw: unknown): string | null | string[] {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || !raw.startsWith('data:image/png;base64,')) return ['drawing must be a PNG data URL'];
  if (raw.length > MAX_DRAWING_CHARS) return [`drawing exceeds ${MAX_DRAWING_CHARS} chars`];
  return raw;
}

async function allocateTicket(
  fields: Omit<Parameters<typeof insertTicket>[0], 'id'>
): Promise<TicketRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await insertTicket({ id: randomMatchId(), ...fields });
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique ticket id');
}

// -------------------------------------------------------------- brief --

/* Modeled on the reference server's `_render_brief`: an agent-ready markdown
   document with everything a baking session needs and nothing it has to go
   fetch separately. */
function renderBrief(t: ContractTicket): string {
  const lines: string[] = [
    `# g-admin ticket #${t.id} - ${t.status}`,
    '',
    `- **Scope:** ${t.scope}  **Kind:** ${t.kind}  **Severity:** ${t.severity}  **Source:** ${t.source}`,
    `- **Page:** \`${t.page.path}\` (${t.page.url})${t.page.title ? ` - "${t.page.title}"` : ''}`,
    `- **Viewport:** ${t.viewport.w}x${t.viewport.h} @${t.viewport.dpr} (${t.viewport.theme})`,
    `- **Created:** ${t.created_at}  **Updated:** ${t.updated_at}`,
    '',
    '## Note',
    '',
    t.note || '_(no note)_',
  ];

  if (t.elements.length > 0) {
    lines.push('', '## Elements', '');
    t.elements.forEach((el, i) => {
      lines.push(`### ${i + 1}. \`${el.selector}\``);
      if (el.dom_path) lines.push(`- dom_path: \`${el.dom_path}\``);
      const r = el.rect;
      lines.push(`- rect: x=${r.x} y=${r.y} w=${r.w} h=${r.h}`);
      if (el.html) lines.push('', '```html', el.html, '```');
      lines.push('');
    });
  }

  if (t.edits.length > 0) {
    lines.push(
      '## Edits',
      '',
      '| selector | prop | from | to | token from | token to |',
      '|---|---|---|---|---|---|'
    );
    for (const e of t.edits) {
      lines.push(
        `| \`${e.selector}\` | ${e.prop} | ${e.from ?? ''} | ${e.to ?? ''} | ${e.token_from ?? ''} | ${e.token_to ?? ''} |`
      );
    }
    lines.push('');
  }

  if (t.replies.length > 0) {
    lines.push('## Replies', '');
    for (const r of t.replies) lines.push(`- **${r.by}** (${r.at}): ${r.text}`);
    lines.push('');
  }

  lines.push(
    '---',
    `Baked by: ${t.baked_by ?? '(not yet baked)'}`,
    'PATCH this ticket’s status to `baked` with a reply describing the commit once the change lands in source.'
  );
  return lines.join('\n');
}

// ------------------------------------------------------------- routes --

export function registerGadminRoutes(app: FastifyInstance): void {
  app.get('/api/gadmin/verify', async (request, reply) => {
    if (!(await isAdminCookie(request))) return reply.code(401).send({ error: 'admin only' });
    return { admin: true };
  });

  app.get<{ Querystring: { status?: string } }>('/api/gadmin/tickets', async (request, reply) => {
    const level = await authLevel(request);
    if (!requireRead(level, reply)) return reply;
    const status = statusParam(request.query.status);
    const rows = await getTickets(status);
    return { tickets: rows.map(toContractTicket) };
  });

  app.post<{ Body: TicketCreateBody }>('/api/gadmin/tickets', async (request, reply) => {
    const level = await authLevel(request);
    if (level !== FULL) return reply.code(level === NONE ? 401 : 403).send({ error: 'cookie auth only' });
    const user = await resolveSessionUser(request);
    if (!user) return reply.code(401).send({ error: 'admin only' });

    const now = Date.now();
    if (now - lastCreateAt < RATE_MS) {
      return reply.code(429).send({ error: 'one ticket per second - try again shortly' });
    }

    const body = request.body ?? {};
    if (!SCOPES.includes(body.scope as TicketScope)) return reply.code(400).send({ error: 'scope must be page or site' });
    if (!KINDS.includes(body.kind as TicketKind)) {
      return reply.code(400).send({ error: 'kind must be edit, bug, visual, content or idea' });
    }
    if (!SEVERITIES.includes(body.severity as TicketSeverity)) {
      return reply.code(400).send({ error: 'severity must be critical, major, minor or polish' });
    }
    const source: TicketSource = SOURCES.includes(body.source as TicketSource) ? (body.source as TicketSource) : 'human';
    const note = typeof body.note === 'string' ? body.note.slice(0, MAX_NOTE_CHARS) : '';

    const elements = cleanElements(body.elements);
    if (typeof elements === 'string') return reply.code(400).send({ error: elements });
    const edits = cleanEdits(body.edits);
    if (typeof edits === 'string') return reply.code(400).send({ error: edits });
    const drawing = cleanDrawing(body.drawing);
    if (Array.isArray(drawing)) return reply.code(400).send({ error: drawing[0] });

    lastCreateAt = now;
    const row = await allocateTicket({
      userId: user.id,
      url: typeof body.page?.url === 'string' ? body.page.url.slice(0, MAX_URL) : '',
      path: typeof body.page?.path === 'string' ? body.page.path.slice(0, MAX_PATH) : '/',
      title: typeof body.page?.title === 'string' ? body.page.title.slice(0, MAX_TITLE) : '',
      scope: body.scope as TicketScope,
      kind: body.kind as TicketKind,
      severity: body.severity as TicketSeverity,
      viewport: cleanViewport(body.viewport),
      targets: elements,
      edits,
      note,
      drawing,
      source,
    });
    return reply.code(201).send(toContractTicket(row));
  });

  app.get<{ Params: { id: string } }>('/api/gadmin/tickets/:id', async (request, reply) => {
    const level = await authLevel(request);
    if (!requireRead(level, reply)) return reply;
    const row = await getTicketById(request.params.id);
    if (!row) return reply.code(404).send({ error: 'ticket not found' });
    return toContractTicket(row);
  });

  app.patch<{ Params: { id: string }; Body: { status?: unknown; reply?: unknown; note?: unknown } }>(
    '/api/gadmin/tickets/:id',
    async (request, reply) => {
      const level = await authLevel(request);
      if (level === NONE) return reply.code(401).send({ error: 'admin only' });

      const body = request.body ?? {};
      if (level === TOKEN && body.note !== undefined) {
        return reply.code(403).send({ error: 'token auth may only change status (+ reply), not note' });
      }
      let status: TicketStatus | undefined;
      if (body.status !== undefined) {
        const parsed = statusParam(body.status);
        if (parsed === null) return reply.code(400).send({ error: 'status must be open, baked or dismissed' });
        status = parsed;
      }
      const replyText = typeof body.reply === 'string' ? body.reply.slice(0, MAX_REPLY_CHARS) : undefined;
      const note = level === FULL && typeof body.note === 'string' ? body.note.slice(0, MAX_NOTE_CHARS) : undefined;
      if (status === undefined && replyText === undefined && note === undefined) {
        return reply.code(400).send({ error: 'nothing to update' });
      }

      const row = await patchTicket(request.params.id, {
        status,
        note,
        appendReply: replyText !== undefined ? { at: new Date().toISOString(), by: level === TOKEN ? 'agent' : 'human', text: replyText } : undefined,
        bakedBy: level === TOKEN ? 'agent' : 'human',
      });
      if (!row) return reply.code(404).send({ error: 'ticket not found' });
      return toContractTicket(row);
    }
  );

  app.get<{ Params: { id: string } }>('/api/gadmin/tickets/:id/brief', async (request, reply) => {
    const level = await authLevel(request);
    if (!requireRead(level, reply)) return reply;
    const row = await getTicketById(request.params.id);
    if (!row) return reply.code(404).send({ error: 'ticket not found' });
    reply.type('text/markdown');
    return renderBrief(toContractTicket(row));
  });

  // Public, no auth: the "unbaked edits survive reload" layer. Empty unless
  // this project turns it on. Cache-Control: no-store already lands on every
  // /api/* response via buildApp's onSend hook.
  app.get('/api/gadmin/overrides.css', async (request, reply) => {
    reply.type('text/css');
    if (config.gadminReapply !== true) return '';
    const rows = await getTickets('open');
    const chunks: string[] = [];
    for (const row of rows) {
      const rules: string[] = [];
      for (const e of row.edits) {
        const selector = e.selector.trim();
        const prop = e.prop.trim();
        const value = e.tokenTo ? `var(${e.tokenTo})` : e.to;
        if (!selector || !prop || !value) continue;
        rules.push(`${selector} { ${prop}: ${value}; }`);
      }
      if (rules.length > 0) chunks.push(`/* g-admin ticket #${row.id} */\n${rules.join('\n')}`);
    }
    return chunks.length > 0 ? `${chunks.join('\n\n')}\n` : '';
  });
}
