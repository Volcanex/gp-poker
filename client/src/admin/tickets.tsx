import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../net/api.ts';
import type { Ticket, TicketSummary } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { NotFound } from '../routes/not-found.tsx';
import { ago } from '../routes/feed.tsx';
import { TICKET_SAVED } from './bar.tsx';
import './admin.css';

/* The tickets the annotation layer writes. Two pages: what is open, and one
   ticket in full.

   Both are gated on the same flag the bar is, and a player who guesses the URL
   gets the site's own not-found page rather than a refusal, because "you are
   not allowed here" and "there is nothing here" should look the same to
   somebody who was never meant to find it. */

function useAdminGate(): 'wait' | 'no' | 'yes' {
  const { me, ready } = useSession();
  if (!ready) return 'wait';
  return me?.admin === true ? 'yes' : 'no';
}

function Waiting() {
  return (
    <main className="page">
      <span className="muted">Loading</span>
    </main>
  );
}

/* The one button that changes a ticket, on both pages. It carries its own
   in-flight state through g's own loading affordance rather than swapping the
   label, so the row does not resize while the request is out. */
function StatusButton({
  status,
  busy,
  onPick,
}: {
  status: 'open' | 'done';
  busy: boolean;
  onPick: (next: 'open' | 'done') => void;
}) {
  const next = status === 'open' ? 'done' : 'open';
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      data-loading={busy ? '' : undefined}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onPick(next);
      }}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      <span>{status === 'open' ? 'Mark done' : 'Reopen'}</span>
    </button>
  );
}

export function AdminTickets() {
  const gate = useAdminGate();
  const nav = useNavigate();
  const [showDone, setShowDone] = useState(false);
  const [list, setList] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useTitle('Tickets');

  const status = showDone ? 'done' : 'open';

  const load = useCallback(() => {
    if (gate !== 'yes') return;
    setList(null);
    setError(null);
    api
      .tickets(status)
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [gate, status]);

  useEffect(load, [load]);

  const mark = async (id: string, next: 'open' | 'done') => {
    setBusy(id);
    try {
      await api.setTicketStatus(id, next);
      setList((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
      window.dispatchEvent(new CustomEvent(TICKET_SAVED));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (gate === 'wait') return <Waiting />;
  if (gate === 'no') return <NotFound />;

  return (
    <main className="page wide stack">
      <div className="tk-head">
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <h1 className="h1">Tickets</h1>
          <p className="muted">
            Notes made on the site with the annotation layer, newest first. Each one carries the page
            it was made on, the elements it points at and whatever was drawn over them.
          </p>
        </div>
        <span className="spacer" />
        <label className="switch-row">
          <span className="label">Show done</span>
          <input
            type="checkbox"
            className="switch"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
        </label>
      </div>

      {error ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">The tickets did not load</span>
            <span className="e-desc">{error}. Reload to try again.</span>
          </div>
        </div>
      ) : list && list.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">Nothing {showDone ? 'done' : 'open'}</span>
            <span className="e-desc">
              {showDone
                ? 'Tickets you mark done are listed here.'
                : 'Press the annotate shortcut on any page to write one.'}
            </span>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table tk-rows" aria-label={`${showDone ? 'Done' : 'Open'} tickets`}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Page</th>
                  <th>When</th>
                  <th className="r">Status</th>
                </tr>
              </thead>
              <tbody>
                {(list ?? []).map((t) => (
                  <tr key={t.id} onClick={() => nav(`/admin/tickets/${t.id}`)}>
                    <td>
                      <span className="tk-title-cell">
                        <Link to={`/admin/tickets/${t.id}`}>{t.title}</Link>
                        <span className="muted">
                          {t.targets.length} {t.targets.length === 1 ? 'element' : 'elements'}
                        </span>
                      </span>
                    </td>
                    <td>
                      <Link className="tk-path" to={t.path} onClick={(e) => e.stopPropagation()}>
                        {t.path}
                      </Link>
                    </td>
                    <td className="tk-when">{ago(t.createdAt)}</td>
                    <td className="r">
                      <StatusButton
                        status={t.status}
                        busy={busy === t.id}
                        onPick={(next) => void mark(t.id, next)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

export function AdminTicket() {
  const gate = useAdminGate();
  const { id = '' } = useParams();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTitle(ticket ? ticket.title : 'Ticket');

  useEffect(() => {
    if (gate !== 'yes') return;
    let live = true;
    setTicket(null);
    setError(null);
    api
      .ticket(id)
      .then((t) => live && setTicket(t))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [gate, id]);

  const mark = async (next: 'open' | 'done') => {
    setBusy(true);
    try {
      await api.setTicketStatus(id, next);
      setTicket((prev) => (prev ? { ...prev, status: next } : prev));
      window.dispatchEvent(new CustomEvent(TICKET_SAVED));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (gate === 'wait') return <Waiting />;
  if (gate === 'no') return <NotFound />;

  if (error) {
    return (
      <main className="page">
        <div className="card">
          <div className="empty">
            <span className="e-title">The ticket did not load</span>
            <span className="e-desc">{error}. Go back to the list and pick it again.</span>
            <Link className="btn btn-secondary btn-sm" to="/admin/tickets">Go to the tickets</Link>
          </div>
        </div>
      </main>
    );
  }

  if (!ticket) return <Waiting />;

  const v = ticket.viewport;
  return (
    <main className="page wide stack">
      <div className="tk-head">
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <Link className="muted" to="/admin/tickets">Back to the tickets</Link>
          <h1 className="h1">{ticket.title}</h1>
        </div>
        <span className="spacer" />
        <StatusButton status={ticket.status} busy={busy} onPick={(next) => void mark(next)} />
      </div>

      <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
        <h2 className="h2">Note</h2>
        <p className="tk-note">{ticket.note}</p>
      </div>

      <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
        <h2 className="h2">Context</h2>
        <dl className="tk-context">
          <dt>Page</dt>
          <dd><Link to={ticket.path}>{ticket.path}</Link></dd>
          <dt>Address</dt>
          <dd>{ticket.url}</dd>
          <dt>Viewport</dt>
          <dd className="num">{v.width} by {v.height} at {v.dpr}x</dd>
          <dt>Theme</dt>
          <dd>{v.theme}</dd>
          <dt>Build</dt>
          <dd>{ticket.build ?? 'Not recorded'}</dd>
          <dt>Written</dt>
          <dd>{ago(ticket.createdAt)}</dd>
        </dl>
      </div>

      <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
        <h2 className="h2">Elements</h2>
        {ticket.targets.length === 0 ? (
          <span className="muted">Nothing was highlighted on this one.</span>
        ) : (
          <ul className="tk-targets">
            {ticket.targets.map((t) => (
              <li key={t.selector}>
                <span className="sel">{t.selector}</span>
                {t.text && <span className="txt">{t.text}</span>}
                {t.label && <span className="txt">Label: {t.label}</span>}
                <span className="txt num">
                  {t.rect.width} by {t.rect.height} at {t.rect.x}, {t.rect.y}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
        <h2 className="h2">Drawing</h2>
        {ticket.drawing ? (
          /* At the aspect it was drawn at, over a neutral ground: the strokes
             are transparent, and their positions only mean anything against
             the shape of the viewport they were made in. */
          <div className="tk-shot" style={{ aspectRatio: `${v.width} / ${v.height}` }}>
            <img src={ticket.drawing} alt="The strokes drawn over the page" />
          </div>
        ) : (
          <span className="muted">Nothing was drawn on this one.</span>
        )}
      </div>
    </main>
  );
}
