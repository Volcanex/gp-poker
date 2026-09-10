import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from '@phosphor-icons/react/dist/icons/Trophy';
import { api, ApiError } from '../net/api.ts';
import type { TournamentCard as Card, TournamentListing } from '../net/types.ts';
import { useNow } from '../ui/bits.tsx';
import { entrantsLabel, localStart, tournamentClock } from './tournament-bits.ts';

/* The register control, and the home page's card around it.

   Both are here rather than in either page because the two need exactly the
   same control: a card on the home page that pointed at the tournaments page
   to be registered on would be a card that says what is coming up and then
   makes you go somewhere else to enter it. */

/* Register or withdraw, in place. `onDone` is how the page that owns the data
   refetches it: the control never edits a copy of its own, so a field count
   and a "you are in" badge cannot disagree with the server. */
export function TournamentRegister({
  card,
  onDone,
  small,
}: {
  card: Card;
  onDone: () => Promise<void> | void;
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'The tournament did not answer. Try again in a moment.');
      } finally {
        setBusy(false);
        await onDone();
      }
    },
    [onDone]
  );

  if (card.status !== 'upcoming') return null;
  const size = small ? ' btn-sm' : '';

  return (
    <>
      {card.registered ? (
        <div className="row-actions">
          <span className="badge badge-ok">You are in</span>
          <button
            type="button"
            className={`btn btn-tertiary${size}`}
            disabled={busy}
            onClick={() => void run(() => api.withdrawTournament(card.id))}
          >
            Withdraw
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`btn btn-primary${size}`}
          disabled={busy}
          onClick={() => void run(() => api.registerTournament(card.id))}
        >
          Register
        </button>
      )}
      {error && <span className="badge badge-warn">{error}</span>}
    </>
  );
}

/* One upcoming fixture, as the tournaments page draws it: what it is, when it
   is in the reader's own evening, how full it is, and the one control that
   puts them in it. */
export function UpcomingCard({ card, onDone }: { card: Card; onDone: () => Promise<void> | void }) {
  const now = useNow(true, 1000);
  const clock = tournamentClock(card, now);

  return (
    <div className="card mode tourney-card">
      <div className="mode-head">
        <span className="t">{card.name}</span>
      </div>
      <span className="muted">{card.blurb}</span>
      {/* The time is the fact and the countdown is the gloss on it, so the
          badges sit under it rather than beside the name: a card a third of the
          page wide has no room in its heading for a phrase that grows. */}
      <span className="tourney-when">{localStart(card.startsAt)}</span>
      <span className="tags tourney-tags">
        <span className={`badge ${clock.kind === 'starts' ? 'badge-ok' : 'badge-plain'}`}>{clock.label}</span>
        <span className="badge badge-plain num">{entrantsLabel(card)}</span>
      </span>
      <TournamentRegister card={card} onDone={onDone} />
      <Link className="btn btn-secondary btn-sm" to={`/t/${card.id}`}>
        See the field
      </Link>
    </div>
  );
}

/* The home page's slot. The three fixtures coming up, each one line, with the
   control that enters them and a link to the page that draws the field. It
   fetches for itself, like the three teasers above it. */
export function TournamentsCard() {
  const [listing, setListing] = useState<TournamentListing | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow(listing !== null, 1000);

  const load = useCallback(async () => {
    const next = await api.tournaments();
    setListing(next);
  }, []);

  useEffect(() => {
    let live = true;
    api
      .tournaments()
      .then((l) => live && setListing(l))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const upcoming = listing?.upcoming ?? [];

  return (
    <div className="card side-card tourney-home" data-enter-ready={listing || failed ? 'yes' : 'no'}>
      <span className="t">
        <Trophy size={16} aria-hidden="true" />
        Tournaments
      </span>
      {upcoming.length === 0 ? (
        <span className="muted">
          {failed ? 'The next fixtures are being scheduled.' : 'A field that plays down to one, on a fixed calendar.'}
        </span>
      ) : (
        <ul className="tourney-list">
          {upcoming.map((card) => (
            <li key={card.id}>
              {/* The name has the row to itself: a fixture called the monthly
                  championship truncates to nothing beside a countdown in a
                  column this narrow. */}
              <Link className="n tourney-list-name" to={`/t/${card.id}`}>
                {card.name}
              </Link>
              <span className="tourney-list-when">
                <span>{localStart(card.startsAt)}</span>
                <span className="muted num">{tournamentClock(card, now).label}</span>
              </span>
              <span className="tourney-list-foot">
                <span className="muted num">{entrantsLabel(card)}</span>
                <TournamentRegister card={card} onDone={load} small />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link className="btn btn-secondary" to="/tournaments">
        See the tournaments
      </Link>
    </div>
  );
}
