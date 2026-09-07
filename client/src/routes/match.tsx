import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ActionKind, Mode, TableView } from '@opentable/protocol';
import { Table } from '../table/table.tsx';
import { MatchSummary, matchFromEnd } from '../table/match-summary.tsx';
import type { Match as MatchData } from '../net/types.ts';
import { api } from '../net/api.ts';
import { useServerMsg, useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { mockScript } from '../dev/mock.ts';

export function Match() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const isMock = id === 'mock' || params.get('mock') === '1';
  const mode: Mode = params.get('mode') === 'six-max' ? 'six-max' : 'heads-up';
  const rated = params.get('rated') !== 'casual';
  return isMock ? (
    <MockMatch step={numOrNull(params.get('step'))} mode={mode} rated={rated} />
  ) : (
    <LiveMatch id={id} />
  );
}

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ----------------------------------------------------------------- live */

function LiveMatch({ id }: { id: string }) {
  const { send, me, offline, conn, startQueue } = useSession();
  const nav = useNavigate();
  const [view, setView] = useState<TableView | null>(null);
  const [finished, setFinished] = useState<MatchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pending = useRef<string | null>(null);
  useTitle(`Match ${id}`);

  /* The match row decides which of the two pages this is. A finished match
     never opens a socket subscription; a playing one never waits on REST. */
  useEffect(() => {
    let live = true;
    setFinished(null);
    setLoadError(null);
    api
      .match(id)
      .then((m) => {
        if (!live) return;
        if (m.status === 'playing') send({ t: 'join', m: id });
        else setFinished(m);
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
      setView(m.s);
      setError(null);
    } else if (m.t === 'end' && m.m === id) {
      const fallback = view ? matchFromEnd(view, m.r) : null;
      api
        .match(id)
        .then((full) => setFinished(full.status === 'playing' ? (fallback ?? full) : full))
        .catch(() => fallback && setFinished(fallback));
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

  /* Play again means the match just played: the same mode, rated or not. */
  const playAgain = useCallback(() => {
    startQueue(finished?.format.mode, finished?.rated);
    nav('/');
  }, [startQueue, nav, finished]);

  if (finished) return <MatchSummary match={finished} meId={me?.id ?? null} onAgain={playAgain} />;

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
      <Table view={view} onAct={onAct} sending={sending} />
      {error && <div className="waiting-bar" role="alert">{error}</div>}
    </>
  );
}

/* ----------------------------------------------------------------- mock */

function MockMatch({ step, mode, rated }: { step: number | null; mode: Mode; rated: boolean }) {
  const script = useMemo(() => mockScript(mode, rated), [mode, rated]);
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
     looks the same whenever it is entered. */
  const view = useMemo(() => {
    if (!base) return null;
    if (!base.clock) return base;
    return { ...base, clock: { ...base.clock, deadline: enteredAt + base.format.clockMs } };
  }, [base, enteredAt]);

  if (!view) return <Pending text="Loading the mock table" />;

  if (end) {
    return (
      <MatchSummary
        match={matchFromEnd(view, end)}
        meId="u-you"
        againLabel="Replay the script"
        onAgain={() => {
          setI(0);
          setEnteredAt(Date.now());
          nav(mode === 'six-max' ? '/m/mock?mode=six-max' : '/m/mock');
        }}
      />
    );
  }

  return (
    <>
      <Table view={view} onAct={advance} sending={false} />
      <span className="devnote" style={{ padding: '4px var(--sp-4)' }}>
        Mock table, no server. Step {i + 1} of {script.length}: {script[i].label}
      </span>
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
