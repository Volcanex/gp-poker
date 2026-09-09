import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TournamentEntrant, TournamentSeat, TournamentTable } from '@opentable/protocol';
import { api } from '../net/api.ts';
import { avatarSeed, avatarVersion } from '../net/adapt.ts';
import type { Tournament } from '../net/types.ts';
import { useServerMsg, useSession } from '../net/session.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { FlagSlot } from '../ui/flag.tsx';
import { useNow } from '../ui/bits.tsx';
import { int } from '../ui/format.ts';
import { ordinal } from '../table/labels.ts';
import { useTitle } from '../ui/title.ts';
import {
  entrantsLabel,
  isBracket,
  localStart,
  progressLabel,
  roundName,
  seatOutcome,
  shapeLabel,
  tournamentClock,
} from './tournament-bits.ts';
import { TournamentRegister } from './tournament-card.tsx';
import './home.css';
import './tournaments.css';

/* One tournament: the field before it starts, and the shape of it after.

   The board arrives twice over, the same bargain the arena page makes: once
   from the request this page opens with, and after that pushed over the socket
   to everybody looking at this tournament. The page says which one it is
   showing (`{t:'tournament', id}`, and `null` on unmount) rather than the
   server guessing from who registered, because watching a bracket and being
   in it are different things.

   A heads-up fixture is drawn as a **bracket**: rounds as columns narrowing to
   a final, connectors between them. A six-max fixture is drawn as the
   **funnel**: rounds as bands of tables, the advancing seats marked, the final
   table set apart. One page, because the only thing that differs is the
   drawing. */

const POLL_MS = 10_000;

export function TournamentPage() {
  const { id } = useParams();
  const { me, conn, send } = useSession();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  useTitle(tournament ? tournament.name : 'Tournament');

  const load = useCallback(async () => {
    if (!id) return;
    setTournament(await api.tournament(id));
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    let live = true;
    setTournament(null);
    setLoaded(false);
    setMissing(false);
    load().catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [load]);

  /* A dropped socket takes the subscription with it, since the server tidies
     up on disconnect, so this runs again on every reconnect rather than only
     on mount. */
  useEffect(() => {
    if (!id || conn !== 'open') return;
    send({ t: 'tournament', id });
    return () => send({ t: 'tournament', id: null });
  }, [id, conn, send]);

  useServerMsg((m) => {
    if (m.t !== 'tournament' || m.board.id !== id) return;
    setTournament((prev) =>
      prev
        ? {
            ...prev,
            status: m.board.status,
            round: m.board.round,
            entrants: m.board.entrants,
            rounds: m.board.rounds,
            you: m.board.you,
            registered: m.board.you?.registered ?? false,
          }
        : prev
    );
    /* A status change carries work the board does not: the podium and every
       place are written when the tournament finishes, and the row is what
       holds them. */
    if (m.board.status === 'finished' || m.board.status === 'cancelled') void load().catch(() => {});
  });

  // The fallback for a page whose socket never opened. It stops once the
  // tournament is settled, because a finished field has nothing more to say.
  const connected = conn === 'open';
  const live = tournament?.status === 'upcoming' || tournament?.status === 'running';
  useEffect(() => {
    if (!live || connected) return;
    const timer = setInterval(() => void load().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [live, connected, load]);

  if (missing) {
    return (
      <Shell>
        <div className="card">
          <div className="empty">
            <h1 className="e-title">No tournament here</h1>
            <span className="e-desc">The link may be old. There is a fixture every day.</span>
            <Link className="btn btn-secondary btn-sm" to="/tournaments">
              See what is coming up
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!tournament) {
    return (
      <Shell>
        {loaded ? null : (
          <div className="card resting-card" aria-busy="true" data-enter-ready="no">
            <span className="sr-only" role="status">Opening the tournament</span>
            <span className="skeleton skeleton-text" style={{ width: 180 }} />
            <span className="skeleton skeleton-text" style={{ width: 300 }} />
            <span className="skeleton skeleton-text" style={{ width: 240 }} />
          </div>
        )}
      </Shell>
    );
  }

  const meId = me?.id ?? null;

  return (
    <Shell>
      <Hero tournament={tournament} onDone={load} />
      {tournament.status === 'upcoming' ? (
        <Field entrants={tournament.entrantList} meId={meId} />
      ) : tournament.status === 'cancelled' ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">This one was not played</span>
            <span className="e-desc">
              The field was under the minimum when it started, so nobody was seeded. The next fixture
              is already open.
            </span>
            <Link className="btn btn-secondary btn-sm" to="/tournaments">
              See what is coming up
            </Link>
          </div>
        </div>
      ) : isBracket(tournament.shape) ? (
        <Bracket rounds={tournament.rounds} meId={meId} />
      ) : (
        <Funnel rounds={tournament.rounds} meId={meId} />
      )}
      {tournament.status !== 'upcoming' && <Standings entrants={tournament.entrantList} meId={meId} />}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page wide stack">
      {children}
    </main>
  );
}

/* The card that says what this is, when it is, and the one thing to do about
   it. The same card in every state, so the page does not jump between a
   fixture waiting to start and one that is playing. */
function Hero({ tournament, onDone }: { tournament: Tournament; onDone: () => Promise<void> }) {
  const now = useNow(tournament.status === 'upcoming', 1000);
  const clock = tournamentClock(tournament, now);
  const podium = tournament.podium ?? [];

  return (
    <div className="card mode tourney-hero">
      <div className="mode-head">
        <span className="t">{tournament.name}</span>
        <span className="spacer" />
        <span className={`badge ${clock.kind === 'starts' || clock.kind === 'playing' ? 'badge-ok' : 'badge-plain'}`}>
          {clock.label}
        </span>
      </div>
      <span className="muted">{tournament.blurb}</span>
      <span className="tourney-when">{localStart(tournament.startsAt)}</span>
      <span className="tags">
        <span className="badge badge-plain">{shapeLabel(tournament.shape)}</span>
        <span className="badge badge-plain num">{entrantsLabel(tournament)}</span>
        <span className="badge badge-plain">{progressLabel(tournament)}</span>
        {tournament.you?.seed && <span className="badge badge-plain num">You are seed {tournament.you.seed}</span>}
        {tournament.you?.place && (
          <span className="badge badge-plain num">You came {ordinal(tournament.you.place)}</span>
        )}
      </span>
      {podium.length > 0 && (
        <ol className="arena-podium">
          {podium.map((place) => (
            <li key={place.uid}>
              <span className="muted">{ordinal(place.place)}</span>
              <Avatar
                seed={avatarSeed(place.uid, place.name)}
                name={place.name}
                size={20}
                avatarV={avatarVersion(place.avatarV)}
              />
              <Link className="n" to={`/u/${encodeURIComponent(place.name)}`}>
                {place.name}
              </Link>
            </li>
          ))}
        </ol>
      )}
      <TournamentRegister card={tournament} onDone={onDone} />
      {tournament.status === 'upcoming' && !tournament.registered && (
        <span className="muted">No account needed. You play as a guest and can claim the name later.</span>
      )}
      {tournament.status === 'upcoming' && tournament.registered && (
        <span className="muted">
          Your first table is offered when the tournament starts. Answer it inside twenty seconds or
          you are out, and nothing else is charged for it.
        </span>
      )}
      {tournament.note && <span className="muted">{tournament.note}</span>}
    </div>
  );
}

/* The field before the start: the entrant list by seed, which before the
   seeding is drawn is the order the seeding will take, since it is ordered by
   the rating it will be computed from. */
function Field({ entrants, meId }: { entrants: TournamentEntrant[]; meId: string | null }) {
  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="feed-head">
        <span className="h2">Entrants</span>
        <span className="spacer" />
        <span className="muted">Seeded by rating when the tournament starts</span>
      </div>
      <div className="card lb-card">
        {entrants.length === 0 ? (
          <div className="empty">
            <span className="e-title">Nobody has entered yet</span>
            <span className="e-desc">The field fills in as people register.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Entrants">
              <thead>
                <tr>
                  <th className="r" style={{ width: 34 }}>#</th>
                  <th>Player</th>
                  <th className="r">Rating</th>
                </tr>
              </thead>
              <tbody>
                {entrants.map((entrant, i) => (
                  <tr key={entrant.uid} data-mine={entrant.uid === meId ? '' : undefined}>
                    <td className="r num">{entrant.seed ?? i + 1}</td>
                    <td>
                      <span className="player-cell">
                        <Avatar
                          seed={avatarSeed(entrant.uid, entrant.name)}
                          name={entrant.name}
                          size={24}
                          avatarV={avatarVersion(entrant.avatarV)}
                        />
                        <FlagSlot code={entrant.country} size={16} />
                        <Link to={`/u/${encodeURIComponent(entrant.name)}`}>{entrant.name}</Link>
                        {entrant.bot && <span className="bot-tag">Bot</span>}
                      </span>
                    </td>
                    <td className="r num">{int(entrant.rating)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* The bracket. Rounds as columns, each match a small card, the winner marked.
   Every column is the same height and every match sits in an equal share of
   it, which is what makes a card in one round line up with the midpoint of the
   two that feed it. The connectors are drawn from that in CSS
   (`tournaments.css`), so nothing here measures anything. */
function Bracket({ rounds, meId }: { rounds: TournamentTable[][]; meId: string | null }) {
  if (rounds.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="feed-head">
        <span className="h2">The bracket</span>
        <span className="spacer" />
        <span className="muted">The winner of each match goes through</span>
      </div>
      <div className="bracket-wrap">
        <div className="bracket-head" aria-hidden="true">
          {rounds.map((_, i) => (
            <span className="muted" key={i}>
              {roundName(rounds, i + 1)}
            </span>
          ))}
        </div>
        <div className="bracket">
          {rounds.map((tables, i) => (
            <div className="bracket-round" key={i}>
              {tables.map((table) => (
                <div className="bracket-slot" key={table.table}>
                  <BracketMatch table={table} meId={meId} round={roundName(rounds, i + 1, 'bracket')} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BracketMatch({
  table,
  meId,
  round,
}: {
  table: TournamentTable;
  meId: string | null;
  round: string;
}) {
  const mine = table.seats.some((s) => s.uid === meId);
  const label = table.bye && table.status === 'done' ? (table.seats.length === 1 ? 'Bye' : 'Walkover') : null;

  return (
    <div
      className="bracket-card"
      data-live={table.status === 'playing' ? '' : undefined}
      data-mine={mine ? '' : undefined}
    >
      {table.matchId && (
        <Link
          className="row-link"
          to={`/m/${table.matchId}`}
          aria-label={`${round}, ${table.seats.map((s) => s.name).join(' against ')}`}
        />
      )}
      {table.seats.length === 0 ? (
        <span className="muted bracket-empty">Nobody came through</span>
      ) : (
        table.seats.map((seat) => <BracketSeat key={seat.uid} seat={seat} meId={meId} />)
      )}
      {label && <span className="bracket-note muted">{label}</span>}
      {table.status === 'playing' && <span className="bracket-note badge badge-ok">Playing</span>}
    </div>
  );
}

function BracketSeat({ seat, meId }: { seat: TournamentSeat; meId: string | null }) {
  return (
    <span
      className="bracket-seat"
      data-through={seat.advanced ? '' : undefined}
      data-mine={seat.uid === meId ? '' : undefined}
    >
      <span className="bracket-seed num">{seat.seed}</span>
      <FlagSlot code={seat.country} size={12} />
      <span className="n">{seat.name}</span>
      <span className="bracket-rating num muted">{int(seat.rating)}</span>
    </span>
  );
}

/* The funnel. Rounds as bands, each table a card listing its seats with the
   place they took, the advancing seats marked, and the final table set apart
   because its places are the tournament's places. */
function Funnel({ rounds, meId }: { rounds: TournamentTable[][]; meId: string | null }) {
  if (rounds.length === 0) return null;
  return (
    <section className="stack funnel" style={{ gap: 'var(--sp-4)' }}>
      {rounds.map((tables, i) => {
        const advance = tables[0]?.advance ?? 0;
        const final = tables.length === 1;
        return (
          <section className="stack funnel-band" key={i} data-final={final ? '' : undefined}>
            {/* The advancing rule is the round's own rule and not a subtitle,
                so it is not the `.feed-head` line that the site drops on a
                phone: how many go through is the whole shape of the round. */}
            <div className="funnel-head">
              <span className="h2">{roundName(rounds, i + 1)}</span>
              <span className="muted funnel-rule">
                {final
                  ? 'The places at this table are the places'
                  : `The top ${advance} of each table go through`}
              </span>
            </div>
            <div className="funnel-tables">
              {tables.map((table) => (
                <FunnelTable key={table.table} table={table} meId={meId} final={final} />
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function FunnelTable({
  table,
  meId,
  final,
}: {
  table: TournamentTable;
  meId: string | null;
  final: boolean;
}) {
  const mine = table.seats.some((s) => s.uid === meId);
  return (
    <div className="card funnel-table" data-mine={mine ? '' : undefined} data-final={final ? '' : undefined}>
      <div className="mode-head">
        <span className="t">{final ? 'Final table' : `Table ${table.table + 1}`}</span>
        <span className="spacer" />
        {table.status === 'playing' && <span className="badge badge-ok">Playing</span>}
        {table.status === 'pending' && <span className="badge badge-plain">Waiting</span>}
        {table.bye && table.status === 'done' && <span className="badge badge-plain">No hand dealt</span>}
      </div>
      <ol className="funnel-seats">
        {table.seats.map((seat) => (
          <li
            key={seat.uid}
            data-through={seat.advanced ? '' : undefined}
            data-mine={seat.uid === meId ? '' : undefined}
          >
            <span className="bracket-seed num">{seat.seed}</span>
            <FlagSlot code={seat.country} size={12} />
            <Link className="n" to={`/u/${encodeURIComponent(seat.name)}`}>
              {seat.name}
            </Link>
            <span className="spacer" />
            <span className="num muted">{seatOutcome(seat) ?? ''}</span>
          </li>
        ))}
      </ol>
      {table.matchId && (
        <Link className="btn btn-secondary btn-sm" to={`/m/${table.matchId}`}>
          {table.status === 'done' ? 'See the table' : 'Watch this table'}
        </Link>
      )}
    </div>
  );
}

/* Where everybody came. Written for the whole field when the tournament
   finishes, which is why it is a place and not a round: everybody eliminated
   in the same round shares a place, the way a bracket has always been read. */
function Standings({ entrants, meId }: { entrants: TournamentEntrant[]; meId: string | null }) {
  const placed = entrants.filter((e) => e.place !== null);
  if (placed.length === 0) return null;
  const sorted = [...placed].sort((a, b) => (a.place ?? 0) - (b.place ?? 0));

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="feed-head">
        <span className="h2">Places</span>
        <span className="spacer" />
        <span className="muted">Everybody out in the same round shares a place</span>
      </div>
      <div className="card lb-card">
        <div className="table-wrap">
          <table className="table" aria-label="Places">
            <thead>
              <tr>
                <th className="r" style={{ width: 44 }}>Place</th>
                <th>Player</th>
                <th className="r">Seed</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entrant) => (
                <tr key={entrant.uid} data-mine={entrant.uid === meId ? '' : undefined}>
                  <td className="r num">{entrant.place}</td>
                  <td>
                    <span className="player-cell">
                      <Avatar
                        seed={avatarSeed(entrant.uid, entrant.name)}
                        name={entrant.name}
                        size={24}
                        avatarV={avatarVersion(entrant.avatarV)}
                      />
                      <FlagSlot code={entrant.country} size={16} />
                      <Link to={`/u/${encodeURIComponent(entrant.name)}`}>{entrant.name}</Link>
                      {entrant.bot && <span className="bot-tag">Bot</span>}
                      {entrant.withdrawn && <span className="seat-you">Withdrew</span>}
                    </span>
                  </td>
                  <td className="r num">{entrant.seed ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
