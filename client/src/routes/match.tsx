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
import { mockScript } from '../dev/mock.ts';

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
  return isMock ? (
    <MockMatch
      step={numOrNull(params.get('step'))}
      mode={mode}
      rated={rated}
      practice={practice}
      watch={watch}
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
  const { send, me, offline, conn, startQueue } = useSession();
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

  /* Play again means the match just played: the same mode, rated or not.
     Somebody who was watching it has no match to play again, so the primary
     button sends them back to the tables that are still running. */
  const done = ended ?? opened;
  const playAgain = useCallback(() => {
    if (watching) {
      nav('/watch');
      return;
    }
    startQueue(done?.format.mode, done?.rated);
    nav('/');
  }, [startQueue, nav, done, watching]);

  if (opened) return <MatchSummary match={opened} meId={me?.id ?? null} onAgain={playAgain} />;

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
      <Table view={view} onAct={onAct} sending={sending} ended={ended != null} />
      {ended ? (
        <>
          <ResultPanel
            match={ended}
            meId={me?.id ?? null}
            onAgain={playAgain}
            againLabel={watching ? 'Watch another table' : undefined}
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
  { step, mode, rated, practice, watch }:
  { step: number | null; mode: Mode; rated: boolean; practice: boolean; watch: boolean },
) {
  const script = useMemo(() => mockScript(mode, rated, practice), [mode, rated, practice]);
  const start = step == null ? 0 : Math.max(0, Math.min(script.length - 1, step));
  const [i, setI] = useState(start);
  const [enteredAt, setEnteredAt] = useState(() => Date.now());
  const nav = useNavigate();
  useTitle('Mock table');

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
    const seated = base.clock
      ? { ...base, clock: { ...base.clock, deadline: enteredAt + base.format.clockMs } }
      : base;
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
  }, [base, enteredAt, watch]);

  const replay = useCallback(() => {
    setI(0);
    setEnteredAt(Date.now());
    nav(mode === 'six-max' ? '/m/mock?mode=six-max' : '/m/mock');
  }, [nav, mode]);

  if (!view) return <Pending text="Loading the mock table" />;

  const ended = end ? matchFromEnd(view, end) : null;

  return (
    <>
      <Table view={view} onAct={advance} sending={false} ended={ended != null} />
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
        <span className="devnote" style={{ padding: '4px var(--sp-4)' }}>
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
