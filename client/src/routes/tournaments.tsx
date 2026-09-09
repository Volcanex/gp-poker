import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../net/api.ts';
import type { TournamentCard as Card, TournamentListing } from '../net/types.ts';
import { useNow } from '../ui/bits.tsx';
import { useTitle } from '../ui/title.ts';
import { fmtShortDate } from '../ui/format.ts';
import { entrantsLabel, localStart, shapeLabel, tournamentClock } from './tournament-bits.ts';
import { UpcomingCard } from './tournament-card.tsx';
import './home.css';
import './tournaments.css';

/* The tournaments page: what is open, what is playing, and what has been
   played.

   Three fixtures are open at a time and no more, because the scheduler writes
   each kind's next row as soon as the previous one starts. That is why the top
   of this page is three cards and not a list: the calendar is fixed, so there
   is nothing to scroll through. */

const PAGE = 10;

export function Tournaments() {
  const [listing, setListing] = useState<TournamentListing | null>(null);
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState(false);
  useTitle('Tournaments');

  const load = useCallback(async () => {
    setListing(await api.tournaments(page));
  }, [page]);

  useEffect(() => {
    let live = true;
    setFailed(false);
    api
      .tournaments(page)
      .then((l) => live && setListing(l))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [page]);

  const daily = listing?.upcoming.find((c) => c.note);

  return (
    <main className="page stack">
      <section className="hero">
        <h1 className="h1">Tournaments</h1>
        <p className="lede">
          A field that plays down to one. Three fixtures on a fixed calendar: a{' '}
          <b>daily heads-up bracket</b>, a Sunday shootout, and a championship on the first Sunday of
          the month. No buy-in, and nothing to win but the result.
        </p>
      </section>

      <section className="stack tourney-open">
        <div className="feed-head">
          <span className="h2">Coming up</span>
          <span className="spacer" />
          <span className="muted">Three at a time, no more</span>
        </div>
        {listing ? (
          listing.upcoming.length > 0 ? (
            <div className="tourney-grid">
              {listing.upcoming.map((card) => (
                <UpcomingCard key={card.id} card={card} onDone={load} />
              ))}
            </div>
          ) : (
            <div className="card">
              <div className="empty">
                <span className="e-title">Nothing is scheduled</span>
                <span className="e-desc">Reload in a moment. There is normally a fixture every day.</span>
              </div>
            </div>
          )
        ) : (
          <div className="card resting-card" aria-busy="true" data-enter-ready="no">
            <span className="sr-only" role="status">
              {failed ? 'The tournaments did not answer' : 'Opening the tournaments'}
            </span>
            <span className="skeleton skeleton-text" style={{ width: 180 }} />
            <span className="skeleton skeleton-text" style={{ width: 300 }} />
            <span className="skeleton skeleton-text" style={{ width: 240 }} />
          </div>
        )}
        {daily?.note && <span className="muted">{daily.note}</span>}
      </section>

      {listing && listing.running.length > 0 && (
        <section className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="feed-head">
            <span className="h2">Playing now</span>
            <span className="spacer" />
            <span className="muted">Every table is a public page</span>
          </div>
          <div className="card feed-card">
            {listing.running.map((card) => (
              <RunningRow key={card.id} card={card} />
            ))}
          </div>
        </section>
      )}

      {listing && <Results listing={listing} page={page} onPage={setPage} />}
    </main>
  );
}

function RunningRow({ card }: { card: Card }) {
  return (
    <div className="feed-row tourney-row">
      <Link className="row-link" to={`/t/${card.id}`} aria-label={`${card.name}, playing now`} />
      <span className="tagset">
        <span className="badge badge-ok">Playing now</span>
      </span>
      <span className="tourney-row-name">
        <span className="n">{card.name}</span>
        <span className="muted">{shapeLabel(card.shape)}</span>
      </span>
      <span className="feed-meta">
        <span className="num">{entrantsLabel(card)}</span>
      </span>
    </div>
  );
}

/* The results, newest first and paged. A cancelled fixture is in the list
   rather than hidden: a day nobody turned up to is part of the record, and a
   calendar that quietly skipped it would read as a scheduling fault. */
function Results({
  listing,
  page,
  onPage,
}: {
  listing: TournamentListing;
  page: number;
  onPage: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(listing.total / PAGE));

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="feed-head">
        <span className="h2">Already played</span>
        <span className="spacer" />
        <span className="muted">Every field stays readable</span>
      </div>
      <div className="card feed-card">
        {listing.finished.length === 0 ? (
          <div className="empty">
            <span className="e-title">Nothing has been played yet</span>
            <span className="e-desc">The first result appears here once a fixture finishes.</span>
          </div>
        ) : (
          listing.finished.map((card) => <ResultRow key={card.id} card={card} />)
        )}
      </div>
      {pages > 1 && (
        <div className="g-pages">
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            Newer
          </button>
          <span className="muted num">
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            disabled={page + 1 >= pages}
            onClick={() => onPage(page + 1)}
          >
            Older
          </button>
        </div>
      )}
    </section>
  );
}

function ResultRow({ card }: { card: Card }) {
  const now = useNow(false);
  const clock = tournamentClock(card, now);
  return (
    <div className="feed-row tourney-row">
      <Link className="row-link" to={`/t/${card.id}`} aria-label={`${card.name}, ${localStart(card.startsAt)}`} />
      <span className="tagset">
        <span className="badge badge-plain">{fmtShortDate(card.startsAt)}</span>
      </span>
      <span className="tourney-row-name">
        <span className="n">{card.name}</span>
        <span className="muted">
          {card.status === 'cancelled' ? clock.label : card.winner ? `Won by ${card.winner}` : 'No result'}
        </span>
      </span>
      <span className="feed-meta">
        <span className="num">{entrantsLabel(card)}</span>
      </span>
    </div>
  );
}
