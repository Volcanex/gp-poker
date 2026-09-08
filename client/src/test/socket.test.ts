// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Socket } from '../net/socket.ts';

/* The server attaches its listener after the upgrade, so a message sent the
   instant the socket opens can vanish. The client must hold every send until
   the server's hello proves somebody is listening. */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  hello() {
    this.onmessage?.({ data: JSON.stringify({ t: 'hi', v: 2, u: {} }) });
  }
}

describe('socket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds sends until the server says hi, then flushes them in order', () => {
    const socket = new Socket();
    socket.open();
    const ws = FakeWebSocket.instances[0];
    socket.send({ t: 'join', m: 'abc' });
    ws.open();
    expect(ws.sent).toEqual([]);
    expect(socket.state).toBe('connecting');
    socket.send({ t: 'leave', m: 'abc' });
    ws.hello();
    expect(socket.state).toBe('open');
    expect(ws.sent.map((s) => JSON.parse(s).t)).toEqual(['join', 'leave']);
    socket.send({ t: 'ping' });
    expect(ws.sent).toHaveLength(3);
    socket.close();
  });

  it('holds again after a drop until the next hello', () => {
    const socket = new Socket();
    socket.open();
    const first = FakeWebSocket.instances[0];
    first.open();
    first.hello();
    first.close();
    socket.send({ t: 'join', m: 'abc' });
    expect(first.sent).toEqual([]);
    socket.close();
  });
});
