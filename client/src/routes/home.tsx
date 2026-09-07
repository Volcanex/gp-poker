import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatFor } from '@opentable/protocol';
import type { Mode } from '@opentable/protocol';
import { api } from '../net/api.ts';
import { modeRating } from '../net/adapt.ts';
import type { LeaderboardRow, Me } from '../net/types.ts';
import { readPlayChoice, useSession } from '../net/session.tsx';
import { MODES, MODE_NAME } from '../ui/mode-tabs.tsx';
import { elapsed, useNow } from '../ui/bits.tsx';
import { int } from '../ui/format.ts';
import { useTitle } from '../ui/title.ts';
import { Link, useLocation } from 'react-router-dom';

/* The line under each mode's name is built from that mode's format, so the
   promise on the card cannot drift from the match it starts. */
function modeBlurb(mode: Mode): string {
  const f = formatFor(mode, true);
  if (mode === 'six-max') {
    return `Last player standing. ${f.players} seats, ${f.stack} units each, blinds climb every ${f.levelHands} hands.`;
  }
  return `Best of ${f.hands} hands. ${f.stack} units each, blinds fixed at ${f.sb} and ${f.bb}.`;
}

export function Home() {
  const { me, queue, startQueue, cancelQueue, offline, ready, conn, liveMatch } = useSession();
  const nav = useNavigate();
  const searching = queue.s === 'searching';
  const { hash } = useLocation();
  useTitle(null);
  const now = useNow(searching, 250);

  /* The last choice reopens the picker where it was left: that mode's stake,
     and a quiet mark on the card that was played. */
  const [last] = useState(() => readPlayChoice());
  const [rated, setRated] = useState<Record<Mode, boolean>>(() => ({
    'heads-up': last?.mode === 'heads-up' ? last.rated : true,
    'six-max': last?.mode === 'six-max' ? last.rated : true,
  }));

  useEffect(() => {
    if (queue.s === 'found' && queue.m) nav(`/m/${queue.m}`);
  }, [queue.s, queue.m, nav]);

  useEffect(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const seats = formatFor(queue.mode, queue.rated).players;

  return (
    <main className="page stack">
      <section className="hero">
        <h1 className="h1">Ranked hold'em</h1>
        <p className="lede">
          Heads-up or six handed, <b>no money anywhere</b>. Chips are table units that reset every
          match. The only thing you keep is your rating.
        </p>

        {offline && ready && (
          <div className="card" role="status">
            <div className="empty">
              <span className="e-title">The table server is not answering</span>
              <span className="e-desc">
                Matchmaking is unavailable until it is back. Reload to try the connection again.
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => location.reload()}>
                Try again
              </button>
            </div>
          </div>
        )}

        {!searching ? (
          <div className="modes">
            {MODES.map((mode) => (
              <div className="card mode" key={mode} data-last={last?.mode === mode ? '' : undefined}>
                <div className="mode-head">
                  <span className="t">{MODE_NAME[mode]}</span>
                  {last?.mode === mode && <span className="muted">last played</span>}
                </div>
                <span className="muted">{modeBlurb(mode)}</span>
                {me && <YourRating mode={mode} me={me} />}
                <div className="stakes">
                  {[true, false].map((r) => (
                    <label className="choice" key={String(r)}>
                      <input
                        type="radio"
                        className="radio"
                        name={`stake-${mode}`}
                        checked={rated[mode] === r}
                        onChange={() => setRated((prev) => ({ ...prev, [mode]: r }))}
                      />
                      {r ? 'Rated' : 'Casual'}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!ready || offline}
                  onClick={() => startQueue(mode, rated[mode])}
                >
                  Play
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="card searching-card" role="status">
            <span className="t">Searching for a {MODE_NAME[queue.mode].toLowerCase()} table</span>
            <div className="searching">
              <span className="spinner" aria-hidden="true" />
              <span className="el num">{elapsed(now - queue.since)}</span>
              <span className="badge badge-plain">{queue.rated ? 'Rated' : 'Casual'}</span>
              {queue.mode === 'six-max' && queue.seated != null && (
                <span className="badge badge-plain num">{queue.seated} of {seats} seated</span>
              )}
              {queue.range != null && (
                <span className="badge badge-plain num">Within {queue.range} rating</span>
              )}
              {queue.w != null && queue.w > 0 && (
                <span className="badge badge-plain num">{queue.w} waiting</span>
              )}
              <button type="button" className="btn btn-tertiary btn-sm" onClick={cancelQueue}>
                Cancel search
              </button>
            </div>
          </div>
        )}

        {liveMatch && (
          <Link className="btn btn-secondary" to={`/m/${liveMatch}`}>
            Return to your match
          </Link>
        )}

        {!offline && conn === 'waiting' && (
          <span className="muted">Connection dropped. Reconnecting.</span>
        )}
      </section>

      <section className="how">
        <div className="card">
          <span className="k">1</span>
          <span className="t">No money, ever</span>
          <span className="muted">No buy-ins, no rake, no ads. Nothing to purchase.</span>
        </div>
        <div className="card">
          <span className="k">2</span>
          <span className="t">Chips reset every match</span>
          <span className="muted">Everyone starts on 200 units. Six-max blinds climb until one player has the lot.</span>
        </div>
        <div className="card">
          <span className="k">3</span>
          <span className="t">Rating is the score</span>
          <span className="muted">Glicko-2, updated once per match. That is the whole ladder.</span>
        </div>
      </section>

      <Leaderboard mode={queue.mode} />

      <footer className="home-foot">
        Every hand is provably fair. Every match is public.{' '}
        <Link to="/leaderboard">See the leaderboard</Link>
      </footer>
    </main>
  );
}

/* Your standing in that mode, on the card that starts it. A mode you have
   never played says so rather than showing the 1500 everyone starts on as
   though it were earned. */
function YourRating({ mode, me }: { mode: Mode; me: Me }) {
  const r = modeRating(me, mode);
  if (r.matches === 0) return <span className="muted">No rated matches in this mode yet.</span>;
  return (
    <span className="muted">
      Your rating <span className="num">{int(r.rating)}</span>
      <span className="rd num">+-{int(r.rd)}</span>
      {r.provisional && ' · provisional'}
    </span>
  );
}

/* The peek follows the mode the picker is on, so the board underneath is the
   ladder the button above it plays for. */
function Leaderboard({ mode }: { mode: Mode }) {
  const [list, setList] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setList(null);
    setFailed(false);
    api
      .leaderboard(mode)
      .then((p) => live && setList(p.slice(0, 10)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [mode]);

  return (
    <section className="stack" id="leaderboard" style={{ gap: 'var(--sp-3)' }}>
      <div className="lb-head">
        <span className="h2">Top ten, {MODE_NAME[mode].toLowerCase()}</span>
        <span className="muted">Rating, with the deviation beside it</span>
        <span style={{ flex: 1 }} />
        <Link className="btn btn-tertiary btn-sm" to="/leaderboard">See all</Link>
      </div>
      <div className="card lb-card">
        {failed || (list && list.length === 0) ? (
          <div className="empty">
            <span className="e-title">No ratings yet</span>
            <span className="e-desc">The board fills in as rated matches finish.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Top rated players">
              <thead>
                <tr>
                  <th className="r" style={{ width: 34 }}>#</th>
                  <th>Player</th>
                  <th className="r">Rating</th>
                </tr>
              </thead>
              <tbody>
                {(list ?? placeholder).map((r, i) => (
                  <tr key={r.name || i}>
                    <td className="r">{i + 1}</td>
                    <td>
                      {list ? (
                        <Link to={`/u/${encodeURIComponent(r.name)}`}>{r.name}</Link>
                      ) : (
                        <span className="skeleton skeleton-text" style={{ width: 96 }} />
                      )}
                    </td>
                    <td className="r">
                      {list ? (
                        <>
                          {int(r.rating)}
                          {r.rd != null && <span className="rd num">+-{int(r.rd)}</span>}
                        </>
                      ) : (
                        <span className="skeleton skeleton-text" style={{ width: 48 }} />
                      )}
                    </td>
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

const placeholder: LeaderboardRow[] = Array.from({ length: 5 }, (_, i) => ({
  name: `row-${i}`,
  rating: 0,
  rd: 0,
  matches: 0,
  peak: 0,
}));
