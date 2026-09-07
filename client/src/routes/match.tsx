import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ActionKind, MatchResult, TableView } from '@opentable/protocol';
import { Table } from '../table/table.tsx';
import { ResultScreen } from '../table/result.tsx';
import { useServerMsg, useSession } from '../net/session.tsx';
import { mockScript } from '../dev/mock.ts';

export function Match() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const isMock = id === 'mock' || params.get('mock') === '1';
  return isMock ? <MockMatch step={numOrNull(params.get('step'))} /> : <LiveMatch id={id} />;
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
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (offline) return;
    send({ t: 'join', m: id });
    return () => send({ t: 'leave', m: id });
  }, [id, send, offline]);

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
      setResult(m.r);
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

  const playAgain = useCallback(() => {
    setResult(null);
    startQueue();
    nav('/');
  }, [startQueue, nav]);

  if (offline) return <Pending text="The table server is not answering. Reload once it is back." />;
  if (!view) {
    return (
      <Pending
        text={conn === 'open' ? 'Joining the match' : 'Connecting to the table'}
        spinner
      />
    );
  }

  return (
    <>
      <Table view={view} onAct={onAct} sending={sending} />
      {error && <div className="waiting-bar" role="alert">{error}</div>}
      {result && me && <ResultScreen result={result} meId={me.id} view={view} onAgain={playAgain} />}
    </>
  );
}

/* ----------------------------------------------------------------- mock */

function MockMatch({ step }: { step: number | null }) {
  const script = useMemo(() => mockScript(), []);
  const start = step == null ? 0 : Math.max(0, Math.min(script.length - 1, step));
  const [i, setI] = useState(start);
  const [enteredAt, setEnteredAt] = useState(() => Date.now());
  const nav = useNavigate();

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

  /* The script is authored with a clock offset, not an absolute deadline, so a
     step looks the same whenever it is entered. */
  const view = useMemo(() => {
    if (!base) return null;
    if (!base.clock) return base;
    return { ...base, clock: { ...base.clock, deadline: enteredAt + base.format.clockMs } };
  }, [base, enteredAt]);

  if (!view) return <Pending text="Loading the mock table" />;

  return (
    <>
      <Table view={view} onAct={advance} sending={false} />
      {end && (
        <ResultScreen
          result={end}
          meId="u-you"
          view={view}
          onAgain={() => {
            setI(0);
            setEnteredAt(Date.now());
            nav('/m/mock');
          }}
          againLabel="Replay the script"
        />
      )}
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
