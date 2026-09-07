import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { sql } from '../src/db.js';

export async function makeApp(): Promise<FastifyInstance> {
  return buildApp();
}

export async function mintGuestSession(app: FastifyInstance): Promise<{ token: string; id: string; name: string }> {
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
