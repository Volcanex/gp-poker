import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../net/api.ts';
import type { Ticket, TicketStatus, TicketSummary } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { NotFound } from '../routes/not-found.tsx';
import { ago } from '../routes/feed.tsx';
import './admin.css';

/* The tickets the g-admin overlay writes (agents/g-admin-contract.md at the
   repo root). Two pages: a filtered list, and one ticket in full. Filing and
   editing happen in the overlay itself, armed with `?gadmin=1` on any page
   or the `localStorage['g-admin']` key it sets; this is where an admin
   reviews what came in and pulls a markdown brief for a baking agent.

   Both are gated on the same flag the old admin bar was, and a player who
   guesses the URL gets the site's own not-found page rather than a refusal:
   "you are not allowed here" and "there is nothing here" should look the
   same to somebody who was never meant to find it. */

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

const STATUSES: TicketStatus[] = ['open', 'baked', 'dismissed'];

function titleFor(note: string): string {
  const line = note.split('\n')[0]?.trim() ?? '';
  return line || '(no note)';
}

/* Open and dismissed are the two states this page can move a ticket
   between. A baked ticket is read-only here: baking is the brief flow's job
   (a PATCH from a baking agent once the change lands in source), not a
   click on this page. */
function StatusButton({
  status,
  busy,
  onPick,
}: {
  status: TicketStatus;
  busy: boolean;
  onPick: (next: TicketStatus) => void;
}) {
  if (status === 'baked') return <span className="badge badge-plain">Baked</span>;
  const next: TicketStatus = status === 'open' ? 'dismissed' : 'open';
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
      <span>{status === 'open' ? 'Dismiss' : 'Reopen'}</span>
    </button>
  );
}

function StatusFilter({ status, onPick }: { status: TicketStatus; onPick: (s: TicketStatus) => void }) {
  return (
    <div className="tk-filter" role="group" aria-label="Status">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          className={`btn btn-sm ${status === s ? 'btn-secondary' : 'btn-tertiary'}`}
          aria-pressed={status === s}
          onClick={() => onPick(s)}
        >
          {s[0].toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function AdminTickets() {
  const gate = useAdminGate();
  const nav = useNavigate();
  const [status, setStatus] = useState<TicketStatus>('open');
  const [list, setList] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useTitle('Tickets');

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

  const mark = async (id: string, next: TicketStatus) => {
    setBusy(id);
    try {
      await api.setTicketStatus(id, next);
      setList((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
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
            What the g-admin overlay has written, newest first. Arm it with{' '}
            <code className="mono">?gadmin=1</code> on any page to file one. Each carries the page it
            was seen on, the elements it points at, and any spacing or typography edit made in place.
          </p>
        </div>
        <span className="spacer" />
        <StatusFilter status={status} onPick={setStatus} />
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
            <span className="e-title">Nothing {status}</span>
            <span className="e-desc">
              {status === 'open'
                ? 'Arm the overlay on any page and save an annotation or an edit to write one.'
                : `Tickets moved to ${status} are listed here.`}
            </span>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table tk-rows" aria-label={`${status} tickets`}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Page</th>
                  <th>Kind</th>
                  <th>When</th>
                  <th className="r">Status</th>
                </tr>
              </thead>
              <tbody>
                {(list ?? []).map((t) => (
                  <tr key={t.id} onClick={() => nav(`/admin/tickets/${t.id}`)}>
                    <td>
                      <span className="tk-title-cell">
                        <Link to={`/admin/tickets/${t.id}`}>{titleFor(t.note)}</Link>
                        <span className="muted">
                          {t.elements.length} {t.elements.length === 1 ? 'element' : 'elements'}
                          {t.edits.length > 0 && `, ${t.edits.length} ${t.edits.length === 1 ? 'edit' : 'edits'}`}
                        </span>
                      </span>
                    </td>
                    <td>
                      <Link className="tk-path" to={t.page.path} onClick={(e) => e.stopPropagation()}>
                        {t.page.path}
                      </Link>
                    </td>
                    <td>
                      <span className="badge badge-plain">{t.kind}</span>
                    </td>
                    <td className="tk-when">{ago(t.created_at)}</td>
                    <td className="r">
                      <StatusButton status={t.status} busy={busy === t.id} onPick={(next) => void mark(t.id, next)} />
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
  useTitle(ticket ? titleFor(ticket.note) : 'Ticket');

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

  const mark = async (next: TicketStatus) => {
    setBusy(true);
    try {
      const updated = await api.setTicketStatus(id, next);
      setTicket(updated);
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
          <h1 className="h1">{titleFor(ticket.note)}</h1>
        </div>
        <span className="spacer" />
        <a className="btn btn-tertiary btn-sm" href={`/api/gadmin/tickets/${id}/brief`} target="_blank" rel="noreferrer">
          Open the brief
        </a>
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
          <dd><Link to={ticket.page.path}>{ticket.page.path}</Link></dd>
          <dt>Address</dt>
          <dd>{ticket.page.url}</dd>
          <dt>Viewport</dt>
          <dd className="num">{v.w} by {v.h} at {v.dpr}x</dd>
          <dt>Theme</dt>
          <dd>{v.theme}</dd>
          <dt>Scope</dt>
          <dd>{ticket.scope}</dd>
          <dt>Kind</dt>
          <dd>{ticket.kind}</dd>
          <dt>Severity</dt>
          <dd>{ticket.severity}</dd>
          <dt>Source</dt>
          <dd>{ticket.source}</dd>
          <dt>Written</dt>
          <dd>{ago(ticket.created_at)}</dd>
          {ticket.baked_by && (
            <>
              <dt>Baked by</dt>
              <dd>{ticket.baked_by}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
        <h2 className="h2">Elements</h2>
        {ticket.elements.length === 0 ? (
          <span className="muted">Nothing was pointed at on this one.</span>
        ) : (
          <ul className="tk-targets">
            {ticket.elements.map((el) => (
              <li key={el.selector}>
                <span className="sel">{el.selector}</span>
                <span className="txt num">
                  {el.rect.w} by {el.rect.h} at {el.rect.x}, {el.rect.y}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {ticket.edits.length > 0 && (
        <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
          <h2 className="h2">Edits</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Selector</th>
                  <th>Property</th>
                  <th>From</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                {ticket.edits.map((e, i) => (
                  <tr key={i}>
                    <td className="mono">{e.selector}</td>
                    <td>{e.prop}</td>
                    <td>{e.token_from ?? e.from ?? 'none'}</td>
                    <td>{e.token_to ?? e.to ?? 'none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
        <h2 className="h2">Drawing</h2>
        {ticket.drawing ? (
          /* At the aspect it was drawn at, over a neutral ground: the strokes
             are transparent, and their positions only mean anything against
             the shape of the viewport they were made in. */
          <div className="tk-shot" style={{ aspectRatio: `${v.w} / ${v.h}` }}>
            <img src={ticket.drawing} alt="The strokes drawn over the page" />
          </div>
        ) : (
          <span className="muted">Nothing was drawn on this one.</span>
        )}
      </div>

      {ticket.replies.length > 0 && (
        <div className="card stack" style={{ gap: 'var(--sp-3)' }}>
          <h2 className="h2">Replies</h2>
          <ul className="tk-targets">
            {ticket.replies.map((r, i) => (
              <li key={i}>
                <span className="txt">{r.by}, {ago(r.at)}</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
