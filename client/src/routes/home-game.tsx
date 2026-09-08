import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { botLevelInfo, formatFor } from '@opentable/protocol';
import { api, ApiError } from '../net/api.ts';
import { avatarSeed } from '../net/adapt.ts';
import type { HomeGame } from '../net/types.ts';
import { useServerMsg, useSession } from '../net/session.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { ShareLink } from '../ui/share-link.tsx';
import { int } from '../ui/format.ts';
import { useTitle } from '../ui/title.ts';
import { expiryLine, lobbyLayout, startBlurb } from './home-game-seats.ts';
import './home.css';

/* The home game lobby: one private six-max table, one link, and a host who
   decides when it starts. The page is the same for everybody who opens it and
   differs only in what they are allowed to do with it: the host starts or
   cancels, a guest joins or leaves, and everyone watches the seats fill.

   The seats arrive twice over: once from the request this page makes, and
   after that from the socket, which is pushed to everybody seated whenever
   anybody sits down or gets up. A page whose socket is not open falls back to
   asking again every few seconds, so a lobby is never stale for long. */

const POLL_MS = 5_000;

export function HomeGame() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { me, conn, clearFound } = useSession();
  const [game, setGame] = useState<HomeGame | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle(game ? `${game.host.name}'s table` : null);

  const load = useCallback(
    () =>
      api
        .homeGame(id)
        .then(setGame)
        .catch(() => setMissing(true)),
    [id]
  );

  useEffect(() => {
    let live = true;
    setGame(null);
    setMissing(false);
    api
      .homeGame(id)
      .then((g) => live && setGame(g))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  /* The seats as the server sees them, pushed to everybody sitting at the
     table. Status is the one field worth a second request: a lobby that just
     started carries a match id this message does not. */
  useServerMsg((m) => {
    if (m.t === 'lobby' && m.g === id) {
      setGame((prev) => (prev ? { ...prev, seats: m.seats, status: m.status } : prev));
      if (m.status !== 'open') void load();
    } else if (m.t === 'q' && m.s === 'found' && m.m) {
      // The table opened. Everyone seated is told this way, host included.
      const match = m.m;
      clearFound();
      nav(`/m/${match}`);
    }
  });

  /* The fallback for a page whose socket never opened: the same answer, asked
     for rather than pushed. It stops the moment the lobby is spent. */
  const open = game?.status === 'open';
  const connected = conn === 'open';
  useEffect(() => {
    if (!open || connected) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, connected, load]);

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await run();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'the table did not answer. Try again in a moment.');
      } finally {
        setBusy(false);
        await load();
      }
    },
    [load]
  );

  if (missing) {
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">This link does not work</h1>
          <span className="e-desc">It may be mistyped. Start a match from the home page instead.</span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </Shell>
    );
  }

  if (!game) {
    return (
      <Shell>
        <div className="searching">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Opening the table</span>
        </div>
      </Shell>
    );
  }

  const host = me?.id === game.host.id;
  const seated = game.seats.some((s) => s.uid === me?.id);
  const layout = lobbyLayout(game.seats, game.players, game.botLevel);

  if (game.status === 'cancelled' || game.status === 'expired') {
    const expired = game.status === 'expired';
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">{expired ? 'This link has expired' : 'This table was cancelled'}</h1>
          <span className="e-desc">
            {expired
              ? 'A home game link works for 24 hours. Ask for a new one, or play the queue instead.'
              : `${game.host.name} took this table back. Ask for a new one, or play the queue instead.`}
          </span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </Shell>
    );
  }

  if (game.status === 'started') {
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">This table has started</h1>
          <span className="e-desc">
            {seated ? 'You are dealt in. The table is this way.' : 'It filled up and dealt without you.'}
          </span>
          <span className="tags">
            {game.matchId && (
              <Link className="btn btn-primary btn-sm" to={`/m/${game.matchId}`}>
                {seated ? 'Go to your table' : 'Watch the table'}
              </Link>
            )}
            <Link className="btn btn-tertiary btn-sm" to="/">Go to the home page</Link>
          </span>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mode-head">
        <span className="player-cell">
          <Avatar seed={avatarSeed(game.host.id, game.host.name)} name={game.host.name} />
          <h1 className="t">{host ? 'Your home game' : `${game.host.name}'s home game`}</h1>
        </span>
      </div>
      <span className="tags">
        <span className="badge badge-plain">Six-max</span>
        <span className="badge badge-plain">{game.rated ? 'Rated' : 'Casual'}</span>
        <span className="badge badge-plain">{botLevelInfo(game.botLevel).name} bots</span>
      </span>
      <span className="muted">{sixMaxBlurb()}</span>

      <ul className="lobby-seats">
        {layout.chairs.map((chair, i) =>
          chair.kind === 'taken' ? (
            <li className="lobby-seat" key={chair.seat.uid}>
              <Avatar seed={avatarSeed(chair.seat.uid, chair.seat.name)} name={chair.seat.name} size={28} />
              <span className="lobby-who">
                <span className="n">{chair.seat.name}</span>
                <span className="muted num">Rated {int(chair.seat.rating)} at six-max</span>
              </span>
              {chair.seat.host && <span className="badge badge-plain">Host</span>}
              {chair.seat.uid === me?.id && <span className="badge badge-plain">You</span>}
            </li>
          ) : (
            <li className="lobby-seat" data-empty="" key={`empty-${i}`}>
              <span className="pip" aria-hidden="true" />
              <span className="lobby-who">
                <span className="n">Open seat</span>
                <span className="muted">Level {chair.level} bot if nobody takes it</span>
              </span>
            </li>
          )
        )}
      </ul>

      {error && <span className="badge badge-warn">{error}</span>}

      {host ? (
        <>
          <span className="muted">{startBlurb(layout.humans, layout.bots, game.rated)}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => act(() => api.startHomeGame(id))}
          >
            Start the game
          </button>
          <ShareLink url={`${location.origin}/g/${game.id}`} what="table" />
          <span className="muted">{expiryLine(game.expiresAt)}</span>
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            disabled={busy}
            onClick={() => act(() => api.cancelHomeGame(id))}
          >
            Cancel the table
          </button>
        </>
      ) : seated ? (
        <>
          <span className="muted">
            You have a seat. {game.host.name} starts the table when they are ready.
          </span>
          <ShareLink url={`${location.origin}/g/${game.id}`} what="table" />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => act(() => api.leaveHomeGame(id))}
          >
            Leave the table
          </button>
        </>
      ) : layout.full ? (
        <>
          <span className="muted">Every seat is taken. Ask {game.host.name} to make room.</span>
          <Link className="btn btn-secondary" to="/">Go to the home page</Link>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => act(() => api.joinHomeGame(id))}
          >
            Join the table
          </button>
          <span className="muted">
            No account needed. You are dealt in as a guest and can claim the name later.
          </span>
        </>
      )}
    </Shell>
  );
}

/* The promise on the page is built from the format the table will actually be
   dealt on, so it cannot drift from the match it opens. */
function sixMaxBlurb(): string {
  const f = formatFor('six-max', true);
  return `Last player standing. ${f.players} seats, ${f.stack} units each, blinds climb every ${f.levelHands} hands.`;
}

/* The same card in every state, so the page does not jump as the lobby loads
   and the buttons land where the spinner was. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page stack">
      <section className="hero">
        <div className="card mode" style={{ maxWidth: 460 }}>{children}</div>
      </section>
    </main>
  );
}
