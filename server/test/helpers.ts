import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { formatFor, type MatchFormat, type MatchResult, type Mode, type Speed, type TableView } from '@opentable/protocol';
import { buildApp } from '../src/app.js';
import { sql } from '../src/db.js';

export async function makeApp(): Promise<FastifyInstance> {
  return buildApp();
}

export interface Session {
  token: string;
  id: string;
  name: string;
}

export async function mintGuestSession(app: FastifyInstance): Promise<Session> {
  const res = await app.inject({ method: 'GET', url: '/api/me' });
  const token = res.cookies.find((c) => c.name === 'ot_session')?.value;
  if (!token) throw new Error('no session cookie minted');
  const body = res.json();
  return { token, id: body.id, name: body.name };
}

export async function deleteUser(id: string): Promise<void> {
  await sql`delete from users where id = ${id}`;
}

export async function listenForWs(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}/ws`;
}

// The server sends `hi` the instant a connection opens, which on a fast
// loopback socket can be parsed together with the 101 response before an
// `await`-based caller gets a chance to attach a 'message' listener. This
// queue starts buffering the moment the socket is constructed (well before
// 'open') so nothing sent early is ever missed.
export class WsMessages {
  private queue: unknown[] = [];
  private waiters: { predicate: (msg: any) => boolean; settle: (msg: any) => void }[] = [];

  push(msg: unknown): void {
    const i = this.waiters.findIndex((w) => w.predicate(msg));
    if (i !== -1) {
      const [waiter] = this.waiters.splice(i, 1);
      waiter.settle(msg);
      return;
    }
    this.queue.push(msg);
  }

  wait(predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
    const i = this.queue.findIndex(predicate);
    if (i !== -1) {
      const [msg] = this.queue.splice(i, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const j = this.waiters.findIndex((w) => w.settle === settle);
        if (j !== -1) this.waiters.splice(j, 1);
        reject(new Error('timed out waiting for a matching message'));
      }, timeoutMs);
      const settle = (msg: any) => {
        clearTimeout(timer);
        resolve(msg);
      };
      this.waiters.push({ predicate, settle });
    });
  }
}

export function connectWs(url: string, token: string): Promise<{ ws: WebSocket; messages: WsMessages }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { cookie: `ot_session=${token}` } });
    const messages = new WsMessages();
    ws.on('message', (raw: Buffer) => messages.push(JSON.parse(raw.toString())));
    ws.once('open', () => resolve({ ws, messages }));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected response: ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

export interface Connected extends Session {
  ws: WebSocket;
  messages: WsMessages;
}

export async function connectSession(url: string, session: Session): Promise<Connected> {
  const { ws, messages } = await connectWs(url, session.token);
  return { ...session, ws, messages };
}

// A real format with the product's shape and whatever the test needs to
// change about it (a 300ms clock, a tiny stack, a one-hand cap). Built off
// formatFor so a new field on MatchFormat never has to be added by hand in
// five test files.
export function testFormat(overrides: Partial<MatchFormat> = {}): MatchFormat {
  const mode: Mode = overrides.mode ?? 'heads-up';
  const speed: Speed = overrides.speed ?? 'standard';
  /* An all-in run-out is paced for somebody to watch and a suite is not
     watching, so it is off unless a test asks for it, the same bargain the
     ladder makes. Nine seconds a hand of countdown is nine seconds a hand,
     and a suite that drives random play hits an all-in constantly.
     `runout.test.ts` sets its own tick and is where the pacing is proved. */
  return {
    ...formatFor(mode, overrides.rated ?? true, speed),
    runoutTickMs: 0,
    ...overrides,
  };
}


/* The other half of queueing, now that a matchmade table asks everybody at it
   to say they are there. Waits for the prompt and accepts it, which is what a
   test that only wants a table has to do on every seat. */
export async function acceptReady(conn: { ws: WebSocket; messages: WsMessages }, timeoutMs = 3000): Promise<void> {
  await conn.messages.wait((m) => m.t === 'ready' && m.s === 'pending', timeoutMs);
  conn.ws.send(JSON.stringify({ t: 'ready', a: true }));
}

/* Plays a seat with uniformly random legal actions until the match ends.
   Every client in a match runs one of these; whoever is not to act simply
   waits, and a player who has busted waits for `end` like a spectator.

   On a practice table this also answers the hold: a view with `hold: 'you'`
   has no legal action to take, and the table waits for `next` instead of
   dealing on by itself. Sending it here is what a real client does the
   moment it draws the button, so this plays a practice table to completion
   exactly like any other rather than hanging until the safety timeout. */
export async function driveRandomPlay(
  conn: { ws: WebSocket; messages: WsMessages },
  timeoutMs = 20_000,
  maxSteps = 4000
): Promise<MatchResult> {
  for (let step = 0; step < maxSteps; step++) {
    const msg = await conn.messages.wait(
      (m) => (m.t === 'state' && (m.s.legal !== null || m.s.hold === 'you')) || m.t === 'end',
      timeoutMs
    );
    if (msg.t === 'end') return msg.r as MatchResult;
    const view = msg.s as TableView;
    if (view.hold === 'you') {
      conn.ws.send(JSON.stringify({ t: 'next', m: view.m, h: view.h }));
      continue;
    }
    const legal = view.legal!;
    const action = legal.actions[Math.floor(Math.random() * legal.actions.length)];
    const payload: Record<string, unknown> = { t: 'act', m: view.m, h: view.h, n: view.n, a: action };
    if (action === 'b' || action === 'r') {
      payload.v = legal.min + Math.floor(Math.random() * (legal.max - legal.min + 1));
    }
    conn.ws.send(JSON.stringify(payload));
  }
  throw new Error('too many steps without reaching end');
}
