import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatFor } from '@opentable/protocol';
import type { ArenaStanding } from '@opentable/protocol';
import { api, ApiError } from '../net/api.ts';
import { avatarSeed } from '../net/adapt.ts';
import type { Arena, ArenaSummary } from '../net/types.ts';
import { useServerMsg, useSession } from '../net/session.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { useNow } from '../ui/bits.tsx';
import { int } from '../ui/format.ts';
import { ordinal } from '../table/labels.ts';
import { useTitle } from '../ui/title.ts';
import { arenaClock, boardRows, onFire, podiumLabel, record } from './arena-bits.ts';
import { ago } from './feed.tsx';
import './home.css';
import './arena.css';

/* The arena: an event every hour, half an hour long, that pairs you again the
   moment your match ends.

   The board arrives twice over, the same bargain the home game lobby makes:
   once from the request this page opens with, and after that pushed over the
   socket to everybody looking at this arena. A page whose socket is not open
   falls back to asking again, which is why the poll exists at all.

   `/arena` is whichever arena is running, or the next one if none is. An
   arena has its own address as well (`/arena/:id`), and a finished one stays
   readable there for good. */

const POLL_MS = 10_000;

export function ArenaPage() {
  const { id: routeId } = useParams();
  const nav = useNavigate();
  const { me, conn, clearFound, send } = useSession();
  const [arena, setArena] = useState<Arena | null>(null);
  const [finished, setFinished] = useState<ArenaSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle(arena ? arena.name : 'Arena');

  const id = routeId ?? arena?.id ?? null;

  const load = useCallback(async () => {
    if (routeId) {
      setArena(await api.arena(routeId));
    } else {
      const listing = await api.arenas();
      setArena(listing.featured);
      setFinished(listing.finished);
    }
    setLoaded(true);
  }, [routeId]);

  useEffect(() => {
    let live = true;
    setArena(null);
    setLoaded(false);
    setMissing(false);
    load().catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [load]);

  /* Watching a board is a thing only this page knows it is doing, so it says
     so, and says when it stops. The server pushes to whoever is watching.

     A dropped socket takes the subscription with it (the server tidies up on
     disconnect, so a closed tab does not sit in the register for good), which
     is why this runs again on every reconnect rather than only on mount. */
  useEffect(() => {
    if (!id || conn !== 'open') return;
    send({ t: 'arena', a: id });
    return () => send({ t: 'arena', a: null });
  }, [id, conn, send]);

  useServerMsg((m) => {
    if (m.t === 'arena' && m.a === id) {
      setArena((prev) =>
        prev
          ? {
              ...prev,
              standings: m.standings,
              you: m.you,
              status: m.status,
              playing: m.playing,
              players: Math.max(prev.players, m.standings.length),
            }
          : prev
      );
      // A status change carries work this message does not: the podium is
      // written when an arena closes, and the row is what holds it.
      if (m.status === 'finished') void load().catch(() => {});
    } else if (m.t === 'q' && m.s === 'found' && m.m) {
      // Paired. The page walks to the table itself, so no toast follows it.
      const match = m.m;
      clearFound();
      nav(`/m/${match}`);
    }
  });

  /* The fallback for a page whose socket never opened. It stops once the
     arena is over, because a frozen board has nothing more to say. */
  const connected = conn === 'open';
  const live = arena?.status !== 'finished';
  useEffect(() => {
    if (!live || connected) return;
    const timer = setInterval(() => void load().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [live, connected, load]);

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await run();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'the arena did not answer. Try again in a moment.');
      } finally {
        setBusy(false);
        await load().catch(() => {});
      }
    },
    [load]
  );

  if (missing) {
    return (
      <Shell>
        <div className="card">
          <div className="empty">
            <h1 className="e-title">No arena here</h1>
            <span className="e-desc">The link may be old. There is an arena every hour.</span>
            <Link className="btn btn-secondary btn-sm" to="/arena">See the next arena</Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {arena ? (
        <>
          <HeroCard arena={arena} busy={busy} error={error} onAct={act} meId={me?.id ?? null} />
          <Standings arena={arena} meId={me?.id ?? null} />
        </>
      ) : loaded ? (
        /* Answered, with no arena in it. The schedule is stocked by the call
           this page just made, so this is a server that could not write one
           rather than a quiet moment between arenas. */
        <div className="card">
          <div className="empty">
            <span className="e-title">No arena is scheduled</span>
            <span className="e-desc">Reload in a moment. There is normally one every hour.</span>
          </div>
        </div>
      ) : (
        /* The frame the arena is about to fill, rather than a spinner: the
           card keeps its place and its shape, and the arena enters into it. */
        <div className="card resting-card" aria-busy="true" data-enter-ready="no">
          <span className="sr-only" role="status">Opening the arena</span>
          <span className="skeleton skeleton-text" style={{ width: 160 }} />
          <span className="skeleton skeleton-text" style={{ width: 280 }} />
          <span className="skeleton skeleton-text" style={{ width: 210 }} />
        </div>
      )}
      {!routeId && <FinishedArenas arenas={finished} />}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page stack">
      <section className="hero">
        <h1 className="h1">Arena</h1>
        <p className="lede">
          An arena every hour, half an hour long. Join it and you are paired again the moment your
          match ends. <b>A win is worth two</b>, a draw one, and a third win in a row is worth three.
        </p>
      </section>
      {children}
    </main>
  );
}

/* The card that says what is happening and gives you the one thing to do
   about it. It is the same card in every state, so the page does not jump
   between an arena that is waiting to start and one that is running. */
function HeroCard({
  arena,
  busy,
  error,
  onAct,
  meId,
}: {
  arena: Arena;
  busy: boolean;
  error: string | null;
  onAct: (run: () => Promise<unknown>) => Promise<void>;
  meId: string | null;
}) {
  // A second is the right beat for a clock that reads in minutes: it is what
  // makes the last minute count down rather than jump.
  const now = useNow(arena.status !== 'finished', 1000);
  const clock = arenaClock(arena, now);
  const joined = arena.you !== null;
  const over = arena.status === 'finished';
  const format = formatFor('heads-up', true);

  return (
    <div className="card mode arena-hero">
      <div className="mode-head">
        <span className="t">{arena.name}</span>
        <span className="spacer" />
        <span className={`badge ${clock.kind === 'ends' ? 'badge-ok' : 'badge-plain'}`}>{clock.label}</span>
      </div>
      <span className="muted">
        Best of {format.hands} hands, {format.stack} units each. Every match is rated, and a bot fills
        the seat when nobody else is waiting.
      </span>
      <span className="tags">
        <span className="badge badge-plain num">
          {arena.players} {arena.players === 1 ? 'player' : 'players'}
        </span>
        {arena.playing > 0 && <span className="badge badge-plain num">{arena.playing} playing</span>}
        {arena.you && (
          <span className="badge badge-plain num">
            You are {ordinal(arena.you.rank)} on {arena.you.score}
          </span>
        )}
      </span>

      {error && <span className="badge badge-warn">{error}</span>}

      {over ? (
        <>
          {arena.podium && arena.podium.length > 0 && (
            <ol className="arena-podium">
              {arena.podium.map((place) => (
                <li key={place.uid}>
                  <span className="muted">{podiumLabel(place.place)}</span>
                  <Avatar seed={avatarSeed(place.uid, place.name)} name={place.name} size={20} />
                  <Link className="n" to={`/u/${encodeURIComponent(place.name)}`}>{place.name}</Link>
                  <span className="num muted">{int(place.score)}</span>
                </li>
              ))}
            </ol>
          )}
          <span className="muted">This arena is over. Its standings are final.</span>
          <Link className="btn btn-secondary" to="/arena">See the next arena</Link>
        </>
      ) : joined ? (
        <>
          <span className="muted">{waitingLine(arena, arena.you)}</span>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onAct(() => api.pauseArena(arena.id, !arena.you?.paused))}
            >
              {arena.you?.paused ? 'Resume pairing' : 'Pause pairing'}
            </button>
            <button
              type="button"
              className="btn btn-tertiary"
              disabled={busy}
              onClick={() => onAct(() => api.leaveArena(arena.id))}
            >
              Leave the arena
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onAct(() => api.joinArena(arena.id))}
          >
            Join the arena
          </button>
          <span className="muted">
            No account needed. You play as a guest and can claim the name later.
          </span>
        </>
      )}
      {meId === null && <span className="muted">Connecting your session.</span>}
    </div>
  );
}

/* What somebody who has joined is waiting for, in one line, so the page never
   sits silent while the pairing loop takes its next pass. */
function waitingLine(arena: Arena, you: ArenaStanding | null): string {
  if (!you) return '';
  if (you.paused) return 'Paused. You keep your score and stay on the board, and nothing is dealt to you.';
  if (arena.status === 'upcoming') return 'You are in. The first pairings go out when the arena starts.';
  return 'Waiting for an opponent. The next pairing is dealt to you as soon as there is one.';
}

function Standings({ arena, meId }: { arena: Arena; meId: string | null }) {
  const rows = boardRows(arena.standings, meId);
  // Nobody is paused in an arena that has stopped pairing, so the tag comes
  // off with the clock rather than sitting on a frozen board saying nothing.
  const live = arena.status !== 'finished';

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="feed-head">
        <span className="h2">Standings</span>
        <span className="muted">Win two, draw one, three on a run</span>
      </div>
      <div className="card lb-card">
        {rows.length === 0 ? (
          <div className="empty">
            <span className="e-title">Nobody has joined yet</span>
            <span className="e-desc">The board fills in as people join and matches finish.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Arena standings">
              <thead>
                <tr>
                  <th className="r" style={{ width: 34 }}>#</th>
                  <th>Player</th>
                  <th className="r">Score</th>
                  <th className="r">W/D/L</th>
                  <th className="r">Matches</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.standing.uid}
                    data-mine={row.you ? '' : undefined}
                    data-gap={row.gap ? '' : undefined}
                  >
                    <td className="r num">{row.standing.rank}</td>
                    <td>
                      <span className="player-cell">
                        <Avatar
                          seed={avatarSeed(row.standing.uid, row.standing.name)}
                          name={row.standing.name}
                          size={24}
                        />
                        <Link to={`/u/${encodeURIComponent(row.standing.name)}`}>{row.standing.name}</Link>
                        {row.standing.bot && <span className="bot-tag">bot</span>}
                        {live && row.standing.paused && <span className="seat-you">paused</span>}
                      </span>
                    </td>
                    <td className="r num">
                      <span className="arena-score">
                        {row.standing.score}
                        {onFire(row.standing.streak) && <Flame wins={row.standing.streak} />}
                      </span>
                    </td>
                    <td className="r num">{record(row.standing)}</td>
                    <td className="r num">{row.standing.matches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <span className="muted">
        Ordered by score, then wins, then rating. The top twenty, with your own row beside them.
      </span>
    </section>
  );
}

/* On fire. Drawn rather than written because it sits inside a number, and a
   word beside a number is a word that moves it. One solid path in the accent
   colour: a two-tone flame would have to know the background it sits on, and
   your own row is a different one from everybody else's. The title is what
   says why it is there, for anybody who does not read a flame as a streak. */
function Flame({ wins }: { wins: number }) {
  return (
    <span className="arena-fire" title={`${wins} wins in a row, so the next one is worth three`}>
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
        <path
          d="M8.6 1c.3 2 1.3 3 2.4 4.1 1.1 1.1 1.9 2.3 1.9 4 0 3.1-2.4 5.2-5 5.2S3 12.2 3 9.1c0-1.7.7-3 1.7-4.2.2 1 .7 1.7 1.4 2.1.2-2.2 1.1-4.4 2.5-6z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

function FinishedArenas({ arenas }: { arenas: ArenaSummary[] }) {
  if (arenas.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="feed-head">
        <span className="h2">Arenas already played</span>
        <span className="muted">Every board stays readable</span>
      </div>
      <div className="card feed-card">
        {arenas.map((arena) => (
          <div className="feed-row arena-past" key={arena.id}>
            <Link className="row-link" to={`/arena/${arena.id}`} aria-label={`Arena ${arena.name}`} />
            <span className="tagset">
              <span className="badge badge-plain">{ago(arena.endsAt)}</span>
            </span>
            <ol className="arena-podium">
              {(arena.podium ?? []).map((place) => (
                <li key={place.uid}>
                  <span className="muted">{podiumLabel(place.place)}</span>
                  <Avatar seed={avatarSeed(place.uid, place.name)} name={place.name} size={20} />
                  <span className="n">{place.name}</span>
                  <span className="num muted">{int(place.score)}</span>
                </li>
              ))}
              {(arena.podium ?? []).length === 0 && <li className="muted">Nobody played this one.</li>}
            </ol>
            <span className="feed-meta">
              <span className="num">
                {arena.players} {arena.players === 1 ? 'player' : 'players'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
