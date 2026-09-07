import type { ClientMsg, ServerMsg } from '@opentable/protocol';

export type ConnState = 'idle' | 'connecting' | 'open' | 'waiting';
type MsgListener = (m: ServerMsg) => void;
type StateListener = (s: ConnState) => void;

const PING_MS = 20_000;
const BACKOFF_MIN = 500;
const BACKOFF_MAX = 8_000;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/* One socket for the whole app. Opened only once the session cookie exists, so
   a server that is not reachable never turns into a reconnect storm: the
   session layer simply never calls open(). */
export class Socket {
  private ws: WebSocket | null = null;
  private msgListeners = new Set<MsgListener>();
  private stateListeners = new Set<StateListener>();
  private pingTimer: number | undefined;
  private retryTimer: number | undefined;
  private attempt = 0;
  private wanted = false;
  private queue: ClientMsg[] = [];

  state: ConnState = 'idle';

  open() {
    if (this.wanted) return;
    this.wanted = true;
    this.connect();
  }

  close() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.setState('idle');
  }

  /* Sends are buffered while the socket is down; the server refuses anything
     stale on arrival, so a replayed act is rejected rather than misapplied. */
  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (this.wanted) this.queue.push(msg);
  }

  onMessage(fn: MsgListener): () => void {
    this.msgListeners.add(fn);
    return () => this.msgListeners.delete(fn);
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(s: ConnState) {
    if (this.state === s) return;
    this.state = s;
    this.stateListeners.forEach((fn) => fn(s));
  }

  private connect() {
    if (!this.wanted) return;
    clearTimeout(this.retryTimer);
    this.setState(this.attempt === 0 ? 'connecting' : 'waiting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setState('open');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_MS) as unknown as number;
      const pending = this.queue;
      this.queue = [];
      pending.forEach((m) => this.send(m));
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      this.msgListeners.forEach((fn) => fn(msg));
    };

    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      this.retry();
    };

    /* onclose always follows onerror; swallowing it here keeps a failed
       connect out of the console as an unhandled event. */
    ws.onerror = () => {};
  }

  private retry() {
    if (!this.wanted) return;
    this.setState('waiting');
    const base = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** this.attempt);
    this.attempt += 1;
    const wait = base * (0.7 + Math.random() * 0.6);
    this.retryTimer = setTimeout(() => this.connect(), wait) as unknown as number;
  }
}

export const socket = new Socket();
