import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DEFAULT_MODE, DEFAULT_SPEED, isModeChoice, isSpeedChoice, modesFor, speedsFor,
} from '@opentable/protocol';
import type {
  ClientMsg, Mode, ModeChoice, ReadyFailure, ServerMsg, Speed, SpeedChoice, UserSummary,
} from '@opentable/protocol';
import { api, onBeforeWrite } from './api.ts';
import type { Me } from './types.ts';
import { socket } from './socket.ts';
import type { ConnState } from './socket.ts';

export interface QueueState {
  s: 'idle' | 'searching' | 'found' | 'left';
  since: number;
  mode: Mode;
  rated: boolean;
  speed: Speed;
  practice?: boolean; // a table of bots, asked for by level, never rated
  range?: number;
  w?: number;
  seated?: number; // players gathered so far for a multiway table
  m?: string;
  /* Why the last search stopped, when it stopped for a reason worth reading:
     every bot near the level asked for is in a match, the table somebody did
     not turn up to, the wait a no-show earned. Cleared by the next search
     rather than by a dismiss, because starting one is the answer. */
  error?: string;
}

/* The table being offered, while it is being offered. Null the rest of the
   time, which is what the modal is mounted on: there is exactly one of these
   at once and the server is the only thing that opens or closes it.

   `answered` is this browser's own answer and is kept here rather than read
   back off `accepted`, because the count moves for everybody and the button
   has to settle the moment it is pressed. */
export interface ReadyState {
  id: string;
  mode: Mode;
  speed: Speed;
  rated: boolean;
  seats: number;
  humans: number;
  accepted: number;
  deadline: number;
  answered: boolean;
}

/* What a cancelled ready check says on the searching card. Two sentences at
   most, and both of them about what happens next rather than about who was at
   fault: somebody who is being put back in the queue wants to know they are
   still searching, and somebody serving a wait wants to know how long. */
export function readyCancelledText(why?: ReadyFailure, cooldownUntil?: number): string {
  if (cooldownUntil) {
    const minutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60_000));
    return `You left a table waiting. You can search again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  if (why === 'declined') return 'Somebody declined that table. You are back at the front of the queue.';
  return 'Somebody did not answer in time. You are back at the front of the queue.';
}

/* What the player last chose to play, so the picker opens where they left it
   and "play again" means the same thing they just played. */
export interface PlayChoice {
  mode: ModeChoice;
  rated: boolean;
  speed: SpeedChoice;
}

const CHOICE_KEY = 'ot-play-choice';
/* Six handed and ranked, at any speed. The two that name a game name the one
   this site is mainly about; the speed does not, because with this few people
   playing the fastest way to a table is not to mind which one. */
const DEFAULT_CHOICE: PlayChoice = { mode: DEFAULT_MODE, rated: true, speed: 'any' };

/* Null until something has actually been played: the picker must not claim a
   mode was played last on a first visit. */
export function readPlayChoice(): PlayChoice | null {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PlayChoice>;
    // A choice saved before speed existed was the long game, which is what
    // every stored format without one means too; one saved before "any" was
    // a real value is still whatever it named.
    const mode = isModeChoice(v.mode) ? v.mode : DEFAULT_MODE;
    const speed = isSpeedChoice(v.speed) ? v.speed : DEFAULT_SPEED;
    return { mode, rated: v.rated !== false, speed };
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
  /* Whether the Google button can be offered: from /api/me for somebody,
     from /api/config for a visitor who is not anybody yet. */
  googleAuth: boolean;
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
  /* The table being offered right now, or null. One at a time, opened and
     closed by the server, which is why it lives here rather than on the page
     that happens to be showing: a ready check has to reach you on the
     leaderboard as readily as on the home page. */
  readyCheck: ReadyState | null;
  answerReady: (accept: boolean) => void;
  send: (m: ClientMsg) => void;
  startQueue: (mode?: ModeChoice, rated?: boolean, speed?: SpeedChoice, remember?: boolean) => void;
  startPractice: (mode: Mode, level: number, speed?: Speed) => void;
  cancelQueue: () => void;
  clearFound: () => void;
}

const Ctx = createContext<Session | null>(null);

/* What a watcher's socket may send without being anybody (the server's
   WATCHER_MSGS in ws/hub.ts says the same). */
const WATCH_MSGS = new Set<ClientMsg['t']>(['join', 'leave', 'arena', 'tournament', 'ping']);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [liveMatch, setLiveMatch] = useState<string | null>(null);
  const [liveOpponents, setLiveOpponents] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [conn, setConn] = useState<ConnState>('idle');
  const [queue, setQueue] = useState<QueueState>(() => ({
    s: 'idle',
    since: 0,
    ...(() => {
      const c = readPlayChoice() ?? DEFAULT_CHOICE;
      return { mode: modesFor(c.mode)[0], rated: c.rated, speed: speedsFor(c.speed)[0] };
    })(),
  }));
  const [readyCheck, setReadyCheck] = useState<ReadyState | null>(null);
  const [configGoogle, setConfigGoogle] = useState(false);
  /* Who the open socket was opened as: undefined before the first /api/me,
     then an id, or null for a watcher. When `me` moves off it (a mint, a log
     in, a log out) the socket reconnects, since the server reads the session
     once, at the upgrade. */
  const socketFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api
      .me()
      .then((u) => {
        if (!live) return;
        socketFor.current = u?.id ?? null;
        setMeState(u);
        setOffline(false);
        socket.open();
        if (!u) {
          api.config().then((c) => live && setConfigGoogle(c.googleAuth === true)).catch(() => {});
        }
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

  /* Become somebody, once, the first time it is needed: mint a guest with
     POST /api/session and reconnect the socket so the server knows it as that
     guest rather than as a watcher. Every write (api.ts) and every socket
     message that needs a person waits on it; concurrent callers share the one
     request. A visitor who only looks never gets here. */
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const minting = useRef<Promise<void> | null>(null);
  const ensureSession = useCallback(async () => {
    if (meRef.current) return;
    if (!minting.current) {
      minting.current = (async () => {
        const u = await api.session();
        meRef.current = u;
        socketFor.current = u.id;
        setMeState(u);
        socket.reconnect();
      })().finally(() => {
        minting.current = null;
      });
    }
    await minting.current;
  }, []);
  useEffect(() => onBeforeWrite(ensureSession), [ensureSession]);

  useEffect(() => {
    if (socketFor.current === undefined) return;
    const id = me?.id ?? null;
    if (id === socketFor.current) return;
    socketFor.current = id;
    socket.reconnect();
  }, [me?.id]);

  /* A socket message that needs a person goes out once there is one. Watching
     (join, leave, arena, tournament) and pings do not. */
  const sendAsSomebody = useCallback((m: ClientMsg) => {
    if (meRef.current || WATCH_MSGS.has(m.t)) {
      socket.send(m);
      return;
    }
    // Nobody has nothing queued to take back.
    if (m.t === 'dequeue') return;
    ensureSession().then(() => socket.send(m)).catch(() => {
      /* the mint failed, so the action does not happen; the page is unchanged */
    });
  }, [ensureSession]);

  useEffect(() => socket.onState(setConn), []);

  /* Whatever was pushed while the socket was down was pushed to nobody. The
     one push worth recovering is a table that started, which `/api/me` says,
     so it is asked again on every reopen after the first. */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (conn !== 'open') return;
    if (wasOpen.current) void refreshMe();
    wasOpen.current = true;
  }, [conn, refreshMe]);

  /* A remembered match is only offered once the server confirms it is still
     playing. It waits for `me` because the pill names the other seats, and
     which seat is not yours is a question only an id answers. The server's
     own answer (`me.playing`) comes first: it is the one a match that
     started while this browser's socket was down leaves behind, and it is
     read again on every reconnect below. */
  useEffect(() => {
    const id = me?.playing ?? readLiveMatch();
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

  /* Leaving `/m/:id` unsubscribes from that room on purpose (see `leave` in
     ws/router.ts): a match that finishes after you have clicked away, most
     often a practice table nobody stayed to watch out, sends its `end`
     nowhere, and the pill would say "playing" forever with nothing left to
     tell it otherwise. Every page that is not the match's own is polled
     against the server until it settles, since the moment it actually
     finished is not one this browser was subscribed to hear about. */
  const { pathname } = useLocation();
  useEffect(() => {
    if (!liveMatch || pathname === `/m/${liveMatch}`) return;
    let live = true;
    const check = () => {
      api
        .match(liveMatch)
        .then((m) => {
          if (!live || m.status === 'playing') return;
          writeLiveMatch(null);
          setLiveMatch(null);
          setLiveOpponents(null);
        })
        .catch(() => {
          /* the pill is a convenience; a failed check just tries again next tick */
        });
    };
    check();
    const id = setInterval(check, 10_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [pathname, liveMatch]);

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
          /* The match just moved the rating, and the account row is showing the
             value from before it. */
          void refreshMe();
        } else if (m.t === 'err' && (m.c === 'bots_busy' || m.c === 'cooldown' || m.c === 'ranked_ban')) {
          /* Three refusals that end a search rather than reject an action, so
             the searching screen has to come down and say why. Practice never
             queued in the first place; the other two never got in. */
          setQueue((prev) => ({
            s: 'idle', since: 0, mode: prev.mode, rated: prev.rated, speed: prev.speed, error: m.msg,
          }));
        } else if (m.t === 'ready') {
          if (m.s === 'cancelled') {
            setReadyCheck(null);
            /* Everybody who accepted is back in the queue where they were, so
               the screen goes back to searching with a line saying why rather
               than to idle with nothing to explain the jump. */
            setQueue((prev) =>
              m.requeued
                ? { ...prev, s: 'searching', error: readyCancelledText(m.why) }
                : { s: 'idle', since: 0, mode: prev.mode, rated: prev.rated, speed: prev.speed, error: readyCancelledText(m.why, m.cooldownUntil) },
            );
          } else {
            setReadyCheck((prev) => ({
              id: m.id,
              mode: m.mode,
              speed: m.speed,
              rated: m.rated,
              seats: m.seats,
              humans: m.humans,
              accepted: m.accepted,
              deadline: m.deadline,
              /* A `pending` for a different table is a different check, so the
                 answer does not carry over; an `accepted` for the one already
                 on screen leaves this browser's own answer where it was. */
              answered: prev?.id === m.id ? prev.answered : false,
            }));
          }
        } else if (m.t === 'q') {
          if (m.s === 'found' || m.s === 'left') setReadyCheck(null);
          setQueue((prev) => ({
            s: m.s,
            since: m.s === 'searching' && prev.s === 'searching' ? prev.since : Date.now(),
            /* The server echoes what it queued you for; before it answers, the
               screen shows what you asked for rather than nothing. */
            mode: m.mode ?? prev.mode,
            rated: m.rated ?? prev.rated,
            speed: m.speed ?? prev.speed,
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

  const send = sendAsSomebody;

  /* Called with a choice from the picker, and without one from "play again",
     which repeats whatever was played last. */
  /* `remember` is what separates a choice from a default. The play screen
     picks a format on purpose, so it is written down and the front page's
     rating, board and practice preset follow it afterwards. The front page's
     own button is not a choice, it is the default six handed table, and
     recording it would quietly undo a format somebody had gone to /play to
     set and flip their rating back to a game they do not play. */
  const startQueue = useCallback((
    mode?: ModeChoice,
    rated?: boolean,
    speed?: SpeedChoice,
    remember = true,
  ) => {
    const last = readPlayChoice() ?? DEFAULT_CHOICE;
    const choice: PlayChoice = {
      mode: mode ?? last.mode,
      rated: rated ?? last.rated,
      speed: speed ?? last.speed,
    };
    if (remember) writePlayChoice(choice);
    /* The state describes the search the way the server describes it back:
       by its first preference. A wide search is still looking for something
       in particular first, and the `searching` message that lands a moment
       later says exactly this, so the two never disagree on screen. */
    setQueue({
      s: 'searching',
      since: Date.now(),
      mode: modesFor(choice.mode)[0],
      rated: choice.rated,
      speed: speedsFor(choice.speed)[0],
    });
    sendAsSomebody({ t: 'queue', ...choice });
  }, [sendAsSomebody]);

  /* Yes or no to the table on screen. The answer is stamped here as well as
     sent, so the button settles on the press rather than on the round trip;
     the server's own `accepted` still drives the counter beside it. */
  const answerReady = useCallback((accept: boolean) => {
    setReadyCheck((prev) => (prev ? { ...prev, answered: true } : prev));
    sendAsSomebody({ t: 'ready', a: accept });
  }, [sendAsSomebody]);

  /* Practice skips the queue on the server: the table is built the moment the
     message lands, so this searching state lasts a round trip rather than the
     bot-fill wait a rated search has. It is deliberately not remembered as the
     play choice, since "play again" should repeat a real match. Speed defaults
     to the site's own default rather than to whatever the play panel is
     pinned to, since the home page's own presets ask for nothing but a level. */
  const startPractice = useCallback((mode: Mode, level: number, speed: Speed = DEFAULT_SPEED) => {
    setQueue({ s: 'searching', since: Date.now(), mode, rated: false, speed, practice: true });
    sendAsSomebody({ t: 'queue', mode, speed, bots: { level } });
  }, [sendAsSomebody]);

  const cancelQueue = useCallback(() => {
    setQueue((prev) => ({ s: 'idle', since: 0, mode: prev.mode, rated: prev.rated, speed: prev.speed }));
    sendAsSomebody({ t: 'dequeue' });
  }, []);

  const clearFound = useCallback(
    () => setQueue((prev) => ({ s: 'idle', since: 0, mode: prev.mode, rated: prev.rated, speed: prev.speed })),
    [],
  );

  /* Claim and login return a UserSummary; the counts on Me are unchanged by
     either, so the summary is merged over what is already there. */
  const setMe = useCallback((u: UserSummary) => {
    setMeState((prev) => (prev ? { ...prev, ...u } : { ...u, peak: u.rating, matches: 0, wins: 0, losses: 0, draws: 0 }));
  }, []);

  const value = useMemo(
    () => ({ me, googleAuth: me?.googleAuth === true || configGoogle, setMe, refreshMe, liveMatch, liveOpponents, ready, offline, conn, queue, readyCheck, answerReady, send, startQueue, startPractice, cancelQueue, clearFound }),
    [me, configGoogle, setMe, refreshMe, liveMatch, liveOpponents, ready, offline, conn, queue, readyCheck, answerReady, send, startQueue, startPractice, cancelQueue, clearFound],
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
