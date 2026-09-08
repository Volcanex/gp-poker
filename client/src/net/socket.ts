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
  /* True once the server's hello has arrived. The server attaches its message
     listener only after the upgrade and its session lookups, so anything sent
     the instant the socket opens can land on nobody and vanish. Every send
     waits for `hi`, which is the one message that proves the other end is
     listening. */
  private ready = false;

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
    this.ready = false;
    this.queue = [];
    this.setState('idle');
  }

  /* Sends are buffered while the socket is down or not yet opened; the server
     refuses anything stale on arrival, so a replayed act is rejected rather
     than misapplied. A page opened straight onto a match asks to join before
     the session has finished loading and called open(), and that join has to
     survive until it does. Only an explicit close() drops the queue. */
  send(msg: ClientMsg) {
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
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
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_MS) as unknown as number;
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'hi' && !this.ready && this.ws === ws) {
        this.ready = true;
        this.setState('open');
        const pending = this.queue;
        this.queue = [];
        pending.forEach((m) => this.send(m));
      }
      this.msgListeners.forEach((fn) => fn(msg));
    };

    ws.onclose = () => {
      clearInterval(this.pingTimer);
      this.ready = false;
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
