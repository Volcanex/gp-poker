import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.js';
import {
  getTicketById,
  getTickets,
  insertTicket,
  setTicketStatus,
  type TicketRow,
  type TicketTarget,
  type TicketViewport,
} from './db.js';
import { randomMatchId } from './matchmaking.js';
import { isUniqueViolation } from './pgError.js';

/* The admin layer: an annotation made on the running site becomes a ticket.
   Everything here is behind `requireAdmin`, which never mints a guest, so an
   unauthenticated call is a 403 rather than a new account that is then
   refused. Nothing in this file is reachable by anyone else, and nothing the
   game does reads any of it.

   The point of the shape is context. A note typed a day later cannot say what
   width the page was at, which elements were being pointed at or what was
   drawn over them, so all of that is stored beside the words. */

// A PNG data URL of the strokes layer at device pixel ratio. A viewport full
// of strokes at 2x lands well under this; the cap is what stops a page-sized
// bitmap arriving instead of a drawing.
export const MAX_DRAWING_BYTES = 1_500_000;
// Room for the drawing plus the note and the targets, so the refusal above is
// ours and carries a sentence, rather than Fastify's generic payload error.
const BODY_LIMIT = 4 * 1024 * 1024;

export const MAX_NOTE = 4000;
export const MAX_TITLE = 120;
export const MAX_TARGETS = 40;

/* One ticket a second per person. Not a defence against anything: it is what
   stops a stuck save button or a double submit from writing the same
   annotation twice. */
const MIN_INTERVAL_MS = 1000;
const lastTicketAt = new Map<string, number>();

// Test seam: the suite writes several tickets in a row as one admin, which is
// exactly what the limiter above exists to refuse.
export function clearTicketRate(): void {
  lastTicketAt.clear();
}

export type TicketStatus = 'open' | 'done';

interface TicketBody {
  url?: string;
  path?: string;
  note?: string;
  viewport?: Partial<TicketViewport>;
  targets?: TicketTarget[];
  drawing?: string | null;
  build?: string | null;
}

/* The note's first line is the title, so the person writing one types a
   sentence and gets a list that reads. A note that is one long line still
   gets a title, cut at MAX_TITLE. */
export function titleFor(note: string): string {
  const firstLine = note.split('\n')[0]?.trim() ?? '';
  const line = firstLine || note.trim();
  return line.slice(0, MAX_TITLE);
}

function cleanTargets(raw: unknown): TicketTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: TicketTarget[] = [];
  for (const item of raw.slice(0, MAX_TARGETS)) {
    const t = item as Partial<TicketTarget>;
    if (!t || typeof t.selector !== 'string') continue;
    const rect = t.rect ?? { x: 0, y: 0, width: 0, height: 0 };
    out.push({
      selector: t.selector.slice(0, 400),
      rect: {
        x: Math.round(Number(rect.x) || 0),
        y: Math.round(Number(rect.y) || 0),
        width: Math.round(Number(rect.width) || 0),
        height: Math.round(Number(rect.height) || 0),
      },
      text: typeof t.text === 'string' ? t.text.slice(0, 80) : '',
      label: typeof t.label === 'string' ? t.label.slice(0, 120) : null,
    });
  }
  return out;
}

function cleanViewport(raw: Partial<TicketViewport> | undefined): TicketViewport {
  return {
    width: Math.round(Number(raw?.width) || 0),
    height: Math.round(Number(raw?.height) || 0),
    dpr: Number(raw?.dpr) || 1,
    theme: typeof raw?.theme === 'string' ? raw.theme.slice(0, 20) : 'dark',
  };
}

function statusParam(raw: unknown): TicketStatus | null {
  return raw === 'open' || raw === 'done' ? raw : null;
}

// The drawing is stored as it arrives, so the one thing worth checking is
// that it is a PNG data URL and not a link to somewhere else.
function cleanDrawing(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('data:image/png;base64,')) return null;
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

export function registerAdminRoutes(app: FastifyInstance): void {
  app.post<{ Body: TicketBody }>(
    '/api/tickets',
    { bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const user = await requireAdmin(request, reply);
      if (!user) return reply;

      const body = request.body ?? {};
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
      if (!note) return reply.code(400).send({ error: 'A ticket needs a note. Write what is wrong and save again.' });

      const drawing = cleanDrawing(body.drawing);
      if (drawing && Buffer.byteLength(drawing, 'utf8') > MAX_DRAWING_BYTES) {
        return reply.code(413).send({
          error: 'The drawing is over 1.5 MB. Undo some strokes, or save the note without them.',
        });
      }

      const last = lastTicketAt.get(user.id) ?? 0;
      const now = Date.now();
      if (now - last < MIN_INTERVAL_MS) {
        return reply.code(429).send({ error: 'That ticket was a moment ago. Wait a second and save again.' });
      }
      lastTicketAt.set(user.id, now);

      const url = typeof body.url === 'string' ? body.url.slice(0, 2000) : '';
      const path = typeof body.path === 'string' ? body.path.slice(0, 500) : '/';
      const row = await allocateTicket({
        userId: user.id,
        url,
        path,
        title: titleFor(note),
        note,
        viewport: cleanViewport(body.viewport),
        targets: cleanTargets(body.targets),
        drawing,
        build: typeof body.build === 'string' ? body.build.slice(0, 60) : null,
      });
      return reply.code(201).send({ id: row.id });
    }
  );

  /* Newest first, and never the drawing: a list of twenty tickets would
     otherwise be twenty PNGs nobody is looking at. `?status=open` is the
     default view; anything unrecognised lists everything rather than
     erroring, which is the same bargain `?mode=` makes elsewhere. */
  app.get<{ Querystring: { status?: string } }>('/api/admin/tickets', async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    return getTickets(statusParam(request.query.status));
  });

  app.get<{ Params: { id: string } }>('/api/admin/tickets/:id', async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return reply;
    const row = await getTicketById(request.params.id);
    if (!row) return reply.code(404).send({ error: 'No such ticket' });
    return row;
  });

  app.patch<{ Params: { id: string }; Body: { status?: string } }>(
    '/api/admin/tickets/:id',
    async (request, reply) => {
      const user = await requireAdmin(request, reply);
      if (!user) return reply;
      const status = statusParam(request.body?.status);
      if (!status) return reply.code(400).send({ error: 'Status must be open or done' });
      const row = await setTicketStatus(request.params.id, status);
      if (!row) return reply.code(404).send({ error: 'No such ticket' });
      return { id: row.id, status: row.status };
    }
  );
}
