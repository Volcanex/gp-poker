import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClientMsg, Mode, ServerMsg, UserSummary } from '@opentable/protocol';
import { api } from './api.ts';
import type { Me } from './types.ts';
import { socket } from './socket.ts';
import type { ConnState } from './socket.ts';

export interface QueueState {
  s: 'idle' | 'searching' | 'found' | 'left';
  since: number;
  mode: Mode;
  rated: boolean;
  practice?: boolean; // a table of bots, asked for by level, never rated
  range?: number;
  w?: number;
  seated?: number; // players gathered so far for a multiway table
  m?: string;
  /* Why the last search stopped, when it stopped for a reason worth reading:
     every bot near the level asked for is in a match. Cleared by the next
     search rather than by a dismiss, because starting one is the answer. */
  error?: string;
}

/* What the player last chose to play, so the picker opens where they left it
   and "play again" means the same thing they just played. */
export interface PlayChoice {
  mode: Mode;
  rated: boolean;
}

const CHOICE_KEY = 'ot-play-choice';
const DEFAULT_CHOICE: PlayChoice = { mode: 'heads-up', rated: true };

/* Null until something has actually been played: the picker must not claim a
   mode was played last on a first visit. */
export function readPlayChoice(): PlayChoice | null {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PlayChoice>;
    const mode: Mode = v.mode === 'six-max' ? 'six-max' : 'heads-up';
    return { mode, rated: v.rated !== false };
  } catch {
    return null;
  }
}

function writePlayChoice(c: PlayChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {
    /* private mode: the picker forgets, which is not worth failing over */
  }
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

/* Who else is at the match this browser is seated at, as one readable string.
   Derived rather than stored: the seats are on every `state` and on the match
   row, so there is nothing here that could go stale against them. */
export function opponentNames(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

interface Session {
  me: Me | null;
  setMe: (u: UserSummary) => void;
  refreshMe: () => Promise<void>;
  liveMatch: string | null;
  /* The other seats at `liveMatch`, for the pill in the top bar. Null whenever
     `liveMatch` is. */
  liveOpponents: string | null;
  ready: boolean;
  offline: boolean;
  conn: ConnState;
  queue: QueueState;
  send: (m: ClientMsg) => void;
  startQueue: (mode?: Mode, rated?: boolean) => void;
  startPractice: (mode: Mode, level: number) => void;
  cancelQueue: () => void;
  clearFound: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [liveMatch, setLiveMatch] = useState<string | null>(null);
  const [liveOpponents, setLiveOpponents] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [conn, setConn] = useState<ConnState>('idle');
  const [queue, setQueue] = useState<QueueState>(() => ({
    s: 'idle', since: 0, ...(readPlayChoice() ?? DEFAULT_CHOICE),
  }));

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
     playing. It waits for `me` because the pill names the other seats, and
     which seat is not yours is a question only an id answers. */
  useEffect(() => {
    const id = readLiveMatch();
    if (!id || !me) return;
    let live = true;
    api
      .match(id)
      .then((m) => {
        if (!live) return;
        if (m.status !== 'playing') {
          writeLiveMatch(null);
          return;
        }
        setLiveMatch(id);
        setLiveOpponents(opponentNames(m.seats.filter((s) => s.userId !== me.id).map((s) => s.name)));
      })
      .catch(() => writeLiveMatch(null));
    return () => {
      live = false;
    };
  }, [me]);

  useEffect(
    () =>
      socket.onMessage((m: ServerMsg) => {
        if (m.t === 'hi') setMeState((prev) => (prev ? { ...prev, ...m.u } : null));
        else if (m.t === 'state' && m.s.you != null) {
          writeLiveMatch(m.s.m);
          setLiveMatch(m.s.m);
          setLiveOpponents(opponentNames(m.s.seats.filter((s) => s.i !== m.s.you).map((s) => s.name)));
        } else if (m.t === 'end') {
          writeLiveMatch(null);
          setLiveMatch(null);
          setLiveOpponents(null);
          /* The match just moved the rating, and the top bar is showing the
             value from before it. */
          void refreshMe();
        } else if (m.t === 'err' && m.c === 'bots_busy') {
          /* Practice never queues, so there is nothing to cancel: the search
             is simply over and the reason goes on screen. */
          setQueue((prev) => ({ s: 'idle', since: 0, mode: prev.mode, rated: prev.rated, error: m.msg }));
        } else if (m.t === 'q') {
          setQueue((prev) => ({
            s: m.s,
            since: m.s === 'searching' && prev.s === 'searching' ? prev.since : Date.now(),
            /* The server echoes what it queued you for; before it answers, the
               screen shows what you asked for rather than nothing. */
            mode: m.mode ?? prev.mode,
            rated: m.rated ?? prev.rated,
            /* The server has no queue message for practice, so what kind of
               search this is is only ever known here. */
            practice: prev.practice,
            range: m.range,
            w: m.w,
            seated: m.seated,
            m: m.m,
          }));
        }
      }),
    [refreshMe],
  );

  const send = useCallback((m: ClientMsg) => socket.send(m), []);

  /* Called with a choice from the picker, and without one from "play again",
     which repeats whatever was played last. */
  const startQueue = useCallback((mode?: Mode, rated?: boolean) => {
    const last = readPlayChoice() ?? DEFAULT_CHOICE;
    const choice: PlayChoice = { mode: mode ?? last.mode, rated: rated ?? last.rated };
    writePlayChoice(choice);
    setQueue({ s: 'searching', since: Date.now(), ...choice });
    socket.send({ t: 'queue', ...choice });
  }, []);

  /* Practice skips the queue on the server: the table is built the moment the
     message lands, so this searching state lasts a round trip rather than the
     bot-fill wait a rated search has. It is deliberately not remembered as the
     play choice, since "play again" should repeat a real match. */
  const startPractice = useCallback((mode: Mode, level: number) => {
    setQueue({ s: 'searching', since: Date.now(), mode, rated: false, practice: true });
    socket.send({ t: 'queue', mode, bots: { level } });
  }, []);

  const cancelQueue = useCallback(() => {
    setQueue((prev) => ({ s: 'idle', since: 0, mode: prev.mode, rated: prev.rated }));
    socket.send({ t: 'dequeue' });
  }, []);

  const clearFound = useCallback(
    () => setQueue((prev) => ({ s: 'idle', since: 0, mode: prev.mode, rated: prev.rated })),
    [],
  );

  /* Claim and login return a UserSummary; the counts on Me are unchanged by
     either, so the summary is merged over what is already there. */
  const setMe = useCallback((u: UserSummary) => {
    setMeState((prev) => (prev ? { ...prev, ...u } : { ...u, peak: u.rating, matches: 0, wins: 0, losses: 0, draws: 0 }));
  }, []);

  const value = useMemo(
    () => ({ me, setMe, refreshMe, liveMatch, liveOpponents, ready, offline, conn, queue, send, startQueue, startPractice, cancelQueue, clearFound }),
    [me, setMe, refreshMe, liveMatch, liveOpponents, ready, offline, conn, queue, send, startQueue, startPractice, cancelQueue, clearFound],
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
