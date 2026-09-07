import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClientMsg, ServerMsg, UserSummary } from '@opentable/protocol';
import { api } from './api.ts';
import { socket } from './socket.ts';
import type { ConnState } from './socket.ts';

export interface QueueState {
  s: 'idle' | 'searching' | 'found' | 'left';
  since: number;
  range?: number;
  w?: number;
  m?: string;
}

interface Session {
  me: UserSummary | null;
  ready: boolean;
  offline: boolean;
  conn: ConnState;
  queue: QueueState;
  send: (m: ClientMsg) => void;
  startQueue: () => void;
  cancelQueue: () => void;
  clearFound: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<UserSummary | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [conn, setConn] = useState<ConnState>('idle');
  const [queue, setQueue] = useState<QueueState>({ s: 'idle', since: 0 });

  useEffect(() => {
    let live = true;
    api
      .me()
      .then((u) => {
        if (!live) return;
        setMe(u);
        setOffline(false);
        socket.open();
      })
      .catch(() => {
        if (live) setOffline(true);
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => socket.onState(setConn), []);

  useEffect(
    () =>
      socket.onMessage((m: ServerMsg) => {
        if (m.t === 'hi') setMe(m.u);
        else if (m.t === 'q') {
          setQueue((prev) => ({
            s: m.s,
            since: m.s === 'searching' && prev.s === 'searching' ? prev.since : Date.now(),
            range: m.range,
            w: m.w,
            m: m.m,
          }));
        }
      }),
    [],
  );

  const send = useCallback((m: ClientMsg) => socket.send(m), []);

  const startQueue = useCallback(() => {
    setQueue({ s: 'searching', since: Date.now() });
    socket.send({ t: 'queue' });
  }, []);

  const cancelQueue = useCallback(() => {
    setQueue({ s: 'idle', since: 0 });
    socket.send({ t: 'dequeue' });
  }, []);

  const clearFound = useCallback(() => setQueue({ s: 'idle', since: 0 }), []);

  const value = useMemo(
    () => ({ me, ready, offline, conn, queue, send, startQueue, cancelQueue, clearFound }),
    [me, ready, offline, conn, queue, send, startQueue, cancelQueue, clearFound],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession used outside SessionProvider');
  return s;
}

/* Subscribe to the server stream without re-subscribing on every render. */
export function useServerMsg(fn: (m: ServerMsg) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => socket.onMessage((m) => ref.current(m)), []);
}
