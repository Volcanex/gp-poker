import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClientMsg, ServerMsg, UserSummary } from '@opentable/protocol';
import { api } from './api.ts';
import type { Me } from './types.ts';
import { socket } from './socket.ts';
import type { ConnState } from './socket.ts';

export interface QueueState {
  s: 'idle' | 'searching' | 'found' | 'left';
  since: number;
  range?: number;
  w?: number;
  m?: string;
}

/* The match this browser last saw itself seated at. Remembered so a reload
   can offer the way back; verified against the server before it is trusted,
   because a match that finished while the tab was closed is not a match to
   return to. */
const LIVE_MATCH_KEY = 'ot-live-match';

function readLiveMatch(): string | null {
  try {
    return localStorage.getItem(LIVE_MATCH_KEY);
  } catch {
    return null;
  }
}

function writeLiveMatch(id: string | null) {
  try {
    if (id) localStorage.setItem(LIVE_MATCH_KEY, id);
    else localStorage.removeItem(LIVE_MATCH_KEY);
  } catch {
    /* private mode: the offer is a convenience, not state worth failing over */
  }
}

interface Session {
  me: Me | null;
  setMe: (u: UserSummary) => void;
  refreshMe: () => Promise<void>;
  liveMatch: string | null;
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
  const [me, setMeState] = useState<Me | null>(null);
  const [liveMatch, setLiveMatch] = useState<string | null>(null);
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
        setMeState(u);
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

  const refreshMe = useCallback(async () => {
    try {
      setMeState(await api.me());
    } catch {
      /* the rating on screen goes stale rather than the page breaking */
    }
  }, []);

  useEffect(() => socket.onState(setConn), []);

  /* A remembered match is only offered once the server confirms it is still
     playing. */
  useEffect(() => {
    const id = readLiveMatch();
    if (!id) return;
    let live = true;
    api
      .match(id)
      .then((m) => {
        if (!live) return;
        if (m.status === 'playing') setLiveMatch(id);
        else writeLiveMatch(null);
      })
      .catch(() => writeLiveMatch(null));
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () =>
      socket.onMessage((m: ServerMsg) => {
        if (m.t === 'hi') setMeState((prev) => (prev ? { ...prev, ...m.u } : null));
        else if (m.t === 'state' && m.s.you != null) {
          writeLiveMatch(m.s.m);
          setLiveMatch(m.s.m);
        } else if (m.t === 'end') {
          writeLiveMatch(null);
          setLiveMatch(null);
          /* The match just moved the rating, and the top bar is showing the
             value from before it. */
          void refreshMe();
        } else if (m.t === 'q') {
          setQueue((prev) => ({
            s: m.s,
            since: m.s === 'searching' && prev.s === 'searching' ? prev.since : Date.now(),
            range: m.range,
            w: m.w,
            m: m.m,
          }));
        }
      }),
    [refreshMe],
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

  /* Claim and login return a UserSummary; the counts on Me are unchanged by
     either, so the summary is merged over what is already there. */
  const setMe = useCallback((u: UserSummary) => {
    setMeState((prev) => (prev ? { ...prev, ...u } : { ...u, peak: u.rating, matches: 0, wins: 0, losses: 0, draws: 0 }));
  }, []);

  const value = useMemo(
    () => ({ me, setMe, refreshMe, liveMatch, ready, offline, conn, queue, send, startQueue, cancelQueue, clearFound }),
    [me, setMe, refreshMe, liveMatch, ready, offline, conn, queue, send, startQueue, cancelQueue, clearFound],
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
