import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ActionKind, Mode, TableView } from '@opentable/protocol';
import { Table } from '../table/table.tsx';
import { HandsSection, MatchSummary, matchFromEnd } from '../table/match-summary.tsx';
import { ResultPanel } from '../table/result-panel.tsx';
import { playMatchEnd } from '../table/sounds.ts';
import type { Match as MatchData } from '../net/types.ts';
import { api } from '../net/api.ts';
import { useServerMsg, useSession } from '../net/session.tsx';
import { playerList } from '../table/dock.tsx';
import { MODE_NAME } from '../ui/mode-tabs.tsx';
import { StakeBadge } from './feed.tsx';
import { useTitle } from '../ui/title.ts';
import { mockChat, mockScript } from '../dev/mock.ts';
import { useMatchChat, useMockChat } from '../chat/use-chat.ts';

export function Match() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const isMock = id === 'mock' || params.get('mock') === '1';
  const mode: Mode = params.get('mode') === 'six-max' ? 'six-max' : 'heads-up';
  const rated = params.get('rated') !== 'casual';
  const practice = params.get('practice') === '1';
  /* `?watch=1` runs the same script with no seat, which is what the server
     sends a spectator. It is how the watching table gets a screenshot and an
     e2e pass without a live match to sit at. */
  const watch = params.get('watch') === '1';
  const v2 = params.get('v2') === '1';
  /* `?hold=1` marks every hand-over step as held for the viewer, the way a
     practice table is, so the band's deal button can be pictured and tested. */
  const hold = params.get('hold') === '1';
  /* `?sitout=1` marks your own seat as sitting out, the way the room does
     after three timeouts, so the prompt and the way back can be pictured and
     tested without a table that has actually timed you out. */
  const sitout = params.get('sitout') === '1';
  /* `?runout=1` runs the all-in run-out script instead of either ordinary
     one: both hands up, the board arriving a street at a time behind a count. */
  const runout = params.get('runout') === '1';
  return isMock ? (
    <MockMatch
      step={numOrNull(params.get('step'))}
      mode={mode}
      rated={rated}
      practice={practice}
      watch={watch}
      v2={v2}
      hold={hold}
      sitout={sitout}
      runout={runout}
    />
  ) : (
    <LiveMatch id={id} />
  );
}

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function scrollToHands() {
  document.getElementById('hands')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ----------------------------------------------------------------- live */

function LiveMatch({ id }: { id: string }) {
  const { send, me, offline, conn, startQueue, queue, clearFound } = useSession();
  const nav = useNavigate();
  const [view, setView] = useState<TableView | null>(null);
  /* Two different endings. `ended` is the match finishing while you are at the
     table: the felt stays, dimmed, and the result slides in under it. `opened`
     is arriving at a match that finished some time ago, which has no table to
     keep. */
  const [ended, setEnded] = useState<MatchData | null>(null);
  const [opened, setOpened] = useState<MatchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pending = useRef<string | null>(null);
  const latest = useRef<TableView | null>(null);
  /* Watching is decided by the view, not by the route: the same URL is the
     table for the two people at it and a spectator seat for everyone else,
     and the server is the one that knows which you are. */
  const watching = view != null && view.you == null;
  useTitle(watching ? `Watching ${playerList(view)}` : `Match ${id}`);
  /* Chat belongs to the subscription, not to the felt: the room replays it on
     join and keeps sending it while this page holds the match open. */
  const chat = useMatchChat(id, watching);

  /* The match row decides which of the two pages this is. A finished match
     never opens a socket subscription; a playing one never waits on REST. */
  useEffect(() => {
    let live = true;
    setOpened(null);
    setLoadError(null);
    api
      .match(id)
      .then((m) => {
        if (!live) return;
        if (m.status === 'playing') send({ t: 'join', m: id });
        else setOpened(m);
      })
      .catch((e: Error) => {
        if (!live) return;
        /* An unreachable match endpoint is not a reason to refuse to play: the
           socket is the authority while a match is live. */
        setLoadError(e.message);
        send({ t: 'join', m: id });
      });
    return () => {
      live = false;
      send({ t: 'leave', m: id });
    };
  }, [id, send]);

  useServerMsg((m) => {
    if (m.t === 'state' && m.s.m === id) {
      const key = `${m.s.h}:${m.s.n}`;
      if (pending.current && pending.current !== key) {
        pending.current = null;
        setSending(false);
      }
      latest.current = m.s;
      setView(m.s);
      setError(null);
    } else if (m.t === 'end' && m.m === id) {
      /* The server holds the last hand on screen before it sends this, so the
         table below the panel is showing the hand that decided the match. */
      const last = latest.current;
      const fallback = last ? matchFromEnd(last, m.r) : null;
      playMatchEnd(m.r.winner != null && m.r.winner === me?.id);
      api
        .match(id)
        .then((full) => {
          const settled = full.status === 'playing' ? (fallback ?? full) : full;
          if (last) setEnded(settled);
          else setOpened(settled);
        })
        .catch(() => {
          if (!fallback) return;
          if (last) setEnded(fallback);
          else setOpened(fallback);
        });
    } else if (m.t === 'err') {
      pending.current = null;
      setSending(false);
      setError(m.msg || 'That action was refused.');
    }
  });

  const onAct = useCallback(
    (a: ActionKind, v?: number) => {
      if (!view || sending) return;
      pending.current = `${view.h}:${view.n}`;
      setSending(true);
      send({ t: 'act', m: id, h: view.h, n: view.n, a, ...(v == null ? {} : { v }) });
    },
    [view, sending, send, id],
  );

  // Practice's hold: deal the next hand (or finish the match) instead of
  // waiting the table out. Takes the match id and hand number rather than
  // closing over `view` itself, so a future caller answering a different
  // table's hold is not tempted to reach into this one's state for it.
  const onNext = useCallback((m: string, h: number) => send({ t: 'next', m, h }), [send]);

  /* Coming back from sitting out. Sent whenever this page has a seat and the
     player has just returned to it, rather than only when the last view we
     saw said the seat was sitting out: the way a seat gets sat out in the
     first place is a phone browser suspending in the background, and the view
     that says so arrives after the socket does. The room ignores a `back`
     from a seat that is not sitting out, so the cheap message is the one to
     send, and nothing here has to guess. */
  const comeBack = useCallback(() => {
    if (latest.current?.you == null) return;
    send({ t: 'back', m: id });
  }, [send, id]);

  /* A socket that has just reopened, as an edge and not a state. A page that
     sent `back` for as long as it was connected and sitting out would un-sit
     an idle player the instant the table sat them out, and no seat would ever
     sit out at all. */
  const wasOpen = useRef(conn === 'open');
  useEffect(() => {
    const open = conn === 'open';
    const returned = open && !wasOpen.current;
    wasOpen.current = open;
    if (returned) comeBack();
  }, [conn, comeBack]);

  /* And a tab that has just come to the front, which on a phone is the same
     return by a different route: the browser suspends the page without
     closing the socket often enough that the reconnect above never fires. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') comeBack();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [comeBack]);

  /* A table found while this one is on screen is a table the player asked
     for somewhere else (a friend's link taken while they were dealt in
     against a bot, a home game starting), and the server has already pulled
     them out of this one. Walk there, the way the home page does. */
  useEffect(() => {
    if (queue.s !== 'found' || !queue.m || queue.m === id) return;
    const m = queue.m;
    clearFound();
    nav(`/m/${m}`);
  }, [queue.s, queue.m, id, nav, clearFound]);

  /* Leaving the game, which is not the same message as leaving the page: the
     unmount above sends `leave` on every route change and must never end a
     match, so the button sends `resign` and the server decides what that
     costs.

     Whether to stay is the server's answer read back. Heads-up and practice
     both end the match, and the result panel is the point of staying for.
     Multiway plays on without the seat, so there is nothing left to watch as
     a player and the way out is out. */
  const onLeave = useCallback(() => {
    send({ t: 'resign', m: id });
    const playsOn = view != null && view.seats.length > 2 && !view.format.practice;
    if (playsOn) nav('/');
  }, [send, id, view, nav]);

  /* Play again means the match just played: the same mode, rated or not.
     Somebody who was watching it has no match to play again, so the primary
     button sends them back to the tables that are still running.

     An arena match is the exception: the next match is the arena's to give,
     not the queue's, so the way on from this table is back to the board. */
  const done = ended ?? opened;
  const arena = done?.format.arena ?? null;
  /* And the same for a tournament table: the next match is the tournament's
     to give, so the way on from this table is back to the bracket or the
     funnel it belongs to. */
  const tournament = done?.format.tournament?.id ?? null;
  const playAgain = useCallback(() => {
    if (watching) {
      nav('/watch');
      return;
    }
    if (arena) {
      nav(`/arena/${arena}`);
      return;
    }
    if (tournament) {
      nav(`/t/${tournament}`);
      return;
    }
    startQueue(done?.format.mode, done?.rated);
    nav('/');
  }, [startQueue, nav, done, watching, arena, tournament]);
  const againLabel = watching
    ? 'Watch another table'
    : arena
      ? 'Back to the arena'
      : tournament
        ? 'Back to the tournament'
        : undefined;

  if (opened) {
    return <MatchSummary match={opened} meId={me?.id ?? null} onAgain={playAgain} againLabel={againLabel} />;
  }

  if (offline && !view) return <Pending text="The table server is not answering. Reload once it is back." />;
  if (!view) {
    return (
      <Pending
        text={loadError ? 'Joining the match' : conn === 'open' ? 'Joining the match' : 'Connecting to the table'}
        spinner
      />
    );
  }

  return (
    <>
      {/* Every live table draws the v2 felt: SVG cards and chips and the
          action band. The mock keeps v1 as its default so the footprint and
          screenshot suites go on measuring the felt they were written for,
          and offers ?v2=1 for the one people play on. */}
      <Table
        view={view}
        onAct={onAct}
        onNext={() => onNext(id, view.h)}
        onBack={comeBack}
        sending={sending}
        ended={ended != null}
        chat={chat}
        look="v2"
        onLeave={onLeave}
      />
      {ended ? (
        <>
          <ResultPanel
            match={ended}
            meId={me?.id ?? null}
            onAgain={playAgain}
            againLabel={againLabel}
            onReview={scrollToHands}
          />
          <main className="page">
            <HandsSection match={ended} />
          </main>
        </>
      ) : (
        error && <div className="dock-error" role="alert">{error}</div>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- mock */

function MockMatch(
  { step, mode, rated, practice, watch, v2, hold, sitout, runout }:
  {
    step: number | null; mode: Mode; rated: boolean; practice: boolean;
    watch: boolean; v2: boolean; hold: boolean; sitout: boolean; runout: boolean;
  },
) {
  const script = useMemo(
    () => mockScript(mode, rated, practice, runout),
    [mode, rated, practice, runout],
  );
  const start = step == null ? 0 : Math.max(0, Math.min(script.length - 1, step));
  const [i, setI] = useState(start);
  const [enteredAt, setEnteredAt] = useState(() => Date.now());
  const nav = useNavigate();
  useTitle('Mock table');
  const [chatSeed] = useState(() => mockChat(Date.now()));
  const chat = useMockChat(chatSeed, 'u-you', watch);

  useEffect(() => {
    if (step != null) return;
    if (i >= script.length - 1) return;
    const timer = setTimeout(() => {
      setI((v) => v + 1);
      setEnteredAt(Date.now());
    }, script[i].delay);
    return () => clearTimeout(timer);
  }, [i, step, script]);

  const advance = useCallback(() => {
    setI((v) => Math.min(script.length - 1, v + 1));
    setEnteredAt(Date.now());
  }, [script.length]);

  let base: TableView | null = null;
  for (let k = i; k >= 0; k -= 1) {
    if (script[k].view) {
      base = script[k].view!;
      break;
    }
  }
  const end = script[i].end ?? null;

  /* The script carries a clock offset, not an absolute deadline, so a step
     looks the same whenever it is entered. Watching drops the seat and the
     legal actions with it, which is what the server withholds on the wire.
     The mock cannot also hide the hero's hole cards, because the script hands
     them over already dealt: the stripping itself is the server's job and is
     tested there. */
  const view = useMemo(() => {
    if (!base) return null;
    const timed = base.clock
      ? { ...base, clock: { ...base.clock, deadline: enteredAt + base.format.clockMs } }
      : base;
    const held = hold && timed.street === 'done' ? { ...timed, hold: 'you' as const } : timed;
    const seated = sitout && held.you != null
      ? { ...held, seats: held.seats.map((s) => (s.i === held.you ? { ...s, sittingOut: true } : s)) }
      : held;
    if (!watch) return seated;
    /* A spectator has no seat, no decision and nobody's hole cards: the server
       sends everyone face down until a showdown, so the mock does too. Without
       this the watching table showed the scripted player's hand while the dock
       underneath said hole cards turn over at showdown. */
    return {
      ...seated,
      you: null,
      legal: null,
      seats: seated.seats.map((s) => (
        s.cards && s.cards.some((c) => !c.startsWith('?'))
          ? { ...s, cards: s.cards.map(() => '?') }
          : s
      )),
    };
  }, [base, enteredAt, watch, hold, sitout]);

  const replay = useCallback(() => {
    setI(0);
    setEnteredAt(Date.now());
    nav(runout ? '/m/mock?runout=1' : mode === 'six-max' ? '/m/mock?mode=six-max' : '/m/mock');
  }, [nav, mode, runout]);

  if (!view) return <Pending text="Loading the mock table" />;

  const ended = end ? matchFromEnd(view, end) : null;

  return (
    <>
      <Table
        view={view}
        onAct={advance}
        sending={false}
        ended={ended != null}
        chat={chat}
        look={v2 ? 'v2' : 'v1'}
        onNext={hold ? advance : undefined}
        onBack={sitout ? advance : undefined}
        /* No server to resign to, so leaving the mock is leaving the page.
           The control and its dialog are the same ones the live table draws,
           which is what lets the e2e suite open the warning without a
           match. */
        onLeave={() => nav('/')}
      />
      {ended ? (
        <>
          <ResultPanel
            match={ended}
            meId="u-you"
            againLabel="Replay the script"
            onAgain={replay}
            onReview={scrollToHands}
          />
          <main className="page">
            <HandsSection match={ended} />
          </main>
        </>
      ) : (
        /* Fixed to the corner of the page and out of the flow, so it is no
           part of the footprint the tests measure, and lifted clear of the
           table's bottom rows: over the hero band's cards it covered the one
           thing on the screen you have to be able to read. Only the mock knows
           which rows this table has, so the mock is where the sum lives. */
        <span
          className="devnote"
          style={{
            padding: '4px var(--sp-4)',
            bottom: v2
              ? `calc(${watch ? 'var(--band-watch-h)' : 'var(--band-h)'}`
                + `${practice ? ' + var(--strip-gap)' : ''} + 6px)`
              : undefined,
          }}
        >
          Mock table, no server. Step {i + 1} of {script.length}: {script[i].label}
        </span>
      )}
    </>
  );
}

function Pending({ text, spinner }: { text: string; spinner?: boolean }) {
  return (
    <main className="page">
      <div className="card">
        <div className="empty">
          {spinner && <span className="spinner" aria-hidden="true" />}
          <span className="e-title">{text}</span>
        </div>
      </div>
    </main>
  );
}
