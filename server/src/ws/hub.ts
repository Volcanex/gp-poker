import type { WebSocket } from 'ws';
import type { FastifyRequest } from 'fastify';
import { encode, decodeClient, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@opentable/protocol';
import type { Mode } from '@opentable/protocol';
import { insertAuditLog, type RatingRow, type UserRow } from '../db.js';
import { toUserSummary } from '../userView.js';

// Connection registry keyed by user id. A user may have several sockets open
// at once (multiple tabs); every send fans out to all of them.
class Hub {
  private byUser = new Map<string, Set<WebSocket>>();
  // In-process players (bots) have no socket. They register a handler here
  // and `send` routes to it exactly as it would to a websocket, so nothing
  // upstream - rooms, matchmaking, the router - needs to know the difference.
  private virtual = new Map<string, (msg: ServerMsg) => void>();

  add(userId: string, socket: WebSocket): void {
    let set = this.byUser.get(userId);
    if (!set) {
      set = new Set();
      this.byUser.set(userId, set);
    }
    set.add(socket);
  }

  remove(userId: string, socket: WebSocket): void {
    const set = this.byUser.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.byUser.delete(userId);
  }

  attachVirtual(userId: string, handler: (msg: ServerMsg) => void): void {
    this.virtual.set(userId, handler);
  }

  isConnected(userId: string): boolean {
    return this.byUser.has(userId) || this.virtual.has(userId);
  }

  // Distinct people with at least one socket open, for the "N online" figure
  // on the home page. Virtual connections are bots and are deliberately not
  // counted: a bot is not somebody who is here.
  countHumans(): number {
    return this.byUser.size;
  }

  send(userId: string, msg: ServerMsg): void {
    const handler = this.virtual.get(userId);
    if (handler) {
      handler(msg);
      return;
    }
    const set = this.byUser.get(userId);
    if (!set) return;
    const raw = encode(msg);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }

  sendTo(socket: WebSocket, msg: ServerMsg): void {
    if (socket.readyState === socket.OPEN) socket.send(encode(msg));
  }
}

export const hub = new Hub();

export type ClientMsgHandler = (userId: string, msg: ClientMsg) => void;
export type DisconnectHandler = (userId: string) => void;

function firstForwardedIp(request: FastifyRequest): string | null {
  const fwd = request.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  if (first) return first.split(',')[0]?.trim() ?? null;
  return request.ip ?? null;
}

// Wires a raw websocket to the hub: registers it, sends `hi`, and dispatches
// everything but ping to onMessage. `queue`/`dequeue`/`join`/`leave`/`act`
// routing lives outside the hub (matchmaking and match rooms) so the hub
// itself never needs to know about either.
export function attachConnection(
  socket: WebSocket,
  request: FastifyRequest,
  user: UserRow,
  ratings: Record<Mode, RatingRow>,
  onMessage: ClientMsgHandler,
  onDisconnect: DisconnectHandler
): void {
  hub.add(user.id, socket);
  const ip = firstForwardedIp(request);
  insertAuditLog({ kind: 'connect', userId: user.id, ip }).catch(() => {});

  hub.sendTo(socket, { t: 'hi', v: PROTOCOL_VERSION, u: toUserSummary(user, ratings) });

  socket.on('message', (raw: Buffer) => {
    const msg = decodeClient(raw.toString());
    if (!msg) {
      hub.sendTo(socket, { t: 'err', c: 'bad_msg', msg: 'could not parse message' });
      return;
    }
    if (msg.t === 'ping') {
      hub.sendTo(socket, { t: 'pong' });
      return;
    }
    onMessage(user.id, msg);
  });

  socket.on('close', () => {
    hub.remove(user.id, socket);
    insertAuditLog({ kind: 'disconnect', userId: user.id, ip }).catch(() => {});
    if (!hub.isConnected(user.id)) onDisconnect(user.id);
  });
}
